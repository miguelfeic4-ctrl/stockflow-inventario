-- PIN de retiro seguro.
-- El código no se devuelve al operador/administrador: solo el cliente lo obtiene
-- dentro de su propio resumen y el personal únicamente puede validarlo.

create table if not exists public.customer_order_pickup_pins (
  order_id bigint primary key references public.customer_orders(id) on delete cascade,
  pin_code text not null check (pin_code ~ '^[0-9]{6}$'),
  generated_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id),
  failed_attempts integer not null default 0
);

alter table public.customer_order_pickup_pins enable row level security;
-- Intencionalmente no se crean políticas SELECT: el PIN solo pasa por las RPC
-- controladas más abajo. Así el personal no puede consultarlo desde la app.
revoke all on table public.customer_order_pickup_pins from anon, authenticated;

-- La firma de la función cambia porque se agrega pickup_pin al resultado.
drop function if exists public.get_my_customer_orders();
create function public.get_my_customer_orders()
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
  position_code text,
  pickup_pin text
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
    f.status, w.name, r.code, pos.code,
    case when o.status = 'listo_retiro' and pin.verified_at is null then pin.pin_code else null end
  from public.customer_orders o
  join public.inventory_items i on i.id = o.item_id
  left join public.customer_order_fulfillments f on f.order_id = o.id
  left join public.rack_positions pos on pos.id = f.position_id
  left join public.racks r on r.id = pos.rack_id
  left join public.warehouses w on w.id = r.warehouse_id
  left join public.customer_order_pickup_pins pin on pin.order_id = o.id
  where o.customer_id = auth.uid()
  order by o.created_at desc;
end;
$$;

-- Al dejar listo un pedido se emite un PIN nuevo de seis dígitos para el cliente.
create or replace function public.mark_customer_order_ready(p_order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede marcar pedidos listos';
  end if;
  if not exists (
    select 1 from public.customer_order_fulfillments fulfillment
    where fulfillment.order_id = p_order_id and fulfillment.status = 'reservado'
  ) then
    raise exception 'El pedido debe tener una posición de preparación reservada';
  end if;

  update public.customer_orders
  set status = 'listo_retiro', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_order_id and status in ('aprobado','preparado');
  if not found then
    raise exception 'El pedido no puede marcarse como listo para retiro';
  end if;

  insert into public.customer_order_pickup_pins(order_id, pin_code, generated_at, verified_at, verified_by, failed_attempts)
  values (p_order_id, lpad(floor(random() * 1000000)::integer::text, 6, '0'), now(), null, null, 0)
  on conflict (order_id) do update set
    pin_code = excluded.pin_code,
    generated_at = excluded.generated_at,
    verified_at = null,
    verified_by = null,
    failed_attempts = 0;
end;
$$;

-- También habilita el flujo para pedidos que ya estaban listos antes de instalar esta mejora.
insert into public.customer_order_pickup_pins(order_id, pin_code)
select orders.id, lpad(floor(random() * 1000000)::integer::text, 6, '0')
from public.customer_orders orders
join public.customer_order_fulfillments fulfillment on fulfillment.order_id = orders.id
where orders.status = 'listo_retiro'
  and fulfillment.status = 'reservado'
on conflict (order_id) do nothing;

-- El personal entrega el PIN que el cliente le comunica. La función responde
-- solo si coincide; no expone el PIN almacenado en ningún caso.
create or replace function public.validate_customer_order_pickup_pin(
  p_order_id bigint,
  p_pin text
)
returns table (is_valid boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  stored_pin public.customer_order_pickup_pins;
  fulfillment public.customer_order_fulfillments;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede validar un retiro';
  end if;

  select * into fulfillment
  from public.customer_order_fulfillments
  where order_id = p_order_id
  for update;
  if not found or fulfillment.status <> 'reservado' then
    return query select false, 'El pedido no está disponible para retiro.';
    return;
  end if;

  select * into stored_pin
  from public.customer_order_pickup_pins
  where order_id = p_order_id
  for update;
  if not found or stored_pin.verified_at is not null then
    return query select false, 'El PIN de retiro no está disponible o ya fue utilizado.';
    return;
  end if;

  if stored_pin.pin_code <> trim(coalesce(p_pin, '')) then
    update public.customer_order_pickup_pins
    set failed_attempts = failed_attempts + 1
    where order_id = p_order_id;
    return query select false, 'PIN incorrecto. Verifica el código proporcionado por el cliente.';
    return;
  end if;

  update public.customer_order_pickup_pins
  set verified_at = now(), verified_by = auth.uid()
  where order_id = p_order_id;
  update public.customer_order_fulfillments
  set status = 'entregado', completed_at = now()
  where id = fulfillment.id;
  update public.customer_orders
  set status = 'entregado', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_order_id;

  -- Evidencia visible en la bitácora administrativa: no guarda el PIN.
  insert into public.audit_log(actor_id, action, entity_type, entity_id, details)
  select
    auth.uid(),
    'customer_order_delivered',
    'customer_order',
    orders.id::text,
    jsonb_build_object(
      'order_code', concat('DESP-', lpad(orders.id::text, 6, '0')),
      'product_name', item.name,
      'sku', item.sku,
      'quantity', orders.quantity,
      'message', 'Producto entregado tras validar el PIN de retiro.'
    )
  from public.customer_orders orders
  join public.inventory_items item on item.id = orders.item_id
  where orders.id = p_order_id;

  return query select true, 'PIN validado. Entrega registrada correctamente.';
end;
$$;

-- Se evita cerrar un pedido desde el botón antiguo y saltar la validación del PIN.
create or replace function public.complete_customer_order_dispatch(p_order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Para finalizar un retiro, valida primero el PIN del cliente.';
end;
$$;

grant execute on function public.get_my_customer_orders() to authenticated;
grant execute on function public.mark_customer_order_ready(bigint) to authenticated;
grant execute on function public.validate_customer_order_pickup_pin(bigint, text) to authenticated;
grant execute on function public.complete_customer_order_dispatch(bigint) to authenticated;
notify pgrst, 'reload schema';
