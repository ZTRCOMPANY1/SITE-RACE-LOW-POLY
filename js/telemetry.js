(() => {
  if (typeof API_BASE === "undefined") return;

  const payload = {
    site: "RACE LOW POLY",
    page: window.location.pathname,
    language: navigator.language || "desconhecido",
    resolution: `${screen.width}x${screen.height}`,
    referrer: document.referrer || "direto"
  };

  fetch(`${API_BASE}/telemetry/pageview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => {});
})();
