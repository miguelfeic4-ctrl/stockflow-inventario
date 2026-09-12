-- Almacenes demostrativos con nombres y direcciones ficticias.
update public.warehouses
set name = case name
  when 'Almacén A' then 'Almacén La Victoria'
  when 'Bodega B' then 'Almacén Lurín'
  when 'Bodega C' then 'Almacén Los Olivos'
  else name
end,
description = case name
  when 'Almacén A' then 'Av. Aviación 1840, La Victoria, Lima (dirección ficticia)'
  when 'Bodega B' then 'Carretera Antigua Panamericana Sur km 31, Lurín, Lima (dirección ficticia)'
  when 'Bodega C' then 'Av. Universitaria 5930, Los Olivos, Lima (dirección ficticia)'
  else description
end
where name in ('Almacén A', 'Bodega B', 'Bodega C');

update public.inventory inv
set location = w.name
from public.rack_positions p
join public.racks r on r.id = p.rack_id
join public.warehouses w on w.id = r.warehouse_id
where inv.position_id = p.id;

-- Preferencia opcional de preparación solicitada por el cliente.
alter table public.customer_orders
  add column if not exists preferred_warehouse_id uuid references public.warehouses(id) on delete set null,
  add column if not exists preferred_rack_id uuid references public.racks(id) on delete set null;

-- El catálogo conserva sus filtros y ahora informa el stock físico por almacén/rack.
drop function if exists public.get_store_catalog();
create function public.get_store_catalog()
returns table (
  item_id uuid, sku text, product_name text, description text, category text,
  supplier text, brand text, color text, size_eu integer, price numeric,
  available_quantity integer, warehouse_name text, rack_code text, position_code text
)
language sql stable security definer set search_path = public as $$
  select i.id, i.sku, i.name, i.description, i.category, i.supplier,
    coalesce(i.brand, 'Sin marca'), coalesce(i.color, 'Sin color'), i.size_eu,
    i.price, inv.quantity, coalesce(w.name, inv.location), r.code, p.code
  from public.inventory_items i
  join public.inventory inv on inv.item_id = i.id
  left join public.rack_positions p on p.id = inv.position_id
  left join public.racks r on r.id = p.rack_id
  left join public.warehouses w on w.id = r.warehouse_id
  where inv.quantity > 0
  order by i.name;
$$;

-- Opciones reales para el cliente: solamente racks con posiciones de preparación libres.
create or replace function public.get_customer_dispatch_options()
returns table (warehouse_id uuid, warehouse_name text, rack_id uuid, rack_code text, free_positions integer)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'cliente') then
    raise exception 'Solo los clientes pueden elegir un punto de preparación';
  end if;
  return query
  select w.id, w.name, r.id, r.code, count(p.id)::integer
  from public.warehouses w
  join public.racks r on r.warehouse_id = w.id
  join public.rack_positions p on p.rack_id = r.id
  where not exists (select 1 from public.inventory i where i.position_id = p.id)
    and not exists (select 1 from public.position_reservations pr where pr.position_id = p.id and pr.status = 'reservada')
    and not exists (select 1 from public.customer_order_fulfillments f where f.position_id = p.id and f.status = 'reservado')
  group by w.id, w.name, r.id, r.code
  order by w.name, r.code;
end;
$$;

-- La solicitud conserva la preferencia. No descuenta stock hasta la aprobación.
drop function if exists public.create_customer_order(uuid, integer);
create function public.create_customer_order(
  p_item_id uuid,
  p_quantity integer,
  p_preferred_rack_id uuid default null
)
returns bigint language plpgsql security definer set search_path = public as $$
declare inv public.inventory; item_price numeric; order_id bigint; preferred_warehouse uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'cliente') then
    raise exception 'Solo los clientes pueden crear solicitudes de compra';
  end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  select * into inv from public.inventory where item_id = p_item_id for share;
  if not found or inv.quantity < p_quantity then raise exception 'No hay stock suficiente para esta solicitud'; end if;
  if p_preferred_rack_id is not null then
    select warehouse_id into preferred_warehouse from public.racks where id = p_preferred_rack_id;
    if not found then raise exception 'El rack seleccionado no existe'; end if;
  end if;
  select price into item_price from public.inventory_items where id = p_item_id;
  insert into public.customer_orders(customer_id,item_id,inventory_id,quantity,unit_price,total,preferred_warehouse_id,preferred_rack_id)
  values(auth.uid(),p_item_id,inv.id,p_quantity,item_price,item_price*p_quantity,preferred_warehouse,p_preferred_rack_id)
  returning id into order_id;
  return order_id;
end;
$$;

-- Con preferencia del cliente, la aprobación elige la primera posición libre de su rack.
drop function if exists public.review_customer_order(bigint, text, text, uuid);
create function public.review_customer_order(
  p_order_id bigint, p_status text, p_note text, p_dispatch_position_id uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare o public.customer_orders; current_stock integer; selected_position uuid;
begin
  if not public.is_staff() then raise exception 'Solo el personal puede revisar compras'; end if;
  if p_status not in ('aprobado','rechazado','observado') then raise exception 'Estado de revisión inválido'; end if;
  select * into o from public.customer_orders where id = p_order_id for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if o.status in ('aprobado','rechazado') then raise exception 'Esta compra ya fue procesada'; end if;
  if p_status = 'aprobado' then
    selected_position := p_dispatch_position_id;
    if o.preferred_rack_id is not null then
      select p.id into selected_position
      from public.rack_positions p
      where p.rack_id = o.preferred_rack_id
        and not exists (select 1 from public.inventory i where i.position_id = p.id)
        and not exists (select 1 from public.position_reservations pr where pr.position_id = p.id and pr.status = 'reservada')
        and not exists (select 1 from public.customer_order_fulfillments f where f.position_id = p.id and f.status = 'reservado')
      order by p.code limit 1 for update skip locked;
      if selected_position is null then raise exception 'El rack elegido por el cliente ya no tiene posiciones libres'; end if;
    elsif selected_position is null then
      raise exception 'Selecciona almacén, rack y posición para preparar el pedido';
    end if;
    perform 1 from public.rack_positions where id = selected_position for update;
    if not found then raise exception 'La posición seleccionada no existe'; end if;
    if exists (select 1 from public.inventory where position_id = selected_position)
       or exists (select 1 from public.position_reservations where position_id = selected_position and status = 'reservada')
       or exists (select 1 from public.customer_order_fulfillments where position_id = selected_position and status = 'reservado') then
      raise exception 'La posición ya no está libre; elige otra';
    end if;
    select quantity into current_stock from public.inventory where id = o.inventory_id for update;
    if current_stock < o.quantity then raise exception 'Stock insuficiente para aprobar esta compra'; end if;
    update public.inventory set quantity = quantity - o.quantity, updated_at = now() where id = o.inventory_id;
    insert into public.inventory_movements(item_id,inventory_id,movement_type,quantity,reason,status,approved_at,notes,destination_position_id)
    values(o.item_id,o.inventory_id,'salida',o.quantity,concat('Venta orden #',o.id),'aprobado',now(),concat('Preparado para DESP-',lpad(o.id::text,6,'0')),selected_position);
    insert into public.customer_order_fulfillments(order_id,position_id,assigned_by)
    values(o.id,selected_position,auth.uid());
  end if;
  update public.customer_orders set status=p_status, review_note=nullif(trim(p_note),''), reviewed_by=auth.uid(), reviewed_at=now() where id=p_order_id;
end;
$$;

grant execute on function public.get_store_catalog() to authenticated;
grant execute on function public.get_customer_dispatch_options() to authenticated;
grant execute on function public.create_customer_order(uuid,integer,uuid) to authenticated;
grant execute on function public.review_customer_order(bigint,text,text,uuid) to authenticated;
