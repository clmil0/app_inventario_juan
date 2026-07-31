// Configuración de Supabase
const SUPABASE_URL = 'https://enewgbhzmnecmyhjajif.supabase.co/rest/v1/';  // ← CAMBIA POR TU URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZXdnYmh6bW5lY215aGphamlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NTcxMTgsImV4cCI6MjEwMTAzMzExOH0.oQI7Lgi3OeIrGjRLgDjs_h354jW0DSCBCW7r_uS0K0c';                    // ← CAMBIA POR TU ANON KEY

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
        // Obtener perfil del usuario
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', sess.user.id)
            .single();
        if (profile) {
            session.profile = profile;
        }
        localStorage.setItem('supabase_session', JSON.stringify(sess));
    } else {
        localStorage.removeItem('supabase_session');
    }
}

export function clearSession() {
    session = null;
    localStorage.removeItem('supabase_session');
}

export async function loadSession() {
    const stored = localStorage.getItem('supabase_session');
    if (stored) {
        const sess = JSON.parse(stored);
        await setSession(sess);
        return true;
    }

    // Intentar recuperar sesión de Supabase
    const { data: { session: sess } } = await supabase.auth.getSession();
    if (sess) {
        await setSession(sess);
        return true;
    }
    return false;
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

// ═══ API wrapper ═══
export { supabase };
export { setSession, clearSession, loadSession, getSession };
export { fmt, showToast };