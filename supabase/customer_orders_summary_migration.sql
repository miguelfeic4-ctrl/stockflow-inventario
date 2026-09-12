-- Resumen seguro e independiente del catálogo para el panel del cliente.
-- Evita que un fallo en filtros o catálogo oculte compras ya registradas.
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
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'cliente') then
    raise exception 'Solo los clientes pueden consultar este historial';
  end if;
  return query
  select
    o.id, i.sku, i.name, o.quantity, o.total, o.status, o.review_note, o.created_at,
    f.status, w.name, r.code, p.code
  from public.customer_orders o
  join public.inventory_items i on i.id = o.item_id
  left join public.customer_order_fulfillments f on f.order_id = o.id
  left join public.rack_positions p on p.id = f.position_id
  left join public.racks r on r.id = p.rack_id
  left join public.warehouses w on w.id = r.warehouse_id
  where o.customer_id = auth.uid()
  order by o.created_at desc;
end;
$$;

grant execute on function public.get_my_customer_orders() to authenticated;
