const express = require('express');
const router = express.Router();
const db = require('../db');

// --- PRODUCTOS (Admin) ---
// Crear producto
router.post('/products', (req, res) => {
    const data = req.body;
    try {
        const stmt = db.prepare(`
            INSERT INTO products (code, name, brand, cost_price, sale_price, stock, min_stock, category_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        // Generar un código secuencial simple para local (ej. PROD-ID)
        const tempCode = 'PROD-' + Date.now().toString(36);
        const info = stmt.run(
            tempCode, data.name, data.brand || '', data.cost_price || 0, 
            data.sale_price || 0, data.stock || 0, data.min_stock || 5, data.category_id || 1
        );
        
        // Actualizar con código real basado en ID si es necesario (así era en el readme original)
        const finalCode = `${data.category_id || 1}00${info.lastInsertRowid}`;
        db.prepare('UPDATE products SET code = ? WHERE id = ?').run(finalCode, info.lastInsertRowid);
        
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Añadir stock
router.post('/stock/add', (req, res) => {
    const { product_id, quantity, user, notes } = req.body;
    try {
        const updateStock = db.transaction(() => {
            const product = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(product_id);
            if (!product) throw new Error('Producto no encontrado');

            const newStock = product.stock + parseInt(quantity);
            db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(newStock, product_id);
            
            db.prepare(`
                INSERT INTO stock_audit (product_id, product_name, quantity_change, previous_stock, new_stock, operator_name, movement_type, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(product_id, product.name, quantity, product.stock, newStock, user || 'admin', 'INGRESO_PROVEEDOR', notes || '');
        });
        
        updateStock();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener auditoría de stock
router.get('/stock/audit', (req, res) => {
    try {
        const audit = db.prepare('SELECT * FROM stock_audit ORDER BY created_at DESC LIMIT 500').all();
        res.json(audit);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- CATEGORÍAS ---
router.post('/categories', (req, res) => {
    try {
        const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(req.body.name);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/categories/:id', (req, res) => {
    try {
        db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(req.body.name, req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- CONFIGURACIÓN (Equipos y Marcas) ---
router.get('/equipment-types', (req, res) => {
    try {
        const items = db.prepare('SELECT * FROM equipment_types ORDER BY name ASC').all();
        res.json(items);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/equipment-types', (req, res) => {
    try {
        db.prepare('INSERT INTO equipment_types (name) VALUES (?)').run(req.body.name);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/brand-models', (req, res) => {
    try {
        const items = db.prepare('SELECT * FROM brand_models ORDER BY name ASC').all();
        res.json(items);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/brand-models', (req, res) => {
    try {
        db.prepare('INSERT INTO brand_models (name) VALUES (?)').run(req.body.name);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Eliminar configuración general
router.delete('/config/:type/:id', (req, res) => {
    const { type, id } = req.params;
    try {
        const table = type === 'equipment' ? 'equipment_types' : 'brand_models';
        // Solo construimos la consulta aquí porque no podemos parametrizar nombres de tablas en sqlite3
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
