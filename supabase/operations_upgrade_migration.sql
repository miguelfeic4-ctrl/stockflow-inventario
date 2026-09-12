-- OPERACIONES AVANZADAS: notificaciones, estados de despacho e INBOUND con proveedor.

-- 1) Notificaciones internas para cliente, operador y administrador.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  type text not null default 'info',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id, read_at, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "users read own notifications" on public.notifications;
drop policy if exists "users mark own notifications read" on public.notifications;
create policy "users read own notifications" on public.notifications for select using (recipient_id = auth.uid());
create policy "users mark own notifications read" on public.notifications for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create or replace function public.notify_customer_order_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare customer_name text;
begin
  if tg_op = 'INSERT' then
    select full_name into customer_name from public.profiles where id = new.customer_id;
    insert into public.notifications(recipient_id,title,body,type)
    select id, 'Nueva compra por revisar', concat('Orden #', new.id, ' creada por ', coalesce(customer_name, 'un cliente'), '.'), 'orden'
    from public.profiles where role in ('operador','administrador');
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.notifications(recipient_id,title,body,type)
    values (
      new.customer_id,
      'Actualización de tu compra',
      concat('La orden #', new.id, ' ahora está: ', replace(new.status, '_', ' '), '.'),
      'orden'
    );
  end if;
  return new;
end;
$$;
drop trigger if exists customer_order_notifications on public.customer_orders;
create trigger customer_order_notifications after insert or update of status on public.customer_orders
for each row execute procedure public.notify_customer_order_event();

create or replace function public.notify_fulfillment_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare customer_id uuid;
begin
  select o.customer_id into customer_id from public.customer_orders o where o.id = new.order_id;
  if tg_op = 'INSERT' then
    insert into public.notifications(recipient_id,title,body,type)
    values(customer_id, 'Pedido preparado', concat('Tu orden #', new.order_id, ' ya fue preparada para retiro.'), 'retiro');
  elsif new.status = 'entregado' and old.status is distinct from new.status then
    insert into public.notifications(recipient_id,title,body,type)
    values(customer_id, 'Pedido entregado', concat('La entrega de tu orden #', new.order_id, ' fue confirmada.'), 'retiro');
  end if;
  return new;
end;
$$;
drop trigger if exists fulfillment_notifications on public.customer_order_fulfillments;
create trigger fulfillment_notifications after insert or update of status on public.customer_order_fulfillments
for each row execute procedure public.notify_fulfillment_event();

-- 2) Estados de despacho más detallados.
alter table public.customer_orders drop constraint if exists customer_orders_status_check;
alter table public.customer_orders add constraint customer_orders_status_check
  check (status in ('pendiente','aprobado','preparado','listo_retiro','entregado','rechazado','observado'));

create or replace function public.mark_customer_order_ready(p_order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo el personal puede marcar pedidos listos'; end if;
  if not exists (select 1 from public.customer_order_fulfillments where order_id = p_order_id and status = 'reservado') then
    raise exception 'El pedido debe tener una posición de preparación reservada';
  end if;
  update public.customer_orders set status = 'listo_retiro', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_order_id and status in ('aprobado','preparado');
  if not found then raise exception 'El pedido no puede marcarse como listo para retiro'; end if;
end;
$$;

-- Al confirmar la entrega se marca también la orden como entregada.
create or replace function public.complete_customer_order_dispatch(p_order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare f public.customer_order_fulfillments;
begin
  if not public.is_staff() then raise exception 'Solo el personal puede confirmar el despacho'; end if;
  select * into f from public.customer_order_fulfillments where order_id = p_order_id for update;
  if not found or f.status <> 'reservado' then raise exception 'Este pedido no tiene una posición de preparación activa'; end if;
  update public.customer_order_fulfillments set status = 'entregado', completed_at = now() where id = f.id;
  update public.customer_orders set status = 'entregado', reviewed_at = now(), reviewed_by = auth.uid() where id = p_order_id;
end;
$$;

-- 3) INBOUND: proveedor y fecha estimada dentro de la orden de entrada existente.
alter table public.inventory_movements add column if not exists supplier_name text;
alter table public.inventory_movements add column if not exists expected_at timestamptz;
drop function if exists public.create_warehouse_movement(uuid,text,integer,text,text,uuid);
create or replace function public.create_warehouse_movement(
  p_inventory_id uuid, p_movement_type text, p_quantity integer, p_reason text,
  p_notes text default null, p_destination_position_id uuid default null,
  p_supplier_name text default null, p_expected_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare m_id uuid; source_id uuid;
begin
  if p_movement_type not in ('entrada','salida','ajuste') then raise exception 'Tipo de movimiento inválido'; end if;
  if p_quantity <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  select position_id into source_id from public.inventory where id = p_inventory_id;
  if not found then raise exception 'Inventario no encontrado'; end if;
  if p_movement_type = 'entrada' and p_destination_position_id is null then raise exception 'Selecciona una posición para la entrada'; end if;
  if p_movement_type = 'entrada' and nullif(trim(p_supplier_name),'') is null then raise exception 'Indica el proveedor para la orden INBOUND'; end if;
  insert into public.inventory_movements(item_id,inventory_id,movement_type,quantity,reason,notes,source_position_id,destination_position_id,supplier_name,expected_at)
  select item_id,id,p_movement_type,p_quantity,p_reason,p_notes,source_id,p_destination_position_id,nullif(trim(p_supplier_name),''),p_expected_at
  from public.inventory where id = p_inventory_id returning id into m_id;
  if p_movement_type = 'entrada' then
    if exists(select 1 from public.inventory where position_id = p_destination_position_id) then raise exception 'La posición ya está ocupada'; end if;
    insert into public.position_reservations(position_id,movement_id) values(p_destination_position_id,m_id);
  end if;
  return m_id;
end;
$$;

grant execute on function public.mark_customer_order_ready(bigint) to authenticated;
grant execute on function public.complete_customer_order_dispatch(bigint) to authenticated;
grant execute on function public.create_warehouse_movement(uuid,text,integer,text,text,uuid,text,timestamptz) to authenticated;
notify pgrst, 'reload schema';
