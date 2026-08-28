export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function localISO(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localISO(date);
}

export function nowTime() {
  return new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export function minutesFromTime(value) {
  if (!value) return 0;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function timeFromDate(value) {
  return value ? new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "—";
}

export function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

export function statusLabel(status) {
  return ({ pendiente: "Pendiente", "en-trabajo": "En trabajo", "en-destino": "En destino", realizada: "Realizada", cancelada: "Cancelada" })[status] || status;
}

export function daysUntil(iso) {
  return Math.ceil((new Date(`${iso}T12:00:00`) - new Date()) / 86_400_000);
}
