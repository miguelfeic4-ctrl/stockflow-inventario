// Cliente de Supabase y datos que se mantienen en memoria mientras la página está abierta.
const url = window.SUPABASE_URL,
  key = window.SUPABASE_ANON_KEY,
  db =
    url && key && !url.includes("TU-PROYECTO")
      ? window.supabase.createClient(url, key)
      : null;
const dashboardParams = new URLSearchParams(window.location.search);
if (dashboardParams.get("embedded") === "1")
  document.body.classList.add("embedded-dashboard");
let items = [],
  movements = [],
  positions = [];
const $ = (s) => document.querySelector(s),
  money = (n) =>
    new Intl.NumberFormat("es-PE", {
      style: "currency",
      currency: "PEN",
    }).format(n || 0),
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
    );
// Contexto temporal del tablero para distinguir rápidamente la jornada operativa.
const dashboardDate = $("#dashboard-date");
if (dashboardDate)
  dashboardDate.textContent = new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
// Muestra un mensaje breve en la esquina inferior derecha.
function toast(m) {
  const e = $("#toast");
  e.textContent = m;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 3200);
}
// Convierte errores técnicos de Supabase en mensajes comprensibles.
function error(e) {
  return e?.message?.includes("duplicate key")
    ? "El SKU ya existe."
    : e?.message || "Ocurrió un error inesperado.";
}
// Clasifica un artículo según su stock mínimo configurado.
function state(x) {
  return x.inventory.quantity <= x.inventory.min_stock ? "low" : "ok";
}
// Construye la etiqueta legible de una posición: almacén · rack · posición.
function label(p) {
  return `${p.racks?.warehouses?.name || "Almacén"} · ${p.racks?.code || "Rack"} · ${p.code}`;
}
// Actualiza métricas, filtros, tablas y opciones de los formularios.
function draw() {
  const stock = items.reduce((a, x) => a + x.inventory.quantity, 0),
    low = items.filter((x) => state(x) === "low"),
    value = items.reduce((a, x) => a + x.inventory.quantity * x.cost, 0);
  $("#total-items").textContent = items.length;
  $("#total-stock").textContent = stock;
  $("#low-stock").textContent = low.length;
  $("#inventory-value").textContent = money(value);
  const cats = [...new Set(items.map((x) => x.category).filter(Boolean))],
    sup = [...new Set(items.map((x) => x.supplier).filter(Boolean))];
  $("#category-filter").innerHTML =
    '<option value="">Todas las categorías</option>' +
    cats.map((x) => `<option>${esc(x)}</option>`).join("");
  $("#supplier-filter").innerHTML =
    '<option value="">Todos los proveedores</option>' +
    sup.map((x) => `<option>${esc(x)}</option>`).join("");
  inventory();
  moves();
  recent();
  warehouse();
  $("#movement-item").innerHTML = items
    .map(
      (x) =>
        `<option value="${x.inventory.id}">${esc(x.sku)} — ${esc(x.name)} (stock: ${x.inventory.quantity})</option>`,
    )
    .join("");
  const free = positions.filter((p) => !p.inventory && !p.reserved);
  $("#destination-position").innerHTML =
    '<option value="">Selecciona posición libre…</option>' +
    free
      .map((p) => `<option value="${p.id}">${esc(label(p))}</option>`)
      .join("");
  $("#item-position").innerHTML =
    '<option value="">Sin asignar</option>' +
    positions
      .map(
        (p) =>
          `<option value="${p.id}" ${p.inventory ? "disabled" : ""}>${esc(label(p))}${p.inventory ? " · ocupada" : ""}</option>`,
      )
      .join("");
}
// Filtra y pinta la tabla principal de artículos.
function inventory() {
  const q = $("#search").value.toLowerCase(),
    c = $("#category-filter").value,
    p = $("#supplier-filter").value,
    s = $("#stock-filter").value,
    shown = items.filter(
      (x) =>
        (!q ||
          x.name.toLowerCase().includes(q) ||
          x.sku.toLowerCase().includes(q)) &&
        (!c || x.category === c) &&
        (!p || x.supplier === p) &&
        (!s || state(x) === s),
    );
  $("#item-count").textContent =
    `${shown.length} artículo${shown.length !== 1 ? "s" : ""}`;
  $("#inventory-table").innerHTML = shown.length
    ? shown
        .map(
          (x) =>
            `<tr><td><strong class="sku-pill">${esc(x.sku)}</strong></td><td><strong>${esc(x.name)}</strong><small>${esc(x.description || "Sin descripción")}</small><small class="box-size">Caja ${x.box_length_cm || "—"} × ${x.box_width_cm || "—"} cm</small></td><td>${esc(x.category)}</td><td><strong>${x.inventory.quantity}</strong><small>mín. ${x.inventory.min_stock}</small></td><td>${money(x.cost)}</td><td>${money(x.price)}</td><td>${esc(x.supplier || "—")}</td><td><span class="status ${state(x)}">${state(x) === "low" ? "Stock bajo" : "Óptimo"}</span></td><td><div class="row-actions"><button class="icon-btn" onclick="editItem('${x.id}')">✎</button><button class="icon-btn danger" onclick="deleteItem('${x.id}')">⌫</button></div></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="9" class="empty">No se encontraron artículos.</td></tr>';
}
// Pinta las órdenes y movimientos; permite aprobar o rechazar pendientes.
function moves() {
  $("#movement-table").innerHTML = movements.length
    ? movements
        .map(
          (m) =>
            `<tr><td>${new Date(m.created_at).toLocaleDateString("es-PE")}</td><td><strong>${esc(m.inventory_items?.sku || "—")}</strong><small>${esc(m.inventory_items?.name || "—")}</small></td><td><span class="type ${m.movement_type}">${m.movement_type}</span></td><td><strong>${m.movement_type === "salida" ? "-" : "+"}${m.quantity}</strong></td><td>${esc(m.reason)}${m.supplier_name ? `<small>Proveedor: ${esc(m.supplier_name)}${m.expected_at ? ` · ETA: ${new Date(m.expected_at).toLocaleDateString("es-PE")}` : ""}</small>` : ""}</td><td><span class="status ${m.status}">${m.status}</span></td><td>${m.status === "pendiente" ? `<div class="row-actions"><button class="icon-btn" onclick="processMovement('${m.id}','approve')">✓</button><button class="icon-btn danger" onclick="processMovement('${m.id}','reject')">×</button></div>` : "—"}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="7" class="empty">Aún no hay movimientos.</td></tr>';
}
// Muestra los cinco movimientos más recientes en el resumen.
function recent() {
  $("#recent-movements").innerHTML =
    movements
      .slice(0, 5)
      .map(
        (m) =>
          `<div class="recent-row"><span class="round">${m.movement_type === "entrada" ? "↓" : m.movement_type === "salida" ? "↑" : "↔"}</span><div><strong>${esc(m.inventory_items?.name || "Artículo")}</strong><small>${esc(m.reason)} · ${new Date(m.created_at).toLocaleDateString("es-PE")}</small></div><span class="status ${m.status}">${m.movement_type} ${m.quantity}</span></div>`,
      )
      .join("") || '<p class="empty">No hay movimientos aún.</p>';
}
// Agrupa las posiciones físicas por almacén y rack para dibujar el mapa.
function warehouse() {
  const reserved = new Set(
    positions.filter((p) => p.reserved).map((p) => p.id),
  );
  $("#position-total").textContent = positions.length;
  $("#position-occupied").textContent = positions.filter(
    (p) => p.inventory,
  ).length;
  $("#position-reserved").textContent = reserved.size;
  const groups = {};
  positions.forEach((p) => {
    const w = p.racks?.warehouses?.name || "Sin almacén",
      r = p.racks?.code || "Sin rack";
    ((groups[w] ??= {})[r] ??= []).push(p);
  });
  $("#warehouse-map").innerHTML = positions.length
    ? '<div class="legend"><span><i></i>Libre</span><span><i class="occ"></i>Ocupada</span><span><i class="res"></i>Reservada</span></div>' +
      Object.entries(groups)
        .map(
          ([w, racks]) =>
            `<div class="warehouse-group"><h3>${esc(w)}</h3><p class="warehouse-address">${esc(Object.values(racks)[0]?.[0]?.racks?.warehouses?.description || "Dirección no registrada")}</p><div class="rack-grid">${Object.entries(
              racks,
            )
              .map(
                ([rack, slots]) =>
                  `<article class="rack-card"><h4>${esc(rack)}</h4><div class="position-grid">${slots
                    .map((p) => {
                      const inv = Array.isArray(p.inventory)
                          ? p.inventory[0]
                          : p.inventory,
                        cls = inv ? "occupied" : p.reserved ? "reserved" : "";
                      const label = inv
                        ? inv.inventory_items?.sku || "ocupada"
                        : p.dispatch
                          ? `DESP-${String(p.dispatch.customer_orders?.id || "").padStart(6, "0")}`
                          : p.reserved
                            ? "reservada"
                            : "";
                      return `<button type="button" class="position ${cls}" onclick="openPositionDetail('${p.id}')">${esc(p.code)}${label ? `<small>${esc(label)}</small>` : ""}</button>`;
                    })
                    .join("")}</div></article>`,
              )
              .join("")}</div></div>`,
        )
        .join("")
    : '<p class="empty">Ejecuta la migración de almacén para visualizar las posiciones.</p>';
}
// Abre el detalle de una posición al hacer clic en el mapa físico.
window.openPositionDetail = (positionId) => {
  const position = positions.find((item) => item.id === positionId);
  if (!position) return;
  const inventory = Array.isArray(position.inventory)
    ? position.inventory[0]
    : position.inventory;
  let dialog = document.querySelector("#position-detail-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "position-detail-dialog";
    dialog.className = "position-detail-dialog";
    document.body.append(dialog);
  }
  const title = label(position);
  const content = inventory
    ? `<p class="eyebrow">INVENTARIO OCUPANDO LA POSICIÓN</p><h2>${esc(inventory.inventory_items?.name || "Producto")}</h2><p><strong>SKU:</strong> ${esc(inventory.inventory_items?.sku || "—")}</p><p><strong>Stock:</strong> ${inventory.quantity} unidades</p>`
    : position.dispatch
      ? `<p class="eyebrow">PEDIDO EN PREPARACIÓN</p><h2>DESP-${String(position.dispatch.customer_orders?.id || "").padStart(6, "0")}</h2><p>Esta posición está reservada para retiro o despacho.</p>`
      : position.reserved
        ? '<p class="eyebrow">RESERVA INBOUND</p><h2>Posición reservada</h2><p>Esperando recepción de mercadería.</p>'
        : '<p class="eyebrow">POSICIÓN DISPONIBLE</p><h2>Espacio libre</h2><p>Disponible para INBOUND o preparación de pedido.</p>';
  dialog.innerHTML = `<div class="modal-head"><div><p class="eyebrow">${esc(title)}</p><h2>Detalle de posición</h2></div><button class="close" type="button" onclick="document.querySelector('#position-detail-dialog').close()">×</button></div><div class="position-detail-content">${content}</div><div class="modal-actions"><button class="primary" type="button" onclick="document.querySelector('#position-detail-dialog').close()">Cerrar</button></div>`;
  dialog.showModal();
};
// Consulta Supabase y prepara los datos que utiliza toda la interfaz.
async function load() {
  if (!db) return;
  const [a, m] = await Promise.all([
    db
      .from("inventory_items")
      .select("*, inventory(*)")
      .order("created_at", { ascending: false }),
    db
      .from("inventory_movements")
      .select("*, inventory_items(sku,name)")
      .order("created_at", { ascending: false }),
  ]);
  if (a.error || m.error) {
    toast(error(a.error || m.error));
    return;
  }
  items = a.data
    .map((x) => ({
      ...x,
      inventory: Array.isArray(x.inventory) ? x.inventory[0] : x.inventory,
    }))
    .filter((x) => x.inventory);
  movements = m.data;
  const p = await db
    .from("rack_positions")
    .select(
      "id,code,racks(code,warehouses(name,description)),inventory(id,quantity,inventory_items(sku,name)),position_reservations(status)",
    )
    .order("code");
  positions = p.error
    ? []
    : p.data.map((x) => ({
        ...x,
        inventory: Array.isArray(x.inventory) ? x.inventory[0] : x.inventory,
        reserved: (x.position_reservations || []).some(
          (r) => r.status === "reservada",
        ),
      }));
  // Las posiciones de pedidos aprobados son reservas de despacho, no inventario base.
  const dispatches = await db
    .from("customer_order_fulfillments")
    .select("position_id,status,customer_orders(id)")
    .eq("status", "reservado");
  if (!dispatches.error) {
    const byPosition = Object.fromEntries(
      dispatches.data.map((dispatch) => [dispatch.position_id, dispatch]),
    );
    positions.forEach((position) => {
      const dispatch = byPosition[position.id];
      if (dispatch) {
        position.reserved = true;
        position.dispatch = dispatch;
      }
    });
  }
  $("#connection").textContent = "● Conectado a Supabase";
  $("#connection").classList.add("ready");
  draw();
  if (p.error)
    toast(
      "Inventario conectado. Ejecuta warehouse_migration.sql para habilitar el mapa de almacén.",
    );
}
// Abre el formulario para crear un artículo o cargar uno existente para editarlo.
function open(item) {
  const f = $("#item-form");
  f.reset();
  if (item) {
    $("#item-modal-title").textContent = "Editar artículo";
    Object.entries({ ...item, ...item.inventory, id: item.id }).forEach(
      ([k, v]) => f.elements[k] && (f.elements[k].value = v ?? ""),
    );
    if (item.inventory.position_id)
      f.elements.position_id.value = item.inventory.position_id;
  } else $("#item-modal-title").textContent = "Nuevo artículo";
  $("#item-modal").showModal();
}
// Funciones expuestas a los botones que se generan dentro de la tabla HTML.
window.editItem = (id) => open(items.find((x) => x.id === id));
window.deleteItem = async (id) => {
  const x = items.find((x) => x.id === id);
  if (!confirm(`¿Eliminar “${x.name}”? También se eliminarán sus movimientos.`))
    return;
  const { error: e } = await db.from("inventory_items").delete().eq("id", id);
  if (e) toast(error(e));
  else {
    toast("Artículo eliminado");
    load();
  }
};
window.processMovement = async (id, action) => {
  const { error: e } = await db.rpc(
    action === "approve"
      ? "approve_inventory_movement"
      : "reject_inventory_movement",
    { movement_uuid: id },
  );
  if (e) toast(error(e));
  else {
    toast(
      action === "approve"
        ? "Movimiento aprobado y stock actualizado"
        : "Movimiento rechazado",
    );
    load();
  }
};
// Navegación entre las vistas del centro operativo, también cuando está integrado al portal.
function activateOperationalView(view) {
  const button = document.querySelector(`.nav[data-view="${view}"]`);
  if (!button) return;
  document
    .querySelectorAll(".nav,.view")
    .forEach((element) => element.classList.remove("active"));
  button.classList.add("active");
  $("#" + view).classList.add("active");
  $("#page-title").textContent = {
    dashboard: "Resumen de inventario",
    inventory: "Inventario",
    movements: "Movimientos",
    warehouse: "Mapa del almacén",
  }[view];
  $("#primary-action").style.display =
    view === "movements" || view === "warehouse" ? "none" : "";
}
document
  .querySelectorAll(".nav")
  .forEach(
    (button) =>
      (button.onclick = () => activateOperationalView(button.dataset.view)),
  );
activateOperationalView(dashboardParams.get("view") || "dashboard");
if (dashboardParams.get("audit") === "1") {
  document.body.classList.add("audit-only");
}
if (dashboardParams.get("summary") === "1") {
  document.body.classList.add("summary-only");
}
document
  .querySelectorAll("[data-go]")
  .forEach(
    (b) =>
      (b.onclick = () => $('.nav[data-view="' + b.dataset.go + '"]').click()),
  );
$("#primary-action").onclick = () => open();
$("#quick-new-item")?.addEventListener("click", () => open());
$("#quick-new-movement")?.addEventListener("click", () =>
  $("#movement-modal").showModal(),
);
$("#new-movement").onclick = () => $("#movement-modal").showModal();
document
  .querySelectorAll(".close")
  .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
["search", "category-filter", "supplier-filter", "stock-filter"].forEach((id) =>
  $("#" + id).addEventListener(id === "search" ? "input" : "change", inventory),
);
// Guarda los datos maestros del artículo y su registro de inventario asociado.
$("#item-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target,
    d = Object.fromEntries(new FormData(f)),
    id = d.id;
  delete d.id;
  const inv = {
    quantity: +d.quantity,
    min_stock: +d.min_stock,
    location: d.location,
    position_id: d.position_id || null,
  };
  delete d.quantity;
  delete d.min_stock;
  delete d.location;
  delete d.position_id;
  for (const k of [
    "weight",
    "length",
    "width",
    "height",
    "price",
    "cost",
    "box_length_cm",
    "box_width_cm",
    "size_eu",
  ])
    d[k] = d[k] === "" ? null : +d[k];
  let r = id
    ? await db.from("inventory_items").update(d).eq("id", id)
    : await db.from("inventory_items").insert(d).select().single();
  if (r.error) {
    toast(error(r.error));
    return;
  }
  const invId = id ? items.find((x) => x.id === id).inventory.id : null;
  r = id
    ? await db.from("inventory").update(inv).eq("id", invId)
    : await db.from("inventory").insert({ ...inv, item_id: r.data.id });
  if (r.error) {
    toast(error(r.error));
    return;
  }
  f.closest("dialog").close();
  toast("Artículo guardado");
  load();
});
// Crea una orden de almacén pendiente; el stock cambia solo al aprobarla.
$("#movement-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target)),
    { error: err } = await db.rpc("create_warehouse_movement", {
      p_inventory_id: d.inventory_id,
      p_movement_type: d.movement_type,
      p_quantity: +d.quantity,
      p_reason: d.reason,
      p_notes: d.notes || null,
      p_destination_position_id: d.destination_position_id || null,
      p_supplier_name: d.supplier_name || null,
      p_expected_at: d.expected_at || null,
    });
  if (err) {
    toast(error(err));
    return;
  }
  e.target.closest("dialog").close();
  toast("Orden creada como pendiente");
  load();
});
// Primera carga de datos al abrir el dashboard.
load();
