import { supabase, showToast } from './supabase.js';
import { initAuth, checkSession, showApp } from './auth.js';
import { loadDashboard, chartInstances } from './dashboard.js';
import { loadSalesView, bindSalesEvents, applySalesIntent } from './sales.js';
import { loadRepairs, bindRepairEvents } from './repairs.js';
import { loadAdminView, bindAdminEvents } from './admin.js';
import { loadInventoryView } from './inventory.js';
import { animateView } from './ui.js';

// Modal close listeners
document.querySelectorAll(".close-modal-btn").forEach(btn => btn.addEventListener("click", e => e.target.closest(".modal")?.classList.add("hidden")));
document.getElementById("close-sale-modal")?.addEventListener("click", () => document.getElementById("sale-success-modal")?.classList.add("hidden"));

// Fix for mobile Safari / Chrome to allow instantaneous expansion of KPIs without browser delay
document.addEventListener("touchstart", (e) => {
    const card = e.target.closest(".kpi-card");
    if (card) card.classList.add("force-active");
}, { passive: true });

document.addEventListener("touchend", (e) => {
    const card = e.target.closest(".kpi-card");
    if (card) card.classList.remove("force-active");
}, { passive: true });

document.addEventListener("touchcancel", (e) => {
    const card = e.target.closest(".kpi-card");
    if (card) card.classList.remove("force-active");
}, { passive: true });

function initNav() {
    document.getElementById("brand-logo")?.addEventListener("click", () => {
        const sessionRaw = localStorage.getItem("supabase_session");
        let isAdmin = false;
        if (sessionRaw) {
            try {
                const sess = JSON.parse(sessionRaw);
                if (sess?.profile?.role === "admin") isAdmin = true;
            } catch (e) { }
        }
        navigateTo(isAdmin ? "dashboard" : "sales");
    });

    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", e => {
            e.preventDefault(); console.log("modeBtn clicked");
            navigateTo(item.getAttribute("data-view"));
        });
    });

    document.querySelectorAll(".mobile-nav-item").forEach(item => {
        item.addEventListener("click", e => {
            e.preventDefault(); console.log("modeBtn clicked");
            navigateTo(item.getAttribute("data-target"));
        });
    });
}

const viewCache = {};

// intent: a dónde llevar dentro de la vista (ej. { tab: 'admin-products', lowStock: true } desde un KPI)
let navSeq = 0;

export async function navigateTo(viewId, intent = null) {
    const seq = ++navSeq;
    chartInstances.forEach(c => { try { c.destroy(); } catch (e) { } });
    chartInstances.length = 0;

    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.querySelector(`.nav-item[data-view="${viewId}"]`)?.classList.add("active");

    document.querySelectorAll(".mobile-nav-item").forEach(n => n.classList.remove("active"));
    const activeMobile = document.querySelector(`.mobile-nav-item[data-target="${viewId}"]`);
    if (activeMobile) {
        activeMobile.classList.add("active");

        // Efecto Ripple del Google Bottom Bar
        const span = document.createElement('span');
        span.classList.add('ripple');
        activeMobile.appendChild(span);
        setTimeout(() => { span.remove(); }, 300);
    }

    const container = document.getElementById("view-container");
    try {
        if (!viewCache[viewId]) {
            // Se usa cache-busting con la fecha actual para evitar problemas en Safari iOS
            const res = await fetch(`./views/${viewId}.html?v=${Date.now()}`);
            if (!res.ok) throw new Error("Vista no encontrada");
            viewCache[viewId] = await res.text();
        }
        // Si mientras cargaba se pidió otra vista, esta navegación queda obsoleta
        if (seq !== navSeq) return;
        container.innerHTML = viewCache[viewId];
        animateView(container);
        window.scrollTo({ top: 0 });
        switch (viewId) {
            case "dashboard": await loadDashboard(); break;
            case "sales": await loadSalesView(); bindSalesEvents(); applySalesIntent(intent); break;
            case "repairs": await loadRepairs(intent); bindRepairEvents(); break;
            case "inventory": await loadInventoryView(intent); break;
            case "admin": await loadAdminView(intent); bindAdminEvents(); break;
        }
    } catch (e) {
        console.error(e);
        container.innerHTML = `<p class="ui-empty">Error al cargar la vista</p>`;
    }
}

window.navigateTo = navigateTo;

// Se elimina el reposicionamiento de indicador ya que ahora es un Google Bottom Bar

function initTheme() {
    const modeBtn = document.getElementById("mode-switch-btn");
    const sunIcon = document.getElementById("theme-icon-sun");
    const moonIcon = document.getElementById("theme-icon-moon");

    // El rediseño es claro (crema) por defecto; el modo oscuro es opcional.
    function applyTheme(theme) {
        if (theme !== "light" && theme !== "dark") theme = "light";
        document.body.classList.toggle("theme-dark", theme === "dark");
        document.body.classList.remove("light-mode");
        if (sunIcon) sunIcon.style.display = theme === "dark" ? "block" : "none";
        if (moonIcon) moonIcon.style.display = theme === "dark" ? "none" : "block";
        if (modeBtn) modeBtn.dataset.tip = theme === "dark" ? "Modo claro" : "Modo oscuro";
        localStorage.setItem("repairtech_theme_v2", theme);
    }

    window.applyTheme = applyTheme;
    applyTheme(localStorage.getItem("repairtech_theme_v2") || "light");

    window.toggleTheme = function () {
        const current = localStorage.getItem("repairtech_theme_v2") || "light";
        applyTheme(current === "dark" ? "light" : "dark");
    };
}

function togglePopover(id, force) {
    const pop = document.getElementById(id);
    if (!pop) return;
    const show = force !== undefined ? force : pop.classList.contains("hidden");
    document.querySelectorAll(".app-popover").forEach(p => { if (p !== pop) p.classList.add("hidden"); });
    pop.classList.toggle("hidden", !show);
    if (show && id === "search-popover") setTimeout(() => document.getElementById("global-quick-search")?.focus(), 30);
}

function isAdminSession() {
    try { return JSON.parse(localStorage.getItem("supabase_session") || "{}")?.profile?.role === "admin"; }
    catch (e) { return false; }
}

function initTopbar() {
    document.getElementById("search-toggle-btn")?.addEventListener("click", e => { e.stopPropagation(); togglePopover("search-popover"); });
    document.getElementById("user-avatar")?.addEventListener("click", e => { e.stopPropagation(); togglePopover("user-popover"); });
    document.getElementById("open-admin-login")?.addEventListener("click", () => togglePopover("user-popover", false));
    document.getElementById("alerts-btn")?.addEventListener("click", () => {
        if (isAdminSession()) navigateTo("inventory", { tab: "bajo" });
        else showToast("Las alertas de stock son solo para administradores", "error");
    });

    document.addEventListener("click", e => {
        if (!e.target.closest(".app-popover") && !e.target.closest(".app-actions")) {
            document.querySelectorAll(".app-popover").forEach(p => p.classList.add("hidden"));
        }
    });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") document.querySelectorAll(".app-popover").forEach(p => p.classList.add("hidden"));
    });

    document.querySelectorAll("[data-dock]").forEach(btn => {
        btn.addEventListener("click", async e => {
            e.stopPropagation();
            switch (btn.dataset.dock) {
                case "search": window.scrollTo({ top: 0, behavior: "smooth" }); togglePopover("search-popover", true); break;
                case "sale": await navigateTo("sales"); document.getElementById("product-search")?.focus(); break;
                case "history": navigateTo("sales", { tab: "history" }); break;
                case "repair": await navigateTo("repairs", { openNew: true }); break;
                case "inventory": navigateTo("inventory"); break;
                case "backup": navigateTo("admin", { tab: "admin-settings" }); break;
            }
        });
    });
}

// Punto rojo en la campana cuando hay productos con stock bajo
export async function refreshStockAlerts() {
    const dot = document.getElementById("alerts-dot");
    if (!dot || !isAdminSession()) { dot?.classList.add("hidden"); return; }
    try {
        const res = await fetch('/api/products');
        const list = await res.json();
        const low = (list || []).filter(p => (parseInt(p.stock) || 0) <= (parseInt(p.min_stock) || 0)).length;
        dot.classList.toggle("hidden", low === 0);
        document.getElementById("alerts-btn").title = low ? `${low} productos con stock bajo` : "Sin alertas de stock";
    } catch (e) { dot.classList.add("hidden"); }
}

function initZoom() {
    const zoomBtn = document.getElementById("zoom-switch-btn");
    const zoomIcon = document.getElementById("zoom-switch-icon");

    const zoomLevels = {
        'small': { scale: '100%', label: 'Pequeño (100%)', icon: '100%' },
        'medium': { scale: '120%', label: 'Mediano (120%)', icon: '120%' },
        'large': { scale: '150%', label: 'Grande (150%)', icon: '150%' }
    };

    function applyZoom(level) {
        if (!zoomLevels[level]) level = 'small';
        const config = zoomLevels[level];

        // Usar zoom nativo de Electron si está disponible (escala TODO perfectamente: rems, px, contenedores, etc)
        const factor = parseFloat(config.scale) / 100;
        if (window.electronAPI) {
            window.electronAPI.setZoom(factor);
            // Asegurarnos de limpiar cualquier zoom CSS residual si existía
            document.body.style.zoom = '';
        } else {
            // Fallback para navegador web normal
            document.body.style.zoom = config.scale;
        }


        if (zoomIcon) zoomIcon.textContent = config.icon;
        if (zoomBtn) zoomBtn.title = `Tamaño: ${config.label}`;
        localStorage.setItem("repairtech_ui_zoom", level);
    }

    const savedZoom = localStorage.getItem("repairtech_ui_zoom") || "small";
    applyZoom(savedZoom);

    zoomBtn?.addEventListener("click", () => {
        const current = localStorage.getItem("repairtech_ui_zoom") || "small";
        let next = 'small';
        if (current === 'small') next = 'medium';
        else if (current === 'medium') next = 'large';
        else next = 'small';

        applyZoom(next);
        showToast(`Vista cambiada a zoom: ${zoomLevels[next].label}`);
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
                // Buscar ventas directas (ticket, cliente)
                const salesDirectRes = await supabase.from("sales")
                    .select("id, ticket_code, customer_name, total_amount, created_at")
                    .or(`ticket_code.ilike.%${query}%,customer_name.ilike.%${query}%`)
                    .order('created_at', { ascending: false })
                    .limit(5);

                // Buscar ventas por producto vendido
                const itemsRes = await supabase.from("sale_items")
                    .select("sale_id, product_name")
                    .ilike('product_name', `%${query}%`)
                    .limit(20);

                let salesByItems = [];
                if (itemsRes.data && itemsRes.data.length > 0) {
                    const saleIds = [...new Set(itemsRes.data.map(i => i.sale_id))];
                    const salesByIdRes = await supabase.from("sales")
                        .select("id, ticket_code, customer_name, total_amount, created_at")
                        .in('id', saleIds)
                        .order('created_at', { ascending: false });
                    if (salesByIdRes.data) salesByItems = salesByIdRes.data;
                }

                // Buscar reparaciones
                const repairsRes = await supabase.from("repairs")
                    .select("id, ticket_code, customer_name, equipment_type, brand_model, status, created_at")
                    .or(`ticket_code.ilike.%${query}%,customer_name.ilike.%${query}%,equipment_type.ilike.%${query}%,brand_model.ilike.%${query}%`)
                    .order('created_at', { ascending: false })
                    .limit(5);

                if (salesDirectRes.error) console.error("Error en ventas directas:", salesDirectRes.error);
                if (repairsRes.error) console.error("Error en reparaciones quick search:", repairsRes.error);

                // Combinar y deduplicar ventas, luego ordenar por más recientes y tomar máximo 5
                const allSalesFound = [...(salesDirectRes.data || []), ...salesByItems];
                const uniqueSalesMap = new Map();
                allSalesFound.forEach(s => uniqueSalesMap.set(s.id, s));

                const sales = Array.from(uniqueSalesMap.values())
                    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
                    .slice(0, 5);

                const repairs = repairsRes.data || [];

                if (sales.length === 0 && repairs.length === 0) {
                    dropdown.innerHTML = `<div style="padding: 0.75rem 1rem; color: var(--text-secondary); text-align: center; font-size: 0.85rem;">No se encontraron resultados para "${query}"</div>`;
                    dropdown.classList.remove("hidden");
                    return;
                }

                let html = "";
                if (sales.length > 0) {
                    html += `<div style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); padding: 0.4rem 1rem; text-transform: uppercase;">🛒 Ventas</div>`;
                    sales.forEach(s => {
                        const dateStr = s.created_at ? new Date(s.created_at).toLocaleDateString() : '';
                        html += `
                        <div class="quick-search-item" data-action="sale" data-query="${s.ticket_code}">
                            <div>
                                <div class="quick-item-title">Ticket #${s.ticket_code} — ${s.customer_name || 'Anónimo'}</div>
                                <div style="font-size: 0.75rem; color: var(--text-dim);">Fecha: ${dateStr} | Total: S/ ${s.total_amount || '0.00'}</div>
                            </div>
                            <span class="quick-item-badge">Ver Venta</span>
                        </div>`;
                    });
                }

                if (repairs.length > 0) {
                    if (sales.length > 0) html += `<hr style="border: none; border-top: 1px solid var(--glass-border); margin: 0.4rem 0;">`;
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
                        togglePopover("search-popover", false);
                        if (action === "sale") {
                            navigateTo("sales").then(() => {
                                setTimeout(() => {
                                    const allSalesSearch = document.getElementById("all-sales-search");
                                    if (allSalesSearch) {
                                        allSalesSearch.value = val;
                                        allSalesSearch.dispatchEvent(new Event("input"));
                                    }
                                }, 300);
                            });
                        } else if (action === "repair") {
                            navigateTo("repairs").then(() => {
                                setTimeout(() => {
                                    const repSearch = document.getElementById("repair-global-search");
                                    if (repSearch) {
                                        repSearch.value = val;
                                        repSearch.dispatchEvent(new Event("input"));
                                        repSearch.focus();
                                    }
                                }, 300);
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
    // Evita inicializar dos veces si el módulo llegara a cargarse con otra URL
    if (window.__appBooted) return;
    window.__appBooted = true;
    initTheme();
    initZoom();
    initAuth();
    initQuickSearch();
    initNav();
    initTopbar();

    if (localStorage.getItem("repairtech_device_authorized") !== "true") {
        document.getElementById("device-lock-screen").classList.remove("hidden");
        document.getElementById("app-container").classList.add("hidden");
        return; // Detener la ejecución aquí hasta que se autorice
    }

    const hasSession = await checkSession();

    if (hasSession) {
        showApp();
    } else {
        // Fallback en caso de que falle el login invitado, mostramos la app igual para no bloquear
        showApp();
        console.warn("Se ha cargado la UI, pero no se pudo iniciar la sesión de invitado.");
    }
});