import { API, fmt } from './utils.js';
const Chart = window.Chart;

export const chartInstances = [];

export async function loadDashboard() {
    await loadKPIs();
    // Esperar un poco a que los canvas estén listos y tengan dimensiones
    await new Promise(resolve => setTimeout(resolve, 50));
    await loadCharts();
}

async function loadKPIs() {
    try {
        const res = await fetch(`${API}/dashboard/kpis`);
        const d = await res.json();
        document.getElementById("kpi-ganancia").textContent = fmt(d.ganancia_total);
        document.getElementById("kpi-capital").textContent = fmt(d.capital_invertido);
        document.getElementById("kpi-cobrar").textContent = fmt(d.cuentas_por_cobrar);
        document.getElementById("kpi-ventas").textContent = fmt(d.ventas_totales);
        document.getElementById("kpi-reparaciones").textContent = fmt(d.reparaciones_totales);
        document.getElementById("kpi-hoy").textContent = fmt(d.ventas_hoy);
        document.getElementById("kpi-stock-bajo").textContent = `${d.productos_stock_bajo} producto${d.productos_stock_bajo !== 1 ? "s" : ""}`;
        document.getElementById("kpi-ticket").textContent = fmt(d.ticket_promedio);
    } catch (e) { console.error("Error KPIs:", e); }
}

async function loadCharts() {
    // Destruir gráficos existentes
    chartInstances.forEach(c => { try { c.destroy(); } catch (e) { } });
    chartInstances.length = 0;

    // Gráfico de ventas 30 días
    const canvasSales = document.getElementById("chart-sales");
    if (canvasSales) {
        try {
            const res = await fetch(`${API}/dashboard/sales-chart`);
            const data = await res.json();
            const ctx = canvasSales.getContext("2d");
            chartInstances.push(new Chart(ctx, {
                type: "bar",
                data: {
                    labels: data.map(d => d.date),
                    datasets: [{
                        label: "Ventas (S/)",
                        data: data.map(d => d.total),
                        backgroundColor: "rgba(96,165,250,0.3)",
                        borderColor: "rgba(96,165,250,0.9)",
                        borderWidth: 1.5,
                        borderRadius: 4,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: "#5a6480", maxTicksLimit: 10, font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.04)" } },
                        y: { ticks: { color: "#5a6480", callback: v => `S/${v}` }, grid: { color: "rgba(255,255,255,0.04)" } }
                    }
                }
            }));
        } catch (e) { console.error("Error sales-chart:", e); }
    } else {
        console.warn("No se encontró el canvas chart-sales");
    }

    // Top productos
    const canvasTop = document.getElementById("chart-top-products");
    if (canvasTop) {
        try {
            const res = await fetch(`${API}/dashboard/top-products`);
            const data = await res.json();
            const ctx = canvasTop.getContext("2d");
            chartInstances.push(new Chart(ctx, {
                type: "doughnut",
                data: {
                    labels: data.map(d => d.product),
                    datasets: [{
                        data: data.map(d => d.quantity),
                        backgroundColor: ["rgba(96,165,250,0.8)", "rgba(167,139,250,0.8)", "rgba(52,211,153,0.8)", "rgba(251,191,36,0.8)", "rgba(248,113,113,0.8)"],
                        borderColor: "rgba(255,255,255,0.1)",
                        borderWidth: 1,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: "right", labels: { color: "#8a95b0", font: { size: 11 }, boxWidth: 12 } } },
                }
            }));
        } catch (e) { console.error("Error top-products:", e); }
    } else {
        console.warn("No se encontró el canvas chart-top-products");
    }

    // Reparaciones por estado
    const canvasRepairs = document.getElementById("chart-repairs-status");
    if (canvasRepairs) {
        try {
            const res = await fetch(`${API}/dashboard/repairs-by-status`);
            const data = await res.json();
            const ctx = canvasRepairs.getContext("2d");
            const statusColors = {
                "PENDIENTE": "rgba(251,191,36,0.7)",
                "EN_DIAGNOSTICO": "rgba(96,165,250,0.7)",
                "EN_PROCESO": "rgba(167,139,250,0.7)",
                "TERMINADO": "rgba(52,211,153,0.7)",
                "ENTREGADO": "rgba(90,100,128,0.7)",
            };
            chartInstances.push(new Chart(ctx, {
                type: "bar",
                data: {
                    labels: data.map(d => d.status.replace("_", " ")),
                    datasets: [{
                        label: "Reparaciones",
                        data: data.map(d => d.count),
                        backgroundColor: data.map(d => statusColors[d.status] || "rgba(255,255,255,0.3)"),
                        borderRadius: 4,
                    }]
                },
                options: {
                    indexAxis: "y",
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: "#5a6480", stepSize: 1 }, grid: { color: "rgba(255,255,255,0.04)" } },
                        y: { ticks: { color: "#8a95b0" }, grid: { display: false } }
                    }
                }
            }));
        } catch (e) { console.error("Error repairs-chart:", e); }
    } else {
        console.warn("No se encontró el canvas chart-repairs-status");
    }
}