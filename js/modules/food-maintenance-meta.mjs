export function buildMaintenanceObservations({
  bedCodes = [],
  status = 'completed',
  notes = '',
  participants = [],
} = {}) {
  const parts = [];
  const cleanBeds = [...new Set((bedCodes || []).map(code => String(code || '').trim()).filter(Boolean))];
  const cleanParticipants = [...new Set((participants || []).map(name => String(name || '').trim()).filter(Boolean))];
  const cleanNotes = String(notes || '').trim();

  if (cleanBeds.length) {
    parts.push(`${cleanBeds.length === 1 ? 'Cama' : 'Camas'}: ${cleanBeds.join(', ')}`);
  }
  if (status === 'pending') {
    parts.push('⏳ Quedó pendiente de terminar.');
  }
  if (cleanNotes) {
    parts.push(cleanNotes);
  }
  if (cleanParticipants.length) {
    parts.push(`Participantes: ${cleanParticipants.join(', ')}`);
  }

  return parts.join('\n\n') || null;
}

export function parseMaintenanceObservations(raw) {
  const parts = String(raw || '')
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean);

  const parsed = {
    bedCodes: [],
    status: 'completed',
    notes: '',
    participants: [],
  };
  const notes = [];

  for (const part of parts) {
    if (part === '⏳ Quedó pendiente de terminar.') {
      parsed.status = 'pending';
      continue;
    }

    if (/^Estado de la tarea:\s*/i.test(part)) {
      parsed.status = /pend/i.test(part) ? 'pending' : 'completed';
      continue;
    }

    if (/^Participantes:\s*/i.test(part)) {
      parsed.participants = part
        .replace(/^Participantes:\s*/i, '')
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);
      continue;
    }

    if (/^Camas?:\s*/i.test(part)) {
      parsed.bedCodes = part
        .replace(/^Camas?:\s*/i, '')
        .split(',')
        .map(code => code.trim())
        .filter(Boolean);
      continue;
    }

    notes.push(part);
  }

  parsed.notes = notes.join('\n\n');
  return parsed;
}
