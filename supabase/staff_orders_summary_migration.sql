-- Bandeja global segura para operador y administrador.
-- Evita que la interfaz deje de mostrar compras por una política RLS o relación anidada.
create or replace function public.get_staff_customer_orders()
returns table (
  id bigint,
  customer_name text,
  sku text,
  product_name text,
  inventory_id uuid,
  preferred_rack_id uuid,
  quantity integer,
  total numeric,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Solo operador y administrador pueden consultar las compras globales';
  end if;
  return query
  select
    o.id, p.full_name, i.sku, i.name, o.inventory_id, o.preferred_rack_id,
    o.quantity, o.total, o.status, o.created_at
  from public.customer_orders o
  join public.profiles p on p.id = o.customer_id
  join public.inventory_items i on i.id = o.item_id
  order by o.created_at desc;
end;
$$;

grant execute on function public.get_staff_customer_orders() to authenticated;
