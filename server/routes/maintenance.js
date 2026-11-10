// Reinicio de datos: borra ventas, reparaciones y/o retiros de caja (ej. pruebas hechas antes de empezar a
// usar la app de verdad) conservando productos, categorías, catálogo de fallas, usuarios, fotos de productos
// e historial de precios.
//
// Stock: lo vendido o usado como repuesto ya se descontó del inventario. Con restore_stock = true (pruebas)
// esas unidades vuelven al stock y queda un movimiento "Reinicio de datos" en la auditoría que lo explica;
// con false (las unidades sí salieron del local) el stock actual se mantiene tal cual.
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const db = require('../db');
const { MODULES, deleteModuleRows } = require('../datasets');
const { safetyCopy } = require('./backup');

const RESETTABLE = ['sales', 'repairs', 'cash'];

// Unidades que volverían al stock por producto (solo de productos que todavía existen)
function unitsToRestore(modules) {
    const parts = [];
    if (modules.includes('sales')) parts.push('SELECT product_id, quantity FROM sale_items');
    if (modules.includes('repairs')) parts.push('SELECT product_id, quantity FROM repair_parts_used');
    if (!parts.length) return [];
    return db.prepare(`
        SELECT p.id, p.name, p.stock, SUM(x.quantity) AS qty
        FROM (${parts.join(' UNION ALL ')}) x
        JOIN products p ON p.id = x.product_id
        GROUP BY p.id HAVING qty > 0
        ORDER BY p.name COLLATE NOCASE
    `).all();
}

function count(sql) { return db.prepare(sql).get().c; }

// Qué se borraría (para mostrarlo antes de confirmar)
router.get('/preview', (req, res) => {
    try {
        const one = m => unitsToRestore([m]).reduce((a, r) => a + r.qty, 0);
        res.json({
            sales: { count: count('SELECT COUNT(*) c FROM sales'), units: one('sales') },
            repairs: {
                count: count('SELECT COUNT(*) c FROM repairs'),
                units: one('repairs'),
                with_parts: count('SELECT COUNT(DISTINCT repair_id) c FROM repair_parts_used'),
                media: count("SELECT COUNT(*) c FROM media_files WHERE owner_type = 'repair'")
            },
            cash: { count: count('SELECT COUNT(*) c FROM cash_movements') },
            kept: {
                products: count('SELECT COUNT(*) c FROM products WHERE is_active = 1'),
                categories: count('SELECT COUNT(*) c FROM categories'),
                faults: count('SELECT COUNT(*) c FROM common_faults'),
                product_media: count("SELECT COUNT(*) c FROM media_files WHERE owner_type = 'product'")
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/reset', async (req, res) => {
    const { modules: raw, restore_stock, operator_name } = req.body || {};
    const modules = Array.isArray(raw) ? RESETTABLE.filter(m => raw.includes(m)) : [];
    if (!modules.length) return res.status(400).json({ error: 'Elige qué datos reiniciar' });
    if (typeof restore_stock !== 'boolean' && (modules.includes('sales') || modules.includes('repairs'))) {
        return res.status(400).json({ error: 'Indica si las unidades vendidas / usadas vuelven al stock' });
    }

    let safety;
    try {
        safety = await safetyCopy('antes-de-reiniciar');
    } catch (error) {
        return res.status(500).json({ error: `No se pudo crear la copia de seguridad previa: ${error.message}` });
    }

    const result = { modules, restored_units: 0, restored_products: 0, deleted: {}, safety_copy: safety };
    let files = [];
    db.pragma('foreign_keys = OFF');
    try {
        db.transaction(() => {
            if (restore_stock) {
                const label = modules.filter(m => m !== 'cash').map(m => MODULES[m].label.toLowerCase()).join(' y ');
                const upd = db.prepare('UPDATE products SET stock = ? WHERE id = ?');
                const audit = db.prepare(`
                    INSERT INTO stock_audit (product_id, product_name, quantity_change, previous_stock, new_stock, operator_name, movement_type, reference_code, notes)
                    VALUES (?, ?, ?, ?, ?, ?, 'DEVOLUCION_CLIENTE', 'REINICIO', ?)
                `);
                for (const p of unitsToRestore(modules)) {
                    const newStock = (p.stock || 0) + p.qty;
                    upd.run(newStock, p.id);
                    audit.run(p.id, p.name, p.qty, p.stock || 0, newStock, operator_name || 'Administrador',
                        `Reinicio de datos: vuelven al stock las unidades de ${label} borradas`);
                    result.restored_units += p.qty;
                    result.restored_products++;
                }
            }
            for (const m of modules) {
                result.deleted[m] = db.prepare(`SELECT COUNT(*) c FROM ${MODULES[m].tables[0]}`).get().c;
                files = files.concat(deleteModuleRows(db, m));
            }
        })();
    } catch (error) {
        db.pragma('foreign_keys = ON');
        return res.status(500).json({ error: `No se borró nada. ${error.message}` });
    }
    db.pragma('foreign_keys = ON');

    // Fotos y videos de las reparaciones borradas: se mueven junto a la copia de seguridad (no se pierden)
    if (files.length) {
        const dir = `${safety.replace(/\.db$/, '')}_media`;
        fs.mkdirSync(dir, { recursive: true });
        for (const name of files) {
            const from = path.join(db.mediaDir, path.basename(name));
            try { if (fs.existsSync(from)) fs.renameSync(from, path.join(dir, path.basename(name))); } catch { /* ya no existe */ }
        }
        result.media_moved_to = dir;
    }
    res.json({ success: true, ...result });
});

module.exports = router;
