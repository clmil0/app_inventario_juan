import { supabase, getSession, clearSession, fmt, showToast } from './supabase.js';
import { safeAdd, safeSubtract, safeMultiply } from './math.js';
import { buildProfitEvents, sumBy, PAYMENT_METHODS } from './finance.js';
import { chartInstances } from './dashboard.js';

let adminAllProducts = [];
let adminSearchQuery = '';
let adminFilterCategoryId = '';
let allAuditRecords = [];
let adminCategories = [];
let adminLowStockOnly = false;

export async function loadAdminView(intent = null) {
    adminLowStockOnly = !!intent?.lowStock;
    await Promise.all([
        loadAdminProducts(),
        loadStockAudit(),
        loadCategories(),
        loadConfigLists(),
        loadCashView()
    ]);
    initAdminTabs();
    if (intent?.tab) showAdminTab(intent.tab);
}

export function bindAdminEvents() {
    document.getElementById("new-product-btn")?.addEventListener("click", openNewProductModal);
    document.getElementById("cancel-new-product-btn")?.addEventListener("click", () => {
        document.getElementById("new-product-modal").classList.add("hidden");
    });
    document.getElementById("save-new-product-btn")?.addEventListener("click", saveNewProduct);
    document.getElementById("add-category-btn")?.addEventListener("click", addCategory);
    bindCatalogEvents();
    bindCashEvents();
    document.getElementById("admin-low-stock-toggle")?.addEventListener("click", () => {
        adminLowStockOnly = !adminLowStockOnly;
        filterAdminProducts();
    });
    // IDs del modal rediseñado (antes se buscaban cancel-stock-btn / confirm-stock-btn / add-stock-qty...,
    // que ya no existen: el botón "+Stock" lanzaba un error y el modal nunca se abría)
    document.getElementById("cancel-add-stock-btn")?.addEventListener("click", () => {
        document.getElementById("add-stock-modal").classList.add("hidden");
    });
    document.getElementById("save-add-stock-btn")?.addEventListener("click", confirmAddStock);
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

    // Copia de seguridad
    document.getElementById("export-backup-btn")?.addEventListener("click", exportBackup);
    document.getElementById("import-backup-btn")?.addEventListener("click", () => {
        const input = document.getElementById("import-backup-file");
        if (input) { input.value = ""; input.click(); }
    });
    document.getElementById("import-backup-file")?.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file) importBackup(file);
    });

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

    // Reportes Contables
    document.getElementById("report-period")?.addEventListener("change", (e) => {
        const customDiv = document.getElementById("report-custom-dates");
        if (e.target.value === "custom") {
            customDiv.style.display = "flex";
        } else {
            customDiv.style.display = "none";
        }
    });
    document.getElementById("generate-report-btn")?.addEventListener("click", generateAccountingReport);
}

// ─── Admin Tabs ─────────────────────────────
function initAdminTabs() {
    document.querySelectorAll(".admin-tab").forEach(tab => {
        tab.addEventListener("click", () => showAdminTab(tab.dataset.tab));
    });
}

function showAdminTab(tabId) {
    const tab = document.querySelector(`.admin-tab[data-tab="${tabId}"]`);
    if (!tab) return;
    document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".admin-tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    document.getElementById(tabId)?.classList.add("active");
    if (tabId === "admin-cash") renderCashChart(); // el canvas necesita estar visible para medir su tamaño
}

// ─── Productos ──────────────────────────────
async function loadAdminProducts() {
    try {
        const response = await fetch('/api/products');
        const data = await response.json();
        adminAllProducts = data || [];
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

function isLowStock(p) {
    return (parseInt(p.stock) || 0) <= (parseInt(p.min_stock) || 0);
}

function filterAdminProducts() {
    const filtered = adminAllProducts.filter(p => {
        const matchSearch = !adminSearchQuery ||
            (p.name || '').toLowerCase().includes(adminSearchQuery) ||
            (p.brand || '').toLowerCase().includes(adminSearchQuery) ||
            String(p.code || '').toLowerCase().includes(adminSearchQuery) ||
            (p.category_name && p.category_name.toLowerCase().includes(adminSearchQuery));
        const matchCategory = !adminFilterCategoryId || p.category_id === parseInt(adminFilterCategoryId);
        const matchLowStock = !adminLowStockOnly || isLowStock(p);
        return matchSearch && matchCategory && matchLowStock;
    });
    // Con el filtro de stock bajo, lo más urgente primero (menor stock respecto al mínimo)
    if (adminLowStockOnly) filtered.sort((a, b) => (a.stock - a.min_stock) - (b.stock - b.min_stock));

    const toggle = document.getElementById("admin-low-stock-toggle");
    if (toggle) {
        toggle.classList.toggle("active", adminLowStockOnly);
        toggle.setAttribute("aria-pressed", String(adminLowStockOnly));
    }
    const count = document.getElementById("admin-low-stock-count");
    if (count) count.textContent = adminAllProducts.filter(isLowStock).length;

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
                    <strong>${escHtml(p.name)}</strong><br>
                    <small style="color:var(--text-dim)">${escHtml(p.code)}</small>
                </td>
                <td class="hide-on-mobile">${escHtml(p.brand) || '—'}</td>
                <td class="hide-on-mobile">${escHtml(p.category_name) || 'Sin categoría'}</td>
                <td class="hide-on-mobile">S/ ${parseFloat(p.cost_price || 0).toFixed(2)}</td>
                <td>S/ ${parseFloat(p.sale_price || 0).toFixed(2)}</td>
                <td style="${stockColor}">${p.stock}${p.stock <= p.min_stock ? " ⚠️" : ""}</td>
                <td class="hide-on-mobile">${p.min_stock}</td>
                <td style="white-space:nowrap" class="hide-on-mobile">
                    <button class="btn-green btn-sm" onclick="openAddStock(${p.id})">+Stock</button>
                    <button class="btn-outline btn-sm" onclick="openPriceHistory(${p.id})">Historial</button>
                    <button class="btn-outline btn-sm" style="margin-left: 4px;" onclick="openEditProduct(${p.id})">✏️ Editar</button>
                </td>`;
            tbody.appendChild(tr);
        }

        if (mobileCardsContainer) {
            const card = document.createElement("div");
            card.className = "admin-card-mobile";
            card.innerHTML = `
                <div class="admin-card-header">
                    <div>
                        <div class="admin-card-title">${escHtml(p.name)}</div>
                        <div class="admin-card-code">${escHtml(p.code)}</div>
                    </div>
                    <div class="admin-card-stock" style="${stockColor}">
                        Stock: ${p.stock} ${p.stock <= p.min_stock ? "⚠️" : ""}
                    </div>
                </div>
                <div class="admin-card-details">
                    <div><strong>Marca:</strong> ${escHtml(p.brand) || '—'}</div>
                    <div><strong>Categoría:</strong> ${escHtml(p.category_name) || 'Sin categoría'}</div>
                    <div style="display: flex; justify-content: space-between; margin-top: 0.5rem;">
                        <div><strong>Costo:</strong> S/ ${parseFloat(p.cost_price || 0).toFixed(2)}</div>
                        <div><strong>Venta:</strong> <span style="color:var(--accent-green);font-weight:bold;">S/ ${parseFloat(p.sale_price || 0).toFixed(2)}</span></div>
                    </div>
                </div>
                <div class="admin-card-actions">
                    <button class="btn-green btn-sm" onclick="openAddStock(${p.id})">+Stock</button>
                    <button class="btn-outline btn-sm" onclick="openPriceHistory(${p.id})">Historial</button>
                    <button class="btn-outline btn-sm" onclick="openEditProduct(${p.id})">✏️ Editar</button>
                </div>
            `;
            mobileCardsContainer.appendChild(card);
        }
    });
}

function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/`/g, "&#x60;");
}

// Fecha local (YYYY-MM-DD) de un timestamp de la BD. Comparar el texto crudo usaba la fecha UTC:
// un movimiento de las 8pm en Perú aparecía como del día siguiente.
function localDateKey(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Los botones de la tabla solo pasan el id: antes pasaban el nombre dentro del atributo onclick
// y un nombre con apóstrofo (ej. "Cable 6' HDMI") rompía el JavaScript y los botones dejaban de funcionar.
function findAdminProduct(productId) {
    return adminAllProducts.find(p => p.id === productId);
}

// ─── Stock ──────────────────────────────────
let addStockProductId = null;

function openAddStock(productId) {
    const p = findAdminProduct(productId);
    if (!p) return;
    addStockProductId = productId;
    document.getElementById("add-stock-product-name").textContent = p.name;
    document.getElementById("add-stock-current").textContent = p.stock;
    document.getElementById("add-stock-cost-label").textContent = fmt(p.cost_price);
    document.getElementById("add-stock-price-label").textContent = fmt(p.sale_price);
    document.getElementById("add-stock-amount").value = "1";
    document.getElementById("add-stock-notes").value = "";
    // Precios nuevos opcionales: vacíos = mantener los actuales
    document.getElementById("add-stock-new-cost").value = "";
    document.getElementById("add-stock-new-price").value = "";
    document.getElementById("add-stock-modal").classList.remove("hidden");
}

async function confirmAddStock() {
    const productId = addStockProductId;
    const qtyRaw = document.getElementById("add-stock-amount").value.trim();
    const qty = Number(qtyRaw);
    const notes = document.getElementById("add-stock-notes").value.trim();
    const newCostRaw = document.getElementById("add-stock-new-cost").value.trim();
    const newSaleRaw = document.getElementById("add-stock-new-price").value.trim();
    const session = getSession();
    const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';

    if (!productId) return;
    if (!qtyRaw || !Number.isInteger(qty) || qty <= 0) { showToast("Ingresa una cantidad entera mayor a 0", "error"); return; }

    // Evitar doble clic: dos ingresos simultáneos duplicaban el registro en auditoría
    const confirmBtn = document.getElementById("save-add-stock-btn");
    if (confirmBtn?.disabled) return;
    if (confirmBtn) confirmBtn.disabled = true;

    let updateData = {};
    let priceUpdated = false;

    try {
        // Leer el stock y precios actuales de la BD (no los de la tabla en pantalla, que pueden estar desactualizados)
        const { data: product } = await supabase
            .from('products')
            .select('stock, name, cost_price, sale_price')
            .eq('id', productId)
            .single();

        if (!product) { showToast("Producto no encontrado", "error"); return; }

        if (newCostRaw !== '' || newSaleRaw !== '') {
            const oldCost = parseFloat(product.cost_price || 0);
            const oldSale = parseFloat(product.sale_price || 0);
            const newCost = newCostRaw !== '' ? Number(newCostRaw) : oldCost;
            const newSale = newSaleRaw !== '' ? Number(newSaleRaw) : oldSale;

            if (isNaN(newCost) || isNaN(newSale) || newCost <= 0 || newSale <= 0) {
                showToast("⚠️ Ingresa precios válidos mayores a S/ 0", "error"); return;
            }
            if (newSale < newCost + 0.5) {
                showToast("⚠️ El precio de venta debe ser mayor al costo por al menos S/ 0.50", "error"); return;
            }

            if (newCost !== oldCost || newSale !== oldSale) {
                updateData.cost_price = newCost;
                updateData.sale_price = newSale;
                priceUpdated = true;

                await supabase.from('price_history').insert({
                    product_id: productId,
                    old_cost_price: oldCost,
                    new_cost_price: newCost,
                    old_sale_price: oldSale,
                    new_sale_price: newSale,
                    changed_by: operator,
                    notes: (notes ? `[Ingreso de Stock +${qty}] ${notes}` : `Actualizado durante ingreso de +${qty} unidades de stock`)
                });

                if (newCost !== oldCost && product.stock > 0) {
                    const revaluationProfit = safeMultiply(safeSubtract(newCost, oldCost), product.stock);
                    await supabase.from('inventory_revaluations').insert({
                        product_id: productId,
                        product_name: product.name,
                        old_cost_price: oldCost,
                        new_cost_price: newCost,
                        stock_at_change: product.stock,
                        revaluation_profit: revaluationProfit,
                        changed_by: operator
                    });
                }
            }
        }

        const newStock = product.stock + qty;
        updateData.stock = newStock;

        const { error: updErr } = await supabase
            .from('products')
            .update(updateData)
            .eq('id', productId);

        if (updErr) {
            console.error("Error al actualizar stock/precios en products:", updErr);
            showToast("❌ Error DB: " + updErr.message, "error");
            return;
        }

        const { error: auditErr } = await supabase
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
            
        if (auditErr) console.error("Error en stock_audit:", auditErr);

        document.getElementById("add-stock-modal").classList.add("hidden");
        showToast(priceUpdated ? `✅ Stock (+${qty}) y nuevos precios actualizados` : `✅ Stock actualizado. Nuevo stock: ${newStock}`);
        await loadAdminProducts();
        await loadStockAudit();
    } catch (e) {
        console.error("Excepción en confirmAddStock:", e);
        showToast("Error general al procesar ingreso", "error");
    } finally {
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

async function loadStockAudit() {
    try {
        const response = await fetch('/api/admin/stock/audit');
        const data = await response.json();
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
        if (filterDate && (!a.created_at || localDateKey(a.created_at) !== filterDate)) return false;
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
                <span>${dateDesktop}</span>
                <br><button class="btn-outline btn-sm hidden-desktop mt-1 toggle-audit-btn" style="font-size: 0.7rem; padding: 2px 6px;">Más info ⬇️</button>
            </td>
            <td><strong>${escHtml(a.product_name) || "Producto"}</strong></td>
            <td style="color:${color};font-weight:800;font-size:0.95rem; text-align: center;">${prefix}${qty}</td>
            <td class="hide-on-mobile">${a.previous_stock ?? "-"}</td>
            <td class="hide-on-mobile" style="font-weight:700">${a.new_stock ?? "-"}</td>
            <td class="hide-on-mobile"><span class="badge" style="background:rgba(255,255,255,0.05);">${escHtml(a.operator_name) || "Sistema"}</span></td>
            <td class="text-dim hide-on-mobile" style="max-width:260px;">${typeBadge}${escHtml(a.notes) || "—"}</td>`;
        tbody.appendChild(tr);

        // Fila de detalles para móvil
        const detailsTr = document.createElement("tr");
        const rowId = a.id || Math.random().toString(36).slice(2, 11);
        tr.querySelector('.toggle-audit-btn').setAttribute('data-id', rowId);
        detailsTr.className = `mobile-details-row audit-details-row-${rowId}`;
        detailsTr.style.display = "none";
        let cleanNotes = escHtml(a.notes) || "—";
        if (a.movement_type === 'VENTA') cleanNotes = cleanNotes.replace(/^Venta\s*/i, '');

        detailsTr.innerHTML = `
            <td colspan="3" style="background: var(--glass-bg); padding: 1rem;">
                <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.85rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div><strong>Stock Ant.:</strong> ${a.previous_stock ?? "-"}</div>
                        <div><strong>Stock Nuevo:</strong> <span style="font-weight:700">${a.new_stock ?? "-"}</span></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.5rem;">
                        <div style="flex: 1;"><strong>Resp.:</strong> ${escHtml(a.operator_name) || "Sistema"}</div>
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
function openEditProduct(productId) {
    const p = findAdminProduct(productId);
    if (!p) return;
    const categoryId = p.category_id;
    document.getElementById("edit-product-id").value = productId;
    document.getElementById("edit-product-name").value = p.name || '';
    document.getElementById("edit-product-brand").value = p.brand || '';
    document.getElementById("edit-product-cost").value = p.cost_price || 0;
    document.getElementById("edit-product-price").value = p.sale_price || 0;

    // Load categories
    fetch('/api/products/categories')
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById("edit-product-category");
            // Opción vacía: si el producto no tiene categoría (p.ej. se eliminó) no se le asigna
            // la primera de la lista sin que el usuario lo note al guardar
            select.innerHTML = '<option value="">Sin categoría</option>';
            (data || []).forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.text = cat.name;
                if (cat.id == categoryId) opt.selected = true;
                select.appendChild(opt);
            });
            document.getElementById("edit-product-modal").classList.remove("hidden");
        })
        .catch(() => showToast("Error cargando categorías", "error"));
}

async function confirmEditProduct() {
    const productId = parseInt(document.getElementById("edit-product-id").value);
    const newName = document.getElementById("edit-product-name").value.trim();
    const newBrand = document.getElementById("edit-product-brand").value.trim();
    const newCategoryId = parseInt(document.getElementById("edit-product-category").value) || null;
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
            .select('cost_price, sale_price, stock, name')
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

            if (newCost !== oldCost && product && product.stock > 0) {
                const revaluationProfit = safeMultiply(safeSubtract(newCost, oldCost), product.stock);
                await supabase.from('inventory_revaluations').insert({
                    product_id: productId,
                    product_name: product.name,
                    old_cost_price: oldCost,
                    new_cost_price: newCost,
                    stock_at_change: product.stock,
                    revaluation_profit: revaluationProfit,
                    changed_by: operator
                });
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

async function openPriceHistory(productId) {
    const productName = findAdminProduct(productId)?.name || '';
    document.getElementById("price-history-product-name").textContent = productName;
    const content = document.getElementById("price-history-content");
    content.innerHTML = "<p class='text-dim' style='padding: 1rem; text-align:center;'>⏳ Cargando historial...</p>";
    document.getElementById("price-history-modal").classList.remove("hidden");

    try {
        // Consultar sin .order() para evitar error 400 si la columna de ordenamiento difiere
        const { data, error } = await supabase
            .from('price_history')
            .select('*')
            .eq('product_id', productId);

        if (error) {
            console.error("Error en consulta price_history:", error);
            content.innerHTML = `<div style="padding:1rem; text-align:center; color:var(--accent-red); background:rgba(239,68,68,0.1); border-radius:8px;">⚠️ Error al consultar tabla 'price_history':<br><small>${escHtml(error.message)}</small></div>`;
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
                <td>${escHtml(r.changed_by) || 'Sistema'}</td>
                <td class="text-dim">${escHtml(r.notes) || "—"}</td>
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
        const response = await fetch('/api/products/categories');
        const data = await response.json();
        adminCategories = data || [];
        const tbody = document.getElementById("categories-tbody");
        if (!tbody) return;
        tbody.innerHTML = "";
        (data || []).forEach(cat => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${cat.id}</td>
                <td>${escHtml(cat.name)}</td>
                <td>-</td>
                <td>
                    <button class="btn-outline btn-sm" onclick="editCategory(${cat.id})">Editar</button>
                    <button class="btn-danger btn-sm" onclick="deleteCategory(${cat.id})">Eliminar</button>
                </td>`;
            tbody.appendChild(tr);
        });
    } catch (e) { console.error(e); }
}

async function addCategory() {
    const name = document.getElementById("new-category-name").value.trim();
    if (!name) return showToast("Ingresa un nombre", "error");
    if (adminCategories.some(c => (c.name || '').trim().toLowerCase() === name.toLowerCase())) {
        return showToast("Ya existe una categoría con ese nombre", "error");
    }
    try {
        const { error } = await supabase.from('categories').insert({ name });
        if (error) throw error;
        document.getElementById("new-category-name").value = "";
        showToast("Categoría creada");
        await loadCategories();
    } catch (e) {
        showToast(e?.message || "Error al crear categoría", "error");
    }
}

function editCategory(id) {
    const currentName = adminCategories.find(c => c.id === id)?.name || '';
    const newName = prompt("Nuevo nombre:", currentName)?.trim();
    if (!newName || newName === currentName) return;
    supabase.from('categories').update({ name: newName }).eq('id', id)
        .then(({ error }) => {
            if (error) throw error;
            showToast("Categoría actualizada");
            loadCategories();
        })
        .catch(err => showToast(err?.message || "Error", "error"));
}

function deleteCategory(id) {
    if (!confirm("¿Eliminar categoría? Los productos pasarán a 'Sin categoría'.")) return;
    // Antes se movían a category_id = 1 asumiendo que era "Sin categoría" (así era en Supabase), pero en la
    // BD local la categoría 1 es una categoría real: los productos terminaban en otra categoría.
    supabase.from('products').update({ category_id: null }).eq('category_id', id)
        .then(({ error }) => {
            if (error) throw error;
            return supabase.from('categories').delete().eq('id', id);
        })
        .then(({ error }) => {
            if (error) throw error;
            showToast("Categoría eliminada");
            loadCategories();
            loadAdminProducts();
        })
        .catch(err => showToast(err.message, "error"));
}



// ─── Catálogo de reparaciones: Tipo de equipo → Marcas y Fallas ─────────
let catalog = { types: [], brands: [], unassignedBrands: [], generalFaults: [] };
let selectedTypeId = null;

async function catalogRequest(method, url, body) {
    const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de conexión');
    return data;
}

async function loadConfigLists() {
    try {
        catalog = await catalogRequest('GET', '/api/admin/catalog');
        if (!catalog.types.some(t => t.id === selectedTypeId)) selectedTypeId = catalog.types[0]?.id ?? null;
        renderCatalog();
    } catch (e) {
        console.error(e);
        showToast("Error cargando el catálogo: " + e.message, "error");
    }
}

function renderCatalog() {
    const list = document.getElementById("catalog-type-list");
    if (!list) return;

    list.innerHTML = catalog.types.length ? catalog.types.map(t => `
        <button type="button" class="catalog-type ${t.id === selectedTypeId ? 'active' : ''}" data-type-id="${t.id}">
            <span class="catalog-type-name">${escHtml(t.name)}</span>
            <span class="catalog-type-meta">${t.brands.length} marca${t.brands.length === 1 ? '' : 's'} · ${t.faults.length} falla${t.faults.length === 1 ? '' : 's'}</span>
        </button>`).join('')
        : '<p class="catalog-empty">Aún no hay tipos de equipo. Agrega el primero (ej. Celular, Laptop, Impresora).</p>';

    renderCatalogDetail();

    document.getElementById("general-fault-chips").innerHTML = chipsHtml(catalog.generalFaults, 'fault', 'Sin fallas generales');

    const unassignedPanel = document.getElementById("unassigned-brands-panel");
    unassignedPanel?.classList.toggle("hidden", catalog.unassignedBrands.length === 0);
    const selected = catalog.types.find(t => t.id === selectedTypeId);
    document.getElementById("unassigned-brand-chips").innerHTML = catalog.unassignedBrands.map(b => `
        <span class="catalog-chip">
            ${escHtml(b.name)}
            ${selected ? `<button type="button" class="chip-action" data-assign-brand="${escHtml(b.name)}" title="Asignar a ${escHtml(selected.name)}">+ ${escHtml(selected.name)}</button>` : ''}
            <button type="button" class="chip-remove" data-delete-brand="${b.id}" title="Eliminar marca">×</button>
        </span>`).join('');
}

function chipsHtml(items, kind, emptyText) {
    if (!items.length) return `<span class="catalog-empty">${emptyText}</span>`;
    return items.map(it => `<span class="catalog-chip">${escHtml(it.name)}<button type="button" class="chip-remove" data-remove-${kind}="${it.id}" title="Quitar">×</button></span>`).join('');
}

function renderCatalogDetail() {
    const detail = document.getElementById("catalog-detail");
    if (!detail) return;
    const type = catalog.types.find(t => t.id === selectedTypeId);
    if (!type) {
        detail.innerHTML = '<div class="catalog-detail-empty">Selecciona o crea un tipo de equipo para configurar sus marcas y fallas.</div>';
        return;
    }
    const otherBrands = catalog.brands.filter(b => !type.brands.some(tb => tb.id === b.id));
    detail.innerHTML = `
        <div class="catalog-detail-head">
            <div>
                <div class="catalog-hint">Tipo de equipo</div>
                <h3>${escHtml(type.name)}</h3>
            </div>
            <div class="catalog-detail-actions">
                <button type="button" class="btn-outline btn-sm" id="rename-type-btn">Renombrar</button>
                <button type="button" class="btn-danger btn-sm" id="delete-type-btn">Eliminar</button>
            </div>
        </div>
        <div class="catalog-detail-cols">
            <div>
                <div class="catalog-panel-title">Marcas <span class="catalog-hint">${type.brands.length}</span></div>
                <form class="catalog-add" id="add-type-brand-form">
                    <input type="text" id="new-type-brand-input" list="catalog-all-brands" placeholder="Ej. Samsung" autocomplete="off">
                    <datalist id="catalog-all-brands">${otherBrands.map(b => `<option value="${escHtml(b.name)}">`).join('')}</datalist>
                    <button type="submit">Añadir</button>
                </form>
                <div class="catalog-chips">${chipsHtml(type.brands, 'brand', 'Sin marcas: se sugerirán todas las marcas')}</div>
            </div>
            <div>
                <div class="catalog-panel-title">Fallas comunes <span class="catalog-hint">${type.faults.length} propias + ${catalog.generalFaults.length} generales</span></div>
                <form class="catalog-add" id="add-type-fault-form">
                    <input type="text" id="new-type-fault-input" placeholder="Ej. Pantalla rota" autocomplete="off">
                    <button type="submit">Añadir</button>
                </form>
                <div class="catalog-chips">${chipsHtml(type.faults, 'fault', 'Sin fallas propias')}</div>
            </div>
        </div>`;
}

async function catalogAction(fn, okMsg) {
    try {
        await fn();
        if (okMsg) showToast(okMsg);
        await loadConfigLists();
    } catch (e) {
        showToast(e.message || "Error", "error");
    }
}

function bindCatalogEvents() {
    const root = document.getElementById("admin-config");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";

    root.addEventListener("submit", e => {
        e.preventDefault();
        const form = e.target;
        const input = form.querySelector("input[type=text]");
        const name = input?.value.trim();
        if (!name) return showToast("Escribe un nombre", "error");

        if (form.id === "add-equipment-form") {
            catalogAction(async () => {
                const r = await catalogRequest('POST', '/api/admin/equipment-types', { name });
                selectedTypeId = r.id;
            }, "Tipo de equipo agregado");
        } else if (form.id === "add-type-brand-form") {
            catalogAction(() => catalogRequest('POST', `/api/admin/equipment-types/${selectedTypeId}/brands`, { name }), "Marca agregada")
                .then(() => document.getElementById("new-type-brand-input")?.focus());
        } else if (form.id === "add-type-fault-form") {
            catalogAction(() => catalogRequest('POST', '/api/admin/faults', { name, equipment_type_id: selectedTypeId }), "Falla agregada")
                .then(() => document.getElementById("new-type-fault-input")?.focus());
        } else if (form.id === "add-general-fault-form") {
            catalogAction(() => catalogRequest('POST', '/api/admin/faults', { name }), "Falla general agregada");
        }
        input.value = "";
    });

    root.addEventListener("click", e => {
        const typeBtn = e.target.closest("[data-type-id]");
        if (typeBtn) {
            selectedTypeId = Number(typeBtn.dataset.typeId);
            renderCatalog();
            return;
        }
        const el = e.target.closest("button");
        if (!el) return;
        const type = catalog.types.find(t => t.id === selectedTypeId);

        if (el.dataset.removeBrand) {
            catalogAction(() => catalogRequest('DELETE', `/api/admin/equipment-types/${selectedTypeId}/brands/${el.dataset.removeBrand}`), "Marca quitada");
        } else if (el.dataset.removeFault) {
            catalogAction(() => catalogRequest('DELETE', `/api/admin/faults/${el.dataset.removeFault}`), "Falla eliminada");
        } else if (el.dataset.assignBrand && selectedTypeId) {
            catalogAction(() => catalogRequest('POST', `/api/admin/equipment-types/${selectedTypeId}/brands`, { name: el.dataset.assignBrand }), "Marca asignada");
        } else if (el.dataset.deleteBrand) {
            if (!confirm("¿Eliminar esta marca del catálogo?")) return;
            catalogAction(() => catalogRequest('DELETE', `/api/admin/brands/${el.dataset.deleteBrand}`), "Marca eliminada");
        } else if (el.id === "rename-type-btn" && type) {
            const name = prompt("Nuevo nombre del tipo de equipo:", type.name)?.trim();
            if (name && name !== type.name) catalogAction(() => catalogRequest('PUT', `/api/admin/equipment-types/${type.id}`, { name }), "Tipo renombrado");
        } else if (el.id === "delete-type-btn" && type) {
            if (!confirm(`¿Eliminar "${type.name}" con sus ${type.faults.length} fallas propias?\nLas marcas que también estén en otros tipos se conservan. Las reparaciones ya registradas no cambian.`)) return;
            catalogAction(() => catalogRequest('DELETE', `/api/admin/equipment-types/${type.id}`), "Tipo de equipo eliminado");
        }
    });
}

// ─── Caja y Retiros ─────────────────────────
let cashState = { events: [], withdrawals: [], earned: 0, withdrawn: 0, available: 0, monthly: [] };

function currentOperator() {
    const session = getSession();
    return session?.profile?.username || 'admin';
}

function monthKey(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    const label = new Date(y, m - 1, 1).toLocaleDateString('es-PE', { month: 'short', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
}

async function loadCashView() {
    if (!document.getElementById("admin-cash")) return;
    try {
        const [rawRes, cashRes] = await Promise.all([fetch('/api/dashboard/raw'), fetch('/api/cash')]);
        const raw = await rawRes.json();
        const all = await cashRes.json();
        if (!rawRes.ok || !cashRes.ok) throw new Error(raw.error || all.error);

        const events = buildProfitEvents(raw);
        const active = all.filter(w => w.status === 'ACTIVO');
        const earned = sumBy(events, 'profit');
        const withdrawn = sumBy(active, 'amount');

        // Resumen mensual con disponible acumulado (de más antiguo a más reciente)
        const byMonth = new Map();
        const bucket = key => {
            if (!byMonth.has(key)) byMonth.set(key, { key, earned: 0, withdrawn: 0 });
            return byMonth.get(key);
        };
        events.forEach(ev => { const k = monthKey(ev.date); if (k) bucket(k).earned = safeAdd(bucket(k).earned, ev.profit); });
        active.forEach(w => { const k = monthKey(w.created_at); if (k) bucket(k).withdrawn = safeAdd(bucket(k).withdrawn, w.amount); });
        let running = 0;
        const monthly = [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)).map(m => {
            running = safeAdd(running, safeSubtract(m.earned, m.withdrawn));
            return { ...m, kept: safeSubtract(m.earned, m.withdrawn), cumulative: running };
        });

        cashState = { events, withdrawals: all, earned, withdrawn, available: safeSubtract(earned, withdrawn), monthly };
        renderCashView();
    } catch (e) {
        console.error(e);
        showToast("Error cargando caja: " + (e.message || ''), "error");
    }
}

function renderCashView() {
    const { events, withdrawals, earned, withdrawn, available, monthly } = cashState;
    const active = withdrawals.filter(w => w.status === 'ACTIVO');
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

    set("cash-kpi-earned", fmt(earned));
    set("cash-kpi-withdrawn", fmt(withdrawn));
    set("cash-kpi-withdrawn-count", `${active.length} retiro${active.length === 1 ? '' : 's'}`);
    set("cash-kpi-available", fmt(available));
    document.getElementById("cash-kpi-available")?.classList.toggle("cash-negative", available < 0);
    const pct = earned > 0 ? Math.min(100, Math.max(0, (withdrawn / earned) * 100)) : 0;
    const bar = document.getElementById("cash-progress-bar");
    if (bar) bar.style.width = `${100 - pct}%`;
    set("cash-kpi-available-pct", earned > 0 ? `Retiraste el ${pct.toFixed(0)}% de lo ganado` : 'Aún no hay ganancia registrada');

    const thisMonth = monthKey(new Date().toISOString());
    const m = monthly.find(x => x.key === thisMonth) || { earned: 0, withdrawn: 0 };
    set("cash-kpi-month-label", `Este mes (${monthLabel(thisMonth)})`);
    set("cash-kpi-month-earned", fmt(m.earned));
    set("cash-kpi-month-withdrawn", `Retirado: ${fmt(m.withdrawn)}`);

    // Por medio de pago
    const methodsBody = document.querySelector("#cash-methods-table tbody");
    if (methodsBody) {
        methodsBody.innerHTML = PAYMENT_METHODS.map(method => {
            const cobrado = sumBy(events.filter(e => e.method === method), 'income');
            const retirado = sumBy(active.filter(w => w.source === method), 'amount');
            const neto = safeSubtract(cobrado, retirado);
            return `<tr><td>${method === 'Transferencia' ? 'Transferencia / Banco' : method}</td><td class="num">${fmt(cobrado)}</td>
                <td class="num cash-out">${retirado ? '-' + fmt(retirado) : fmt(0)}</td><td class="num ${neto < 0 ? 'cash-negative' : ''}"><strong>${fmt(neto)}</strong></td></tr>`;
        }).join('');
    }

    // Mensual (más reciente arriba, últimos 12)
    const monthlyBody = document.querySelector("#cash-monthly-table tbody");
    if (monthlyBody) {
        const rows = [...monthly].reverse().slice(0, 12);
        monthlyBody.innerHTML = rows.length ? rows.map(r => `<tr><td>${monthLabel(r.key)}</td><td class="num">${fmt(r.earned)}</td>
            <td class="num cash-out">${r.withdrawn ? '-' + fmt(r.withdrawn) : fmt(0)}</td>
            <td class="num ${r.kept < 0 ? 'cash-negative' : ''}">${fmt(r.kept)}</td><td class="num"><strong>${fmt(r.cumulative)}</strong></td></tr>`).join('')
            : '<tr><td colspan="5" class="cash-empty">Sin movimientos todavía</td></tr>';
    }

    renderCashHistory();
    updateCashPreview();
    if (document.getElementById("admin-cash")?.classList.contains("active")) renderCashChart();
}

function renderCashHistory() {
    const body = document.querySelector("#cash-history-table tbody");
    if (!body) return;
    const showVoided = document.getElementById("cash-show-voided")?.checked;
    const rows = cashState.withdrawals.filter(w => showVoided || w.status === 'ACTIVO');
    body.innerHTML = rows.length ? rows.map(w => {
        const date = new Date(w.created_at).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const voided = w.status === 'ANULADO';
        return `<tr class="${voided ? 'cash-voided' : ''}">
            <td>${date}</td>
            <td class="num"><strong>${fmt(w.amount)}</strong></td>
            <td>${escHtml(w.source)}</td>
            <td>${escHtml(w.reason)}</td>
            <td>${escHtml(w.notes || '—')}${voided ? `<div class="cash-void-note">Anulado por ${escHtml(w.voided_by || '-')}${w.void_reason ? ': ' + escHtml(w.void_reason) : ''}</div>` : ''}</td>
            <td>${escHtml(w.operator_name)}</td>
            <td>${voided ? '<span class="cash-badge">Anulado</span>' : `<button type="button" class="btn-outline btn-sm" data-void-withdrawal="${w.id}">Anular</button>`}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="7" class="cash-empty">No hay retiros registrados</td></tr>';
}

function renderCashChart() {
    const Chart = window.Chart;
    const canvas = document.getElementById("cash-monthly-chart");
    if (!Chart || !canvas) return;
    Chart.getChart(canvas)?.destroy();
    const rows = cashState.monthly.slice(-12);
    const chart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: rows.map(r => monthLabel(r.key)),
            datasets: [
                { label: 'Ganancia', data: rows.map(r => r.earned), backgroundColor: 'rgba(74, 222, 128, 0.6)', borderRadius: 4 },
                { label: 'Retirado', data: rows.map(r => r.withdrawn), backgroundColor: 'rgba(251, 191, 36, 0.6)', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#8a95b0' } } },
            scales: {
                y: { ticks: { color: '#8a95b0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { ticks: { color: '#8a95b0' }, grid: { display: false } }
            }
        }
    });
    chartInstances.push(chart);
}

function updateCashPreview() {
    const preview = document.getElementById("cash-preview");
    if (!preview) return;
    const amount = parseFloat(document.getElementById("cash-amount")?.value) || 0;
    const source = document.getElementById("cash-source")?.value;
    const after = safeSubtract(cashState.available, amount);
    const sourceNet = safeSubtract(
        sumBy(cashState.events.filter(e => e.method === source), 'income'),
        sumBy(cashState.withdrawals.filter(w => w.status === 'ACTIVO' && w.source === source), 'amount')
    );
    let warn = '';
    if (amount > 0 && after < 0) warn = `<div class="cash-warn">⚠️ Supera la ganancia disponible en ${fmt(-after)}. Estarías retirando capital del negocio.</div>`;
    else if (amount > 0 && amount > sourceNet) warn = `<div class="cash-warn">⚠️ Es más de lo cobrado neto por ${escHtml(source)} (${fmt(sourceNet)}).</div>`;
    preview.innerHTML = `Disponible después del retiro: <strong class="${after < 0 ? 'cash-negative' : ''}">${fmt(after)}</strong>${warn}`;
}

async function submitWithdrawal(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById("cash-amount")?.value) || 0;
    const source = document.getElementById("cash-source")?.value;
    const reason = document.getElementById("cash-reason")?.value;
    const notes = document.getElementById("cash-notes")?.value || '';
    if (amount <= 0) return showToast("Ingresa un monto mayor a 0", "error");

    const after = safeSubtract(cashState.available, amount);
    const msg = after < 0
        ? `El retiro de ${fmt(amount)} supera la ganancia disponible (${fmt(cashState.available)}).\n¿Registrarlo de todas formas?`
        : `¿Registrar retiro de ${fmt(amount)} desde ${source}?\nMotivo: ${reason}\nDisponible después: ${fmt(after)}`;
    if (!confirm(msg)) return;

    const btn = document.getElementById("cash-submit-btn");
    if (btn) btn.disabled = true;
    try {
        const res = await fetch('/api/cash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount, source, reason, notes, operator_name: currentOperator() })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Error de conexión');
        document.getElementById("cash-amount").value = '';
        document.getElementById("cash-notes").value = '';
        showToast(`Retiro de ${fmt(amount)} registrado`);
        await loadCashView();
    } catch (err) {
        showToast("No se pudo registrar el retiro: " + err.message, "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function voidWithdrawal(id) {
    const w = cashState.withdrawals.find(x => x.id === id);
    if (!w) return;
    const reason = prompt(`Anular retiro de ${fmt(w.amount)} (${w.reason}).\nEl registro se conserva marcado como anulado.\n\nMotivo de la anulación:`);
    if (reason === null) return;
    try {
        const res = await fetch(`/api/cash/${id}/void`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ void_reason: reason, operator_name: currentOperator() })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Error de conexión');
        showToast("Retiro anulado");
        await loadCashView();
    } catch (err) {
        showToast("No se pudo anular: " + err.message, "error");
    }
}

function bindCashEvents() {
    const root = document.getElementById("admin-cash");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";
    document.getElementById("cash-withdraw-form")?.addEventListener("submit", submitWithdrawal);
    document.getElementById("cash-amount")?.addEventListener("input", updateCashPreview);
    document.getElementById("cash-source")?.addEventListener("change", updateCashPreview);
    document.getElementById("cash-show-voided")?.addEventListener("change", renderCashHistory);
    root.addEventListener("click", e => {
        const btn = e.target.closest("[data-void-withdrawal]");
        if (btn) voidWithdrawal(Number(btn.dataset.voidWithdrawal));
    });
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
    const costRaw = document.getElementById("new-product-cost").value.trim();
    const priceRaw = document.getElementById("new-product-price").value.trim();
    const stockRaw = document.getElementById("new-product-stock").value.trim();
    const minRaw = document.getElementById("new-product-min").value.trim();
    const cost = Number(costRaw);
    const price = Number(priceRaw);
    // Number() y no parseInt(): parseInt("2.5") daba 2 y parseInt("1e3") daba 1 sin avisar.
    // Tampoco "|| 5": un stock mínimo de 0 se convertía en 5.
    const stock = stockRaw === '' ? 0 : Number(stockRaw);
    const minStock = minRaw === '' ? 5 : Number(minRaw);
    const isFav = document.getElementById("new-product-fav").checked;

    if (!name || !categoryId || costRaw === '' || priceRaw === '' || isNaN(cost) || isNaN(price)) {
        showToast("Completa los campos obligatorios (*)", "error"); return;
    }
    if (name.length > 150) { showToast("El nombre es demasiado largo (máx. 150 caracteres)", "error"); return; }
    if (cost < 0 || price < 0) { showToast("Los precios no pueden ser negativos", "error"); return; }
    if (price < cost) { showToast("⚠️ El precio de venta no debe ser menor que el costo", "error"); return; }
    if (!Number.isInteger(stock) || stock < 0) { showToast("El stock inicial debe ser un número entero ≥ 0", "error"); return; }
    if (!Number.isInteger(minStock) || minStock < 0) { showToast("El stock mínimo debe ser un número entero ≥ 0", "error"); return; }

    const duplicate = adminAllProducts.find(p => (p.name || '').trim().toLowerCase() === name.toLowerCase()
        && (p.brand || '').trim().toLowerCase() === brand.toLowerCase());
    if (duplicate && !confirm(`Ya existe un producto "${duplicate.name}" (código ${duplicate.code}). ¿Crear otro igual de todas formas?`)) {
        return;
    }

    // Evitar doble clic (antes creaba el producto dos veces o duplicaba el stock inicial en auditoría)
    const saveBtn = document.getElementById("save-new-product-btn");
    if (saveBtn?.disabled) return;
    if (saveBtn) saveBtn.disabled = true;

    try {
        const session = getSession();
        const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';
        // El código y el registro de stock inicial se generan en el servidor dentro de una transacción
        const response = await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name, brand, category_id: categoryId,
                cost_price: cost, sale_price: price,
                stock, min_stock: minStock, is_favorite: isFav,
                operator_name: operator
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.error || `Error del servidor (${response.status})`);

        document.getElementById("new-product-modal").classList.add("hidden");
        showToast(`Producto creado exitosamente (código ${result.data.code})`);
        ['new-product-name', 'new-product-brand', 'new-product-cost', 'new-product-price']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById("new-product-stock").value = "0";
        document.getElementById("new-product-min").value = "5";
        document.getElementById("new-product-fav").checked = false;
        await loadAdminProducts();
        await loadStockAudit();
    } catch (e) {
        showToast("No se pudo crear el producto: " + (e.message || "error de conexión"), "error");
    } finally {
        if (saveBtn) saveBtn.disabled = false;
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
        const response = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: getSession()?.profile?.id || getSession()?.user?.id, new_password: newPwd })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Error de conexión");
        fb.textContent = "✅ Contraseña actualizada correctamente";
        fb.classList.add("success");
        document.getElementById("new-password").value = "";
        document.getElementById("confirm-password").value = "";
    } catch (e) {
        fb.textContent = e.message || "Error de conexión";
        fb.classList.add("error");
    }
}

// ─── Copia de Seguridad ─────────────────────
function setBackupFeedback(msg, type) {
    const fb = document.getElementById("backup-feedback");
    if (!fb) return;
    fb.className = `feedback-msg ${type || ''}`;
    fb.textContent = msg;
    fb.classList.remove("hidden");
}

async function exportBackup() {
    const btn = document.getElementById("export-backup-btn");
    if (btn) btn.disabled = true;
    try {
        const response = await fetch('/api/backup/export');
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Error del servidor (${response.status})`);
        }
        const disposition = response.headers.get('Content-Disposition') || '';
        const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || 'inventario-backup.json';
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setBackupFeedback(`✅ Backup generado: ${fileName}`, "success");
    } catch (e) {
        setBackupFeedback("❌ No se pudo exportar: " + e.message, "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function importBackup(file) {
    let backup;
    try {
        backup = JSON.parse(await file.text());
    } catch {
        setBackupFeedback("❌ El archivo no es un JSON válido", "error");
        return;
    }
    if (backup?.format !== 'inventario-juan-backup' || !backup.tables) {
        setBackupFeedback("❌ El archivo no es un backup de Inventario Juan", "error");
        return;
    }

    const count = (t) => Array.isArray(backup.tables[t]) ? backup.tables[t].length : 0;
    const fecha = backup.exported_at ? new Date(backup.exported_at).toLocaleString('es-PE') : 'desconocida';
    if (!confirm(`⚠️ Restaurar backup del ${fecha}\n\n` +
        `• ${count('products')} productos\n• ${count('sales')} ventas\n• ${count('repairs')} reparaciones\n\n` +
        `TODOS los datos actuales serán REEMPLAZADOS por los del archivo.\n` +
        `(Antes se guardará automáticamente una copia de los datos actuales en la carpeta "backups".)\n\n¿Continuar?`)) {
        return;
    }

    const btn = document.getElementById("import-backup-btn");
    if (btn) btn.disabled = true;
    setBackupFeedback("⏳ Importando...", "");
    try {
        const response = await fetch('/api/backup/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(backup)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.error || `Error del servidor (${response.status})`);

        setBackupFeedback(`✅ Backup restaurado. Copia previa guardada en: ${result.safety_copy}. Recargando...`, "success");
        // Los usuarios pueden haber cambiado: se cierra la sesión para volver a entrar con los datos restaurados
        clearSession();
        setTimeout(() => location.reload(), 2500);
    } catch (e) {
        setBackupFeedback("❌ " + e.message, "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ─── Eliminar Producto ──────────────────────
async function deleteProduct(id, name) {
    if (!confirm(`⚠️ ¿Estás seguro de que deseas ELIMINAR el producto "${name}"?\nSi ya tiene ventas, reparaciones o movimientos de stock, se archivará (dejará de aparecer) pero su historial se conservará.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/products/${id}`, { method: 'DELETE' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Error de conexión");

        showToast(result.archived
            ? `Producto "${name}" archivado (tiene historial, se conserva para los reportes)`
            : `Producto "${name}" eliminado exitosamente`);
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

// ═══ Cuadre Contable (Reportes) ═══
async function generateAccountingReport() {
    const period = document.getElementById("report-period").value;
    let startDate = new Date();
    let endDate = new Date();
    
    if (period === 'today') {
        startDate.setHours(0,0,0,0);
        endDate.setHours(23,59,59,999);
    } else if (period === 'yesterday') {
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(0,0,0,0);
        endDate.setDate(endDate.getDate() - 1);
        endDate.setHours(23,59,59,999);
    } else if (period === 'week') {
        const day = startDate.getDay() || 7; 
        startDate.setDate(startDate.getDate() - day + 1);
        startDate.setHours(0,0,0,0);
        endDate.setHours(23,59,59,999);
    } else if (period === 'month') {
        startDate.setDate(1);
        startDate.setHours(0,0,0,0);
        endDate.setHours(23,59,59,999);
    } else if (period === 'custom') {
        const from = document.getElementById("report-date-from").value;
        const to = document.getElementById("report-date-to").value;
        if (!from || !to) { showToast("Selecciona ambas fechas", "error"); return; }
        startDate = new Date(from + 'T00:00:00');
        endDate = new Date(to + 'T23:59:59');
    }

    const btn = document.getElementById("generate-report-btn");
    btn.innerHTML = "⏳ Generando...";
    btn.disabled = true;

    try {
        // Buffer de 2 días para la consulta SQL (evita problemas de Timezone en DB)
        const dbStart = new Date(startDate);
        dbStart.setDate(dbStart.getDate() - 2);
        const isoStart = dbStart.toISOString();

        const { data: productos } = await supabase.from('products').select('id, cost_price');
        const { data: allSales } = await supabase.from('sales').select('id, total_amount, created_at').gte('created_at', isoStart);
        const { data: allRepairs } = await supabase.from('repairs').select('*').or(`created_at.gte.${isoStart},delivered_at.gte.${isoStart}`);
        const { data: allReval } = await supabase.from('inventory_revaluations').select('*').gte('created_at', isoStart);

        const ventas = (allSales || []).filter(s => {
            const d = new Date(s.created_at);
            return d >= startDate && d <= endDate;
        });

        const saleIds = ventas.map(s => s.id);
        let itemsVenta = [];
        if (saleIds.length > 0) {
            // Dividir en chunks si hay demasiados, pero para un reporte típico in() está bien
            const { data: items } = await supabase.from('sale_items')
                .select('sale_id, product_id, product_name, quantity, unit_cost')
                .in('sale_id', saleIds);
            itemsVenta = items || [];
        }

        const reparaciones = allRepairs || [];
        const revalorizaciones = (allReval || []).filter(r => {
            const d = new Date(r.created_at);
            return d >= startDate && d <= endDate;
        });

        const mapaCostos = {};
        productos?.forEach(p => mapaCostos[p.id] = parseFloat(p.cost_price || 0));

        // 1. Ventas
        const filteredItems = itemsVenta;
        
        const totalIngresosVentas = (ventas || []).reduce((sum, s) => safeAdd(sum, parseFloat(s.total_amount || 0)), 0);
        let costoTotalVentas = 0;
        filteredItems.forEach(item => {
            const costoUnitario = item.unit_cost !== undefined && item.unit_cost !== null ? parseFloat(item.unit_cost) : (mapaCostos[item.product_id] || 0);
            costoTotalVentas = safeAdd(costoTotalVentas, safeMultiply(costoUnitario, item.quantity || 0));
        });
        const gananciaVentas = safeSubtract(totalIngresosVentas, costoTotalVentas);

        // 2. Revalorizaciones
        const gananciaInversion = (revalorizaciones || []).reduce((sum, r) => safeAdd(sum, parseFloat(r.revaluation_profit || 0)), 0);

        // 3. Reparaciones
        let ingresosReparaciones = 0;
        let costosReparaciones = 0;
        const returnedStatuses = ['NO REPARADO', 'NO_REPARADO', 'NO REPARABLE', 'DEVUELTO', 'CANCELADO', 'RECHAZADO'];

        (reparaciones || []).forEach(r => {
            const isReturned = returnedStatuses.includes(String(r.status || '').toUpperCase());
            const advance = parseFloat(r.advance_payment || 0);
            const total = parseFloat(r.total_amount || 0);
            const partsCost = parseFloat(r.internal_parts_cost || 0);
            const extCost = parseFloat(r.internal_external_cost || 0);
            const totalInsumos = safeAdd(partsCost, extCost);

            const cDate = new Date(r.created_at);
            if (cDate >= startDate && cDate <= endDate) {
                ingresosReparaciones = safeAdd(ingresosReparaciones, isReturned ? 0 : advance);
                costosReparaciones = safeAdd(costosReparaciones, totalInsumos);
            }

            if (r.status === 'ENTREGADO' && !isReturned) {
                const dDate = new Date(r.delivered_at || r.updated_at || r.created_at);
                if (dDate >= startDate && dDate <= endDate) {
                    ingresosReparaciones = safeAdd(ingresosReparaciones, Math.max(0, safeSubtract(total, advance)));
                }
            }
        });
        const gananciaReparaciones = safeSubtract(ingresosReparaciones, costosReparaciones);

        // --- LÓGICA DE DESGLOSE (ESTADO DE CUENTA) ---
        const durationDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
        let breakdownHTML = '';

        if (durationDays <= 1) {
            // Desglose Diario: Transacción por transacción
            let salesRows = '';
            ventas.forEach(v => {
                const saleTime = new Date(v.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
                const vItems = filteredItems.filter(i => i.sale_id === v.id);
                let vCost = 0;
                let desc = [];
                vItems.forEach(i => {
                    const c = i.unit_cost !== undefined && i.unit_cost !== null ? parseFloat(i.unit_cost) : (mapaCostos[i.product_id] || 0);
                    vCost += c * parseInt(i.quantity || 0);
                    desc.push(`${i.quantity}x ${i.product_name}`);
                });
                const vTotal = parseFloat(v.total_amount || 0);
                const vProfit = vTotal - vCost;
                salesRows += `<tr>
                    <td>${saleTime}</td>
                    <td><div style="max-width:200px; white-space:normal; font-size:11px;">${desc.join(', ')}</div></td>
                    <td style="text-align:right">${fmt(vTotal)}</td>
                    <td style="text-align:right; color:red;">${fmt(vCost)}</td>
                    <td style="text-align:right; font-weight:bold;">${fmt(vProfit)}</td>
                </tr>`;
            });

            breakdownHTML = `
                <div class="print-card">
                    <h3>Detalle de Ventas del Día</h3>
                    <table class="print-table">
                        <thead>
                            <tr><th>Hora</th><th>Items Vendidos</th><th style="text-align:right">Ingreso</th><th style="text-align:right">Costo</th><th style="text-align:right">Ganancia</th></tr>
                        </thead>
                        <tbody>
                            ${salesRows || '<tr><td colspan="5" style="text-align:center">No hay ventas registradas en este día.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
        } else if (durationDays > 1 && durationDays <= 31 && period !== 'month') {
            // Desglose Semanal/Personalizado Corto: Agrupado por Día
            const dailyData = {};
            for(let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                dailyData[d.toLocaleDateString('es-PE')] = { i: 0, c: 0, gt: 0 };
            }

            ventas.forEach(v => {
                const k = new Date(v.created_at).toLocaleDateString('es-PE');
                if(!dailyData[k]) dailyData[k] = { i: 0, c: 0, gt: 0 };
                const vItems = filteredItems.filter(i => i.sale_id === v.id);
                let vCost = 0;
                vItems.forEach(i => {
                    const c = i.unit_cost !== undefined && i.unit_cost !== null ? parseFloat(i.unit_cost) : (mapaCostos[i.product_id] || 0);
                    vCost += c * parseInt(i.quantity || 0);
                });
                dailyData[k].i += parseFloat(v.total_amount || 0);
                dailyData[k].c += vCost;
            });

            reparaciones.forEach(r => {
                const isReturned = returnedStatuses.includes(String(r.status || '').toUpperCase());
                const advance = parseFloat(r.advance_payment || 0);
                const total = parseFloat(r.total_amount || 0);
                const partsCost = parseFloat(r.internal_parts_cost || 0);
                const extCost = parseFloat(r.internal_external_cost || 0);
                const totalInsumos = partsCost + extCost;

                const cDate = new Date(r.created_at);
                if (cDate >= startDate && cDate <= endDate) {
                    const k = cDate.toLocaleDateString('es-PE');
                    if(!dailyData[k]) dailyData[k] = { i: 0, c: 0, gt: 0 };
                    dailyData[k].gt += (isReturned ? 0 : advance) - totalInsumos;
                }
                if (r.status === 'ENTREGADO' && !isReturned) {
                    const dDate = new Date(r.delivered_at || r.updated_at || r.created_at);
                    if (dDate >= startDate && dDate <= endDate) {
                        const k = dDate.toLocaleDateString('es-PE');
                        if(!dailyData[k]) dailyData[k] = { i: 0, c: 0, gt: 0 };
                        dailyData[k].gt += Math.max(0, total - advance);
                    }
                }
            });

            let dailyRows = '';
            Object.keys(dailyData).forEach(k => {
                const day = dailyData[k];
                const ganVentas = day.i - day.c;
                if (day.i === 0 && day.c === 0 && day.gt === 0) return;
                dailyRows += `<tr>
                    <td>${k}</td>
                    <td style="text-align:right">${fmt(day.i)}</td>
                    <td style="text-align:right; color:red;">${fmt(day.c)}</td>
                    <td style="text-align:right; font-weight:bold;">${fmt(ganVentas)}</td>
                    <td style="text-align:right; font-weight:bold;">${fmt(day.gt)}</td>
                    <td style="text-align:right; font-weight:bold; color:#000;">${fmt(ganVentas + day.gt)}</td>
                </tr>`;
            });

            breakdownHTML = `
                <div class="print-card">
                    <h3>Desglose Diario de Movimientos</h3>
                    <table class="print-table">
                        <thead>
                            <tr><th>Fecha</th><th style="text-align:right">Ing. Ventas</th><th style="text-align:right">Cost. Ventas</th><th style="text-align:right">Gan. Ventas</th><th style="text-align:right">Gan. Taller</th><th style="text-align:right">Total Neto Día</th></tr>
                        </thead>
                        <tbody>
                            ${dailyRows || '<tr><td colspan="6" style="text-align:center">No hay movimientos en este periodo.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
        } else {
            // Desglose Mensual/Largo: Agrupado por Semana
            const weeklyData = { 'Semana 1': { i:0, c:0, gt:0 }, 'Semana 2': { i:0, c:0, gt:0 }, 'Semana 3': { i:0, c:0, gt:0 }, 'Semana 4': { i:0, c:0, gt:0 }, 'Semana 5': { i:0, c:0, gt:0 } };
            
            const getWeekKey = (date) => {
                const dayOfMonth = date.getDate();
                const w = Math.ceil(dayOfMonth / 7);
                return `Semana ${w > 5 ? 5 : w}`;
            };

            ventas.forEach(v => {
                const d = new Date(v.created_at);
                const k = getWeekKey(d);
                const vItems = filteredItems.filter(i => i.sale_id === v.id);
                let vCost = 0;
                vItems.forEach(i => {
                    const c = i.unit_cost !== undefined && i.unit_cost !== null ? parseFloat(i.unit_cost) : (mapaCostos[i.product_id] || 0);
                    vCost += c * parseInt(i.quantity || 0);
                });
                weeklyData[k].i += parseFloat(v.total_amount || 0);
                weeklyData[k].c += vCost;
            });

            reparaciones.forEach(r => {
                const isReturned = returnedStatuses.includes(String(r.status || '').toUpperCase());
                const advance = parseFloat(r.advance_payment || 0);
                const total = parseFloat(r.total_amount || 0);
                const partsCost = parseFloat(r.internal_parts_cost || 0);
                const extCost = parseFloat(r.internal_external_cost || 0);
                const totalInsumos = partsCost + extCost;

                const cDate = new Date(r.created_at);
                if (cDate >= startDate && cDate <= endDate) {
                    weeklyData[getWeekKey(cDate)].gt += (isReturned ? 0 : advance) - totalInsumos;
                }
                if (r.status === 'ENTREGADO' && !isReturned) {
                    const dDate = new Date(r.delivered_at || r.updated_at || r.created_at);
                    if (dDate >= startDate && dDate <= endDate) {
                        weeklyData[getWeekKey(dDate)].gt += Math.max(0, total - advance);
                    }
                }
            });

            let weeklyRows = '';
            Object.keys(weeklyData).forEach(k => {
                const wk = weeklyData[k];
                const ganVentas = wk.i - wk.c;
                if (wk.i === 0 && wk.c === 0 && wk.gt === 0) return;
                weeklyRows += `<tr>
                    <td>${k}</td>
                    <td style="text-align:right">${fmt(wk.i)}</td>
                    <td style="text-align:right; color:red;">${fmt(wk.c)}</td>
                    <td style="text-align:right; font-weight:bold;">${fmt(ganVentas)}</td>
                    <td style="text-align:right; font-weight:bold;">${fmt(wk.gt)}</td>
                    <td style="text-align:right; font-weight:bold; color:#000;">${fmt(ganVentas + wk.gt)}</td>
                </tr>`;
            });

            breakdownHTML = `
                <div class="print-card">
                    <h3>Desglose Semanal</h3>
                    <table class="print-table">
                        <thead>
                            <tr><th>Semana</th><th style="text-align:right">Ing. Ventas</th><th style="text-align:right">Cost. Ventas</th><th style="text-align:right">Gan. Ventas</th><th style="text-align:right">Gan. Taller</th><th style="text-align:right">Total Neto Semana</th></tr>
                        </thead>
                        <tbody>
                            ${weeklyRows || '<tr><td colspan="6" style="text-align:center">No hay movimientos en este mes.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
        }

        // Generar HTML Print (con 'S/ ' quemado removido, solo usando fmt())
        const container = document.getElementById("print-report-container");
        container.innerHTML = `
            <div class="print-header">
                <h2>📊 Cuadre Contable</h2>
                <p>Periodo: ${startDate.toLocaleDateString('es-PE')} - ${endDate.toLocaleDateString('es-PE')}</p>
            </div>
            
            <div class="print-card">
                <h3>1. Flujo de Ventas (Global del Periodo)</h3>
                <table class="print-table">
                    <tr><td>Total Ingresos por Ventas</td><td style="text-align:right">${fmt(totalIngresosVentas)}</td></tr>
                    <tr><td>Costo de Mercadería Vendida</td><td style="text-align:right; color:red;">- ${fmt(costoTotalVentas)}</td></tr>
                    <tr><th>Ganancia Operativa Ventas</th><th style="text-align:right">${fmt(gananciaVentas)}</th></tr>
                </table>
            </div>

            <div class="print-card">
                <h3>2. Revalorización de Inventario (Inversión)</h3>
                <p style="font-size:12px; margin-bottom:10px;">Ganancia/pérdida generada por variación de costo en stock existente.</p>
                <table class="print-table">
                    <tr><th>Ganancia por Inversión</th><th style="text-align:right">${fmt(gananciaInversion)}</th></tr>
                </table>
            </div>

            <div class="print-card">
                <h3>3. Flujo de Taller (Reparaciones)</h3>
                <table class="print-table">
                    <tr><td>Ingresos Cobrados (Adelantos + Saldos Entregados)</td><td style="text-align:right">${fmt(ingresosReparaciones)}</td></tr>
                    <tr><td>Gastos en Insumos y Terceros</td><td style="text-align:right; color:red;">- ${fmt(costosReparaciones)}</td></tr>
                    <tr><th>Ganancia Neta Taller</th><th style="text-align:right">${fmt(gananciaReparaciones)}</th></tr>
                </table>
            </div>

            <div class="print-card" style="background:#f5f5f5;">
                <h2 style="margin:0; text-align:center;">GANANCIA TOTAL NETO: ${fmt(gananciaVentas + gananciaInversion + gananciaReparaciones)}</h2>
            </div>
            
            ${breakdownHTML}

            <div style="text-align:center; font-size:10px; margin-top:20px; color:#666;">
                Generado el ${new Date().toLocaleString('es-PE')} por ${getSession()?.profile?.username || 'Admin'}
            </div>
        `;

        window.print();

    } catch (e) {
        console.error(e);
        showToast("Error al generar reporte", "error");
    } finally {
        btn.innerHTML = `
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            Generar Cuadre PDF`;
        btn.disabled = false;
    }
}