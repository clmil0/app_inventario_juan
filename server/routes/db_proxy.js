const express = require('express');
const router = express.Router();
const db = require('../db');

// Parse a comma-separated .or() string like 'a.ilike.%b%,c.eq.d'
function parseOrClause(orString, params) {
    const clauses = orString.split(',');
    const sqlClauses = [];
    
    for (const clause of clauses) {
        const parts = clause.split('.');
        const col = parts[0];
        const op = parts[1];
        const val = parts.slice(2).join('.'); // Re-join rest in case of multiple dots
        
        switch (op) {
            case 'ilike':
                sqlClauses.push(`${col} LIKE ?`);
                params.push(val); // In SQLite LIKE is case-insensitive by default
                break;
            case 'eq':
                sqlClauses.push(`${col} = ?`);
                params.push(val);
                break;
            case 'neq':
                sqlClauses.push(`${col} != ?`);
                params.push(val);
                break;
            case 'gt':
                sqlClauses.push(`${col} > ?`);
                params.push(val);
                break;
            case 'gte':
                sqlClauses.push(`${col} >= ?`);
                params.push(val);
                break;
            case 'lt':
                sqlClauses.push(`${col} < ?`);
                params.push(val);
                break;
            case 'lte':
                sqlClauses.push(`${col} <= ?`);
                params.push(val);
                break;
        }
    }
    
    return sqlClauses.length > 0 ? `(${sqlClauses.join(' OR ')})` : '';
}

router.post('/', (req, res) => {
    const { table, query } = req.body;
    
    if (!table || !query || !Array.isArray(query)) {
        return res.status(400).json({ error: 'Invalid proxy request' });
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
            const args = step.args;

            switch (method) {
                case 'select':
                    if (action === 'select') { // only change action if it's not already a mutation
                        action = 'select';
                    }
                    if (args[0] && typeof args[0] === 'string') {
                        selectCols = args[0];
                    }
                    break;
                case 'insert':
                    action = 'insert';
                    payload = args[0];
                    break;
                case 'update':
                    action = 'update';
                    payload = args[0];
                    break;
                case 'upsert':
                    action = 'upsert';
                    payload = args[0];
                    break;
                case 'delete':
                    action = 'delete';
                    break;
                case 'eq':
                    whereClauses.push(`${args[0]} = ?`);
                    params.push(args[1]);
                    break;
                case 'neq':
                    whereClauses.push(`${args[0]} != ?`);
                    params.push(args[1]);
                    break;
                case 'gt':
                    whereClauses.push(`${args[0]} > ?`);
                    params.push(args[1]);
                    break;
                case 'gte':
                    whereClauses.push(`${args[0]} >= ?`);
                    params.push(args[1]);
                    break;
                case 'lt':
                    whereClauses.push(`${args[0]} < ?`);
                    params.push(args[1]);
                    break;
                case 'lte':
                    whereClauses.push(`${args[0]} <= ?`);
                    params.push(args[1]);
                    break;
                case 'ilike':
                    whereClauses.push(`${args[0]} LIKE ?`);
                    params.push(args[1]);
                    break;
                case 'in':
                    const inVals = args[1];
                    if (Array.isArray(inVals) && inVals.length > 0) {
                        const placeholders = inVals.map(() => '?').join(', ');
                        whereClauses.push(`${args[0]} IN (${placeholders})`);
                        params.push(...inVals);
                    } else {
                        whereClauses.push(`1 = 0`); // Empty IN clause means false
                    }
                    break;
                case 'or':
                    const orSql = parseOrClause(args[0], params);
                    if (orSql) {
                        whereClauses.push(orSql);
                    }
                    break;
                case 'order':
                    const orderCol = args[0];
                    const orderOpts = args[1] || {};
                    const dir = orderOpts.ascending === false ? 'DESC' : 'ASC';
                    orderBy = `ORDER BY ${orderCol} ${dir}`;
                    break;
                case 'limit':
                    limit = `LIMIT ${args[0]}`;
                    break;
                case 'range':
                    const start = parseInt(args[0], 10);
                    const end = parseInt(args[1], 10);
                    if (!isNaN(start) && !isNaN(end)) {
                        limit = `LIMIT ${end - start + 1} OFFSET ${start}`;
                    }
                    break;
                case 'single':
                    isSingle = true;
                    limit = 'LIMIT 1';
                    break;
            }
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        let sql = '';
        let executeParams = [];
        let result = null;

        // Execute Action
        if (action === 'select') {
            sql = `SELECT ${selectCols} FROM ${table} ${whereSql} ${orderBy} ${limit}`.trim();
            executeParams = params;
            
            if (isSingle) {
                result = db.prepare(sql).get(...executeParams);
                if (!result) {
                    return res.status(406).json({ error: { message: 'JSON object requested, multiple (or no) rows returned' } });
                }
            } else {
                result = db.prepare(sql).all(...executeParams);
            }
            return res.json({ data: result || [], error: null });
        } 
        else if (action === 'delete') {
            sql = `DELETE FROM ${table} ${whereSql}`.trim();
            executeParams = params;
            db.prepare(sql).run(...executeParams);
            return res.json({ data: null, error: null });
        }
        else if (action === 'update') {
            if (!payload || typeof payload !== 'object') throw new Error("Invalid update payload");
            const keys = Object.keys(payload);
            if (keys.length === 0) return res.json({ data: null, error: null });
            
            const setSql = keys.map(k => `${k} = ?`).join(', ');
            const updateVals = keys.map(k => {
                let val = payload[k];
                if (typeof val === 'boolean') return val ? 1 : 0;
                if (val === undefined) return null;
                return val;
            });
            
            sql = `UPDATE ${table} SET ${setSql} ${whereSql}`.trim();
            executeParams = [...updateVals, ...params];
            
            db.prepare(sql).run(...executeParams);
            return res.json({ data: null, error: null });
        }
        else if (action === 'insert' || action === 'upsert') {
            const items = Array.isArray(payload) ? payload : [payload];
            if (items.length === 0) return res.json({ data: [], error: null });
            
            const keys = Object.keys(items[0]);
            const cols = keys.join(', ');
            const placeholders = keys.map(() => '?').join(', ');
            
            const conflictSql = action === 'upsert' ? 'OR REPLACE' : 'OR IGNORE';
            sql = `INSERT ${conflictSql} INTO ${table} (${cols}) VALUES (${placeholders})`;
            
            const insertMany = db.transaction((rows) => {
                const stmt = db.prepare(sql);
                const inserted = [];
                for (const row of rows) {
                    const vals = keys.map(k => {
                        let val = row[k];
                        if (typeof val === 'boolean') return val ? 1 : 0; // Fix booleans implicitly!
                        if (val === undefined) return null; // Fix undefined implicitly!
                        return val;
                    });
                    try {
                        const info = stmt.run(...vals);
                        inserted.push({ ...row, id: row.id || info.lastInsertRowid });
                    } catch (err) {
                        console.error('SQL Insert Error on vals:', vals, err);
                        throw err;
                    }
                }
                return inserted;
            });
            
            const insertedData = insertMany(items);
            return res.json({ data: isSingle ? insertedData[0] : insertedData, error: null });
        }

    } catch (error) {
        console.error("Proxy Error:", error);
        return res.status(500).json({ error: { message: error.message } });
    }
});

module.exports = router;
