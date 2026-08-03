import { supabase, getSession, fmt, showToast } from './supabase.js';

let allProducts = [], allCategories = [], selectedCategoryId = null, isSearching = false, filteredProducts = [], cart = {};
let allSales = [];

// ═══ FUNCIONES DEL RANGO DE PRECIO ═══
function updateRangeUI() {
    // Ya no es necesario manipular estilos del slider; se maneja por inputs numéricos directamente
}

window.updatePriceRangeMax = function (maxAmount) {
    const maxInput = document.getElementById("price-range-max");
    if (!maxInput) return;
    const max = Math.ceil(maxAmount / 10) * 10 || 1000;
    maxInput.value = max;
};

export async function loadSalesView() {
    await Promise.all([
        loadCategoriesForSales(),
        loadProductsForPOS(),
        loadRecentSales()
    ]);
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

    const priceSlider = document.getElementById("price-range-slider");
    if (priceSlider) {
        priceSlider.addEventListener("input", () => {
            updateSliderUI();
            applyAllFilters();
        });
    }

    const gridBtn = document.getElementById("pos-view-grid");
    const listBtn = document.getElementById("pos-view-list");
    const container = document.getElementById("products-grid");
    const savedView = localStorage.getItem("pos_products_view") || "grid";
    
    function applyPosView(view) {
        if (!container || !gridBtn || !listBtn) return;
        if (view === "list") {
            container.classList.remove("jsGridView");
            container.classList.add("jsListView");
            listBtn.classList.add("active");
            gridBtn.classList.remove("active");
        } else {
            container.classList.remove("jsListView");
            container.classList.add("jsGridView");
            gridBtn.classList.add("active");
            listBtn.classList.remove("active");
        }
        localStorage.setItem("pos_products_view", view);
    }
    applyPosView(savedView);
    gridBtn?.addEventListener("click", () => applyPosView("grid"));
    listBtn?.addEventListener("click", () => applyPosView("list"));

    const cartPanel = document.getElementById("pos-cart-panel");
    const posLayout = document.getElementById("pos-main-layout");
    const toggleCartBtn = document.getElementById("toggle-cart-btn");
    const hideCartBtn = document.getElementById("hide-cart-btn");

    function toggleCart(show) {
        if (!cartPanel || !posLayout) return;
        const isCollapsed = cartPanel.classList.contains("collapsed");
        const targetShow = show !== undefined ? show : isCollapsed;
        if (targetShow) {
            cartPanel.classList.remove("collapsed");
            posLayout.classList.remove("cart-hidden");
        } else {
            cartPanel.classList.add("collapsed");
            posLayout.classList.add("cart-hidden");
        }
    }

    toggleCartBtn?.addEventListener("click", () => toggleCart());
    hideCartBtn?.addEventListener("click", () => toggleCart(false));
}

async function loadCategoriesForSales() {
    try {
        const { data } = await supabase.from('categories').select('*').order('name');
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
    allOption.innerHTML = `<span>📂 Todas</span>`;
    allOption.addEventListener('click', () => {
        selectedCategoryId = null; isSearching = false;
        const ps = document.getElementById("product-search"); if (ps) ps.value = '';
        renderCategoryList(); renderProductGridByCategory();
    });
    container.appendChild(allOption);

    allCategories.forEach((cat, idx) => {
        const div = document.createElement('div');
        div.className = `category-item ${selectedCategoryId === cat.id ? 'active' : ''}`;
        div.innerHTML = `
            <span>${cat.name}</span>
            <div style="display: flex; gap: 2px;" class="cat-arrows">
                <button class="cat-arrow-btn" title="Subir" ${idx === 0 ? 'disabled' : ''}>▲</button>
                <button class="cat-arrow-btn" title="Bajar" ${idx === allCategories.length - 1 ? 'disabled' : ''}>▼</button>
            </div>
        `;

        const [upBtn, downBtn] = div.querySelectorAll('.cat-arrow-btn');
        upBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (idx > 0) {
                const temp = allCategories[idx - 1];
                allCategories[idx - 1] = allCategories[idx];
                allCategories[idx] = temp;
                localStorage.setItem('pos_category_order', JSON.stringify(allCategories.map(c => c.id)));
                renderCategoryList();
            }
        });
        downBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (idx < allCategories.length - 1) {
                const temp = allCategories[idx + 1];
                allCategories[idx + 1] = allCategories[idx];
                allCategories[idx] = temp;
                localStorage.setItem('pos_category_order', JSON.stringify(allCategories.map(c => c.id)));
                renderCategoryList();
            }
        });

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
    const cartBadge = document.getElementById("cart-btn-badge");
    if (cartBadge) {
        const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
        cartBadge.textContent = totalQty;
        if (totalQty > 0) cartBadge.style.background = "var(--accent-green)";
        else cartBadge.style.background = "var(--accent-blue)";
    }
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

    // Generar código de ticket único y profesional (Ej. VNT-260802-4912)
    const now = new Date();
    const datePart = now.getFullYear().toString().slice(-2) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const newTicketCode = `VNT-${datePart}-${randomPart}`;

    try {
        // Insertar venta
        const { data: sale, error: saleError } = await supabase
            .from('sales')
            .insert({
                ticket_code: newTicketCode,
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

        document.getElementById("sale-success-ticket").textContent = `Ticket: ${sale?.ticket_code || newTicketCode}`;
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

    // Configurar Histograma de Densidad y Slider de Rango
    const maxTotal = allSales.length > 0 ? Math.ceil(Math.max(...allSales.map(s => s.total_amount || 0))) : 1000;
    const effectiveMax = Math.max(maxTotal, 50);
    const slider = document.getElementById("price-range-slider");
    const maxLabel = document.getElementById("range-max-label");
    if (slider && maxLabel) {
        slider.max = effectiveMax;
        slider.value = effectiveMax;
        maxLabel.textContent = fmt(effectiveMax);
    }
    renderDensityHistogram(effectiveMax);
    updateSliderUI();
}

function renderDensityHistogram(maxVal) {
    const container = document.getElementById("density-chart-bars");
    if (!container) return;
    const numBuckets = 16;
    const bucketSize = maxVal / numBuckets;
    const counts = new Array(numBuckets).fill(0);
    
    allSales.forEach(s => {
        const amt = s.total_amount || 0;
        let idx = Math.floor(amt / bucketSize);
        if (idx >= numBuckets) idx = numBuckets - 1;
        if (idx < 0) idx = 0;
        counts[idx]++;
    });
    
    const maxCount = Math.max(...counts, 1);
    container.innerHTML = "";
    counts.forEach((cnt, idx) => {
        const bar = document.createElement("div");
        bar.className = "density-bar";
        const heightPct = Math.max(8, Math.round((cnt / maxCount) * 100));
        bar.style.height = `${heightPct}%`;
        bar.setAttribute("data-bucket-max", (idx + 1) * bucketSize);
        bar.title = `${cnt} venta(s) entre ${fmt(idx * bucketSize)} y ${fmt((idx + 1) * bucketSize)}`;
        container.appendChild(bar);
    });
}

function updateSliderUI() {
    const slider = document.getElementById("price-range-slider");
    const selectedLabel = document.getElementById("range-selected-label");
    if (!slider || !selectedLabel) return;
    const val = parseFloat(slider.value) || 0;
    const maxVal = parseFloat(slider.max) || 1000;
    
    if (val >= maxVal) {
        selectedLabel.textContent = "S/ 0 — Todo";
    } else {
        selectedLabel.textContent = `S/ 0 — ${fmt(val)}`;
    }
    
    document.querySelectorAll("#density-chart-bars .density-bar").forEach(bar => {
        const bucketMax = parseFloat(bar.getAttribute("data-bucket-max")) || 0;
        const bucketSize = maxVal / 16;
        if (bucketMax - (bucketSize * 0.5) <= val) {
            bar.classList.remove("dimmed");
        } else {
            bar.classList.add("dimmed");
        }
    });
}

function applyAllFilters() {
    const searchQ = document.getElementById("all-sales-search")?.value?.toLowerCase() || "";
    const month = document.getElementById("filter-month")?.value || "";
    const year = document.getElementById("filter-year")?.value || "";
    const vendor = document.getElementById("filter-vendor")?.value || "";
    const maxPrice = parseFloat(document.getElementById("price-range-slider")?.value) ?? Infinity;

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
        if ((s.total_amount || 0) > maxPrice) return false;

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