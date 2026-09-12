-- Atributos comerciales para que el catálogo pueda filtrar zapatillas.
alter table public.inventory_items
  add column if not exists brand text,
  add column if not exists color text,
  add column if not exists size_eu integer check (size_eu is null or size_eu between 30 and 55);

-- Completa los productos ya existentes con datos consistentes de demostración.
update public.inventory_items
set
  brand = coalesce(
    brand,
    case
      when name ilike 'Nike %' then 'Nike'
      when name ilike 'Adidas %' then 'Adidas'
      when name ilike 'Puma %' then 'Puma'
      when name ilike 'New Balance %' then 'New Balance'
      when name ilike 'Under Armour %' then 'Under Armour'
      when name ilike 'Asics %' then 'Asics'
      when name ilike 'Reebok %' then 'Reebok'
      when name ilike 'Converse %' then 'Converse'
      when name ilike 'Vans %' then 'Vans'
      when name ilike 'Fila %' then 'Fila'
      else 'StockFlow'
    end
  ),
  color = coalesce(
    color,
    (array['Negro', 'Blanco', 'Azul', 'Rojo', 'Gris', 'Verde', 'Beige', 'Morado'])[(abs(hashtext(sku)) % 8) + 1]
  ),
  size_eu = coalesce(
    size_eu,
    nullif(substring(coalesce(description, '') from '([0-9]{2})'), '')::integer,
    38 + (abs(hashtext(sku)) % 8)
  );

-- Se recrea la función para exponer los nuevos atributos al catálogo público autenticado.
drop function if exists public.get_store_catalog();

create function public.get_store_catalog()
returns table (
  item_id uuid,
  sku text,
  product_name text,
  description text,
  category text,
  supplier text,
  brand text,
  color text,
  size_eu integer,
  price numeric,
  available_quantity integer
)
language sql
security definer
set search_path = public
as $$
  select
    i.id,
    i.sku,
    i.name,
    i.description,
    i.category,
    i.supplier,
    coalesce(i.brand, 'Sin marca'),
    coalesce(i.color, 'Sin color'),
    i.size_eu,
    i.price,
    inv.quantity
  from public.inventory_items i
  join public.inventory inv on inv.item_id = i.id
  where inv.quantity > 0
  order by i.name;
$$;

grant execute on function public.get_store_catalog() to authenticated;
