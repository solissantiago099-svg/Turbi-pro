const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
function localISO(date = new Date()) { const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 10); }
function addDays(days) { const date = new Date(); date.setDate(date.getDate() + days); return localISO(date); }
function minutesFromTime(value) { if (!value) return 0; const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; }
function timeFromDate(value) { return value ? new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "—"; }
function escapeHTML(value = "") { return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function statusLabel(status) { return ({ pendiente: "Pendiente", "en-trabajo": "En trabajo", "en-destino": "En destino", realizada: "Realizada", cancelada: "Cancelada" })[status] || status; }
function daysUntil(iso) { return Math.ceil((new Date(`${iso}T12:00:00`) - new Date()) / 86_400_000); }

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function readStorage(key, fallback) { try { const raw = localStorage.getItem(key); return raw === null ? clone(fallback) : JSON.parse(raw); } catch (error) { console.warn(`No se pudo leer ${key}.`, error); return clone(fallback); } }
function writeStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (error) { console.error(`No se pudo guardar ${key}.`, error); return false; } }
const storage = {
  load(seedData) { return { tasks: readStorage("tamiz_tasks", seedData.tasks), vehicles: readStorage("tamiz_vehicles", seedData.vehicles), drivers: readStorage("tamiz_drivers", seedData.drivers), settings: readStorage("tamiz_settings", seedData.settings) }; },
  save(database) { return [writeStorage("tamiz_tasks", database.tasks), writeStorage("tamiz_vehicles", database.vehicles), writeStorage("tamiz_drivers", database.drivers), writeStorage("tamiz_settings", database.settings)].every(Boolean); },
};

function encodeMap(value) { return encodeURIComponent(value || ""); }
function osmDirectionsURL(coordinates) { if (!coordinates?.length || coordinates.length < 2) return null; const first = coordinates[0], last = coordinates[coordinates.length - 1]; return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${first[1]},${first[0]};${last[1]},${last[0]}`; }
function taskRouteURL(task) { return osmDirectionsURL(task.routeCoordinates) || `https://www.openstreetmap.org/search?query=${encodeMap(task.destination || task.origin)}`; }
function dayRouteURL(tasks) { const ordered = [...tasks].sort((a, b) => a.start.localeCompare(b.start)); if (!ordered.length) return null; const firstCoordinates = ordered.find(task => task.routeCoordinates?.length)?.routeCoordinates; const lastCoordinates = [...ordered].reverse().find(task => task.routeCoordinates?.length)?.routeCoordinates; if (firstCoordinates && lastCoordinates) return osmDirectionsURL([firstCoordinates[0], lastCoordinates[lastCoordinates.length - 1]]); return `https://www.openstreetmap.org/search?query=${encodeMap(ordered[0].origin)}`; }

const seed = {
  tasks: [
    { id: 1, date: localISO(), start: "07:30", origin: "Juncal 4431, CABA", destination: "Av. Rafael Obligado 1229, CABA", description: "Retirar 12 cajas de bebidas y entregarlas.", merchandise: "Bebidas", quantities: "12 cajas", contact: "Martín González", phone: "1144442222", assignedBy: "Logística", observations: "Ingresar por portón 2", status: "pendiente", duration: 35, distance: 18.2, vehicleId: 1, driverId: 1, stops: [] },
    { id: 2, date: localISO(), start: "10:00", origin: "Av. Cantilo 7350, CABA", destination: "Av. San Martín 1470, Caseros", description: "Entrega de mercadería.", merchandise: "Insumos de catering", quantities: "8 bultos", contact: "Laura Díaz", phone: "1155556677", assignedBy: "Eventos", observations: "", status: "en-trabajo", duration: 50, distance: 22.8, vehicleId: 1, driverId: 1, stops: [], actualStart: new Date().toISOString() },
  ],
  drivers: [{ id: 1, name: "Juan Pérez", phone: "11 5555-5555", license: "B2", licenseExpiry: addDays(55), status: "disponible" }],
  vehicles: [{ id: 1, name: "Camioneta 01", brand: "IVECO", model: "Daily", plate: "AE 123 CD", km: 58000, health: 94, status: "disponible", fuel: "Diésel", consumption: 11.5, driver: { name: "Juan Pérez", licenseExpiry: addDays(55) }, docs: [{ name: "Cédula verde", expiry: addDays(240) }, { name: "RTO", expiry: addDays(18) }, { name: "Seguro / póliza", expiry: addDays(90) }], maintenance: [{ year: 2026, km: 58000, title: "Cambio de aceite" }, { year: 2026, km: 52000, title: "Cambio de cubiertas" }, { year: 2026, km: 46000, title: "Pastillas de freno" }, { year: 2026, km: 42000, title: "Batería" }, { year: 2026, km: 39000, title: "Distribución" }], plan: [{ title: "Cambio de aceite", nextKm: 68000 }, { title: "Service general", nextKm: 70000 }] }],
  settings: { role: "supervisor", currentDriverId: 1, demoMaps: true },
};

const db = storage.load(seed);
let activeView = "agenda";
let syncRevision = 0;
let syncSaving = false;
let currentUser = null;
let sessionToken = localStorage.getItem("tamiz_session") || "";
let authRequestId = 0;

function currentUserName() {
  return currentUser?.name || currentUser?.email || currentUser?.username || "Usuario";
}

function setUserPill(label) {
  const pill = $(".user-pill");
  if (!pill) return;
  pill.textContent = label || `${currentUser?.role === "chofer" ? "Chofer" : "Supervisor"} · ${currentUserName()}`;
}

function applyRoleAccess() {
  setUserPill();
  const restricted = currentUser?.role === "chofer" ? new Set(["nueva", "supervision", "vehiculos", "choferes", "reportes"]) : new Set();
  $$("[data-view]").forEach(button => {
    const blocked = restricted.has(button.dataset.view);
    button.disabled = blocked;
    button.title = blocked ? "Disponible para supervisores" : "";
  });
  if (restricted.has(activeView)) show("ruta");
}

function mergeRemote(payload, silent = false) {
  if (!payload?.data) return false;
  Object.assign(db, payload.data);
  db.settings ||= {};
  storage.save(db);
  syncRevision = Number(payload.revision || syncRevision || 0);
  if (payload.user) currentUser = { ...currentUser, ...payload.user };
  applyRoleAccess();
  show(activeView);
  if (!silent) toast("Datos sincronizados con la base");
  return true;
}

function authHeaders(extra = {}) {
  return sessionToken ? { ...extra, authorization: `Bearer ${sessionToken}` } : extra;
}

function showLogin(message = "") {
  const loginScreen = $("#login-screen");
  document.body.classList.add("logged-out");
  document.body.classList.remove("auth-loading");
  loginScreen.hidden = false;
  loginScreen.classList.remove("is-hidden");
  loginScreen.style.display = "";
  $("#login-error").hidden = !message;
  if (message) $("#login-error").textContent = message;
}

function showApp() {
  const loginScreen = $("#login-screen");
  document.body.classList.remove("logged-out", "auth-loading");
  loginScreen.hidden = true;
  loginScreen.classList.add("is-hidden");
  loginScreen.style.display = "none";
}

function safeShow(view, options = {}) {
  try {
    show(view, options);
  } catch (error) {
    console.error("No se pudo renderizar la vista.", error);
    document.body.classList.remove("logged-out", "auth-loading", "menu-open");
    $("#login-screen").hidden = true;
    const main = $("main");
    if (main) {
      main.innerHTML = `<section class="view active"><div class="empty"><h2>Sesión iniciada</h2><p>Entraste correctamente, pero la agenda no pudo dibujarse en este navegador. Recargá la página o probá desde Chrome.</p></div></section>`;
    }
    toast("Entraste, pero hubo un problema al mostrar la agenda.", "error");
  }
}

async function login(username, password) {
  ++authRequestId;
  sessionToken = "";
  localStorage.removeItem("tamiz_session");
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo iniciar sesión");
  sessionToken = payload.token;
  localStorage.setItem("tamiz_session", sessionToken);
  currentUser = payload.user;
  showApp();
  activeView = currentUser.role === "chofer" ? "ruta" : "agenda";
  await loadRemoteData();
  safeShow(activeView);
  if (!$("#login-screen").hidden && !$("#login-screen").classList.contains("is-hidden")) throw new Error("La sesión inició, pero la pantalla no cambió. Recargá y volvé a intentar.");
}

async function logout() {
  authRequestId += 1;
  try { await fetch("/api/logout", { method: "POST", headers: authHeaders() }); } catch {}
  sessionToken = "";
  currentUser = null;
  localStorage.removeItem("tamiz_session");
  showLogin();
}

async function restoreSession() {
  const requestId = ++authRequestId;
  const tokenToRestore = sessionToken;
  if (!sessionToken) return showLogin();
  try {
    const response = await fetch("/api/session", { headers: { accept: "application/json", authorization: `Bearer ${tokenToRestore}` } });
    if (requestId !== authRequestId) return;
    if (!response.ok) throw new Error("Sesión vencida");
    const payload = await response.json();
    currentUser = payload.user;
    showApp();
    activeView = currentUser.role === "chofer" ? "ruta" : "agenda";
    await loadRemoteData();
    safeShow(activeView);
  } catch {
    if (requestId !== authRequestId) return;
    localStorage.removeItem("tamiz_session");
    sessionToken = "";
    showLogin("Tu sesión venció. Volvé a ingresar.");
  }
}

async function loadRemoteData() {
  try {
    const response = await fetch("/api/state", { headers: authHeaders({ accept: "application/json" }) });
    if (response.status === 401) return logout();
    if (!response.ok) throw new Error(`Estado remoto ${response.status}`);
    const payload = await response.json();
    if (payload.user) currentUser = { ...currentUser, ...payload.user };
    if (!payload.data) {
      await saveRemoteData("Base inicializada");
      applyRoleAccess();
      return;
    }
    mergeRemote(payload);
  } catch (error) {
    console.warn("No se pudo sincronizar con la base.", error);
    toast("Modo local: no se pudo conectar con la base", "error");
  }
}

async function saveRemoteData(message, action = "save-state") {
  if (syncSaving) return;
  syncSaving = true;
  try {
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ data: db, revision: syncRevision, action }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409) {
      mergeRemote(payload);
      toast("Otro usuario guardó cambios. Actualicé tu pantalla.", "error");
      return;
    }
    if (!response.ok) throw new Error(`Guardado remoto ${response.status}`);
    syncRevision = Number(payload.revision || syncRevision);
    if (payload.user) currentUser = { ...currentUser, ...payload.user };
    applyRoleAccess();
  } catch (error) {
    console.warn("No se pudo guardar en la base.", error);
    toast("Guardado local. La base no respondió.", "error");
  } finally {
    syncSaving = false;
  }
}

async function refreshRemoteData() {
  if (syncSaving || !sessionToken) return;
  try {
    const response = await fetch("/api/state", { headers: authHeaders({ accept: "application/json" }) });
    if (response.status === 401) return logout();
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.user) currentUser = { ...currentUser, ...payload.user };
    if (Number(payload.revision || 0) > syncRevision) mergeRemote(payload, true);
    else applyRoleAccess();
  } catch (error) {
    console.warn("No se pudo refrescar la base.", error);
  }
}

const defaultFrequentAddresses = [
  { name: "Depósito Tamarindo", address: "Tamarindo 1858, Ituzaingó" },
  { name: "Juncal", address: "Juncal 4431, CABA" },
  { name: "Cantilo", address: "Av. Cantilo 7350, CABA" },
  { name: "Caseros", address: "Av. San Martín 1470, Caseros" },
  { name: "Costanera", address: "Av. Rafael Obligado 1229, CABA" },
];
if (!Array.isArray(db.settings.frequentAddresses) || !db.settings.frequentAddresses.length) db.settings.frequentAddresses = defaultFrequentAddresses;
db.tasks = db.tasks.map(task => ({ stops: [], status: "pendiente", ...task }));
if (!db.drivers.length) db.drivers = seed.drivers;
let routeFilter = "todas";
let agendaCursor = new Date();
let agendaSelectedDate = localISO();
let agendaFocusTaskId = null;
let destinationTimer;
let routeEstimateTimer;

const viewMeta = {
  ruta: ["Mi ruta", "Operación diaria del chofer"], agenda: ["Agenda", "Planificación mensual"], nueva: ["Nueva tarea", "Crear y asignar un recorrido"], supervision: ["Supervisión", "Centro de control operativo"], vehiculos: ["Datos de vehículo", "Documentación, estado y mantenimiento"], choferes: ["Choferes", "Disponibilidad y registros"], reportes: ["Reportes", "Indicadores y exportación"], contactos: ["Contactos", "Referencias de entrega"], configuracion: ["Configuración", "Datos y preferencias"],
};

function persist(message = "Cambios guardados", action = "save-state") {
  if (storage.save(db)) { toast(message); saveRemoteData(message, action); }
  else toast("No se pudo guardar. Revisá el espacio del navegador.", "error");
}

function toast(message, type = "ok") {
  let element = $("#toast");
  if (!element) { element = document.createElement("div"); element.id = "toast"; document.body.append(element); }
  element.className = `toast ${type}`;
  element.textContent = message;
  element.classList.add("visible");
  setTimeout(() => element.classList.remove("visible"), 2600);
}

function show(view, options = {}) {
  activeView = view;
  closeAgendaTaskModal(); closeVehicleEditor();
  $$("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach(section => section.classList.toggle("active", section.id === view));
  $("#title").textContent = viewMeta[view][0];
  $("#subtitle").textContent = viewMeta[view][1];
  document.body.classList.remove("menu-open");
  ({ ruta: renderRoute, agenda: renderAgenda, nueva: () => renderNewTask(options.date, options.time), supervision: renderSupervision, vehiculos: renderVehicles, choferes: renderDrivers, reportes: renderReports, contactos: renderContacts, configuracion: renderSettings })[view]();
}

function currentDriverTasks() {
  const driverId = currentUser.currentDriverId || db.settings.currentDriverId;
  return db.tasks.filter(task => task.date === localISO() && (!task.driverId || task.driverId === driverId));
}

function delayFor(task) {
  if (!task.actualStart) return 0;
  const actual = new Date(task.actualStart);
  const planned = minutesFromTime(task.start);
  return actual.getHours() * 60 + actual.getMinutes() - planned;
}

function routeSummary(tasks) {
  const active = tasks.find(task => ["en-trabajo", "en-destino"].includes(task.status));
  const delay = active ? delayFor(active) : 0;
  return delay > 0 ? `Demora actual: ${delay} min` : delay < 0 ? `Adelanto actual: ${Math.abs(delay)} min` : "Jornada en horario";
}

function taskDetails(task) {
  const vehicle = db.vehicles.find(item => item.id === task.vehicleId);
  const stopText = task.stops?.length ? task.stops.map(stop => escapeHTML(typeof stop === "string" ? stop : stop.address)).join(" · ") : "Sin paradas";
  const destinationSeconds = task.actualArrival && task.status === "en-destino" ? Math.max(0, Math.floor((Date.now() - new Date(task.actualArrival)) / 1000)) : task.destinationSeconds || 0;
  return `<div class="detail hidden">
    <div class="detail-grid"><p><b>Tarea</b><span>${escapeHTML(task.description || "Sin descripción")}</span></p><p><b>Mercadería</b><span>${escapeHTML(task.merchandise || "—")}</span></p><p><b>Cantidades</b><span>${escapeHTML(task.quantities || "—")}</span></p>${task.merchandisePdf?.data ? `<p><b>Documento adjunto</b><span><a class="pdf-link" href="${task.merchandisePdf.data}" target="_blank" download="${escapeHTML(task.merchandisePdf.name)}">Abrir PDF · ${escapeHTML(task.merchandisePdf.name)}</a></span></p>` : ""}<p><b>Paradas</b><span>${stopText}</span></p><p><b>Contacto</b><span>${escapeHTML(task.contact || "—")} · ${escapeHTML(task.phone || "—")}</span></p><p><b>Asignada por</b><span>${escapeHTML(task.assignedBy || "—")}</span></p><p><b>Observaciones</b><span>${escapeHTML(task.observations || "—")}</span></p><p><b>Planificación</b><span>${task.start} · ${task.duration || 0} min · ${task.distance || 0} km</span></p><p><b>Vehículo</b><span>${escapeHTML(vehicle ? `${vehicle.name} · ${vehicle.plate}` : "Sin asignar")}</span></p><p><b>Estado</b><span class="status ${task.status}">${statusLabel(task.status)}</span></p></div>
    <div class="time-strip"><span>Inicio real <b>${timeFromDate(task.actualStart)}</b></span><span>Llegada <b>${timeFromDate(task.actualArrival)}</b></span><span>En destino <b class="destination-time" data-arrival="${task.actualArrival || ""}" data-fixed="${task.destinationSeconds || 0}">${Math.floor(destinationSeconds / 60)} min</b></span><span>Finalización <b>${timeFromDate(task.actualEnd)}</b></span></div>
    <div class="actions"><button class="btn" data-action="map">OpenStreetMap</button>${task.phone ? '<button class="btn" data-action="call">Llamar</button>' : ""}${task.status === "pendiente" ? '<button class="btn primary" data-action="start">Iniciar tarea</button>' : ""}${task.status === "en-trabajo" ? '<button class="btn primary" data-action="arrive">En destino</button>' : ""}${task.status === "en-destino" ? '<button class="btn primary" data-action="finish">Finalizar tarea</button>' : ""}${!["realizada", "cancelada"].includes(task.status) ? '<button class="btn warning" data-action="problem">Informar problema</button>' : ""}${!["realizada", "cancelada"].includes(task.status) ? '<button class="btn danger" data-action="cancel">Cancelar tarea</button>' : ""}<label class="btn file-btn">Adjuntar comprobante<input type="file" data-action="file" accept="image/*,.pdf"></label>${task.receipt ? `<span class="receipt">Adjunto: ${escapeHTML(task.receipt.name)}</span>` : ""}</div>
  </div>`;
}

function renderRoute() {
  clearInterval(destinationTimer);
  const all = currentDriverTasks().sort((a, b) => a.start.localeCompare(b.start));
  const tasks = all.filter(task => routeFilter === "todas" || task.status === routeFilter);
  $("#ruta").innerHTML = `<div class="route-hero"><div><span class="eyebrow">HOY · 07:00 A 19:00</span><h2>${new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}</h2><p>${routeSummary(all)}</p></div><button class="btn primary large" id="full-route" ${all.filter(t => !["realizada", "cancelada"].includes(t.status)).length ? "" : "disabled"}>Ver mi ruta en OpenStreetMap</button></div>
  <div class="filters" role="group" aria-label="Filtrar tareas">${[["todas", "Todas"], ["pendiente", "Pendientes"], ["en-trabajo", "En trabajo"], ["en-destino", "En destino"], ["realizada", "Realizadas"]].map(([value, label]) => `<button class="chip ${routeFilter === value ? "active" : ""}" data-filter="${value}">${label}</button>`).join("")}</div>
  <div id="task-list" class="task-list">${tasks.length ? tasks.map(task => `<article class="task-card ${task.status}" data-task="${task.id}"><button class="task-head" aria-expanded="false"><b>${task.start} hs</b><span>${escapeHTML(task.origin)}</span><span class="dest">${escapeHTML(task.destination)}</span><span class="status-dot" title="${statusLabel(task.status)}"></span><span class="chevron">⌄</span></button>${taskDetails(task)}</article>`).join("") : '<div class="empty"><b>No hay tareas en este filtro.</b><span>Las tareas futuras siguen disponibles en “Todas”.</span></div>'}</div>`;
  $$("[data-filter]", $("#ruta")).forEach(button => button.onclick = () => { routeFilter = button.dataset.filter; renderRoute(); });
  $("#full-route")?.addEventListener("click", () => { const url = dayRouteURL(all.filter(t => !["realizada", "cancelada"].includes(t.status))); if (url) window.open(url, "_blank", "noopener"); });
  $$(".task-card", $("#ruta")).forEach(bindTaskCard);
  destinationTimer = setInterval(updateDestinationTimers, 1000);
}

function bindTaskCard(card) {
  const task = db.tasks.find(item => String(item.id) === card.dataset.task);
  const head = $(".task-head", card);
  head.onclick = () => { const detail = $(".detail", card); detail.classList.toggle("hidden"); head.setAttribute("aria-expanded", String(!detail.classList.contains("hidden"))); };
  $$('[data-action]', card).forEach(control => control.onchange = control.onclick = event => {
    event.stopPropagation(); const action = control.dataset.action;
    if (action === "map") return window.open(taskRouteURL(task), "_blank", "noopener");
    if (action === "call") return location.href = `tel:${task.phone}`;
    if (action === "cancel") { if (confirm("¿Cancelar esta tarea?")) { task.status = "cancelada"; task.audit = [...(task.audit || []), { action: "cancel", at: new Date().toISOString(), user: currentUserName() }]; persist("Tarea cancelada", "task-cancel"); renderRoute(); } return; }
    if (action === "file") { const file = control.files?.[0]; if (file) { if (file.size > 1_500_000) return toast("El archivo supera 1,5 MB.", "error"); const reader = new FileReader(); reader.onload = () => { task.receipt = { name: file.name, type: file.type, data: reader.result, savedAt: new Date().toISOString() }; persist("Comprobante guardado"); renderRoute(); }; reader.readAsDataURL(file); } return; }
    if (action === "problem") { const note = prompt("Describí el problema:"); if (note) { task.incidents = [...(task.incidents || []), { note, at: new Date().toISOString() }]; persist("Incidencia informada"); } return; }
    const now = new Date().toISOString();
    if (action === "start") { task.status = "en-trabajo"; task.actualStart = now; }
    if (action === "arrive") { task.status = "en-destino"; task.actualArrival = now; }
    if (action === "finish") { task.status = "realizada"; task.actualEnd = now; task.destinationSeconds = task.actualArrival ? Math.floor((Date.now() - new Date(task.actualArrival)) / 1000) : 0; }
    task.audit = [...(task.audit || []), { action, at: now, user: currentUserName() }];
    persist(`Tarea actualizada: ${statusLabel(task.status)}`, `task-${action}`); renderRoute();
  });
}

function updateDestinationTimers() {
  $$(".destination-time[data-arrival]").forEach(element => { if (!element.dataset.arrival) return; const seconds = Math.max(0, Math.floor((Date.now() - new Date(element.dataset.arrival)) / 1000)); element.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; });
}

function accordion(title, body, open = false) { open = false; return `<section class="accordion card"><button type="button" class="accordion-head"><b>${title}</b><span>⌄</span></button><div class="accordion-body ${open ? "" : "hidden"}">${body}</div></section>`; }

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function geocodeAddress(address) {
  const normalized = address.trim().toLocaleLowerCase("es-AR");
  db.settings.geocodeCache ||= {};
  if (db.settings.geocodeCache[normalized]) return db.settings.geocodeCache[normalized];
  const query = /argentina/i.test(address) ? address : `${address}, Argentina`;
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(`El geocodificador respondió ${response.status}`);
  const result = (await response.json())[0];
  if (!result) throw new Error(`No se encontró la dirección: ${address}`);
  const coordinates = [Number(result.lon), Number(result.lat)];
  db.settings.geocodeCache[normalized] = coordinates;
  return coordinates;
}

async function calculateOSRMRoute(form) {
  const origin = form.elements.origin.value.trim(), destination = form.elements.destination.value.trim();
  const stopAddresses = form.elements.stops.value.split("\n").map(value => value.trim()).filter(Boolean);
  if (!origin || (!destination && !stopAddresses.length)) return;
  const notice = $("#validation"), submit = $(".form-actions .primary", form);
  notice.className = "notice"; notice.textContent = "Buscando direcciones y calculando la ruta con OSRM..."; submit.disabled = true;
  try {
    const addresses = [origin, ...stopAddresses, ...(destination ? [destination] : [])];
    const coordinates = [];
    for (const address of addresses) { coordinates.push(await geocodeAddress(address)); if (coordinates.length < addresses.length) await wait(1050); }
    const coordinatePath = coordinates.map(point => `${point[0]},${point[1]}`).join(";");
    const response = await fetch(`/api/route?coordinates=${encodeURIComponent(coordinatePath)}`);
    if (!response.ok) throw new Error(`OSRM respondió ${response.status}`);
    const payload = await response.json(); const route = payload.routes?.[0];
    if (payload.code !== "Ok" || !route) throw new Error(payload.message || "OSRM no encontró una ruta");
    const minutes = Math.max(1, Math.ceil(route.duration / 60));
    form.elements.assigned.value = minutes; form.elements.duration.value = minutes; form.dataset.distance = (route.distance / 1000).toFixed(1); form.dataset.routeCoordinates = JSON.stringify(coordinates);
    notice.className = "notice success"; notice.innerHTML = `${minutes} min · ${form.dataset.distance} km, estimado por OSRM. <small>Sin tráfico en vivo · © OpenStreetMap contributors</small>`;
    form.dispatchEvent(new Event("route-updated"));
  } catch (error) {
    form.elements.assigned.value = ""; form.elements.duration.value = ""; form.dataset.distance = ""; form.dataset.routeCoordinates = "";
    notice.className = "notice error"; notice.textContent = `${error.message}. Revisá las direcciones.`;
  } finally { submit.disabled = false; }
}

function fileToDataURL(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }

function renderNewTask(prefill = localISO(), prefillTime = "") {
  const driverOptions = db.drivers.map(d => `<option value="${d.id}">${escapeHTML(d.name)} · registro ${d.licenseExpiry}</option>`).join("");
  const vehicleOptions = db.vehicles.map(v => `<option value="${v.id}">${escapeHTML(v.name)} · ${escapeHTML(v.plate)}</option>`).join("");
  const frequentAddresses = db.settings.frequentAddresses || defaultFrequentAddresses;
  const quickAddresses = target => `<div class="quick-addresses"><span>Frecuentes</span>${frequentAddresses.map(item => `<button type="button" class="quick-address" data-address-target="${target}" data-address="${escapeHTML(item.address)}" title="${escapeHTML(item.address)}">${escapeHTML(item.name)}</button>`).join("")}</div>`;
  const addressOptions = `<datalist id="frequent-addresses">${frequentAddresses.map(item => `<option value="${escapeHTML(item.address)}">${escapeHTML(item.name)}</option>`).join("")}</datalist>`;
  $("#nueva").innerHTML = `<div class="form-layout"><form id="task-form">${accordion("1. Tarea a realizar", '<label>Título</label><input name="title" required><div class="row"><div><label>Mercadería <small>(opcional)</small></label><input name="merchandise"></div><div><label>Cantidades <small>(opcional)</small></label><input name="quantities"></div></div><label>Adjuntar PDF de mercadería o cantidades <small>(opcional · máximo 1,5 MB)</small></label><label class="pdf-upload"><input type="file" name="merchandisePdf" accept="application/pdf,.pdf"><span>Seleccionar archivo PDF</span><small id="pdf-file-name">Ningún archivo seleccionado</small></label><label>Observaciones</label><textarea name="observations"></textarea>', true)}${accordion("2. Fecha y hora", `<div class="row"><div><label>Fecha</label><input type="date" name="date" value="${prefill}" required></div><div><label>Hora de inicio</label><input type="time" name="start" value="${prefillTime}" required></div></div><label>Duración calculada por OSRM (min)</label><input type="number" min="1" name="assigned" readonly><input type="hidden" name="duration"><div id="validation" class="notice">El destino final es opcional. Podés cargar varias direcciones en Paradas.</div>`, true)}${accordion("3. Origen y destino", `<label>Dirección de origen</label><input name="origin" list="frequent-addresses" autocomplete="off" required>${quickAddresses("origin")}<label>Paradas (una dirección por línea)</label><textarea name="stops"></textarea><label>Dirección de destino <small>(opcional)</small></label><input name="destination" list="frequent-addresses" autocomplete="off" placeholder="Podés dejarla vacía y usar varias paradas">${quickAddresses("destination")}${addressOptions}`, true)}${accordion("4. Contacto", '<div class="row"><div><label>Persona</label><input name="contact"></div><div><label>Teléfono</label><input name="phone" inputmode="tel"></div></div><label>Área que asigna</label><input name="assignedBy">')}<input type="hidden" name="driverId" value="${db.settings.currentDriverId || db.drivers[0]?.id || ""}"><input type="hidden" name="vehicleId" value="${db.vehicles.find(vehicle => !["en-taller", "fuera-de-servicio"].includes(vehicle.status))?.id || db.vehicles[0]?.id || ""}"><div class="form-actions"><button type="button" class="btn" data-view="ruta">Cancelar</button><button class="btn primary">Guardar y asignar tarea</button></div></form><aside class="summary card"><span class="eyebrow">RESUMEN</span><div id="preview">Completá los campos para ver el recorrido.</div></aside></div>`;
  $$(".accordion-head", $("#nueva")).forEach(head => head.onclick = () => head.nextElementSibling.classList.toggle("hidden"));
  $("[data-view='ruta']", $("#nueva")).onclick = () => show("ruta");
  const form = $("#task-form");
  $$("[data-address-target]", form).forEach(button => button.onclick = () => { const input = form.elements[button.dataset.addressTarget]; input.value = button.dataset.address; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); });
  const updatePreview = () => { const data = new FormData(form), estimated = Number(data.get("duration")); $("#preview").innerHTML = `<p><b>${escapeHTML(data.get("title") || "Nueva tarea")}</b></p><p>${escapeHTML(data.get("origin") || "Origen")} → ${escapeHTML(data.get("destination") || "Destino opcional / paradas")}</p><p>${data.get("start") || "—"} · ${estimated || "sin calcular"} min${form.dataset.distance ? ` · ${form.dataset.distance} km` : ""}</p>`; };
  form.oninput = event => { updatePreview(); if (["origin", "destination", "stops"].includes(event.target.name)) { clearTimeout(routeEstimateTimer); form.elements.assigned.value = ""; form.elements.duration.value = ""; form.dataset.distance = ""; routeEstimateTimer = setTimeout(() => calculateOSRMRoute(form), 900); } }; form.addEventListener("route-updated", updatePreview);
  form.onsubmit = async event => { event.preventDefault(); const data = new FormData(form), assigned = Number(data.get("assigned")), duration = Number(data.get("duration")); const start = minutesFromTime(data.get("start")), end = start + assigned; const conflict = db.tasks.some(task => task.date === data.get("date") && Number(task.driverId) === Number(data.get("driverId")) && start < minutesFromTime(task.start) + Number(task.assigned || task.duration || 0) && end > minutesFromTime(task.start)); if (conflict) return toast("El chofer ya tiene una tarea en ese intervalo.", "error"); const driver = db.drivers.find(d => d.id === Number(data.get("driverId"))); const vehicle = db.vehicles.find(v => v.id === Number(data.get("vehicleId"))); if (driver && daysUntil(driver.licenseExpiry) < 0) return toast("El registro del chofer está vencido.", "error"); if (!vehicle || ["en-taller", "fuera-de-servicio"].includes(vehicle.status)) return toast("El vehículo no está disponible.", "error"); const invalidDoc = vehicle.docs?.find(doc => ["RTO", "Seguro / póliza"].includes(doc.name) && daysUntil(doc.expiry) < 0); if (invalidDoc) return toast(`${invalidDoc.name} está vencido.`, "error"); const pdfFile = form.elements.merchandisePdf.files[0]; let merchandisePdf = null; if (pdfFile) { if (pdfFile.type !== "application/pdf") return toast("El adjunto debe ser un archivo PDF.", "error"); if (pdfFile.size > 1500000) return toast("El PDF supera el máximo de 1,5 MB.", "error"); try { merchandisePdf = { name: pdfFile.name, size: pdfFile.size, data: await fileToDataURL(pdfFile) }; } catch { return toast("No se pudo leer el PDF.", "error"); } } const newTask = { id: Date.now(), title: data.get("title"), description: data.get("title"), merchandise: data.get("merchandise"), quantities: data.get("quantities"), merchandisePdf, observations: data.get("observations"), date: data.get("date"), start: data.get("start"), assigned, duration, origin: data.get("origin"), destination: data.get("destination"), stops: String(data.get("stops") || "").split("\n").map(s => s.trim()).filter(Boolean), contact: data.get("contact"), phone: data.get("phone"), assignedBy: data.get("assignedBy"), driverId: Number(data.get("driverId")), vehicleId: Number(data.get("vehicleId")), distance: Number(form.dataset.distance || 0), routeCoordinates: form.dataset.routeCoordinates ? JSON.parse(form.dataset.routeCoordinates) : [], status: "pendiente", createdAt: new Date().toISOString(), createdBy: currentUserName(), audit: [{ action: "created", at: new Date().toISOString(), user: currentUserName() }] }; db.tasks.push(newTask); agendaFocusTaskId = newTask.id; persist("Tarea guardada y visible en Agenda", "task-create"); agendaSelectedDate = data.get("date"); agendaCursor = agendaDate(agendaSelectedDate); show("agenda"); };
}

function addMinutes(time, minutes) { if (!time) return "—"; const total = minutesFromTime(time) + minutes; return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }

function agendaDate(iso) { return new Date(`${iso}T12:00:00`); }
function shiftAgendaDay(days) { const date = agendaDate(agendaSelectedDate); date.setDate(date.getDate() + days); agendaSelectedDate = localISO(date); agendaCursor = date; renderAgenda(); }

function renderAgenda() {
  const selected = agendaDate(agendaSelectedDate);
  const monday = new Date(selected); monday.setDate(selected.getDate() - ((selected.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(monday); date.setDate(monday.getDate() + index); const iso = localISO(date); return { date, iso, count: db.tasks.filter(task => task.date === iso).length }; });
  $("#agenda").innerHTML = `<div class="daily-agenda-head"><div><span class="eyebrow">AGENDA DIARIA</span><h2>${selected.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2></div><div class="daily-nav"><button class="btn" id="previous-day" aria-label="Día anterior">‹</button><button class="btn" id="agenda-today">Hoy</button><button class="btn" id="next-day" aria-label="Día siguiente">›</button></div></div><div class="week-strip">${days.map(day => `<button class="week-day ${day.iso === agendaSelectedDate ? "selected" : ""} ${day.iso === localISO() ? "today" : ""}" data-agenda-date="${day.iso}"><span>${day.date.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "")}</span><b>${day.date.getDate()}</b>${day.count ? `<i>${day.count}</i>` : ""}</button>`).join("")}</div><div id="daily-schedule"></div>`;
  $("#previous-day").onclick = () => shiftAgendaDay(-1);
  $("#next-day").onclick = () => shiftAgendaDay(1);
  $("#agenda-today").onclick = () => { agendaSelectedDate = localISO(); agendaCursor = new Date(); renderAgenda(); };
  $$('[data-agenda-date]', $('#agenda')).forEach(button => button.onclick = () => { agendaSelectedDate = button.dataset.agendaDate; agendaCursor = agendaDate(agendaSelectedDate); renderAgenda(); });
  renderDay(agendaSelectedDate);
}

function closeAgendaTaskModal() {
  const modal = $("#agenda-task-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function openAgendaTaskModal(task) {
  const driver = db.drivers.find(item => item.id === task.driverId);
  const vehicle = db.vehicles.find(item => item.id === task.vehicleId);
  const stops = (task.stops || []).map(stop => typeof stop === "string" ? stop : stop.address).filter(Boolean);
  let modal = $("#agenda-task-modal");
  if (!modal) { modal = document.createElement("div"); modal.id = "agenda-task-modal"; modal.className = "task-modal"; document.body.append(modal); }
  modal.innerHTML = `<div class="task-modal-backdrop" data-close-modal></div><article class="task-modal-card" role="dialog" aria-modal="true" aria-labelledby="task-modal-title"><header class="task-modal-head"><div><span class="eyebrow">TAREA · ${task.start}</span><h2 id="task-modal-title">${escapeHTML(task.title || task.description || "Tarea")}</h2></div><button class="task-modal-close" data-close-modal aria-label="Cerrar">×</button></header><div class="task-modal-content"><span class="status ${task.status}">${statusLabel(task.status)}</span><section><b>Recorrido</b><p>${escapeHTML(task.origin || "Sin origen")} → ${escapeHTML(task.destination || "Sin destino final")}</p>${stops.length ? `<ol>${stops.map(stop => `<li>${escapeHTML(stop)}</li>`).join("")}</ol>` : ""}</section>${task.merchandise || task.quantities ? `<section class="task-modal-grid"><div><b>Mercadería</b><p>${escapeHTML(task.merchandise || "—")}</p></div><div><b>Cantidades</b><p>${escapeHTML(task.quantities || "—")}</p></div></section>` : ""}${task.observations ? `<section><b>Observaciones</b><p>${escapeHTML(task.observations)}</p></section>` : ""}<section class="task-modal-grid"><div><b>Chofer</b><p>${escapeHTML(driver?.name || "Sin asignar")}</p></div><div><b>Vehículo</b><p>${escapeHTML(vehicle ? `${vehicle.name} · ${vehicle.plate}` : "Sin asignar")}</p></div><div><b>Duración</b><p>${task.assigned || task.duration || "Sin calcular"}${task.assigned || task.duration ? " min" : ""}</p></div><div><b>Contacto</b><p>${escapeHTML(task.contact || "—")}</p></div></section></div><footer class="task-modal-actions"><button class="btn" data-close-modal>Cerrar</button><button class="btn primary" id="modal-open-route">Abrir ruta</button></footer></article>`;
  modal.hidden = false; document.body.classList.add("modal-open");
  $$('[data-close-modal]', modal).forEach(button => button.onclick = closeAgendaTaskModal);
  $("#modal-open-route", modal).onclick = () => window.open(taskRouteURL(task), "_blank", "noopener");
  $(".task-modal-close", modal).focus();
}
function renderDay(date) {
  const tasks = db.tasks.filter(task => task.date === date).sort((a, b) => a.start.localeCompare(b.start));
  const scheduledHours = new Set(tasks.map(task => Number((task.start || "00:00").split(":")[0])));
  const hours = Array.from({ length: 13 }, (_, index) => index + 7);
  const rows = hours.map(hour => {
    const hourTasks = tasks.filter(task => Number((task.start || "00:00").split(":")[0]) === hour);
    const taskCards = hourTasks.map(task => { const driver = db.drivers.find(item => item.id === task.driverId); const vehicle = db.vehicles.find(item => item.id === task.vehicleId); return `<details class="daily-task ${task.id === agendaFocusTaskId ? "newly-created" : ""}" data-agenda-task="${task.id}" ${task.id === agendaFocusTaskId ? "open" : ""}><summary><span class="daily-task-time">${task.start}</span><span class="daily-task-main"><b>${escapeHTML(task.title || task.description || "Tarea sin título")}</b><small>${escapeHTML(task.origin)} → ${escapeHTML(task.destination || "Sin destino final")}</small></span><span class="status ${task.status}">${statusLabel(task.status)}</span><span class="daily-chevron">⌄</span></summary><div class="daily-task-detail"><p>${escapeHTML(task.description || "Sin descripción")}</p><div class="daily-meta"><span><b>Chofer</b>${escapeHTML(driver?.name || "Sin asignar")}</span><span><b>Vehículo</b>${escapeHTML(vehicle ? `${vehicle.name} · ${vehicle.plate}` : "Sin asignar")}</span><span><b>Duración</b>${task.assigned || task.duration || 0} min</span></div></div></details>`; }).join("");
    const hourValue = `${String(hour).padStart(2, "0")}:00`;
    return `<div class="schedule-row ${hourTasks.length ? "occupied" : "free"}"><button class="schedule-time" data-free-time="${hourValue}" title="Crear tarea a las ${hourValue}">${hourValue}</button><div class="schedule-content">${taskCards || `<button class="free-slot" data-free-time="${hourValue}"><span>Horario libre</span><small>Agregar tarea</small></button>`}</div></div>`;
  }).join("");
  const outside = tasks.filter(task => { const hour = Number((task.start || "00:00").split(":")[0]); return hour < 7 || hour > 19; });
  $("#daily-schedule").innerHTML = `<div class="schedule-summary"><span><b>${tasks.length}</b> tareas del día</span><button class="btn primary" id="agenda-add-task">Agregar tarea</button></div><div class="schedule-list">${rows}${outside.map(task => `<div class="schedule-row occupied"><span class="schedule-time">${task.start}</span><div class="schedule-content"><div class="daily-task outside"><b>${escapeHTML(task.title || task.description)}</b><small>Fuera del horario habitual</small></div></div></div>`).join("")}</div>`;
  $("#agenda-add-task").onclick = () => show("nueva", { date });
  $$('[data-free-time]', $('#daily-schedule')).forEach(button => button.onclick = () => show("nueva", { date, time: button.dataset.freeTime }));
  $$(".daily-task[data-agenda-task] > summary", $("#daily-schedule")).forEach(summary => summary.onclick = event => { if (window.innerWidth > 720) return; event.preventDefault(); const task = db.tasks.find(item => String(item.id) === summary.parentElement.dataset.agendaTask); if (task) openAgendaTaskModal(task); });
  if (agendaFocusTaskId) { const focused = $(`[data-agenda-task="${agendaFocusTaskId}"]`, $("#daily-schedule")); if (focused) setTimeout(() => focused.scrollIntoView({ behavior: "smooth", block: "center" }), 100); }
}

function vehicleAlerts() { const result = []; db.vehicles.forEach(vehicle => { vehicle.docs?.forEach(doc => { const days = daysUntil(doc.expiry); if (days <= 60) result.push({ text: `${doc.name} de ${vehicle.name}: ${days < 0 ? `vencido hace ${Math.abs(days)} días` : `vence en ${days} días`}.`, danger: days < 0 }); }); vehicle.plan?.forEach(plan => { const left = plan.nextKm - vehicle.km; if (left <= 2000) result.push({ text: `${plan.title} de ${vehicle.name}: ${left <= 0 ? "vencido" : `faltan ${left} km`}.`, danger: left <= 0 }); }); }); return result; }

function renderSupervision() { const counts = status => db.tasks.filter(task => task.status === status).length; $("#supervision").innerHTML = `<div class="kpis">${[[db.tasks.length, "Tareas"], [counts("pendiente"), "Pendientes"], [counts("en-trabajo"), "En trabajo"], [counts("en-destino"), "En destino"], [counts("realizada"), "Realizadas"]].map(([value, label]) => `<div class="card kpi"><strong>${value}</strong>${label}</div>`).join("")}</div><div class="grid"><div class="card"><span class="demo-pill">MODO DEMO</span><h3>Ubicación y tráfico</h3><div class="map">Mapa preparado para OpenStreetMap<br><small>Requiere configuración de API</small></div></div><div><div class="card"><h3>Tareas activas</h3>${db.tasks.filter(t => ["en-trabajo", "en-destino"].includes(t.status)).map(t => `<p><b>${t.start}</b> · ${escapeHTML(t.origin)} → ${escapeHTML(t.destination)}</p>`).join("") || "Sin tareas activas."}</div><div class="card"><h3>Alertas</h3>${vehicleAlerts().map(a => `<div class="notice ${a.danger ? "error" : ""}">${escapeHTML(a.text)}</div>`).join("") || "Sin alertas."}</div></div></div>`; }

function closeVehicleEditor() { const modal = $("#vehicle-editor-modal"); if (modal) modal.remove(); document.body.classList.remove("modal-open"); }

function openVehicleEditor(vehicle) {
  const modal = document.createElement("div"); modal.id = "vehicle-editor-modal"; modal.className = "editor-modal";
  modal.innerHTML = `<div class="editor-backdrop" data-close-editor></div><form class="editor-card" id="vehicle-edit-form"><header class="editor-head"><div><span class="eyebrow">DATOS DEL VEHÍCULO</span><h2>Editar ${escapeHTML(vehicle.name)}</h2></div><button type="button" class="task-modal-close" data-close-editor aria-label="Cerrar">×</button></header><div class="editor-content"><div class="row"><div><label>Nombre o número interno</label><input name="name" value="${escapeHTML(vehicle.name)}" required></div><div><label>Patente</label><input name="plate" value="${escapeHTML(vehicle.plate)}" required></div></div><div class="row"><div><label>Marca</label><input name="brand" value="${escapeHTML(vehicle.brand || "")}"></div><div><label>Modelo</label><input name="model" value="${escapeHTML(vehicle.model || "")}"></div></div><div class="row"><div><label>Kilometraje</label><input type="number" min="0" name="km" value="${vehicle.km || 0}" required></div><div><label>Estado</label><select name="status"><option value="disponible">Disponible</option><option value="en-ruta">En ruta</option><option value="en-taller">En taller</option><option value="fuera-de-servicio">Fuera de servicio</option></select></div></div><div class="row"><div><label>Combustible</label><select name="fuel"><option value="Diésel">Diésel</option><option value="Nafta">Nafta</option><option value="GNC">GNC</option><option value="Eléctrico">Eléctrico</option><option value="Híbrido">Híbrido</option></select></div><div><label>Consumo cada 100 km</label><input type="number" min="0" step="0.1" name="consumption" value="${vehicle.consumption || 0}"></div></div></div><footer class="editor-actions"><button type="button" class="btn" data-close-editor>Cancelar</button><button class="btn primary">Guardar cambios</button></footer></form>`;
  document.body.append(modal); document.body.classList.add("modal-open");
  const form = $("#vehicle-edit-form"); form.elements.status.value = vehicle.status || "disponible"; form.elements.fuel.value = vehicle.fuel || "Diésel";
  $$('[data-close-editor]', modal).forEach(button => button.onclick = closeVehicleEditor);
  form.onsubmit = event => { event.preventDefault(); const data = new FormData(form); Object.assign(vehicle, { name: data.get("name").trim(), plate: data.get("plate").trim().toUpperCase(), brand: data.get("brand").trim(), model: data.get("model").trim(), km: Number(data.get("km")), status: data.get("status"), fuel: data.get("fuel"), consumption: Number(data.get("consumption")) }); persist("Datos del vehículo actualizados"); closeVehicleEditor(); renderVehicles(); };
}

function renderVehicles() {
  $("#vehiculos").innerHTML = `<div class="vehicle-list">${db.vehicles.map(vehicle => `<article class="card vehicle-card"><div><span class="health ${vehicle.health >= 85 ? "good" : vehicle.health >= 65 ? "warn" : "bad"}">${vehicle.health}%</span><h2>${escapeHTML(vehicle.name)}</h2><p>${escapeHTML(vehicle.brand)} ${escapeHTML(vehicle.model)} · <b>${escapeHTML(vehicle.plate)}</b></p><p>${vehicle.km.toLocaleString("es-AR")} km · ${escapeHTML(vehicle.status || "disponible")}</p><div class="actions"><button class="btn primary" data-edit-vehicle="${vehicle.id}">Editar datos</button><button class="btn" data-km="${vehicle.id}">Actualizar km</button><button class="btn" data-maintenance="${vehicle.id}">Registrar service</button></div></div><div><h3>Documentación</h3><div class="vehicle-docs">${vehicle.docs?.map((doc,index) => `<article class="vehicle-doc"><div><b>${escapeHTML(doc.name)}</b><span class="doc-expiry ${daysUntil(doc.expiry) < 0 ? "expired" : ""}">${daysUntil(doc.expiry) < 0 ? "Vencido" : `${daysUntil(doc.expiry)} días`}</span></div>${doc.file?.data ? `<small>${escapeHTML(doc.file.name)} · cargado ${new Date(doc.file.uploadedAt).toLocaleDateString("es-AR")}</small>` : '<small>Sin PDF cargado</small>'}<div class="doc-actions"><button class="link-btn" data-doc="${vehicle.id}:${index}">Editar vencimiento</button><label class="link-btn doc-file-label">${doc.file ? "Reemplazar PDF" : "Subir PDF"}<input type="file" accept="application/pdf,.pdf" data-doc-file="${vehicle.id}:${index}"></label>${doc.file?.data ? `<a class="link-btn" href="${doc.file.data}" target="_blank" download="${escapeHTML(doc.file.name)}">Ver PDF</a>` : ""}</div></article>`).join("") || "Sin documentos"}</div></div><div><h3>Últimos mantenimientos</h3>${[...(vehicle.maintenance || [])].sort((a,b)=>b.km-a.km).slice(0,4).map(item => `<p>${item.km.toLocaleString("es-AR")} km · ${escapeHTML(item.title)}</p>`).join("")}</div></article>`).join("")}</div>`;
  $$('[data-edit-vehicle]').forEach(button => button.onclick = () => openVehicleEditor(db.vehicles.find(vehicle => vehicle.id === Number(button.dataset.editVehicle))));
  $$('[data-km]').forEach(button => button.onclick = () => { const vehicle = db.vehicles.find(v => v.id === Number(button.dataset.km)), km = Number(prompt("Kilometraje actual", vehicle.km)); if (!Number.isFinite(km) || km < vehicle.km) return toast("Ingresá un kilometraje válido, igual o mayor al actual.", "error"); vehicle.km = km; persist("Kilometraje actualizado"); renderVehicles(); });
  $$('[data-maintenance]').forEach(button => button.onclick = () => { const vehicle = db.vehicles.find(v => v.id === Number(button.dataset.maintenance)), title = prompt("Trabajo realizado"); if (!title) return; vehicle.maintenance = [...(vehicle.maintenance || []), { title, km: vehicle.km, year: new Date().getFullYear(), date: localISO() }]; persist("Mantenimiento registrado"); renderVehicles(); });
  $$('[data-doc]').forEach(button => button.onclick = () => { const [vehicleId,index] = button.dataset.doc.split(":").map(Number), vehicle = db.vehicles.find(v => v.id === vehicleId), doc = vehicle.docs[index], expiry = prompt(`Nuevo vencimiento de ${doc.name} (AAAA-MM-DD)`, doc.expiry); if (!expiry) return; doc.expiry = expiry; persist("Vencimiento actualizado"); renderVehicles(); });
  $$('[data-doc-file]').forEach(input => input.onchange = async () => { const file = input.files[0]; if (!file) return; if (file.type !== "application/pdf") return toast("La documentación debe ser un PDF.", "error"); if (file.size > 1500000) return toast("El PDF supera el máximo de 1,5 MB.", "error"); const [vehicleId,index] = input.dataset.docFile.split(":").map(Number), vehicle = db.vehicles.find(v => v.id === vehicleId), doc = vehicle.docs[index]; try { doc.file = { name: file.name, size: file.size, data: await fileToDataURL(file), uploadedAt: new Date().toISOString() }; persist(`PDF de ${doc.name} guardado`); renderVehicles(); } catch { toast("No se pudo leer el PDF.", "error"); } });
}

function renderDrivers() {
  $("#choferes").innerHTML = `<div class="toolbar"><button class="btn primary" id="add-driver">Agregar chofer</button></div><div class="vehicle-list">${db.drivers.map(driver => `<article class="card record-row"><div><h2>${escapeHTML(driver.name)}</h2><p>${escapeHTML(driver.phone || "Sin teléfono")} · Registro ${escapeHTML(driver.license || "—")}</p></div><div><span class="status ${daysUntil(driver.licenseExpiry) < 0 ? "cancelada" : "realizada"}">${daysUntil(driver.licenseExpiry) < 0 ? "Vencido" : `${daysUntil(driver.licenseExpiry)} días`}</span><p>Vence ${driver.licenseExpiry}</p></div><div class="actions"><select data-driver-status="${driver.id}"><option value="disponible">Disponible</option><option value="en-viaje">En viaje</option><option value="licencia">Licencia</option><option value="inactivo">Inactivo</option></select><button class="btn" data-edit-driver="${driver.id}">Editar</button></div></article>`).join("") || '<div class="empty">No hay choferes cargados.</div>'}</div>`;
  db.drivers.forEach(driver => { const select = $(`[data-driver-status='${driver.id}']`); select.value = driver.status || "disponible"; select.onchange = () => { driver.status = select.value; persist("Estado del chofer actualizado"); }; });
  $("#add-driver").onclick = () => editDriver(); $$('[data-edit-driver]').forEach(button => button.onclick = () => editDriver(Number(button.dataset.editDriver)));
}

function editDriver(id) {
  const driver = db.drivers.find(item => item.id === id); const name = prompt("Nombre y apellido", driver?.name || ""); if (!name) return; const phone = prompt("Teléfono", driver?.phone || "") ?? ""; const license = prompt("Categoría de registro", driver?.license || "B2") ?? ""; const licenseExpiry = prompt("Vencimiento (AAAA-MM-DD)", driver?.licenseExpiry || localISO()) || localISO();
  if (driver) Object.assign(driver, { name, phone, license, licenseExpiry }); else db.drivers.push({ id: Date.now(), name, phone, license, licenseExpiry, status: "disponible" }); persist(driver ? "Chofer actualizado" : "Chofer agregado"); renderDrivers();
}

function renderContacts() {
  const contacts = new Map(); db.tasks.forEach(task => { if (task.contact || task.phone) contacts.set(`${task.contact}|${task.phone}`, { name: task.contact || "Sin nombre", phone: task.phone || "", tasks: (contacts.get(`${task.contact}|${task.phone}`)?.tasks || 0) + 1 }); });
  $("#contactos").innerHTML = `<div class="search-row"><input id="contact-search" type="search" placeholder="Buscar por nombre o teléfono"><span>${contacts.size} contactos</span></div><div id="contact-list" class="contact-list">${[...contacts.values()].map(contact => `<article class="card contact" data-search="${escapeHTML(`${contact.name} ${contact.phone}`.toLowerCase())}"><div><h3>${escapeHTML(contact.name)}</h3><p>${escapeHTML(contact.phone || "Sin teléfono")} · ${contact.tasks} tareas</p></div>${contact.phone ? `<a class="btn" href="tel:${escapeHTML(contact.phone)}">Llamar</a>` : ""}</article>`).join("") || '<div class="empty">Los contactos aparecerán al crear tareas.</div>'}</div>`;
  $("#contact-search").oninput = event => $$(".contact").forEach(card => card.hidden = !card.dataset.search.includes(event.target.value.toLowerCase()));
}

function download(name, content, type) { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 500); }
function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function renderReports() {
  const done = db.tasks.filter(task => task.status === "realizada"), totalKm = db.tasks.reduce((sum, task) => sum + Number(task.distance || 0), 0), average = done.length ? Math.round(done.reduce((sum, task) => sum + Number(task.duration || 0), 0) / done.length) : 0;
  $("#reportes").innerHTML = `<div class="kpis">${[[db.tasks.length, "Tareas"], [done.length, "Finalizadas"], [db.tasks.filter(t => t.status === "cancelada").length, "Canceladas"], [`${totalKm.toFixed(1)} km`, "Distancia"], [`${average} min`, "Duración media"]].map(([value,label]) => `<div class="card kpi"><strong>${value}</strong>${label}</div>`).join("")}</div><div class="card"><h2>Actividad</h2><div class="report-bars">${["pendiente","en-trabajo","en-destino","realizada","cancelada"].map(status => { const count = db.tasks.filter(t => t.status === status).length; return `<div><span>${statusLabel(status)}</span><i><b style="width:${db.tasks.length ? count / db.tasks.length * 100 : 0}%"></b></i><strong>${count}</strong></div>`; }).join("")}</div><button class="btn primary" id="export-csv">Descargar CSV</button></div>`;
  $("#export-csv").onclick = () => { const headers = ["fecha","hora","estado","origen","destino","chofer","vehículo","duración","distancia"]; const rows = db.tasks.map(task => [task.date,task.start,statusLabel(task.status),task.origin,task.destination,db.drivers.find(d=>d.id===task.driverId)?.name || "",db.vehicles.find(v=>v.id===task.vehicleId)?.plate || "",task.duration,task.distance].map(csvCell).join(",")); download(`tamiz-reporte-${localISO()}.csv`, [headers.join(","), ...rows].join("\r\n"), "text/csv;charset=utf-8"); };
}

async function loadUsers() {
  try {
    const response = await fetch("/api/session", { headers: authHeaders({ accept: "application/json" }) });
    if (response.status === 401) return logout(), [];
    if (!response.ok) throw new Error(`Usuarios ${response.status}`);
    const payload = await response.json();
    if (payload.user) currentUser = { ...currentUser, ...payload.user };
    return payload.users || [];
  } catch (error) {
    console.warn("No se pudo cargar usuarios.", error);
    return [];
  }
}

async function updateUserRole(id, role, currentDriverId) {
  const response = await fetch("/api/users", {
    method: "PUT",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ id, role, currentDriverId: Number(currentDriverId) || null }),
  });
  if (!response.ok) throw new Error(`Rol ${response.status}`);
  const payload = await response.json();
  if (payload.user) currentUser = { ...currentUser, ...payload.user };
  return payload.users || [];
}

async function updateMyPreference(currentDriverId) {
  const response = await fetch("/api/me", {
    method: "PUT",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ currentDriverId: Number(currentDriverId) || null }),
  });
  if (!response.ok) throw new Error(`Preferencia ${response.status}`);
  const payload = await response.json();
  if (payload.user) currentUser = { ...currentUser, ...payload.user };
  applyRoleAccess();
}

function userManagement(users = []) {
  if (currentUser?.role !== "supervisor") return '<section class="card"><h2>Usuarios</h2><p>Tu perfil está configurado como chofer. Un supervisor puede habilitarte más funciones.</p></section>';
  const driverOptions = value => `<option value="">Sin chofer fijo</option>${db.drivers.map(driver => `<option value="${driver.id}" ${Number(value) === driver.id ? "selected" : ""}>${escapeHTML(driver.name)}</option>`).join("")}`;
  return `<section class="card"><h2>Usuarios conectados</h2><div class="user-admin">${users.map(user => `<article class="user-row" data-user-row="${escapeHTML(user.id)}"><div><b>${escapeHTML(user.name || user.email || "Usuario")}</b><small>${escapeHTML(user.email || "Sin email")} · ${user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString("es-AR") : "nuevo"}</small></div><select data-user-role="${escapeHTML(user.id)}"><option value="supervisor" ${user.role === "supervisor" ? "selected" : ""}>Supervisor</option><option value="chofer" ${user.role === "chofer" ? "selected" : ""}>Chofer</option></select><select data-user-driver="${escapeHTML(user.id)}">${driverOptions(user.currentDriverId)}</select><button class="btn" data-save-user="${escapeHTML(user.id)}">Guardar</button></article>`).join("") || '<p>Todavía no entraron otros usuarios.</p>'}</div></section>`;
}

async function renderSettings() {
  const users = await loadUsers();
  applyRoleAccess();
  $("#configuracion").innerHTML = `<div class="settings-grid"><section class="card"><h2>Perfil operativo</h2><p><b>${escapeHTML(currentUserName())}</b><br><small>${escapeHTML(currentUser?.email || currentUser?.username || "")}</small></p><div class="notice success"><b>Rol actual: ${currentUser?.role === "chofer" ? "Chofer" : "Supervisor"}</b><br><small>La base se sincroniza automáticamente entre usuarios.</small></div><label>Chofer de Mi ruta</label><select id="current-driver">${db.drivers.map(driver => `<option value="${driver.id}">${escapeHTML(driver.name)}</option>`).join("")}</select><div class="notice success"><b>Rutas OSRM activas</b><br><small>No requiere API key · geocodificación © OpenStreetMap contributors · sin tráfico en vivo.</small></div><button class="btn primary" id="save-settings">Guardar preferencia</button></section><section class="card"><h2>Respaldo de datos</h2><p>Exportá toda la operación o restaurala en la base compartida.</p><div class="actions"><button class="btn" id="backup">Exportar respaldo</button><label class="btn file-btn">Importar respaldo<input id="restore" type="file" accept="application/json"></label><button class="btn danger" id="reset-demo">Restablecer demo</button></div></section>${userManagement(users)}</div>`;
  $("#current-driver").value = currentUser?.currentDriverId || db.settings.currentDriverId || db.drivers[0]?.id || "";
  $("#save-settings").onclick = async () => { try { currentUser.currentDriverId = Number($("#current-driver").value); await updateMyPreference(currentUser.currentDriverId); toast("Preferencia guardada"); } catch { toast("No se pudo guardar la preferencia", "error"); } };
  $$("[data-save-user]").forEach(button => button.onclick = async () => { try { const id = button.dataset.saveUser; const nextUsers = await updateUserRole(id, $(`[data-user-role="${CSS.escape(id)}"]`).value, $(`[data-user-driver="${CSS.escape(id)}"]`).value); toast("Usuario actualizado"); $("#configuracion").innerHTML = `<div class="settings-grid"><section class="card"><h2>Perfil operativo</h2><p><b>${escapeHTML(currentUserName())}</b><br><small>${escapeHTML(currentUser.email || "")}</small></p><div class="notice success"><b>Rol actual: ${currentUser.role === "chofer" ? "Chofer" : "Supervisor"}</b><br><small>La base se sincroniza automáticamente entre usuarios.</small></div><label>Chofer de Mi ruta</label><select id="current-driver">${db.drivers.map(driver => `<option value="${driver.id}">${escapeHTML(driver.name)}</option>`).join("")}</select><button class="btn primary" id="save-settings">Guardar preferencia</button></section><section class="card"><h2>Respaldo de datos</h2><p>Exportá toda la operación o restaurala en la base compartida.</p><div class="actions"><button class="btn" id="backup">Exportar respaldo</button><label class="btn file-btn">Importar respaldo<input id="restore" type="file" accept="application/json"></label><button class="btn danger" id="reset-demo">Restablecer demo</button></div></section>${userManagement(nextUsers)}</div>`; renderSettings(); } catch { toast("No se pudo actualizar el usuario", "error"); } });
  $("#backup").onclick = () => download(`tamiz-respaldo-${localISO()}.json`, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data: db }, null, 2), "application/json");
  $("#restore").onchange = event => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const parsed = JSON.parse(reader.result), data = parsed.data || parsed; if (!Array.isArray(data.tasks) || !Array.isArray(data.vehicles) || !Array.isArray(data.drivers)) throw new Error(); Object.assign(db, data); persist("Respaldo restaurado", "restore-backup"); renderSettings(); } catch { toast("El respaldo no tiene un formato válido.", "error"); } }; reader.readAsText(file); };
  $("#reset-demo").onclick = () => { if (!confirm("Esto reemplazará todos los datos compartidos por la demo inicial. ¿Continuar?")) return; Object.assign(db, clone(seed)); persist("Datos demo restaurados", "reset-demo"); renderSettings(); };
}

$$('[data-view]').forEach(button => button.onclick = () => show(button.dataset.view));
$("#menu-toggle").onclick = () => document.body.classList.toggle("menu-open");
$("#logout").onclick = logout;
$("#login-form").onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button", form);
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Entrando...";
  try {
    const data = new FormData(form);
    await login(String(data.get("username") || "").trim(), String(data.get("password") || ""));
    form.reset();
  } catch (error) {
    if (sessionToken && currentUser) {
      showApp();
      safeShow(activeView || "agenda");
    } else {
      showLogin(error.message || "Usuario o contraseña incorrectos.");
    }
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
};
document.addEventListener("pointerdown", event => { if (!document.body.classList.contains("menu-open")) return; if ($(".sidebar").contains(event.target) || $("#menu-toggle").contains(event.target)) return; document.body.classList.remove("menu-open"); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeAgendaTaskModal(); });
restoreSession();
setInterval(refreshRemoteData, 8000);
