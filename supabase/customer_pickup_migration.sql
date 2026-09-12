-- Ejecuta después de warehouse_migration.sql y auth_tickets_migration.sql.
-- Asigna un código de retiro de producto a un cliente.
create table if not exists public.customer_product_assignments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  pickup_code text not null unique check (char_length(trim(pickup_code)) between 4 and 40),
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  unique(customer_id, item_id)
);
create index if not exists customer_product_assignments_customer_idx on public.customer_product_assignments(customer_id, active);

alter table public.customer_product_assignments enable row level security;
drop policy if exists "admins manage product assignments" on public.customer_product_assignments;
create policy "admins manage product assignments" on public.customer_product_assignments
  for all using (public.is_admin()) with check (public.is_admin());

-- Consulta segura: un cliente solo puede ubicar artículos cuyo código le fue asignado.
create or replace function public.locate_my_product(p_pickup_code text)
returns table (
  pickup_code text, sku text, product_name text, warehouse text,
  rack text, position_code text, available_quantity integer
)
language sql stable security definer set search_path = public as $$
  select a.pickup_code, i.sku, i.name, w.name, r.code, p.code, inv.quantity
  from public.customer_product_assignments a
  join public.inventory_items i on i.id = a.item_id
  join public.inventory inv on inv.item_id = i.id
  left join public.rack_positions p on p.id = inv.position_id
  left join public.racks r on r.id = p.rack_id
  left join public.warehouses w on w.id = r.warehouse_id
  where a.customer_id = auth.uid()
    and a.active = true
    and upper(trim(a.pickup_code)) = upper(trim(p_pickup_code));
$$;
grant execute on function public.locate_my_product(text) to authenticated;

-- EJEMPLO DE ASIGNACIÓN (reemplaza correo, SKU y código):
-- insert into public.customer_product_assignments(customer_id, item_id, pickup_code)
-- select p.id, i.id, 'RETIRO-001'
-- from public.profiles p cross join public.inventory_items i
-- where p.id = (select id from auth.users where email = 'cliente@correo.com')
--   and i.sku = 'ZAP-001'
-- on conflict (customer_id, item_id) do update set pickup_code = excluded.pickup_code, active = true;
