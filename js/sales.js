import { supabase, getSession, fmt, showToast, generateSequentialTicket } from './supabase.js';

let allProducts = [], allCategories = [], selectedCategoryId = null, isSearching = false, filteredProducts = [], cart = {};
let allSales = [];
let salesPage = 0;
const SALES_PER_PAGE = 10;
let showCostView = false;

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

    document.getElementById("product-search")?.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();
            const q = e.target.value.trim();
            if (q) {
                const exactMatch = allProducts.find(p => p.code.toLowerCase() === q.toLowerCase());
                if (exactMatch) {
                    addToCart(exactMatch);
                    e.target.value = '';
                    e.target.dispatchEvent(new Event("input"));
                    showToast(`Agregado: ${exactMatch.name}`, 'success');
                }
            }
        }
    });

    // Soporte global para Lectores de Código de Barras
    let barcodeString = '';
    let barcodeTimeout = null;
    document.addEventListener("keydown", e => {
        // Ignorar si el usuario está escribiendo en otro input o textarea (para no interferir)
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
        
        if (e.key === "Enter") {
            if (barcodeString.length > 2) {
                const exactMatch = allProducts.find(p => p.code.toLowerCase() === barcodeString.toLowerCase());
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
            barcodeTimeout = setTimeout(() => { barcodeString = ''; }, 60); // Escáneres escriben muy rápido
        }
    });

    document.getElementById("confirm-sale-btn")?.addEventListener("click", confirmSale);
    document.getElementById("clear-cart-btn")?.addEventListener("click", () => { cart = {}; renderCart(); });
    document.getElementById("sale-discount")?.addEventListener("input", renderCart);
    document.getElementById("all-sales-search")?.addEventListener("input", () => applyAllFilters());
    document.getElementById("filter-month")?.addEventListener("change", applyAllFilters);
    document.getElementById("filter-year")?.addEventListener("change", applyAllFilters);
    document.getElementById("filter-vendor")?.addEventListener("change", applyAllFilters);
    document.getElementById("filter-payment")?.addEventListener("change", applyAllFilters);

    const priceSlider = document.getElementById("price-range-slider");
    if (priceSlider) {
        priceSlider.addEventListener("input", () => {
            updateSliderUI();
            applyAllFilters();
        });
    }

    document.getElementById("load-more-sales-btn")?.addEventListener("click", loadNextSalesPage);

    const saleBtn = document.getElementById("pos-view-sale");
    const costBtn = document.getElementById("pos-view-cost");
    
    function applyPricingView(isCost) {
        showCostView = isCost;
        if (isCost) {
            costBtn?.classList.add("active");
            saleBtn?.classList.remove("active");
        } else {
            saleBtn?.classList.add("active");
            costBtn?.classList.remove("active");
        }
        renderProductGridByCategory();
        renderCart();
    }
    
    saleBtn?.addEventListener("click", () => applyPricingView(false));
    costBtn?.addEventListener("click", () => applyPricingView(true));

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
            
        // Leer favoritos del localStorage para evitar errores de permisos
        const localFavs = JSON.parse(localStorage.getItem('pos_favorites') || '[]');
        
        allProducts = data?.map(p => ({ 
            ...p, 
            category_name: p.categories?.name,
            is_favorite: localFavs.includes(p.id) 
        })) || [];
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

    const isCost = showCostView;
    const displayPrice = isCost ? product.cost_price : product.sale_price;
    const priceLabel = isCost ? "Costo: " : "";
    const priceColor = isCost ? "var(--accent-orange)" : "var(--brand-accent)";

    const nameDiv = document.createElement("div"); nameDiv.className = "product-name"; nameDiv.textContent = product.name;
    const brandDiv = document.createElement("div"); brandDiv.style.cssText = "font-size:0.75rem; color: var(--accent-blue); font-weight: 600; margin: 0.2rem 0;"; brandDiv.textContent = `🏷️ ${product.brand || "General"}`;
    const priceDiv = document.createElement("div"); priceDiv.className = "product-price"; 
    priceDiv.style.color = priceColor;
    priceDiv.textContent = `${priceLabel}${fmt(displayPrice)}`;

    const infoDiv = document.createElement("div");
    infoDiv.className = "product-info-row";
    infoDiv.innerHTML = `<span>Stock: ${product.stock}</span><span>Cód: ${product.code}</span>`;

    card.append(nameDiv, brandDiv, priceDiv, infoDiv, favBtn);
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
        
        let localFavs = JSON.parse(localStorage.getItem('pos_favorites') || '[]');
        
        if (product.is_favorite) {
            localFavs = localFavs.filter(id => id !== productId);
            product.is_favorite = false;
        } else {
            if (!localFavs.includes(productId)) localFavs.push(productId);
            product.is_favorite = true;
        }
        
        localStorage.setItem('pos_favorites', JSON.stringify(localFavs));
        
        // Re-render sin llamar de nuevo a Supabase (muy rápido)
        renderFavorites();
        renderProductGridByCategory();
    } catch (e) { 
        console.error(e);
        showToast("Error al guardar favorito", "error"); 
    }
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
    let totalCost = 0;
    container.innerHTML = "";
    items.forEach(({ product, quantity }) => {
        const sub = product.sale_price * quantity;
        subtotal += sub;
        totalCost += (product.cost_price || 0) * quantity;
        
        let costHtml = '';
        if (showCostView) {
            costHtml = `<div style="font-size: 0.75rem; color: var(--accent-orange); margin-top: 2px;">Costo Un.: ${fmt(product.cost_price)}</div>`;
        }

        const item = document.createElement("div");
        item.className = "cart-item";
        item.innerHTML = `
            <div class="cart-item-info" style="flex:1;">
                <div class="cart-item-name">${product.name}</div>
                ${costHtml}
            </div>
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
    
    const finalTotal = subtotal - discount;
    if (totalEl) totalEl.textContent = fmt(finalTotal);

    const costRow = document.getElementById("cart-cost-row");
    const profitRow = document.getElementById("cart-profit-row");
    if (costRow && profitRow) {
        if (showCostView) {
            costRow.style.display = "flex";
            profitRow.style.display = "flex";
            const profit = finalTotal - totalCost;
            document.getElementById("cart-total-cost").textContent = fmt(totalCost);
            const profitEl = document.getElementById("cart-total-profit");
            profitEl.textContent = fmt(profit);
            profitEl.style.color = profit >= 0 ? "var(--accent-green)" : "var(--accent-red)";
        } else {
            costRow.style.display = "none";
            profitRow.style.display = "none";
        }
    }

    if (confirmBtn) confirmBtn.disabled = false;
}

async function confirmSale() {
    const items = Object.values(cart).map(({ product, quantity }) => ({
        product_id: product.id, product_name: product.name,
        unit_price: product.sale_price, quantity, subtotal: product.sale_price * quantity
    }));
    const customerName = document.getElementById("sale-customer")?.value?.trim() || "Cliente Anónimo";
    const discount = parseFloat(document.getElementById("sale-discount")?.value) || 0;
    const paymentMethod = document.getElementById("sale-payment-method")?.value || "Caja";
    const subtotalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
    const totalAmount = subtotalAmount - discount;
    const activeSeller = document.querySelector('input[name="sale-active-seller"]:checked')?.value || 'Anónimo';
    const operatorName = activeSeller;

    try {
        // Consultar el ID máximo actual de ventas para generar el código secuencial (Opción sin triggers)
        const { data: lastSale } = await supabase.from('sales').select('id').order('id', { ascending: false }).limit(1);
        const nextId = (lastSale && lastSale.length > 0) ? lastSale[0].id + 1 : 1;
        const newTicketCode = generateSequentialTicket('V', nextId);

        // Insertar venta
        const { data: sale, error: saleError } = await supabase
            .from('sales')
            .insert({
                ticket_code: newTicketCode,
                operator_name: operatorName,
                customer_name: customerName,
                subtotal_amount: subtotalAmount,
                discount_amount: discount,
                total_amount: totalAmount,
                payment_method: paymentMethod
            })
            .select()
            .single();

        if (saleError) throw saleError;

        // Insertar items
        const saleItems = items.map(i => ({ ...i, sale_id: sale.id }));
        const { error: itemsError } = await supabase.from('sale_items').insert(saleItems);
        if (itemsError) throw itemsError;

        // Actualizar stock y registrar en auditoría (Kardex)
        for (const item of items) {
            const product = allProducts.find(p => p.id === item.product_id);
            if (product) {
                const newStock = product.stock - item.quantity;
                await supabase
                    .from('products')
                    .update({ stock: newStock })
                    .eq('id', item.product_id);

                await supabase
                    .from('stock_audit')
                    .insert({
                        product_id: item.product_id,
                        product_name: product.name,
                        quantity_change: -item.quantity,
                        previous_stock: product.stock,
                        new_stock: newStock,
                        operator_name: operatorName,
                        movement_type: 'VENTA',
                        reference_id: sale?.id || null,
                        reference_code: sale?.ticket_code || newTicketCode,
                        notes: `Venta (Ticket: ${sale?.ticket_code || newTicketCode})`
                    });
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

        // Actualización optimista inmediata de la tabla para reflejar la venta al instante
        const optimisticSale = {
            ...sale,
            id: sale?.id || Math.random(),
            ticket_code: sale?.ticket_code || newTicketCode,
            created_at: new Date().toISOString(),
            customer_name: customerName,
            operator_name: operatorName,
            subtotal_amount: subtotalAmount,
            discount_amount: discount,
            total_amount: totalAmount,
            sale_items: saleItems
        };
        allSales.unshift(optimisticSale);
        applyAllFilters();

        await loadProductsForPOS();
        await loadRecentSales();
    } catch (e) {
        console.error(e);
        showToast("Error al registrar la venta", "error");
    }
}

async function loadRecentSales(isLoadMore = false) {
    try {
        if (!isLoadMore) salesPage = 0;
        const from = salesPage * SALES_PER_PAGE;
        const to = from + SALES_PER_PAGE - 1;

        const { data, error } = await supabase
            .from('sales')
            .select('*, sale_items(*)')
            .order('created_at', { ascending: false })
            .range(from, to);
            
        if (error) throw error;
            
        if (data) {
            if (!isLoadMore) {
                // Si es la primera carga, reseteamos manteniendo las ventas optimistas
                const dbSaleIds = new Set(data.map(s => s.id));
                const optimisticSales = allSales.filter(s => !dbSaleIds.has(s.id));
                allSales = [...optimisticSales, ...data];
            } else {
                // Si estamos cargando más, agregamos al array existente
                allSales = [...allSales, ...data];
            }
            
            allSales.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        }
        
        populateFilterOptions();
        applyAllFilters();

        const btn = document.getElementById("load-more-sales-btn");
        if (btn) {
            // Mostrar botón solo si trajimos exactamente SALES_PER_PAGE (podría haber más)
            if (data && data.length === SALES_PER_PAGE) {
                btn.style.display = "inline-block";
            } else {
                btn.style.display = "none";
            }
        }
    } catch (e) { console.error(e); }
}

async function loadNextSalesPage() {
    salesPage++;
    const btn = document.getElementById("load-more-sales-btn");
    const originalText = btn.innerHTML;
    btn.innerHTML = "⏳ Cargando...";
    btn.disabled = true;
    await loadRecentSales(true);
    btn.innerHTML = originalText;
    btn.disabled = false;
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
    
    // El slider tiene step="5". Si no redondeamos hacia arriba en múltiplos de 5, 
    // el navegador forzará el value hacia abajo, filtrando accidentalmente la venta más alta.
    const step = 5;
    const effectiveMax = Math.ceil(Math.max(maxTotal, 50) / step) * step;
    
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
    const payment = document.getElementById("filter-payment")?.value || "";
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
        if (payment && s.payment_method !== payment) return false;

        const totalAmt = s.total_amount || 0;
        if (totalAmt > maxPrice) return false;

        return true;
    });

    renderAllSalesTable(filtered);
}

function renderAllSalesTable(sales) {
    const tbody = document.getElementById("all-sales-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (sales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-dim);">No se encontraron ventas</td></tr>';
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
        const itemsList = (s.sale_items && s.sale_items.length > 0)
            ? s.sale_items.map(item => {
                const prod = allProducts.find(p => p.id === item.product_id || p.name === item.product_name);
                const brand = prod?.brand || "General";
                return `<div style="font-size: 0.85rem; margin-bottom: 0.2rem;"><strong>${item.product_name || 'Producto'}</strong> <span style="background:rgba(88,101,242,0.15); color:var(--accent-blue); padding:1px 6px; border-radius:4px; font-size:0.75rem; font-weight:600;">🏷️ ${brand}</span> ×${item.quantity} (${fmt(item.unit_price || 0)})</div>`;
            }).join("")
            : '<span class="text-dim">Sin detalle</span>';

        let paymentBadge = `<span style="background:rgba(255,255,255,0.1); padding:2px 8px; border-radius:6px; font-size:0.8rem;">💵 Caja</span>`;
        if (s.payment_method === 'Yape/Plin') paymentBadge = `<span style="background:rgba(128,0,128,0.2); color:#e17dfd; padding:2px 8px; border-radius:6px; font-size:0.8rem; font-weight:600;">📱 Yape/Plin</span>`;
        else if (s.payment_method === 'Transferencia') paymentBadge = `<span style="background:rgba(59,130,246,0.2); color:#60a5fa; padding:2px 8px; border-radius:6px; font-size:0.8rem; font-weight:600;">🏦 Transf.</span>`;
        else if (s.payment_method === 'POS') paymentBadge = `<span style="background:rgba(245,158,11,0.2); color:#fbbf24; padding:2px 8px; border-radius:6px; font-size:0.8rem; font-weight:600;">💳 POS</span>`;

        tr.innerHTML = `
            <td><strong>${s.ticket_code || "-"}</strong></td>
            <td>${fechaFormateada}</td>
            <td>${s.customer_name || "-"}</td>
            <td>${itemsList}</td>
            <td>${fmt(s.subtotal_amount || s.total_amount || 0)}</td>
            <td>${(s.discount_amount > 0) ? `<span style="color:var(--accent-red);font-weight:700;">-${fmt(s.discount_amount)}</span>` : "S/ 0.00"}</td>
            <td><strong style="color:var(--accent-green);font-size:1rem;">${fmt(s.total_amount || 0)}</strong></td>
            <td>${paymentBadge}</td>
            <td>${s.operator_name || "-"}</td>`;
        tbody.appendChild(tr);
    });
}