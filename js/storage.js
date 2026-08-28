const KEYS = {
  tasks: "tamiz_tasks",
  vehicles: "tamiz_vehicles",
  drivers: "tamiz_drivers",
  settings: "tamiz_settings",
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? structuredClone(fallback) : JSON.parse(raw);
  } catch (error) {
    console.warn(`No se pudo leer ${key}. Se conservará el valor dañado.`, error);
    return structuredClone(fallback);
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`No se pudo guardar ${key}.`, error);
    return false;
  }
}

export const storage = {
  load(seed) {
    return {
      tasks: read(KEYS.tasks, seed.tasks),
      vehicles: read(KEYS.vehicles, seed.vehicles),
      drivers: read(KEYS.drivers, seed.drivers),
      settings: read(KEYS.settings, seed.settings),
    };
  },
  save(db) {
    return [
      write(KEYS.tasks, db.tasks),
      write(KEYS.vehicles, db.vehicles),
      write(KEYS.drivers, db.drivers),
      write(KEYS.settings, db.settings),
    ].every(Boolean);
  },
};
