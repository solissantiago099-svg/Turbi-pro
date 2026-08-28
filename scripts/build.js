const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const server = path.join(dist, "server");
const assetFiles = ["index.html", "styles.css", "js/app.js"];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(server, { recursive: true });

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const assets = Object.fromEntries(assetFiles.map((file) => {
  const absolute = path.join(root, file);
  return [`/${file.replaceAll("\\", "/")}`, {
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
  return new Response(decode(asset.body), {
    headers: {
      "content-type": asset.type,
      "cache-control": pathname === "/" || pathname.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable",
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

async function ensureDatabase(env) {
  if (!env.DB) throw new Error("No hay base D1 configurada");
  if (databaseReady) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, updated_by TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_state_updated_at ON app_state(updated_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, email TEXT, name TEXT, role TEXT NOT NULL DEFAULT 'chofer', current_driver_id INTEGER, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, user_email TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, created_at TEXT NOT NULL, details TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_audit_created_at ON app_audit(created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_audit_entity ON app_audit(entity, entity_id)"),
  ]);
  const columns = await env.DB.prepare("PRAGMA table_info(app_state)").all();
  const columnNames = new Set((columns.results || []).map(column => column.name));
  if (!columnNames.has("revision")) await env.DB.prepare("ALTER TABLE app_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0").run();
  if (!columnNames.has("updated_by")) await env.DB.prepare("ALTER TABLE app_state ADD COLUMN updated_by TEXT").run();
  await env.DB.prepare("PRAGMA optimize").run();
  databaseReady = true;
}

function decodeName(request) {
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (!encoded || request.headers.get("oai-authenticated-user-full-name-encoding") !== "percent-encoded-utf-8") return "";
  try { return decodeURIComponent(encoded); } catch { return ""; }
}

async function currentUser(request, env) {
  await ensureDatabase(env);
  const headerId = request.headers.get("oai-authenticated-user-id");
  const hostname = new URL(request.url).hostname;
  if (!headerId && hostname !== "localhost" && hostname !== "127.0.0.1") return null;
  const id = headerId || "local-preview-user";
  const email = request.headers.get("oai-authenticated-user-email") || "local@tamiz";
  const name = decodeName(request) || email;
  const now = new Date().toISOString();
  let user = await env.DB.prepare("SELECT id, email, name, role, current_driver_id AS currentDriverId FROM app_users WHERE id = ?").bind(id).first();
  if (!user) {
    const supervisors = await env.DB.prepare("SELECT COUNT(*) AS total FROM app_users WHERE role = ?").bind("supervisor").first();
    const role = Number(supervisors?.total || 0) === 0 ? "supervisor" : "chofer";
    await env.DB.prepare("INSERT INTO app_users (id, email, name, role, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, email, name, role, now, now)
      .run();
    user = { id, email, name, role, currentDriverId: null };
  } else {
    await env.DB.prepare("UPDATE app_users SET email = ?, name = ?, last_seen_at = ? WHERE id = ?").bind(email, name, now, id).run();
    user.email = email; user.name = name;
  }
  return user;
}

async function audit(env, user, action, entity, entityId, details = null) {
  await env.DB.prepare("INSERT INTO app_audit (user_id, user_email, action, entity, entity_id, created_at, details) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(user.id, user.email, action, entity, entityId, new Date().toISOString(), details ? JSON.stringify(details) : null)
    .run();
}

async function session(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  const users = user.role === "supervisor"
    ? (await env.DB.prepare("SELECT id, email, name, role, current_driver_id AS currentDriverId, last_seen_at AS lastSeenAt FROM app_users ORDER BY last_seen_at DESC").all()).results
    : [];
  return Response.json({ user, users }, { headers: { "cache-control": "no-store" } });
}

async function updateUser(request, env) {
  const actor = await currentUser(request, env);
  if (!actor) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  if (actor.role !== "supervisor") return Response.json({ error: "No autorizado" }, { status: 403 });
  const payload = await request.json();
  if (!payload?.id || !["supervisor", "chofer"].includes(payload.role)) return Response.json({ error: "Usuario invalido" }, { status: 400 });
  await env.DB.prepare("UPDATE app_users SET role = ?, current_driver_id = ? WHERE id = ?").bind(payload.role, payload.currentDriverId || null, payload.id).run();
  await audit(env, actor, "update-role", "user", payload.id, { role: payload.role, currentDriverId: payload.currentDriverId || null });
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
    if (url.pathname === "/api/geocode") return geocode(url);
    if (url.pathname === "/api/route") return route(url);
    if (url.pathname === "/api/session" && request.method === "GET") return session(request, env);
    if (url.pathname === "/api/me" && request.method === "PUT") return updateMe(request, env);
    if (url.pathname === "/api/users" && request.method === "PUT") return updateUser(request, env);
    if (url.pathname === "/api/state" && request.method === "GET") return readState(request, env);
    if (url.pathname === "/api/state" && request.method === "PUT") return writeState(request, env);
    return assetResponse(url.pathname) || new Response("404 - Archivo no encontrado", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
`;

fs.writeFileSync(path.join(server, "index.js"), worker);
console.log("Build listo en dist/server/index.js");
