const db = require('./db');
// This script would normally use @supabase/supabase-js, but we'll leave it prepared
// so the user can just add their Supabase URL and KEY.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase = null;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

async function syncDashboardData() {
    if (!supabase) {
        console.log("⚠️ Supabase credentials not found in .env. Skipping cloud sync.");
        return;
    }
    
    console.log("🔄 Sincronizando datos del dashboard con Supabase (Cloud)...");

    try {
        // 1. Calcular KPIs Globales
        const products = db.prepare('SELECT cost_price, stock FROM products WHERE stock > 0').all();
        let totalCapital = 0;
        let lowStockCount = 0;
        
        products.forEach(p => {
            totalCapital += (p.cost_price * p.stock);
            // using 5 as a hardcoded min_stock for the example, though it's in the DB
        });
        
        lowStockCount = db.prepare('SELECT COUNT(*) as c FROM products WHERE stock <= min_stock AND stock > 0').get().c;

        const repairsPending = db.prepare('SELECT SUM(remaining_balance) as r FROM repairs WHERE status != "ENTREGADO" AND status != "CANCELADO"').get().r || 0;

        // Mes actual
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0,0,0,0);
        const startIso = startOfMonth.toISOString();
        
        const monthSales = db.prepare('SELECT SUM(total_amount) as total, COUNT(*) as count FROM sales WHERE created_at >= ?').get(startIso);
        const monthRepairsCount = db.prepare('SELECT COUNT(*) as count FROM repairs WHERE created_at >= ?').get(startIso).count;

        const avgTicket = monthSales.count > 0 ? (monthSales.total / monthSales.count) : 0;

        await supabase.from('dashboard_global_kpis').upsert({
            id: 1,
            total_capital: totalCapital,
            total_receivables: repairsPending,
            low_stock_count: lowStockCount,
            month_sales_amount: monthSales.total || 0,
            month_repairs_count: monthRepairsCount,
            average_ticket: avgTicket,
            updated_at: new Date().toISOString()
        });

        // 2. Daily Stats (últimos 30 días)
        const days = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d.toISOString().split('T')[0]);
        }
        
        const dailyStatsInserts = [];
        days.forEach(day => {
            // Ventas
            const salesTotal = db.prepare('SELECT SUM(total_amount) as total FROM sales WHERE date(created_at) = ?').get(day).total || 0;
            
            // Reparaciones completadas
            const repCom = db.prepare('SELECT COUNT(*) as c FROM repairs WHERE status = "ENTREGADO" AND date(delivered_at) = ?').get(day).c || 0;
            
            // Nuevas reparaciones
            const repNew = db.prepare('SELECT COUNT(*) as c FROM repairs WHERE date(created_at) = ?').get(day).c || 0;
            
            dailyStatsInserts.push({
                stat_date: day,
                daily_sales_amount: salesTotal,
                daily_profit: 0, // Simplified for now
                daily_repairs_completed: repCom,
                daily_new_repairs: repNew,
                updated_at: new Date().toISOString()
            });
        });

        await supabase.from('dashboard_daily_stats').upsert(dailyStatsInserts);

        // 3. Top 5 Productos
        const topProducts = db.prepare(`
            SELECT product_id, product_name, SUM(quantity) as quantity_sold
            FROM sale_items
            GROUP BY product_id, product_name
            ORDER BY quantity_sold DESC
            LIMIT 5
        `).all();

        // Limpiar tabla top y reinsertar
        await supabase.from('dashboard_top_products').delete().neq('id', 0); // Clear all
        const topInserts = topProducts.map((p, i) => ({
            id: i + 1,
            product_id: p.product_id,
            product_name: p.product_name,
            quantity_sold: p.quantity_sold
        }));
        if(topInserts.length > 0) {
            await supabase.from('dashboard_top_products').upsert(topInserts);
        }

        // 4. Estado Reparaciones
        const statusCounts = db.prepare(`
            SELECT status, COUNT(*) as count 
            FROM repairs 
            GROUP BY status
        `).all();
        
        const statusInserts = statusCounts.map(s => ({
            status: s.status,
            count: s.count,
            updated_at: new Date().toISOString()
        }));

        if(statusInserts.length > 0) {
            await supabase.from('dashboard_repair_status').upsert(statusInserts);
        }

        console.log("✅ Sincronización Cloud exitosa.");

    } catch (error) {
        console.error("❌ Error en sincronización Cloud:", error.message);
    }
}

// Exportar para que main.js pueda llamarlo periódicamente (ej. cada hora o al cerrar caja)
module.exports = { syncDashboardData };
