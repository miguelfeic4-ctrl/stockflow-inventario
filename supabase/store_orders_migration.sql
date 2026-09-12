-- Tienda y pedidos: ejecuta después de auth_tickets_migration.sql y audit_log_migration.sql.
create table if not exists public.customer_orders (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  inventory_id uuid not null references public.inventory(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total numeric(12,2) not null check (total >= 0),
  status text not null default 'pendiente' check (status in ('pendiente','aprobado','rechazado','observado')),
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists customer_orders_customer_idx on public.customer_orders(customer_id, created_at desc);
create index if not exists customer_orders_status_idx on public.customer_orders(status, created_at desc);

create table if not exists public.customer_order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null references public.customer_orders(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index if not exists customer_order_messages_order_idx on public.customer_order_messages(order_id, created_at);

-- Catálogo público solo para usuarios autenticados: no expone toda la tabla inventory.
create or replace function public.get_store_catalog()
returns table (item_id uuid, sku text, product_name text, description text, category text, supplier text, price numeric, available_quantity integer)
language sql stable security definer set search_path = public as $$
  select i.id, i.sku, i.name, i.description, i.category, i.supplier, i.price, inv.quantity
  from public.inventory_items i join public.inventory inv on inv.item_id = i.id
  where inv.quantity > 0 order by i.category, i.name;
$$;

-- Crea una solicitud sin descontar stock. El descuento ocurre únicamente al aprobar.
create or replace function public.create_customer_order(p_item_id uuid, p_quantity integer)
returns bigint language plpgsql security definer set search_path = public as $$
declare inv public.inventory; item_price numeric(12,2); order_id bigint;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if p_quantity <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  select * into inv from public.inventory where item_id = p_item_id for share;
  if not found or inv.quantity < p_quantity then raise exception 'No hay stock suficiente para esta solicitud'; end if;
  select price into item_price from public.inventory_items where id = p_item_id;
  insert into public.customer_orders(customer_id,item_id,inventory_id,quantity,unit_price,total)
  values(auth.uid(),p_item_id,inv.id,p_quantity,item_price,item_price*p_quantity) returning id into order_id;
  return order_id;
end;
$$;

-- Operador o administrador revisa la compra. Al aprobar, bloquea el inventario y descuenta stock de forma atómica.
create or replace function public.review_customer_order(p_order_id bigint, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.customer_orders; current_stock integer;
begin
  if not public.is_staff() then raise exception 'Solo el personal puede revisar compras'; end if;
  if p_status not in ('aprobado','rechazado','observado') then raise exception 'Estado de revisión inválido'; end if;
  select * into o from public.customer_orders where id = p_order_id for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if o.status = 'aprobado' or o.status = 'rechazado' then raise exception 'Esta compra ya fue procesada'; end if;
  if p_status = 'aprobado' then
    select quantity into current_stock from public.inventory where id = o.inventory_id for update;
    if current_stock < o.quantity then raise exception 'Stock insuficiente para aprobar esta compra'; end if;
    update public.inventory set quantity = quantity - o.quantity, updated_at = now() where id = o.inventory_id;
    insert into public.inventory_movements(item_id,inventory_id,movement_type,quantity,reason,status,approved_at,notes)
    values(o.item_id,o.inventory_id,'salida',o.quantity,concat('Venta orden #',o.id),'aprobado',now(),'Salida aprobada desde tienda');
  end if;
  update public.customer_orders set status=p_status, review_note=nullif(trim(p_note),''), reviewed_by=auth.uid(), reviewed_at=now() where id=p_order_id;
end;
$$;

alter table public.customer_orders enable row level security;
alter table public.customer_order_messages enable row level security;
drop policy if exists "customer reads own orders staff reads all" on public.customer_orders;
drop policy if exists "customer creates own orders" on public.customer_orders;
drop policy if exists "order participants read messages" on public.customer_order_messages;
drop policy if exists "order participants write messages" on public.customer_order_messages;
create policy "customer reads own orders staff reads all" on public.customer_orders for select using (customer_id=auth.uid() or public.is_staff());
create policy "order participants read messages" on public.customer_order_messages for select using (exists(select 1 from public.customer_orders o where o.id=order_id and (o.customer_id=auth.uid() or public.is_staff())));
create policy "order participants write messages" on public.customer_order_messages for insert with check (sender_id=auth.uid() and exists(select 1 from public.customer_orders o where o.id=order_id and (o.customer_id=auth.uid() or public.is_staff())));

grant execute on function public.get_store_catalog() to authenticated;
grant execute on function public.create_customer_order(uuid,integer) to authenticated;
grant execute on function public.review_customer_order(bigint,text,text) to authenticated;

-- Bitácora de compras y mensajes, visible para administrador mediante audit_log.
drop trigger if exists audit_customer_orders on public.customer_orders;
create trigger audit_customer_orders after insert or update or delete on public.customer_orders for each row execute procedure public.write_audit_log();
drop trigger if exists audit_customer_order_messages on public.customer_order_messages;
create trigger audit_customer_order_messages after insert or update or delete on public.customer_order_messages for each row execute procedure public.write_audit_log();
