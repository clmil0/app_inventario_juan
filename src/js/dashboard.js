import { supabase, getSession, fmt } from './supabase.js';

export const chartInstances = [];

let dashData = { productos: [], ventas: [], itemsVenta: [], reparaciones: [] };
let currentPeriod = 'today';

export async function loadDashboard() {
    const session = getSession();
    if (!session) return;

    // Ejecutar todas las consultas de Supabase EN PARALELO de una sola vez (8x más rápido)
    const [
        { data: productos },
        { data: ventas },
        { data: itemsVenta },
        { data: reparaciones },
        { data: revalorizaciones },
        { data: auditoriaStock }
    ] = await Promise.all([
        supabase.from('products').select('id, cost_price, stock, min_stock'),
        supabase.from('sales').select('id, total_amount, created_at, operator_name, payment_method'),
        supabase.from('sale_items').select('sale_id, product_id, product_name, quantity, unit_cost'),
        supabase.from('repairs').select('*'),
        supabase.from('inventory_revaluations').select('*'),
        supabase.from('stock_audit').select('*')
    ]);

    dashData = {
        productos: productos || [],
        ventas: ventas || [],
        itemsVenta: itemsVenta || [],
        reparaciones: reparaciones || [],
        revalorizaciones: revalorizaciones || [],
        auditoriaStock: auditoriaStock || []
    };

    currentPeriod = 'today';
    initDashboardFilters();
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

function isDateInPeriod(dateStr, period) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
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

function updateKPIs() {
    try {
        const { productos, revalorizaciones } = dashData;
        const mapaCostos = {};
        let montoInvertidoVentas = 0;
        let stockBajosCount = 0;

        productos?.forEach(p => {
            const cost = parseFloat(p.cost_price || 0);
            const stock = parseInt(p.stock || 0);
            const minStock = parseInt(p.min_stock || 0);
            mapaCostos[p.id] = cost;
            montoInvertidoVentas += (cost * stock);
            if (stock <= minStock) stockBajosCount++;
        });

        const { ventas: filteredVentas, itemsVenta: filteredItems, isRepairMatch } = getFilteredData(true);

        const totalVentasCount = filteredVentas.length;
        const totalIngresosVentas = filteredVentas.reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);

        let costoTotalVentas = 0;
        filteredItems.forEach(item => {
            const costoUnitario = item.unit_cost !== undefined && item.unit_cost !== null ? parseFloat(item.unit_cost) : (mapaCostos[item.product_id] || 0);
            costoTotalVentas += costoUnitario * parseInt(item.quantity || 0);
        });

        const gananciaVentas = totalIngresosVentas - costoTotalVentas;

        const opFilter = document.getElementById('dash-filter-operator')?.value || 'all';
        const payFilter = document.getElementById('dash-filter-payment')?.value || 'all';

        let gananciaInversion = 0;
        if (opFilter === 'all' && payFilter === 'all') {
            const filteredReval = revalorizaciones?.filter(r => isDateInPeriod(r.created_at, currentPeriod)) || [];
            gananciaInversion = filteredReval.reduce((sum, r) => sum + parseFloat(r.revaluation_profit || 0), 0);
        }

        let gananciaReparaciones = 0;
        let ingresosReparaciones = 0;
        let totalReparacionesCount = 0;
        const returnedStatuses = ['NO REPARADO', 'NO_REPARADO', 'NO REPARABLE', 'DEVUELTO', 'CANCELADO', 'RECHAZADO'];

        dashData.reparaciones?.forEach(r => {
            const isReturned = returnedStatuses.includes(String(r.status || '').toUpperCase());
            const advance = parseFloat(r.advance_payment || 0);
            const total = parseFloat(r.total_amount || 0);
            const partsCost = parseFloat(r.internal_parts_cost || 0);
            const extCost = parseFloat(r.internal_external_cost || 0);
            const totalInsumos = partsCost + extCost;

            let includedInPeriod = false;

            if (isDateInPeriod(r.created_at, currentPeriod) && isRepairMatch(r, r.advance_payment_method)) {
                const ingresoAdelanto = isReturned ? 0 : advance;
                gananciaReparaciones += (ingresoAdelanto - totalInsumos);
                ingresosReparaciones += ingresoAdelanto;
                includedInPeriod = true;
            }

            if (r.status === 'ENTREGADO' && !isReturned) {
                const deliveryDate = r.delivered_at || r.updated_at || r.created_at;
                if (isDateInPeriod(deliveryDate, currentPeriod) && isRepairMatch(r, r.final_payment_method)) {
                    const saldoRestante = Math.max(0, total - advance);
                    gananciaReparaciones += saldoRestante;
                    ingresosReparaciones += saldoRestante;
                    includedInPeriod = true;
                }
            }

            if (includedInPeriod) totalReparacionesCount++;
        });

        const gananciaTotal = gananciaVentas + gananciaInversion + gananciaReparaciones;

        setKPI('kpi-ganancia-total', fmt(gananciaTotal));
        setKPI('kpi-ganancia-reparaciones', fmt(gananciaReparaciones));
        setKPI('kpi-ganancia-ventas', fmt(gananciaVentas));
        setKPI('kpi-ingresos-ventas', fmt(totalIngresosVentas));
        setKPI('kpi-ingresos-reparaciones', fmt(ingresosReparaciones));
        setKPI('kpi-invertido-ventas', fmt(montoInvertidoVentas));
        setKPI('kpi-total-ventas', totalVentasCount);
        setKPI('kpi-total-reparaciones', totalReparacionesCount);
        setKPI('kpi-stock-bajo', stockBajosCount);
    } catch (e) {
        console.error('Error cargando KPIs:', e);
    }
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
        const days = [];
        for (let i = 14; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d.toISOString().split('T')[0]);
        }

        const salesByDay = {};
        days.forEach(d => salesByDay[d] = 0);
        ventas?.forEach(s => {
            if (!s.created_at) return;
            const day = s.created_at.split('T')[0];
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

        const allEvents = [];
        dashData.itemsVenta?.forEach(item => {
            const sale = dashData.ventas?.find(v => v.id === item.sale_id);
            if (sale && sale.created_at) {
                allEvents.push({ type: 'sale', product_id: item.product_id, qty: parseInt(item.quantity) || 0, date: sale.created_at });
            }
        });
        
        dashData.auditoriaStock?.forEach(audit => {
            if (audit.movement_type === 'VENTA') return; // ya manejado arriba
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
                const evDay = ev.date.split('T')[0];
                if (evDay <= day) break; // pertenece a este día o al pasado (todavía no lo reversamos)
                
                const state = productState[ev.product_id];
                if (state) {
                    if (ev.type === 'sale') state.stock += ev.qty;
                    else if (ev.type === 'audit') state.stock -= ev.qty_change;
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