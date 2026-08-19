import { supabase, getSession, fmt, showToast } from './supabase.js';

let adminAllProducts = [];
let adminSearchQuery = '';
let adminFilterCategoryId = '';
let allAuditRecords = [];

export async function loadAdminView() {
    await Promise.all([
        loadAdminProducts(),
        loadStockAudit(),
        loadCategories(),
        loadConfigLists()
    ]);
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
    document.getElementById("stock-price-keep")?.addEventListener("change", () => {
        const box = document.getElementById("add-stock-prices-box");
        if (box) box.style.display = "none";
    });
    document.getElementById("stock-price-update")?.addEventListener("change", () => {
        const box = document.getElementById("add-stock-prices-box");
        if (box) box.style.display = "grid";
    });
    document.getElementById("cancel-edit-btn")?.addEventListener("click", () => {
        document.getElementById("edit-product-modal").classList.add("hidden");
    });
    document.getElementById("save-edit-btn")?.addEventListener("click", confirmEditProduct);
    document.getElementById("delete-product-btn")?.addEventListener("click", () => {
        const id = document.getElementById("edit-product-id").value;
        const name = document.getElementById("edit-product-name").value;
        if (id) {
            deleteProduct(id, name);
            document.getElementById("edit-product-modal").classList.add("hidden");
        }
    });
    document.getElementById("close-price-history-modal")?.addEventListener("click", () => {
        document.getElementById("price-history-modal").classList.add("hidden");
    });
    const reqConf = document.getElementById("require-sale-confirmation");
    if (reqConf) {
        reqConf.checked = localStorage.getItem("requireSaleConfirmation") === "true";
        reqConf.addEventListener("change", (e) => {
            localStorage.setItem("requireSaleConfirmation", e.target.checked);
            showToast("Ajuste guardado correctamente");
        });
    }

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

    // Filtros para Auditoría de Stock
    ['audit-filter-product', 'audit-filter-operator', 'audit-filter-date'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', renderStockAudit);
    });
    document.getElementById('audit-filter-clear')?.addEventListener('click', () => {
        const pEl = document.getElementById('audit-filter-product');
        const oEl = document.getElementById('audit-filter-operator');
        const dEl = document.getElementById('audit-filter-date');
        if (pEl) pEl.value = '';
        if (oEl) oEl.value = '';
        if (dEl) dEl.value = '';
        renderStockAudit();
    });
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
    const mobileCardsContainer = document.getElementById("admin-products-cards-mobile");
    
    if (tbody) tbody.innerHTML = "";
    if (mobileCardsContainer) mobileCardsContainer.innerHTML = "";
    
    if (products.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-dim);">No se encontraron productos</td></tr>';
        if (mobileCardsContainer) mobileCardsContainer.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-dim);">No se encontraron productos</div>';
        return;
    }
    products.forEach(p => {
        const stockColor = p.stock <= p.min_stock ? "color:var(--accent-yellow);font-weight:700" : "";
        
        if (tbody) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <strong>${p.name}</strong><br>
                    <small style="color:var(--text-dim)">${p.code}</small>
                </td>
                <td class="hide-on-mobile">${p.brand || '—'}</td>
                <td class="hide-on-mobile">${p.category_name || 'Sin categoría'}</td>
                <td class="hide-on-mobile">S/ ${parseFloat(p.cost_price || 0).toFixed(2)}</td>
                <td>S/ ${parseFloat(p.sale_price || 0).toFixed(2)}</td>
                <td style="${stockColor}">${p.stock}${p.stock <= p.min_stock ? " ⚠️" : ""}</td>
                <td class="hide-on-mobile">${p.min_stock}</td>
                <td style="white-space:nowrap" class="hide-on-mobile">
                    <button class="btn-green btn-sm" onclick="openAddStock(${p.id}, '${escHtml(p.name)}', ${p.cost_price || 0}, ${p.sale_price || 0})">+Stock</button>
                    <button class="btn-outline btn-sm" onclick="openPriceHistory(${p.id}, '${escHtml(p.name)}')">Historial</button>
                    <button class="btn-outline btn-sm" style="margin-left: 4px;" onclick="openEditProduct(${p.id}, '${escHtml(p.name)}', '${escHtml(p.brand || '')}', ${p.category_id}, ${p.cost_price || 0}, ${p.sale_price || 0})">✏️ Editar</button>
                </td>`;
            tbody.appendChild(tr);
        }

        if (mobileCardsContainer) {
            const card = document.createElement("div");
            card.className = "admin-card-mobile";
            card.innerHTML = `
                <div class="admin-card-header">
                    <div>
                        <div class="admin-card-title">${p.name}</div>
                        <div class="admin-card-code">${p.code}</div>
                    </div>
                    <div class="admin-card-stock" style="${stockColor}">
                        Stock: ${p.stock} ${p.stock <= p.min_stock ? "⚠️" : ""}
                    </div>
                </div>
                <div class="admin-card-details">
                    <div><strong>Marca:</strong> ${p.brand || '—'}</div>
                    <div><strong>Categoría:</strong> ${p.category_name || 'Sin categoría'}</div>
                    <div style="display: flex; justify-content: space-between; margin-top: 0.5rem;">
                        <div><strong>Costo:</strong> S/ ${parseFloat(p.cost_price || 0).toFixed(2)}</div>
                        <div><strong>Venta:</strong> <span style="color:var(--accent-green);font-weight:bold;">S/ ${parseFloat(p.sale_price || 0).toFixed(2)}</span></div>
                    </div>
                </div>
                <div class="admin-card-actions">
                    <button class="btn-green btn-sm" onclick="openAddStock(${p.id}, '${escHtml(p.name)}', ${p.cost_price || 0}, ${p.sale_price || 0})">+Stock</button>
                    <button class="btn-outline btn-sm" onclick="openPriceHistory(${p.id}, '${escHtml(p.name)}')">Historial</button>
                    <button class="btn-outline btn-sm" onclick="openEditProduct(${p.id}, '${escHtml(p.name)}', '${escHtml(p.brand || '')}', ${p.category_id}, ${p.cost_price || 0}, ${p.sale_price || 0})">✏️ Editar</button>
                </div>
            `;
            mobileCardsContainer.appendChild(card);
        }
    });
}

function escHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/`/g, "&#x60;");
}

// ─── Stock ──────────────────────────────────
function openAddStock(productId, productName, costPrice = 0, salePrice = 0) {
    document.getElementById("add-stock-product-id").value = productId;
    document.getElementById("add-stock-product-name").textContent = productName;
    document.getElementById("add-stock-qty").value = "";
    document.getElementById("add-stock-notes").value = "";

    // Cargar y mostrar precios actuales
    const oldCost = parseFloat(costPrice || 0);
    const oldSale = parseFloat(salePrice || 0);
    document.getElementById("add-stock-current-cost").textContent = fmt(oldCost);
    document.getElementById("add-stock-current-sale").textContent = fmt(oldSale);
    document.getElementById("add-stock-old-cost").value = oldCost;
    document.getElementById("add-stock-old-sale").value = oldSale;
    document.getElementById("add-stock-new-cost").value = oldCost;
    document.getElementById("add-stock-new-sale").value = oldSale;

    // Default: mantener precios actuales y ocultar inputs de edición de precios
    const keepRadio = document.getElementById("stock-price-keep");
    if (keepRadio) keepRadio.checked = true;
    const box = document.getElementById("add-stock-prices-box");
    if (box) box.style.display = "none";

    document.getElementById("add-stock-modal").classList.remove("hidden");
}

async function confirmAddStock() {
    const productId = parseInt(document.getElementById("add-stock-product-id").value);
    const qty = parseInt(document.getElementById("add-stock-qty").value);
    const notes = document.getElementById("add-stock-notes").value.trim();
    const session = getSession();
    const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';

    if (!qty || qty <= 0) { showToast("Ingresa una cantidad válida", "error"); return; }

    // Evaluar si modificó el precio de costo o de venta
    let updateData = {};
    let priceUpdated = false;
    const mode = document.querySelector('input[name="stock_price_mode"]:checked')?.value || "keep";

    if (mode === "update") {
        const newCost = parseFloat(document.getElementById("add-stock-new-cost").value);
        const newSale = parseFloat(document.getElementById("add-stock-new-sale").value);

        if (isNaN(newCost) || isNaN(newSale) || newCost <= 0 || newSale <= 0) {
            showToast("⚠️ Ingresa precios válidos mayores a S/ 0", "error"); return;
        }
        if (newSale < newCost + 0.5) {
            showToast("⚠️ El precio de venta debe ser mayor al costo por al menos S/ 0.50", "error"); return;
        }

        const oldCost = parseFloat(document.getElementById("add-stock-old-cost").value || 0);
        const oldSale = parseFloat(document.getElementById("add-stock-old-sale").value || 0);

        if (newCost !== oldCost || newSale !== oldSale) {
            updateData.cost_price = newCost;
            updateData.sale_price = newSale;
            priceUpdated = true;

            // Grabar en historial de precios la variación producida durante la compra
            await supabase.from('price_history').insert({
                product_id: productId,
                old_cost_price: oldCost,
                new_cost_price: newCost,
                old_sale_price: oldSale,
                new_sale_price: newSale,
                changed_by: operator,
                notes: (notes ? `[Ingreso de Stock +${qty}] ${notes}` : `Actualizado durante ingreso de +${qty} unidades de stock`)
            });
        }
    }

    try {
        const { data: product } = await supabase
            .from('products')
            .select('stock, name')
            .eq('id', productId)
            .single();

        if (!product) { showToast("Producto no encontrado", "error"); return; }

        const newStock = product.stock + qty;
        updateData.stock = newStock;

        await supabase
            .from('products')
            .update(updateData)
            .eq('id', productId);

        await supabase
            .from('stock_audit')
            .insert({
                product_id: productId,
                product_name: product.name,
                quantity_change: qty,
                previous_stock: product.stock,
                new_stock: newStock,
                operator_name: operator,
                movement_type: 'INGRESO_PROVEEDOR',
                notes: (priceUpdated ? `[Precios Actualizados] ` : ``) + (notes || "Aumento manual de stock")
            });

        document.getElementById("add-stock-modal").classList.add("hidden");
        showToast(priceUpdated ? `✅ Stock (+${qty}) y nuevos precios actualizados` : `✅ Stock actualizado. Nuevo stock: ${newStock}`);
        await loadAdminProducts();
        await loadStockAudit();
    } catch (e) {
        console.error(e);
        showToast("Error de conexión al guardar stock", "error");
    }
}

async function loadStockAudit() {
    try {
        const { data, error } = await supabase
            .from('stock_audit')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) console.error("Error cargando auditoría stock:", error);
        allAuditRecords = data || [];
        renderStockAudit();
    } catch (e) { console.error(e); }
}

function renderStockAudit() {
    const tbody = document.getElementById("audit-tbody");
    if (!tbody) return;

    const filterProd = document.getElementById("audit-filter-product")?.value.toLowerCase().trim() || "";
    const filterOp = document.getElementById("audit-filter-operator")?.value.toLowerCase().trim() || "";
    const filterDate = document.getElementById("audit-filter-date")?.value || "";

    const filtered = allAuditRecords.filter(a => {
        if (filterProd && !(a.product_name || "").toLowerCase().includes(filterProd)) return false;
        if (filterOp && !(a.operator_name || "").toLowerCase().includes(filterOp)) return false;
        if (filterDate && a.created_at && !a.created_at.startsWith(filterDate)) return false;
        return true;
    });

    tbody.innerHTML = "";
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-dim);">No hay registros en la auditoría de stock</td></tr>';
        return;
    }

    filtered.forEach(a => {
        const tr = document.createElement("tr");
        const qty = parseInt(a.quantity_change ?? a.quantity_added ?? 0);
        const color = qty >= 0 ? "var(--accent-green)" : "var(--accent-red)";
        const prefix = qty > 0 ? "+" : "";
        const dateDesktop = a.created_at ? new Date(a.created_at).toLocaleString('es-PE') : "-";
        const dateMobile = a.created_at ? new Date(a.created_at).toLocaleString('es-PE', { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : "-";

        let typeBadge = `<span style="background:rgba(88,101,242,0.2); color:#60a5fa; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:700; margin-right:6px;">📦 INGRESO</span>`;
        if (a.movement_type === 'VENTA') typeBadge = `<span style="background:rgba(16,185,129,0.2); color:#34d399; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:700; margin-right:6px;">🛒 VENTA</span>`;
        else if (a.movement_type === 'USO_EN_REPARACION') typeBadge = `<span style="background:rgba(245,158,11,0.2); color:#fbbf24; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:700; margin-right:6px;">🔧 TALLER</span>`;
        else if (a.movement_type === 'AJUSTE_MERMA') typeBadge = `<span style="background:rgba(239,68,68,0.2); color:#f87171; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:700; margin-right:6px;">📉 MERMA</span>`;
        else if (a.movement_type === 'DEVOLUCION_CLIENTE') typeBadge = `<span style="background:rgba(168,85,247,0.2); color:#c084fc; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:700; margin-right:6px;">↩️ DEVOLUCIÓN</span>`;

        tr.innerHTML = `
            <td>
                <span class="hidden-mobile">${dateDesktop}</span>
                <span class="hidden-desktop">${dateMobile}</span>
                <br><button class="btn-outline btn-sm hidden-desktop mt-1 toggle-audit-btn" data-id="${a.id || Math.random()}" style="font-size: 0.7rem; padding: 2px 6px;">Más info ⬇️</button>
            </td>
            <td><strong>${a.product_name || "Producto"}</strong></td>
            <td style="color:${color};font-weight:800;font-size:0.95rem; text-align: center;">${prefix}${qty}</td>
            <td class="hide-on-mobile">${a.previous_stock ?? "-"}</td>
            <td class="hide-on-mobile" style="font-weight:700">${a.new_stock ?? "-"}</td>
            <td class="hide-on-mobile"><span class="badge" style="background:rgba(255,255,255,0.05);">${a.operator_name || "Sistema"}</span></td>
            <td class="text-dim hide-on-mobile" style="max-width:260px;">${typeBadge}${a.notes || "—"}</td>`;
        tbody.appendChild(tr);

        // Fila de detalles para móvil
        const detailsTr = document.createElement("tr");
        const rowId = a.id || Math.random().toString(36).substr(2, 9);
        tr.querySelector('.toggle-audit-btn').setAttribute('data-id', rowId);
        detailsTr.className = `mobile-details-row audit-details-row-${rowId}`;
        detailsTr.style.display = "none";
        let cleanNotes = a.notes || "—";
        if (a.movement_type === 'VENTA') cleanNotes = cleanNotes.replace(/^Venta\s*/i, '');

        detailsTr.innerHTML = `
            <td colspan="3" style="background: var(--glass-bg); padding: 1rem;">
                <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.85rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div><strong>Stock Ant.:</strong> ${a.previous_stock ?? "-"}</div>
                        <div><strong>Stock Nuevo:</strong> <span style="font-weight:700">${a.new_stock ?? "-"}</span></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.5rem;">
                        <div style="flex: 1;"><strong>Resp.:</strong> ${a.operator_name || "Sistema"}</div>
                        <div style="flex: 1.5; text-align: right;"><strong>Mov.:</strong> ${typeBadge} <br><span style="color:var(--text-dim);font-size:0.8rem;">${cleanNotes}</span></div>
                    </div>
                </div>
            </td>
        `;
        tbody.appendChild(detailsTr);
    });

    tbody.querySelectorAll('.toggle-audit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            const row = tbody.querySelector(`.audit-details-row-${id}`);
            if (row) {
                if (row.style.display === 'none') {
                    row.style.display = 'table-row';
                    e.target.innerHTML = 'Menos info ⬆️';
                } else {
                    row.style.display = 'none';
                    e.target.innerHTML = 'Más info ⬇️';
                }
            }
        });
    });
}

// ─── Edición de Producto ────────────────────────────────
function openEditProduct(productId, productName, brand, categoryId, costPrice, salePrice) {
    document.getElementById("edit-product-id").value = productId;
    document.getElementById("edit-product-name").value = productName;
    document.getElementById("edit-product-brand").value = brand;
    document.getElementById("edit-product-cost").value = costPrice;
    document.getElementById("edit-product-price").value = salePrice;

    // Load categories
    supabase.from('categories').select('*').order('name')
        .then(({ data }) => {
            const select = document.getElementById("edit-product-category");
            select.innerHTML = '';
            (data || []).forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.text = cat.name;
                if (cat.id == categoryId) opt.selected = true;
                select.appendChild(opt);
            });
            document.getElementById("edit-product-modal").classList.remove("hidden");
        });
}

async function confirmEditProduct() {
    const productId = parseInt(document.getElementById("edit-product-id").value);
    const newName = document.getElementById("edit-product-name").value.trim();
    const newBrand = document.getElementById("edit-product-brand").value.trim();
    const newCategoryId = parseInt(document.getElementById("edit-product-category").value);
    const newCost = parseFloat(document.getElementById("edit-product-cost").value);
    const newSale = parseFloat(document.getElementById("edit-product-price").value);
    const session = getSession();
    const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';

    if (!newName) {
        showToast("Ingresa un nombre válido", "error"); return;
    }
    if (isNaN(newCost) || isNaN(newSale) || newCost < 0 || newSale < 0) {
        showToast("Ingresa precios válidos", "error"); return;
    }
    if (newSale < newCost) {
        showToast("⚠️ El precio de venta no debe ser menor que el costo", "error"); return;
    }

    try {
        // Fetch current product to check if prices changed
        const { data: product, error: fetchErr } = await supabase
            .from('products')
            .select('cost_price, sale_price')
            .eq('id', productId)
            .single();

        if (fetchErr) console.warn("Advertencia obteniendo producto previo:", fetchErr);

        const oldCost = parseFloat(product?.cost_price || 0);
        const oldSale = parseFloat(product?.sale_price || 0);

        // Update product details
        const { error: updErr } = await supabase
            .from('products')
            .update({ 
                name: newName, 
                brand: newBrand, 
                category_id: newCategoryId, 
                cost_price: newCost, 
                sale_price: newSale 
            })
            .eq('id', productId);

        if (updErr) {
            console.error("Error al actualizar tabla products:", updErr);
            showToast("❌ Error actualizando producto: " + updErr.message, "error");
            return;
        }

        // Only insert into price_history if prices changed
        if (oldCost !== newCost || oldSale !== newSale) {
            const { error: histErr } = await supabase
                .from('price_history')
                .insert({
                    product_id: productId,
                    old_cost_price: oldCost,
                    new_cost_price: newCost,
                    old_sale_price: oldSale,
                    new_sale_price: newSale,
                    changed_by: operator,
                    notes: "Edición unificada de producto"
                });

            if (histErr) {
                console.error("Error al insertar en price_history:", histErr);
            }
        }

        showToast("✅ Producto actualizado correctamente");
        document.getElementById("edit-product-modal").classList.add("hidden");
        await loadAdminProducts();
    } catch (e) {
        console.error("Expeción en confirmEditProduct:", e);
        showToast("Error de conexión al guardar producto", "error");
    }
}

async function openPriceHistory(productId, productName) {
    console.log("Consultando historial de precio para ID:", productId);
    document.getElementById("price-history-product-name").textContent = productName;
    const content = document.getElementById("price-history-content");
    content.innerHTML = "<p class='text-dim' style='padding: 1rem; text-align:center;'>⏳ Consultando servidor de Supabase...</p>";
    document.getElementById("price-history-modal").classList.remove("hidden");

    try {
        // Consultar sin .order() para evitar error 400 si la columna de ordenamiento difiere
        const { data, error } = await supabase
            .from('price_history')
            .select('*')
            .eq('product_id', productId);

        if (error) {
            console.error("Error en consulta price_history:", error);
            content.innerHTML = `<div style="padding:1rem; text-align:center; color:var(--accent-red); background:rgba(239,68,68,0.1); border-radius:8px;">⚠️ Error al consultar tabla 'price_history':<br><small>${error.message}</small><br><span style="font-size:0.75rem; color:var(--text-dim);">Asegúrate de que la tabla exista y tenga políticas RLS de lectura habilitadas.</span></div>`;
            return;
        }

        if (!data || data.length === 0) {
            content.innerHTML = `<p class="text-dim" style="text-align:center;padding:1.5rem">No se encontraron registros de cambios de precio para este producto.</p>`;
            return;
        }

        // Ordenar en memoria por fecha más reciente (created_at o changed_at o id)
        data.sort((a, b) => {
            const timeA = new Date(a.created_at || a.changed_at || 0).getTime() || (a.id || 0);
            const timeB = new Date(b.created_at || b.changed_at || 0).getTime() || (b.id || 0);
            return timeB - timeA;
        });

        content.innerHTML = `
            <table><thead><tr>
                <th>Fecha</th><th>Costo anterior</th><th>Costo nuevo</th>
                <th>Precio anterior</th><th>Precio nuevo</th><th>Por</th><th>Notas</th>
            </tr></thead><tbody>
            ${data.map(r => {
            const fecha = r.created_at || r.changed_at;
            const fechaStr = fecha ? new Date(fecha).toLocaleString('es-PE') : "-";
            return `<tr>
                <td>${fechaStr}</td>
                <td>S/ ${parseFloat(r.old_cost_price || 0).toFixed(2)}</td>
                <td style="color:var(--accent-green)">S/ ${parseFloat(r.new_cost_price || 0).toFixed(2)}</td>
                <td>S/ ${parseFloat(r.old_sale_price || 0).toFixed(2)}</td>
                <td style="color:var(--accent-green)">S/ ${parseFloat(r.new_sale_price || 0).toFixed(2)}</td>
                <td>${r.changed_by || 'Sistema'}</td>
                <td class="text-dim">${r.notes || "—"}</td>
            </tr>`;
        }).join("")}
            </tbody></table>`;
    } catch (err) {
        console.error(err);
        content.innerHTML = `<p style="color:var(--accent-red)">Error al cargar historial: ${err.message || err}</p>`;
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



// ─── Config Desplegables ────────────────────
async function loadConfigLists() {
    try {
        const [{ data: eq }, { data: br }] = await Promise.all([
            supabase.from('equipment_types').select('*').order('name'),
            supabase.from('brand_models').select('*').order('name')
        ]);
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

    // Generar código seguro obteniendo el mayor código actual
    const { data: existingProducts } = await supabase
        .from('products')
        .select('code')
        .eq('category_id', categoryId)
        .order('code', { ascending: false })
        .limit(1);

    let seq = 1;
    if (existingProducts && existingProducts.length > 0 && existingProducts[0].code) {
        // Extraer el número secuencial del código (asumiendo formato numerico)
        const lastCode = parseInt(existingProducts[0].code) || (categoryId * 1000);
        seq = (lastCode % 1000) + 1;
    }
    const code = String(categoryId * 1000 + seq).padStart(6, '0');

    try {
        const { data: newProd, error } = await supabase
            .from('products')
            .insert({
                code, name, brand, category_id: categoryId,
                cost_price: cost, sale_price: price,
                stock, min_stock: minStock, is_favorite: isFav
            })
            .select()
            .single();

        if (error) throw error;

        if (stock > 0 && newProd) {
            const session = getSession();
            const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';
            await supabase.from('stock_audit').insert({
                product_id: newProd.id,
                product_name: name,
                quantity_change: stock,
                previous_stock: 0,
                new_stock: stock,
                operator_name: operator,
                movement_type: 'INGRESO_PROVEEDOR',
                notes: "Stock inicial al crear producto"
            });
        }

        document.getElementById("new-product-modal").classList.add("hidden");
        showToast("Producto creado exitosamente");
        ['new-product-name', 'new-product-brand', 'new-product-cost', 'new-product-price', 'new-product-stock']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById("new-product-min").value = "5";
        document.getElementById("new-product-fav").checked = false;
        await loadAdminProducts();
        await loadStockAudit();
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

// ─── Eliminar Producto ──────────────────────
async function deleteProduct(id, name) {
    if (!confirm(`⚠️ ¿Estás seguro de que deseas ELIMINAR el producto "${name}"?\nEsta acción no se puede deshacer y fallará si el producto tiene historial de ventas o reparaciones asociadas.`)) {
        return;
    }
    
    try {
        // Intento de borrado (Si tiene ventas fallará por foreign key constraint, que es lo ideal para la integridad)
        const { error } = await supabase.from('products').delete().eq('id', id);
        
        if (error) {
            if (error.code === '23503') { // Foreign Key Violation en PostgreSQL
                showToast(`No se puede eliminar "${name}" porque ya tiene ventas o historial registrado.`, "error");
            } else {
                throw error;
            }
            return;
        }
        
        showToast(`Producto "${name}" eliminado exitosamente`);
        await loadAdminProducts();
    } catch (e) {
        console.error("Error al eliminar producto:", e);
        showToast("Error al eliminar el producto", "error");
    }
}

// Exponer globales
window.openAddStock = openAddStock;
window.openPriceHistory = openPriceHistory;
window.openEditProduct = openEditProduct;
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.deleteConfigItem = deleteConfigItem;
window.deleteProduct = deleteProduct;

// ═══ Realtime Sync ═══
window.addEventListener('supabase_realtime', async (e) => {
    const table = e.detail.table;
    if (document.querySelector('.nav-item[data-view="admin"]')?.classList.contains('active') || document.querySelector('.mobile-nav-item[data-target="admin"]')?.classList.contains('active')) {
        if (table === 'products' || table === 'stock_history') {
            await loadAdminProducts();
            await loadStockAudit();
        }
    }
});