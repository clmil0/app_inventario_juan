// Fotos y videos de productos y reparaciones. Todo se guarda en esta PC (carpeta "media" junto a la BD)
// y entra en el backup; ya no se sube nada a la nube.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');

const OWNER_TYPES = ['product', 'repair'];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;   // las fotos llegan ya comprimidas desde el navegador
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;  // ~2-3 min en calidad de celular

const EXT_BY_MIME = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-matroska': '.mkv', 'video/3gpp': '.3gp'
};

const publicUrl = row => row.file_name ? `/media/${encodeURIComponent(row.file_name)}` : (row.url || '');
const withUrl = row => ({ ...row, src: publicUrl(row) });

function checkOwner(type, id) {
    if (!OWNER_TYPES.includes(type)) throw Object.assign(new Error('Tipo de dueño inválido'), { status: 400 });
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Id inválido'), { status: 400 });
    const table = type === 'product' ? 'products' : 'repairs';
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) throw Object.assign(new Error('No existe el registro'), { status: 404 });
}

function removeFile(fileName) {
    if (!fileName) return;
    // file_name siempre es "<uuid>.<ext>" generado aquí; basename evita salir de la carpeta
    const p = path.join(db.mediaDir, path.basename(fileName));
    fs.rm(p, { force: true }, () => {});
}

// Galería de un producto o reparación (una o varias reparaciones: ?owner_id=1,2,3)
router.get('/', (req, res) => {
    try {
        const type = String(req.query.owner_type || '');
        if (!OWNER_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de dueño inválido' });
        const ids = String(req.query.owner_id || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (!ids.length) return res.json([]);
        const rows = db.prepare(`SELECT * FROM media_files WHERE owner_type = ? AND owner_id IN (${ids.map(() => '?').join(',')})
            ORDER BY owner_id, position, created_at`).all(type, ...ids);
        res.json(rows.map(withUrl));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Resumen para tablas y tarjetas: cantidad, fotos/videos y las 3 primeras miniaturas de cada dueño
router.get('/summary', (req, res) => {
    try {
        const type = String(req.query.owner_type || '');
        if (!OWNER_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de dueño inválido' });
        const rows = db.prepare('SELECT id, owner_id, kind, file_name, url, duration FROM media_files WHERE owner_type = ? ORDER BY owner_id, position, created_at').all(type);
        const out = {};
        for (const r of rows) {
            const s = out[r.owner_id] || (out[r.owner_id] = { n: 0, images: 0, videos: 0, items: [] });
            s.n++;
            if (r.kind === 'video') s.videos++; else s.images++;
            if (s.items.length < 3) s.items.push({ id: r.id, kind: r.kind, src: publicUrl(r), duration: r.duration });
        }
        res.json(out);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Subir un archivo (cuerpo binario). Los datos van en la query para no tener que armar multipart.
router.post('/upload', express.raw({ type: () => true, limit: MAX_VIDEO_BYTES + 1024 * 1024 }), (req, res) => {
    try {
        const type = String(req.query.owner_type || '');
        const ownerId = Number(req.query.owner_id);
        checkOwner(type, ownerId);

        const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : null;
        if (!kind) return res.status(400).json({ error: 'Solo se aceptan fotos o videos' });
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'Archivo vacío' });
        if (kind === 'image' && body.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'La foto es demasiado grande (máx. 25 MB)' });
        if (kind === 'video' && body.length > MAX_VIDEO_BYTES) return res.status(413).json({ error: 'El video es demasiado grande (máx. 150 MB)' });

        const id = crypto.randomUUID();
        const fileName = id + (EXT_BY_MIME[mime] || (kind === 'video' ? '.mp4' : '.jpg'));
        fs.writeFileSync(path.join(db.mediaDir, fileName), body);

        const duration = parseFloat(req.query.duration);
        const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM media_files WHERE owner_type = ? AND owner_id = ?').get(type, ownerId).p;
        try {
            db.prepare(`INSERT INTO media_files (id, owner_type, owner_id, kind, file_name, mime, size, duration, position, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, type, ownerId, kind, fileName, mime, body.length,
                Number.isFinite(duration) ? duration : null, pos, String(req.query.by || '').slice(0, 60));
        } catch (err) {
            removeFile(fileName);
            throw err;
        }
        res.json(withUrl(db.prepare('SELECT * FROM media_files WHERE id = ?').get(id)));
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Reordenar: la primera es la portada
router.put('/order', express.json(), (req, res) => {
    try {
        const { owner_type: type, owner_id: ownerId, ids } = req.body || {};
        if (!OWNER_TYPES.includes(type) || !Array.isArray(ids)) return res.status(400).json({ error: 'Datos inválidos' });
        const upd = db.prepare('UPDATE media_files SET position = ? WHERE id = ? AND owner_type = ? AND owner_id = ?');
        db.transaction(() => ids.forEach((id, i) => upd.run(i, String(id), type, Number(ownerId))))();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Borrar toda la galería de un tipo (al eliminar todas las reparaciones)
router.delete('/owner/:type', (req, res) => {
    try {
        const type = req.params.type;
        if (!OWNER_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de dueño inválido' });
        const rows = db.prepare('SELECT file_name FROM media_files WHERE owner_type = ?').all(type);
        db.prepare('DELETE FROM media_files WHERE owner_type = ?').run(type);
        rows.forEach(r => removeFile(r.file_name));
        res.json({ success: true, deleted: rows.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const row = db.prepare('SELECT * FROM media_files WHERE id = ?').get(req.params.id);
        if (!row) return res.status(404).json({ error: 'No encontrado' });
        db.prepare('DELETE FROM media_files WHERE id = ?').run(row.id);
        removeFile(row.file_name);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Borra la galería de un dueño (al eliminar un producto)
function deleteOwnerMedia(type, ownerId) {
    const rows = db.prepare('SELECT file_name FROM media_files WHERE owner_type = ? AND owner_id = ?').all(type, ownerId);
    db.prepare('DELETE FROM media_files WHERE owner_type = ? AND owner_id = ?').run(type, ownerId);
    rows.forEach(r => removeFile(r.file_name));
}

module.exports = router;
module.exports.deleteOwnerMedia = deleteOwnerMedia;
