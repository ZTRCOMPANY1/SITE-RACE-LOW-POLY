

function formatDate(dateValue) {
  if (!dateValue) return "Sem data";

  const date = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) return dateValue;

  return date.toLocaleDateString("pt-BR");
}

async function carregarAtualizacoes() {
  const container = document.getElementById("updatesList");

  if (!container) return;

  try {
    const response = await fetch(`${API_ADMIN}/updates`);
    const updates = await response.json();

    if (!Array.isArray(updates) || updates.length === 0) {
      container.innerHTML = `
        <div class="empty-state reveal visible">
          <h3>Nenhuma atualização publicada ainda.</h3>
          <p>Quando novas informações forem adicionadas pelo painel admin, elas aparecerão aqui.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = updates.map((update) => {
      const imageContent = update.imageUrl
        ? `<img src="${update.imageUrl}" alt="${update.title}">`
        : `<div class="update-placeholder">SEM IMAGEM</div>`;

      return `
        <article class="update-card reveal visible">
          <div class="update-image">
            ${imageContent}
          </div>

          <div>
            <h3>${update.title}</h3>

            <div class="update-meta">
              <span>${formatDate(update.date)}</span>
              <span>${update.version || "Dev Update"}</span>
              <span>${update.category || "Desenvolvimento"}</span>
            </div>

            <p>${update.description}</p>
          </div>
        </article>
      `;
    }).join("");
  } catch (error) {
    console.error("Erro ao carregar atualizações:", error);

    container.innerHTML = `
      <div class="empty-state reveal visible">
        <h3>Não foi possível carregar as atualizações.</h3>
        <p>Confira se o servidor está online no Render.</p>
      </div>
    `;
  }
}

carregarAtualizacoes();
