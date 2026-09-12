-- REPARACIÓN ÚNICA: historial del cliente con producto y ubicación de recojo.
-- Puede ejecutarse aunque existan compras aprobadas antes de crear la reserva de despacho.
create table if not exists public.customer_order_fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null unique references public.customer_orders(id) on delete cascade,
  position_id uuid not null references public.rack_positions(id) on delete restrict,
  status text not null default 'reservado' check (status in ('reservado', 'entregado', 'cancelado')),
  assigned_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create or replace function public.get_my_customer_orders()
returns table (
  id bigint,
  sku text,
  product_name text,
  quantity integer,
  total numeric,
  status text,
  review_note text,
  created_at timestamptz,
  dispatch_status text,
  warehouse_name text,
  rack_code text,
  position_code text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'cliente'
  ) then
    raise exception 'Solo los clientes pueden consultar este historial';
  end if;

  return query
  select
    o.id, i.sku, i.name, o.quantity, o.total, o.status, o.review_note, o.created_at,
    f.status,
    coalesce(dispatch_warehouse.name, stock_warehouse.name, inv.location),
    coalesce(dispatch_rack.code, stock_rack.code),
    coalesce(dispatch_position.code, stock_position.code)
  from public.customer_orders o
  join public.inventory_items i on i.id = o.item_id
  left join public.customer_order_fulfillments f on f.order_id = o.id
  left join public.rack_positions dispatch_position on dispatch_position.id = f.position_id
  left join public.racks dispatch_rack on dispatch_rack.id = dispatch_position.rack_id
  left join public.warehouses dispatch_warehouse on dispatch_warehouse.id = dispatch_rack.warehouse_id
  left join public.inventory inv on inv.id = o.inventory_id
  left join public.rack_positions stock_position on stock_position.id = inv.position_id
  left join public.racks stock_rack on stock_rack.id = stock_position.rack_id
  left join public.warehouses stock_warehouse on stock_warehouse.id = stock_rack.warehouse_id
  where o.customer_id = auth.uid()
  order by o.created_at desc;
end;
$$;

grant execute on function public.get_my_customer_orders() to authenticated;

-- Fuerza a la API de Supabase a reconocer la función recién creada de inmediato.
notify pgrst, 'reload schema';
