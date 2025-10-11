export const getNumeric = (entities, prefix, id, fallback = 0) => {
  const entity = entities[`${prefix}-${id}`];
  const raw = entity?.value ?? entity?.state;
  const value = typeof raw === "number" ? raw : parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
};

export const getBoolean = (entities, prefix, id) => {
  const entity = entities[`${prefix}-${id}`];
  if (!entity) return false;
  if (typeof entity.value === "boolean") return entity.value;
  if (typeof entity.state === "boolean") return entity.state;
  return entity.state === "ON" || entity.state === true;
};

export const getText = (entities, id, fallback = "") =>
  entities[`text_sensor-${id}`]?.state ?? fallback;
