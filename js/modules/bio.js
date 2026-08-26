import { state } from './state.js';
import { show } from './navigation.js';
import { photoUploadWidget, uploadPhotoGroup, clearPhotoGroup } from './photos.js';
import { stopRec } from './audio.js';
import { completeActiveTaskAssignment, describeTaskCompletion, extractRecordId, renderActiveTaskBanner, setActiveTaskAssignment } from './tasks.js';

const API = 'https://tierramor-api.jabdelnour95.workers.dev';

// ─── MODULE STATE ──────────────────────────────────────────────────────────

let _cats    = null;  // { rawMaterials, finishedProducts, workers }
let _batches = null;  // cached GET /api/bio/batches response

let _batchInputRows     = [];  // raw materials consumed rows (abrir-lote)
let _activeForm         = null;
let _closingBatch       = null;  // batch object selected in the close picker
let _finishedStockCache = null;  // v_bio_finished_product_stock rows, refreshed each time salida opens
let _editing            = null;  // registro completo en edición (admin), null si es carga nueva

// ─── API ───────────────────────────────────────────────────────────────────

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

// ─── CATALOGS ──────────────────────────────────────────────────────────────

async function _loadCats() {
  if (_cats) return _cats;
  const [rawMaterials, finishedProducts, workers] = await Promise.all([
    _api('/api/catalogs/bio-raw-materials'),
    _api('/api/catalogs/bio-finished-products'),
    _api('/api/farm-workers').catch(() => []),
  ]);
  _cats = { rawMaterials, finishedProducts, workers };
  return _cats;
}

function _active(arr) {
  return (arr || []).filter(i => i.active !== false);
}

function _opts(arr, label = 'name', val = 'id') {
  return _active(arr).map(i => `<option value="${i[val]}">${i[label]}</option>`).join('');
}

const _isAdmin = () => state.currentUser?.profile?.role === 'admin';

const _rawOpts = () => `<option value="">— Materia prima —</option>${_opts(_cats?.rawMaterials || [])}
  ${_isAdmin() ? '<option value="__new__">── Nueva materia prima ──</option>' : ''}`;
const _finishedOpts = () => `<option value="">— Producto —</option>${_opts(_cats?.finishedProducts || [])}`;

// Sólo trabajadores con cuenta real (profile_id) pueden quedar como performed_by/responsible_id
function _workersWithLogin() {
  return (_cats?.workers || []).filter(w => w.profile_id);
}

function _performedByOpts() {
  const userId   = state.currentUser?.id;
  const userName = state.currentUser?.profile?.full_name || 'Yo';
  const workers  = _workersWithLogin();
  const hasUser  = workers.some(w => w.profile_id === userId);
  const extra    = (!hasUser && userId) ? `<option value="${userId}">${userName} (yo)</option>` : '';
  const opts     = workers.map(w => `<option value="${w.profile_id}">${w.name}</option>`).join('');
  return `<option value="">— Responsable —</option>${extra}${opts}`;
}

function _selectPerformedByDefault(selId) {
  const sel = document.getElementById(selId);
  if (sel && state.currentUser?.id) sel.value = state.currentUser.id;
}

// ─── AUDIO WIDGET (idéntico a food.js) ─────────────────────────────────────

function _aw(id, ph) {
  return `<div class="aw">
    <textarea id="ta-${id}" placeholder="${ph}"
      style="width:100%;border:none;border-bottom:1px solid rgba(84,66,54,.1);padding:.7rem .85rem;
             font-size:.88rem;font-family:sans-serif;color:var(--brown);outline:none;
             resize:none;height:72px;line-height:1.5;display:block;background:white;"></textarea>
    <div class="actl">
      <button class="bmk" id="mic-${id}" onclick="toggleMic('${id}')">🎙</button>
      <span class="mst" id="ms-${id}">Toca para dictar</span>
      <button class="bclr" onclick="document.getElementById('ta-${id}').value=''">Limpiar</button>
    </div>
  </div>`;
}

function _obsValue() {
  return document.getElementById('ta-obs')?.value?.trim() || null;
}

async function _finalizeBioTask(formKey, recordId, successBaseText = null) {
  const okTxt = document.getElementById('bio-ok-txt');
  if (okTxt && successBaseText) okTxt.textContent = successBaseText;
  const taskResult = await completeActiveTaskAssignment({
    moduleKey: 'biofabrica',
    formKey,
    recordId,
  });
  const taskMsg = describeTaskCompletion(taskResult);
  if (okTxt && taskMsg) okTxt.textContent = `${okTxt.textContent} ${taskMsg}`;
}

// ─── BATCH INPUT ROWS (materias primas consumidas en abrir-lote) ──────────

export function addBatchInputRow() {
  _batchInputRows.push({ raw_material_id: '', quantity: '' });
  _renderBatchInputRows();
}

export function removeBatchInputRow(idx) {
  _batchInputRows.splice(idx, 1);
  _renderBatchInputRows();
}

function _renderBatchInputRows() {
  const el = document.getElementById('batch-input-rows');
  if (!el) return;
  if (!_batchInputRows.length) {
    el.innerHTML = `<div style="font-size:.75rem;font-family:sans-serif;color:var(--tm);font-style:italic;padding:.2rem 0;">Sin materias primas agregadas.</div>`;
    return;
  }
  el.innerHTML = _batchInputRows.map((row, i) => `
    <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.5rem;">
      <select style="flex:1;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                     padding:.6rem .65rem;font-size:.82rem;font-family:sans-serif;color:var(--brown);outline:none;"
              id="bi-mat-${i}" onchange="window._bic(${i},'raw_material_id',this.value); window._bioRawUnit(${i})">${_rawOpts()}</select>
      <input type="number" step="0.001" min="0" placeholder="Cant."
             style="width:90px;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                    padding:.6rem .5rem;font-size:.82rem;font-family:sans-serif;color:var(--brown);
                    outline:none;text-align:center;"
             id="bi-qty-${i}" value="${row.quantity}" oninput="window._bic(${i},'quantity',this.value)">
      <span id="bi-unit-${i}" style="width:34px;flex-shrink:0;font-size:.74rem;font-family:sans-serif;color:var(--tm);text-align:center;"></span>
      <button onclick="removeBatchInputRow(${i})"
              style="background:none;border:none;color:var(--clay);font-size:1.25rem;cursor:pointer;padding:.05rem .3rem;line-height:1;flex-shrink:0;">×</button>
    </div>`).join('');
  _batchInputRows.forEach((row, i) => {
    const s = document.getElementById(`bi-mat-${i}`);
    if (s && row.raw_material_id) { s.value = row.raw_material_id; window._bioRawUnit(i); }
  });
}

// ─── BIO SCREEN (gallery) ──────────────────────────────────────────────────

export async function openBio() {
  show('bio-screen');
  _loadCats()
    .then(() => Promise.all([_loadLowStockBanner(), _loadRecentBatches()]))
    .catch(() => {
      const el = document.getElementById('bio-recent-body');
      if (el) el.innerHTML = `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Sin conexión al servidor.</div>`;
    });
}

async function _loadLowStockBanner() {
  const el = document.getElementById('bio-low-stock');
  if (!el) return;
  try {
    const stock = await _api('/api/inventory/bio-raw');
    const low = (stock || []).filter(s => s.below_minimum);
    if (!low.length) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = `⚠ Stock bajo mínimo: ${low.map(s => s.name).join(', ')}`;
  } catch {
    el.style.display = 'none';
  }
}

async function _loadRecentBatches() {
  const el = document.getElementById('bio-recent-body');
  if (!el) return;
  try {
    const batches = await _api('/api/bio/batches');
    _batches = batches;
    if (!batches.length) {
      el.innerHTML = `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;padding:.3rem 0;">No hay lotes registrados aún.</div>`;
      return;
    }
    el.innerHTML = batches.slice(0, 5).map(b => {
      const product = (_cats?.finishedProducts || []).find(p => p.id === b.finished_product_id);
      const isOpen = b.status === 'in_progress';
      return `<div style="background:white;border:1px solid rgba(84,66,54,.1);border-radius:10px;
                           padding:.7rem .9rem;margin-bottom:.5rem;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:.87rem;font-family:sans-serif;color:var(--brown);font-weight:500;">${b.batch_code}</div>
          <div style="font-size:.67rem;font-family:sans-serif;color:var(--tm);margin-top:.1rem;">${product?.name || '—'} · ${b.date_start}</div>
        </div>
        <span style="font-size:.66rem;font-family:sans-serif;padding:.25rem .55rem;border-radius:6px;flex-shrink:0;margin-left:.6rem;
                     background:${isOpen ? 'rgba(153,92,68,.12)' : 'rgba(118,114,78,.12)'};color:${isOpen ? 'var(--clay)' : 'var(--green)'};">
          ${isOpen ? 'En proceso' : 'Cerrado'}
        </span>
      </div>`;
    }).join('');
  } catch {
    el.innerHTML = `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Sin datos disponibles.</div>`;
  }
}

// ─── INVENTORY VIEWS (solo lectura) ────────────────────────────────────────

export async function openBioInventory(kind) {
  document.getElementById('ft').textContent = kind === 'raw' ? 'Inventario de Materias Primas' : 'Inventario de Producto Terminado';
  document.getElementById('fs-back').onclick = () => { stopRec(); openBio(); };
  document.getElementById('fbody').innerHTML = `<div id="bio-inv-body" style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Cargando...</div>`;
  show('fs');

  try {
    const rows = await _api(kind === 'raw' ? '/api/inventory/bio-raw' : '/api/inventory/bio-finished');
    const el = document.getElementById('bio-inv-body');
    if (!rows.length) {
      el.innerHTML = `<div style="font-size:.82rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Sin datos.</div>`;
      return;
    }
    const sorted = kind === 'raw'
      ? [...rows].sort((a, b) => (b.below_minimum - a.below_minimum) || a.name.localeCompare(b.name))
      : [...rows].sort((a, b) => a.name.localeCompare(b.name));

    el.innerHTML = sorted.map(r => {
      const flagged = kind === 'raw' && r.below_minimum;
      const sub = kind === 'raw'
        ? `Mínimo: ${r.min_stock} ${r.unit}`
        : `Producido: ${r.total_produced} · Salidas: ${r.total_out}`;
      return `<div style="background:white;border:1px solid ${flagged ? 'rgba(192,57,43,.35)' : 'rgba(84,66,54,.1)'};
                          border-radius:10px;padding:.75rem .9rem;margin-bottom:.55rem;
                          display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:.88rem;font-family:sans-serif;color:var(--brown);font-weight:500;">
            ${r.name}${flagged ? ' <span style="color:#c0392b;font-size:.7rem;">⚠ Bajo mínimo</span>' : ''}
          </div>
          <div style="font-size:.67rem;font-family:sans-serif;color:var(--tm);margin-top:.1rem;">${sub}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:.8rem;">
          <div style="font-size:.92rem;font-family:sans-serif;color:${flagged ? '#c0392b' : 'var(--clay)'};font-weight:500;">${r.current_stock}</div>
          <div style="font-size:.62rem;font-family:sans-serif;color:var(--tm);">${r.unit}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    document.getElementById('bio-inv-body').innerHTML =
      `<div style="font-size:.82rem;font-family:sans-serif;color:#c0392b;">${e.message}</div>`;
  }
}

// ─── FORM DEFINITIONS ──────────────────────────────────────────────────────

const FORMS = {

  entrada: {
    title: 'Registrar Entrada de Materia Prima',
    build: () => `
      <div class="fg"><label>Fecha</label><input type="date" id="f-fecha"></div>
      <div class="fg">
        <label>Materia prima</label>
        <select id="f-raw" onchange="window._bioRawEntradaUnit(); window._bioNewRawToggle()">${_rawOpts()}</select>
        <div id="new-raw-form" style="display:none;margin-top:.55rem;background:rgba(153,92,68,.05);
             border:1px dashed rgba(153,92,68,.3);border-radius:8px;padding:.75rem;">
          <div style="font-size:.68rem;font-family:sans-serif;color:var(--tm);text-transform:uppercase;
                      letter-spacing:.07em;margin-bottom:.5rem;">Nueva materia prima</div>
          <input type="text" id="nr-name" placeholder="Nombre *"
                 style="width:100%;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                        padding:.6rem .75rem;font-size:.85rem;font-family:sans-serif;color:var(--brown);
                        outline:none;margin-bottom:.4rem;">
          <div style="display:flex;gap:.5rem;margin-bottom:.4rem;">
            <input type="text" id="nr-unit" placeholder="Unidad (ej: kg, L) *"
                   style="flex:1;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                          padding:.6rem .7rem;font-size:.85rem;font-family:sans-serif;color:var(--brown);outline:none;">
            <input type="number" id="nr-min" step="0.01" min="0" placeholder="Stock mínimo"
                   style="width:120px;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                          padding:.6rem .65rem;font-size:.85rem;font-family:sans-serif;color:var(--brown);outline:none;">
          </div>
          <select id="nr-type" style="width:100%;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                          padding:.6rem .7rem;font-size:.85rem;font-family:sans-serif;color:var(--brown);outline:none;">
            <option value="purchased">Comprada</option>
            <option value="farm_input">Insumo de finca</option>
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="fg"><label>Cantidad</label><input type="number" step="0.001" min="0" id="f-qty"></div>
        <div class="fg"><label>Unidad</label><input type="text" id="f-unit" readonly style="background:rgba(84,66,54,.05);"></div>
      </div>
      <div class="fg">
        <label>Tipo</label>
        <select id="f-type" onchange="window._bioEntradaTypeChanged()">
          <option value="purchased">Comprada</option>
          <option value="farm_input">Insumo de finca</option>
          <option value="organic_waste">Residuo orgánico (Cocina/Restaurantes)</option>
        </select>
      </div>
      <div id="entrada-purchase-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="fg"><label>Proveedor</label><input type="text" id="f-supplier"></div>
        <div class="fg"><label>Costo (₡)</label><input type="number" step="0.01" min="0" id="f-cost"></div>
      </div>
      <div class="fg"><label>Responsable</label><select id="f-performed">${_performedByOpts()}</select></div>
      <div class="fg"><label>Observaciones</label>${_aw('obs', 'Observaciones o dicta nota de voz...')}</div>
      ${photoUploadWidget('bio-photos')}`,
    afterRender: () => {
      _selectPerformedByDefault('f-performed');
    },
  },

  'abrir-lote': {
    title: 'Abrir Lote de Producción',
    build: () => `
      <div class="fg"><label>Fecha de inicio</label><input type="date" id="f-fecha"></div>
      <div class="fg"><label>Producto a producir</label><select id="f-product">${_finishedOpts()}</select></div>
      <div class="fg"><label>Fecha estimada de finalización</label><input type="date" id="f-est-finish"></div>
      <div class="fg"><label>Responsable del lote</label><select id="f-responsible-sel">${_performedByOpts()}</select></div>
      <div class="fg">
        <label>Materias primas consumidas</label>
        <div class="doc-note">El stock no se descuenta al abrir el lote — se descuenta al cerrarlo.</div>
        <div id="batch-input-rows" style="margin-top:.4rem;"></div>
        <button type="button" onclick="addBatchInputRow()" class="add-row-btn">+ Agregar materia prima</button>
      </div>
      ${_editing?.status === 'closed' ? `
        <div class="doc-note" style="margin-top:.3rem;">Este lote ya está cerrado — también podés corregir los datos de cierre.</div>
        <div class="fg"><label>Fecha real de finalización</label><input type="date" id="f-fecha-finish"></div>
        <div class="fg"><label>Cantidad de producto terminado obtenida</label><input type="number" step="0.001" min="0" id="f-qty-produced"></div>
        <div class="fg"><label>Observaciones de cierre</label>${_aw('closure-obs', 'Observaciones de cierre...')}</div>
      ` : ''}`,
    afterRender: () => {
      _selectPerformedByDefault('f-responsible-sel');
      if (!_editing) addBatchInputRow();
    },
  },

  salida: {
    title: 'Registrar Salida',
    build: () => `
      <div class="fg"><label>Fecha</label><input type="date" id="f-fecha"></div>
      <div class="fg">
        <label>Producto terminado</label>
        <select id="f-product" onchange="window._bioSalidaProductChanged()">${_finishedOpts()}</select>
        <div id="f-product-stock" style="display:none;font-size:.72rem;font-family:sans-serif;color:var(--tm);margin-top:.35rem;"></div>
      </div>
      <div class="fg"><label>Cantidad</label><input type="number" step="0.001" min="0" id="f-qty"></div>
      <div class="fg">
        <label>Tipo de salida</label>
        <select id="f-output-type" onchange="window._bioSalidaTypeChanged()">
          <option value="internal">Uso interno</option>
          <option value="external_sale">Venta externa</option>
        </select>
      </div>
      <div id="salida-internal-fields" class="fg">
        <label>Departamento</label>
        <select id="f-department">
          <option value="">— Seleccionar —</option>
          <option value="food_production">Producción de Alimentos</option>
          <option value="nursery">Vivero</option>
          <option value="landscaping">Paisajismo</option>
        </select>
      </div>
      <div id="salida-external-fields" style="display:none;">
        <div class="fg"><label>Cliente</label><input type="text" id="f-client"></div>
        <div class="fg"><label>Precio unitario</label><input type="number" step="0.01" min="0" id="f-unit-price"></div>
      </div>
      <div class="fg"><label>Responsable</label><select id="f-performed">${_performedByOpts()}</select></div>
      <div class="fg"><label>Notas</label>${_aw('obs', 'Notas adicionales (opcional)...')}</div>`,
    afterRender: () => {
      _selectPerformedByDefault('f-performed');
      _finishedStockCache = null;
      _api('/api/inventory/bio-finished').then(rows => { _finishedStockCache = rows; }).catch(() => { _finishedStockCache = []; });
    },
  },
};

// ─── OPEN FORM ─────────────────────────────────────────────────────────────

export async function openBioForm(type, record = null, task = null) {
  stopRec();
  _activeForm = type;
  _editing = record || null;
  _batchInputRows = [];
  clearPhotoGroup('bio-photos');

  const def = FORMS[type];
  if (!def) return;
  setActiveTaskAssignment(!record ? task : null);

  if (!_cats) await _loadCats();

  const title = record ? `Editar: ${def.title}` : def.title;
  document.getElementById('ft').textContent = title;
  document.getElementById('fs-back').onclick = () => {
    stopRec();
    record ? window._backToRecordsList() : openBio();
  };
  const okBlock = record
    ? `<div class="ok-msg" id="bio-ok">
        <p id="bio-ok-txt">✅ Cambios guardados.</p>
        <button class="btn-sub" style="margin-top:.7rem;" onclick="window._backToRecordsList()">Volver a la lista</button>
      </div>`
    : `<div class="ok-msg" id="bio-ok">
        <p id="bio-ok-txt">✅ Guardado correctamente.</p>
        <button class="btn-sub green" style="margin-top:.7rem;" onclick="openBioForm('${type}')">Agregar otro registro</button>
      </div>`;
  document.getElementById('fbody').innerHTML = `
    ${renderActiveTaskBanner('biofabrica', type, record)}
    <h2 style="font-size:1.05rem;font-weight:normal;font-style:italic;color:var(--brown);margin-bottom:1.1rem;">${title}</h2>
    ${def.build()}
    <button class="btn-sub" id="bio-btn-sub" onclick="submitBioForm()">${record ? 'Guardar cambios' : 'Guardar registro'}</button>
    <div class="fnote">Los datos se guardan en la base de datos de Tierramor.</div>
    <div id="bio-warn" style="display:none;background:rgba(233,196,106,.18);border:1px solid rgba(201,168,76,.5);
                              border-radius:10px;padding:.9rem 1rem;margin-top:.9rem;">
      <p style="font-size:.78rem;font-family:sans-serif;color:#8a6d1f;" id="bio-warn-txt"></p>
    </div>
    ${okBlock}
    <div id="bio-err" style="display:none;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.3);
                              border-radius:10px;padding:1rem;text-align:center;margin-top:.9rem;">
      <p style="font-size:.82rem;font-family:sans-serif;color:#c0392b;" id="bio-err-txt"></p>
    </div>`;

  const dateEl = document.getElementById('f-fecha');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  if (def.afterRender) def.afterRender();
  if (record) _prefillBioForm(type, record);

  show('fs');
}

// ─── PREFILL (modo edición, admin) ─────────────────────────────────────────

function _setBioVal(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null) el.value = val;
}

function _prefillBioForm(type, record) {
  switch (type) {
    case 'entrada': {
      _setBioVal('f-fecha', record.date);
      _setBioVal('f-raw', record.raw_material_id);
      window._bioRawEntradaUnit();
      _setBioVal('f-qty', record.quantity);
      _setBioVal('f-type', record.type);
      window._bioEntradaTypeChanged();
      _setBioVal('f-supplier', record.supplier || '');
      _setBioVal('f-cost', record.cost ?? '');
      _setBioVal('f-performed', record.performed_by);
      _setBioVal('ta-obs', record.observations || '');
      break;
    }

    case 'abrir-lote': {
      _setBioVal('f-fecha', record.date_start);
      _setBioVal('f-product', record.finished_product_id);
      _setBioVal('f-est-finish', record.estimated_finish_date || '');
      _setBioVal('f-responsible-sel', record.responsible_id);
      _batchInputRows = (record.bio_production_batch_inputs || [])
        .map(i => ({ raw_material_id: i.raw_material_id, quantity: String(i.quantity) }));
      _renderBatchInputRows();
      if (record.status === 'closed') {
        _setBioVal('f-fecha-finish', record.date_finish || '');
        _setBioVal('f-qty-produced', record.quantity_produced ?? '');
        _setBioVal('ta-closure-obs', record.closure_observations || '');
      }
      break;
    }

    case 'salida': {
      _setBioVal('f-fecha', record.date);
      _setBioVal('f-product', record.finished_product_id);
      window._bioSalidaProductChanged();
      _setBioVal('f-qty', record.quantity);
      _setBioVal('f-output-type', record.output_type);
      window._bioSalidaTypeChanged();
      _setBioVal('f-department', record.department || '');
      _setBioVal('f-client', record.client_name || '');
      _setBioVal('f-unit-price', record.unit_price ?? '');
      _setBioVal('f-performed', record.performed_by);
      _setBioVal('ta-obs', record.observations || '');
      break;
    }
  }
}

// ─── CERRAR LOTE — picker + close form (dos pasos dentro de #fs) ──────────

export async function openBioBatchPicker(task = null) {
  stopRec();
  _activeForm = 'cerrar-lote';
  setActiveTaskAssignment(task);
  document.getElementById('ft').textContent = 'Cerrar Lote de Producción';
  document.getElementById('fs-back').onclick = () => { stopRec(); openBio(); };
  document.getElementById('fbody').innerHTML = `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Cargando lotes abiertos...</div>`;
  show('fs');

  try {
    await _loadCats();
    const batches = await _api('/api/bio/batches');
    _batches = batches;
    const open = batches.filter(b => b.status === 'in_progress');

    if (!open.length) {
      document.getElementById('fbody').innerHTML = `
        <div class="cs">
          <div class="csi">📭</div>
          <h3>No hay lotes abiertos</h3>
          <p>Todos los lotes de producción están cerrados.</p>
        </div>
        <button class="btn-sub" onclick="openBio()">Volver</button>`;
      return;
    }

    document.getElementById('fbody').innerHTML = `
      ${renderActiveTaskBanner('biofabrica', 'cerrar-lote')}
      <h2 style="font-size:1.05rem;font-weight:normal;font-style:italic;color:var(--brown);margin-bottom:1.1rem;">Seleccioná el lote a cerrar</h2>
      <div id="batch-picker-list"></div>`;

    document.getElementById('batch-picker-list').innerHTML = open.map((b, i) => {
      const product = (_cats?.finishedProducts || []).find(p => p.id === b.finished_product_id);
      return `<div onclick="window._bioPickBatch(${i})"
                   style="background:white;border:1px solid rgba(84,66,54,.15);border-radius:10px;
                          padding:.85rem .95rem;margin-bottom:.6rem;cursor:pointer;">
        <div style="font-size:.9rem;font-family:sans-serif;color:var(--brown);font-weight:500;">${b.batch_code}</div>
        <div style="font-size:.72rem;font-family:sans-serif;color:var(--tm);margin-top:.15rem;">
          ${product?.name || '—'} · Inicio: ${b.date_start}${b.estimated_finish_date ? ` · Est: ${b.estimated_finish_date}` : ''}
        </div>
      </div>`;
    }).join('');

    window._bioOpenBatches = open;
  } catch (e) {
    document.getElementById('fbody').innerHTML = `<div style="font-size:.82rem;font-family:sans-serif;color:#c0392b;">${e.message}</div>`;
  }
}

function _openBioCloseForm(batch) {
  _closingBatch = batch;
  const product = (_cats?.finishedProducts || []).find(p => p.id === batch.finished_product_id);

  document.getElementById('fbody').innerHTML = `
    ${renderActiveTaskBanner('biofabrica', 'cerrar-lote')}
    <h2 style="font-size:1.05rem;font-weight:normal;font-style:italic;color:var(--brown);margin-bottom:.4rem;">Cerrar Lote de Producción</h2>
    <div class="doc-note" style="margin-bottom:1rem;">
      <strong>${batch.batch_code}</strong> · ${product?.name || '—'} · Inicio: ${batch.date_start}
    </div>
    <div class="fg"><label>Fecha real de finalización</label><input type="date" id="f-fecha"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
      <div class="fg"><label>Cantidad de producto terminado obtenida</label><input type="number" step="0.001" min="0" id="f-qty"></div>
      <div class="fg"><label>Unidad</label><input type="text" id="f-qty-unit" readonly value="${product?.unit || ''}" style="background:rgba(84,66,54,.05);"></div>
    </div>
    <div class="fg"><label>Observaciones de cierre</label>${_aw('obs', 'Observaciones...')}</div>
    <button class="btn-sub" id="bio-btn-sub" onclick="submitBioForm()">Cerrar lote</button>
    <div class="fnote">Los datos se guardan en la base de datos de Tierramor.</div>
    <div id="bio-warn" style="display:none;background:rgba(233,196,106,.18);border:1px solid rgba(201,168,76,.5);
                              border-radius:10px;padding:.9rem 1rem;margin-top:.9rem;">
      <p style="font-size:.78rem;font-family:sans-serif;color:#8a6d1f;" id="bio-warn-txt"></p>
    </div>
    <div class="ok-msg" id="bio-ok">
      <p id="bio-ok-txt">✅ Lote cerrado correctamente.</p>
      <button class="btn-sub green" style="margin-top:.7rem;" onclick="openBio()">Volver a Biofábrica</button>
    </div>
    <div id="bio-err" style="display:none;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.3);
                              border-radius:10px;padding:1rem;text-align:center;margin-top:.9rem;">
      <p style="font-size:.82rem;font-family:sans-serif;color:#c0392b;" id="bio-err-txt"></p>
    </div>`;

  const dateEl = document.getElementById('f-fecha');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
}

// ─── SUBMIT ────────────────────────────────────────────────────────────────

export async function submitBioForm() {
  stopRec();
  const userId = state.currentUser?.id;
  if (!userId) return;

  const btn     = document.getElementById('bio-btn-sub');
  const errEl   = document.getElementById('bio-err');
  const errTxt  = document.getElementById('bio-err-txt');
  const okEl    = document.getElementById('bio-ok');
  const warnEl  = document.getElementById('bio-warn');
  const warnTxt = document.getElementById('bio-warn-txt');

  btn.disabled    = true;
  btn.textContent = _activeForm === 'cerrar-lote' ? 'Cerrando...' : 'Guardando...';
  errEl.style.display  = 'none';
  okEl.style.display   = 'none';
  warnEl.style.display = 'none';

  try {
    const date = document.getElementById('f-fecha')?.value;
    if (!date) throw new Error('Ingresá la fecha.');
    const obs = _obsValue();

    switch (_activeForm) {

      case 'entrada': {
        let raw_material_id = document.getElementById('f-raw')?.value;
        if (raw_material_id === '__new__') {
          const name = document.getElementById('nr-name')?.value?.trim();
          const unit0 = document.getElementById('nr-unit')?.value?.trim();
          const minStock = parseFloat(document.getElementById('nr-min')?.value) || 0;
          const type0 = document.getElementById('nr-type')?.value || 'purchased';
          if (!name || !unit0) throw new Error('Completá nombre y unidad de la nueva materia prima.');
          const newMat = await _api('/api/catalogs/bio-raw-materials', 'POST', {
            name, unit: unit0, min_stock: minStock, type: type0, active: true,
          });
          raw_material_id = newMat[0]?.id || newMat.id;
          _cats = null;
        }
        if (!raw_material_id) throw new Error('Seleccioná la materia prima.');

        const quantity = parseFloat(document.getElementById('f-qty')?.value);
        if (!quantity) throw new Error('Ingresá la cantidad.');
        const unit = document.getElementById('f-unit')?.value;
        const type = document.getElementById('f-type')?.value;
        const performed_by = document.getElementById('f-performed')?.value || userId;
        const isPurchased = type === 'purchased';
        const supplier = isPurchased ? (document.getElementById('f-supplier')?.value?.trim() || null) : null;
        const cost = isPurchased ? (parseFloat(document.getElementById('f-cost')?.value) || null) : null;

        const newPhotoUrls = await uploadPhotoGroup('bio-photos', 'biofactory', 'entrada', date);
        const receipt_photo_url = newPhotoUrls[0] || _editing?.receipt_photo_url || null;

        const entradaFields = { date, raw_material_id, quantity, unit, type, supplier, cost, observations: obs, receipt_photo_url };

        if (_editing) {
          await _api(`/api/bio/raw-material-entries/${_editing.id}`, 'PATCH', { ...entradaFields, performed_by });
        } else {
          const created = await _api('/api/bio/raw-material-entries', 'POST', {
            ...entradaFields, performed_by, created_by: userId,
          });
          await _finalizeBioTask('entrada', extractRecordId(created), '✅ Entrada registrada correctamente.');
        }
        okEl.style.display = 'block';
        btn.textContent = 'Guardado ✓';
        break;
      }

      case 'abrir-lote': {
        const finished_product_id = document.getElementById('f-product')?.value;
        if (!finished_product_id) throw new Error('Seleccioná el producto a producir.');
        const estimated_finish_date = document.getElementById('f-est-finish')?.value || null;
        const responsible_id = document.getElementById('f-responsible-sel')?.value || userId;
        const validRows = _batchInputRows.filter(r => r.raw_material_id && r.quantity);
        if (!validRows.length) throw new Error('Agregá al menos una materia prima consumida.');
        const inputs = validRows.map(r => ({ raw_material_id: r.raw_material_id, quantity: parseFloat(r.quantity) }));

        if (_editing) {
          const patchBody = { date_start: date, finished_product_id, estimated_finish_date, responsible_id, inputs };
          if (_editing.status === 'closed') {
            patchBody.date_finish = document.getElementById('f-fecha-finish')?.value || null;
            patchBody.quantity_produced = parseFloat(document.getElementById('f-qty-produced')?.value) || null;
            patchBody.closure_observations = document.getElementById('ta-closure-obs')?.value?.trim() || null;
          }
          await _api(`/api/bio/batches/${_editing.id}`, 'PATCH', patchBody);
          okEl.style.display = 'block';
          btn.textContent = 'Guardado ✓';
        } else {
          const batch = await _api('/api/bio/batches', 'POST', {
            date_start: date,
            finished_product_id,
            estimated_finish_date,
            responsible_id, created_by: userId,
            inputs,
          });
          okEl.style.display = 'block';
          await _finalizeBioTask('abrir-lote', extractRecordId(batch), `✅ Lote ${batch.batch_code} abierto correctamente.`);
          btn.textContent = 'Guardado ✓';
        }
        _batchInputRows = [];
        break;
      }

      case 'cerrar-lote': {
        if (!_closingBatch) throw new Error('No hay lote seleccionado.');
        const quantity_produced = parseFloat(document.getElementById('f-qty')?.value);
        if (!quantity_produced) throw new Error('Ingresá la cantidad de producto terminado obtenida.');

        const res = await _api(`/api/bio/batches/${_closingBatch.id}/close`, 'PATCH', {
          date_finish: date,
          quantity_produced,
          closure_observations: obs,
        });

        if (res.warning) {
          warnEl.style.display = 'block';
          warnTxt.textContent = `⚠ Stock insuficiente al momento de cerrar: ${res.items
            .map(it => `${it.name} (requerido ${it.required}, disponible ${it.available})`).join('; ')}`;
        }
        okEl.style.display = 'block';
        await _finalizeBioTask('cerrar-lote', extractRecordId(res), '✅ Lote cerrado correctamente.');
        btn.textContent = 'Lote cerrado ✓';
        _closingBatch = null;
        break;
      }

      case 'salida': {
        const finished_product_id = document.getElementById('f-product')?.value;
        if (!finished_product_id) throw new Error('Seleccioná el producto.');
        const quantity = parseFloat(document.getElementById('f-qty')?.value);
        if (!quantity) throw new Error('Ingresá la cantidad.');
        const output_type = document.getElementById('f-output-type')?.value;
        const performed_by = document.getElementById('f-performed')?.value || userId;
        const isExternal = output_type === 'external_sale';

        const department = !isExternal ? (document.getElementById('f-department')?.value || null) : null;
        const client_name = isExternal ? (document.getElementById('f-client')?.value?.trim() || null) : null;
        const unit_price = isExternal ? (parseFloat(document.getElementById('f-unit-price')?.value) || null) : null;
        if (isExternal && (!client_name || !unit_price)) throw new Error('Completá cliente y precio unitario.');
        if (!isExternal && !department) throw new Error('Seleccioná el departamento.');

        const outputFields = {
          date, finished_product_id, quantity, output_type,
          department, client_name, unit_price,
          total_value: isExternal ? quantity * unit_price : null,
          observations: obs,
        };

        if (_editing) {
          await _api(`/api/bio/outputs/${_editing.id}`, 'PATCH', { ...outputFields, performed_by });
        } else {
          const created = await _api('/api/bio/outputs', 'POST', { ...outputFields, performed_by, created_by: userId });
          await _finalizeBioTask('salida', extractRecordId(created), '✅ Salida registrada correctamente.');
        }
        okEl.style.display = 'block';
        btn.textContent = 'Guardado ✓';
        break;
      }

      default:
        throw new Error('Tipo de formulario desconocido.');
    }

  } catch (e) {
    errTxt.textContent  = e.message;
    errEl.style.display = 'block';
    btn.disabled        = false;
    btn.textContent     = _activeForm === 'cerrar-lote' ? 'Cerrar lote' : (_editing ? 'Guardar cambios' : 'Guardar registro');
  }
}

// ─── WINDOW BINDINGS ──────────────────────────────────────────────────────

window._bic = (i, key, val) => { if (_batchInputRows[i]) _batchInputRows[i][key] = val; };

window._bioPickBatch = (idx) => {
  const batch = (window._bioOpenBatches || [])[idx];
  if (batch) _openBioCloseForm(batch);
};

// Auto-fill unit from bio_raw_materials.unit (filas de abrir-lote)
window._bioRawUnit = (i) => {
  const id  = document.getElementById(`bi-mat-${i}`)?.value;
  const mat = (_cats?.rawMaterials || []).find(m => m.id === id);
  const unitEl = document.getElementById(`bi-unit-${i}`);
  if (unitEl) unitEl.textContent = mat?.unit || '';
};

// Auto-fill unit field in entrada form
window._bioRawEntradaUnit = () => {
  const id  = document.getElementById('f-raw')?.value;
  const mat = (_cats?.rawMaterials || []).find(m => m.id === id);
  const u = document.getElementById('f-unit');
  if (u) u.value = mat?.unit || '';
};

// Toggle the inline "nueva materia prima" mini-form
window._bioNewRawToggle = () => {
  const val = document.getElementById('f-raw')?.value;
  const nr  = document.getElementById('new-raw-form');
  if (nr) nr.style.display = val === '__new__' ? 'block' : 'none';
};

// Toggle supplier/cost fields based on entrada's "type"
window._bioEntradaTypeChanged = () => {
  const type = document.getElementById('f-type')?.value;
  const wrap = document.getElementById('entrada-purchase-fields');
  if (!wrap) return;
  const isPurchased = type === 'purchased';
  wrap.style.display = isPurchased ? 'grid' : 'none';
  if (!isPurchased) {
    const s = document.getElementById('f-supplier'); if (s) s.value = '';
    const c = document.getElementById('f-cost');     if (c) c.value = '';
  }
};

// Show current stock for the chosen finished product in salida
window._bioSalidaProductChanged = () => {
  const id = document.getElementById('f-product')?.value;
  const el = document.getElementById('f-product-stock');
  if (!el) return;
  const row = (_finishedStockCache || []).find(r => r.id === id);
  if (!id || !row) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.textContent = `Stock disponible: ${row.current_stock} ${row.unit}`;
};

// Toggle internal/external fields in salida
window._bioSalidaTypeChanged = () => {
  const type = document.getElementById('f-output-type')?.value;
  const isExternal = type === 'external_sale';
  const intEl = document.getElementById('salida-internal-fields');
  const extEl = document.getElementById('salida-external-fields');
  if (intEl) intEl.style.display = isExternal ? 'none' : 'block';
  if (extEl) extEl.style.display = isExternal ? 'block' : 'none';
  if (isExternal) {
    const d = document.getElementById('f-department'); if (d) d.value = '';
  } else {
    const c = document.getElementById('f-client');     if (c) c.value = '';
    const p = document.getElementById('f-unit-price'); if (p) p.value = '';
  }
};
