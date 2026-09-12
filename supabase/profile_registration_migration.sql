-- Ejecuta una vez para ampliar el perfil con datos del registro de cliente.
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists dni text;
alter table public.profiles add column if not exists phone text;

create unique index if not exists profiles_dni_unique
  on public.profiles(dni) where dni is not null;

-- El trigger se ejecuta dentro de Supabase al crear el usuario y asigna siempre rol cliente.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  first_name_value text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), '');
  last_name_value text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'last_name', '')), '');
begin
  insert into public.profiles (id, full_name, first_name, last_name, dni, phone, role)
  values (
    new.id,
    coalesce(nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''), concat_ws(' ', first_name_value, last_name_value), split_part(new.email, '@', 1)),
    first_name_value,
    last_name_value,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'dni', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    'cliente'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
