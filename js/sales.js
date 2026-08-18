import { supabase, getSession, fmt, showToast, generateSequentialTicket } from './supabase.js';

let allProducts = [], allCategories = [], selectedCategoryId = null, isSearching = false, filteredProducts = [], cart = {};
let allSales = [];
let salesPage = 0;
const SALES_PER_PAGE = 10;
let showCostView = false;
let lastSaleData = null;

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
        let baseProducts = selectedCategoryId !== null ? allProducts.filter(p => p.category_id === selectedCategoryId) : allProducts;
        filteredProducts = baseProducts.filter(p =>
            p.name.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q) ||
            (p.code || '').toLowerCase().includes(q) || (p.category_name && p.category_name.toLowerCase().includes(q))
        );
        renderCategoryList(); renderProductGridByCategory();
    });

    document.getElementById("pos-category-filter")?.addEventListener("change", e => {
        const val = e.target.value;
        if (!val) {
            selectedCategoryId = null;
        } else {
            selectedCategoryId = parseInt(val);
        }
        isSearching = false;
        const ps = document.getElementById("product-search"); if (ps) ps.value = '';
        renderProductGridByCategory();
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
    document.getElementById("print-receipt-btn")?.addEventListener("click", () => { if (lastSaleData) printReceipt(lastSaleData); });
    document.getElementById("all-sales-search")?.addEventListener("input", () => applyAllFilters());
    document.getElementById("filter-period")?.addEventListener("change", applyAllFilters);
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
        renderFavorites(); // <--- This line is added to fix the issue
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

    const toggleFiltersBtn = document.getElementById("toggle-advanced-filters-btn");
    const filtersContainer = document.getElementById("advanced-filters-container");
    const filtersIcon = document.getElementById("filters-icon");
    toggleFiltersBtn?.addEventListener("click", () => {
        if (filtersContainer.style.display === "none") {
            filtersContainer.style.display = "block";
            if (filtersIcon) filtersIcon.textContent = "▲";
        } else {
            filtersContainer.style.display = "none";
            if (filtersIcon) filtersIcon.textContent = "▼";
        }
    });
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
            
        allProducts = data?.map(p => ({ 
            ...p, 
            category_name: p.categories?.name
        })) || [];
        renderFavorites();
        renderProductGridByCategory();
    } catch (e) { console.error(e); }
}

function renderCategoryList() {
    const select = document.getElementById("pos-category-filter");
    if (!select) return;
    
    select.innerHTML = '<option value="">📂 Todas</option>';
    
    allCategories.forEach((cat) => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        select.appendChild(option);
    });
    
    if (selectedCategoryId && allCategories.some(c => c.id == selectedCategoryId)) {
        select.value = selectedCategoryId;
    } else {
        select.value = "";
        selectedCategoryId = null;
    }
}

function renderProductGridByCategory() {
    const container = document.getElementById("products-grid");
    if (!container) return;
    container.innerHTML = '';
    let productsToShow = isSearching ? filteredProducts :
        selectedCategoryId !== null ? allProducts.filter(p => p.category_id === selectedCategoryId) : allProducts;
    
    if (productsToShow.length === 0) {
        container.innerHTML = `<p class="text-dim" style="text-align:center;padding:2rem;grid-column:1/-1;">No hay productos</p>`;
        return;
    }

    // Agrupar por categoría
    const grouped = {};
    productsToShow.forEach(p => {
        const catName = p.category_name || "Sin categoría";
        if (!grouped[catName]) grouped[catName] = [];
        grouped[catName].push(p);
    });

    const catKeys = Object.keys(grouped).sort();

    catKeys.forEach(catName => {
        const prods = grouped[catName];
        prods.sort((a, b) => (b.sales_count || 0) - (a.sales_count || 0));

        // Cabecera de grupo
        const header = document.createElement("div");
        header.style.cssText = "grid-column: 1 / -1; width: 100%; border-bottom: 2px solid var(--glass-border); padding-bottom: 0.5rem; margin-top: 1rem; margin-bottom: 0.5rem;";
        header.innerHTML = `<h3 style="color: var(--text-secondary); font-size: 1.15rem; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 0.5rem;"><span style="color: var(--brand-accent);">📁</span> ${catName}</h3>`;
        container.appendChild(header);

        // Tarjetas de productos del grupo
        prods.forEach(p => createProductCard(p, container));
    });
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
    const brandDiv = document.createElement("div"); brandDiv.style.cssText = "font-size:0.75rem; color: var(--accent-blue); font-weight: 600; margin: 0.2rem 0;"; brandDiv.textContent = `${product.brand || "General"}`;
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
        
        const newStatus = !product.is_favorite;
        
        // Actualizar en base de datos pidiendo que devuelva el registro modificado
        const { data, error } = await supabase
            .from('products')
            .update({ is_favorite: newStatus })
            .eq('id', productId)
            .select();
            
        if (error) throw error;

        // Si no devuelve data, significa que el UPDATE falló silenciosamente (probablemente por RLS)
        if (!data || data.length === 0) {
            showToast("No se guardó: Verifica los permisos RLS en Supabase para el campo is_favorite", "error");
            // Revertir cambio local
            return;
        }
        
        // Actualizar localmente si tuvo éxito
        product.is_favorite = newStatus;
        
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

    if (items.length === 0) return;

    if (localStorage.getItem("requireSaleConfirmation") === "true") {
        if (!confirm("¿Estás seguro de registrar esta venta?")) {
            return;
        }
    }
    const customerName = document.getElementById("sale-customer")?.value?.trim() || "Cliente Anónimo";
    const discount = parseFloat(document.getElementById("sale-discount")?.value) || 0;
    const paymentMethod = document.getElementById("sale-payment-method")?.value || "Caja";
    const subtotalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
    const totalAmount = subtotalAmount - discount;
    const activeSeller = document.querySelector('input[name="sale-active-seller"]:checked')?.value || 'Anónimo';
    const operatorName = activeSeller;

    try {
        // Obtener el próximo ID para generar el ticket definitivo de una vez
        const { data: maxRow } = await supabase.from('sales').select('id').order('id', { ascending: false }).limit(1).single();
        const nextId = (maxRow?.id || 0) + 1;
        const newTicketCode = generateSequentialTicket('V', nextId);

        const { data: newSale, error: insertError } = await supabase
            .from('sales')
            .insert({
                subtotal_amount: subtotalAmount,
                discount_amount: discount,
                total_amount: totalAmount,
                operator_name: operatorName,
                payment_method: paymentMethod,
                customer_name: customerName,
                ticket_code: newTicketCode
            })
            .select()
            .single();

        if (insertError) throw insertError;

        // Insertar items
        const saleItems = items.map(i => ({ ...i, sale_id: newSale.id }));
        const { error: itemsError } = await supabase.from('sale_items').insert(saleItems);
        if (itemsError) throw itemsError;

        // Actualizar stock y registrar auditoría
        for (const item of items) {
            // Re-consultar stock real desde la BD para evitar problemas de concurrencia
            const { data: dbProduct } = await supabase.from('products').select('stock').eq('id', item.product_id).single();
            const realStock = dbProduct ? dbProduct.stock : 0;
            const newStock = realStock - item.quantity;

            await supabase.from('products').update({ stock: newStock }).eq('id', item.product_id);

            await supabase.from('stock_audit').insert({
                product_id: item.product_id,
                product_name: item.product_name,
                quantity_change: -item.quantity,
                previous_stock: realStock,
                new_stock: newStock,
                operator_name: operatorName,
                movement_type: 'VENTA',
                reference_id: newSale.id,
                reference_code: newTicketCode,
                notes: `Venta (Ticket: ${newTicketCode})`
            });
        }

        // Guardar datos de la última venta para impresión
        lastSaleData = {
            ticketCode: newTicketCode,
            date: new Date(),
            customerName,
            operatorName,
            paymentMethod,
            items,
            subtotalAmount,
            discount,
            totalAmount
        };

        document.getElementById("sale-success-ticket").textContent = `Ticket: ${newTicketCode}`;
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
            ...newSale,
            id: newSale.id,
            ticket_code: newTicketCode,
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
            .select('*, sale_items(*, products(brand))')
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
    const period = document.getElementById("filter-period")?.value || "";
    const month = document.getElementById("filter-month")?.value || "";
    const year = document.getElementById("filter-year")?.value || "";
    const vendor = document.getElementById("filter-vendor")?.value || "";
    const payment = document.getElementById("filter-payment")?.value || "";
    const maxPriceVal = parseFloat(document.getElementById("price-range-slider")?.value);
    const maxPrice = isNaN(maxPriceVal) ? Infinity : maxPriceVal;

    let filtered = allSales.filter(s => {
        const matchSearch = !searchQ ||
            (s.customer_name && s.customer_name.toLowerCase().includes(searchQ)) ||
            (s.ticket_code && s.ticket_code.toLowerCase().includes(searchQ)) ||
            (s.operator_name && s.operator_name.toLowerCase().includes(searchQ)) ||
            (s.sale_items && s.sale_items.some(item => 
                (item.product_name && item.product_name.toLowerCase().includes(searchQ)) ||
                (item.products && item.products.brand && item.products.brand.toLowerCase().includes(searchQ))
            ));
        if (!matchSearch) return false;

        if (period) {
            if (!s.created_at) return false;
            try {
                const d = new Date(s.created_at);
                const now = new Date();
                if (period === 'today') {
                    if (d.getDate() !== now.getDate() || d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
                } else if (period === 'yesterday') {
                    const yesterday = new Date(now);
                    yesterday.setDate(yesterday.getDate() - 1);
                    if (d.getDate() !== yesterday.getDate() || d.getMonth() !== yesterday.getMonth() || d.getFullYear() !== yesterday.getFullYear()) return false;
                } else if (period === 'week') {
                    // Lunes a hoy de la semana actual
                    const day = now.getDay();
                    const diffToMonday = day === 0 ? 6 : day - 1;
                    const monday = new Date(now);
                    monday.setDate(now.getDate() - diffToMonday);
                    monday.setHours(0, 0, 0, 0);
                    if (d < monday) return false;
                }
            } catch { return false; }
        }

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
    const mobileCardsContainer = document.getElementById("all-sales-cards-mobile");
    
    if (tbody) tbody.innerHTML = "";
    if (mobileCardsContainer) mobileCardsContainer.innerHTML = "";
    
    if (sales.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-dim);">No se encontraron ventas</td></tr>';
        if (mobileCardsContainer) mobileCardsContainer.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-dim);">No se encontraron ventas</div>';
        return;
    }
    
    sales.forEach(s => {
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
                return `<div style="font-size: 0.85rem; margin-bottom: 0.2rem;"><strong>${item.product_name || 'Producto'}</strong> <span style="background:rgba(88,101,242,0.15); color:var(--accent-blue); padding:1px 6px; border-radius:4px; font-size:0.75rem; font-weight:600;">${brand}</span> ×${item.quantity} (${fmt(item.unit_price || 0)})</div>`;
            }).join("")
            : '<span class="text-dim">Sin detalle</span>';

        let paymentBadge = `<span style="background:rgba(255,255,255,0.1); padding:2px 8px; border-radius:6px; font-size:0.8rem;">Caja</span>`;
        if (s.payment_method === 'Yape/Plin') paymentBadge = `<span style="background:rgba(128,0,128,0.2); color:#e17dfd; padding:2px 8px; border-radius:6px; font-size:0.8rem; font-weight:600;">Yape/Plin</span>`;
        else if (s.payment_method === 'Transferencia') paymentBadge = `<span style="background:rgba(59,130,246,0.2); color:#60a5fa; padding:2px 8px; border-radius:6px; font-size:0.8rem; font-weight:600;">Transf.</span>`;
        else if (s.payment_method === 'POS') paymentBadge = `<span style="background:rgba(245,158,11,0.2); color:#fbbf24; padding:2px 8px; border-radius:6px; font-size:0.8rem; font-weight:600;">POS</span>`;

        if (tbody) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${s.ticket_code || "-"}</strong></td>
                <td>${fechaFormateada}</td>
                <td>${s.customer_name || "-"}</td>
                <td>${itemsList}</td>
                <td>${fmt(s.subtotal_amount || s.total_amount || 0)}</td>
                <td>${(s.discount_amount > 0) ? `<span style="color:var(--accent-red);font-weight:700;">-${fmt(s.discount_amount)}</span>` : "S/ 0.00"}</td>
                <td><strong style="color:var(--accent-green);font-size:1rem;">${fmt(s.total_amount || 0)}</strong></td>
                <td>${paymentBadge}</td>
                <td>${s.operator_name || "-"}</td>
                <td><button class="btn-outline btn-sm" style="color:var(--accent-red);border-color:var(--accent-red);" onclick="voidSale(${s.id}, '${s.ticket_code}')">Anular</button></td>`;
            tbody.appendChild(tr);
        }

        if (mobileCardsContainer) {
            const card = document.createElement("div");
            card.className = "sale-card-mobile";
            card.innerHTML = `
                <div class="sale-card-header">
                    <div class="sale-card-ticket">${s.ticket_code || "-"}</div>
                    <div class="sale-card-date">${fechaFormateada}</div>
                </div>
                <div class="sale-card-customer"><strong>Cliente:</strong> ${s.customer_name || "Anónimo"}</div>
                <div class="sale-card-items">
                    ${itemsList}
                </div>
                <div class="sale-card-footer">
                    <div class="sale-card-total-row">
                        <div><strong>Total:</strong> <span class="sale-card-total-amount">${fmt(s.total_amount || 0)}</span></div>
                        <div>${paymentBadge}</div>
                    </div>
                    <div class="sale-card-vendor-row">
                        <div class="sale-card-vendor"><strong>Vendedor:</strong> ${s.operator_name || "-"}</div>
                        <button class="btn-outline btn-sm" style="color:var(--accent-red);border-color:var(--accent-red);" onclick="voidSale(${s.id}, '${s.ticket_code}')">Anular</button>
                    </div>
                </div>
            `;
            mobileCardsContainer.appendChild(card);
        }
    });
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
        itemsHtml += `
            <tr>
                <td colspan="4" style="padding: 1px 0 0 0; font-weight: 900; font-size: 12px; color: #000;">${item.product_name}</td>
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

        // 1. Obtener los items de la venta
        const { data: items, error: itemsErr } = await supabase.from('sale_items').select('*').eq('sale_id', saleId);
        if (itemsErr) throw itemsErr;

        if (items && items.length > 0) {
            // 2. Devolver stock e insertar en auditoría
            for (const item of items) {
                const { data: prod } = await supabase.from('products').select('stock').eq('id', item.product_id).single();
                if (prod) {
                    const newStock = prod.stock + item.quantity;
                    await supabase.from('products').update({ stock: newStock }).eq('id', item.product_id);
                    
                    await supabase.from('stock_audit').insert({
                        product_id: item.product_id,
                        product_name: item.product_name,
                        quantity_change: item.quantity,
                        previous_stock: prod.stock,
                        new_stock: newStock,
                        operator_name: operatorName,
                        movement_type: 'DEVOLUCION_CLIENTE',
                        reference_id: saleId,
                        reference_code: ticketCode,
                        notes: `Anulación de Venta (Ticket: ${ticketCode})`
                    });
                }
            }
        }

        // 3. Eliminar los items de la venta y luego la venta misma
        await supabase.from('sale_items').delete().eq('sale_id', saleId);
        const { error: saleErr } = await supabase.from('sales').delete().eq('id', saleId);
        
        if (saleErr) throw saleErr;

        showToast(`Venta ${ticketCode} anulada exitosamente`);
        await loadRecentSales();
        await loadProductsForPOS(); // Actualizar catálogo
    } catch (e) {
        console.error("Error al anular venta:", e);
        showToast("Error al anular la venta", "error");
    }
}

window.voidSale = voidSale;