const express = require('express');
const router = express.Router();
const db = require('../db');

// Obtener todas las ventas con sus items (historial)
router.get('/', (req, res) => {
    try {
        const sales = db.prepare('SELECT * FROM sales ORDER BY created_at DESC').all();
        
        // Obtener todos los items de ventas recientes
        const items = db.prepare('SELECT * FROM sale_items').all();
        
        const salesWithItems = sales.map(sale => ({
            ...sale,
            items: items.filter(i => i.sale_id === sale.id)
        }));
        
        res.json(salesWithItems);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Crear una venta nueva
router.post('/', (req, res) => {
    const { operator_name, customer_name, subtotal_amount, discount_amount, total_amount, payment_method, items } = req.body;
    
    // Generar código de ticket simulado
    const ticketCode = 'v-' + Date.now().toString(36);

    try {
        // Ejecutar en transacción
        const insertSale = db.transaction(() => {
            const stmt = db.prepare(`
                INSERT INTO sales (ticket_code, operator_name, customer_name, subtotal_amount, discount_amount, total_amount, payment_method)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const info = stmt.run(ticketCode, operator_name, customer_name, subtotal_amount, discount_amount, total_amount, payment_method);
            const saleId = info.lastInsertRowid;

            const insertItem = db.prepare(`
                INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity, subtotal, unit_cost)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
            const insertAudit = db.prepare(`
                INSERT INTO stock_audit (product_id, product_name, quantity_change, previous_stock, new_stock, operator_name, movement_type, reference_id, reference_code)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const item of items) {
                insertItem.run(saleId, item.product_id, item.product_name, item.unit_price, item.quantity, item.subtotal, item.unit_cost || 0);
                
                // Actualizar y auditar stock
                const prod = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id);
                if (prod) {
                    updateStock.run(item.quantity, item.product_id);
                    insertAudit.run(
                        item.product_id, item.product_name, -item.quantity, 
                        prod.stock, prod.stock - item.quantity, 
                        operator_name, 'VENTA', saleId, ticketCode
                    );
                }
            }
            
            return { id: saleId, ticket_code: ticketCode };
        });

        const result = insertSale();
        res.json({ success: true, data: [result] }); // Retorna en formato esperado por el frontend
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
