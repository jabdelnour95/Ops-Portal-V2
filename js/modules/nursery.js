import { state } from './state.js';
import { show } from './navigation.js';
import { photoUploadWidget, uploadPhotoGroup, clearPhotoGroup } from './photos.js';
import { stopRec } from './audio.js';

const API = 'https://tierramor-api.jabdelnour95.workers.dev';

// ─── MODULE STATE ──────────────────────────────────────────────────────────

let _cats = null; // { species, priceCategories, rawMaterials, substrateTypes, containerTypes, bioProducts, workers }
let _activeForm = null;
let _entryRows = [];      // ingredient rows for 'sustrato' (raw_material_id, raw_material_entry_id, quantity)
let _quoteRows = [];       // line items for 'cotizacion'
let _entriesCache = null;  // GET /api/nursery/raw-material-entries
let _substrateBatchesCache = null; // GET /api/nursery/substrate-batches
let _lotsCache = null;     // GET /api/nursery/lots
let _activeLot = null;
let _activeLotDetail = null;
let _editing = null;       // registro completo en edición (admin), null si es carga nueva

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
  const [species, priceCategories, rawMaterials, substrateTypes, containerTypes, bioProducts, workers] = await Promise.all([
    _api('/api/catalogs/nursery-species'),
    _api('/api/catalogs/nursery-price-categories'),
    _api('/api/catalogs/nursery-raw-materials'),
    _api('/api/catalogs/substrate-types'),
    _api('/api/catalogs/container-types'),
    _api('/api/catalogs/bio-finished-products').catch(() => []),
    _api('/api/farm-workers').catch(() => []),
  ]);
  _cats = { species, priceCategories, rawMaterials, substrateTypes, containerTypes, bioProducts, workers };
  return _cats;
}

function _active(arr) {
  return (arr || []).filter(i => i.active !== false);
}

function _opts(arr, label = 'name', val = 'id') {
  return _active(arr).map(i => `<option value="${i[val]}">${i[label]}</option>`).join('');
}

const _isAdmin = () => state.currentUser?.profile?.role === 'admin';

// ─── DROPDOWN BUILDERS ─────────────────────────────────────────────────────

const _speciesOpts = () => `<option value="">— Especie —</option>${_opts(_cats?.species || [])}`;

const _rawMatOpts = () => `<option value="">— Materia prima —</option>${_opts(_cats?.rawMaterials || [])}
  ${_isAdmin() ? '<option value="__new__">── Nueva materia prima ──</option>' : ''}`;

const _substrateTypeOpts = () => `<option value="">— Tipo de sustrato —</option>${_opts(_cats?.substrateTypes || [], 'name')}`;

const _containerTypeOpts = () => `<option value="">— Tipo de contenedor —</option>${(_active(_cats?.containerTypes || [])
  .map(c => `<option value="${c.id}">${c.name} (${c.size})</option>`)).join('')}`;

const _bioProductOpts = () => `<option value="">— Bioinsumo —</option>${_opts(_cats?.bioProducts || [])}`;

function _priceCatOptsForSpecies(speciesId) {
  const cats = _active(_cats?.priceCategories || []).filter(c => c.species_id === speciesId);
  return `<option value="">— Categoría de precio —</option>${cats.map(c => `<option value="${c.id}">${c.size_label} — ₡${c.unit_price}</option>`).join('')}`;
}

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

const _statusLabel = s => ({ germination: 'Germinación', active: 'Activo', graduated: 'Graduado', closed: 'Cerrado' }[s] || s);
const _statusColor = s => ({ germination: 'rgba(233,196,106,.18)', active: 'rgba(118,114,78,.12)', graduated: 'rgba(123,156,218,.15)', closed: 'rgba(84,66,54,.1)' }[s] || 'rgba(84,66,54,.1)');
const _statusText  = s => ({ germination: '#8a6d1f', active: 'var(--green)', graduated: '#5a7dba', closed: 'var(--tm)' }[s] || 'var(--tm)');

function _lotLabel(lot) {
  return `${lot.lot_id} · ${lot.nursery_species?.name || '—'} (${_statusLabel(lot.status)})`;
}

// ─── AUDIO WIDGET (idéntico a food.js / bio.js) ────────────────────────────

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

function _obsValue(id = 'obs') {
  return document.getElementById(`ta-${id}`)?.value?.trim() || null;
}

// ─── INGREDIENT ROWS (sustrato: materia prima → entrada específica) ───────

export function addSubstrateRow() {
  _entryRows.push({ raw_material_id: '', raw_material_entry_id: '', quantity: '' });
  _renderSubstrateRows();
}

export function removeSubstrateRow(idx) {
  _entryRows.splice(idx, 1);
  _renderSubstrateRows();
}

function _entriesForMaterial(materialId) {
  return (_entriesCache || [])
    .filter(e => e.raw_material_id === materialId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function _entryOptsHtml(materialId) {
  const entries = _entriesForMaterial(materialId);
  if (!entries.length) return '<option value="">— Sin entradas disponibles —</option>';
  return `<option value="">— Entrada —</option>${entries
    .map(e => `<option value="${e.id}" data-unit="${e.unit}">${e.group_id} · ${e.date} (recibido: ${e.quantity} ${e.unit})</option>`).join('')}`;
}

function _renderSubstrateRows() {
  const el = document.getElementById('substrate-rows');
  if (!el) return;
  if (!_entryRows.length) {
    el.innerHTML = `<div style="font-size:.75rem;font-family:sans-serif;color:var(--tm);font-style:italic;padding:.2rem 0;">Sin materias primas agregadas.</div>`;
    return;
  }
  el.innerHTML = _entryRows.map((row, i) => `
    <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.5rem;flex-wrap:wrap;">
      <select style="flex:1;min-width:140px;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                     padding:.6rem .65rem;font-size:.82rem;font-family:sans-serif;color:var(--brown);outline:none;"
              id="sr-mat-${i}" onchange="window._nurMatChanged(${i})">${_rawMatOpts()}</select>
      <select style="flex:1;min-width:160px;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                     padding:.6rem .65rem;font-size:.82rem;font-family:sans-serif;color:var(--brown);outline:none;"
              id="sr-entry-${i}" onchange="window._nurEntryChanged(${i})">${_entryOptsHtml(row.raw_material_id)}</select>
      <input type="number" step="0.001" min="0" placeholder="Cant."
             style="width:90px;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                    padding:.6rem .5rem;font-size:.82rem;font-family:sans-serif;color:var(--brown);
                    outline:none;text-align:center;"
             id="sr-qty-${i}" value="${row.quantity}" oninput="window._nurc(${i},'quantity',this.value)">
      <span id="sr-unit-${i}" style="width:34px;flex-shrink:0;font-size:.74rem;font-family:sans-serif;color:var(--tm);text-align:center;"></span>
      <button onclick="removeSubstrateRow(${i})"
              style="background:none;border:none;color:var(--clay);font-size:1.25rem;cursor:pointer;padding:.05rem .3rem;line-height:1;flex-shrink:0;">×</button>
    </div>`).join('');
  _entryRows.forEach((row, i) => {
    const s = document.getElementById(`sr-mat-${i}`);
    if (s && row.raw_material_id) s.value = row.raw_material_id;
    const e = document.getElementById(`sr-entry-${i}`);
    if (e && row.raw_material_entry_id) e.value = row.raw_material_entry_id;
  });
}

// ─── QUOTE LINE-ITEM ROWS (cotización) ─────────────────────────────────────

export function addQuoteRow() {
  _quoteRows.push({ species_id: '', price_category_id: '', lot_id: '', quantity: '', base_unit_price: 0, adjusted_unit_price: '' });
  _renderQuoteRows();
}

export function removeQuoteRow(idx) {
  _quoteRows.splice(idx, 1);
  _renderQuoteRows();
}

function _lotOptsForSpecies(speciesId) {
  const lots = (_lotsCache || []).filter(l => l.species_id === speciesId && ['active', 'graduated'].includes(l.status));
  if (!lots.length) return '<option value="">— Sin lotes disponibles —</option>';
  return `<option value="">— Lote —</option>${lots.map(l => `<option value="${l.id}">${l.lot_id} (${l.current_live_count ?? '—'} vivas)</option>`).join('')}`;
}

function _quoteSubtotal(row) {
  const qty = parseFloat(row.quantity) || 0;
  const price = parseFloat(row.adjusted_unit_price) || 0;
  return qty * price;
}

function _renderQuoteRows() {
  const el = document.getElementById('quote-rows');
  if (!el) return;
  if (!_quoteRows.length) {
    el.innerHTML = `<div style="font-size:.75rem;font-family:sans-serif;color:var(--tm);font-style:italic;padding:.2rem 0;">Sin ítems agregados.</div>`;
    return;
  }
  el.innerHTML = _quoteRows.map((row, i) => `
    <div style="background:white;border:1px solid rgba(84,66,54,.15);border-radius:10px;padding:.7rem;margin-bottom:.6rem;">
      <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.45rem;flex-wrap:wrap;">
        <select style="flex:1;min-width:140px;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                       padding:.55rem .6rem;font-size:.82rem;font-family:sans-serif;color:var(--brown);outline:none;"
                id="qr-species-${i}" onchange="window._nurQuoteSpeciesChanged(${i})">${_speciesOpts()}</select>
        <select style="flex:1;min-width:150px;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                       padding:.55rem .6rem;font-size:.82rem;font-family:sans-serif;color:var(--brown);outline:none;"
                id="qr-cat-${i}" onchange="window._nurQuoteCatChanged(${i})">${_priceCatOptsForSpecies(row.species_id)}</select>
        <button onclick="removeQuoteRow(${i})"
                style="background:none;border:none;color:var(--clay);font-size:1.25rem;cursor:pointer;padding:.05rem .3rem;line-height:1;flex-shrink:0;">×</button>
      </div>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
        <select style="flex:1;min-width:150px;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                       padding:.55rem .6rem;font-size:.8rem;font-family:sans-serif;color:var(--brown);outline:none;"
                id="qr-lot-${i}" onchange="window._nurc2(${i},'lot_id',this.value)">${_lotOptsForSpecies(row.species_id)}</select>
        <input type="number" min="1" step="1" placeholder="Cant."
               style="width:80px;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                      padding:.55rem .5rem;font-size:.8rem;font-family:sans-serif;color:var(--brown);outline:none;text-align:center;"
               id="qr-qty-${i}" value="${row.quantity}" oninput="window._nurQuoteQtyChanged(${i},this.value)">
        <input type="number" min="0" step="0.01" placeholder="Precio ajustado"
               style="width:130px;background:white;border:1px solid rgba(84,66,54,.2);border-radius:8px;
                      padding:.55rem .5rem;font-size:.8rem;font-family:sans-serif;color:var(--brown);outline:none;text-align:center;"
               id="qr-price-${i}" value="${row.adjusted_unit_price}" oninput="window._nurQuotePriceChanged(${i},this.value)">
        <span id="qr-subtotal-${i}" style="font-size:.78rem;font-family:sans-serif;color:var(--clay);font-weight:500;min-width:90px;text-align:right;">₡${_quoteSubtotal(row).toFixed(2)}</span>
      </div>
    </div>`).join('');
  _quoteRows.forEach((row, i) => {
    const s = document.getElementById(`qr-species-${i}`);
    if (s && row.species_id) s.value = row.species_id;
    const c = document.getElementById(`qr-cat-${i}`);
    if (c && row.price_category_id) c.value = row.price_category_id;
    const l = document.getElementById(`qr-lot-${i}`);
    if (l && row.lot_id) l.value = row.lot_id;
  });
}

// ─── GALLERY SCREEN ─────────────────────────────────────────────────────────

export async function openVivero() {
  show('nursery-screen');
  _loadCats()
    .then(() => _loadRecentLots())
    .catch(() => {
      const el = document.getElementById('nursery-recent-body');
      if (el) el.innerHTML = `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Sin conexión al servidor.</div>`;
    });
}

async function _loadLots(force = false) {
  if (_lotsCache && !force) return _lotsCache;
  _lotsCache = await _api('/api/nursery/lots');
  return _lotsCache;
}

async function _loadRecentLots() {
  const el = document.getElementById('nursery-recent-body');
  if (!el) return;
  try {
    const lots = await _loadLots(true);
    if (!lots.length) {
      el.innerHTML = `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;padding:.3rem 0;">No hay lotes registrados aún.</div>`;
      return;
    }
    el.innerHTML = lots.slice(0, 5).map(l => `
      <div onclick="window._nurOpenLotFromRecent('${l.id}')"
           style="background:white;border:1px solid rgba(84,66,54,.1);border-radius:10px;
                  padding:.7rem .9rem;margin-bottom:.5rem;display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
        <div>
          <div style="font-size:.87rem;font-family:sans-serif;color:var(--brown);font-weight:500;">${l.lot_id}</div>
          <div style="font-size:.67rem;font-family:sans-serif;color:var(--tm);margin-top:.1rem;">${l.nursery_species?.name || '—'} · ${l.date_start}</div>
        </div>
        <span style="font-size:.66rem;font-family:sans-serif;padding:.25rem .55rem;border-radius:6px;flex-shrink:0;margin-left:.6rem;
                     background:${_statusColor(l.status)};color:${_statusText(l.status)};">
          ${_statusLabel(l.status)}
        </span>
      </div>`).join('');
  } catch {
    el.innerHTML = `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Sin datos disponibles.</div>`;
  }
}

// ─── INVENTORY VIEWS (solo lectura) ────────────────────────────────────────

const _INV_TITLES = { raw: 'Inventario de Materias Primas', substrates: 'Inventario de Sustratos', containers: 'Inventario de Contenedores' };
const _INV_PATHS  = { raw: '/api/inventory/nursery-raw', substrates: '/api/inventory/substrates', containers: '/api/inventory/containers' };

export async function openNurseryInventory(kind) {
  document.getElementById('ft').textContent = _INV_TITLES[kind] || 'Inventario';
  document.getElementById('fs-back').onclick = () => { stopRec(); openVivero(); };
  document.getElementById('fbody').innerHTML = `<div id="nur-inv-body" style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Cargando...</div>`;
  show('fs');

  try {
    const rows = await _api(_INV_PATHS[kind]);
    const el = document.getElementById('nur-inv-body');
    if (!rows.length) {
      el.innerHTML = `<div style="font-size:.82rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Sin datos.</div>`;
      return;
    }

    if (kind === 'raw') {
      const sorted = [...rows].sort((a, b) => (b.below_minimum - a.below_minimum) || a.name.localeCompare(b.name));
      el.innerHTML = sorted.map(r => {
        const flagged = r.below_minimum;
        return `<div style="background:white;border:1px solid ${flagged ? 'rgba(192,57,43,.35)' : 'rgba(84,66,54,.1)'};
                            border-radius:10px;padding:.75rem .9rem;margin-bottom:.55rem;
                            display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:.88rem;font-family:sans-serif;color:var(--brown);font-weight:500;">
              ${r.name}${flagged ? ' <span style="color:#c0392b;font-size:.7rem;">⚠ Bajo mínimo</span>' : ''}
            </div>
            <div style="font-size:.67rem;font-family:sans-serif;color:var(--tm);margin-top:.1rem;">Mínimo: ${r.min_stock} ${r.unit}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:.8rem;">
            <div style="font-size:.92rem;font-family:sans-serif;color:${flagged ? '#c0392b' : 'var(--clay)'};font-weight:500;">${r.current_stock}</div>
            <div style="font-size:.62rem;font-family:sans-serif;color:var(--tm);">${r.unit}</div>
          </div>
        </div>`;
      }).join('');
    } else if (kind === 'substrates') {
      el.innerHTML = [...rows].sort((a, b) => a.name.localeCompare(b.name)).map(r => `
        <div style="background:white;border:1px solid rgba(84,66,54,.1);border-radius:10px;padding:.75rem .9rem;
                    margin-bottom:.55rem;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:.88rem;font-family:sans-serif;color:var(--brown);font-weight:500;">${r.code} · ${r.name}</div>
            <div style="font-size:.67rem;font-family:sans-serif;color:var(--tm);margin-top:.1rem;">Producido: ${r.total_produced || 0} · Usado: ${r.total_used || 0}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:.8rem;">
            <div style="font-size:.92rem;font-family:sans-serif;color:var(--clay);font-weight:500;">${r.available_stock || 0}</div>
          </div>
        </div>`).join('');
    } else {
      el.innerHTML = [...rows].sort((a, b) => a.name.localeCompare(b.name)).map(r => `
        <div style="background:white;border:1px solid rgba(84,66,54,.1);border-radius:10px;padding:.75rem .9rem;
                    margin-bottom:.55rem;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:.88rem;font-family:sans-serif;color:var(--brown);font-weight:500;">${r.name} (${r.size})</div>
            <div style="font-size:.67rem;font-family:sans-serif;color:var(--tm);margin-top:.1rem;">Llenados: ${r.total_filled || 0} · Usados en lotes: ${r.total_used_in_lots || 0} · Devueltos: ${r.total_returned || 0}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:.8rem;">
            <div style="font-size:.92rem;font-family:sans-serif;color:var(--clay);font-weight:500;">${r.available_stock || 0}</div>
            <div style="font-size:.62rem;font-family:sans-serif;color:var(--tm);">${r.unit}</div>
          </div>
        </div>`).join('');
    }
  } catch (e) {
    document.getElementById('nur-inv-body').innerHTML =
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
        <select id="f-raw" onchange="window._nurRawEntradaUnit(); window._nurNewRawToggle()">${_rawMatOpts()}</select>
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
            <option value="field">Recolectada en campo</option>
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="fg"><label>Cantidad</label><input type="number" step="0.001" min="0" id="f-qty"></div>
        <div class="fg"><label>Unidad</label><input type="text" id="f-unit" readonly style="background:rgba(84,66,54,.05);"></div>
      </div>
      <div class="fg">
        <label>Tipo</label>
        <select id="f-type">
          <option value="purchased">Comprada</option>
          <option value="farm_input">Insumo de finca</option>
          <option value="field">Recolectada en campo</option>
        </select>
      </div>
      <div class="fg"><label>Costo (₡) — opcional</label><input type="number" step="0.01" min="0" id="f-cost"></div>
      <div class="fg"><label>Responsable</label><select id="f-performed">${_performedByOpts()}</select></div>
      <div class="fg"><label>Observaciones</label>${_aw('obs', 'Observaciones o dicta nota de voz...')}</div>`,
    afterRender: () => {
      _selectPerformedByDefault('f-performed');
    },
  },

  sustrato: {
    title: 'Preparar Sustrato',
    build: () => `
      <div class="fg"><label>Fecha</label><input type="date" id="f-fecha"></div>
      <div class="fg"><label>Tipo de sustrato</label><select id="f-substrate-type">${_substrateTypeOpts()}</select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="fg"><label>Cantidad producida</label><input type="number" step="0.001" min="0" id="f-qty"></div>
        <div class="fg"><label>Unidad</label><input type="text" id="f-unit" value="L"></div>
      </div>
      <div class="fg">
        <label>Materias primas consumidas</label>
        <div class="doc-note">Cada componente se descuenta de una entrada específica recibida previamente.</div>
        <div id="substrate-rows" style="margin-top:.4rem;"></div>
        <button type="button" onclick="addSubstrateRow()" class="add-row-btn">+ Agregar materia prima</button>
      </div>
      <div class="fg"><label>Responsable</label><select id="f-performed">${_performedByOpts()}</select></div>
      <div class="fg"><label>Notas</label>${_aw('obs', 'Notas adicionales (opcional)...')}</div>`,
    afterRender: async () => {
      _selectPerformedByDefault('f-performed');
      _entryRows = [];
      try {
        _entriesCache = await _api('/api/nursery/raw-material-entries');
      } catch { _entriesCache = []; }
      addSubstrateRow();
    },
  },

  llenado: {
    title: 'Llenar Bolsas / Macetas',
    build: () => `
      <div class="fg"><label>Fecha</label><input type="date" id="f-fecha"></div>
      <div class="fg"><label>Tipo de contenedor</label><select id="f-container-type">${_containerTypeOpts()}</select></div>
      <div class="fg">
        <label>Batch de sustrato</label>
        <select id="f-substrate-batch" onchange="window._nurSubstrateBatchChanged()"></select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="fg"><label>Cantidad de sustrato usada</label><input type="number" step="0.001" min="0" id="f-sub-qty"></div>
        <div class="fg"><label>Unidad</label><input type="text" id="f-sub-unit" readonly style="background:rgba(84,66,54,.05);"></div>
      </div>
      <div class="fg"><label>Contenedores llenados</label><input type="number" step="1" min="1" id="f-qty"></div>
      <div class="fg"><label>Responsable</label><select id="f-performed">${_performedByOpts()}</select></div>
      <div class="fg"><label>Observaciones</label>${_aw('obs', 'Observaciones (opcional)...')}</div>`,
    afterRender: async () => {
      _selectPerformedByDefault('f-performed');
      try {
        _substrateBatchesCache = await _api('/api/nursery/substrate-batches');
      } catch { _substrateBatchesCache = []; }
      const sel = document.getElementById('f-substrate-batch');
      if (sel) {
        sel.innerHTML = `<option value="">— Batch —</option>${_substrateBatchesCache
          .map(b => `<option value="${b.id}" data-unit="${b.unit}">${b.batch_id} · ${b.substrate_types?.name || ''} · ${b.date}</option>`).join('')}`;
      }
    },
  },

  'crear-lote': {
    title: 'Crear Lote de Plantas',
    build: () => `
      <div class="fg"><label>Fecha de inicio</label><input type="date" id="f-fecha"></div>
      <div class="fg"><label>Especie</label><select id="f-species">${_speciesOpts()}</select></div>
      <div class="fg">
        <label>Origen</label>
        <select id="f-origin" onchange="window._nurOriginChanged()">
          <option value="own_seed">Semilla propia</option>
          <option value="cuttings">Esqueje</option>
          <option value="wholesale">Compra al mayor</option>
          <option value="repoting">Repique de otro lote</option>
        </select>
      </div>
      <div class="fg" id="repoting-source-wrap" style="display:none;">
        <label>Lote de origen</label>
        <select id="f-repoting-source" onchange="window._nurRepotingSourceChanged()"></select>
      </div>
      <div class="fg"><label>Cantidad inicial</label><input type="number" step="1" min="1" id="f-qty"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="fg"><label>Tipo de contenedor</label><select id="f-container-type">${_containerTypeOpts()}</select></div>
        <div class="fg"><label>Contenedores asignados</label><input type="number" step="1" min="0" id="f-containers-assigned"></div>
      </div>
      <div class="fg"><label>Responsable</label><select id="f-performed">${_performedByOpts()}</select></div>
      <div class="fg"><label>Notas</label>${_aw('obs', 'Notas adicionales (opcional)...')}</div>`,
    afterRender: async () => {
      _selectPerformedByDefault('f-performed');
      try {
        await _loadLots(true);
      } catch { _lotsCache = []; }
      const sel = document.getElementById('f-repoting-source');
      if (sel) {
        sel.innerHTML = `<option value="">— Lote de origen —</option>${(_lotsCache || [])
          .filter(l => ['active', 'graduated'].includes(l.status))
          .map(l => `<option value="${l.id}" data-species="${l.species_id}">${_lotLabel(l)}</option>`).join('')}`;
      }
    },
  },
};

// ─── OPEN FORM ─────────────────────────────────────────────────────────────

export async function openNurseryForm(type, record = null) {
  stopRec();
  _activeForm = type;
  _editing = record || null;
  _entryRows = [];

  const def = FORMS[type];
  if (!def) return;

  if (!_cats) await _loadCats();

  const title = record ? `Editar: ${def.title}` : def.title;
  document.getElementById('ft').textContent = title;
  document.getElementById('fs-back').onclick = () => {
    stopRec();
    record ? window._backToRecordsList() : openVivero();
  };
  const okBlock = record
    ? `<div class="ok-msg" id="nur-ok">
        <p id="nur-ok-txt">✅ Cambios guardados.</p>
        <button class="btn-sub" style="margin-top:.7rem;" onclick="window._backToRecordsList()">Volver a la lista</button>
      </div>`
    : `<div class="ok-msg" id="nur-ok">
        <p id="nur-ok-txt">✅ Guardado correctamente.</p>
        <button class="btn-sub green" style="margin-top:.7rem;" onclick="openNurseryForm('${type}')">Agregar otro registro</button>
      </div>`;
  document.getElementById('fbody').innerHTML = `
    <h2 style="font-size:1.05rem;font-weight:normal;font-style:italic;color:var(--brown);margin-bottom:1.1rem;">${title}</h2>
    ${def.build()}
    <button class="btn-sub" id="nur-btn-sub" onclick="submitNurseryForm()">${record ? 'Guardar cambios' : 'Guardar registro'}</button>
    <div class="fnote">Los datos se guardan en la base de datos de Tierramor.</div>
    <div id="nur-warn" style="display:none;background:rgba(233,196,106,.18);border:1px solid rgba(201,168,76,.5);
                              border-radius:10px;padding:.9rem 1rem;margin-top:.9rem;">
      <p style="font-size:.78rem;font-family:sans-serif;color:#8a6d1f;" id="nur-warn-txt"></p>
    </div>
    ${okBlock}
    <div id="nur-err" style="display:none;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.3);
                              border-radius:10px;padding:1rem;text-align:center;margin-top:.9rem;">
      <p style="font-size:.82rem;font-family:sans-serif;color:#c0392b;" id="nur-err-txt"></p>
    </div>`;

  const dateEl = document.getElementById('f-fecha');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  if (def.afterRender) await def.afterRender();
  if (record) _prefillNurseryForm(type, record);

  show('fs');
}

// ─── PREFILL (modo edición, admin) ─────────────────────────────────────────

function _setNurVal(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null) el.value = val;
}

function _prefillNurseryForm(type, record) {
  switch (type) {
    case 'entrada': {
      _setNurVal('f-fecha', record.date);
      _setNurVal('f-raw', record.raw_material_id);
      window._nurRawEntradaUnit();
      _setNurVal('f-qty', record.quantity);
      _setNurVal('f-type', record.type);
      _setNurVal('f-cost', record.cost ?? '');
      _setNurVal('f-performed', record.performed_by);
      _setNurVal('ta-obs', record.observations || '');
      break;
    }

    case 'sustrato': {
      _setNurVal('f-fecha', record.date);
      _setNurVal('f-substrate-type', record.substrate_type_id);
      _setNurVal('f-qty', record.quantity_produced);
      _setNurVal('f-unit', record.unit || 'L');
      _setNurVal('f-performed', record.performed_by);
      _setNurVal('ta-obs', record.notes || '');
      _entryRows = (record.substrate_batch_components || []).map(c => {
        const entry = (_entriesCache || []).find(e => e.id === c.raw_material_entry_id);
        return { raw_material_id: entry?.raw_material_id || '', raw_material_entry_id: c.raw_material_entry_id, quantity: String(c.quantity) };
      });
      _renderSubstrateRows();
      break;
    }

    case 'llenado': {
      _setNurVal('f-fecha', record.date);
      _setNurVal('f-container-type', record.container_type_id);
      _setNurVal('f-substrate-batch', record.substrate_batch_id);
      window._nurSubstrateBatchChanged();
      _setNurVal('f-sub-qty', record.substrate_quantity);
      _setNurVal('f-sub-unit', record.substrate_unit || '');
      _setNurVal('f-qty', record.containers_filled);
      _setNurVal('f-performed', record.performed_by);
      _setNurVal('ta-obs', record.observations || '');
      break;
    }

    case 'crear-lote': {
      _setNurVal('f-fecha', record.date_start);
      _setNurVal('f-origin', record.origin);
      window._nurOriginChanged();
      if (record.origin === 'repoting') {
        _setNurVal('f-repoting-source', record.repoting_from_lot_id);
        window._nurRepotingSourceChanged();
      } else {
        _setNurVal('f-species', record.species_id);
      }
      _setNurVal('f-qty', record.initial_quantity);
      _setNurVal('f-container-type', record.container_type_id || '');
      _setNurVal('f-containers-assigned', record.containers_assigned ?? '');
      _setNurVal('f-performed', record.responsible_id);
      _setNurVal('ta-obs', record.notes || '');
      break;
    }
  }
}

// ─── GESTIONAR LOTE — picker + detail + sub-forms (dentro de #fs) ─────────

export async function openNurseryLotPicker() {
  stopRec();
  _activeForm = 'gestionar-lote';
  document.getElementById('ft').textContent = 'Gestionar Lote';
  document.getElementById('fs-back').onclick = () => { stopRec(); openVivero(); };
  document.getElementById('fbody').innerHTML = `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Cargando lotes...</div>`;
  show('fs');

  try {
    await _loadCats();
    const lots = await _loadLots(true);

    if (!lots.length) {
      document.getElementById('fbody').innerHTML = `
        <div class="cs">
          <div class="csi">📭</div>
          <h3>No hay lotes registrados</h3>
          <p>Creá el primer lote de plantas del Vivero.</p>
        </div>
        <button class="btn-sub" onclick="openNurseryForm('crear-lote')">Crear Lote</button>`;
      return;
    }

    document.getElementById('fbody').innerHTML = `
      <h2 style="font-size:1.05rem;font-weight:normal;font-style:italic;color:var(--brown);margin-bottom:1.1rem;">Seleccioná el lote</h2>
      <div id="lot-picker-list"></div>`;

    document.getElementById('lot-picker-list').innerHTML = lots.map((l, i) => `
      <div onclick="window._nurPickLot(${i})"
           style="background:white;border:1px solid rgba(84,66,54,.15);border-radius:10px;
                  padding:.85rem .95rem;margin-bottom:.6rem;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:.9rem;font-family:sans-serif;color:var(--brown);font-weight:500;">${l.lot_id}</div>
          <div style="font-size:.72rem;font-family:sans-serif;color:var(--tm);margin-top:.15rem;">
            ${l.nursery_species?.name || '—'} · Inicio: ${l.date_start} · ${l.current_live_count ?? l.initial_quantity} vivas
          </div>
        </div>
        <span style="font-size:.66rem;font-family:sans-serif;padding:.25rem .55rem;border-radius:6px;flex-shrink:0;margin-left:.6rem;
                     background:${_statusColor(l.status)};color:${_statusText(l.status)};">${_statusLabel(l.status)}</span>
      </div>`).join('');

    window._nurLots = lots;
  } catch (e) {
    document.getElementById('fbody').innerHTML = `<div style="font-size:.82rem;font-family:sans-serif;color:#c0392b;">${e.message}</div>`;
  }
}

const _LOT_SUB_TITLES = {
  'germination-tracking': 'Seguimiento de Germinación',
  'establishment-count': 'Conteo de Establecimiento',
  maintenance: 'Mantenimiento de Lote',
  'plant-counts': 'Conteo de Plantas Vivas',
  graduations: 'Graduación de Plantas',
  outputs: 'Salida de Plantas',
};

function _lotSubFields(action) {
  const lot = _activeLot;
  const detail = _activeLotDetail;
  switch (action) {
    case 'germination-tracking':
      return `
        <div class="fg"><label>Fecha</label><input type="date" id="f-fecha"></div>
        <div class="fg"><label>% estimado de germinación</label><input type="number" step="0.1" min="0" max="100" id="f-rate"></div>
        <div class="fg"><label>Observaciones</label>${_aw('obs', 'Observaciones del seguimiento...')}</div>
        ${photoUploadWidget('nur-photos')}`;
    case 'establishment-count':
      return `
        <div class="fg"><label>Fecha</label><input type="date" id="f-fecha"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
          <div class="fg"><label>Plantas vivas</label><input type="number" step="1" min="0" id="f-live"></div>
          <div class="fg"><label>Plantas fallidas</label><input type="number" step="1" min="0" id="f-failed"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
          <div class="fg"><label>Contenedores devueltos</label><input type="number" step="1" min="0" id="f-containers-returned"></div>
          <div class="fg"><label>Sustrato devuelto</label><input type="number" step="0.001" min="0" id="f-substrate-returned"></div>
        </div>
        <div class="fg"><label>Unidad de sustrato</label><input type="text" id="f-substrate-unit" placeholder="L"></div>
        <div class="fg"><label>Responsable</label><select id="f-performed">${_performedByOpts()}</select></div>`;
    case 'maintenance':
      return `
        <div class="fg"><label>Fecha</label><input type="date" id="f-fecha"></div>
        <div class="fg">
          <label>Tipo de mantenimiento</label>
          <select id="f-maint-type" onchange="window._nurMaintTypeChanged()">
            <option value="irrigation">Riego</option>
            <option value="fertilization">Fertilización</option>
            <option value="pruning">Poda</option>
            <option value="repoting">Repique</option>
            <option value="bioinputs">Bioinsumos</option>
          </select>
        </div>
        <div id="maint-bio-fields" style="display:none;">
          <div class="fg"><label>Bioinsumo</label><select id="f-bio-product" onchange="window._nurMaintBioUnit()">${_bioProductOpts()}</select></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
            <div class="fg"><label>Cantidad</label><input type="number" step="0.001" min="0" id="f-qty"></div>
            <div class="fg"><label>Unidad</label><input type="text" id="f-qty-unit" readonly style="background:rgba(84,66,54,.05);"></div>
          </div>
        </div>
        <div class="fg"><label>Responsable</label><select id="f-performed">${_performedByOpts()}</select></div>
        <div class="fg"><label>Observaciones</label>${_aw('obs', 'Observaciones (opcional)...')}</div>
        ${photoUploadWidget('nur-photos')}`;
    case 'plant-counts':
      return `
        <div class="fg"><label>Fecha</label><input type="date" id="f-fecha"></div>
        <div class="fg"><label>Conteo de plantas vivas</label><input type="number" step="1" min="0" id="f-live"></div>
        <div class="fg"><label>Responsable</label><select id="f-performed">${_performedByOpts()}</select></div>
        <div class="fg"><label>Notas</label>${_aw('obs', 'Notas (opcional)...')}</div>`;
    case 'graduations':
      return `
        <div class="fg"><label>Fecha</label><input type="date" id="f-fecha"></div>
        <div class="fg"><label>Cantidad graduada</label><input type="number" step="1" min="1" id="f-qty"></div>
        <div class="fg"><label>Categoría de precio</label><select id="f-price-cat">${_priceCatOptsForSpecies(lot.species_id)}</select></div>
        <div class="fg"><label>Notas</label>${_aw('obs', 'Notas (opcional)...')}</div>`;
    case 'outputs': {
      const gradOpts = (detail?.graduations || [])
        .map(g => `<option value="${g.id}">${g.date} · ${g.quantity} u.</option>`).join('');
      return `
        <div class="fg"><label>Fecha</label><input type="date" id="f-fecha"></div>
        <div class="fg"><label>Cantidad</label><input type="number" step="1" min="1" id="f-qty"></div>
        <div class="fg">
          <label>Tipo de salida</label>
          <select id="f-output-type" onchange="window._nurOutputTypeChanged()">
            <option value="internal_use">Uso interno</option>
            <option value="external_sale">Venta externa</option>
          </select>
        </div>
        <div class="fg"><label>Graduación de referencia (opcional)</label><select id="f-graduation">
          <option value="">— Ninguna —</option>${gradOpts}</select></div>
        <div class="fg"><label>Destino</label><input type="text" id="f-destination" placeholder="Área/cama o cliente"></div>
        <div id="output-price-field" style="display:none;" class="fg"><label>Precio unitario</label><input type="number" step="0.01" min="0" id="f-unit-price"></div>
        <div class="fg"><label>Responsable</label><select id="f-performed">${_performedByOpts()}</select></div>`;
    }
    default:
      return '';
  }
}

function _openNurseryLotSubForm(action) {
  _activeForm = `lot:${action}`;
  clearPhotoGroup('nur-photos');
  document.getElementById('ft').textContent = _LOT_SUB_TITLES[action] || 'Registro de Lote';
  document.getElementById('fs-back').onclick = () => { stopRec(); _openNurseryLotDetail(_activeLot); };
  document.getElementById('fbody').innerHTML = `
    <div class="doc-note" style="margin-bottom:1rem;"><strong>${_activeLot.lot_id}</strong> · ${_activeLot.nursery_species?.name || ''}</div>
    <h2 style="font-size:1.05rem;font-weight:normal;font-style:italic;color:var(--brown);margin-bottom:1.1rem;">${_LOT_SUB_TITLES[action]}</h2>
    ${_lotSubFields(action)}
    <button class="btn-sub" id="nur-btn-sub" onclick="submitNurseryForm()">Guardar registro</button>
    <div class="fnote">Los datos se guardan en la base de datos de Tierramor.</div>
    <div class="ok-msg" id="nur-ok">
      <p id="nur-ok-txt">✅ Guardado correctamente.</p>
      <button class="btn-sub green" style="margin-top:.7rem;" onclick="window._nurBackToLotDetail()">Volver al lote</button>
    </div>
    <div id="nur-err" style="display:none;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.3);
                              border-radius:10px;padding:1rem;text-align:center;margin-top:.9rem;">
      <p style="font-size:.82rem;font-family:sans-serif;color:#c0392b;" id="nur-err-txt"></p>
    </div>`;

  const dateEl = document.getElementById('f-fecha');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
  const perfEl = document.getElementById('f-performed');
  if (perfEl) _selectPerformedByDefault('f-performed');
}

async function _openNurseryLotDetail(lot) {
  _activeLot = lot;
  document.getElementById('ft').textContent = lot.lot_id;
  document.getElementById('fbody').innerHTML = `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Cargando detalle del lote...</div>`;

  try {
    const detail = await _api(`/api/nursery/lots/${lot.id}`);
    _activeLotDetail = detail;
    const l = detail.lot;
    const canEstablish = l.status === 'germination' && !detail.establishment_count;
    const canGerm      = l.status === 'germination';
    const canOperate    = l.status !== 'germination';

    document.getElementById('fbody').innerHTML = `
      <div class="doc-note" style="margin-bottom:1rem;">
        <strong>${l.lot_id}</strong> · ${l.nursery_species?.name || '—'} · Origen: ${l.origin}<br>
        Inicio: ${l.date_start} · Inicial: ${l.initial_quantity} · Vivas: ${l.current_live_count ?? '—'}
      </div>
      <div class="grid">
        ${canGerm ? `<div class="gcard" onclick="window._nurOpenLotSub('germination-tracking')">
          <div class="ct">🌱 Seguimiento de Germinación</div><div class="cd">Registrar avance de germinación</div></div>` : ''}
        ${canEstablish ? `<div class="gcard" onclick="window._nurOpenLotSub('establishment-count')">
          <div class="ct">✅ Conteo de Establecimiento</div><div class="cd">Cierra la fase de germinación</div></div>` : ''}
        ${canOperate ? `<div class="gcard" onclick="window._nurOpenLotSub('maintenance')">
          <div class="ct">🌿 Mantenimiento</div><div class="cd">Riego, fertilización, poda, bioinsumos</div></div>` : ''}
        ${canOperate ? `<div class="gcard" onclick="window._nurOpenLotSub('plant-counts')">
          <div class="ct">🔢 Conteo de Plantas Vivas</div><div class="cd">Actualizar conteo y calcular mortalidad</div></div>` : ''}
        ${canOperate ? `<div class="gcard" onclick="window._nurOpenLotSub('graduations')">
          <div class="ct">🎓 Graduación</div><div class="cd">Pasar plantas a inventario disponible</div></div>` : ''}
        ${canOperate ? `<div class="gcard" onclick="window._nurOpenLotSub('outputs')">
          <div class="ct">📤 Salida de Plantas</div><div class="cd">Venta externa o uso interno</div></div>` : ''}
      </div>`;
  } catch (e) {
    document.getElementById('fbody').innerHTML = `<div style="font-size:.82rem;font-family:sans-serif;color:#c0392b;">${e.message}</div>`;
  }
}

// ─── COTIZACIÓN (quotations + items) ───────────────────────────────────────

export async function openNurseryQuoteForm() {
  stopRec();
  _activeForm = 'cotizacion';
  _quoteRows = [];
  document.getElementById('ft').textContent = 'Nueva Cotización';
  document.getElementById('fs-back').onclick = () => { stopRec(); openVivero(); };
  document.getElementById('fbody').innerHTML = `<div style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Cargando...</div>`;
  show('fs');

  try {
    await _loadCats();
    await _loadLots(true);

    document.getElementById('fbody').innerHTML = `
      <h2 style="font-size:1.05rem;font-weight:normal;font-style:italic;color:var(--brown);margin-bottom:1.1rem;">Nueva Cotización</h2>
      <div class="fg"><label>Cliente</label><input type="text" id="f-client-name"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;">
        <div class="fg"><label>Email</label><input type="email" id="f-client-email"></div>
        <div class="fg"><label>Teléfono</label><input type="text" id="f-client-phone"></div>
      </div>
      <div class="fg"><label>Válida hasta</label><input type="date" id="f-validity"></div>
      <div class="fg">
        <label>Ítems de la cotización</label>
        <div id="quote-rows" style="margin-top:.4rem;"></div>
        <button type="button" onclick="addQuoteRow()" class="add-row-btn">+ Agregar ítem</button>
      </div>
      <div class="fg"><label>Notas</label>${_aw('obs', 'Notas adicionales (opcional)...')}</div>
      <button class="btn-sub" id="nur-btn-sub" onclick="submitNurseryForm()">Guardar cotización</button>
      <div class="fnote">Los datos se guardan en la base de datos de Tierramor.</div>
      <div class="ok-msg" id="nur-ok">
        <p id="nur-ok-txt">✅ Cotización guardada correctamente.</p>
        <button class="btn-sub green" style="margin-top:.7rem;" onclick="openNurseryQuoteForm()">Crear otra cotización</button>
      </div>
      <div id="nur-err" style="display:none;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.3);
                                border-radius:10px;padding:1rem;text-align:center;margin-top:.9rem;">
        <p style="font-size:.82rem;font-family:sans-serif;color:#c0392b;" id="nur-err-txt"></p>
      </div>`;

    addQuoteRow();
  } catch (e) {
    document.getElementById('fbody').innerHTML = `<div style="font-size:.82rem;font-family:sans-serif;color:#c0392b;">${e.message}</div>`;
  }
}

const _QUOTE_STATUS_LABEL = { pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada' };

export async function openNurseryQuotes() {
  document.getElementById('ft').textContent = 'Cotizaciones';
  document.getElementById('fs-back').onclick = () => { stopRec(); openVivero(); };
  document.getElementById('fbody').innerHTML = `<div id="nur-quotes-body" style="font-size:.78rem;font-family:sans-serif;color:var(--tm);font-style:italic;">Cargando...</div>`;
  show('fs');

  try {
    const quotes = await _api('/api/nursery/quotations');
    window._nurQuotes = quotes;
    const el = document.getElementById('nur-quotes-body');
    if (!quotes.length) {
      el.innerHTML = `<div style="font-size:.82rem;font-family:sans-serif;color:var(--tm);font-style:italic;">No hay cotizaciones registradas.</div>`;
      return;
    }
    el.innerHTML = quotes.map((q, i) => {
      const total = (q.quotation_items || []).reduce((s, it) => s + (it.subtotal || 0), 0);
      return `<div style="background:white;border:1px solid rgba(84,66,54,.15);border-radius:10px;padding:.85rem .95rem;margin-bottom:.6rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:.9rem;font-family:sans-serif;color:var(--brown);font-weight:500;">${q.client_name}</div>
            <div style="font-size:.72rem;font-family:sans-serif;color:var(--tm);margin-top:.15rem;">
              Válida hasta: ${q.validity_date} · Total: ₡${total.toFixed(2)} · ${(q.quotation_items || []).length} ítem(s)
            </div>
          </div>
          <span style="font-size:.66rem;font-family:sans-serif;padding:.25rem .55rem;border-radius:6px;flex-shrink:0;margin-left:.6rem;
                       background:rgba(84,66,54,.08);color:var(--brown);">${_QUOTE_STATUS_LABEL[q.status] || q.status}</span>
        </div>
        ${q.status === 'pending' ? `<div style="display:flex;gap:.5rem;margin-top:.6rem;">
          <button onclick="window._nurQuoteStatus(${i},'accepted')" class="btn-sub green" style="margin:0;flex:1;padding:.5rem;font-size:.78rem;">Aceptar</button>
          <button onclick="window._nurQuoteStatus(${i},'rejected')" class="btn-sub" style="margin:0;flex:1;padding:.5rem;font-size:.78rem;background:rgba(192,57,43,.85);">Rechazar</button>
        </div>` : ''}
      </div>`;
    }).join('');
  } catch (e) {
    document.getElementById('nur-quotes-body').innerHTML = `<div style="font-size:.82rem;font-family:sans-serif;color:#c0392b;">${e.message}</div>`;
  }
}

// ─── SUBMIT ────────────────────────────────────────────────────────────────

export async function submitNurseryForm() {
  stopRec();
  const userId = state.currentUser?.id;
  if (!userId) return;

  const btn    = document.getElementById('nur-btn-sub');
  const errEl  = document.getElementById('nur-err');
  const errTxt = document.getElementById('nur-err-txt');
  const okEl   = document.getElementById('nur-ok');

  btn.disabled    = true;
  btn.textContent = 'Guardando...';
  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  try {
    const date = document.getElementById('f-fecha')?.value;
    if (_activeForm !== 'cotizacion' && !date) throw new Error('Ingresá la fecha.');
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
          const newMat = await _api('/api/catalogs/nursery-raw-materials', 'POST', {
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
        const cost = parseFloat(document.getElementById('f-cost')?.value) || null;
        const performed_by = document.getElementById('f-performed')?.value || userId;

        const entradaFields = { date, raw_material_id, quantity, unit, type, cost, observations: obs };

        if (_editing) {
          await _api(`/api/nursery/raw-material-entries/${_editing.id}`, 'PATCH', { ...entradaFields, performed_by });
        } else {
          await _api('/api/nursery/raw-material-entries', 'POST', {
            ...entradaFields, performed_by, created_by: userId,
          });
        }
        okEl.style.display = 'block';
        btn.textContent = 'Guardado ✓';
        break;
      }

      case 'sustrato': {
        const substrate_type_id = document.getElementById('f-substrate-type')?.value;
        if (!substrate_type_id) throw new Error('Seleccioná el tipo de sustrato.');
        const quantity_produced = parseFloat(document.getElementById('f-qty')?.value);
        if (!quantity_produced) throw new Error('Ingresá la cantidad producida.');
        const unit = document.getElementById('f-unit')?.value || 'L';
        const performed_by = document.getElementById('f-performed')?.value || userId;
        const validRows = _entryRows.filter(r => r.raw_material_entry_id && r.quantity);
        if (!validRows.length) throw new Error('Agregá al menos una materia prima consumida.');
        const components = validRows.map(r => ({
          raw_material_entry_id: r.raw_material_entry_id,
          quantity: parseFloat(r.quantity),
          unit: document.getElementById(`sr-entry-${_entryRows.indexOf(r)}`)?.selectedOptions?.[0]?.dataset?.unit || unit,
        }));

        if (_editing) {
          await _api(`/api/nursery/substrate-batches/${_editing.id}`, 'PATCH', {
            substrate_type_id, quantity_produced, unit, date, notes: obs, components,
          });
          okEl.style.display = 'block';
          btn.textContent = 'Guardado ✓';
        } else {
          const batch = await _api('/api/nursery/substrate-batches', 'POST', {
            substrate_type_id, quantity_produced, unit, date,
            performed_by, created_by: userId,
            notes: obs,
            components,
          });
          okEl.style.display = 'block';
          document.getElementById('nur-ok-txt').textContent = `✅ Batch ${batch.batch_id} preparado correctamente.`;
          btn.textContent = 'Guardado ✓';
        }
        _entryRows = [];
        break;
      }

      case 'llenado': {
        const container_type_id = document.getElementById('f-container-type')?.value;
        if (!container_type_id) throw new Error('Seleccioná el tipo de contenedor.');
        const substrate_batch_id = document.getElementById('f-substrate-batch')?.value;
        if (!substrate_batch_id) throw new Error('Seleccioná el batch de sustrato.');
        const substrate_quantity = parseFloat(document.getElementById('f-sub-qty')?.value);
        if (!substrate_quantity) throw new Error('Ingresá la cantidad de sustrato usada.');
        const substrate_unit = document.getElementById('f-sub-unit')?.value;
        const containers_filled = parseInt(document.getElementById('f-qty')?.value);
        if (!containers_filled) throw new Error('Ingresá la cantidad de contenedores llenados.');
        const performed_by = document.getElementById('f-performed')?.value || userId;

        const llenadoFields = { date, container_type_id, substrate_batch_id, substrate_quantity, substrate_unit, containers_filled, observations: obs };

        if (_editing) {
          await _api(`/api/nursery/container-fills/${_editing.id}`, 'PATCH', { ...llenadoFields, performed_by });
        } else {
          await _api('/api/nursery/container-fills', 'POST', { ...llenadoFields, performed_by, created_by: userId });
        }
        okEl.style.display = 'block';
        btn.textContent = 'Guardado ✓';
        break;
      }

      case 'crear-lote': {
        const species_id = document.getElementById('f-species')?.value;
        if (!species_id) throw new Error('Seleccioná la especie.');
        const origin = document.getElementById('f-origin')?.value;
        const repoting_from_lot_id = origin === 'repoting' ? (document.getElementById('f-repoting-source')?.value || null) : null;
        if (origin === 'repoting' && !repoting_from_lot_id) throw new Error('Seleccioná el lote de origen.');
        const initial_quantity = parseInt(document.getElementById('f-qty')?.value);
        if (!initial_quantity) throw new Error('Ingresá la cantidad inicial.');
        const container_type_id = document.getElementById('f-container-type')?.value || null;
        const containers_assigned = parseInt(document.getElementById('f-containers-assigned')?.value) || null;
        const responsible_id = document.getElementById('f-performed')?.value || userId;

        if (_editing) {
          await _api(`/api/nursery/lots/${_editing.id}`, 'PATCH', {
            species_id, origin, repoting_from_lot_id,
            date_start: date, initial_quantity,
            container_type_id, containers_assigned,
            responsible_id, notes: obs,
          });
          okEl.style.display = 'block';
          btn.textContent = 'Guardado ✓';
        } else {
          const lot = await _api('/api/nursery/lots', 'POST', {
            species_id, origin, repoting_from_lot_id,
            date_start: date, initial_quantity,
            container_type_id, containers_assigned,
            responsible_id, created_by: userId,
            notes: obs,
          });
          okEl.style.display = 'block';
          document.getElementById('nur-ok-txt').textContent = `✅ Lote ${lot.lot_id} creado correctamente.`;
          btn.textContent = 'Guardado ✓';
        }
        break;
      }

      case 'lot:germination-tracking': {
        const estimated_germination_rate = parseFloat(document.getElementById('f-rate')?.value) || null;
        const [photo_url = null] = await uploadPhotoGroup('nur-photos', 'nursery', 'germination-tracking', date);
        await _api(`/api/nursery/lots/${_activeLot.id}/germination-tracking`, 'POST', {
          date, estimated_germination_rate, observations: obs, created_by: userId, photo_url,
        });
        okEl.style.display = 'block';
        btn.textContent = 'Guardado ✓';
        break;
      }

      case 'lot:establishment-count': {
        const live_plants = parseInt(document.getElementById('f-live')?.value);
        const failed_plants = parseInt(document.getElementById('f-failed')?.value);
        if (Number.isNaN(live_plants) || Number.isNaN(failed_plants)) throw new Error('Completá plantas vivas y fallidas.');
        const containers_returned = parseInt(document.getElementById('f-containers-returned')?.value) || null;
        const substrate_returned = parseFloat(document.getElementById('f-substrate-returned')?.value) || null;
        const substrate_unit = document.getElementById('f-substrate-unit')?.value || null;
        const performed_by = document.getElementById('f-performed')?.value || userId;

        await _api(`/api/nursery/lots/${_activeLot.id}/establishment-count`, 'POST', {
          date, live_plants, failed_plants, containers_returned, substrate_returned, substrate_unit,
          performed_by, created_by: userId,
        });
        okEl.style.display = 'block';
        document.getElementById('nur-ok-txt').textContent = '✅ Conteo registrado — el lote pasó a estado Activo.';
        btn.textContent = 'Guardado ✓';
        break;
      }

      case 'lot:maintenance': {
        const maintenance_type = document.getElementById('f-maint-type')?.value;
        const isBio = maintenance_type === 'bioinputs';
        const bio_product_id = isBio ? (document.getElementById('f-bio-product')?.value || null) : null;
        if (isBio && !bio_product_id) throw new Error('Seleccioná el bioinsumo aplicado.');
        const quantity = isBio ? (parseFloat(document.getElementById('f-qty')?.value) || null) : null;
        const quantity_unit = isBio ? (document.getElementById('f-qty-unit')?.value || null) : null;
        const performed_by = document.getElementById('f-performed')?.value || userId;
        const [photo_url = null] = await uploadPhotoGroup('nur-photos', 'nursery', 'maintenance', date);

        await _api(`/api/nursery/lots/${_activeLot.id}/maintenance`, 'POST', {
          date, maintenance_type, bio_product_id, quantity, quantity_unit,
          performed_by, created_by: userId,
          observations: obs, photo_url,
        });
        okEl.style.display = 'block';
        btn.textContent = 'Guardado ✓';
        break;
      }

      case 'lot:plant-counts': {
        const live_count = parseInt(document.getElementById('f-live')?.value);
        if (Number.isNaN(live_count)) throw new Error('Ingresá el conteo de plantas vivas.');
        const performed_by = document.getElementById('f-performed')?.value || userId;

        await _api(`/api/nursery/lots/${_activeLot.id}/plant-counts`, 'POST', {
          date, live_count, performed_by, notes: obs,
        });
        okEl.style.display = 'block';
        btn.textContent = 'Guardado ✓';
        break;
      }

      case 'lot:graduations': {
        const quantity = parseInt(document.getElementById('f-qty')?.value);
        if (!quantity) throw new Error('Ingresá la cantidad graduada.');
        const price_category_id = document.getElementById('f-price-cat')?.value;
        if (!price_category_id) throw new Error('Seleccioná la categoría de precio.');

        await _api(`/api/nursery/lots/${_activeLot.id}/graduations`, 'POST', {
          date, quantity, price_category_id, notes: obs, created_by: userId,
        });
        okEl.style.display = 'block';
        btn.textContent = 'Guardado ✓';
        break;
      }

      case 'lot:outputs': {
        const quantity = parseInt(document.getElementById('f-qty')?.value);
        if (!quantity) throw new Error('Ingresá la cantidad.');
        const output_type = document.getElementById('f-output-type')?.value;
        const graduation_id = document.getElementById('f-graduation')?.value || null;
        const destination = document.getElementById('f-destination')?.value?.trim() || null;
        const isExternal = output_type === 'external_sale';
        const unit_price = isExternal ? (parseFloat(document.getElementById('f-unit-price')?.value) || null) : null;
        const performed_by = document.getElementById('f-performed')?.value || userId;

        await _api(`/api/nursery/lots/${_activeLot.id}/outputs`, 'POST', {
          date, quantity, output_type, graduation_id, destination,
          unit_price, total_value: unit_price ? quantity * unit_price : null,
          performed_by, created_by: userId,
        });
        okEl.style.display = 'block';
        btn.textContent = 'Guardado ✓';
        break;
      }

      case 'cotizacion': {
        const client_name = document.getElementById('f-client-name')?.value?.trim();
        if (!client_name) throw new Error('Ingresá el nombre del cliente.');
        const client_email = document.getElementById('f-client-email')?.value?.trim() || null;
        const client_phone = document.getElementById('f-client-phone')?.value?.trim() || null;
        const validity_date = document.getElementById('f-validity')?.value;
        if (!validity_date) throw new Error('Ingresá la fecha de validez.');
        const validRows = _quoteRows.filter(r => r.species_id && r.price_category_id && r.lot_id && r.quantity);
        if (!validRows.length) throw new Error('Agregá al menos un ítem completo.');

        await _api('/api/nursery/quotations', 'POST', {
          client_name, client_email, client_phone, validity_date,
          notes: obs, created_by: userId,
          items: validRows.map(r => ({
            species_id: r.species_id,
            price_category_id: r.price_category_id,
            lot_id: r.lot_id,
            quantity: parseInt(r.quantity),
            base_unit_price: parseFloat(r.base_unit_price) || 0,
            adjusted_unit_price: parseFloat(r.adjusted_unit_price) || 0,
            subtotal: _quoteSubtotal(r),
          })),
        });
        okEl.style.display = 'block';
        btn.textContent = 'Guardado ✓';
        _quoteRows = [];
        break;
      }

      default:
        throw new Error('Tipo de formulario desconocido.');
    }

  } catch (e) {
    errTxt.textContent  = e.message;
    errEl.style.display = 'block';
    btn.disabled        = false;
    btn.textContent     = _editing ? 'Guardar cambios' : 'Guardar registro';
  }
}

// ─── WINDOW BINDINGS ──────────────────────────────────────────────────────

window._nurc  = (i, key, val) => { if (_entryRows[i]) _entryRows[i][key] = val; };
window._nurc2 = (i, key, val) => { if (_quoteRows[i]) _quoteRows[i][key] = val; };

window._nurMatChanged = (i) => {
  const matId = document.getElementById(`sr-mat-${i}`)?.value;
  if (_entryRows[i]) { _entryRows[i].raw_material_id = matId; _entryRows[i].raw_material_entry_id = ''; }
  const entrySel = document.getElementById(`sr-entry-${i}`);
  if (entrySel) entrySel.innerHTML = _entryOptsHtml(matId);
  const unitEl = document.getElementById(`sr-unit-${i}`);
  if (unitEl) unitEl.textContent = '';
};

window._nurEntryChanged = (i) => {
  const sel = document.getElementById(`sr-entry-${i}`);
  const entryId = sel?.value;
  if (_entryRows[i]) _entryRows[i].raw_material_entry_id = entryId;
  const unitEl = document.getElementById(`sr-unit-${i}`);
  if (unitEl) unitEl.textContent = sel?.selectedOptions?.[0]?.dataset?.unit || '';
};

window._nurRawEntradaUnit = () => {
  const id  = document.getElementById('f-raw')?.value;
  const mat = (_cats?.rawMaterials || []).find(m => m.id === id);
  const u = document.getElementById('f-unit');
  if (u) u.value = mat?.unit || '';
};

window._nurNewRawToggle = () => {
  const val = document.getElementById('f-raw')?.value;
  const nr  = document.getElementById('new-raw-form');
  if (nr) nr.style.display = val === '__new__' ? 'block' : 'none';
};

window._nurSubstrateBatchChanged = () => {
  const sel = document.getElementById('f-substrate-batch');
  const u = document.getElementById('f-sub-unit');
  if (u) u.value = sel?.selectedOptions?.[0]?.dataset?.unit || '';
};

window._nurOriginChanged = () => {
  const origin = document.getElementById('f-origin')?.value;
  const wrap = document.getElementById('repoting-source-wrap');
  const speciesSel = document.getElementById('f-species');
  if (wrap) wrap.style.display = origin === 'repoting' ? 'block' : 'none';
  if (origin !== 'repoting' && speciesSel) speciesSel.disabled = false;
  if (origin !== 'repoting') {
    const s = document.getElementById('f-repoting-source'); if (s) s.value = '';
  }
};

window._nurRepotingSourceChanged = () => {
  const sel = document.getElementById('f-repoting-source');
  const speciesId = sel?.selectedOptions?.[0]?.dataset?.species;
  const speciesSel = document.getElementById('f-species');
  if (speciesSel && speciesId) { speciesSel.value = speciesId; speciesSel.disabled = true; }
};

window._nurMaintTypeChanged = () => {
  const type = document.getElementById('f-maint-type')?.value;
  const wrap = document.getElementById('maint-bio-fields');
  if (wrap) wrap.style.display = type === 'bioinputs' ? 'block' : 'none';
};

window._nurMaintBioUnit = () => {
  const id = document.getElementById('f-bio-product')?.value;
  const prod = (_cats?.bioProducts || []).find(p => p.id === id);
  const u = document.getElementById('f-qty-unit');
  if (u) u.value = prod?.unit || '';
};

window._nurOutputTypeChanged = () => {
  const type = document.getElementById('f-output-type')?.value;
  const priceWrap = document.getElementById('output-price-field');
  if (priceWrap) priceWrap.style.display = type === 'external_sale' ? 'block' : 'none';
};

window._nurQuoteSpeciesChanged = (i) => {
  const speciesId = document.getElementById(`qr-species-${i}`)?.value;
  if (_quoteRows[i]) {
    _quoteRows[i].species_id = speciesId;
    _quoteRows[i].price_category_id = '';
    _quoteRows[i].lot_id = '';
    _quoteRows[i].base_unit_price = 0;
  }
  const catSel = document.getElementById(`qr-cat-${i}`);
  if (catSel) catSel.innerHTML = _priceCatOptsForSpecies(speciesId);
  const lotSel = document.getElementById(`qr-lot-${i}`);
  if (lotSel) lotSel.innerHTML = _lotOptsForSpecies(speciesId);
};

window._nurQuoteCatChanged = (i) => {
  const sel = document.getElementById(`qr-cat-${i}`);
  const catId = sel?.value;
  const cat = (_cats?.priceCategories || []).find(c => c.id === catId);
  if (_quoteRows[i]) {
    _quoteRows[i].price_category_id = catId;
    _quoteRows[i].base_unit_price = cat?.unit_price || 0;
    _quoteRows[i].adjusted_unit_price = cat?.unit_price || 0;
  }
  const priceEl = document.getElementById(`qr-price-${i}`);
  if (priceEl) priceEl.value = cat?.unit_price || '';
  const subEl = document.getElementById(`qr-subtotal-${i}`);
  if (subEl) subEl.textContent = `₡${_quoteSubtotal(_quoteRows[i]).toFixed(2)}`;
};

window._nurQuoteQtyChanged = (i, val) => {
  if (_quoteRows[i]) _quoteRows[i].quantity = val;
  const subEl = document.getElementById(`qr-subtotal-${i}`);
  if (subEl) subEl.textContent = `₡${_quoteSubtotal(_quoteRows[i]).toFixed(2)}`;
};

window._nurQuotePriceChanged = (i, val) => {
  if (_quoteRows[i]) _quoteRows[i].adjusted_unit_price = val;
  const subEl = document.getElementById(`qr-subtotal-${i}`);
  if (subEl) subEl.textContent = `₡${_quoteSubtotal(_quoteRows[i]).toFixed(2)}`;
};

window._nurPickLot = (idx) => {
  const lot = (window._nurLots || [])[idx];
  if (lot) _openNurseryLotDetail(lot);
};

window._nurOpenLotFromRecent = async (lotId) => {
  const lot = (_lotsCache || []).find(l => l.id === lotId);
  if (lot) {
    document.getElementById('ft').textContent = lot.lot_id;
    document.getElementById('fs-back').onclick = () => { stopRec(); openVivero(); };
    show('fs');
    _openNurseryLotDetail(lot);
  }
};

window._nurOpenLotSub = (action) => { _openNurseryLotSubForm(action); };

window._nurBackToLotDetail = () => { _openNurseryLotDetail(_activeLot); };

window._nurQuoteStatus = async (idx, status) => {
  const quote = (window._nurQuotes || [])[idx];
  if (!quote) return;
  try {
    await _api(`/api/nursery/quotations/${quote.id}/status`, 'PATCH', { status });
    openNurseryQuotes();
  } catch (e) {
    alert(e.message);
  }
};
