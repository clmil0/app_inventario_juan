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

    // Fecha en que cada reparación se marcó TERMINADO (la última vez, por si volvió a proceso)
    const finishedAt = new Map();
    (raw.historialReparaciones || []).forEach(h => {
        if (h.status !== 'TERMINADO') return;
        const prev = finishedAt.get(h.repair_id);
        if (!prev || String(h.changed_at) > String(prev)) finishedAt.set(h.repair_id, h.changed_at);
    });

    // Reparaciones: el dinero entra a la contabilidad (ganancia y caja) por etapas, cada una en su fecha:
    //  · al marcar TERMINADO entra el adelanto (y se descuentan los insumos);
    //  · al marcar ENTREGADO entra el saldo restante;
    //  · si se pasa directo a ENTREGADO sin TERMINADO, entra todo (adelanto + saldo) en la fecha de entrega.
    // Mientras está pendiente / en diagnóstico / en proceso, el adelanto todavía no cuenta.
    (raw.reparaciones || []).forEach(r => {
        const isReturned = RETURNED_REPAIR_STATUSES.includes(String(r.status || '').toUpperCase());
        const advance = parseFloat(r.advance_payment || 0);
        const total = parseFloat(r.total_amount || 0);
        const supplies = safeAdd(parseFloat(r.internal_parts_cost || 0), parseFloat(r.internal_external_cost || 0));
        const outflow = parseFloat(r.internal_external_cost || 0);

        if (isReturned) {
            // Devuelta sin reparar: no hay ingreso, pero los insumos usados son pérdida
            if (supplies > 0) events.push({
                kind: 'reparacion', stage: 'adelanto', date: r.delivered_at || r.created_at, income: 0, cost: supplies,
                profit: -supplies, operator: r.operator_name, method: r.advance_payment_method, ref: r, outflow
            });
            return;
        }
        if (r.status !== 'TERMINADO' && r.status !== 'ENTREGADO') return;

        const deliveredAt = r.delivered_at || r.updated_at || r.created_at;
        let finished = finishedAt.get(r.id) || null;
        // Un TERMINADO posterior a la entrega no cuenta como etapa previa
        if (r.status === 'ENTREGADO' && finished && deliveredAt && String(finished) > String(deliveredAt)) finished = null;
        // Datos antiguos sin historial: se usa la fecha de ingreso para no perder el adelanto
        if (r.status === 'TERMINADO' && !finished) finished = r.created_at;

        events.push({
            kind: 'reparacion', stage: 'adelanto', direct: !finished, date: finished || deliveredAt, income: advance, cost: supplies,
            profit: safeSubtract(advance, supplies), operator: r.operator_name, method: r.advance_payment_method || 'Caja', ref: r, outflow
        });

        if (r.status === 'ENTREGADO') {
            const balance = Math.max(0, safeSubtract(total, advance));
            events.push({
                kind: 'reparacion', stage: 'saldo', direct: !finished, date: deliveredAt, income: balance, cost: 0,
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

/**
 * Movimientos de efectivo de un día para el cuadre del cajón.
 * Los cobros de reparaciones siguen la misma regla que el libro de caja: el adelanto entra al marcar TERMINADO
 * y el saldo al entregar. Un adelanto de una reparación aún pendiente no cuenta.
 * @param {object} raw  respuesta de /api/dashboard/raw
 * @param {(date:string)=>boolean} inDay
 */
export function cashDrawerMovements(raw, inDay) {
    const events = buildProfitEvents(raw).filter(ev => ev.method === 'Caja' && inDay(ev.date));
    const ventas = sumBy(events.filter(ev => ev.kind === 'venta'), 'income');
    const cobrosReparaciones = sumBy(events.filter(ev => ev.kind === 'reparacion'), 'income');
    const retiros = sumBy((raw.retiros || []).filter(w => w.source === 'Caja' && inDay(w.created_at)), 'amount');
    const pagosTerceros = sumBy((raw.costosExternos || []).filter(c => c.payment_method === 'Caja' && inDay(c.recorded_at)), 'cost_amount');
    return { ventas, cobrosReparaciones, retiros, pagosTerceros };
}

export const PAYMENT_METHODS = ['Caja', 'Yape/Plin', 'Transferencia', 'POS'];
