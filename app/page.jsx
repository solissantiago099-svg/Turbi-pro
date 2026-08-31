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

  async function addTask(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextTask = {
      id: Date.now(),
      date: String(form.get("date") || localISO()),
      start: String(form.get("start") || "09:00"),
      title: String(form.get("title") || "Nueva tarea"),
      description: String(form.get("description") || form.get("title") || ""),
      origin: String(form.get("origin") || ""),
      destination: String(form.get("destination") || ""),
      merchandise: String(form.get("merchandise") || ""),
      quantities: String(form.get("quantities") || ""),
      contact: String(form.get("contact") || ""),
      phone: String(form.get("phone") || ""),
      status: "pendiente",
      duration: Number(form.get("duration") || 45),
      driverId: Number(form.get("driverId") || driverId),
      vehicleId: Number(form.get("vehicleId") || 1),
    };
    const nextDb = { ...db, tasks: [...db.tasks, nextTask] };
    await saveState(token, nextDb, revision, "Tarea creada");
    setSelectedDate(nextTask.date);
    setView("agenda");
    event.currentTarget.reset();
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
                {isSupervisor ? <button className="btn primary" onClick={() => setView("nueva")}>Agregar tarea</button> : null}
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
              <TaskList tasks={dayTasks} db={db} onStatus={updateTask} canOperate={isSupervisor} />
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
            <form className="formCard" onSubmit={addTask}>
              <div className="row">
                <div><label>Fecha</label><input name="date" type="date" defaultValue={selectedDate} required /></div>
                <div><label>Hora</label><input name="start" type="time" defaultValue="09:00" required /></div>
              </div>
              <label>Titulo</label>
              <input name="title" placeholder="Entrega, retiro o traslado" required />
              <label>Descripcion</label>
              <textarea name="description" placeholder="Detalle operativo" />
              <div className="row">
                <div><label>Origen</label><input name="origin" placeholder="Direccion de salida" required /></div>
                <div><label>Destino</label><input name="destination" placeholder="Direccion final" required /></div>
              </div>
              <div className="row">
                <div><label>Mercaderia</label><input name="merchandise" /></div>
                <div><label>Cantidades</label><input name="quantities" /></div>
              </div>
              <div className="row">
                <div><label>Chofer</label><select name="driverId">{db.drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></div>
                <div><label>Vehiculo</label><select name="vehicleId">{db.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} - {vehicle.plate}</option>)}</select></div>
              </div>
              <div className="row">
                <div><label>Contacto</label><input name="contact" /></div>
                <div><label>Telefono</label><input name="phone" /></div>
              </div>
              <div className="actions">
                <button className="btn" type="button" onClick={() => setView("agenda")}>Cancelar</button>
                <button className="btn primary">Guardar tarea</button>
              </div>
            </form>
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
