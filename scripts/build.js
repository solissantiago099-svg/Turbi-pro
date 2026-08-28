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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_app_state_updated_at ON app_state(updated_at)"),
  ]);
  await env.DB.prepare("PRAGMA optimize").run();
  databaseReady = true;
}

async function readState(env) {
  await ensureDatabase(env);
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE key = ?").bind("default").first();
  return Response.json({ data: row ? JSON.parse(row.value) : null }, { headers: { "cache-control": "no-store" } });
}

async function writeState(request, env) {
  await ensureDatabase(env);
  const payload = await request.json();
  if (!payload || typeof payload !== "object" || !payload.data || !Array.isArray(payload.data.tasks) || !Array.isArray(payload.data.vehicles) || !Array.isArray(payload.data.drivers)) {
    return Response.json({ error: "Estado invalido" }, { status: 400 });
  }
  await env.DB.prepare("INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind("default", JSON.stringify(payload.data), new Date().toISOString())
    .run();
  return Response.json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/geocode") return geocode(url);
    if (url.pathname === "/api/route") return route(url);
    if (url.pathname === "/api/state" && request.method === "GET") return readState(env);
    if (url.pathname === "/api/state" && request.method === "PUT") return writeState(request, env);
    return assetResponse(url.pathname) || new Response("404 - Archivo no encontrado", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
`;

fs.writeFileSync(path.join(server, "index.js"), worker);
console.log("Build listo en dist/server/index.js");
