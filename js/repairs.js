import { supabase, getSession, fmt, showToast, generateSequentialTicket } from './supabase.js';

let allRepairs = [];
let repairsPage = 0;
const REPAIRS_PER_PAGE = 10;
let currentRepairId = null;
let currentStatusFilter = 'all';
let equipmentTypes = [];
let brandModels = [];

export async function loadRepairs() {
    await Promise.all([
        loadListsForRepairs(),
        loadAllRepairs()
    ]);
    renderRepairs();
}

export function bindRepairEvents() {
    document.getElementById("new-repair-btn")?.addEventListener("click", openNewRepairModal);
    document.getElementById("cancel-repair-btn")?.addEventListener("click", () => document.getElementById("new-repair-modal").classList.add("hidden"));
    document.getElementById("save-repair-btn")?.addEventListener("click", saveRepair);
    document.getElementById("cancel-status-btn")?.addEventListener("click", () => document.getElementById("change-status-modal").classList.add("hidden"));
    document.getElementById("confirm-status-btn")?.addEventListener("click", confirmChangeStatus);
    document.getElementById("close-history-modal")?.addEventListener("click", () => document.getElementById("history-modal").classList.add("hidden"));
    document.getElementById("add-repair-part-btn")?.addEventListener("click", addRepairPart);
    document.getElementById("add-external-cost-btn")?.addEventListener("click", addExternalCost);

    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentStatusFilter = btn.dataset.status;
            renderRepairs();
        });
    });

    document.getElementById("repair-global-search")?.addEventListener("input", renderRepairs);

    // Asegurar vista en lista compacta (único modo)
    const container = document.getElementById("repairs-list");
    if (container) {
        container.classList.remove("jsGridView");
        container.classList.add("jsListView");
    }

    document.getElementById("load-more-repairs-btn")?.addEventListener("click", loadNextRepairsPage);
}

async function loadListsForRepairs() {
    try {
        const [{ data: eq }, { data: br }] = await Promise.all([
            supabase.from('equipment_types').select('*').order('name'),
            supabase.from('brand_models').select('*').order('name')
        ]);
        equipmentTypes = eq || [];
        brandModels = br || [];
        populateDatalists();
    } catch (e) { console.error(e); }
}

function populateDatalists() {
    const eqList = document.getElementById("equipment-list");
    const brList = document.getElementById("brand-list");
    if (eqList) eqList.innerHTML = equipmentTypes.map(e => `<option value="${e.name}">`).join('');
    if (brList) brList.innerHTML = brandModels.map(b => `<option value="${b.name}">`).join('');
}

async function loadAllRepairs(isLoadMore = false) {
    try {
        if (!isLoadMore) repairsPage = 0;
        const from = repairsPage * REPAIRS_PER_PAGE;
        const to = from + REPAIRS_PER_PAGE - 1;

        const { data, error } = await supabase
            .from('repairs')
            .select('*')
            .order('created_at', { ascending: false })
            .range(from, to);
            
        if (error) throw error;

        if (data) {
            if (!isLoadMore) {
                // Mantener reparaciones optimistas si existieran
                const dbRepairIds = new Set(data.map(r => r.id));
                const optimisticRepairs = allRepairs.filter(r => !dbRepairIds.has(r.id));
                allRepairs = [...optimisticRepairs, ...data];
            } else {
                allRepairs = [...allRepairs, ...data];
            }
            allRepairs.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        }

        const btn = document.getElementById("load-more-repairs-btn");
        if (btn) {
            if (data && data.length === REPAIRS_PER_PAGE) {
                btn.style.display = "inline-block";
            } else {
                btn.style.display = "none";
            }
        }
    } catch (e) { console.error(e); }
}

async function loadNextRepairsPage() {
    repairsPage++;
    const btn = document.getElementById("load-more-repairs-btn");
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.innerHTML = "⏳ Cargando...";
    btn.disabled = true;
    await loadAllRepairs(true);
    renderRepairs();
    btn.innerHTML = originalText;
    btn.disabled = false;
}

function renderRepairs() {
    const container = document.getElementById("repairs-list");
    if (!container) return;
    const searchQ = document.getElementById("repair-global-search")?.value?.toLowerCase() || '';

    let filtered = allRepairs.filter(r => {
        if (currentStatusFilter !== 'all' && r.status !== currentStatusFilter) return false;
        if (searchQ) {
            const searchStr = `${r.customer_name} ${r.equipment_type} ${r.brand_model} ${r.fault_description} ${r.customer_phone} ${r.operator_name} ${r.ticket_code}`.toLowerCase();
            if (!searchStr.includes(searchQ)) return false;
        }
        return true;
    });

    container.innerHTML = '';
    if (filtered.length === 0) {
        container.innerHTML = '<p class="text-dim" style="text-align:center;padding:2rem;">No hay reparaciones</p>';
        return;
    }

    filtered.forEach(r => {
        const createdDate = new Date(r.created_at);
        const daysDiff = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));
        const timeTag = daysDiff === 0 ? 'Hoy' : daysDiff === 1 ? 'Hace 1 día' : `Hace ${daysDiff} días`;
        const progressMap = { PENDIENTE: 25, EN_DIAGNOSTICO: 50, EN_PROCESO: 75, TERMINADO: 100, ENTREGADO: 100 };
        const prog = progressMap[r.status] || 50;

        const card = document.createElement("div");
        card.className = `repair-card card-${r.status.toLowerCase()}`;
        card.innerHTML = `
            <div class="repair-card-header">
                <div style="flex: 1; min-width: 0;">
                    <div class="repair-ticket">${r.ticket_code}</div>
                    <h3 class="repair-card-title" title="${r.equipment_type} ${r.brand_model}">${r.equipment_type} ${r.brand_model}</h3>
                    <div class="repair-card-subtitle text-dim" title="Falla: ${r.fault_description}">Falla: ${r.fault_description}</div>
                    <div class="repair-customer" style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.4rem;">
                        <span>👤 ${r.customer_name}</span>
                        ${r.customer_phone ? `<span class="repair-phone" style="margin: 0; font-size: 0.85rem; color: var(--text-dim); font-weight: 500;">📱 Cel: ${r.customer_phone}</span>` : ''}
                    </div>
                </div>
                <div class="repair-status-group" style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.3rem;">
                    <span class="status-badge status-${r.status}">${statusLabel(r.status)}</span>
                    <span class="days-left" title="Tiempo en taller / desde ingreso" style="font-size: 0.75rem; background: var(--glass-bg); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--glass-border);">⏱️ ${timeTag}</span>
                </div>
            </div>
            <div class="repair-details" style="grid-template-columns: 1fr 1fr; margin-bottom: 0.75rem;">
                <div class="repair-detail-item"><div class="repair-detail-label">Ingresado</div><div class="repair-detail-value">${createdDate.toLocaleDateString('es-PE')}</div></div>
                <div class="repair-detail-item"><div class="repair-detail-label">Técnico</div><div class="repair-detail-value">${r.operator_name}</div></div>
            </div>
            <div class="box-progress-wrapper">
                <div class="box-progress-header"><span>Progreso del servicio</span><span>${prog}%</span></div>
                <div class="box-progress-bar">
                    <span class="box-progress" style="width: ${prog}%;"></span>
                </div>
            </div>
            <div class="repair-card-footer">
                <div class="repair-amounts">
                    <div class="repair-amount"><div class="repair-amount-label">Total</div><div class="repair-amount-value">${fmt(r.total_amount)}</div></div>
                    <div class="repair-amount"><div class="repair-amount-label">Adelanto</div><div class="repair-amount-value amount-paid">${fmt(r.advance_payment)}</div></div>
                    <div class="repair-amount"><div class="repair-amount-label">Saldo</div><div class="repair-amount-value amount-pending">${fmt(r.remaining_balance)}</div></div>
                </div>
                <div class="repair-actions" style="display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center;">
                    <button class="btn-primary btn-sm" onclick="openChangeStatus(${r.id}, '${r.ticket_code}', '${r.status}')" style="flex: 1;">Cambiar Estado</button>
                    <div class="repair-dropdown" style="position: relative;">
                        <button class="btn-outline btn-sm repair-dropdown-toggle" onclick="toggleDropdown(event, this)">⋮ Opciones</button>
                        <div class="repair-dropdown-menu hidden">
                            <button class="repair-dropdown-item" onclick="openRepairCostsModal(${r.id}, '${r.ticket_code}')">⚙️ Insumos y Costos</button>
                            <button class="repair-dropdown-item" onclick="openHistory(${r.id}, '${r.ticket_code}')">📜 Historial</button>
                        </div>
                    </div>
                </div>
            </div>`;
        container.appendChild(card);
    });
}

function statusLabel(status) {
    const map = { PENDIENTE: 'Pendiente', EN_DIAGNOSTICO: 'En Diagnóstico', EN_PROCESO: 'En Proceso', TERMINADO: 'Terminado', ENTREGADO: 'Entregado' };
    return map[status] || status;
}

async function openNewRepairModal() {
    await loadListsForRepairs();
    document.getElementById("new-repair-modal").classList.remove("hidden");
}

async function saveRepair() {
    const customerName = document.getElementById("repair-customer")?.value?.trim();
    const phone = document.getElementById("repair-phone")?.value?.trim() || '';
    const equipment = document.getElementById("repair-equipment")?.value?.trim();
    const brand = document.getElementById("repair-brand")?.value?.trim();
    const fault = document.getElementById("repair-fault")?.value?.trim();
    const total = parseFloat(document.getElementById("repair-total")?.value) || 0;
    const advance = parseFloat(document.getElementById("repair-advance")?.value) || 0;
    const advancePayment = document.getElementById("repair-advance-payment")?.value || "Caja";
    const activeSeller = document.querySelector('input[name="repair-active-seller"]:checked')?.value || 'Anónimo';
    const operator = activeSeller;

    if (!customerName || !equipment || !brand || !fault) {
        showToast("Completa los campos obligatorios (*)", "error");
        return;
    }

    if (advance > total) {
        showToast("El adelanto no puede superar el total", "error");
        return;
    }

    try {
        // Obtener el próximo ID para generar el ticket definitivo de una vez
        const { data: maxRow } = await supabase.from('repairs').select('id').order('id', { ascending: false }).limit(1).single();
        const nextId = (maxRow?.id || 0) + 1;
        const ticketCode = generateSequentialTicket('R', nextId);

        const { data, error } = await supabase
            .from('repairs')
            .insert({
                ticket_code: ticketCode,
                customer_name: customerName,
                customer_phone: phone,
                equipment_type: equipment,
                brand_model: brand,
                fault_description: fault,
                operator_name: operator,
                total_amount: total,
                advance_payment: advance,
                advance_payment_method: advancePayment,
                remaining_balance: total - advance,
                internal_parts_cost: 0,
                internal_external_cost: 0,
                net_profit: total - advance, // FIX BUG-04: El neto inicial no incluye el saldo aún
                status: 'PENDIENTE'
            })
            .select()
            .single();

        if (error) throw error;

        await supabase
            .from('repair_status_history')
            .insert({
                repair_id: data.id,
                status: 'PENDIENTE',
                changed_by: operator,
                notes: 'Registro inicial'
            });

        document.getElementById("new-repair-modal").classList.add("hidden");
        showToast("Reparación registrada");
        await loadAllRepairs();
        renderRepairs();

        ['repair-customer', 'repair-phone', 'repair-equipment', 'repair-brand', 'repair-fault', 'repair-total', 'repair-advance']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    } catch (e) {
        console.error(e);
        showToast("Error al registrar", "error");
    }
}

function openChangeStatus(repairId, ticketCode, currentStatus) {
    currentRepairId = repairId;
    document.getElementById("change-status-ticket").textContent = `Ticket: ${ticketCode}`;
    document.getElementById("new-status-select").value = currentStatus;
    document.getElementById("status-notes").value = '';
    document.getElementById("change-status-modal").classList.remove("hidden");
}

async function confirmChangeStatus() {
    const newStatus = document.getElementById("new-status-select")?.value;
    const notes = document.getElementById("status-notes")?.value?.trim() || '';
    const activeSeller = document.querySelector('input[name="repair-active-seller"]:checked')?.value || 'Anónimo';
    const operator = activeSeller;

    if (!currentRepairId || !newStatus) return;

    try {
        let updateData = { status: newStatus };
        if (newStatus === 'ENTREGADO') {
            updateData.delivered_at = new Date().toISOString();
        }

        let { error } = await supabase.from('repairs').update(updateData).eq('id', currentRepairId);
        if (error && error.message && error.message.toLowerCase().includes('delivered_at')) {
            console.warn('La columna delivered_at no existe en BD, reintentando actualización sin ella.');
            delete updateData.delivered_at;
            const retry = await supabase.from('repairs').update(updateData).eq('id', currentRepairId);
            error = retry.error;
        }

        if (error) throw error;

        await supabase.from('repair_status_history').insert({
            repair_id: currentRepairId, status: newStatus, changed_by: operator, notes: notes
        });

        document.getElementById("change-status-modal").classList.add("hidden");
        showToast("Estado actualizado");
        await loadAllRepairs();
        renderRepairs();
    } catch (e) {
        console.error("Error al actualizar estado:", e);
        showToast("Error al actualizar estado", "error");
    }
}

async function openHistory(repairId, ticketCode) {
    document.getElementById("history-modal-ticket").textContent = `Ticket: ${ticketCode}`;
    const timeline = document.getElementById("history-timeline");
    timeline.innerHTML = '<p class="text-dim">Cargando...</p>';
    document.getElementById("history-modal").classList.remove("hidden");

    try {
        const { data } = await supabase.from('repair_status_history').select('*').eq('repair_id', repairId).order('changed_at', { ascending: true });
        if (!data || data.length === 0) { timeline.innerHTML = '<p class="text-dim">Sin historial</p>'; return; }

        timeline.innerHTML = data.map(h => `
            <div class="timeline-item">
                <div class="timeline-dot"></div>
                <div class="timeline-body">
                    <div class="timeline-status">${statusLabel(h.status)}</div>
                    <div class="timeline-meta">${new Date(h.changed_at).toLocaleString('es-PE')} — ${h.changed_by}</div>
                    ${h.notes ? `<div class="timeline-notes">${h.notes}</div>` : ''}
                </div>
            </div>`).join('');
    } catch (e) {
        timeline.innerHTML = '<p style="color:var(--accent-red)">Error al cargar</p>';
    }
}

window.openChangeStatus = openChangeStatus;
window.openHistory = openHistory;
window.openRepairCostsModal = openRepairCostsModal;

let currentRepairTicket = "";
let availableRepairProducts = [];

function initRepairPartsAutocomplete() {
    const searchInput = document.getElementById("repair-part-search");
    const dropdown = document.getElementById("repair-part-dropdown");
    const hiddenSelect = document.getElementById("repair-part-select");

    if (!searchInput || !dropdown) return;

    if (!searchInput._hasAutocomplete) {
        searchInput._hasAutocomplete = true;

        searchInput.addEventListener("input", (e) => {
            if (hiddenSelect) hiddenSelect.value = "";
            showFilteredOptions(e.target.value);
        });

        searchInput.addEventListener("focus", () => {
            showFilteredOptions(searchInput.value);
        });

        searchInput.addEventListener("click", (e) => {
            e.stopPropagation();
            showFilteredOptions(searchInput.value);
        });

        searchInput.addEventListener("mousedown", (e) => {
            e.stopPropagation();
        });

        dropdown.addEventListener("mousedown", (e) => {
            e.stopPropagation();
        });

        document.addEventListener("mousedown", (e) => {
            if (e.target !== searchInput && !dropdown.contains(e.target)) {
                dropdown.classList.add("hidden");
            }
        });
    }

    function showFilteredOptions(query = "") {
        const q = query.trim().toLowerCase();
        let matches = availableRepairProducts;
        if (q) {
            const terms = q.split(/\s+/);
            matches = availableRepairProducts.filter(p => {
                const text = `${p.name} ${p.code || ''} ${p.category || ''}`.toLowerCase();
                return terms.every(t => text.includes(t));
            });
        }

        // Sin límite para que cargue todos los productos al hacer scroll
        // matches = matches.slice(0, 12);

        if (matches.length === 0) {
            dropdown.innerHTML = `<div style="padding: 0.75rem 1rem; color: var(--text-dim); text-align: center; font-size: 0.85rem;">No se encontraron repuestos con "${query}"</div>`;
        } else {
            dropdown.innerHTML = matches.map(p => `
                <div class="autocomplete-item" data-id="${p.id}">
                    <span class="autocomplete-item-name">
                        <span class="cost-item-badge" style="background:var(--accent-blue); color:#fff; padding: 0.15rem 0.45rem;">Stock: ${p.stock}</span>
                        ${p.name}
                    </span>
                    <span class="autocomplete-item-meta">Costo: ${fmt(p.cost_price || 0)}</span>
                </div>
            `).join('');

            dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = item.dataset.id;
                    const prod = availableRepairProducts.find(x => String(x.id) === String(id));
                    if (prod) {
                        selectRepairPart(prod);
                    }
                });
            });
        }
        dropdown.classList.remove("hidden");
    }
}

function selectRepairPart(prod) {
    const searchInput = document.getElementById("repair-part-search");
    const dropdown = document.getElementById("repair-part-dropdown");
    const hiddenSelect = document.getElementById("repair-part-select");

    if (hiddenSelect && searchInput) {
        hiddenSelect.value = prod.id;
        searchInput.value = `[Stock: ${prod.stock}] ${prod.name} — Costo: ${fmt(prod.cost_price || 0)}`;
    }
    if (dropdown) dropdown.classList.add("hidden");
    const qtyInput = document.getElementById("repair-part-qty");
    if (qtyInput) qtyInput.focus();
}

async function openRepairCostsModal(repairId, ticketCode) {
    currentRepairId = repairId;
    currentRepairTicket = ticketCode;
    document.getElementById("repair-costs-ticket").textContent = `Ticket: ${ticketCode}`;
    document.getElementById("repair-costs-id").value = repairId;
    
    // Cargar repuestos con stock disponible en memoria e inicializar autocomplete
    try {
        const { data: prods } = await supabase.from('products').select('*').gt('stock', 0).order('name');
        availableRepairProducts = prods || [];
        initRepairPartsAutocomplete();
        
        const searchInput = document.getElementById("repair-part-search");
        const hiddenSelect = document.getElementById("repair-part-select");
        if (searchInput) searchInput.value = "";
        if (hiddenSelect) hiddenSelect.value = "";
    } catch (e) { console.error("Error cargando productos:", e); }

    document.getElementById("repair-costs-modal").classList.remove("hidden");
    await loadRepairCostsData(repairId);
}

async function loadRepairCostsData(repairId) {
    try {
        // Consultar orden, repuestos usados y costos externos
        const [{ data: repair }, { data: parts }, { data: external }] = await Promise.all([
            supabase.from('repairs').select('*').eq('id', repairId).single(),
            supabase.from('repair_parts_used').select('*').eq('repair_id', repairId).order('added_at', { ascending: false }),
            supabase.from('repair_external_costs').select('*').eq('repair_id', repairId).order('recorded_at', { ascending: false })
        ]);

        if (!repair) return;

        const totalClient = parseFloat(repair.total_amount || 0);
        const totalPartsCost = (parts || []).reduce((acc, p) => acc + parseFloat(p.total_cost || 0), 0);
        const totalExternalCost = (external || []).reduce((acc, e) => acc + parseFloat(e.cost_amount || 0), 0);
        const netProfit = totalClient - (totalPartsCost + totalExternalCost);

        // Actualizar resumen contable de pantalla
        document.getElementById("cost-summary-client").textContent = fmt(totalClient);
        document.getElementById("cost-summary-parts").textContent = `-${fmt(totalPartsCost)}`;
        document.getElementById("cost-summary-external").textContent = `-${fmt(totalExternalCost)}`;
        
        const profEl = document.getElementById("cost-summary-profit");
        profEl.textContent = fmt(netProfit);
        profEl.style.color = netProfit >= 0 ? "var(--accent-green)" : "var(--accent-red)";

        // Guardar costos calculados en la tabla repairs en segundo plano
        supabase.from('repairs').update({
            internal_parts_cost: totalPartsCost,
            internal_external_cost: totalExternalCost,
            net_profit: netProfit
        }).eq('id', repairId).then();

        // Renderizar tablas
        const partsTbody = document.getElementById("repair-parts-tbody");
        if (partsTbody) {
            partsTbody.innerHTML = (parts && parts.length > 0) ? parts.map(p => `
                <tr>
                    <td class="cost-item-name">${p.product_name}</td>
                    <td><span class="cost-item-badge">×${p.quantity}</span></td>
                    <td class="cost-item-amount">${fmt(p.total_cost)}</td>
                    <td style="text-align:right;">
                        <button onclick="removeRepairPart(${p.id}, ${p.product_id}, ${p.quantity}, ${repairId})" class="cat-arrow-btn" style="color:var(--accent-red);" title="Quitar repuesto">✕</button>
                    </td>
                </tr>
            `).join('') : '<tr><td colspan="4" style="text-align:center; padding:1.5rem; color:var(--text-dim);">Sin repuestos asignados</td></tr>';
        }

        const extTbody = document.getElementById("repair-external-tbody");
        if (extTbody) {
            extTbody.innerHTML = (external && external.length > 0) ? external.map(e => {
                let badge = `<span class="cost-item-badge">💵 ${e.payment_method || 'Caja'}</span>`;
                if (e.payment_method === 'Yape/Plin') badge = `<span class="cost-item-badge" style="border-color:rgba(168,85,247,0.4); color:#a855f7;">📱 Yape/Plin</span>`;
                else if (e.payment_method === 'Transferencia') badge = `<span class="cost-item-badge" style="border-color:rgba(59,130,246,0.4); color:var(--brand-accent);">🏦 Transf.</span>`;
                else if (e.payment_method === 'POS') badge = `<span class="cost-item-badge" style="border-color:rgba(245,158,11,0.4); color:#d97706;">💳 POS</span>`;

                return `
                <tr>
                    <td class="cost-item-name">${e.concept}</td>
                    <td>${badge}</td>
                    <td class="cost-item-amount">${fmt(e.cost_amount)}</td>
                    <td style="text-align:right;">
                        <button onclick="removeExternalCost(${e.id}, ${repairId})" class="cat-arrow-btn" style="color:var(--accent-red);" title="Quitar pago">✕</button>
                    </td>
                </tr>
            `}).join('') : '<tr><td colspan="4" style="text-align:center; padding:1.5rem; color:var(--text-dim);">Sin costos externos</td></tr>';
        }

    } catch (e) { console.error("Error en loadRepairCostsData:", e); }
}

async function addRepairPart() {
    const sel = document.getElementById("repair-part-select");
    const productId = sel?.value;
    const qty = parseInt(document.getElementById("repair-part-qty")?.value) || 0;
    if (!productId || qty <= 0) {
        showToast("Selecciona un repuesto válido y cantidad mayor a 0", "error");
        return;
    }

    try {
        const { data: prod } = await supabase.from('products').select('*').eq('id', productId).single();
        if (!prod || prod.stock < qty) {
            showToast(`Stock insuficiente. Stock actual: ${prod ? prod.stock : 0}`, "error");
            return;
        }

        const activeSeller = document.querySelector('input[name="repair-active-seller"]:checked')?.value || 'Anónimo';
        const operator = activeSeller;
        const costPrice = parseFloat(prod.cost_price || 0);
        const totalCost = costPrice * qty;
        const newStock = prod.stock - qty;

        // 1. Insertar repuesto usado en la reparación
        const { error: insErr } = await supabase.from('repair_parts_used').insert({
            repair_id: currentRepairId,
            product_id: productId,
            product_name: prod.name,
            quantity: qty,
            unit_cost: costPrice,
            total_cost: totalCost
        });
        if (insErr) throw insErr;

        // 2. Descontar stock del almacén INMEDIATAMENTE
        await supabase.from('products').update({ stock: newStock }).eq('id', productId);

        // 3. Registrar en Kardex (stock_audit) con motivo USO_EN_REPARACION
        await supabase.from('stock_audit').insert({
            product_id: productId,
            product_name: prod.name,
            quantity_change: -qty,
            previous_stock: prod.stock,
            new_stock: newStock,
            operator_name: operator,
            movement_type: 'USO_EN_REPARACION',
            reference_id: currentRepairId,
            reference_code: currentRepairTicket,
            notes: `Repuesto en Reparación (Ticket: ${currentRepairTicket})`
        });

        showToast(`Repuesto asignado y stock descontado (Nuevo stock: ${newStock})`);
        document.getElementById("repair-part-qty").value = "1";
        await loadRepairCostsData(currentRepairId);
        await loadAllRepairs();
        renderRepairs();
        // Recargar select por si se agotó
        openRepairCostsModal(currentRepairId, currentRepairTicket);
    } catch (e) {
        console.error("Error agregando repuesto:", e);
        showToast("Error asignando repuesto", "error");
    }
}

async function addExternalCost() {
    const concept = document.getElementById("external-cost-concept")?.value?.trim();
    const amount = parseFloat(document.getElementById("external-cost-amount")?.value) || 0;
    const payment = document.getElementById("external-cost-payment")?.value || "Caja";

    if (!concept || amount <= 0) {
        showToast("Ingresa un concepto descriptivo y un monto mayor a 0", "error");
        return;
    }

    try {
        const { error } = await supabase.from('repair_external_costs').insert({
            repair_id: currentRepairId,
            concept: concept,
            cost_amount: amount,
            payment_method: payment
        });
        if (error) throw error;

        showToast("Gasto a tercero registrado");
        document.getElementById("external-cost-concept").value = "";
        document.getElementById("external-cost-amount").value = "";
        await loadRepairCostsData(currentRepairId);
        await loadAllRepairs();
        renderRepairs();
    } catch (e) {
        console.error("Error agregando costo externo:", e);
        showToast("Error registrando gasto", "error");
    }
}


// Función de utilidad para eliminar todas las reparaciones (disponible por consola y en ajustes)
window.borrarTodasLasReparaciones = async function() {
    if (!confirm("⚠️ ¿Estás seguro de que deseas ELIMINAR TODOS los datos de la tabla 'repairs' y su historial en Supabase? Esta acción es definitiva.")) return;
    try {
        await supabase.from('repair_parts_used').delete().neq('id', 0);
        await supabase.from('repair_external_costs').delete().neq('id', 0);
        await supabase.from('repair_status_history').delete().neq('id', 0);
        const { error } = await supabase.from('repairs').delete().neq('id', 0);
        if (error) throw error;
        showToast("✅ Todas las reparaciones han sido eliminadas exitosamente.");
        setTimeout(() => location.reload(), 1500);
    } catch (e) {
        console.error("Error al borrar reparaciones:", e);
        showToast("❌ Error al borrar reparaciones: " + (e.message || "Verifica permisos RLS"), "error");
    }
};

window.removeRepairPart = async function(id, productId, quantity, repairId) {
    if (!confirm("¿Quitar repuesto de esta reparación? El stock volverá al inventario.")) return;
    try {
        const { error } = await supabase.from('repair_parts_used').delete().eq('id', id);
        if (error) throw error;

        // Recuperar información del producto actual para el kardex
        const { data: prod } = await supabase.from('products').select('name, stock').eq('id', productId).single();
        if (prod) {
            const newStock = (prod.stock || 0) + quantity;
            
            // Devolver al inventario
            await supabase.from('products').update({ stock: newStock }).eq('id', productId);
            
            // Registrar en auditoría
            const operator = document.getElementById("sale-seller-juan")?.checked ? "Juan" : 
                            (document.getElementById("sale-seller-junior")?.checked ? "Junior" : "Invitado");
            
            await supabase.from('stock_audit').insert({
                product_id: productId,
                product_name: prod.name,
                quantity_change: quantity,
                previous_stock: prod.stock,
                new_stock: newStock,
                operator_name: operator,
                movement_type: 'DEVOLUCION_TALLER',
                reference_id: repairId,
                notes: `Devolución por retiro de repuesto en reparación`
            });
        }

        showToast("Repuesto retirado y stock devuelto", "success");
        await loadRepairCostsData(repairId);
        await loadAllRepairs();
        renderRepairs();
        initRepairPartsAutocomplete(); // Refresh dropdown info
    } catch (e) {
        console.error("Error al quitar repuesto:", e);
        showToast("Error al quitar repuesto", "error");
    }
};

window.removeExternalCost = async function(id, repairId) {
    if (!confirm("¿Quitar este gasto a tercero?")) return;
    try {
        const { error } = await supabase.from('repair_external_costs').delete().eq('id', id);
        if (error) throw error;
        
        showToast("Gasto eliminado", "success");
        await loadRepairCostsData(repairId);
        await loadAllRepairs();
        renderRepairs();
    } catch (e) {
        console.error("Error al quitar gasto:", e);
        showToast("Error al quitar gasto", "error");
    }
};

window.toggleDropdown = function(event, btn) {
    event.stopPropagation();
    const menu = btn.nextElementSibling;
    const isHidden = menu.classList.contains('hidden');
    
    // Ocultar todos los demas primero
    document.querySelectorAll('.repair-dropdown-menu').forEach(m => m.classList.add('hidden'));
    
    if (isHidden) {
        menu.classList.remove('hidden');
    }
};

// Cerrar al hacer clic en otro lugar
document.addEventListener('click', function(e) {
    if (!e.target.closest('.repair-dropdown')) {
        document.querySelectorAll('.repair-dropdown-menu').forEach(m => m.classList.add('hidden'));
    }
});