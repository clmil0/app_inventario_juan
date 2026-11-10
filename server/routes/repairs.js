const express = require('express');
const router = express.Router();
const db = require('../db');

// Obtener todas las reparaciones
router.get('/', (req, res) => {
    try {
        const repairs = db.prepare('SELECT * FROM repairs ORDER BY created_at DESC').all();
        // El frontend parsea 'equipments' asumiendo JSON si existe
        res.json(repairs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Crear una reparación
router.post('/', (req, res) => {
    const data = req.body;
    const ticketCode = 'r-' + Date.now().toString(36);

    try {
        const insertRepair = db.transaction(() => {
            const stmt = db.prepare(`
                INSERT INTO repairs (
                    ticket_code, customer_name, customer_phone, equipment_type, brand_model, 
                    fault_description, operator_name, total_amount, advance_payment, remaining_balance, 
                    status, advance_payment_method, equipments
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const info = stmt.run(
                ticketCode, data.customer_name, data.customer_phone, data.equipment_type, data.brand_model,
                data.fault_description, data.operator_name, data.total_amount, data.advance_payment, data.remaining_balance,
                'PENDIENTE', data.advance_payment_method, JSON.stringify(data.equipments || [])
            );
            
            const repairId = info.lastInsertRowid;

            // Historial inicial
            db.prepare('INSERT INTO repair_status_history (repair_id, status, notes, changed_by) VALUES (?, ?, ?, ?)')
              .run(repairId, 'PENDIENTE', 'Ingreso inicial', data.operator_name);

            return { id: repairId, ticket_code: ticketCode };
        });

        const result = insertRepair();
        res.json({ success: true, data: [result] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mismo formato que generateSequentialTicket() del frontend: R0000AAA a partir del id
function sequentialTicket(prefix, dbId) {
    const index = (dbId || 1) - 1;
    const letterIndex = Math.floor(index / 10000);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letters = chars[Math.floor(letterIndex / 676) % 26] + chars[Math.floor(letterIndex / 26) % 26] + chars[letterIndex % 26];
    return `${prefix}${String(index % 10000).padStart(4, '0')}${letters}`;
}

const PAYMENT_METHODS = ['Caja', 'Yape/Plin', 'Transferencia', 'POS'];
const EXPRESS_EQUIPMENT = 'Reparación express';

// Reparación express: un arreglo rápido que se cobra y entrega en el momento (cliente anónimo).
// Nace ENTREGADO y pagado completo, así entra a la ganancia y a la caja ese mismo día.
router.post('/express', (req, res) => {
    const { title, price, payment_method, operator_name } = req.body || {};
    const cleanTitle = String(title || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const amount = Math.round(Number(price) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Ingresa un precio mayor a 0' });
    if (!PAYMENT_METHODS.includes(payment_method)) return res.status(400).json({ error: 'Elige cómo pagó el cliente' });
    const operator = String(operator_name || '').trim();
    if (!operator) return res.status(400).json({ error: 'Elige quién atendió' });

    try {
        const create = db.transaction(() => {
            const now = new Date().toISOString();
            const tmp = 'tmp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const info = db.prepare(`
                INSERT INTO repairs (
                    ticket_code, group_ticket, customer_name, customer_phone, equipment_type, brand_model, fault_description,
                    operator_name, total_amount, advance_payment, remaining_balance, status, advance_payment_method,
                    final_payment_method, net_profit, delivered_at, warranty_days, is_express, equipments
                ) VALUES (?, ?, 'Cliente Anónimo', '', ?, '', ?, ?, ?, ?, 0, 'ENTREGADO', ?, ?, ?, ?, 0, 1, '[]')
            `).run(tmp, tmp, EXPRESS_EQUIPMENT, cleanTitle || EXPRESS_EQUIPMENT, operator, amount, amount, payment_method, payment_method, amount, now);
            const id = Number(info.lastInsertRowid);
            const ticket = sequentialTicket('R', id);
            db.prepare('UPDATE repairs SET ticket_code = ?, group_ticket = ? WHERE id = ?').run(ticket, ticket, id);
            db.prepare('INSERT INTO repair_status_history (repair_id, status, notes, changed_by) VALUES (?, ?, ?, ?)')
                .run(id, 'ENTREGADO', 'Reparación express: cobrada y entregada al momento', operator);
            return db.prepare('SELECT * FROM repairs WHERE id = ?').get(id);
        });
        res.json({ success: true, data: create() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cambiar estado de reparación
router.put('/:id/status', (req, res) => {
    const { id } = req.params;
    const { status, operator_name, notes, delivered_at } = req.body;

    try {
        const updateStatus = db.transaction(() => {
            let sql = 'UPDATE repairs SET status = ?';
            const params = [status];
            
            if (delivered_at) {
                sql += ', delivered_at = ?';
                params.push(delivered_at);
            }
            sql += ' WHERE id = ?';
            params.push(id);

            db.prepare(sql).run(...params);
            
            db.prepare('INSERT INTO repair_status_history (repair_id, status, notes, changed_by) VALUES (?, ?, ?, ?)')
              .run(id, status, notes || '', operator_name);
        });

        updateStatus();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Historial de una reparación
router.get('/:id/history', (req, res) => {
    const { id } = req.params;
    try {
        const history = db.prepare('SELECT * FROM repair_status_history WHERE repair_id = ? ORDER BY changed_at DESC').all(id);
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
