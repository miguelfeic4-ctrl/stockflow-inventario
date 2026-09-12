-- Preparación de pedidos: una compra aprobada debe ocupar temporalmente una
-- posición real del almacén hasta que el pedido sea despachado o retirado.
create table if not exists public.customer_order_fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null unique references public.customer_orders(id) on delete cascade,
  position_id uuid not null references public.rack_positions(id) on delete restrict,
  status text not null default 'reservado' check (status in ('reservado', 'entregado', 'cancelado')),
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Una posición de preparación no puede estar asignada a dos pedidos activos.
create unique index if not exists one_active_dispatch_per_position
  on public.customer_order_fulfillments(position_id) where status = 'reservado';
create index if not exists customer_order_fulfillments_order_idx
  on public.customer_order_fulfillments(order_id);

alter table public.customer_order_fulfillments enable row level security;
drop policy if exists "customer reads own dispatch staff reads all" on public.customer_order_fulfillments;
create policy "customer reads own dispatch staff reads all"
  on public.customer_order_fulfillments for select
  using (
    public.is_staff()
    or exists (
      select 1 from public.customer_orders o
      where o.id = order_id and o.customer_id = auth.uid()
    )
  );

-- Devuelve solamente posiciones aptas para preparar una compra: no contienen
-- inventario, no están reservadas para INBOUND y no pertenecen a otro pedido.
create or replace function public.get_available_dispatch_positions()
returns table (
  position_id uuid,
  warehouse_name text,
  rack_code text,
  position_code text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede consultar posiciones de despacho';
  end if;

  return query
  select p.id, w.name, r.code, p.code
  from public.rack_positions p
  join public.racks r on r.id = p.rack_id
  join public.warehouses w on w.id = r.warehouse_id
  where not exists (select 1 from public.inventory i where i.position_id = p.id)
    and not exists (
      select 1 from public.position_reservations pr
      where pr.position_id = p.id and pr.status = 'reservada'
    )
    and not exists (
      select 1 from public.customer_order_fulfillments f
      where f.position_id = p.id and f.status = 'reservado'
    )
  order by w.name, r.code, p.code;
end;
$$;

-- Reemplaza la aprobación: ahora exige una posición libre de preparación.
drop function if exists public.review_customer_order(bigint, text, text);
create function public.review_customer_order(
  p_order_id bigint,
  p_status text,
  p_note text,
  p_dispatch_position_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.customer_orders;
  current_stock integer;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede revisar compras';
  end if;
  if p_status not in ('aprobado', 'rechazado', 'observado') then
    raise exception 'Estado de revisión inválido';
  end if;

  select * into o from public.customer_orders where id = p_order_id for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if o.status in ('aprobado', 'rechazado') then
    raise exception 'Esta compra ya fue procesada';
  end if;

  if p_status = 'aprobado' then
    if p_dispatch_position_id is null then
      raise exception 'Selecciona almacén, rack y posición para preparar el pedido';
    end if;

    -- Bloquea la posición elegida y vuelve a verificar que siga libre.
    perform 1 from public.rack_positions where id = p_dispatch_position_id for update;
    if not found then raise exception 'La posición seleccionada no existe'; end if;
    if exists (select 1 from public.inventory where position_id = p_dispatch_position_id)
       or exists (select 1 from public.position_reservations where position_id = p_dispatch_position_id and status = 'reservada')
       or exists (select 1 from public.customer_order_fulfillments where position_id = p_dispatch_position_id and status = 'reservado') then
      raise exception 'La posición ya no está libre; elige otra';
    end if;

    select quantity into current_stock from public.inventory where id = o.inventory_id for update;
    if current_stock < o.quantity then
      raise exception 'Stock insuficiente para aprobar esta compra';
    end if;

    update public.inventory
      set quantity = quantity - o.quantity, updated_at = now()
      where id = o.inventory_id;
    insert into public.inventory_movements(
      item_id, inventory_id, movement_type, quantity, reason, status,
      approved_at, notes, destination_position_id
    ) values (
      o.item_id, o.inventory_id, 'salida', o.quantity,
      concat('Venta orden #', o.id), 'aprobado', now(),
      concat('Preparado para DESP-', lpad(o.id::text, 6, '0')),
      p_dispatch_position_id
    );
    insert into public.customer_order_fulfillments(order_id, position_id, assigned_by)
      values (o.id, p_dispatch_position_id, auth.uid());
  end if;

  update public.customer_orders
    set status = p_status,
        review_note = nullif(trim(p_note), ''),
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = p_order_id;
end;
$$;

grant execute on function public.get_available_dispatch_positions() to authenticated;
grant execute on function public.review_customer_order(bigint, text, text, uuid) to authenticated;

-- Al entregar o despachar el pedido, se libera la posición de preparación.
create or replace function public.complete_customer_order_dispatch(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare f public.customer_order_fulfillments;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede confirmar el despacho';
  end if;
  select * into f from public.customer_order_fulfillments
    where order_id = p_order_id for update;
  if not found or f.status <> 'reservado' then
    raise exception 'Este pedido no tiene una posición de preparación activa';
  end if;
  update public.customer_order_fulfillments
    set status = 'entregado', completed_at = now()
    where id = f.id;
end;
$$;

grant execute on function public.complete_customer_order_dispatch(bigint) to authenticated;
