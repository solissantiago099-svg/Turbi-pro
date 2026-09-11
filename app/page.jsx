"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download, Edit3, FileText, LogOut, MapPin, Menu, Phone, Plus, Route, Search, Settings, Trash2, UserCircle, UserPlus, Users, X } from "lucide-react";

const VAPID_PUBLIC_KEY = "BOgzmxTmjpL2edxhwwe1W0MYXq_NsI-4NiJm2uNYJdMNM9HZgFNIxP6yrGJSmtnfa-aVEmAlr6nn8Q-zbQEAm7g";

const views = [
  { id: "agenda", label: "Agenda", subtitle: "Planificacion diaria", icon: CalendarDays, roles: ["admin", "usuario"] },
  { id: "ruta", label: "Mi ruta", subtitle: "Trabajo del chofer", icon: Route, roles: ["admin", "chofer"] },
  { id: "nueva", label: "Nueva tarea", subtitle: "Carga rapida", icon: Plus, roles: ["admin", "usuario"] },
  { id: "utilidades", label: "Utilidades", subtitle: "Documentacion", icon: FileText, roles: ["admin", "chofer"] },
  { id: "contactos", label: "Contactos", subtitle: "Equipo operativo", icon: Phone, roles: ["chofer"] },
  { id: "choferes", label: "Choferes", subtitle: "Equipo activo", icon: Users, roles: ["admin"] },
  { id: "perfil", label: "Mi perfil", subtitle: "Datos personales", icon: UserCircle, roles: ["admin", "usuario", "chofer"] },
  { id: "configuracion", label: "Configuracion", subtitle: "Usuarios y respaldo", icon: Settings, roles: ["admin"] },
];

function localISO(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localISO(date);
}

function formatTime24(value) {
  const [hours = "0", minutes = "0"] = String(value || "00:00").split(":");
  return `${String(Number(hours)).padStart(2, "0")}:${String(Number(minutes)).padStart(2, "0")} HS`;
}

function timeToMinutes(value) {
  const [hours = "0", minutes = "0"] = String(value || "00:00").split(":");
  return Number(hours) * 60 + Number(minutes);
}

function isPastScheduledTime(date, start, now = new Date()) {
  if (!date || !start) return false;
  const today = localISO(now);
  if (date < today) return true;
  if (date > today) return false;
  return timeToMinutes(start) < now.getHours() * 60 + now.getMinutes();
}

function minutesToTime(total) {
  const bounded = Math.max(0, Math.min(total, 23 * 60 + 59));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

function suggestedBlockEnd(start) {
  return minutesToTime(timeToMinutes(start) + 60);
}

function scheduleBlocksForDate(blocks, date) {
  return (blocks || []).filter((block) => block.date === date && block.start && block.end);
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function findScheduleBlock(task, blocks) {
  if (!task?.date || !task?.start) return null;
  const start = timeToMinutes(task.start);
  const end = start + Math.max(1, Number(task.assigned || task.duration || 1));
  return scheduleBlocksForDate(blocks, task.date).find((block) => (
    rangesOverlap(start, end, timeToMinutes(block.start), timeToMinutes(block.end))
  )) || null;
}

function blockForHour(blocks, date, hour) {
  const start = hour * 60;
  const end = start + 60;
  return scheduleBlocksForDate(blocks, date).find((block) => (
    rangesOverlap(start, end, timeToMinutes(block.start), timeToMinutes(block.end))
  )) || null;
}

function blockTimeLabel(block) {
  return `${formatTime24(block.start)} a ${formatTime24(block.end)}`;
}

function scheduleBlockIdForTask(task) {
  return task?.scheduleBlockId || (task?.id ? `task-${task.id}` : "");
}

function scheduleModeForTask(task) {
  if (task?.scheduleMode === "block" || task?.isScheduleBlock) return "block";
  return task?.start ? "scheduled" : "unscheduled";
}

function daysUntil(iso) {
  if (!iso) return 999;
  return Math.ceil((new Date(`${iso}T12:00:00`) - new Date()) / 86400000);
}

function normalizedRole(role) {
  return role === "supervisor" ? "admin" : role || "chofer";
}

function roleLabel(role) {
  return { admin: "Admin", usuario: "Usuario", chofer: "Chofer", supervisor: "Admin" }[role] || "Chofer";
}

function canAccessView(role, view) {
  const normalized = normalizedRole(role);
  return !view.roles || view.roles.includes(normalized);
}

function taskOwnedBy(task, user) {
  return Boolean(task?.assignedByUserId && user?.id && String(task.assignedByUserId) === String(user.id));
}

function canEditTask(task, user) {
  return normalizedRole(user?.role) === "admin" || taskOwnedBy(task, user);
}

function isScheduleOnlyChange(previousTask, nextTask, user) {
  const role = normalizedRole(user?.role);
  if (!["admin", "usuario", "chofer"].includes(role) || previousTask.start || !nextTask.start) return false;
  if (role === "chofer" && Number(previousTask.driverId || user.currentDriverId) !== Number(user.currentDriverId)) return false;
  const { date: _previousDate, start: _previousStart, status: _previousStatus, updatedAt: _previousUpdatedAt, ...previousContent } = previousTask;
  const { date: _nextDate, start: _nextStart, status: _nextStatus, updatedAt: _nextUpdatedAt, ...nextContent } = nextTask;
  return JSON.stringify(previousContent) === JSON.stringify(nextContent);
}

function isStatusOnlyChange(previousTask, nextTask, user) {
  if (normalizedRole(user?.role) !== "chofer") return false;
  if (Number(previousTask.driverId || user.currentDriverId) !== Number(user.currentDriverId)) return false;
  const { status: previousStatus, updatedAt: _previousUpdatedAt, ...previousContent } = previousTask;
  const { status: nextStatus, updatedAt: _nextUpdatedAt, ...nextContent } = nextTask;
  return previousStatus !== nextStatus && JSON.stringify(previousContent) === JSON.stringify(nextContent);
}

function defaultVehicleDocs() {
  return [
    { id: "cedula-verde", name: "Cedula verde", expiry: addDays(240) },
    { id: "rto", name: "RTO", expiry: addDays(18) },
    { id: "seguro-poliza", name: "Seguro / poliza", expiry: addDays(90) },
  ];
}

function defaultLegalEntities() {
  return [
    { id: "dondera", name: "DONDERA", cuit: "30-71710929-1", email: "", afip: null, iibb: null },
    { id: "1876", name: "1876", cuit: "30-71690382-2", email: "", afip: null, iibb: null },
    { id: "kumitate", name: "KUMITATE", cuit: "30-71807733-4", email: "", afip: null, iibb: null },
    { id: "luar", name: "LUAR", cuit: "30-71713990-5", email: "", afip: null, iibb: null },
  ];
}

function normalizedLegalEntities(entities) {
  const current = Array.isArray(entities) ? entities : [];
  return defaultLegalEntities().map((fallback, index) => {
    const existing = current.find((entity) => entity?.id === fallback.id) || current[index] || {};
    return { ...fallback, ...existing, name: existing.name || fallback.name, cuit: existing.cuit || fallback.cuit };
  });
}
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const seed = {
  tasks: [
    {
      id: 1,
      date: localISO(),
      start: "07:30",
      title: "Retiro y entrega de bebidas",
      description: "Retirar 12 cajas de bebidas y entregarlas.",
      merchandise: "Bebidas",
      quantities: "12 cajas",
      origin: "Juncal 4431, CABA",
      destination: "Av. Rafael Obligado 1229, CABA",
      contact: "Martin Gonzalez",
      phone: "1144442222",
      status: "pendiente",
      duration: 35,
      vehicleId: 1,
      driverId: 1,
    },
    {
      id: 2,
      date: localISO(),
      start: "10:00",
      title: "Entrega de catering",
      description: "Entrega de insumos para evento.",
      merchandise: "Insumos de catering",
      quantities: "8 bultos",
      origin: "Av. Cantilo 7350, CABA",
      destination: "Av. San Martin 1470, Caseros",
      contact: "Laura Diaz",
      phone: "1155556677",
      status: "en-trabajo",
      duration: 50,
      vehicleId: 1,
      driverId: 1,
    },
  ],
  drivers: [{ id: 1, name: "Juan Perez", phone: "11 5555-5555", license: "B2", licenseExpiry: addDays(55), status: "disponible" }],
  vehicles: [{
    id: 1,
    name: "Camioneta 01",
    brand: "IVECO",
    model: "Daily",
    plate: "AE 123 CD",
    km: 58000,
    status: "disponible",
    fuel: "Diesel",
    health: 94,
    docs: defaultVehicleDocs(),
    maintenance: [{ year: 2026, km: 58000, title: "Cambio de aceite" }],
    plan: [{ title: "Cambio de aceite", nextKm: 68000 }, { title: "Service general", nextKm: 70000 }],
  }],
  settings: { currentDriverId: 1, scheduleBlocks: [], legalEntities: defaultLegalEntities() },
};

const statusText = {
  pendiente: "Pendiente",
  "en-trabajo": "En trabajo",
  "en-destino": "En destino",
  realizada: "Realizada",
  cancelada: "Cancelada",
};

const frequentAddresses = [
  "Juncal 4431, CABA",
  "Av. Cantilo 7350, CABA",
  "Av. Rafael Obligado 1229, CABA",
  "Av. San Martin 1470, Caseros",
];

const addressAliases = {
  "juncal 4431, caba": "Rural",
  "av. cantilo 7350, caba": "Origami",
  "av. rafael obligado 1229, caba": "Rut",
};

function addressLabel(address) {
  return addressAliases[String(address || "").trim().toLowerCase()] || address;
}

function shortAddress(address) {
  const labeled = addressLabel(address);
  const parts = String(labeled || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const usefulParts = parts.filter((part) => !/argentina|ciudad autonoma|provincia|comuna|buenos aires/i.test(part));
  return (usefulParts.length ? usefulParts : parts).slice(0, 2).join(", ");
}

function taskAssigner(task) {
  return task?.assignedByUserName || task?.assignedBy || "";
}

function formatCreatedDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const assignedDate = localISO(date);
  if (assignedDate === localISO()) return `hoy ${time}`;
  const day = date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  return `${day} ${time}`;
}

function taskAssignerLabel(task) {
  const assigner = taskAssigner(task);
  if (!assigner) return "";
  const createdDateTime = formatCreatedDateTime(task.createdAt);
  return createdDateTime ? `${assigner} - ${createdDateTime}` : assigner;
}

function taskAssignerUser(task, users = []) {
  return users.find((item) => item?.id && task?.assignedByUserId && String(item.id) === String(task.assignedByUserId)) || null;
}

function encodeMap(value) {
  return encodeURIComponent(value || "");
}

function phoneURL(value) {
  const phone = String(value || "").replace(/[^\d+]/g, "");
  return phone ? `tel:${phone}` : "";
}

function osmDirectionsURL(coordinates) {
  if (!coordinates?.length || coordinates.length < 2) return null;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${first[1]},${first[0]};${last[1]},${last[0]}`;
}

function taskRouteURL(task) {
  return osmDirectionsURL(task.routeCoordinates) || `https://www.openstreetmap.org/search?query=${encodeMap(task.destination || task.origin)}`;
}

function taskGoogleMapsURL(task) {
  const stops = (task.stops || []).map((stop) => (typeof stop === "string" ? stop : stop.address)).filter(Boolean);
  const origin = task.origin || "";
  const destinations = [task.destination, ...stops].filter(Boolean);
  const destination = origin ? (task.destination || stops.at(-1) || origin) : (destinations.at(-1) || "");
  const waypoints = origin ? (task.destination ? stops : stops.slice(0, -1)) : destinations.slice(0, -1);
  const params = new URLSearchParams({ api: "1", travelmode: "driving", destination });
  if (origin) params.set("origin", origin);
  if (waypoints.length) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function phoneHref(value) {
  const normalized = String(value || "").replace(/[^\d+]/g, "");
  return normalized ? `tel:${normalized}` : "";
}

function availableVehicle(vehicles) {
  return vehicles.find((vehicle) => !["en-taller", "fuera-de-servicio"].includes(vehicle.status)) || vehicles[0] || null;
}

function apiHeaders(token, extra = {}) {
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra;
}

const localUsers = [
  { id: "local-admin", username: "admin", password: "admin123", name: "Administrador local", role: "admin", currentDriverId: null },
  { id: "local-user", username: "usuario", password: "usuario123", name: "Usuario local", role: "usuario", currentDriverId: null },
  { id: "local-driver", username: "chofer", password: "chofer123", name: "Juan Perez", role: "chofer", currentDriverId: 1 },
];

function isLocalPreview() {
  return typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function localResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function publicLocalUsers(users = localUsers) {
  return users.map(({ password: _password, ...user }) => user);
}

function contactUsers(users = localUsers) {
  return publicLocalUsers(users).map((user) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    phone: user.phone || "",
    currentDriverId: user.currentDriverId || null,
  }));
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

async function localApiFetch(path, options = {}) {
  const method = options.method || "GET";
  const savedUsers = JSON.parse(localStorage.getItem("tamiz_local_users") || "null") || localUsers;
  const token = String(options.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  const current = savedUsers.find((item) => `local:${item.username}` === token);

  if (path.startsWith("/api/geocode?")) {
    const requestUrl = new URL(path, window.location.origin);
    const upstream = new URL("https://nominatim.openstreetmap.org/search");
    upstream.searchParams.set("format", "jsonv2");
    upstream.searchParams.set("limit", requestUrl.searchParams.get("limit") || "1");
    upstream.searchParams.set("countrycodes", "ar");
    upstream.searchParams.set("accept-language", "es");
    upstream.searchParams.set("viewbox", "-59.3,-34.15,-57.7,-35.25");
    upstream.searchParams.set("bounded", "0");
    upstream.searchParams.set("addressdetails", "0");
    upstream.searchParams.set("q", requestUrl.searchParams.get("q") || "");
    return fetch(upstream.toString(), { headers: { accept: "application/json" } });
  }

  if (path.startsWith("/api/route?")) {
    const requestUrl = new URL(path, window.location.origin);
    const coordinates = requestUrl.searchParams.get("coordinates") || "";
    const upstream = new URL(`https://router.project-osrm.org/route/v1/driving/${coordinates}`);
    upstream.searchParams.set("overview", "false");
    upstream.searchParams.set("steps", "false");
    return fetch(upstream.toString(), { headers: { accept: "application/json" } });
  }
  if (path === "/api/push/public-key" && method === "GET") return localResponse({ publicKey: VAPID_PUBLIC_KEY, supported: true });
  if (path === "/api/push/subscribe" && method === "POST") return localResponse({ ok: true });
  if (path === "/api/push/devices" && method === "GET") return localResponse({ devices: [] });
  if (path === "/api/push/test" && method === "POST") return localResponse({ total: 1, sent: 1, removed: 0 });
  if (path === "/api/login" && method === "POST") {
    const credentials = JSON.parse(options.body || "{}");
    const found = savedUsers.find((item) => item.username === String(credentials.username || "").toLowerCase() && item.password === credentials.password);
    if (!found) return localResponse({ error: "Usuario o contrasena incorrectos" }, 401);
    return localResponse({ token: `local:${found.username}`, user: publicLocalUsers([found])[0], users: contactUsers(savedUsers) });
  }
  if (path === "/api/logout") return localResponse({ ok: true });
  if (!current) return localResponse({ error: "Sesion vencida" }, 401);
  if (path === "/api/session") return localResponse({ user: publicLocalUsers([current])[0], users: contactUsers(savedUsers) });
  if (path === "/api/me" && method === "PUT") {
    const payload = JSON.parse(options.body || "{}");
    const nextCurrent = { ...current, name: String(payload.name || current.name || "").trim(), phone: String(payload.phone || "").trim(), password: payload.password || current.password };
    const nextUsers = savedUsers.map((item) => item.id === current.id ? nextCurrent : item);
    localStorage.setItem("tamiz_local_users", JSON.stringify(nextUsers));
    return localResponse({ user: publicLocalUsers([nextCurrent])[0], users: contactUsers(nextUsers), data: JSON.parse(localStorage.getItem("tamiz_local_state") || "null") || seed });
  }
  if (path === "/api/state" && method === "GET") {
    const storedData = JSON.parse(localStorage.getItem("tamiz_local_state") || "null") || seed;
    const data = {
      ...storedData,
      tasks: storedData.tasks.map((task) => task.assignedByUserId ? task : {
        ...task,
        assignedByUserId: "local-admin",
        assignedByUserName: "Administrador local",
      }),
    };
    localStorage.setItem("tamiz_local_state", JSON.stringify(data));
    const revision = Number(localStorage.getItem("tamiz_local_revision") || 1);
    return localResponse({ user: publicLocalUsers([current])[0], users: contactUsers(savedUsers), data, revision });
  }
  if (path === "/api/state" && method === "PUT") {
    const payload = JSON.parse(options.body || "{}");
    const previousData = JSON.parse(localStorage.getItem("tamiz_local_state") || "null") || seed;
    const nextData = structuredClone(payload.data);
    const previousTasks = new Map(previousData.tasks.map((task) => [String(task.id), task]));
    for (const nextTask of nextData.tasks) {
      const previousTask = previousTasks.get(String(nextTask.id));
      if (!previousTask) {
        nextTask.assignedByUserId = current.id;
        nextTask.assignedByUserName = current.name || current.username;
        continue;
      }
      const { status: previousStatus, updatedAt: _previousUpdatedAt, ...previousContent } = previousTask;
      const { status: nextStatus, updatedAt: _nextUpdatedAt, ...nextContent } = nextTask;
      if (previousStatus !== nextStatus && !isStatusOnlyChange(previousTask, nextTask, current)) return localResponse({ error: "Solo el chofer asignado puede iniciar o finalizar tareas." }, 403);
      if (JSON.stringify(previousContent) !== JSON.stringify(nextContent)) {
        if (!isScheduleOnlyChange(previousTask, nextTask, current) && !canEditTask(previousTask, current)) return localResponse({ error: "Solo puede editar la tarea el usuario que la asigno o un admin." }, 403);
        nextTask.assignedByUserId = previousTask.assignedByUserId;
        nextTask.assignedByUserName = previousTask.assignedByUserName;
      }
    }
    const nextRevision = Number(localStorage.getItem("tamiz_local_revision") || 1) + 1;
    localStorage.setItem("tamiz_local_state", JSON.stringify(nextData));
    localStorage.setItem("tamiz_local_revision", String(nextRevision));
    return localResponse({ data: nextData, revision: nextRevision });
  }
  if (path === "/api/users" && ["POST", "PUT"].includes(method)) {
    const payload = JSON.parse(options.body || "{}");
    const existing = savedUsers.find((item) => item.id === payload.id);
    const nextUser = existing ? { ...existing, ...payload, password: payload.password || existing.password } : { ...payload, id: `local-${Date.now()}` };
    const nextUsers = existing ? savedUsers.map((item) => item.id === existing.id ? nextUser : item) : [...savedUsers, nextUser];
    localStorage.setItem("tamiz_local_users", JSON.stringify(nextUsers));
    const nextCurrent = nextUser.id === current.id ? publicLocalUsers([nextUser])[0] : publicLocalUsers([current])[0];
    return localResponse({ user: nextCurrent, users: contactUsers(nextUsers) });
  }
  return localResponse({ error: "Endpoint local no disponible" }, 404);
}

function appFetch(path, options) {
  return isLocalPreview() && path.startsWith("/api/") ? localApiFetch(path, options) : fetch(path, options);
}

function isLocalMode() {
  return isLocalPreview();
}

async function ensureServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  const current = await navigator.serviceWorker.getRegistration("/");
  if (current) return current;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

function serializePushSubscription(subscription) {
  return subscription?.toJSON ? subscription.toJSON() : subscription;
}

export default function Home() {
  const menuTouch = useRef({ x: 0, y: 0, tracking: false });
  const installPrompt = useRef(null);
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [db, setDb] = useState(seed);
  const [users, setUsers] = useState([]);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState("agenda");
  const [selectedDate, setSelectedDate] = useState(localISO());
  const [routeDate, setRouteDate] = useState(localISO());
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [installBanner, setInstallBanner] = useState({ visible: false, mode: "" });
  const [pushState, setPushState] = useState("idle");
  const [taskPrefill, setTaskPrefill] = useState({ date: localISO(), time: "" });
  const [editingTask, setEditingTask] = useState(null);

  const currentRole = normalizedRole(user?.role);
  const visibleViews = useMemo(() => views.filter((item) => canAccessView(currentRole, item)), [currentRole]);
  const selectedView = views.find((item) => item.id === view);
  const currentView = visibleViews.find((item) => item.id === view) || visibleViews[0] || views[0];
  const isAdmin = currentRole === "admin";
  const canManageTasks = ["admin", "usuario"].includes(currentRole);
  const canChangeTaskStatus = currentRole === "chofer";
  const driverId = user?.currentDriverId || db.settings?.currentDriverId || 1;
  const currentDriver = db.drivers.find((driver) => Number(driver.id) === Number(driverId));
  const scheduleBlocks = db.settings?.scheduleBlocks || [];

  const dayTasks = useMemo(
    () => db.tasks.filter((task) => task.date === selectedDate).sort((a, b) => String(a.start).localeCompare(String(b.start))),
    [db.tasks, selectedDate],
  );

  const routeTasks = useMemo(
    () => db.tasks.filter((task) => task.date === routeDate && Number(task.driverId || driverId) === Number(driverId)),
    [db.tasks, driverId, routeDate],
  );

  const routeBlocks = useMemo(
    () => scheduleBlocksForDate(scheduleBlocks, routeDate).filter((block) => (
      !routeTasks.some((task) => task.isScheduleBlock && String(task.id) === String(block.taskId))
    )),
    [scheduleBlocks, routeDate, routeTasks],
  );

  const nextRouteDate = useMemo(() => {
    const dates = [
      ...db.tasks
        .filter((task) => Number(task.driverId || driverId) === Number(driverId) && task.date > routeDate)
        .map((task) => task.date),
      ...scheduleBlocks.filter((block) => block.date > routeDate).map((block) => block.date),
    ].filter(Boolean).sort();
    return dates[0] || null;
  }, [db.tasks, driverId, routeDate, scheduleBlocks]);

  const previousRouteDate = useMemo(() => {
    const dates = [
      ...db.tasks
        .filter((task) => Number(task.driverId || driverId) === Number(driverId) && task.date < routeDate)
        .map((task) => task.date),
      ...scheduleBlocks.filter((block) => block.date < routeDate).map((block) => block.date),
    ].filter(Boolean).sort().reverse();
    return dates[0] || null;
  }, [db.tasks, driverId, routeDate, scheduleBlocks]);
  const routeDateTitle = routeDate === localISO()
    ? "Trabajo de hoy"
    : new Date(`${routeDate}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

  const week = useMemo(() => {
    const today = new Date(`${localISO()}T12:00:00`);
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return Array.from({ length: 35 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const iso = localISO(date);
      return {
        iso,
        label: date.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", ""),
        day: date.getDate(),
        count: db.tasks.filter((task) => task.date === iso).length,
        completed: db.tasks.some((task) => task.date === iso) && db.tasks.filter((task) => task.date === iso).every((task) => task.status === "realizada"),
      };
    });
  }, [db.tasks]);

  function notify(message, type = "ok") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2600);
  }

  async function loadState(nextToken, silent = false) {
    const response = await appFetch("/api/state", { headers: apiHeaders(nextToken, { accept: "application/json" }) });
    if (response.status === 401) throw new Error("Sesion vencida");
    if (!response.ok) throw new Error("No se pudo abrir la base compartida");
    const payload = await response.json();
    setUser((current) => ({ ...current, ...(payload.user || {}) }));
    if (Array.isArray(payload.users)) setUsers(payload.users);
    if (payload.data) {
      setDb(payload.data);
      setRevision(Number(payload.revision || 0));
    } else {
      await saveState(nextToken, seed, 0, "Base inicializada", true);
      setDb(seed);
      setRevision(1);
    }
    if (!silent) notify("Datos sincronizados");
  }

  async function saveState(nextToken, nextDb, currentRevision = revision, message = "Guardado") {
    const response = await appFetch("/api/state", {
      method: "PUT",
      headers: apiHeaders(nextToken || token, { "content-type": "application/json" }),
      body: JSON.stringify({ data: nextDb, revision: currentRevision, action: "save-state" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409 && payload.data) {
      setDb(payload.data);
      setRevision(Number(payload.revision || 0));
      throw new Error("Otro usuario guardo cambios antes. Actualice la agenda.");
    }
    if (!response.ok) throw new Error(payload.error || "No se pudo guardar");
    setDb(nextDb);
    setRevision(Number(payload.revision || currentRevision + 1));
    notify(message);
  }

  async function savePartial(path, method, body, fallbackDb, message = "Guardado") {
    if (isLocalPreview()) {
      await saveState(token, fallbackDb, revision, message);
      return;
    }
    const response = await appFetch(path, {
      method,
      headers: apiHeaders(token, { "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "No se pudo guardar");
    if (payload.data) setDb(payload.data);
    if (payload.user) setUser((current) => ({ ...current, ...payload.user }));
    if (Array.isArray(payload.users)) setUsers(payload.users);
    setRevision(Number(payload.revision || revision + 1));
    notify(message);
  }

  useEffect(() => {
    const saved = localStorage.getItem("tamiz_session") || "";
    if (!saved) {
      setLoading(false);
      return;
    }
    setToken(saved);
    appFetch("/api/session", { headers: apiHeaders(saved, { accept: "application/json" }) })
      .then(async (response) => {
        if (!response.ok) throw new Error("Sesion vencida");
        const payload = await response.json();
        setUser(payload.user);
        if (Array.isArray(payload.users)) setUsers(payload.users);
        setView(normalizedRole(payload.user.role) === "chofer" ? "ruta" : "agenda");
        await loadState(saved, true);
      })
      .catch(() => {
        localStorage.removeItem("tamiz_session");
        setToken("");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!token || !user) return undefined;
    const timer = window.setInterval(() => loadState(token, true).catch(() => null), 10000);
    return () => window.clearInterval(timer);
  }, [token, user]);

  useEffect(() => {
    if (!user || !token) return undefined;
    let cancelled = false;
    async function syncNotifications() {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
      if (Notification.permission === "denied") {
        if (!cancelled) setPushState("denied");
        return;
      }
      if (Notification.permission !== "granted") {
        if (!cancelled) setPushState("idle");
        return;
      }
      try {
        const registration = await ensureServiceWorkerRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) {
          if (!cancelled) setPushState("idle");
          return;
        }
        const response = await appFetch("/api/push/subscribe", {
          method: "POST",
          headers: apiHeaders(token, { "content-type": "application/json" }),
          body: JSON.stringify({
            subscription: serializePushSubscription(subscription),
            device: {
              standalone: window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true,
              userAgent: window.navigator.userAgent,
            },
          }),
        });
        if (!response.ok) throw new Error("No se pudo sincronizar avisos");
        if (!cancelled) setPushState("enabled");
      } catch {
        if (!cancelled) setPushState("idle");
      }
    }
    syncNotifications();
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  useEffect(() => {
    if (!user || (selectedView && canAccessView(currentRole, selectedView))) return;
    const fallback = visibleViews[0]?.id || (currentRole === "chofer" ? "ruta" : "agenda");
    setView(fallback);
  }, [currentRole, selectedView, user, visibleViews]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("menuLocked");
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.classList.remove("menuLocked");
    };
  }, [menuOpen]);

  useEffect(() => {
    const alreadyInstalled =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true ||
      localStorage.getItem("tamiz_install_dismissed") === "1";
    if (alreadyInstalled) return undefined;

    const isiOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const guideTimer = window.setTimeout(() => {
      if (isiOS) setInstallBanner({ visible: true, mode: "ios" });
    }, 2200);

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      installPrompt.current = event;
      window.clearTimeout(guideTimer);
      setInstallBanner({ visible: true, mode: "prompt" });
    };

    const handleInstalled = () => {
      installPrompt.current = null;
      localStorage.setItem("tamiz_install_dismissed", "1");
      setInstallBanner({ visible: false, mode: "" });
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.clearTimeout(guideTimer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function installApp() {
    const prompt = installPrompt.current;
    if (!prompt) {
      setInstallBanner({ visible: true, mode: "ios" });
      return;
    }
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    installPrompt.current = null;
    setInstallBanner({ visible: false, mode: "" });
  }

  function dismissInstallBanner() {
    localStorage.setItem("tamiz_install_dismissed", "1");
    setInstallBanner({ visible: false, mode: "" });
  }

  async function enableNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      notify("Este navegador no permite notificaciones push.", "error");
      return;
    }
    setPushState("saving");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState("denied");
        notify("Permiso de notificaciones no habilitado.", "error");
        return;
      }
      const registration = await ensureServiceWorkerRegistration();
      const keyResponse = await appFetch("/api/push/public-key", { headers: apiHeaders(token, { accept: "application/json" }) });
      const keyPayload = await keyResponse.json().catch(() => ({}));
      if (!keyResponse.ok || !keyPayload.publicKey) throw new Error("No se pudo preparar notificaciones");
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyPayload.publicKey),
        });
      }
      const response = await appFetch("/api/push/subscribe", {
        method: "POST",
        headers: apiHeaders(token, { "content-type": "application/json" }),
        body: JSON.stringify({
          subscription: serializePushSubscription(subscription),
          device: {
            standalone: window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true,
            userAgent: window.navigator.userAgent,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "No se pudo activar avisos");
      setPushState("enabled");
      notify("Avisos activados en este dispositivo");
    } catch (error) {
      setPushState("idle");
      notify(error.message || "No se pudieron activar los avisos.", "error");
    }
  }

  function beginMenuSwipe(event) {
    const touch = event.touches?.[0];
    if (!touch) return;
    menuTouch.current = { x: touch.clientX, y: touch.clientY, tracking: true };
  }

  function trackMenuSwipe(event) {
    const touch = event.touches?.[0];
    if (!touch || !menuTouch.current.tracking) return;
    const deltaX = touch.clientX - menuTouch.current.x;
    const deltaY = touch.clientY - menuTouch.current.y;
    if (deltaX < -48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
      menuTouch.current.tracking = false;
      setMenuOpen(false);
    }
  }

  function endMenuSwipe() {
    menuTouch.current.tracking = false;
  }

  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);
    setLoginError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await appFetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: String(form.get("username") || "").trim(),
          password: String(form.get("password") || ""),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Usuario o contrasena incorrectos");
      localStorage.setItem("tamiz_session", payload.token);
      setToken(payload.token);
      setUser(payload.user);
      if (Array.isArray(payload.users)) setUsers(payload.users);
      setView(normalizedRole(payload.user.role) === "chofer" ? "ruta" : "agenda");
      await loadState(payload.token, true);
    } catch (error) {
      setLoginError(error.message || "No se pudo iniciar sesion");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await appFetch("/api/logout", { method: "POST", headers: apiHeaders(token) }).catch(() => null);
    localStorage.removeItem("tamiz_session");
    setToken("");
    setUser(null);
    setView("agenda");
  }

  async function persistTask(nextTask, mode = "create") {
    const previousTask = mode === "edit" ? db.tasks.find((task) => Number(task.id) === Number(nextTask.id)) : null;
    const scheduleChanged = !previousTask || previousTask.date !== nextTask.date || previousTask.start !== nextTask.start;
    const ownBlockId = scheduleBlockIdForTask(nextTask);
    const validationBlocks = ownBlockId ? scheduleBlocks.filter((block) => String(block.id) !== String(ownBlockId)) : scheduleBlocks;
    const blocked = scheduleChanged ? findScheduleBlock(nextTask, validationBlocks) : null;
    if (scheduleChanged && isPastScheduledTime(nextTask.date, nextTask.start)) {
      notify("No se puede asignar una tarea en un horario que ya paso.", "error");
      return;
    }
    if (blocked) {
      notify(`Ese horario esta bloqueado: ${blocked.title || "Bloqueo operativo"} (${blockTimeLabel(blocked)}).`, "error");
      return;
    }
    const driver = db.drivers.find((item) => Number(item.id) === Number(nextTask.driverId));
    const vehicle = db.vehicles.find((item) => Number(item.id) === Number(nextTask.vehicleId));
    if (driver && daysUntil(driver.licenseExpiry) < 0) {
      notify("El registro del chofer esta vencido.", "error");
      return;
    }
    if (!vehicle || ["en-taller", "fuera-de-servicio"].includes(vehicle.status)) {
      notify("El vehiculo no esta disponible.", "error");
      return;
    }
    const invalidDoc = vehicle.docs?.find((doc) => ["RTO", "Seguro / poliza", "Seguro / póliza"].includes(doc.name) && daysUntil(doc.expiry) < 0);
    if (invalidDoc) {
      notify(`${invalidDoc.name} esta vencido.`, "error");
      return;
    }
    const blockFromTask = nextTask.isScheduleBlock ? {
      id: ownBlockId,
      date: nextTask.date,
      start: nextTask.start,
      end: nextTask.blockEnd || minutesToTime(timeToMinutes(nextTask.start) + Number(nextTask.duration || nextTask.assigned || 1)),
      title: nextTask.title || "Bloqueo operativo",
      taskId: nextTask.id,
      createdAt: previousTask?.createdAt || new Date().toISOString(),
    } : null;
    const nextBlocks = blockFromTask
      ? [...scheduleBlocks.filter((block) => String(block.id) !== String(blockFromTask.id)), blockFromTask]
      : previousTask?.scheduleBlockId
        ? scheduleBlocks.filter((block) => String(block.id) !== String(previousTask.scheduleBlockId))
        : scheduleBlocks;
    const nextDb = {
      ...db,
      tasks: mode === "edit" ? db.tasks.map((item) => (Number(item.id) === Number(nextTask.id) ? nextTask : item)) : [...db.tasks, nextTask],
      settings: { ...(db.settings || {}), scheduleBlocks: nextBlocks },
    };
    await savePartial("/api/tasks", mode === "edit" ? "PUT" : "POST", nextTask, nextDb, mode === "edit" ? "Tarea actualizada" : "Tarea creada");
    setSelectedDate(nextTask.date);
    setView("agenda");
    setEditingTask(null);
  }

  async function addTask(nextTask) {
    await persistTask({
      ...nextTask,
      assignedByUserId: user.id,
      assignedByUserName: user.name || user.username || user.email || "Usuario",
    }, "create");
  }

  async function editTask(nextTask) {
    const existing = db.tasks.find((task) => Number(task.id) === Number(nextTask.id));
    if (!canEditTask(existing, user)) {
      notify("Solo puede editar la tarea el usuario que la asigno o un admin.", "error");
      throw new Error("No tiene permiso para editar esta tarea");
    }
    await persistTask({
      ...nextTask,
      assignedByUserId: existing.assignedByUserId,
      assignedByUserName: existing.assignedByUserName,
    }, "edit");
  }

  async function updateTask(task, status) {
    if (currentRole !== "chofer" || Number(task.driverId || user.currentDriverId) !== Number(user.currentDriverId)) {
      notify("Solo el chofer asignado puede iniciar o finalizar esta tarea.", "error");
      return;
    }
    const nextTask = { ...task, status, updatedAt: new Date().toISOString() };
    const nextDb = { ...db, tasks: db.tasks.map((item) => (item.id === task.id ? nextTask : item)) };
    await savePartial("/api/tasks/status", "PUT", { id: task.id, status }, nextDb, "Estado actualizado");
  }
  async function scheduleTask(task, date, start) {
    if (task.start) throw new Error("Esta tarea ya tiene un horario asignado.");
    if (!["admin", "usuario", "chofer"].includes(currentRole)) throw new Error("Solo el chofer o supervisor puede asignar horario.");
    if (currentRole === "chofer" && Number(task.driverId || user.currentDriverId) !== Number(user.currentDriverId)) throw new Error("Esta tarea no esta asignada a este chofer.");
    const scheduledTask = { ...task, date: date || task.date || localISO(), start, updatedAt: new Date().toISOString() };
    if (isPastScheduledTime(scheduledTask.date, scheduledTask.start)) {
      notify("No se puede asignar una tarea en un horario que ya paso.", "error");
      return false;
    }
    const blocked = findScheduleBlock(scheduledTask, scheduleBlocks);
    if (blocked) {
      notify(`Ese horario esta bloqueado: ${blocked.title || "Bloqueo operativo"} (${blockTimeLabel(blocked)}).`, "error");
      return false;
    }
    const nextDb = { ...db, tasks: db.tasks.map((item) => Number(item.id) === Number(task.id) ? scheduledTask : item) };
    await savePartial("/api/tasks/schedule", "PUT", { id: task.id, date: scheduledTask.date, start: scheduledTask.start }, nextDb, "Horario asignado");
    setRouteDate(scheduledTask.date);
    return true;
  }

  async function deleteTask(task) {
    if (!canEditTask(task, user)) {
      notify("Solo puede eliminar la tarea el usuario que la asigno o un admin.", "error");
      return;
    }
    const label = task.title || task.description || "esta tarea";
    if (!window.confirm(`¿Eliminar ${label}? Esta accion no se puede deshacer.`)) return;
    const blockId = scheduleBlockIdForTask(task);
    const nextDb = {
      ...db,
      tasks: db.tasks.filter((item) => Number(item.id) !== Number(task.id)),
      settings: task.isScheduleBlock ? {
        ...(db.settings || {}),
        scheduleBlocks: scheduleBlocks.filter((block) => String(block.id) !== String(blockId)),
      } : db.settings,
    };
    await savePartial("/api/tasks", "DELETE", { id: task.id }, nextDb, "Tarea eliminada");
  }

  async function saveDriver(nextDriver, account = null) {
    const exists = db.drivers.some((driver) => Number(driver.id) === Number(nextDriver.id));
    const nextDb = {
      ...db,
      drivers: exists ? db.drivers.map((driver) => (Number(driver.id) === Number(nextDriver.id) ? nextDriver : driver)) : [...db.drivers, nextDriver],
    };
    await savePartial("/api/drivers", exists ? "PUT" : "POST", nextDriver, nextDb, exists ? "Chofer actualizado" : "Chofer creado");
    if (account?.username) {
      const response = await appFetch("/api/users", {
        method: account.userId ? "PUT" : "POST",
        headers: apiHeaders(token, { "content-type": "application/json" }),
        body: JSON.stringify({
          id: account.userId,
          username: account.username,
          name: nextDriver.name,
          role: "chofer",
          currentDriverId: nextDriver.id,
          password: account.password || "",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(result.error || "El chofer se guardo, pero no se pudo crear el usuario.", "error");
        return;
      }
      setUsers(result.users || []);
      if (result.user) setUser(result.user);
      notify("Chofer y usuario vinculados");
    }
  }

  async function saveVehicle(nextVehicle) {
    const exists = db.vehicles.some((vehicle) => Number(vehicle.id) === Number(nextVehicle.id));
    const nextDb = {
      ...db,
      vehicles: exists ? db.vehicles.map((vehicle) => (Number(vehicle.id) === Number(nextVehicle.id) ? nextVehicle : vehicle)) : [...db.vehicles, nextVehicle],
    };
    await savePartial("/api/vehicles", exists ? "PUT" : "POST", nextVehicle, nextDb, exists ? "Camioneta actualizada" : "Camioneta creada");
  }

  async function saveLegalEntities(nextEntities) {
    const nextDb = {
      ...db,
      settings: {
        ...(db.settings || {}),
        legalEntities: nextEntities,
      },
    };
    await savePartial("/api/legal-entities", "PUT", { entities: nextEntities }, nextDb, "Documentacion recurrente actualizada");
  }

  async function sendTestNotification() {
    if (!token) return;
    setPushState("saving");
    try {
      if (isLocalPreview()) {
        if (Notification.permission === "granted") {
          new Notification("Notificacion de prueba", { body: "Si ves esto, los avisos de TAMIZ RUTAS estan funcionando.", icon: "/icons/icon-192.png" });
        }
        setPushState("enabled");
        notify("Notificacion de prueba enviada");
        return;
      }
      const response = await appFetch("/api/push/test", {
        method: "POST",
        headers: apiHeaders(token, { "content-type": "application/json" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "No se pudo enviar la prueba");
      setPushState("enabled");
      notify(payload.sent ? `Prueba enviada a ${payload.sent} dispositivo${payload.sent === 1 ? "" : "s"}` : "No hay dispositivos con avisos activos", payload.sent ? "success" : "error");
    } catch (error) {
      setPushState("enabled");
      notify(error.message || "No se pudo enviar la prueba", "error");
    }
  }

  async function saveProfile(payload) {
    const response = await appFetch("/api/me", {
      method: "PUT",
      headers: apiHeaders(token, { "content-type": "application/json" }),
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      notify(result.error || "No se pudo actualizar el perfil", "error");
      return false;
    }
    if (result.user) setUser(result.user);
    if (Array.isArray(result.users)) setUsers(result.users);
    if (result.data) setDb(result.data);
    if (result.revision) setRevision(Number(result.revision));
    notify("Perfil actualizado");
    return true;
  }

  async function saveScheduleBlocks(nextBlocks) {
    const nextDb = {
      ...db,
      settings: {
        ...(db.settings || {}),
        scheduleBlocks: nextBlocks,
      },
    };
    await savePartial("/api/schedule-blocks", "PUT", { blocks: nextBlocks }, nextDb, "Bloqueos actualizados");
  }

  if (loading) return <div className="loading">Cargando TAMIZ RUTAS...</div>;

  if (!user) {
    return (
      <main className="loginPage">
        <form className="loginCard" onSubmit={handleLogin}>
          <span className="eyebrow">ACCESO OPERATIVO</span>
          <h1>
            TAMIZ <span>RUTAS</span>
          </h1>
          <p>Ingresa para ver la agenda y operar la ruta compartida.</p>
          <label htmlFor="username">Usuario</label>
          <input id="username" name="username" autoComplete="username" required />
          <label htmlFor="password">Contrasena</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <button className="btn primary block" disabled={busy}>
            {busy ? "Entrando..." : "Entrar"}
          </button>
          {loginError ? <div className="notice">{loginError}</div> : null}
        </form>
      </main>
    );
  }

  return (
    <main className={`shell ${menuOpen ? "menuOpen" : ""}`}>
      <button className="sidebarBackdrop" aria-label="Cerrar menu" onClick={() => setMenuOpen(false)} />
      <aside
        className="sidebar"
        onTouchStart={beginMenuSwipe}
        onTouchMove={trackMenuSwipe}
        onTouchEnd={endMenuSwipe}
        onTouchCancel={endMenuSwipe}
      >
        <nav className="nav" aria-label="Navegacion principal">
          {visibleViews.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? "active" : ""}
                onClick={() => {
                  setView(item.id);
                  setMenuOpen(false);
                }}
              >
                <Icon size={18} /> {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <button className="btn menuButton" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}>
            <Menu size={20} />
          </button>
          <div>
            <h1>{currentView.label}</h1>
            <p>{currentView.subtitle}</p>
          </div>
          <div className="topActions">
            {currentRole !== "chofer" && phoneHref(currentDriver?.phone) ? (
              <a className="iconBtn callIconBtn" href={phoneHref(currentDriver.phone)} aria-label={`Llamar a ${currentDriver.name}`} title={`Llamar a ${currentDriver.name}`}><Phone size={18} /></a>
            ) : currentRole === "chofer" ? (
              <button className="iconBtn callIconBtn" type="button" onClick={() => setView("contactos")} aria-label="Ver contactos" title="Ver contactos"><Phone size={18} /></button>
            ) : (
              <button className="iconBtn callIconBtn" type="button" disabled aria-label="Chofer sin telefono" title="Carga el telefono desde Choferes"><Phone size={18} /></button>
            )}
            <span className="pill">{roleLabel(user.role)} - {user.name || user.username}</span>
            {pushState !== "enabled" && pushState !== "denied" ? (
              <button className="btn notificationButton" type="button" onClick={enableNotifications} disabled={pushState === "saving"}>
                <Bell size={16} /> {pushState === "saving" ? "Activando..." : "Activar avisos"}
              </button>
            ) : null}
            <button className="btn" onClick={logout}>
              <LogOut size={16} /> Salir
            </button>
          </div>
        </header>

        <div className="panel">
          {view === "agenda" && (
            <>
              <div className="agendaHead">
                <div>
                  <span className="eyebrow">AGENDA DIARIA</span>
                  <h2>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}</h2>
                </div>
                {canManageTasks ? <button className="btn primary" onClick={() => { setEditingTask(null); setTaskPrefill({ date: selectedDate, time: "" }); setView("nueva"); }}>Agregar tarea</button> : null}
              </div>
              <div className="agendaStickyNav">
                <div className="week">
                {week.map((day) => (
                  <button key={day.iso} className={`dayChip ${selectedDate === day.iso ? "active" : ""} ${day.completed ? "completed" : ""}`} onClick={() => setSelectedDate(day.iso)}>
                    {day.count > 0 ? <span className="taskDot" aria-label={`${day.count} tareas asignadas`} title={`${day.count} tareas asignadas`} /> : null}
                    <span>{day.label}</span>
                    <b>{day.day}</b>
                    <small>{day.count} tareas</small>
                  </button>
                ))}
                </div>
                <div className="scheduleSummary">
                  <span><b>{dayTasks.length}</b> tareas del dia</span>
                </div>
              </div>
              <DailySchedule
                date={selectedDate}
                tasks={dayTasks}
                db={db}
                users={users}
                scheduleBlocks={scheduleBlocks}
                showSummary={false}
                canCreate={canManageTasks}
                currentUser={user}
                canChangeStatus={false}
                onFreeSlot={(time) => {
                  setEditingTask(null);
                  setTaskPrefill({ date: selectedDate, time });
                  setView("nueva");
                }}
                onStatus={updateTask}
                onDelete={deleteTask}
                onSave={editTask}
                onEdit={(task) => {
                  setEditingTask(task);
                  setTaskPrefill({ date: task.date, time: task.start });
                  setView("nueva");
                }}
              />
            </>
          )}

          {view === "ruta" && (
            <>
              <div className="toolbar routeToolbar">
                <div>
                  <span className="eyebrow">MI RUTA</span>
                  <h2>{routeDateTitle}</h2>
                </div>
                <div className="routeDateNav">
                  <button className="btn" type="button" onClick={() => previousRouteDate && setRouteDate(previousRouteDate)} disabled={!previousRouteDate}>
                    <ChevronLeft size={17} /> {previousRouteDate ? "Anterior" : "No hay anteriores"}
                  </button>
                  <button className="btn" type="button" onClick={() => nextRouteDate && setRouteDate(nextRouteDate)} disabled={!nextRouteDate}>
                    <CalendarDays size={17} /> {nextRouteDate ? "Siguiente" : "No hay mas tareas"} {nextRouteDate ? <ChevronRight size={17} /> : null}
                  </button>
                </div>
              </div>
              <RouteTaskGroup title="Tareas del dia" count={routeTasks.filter((task) => task.start && task.status !== "realizada").length + routeBlocks.length} defaultOpen>
                <TaskList tasks={routeTasks.filter((task) => task.start && task.status !== "realizada")} blocks={routeBlocks} db={db} users={users} currentUser={user} onStatus={updateTask} onSchedule={scheduleTask} canSchedule={false} canOperate canChangeStatus={canChangeTaskStatus} onEdit={(task) => {
                  setEditingTask(task);
                  setTaskPrefill({ date: task.date, time: task.start });
                  setView("nueva");
                }} />
              </RouteTaskGroup>
              <RouteTaskGroup title="Tareas sin horario" count={routeTasks.filter((task) => !task.start && task.status !== "realizada").length} defaultOpen>
                <TaskList tasks={routeTasks.filter((task) => !task.start && task.status !== "realizada")} db={db} users={users} currentUser={user} onStatus={updateTask} onSchedule={scheduleTask} canSchedule={["admin", "usuario", "chofer"].includes(currentRole)} canOperate canChangeStatus={canChangeTaskStatus} onEdit={(task) => {
                  setEditingTask(task);
                  setTaskPrefill({ date: task.date, time: task.start });
                  setView("nueva");
                }} />
              </RouteTaskGroup>
              <RouteTaskGroup title="Tareas realizadas" count={routeTasks.filter((task) => task.status === "realizada").length}>
                <TaskList tasks={routeTasks.filter((task) => task.status === "realizada")} db={db} users={users} currentUser={user} onStatus={updateTask} onSchedule={scheduleTask} canSchedule={false} canOperate canChangeStatus={canChangeTaskStatus} onEdit={(task) => {
                  setEditingTask(task);
                  setTaskPrefill({ date: task.date, time: task.start });
                  setView("nueva");
                }} />
              </RouteTaskGroup>
            </>
          )}

          {view === "nueva" && (
            <NewTaskForm
              db={db}
              prefill={taskPrefill}
              initialTask={editingTask}
              currentDriverId={driverId}
              canAssignSchedule={["admin", "usuario", "chofer"].includes(currentRole)}
              canManageBlocks={currentRole === "admin"}
              scheduleBlocks={scheduleBlocks}
              onScheduleBlocks={saveScheduleBlocks}
              onCancel={() => { setEditingTask(null); setView("agenda"); }}
              onCreate={editingTask ? editTask : addTask}
              onError={(message) => notify(message, "error")}
            />
          )}

          {view === "utilidades" && <UtilitiesPanel vehicles={db.vehicles} entities={db.settings?.legalEntities} canEdit={isAdmin} onSaveVehicle={saveVehicle} onSaveLegalEntities={saveLegalEntities} />}
          {view === "contactos" && <ContactsPanel users={users} currentUser={user} />}
          {view === "choferes" && <Records items={db.drivers} type="driver" users={users} onSave={saveDriver} />}
          {view === "perfil" && <ProfilePanel user={user} currentDriver={currentDriver} onSave={saveProfile} />}
          {view === "configuracion" && <SettingsPanel user={user} users={users} db={db} token={token} revision={revision} onUsers={setUsers} onUser={setUser} onNotify={notify} onTestPush={sendTestNotification} />}
        </div>
      </section>
      {toast ? <div className={`toast show ${toast.type === "error" ? "error" : ""}`}>{toast.message}</div> : null}
      {installBanner.visible ? (
        <div className="installBanner" role="status">
          <div className="installIcon">
            <Download size={20} />
          </div>
          <div className="installCopy">
            <b>Instalar TAMIZ RUTAS</b>
            <p>{installBanner.mode === "ios" ? "En iPhone: Compartir y Agregar a pantalla de inicio." : "Usala como app desde el inicio del celu."}</p>
          </div>
          {installBanner.mode === "prompt" ? <button className="btn primary" onClick={installApp}>Instalar</button> : null}
          <button className="btn iconOnly" aria-label="Cerrar sugerencia" onClick={dismissInstallBanner}>
            <X size={18} />
          </button>
        </div>
      ) : null}
    </main>
  );
}

function Kpis({ tasks, vehicles, drivers }) {
  const today = localISO();
  const todayTasks = tasks.filter((task) => task.date === today);
  return (
    <section className="kpis">
      <div className="card"><span className="eyebrow">HOY</span><strong>{todayTasks.length}</strong><span>Tareas</span></div>
      <div className="card"><span className="eyebrow">EN CURSO</span><strong>{tasks.filter((task) => task.status === "en-trabajo").length}</strong><span>Activas</span></div>
      <div className="card"><span className="eyebrow">FLOTA</span><strong>{vehicles.length}</strong><span>Vehiculos</span></div>
      <div className="card"><span className="eyebrow">EQUIPO</span><strong>{drivers.length}</strong><span>Choferes</span></div>
    </section>
  );
}

function RouteTaskGroup({ title, count, defaultOpen = false, children }) {
  return (
    <details className="routeTaskGroup" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        <span className="routeTaskGroupMeta"><small>{count} {count === 1 ? "tarea" : "tareas"}</small><ChevronDown size={18} /></span>
      </summary>
      <div className="routeTaskGroupBody">{children}</div>
    </details>
  );
}
function TaskList({ tasks, blocks = [], db, users = [], currentUser, onStatus, onEdit, onSchedule, canSchedule, canOperate, canChangeStatus }) {
  const entries = [
    ...tasks.map((task) => ({ kind: "task", start: task.start || "", task })),
    ...blocks.map((block) => ({ kind: "block", start: block.start || "", block })),
  ].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  if (!entries.length) return <div className="empty">No hay tareas para este dia.</div>;
  return (
    <section className="routeTasks">
      {entries.map((entry) => {
        if (entry.kind === "block") {
          const { block } = entry;
          return (
            <details className="driverTaskCard scheduleBlockTask" key={`block-${block.id}`}>
              <summary className="driverTaskHeader">
                <span className="driverTaskHeading">
                  <span className="driverTaskTime">{formatTime24(block.start)}</span>
                  <span className="driverTaskTitleWrap">
                    <strong className="driverTaskTitle">{block.title || "Horario bloqueado"}</strong>
                    <small className="taskAssigner">Hasta {formatTime24(block.end)}</small>
                  </span>
                </span>
                <span className="driverTaskHeaderMeta">
                  <span className="status schedule-block">Bloqueado</span>
                  <ChevronDown className="driverTaskChevron" size={19} aria-hidden="true" />
                </span>
              </summary>
              <div className="driverTaskBody">
                <section className="driverTaskBlock highlight">
                  <span className="eyebrow">AGENDA</span>
                  <h3>{block.title || "Horario bloqueado"}</h3>
                  <p>No se asignan tareas de {formatTime24(block.start)} a {formatTime24(block.end)}.</p>
                </section>
              </div>
            </details>
          );
        }

        const { task } = entry;
        const stops = (task.stops || []).map((stop) => (typeof stop === "string" ? stop : stop.address)).filter(Boolean);
        const destinations = [task.destination, ...stops].filter(Boolean);
        const description = String(task.description || task.observations || "").trim();
        const title = task.title || task.description || "Tarea sin titulo";
        const isBlockTask = Boolean(task.isScheduleBlock);
        const assignerLabel = taskAssignerLabel(task);
        const canOperateThisTask = canChangeStatus && Number(task.driverId || currentUser?.currentDriverId) === Number(currentUser?.currentDriverId);
        const startPlace = shortAddress(task.origin);
        const endPlace = shortAddress(task.destination || stops.at(-1));
        const driver = db.drivers.find((item) => Number(item.id) === Number(task.driverId || currentUser?.currentDriverId));
        const driverPhone = phoneHref(driver?.phone);
        const contactPhone = phoneHref(task.phone);
        const assignerPhone = phoneHref(taskAssignerUser(task, users)?.phone);
        return (
          <details className={`driverTaskCard ${task.status === "realizada" ? "completed" : ""} ${task.status === "en-trabajo" ? "active" : ""}`} key={task.id}>
            <summary className="driverTaskHeader">
              <span className="driverTaskHeading">
                <span className="driverTaskTime">{task.start ? formatTime24(task.start) : "Sin horario"}</span>
                <span className="driverTaskTitleWrap">
                  <strong className="driverTaskTitle">{title}</strong>
                  {assignerLabel ? <small className="taskAssigner">Asignada por {assignerLabel}</small> : null}
                </span>
              </span>
              <span className="driverTaskHeaderMeta">
                <span className={`status ${task.status}`}>{statusText[task.status] || task.status}</span>
                <ChevronDown className="driverTaskChevron" size={19} aria-hidden="true" />
              </span>
            </summary>
            <div className="driverTaskBody">
              <section className="driverTaskBlock highlight">
                <span className="eyebrow">{isBlockTask ? "BLOQUEO" : "INICIO"}</span>
                <h3>{task.start ? formatTime24(task.start) : "Sin horario"}</h3>
                {isBlockTask && task.blockEnd ? <p>Reservado hasta {formatTime24(task.blockEnd)}</p> : startPlace ? <p>{startPlace}</p> : null}
              </section>
              <section className="driverTaskBlock">
                <span className="eyebrow">TAREA</span>
                <h3>{title}</h3>
                {description && description !== title ? <p>{description}</p> : null}
                {task.observations ? <p><b>Observaciones:</b> {task.observations}</p> : null}
                {task.merchandise ? <p><b>Mercaderia:</b> {task.merchandise}</p> : null}
                {task.quantities ? <p><b>Cantidades:</b> {task.quantities}</p> : null}
                {assignerLabel ? <p className="taskAssigner">Asignada por {assignerLabel}</p> : null}
              </section>
              {!isBlockTask ? <section className="driverTaskBlock">
                <span className="eyebrow">FINAL</span>
                <h3>{endPlace || "Sin destino cargado"}</h3>
                {stops.length ? <p>Paradas: {stops.map(shortAddress).join(" / ")}</p> : null}
                {task.distance ? <p>{task.distance} km estimados</p> : null}
              </section> : null}
              <div className="driverTaskActions">
                {!isBlockTask ? <a className="iconBtn navigationBtn" href={taskGoogleMapsURL(task)} target="_blank" rel="noreferrer" aria-label="Abrir navegacion en Google Maps" title="Abrir navegacion en Google Maps"><MapPin size={19} /></a> : null}
                {assignerPhone && normalizedRole(currentUser?.role) === "chofer" ? <a className="btn" href={assignerPhone}><Phone size={15} /> Llamar asignador</a> : null}
                {contactPhone ? <a className="btn" href={contactPhone}><Phone size={15} /> Llamar contacto</a> : null}
                {driverPhone && normalizedRole(currentUser?.role) !== "chofer" ? <a className="btn" href={driverPhone}><Phone size={15} /> Llamar chofer</a> : null}
                {task.merchandisePdf?.data ? <a className="btn" href={task.merchandisePdf.data} download={task.merchandisePdf.name}>Abrir PDF</a> : null}
                {!task.start && canSchedule ? <TaskSchedule task={task} onSchedule={onSchedule} /> : null}
                {canEditTask(task, currentUser) ? <button className="btn" type="button" onClick={() => onEdit(task)}><Edit3 size={15} /> Editar</button> : null}
                {canOperateThisTask && task.status !== "realizada" ? (
                  <>
                    {task.status !== "en-trabajo" ? <button className="btn" onClick={() => onStatus(task, "en-trabajo")}>Iniciar</button> : null}
                    {task.status !== "realizada" ? <button className="btn primary" onClick={() => onStatus(task, "realizada")}>Finalizar</button> : null}
                  </>
                ) : null}
              </div>
            </div>
          </details>
        );
      })}
    </section>
  );
}
function TaskSchedule({ task, onSchedule }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(task.date || localISO());
  const [start, setStart] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await onSchedule(task, date, start);
      if (result !== false) setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) return <button className="btn" type="button" onClick={() => setEditing(true)}><CalendarDays size={16} /> Asignar horario</button>;

  return (
    <form className="taskScheduleForm" onSubmit={submit}>
      <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required aria-label="Fecha de la tarea" />
      <input type="time" value={start} onChange={(event) => setStart(event.target.value)} required aria-label="Hora de la tarea" />
      <button className="btn primary compact" disabled={saving}>{saving ? "Guardando..." : "Confirmar"}</button>
      <button className="btn compact" type="button" onClick={() => setEditing(false)} disabled={saving}>Cancelar</button>
    </form>
  );
}
function DailySchedule({ date, tasks, db, users = [], scheduleBlocks = [], showSummary = true, canCreate, canChangeStatus, currentUser, onFreeSlot, onStatus, onEdit, onDelete, onSave }) {
  const hours = Array.from({ length: 13 }, (_, index) => index + 7);
  const outside = tasks.filter((task) => {
    const hour = Number(String(task.start || "00:00").split(":")[0]);
    return hour < 7 || hour > 19;
  });

  return (
    <section className="dailySchedule">
      {showSummary ? (
        <div className="scheduleSummary">
          <span><b>{tasks.length}</b> tareas del dia</span>
        </div>
      ) : null}
      <div className="scheduleList">
        {hours.map((hour) => {
          const hourValue = `${String(hour).padStart(2, "0")}:00`;
          const hourTasks = tasks.filter((task) => Number(String(task.start || "00:00").split(":")[0]) === hour);
          const blocked = blockForHour(scheduleBlocks, date, hour);
          return (
            <div className={`scheduleRow ${hourTasks.length ? "occupied" : blocked ? "blocked" : "free"}`} key={hourValue}>
              <button className="scheduleTime" disabled={!canCreate || Boolean(blocked)} onClick={() => canCreate && !blocked && onFreeSlot(hourValue)} title={blocked ? `Bloqueado: ${blockTimeLabel(blocked)}` : `Crear tarea a las ${hourValue}`}>
                {hourValue}
              </button>
              <div className="scheduleContent">
                {hourTasks.length ? hourTasks.map((task) => <DailyTask key={task.id} task={task} db={db} users={users} canOperate={canCreate} canChangeStatus={canChangeStatus} currentUser={currentUser} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} onSave={onSave} />) : (
                  <button className={`freeSlot ${blocked ? "blockedSlot" : ""}`} disabled={!canCreate || Boolean(blocked)} onClick={() => onFreeSlot(hourValue)}>
                    <span>{blocked ? "Horario bloqueado" : "Horario libre"}</span>
                    <small>{blocked ? `${blocked.title || "Bloqueo operativo"} - ${blockTimeLabel(blocked)}` : "Agregar tarea"}</small>
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {outside.map((task) => (
          <div className="scheduleRow occupied" key={`outside-${task.id}`}>
            <span className="scheduleTime">{task.start}</span>
            <div className="scheduleContent">
              <DailyTask task={task} db={db} users={users} canOperate={canCreate} canChangeStatus={canChangeStatus} currentUser={currentUser} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} onSave={onSave} outside />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DailyTask({ task, db, users = [], canOperate, canChangeStatus, currentUser, onStatus, onEdit, onDelete, onSave, outside = false }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);
  const stops = (task.stops || []).map((stop) => (typeof stop === "string" ? stop : stop.address)).filter(Boolean);
  const title = task.title || task.description || "Tarea sin titulo";
  const description = String(task.description || "").trim();
  const isBlockTask = Boolean(task.isScheduleBlock);
  const assignerLabel = taskAssignerLabel(task);
  const canEdit = canOperate && canEditTask(task, currentUser);
  const canOperateThisTask = canChangeStatus && Number(task.driverId || currentUser?.currentDriverId) === Number(currentUser?.currentDriverId);
  const summaryRoute = isBlockTask && task.blockEnd ? `Reservado hasta ${formatTime24(task.blockEnd)}` : [task.origin, task.destination].map(shortAddress).filter(Boolean).join(" -> ");
  const driver = db?.drivers?.find((item) => Number(item.id) === Number(task.driverId || currentUser?.currentDriverId));
  const driverPhone = phoneHref(driver?.phone);
  const contactPhone = phoneHref(task.phone);
  const assignerPhone = phoneHref(taskAssignerUser(task, users)?.phone);
  const metaItems = [
    task.distance ? ["Distancia", `${task.distance} km`] : null,
    task.merchandise ? ["Mercaderia", task.merchandise] : null,
    task.quantities ? ["Cantidades", task.quantities] : null,
    (task.contact || task.phone) ? ["Contacto", [task.contact, task.phone].filter(Boolean).join(" - ")] : null,
    assignerLabel ? ["Asignada por", assignerLabel] : null,
    stops.length ? ["Paradas", stops.map(shortAddress).join(" / ")] : null,
  ].filter(Boolean);

  function beginEditing() {
    setDraft({
      description: task.description || "",
      distance: String(task.distance || 0),
      merchandise: task.merchandise || "",
      quantities: task.quantities || "",
      contact: task.contact || "",
      phone: task.phone || "",
      assignedBy: task.assignedBy || "",
      stops: stops.join("\n"),
    });
    setEditing(true);
  }

  function updateDraft(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  async function saveInlineEdit() {
    setSaving(true);
    try {
      await onSave({
        ...task,
        description: draft.description.trim(),
        assigned: 0,
        duration: 0,
        distance: Math.max(0, Number(draft.distance) || 0),
        merchandise: draft.merchandise.trim(),
        quantities: draft.quantities.trim(),
        contact: draft.contact.trim(),
        phone: draft.phone.trim(),
        assignedBy: draft.assignedBy.trim(),
        stops: draft.stops.split("\n").map((stop) => stop.trim()).filter(Boolean),
      });
      setEditing(false);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className={`dailyTask ${outside ? "outside" : ""} ${task.status === "realizada" ? "completed" : ""} ${task.status === "en-trabajo" ? "active" : ""}`}>
      <summary>
        <span className="dailyTaskTime">{task.start}</span>
        <span className="dailyTaskMain">
          <b>{title}</b>
          {summaryRoute ? <small>{summaryRoute}</small> : null}
          {assignerLabel ? <small className="taskAssigner">Asignada por {assignerLabel}</small> : null}
        </span>
        <span className={`status ${task.status}`}>{statusText[task.status] || task.status}</span>
      </summary>
      <div className={`dailyTaskDetail ${editing ? "editing" : ""}`}>
        {editing ? (
          <label className="inlineDescription">
            <b>Descripcion</b>
            <textarea value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} />
          </label>
        ) : (
          <>
            {description && description !== title ? <p>{description}</p> : null}
            {task.observations ? <p><b>Observaciones:</b> {task.observations}</p> : null}
          </>
        )}
        {editing || metaItems.length ? <div className="dailyMeta">
          {editing ? (
            <>
              <label><b>Distancia</b><input type="number" min="0" step="0.1" value={draft.distance} onChange={(event) => updateDraft("distance", event.target.value)} /></label>
              <label><b>Mercaderia</b><input value={draft.merchandise} onChange={(event) => updateDraft("merchandise", event.target.value)} /></label>
              <label><b>Cantidades</b><input value={draft.quantities} onChange={(event) => updateDraft("quantities", event.target.value)} /></label>
              <label><b>Contacto</b><input value={draft.contact} onChange={(event) => updateDraft("contact", event.target.value)} /></label>
              <label><b>Telefono</b><input value={draft.phone} onChange={(event) => updateDraft("phone", event.target.value)} /></label>
              <label><b>Asignada por</b><input value={draft.assignedBy} onChange={(event) => updateDraft("assignedBy", event.target.value)} /></label>
              <label><b>Paradas</b><textarea value={draft.stops} onChange={(event) => updateDraft("stops", event.target.value)} placeholder="Una parada por linea" /></label>
            </>
          ) : (
            metaItems.map(([label, value]) => <span key={label}><b>{label}</b>{value}</span>)
          )}
        </div> : null}
        <div className="inlineActions">
          {editing ? (
            <>
              <button className="btn primary" type="button" onClick={saveInlineEdit} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
              <button className="btn" type="button" onClick={() => { setEditing(false); setDraft(null); }} disabled={saving}>Cancelar</button>
            </>
          ) : (
            <>
              {!isBlockTask ? <a className="btn primary" href={taskGoogleMapsURL(task)} target="_blank" rel="noreferrer">Abrir en Google Maps</a> : null}
              {assignerPhone && normalizedRole(currentUser?.role) === "chofer" ? <a className="btn" href={assignerPhone}><Phone size={15} /> Llamar asignador</a> : null}
              {driverPhone && normalizedRole(currentUser?.role) !== "chofer" ? <a className="btn" href={driverPhone}><Phone size={15} /> Llamar chofer</a> : null}
              {contactPhone ? <a className="btn" href={contactPhone}><Phone size={15} /> Llamar contacto</a> : null}
              {task.merchandisePdf?.data ? <a className="btn" href={task.merchandisePdf.data} download={task.merchandisePdf.name}>Abrir PDF</a> : null}
              {canEdit ? <button className="btn" type="button" onClick={() => onEdit ? onEdit(task) : beginEditing()}><Edit3 size={15} /> Editar</button> : null}
              {canEdit ? <button className="iconBtn danger" type="button" onClick={() => onDelete(task)} aria-label="Eliminar tarea" title="Eliminar tarea"><Trash2 size={16} /></button> : null}
              {canOperateThisTask && task.status !== "realizada" && task.status !== "en-trabajo" ? <button className="btn" onClick={() => onStatus(task, "en-trabajo")}>Iniciar</button> : null}
              {canOperateThisTask && task.status !== "realizada" ? <button className="btn primary" onClick={() => onStatus(task, "realizada")}>Finalizar</button> : null}
            </>
          )}
        </div>
      </div>
    </details>
  );
}
function Accordion({ title, children, defaultOpen = false }) {
  return (
    <details className="accordion" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="accordionBody">{children}</div>
    </details>
  );
}

function taskToForm(task, prefill, currentDriverId, db) {
  return {
    title: task?.title || "",
    merchandise: task?.merchandise || "",
    quantities: task?.quantities || "",
    observations: task?.observations || "",
    date: task?.date || prefill.date || localISO(),
    start: task?.start || prefill.time || "",
    assigned: task?.assigned ? String(task.assigned) : task?.duration ? String(task.duration) : "",
    duration: task?.duration ? String(task.duration) : task?.assigned ? String(task.assigned) : "",
    scheduleMode: task ? scheduleModeForTask(task) : prefill.time ? "scheduled" : "unscheduled",
    blockEnd: task?.blockEnd || (task?.start && task?.duration ? minutesToTime(timeToMinutes(task.start) + Number(task.duration || task.assigned || 0)) : ""),
    origin: task?.origin || "",
    stops: Array.isArray(task?.stops) ? task.stops.map((stop) => (typeof stop === "string" ? stop : stop.address)).filter(Boolean) : [],
    destination: task?.destination || "",
    contact: task?.contact || "",
    phone: task?.phone || "",
    assignedBy: task?.assignedBy || "",
    driverId: task?.driverId || currentDriverId || db.drivers[0]?.id || "",
    vehicleId: task?.vehicleId || availableVehicle(db.vehicles)?.id || "",
  };
}

function NewTaskForm({ db, prefill, initialTask = null, currentDriverId, canAssignSchedule, canManageBlocks = false, scheduleBlocks = [], onScheduleBlocks, onCancel, onCreate, onError }) {
  const draftIdRef = useRef(Date.now());
  const savingRef = useRef(false);
  const [form, setForm] = useState(() => taskToForm(initialTask, prefill, currentDriverId, db));
  const [routeInfo, setRouteInfo] = useState({ status: "Google Maps usara tu ubicacion actual para iniciar el recorrido.", distance: "", coordinates: [] });
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pdf, setPdf] = useState(null);
  const isEditing = Boolean(initialTask);
  const canSetSchedule = canAssignSchedule;
  const formResetKey = [
    initialTask?.id || "new",
    prefill.date || "",
    prefill.time || "",
    currentDriverId || "",
  ].join("|");

  useEffect(() => {
    if (!initialTask) draftIdRef.current = Date.now();
    savingRef.current = false;
    setSaving(false);
    setForm(taskToForm(initialTask, prefill, currentDriverId, db));
    setPdf(null);
    setRouteInfo({
      status: initialTask?.distance ? `${initialTask.distance} km entre destinos, estimado guardado.` : "Google Maps usara tu ubicacion actual para iniciar el recorrido.",
      distance: initialTask?.distance || "",
      coordinates: initialTask?.routeCoordinates || [],
    });
  }, [formResetKey]);

  useEffect(() => {
    const destinations = [form.destination, ...form.stops.map((value) => value.trim()).filter(Boolean)].filter(Boolean);
    const addresses = form.origin ? [form.origin, ...destinations] : destinations;
    if (addresses.length < 2) {
      setRouteInfo({ status: destinations.length ? "Google Maps calculara el recorrido desde tu ubicacion actual." : "Agrega un destino para abrir la navegacion.", distance: "", coordinates: [] });
      return undefined;
    }
    const timer = window.setTimeout(() => calculateRoute(addresses), 900);
    return () => window.clearTimeout(timer);
  }, [form.origin, form.destination, form.stops]);

  const selectedScheduleBlock = useMemo(() => {
    if (!canSetSchedule || !form.start || form.scheduleMode === "block") return null;
    const ownBlockId = scheduleBlockIdForTask(initialTask);
    const availableBlocks = ownBlockId ? scheduleBlocks.filter((block) => String(block.id) !== String(ownBlockId)) : scheduleBlocks;
    return findScheduleBlock({ date: form.date || localISO(), start: form.start, assigned: Number(form.assigned || form.duration || 1) }, availableBlocks);
  }, [canSetSchedule, form.date, form.start, form.assigned, form.duration, form.scheduleMode, scheduleBlocks, initialTask]);

  function update(name, value) {
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "scheduleMode") {
        if (value === "unscheduled") next.start = "";
        if (value === "scheduled" && !next.start) next.start = prefill.time || "09:00";
        if (value === "block") {
          if (!next.start) next.start = prefill.time || "09:00";
          if (!next.blockEnd || timeToMinutes(next.blockEnd) <= timeToMinutes(next.start)) next.blockEnd = suggestedBlockEnd(next.start);
        }
      }
      if (name === "start" && next.scheduleMode === "block" && timeToMinutes(next.blockEnd) <= timeToMinutes(value)) {
        next.blockEnd = suggestedBlockEnd(value);
      }
      return next;
    });
  }

  function addStop() {
    setForm((current) => ({ ...current, stops: [...current.stops, ""] }));
  }

  function updateStop(index, value) {
    setForm((current) => ({ ...current, stops: current.stops.map((stop, stopIndex) => stopIndex === index ? value : stop) }));
  }

  function removeStop(index) {
    setForm((current) => ({ ...current, stops: current.stops.filter((_, stopIndex) => stopIndex !== index) }));
  }

  async function geocodeAddress(address) {
    const response = await appFetch(`/api/geocode?q=${encodeURIComponent(address)}`);
    if (!response.ok) throw new Error(`El geocodificador respondio ${response.status}`);
    const results = await response.json();
    const result = results[0];
    if (!result) throw new Error(`No se encontro la direccion: ${address}`);
    return [Number(result.lon), Number(result.lat)];
  }

  async function calculateRoute(addresses) {
    setCalculating(true);
    setRouteInfo((current) => ({ ...current, status: "Buscando direcciones y calculando la distancia..." }));
    try {
      const coordinates = [];
      for (const address of addresses) coordinates.push(await geocodeAddress(address));
      const routeResponse = await appFetch(`/api/route?coordinates=${coordinates.map((point) => point.join(",")).join(";")}`);
      if (!routeResponse.ok) throw new Error(`OSRM respondio ${routeResponse.status}`);
      const payload = await routeResponse.json();
      const route = payload.routes?.[0];
      if (payload.code !== "Ok" || !route) throw new Error(payload.message || "OSRM no encontro una ruta");
      const distance = (route.distance / 1000).toFixed(1);
      setRouteInfo({ status: `${distance} km de recorrido estimado. El mapa calculara el tiempo al navegar.`, distance, coordinates });
    } catch (error) {
      setRouteInfo({ status: error.message || "No se pudo calcular la ruta.", distance: "", coordinates: [] });
    } finally {
      setCalculating(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (savingRef.current) return;
    if (selectedScheduleBlock) return;
    const scheduleMode = canSetSchedule ? form.scheduleMode : scheduleModeForTask(initialTask);
    const isBlock = scheduleMode === "block";
    if (isBlock && (!form.start || timeToMinutes(form.start) >= timeToMinutes(form.blockEnd))) {
      onError("Para bloquear, la hora de fin debe ser posterior al inicio.");
      return;
    }
    if (canSetSchedule && scheduleMode !== "unscheduled" && isPastScheduledTime(form.date || localISO(), form.start)) {
      onError("No se puede asignar una tarea en un horario que ya paso.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      let merchandisePdf = initialTask?.merchandisePdf || null;
      if (pdf) {
        if (pdf.type !== "application/pdf") {
          onError("El adjunto debe ser un archivo PDF.");
          return;
        }
        if (pdf.size > 1500000) {
          onError("El PDF supera el maximo de 1,5 MB.");
          return;
        }
        merchandisePdf = { name: pdf.name, size: pdf.size, data: await fileToDataURL(pdf) };
      }
      const taskId = initialTask?.id || draftIdRef.current;
      const blockDuration = isBlock ? Math.max(1, timeToMinutes(form.blockEnd) - timeToMinutes(form.start)) : 0;
      await onCreate({
        ...initialTask,
        id: taskId,
        title: form.title,
        description: form.title,
        merchandise: form.merchandise,
        quantities: form.quantities,
        merchandisePdf,
        observations: form.observations,
        date: canSetSchedule ? (form.date || localISO()) : (initialTask?.date || form.date || localISO()),
        start: canSetSchedule && scheduleMode !== "unscheduled" ? form.start : (initialTask?.start || ""),
        assigned: blockDuration,
        duration: blockDuration,
        scheduleMode,
        isScheduleBlock: isBlock,
        scheduleBlockId: isBlock ? scheduleBlockIdForTask({ ...initialTask, id: taskId }) : "",
        blockEnd: isBlock ? form.blockEnd : "",
        origin: form.origin,
        destination: form.destination,
        stops: form.stops.map((value) => value.trim()).filter(Boolean),
        contact: form.contact,
        phone: form.phone,
        assignedBy: form.assignedBy,
        driverId: Number(form.driverId),
        vehicleId: Number(form.vehicleId),
        distance: Number(routeInfo.distance || 0),
        routeCoordinates: routeInfo.coordinates,
        status: initialTask?.status || "pendiente",
        createdAt: initialTask?.createdAt || new Date().toISOString(),
        updatedAt: isEditing ? new Date().toISOString() : initialTask?.updatedAt,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const previewDestination = [form.origin, form.destination, ...form.stops].filter(Boolean).join(" -> ") || "Sin recorrido";

  return (
    <div className="formLayout">
      <form className="taskForm" onSubmit={submit}>
        <Accordion title="1. Que hay que hacer">
          <label>Titulo</label>
          <input value={form.title} onChange={(event) => update("title", event.target.value)} required />
          <div className="row">
            <div><label>Mercaderia <small>(opcional)</small></label><input value={form.merchandise} onChange={(event) => update("merchandise", event.target.value)} /></div>
            <div><label>Cantidades <small>(opcional)</small></label><input value={form.quantities} onChange={(event) => update("quantities", event.target.value)} /></div>
          </div>
          <label>Adjuntar PDF de mercaderia o cantidades <small>(opcional - maximo 1,5 MB)</small></label>
          <label className="pdfUpload">
            <input type="file" accept="application/pdf,.pdf" onChange={(event) => setPdf(event.target.files?.[0] || null)} />
            <span>Seleccionar archivo PDF</span>
            <small>{pdf?.name || initialTask?.merchandisePdf?.name || "Ningun archivo seleccionado"}</small>
          </label>
          <label>Observaciones</label>
          <textarea value={form.observations} onChange={(event) => update("observations", event.target.value)} />
          {canSetSchedule ? (
            <>
              <label>Horario</label>
              <div className="scheduleModeControl" role="group" aria-label="Modo de horario">
                <button className={form.scheduleMode === "scheduled" ? "active" : ""} type="button" onClick={() => update("scheduleMode", "scheduled")}>Ponerle horario</button>
                <button className={form.scheduleMode === "unscheduled" ? "active" : ""} type="button" onClick={() => update("scheduleMode", "unscheduled")}>Sin horario</button>
                {canManageBlocks ? <button className={form.scheduleMode === "block" ? "active" : ""} type="button" onClick={() => update("scheduleMode", "block")}>Habilitar bloqueo</button> : null}
              </div>
              <div className="row">
                <div><label>Fecha</label><input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} /></div>
                {form.scheduleMode !== "unscheduled" ? <div><label>Hora de inicio</label><input type="time" value={form.start} onChange={(event) => update("start", event.target.value)} /></div> : null}
              </div>
              {form.scheduleMode === "block" ? (
                <div className="inlineBlockFields">
                  <div>
                    <label>Hasta</label>
                    <input type="time" value={form.blockEnd} onChange={(event) => update("blockEnd", event.target.value)} />
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="routeNotice">{initialTask?.start ? `Horario programado: ${formatTime24(initialTask.start)}` : "Sin horario. El chofer o supervisor podra programarla."}</div>
          )}
        </Accordion>

        <Accordion title="2. Origen y destino (opcional)">
          <label>Origen <small>(opcional)</small></label>
          <AddressSuggest value={form.origin} onChange={(value) => update("origin", value)} placeholder="Lugar donde arranca la tarea" />
          <QuickAddresses onPick={(value) => update("origin", value)} />
          <label>Destino <small>(opcional)</small></label>
          <AddressSuggest value={form.destination} onChange={(value) => update("destination", value)} placeholder="Direccion del destino" />
          <QuickAddresses onPick={(value) => update("destination", value)} />
          <div className="stopsHeader">
            <label>Otros destinos <small>(opcional)</small></label>
            {form.stops.length ? <button className="btn compact" type="button" onClick={addStop}><Plus size={15} /> Agregar otro destino</button> : null}
          </div>
          {form.stops.length ? (
            <div className="stopList">
              {form.stops.map((stop, index) => (
                <div className="stopRow" key={index}>
                  <span className="stopIndex">{index + 1}</span>
                  <AddressSuggest value={stop} onChange={(value) => updateStop(index, value)} placeholder="Direccion del destino adicional" />
                  <button className="iconBtn danger" type="button" onClick={() => removeStop(index)} aria-label="Quitar parada"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          ) : (
            <button className="addStopEmpty" type="button" onClick={addStop}>
              <Plus size={18} />
              Agregar otro destino
            </button>
          )}

          <div className={`routeNotice ${routeInfo.distance ? "success" : ""}`}>{calculating ? "Calculando..." : routeInfo.status}</div>
        </Accordion>

        <Accordion title="3. Agregar contacto (opcional)" defaultOpen={false}>
          <div className="row">
            <div><label>Persona</label><input value={form.contact} onChange={(event) => update("contact", event.target.value)} /></div>
            <div><label>Telefono</label><input inputMode="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} /></div>
          </div>
          <label>Area que asigna</label>
          <input value={form.assignedBy} onChange={(event) => update("assignedBy", event.target.value)} />

        </Accordion>

        <div className="actions">
          <button className="btn" type="button" onClick={onCancel}>Cancelar</button>
          <button className="btn primary" disabled={calculating || saving || Boolean(selectedScheduleBlock)}>{saving ? "Guardando..." : isEditing ? "Guardar cambios" : form.scheduleMode === "block" ? "Guardar bloqueo y asignar" : "Guardar y asignar tarea"}</button>
        </div>
        {selectedScheduleBlock ? (
          <div className="routeNotice scheduleBlockError">
            Ese horario ya quedo bloqueado como {selectedScheduleBlock.title || "Bloqueo operativo"}. No hace falta guardar una tarea encima.
          </div>
        ) : null}
      </form>
      <aside className="summaryCard">
        <span className="eyebrow">RESUMEN</span>
        <p><b>{form.title || "Nueva tarea"}</b></p>
        <p>{previewDestination}</p>
        <p>{form.start ? formatTime24(form.start) : "Sin horario"}{routeInfo.distance ? ` - ${routeInfo.distance} km` : " - distancia sin calcular"}</p>
      </aside>
    </div>
  );
}

function AddressSuggest({ value, onChange, placeholder = "", required = false }) {
  const [suggestions, setSuggestions] = useState([]);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = value.trim();
    const localMatches = frequentAddresses.filter((address) => `${address} ${addressLabel(address)}`.toLowerCase().includes(query.toLowerCase()));
    if (query.length < 3) {
      setSuggestions(query ? localMatches : []);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await appFetch(`/api/geocode?q=${encodeURIComponent(`${query}, Buenos Aires, Argentina`)}&limit=6`, { signal: controller.signal });
        if (!response.ok) throw new Error("No se pudieron buscar direcciones");
        const results = await response.json();
        const remoteMatches = results.map((result) => result.display_name || result.name).filter(Boolean);
        setSuggestions([...new Set([...localMatches, ...remoteMatches])].slice(0, 6));
      } catch (error) {
        if (error.name !== "AbortError") setSuggestions(localMatches);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value]);

  function pick(address) {
    onChange(address);
    setActive(false);
  }

  const showPanel = active && (loading || suggestions.length > 0);

  return (
    <div className="addressSuggest">
      <div className="addressInputWrap">
        <Search size={17} />
        <input
          value={value}
          required={required}
          autoComplete="off"
          placeholder={placeholder}
          onFocus={() => setActive(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setActive(true);
          }}
          onBlur={() => window.setTimeout(() => setActive(false), 150)}
        />
      </div>
      {showPanel ? (
        <div className="addressMenu">
          {loading ? <div className="addressOption muted">Buscando direcciones...</div> : null}
          {suggestions.map((address) => (
            <button className="addressOption" type="button" key={address} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(address)}>
              <MapPin size={16} />
              <span title={address}>{shortAddress(address)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QuickAddresses({ onPick }) {
  return (
    <div className="quickAddresses">
      {frequentAddresses.slice(0, 3).map((address) => (
        <button className="quickAddress" type="button" key={address} onClick={() => onPick(address)}>
          {addressLabel(address)}
        </button>
      ))}
    </div>
  );
}

function Records({ items, type, users = [], onSave }) {
  const [editing, setEditing] = useState(null);
  const isDriver = type === "driver";
  const isVehicle = type === "vehicle";
  return (
    <>
      {isDriver || isVehicle ? (
        <div className="toolbar">
          <div>
            <span className="eyebrow">{isDriver ? "CHOFERES" : "VEHICULOS"}</span>
            <h2>{isDriver ? "Equipo y documentacion" : "Camionetas y documentacion"}</h2>
          </div>
          <button className="btn primary" onClick={() => setEditing(isDriver ? { id: Date.now(), status: "disponible", docs: [] } : { id: Date.now(), status: "disponible", docs: defaultVehicleDocs(), maintenance: [], plan: [] })}>
            <UserPlus size={16} /> {isDriver ? "Nuevo chofer" : "Nueva camioneta"}
          </button>
        </div>
      ) : null}
      {editing && isDriver ? (
        <DriverForm
          driver={editing}
          linkedUser={users.find((user) => Number(user.currentDriverId) === Number(editing.id))}
          onCancel={() => setEditing(null)}
          onSave={async (driver, account) => {
            await onSave(driver, account);
            setEditing(null);
          }}
        />
      ) : null}
      {editing && isVehicle ? (
        <VehicleForm
          vehicle={editing}
          onCancel={() => setEditing(null)}
          onSave={async (vehicle) => {
            await onSave(vehicle);
            setEditing(null);
          }}
        />
      ) : null}
      <section className="grid">
        {items.map((item) => isVehicle ? (
          <VehicleDetailsCard item={item} key={item.id} onEdit={() => setEditing(item)} />
        ) : (
          <article className="card record" key={item.id}>
            <div>
              <h3>{item.name}</h3>
              <p>{`${item.phone || ""} - Registro ${item.license || ""}`}</p>
              {item.docs?.length ? <small>{item.docs.length} documentos adjuntos</small> : null}
              <small>{users.find((user) => Number(user.currentDriverId) === Number(item.id))?.username ? `Usuario: ${users.find((user) => Number(user.currentDriverId) === Number(item.id)).username}` : "Sin usuario vinculado"}</small>
            </div>
            <div className="recordActions">
              <span className="status">{item.status || "activo"}</span>
              <button className="btn" onClick={() => setEditing(item)}><Edit3 size={15} /> Editar</button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function VehicleDetailsCard({ item, onEdit }) {
  const documents = item.docs?.length ? item.docs : defaultVehicleDocs();
  return (
    <details className="card recordDisclosure">
      <summary className="recordDisclosureSummary">
        <div>
          <h3>{item.name}</h3>
          <p>{`${item.brand || ""} ${item.model || ""} - ${item.plate || ""}`}</p>
          <small>{documents.length} documentos legales</small>
        </div>
        <div className="recordActions">
          <span className="status">{item.status || "activo"}</span>
          <ChevronDown className="recordDisclosureChevron" size={19} aria-hidden="true" />
        </div>
      </summary>
      <div className="recordDisclosureBody">
        <div className="vehicleDetailsGrid">
          <div><span>Marca y modelo</span><b>{`${item.brand || "Sin marca"} ${item.model || ""}`}</b></div>
          <div><span>Patente</span><b>{item.plate || "Sin patente"}</b></div>
          <div><span>Kilometraje</span><b>{item.km ? `${Number(item.km).toLocaleString("es-AR")} km` : "Sin kilometraje"}</b></div>
          <div><span>Combustible</span><b>{item.fuel || "Sin especificar"}</b></div>
          <div><span>Estado general</span><b>{item.health !== undefined ? `${item.health}%` : "Sin informar"}</b></div>
        </div>
        <div className="vehicleDocumentsPreview">
          <span className="eyebrow">DOCUMENTACION LEGAL</span>
          {documents.map((doc) => (
            <div className="vehicleDocumentPreview" key={doc.id || doc.name}>
              <div><b>{doc.name}</b><small>{doc.expiry ? `Vence ${new Date(`${doc.expiry}T12:00:00`).toLocaleDateString("es-AR")}` : "Sin vencimiento"}</small></div>
              {doc.file?.data ? <a href={doc.file.data} download={doc.file.name}>Ver PDF</a> : <span>Sin PDF</span>}
            </div>
          ))}
        </div>
        {onEdit ? (
          <div className="actions">
            <button className="btn" type="button" onClick={onEdit}><Edit3 size={15} /> Editar vehiculo</button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function UtilitiesPanel({ vehicles = [], entities, canEdit, onSaveVehicle, onSaveLegalEntities }) {
  const [editingVehicle, setEditingVehicle] = useState(null);
  return (
    <>
      <div className="toolbar">
        <div>
          <span className="eyebrow">UTILIDADES</span>
          <h2>Documentacion</h2>
        </div>
      </div>
      {editingVehicle ? (
        <VehicleForm
          vehicle={editingVehicle}
          onCancel={() => setEditingVehicle(null)}
          onSave={async (vehicle) => {
            await onSaveVehicle(vehicle);
            setEditingVehicle(null);
          }}
        />
      ) : null}
      <section className="utilitySections">
        <div className="utilityBlock">
          <span className="eyebrow">CAMIONETA</span>
          <section className="grid">
            {vehicles.map((vehicle) => (
              <VehicleDetailsCard item={vehicle} key={vehicle.id} onEdit={canEdit ? () => setEditingVehicle(vehicle) : null} />
            ))}
          </section>
        </div>
        <div className="utilityBlock">
          <span className="eyebrow">RAZONES SOCIALES</span>
          <LegalEntitiesPanel entities={entities} canEdit={canEdit} onSave={onSaveLegalEntities} />
        </div>
      </section>
    </>
  );
}

function LegalEntitiesPanel({ entities, canEdit = false, onSave }) {
  const [form, setForm] = useState(() => normalizedLegalEntities(entities));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(normalizedLegalEntities(entities));
  }, [entities]);

  function updateEntity(index, patch) {
    setForm((current) => current.map((entity, itemIndex) => (itemIndex === index ? { ...entity, ...patch } : entity)));
  }

  async function updateDocument(index, key, file) {
    if (!file) return;
    if (file.type !== "application/pdf") {
      alert("La documentacion de la razon social debe ser PDF.");
      return;
    }
    if (file.size > 1500000) {
      alert("El PDF supera el maximo de 1,5 MB.");
      return;
    }
    const data = await fileToDataURL(file);
    updateEntity(index, { [key]: { name: file.name, size: file.size, data, uploadedAt: new Date().toISOString() } });
  }

  async function submit(event) {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="legalEntitiesCard" onSubmit={submit}>
      <div className="legalEntitiesGrid">
        {form.map((entity, index) => {
          const documentCount = ["afip", "iibb"].filter((key) => entity[key]?.data).length;
          return (
          <details className="card recordDisclosure legalEntityCard" key={entity.id || index}>
            <summary className="recordDisclosureSummary legalEntityHeading">
              <div>
                <h3>{entity.name || `Razon social ${index + 1}`}</h3>
                <p>{entity.cuit || "CUIT sin cargar"}{entity.email ? ` - ${entity.email}` : ""}</p>
                <small>{documentCount || 0} documentos legales</small>
              </div>
              <div className="recordActions">
                <span className="status">legal</span>
                <ChevronDown className="recordDisclosureChevron" size={19} aria-hidden="true" />
              </div>
            </summary>
            <div className="recordDisclosureBody legalEntityBody">
              <div className="legalEntityFields">
                {canEdit ? (
                  <>
                    <div><label>Razon social</label><input value={entity.name || ""} onChange={(event) => updateEntity(index, { name: event.target.value })} /></div>
                    <div><label>CUIT</label><input value={entity.cuit || ""} onChange={(event) => updateEntity(index, { cuit: event.target.value })} /></div>
                    <div><label>Correo</label><input type="email" value={entity.email || ""} onChange={(event) => updateEntity(index, { email: event.target.value })} placeholder="documentacion@empresa.com" /></div>
                  </>
                ) : (
                  <>
                    <div><span>Razon social</span><b>{entity.name}</b></div>
                    <div><span>CUIT</span><b>{entity.cuit}</b></div>
                    {entity.email ? <div><span>Correo</span><b>{entity.email}</b></div> : null}
                  </>
                )}
              </div>
              <div className="legalEntityDocs">
                {[{ key: "afip", label: "AFIP" }, { key: "iibb", label: "IIBB" }].map((documentType) => {
                  const document = entity[documentType.key];
                  return (
                    <div className="legalEntityDoc" key={documentType.key}>
                      <div><b>{documentType.label}</b><small>{document?.name || "Sin PDF cargado"}</small></div>
                      <div className="docActions">
                        {canEdit ? <label className="linkUpload">{document?.data ? "Reemplazar PDF" : "Subir PDF"}<input type="file" accept="application/pdf,.pdf" onChange={(event) => updateDocument(index, documentType.key, event.target.files?.[0])} /></label> : null}
                        {document?.data ? <a href={document.data} download={document.name}>Ver PDF</a> : null}
                        {canEdit && document?.data ? <button className="documentRemove" type="button" onClick={() => updateEntity(index, { [documentType.key]: null })}>Quitar</button> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {entity.email ? <a className="legalEntityEmail" href={`mailto:${entity.email}`}>Escribir a {entity.email}</a> : null}
            </div>
          </details>
          );
        })}
      </div>
      <div className="actions legalEntitiesActions">
        {canEdit ? <button className="btn primary" disabled={saving}>{saving ? "Guardando..." : "Guardar documentacion"}</button> : null}
      </div>
    </form>
  );
}
function VehicleForm({ vehicle, onCancel, onSave }) {
  const [form, setForm] = useState({
    name: vehicle.name || "",
    brand: vehicle.brand || "",
    model: vehicle.model || "",
    plate: vehicle.plate || "",
    km: vehicle.km || "",
    fuel: vehicle.fuel || "Diesel",
    health: vehicle.health || 100,
    status: vehicle.status || "disponible",
    docs: vehicle.docs?.length ? vehicle.docs : defaultVehicleDocs(),
    maintenance: vehicle.maintenance || [],
    plan: vehicle.plan || [],
  });

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateDoc(index, patch) {
    update("docs", form.docs.map((doc, itemIndex) => (itemIndex === index ? { ...doc, ...patch } : doc)));
  }

  async function addDocFile(index, file) {
    if (!file) return;
    if (file.type !== "application/pdf") {
      alert("La documentacion de camioneta debe ser PDF.");
      return;
    }
    if (file.size > 1500000) {
      alert("El PDF supera el maximo de 1,5 MB.");
      return;
    }
    const data = await fileToDataURL(file);
    updateDoc(index, { file: { name: file.name, size: file.size, data, uploadedAt: new Date().toISOString() } });
  }

  function updateMaintenance(index, patch) {
    update("maintenance", form.maintenance.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function updatePlan(index, patch) {
    update("plan", form.plan.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  async function submit(event) {
    event.preventDefault();
    await onSave({
      ...vehicle,
      ...form,
      km: Number(form.km || 0),
      health: Number(form.health || 0),
      maintenance: form.maintenance.map((item) => ({ ...item, km: Number(item.km || 0), year: Number(item.year || new Date().getFullYear()) })),
      plan: form.plan.map((item) => ({ ...item, nextKm: Number(item.nextKm || 0) })),
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <form className="card editorForm" onSubmit={submit}>
      <div className="formTitle">
        <div>
          <span className="eyebrow">CAMIONETA</span>
          <h2>{vehicle.name ? "Editar camioneta" : "Nueva camioneta"}</h2>
        </div>
      </div>
      <div className="row">
        <div><label>Nombre interno</label><input value={form.name} onChange={(event) => update("name", event.target.value)} required /></div>
        <div><label>Patente</label><input value={form.plate} onChange={(event) => update("plate", event.target.value.toUpperCase())} required /></div>
      </div>
      <h3 className="sectionTitle">Documentacion legal</h3>
      <div className="vehicleDocs">
        {form.docs.map((doc, index) => (
          <article className="vehicleDoc" key={doc.id || doc.name}>
            <div className="row">
              <div><label>Documento</label><input value={doc.name} onChange={(event) => updateDoc(index, { name: event.target.value })} /></div>
              <div><label>Vencimiento</label><input type="date" value={doc.expiry || ""} onChange={(event) => updateDoc(index, { expiry: event.target.value })} /></div>
            </div>
            <div className="docActions">
              <label className="linkUpload">
                {doc.file?.data ? "Reemplazar PDF" : "Subir PDF"}
                <input type="file" accept="application/pdf,.pdf" onChange={(event) => addDocFile(index, event.target.files?.[0])} />
              </label>
              {doc.file?.data ? <a href={doc.file.data} download={doc.file.name}>Ver PDF</a> : <span>Sin PDF cargado</span>}
              <span className={`docExpiry ${daysUntil(doc.expiry) < 0 ? "expired" : ""}`}>{doc.expiry ? (daysUntil(doc.expiry) < 0 ? "Vencido" : `${daysUntil(doc.expiry)} dias`) : "Sin vencimiento"}</span>
            </div>
          </article>
        ))}
      </div>
      <h3 className="sectionTitle">Mantenimiento</h3>
      <div className="documentsList">
        {form.maintenance.map((item, index) => (
          <div className="maintenanceRow" key={`${item.title}-${index}`}>
            <input value={item.title || ""} placeholder="Trabajo realizado" onChange={(event) => updateMaintenance(index, { title: event.target.value })} />
            <input type="number" value={item.km || ""} placeholder="Km" onChange={(event) => updateMaintenance(index, { km: event.target.value })} />
            <button className="btn" type="button" onClick={() => update("maintenance", form.maintenance.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button>
          </div>
        ))}
        <button className="btn" type="button" onClick={() => update("maintenance", [...form.maintenance, { year: new Date().getFullYear(), km: form.km || 0, title: "" }])}>Agregar service</button>
      </div>
      <h3 className="sectionTitle">Proximos services</h3>
      <div className="documentsList">
        {form.plan.map((item, index) => (
          <div className="maintenanceRow" key={`${item.title}-${index}`}>
            <input value={item.title || ""} placeholder="Service previsto" onChange={(event) => updatePlan(index, { title: event.target.value })} />
            <input type="number" value={item.nextKm || ""} placeholder="Proximo km" onChange={(event) => updatePlan(index, { nextKm: event.target.value })} />
            <button className="btn" type="button" onClick={() => update("plan", form.plan.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button>
          </div>
        ))}
        <button className="btn" type="button" onClick={() => update("plan", [...form.plan, { title: "", nextKm: Number(form.km || 0) + 10000 }])}>Agregar previsto</button>
      </div>
      <div className="actions">
        <button className="btn" type="button" onClick={onCancel}>Cancelar</button>
        <button className="btn primary">Guardar camioneta</button>
      </div>
    </form>
  );
}

function DriverForm({ driver, linkedUser, onCancel, onSave }) {
  const [form, setForm] = useState({
    name: driver.name || "",
    phone: driver.phone || "",
    license: driver.license || "",
    licenseExpiry: driver.licenseExpiry || "",
    status: driver.status || "disponible",
    notes: driver.notes || "",
    docs: driver.docs || [],
  });
  const [account, setAccount] = useState({
    username: linkedUser?.username || "",
    password: "",
  });

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function addDocument(file) {
    if (!file) return;
    if (file.size > 1500000) {
      alert("El archivo supera el maximo de 1,5 MB.");
      return;
    }
    const data = await fileToDataURL(file);
    update("docs", [...form.docs, { id: Date.now(), name: file.name, size: file.size, type: file.type, data, uploadedAt: new Date().toISOString() }]);
  }

  function removeDocument(id) {
    update("docs", form.docs.filter((doc) => doc.id !== id));
  }

  async function submit(event) {
    event.preventDefault();
    if (account.username && !linkedUser && account.password.length < 4) {
      alert("La cuenta del chofer necesita una contrasena inicial de al menos 4 digitos.");
      return;
    }
    await onSave(
      { ...driver, ...form, updatedAt: new Date().toISOString() },
      account.username ? { userId: linkedUser?.id, username: account.username.trim(), password: account.password } : null,
    );
  }

  return (
    <form className="card editorForm" onSubmit={submit}>
      <div className="formTitle">
        <div>
          <span className="eyebrow">CHOFER</span>
          <h2>{driver.name ? "Editar chofer" : "Nuevo chofer"}</h2>
        </div>
      </div>
      <div className="row">
        <div><label>Nombre</label><input value={form.name} onChange={(event) => update("name", event.target.value)} required /></div>
        <div><label>Telefono</label><input value={form.phone} onChange={(event) => update("phone", event.target.value)} inputMode="tel" /></div>
      </div>
      <div className="row">
        <div><label>Registro / categoria</label><input value={form.license} onChange={(event) => update("license", event.target.value)} /></div>
        <div><label>Vencimiento registro</label><input type="date" value={form.licenseExpiry} onChange={(event) => update("licenseExpiry", event.target.value)} /></div>
      </div>
      <div className="row">
        <div><label>Estado</label><select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="disponible">Disponible</option><option value="ocupado">Ocupado</option><option value="inactivo">Inactivo</option></select></div>
        <div><label>Adjuntar documentacion</label><input type="file" accept="application/pdf,image/*" onChange={(event) => addDocument(event.target.files?.[0])} /></div>
      </div>
      <label>Notas</label>
      <textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} />
      <h3 className="sectionTitle">Cuenta de acceso</h3>
      <div className="accountBox">
        <div className="row">
          <div>
            <label>Nombre de usuario</label>
            <input value={account.username} onChange={(event) => setAccount((current) => ({ ...current, username: event.target.value.trim().toLowerCase() }))} placeholder="ej: juan" disabled={Boolean(linkedUser)} />
          </div>
          <div>
            <label>{linkedUser ? "Nueva contrasena (opcional)" : "Contrasena inicial"}</label>
            <input type="password" value={account.password} onChange={(event) => setAccount((current) => ({ ...current, password: event.target.value }))} placeholder={linkedUser ? "Dejar vacio para no cambiar" : "Minimo 4 digitos"} />
          </div>
        </div>
        <small>{linkedUser ? `Vinculado al usuario ${linkedUser.username}.` : "Si completas usuario y contrasena, el chofer va a poder entrar a Mi ruta."}</small>
      </div>
      <div className="documentsList">
        {form.docs.length ? form.docs.map((doc) => (
          <div className="documentItem" key={doc.id}>
            <a href={doc.data} download={doc.name}>{doc.name}</a>
            <button className="btn" type="button" onClick={() => removeDocument(doc.id)}>Quitar</button>
          </div>
        )) : <span>No hay documentacion adjunta.</span>}
      </div>
      <div className="actions">
        <button className="btn" type="button" onClick={onCancel}>Cancelar</button>
        <button className="btn primary">Guardar chofer</button>
      </div>
    </form>
  );
}

function ContactsPanel({ users = [], currentUser }) {
  const contacts = users
    .filter((user) => user.id !== currentUser?.id)
    .filter((user) => user.phone || normalizedRole(user.role) !== "chofer")
    .sort((a, b) => String(a.name || a.username).localeCompare(String(b.name || b.username)));
  return (
    <>
      <div className="toolbar">
        <div>
          <span className="eyebrow">CONTACTOS</span>
          <h2>Usuarios del equipo</h2>
        </div>
      </div>
      <section className="grid contactsGrid">
        {contacts.length ? contacts.map((contact) => {
          const href = phoneHref(contact.phone);
          return (
            <article className="card contactCard" key={contact.id}>
              <div>
                <span className="eyebrow">{roleLabel(contact.role)}</span>
                <h3>{contact.name || contact.username}</h3>
                <p>{contact.phone || "Sin telefono cargado"}</p>
              </div>
              {href ? <a className="btn primary" href={href}><Phone size={15} /> Llamar</a> : <span className="status">Sin telefono</span>}
            </article>
          );
        }) : <div className="empty">Todavia no hay contactos con telefono cargado.</div>}
      </section>
    </>
  );
}

function ProfilePanel({ user, currentDriver, onSave }) {
  const [form, setForm] = useState({
    name: user.name || "",
    phone: user.phone || currentDriver?.phone || "",
    password: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      name: user.name || "",
      phone: user.phone || currentDriver?.phone || "",
      password: "",
    });
  }, [user, currentDriver]);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (form.password && form.password.length < 4) {
      alert("La contrasena debe tener al menos 4 digitos.");
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave({
        name: form.name.trim(),
        phone: form.phone.trim(),
        password: form.password,
      });
      if (saved) update("password", "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <div>
          <span className="eyebrow">MI PERFIL</span>
          <h2>Datos de acceso</h2>
        </div>
      </div>
      <form className="card editorForm profileCard" onSubmit={submit}>
        <div className="formTitle">
          <div>
            <span className="eyebrow">{roleLabel(user.role)}</span>
            <h2>{user.username}</h2>
          </div>
        </div>
        <div className="row">
          <div><label>Nombre</label><input value={form.name} onChange={(event) => update("name", event.target.value)} required /></div>
          <div><label>Telefono</label><input value={form.phone} onChange={(event) => update("phone", event.target.value)} inputMode="tel" /></div>
        </div>
        <div>
          <label>Nueva contrasena <small>(opcional)</small></label>
          <input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} placeholder="Dejar vacio para no cambiar" />
        </div>
        <div className="actions">
          <button className="btn primary" disabled={saving}>{saving ? "Guardando..." : "Guardar perfil"}</button>
        </div>
      </form>
    </>
  );
}

function SettingsPanel({ user, users, db, token, revision, onUsers, onUser, onNotify, onTestPush }) {
  const [editingUser, setEditingUser] = useState(null);
  const [pushDevices, setPushDevices] = useState([]);
  const [loadingPushDevices, setLoadingPushDevices] = useState(false);

  async function saveUser(payload) {
    const response = await appFetch("/api/users", {
      method: payload.id ? "PUT" : "POST",
      headers: apiHeaders(token, { "content-type": "application/json" }),
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      onNotify(result.error || "No se pudo guardar el usuario", "error");
      return;
    }
    onUsers(result.users || []);
    if (result.user) onUser(result.user);
    setEditingUser(null);
    onNotify(payload.id ? "Usuario actualizado" : "Usuario creado");
  }

  async function loadPushDevices() {
    setLoadingPushDevices(true);
    try {
      const response = await appFetch("/api/push/devices", { headers: apiHeaders(token, { accept: "application/json" }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "No se pudo leer el diagnostico");
      setPushDevices(result.devices || []);
    } catch (error) {
      onNotify(error.message || "No se pudo leer el diagnostico", "error");
    } finally {
      setLoadingPushDevices(false);
    }
  }

  useEffect(() => {
    if (token) loadPushDevices();
  }, [token]);

  return (
    <>
      <div className="toolbar">
        <div>
          <span className="eyebrow">CONFIGURACION</span>
          <h2>Usuarios y acceso</h2>
        </div>
        <button className="btn primary" onClick={() => setEditingUser({ role: "usuario" })}>
          <UserPlus size={16} /> Nuevo usuario
        </button>
      </div>
      {editingUser ? (
        <UserForm
          user={editingUser}
          drivers={db.drivers}
          onCancel={() => setEditingUser(null)}
          onSave={saveUser}
        />
      ) : null}
      <section className="grid">
        <article className="card">
          <span className="eyebrow">USUARIO ACTUAL</span>
          <h2>{user.name || user.username}</h2>
          <p>Rol: {roleLabel(user.role)}</p>
        </article>
        <article className="card">
          <span className="eyebrow">SINCRONIZACION</span>
          <h2>Base compartida</h2>
          <p>Revision actual: {revision}</p>
        </article>
        <article className="card pushDiagnostics">
          <div className="record">
            <div>
              <span className="eyebrow">AVISOS</span>
              <h2>Dispositivos</h2>
              <p>{pushDevices.length ? `${pushDevices.length} dispositivo${pushDevices.length === 1 ? "" : "s"} registrado${pushDevices.length === 1 ? "" : "s"}` : "Sin dispositivos registrados"}</p>
            </div>
            <div className="recordActions">
              <button className="btn" type="button" onClick={loadPushDevices} disabled={loadingPushDevices}>{loadingPushDevices ? "Leyendo..." : "Actualizar"}</button>
              <button className="btn" type="button" onClick={async () => { await onTestPush(); await loadPushDevices(); }}>Probar</button>
            </div>
          </div>
          {pushDevices.length ? (
            <div className="pushDeviceList">
              {pushDevices.map((device) => (
                <div className="pushDevice" key={device.id}>
                  <div>
                    <b>{device.username}</b>
                    <small>{device.platform} - {device.browser}{device.standalone ? " - app instalada" : ""}</small>
                  </div>
                  <span className={`status ${device.lastPushOk === false ? "danger" : ""}`}>{device.lastPushOk === null ? "sin prueba" : device.lastPushOk ? `ok ${device.lastPushStatus || ""}` : device.lastPushError || "fallo"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </article>
        {users.map((item) => (
          <article className="card record" key={item.id}>
            <div>
              <h3>{item.name || item.username}</h3>
              <p>{item.username} - {roleLabel(item.role)}</p>
              {normalizedRole(item.role) === "chofer" ? (
                <small>{db.drivers.find((driver) => Number(driver.id) === Number(item.currentDriverId))?.name || "Sin chofer asociado"}</small>
              ) : null}
            </div>
            <div className="recordActions">
              <span className="status">{roleLabel(item.role)}</span>
              <button className="btn" onClick={() => setEditingUser(item)}><Edit3 size={15} /> Editar</button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function ScheduleBlocksPanel({ blocks, onSave, onNotify, compact = false, date = "", start = "", taskTitle = "" }) {
  const initialStart = start || "10:00";
  const [form, setForm] = useState({
    date: date || localISO(),
    start: initialStart,
    end: suggestedBlockEnd(initialStart),
    title: "",
  });
  const [validationError, setValidationError] = useState("");
  const sortedBlocks = [...(blocks || [])].sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));

  useEffect(() => {
    if (!compact) return;
    setForm((current) => {
      const nextStart = start || current.start;
      return {
        ...current,
        date: date || current.date,
        start: nextStart,
        end: timeToMinutes(current.end) > timeToMinutes(nextStart) ? current.end : suggestedBlockEnd(nextStart),
      };
    });
  }, [compact, date, start]);

  function update(name, value) {
    setValidationError("");
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "start" && timeToMinutes(next.end) <= timeToMinutes(value)) next.end = suggestedBlockEnd(value);
      return next;
    });
  }

  async function submit() {
    if (timeToMinutes(form.start) >= timeToMinutes(form.end)) {
      const message = "El horario de fin debe ser posterior al inicio.";
      setValidationError(message);
      onNotify(message, "error");
      return;
    }
    const blockTitle = compact ? taskTitle.trim() : form.title.trim();
    setValidationError("");
    await onSave([
      ...(blocks || []),
      {
        id: Date.now(),
        date: form.date,
        start: form.start,
        end: form.end,
        title: blockTitle || "Bloqueo operativo",
        createdAt: new Date().toISOString(),
      },
    ]);
    if (!compact) setForm((current) => ({ ...current, title: "" }));
  }

  async function removeBlock(blockId) {
    await onSave((blocks || []).filter((block) => Number(block.id) !== Number(blockId)));
  }

  const content = (
    <>
      <div className="scheduleBlockForm">
        <div>
          <label>Dia</label>
          <input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} required />
        </div>
        <div>
          <label>Desde</label>
          <input type="time" value={form.start} onChange={(event) => update("start", event.target.value)} required />
        </div>
        <div>
          <label>Hasta <small>(puede superar las 19 hs)</small></label>
          <input type="time" value={form.end} onChange={(event) => update("end", event.target.value)} required />
        </div>
        {!compact ? (
          <div>
            <label>Motivo</label>
            <input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Evento, mantenimiento, carga interna..." />
          </div>
        ) : null}
        <button className="btn primary" type="button" onClick={submit}><Plus size={16} /> Bloquear</button>
      </div>
      {validationError ? <div className="routeNotice scheduleBlockError">{validationError}</div> : null}
      <div className="scheduleBlocksList">
        {sortedBlocks.length ? sortedBlocks.map((block) => (
          <div className="scheduleBlockItem" key={block.id}>
            <div>
              <b>{block.title || "Bloqueo operativo"}</b>
              <span>{new Date(`${block.date}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })} - {blockTimeLabel(block)}</span>
            </div>
            <button className="iconBtn danger" type="button" onClick={() => removeBlock(block.id)} aria-label="Quitar bloqueo"><Trash2 size={16} /></button>
          </div>
        )) : <p>No hay horarios bloqueados.</p>}
      </div>
    </>
  );

  if (compact) {
    return (
      <details className="scheduleBlockDisclosure">
        <summary>
          <span>
            <b>Bloquear este horario</b>
            <small>Reservar una franja para que no se puedan cargar tareas.</small>
          </span>
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <div className="scheduleBlockDisclosureBody">{content}</div>
      </details>
    );
  }

  return (
    <article className="card scheduleBlocksCard">
      <div className="formTitle">
        <div>
          <span className="eyebrow">BLOQUEOS DE AGENDA</span>
          <h2>Bloquear horario</h2>
        </div>
      </div>
      {content}
    </article>
  );
}

function UserForm({ user, drivers = [], onCancel, onSave }) {
  const [form, setForm] = useState({
    username: user.username || "",
    name: user.name || "",
    role: normalizedRole(user.role || "usuario"),
    currentDriverId: user.currentDriverId || "",
    password: "",
  });
  const isEditing = Boolean(user.id);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!isEditing && form.password.length < 4) {
      alert("La contrasena inicial debe tener al menos 4 digitos.");
      return;
    }
    await onSave({
      id: user.id,
      username: form.username.trim(),
      name: form.name.trim(),
      role: form.role,
      currentDriverId: form.role === "chofer" ? form.currentDriverId : null,
      password: form.password,
    });
  }

  return (
    <form className="card editorForm" onSubmit={submit}>
      <div className="formTitle">
        <div>
          <span className="eyebrow">USUARIO</span>
          <h2>{isEditing ? "Editar usuario" : "Nuevo usuario"}</h2>
        </div>
      </div>
      <div className="row">
        <div><label>Usuario</label><input value={form.username} onChange={(event) => update("username", event.target.value)} required disabled={isEditing} /></div>
        <div><label>Nombre</label><input value={form.name} onChange={(event) => update("name", event.target.value)} required /></div>
      </div>
      <div className="row">
        <div>
          <label>Rol</label>
          <select
            value={form.role}
            onChange={(event) => setForm((current) => ({ ...current, role: event.target.value, currentDriverId: event.target.value === "chofer" ? current.currentDriverId : "" }))}
          >
            <option value="admin">Admin</option>
            <option value="usuario">Usuario</option>
            <option value="chofer">Chofer</option>
          </select>
        </div>
        <div><label>{isEditing ? "Nueva contrasena (opcional)" : "Contrasena inicial"}</label><input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} required={!isEditing} /></div>
      </div>
      {form.role === "chofer" ? (
        <div>
          <label>Chofer asociado</label>
          <select value={form.currentDriverId} onChange={(event) => update("currentDriverId", event.target.value)} required>
            <option value="">Seleccionar chofer</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>{driver.name}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="actions">
        <button className="btn" type="button" onClick={onCancel}>Cancelar</button>
        <button className="btn primary">Guardar usuario</button>
      </div>
    </form>
  );
}
