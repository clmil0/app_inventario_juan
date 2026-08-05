import { supabase, getSession, fmt, showToast } from './supabase.js';

let allRepairs = [];
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

async function loadAllRepairs() {
    try {
        const { data } = await supabase.from('repairs').select('*').order('created_at', { ascending: false });
        allRepairs = data || [];
    } catch (e) { console.error(e); }
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
                <div>
                    <div class="repair-ticket">${r.ticket_code} <span class="days-left" title="Tiempo en taller / desde ingreso">⏱️ ${timeTag}</span></div>
                    <div class="repair-customer" style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
                        <span>${r.customer_name}</span>
                        ${r.customer_phone ? `<span class="repair-phone" style="margin: 0; font-size: 0.85rem; color: var(--text-dim); font-weight: 500;">Cel: ${r.customer_phone}</span>` : ''}
                    </div>
                </div>
                <span class="status-badge status-${r.status}">${statusLabel(r.status)}</span>
            </div>
            <div class="repair-details">
                <div class="repair-detail-item"><div class="repair-detail-label">Equipo</div><div class="repair-detail-value">${r.equipment_type}</div></div>
                <div class="repair-detail-item"><div class="repair-detail-label">Marca/Modelo</div><div class="repair-detail-value">${r.brand_model}</div></div>
                <div class="repair-detail-item"><div class="repair-detail-label">Falla</div><div class="repair-detail-value">${r.fault_description}</div></div>
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
                <div class="repair-actions">
                    <button class="btn-outline btn-sm" style="border-color:#fbbf24; color:#fbbf24; font-weight:600;" onclick="openRepairCostsModal(${r.id}, '${r.ticket_code}')">⚙️ Insumos y Costos</button>
                    <button class="btn-outline btn-sm" onclick="openChangeStatus(${r.id}, '${r.ticket_code}', '${r.status}')">Cambiar Estado</button>
                    <button class="btn-outline btn-sm" onclick="openHistory(${r.id}, '${r.ticket_code}')">Historial</button>
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
    const session = getSession();
    const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';

    if (!customerName || !equipment || !brand || !fault) {
        showToast("Completa los campos obligatorios (*)", "error");
        return;
    }

    // Generar ticket_code en formato profesional (Ej: REP-260802-4912) similar al de ventas
    const now = new Date();
    const datePart = now.getFullYear().toString().slice(-2) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const ticketCode = `REP-${datePart}-${randomPart}`;

    try {
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
                net_profit: total,
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
    const session = getSession();
    const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';

    if (!currentRepairId || !newStatus) return;

    try {
        const { error } = await supabase.from('repairs').update({ status: newStatus }).eq('id', currentRepairId);
        if (error) throw error;

        await supabase.from('repair_status_history').insert({
            repair_id: currentRepairId, status: newStatus, changed_by: operator, notes: notes
        });

        document.getElementById("change-status-modal").classList.add("hidden");
        showToast("Estado actualizado");
        await loadAllRepairs();
        renderRepairs();
    } catch (e) {
        showToast("Error al actualizar", "error");
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

async function openRepairCostsModal(repairId, ticketCode) {
    currentRepairId = repairId;
    currentRepairTicket = ticketCode;
    document.getElementById("repair-costs-ticket").textContent = `Ticket: ${ticketCode}`;
    document.getElementById("repair-costs-id").value = repairId;
    
    // Cargar repuestos con stock disponible en el select
    try {
        const { data: prods } = await supabase.from('products').select('*').gt('stock', 0).order('name');
        const sel = document.getElementById("repair-part-select");
        if (sel) {
            sel.innerHTML = '<option value="">-- Seleccionar repuesto de tienda --</option>' + 
                (prods || []).map(p => `<option value="${p.id}" data-cost="${p.cost_price || 0}" data-name="${p.name}">[Stock: ${p.stock}] ${p.name} — Costo: ${fmt(p.cost_price || 0)}</option>`).join('');
        }
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
                <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                    <td style="padding:6px 0; font-weight:600;">${p.product_name}</td>
                    <td>×${p.quantity}</td>
                    <td style="color:var(--accent-red); font-weight:700;">${fmt(p.total_cost)}</td>
                    <td style="text-align:right;"><span style="font-size:0.7rem; color:var(--text-dim);">Usado</span></td>
                </tr>
            `).join('') : '<tr><td colspan="4" style="text-align:center; padding:1.5rem; color:var(--text-dim);">Sin repuestos asignados</td></tr>';
        }

        const extTbody = document.getElementById("repair-external-tbody");
        if (extTbody) {
            extTbody.innerHTML = (external && external.length > 0) ? external.map(e => {
                let badge = `<span style="background:rgba(255,255,255,0.1); padding:1px 5px; border-radius:4px; font-size:0.75rem;">💵 ${e.payment_method || 'Caja'}</span>`;
                if (e.payment_method === 'Yape/Plin') badge = `<span style="background:rgba(128,0,128,0.2); color:#e17dfd; padding:1px 5px; border-radius:4px; font-size:0.75rem;">📱 Yape/Plin</span>`;
                else if (e.payment_method === 'Transferencia') badge = `<span style="background:rgba(59,130,246,0.2); color:#60a5fa; padding:1px 5px; border-radius:4px; font-size:0.75rem;">🏦 Transf.</span>`;
                else if (e.payment_method === 'POS') badge = `<span style="background:rgba(245,158,11,0.2); color:#fbbf24; padding:1px 5px; border-radius:4px; font-size:0.75rem;">💳 POS</span>`;

                return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                    <td style="padding:6px 0; font-weight:600;">${e.concept}</td>
                    <td>${badge}</td>
                    <td style="color:var(--accent-red); font-weight:700;">${fmt(e.cost_amount)}</td>
                    <td style="text-align:right;"><span style="font-size:0.7rem; color:var(--text-dim);">Registrado</span></td>
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

        const session = getSession();
        const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';
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