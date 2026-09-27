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

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'La venta no tiene productos' });
    }
    for (const item of items) {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
            return res.status(400).json({ error: `Cantidad inválida para "${item.product_name}"` });
        }
    }
    const discount = Number(discount_amount) || 0;
    if (discount < 0 || discount > Number(subtotal_amount)) {
        return res.status(400).json({ error: 'El descuento no puede ser negativo ni mayor al subtotal' });
    }

    // Generar código de ticket simulado
    const ticketCode = 'v-' + Date.now().toString(36);

    try {
        // Ejecutar en transacción
        const insertSale = db.transaction(() => {
            // Validar stock ANTES de registrar nada (el carrito puede estar desactualizado si otra
            // venta/reparación consumió el stock mientras tanto). Se agrupa por producto por si se repite.
            const qtyByProduct = new Map();
            for (const item of items) qtyByProduct.set(item.product_id, (qtyByProduct.get(item.product_id) || 0) + item.quantity);
            for (const [productId, qty] of qtyByProduct) {
                const prod = db.prepare('SELECT name, stock, is_active FROM products WHERE id = ?').get(productId);
                if (!prod || !prod.is_active) throw Object.assign(new Error('Uno de los productos ya no existe'), { status: 409 });
                if (prod.stock < qty) throw Object.assign(new Error(`Stock insuficiente de "${prod.name}" (disponible: ${prod.stock})`), { status: 409 });
            }

            const stmt = db.prepare(`
                INSERT INTO sales (ticket_code, operator_name, customer_name, subtotal_amount, discount_amount, total_amount, payment_method)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const info = stmt.run(ticketCode, operator_name, customer_name, subtotal_amount, discount, total_amount, payment_method);
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
                updateStock.run(item.quantity, item.product_id);
                insertAudit.run(
                    item.product_id, item.product_name, -item.quantity,
                    prod.stock, prod.stock - item.quantity,
                    operator_name, 'VENTA', saleId, ticketCode
                );
            }

            return { id: saleId, ticket_code: ticketCode };
        });

        const result = insertSale();
        res.json({ success: true, data: [result] }); // Retorna en formato esperado por el frontend
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Anular una venta: devuelve el stock, registra la auditoría y elimina la venta, todo o nada.
// (Antes se hacía con varias llamadas sueltas desde el navegador: si una fallaba a medias el stock
// quedaba devuelto pero la venta seguía existiendo, y al reintentar se devolvía el stock dos veces.)
router.post('/:id/void', (req, res) => {
    const saleId = Number(req.params.id);
    const { operator_name } = req.body || {};
    try {
        const voidSale = db.transaction(() => {
            const sale = db.prepare('SELECT id, ticket_code FROM sales WHERE id = ?').get(saleId);
            if (!sale) throw Object.assign(new Error('La venta no existe (¿ya fue anulada?)'), { status: 404 });

            const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
            for (const item of items) {
                const prod = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id);
                if (!prod) continue;
                const newStock = prod.stock + item.quantity;
                db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(newStock, item.product_id);
                db.prepare(`
                    INSERT INTO stock_audit (product_id, product_name, quantity_change, previous_stock, new_stock, operator_name, movement_type, reference_id, reference_code, notes)
                    VALUES (?, ?, ?, ?, ?, ?, 'DEVOLUCION_CLIENTE', ?, ?, ?)
                `).run(item.product_id, item.product_name, item.quantity, prod.stock, newStock, operator_name || 'Sistema',
                    saleId, sale.ticket_code, `Anulación de Venta (Ticket: ${sale.ticket_code})`);
            }
            db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
            db.prepare('DELETE FROM sales WHERE id = ?').run(saleId);
        });
        voidSale();
        res.json({ success: true });
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

module.exports = router;
