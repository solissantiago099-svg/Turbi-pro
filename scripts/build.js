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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/geocode") return geocode(url);
    if (url.pathname === "/api/route") return route(url);
    return assetResponse(url.pathname) || new Response("404 - Archivo no encontrado", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
`;

fs.writeFileSync(path.join(server, "index.js"), worker);
console.log("Build listo en dist/server/index.js");
