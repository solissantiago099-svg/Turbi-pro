const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const server = path.join(dist, "server");
const out = path.join(root, "out");

const nextBin = require.resolve("next/dist/bin/next");
const nextBuild = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});

if (nextBuild.status !== 0) {
  process.exit(nextBuild.status || 1);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(server, { recursive: true });

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolute) : [absolute];
  });
}

const assets = Object.fromEntries(listFiles(out).map((absolute) => {
  const file = path.relative(out, absolute).replaceAll("\\", "/");
  return [`/${file}`, {
    type: contentTypes[path.extname(file)] || "application/octet-stream",
    body: fs.readFileSync(absolute).toString("base64"),
  }];
}));

assets["/"] = assets["/index.html"];

const worker = `const ASSETS = ${JSON.stringify(assets)};

function decode(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function assetResponse(pathname) {
  const asset = ASSETS[pathname] || (pathname.endsWith("/") ? ASSETS[pathname + "index.html"] : null);
  if (!asset) return null;
  const noCache = pathname === "/" || pathname.endsWith(".html") || pathname.endsWith(".js") || pathname.endsWith(".css");
  return new Response(decode(asset.body), {
    headers: {
      "content-type": asset.type,
      "cache-control": noCache ? "no-cache, no-store, must-revalidate" : "public, max-age=31536000, immutable",
    },
  });
}

async function geocode(requestUrl) {
  const query = requestUrl.searchParams.get("q") || "";
  const upstream = new URL("https://nominatim.openstreetmap.org/search");
  upstream.searchParams.set("format", "jsonv2");
  upstream.searchParams.set("limit", "1");
  upstream.searchParams.set("countrycodes", "ar");
  upstream.searchParams.set("accept-language", "es");
  upstream.searchParams.set("q", query);
  const response = await fetch(upstream, { headers: { "user-agent": "TAMIZ-RUTAS/1.0 hosted" } });
  return new Response(response.body, { status: response.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function route(requestUrl) {
  const coordinates = requestUrl.searchParams.get("coordinates") || "";
  if (!/^-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?(;?-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?)+$/.test(coordinates)) {
    return Response.json({ error: "Coordenadas invalidas" }, { status: 400 });
  }
  const upstream = new URL("https://router.project-osrm.org/route/v1/driving/" + coordinates);
  upstream.searchParams.set("overview", "false");
  upstream.searchParams.set("steps", "false");
  const response = await fetch(upstream, { headers: { "user-agent": "TAMIZ-RUTAS/1.0 hosted" } });
  return new Response(response.body, { status: response.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

let databaseReady;

function normalizedRole(role) {
  return role === "supervisor" ? "admin" : role || "chofer";
}

function isAdmin(user) {
  return normalizedRole(user?.role) === "admin";
}

function validRole(role) {
  return ["admin", "usuario", "chofer"].includes(role);
}

function bootstrapUsers(env) {
  if (!env.TAMIZ_BOOTSTRAP_USERNAME || !env.TAMIZ_BOOTSTRAP_PASSWORD_HASH) return [];
  const role = normalizedRole(env.TAMIZ_BOOTSTRAP_ROLE || "admin");
  return [{
    id: env.TAMIZ_BOOTSTRAP_ID || env.TAMIZ_BOOTSTRAP_USERNAME,
    username: String(env.TAMIZ_BOOTSTRAP_USERNAME).trim().toLowerCase(),
    passwordHash: env.TAMIZ_BOOTSTRAP_PASSWORD_HASH,
    name: env.TAMIZ_BOOTSTRAP_NAME || "Administrador",
    email: env.TAMIZ_BOOTSTRAP_EMAIL || "",
    role: validRole(role) ? role : "admin",
    currentDriverId: env.TAMIZ_BOOTSTRAP_DRIVER_ID ? Number(env.TAMIZ_BOOTSTRAP_DRIVER_ID) : null,
  }];
}

async function ensureDatabase(env) {
  if (!env.DB) throw new Error("No hay base D1 configurada");
  if (databaseReady) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, updated_by TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_state_updated_at ON app_state(updated_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, email TEXT, name TEXT, role TEXT NOT NULL DEFAULT 'chofer', current_driver_id INTEGER, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, user_email TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, created_at TEXT NOT NULL, details TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id ON app_sessions(user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at ON app_sessions(expires_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_audit_created_at ON app_audit(created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_audit_entity ON app_audit(entity, entity_id)"),
  ]);
  const columns = await env.DB.prepare("PRAGMA table_info(app_state)").all();
  const columnNames = new Set((columns.results || []).map(column => column.name));
  if (!columnNames.has("revision")) await env.DB.prepare("ALTER TABLE app_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0").run();
  if (!columnNames.has("updated_by")) await env.DB.prepare("ALTER TABLE app_state ADD COLUMN updated_by TEXT").run();
  const userColumns = await env.DB.prepare("PRAGMA table_info(app_users)").all();
  const userColumnNames = new Set((userColumns.results || []).map(column => column.name));
  if (!userColumnNames.has("username")) await env.DB.prepare("ALTER TABLE app_users ADD COLUMN username TEXT").run();
  if (!userColumnNames.has("password_hash")) await env.DB.prepare("ALTER TABLE app_users ADD COLUMN password_hash TEXT").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username)").run();
  for (const user of bootstrapUsers(env)) {
    await env.DB.prepare("INSERT INTO app_users (id, username, password_hash, email, name, role, current_driver_id, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash, email = excluded.email, name = excluded.name, role = excluded.role, current_driver_id = COALESCE(app_users.current_driver_id, excluded.current_driver_id)")
      .bind(user.id, user.username, user.passwordHash, user.email, user.name, user.role, user.currentDriverId, new Date().toISOString(), new Date().toISOString())
      .run();
  }
  await env.DB.prepare("PRAGMA optimize").run();
  databaseReady = true;
}

function bearer(request) {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function currentUser(request, env) {
  await ensureDatabase(env);
  const now = new Date().toISOString();
  await env.DB.prepare("DELETE FROM app_sessions WHERE expires_at < ?").bind(now).run();
  const token = bearer(request);
  if (!token) return null;
  const user = await env.DB.prepare("SELECT u.id, u.username, u.email, u.name, u.role, u.current_driver_id AS currentDriverId FROM app_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?").bind(token, now).first();
  if (!user) return null;
  await env.DB.prepare("UPDATE app_users SET last_seen_at = ? WHERE id = ?").bind(now, user.id).run();
  return user;
}

async function login(request, env) {
  await ensureDatabase(env);
  const payload = await request.json().catch(() => ({}));
  const username = String(payload.username || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const user = await env.DB.prepare("SELECT id, username, email, name, role, current_driver_id AS currentDriverId, password_hash AS passwordHash FROM app_users WHERE lower(username) = ?").bind(username).first();
  const hash = await sha256("tamiz-rutas:" + password);
  if (!user || hash !== user.passwordHash) return Response.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = [...tokenBytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await env.DB.prepare("INSERT INTO app_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(token, user.id, now.toISOString(), expires.toISOString()).run();
  await audit(env, user, "login", "user", user.id);
  delete user.passwordHash;
  return Response.json({ token, user });
}

async function logout(request, env) {
  await ensureDatabase(env);
  const token = bearer(request);
  if (token) await env.DB.prepare("DELETE FROM app_sessions WHERE token = ?").bind(token).run();
  return Response.json({ ok: true });
}

async function audit(env, user, action, entity, entityId, details = null) {
  await env.DB.prepare("INSERT INTO app_audit (user_id, user_email, action, entity, entity_id, created_at, details) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(user.id, user.email, action, entity, entityId, new Date().toISOString(), details ? JSON.stringify(details) : null)
    .run();
}

async function session(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  const users = isAdmin(user)
    ? (await env.DB.prepare("SELECT id, username, email, name, role, current_driver_id AS currentDriverId, last_seen_at AS lastSeenAt FROM app_users ORDER BY created_at ASC, last_seen_at DESC").all()).results
    : [];
  return Response.json({ user, users }, { headers: { "cache-control": "no-store" } });
}

async function createUser(request, env) {
  const actor = await currentUser(request, env);
  if (!actor) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  if (!isAdmin(actor)) return Response.json({ error: "No autorizado" }, { status: 403 });
  const payload = await request.json();
  const username = String(payload?.username || "").trim().toLowerCase();
  const name = String(payload?.name || "").trim();
  const password = String(payload?.password || "");
  const role = validRole(payload?.role) ? payload.role : "usuario";
  const currentDriverId = role === "chofer" && payload.currentDriverId ? Number(payload.currentDriverId) : null;
  if (!username || !name || password.length < 4) return Response.json({ error: "Usuario invalido" }, { status: 400 });
  const exists = await env.DB.prepare("SELECT id FROM app_users WHERE lower(username) = ?").bind(username).first();
  if (exists) return Response.json({ error: "Ese usuario ya existe" }, { status: 409 });
  const id = crypto.randomUUID();
  const hash = await sha256("tamiz-rutas:" + password);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO app_users (id, username, password_hash, email, name, role, current_driver_id, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, username, hash, "", name, role, currentDriverId, now, now)
    .run();
  await audit(env, actor, "create-user", "user", id, { username, role, currentDriverId });
  return session(request, env);
}

async function updateUser(request, env) {
  const actor = await currentUser(request, env);
  if (!actor) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  if (!isAdmin(actor)) return Response.json({ error: "No autorizado" }, { status: 403 });
  const payload = await request.json();
  if (!payload?.id || !validRole(payload.role)) return Response.json({ error: "Usuario invalido" }, { status: 400 });
  const existing = await env.DB.prepare("SELECT id FROM app_users WHERE id = ?").bind(payload.id).first();
  if (!existing) return Response.json({ error: "Usuario inexistente" }, { status: 404 });
  const name = String(payload.name || "").trim();
  const password = String(payload.password || "");
  const currentDriverId = payload.role === "chofer" && payload.currentDriverId ? Number(payload.currentDriverId) : null;
  if (!name) return Response.json({ error: "Nombre requerido" }, { status: 400 });
  if (password) {
    if (password.length < 4) return Response.json({ error: "La contrasena debe tener al menos 4 digitos" }, { status: 400 });
    const hash = await sha256("tamiz-rutas:" + password);
    await env.DB.prepare("UPDATE app_users SET name = ?, role = ?, current_driver_id = ?, password_hash = ? WHERE id = ?").bind(name, payload.role, currentDriverId, hash, payload.id).run();
  } else {
    await env.DB.prepare("UPDATE app_users SET name = ?, role = ?, current_driver_id = ? WHERE id = ?").bind(name, payload.role, currentDriverId, payload.id).run();
  }
  await audit(env, actor, "update-user", "user", payload.id, { role: payload.role, currentDriverId, passwordChanged: Boolean(password) });
  return session(request, env);
}

async function updateMe(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  const payload = await request.json();
  await env.DB.prepare("UPDATE app_users SET current_driver_id = ? WHERE id = ?").bind(payload.currentDriverId || null, user.id).run();
  await audit(env, user, "update-preference", "user", user.id, { currentDriverId: payload.currentDriverId || null });
  return session(request, env);
}

async function readState(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  await ensureDatabase(env);
  const row = await env.DB.prepare("SELECT value, revision, updated_at AS updatedAt, updated_by AS updatedBy FROM app_state WHERE key = ?").bind("default").first();
  return Response.json({ data: row ? JSON.parse(row.value) : null, revision: row?.revision || 0, updatedAt: row?.updatedAt || null, updatedBy: row?.updatedBy || null, user }, { headers: { "cache-control": "no-store" } });
}

async function writeState(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  await ensureDatabase(env);
  const payload = await request.json();
  if (!payload || typeof payload !== "object" || !payload.data || !Array.isArray(payload.data.tasks) || !Array.isArray(payload.data.vehicles) || !Array.isArray(payload.data.drivers)) {
    return Response.json({ error: "Estado invalido" }, { status: 400 });
  }
  const row = await env.DB.prepare("SELECT revision FROM app_state WHERE key = ?").bind("default").first();
  const currentRevision = row?.revision || 0;
  if (row && Number(payload.revision || 0) !== currentRevision) {
    const current = await env.DB.prepare("SELECT value, revision, updated_at AS updatedAt, updated_by AS updatedBy FROM app_state WHERE key = ?").bind("default").first();
    return Response.json({ error: "version-conflict", data: JSON.parse(current.value), revision: current.revision, updatedAt: current.updatedAt, updatedBy: current.updatedBy }, { status: 409 });
  }
  const nextRevision = currentRevision + 1;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO app_state (key, value, revision, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, revision = excluded.revision, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
    .bind("default", JSON.stringify(payload.data), nextRevision, now, user.id)
    .run();
  await audit(env, user, payload.action || "save-state", "app_state", "default", { revision: nextRevision });
  return Response.json({ ok: true, revision: nextRevision, updatedAt: now, updatedBy: user.id, user });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/login" && request.method === "POST") return login(request, env);
    if (url.pathname === "/api/logout" && request.method === "POST") return logout(request, env);
    if (url.pathname === "/api/geocode") return geocode(url);
    if (url.pathname === "/api/route") return route(url);
    if (url.pathname === "/api/session" && request.method === "GET") return session(request, env);
    if (url.pathname === "/api/me" && request.method === "PUT") return updateMe(request, env);
    if (url.pathname === "/api/users" && request.method === "POST") return createUser(request, env);
    if (url.pathname === "/api/users" && request.method === "PUT") return updateUser(request, env);
    if (url.pathname === "/api/state" && request.method === "GET") return readState(request, env);
    if (url.pathname === "/api/state" && request.method === "PUT") return writeState(request, env);
    return assetResponse(url.pathname) || new Response("404 - Archivo no encontrado", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
`;

fs.writeFileSync(path.join(server, "index.js"), worker);
console.log("Build listo en dist/server/index.js");
