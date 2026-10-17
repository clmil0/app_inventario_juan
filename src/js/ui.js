// Utilidades compartidas del rediseño: iconos, formato, animaciones y drawer lateral.

export const ICONS = {
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
    plus: 'M12 5v14M5 12h14',
    arrow: 'M7 17L17 7M7 7h10v10',
    dots: 'M5 12h.01M12 12h.01M19 12h.01',
    close: 'M18 6L6 18M6 6l12 12',
    chevron: 'M6 9l6 6 6-6',
    left: 'M15 18l-6-6 6-6',
    right: 'M9 18l6-6-6-6',
    check: 'M20 6L9 17l-5-5',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    trophy: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2z',
    wallet: 'M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4M4 6v12c0 1.1.9 2 2 2h14v-4M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z',
    alert: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
    cash: 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 12h.01M18 12h.01',
    receipt: 'M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2-3-2zM8 8h8M8 12h8M8 16h5',
    dollar: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    ticket: 'M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1zM13 5v2M13 11v2M13 17v2',
    cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
    box: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
    phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01',
    send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
    print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
    trash: 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
    history: 'M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2',
    edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8',
    tools: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'
};

export function icon(name, size = 16, sw = 2, extra = '') {
    const d = ICONS[name] || name;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}><path d="${d}"></path></svg>`;
}

export function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function money(n, d = 2) {
    const v = Number(n) || 0;
    return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function shortMoney(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1000) return 'S/ ' + (v / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + 'k';
    return 'S/ ' + Math.round(v);
}

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Interpreta fechas de SQLite ('YYYY-MM-DD HH:MM:SS' en UTC) e ISO.
export function parseDate(v) {
    if (!v) return null;
    let s = v;
    if (typeof s === 'string' && !s.endsWith('Z') && !s.includes('T')) s = s.replace(' ', 'T') + 'Z';
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

export function fmtDay(v) {
    const d = v instanceof Date ? v : parseDate(v);
    if (!d) return '—';
    return `${String(d.getDate()).padStart(2, '0')} ${MES[d.getMonth()]}`;
}

export function fmtTime(v) {
    const d = v instanceof Date ? v : parseDate(v);
    if (!d) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const ease = t => 1 - Math.pow(1 - t, 4);

// Entrada escalonada (como el data-anim del diseño)
export function stagger(els, base = 0, step = 70, duration = 750) {
    [...els].forEach((el, i) => {
        if (!el || !el.animate) return;
        el.animate(
            [{ opacity: 0, transform: 'translateY(22px) scale(.98)' }, { opacity: 1, transform: 'none' }],
            { duration, delay: base + i * step, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }
        );
    });
}

export function animateView(root) {
    if (!root) return;
    stagger(root.querySelectorAll('[data-anim]'), 0, 70);
}

export function pulse(el) {
    if (!el || !el.animate) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.3,1.4,.5,1)' });
}

export function shake(el) {
    if (!el || !el.animate) return;
    el.animate([{ transform: 'none' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
}

// Contador animado de un número a otro (para KPIs)
export function countTo(el, to, fmtFn = v => String(Math.round(v)), duration = 1100) {
    if (!el) return;
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    const t0 = performance.now();
    cancelAnimationFrame(el._raf);
    const step = now => {
        const t = Math.min(1, (now - t0) / duration);
        el.textContent = fmtFn(from + (to - from) * ease(t));
        if (t < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
}

// Curva suave (Catmull-Rom → Bézier) para gráficos de línea en SVG
// maxY evita que la curva "rebote" por debajo de la línea base (valores negativos falsos)
export function smoothPath(points, maxY = Infinity) {
    if (!points.length) return '';
    const cy = y => Math.min(maxY, y);
    let d = `M${points[0][0]},${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] || p2;
        d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${cy(p1[1] + (p2[1] - p0[1]) / 6)} ${p2[0] - (p3[0] - p1[0]) / 6},${cy(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`;
    }
    return d;
}

// ═══ Drawer lateral (detalle de venta / reparación) ═══
let drawerState = null;

export function openDrawer(html, { onClose, width } = {}) {
    closeDrawer(true);
    const back = document.createElement('div');
    back.className = 'ui-backdrop';
    const drawer = document.createElement('aside');
    drawer.className = 'ui-drawer';
    if (width) drawer.style.width = width + 'px';
    drawer.innerHTML = html;
    back.addEventListener('click', () => closeDrawer());
    drawer.addEventListener('click', e => { if (e.target.closest('[data-drawer-close]')) closeDrawer(); });
    document.body.append(back, drawer);
    drawerState = { back, drawer, onClose };
    const onKey = e => { if (e.key === 'Escape') closeDrawer(); };
    document.addEventListener('keydown', onKey);
    drawerState.onKey = onKey;
    return drawer;
}

export function closeDrawer(instant = false) {
    if (!drawerState) return;
    const { back, drawer, onClose, onKey } = drawerState;
    drawerState = null;
    document.removeEventListener('keydown', onKey);
    if (instant) { back.remove(); drawer.remove(); onClose && onClose(); return; }
    back.classList.add('closing');
    drawer.classList.add('closing');
    setTimeout(() => { back.remove(); drawer.remove(); onClose && onClose(); }, 360);
}

export function currentDrawer() {
    return drawerState ? drawerState.drawer : null;
}
