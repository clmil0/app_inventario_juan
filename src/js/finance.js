/**
 * finance.js
 * Reglas de ganancia compartidas por el Dashboard y la pestaña "Caja y Retiros" del admin,
 * para que ambos muestren exactamente la misma cifra.
 *
 * Cada venta / cobro de reparación / revalorización se convierte en un "evento" con fecha, ingreso
 * y ganancia. Los filtros (período, persona, medio de pago) se aplican sobre esos eventos.
 */
import { safeAdd, safeSubtract, safeMultiply } from './math.js';

export const RETURNED_REPAIR_STATUSES = ['NO REPARADO', 'NO_REPARADO', 'NO REPARABLE', 'DEVUELTO', 'CANCELADO', 'RECHAZADO'];

/**
 * @param {object} raw  respuesta de /api/dashboard/raw
 * @returns {Array<{kind:'venta'|'reparacion'|'revalorizacion', date:string, income:number, cost:number,
 *   profit:number, operator:string|null, method:string|null, ref:object, stage?:'adelanto'|'saldo'}>}
 */
export function buildProfitEvents(raw) {
    const events = [];
    const costById = {};
    (raw.productos || []).forEach(p => { costById[p.id] = parseFloat(p.cost_price || 0); });

    const itemsBySale = new Map();
    (raw.itemsVenta || []).forEach(item => {
        if (!itemsBySale.has(item.sale_id)) itemsBySale.set(item.sale_id, []);
        itemsBySale.get(item.sale_id).push(item);
    });

    (raw.ventas || []).forEach(s => {
        const items = itemsBySale.get(s.id) || [];
        let cost = 0;
        items.forEach(item => {
            // Costo congelado al momento de la venta; si no existe se usa el costo actual del producto
            const unit = item.unit_cost !== undefined && item.unit_cost !== null ? parseFloat(item.unit_cost) : (costById[item.product_id] || 0);
            cost = safeAdd(cost, safeMultiply(unit, parseInt(item.quantity || 0)));
        });
        const income = parseFloat(s.total_amount || 0);
        events.push({
            kind: 'venta', date: s.created_at, income, cost, profit: safeSubtract(income, cost),
            operator: s.operator_name, method: s.payment_method, ref: { ...s, items }
        });
    });

    (raw.reparaciones || []).forEach(r => {
        const isReturned = RETURNED_REPAIR_STATUSES.includes(String(r.status || '').toUpperCase());
        const advance = parseFloat(r.advance_payment || 0);
        const total = parseFloat(r.total_amount || 0);
        const supplies = safeAdd(parseFloat(r.internal_parts_cost || 0), parseFloat(r.internal_external_cost || 0));

        // Al ingresar: se cobra el adelanto y se descuentan los insumos
        const advanceIncome = isReturned ? 0 : advance;
        events.push({
            kind: 'reparacion', stage: 'adelanto', date: r.created_at, income: advanceIncome, cost: supplies,
            profit: safeSubtract(advanceIncome, supplies), operator: r.operator_name, method: r.advance_payment_method, ref: r
        });

        // Al entregar: se cobra el saldo restante
        if (r.status === 'ENTREGADO' && !isReturned) {
            const balance = Math.max(0, safeSubtract(total, advance));
            events.push({
                kind: 'reparacion', stage: 'saldo', date: r.delivered_at || r.updated_at || r.created_at, income: balance, cost: 0,
                profit: balance, operator: r.operator_name, method: r.final_payment_method, ref: r
            });
        }
    });

    (raw.revalorizaciones || []).forEach(rv => {
        events.push({
            kind: 'revalorizacion', date: rv.created_at, income: 0, cost: 0,
            profit: parseFloat(rv.revaluation_profit || 0), operator: null, method: null, ref: rv
        });
    });

    return events;
}

/**
 * Filtra eventos. Las revalorizaciones no tienen persona ni medio de pago: solo cuentan sin esos filtros.
 */
export function filterEvents(events, { inPeriod = () => true, operator = 'all', method = 'all' } = {}) {
    return events.filter(ev => {
        if (!inPeriod(ev.date)) return false;
        if (ev.kind === 'revalorizacion') return operator === 'all' && method === 'all';
        if (operator !== 'all' && ev.operator !== operator) return false;
        if (method !== 'all' && ev.method !== method) return false;
        return true;
    });
}

export function sumBy(list, key) {
    return list.reduce((acc, x) => safeAdd(acc, parseFloat(x[key] || 0)), 0);
}

export const PAYMENT_METHODS = ['Caja', 'Yape/Plin', 'Transferencia', 'POS'];
