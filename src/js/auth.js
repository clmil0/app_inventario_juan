import { supabase, setSession, clearSession } from './supabase.js';
import { navigateTo, refreshStockAlerts } from './app.js';

let sessionLoaded = false;

export function initAuth() {
    const loginBtn = document.getElementById("admin-login-btn");
    const passwordInput = document.getElementById("admin-login-password");
    const logoutBtn = document.getElementById("admin-logout-btn");
    const openAdminBtn = document.getElementById("open-admin-login");
    const closeAdminBtn = document.getElementById("close-admin-modal");
    const authDeviceBtn = document.getElementById("authorize-device-btn");

    if (openAdminBtn) openAdminBtn.addEventListener("click", showAdminLogin);
    if (closeAdminBtn) closeAdminBtn.addEventListener("click", hideAdminLogin);
    if (authDeviceBtn) authDeviceBtn.addEventListener("click", doDeviceAuthorization);
    // Los botones son type="submit" dentro de un <form>: Enter en los campos ya dispara el clic
    if (loginBtn) loginBtn.addEventListener("click", doAdminLogin);
    document.querySelectorAll("[data-close-admin-login]").forEach(el => el.addEventListener("click", hideAdminLogin));
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && !document.getElementById("admin-login-modal")?.classList.contains("hidden")) hideAdminLogin();
    });
    document.querySelectorAll("[data-show-pass]").forEach(btn => btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.showPass);
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.textContent = show ? "Ocultar" : "Mostrar";
    }));
    // Al escribir de nuevo se quita el estado de error
    ["admin-login-username", "admin-login-password", "device-guest-email", "device-guest-password"].forEach(id => {
        document.getElementById(id)?.addEventListener("input", () => setAuthError(id.startsWith("admin") ? "admin-login-error" : "device-login-error", null));
    });
    const term = document.getElementById("auth-terminal-name");
    if (term) term.textContent = detectBrowser();
    
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            console.log("LOGOUT BUTTON CLICKED");
            alert("Saliendo de la sesión de Administrador...");
            
            // Limpiar la sesión actual de Supabase
            clearSession();
            sessionLoaded = false;
            
            // No eliminamos las credenciales del equipo (repairtech_guest_creds) 
            // para que pueda volver a loguearse como Operador automáticamente.
            
            // Recargar la página; checkSession() iniciará sesión como Operador.
            window.location.reload();
        });
    }
}

function detectBrowser() {
    const ua = navigator.userAgent;
    if (window.electronAPI || /Electron/.test(ua)) return "App de escritorio";
    if (/Edg\//.test(ua)) return "Edge";
    if (/Chrome\//.test(ua)) return "Chrome";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Safari\//.test(ua)) return "Safari";
    return "Este navegador";
}

// Muestra (o limpia con msg = null) el error de un formulario de acceso y marca sus campos
function setAuthError(errId, msg) {
    const errEl = document.getElementById(errId);
    if (!errEl) return;
    errEl.textContent = msg || "";
    errEl.classList.toggle("hidden", !msg);
    errEl.closest("form")?.classList.toggle("has-error", !!msg);
    if (msg && errEl.animate) errEl.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 380 });
}

export async function checkSession() {
    // Si la sesión ya se cargó en memoria (navegación SPA), la usamos
    if (sessionLoaded) return true;
    
    // Al iniciar la app, siempre forzamos iniciar con las credenciales por defecto de la PC (Operador)
    try {
        const credsRaw = localStorage.getItem("repairtech_guest_creds");
        if (!credsRaw) return false;
        
        let creds;
        try {
            creds = JSON.parse(credsRaw);
        } catch (parseError) {
            localStorage.removeItem("repairtech_guest_creds");
            return false;
        }
        
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: creds.email, password: creds.password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        
        await setSession(data.session);
        sessionLoaded = true;
        return true;
    } catch (e) {
        console.error("Error iniciando sesión de operador por defecto.");
        return false;
    }
}

async function doDeviceAuthorization() {
    const email = document.getElementById("device-guest-email").value.trim();
    const password = document.getElementById("device-guest-password").value;
    setAuthError("device-login-error", null);

    if (!email || !password) {
        setAuthError("device-login-error", "Ingresa correo y contraseña");
        return;
    }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!data || !data.session) throw new Error("No se recibió sesión");

        // Guardar credenciales para el inicio automático y la bandera de autorizado
        localStorage.setItem("repairtech_guest_creds", JSON.stringify({ email, password }));
        localStorage.setItem("repairtech_device_authorized", "true");
        
        await setSession(data.session);
        sessionLoaded = true;
        
        document.getElementById("device-lock-screen").classList.add("hidden");
        showApp();
    } catch (e) {
        console.error("Error al autorizar dispositivo:", e);
        setAuthError("device-login-error", "Credenciales inválidas. Verifica con el administrador.");
    }
}

export function showAdminLogin() {
    document.getElementById("admin-login-modal").classList.remove("hidden");
    setAuthError("admin-login-error", null);
    document.getElementById("admin-login-password").value = "";
    setTimeout(() => document.getElementById("admin-login-username")?.focus(), 60);
}

export function hideAdminLogin() {
    document.getElementById("admin-login-modal").classList.add("hidden");
}

export function showApp() {
    const sessionRaw = localStorage.getItem("supabase_session");
    if (!sessionRaw) {
        document.getElementById("app-container").classList.add("hidden");
        document.getElementById("device-lock-screen").classList.remove("hidden");
        return;
    }

    document.getElementById("app-container").classList.remove("hidden");
    document.getElementById("device-lock-screen").classList.add("hidden");

    let session = {};
    try {
        session = JSON.parse(sessionRaw);
    } catch (e) {
        localStorage.removeItem("supabase_session");
        window.location.reload();
        return;
    }
    const role = session.profile?.role || 'operator';

    const isAdmin = role === "admin";
    
    document.querySelectorAll(".nav-admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin));
    
    const openAdminBtn = document.getElementById("open-admin-login");
    const logoutBtn = document.getElementById("admin-logout-btn");
    
    if (openAdminBtn) openAdminBtn.style.display = isAdmin ? "none" : "flex";
    if (logoutBtn) logoutBtn.style.display = isAdmin ? "flex" : "none";

    const name = session.profile?.full_name || session.profile?.username || session.user?.email || '';
    const avatar = document.getElementById("user-avatar");
    if (avatar) {
        const base = String(name).split('@')[0].trim();
        avatar.textContent = isAdmin ? (base.slice(0, 2).toUpperCase() || 'AD') : 'OP';
        avatar.style.background = isAdmin ? 'var(--blue-bg)' : 'var(--surface-ink)';
    }
    const roleLabel = document.getElementById("user-role-label");
    if (roleLabel) roleLabel.textContent = isAdmin ? `Administrador${name ? ' · ' + name : ''}` : 'Operador (equipo autorizado)';
    refreshStockAlerts();

    if (isAdmin) {
        navigateTo("dashboard");
    } else {
        navigateTo("sales");
    }
}

async function doAdminLogin() {
    const email = document.getElementById("admin-login-username").value.trim();
    const password = document.getElementById("admin-login-password").value;
    setAuthError("admin-login-error", null);

    if (!email || !password) {
        setAuthError("admin-login-error", "Ingresa usuario y contraseña");
        return;
    }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        
        if (!response.ok) throw new Error(data.error);
        if (!data || !data.session) throw new Error("No se recibió sesión");

        await setSession(data.session);
        sessionLoaded = true;
        hideAdminLogin();
        showApp();
    } catch (e) {
        setAuthError("admin-login-error", e.message || "Credenciales incorrectas");
    }
}