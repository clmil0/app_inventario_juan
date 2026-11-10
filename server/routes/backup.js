const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db');
const { TIMESTAMP_COLUMNS, normalizeTimestamps, migrateLegacyImages } = require('../schema');
const { MODULES, MODULE_KEYS, AUDIT_WHERE, parseModules, readModules, productRefs, deleteModuleRows, auditModuleOf } = require('../datasets');

const BACKUP_FORMAT = 'inventario-juan-backup';
// v2: incluye las fotos y videos (archivos de la carpeta media, en base64)
// v3: se puede exportar / importar por módulos (config, ventas, reparaciones, caja)
const BACKUP_VERSION = 3;

// Todas las tablas de la app deben pertenecer a algún módulo, para que ninguna se quede fuera del backup
const MODULE_TABLES = new Set([...MODULE_KEYS.flatMap(m => MODULES[m].tables), 'stock_audit', 'media_files']);
for (const t of Object.keys(TIMESTAMP_COLUMNS)) {
    if (!MODULE_TABLES.has(t)) throw new Error(`Tabla ${t} no incluida en el backup`);
}

const FILE_LABEL = { config: 'productos', sales: 'ventas', repairs: 'reparaciones', cash: 'caja' };

function timestampForFile(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function tableColumns(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

async function safetyCopy(prefix) {
    const dir = path.join(db.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${prefix}_${timestampForFile()}.db`);
    await db.backup(file);
    return file;
}

// Exportar a un archivo JSON (todo o solo algunos módulos: ?modules=sales,repairs). Las fotos y videos
// del módulo van dentro en base64. Se escribe por partes para no armar en memoria un texto gigante.
router.get('/export', async (req, res) => {
    let modules, tables;
    try {
        modules = parseModules(req.query.modules);
        tables = readModules(db, modules);
    } catch (error) {
        return res.status(error.status || 500).json({ error: error.message });
    }
    const full = modules.length === MODULE_KEYS.length;
    // Sin el módulo de productos, se adjunta id → código para re-enlazar ventas/reparaciones al importar en otra PC
    const refs = modules.includes('config') ? null : productRefs(db);

    const write = chunk => new Promise((resolve, reject) => {
        if (res.write(chunk)) return resolve();
        res.once('drain', resolve);
        res.once('error', reject);
    });
    try {
        const name = full ? 'inventario-backup' : `inventario-${modules.map(m => FILE_LABEL[m]).join('-')}`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${name}-${timestampForFile()}.json"`);
        await write(`{"format":${JSON.stringify(BACKUP_FORMAT)},"version":${BACKUP_VERSION},"exported_at":${JSON.stringify(new Date().toISOString())},"modules":${JSON.stringify(modules)},`);
        if (refs) await write(`"product_refs":${JSON.stringify(refs)},`);
        await write(`"tables":${JSON.stringify(tables)},"media":{`);
        let first = true, missing = 0;
        for (const row of tables.media_files || []) {
            if (!row.file_name) continue; // fotos antiguas en la nube: solo se guarda el enlace
            const file = path.join(db.mediaDir, path.basename(row.file_name));
            let data;
            try { data = await fs.promises.readFile(file); } catch { missing++; continue; }
            await write(`${first ? '' : ','}${JSON.stringify(row.file_name)}:"${data.toString('base64')}"`);
            first = false;
        }
        await write(`},"media_missing":${missing}}`);
        res.end();
    } catch (error) {
        // Las cabeceras ya se enviaron: cortar la descarga para que no quede un archivo a medias que parezca válido
        res.destroy(error);
    }
});

// Importar un backup: REEMPLAZA los datos de los módulos elegidos (?modules=sales; por defecto todos los
// que trae el archivo). Lo demás no se toca. Antes se guarda una copia de seguridad de la BD actual.
// El límite real lo pone el tamaño máximo de texto de Node (~512 MB): de sobra para el negocio
router.post('/import', express.json({ limit: '1gb' }), async (req, res) => {
    const backup = req.body;

    if (!backup || backup.format !== BACKUP_FORMAT || typeof backup.tables !== 'object' || backup.tables === null) {
        return res.status(400).json({ error: 'El archivo no es un backup válido de Inventario Juan' });
    }
    if (typeof backup.version !== 'number' || backup.version > BACKUP_VERSION) {
        return res.status(400).json({ error: 'El backup fue creado por una versión más nueva de la app' });
    }
    let fileModules, selected;
    try {
        // Backups anteriores a la v3 siempre son completos
        fileModules = backup.modules ? parseModules(backup.modules) : [...MODULE_KEYS];
        selected = req.query.modules ? parseModules(req.query.modules) : fileModules;
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    const notInFile = selected.filter(m => !fileModules.includes(m));
    if (notInFile.length) {
        return res.status(400).json({ error: `El archivo no contiene: ${notInFile.map(m => MODULES[m].label).join(', ')}` });
    }
    if (selected.length === 0) return res.status(400).json({ error: 'Elige al menos un módulo para importar' });

    for (const [t, rows] of Object.entries(backup.tables)) {
        if (rows !== undefined && (!Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r)))) {
            return res.status(400).json({ error: `Datos corruptos en la tabla "${t}"` });
        }
    }
    const media = backup.media;
    if (media !== undefined && (typeof media !== 'object' || media === null || Array.isArray(media))) {
        return res.status(400).json({ error: 'Datos corruptos en las fotos y videos' });
    }
    const profiles = backup.tables.profiles;
    if (selected.includes('config') && profiles && !profiles.some(p => p.role === 'admin' && p.is_active !== 0)) {
        return res.status(400).json({ error: 'El backup no contiene ningún usuario administrador activo; no se importará para no dejarte sin acceso' });
    }

    let safety;
    try {
        safety = await safetyCopy('antes-de-importar');
    } catch (error) {
        return res.status(500).json({ error: `No se pudo crear la copia de seguridad previa: ${error.message}` });
    }

    // Fotos y videos de los módulos elegidos. Un backup v1 (sin fotos) conserva la galería actual.
    const restoreMedia = backup.tables.media_files !== undefined;
    const owners = selected.map(m => MODULES[m].mediaOwner).filter(Boolean);
    const mediaRows = restoreMedia ? backup.tables.media_files.filter(r => owners.includes(r.owner_type)) : [];
    const wantedFiles = new Set(mediaRows.map(r => r.file_name).filter(Boolean));
    const stagingDir = path.join(db.dataDir, `media-importando_${timestampForFile()}`);
    const staged = [];
    if (restoreMedia && owners.length) {
        try {
            fs.mkdirSync(stagingDir, { recursive: true });
            for (const [name, b64] of Object.entries(media || {})) {
                if (!wantedFiles.has(name) || typeof b64 !== 'string' || path.basename(name) !== name || name.startsWith('.')) continue;
                fs.writeFileSync(path.join(stagingDir, name), Buffer.from(b64, 'base64'));
                staged.push(name);
            }
        } catch (error) {
            fs.rmSync(stagingDir, { recursive: true, force: true });
            return res.status(500).json({ error: `No se pudieron preparar las fotos y videos: ${error.message}` });
        }
    }

    const counts = {};
    let unmatchedProducts = 0;
    let replacedFiles = [];
    // better-sqlite3 activa las FOREIGN KEY: al vaciar/llenar tabla por tabla fallaría a medio camino.
    // Se desactivan solo durante la importación (no se puede cambiar dentro de una transacción).
    db.pragma('foreign_keys = OFF');
    try {
        const insertRows = (t, rows, transform) => {
            counts[t] = (counts[t] || 0);
            if (!rows || rows.length === 0) return;
            const validCols = new Set(tableColumns(t));
            rows.forEach((original, i) => {
                const row = transform ? transform(original) : original;
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
        };

        db.transaction(() => {
            // Productos antes del cambio (id → código): para re-enlazar lo que NO se importa
            const oldCodeById = new Map(productRefs(db).map(p => [p.id, p.code]));

            for (const m of selected) {
                const skip = new Set();
                // Backups antiguos sin usuarios: se conservan los actuales (para no perder el acceso)
                if (m === 'config' && profiles === undefined) skip.add('profiles');
                const files = deleteModuleRows(db, m, { skipTables: skip, keepMedia: !restoreMedia });
                replacedFiles = replacedFiles.concat(files);
            }

            // Ventas / reparaciones de otra PC (o de antes de editar productos): enlazar por código de producto
            const importingConfig = selected.includes('config');
            let mapFileProduct = null;
            if (!importingConfig) {
                const fileRefs = backup.product_refs || backup.tables.products || [];
                const fileCodeById = new Map(fileRefs.map(p => [p.id, p.code]));
                const currentIdByCode = new Map(productRefs(db).map(p => [p.code, p.id]));
                mapFileProduct = row => {
                    if (row.product_id === null || row.product_id === undefined || !fileCodeById.size) return row;
                    const id = currentIdByCode.get(fileCodeById.get(row.product_id));
                    if (id === undefined) unmatchedProducts++;
                    return { ...row, product_id: id === undefined ? null : id };
                };
            }

            for (const m of selected) {
                for (const t of MODULES[m].tables) {
                    if (m === 'config' && t === 'profiles' && profiles === undefined) continue;
                    const productRef = t === 'sale_items' || t === 'repair_parts_used';
                    insertRows(t, backup.tables[t], productRef ? mapFileProduct : null);
                }
            }
            const auditRows = (backup.tables.stock_audit || []).filter(r => selected.includes(auditModuleOf(r)));
            insertRows('stock_audit', auditRows, r => auditModuleOf(r) === 'config' ? r : (mapFileProduct ? mapFileProduct(r) : r));
            if (restoreMedia) insertRows('media_files', mediaRows);

            // Se reemplazaron los productos pero se conservan ventas/reparaciones actuales: re-enlazarlas por código
            if (importingConfig) {
                const newIdByCode = new Map(productRefs(db).map(p => [p.code, p.id]));
                const kept = MODULE_KEYS.filter(m => !selected.includes(m) && (m === 'sales' || m === 'repairs'));
                const relink = (table, where = '') => {
                    const rows = db.prepare(`SELECT id, product_id FROM ${table} WHERE product_id IS NOT NULL ${where}`).all();
                    const upd = db.prepare(`UPDATE ${table} SET product_id = ? WHERE id = ?`);
                    for (const r of rows) {
                        const id = newIdByCode.get(oldCodeById.get(r.product_id));
                        if (id === undefined) unmatchedProducts++;
                        if (id !== r.product_id) upd.run(id === undefined ? null : id, r.id);
                    }
                };
                if (kept.includes('sales')) relink('sale_items');
                if (kept.includes('repairs')) relink('repair_parts_used');
                for (const m of kept) relink('stock_audit', `AND ${AUDIT_WHERE[m]}`);
            }
        })();
        normalizeTimestamps(db);
        migrateLegacyImages(db);

        // Archivos: los reemplazados se mueven a "backups" (por si hay que deshacer) y entran los nuevos
        let mediaSafetyCopy = null;
        if (restoreMedia && owners.length) {
            mediaSafetyCopy = `${safety.replace(/\.db$/, '')}_media`;
            fs.mkdirSync(mediaSafetyCopy, { recursive: true });
            for (const name of replacedFiles) {
                const from = path.join(db.mediaDir, path.basename(name));
                if (fs.existsSync(from)) fs.renameSync(from, path.join(mediaSafetyCopy, path.basename(name)));
            }
            for (const name of staged) fs.renameSync(path.join(stagingDir, name), path.join(db.mediaDir, name));
            fs.rmSync(stagingDir, { recursive: true, force: true });
            counts.media_archivos = staged.length;
        }
        // Referencias rotas que ya venían en el backup (ej. repuestos de productos borrados): se informan, no se bloquean
        const orphanRefs = db.pragma('foreign_key_check').length;
        res.json({ success: true, modules: selected, counts, orphan_refs: orphanRefs, unmatched_products: unmatchedProducts, safety_copy: safety, media_safety_copy: mediaSafetyCopy });
    } catch (error) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        // La transacción se revierte sola: los datos actuales quedan intactos
        res.status(400).json({ error: `No se importó nada. ${error.message}` });
    } finally {
        db.pragma('foreign_keys = ON');
    }
});

module.exports = router;
module.exports.safetyCopy = safetyCopy;
