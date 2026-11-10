import { supabase, getSession, clearSession, fmt, showToast } from './supabase.js';
import { safeAdd, safeSubtract, safeMultiply } from './math.js';
import { buildProfitEvents, sumBy, PAYMENT_METHODS } from './finance.js';
import { chartInstances } from './dashboard.js';
import { icon, money, parseDate, fmtDay, fmtTime, stagger } from './ui.js';
import { printHtml } from './receipts.js';
import { fetchMediaSummary, mediaCoverCellHtml, openMediaGallery } from './media.js';
import { bindDataTools } from './data_tools.js';

let adminAllProducts = [];
let adminSearchQuery = '';
let adminFilterCategoryId = '';
let allAuditRecords = [];
let adminCategories = [];
let adminLowStockOnly = false;
let adminNoPhotoOnly = false;
let productMedia = {}; // resumen de fotos/videos por producto

export async function loadAdminView(intent = null) {
    adminLowStockOnly = !!intent?.lowStock;
    // La vista se vuelve a dibujar con el buscador vacío: los filtros guardados también deben reiniciarse,
    // si no la lista salía "No se encontraron productos" con el buscador en blanco
    adminSearchQuery = '';
    adminFilterCategoryId = '';
    adminNoPhotoOnly = false;
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

// Los modales de producto viven en index.html (persisten entre vistas): se enlazan una sola vez.
// Los usan Administración e Inventario.
export function bindProductModals() {
    if (window._productModalsBound) return;
    window._productModalsBound = true;
    const closeNew = () => document.getElementById("new-product-modal").classList.add("hidden");
    document.getElementById("cancel-new-product-btn")?.addEventListener("click", closeNew);
    document.querySelectorAll('[data-close-new-product]').forEach(el => el.addEventListener('click', closeNew));
    document.getElementById("save-new-product-btn")?.addEventListener("click", saveNewProduct);
    ['new-product-name', 'new-product-brand', 'new-product-cost', 'new-product-price', 'new-product-stock', 'new-product-min']
        .forEach(id => document.getElementById(id)?.addEventListener('input', updateNewProductPreview));
    // Aumentar stock: cantidad rápida, precios opcionales y vista previa
    document.querySelectorAll('[data-add-qty]').forEach(btn => btn.addEventListener('click', () => {
        const input = document.getElementById('add-stock-amount');
        input.value = (parseInt(input.value) || 0) + parseInt(btn.dataset.addQty);
        input.dispatchEvent(new Event('input'));
    }));
    ['add-stock-amount', 'add-stock-new-cost', 'add-stock-new-price'].forEach(id => document.getElementById(id)?.addEventListener('input', updateAddStockPreview));
    document.getElementById('add-stock-update-prices')?.addEventListener('change', e => {
        document.getElementById('add-stock-price-fields')?.classList.toggle('hidden', !e.target.checked);
        updateAddStockPreview();
    });
    // Editar producto: vista previa en vivo y acceso al historial
    ['edit-product-name', 'edit-product-brand', 'edit-product-cost', 'edit-product-price'].forEach(id => document.getElementById(id)?.addEventListener('input', updateEditPreview));
    document.getElementById('ep-open-history')?.addEventListener('click', () => {
        const id = parseInt(document.getElementById('edit-product-id').value);
        if (id) openPriceHistory(id);
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !document.getElementById('new-product-modal')?.classList.contains('hidden')) closeNew();
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

    // Modal Editar Categoría
    document.getElementById("save-edit-category-btn")?.addEventListener("click", saveEditCategory);
    document.getElementById("edit-category-name")?.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); saveEditCategory(); }
    });
    document.getElementById("delete-category-modal-btn")?.addEventListener("click", () => {
        const id = parseInt(document.getElementById("edit-category-id")?.value || currentEditCategoryId);
        if (!id) return;
        document.getElementById("edit-category-modal")?.classList.add("hidden");
        deleteCategory(id);
    });

    // Modal Renombrar Tipo de Equipo
    document.getElementById("save-rename-type-btn")?.addEventListener("click", saveRenameType);
    document.getElementById("rename-type-name")?.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); saveRenameType(); }
    });

    // Modal Anular Retiro de Caja
    document.getElementById("confirm-void-withdrawal-btn")?.addEventListener("click", confirmVoidWithdrawal);
    document.getElementById("void-withdrawal-reason")?.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); confirmVoidWithdrawal(); }
    });
}

// Inventario comparte los productos con los modales de stock / edición
export function setAdminProducts(list) {
    adminAllProducts = list || [];
}

export { openNewProductModal, openAddStock, openEditProduct, openPriceHistory };

export function bindAdminEvents() {
    bindProductModals();
    document.getElementById("new-product-btn")?.addEventListener("click", openNewProductModal);
    document.getElementById("add-category-btn")?.addEventListener("click", addCategory);
    document.getElementById("new-category-name")?.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); addCategory(); }
    });
    bindCatalogEvents();
    bindCashEvents();
    document.getElementById("admin-low-stock-toggle")?.addEventListener("click", () => {
        adminLowStockOnly = !adminLowStockOnly;
        filterAdminProducts();
    });
    document.getElementById("admin-nofoto-toggle")?.addEventListener("click", () => {
        adminNoPhotoOnly = !adminNoPhotoOnly;
        filterAdminProducts();
    });
    document.getElementById("admin-products-tbody")?.addEventListener("click", e => {
        const b = e.target.closest("[data-gallery]");
        if (b) openProductGallery(parseInt(b.dataset.gallery));
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

    // Copia de seguridad por módulos, reinicio de datos, atajos express e impresora
    bindDataTools();

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
    document.querySelectorAll('#report-period-chips [data-rp]').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('#report-period-chips [data-rp]').forEach(b => b.classList.toggle('active', b === btn));
        const sel = document.getElementById("report-period");
        sel.value = btn.dataset.rp;
        document.getElementById("report-custom-dates").style.display = btn.dataset.rp === "custom" ? "flex" : "none";
        renderReportPreview();
    }));
    ['report-date-from', 'report-date-to'].forEach(id => document.getElementById(id)?.addEventListener('change', renderReportPreview));
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
    const pane = document.getElementById(tabId);
    pane?.classList.add("active");
    if (pane) stagger(pane.children, 0, 80, 600);
    if (tabId === "admin-cash") renderCashChart(); // el canvas necesita estar visible para medir su tamaño
    if (tabId === "admin-reports") renderReportPreview();
}

// ─── Productos ──────────────────────────────
async function loadAdminProducts() {
    try {
        const [response, media] = await Promise.all([fetch('/api/products'), fetchMediaSummary('product')]);
        const data = await response.json();
        adminAllProducts = data || [];
        productMedia = media;
        filterAdminProducts();
        populateAdminCategoryFilter();
        renderCategories();
        window.dispatchEvent(new CustomEvent('products:changed', { detail: adminAllProducts }));
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
        const matchNoPhoto = !adminNoPhotoOnly || !productMedia[p.id]?.n;
        return matchSearch && matchCategory && matchLowStock && matchNoPhoto;
    });
    // Con el filtro de stock bajo, lo más urgente primero (menor stock respecto al mínimo)
    if (adminLowStockOnly) filtered.sort((a, b) => (a.stock - a.min_stock) - (b.stock - b.min_stock));

    const toggle = document.getElementById("admin-low-stock-toggle");
    if (toggle) {
        toggle.classList.toggle("active", adminLowStockOnly);
        toggle.setAttribute("aria-pressed", String(adminLowStockOnly));
    }
    const noFoto = document.getElementById("admin-nofoto-toggle");
    if (noFoto) {
        noFoto.classList.toggle("active", adminNoPhotoOnly);
        noFoto.setAttribute("aria-pressed", String(adminNoPhotoOnly));
    }
    const noFotoCount = document.getElementById("admin-nofoto-count");
    if (noFotoCount) noFotoCount.textContent = adminAllProducts.filter(p => !productMedia[p.id]?.n).length;
    const count = document.getElementById("admin-low-stock-count");
    if (count) count.textContent = adminAllProducts.filter(isLowStock).length;

    renderAdminProductsTable(filtered);
}

function renderAdminProductsTable(products) {
    const body = document.getElementById("admin-products-tbody");
    if (!body) return;
    if (products.length === 0) {
        body.innerHTML = '<div class="ui-empty">No se encontraron productos</div>';
        return;
    }
    body.innerHTML = products.map(p => {
        const stock = parseInt(p.stock) || 0, min = parseInt(p.min_stock) || 0;
        const stockColor = stock === 0 ? 'var(--orange)' : stock <= min ? '#b08300' : 'var(--text)';
        return `<div class="ui-tr">
            <span>${mediaCoverCellHtml(productMedia[p.id], { attrs: `data-gallery="${p.id}"` })}</span>
            <span class="ui-cell-2"><span>${escHtml(p.name)}</span><small>Cód. ${escHtml(p.code)}</small></span>
            <span class="muted ellipsis">${escHtml(p.brand) || '—'}</span>
            <span><span class="ui-tag">${escHtml(p.category_name) || 'Sin categoría'}</span></span>
            <span class="r tnum muted">${money(p.cost_price)}</span>
            <span class="r tnum">${money(p.sale_price)}</span>
            <span class="r tnum" style="font-weight:500;color:${stockColor}">${stock}</span>
            <span class="r dimmed">${min}</span>
            <span class="adm-actions">
                <button class="ui-mini" title="Fotos y videos del producto" data-gallery="${p.id}">${icon('M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 13, 2.2)}Fotos</button>
                <button class="ui-mini" title="Añadir stock" onclick="openAddStock(${p.id})">+ Stock</button>
                <button class="ui-mini" title="Editar producto y precio" onclick="openEditProduct(${p.id})">Editar</button>
                <button class="ui-icon-btn xs" title="Historial de precios" onclick="openPriceHistory(${p.id})">${icon('history', 14, 2)}</button>
            </span>
        </div>`;
    }).join('');
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
    const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
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
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("add-stock-meta", [`Cód. ${p.code}`, p.category_name, p.brand].filter(Boolean).join(' · '));
    set("add-stock-product-name", p.name);
    set("add-stock-current", p.stock);
    set("add-stock-min", `/ mín. ${p.min_stock ?? 0}`);
    set("add-stock-cost-label", fmt(p.cost_price));
    set("add-stock-price-label", fmt(p.sale_price));
    document.getElementById("add-stock-amount").value = "1";
    document.getElementById("add-stock-notes").value = "";
    // Precios nuevos opcionales: solo se aplican con el interruptor activado
    const upd = document.getElementById("add-stock-update-prices");
    if (upd) upd.checked = false;
    document.getElementById("add-stock-price-fields")?.classList.add("hidden");
    document.getElementById("add-stock-new-cost").value = p.cost_price ?? "";
    document.getElementById("add-stock-new-price").value = p.sale_price ?? "";
    updateAddStockPreview();
    document.getElementById("add-stock-modal").classList.remove("hidden");
    setTimeout(() => document.getElementById("add-stock-amount")?.select(), 60);
}

function updateAddStockPreview() {
    const p = findAdminProduct(addStockProductId);
    if (!p) return;
    const qty = Math.max(0, parseInt(document.getElementById('add-stock-amount').value) || 0);
    const upd = document.getElementById('add-stock-update-prices')?.checked;
    const oldCost = parseFloat(p.cost_price) || 0, oldSale = parseFloat(p.sale_price) || 0;
    const unit = upd ? (parseFloat(document.getElementById('add-stock-new-cost').value) || oldCost) : oldCost;
    const price = upd ? (parseFloat(document.getElementById('add-stock-new-price').value) || oldSale) : oldSale;
    const stock = parseInt(p.stock) || 0, after = stock + qty;
    const rev = safeMultiply(safeSubtract(unit, oldCost), stock);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('as-pv-from', stock);
    set('as-pv-after', after);
    set('as-pv-buy', fmt(safeMultiply(unit, qty)));
    set('as-pv-unit', fmt(unit));
    set('as-pv-price', fmt(price));
    const target = Math.max(after, (parseInt(p.min_stock) || 0) * 3, 1);
    const bar = document.getElementById('as-pv-bar');
    if (bar) bar.style.width = `${Math.min(100, after / target * 100)}%`;
    document.getElementById('as-pv-rev-row')?.classList.toggle('hidden', !upd);
    const revEl = document.getElementById('as-pv-rev');
    if (revEl) { revEl.textContent = `${rev >= 0 ? '+' : '−'}${fmt(Math.abs(rev))}`; revEl.style.color = rev < 0 ? 'var(--yellow)' : 'var(--blue-soft)'; }
    set('save-add-stock-btn', qty === 1 ? 'Agregar 1 unidad' : `Agregar ${qty} unidades`);
}

async function confirmAddStock() {
    const productId = addStockProductId;
    const qtyRaw = document.getElementById("add-stock-amount").value.trim();
    const qty = Number(qtyRaw);
    const notes = document.getElementById("add-stock-notes").value.trim();
    const updatePrices = !!document.getElementById("add-stock-update-prices")?.checked;
    const newCostRaw = updatePrices ? document.getElementById("add-stock-new-cost").value.trim() : '';
    const newSaleRaw = updatePrices ? document.getElementById("add-stock-new-price").value.trim() : '';
    const session = getSession();
    const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';

    if (!productId) return;
    if (!qtyRaw || !Number.isInteger(qty) || qty <= 0) { showToast("Ingresa una cantidad entera mayor a 0", "error"); return; }

    // Evitar doble clic: dos ingresos simultáneos duplicaban el registro en auditoría
    const confirmBtn = document.getElementById("save-add-stock-btn");
    if (confirmBtn?.disabled) return;
    if (confirmBtn) confirmBtn.disabled = true;

    let updateData = {};
    // Los campos se precargan con los precios actuales: sin cambios no se registra historial
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
                showToast("Ingresa precios válidos mayores a S/ 0", "error"); return;
            }
            if (newSale < newCost + 0.5) {
                showToast("El precio de venta debe ser mayor al costo por al menos S/ 0.50", "error"); return;
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
            showToast("Error de base de datos: " + updErr.message, "error");
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
        showToast(priceUpdated ? `Stock +${qty} y precios actualizados` : `Stock actualizado · ahora hay ${newStock}`);
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

const MOVE_TAG = { VENTA: 'Venta', USO_EN_REPARACION: 'Taller', INGRESO_PROVEEDOR: 'Ingreso', AJUSTE_MERMA: 'Merma', DEVOLUCION_CLIENTE: 'Devolución' };

function renderStockAudit() {
    const body = document.getElementById("audit-tbody");
    if (!body) return;

    const filterProd = document.getElementById("audit-filter-product")?.value.toLowerCase().trim() || "";
    const filterOp = document.getElementById("audit-filter-operator")?.value.toLowerCase().trim() || "";
    const filterDate = document.getElementById("audit-filter-date")?.value || "";

    const filtered = allAuditRecords.filter(a => {
        if (filterProd && !(a.product_name || "").toLowerCase().includes(filterProd)) return false;
        if (filterOp && !(a.operator_name || "").toLowerCase().includes(filterOp)) return false;
        if (filterDate && (!a.created_at || localDateKey(parseDate(a.created_at)) !== filterDate)) return false;
        return true;
    });

    if (filtered.length === 0) {
        body.innerHTML = '<div class="ui-empty">No hay registros en la auditoría de stock</div>';
        return;
    }

    body.innerHTML = filtered.slice(0, 300).map(a => {
        const qty = parseInt(a.quantity_change ?? a.quantity_added ?? 0);
        const d = parseDate(a.created_at);
        const pos = qty >= 0;
        return `<div class="ui-tr">
            <span class="muted">${d ? `${fmtDay(d)} · ${fmtTime(d)}` : '—'}</span>
            <span class="ellipsis">${escHtml(a.product_name) || 'Producto'}</span>
            <span class="c"><span class="adm-var ${pos ? 'in' : 'out'}">${qty > 0 ? '+' : ''}${qty}</span></span>
            <span class="r dimmed">${a.previous_stock ?? '—'}</span>
            <span class="r" style="font-weight:500">${a.new_stock ?? '—'}</span>
            <span>${escHtml(a.operator_name) || 'Sistema'}</span>
            <span class="muted ellipsis" title="${escHtml(a.notes || '')}"><span class="ui-tag" style="margin-right:6px;padding:3px 8px">${MOVE_TAG[a.movement_type] || 'Mov.'}</span>${escHtml(a.notes) || '—'}</span>
        </div>`;
    }).join('');
}

// ─── Edición de Producto ────────────────────────────────
let editOriginal = null;

function openEditProduct(productId) {
    const p = findAdminProduct(productId);
    if (!p) return;
    editOriginal = p;
    document.getElementById("edit-product-id").value = productId;
    document.getElementById("edit-product-code").textContent = `Cód. ${p.code}`;
    document.getElementById("edit-product-name").value = p.name || '';
    document.getElementById("edit-product-brand").value = p.brand || '';
    document.getElementById("edit-product-cost").value = p.cost_price || 0;
    document.getElementById("edit-product-price").value = p.sale_price || 0;

    fetch('/api/products/categories')
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById("edit-product-category");
            // Opción vacía: si el producto no tiene categoría (p.ej. se eliminó) no se le asigna
            // la primera de la lista sin que el usuario lo note al guardar
            select.innerHTML = '<option value="">Sin categoría</option>' + (data || []).map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
            select.value = p.category_id ?? '';
            renderEditCategoryChips(data || []);
            updateEditPreview();
            document.getElementById("edit-product-modal").classList.remove("hidden");
        })
        .catch(() => showToast("Error cargando categorías", "error"));
}

function renderEditCategoryChips(categories) {
    const host = document.getElementById('ep-cat-chips');
    const select = document.getElementById('edit-product-category');
    if (!host || !select) return;

    if (!categories || !categories.length) {
        host.innerHTML = '';
        return;
    }

    const top5 = categories.slice(0, 5);
    const otherCats = categories.slice(5);
    const isOtherSelected = otherCats.some(c => String(c.id) === String(select.value));

    let html = top5.map((c, i) => `<button type="button" class="ui-chip ui-chip--lg ${String(c.id) === String(select.value) ? 'active' : ''}" data-ep-cat="${c.id}"><span class="dot" style="background:${CAT_DOTS[i % CAT_DOTS.length]}"></span>${escHtml(c.name)}</button>`).join('');

    if (otherCats.length > 0) {
        html += `<div class="pos-cat-dropdown-wrap" style="position:relative;display:inline-flex;align-items:center;">
            <select class="pos-category-select ui-chip ui-chip--lg ${isOtherSelected ? 'active' : ''}" id="ep-more-cats-select" aria-label="Otras categorías">
                <option value="" ${!isOtherSelected ? 'selected' : ''}>Otras (${otherCats.length}) ▾</option>
                ${otherCats.map(c => `<option value="${c.id}" ${String(c.id) === String(select.value) ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}
            </select>
        </div>`;
    }

    host.innerHTML = html;

    host.querySelectorAll('[data-ep-cat]').forEach(btn => btn.addEventListener('click', () => {
        select.value = btn.dataset.epCat;
        renderEditCategoryChips(categories);
    }));

    const moreSelect = document.getElementById('ep-more-cats-select');
    if (moreSelect) {
        moreSelect.addEventListener('change', () => {
            const val = moreSelect.value;
            if (val) {
                select.value = val;
                renderEditCategoryChips(categories);
            }
        });
    }
}

function updateEditPreview() {
    const p = editOriginal;
    if (!p) return;
    const val = id => document.getElementById(id)?.value || '';
    const cost = Number(val('edit-product-cost')) || 0, price = Number(val('edit-product-price')) || 0;
    const oldPrice = parseFloat(p.sale_price) || 0;
    const margin = price > 0 ? Math.round((price - cost) / price * 100) : 0;
    const stock = parseInt(p.stock) || 0, min = parseInt(p.min_stock) || 0;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('ep-pv-code', `Cód. ${p.code}`);
    const st = document.getElementById('ep-pv-stock');
    if (st) { st.textContent = `Stock ${stock}`; st.className = `pos-stock ${stock === 0 ? 'out' : stock <= min ? 'warn' : 'ok'}`; }
    set('ep-pv-name', val('edit-product-name').trim() || 'Nombre del producto');
    set('ep-pv-brand', val('edit-product-brand').trim() || 'Sin marca');
    set('ep-pv-price', fmt(price));
    set('ep-pv-old', price !== oldPrice ? fmt(oldPrice) : '');
    set('ep-pv-profit', fmt(price - cost));
    set('ep-pv-margin', `${margin}%`);
    const bar = document.getElementById('ep-pv-margin-bar');
    if (bar) { bar.style.width = `${Math.max(0, Math.min(100, margin))}%`; bar.style.background = margin < 20 ? 'var(--orange)' : margin < 40 ? 'var(--yellow)' : 'var(--blue-soft)'; }
    const d = safeSubtract(price, oldPrice);
    set('ep-pv-delta', d === 0 ? 'Sin cambio' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`);
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
        showToast("El precio de venta no debe ser menor que el costo", "error"); return;
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
            showToast("Error actualizando producto: " + updErr.message, "error");
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

        showToast("Producto actualizado correctamente");
        document.getElementById("edit-product-modal").classList.add("hidden");
        await loadAdminProducts();
    } catch (e) {
        console.error("Expeción en confirmEditProduct:", e);
        showToast("Error de conexión al guardar producto", "error");
    }
}

async function openPriceHistory(productId) {
    const p = findAdminProduct(productId);
    document.getElementById("price-history-product-name").textContent = p ? `Cód. ${p.code} · ${p.name}` : '';
    const content = document.getElementById("price-history-content");
    const chart = document.getElementById("price-history-chart");
    content.innerHTML = '<div class="ui-empty">Cargando historial…</div>';
    chart?.classList.add('hidden');
    document.getElementById("price-history-modal").classList.remove("hidden");

    try {
        const { data, error } = await supabase.from('price_history').select('*').eq('product_id', productId);
        if (error) {
            console.error("Error en consulta price_history:", error);
            content.innerHTML = `<div class="auth-error">No se pudo consultar el historial: ${escHtml(error.message)}</div>`;
            return;
        }
        if (!data || data.length === 0) {
            content.innerHTML = '<div class="ui-empty">Este producto no tiene cambios de precio registrados.</div>';
            return;
        }
        const when = r => parseDate(r.changed_at || r.created_at);
        data.sort((a, b) => (when(b) || 0) - (when(a) || 0) || (b.id || 0) - (a.id || 0));

        const delta = (o, n) => {
            const d = safeSubtract(parseFloat(n || 0), parseFloat(o || 0));
            return d === 0 ? null : { txt: `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`, up: d > 0 };
        };
        content.innerHTML = data.map(r => {
            const d = when(r);
            const cd = delta(r.old_cost_price, r.new_cost_price), pd = delta(r.old_sale_price, r.new_sale_price);
            const arrow = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>';
            return `<div class="ph-row ui-tr" title="${escHtml(r.notes || '')}">
                <span class="ui-cell-2"><span>${d ? fmtDay(d) : '—'}</span><small>${d ? fmtTime(d) : ''}</small></span>
                <span class="ph-change"><span class="o">${money(r.old_cost_price)}</span>${arrow}<span>${money(r.new_cost_price)}</span>${cd ? `<span class="ui-tag ${cd.up ? 'ph-up' : 'ph-down'}">${cd.txt}</span>` : ''}</span>
                <span class="ph-change"><span class="o">${money(r.old_sale_price)}</span>${arrow}<span style="font-weight:500">${money(r.new_sale_price)}</span>${pd ? `<span class="ui-tag ph-sale">${pd.txt}</span>` : ''}</span>
                <span class="r muted">${escHtml(r.changed_by) || 'Sistema'}</span>
            </div>`;
        }).join('');
        renderPriceChart(chart, [...data].reverse(), p);
    } catch (err) {
        console.error(err);
        content.innerHTML = `<div class="auth-error">Error al cargar historial: ${escHtml(err.message || String(err))}</div>`;
    }
}

// Escalones de costo y venta a lo largo del tiempo (más antiguo → actual)
function renderPriceChart(host, rows, product) {
    if (!host || rows.length === 0) return;
    const pts = [{ c: parseFloat(rows[0].old_cost_price) || 0, s: parseFloat(rows[0].old_sale_price) || 0, d: null }]
        .concat(rows.map(r => ({ c: parseFloat(r.new_cost_price) || 0, s: parseFloat(r.new_sale_price) || 0, d: parseDate(r.changed_at || r.created_at) })));
    const max = Math.max(...pts.map(p => p.s), 1) * 1.15;
    const W = 600, H = 120, n = pts.length;
    const X = i => i / Math.max(1, n - 1) * W, Y = v => H - 8 - (v / max) * (H - 16);
    const step = key => pts.map((p, i) => i === 0 ? `0,${Y(p[key])}` : `${X(i)},${Y(pts[i - 1][key])} ${X(i)},${Y(p[key])}`).join(' ');
    const last = pts[n - 1];
    const margin = last.s > 0 ? Math.round((last.s - last.c) / last.s * 100) : 0;
    const labels = pts.map(p => p.d).filter(Boolean);
    const shown = labels.length <= 4 ? labels : [labels[0], labels[Math.floor(labels.length / 3)], labels[Math.floor(labels.length * 2 / 3)], labels[labels.length - 1]];
    host.innerHTML = `
        <div class="ph-legend"><span><i style="background:#f0c132"></i>Venta</span><span><i style="background:rgba(255,255,255,.6)"></i>Costo</span><span style="margin-left:auto;color:rgba(255,255,255,.7)">Margen hoy ${margin}%</span></div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}" style="display:block;overflow:visible">
            <line x1="0" x2="${W}" y1="40" y2="40" stroke="rgba(255,255,255,.14)" stroke-dasharray="4 6" vector-effect="non-scaling-stroke"></line>
            <line x1="0" x2="${W}" y1="90" y2="90" stroke="rgba(255,255,255,.14)" stroke-dasharray="4 6" vector-effect="non-scaling-stroke"></line>
            <polyline points="${step('s')}" fill="none" stroke="#f0c132" stroke-width="2.6" vector-effect="non-scaling-stroke"></polyline>
            <polyline points="${step('c')}" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="2.2" vector-effect="non-scaling-stroke"></polyline>
        </svg>
        <div class="ph-xlabels">${shown.map(d => `<span>${fmtDay(d)}</span>`).join('')}</div>`;
    host.classList.remove('hidden');
}

// ─── Categorías ─────────────────────────────
const CAT_COLORS = ['#f0c132', '#2b4f9e', '#c9bfae', '#17171a', '#d6451b', '#8fb0ff', '#b9b3a8', '#e9a58f'];

async function loadCategories() {
    try {
        const response = await fetch('/api/products/categories');
        const data = await response.json();
        adminCategories = data || [];
        renderCategories();
    } catch (e) { console.error(e); }
}

function renderCategories() {
    const host = document.getElementById("categories-tbody");
    if (!host) return;
    host.innerHTML = adminCategories.length ? adminCategories.map((cat, i) => {
        const n = adminAllProducts.filter(p => p.category_id === cat.id).length;
        return `<div class="ui-list-row" style="grid-template-columns:40px 1fr 120px auto;padding:12px 4px">
            <span class="dimmed" style="color:var(--dim)">${cat.id}</span>
            <span style="display:flex;align-items:center;gap:10px"><span class="ui-dot" style="background:${CAT_COLORS[i % CAT_COLORS.length]}"></span>${escHtml(cat.name)}</span>
            <span style="color:var(--muted)">${n} producto${n === 1 ? '' : 's'}</span>
            <span style="display:flex;gap:6px;justify-content:flex-end">
                <button class="ui-mini" onclick="editCategory(${cat.id})">Editar</button>
                <button class="ui-mini danger" onclick="deleteCategory(${cat.id})">Eliminar</button>
            </span>
        </div>`;
    }).join('') : '<div class="ui-empty">Aún no hay categorías</div>';
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

let currentEditCategoryId = null;

function openEditCategory(id) {
    const cat = adminCategories.find(c => c.id === id);
    if (!cat) return;
    currentEditCategoryId = id;
    const modal = document.getElementById("edit-category-modal");
    if (!modal) return;
    const idInput = document.getElementById("edit-category-id");
    if (idInput) idInput.value = id;
    const badge = document.getElementById("edit-category-badge");
    if (badge) badge.textContent = `Categoría #${cat.id}`;
    const nameInput = document.getElementById("edit-category-name");
    if (nameInput) nameInput.value = cat.name || '';
    const n = adminAllProducts.filter(p => p.category_id === cat.id).length;
    const info = document.getElementById("edit-category-info");
    if (info) info.textContent = `${n} producto${n === 1 ? '' : 's'} asociado${n === 1 ? '' : 's'} actualmente`;

    modal.classList.remove("hidden");
    setTimeout(() => {
        nameInput?.focus();
        nameInput?.select();
    }, 60);
}

function editCategory(id) {
    openEditCategory(id);
}

async function saveEditCategory() {
    const id = parseInt(document.getElementById("edit-category-id")?.value || currentEditCategoryId);
    const newName = document.getElementById("edit-category-name")?.value.trim();
    if (!newName) return showToast("Ingresa un nombre para la categoría", "error");
    const currentCat = adminCategories.find(c => c.id === id);
    if (adminCategories.some(c => c.id !== id && (c.name || '').trim().toLowerCase() === newName.toLowerCase())) {
        return showToast("Ya existe otra categoría con ese nombre", "error");
    }
    if (currentCat && currentCat.name === newName) {
        document.getElementById("edit-category-modal")?.classList.add("hidden");
        return;
    }
    try {
        const { error } = await supabase.from('categories').update({ name: newName }).eq('id', id);
        if (error) throw error;
        document.getElementById("edit-category-modal")?.classList.add("hidden");
        showToast("Categoría actualizada");
        await loadCategories();
        await loadAdminProducts();
    } catch (e) {
        showToast(e?.message || "Error al actualizar categoría", "error");
    }
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
        <button type="button" class="adm-type ${t.id === selectedTypeId ? 'active' : ''}" data-type-id="${t.id}">
            <span>${escHtml(t.name)}</span>
            <span class="n">${t.brands.length + t.faults.length}</span>
        </button>`).join('')
        : '<p class="adm-small" style="color:rgba(255,255,255,.6)">Aún no hay tipos de equipo. Agrega el primero (ej. Celular, Laptop, Impresora).</p>';

    renderCatalogDetail();

    document.getElementById("general-fault-chips").innerHTML = chipsHtml(catalog.generalFaults, 'fault', 'Sin fallas generales', 'ink');

    const unassignedPanel = document.getElementById("unassigned-brands-panel");
    unassignedPanel?.classList.toggle("hidden", catalog.unassignedBrands.length === 0);
    const selected = catalog.types.find(t => t.id === selectedTypeId);
    document.getElementById("unassigned-brand-chips").innerHTML = catalog.unassignedBrands.map(b => `
        <span class="adm-chip">
            ${escHtml(b.name)}
            ${selected ? `<button type="button" class="adm-chip-act" data-assign-brand="${escHtml(b.name)}" title="Asignar a ${escHtml(selected.name)}">+ ${escHtml(selected.name)}</button>` : ''}
            <button type="button" class="x" data-delete-brand="${b.id}" title="Eliminar marca">×</button>
        </span>`).join('');
}

function chipsHtml(items, kind, emptyText, tone = '') {
    if (!items.length) return `<span class="adm-small">${emptyText}</span>`;
    return items.map(it => `<span class="adm-chip ${tone}">${escHtml(it.name)}<button type="button" class="x" data-remove-${kind}="${it.id}" title="Quitar">×</button></span>`).join('');
}

function renderCatalogDetail() {
    const detail = document.getElementById("catalog-detail");
    if (!detail) return;
    const type = catalog.types.find(t => t.id === selectedTypeId);
    if (!type) {
        detail.innerHTML = '<div class="ui-empty">Selecciona o crea un tipo de equipo para configurar sus marcas y fallas.</div>';
        return;
    }
    const otherBrands = catalog.brands.filter(b => !type.brands.some(tb => tb.id === b.id));
    detail.innerHTML = `
        <div class="ui-card-head">
            <div style="font-size:24px;font-weight:500;letter-spacing:-.02em">${escHtml(type.name)}</div>
            <div style="display:flex;gap:6px">
                <button type="button" class="ui-mini" id="rename-type-btn">Renombrar</button>
                <button type="button" class="ui-mini danger" id="delete-type-btn">Eliminar</button>
            </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
            <span class="ui-card-sub">Marcas · ${type.brands.length}</span>
            <div class="adm-chips">${chipsHtml(type.brands, 'brand', 'Sin marcas: se sugerirán todas las marcas', 'white')}</div>
            <form class="adm-add" id="add-type-brand-form">
                <input type="text" id="new-type-brand-input" class="ui-input" list="catalog-all-brands" placeholder="+ Añadir marca (ej. Samsung)" autocomplete="off" style="flex:1;border-style:dashed">
                <datalist id="catalog-all-brands">${otherBrands.map(b => `<option value="${escHtml(b.name)}">`).join('')}</datalist>
                <button type="submit" class="ui-pill sm" style="height:46px">Añadir</button>
            </form>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
            <span class="ui-card-sub">Fallas comunes · ${type.faults.length} propias + ${catalog.generalFaults.length} generales</span>
            <div class="adm-chips">${chipsHtml(type.faults, 'fault', 'Sin fallas propias', 'yellow')}</div>
            <form class="adm-add" id="add-type-fault-form">
                <input type="text" id="new-type-fault-input" class="ui-input" placeholder="+ Añadir falla (ej. Pantalla rota)" autocomplete="off" style="flex:1;border-style:dashed">
                <button type="submit" class="ui-pill sm" style="height:46px">Añadir</button>
            </form>
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
            openRenameType(type.id);
        } else if (el.id === "delete-type-btn" && type) {
            if (!confirm(`¿Eliminar "${type.name}" con sus ${type.faults.length} fallas propias?\nLas marcas que también estén en otros tipos se conservan. Las reparaciones ya registradas no cambian.`)) return;
            catalogAction(() => catalogRequest('DELETE', `/api/admin/equipment-types/${type.id}`), "Tipo de equipo eliminado");
        }
    });
}

// ─── Caja y Retiros ─────────────────────────
let cashState = { events: [], withdrawals: [], earned: 0, withdrawn: 0, available: 0, monthly: [] };
let cashPeriod = 'all';
let cashLedgerMethod = 'all';

// Rango [desde, hasta) del periodo elegido; null = sin límite
function cashRange() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const day = n => new Date(y, m, d + n);
    switch (cashPeriod) {
        case 'today': return [day(0), day(1)];
        case 'yesterday': return [day(-1), day(0)];
        case 'week': { const dow = now.getDay() || 7; return [day(1 - dow), day(8 - dow)]; }
        case 'month': return [new Date(y, m, 1), new Date(y, m + 1, 1)];
        case 'year': return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
        case 'custom': {
            const f = document.getElementById('cash-from')?.value, t = document.getElementById('cash-to')?.value;
            const a = f ? new Date(`${f}T00:00:00`) : null;
            const b = t ? new Date(`${t}T00:00:00`) : null;
            if (b) b.setDate(b.getDate() + 1);
            return [a, b];
        }
        default: return [null, null];
    }
}

const inCashRange = (date, [a, b]) => {
    const d = parseDate(date);
    if (!d) return false;
    return (!a || d >= a) && (!b || d < b);
};

// Libro de caja: cada cobro, pago a terceros y retiro activo como movimiento con medio de pago
function buildCashLedger() {
    const rows = [];
    cashState.events.forEach(ev => {
        const d = parseDate(ev.date); if (!d) return;
        const code = ev.ref?.ticket_code || ev.ref?.sale_code || '';
        if (ev.income > 0) {
            const concept = ev.kind === 'venta' ? 'Venta' : ev.stage === 'saldo' ? (ev.direct ? 'Reparación · saldo (entrega directa)' : 'Reparación · saldo al entregar') : (ev.direct ? 'Reparación · adelanto (entrega directa)' : 'Reparación · adelanto al terminar');
            rows.push({ ts: d.getTime(), date: d, concept: code ? `${concept} · ${code}` : concept, method: ev.method || 'Caja', inc: ev.income, out: 0 });
        }
        if (ev.outflow > 0) rows.push({ ts: d.getTime(), date: d, concept: `Pago a terceros${code ? ' · ' + code : ''}`, method: 'Caja', inc: 0, out: ev.outflow });
    });
    cashState.withdrawals.filter(w => w.status === 'ACTIVO').forEach(w => {
        const d = parseDate(w.created_at); if (!d) return;
        rows.push({ ts: d.getTime(), date: d, concept: `Retiro · ${w.reason || ''}${w.notes ? ' · ' + w.notes : ''}`, method: w.source || 'Caja', inc: 0, out: parseFloat(w.amount || 0) });
    });
    return rows.sort((a, b) => a.ts - b.ts);
}


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
    const { events, withdrawals, available, earned: earnedAll, withdrawn: withdrawnAll, monthly } = cashState;
    const range = cashRange();
    const [from, to] = range;
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

    const evP = events.filter(e => inCashRange(e.date, range));
    const active = withdrawals.filter(w => w.status === 'ACTIVO' && inCashRange(w.created_at, range));
    const earned = sumBy(evP, 'profit');
    const withdrawn = sumBy(active, 'amount');
    const isAll = cashPeriod === 'all';

    const fmtD = d => d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
    const lastDay = to ? new Date(to.getTime() - 1) : null;
    set("cash-range-label", isAll ? 'Todo el historial' : (from || lastDay) ? `${from ? fmtD(from) : 'inicio'} — ${lastDay ? fmtD(lastDay) : 'hoy'}` : 'Elige un rango de fechas');

    set("cash-kpi-earned", fmt(earned));
    set("cash-kpi-earned-sub", isAll ? 'Histórico: ventas + reparaciones + revalorización' : 'En el periodo seleccionado');
    set("cash-kpi-withdrawn", fmt(withdrawn));
    set("cash-kpi-withdrawn-count", `${active.length} retiro${active.length === 1 ? '' : 's'}`);
    set("cash-kpi-available", fmt(available));
    document.getElementById("cash-kpi-available")?.classList.toggle("cash-negative", available < 0);
    const pct = earnedAll > 0 ? Math.min(100, Math.max(0, (withdrawnAll / earnedAll) * 100)) : 0;
    const bar = document.getElementById("cash-progress-bar");
    if (bar) requestAnimationFrame(() => { bar.style.width = `${pct}%`; });
    const av = document.getElementById("cash-kpi-available");
    av?.animate && av.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 450 });
    set("cash-kpi-available-pct", earnedAll > 0 ? `Retiraste el ${pct.toFixed(0)}% de lo ganado (total)` : 'Aún no hay ganancia registrada');

    const thisMonth = monthKey(new Date().toISOString());
    const m = monthly.find(x => x.key === thisMonth) || { earned: 0, withdrawn: 0 };
    set("cash-kpi-month-label", `Este mes (${monthLabel(thisMonth)})`);
    set("cash-kpi-month-earned", fmt(m.earned));
    set("cash-kpi-month-withdrawn", `Retirado: ${fmt(m.withdrawn)}`);

    // Libro de caja y saldos
    const ledger = buildCashLedger();
    // Sin fecha de inicio ("Todo") no hay movimientos "antes" del periodo
    const before = r => !!from && r.ts < from.getTime();
    const upTo = r => !to || r.ts < to.getTime();
    const inPeriod = r => !before(r) && upTo(r);
    const net = rows => rows.reduce((acc, r) => safeAdd(acc, safeSubtract(r.inc, r.out)), 0);

    const opening = net(ledger.filter(before));
    const periodRows = ledger.filter(inPeriod);
    const entered = sumBy(periodRows, 'inc'), left = sumBy(periodRows, 'out');
    const closing = safeAdd(opening, safeSubtract(entered, left));
    const boxEl = document.getElementById("cash-kpi-box");
    set("cash-kpi-box", fmt(closing));
    if (boxEl) boxEl.style.color = closing < 0 ? 'var(--orange-soft)' : '';
    set("cash-kpi-box-label", isAll ? 'Dinero en caja (hoy)' : 'Dinero en caja al cierre del periodo');
    set("cash-kpi-box-sub", isAll ? `Entró ${fmt(entered)} · Salió ${fmt(left)}` : `Inicio ${fmt(opening)} · +${fmt(entered)} · −${fmt(left)}`);

    // Por medio de pago
    const methodsBody = document.getElementById("cash-methods-table");
    const METHOD_COLORS = { 'Caja': '#17171a', 'Yape/Plin': '#2b4f9e', 'Transferencia': '#f0c132', 'POS': '#d6451b' };
    if (methodsBody) {
        methodsBody.innerHTML = PAYMENT_METHODS.map(method => {
            const rows = ledger.filter(r => r.method === method);
            const pr = rows.filter(inPeriod);
            const cobrado = sumBy(pr, 'inc');
            const salio = sumBy(pr, 'out');
            const neto = net(rows.filter(upTo));
            return `<div class="adm-methods-row"><span style="display:flex;align-items:center;gap:8px"><span class="ui-dot" style="background:${METHOD_COLORS[method]}"></span>${method === 'Transferencia' ? 'Transferencia / Banco' : method}</span>
                <span class="r tnum">${money(cobrado)}</span><span class="r tnum" style="color:var(--orange)">${salio ? '−' + money(salio) : money(0)}</span>
                <span class="r tnum" style="font-weight:500;${neto < 0 ? 'color:var(--orange)' : ''}">${money(neto)}</span></div>`;
        }).join('');
    }

    renderCashLedger(ledger, { from, to, inPeriod, before });

    // Mensual (más reciente arriba, últimos 12)
    const monthlyBody = document.getElementById("cash-monthly-table");
    if (monthlyBody) {
        const rows = [...monthly].reverse().slice(0, 12);
        monthlyBody.innerHTML = rows.length ? rows.map(r => `<div class="ui-tr"><span>${monthLabel(r.key)}</span><span class="r tnum">${money(r.earned)}</span>
            <span class="r tnum" style="color:var(--orange)">${r.withdrawn ? '−' + money(r.withdrawn) : money(0)}</span>
            <span class="r tnum" style="${r.kept < 0 ? 'color:var(--orange)' : ''}">${money(r.kept)}</span><span class="r tnum" style="font-weight:500">${money(r.cumulative)}</span></div>`).join('')
            : '<div class="ui-empty">Sin movimientos todavía</div>';
    }

    renderCashHistory();
    updateCashPreview();
    if (document.getElementById("admin-cash")?.classList.contains("active")) renderCashChart();
}

let cashLedgerView = [];
function renderCashLedger(ledger, { inPeriod, before }) {
    const chips = document.getElementById("cash-ledger-methods");
    if (chips) chips.innerHTML = ['all', ...PAYMENT_METHODS].map(m => `<button type="button" class="ui-chip ${cashLedgerMethod === m ? 'active' : ''}" data-ledger-method="${m}">${m === 'all' ? 'Todos' : m}</button>`).join('');
    const rows = ledger.filter(r => cashLedgerMethod === 'all' || r.method === cashLedgerMethod);
    let running = rows.filter(before).reduce((acc, r) => safeAdd(acc, safeSubtract(r.inc, r.out)), 0);
    const opening = running;
    const view = rows.filter(inPeriod).map(r => { running = safeAdd(running, safeSubtract(r.inc, r.out)); return { ...r, balance: running }; });
    cashLedgerView = { opening, rows: view, closing: running };
    const count = document.getElementById("cash-ledger-count");
    if (count) count.textContent = `${view.length} movimiento${view.length === 1 ? '' : 's'}`;
    const body = document.getElementById("cash-ledger-table");
    if (!body) return;
    const openRow = cashPeriod !== 'all' ? `<div class="ui-tr open"><span></span><span>Saldo inicial</span><span></span><span></span><span></span><span class="r tnum">${money(opening)}</span></div>` : '';
    body.innerHTML = view.length ? openRow + [...view].reverse().map(r => `<div class="ui-tr"><span class="muted">${fmtDay(r.date)} · ${fmtTime(r.date)}</span><span class="ellipsis" title="${escHtml(r.concept)}">${escHtml(r.concept)}</span><span>${escHtml(r.method)}</span>
        <span class="r tnum cash-in">${r.inc ? '+' + money(r.inc) : ''}</span><span class="r tnum" style="color:var(--orange)">${r.out ? '−' + money(r.out) : ''}</span><span class="r tnum" style="font-weight:500;${r.balance < 0 ? 'color:var(--orange)' : ''}">${money(r.balance)}</span></div>`).join('')
        : '<div class="ui-empty">Sin movimientos en este periodo</div>';
}

function exportCashCsv() {
    const { opening, rows, closing } = cashLedgerView;
    if (!rows) return;
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Fecha', 'Concepto', 'Medio', 'Entrada', 'Salida', 'Saldo'].map(q).join(',')];
    lines.push([q('Saldo inicial'), q(''), q(''), '', '', opening.toFixed(2)].join(','));
    rows.forEach(r => lines.push([q(`${fmtDay(r.date)} ${fmtTime(r.date)}`), q(r.concept), q(r.method), r.inc.toFixed(2), r.out.toFixed(2), r.balance.toFixed(2)].join(',')));
    lines.push([q('Saldo final'), q(''), q(''), '', '', closing.toFixed(2)].join(','));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `libro-de-caja-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderCashHistory() {
    const body = document.getElementById("cash-history-table");
    if (!body) return;
    const showVoided = document.getElementById("cash-show-voided")?.checked;
    const range = cashRange();
    const rows = cashState.withdrawals.filter(w => (showVoided || w.status === 'ACTIVO') && inCashRange(w.created_at, range));
    body.innerHTML = rows.length ? rows.map(w => {
        const d = parseDate(w.created_at);
        const voided = w.status === 'ANULADO';
        return `<div class="adm-w-row ${voided ? 'voided' : ''}">
            <span class="muted">${d ? fmtDay(d) : '—'}</span>
            <span class="tnum" style="font-weight:500;color:var(--orange)">−${money(w.amount)}</span>
            <span class="ellipsis" title="${escHtml(w.notes || '')}">${escHtml(w.reason)} <span style="color:var(--dim)">· ${escHtml(w.source)}${w.notes ? ' · ' + escHtml(w.notes) : ''}</span>${voided ? `<small style="display:block;color:var(--orange)">Anulado por ${escHtml(w.voided_by || '-')}${w.void_reason ? ': ' + escHtml(w.void_reason) : ''}</small>` : ''}</span>
            <span style="color:var(--muted);text-align:right">${escHtml(w.operator_name)}</span>
            ${voided ? '<span class="ui-tag">Anulado</span>' : `<button type="button" class="ui-mini danger" data-void-withdrawal="${w.id}">Anular</button>`}
        </div>`;
    }).join('') : '<div class="ui-empty">No hay retiros en este periodo</div>';
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
                { label: 'Ganancia', data: rows.map(r => r.earned), backgroundColor: '#2b4f9e', borderRadius: 8, maxBarThickness: 28 },
                { label: 'Retirado', data: rows.map(r => r.withdrawn), backgroundColor: '#d6451b', borderRadius: 8, maxBarThickness: 28 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { ticks: { color: '#8b857b', font: { family: 'Outfit' } }, grid: { color: 'rgba(23,23,26,0.06)' }, border: { display: false } },
                x: { ticks: { color: '#8b857b', font: { family: 'Outfit' } }, grid: { display: false }, border: { display: false } }
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
    const sourceNet = buildCashLedger().filter(r => r.method === source).reduce((acc, r) => safeAdd(acc, safeSubtract(r.inc, r.out)), 0);
    let warn = '';
    if (amount > 0 && after < 0) warn = `<div class="adm-warn">Supera la ganancia disponible en ${fmt(-after)}. Estarías retirando capital del negocio.</div>`;
    else if (amount > 0 && amount > sourceNet) warn = `<div class="adm-warn">Es más de lo cobrado neto por ${escHtml(source)} (${fmt(sourceNet)}).</div>`;
    preview.innerHTML = `Disponible después del retiro: <b style="color:${after < 0 ? 'var(--orange-soft)' : '#fff'};font-weight:500">${fmt(after)}</b>${warn}`;
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

let currentRenameTypeId = null;

function openRenameType(typeId) {
    const type = catalog.types.find(t => t.id === typeId);
    if (!type) return;
    currentRenameTypeId = typeId;
    const modal = document.getElementById("rename-type-modal");
    if (!modal) return;
    const idInput = document.getElementById("rename-type-id");
    if (idInput) idInput.value = type.id;
    const nameInput = document.getElementById("rename-type-name");
    if (nameInput) nameInput.value = type.name || '';
    modal.classList.remove("hidden");
    setTimeout(() => {
        nameInput?.focus();
        nameInput?.select();
    }, 60);
}

async function saveRenameType() {
    const id = parseInt(document.getElementById("rename-type-id")?.value || currentRenameTypeId);
    const newName = document.getElementById("rename-type-name")?.value.trim();
    if (!newName) return showToast("Ingresa un nombre para el tipo de equipo", "error");
    const type = catalog.types.find(t => t.id === id);
    if (type && type.name === newName) {
        document.getElementById("rename-type-modal")?.classList.add("hidden");
        return;
    }
    document.getElementById("rename-type-modal")?.classList.add("hidden");
    catalogAction(() => catalogRequest('PUT', `/api/admin/equipment-types/${id}`, { name: newName }), "Tipo renombrado");
}

let currentVoidWithdrawalId = null;

function openVoidWithdrawal(id) {
    const w = cashState.withdrawals.find(x => x.id === id);
    if (!w) return;
    currentVoidWithdrawalId = id;
    const modal = document.getElementById("void-withdrawal-modal");
    if (!modal) return;
    const idInput = document.getElementById("void-withdrawal-id");
    if (idInput) idInput.value = w.id;
    const meta = document.getElementById("void-withdrawal-meta");
    if (meta) meta.textContent = `Retiro de ${fmt(w.amount)} (${w.source || 'Caja'})`;
    const detail = document.getElementById("void-withdrawal-detail");
    if (detail) detail.textContent = `Motivo: ${w.reason}${w.notes ? ` · Nota: ${w.notes}` : ''}`;
    const reasonInput = document.getElementById("void-withdrawal-reason");
    if (reasonInput) reasonInput.value = '';
    modal.classList.remove("hidden");
    setTimeout(() => reasonInput?.focus(), 60);
}

async function confirmVoidWithdrawal() {
    const id = parseInt(document.getElementById("void-withdrawal-id")?.value || currentVoidWithdrawalId);
    if (!id) return;
    const reason = document.getElementById("void-withdrawal-reason")?.value.trim() || 'Anulado por administración';
    try {
        const res = await fetch(`/api/cash/${id}/void`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ void_reason: reason, operator_name: currentOperator() })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Error de conexión');
        document.getElementById("void-withdrawal-modal")?.classList.add("hidden");
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
    document.getElementById("cash-export-csv")?.addEventListener("click", exportCashCsv);
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date();
    const fromEl = document.getElementById("cash-from"), toEl = document.getElementById("cash-to");
    if (fromEl) fromEl.value = iso(new Date(today.getFullYear(), today.getMonth(), 1));
    if (toEl) toEl.value = iso(today);
    [fromEl, toEl].forEach(el => el?.addEventListener("change", renderCashView));
    root.addEventListener("click", e => {
        const per = e.target.closest("#cash-periods [data-period]");
        if (per) {
            cashPeriod = per.dataset.period;
            root.querySelectorAll("#cash-periods [data-period]").forEach(b => b.classList.toggle("active", b === per));
            document.getElementById("cash-custom")?.classList.toggle("hidden", cashPeriod !== "custom");
            renderCashView();
            return;
        }
        const lm = e.target.closest("[data-ledger-method]");
        if (lm) { cashLedgerMethod = lm.dataset.ledgerMethod; renderCashView(); return; }
        const btn = e.target.closest("[data-void-withdrawal]");
        if (btn) openVoidWithdrawal(Number(btn.dataset.voidWithdrawal));
        const src = e.target.closest("[data-src]");
        if (src) {
            document.getElementById("cash-source").value = src.dataset.src;
            root.querySelectorAll("[data-src]").forEach(b => b.classList.toggle("active", b === src));
            updateCashPreview();
        }
        const rs = e.target.closest("[data-reason]");
        if (rs) {
            document.getElementById("cash-reason").value = rs.dataset.reason;
            root.querySelectorAll("[data-reason]").forEach(b => b.classList.toggle("active", b === rs));
        }
    });
}

// ─── Nuevo Producto ─────────────────────────
let npCategories = [];

const CAT_DOTS = ['#f0c132', '#2b4f9e', '#c9bfae', '#17171a', '#d6451b', '#8fb0ff', '#b9b3a8'];

async function openNewProductModal() {
    try {
        const { data: categories } = await supabase.from('categories').select('*').order('name');
        npCategories = categories || [];
        const select = document.getElementById("new-product-category");
        select.innerHTML = npCategories.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
        if (npCategories.length) select.value = npCategories[0].id;

        const { data: brands } = await supabase.from('brand_models').select('*').order('name');
        const datalist = document.getElementById("brand-model-list");
        if (datalist) datalist.innerHTML = (brands || []).map(b => `<option value="${escHtml(b.name)}">`).join('');
    } catch (e) {
        showToast("Error cargando datos", "error");
        return;
    }
    if (adminAllProducts.length === 0) {
        try { adminAllProducts = await (await fetch('/api/products')).json() || []; } catch (e) { /* vista previa sin código */ }
    }

    renderNpCategoryChips();
    const marginHost = document.getElementById('np-margin-sug');
    if (marginHost && !marginHost.dataset.ready) {
        marginHost.dataset.ready = '1';
        [30, 50, 70, 100].forEach(m => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ui-mini';
            btn.textContent = `+${m}%`;
            btn.addEventListener('click', () => {
                const cost = Number(document.getElementById('new-product-cost').value);
                if (!cost) { showToast('Ingresa primero el costo', 'error'); return; }
                document.getElementById('new-product-price').value = Math.ceil(cost * (1 + m / 100));
                updateNewProductPreview();
            });
            marginHost.appendChild(btn);
        });
    }
    updateNewProductPreview();
    document.getElementById("new-product-modal").classList.remove("hidden");
    setTimeout(() => document.getElementById("new-product-name")?.focus(), 80);
}

function renderNpCategoryChips() {
    const host = document.getElementById('np-cat-chips');
    const select = document.getElementById('new-product-category');
    if (!host || !select) return;

    if (!npCategories.length) {
        host.innerHTML = '<span class="ui-card-sub">Crea primero una categoría en Administración</span>';
        return;
    }

    const top5 = npCategories.slice(0, 5);
    const otherCats = npCategories.slice(5);
    const isOtherSelected = otherCats.some(c => String(c.id) === String(select.value));

    let html = top5.map((c, i) => `<button type="button" class="ui-chip ui-chip--lg ${String(c.id) === String(select.value) ? 'active' : ''}" data-np-cat="${c.id}"><span class="dot" style="background:${CAT_DOTS[i % CAT_DOTS.length]}"></span>${escHtml(c.name)}</button>`).join('');

    if (otherCats.length > 0) {
        html += `<div class="pos-cat-dropdown-wrap" style="position:relative;display:inline-flex;align-items:center;">
            <select class="pos-category-select ui-chip ui-chip--lg ${isOtherSelected ? 'active' : ''}" id="np-more-cats-select" aria-label="Otras categorías">
                <option value="" ${!isOtherSelected ? 'selected' : ''}>Otras (${otherCats.length}) ▾</option>
                ${otherCats.map(c => `<option value="${c.id}" ${String(c.id) === String(select.value) ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}
            </select>
        </div>`;
    }

    host.innerHTML = html;

    host.querySelectorAll('[data-np-cat]').forEach(btn => btn.addEventListener('click', () => {
        select.value = btn.dataset.npCat;
        renderNpCategoryChips();
        updateNewProductPreview();
        const pv = document.getElementById('np-preview');
        pv?.animate && pv.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 380 });
    }));

    const moreSelect = document.getElementById('np-more-cats-select');
    if (moreSelect) {
        moreSelect.addEventListener('change', () => {
            const val = moreSelect.value;
            if (val) {
                select.value = val;
                renderNpCategoryChips();
                updateNewProductPreview();
                const pv = document.getElementById('np-preview');
                pv?.animate && pv.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 380 });
            }
        });
    }
}

// Mismo criterio que el servidor (routes/products.js): ID de categoría × 1000 + secuencial
function estimateProductCode(categoryId) {
    if (!categoryId) return '—';
    const base = categoryId * 1000;
    let maxSeq = 0;
    adminAllProducts.forEach(p => {
        if (!/^\d+$/.test(String(p.code || ''))) return;
        const n = parseInt(p.code, 10);
        if (n > base && n < base + 1000) maxSeq = Math.max(maxSeq, n - base);
    });
    return String(base + maxSeq + 1).padStart(6, '0');
}

function updateNewProductPreview() {
    const val = id => document.getElementById(id)?.value || '';
    const cost = Number(val('new-product-cost')) || 0, price = Number(val('new-product-price')) || 0;
    const stock = parseInt(val('new-product-stock')) || 0;
    const margin = price > 0 ? Math.round((price - cost) / price * 100) : 0;
    const code = estimateProductCode(parseInt(val('new-product-category')));
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('np-pv-code', code); set('np-pv-code2', code);
    set('np-pv-stock', stock);
    set('np-pv-name', val('new-product-name').trim() || 'Nombre del producto');
    set('np-pv-brand', val('new-product-brand').trim() || 'Marca');
    set('np-pv-price', fmt(price));
    set('np-pv-profit', fmt(price - cost));
    set('np-pv-margin', `${margin}%`);
    set('np-pv-invest', fmt(cost * stock));
    const bar = document.getElementById('np-pv-margin-bar');
    if (bar) {
        bar.style.width = `${Math.max(0, Math.min(100, margin))}%`;
        bar.style.background = margin < 20 ? 'var(--orange)' : margin < 40 ? 'var(--yellow)' : 'var(--blue-soft)';
    }
    const save = document.getElementById('save-new-product-btn');
    const valid = val('new-product-name').trim() && price > 0 && val('new-product-category');
    if (save) save.style.background = valid ? '' : 'rgba(255,255,255,.16)';
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
    if (price < cost) { showToast("El precio de venta no debe ser menor que el costo", "error"); return; }
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
        window.dispatchEvent(new CustomEvent('product:created', { detail: result.data }));
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
// Galería del producto (solo desde vistas de administración: Administración e Inventario)
export function openProductGallery(productId, { onChange } = {}) {
    const p = findAdminProduct(productId);
    if (!p) return;
    const stock = parseInt(p.stock) || 0, min = parseInt(p.min_stock) || 0;
    const badge = stock === 0
        ? '<span class="md-badge out">Agotado · stock 0</span><span>Sigue visible y editable</span>'
        : stock <= min ? `<span class="md-badge low">Stock bajo · ${stock}</span>` : `<span class="md-badge">Stock ${stock}</span>`;
    openMediaGallery({
        type: 'product', ownerId: p.id, title: p.name,
        meta: [`Cód. ${p.code}`, p.category_name].filter(Boolean).join(' · '),
        badgeHtml: badge,
        onChange: async () => {
            productMedia = await fetchMediaSummary('product');
            filterAdminProducts();
            onChange && onChange(productMedia);
            window.dispatchEvent(new CustomEvent('media:changed', { detail: { type: 'product', id: p.id } }));
        }
    });
}

window.openAddStock = openAddStock;
window.openPriceHistory = openPriceHistory;
window.openEditProduct = openEditProduct;
window.editCategory = editCategory;
window.openEditCategory = openEditCategory;
window.deleteCategory = deleteCategory;
window.deleteProduct = deleteProduct;
window.openRenameType = openRenameType;
window.openVoidWithdrawal = openVoidWithdrawal;

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
function reportRange() {
    const period = document.getElementById("report-period")?.value || 'month';
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
        if (!from || !to) return null;
        startDate = new Date(from + 'T00:00:00');
        endDate = new Date(to + 'T23:59:59');
    }
    return { period, startDate, endDate };
}

const REPORT_LABELS = { today: 'hoy', yesterday: 'ayer', week: 'esta semana', month: 'este mes', custom: 'personalizado' };
let reportRaw = null;

async function renderReportPreview() {
    const host = document.getElementById("report-preview");
    if (!host) return;
    const label = document.getElementById("report-preview-label");
    const range = reportRange();
    if (label) label.textContent = REPORT_LABELS[document.getElementById("report-period")?.value] || '';
    if (!range) { host.innerHTML = '<div class="ui-empty">Elige las dos fechas</div>'; return; }
    try {
        if (!reportRaw) reportRaw = await (await fetch('/api/dashboard/raw')).json();
        const evs = buildProfitEvents(reportRaw).filter(ev => { const d = parseDate(ev.date); return d && d >= range.startDate && d <= range.endDate; });
        const v = sumBy(evs.filter(e => e.kind === 'venta'), 'profit');
        const r = sumBy(evs.filter(e => e.kind === 'reparacion'), 'profit');
        const rv = sumBy(evs.filter(e => e.kind === 'revalorizacion'), 'profit');
        const rows = [['Ventas', v, '#d6451b'], ['Reparaciones', r, '#2b4f9e'], ['Revalorización de stock', rv, '#f0c132'], ['Total', safeAdd(safeAdd(v, r), rv), '#17171a']];
        host.innerHTML = rows.map(([l, val, c], i) => `<div class="ui-list-row" style="grid-template-columns:1fr auto;${i === 3 ? 'font-weight:500' : ''}"><span style="display:flex;align-items:center;gap:10px"><span class="ui-dot" style="background:${c}"></span>${l}</span><span class="tnum">${money(val, 0)}</span></div>`).join('');
    } catch (e) { host.innerHTML = '<div class="ui-empty">No se pudo calcular la vista previa</div>'; }
}

async function generateAccountingReport() {
    const range = reportRange();
    if (!range) { showToast("Selecciona ambas fechas", "error"); return; }
    const { period, startDate, endDate } = range;

    const btn = document.getElementById("generate-report-btn");
    btn.innerHTML = "Generando…";
    btn.disabled = true;

    try {
        // Buffer de 2 días para la consulta SQL (evita problemas de Timezone en DB)
        const dbStart = new Date(startDate);
        dbStart.setDate(dbStart.getDate() - 2);
        const isoStart = dbStart.toISOString();

        const { data: productos } = await supabase.from('products').select('id, cost_price');
        const { data: allSales } = await supabase.from('sales').select('id, total_amount, created_at').gte('created_at', isoStart);
        // Todas las reparaciones + su historial: el adelanto entra al marcar TERMINADO (puede ser mucho después del ingreso)
        const { data: allRepairs } = await supabase.from('repairs').select('*');
        const { data: repairHistory } = await supabase.from('repair_status_history').select('repair_id, status, changed_at');
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

        const inReportRange = date => { const d = new Date(date); return d >= startDate && d <= endDate; };
        const repEvents = buildProfitEvents({ reparaciones: allRepairs || [], historialReparaciones: repairHistory || [] })
            .filter(ev => ev.kind === 'reparacion' && inReportRange(ev.date));
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
        // Misma regla que el Resumen y Caja (finance.js): adelanto al terminar, saldo al entregar
        const ingresosReparaciones = sumBy(repEvents, 'income');
        const costosReparaciones = sumBy(repEvents, 'cost');
        const gananciaReparaciones = safeSubtract(ingresosReparaciones, costosReparaciones);

        // --- LÓGICA DE DESGLOSE (ESTADO DE CUENTA) ---
        const durationDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
        let breakdownHTML = '';
        const totalsFoot = `<tfoot><tr><td>Total</td><td class="r">${fmt(totalIngresosVentas)}</td><td class="r neg">${fmt(costoTotalVentas)}</td><td class="r">${fmt(gananciaVentas)}</td><td class="r">${fmt(gananciaReparaciones)}</td><td class="r b">${fmt(safeAdd(gananciaVentas, gananciaReparaciones))}</td></tr></tfoot>`;

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
                    <td><div class="desc">${desc.join(', ')}</div></td>
                    <td class="r">${fmt(vTotal)}</td>
                    <td class="r neg">${fmt(vCost)}</td>
                    <td class="r">${fmt(vProfit)}</td>
                </tr>`;
            });

            breakdownHTML = `
                <div class="sec"><span class="lbl">Detalle de ventas del día</span>
                    <table class="bt">
                        <thead>
                            <tr><th>Hora</th><th>Productos vendidos</th><th class="r">Ingreso</th><th class="r">Costo</th><th class="r">Ganancia</th></tr>
                        </thead>
                        <tbody>
                            ${salesRows || '<tr><td colspan="5" class="empty">No hay ventas registradas en este día.</td></tr>'}
                        </tbody>
                        ${salesRows ? `<tfoot><tr><td colspan="2">Total</td><td class="r">${fmt(totalIngresosVentas)}</td><td class="r neg">${fmt(costoTotalVentas)}</td><td class="r">${fmt(gananciaVentas)}</td></tr></tfoot>` : ''}
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

            repEvents.forEach(ev => {
                const k = new Date(ev.date).toLocaleDateString('es-PE');
                if(!dailyData[k]) dailyData[k] = { i: 0, c: 0, gt: 0 };
                dailyData[k].gt += ev.profit;
            });

            let dailyRows = '';
            Object.keys(dailyData).forEach(k => {
                const day = dailyData[k];
                const ganVentas = day.i - day.c;
                if (day.i === 0 && day.c === 0 && day.gt === 0) return;
                dailyRows += `<tr>
                    <td>${k}</td>
                    <td class="r">${fmt(day.i)}</td>
                    <td class="r neg">${fmt(day.c)}</td>
                    <td class="r">${fmt(ganVentas)}</td>
                    <td class="r">${fmt(day.gt)}</td>
                    <td class="r b">${fmt(ganVentas + day.gt)}</td>
                </tr>`;
            });

            breakdownHTML = `
                <div class="sec"><span class="lbl">Desglose diario</span>
                    <table class="bt">
                        <thead>
                            <tr><th>Fecha</th><th class="r">Ing. ventas</th><th class="r">Cost. ventas</th><th class="r">Gan. ventas</th><th class="r">Gan. taller</th><th class="r">Total neto</th></tr>
                        </thead>
                        <tbody>
                            ${dailyRows || '<tr><td colspan="6" class="empty">No hay movimientos en este periodo.</td></tr>'}
                        </tbody>
                        ${dailyRows ? totalsFoot : ''}
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

            repEvents.forEach(ev => {
                const k = getWeekKey(new Date(ev.date));
                if (weeklyData[k]) weeklyData[k].gt += ev.profit;
            });

            let weeklyRows = '';
            Object.keys(weeklyData).forEach(k => {
                const wk = weeklyData[k];
                const ganVentas = wk.i - wk.c;
                if (wk.i === 0 && wk.c === 0 && wk.gt === 0) return;
                weeklyRows += `<tr>
                    <td>${k}</td>
                    <td class="r">${fmt(wk.i)}</td>
                    <td class="r neg">${fmt(wk.c)}</td>
                    <td class="r">${fmt(ganVentas)}</td>
                    <td class="r">${fmt(wk.gt)}</td>
                    <td class="r b">${fmt(ganVentas + wk.gt)}</td>
                </tr>`;
            });

            breakdownHTML = `
                <div class="sec"><span class="lbl">Desglose semanal</span>
                    <table class="bt">
                        <thead>
                            <tr><th>Semana</th><th class="r">Ing. ventas</th><th class="r">Cost. ventas</th><th class="r">Gan. ventas</th><th class="r">Gan. taller</th><th class="r">Total neto</th></tr>
                        </thead>
                        <tbody>
                            ${weeklyRows || '<tr><td colspan="6" class="empty">No hay movimientos en este mes.</td></tr>'}
                        </tbody>
                        ${weeklyRows ? totalsFoot : ''}
                    </table>
                </div>
            `;
        }

        // Documento A4 con el lenguaje de la marca (se imprime en un iframe aparte)
        const totalNeto = safeAdd(safeAdd(gananciaVentas, gananciaInversion), gananciaReparaciones);
        const dfmt = d => d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const periodName = { today: 'Hoy', yesterday: 'Ayer', week: 'Esta semana', month: 'Este mes', custom: 'Personalizado' }[period] || '';
        const neg = v => `<span class="neg">− ${fmt(v)}</span>`;
        const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Cuadre contable ${dfmt(startDate)} – ${dfmt(endDate)}</title>
            <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
            <style>
                @page { size: A4; margin: 14mm 15mm; }
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: 'Outfit', Arial, sans-serif; color: #17171a; font-size: 13px; display: flex; flex-direction: column; gap: 22px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .top { display: flex; justify-content: space-between; align-items: flex-start; }
                .brand { display: flex; align-items: center; gap: 12px; }
                .mark { width: 40px; height: 40px; border-radius: 11px; background: #17171a; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 500; font-size: 20px; }
                .muted { color: #6f6a62; font-size: 12px; }
                h1 { font-size: 40px; font-weight: 500; letter-spacing: -.035em; line-height: 1; border-top: 2px solid #17171a; padding-top: 18px; }
                .kpis { display: grid; grid-template-columns: 1.3fr 1fr 1fr 1fr; gap: 10px; }
                .kpi { border: 1px solid rgba(23,23,26,.12); border-radius: 18px; padding: 16px; display: flex; flex-direction: column; gap: 4px; }
                .kpi.main { background: #2b4f9e; color: #fff; border: none; }
                .kpi .k { font-size: 12px; color: #6f6a62; display: flex; align-items: center; gap: 6px; }
                .kpi.main .k { color: rgba(255,255,255,.75); }
                .kpi .v { font-size: 20px; font-weight: 500; }
                .kpi.main .v { font-size: 28px; letter-spacing: -.02em; }
                .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
                .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
                .sec { display: flex; flex-direction: column; gap: 6px; break-inside: avoid; }
                .lbl { font-size: 12px; color: #6f6a62; }
                .ln { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid rgba(23,23,26,.1); font-variant-numeric: tabular-nums; }
                .ln.t { border-top: 1.5px solid #17171a; font-size: 14px; font-weight: 600; }
                .neg { color: #b33a16; }
                table.bt { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
                .bt th { font-size: 11px; font-weight: 400; color: #6f6a62; text-align: left; padding: 8px 6px; border-bottom: 1.5px solid #17171a; }
                .bt td { padding: 9px 6px; border-bottom: 1px solid rgba(23,23,26,.1); vertical-align: top; }
                .bt tfoot td { border-bottom: none; font-weight: 600; padding-top: 10px; }
                .bt .r { text-align: right; white-space: nowrap; }
                .bt .b { font-weight: 600; }
                .bt .desc { max-width: 260px; font-size: 12px; color: #6f6a62; }
                .bt .empty { text-align: center; color: #8b857b; padding: 16px; }
                .foot { display: flex; justify-content: space-between; border-top: 1px solid rgba(23,23,26,.12); padding-top: 14px; font-size: 11px; color: #6f6a62; }
            </style></head><body>
            <div class="top">
                <div class="brand"><div class="mark">J</div><div style="display:flex;flex-direction:column"><span style="font-size:18px;font-weight:600;letter-spacing:-.02em">Reparaciones Juan</span><span class="muted">inventariopro · Tel: 923 180 186</span></div></div>
                <div style="text-align:right;display:flex;flex-direction:column;gap:2px"><span class="muted">Período</span><span style="font-size:15px;font-weight:500">${dfmt(startDate)} – ${dfmt(endDate)}</span><span class="muted">${periodName}</span></div>
            </div>
            <h1>Cuadre contable</h1>
            <div class="kpis">
                <div class="kpi main"><span class="k">Ganancia total neta</span><span class="v">${fmt(totalNeto)}</span></div>
                <div class="kpi"><span class="k"><span class="dot" style="background:#d6451b"></span>Ventas</span><span class="v">${fmt(gananciaVentas)}</span></div>
                <div class="kpi"><span class="k"><span class="dot" style="background:#2b4f9e"></span>Taller</span><span class="v">${fmt(gananciaReparaciones)}</span></div>
                <div class="kpi"><span class="k"><span class="dot" style="background:#f0c132"></span>Revalorización</span><span class="v">${fmt(gananciaInversion)}</span></div>
            </div>
            <div class="cols">
                <div class="sec"><span class="lbl">1 · Flujo de ventas</span>
                    <div class="ln"><span>Total ingresos por ventas</span><span>${fmt(totalIngresosVentas)}</span></div>
                    <div class="ln"><span>Costo de mercadería vendida</span>${neg(costoTotalVentas)}</div>
                    <div class="ln t"><span>Ganancia operativa ventas</span><span>${fmt(gananciaVentas)}</span></div>
                </div>
                <div class="sec"><span class="lbl">3 · Flujo de taller</span>
                    <div class="ln"><span>Cobrado (adelantos + saldos)</span><span>${fmt(ingresosReparaciones)}</span></div>
                    <div class="ln"><span>Insumos y terceros</span>${neg(costosReparaciones)}</div>
                    <div class="ln t"><span>Ganancia neta taller</span><span>${fmt(gananciaReparaciones)}</span></div>
                </div>
            </div>
            <div class="sec"><span class="lbl">2 · Revalorización de inventario</span>
                <div class="ln"><span>Ganancia/pérdida por variación de costo en stock existente</span><span style="font-weight:600">${fmt(gananciaInversion)}</span></div>
            </div>
            ${breakdownHTML}
            <div class="foot"><span>Generado el ${new Date().toLocaleString('es-PE')} por ${escHtml(getSession()?.profile?.username || 'Admin')}</span><span>inventariopro</span></div>
            </body></html>`;
        printHtml(html, () => showToast("No se pudo abrir la impresión", "error"));


    } catch (e) {
        console.error(e);
        showToast("Error al generar reporte", "error");
    } finally {
        btn.innerHTML = `${icon('file', 17, 2.2)} Generar cuadre PDF`;
        btn.disabled = false;
    }
}
