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
                    <div class="repair-customer">${r.customer_name}</div>
                    <div class="repair-phone">${r.customer_phone || '—'}</div>
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
    const session = getSession();
    const operator = session?.profile?.username || session?.user?.email?.split('@')[0] || 'Sistema';

    if (!customerName || !equipment || !brand || !fault) {
        showToast("Completa los campos obligatorios (*)", "error");
        return;
    }

    // Generar ticket_code
    const ticketCode = 'r-' + Math.random().toString(36).substring(2, 6) + '-' + Math.random().toString(36).substring(2, 6);

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
                remaining_balance: total - advance,
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