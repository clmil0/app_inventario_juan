const express = require('express');
const router = express.Router();
const db = require('../db');

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

// --- CATÁLOGO DE REPARACIONES (Tipo de equipo → sus marcas y sus fallas) ---
// Un tipo de equipo tiene su propia lista de marcas (una marca puede repetirse en varios tipos, ej. Samsung
// en Celular y TV) y su propia lista de fallas. Las fallas sin tipo son "generales" y aplican a todos.

function cleanName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ');
}

function getCatalog() {
    const types = db.prepare('SELECT id, name FROM equipment_types ORDER BY name COLLATE NOCASE').all();
    const brands = db.prepare('SELECT id, name FROM brand_models ORDER BY name COLLATE NOCASE').all();
    const links = db.prepare('SELECT equipment_type_id, brand_model_id FROM equipment_type_brands').all();
    const faults = db.prepare('SELECT id, name, equipment_type_id FROM common_faults ORDER BY name COLLATE NOCASE').all();

    const brandById = new Map(brands.map(b => [b.id, b]));
    const linkedBrandIds = new Set(links.map(l => l.brand_model_id));
    return {
        types: types.map(t => ({
            ...t,
            brands: links.filter(l => l.equipment_type_id === t.id).map(l => brandById.get(l.brand_model_id)).filter(Boolean)
                .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
            faults: faults.filter(f => f.equipment_type_id === t.id)
        })),
        brands,
        // Marcas creadas antes de existir la relación (o desvinculadas): se muestran para poder asignarlas
        unassignedBrands: brands.filter(b => !linkedBrandIds.has(b.id)),
        generalFaults: faults.filter(f => !f.equipment_type_id)
    };
}

function sendError(res, error) {
    const msg = error.message || String(error);
    if (/UNIQUE constraint failed/.test(msg)) return res.status(409).json({ error: 'Ese nombre ya existe' });
    res.status(error.status || 500).json({ error: msg });
}

router.get('/catalog', (req, res) => {
    try {
        res.json(getCatalog());
    } catch (error) {
        sendError(res, error);
    }
});

router.post('/equipment-types', (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Ingresa un nombre' });
    try {
        const exists = db.prepare('SELECT id FROM equipment_types WHERE name = ? COLLATE NOCASE').get(name);
        if (exists) return res.status(409).json({ error: `"${name}" ya existe` });
        const info = db.prepare('INSERT INTO equipment_types (name) VALUES (?)').run(name);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (error) {
        sendError(res, error);
    }
});

router.put('/equipment-types/:id', (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Ingresa un nombre' });
    try {
        db.prepare('UPDATE equipment_types SET name = ? WHERE id = ?').run(name, Number(req.params.id));
        res.json({ success: true });
    } catch (error) {
        sendError(res, error);
    }
});

// Elimina el tipo junto con sus fallas propias y sus vínculos de marca. Las marcas que queden sin
// ningún tipo se conservan (aparecen como "sin asignar"). Las reparaciones guardan el texto, no se afectan.
router.delete('/equipment-types/:id', (req, res) => {
    const id = Number(req.params.id);
    try {
        db.transaction(() => {
            db.prepare('DELETE FROM equipment_type_brands WHERE equipment_type_id = ?').run(id);
            db.prepare('DELETE FROM common_faults WHERE equipment_type_id = ?').run(id);
            db.prepare('DELETE FROM equipment_types WHERE id = ?').run(id);
        })();
        res.json({ success: true });
    } catch (error) {
        sendError(res, error);
    }
});

// Agrega una marca a un tipo. Si la marca no existe se crea; si ya existe (en otro tipo) se reutiliza.
router.post('/equipment-types/:id/brands', (req, res) => {
    const typeId = Number(req.params.id);
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Ingresa una marca' });
    try {
        db.transaction(() => {
            if (!db.prepare('SELECT id FROM equipment_types WHERE id = ?').get(typeId)) {
                throw Object.assign(new Error('El tipo de equipo no existe'), { status: 404 });
            }
            let brand = db.prepare('SELECT id FROM brand_models WHERE name = ? COLLATE NOCASE').get(name);
            if (!brand) brand = { id: db.prepare('INSERT INTO brand_models (name) VALUES (?)').run(name).lastInsertRowid };
            db.prepare('INSERT OR IGNORE INTO equipment_type_brands (equipment_type_id, brand_model_id) VALUES (?, ?)').run(typeId, brand.id);
        })();
        res.json({ success: true });
    } catch (error) {
        sendError(res, error);
    }
});

// Quita la marca de ese tipo. Si ya no pertenece a ningún tipo se elimina del catálogo.
router.delete('/equipment-types/:id/brands/:brandId', (req, res) => {
    const typeId = Number(req.params.id);
    const brandId = Number(req.params.brandId);
    try {
        db.transaction(() => {
            db.prepare('DELETE FROM equipment_type_brands WHERE equipment_type_id = ? AND brand_model_id = ?').run(typeId, brandId);
            const stillUsed = db.prepare('SELECT 1 FROM equipment_type_brands WHERE brand_model_id = ? LIMIT 1').get(brandId);
            if (!stillUsed) db.prepare('DELETE FROM brand_models WHERE id = ?').run(brandId);
        })();
        res.json({ success: true });
    } catch (error) {
        sendError(res, error);
    }
});

// Eliminar una marca del catálogo por completo (de todos los tipos)
router.delete('/brands/:id', (req, res) => {
    const id = Number(req.params.id);
    try {
        db.transaction(() => {
            db.prepare('DELETE FROM equipment_type_brands WHERE brand_model_id = ?').run(id);
            db.prepare('DELETE FROM brand_models WHERE id = ?').run(id);
        })();
        res.json({ success: true });
    } catch (error) {
        sendError(res, error);
    }
});

// Falla: con equipment_type_id = falla de ese tipo; sin él = falla general (todos los equipos)
router.post('/faults', (req, res) => {
    const name = cleanName(req.body?.name);
    const typeId = req.body?.equipment_type_id ? Number(req.body.equipment_type_id) : null;
    if (!name) return res.status(400).json({ error: 'Ingresa una falla' });
    try {
        const dup = typeId
            ? db.prepare('SELECT id FROM common_faults WHERE name = ? COLLATE NOCASE AND equipment_type_id = ?').get(name, typeId)
            : db.prepare('SELECT id FROM common_faults WHERE name = ? COLLATE NOCASE AND equipment_type_id IS NULL').get(name);
        if (dup) return res.status(409).json({ error: `"${name}" ya está en la lista` });
        db.prepare('INSERT INTO common_faults (name, equipment_type_id) VALUES (?, ?)').run(name, typeId);
        res.json({ success: true });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete('/faults/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM common_faults WHERE id = ?').run(Number(req.params.id));
        res.json({ success: true });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = router;
