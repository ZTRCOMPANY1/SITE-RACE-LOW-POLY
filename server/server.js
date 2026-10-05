const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ADMIN_USER = process.env.ADMIN_USER || "ZTR@2023";
const ADMIN_PASS = process.env.ADMIN_PASS;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const DB_SSL = ["1", "true", "yes"].includes(String(process.env.DB_SSL || "0").toLowerCase());
const DB_SCHEMA = String(process.env.DB_SCHEMA || "race_low_poly").trim();

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(DB_SCHEMA)) {
  console.error("ERRO: DB_SCHEMA inválido.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("ERRO: DATABASE_URL não configurado.");
  process.exit(1);
}

if (!ADMIN_PASS || !ADMIN_TOKEN_SECRET) {
  console.error("ERRO: ADMIN_PASS e ADMIN_TOKEN_SECRET precisam estar configurados.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: DB_SSL ? { rejectUnauthorized: false } : false,
  options: `-c search_path=${DB_SCHEMA},public`,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

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
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${DB_SCHEMA}"`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      linked_player_name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      player_name TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS link_codes (
      code TEXT PRIMARY KEY,
      player_name TEXT NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      used_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS badges (
      badge_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '🏅',
      description TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      requirement_type TEXT NOT NULL,
      requirement_value FLOAT NOT NULL,
      reward_badge TEXT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS redeem_codes (
      code TEXT PRIMARY KEY,
      player_name TEXT NOT NULL,
      event_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      reward_badge TEXT NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      used_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_updates (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT,
      version TEXT,
      category TEXT DEFAULT 'Desenvolvimento',
      update_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS page_views (
      id BIGSERIAL PRIMARY KEY,
      site TEXT NOT NULL DEFAULT 'RACE LOW POLY',
      page TEXT NOT NULL,
      user_agent TEXT,
      language TEXT,
      resolution TEXT,
      referrer TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_page_views_page ON page_views(page);
  `);

  await pool.query(`
    INSERT INTO badges (badge_id, name, icon, description)
    VALUES ('BADGE_WIN_10', '10 Vitórias', '🏆', 'Ganhou 10 corridas.')
    ON CONFLICT (badge_id) DO NOTHING;
  `);

  await pool.query(`
    INSERT INTO events (
      event_id,
      title,
      description,
      requirement_type,
      requirement_value,
      reward_badge,
      active
    )
    VALUES (
      'EVENT_WIN_10',
      'Desafio das 10 Vitórias',
      'Ganhe 10 corridas para desbloquear uma insígnia.',
      'RACES_WON',
      10,
      'BADGE_WIN_10',
      TRUE
    )
    ON CONFLICT (event_id) DO NOTHING;
  `);

  console.log("Banco iniciado com sucesso.");
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