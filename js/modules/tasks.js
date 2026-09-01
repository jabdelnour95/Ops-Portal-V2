import { show } from './navigation.js';
import { state } from './state.js';

const API = 'https://tierramor-api.jabdelnour95.workers.dev';

const TASK_TARGETS = {
  alimentos: {
    label: 'Producción de Alimentos',
    forms: {
      'prep-cama': { label: 'Preparar Cama' },
      siembra: { label: 'Siembra' },
      'aplic-insumos': { label: 'Aplicar Insumos' },
      mantenimiento: { label: 'Mantenimiento' },
      disponibilidad: { label: 'Disponibilidad' },
      cosecha: { label: 'Cosecha' },
    },
  },
  biofabrica: {
    label: 'Biofábrica',
    forms: {
      entrada: { label: 'Entrada de Materia Prima' },
      'abrir-lote': { label: 'Abrir Lote de Producción' },
      'cerrar-lote': { label: 'Cerrar Lote de Producción' },
      salida: { label: 'Registrar Salida' },
    },
  },
  vivero: {
    label: 'Vivero',
    forms: {
      entrada: { label: 'Entrada de Materia Prima' },
      sustrato: { label: 'Preparar Sustrato' },
      llenado: { label: 'Llenar Bolsas / Macetas' },
      'crear-lote': { label: 'Crear Lote' },
    },
  },
};

const RECURRENCE_LABELS = {
  none: 'Una sola vez',
  weekly: 'Cada semana',
  biweekly: 'Cada dos semanas',
  monthly: 'Cada mes',
};

let _taskRows = [];
let _homePendingRows = [];
let _homeCompletedRows = [];

async function _api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.accessToken}`,
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Error ${res.status}`);
  return data;
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _fmtDate(dateStr) {
  if (!dateStr) return 'Sin fecha';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function _targetLabel(task) {
  const module = TASK_TARGETS[task.module_key];
  const form = module?.forms?.[task.form_key];
  return {
    module: module?.label || task.module_key,
    form: form?.label || task.form_key,
  };
}

function _isAdmin() {
  return state.currentUser?.profile?.role === 'admin';
}

function _taskCard(task, idx, { showAssignee = false, showAssignedBy = false, showAction = false, showManage = false } = {}) {
  const labels = _targetLabel(task);
  const dueTone = task.status === 'pending'
    ? 'background:rgba(153,92,68,.10);color:var(--clay);'
    : 'background:rgba(118,114,78,.12);color:var(--green);';
  const meta = [
    `Vence: ${_fmtDate(task.due_date)}`,
    RECURRENCE_LABELS[task.recurrence] || task.recurrence,
    showAssignee && task.assigned_to_name ? `Asignada a: ${task.assigned_to_name}` : null,
    showAssignedBy && task.assigned_by_name ? `Creada por: ${task.assigned_by_name}` : null,
    task.completed_at ? `Completada: ${_fmtDate(task.completed_at.slice(0, 10))}` : null,
  ].filter(Boolean);

  return `<div style="background:white;border:1px solid rgba(84,66,54,.12);border-radius:12px;padding:.85rem .95rem;margin-bottom:.65rem;">
    <div style="display:flex;justify-content:space-between;gap:.7rem;align-items:flex-start;">
      <div style="min-width:0;">
        <div style="font-size:.88rem;font-family:sans-serif;color:var(--brown);font-weight:600;">${_esc(task.title)}</div>
        <div style="font-size:.7rem;font-family:sans-serif;color:var(--tm);margin-top:.15rem;">${_esc(labels.module)} · ${_esc(labels.form)}</div>
      </div>
      <span style="font-size:.66rem;font-family:sans-serif;padding:.25rem .55rem;border-radius:999px;white-space:nowrap;${dueTone}">
        ${task.status === 'pending' ? 'Pendiente' : 'Completada'}
      </span>
    </div>
    ${task.description ? `<div style="font-size:.8rem;font-family:sans-serif;color:var(--brown);line-height:1.5;margin-top:.55rem;">${_esc(task.description)}</div>` : ''}
    <div style="font-size:.68rem;font-family:sans-serif;color:var(--tm);line-height:1.55;margin-top:.55rem;">${meta.map(_esc).join(' · ')}</div>
    ${showAction ? `<div style="display:flex;gap:.5rem;margin-top:.75rem;">
      <button class="btn-sub green" style="margin:0;flex:1;padding:.55rem .7rem;font-size:.78rem;" onclick="openTaskFromList(${idx})">Completar tarea</button>
    </div>` : ''}
    ${showManage ? `<div style="display:flex;gap:.5rem;margin-top:.75rem;">
      ${task.status === 'pending' ? `<button class="btn-sub" style="margin:0;flex:1;padding:.55rem .7rem;font-size:.78rem;" onclick="openTaskEditForm(${idx})">Editar</button>` : ''}
      <button class="btn-sub" style="margin:0;${task.status === 'pending' ? 'flex:1;' : 'width:100%;'}padding:.55rem .7rem;font-size:.78rem;background:white;color:#b23a2c;border:1px solid rgba(178,58,44,.3);" onclick="deleteAssignedTask(${idx})">Eliminar</button>
    </div>` : ''}
  </div>`;
}

function _taskPanelShell(title, subtitle, innerHtml) {
  const panel = document.getElementById('home-task-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div style="width:min(760px,92%);margin:0 auto 2rem;">
      <div style="background:white;border:1px solid rgba(84,66,54,.12);border-radius:14px;padding:1rem 1.05rem;">
        <div style="font-size:.72rem;font-family:sans-serif;color:var(--tm);text-transform:uppercase;letter-spacing:.08em;">${title}</div>
        <div style="font-size:.9rem;font-family:sans-serif;color:var(--brown);margin-top:.25rem;margin-bottom:.8rem;">${subtitle}</div>
        ${innerHtml}
      </div>
    </div>`;
}

async function _loadTaskRows(status, scope = null) {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (scope) qs.set('scope', scope);
  return _api(`/api/tasks?${qs.toString()}`);
}

export async function renderHomeTasks() {
  const panel = document.getElementById('home-task-panel');
  if (!panel || !state.currentUser) return;
  _taskPanelShell('Tareas', 'Cargando tareas asignadas...', `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Cargando...</div>`);

  try {
    if (_isAdmin()) {
      const [pending, completed] = await Promise.all([
        _loadTaskRows('pending', 'all'),
        _loadTaskRows('completed', 'all'),
      ]);
      _homePendingRows = pending;
      _homeCompletedRows = completed;
      const preview = pending.slice(0, 3).map((task, idx) => _taskCard(task, idx, { showAssignee: true })).join('')
        || `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">No hay tareas pendientes.</div>`;
      _taskPanelShell(
        'Centro de tareas',
        `${pending.length} pendiente(s) · ${completed.length} completada(s)`,
        `${preview}
         <div style="display:flex;gap:.55rem;margin-top:.75rem;">
           <button class="btn-sub green" style="margin:0;flex:1;padding:.6rem .75rem;font-size:.8rem;" onclick="openTaskCreateForm()">Asignar tarea</button>
           <button class="btn-sub" style="margin:0;flex:1;padding:.6rem .75rem;font-size:.8rem;" onclick="openTaskCenter('pending')">Ver tablero</button>
         </div>`,
      );
      return;
    }

    const pending = await _loadTaskRows('pending', 'mine');
    _homePendingRows = pending;
    _taskRows = pending;
    const preview = pending.slice(0, 4).map((task, idx) => _taskCard(task, idx, { showAction: true })).join('')
      || `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">No tenés tareas pendientes asignadas.</div>`;
    _taskPanelShell(
      'Mis tareas pendientes',
      pending.length ? `Tenés ${pending.length} tarea(s) pendiente(s)` : 'No hay tareas por completar',
      `${preview}
       ${pending.length ? `<button class="btn-sub" style="margin-top:.7rem;padding:.6rem .75rem;font-size:.8rem;width:100%;" onclick="openTaskCenter('pending')">Ver todas mis tareas</button>` : ''}`,
    );
  } catch (e) {
    _taskPanelShell('Tareas', 'No se pudieron cargar las tareas', `<div style="font-size:.78rem;font-family:sans-serif;color:#c0392b;">${_esc(e.message)}</div>`);
  }
}

function _taskCenterHeader(status) {
  const isAdmin = _isAdmin();
  const viewLabel = status === 'completed' ? 'Completadas' : 'Pendientes';
  return `
    <div style="display:flex;gap:.55rem;flex-wrap:wrap;margin-bottom:1rem;">
      <button class="btn-sub ${status === 'pending' ? 'green' : ''}" style="margin:0;padding:.55rem .8rem;font-size:.78rem;${status === 'pending' ? '' : 'background:white;color:var(--brown);border:1px solid rgba(84,66,54,.18);'}" onclick="openTaskCenter('pending')">Pendientes</button>
      <button class="btn-sub ${status === 'completed' ? 'green' : ''}" style="margin:0;padding:.55rem .8rem;font-size:.78rem;${status === 'completed' ? '' : 'background:white;color:var(--brown);border:1px solid rgba(84,66,54,.18);'}" onclick="openTaskCenter('completed')">Completadas</button>
      ${isAdmin ? `<button class="btn-sub" style="margin:0;padding:.55rem .8rem;font-size:.78rem;" onclick="openTaskCreateForm()">Asignar nueva tarea</button>` : ''}
    </div>
    <div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);margin-bottom:.85rem;">${isAdmin ? `Tareas ${viewLabel.toLowerCase()} de todo el equipo.` : `Tus tareas ${viewLabel.toLowerCase()}.`}</div>`;
}

export async function openTaskCenter(status = 'pending') {
  const scope = _isAdmin() ? 'all' : 'mine';
  document.getElementById('con-title').textContent = _isAdmin() ? 'Centro de Tareas' : 'Mis Tareas';
  document.getElementById('con-back').onclick = () => show('home');
  document.getElementById('conbody').innerHTML = `<div style="font-size:.8rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Cargando tareas...</div>`;
  show('con-screen');

  try {
    const rows = await _loadTaskRows(status, scope);
    _taskRows = rows;
    const listHtml = rows.length
      ? rows.map((task, idx) => _taskCard(task, idx, {
          showAssignee: _isAdmin(),
          showAssignedBy: false,
          showAction: !_isAdmin() && task.status === 'pending',
          showManage: _isAdmin(),
        })).join('')
      : `<div style="font-size:.8rem;font-family:sans-serif;color:var(--tm);font-style:italic;">No hay tareas en esta vista.</div>`;
    document.getElementById('conbody').innerHTML = `${_taskCenterHeader(status)}${listHtml}`;
  } catch (e) {
    document.getElementById('conbody').innerHTML = `<div style="font-size:.82rem;font-family:sans-serif;color:#c0392b;">${_esc(e.message)}</div>`;
  }
}

function _moduleOptions() {
  return `<option value="">— Módulo —</option>${Object.entries(TASK_TARGETS)
    .map(([key, mod]) => `<option value="${key}">${mod.label}</option>`).join('')}`;
}

function _formOptions(moduleKey) {
  const forms = TASK_TARGETS[moduleKey]?.forms || {};
  return `<option value="">— Formulario —</option>${Object.entries(forms)
    .map(([key, form]) => `<option value="${key}">${form.label}</option>`).join('')}`;
}

async function _loadAssignableUsers() {
  const rows = await _api('/api/users');
  return (rows || []).filter(u => u.role !== 'admin');
}

export async function openTaskCreateForm() {
  if (!_isAdmin()) return;
  document.getElementById('con-title').textContent = 'Asignar Tarea';
  document.getElementById('con-back').onclick = () => openTaskCenter('pending');
  document.getElementById('conbody').innerHTML = `<div style="font-size:.8rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Cargando formulario...</div>`;
  show('con-screen');

  try {
    const users = await _loadAssignableUsers();
    const userOpts = users
      .map(u => `<label style="display:flex;align-items:flex-start;gap:.55rem;padding:.55rem .1rem;border-bottom:1px solid rgba(84,66,54,.09);font-size:.84rem;font-family:sans-serif;color:var(--brown);cursor:pointer;"><input type="checkbox" name="task-assigned-to" value="${u.id}" style="margin-top:.16rem;"> <span>${_esc(u.full_name || u.email)}${u.profile_departments?.length ? ` <span style="color:var(--tm);">· ${_esc(u.profile_departments.map(d => d.department).join(', '))}</span>` : ''}</span></label>`)
      .join('');
    const today = new Date().toISOString().slice(0, 10);

    document.getElementById('conbody').innerHTML = `
      <div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);margin-bottom:1rem;">Asigná una tarea a una o más personas no-admin. Cada persona completa su propia tarea y, si es recurrente, recibe su siguiente instancia al completarla.</div>
      <div class="fg"><label>Título</label><input type="text" id="task-title" placeholder="Ej: Revisar camas de Huerta norte"></div>
      <div class="fg"><label>Descripción</label><textarea id="task-description" placeholder="Detalle adicional para la persona responsable..." style="width:100%;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;padding:.7rem .85rem;font-size:.9rem;font-family:sans-serif;color:var(--brown);outline:none;resize:none;height:88px;line-height:1.5;"></textarea></div>
      <div class="fg"><label>Asignada a</label><div style="max-height:13rem;overflow:auto;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;padding:0 .7rem;">${userOpts || '<div style="padding:.7rem 0;font-size:.8rem;font-family:sans-serif;color:var(--tm);">No hay colaboradores no-admin disponibles.</div>'}</div><div style="font-size:.7rem;font-family:sans-serif;color:var(--tm);margin-top:.3rem;">Seleccioná una o más personas.</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="fg"><label>Módulo</label><select id="task-module" onchange="window._taskModuleChanged()">${_moduleOptions()}</select></div>
        <div class="fg"><label>Formulario a completar</label><select id="task-form"><option value="">— Elegí el módulo primero —</option></select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="fg"><label>Fecha límite</label><input type="date" id="task-due-date" value="${today}"></div>
        <div class="fg"><label>Recurrencia</label>
          <select id="task-recurrence">
            <option value="none">Una sola vez</option>
            <option value="weekly">Cada semana</option>
            <option value="biweekly">Cada dos semanas</option>
            <option value="monthly">Cada mes</option>
          </select>
        </div>
      </div>
      <button class="btn-sub green" id="task-save-btn" onclick="submitTaskCreate()">Guardar tarea</button>
      <div id="task-create-ok" class="ok-msg">
        <p id="task-create-ok-txt">✅ Tarea asignada correctamente.</p>
        <button class="btn-sub" style="margin-top:.7rem;" onclick="openTaskCenter('pending')">Volver al tablero</button>
      </div>
      <div id="task-create-err" style="display:none;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.3);border-radius:10px;padding:1rem;text-align:center;margin-top:.9rem;">
        <p style="font-size:.82rem;font-family:sans-serif;color:#c0392b;" id="task-create-err-txt"></p>
      </div>`;
  } catch (e) {
    document.getElementById('conbody').innerHTML = `<div style="font-size:.82rem;font-family:sans-serif;color:#c0392b;">${_esc(e.message)}</div>`;
  }
}

export async function submitTaskCreate() {
  const btn = document.getElementById('task-save-btn');
  const errEl = document.getElementById('task-create-err');
  const errTxt = document.getElementById('task-create-err-txt');
  const okEl = document.getElementById('task-create-ok');
  const okTxt = document.getElementById('task-create-ok-txt');

  btn.disabled = true;
  btn.textContent = 'Guardando...';
  errEl.style.display = 'none';
  okEl.style.display = 'none';

  try {
    const title = document.getElementById('task-title')?.value?.trim();
    const description = document.getElementById('task-description')?.value?.trim() || null;
    const assigned_to = [...document.querySelectorAll('input[name="task-assigned-to"]:checked')].map(input => input.value);
    const module_key = document.getElementById('task-module')?.value;
    const form_key = document.getElementById('task-form')?.value;
    const due_date = document.getElementById('task-due-date')?.value;
    const recurrence = document.getElementById('task-recurrence')?.value || 'none';

    if (!title) throw new Error('Ingresá un título para la tarea.');
    if (!assigned_to.length) throw new Error('Seleccioná al menos una persona para la tarea.');
    if (!module_key || !form_key) throw new Error('Seleccioná módulo y formulario.');
    if (!due_date) throw new Error('Ingresá la fecha límite.');

    const created = await _api('/api/tasks', 'POST', {
      title,
      description,
      assigned_to,
      module_key,
      form_key,
      due_date,
      recurrence,
    });

    const count = Array.isArray(created) ? created.length : 1;
    okTxt.textContent = count === 1
      ? `✅ Tarea asignada correctamente para ${created[0]?.assigned_to_name || 'el colaborador'}.`
      : `✅ Tarea asignada correctamente para ${count} colaboradores.`;
    okEl.style.display = 'block';
    btn.textContent = 'Guardado ✓';
    renderHomeTasks().catch(() => {});
  } catch (e) {
    errTxt.textContent = e.message;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Guardar tarea';
  }
}

export async function openTaskEditForm(idx) {
  if (!_isAdmin()) return;
  const task = _taskRows[idx];
  if (!task || task.status !== 'pending') return;

  document.getElementById('con-title').textContent = 'Editar Tarea';
  document.getElementById('con-back').onclick = () => openTaskCenter('pending');
  document.getElementById('conbody').innerHTML = `<div style="font-size:.8rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Cargando formulario...</div>`;
  show('con-screen');

  try {
    const users = await _loadAssignableUsers();
    const userOpts = `<option value="">— Colaborador —</option>${users.map(u =>
      `<option value="${u.id}" ${u.id === task.assigned_to ? 'selected' : ''}>${_esc(u.full_name || u.email)}</option>`).join('')}`;
    document.getElementById('conbody').innerHTML = `
      <div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);margin-bottom:1rem;">Los cambios aplican solo a esta tarea de ${_esc(task.assigned_to_name || 'la persona asignada')}.</div>
      <div class="fg"><label>Título</label><input type="text" id="task-edit-title" value="${_esc(task.title)}"></div>
      <div class="fg"><label>Descripción</label><textarea id="task-edit-description" style="width:100%;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;padding:.7rem .85rem;font-size:.9rem;font-family:sans-serif;color:var(--brown);outline:none;resize:none;height:88px;line-height:1.5;">${_esc(task.description || '')}</textarea></div>
      <div class="fg"><label>Asignada a</label><select id="task-edit-assigned-to">${userOpts}</select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="fg"><label>Módulo</label><select id="task-edit-module" onchange="window._taskEditModuleChanged()">${_moduleOptions()}</select></div>
        <div class="fg"><label>Formulario a completar</label><select id="task-edit-form"></select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="fg"><label>Fecha límite</label><input type="date" id="task-edit-due-date" value="${_esc(task.due_date)}"></div>
        <div class="fg"><label>Recurrencia</label><select id="task-edit-recurrence">${Object.entries(RECURRENCE_LABELS).map(([key, label]) => `<option value="${key}" ${key === task.recurrence ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      </div>
      <button class="btn-sub green" id="task-edit-save-btn" onclick="submitTaskEdit('${task.id}')">Guardar cambios</button>
      <div id="task-edit-err" style="display:none;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.3);border-radius:10px;padding:1rem;text-align:center;margin-top:.9rem;"><p style="font-size:.82rem;font-family:sans-serif;color:#c0392b;" id="task-edit-err-txt"></p></div>`;
    document.getElementById('task-edit-module').value = task.module_key;
    document.getElementById('task-edit-form').innerHTML = _formOptions(task.module_key);
    document.getElementById('task-edit-form').value = task.form_key;
  } catch (e) {
    document.getElementById('conbody').innerHTML = `<div style="font-size:.82rem;font-family:sans-serif;color:#c0392b;">${_esc(e.message)}</div>`;
  }
}

export async function submitTaskEdit(taskId) {
  const btn = document.getElementById('task-edit-save-btn');
  const errEl = document.getElementById('task-edit-err');
  const errTxt = document.getElementById('task-edit-err-txt');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  errEl.style.display = 'none';

  try {
    const body = {
      title: document.getElementById('task-edit-title')?.value?.trim(),
      description: document.getElementById('task-edit-description')?.value?.trim() || null,
      assigned_to: document.getElementById('task-edit-assigned-to')?.value,
      module_key: document.getElementById('task-edit-module')?.value,
      form_key: document.getElementById('task-edit-form')?.value,
      due_date: document.getElementById('task-edit-due-date')?.value,
      recurrence: document.getElementById('task-edit-recurrence')?.value || 'none',
    };
    if (!body.title || !body.assigned_to || !body.module_key || !body.form_key || !body.due_date) {
      throw new Error('Completá todos los campos obligatorios.');
    }
    await _api(`/api/tasks/${taskId}`, 'PATCH', body);
    renderHomeTasks().catch(() => {});
    openTaskCenter('pending');
  } catch (e) {
    errTxt.textContent = e.message;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  }
}

export async function deleteAssignedTask(idx) {
  if (!_isAdmin()) return;
  const task = _taskRows[idx];
  if (!task || !window.confirm(`¿Eliminar la tarea "${task.title}"? Esta acción no se puede deshacer.`)) return;
  try {
    await _api(`/api/tasks/${task.id}`, 'DELETE');
    renderHomeTasks().catch(() => {});
    openTaskCenter(task.status === 'completed' ? 'completed' : 'pending');
  } catch (e) {
    window.alert(`No se pudo eliminar la tarea: ${e.message}`);
  }
}

export function openTaskFromList(idx) {
  const task = _taskRows[idx] || _homePendingRows[idx];
  if (!task) return;
  openAssignedTask(task);
}

export function openAssignedTask(task) {
  state.activeTaskAssignment = task;

  if (task.module_key === 'alimentos') {
    window.openFoodForm(task.form_key, null, task);
    return;
  }
  if (task.module_key === 'biofabrica') {
    if (task.form_key === 'cerrar-lote') {
      window.openBioBatchPicker(task);
    } else {
      window.openBioForm(task.form_key, null, task);
    }
    return;
  }
  if (task.module_key === 'vivero') {
    window.openNurseryForm(task.form_key, null, task);
  }
}

export function setActiveTaskAssignment(task = null) {
  state.activeTaskAssignment = task || null;
}

export function renderActiveTaskBanner(moduleKey, formKey, record = null) {
  const task = state.activeTaskAssignment;
  if (!task || record) return '';
  if (task.module_key !== moduleKey || task.form_key !== formKey) return '';
  return `<div class="doc-note" style="margin-bottom:1rem;background:rgba(153,92,68,.08);border:1px solid rgba(153,92,68,.18);padding:.75rem .85rem;border-radius:10px;">
    <strong>Tarea asignada:</strong> ${_esc(task.title)}<br>
    <span style="font-size:.74rem;color:var(--tm);">Vence: ${_esc(_fmtDate(task.due_date))}${task.description ? ` · ${_esc(task.description)}` : ''}</span>
  </div>`;
}

export function extractRecordId(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return extractRecordId(payload[0]);
  if (payload.id) return payload.id;
  if (payload.batch?.id) return payload.batch.id;
  if (payload.lot?.id) return payload.lot.id;
  return null;
}

export async function completeActiveTaskAssignment({ moduleKey, formKey, recordId }) {
  const task = state.activeTaskAssignment;
  if (!task || !recordId) return { completed: false };
  if (task.module_key !== moduleKey || task.form_key !== formKey) return { completed: false };

  try {
    const res = await _api(`/api/tasks/${task.id}/complete`, 'PATCH', { completed_record_id: recordId });
    state.activeTaskAssignment = null;
    renderHomeTasks().catch(() => {});
    return { completed: true, nextTask: res.next_task || null };
  } catch (e) {
    return { completed: false, error: e.message };
  }
}

export function describeTaskCompletion(result) {
  if (!result?.completed) {
    return result?.error ? `La tarea no se pudo marcar como completada automáticamente: ${result.error}` : '';
  }
  if (result.nextTask?.due_date) {
    return `La tarea asignada quedó completada y la próxima recurrencia se programó para ${_fmtDate(result.nextTask.due_date)}.`;
  }
  return 'La tarea asignada quedó marcada como completada.';
}

window._taskModuleChanged = () => {
  const moduleKey = document.getElementById('task-module')?.value;
  const formSel = document.getElementById('task-form');
  if (formSel) formSel.innerHTML = _formOptions(moduleKey);
};

window._taskEditModuleChanged = () => {
  const moduleKey = document.getElementById('task-edit-module')?.value;
  const formSel = document.getElementById('task-edit-form');
  if (formSel) formSel.innerHTML = _formOptions(moduleKey);
};
