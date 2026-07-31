import { API, setSession, clearSession, showToast } from './utils.js';
import { navigateTo } from './app.js';

export function initAuth() {
    document.getElementById("login-btn").addEventListener("click", doLogin);
    document.getElementById("login-password").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
    document.getElementById("logout-btn").addEventListener("click", () => {
        clearSession();
        localStorage.removeItem("inventario_session");
        const { chartInstances } = require('./dashboard.js');
        chartInstances.forEach(c => { try { c.destroy(); } catch (e) { } });
        chartInstances.length = 0;
        showLogin();
    });
}

export function loadSession() {
    const raw = localStorage.getItem("inventario_session");
    if (raw) {
        try { setSession(JSON.parse(raw)); return true; } catch { return false; }
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
    const session = JSON.parse(localStorage.getItem("inventario_session"));
    document.getElementById("sidebar-username").textContent = session.username;
    document.getElementById("sidebar-role").textContent = session.role === "admin" ? "Administrador" : "Operador";
    document.getElementById("user-avatar").textContent = session.username[0].toUpperCase();
    document.querySelectorAll(".nav-admin-only").forEach(el => el.classList.toggle("hidden", session.role !== "admin"));
    navigateTo("dashboard");
}

async function doLogin() {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const errEl = document.getElementById("login-error");
    errEl.classList.add("hidden");
    if (!username || !password) {
        errEl.textContent = "Por favor ingresa usuario y contraseña";
        errEl.classList.remove("hidden");
        return;
    }
    try {
        const res = await fetch(`${API}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setSession(data);
        localStorage.setItem("inventario_session", JSON.stringify(data));
        document.getElementById("login-password").value = "";
        showApp();
    } catch {
        errEl.textContent = "Usuario o contraseña incorrectos";
        errEl.classList.remove("hidden");
    }
}