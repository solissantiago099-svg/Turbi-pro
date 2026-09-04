"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download, Edit3, LogOut, MapPin, Menu, Plus, Route, Search, Settings, Trash2, Truck, UserPlus, Users, X } from "lucide-react";

const views = [
  { id: "agenda", label: "Agenda", subtitle: "Planificacion diaria", icon: CalendarDays, roles: ["admin", "usuario"] },
  { id: "ruta", label: "Mi ruta", subtitle: "Trabajo del chofer", icon: Route, roles: ["admin", "chofer"] },
  { id: "nueva", label: "Nueva tarea", subtitle: "Carga rapida", icon: Plus, roles: ["admin", "usuario"] },
  { id: "vehiculos", label: "Vehiculos", subtitle: "Flota y documentacion", icon: Truck, roles: ["admin"] },
  { id: "choferes", label: "Choferes", subtitle: "Equipo activo", icon: Users, roles: ["admin"] },
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
function isScheduleOnlyChange(previousTask, nextTask, user) {
  const role = normalizedRole(user?.role);
  if (!["admin", "chofer"].includes(role) || previousTask.start || !nextTask.start) return false;
  if (role === "chofer" && Number(previousTask.driverId) !== Number(user.currentDriverId)) return false;
  const { date: _previousDate, start: _previousStart, status: _previousStatus, updatedAt: _previousUpdatedAt, ...previousContent } = previousTask;
  const { date: _nextDate, start: _nextStart, status: _nextStatus, updatedAt: _nextUpdatedAt, ...nextContent } = nextTask;
  return JSON.stringify(previousContent) === JSON.stringify(nextContent);
}

function defaultVehicleDocs() {
  return [
    { id: "cedula-verde", name: "Cedula verde", expiry: addDays(240) },
    { id: "rto", name: "RTO", expiry: addDays(18) },
    { id: "seguro-poliza", name: "Seguro / poliza", expiry: addDays(90) },
  ];
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
  settings: { currentDriverId: 1 },
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

function encodeMap(value) {
  return encodeURIComponent(value || "");
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
  if (path === "/api/login" && method === "POST") {
    const credentials = JSON.parse(options.body || "{}");
    const found = savedUsers.find((item) => item.username === String(credentials.username || "").toLowerCase() && item.password === credentials.password);
    if (!found) return localResponse({ error: "Usuario o contrasena incorrectos" }, 401);
    return localResponse({ token: `local:${found.username}`, user: publicLocalUsers([found])[0], users: publicLocalUsers(savedUsers) });
  }
  if (path === "/api/logout") return localResponse({ ok: true });
  if (!current) return localResponse({ error: "Sesion vencida" }, 401);
  if (path === "/api/session") return localResponse({ user: publicLocalUsers([current])[0], users: publicLocalUsers(savedUsers) });
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
    return localResponse({ user: publicLocalUsers([current])[0], users: publicLocalUsers(savedUsers), data, revision });
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
      const { status: _previousStatus, ...previousContent } = previousTask;
      const { status: _nextStatus, ...nextContent } = nextTask;
      if (JSON.stringify(previousContent) !== JSON.stringify(nextContent)) {
        if (!isScheduleOnlyChange(previousTask, nextTask, current) && !taskOwnedBy(previousTask, current)) return localResponse({ error: "Solo puede editar la tarea el usuario que la asigno." }, 403);
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
    return localResponse({ user: nextCurrent, users: publicLocalUsers(nextUsers) });
  }
  return localResponse({ error: "Endpoint local no disponible" }, 404);
}

function appFetch(path, options) {
  return isLocalPreview() && path.startsWith("/api/") ? localApiFetch(path, options) : fetch(path, options);
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
  const [taskPrefill, setTaskPrefill] = useState({ date: localISO(), time: "" });
  const [editingTask, setEditingTask] = useState(null);

  const currentRole = normalizedRole(user?.role);
  const visibleViews = useMemo(() => views.filter((item) => canAccessView(currentRole, item)), [currentRole]);
  const currentView = visibleViews.find((item) => item.id === view) || visibleViews[0] || views[0];
  const isAdmin = currentRole === "admin";
  const canManageTasks = ["admin", "usuario"].includes(currentRole);
  const driverId = user?.currentDriverId || db.settings?.currentDriverId || 1;

  const dayTasks = useMemo(
    () => db.tasks.filter((task) => task.date === selectedDate).sort((a, b) => String(a.start).localeCompare(String(b.start))),
    [db.tasks, selectedDate],
  );

  const routeTasks = useMemo(
    () => db.tasks.filter((task) => task.date === routeDate && Number(task.driverId || driverId) === Number(driverId)),
    [db.tasks, driverId, routeDate],
  );

  const nextRouteDate = useMemo(() => {
    const dates = db.tasks
      .filter((task) => Number(task.driverId || driverId) === Number(driverId) && task.date > routeDate)
      .map((task) => task.date)
      .filter(Boolean)
      .sort();
    return dates[0] || null;
  }, [db.tasks, driverId, routeDate]);

  const previousRouteDate = useMemo(() => {
    const dates = db.tasks
      .filter((task) => Number(task.driverId || driverId) === Number(driverId) && task.date < routeDate)
      .map((task) => task.date)
      .filter(Boolean)
      .sort()
      .reverse();
    return dates[0] || null;
  }, [db.tasks, driverId, routeDate]);
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
    if (!user || canAccessView(currentRole, currentView)) return;
    const fallback = visibleViews[0]?.id || (currentRole === "chofer" ? "ruta" : "agenda");
    setView(fallback);
  }, [currentRole, currentView, user, visibleViews]);

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
    const nextDb = {
      ...db,
      tasks: mode === "edit" ? db.tasks.map((item) => (Number(item.id) === Number(nextTask.id) ? nextTask : item)) : [...db.tasks, nextTask],
    };
    await saveState(token, nextDb, revision, mode === "edit" ? "Tarea actualizada" : "Tarea creada");
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
    if (!taskOwnedBy(existing, user)) {
      notify("Solo puede editar la tarea el usuario que la asigno.", "error");
      throw new Error("No tiene permiso para editar esta tarea");
    }
    await persistTask({
      ...nextTask,
      assignedByUserId: existing.assignedByUserId,
      assignedByUserName: existing.assignedByUserName,
    }, "edit");
  }

  async function updateTask(task, status) {
    const nextDb = { ...db, tasks: db.tasks.map((item) => (item.id === task.id ? { ...item, status } : item)) };
    await saveState(token, nextDb, revision, "Estado actualizado");
  }
  async function scheduleTask(task, date, start) {
    if (task.start) throw new Error("Esta tarea ya tiene un horario asignado.");
    if (!["admin", "chofer"].includes(currentRole)) throw new Error("Solo el chofer o supervisor puede asignar horario.");
    if (currentRole === "chofer" && Number(task.driverId) !== Number(user.currentDriverId)) throw new Error("Esta tarea no esta asignada a este chofer.");
    const scheduledTask = { ...task, date: date || task.date || localISO(), start, updatedAt: new Date().toISOString() };
    const nextDb = { ...db, tasks: db.tasks.map((item) => Number(item.id) === Number(task.id) ? scheduledTask : item) };
    await saveState(token, nextDb, revision, "Horario asignado");
    setRouteDate(scheduledTask.date);
  }

  async function deleteTask(task) {
    const label = task.title || task.description || "esta tarea";
    if (!window.confirm(`¿Eliminar ${label}? Esta accion no se puede deshacer.`)) return;
    const nextDb = { ...db, tasks: db.tasks.filter((item) => Number(item.id) !== Number(task.id)) };
    await saveState(token, nextDb, revision, "Tarea eliminada");
  }

  async function saveDriver(nextDriver, account = null) {
    const exists = db.drivers.some((driver) => Number(driver.id) === Number(nextDriver.id));
    const nextDb = {
      ...db,
      drivers: exists ? db.drivers.map((driver) => (Number(driver.id) === Number(nextDriver.id) ? nextDriver : driver)) : [...db.drivers, nextDriver],
    };
    await saveState(token, nextDb, revision, exists ? "Chofer actualizado" : "Chofer creado");
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
    await saveState(token, nextDb, revision, exists ? "Camioneta actualizada" : "Camioneta creada");
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
            <span className="pill">{roleLabel(user.role)} - {user.name || user.username}</span>
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
              <div className="week">
                {week.map((day) => (
                  <button key={day.iso} className={`dayChip ${selectedDate === day.iso ? "active" : ""}`} onClick={() => setSelectedDate(day.iso)}>
                    {day.count > 0 ? <span className="taskDot" aria-label={`${day.count} tareas asignadas`} title={`${day.count} tareas asignadas`} /> : null}
                    <span>{day.label}</span>
                    <b>{day.day}</b>
                    <small>{day.count} tareas</small>
                  </button>
                ))}
              </div>
              <DailySchedule
                date={selectedDate}
                tasks={dayTasks}
                db={db}
                canCreate={canManageTasks}
                currentUser={user}
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
              <RouteTaskGroup title="Tareas del dia" count={routeTasks.filter((task) => task.start).length} defaultOpen>
                <TaskList tasks={routeTasks.filter((task) => task.start)} db={db} currentUser={user} onStatus={updateTask} onSchedule={scheduleTask} canSchedule={false} canOperate onEdit={(task) => {
                  setEditingTask(task);
                  setTaskPrefill({ date: task.date, time: task.start });
                  setView("nueva");
                }} />
              </RouteTaskGroup>
              <RouteTaskGroup title="Tareas sin horario" count={routeTasks.filter((task) => !task.start).length} defaultOpen>
                <TaskList tasks={routeTasks.filter((task) => !task.start)} db={db} currentUser={user} onStatus={updateTask} onSchedule={scheduleTask} canSchedule={["admin", "chofer"].includes(currentRole)} canOperate onEdit={(task) => {
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
              canAssignSchedule={["admin", "chofer"].includes(currentRole)}
              onCancel={() => { setEditingTask(null); setView("agenda"); }}
              onCreate={editingTask ? editTask : addTask}
              onError={(message) => notify(message, "error")}
            />
          )}

          {view === "vehiculos" && <Records items={db.vehicles} type="vehicle" onSave={saveVehicle} />}
          {view === "choferes" && <Records items={db.drivers} type="driver" users={users} onSave={saveDriver} />}
          {view === "configuracion" && <SettingsPanel user={user} users={users} db={db} token={token} revision={revision} onUsers={setUsers} onUser={setUser} onNotify={notify} />}
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
function TaskList({ tasks, db, currentUser, onStatus, onEdit, onSchedule, canSchedule, canOperate }) {
  if (!tasks.length) return <div className="empty">No hay tareas para este dia.</div>;
  return (
    <section className="routeTasks">
      {[...tasks].sort((a, b) => String(a.start || "").localeCompare(String(b.start || ""))).map((task) => {


        const stops = (task.stops || []).map((stop) => (typeof stop === "string" ? stop : stop.address)).filter(Boolean);
        const destinations = [task.destination, ...stops].filter(Boolean);
        return (
          <details className="driverTaskCard" key={task.id}>
            <summary className="driverTaskHeader">
              <span className="driverTaskHeading">
                <span className="driverTaskTime">{task.start ? formatTime24(task.start) : "Sin horario"}</span>
                <strong className="driverTaskTitle">{task.title || task.description || "Tarea sin titulo"}</strong>
              </span>
              <span className="driverTaskHeaderMeta">
                <span className={`status ${task.status}`}>{statusText[task.status] || task.status}</span>
                <ChevronDown className="driverTaskChevron" size={19} aria-hidden="true" />
              </span>
            </summary>
            <div className="driverTaskBody">

              <section className="driverTaskBlock">
                <span className="eyebrow">TAREA</span>
                <h4>{task.title || task.description || "Tarea sin titulo"}</h4>
                <p>{task.description || task.observations || "Sin descripcion cargada."}</p>
                <p><b>Observaciones:</b> {task.observations || "Sin observaciones"}</p>
              </section>
              <section className="driverTaskBlock highlight">
                <span className="eyebrow">DESTINOS</span>
                <h3>{destinations[0] || "Sin destino cargado"}</h3>
                {destinations.length > 1 ? <p>Luego: {destinations.slice(1).join(" / ")}</p> : null}
                <p>{task.distance ? `${task.distance} km entre destinos` : "Google Maps calculara el recorrido"}</p>
              </section>
              <div className="driverTaskActions">
                <a className="iconBtn navigationBtn" href={taskGoogleMapsURL(task)} target="_blank" rel="noreferrer" aria-label="Abrir navegacion en Google Maps" title="Abrir navegacion en Google Maps"><MapPin size={19} /></a>
                {!task.start && canSchedule ? <TaskSchedule task={task} onSchedule={onSchedule} /> : null}
                {taskOwnedBy(task, currentUser) ? <button className="btn" type="button" onClick={() => onEdit(task)}><Edit3 size={15} /> Editar</button> : null}
                {canOperate ? (
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
      await onSchedule(task, date, start);
      setEditing(false);
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
function DailySchedule({ date, tasks, db, canCreate, currentUser, onFreeSlot, onStatus, onEdit, onDelete, onSave }) {
  const hours = Array.from({ length: 13 }, (_, index) => index + 7);
  const outside = tasks.filter((task) => {
    const hour = Number(String(task.start || "00:00").split(":")[0]);
    return hour < 7 || hour > 19;
  });

  return (
    <section className="dailySchedule">
      <div className="scheduleSummary">
        <span><b>{tasks.length}</b> tareas del dia</span>
      </div>
      <div className="scheduleList">
        {hours.map((hour) => {
          const hourValue = `${String(hour).padStart(2, "0")}:00`;
          const hourTasks = tasks.filter((task) => Number(String(task.start || "00:00").split(":")[0]) === hour);
          return (
            <div className={`scheduleRow ${hourTasks.length ? "occupied" : "free"}`} key={hourValue}>
              <button className="scheduleTime" onClick={() => canCreate && onFreeSlot(hourValue)} title={`Crear tarea a las ${hourValue}`}>
                {hourValue}
              </button>
              <div className="scheduleContent">
                {hourTasks.length ? hourTasks.map((task) => <DailyTask key={task.id} task={task} db={db} canOperate={canCreate} currentUser={currentUser} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} onSave={onSave} />) : (
                  <button className="freeSlot" disabled={!canCreate} onClick={() => onFreeSlot(hourValue)}>
                    <span>Horario libre</span>
                    <small>Agregar tarea</small>
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
              <DailyTask task={task} db={db} canOperate={canCreate} currentUser={currentUser} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} onSave={onSave} outside />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DailyTask({ task, canOperate, currentUser, onStatus, onDelete, onSave, outside = false }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);
  const stops = (task.stops || []).map((stop) => (typeof stop === "string" ? stop : stop.address)).filter(Boolean);
  const canEdit = canOperate && taskOwnedBy(task, currentUser);

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
    <details className={`dailyTask ${outside ? "outside" : ""}`}>
      <summary>
        <span className="dailyTaskTime">{task.start}</span>
        <span className="dailyTaskMain">
          <b>{task.title || task.description || "Tarea sin titulo"}</b>
          <small>{task.origin || "Sin origen"} -&gt; {task.destination || "Sin destino final"}</small>
        </span>
        <span className={`status ${task.status}`}>{statusText[task.status] || task.status}</span>
      </summary>
      <div className={`dailyTaskDetail ${editing ? "editing" : ""}`}>
        {editing ? (
          <label className="inlineDescription">
            <b>Descripcion</b>
            <textarea value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} />
          </label>
        ) : <p>{task.description || "Sin descripcion"}</p>}
        <div className="dailyMeta">
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
            <>
              <span><b>Distancia</b>{task.distance || 0} km</span>
              <span><b>Mercaderia</b>{task.merchandise || "-"}</span>
              <span><b>Cantidades</b>{task.quantities || "-"}</span>
              <span><b>Contacto</b>{task.contact || "-"} {task.phone ? `- ${task.phone}` : ""}</span>
              <span><b>Asignada por</b>{task.assignedBy || "-"}</span>
              <span><b>Paradas</b>{stops.length ? stops.join(" / ") : "Sin paradas"}</span>
            </>
          )}
        </div>
        <div className="inlineActions">
          {editing ? (
            <>
              <button className="btn primary" type="button" onClick={saveInlineEdit} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
              <button className="btn" type="button" onClick={() => { setEditing(false); setDraft(null); }} disabled={saving}>Cancelar</button>
            </>
          ) : (
            <>
              <a className="btn primary" href={taskGoogleMapsURL(task)} target="_blank" rel="noreferrer">Abrir en Google Maps</a>
              <a className="btn" href={taskRouteURL(task)} target="_blank" rel="noreferrer">Abrir en OSM</a>
              {task.merchandisePdf?.data ? <a className="btn" href={task.merchandisePdf.data} download={task.merchandisePdf.name}>Abrir PDF</a> : null}
              {canEdit ? <button className="btn" type="button" onClick={beginEditing}><Edit3 size={15} /> Editar</button> : null}
              {canOperate ? <button className="iconBtn danger" type="button" onClick={() => onDelete(task)} aria-label="Eliminar tarea" title="Eliminar tarea"><Trash2 size={16} /></button> : null}
              {canOperate && task.status !== "en-trabajo" ? <button className="btn" onClick={() => onStatus(task, "en-trabajo")}>Iniciar</button> : null}
              {canOperate && task.status !== "realizada" ? <button className="btn primary" onClick={() => onStatus(task, "realizada")}>Finalizar</button> : null}
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

function NewTaskForm({ db, prefill, initialTask = null, currentDriverId, canAssignSchedule, onCancel, onCreate, onError }) {
  const [form, setForm] = useState(() => taskToForm(initialTask, prefill, currentDriverId, db));
  const [routeInfo, setRouteInfo] = useState({ status: "Google Maps usara tu ubicacion actual para iniciar el recorrido.", distance: "", coordinates: [] });
  const [calculating, setCalculating] = useState(false);
  const [pdf, setPdf] = useState(null);
  const isEditing = Boolean(initialTask);
  const canSetSchedule = canAssignSchedule && !initialTask?.start;
  const formResetKey = [
    initialTask?.id || "new",
    prefill.date || "",
    prefill.time || "",
    currentDriverId || "",
  ].join("|");

  useEffect(() => {
    setForm(taskToForm(initialTask, prefill, currentDriverId, db));
    setPdf(null);
    setRouteInfo({
      status: initialTask?.distance ? `${initialTask.distance} km entre destinos, estimado guardado.` : "Google Maps usara tu ubicacion actual para iniciar el recorrido.",
      distance: initialTask?.distance || "",
      coordinates: initialTask?.routeCoordinates || [],
    });
  }, [formResetKey]);

  useEffect(() => {
    const addresses = [form.destination, ...form.stops.map((value) => value.trim()).filter(Boolean)].filter(Boolean);
    if (addresses.length < 2) {
      setRouteInfo({ status: addresses.length ? "Google Maps calculara el recorrido desde tu ubicacion actual." : "Agrega un destino para abrir la navegacion.", distance: "", coordinates: [] });
      return undefined;
    }
    const timer = window.setTimeout(() => calculateRoute(addresses), 900);
    return () => window.clearTimeout(timer);
  }, [form.destination, form.stops]);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
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
    await onCreate({
      ...initialTask,
      id: initialTask?.id || Date.now(),
      title: form.title,
      description: form.title,
      merchandise: form.merchandise,
      quantities: form.quantities,
      merchandisePdf,
      observations: form.observations,
      date: canSetSchedule ? (form.date || localISO()) : (initialTask?.date || form.date || localISO()),
      start: canSetSchedule ? form.start : (initialTask?.start || ""),
      assigned: 0,
      duration: 0,
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
  }

  const previewDestination = [form.destination, ...form.stops].filter(Boolean).join(" -> ") || "Sin destino";

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
              <label>Horario <small>(opcional)</small></label>
              <div className="row">
                <div><label>Fecha</label><input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} /></div>
                <div><label>Hora de inicio</label><input type="time" value={form.start} onChange={(event) => update("start", event.target.value)} /></div>
              </div>
            </>
          ) : (
            <div className="routeNotice">{initialTask?.start ? `Horario programado: ${formatTime24(initialTask.start)}` : "Sin horario. El chofer o supervisor podra programarla."}</div>
          )}
        </Accordion>

        <Accordion title="2. A donde hay que ir (opcional)">
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
          <button className="btn primary" disabled={calculating}>{isEditing ? "Guardar cambios" : "Guardar y asignar tarea"}</button>
        </div>
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
        const response = await appFetch(`/api/geocode?q=${encodeURIComponent(query)}&limit=6`, { signal: controller.signal });
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
              <span>{addressLabel(address)}</span>
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
        {items.map((item) => (
          <article className="card record" key={item.id}>
            <div>
              <h3>{item.name}</h3>
              <p>{type === "vehicle" ? `${item.brand || ""} ${item.model || ""} - ${item.plate || ""}` : `${item.phone || ""} - Registro ${item.license || ""}`}</p>
              {isDriver && item.docs?.length ? <small>{item.docs.length} documentos adjuntos</small> : null}
              {isDriver ? <small>{users.find((user) => Number(user.currentDriverId) === Number(item.id))?.username ? `Usuario: ${users.find((user) => Number(user.currentDriverId) === Number(item.id)).username}` : "Sin usuario vinculado"}</small> : null}
              {isVehicle ? <small>{(item.docs?.length || defaultVehicleDocs().length)} documentos legales</small> : null}
            </div>
            <div className="recordActions">
              <span className="status">{item.status || "activo"}</span>
              {isDriver ? <button className="btn" onClick={() => setEditing(item)}><Edit3 size={15} /> Editar</button> : null}
              {isVehicle ? <button className="btn" onClick={() => setEditing(item)}><Edit3 size={15} /> Editar</button> : null}
            </div>
          </article>
        ))}
      </section>
    </>
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
      <div className="row">
        <div><label>Marca</label><input value={form.brand} onChange={(event) => update("brand", event.target.value)} /></div>
        <div><label>Modelo</label><input value={form.model} onChange={(event) => update("model", event.target.value)} /></div>
      </div>
      <div className="row">
        <div><label>Kilometraje</label><input type="number" min="0" value={form.km} onChange={(event) => update("km", event.target.value)} /></div>
        <div><label>Combustible</label><input value={form.fuel} onChange={(event) => update("fuel", event.target.value)} /></div>
      </div>
      <div className="row">
        <div><label>Salud (%)</label><input type="number" min="0" max="100" value={form.health} onChange={(event) => update("health", event.target.value)} /></div>
        <div><label>Estado</label><select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="disponible">Disponible</option><option value="en-taller">En taller</option><option value="fuera-de-servicio">Fuera de servicio</option></select></div>
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

function SettingsPanel({ user, users, db, token, revision, onUsers, onUser, onNotify }) {
  const [editingUser, setEditingUser] = useState(null);

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
