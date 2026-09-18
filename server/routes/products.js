const express = require('express');
const router = express.Router();
const db = require('../db');

// Obtener categorías
router.get('/categories', (req, res) => {
    try {
        const categories = db.prepare('SELECT * FROM categories ORDER BY id ASC').all();
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener todos los productos
router.get('/', (req, res) => {
    try {
        const products = db.prepare(`
            SELECT p.*, c.name as category_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.is_active = 1
            ORDER BY p.name ASC
        `).all();
        // El frontend espera is_favorite como boolean
        const formattedProducts = products.map(p => ({
            ...p,
            is_favorite: p.is_favorite === 1
        }));
        res.json(formattedProducts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cambiar estado favorito
router.put('/:id/toggle-favorite', (req, res) => {
    const { id } = req.params;
    const { is_favorite } = req.body;
    
    try {
        const stmt = db.prepare('UPDATE products SET is_favorite = ? WHERE id = ?');
        stmt.run(is_favorite ? 1 : 0, id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Actualizar precio de producto
router.put('/:id/price', (req, res) => {
    const { id } = req.params;
    const { cost_price, sale_price, user_id } = req.body;
    
    try {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

        const updateStmt = db.prepare('UPDATE products SET cost_price = ?, sale_price = ? WHERE id = ?');
        updateStmt.run(cost_price, sale_price, id);

        // Guardar historial
        const historyStmt = db.prepare(`
            INSERT INTO price_history (product_id, old_cost_price, new_cost_price, old_sale_price, new_sale_price, changed_by)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        historyStmt.run(id, product.cost_price, cost_price, product.sale_price, sale_price, user_id || 'admin');

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
