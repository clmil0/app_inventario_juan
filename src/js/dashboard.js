import { getSession, fmt } from './supabase.js';
import { safeAdd, safeMultiply, safeSubtract } from './math.js';
import { buildProfitEvents, filterEvents, sumBy, PAYMENT_METHODS } from './finance.js';
import { esc, money, shortMoney, parseDate, fmtDay, initials, smoothPath, stagger, countTo, ease } from './ui.js';

// Se mantiene por compatibilidad con app.js (antes guardaba instancias de Chart.js)
export const chartInstances = [];

let dashData = { productos: [], ventas: [], itemsVenta: [], reparaciones: [] };
let currentPeriod = 'today';
let operatorIdx = 0, paymentIdx = 0;
let operators = ['all'];
const payments = ['all', ...PAYMENT_METHODS];
let repFilter = 'todas';
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
        auditoriaStock: rawData.auditoriaStock || [],
        retiros: rawData.retiros || []
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

    document.querySelectorAll('#dash-rep-filters [data-rf]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#dash-rep-filters [data-rf]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            repFilter = btn.dataset.rf;
            renderActiveRepairs(true);
        });
    });

    document.getElementById('dash-go-sales')?.addEventListener('click', () => goTo('sales', { tab: 'history' }));
    document.getElementById('dash-go-repairs')?.addEventListener('click', () => goTo('repairs'));
    document.getElementById('dash-new-repair')?.addEventListener('click', () => goTo('repairs', { openNew: true }));
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
    renderMargin();
    renderActiveRepairs(first);
    renderTopProducts();
    renderStages();
    renderLowStock();
}

function updateKPIs() {
    try {
        let invertido = 0, low = 0;
        dashData.productos.forEach(p => {
            const stock = parseInt(p.stock || 0);
            invertido = safeAdd(invertido, safeMultiply(parseFloat(p.cost_price || 0), stock));
            if (stock <= parseInt(p.min_stock || 0)) low++;
        });

        const range = periodRange(currentPeriod);
        const k = computeKpis(range);
        const method = payFilter();
        const retirosPeriodo = (dashData.retiros || []).filter(r => inRange(r.created_at, range) && (method === 'all' || r.source === method));
        lastKpiState = { ...k, retirosPeriodo };

        countTo(document.getElementById('kpi-ganancia-total'), k.gananciaTotal, v => money(v));
        countTo(document.getElementById('kpi-invertido-ventas'), invertido, v => money(v, 0));
        countTo(document.getElementById('kpi-stock-bajo'), low);
        countTo(document.getElementById('kpi-retiros'), sumBy(retirosPeriodo, 'amount'), v => money(v, 0));
        countTo(document.getElementById('kpi-ingresos-ventas'), k.ingresosVentas, v => money(v, 0));
        setText('kpi-total-ventas', k.salesEvents.length);
        setText('kpi-ganancia-ventas', fmt(k.gananciaVentas));
        setText('kpi-ganancia-reparaciones', fmt(k.gananciaReparaciones));
        setText('kpi-ingresos-reparaciones', fmt(k.ingresosReparaciones));
        setText('kpi-total-reparaciones', new Set(k.repairEvents.map(e => e.ref.id)).size);

        // Variación de la ganancia contra el período anterior equivalente
        const badge = document.getElementById('kpi-ganancia-delta');
        if (badge) {
            if (currentPeriod === 'all') badge.classList.add('hidden');
            else {
                const prev = computeKpis(periodRange(currentPeriod, 1)).gananciaTotal;
                const vs = { today: 'ayer', week: 'semana ant.', month: 'mes ant.', year: 'año ant.' }[currentPeriod];
                if (prev > 0) {
                    const pct = Math.round(((k.gananciaTotal - prev) / prev) * 100);
                    badge.textContent = `${pct >= 0 ? '+' : ''}${pct}% vs ${vs}`;
                    badge.classList.toggle('orange', pct < 0);
                    badge.classList.remove('hidden');
                } else badge.classList.add('hidden');
            }
        }
    } catch (e) {
        console.error('Error cargando KPIs:', e);
    }
}

function setText(id, v) {
    const el = document.getElementById(id);
    if (el) { el.textContent = v; el.title = String(v); }
}

// ═══ Gráfico de ventas (línea suave + promedio + tooltip) ═══
const MES_C = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function buildSeries() {
    const ventas = lastKpiState.salesEvents.map(e => ({ d: parseDate(e.date), v: e.income })).filter(x => x.d);
    const now = new Date();
    let labels = [], keyOf, sub;
    if (currentPeriod === 'today') {
        const hours = ventas.map(x => x.d.getHours());
        const h0 = Math.min(9, ...hours), h1 = Math.max(20, ...hours);
        for (let h = h0; h <= h1; h++) labels.push(h + 'h');
        keyOf = d => d.getHours() - h0; sub = 'vendidos hoy';
    } else if (currentPeriod === 'week') {
        labels = DIAS; keyOf = d => (d.getDay() || 7) - 1; sub = 'vendidos esta semana';
    } else if (currentPeriod === 'month') {
        const last = now.getDate();
        for (let i = 1; i <= last; i++) labels.push(String(i));
        keyOf = d => d.getDate() - 1; sub = `vendidos en ${last} días`;
    } else if (currentPeriod === 'year') {
        labels = MES_C.slice(0, now.getMonth() + 1); keyOf = d => d.getMonth(); sub = 'vendidos este año';
    } else {
        // Todo: últimos 12 meses
        const months = [];
        for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(d); labels.push(MES_C[d.getMonth()]); }
        keyOf = d => months.findIndex(m => m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth());
        sub = 'vendidos en 12 meses';
    }
    const v = labels.map(() => 0);
    ventas.forEach(x => { const k = keyOf(x.d); if (k >= 0 && k < v.length) v[k] = safeAdd(v[k], x.v); });
    if (v.length === 1) { labels.push(''); v.push(v[0]); }
    return { labels, v, sub };
}

function renderSalesChart(first) {
    const host = document.getElementById('dash-chart');
    if (!host || !lastKpiState) return;
    const s = buildSeries();
    const n = s.v.length;
    const total = s.v.reduce((a, b) => a + b, 0);
    const nonZero = s.v.filter(x => x > 0);
    const avg = nonZero.length ? total / nonZero.length : 0;
    const above = s.v.filter(x => x > 0 && x >= avg).length;

    setText('dash-sales-sub', s.sub);
    setText('dash-above', `${above} de ${n}`);
    setText('dash-avg-label', shortMoney(avg));

    const W = Math.max(300, host.clientWidth || 800), H = 270, padL = 56, padR = 10, padT = 14, baseY = 238;
    const rawMax = Math.max(...s.v, avg, 1) * 1.2;
    const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
    const max = Math.ceil(rawMax / (mag / 2)) * (mag / 2);
    const X = i => padL + (W - padL - padR) * (i / Math.max(1, n - 1));
    const Y = val => baseY - (baseY - padT) * (val / max);
    const P = s.v.map((val, i) => [X(i), Y(val)]);
    const lineD = smoothPath(P, baseY);
    const areaD = lineD + ` L${P[n - 1][0]},${baseY} L${P[0][0]},${baseY} Z`;
    const every = n > 16 ? 3 : n > 12 ? 2 : 1;

    chartModel = { s, P, n, W, padL, padR, baseY };
    host.innerHTML = `
        ${[max, max / 2, 0].map(v => `<div class="dash-ytick" style="top:${Y(v) - 8}px"><span>${shortMoney(v)}</span><i></i></div>`).join('')}
        <svg width="100%" height="${H}" style="position:absolute;inset:0;overflow:visible">
            <defs><linearGradient id="dashAreaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6451b" stop-opacity=".26"></stop><stop offset="1" stop-color="#d6451b" stop-opacity="0"></stop></linearGradient></defs>
            ${avg > 0 ? `<line x1="${padL}" x2="${W - padR}" y1="${Y(avg)}" y2="${Y(avg)}" stroke="var(--text)" stroke-width="2" stroke-dasharray="8 7"></line>` : ''}
            <g class="dash-chart-g">
                <path d="${areaD}" fill="url(#dashAreaGrad)"></path>
                <path d="${lineD}" fill="none" stroke="#c9441c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>
            </g>
            <g class="dash-hi" style="display:none">
                <line class="hl" y1="10" y2="${baseY}" stroke="rgba(23,23,26,.18)" stroke-width="1"></line>
                <circle class="hc" r="7" fill="#fff" stroke="#c9441c" stroke-width="3"></circle>
            </g>
        </svg>
        ${s.labels.map((l, i) => (i % every === 0 || i === n - 1) && l ? `<span class="dash-xlabel" style="left:${X(i)}px">${esc(l)}</span>` : '').join('')}
        <div class="dash-tip" style="display:none"><div class="l"></div><div class="v"></div></div>`;

    const g = host.querySelector('.dash-chart-g');
    if (g && g.animate) g.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 1400, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'backwards' });

    if (!host.dataset.bound) {
        host.dataset.bound = '1';
        host.addEventListener('mousemove', onChartMove);
        host.addEventListener('mouseleave', () => {
            host.querySelector('.dash-hi')?.setAttribute('style', 'display:none');
            const tip = host.querySelector('.dash-tip'); if (tip) tip.style.display = 'none';
        });
        let t;
        window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => document.getElementById('dash-chart') && renderSalesChart(false), 150); });
    }
}

function onChartMove(ev) {
    const host = ev.currentTarget;
    if (!chartModel) return;
    const { s, P, n, W, padL, padR } = chartModel;
    const r = host.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round((ev.clientX - r.left - padL) / (W - padL - padR) * (n - 1))));
    const [x, y] = P[i];
    const hi = host.querySelector('.dash-hi');
    hi.setAttribute('style', '');
    hi.querySelector('.hl').setAttribute('x1', x); hi.querySelector('.hl').setAttribute('x2', x);
    hi.querySelector('.hc').setAttribute('cx', x); hi.querySelector('.hc').setAttribute('cy', y);
    const tip = host.querySelector('.dash-tip');
    tip.style.display = 'block';
    tip.style.left = x + 'px';
    tip.style.top = Math.max(-6, y - 70) + 'px';
    tip.querySelector('.l').textContent = s.labels[i] || '';
    tip.querySelector('.v').textContent = money(s.v[i]);
}

// ═══ Medidor de margen ═══
function renderMargin() {
    const k = lastKpiState; if (!k) return;
    const ingV = k.ingresosVentas, ingR = k.ingresosReparaciones;
    const totalIng = safeAdd(ingV, ingR);
    const ganOp = safeAdd(k.gananciaVentas, k.gananciaReparaciones);
    const pct = totalIng > 0 ? Math.max(0, Math.min(1, ganOp / totalIng)) : 0;
    const arc = document.getElementById('dash-gauge-arc');
    if (arc) requestAnimationFrame(() => arc.setAttribute('stroke-dasharray', `${(pct * 100).toFixed(2)} 100`));
    countTo(document.getElementById('dash-margin-pct'), pct * 100, v => Math.round(v) + '%');
    setText('dash-margin-v', `${ingV > 0 ? Math.round(k.gananciaVentas / ingV * 100) : 0}% margen`);
    setText('dash-margin-r', `${ingR > 0 ? Math.round(k.gananciaReparaciones / ingR * 100) : 0}% margen`);
}

// ═══ Reparaciones activas (agrupadas por ticket) ═══
const ST_ORDER = ['PENDIENTE', 'EN_DIAGNOSTICO', 'EN_PROCESO', 'TERMINADO', 'ENTREGADO'];
const ST_LABEL = { PENDIENTE: 'Pendiente', EN_DIAGNOSTICO: 'En diagnóstico', EN_PROCESO: 'En proceso', TERMINADO: 'Terminado', ENTREGADO: 'Entregado' };
const ST_COLOR = { PENDIENTE: '#f0c132', EN_DIAGNOSTICO: '#2b4f9e', EN_PROCESO: '#d6451b', TERMINADO: '#17171a', ENTREGADO: '#b9b3a8' };

function repairGroups() {
    const op = opFilter();
    const groups = new Map();
    dashData.reparaciones.forEach(r => {
        if (op !== 'all' && r.operator_name !== op) return;
        const key = r.group_ticket || r.ticket_code;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    });
    return [...groups.entries()].map(([ticket, items]) => {
        const st = ST_ORDER[Math.min(...items.map(x => Math.max(0, ST_ORDER.indexOf(x.status))))];
        const total = items.reduce((a, x) => safeAdd(a, parseFloat(x.total_amount || 0)), 0);
        const paid = items.reduce((a, x) => safeAdd(a, x.status === 'ENTREGADO' ? parseFloat(x.total_amount || 0) : parseFloat(x.advance_payment || 0)), 0);
        return { ticket, items, st, total, saldo: Math.max(0, safeSubtract(total, paid)), date: items[0].created_at, ops: [...new Set(items.map(x => x.operator_name).filter(Boolean))] };
    });
}

function renderActiveRepairs(animate) {
    const grid = document.getElementById('dash-rep-grid'); if (!grid) return;
    const list = repairGroups()
        .filter(g => g.st !== 'ENTREGADO')
        .filter(g => repFilter === 'todas' || (repFilter === 'listas' ? g.st === 'TERMINADO' : g.st !== 'TERMINADO'))
        .sort((a, b) => (parseDate(b.date) || 0) - (parseDate(a.date) || 0))
        .slice(0, 6);
    if (!list.length) {
        grid.innerHTML = `<div class="ui-empty" style="grid-column:1/-1">No hay reparaciones ${repFilter === 'listas' ? 'listas para entregar' : 'en curso'}</div>`;
        return;
    }
    grid.innerHTML = list.map(g => {
        const r0 = g.items[0];
        const done = g.st === 'TERMINADO';
        const when = done ? 'Listo · avisar' : `Ingresó ${fmtDay(g.date)}`;
        const job = r0.fault_description || 'Reparación';
        const device = [r0.equipment_type, r0.brand_model].filter(Boolean).join(' ') + (g.items.length > 1 ? ` +${g.items.length - 1}` : '');
        const ops = g.ops.length ? g.ops : ['—'];
        return `<button class="dash-rep-card ${done ? 'done' : ''}" data-ticket="${esc(g.ticket)}">
            <div class="top"><span>${esc(when)}</span><span class="dots">${svgDots()}</span></div>
            <div class="job">${esc(job)}</div>
            <div class="dev">${esc(device)} · ${esc(r0.customer_name || 'Anónimo')}</div>
            <div class="foot">
                <div><span class="amt">${money(g.total, 0)}</span><small>${ST_LABEL[g.st]} · Saldo ${money(g.saldo, 0)}</small></div>
                <div class="ops">${ops.map(o => `<span style="background:${o === ops[0] ? '#f0c132' : '#efe3cf'}">${esc(initials(o))}</span>`).join('')}</div>
            </div>
        </button>`;
    }).join('');
    grid.querySelectorAll('[data-ticket]').forEach(el => el.addEventListener('click', () => goTo('repairs', { ticket: el.dataset.ticket })));
    if (animate) stagger(grid.children, 300, 70);
}

function svgDots() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M5 12h.01M12 12h.01M19 12h.01"></path></svg>';
}

// ═══ Top 5 productos ═══
function renderTopProducts() {
    const host = document.getElementById('dash-top'); if (!host || !lastKpiState) return;
    const units = {};
    lastKpiState.salesEvents.forEach(e => (e.ref.items || []).forEach(it => {
        if (!it.product_name) return;
        units[it.product_name] = (units[it.product_name] || 0) + (parseInt(it.quantity) || 0);
    }));
    const top = Object.entries(units).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!top.length) { host.innerHTML = '<div class="ui-empty">Sin ventas en este período</div>'; return; }
    const max = top[0][1] || 1;
    host.innerHTML = top.map(([name, u], i) => `
        <div class="dash-top-row">
            <div class="t"><span>${esc(name)}</span><span class="tnum">${u}</span></div>
            <div class="ui-bar"><span style="width:0%;background:${i === 0 ? 'var(--orange)' : 'var(--surface-ink)'}" data-w="${(u / max * 100).toFixed(1)}"></span></div>
        </div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => host.querySelectorAll('[data-w]').forEach(b => b.style.width = b.dataset.w + '%')));
}

// ═══ Reparaciones por estado ═══
function renderStages() {
    const host = document.getElementById('dash-stages'), mix = document.getElementById('dash-mix');
    if (!host || !mix) return;
    const active = repairGroups().filter(g => g.st !== 'ENTREGADO');
    const stages = ST_ORDER.slice(0, 4).map(k => {
        const gs = active.filter(g => g.st === k);
        return { k, count: gs.length, saldo: gs.reduce((a, g) => safeAdd(a, g.saldo), 0) };
    });
    const count = active.length;
    const cobrar = stages.reduce((a, s) => safeAdd(a, s.saldo), 0);
    countTo(document.getElementById('dash-cobrar'), cobrar, v => money(v, 0));
    setText('dash-active-count', count);
    mix.innerHTML = stages.filter(s => s.count).map(s => `<div style="flex:${s.count} 1 0;background:${ST_COLOR[s.k]}" title="${ST_LABEL[s.k]}: ${s.count}"></div>`).join('') || '<div style="flex:1;background:var(--fill)"></div>';
    mix.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { mix.style.width = '100%'; }));
    host.innerHTML = stages.map(s => `
        <div class="ui-list-row" style="grid-template-columns:minmax(0,1fr) 60px 110px 50px">
            <span style="display:flex;align-items:center;gap:10px"><span class="ui-dot" style="background:${ST_COLOR[s.k]}"></span>${ST_LABEL[s.k]}</span>
            <span class="tnum" style="color:var(--muted)">${s.count}</span>
            <span class="tnum" style="text-align:right">${money(s.saldo, 0)}</span>
            <span class="tnum" style="text-align:right;color:var(--muted)">${count ? Math.round(s.count / count * 100) : 0}%</span>
        </div>`).join('');
}

// ═══ Stock bajo ═══
function renderLowStock() {
    const host = document.getElementById('dash-low-list'); if (!host) return;
    const low = dashData.productos
        .filter(p => (parseInt(p.stock) || 0) <= (parseInt(p.min_stock) || 0))
        .sort((a, b) => (a.stock / Math.max(1, a.min_stock)) - (b.stock / Math.max(1, b.min_stock)));
    setText('dash-low-badge', `${low.length} productos`);
    if (!low.length) { host.innerHTML = '<div class="ui-empty" style="color:rgba(255,255,255,.55)">Todo el stock está sobre el mínimo</div>'; return; }
    host.innerHTML = low.slice(0, 5).map(p => {
        const stock = parseInt(p.stock) || 0, min = Math.max(1, parseInt(p.min_stock) || 0);
        const w = Math.max(6, Math.min(100, stock / min * 100));
        return `<div class="ui-list-row" style="grid-template-columns:minmax(0,1fr) 70px 44px;gap:14px;padding:13px 0">
            <div style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span><span style="font-size:12px;color:rgba(255,255,255,.55)">Cód. ${esc(p.code)}</span></div>
            <div class="ui-bar sm"><span style="width:0%;background:${stock === 0 ? 'var(--orange)' : 'var(--yellow)'}" data-w="${w.toFixed(1)}"></span></div>
            <span class="tnum" style="text-align:right;font-size:14px">${stock}/${p.min_stock}</span>
        </div>`;
    }).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => host.querySelectorAll('[data-w]').forEach(b => b.style.width = b.dataset.w + '%')));
}

// ═══ Detalle de KPIs (clic en cada cifra) ═══
const PERIOD_LABELS = {
    today: 'Hoy', week: 'Semana actual', month: 'Mes actual', year: 'Año actual', all: 'Todo el historial'
};

function periodLabel() {
    return PERIOD_LABELS[currentPeriod] || '';
}

function fmtDate(d) {
    const date = new Date(d);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function moneyCell(n, colorize = false) {
    const color = colorize ? (n < 0 ? 'var(--accent-red)' : 'var(--accent-green)') : 'inherit';
    return `<td class="num" style="color:${color}">${fmt(n)}</td>`;
}

function openDrill({ title, subtitle, summary = [], head = [], rows = [], empty = 'Sin registros en este período', actions = [] }) {
    let modal = document.getElementById('dash-drill-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'dash-drill-modal';
        modal.className = 'modal hidden';
        modal.innerHTML = `<div class="modal-content glass drill-content">
            <button class="modal-close-btn" aria-label="Cerrar">✕</button>
            <div class="drill-body"></div></div>`;
        modal.addEventListener('click', e => {
            if (e.target === modal || e.target.closest('.modal-close-btn')) modal.classList.add('hidden');
        });
        document.body.appendChild(modal);
    }

    const body = modal.querySelector('.drill-body');
    body.innerHTML = `
        <div class="drill-header">
            <h2>${esc(title)}</h2>
            <div class="drill-sub">${esc(subtitle || periodLabel())}</div>
        </div>
        ${summary.length ? `<div class="drill-summary">${summary.map(s => `
            <div class="drill-stat"><span>${esc(s.label)}</span><strong style="${s.color ? `color:${s.color}` : ''}">${esc(s.value)}</strong></div>`).join('')}</div>` : ''}
        <div class="drill-table-wrap">
            ${rows.length ? `<table class="drill-table"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
                <tbody>${rows.join('')}</tbody></table>` : `<p class="drill-empty">${esc(empty)}</p>`}
        </div>
        ${actions.length ? `<div class="modal-actions">${actions.map((a, i) => `<button class="${i === actions.length - 1 ? 'btn-primary' : 'btn-outline'}" data-drill-action="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
    body.querySelectorAll('[data-drill-action]').forEach(btn => {
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
            { label: 'Ganancia', value: fmt(sumBy(list, 'profit')), color: 'var(--accent-green)' }
        ],
        head: ['Fecha', 'Cliente', 'Productos', 'Vendedor', 'Pago', 'Total', 'Costo', 'Ganancia'],
        rows: list.map(e => {
            const products = (e.ref.items || []).map(i => `${esc(i.product_name)} ×${i.quantity}`).join('<br>') || '<span class="text-dim">—</span>';
            return `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.ref.customer_name || 'Anónimo')}</td><td class="drill-products">${products}</td>
                <td>${esc(e.operator || '-')}</td><td>${esc(e.method || '-')}</td>${moneyCell(e.income)}${moneyCell(e.cost)}${moneyCell(e.profit, true)}</tr>`;
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
            { label: 'Ganancia', value: fmt(sumBy(list, 'profit')), color: 'var(--accent-green)' }
        ],
        head: ['Fecha', 'Ticket', 'Cliente', 'Equipo', 'Cobro', 'Pago', 'Cobrado', 'Insumos', 'Ganancia'],
        rows: list.map(e => `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.ref.ticket_code)}</td><td>${esc(e.ref.customer_name)}</td>
            <td>${esc(e.ref.equipment_type)} ${esc(e.ref.brand_model)}</td>
            <td><span class="drill-chip ${e.stage}">${e.stage === 'saldo' ? 'Saldo (entrega)' : 'Adelanto (ingreso)'}</span></td>
            <td>${esc(e.method || '-')}</td>${moneyCell(e.income)}${moneyCell(e.cost)}${moneyCell(e.profit, true)}</tr>`),
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
    'retiros': () => goTo('admin', { tab: 'admin-cash' }),
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
