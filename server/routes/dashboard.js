const express = require('express');
const router = express.Router();
const db = require('../db');

// Obtener toda la data en crudo para el dashboard de una sola vez
router.get('/raw', (req, res) => {
    try {
        const productos = db.prepare('SELECT id, cost_price, stock, min_stock FROM products').all();
        const ventas = db.prepare('SELECT id, total_amount, created_at, operator_name, payment_method FROM sales').all();
        const itemsVenta = db.prepare('SELECT sale_id, product_id, product_name, quantity, unit_cost FROM sale_items').all();
        const reparaciones = db.prepare('SELECT * FROM repairs').all();
        const revalorizaciones = db.prepare('SELECT * FROM inventory_revaluations').all();
        const auditoriaStock = db.prepare('SELECT * FROM stock_audit').all();

        res.json({
            productos,
            ventas,
            itemsVenta,
            reparaciones,
            revalorizaciones,
            auditoriaStock
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
