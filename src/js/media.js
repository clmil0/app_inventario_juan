// Fotos y videos de productos y reparaciones. Todo se guarda en esta PC (servidor local → carpeta "media")
// y viaja en el backup; ya no se sube nada a la nube.
import { getSession, showToast } from './supabase.js';
import { esc, icon, openDrawer, closeDrawer, parseDate, fmtDay, fmtTime } from './ui.js';

export const MEDIA_ICONS = {
    camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    video: 'M23 7l-7 5 7 5V7zM3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    plus: 'M12 5v14M5 12h14',
    close: 'M18 6L6 18M6 6l12 12',
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
};
const play = (w = 9, fill = '#fff') => `<svg width="${w}" height="${Math.round(w * 8 / 7)}" viewBox="0 0 7 8" aria-hidden="true"><path d="M0 0l7 4-7 4z" fill="${fill}"></path></svg>`;

const MAX_IMAGE_SIDE = 1600;
const MAX_VIDEO_MB = 150;

export const fmtDuration = s => {
    if (!Number.isFinite(s) || s <= 0) return '';
    const m = Math.floor(s / 60), r = Math.round(s % 60);
    return `${m}:${String(r === 60 ? 59 : r).padStart(2, '0')}`;
};

export function mediaCountLabel(images, videos) {
    const parts = [];
    if (images) parts.push(`${images} foto${images === 1 ? '' : 's'}`);
    if (videos) parts.push(`${videos} video${videos === 1 ? '' : 's'}`);
    return parts.join(' · ') || 'Sin fotos ni videos';
}

// ─── API ───────────────────────────────────
export async function fetchMediaSummary(type) {
    try {
        const res = await fetch(`/api/media/summary?owner_type=${type}`);
        return res.ok ? await res.json() : {};
    } catch { return {}; }
}

export async function fetchMedia(type, ids) {
    const list = [].concat(ids).filter(Boolean);
    if (!list.length) return [];
    const res = await fetch(`/api/media?owner_type=${type}&owner_id=${list.join(',')}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudieron cargar las fotos');
    return data;
}

// Junta los resúmenes de varias reparaciones de un mismo ticket
export function mergeSummaries(summary, ids) {
    const out = { n: 0, images: 0, videos: 0, items: [] };
    ids.forEach(id => {
        const s = summary?.[id]; if (!s) return;
        out.n += s.n; out.images += s.images; out.videos += s.videos;
        out.items.push(...s.items);
    });
    out.items = out.items.slice(0, 3);
    return out;
}

// ─── Miniaturas para tablas y tarjetas ─────
const thumbStyle = it => it.kind === 'video' ? '' : `background-image:url('${esc(it.src)}')`;

// Fila de miniaturas (tablero/lista de reparaciones). addAttrs: atributos del botón "+" (data-*)
export function mediaStripHtml(sum, { size = 34, addAttrs = '', addIcon = 'camera', dark = false } = {}) {
    const items = sum?.items || [];
    const more = Math.max(0, (sum?.n || 0) - items.length);
    const thumbs = items.map((it, i) => `<span class="md-th ${it.kind === 'video' ? 'vid' : ''}" data-media-open="${i}" style="width:${size}px;height:${size}px;${thumbStyle(it)}" title="${it.kind === 'video' ? 'Ver video' : 'Ver foto'}">${it.kind === 'video' ? play(size > 32 ? 9 : 8) : ''}</span>`).join('');
    const add = addAttrs ? `<span class="md-add ${dark ? 'dark' : ''}" role="button" tabindex="0" title="Agregar foto o video" ${addAttrs} style="width:${size}px;height:${size}px">${icon(MEDIA_ICONS[addIcon], size > 32 ? 15 : 14, addIcon === 'plus' ? 2.2 : 2)}</span>` : '';
    return `<span class="md-strip">${thumbs}${more ? `<span class="md-more">+${more}</span>` : ''}${add}</span>`;
}

// Celda de portada (Administración / Inventario): portada + contador, o botón punteado para agregar
export function mediaCoverCellHtml(sum, { size = 46, attrs = '', muted = false } = {}) {
    if (!sum || !sum.n) {
        return `<button type="button" class="md-cover-add" title="Agregar foto" ${attrs} style="width:${size}px;height:${size}px">${icon(MEDIA_ICONS.camera, 16, 2)}</button>`;
    }
    const first = sum.items[0];
    return `<button type="button" class="md-cover ${first.kind === 'video' ? 'vid' : ''} ${muted ? 'muted' : ''}" title="${esc(mediaCountLabel(sum.images, sum.videos))}" ${attrs} style="width:${size}px;height:${size}px;${thumbStyle(first)}">
        ${first.kind === 'video' ? play(10) : sum.videos ? `<span class="md-vdot">${play(7)}</span>` : ''}
        <span class="md-count">${sum.n}</span>
    </button>`;
}

// ─── Preparar archivos (comprimir fotos, leer duración de videos) ───
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo leer la imagen'));
        img.src = url;
    });
}

function videoDuration(file) {
    return new Promise(resolve => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        const done = d => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : null); };
        v.onloadedmetadata = () => {
            // Los webm grabados en el navegador reportan Infinity hasta que se busca el final
            if (v.duration === Infinity) {
                v.ontimeupdate = () => { v.ontimeupdate = null; done(v.duration); };
                v.currentTime = 1e7;
            } else done(v.duration);
        };
        v.onerror = () => done(null);
        setTimeout(() => done(null), 5000);
        v.src = url;
    });
}

async function prepareFile(file) {
    const type = (file.type || '').toLowerCase();
    if (type.startsWith('video/')) {
        if (file.size > MAX_VIDEO_MB * 1048576) throw new Error(`"${file.name}" pesa más de ${MAX_VIDEO_MB} MB`);
        return { blob: file, mime: type, duration: await videoDuration(file) };
    }
    if (!type.startsWith('image/')) throw new Error(`"${file.name}" no es una foto ni un video`);
    if (type === 'image/gif') return { blob: file, mime: type };
    const url = URL.createObjectURL(file);
    try {
        const img = await loadImage(url);
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
        // Si comprimir no ayuda (foto ya pequeña) se guarda la original
        if (blob && blob.size < file.size) return { blob, mime: 'image/jpeg' };
        return { blob: file, mime: type };
    } catch {
        // Formato que el navegador no sabe dibujar (ej. HEIC): se guarda tal cual
        return { blob: file, mime: type };
    } finally {
        URL.revokeObjectURL(url);
    }
}

// ─── Indicador de guardado ─────────────────
function loader() {
    const modal = document.getElementById('upload-loader-modal');
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    return {
        show(file, label) {
            const thumb = document.getElementById('upload-thumb');
            if (thumb) {
                thumb.style.backgroundImage = '';
                thumb.innerHTML = '';
                if ((file.type || '').startsWith('image/')) {
                    const u = URL.createObjectURL(file);
                    thumb.style.backgroundImage = `url('${u}')`;
                    setTimeout(() => URL.revokeObjectURL(u), 30000);
                } else thumb.innerHTML = `<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center">${play(12)}</span>`;
            }
            set('upload-title', (file.type || '').startsWith('video/') ? 'Guardando video…' : 'Guardando foto…');
            set('upload-meta', [label, file.name, `${(file.size / 1048576).toFixed(1)} MB`].filter(Boolean).join(' · '));
            this.progress(4, 'Preparando');
            modal?.classList.remove('hidden');
        },
        progress(pct, step) {
            const bar = document.getElementById('upload-bar'); if (bar) bar.style.width = `${pct}%`;
            set('upload-pct', `${Math.round(pct)}%`);
            if (step) set('upload-step', step);
        },
        hide() { modal?.classList.add('hidden'); }
    };
}

function sendFile(type, ownerId, prepared, onProgress) {
    const q = new URLSearchParams({ owner_type: type, owner_id: ownerId, by: getSession()?.profile?.username || '' });
    if (prepared.duration) q.set('duration', prepared.duration.toFixed(2));
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/media/upload?${q}`);
        xhr.setRequestHeader('Content-Type', prepared.mime || 'application/octet-stream');
        xhr.upload.onprogress = ev => { if (ev.lengthComputable) onProgress(ev.loaded / ev.total); };
        xhr.onload = () => {
            let data = {};
            try { data = JSON.parse(xhr.responseText); } catch { /* respuesta vacía */ }
            xhr.status >= 200 && xhr.status < 300 ? resolve(data) : reject(new Error(data.error || `Error ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('No se pudo guardar el archivo'));
        xhr.send(prepared.blob);
    });
}

// Guarda uno o varios archivos en orden. Devuelve cuántos se guardaron.
export async function saveMediaFiles(type, ownerId, files, { label = '' } = {}) {
    const list = [...(files || [])].filter(Boolean);
    if (!list.length) return 0;
    const ld = loader();
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const tag = list.length > 1 ? `${i + 1}/${list.length}` : '';
        ld.show(file, [label, tag].filter(Boolean).join(' · '));
        try {
            const prepared = await prepareFile(file);
            ld.progress(20, 'Guardando en esta PC');
            await sendFile(type, ownerId, prepared, p => ld.progress(20 + p * 78));
            ld.progress(100, 'Listo');
            ok++;
        } catch (e) {
            console.error(e);
            showToast(e.message || 'No se pudo guardar el archivo', 'error');
        }
    }
    ld.hide();
    if (ok) showToast(ok === 1 ? (list[0].type.startsWith('video/') ? 'Video guardado' : 'Foto guardada') : `${ok} archivos guardados`, 'success');
    return ok;
}

// ─── Elegir archivos / cámara ──────────────
function pickFiles({ accept = 'image/*,video/*', capture = null, multiple = true } = {}) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.multiple = multiple;
        if (capture) input.setAttribute('capture', capture);
        input.style.display = 'none';
        let settled = false;
        const finish = files => { if (settled) return; settled = true; input.remove(); resolve(files); };
        input.addEventListener('change', () => finish([...(input.files || [])]));
        input.addEventListener('cancel', () => finish([]));
        document.body.appendChild(input);
        input.click();
    });
}

const RECORDER_TYPES = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

// Cámara de la PC (webcam) o del celular. Si no hay cámara disponible se abre el selector de archivos.
async function captureFromCamera(mode) {
    const fallback = () => pickFiles({ accept: mode === 'video' ? 'video/*' : 'image/*', capture: 'environment', multiple: false });
    if (!navigator.mediaDevices?.getUserMedia) return fallback();
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: mode === 'video' });
    } catch (e) {
        if (mode === 'video') {
            // Sin micrófono: grabar solo imagen
            try { stream = await navigator.mediaDevices.getUserMedia({ video: true }); } catch { /* sin cámara */ }
        }
        if (!stream) {
            showToast('No se encontró una cámara: elige un archivo', 'info');
            return fallback();
        }
    }

    return new Promise(resolve => {
        const host = document.createElement('div');
        host.className = 'md-cam';
        host.innerHTML = `<div class="md-cam-top"><span>${mode === 'video' ? 'Grabar video' : 'Tomar foto'}</span><span class="md-cam-timer hidden" id="md-cam-timer"><i></i>0:00</span><button class="pv-btn white" data-cam="cancel" aria-label="Cancelar">${icon(MEDIA_ICONS.close, 14, 2.2)}</button></div>
            <div class="md-cam-stage"><video autoplay muted playsinline></video></div>
            <div class="md-cam-bar"><button class="md-cam-shoot ${mode === 'video' ? 'rec' : ''}" data-cam="shoot" aria-label="${mode === 'video' ? 'Grabar' : 'Capturar'}"><span></span></button></div>`;
        document.body.appendChild(host);
        const video = host.querySelector('video');
        video.srcObject = stream;
        let recorder = null, chunks = [], timer = null, t0 = 0;

        const cleanup = file => {
            clearInterval(timer);
            stream.getTracks().forEach(t => t.stop());
            document.removeEventListener('keydown', onKey, true);
            host.remove();
            resolve(file ? [file] : []);
        };
        const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); if (recorder?.state === 'recording') { recorder.onstop = () => cleanup(null); recorder.stop(); } else cleanup(null); } };
        document.addEventListener('keydown', onKey, true);
        host.querySelector('[data-cam="cancel"]').addEventListener('click', () => onKey({ key: 'Escape', stopPropagation() {} }));

        host.querySelector('[data-cam="shoot"]').addEventListener('click', e => {
            const btn = e.currentTarget;
            if (mode === 'photo') {
                const c = document.createElement('canvas');
                c.width = video.videoWidth; c.height = video.videoHeight;
                if (!c.width) return;
                c.getContext('2d').drawImage(video, 0, 0);
                host.classList.add('flash');
                c.toBlob(b => cleanup(b ? new File([b], `foto_${Date.now()}.jpg`, { type: 'image/jpeg' }) : null), 'image/jpeg', 0.9);
                return;
            }
            if (recorder?.state === 'recording') { recorder.stop(); return; }
            const mimeType = RECORDER_TYPES.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
            try { recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); } catch { showToast('Este equipo no puede grabar video', 'error'); return; }
            chunks = [];
            recorder.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
            recorder.onstop = () => {
                const type = (recorder.mimeType || 'video/webm').split(';')[0];
                const blob = new Blob(chunks, { type });
                cleanup(blob.size ? new File([blob], `video_${Date.now()}.${type === 'video/mp4' ? 'mp4' : 'webm'}`, { type }) : null);
            };
            recorder.start(1000);
            btn.classList.add('on');
            const tm = host.querySelector('#md-cam-timer');
            tm.classList.remove('hidden');
            t0 = Date.now();
            timer = setInterval(() => { tm.lastChild.textContent = fmtDuration((Date.now() - t0) / 1000) || '0:00'; }, 250);
        });
    });
}

export async function addMediaFrom(source, type, ownerId, label) {
    const files = source === 'photo' ? await captureFromCamera('photo')
        : source === 'video' ? await captureFromCamera('video')
        : await pickFiles({ multiple: true });
    return saveMediaFiles(type, ownerId, files, { label });
}

// ─── Menú rápido (tarjeta / fila de reparación) ───
let menuEl = null;
function closeMediaMenu() {
    if (!menuEl) return;
    menuEl.remove(); menuEl = null;
    document.removeEventListener('pointerdown', onMenuOutside, true);
    document.removeEventListener('keydown', onMenuKey, true);
}
function onMenuOutside(e) { if (menuEl && !menuEl.contains(e.target)) closeMediaMenu(); }
function onMenuKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeMediaMenu(); } }

export function openMediaMenu(anchor, { type, ownerId, label = '', onChange } = {}) {
    closeMediaMenu();
    const m = document.createElement('div');
    m.className = 'md-menu';
    m.innerHTML = `${label ? `<span class="md-menu-label">${esc(label)}</span>` : ''}
        <button type="button" data-src="photo">${icon(MEDIA_ICONS.camera, 16, 2)}Tomar foto</button>
        <button type="button" data-src="video">${icon(MEDIA_ICONS.video, 16, 2)}Grabar video</button>
        <button type="button" data-src="files">${icon(MEDIA_ICONS.upload, 16, 2)}Elegir de galería</button>`;
    document.body.appendChild(m);
    menuEl = m;
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth, h = m.offsetHeight;
    let left = Math.min(window.innerWidth - w - 12, Math.max(12, r.left));
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
    m.style.left = `${left}px`; m.style.top = `${top}px`;
    m.querySelector('button')?.focus();
    m.addEventListener('click', async e => {
        const b = e.target.closest('[data-src]'); if (!b) return;
        closeMediaMenu();
        const n = await addMediaFrom(b.dataset.src, type, ownerId, label);
        if (n && onChange) onChange();
    });
    setTimeout(() => {
        document.addEventListener('pointerdown', onMenuOutside, true);
        document.addEventListener('keydown', onMenuKey, true);
    });
}

// ─── Visor a pantalla completa (fotos y videos) ───
let viewer = { items: [], idx: 0, title: '' };

export function openMediaViewer(items, idx = 0, title = '') {
    if (!items?.length) return;
    viewer = { items, idx: (idx + items.length) % items.length, title };
    renderViewer();
    document.getElementById('photo-preview-modal')?.classList.remove('hidden');
}

// Fotos/videos verticales (celular): los botones se acercan a la imagen en vez de quedar en las
// esquinas de la pantalla. Las horizontales quedan como estaban.
function fitViewer() {
    const shell = document.querySelector('#photo-preview-modal .pv-shell');
    if (!shell) return;
    const img = document.getElementById('photo-preview-img');
    const vid = document.getElementById('photo-preview-video');
    const el = vid && vid.style.display !== 'none' ? vid : img;
    const w = el === vid ? vid.videoWidth : img?.naturalWidth;
    const h = el === vid ? vid.videoHeight : img?.naturalHeight;
    const portrait = !!(w && h && h > w);
    shell.classList.toggle('portrait', portrait);
    if (portrait) shell.style.setProperty('--pv-w', `${Math.round(el.getBoundingClientRect().width)}px`);
}

function renderViewer() {
    const { items, idx, title } = viewer;
    const it = items[idx];
    const img = document.getElementById('photo-preview-img');
    const vid = document.getElementById('photo-preview-video');
    const isVid = it.kind === 'video';
    if (vid) {
        vid.pause();
        vid.style.display = isVid ? '' : 'none';
        if (isVid) { vid.src = it.src; vid.play().catch(() => {}); } else vid.removeAttribute('src');
    }
    if (img) { img.style.display = isVid ? 'none' : ''; if (!isVid) img.src = it.src; }
    fitViewer();
    const dl = document.getElementById('photo-preview-dl');
    if (dl) { dl.href = it.src; dl.setAttribute('download', it.file_name || ''); }
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('pv-title', title || (isVid ? 'Video' : 'Foto'));
    const d = parseDate(it.created_at);
    set('pv-meta', `${idx + 1} de ${items.length}${isVid && it.duration ? ` · ${fmtDuration(it.duration)}` : ''}${d ? ` · ${fmtDay(d)}, ${fmtTime(d)}` : ''}`);
    const many = items.length > 1;
    ['pv-prev', 'pv-next'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = many ? '' : 'none'; });
    const dots = document.getElementById('pv-dots');
    if (dots) dots.innerHTML = many && items.length <= 20 ? items.map((_, k) => `<span class="${k === idx ? 'on' : ''}"></span>`).join('') : '';
}

if (!window._mediaViewerBound) {
    window._mediaViewerBound = true;
    document.getElementById('photo-preview-img')?.addEventListener('load', fitViewer);
    document.getElementById('photo-preview-video')?.addEventListener('loadedmetadata', fitViewer);
    window.addEventListener('resize', fitViewer);
    const step = d => { if (!viewer.items.length) return; viewer.idx = (viewer.idx + d + viewer.items.length) % viewer.items.length; renderViewer(); };
    document.getElementById('pv-prev')?.addEventListener('click', () => step(-1));
    document.getElementById('pv-next')?.addEventListener('click', () => step(1));
    document.addEventListener('keydown', e => {
        if (document.getElementById('photo-preview-modal')?.classList.contains('hidden')) return;
        if (e.key === 'ArrowLeft') step(-1);
        if (e.key === 'ArrowRight') step(1);
    });
    // Al cerrar el visor, que el video deje de sonar
    new MutationObserver(() => {
        const modal = document.getElementById('photo-preview-modal');
        if (modal?.classList.contains('hidden')) document.getElementById('photo-preview-video')?.pause();
    }).observe(document.getElementById('photo-preview-modal') || document.body, { attributes: true, attributeFilter: ['class'] });
}

// Abre el visor con la galería completa de uno o varios dueños
export async function viewOwnerMedia(type, ids, idx = 0, title = '') {
    try {
        const items = await fetchMedia(type, ids);
        openMediaViewer(items, idx, title);
    } catch (e) { showToast(e.message, 'error'); }
}

// ─── Galería (drawer): ver, agregar, ordenar, portada y quitar ───
export async function openMediaGallery({ type, ownerId, ownerIds = null, title = '', meta = '', badgeHtml = '', note = '', onChange } = {}) {
    const ids = ownerIds || [ownerId];
    let items = [], original = '', selected = 0, changed = false;
    const sig = () => items.map(i => i.id).join(',');

    const drawer = openDrawer(`
        <div class="md-head">
            <div class="row"><span class="meta">${esc(meta)}</span><button class="md-x" data-drawer-close aria-label="Cerrar">${icon(MEDIA_ICONS.close, 14, 2.2)}</button></div>
            <span class="title">${esc(title)}</span>
            ${badgeHtml ? `<div class="badges">${badgeHtml}</div>` : ''}
        </div>
        <div class="md-body">
            <div class="md-sec"><span>Fotos y videos</span><small id="md-counts"></small></div>
            <div class="md-stage" id="md-stage"></div>
            <div class="md-grid" id="md-grid"></div>
            <div class="md-drop" id="md-drop">
                <span class="ic">${icon(MEDIA_ICONS.upload, 18, 2)}</span>
                <span class="t">Arrastra fotos o videos aquí</span>
                <div class="btns">
                    <button type="button" class="md-btn" data-src="photo">${icon(MEDIA_ICONS.camera, 14, 2)}Tomar foto</button>
                    <button type="button" class="md-btn" data-src="video">${icon(MEDIA_ICONS.video, 14, 2)}Grabar video</button>
                    <button type="button" class="md-btn" data-src="files">Elegir archivos</button>
                </div>
            </div>
            <span class="md-note">${esc(note || 'Arrastra las miniaturas para ordenar. La primera es la portada.')}</span>
        </div>
        <div class="md-foot">
            <button type="button" class="ui-pill outline" data-drawer-close>Cerrar</button>
            <button type="button" class="ui-pill" id="md-save">Guardar cambios</button>
        </div>`, { onClose: () => { if (changed && onChange) onChange(); } });
    drawer.classList.add('md-drawer');

    const $ = s => drawer.querySelector(s);

    async function reload(keepSel = true) {
        try {
            items = await fetchMedia(type, ids);
        } catch (e) { showToast(e.message, 'error'); items = []; }
        original = sig();
        if (!keepSel || selected >= items.length) selected = 0;
        render();
    }

    function renderStage() {
        const st = $('#md-stage');
        const it = items[selected];
        if (!it) {
            st.className = 'md-stage empty';
            st.innerHTML = `<span>Aún no hay fotos ni videos</span>`;
            return;
        }
        st.className = 'md-stage';
        st.innerHTML = it.kind === 'video'
            ? `<video src="${esc(it.src)}" controls preload="metadata" playsinline></video>`
            : `<img src="${esc(it.src)}" alt="" data-full="1">`;
        if (selected === 0) st.insertAdjacentHTML('beforeend', '<span class="md-cover-tag">Portada</span>');
        st.querySelector('[data-full]')?.addEventListener('click', () => openMediaViewer(items, selected, title));
    }

    function render() {
        const imgs = items.filter(i => i.kind !== 'video').length;
        $('#md-counts').textContent = mediaCountLabel(imgs, items.length - imgs);
        renderStage();
        $('#md-grid').innerHTML = items.map((it, i) => `
            <div class="md-tile ${it.kind === 'video' ? 'vid' : ''} ${i === selected ? 'sel' : ''}" draggable="true" data-i="${i}" style="${it.kind === 'video' ? '' : `background-image:url('${esc(it.src)}')`}">
                ${it.kind === 'video' ? `<span class="play">${play(12, '#17171a')}</span><span class="dur">${fmtDuration(it.duration) || 'Video'}</span><span class="tag">Video</span>` : `<span class="num">${i + 1}</span>`}
                ${i > 0 ? `<button type="button" class="star" data-cover="${i}" title="Usar como portada">${icon(MEDIA_ICONS.star, 13, 1.8)}</button>` : ''}
                <button type="button" class="del" data-del="${i}" title="Quitar">${icon(MEDIA_ICONS.close, 11, 2.4)}</button>
            </div>`).join('');
        $('#md-save').disabled = sig() === original;
    }

    // Selección, portada y borrado
    $('#md-grid').addEventListener('click', async e => {
        const cover = e.target.closest('[data-cover]');
        const del = e.target.closest('[data-del]');
        const tile = e.target.closest('[data-i]');
        if (cover) {
            const i = parseInt(cover.dataset.cover);
            items.unshift(items.splice(i, 1)[0]);
            selected = 0;
            render();
            return;
        }
        if (del) {
            const it = items[parseInt(del.dataset.del)];
            if (!confirm(`¿Quitar ${it.kind === 'video' ? 'este video' : 'esta foto'}? Se borra de esta PC.`)) return;
            const res = await fetch(`/api/media/${encodeURIComponent(it.id)}`, { method: 'DELETE' });
            if (!res.ok) { showToast('No se pudo quitar', 'error'); return; }
            changed = true;
            const pending = sig() !== original ? items.filter(x => x.id !== it.id).map(x => x.id) : null;
            await reload();
            if (pending) { // conservar un orden que aún no se guardó
                items.sort((a, b) => pending.indexOf(a.id) - pending.indexOf(b.id));
                render();
            }
            return;
        }
        if (tile) { selected = parseInt(tile.dataset.i); render(); }
    });

    // Ordenar arrastrando
    let dragFrom = null;
    const grid = $('#md-grid');
    grid.addEventListener('dragstart', e => {
        const t = e.target.closest('[data-i]'); if (!t) return;
        dragFrom = parseInt(t.dataset.i);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-md', String(dragFrom));
        t.classList.add('dragging');
    });
    grid.addEventListener('dragend', () => { dragFrom = null; grid.querySelectorAll('.over,.dragging').forEach(x => x.classList.remove('over', 'dragging')); });
    grid.addEventListener('dragover', e => {
        if (dragFrom === null) return;
        e.preventDefault();
        grid.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
        e.target.closest('[data-i]')?.classList.add('over');
    });
    grid.addEventListener('drop', e => {
        if (dragFrom === null) return;
        e.preventDefault(); e.stopPropagation();
        const t = e.target.closest('[data-i]'); if (!t) return;
        const to = parseInt(t.dataset.i);
        if (to === dragFrom) return;
        const selId = items[selected]?.id;
        const [moved] = items.splice(dragFrom, 1);
        items.splice(to, 0, moved);
        selected = Math.max(0, items.findIndex(x => x.id === selId));
        dragFrom = null;
        render();
    });

    // Agregar
    const add = async files => {
        const n = await saveMediaFiles(type, ownerId, files, { label: title });
        if (!n) return;
        changed = true;
        const pending = sig() !== original ? items.map(x => x.id) : null;
        await reload();
        if (pending) { items.sort((a, b) => (pending.indexOf(a.id) + 1 || 1e9) - (pending.indexOf(b.id) + 1 || 1e9)); render(); }
    };
    drawer.querySelectorAll('.md-drop [data-src]').forEach(b => b.addEventListener('click', async () => {
        const src = b.dataset.src;
        const files = src === 'photo' ? await captureFromCamera('photo') : src === 'video' ? await captureFromCamera('video') : await pickFiles({ multiple: true });
        add(files);
    }));
    const drop = $('#md-drop');
    drawer.addEventListener('dragover', e => { if (dragFrom === null && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
    drawer.addEventListener('dragleave', e => { if (!drawer.contains(e.relatedTarget)) drop.classList.remove('over'); });
    drawer.addEventListener('drop', e => {
        if (dragFrom !== null || !e.dataTransfer?.files?.length) return;
        e.preventDefault();
        drop.classList.remove('over');
        add([...e.dataTransfer.files]);
    });

    // Guardar orden (por dueño: un ticket puede tener varias reparaciones)
    $('#md-save').addEventListener('click', async () => {
        if (sig() === original) { closeDrawer(); return; }
        const btn = $('#md-save');
        btn.disabled = true;
        try {
            for (const id of ids) {
                const own = items.filter(x => x.owner_id === id).map(x => x.id);
                if (!own.length) continue;
                const res = await fetch('/api/media/order', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner_type: type, owner_id: id, ids: own }) });
                if (!res.ok) throw new Error();
            }
            changed = true;
            showToast('Orden guardado', 'success');
            closeDrawer();
        } catch {
            showToast('No se pudo guardar el orden', 'error');
            btn.disabled = false;
        }
    });

    await reload(false);
    return drawer;
}
