import { supabase, getSession, fmt } from './supabase.js';
import { safeAdd, safeMultiply } from './math.js';
import { buildProfitEvents, filterEvents, sumBy } from './finance.js';

export const chartInstances = [];

let dashData = { productos: [], ventas: [], itemsVenta: [], reparaciones: [] };
let currentPeriod = 'today';

export async function loadDashboard() {
    const session = getSession();
    if (!session) return;

    // Obtener data del backend local
    let rawData;
    try {
        const response = await fetch('/api/dashboard/raw');
        rawData = await response.json();
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        return;
    }

    const {
        productos,
        ventas,
        itemsVenta,
        reparaciones,
        revalorizaciones,
        auditoriaStock,
        retiros
    } = rawData;

    dashData = {
        productos: productos || [],
        ventas: ventas || [],
        itemsVenta: itemsVenta || [],
        reparaciones: reparaciones || [],
        revalorizaciones: revalorizaciones || [],
        auditoriaStock: auditoriaStock || [],
        retiros: retiros || []
    };

    currentPeriod = 'today';
    initDashboardFilters();
    bindKpiClicks();
    updateKPIs();
    loadCharts(dashData);
}

function initDashboardFilters() {
    const pills = document.querySelectorAll('.filter-pill');
    const customPicker = document.getElementById('custom-date-container');
    const applyBtn = document.getElementById('apply-custom-date-btn');

    pills.forEach(pill => {
        pill.addEventListener('click', () => {
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentPeriod = pill.dataset.period || 'all';
            if (currentPeriod === 'custom') {
                customPicker?.classList.remove('hidden');
            } else {
                customPicker?.classList.add('hidden');
                updateKPIs();
            }
        });
    });

    applyBtn?.addEventListener('click', () => {
        if (currentPeriod === 'custom') { updateKPIs(); loadChartsWithFilters(); }
    });

    document.getElementById('dash-filter-operator')?.addEventListener('change', () => { updateKPIs(); loadChartsWithFilters(); });
    document.getElementById('dash-filter-payment')?.addEventListener('change', () => { updateKPIs(); loadChartsWithFilters(); });

    populateDropdownFilters();
}

function loadChartsWithFilters() {
    const { ventas, itemsVenta, reparaciones } = getFilteredData(false);
    loadCharts({ ventas, itemsVenta, reparaciones });
}

function populateDropdownFilters() {
    const opSelect = document.getElementById('dash-filter-operator');
    const paySelect = document.getElementById('dash-filter-payment');
    
    if (!opSelect || !paySelect) return;

    const operators = new Set();
    const payments = new Set();

    dashData.ventas?.forEach(s => {
        if (s.operator_name) operators.add(s.operator_name);
        if (s.payment_method) payments.add(s.payment_method);
    });

    dashData.reparaciones?.forEach(r => {
        if (r.operator_name) operators.add(r.operator_name);
        if (r.advance_payment_method) payments.add(r.advance_payment_method);
        if (r.final_payment_method) payments.add(r.final_payment_method);
    });

    opSelect.innerHTML = '<option value="all">Todas</option>';
    [...operators].sort().forEach(op => {
        const opt = document.createElement('option');
        opt.value = op;
        opt.textContent = op;
        opSelect.appendChild(opt);
    });

    paySelect.innerHTML = '<option value="all">Todos</option>';
    [...payments].sort().forEach(pay => {
        const opt = document.createElement('option');
        opt.value = pay;
        opt.textContent = pay;
        paySelect.appendChild(opt);
    });
}

// 'YYYY-MM-DD' en hora local
function localDayKey(dateOrStr) {
    const d = new Date(dateOrStr);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isDateInPeriod(dateStr, period) {
    if (!dateStr) return false;
    // Fix para SQLite: agregar 'Z' si es formato UTC sin zona horaria
    let parseStr = dateStr;
    if (typeof parseStr === 'string' && !parseStr.endsWith('Z') && !parseStr.includes('T')) {
        parseStr = parseStr.replace(' ', 'T') + 'Z';
    }
    const d = new Date(parseStr);
    if (isNaN(d.getTime())) return false;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (period === 'all') {
        return true;
    } else if (period === 'today') {
        return d >= startOfToday && d <= endOfToday;
    } else if (period === 'yesterday') {
        const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
        const endOfYesterday = new Date(endOfToday.getTime() - 86400000);
        return d >= startOfYesterday && d <= endOfYesterday;
    } else if (period === 'week') {
        const day = now.getDay() || 7; // Lunes como inicio de semana (1)
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek.getTime() + 7 * 86400000 - 1);
        return d >= startOfWeek && d <= endOfWeek;
    } else if (period === 'month') {
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    } else if (period === 'semester') {
        const currentSem = now.getMonth() < 6 ? 0 : 1;
        const targetSem = d.getMonth() < 6 ? 0 : 1;
        return d.getFullYear() === now.getFullYear() && currentSem === targetSem;
    } else if (period === 'year') {
        return d.getFullYear() === now.getFullYear();
    } else if (period === 'custom') {
        const fromVal = document.getElementById('dash-date-from')?.value;
        const toVal = document.getElementById('dash-date-to')?.value;
        if (fromVal && d < new Date(fromVal + 'T00:00:00')) return false;
        if (toVal && d > new Date(toVal + 'T23:59:59.999')) return false;
        return true;
    }
    return true;
}

function getFilteredData(filterByPeriod = true) {
    const opFilter = document.getElementById('dash-filter-operator')?.value || 'all';
    const payFilter = document.getElementById('dash-filter-payment')?.value || 'all';

    const isSaleMatch = (s) => {
        if (opFilter !== 'all' && s.operator_name !== opFilter) return false;
        if (payFilter !== 'all' && s.payment_method !== payFilter) return false;
        if (filterByPeriod && !isDateInPeriod(s.created_at, currentPeriod)) return false;
        return true;
    };

    const isRepairMatch = (r, componentPaymentMethod) => {
        if (opFilter !== 'all' && r.operator_name !== opFilter) return false;
        if (payFilter !== 'all' && componentPaymentMethod !== payFilter) return false;
        return true;
    };

    const filteredVentas = dashData.ventas?.filter(isSaleMatch) || [];
    const filteredSaleIds = new Set(filteredVentas.map(s => s.id));
    const filteredItems = dashData.itemsVenta?.filter(item => filteredSaleIds.has(item.sale_id)) || [];

    // Repairs require special logic for charts if we strictly filter them.
    // For now, we'll return repairs that match the operator and where AT LEAST ONE payment method matches (if payFilter is set).
    const filteredReparaciones = dashData.reparaciones?.filter(r => {
        if (opFilter !== 'all' && r.operator_name !== opFilter) return false;
        if (payFilter !== 'all') {
            if (r.advance_payment_method !== payFilter && r.final_payment_method !== payFilter) return false;
        }
        return true; // We don't filter repairs by period here because loadCharts handles it for 30-day view
    }) || [];

    return { ventas: filteredVentas, itemsVenta: filteredItems, reparaciones: filteredReparaciones, isRepairMatch };
}

// Últimos eventos calculados (para el detalle al hacer clic en un KPI)
let lastKpiState = null;

function updateKPIs() {
    try {
        const { productos } = dashData;
        let montoInvertidoVentas = 0;
        let stockBajosCount = 0;

        productos?.forEach(p => {
            const cost = parseFloat(p.cost_price || 0);
            const stock = parseInt(p.stock || 0);
            const minStock = parseInt(p.min_stock || 0);
            montoInvertidoVentas = safeAdd(montoInvertidoVentas, safeMultiply(cost, stock));
            if (stock <= minStock) stockBajosCount++;
        });

        const operator = document.getElementById('dash-filter-operator')?.value || 'all';
        const method = document.getElementById('dash-filter-payment')?.value || 'all';
        const events = filterEvents(buildProfitEvents(dashData), {
            inPeriod: d => isDateInPeriod(d, currentPeriod), operator, method
        });

        const salesEvents = events.filter(e => e.kind === 'venta');
        const repairEvents = events.filter(e => e.kind === 'reparacion');
        const revalEvents = events.filter(e => e.kind === 'revalorizacion');

        const totalIngresosVentas = sumBy(salesEvents, 'income');
        const gananciaVentas = sumBy(salesEvents, 'profit');
        const ingresosReparaciones = sumBy(repairEvents, 'income');
        const gananciaReparaciones = sumBy(repairEvents, 'profit');
        const gananciaInversion = sumBy(revalEvents, 'profit');
        const totalReparacionesCount = new Set(repairEvents.map(e => e.ref.id)).size;
        const gananciaTotal = safeAdd(safeAdd(gananciaVentas, gananciaInversion), gananciaReparaciones);

        // Retiros del período (no restan a la ganancia: la ganancia generada no se borra al retirar)
        const retirosPeriodo = (dashData.retiros || []).filter(r =>
            isDateInPeriod(r.created_at, currentPeriod) && (method === 'all' || r.source === method));
        const totalRetirado = sumBy(retirosPeriodo, 'amount');

        lastKpiState = { salesEvents, repairEvents, revalEvents, gananciaVentas, gananciaReparaciones, gananciaInversion, gananciaTotal, retirosPeriodo };

        setKPI('kpi-ganancia-total', fmt(gananciaTotal));
        setKPI('kpi-ganancia-reparaciones', fmt(gananciaReparaciones));
        setKPI('kpi-ganancia-ventas', fmt(gananciaVentas));
        setKPI('kpi-ingresos-ventas', fmt(totalIngresosVentas));
        setKPI('kpi-ingresos-reparaciones', fmt(ingresosReparaciones));
        setKPI('kpi-invertido-ventas', fmt(montoInvertidoVentas));
        setKPI('kpi-total-ventas', salesEvents.length);
        setKPI('kpi-total-reparaciones', totalReparacionesCount);
        setKPI('kpi-stock-bajo', stockBajosCount);
        setKPI('kpi-retiros', fmt(totalRetirado));
    } catch (e) {
        console.error('Error cargando KPIs:', e);
    }
}

// ═══ Detalle de KPIs (clic en cada cifra) ═══
const PERIOD_LABELS = {
    today: 'Hoy', yesterday: 'Ayer', week: 'Semana actual', month: 'Mes actual', year: 'Año actual', all: 'Todo el historial'
};

function periodLabel() {
    if (currentPeriod === 'custom') {
        const from = document.getElementById('dash-date-from')?.value || '…';
        const to = document.getElementById('dash-date-to')?.value || '…';
        return `${from} → ${to}`;
    }
    return PERIOD_LABELS[currentPeriod] || '';
}

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
        actions: [{ label: 'Ir a productos', onClick: () => goTo('admin', { tab: 'admin-products' }) }]
    });
}

const KPI_ACTIONS = {
    'ganancia-total': drillProfitTotal,
    'stock-bajo': () => goTo('admin', { tab: 'admin-products', lowStock: true }),
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

function setKPI(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value;
        el.title = value; // Añadir title para el tooltip nativo
    }
}

function loadCharts({ ventas, itemsVenta, reparaciones }) {
    try {
        const Chart = window.Chart;
        if (!Chart) return;

        ['chart-sales', 'chart-top-products', 'chart-repairs-status'].forEach(id => {
            const el = document.getElementById(id);
            if (el && Chart.getChart(el)) {
                Chart.getChart(el).destroy();
            }
        });
        chartInstances.forEach(c => { try { c.destroy(); } catch(e) {} });
        chartInstances.length = 0;

        // Gráfico de ventas últimos 30 días
        // Días en hora LOCAL. Antes se usaba la fecha UTC (toISOString / split('T')): las ventas después
        // de las 7pm caían en el día siguiente, y con fechas 'YYYY-MM-DD HH:MM:SS' el gráfico quedaba vacío.
        const days = [];
        for (let i = 14; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(localDayKey(d));
        }

        const salesByDay = {};
        days.forEach(d => salesByDay[d] = 0);
        ventas?.forEach(s => {
            if (!s.created_at) return;
            const day = localDayKey(s.created_at);
            if (salesByDay[day] !== undefined) {
                salesByDay[day] += parseFloat(s.total_amount || 0);
            }
        });

        const ctxSales = document.getElementById('chart-sales')?.getContext('2d');
        if (ctxSales) {
            const chart = new Chart(ctxSales, {
                type: 'bar',
                data: {
                    labels: days.map(d => {
                        const date = new Date(d + 'T00:00:00');
                        return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
                    }),
                    datasets: [{
                        label: 'Ventas (S/)',
                        data: days.map(d => salesByDay[d]),
                        backgroundColor: 'rgba(96, 165, 250, 0.5)',
                        borderColor: 'rgba(96, 165, 250, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { ticks: { color: '#8a95b0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                        x: { ticks: { color: '#8a95b0' }, grid: { display: false } }
                    }
                }
            });
            chartInstances.push(chart);
        }

        // Gráfico de Historial de Inventario (Reconstrucción)
        const inventoryHistory = {};
        days.forEach(d => inventoryHistory[d] = 0);

        let currentTotalInv = 0;
        const productState = {};
        dashData.productos.forEach(p => {
            productState[p.id] = {
                stock: parseInt(p.stock) || 0,
                cost: parseFloat(p.cost_price) || 0
            };
            currentTotalInv += productState[p.id].stock * productState[p.id].cost;
        });

        // La auditoría de stock ya registra cada venta (VENTA) y cada anulación (DEVOLUCION_CLIENTE).
        // Antes se usaban los items de venta en lugar de las filas VENTA: al anular una venta sus items
        // se borran pero la devolución seguía restándose, y el historial quedaba desfasado.
        const allEvents = [];
        dashData.auditoriaStock?.forEach(audit => {
            allEvents.push({ type: 'audit', product_id: audit.product_id, qty_change: parseInt(audit.quantity_change) || 0, date: audit.created_at });
        });

        dashData.revalorizaciones?.forEach(rev => {
            allEvents.push({ type: 'reval', product_id: rev.product_id, old_cost: parseFloat(rev.old_cost_price) || 0, date: rev.created_at });
        });

        allEvents.sort((a, b) => new Date(b.date) - new Date(a.date));

        const daysReversed = [...days].reverse();
        let eventIdx = 0;
        daysReversed.forEach(day => {
            while (eventIdx < allEvents.length) {
                const ev = allEvents[eventIdx];
                const evDay = localDayKey(ev.date);
                if (evDay <= day) break; // pertenece a este día o al pasado (todavía no lo reversamos)
                
                const state = productState[ev.product_id];
                if (state) {
                    if (ev.type === 'audit') state.stock -= ev.qty_change;
                    else if (ev.type === 'reval') state.cost = ev.old_cost;
                }
                eventIdx++;
            }
            
            let dailyTotal = 0;
            Object.values(productState).forEach(s => { dailyTotal += Math.max(0, s.stock) * s.cost; });
            inventoryHistory[day] = dailyTotal;
        });

        const ctxInvHistory = document.getElementById('chart-inventory-history')?.getContext('2d');
        if (ctxInvHistory) {
            const chart = new Chart(ctxInvHistory, {
                type: 'line',
                data: {
                    labels: days.map(d => new Date(d + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })),
                    datasets: [{
                        label: 'Inversión en Inv. (S/)',
                        data: days.map(d => inventoryHistory[d]),
                        backgroundColor: 'rgba(167, 139, 250, 0.2)',
                        borderColor: 'rgba(167, 139, 250, 1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { ticks: { color: '#8a95b0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                        x: { ticks: { color: '#8a95b0' }, grid: { display: false } }
                    }
                }
            });
            chartInstances.push(chart);
        }

        // Top 5 productos más vendidos
        const productSales = {};
        itemsVenta?.forEach(item => {
            if (!item.product_name) return;
            productSales[item.product_name] = (productSales[item.product_name] || 0) + (parseInt(item.quantity) || 0);
        });

        const sortedProducts = Object.entries(productSales)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const ctxTop = document.getElementById('chart-top-products')?.getContext('2d');
        if (ctxTop) {
            const chart = new Chart(ctxTop, {
                type: 'doughnut',
                data: {
                    labels: sortedProducts.map(p => p[0]),
                    datasets: [{
                        data: sortedProducts.map(p => p[1]),
                        backgroundColor: ['#60a5fa', '#34d399', '#a78bfa', '#fbbf24', '#f87171'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: { color: '#8a95b0', font: { size: 11 }, padding: 10 }
                        }
                    }
                }
            });
            chartInstances.push(chart);
        }

        // Reparaciones por estado
        const statusCount = {
            PENDIENTE: 0,
            EN_DIAGNOSTICO: 0,
            EN_PROCESO: 0,
            TERMINADO: 0,
            ENTREGADO: 0
        };

        reparaciones?.forEach(r => {
            if (statusCount[r.status] !== undefined) statusCount[r.status]++;
        });

        const statusLabels = ['Pendiente', 'Diagnóstico', 'En Proceso', 'Terminado', 'Entregado'];
        const statusValues = Object.values(statusCount);
        const statusColors = ['#fbbf24', '#60a5fa', '#a78bfa', '#34d399', '#8a95b0'];

        const ctxRepairs = document.getElementById('chart-repairs-status')?.getContext('2d');
        if (ctxRepairs) {
            const chart = new Chart(ctxRepairs, {
                type: 'bar',
                data: {
                    labels: statusLabels,
                    datasets: [{
                        label: 'Cantidad',
                        data: statusValues,
                        backgroundColor: statusColors,
                        borderWidth: 0
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#8a95b0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                        y: { ticks: { color: '#8a95b0' }, grid: { display: false } }
                    }
                }
            });
            chartInstances.push(chart);
        }

    } catch (e) {
        console.error('Error cargando gráficos:', e);
    }
}

// ═══ Realtime Sync ═══
window.addEventListener('supabase_realtime', async (e) => {
    if (document.querySelector('.nav-item[data-view="dashboard"]')?.classList.contains('active') || document.querySelector('.mobile-nav-item[data-target="dashboard"]')?.classList.contains('active')) {
        chartInstances.forEach(c => { try { c.destroy(); } catch (err) {} });
        chartInstances.length = 0;
        await loadDashboard();
    }
});