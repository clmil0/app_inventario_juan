import { supabase, getSession, fmt, showToast } from './supabase.js';

let allProducts = [], allCategories = [], selectedCategoryId = null, isSearching = false, filteredProducts = [], cart = {};
let allSales = [];

// ═══ FUNCIONES DEL SLIDER ═══
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

export async function loadSalesView() {
    await loadCategoriesForSales();
    await loadProductsForPOS();
    await loadRecentSales();
    selectedCategoryId = null;
    renderCategoryList();
    renderProductGridByCategory();
    renderCart();
}

export function bindSalesEvents() {
    document.getElementById("product-search")?.addEventListener("input", e => {
        const q = e.target.value.toLowerCase().trim();
        if (q === '') { isSearching = false; renderCategoryList(); renderProductGridByCategory(); return; }
        isSearching = true;
        filteredProducts = allProducts.filter(p =>
            p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q) ||
            p.code.toLowerCase().includes(q) || (p.category_name && p.category_name.toLowerCase().includes(q))
        );
        selectedCategoryId = null; renderCategoryList(); renderProductGridByCategory();
    });

    document.getElementById("confirm-sale-btn")?.addEventListener("click", confirmSale);
    document.getElementById("clear-cart-btn")?.addEventListener("click", () => { cart = {}; renderCart(); });
    document.getElementById("sale-discount")?.addEventListener("input", renderCart);
    document.getElementById("all-sales-search")?.addEventListener("input", () => applyAllFilters());
    document.getElementById("filter-month")?.addEventListener("change", applyAllFilters);
    document.getElementById("filter-year")?.addEventListener("change", applyAllFilters);
    document.getElementById("filter-vendor")?.addEventListener("change", applyAllFilters);

    const minSlider = document.getElementById("price-range-min");
    const maxSlider = document.getElementById("price-range-max");
    if (minSlider && maxSlider) {
        minSlider.addEventListener("input", () => { updateRangeUI(); applyAllFilters(); });
        maxSlider.addEventListener("input", () => { updateRangeUI(); applyAllFilters(); });
        updateRangeUI();
    }
}

async function loadCategoriesForSales() {
    try {
        const { data } = await supabase.from('categories').select('*').order('name');
        allCategories = data || [];
    } catch (e) { console.error(e); }
}

async function loadProductsForPOS() {
    try {
        const { data } = await supabase
            .from('products')
            .select('*, categories(name)')
            .order('name');
        allProducts = data?.map(p => ({ ...p, category_name: p.categories?.name })) || [];
        renderFavorites();
        renderProductGridByCategory();
    } catch (e) { console.error(e); }
}

function renderCategoryList() {
    const container = document.getElementById("category-list-items");
    if (!container) return;
    container.innerHTML = '';
    const allOption = document.createElement('div');
    allOption.className = `category-item ${selectedCategoryId === null ? 'active' : ''}`;
    allOption.textContent = '📂 Todas';
    allOption.addEventListener('click', () => {
        selectedCategoryId = null; isSearching = false;
        const ps = document.getElementById("product-search"); if (ps) ps.value = '';
        renderCategoryList(); renderProductGridByCategory();
    });
    container.appendChild(allOption);
    allCategories.forEach(cat => {
        const div = document.createElement('div');
        div.className = `category-item ${selectedCategoryId === cat.id ? 'active' : ''}`;
        div.textContent = cat.name;
        div.addEventListener('click', () => {
            selectedCategoryId = cat.id; isSearching = false;
            const ps = document.getElementById("product-search"); if (ps) ps.value = '';
            renderCategoryList(); renderProductGridByCategory();
        });
        container.appendChild(div);
    });
}

function renderProductGridByCategory() {
    const container = document.getElementById("products-grid");
    if (!container) return;
    container.innerHTML = '';
    let productsToShow = isSearching ? filteredProducts :
        selectedCategoryId !== null ? allProducts.filter(p => p.category_id === selectedCategoryId) : allProducts;
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

    const nameDiv = document.createElement("div"); nameDiv.className = "product-name"; nameDiv.textContent = product.name;
    const priceDiv = document.createElement("div"); priceDiv.className = "product-price"; priceDiv.textContent = fmt(product.sale_price);

    const infoDiv = document.createElement("div");
    infoDiv.className = "product-info-row";
    infoDiv.innerHTML = `<span>Stock: ${product.stock}</span><span>Cód: ${product.code}</span>`;

    card.append(nameDiv, priceDiv, infoDiv, favBtn);
    if (product.stock > 0) card.addEventListener("click", () => addToCart(product));
    container.appendChild(card);
}

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
        const product = allProducts.find(p => p.id === productId);
        if (!product) return;
        const { error } = await supabase
            .from('products')
            .update({ is_favorite: !product.is_favorite })
            .eq('id', productId);
        if (error) throw error;
        await loadProductsForPOS();
    } catch { showToast("Error de conexión", "error"); }
}

function addToCart(product) {
    const pid = product.id;
    if (cart[pid]) {
        if (cart[pid].quantity >= product.stock) { showToast(`Stock máximo (${product.stock})`, "error"); return; }
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
                if (cart[pid] && cart[pid].quantity < cart[pid].product.stock) cart[pid].quantity++;
                else showToast("Stock máximo", "error");
            } else {
                if (cart[pid]) { cart[pid].quantity--; if (cart[pid].quantity <= 0) delete cart[pid]; }
            }
            renderCart();
        });
    });

    let discount = parseFloat(discountInput?.value) || 0;
    if (discount < 0) discount = 0;
    if (discount > subtotal) discount = subtotal;

    if (subtotalEl) subtotalEl.textContent = fmt(subtotal);
    if (discountRow && discountEl) {
        if (discount > 0) { discountRow.style.display = "flex"; discountEl.textContent = "- " + fmt(discount); }
        else discountRow.style.display = "none";
    }
    if (totalEl) totalEl.textContent = fmt(subtotal - discount);
    if (confirmBtn) confirmBtn.disabled = false;
}

async function confirmSale() {
    const items = Object.values(cart).map(({ product, quantity }) => ({
        product_id: product.id, product_name: product.name,
        unit_price: product.sale_price, quantity, subtotal: product.sale_price * quantity
    }));
    const customerName = document.getElementById("sale-customer")?.value?.trim() || "Cliente Anónimo";
    const discount = parseFloat(document.getElementById("sale-discount")?.value) || 0;
    const subtotalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
    const totalAmount = subtotalAmount - discount;
    const session = getSession();
    const operatorName = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';

    try {
        // Insertar venta
        const { data: sale, error: saleError } = await supabase
            .from('sales')
            .insert({
                ticket_code: '', // Se genera automáticamente
                operator_name: operatorName,
                customer_name: customerName,
                subtotal_amount: subtotalAmount,
                discount_amount: discount,
                total_amount: totalAmount
            })
            .select()
            .single();

        if (saleError) throw saleError;

        // Insertar items
        const saleItems = items.map(i => ({ ...i, sale_id: sale.id }));
        const { error: itemsError } = await supabase.from('sale_items').insert(saleItems);
        if (itemsError) throw itemsError;

        // Actualizar stock
        for (const item of items) {
            const product = allProducts.find(p => p.id === item.product_id);
            if (product) {
                await supabase
                    .from('products')
                    .update({ stock: product.stock - item.quantity })
                    .eq('id', item.product_id);
            }
        }

        // Obtener el ticket generado
        const { data: updatedSale } = await supabase
            .from('sales')
            .select('*')
            .eq('id', sale.id)
            .single();

        document.getElementById("sale-success-ticket").textContent = `Ticket: ${updatedSale.ticket_code}`;
        document.getElementById("sale-success-detail").innerHTML = `
            <div>Subtotal: ${fmt(subtotalAmount)}</div>
            ${discount > 0 ? `<div style="color:var(--accent-red)">Descuento: -${fmt(discount)}</div>` : ''}
            <div style="font-size:1.5rem;font-weight:800;color:var(--accent-green);">Total: ${fmt(totalAmount)}</div>`;
        document.getElementById("sale-success-modal").classList.remove("hidden");

        cart = {};
        const customerInput = document.getElementById("sale-customer");
        const discountInput = document.getElementById("sale-discount");
        if (customerInput) customerInput.value = "";
        if (discountInput) discountInput.value = "";
        renderCart();
        await loadProductsForPOS();
        await loadRecentSales();
    } catch (e) {
        console.error(e);
        showToast("Error al registrar la venta", "error");
    }
}

async function loadRecentSales() {
    try {
        const { data } = await supabase
            .from('sales')
            .select('*')
            .order('created_at', { ascending: false });
        allSales = data || [];
        populateFilterOptions();
        applyAllFilters();
    } catch (e) { console.error(e); }
}

function populateFilterOptions() {
    const yearSelect = document.getElementById("filter-year");
    if (yearSelect) {
        const years = [...new Set(allSales.map(s => {
            if (s.created_at) return new Date(s.created_at).getFullYear();
            return null;
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
    const searchQ = document.getElementById("all-sales-search")?.value?.toLowerCase() || "";
    const month = document.getElementById("filter-month")?.value || "";
    const year = document.getElementById("filter-year")?.value || "";
    const vendor = document.getElementById("filter-vendor")?.value || "";
    const minPrice = parseInt(document.getElementById("price-range-min")?.value) || 0;
    const maxPrice = parseInt(document.getElementById("price-range-max")?.value) || Infinity;

    let filtered = allSales.filter(s => {
        const matchSearch = !searchQ ||
            (s.customer_name && s.customer_name.toLowerCase().includes(searchQ)) ||
            (s.ticket_code && s.ticket_code.toLowerCase().includes(searchQ)) ||
            (s.operator_name && s.operator_name.toLowerCase().includes(searchQ));
        if (!matchSearch) return false;

        if (month || year) {
            if (!s.created_at) return false;
            try {
                const d = new Date(s.created_at);
                if (isNaN(d.getTime())) return false;
                if (month && d.getMonth() + 1 !== parseInt(month)) return false;
                if (year && d.getFullYear() !== parseInt(year)) return false;
            } catch { return false; }
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
        let fechaFormateada = "-";
        if (s.created_at) {
            try {
                const fecha = new Date(s.created_at);
                if (!isNaN(fecha.getTime())) {
                    fechaFormateada = fecha.toLocaleString('es-PE', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit'
                    });
                }
            } catch { }
        }
        tr.innerHTML = `
            <td>${s.ticket_code || "-"}</td>
            <td>${fechaFormateada}</td>
            <td>${s.customer_name || "-"}</td>
            <td>${s.operator_name || "-"}</td>
            <td>${fmt(s.total_amount || 0)}</td>
            <td><button class="btn-outline btn-sm">Ver Boleta</button></td>`;
        tbody.appendChild(tr);
    });
}