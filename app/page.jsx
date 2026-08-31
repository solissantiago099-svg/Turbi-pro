"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ClipboardList, LogOut, Menu, Plus, Route, Settings, Truck, Users } from "lucide-react";

const views = [
  { id: "agenda", label: "Agenda", subtitle: "Planificacion diaria", icon: CalendarDays },
  { id: "ruta", label: "Mi ruta", subtitle: "Trabajo del chofer", icon: Route },
  { id: "nueva", label: "Nueva tarea", subtitle: "Carga rapida", icon: Plus, supervisor: true },
  { id: "supervision", label: "Supervision", subtitle: "Estado operativo", icon: ClipboardList, supervisor: true },
  { id: "vehiculos", label: "Vehiculos", subtitle: "Flota y documentacion", icon: Truck, supervisor: true },
  { id: "choferes", label: "Choferes", subtitle: "Equipo activo", icon: Users, supervisor: true },
  { id: "configuracion", label: "Configuracion", subtitle: "Usuarios y respaldo", icon: Settings, supervisor: true },
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

function minutesFromTime(value) {
  if (!value) return 0;
  const [hours, minutes] = String(value).split(":").map(Number);
  return hours * 60 + minutes;
}

function daysUntil(iso) {
  if (!iso) return 999;
  return Math.ceil((new Date(`${iso}T12:00:00`) - new Date()) / 86400000);
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
  vehicles: [{ id: 1, name: "Camioneta 01", brand: "IVECO", model: "Daily", plate: "AE 123 CD", km: 58000, status: "disponible", fuel: "Diesel", health: 94 }],
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

function availableVehicle(vehicles) {
  return vehicles.find((vehicle) => !["en-taller", "fuera-de-servicio"].includes(vehicle.status)) || vehicles[0] || null;
}

function apiHeaders(token, extra = {}) {
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra;
}

export default function Home() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [db, setDb] = useState(seed);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState("agenda");
  const [selectedDate, setSelectedDate] = useState(localISO());
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [taskPrefill, setTaskPrefill] = useState({ date: localISO(), time: "" });

  const currentView = views.find((item) => item.id === view) || views[0];
  const isSupervisor = user?.role === "supervisor";
  const driverId = user?.currentDriverId || db.settings?.currentDriverId || 1;

  const dayTasks = useMemo(
    () => db.tasks.filter((task) => task.date === selectedDate).sort((a, b) => String(a.start).localeCompare(String(b.start))),
    [db.tasks, selectedDate],
  );

  const routeTasks = useMemo(
    () => db.tasks.filter((task) => task.date === localISO() && Number(task.driverId || driverId) === Number(driverId)),
    [db.tasks, driverId],
  );

  const week = useMemo(() => {
    const selected = new Date(`${selectedDate}T12:00:00`);
    const monday = new Date(selected);
    monday.setDate(selected.getDate() - ((selected.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => {
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
  }, [db.tasks, selectedDate]);

  function notify(message, type = "ok") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2600);
  }

  async function loadState(nextToken, silent = false) {
    const response = await fetch("/api/state", { headers: apiHeaders(nextToken, { accept: "application/json" }) });
    if (response.status === 401) throw new Error("Sesion vencida");
    if (!response.ok) throw new Error("No se pudo abrir la base compartida");
    const payload = await response.json();
    setUser((current) => ({ ...current, ...(payload.user || {}) }));
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
    const response = await fetch("/api/state", {
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
    fetch("/api/session", { headers: apiHeaders(saved, { accept: "application/json" }) })
      .then(async (response) => {
        if (!response.ok) throw new Error("Sesion vencida");
        const payload = await response.json();
        setUser(payload.user);
        setView(payload.user.role === "chofer" ? "ruta" : "agenda");
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

  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);
    setLoginError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/login", {
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
      setView(payload.user.role === "chofer" ? "ruta" : "agenda");
      await loadState(payload.token, true);
    } catch (error) {
      setLoginError(error.message || "No se pudo iniciar sesion");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST", headers: apiHeaders(token) }).catch(() => null);
    localStorage.removeItem("tamiz_session");
    setToken("");
    setUser(null);
    setView("agenda");
  }

  async function addTask(nextTask) {
    const assigned = Number(nextTask.assigned || nextTask.duration || 0);
    const start = minutesFromTime(nextTask.start);
    const end = start + assigned;
    const conflict = db.tasks.some((task) => {
      if (task.date !== nextTask.date || Number(task.driverId) !== Number(nextTask.driverId)) return false;
      const taskStart = minutesFromTime(task.start);
      const taskEnd = taskStart + Number(task.assigned || task.duration || 0);
      return start < taskEnd && end > taskStart;
    });
    if (conflict) {
      notify("El chofer ya tiene una tarea en ese intervalo.", "error");
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
    const nextDb = { ...db, tasks: [...db.tasks, nextTask] };
    await saveState(token, nextDb, revision, "Tarea creada");
    setSelectedDate(nextTask.date);
    setView("agenda");
  }

  async function updateTask(task, status) {
    const nextDb = { ...db, tasks: db.tasks.map((item) => (item.id === task.id ? { ...item, status } : item)) };
    await saveState(token, nextDb, revision, "Estado actualizado");
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
          <div className="hint">
            <b>Prueba inicial</b>
            <span>admin / admin123</span>
            <span>chofer / chofer123</span>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className={`shell ${menuOpen ? "menuOpen" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          TAMIZ <span>RUTAS</span>
        </div>
        <nav className="nav" aria-label="Navegacion principal">
          {views.map((item) => {
            const Icon = item.icon;
            const disabled = item.supervisor && !isSupervisor;
            return (
              <button
                key={item.id}
                className={view === item.id ? "active" : ""}
                disabled={disabled}
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
        <div className="sidebarFoot">Base compartida activa</div>
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
            <span className="pill">{user.role === "chofer" ? "Chofer" : "Supervisor"} - {user.name || user.username}</span>
            <button className="btn" onClick={logout}>
              <LogOut size={16} /> Salir
            </button>
          </div>
        </header>

        <div className="panel">
          {view === "agenda" && (
            <>
              <Kpis tasks={db.tasks} vehicles={db.vehicles} drivers={db.drivers} />
              <div className="agendaHead">
                <div>
                  <span className="eyebrow">AGENDA DIARIA</span>
                  <h2>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}</h2>
                </div>
                {isSupervisor ? <button className="btn primary" onClick={() => { setTaskPrefill({ date: selectedDate, time: "" }); setView("nueva"); }}>Agregar tarea</button> : null}
              </div>
              <div className="week">
                {week.map((day) => (
                  <button key={day.iso} className={`dayChip ${selectedDate === day.iso ? "active" : ""}`} onClick={() => setSelectedDate(day.iso)}>
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
                canCreate={isSupervisor}
                onFreeSlot={(time) => {
                  setTaskPrefill({ date: selectedDate, time });
                  setView("nueva");
                }}
                onStatus={updateTask}
              />
            </>
          )}

          {view === "ruta" && (
            <>
              <div className="toolbar">
                <div>
                  <span className="eyebrow">MI RUTA</span>
                  <h2>Trabajo de hoy</h2>
                </div>
              </div>
              <TaskList tasks={routeTasks} db={db} onStatus={updateTask} canOperate />
            </>
          )}

          {view === "nueva" && (
            <NewTaskForm
              db={db}
              prefill={taskPrefill}
              currentDriverId={driverId}
              onCancel={() => setView("agenda")}
              onCreate={addTask}
              onError={(message) => notify(message, "error")}
            />
          )}

          {view === "supervision" && <Supervision db={db} />}
          {view === "vehiculos" && <Records items={db.vehicles} type="vehicle" />}
          {view === "choferes" && <Records items={db.drivers} type="driver" />}
          {view === "configuracion" && <SettingsPanel user={user} revision={revision} />}
        </div>
      </section>
      {toast ? <div className={`toast show ${toast.type === "error" ? "error" : ""}`}>{toast.message}</div> : null}
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

function TaskList({ tasks, db, onStatus, canOperate }) {
  if (!tasks.length) return <div className="empty">No hay tareas para este dia.</div>;
  return (
    <section className="schedule">
      {tasks.map((task) => {
        const driver = db.drivers.find((item) => Number(item.id) === Number(task.driverId));
        const vehicle = db.vehicles.find((item) => Number(item.id) === Number(task.vehicleId));
        return (
          <article className="task" key={task.id}>
            <span className="taskTime">{task.start}</span>
            <div>
              <h3>{task.title || task.description}</h3>
              <p>{task.origin} -> {task.destination}</p>
              <p>{driver?.name || "Sin chofer"} - {vehicle ? `${vehicle.name} ${vehicle.plate}` : "Sin vehiculo"}</p>
              <p>{task.merchandise || "Mercaderia sin especificar"} {task.quantities ? `- ${task.quantities}` : ""}</p>
            </div>
            <div>
              <span className={`status ${task.status}`}>{statusText[task.status] || task.status}</span>
              {canOperate ? (
                <div className="actions">
                  {task.status !== "en-trabajo" ? <button className="btn" onClick={() => onStatus(task, "en-trabajo")}>Iniciar</button> : null}
                  {task.status !== "realizada" ? <button className="btn primary" onClick={() => onStatus(task, "realizada")}>Finalizar</button> : null}
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function DailySchedule({ date, tasks, db, canCreate, onFreeSlot, onStatus }) {
  const hours = Array.from({ length: 13 }, (_, index) => index + 7);
  const outside = tasks.filter((task) => {
    const hour = Number(String(task.start || "00:00").split(":")[0]);
    return hour < 7 || hour > 19;
  });

  return (
    <section className="dailySchedule">
      <div className="scheduleSummary">
        <span><b>{tasks.length}</b> tareas del dia</span>
        {canCreate ? <button className="btn primary" onClick={() => onFreeSlot("09:00")}>Agregar tarea</button> : null}
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
                {hourTasks.length ? hourTasks.map((task) => <DailyTask key={task.id} task={task} db={db} canOperate={canCreate} onStatus={onStatus} />) : (
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
              <DailyTask task={task} db={db} canOperate={canCreate} onStatus={onStatus} outside />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DailyTask({ task, db, canOperate, onStatus, outside = false }) {
  const driver = db.drivers.find((item) => Number(item.id) === Number(task.driverId));
  const vehicle = db.vehicles.find((item) => Number(item.id) === Number(task.vehicleId));
  const stops = (task.stops || []).map((stop) => (typeof stop === "string" ? stop : stop.address)).filter(Boolean);

  return (
    <details className={`dailyTask ${outside ? "outside" : ""}`}>
      <summary>
        <span className="dailyTaskTime">{task.start}</span>
        <span className="dailyTaskMain">
          <b>{task.title || task.description || "Tarea sin titulo"}</b>
          <small>{task.origin || "Sin origen"} -> {task.destination || "Sin destino final"}</small>
        </span>
        <span className={`status ${task.status}`}>{statusText[task.status] || task.status}</span>
      </summary>
      <div className="dailyTaskDetail">
        <p>{task.description || "Sin descripcion"}</p>
        <div className="dailyMeta">
          <span><b>Chofer</b>{driver?.name || "Sin asignar"}</span>
          <span><b>Vehiculo</b>{vehicle ? `${vehicle.name} - ${vehicle.plate}` : "Sin asignar"}</span>
          <span><b>Duracion</b>{task.assigned || task.duration || 0} min</span>
          <span><b>Distancia</b>{task.distance || 0} km</span>
          <span><b>Mercaderia</b>{task.merchandise || "-"}</span>
          <span><b>Cantidades</b>{task.quantities || "-"}</span>
          <span><b>Contacto</b>{task.contact || "-"} {task.phone ? `- ${task.phone}` : ""}</span>
          <span><b>Asignada por</b>{task.assignedBy || "-"}</span>
          <span><b>Paradas</b>{stops.length ? stops.join(" / ") : "Sin paradas"}</span>
        </div>
        <div className="inlineActions">
          <a className="btn" href={taskRouteURL(task)} target="_blank" rel="noreferrer">Abrir ruta</a>
          {task.merchandisePdf?.data ? <a className="btn" href={task.merchandisePdf.data} download={task.merchandisePdf.name}>Abrir PDF</a> : null}
          {canOperate && task.status !== "en-trabajo" ? <button className="btn" onClick={() => onStatus(task, "en-trabajo")}>Iniciar</button> : null}
          {canOperate && task.status !== "realizada" ? <button className="btn primary" onClick={() => onStatus(task, "realizada")}>Finalizar</button> : null}
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

function NewTaskForm({ db, prefill, currentDriverId, onCancel, onCreate, onError }) {
  const [form, setForm] = useState({
    title: "",
    merchandise: "",
    quantities: "",
    observations: "",
    date: prefill.date || localISO(),
    start: prefill.time || "",
    assigned: "",
    duration: "",
    origin: "",
    stops: "",
    destination: "",
    contact: "",
    phone: "",
    assignedBy: "",
    driverId: currentDriverId || db.drivers[0]?.id || "",
    vehicleId: availableVehicle(db.vehicles)?.id || "",
  });
  const [routeInfo, setRouteInfo] = useState({ status: "El destino final es opcional. Podes cargar varias direcciones en Paradas.", distance: "", coordinates: [] });
  const [calculating, setCalculating] = useState(false);
  const [pdf, setPdf] = useState(null);

  useEffect(() => {
    setForm((current) => ({ ...current, date: prefill.date || localISO(), start: prefill.time || "" }));
  }, [prefill]);

  useEffect(() => {
    const addresses = [form.origin, ...form.stops.split("\n").map((value) => value.trim()).filter(Boolean), form.destination].filter(Boolean);
    if (addresses.length < 2) {
      setRouteInfo({ status: "Cargá origen y al menos un destino/parada para calcular OSRM.", distance: "", coordinates: [] });
      setForm((current) => ({ ...current, assigned: "", duration: "" }));
      return undefined;
    }
    const timer = window.setTimeout(() => calculateRoute(addresses), 900);
    return () => window.clearTimeout(timer);
  }, [form.origin, form.stops, form.destination]);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function geocodeAddress(address) {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
    if (!response.ok) throw new Error(`El geocodificador respondio ${response.status}`);
    const results = await response.json();
    const result = results[0];
    if (!result) throw new Error(`No se encontro la direccion: ${address}`);
    return [Number(result.lon), Number(result.lat)];
  }

  async function calculateRoute(addresses) {
    setCalculating(true);
    setRouteInfo((current) => ({ ...current, status: "Buscando direcciones y calculando la ruta con OSRM..." }));
    try {
      const coordinates = [];
      for (const address of addresses) coordinates.push(await geocodeAddress(address));
      const routeResponse = await fetch(`/api/route?coordinates=${coordinates.map((point) => point.join(",")).join(";")}`);
      if (!routeResponse.ok) throw new Error(`OSRM respondio ${routeResponse.status}`);
      const payload = await routeResponse.json();
      const route = payload.routes?.[0];
      if (payload.code !== "Ok" || !route) throw new Error(payload.message || "OSRM no encontro una ruta");
      const minutes = Math.max(1, Math.ceil(route.duration / 60));
      const distance = (route.distance / 1000).toFixed(1);
      setForm((current) => ({ ...current, assigned: String(minutes), duration: String(minutes) }));
      setRouteInfo({ status: `${minutes} min - ${distance} km, estimado por OSRM. Sin trafico en vivo.`, distance, coordinates });
    } catch (error) {
      setForm((current) => ({ ...current, assigned: "", duration: "" }));
      setRouteInfo({ status: error.message || "No se pudo calcular la ruta.", distance: "", coordinates: [] });
    } finally {
      setCalculating(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!Number(form.assigned || form.duration || 0)) {
      onError("Esperá a que OSRM calcule la duracion o revisá las direcciones.");
      return;
    }
    let merchandisePdf = null;
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
      id: Date.now(),
      title: form.title,
      description: form.title,
      merchandise: form.merchandise,
      quantities: form.quantities,
      merchandisePdf,
      observations: form.observations,
      date: form.date,
      start: form.start,
      assigned: Number(form.assigned),
      duration: Number(form.duration),
      origin: form.origin,
      destination: form.destination,
      stops: form.stops.split("\n").map((value) => value.trim()).filter(Boolean),
      contact: form.contact,
      phone: form.phone,
      assignedBy: form.assignedBy,
      driverId: Number(form.driverId),
      vehicleId: Number(form.vehicleId),
      distance: Number(routeInfo.distance || 0),
      routeCoordinates: routeInfo.coordinates,
      status: "pendiente",
      createdAt: new Date().toISOString(),
    });
  }

  const previewDestination = form.destination || "Destino opcional / paradas";

  return (
    <div className="formLayout">
      <form className="taskForm" onSubmit={submit}>
        <Accordion title="1. Tarea a realizar">
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
            <small>{pdf?.name || "Ningun archivo seleccionado"}</small>
          </label>
          <label>Observaciones</label>
          <textarea value={form.observations} onChange={(event) => update("observations", event.target.value)} />
        </Accordion>

        <Accordion title="2. Fecha y hora">
          <div className="row">
            <div><label>Fecha</label><input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} required /></div>
            <div><label>Hora de inicio</label><input type="time" value={form.start} onChange={(event) => update("start", event.target.value)} required /></div>
          </div>
          <label>Duracion calculada por OSRM (min)</label>
          <input type="number" min="1" value={form.assigned} readOnly />
          <div className={`routeNotice ${routeInfo.distance ? "success" : ""}`}>{calculating ? "Calculando..." : routeInfo.status}</div>
        </Accordion>

        <Accordion title="3. Origen y destino">
          <datalist id="frequent-addresses">{frequentAddresses.map((address) => <option key={address} value={address} />)}</datalist>
          <label>Direccion de origen</label>
          <input value={form.origin} list="frequent-addresses" autoComplete="off" onChange={(event) => update("origin", event.target.value)} required />
          <QuickAddresses onPick={(value) => update("origin", value)} />
          <label>Paradas (una direccion por linea)</label>
          <textarea value={form.stops} onChange={(event) => update("stops", event.target.value)} />
          <label>Direccion de destino <small>(opcional)</small></label>
          <input value={form.destination} list="frequent-addresses" autoComplete="off" placeholder="Podes dejarla vacia y usar varias paradas" onChange={(event) => update("destination", event.target.value)} />
          <QuickAddresses onPick={(value) => update("destination", value)} />
        </Accordion>

        <Accordion title="4. Contacto" defaultOpen={false}>
          <div className="row">
            <div><label>Persona</label><input value={form.contact} onChange={(event) => update("contact", event.target.value)} /></div>
            <div><label>Telefono</label><input inputMode="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} /></div>
          </div>
          <label>Area que asigna</label>
          <input value={form.assignedBy} onChange={(event) => update("assignedBy", event.target.value)} />
          <div className="row">
            <div><label>Chofer</label><select value={form.driverId} onChange={(event) => update("driverId", event.target.value)}>{db.drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></div>
            <div><label>Vehiculo</label><select value={form.vehicleId} onChange={(event) => update("vehicleId", event.target.value)}>{db.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} - {vehicle.plate}</option>)}</select></div>
          </div>
        </Accordion>

        <div className="actions">
          <button className="btn" type="button" onClick={onCancel}>Cancelar</button>
          <button className="btn primary" disabled={calculating}>Guardar y asignar tarea</button>
        </div>
      </form>
      <aside className="summaryCard">
        <span className="eyebrow">RESUMEN</span>
        <p><b>{form.title || "Nueva tarea"}</b></p>
        <p>{form.origin || "Origen"} -> {previewDestination}</p>
        <p>{form.start || "-"} - {form.duration || "sin calcular"} min{routeInfo.distance ? ` - ${routeInfo.distance} km` : ""}</p>
      </aside>
    </div>
  );
}

function QuickAddresses({ onPick }) {
  return (
    <div className="quickAddresses">
      {frequentAddresses.slice(0, 3).map((address) => (
        <button className="quickAddress" type="button" key={address} onClick={() => onPick(address)}>
          {address}
        </button>
      ))}
    </div>
  );
}

function Supervision({ db }) {
  return (
    <section className="grid">
      {db.drivers.map((driver) => {
        const assigned = db.tasks.filter((task) => Number(task.driverId) === Number(driver.id) && task.date === localISO());
        return (
          <article className="card" key={driver.id}>
            <span className="eyebrow">CHOFER</span>
            <h2>{driver.name}</h2>
            <p>{assigned.length} tareas asignadas hoy</p>
          </article>
        );
      })}
    </section>
  );
}

function Records({ items, type }) {
  return (
    <section className="grid">
      {items.map((item) => (
        <article className="card record" key={item.id}>
          <div>
            <h3>{item.name}</h3>
            <p>{type === "vehicle" ? `${item.brand || ""} ${item.model || ""} - ${item.plate || ""}` : `${item.phone || ""} - Registro ${item.license || ""}`}</p>
          </div>
          <span className="status">{item.status || "activo"}</span>
        </article>
      ))}
    </section>
  );
}

function SettingsPanel({ user, revision }) {
  return (
    <section className="grid">
      <article className="card">
        <span className="eyebrow">USUARIO</span>
        <h2>{user.name || user.username}</h2>
        <p>Rol: {user.role === "chofer" ? "Chofer" : "Supervisor"}</p>
      </article>
      <article className="card">
        <span className="eyebrow">SINCRONIZACION</span>
        <h2>Base compartida</h2>
        <p>Revision actual: {revision}</p>
      </article>
    </section>
  );
}
