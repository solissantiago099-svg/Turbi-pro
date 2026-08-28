function encode(value) { return encodeURIComponent(value || ""); }

export function taskRouteURL(task) {
  const stops = (task.stops || []).map(stop => typeof stop === "string" ? stop : stop.address).filter(Boolean);
  const waypoints = stops.length ? `&waypoints=${encode(stops.join("|"))}` : "";
  return `https://www.google.com/maps/dir/?api=1&origin=${encode(task.origin)}&destination=${encode(task.destination)}${waypoints}&travelmode=driving`;
}

export function dayRouteURL(tasks) {
  const ordered = [...tasks].sort((a, b) => a.start.localeCompare(b.start));
  if (!ordered.length) return null;
  const points = [ordered[0].origin, ...ordered.flatMap(task => [ ...(task.stops || []).map(stop => typeof stop === "string" ? stop : stop.address), task.destination ])].filter(Boolean);
  if (points.length < 2) return null;
  const origin = points.shift();
  const destination = points.pop();
  const waypoints = points.length ? `&waypoints=${encode(points.join("|"))}` : "";
  return `https://www.google.com/maps/dir/?api=1&origin=${encode(origin)}&destination=${encode(destination)}${waypoints}&travelmode=driving`;
}
