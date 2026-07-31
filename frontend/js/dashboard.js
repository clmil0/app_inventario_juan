import { supabase, getSession, fmt } from './supabase.js';

export const chartInstances = [];

export async function loadDashboard() {
    await loadKPIs();
    await loadCharts();
}

async function loadKPIs() {
    try {
        const session = getSession();
        if (!session) return;

        // Ventas totales del mes actual
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

        const { data: ventasMes } = await supabase
            .from('sales')
            .select('total_amount, discount_amount')
            .gte('created_at', startOfMonth)
            .lte('created_at', endOfMonth);

        const totalVentas = ventasMes?.reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0) || 0;
        const totalDescuentos = ventasMes?.reduce((sum, s) => sum + parseFloat(s.discount_amount || 0), 0) || 0;

        // Ventas de hoy
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

        const { data: ventasHoy } = await supabase
            .from('sales')
            .select('total_amount')
            .gte('created_at', startOfDay)
            .lte('created_at', endOfDay);

        const totalHoy = ventasHoy?.reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0) || 0;
        const countHoy = ventasHoy?.length || 0;

        // Productos con stock bajo
        const { data: stockBajo } = await supabase
            .from('products')
            .select('id')
            .lte('stock', supabase.raw('min_stock'));

        // Reparaciones pendientes (saldo por cobrar)
        const { data: reparaciones } = await supabase
            .from('repairs')
            .select('remaining_balance, status');

        const pendienteCobrar = reparaciones
            ?.filter(r => r.status !== 'ENTREGADO')
            ?.reduce((sum, r) => sum + parseFloat(r.remaining_balance || 0), 0) || 0;

        const countReparaciones = reparaciones?.length || 0;
        const countPendientes = reparaciones?.filter(r => r.status === 'PENDIENTE').length || 0;

        // Capital (suma de cost_price * stock de todos los productos)
        const { data: productos } = await supabase
            .from('products')
            .select('cost_price, stock');
        const capital = productos?.reduce((sum, p) => sum + (parseFloat(p.cost_price || 0) * p.stock), 0) || 0;

        // Total de ventas
        const { count: totalVentasCount } = await supabase
            .from('sales')
            .select('*', { count: 'exact', head: true });

        // Ticket promedio
        const ticketPromedio = totalVentasCount > 0 ? totalVentas / totalVentasCount : 0;

        setKPI('kpi-ganancia', fmt(totalVentas));
        setKPI('kpi-capital', fmt(capital));
        setKPI('kpi-cobrar', fmt(pendienteCobrar));
        setKPI('kpi-ventas', totalVentasCount || 0);
        setKPI('kpi-reparaciones', countPendientes);
        setKPI('kpi-hoy', fmt(totalHoy));
        setKPI('kpi-stock-bajo', stockBajo?.length || 0);
        setKPI('kpi-ticket', fmt(ticketPromedio));

    } catch (e) {
        console.error('Error cargando KPIs:', e);
    }
}

function setKPI(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

async function loadCharts() {
    try {
        const Chart = window.Chart;
        if (!Chart) return;

        // Gráfico de ventas últimos 30 días
        const days = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d.toISOString().split('T')[0]);
        }

        const { data: salesData } = await supabase
            .from('sales')
            .select('created_at, total_amount')
            .gte('created_at', days[0])
            .order('created_at');

        const salesByDay = {};
        days.forEach(d => salesByDay[d] = 0);
        salesData?.forEach(s => {
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
        const { data: topProducts } = await supabase
            .from('sale_items')
            .select('product_name, quantity')
            .order('quantity', { ascending: false })
            .limit(10);

        const productSales = {};
        topProducts?.forEach(item => {
            productSales[item.product_name] = (productSales[item.product_name] || 0) + item.quantity;
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
        const { data: repairsData } = await supabase
            .from('repairs')
            .select('status');

        const statusCount = {
            PENDIENTE: 0,
            EN_DIAGNOSTICO: 0,
            EN_PROCESO: 0,
            TERMINADO: 0,
            ENTREGADO: 0
        };

        repairsData?.forEach(r => {
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