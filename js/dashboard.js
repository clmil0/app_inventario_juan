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
        { data: reparaciones }
    ] = await Promise.all([
        supabase.from('products').select('id, cost_price, stock, min_stock'),
        supabase.from('sales').select('id, total_amount, created_at'),
        supabase.from('sale_items').select('sale_id, product_id, product_name, quantity'),
        supabase.from('repairs').select('*')
    ]);

    dashData = {
        productos: productos || [],
        ventas: ventas || [],
        itemsVenta: itemsVenta || [],
        reparaciones: reparaciones || []
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
        if (currentPeriod === 'custom') updateKPIs();
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

function updateKPIs() {
    try {
        const { productos, ventas, itemsVenta, reparaciones } = dashData;
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

        const filteredVentas = ventas?.filter(s => isDateInPeriod(s.created_at, currentPeriod)) || [];
        const filteredSaleIds = new Set(filteredVentas.map(s => s.id));
        const filteredItems = itemsVenta?.filter(item => filteredSaleIds.has(item.sale_id)) || [];

        const totalVentasCount = filteredVentas.length;
        const totalIngresosVentas = filteredVentas.reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);

        let costoTotalVentas = 0;
        filteredItems.forEach(item => {
            const costoUnitario = mapaCostos[item.product_id] || 0;
            costoTotalVentas += costoUnitario * parseInt(item.quantity || 0);
        });

        const gananciaVentas = totalIngresosVentas - costoTotalVentas;

        const filteredReparaciones = reparaciones?.filter(r => isDateInPeriod(r.created_at, currentPeriod)) || [];
        const totalReparacionesCount = filteredReparaciones.length;
        
        // Cálculo de Ganancia de Reparaciones según flujo de caja de taller:
        // 1) Al crearse (en el periodo), se suma el adelanto y se restan insumos/costos. Si se devuelve/no se repara, adelanto=0.
        // 2) Al entregarse (en el periodo de entrega), se suma el saldo restante por cobrar.
        let gananciaReparaciones = 0;
        const returnedStatuses = ['NO REPARADO', 'NO_REPARADO', 'NO REPARABLE', 'DEVUELTO', 'CANCELADO', 'RECHAZADO'];

        reparaciones?.forEach(r => {
            const isReturned = returnedStatuses.includes(String(r.status || '').toUpperCase());
            const advance = parseFloat(r.advance_payment || 0);
            const total = parseFloat(r.total_amount || 0);
            const partsCost = parseFloat(r.internal_parts_cost || 0);
            const extCost = parseFloat(r.internal_external_cost || 0);
            const totalInsumos = partsCost + extCost;

            // Componente 1: Fecha de creación
            if (isDateInPeriod(r.created_at, currentPeriod)) {
                const ingresoAdelanto = isReturned ? 0 : advance;
                gananciaReparaciones += (ingresoAdelanto - totalInsumos);
            }

            // Componente 2: Fecha de entrega (cobro del saldo restante)
            if (r.status === 'ENTREGADO' && !isReturned) {
                const deliveryDate = r.delivered_at || r.updated_at || r.created_at;
                if (isDateInPeriod(deliveryDate, currentPeriod)) {
                    const saldoRestante = Math.max(0, total - advance);
                    gananciaReparaciones += saldoRestante;
                }
            }
        });

        const gananciaTotal = gananciaVentas + gananciaReparaciones;

        setKPI('kpi-ganancia-total', fmt(gananciaTotal));
        setKPI('kpi-ganancia-reparaciones', fmt(gananciaReparaciones));
        setKPI('kpi-ganancia-ventas', fmt(gananciaVentas));
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
        for (let i = 29; i >= 0; i--) {
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