// ═══ Cliente Supabase Proxy Local ═══
class SupabaseQueryBuilder {
    constructor(table) {
        this.table = table;
        this.query = [];
    }

    select(cols) { this.query.push({ method: 'select', args: [cols] }); return this; }
    insert(payload) { this.query.push({ method: 'insert', args: [payload] }); return this; }
    update(payload) { this.query.push({ method: 'update', args: [payload] }); return this; }
    upsert(payload) { this.query.push({ method: 'upsert', args: [payload] }); return this; }
    delete() { this.query.push({ method: 'delete', args: [] }); return this; }
    
    eq(col, val) { this.query.push({ method: 'eq', args: [col, val] }); return this; }
    neq(col, val) { this.query.push({ method: 'neq', args: [col, val] }); return this; }
    gt(col, val) { this.query.push({ method: 'gt', args: [col, val] }); return this; }
    gte(col, val) { this.query.push({ method: 'gte', args: [col, val] }); return this; }
    lt(col, val) { this.query.push({ method: 'lt', args: [col, val] }); return this; }
    lte(col, val) { this.query.push({ method: 'lte', args: [col, val] }); return this; }
    ilike(col, val) { this.query.push({ method: 'ilike', args: [col, val] }); return this; }
    in(col, vals) { this.query.push({ method: 'in', args: [col, vals] }); return this; }
    or(str) { this.query.push({ method: 'or', args: [str] }); return this; }
    order(col, opts) { this.query.push({ method: 'order', args: [col, opts] }); return this; }
    limit(n) { this.query.push({ method: 'limit', args: [n] }); return this; }
    range(start, end) { this.query.push({ method: 'range', args: [start, end] }); return this; }
    single() { this.query.push({ method: 'single', args: [] }); return this; }

    async then(resolve, reject) {
        try {
            const res = await fetch('/api/db/proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table: this.table, query: this.query })
            });
            const json = await res.json();
            resolve(json);
        } catch (error) {
            reject(error);
        }
    }
}

const supabase = {
    from: (table) => new SupabaseQueryBuilder(table),
    channel: () => ({
        on: () => ({ subscribe: () => {} })
    })
};

// ═══ Variables de sesión ═══
let session = null;

export function getSession() {
    return session;
}

export async function setSession(sess) {
    session = sess;
    if (sess) {
        // En local ya tenemos el profile gracias a /api/auth/login
        localStorage.setItem('supabase_session', JSON.stringify(session));
    } else {
        localStorage.removeItem('supabase_session');
    }
}

export function clearSession() {
    session = null;
    localStorage.removeItem('supabase_session');
}

// ═══ Helpers ═══
export function fmt(n) {
    const num = parseFloat(n) || 0;
    return 'S/ ' + num.toFixed(2);
}

export function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

export function generateSequentialTicket(prefix, dbId) {
    // Convierte el ID (1, 2, 3...) en un código tipo V0000AAA
    const index = (dbId || 1) - 1; // 0-based
    const numPart = index % 10000;
    const letterIndex = Math.floor(index / 10000);
    
    // Convertir letterIndex a 3 letras (Base 26)
    const l1 = Math.floor(letterIndex / (26 * 26)) % 26;
    const l2 = Math.floor(letterIndex / 26) % 26;
    const l3 = letterIndex % 26;
    
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const letters = chars[l1] + chars[l2] + chars[l3];
    
    return `${prefix}${String(numPart).padStart(4, '0')}${letters}`;
}

// ═══ Realtime Global Subscription ═══
supabase
    .channel('public-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
        window.dispatchEvent(new CustomEvent('supabase_realtime', { detail: payload }));
    })
    .subscribe();

export { supabase };