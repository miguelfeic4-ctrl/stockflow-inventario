-- Buscador simple de ubicación: cualquier usuario autenticado puede consultar
-- un producto por su SKU/código de producto (ej. ZAP-001).
create or replace function public.locate_product_by_code(p_code text)
returns table (
  code text, sku text, product_name text, warehouse text,
  rack text, position_code text, available_quantity integer
)
language sql stable security definer set search_path = public as $$
  select
    i.sku as code,
    i.sku,
    i.name,
    w.name,
    r.code,
    p.code,
    inv.quantity
  from public.inventory_items i
  join public.inventory inv on inv.item_id = i.id
  left join public.rack_positions p on p.id = inv.position_id
  left join public.racks r on r.id = p.rack_id
  left join public.warehouses w on w.id = r.warehouse_id
  where upper(trim(i.sku)) = upper(trim(p_code));
$$;
grant execute on function public.locate_product_by_code(text) to authenticated;
