-- Ejecuta este archivo si el registro mostró “Database error saving new user”.
-- Repara el trigger que crea el perfil al registrar un usuario.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, 'usuario'), '@', 1)), 'cliente')
  on conflict (id) do update set full_name = excluded.full_name;
  return new;
exception when others then
  raise exception 'No se pudo crear el perfil del usuario: %', sqlerrm;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

grant usage on schema public to anon, authenticated;
grant select, insert on public.tickets to authenticated;
grant select on public.profiles to authenticated;
