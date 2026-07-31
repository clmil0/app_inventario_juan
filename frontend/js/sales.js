import { API, getHeaders, fmt, showToast } from './utils.js';

let allProducts = [], allCategories = [], selectedCategoryId = null, isSearching = false, filteredProducts = [], cart = {};
let allSales = [];

// ═══ PARSEO SEGURO DE FECHAS DE LA BD ═══
function parseDate(dateValue) {
    if (!dateValue) return null;

    try {
        // Si ya es un objeto Date
        if (dateValue instanceof Date) {
            return isNaN(dateValue.getTime()) ? null : dateValue;
        }

        // Si es string
        if (typeof dateValue === 'string') {
            const trimmed = dateValue.trim();
            if (trimmed === '' || trimmed === 'null' || trimmed === 'None') return null;

            // Formato: "dd/mm/aaaa hh:mm" o "dd/mm/aaaa hh:mm:ss"
            const regexDMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
            const match = trimmed.match(regexDMY);
            if (match) {
                const day = parseInt(match[1]);
                const month = parseInt(match[2]) - 1; // Meses en JS van de 0 a 11
                const year = parseInt(match[3]);
                const hours = parseInt(match[4]);
                const minutes = parseInt(match[5]);
                const seconds = parseInt(match[6]) || 0;

                const fecha = new Date(year, month, day, hours, minutes, seconds);
                if (!isNaN(fecha.getTime())) return fecha;
            }

            // Formato ISO: "2026-07-29T22:51:50" o "2026-07-29 22:51:50"
            let isoStr = trimmed;
            if (isoStr.includes(' ') && !isoStr.includes('T')) {
                isoStr = isoStr.replace(' ', 'T');
            }
            const fechaISO = new Date(isoStr);
            if (!isNaN(fechaISO.getTime())) return fechaISO;
        }

        // Último intento
        const fecha = new Date(dateValue);
        if (!isNaN(fecha.getTime())) return fecha;

        return null;
    } catch (e) {
        console.error("Error parseando fecha:", dateValue, e);
        return null;
    }
}

function formatDate(dateValue) {
    const fecha = parseDate(dateValue);
    if (!fecha) return "-";

    return fecha.toLocaleString('es-PE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}


// ═══ FUNCIONES DEL SLIDER (globales al módulo) ═══

function updateRangeUI() {
    const minSlider = document.getElementById("price-range-min");
    const maxSlider = document.getElementById("price-range-max");
    const minLabel = document.getElementById("range-min-label");
    const maxLabel = document.getElementById("range-max-label");
    const rangeTrack = document.querySelector(".range-slider .range-track");
    if (!minSlider || !maxSlider || !rangeTrack) return;

    let minVal = parseInt(minSlider.value) || 0;
    let maxVal = parseInt(maxSlider.value) || 0;
    if (minVal > maxVal) {
        [minVal, maxVal] = [maxVal, minVal];
        minSlider.value = minVal;
        maxSlider.value = maxVal;
    }
    if (minLabel) minLabel.textContent = minVal;
    if (maxLabel) maxLabel.textContent = maxVal;

    const max = parseInt(minSlider.max) || 1000;
    const percentMin = max > 0 ? (minVal / max) * 100 : 0;
    const percentMax = max > 0 ? (maxVal / max) * 100 : 100;
    rangeTrack.style.left = percentMin + "%";
    rangeTrack.style.width = (percentMax - percentMin) + "%";
}

window.updatePriceRangeMax = function (maxAmount) {
    const minSlider = document.getElementById("price-range-min");
    const maxSlider = document.getElementById("price-range-max");
    if (!minSlider || !maxSlider) return;
    const max = Math.ceil(maxAmount / 10) * 10 || 1000;
    minSlider.max = max;
    maxSlider.max = max;
    maxSlider.value = max;
    updateRangeUI();
};

// ═══ CARGA INICIAL ═══
export async function loadSalesView() {
    try {
        await loadCategoriesForSales();
        await loadProductsForPOS();
        await loadRecentSales();
        selectedCategoryId = null;
        renderCategoryList();
        renderProductGridByCategory();
        renderCart();
    } catch (e) {
        console.error("Error en loadSalesView:", e);
    }
}

// ═══ BINDEO DE EVENTOS ═══
export function bindSalesEvents() {
    // Elementos que pueden no existir aún
    const productSearch = document.getElementById("product-search");
    const confirmSaleBtn = document.getElementById("confirm-sale-btn");
    const clearCartBtn = document.getElementById("clear-cart-btn");
    const saleDiscount = document.getElementById("sale-discount");
    const allSalesSearch = document.getElementById("all-sales-search");
    const filterMonth = document.getElementById("filter-month");
    const filterYear = document.getElementById("filter-year");
    const filterVendor = document.getElementById("filter-vendor");
    const minSlider = document.getElementById("price-range-min");
    const maxSlider = document.getElementById("price-range-max");

    if (productSearch) {
        productSearch.addEventListener("input", e => {
            const q = e.target.value.toLowerCase().trim();
            if (q === '') {
                isSearching = false;
                renderCategoryList();
                renderProductGridByCategory();
                return;
            }
            isSearching = true;
            filteredProducts = allProducts.filter(p =>
                p.name.toLowerCase().includes(q) ||
                p.brand.toLowerCase().includes(q) ||
                p.code.toLowerCase().includes(q) ||
                (p.category_name && p.category_name.toLowerCase().includes(q))
            );
            selectedCategoryId = null;
            renderCategoryList();
            renderProductGridByCategory();
        });
    }

    if (confirmSaleBtn) confirmSaleBtn.addEventListener("click", confirmSale);
    if (clearCartBtn) clearCartBtn.addEventListener("click", () => { cart = {}; renderCart(); });
    if (saleDiscount) saleDiscount.addEventListener("input", renderCart);

    if (allSalesSearch) allSalesSearch.addEventListener("input", () => applyAllFilters());
    if (filterMonth) filterMonth.addEventListener("change", applyAllFilters);
    if (filterYear) filterYear.addEventListener("change", applyAllFilters);
    if (filterVendor) filterVendor.addEventListener("change", applyAllFilters);

    if (minSlider && maxSlider) {
        minSlider.addEventListener("input", () => { updateRangeUI(); applyAllFilters(); });
        maxSlider.addEventListener("input", () => { updateRangeUI(); applyAllFilters(); });
        updateRangeUI();
    }
}

// ═══ CATEGORÍAS ═══
async function loadCategoriesForSales() {
    try {
        const res = await fetch(`${API}/categories`);
        if (!res.ok) throw new Error("Error al cargar categorías");
        allCategories = await res.json();
    } catch (e) {
        console.error(e);
        allCategories = [];
    }
}

// ═══ PRODUCTOS ═══
async function loadProductsForPOS() {
    try {
        const res = await fetch(`${API}/products`);
        if (!res.ok) throw new Error("Error al cargar productos");
        allProducts = await res.json();
        renderFavorites();
        renderProductGridByCategory();
    } catch (e) {
        console.error(e);
        allProducts = [];
    }
}

// ═══ RENDER CATEGORÍAS ═══
function renderCategoryList() {
    const container = document.getElementById("category-list-items");
    if (!container) return;
    container.innerHTML = '';

    const allOption = document.createElement('div');
    allOption.className = `category-item ${selectedCategoryId === null ? 'active' : ''}`;
    allOption.textContent = '📂 Todas';
    allOption.addEventListener('click', () => {
        selectedCategoryId = null;
        isSearching = false;
        const ps = document.getElementById("product-search");
        if (ps) ps.value = '';
        renderCategoryList();
        renderProductGridByCategory();
    });
    container.appendChild(allOption);

    allCategories.forEach(cat => {
        const div = document.createElement('div');
        div.className = `category-item ${selectedCategoryId === cat.id ? 'active' : ''}`;
        div.textContent = cat.name;
        div.addEventListener('click', () => {
            selectedCategoryId = cat.id;
            isSearching = false;
            const ps = document.getElementById("product-search");
            if (ps) ps.value = '';
            renderCategoryList();
            renderProductGridByCategory();
        });
        container.appendChild(div);
    });
}

// ═══ RENDER PRODUCTOS ═══
function renderProductGridByCategory() {
    const container = document.getElementById("products-grid");
    if (!container) return;
    container.innerHTML = '';

    let productsToShow;
    if (isSearching) {
        productsToShow = filteredProducts;
    } else if (selectedCategoryId !== null) {
        productsToShow = allProducts.filter(p => p.category_id === selectedCategoryId);
    } else {
        productsToShow = allProducts;
    }

    productsToShow.sort((a, b) => (b.sales_count || 0) - (a.sales_count || 0));

    if (productsToShow.length === 0) {
        container.innerHTML = `<p class="text-dim" style="text-align:center;padding:2rem;">No hay productos</p>`;
        return;
    }

    productsToShow.forEach(p => createProductCard(p, container));
}

function createProductCard(product, container) {
    const card = document.createElement("div");
    card.className = `product-card ${product.stock === 0 ? "out-of-stock" : ""}`;
    card.style.cssText = 'display:flex;flex-direction:column;justify-content:space-between;position:relative';

    const favBtn = document.createElement("button");
    favBtn.className = `favorite-btn ${product.is_favorite ? "active" : ""}`;
    favBtn.innerHTML = product.is_favorite ? "★" : "☆";
    favBtn.onclick = async (e) => { e.stopPropagation(); await toggleFavorite(product.id); };

    const nameDiv = document.createElement("div");
    nameDiv.className = "product-name";
    nameDiv.textContent = product.name;

    const priceDiv = document.createElement("div");
    priceDiv.className = "product-price";
    priceDiv.textContent = fmt(product.sale_price);

    const infoDiv = document.createElement("div");
    infoDiv.className = "product-info-row";
    infoDiv.innerHTML = `<span>Stock: ${product.stock}</span><span>Cód: ${product.code}</span>`;

    card.append(nameDiv, priceDiv, infoDiv, favBtn);
    if (product.stock > 0) {
        card.addEventListener("click", () => addToCart(product));
    }
    container.appendChild(card);
}

// ═══ FAVORITOS ═══
function renderFavorites() {
    const favGrid = document.getElementById("favorites-grid");
    if (!favGrid) return;
    favGrid.innerHTML = '';
    const favs = allProducts.filter(p => p.is_favorite);
    if (favs.length === 0) {
        favGrid.innerHTML = '<p class="text-dim" style="font-size:0.8rem;padding:0.5rem;">Sin favoritos</p>';
        return;
    }
    favs.forEach(p => createProductCard(p, favGrid));
}

async function toggleFavorite(productId) {
    try {
        const res = await fetch(`${API}/products/${productId}/toggle-favorite`, {
            method: "PUT",
            headers: getHeaders()
        });
        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Error", "error");
            return;
        }
        await loadProductsForPOS();
    } catch {
        showToast("Error de conexión", "error");
    }
}

// ═══ CARRITO ═══
function addToCart(product) {
    const pid = product.id;
    if (cart[pid]) {
        if (cart[pid].quantity >= product.stock) {
            showToast(`Stock máximo (${product.stock})`, "error");
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
    const subtotalEl = document.getElementById("cart-subtotal");
    const discountRow = document.getElementById("cart-discount-row");
    const discountEl = document.getElementById("cart-discount-amount");
    const totalEl = document.getElementById("cart-total-amount");
    const discountInput = document.getElementById("sale-discount");

    if (!container) return;

    const items = Object.values(cart);

    if (items.length === 0) {
        container.innerHTML = `<p class="cart-empty">Agrega productos al carrito</p>`;
        if (subtotalEl) subtotalEl.textContent = "S/ 0.00";
        if (discountRow) discountRow.style.display = "none";
        if (totalEl) totalEl.textContent = "S/ 0.00";
        if (confirmBtn) confirmBtn.disabled = true;
        return;
    }

    let subtotal = 0;
    container.innerHTML = "";
    items.forEach(({ product, quantity }) => {
        const sub = product.sale_price * quantity;
        subtotal += sub;
        const item = document.createElement("div");
        item.className = "cart-item";
        item.innerHTML = `
            <div class="cart-item-name">${product.name}</div>
            <div class="cart-item-qty">
                <button class="qty-btn" data-pid="${product.id}" data-action="dec">−</button>
                <span class="qty-num">${quantity}</span>
                <button class="qty-btn" data-pid="${product.id}" data-action="inc">+</button>
            </div>
            <div class="cart-item-sub">${fmt(sub)}</div>`;
        container.appendChild(item);
    });

    container.querySelectorAll(".qty-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const pid = parseInt(btn.dataset.pid);
            if (btn.dataset.action === "inc") {
                if (cart[pid] && cart[pid].quantity < cart[pid].product.stock) {
                    cart[pid].quantity++;
                } else {
                    showToast("Stock máximo", "error");
                }
            } else {
                if (cart[pid]) {
                    cart[pid].quantity--;
                    if (cart[pid].quantity <= 0) delete cart[pid];
                }
            }
            renderCart();
        });
    });

    let discount = parseFloat(discountInput?.value) || 0;
    if (discount < 0) discount = 0;
    if (discount > subtotal) discount = subtotal;

    if (subtotalEl) subtotalEl.textContent = fmt(subtotal);
    if (discountRow && discountEl) {
        if (discount > 0) {
            discountRow.style.display = "flex";
            discountEl.textContent = "- " + fmt(discount);
        } else {
            discountRow.style.display = "none";
        }
    }
    if (totalEl) totalEl.textContent = fmt(subtotal - discount);
    if (confirmBtn) confirmBtn.disabled = false;
}

// ═══ CONFIRMAR VENTA ═══
async function confirmSale() {
    const items = Object.values(cart).map(({ product, quantity }) => ({
        product_id: product.id,
        quantity
    }));
    const customerInput = document.getElementById("sale-customer");
    const discountInput = document.getElementById("sale-discount");
    const customerName = customerInput?.value?.trim() || "Cliente Anónimo";
    const discount = parseFloat(discountInput?.value) || 0;

    try {
        const res = await fetch(`${API}/sales`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({
                customer_name: customerName,
                items,
                discount_amount: discount
            })
        });
        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Error", "error");
            return;
        }
        const sale = await res.json();

        const ticketEl = document.getElementById("sale-success-ticket");
        const detailEl = document.getElementById("sale-success-detail");
        const receiptLink = document.getElementById("sale-receipt-link");
        const modal = document.getElementById("sale-success-modal");

        if (ticketEl) ticketEl.textContent = `Ticket: ${sale.ticket_code}`;
        if (detailEl) {
            detailEl.innerHTML = `
                <div>Subtotal: ${fmt(sale.subtotal_amount)}</div>
                ${sale.discount_amount > 0 ? `<div style="color:var(--accent-red)">Descuento: -${fmt(sale.discount_amount)}</div>` : ''}
                <div style="font-size:1.5rem;font-weight:800;color:var(--accent-green);">Total: ${fmt(sale.total_amount)}</div>`;
        }
        if (receiptLink) receiptLink.href = `${API}/receipts/sale/${sale.id}/png`;
        if (modal) modal.classList.remove("hidden");

        cart = {};
        if (customerInput) customerInput.value = "";
        if (discountInput) discountInput.value = "";
        renderCart();
        await loadProductsForPOS();
        await loadRecentSales();
    } catch {
        showToast("Error de conexión", "error");
    }
}

// ═══ HISTORIAL DE VENTAS ═══
async function loadRecentSales() {
    try {
        const res = await fetch(`${API}/sales`);
        if (!res.ok) throw new Error("Error al cargar ventas");
        allSales = await res.json();
        allSales.reverse();
        populateFilterOptions();
        applyAllFilters();
    } catch (e) {
        console.error(e);
        allSales = [];
    }
}

function populateFilterOptions() {
    const yearSelect = document.getElementById("filter-year");
    if (yearSelect) {
        const years = [...new Set(allSales.map(s => {
            const fecha = parseDate(s.created_at);
            return fecha ? fecha.getFullYear() : null;
        }).filter(Boolean))].sort((a, b) => b - a);
        yearSelect.innerHTML = '<option value="">Todos</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
    }

    const vendorSelect = document.getElementById("filter-vendor");
    if (vendorSelect) {
        const vendors = [...new Set(allSales.map(s => s.operator_name).filter(Boolean))].sort();
        vendorSelect.innerHTML = '<option value="">Todos</option>' + vendors.map(v => `<option value="${v}">${v}</option>`).join('');
    }

    const maxTotal = allSales.length > 0 ? Math.max(...allSales.map(s => s.total_amount || 0)) : 1000;
    if (window.updatePriceRangeMax) window.updatePriceRangeMax(maxTotal);
}

function applyAllFilters() {
    const searchInput = document.getElementById("all-sales-search");
    const monthSelect = document.getElementById("filter-month");
    const yearSelect = document.getElementById("filter-year");
    const vendorSelect = document.getElementById("filter-vendor");
    const minSlider = document.getElementById("price-range-min");
    const maxSlider = document.getElementById("price-range-max");

    const searchQ = searchInput?.value?.toLowerCase() || "";
    const month = monthSelect?.value || "";
    const year = yearSelect?.value || "";
    const vendor = vendorSelect?.value || "";
    const minPrice = parseInt(minSlider?.value) || 0;
    const maxPrice = parseInt(maxSlider?.value) || Infinity;

    let filtered = allSales.filter(s => {
        const matchSearch = !searchQ ||
            (s.customer_name && s.customer_name.toLowerCase().includes(searchQ)) ||
            (s.ticket_code && s.ticket_code.toLowerCase().includes(searchQ)) ||
            (s.operator_name && s.operator_name.toLowerCase().includes(searchQ));
        if (!matchSearch) return false;

        if (month || year) {
            const fecha = parseDate(s.created_at);
            if (!fecha) return false;
            if (month && fecha.getMonth() + 1 !== parseInt(month)) return false;
            if (year && fecha.getFullYear() !== parseInt(year)) return false;
        }

        if (vendor && s.operator_name !== vendor) return false;
        if ((s.total_amount || 0) < minPrice || (s.total_amount || 0) > maxPrice) return false;

        return true;
    });

    renderAllSalesTable(filtered);
}

function renderAllSalesTable(sales) {
    const tbody = document.getElementById("all-sales-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (sales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-dim);">No se encontraron ventas</td></tr>';
        return;
    }
    sales.forEach(s => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${s.ticket_code || "-"}</td>
            <td>${formatDate(s.created_at)}</td>
            <td>${s.customer_name || "-"}</td>
            <td>${s.operator_name || "-"}</td>
            <td>${fmt(s.total_amount || 0)}</td>
            <td><button class="btn-outline btn-sm" onclick="showReceiptModal('${API}/receipts/sale/${s.id}/png')">Ver Boleta</button></td>`;
        tbody.appendChild(tr);
    });
}
