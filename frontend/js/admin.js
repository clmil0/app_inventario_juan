import { API, getHeaders, fmt, showToast } from './utils.js';

// Estado para filtros de productos en admin
let adminAllProducts = [];
let adminFilteredProducts = [];
let adminSearchQuery = '';
let adminFilterCategoryId = '';

export async function loadAdminView() {
    await loadAdminProducts();
    await loadStockAudit();
    await loadCategories();
    await loadConfigLists();
    initAdminTabs();
}

export function bindAdminEvents() {
    // Nuevo producto
    document.getElementById("new-product-btn")?.addEventListener("click", openNewProductModal);
    document.getElementById("cancel-new-product-btn")?.addEventListener("click", () => document.getElementById("new-product-modal").classList.add("hidden"));
    document.getElementById("save-new-product-btn")?.addEventListener("click", saveNewProduct);
    // Categorías
    document.getElementById("add-category-btn")?.addEventListener("click", addCategory);
    // Config desplegables
    document.getElementById("add-equipment-btn")?.addEventListener("click", addEquipment);
    document.getElementById("add-brand-btn")?.addEventListener("click", addBrand);
    // Modales
    document.getElementById("cancel-stock-btn")?.addEventListener("click", () => document.getElementById("add-stock-modal").classList.add("hidden"));
    document.getElementById("confirm-stock-btn")?.addEventListener("click", confirmAddStock);
    document.getElementById("cancel-price-btn")?.addEventListener("click", () => document.getElementById("edit-price-modal").classList.add("hidden"));
    document.getElementById("confirm-price-btn")?.addEventListener("click", confirmEditPrice);
    document.getElementById("cancel-category-btn")?.addEventListener("click", () => document.getElementById("edit-category-modal").classList.add("hidden"));
    document.getElementById("confirm-category-btn")?.addEventListener("click", confirmEditCategory);
    document.getElementById("close-price-history-modal")?.addEventListener("click", () => document.getElementById("price-history-modal").classList.add("hidden"));
    document.getElementById("change-password-btn")?.addEventListener("click", changePassword);

    const adminSearch = document.getElementById("admin-product-search");
    const adminCatFilter = document.getElementById("admin-category-filter");

    if (adminSearch) {
        adminSearch.addEventListener("input", (e) => {
            adminSearchQuery = e.target.value.toLowerCase().trim();
            filterAdminProducts();
        });
    }

    if (adminCatFilter) {
        adminCatFilter.addEventListener("change", (e) => {
            adminFilterCategoryId = e.target.value;
            filterAdminProducts();
        });
    }
}

// ─── Admin Tabs ─────────────────────────────
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

// ─── Productos ──────────────────────────────
async function loadAdminProducts() {
    try {
        const res = await fetch(`${API}/products`);
        adminAllProducts = await res.json();
        adminFilteredProducts = [...adminAllProducts];
        renderAdminProductsTable(adminFilteredProducts);
        populateAdminCategoryFilter();
    } catch (e) { console.error(e); }
}

function populateAdminCategoryFilter() {
    const select = document.getElementById("admin-category-filter");
    if (!select) return;

    // Obtener categorías únicas de los productos
    const categoriesMap = new Map();
    adminAllProducts.forEach(p => {
        if (p.category_id && p.category_name) {
            categoriesMap.set(p.category_id, p.category_name);
        }
    });

    select.innerHTML = '<option value="">Todas las categorías</option>';
    categoriesMap.forEach((name, id) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        select.appendChild(opt);
    });
}

function filterAdminProducts() {
    adminFilteredProducts = adminAllProducts.filter(p => {
        // Filtro por búsqueda
        const matchSearch = !adminSearchQuery ||
            p.name.toLowerCase().includes(adminSearchQuery) ||
            p.brand.toLowerCase().includes(adminSearchQuery) ||
            p.code.toLowerCase().includes(adminSearchQuery) ||
            (p.category_name && p.category_name.toLowerCase().includes(adminSearchQuery));

        // Filtro por categoría
        const matchCategory = !adminFilterCategoryId || p.category_id === parseInt(adminFilterCategoryId);

        return matchSearch && matchCategory;
    });

    renderAdminProductsTable(adminFilteredProducts);
}

function renderAdminProductsTable(products) {
    const tbody = document.getElementById("admin-products-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-dim);">No se encontraron productos</td></tr>';
        return;
    }

    products.forEach(p => {
        const tr = document.createElement("tr");
        const stockColor = p.stock <= p.min_stock ? "color:var(--accent-yellow);font-weight:700" : "";
        tr.innerHTML = `
            <td><strong>${p.name}</strong><br><small style="color:var(--text-dim)">${p.code}</small></td>
            <td>${p.brand || '—'}</td>
            <td>${p.category_name || 'Sin categoría'}</td>
            <td>S/ ${p.cost_price.toFixed(2)}</td>
            <td>S/ ${p.sale_price.toFixed(2)}</td>
            <td style="${stockColor}">${p.stock}${p.stock <= p.min_stock ? " ⚠️" : ""}</td>
            <td>${p.min_stock}</td>
            <td style="white-space:nowrap">
                <button class="btn-green btn-sm" onclick="openAddStock(${p.id}, '${escHtml(p.name)}')">+Stock</button>
                <button class="btn-outline btn-sm" style="margin:0 4px" onclick="openEditPrice(${p.id}, '${escHtml(p.name)}', ${p.cost_price}, ${p.sale_price})">Precio</button>
                <button class="btn-outline btn-sm" onclick="openPriceHistory(${p.id}, '${escHtml(p.name)}')">Historial</button>
                <button class="btn-outline btn-sm" onclick="openEditCategory(${p.id}, '${escHtml(p.name)}', ${p.category_id})">Categoría</button>
            </td>`;
        tbody.appendChild(tr);
    });
}

function escHtml(str) { return str.replace(/'/g, "\\'").replace(/"/g, "&quot;"); }

// ─── Stock ──────────────────────────────────
function openAddStock(productId, productName) {
    document.getElementById("add-stock-product-id").value = productId;
    document.getElementById("add-stock-product-name").textContent = productName;
    document.getElementById("add-stock-qty").value = "";
    document.getElementById("add-stock-notes").value = "";
    document.getElementById("add-stock-modal").classList.remove("hidden");
}

async function confirmAddStock() {
    const productId = parseInt(document.getElementById("add-stock-product-id").value);
    const qty = parseInt(document.getElementById("add-stock-qty").value);
    const notes = document.getElementById("add-stock-notes").value.trim();
    if (!qty || qty <= 0) { showToast("Ingresa una cantidad válida", "error"); return; }
    try {
        const res = await fetch(`${API}/admin/stock/add`, { method: "POST", headers: getHeaders(), body: JSON.stringify({ product_id: productId, quantity: qty, notes }) });
        if (!res.ok) { const err = await res.json(); showToast(err.detail || "Error", "error"); return; }
        const data = await res.json();
        document.getElementById("add-stock-modal").classList.add("hidden");
        showToast(`Stock actualizado. Nuevo stock: ${data.new_stock}`);
        await loadAdminProducts(); await loadStockAudit(); await loadProductsForPOS();
    } catch { showToast("Error de conexión", "error"); }
}

async function loadStockAudit() {
    try {
        const res = await fetch(`${API}/admin/stock/audit`, { headers: getHeaders() });
        if (!res.ok) return;
        const audits = await res.json();
        const tbody = document.getElementById("audit-tbody"); tbody.innerHTML = "";
        audits.forEach(a => {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>${a.created_at}</td><td>${a.product_name}</td><td style="color:var(--accent-green);font-weight:700">+${a.quantity_added}</td><td>${a.previous_stock}</td><td style="font-weight:700">${a.new_stock}</td><td>${a.operator_name}</td><td class="text-dim">${a.notes || "—"}</td>`;
            tbody.appendChild(tr);
        });
    } catch (e) { }
}

// ─── Precios ────────────────────────────────
function openEditPrice(productId, productName, costPrice, salePrice) {
    document.getElementById("edit-price-product-id").value = productId;
    document.getElementById("edit-price-product-name").textContent = productName;
    document.getElementById("edit-cost-price").value = costPrice;
    document.getElementById("edit-sale-price").value = salePrice;
    document.getElementById("edit-price-notes").value = "";
    document.getElementById("edit-price-modal").classList.remove("hidden");
}

async function confirmEditPrice() {
    const productId = parseInt(document.getElementById("edit-price-product-id").value);
    const newCost = parseFloat(document.getElementById("edit-cost-price").value);
    const newSale = parseFloat(document.getElementById("edit-sale-price").value);
    const notes = document.getElementById("edit-price-notes").value.trim();
    if (isNaN(newCost) || isNaN(newSale) || newCost <= 0 || newSale <= 0) { showToast("Ingresa precios válidos", "error"); return; }
    try {
        const res = await fetch(`${API}/admin/products/${productId}/price`, { method: "PUT", headers: getHeaders(), body: JSON.stringify({ new_cost_price: newCost, new_sale_price: newSale, notes }) });
        if (!res.ok) { const err = await res.json(); showToast(err.detail || "Error", "error"); return; }
        document.getElementById("edit-price-modal").classList.add("hidden");
        showToast("Precios actualizados y guardados en historial");
        await loadAdminProducts(); await loadProductsForPOS();
    } catch { showToast("Error de conexión", "error"); }
}

async function openPriceHistory(productId, productName) {
    document.getElementById("price-history-product-name").textContent = productName;
    const content = document.getElementById("price-history-content");
    content.innerHTML = "<p class='text-dim'>Cargando...</p>";
    document.getElementById("price-history-modal").classList.remove("hidden");
    try {
        const res = await fetch(`${API}/admin/products/${productId}/price-history`, { headers: getHeaders() });
        const records = await res.json();
        if (records.length === 0) { content.innerHTML = `<p class="text-dim" style="text-align:center;padding:1rem">Sin cambios de precio registrados</p>`; return; }
        content.innerHTML = `<table><thead><tr><th>Fecha</th><th>Costo anterior</th><th>Costo nuevo</th><th>Precio anterior</th><th>Precio nuevo</th><th>Por</th><th>Notas</th></tr></thead><tbody>${records.map(r => `<tr><td>${r.changed_at}</td><td>S/ ${r.old_cost_price.toFixed(2)}</td><td style="color:var(--accent-green)">S/ ${r.new_cost_price.toFixed(2)}</td><td>S/ ${r.old_sale_price.toFixed(2)}</td><td style="color:var(--accent-green)">S/ ${r.new_sale_price.toFixed(2)}</td><td>${r.changed_by}</td><td class="text-dim">${r.notes || "—"}</td></tr>`).join("")}</tbody></table>`;
    } catch { content.innerHTML = `<p style="color:var(--accent-red)">Error al cargar historial</p>`; }
}

// ─── Categorías ─────────────────────────────
async function loadCategories() {
    try {
        const res = await fetch(`${API}/categories`, { headers: getHeaders() });
        const categories = await res.json();
        const tbody = document.getElementById("categories-tbody"); tbody.innerHTML = "";
        categories.forEach(cat => {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>${cat.id}</td><td>${cat.name}</td><td>${cat.products ? cat.products.length : 0}</td><td>${cat.id !== 1 ? `<button class="btn-outline btn-sm" onclick="editCategory(${cat.id}, '${escHtml(cat.name)}')">Editar</button><button class="btn-danger btn-sm" onclick="deleteCategory(${cat.id})">Eliminar</button>` : '—'}</td>`;
            tbody.appendChild(tr);
        });
    } catch (e) { }
}

async function addCategory() {
    const name = document.getElementById("new-category-name").value.trim();
    if (!name) return showToast("Ingresa un nombre", "error");
    try {
        const res = await fetch(`${API}/admin/categories`, { method: "POST", headers: getHeaders(), body: JSON.stringify({ name }) });
        if (!res.ok) { const err = await res.json(); showToast(err.detail || "Error", "error"); return; }
        document.getElementById("new-category-name").value = "";
        showToast("Categoría creada");
        await loadCategories();
        const { loadCategoriesForSales } = await import('./sales.js');
        await loadCategoriesForSales();
    } catch (e) { showToast("Error de conexión", "error"); }
}

function editCategory(id, currentName) {
    const newName = prompt("Nuevo nombre:", currentName);
    if (!newName || newName === currentName) return;
    fetch(`${API}/admin/categories/${id}`, { method: "PUT", headers: getHeaders(), body: JSON.stringify({ name: newName }) })
        .then(res => res.json())
        .then(async () => { showToast("Categoría actualizada"); await loadCategories(); const { loadCategoriesForSales } = await import('./sales.js'); await loadCategoriesForSales(); })
        .catch(() => showToast("Error", "error"));
}

function deleteCategory(id) {
    if (!confirm("¿Eliminar categoría? Se perderá la asignación a productos.")) return;
    fetch(`${API}/admin/categories/${id}`, { method: "DELETE", headers: getHeaders() })
        .then(res => { if (!res.ok) return res.json().then(err => { throw new Error(err.detail || "Error"); }); showToast("Categoría eliminada"); loadCategories(); import('./sales.js').then(m => m.loadCategoriesForSales()); })
        .catch(err => showToast(err.message, "error"));
}

function openEditCategory(productId, productName, currentCategoryId) {
    fetch(`${API}/categories`).then(res => res.json()).then(categories => {
        const select = document.getElementById("edit-category-select"); select.innerHTML = '';
        categories.forEach(cat => { const opt = document.createElement('option'); opt.value = cat.id; opt.text = cat.name; if (cat.id === currentCategoryId) opt.selected = true; select.appendChild(opt); });
        document.getElementById("edit-category-product-id").value = productId;
        document.getElementById("edit-category-product-name").textContent = productName;
        document.getElementById("edit-category-modal").classList.remove("hidden");
    });
}

async function confirmEditCategory() {
    const productId = parseInt(document.getElementById("edit-category-product-id").value);
    const newCategoryId = parseInt(document.getElementById("edit-category-select").value);
    try {
        const res = await fetch(`${API}/admin/products/${productId}/category`, { method: "PUT", headers: getHeaders(), body: JSON.stringify({ category_id: newCategoryId }) });
        if (!res.ok) throw new Error();
        showToast("Categoría actualizada");
        document.getElementById("edit-category-modal").classList.add("hidden");
        await loadAdminProducts();
        const { loadProductsForPOS } = await import('./sales.js');
        await loadProductsForPOS();
    } catch { showToast("Error al actualizar", "error"); }
}

// ─── Config Desplegables ────────────────────
async function loadConfigLists() {
    try {
        const [eqRes, brRes] = await Promise.all([fetch(`${API}/admin/equipment-types`, { headers: getHeaders() }), fetch(`${API}/admin/brand-models`, { headers: getHeaders() })]);
        if (eqRes.ok) renderConfigList("equipment-config-list", await eqRes.json(), 'equipment');
        if (brRes.ok) renderConfigList("brand-config-list", await brRes.json(), 'brand');
    } catch (e) { }
}

function renderConfigList(containerId, items, type) {
    const container = document.getElementById(containerId); if (!container) return;
    container.innerHTML = '';
    items.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;justify-content:space-between;padding:0.3rem 0;border-bottom:1px solid var(--glass-border)';
        div.innerHTML = `<span>${item.name}</span><button class="btn-danger btn-sm" onclick="deleteConfigItem('${type}', ${item.id})">Eliminar</button>`;
        container.appendChild(div);
    });
}

async function addEquipment() {
    const input = document.getElementById("new-equipment-input");
    const name = input.value.trim();
    if (!name) return showToast("Ingresa un nombre", "error");
    try {
        const res = await fetch(`${API}/admin/equipment-types`, { method: "POST", headers: getHeaders(), body: JSON.stringify({ name }) });
        if (!res.ok) { const err = await res.json(); showToast(err.detail || "Error", "error"); return; }
        input.value = ""; showToast("Tipo de equipo agregado");
        await loadConfigLists();
        const { loadListsForRepairs } = await import('./repairs.js');
        await loadListsForRepairs();
    } catch (e) { showToast("Error de conexión", "error"); }
}

async function addBrand() {
    const input = document.getElementById("new-brand-input");
    const name = input.value.trim();
    if (!name) return showToast("Ingresa un nombre", "error");
    try {
        const res = await fetch(`${API}/admin/brand-models`, { method: "POST", headers: getHeaders(), body: JSON.stringify({ name }) });
        if (!res.ok) { const err = await res.json(); showToast(err.detail || "Error", "error"); return; }
        input.value = ""; showToast("Marca/Modelo agregado");
        await loadConfigLists();
        const { loadListsForRepairs } = await import('./repairs.js');
        await loadListsForRepairs();
    } catch (e) { showToast("Error de conexión", "error"); }
}

function deleteConfigItem(type, id) {
    if (!confirm("¿Eliminar?")) return;
    const endpoint = type === 'equipment' ? 'equipment-types' : 'brand-models';
    fetch(`${API}/admin/${endpoint}/${id}`, { method: "DELETE", headers: getHeaders() })
        .then(res => { if (!res.ok) return res.json().then(err => { throw new Error(err.detail || "Error"); }); showToast("Elemento eliminado"); loadConfigLists(); import('./repairs.js').then(m => m.loadListsForRepairs()); })
        .catch(err => showToast(err.message, "error"));
}

// ─── Nuevo Producto ─────────────────────────
async function openNewProductModal() {
    try {
        // Cargar categorías para el select
        const resCat = await fetch(`${API}/categories`);
        const categories = await resCat.json();
        const select = document.getElementById("new-product-category");
        select.innerHTML = '';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            select.appendChild(opt);
        });

        // Cargar marcas/modelos para el datalist
        const resBrands = await fetch(`${API}/admin/brand-models`, { headers: getHeaders() });
        if (resBrands.ok) {
            const brands = await resBrands.json();
            const datalist = document.getElementById("brand-model-list");
            datalist.innerHTML = '';
            brands.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.name;
                datalist.appendChild(opt);
            });
        }
    } catch (e) {
        showToast("Error cargando datos", "error");
        return;
    }
    document.getElementById("new-product-modal").classList.remove("hidden");
}

async function saveNewProduct() {
    const name = document.getElementById("new-product-name").value.trim();
    const brand = document.getElementById("new-product-brand").value.trim();
    const categoryId = parseInt(document.getElementById("new-product-category").value);
    const cost = parseFloat(document.getElementById("new-product-cost").value);
    const price = parseFloat(document.getElementById("new-product-price").value);
    const stock = parseInt(document.getElementById("new-product-stock").value) || 0;
    const minStock = parseInt(document.getElementById("new-product-min").value) || 5;
    const isFav = document.getElementById("new-product-fav").checked;
    if (!name || !categoryId || isNaN(cost) || isNaN(price)) { showToast("Completa los campos obligatorios (*)", "error"); return; }
    try {
        const res = await fetch(`${API}/admin/products`, { method: "POST", headers: getHeaders(), body: JSON.stringify({ name, brand, category_id: categoryId, cost_price: cost, sale_price: price, stock, min_stock: minStock, is_favorite: isFav }) });
        if (!res.ok) { const err = await res.json(); showToast(err.detail || "Error", "error"); return; }
        document.getElementById("new-product-modal").classList.add("hidden");
        showToast("Producto creado exitosamente");
        ["new-product-name", "new-product-brand", "new-product-cost", "new-product-price", "new-product-stock"].forEach(id => document.getElementById(id).value = "");
        document.getElementById("new-product-min").value = "5";
        document.getElementById("new-product-fav").checked = false;
        await loadAdminProducts();
        const { loadProductsForPOS } = await import('./sales.js');
        await loadProductsForPOS();
    } catch (e) { showToast("Error de conexión", "error"); }
}

// ─── Cambiar Contraseña ─────────────────────
async function changePassword() {
    const newPwd = document.getElementById("new-password").value;
    const confirmPwd = document.getElementById("confirm-password").value;
    const fb = document.getElementById("pwd-feedback");
    fb.className = "feedback-msg"; fb.classList.remove("hidden");
    if (!newPwd || newPwd.length < 4) { fb.textContent = "La contraseña debe tener al menos 4 caracteres"; fb.classList.add("error"); return; }
    if (newPwd !== confirmPwd) { fb.textContent = "Las contraseñas no coinciden"; fb.classList.add("error"); return; }
    try {
        const res = await fetch(`${API}/admin/change-password`, { method: "PUT", headers: getHeaders(), body: JSON.stringify({ new_password: newPwd }) });
        if (!res.ok) { fb.textContent = "Error al cambiar la contraseña"; fb.classList.add("error"); return; }
        fb.textContent = "✅ Contraseña actualizada correctamente";
        fb.classList.add("success");
        document.getElementById("new-password").value = "";
        document.getElementById("confirm-password").value = "";
    } catch { fb.textContent = "Error de conexión"; fb.classList.add("error"); }
}

// Exponer globales
window.openAddStock = openAddStock;
window.openEditPrice = openEditPrice;
window.openPriceHistory = openPriceHistory;
window.openEditCategory = openEditCategory;
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.deleteConfigItem = deleteConfigItem;