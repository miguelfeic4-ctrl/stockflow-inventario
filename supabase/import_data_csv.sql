-- PASO 1: ejecuta este bloque en Supabase SQL Editor.
-- PASO 2: en Table Editor importa data.csv dentro de la tabla import_inventory_csv.
-- Todas las columnas se guardan primero como texto porque el CSV contiene fechas y mayúsculas inconsistentes.
create table if not exists public.import_inventory_csv (
  producto text, stock text, proveedor text, sku text, tipo_movimiento text,
  rack text, talla text, fecha_movimiento text, categoria text,
  cantidad_movimiento text, ubicacion text, estado text, marca text,
  posicion text, stock_minimo text
);

-- PASO 3: después de importar el CSV, ejecuta este bloque UNA SOLA VEZ.
-- Crea artículos, su stock actual y un movimiento histórico por cada fila del CSV.
insert into public.inventory_items
  (sku, name, description, category, price, cost, supplier)
select distinct on (upper(trim(sku)))
  upper(trim(sku)), trim(producto),
  concat_ws(' · ', nullif(trim(marca), ''), nullif(trim(talla), '') || ' EU'),
  initcap(lower(trim(categoria))), 0, 0, nullif(trim(proveedor), '')
from public.import_inventory_csv
where nullif(trim(sku), '') is not null and nullif(trim(producto), '') is not null
order by upper(trim(sku)), sku
on conflict (sku) do update set
  name = excluded.name, description = excluded.description,
  category = excluded.category, supplier = excluded.supplier;

insert into public.inventory (item_id, quantity, location, min_stock, max_stock)
select i.id,
  greatest(coalesce(nullif(trim(c.stock), '')::integer, 0), 0),
  coalesce(nullif(trim(c.ubicacion), ''), 'Almacén principal'),
  greatest(coalesce(nullif(trim(c.stock_minimo), '')::integer, 0), 0),
  null
from public.import_inventory_csv c
join public.inventory_items i on i.sku = upper(trim(c.sku))
on conflict (item_id) do update set
  quantity = excluded.quantity, location = excluded.location,
  min_stock = excluded.min_stock, updated_at = now();

insert into public.inventory_movements
  (item_id, inventory_id, movement_type, quantity, reason, status, created_at, approved_at, notes)
select i.id, inv.id,
  case when lower(trim(c.tipo_movimiento)) in ('inbound', 'entrada') then 'entrada'
       when lower(trim(c.tipo_movimiento)) in ('outbound', 'salida') then 'salida'
       else 'ajuste' end,
  greatest(coalesce(nullif(trim(c.cantidad_movimiento), '')::integer, 1), 1),
  'Movimiento histórico importado',
  case lower(trim(c.estado)) when 'aprobado' then 'aprobado' when 'rechazado' then 'rechazado' else 'pendiente' end,
  case
    when trim(c.fecha_movimiento) ~ '^\\d{4}-\\d{2}-\\d{2}$' then trim(c.fecha_movimiento)::timestamptz
    when trim(c.fecha_movimiento) ~ '^\\d{4}/\\d{2}/\\d{2}$' then to_date(trim(c.fecha_movimiento), 'YYYY/MM/DD')::timestamptz
    when trim(c.fecha_movimiento) ~ '^\\d{2}/\\d{2}/\\d{4}$' then to_date(trim(c.fecha_movimiento), 'DD/MM/YYYY')::timestamptz
    when trim(c.fecha_movimiento) ~ '^\\d{2}-\\d{2}-\\d{4}$' then to_date(trim(c.fecha_movimiento), 'DD-MM-YYYY')::timestamptz
    when trim(c.fecha_movimiento) ~ '^\\d{2}/\\d{2}/\\d{2}$' then to_date(trim(c.fecha_movimiento), 'DD/MM/YY')::timestamptz
    else now() end,
  case when lower(trim(c.estado)) = 'aprobado' then now() else null end,
  concat('Rack: ', coalesce(c.rack, '—'), ' | Posición: ', coalesce(c.posicion, '—'))
from public.import_inventory_csv c
join public.inventory_items i on i.sku = upper(trim(c.sku))
join public.inventory inv on inv.item_id = i.id;

-- Verificación: deben salir 20 artículos, 20 inventarios y 20 movimientos para el CSV entregado.
select 'inventory_items' as tabla, count(*) as registros from public.inventory_items
union all select 'inventory', count(*) from public.inventory
union all select 'inventory_movements', count(*) from public.inventory_movements;
