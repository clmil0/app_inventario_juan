// Módulos de datos: qué tablas pertenecen a "Productos y configuración", "Ventas", "Reparaciones" y "Caja".
// Lo usan el backup (exportar / importar por partes) y el reinicio de datos (borrar ventas / reparaciones).
//
// Puntos delicados:
//  · stock_audit es UNA tabla con movimientos de los tres módulos: se reparte por tipo de movimiento.
//  · media_files guarda fotos de productos (configuración) y de reparaciones: se reparte por owner_type.
//  · sale_items / repair_parts_used / stock_audit apuntan a products.id. Si los productos de un backup
//    no tienen los mismos id que los actuales, se re-enlazan por CÓDIGO de producto (único y estable).

const MODULES = {
    config: {
        label: 'Productos y configuración',
        // Orden: padres antes que hijos
        tables: ['profiles', 'categories', 'products', 'equipment_types', 'brand_models', 'equipment_type_brands',
            'common_faults', 'price_history', 'inventory_batches', 'inventory_revaluations', 'express_shortcuts'],
        audit: true,
        mediaOwner: 'product'
    },
    sales: {
        label: 'Ventas',
        tables: ['sales', 'sale_items'],
        audit: true
    },
    repairs: {
        label: 'Reparaciones',
        tables: ['repairs', 'repair_status_history', 'repair_parts_used', 'repair_external_costs', 'repair_images'],
        audit: true,
        mediaOwner: 'repair'
    },
    cash: {
        label: 'Caja y retiros',
        tables: ['cash_movements', 'cash_openings']
    }
};
const MODULE_KEYS = Object.keys(MODULES);

// Movimientos de stock que nacen de una venta / reparación (incluye sus devoluciones al anular o quitar el repuesto)
const SALES_AUDIT = `(movement_type = 'VENTA' OR (movement_type = 'DEVOLUCION_CLIENTE' AND notes LIKE 'Anulación de Venta%'))`;
const REPAIRS_AUDIT = `(movement_type = 'USO_EN_REPARACION' OR (movement_type = 'DEVOLUCION_CLIENTE' AND notes LIKE 'Devolución por retiro de repuesto%'))`;
const AUDIT_WHERE = {
    sales: SALES_AUDIT,
    repairs: REPAIRS_AUDIT,
    // Ingresos de proveedor, mermas, stock inicial y los ajustes del reinicio de datos
    config: `NOT ${SALES_AUDIT} AND NOT ${REPAIRS_AUDIT}`
};

function parseModules(value) {
    if (!value || value === 'all') return [...MODULE_KEYS];
    const list = (Array.isArray(value) ? value : String(value).split(','))
        .map(s => String(s).trim()).filter(Boolean);
    const bad = list.find(m => !MODULES[m]);
    if (bad) throw Object.assign(new Error(`Módulo desconocido: ${bad}`), { status: 400 });
    // Siempre en el orden canónico (config primero)
    return MODULE_KEYS.filter(m => list.includes(m));
}

/** Lee las filas de los módulos pedidos (todas las tablas en una lectura consistente). */
function readModules(db, modules) {
    const tables = {};
    db.transaction(() => {
        for (const m of modules) {
            for (const t of MODULES[m].tables) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
        }
        const auditParts = modules.filter(m => MODULES[m].audit).map(m => AUDIT_WHERE[m]);
        if (auditParts.length) {
            tables.stock_audit = auditParts.length === 3
                ? db.prepare('SELECT * FROM stock_audit').all()
                : db.prepare(`SELECT * FROM stock_audit WHERE ${auditParts.map(w => `(${w})`).join(' OR ')}`).all();
        }
        const owners = modules.map(m => MODULES[m].mediaOwner).filter(Boolean);
        if (owners.length) {
            tables.media_files = db.prepare(`SELECT * FROM media_files WHERE owner_type IN (${owners.map(() => '?').join(',')})`).all(...owners);
        }
    })();
    return tables;
}

/** id → código de todos los productos (incluye archivados): permite re-enlazar ventas/reparaciones en otra PC. */
function productRefs(db) {
    return db.prepare('SELECT id, code, name FROM products').all();
}

/** Borra los datos de un módulo (filas de sus tablas, sus movimientos de stock y las filas de su galería). */
function deleteModuleRows(db, module, { skipTables = new Set(), keepMedia = false } = {}) {
    const def = MODULES[module];
    for (const t of [...def.tables].reverse()) {
        if (skipTables.has(t)) continue;
        db.prepare(`DELETE FROM ${t}`).run();
        db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(t);
    }
    if (def.audit) db.prepare(`DELETE FROM stock_audit WHERE ${AUDIT_WHERE[module]}`).run();
    if (def.mediaOwner && !keepMedia) {
        const files = db.prepare('SELECT file_name FROM media_files WHERE owner_type = ?').all(def.mediaOwner).map(r => r.file_name).filter(Boolean);
        db.prepare('DELETE FROM media_files WHERE owner_type = ?').run(def.mediaOwner);
        return files;
    }
    return [];
}

/** Clasifica una fila de stock_audit en su módulo (para importar solo lo que corresponde). */
function auditModuleOf(row) {
    const notes = String(row.notes || '');
    if (row.movement_type === 'VENTA' || (row.movement_type === 'DEVOLUCION_CLIENTE' && notes.startsWith('Anulación de Venta'))) return 'sales';
    if (row.movement_type === 'USO_EN_REPARACION' || (row.movement_type === 'DEVOLUCION_CLIENTE' && notes.startsWith('Devolución por retiro de repuesto'))) return 'repairs';
    return 'config';
}

module.exports = { MODULES, MODULE_KEYS, AUDIT_WHERE, parseModules, readModules, productRefs, deleteModuleRows, auditModuleOf };
