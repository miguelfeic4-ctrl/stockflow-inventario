// Registro público: crea usuarios exclusivamente con el rol inicial de cliente.
const registrationDb =
  window.SUPABASE_URL && window.SUPABASE_ANON_KEY
    ? window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY,
      )
    : null;

// Referencias a la interfaz para validar los datos y mostrar feedback al visitante.
const registrationForm = document.querySelector("#register-form");
const registrationMessage = document.querySelector("#register-message");

// Valida campos del registro y delega la creación segura al servicio Auth de Supabase.
registrationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!registrationDb) {
    registrationMessage.textContent =
      "Configura config.js antes de crear una cuenta.";
    return;
  }
  const data = Object.fromEntries(new FormData(registrationForm));
  if (!/^\d{9}$/.test(data.phone.trim())) {
    registrationMessage.textContent =
      "El teléfono celular debe tener exactamente 9 dígitos.";
    return;
  }
  if (data.password !== data.confirm_password) {
    registrationMessage.textContent = "Las contraseñas no coinciden.";
    return;
  }

  const { error } = await registrationDb.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        full_name: `${data.first_name.trim()} ${data.last_name.trim()}`,
        dni: data.dni.trim(),
        phone: data.phone.trim(),
      },
    },
  });

  if (error) {
    registrationMessage.textContent = error.message;
    return;
  }
  registrationForm.hidden = true;
  document.querySelector("#register-success").hidden = false;
  registrationMessage.textContent = "";
});
