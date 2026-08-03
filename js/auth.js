import { supabase, setSession, clearSession } from './supabase.js';
import { navigateTo } from './app.js';

let sessionLoaded = false;

export function initAuth() {
    const loginBtn = document.getElementById("login-btn");
    const passwordInput = document.getElementById("login-password");
    const logoutBtn = document.getElementById("logout-btn");

    if (loginBtn) loginBtn.addEventListener("click", doLogin);
    if (passwordInput) passwordInput.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            await supabase.auth.signOut();
            clearSession();
            showLogin();
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
    return false;
}

export function showLogin() {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app-container").classList.add("hidden");
}

export function showApp() {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app-container").classList.remove("hidden");

    const sessionRaw = localStorage.getItem("supabase_session");
    if (!sessionRaw) return;

    const session = JSON.parse(sessionRaw);
    const username = session.profile?.username || session.user?.email?.split('@')[0] || 'Usuario';
    const role = session.profile?.role || 'operator';

    document.getElementById("sidebar-username").textContent = username;
    document.getElementById("sidebar-role").textContent = role === "admin" ? "Administrador" : "Operador";
    document.getElementById("user-avatar").textContent = username[0].toUpperCase();
    document.querySelectorAll(".nav-admin-only").forEach(el => el.classList.toggle("hidden", role !== "admin"));
    navigateTo("dashboard");
}

async function doLogin() {
    const email = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const errEl = document.getElementById("login-error");
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
        document.getElementById("login-password").value = "";
        sessionLoaded = true;
        showApp();
    } catch (e) {
        errEl.textContent = "Usuario o contraseña incorrectos";
        errEl.classList.remove("hidden");
    }
}