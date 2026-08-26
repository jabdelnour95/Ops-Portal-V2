import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMaintenanceObservations,
  parseMaintenanceObservations,
} from '../js/modules/food-maintenance-meta.mjs';

test('builds maintenance observations with multiple beds, pending status, notes, and participants', () => {
  const text = buildMaintenanceObservations({
    bedCodes: ['SAFBC-01', 'SAFBC-02'],
    status: 'pending',
    notes: 'Faltó terminar por lluvia.',
    participants: ['Ana', 'Carlos'],
  });

  assert.equal(
    text,
    'Camas: SAFBC-01, SAFBC-02\n\n⏳ Quedó pendiente de terminar.\n\nFaltó terminar por lluvia.\n\nParticipantes: Ana, Carlos',
  );
});

test('parses the structured maintenance observations format back into form-friendly fields', () => {
  const parsed = parseMaintenanceObservations(
    'Camas: SAFBC-01, SAFBC-02\n\n⏳ Quedó pendiente de terminar.\n\nFaltó terminar por lluvia.\n\nParticipantes: Ana, Carlos',
  );

  assert.deepEqual(parsed, {
    bedCodes: ['SAFBC-01', 'SAFBC-02'],
    status: 'pending',
    notes: 'Faltó terminar por lluvia.',
    participants: ['Ana', 'Carlos'],
  });
});

test('parses legacy single-bed observations and defaults missing status to completed', () => {
  const parsed = parseMaintenanceObservations(
    'Cama: HU-03\n\nSe limpió parcialmente.\n\nParticipantes: Kennedy',
  );

  assert.deepEqual(parsed, {
    bedCodes: ['HU-03'],
    status: 'completed',
    notes: 'Se limpió parcialmente.',
    participants: ['Kennedy'],
  });
});
