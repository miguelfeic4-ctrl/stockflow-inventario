// Bitácora visible exclusivamente para administradores dentro del centro operativo.
// Consulta las últimas operaciones registradas para la auditoría administrativa.
// Consulta las últimas acciones auditadas y las traduce a etiquetas comprensibles.
async function renderAdminAuditLog() {
  if (!db) return;
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return;
  const { data: profile } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "administrador") return;
  let section = $("#admin-audit-log");
  if (!section) {
    section = document.createElement("section");
    section.id = "admin-audit-log";
    section.className = "panel admin-audit-log";
    $("#dashboard").append(section);
  }
  const { data: entries, error } = await db
    .from("audit_log")
    .select("*, profiles!audit_log_actor_id_fkey(full_name,role)")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) {
    section.innerHTML =
      '<p class="empty">Ejecuta audit_log_migration.sql para habilitar la bitácora.</p>';
    return;
  }
  const label = (a) =>
    ({
      inventory_items_insert: "Artículo creado",
      inventory_items_update: "Artículo actualizado",
      inventory_items_delete: "Artículo eliminado",
      inventory_insert: "Stock creado",
      inventory_update: "Stock actualizado",
      inventory_movements_insert: "Movimiento creado",
      inventory_movements_update: "Movimiento procesado",
      tickets_insert: "Ticket creado",
      tickets_update: "Ticket actualizado",
      ticket_messages_insert: "Respuesta enviada",
      customer_orders_insert: "Compra solicitada",
      customer_orders_update: "Compra revisada",
      customer_order_delivered: "Producto entregado",
      customer_order_messages_insert: "Mensaje de compra enviado",
    })[a] || a.replaceAll("_", " ");
  const record = (entry) =>
    entry.action === "customer_order_delivered"
      ? `${entry.details?.order_code || `DESP-${String(entry.entity_id || "").padStart(6, "0")}`} · ${entry.details?.product_name || "Producto"} (${entry.details?.quantity || 0} un.)`
      : entry.entity_id || "—";
  section.innerHTML = `<div class="panel-title"><div><p class="eyebrow">TRAZABILIDAD · SOLO ADMINISTRADOR</p><h2>Bitácora de operaciones</h2><p>Últimas ${entries.length} acciones registradas en el sistema.</p></div><button class="secondary" id="refresh-audit-log">Actualizar</button></div><div class="table-wrap"><table><thead><tr><th>FECHA</th><th>ACCIÓN</th><th>USUARIO</th><th>TIPO</th><th>REGISTRO</th></tr></thead><tbody>${entries.length ? entries.map((e) => `<tr><td>${new Date(e.created_at).toLocaleString("es-PE")}</td><td><strong>${esc(label(e.action))}</strong></td><td>${esc(e.profiles?.full_name || "Sistema")}<small>${esc(e.profiles?.role || "")}</small></td><td>${esc(e.entity_type)}</td><td>${esc(record(e))}</td></tr>`).join("") : '<tr><td colspan="5" class="empty">No hay acciones registradas todavía.</td></tr>'}</tbody></table></div>`;
  $("#refresh-audit-log").onclick = renderAdminAuditLog;
}
// Inserta la bitácora cuando el DOM y el dashboard estén disponibles.
window.addEventListener("load", renderAdminAuditLog);
