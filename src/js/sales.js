import { getSession, fmt, showToast } from './supabase.js';
import { safeAdd, safeSubtract, safeMultiply } from './math.js';
import { esc, money, icon, parseDate, fmtDay, fmtTime, stagger, pulse, shake, openDrawer, closeDrawer } from './ui.js';

let allProducts = [], allCategories = [], selectedCategoryId = null, cart = {};
let cartOrder = [];
let allSales = [];
let showCostView = false;
let lastSaleData = null;
let posQuery = '';

// Historial
let histPeriod = 'month', histPay = 'Todos', histVendor = 'Todos', histLimit = 40;
const PAY_LABEL = { 'Caja': 'Caja (efectivo)', 'Yape/Plin': 'Yape / Plin', 'Transferencia': 'Transferencia', 'POS': 'Tarjeta (POS)' };
const PAY_METHODS = ['Caja', 'Yape/Plin', 'Transferencia', 'POS'];

export async function loadSalesView() {
    await Promise.all([
        loadCategoriesForSales(),
        loadProductsForPOS(),
        loadRecentSales()
    ]);
    selectedCategoryId = null;
    posQuery = '';
    renderCategoryList();
    renderProductGridByCategory(true);
    renderCart();
}

function setMode(mode) {
    const pos = document.getElementById('pos-main-layout');
    const hist = document.getElementById('sales-history-layout');
    if (!pos || !hist) return;
    document.getElementById('tab-pos')?.classList.toggle('active', mode === 'pos');
    document.getElementById('tab-hist')?.classList.toggle('active', mode === 'hist');
    pos.style.display = mode === 'pos' ? '' : 'none';
    hist.style.display = mode === 'hist' ? '' : 'none';
    const root = mode === 'pos' ? pos : hist;
    stagger(root.querySelectorAll('[data-anim]'), 0, 60);
    if (mode === 'hist') { applyAllFilters(); stagger(document.querySelectorAll('#all-sales-tbody > *'), 150, 30, 600); }
}

export function bindSalesEvents() {
    document.getElementById('tab-pos')?.addEventListener('click', () => setMode('pos'));
    document.getElementById('tab-hist')?.addEventListener('click', () => setMode('hist'));

    const search = document.getElementById("product-search");
    search?.addEventListener("input", e => {
        posQuery = e.target.value.toLowerCase().trim();
        renderProductGridByCategory(true);
    });

    search?.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();
            const q = e.target.value.trim();
            if (q) {
                const exactMatch = allProducts.find(p => (p.code || '').toLowerCase() === q.toLowerCase());
                if (exactMatch) {
                    addToCart(exactMatch);
                    e.target.value = '';
                    e.target.dispatchEvent(new Event("input"));
                    showToast(`Agregado: ${exactMatch.name}`, 'success');
                }
            }
        }
    });

    // Soporte global para lectores de código de barras
    if (!window._globalSalesEventsBound) {
        window._globalSalesEventsBound = true;
        let barcodeString = '';
        let barcodeTimeout = null;
        document.addEventListener("keydown", e => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
            if (!document.getElementById('pos-main-layout')) return;
            if (e.key === "Enter") {
                if (barcodeString.length > 2) {
                    const exactMatch = allProducts.find(p => (p.code || '').toLowerCase() === barcodeString.toLowerCase());
                    if (exactMatch) {
                        addToCart(exactMatch);
                        showToast(`Escaneado: ${exactMatch.name}`, 'success');
                    } else {
                        showToast(`Código no encontrado: ${barcodeString}`, 'error');
                    }
                    barcodeString = '';
                }
            } else if (e.key.length === 1) {
                barcodeString += e.key;
                if (barcodeTimeout) clearTimeout(barcodeTimeout);
                barcodeTimeout = setTimeout(() => { barcodeString = ''; }, 60);
            }
        });
        document.getElementById("print-receipt-btn")?.addEventListener("click", () => { if (lastSaleData) printReceipt(lastSaleData); });
    }

    document.getElementById("confirm-sale-btn")?.addEventListener("click", confirmSale);
    document.getElementById("clear-cart-btn")?.addEventListener("click", () => { cart = {}; cartOrder = []; renderCart(); renderProductGridByCategory(); renderFavorites(); });
    document.getElementById("sale-discount")?.addEventListener("input", renderCart);

    const saleBtn = document.getElementById("pos-view-sale");
    const costBtn = document.getElementById("pos-view-cost");
    function applyPricingView(isCost) {
        showCostView = isCost;
        costBtn?.classList.toggle("active", isCost);
        saleBtn?.classList.toggle("active", !isCost);
        renderProductGridByCategory(true);
        renderFavorites();
        renderCart();
        applyAllFilters();
    }
    saleBtn?.addEventListener("click", () => applyPricingView(false));
    costBtn?.addEventListener("click", () => applyPricingView(true));

    // Medio de pago
    document.querySelectorAll('#pos-pay-options [data-pay]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#pos-pay-options [data-pay]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('sale-payment-method').value = btn.dataset.pay;
        });
    });

    // Vendedor (cápsula deslizante)
    const syncSeller = () => {
        const radios = [...document.querySelectorAll('input[name="sale-active-seller"]')];
        const idx = Math.max(0, radios.findIndex(r => r.checked));
        const slider = document.querySelector('#pos-sellers .slider');
        if (slider) slider.style.transform = `translateX(${idx * 100}%)`;
        document.querySelectorAll('#pos-sellers label').forEach((l, i) => l.classList.toggle('active', i === idx));
    };
    document.querySelectorAll('input[name="sale-active-seller"]').forEach(r => r.addEventListener('change', syncSeller));
    syncSeller();

    // Historial
    document.getElementById("all-sales-search")?.addEventListener("input", () => { histLimit = 40; applyAllFilters(true); });
    document.querySelectorAll('#hist-periods [data-period]').forEach(btn => {
        btn.addEventListener('click', () => {
            histPeriod = btn.dataset.period; histLimit = 40;
            document.querySelectorAll('#hist-periods [data-period]').forEach(b => b.classList.toggle('active', b === btn));
            const custom = document.getElementById('hist-custom');
            custom?.classList.toggle('hidden', histPeriod !== 'custom');
            if (histPeriod === 'custom' && custom?.animate) custom.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
            applyAllFilters(true);
        });
    });
    const today = new Date();
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const from = document.getElementById('hist-from'), to = document.getElementById('hist-to');
    if (from) from.value = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7));
    if (to) to.value = iso(today);
    from?.addEventListener('change', () => applyAllFilters(true));
    to?.addEventListener('change', () => applyAllFilters(true));

    document.getElementById("load-more-sales-btn")?.addEventListener("click", () => { histLimit += 40; applyAllFilters(); });
}

async function loadCategoriesForSales() {
    try {
        const response = await fetch('/api/products/categories');
        const data = await response.json();
        allCategories = data || [];
        const savedOrder = JSON.parse(localStorage.getItem('pos_category_order') || '[]');
        if (savedOrder.length > 0) {
            allCategories.sort((a, b) => {
                let idxA = savedOrder.indexOf(a.id);
                let idxB = savedOrder.indexOf(b.id);
                if (idxA === -1) idxA = 9999;
                if (idxB === -1) idxB = 9999;
                return idxA - idxB;
            });
        }
    } catch (e) { console.error(e); }
}

async function loadProductsForPOS() {
    try {
        const response = await fetch('/api/products');
        const data = await response.json();
        allProducts = data?.map(p => ({
            ...p,
            category_name: p.category_name ?? p.categories?.name
        })) || [];
        // Si el stock bajó (otra venta), recorta el carrito
        Object.keys(cart).forEach(pid => {
            const fresh = allProducts.find(p => p.id === +pid);
            if (!fresh) { delete cart[pid]; return; }
            cart[pid].product = fresh;
            if (cart[pid].quantity > fresh.stock) cart[pid].quantity = fresh.stock;
            if (cart[pid].quantity <= 0) delete cart[pid];
        });
        cartOrder = cartOrder.filter(id => cart[id]);
        renderFavorites();
        renderProductGridByCategory();
    } catch (e) { console.error(e); }
}

function renderCategoryList() {
    const host = document.getElementById("pos-category-chips");
    if (!host) return;
    const count = id => allProducts.filter(p => p.category_id === id).length;
    const cats = [{ id: null, name: 'Todas', n: allProducts.length }, ...allCategories.map(c => ({ id: c.id, name: c.name, n: count(c.id) })).filter(c => c.n > 0)];
    if (selectedCategoryId !== null && !cats.some(c => c.id === selectedCategoryId)) selectedCategoryId = null;
    host.innerHTML = cats.map(c => `<button class="ui-chip ui-chip--glass ${c.id === selectedCategoryId ? 'active' : ''}" data-cat="${c.id ?? ''}">${esc(c.name)}<span class="n">${c.n}</span></button>`).join('');
    host.querySelectorAll('[data-cat]').forEach(btn => btn.addEventListener('click', () => {
        selectedCategoryId = btn.dataset.cat === '' ? null : parseInt(btn.dataset.cat);
        host.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('active', b === btn));
        renderProductGridByCategory(true);
    }));
}

function visibleProducts() {
    return allProducts.filter(p => {
        if (selectedCategoryId !== null && p.category_id !== selectedCategoryId) return false;
        if (!posQuery) return true;
        return (p.name || '').toLowerCase().includes(posQuery) || (p.brand || '').toLowerCase().includes(posQuery) ||
            (p.code || '').toLowerCase().includes(posQuery) || (p.category_name || '').toLowerCase().includes(posQuery);
    }).sort((a, b) => (b.sales_count || 0) - (a.sales_count || 0) || (a.name || '').localeCompare(b.name || ''));
}

function lockState(p) {
    const inCart = cart[p.id]?.quantity || 0;
    const left = (parseInt(p.stock) || 0) - inCart;
    return { inCart, left, blocked: left <= 0 };
}

function stockBadge(p, dark = false) {
    const L = lockState(p);
    const stock = parseInt(p.stock) || 0, min = parseInt(p.min_stock) || 0;
    if (stock === 0) return ['out', 'Agotado'];
    if (L.blocked) return ['full', 'Todo en carrito'];
    if (stock <= min) return ['low', `Stock ${L.left}`];
    return [dark ? 'ok-dark' : 'ok', `Stock ${L.left}`];
}

const STAR_ON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#f0c132" stroke="#f0c132" stroke-width="1.5"><path d="${'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'}"></path></svg>`;
const STAR_OFF = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>`;

function productCardHtml(p, fav) {
    const L = lockState(p);
    const [cls, txt] = stockBadge(p, fav);
    const iconD = L.blocked ? 'lock' : 'plus';
    const main = showCostView ? money(p.cost_price) : money(p.sale_price);
    const margin = safeSubtract(p.sale_price || 0, p.cost_price || 0);
    const pct = p.sale_price > 0 ? Math.round(margin / p.sale_price * 100) : 0;
    if (fav) {
        return `<button class="pos-fav ${L.blocked ? 'blocked' : ''}" data-pid="${p.id}" ${L.blocked ? 'aria-disabled="true"' : ''}>
            <span class="top"><span class="code">Cód. ${esc(p.code)}</span><span class="pos-stock ${cls}">${txt}</span></span>
            <span class="name">${esc(p.name)}</span>
            <span class="bottom"><span class="price">${main}</span><span class="add">${icon(iconD, 14, 2.2)}</span></span>
        </button>`;
    }
    return `<button class="pos-card ${L.blocked ? 'blocked' : ''}" data-pid="${p.id}" ${L.blocked ? 'aria-disabled="true"' : ''}>
        <span class="top"><span class="code">Cód. ${esc(p.code)}<span class="fav-toggle" data-fav="${p.id}" title="${p.is_favorite ? 'Quitar de frecuentes' : 'Agregar a frecuentes'}">${p.is_favorite ? STAR_ON : STAR_OFF}</span></span><span class="pos-stock ${cls}">${txt}</span></span>
        <span class="name">${esc(p.name)}</span>
        <span class="brand">${esc(p.brand || 'General')}</span>
        <span class="bottom">
            <span class="prices"><span class="price">${main}</span>${showCostView ? `<span class="sub">Margen ${money(margin)} · ${pct}%</span>` : ''}</span>
            <span class="add">${icon(iconD, 14, 2.2)}</span>
        </span>
    </button>`;
}

function bindCard(el) {
    el.addEventListener('click', async e => {
        const favBtn = e.target.closest('[data-fav]');
        if (favBtn) { e.stopPropagation(); await toggleFavorite(parseInt(favBtn.dataset.fav)); return; }
        const p = allProducts.find(x => x.id === parseInt(el.dataset.pid));
        if (!p) return;
        if (lockState(p).blocked) { shake(el); return; }
        if (el.animate) el.animate([{ transform: 'scale(.95)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.3,1.5,.5,1)' });
        addToCart(p);
    });
}

function bindCardClicks(container) {
    container?.querySelectorAll('[data-pid]').forEach(bindCard);
}

function renderProductGridByCategory(animate = false) {
    const container = document.getElementById("products-grid");
    if (!container) return;
    const list = visibleProducts();
    const countEl = document.getElementById('pos-count');
    if (countEl) countEl.textContent = `${list.length} productos`;
    if (list.length === 0) {
        container.innerHTML = `<div class="ui-empty" style="grid-column:1/-1">No hay productos</div>`;
        return;
    }
    container.innerHTML = list.map(p => productCardHtml(p, false)).join('');
    bindCardClicks(container);
    if (animate) stagger(container.children, 0, 25, 600);
}

function renderFavorites() {
    const favGrid = document.getElementById("favorites-grid");
    if (!favGrid) return;
    const favs = allProducts.filter(p => p.is_favorite);
    document.getElementById('favorites-section')?.classList.toggle('hidden', favs.length === 0);
    favGrid.innerHTML = favs.map(p => productCardHtml(p, true)).join('');
    bindCardClicks(favGrid);
}

// Solo actualiza las tarjetas de un producto (evita re-renderizar el catálogo en cada clic)
function refreshProductCards(pid) {
    const p = allProducts.find(x => x.id === pid);
    if (!p) return;
    document.querySelectorAll(`#products-grid [data-pid="${pid}"], #favorites-grid [data-pid="${pid}"]`).forEach(el => {
        const tmp = document.createElement('div');
        tmp.innerHTML = productCardHtml(p, el.classList.contains('pos-fav'));
        const fresh = tmp.firstElementChild;
        el.replaceWith(fresh);
        bindCard(fresh);
    });
}

async function toggleFavorite(productId) {
    try {
        const product = allProducts.find(p => p.id === productId);
        if (!product) return;
        const newStatus = !product.is_favorite;
        const response = await fetch(`/api/products/${productId}/toggle-favorite`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_favorite: newStatus })
        });
        if (!response.ok) throw new Error('Falló el guardado');
        product.is_favorite = newStatus;
        renderFavorites();
        renderProductGridByCategory();
    } catch (e) {
        console.error(e);
        showToast("Error al guardar favorito", "error");
    }
}

let lastAdded = null;

function addToCart(product) {
    const pid = product.id;
    if (cart[pid]) {
        if (cart[pid].quantity >= product.stock) { showToast(`Stock máximo (${product.stock})`, "error"); return; }
        cart[pid].quantity++;
        lastAdded = { pid, isNew: false };
    } else {
        cart[pid] = { product, quantity: 1 };
        cartOrder.push(pid);
        lastAdded = { pid, isNew: true };
    }
    renderCart(true);
    refreshProductCards(pid);
    if (cart[pid].quantity >= product.stock) {
        document.querySelectorAll(`.pos-card[data-pid="${pid}"], .pos-fav[data-pid="${pid}"]`).forEach(el => shake(el));
    }
}

function renderCart(bump = false) {
    const container = document.getElementById("cart-items");
    const confirmBtn = document.getElementById("confirm-sale-btn");
    const subtotalEl = document.getElementById("cart-subtotal");
    const discountRow = document.getElementById("cart-discount-row");
    const discountEl = document.getElementById("cart-discount-amount");
    const totalEl = document.getElementById("cart-total-amount");
    const discountInput = document.getElementById("sale-discount");
    if (!container) return;

    cartOrder = cartOrder.filter(id => cart[id]);
    const items = cartOrder.map(id => cart[id]);
    const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
    const badge = document.getElementById("cart-btn-badge");
    if (badge) badge.textContent = totalQty;
    if (bump) { pulse(document.getElementById('cart-btn-badge-wrap')); pulse(totalEl); }

    const costRow = document.getElementById("cart-cost-row");
    const profitRow = document.getElementById("cart-profit-row");

    if (items.length === 0) {
        container.innerHTML = `<p class="cart-empty">Agrega productos al carrito</p>`;
        if (subtotalEl) subtotalEl.textContent = money(0);
        if (discountRow) discountRow.style.display = "none";
        if (costRow) costRow.style.display = "none";
        if (profitRow) profitRow.style.display = "none";
        if (totalEl) totalEl.textContent = money(0);
        if (confirmBtn) confirmBtn.disabled = true;
        return;
    }

    let subtotal = 0, totalCost = 0;
    container.innerHTML = items.map(({ product, quantity }) => {
        const sub = safeMultiply(product.sale_price, quantity);
        subtotal = safeAdd(subtotal, sub);
        totalCost = safeAdd(totalCost, safeMultiply(product.cost_price || 0, quantity));
        return `<div class="pos-cart-row" data-cid="${product.id}">
            <div class="info"><span>${esc(product.name)}</span><small>${money(product.sale_price)} c/u${showCostView ? ` · costo ${money(product.cost_price)}` : ''}</small></div>
            <div class="qty">
                <button class="qty-btn" data-pid="${product.id}" data-action="dec" aria-label="Quitar uno">−</button>
                <span class="tnum">${quantity}</span>
                <button class="qty-btn" data-pid="${product.id}" data-action="inc" aria-label="Agregar uno">+</button>
            </div>
            <span class="sub tnum">${money(sub)}</span>
        </div>`;
    }).join('');

    container.querySelectorAll(".qty-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const pid = parseInt(btn.dataset.pid);
            if (btn.dataset.action === "inc") {
                if (cart[pid] && cart[pid].quantity < cart[pid].product.stock) { cart[pid].quantity++; lastAdded = { pid, isNew: false }; }
                else { showToast("Stock máximo", "error"); document.querySelectorAll(`[data-pid="${pid}"].pos-card, [data-pid="${pid}"].pos-fav`).forEach(shake); return; }
            } else if (cart[pid]) {
                cart[pid].quantity--;
                if (cart[pid].quantity <= 0) delete cart[pid];
            }
            renderCart(true);
            refreshProductCards(pid);
        });
    });

    if (lastAdded?.isNew) {
        const row = container.querySelector(`[data-cid="${lastAdded.pid}"]`);
        row?.animate && row.animate([{ opacity: 0, transform: 'translateX(30px)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
        lastAdded = null;
    }

    let discount = parseFloat(discountInput?.value) || 0;
    if (discount < 0) discount = 0;
    if (discount > subtotal) discount = subtotal;

    if (subtotalEl) subtotalEl.textContent = money(subtotal);
    if (discountRow && discountEl) {
        discountRow.style.display = discount > 0 ? "flex" : "none";
        discountEl.textContent = "−" + money(discount);
    }
    const finalTotal = safeSubtract(subtotal, discount);
    if (totalEl) totalEl.textContent = money(finalTotal);

    if (costRow && profitRow) {
        costRow.style.display = showCostView ? "flex" : "none";
        profitRow.style.display = showCostView ? "flex" : "none";
        if (showCostView) {
            const profit = safeSubtract(finalTotal, totalCost);
            document.getElementById("cart-total-cost").textContent = money(totalCost);
            const profitEl = document.getElementById("cart-total-profit");
            profitEl.textContent = money(profit);
            profitEl.style.color = profit >= 0 ? "var(--blue-soft)" : "var(--orange-soft)";
        }
    }

    if (confirmBtn) confirmBtn.disabled = false;
}

let saleInProgress = false;

function showSaleToast(ticket, total, method) {
    let t = document.getElementById('sale-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'sale-toast';
        t.className = 'ui-toast';
        document.body.appendChild(t);
    }
    t.innerHTML = `<div class="ic">${icon('check', 18, 2.4)}</div>
        <div class="txt"><small>Venta registrada · ${esc(ticket)}</small><span>${money(total)} · ${esc(PAY_LABEL[method] || method)}</span></div>
        <button class="ui-pill white sm" id="sale-toast-print">${icon('print', 14, 2)} Boleta</button>
        <button class="close" aria-label="Cerrar">${icon('close', 12, 2.4)}</button>`;
    t.classList.remove('leaving');
    t.style.display = 'flex';
    t.animate && t.animate([{ opacity: 0, transform: 'translateY(30px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.2,1.2,.3,1)' });
    const hide = () => { t.style.display = 'none'; };
    t.querySelector('#sale-toast-print').onclick = () => { if (lastSaleData) printReceipt(lastSaleData); };
    t.querySelector('.close').onclick = hide;
    clearTimeout(window._saleToastTimer);
    window._saleToastTimer = setTimeout(hide, 6000);
}

async function confirmSale() {
    const items = cartOrder.filter(id => cart[id]).map(id => cart[id]).map(({ product, quantity }) => ({
        product_id: product.id, product_name: product.name,
        unit_price: product.sale_price, unit_cost: product.cost_price || 0, quantity, subtotal: safeMultiply(product.sale_price, quantity)
    }));

    if (items.length === 0) return;

    if (localStorage.getItem("requireSaleConfirmation") === "true") {
        if (!confirm("¿Estás seguro de registrar esta venta?")) return;
    }
    const customerName = document.getElementById("sale-customer")?.value?.trim() || "Cliente Anónimo";
    const subtotalAmount = items.reduce((sum, i) => safeAdd(sum, i.subtotal), 0);
    const discount = Math.min(subtotalAmount, Math.max(0, parseFloat(document.getElementById("sale-discount")?.value) || 0));
    const paymentMethod = document.getElementById("sale-payment-method")?.value || "Caja";
    const totalAmount = safeSubtract(subtotalAmount, discount);
    const operatorName = document.querySelector('input[name="sale-active-seller"]:checked')?.value || 'Anónimo';

    // Evitar doble clic: registraba la misma venta dos veces
    const confirmBtn = document.getElementById("confirm-sale-btn");
    if (saleInProgress) return;
    saleInProgress = true;
    if (confirmBtn) confirmBtn.disabled = true;

    try {
        const response = await fetch('/api/sales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subtotal_amount: subtotalAmount,
                discount_amount: discount,
                total_amount: totalAmount,
                operator_name: operatorName,
                payment_method: paymentMethod,
                customer_name: customerName,
                items
            })
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error);

        const newTicketCode = result.data[0].ticket_code;
        lastSaleData = {
            ticketCode: newTicketCode, date: new Date(), customerName, operatorName, paymentMethod,
            items, subtotalAmount, discount, totalAmount
        };

        showSaleToast(newTicketCode, totalAmount, paymentMethod);

        cart = {}; cartOrder = [];
        const customerInput = document.getElementById("sale-customer");
        const discountInput = document.getElementById("sale-discount");
        if (customerInput) customerInput.value = "";
        if (discountInput) discountInput.value = "";
        renderCart(true);

        await loadProductsForPOS();
        await loadRecentSales();
    } catch (e) {
        console.error(e);
        showToast("Error al registrar la venta: " + (e.message || "error de conexión"), "error");
    } finally {
        saleInProgress = false;
        if (confirmBtn) confirmBtn.disabled = cartOrder.length === 0;
    }
}

async function loadRecentSales() {
    try {
        const response = await fetch('/api/sales');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        allSales = (data || []).sort((a, b) => (parseDate(b.created_at) || 0) - (parseDate(a.created_at) || 0));
        renderHistoryChips();
        applyAllFilters();
    } catch (e) { console.error(e); }
}

// ═══ Historial ═══
function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function histRange() {
    const now = new Date(), t = dayStart(now);
    const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    switch (histPeriod) {
        case 'today': return [t, add(t, 1)];
        case 'yesterday': return [add(t, -1), t];
        case 'week': { const dow = now.getDay() || 7; const mon = add(t, 1 - dow); return [mon, add(mon, 7)]; }
        case 'month': return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)];
        case 'year': return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)];
        case 'custom': {
            const f = document.getElementById('hist-from')?.value, to = document.getElementById('hist-to')?.value;
            return [f ? new Date(f + 'T00:00:00') : new Date(0), to ? add(new Date(to + 'T00:00:00'), 1) : new Date(8640000000000000)];
        }
        default: return [new Date(0), new Date(8640000000000000)];
    }
}

function rangeLabel([a, b]) {
    if (histPeriod === 'all') return 'Todas las fechas';
    const last = new Date(b.getTime() - 1);
    if (dayStart(a).getTime() === dayStart(last).getTime()) return fmtDay(a);
    if (histPeriod === 'custom' && a.getTime() === 0) return `hasta ${fmtDay(last)}`;
    return `${fmtDay(a)} – ${fmtDay(last)}`;
}

function renderHistoryChips() {
    const payHost = document.getElementById('hist-pay-chips');
    const venHost = document.getElementById('hist-vendor-chips');
    if (payHost) {
        payHost.innerHTML = ['Todos', ...PAY_METHODS].map(k => `<button class="ui-chip ${histPay === k ? 'active' : ''}" data-hpay="${esc(k)}">${esc(k)}</button>`).join('');
        payHost.querySelectorAll('[data-hpay]').forEach(b => b.addEventListener('click', () => { histPay = b.dataset.hpay; histLimit = 40; renderHistoryChips(); applyAllFilters(true); }));
    }
    if (venHost) {
        const vendors = [...new Set(allSales.map(s => s.operator_name).filter(v => v && v !== 'Anónimo'))].sort();
        if (histVendor !== 'Todos' && !vendors.includes(histVendor)) histVendor = 'Todos';
        venHost.innerHTML = ['Todos', ...vendors].map(k => `<button class="ui-chip ${histVendor === k ? 'active blue' : ''}" data-hven="${esc(k)}">${k === 'Todos' ? 'Todo vendedor' : esc(k)}</button>`).join('');
        venHost.querySelectorAll('[data-hven]').forEach(b => b.addEventListener('click', () => { histVendor = b.dataset.hven; histLimit = 40; renderHistoryChips(); applyAllFilters(true); }));
    }
}

function applyAllFilters(animate = false) {
    const q = document.getElementById("all-sales-search")?.value?.toLowerCase().trim() || "";
    const range = histRange();
    const filtered = allSales.filter(s => {
        const d = parseDate(s.created_at);
        if (!d || d < range[0] || d >= range[1]) return false;
        if (histPay !== 'Todos' && s.payment_method !== histPay) return false;
        if (histVendor !== 'Todos' && s.operator_name !== histVendor) return false;
        if (!q) return true;
        return (s.customer_name || '').toLowerCase().includes(q) ||
            (s.ticket_code || '').toLowerCase().includes(q) ||
            (s.operator_name || '').toLowerCase().includes(q) ||
            getSaleItems(s).some(item => {
                const prod = allProducts.find(p => p.id === item.product_id);
                return (item.product_name || '').toLowerCase().includes(q) || (prod?.brand || '').toLowerCase().includes(q);
            });
    });
    const label = document.getElementById('hist-range-label');
    if (label) label.textContent = rangeLabel(range);
    renderHistoryKpis(filtered);
    renderAllSalesTable(filtered, animate);
}

function renderHistoryKpis(sales) {
    const host = document.getElementById('hist-kpis');
    if (!host) return;
    const sum = sales.reduce((a, s) => safeAdd(a, parseFloat(s.total_amount || 0)), 0);
    const days = new Set(sales.map(s => { const d = parseDate(s.created_at); return d ? d.toDateString() : ''; })).size || 1;
    const units = {};
    sales.forEach(s => getSaleItems(s).forEach(it => { units[it.product_name] = (units[it.product_name] || 0) + (parseInt(it.quantity) || 0); }));
    const top = Object.entries(units).sort((a, b) => b[1] - a[1])[0];
    let profitTxt = '';
    if (showCostView) {
        const profit = sales.reduce((a, s) => safeAdd(a, saleCostInfo(s).profit), 0);
        profitTxt = money(profit);
    }
    const k = [
        { icon: 'receipt', v: String(sales.length), l: 'Ventas', cls: '' },
        { icon: 'dollar', v: money(sum), l: 'Total vendido', cls: 'ink' },
        showCostView ? { icon: 'trophy', v: profitTxt, l: 'Ganancia', cls: 'blue' } : { icon: 'ticket', v: money(sales.length ? sum / sales.length : 0), l: 'Ticket promedio', cls: '' },
        { icon: 'cal', v: money(sum / days), l: 'Venta promedio por día', cls: '' },
        { icon: 'star', v: top ? top[0] : '—', l: top ? `Más vendido · ${top[1]} unidades` : 'Más vendido', cls: 'orange' }
    ];
    host.innerHTML = k.map(x => `<div class="ui-kpi" data-anim="1"><div class="ui-kpi-icon ${x.cls}">${icon(x.icon, 19, 1.9)}</div>
        <div class="ui-kpi-body"><span class="ui-kpi-value" title="${esc(x.v)}" style="max-width:260px">${esc(x.v)}</span><span class="ui-kpi-label">${esc(x.l)}</span></div></div>`).join('');
}

// El servidor devuelve los productos de cada venta en `items`
function getSaleItems(s) {
    return s.items || s.sale_items || [];
}

// Costo real de la venta: el costo unitario congelado al vender; si no se guardó, el costo actual del producto
function saleCostInfo(s) {
    let totalCost = 0;
    const lines = getSaleItems(s).map(item => {
        const prod = allProducts.find(p => p.id === item.product_id) || allProducts.find(p => p.name === item.product_name);
        const unitCost = item.unit_cost ? parseFloat(item.unit_cost) : parseFloat(prod?.cost_price || 0);
        const lineCost = safeMultiply(unitCost, item.quantity);
        totalCost = safeAdd(totalCost, lineCost);
        return { item, prod, unitCost, lineCost };
    });
    return { lines, totalCost, profit: safeSubtract(s.total_amount || 0, totalCost) };
}

function payTag(method) {
    return `<span class="ui-tag pay-${esc(String(method || 'Caja').replace('/', ''))}">${esc(method || 'Caja')}</span>`;
}

function renderAllSalesTable(sales, animate = false) {
    const body = document.getElementById("all-sales-tbody");
    const head = document.getElementById("all-sales-thead");
    if (!body) return;
    if (head) {
        head.className = `ui-thead ${showCostView ? 'cost' : ''}`;
        head.innerHTML = showCostView
            ? '<span>Fecha</span><span>Cliente</span><span>Productos</span><span class="r">Total</span><span class="r">Costo</span><span class="r">Ganancia</span><span>Vendedor</span><span></span>'
            : '<span>Fecha</span><span>Cliente</span><span>Productos</span><span class="r">Total</span><span>Pago</span><span>Vendedor</span><span></span>';
    }
    const more = document.getElementById('load-more-sales-btn');
    if (sales.length === 0) {
        body.innerHTML = '<div class="ui-empty">No hay ventas en este rango</div>';
        if (more) more.style.display = 'none';
        return;
    }
    const page = sales.slice(0, histLimit);
    body.innerHTML = page.map(s => {
        const d = parseDate(s.created_at);
        const { lines, totalCost, profit } = saleCostInfo(s);
        const itemsTxt = lines.map(({ item }) => (item.quantity > 1 ? `${item.quantity} × ` : '') + (item.product_name || 'Producto')).join(', ') || 'Sin detalle';
        return `<div class="ui-tr ${showCostView ? 'cost' : ''}" data-sale="${s.id}">
            <span class="ui-cell-2"><span>${d ? `${fmtDay(d)} · ${fmtTime(d)}` : '—'}</span><small>${esc(s.ticket_code || '')}</small></span>
            <span class="ellipsis">${esc(s.customer_name || '—')}</span>
            <span class="muted ellipsis" title="${esc(itemsTxt)}">${esc(itemsTxt)}</span>
            <span class="r tnum" style="font-weight:500">${money(s.total_amount || 0)}</span>
            ${showCostView
                ? `<span class="r tnum muted">${money(totalCost)}</span><span class="r tnum" style="color:${profit >= 0 ? 'var(--blue)' : 'var(--orange)'};font-weight:500">${money(profit)}</span>`
                : `<span>${payTag(s.payment_method)}</span>`}
            <span>${esc(s.operator_name || '—')}</span>
            <button class="ui-icon-btn sm" title="Ver detalle" data-open="${s.id}">${icon('arrow', 14, 2)}</button>
        </div>`;
    }).join('');
    body.querySelectorAll('[data-sale]').forEach(row => row.addEventListener('click', () => openSaleDetail(parseInt(row.dataset.sale))));
    if (more) {
        more.style.display = sales.length > histLimit ? 'inline-flex' : 'none';
        more.textContent = `Mostrar más (${sales.length - histLimit} restantes)`;
    }
    if (animate) stagger(body.children, 0, 30, 600);
}

// ─── Detalle de una venta (drawer lateral) ─────────────
function openSaleDetail(saleId) {
    const s = allSales.find(x => x.id === saleId);
    if (!s) return;
    const { lines, totalCost, profit } = saleCostInfo(s);
    const subtotal = s.subtotal_amount || s.total_amount || 0;
    const total = s.total_amount || 0;
    const margin = total > 0 ? Math.round((profit / total) * 100) : 0;
    const d = parseDate(s.created_at);

    const drawer = openDrawer(`
        <div class="ui-drawer-head">
            <div class="top"><span class="meta">${esc(s.ticket_code || '—')} · ${d ? `${fmtDay(d)} · ${fmtTime(d)}` : ''}</span>
                <button class="close" data-drawer-close aria-label="Cerrar">${icon('close', 14, 2.2)}</button></div>
            <span style="font-size:44px;font-weight:500;letter-spacing:-.03em;margin-top:4px" class="tnum">${money(total)}</span>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
                <span class="drawer-chip pay-solid-${esc(String(s.payment_method || 'Caja').replace('/', ''))}">${esc(PAY_LABEL[s.payment_method] || s.payment_method || 'Caja')}</span>
                <span class="drawer-chip">Atendió ${esc(s.operator_name || '—')}</span>
                <span class="drawer-chip">${esc(s.customer_name || 'Cliente')}</span>
            </div>
        </div>
        <div class="ui-drawer-body">
            <div style="display:flex;flex-direction:column">
                <div class="drawer-items-head"><span>Producto</span><span class="c">Cant.</span><span class="r">Subtotal</span></div>
                ${lines.length ? lines.map(({ item, prod }) => `
                    <div class="drawer-item">
                        <span class="ui-cell-2"><span>${esc(item.product_name || prod?.name || 'Producto')}</span><small>${prod?.code ? `Cód. ${esc(prod.code)} · ` : ''}${money(item.unit_price || 0)} c/u</small></span>
                        <span class="c tnum">${item.quantity}</span>
                        <span class="r tnum" style="font-weight:500">${money(item.subtotal ?? safeMultiply(item.unit_price, item.quantity))}</span>
                    </div>`).join('') : '<div class="ui-empty">Sin detalle de productos</div>'}
            </div>
            <div class="ui-sheet">
                <div class="line"><span>Subtotal</span><span>${money(subtotal)}</span></div>
                ${s.discount_amount > 0 ? `<div class="line"><span>Descuento</span><span style="color:var(--orange)">−${money(s.discount_amount)}</span></div>` : ''}
                <div class="line sep"><span>Total cobrado</span><span>${money(total)}</span></div>
                <div class="line dash"><span>Costo de productos</span><span>${money(totalCost)}</span></div>
                <div class="line"><span>Ganancia</span><span style="color:var(--blue);font-weight:500">${money(profit)} · ${margin}% margen</span></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <button class="ui-pill" id="sale-detail-print">${icon('print', 15, 2)} Ver recibo</button>
                <button class="ui-pill outline" id="sale-detail-void" style="color:var(--orange-ink)">Anular venta</button>
            </div>
        </div>`);

    drawer.querySelector("#sale-detail-void").addEventListener("click", () => {
        closeDrawer();
        voidSale(s.id, s.ticket_code);
    });
    drawer.querySelector("#sale-detail-print").addEventListener("click", () => {
        printReceipt({
            ticketCode: s.ticket_code,
            date: d || new Date(),
            customerName: s.customer_name,
            operatorName: s.operator_name,
            paymentMethod: s.payment_method,
            items: lines.map(({ item }) => item),
            subtotalAmount: subtotal,
            discount: s.discount_amount || 0,
            totalAmount: total
        });
    });
}

window.openSaleDetail = openSaleDetail;

export function applySalesIntent(intent) {
    if (intent?.tab === 'history') setMode('hist');
}

// ═══ IMPRESIÓN DE BOLETA TÉRMICA (80mm - ZKTeco ZKP8005) ═══
// Usa un iframe oculto para imprimir sin abrir ventana nueva.
// Para impresión silenciosa (sin diálogo), abrir Chrome con: --kiosk-printing
function printReceipt(saleData) {
    const { ticketCode, date, customerName, operatorName, paymentMethod, items, subtotalAmount, discount, totalAmount } = saleData;

    const fechaStr = date.toLocaleString('es-PE', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });

    let payLabel = 'Caja (Efectivo)';
    if (paymentMethod === 'Yape/Plin') payLabel = 'Yape / Plin';
    else if (paymentMethod === 'Transferencia') payLabel = 'Transferencia';
    else if (paymentMethod === 'POS') payLabel = 'Tarjeta (POS)';

    // Generar filas de items
    let itemsHtml = '';
    items.forEach(item => {
        const prod = allProducts.find(p => p.id === item.product_id);
        const brand = prod ? (prod.brand || 'General') : 'General';
        itemsHtml += `
            <tr>
                <td colspan="4" style="padding: 1px 0 0 0; font-weight: 900; font-size: 12px; color: #000;">${item.product_name} (${brand})</td>
            </tr>
            <tr>
                <td style="padding: 0 0 3px 8px; font-size: 11px; color: #000; font-weight: 700;">${item.quantity}</td>
                <td style="padding: 0 0 3px 0; font-size: 11px; text-align: right; color: #000; font-weight: 700;">x ${fmtPlain(item.unit_price)}</td>
                <td colspan="2" style="padding: 0 0 3px 0; font-size: 12px; text-align: right; font-weight: 900; color: #000;">${fmtPlain(item.subtotal)}</td>
            </tr>`;
    });

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Boleta - ${ticketCode}</title>
    <style>
        @page {
            size: 80mm auto;
            margin: 0;
        }
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Courier New', 'Lucida Console', monospace;
            font-size: 13px;
            font-weight: 700; /* Letra más gruesa para impresoras térmicas */
            color: #000;
            background: #fff;
            width: 72mm;
            margin: 0 auto;
            padding: 4mm 2mm;
        }
        .receipt-header {
            text-align: center;
            border-bottom: 2px dashed #000;
            padding-bottom: 8px;
            margin-bottom: 8px;
        }
        .receipt-header .business-name {
            font-size: 18px;
            font-weight: 900;
            letter-spacing: 1px;
            margin-bottom: 2px;
        }
        .receipt-header .business-phone {
            font-size: 12px;
            color: #000;
            font-weight: 700;
        }
        .receipt-header .receipt-title {
            font-size: 14px;
            font-weight: 900;
            margin-top: 6px;
            letter-spacing: 2px;
        }
        .receipt-info {
            margin-bottom: 8px;
            font-size: 12px;
            line-height: 1.6;
        }
        .receipt-info .row {
            display: flex;
            justify-content: space-between;
        }
        .receipt-info .label {
            font-weight: 900;
            color: #000;
        }
        .divider {
            border: none;
            border-top: 2px dashed #000; /* Líneas más gruesas */
            margin: 6px 0;
        }
        .divider-thick {
            border: none;
            border-top: 3px dashed #000;
            margin: 6px 0;
        }
        .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 4px;
        }
        .items-table thead th {
            font-size: 11px;
            font-weight: 900;
            text-transform: uppercase;
            border-bottom: 2px solid #000;
            padding: 2px 0;
            text-align: left;
            color: #000;
        }
        .items-table thead th:last-child,
        .items-table thead th:nth-child(3) {
            text-align: right;
        }
        .totals {
            margin-top: 4px;
            font-size: 12px;
        }
        .totals .row {
            display: flex;
            justify-content: space-between;
            padding: 2px 0;
            font-weight: 700;
        }
        .totals .row.grand-total {
            font-size: 17px;
            font-weight: 900;
            border-top: 2px solid #000;
            border-bottom: 2px solid #000;
            padding: 6px 0;
            margin-top: 4px;
        }
        .totals .row.discount {
            color: #000;
        }
        .receipt-footer {
            text-align: center;
            margin-top: 10px;
            padding-top: 8px;
            border-top: 2px dashed #000;
            font-size: 12px;
            font-weight: 900;
        }
        .receipt-footer .thanks {
            font-size: 14px;
            font-weight: 900;
            margin-bottom: 4px;
        }
    </style>
</head>
<body>
    <div class="receipt-header">
        <div class="business-name">REPARACIONES JUAN</div>
        <div class="business-phone">Tel: 923 180 186</div>
        <div class="receipt-title">BOLETA DE VENTA</div>
    </div>

    <div class="receipt-info">
        <div class="row"><span class="label">Ticket:</span><span>${ticketCode}</span></div>
        <div class="row"><span class="label">Fecha:</span><span>${fechaStr}</span></div>
        <div class="row"><span class="label">Vendedor:</span><span>${operatorName}</span></div>
        <div class="row"><span class="label">Cliente:</span><span>${customerName}</span></div>
        <div class="row"><span class="label">Pago:</span><span>${payLabel}</span></div>
    </div>

    <hr class="divider-thick">

    <table class="items-table">
        <thead>
            <tr>
                <th>Cant</th>
                <th>Precio</th>
                <th colspan="2" style="text-align:right;">Subtotal</th>
            </tr>
        </thead>
        <tbody>
            ${itemsHtml}
        </tbody>
    </table>

    <hr class="divider">

    <div class="totals">
        <div class="row"><span>Subtotal:</span><span>${fmtPlain(subtotalAmount)}</span></div>
        ${discount > 0 ? `<div class="row discount"><span>Descuento:</span><span>-${fmtPlain(discount)}</span></div>` : ''}
        <div class="row grand-total"><span>TOTAL:</span><span>S/ ${totalAmount.toFixed(2)}</span></div>
    </div>

    <div class="receipt-footer">
        <div class="thanks">¡Gracias por su compra!</div>
        <div>Reparaciones Juan</div>
    </div>
</body>
</html>`;

    // Usar iframe oculto para no abrir ventana nueva
    let printFrame = document.getElementById('receipt-print-frame');
    if (!printFrame) {
        printFrame = document.createElement('iframe');
        printFrame.id = 'receipt-print-frame';
        printFrame.style.cssText = 'position:fixed;top:-10000px;left:-10000px;width:0;height:0;border:none;';
        document.body.appendChild(printFrame);
    }

    const frameDoc = printFrame.contentDocument || printFrame.contentWindow.document;
    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    // Esperar a que el contenido cargue y luego imprimir
    let hasPrinted = false;

    printFrame.onload = () => {
        if (hasPrinted) return;
        hasPrinted = true;
        try {
            printFrame.contentWindow.focus();
            printFrame.contentWindow.print();
        } catch (e) {
            console.error('Error al imprimir:', e);
            showToast('Error al imprimir la boleta', 'error');
        }
    };

    // Fallback: si onload no dispara, intentar después de un delay
    setTimeout(() => {
        if (hasPrinted) return;
        hasPrinted = true;
        try {
            printFrame.contentWindow.focus();
            printFrame.contentWindow.print();
        } catch (e) { /* ignorar */ }
    }, 500);
}

// Helper de formato para la boleta
function fmtPlain(n) {
    const num = parseFloat(n) || 0;
    return 'S/ ' + num.toFixed(2);
}

// ─── Anular Venta ───────────────────────────
async function voidSale(saleId, ticketCode) {
    if (!confirm(`⚠️ ¿Estás seguro de que deseas ANULAR la venta ${ticketCode}?\nLos productos regresarán al inventario y el registro de la venta se eliminará.`)) {
        return;
    }

    try {
        const session = getSession();
        const operatorName = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';

        // Anulación atómica en el servidor (stock + auditoría + borrado, todo o nada)
        const response = await fetch(`/api/sales/${saleId}/void`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operator_name: operatorName })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Error de conexión");

        // Eliminarla de memoria local para que la actualización optimista no la reviva
        allSales = allSales.filter(s => s.id !== saleId);

        showToast(`Venta ${ticketCode} anulada exitosamente`);
        await loadRecentSales();
        await loadProductsForPOS(); // Actualizar catálogo
    } catch (e) {
        console.error("Error al anular venta:", e);
        showToast("Error al anular la venta: " + (e.message || ""), "error");
    }
}

window.voidSale = voidSale;

// ═══ Realtime Sync ═══
window.addEventListener('supabase_realtime', async (e) => {
    const table = e.detail.table;
    if (document.querySelector('.nav-item[data-view="sales"]')?.classList.contains('active') || document.querySelector('.mobile-nav-item[data-target="sales"]')?.classList.contains('active')) {
        if (table === 'sales' || table === 'sale_items' || table === 'products') {
            await Promise.all([
                loadRecentSales(),
                loadProductsForPOS()
            ]);
            renderCategoryList();
            renderProductGridByCategory();
            renderFavorites();
        }
    }
});