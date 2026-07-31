import { supabase, getSession, fmt, showToast } from './supabase.js';

let adminAllProducts = [];
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
    document.getElementById("new-product-btn")?.addEventListener("click", openNewProductModal);
    document.getElementById("cancel-new-product-btn")?.addEventListener("click", () => {
        document.getElementById("new-product-modal").classList.add("hidden");
    });
    document.getElementById("save-new-product-btn")?.addEventListener("click", saveNewProduct);
    document.getElementById("add-category-btn")?.addEventListener("click", addCategory);
    document.getElementById("add-equipment-btn")?.addEventListener("click", addEquipment);
    document.getElementById("add-brand-btn")?.addEventListener("click", addBrand);
    document.getElementById("cancel-stock-btn")?.addEventListener("click", () => {
        document.getElementById("add-stock-modal").classList.add("hidden");
    });
    document.getElementById("confirm-stock-btn")?.addEventListener("click", confirmAddStock);
    document.getElementById("cancel-price-btn")?.addEventListener("click", () => {
        document.getElementById("edit-price-modal").classList.add("hidden");
    });
    document.getElementById("confirm-price-btn")?.addEventListener("click", confirmEditPrice);
    document.getElementById("cancel-category-btn")?.addEventListener("click", () => {
        document.getElementById("edit-category-modal").classList.add("hidden");
    });
    document.getElementById("confirm-category-btn")?.addEventListener("click", confirmEditCategory);
    document.getElementById("close-price-history-modal")?.addEventListener("click", () => {
        document.getElementById("price-history-modal").classList.add("hidden");
    });
    document.getElementById("change-password-btn")?.addEventListener("click", changePassword);

    // Búsqueda y filtro en admin
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
            document.getElementById(tab.dataset.tab)?.classList.add("active");
        });
    });
}

// ─── Productos ──────────────────────────────
async function loadAdminProducts() {
    try {
        const { data } = await supabase
            .from('products')
            .select('*, categories(name)')
            .order('name');
        adminAllProducts = data?.map(p => ({ ...p, category_name: p.categories?.name })) || [];
        filterAdminProducts();
        populateAdminCategoryFilter();
    } catch (e) { console.error(e); }
}

function populateAdminCategoryFilter() {
    const select = document.getElementById("admin-category-filter");
    if (!select) return;
    const categoriesMap = new Map();
    adminAllProducts.forEach(p => {
        if (p.category_id && p.category_name) categoriesMap.set(p.category_id, p.category_name);
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
    const filtered = adminAllProducts.filter(p => {
        const matchSearch = !adminSearchQuery ||
            p.name.toLowerCase().includes(adminSearchQuery) ||
            p.brand.toLowerCase().includes(adminSearchQuery) ||
            p.code.toLowerCase().includes(adminSearchQuery) ||
            (p.category_name && p.category_name.toLowerCase().includes(adminSearchQuery));
        const matchCategory = !adminFilterCategoryId || p.category_id === parseInt(adminFilterCategoryId);
        return matchSearch && matchCategory;
    });
    renderAdminProductsTable(filtered);
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
            <td>S/ ${parseFloat(p.cost_price || 0).toFixed(2)}</td>
            <td>S/ ${parseFloat(p.sale_price || 0).toFixed(2)}</td>
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

function escHtml(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

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
    const session = getSession();
    const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';

    if (!qty || qty <= 0) { showToast("Ingresa una cantidad válida", "error"); return; }

    try {
        const { data: product } = await supabase
            .from('products')
            .select('stock, name')
            .eq('id', productId)
            .single();

        if (!product) { showToast("Producto no encontrado", "error"); return; }

        const newStock = product.stock + qty;

        await supabase
            .from('products')
            .update({ stock: newStock })
            .eq('id', productId);

        await supabase
            .from('stock_audit')
            .insert({
                product_id: productId,
                product_name: product.name,
                quantity_added: qty,
                previous_stock: product.stock,
                new_stock: newStock,
                operator_name: operator,
                notes: notes
            });

        document.getElementById("add-stock-modal").classList.add("hidden");
        showToast(`Stock actualizado. Nuevo stock: ${newStock}`);
        await loadAdminProducts();
        await loadStockAudit();
    } catch (e) {
        console.error(e);
        showToast("Error de conexión", "error");
    }
}

async function loadStockAudit() {
    try {
        const { data } = await supabase
            .from('stock_audit')
            .select('*')
            .order('created_at', { ascending: false });
        const tbody = document.getElementById("audit-tbody");
        if (!tbody) return;
        tbody.innerHTML = "";
        (data || []).forEach(a => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${new Date(a.created_at).toLocaleString('es-PE')}</td>
                <td>${a.product_name}</td>
                <td style="color:var(--accent-green);font-weight:700">+${a.quantity_added}</td>
                <td>${a.previous_stock}</td>
                <td style="font-weight:700">${a.new_stock}</td>
                <td>${a.operator_name}</td>
                <td class="text-dim">${a.notes || "—"}</td>`;
            tbody.appendChild(tr);
        });
    } catch (e) { console.error(e); }
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
    const session = getSession();
    const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';

    if (isNaN(newCost) || isNaN(newSale) || newCost <= 0 || newSale <= 0) {
        showToast("Ingresa precios válidos", "error"); return;
    }

    try {
        const { data: product } = await supabase
            .from('products')
            .select('cost_price, sale_price')
            .eq('id', productId)
            .single();

        await supabase
            .from('products')
            .update({ cost_price: newCost, sale_price: newSale })
            .eq('id', productId);

        await supabase
            .from('price_history')
            .insert({
                product_id: productId,
                old_cost_price: product.cost_price,
                new_cost_price: newCost,
                old_sale_price: product.sale_price,
                new_sale_price: newSale,
                changed_by: operator,
                notes: notes
            });

        document.getElementById("edit-price-modal").classList.add("hidden");
        showToast("Precios actualizados");
        await loadAdminProducts();
    } catch (e) {
        console.error(e);
        showToast("Error de conexión", "error");
    }
}

async function openPriceHistory(productId, productName) {
    document.getElementById("price-history-product-name").textContent = productName;
    const content = document.getElementById("price-history-content");
    content.innerHTML = "<p class='text-dim'>Cargando...</p>";
    document.getElementById("price-history-modal").classList.remove("hidden");

    try {
        const { data } = await supabase
            .from('price_history')
            .select('*')
            .eq('product_id', productId)
            .order('changed_at', { ascending: false });

        if (!data || data.length === 0) {
            content.innerHTML = `<p class="text-dim" style="text-align:center;padding:1rem">Sin cambios de precio registrados</p>`;
            return;
        }

        content.innerHTML = `
            <table><thead><tr>
                <th>Fecha</th><th>Costo anterior</th><th>Costo nuevo</th>
                <th>Precio anterior</th><th>Precio nuevo</th><th>Por</th><th>Notas</th>
            </tr></thead><tbody>
            ${data.map(r => `<tr>
                <td>${new Date(r.changed_at).toLocaleString('es-PE')}</td>
                <td>S/ ${parseFloat(r.old_cost_price || 0).toFixed(2)}</td>
                <td style="color:var(--accent-green)">S/ ${parseFloat(r.new_cost_price || 0).toFixed(2)}</td>
                <td>S/ ${parseFloat(r.old_sale_price || 0).toFixed(2)}</td>
                <td style="color:var(--accent-green)">S/ ${parseFloat(r.new_sale_price || 0).toFixed(2)}</td>
                <td>${r.changed_by}</td>
                <td class="text-dim">${r.notes || "—"}</td>
            </tr>`).join("")}
            </tbody></table>`;
    } catch {
        content.innerHTML = `<p style="color:var(--accent-red)">Error al cargar historial</p>`;
    }
}

// ─── Categorías ─────────────────────────────
async function loadCategories() {
    try {
        const { data } = await supabase
            .from('categories')
            .select('*, products(count)')
            .order('id');
        const tbody = document.getElementById("categories-tbody");
        if (!tbody) return;
        tbody.innerHTML = "";
        (data || []).forEach(cat => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${cat.id}</td>
                <td>${cat.name}</td>
                <td>${cat.products?.[0]?.count || 0}</td>
                <td>${cat.id !== 1 ? `
                    <button class="btn-outline btn-sm" onclick="editCategory(${cat.id}, '${escHtml(cat.name)}')">Editar</button>
                    <button class="btn-danger btn-sm" onclick="deleteCategory(${cat.id})">Eliminar</button>` : '—'}
                </td>`;
            tbody.appendChild(tr);
        });
    } catch (e) { console.error(e); }
}

async function addCategory() {
    const name = document.getElementById("new-category-name").value.trim();
    if (!name) return showToast("Ingresa un nombre", "error");
    try {
        const { error } = await supabase.from('categories').insert({ name });
        if (error) throw error;
        document.getElementById("new-category-name").value = "";
        showToast("Categoría creada");
        await loadCategories();
    } catch (e) {
        showToast("Error al crear categoría", "error");
    }
}

function editCategory(id, currentName) {
    const newName = prompt("Nuevo nombre:", currentName);
    if (!newName || newName === currentName) return;
    supabase.from('categories').update({ name: newName }).eq('id', id)
        .then(({ error }) => {
            if (error) throw error;
            showToast("Categoría actualizada");
            loadCategories();
        })
        .catch(() => showToast("Error", "error"));
}

function deleteCategory(id) {
    if (!confirm("¿Eliminar categoría? Los productos pasarán a 'Sin categoría'.")) return;
    supabase.from('products').update({ category_id: 1 }).eq('category_id', id)
        .then(() => supabase.from('categories').delete().eq('id', id))
        .then(({ error }) => {
            if (error) throw error;
            showToast("Categoría eliminada");
            loadCategories();
            loadAdminProducts();
        })
        .catch(err => showToast(err.message, "error"));
}

function openEditCategory(productId, productName, currentCategoryId) {
    supabase.from('categories').select('*').order('name')
        .then(({ data }) => {
            const select = document.getElementById("edit-category-select");
            select.innerHTML = '';
            data.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.text = cat.name;
                if (cat.id === currentCategoryId) opt.selected = true;
                select.appendChild(opt);
            });
            document.getElementById("edit-category-product-id").value = productId;
            document.getElementById("edit-category-product-name").textContent = productName;
            document.getElementById("edit-category-modal").classList.remove("hidden");
        });
}

async function confirmEditCategory() {
    const productId = parseInt(document.getElementById("edit-category-product-id").value);
    const newCategoryId = parseInt(document.getElementById("edit-category-select").value);
    try {
        const { error } = await supabase
            .from('products')
            .update({ category_id: newCategoryId })
            .eq('id', productId);
        if (error) throw error;
        showToast("Categoría actualizada");
        document.getElementById("edit-category-modal").classList.add("hidden");
        await loadAdminProducts();
    } catch { showToast("Error al actualizar", "error"); }
}

// ─── Config Desplegables ────────────────────
async function loadConfigLists() {
    try {
        const { data: eq } = await supabase.from('equipment_types').select('*').order('name');
        const { data: br } = await supabase.from('brand_models').select('*').order('name');
        renderConfigList("equipment-config-list", eq || [], 'equipment');
        renderConfigList("brand-config-list", br || [], 'brand');
    } catch (e) { console.error(e); }
}

function renderConfigList(containerId, items, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
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
    const name = input?.value?.trim();
    if (!name) return showToast("Ingresa un nombre", "error");
    try {
        const { error } = await supabase.from('equipment_types').insert({ name });
        if (error) throw error;
        input.value = "";
        showToast("Tipo de equipo agregado");
        await loadConfigLists();
    } catch (e) { showToast("Error", "error"); }
}

async function addBrand() {
    const input = document.getElementById("new-brand-input");
    const name = input?.value?.trim();
    if (!name) return showToast("Ingresa un nombre", "error");
    try {
        const { error } = await supabase.from('brand_models').insert({ name });
        if (error) throw error;
        input.value = "";
        showToast("Marca/Modelo agregado");
        await loadConfigLists();
    } catch (e) { showToast("Error", "error"); }
}

function deleteConfigItem(type, id) {
    if (!confirm("¿Eliminar?")) return;
    const table = type === 'equipment' ? 'equipment_types' : 'brand_models';
    supabase.from(table).delete().eq('id', id)
        .then(({ error }) => {
            if (error) throw error;
            showToast("Elemento eliminado");
            loadConfigLists();
        })
        .catch(err => showToast(err.message, "error"));
}

// ─── Nuevo Producto ─────────────────────────
async function openNewProductModal() {
    try {
        const { data: categories } = await supabase.from('categories').select('*').order('name');
        const select = document.getElementById("new-product-category");
        select.innerHTML = '';
        categories?.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            select.appendChild(opt);
        });

        const { data: brands } = await supabase.from('brand_models').select('*').order('name');
        const datalist = document.getElementById("brand-model-list");
        if (datalist) {
            datalist.innerHTML = '';
            brands?.forEach(b => {
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

    if (!name || !categoryId || isNaN(cost) || isNaN(price)) {
        showToast("Completa los campos obligatorios (*)", "error"); return;
    }

    // Generar código
    const { data: existingProducts } = await supabase
        .from('products')
        .select('id')
        .eq('category_id', categoryId);
    const seq = (existingProducts?.length || 0) + 1;
    const code = String(categoryId * 1000 + seq).padStart(6, '0');

    try {
        const { error } = await supabase
            .from('products')
            .insert({
                code, name, brand, category_id: categoryId,
                cost_price: cost, sale_price: price,
                stock, min_stock: minStock, is_favorite: isFav
            });

        if (error) throw error;

        document.getElementById("new-product-modal").classList.add("hidden");
        showToast("Producto creado exitosamente");
        ['new-product-name', 'new-product-brand', 'new-product-cost', 'new-product-price', 'new-product-stock']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById("new-product-min").value = "5";
        document.getElementById("new-product-fav").checked = false;
        await loadAdminProducts();
    } catch (e) {
        showToast("Error de conexión", "error");
    }
}

// ─── Cambiar Contraseña ─────────────────────
async function changePassword() {
    const newPwd = document.getElementById("new-password").value;
    const confirmPwd = document.getElementById("confirm-password").value;
    const fb = document.getElementById("pwd-feedback");
    fb.className = "feedback-msg";
    fb.classList.remove("hidden");

    if (!newPwd || newPwd.length < 4) {
        fb.textContent = "La contraseña debe tener al menos 4 caracteres";
        fb.classList.add("error"); return;
    }
    if (newPwd !== confirmPwd) {
        fb.textContent = "Las contraseñas no coinciden";
        fb.classList.add("error"); return;
    }

    try {
        const { error } = await supabase.auth.updateUser({ password: newPwd });
        if (error) throw error;
        fb.textContent = "✅ Contraseña actualizada correctamente";
        fb.classList.add("success");
        document.getElementById("new-password").value = "";
        document.getElementById("confirm-password").value = "";
    } catch {
        fb.textContent = "Error de conexión";
        fb.classList.add("error");
    }
}

// Exponer globales
window.openAddStock = openAddStock;
window.openEditPrice = openEditPrice;
window.openPriceHistory = openPriceHistory;
window.openEditCategory = openEditCategory;
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.deleteConfigItem = deleteConfigItem;