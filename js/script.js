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

// Carrega cards do dashboard
async function carregarStats() {
  try {
    const playersRes = await fetch(`${API_URL}/dashboard/most-wins`);
    const bestRes = await fetch(`${API_URL}/dashboard/best-times`);

    const players = await playersRes.json();
    const bestTimes = await bestRes.json();

    const totalPlayers = players.length;

    const totalRaces = players.reduce((total, player) => {
      return total + (player.racesPlayed || 0);
    }, 0);

    let bestTime = "--";

    if (bestTimes.length > 0) {
      const fastest = bestTimes.sort((a, b) => {
        return Number(a.raceTime) - Number(b.raceTime);
      })[0];

      bestTime = formatarTempo(fastest.raceTime);
    }

    const playersEl = document.getElementById("totalPlayers");
    const racesEl = document.getElementById("totalRaces");
    const timeEl = document.getElementById("bestTime");

    if (playersEl) playersEl.textContent = totalPlayers;
    if (racesEl) racesEl.textContent = totalRaces.toLocaleString("pt-BR");
    if (timeEl) timeEl.textContent = bestTime;
  } catch (error) {
    console.error("Erro ao carregar stats:", error);
  }
}

// Carrega ranking real
async function carregarRanking() {
  try {
    const response = await fetch(`${API_URL}/dashboard/most-wins`);
    const ranking = await response.json();

    const table = document.getElementById("rankingTable");

    if (!table) return;

    table.innerHTML = `
      <div class="table-row head">
        <span>#</span>
        <span>Player</span>
        <span>Vitórias</span>
        <span>Corridas</span>
      </div>
    `;

    ranking.slice(0, 10).forEach((player, index) => {
      const row = document.createElement("div");
      row.className = "table-row";

      row.innerHTML = `
        <span>${index + 1}</span>
        <span>${player.playerName || "Player"}</span>
        <span>${player.racesWon || 0}</span>
        <span>${player.racesPlayed || 0}</span>
      `;

      table.appendChild(row);
    });
  } catch (error) {
    console.error("Erro ao carregar ranking:", error);
  }
}

carregarStats();
carregarRanking();

setInterval(() => {
  carregarStats();
  carregarRanking();
}, 10000);
