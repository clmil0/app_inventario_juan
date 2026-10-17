// Inventario: valor del stock, mezcla por categoría, niveles de stock y movimientos recientes.
import { safeAdd, safeMultiply } from './math.js';
import { esc, money, icon, parseDate, fmtDay, fmtTime, smoothPath, stagger, countTo } from './ui.js';
import { bindProductModals, setAdminProducts, openNewProductModal, openAddStock, openEditProduct } from './admin.js';

let products = [], categories = [], audit = [], raw = null;
let tab = 'todos', query = '', lastTouched = null;
const CAT_COLORS = ['#f0c132', '#2b4f9e', '#c9bfae', '#17171a', '#d6451b', '#8fb0ff', '#b9b3a8', '#e9a58f'];

const statusOf = p => (parseInt(p.stock) || 0) === 0 ? 'out' : (parseInt(p.stock) || 0) <= (parseInt(p.min_stock) || 0) ? 'low' : 'ok';

export async function loadInventoryView(intent = null) {
    tab = intent?.tab || 'todos';
    query = '';
    bindProductModals();
    await loadData();
    bindEvents();
    renderAll(true);
}

async function loadData() {
    const [p, c, a, r] = await Promise.all([
        fetch('/api/products').then(x => x.json()).catch(() => []),
        fetch('/api/products/categories').then(x => x.json()).catch(() => []),
        fetch('/api/admin/stock/audit').then(x => x.json()).catch(() => []),
        fetch('/api/dashboard/raw').then(x => x.json()).catch(() => null)
    ]);
    products = p || []; categories = c || []; audit = a || []; raw = r;
    setAdminProducts(products);
}

function bindEvents() {
    document.querySelectorAll('#inv-tabs [data-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
        btn.addEventListener('click', () => {
            tab = btn.dataset.tab;
            document.querySelectorAll('#inv-tabs [data-tab]').forEach(b => b.classList.toggle('active', b === btn));
            renderRows(true);
        });
    });
    document.getElementById('inv-search')?.addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); renderRows(true); });
    document.getElementById('inv-new-product')?.addEventListener('click', openNewProductModal);
    document.getElementById('inv-go-audit')?.addEventListener('click', () => window.navigateTo?.('admin', { tab: 'admin-audit' }));
}

function isInventoryActive() { return !!document.querySelector('.inventory-view'); }

// Cambios hechos desde los modales (stock, edición, producto nuevo)
window.addEventListener('products:changed', async () => {
    if (!isInventoryActive()) return;
    await loadData();
    renderAll(false);
    if (lastTouched) {
        const row = document.querySelector(`#inv-rows [data-pid="${lastTouched}"]`);
        row?.animate && row.animate([{ background: 'rgba(240,193,50,.35)' }, { background: 'rgba(240,193,50,0)' }], { duration: 1100 });
        const mv = document.querySelector('#inv-moves > *');
        mv?.animate && mv.animate([{ opacity: 0, transform: 'translateY(-16px)' }, { opacity: 1, transform: 'none' }], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
});
window.addEventListener('product:created', e => { lastTouched = e.detail?.id || null; if (isInventoryActive()) { tab = 'todos'; document.querySelectorAll('#inv-tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === 'todos')); } });

function renderAll(first) {
    renderCounts();
    renderKpis();
    renderChart(first);
    renderCategories();
    renderRows(first);
    renderMoves();
}

function renderCounts() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('inv-n-todos', products.length);
    set('inv-n-bajo', products.filter(p => statusOf(p) === 'low').length);
    set('inv-n-agotado', products.filter(p => statusOf(p) === 'out').length);
}

function totals() {
    let inv = 0, sale = 0, units = 0;
    products.forEach(p => {
        const st = Math.max(0, parseInt(p.stock) || 0);
        inv = safeAdd(inv, safeMultiply(parseFloat(p.cost_price) || 0, st));
        sale = safeAdd(sale, safeMultiply(parseFloat(p.sale_price) || 0, st));
        units += st;
    });
    return { inv, sale, units };
}

function renderKpis() {
    const host = document.getElementById('inv-kpis'); if (!host) return;
    const { inv, sale, units } = totals();
    const margin = sale > 0 ? Math.round((sale - inv) / sale * 100) : 0;
    const k = [
        { i: 'wallet', id: 'inv-k1', v: inv, f: v => money(v, 0), l: 'Inversión a costo' },
        { i: 'M12 20V10M18 20V4M6 20v-4', id: 'inv-k2', v: sale, f: v => money(v, 0), l: 'Valor a precio de venta' },
        { i: 'trophy', id: 'inv-k3', v: sale - inv, f: v => money(v, 0), l: 'Ganancia potencial', badge: `${margin}% margen` },
        { i: 'box', id: 'inv-k4', v: units, f: v => String(Math.round(v)), l: `Unidades en ${products.length} productos` }
    ];
    if (!host.children.length) {
        host.innerHTML = k.map(x => `<div class="ui-kpi" data-anim="1"><div class="ui-kpi-icon">${icon(x.i, 19, 1.9)}</div>
            <div class="ui-kpi-body"><span class="ui-kpi-row"><span class="ui-kpi-value" id="${x.id}">0</span>${x.badge ? `<span class="ui-badge" id="${x.id}-b">${x.badge}</span>` : ''}</span><span class="ui-kpi-label" id="${x.id}-l">${x.l}</span></div></div>`).join('');
        stagger(host.children, 100, 70);
    }
    k.forEach(x => {
        countTo(document.getElementById(x.id), x.v, x.f);
        const l = document.getElementById(x.id + '-l'); if (l) l.textContent = x.l;
        const b = document.getElementById(x.id + '-b'); if (b && x.badge) b.textContent = x.badge;
    });
}

// Reconstruye el valor del inventario día a día hacia atrás usando la auditoría y las revalorizaciones
function inventorySeries() {
    const days = [];
    for (let i = 14; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push(d); }
    const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const state = {};
    (raw?.productos || products).forEach(p => { state[p.id] = { stock: parseInt(p.stock) || 0, cost: parseFloat(p.cost_price) || 0 }; });
    const events = [];
    (raw?.auditoriaStock || []).forEach(a => events.push({ t: 'a', id: a.product_id, q: parseInt(a.quantity_change) || 0, d: parseDate(a.created_at) }));
    (raw?.revalorizaciones || []).forEach(r => events.push({ t: 'r', id: r.product_id, old: parseFloat(r.old_cost_price) || 0, d: parseDate(r.created_at) }));
    const sorted = events.filter(e => e.d).sort((a, b) => b.d - a.d);
    const values = [];
    let idx = 0;
    [...days].reverse().forEach(day => {
        const k = key(day);
        while (idx < sorted.length && key(sorted[idx].d) > k) {
            const ev = sorted[idx], st = state[ev.id];
            if (st) { if (ev.t === 'a') st.stock -= ev.q; else st.cost = ev.old; }
            idx++;
        }
        values.unshift(Object.values(state).reduce((a, s) => a + Math.max(0, s.stock) * s.cost, 0));
    });
    return { days, values };
}

function renderChart(first) {
    const host = document.getElementById('inv-chart'); if (!host) return;
    const { days, values } = inventorySeries();
    const { inv } = totals();
    countTo(document.getElementById('inv-value'), inv, v => money(v, 0));
    const delta = inv - values[0];
    const sub = document.getElementById('inv-value-sub');
    if (sub) sub.textContent = `a precio de costo · ${delta >= 0 ? '+' : '−'}${money(Math.abs(delta), 0)} en 15 días`;

    const max = Math.max(...values), min = Math.min(...values);
    const pad = Math.max(1, (max - min) * .25);
    const hi = max + pad, lo = Math.max(0, min - pad * 1.5);
    const pts = values.map((v, i) => [i / (values.length - 1) * 1000, 190 - (v - lo) / Math.max(1, hi - lo) * 170]);
    const d = smoothPath(pts, 200);
    const labels = [0, 3, 6, 9, 12, 14].map(i => fmtDay(days[i]));
    host.innerHTML = `
        <svg class="inv-svg" viewBox="0 0 1000 200" preserveAspectRatio="none" width="100%" height="200" style="display:block;overflow:visible">
            <defs><linearGradient id="invGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"></stop><stop offset="1" stop-color="#fff" stop-opacity="0"></stop></linearGradient></defs>
            <line x1="0" x2="1000" y1="50" y2="50" stroke="rgba(255,255,255,.14)" stroke-dasharray="4 6" vector-effect="non-scaling-stroke"></line>
            <line x1="0" x2="1000" y1="120" y2="120" stroke="rgba(255,255,255,.14)" stroke-dasharray="4 6" vector-effect="non-scaling-stroke"></line>
            <path d="${d} L1000,200 L0,200 Z" fill="url(#invGrad)"></path>
            <path d="${d}" fill="none" stroke="#f0c132" stroke-width="2.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"></path>
        </svg>
        <div class="inv-xlabels">${labels.map(l => `<span>${l}</span>`).join('')}</div>`;
    const svg = host.querySelector('svg');
    if (first && svg.animate) svg.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 1500, delay: 300, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'backwards' });
}

function renderCategories() {
    const mix = document.getElementById('inv-cat-mix'), list = document.getElementById('inv-cat-list');
    if (!mix || !list) return;
    const byCat = new Map();
    products.forEach(p => {
        const k = p.category_id || 0;
        const v = safeMultiply(parseFloat(p.cost_price) || 0, Math.max(0, parseInt(p.stock) || 0));
        byCat.set(k, safeAdd(byCat.get(k) || 0, v));
    });
    const names = new Map(categories.map(c => [c.id, c.name]));
    const rows = [...byCat.entries()].map(([id, v], i) => ({ id, v, label: names.get(id) || 'Sin categoría' }))
        .sort((a, b) => b.v - a.v)
        .map((r, i) => ({ ...r, color: CAT_COLORS[i % CAT_COLORS.length] }));
    const total = rows.reduce((a, r) => a + r.v, 0) || 1;
    mix.innerHTML = rows.filter(r => r.v > 0).map(r => `<div style="flex:${r.v} 1 0;background:${r.color};border-radius:14px" title="${esc(r.label)}"></div>`).join('') || '<div style="flex:1;background:var(--fill)"></div>';
    mix.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { mix.style.width = '100%'; }));
    list.innerHTML = rows.map(r => `<div class="ui-list-row" style="grid-template-columns:10px 1fr auto 40px;padding:10px 0">
        <span class="ui-dot" style="background:${r.color}"></span><span>${esc(r.label)}</span><span class="tnum">${money(r.v, 0)}</span><span class="tnum" style="text-align:right;color:var(--muted)">${Math.round(r.v / total * 100)}%</span></div>`).join('')
        || '<div class="ui-empty">Sin productos</div>';
}

function renderRows(animate) {
    const host = document.getElementById('inv-rows'); if (!host) return;
    const names = new Map(categories.map(c => [c.id, c.name]));
    const rows = products.filter(p => {
        const st = statusOf(p);
        if (tab === 'bajo' && st !== 'low') return false;
        if (tab === 'agotado' && st !== 'out') return false;
        if (!query) return true;
        return `${p.name} ${p.code} ${p.brand} ${p.category_name || ''}`.toLowerCase().includes(query);
    }).sort((a, b) => tab === 'todos' ? (a.name || '').localeCompare(b.name || '') : (a.stock - a.min_stock) - (b.stock - b.min_stock));
    if (!rows.length) { host.innerHTML = `<div class="ui-empty">${tab === 'todos' ? 'No hay productos' : 'Nada por aquí: todo el stock está en orden'}</div>`; return; }
    host.innerHTML = rows.map(p => {
        const st = statusOf(p), stock = parseInt(p.stock) || 0, min = parseInt(p.min_stock) || 0;
        const w = Math.min(100, stock / Math.max(1, min * 3) * 100);
        const color = st === 'out' ? 'var(--orange)' : st === 'low' ? 'var(--yellow)' : 'var(--blue)';
        const tag = st === 'out' ? ['Agotado', 'var(--orange-ink)'] : st === 'low' ? ['Bajo', 'var(--yellow-ink)'] : ['OK', 'var(--muted)'];
        return `<div class="ui-tr" data-pid="${p.id}">
            <button class="inv-name" data-edit="${p.id}" title="Editar producto"><span class="ui-cell-2"><span>${esc(p.name)}</span><small>Cód. ${esc(p.code)} · ${esc(p.brand || 'General')}</small></span></button>
            <span class="muted ellipsis">${esc(p.category_name || names.get(p.category_id) || 'Sin categoría')}</span>
            <span class="r tnum muted">${money(p.cost_price)}</span>
            <span class="r tnum">${money(p.sale_price)}</span>
            <span class="inv-level"><span class="ui-bar md"><span style="width:0%;background:${color}" data-w="${w.toFixed(1)}"></span></span><span style="color:${tag[1]}">${tag[0]}</span></span>
            <span class="r tnum" style="font-weight:500">${stock}<span style="color:var(--dim);font-weight:400">/${min}</span></span>
            <button class="ui-icon-btn sm" data-add="${p.id}" title="Añadir stock">${icon('plus', 14, 2.2)}</button>
        </div>`;
    }).join('');
    host.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { lastTouched = parseInt(b.dataset.add); openAddStock(lastTouched); }));
    host.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { lastTouched = parseInt(b.dataset.edit); openEditProduct(lastTouched); }));
    requestAnimationFrame(() => requestAnimationFrame(() => host.querySelectorAll('[data-w]').forEach(b => b.style.width = b.dataset.w + '%')));
    if (animate) stagger(host.children, 0, 30, 600);
}

const MOVE_LABEL = { VENTA: 'Venta', USO_EN_REPARACION: 'Usado en reparación', INGRESO_PROVEEDOR: 'Ingreso', AJUSTE_MERMA: 'Merma / ajuste', DEVOLUCION_CLIENTE: 'Devolución' };

function renderMoves() {
    const host = document.getElementById('inv-moves'); if (!host) return;
    const sorted = [...audit].sort((a, b) => (parseDate(b.created_at) || 0) - (parseDate(a.created_at) || 0));
    const today = new Date().toDateString();
    const todays = sorted.filter(a => parseDate(a.created_at)?.toDateString() === today);
    const list = (todays.length ? todays : sorted).slice(0, 8);
    const when = document.getElementById('inv-moves-when');
    if (when) when.textContent = todays.length ? 'hoy' : 'recientes';
    host.innerHTML = list.map(a => {
        const q = parseInt(a.quantity_change) || 0;
        const cls = q > 0 ? 'in' : q < 0 ? 'out' : 'adj';
        const d = parseDate(a.created_at);
        const reason = (a.notes && a.movement_type === 'INGRESO_PROVEEDOR') ? a.notes : (MOVE_LABEL[a.movement_type] || 'Movimiento') + (a.reference_code ? ` ${a.reference_code}` : '');
        return `<div class="inv-move">
            <span class="q ${cls}">${q > 0 ? '+' : q < 0 ? '−' : '±'}${Math.abs(q)}</span>
            <div class="ui-cell-2" style="flex:1"><span>${esc(a.product_name)}</span><small>${esc(reason)} · ${esc(a.operator_name || 'Sistema')}</small></div>
            <span class="at">${todays.length ? fmtTime(d) : fmtDay(d)}</span>
        </div>`;
    }).join('') || '<div class="ui-empty" style="color:rgba(255,255,255,.55)">Sin movimientos registrados</div>';
}
