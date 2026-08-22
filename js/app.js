import { supabase, showToast } from './supabase.js';
import { initAuth, checkSession, showApp } from './auth.js';
import { loadDashboard, chartInstances } from './dashboard.js';
import { loadSalesView, bindSalesEvents } from './sales.js';
import { loadRepairs, bindRepairEvents } from './repairs.js';
import { loadAdminView, bindAdminEvents } from './admin.js';

// Modal close listeners
document.querySelectorAll(".close-modal-btn").forEach(btn => btn.addEventListener("click", e => e.target.closest(".modal")?.classList.add("hidden")));
document.getElementById("close-sale-modal")?.addEventListener("click", () => document.getElementById("sale-success-modal")?.classList.add("hidden"));

// Fix for mobile Safari / Chrome to allow instantaneous expansion of KPIs without browser delay
document.addEventListener("touchstart", (e) => {
    const card = e.target.closest(".kpi-card");
    if (card) card.classList.add("force-active");
}, {passive: true});

document.addEventListener("touchend", (e) => {
    const card = e.target.closest(".kpi-card");
    if (card) card.classList.remove("force-active");
}, {passive: true});

document.addEventListener("touchcancel", (e) => {
    const card = e.target.closest(".kpi-card");
    if (card) card.classList.remove("force-active");
}, {passive: true});

function initNav() {
    document.getElementById("brand-logo")?.addEventListener("click", () => {
        navigateTo("dashboard");
    });

    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", e => {
            e.preventDefault();
            navigateTo(item.getAttribute("data-view"));
        });
    });

    document.querySelectorAll(".mobile-nav-item").forEach(item => {
        item.addEventListener("click", e => {
            e.preventDefault();
            navigateTo(item.getAttribute("data-target"));
        });
    });
}

const viewCache = {};

export async function navigateTo(viewId) {
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

// Se elimina el reposicionamiento de indicador ya que ahora es un Google Bottom Bar

function initTheme() {
    const modeBtn = document.getElementById("mode-switch-btn");
    const themeDropdown = document.getElementById("theme-dropdown");
    const sunIcon = document.getElementById("theme-icon-sun");
    const warmIcon = document.getElementById("theme-icon-warm");
    const moonIcon = document.getElementById("theme-icon-moon");
    const emeraldIcon = document.getElementById("theme-icon-emerald");

    function applyTheme(theme) {
        if (theme === "light") theme = "light-cool";
        if (theme !== "light-cool" && theme !== "light-warm" && theme !== "dark" && theme !== "dark-emerald") {
            theme = "dark";
        }

        document.body.classList.remove("light-mode", "light-warm", "light-cool", "dark-emerald");

        if (theme === "dark-emerald") {
            document.body.classList.add("dark-emerald");
            if (sunIcon) sunIcon.style.display = "none";
            if (warmIcon) warmIcon.style.display = "none";
            if (moonIcon) moonIcon.style.display = "none";
            if (emeraldIcon) emeraldIcon.style.display = "block";
            if (modeBtn) modeBtn.title = "Tema Actual: Oscuro (Esmeralda)";
        } else if (theme === "light-cool") {
            document.body.classList.add("light-mode", "light-cool");
            if (sunIcon) sunIcon.style.display = "none";
            if (warmIcon) warmIcon.style.display = "block";
            if (moonIcon) moonIcon.style.display = "none";
            if (emeraldIcon) emeraldIcon.style.display = "none";
            if (modeBtn) modeBtn.title = "Tema Actual: Claro (Azul Frío)";
        } else if (theme === "light-warm") {
            document.body.classList.add("light-mode", "light-warm");
            if (sunIcon) sunIcon.style.display = "none";
            if (warmIcon) warmIcon.style.display = "none";
            if (moonIcon) moonIcon.style.display = "block";
            if (emeraldIcon) emeraldIcon.style.display = "none";
            if (modeBtn) modeBtn.title = "Tema Actual: Claro (Cálido Industrial)";
        } else {
            // Dark mode
            if (sunIcon) sunIcon.style.display = "block";
            if (warmIcon) warmIcon.style.display = "none";
            if (moonIcon) moonIcon.style.display = "none";
            if (emeraldIcon) emeraldIcon.style.display = "none";
            if (modeBtn) modeBtn.title = "Tema Actual: Oscuro (Slate)";
        }
        localStorage.setItem("repairtech_theme", theme);
        
        // Marcar activo en el dropdown
        document.querySelectorAll(".theme-option").forEach(opt => {
            opt.classList.toggle("active", opt.dataset.theme === theme);
        });
    }

    const savedTheme = localStorage.getItem("repairtech_theme") || "dark";
    applyTheme(savedTheme);

    modeBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        themeDropdown.classList.toggle("hidden");
    });

    document.querySelectorAll(".theme-option").forEach(opt => {
        opt.addEventListener("click", (e) => {
            e.stopPropagation();
            const theme = opt.dataset.theme;
            applyTheme(theme);
            themeDropdown.classList.add("hidden");
        });
    });

    document.addEventListener("click", (e) => {
        if (!modeBtn?.contains(e.target) && !themeDropdown?.contains(e.target)) {
            themeDropdown?.classList.add("hidden");
        }
    });
}

function initZoom() {
    const zoomBtn = document.getElementById("zoom-switch-btn");
    const zoomIcon = document.getElementById("zoom-switch-icon");

    const zoomLevels = {
        'small': { scale: '100%', label: 'Pequeño (100%)', icon: '🔍' },
        'medium': { scale: '110%', label: 'Mediano (110%)', icon: '🔎' },
        'large': { scale: '120%', label: 'Grande (120%)', icon: '🖥️' }
    };

    function applyZoom(level) {
        if (!zoomLevels[level]) level = 'small';
        const config = zoomLevels[level];
        
        // Aplicar zoom de navegador sin romper proporciones
        document.body.style.zoom = config.scale;
        
        // Ajustar altura para evitar que se corte el final al usar zoom > 100%
        const scaleValue = parseFloat(config.scale) / 100;
        if (scaleValue !== 1) {
            document.documentElement.style.height = `calc(100vh / ${scaleValue})`;
            document.body.style.height = `calc(100vh / ${scaleValue})`;
        } else {
            document.documentElement.style.height = '100vh';
            document.body.style.height = '100vh';
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
    initTheme();
    initZoom();
    initAuth();
    initQuickSearch();
    initNav();
    
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