-- El catálogo y la creación de compras son exclusivos del rol cliente.
-- Operador y administrador revisan/aprueban los pedidos desde el portal.
create or replace function public.create_customer_order(p_item_id uuid, p_quantity integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.inventory;
  item_price numeric;
  order_id bigint;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'cliente'
  ) then
    raise exception 'Solo los clientes pueden crear solicitudes de compra';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'La cantidad debe ser mayor a cero';
  end if;

  select * into inv
  from public.inventory
  where item_id = p_item_id
  for share;
  if not found or inv.quantity < p_quantity then
    raise exception 'No hay stock suficiente para esta solicitud';
  end if;

  select price into item_price from public.inventory_items where id = p_item_id;
  insert into public.customer_orders(customer_id, item_id, inventory_id, quantity, unit_price, total)
  values (auth.uid(), p_item_id, inv.id, p_quantity, item_price, item_price * p_quantity)
  returning id into order_id;
  return order_id;
end;
$$;

grant execute on function public.create_customer_order(uuid, integer) to authenticated;
