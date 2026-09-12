// Controles de navegación y sesión exclusivos para personal operativo.
const dashboardDb =
  window.SUPABASE_URL && window.SUPABASE_ANON_KEY
    ? window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY,
      )
    : null;

// Personaliza la sesión del dashboard y añade volver/cerrar sesión para el personal.
async function setupDashboardSessionControls() {
  if (!dashboardDb) return;
  const {
    data: { user },
  } = await dashboardDb.auth.getUser();
  if (!user) return;

  const { data: profile } = await dashboardDb
    .from("profiles")
    .select("full_name,role")
    .eq("id", user.id)
    .single();
  if (!["administrador", "operador"].includes(profile?.role)) return;

  // Personaliza la cabecera para que cada integrante identifique su sesión activa.
  document.querySelector("#dashboard-user-name").textContent =
    profile.full_name || "Equipo StockFlow";
  document.querySelector("#dashboard-role").textContent =
    profile.role === "administrador" ? "Administrador" : "Operador de almacén";
  document.querySelector("#dashboard-avatar").textContent = (
    profile.full_name || "SF"
  )
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => name[0])
    .join("")
    .toUpperCase();

  const controls = document.createElement("div");
  controls.className = "session-controls";
  controls.innerHTML = `
    <a class="back-dashboard" href="portal.html">← Volver al portal</a>
    <button class="logout-dashboard" type="button">Cerrar sesión</button>
  `;
  const sidebar = document.querySelector("aside");
  sidebar.insertBefore(controls, sidebar.querySelector(".side-bottom"));

  controls
    .querySelector(".logout-dashboard")
    .addEventListener("click", async () => {
      await dashboardDb.auth.signOut();
      window.location.href = "portal.html";
    });
}

// Punto de entrada al abrir index.html directamente o dentro del portal administrador.
setupDashboardSessionControls();
