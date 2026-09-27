const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db');
const { TIMESTAMP_COLUMNS, normalizeTimestamps } = require('../schema');

const BACKUP_FORMAT = 'inventario-juan-backup';
const BACKUP_VERSION = 1;

// Todas las tablas de la app, padres antes que hijos
const BACKUP_TABLES = [
    'profiles', 'categories', 'products', 'equipment_types', 'brand_models', 'common_faults',
    'sales', 'sale_items', 'repairs', 'repair_status_history', 'repair_parts_used',
    'repair_external_costs', 'repair_images', 'stock_audit', 'price_history',
    'inventory_batches', 'inventory_revaluations'
];

// Si falta alguna tabla nueva en esta lista, que no se olvide en el backup
for (const t of Object.keys(TIMESTAMP_COLUMNS)) {
    if (!BACKUP_TABLES.includes(t)) throw new Error(`Tabla ${t} no incluida en el backup`);
}

function timestampForFile(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function tableColumns(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

// Exportar toda la BD a un archivo JSON
router.get('/export', (req, res) => {
    try {
        const tables = {};
        const readAll = db.transaction(() => {
            for (const t of BACKUP_TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
        });
        readAll(); // lectura consistente (todas las tablas del mismo instante)

        const backup = {
            format: BACKUP_FORMAT,
            version: BACKUP_VERSION,
            exported_at: new Date().toISOString(),
            tables
        };
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="inventario-backup-${timestampForFile()}.json"`);
        res.send(JSON.stringify(backup));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Importar un backup: REEMPLAZA todos los datos actuales. Antes se guarda una copia de seguridad
// automática de la BD actual en la carpeta "backups" por si hay que deshacer.
router.post('/import', express.json({ limit: '500mb' }), async (req, res) => {
    const backup = req.body;

    if (!backup || backup.format !== BACKUP_FORMAT || typeof backup.tables !== 'object' || backup.tables === null) {
        return res.status(400).json({ error: 'El archivo no es un backup válido de Inventario Juan' });
    }
    if (typeof backup.version !== 'number' || backup.version > BACKUP_VERSION) {
        return res.status(400).json({ error: 'El backup fue creado por una versión más nueva de la app' });
    }
    for (const t of BACKUP_TABLES) {
        const rows = backup.tables[t];
        if (rows !== undefined && (!Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r)))) {
            return res.status(400).json({ error: `Datos corruptos en la tabla "${t}"` });
        }
    }
    const profiles = backup.tables.profiles;
    if (profiles && !profiles.some(p => p.role === 'admin' && p.is_active !== 0)) {
        return res.status(400).json({ error: 'El backup no contiene ningún usuario administrador activo; no se importará para no dejarte sin acceso' });
    }

    let safetyCopy;
    try {
        const dir = path.join(db.dataDir, 'backups');
        fs.mkdirSync(dir, { recursive: true });
        safetyCopy = path.join(dir, `antes-de-importar_${timestampForFile()}.db`);
        await db.backup(safetyCopy);
    } catch (error) {
        return res.status(500).json({ error: `No se pudo crear la copia de seguridad previa: ${error.message}` });
    }

    const counts = {};
    // better-sqlite3 activa las FOREIGN KEY: al vaciar/llenar tabla por tabla fallaría a medio camino.
    // Se desactivan solo durante la importación (no se puede cambiar dentro de una transacción).
    db.pragma('foreign_keys = OFF');
    try {
        const importAll = db.transaction(() => {
            for (const t of BACKUP_TABLES) {
                const rows = backup.tables[t];
                // Si un backup antiguo no trae usuarios se conservan los actuales (para no perder el acceso)
                if (t === 'profiles' && rows === undefined) continue;

                db.prepare(`DELETE FROM ${t}`).run();
                db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(t);
                counts[t] = 0;
                if (!rows || rows.length === 0) continue;

                const validCols = new Set(tableColumns(t));
                rows.forEach((row, i) => {
                    const cols = Object.keys(row).filter(c => validCols.has(c));
                    if (cols.length === 0) return;
                    const vals = cols.map(c => {
                        const v = row[c];
                        if (typeof v === 'boolean') return v ? 1 : 0;
                        if (v !== null && typeof v === 'object') return JSON.stringify(v);
                        return v === undefined ? null : v;
                    });
                    try {
                        db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
                    } catch (err) {
                        throw new Error(`Tabla "${t}", registro #${i + 1}: ${err.message}`);
                    }
                    counts[t]++;
                });
            }
        });
        importAll();
        normalizeTimestamps(db);
        // Referencias rotas que ya venían en el backup (ej. repuestos de productos borrados): se informan, no se bloquean
        const orphanRefs = db.pragma('foreign_key_check').length;
        res.json({ success: true, counts, orphan_refs: orphanRefs, safety_copy: safetyCopy });
    } catch (error) {
        // La transacción se revierte sola: los datos actuales quedan intactos
        res.status(400).json({ error: `No se importó nada. ${error.message}` });
    } finally {
        db.pragma('foreign_keys = ON');
    }
});

module.exports = router;
