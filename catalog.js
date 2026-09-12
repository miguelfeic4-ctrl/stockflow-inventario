// Página de tienda para clientes: muestra únicamente productos con stock disponible.
// Flujo: valida sesión → carga catálogo/Racks → filtra tarjetas → crea solicitud de compra.
const catalogDb =
  window.SUPABASE_URL && window.SUPABASE_ANON_KEY
    ? window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY,
      )
    : null;
// Datos en memoria para filtrar sin consultar Supabase en cada cambio de selector.
let storeCatalog = [];
let dispatchOptions = [];
// Evita que textos ingresados desde la base de datos se interpreten como HTML.
const catalogEsc = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );
const catalogMoney = (value) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(
    value || 0,
  );
// Protege esta página: solo un usuario autenticado con rol cliente puede usar la tienda.
async function loadCatalog() {
  if (!catalogDb) return;
  const {
    data: { user },
  } = await catalogDb.auth.getUser();
  if (!user) {
    window.location.href = "portal.html";
    return;
  }
  const { data: profile } = await catalogDb
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "cliente") {
    window.location.href = "portal.html";
    return;
  }
  const [catalogResult, dispatchResult] = await Promise.all([
    catalogDb.rpc("get_store_catalog"),
    catalogDb.rpc("get_customer_dispatch_options"),
  ]);
  const { data, error } = catalogResult;
  if (error) {
    document.querySelector("#catalog-grid").innerHTML =
      '<p class="empty">Ejecuta store_orders_migration.sql para habilitar el catálogo.</p>';
    return;
  }
  dispatchOptions = dispatchResult.error ? [] : dispatchResult.data;
  storeCatalog = data;
  const categories = [...new Set(data.map((item) => item.category))];
  document.querySelector("#catalog-category").innerHTML =
    '<option value="">Todas las categorías</option>' +
    categories
      .map((category) => `<option>${catalogEsc(category)}</option>`)
      .join("");
  const setFilterOptions = (selector, values, emptyLabel) => {
    document.querySelector(selector).innerHTML =
      `<option value="">${emptyLabel}</option>` +
      values
        .map(
          (value) =>
            `<option value="${catalogEsc(value)}">${catalogEsc(value)}</option>`,
        )
        .join("");
  };
  setFilterOptions(
    "#catalog-brand",
    [...new Set(data.map((item) => item.brand).filter(Boolean))].sort(),
    "Todas las marcas",
  );
  setFilterOptions(
    "#catalog-size",
    [...new Set(data.map((item) => item.size_eu).filter(Boolean))].sort(
      (a, b) => a - b,
    ),
    "Todas las tallas",
  );
  setFilterOptions(
    "#catalog-color",
    [...new Set(data.map((item) => item.color).filter(Boolean))].sort(),
    "Todos los colores",
  );
  document.querySelector("#catalog-search").oninput = renderCatalogPage;
  [
    "#catalog-category",
    "#catalog-brand",
    "#catalog-size",
    "#catalog-color",
    "#catalog-price",
  ].forEach(
    (selector) =>
      (document.querySelector(selector).onchange = renderCatalogPage),
  );
  renderCatalogPage();
}
// Aplica búsqueda y filtros comerciales antes de dibujar las tarjetas de zapatillas.
function renderCatalogPage() {
  const query = document.querySelector("#catalog-search").value.toLowerCase(),
    category = document.querySelector("#catalog-category").value,
    brand = document.querySelector("#catalog-brand").value,
    size = document.querySelector("#catalog-size").value,
    color = document.querySelector("#catalog-color").value,
    priceRange = document.querySelector("#catalog-price").value,
    [minimumPrice, maximumPrice] = priceRange
      ? priceRange.split("-").map(Number)
      : [null, null],
    visible = storeCatalog.filter(
      (item) =>
        (!category || item.category === category) &&
        (!brand || item.brand === brand) &&
        (!size || String(item.size_eu) === size) &&
        (!color || item.color === color) &&
        (minimumPrice === null ||
          (Number(item.price) >= minimumPrice &&
            Number(item.price) <= maximumPrice)) &&
        (!query ||
          item.product_name.toLowerCase().includes(query) ||
          item.sku.toLowerCase().includes(query)),
    );
  document.querySelector("#catalog-count").textContent =
    `${visible.length} modelo${visible.length !== 1 ? "s" : ""} disponible${visible.length !== 1 ? "s" : ""}`;
  document.querySelector("#catalog-grid").innerHTML =
    visible
      .map(
        (item) =>
          `<article class="shoe-card"><div class="shoe-mark">${catalogEsc(item.sku.slice(-3))}</div><p class="shoe-category">${catalogEsc(item.category)}</p><h3>${catalogEsc(item.product_name)}</h3><div class="shoe-tags"><span>${catalogEsc(item.brand || "Sin marca")}</span><span>EU ${catalogEsc(item.size_eu || "—")}</span><span>${catalogEsc(item.color || "Sin color")}</span></div><p class="shoe-description">${catalogEsc(item.description || item.supplier || "Calzado deportivo")}</p><p class="stock-location">Stock físico: <strong>${item.available_quantity} un.</strong><br>${catalogEsc(item.warehouse_name || "Ubicación por confirmar")} · Rack ${catalogEsc(item.rack_code || "—")} · Posición ${catalogEsc(item.position_code || "—")}</p><div class="dispatch-preference"><label>Almacén preferido para retiro (opcional)<select id="dispatch-warehouse-${item.item_id}" onchange="updateCatalogDispatchRacks('${item.item_id}')"><option value="">El personal asignará una ubicación</option>${[...new Map(dispatchOptions.map((option) => [option.warehouse_id, option])).values()].map((option) => `<option value="${catalogEsc(option.warehouse_id)}">${catalogEsc(option.warehouse_name)}</option>`).join("")}</select></label><label>Rack preferido<select id="dispatch-rack-${item.item_id}" disabled><option value="">Primero selecciona un almacén</option></select></label></div><div class="shoe-price">${catalogMoney(item.price)} <small>${item.available_quantity} disponibles</small></div><div class="purchase-row"><input id="qty-${item.item_id}" type="number" value="1" min="1" max="${item.available_quantity}"><button class="primary" onclick="requestPurchase('${item.item_id}')">Solicitar</button></div></article>`,
      )
      .join("") || '<p class="empty">No hay productos para este filtro.</p>';
}
// Limita los racks a los que pertenecen al almacén elegido y siguen con espacio libre.
window.updateCatalogDispatchRacks = (itemId) => {
  const warehouseId = document.querySelector(
    `#dispatch-warehouse-${itemId}`,
  ).value;
  const rackSelect = document.querySelector(`#dispatch-rack-${itemId}`);
  const racks = dispatchOptions.filter(
    (option) => option.warehouse_id === warehouseId,
  );
  rackSelect.disabled = !warehouseId;
  rackSelect.innerHTML = warehouseId
    ? `<option value="">Selecciona un rack</option>${racks.map((option) => `<option value="${catalogEsc(option.rack_id)}">${catalogEsc(option.rack_code)} · ${option.free_positions} espacio${option.free_positions !== 1 ? "s" : ""} libre${option.free_positions !== 1 ? "s" : ""}</option>`).join("")}`
    : '<option value="">Primero selecciona un almacén</option>';
};
// Envía la compra a la RPC para validar stock y crear la solicitud de forma atómica.
window.requestPurchase = async (itemId) => {
  const quantity = Number(document.querySelector(`#qty-${itemId}`).value),
    preferredRackId =
      document.querySelector(`#dispatch-rack-${itemId}`).value || null,
    { data, error } = await catalogDb.rpc("create_customer_order", {
      p_item_id: itemId,
      p_quantity: quantity,
      p_preferred_rack_id: preferredRackId,
    });
  if (error) return alert(error.message);
  alert(`Solicitud #${data} creada. Revisa el estado en Mis compras.`);
  window.location.href = "portal.html";
};
// Punto de entrada de la página independiente de catálogo.
loadCatalog();
