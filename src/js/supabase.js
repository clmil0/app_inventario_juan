// ═══ Configuración de Supabase ═══
const SUPABASE_URL = 'https://enewgbhzmnecmyhjajif.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZXdnYmh6bW5lY215aGphamlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NTcxMTgsImV4cCI6MjEwMTAzMzExOH0.oQI7Lgi3OeIrGjRLgDjs_h354jW0DSCBCW7r_uS0K0c';

// Inicializar cliente
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ═══ Variables de sesión ═══
let session = null;

export function getSession() {
    return session;
}

export async function setSession(sess) {
    session = sess;
    if (sess) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', sess.user.id)
            .single();
        if (profile) {
            session.profile = profile;
        }
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