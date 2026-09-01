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
            await supabase.auth.signOut();
            clearSession();
            sessionLoaded = false;
            // Al salir de admin, volver a entrar como invitado
            await checkSession();
            showApp();
        });
    }
}

export async function checkSession() {
    if (sessionLoaded) return true;
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        await setSession(session);
        sessionLoaded = true;
        return true;
    }
    
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
        
        const { data, error } = await supabase.auth.signInWithPassword({
            email: creds.email,
            password: creds.password
        });
        if (error) throw error;
        await setSession(data.session);
        sessionLoaded = true;
        return true;
    } catch (e) {
        console.error("Error iniciando sesión de invitado.");
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
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
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
        errEl.textContent = e.message === "Email not confirmed" 
            ? "El correo no está confirmado en Supabase." 
            : "Credenciales inválidas. Verifica en Supabase.";
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
    document.getElementById("app-container").classList.remove("hidden");

    const sessionRaw = localStorage.getItem("supabase_session");
    if (!sessionRaw) return;

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
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data || !data.session) throw new Error("No se recibió sesión");

        await setSession(data.session);
        sessionLoaded = true;
        hideAdminLogin();
        showApp();
    } catch (e) {
        errEl.textContent = "Usuario o contraseña incorrectos";
        errEl.classList.remove("hidden");
    }
}