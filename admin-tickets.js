// Bandeja exclusiva del administrador dentro del centro operativo.
// Consulta y dibuja todos los tickets; la verificación previa impide verlo a otros roles.
// Consulta los tickets globales y crea/actualiza el panel exclusivo de administrador.
async function renderAdminTicketCenter() {
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
  let section = $("#admin-ticket-center");
  if (!section) {
    section = document.createElement("section");
    section.id = "admin-ticket-center";
    section.className = "panel admin-ticket-center";
    $("#dashboard").append(section);
  }
  const { data: tickets, error } = await db
    .from("tickets")
    .select("*, profiles!tickets_created_by_fkey(full_name)")
    .order("created_at", { ascending: false });
  if (error) {
    section.innerHTML =
      '<p class="empty">No se pudieron cargar los tickets.</p>';
    return;
  }
  section.innerHTML = `<div class="panel-title"><div><p class="eyebrow">SOPORTE GLOBAL · SOLO ADMINISTRADOR</p><h2>Tickets de clientes y equipo</h2><p>${tickets.length} solicitud${tickets.length !== 1 ? "es" : ""} registrada${tickets.length !== 1 ? "s" : ""} en el sistema.</p></div><button class="secondary" id="refresh-admin-tickets">Actualizar</button></div><div class="table-wrap"><table><thead><tr><th>CÓDIGO</th><th>SOLICITANTE / DETALLE</th><th>CATEGORÍA</th><th>PRIORIDAD</th><th>ESTADO</th><th>FECHA</th></tr></thead><tbody>${tickets.length ? tickets.map((t) => `<tr><td><strong class="sku-pill">TK-${String(t.id).padStart(5, "0")}</strong></td><td><strong>${esc(t.title)}</strong><small>${esc(t.profiles?.full_name || "Usuario")} · ${esc(t.description)}</small></td><td>${esc(t.category)}</td><td><span class="status ${t.priority === "urgente" || t.priority === "alta" ? "low" : "ok"}">${esc(t.priority)}</span></td><td><span class="status ${t.status === "resuelto" || t.status === "cerrado" ? "ok" : t.status === "abierto" ? "low" : "pendiente"}">${esc(t.status.replace("_", " "))}</span></td><td>${new Date(t.created_at).toLocaleDateString("es-PE")}</td></tr>`).join("") : '<tr><td colspan="6" class="empty">Aún no hay tickets registrados.</td></tr>'}</tbody></table></div>`;
  $("#refresh-admin-tickets").onclick = renderAdminTicketCenter;
}
// Espera a que el dashboard cargue antes de insertar la bandeja.
window.addEventListener("load", renderAdminTicketCenter);
