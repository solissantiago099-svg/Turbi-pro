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
  ".webmanifest": "application/manifest+json; charset=utf-8",
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
const VAPID_PUBLIC_KEY = "BOgzmxTmjpL2edxhwwe1W0MYXq_NsI-4NiJm2uNYJdMNM9HZgFNIxP6yrGJSmtnfa-aVEmAlr6nn8Q-zbQEAm7g";
const SESSION_DAYS = 30;

function decode(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function assetResponse(pathname) {
  const asset = ASSETS[pathname] || (pathname.endsWith("/") ? ASSETS[pathname + "index.html"] : null);
  if (!asset) return null;
  const noCache = pathname === "/" || pathname === "/sw.js" || pathname.endsWith(".html") || pathname.endsWith(".js") || pathname.endsWith(".css") || pathname.endsWith(".webmanifest");
  return new Response(decode(asset.body), {
    headers: {
      "content-type": asset.type,
      "cache-control": noCache ? "no-cache, no-store, must-revalidate" : "public, max-age=31536000, immutable",
    },
  });
}

async function geocode(requestUrl) {
  const query = requestUrl.searchParams.get("q") || "";
  const limit = Math.min(6, Math.max(1, Number(requestUrl.searchParams.get("limit") || 1)));
  const upstream = new URL("https://nominatim.openstreetmap.org/search");
  upstream.searchParams.set("format", "jsonv2");
  upstream.searchParams.set("limit", String(limit));
  upstream.searchParams.set("countrycodes", "ar");
  upstream.searchParams.set("accept-language", "es");
  upstream.searchParams.set("viewbox", "-59.3,-34.15,-57.7,-35.25");
  upstream.searchParams.set("bounded", "0");
  upstream.searchParams.set("addressdetails", "0");
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
function isScheduleOnlyChange(previousTask, nextTask, user) {
  const role = normalizedRole(user?.role);
  if (!["admin", "usuario", "chofer"].includes(role) || previousTask.start || !nextTask.start) return false;
  if (role === "chofer" && Number(previousTask.driverId || user.currentDriverId) !== Number(user.currentDriverId)) return false;
  const { date: previousDate, start: previousStart, status: previousStatus, updatedAt: previousUpdatedAt, ...previousContent } = previousTask;
  const { date: nextDate, start: nextStart, status: nextStatus, updatedAt: nextUpdatedAt, ...nextContent } = nextTask;
  return JSON.stringify(previousContent) === JSON.stringify(nextContent);
}

function isStatusOnlyChange(previousTask, nextTask, user) {
  if (normalizedRole(user?.role) !== "chofer") return false;
  if (Number(previousTask.driverId || user.currentDriverId) !== Number(user.currentDriverId)) return false;
  const { status: previousStatus, updatedAt: previousUpdatedAt, ...previousContent } = previousTask;
  const { status: nextStatus, updatedAt: nextUpdatedAt, ...nextContent } = nextTask;
  return previousStatus !== nextStatus && JSON.stringify(previousContent) === JSON.stringify(nextContent);
}

function isAdmin(user) {
  return normalizedRole(user?.role) === "admin";
}

function validRole(role) {
  return ["admin", "usuario", "chofer"].includes(role);
}

function timeToMinutes(value) {
  const [hours = "0", minutes = "0"] = String(value || "00:00").split(":");
  return Number(hours) * 60 + Number(minutes);
}

function buenosAiresDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function localISO(date = new Date()) {
  const parts = buenosAiresDateParts(date);
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function isPastScheduledTime(date, start, now = new Date()) {
  if (!date || !start) return false;
  const today = localISO(now);
  if (date < today) return true;
  if (date > today) return false;
  const parts = buenosAiresDateParts(now);
  return timeToMinutes(start) < Number(parts.hour) * 60 + Number(parts.minute);
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function scheduleBlocksForDate(blocks, date) {
  return (blocks || []).filter((block) => block.date === date && block.start && block.end);
}

function findScheduleBlock(task, blocks) {
  if (!task?.date || !task?.start) return null;
  const start = timeToMinutes(task.start);
  const end = start + Math.max(1, Number(task.assigned || task.duration || 1));
  return scheduleBlocksForDate(blocks, task.date).find((block) => rangesOverlap(start, end, timeToMinutes(block.start), timeToMinutes(block.end))) || null;
}

function scheduleBlockIdForTask(task) {
  return task?.scheduleBlockId || (task?.id ? "task-" + task.id : "");
}

function canEditTaskRecord(task, user) {
  return isAdmin(user) || Boolean(task?.assignedByUserId && user?.id && String(task.assignedByUserId) === String(user.id));
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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, email TEXT, name TEXT, phone TEXT, role TEXT NOT NULL DEFAULT 'chofer', current_driver_id INTEGER, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_records (type TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, date TEXT, start TEXT, driver_id INTEGER, status TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(type, id))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, updated_by TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, user_email TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, created_at TEXT NOT NULL, details TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id ON app_sessions(user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at ON app_sessions(expires_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_records_type_date ON app_records(type, date, start)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_records_type_driver ON app_records(type, driver_id, status)"),
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
  if (!userColumnNames.has("phone")) await env.DB.prepare("ALTER TABLE app_users ADD COLUMN phone TEXT").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username)").run();
  for (const user of bootstrapUsers(env)) {
    await env.DB.prepare("INSERT INTO app_users (id, username, password_hash, email, name, phone, role, current_driver_id, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash, email = excluded.email, name = excluded.name, role = excluded.role, current_driver_id = COALESCE(app_users.current_driver_id, excluded.current_driver_id)")
      .bind(user.id, user.username, user.passwordHash, user.email, user.name, "", user.role, user.currentDriverId, new Date().toISOString(), new Date().toISOString())
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
  const token = bearer(request);
  if (!token) return null;
  const user = await env.DB.prepare("SELECT u.id, u.username, u.email, u.name, u.phone, u.role, u.current_driver_id AS currentDriverId, s.expires_at AS sessionExpiresAt FROM app_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?").bind(token, now).first();
  if (user) {
    const renewAfter = Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (new Date(user.sessionExpiresAt).getTime() < renewAfter) {
      const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      env.DB.prepare("UPDATE app_sessions SET expires_at = ? WHERE token = ?").bind(expires, token).run().catch(() => null);
    }
    delete user.sessionExpiresAt;
  }
  return user || null;
}

async function login(request, env) {
  await ensureDatabase(env);
  const cleanupBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("DELETE FROM app_sessions WHERE expires_at < ?").bind(cleanupBefore).run();
  const payload = await request.json().catch(() => ({}));
  const username = String(payload.username || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const user = await env.DB.prepare("SELECT id, username, email, name, phone, role, current_driver_id AS currentDriverId, password_hash AS passwordHash FROM app_users WHERE lower(username) = ?").bind(username).first();
  const hash = await sha256("tamiz-rutas:" + password);
  if (!user || hash !== user.passwordHash) return Response.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = [...tokenBytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
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
  try {
    await env.DB.prepare("INSERT INTO app_audit (user_id, user_email, action, entity, entity_id, created_at, details) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(user.id, user.email, action, entity, entityId, new Date().toISOString(), details ? JSON.stringify(details) : null)
      .run();
  } catch (error) {
    console.warn("Audit skipped", error?.message || error);
  }
}

async function session(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  const users = (await env.DB.prepare("SELECT id, username, email, name, phone, role, current_driver_id AS currentDriverId, last_seen_at AS lastSeenAt FROM app_users ORDER BY created_at ASC, last_seen_at DESC").all()).results || [];
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
  await env.DB.prepare("INSERT INTO app_users (id, username, password_hash, email, name, phone, role, current_driver_id, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, username, hash, "", name, "", role, currentDriverId, now, now)
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
  const name = String(payload.name || user.name || "").trim();
  const phone = String(payload.phone || "").trim();
  const password = String(payload.password || "");
  if (!name) return Response.json({ error: "Nombre requerido" }, { status: 400 });
  if (password) {
    if (password.length < 4) return Response.json({ error: "La contrasena debe tener al menos 4 digitos" }, { status: 400 });
    const hash = await sha256("tamiz-rutas:" + password);
    await env.DB.prepare("UPDATE app_users SET name = ?, phone = ?, password_hash = ? WHERE id = ?").bind(name, phone, hash, user.id).run();
  } else {
    await env.DB.prepare("UPDATE app_users SET name = ?, phone = ? WHERE id = ?").bind(name, phone, user.id).run();
  }
  if (normalizedRole(user.role) === "chofer" && user.currentDriverId) {
    const driver = await readRecord(env, "driver", user.currentDriverId);
    if (driver) await storeRecord(env, "driver", { ...driver, name, phone, updatedAt: new Date().toISOString() });
  }
  const meta = await bumpRevision(env, user);
  await audit(env, user, "update-profile", "user", user.id, { phoneChanged: phone !== (user.phone || ""), passwordChanged: Boolean(password), revision: meta.revision });
  return stateResponse(env, { ...user, name, phone });
}

function recordMeta(type, record) {
  if (type !== "task") return { date: null, start: null, driverId: null, status: null };
  return {
    date: record.date || null,
    start: record.start || null,
    driverId: record.driverId ? Number(record.driverId) : null,
    status: record.status || null,
  };
}

async function storeRecord(env, type, record) {
  const id = String(record.id || crypto.randomUUID());
  const now = new Date().toISOString();
  const nextRecord = { ...record, id: record.id || id, updatedAt: record.updatedAt || now };
  const meta = recordMeta(type, nextRecord);
  await env.DB.prepare("INSERT INTO app_records (type, id, value, date, start, driver_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(type, id) DO UPDATE SET value = excluded.value, date = excluded.date, start = excluded.start, driver_id = excluded.driver_id, status = excluded.status, updated_at = excluded.updated_at")
    .bind(type, id, JSON.stringify(nextRecord), meta.date, meta.start, meta.driverId, meta.status, nextRecord.updatedAt)
    .run();
  return nextRecord;
}

async function readRecords(env, type) {
  const rows = (await env.DB.prepare("SELECT value FROM app_records WHERE type = ? ORDER BY date ASC, start ASC, updated_at ASC").bind(type).all()).results || [];
  return rows.map((row) => JSON.parse(row.value));
}

async function readRecord(env, type, id) {
  const row = await env.DB.prepare("SELECT value FROM app_records WHERE type = ? AND id = ?").bind(type, String(id)).first();
  return row ? JSON.parse(row.value) : null;
}

async function readSettings(env) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind("default").first();
  return row ? JSON.parse(row.value) : {};
}

async function writeSettings(env, settings, user) {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
    .bind("default", JSON.stringify(settings || {}), now, user?.id || null)
    .run();
}

async function readSettingKey(env, key, fallback) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first();
  return row ? JSON.parse(row.value) : fallback;
}

async function writeSettingKey(env, key, value, user) {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
    .bind(key, JSON.stringify(value), now, user?.id || null)
    .run();
}

function base64UrlBytes(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
}

function base64UrlText(value) {
  return base64UrlBytes(new TextEncoder().encode(value));
}

async function vapidToken(env, audience) {
  if (!env.TAMIZ_VAPID_PRIVATE_JWK) return "";
  const jwk = JSON.parse(env.TAMIZ_VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = base64UrlText(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64UrlText(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 43200, sub: "mailto:operaciones@tamiz.local" }));
  const unsigned = header + "." + payload;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return unsigned + "." + base64UrlBytes(signature);
}

async function readPushSubscriptions(env) {
  return await readSettingKey(env, "push_subscriptions", []);
}

async function savePushSubscription(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  const payload = await request.json();
  const subscription = payload?.subscription;
  const device = payload?.device && typeof payload.device === "object" ? payload.device : {};
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return Response.json({ error: "Suscripcion invalida" }, { status: 400 });
  }
  const current = await readPushSubscriptions(env);
  const next = current.filter((item) => item.subscription?.endpoint !== subscription.endpoint);
  next.push({
    id: crypto.randomUUID(),
    userId: user.id,
    username: user.username || "",
    role: normalizedRole(user.role),
    currentDriverId: user.currentDriverId || null,
    subscription,
    device,
    updatedAt: new Date().toISOString(),
  });
  await writeSettingKey(env, "push_subscriptions", next.slice(-250), user);
  await audit(env, user, "subscribe-push", "user", user.id);
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

function taskNotificationTargets(subscriptions, task) {
  return subscriptions.filter((item) => item?.subscription?.endpoint);
}

async function sendPush(subscription, env) {
  const endpoint = subscription?.endpoint || "";
  if (!endpoint) return { ok: false };
  const audience = new URL(endpoint).origin;
  const token = await vapidToken(env, audience);
  if (!token) return { ok: false };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      Urgency: "normal",
      Authorization: "vapid t=" + token + ", k=" + VAPID_PUBLIC_KEY,
    },
  });
  return { ok: response.ok, gone: response.status === 404 || response.status === 410 };
}

async function notifyTaskAssignment(env, task, user) {
  if (!env.TAMIZ_VAPID_PRIVATE_JWK) return;
  const subscriptions = await readPushSubscriptions(env);
  const targets = taskNotificationTargets(subscriptions, task);
  if (!targets.length) return;
  const results = await Promise.allSettled(targets.map((item) => sendPush(item.subscription, env)));
  const goneEndpoints = new Set(results.map((result, index) => result.status === "fulfilled" && result.value.gone ? targets[index].subscription.endpoint : null).filter(Boolean));
  if (goneEndpoints.size) {
    await writeSettingKey(env, "push_subscriptions", subscriptions.filter((item) => !goneEndpoints.has(item.subscription?.endpoint)), user);
  }
}

async function revisionInfo(env) {
  const row = await env.DB.prepare("SELECT revision, updated_at AS updatedAt, updated_by AS updatedBy FROM app_meta WHERE key = ?").bind("state").first();
  return row || { revision: 0, updatedAt: null, updatedBy: null };
}

async function bumpRevision(env, user) {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO app_meta (key, revision, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET revision = app_meta.revision + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
    .bind("state", 1, now, user?.id || null)
    .run();
  return revisionInfo(env);
}

async function stateData(env) {
  const tasks = await readRecords(env, "task");
  const vehicles = await readRecords(env, "vehicle");
  const drivers = await readRecords(env, "driver");
  const settings = await readSettings(env);
  if (!tasks.length && !vehicles.length && !drivers.length && !Object.keys(settings || {}).length) return null;
  return { tasks, vehicles, drivers, settings: { currentDriverId: 1, scheduleBlocks: [], ...(settings || {}) } };
}

async function runStatementChunks(env, statements, size = 25) {
  for (let index = 0; index < statements.length; index += size) {
    await env.DB.batch(statements.slice(index, index + size));
  }
}

async function migrateLegacyState(env) {
  const migrated = await env.DB.prepare("SELECT revision FROM app_meta WHERE key = ?").bind("legacy_migrated").first();
  if (migrated) return;
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS total FROM app_records").first();
  const legacyRow = await env.DB.prepare("SELECT value, revision FROM app_state WHERE key = ?").bind("default").first();
  if (Number(countRow?.total || 0) === 0 && legacyRow?.value) {
    const legacy = JSON.parse(legacyRow.value);
    const statements = [];
    for (const task of legacy.tasks || []) statements.push(env.DB.prepare("INSERT OR REPLACE INTO app_records (type, id, value, date, start, driver_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("task", String(task.id), JSON.stringify(task), task.date || null, task.start || null, task.driverId ? Number(task.driverId) : null, task.status || null, task.updatedAt || new Date().toISOString()));
    for (const vehicle of legacy.vehicles || []) statements.push(env.DB.prepare("INSERT OR REPLACE INTO app_records (type, id, value, date, start, driver_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("vehicle", String(vehicle.id), JSON.stringify(vehicle), null, null, null, vehicle.status || null, vehicle.updatedAt || new Date().toISOString()));
    for (const driver of legacy.drivers || []) statements.push(env.DB.prepare("INSERT OR REPLACE INTO app_records (type, id, value, date, start, driver_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("driver", String(driver.id), JSON.stringify(driver), null, null, null, driver.status || null, driver.updatedAt || new Date().toISOString()));
    if (legacy.settings) statements.push(env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)").bind("default", JSON.stringify(legacy.settings), new Date().toISOString(), null));
    if (statements.length) await runStatementChunks(env, statements);
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO app_meta (key, revision, updated_at, updated_by) VALUES (?, ?, ?, ?)").bind("legacy_migrated", 1, now, null),
    env.DB.prepare("INSERT INTO app_meta (key, revision, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING").bind("state", Number(legacyRow?.revision || 1), now, null),
  ]);
}

async function stateResponse(env, user) {
  await migrateLegacyState(env);
  const data = await stateData(env);
  const meta = await revisionInfo(env);
  const users = (await env.DB.prepare("SELECT id, username, email, name, phone, role, current_driver_id AS currentDriverId, last_seen_at AS lastSeenAt FROM app_users ORDER BY created_at ASC, last_seen_at DESC").all()).results || [];
  return Response.json({ data, revision: meta.revision || 0, updatedAt: meta.updatedAt || null, updatedBy: meta.updatedBy || null, user, users }, { headers: { "cache-control": "no-store" } });
}

async function replaceStateTables(env, data, user) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM app_records"),
    env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind("default"),
  ]);
  const statements = [];
  for (const task of data.tasks || []) statements.push(env.DB.prepare("INSERT OR REPLACE INTO app_records (type, id, value, date, start, driver_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("task", String(task.id), JSON.stringify(task), task.date || null, task.start || null, task.driverId ? Number(task.driverId) : null, task.status || null, task.updatedAt || new Date().toISOString()));
  for (const vehicle of data.vehicles || []) statements.push(env.DB.prepare("INSERT OR REPLACE INTO app_records (type, id, value, date, start, driver_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("vehicle", String(vehicle.id), JSON.stringify(vehicle), null, null, null, vehicle.status || null, vehicle.updatedAt || new Date().toISOString()));
  for (const driver of data.drivers || []) statements.push(env.DB.prepare("INSERT OR REPLACE INTO app_records (type, id, value, date, start, driver_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("driver", String(driver.id), JSON.stringify(driver), null, null, null, driver.status || null, driver.updatedAt || new Date().toISOString()));
  statements.push(env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)").bind("default", JSON.stringify(data.settings || {}), new Date().toISOString(), user.id));
  if (statements.length) await runStatementChunks(env, statements);
}

async function readState(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  await ensureDatabase(env);
  return stateResponse(env, user);
}

function pushPublicKey() {
  return Response.json({ publicKey: VAPID_PUBLIC_KEY, supported: true }, { headers: { "cache-control": "no-store" } });
}

async function writeState(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  await ensureDatabase(env);
  await migrateLegacyState(env);
  const payload = await request.json();
  if (!payload || typeof payload !== "object" || !payload.data || !Array.isArray(payload.data.tasks) || !Array.isArray(payload.data.vehicles) || !Array.isArray(payload.data.drivers)) {
    return Response.json({ error: "Estado invalido" }, { status: 400 });
  }
  const previousData = await stateData(env);
  const nextData = structuredClone(payload.data);
  if (previousData?.tasks) {
    const previousTasks = new Map(previousData.tasks.map(task => [String(task.id), task]));
    for (const nextTask of nextData.tasks) {
      const previousTask = previousTasks.get(String(nextTask.id));
      if (!previousTask) {
        nextTask.assignedByUserId = user.id;
        nextTask.assignedByUserName = user.name || user.username || user.email || "Usuario";
        continue;
      }
      const { status: previousStatus, updatedAt: previousUpdatedAt, ...previousContent } = previousTask;
      const { status: nextStatus, updatedAt: nextUpdatedAt, ...nextContent } = nextTask;
      if (previousStatus !== nextStatus && !isStatusOnlyChange(previousTask, nextTask, user)) {
        return Response.json({ error: "Solo el chofer asignado puede iniciar o finalizar tareas." }, { status: 403 });
      }
      if (JSON.stringify(previousContent) !== JSON.stringify(nextContent)) {
        if (!isScheduleOnlyChange(previousTask, nextTask, user) && !isAdmin(user) && (!previousTask.assignedByUserId || String(previousTask.assignedByUserId) !== String(user.id))) {
          return Response.json({ error: "Solo puede editar la tarea el usuario que la asigno o un admin." }, { status: 403 });
        }
      }
      nextTask.assignedByUserId = previousTask.assignedByUserId;
      nextTask.assignedByUserName = previousTask.assignedByUserName;
    }
  } else {
    for (const nextTask of nextData.tasks) {
      nextTask.assignedByUserId = user.id;
      nextTask.assignedByUserName = user.name || user.username || user.email || "Usuario";
    }
  }
  await replaceStateTables(env, nextData, user);
  const meta = await bumpRevision(env, user);
  await audit(env, user, payload.action || "save-state", "app_state", "default", { revision: meta.revision });
  return stateResponse(env, user);
}

async function saveTask(request, env, mode, ctx) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  await migrateLegacyState(env);
  const payload = await request.json();
  const nextTask = { ...payload, updatedAt: new Date().toISOString() };
  const existing = mode === "create" ? null : await readRecord(env, "task", nextTask.id);
  if (mode !== "create" && !existing) return Response.json({ error: "Tarea inexistente" }, { status: 404 });
  if (mode === "create") {
    nextTask.id = nextTask.id || Date.now();
    nextTask.assignedByUserId = user.id;
    nextTask.assignedByUserName = user.name || user.username || user.email || "Usuario";
  } else {
    if (!canEditTaskRecord(existing, user)) return Response.json({ error: "Solo puede editar la tarea el usuario que la asigno o un admin." }, { status: 403 });
    if (existing.status !== nextTask.status && !isStatusOnlyChange(existing, nextTask, user)) return Response.json({ error: "Solo el chofer asignado puede iniciar o finalizar tareas." }, { status: 403 });
    nextTask.assignedByUserId = existing.assignedByUserId;
    nextTask.assignedByUserName = existing.assignedByUserName;
  }
  const settings = await readSettings(env);
  const ownBlockId = scheduleBlockIdForTask(nextTask);
  const scheduleBlocks = settings.scheduleBlocks || [];
  const validationBlocks = ownBlockId ? scheduleBlocks.filter((block) => String(block.id) !== String(ownBlockId)) : scheduleBlocks;
  if ((!existing || existing.date !== nextTask.date || existing.start !== nextTask.start) && isPastScheduledTime(nextTask.date, nextTask.start)) {
    return Response.json({ error: "No se puede asignar una tarea en un horario que ya paso." }, { status: 400 });
  }
  const blocked = findScheduleBlock(nextTask, validationBlocks);
  if (blocked) return Response.json({ error: "Ese horario esta bloqueado: " + (blocked.title || "Bloqueo operativo") + "." }, { status: 400 });
  let block = null;
  if (nextTask.isScheduleBlock) {
    const start = timeToMinutes(nextTask.start);
    const fallbackEnd = start + Number(nextTask.duration || nextTask.assigned || 1);
    const blockEnd = nextTask.blockEnd || String(Math.floor(fallbackEnd / 60)).padStart(2, "0") + ":" + String(fallbackEnd % 60).padStart(2, "0");
    if (!nextTask.date || !nextTask.start || timeToMinutes(blockEnd) <= start) return Response.json({ error: "El horario de fin debe ser posterior al inicio." }, { status: 400 });
    block = {
      id: ownBlockId,
      date: nextTask.date,
      start: nextTask.start,
      end: blockEnd,
      title: nextTask.title || "Bloqueo operativo",
      taskId: nextTask.id,
      createdAt: nextTask.createdAt || new Date().toISOString(),
    };
  }
  await storeRecord(env, "task", nextTask);
  if (block) {
    const nextBlocks = [...scheduleBlocks.filter((item) => String(item.id) !== String(block.id)), block];
    await writeSettings(env, { ...settings, scheduleBlocks: nextBlocks }, user);
  } else if (existing?.scheduleBlockId) {
    const nextBlocks = scheduleBlocks.filter((item) => String(item.id) !== String(existing.scheduleBlockId));
    await writeSettings(env, { ...settings, scheduleBlocks: nextBlocks }, user);
  }
  const meta = await bumpRevision(env, user);
  await audit(env, user, mode === "create" ? "create-task" : "update-task", "task", String(nextTask.id), { revision: meta.revision });
  const shouldNotify = nextTask.driverId && (mode === "create" || Number(existing?.driverId || 0) !== Number(nextTask.driverId));
  if (shouldNotify) {
    const notification = notifyTaskAssignment(env, nextTask, user).catch(() => null);
    if (ctx?.waitUntil) ctx.waitUntil(notification);
    else await notification;
  }
  return stateResponse(env, user);
}

async function updateTaskStatus(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  await migrateLegacyState(env);
  const payload = await request.json();
  const task = await readRecord(env, "task", payload.id);
  if (!task) return Response.json({ error: "Tarea inexistente" }, { status: 404 });
  const nextTask = { ...task, status: payload.status, updatedAt: new Date().toISOString() };
  if (!isStatusOnlyChange(task, nextTask, user)) return Response.json({ error: "Solo el chofer asignado puede iniciar o finalizar tareas." }, { status: 403 });
  await storeRecord(env, "task", nextTask);
  const meta = await bumpRevision(env, user);
  await audit(env, user, "update-task-status", "task", String(task.id), { status: payload.status, revision: meta.revision });
  return stateResponse(env, user);
}

async function scheduleTaskRecord(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  await migrateLegacyState(env);
  if (!["admin", "usuario", "chofer"].includes(normalizedRole(user.role))) return Response.json({ error: "Solo el chofer o supervisor puede asignar horario." }, { status: 403 });
  const payload = await request.json();
  const task = await readRecord(env, "task", payload.id);
  if (!task) return Response.json({ error: "Tarea inexistente" }, { status: 404 });
  if (task.start) return Response.json({ error: "Esta tarea ya tiene un horario asignado." }, { status: 400 });
  if (normalizedRole(user.role) === "chofer" && Number(task.driverId || user.currentDriverId) !== Number(user.currentDriverId)) return Response.json({ error: "Esta tarea no esta asignada a este chofer." }, { status: 403 });
  const nextTask = { ...task, date: payload.date || task.date, start: payload.start || "", updatedAt: new Date().toISOString() };
  if (isPastScheduledTime(nextTask.date, nextTask.start)) return Response.json({ error: "No se puede asignar una tarea en un horario que ya paso." }, { status: 400 });
  const settings = await readSettings(env);
  const blocked = findScheduleBlock(nextTask, settings.scheduleBlocks || []);
  if (blocked) return Response.json({ error: "Ese horario esta bloqueado: " + (blocked.title || "Bloqueo operativo") + "." }, { status: 400 });
  await storeRecord(env, "task", nextTask);
  const meta = await bumpRevision(env, user);
  await audit(env, user, "schedule-task", "task", String(task.id), { revision: meta.revision });
  return stateResponse(env, user);
}

async function deleteTaskRecord(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  await migrateLegacyState(env);
  const payload = await request.json();
  const task = await readRecord(env, "task", payload.id);
  if (!task) return Response.json({ error: "Tarea inexistente" }, { status: 404 });
  if (!canEditTaskRecord(task, user)) return Response.json({ error: "Solo puede eliminar la tarea el usuario que la asigno o un admin." }, { status: 403 });
  await env.DB.prepare("DELETE FROM app_records WHERE type = ? AND id = ?").bind("task", String(payload.id)).run();
  if (task.isScheduleBlock) {
    const settings = await readSettings(env);
    const blockId = scheduleBlockIdForTask(task);
    await writeSettings(env, { ...settings, scheduleBlocks: (settings.scheduleBlocks || []).filter((block) => String(block.id) !== String(blockId)) }, user);
  }
  const meta = await bumpRevision(env, user);
  await audit(env, user, "delete-task", "task", String(payload.id), { revision: meta.revision });
  return stateResponse(env, user);
}

async function saveRecordEndpoint(request, env, type) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  if (!isAdmin(user)) return Response.json({ error: "No autorizado" }, { status: 403 });
  await migrateLegacyState(env);
  const payload = await request.json();
  await storeRecord(env, type, { ...payload, updatedAt: new Date().toISOString() });
  const meta = await bumpRevision(env, user);
  await audit(env, user, "save-" + type, type, String(payload.id), { revision: meta.revision });
  return stateResponse(env, user);
}

async function saveLegalEntities(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  if (!isAdmin(user)) return Response.json({ error: "No autorizado" }, { status: 403 });
  await migrateLegacyState(env);
  const payload = await request.json();
  if (!Array.isArray(payload.entities) || payload.entities.length !== 4) {
    return Response.json({ error: "Deben guardarse las cuatro razones sociales." }, { status: 400 });
  }
  const entities = payload.entities.map((entity, index) => ({
    id: String(entity?.id || ("razon-social-" + (index + 1))),
    name: String(entity?.name || "").trim(),
    cuit: String(entity?.cuit || "").trim(),
    email: String(entity?.email || "").trim(),
    afip: entity?.afip || null,
    iibb: entity?.iibb || null,
  }));
  const settings = await readSettings(env);
  await writeSettings(env, { ...settings, legalEntities: entities }, user);
  const meta = await bumpRevision(env, user);
  await audit(env, user, "save-legal-entities", "settings", "default", { revision: meta.revision });
  return stateResponse(env, user);
}
async function saveScheduleBlocks(request, env) {
  const user = await currentUser(request, env);
  if (!user) return Response.json({ error: "Se requiere inicio de sesion" }, { status: 401 });
  if (!isAdmin(user)) return Response.json({ error: "No autorizado" }, { status: 403 });
  await migrateLegacyState(env);
  const payload = await request.json();
  const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
  const invalidBlock = blocks.find((block) => !block?.date || !block.start || !block.end || timeToMinutes(block.start) >= timeToMinutes(block.end));
  if (invalidBlock) return Response.json({ error: "El horario de fin debe ser posterior al inicio." }, { status: 400 });
  const settings = await readSettings(env);
  await writeSettings(env, { ...settings, scheduleBlocks: blocks }, user);
  const meta = await bumpRevision(env, user);
  await audit(env, user, "save-schedule-blocks", "settings", "default", { revision: meta.revision });
  return stateResponse(env, user);
}

export default {
  async fetch(request, env, ctx) {
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
    if (url.pathname === "/api/push/public-key" && request.method === "GET") return pushPublicKey();
    if (url.pathname === "/api/push/subscribe" && request.method === "POST") return savePushSubscription(request, env);
    if (url.pathname === "/api/tasks" && request.method === "POST") return saveTask(request, env, "create", ctx);
    if (url.pathname === "/api/tasks" && request.method === "PUT") return saveTask(request, env, "edit", ctx);
    if (url.pathname === "/api/tasks" && request.method === "DELETE") return deleteTaskRecord(request, env);
    if (url.pathname === "/api/tasks/status" && request.method === "PUT") return updateTaskStatus(request, env);
    if (url.pathname === "/api/tasks/schedule" && request.method === "PUT") return scheduleTaskRecord(request, env);
    if (url.pathname === "/api/drivers" && ["POST", "PUT"].includes(request.method)) return saveRecordEndpoint(request, env, "driver");
    if (url.pathname === "/api/vehicles" && ["POST", "PUT"].includes(request.method)) return saveRecordEndpoint(request, env, "vehicle");
    if (url.pathname === "/api/legal-entities" && request.method === "PUT") return saveLegalEntities(request, env);
    if (url.pathname === "/api/schedule-blocks" && request.method === "PUT") return saveScheduleBlocks(request, env);
    return assetResponse(url.pathname) || new Response("404 - Archivo no encontrado", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
`;

fs.writeFileSync(path.join(server, "index.js"), worker);
console.log("Build listo en dist/server/index.js");
