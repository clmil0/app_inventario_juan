import { supabase } from './supabase.js';
import { initAuth, checkSession, showLogin, showApp } from './auth.js';
import { loadDashboard, chartInstances } from './dashboard.js';
import { loadSalesView, bindSalesEvents } from './sales.js';
import { loadRepairs, bindRepairEvents } from './repairs.js';
import { loadAdminView, bindAdminEvents } from './admin.js';

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

const viewCache = {};

export async function navigateTo(viewId) {
    chartInstances.forEach(c => { try { c.destroy(); } catch (e) { } });
    chartInstances.length = 0;
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.querySelector(`[data-view="${viewId}"]`)?.classList.add("active");
    const container = document.getElementById("view-container");
    try {
        if (!viewCache[viewId]) {
            const res = await fetch(`./views/${viewId}.html`);
            if (!res.ok) throw new Error("Vista no encontrada");
            viewCache[viewId] = await res.text();
        }
        container.innerHTML = viewCache[viewId];
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

function initTheme() {
    const modeBtn = document.getElementById("mode-switch-btn");
    const sunIcon = document.getElementById("theme-icon-sun");
    const moonIcon = document.getElementById("theme-icon-moon");

    function applyTheme(theme) {
        if (theme === "light") {
            document.body.classList.add("light-mode");
            if (sunIcon) sunIcon.style.display = "none";
            if (moonIcon) moonIcon.style.display = "block";
        } else {
            document.body.classList.remove("light-mode");
            if (sunIcon) sunIcon.style.display = "block";
            if (moonIcon) moonIcon.style.display = "none";
        }
        localStorage.setItem("repairtech_theme", theme);
    }

    const savedTheme = localStorage.getItem("repairtech_theme") || "dark";
    applyTheme(savedTheme);

    modeBtn?.addEventListener("click", () => {
        const isLight = document.body.classList.contains("light-mode");
        modeBtn.classList.add("active");
        setTimeout(() => modeBtn.classList.remove("active"), 400);
        applyTheme(isLight ? "dark" : "light");
    });
}

function initQuickSearch() {
    const searchInput = document.getElementById("global-quick-search");
    const dropdown = document.getElementById("quick-search-dropdown");
    if (!searchInput || !dropdown) return;

    let debounceTimer;

    searchInput.addEventListener("input", e => {
        const query = e.target.value.trim().toLowerCase();
        clearTimeout(debounceTimer);
        if (query.length < 2) {
            dropdown.classList.add("hidden");
            dropdown.innerHTML = "";
            return;
        }

        debounceTimer = setTimeout(async () => {
            try {
                const [productsRes, repairsRes] = await Promise.all([
                    supabase.from("products").select("id, name, code, brand, sale_price, stock").or(`name.ilike.%${query}%,code.ilike.%${query}%,brand.ilike.%${query}%`).limit(4),
                    supabase.from("repairs").select("id, ticket_code, customer_name, equipment_type, brand_model, status").or(`ticket_code.ilike.%${query}%,customer_name.ilike.%${query}%,equipment_type.ilike.%${query}%,brand_model.ilike.%${query}%`).limit(4)
                ]);

                if (productsRes.error) console.error("Error en productos quick search:", productsRes.error);
                if (repairsRes.error) console.error("Error en reparaciones quick search:", repairsRes.error);

                const products = productsRes.data || [];
                const repairs = repairsRes.data || [];

                if (products.length === 0 && repairs.length === 0) {
                    dropdown.innerHTML = `<div style="padding: 0.75rem 1rem; color: var(--text-secondary); text-align: center; font-size: 0.85rem;">No se encontraron resultados para "${query}"</div>`;
                    dropdown.classList.remove("hidden");
                    return;
                }

                let html = "";
                if (products.length > 0) {
                    html += `<div style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); padding: 0.4rem 1rem; text-transform: uppercase;">🛒 Productos (POS)</div>`;
                    products.forEach(p => {
                        html += `
                        <div class="quick-search-item" data-action="product" data-query="${p.name}">
                            <div>
                                <div class="quick-item-title">${p.name} ${p.brand ? `<span style="color: var(--accent-blue); font-size: 0.75rem;">[${p.brand}]</span>` : ''} <span style="color: var(--text-secondary); font-size: 0.8rem;">(#${p.code || 'N/A'})</span></div>
                                <div style="font-size: 0.75rem; color: var(--text-dim);">Stock: ${p.stock} | Precio: S/ ${p.sale_price || '0.00'}</div>
                            </div>
                            <span class="quick-item-badge">Ir a Ventas</span>
                        </div>`;
                    });
                }

                if (repairs.length > 0) {
                    if (products.length > 0) html += `<hr style="border: none; border-top: 1px solid var(--glass-border); margin: 0.4rem 0;">`;
                    html += `<div style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); padding: 0.4rem 1rem; text-transform: uppercase;">🔧 Reparaciones</div>`;
                    repairs.forEach(r => {
                        html += `
                        <div class="quick-search-item" data-action="repair" data-query="${r.ticket_code}">
                            <div>
                                <div class="quick-item-title">Ticket #${r.ticket_code} — ${r.customer_name || 'Anónimo'}</div>
                                <div style="font-size: 0.75rem; color: var(--text-dim);">${r.equipment_type || 'Equipo'} ${r.brand_model ? `(${r.brand_model})` : ''} (${r.status || 'En proceso'})</div>
                            </div>
                            <span class="quick-item-badge" style="background: rgba(52, 196, 113, 0.15); color: var(--accent-green);">Ver Taller</span>
                        </div>`;
                    });
                }

                dropdown.innerHTML = html;
                dropdown.classList.remove("hidden");

                dropdown.querySelectorAll(".quick-search-item").forEach(item => {
                    item.addEventListener("click", () => {
                        const action = item.getAttribute("data-action");
                        const val = item.getAttribute("data-query");
                        dropdown.classList.add("hidden");
                        searchInput.value = "";
                        if (action === "product") {
                            navigateTo("sales").then(() => {
                                setTimeout(() => {
                                    const posSearch = document.getElementById("product-search");
                                    if (posSearch) {
                                        posSearch.value = val;
                                        posSearch.dispatchEvent(new Event("input", { bubbles: true }));
                                        posSearch.focus();
                                    }
                                }, 150);
                            });
                        } else if (action === "repair") {
                            navigateTo("repairs").then(() => {
                                setTimeout(() => {
                                    const repSearch = document.getElementById("repair-search");
                                    if (repSearch) {
                                        repSearch.value = val;
                                        repSearch.dispatchEvent(new Event("input", { bubbles: true }));
                                        repSearch.focus();
                                    }
                                }, 150);
                            });
                        }
                    });
                });
            } catch (err) {
                console.error("Error en búsqueda rápida:", err);
            }
        }, 300);
    });

    document.addEventListener("click", e => {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add("hidden");
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    initTheme();
    initAuth();
    initQuickSearch();
    initNav();
    const hasSession = await checkSession();
    if (hasSession) {
        showApp();
    } else {
        showLogin();
    }
});