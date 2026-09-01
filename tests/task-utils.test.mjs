import test from 'node:test';
import assert from 'node:assert/strict';

import { computeNextDueDate, getTaskRecordResource, isValidTaskTarget, normalizeRecurrence, normalizeTaskAssigneeIds } from '../worker/task-utils.mjs';

test('validates known task target combinations', () => {
  assert.equal(isValidTaskTarget('alimentos', 'mantenimiento'), true);
  assert.equal(isValidTaskTarget('biofabrica', 'cerrar-lote'), true);
  assert.equal(isValidTaskTarget('vivero', 'cotizacion'), false);
  assert.equal(getTaskRecordResource('alimentos', 'siembra'), 'food.plantings');
});

test('normalizes supported recurrence values', () => {
  assert.equal(normalizeRecurrence('weekly'), 'weekly');
  assert.equal(normalizeRecurrence('MONTHLY'), 'monthly');
  assert.equal(normalizeRecurrence('custom'), null);
});

test('normalizes one or more unique task assignees', () => {
  assert.deepEqual(normalizeTaskAssigneeIds('worker-a'), ['worker-a']);
  assert.deepEqual(normalizeTaskAssigneeIds(['worker-a', 'worker-b', 'worker-a', '', null]), ['worker-a', 'worker-b']);
  assert.deepEqual(normalizeTaskAssigneeIds([]), []);
});

test('computes next due date for weekly, biweekly, and monthly tasks', () => {
  assert.equal(computeNextDueDate('2026-08-26', 'weekly'), '2026-09-02');
  assert.equal(computeNextDueDate('2026-08-26', 'biweekly'), '2026-09-09');
  assert.equal(computeNextDueDate('2026-08-26', 'monthly'), '2026-09-26');
  assert.equal(computeNextDueDate('2026-08-26', 'none'), null);
});
