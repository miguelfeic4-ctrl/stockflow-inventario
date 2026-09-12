-- Bitácora de trazabilidad. Ejecuta después de las demás migraciones.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);
create index if not exists audit_log_entity_idx on public.audit_log(entity_type, entity_id);

create or replace function public.write_audit_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare row_data jsonb; action_name text;
begin
  if tg_op = 'DELETE' then row_data = to_jsonb(old); else row_data = to_jsonb(new); end if;
  action_name = lower(tg_table_name) || '_' || lower(tg_op);
  insert into public.audit_log(actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), action_name, tg_table_name,
    coalesce(row_data->>'id', row_data->>'ticket_id'),
    row_data - 'password' - 'encrypted_password'
  );
  return coalesce(new, old);
end; $$;

drop trigger if exists audit_inventory_items on public.inventory_items;
create trigger audit_inventory_items after insert or update or delete on public.inventory_items
for each row execute procedure public.write_audit_log();
drop trigger if exists audit_inventory on public.inventory;
create trigger audit_inventory after insert or update or delete on public.inventory
for each row execute procedure public.write_audit_log();
drop trigger if exists audit_inventory_movements on public.inventory_movements;
create trigger audit_inventory_movements after insert or update or delete on public.inventory_movements
for each row execute procedure public.write_audit_log();
drop trigger if exists audit_tickets on public.tickets;
create trigger audit_tickets after insert or update or delete on public.tickets
for each row execute procedure public.write_audit_log();
drop trigger if exists audit_ticket_messages on public.ticket_messages;
create trigger audit_ticket_messages after insert or update or delete on public.ticket_messages
for each row execute procedure public.write_audit_log();

alter table public.audit_log enable row level security;
drop policy if exists "admins read audit log" on public.audit_log;
create policy "admins read audit log" on public.audit_log for select using (public.is_admin());
