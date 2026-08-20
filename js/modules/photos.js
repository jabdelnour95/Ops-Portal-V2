import { state } from './state.js';

const API = 'https://tierramor-api.jabdelnour95.workers.dev';

// Reduce la dimensión máxima y recodifica a JPEG antes de guardar — las fotos de cámara
// pueden pesar varios MB y el límite práctico de subida es 5MB (ver Docs/TDD.md, sección Fotos).
async function _compressImage(file, maxDim = 1600, quality = 0.75) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bitmap) return file; // navegador sin soporte de createImageBitmap: subimos el original tal cual

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob || file;
}

export function photoUploadWidget(groupId) {
  return `<div class="fg">
    <label>Fotografías</label>
    <div class="photo-upload-box" onclick="document.getElementById('file-${groupId}').click()">
      <input type="file" id="file-${groupId}" accept="image/*" multiple capture="environment"
        onchange="handlePhotoUpload(event,'${groupId}')">
      <div class="pub-icon">📷</div>
      <div class="pub-label">Toca para <strong>tomar o adjuntar fotos</strong></div>
      <div style="font-size:.65rem;font-family:sans-serif;color:var(--tm);margin-top:.2rem;">Se guardarán en Google Drive al enviar</div>
    </div>
    <div class="photo-preview" id="prev-${groupId}"></div>
  </div>`;
}

export function handlePhotoUpload(event, groupId) {
  const files   = Array.from(event.target.files);
  event.target.value = ''; // permite volver a elegir el mismo archivo (ej: sacarla de nuevo) sin que se ignore
  const preview = document.getElementById('prev-' + groupId);
  files.forEach(async (file, idx) => {
    const id   = `${groupId}-${Date.now()}-${idx}`;
    const blob = await _compressImage(file);
    const previewUrl = URL.createObjectURL(blob);

    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';
    thumb.id        = 'thumb-' + id;
    thumb.innerHTML = `<img src="${previewUrl}"><button onclick="removePhoto('${id}','${groupId}')">×</button>`;
    preview.appendChild(thumb);

    if (!window._photos) window._photos = {};
    if (!window._photos[groupId]) window._photos[groupId] = [];
    window._photos[groupId].push({ id, name: file.name || `${id}.jpg`, blob, previewUrl });
  });
}

export function removePhoto(id, groupId) {
  const entry = window._photos?.[groupId]?.find(p => p.id === id);
  if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  document.getElementById('thumb-' + id)?.remove();
  if (window._photos?.[groupId]) {
    window._photos[groupId] = window._photos[groupId].filter(p => p.id !== id);
  }
}

// Descarta las fotos pendientes de un grupo — se usa al abrir un formulario nuevo para no
// arrastrar fotos de una carga anterior que reutiliza el mismo groupId (ej: 'food-photos'
// es compartido por los 5 formularios de Producción de Alimentos).
export function clearPhotoGroup(groupId) {
  (window._photos?.[groupId] || []).forEach(p => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
  if (window._photos) window._photos[groupId] = [];
  const el = document.getElementById('prev-' + groupId);
  if (el) el.innerHTML = '';
}

// Sube todas las fotos pendientes de un grupo a Google Drive vía el Worker y devuelve el
// array de URLs públicas resultante (mismo orden en que se agregaron). Limpia el grupo al
// terminar. Si falla una subida, lanza el error y deja el resto de las fotos sin subir
// (el caller debe mostrar el error y dejar que el usuario reintente el envío).
export async function uploadPhotoGroup(groupId, department, recordType, recordDate) {
  const photos = window._photos?.[groupId] || [];
  if (!photos.length) return [];

  const urls = [];
  for (const photo of photos) {
    const fd = new FormData();
    fd.append('file', photo.blob, photo.name);
    fd.append('department', department);
    fd.append('record_type', recordType);
    fd.append('record_date', recordDate || new Date().toISOString().slice(0, 10));

    const res = await fetch(`${API}/api/photos/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.accessToken}` },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Error al subir foto: ${res.status}`);
    urls.push(data.url);
  }

  clearPhotoGroup(groupId);
  return urls;
}
