import { supabase, setSession, clearSession } from './supabase.js';
import { navigateTo } from './app.js';

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
    if (loginBtn) loginBtn.addEventListener("click", doAdminLogin);
    if (passwordInput) passwordInput.addEventListener("keydown", e => { if (e.key === "Enter") doAdminLogin(); });
    
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
    const errEl = document.getElementById("device-login-error");
    errEl.classList.add("hidden");

    if (!email || !password) {
        errEl.textContent = "Por favor ingresa correo y contraseña";
        errEl.classList.remove("hidden");
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
        errEl.textContent = "Credenciales inválidas. Verifica en el sistema.";
        errEl.classList.remove("hidden");
    }
}

export function showAdminLogin() {
    document.getElementById("admin-login-modal").classList.remove("hidden");
    document.getElementById("admin-login-error").classList.add("hidden");
    document.getElementById("admin-login-password").value = "";
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

    if (isAdmin) {
        navigateTo("dashboard");
    } else {
        navigateTo("sales");
    }
}

async function doAdminLogin() {
    const email = document.getElementById("admin-login-username").value.trim();
    const password = document.getElementById("admin-login-password").value;
    const errEl = document.getElementById("admin-login-error");
    errEl.classList.add("hidden");

    if (!email || !password) {
        errEl.textContent = "Por favor ingresa usuario y contraseña";
        errEl.classList.remove("hidden");
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
        errEl.textContent = e.message || "Usuario o contraseña incorrectos";
        errEl.classList.remove("hidden");
    }
}