-- Portal de usuarios y tickets. Ejecuta una vez en Supabase SQL Editor.
-- Roles: cliente (crea y consulta sus tickets), operador (atiende) y administrador (gestiona todo).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Usuario',
  role text not null default 'cliente' check (role in ('cliente','operador','administrador')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Evita que un cliente se asigne privilegios desde el navegador.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('operador','administrador'));
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'administrador');
$$;

create table if not exists public.tickets (
  id bigint generated always as identity primary key,
  created_by uuid not null references public.profiles(id) on delete cascade,
  assignee_id uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(trim(title)) between 5 and 140),
  description text not null check (char_length(trim(description)) between 10 and 3000),
  category text not null default 'Consulta' check (category in ('Consulta','Pedido','Incidencia','Devolución','Inventario')),
  priority text not null default 'media' check (priority in ('baja','media','alta','urgente')),
  status text not null default 'abierto' check (status in ('abierto','en_proceso','resuelto','cerrado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists tickets_creator_idx on public.tickets(created_by, created_at desc);
create index if not exists tickets_status_idx on public.tickets(status, priority, created_at desc);

create or replace function public.touch_ticket()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  if new.status in ('resuelto','cerrado') and old.status not in ('resuelto','cerrado') then new.resolved_at = now(); end if;
  return new;
end; $$;
drop trigger if exists tickets_updated_at on public.tickets;
create trigger tickets_updated_at before update on public.tickets for each row execute procedure public.touch_ticket();

alter table public.profiles enable row level security;
alter table public.tickets enable row level security;
drop policy if exists "profile own or staff read" on public.profiles;
drop policy if exists "admin updates profiles" on public.profiles;
drop policy if exists "ticket owner or staff reads" on public.tickets;
drop policy if exists "users create own tickets" on public.tickets;
drop policy if exists "staff updates tickets" on public.tickets;
create policy "profile own or staff read" on public.profiles for select using (id = auth.uid() or public.is_staff());
create policy "admin updates profiles" on public.profiles for update using (public.is_admin()) with check (public.is_admin());
create policy "ticket owner or staff reads" on public.tickets for select using (created_by = auth.uid() or public.is_staff());
create policy "users create own tickets" on public.tickets for insert with check (created_by = auth.uid());
create policy "staff updates tickets" on public.tickets for update using (public.is_staff()) with check (public.is_staff());

-- Crea el primer usuario desde portal.html y luego promuévelo manualmente:
-- update public.profiles set role = 'administrador' where id = 'UUID_DEL_USUARIO';
