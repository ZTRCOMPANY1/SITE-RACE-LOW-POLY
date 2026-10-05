const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ADMIN_USER = process.env.ADMIN_USER || "ZTR@2023";
const ADMIN_PASS = process.env.ADMIN_PASS;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const ZTR_CLOUD_API_URL = String(
  process.env.ZTR_CLOUD_API_URL || process.env.ZTR_CLOUD_URL || "https://api.ztrcompany.site"
).replace(/\/$/, "");
const ZTR_CLOUD_PROJECT_ID = process.env.ZTR_CLOUD_PROJECT_ID;
const ZTR_CLOUD_SECRET_KEY = process.env.ZTR_CLOUD_SECRET_KEY;

if (!ZTR_CLOUD_PROJECT_ID || !ZTR_CLOUD_SECRET_KEY) {
  console.error("ERRO: ZTR_CLOUD_PROJECT_ID e ZTR_CLOUD_SECRET_KEY precisam estar configurados.");
  process.exit(1);
}

if (!ADMIN_PASS || !ADMIN_TOKEN_SECRET) {
  console.error("ERRO: ADMIN_PASS e ADMIN_TOKEN_SECRET precisam estar configurados.");
  process.exit(1);
}

async function cloudRequest(path, { method = "GET", body } = {}) {
  const headers = {
    "x-api-key": ZTR_CLOUD_SECRET_KEY,
    "x-ztr-sdk-version": "race-low-poly-api/3.0"
  };
  if (body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(
    `${ZTR_CLOUD_API_URL}/v1/${encodeURIComponent(ZTR_CLOUD_PROJECT_ID)}${path}`,
    {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    }
  );

  const ct = response.headers.get("content-type") || "";
  const data = ct.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    const err = new Error(data?.message || `ZTR Cloud HTTP ${response.status}`);
    err.status = response.status;
    err.payload = data;
    throw err;
  }
  return data;
}

async function cloudRows(table, maxRows = 10000) {
  const out = [];
  let offset = 0;
  while (out.length < maxRows) {
    const page = await cloudRequest(
      `/data/${encodeURIComponent(table)}?limit=200&offset=${offset}`
    );
    if (!Array.isArray(page)) break;
    out.push(...page);
    if (page.length < 200) break;
    offset += page.length;
  }
  return out.slice(0, maxRows);
}

const cloudInsert = (table, body) =>
  cloudRequest(`/data/${encodeURIComponent(table)}`, { method: "POST", body });
const cloudUpdate = (table, id, body) =>
  cloudRequest(`/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, { method: "PATCH", body });
const cloudDelete = (table, id) =>
  cloudRequest(`/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, { method: "DELETE" });

const ci = v => String(v || "").toLocaleLowerCase("pt-BR");
const plusDays = d => new Date(Date.now() + d * 86400000).toISOString();
const plusMinutes = m => new Date(Date.now() + m * 60000).toISOString();

async function one(table, predicate) {
  return (await cloudRows(table)).find(predicate) || null;
}

function mapUpdateRow(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    imageUrl: r.image_url,
    version: r.version,
    category: r.category,
    date: r.update_date,
    createdAt: r.created_at
  };
}

const pool = {
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

    if (q === "select 1") return { rows: [{ ok: 1 }] };

    if (q.startsWith("select data from players where lower(player_name)")) {
      const r = await one("players", x => ci(x.player_name) === ci(params[0]));
      return { rows: r ? [{ data: r.data }] : [] };
    }

    if (q.startsWith("insert into players")) {
      const old = await one("players", x => ci(x.player_name) === ci(params[0]));
      if (old) await cloudUpdate("players", old.id, { player_name: params[0], data: params[1] });
      else await cloudInsert("players", { player_name: params[0], data: params[1] });
      return { rows: [] };
    }

    if (q === "select * from events where active = true") {
      return { rows: (await cloudRows("events")).filter(x => x.active === true) };
    }

    if (q.includes("select code from redeem_codes") && q.includes("event_id = $2")) {
      const r = (await cloudRows("redeem_codes")).filter(x =>
        ci(x.player_name) === ci(params[0]) && x.event_id === params[1] && x.used === false
      );
      return { rows: r.map(x => ({ code: x.code })) };
    }

    if (q.startsWith("insert into redeem_codes")) {
      const row = await cloudInsert("redeem_codes", {
        code: params[0], player_name: params[1], event_id: params[2],
        title: params[3], description: params[4] || "", reward_badge: params[5],
        used: false, used_at: null
      });
      return { rows: [row] };
    }

    if (q.includes("select users.username, users.linked_player_name") && q.includes("from sessions")) {
      const session = await one("sessions", x =>
        x.token === params[0] && new Date(x.expires_at) > new Date()
      );
      if (!session) return { rows: [] };
      const user = await one("users", x => ci(x.username) === ci(session.username));
      return { rows: user ? [{ username: user.username, linked_player_name: user.linked_player_name }] : [] };
    }

    if (q.startsWith("insert into users")) {
      const row = await cloudInsert("users", {
        username: params[0], password_hash: params[1], linked_player_name: null
      });
      return { rows: [row] };
    }

    if (q.startsWith("select * from users where lower(username)")) {
      const r = await one("users", x => ci(x.username) === ci(params[0]));
      return { rows: r ? [r] : [] };
    }

    if (q.startsWith("insert into sessions")) {
      const row = await cloudInsert("sessions", {
        username: params[0], token: params[1], expires_at: plusDays(7)
      });
      return { rows: [row] };
    }

    if (q.startsWith("delete from sessions where token = $1")) {
      const r = await one("sessions", x => x.token === params[0]);
      if (r) await cloudDelete("sessions", r.id);
      return { rows: [] };
    }

    if (q.startsWith("delete from link_codes") && q.includes("lower(player_name)")) {
      const rows = (await cloudRows("link_codes")).filter(x =>
        ci(x.player_name) === ci(params[0]) && x.used === false
      );
      for (const r of rows) await cloudDelete("link_codes", r.id);
      return { rows: [] };
    }

    if (q.startsWith("insert into link_codes")) {
      const row = await cloudInsert("link_codes", {
        code: params[0], player_name: params[1], used: false,
        used_by: null, expires_at: plusMinutes(10), used_at: null
      });
      return { rows: [row] };
    }

    if (q.startsWith("select * from link_codes") && q.includes("upper(code)")) {
      const r = await one("link_codes", x =>
        String(x.code || "").toUpperCase() === String(params[0] || "").toUpperCase()
      );
      return { rows: r ? [r] : [] };
    }

    if (q.startsWith("select username from users") && q.includes("linked_player_name")) {
      const r = (await cloudRows("users")).filter(x =>
        ci(x.linked_player_name) === ci(params[0]) && x.username !== params[1]
      );
      return { rows: r.map(x => ({ username: x.username })) };
    }

    if (q.startsWith("update users set linked_player_name")) {
      const r = await one("users", x => x.username === params[1]);
      if (r) await cloudUpdate("users", r.id, { linked_player_name: params[0] });
      return { rows: [] };
    }

    if (q.startsWith("update link_codes set used = true")) {
      const r = await one("link_codes", x => x.code === params[1]);
      if (r) await cloudUpdate("link_codes", r.id, {
        used: true, used_by: params[0], used_at: new Date().toISOString()
      });
      return { rows: [] };
    }

    if (q.startsWith("select * from redeem_codes where lower(player_name)")) {
      const rows = (await cloudRows("redeem_codes")).filter(x =>
        ci(x.player_name) === ci(params[0]) && x.used === false
      );
      return { rows };
    }

    if (q.startsWith("select * from redeem_codes where upper(code)")) {
      const r = await one("redeem_codes", x =>
        String(x.code || "").toUpperCase() === String(params[0] || "").toUpperCase()
      );
      return { rows: r ? [r] : [] };
    }

    if (q.startsWith("update redeem_codes set used = true")) {
      const r = await one("redeem_codes", x => x.code === params[0]);
      if (r) await cloudUpdate("redeem_codes", r.id, { used: true, used_at: new Date().toISOString() });
      return { rows: [] };
    }

    if (q.startsWith("select * from badges")) {
      const rows = await cloudRows("badges");
      rows.sort((a,b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
      return { rows };
    }

    if (q.startsWith("insert into badges")) {
      if (q.includes("on conflict")) {
        const exists = await one("badges", x => x.badge_id === params[0]);
        if (exists) return { rows: [] };
      }
      const row = await cloudInsert("badges", {
        badge_id: params[0], name: params[1], icon: params[2] || "🏅", description: params[3] || ""
      });
      return { rows: [row] };
    }

    if (q.startsWith("delete from badges where badge_id")) {
      const r = await one("badges", x => x.badge_id === params[0]);
      if (r) await cloudDelete("badges", r.id);
      return { rows: [] };
    }

    if (q.startsWith("select * from events order by created_at desc")) {
      const rows = await cloudRows("events");
      rows.sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
      return { rows };
    }

    if (q.startsWith("insert into events")) {
      if (q.includes("on conflict")) {
        const exists = await one("events", x => x.event_id === params[0]);
        if (exists) return { rows: [] };
      }
      const row = await cloudInsert("events", {
        event_id: params[0], title: params[1], description: params[2] || "",
        requirement_type: params[3], requirement_value: Number(params[4]),
        reward_badge: params[5], active: params[6] === true,
        expires_at: params.length > 7 ? params[7] : null
      });
      return { rows: [row] };
    }

    if (q.startsWith("update events set active = not active")) {
      const r = await one("events", x => x.event_id === params[0]);
      if (r) await cloudUpdate("events", r.id, { active: !r.active });
      return { rows: [] };
    }

    if (q.startsWith("delete from events where event_id")) {
      const r = await one("events", x => x.event_id === params[0]);
      if (r) await cloudDelete("events", r.id);
      return { rows: [] };
    }

    if (q.includes("from game_updates") && q.startsWith("select")) {
      const rows = await cloudRows("game_updates");
      rows.sort((a,b) =>
        String(b.update_date).localeCompare(String(a.update_date)) ||
        String(b.created_at).localeCompare(String(a.created_at))
      );
      return { rows: rows.map(mapUpdateRow) };
    }

    if (q.startsWith("insert into game_updates")) {
      const row = await cloudInsert("game_updates", {
        title: params[0], description: params[1], image_url: params[2] || "",
        version: params[3] || "", category: params[4] || "Desenvolvimento",
        update_date: params[5]
      });
      return { rows: [mapUpdateRow(row)] };
    }

    if (q.startsWith("delete from game_updates where id")) {
      await cloudDelete("game_updates", Number(params[0]));
      return { rows: [] };
    }

    if (q.startsWith("insert into page_views")) {
      try {
        const row = await cloudInsert("page_views", {
          site: params[0], page: params[1], user_agent: params[2],
          language: params[3], resolution: params[4], referrer: params[5]
        });
        return { rows: [row] };
      } catch {
        return { rows: [] };
      }
    }

    if (q.includes("count(*)::int as count from page_views")) {
      let rows = [];
      try { rows = await cloudRows("page_views"); } catch {}
      if (q.includes("created_at >= current_date")) {
        const today = new Date().toISOString().slice(0,10);
        rows = rows.filter(x => String(x.created_at || "").startsWith(today));
      }
      return { rows: [{ count: rows.length }] };
    }

    if (q.startsWith("select page, count(*)::int as views from page_views")) {
      let rows = [];
      try { rows = await cloudRows("page_views"); } catch {}
      const counts = {};
      for (const r of rows) counts[r.page] = (counts[r.page] || 0) + 1;
      return {
        rows: Object.entries(counts)
          .sort((a,b)=>b[1]-a[1]).slice(0,20)
          .map(([page,views])=>({page,views}))
      };
    }

    if (q === "select data from players") {
      return { rows: (await cloudRows("players")).map(x => ({ data: x.data })) };
    }

    if (q.startsWith("select player_name, data from players")) {
      return { rows: (await cloudRows("players")).map(x => ({ player_name: x.player_name, data: x.data })) };
    }

    if (q.startsWith("update players set data = $1")) {
      const r = await one("players", x => x.player_name === params[1]);
      if (r) await cloudUpdate("players", r.id, { data: params[0] });
      return { rows: [] };
    }

    if (q === "delete from redeem_codes") {
      const rows = await cloudRows("redeem_codes");
      for (const r of rows) await cloudDelete("redeem_codes", r.id);
      return { rows: [] };
    }

    throw new Error(`Consulta não suportada no adaptador ZTR Cloud: ${q.slice(0,180)}`);
  },
  async end() {}
};

const defaultOrigins = [
  "https://racelowpoly.ztrcompany.site",
  "http://127.0.0.1:5503",
  "http://localhost:5503"
];

const allowedOrigins = (process.env.CORS_ORIGINS || defaultOrigins.join(","))
  .split(",")
  .map(origin => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.disable("x-powered-by");
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalized = origin.replace(/\/$/, "");
    if (allowedOrigins.includes(normalized)) return callback(null, true);
    return callback(new Error("Origem não permitida pelo CORS"));
  }
}));

app.use(express.json({ limit: "10mb" }));

async function initDatabase() {
  await pool.query("SELECT 1");

  await pool.query(
    `INSERT INTO badges (badge_id, name, icon, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (badge_id) DO NOTHING`,
    ["BADGE_WIN_10", "10 Vitórias", "🏆", "Ganhou 10 corridas."]
  );

  await pool.query(
    `INSERT INTO events (
      event_id, title, description, requirement_type,
      requirement_value, reward_badge, active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (event_id) DO NOTHING`,
    [
      "EVENT_WIN_10",
      "Desafio das 10 Vitórias",
      "Ganhe 10 corridas para desbloquear uma insígnia.",
      "RACES_WON",
      10,
      "BADGE_WIN_10",
      true
    ]
  );

  console.log("ZTR Cloud conectado com sucesso.");
}

function createEmptyPlayer(playerName) {
  return {
    playerName,
    level: 1,
    rank: "Novato",
    xp: 0,
    totalPlayTime: 0,
    distanceDrivenKm: 0,
    racesWon: 0,
    racesPlayed: 0,
    achievements: [],
    badges: [],
    matchHistory: []
  };
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function generateLinkCode() {
  return "LINK-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function generateRedeemCode() {
  return "EVT-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

async function getPlayer(playerName) {
  const result = await pool.query(
    "SELECT data FROM players WHERE LOWER(player_name) = LOWER($1)",
    [playerName]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0].data;
}

async function savePlayer(player) {
  await pool.query(
    `
    INSERT INTO players (player_name, data, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (player_name)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `,
    [player.playerName, player]
  );
}

function getEventCurrentValue(player, type) {
  if (type === "RACES_WON") return player.racesWon || 0;
  if (type === "RACES_PLAYED") return player.racesPlayed || 0;
  if (type === "PLAY_TIME") return player.totalPlayTime || 0;
  if (type === "DISTANCE_KM") return player.distanceDrivenKm || 0;
  if (type === "LEVEL") return player.level || 0;
  if (type === "XP") return player.xp || 0;
  return 0;
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

async function evaluateEventsForPlayer(player) {
  const eventsResult = await pool.query(
    "SELECT * FROM events WHERE active = TRUE"
  );

  for (const event of eventsResult.rows) {
    if (isExpired(event.expires_at)) continue;

    const current = getEventCurrentValue(player, event.requirement_type);

    if (current < Number(event.requirement_value)) continue;

    if (!player.badges) player.badges = [];

    if (player.badges.includes(event.reward_badge)) continue;

    const existing = await pool.query(
      `
      SELECT code FROM redeem_codes
      WHERE LOWER(player_name) = LOWER($1)
      AND event_id = $2
      AND used = FALSE
      `,
      [player.playerName, event.event_id]
    );

    if (existing.rows.length > 0) continue;

    await pool.query(
      `
      INSERT INTO redeem_codes (
        code,
        player_name,
        event_id,
        title,
        description,
        reward_badge,
        used
      )
      VALUES ($1, $2, $3, $4, $5, $6, FALSE)
      `,
      [
        generateRedeemCode(),
        player.playerName,
        event.event_id,
        event.title,
        event.description,
        event.reward_badge
      ]
    );
  }
}

async function requireLogin(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "Não autorizado" });

    const token = auth.replace("Bearer ", "");

    const result = await pool.query(
      `
      SELECT users.username, users.linked_player_name
      FROM sessions
      JOIN users ON users.username = sessions.username
      WHERE sessions.token = $1
      AND sessions.expires_at > NOW()
      `,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Não autorizado" });
    }

    req.user = {
      username: result.rows[0].username,
      linkedPlayerName: result.rows[0].linked_player_name
    };

    req.token = token;

    next();
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
}

function createAdminToken() {
  const payload = {
    sub: ADMIN_USER,
    exp: Date.now() + (12 * 60 * 60 * 1000)
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyAdminToken(token) {
  try {
    const [encoded, signature] = String(token || "").split(".");
    if (!encoded || !signature) return false;
    const expected = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(encoded).digest("base64url");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.sub === ADMIN_USER && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Admin não autorizado" });
  }

  if (!verifyAdminToken(auth.slice(7))) {
    return res.status(401).json({ error: "Admin não autorizado" });
  }

  next();
}

app.get("/", (req, res) => {
  res.json({
    status: "API ONLINE",
    service: "Race Low Poly API",
    host: "ZTR Armbian"
  });
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "ok", service: "race-low-poly-api" });
  } catch (err) {
    res.status(503).json({ status: "error", database: "offline" });
  }
});

app.post("/telemetry/pageview", async (req, res) => {
  try {
    const body = req.body || {};
    const clean = (value, max) => String(value || "").slice(0, max);
    await pool.query(
      `INSERT INTO page_views (site, page, user_agent, language, resolution, referrer)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        clean(body.site || "RACE LOW POLY", 80),
        clean(body.page || "/", 300),
        clean(req.headers["user-agent"], 500),
        clean(body.language, 80),
        clean(body.resolution, 40),
        clean(body.referrer, 500)
      ]
    );
    res.status(204).end();
  } catch (err) {
    console.error("Erro telemetry:", err.message);
    res.status(204).end();
  }
});

// AUTH

app.post("/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Usuário e senha são obrigatórios" });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: "Usuário precisa ter pelo menos 3 caracteres" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Senha precisa ter pelo menos 6 caracteres" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      `
      INSERT INTO users (username, password_hash)
      VALUES ($1, $2)
      `,
      [username, passwordHash]
    );

    res.json({
      success: true,
      message: "Conta criada com sucesso"
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Esse usuário já existe" });
    }

    res.status(500).json({ error: "Erro ao criar conta" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM users WHERE LOWER(username) = LOWER($1)",
      [username || ""]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Usuário ou senha inválidos" });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password || "", user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: "Usuário ou senha inválidos" });
    }

    const token = generateToken();

    await pool.query(
      `
      INSERT INTO sessions (username, token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '7 days')
      `,
      [user.username, token]
    );

    res.json({
      success: true,
      token,
      username: user.username,
      linkedPlayerName: user.linked_player_name
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao fazer login" });
  }
});

app.post("/auth/logout", requireLogin, async (req, res) => {
  await pool.query("DELETE FROM sessions WHERE token = $1", [req.token]);

  res.json({
    success: true,
    message: "Logout feito"
  });
});

app.get("/profile/me", requireLogin, async (req, res) => {
  if (!req.user.linkedPlayerName) {
    return res.json({
      username: req.user.username,
      linkedPlayerName: null,
      player: null
    });
  }

  const player = await getPlayer(req.user.linkedPlayerName);

  res.json({
    username: req.user.username,
    linkedPlayerName: req.user.linkedPlayerName,
    player
  });
});

// LINK CONTA

app.post("/link/create", async (req, res) => {
  try {
    const { playerName } = req.body;

    if (!playerName) {
      return res.status(400).json({ error: "playerName obrigatório" });
    }

    let player = await getPlayer(playerName);

    if (!player) {
      player = createEmptyPlayer(playerName);
      await savePlayer(player);
    }

    await pool.query(
      `
      DELETE FROM link_codes
      WHERE LOWER(player_name) = LOWER($1)
      AND used = FALSE
      `,
      [playerName]
    );

    const code = generateLinkCode();

    await pool.query(
      `
      INSERT INTO link_codes (code, player_name, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
      `,
      [code, playerName]
    );

    res.json({
      success: true,
      code
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao gerar código" });
  }
});

app.post("/link/confirm", requireLogin, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Código obrigatório" });
    }

    const result = await pool.query(
      `
      SELECT * FROM link_codes
      WHERE UPPER(code) = UPPER($1)
      `,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Código inválido" });
    }

    const link = result.rows[0];

    if (link.used) {
      return res.status(400).json({ error: "Código já utilizado" });
    }

    if (new Date(link.expires_at) < new Date()) {
      return res.status(400).json({ error: "Código expirado" });
    }

    const already = await pool.query(
      `
      SELECT username FROM users
      WHERE LOWER(linked_player_name) = LOWER($1)
      AND username <> $2
      `,
      [link.player_name, req.user.username]
    );

    if (already.rows.length > 0) {
      return res.status(403).json({ error: "Esse jogador já está vinculado a outra conta" });
    }

    await pool.query(
      "UPDATE users SET linked_player_name = $1 WHERE username = $2",
      [link.player_name, req.user.username]
    );

    await pool.query(
      `
      UPDATE link_codes
      SET used = TRUE, used_by = $1, used_at = NOW()
      WHERE code = $2
      `,
      [req.user.username, link.code]
    );

    res.json({
      success: true,
      message: "Conta vinculada com sucesso",
      linkedPlayerName: link.player_name
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao vincular conta" });
  }
});

// UNITY UPDATE

app.post("/update-player", async (req, res) => {
  try {
    const player = req.body;

    if (!player.playerName) {
      return res.status(400).json({ error: "playerName obrigatório" });
    }

    let existing = await getPlayer(player.playerName);

    if (!existing) {
      existing = createEmptyPlayer(player.playerName);
    }

    existing.playerName = player.playerName;
    existing.level = player.level || 1;
    existing.rank = player.rank || "Novato";
    existing.xp = player.xp || 0;
    existing.totalPlayTime = player.totalPlayTime || 0;
    existing.distanceDrivenKm = player.distanceDrivenKm || existing.distanceDrivenKm || 0;
    existing.racesWon = player.racesWon || 0;
    existing.racesPlayed = player.racesPlayed || 0;
    existing.achievements = player.achievements || existing.achievements || [];
    existing.badges = existing.badges || [];
    existing.matchHistory = player.matchHistory || [];

    await savePlayer(existing);
    await evaluateEventsForPlayer(existing);

    res.json({
      success: true,
      message: "Player atualizado"
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar player" });
  }
});

// EVENTOS NO JOGO

app.get("/events/progress/:playerName", async (req, res) => {
  try {
    const player = await getPlayer(req.params.playerName);

    if (!player) {
      return res.status(404).json({ error: "Jogador não encontrado" });
    }

    const events = await pool.query(
      "SELECT * FROM events WHERE active = TRUE"
    );

    const result = [];

    for (const event of events.rows) {
      if (isExpired(event.expires_at)) continue;

      const currentValue = getEventCurrentValue(player, event.requirement_type);
      const completed = currentValue >= Number(event.requirement_value);

      if (completed) continue;

      result.push({
        eventId: event.event_id,
        title: event.title,
        description: event.description,
        requirementType: event.requirement_type,
        currentValue,
        requirementValue: Number(event.requirement_value),
        rewardBadge: event.reward_badge,
        expiresAt: event.expires_at,
        completed
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Erro ao carregar eventos" });
  }
});

// REWARDS

app.get("/rewards/available", requireLogin, async (req, res) => {
  if (!req.user.linkedPlayerName) {
    return res.status(400).json({ error: "Conta não vinculada ao jogo" });
  }

  const result = await pool.query(
    `
    SELECT * FROM redeem_codes
    WHERE LOWER(player_name) = LOWER($1)
    AND used = FALSE
    `,
    [req.user.linkedPlayerName]
  );

  res.json(result.rows.map(r => ({
    code: r.code,
    playerName: r.player_name,
    eventId: r.event_id,
    title: r.title,
    description: r.description,
    rewardBadge: r.reward_badge,
    used: r.used,
    createdAt: r.created_at
  })));
});

app.post("/rewards/redeem", requireLogin, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Código obrigatório" });
    }

    if (!req.user.linkedPlayerName) {
      return res.status(400).json({ error: "Conta não vinculada ao jogo" });
    }

    const result = await pool.query(
      "SELECT * FROM redeem_codes WHERE UPPER(code) = UPPER($1)",
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Código inválido" });
    }

    const redeem = result.rows[0];

    if (redeem.used) {
      return res.status(400).json({ error: "Código já utilizado" });
    }

    if (redeem.player_name.toLowerCase() !== req.user.linkedPlayerName.toLowerCase()) {
      return res.status(403).json({ error: "Esse código não pertence à sua conta" });
    }

    const player = await getPlayer(req.user.linkedPlayerName);

    if (!player.badges) player.badges = [];

    if (!player.badges.includes(redeem.reward_badge)) {
      player.badges.push(redeem.reward_badge);
    }

    await savePlayer(player);

    await pool.query(
      "UPDATE redeem_codes SET used = TRUE, used_at = NOW() WHERE code = $1",
      [redeem.code]
    );

    res.json({
      success: true,
      message: "Insígnia resgatada com sucesso",
      badge: redeem.reward_badge
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao resgatar código" });
  }
});

// BADGES

app.get("/badges", async (req, res) => {
  const result = await pool.query("SELECT * FROM badges ORDER BY name ASC");

  res.json(result.rows.map(b => ({
    badgeId: b.badge_id,
    name: b.name,
    icon: b.icon,
    description: b.description
  })));
});

// ADMIN

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({
      success: true,
      token: createAdminToken()
    });
  }

  res.status(401).json({ error: "Admin inválido" });
});

app.get("/admin/data", requireAdmin, async (req, res) => {
  const badges = await pool.query("SELECT * FROM badges ORDER BY name ASC");
  const events = await pool.query("SELECT * FROM events ORDER BY created_at DESC");

  res.json({
    badges: badges.rows.map(b => ({
      badgeId: b.badge_id,
      name: b.name,
      icon: b.icon,
      description: b.description
    })),
    events: events.rows.map(e => ({
      eventId: e.event_id,
      title: e.title,
      description: e.description,
      requirementType: e.requirement_type,
      requirementValue: Number(e.requirement_value),
      rewardBadge: e.reward_badge,
      active: e.active,
      expiresAt: e.expires_at
    }))
  });
});

app.post("/admin/badges", requireAdmin, async (req, res) => {
  try {
    const { badgeId, name, icon, description } = req.body;

    if (!badgeId || !name) {
      return res.status(400).json({ error: "badgeId e name são obrigatórios" });
    }

    await pool.query(
      `
      INSERT INTO badges (badge_id, name, icon, description)
      VALUES ($1, $2, $3, $4)
      `,
      [badgeId, name, icon || "🏅", description || ""]
    );

    res.json({
      success: true,
      message: "Insígnia criada"
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Essa insígnia já existe" });
    }

    res.status(500).json({ error: "Erro ao criar insígnia" });
  }
});

app.delete("/admin/badges/:badgeId", requireAdmin, async (req, res) => {
  await pool.query(
    "DELETE FROM badges WHERE badge_id = $1",
    [req.params.badgeId]
  );

  res.json({
    success: true,
    message: "Insígnia excluída"
  });
});

app.post("/admin/events", requireAdmin, async (req, res) => {
  try {
    const {
      eventId,
      title,
      description,
      requirementType,
      requirementValue,
      rewardBadge,
      active,
      durationDays
    } = req.body;

    if (!eventId || !title || !requirementType || !requirementValue || !rewardBadge) {
      return res.status(400).json({ error: "Preencha todos os campos obrigatórios" });
    }

    let expiresAt = null;

    if (durationDays && Number(durationDays) > 0) {
      expiresAt = new Date(Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000);
    }

    await pool.query(
      `
      INSERT INTO events (
        event_id,
        title,
        description,
        requirement_type,
        requirement_value,
        reward_badge,
        active,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        eventId,
        title,
        description || "",
        requirementType,
        Number(requirementValue),
        rewardBadge,
        active === true,
        expiresAt
      ]
    );

    res.json({
      success: true,
      message: "Evento criado"
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Esse evento já existe" });
    }

    res.status(500).json({ error: "Erro ao criar evento" });
  }
});

app.patch("/admin/events/:eventId/toggle", requireAdmin, async (req, res) => {
  await pool.query(
    `
    UPDATE events
    SET active = NOT active
    WHERE event_id = $1
    `,
    [req.params.eventId]
  );

  res.json({
    success: true,
    message: "Status do evento alterado"
  });
});

app.delete("/admin/events/:eventId", requireAdmin, async (req, res) => {
  await pool.query(
    "DELETE FROM events WHERE event_id = $1",
    [req.params.eventId]
  );

  res.json({
    success: true,
    message: "Evento excluído"
  });
});


// GAME UPDATES

app.get("/admin/updates", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        title,
        description,
        image_url AS "imageUrl",
        version,
        category,
        update_date AS "date",
        created_at AS "createdAt"
      FROM game_updates
      ORDER BY update_date DESC, created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar atualizações" });
  }
});

app.get("/admin/analytics/summary", requireAdmin, async (req, res) => {
  try {
    const [total, today, pages] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM page_views"),
      pool.query("SELECT COUNT(*)::int AS count FROM page_views WHERE created_at >= CURRENT_DATE"),
      pool.query("SELECT page, COUNT(*)::int AS views FROM page_views GROUP BY page ORDER BY views DESC LIMIT 20")
    ]);
    res.json({ totalViews: total.rows[0].count, viewsToday: today.rows[0].count, topPages: pages.rows });
  } catch (err) {
    res.status(500).json({ error: "Erro ao carregar analytics" });
  }
});

app.get("/updates", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        title,
        description,
        image_url AS "imageUrl",
        version,
        category,
        update_date AS "date",
        created_at AS "createdAt"
      FROM game_updates
      ORDER BY update_date DESC, created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar atualizações" });
  }
});

app.post("/admin/updates", requireAdmin, async (req, res) => {
  try {
    const { title, description, imageUrl, version, category, date } = req.body;

    if (!title || !description || !date) {
      return res.status(400).json({
        error: "title, description e date são obrigatórios"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO game_updates (
        title,
        description,
        image_url,
        version,
        category,
        update_date
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        title,
        description,
        image_url AS "imageUrl",
        version,
        category,
        update_date AS "date",
        created_at AS "createdAt"
      `,
      [
        title,
        description,
        imageUrl || "",
        version || "",
        category || "Desenvolvimento",
        date
      ]
    );

    res.json({
      success: true,
      update: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar atualização" });
  }
});

app.delete("/admin/updates/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM game_updates WHERE id = $1",
      [req.params.id]
    );

    res.json({
      success: true,
      message: "Atualização excluída"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir atualização" });
  }
});

// DASHBOARDS

app.get("/dashboard/best-times", async (req, res) => {
  const players = await pool.query("SELECT data FROM players");

  const best = {};

  players.rows.forEach(row => {
    const player = row.data;

    (player.matchHistory || []).forEach(entry => {
      if (!entry.trackName) return;

      if (!best[entry.trackName] || entry.raceTime < best[entry.trackName].raceTime) {
        best[entry.trackName] = {
          trackName: entry.trackName,
          playerName: player.playerName,
          raceTime: entry.raceTime,
          date: entry.date
        };
      }
    });
  });

  res.json(Object.values(best));
});

app.get("/dashboard/top-level", async (req, res) => {
  const players = await pool.query("SELECT data FROM players");

  const ranking = players.rows
    .map(r => r.data)
    .sort((a, b) => (b.level || 0) - (a.level || 0) || (b.xp || 0) - (a.xp || 0))
    .map(p => ({
      playerName: p.playerName,
      level: p.level,
      rank: p.rank,
      xp: p.xp
    }));

  res.json(ranking);
});

app.get("/dashboard/most-playtime", async (req, res) => {
  const players = await pool.query("SELECT data FROM players");

  const ranking = players.rows
    .map(r => r.data)
    .sort((a, b) => (b.totalPlayTime || 0) - (a.totalPlayTime || 0))
    .map(p => ({
      playerName: p.playerName,
      totalPlayTime: p.totalPlayTime
    }));

  res.json(ranking);
});

app.get("/dashboard/most-wins", async (req, res) => {
  const players = await pool.query("SELECT data FROM players");

  const ranking = players.rows
    .map(r => r.data)
    .sort((a, b) => (b.racesWon || 0) - (a.racesWon || 0))
    .map(p => ({
      playerName: p.playerName,
      racesWon: p.racesWon,
      racesPlayed: p.racesPlayed
    }));

  res.json(ranking);
});

app.post("/admin/reset-dashboards", requireAdmin, async (req, res) => {
  try {
    const players = await pool.query("SELECT player_name, data FROM players");

    for (const row of players.rows) {
      const player = row.data;

      player.level = 1;
      player.rank = "Novato";
      player.xp = 0;
      player.totalPlayTime = 0;
      player.distanceDrivenKm = 0;
      player.racesWon = 0;
      player.racesPlayed = 0;
      player.matchHistory = [];

      await pool.query(
        `
        UPDATE players
        SET data = $1, updated_at = NOW()
        WHERE player_name = $2
        `,
        [player, row.player_name]
      );
    }

    await pool.query("DELETE FROM redeem_codes");

    res.json({
      success: true,
      message: "Dashboards resetados com sucesso."
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Erro ao resetar dashboards."
    });
  }
});


initDatabase()
  .then(() => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`Race Low Poly API online em http://${HOST}:${PORT}`);
    });

    const shutdown = async (signal) => {
      console.log(`${signal} recebido, encerrando...`);
      server.close(async () => {
        await pool.end().catch(() => {});
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch(err => {
    console.error("Erro ao iniciar banco:", err);
    process.exit(1);
  });