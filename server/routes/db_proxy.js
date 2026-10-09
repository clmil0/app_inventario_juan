const express = require('express');
const router = express.Router();
const db = require('../db');
const { TIMESTAMP_COLUMNS } = require('../schema');

// Tablas a las que el frontend puede acceder vía el proxy (evita que el nombre de tabla sea arbitrario).
// 'profiles' queda fuera a propósito: contiene contraseñas y se maneja solo vía /api/auth.
const ALLOWED_TABLES = new Set(Object.keys(TIMESTAMP_COLUMNS).concat([
    'equipment_types', 'brand_models', 'equipment_type_brands', 'common_faults', 'sale_items'
]).filter(t => t !== 'profiles'));

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Nombres de tablas/columnas se interpolan en el SQL (no se pueden parametrizar), así que se validan
function ident(name) {
    if (typeof name !== 'string' || !IDENT_RE.test(name)) {
        throw new ProxyError(`Identificador inválido: ${name}`, 400);
    }
    return name;
}

class ProxyError extends Error {
    constructor(message, status = 400, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function parseSelectCols(cols) {
    if (!cols || typeof cols !== 'string' || cols.trim() === '*') return '*';
    return cols.split(',').map(c => ident(c.trim())).join(', ');
}

function toSqlValue(val) {
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (val === undefined) return null;
    if (val !== null && typeof val === 'object') return JSON.stringify(val);
    return val;
}

// Parse a comma-separated .or() string like 'a.ilike.%b%,c.eq.d'
function parseOrClause(orString, params) {
    const clauses = String(orString).split(',');
    const sqlClauses = [];
    const ops = { ilike: 'LIKE', eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

    for (const clause of clauses) {
        const parts = clause.split('.');
        const col = ident(parts[0]);
        const op = ops[parts[1]];
        const val = parts.slice(2).join('.'); // Re-join rest in case of multiple dots
        if (!op) throw new ProxyError(`Operador no soportado en or(): ${parts[1]}`);
        sqlClauses.push(`${col} ${op} ?`); // In SQLite LIKE is case-insensitive by default
        params.push(val);
    }

    return sqlClauses.length > 0 ? `(${sqlClauses.join(' OR ')})` : '';
}

// Traduce errores de SQLite a mensajes entendibles (y a los códigos de Postgres que el frontend ya revisa)
function friendlyError(error) {
    const msg = error.message || String(error);
    const unique = msg.match(/UNIQUE constraint failed: (\S+)/);
    if (unique) return { message: `Ya existe un registro con ese valor (${unique[1]})`, code: '23505' };
    const check = msg.match(/CHECK constraint failed/);
    if (check) return { message: `Valor no permitido: ${msg}`, code: '23514' };
    if (/FOREIGN KEY constraint failed/.test(msg)) {
        return { message: 'No se puede completar: el registro está relacionado con otros datos (ventas, reparaciones, etc.)', code: '23503' };
    }
    const notNull = msg.match(/NOT NULL constraint failed: (\S+)/);
    if (notNull) return { message: `Falta un campo obligatorio (${notNull[1]})`, code: '23502' };
    return { message: msg, code: error.code };
}

router.post('/', (req, res) => {
    const { table, query } = req.body;

    if (!table || !query || !Array.isArray(query)) {
        return res.status(400).json({ error: { message: 'Invalid proxy request' } });
    }
    if (!ALLOWED_TABLES.has(table)) {
        return res.status(400).json({ error: { message: `Tabla no permitida: ${table}` } });
    }

    try {
        let action = 'select'; // default
        let selectCols = '*';
        let payload = null; // for insert, update, upsert

        let whereClauses = [];
        let params = [];
        let orderBy = '';
        let limit = '';
        let isSingle = false;

        // Parse the query chain
        for (const step of query) {
            const method = step.method;
            const args = step.args || [];

            switch (method) {
                case 'select':
                    selectCols = parseSelectCols(args[0]);
                    break;
                case 'insert':
                case 'update':
                case 'upsert':
                    action = method;
                    payload = args[0];
                    break;
                case 'delete':
                    action = 'delete';
                    break;
                case 'eq':
                    whereClauses.push(`${ident(args[0])} = ?`);
                    params.push(toSqlValue(args[1]));
                    break;
                case 'neq':
                    whereClauses.push(`${ident(args[0])} != ?`);
                    params.push(toSqlValue(args[1]));
                    break;
                case 'gt':
                    whereClauses.push(`${ident(args[0])} > ?`);
                    params.push(toSqlValue(args[1]));
                    break;
                case 'gte':
                    whereClauses.push(`${ident(args[0])} >= ?`);
                    params.push(toSqlValue(args[1]));
                    break;
                case 'lt':
                    whereClauses.push(`${ident(args[0])} < ?`);
                    params.push(toSqlValue(args[1]));
                    break;
                case 'lte':
                    whereClauses.push(`${ident(args[0])} <= ?`);
                    params.push(toSqlValue(args[1]));
                    break;
                case 'ilike':
                    whereClauses.push(`${ident(args[0])} LIKE ?`);
                    params.push(args[1]);
                    break;
                case 'in': {
                    const inVals = args[1];
                    if (Array.isArray(inVals) && inVals.length > 0) {
                        const placeholders = inVals.map(() => '?').join(', ');
                        whereClauses.push(`${ident(args[0])} IN (${placeholders})`);
                        params.push(...inVals.map(toSqlValue));
                    } else {
                        whereClauses.push(`1 = 0`); // Empty IN clause means false
                    }
                    break;
                }
                case 'or': {
                    const orSql = parseOrClause(args[0], params);
                    if (orSql) whereClauses.push(orSql);
                    break;
                }
                case 'order': {
                    const orderOpts = args[1] || {};
                    const dir = orderOpts.ascending === false ? 'DESC' : 'ASC';
                    orderBy = `ORDER BY ${ident(args[0])} ${dir}`;
                    break;
                }
                case 'limit': {
                    const n = parseInt(args[0], 10);
                    if (!isNaN(n) && n >= 0) limit = `LIMIT ${n}`;
                    break;
                }
                case 'range': {
                    const start = parseInt(args[0], 10);
                    const end = parseInt(args[1], 10);
                    if (!isNaN(start) && !isNaN(end) && end >= start && start >= 0) {
                        limit = `LIMIT ${end - start + 1} OFFSET ${start}`;
                    }
                    break;
                }
                case 'single':
                    isSingle = true;
                    break;
                default:
                    throw new ProxyError(`Método no soportado: ${method}`);
            }
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        if (action === 'select') {
            const sql = `SELECT ${selectCols} FROM ${table} ${whereSql} ${orderBy} ${isSingle ? 'LIMIT 1' : limit}`.trim();
            if (isSingle) {
                const row = db.prepare(sql).get(...params);
                if (!row) {
                    return res.status(406).json({ data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } });
                }
                return res.json({ data: row, error: null });
            }
            return res.json({ data: db.prepare(sql).all(...params), error: null });
        }

        // Igual que Supabase: no se permite UPDATE/DELETE sin filtro (evita vaciar una tabla por error)
        if ((action === 'delete' || action === 'update') && whereClauses.length === 0) {
            throw new ProxyError(`${action.toUpperCase()} requiere al menos un filtro`);
        }

        if (action === 'delete') {
            const info = db.prepare(`DELETE FROM ${table} ${whereSql}`).run(...params);
            return res.json({ data: null, count: info.changes, error: null });
        }

        if (action === 'update') {
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ProxyError('Invalid update payload');
            const keys = Object.keys(payload).map(ident);
            if (keys.length === 0) return res.json({ data: null, error: null });

            const setSql = keys.map(k => `${k} = ?`).join(', ');
            const updateVals = keys.map(k => toSqlValue(payload[k]));
            const info = db.prepare(`UPDATE ${table} SET ${setSql} ${whereSql}`).run(...updateVals, ...params);
            return res.json({ data: null, count: info.changes, error: null });
        }

        if (action === 'insert' || action === 'upsert') {
            const items = Array.isArray(payload) ? payload : [payload];
            if (items.length === 0) return res.json({ data: [], error: null });
            if (items.some(r => !r || typeof r !== 'object')) throw new ProxyError('Invalid insert payload');

            const selectByRowid = db.prepare(`SELECT * FROM ${table} WHERE rowid = ?`);
            const selectById = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);

            // Antes: INSERT OR IGNORE (errores silenciados, se devolvía el id de OTRA fila) y
            // upsert = INSERT OR REPLACE (borraba la fila y perdía las columnas no enviadas).
            const insertMany = db.transaction((rows) => {
                const inserted = [];
                for (const row of rows) {
                    const keys = Object.keys(row).map(ident); // cada fila con sus propias columnas
                    const vals = keys.map(k => toSqlValue(row[k]));
                    const existing = action === 'upsert' && keys.includes('id') ? selectById.get(toSqlValue(row.id)) : null;
                    let info;
                    if (existing) {
                        // Upsert sobre fila existente = UPDATE solo de las columnas enviadas
                        const setKeys = keys.filter(k => k !== 'id');
                        if (setKeys.length > 0) {
                            db.prepare(`UPDATE ${table} SET ${setKeys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
                                .run(...setKeys.map(k => toSqlValue(row[k])), toSqlValue(row.id));
                        }
                    } else {
                        info = db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...vals);
                    }
                    // Si se envió id se relee por id (en un UPDATE lastInsertRowid no cambia)
                    const saved = keys.includes('id')
                        ? selectById.get(toSqlValue(row.id))
                        : selectByRowid.get(info.lastInsertRowid);
                    inserted.push(saved || { ...row });
                }
                return inserted;
            });

            const insertedData = insertMany(items);
            return res.json({ data: isSingle ? insertedData[0] : insertedData, error: null });
        }

        throw new ProxyError(`Acción no soportada: ${action}`);
    } catch (error) {
        console.error("Proxy Error:", error);
        const status = error instanceof ProxyError ? error.status : 500;
        return res.status(status).json({ data: null, error: friendlyError(error) });
    }
});

module.exports = router;
