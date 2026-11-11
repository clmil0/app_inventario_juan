const express = require('express');
const router = express.Router();
const db = require('../db');

const SOURCES = ['Caja', 'Yape/Plin', 'Transferencia', 'POS'];

// Listar retiros (activos y anulados: el historial no se borra)
router.get('/', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM cash_movements ORDER BY created_at DESC, id DESC').all();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Día del negocio en formato YYYY-MM-DD (lo envía el cliente en su hora local)
function validDay(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toISOString().slice(0, 10) === value;
}

// Fondo inicial de un día. confirmed = false: nadie lo ha indicado aún y se toma 0
router.get('/opening', (req, res) => {
    const { date } = req.query;
    if (!validDay(date)) return res.status(400).json({ error: 'Fecha inválida' });
    try {
        const row = db.prepare('SELECT * FROM cash_openings WHERE business_date = ?').get(date);
        res.json({ date, amount: row ? row.amount : 0, confirmed: !!row, operator_name: row?.operator_name || null, updated_at: row?.updated_at || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Guardar (o corregir) el fondo inicial de un día
router.put('/opening', (req, res) => {
    const { date, amount, operator_name } = req.body || {};
    if (!validDay(date)) return res.status(400).json({ error: 'Fecha inválida' });
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ error: 'El fondo inicial debe ser 0 o más' });
    }
    const value = Math.round(amount * 100) / 100;
    const operator = operator_name || 'admin';
    const updatedAt = new Date().toISOString();
    try {
        db.prepare(`
            INSERT INTO cash_openings (business_date, amount, operator_name, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(business_date) DO UPDATE SET amount = excluded.amount, operator_name = excluded.operator_name, updated_at = excluded.updated_at
        `).run(date, value, operator, updatedAt);
        res.json({ date, amount: value, confirmed: true, operator_name: operator, updated_at: updatedAt });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Registrar un retiro
router.post('/', (req, res) => {
    const { amount, source, reason, notes, operator_name } = req.body || {};
    const value = Math.round((Number(amount) || 0) * 100) / 100;
    if (!(value > 0)) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    if (!SOURCES.includes(source)) return res.status(400).json({ error: 'Origen del dinero inválido' });
    if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'Indica el motivo del retiro' });

    try {
        const info = db.prepare(`
            INSERT INTO cash_movements (movement_type, amount, source, reason, notes, operator_name)
            VALUES ('RETIRO', ?, ?, ?, ?, ?)
        `).run(value, source, String(reason).trim(), String(notes || '').trim(), operator_name || 'admin');
        res.json({ success: true, data: db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(info.lastInsertRowid) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Anular un retiro (no se elimina: queda marcado como ANULADO con quién y por qué)
router.post('/:id/void', (req, res) => {
    const { operator_name, void_reason } = req.body || {};
    try {
        const row = db.prepare('SELECT status FROM cash_movements WHERE id = ?').get(Number(req.params.id));
        if (!row) return res.status(404).json({ error: 'El retiro no existe' });
        if (row.status === 'ANULADO') return res.status(409).json({ error: 'El retiro ya estaba anulado' });
        db.prepare(`
            UPDATE cash_movements SET status = 'ANULADO', void_reason = ?, voided_by = ?, voided_at = ? WHERE id = ?
        `).run(String(void_reason || '').trim(), operator_name || 'admin', new Date().toISOString(), Number(req.params.id));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
