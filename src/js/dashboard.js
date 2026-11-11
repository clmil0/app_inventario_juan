import { getSession, fmt } from './supabase.js';
import { safeAdd, safeMultiply, safeSubtract } from './math.js';
import { buildProfitEvents, filterEvents, sumBy, PAYMENT_METHODS } from './finance.js';
import { esc, money, shortMoney, parseDate, fmtDay, fmtTime, initials, countTo } from './ui.js';

// Se mantiene por compatibilidad con app.js (antes guardaba instancias de Chart.js)
export const chartInstances = [];

let dashData = { productos: [], ventas: [], itemsVenta: [], reparaciones: [] };
let currentPeriod = 'today';
let operatorIdx = 0, paymentIdx = 0;
let operators = ['all'];
const payments = ['all', ...PAYMENT_METHODS];
let chartMode = 'ing';
let topMode = 'g';
let chartModel = null;

export async function loadDashboard() {
    const session = getSession();
    if (!session) return;

    let rawData;
    try {
        const response = await fetch('/api/dashboard/raw');
        rawData = await response.json();
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        return;
    }

    dashData = {
        productos: rawData.productos || [],
        ventas: rawData.ventas || [],
        itemsVenta: rawData.itemsVenta || [],
        reparaciones: rawData.reparaciones || [],
        revalorizaciones: rawData.revalorizaciones || [],
        auditoriaStock: rawData.auditoriaStock || []
    };

    const ops = new Set();
    dashData.ventas.forEach(s => s.operator_name && ops.add(s.operator_name));
    dashData.reparaciones.forEach(r => r.operator_name && ops.add(r.operator_name));
    operators = ['all', ...[...ops].filter(o => o !== 'Anónimo').sort()];
    if (operatorIdx >= operators.length) operatorIdx = 0;

    initDashboardFilters();
    bindKpiClicks();
    renderAll(true);
}

// ═══ Rangos de período ═══
function periodRange(period, offset = 0) {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    if (period === 'today') return [new Date(y, m, d - offset), new Date(y, m, d - offset + 1)];
    if (period === 'week') {
        const dow = now.getDay() || 7; // lunes = 1
        const start = new Date(y, m, d - dow + 1 - offset * 7);
        return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)];
    }
    if (period === 'month') return [new Date(y, m - offset, 1), new Date(y, m - offset + 1, 1)];
    if (period === 'year') return [new Date(y - offset, 0, 1), new Date(y - offset + 1, 0, 1)];
    return [new Date(0), new Date(8640000000000000)];
}

function inRange(dateStr, [a, b]) {
    const d = parseDate(dateStr);
    return !!d && d >= a && d < b;
}

function isDateInPeriod(dateStr, period) {
    return inRange(dateStr, periodRange(period));
}

const opFilter = () => operators[operatorIdx] || 'all';
const payFilter = () => payments[paymentIdx] || 'all';

function initDashboardFilters() {
    document.querySelectorAll('#dash-periods [data-period]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === currentPeriod);
        btn.addEventListener('click', () => {
            document.querySelectorAll('#dash-periods [data-period]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriod = btn.dataset.period;
            renderAll();
        });
    });

    const opBtn = document.getElementById('dash-cycle-operator');
    const payBtn = document.getElementById('dash-cycle-payment');
    const syncLabels = () => {
        const op = opFilter(), pay = payFilter();
        document.getElementById('dash-operator-label').textContent = op === 'all' ? 'Todas' : op;
        document.getElementById('dash-payment-label').textContent = pay === 'all' ? 'Todos' : pay;
    };
    syncLabels();
    opBtn?.addEventListener('click', () => { operatorIdx = (operatorIdx + 1) % operators.length; syncLabels(); renderAll(); });
    payBtn?.addEventListener('click', () => { paymentIdx = (paymentIdx + 1) % payments.length; syncLabels(); renderAll(); });

    document.querySelectorAll('#dash-chart-modes [data-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === chartMode);
        btn.addEventListener('click', () => {
            chartMode = btn.dataset.mode;
            document.querySelectorAll('#dash-chart-modes [data-mode]').forEach(b => b.classList.toggle('active', b === btn));
            renderSalesChart(false);
        });
    });

    document.querySelectorAll('#dash-top-modes [data-top]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.top === topMode);
        btn.addEventListener('click', () => {
            topMode = btn.dataset.top;
            document.querySelectorAll('#dash-top-modes [data-top]').forEach(b => b.classList.toggle('active', b === btn));
            renderTopProducts();
        });
    });

    document.getElementById('dash-go-cash')?.addEventListener('click', () => goTo('admin', { tab: 'admin-cash' }));
    document.getElementById('dash-go-repairs')?.addEventListener('click', () => goTo('repairs'));
    document.getElementById('dash-add-stock')?.addEventListener('click', () => goTo('inventory', { tab: 'bajo' }));
}

// Últimos eventos calculados (para el detalle al hacer clic en un KPI)
let lastKpiState = null;

function computeKpis(range) {
    const events = filterEvents(buildProfitEvents(dashData), {
        inPeriod: d => inRange(d, range), operator: opFilter(), method: payFilter()
    });
    const salesEvents = events.filter(e => e.kind === 'venta');
    const repairEvents = events.filter(e => e.kind === 'reparacion');
    const revalEvents = events.filter(e => e.kind === 'revalorizacion');
    const gananciaVentas = sumBy(salesEvents, 'profit');
    const gananciaReparaciones = sumBy(repairEvents, 'profit');
    const gananciaInversion = sumBy(revalEvents, 'profit');
    return {
        salesEvents, repairEvents, revalEvents, gananciaVentas, gananciaReparaciones, gananciaInversion,
        gananciaTotal: safeAdd(safeAdd(gananciaVentas, gananciaInversion), gananciaReparaciones),
        ingresosVentas: sumBy(salesEvents, 'income'),
        ingresosReparaciones: sumBy(repairEvents, 'income')
    };
}

function renderAll(first = false) {
    updateKPIs();
    renderSalesChart(first);
    renderProfitSource();
    renderPeople();
    renderPaymentMix();
    renderTopProducts();
    renderIncoming();
}

const operatingMargin = k => {
    const income = safeAdd(k.ingresosVentas, k.ingresosReparaciones);
    return income > 0 ? safeAdd(k.gananciaVentas, k.gananciaReparaciones) / income : 0;
};

function setBadge(id, text, negative = false) {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.classList.toggle('hidden', !text);
    if (!text) return;
    badge.textContent = text;
    badge.classList.toggle('orange', negative);
}

// Variación contra el período anterior equivalente (sin dato previo no se muestra)
function setPercentBadge(id, current, previous, vs) {
    if (!vs || !(previous > 0)) return setBadge(id, '');
    const pct = Math.round(((current - previous) / previous) * 100);
    setBadge(id, `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}% vs ${vs}`, pct < 0);
}

function updateKPIs() {
    try {
        let invertido = 0, low = 0;
        dashData.productos.forEach(p => {
            const stock = parseInt(p.stock || 0);
            invertido = safeAdd(invertido, safeMultiply(parseFloat(p.cost_price || 0), stock));
            if (stock <= parseInt(p.min_stock || 0)) low++;
        });

        const k = computeKpis(periodRange(currentPeriod));
        lastKpiState = k;
        const ingresos = safeAdd(k.ingresosVentas, k.ingresosReparaciones);
        const margin = operatingMargin(k);

        countTo(document.getElementById('kpi-ingresos'), ingresos, v => money(v));
        countTo(document.getElementById('kpi-ganancia-total'), k.gananciaTotal, v => money(v));
        countTo(document.getElementById('kpi-invertido-ventas'), invertido, v => money(v, 0));
        countTo(document.getElementById('kpi-stock-bajo'), low);
        countTo(document.getElementById('kpi-ingresos-ventas'), k.ingresosVentas, v => money(v, 0));
        countTo(document.getElementById('kpi-ingresos-reparaciones'), k.ingresosReparaciones, v => money(v, 0));
        setText('kpi-total-ventas', k.salesEvents.length);
        setText('kpi-total-reparaciones', new Set(k.repairEvents.map(e => e.ref.id)).size);
        setText('kpi-ganancia-ventas', fmt(k.gananciaVentas));
        setText('kpi-ganancia-reparaciones', fmt(k.gananciaReparaciones));
        setText('dash-margin-pct', `${(margin * 100).toFixed(1)}%`);
        setText('dash-de-cada-10', money(margin * 10));
        setText('dash-ticket', money(k.salesEvents.length ? k.ingresosVentas / k.salesEvents.length : 0));
        const split = document.getElementById('dash-split-v');
        if (split) split.style.width = `${ingresos > 0 ? (k.ingresosVentas / ingresos * 100).toFixed(1) : 0}%`;

        const vs = { today: 'ayer', week: 'semana ant.', month: 'mes ant.', year: 'año ant.' }[currentPeriod];
        const prev = vs ? computeKpis(periodRange(currentPeriod, 1)) : null;
        setPercentBadge('kpi-ingresos-delta', ingresos, prev ? safeAdd(prev.ingresosVentas, prev.ingresosReparaciones) : 0, vs);
        setPercentBadge('kpi-ganancia-delta', k.gananciaTotal, prev ? prev.gananciaTotal : 0, vs);
        const hadIncome = prev && safeAdd(prev.ingresosVentas, prev.ingresosReparaciones) > 0;
        if (hadIncome) {
            const pts = (margin - operatingMargin(prev)) * 100;
            setBadge('dash-margin-delta', `${pts >= 0 ? '+' : '−'}${Math.abs(pts).toFixed(1)} pts vs ${vs}`);
        } else setBadge('dash-margin-delta', '');
    } catch (e) {
        console.error('Error cargando KPIs:', e);
    }
}

function setText(id, v) {
    const el = document.getElementById(id);
    if (el) { el.textContent = v; el.title = String(v); }
}

// ═══ Gráfico apilado (ventas + reparaciones, en ingresos o ganancia) ═══
const MES_C = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function buildSeries() {
    const st = lastKpiState;
    const points = [
        ...st.salesEvents.map(e => ({ d: parseDate(e.date), v: e.income, r: 0, cv: e.cost, cr: 0 })),
        ...st.repairEvents.map(e => ({ d: parseDate(e.date), v: 0, r: e.income, cv: 0, cr: e.cost }))
    ].filter(x => x.d);
    const now = new Date();
    let labels = [], keyOf, title;
    if (currentPeriod === 'today') {
        const hours = points.map(x => x.d.getHours());
        const h0 = Math.min(9, ...hours), h1 = Math.max(20, ...hours);
        for (let h = h0; h <= h1; h++) labels.push(h + 'h');
        keyOf = d => d.getHours() - h0; title = 'de hoy por hora';
    } else if (currentPeriod === 'week') {
        labels = DIAS; keyOf = d => (d.getDay() || 7) - 1; title = 'de esta semana';
    } else if (currentPeriod === 'month') {
        for (let i = 1; i <= now.getDate(); i++) labels.push(String(i));
        keyOf = d => d.getDate() - 1; title = `de ${MES_L[now.getMonth()]} por día`;
    } else if (currentPeriod === 'year') {
        labels = MES_C.slice(0, now.getMonth() + 1); keyOf = d => d.getMonth(); title = `de ${now.getFullYear()} por mes`;
    } else {
        const monthIdx = d => d.getFullYear() * 12 + d.getMonth();
        const last = monthIdx(now);
        const first = points.length ? Math.min(...points.map(x => monthIdx(x.d))) : last - 11;
        for (let i = first; i <= last; i++) labels.push(MES_C[i % 12]);
        keyOf = d => monthIdx(d) - first; title = 'por mes desde el inicio';
    }
    const buckets = labels.map(label => ({ label, v: 0, r: 0, cv: 0, cr: 0 }));
    points.forEach(x => {
        const b = buckets[keyOf(x.d)];
        if (b) ['v', 'r', 'cv', 'cr'].forEach(f => { b[f] = safeAdd(b[f], x[f]); });
    });
    return { buckets, title };
}

function niceMax(value) {
    if (value <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(value)));
    return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(m => m * mag >= value) * mag;
}

function renderSalesChart(first) {
    const host = document.getElementById('dash-chart');
    if (!host || !lastKpiState) return;
    const { buckets, title } = buildSeries();
    const isIng = chartMode === 'ing';
    const part1 = b => isIng ? b.v : safeSubtract(b.v, b.cv);
    const part2 = b => isIng ? b.r : safeSubtract(b.r, b.cr);
    const stacks = buckets.map(b => Math.max(0, part1(b)) + Math.max(0, part2(b)));
    const totals = buckets.map(b => safeAdd(part1(b), part2(b))).filter(x => x !== 0);
    const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    const max = niceMax(Math.max(30, ...stacks.map(x => x * 1.08), avg)); // piso de 30: sin datos el eje no repite marcas
    const H = 240;
    const every = buckets.length > 16 ? 3 : buckets.length > 12 ? 2 : 1;
    const c1 = isIng ? 'var(--orange)' : 'var(--yellow)', c2 = isIng ? 'var(--blue-bg)' : 'var(--text)';

    setText('dash-chart-title', `${isIng ? 'Ingresos' : 'Ganancia'} ${title}`);
    setText('dash-avg-label', money(avg, 0));
    const legend = document.getElementById('dash-chart-series');
    if (legend) legend.innerHTML = `<span><span class="sw" style="background:${c1}"></span>${isIng ? 'Ventas' : 'Ganancia de ventas'}</span><span><span class="sw" style="background:${c2}"></span>${isIng ? 'Reparaciones' : 'Ganancia de reparaciones'}</span>`;

    chartModel = buckets;
    const px = v => (Math.max(0, v) / max * H).toFixed(1);
    host.innerHTML = `
        ${[0, 1, 2, 3].map(j => `<div class="dash-ytick" style="top:${H - j * H / 3 - 8}px"><span>${shortMoney(j * max / 3)}</span><i></i></div>`).join('')}
        <div class="dash-bars">
            ${buckets.map((b, i) => {
                const h1 = px(part1(b)), h2 = px(part2(b));
                return `<div class="dash-bar" data-i="${i}">
                    <div style="height:${first ? 0 : h2}px;background:${c2};border-radius:6px 6px 2px 2px" data-h="${h2}"></div>
                    <div style="height:${first ? 0 : h1}px;background:${c1};border-radius:${Number(h2) > 0 ? '2px 2px 6px 6px' : '6px'}" data-h="${h1}"></div>
                </div>`;
            }).join('')}
        </div>
        ${avg > 0 ? `<div class="dash-avg-line" style="top:${H - avg / max * H}px"></div>` : ''}
        <div class="dash-xlabels">${buckets.map((b, i) => `<span>${i % every === 0 || i === buckets.length - 1 ? esc(b.label) : ''}</span>`).join('')}</div>
        <div class="dash-tip" style="display:none"></div>`;
    if (first) requestAnimationFrame(() => requestAnimationFrame(() => host.querySelectorAll('[data-h]').forEach(el => { el.style.height = el.dataset.h + 'px'; })));

    if (!host.dataset.bound) {
        host.dataset.bound = '1';
        host.addEventListener('mouseover', onChartHover);
        host.addEventListener('mouseleave', () => setChartHover(host, null));
    }
}

function onChartHover(ev) {
    const bar = ev.target.closest('[data-i]');
    if (bar) setChartHover(ev.currentTarget, Number(bar.dataset.i));
}

function setChartHover(host, index) {
    host.querySelectorAll('.dash-bar').forEach((bar, i) => { bar.style.opacity = index === null || index === i ? 1 : .35; });
    const tip = host.querySelector('.dash-tip');
    if (!tip || !chartModel) return;
    if (index === null) { tip.style.display = 'none'; return; }
    const b = chartModel[index];
    const row = (color, label, value, extra = '') => `<span class="r ${extra}"><span><span class="ui-dot" style="background:${color}"></span>${label}</span><span>${money(value)}</span></span>`;
    tip.innerHTML = `<span class="l">${esc(b.label)}</span>${row('#d6451b', 'Ventas', b.v)}${row('#8fb0ff', 'Reparaciones', b.r)}${row('#f0c132', 'Ganancia', safeSubtract(safeAdd(b.v, b.r), safeAdd(b.cv, b.cr)), 'total')}`;
    tip.style.display = 'flex';
    const plot = host.clientWidth - 56;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.max(half, Math.min(host.clientWidth - half, 56 + plot * (index + .5) / chartModel.length))}px`;
}

// ═══ ¿De dónde sale la ganancia? ═══
function renderProfitSource() {
    const k = lastKpiState; if (!k) return;
    const cobrado = safeAdd(k.ingresosVentas, k.ingresosReparaciones);
    const ganOp = safeAdd(k.gananciaVentas, k.gananciaReparaciones);
    const shareBase = Math.max(0, k.gananciaVentas) + Math.max(0, k.gananciaReparaciones);
    const share = n => shareBase > 0 ? Math.max(0, n) / shareBase * 100 : 0;
    const margin = (gain, income) => income > 0 ? Math.round(gain / income * 100) : 0;

    setText('dash-src-cobrado', money(cobrado));
    setText('dash-src-cv', money(sumBy(k.salesEvents, 'cost')));
    setText('dash-src-cr', money(sumBy(k.repairEvents, 'cost')));
    setText('dash-src-reval', money(k.gananciaInversion));
    document.getElementById('dash-src-reval-row')?.classList.toggle('hidden', !k.gananciaInversion);
    setText('dash-src-total', money(k.gananciaTotal));
    setText('dash-margin-v', `${margin(k.gananciaVentas, k.ingresosVentas)}% margen`);
    setText('dash-margin-r', `${margin(k.gananciaReparaciones, k.ingresosReparaciones)}% margen`);
    setBar('dash-share-v', share(k.gananciaVentas));
    setBar('dash-share-r', share(k.gananciaReparaciones));
    setText('dash-insight', cobrado > 0 && ganOp > 0
        ? `Reparaciones son el ${Math.round(k.ingresosReparaciones / cobrado * 100)}% de lo cobrado y dejan el ${Math.round(share(k.gananciaReparaciones))}% de la ganancia.`
        : '');
}

function setBar(id, pct) {
    const el = document.getElementById(id);
    if (el) requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = `${pct.toFixed(1)}%`; }));
}

// ═══ ¿Quién vendió? ═══
const PERSON_COLORS = ['#f0c132', '#8fb0ff', '#c9bfae', '#f4a58a', '#b9b3a8'];

function renderPeople() {
    const host = document.getElementById('dash-people'); if (!host) return;
    const events = filterEvents(buildProfitEvents(dashData), { inPeriod: d => inRange(d, periodRange(currentPeriod)), method: payFilter() })
        .filter(ev => ev.kind !== 'revalorizacion');
    const byName = new Map();
    events.forEach(ev => {
        const name = ev.operator || 'Sin asignar';
        if (!byName.has(name)) byName.set(name, { name, ventas: 0, ingresoVentas: 0, cobro: 0, ganancia: 0 });
        const p = byName.get(name);
        if (ev.kind === 'venta') { p.ventas++; p.ingresoVentas = safeAdd(p.ingresoVentas, ev.income); }
        p.cobro = safeAdd(p.cobro, ev.income);
        p.ganancia = safeAdd(p.ganancia, ev.profit);
    });
    const people = [...byName.values()].sort((a, b) => b.cobro - a.cobro);
    if (!people.length) { host.innerHTML = '<div class="ui-empty">Sin movimientos en este período</div>'; return; }
    const total = people.reduce((a, p) => safeAdd(a, p.cobro), 0);
    const selected = opFilter();
    host.innerHTML = people.map((p, i) => {
        const share = total > 0 ? Math.round(p.cobro / total * 100) : 0;
        return `<div class="dash-people-row" style="opacity:${selected === 'all' || selected === p.name ? 1 : .4}">
            <div class="who">
                <span class="ini" style="background:${PERSON_COLORS[i % PERSON_COLORS.length]}">${esc(initials(p.name))}</span>
                <div><span class="n"><span>${esc(p.name)}</span><small>${share}%</small></span><div class="ui-bar sm"><span style="width:${share}%;background:var(--text)"></span></div></div>
            </div>
            <span class="r">${p.ventas}</span>
            <span class="r">${money(p.cobro, 0)}</span>
            <span class="r strong">${money(p.ganancia, 0)}</span>
            <span class="r muted">${p.cobro > 0 ? Math.round(p.ganancia / p.cobro * 100) : 0}%</span>
            <span class="r muted">${p.ventas ? money(p.ingresoVentas / p.ventas) : '—'}</span>
        </div>`;
    }).join('');
}

// ═══ ¿Cómo te pagaron? ═══
const METHOD_STYLE = {
    'Caja': { name: 'Efectivo', color: '#ffffff' },
    'Yape/Plin': { name: 'Yape / Plin', color: '#8fb0ff' },
    'Transferencia': { name: 'Transferencia', color: '#f0c132' },
    'POS': { name: 'POS (tarjeta)', color: '#d6451b' }
};

function renderPaymentMix() {
    const k = lastKpiState, bar = document.getElementById('dash-pay-bar'), list = document.getElementById('dash-pay-list');
    if (!k || !bar || !list) return;
    const total = safeAdd(k.ingresosVentas, k.ingresosReparaciones);
    const events = [...k.salesEvents, ...k.repairEvents];
    const rows = PAYMENT_METHODS.map(method => {
        const amount = sumBy(events.filter(ev => ev.method === method), 'income');
        return { ...METHOD_STYLE[method], amount, pct: total > 0 ? amount / total * 100 : 0 };
    }).filter(r => r.amount > 0);
    setText('dash-pay-total', money(total));
    bar.innerHTML = rows.map(r => `<div title="${esc(r.name)}" style="width:${r.pct.toFixed(1)}%;background:${r.color}"></div>`).join('');
    list.innerHTML = rows.length ? rows.map(r => `<div class="dash-pay-row">
        <span><span class="ui-dot" style="background:${r.color}"></span>${esc(r.name)}</span><span>${money(r.amount)}</span><span class="pct">${Math.round(r.pct)}%</span>
    </div>`).join('') : '<div class="ui-empty" style="color:rgba(255,255,255,.55)">Sin cobros en este período</div>';
}

// ═══ Productos que más dejan ═══
function renderTopProducts() {
    const host = document.getElementById('dash-top'); if (!host || !lastKpiState) return;
    const costById = {};
    dashData.productos.forEach(p => { costById[p.id] = parseFloat(p.cost_price || 0); });
    const stats = new Map();
    lastKpiState.salesEvents.forEach(e => {
        const items = (e.ref.items || []).filter(it => it.product_name);
        const gross = items.reduce((a, it) => safeAdd(a, parseFloat(it.subtotal || 0)), 0);
        // Un descuento de la venta se reparte entre sus productos en proporción a su subtotal
        const factor = gross > 0 ? e.income / gross : 1;
        items.forEach(it => {
            const quantity = parseInt(it.quantity) || 0;
            const unitCost = it.unit_cost !== undefined && it.unit_cost !== null ? parseFloat(it.unit_cost) : (costById[it.product_id] || 0);
            const income = parseFloat(it.subtotal || 0) * factor;
            const s = stats.get(it.product_name) || { name: it.product_name, units: 0, income: 0, gain: 0 };
            s.units += quantity;
            s.income = safeAdd(s.income, income);
            s.gain = safeAdd(s.gain, safeSubtract(income, safeMultiply(unitCost, quantity)));
            stats.set(it.product_name, s);
        });
    });
    const byGain = topMode === 'g';
    const top = [...stats.values()].sort((a, b) => byGain ? b.gain - a.gain : b.units - a.units).slice(0, 6);
    if (!top.length) { host.innerHTML = '<div class="ui-empty">Sin ventas en este período</div>'; return; }
    const max = Math.max(...top.map(p => byGain ? p.gain : p.units), 1);
    host.innerHTML = top.map(p => {
        const value = byGain ? p.gain : p.units;
        const sub = byGain ? `${p.units} und · ${p.income > 0 ? Math.round(p.gain / p.income * 100) : 0}% margen` : `${money(p.gain, 0)} de ganancia`;
        return `<div class="dash-top-row">
            <div class="t"><span>${esc(p.name)} <span style="color:var(--dim)">· ${esc(sub)}</span></span><span class="tnum">${byGain ? money(p.gain, 0) : `${p.units} und`}</span></div>
            <div class="ui-bar"><span style="width:0%;background:${byGain ? 'var(--yellow)' : 'var(--text)'}" data-w="${(Math.max(0, value) / max * 100).toFixed(1)}"></span></div>
        </div>`;
    }).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => host.querySelectorAll('[data-w]').forEach(b => { b.style.width = b.dataset.w + '%'; })));
}

// ═══ Dinero por entrar ═══
const ST_ORDER = ['PENDIENTE', 'EN_DIAGNOSTICO', 'EN_PROCESO', 'TERMINADO', 'ENTREGADO'];

function repairGroups() {
    const op = opFilter();
    const groups = new Map();
    dashData.reparaciones.forEach(r => {
        if (op !== 'all' && r.operator_name !== op) return;
        const key = r.group_ticket || r.ticket_code;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    });
    return [...groups.values()].map(items => {
        const st = ST_ORDER[Math.min(...items.map(x => Math.max(0, ST_ORDER.indexOf(x.status))))];
        const total = items.reduce((a, x) => safeAdd(a, parseFloat(x.total_amount || 0)), 0);
        const paid = items.reduce((a, x) => safeAdd(a, x.status === 'ENTREGADO' ? parseFloat(x.total_amount || 0) : parseFloat(x.advance_payment || 0)), 0);
        return { st, saldo: Math.max(0, safeSubtract(total, paid)) };
    });
}

function renderIncoming() {
    const active = repairGroups().filter(g => g.st !== 'ENTREGADO');
    const ready = active.filter(g => g.st === 'TERMINADO');
    const sumSaldo = list => list.reduce((a, g) => safeAdd(a, g.saldo), 0);
    countTo(document.getElementById('dash-cobrar'), sumSaldo(active), v => money(v));
    setText('dash-active-count', active.length);
    countTo(document.getElementById('dash-ready-amount'), sumSaldo(ready), v => money(v));
    setText('dash-ready-count', ready.length);
    document.getElementById('dash-ready-call')?.classList.toggle('hidden', !ready.length);
}

// ═══ Detalle de KPIs (clic en cada cifra) ═══
const PERIOD_LABELS = {
    today: 'Hoy', week: 'Semana actual', month: 'Mes actual', year: 'Año actual', all: 'Todo el historial'
};

function periodLabel() {
    return PERIOD_LABELS[currentPeriod] || '';
}

function fmtDate(d) {
    const date = parseDate(d);
    if (!date) return '—';
    const day = date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' });
    return `<span class="drill-date">${day}<small>${fmtTime(date)}</small></span>`;
}

function moneyCell(n, colorize = false) {
    const style = colorize ? `color:${n < 0 ? 'var(--orange)' : 'var(--blue)'};font-weight:500` : '';
    return `<td class="num" style="${style}">${fmt(n)}</td>`;
}

function periodRangeLabel() {
    if (currentPeriod === 'all') return '';
    const [a, b] = periodRange(currentPeriod);
    const last = new Date(Math.min(b.getTime() - 1, Date.now()));
    return a.toDateString() === last.toDateString() ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(last)}`;
}

const DRILL_LIMIT = 100;

function openDrill({ title, subtitle, summary = [], head = [], rows = [], empty = 'Sin registros en este período', actions = [] }) {
    let modal = document.getElementById('dash-drill-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'dash-drill-modal';
        modal.className = 'modal ui-modal-host hidden';
        modal.innerHTML = `<div class="ui-backdrop" data-close-modal="dash-drill-modal"></div>
            <div class="ui-modal ui-modal-sm drill-modal" role="dialog" aria-labelledby="drill-title"></div>`;
        document.body.appendChild(modal);
    }
    const sub = subtitle || [periodLabel(), periodRangeLabel()].filter(Boolean).join(' · ');
    const shown = rows.slice(0, DRILL_LIMIT);
    const box = modal.querySelector('.drill-modal');
    box.innerHTML = `
        <div class="ui-modal-top" style="align-items:flex-start">
            <div style="display:flex;flex-direction:column;gap:6px;min-width:0"><span class="drill-title" id="drill-title">${esc(title)}</span><span class="drill-period">${esc(sub)}</span></div>
            <button class="ui-icon-btn" style="width:40px;height:40px" data-close-modal="dash-drill-modal" aria-label="Cerrar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"></path></svg></button>
        </div>
        ${summary.length ? `<div class="drill-stats">${summary.map((st, i) => `
            <div class="drill-stat ${i === summary.length - 1 ? 'main' : ''}"><span>${esc(st.label)}</span><b>${esc(st.value)}</b></div>`).join('')}</div>` : ''}
        <div class="drill-card">
            ${rows.length ? `<div class="drill-scroll"><table class="drill-table"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
                <tbody>${shown.join('')}</tbody></table></div>
                <div class="drill-count">${rows.length > shown.length ? `Mostrando ${shown.length} de ${rows.length}` : `${rows.length} registro${rows.length === 1 ? '' : 's'}`}</div>`
            : `<div class="ui-empty">${esc(empty)}</div>`}
        </div>
        <div class="drill-actions">
            <button class="ui-pill outline" data-close-modal="dash-drill-modal" style="padding:13px 22px">Cerrar</button>
            ${actions.map((act, i) => `<button class="ui-pill" data-drill-action="${i}" style="padding:13px 22px">${esc(act.label)} <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M7 7h10v10"></path></svg></button>`).join('')}
        </div>`;
    box.querySelectorAll('[data-drill-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            modal.classList.add('hidden');
            actions[Number(btn.dataset.drillAction)].onClick();
        });
    });
    modal.classList.remove('hidden');
}

function goTo(view, intent) {
    if (typeof window.navigateTo === 'function') window.navigateTo(view, intent);
}

function byDateDesc(a, b) { return new Date(b.date) - new Date(a.date); }

function drillSales(focus) {
    const st = lastKpiState; if (!st) return;
    const list = [...st.salesEvents].sort(byDateDesc);
    const titles = { ingresos: 'Ingresos por ventas', ganancia: 'Ganancia por ventas', count: 'Ventas registradas' };
    openDrill({
        title: titles[focus],
        summary: [
            { label: '# Ventas', value: String(list.length) },
            { label: 'Ingresos', value: fmt(sumBy(list, 'income')) },
            { label: 'Costo mercadería', value: fmt(sumBy(list, 'cost')) },
            { label: 'Ganancia', value: fmt(sumBy(list, 'profit')) }
        ],
        head: ['Fecha', 'Cliente', 'Productos', 'Vendedor', 'Pago', 'Total', 'Costo', 'Ganancia'],
        rows: list.map(e => {
            const products = (e.ref.items || []).map(i => `${esc(i.product_name)} ×${i.quantity}`).join(' · ') || '—';
            return `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.ref.customer_name || 'Anónimo')}</td><td class="drill-products">${products}</td>
                <td>${esc(e.operator || '-')}</td><td><span class="ui-tag">${esc(e.method || '-')}</span></td>${moneyCell(e.income)}<td class="num dim">${fmt(e.cost)}</td>${moneyCell(e.profit, true)}</tr>`;
        }),
        actions: [{ label: 'Abrir historial de ventas', onClick: () => goTo('sales', { tab: 'history' }) }]
    });
}

function drillRepairs(focus) {
    const st = lastKpiState; if (!st) return;
    const list = [...st.repairEvents].sort(byDateDesc);
    const titles = { ingresos: 'Ingresos por reparaciones', ganancia: 'Ganancia por reparaciones', count: 'Reparaciones con cobros' };
    openDrill({
        title: titles[focus],
        summary: [
            { label: '# Reparaciones', value: String(new Set(list.map(e => e.ref.id)).size) },
            { label: 'Cobrado', value: fmt(sumBy(list, 'income')) },
            { label: 'Insumos', value: fmt(sumBy(list, 'cost')) },
            { label: 'Ganancia', value: fmt(sumBy(list, 'profit')) }
        ],
        head: ['Fecha', 'Ticket', 'Cliente', 'Equipo', 'Cobro', 'Pago', 'Cobrado', 'Insumos', 'Ganancia'],
        rows: list.map(e => `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.ref.ticket_code)}</td><td>${esc(e.ref.customer_name)}</td>
            <td>${esc(e.ref.equipment_type)} ${esc(e.ref.brand_model)}</td>
            <td><span class="drill-chip ${e.stage}">${e.stage === 'saldo' ? 'Saldo (entrega)' : e.direct ? 'Adelanto (entrega)' : 'Adelanto (al terminar)'}</span></td>
            <td><span class="ui-tag">${esc(e.method || '-')}</span></td>${moneyCell(e.income)}<td class="num dim">${fmt(e.cost)}</td>${moneyCell(e.profit, true)}</tr>`),
        actions: [{ label: 'Ir a reparaciones', onClick: () => goTo('repairs') }]
    });
}

function drillProfitTotal() {
    const st = lastKpiState; if (!st) return;
    const share = (n) => st.gananciaTotal ? `${Math.round((n / st.gananciaTotal) * 100)}%` : '—';
    const revalRows = [...st.revalEvents].sort(byDateDesc).map(e => `<tr><td>${fmtDate(e.date)}</td><td>Revalorización: ${esc(e.ref.product_name)}</td>
        <td class="text-dim">${fmt(e.ref.old_cost_price)} → ${fmt(e.ref.new_cost_price)} (stock ${e.ref.stock_at_change ?? '-'})</td>${moneyCell(e.profit, true)}</tr>`);
    openDrill({
        title: 'Ganancia total',
        summary: [
            { label: `Ventas (${share(st.gananciaVentas)})`, value: fmt(st.gananciaVentas) },
            { label: `Reparaciones (${share(st.gananciaReparaciones)})`, value: fmt(st.gananciaReparaciones) },
            { label: `Revalorización (${share(st.gananciaInversion)})`, value: fmt(st.gananciaInversion) },
            { label: 'Total', value: fmt(st.gananciaTotal), color: 'var(--accent-green)' }
        ],
        head: ['Fecha', 'Concepto', 'Detalle', 'Ganancia'],
        rows: [
            `<tr class="drill-row-link" data-go="sales"><td>—</td><td><strong>Ventas</strong> (${st.salesEvents.length})</td><td class="text-dim">Ver detalle de cada venta ›</td>${moneyCell(st.gananciaVentas, true)}</tr>`,
            `<tr class="drill-row-link" data-go="repairs"><td>—</td><td><strong>Reparaciones</strong> (${new Set(st.repairEvents.map(e => e.ref.id)).size})</td><td class="text-dim">Ver cobros de reparaciones ›</td>${moneyCell(st.gananciaReparaciones, true)}</tr>`,
            ...revalRows
        ],
        actions: [{ label: 'Ver caja y retiros', onClick: () => goTo('admin', { tab: 'admin-cash' }) }]
    });
    document.querySelectorAll('#dash-drill-modal .drill-row-link').forEach(tr => {
        tr.addEventListener('click', () => tr.dataset.go === 'sales' ? drillSales('ganancia') : drillRepairs('ganancia'));
    });
}

function drillInventory() {
    const list = (dashData.productos || [])
        .map(p => ({ ...p, value: safeMultiply(parseFloat(p.cost_price || 0), parseInt(p.stock || 0)) }))
        .filter(p => p.value > 0)
        .sort((a, b) => b.value - a.value);
    const total = sumBy(list, 'value');
    openDrill({
        title: 'Inversión en inventario',
        subtitle: 'Valor actual del stock a precio de costo',
        summary: [
            { label: 'Productos con stock', value: String(list.length) },
            { label: 'Unidades', value: String(list.reduce((a, p) => a + (parseInt(p.stock) || 0), 0)) },
            { label: 'Valor a costo', value: fmt(total) },
            { label: 'Valor a precio venta', value: fmt(list.reduce((a, p) => safeAdd(a, safeMultiply(p.sale_price || 0, p.stock || 0)), 0)), color: 'var(--accent-green)' }
        ],
        head: ['Producto', 'Marca', 'Stock', 'Costo unit.', 'Valor', '% del total'],
        rows: list.map(p => `<tr><td>${esc(p.name)}<div class="text-dim" style="font-size:11px">${esc(p.code)}</div></td><td>${esc(p.brand || '—')}</td>
            <td class="num">${p.stock}</td>${moneyCell(p.cost_price)}${moneyCell(p.value)}<td class="num">${total ? ((p.value / total) * 100).toFixed(1) : 0}%</td></tr>`),
        empty: 'No hay productos con stock',
        actions: [{ label: 'Ir a inventario', onClick: () => goTo('inventory') }]
    });
}

const KPI_ACTIONS = {
    'ganancia-total': drillProfitTotal,
    'stock-bajo': () => goTo('inventory', { tab: 'bajo' }),
    'invertido-ventas': drillInventory,
    'ingresos-ventas': () => drillSales('ingresos'),
    'ganancia-ventas': () => drillSales('ganancia'),
    'total-ventas': () => drillSales('count'),
    'ingresos-reparaciones': () => drillRepairs('ingresos'),
    'ganancia-reparaciones': () => drillRepairs('ganancia'),
    'total-reparaciones': () => drillRepairs('count')
};

function bindKpiClicks() {
    document.querySelectorAll('[data-kpi]').forEach(el => {
        const action = KPI_ACTIONS[el.dataset.kpi];
        if (!action || el.dataset.kpiBound) return;
        el.dataset.kpiBound = '1';
        el.addEventListener('click', action);
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); } });
    });
}


// ═══ Realtime Sync ═══
window.addEventListener('supabase_realtime', async () => {
    if (document.querySelector('.nav-item[data-view="dashboard"]')?.classList.contains('active')) {
        await loadDashboard();
    }
});
