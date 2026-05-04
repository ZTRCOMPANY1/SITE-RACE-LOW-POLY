const TOKEN_KEY = "race_low_poly_admin_token";

const lockScreen = document.getElementById("lockScreen");
const adminPanel = document.getElementById("adminPanel");
const loginForm = document.getElementById("loginForm");
const updateForm = document.getElementById("updateForm");
const adminAlert = document.getElementById("adminAlert");
const adminUpdatesList = document.getElementById("adminUpdatesList");
const logoutBtn = document.getElementById("logoutBtn");

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function showAlert(message, type = "success") {
  if (!adminAlert) return;

  adminAlert.textContent = message;
  adminAlert.classList.add("show");

  if (type === "error") {
    adminAlert.style.background = "rgba(239,68,68,.12)";
    adminAlert.style.borderColor = "rgba(239,68,68,.28)";
    adminAlert.style.color = "#fecaca";
  } else {
    adminAlert.style.background = "rgba(34,197,94,.12)";
    adminAlert.style.borderColor = "rgba(34,197,94,.28)";
    adminAlert.style.color = "#bbf7d0";
  }

  setTimeout(() => {
    adminAlert.classList.remove("show");
  }, 3500);
}

function showPanel() {
  lockScreen.classList.add("hidden");
  adminPanel.classList.remove("hidden");
  carregarAtualizacoesAdmin();
}

function showLock() {
  adminPanel.classList.add("hidden");
  lockScreen.classList.remove("hidden");
}

if (getToken()) {
  showPanel();
} else {
  showLock();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = document.getElementById("adminUser").value.trim();
  const password = document.getElementById("adminPassword").value;

  try {
    const response = await fetch(`${API_URL}/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok || !data.token) {
      showAlert(data.error || "Login inválido.", "error");
      return;
    }

    setToken(data.token);
    showPanel();
    showAlert("Login realizado.");
  } catch (error) {
    showAlert("Erro ao conectar com o servidor.", "error");
  }
});

logoutBtn.addEventListener("click", () => {
  clearToken();
  showLock();
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

updateForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = document.getElementById("updateTitle").value.trim();
  const date = document.getElementById("updateDate").value;
  const version = document.getElementById("updateVersion").value.trim();
  const category = document.getElementById("updateCategory").value;
  const description = document.getElementById("updateDescription").value.trim();
  const imageUrlInput = document.getElementById("updateImageUrl").value.trim();
  const imageFile = document.getElementById("updateImage").files[0];

  if (!title || !date || !description) {
    showAlert("Preencha título, data e descrição.", "error");
    return;
  }

  let imageUrl = imageUrlInput;

  if (imageFile) {
    imageUrl = await fileToBase64(imageFile);
  }

  try {
    const response = await fetch(`${API_URL}/admin/updates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        title,
        description,
        imageUrl,
        version,
        category,
        date
      })
    });

    const data = await response.json();

    if (!response.ok) {
      showAlert(data.error || "Erro ao publicar atualização.", "error");
      return;
    }

    updateForm.reset();
    carregarAtualizacoesAdmin();
    showAlert("Atualização publicada com sucesso.");
  } catch (error) {
    showAlert("Erro ao conectar com o servidor.", "error");
  }
});

async function carregarAtualizacoesAdmin() {
  try {
    const response = await fetch(`${API_URL}/updates`);
    const updates = await response.json();

    if (!Array.isArray(updates) || updates.length === 0) {
      adminUpdatesList.innerHTML = `
        <div class="empty-state">
          <p>Nenhuma atualização cadastrada ainda.</p>
        </div>
      `;
      return;
    }

    adminUpdatesList.innerHTML = updates.map((update) => {
      return `
        <div class="admin-item">
          <div>
            <strong>${update.title}</strong>
            <span>${update.date || "Sem data"} • ${update.version || "Sem versão"}</span>
          </div>

          <button class="danger-btn" data-delete="${update.id}">Excluir</button>
        </div>
      `;
    }).join("");

    document.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.getAttribute("data-delete");

        try {
          const response = await fetch(`${API_URL}/admin/updates/${id}`, {
            method: "DELETE",
            headers: {
              "Authorization": `Bearer ${getToken()}`
            }
          });

          const data = await response.json();

          if (!response.ok) {
            showAlert(data.error || "Erro ao excluir atualização.", "error");
            return;
          }

          carregarAtualizacoesAdmin();
          showAlert("Atualização excluída.");
        } catch (error) {
          showAlert("Erro ao conectar com o servidor.", "error");
        }
      });
    });
  } catch (error) {
    showAlert("Erro ao carregar atualizações.", "error");
  }
}
