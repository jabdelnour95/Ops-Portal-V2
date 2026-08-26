import { state } from './state.js';
import { stopRec } from './audio.js';
import { DEPTS } from '../data/departments.js';
import { CAL_IDS, CAL_LABELS } from '../data/departments.js';

// Top-level department tiles shown on the home gallery.
// deptKeys: values in profile.departments that grant access to this tile.
const DEPT_TILES = [
  // deptKeys deben coincidir con el CHECK constraint de profile_departments.department
  // en Supabase: 'food_production' | 'biofactory' | 'nursery' | 'kitchen' (ver TDD.md 2.3).
  { id: 'finca',  label: 'Finca',       desc: 'Producción, Biofábrica y Vivero',           icon: '🌱', cls: 'finca', action: 'openFinca()',    status: 'active', deptKeys: ['food_production','biofactory','nursery'] },
  { id: 'ops',    label: 'Operaciones', desc: 'Limpieza, Mantenimiento y Proveduría',       icon: '🏗️', cls: 'ops',   action: 'openOps()',      status: 'active', deptKeys: ['limpieza','mantenimiento','proveeduria'] },
  { id: 'cocina', label: 'Cocina',      desc: 'Pedidos y gestión de cocina',                icon: '🍳', cls: 'cocina',action: null,             status: 'soon',   deptKeys: ['kitchen'] },
  { id: 'exp',    label: 'Experiencias',desc: 'Workshops, eventos y recorridos',            icon: '✨', cls: 'exp',   action: null,             status: 'soon',   deptKeys: ['experiencias'] },
];

function canSeeTile(tile, user) {
  if (user?.profile?.role === 'admin') return true;
  if (tile.id === 'rep') return false;
  const depts = user?.profile?.departments || [];
  return tile.deptKeys.some(k => depts.includes(k));
}

export function renderHome() {
  const user = state.currentUser;
  const name = user?.profile?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || '';

  const greetEl = document.getElementById('home-greeting');
  if (greetEl) greetEl.textContent = name ? `Bienvenido, ${name}` : 'Bienvenido';

  const tiles = DEPT_TILES.filter(t => canSeeTile(t, user));
  document.getElementById('dept-gallery').innerHTML = tiles.map(t => {
    const isSoon     = t.status === 'soon';
    const fullClass  = t.full ? ' full' : '';
    const onclick    = !isSoon && t.action ? ` onclick="${t.action}"` : '';
    const badgeLabel = t.status === 'active' ? 'Activo' : t.status === 'admin' ? 'Admin' : 'Próximamente';
    return `<div class="dept-tile${isSoon ? ' soon' : ''}${fullClass}"${onclick}>
      <div class="tile-icon ${t.cls}">${t.icon}</div>
      <div class="tile-body">
        <div class="tile-name">${t.label}</div>
        <div class="tile-desc">${t.desc}</div>
        <span class="tile-badge ${t.status === 'admin' ? 'admin' : t.status}">${badgeLabel}</span>
      </div>
    </div>`;
  }).join('');

  if (window._renderHomeTasks) window._renderHomeTasks();
}

function _toggleAdminTiles(screenId) {
  const isAdmin = state.currentUser?.profile?.role === 'admin';
  document.querySelectorAll(`#${screenId} .admin-only`).forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
}

export function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'home') renderHome();
  if (id === 'finca-home' || id === 'ops-home') _toggleAdminTiles(id);
  window.scrollTo(0, 0);
}

export function nav(to) {
  stopRec();
  if (to === 'home')      show('home');
  else if (to === 'dept') openDept(state.currentDept, state.deptParent);
  else if (to === 'finca-home') show('finca-home');
  else if (to === 'ops-home')   show('ops-home');
}

export function openFinca() {
  show('finca-home');
}

export function openOps() {
  show('ops-home');
}

export function openFincaModule(id) {
  const labels = { produccion: 'Producción de Alimentos', biofabrica: 'Biofábrica', vivero: 'Vivero', reportes: 'Reportes de Finca' };
  const label  = labels[id] || id;
  document.getElementById('con-title').textContent = label;
  document.getElementById('con-back').onclick = () => show('finca-home');
  document.getElementById('conbody').innerHTML = `
    <div class="cs">
      <div class="csi">🚧</div>
      <h3>${label}</h3>
      <p>Este módulo está en construcción y estará disponible próximamente.</p>
    </div>`;
  show('con-screen');
}

export function navBackDept() {
  stopRec();
  show(state.deptParent || 'home');
}

export function openDeptFrom(dept, from) {
  openDept(dept, from);
}

export function openDept(dept, from = 'ops-home') {
  state.currentDept = dept;
  state.deptParent  = from;
  const d = DEPTS[dept];
  document.getElementById('dept-title').textContent = d.label;
  document.getElementById('rgrid').innerHTML = d.resources.map(r => `
    <div class="gcard" onclick="openResource('${r.id}','${r.title}','${r.type || 'doc'}')">
      <div class="ct">${r.title}</div><div class="cd">${r.desc || ''}</div>
    </div>`).join('');
  const rl   = document.getElementById('rlist');
  const rlbl = document.getElementById('rlist-lbl');
  if (d.reports.length) {
    rlbl.style.display = '';
    rl.innerHTML = d.reports.map(r => `
      <button class="rbtn ${r.cls}" onclick="openForm('${r.form}')">
        <div class="rdot"></div><span>${r.label}</span><span class="arr">→</span>
      </button>`).join('');
  } else {
    rlbl.style.display = 'none';
    rl.innerHTML = '';
  }
  document.getElementById('si').value = '';
  show('dept');
}

export function filterCards() {
  const q = document.getElementById('si').value.toLowerCase();
  document.querySelectorAll('.gcard').forEach(c => {
    c.style.display = c.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

export function openResource(id, title, type) {
  if (type === 'checklist')   { openChecklistMenu(id); return; }
  if (type === 'cal')         { openCalendar(id); return; }
  if (type === 'inventarios') { openInventarios(); return; }
  if (type === 'proveedores') { openProveedores(); return; }
  if (id === 'frases-en') {
    document.getElementById('con-title').textContent = 'Frases Comunes en Inglés';
    document.getElementById('con-back').onclick = () => nav('dept');
    document.getElementById('conbody').innerHTML = `<div class="cs"><div class="csi">🇺🇸</div><h3>Frases Comunes en Inglés</h3><p>Esta sección estará disponible próximamente.</p></div>`;
    show('con-screen'); return;
  }
  document.getElementById('con-title').textContent = title;
  document.getElementById('con-back').onclick = () => nav('dept');
  let html = '';
  if (id === 'manual-limp')   html = renderManualLimp();
  else if (id === 'manual-prev') html = renderManualManto();
  else html = `<div class="cs"><div class="csi">📄</div><h3>${title}</h3><p>El contenido estará disponible aquí próximamente.</p></div>`;
  document.getElementById('conbody').innerHTML = html;
  show('con-screen');
}

export function openCalendar(id) {
  const calId = CAL_IDS[id];
  const label = CAL_LABELS[id];
  const enc   = encodeURIComponent(calId);
  const src   = `https://calendar.google.com/calendar/embed?src=${enc}&ctz=America%2FCosta_Rica&showTitle=0&showNav=1&showDate=1&showPrint=0&showTabs=0&showCalendars=0&showTz=0&mode=MONTH&bgcolor=%23E8E2D1&color=%23995C44`;
  document.getElementById('con-title').textContent = `Calendario — ${label}`;
  document.getElementById('con-back').onclick = () => nav('dept');
  document.getElementById('conbody').innerHTML = `
    <div style="font-size:.75rem;font-family:sans-serif;color:var(--tm);font-style:italic;margin-bottom:.9rem;">Calendario de ${label} · Solo lectura</div>
    <div style="background:white;border:1px solid rgba(84,66,54,.1);border-radius:12px;overflow:hidden;">
      <iframe src="${src}" style="border:none;width:100%;height:520px;display:block;" frameborder="0" scrolling="no"></iframe>
    </div>
    <div style="font-size:.68rem;font-family:sans-serif;color:var(--tm);text-align:center;margin-top:.75rem;line-height:1.5;">Para agregar o editar eventos, hazlo directamente en Google Calendar.</div>`;
  show('con-screen');
}

// Imported lazily by openResource — resolved via app.js bindings
function openChecklistMenu(id) { window._openChecklistMenu(id); }
function openInventarios()     { window._openInventarios(); }
function openProveedores()     { window._openProveedores(); }
function renderManualLimp()    { return window._renderManualLimp(); }
function renderManualManto()   { return window._renderManualManto(); }

export function openReportsScreen() { show('rep-screen'); }
