// Catálogo, compras y conversación de cada compra. Usa RPCs para mantener el stock seguro.
let catalogItems = [],
  customerOrders = [],
  customerStoreWarning = "";
const storeStaff = () => ["administrador", "operador"].includes(profile?.role);
// El portal se carga sin app.js, por eso su formato de moneda debe vivir aquí.
const storeMoney = (value) =>
  new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
  }).format(value || 0);

// Inserta el módulo de compras en el portal y lo enlaza con la vista/rol actual.
window.initStore = async function initStore() {
  if (!profile || document.querySelector("#store-module")) return;
  const section = document.createElement("section");
  section.id = "store-module";
  section.className =
    "store-module" + (profile?.role === "cliente" ? " client-view" : "");
  if (profile?.role === "cliente") section.dataset.clientView = "purchases";
  if (profile?.role === "cliente")
    section.hidden = window.activeClientView !== "purchases";
  if (profile?.role === "administrador") {
    section.dataset.adminView = "purchases";
    section.hidden = window.activeAdminView !== "purchases";
  }
  document
    .querySelector("article")
    .insertBefore(section, document.querySelector(".summary"));
  await loadStore();
};

// Decide si debe cargar el historial personal del cliente o la bandeja global del personal.
async function loadStore() {
  if (storeStaff()) await loadStaffOrders();
  else await loadCustomerStore();
}

async function loadCustomerStore() {
  // El historial no depende del catálogo: una compra creada siempre debe verse aquí.
  let { data, error } = await db.rpc("get_my_customer_orders");
  customerStoreWarning = "";
  // Compatibilidad temporal si aún no se ejecutó la migración del resumen.
  if (error) {
    const summaryError = error.message;
    const fallback = await db
      .from("customer_orders")
      .select("*, inventory_items(sku,name)")
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
    if (!error)
      customerStoreWarning = `Vista básica cargada. Para ver producto y ubicación de recojo, ejecuta purchase_pickup_location_repair.sql en Supabase (${summaryError}).`;
  }
  if (error) {
    document.querySelector("#store-module").innerHTML =
      `<section class="panel"><p class="empty">No se pudo cargar tu historial: ${esc(error.message)}. Ejecuta customer_orders_summary_migration.sql.</p></section>`;
    return;
  }
  // Las relaciones de Supabase pueden llegar como objeto o arreglo según la política RLS.
  data.forEach((order) => {
    const item = Array.isArray(order.inventory_items)
      ? order.inventory_items[0]
      : order.inventory_items;
    if (item) {
      order.product_name ??= item.name;
      order.sku ??= item.sku;
    }
  });
  customerOrders = data;
  renderCustomerStore();
}

// Conecta una orden aprobada con la posición donde fue preparada.
async function attachDispatches(orders) {
  const orderIds = orders.map((order) => order.id);
  if (!orderIds.length) return;
  const { data, error } = await db
    .from("customer_order_fulfillments")
    .select("order_id,status,rack_positions(code,racks(code,warehouses(name)))")
    .in("order_id", orderIds);
  if (error) return;
  const dispatchByOrder = Object.fromEntries(
    data.map((dispatch) => [dispatch.order_id, dispatch]),
  );
  orders.forEach((order) => (order.dispatch = dispatchByOrder[order.id]));
}

// Construye el panel "Mis compras" después de recibir los datos del cliente.
function renderCustomerStore() {
  addCatalogButton();
  document.querySelector("#store-module").innerHTML = `
    <section class="panel purchases-panel"><div class="panel-title"><div><p class="eyebrow">HISTORIAL PERSONAL</p><h2>Mis compras</h2></div><button class="secondary" id="refresh-purchases">Actualizar</button></div>${customerStoreWarning ? `<p class="store-warning">${esc(customerStoreWarning)}</p>` : ""}<div id="purchase-list" class="purchase-list"></div></section>`;
  document.querySelector("#refresh-purchases").onclick = loadCustomerStore;
  renderPurchases();
}

// Abre la tienda como ventana independiente, igual que el formulario de tickets.
function addCatalogButton() {
  if (document.querySelector("#open-catalog")) return;
  const button = document.createElement("button");
  button.id = "open-catalog";
  button.className = "secondary catalog-button";
  button.textContent = "◈ Ver catálogo";
  button.onclick = openCatalog;
  document.querySelector("article header").append(button);
}

// Reutiliza un solo diálogo para no crear ventanas duplicadas de catálogo.
function getCatalogDialog() {
  let dialog = document.querySelector("#catalog-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "catalog-dialog";
    dialog.className = "catalog-dialog";
    document.body.append(dialog);
  }
  return dialog;
}

// Dibuja el catálogo emergente y conecta sus filtros locales.
function openCatalog() {
  const categories = [...new Set(catalogItems.map((item) => item.category))];
  const dialog = getCatalogDialog();
  dialog.innerHTML = `<div class="catalog-modal-head"><div><p class="eyebrow">TIENDA STOCKFLOW</p><h2>Catálogo de zapatillas</h2><p>Solo se muestran productos con stock disponible en almacén.</p></div><button type="button" class="close" onclick="document.querySelector('#catalog-dialog').close()">×</button></div><div class="catalog-filters"><input id="catalog-search" placeholder="Buscar por modelo o SKU"><select id="catalog-category"><option value="">Todas las categorías</option>${categories.map((category) => `<option>${esc(category)}</option>`).join("")}</select></div><div id="catalog-grid" class="catalog-grid"></div>`;
  document.querySelector("#catalog-search").oninput = renderCatalog;
  document.querySelector("#catalog-category").onchange = renderCatalog;
  renderCatalog();
  dialog.showModal();
}

// Filtra los productos ya cargados y muestra únicamente unidades con stock real.
function renderCatalog() {
  const category = document.querySelector("#catalog-category").value;
  const query = document.querySelector("#catalog-search").value.toLowerCase();
  const shown = catalogItems.filter(
    (item) =>
      (!category || item.category === category) &&
      (!query ||
        item.product_name.toLowerCase().includes(query) ||
        item.sku.toLowerCase().includes(query)),
  );
  document.querySelector("#catalog-grid").innerHTML =
    shown
      .map(
        (item) =>
          `<article class="shoe-card"><div class="shoe-mark">${esc(item.sku.slice(-3))}</div><p class="shoe-category">${esc(item.category)}</p><h3>${esc(item.product_name)}</h3><p class="shoe-description">${esc(item.description || item.supplier || "Calzado deportivo")}</p><div class="shoe-price">${storeMoney(item.price)} <small>${item.available_quantity} disponibles</small></div><div class="purchase-row"><input id="qty-${item.item_id}" type="number" value="1" min="1" max="${item.available_quantity}"><button class="primary" onclick="createStoreOrder('${item.item_id}')">Solicitar</button></div></article>`,
      )
      .join("") || '<p class="empty">No hay productos en esta categoría.</p>';
}

window.createStoreOrder = async (itemId) => {
  const quantity = Number(document.querySelector(`#qty-${itemId}`).value);
  const { data, error } = await db.rpc("create_customer_order", {
    p_item_id: itemId,
    p_quantity: quantity,
  });
  if (error) return alert(error.message);
  alert(`Solicitud #${data} creada. Un operador o administrador la revisará.`);
  document.querySelector("#catalog-dialog")?.close();
  await loadCustomerStore();
};

// Convierte el estado técnico de una orden en una clase visual de color.
function orderStatus(status) {
  return ["aprobado", "preparado", "listo_retiro", "entregado"].includes(status)
    ? "ok"
    : status === "rechazado"
      ? "rejected"
      : status === "observado"
        ? "observed"
        : "pending";
}
function orderStatusLabel(status) {
  return (
    {
      pendiente: "Pendiente",
      aprobado: "Aprobado",
      preparado: "Preparando pedido",
      listo_retiro: "Listo para retiro",
      entregado: "Entregado",
      observado: "Requiere información",
      rechazado: "Rechazado",
    }[status] || status.replaceAll("_", " ")
  );
}
function orderProgress(status) {
  if (["rechazado", "observado"].includes(status)) return 1;
  return (
    { pendiente: 1, aprobado: 2, preparado: 2, listo_retiro: 3, entregado: 4 }[
      status
    ] || 1
  );
}
// Genera cada tarjeta de compra: producto, progreso, ubicación, PIN y chat.
function renderPurchases() {
  document.querySelector("#purchase-list").innerHTML = customerOrders.length
    ? customerOrders
        .map((order) => {
          const hasLocation = Boolean(order.warehouse_name);
          const progress = orderProgress(order.status);
          const pickupText =
            order.dispatch_status === "entregado"
              ? "Pedido entregado."
              : order.dispatch_status === "reservado"
                ? "Pedido preparado para retiro"
                : "Ubicación actual de la mercadería";
          const pinCard = order.pickup_pin
            ? `<section class="pickup-pin-card"><div><span class="pin-kicker">PIN PERSONAL DE RETIRO</span><strong>${esc(order.pickup_pin)}</strong><p>Muéstralo únicamente al momento de recoger tu pedido.</p></div><span class="pin-lock">⌾</span></section>`
            : "";
          return `<article class="purchase-card purchase-card-pro"><div class="purchase-main"><div class="purchase-top"><div class="order-code"><span>DESP-${String(order.id).padStart(6, "0")}</span><small>Compra del ${new Date(order.created_at).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" })}</small></div><span class="order-status ${orderStatus(order.status)}">${esc(orderStatusLabel(order.status))}</span></div><div class="product-summary"><div class="product-orb">👟</div><div><h3>${esc(order.product_name || order.inventory_items?.name || "Producto")}</h3><p>${esc(order.sku || order.inventory_items?.sku || "")} <i>•</i> ${order.quantity} unidad${order.quantity !== 1 ? "es" : ""} <i>•</i> ${storeMoney(order.total)}</p></div></div><div class="order-timeline"><div class="timeline-step ${progress >= 1 ? "done" : ""}"><b>1</b><span>Recibido</span></div><div class="timeline-line ${progress >= 2 ? "done" : ""}"></div><div class="timeline-step ${progress >= 2 ? "done" : ""}"><b>2</b><span>Preparando</span></div><div class="timeline-line ${progress >= 3 ? "done" : ""}"></div><div class="timeline-step ${progress >= 3 ? "done" : ""}"><b>3</b><span>Retiro</span></div><div class="timeline-line ${progress >= 4 ? "done" : ""}"></div><div class="timeline-step ${progress >= 4 ? "done" : ""}"><b>4</b><span>Entregado</span></div></div>${order.review_note ? `<p class="review-note">Nota del equipo: ${esc(order.review_note)}</p>` : ""}${hasLocation ? `<section class="pickup-order-location"><div class="pickup-icon">⌖</div><div><strong>${pickupText}</strong><p><b>${esc(order.warehouse_name)}</b><span>Rack ${esc(order.rack_code || "—")}</span><span>Posición ${esc(order.position_code || "—")}</span></p></div></section>` : '<p class="pickup-pending">⌖ La ubicación de retiro se asignará al preparar tu pedido.</p>'}${pinCard}</div><div class="purchase-actions"><button class="secondary chat-button" onclick="openOrderChat(${order.id})">◌ Abrir chat</button></div></article>`;
        })
        .join("")
    : '<p class="empty">Aún no tienes compras registradas.</p>';
}

// Carga la bandeja de compras que administrador y operador pueden revisar y procesar.
async function loadStaffOrders() {
  // El personal usa una consulta global propia para no perder solicitudes por RLS.
  let { data, error } = await db.rpc("get_staff_customer_orders");
  // Compatibilidad temporal para instalaciones que todavía no aplicaron el resumen global.
  if (error) {
    const fallback = await db
      .from("customer_orders")
      .select(
        "*, inventory_items(sku,name), profiles!customer_orders_customer_id_fkey(full_name)",
      )
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }
  if (error) {
    document.querySelector("#store-module").innerHTML =
      `<section class="panel"><p class="empty">No se pudo cargar la bandeja global: ${esc(error.message)}. Ejecuta staff_orders_summary_migration.sql.</p></section>`;
    return;
  }
  // Se consulta el inventario vigente, no el stock guardado al crear la orden.
  const inventoryIds = [...new Set(data.map((order) => order.inventory_id))];
  const { data: stockRows, error: stockError } = inventoryIds.length
    ? await db.from("inventory").select("id,quantity").in("id", inventoryIds)
    : { data: [], error: null };
  if (stockError) {
    document.querySelector("#store-module").innerHTML =
      '<section class="panel"><p class="empty">No se pudo consultar el stock actual.</p></section>';
    return;
  }
  const currentStock = Object.fromEntries(
    stockRows.map((inventory) => [inventory.id, inventory.quantity]),
  );
  data.forEach(
    (order) => (order.current_stock = currentStock[order.inventory_id] ?? 0),
  );
  await attachDispatches(data);
  customerOrders = data;
  window.adminOrderSnapshot = data;
  window.renderAdminCompanyDashboard?.();
  document.querySelector("#store-module").innerHTML =
    `<section class="panel purchase-review"><div class="panel-title"><div><p class="eyebrow">VENTAS Y DESPACHO</p><h2>Solicitudes de compra</h2></div><button id="refresh-staff-orders" class="secondary">Actualizar</button></div><div class="table-wrap"><table><thead><tr><th>ORDEN</th><th>CLIENTE</th><th>PRODUCTO</th><th>STOCK ACTUAL</th><th>TOTAL</th><th>ESTADO</th><th>ACCIONES</th></tr></thead><tbody>${data.length ? data.map((order) => `<tr><td><strong>DESP-${String(order.id).padStart(6, "0")}</strong><small>${new Date(order.created_at).toLocaleDateString("es-PE")}</small></td><td>${esc(order.customer_name || order.profiles?.full_name || "Cliente")}</td><td><strong>${esc(order.product_name || order.inventory_items?.name || "")}</strong><small>${esc(order.sku || order.inventory_items?.sku || "")} · Solicita ${order.quantity} un.${order.preferred_rack_id ? " · Rack preferido por cliente" : ""}</small></td><td><strong>${order.current_stock}</strong><small>unidades disponibles</small></td><td>${storeMoney(order.total)}</td><td><span class="order-status ${orderStatus(order.status)}">${esc(order.status)}${order.dispatch?.status === "reservado" ? " · preparado" : order.dispatch?.status === "entregado" ? " · entregado" : ""}</span></td><td><div class="order-actions"><button class="secondary" onclick="openOrderChat(${order.id})">Chat</button>${["pendiente", "observado"].includes(order.status) ? (order.preferred_rack_id ? `<button class="approve-order" onclick="reviewOrder(${order.id},'aprobado')">✓ Aprobar y preparar</button>` : `<button class="approve-order" onclick="openDispatchApproval(${order.id})">✓ Preparar y aprobar</button>`) : ""}${["pendiente", "observado"].includes(order.status) ? `<button class="observe-order" onclick="reviewOrder(${order.id},'observado')">! Observar</button><button class="reject-order" onclick="reviewOrder(${order.id},'rechazado')">× Rechazar</button>` : order.status === "aprobado" && order.dispatch?.status === "reservado" ? `<button class="approve-order" onclick="markOrderReady(${order.id})">✓ Listo para retiro</button>` : order.status === "listo_retiro" && order.dispatch?.status === "reservado" ? `<button class="approve-order pickup-validate" onclick="openPickupPinValidation(${order.id})">⌾ Validar PIN de retiro</button>` : ""}</div></td></tr>`).join("") : '<tr><td colspan="7" class="empty">No hay solicitudes de compra.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector("#refresh-staff-orders").onclick = loadStaffOrders;
}

window.reviewOrder = async (orderId, status, dispatchPositionId = null) => {
  let note = "";
  if (status !== "aprobado") {
    note = prompt(
      status === "observado"
        ? "Indica qué debe corregir o confirmar el cliente:"
        : "Motivo del rechazo (opcional):",
    );
    if (note === null) return;
  }
  const { error } = await db.rpc("review_customer_order", {
    p_order_id: orderId,
    p_status: status,
    p_note: note,
    p_dispatch_position_id: dispatchPositionId,
  });
  if (error) return alert(error.message);
  await loadStaffOrders();
};

// Crea/reutiliza el formulario donde el personal asigna una posición física al pedido.
function getDispatchDialog() {
  let dialog = document.querySelector("#dispatch-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "dispatch-dialog";
    dialog.className = "conversation";
    document.body.append(dialog);
  }
  return dialog;
}

// Obliga a elegir una posición existente y libre antes de aprobar una compra.
window.openDispatchApproval = async (orderId) => {
  const order = customerOrders.find((item) => item.id === orderId);
  const { data: positions, error } = await db.rpc(
    "get_available_dispatch_positions",
  );
  if (error) return alert(error.message);
  if (!positions?.length)
    return alert("No hay posiciones libres para preparar el pedido.");

  const dialog = getDispatchDialog();
  dialog.innerHTML = `<form id="dispatch-form"><div class="dialog-head"><div><p class="eyebrow">DESP-${String(orderId).padStart(6, "0")}</p><h2>Preparar pedido</h2></div><button type="button" class="close" onclick="document.querySelector('#dispatch-dialog').close()">×</button></div><p class="muted">${esc(order.product_name || order.inventory_items?.name || "Producto")} · ${order.quantity} unidad${order.quantity !== 1 ? "es" : ""} para ${esc(order.customer_name || order.profiles?.full_name || "cliente")}. Esta posición quedará reservada hasta el retiro o despacho.</p><label>Almacén<select id="dispatch-warehouse" required></select></label><label>Rack<select id="dispatch-rack" required></select></label><label>Posición libre<select id="dispatch-position" required></select></label><div class="actions"><button type="button" class="secondary" onclick="document.querySelector('#dispatch-dialog').close()">Cancelar</button><button class="primary">Aprobar y reservar</button></div></form>`;

  const fill = (selector, values, label, valueKey, text) => {
    document.querySelector(selector).innerHTML = values
      .map(
        (value) =>
          `<option value="${esc(value[valueKey])}">${esc(text(value))}</option>`,
      )
      .join("");
  };
  const warehouses = [
    ...new Set(positions.map((position) => position.warehouse_name)),
  ];
  const updateRacks = () => {
    const warehouse = document.querySelector("#dispatch-warehouse").value;
    const racks = [
      ...new Set(
        positions
          .filter((position) => position.warehouse_name === warehouse)
          .map((position) => position.rack_code),
      ),
    ];
    fill(
      "#dispatch-rack",
      racks.map((rack_code) => ({ rack_code })),
      "Rack",
      "rack_code",
      (rack) => rack.rack_code,
    );
    updatePositions();
  };
  const updatePositions = () => {
    const warehouse = document.querySelector("#dispatch-warehouse").value;
    const rack = document.querySelector("#dispatch-rack").value;
    fill(
      "#dispatch-position",
      positions.filter(
        (position) =>
          position.warehouse_name === warehouse && position.rack_code === rack,
      ),
      "Posición",
      "position_id",
      (position) => position.position_code,
    );
  };
  fill(
    "#dispatch-warehouse",
    warehouses.map((warehouse_name) => ({ warehouse_name })),
    "Almacén",
    "warehouse_name",
    (warehouse) => warehouse.warehouse_name,
  );
  updateRacks();
  document.querySelector("#dispatch-warehouse").onchange = updateRacks;
  document.querySelector("#dispatch-rack").onchange = updatePositions;
  document.querySelector("#dispatch-form").onsubmit = async (event) => {
    event.preventDefault();
    const positionId = document.querySelector("#dispatch-position").value;
    const { error } = await db.rpc("review_customer_order", {
      p_order_id: orderId,
      p_status: "aprobado",
      p_note: "",
      p_dispatch_position_id: positionId,
    });
    if (error) return alert(error.message);
    dialog.close();
    await loadStaffOrders();
  };
  dialog.showModal();
};

window.markOrderReady = async (orderId) => {
  const { error } = await db.rpc("mark_customer_order_ready", {
    p_order_id: orderId,
  });
  if (error) return alert(error.message);
  await loadStaffOrders();
};

// Crea/reutiliza el formulario seguro para validar el PIN sin revelar su valor.
function getPickupPinDialog() {
  let dialog = document.querySelector("#pickup-pin-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "pickup-pin-dialog";
    dialog.className = "conversation pickup-pin-dialog";
    document.body.append(dialog);
  }
  return dialog;
}

// El personal escribe el código que le comunica el cliente; nunca se muestra el PIN en esta vista.
window.openPickupPinValidation = (orderId) => {
  const dialog = getPickupPinDialog();
  dialog.innerHTML = `<form id="pickup-pin-form"><div class="dialog-head"><div><p class="eyebrow">DESP-${String(orderId).padStart(6, "0")}</p><h2>Validar retiro</h2></div><button type="button" class="close" onclick="document.querySelector('#pickup-pin-dialog').close()">×</button></div><div class="pin-validation-icon">⌾</div><p class="muted">Solicita al cliente su PIN personal de seis dígitos. El sistema no lo muestra al operador ni al administrador.</p><label>PIN de retiro<input name="pin" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="• • • • • •" required></label><p id="pin-validation-result" class="pin-validation-result" aria-live="polite"></p><div class="actions"><button type="button" class="secondary" onclick="document.querySelector('#pickup-pin-dialog').close()">Cancelar</button><button class="primary">Validar y entregar</button></div></form>`;
  dialog.querySelector("input[name=pin]").focus();
  dialog.querySelector("#pickup-pin-form").onsubmit = async (event) => {
    event.preventDefault();
    const result = dialog.querySelector("#pin-validation-result");
    const pin = new FormData(event.target).get("pin").trim();
    const { data, error } = await db.rpc("validate_customer_order_pickup_pin", {
      p_order_id: orderId,
      p_pin: pin,
    });
    if (error) {
      result.className = "pin-validation-result error";
      result.textContent = error.message;
      return;
    }
    const response = data?.[0];
    result.className = `pin-validation-result ${response?.is_valid ? "success" : "error"}`;
    result.textContent = response?.message || "No se pudo validar el PIN.";
    if (response?.is_valid) {
      event.target.querySelector("button[type=submit]").disabled = true;
      setTimeout(async () => {
        dialog.close();
        await loadStaffOrders();
      }, 900);
    }
  };
  dialog.showModal();
};

// Crea/reutiliza el chat asociado exclusivamente a una solicitud de compra.
function getOrderDialog() {
  let dialog = document.querySelector("#order-chat-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "order-chat-dialog";
    dialog.className = "conversation";
    document.body.append(dialog);
  }
  return dialog;
}
window.openOrderChat = async (orderId) => {
  const order = customerOrders.find((item) => item.id === orderId),
    dialog = getOrderDialog();
  const { data: messages, error } = await db
    .from("customer_order_messages")
    .select(
      "*, profiles!customer_order_messages_sender_id_fkey(full_name,role)",
    )
    .eq("order_id", orderId)
    .order("created_at");
  if (error) return alert(error.message);
  dialog.innerHTML = `<form id="order-chat-form"><div class="dialog-head"><div><p class="eyebrow">ORDEN #${orderId}</p><h2>${esc(order.product_name || order.inventory_items?.name || "Compra")}</h2></div><button type="button" class="close" onclick="document.querySelector('#order-chat-dialog').close()">×</button></div><div class="thread">${messages.length ? messages.map((message) => `<div class="bubble ${message.profiles?.role === "cliente" ? "" : "staff"}"><strong>${esc(message.profiles?.full_name || "Usuario")} · ${esc(message.profiles?.role || "")}</strong>${esc(message.body)}<small>${new Date(message.created_at).toLocaleString("es-PE")}</small></div>`).join("") : '<p class="muted">Inicia la conversación sobre esta compra.</p>'}</div><label>Mensaje<textarea name="body" required placeholder="Escribe tu mensaje."></textarea></label><div class="actions"><button type="button" class="secondary" onclick="document.querySelector('#order-chat-dialog').close()">Cerrar</button><button class="primary">Enviar</button></div></form>`;
  document.querySelector("#order-chat-form").onsubmit = async (event) => {
    event.preventDefault();
    const body = new FormData(event.target).get("body");
    const { error } = await db
      .from("customer_order_messages")
      .insert({ order_id: orderId, sender_id: me.id, body });
    if (error) return alert(error.message);
    dialog.close();
    await loadStore();
  };
  dialog.showModal();
};

window.addEventListener("load", () => {
  if (profile) window.initStore();
});
