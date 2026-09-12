-- Ejecuta después de auth_tickets_migration.sql.
-- Añade respuestas, resolución y denegación de tickets.
alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.tickets add constraint tickets_status_check check (status in ('abierto','en_proceso','resuelto','cerrado','rechazado'));

create table if not exists public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id bigint not null references public.tickets(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index if not exists ticket_messages_ticket_idx on public.ticket_messages(ticket_id, created_at);

create or replace function public.can_access_ticket(ticket_id_to_check bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tickets where id = ticket_id_to_check and (created_by = auth.uid() or public.is_staff()));
$$;

alter table public.ticket_messages enable row level security;
drop policy if exists "ticket participants read messages" on public.ticket_messages;
drop policy if exists "ticket participants create messages" on public.ticket_messages;
create policy "ticket participants read messages" on public.ticket_messages for select using (public.can_access_ticket(ticket_id));
create policy "ticket participants create messages" on public.ticket_messages for insert with check (sender_id = auth.uid() and public.can_access_ticket(ticket_id));

create or replace function public.touch_ticket()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  if new.status in ('resuelto','cerrado','rechazado') and old.status not in ('resuelto','cerrado','rechazado') then new.resolved_at = now(); end if;
  return new;
end; $$;
