-- Ejecuta después de auth_tickets_migration.sql.
-- Restringe el centro operativo a operador y administrador.
drop policy if exists "demo inventory_items" on public.inventory_items;
drop policy if exists "demo inventory" on public.inventory;
drop policy if exists "demo inventory_movements" on public.inventory_movements;
drop policy if exists "demo warehouses" on public.warehouses;
drop policy if exists "demo racks" on public.racks;
drop policy if exists "demo rack_positions" on public.rack_positions;
drop policy if exists "demo position_reservations" on public.position_reservations;

create policy "staff manages inventory items" on public.inventory_items for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manages inventory" on public.inventory for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manages movements" on public.inventory_movements for all using (public.is_staff()) with check (public.is_staff());
create policy "staff reads warehouses" on public.warehouses for select using (public.is_staff());
create policy "staff manages warehouses" on public.warehouses for all using (public.is_admin()) with check (public.is_admin());
create policy "staff reads racks" on public.racks for select using (public.is_staff());
create policy "staff manages racks" on public.racks for all using (public.is_admin()) with check (public.is_admin());
create policy "staff reads rack positions" on public.rack_positions for select using (public.is_staff());
create policy "staff manages rack positions" on public.rack_positions for all using (public.is_admin()) with check (public.is_admin());
create policy "staff reads reservations" on public.position_reservations for select using (public.is_staff());
create policy "staff manages reservations" on public.position_reservations for all using (public.is_admin()) with check (public.is_admin());

revoke execute on function public.create_warehouse_movement(uuid,text,integer,text,text,uuid) from anon;
revoke execute on function public.approve_inventory_movement(uuid) from anon;
revoke execute on function public.reject_inventory_movement(uuid) from anon;
grant execute on function public.create_warehouse_movement(uuid,text,integer,text,text,uuid) to authenticated;
grant execute on function public.approve_inventory_movement(uuid) to authenticated;
grant execute on function public.reject_inventory_movement(uuid) to authenticated;
