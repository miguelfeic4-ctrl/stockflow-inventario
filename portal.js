// Conexión, sesión actual, perfil de rol y tickets visibles en el portal.
const db =
  window.SUPABASE_URL && window.SUPABASE_ANON_KEY
    ? window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY,
      )
    : null;
let me = null,
  profile = null,
  tickets = [],
  activeClientView = "overview",
  activeAdminView = "dashboard";
const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>'"]/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[c],
    ),
  staff = () => ["administrador", "operador"].includes(profile?.role);
// Escribe los mensajes de inicio de sesión y registro en el formulario.
const msg = (t) => ($("#auth-message").textContent = t);
// Estilos específicos creados dinámicamente para tickets y ubicación por SKU.
const style = document.createElement("style");
style.textContent =
  ".ticket-actions{display:flex;gap:5px;margin-top:8px}.ticket-actions button{border:0;border-radius:6px;padding:5px 7px;cursor:pointer;font:700 11px DM Sans}.reply{background:#d9f8ff;color:#07536a}.approve{background:#d9f9e9;color:#096b43}.deny{background:#ffe0e4;color:#8d2635}.conversation{width:min(620px,calc(100% - 28px));border:1px solid #3ce7ff70;border-radius:16px;background:#071426;color:#eef7ff;box-shadow:0 24px 70px #000b}.conversation::backdrop{background:#010817b8}.conversation form{display:grid;gap:14px;padding:24px}.conversation h2{color:#fff}.conversation label{color:#c9ddf7;font-size:12px;font-weight:700}.conversation textarea{min-height:82px;border:1px solid #50749d;background:#0c2039;color:#f4f9ff}.conversation textarea::placeholder{color:#92aac6}.thread{display:grid;gap:10px;max-height:300px;overflow:auto;padding:10px;border:1px solid #28496d;border-radius:12px;background:#050f20}.bubble{border:1px solid #345a85;border-radius:12px;padding:11px 13px;background:#132a49;color:#f2f7ff;font-size:12px;line-height:1.55}.bubble.staff{border-color:#39cfc5;background:#104653;color:#f4ffff}.bubble strong,.bubble small{display:block}.bubble strong{margin-bottom:4px;color:#fff;font-weight:800}.bubble small{font-size:10px;color:#a9d0f6;margin-top:6px}.bubble.staff small{color:#a9f3e5}.conversation .actions{display:flex;justify-content:flex-end;gap:9px}.conversation .secondary{border:1px solid #4d6f95;border-radius:8px;padding:10px;background:#152d4c;color:#eaf5ff;cursor:pointer}.pickup-card{margin:0 0 20px;padding:21px;border-radius:15px;background:linear-gradient(125deg,#214e77,#287e94);color:#fff;box-shadow:0 12px 28px #1b557126}.pickup-card .eyebrow{margin:0 0 6px;color:#beeaf2}.pickup-card h2{font-size:18px}.pickup-card p{margin:6px 0 15px;font-size:12px;color:#e2f5f7}.pickup-form{display:flex;gap:8px}.pickup-form input{flex:1;border:0}.pickup-result{margin-top:13px;padding:12px;border-radius:9px;background:#ffffff1c;font-size:12px;line-height:1.55}.pickup-result strong{display:block;font-size:14px}.pickup-result.error{background:#842f3a88}@media(max-width:550px){.pickup-form{flex-direction:column}}";
document.head.append(style);
// Comprueba si ya existe una sesión de Supabase al abrir el portal.
async function boot() {
  if (!db) {
    msg("Configura config.js antes de ingresar.");
    return;
  }
  const {
    data: { session },
  } = await db.auth.getSession();
  if (session) {
    me = session.user;
    await showPortal();
  }
}
// Carga el perfil, aplica el rol y muestra el portal después del inicio de sesión.
async function showPortal() {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", me.id)
    .single();
  if (error) {
    msg(error.message);
    return;
  }
  profile = data;
  $("#auth-card").hidden = true;
  $("#portal").hidden = false;
  $("#user-name").textContent = profile.full_name;
  $("#user-role").textContent = profile.role;
  $("#avatar").textContent = profile.full_name[0].toUpperCase();
  $("#portal-title").textContent =
    profile.role === "cliente" ? "Mi panel" : "Bandeja global de tickets";
  $("#owner-head").style.display = profile.role === "cliente" ? "none" : "";
  // La tienda y el dashboard con vistas separadas son exclusivos de clientes.
  $("#open-catalog").hidden = true;
  if (profile.role === "administrador") setupAdminDashboard();
  else if (staff()) adminNav();
  else setupClientDashboard();
  addPickupFinder();
  addNotifications();
  await loadTickets();
  if (window.initStore) await window.initStore();
}

// Convierte el portal del cliente en un dashboard de vistas claras y separadas.
function setupClientDashboard() {
  const menu = $("#portal-menu");
  if (!menu.querySelector("[data-view]")) {
    menu.innerHTML = `<p class="menu-label">MI ESPACIO</p><button class="menu-item" data-view="overview"><span>◈</span>Resumen</button><button class="menu-item" data-view="purchases"><span>◌</span>Mis compras</button><button class="menu-item" data-view="tickets"><span>✉</span>Mis tickets</button><button class="menu-item" data-view="locator"><span>⌖</span>Ubicar producto</button><a class="menu-item menu-catalog" href="catalog.html"><span>▦</span>Catálogo</a>`;
    menu.querySelectorAll("button[data-view]").forEach((button) => {
      button.onclick = () => setClientView(button.dataset.view);
    });
  }
  if (!$("#client-overview")) {
    const overview = document.createElement("section");
    overview.id = "client-overview";
    overview.className = "client-overview client-view";
    overview.dataset.clientView = "overview";
    overview.innerHTML = `<div class="overview-welcome"><div><p class="eyebrow">PANEL PERSONAL</p><h2>Hola, ${esc(profile.full_name.split(" ")[0])}</h2><p>Consulta tus pedidos, coordina soporte y encuentra productos desde un solo lugar.</p></div><div class="overview-orbit">✦</div></div><div class="overview-shortcuts"><button data-go="purchases"><span>◌</span><strong>Mis compras</strong><small>Estado y retiro</small></button><button data-go="tickets"><span>✉</span><strong>Soporte</strong><small>Tickets y respuestas</small></button><button data-go="locator"><span>⌖</span><strong>Ubicar producto</strong><small>Almacén y rack</small></button></div>`;
    $("article header").after(overview);
    overview.querySelectorAll("[data-go]").forEach((button) => {
      button.onclick = () => setClientView(button.dataset.go);
    });
  }
  setClientView(activeClientView);
}

// Muestra únicamente la sección solicitada, manteniendo los datos ya cargados.
function setClientView(view) {
  activeClientView = view;
  window.activeClientView = view;
  const labels = {
    overview: ["PANEL DE CLIENTE", "Mi panel"],
    purchases: ["HISTORIAL Y RETIRO", "Mis compras"],
    tickets: ["CENTRO DE SOPORTE", "Mis tickets"],
    locator: ["RETIRO PRESENCIAL", "Ubicar producto"],
  };
  document.querySelectorAll("[data-client-view]").forEach((section) => {
    section.hidden = section.dataset.clientView !== view;
  });
  $("#portal-title").textContent = labels[view]?.[1] || "Mi panel";
  $("article header .eyebrow").textContent =
    labels[view]?.[0] || "PANEL DE CLIENTE";
  $("#portal-menu")
    .querySelectorAll("button[data-view]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view),
    );
}
window.setClientView = setClientView;

// El administrador reúne tickets, compras e inventario dentro de un solo portal.
// El centro operativo se carga incrustado para conservar todas sus funciones actuales.
function setupAdminDashboard() {
  const menu = $("#portal-menu");
  if (!menu.querySelector("[data-admin-view]")) {
    menu.innerHTML = `<p class="menu-label">CONTROL TOTAL</p><button class="menu-item" data-admin-view="dashboard"><span>◈</span>Dashboard</button><button class="menu-item" data-admin-view="summary"><span>▦</span>Resumen</button><button class="menu-item" data-admin-view="inventory"><span>▣</span>Inventario</button><button class="menu-item" data-admin-view="movements"><span>⇄</span>Movimientos</button><button class="menu-item" data-admin-view="warehouse"><span>⌘</span>Almacén</button><p class="menu-label menu-label-second">ATENCIÓN</p><button class="menu-item" data-admin-view="purchases"><span>◌</span>Solicitudes de compra</button><button class="menu-item" data-admin-view="tickets"><span>✉</span>Tickets</button><button class="menu-item" data-admin-view="locator"><span>⌖</span>Ubicar producto</button><button class="menu-item" data-admin-view="audit"><span>≡</span>Bitácora</button>`;
    menu.querySelectorAll("[data-admin-view]").forEach((button) => {
      button.onclick = () => setAdminView(button.dataset.adminView);
    });
  }
  if (!$("#admin-operation-host")) {
    const host = document.createElement("section");
    host.id = "admin-operation-host";
    host.className = "admin-operation-host";
    host.innerHTML =
      '<iframe id="admin-operation-frame" title="Centro operativo StockFlow"></iframe>';
    $("article").append(host);
  }
  if (!$("#admin-company-dashboard")) {
    const dashboard = document.createElement("section");
    dashboard.id = "admin-company-dashboard";
    dashboard.className = "admin-company-dashboard";
    dashboard.dataset.adminView = "dashboard";
    $("article").append(dashboard);
  }
  $(".summary").dataset.adminView = "tickets";
  $("#tickets-panel").dataset.adminView = "tickets";
  setAdminView(activeAdminView);
}

// Cambia de módulo sin enviar al administrador a otra página del sistema.
function setAdminView(view) {
  activeAdminView = view;
  window.activeAdminView = view;
  const embeddedViews = [
    "summary",
    "inventory",
    "movements",
    "warehouse",
    "audit",
  ];
  const labels = {
    dashboard: ["PANORAMA DE LA EMPRESA", "Dashboard"],
    summary: ["RESUMEN OPERATIVO", "Resumen"],
    inventory: ["GESTIÓN DE EXISTENCIAS", "Inventario"],
    movements: ["INBOUND Y OUTBOUND", "Movimientos"],
    warehouse: ["MAPA FÍSICO", "Almacén"],
    purchases: ["VENTAS Y DESPACHO", "Solicitudes de compra"],
    tickets: ["CENTRO DE SOPORTE", "Tickets globales"],
    locator: ["RETIRO PRESENCIAL", "Ubicar producto"],
    audit: ["TRAZABILIDAD", "Bitácora de operaciones"],
  };
  document.querySelectorAll("[data-admin-view]").forEach((section) => {
    if (section.matches("button")) return;
    section.hidden = section.dataset.adminView !== view;
  });
  const host = $("#admin-operation-host");
  if (host) {
    host.hidden = !embeddedViews.includes(view);
    if (embeddedViews.includes(view)) {
      const frame = $("#admin-operation-frame");
      const target =
        view === "audit"
          ? "dashboard&audit=1"
          : view === "summary"
            ? "dashboard&summary=1"
            : view;
      const nextUrl = `index.html?embedded=1&view=${target}`;
      if (frame.dataset.view !== view) {
        frame.src = nextUrl;
        frame.dataset.view = view;
      }
    }
  }
  $("#portal-title").textContent = labels[view]?.[1] || "Centro de control";
  $("article header .eyebrow").textContent =
    labels[view]?.[0] || "CENTRO DE CONTROL";
  const menu = $("#portal-menu");
  menu
    .querySelectorAll("button[data-admin-view]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.adminView === view),
    );
  if (view === "dashboard") renderAdminCompanyDashboard();
}
window.setAdminView = setAdminView;

// Gráfico ejecutivo: resume el volumen reciente de pedidos sin mezclar otros módulos.
function renderAdminCompanyDashboard() {
  const dashboard = $("#admin-company-dashboard");
  if (!dashboard) return;
  const orders = window.adminOrderSnapshot || [];
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return date;
  });
  const amounts = days.map(
    (day) =>
      orders.filter((order) => {
        const created = new Date(order.created_at);
        created.setHours(0, 0, 0, 0);
        return created.getTime() === day.getTime();
      }).length,
  );
  const max = Math.max(...amounts, 1);
  const delivered = orders.filter(
    (order) => order.status === "entregado",
  ).length;
  dashboard.innerHTML = `<section class="company-chart"><div class="company-chart-head"><div><p class="eyebrow">RENDIMIENTO COMERCIAL</p><h2>Solicitudes de compra · últimos 7 días</h2><p>El gráfico se actualiza con las solicitudes registradas en el sistema.</p></div><div class="company-chart-total"><strong>${orders.length}</strong><span>solicitudes<br>totales</span></div></div><div class="chart-area">${amounts.map((amount, index) => `<div class="chart-column"><span class="chart-value">${amount || ""}</span><i style="height:${Math.max((amount / max) * 100, amount ? 10 : 3)}%"></i><small>${days[index].toLocaleDateString("es-PE", { weekday: "short" }).replace(".", "")}</small></div>`).join("")}</div><footer class="company-chart-foot"><span><i></i> Solicitudes registradas</span><span>${delivered} pedido${delivered !== 1 ? "s" : ""} entregado${delivered !== 1 ? "s" : ""}</span></footer></section>`;
}
window.renderAdminCompanyDashboard = renderAdminCompanyDashboard;
// Notificaciones internas: compras nuevas para personal y cambios de estado para el cliente.
function addNotifications() {
  if (document.querySelector("#notifications-button")) return;
  const button = document.createElement("button");
  button.id = "notifications-button";
  button.className = "secondary notifications-button";
  button.innerHTML =
    '<span class="notification-bell">♢</span><span>Avisos</span><b class="notification-count" hidden>0</b>';
  button.onclick = openNotifications;
  document.querySelector(".portal-actions").prepend(button);
  loadNotifications();
}
async function loadNotifications() {
  const button = document.querySelector("#notifications-button");
  if (!button) return;
  const { data, error } = await db
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return;
  window.portalNotifications = data;
  const unread = data.filter((notification) => !notification.read_at).length;
  const count = button.querySelector(".notification-count");
  count.hidden = !unread;
  count.textContent = unread > 9 ? "9+" : unread;
}
function notificationDialog() {
  let dialog = document.querySelector("#notifications-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "notifications-dialog";
  dialog.className = "conversation notifications-dialog";
  document.body.append(dialog);
  return dialog;
}
async function openNotifications() {
  await loadNotifications();
  const dialog = notificationDialog();
  const notifications = window.portalNotifications || [];
  const unread = notifications.filter(
    (notification) => !notification.read_at,
  ).length;
  dialog.innerHTML = `<section class="notifications-shell"><header class="notification-head"><div class="notification-title"><span class="notification-head-icon">✦</span><div><p class="eyebrow">CENTRO DE AVISOS</p><h2>Notificaciones</h2><p>${unread ? `${unread} aviso${unread !== 1 ? "s" : ""} nuevo${unread !== 1 ? "s" : ""}` : "Todo está al día"}</p></div></div><button type="button" class="close" aria-label="Cerrar avisos" onclick="document.querySelector('#notifications-dialog').close()">×</button></header><div class="notification-list">${notifications.length ? notifications.map((notification) => `<article class="notification-item ${notification.read_at ? "" : "unread"}"><span class="notification-item-icon">${notification.read_at ? "✓" : "✦"}</span><div><strong>${esc(notification.title)}</strong><p>${esc(notification.body)}</p><time>${new Date(notification.created_at).toLocaleString("es-PE")}</time></div>${notification.read_at ? "" : '<span class="new-dot" title="Nuevo"></span>'}</article>`).join("") : '<div class="notification-empty"><span>✦</span><strong>No tienes avisos pendientes</strong><p>Te avisaremos aquí cuando haya movimientos importantes.</p></div>'}</div><footer class="notification-footer"><span>Los avisos se marcan como leídos al abrirlos.</span><button class="secondary" onclick="document.querySelector('#notifications-dialog').close()">Listo</button></footer></section>`;
  const unreadIds = notifications
    .filter((notification) => !notification.read_at)
    .map((notification) => notification.id);
  if (unreadIds.length)
    await db
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", unreadIds);
  dialog.showModal();
  await loadNotifications();
}
// Añade el acceso al centro operativo para operador y administrador.
function adminNav() {
  const header = $("article header"),
    button = document.createElement("a");
  button.href = "index.html";
  button.className = "primary";
  button.textContent = "▦ Centro de inventario";
  header.append(button);
}
// Inserta el buscador de ubicación de producto por código SKU.
function addPickupFinder() {
  if ($("#pickup-finder")) return;
  const section = document.createElement("section");
  section.id = "pickup-finder";
  section.className =
    "pickup-card" + (profile?.role === "cliente" ? " client-view" : "");
  if (profile?.role === "cliente") section.dataset.clientView = "locator";
  if (profile?.role === "cliente")
    section.hidden = activeClientView !== "locator";
  if (profile?.role === "administrador") {
    section.dataset.adminView = "locator";
    section.hidden = activeAdminView !== "locator";
  }
  section.innerHTML =
    '<p class="eyebrow">RETIRO PRESENCIAL</p><h2>Ubicar un producto</h2><p>Ingresa el código SKU del producto para conocer su ubicación exacta.</p><form class="pickup-form" id="pickup-form"><input name="product_code" required placeholder="Ej. ZAP-001" autocomplete="off"><button class="primary">Ubicar producto</button></form><div id="pickup-result" aria-live="polite"></div>';
  $("article").insertBefore(section, $(".summary"));
  $("#pickup-form").onsubmit = locateProduct;
}
// Llama a la función segura de Supabase y muestra almacén, rack y posición.
async function locateProduct(e) {
  e.preventDefault();
  const code = new FormData(e.target).get("product_code"),
    result = $("#pickup-result");
  result.className = "pickup-result";
  result.textContent = "Buscando ubicación…";
  const { data, error } = await db.rpc("locate_product_by_code", {
    p_code: code,
  });
  if (error) {
    result.className = "pickup-result error";
    result.textContent =
      "No se pudo consultar el producto. Ejecuta public_product_locator_migration.sql.";
    return;
  }
  const product = data?.[0];
  if (!product) {
    result.className = "pickup-result error";
    result.textContent = "No encontramos un producto con ese código.";
    return;
  }
  result.innerHTML = `<strong>${esc(product.product_name)} · ${esc(product.sku)}</strong>Almacén: <b>${esc(product.warehouse || "Sin ubicación")}</b><br>Rack: <b>${esc(product.rack || "—")}</b> · Posición: <b>${esc(product.position_code || "—")}</b><br>Stock disponible: <b>${product.available_quantity}</b>`;
}
// Descarga los tickets visibles según las políticas RLS del rol actual.
async function loadTickets() {
  const { data, error } = await db
    .from("tickets")
    .select("*, profiles!tickets_created_by_fkey(full_name)")
    .order("created_at", { ascending: false });
  if (error) {
    alert(error.message);
    return;
  }
  tickets = data;
  render();
}
// Actualiza contadores, filtro y tabla de seguimiento de solicitudes.
function render() {
  const filter = $("#status-filter").value,
    shown = tickets.filter((t) => !filter || t.status === filter);
  $("#open-count").textContent = tickets.filter(
    (t) => t.status === "abierto",
  ).length;
  $("#progress-count").textContent = tickets.filter(
    (t) => t.status === "en_proceso",
  ).length;
  $("#resolved-count").textContent = tickets.filter((t) =>
    ["resuelto", "cerrado", "rechazado"].includes(t.status),
  ).length;
  $("#ticket-list").innerHTML = shown.length
    ? shown
        .map(
          (t) =>
            `<tr><td><strong>TK-${String(t.id).padStart(5, "0")}</strong></td><td><strong>${esc(t.title)}</strong><small>${esc(t.description)}</small><div class="ticket-actions"><button class="reply" onclick="openConversation(${t.id})">${staff() ? "✉ Responder" : "Ver respuesta"}</button>${staff() && t.status !== "resuelto" && t.status !== "rechazado" ? `<button class="approve" onclick="setStatus(${t.id},'resuelto')">✓ Resolver</button><button class="deny" onclick="setStatus(${t.id},'rechazado')">× Denegar</button>` : ""}</div></td><td>${esc(t.category)}</td><td><span class="tag">${esc(t.priority)}</span></td><td><span class="tag ${t.status}">${esc(t.status.replace("_", " "))}</span></td><td>${new Date(t.created_at).toLocaleDateString("es-PE")}</td><td style="${profile.role === "cliente" ? "display:none" : ""}">${esc(t.profiles?.full_name || "—")}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="7">No hay tickets para este filtro.</td></tr>';
}
// Crea una sola ventana reutilizable para la conversación de un ticket.
function dialog() {
  let d = $("#conversation-dialog");
  if (d) return d;
  d = document.createElement("dialog");
  d.id = "conversation-dialog";
  d.className = "conversation";
  document.body.append(d);
  return d;
}
// Abre el historial de mensajes; el personal puede responder al solicitante.
window.openConversation = async (id) => {
  const ticket = tickets.find((t) => t.id === id),
    d = dialog();
  const { data: messages, error } = await db
    .from("ticket_messages")
    .select("*, profiles!ticket_messages_sender_id_fkey(full_name,role)")
    .eq("ticket_id", id)
    .order("created_at");
  if (error) {
    alert("Ejecuta ticket_workflow_migration.sql: " + error.message);
    return;
  }
  d.innerHTML = `<form id="conversation-form"><div class="dialog-head"><div><p class="eyebrow">TK-${String(id).padStart(5, "0")}</p><h2>${esc(ticket.title)}</h2></div><button type="button" class="close" onclick="document.querySelector('#conversation-dialog').close()">×</button></div><div class="thread">${messages.length ? messages.map((m) => `<div class="bubble ${m.profiles?.role === "cliente" ? "" : "staff"}"><strong>${esc(m.profiles?.full_name || "Usuario")} · ${esc(m.profiles?.role || "")}</strong>${esc(m.body)}<small>${new Date(m.created_at).toLocaleString("es-PE")}</small></div>`).join("") : '<p class="muted">Aún no hay respuestas.</p>'}</div>${staff() ? '<label>Respuesta<textarea name="body" required placeholder="Escribe una respuesta clara para el solicitante."></textarea></label><div class="actions"><button type="button" class="secondary" onclick="document.querySelector(\'#conversation-dialog\').close()">Cancelar</button><button class="primary">Enviar respuesta</button></div>' : '<div class="actions"><button type="button" class="secondary" onclick="document.querySelector(\'#conversation-dialog\').close()">Cerrar</button></div>'}</form>`;
  if (staff())
    $("#conversation-form").onsubmit = async (e) => {
      e.preventDefault();
      const body = new FormData(e.target).get("body");
      const { error } = await db
        .from("ticket_messages")
        .insert({ ticket_id: id, sender_id: me.id, body });
      if (error) {
        alert(error.message);
        return;
      }
      if (ticket.status === "abierto")
        await db.from("tickets").update({ status: "en_proceso" }).eq("id", id);
      d.close();
      await loadTickets();
    };
  d.showModal();
};
// Resuelve o deniega un ticket. Solo operador y administrador ven estos botones.
window.setStatus = async (id, status) => {
  if (
    !confirm(
      `¿Deseas ${status === "resuelto" ? "resolver" : "denegar"} este ticket?`,
    )
  )
    return;
  const { error } = await db.from("tickets").update({ status }).eq("id", id);
  if (error) {
    alert(error.message);
    return;
  }
  await loadTickets();
};
// Inicio de sesión con correo y contraseña mediante Supabase Auth.
$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const { data, error } = await db.auth.signInWithPassword({
    email: d.email,
    password: d.password,
  });
  if (error) {
    msg("No se pudo ingresar. Si aún no tienes cuenta, crea una.");
    return;
  }
  me = data.user;
  await showPortal();
});
// Cierra la sesión y vuelve al formulario de acceso.
$("#logout").onclick = async () => {
  await db.auth.signOut();
  location.reload();
};
$("#new-ticket").onclick = () => $("#ticket-dialog").showModal();
$(".close").onclick = () => $("#ticket-dialog").close();
$("#status-filter").onchange = render;
// Registra un nuevo ticket a nombre del usuario autenticado.
$("#ticket-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const { error } = await db
    .from("tickets")
    .insert({ ...d, created_by: me.id });
  if (error) {
    alert(error.message);
    return;
  }
  e.target.reset();
  $("#ticket-dialog").close();
  await loadTickets();
});
// Punto de inicio del portal.
boot();
