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
