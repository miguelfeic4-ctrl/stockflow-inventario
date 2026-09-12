-- Ejecuta este archivo después de warehouse_migration.sql.
-- Conserva los 20 artículos importados y agrega 80; al final tendrás 100 SKU.
-- Puedes ejecutarlo más de una vez: no duplica SKU ni posiciones.
begin;

alter table public.inventory_items add column if not exists box_length_cm numeric(6,2) check (box_length_cm is null or box_length_cm > 0);
alter table public.inventory_items add column if not exists box_width_cm numeric(6,2) check (box_width_cm is null or box_width_cm > 0);

-- Completa costo, precio y medidas de caja de los artículos originales.
update public.inventory_items
set cost = 145 + (abs(hashtext(sku)) % 120),
    price = 269 + (abs(hashtext(sku)) % 180),
    box_length_cm = 31 + (abs(hashtext(sku)) % 5),
    box_width_cm = 20 + (abs(hashtext(sku)) % 3)
where sku like 'ZAP-%';

insert into public.warehouses(name, description) values
  ('Almacén La Victoria', 'Av. Aviación 1840, La Victoria, Lima (dirección ficticia)'),
  ('Almacén Lurín', 'Carretera Antigua Panamericana Sur km 31, Lurín, Lima (dirección ficticia)'),
  ('Almacén Los Olivos', 'Av. Universitaria 5930, Los Olivos, Lima (dirección ficticia)')
on conflict (name) do update set description = excluded.description;

-- Cinco racks de ocho espacios por almacén: 120 posiciones en total.
insert into public.racks(warehouse_id, code)
select w.id, 'R-' || lpad(r::text, 2, '0')
from public.warehouses w cross join generate_series(1, 5) r
on conflict (warehouse_id, code) do nothing;

insert into public.rack_positions(rack_id, code)
select r.id, 'P-' || lpad(p::text, 2, '0')
from public.racks r cross join generate_series(1, 8) p
on conflict (rack_id, code) do nothing;

with catalog as (
  select n,
    (array['Nike','Adidas','Puma','New Balance','Asics','Reebok','Vans','Converse','Under Armour','Fila'])[((n - 1) % 10) + 1] as brand,
    (array['Velocity Pro','Aero Flex','Street Runner','Court Motion','Cloud Pace','Urban Sprint','Trail Force','Classic Rise'])[((n - 1) % 8) + 1] as model,
    (array['Running','Training','Casual','Lifestyle','Trail'])[((n - 1) % 5) + 1] as category,
    (array['Proveedor Andino','Importadora Lima','Sport House','Nike Perú','Adidas Perú'])[((n - 1) % 5) + 1] as supplier
  from generate_series(21, 100) n
)
insert into public.inventory_items (sku, name, description, category, supplier, cost, price, box_length_cm, box_width_cm, length, width, height)
select 'ZAP-' || lpad(n::text, 3, '0'), brand || ' ' || model,
  brand || ' · Talla ' || (38 + (n % 8)) || ' EU', category, supplier,
  145 + (n % 120), 269 + (n % 180), 31 + (n % 5), 20 + (n % 3),
  28 + (n % 4), 10 + (n % 3), 11 + (n % 3)
from catalog
on conflict (sku) do update set
  name = excluded.name, description = excluded.description, category = excluded.category,
  supplier = excluded.supplier, cost = excluded.cost, price = excluded.price,
  box_length_cm = excluded.box_length_cm, box_width_cm = excluded.box_width_cm;

with free_positions as (
  select p.id, row_number() over (order by w.name, r.code, p.code) as rn
  from public.rack_positions p
  join public.racks r on r.id = p.rack_id
  join public.warehouses w on w.id = r.warehouse_id
  where not exists (select 1 from public.inventory i where i.position_id = p.id)
), new_items as (
  select i.id, row_number() over (order by i.sku) as rn
  from public.inventory_items i where i.sku between 'ZAP-021' and 'ZAP-100'
)
insert into public.inventory(item_id, quantity, location, min_stock, max_stock, position_id)
select n.id, 18 + (n.rn % 65), w.name, 8 + (n.rn % 10), 120, p.id
from new_items n join free_positions p on p.rn = n.rn
join public.rack_positions rp on rp.id = p.id
join public.racks r on r.id = rp.rack_id
join public.warehouses w on w.id = r.warehouse_id
on conflict (item_id) do nothing;

commit;

-- Debe devolver: productos 100, inventario 100, almacenes 3.
select 'productos' as indicador, count(*) as cantidad from public.inventory_items
union all select 'inventario', count(*) from public.inventory
union all select 'almacenes', count(*) from public.warehouses
union all select 'racks', count(*) from public.racks
union all select 'posiciones', count(*) from public.rack_positions;
