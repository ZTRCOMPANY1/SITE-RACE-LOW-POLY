const menuBtn = document.getElementById("menuBtn");
const nav = document.getElementById("nav");
const glow = document.querySelector(".cursor-glow");


// Abre e fecha o menu no mobile
if (menuBtn && nav) {
  menuBtn.addEventListener("click", () => {
    nav.classList.toggle("open");
  });
}

// Fecha o menu mobile quando clicar em algum link
document.querySelectorAll(".nav a").forEach((link) => {
  link.addEventListener("click", () => {
    if (nav) nav.classList.remove("open");
  });
});

// Efeito de brilho seguindo o mouse
window.addEventListener("mousemove", (event) => {
  if (!glow) return;

  glow.style.left = `${event.clientX}px`;
  glow.style.top = `${event.clientY}px`;
});

// Animação dos elementos ao aparecerem na tela
const reveals = document.querySelectorAll(".reveal");

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
      }
    });
  },
  {
    threshold: 0.15,
  }
);

reveals.forEach((item) => {
  observer.observe(item);
});

// Formata tempo em segundos para MM:SS.ms
function formatarTempo(time) {
  if (time === undefined || time === null) return "--";

  const numero = Number(time);

  if (Number.isNaN(numero)) return String(time);

  const minutos = Math.floor(numero / 60);
  const segundos = (numero % 60).toFixed(2);

  return `${minutos}:${segundos.padStart(5, "0")}`;
}

const API_URL = API_DASHBOARD;


// O dashboard só consulta a API quando seus elementos existem na página.
// A seção está atualmente desativada no index.html; nesse caso, não há polling.
const dashboardElements = {
  totalPlayers: document.getElementById("totalPlayers"),
  totalRaces: document.getElementById("totalRaces"),
  bestTime: document.getElementById("bestTime"),
  rankingTable: document.getElementById("rankingTable")
};

const dashboardEnabled = Object.values(dashboardElements).some((element) => element !== null);
const DASHBOARD_REFRESH_MS = 30000;
let dashboardAtualizando = false;

async function carregarDashboard() {
  if (!dashboardEnabled || dashboardAtualizando) return;

  dashboardAtualizando = true;

  try {
    // Reutiliza a mesma resposta de most-wins para cards e ranking.
    const [playersResponse, bestTimesResponse] = await Promise.all([
      fetch(API_URL + "/dashboard/most-wins"),
      fetch(API_URL + "/dashboard/best-times")
    ]);

    if (!playersResponse.ok || !bestTimesResponse.ok) {
      throw new Error("A API do dashboard retornou uma resposta inválida.");
    }

    const [players, bestTimes] = await Promise.all([
      playersResponse.json(),
      bestTimesResponse.json()
    ]);

    if (!Array.isArray(players) || !Array.isArray(bestTimes)) {
      throw new Error("Formato de dados inválido recebido do dashboard.");
    }

    const totalRaces = players.reduce((total, player) => {
      return total + (Number(player.racesPlayed) || 0);
    }, 0);

    const fastest = bestTimes.reduce((best, entry) => {
      const time = Number(entry.raceTime);
      if (!Number.isFinite(time)) return best;
      return !best || time < Number(best.raceTime) ? entry : best;
    }, null);

    if (dashboardElements.totalPlayers) {
      dashboardElements.totalPlayers.textContent = String(players.length);
    }
    if (dashboardElements.totalRaces) {
      dashboardElements.totalRaces.textContent = totalRaces.toLocaleString("pt-BR");
    }
    if (dashboardElements.bestTime) {
      dashboardElements.bestTime.textContent = fastest ? formatarTempo(fastest.raceTime) : "--";
    }

    const table = dashboardElements.rankingTable;
    if (table) {
      const fragment = document.createDocumentFragment();
      const header = document.createElement("div");
      header.className = "table-row head";

      ["#", "Player", "Vitórias", "Corridas"].forEach((label) => {
        const cell = document.createElement("span");
        cell.textContent = label;
        header.appendChild(cell);
      });
      fragment.appendChild(header);

      players.slice(0, 10).forEach((player, index) => {
        const row = document.createElement("div");
        row.className = "table-row";
        const values = [
          index + 1,
          player.playerName || "Player",
          player.racesWon || 0,
          player.racesPlayed || 0
        ];

        values.forEach((value) => {
          const cell = document.createElement("span");
          cell.textContent = String(value);
          row.appendChild(cell);
        });
        fragment.appendChild(row);
      });

      table.replaceChildren(fragment);
    }
  } catch (error) {
    console.error("Erro ao carregar dashboard:", error);
  } finally {
    dashboardAtualizando = false;
  }
}

if (dashboardEnabled) {
  carregarDashboard();
  setInterval(carregarDashboard, DASHBOARD_REFRESH_MS);
}
