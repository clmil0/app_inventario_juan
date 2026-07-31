import { API, getHeaders, fmt, showToast } from './utils.js';

let allRepairs = [], currentRepairId = null, currentStatusFilter = "all", equipmentTypes = [], brandModels = [];

export async function loadRepairs() {
    await loadListsForRepairs();
    try { const res = await fetch(`${API}/repairs`); allRepairs = await res.json(); renderRepairs(); } catch (e) { }
}

export function bindRepairEvents() {
    document.getElementById("new-repair-btn").addEventListener("click", () => document.getElementById("new-repair-modal").classList.remove("hidden"));
    document.getElementById("cancel-repair-btn").addEventListener("click", () => { document.getElementById("new-repair-modal").classList.add("hidden"); clearRepairForm(); });
    document.getElementById("save-repair-btn").addEventListener("click", saveRepair);
    document.getElementById("repair-global-search")?.addEventListener("input", () => renderRepairs());
    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentStatusFilter = btn.dataset.status;
            renderRepairs();
        });
    });
    document.getElementById("cancel-status-btn").addEventListener("click", () => document.getElementById("change-status-modal").classList.add("hidden"));
    document.getElementById("confirm-status-btn").addEventListener("click", confirmStatusChange);
    document.getElementById("close-history-modal").addEventListener("click", () => document.getElementById("history-modal").classList.add("hidden"));
    document.getElementById("close-repair-receipt-modal")?.addEventListener("click", () => document.getElementById("repair-receipt-modal").classList.add("hidden"));
}

async function loadListsForRepairs() {
    try {
        const [eqRes, brRes] = await Promise.all([fetch(`${API}/equipment-types`), fetch(`${API}/brand-models`)]);
        if (eqRes.ok) equipmentTypes = await eqRes.json();
        if (brRes.ok) brandModels = await brRes.json();
        populateDatalists();
    } catch (e) { }
}

function populateDatalists() {
    const eqDatalist = document.getElementById("equipment-list"); if (eqDatalist) { eqDatalist.innerHTML = ''; equipmentTypes.forEach(item => { const opt = document.createElement('option'); opt.value = item.name; eqDatalist.appendChild(opt); }); }
    const brDatalist = document.getElementById("brand-list"); if (brDatalist) { brDatalist.innerHTML = ''; brandModels.forEach(item => { const opt = document.createElement('option'); opt.value = item.name; brDatalist.appendChild(opt); }); }
}

function renderRepairs() {
    const container = document.getElementById("repairs-list"); container.innerHTML = "";
    const searchQ = (document.getElementById("repair-global-search")?.value || "").toLowerCase().trim();
    const filtered = allRepairs.filter(r => {
        if (currentStatusFilter !== "all" && r.status !== currentStatusFilter) return false;
        if (searchQ) {
            const s = `${r.customer_name} ${r.equipment_type} ${r.brand_model} ${r.fault_description} ${r.customer_phone} ${r.ticket_code} ${r.operator_name}`.toLowerCase();
            return s.includes(searchQ);
        }
        return true;
    });
    if (filtered.length === 0) { container.innerHTML = `<p class="text-dim" style="text-align:center;padding:2rem">No hay reparaciones</p>`; return; }
    filtered.forEach(r => {
        const card = document.createElement("div"); card.className = "repair-card";
        const isTerminado = r.status === "TERMINADO" || r.status === "ENTREGADO";
        card.innerHTML = `
            <div class="repair-card-header">
                <div>
                    <div class="repair-ticket">${r.ticket_code}</div>
                    <div class="repair-customer">${r.customer_name}</div>
                    <div class="repair-phone">📞 ${r.customer_phone || "—"}</div>
                </div>
                <span class="status-badge status-${r.status}">${statusLabel(r.status)}</span>
            </div>
            <div class="repair-details">
                <div class="repair-detail-item"><div class="repair-detail-label">Equipo</div><div class="repair-detail-value">${r.equipment_type}</div></div>
                <div class="repair-detail-item"><div class="repair-detail-label">Marca / Modelo</div><div class="repair-detail-value">${r.brand_model}</div></div>
                <div class="repair-detail-item"><div class="repair-detail-label">Falla</div><div class="repair-detail-value">${r.fault_description}</div></div>
                <div class="repair-detail-item"><div class="repair-detail-label">Ingresado</div><div class="repair-detail-value">${r.created_at}</div></div>
                <div class="repair-detail-item"><div class="repair-detail-label">Técnico</div><div class="repair-detail-value">${r.operator_name}</div></div>
            </div>
            <div class="repair-card-footer">
                <div class="repair-amounts">
                    <div class="repair-amount"><div class="repair-amount-label">Total</div><div class="repair-amount-value">${fmt(r.total_amount)}</div></div>
                    <div class="repair-amount"><div class="repair-amount-label">Adelanto</div><div class="repair-amount-value amount-paid">${fmt(r.advance_payment)}</div></div>
                    <div class="repair-amount"><div class="repair-amount-label">Saldo</div><div class="repair-amount-value amount-pending">${fmt(r.remaining_balance)}</div></div>
                </div>
                <div class="repair-actions">
                    <button class="btn-outline btn-sm" onclick="openHistory(${r.id})">📋 Historial</button>
                    <button type="button" onclick="showReceiptModal('${API}/receipts/repair/${r.id}/png')" class="btn-outline btn-sm">🧾 Recibo</button>
                    ${r.status !== "ENTREGADO" ? `<button class="btn-primary btn-sm" onclick="openChangeStatus(${r.id}, '${r.status}', '${r.ticket_code}')">Cambiar Estado</button>` : ""}
                    ${isTerminado ? `<button type="button" onclick="showReceiptModal('${API}/receipts/repair/${r.id}/boleta-final/png')" class="btn-green btn-sm">📥 Boleta Final</button>` : ""}
                </div>
            </div>`;
        container.appendChild(card);
    });
}

function statusLabel(s) {
    const map = { PENDIENTE: "Pendiente", EN_DIAGNOSTICO: "Diagnóstico", EN_PROCESO: "En Proceso", TERMINADO: "Terminado", ENTREGADO: "Entregado" };
    return map[s] || s;
}

function openChangeStatus(repairId, currentStatus, ticketCode) {
    currentRepairId = repairId;
    document.getElementById("change-status-ticket").textContent = `Ticket: ${ticketCode} — Estado actual: ${statusLabel(currentStatus)}`;
    document.getElementById("new-status-select").value = currentStatus;
    document.getElementById("status-notes").value = "";
    document.getElementById("change-status-modal").classList.remove("hidden");
}

async function confirmStatusChange() {
    const newStatus = document.getElementById("new-status-select").value;
    const notes = document.getElementById("status-notes").value.trim();
    try {
        const res = await fetch(`${API}/repairs/${currentRepairId}/status`, { method: "PUT", headers: getHeaders(), body: JSON.stringify({ new_status: newStatus, notes }) });
        if (!res.ok) { const err = await res.json(); showToast(err.detail || "Error", "error"); return; }
        document.getElementById("change-status-modal").classList.add("hidden");
        showToast(`Estado actualizado a ${statusLabel(newStatus)}`);
        await loadRepairs();
    } catch { showToast("Error de conexión", "error"); }
}

function openHistory(repairId) {
    const repair = allRepairs.find(r => r.id === repairId);
    if (!repair) return;
    document.getElementById("history-modal-ticket").textContent = `${repair.ticket_code} — ${repair.customer_name} — ${repair.equipment_type}`;
    const timeline = document.getElementById("history-timeline");
    timeline.innerHTML = "";
    if (!repair.status_history || repair.status_history.length === 0) {
        timeline.innerHTML = `<p class="text-dim">Sin historial registrado</p>`;
    } else {
        repair.status_history.forEach(h => {
            const item = document.createElement("div"); item.className = "timeline-item";
            item.innerHTML = `<div class="timeline-dot"></div><div class="timeline-body"><div class="timeline-status">${h.previous_status ? `<span class="text-dim">${statusLabel(h.previous_status)} →</span> ` : ""}<span class="status-badge status-${h.new_status}">${statusLabel(h.new_status)}</span></div><div class="timeline-meta">📅 ${h.changed_at} &nbsp;·&nbsp; 👤 ${h.changed_by}</div>${h.notes ? `<div class="timeline-notes">💬 ${h.notes}</div>` : ""}</div>`;
            timeline.appendChild(item);
        });
    }
    document.getElementById("history-modal").classList.remove("hidden");
}

async function saveRepair() {
    const payload = {
        customer_name: document.getElementById("repair-customer").value.trim(),
        customer_phone: document.getElementById("repair-phone").value.trim(),
        equipment_type: document.getElementById("repair-equipment").value.trim(),
        brand_model: document.getElementById("repair-brand").value.trim(),
        fault_description: document.getElementById("repair-fault").value.trim(),
        total_amount: parseFloat(document.getElementById("repair-total").value) || 0,
        advance_payment: parseFloat(document.getElementById("repair-advance").value) || 0,
    };
    if (!payload.customer_name || !payload.equipment_type || !payload.brand_model || !payload.fault_description) {
        showToast("Completa los campos obligatorios (*)", "error"); return;
    }
    try {
        const res = await fetch(`${API}/repairs`, { method: "POST", headers: getHeaders(), body: JSON.stringify(payload) });
        if (!res.ok) { const err = await res.json(); showToast(err.detail || "Error", "error"); return; }
        const repair = await res.json();
        document.getElementById("new-repair-modal").classList.add("hidden");
        clearRepairForm();
        window.showReceiptModal(`${API}/receipts/repair/${repair.id}/png`);
        await loadRepairs();
    } catch { showToast("Error de conexión", "error"); }
}

function clearRepairForm() {
    ["repair-customer", "repair-phone", "repair-equipment", "repair-brand", "repair-fault", "repair-total", "repair-advance"].forEach(id => document.getElementById(id).value = "");
}

// Exponer globales para onclick
window.openChangeStatus = openChangeStatus;
window.openHistory = openHistory;