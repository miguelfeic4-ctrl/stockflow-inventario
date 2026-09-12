-- Ejecuta este archivo en Supabase: SQL Editor > New query.
create extension if not exists "pgcrypto";

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (char_length(trim(sku)) > 0),
  name text not null check (char_length(trim(name)) > 0),
  description text,
  category text not null default 'Sin categoría',
  weight numeric(10,2) check (weight is null or weight >= 0),
  length numeric(10,2) check (length is null or length >= 0),
  width numeric(10,2) check (width is null or width >= 0),
  height numeric(10,2) check (height is null or height >= 0),
  price numeric(12,2) not null default 0 check (price >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  supplier text,
  created_at timestamptz not null default now()
);

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.inventory_items(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  location text not null default 'Almacén principal',
  min_stock integer not null default 0 check (min_stock >= 0),
  max_stock integer check (max_stock is null or max_stock >= min_stock),
  updated_at timestamptz not null default now()
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  inventory_id uuid not null references public.inventory(id) on delete cascade,
  movement_type text not null check (movement_type in ('entrada', 'salida', 'ajuste')),
  quantity integer not null check (quantity > 0),
  reason text not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobado', 'rechazado')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  notes text
);

create index inventory_items_category_idx on public.inventory_items(category);
create index inventory_items_supplier_idx on public.inventory_items(supplier);
create index inventory_movements_status_created_idx on public.inventory_movements(status, created_at desc);

-- Aprueba atómicamente un movimiento y actualiza el stock una sola vez.
create or replace function public.approve_inventory_movement(movement_uuid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.inventory_movements;
  new_quantity integer;
begin
  select * into m from public.inventory_movements where id = movement_uuid for update;
  if not found then raise exception 'Movimiento no encontrado'; end if;
  if m.status <> 'pendiente' then raise exception 'El movimiento ya fue procesado'; end if;
  select quantity + case m.movement_type when 'entrada' then m.quantity when 'salida' then -m.quantity else m.quantity end
    into new_quantity from public.inventory where id = m.inventory_id for update;
  if new_quantity < 0 then raise exception 'Stock insuficiente para aprobar la salida'; end if;
  update public.inventory set quantity = new_quantity, updated_at = now() where id = m.inventory_id;
  update public.inventory_movements set status = 'aprobado', approved_at = now() where id = m.id;
end; $$;

create or replace function public.reject_inventory_movement(movement_uuid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.inventory_movements set status = 'rechazado'
  where id = movement_uuid and status = 'pendiente';
  if not found then raise exception 'El movimiento ya fue procesado o no existe'; end if;
end; $$;

-- DEMO: permite usar la app sin autenticación. Para producción sustituye por políticas basadas en auth.uid().
alter table public.inventory_items enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_movements enable row level security;
create policy "demo inventory_items" on public.inventory_items for all using (true) with check (true);
create policy "demo inventory" on public.inventory for all using (true) with check (true);
create policy "demo inventory_movements" on public.inventory_movements for all using (true) with check (true);
grant execute on function public.approve_inventory_movement(uuid) to anon, authenticated;
grant execute on function public.reject_inventory_movement(uuid) to anon, authenticated;
