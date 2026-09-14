"use client";
import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";

export default function TaskNotifications({ tasks, user, driverId, onOpen }) {
  const storageKey = "tamiz_notifications_read_" + user.id;
  const [read, setRead] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      setRead(Array.isArray(saved) ? saved : []);
    } catch { setRead([]); }
  }, [storageKey]);
  const items = tasks.filter(task => !task.isScheduleBlock && task.assignedByUserId &&
    String(task.assignedByUserId) !== String(user.id) &&
    (user.role !== "chofer" || Number(task.driverId || driverId) === Number(driverId)))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const key = task => [task.id, task.driverId || "", task.createdAt || ""].join(":");
  const unread = items.filter(task => !read.includes(key(task)));
  function markRead(selected) {
    const next = [...new Set([...read, ...selected.map(key)])];
    setRead(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  }
  return <div className="taskNotifications">
    <button type="button" className="iconBtn" aria-label={"Notificaciones: " + unread.length + " sin leer"} aria-expanded={open} onClick={() => setOpen(!open)}>
      <Bell size={20} />
      {unread.length > 0 && <span className="notificationBadge">{unread.length}</span>}
    </button>
    {open && <section className="notificationPanel" aria-label="Notificaciones de tareas">
      <header><b>Notificaciones ({unread.length})</b><button className="iconBtn" aria-label="Cerrar notificaciones" onClick={() => setOpen(false)}><X size={18} /></button></header>
      {unread.length > 0 && <button className="btn" onClick={() => markRead(items)}>Marcar todas como leídas</button>}
      {!items.length && <p>No hay notificaciones de tareas.</p>}
      <div className="notificationList">{items.map(task => <button key={key(task)} className={"notificationItem " + (read.includes(key(task)) ? "" : "unread")} onClick={() => { markRead([task]); setOpen(false); onOpen(task); }}>
        <b>{task.title || task.description || "Nueva tarea asignada"}</b>
        <span>Asignada por {task.assignedByUserName || "otro usuario"}</span>
        <small>{task.date || "Sin fecha"} · {task.start || "Sin horario"}</small>
      </button>)}</div>
    </section>}
  </div>;
}
