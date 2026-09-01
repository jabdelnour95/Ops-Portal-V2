export const TASK_TARGETS = {
  alimentos: {
    label: 'Producción de Alimentos',
    forms: {
      'prep-cama': { label: 'Preparar Cama', record_resource: 'food.bed-preparations' },
      siembra: { label: 'Siembra', record_resource: 'food.plantings' },
      'aplic-insumos': { label: 'Aplicar Insumos', record_resource: 'food.input-applications' },
      mantenimiento: { label: 'Mantenimiento', record_resource: 'food.area-maintenance' },
      disponibilidad: { label: 'Disponibilidad', record_resource: 'food.availability' },
      cosecha: { label: 'Cosecha', record_resource: 'food.harvests' },
    },
  },
  biofabrica: {
    label: 'Biofábrica',
    forms: {
      entrada: { label: 'Entrada de Materia Prima', record_resource: 'bio.raw-material-entries' },
      'abrir-lote': { label: 'Abrir Lote de Producción', record_resource: 'bio.batches' },
      'cerrar-lote': { label: 'Cerrar Lote de Producción', record_resource: 'bio.batches' },
      salida: { label: 'Registrar Salida', record_resource: 'bio.outputs' },
    },
  },
  vivero: {
    label: 'Vivero',
    forms: {
      entrada: { label: 'Entrada de Materia Prima', record_resource: 'nursery.raw-material-entries' },
      sustrato: { label: 'Preparar Sustrato', record_resource: 'nursery.substrate-batches' },
      llenado: { label: 'Llenar Bolsas / Macetas', record_resource: 'nursery.container-fills' },
      'crear-lote': { label: 'Crear Lote', record_resource: 'nursery.lots' },
    },
  },
};

export function getTaskTarget(moduleKey, formKey) {
  return TASK_TARGETS[moduleKey]?.forms?.[formKey] || null;
}

export function getTaskRecordResource(moduleKey, formKey) {
  return getTaskTarget(moduleKey, formKey)?.record_resource || null;
}

export function isValidTaskTarget(moduleKey, formKey) {
  return !!getTaskTarget(moduleKey, formKey);
}

export function normalizeRecurrence(value) {
  const recurrence = String(value || 'none').trim().toLowerCase();
  return ['none', 'weekly', 'biweekly', 'monthly'].includes(recurrence) ? recurrence : null;
}

export function normalizeTaskAssigneeIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter(id => typeof id === 'string' && id.trim()))];
}

function isoDateFromUtc(date) {
  return date.toISOString().slice(0, 10);
}

export function computeNextDueDate(dueDate, recurrence) {
  const normalized = normalizeRecurrence(recurrence);
  if (!normalized || normalized === 'none' || !dueDate) return null;

  const date = new Date(`${dueDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  if (normalized === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
  if (normalized === 'biweekly') date.setUTCDate(date.getUTCDate() + 14);
  if (normalized === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);

  return isoDateFromUtc(date);
}
