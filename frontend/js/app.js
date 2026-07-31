import { loadSession, showLogin, showApp, initAuth } from './auth.js';
import { loadDashboard, chartInstances } from './dashboard.js';
import { loadSalesView, bindSalesEvents } from './sales.js';
import { loadRepairs, bindRepairEvents } from './repairs.js';
import { loadAdminView, bindAdminEvents } from './admin.js';

// Eventos globales de modales fijos
// NOTA: El cierre por backdrop está DESACTIVADO.
// Solo se cierran con el botón "X" (close-modal-btn) o botones específicos.
document.querySelectorAll(".close-modal-btn").forEach(btn => btn.addEventListener("click", e => e.target.closest(".modal")?.classList.add("hidden")));
document.getElementById("close-sale-modal")?.addEventListener("click", () => document.getElementById("sale-success-modal")?.classList.add("hidden"));
function initNav() {
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", e => {
            e.preventDefault();
            navigateTo(item.getAttribute("data-view"));
        });
    });
}

export async function navigateTo(viewId) {
    chartInstances.forEach(c => { try { c.destroy(); } catch (e) { } });
    chartInstances.length = 0;
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.querySelector(`[data-view="${viewId}"]`)?.classList.add("active");
    const container = document.getElementById("view-container");
    try {
        const res = await fetch(`/views/${viewId}.html`);
        if (!res.ok) throw new Error("Vista no encontrada");
        container.innerHTML = await res.text();
        switch (viewId) {
            case "dashboard": await loadDashboard(); break;
            case "sales": await loadSalesView(); bindSalesEvents(); break;
            case "repairs": await loadRepairs(); bindRepairEvents(); break;
            case "admin": await loadAdminView(); bindAdminEvents(); break;
        }
    } catch (e) {
        container.innerHTML = `<p class="text-dim" style="text-align:center;padding:2rem;">Error al cargar la vista</p>`;
    }
}

// Arranque
document.addEventListener("DOMContentLoaded", () => {
    initAuth();
    if (loadSession()) {
        initNav();
        showApp();
    } else {
        showLogin();
    }
});