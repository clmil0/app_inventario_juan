// ═══════════════════════════════════════════════════════════════════════════
// InventarioPro — app.js
// ═══════════════════════════════════════════════════════════════════════════
const API = "http://192.168.18.93:8000/api";

// ─────────────────────────────────────────────────────────────────────────────
// Session management
// ─────────────────────────────────────────────────────────────────────────────
let session = null; // { username, role, token }

function getHeaders() {
    return {
        "Content-Type": "application/json",
        ...(session ? { "X-Token": session.token } : {})
    };
}

function saveSession(data) {
    session = data;
    localStorage.setItem("inventario_session", JSON.stringify(data));
}

function loadSession() {
    const raw = localStorage.getItem("inventario_session");
    if (raw) {
        try { session = JSON.parse(raw); } catch { session = null; }
    }
}

function clearSession() {
    session = null;
    localStorage.removeItem("inventario_session");
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast notifications
// ─────────────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = "success") {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

// ─────────────────────────────────────────────────────────────────────────────
// App init
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    console.log("🚀 DOMContentLoaded - verificando sesión...");
    loadSession();
    if (session) {
        console.log("✅ Sesión encontrada, mostrando app");
        showApp();
    } else {
        console.log("❌ Sin sesión, mostrando login");
        showLogin();
    }
});

function showLogin() {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app-container").classList.add("hidden");
}

function showApp() {
    console.log("🎨 Iniciando showApp()...");
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app-container").classList.remove("hidden");

    // Actualizar datos del sidebar
    document.getElementById("sidebar-username").textContent = session.username;
    document.getElementById("sidebar-role").textContent = session.role === "admin" ? "Administrador" : "Operador";
    document.getElementById("user-avatar").textContent = session.username[0].toUpperCase();

    // Mostrar/ocultar menú admin
    document.querySelectorAll(".nav-admin-only").forEach(el => {
        el.classList.toggle("hidden", session.role !== "admin");
    });

    console.log("📋 Inicializando navegación...");
    initNav();

    console.log("📊 Cargando KPIs...");
    loadKPIs();

    // Forzar vista dashboard activa (por si acaso)
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-dashboard").classList.add("active");
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.getElementById("nav-dashboard").classList.add("active");

    // Verificar que los canvas existen
    console.log("🔍 Verificando canvas...");
    console.log("  chart-sales:", !!document.getElementById("chart-sales"));
    console.log("  chart-top-products:", !!document.getElementById("chart-top-products"));
    console.log("  chart-repairs-status:", !!document.getElementById("chart-repairs-status"));

    // Esperar a que el DOM esté completamente renderizado
    console.log("⏳ Preparando carga de gráficos...");
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            console.log("✅ DOM listo, cargando gráficos");
            loadCharts();
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById("login-btn").addEventListener("click", doLogin);
document.getElementById("login-password").addEventListener("keydown", e => {
    if (e.key === "Enter") doLogin();
});

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
        saveSession(data);
        document.getElementById("login-password").value = "";
        showApp();
    } catch {
        errEl.textContent = "Usuario o contraseña incorrectos";
        errEl.classList.remove("hidden");
    }
}

document.getElementById("logout-btn").addEventListener("click", () => {
    clearSession();
    // Reset chart instances
    chartInstances.forEach(c => c.destroy());
    chartInstances.length = 0;
    showLogin();
});

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────
function initNav() {
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", e => {
            e.preventDefault();
            const viewId = item.getAttribute("data-view");
            navigateTo(viewId);
        });
    });
}

function navigateTo(viewId) {
    console.log(`🧭 Navegando a: ${viewId}`);
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.querySelector(`[data-view="${viewId}"]`)?.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById(`view-${viewId}`)?.classList.add("active");

    if (viewId === "dashboard") loadDashboard();
    if (viewId === "sales") loadSalesView();
    if (viewId === "repairs") loadRepairs();
    if (viewId === "admin") loadAdminView();
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────
const chartInstances = [];

async function loadDashboard() {
    console.log("📊 loadDashboard() llamado");
    await loadKPIs();
    await loadCharts();
}

async function loadKPIs() {
    try {
        console.log("📡 Fetching KPIs...");
        const res = await fetch(`${API}/dashboard/kpis`);
        const d = await res.json();
        console.log("✅ KPIs recibidos:", d);
        document.getElementById("kpi-ganancia").textContent = fmt(d.ganancia_total);
        document.getElementById("kpi-capital").textContent = fmt(d.capital_invertido);
        document.getElementById("kpi-cobrar").textContent = fmt(d.cuentas_por_cobrar);
        document.getElementById("kpi-ventas").textContent = fmt(d.ventas_totales);
        document.getElementById("kpi-reparaciones").textContent = fmt(d.reparaciones_totales);
        document.getElementById("kpi-hoy").textContent = fmt(d.ventas_hoy);
        document.getElementById("kpi-stock-bajo").textContent = `${d.productos_stock_bajo} producto${d.productos_stock_bajo !== 1 ? "s" : ""}`;
        document.getElementById("kpi-ticket").textContent = fmt(d.ticket_promedio);
    } catch (e) {
        console.error("❌ Error KPIs:", e);
    }
}

async function loadCharts() {
    console.log("📊 Iniciando loadCharts...");
    console.log("📊 API base:", API);

    // Destruir gráficos existentes
    chartInstances.forEach(c => {
        try { c.destroy(); } catch (e) { }
    });
    chartInstances.length = 0;

    // 1. Sales chart
    try {
        const url = `${API}/dashboard/sales-chart`;
        console.log("🌐 [1/3] Llamando a:", url);
        console.log("🌐 Iniciando fetch...");
        const res = await fetch(url);
        console.log("📡 [1/3] Respuesta recibida, status:", res.status, res.statusText);

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        console.log("📊 [1/3] Datos recibidos (length):", data.length);
        console.log("📊 [1/3] Primer elemento:", data[0]);

        const canvas = document.getElementById("chart-sales");
        if (!canvas) throw new Error("Canvas chart-sales no encontrado");

        const ctx = canvas.getContext("2d");
        console.log("📊 [1/3] Creando gráfico...");

        chartInstances.push(new Chart(ctx, {
            type: "bar",
            data: {
                labels: data.map(d => d.date),
                datasets: [{
                    label: "Ventas (S/)",
                    data: data.map(d => d.total),
                    backgroundColor: "rgba(96,165,250,0.3)",
                    borderColor: "rgba(96,165,250,0.9)",
                    borderWidth: 1.5,
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => `S/ ${ctx.parsed.y.toFixed(2)}` } }
                },
                scales: {
                    x: { ticks: { color: "#5a6480", maxTicksLimit: 10, font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.04)" } },
                    y: { ticks: { color: "#5a6480", callback: v => `S/${v}` }, grid: { color: "rgba(255,255,255,0.04)" } }
                }
            }
        }));
        console.log("✅ [1/3] sales-chart cargado exitosamente");
    } catch (e) {
        console.error("❌ [1/3] Error sales-chart:", e);
        console.error("❌ Stack:", e.stack);
    }

    // 2. Top products
    try {
        const url = `${API}/dashboard/top-products`;
        console.log("🌐 [2/3] Llamando a:", url);
        const res = await fetch(url);
        console.log("📡 [2/3] Respuesta recibida, status:", res.status);

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        console.log("📊 [2/3] Datos recibidos:", data);

        const ctx = document.getElementById("chart-top-products");
        if (!ctx) throw new Error("Canvas chart-top-products no encontrado");

        chartInstances.push(new Chart(ctx.getContext("2d"), {
            type: "doughnut",
            data: {
                labels: data.map(d => d.product),
                datasets: [{
                    data: data.map(d => d.quantity),
                    backgroundColor: ["rgba(96,165,250,0.8)", "rgba(167,139,250,0.8)", "rgba(52,211,153,0.8)", "rgba(251,191,36,0.8)", "rgba(248,113,113,0.8)"],
                    borderColor: "rgba(255,255,255,0.1)",
                    borderWidth: 1,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "right", labels: { color: "#8a95b0", font: { size: 11 }, boxWidth: 12 } },
                }
            }
        }));
        console.log("✅ [2/3] top-products cargado exitosamente");
    } catch (e) {
        console.error("❌ [2/3] Error top-products:", e);
        console.error("❌ Stack:", e.stack);
    }

    // 3. Repairs by status
    try {
        const url = `${API}/dashboard/repairs-by-status`;
        console.log("🌐 [3/3] Llamando a:", url);
        const res = await fetch(url);
        console.log("📡 [3/3] Respuesta recibida, status:", res.status);

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        console.log("📊 [3/3] Datos recibidos:", data);

        const ctx = document.getElementById("chart-repairs-status");
        if (!ctx) throw new Error("Canvas chart-repairs-status no encontrado");

        const statusColors = {
            "PENDIENTE": "rgba(251,191,36,0.7)",
            "EN_DIAGNOSTICO": "rgba(96,165,250,0.7)",
            "EN_PROCESO": "rgba(167,139,250,0.7)",
            "TERMINADO": "rgba(52,211,153,0.7)",
            "ENTREGADO": "rgba(90,100,128,0.7)",
        };

        chartInstances.push(new Chart(ctx.getContext("2d"), {
            type: "bar",
            data: {
                labels: data.map(d => d.status.replace("_", " ")),
                datasets: [{
                    label: "Reparaciones",
                    data: data.map(d => d.count),
                    backgroundColor: data.map(d => statusColors[d.status] || "rgba(255,255,255,0.3)"),
                    borderRadius: 4,
                }]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: "#5a6480", stepSize: 1 }, grid: { color: "rgba(255,255,255,0.04)" } },
                    y: { ticks: { color: "#8a95b0" }, grid: { display: false } }
                }
            }
        }));
        console.log("✅ [3/3] repairs-chart cargado exitosamente");
        console.log("🎉 ¡Todos los gráficos cargados!");
    } catch (e) {
        console.error("❌ [3/3] Error repairs-chart:", e);
        console.error("❌ Stack:", e.stack);
    }
}

function fmt(n) { return `S/ ${(n || 0).toFixed(2)}`; }

// ─────────────────────────────────────────────────────────────────────────────
// Ventas — POS
// ─────────────────────────────────────────────────────────────────────────────
let allProducts = [];
let cart = {}; // { productId: { product, quantity } }

async function loadSalesView() {
    console.log("🛒 Cargando vista de ventas...");
    await loadProductsForPOS();
    await loadRecentSales();
}

async function loadProductsForPOS() {
    try {
        const res = await fetch(`${API}/products`);
        allProducts = await res.json();
        renderProductGrid(allProducts);
    } catch (e) { console.error("Error loading products", e); }
}

function renderProductGrid(products) {
    const regularGrid = document.getElementById("products-grid");
    const favoritesGrid = document.getElementById("favorites-grid");
    if (favoritesGrid) favoritesGrid.innerHTML = "";
    if (regularGrid) regularGrid.innerHTML = "";

    const isSearching = document.getElementById("product-search").value.trim().length > 0;

    products.forEach(p => {
        const card = document.createElement("div");
        card.className = `product-card ${p.stock === 0 ? "out-of-stock" : ""}`;

        const favBtn = document.createElement("button");
        favBtn.className = `favorite-btn ${p.is_favorite ? "active" : ""}`;
        favBtn.innerHTML = p.is_favorite ? "★" : "☆";
        favBtn.onclick = async (e) => {
            e.stopPropagation();
            await toggleFavorite(p.id);
        };

        card.innerHTML = `
            <div class="product-name">${p.name}</div>
            <div class="product-brand">${p.brand} · ${p.category}</div>
            <div class="product-price">${fmt(p.sale_price)}</div>
            <div class="product-stock ${p.stock <= p.min_stock ? "low" : ""}">
                Stock: ${p.stock}${p.stock <= p.min_stock && p.stock > 0 ? " ⚠️" : ""}
                ${p.stock === 0 ? " · AGOTADO" : ""}
            </div>
        `;
        card.appendChild(favBtn);

        if (p.stock > 0) {
            card.addEventListener("click", () => addToCart(p));
        }

        if (p.is_favorite && !isSearching && favoritesGrid) {
            favoritesGrid.appendChild(card);
        } else if (regularGrid) {
            regularGrid.appendChild(card);
        }
    });

    const favSec = document.getElementById("favorites-section");
    if (favSec) favSec.style.display = isSearching ? "none" : "block";
}

async function toggleFavorite(productId) {
    try {
        const res = await fetch(`${API}/products/${productId}/toggle-favorite`, {
            method: "PUT",
            headers: getHeaders()
        });
        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Error al actualizar favorito", "error");
            return;
        }
        await loadProductsForPOS();
    } catch (e) {
        showToast("Error de conexión", "error");
    }
}

document.getElementById("product-search").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    const filtered = allProducts.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
    renderProductGrid(filtered);
});

function addToCart(product) {
    const pid = product.id;
    if (cart[pid]) {
        if (cart[pid].quantity >= product.stock) {
            showToast(`Stock máximo alcanzado (${product.stock})`, "error");
            return;
        }
        cart[pid].quantity++;
    } else {
        cart[pid] = { product, quantity: 1 };
    }
    renderCart();
}

function renderCart() {
    const container = document.getElementById("cart-items");
    const confirmBtn = document.getElementById("confirm-sale-btn");
    const totalEl = document.getElementById("cart-total-amount");

    const items = Object.values(cart);
    if (items.length === 0) {
        container.innerHTML = `<p class="cart-empty">Agrega productos al carrito</p>`;
        totalEl.textContent = "S/ 0.00";
        confirmBtn.disabled = true;
        return;
    }

    container.innerHTML = "";
    let total = 0;
    items.forEach(({ product, quantity }) => {
        const sub = product.sale_price * quantity;
        total += sub;
        const item = document.createElement("div");
        item.className = "cart-item";
        item.innerHTML = `
            <div class="cart-item-name">${product.name}</div>
            <div class="cart-item-qty">
                <button class="qty-btn" data-pid="${product.id}" data-action="dec">−</button>
                <span class="qty-num">${quantity}</span>
                <button class="qty-btn" data-pid="${product.id}" data-action="inc">+</button>
            </div>
            <div class="cart-item-sub">${fmt(sub)}</div>
        `;
        container.appendChild(item);
    });

    // Qty button handlers
    container.querySelectorAll(".qty-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const pid = parseInt(btn.dataset.pid);
            const action = btn.dataset.action;
            if (action === "inc") {
                const maxStock = cart[pid].product.stock;
                if (cart[pid].quantity < maxStock) cart[pid].quantity++;
                else showToast("Stock máximo alcanzado", "error");
            } else {
                cart[pid].quantity--;
                if (cart[pid].quantity <= 0) delete cart[pid];
            }
            renderCart();
        });
    });

    totalEl.textContent = fmt(total);
    confirmBtn.disabled = false;
}

document.getElementById("clear-cart-btn").addEventListener("click", () => {
    cart = {};
    renderCart();
});

document.getElementById("confirm-sale-btn").addEventListener("click", confirmSale);

async function confirmSale() {
    const items = Object.values(cart).map(({ product, quantity }) => ({
        product_id: product.id,
        quantity
    }));
    const customerName = document.getElementById("sale-customer").value.trim() || "Cliente Anónimo";

    try {
        const res = await fetch(`${API}/sales`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ customer_name: customerName, items })
        });
        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Error al registrar venta", "error");
            return;
        }
        const sale = await res.json();

        // Show success modal
        document.getElementById("sale-success-ticket").textContent = `Ticket: ${sale.ticket_code}`;
        document.getElementById("sale-success-total").textContent = fmt(sale.total_amount);
        document.getElementById("sale-receipt-link").href = `${API}/receipts/sale/${sale.id}/png`;
        document.getElementById("sale-success-modal").classList.remove("hidden");

        // Clear cart and reload products (stock updated)
        cart = {};
        document.getElementById("sale-customer").value = "";
        renderCart();
        await loadProductsForPOS();
        await loadRecentSales();
    } catch (e) {
        showToast("Error de conexión", "error");
    }
}

document.getElementById("close-sale-modal").addEventListener("click", () => {
    document.getElementById("sale-success-modal").classList.add("hidden");
});

let allSales = [];
async function loadRecentSales() {
    try {
        const res = await fetch(`${API}/sales`);
        allSales = await res.json();
        allSales.reverse(); // Newest first

        const container = document.getElementById("recent-sales-list");
        container.innerHTML = "";
        allSales.slice(0, 5).forEach(s => {
            const el = document.createElement("div");
            el.className = "recent-sale-item";
            el.innerHTML = `
                <span>${s.ticket_code} · ${s.customer_name}</span>
                <span class="amt">${fmt(s.total_amount)}</span>
            `;
            container.appendChild(el);
        });
        renderAllSalesTable(allSales);
    } catch (e) { }
}

function renderAllSalesTable(sales) {
    const tbody = document.getElementById("all-sales-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    sales.forEach(s => {
        const tr = document.createElement("tr");
        const dateStr = s.created_at ? new Date(s.created_at).toLocaleString('es-PE') : "-";
        tr.innerHTML = `
            <td>${s.ticket_code}</td>
            <td>${dateStr}</td>
            <td>${s.customer_name}</td>
            <td>${s.operator_name}</td>
            <td>${fmt(s.total_amount)}</td>
            <td>
                <button class="btn-outline btn-sm" onclick="showReceiptModal('${API}/receipts/sale/${s.id}/png')">Ver Boleta</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById("all-sales-search").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    const filtered = allSales.filter(s =>
        s.customer_name.toLowerCase().includes(q) ||
        s.ticket_code.toLowerCase().includes(q) ||
        s.operator_name.toLowerCase().includes(q)
    );
    renderAllSalesTable(filtered);
});

// ─────────────────────────────────────────────────────────────────────────────
// Reparaciones
// ─────────────────────────────────────────────────────────────────────────────
let allRepairs = [];
let currentRepairId = null;
let currentStatusFilter = "all";

async function loadRepairs() {
    try {
        const res = await fetch(`${API}/repairs`);
        allRepairs = await res.json();
        renderRepairs();
    } catch (e) { console.error("Error loading repairs", e); }
}

function renderRepairs() {
    const container = document.getElementById("repairs-list");
    container.innerHTML = "";

    const searchQ = (document.getElementById("repair-global-search")?.value || "").toLowerCase().trim();

    const filtered = allRepairs.filter(r => {
        const matchStatus = currentStatusFilter === "all" || r.status === currentStatusFilter;
        if (!matchStatus) return false;

        if (searchQ) {
            const searchStr = `${r.customer_name} ${r.equipment_type} ${r.brand_model} ${r.fault_description} ${r.customer_phone} ${r.ticket_code} ${r.operator_name}`.toLowerCase();
            return searchStr.includes(searchQ);
        }
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<p class="text-dim" style="text-align:center;padding:2rem">No hay reparaciones en este estado</p>`;
        return;
    }

    filtered.forEach(r => {
        const card = document.createElement("div");
        card.className = "repair-card";
        const isTerminado = r.status === "TERMINADO" || r.status === "ENTREGADO";
        card.innerHTML = `
            <div class="repair-card-header">
                <div>
                    <div class="repair-ticket">${r.ticket_code}</div>
                    <div class="repair-customer">${r.customer_name}</div>
                    <div class="repair-phone">📞 ${r.customer_phone || "—"}</div>
                </div>
                <span class="status-badge status-${r.status}">${statusLabel(r.status)}</span>
            </div>
            <div class="repair-details">
                <div class="repair-detail-item">
                    <div class="repair-detail-label">Equipo</div>
                    <div class="repair-detail-value">${r.equipment_type}</div>
                </div>
                <div class="repair-detail-item">
                    <div class="repair-detail-label">Marca / Modelo</div>
                    <div class="repair-detail-value">${r.brand_model}</div>
                </div>
                <div class="repair-detail-item">
                    <div class="repair-detail-label">Falla</div>
                    <div class="repair-detail-value">${r.fault_description}</div>
                </div>
                <div class="repair-detail-item">
                    <div class="repair-detail-label">Ingresado</div>
                    <div class="repair-detail-value">${r.created_at}</div>
                </div>
                <div class="repair-detail-item">
                    <div class="repair-detail-label">Técnico</div>
                    <div class="repair-detail-value">${r.operator_name}</div>
                </div>
            </div>
            <div class="repair-card-footer">
                <div class="repair-amounts">
                    <div class="repair-amount">
                        <div class="repair-amount-label">Total</div>
                        <div class="repair-amount-value">${fmt(r.total_amount)}</div>
                    </div>
                    <div class="repair-amount">
                        <div class="repair-amount-label">Adelanto</div>
                        <div class="repair-amount-value amount-paid">${fmt(r.advance_payment)}</div>
                    </div>
                    <div class="repair-amount">
                        <div class="repair-amount-label">Saldo</div>
                        <div class="repair-amount-value amount-pending">${fmt(r.remaining_balance)}</div>
                    </div>
                </div>
                <div class="repair-actions">
                    <button class="btn-outline btn-sm" onclick="openHistory(${r.id})">📋 Historial</button>
                    <button type="button" onclick="showReceiptModal('${API}/receipts/repair/${r.id}/png')" class="btn-outline btn-sm">🧾 Recibo</button>
                    ${r.status !== "ENTREGADO" ? `<button class="btn-primary btn-sm" onclick="openChangeStatus(${r.id}, '${r.status}', '${r.ticket_code}')">Cambiar Estado</button>` : ""}
                    ${isTerminado ? `<button type="button" onclick="showReceiptModal('${API}/receipts/repair/${r.id}/boleta-final/png')" class="btn-green btn-sm">📥 Boleta Final</button>` : ""}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function statusLabel(s) {
    const map = {
        PENDIENTE: "Pendiente",
        EN_DIAGNOSTICO: "Diagnóstico",
        EN_PROCESO: "En Proceso",
        TERMINADO: "Terminado",
        ENTREGADO: "Entregado"
    };
    return map[s] || s;
}

// Filter buttons
document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentStatusFilter = btn.dataset.status;
        renderRepairs();
    });
});

// ── Nueva Reparación ──────────────────────────────────────────────────────────
document.getElementById("new-repair-btn").addEventListener("click", () => {
    document.getElementById("new-repair-modal").classList.remove("hidden");
});
document.getElementById("cancel-repair-btn").addEventListener("click", () => {
    document.getElementById("new-repair-modal").classList.add("hidden");
    clearRepairForm();
});

document.getElementById("save-repair-btn").addEventListener("click", async () => {
    const payload = {
        customer_name: document.getElementById("repair-customer").value.trim(),
        customer_phone: document.getElementById("repair-phone").value.trim(),
        equipment_type: document.getElementById("repair-equipment").value.trim(),
        brand_model: document.getElementById("repair-brand").value.trim(),
        fault_description: document.getElementById("repair-fault").value.trim(),
        total_amount: parseFloat(document.getElementById("repair-total").value) || 0,
        advance_payment: parseFloat(document.getElementById("repair-advance").value) || 0,
    };

    if (!payload.customer_name || !payload.equipment_type || !payload.brand_model || !payload.fault_description) {
        showToast("Completa los campos obligatorios (*)", "error");
        return;
    }

    try {
        const res = await fetch(`${API}/repairs`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Error al crear reparación", "error");
            return;
        }
        const repair = await res.json();
        document.getElementById("new-repair-modal").classList.add("hidden");
        clearRepairForm();

        // Show receipt modal
        showRepairReceiptModal(repair);
        await loadRepairs();
    } catch {
        showToast("Error de conexión", "error");
    }
});

function showRepairReceiptModal(repair) {
    showReceiptModal(`${API}/receipts/repair/${repair.id}/png`);
}

document.getElementById("close-repair-receipt-modal").addEventListener("click", () => {
    document.getElementById("repair-receipt-modal").classList.add("hidden");
});

function clearRepairForm() {
    ["repair-customer", "repair-phone", "repair-equipment", "repair-brand", "repair-fault", "repair-total", "repair-advance"]
        .forEach(id => { document.getElementById(id).value = ""; });
}

// ── Cambiar estado ────────────────────────────────────────────────────────────
function openChangeStatus(repairId, currentStatus, ticketCode) {
    currentRepairId = repairId;
    document.getElementById("change-status-ticket").textContent = `Ticket: ${ticketCode} — Estado actual: ${statusLabel(currentStatus)}`;
    document.getElementById("new-status-select").value = currentStatus;
    document.getElementById("status-notes").value = "";
    document.getElementById("change-status-modal").classList.remove("hidden");
}

document.getElementById("cancel-status-btn").addEventListener("click", () => {
    document.getElementById("change-status-modal").classList.add("hidden");
});

document.getElementById("confirm-status-btn").addEventListener("click", async () => {
    const newStatus = document.getElementById("new-status-select").value;
    const notes = document.getElementById("status-notes").value.trim();

    try {
        const res = await fetch(`${API}/repairs/${currentRepairId}/status`, {
            method: "PUT",
            headers: getHeaders(),
            body: JSON.stringify({ new_status: newStatus, notes })
        });
        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Error al cambiar estado", "error");
            return;
        }
        document.getElementById("change-status-modal").classList.add("hidden");
        showToast(`Estado actualizado a ${statusLabel(newStatus)}`);
        await loadRepairs();
    } catch {
        showToast("Error de conexión", "error");
    }
});

// ── Historial de estados ──────────────────────────────────────────────────────
function openHistory(repairId) {
    const repair = allRepairs.find(r => r.id === repairId);
    if (!repair) return;

    document.getElementById("history-modal-ticket").textContent = `${repair.ticket_code} — ${repair.customer_name} — ${repair.equipment_type}`;
    const timeline = document.getElementById("history-timeline");
    timeline.innerHTML = "";

    if (!repair.status_history || repair.status_history.length === 0) {
        timeline.innerHTML = `<p class="text-dim">Sin historial registrado</p>`;
    } else {
        repair.status_history.forEach(h => {
            const item = document.createElement("div");
            item.className = "timeline-item";
            item.innerHTML = `
                <div class="timeline-dot"></div>
                <div class="timeline-body">
                    <div class="timeline-status">
                        ${h.previous_status ? `<span class="text-dim">${statusLabel(h.previous_status)} →</span> ` : ""}
                        <span class="status-badge status-${h.new_status}">${statusLabel(h.new_status)}</span>
                    </div>
                    <div class="timeline-meta">📅 ${h.changed_at} &nbsp;·&nbsp; 👤 ${h.changed_by}</div>
                    ${h.notes ? `<div class="timeline-notes">💬 ${h.notes}</div>` : ""}
                </div>
            `;
            timeline.appendChild(item);
        });
    }

    document.getElementById("history-modal").classList.remove("hidden");
}

document.getElementById("close-history-modal").addEventListener("click", () => {
    document.getElementById("history-modal").classList.add("hidden");
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMINISTRADOR
// ─────────────────────────────────────────────────────────────────────────────
async function loadAdminView() {
    await loadAdminProducts();
    await loadStockAudit();
    initAdminTabs();
}

function initAdminTabs() {
    document.querySelectorAll(".admin-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".admin-tab-content").forEach(c => c.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById(tab.dataset.tab).classList.add("active");
        });
    });
}

async function loadAdminProducts() {
    try {
        const res = await fetch(`${API}/products`);
        const products = await res.json();
        const tbody = document.getElementById("admin-products-tbody");
        tbody.innerHTML = "";
        products.forEach(p => {
            const tr = document.createElement("tr");
            const stockColor = p.stock <= p.min_stock ? "color:var(--accent-yellow);font-weight:700" : "";
            tr.innerHTML = `
                <td><strong>${p.name}</strong></td>
                <td>${p.brand}</td>
                <td>S/ ${p.cost_price.toFixed(2)}</td>
                <td>S/ ${p.sale_price.toFixed(2)}</td>
                <td style="${stockColor}">${p.stock}${p.stock <= p.min_stock ? " ⚠️" : ""}</td>
                <td>${p.min_stock}</td>
                <td style="white-space:nowrap">
                    <button class="btn-green btn-sm" onclick="openAddStock(${p.id}, '${escHtml(p.name)}')">+Stock</button>
                    <button class="btn-outline btn-sm" style="margin:0 4px" onclick="openEditPrice(${p.id}, '${escHtml(p.name)}', ${p.cost_price}, ${p.sale_price})">Precio</button>
                    <button class="btn-outline btn-sm" onclick="openPriceHistory(${p.id}, '${escHtml(p.name)}')">Historial</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) { console.error("Admin products error", e); }
}

function escHtml(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

async function loadStockAudit() {
    try {
        const res = await fetch(`${API}/admin/stock/audit`, { headers: getHeaders() });
        if (!res.ok) return;
        const audits = await res.json();
        const tbody = document.getElementById("audit-tbody");
        tbody.innerHTML = "";
        audits.forEach(a => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${a.created_at}</td>
                <td>${a.product_name}</td>
                <td style="color:var(--accent-green);font-weight:700">+${a.quantity_added}</td>
                <td>${a.previous_stock}</td>
                <td style="font-weight:700">${a.new_stock}</td>
                <td>${a.operator_name}</td>
                <td class="text-dim">${a.notes || "—"}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) { }
}

// ── Modal: Agregar Stock ───────────────────────────────────────────────────────
function openAddStock(productId, productName) {
    document.getElementById("add-stock-product-id").value = productId;
    document.getElementById("add-stock-product-name").textContent = productName;
    document.getElementById("add-stock-qty").value = "";
    document.getElementById("add-stock-notes").value = "";
    document.getElementById("add-stock-modal").classList.remove("hidden");
}

document.getElementById("cancel-stock-btn").addEventListener("click", () => {
    document.getElementById("add-stock-modal").classList.add("hidden");
});

document.getElementById("confirm-stock-btn").addEventListener("click", async () => {
    const productId = parseInt(document.getElementById("add-stock-product-id").value);
    const qty = parseInt(document.getElementById("add-stock-qty").value);
    const notes = document.getElementById("add-stock-notes").value.trim();

    if (!qty || qty <= 0) {
        showToast("Ingresa una cantidad válida", "error");
        return;
    }

    try {
        const res = await fetch(`${API}/admin/stock/add`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ product_id: productId, quantity: qty, notes })
        });
        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Error al agregar stock", "error");
            return;
        }
        const data = await res.json();
        document.getElementById("add-stock-modal").classList.add("hidden");
        showToast(`Stock actualizado. Nuevo stock: ${data.new_stock}`);
        await loadAdminProducts();
        await loadStockAudit();
    } catch {
        showToast("Error de conexión", "error");
    }
});

// ── Modal: Editar Precio ────────────────────────────────────────────────────
function openEditPrice(productId, productName, costPrice, salePrice) {
    document.getElementById("edit-price-product-id").value = productId;
    document.getElementById("edit-price-product-name").textContent = productName;
    document.getElementById("edit-cost-price").value = costPrice;
    document.getElementById("edit-sale-price").value = salePrice;
    document.getElementById("edit-price-notes").value = "";
    document.getElementById("edit-price-modal").classList.remove("hidden");
}

document.getElementById("cancel-price-btn").addEventListener("click", () => {
    document.getElementById("edit-price-modal").classList.add("hidden");
});

document.getElementById("confirm-price-btn").addEventListener("click", async () => {
    const productId = parseInt(document.getElementById("edit-price-product-id").value);
    const newCost = parseFloat(document.getElementById("edit-cost-price").value);
    const newSale = parseFloat(document.getElementById("edit-sale-price").value);
    const notes = document.getElementById("edit-price-notes").value.trim();

    if (isNaN(newCost) || isNaN(newSale) || newCost <= 0 || newSale <= 0) {
        showToast("Ingresa precios válidos", "error");
        return;
    }

    try {
        const res = await fetch(`${API}/admin/products/${productId}/price`, {
            method: "PUT",
            headers: getHeaders(),
            body: JSON.stringify({ new_cost_price: newCost, new_sale_price: newSale, notes })
        });
        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Error al actualizar precio", "error");
            return;
        }
        document.getElementById("edit-price-modal").classList.add("hidden");
        showToast("Precios actualizados y guardados en historial");
        await loadAdminProducts();
    } catch {
        showToast("Error de conexión", "error");
    }
});

// ── Modal: Historial de precios ─────────────────────────────────────────────
async function openPriceHistory(productId, productName) {
    document.getElementById("price-history-product-name").textContent = productName;
    const content = document.getElementById("price-history-content");
    content.innerHTML = "<p class='text-dim'>Cargando...</p>";
    document.getElementById("price-history-modal").classList.remove("hidden");

    try {
        const res = await fetch(`${API}/admin/products/${productId}/price-history`, { headers: getHeaders() });
        const records = await res.json();
        if (records.length === 0) {
            content.innerHTML = `<p class="text-dim" style="text-align:center;padding:1rem">Sin cambios de precio registrados</p>`;
            return;
        }
        content.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Costo anterior</th>
                        <th>Costo nuevo</th>
                        <th>Precio anterior</th>
                        <th>Precio nuevo</th>
                        <th>Por</th>
                        <th>Notas</th>
                    </tr>
                </thead>
                <tbody>
                    ${records.map(r => `
                        <tr>
                            <td>${r.changed_at}</td>
                            <td>S/ ${r.old_cost_price.toFixed(2)}</td>
                            <td style="color:var(--accent-green)">S/ ${r.new_cost_price.toFixed(2)}</td>
                            <td>S/ ${r.old_sale_price.toFixed(2)}</td>
                            <td style="color:var(--accent-green)">S/ ${r.new_sale_price.toFixed(2)}</td>
                            <td>${r.changed_by}</td>
                            <td class="text-dim">${r.notes || "—"}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch {
        content.innerHTML = `<p style="color:var(--accent-red)">Error al cargar historial</p>`;
    }
}

document.getElementById("close-price-history-modal").addEventListener("click", () => {
    document.getElementById("price-history-modal").classList.add("hidden");
});

// ── Cambiar contraseña ──────────────────────────────────────────────────────
document.getElementById("change-password-btn").addEventListener("click", async () => {
    const newPwd = document.getElementById("new-password").value;
    const confirmPwd = document.getElementById("confirm-password").value;
    const fb = document.getElementById("pwd-feedback");

    fb.className = "feedback-msg";
    fb.classList.remove("hidden");

    if (!newPwd || newPwd.length < 4) {
        fb.textContent = "La contraseña debe tener al menos 4 caracteres";
        fb.classList.add("error");
        return;
    }
    if (newPwd !== confirmPwd) {
        fb.textContent = "Las contraseñas no coinciden";
        fb.classList.add("error");
        return;
    }

    try {
        const res = await fetch(`${API}/admin/change-password`, {
            method: "PUT",
            headers: getHeaders(),
            body: JSON.stringify({ new_password: newPwd })
        });
        if (!res.ok) {
            fb.textContent = "Error al cambiar la contraseña";
            fb.classList.add("error");
            return;
        }
        fb.textContent = "✅ Contraseña actualizada correctamente";
        fb.classList.add("success");
        document.getElementById("new-password").value = "";
        document.getElementById("confirm-password").value = "";
        // Update token in session (token contains username|role, no password, so it stays valid)
    } catch {
        fb.textContent = "Error de conexión";
        fb.classList.add("error");
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Close modals on backdrop click
// ─────────────────────────────────────────────────────────────────────────────
document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", e => {
        if (e.target === modal) modal.classList.add("hidden");
    });
});

// Make admin functions available globally (called from inline onclick)
window.openAddStock = openAddStock;
window.openEditPrice = openEditPrice;
window.openPriceHistory = openPriceHistory;
window.openChangeStatus = openChangeStatus;
window.openHistory = openHistory;

// ─────────────────────────────────────────────────────────────────────────────
// Receipt Modal & Repairs Search
// ─────────────────────────────────────────────────────────────────────────────
function showReceiptModal(imgUrl) {
    document.getElementById("receipt-image").src = imgUrl;
    document.getElementById("download-receipt-btn").href = imgUrl;
    document.getElementById("receipt-modal").classList.remove("hidden");
}

document.querySelectorAll(".close-modal-btn").forEach(btn => {
    btn.addEventListener("click", e => {
        e.target.closest(".modal")?.classList.add("hidden");
    });
});

document.getElementById("repair-global-search")?.addEventListener("input", () => {
    renderRepairs();
});

window.showReceiptModal = showReceiptModal;
