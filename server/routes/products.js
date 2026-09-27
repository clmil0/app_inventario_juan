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

// Genera el código del producto con el formato histórico: categoría*1000 + secuencia, a 6 dígitos (ej. 002015).
// Antes se calculaba en el navegador tomando el mayor código de productos que HOY están en la categoría;
// si un producto se había movido de categoría (o se borró una categoría) se repetía un código existente
// y el INSERT OR IGNORE del proxy descartaba el producto en silencio mostrando "creado exitosamente".
function generateProductCode(categoryId) {
    const used = new Set(db.prepare('SELECT code FROM products').all().map(r => r.code));
    const base = categoryId * 1000;
    let maxSeq = 0;
    for (const code of used) {
        if (!/^\d+$/.test(code)) continue;
        const n = parseInt(code, 10);
        if (n > base && n < base + 1000) maxSeq = Math.max(maxSeq, n - base);
    }
    const fmtCode = (seq) => String(base + seq).padStart(6, '0');
    for (let seq = maxSeq + 1; seq <= 999; seq++) {
        if (!used.has(fmtCode(seq))) return fmtCode(seq);
    }
    // Secuencia llena: reutilizar huecos libres dentro del rango de la categoría
    for (let seq = 1; seq <= maxSeq; seq++) {
        if (!used.has(fmtCode(seq))) return fmtCode(seq);
    }
    // Más de 999 productos en la categoría: código con sufijo único
    let code;
    let i = 1;
    do { code = `${String(categoryId).padStart(3, '0')}-${i++}`; } while (used.has(code));
    return code;
}

function isNonNegativeNumber(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

// Crear producto (con stock inicial y su registro en auditoría, todo en una transacción)
router.post('/', (req, res) => {
    const { name, brand, category_id, cost_price, sale_price, stock, min_stock, is_favorite, operator_name } = req.body || {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const categoryId = Number(category_id);
    const cost = Number(cost_price);
    const price = Number(sale_price);
    const initialStock = stock === undefined || stock === null || stock === '' ? 0 : Number(stock);
    const minStock = min_stock === undefined || min_stock === null || min_stock === '' ? 5 : Number(min_stock);

    if (!cleanName) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (cleanName.length > 150) return res.status(400).json({ error: 'El nombre no puede superar 150 caracteres' });
    if (!Number.isInteger(categoryId) || categoryId <= 0) return res.status(400).json({ error: 'Selecciona una categoría válida' });
    if (!isNonNegativeNumber(cost) || !isNonNegativeNumber(price)) return res.status(400).json({ error: 'Los precios deben ser números mayores o iguales a 0' });
    if (price < cost) return res.status(400).json({ error: 'El precio de venta no debe ser menor que el costo' });
    if (!Number.isInteger(initialStock) || initialStock < 0) return res.status(400).json({ error: 'El stock inicial debe ser un número entero mayor o igual a 0' });
    if (!Number.isInteger(minStock) || minStock < 0) return res.status(400).json({ error: 'El stock mínimo debe ser un número entero mayor o igual a 0' });

    try {
        const create = db.transaction(() => {
            const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
            if (!category) throw Object.assign(new Error('La categoría seleccionada ya no existe'), { status: 400 });

            const code = generateProductCode(categoryId);
            const info = db.prepare(`
                INSERT INTO products (code, name, brand, category_id, cost_price, sale_price, stock, min_stock, is_favorite)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(code, cleanName, typeof brand === 'string' ? brand.trim() : '', categoryId,
                Math.round(cost * 100) / 100, Math.round(price * 100) / 100, initialStock, minStock, is_favorite ? 1 : 0);

            const productId = info.lastInsertRowid;
            if (initialStock > 0) {
                db.prepare(`
                    INSERT INTO stock_audit (product_id, product_name, quantity_change, previous_stock, new_stock, operator_name, movement_type, notes)
                    VALUES (?, ?, ?, 0, ?, ?, 'INGRESO_PROVEEDOR', 'Stock inicial al crear producto')
                `).run(productId, cleanName, initialStock, initialStock, operator_name || 'Sistema');
            }
            return db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
        });

        res.json({ success: true, data: create() });
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Eliminar producto. Antes, si tenía ventas/movimientos el borrado fallaba por FOREIGN KEY y el frontend
// (que buscaba el código de error de Postgres 23503) solo mostraba "Error al eliminar". Ahora, si tiene
// historial se archiva (is_active = 0) para conservar reportes y auditoría; si no, se borra.
router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    try {
        const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(id);
        if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

        const refs = ['sale_items', 'repair_parts_used', 'stock_audit', 'price_history', 'inventory_revaluations', 'inventory_batches']
            .reduce((n, t) => n + db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE product_id = ?`).get(id).c, 0);

        if (refs > 0) {
            db.prepare('UPDATE products SET is_active = 0, is_favorite = 0 WHERE id = ?').run(id);
            return res.json({ success: true, archived: true });
        }
        db.prepare('DELETE FROM products WHERE id = ?').run(id);
        res.json({ success: true, archived: false });
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
