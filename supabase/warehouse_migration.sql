-- Ejecutar UNA VEZ después de schema.sql e import_data_csv.sql.
-- Extiende el inventario con almacenes, racks, posiciones y reservas de INBOUND.
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.racks (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  unique(warehouse_id, code)
);

create table if not exists public.rack_positions (
  id uuid primary key default gen_random_uuid(),
  rack_id uuid not null references public.racks(id) on delete cascade,
  code text not null,
  capacity integer not null default 1 check (capacity > 0),
  created_at timestamptz not null default now(),
  unique(rack_id, code)
);

alter table public.inventory add column if not exists position_id uuid references public.rack_positions(id) on delete set null;
create unique index if not exists inventory_one_item_per_position on public.inventory(position_id) where position_id is not null;

alter table public.inventory_movements add column if not exists source_position_id uuid references public.rack_positions(id) on delete set null;
alter table public.inventory_movements add column if not exists destination_position_id uuid references public.rack_positions(id) on delete set null;
alter table public.inventory_movements add column if not exists executed_at timestamptz;

create table if not exists public.position_reservations (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.rack_positions(id) on delete cascade,
  movement_id uuid not null unique references public.inventory_movements(id) on delete cascade,
  status text not null default 'reservada' check (status in ('reservada', 'ejecutada', 'cancelada')),
  created_at timestamptz not null default now()
);
create unique index if not exists one_active_reservation_per_position
  on public.position_reservations(position_id) where status = 'reservada';

alter table public.warehouses enable row level security;
alter table public.racks enable row level security;
alter table public.rack_positions enable row level security;
alter table public.position_reservations enable row level security;
drop policy if exists "demo warehouses" on public.warehouses;
drop policy if exists "demo racks" on public.racks;
drop policy if exists "demo rack_positions" on public.rack_positions;
drop policy if exists "demo position_reservations" on public.position_reservations;
create policy "demo warehouses" on public.warehouses for all using (true) with check (true);
create policy "demo racks" on public.racks for all using (true) with check (true);
create policy "demo rack_positions" on public.rack_positions for all using (true) with check (true);
create policy "demo position_reservations" on public.position_reservations for all using (true) with check (true);

-- Normaliza las ubicaciones del CSV en tres almacenes y crea sus racks/posiciones.
insert into public.warehouses(name)
select distinct case
  when replace(lower(trim(ubicacion)), 'é', 'e') like '%bodega b%' then 'Bodega B'
  when replace(lower(trim(ubicacion)), 'é', 'e') like '%bodega c%' then 'Bodega C'
  else 'Almacén A' end
from public.import_inventory_csv
on conflict(name) do nothing;

insert into public.racks(warehouse_id, code)
select distinct w.id, upper(regexp_replace(trim(c.rack), '\\s+', '-', 'g'))
from public.import_inventory_csv c
join public.warehouses w on w.name = case
  when replace(lower(trim(c.ubicacion)), 'é', 'e') like '%bodega b%' then 'Bodega B'
  when replace(lower(trim(c.ubicacion)), 'é', 'e') like '%bodega c%' then 'Bodega C'
  else 'Almacén A' end
where nullif(trim(c.rack), '') is not null
on conflict(warehouse_id, code) do nothing;

insert into public.rack_positions(rack_id, code)
select distinct r.id, upper(trim(c.posicion))
from public.import_inventory_csv c
join public.warehouses w on w.name = case
  when replace(lower(trim(c.ubicacion)), 'é', 'e') like '%bodega b%' then 'Bodega B'
  when replace(lower(trim(c.ubicacion)), 'é', 'e') like '%bodega c%' then 'Bodega C'
  else 'Almacén A' end
join public.racks r on r.warehouse_id = w.id and r.code = upper(regexp_replace(trim(c.rack), '\\s+', '-', 'g'))
where nullif(trim(c.posicion), '') is not null
on conflict(rack_id, code) do nothing;

update public.inventory inv set position_id = pos.id
from public.import_inventory_csv c
join public.inventory_items item on item.sku = upper(trim(c.sku))
join public.warehouses w on w.name = case
  when replace(lower(trim(c.ubicacion)), 'é', 'e') like '%bodega b%' then 'Bodega B'
  when replace(lower(trim(c.ubicacion)), 'é', 'e') like '%bodega c%' then 'Bodega C'
  else 'Almacén A' end
join public.racks r on r.warehouse_id = w.id and r.code = upper(regexp_replace(trim(c.rack), '\\s+', '-', 'g'))
join public.rack_positions pos on pos.rack_id = r.id and pos.code = upper(trim(c.posicion))
where inv.item_id = item.id;

-- Crea una orden pendiente y, para INBOUND, reserva la posición antes de recibir mercancía.
create or replace function public.create_warehouse_movement(
  p_inventory_id uuid, p_movement_type text, p_quantity integer, p_reason text,
  p_notes text default null, p_destination_position_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare m_id uuid; source_id uuid;
begin
  if p_movement_type not in ('entrada', 'salida', 'ajuste') then raise exception 'Tipo de movimiento inválido'; end if;
  if p_quantity <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  select position_id into source_id from inventory where id = p_inventory_id;
  if not found then raise exception 'Inventario no encontrado'; end if;
  if p_movement_type = 'entrada' and p_destination_position_id is null then raise exception 'Selecciona una posición para la entrada'; end if;
  insert into inventory_movements(item_id, inventory_id, movement_type, quantity, reason, notes, source_position_id, destination_position_id)
  select item_id, id, p_movement_type, p_quantity, p_reason, p_notes, source_id, p_destination_position_id from inventory where id = p_inventory_id
  returning id into m_id;
  if p_movement_type = 'entrada' then
    if exists(select 1 from inventory where position_id = p_destination_position_id) then raise exception 'La posición ya está ocupada'; end if;
    insert into position_reservations(position_id, movement_id) values (p_destination_position_id, m_id);
  end if;
  return m_id;
end; $$;

-- Reemplaza la aprobación para ejecutar físicamente la orden y liberar/ocupar espacios.
create or replace function public.approve_inventory_movement(movement_uuid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.inventory_movements; new_quantity integer;
begin
  select * into m from inventory_movements where id = movement_uuid for update;
  if not found then raise exception 'Movimiento no encontrado'; end if;
  if m.status <> 'pendiente' then raise exception 'El movimiento ya fue procesado'; end if;
  select quantity + case m.movement_type when 'entrada' then m.quantity when 'salida' then -m.quantity else m.quantity end into new_quantity from inventory where id = m.inventory_id for update;
  if new_quantity < 0 then raise exception 'Stock insuficiente para aprobar la salida'; end if;
  if m.movement_type = 'entrada' then
    update inventory set quantity = new_quantity, position_id = coalesce(position_id, m.destination_position_id), updated_at = now() where id = m.inventory_id;
    update position_reservations set status = 'ejecutada' where movement_id = m.id;
  elsif m.movement_type = 'salida' then
    update inventory set quantity = new_quantity, position_id = case when new_quantity = 0 then null else position_id end, updated_at = now() where id = m.inventory_id;
  else update inventory set quantity = new_quantity, updated_at = now() where id = m.inventory_id; end if;
  update inventory_movements set status = 'aprobado', approved_at = now(), executed_at = now() where id = m.id;
end; $$;

create or replace function public.reject_inventory_movement(movement_uuid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update inventory_movements set status = 'rechazado' where id = movement_uuid and status = 'pendiente';
  if not found then raise exception 'El movimiento ya fue procesado o no existe'; end if;
  update position_reservations set status = 'cancelada' where movement_id = movement_uuid and status = 'reservada';
end; $$;

grant execute on function public.create_warehouse_movement(uuid,text,integer,text,text,uuid) to anon, authenticated;
grant execute on function public.approve_inventory_movement(uuid) to anon, authenticated;
grant execute on function public.reject_inventory_movement(uuid) to anon, authenticated;
