import { supabase, getSession, fmt, showToast, generateSequentialTicket } from './supabase.js';

let allRepairs = [];
let repairsPage = 0;
const REPAIRS_PER_PAGE = 5; /* Bajado a 5 para que el botón de cargar más aparezca más fácil */
let currentRepairId = null;
let currentStatusFilter = 'all';
let equipmentTypes = [];
let brandModels = [];
let commonFaults = [];

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
    document.getElementById("add-repair-item-btn")?.addEventListener("click", addRepairItemBlock);
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
        const [{ data: eq }, { data: br }, { data: faults }] = await Promise.all([
            supabase.from('equipment_types').select('*').order('name'),
            supabase.from('brand_models').select('*').order('name'),
            supabase.from('common_faults').select('*').order('name')
        ]);
        equipmentTypes = eq || [];
        brandModels = br || [];
        commonFaults = faults || [];
        populateDatalists();
    } catch (e) { console.error(e); }
}

function populateDatalists() {
    const eqList = document.getElementById("equipment-list");
    const brList = document.getElementById("brand-list");
    const faultList = document.getElementById("faults-list");
    const prodList = document.getElementById("all-products-list");
    
    if (eqList) eqList.innerHTML = equipmentTypes.map(e => `<option value="${e.name}">`).join('');
    if (brList) brList.innerHTML = brandModels.map(b => `<option value="${b.name}">`).join('');
    if (faultList && typeof commonFaults !== 'undefined') {
        faultList.innerHTML = commonFaults.map(f => `<option value="${f.name}">`).join('');
    }
    if (prodList && typeof allProducts !== 'undefined') {
        prodList.innerHTML = allProducts.map(p => `<option value="${p.name}">`).join('');
    }
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
                // Ya no necesitamos ventas optimistas por el Realtime
                allRepairs = data;
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
            const searchStr = `${r.customer_name} ${r.equipment_type} ${r.brand_model} ${r.fault_description} ${r.customer_phone} ${r.operator_name} ${r.ticket_code} ${r.group_ticket}`.toLowerCase();
            if (!searchStr.includes(searchQ)) return false;
        }
        return true;
    });

    container.innerHTML = '';
    if (filtered.length === 0) {
        container.innerHTML = '<p class="text-dim" style="text-align:center;padding:2rem;">No hay reparaciones</p>';
        return;
    }

    // Agrupar por group_ticket (o ticket_code si es null)
    const grouped = {};
    filtered.forEach(r => {
        const gt = r.group_ticket || r.ticket_code;
        if (!grouped[gt]) grouped[gt] = [];
        grouped[gt].push(r);
    });

    // Convertir a array y ordenar por el created_at del primer elemento
    const groupedArray = Object.values(grouped).sort((a, b) => {
        return new Date(b[0].created_at || 0) - new Date(a[0].created_at || 0);
    });

    groupedArray.forEach(group => {
        const first = group[0];
        const groupTicket = first.group_ticket || first.ticket_code;
        const createdDate = new Date(first.created_at);
        
        let globalTotal = 0, globalAdvance = 0, globalRemaining = 0;
        let isAllDelivered = true, isAllFinished = true, hasPendings = false;

        let globalExpense = 0, globalProfit = 0;
        group.forEach(r => {
            globalTotal += parseFloat(r.total_amount || 0);
            globalAdvance += parseFloat(r.advance_payment || 0);
            globalRemaining += parseFloat(r.remaining_balance || 0);
            globalExpense += parseFloat(r.internal_parts_cost || 0) + parseFloat(r.internal_external_cost || 0);
            globalProfit += parseFloat(r.net_profit || 0);
            if (r.status !== 'ENTREGADO') isAllDelivered = false;
            if (r.status !== 'TERMINADO' && r.status !== 'ENTREGADO') isAllFinished = false;
            if (['PENDIENTE', 'EN_DIAGNOSTICO', 'EN_PROCESO'].includes(r.status)) hasPendings = true;
        });

        let globalStatus = 'INCOMPLETO';
        let statusClass = 'pendiente';
        if (isAllDelivered) { globalStatus = 'ENTREGADO'; statusClass = 'entregado'; }
        else if (isAllFinished) { globalStatus = 'TERMINADO'; statusClass = 'terminado'; }
        else if (hasPendings) { globalStatus = 'EN PROCESO'; statusClass = 'en_proceso'; }

        const card = document.createElement("div");
        card.className = `repair-card repair-group-card card-${statusClass}`;
        
        // Cabecera Global
        let html = `
            <div class="repair-card-header group-header">
                <div style="flex: 1; min-width: 0;">
                    <div style="display:flex; align-items:center; gap: 0.5rem; flex-wrap:wrap;">
                        <span class="repair-ticket" style="font-size: 0.9rem; font-weight: 800; background: rgba(56,189,248,0.15); color: var(--accent-blue); padding: 0.2rem 0.6rem; border-radius: 6px;">TICKET: ${groupTicket}</span>
                        <span class="days-left" style="font-size: 0.75rem; background: var(--glass-bg); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--glass-border);">📅 ${createdDate.toLocaleDateString('es-PE')}</span>
                    </div>
                    <div class="repair-customer" style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.6rem; font-size: 1.15rem;">
                        <span>👤 ${first.customer_name}</span>
                        ${first.customer_phone ? `<span class="repair-phone" style="margin: 0; font-size: 0.9rem; color: var(--text-dim); font-weight: 500;">📱 Cel: ${first.customer_phone}</span>` : ''}
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.4rem;">
                    <span class="status-badge status-${statusClass.toUpperCase()}">${globalStatus}</span>
                    <span style="font-size: 0.8rem; color: var(--text-dim); font-weight: 600;">👨‍🔧 ${first.operator_name}</span>
                    <button class="btn-outline btn-sm" onclick="printGroupReceipt('${groupTicket}')" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; border-radius: 6px; display: flex; align-items: center; gap: 4px;">🖨️ Imprimir</button>
                </div>
            </div>
        `;
        // Inicio Sub tarjetas
        html += `<div class="sub-cards-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.75rem; margin-top: 1rem;">`;

        group.forEach((r, idx) => {
            const daysDiff = Math.floor((new Date() - new Date(r.created_at)) / (1000 * 60 * 60 * 24));
            const timeTag = daysDiff === 0 ? 'Hoy' : daysDiff === 1 ? 'Hace 1 d' : `Hace ${daysDiff} d`;
            
            html += `
                <div class="repair-sub-card glass" style="border-radius: 12px; padding: 0.75rem; display: flex; flex-direction: column; justify-content: space-between; position: relative;">
                    <div style="position: absolute; top: 0.75rem; right: 0.75rem;">
                        <span class="status-badge status-${r.status}" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">${statusLabel(r.status)}</span>
                    </div>
                    <div style="margin-bottom: 0.5rem; padding-right: 70px;">
                        <div style="font-size: 0.7rem; color: var(--text-dim); font-family: monospace; margin-bottom: 0.2rem;">ID: ${r.ticket_code}</div>
                        <div style="font-weight: 700; font-size: 0.95rem; line-height: 1.2; margin-bottom: 0.25rem;">${r.equipment_type} ${r.brand_model}</div>
                        <div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.3;">Falla: ${r.fault_description}</div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--glass-border); padding-top: 0.5rem; margin-top: auto;">
                        <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary);">Costo: ${fmt(r.total_amount)}</div>
                        <div style="display: flex; gap: 0.3rem;">
                            <button class="btn-outline" onclick="openChangeStatus(${r.id}, '${r.ticket_code}', '${r.status}')" title="Cambiar Estado" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 6px;">🔄</button>
                            <button class="btn-outline" onclick="openRepairCostsModal(${r.id}, '${r.ticket_code}')" title="Insumos" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 6px;">⚙️</button>
                            <button class="btn-outline" onclick="openHistory(${r.id}, '${r.ticket_code}')" title="Historial" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 6px;">📜</button>
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div>`; // End sub-cards-grid
        
        html += `
            <div class="repair-card-footer" style="padding: 0.6rem 0; border-top: 1px dashed var(--glass-border); margin-top: 0.75rem; background: rgba(0,0,0,0.05); border-radius: 8px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem;">
                <div style="display: flex; flex: 1; justify-content: space-around; min-width: 250px;">
                    <div class="repair-amount" style="text-align: center;"><div class="repair-amount-label">Costo Total</div><div class="repair-amount-value" style="font-size: 1.1rem;">${fmt(globalTotal)}</div></div>
                    <div class="repair-amount" style="text-align: center;"><div class="repair-amount-label">Adelanto</div><div class="repair-amount-value amount-paid" style="font-size: 1.1rem;">${fmt(globalAdvance)}</div></div>
                    <div class="repair-amount" style="text-align: center;"><div class="repair-amount-label">Saldo</div><div class="repair-amount-value amount-pending" style="font-size: 1.1rem;">${fmt(globalRemaining)}</div></div>
                </div>
                <div class="hidden-mobile" style="color: var(--glass-border); font-size: 1.5rem; font-weight: 300;">|</div>
                <div style="display: flex; flex: 1; justify-content: space-around; min-width: 200px;">
                    <div class="repair-amount" style="text-align: center;"><div class="repair-amount-label" title="Insumos y 3ros">Gasto</div><div class="repair-amount-value" style="font-size: 1.1rem; color: var(--accent-red);">${fmt(globalExpense)}</div></div>
                    <div class="repair-amount" style="text-align: center;"><div class="repair-amount-label">Ganancia</div><div class="repair-amount-value" style="font-size: 1.1rem; color: var(--accent-green);">${fmt(globalProfit)}</div></div>
                </div>
            </div>
        `;

        card.innerHTML = html;
        container.appendChild(card);
    });
}

function statusLabel(status) {
    const map = { PENDIENTE: 'Pendiente', EN_DIAGNOSTICO: 'En Diagnóstico', EN_PROCESO: 'En Proceso', TERMINADO: 'Terminado', ENTREGADO: 'Entregado' };
    return map[status] || status;
}

let repairItemCount = 0;
window.tempRepairData = {}; // Global state for temporary parts and costs per equipment

window.addRepairItemBlock = function() {
    repairItemCount++;
    const container = document.getElementById("repair-items-container");
    
    // Collapse previous items
    const allItems = container.querySelectorAll('.repair-item-block');
    allItems.forEach(item => {
        item.querySelector('.repair-item-body').classList.add('hidden');
        item.querySelector('.toggle-icon').textContent = '▼';
    });

    const block = document.createElement("div");
    block.className = "repair-item-block";
    block.dataset.index = repairItemCount;
    block.style.cssText = "background: rgba(0,0,0,0.1); border: 1px solid var(--glass-border); border-radius: 8px; overflow: hidden;";
    
    window.tempRepairData[repairItemCount] = { parts: [], costs: [] };
    
    block.innerHTML = `
        <div class="repair-item-header" style="padding: 0.75rem 1rem; background: rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
            <div style="font-weight: 600; font-size: 0.95rem;">Equipo #${repairItemCount} <span class="eq-title-preview" style="color: var(--text-dim); font-weight: 400; margin-left: 0.5rem;"></span></div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
                ${repairItemCount > 1 ? `<button type="button" class="btn-danger btn-sm remove-item-btn" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; border-radius: 4px;">✕</button>` : ''}
                <span class="toggle-icon">▲</span>
            </div>
        </div>
        <div class="repair-item-body" style="padding: 1rem;">
            <!-- Fila 1 -->
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                <div class="form-group" style="margin-bottom:0;"><label>Tipo de Equipo *</label><input type="text" class="item-eq" placeholder="Ej: Laptop" list="equipment-list" autocomplete="off"></div>
                <div class="form-group" style="margin-bottom:0;"><label>Marca / Modelo *</label><input type="text" class="item-brand" placeholder="Ej: HP 14" list="brand-list" autocomplete="off"></div>
                <div class="form-group" style="margin-bottom:0;"><label>Costo Total Estimado (S/) *</label><input type="number" class="item-total" placeholder="0.00" min="0" step="0.50"></div>
            </div>
            
            <!-- Fila 2 -->
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                <div class="form-group" style="margin-bottom:0;"><label>Descripción de la Falla *</label><input type="text" class="item-fault" placeholder="Describe el problema..." list="faults-list" autocomplete="off"></div>
                <div class="form-group" style="margin-bottom:0; display:flex; align-items:flex-end;">
                    <button type="button" class="btn-outline toggle-inline-costs-btn" style="width: 100%; border: 1px dashed var(--glass-border); padding: 0.75rem; color: var(--text-primary); font-weight: 600;">📦 Insumos / Gastos (Opcional)</button>
                </div>
            </div>
            
            <!-- Fila 3 (Avanzada Colapsable) -->
            <div class="inline-advanced-costs hidden" style="background: rgba(0,0,0,0.1); border: 1px solid var(--glass-border); border-radius: 8px; padding: 1rem;">
                <div class="costs-panels-grid" style="grid-template-columns: 1fr 1fr;">
                    <div class="cost-panel-card">
                        <h3 class="cost-panel-title parts">📦 Repuestos y Piezas</h3>
                        <div style="position: relative; margin-bottom: 0.75rem;">
                            <div class="cost-form-row" style="display: flex; gap: 0.5rem; margin-bottom: 0;">
                                <input type="hidden" class="inline-part-select" value="">
                                <input type="text" class="inline-part-search cost-form-input" placeholder="🔍 Buscar repuesto..." autocomplete="off" style="flex:1;">
                                <input type="number" class="inline-part-qty cost-form-input" placeholder="Cant." value="1" min="1" style="width: 70px;">
                                <button type="button" class="btn-primary add-inline-part-btn" style="background: linear-gradient(135deg, #f59e0b, #d97706); border: none; font-weight: 700; padding: 0.5rem 1rem;">Asignar</button>
                            </div>
                            <div class="inline-part-dropdown cost-autocomplete-dropdown hidden"></div>
                        </div>
                        <table class="cost-table" style="margin-top: 1rem;">
                            <thead><tr><th>Repuesto</th><th>Cant</th><th>Costo</th><th></th></tr></thead>
                            <tbody class="inline-parts-tbody"></tbody>
                        </table>
                    </div>
                    
                    <div class="cost-panel-card">
                        <h3 class="cost-panel-title external">🛠️ Pagos a Terceros</h3>
                        <div class="cost-form-row" style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem;">
                            <input type="text" class="inline-cost-concept cost-form-input" placeholder="Concepto..." style="flex: 1;">
                            <input type="number" class="inline-cost-amount cost-form-input" placeholder="S/ Costo" min="0" step="1" style="width: 90px;">
                            <button type="button" class="btn-primary add-inline-cost-btn" style="background: var(--brand-gradient); border: none; font-weight: 700; padding: 0.5rem 1rem;">Registrar</button>
                        </div>
                        <table class="cost-table" style="margin-top: 1rem;">
                            <thead><tr><th>Concepto</th><th>Costo</th><th></th></tr></thead>
                            <tbody class="inline-costs-tbody"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Toggle logic
    block.querySelector('.repair-item-header').addEventListener('click', (e) => {
        if (e.target.closest('.remove-item-btn')) return;
        const body = block.querySelector('.repair-item-body');
        const icon = block.querySelector('.toggle-icon');
        if (body.classList.contains('hidden')) {
            body.classList.remove('hidden');
            icon.textContent = '▲';
        } else {
            body.classList.add('hidden');
            icon.textContent = '▼';
        }
    });

    // Remove logic
    if (repairItemCount > 1) {
        block.querySelector('.remove-item-btn').addEventListener('click', () => {
            block.remove();
            delete window.tempRepairData[block.dataset.index];
        });
    }

    // Live preview
    const updatePreview = () => {
        const eq = block.querySelector('.item-eq').value;
        const br = block.querySelector('.item-brand').value;
        block.querySelector('.eq-title-preview').textContent = eq || br ? `- ${eq} ${br}` : '';
    };
    block.querySelector('.item-eq').addEventListener('input', updatePreview);
    block.querySelector('.item-brand').addEventListener('input', updatePreview);

    // Advanced inline costs toggle
    block.querySelector('.toggle-inline-costs-btn').addEventListener('click', () => {
        const adv = block.querySelector('.inline-advanced-costs');
        if (adv.classList.contains('hidden')) {
            adv.classList.remove('hidden');
        } else {
            adv.classList.add('hidden');
        }
    });

    // Autocomplete for this block
    const searchInput = block.querySelector('.inline-part-search');
    const dropdown = block.querySelector('.inline-part-dropdown');
    const selectHidden = block.querySelector('.inline-part-select');
    const qtyInput = block.querySelector('.inline-part-qty');
    
    function showInlineFilteredOptions(query = "") {
        const q = query.trim().toLowerCase();
        let matches = typeof availableRepairProducts !== 'undefined' ? availableRepairProducts : [];
        
        if (q) {
            const terms = q.split(/\s+/);
            matches = matches.filter(p => {
                const text = `${p.name} ${p.code || ''} ${p.category || ''}`.toLowerCase();
                return terms.every(t => text.includes(t));
            });
        }
        
        matches = matches.slice(0, 15); // limit to 15 for inline speed
        
        if (matches.length === 0) {
            dropdown.innerHTML = '<div class="autocomplete-item text-dim" style="text-align: center;">No se encontraron repuestos</div>';
        } else {
            dropdown.innerHTML = matches.map(p => `
                <div class="autocomplete-item cost-autocomplete-item" data-id="${p.id}" data-name="${p.name.replace(/"/g, '&quot;')}" data-price="${p.sale_price}" data-stock="${p.stock}">
                    <span class="autocomplete-item-name">
                        <span class="cost-item-badge" style="background:var(--accent-blue); color:#fff; padding: 0.15rem 0.45rem;">Stock: ${p.stock}</span>
                        ${p.name}
                    </span>
                    <span class="autocomplete-item-meta">Costo: S/ ${parseFloat(p.sale_price).toFixed(2)}</span>
                </div>
            `).join('');
            
            // Add click listeners to items
            dropdown.querySelectorAll('.cost-autocomplete-item').forEach(item => {
                if (item.classList.contains('text-dim')) return;
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = item.dataset.id;
                    const name = item.dataset.name;
                    const price = item.dataset.price;
                    searchInput.value = name;
                    selectHidden.value = JSON.stringify({ id, name, price });
                    dropdown.classList.add('hidden');
                    qtyInput.focus();
                });
            });
        }
        dropdown.classList.remove('hidden');
    }

    searchInput.addEventListener('input', (e) => showInlineFilteredOptions(e.target.value));
    searchInput.addEventListener('focus', () => showInlineFilteredOptions(searchInput.value));
    searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
        showInlineFilteredOptions(searchInput.value);
    });
    searchInput.addEventListener('mousedown', (e) => e.stopPropagation());
    dropdown.addEventListener('mousedown', (e) => e.stopPropagation());

    // Adding parts
    const renderTables = () => {
        const idx = block.dataset.index;
        const data = window.tempRepairData[idx];
        
        const partsTbody = block.querySelector('.inline-parts-tbody');
        partsTbody.innerHTML = '';
        if (data.parts.length === 0) {
            partsTbody.innerHTML = `<tr><td colspan="4" class="text-center text-dim">Sin repuestos</td></tr>`;
        } else {
            data.parts.forEach((p, i) => {
                partsTbody.innerHTML += `
                    <tr>
                        <td style="font-weight:600;">${p.name}</td>
                        <td><span style="background:rgba(0,0,0,0.05); padding:2px 6px; border-radius:4px; font-size:0.8rem;">x${p.qty}</span></td>
                        <td style="font-weight:700; color:var(--accent-red);">S/ ${(p.qty * p.price).toFixed(2)}</td>
                        <td><button type="button" class="btn-icon" style="color:var(--accent-red);" onclick="window.removeTempPartInline(${idx}, ${i})">✕</button></td>
                    </tr>`;
            });
        }
        
        const costsTbody = block.querySelector('.inline-costs-tbody');
        costsTbody.innerHTML = '';
        if (data.costs.length === 0) {
            costsTbody.innerHTML = `<tr><td colspan="3" class="text-center text-dim">Sin gastos</td></tr>`;
        } else {
            data.costs.forEach((c, i) => {
                costsTbody.innerHTML += `
                    <tr>
                        <td style="font-weight:600;">${c.description}</td>
                        <td style="font-weight:700; color:var(--accent-red);">S/ ${c.amount.toFixed(2)}</td>
                        <td><button type="button" class="btn-icon" style="color:var(--accent-red);" onclick="window.removeTempCostInline(${idx}, ${i})">✕</button></td>
                    </tr>`;
            });
        }
    };
    
    // Store render function for global access
    block.renderTables = renderTables;

    block.querySelector('.add-inline-part-btn').addEventListener('click', () => {
        const selectedVal = selectHidden.value;
        const qty = parseInt(qtyInput.value) || 1;
        
        if (!selectedVal) { showToast("Busca y selecciona un repuesto.", "error"); return; }
        
        const part = JSON.parse(selectedVal);
        const data = window.tempRepairData[block.dataset.index];
        const existing = data.parts.find(p => p.id === part.id);
        
        if (existing) { existing.qty += qty; } 
        else { data.parts.push({ id: part.id, name: part.name, qty: qty, price: part.price }); }
        
        searchInput.value = ''; selectHidden.value = ''; qtyInput.value = '1';
        renderTables();
    });

    block.querySelector('.add-inline-cost-btn').addEventListener('click', () => {
        const descInput = block.querySelector('.inline-cost-concept');
        const amtInput = block.querySelector('.inline-cost-amount');
        const desc = descInput.value.trim();
        const amount = parseFloat(amtInput.value) || 0;
        
        if (!desc || amount <= 0) { showToast("Concepto y costo son obligatorios", "error"); return; }
        
        window.tempRepairData[block.dataset.index].costs.push({ description: desc, amount: amount });
        
        descInput.value = ''; amtInput.value = '';
        renderTables();
    });
    
    renderTables();
    container.appendChild(block);
};

window.removeTempPartInline = function(blockIdx, partIdx) {
    if (window.tempRepairData[blockIdx]) {
        window.tempRepairData[blockIdx].parts.splice(partIdx, 1);
        const block = document.querySelector(`.repair-item-block[data-index="${blockIdx}"]`);
        if (block && block.renderTables) block.renderTables();
    }
};

window.removeTempCostInline = function(blockIdx, costIdx) {
    if (window.tempRepairData[blockIdx]) {
        window.tempRepairData[blockIdx].costs.splice(costIdx, 1);
        const block = document.querySelector(`.repair-item-block[data-index="${blockIdx}"]`);
        if (block && block.renderTables) block.renderTables();
    }
};

document.addEventListener('mousedown', function(e) {
    if (!e.target.closest('.cost-form-row') && !e.target.closest('.cost-autocomplete-dropdown')) {
        document.querySelectorAll('.inline-part-dropdown').forEach(d => d.classList.add('hidden'));
    }
});

async function openNewRepairModal() {
    await loadListsForRepairs();
    
    // Cargar repuestos para autocomplete
    try {
        const { data: prods } = await supabase.from('products').select('*').gt('stock', 0).order('name');
        availableRepairProducts = prods || [];
    } catch (e) { console.error("Error cargando productos:", e); }

    document.getElementById("repair-customer").value = "";
    document.getElementById("repair-phone").value = "";
    document.getElementById("repair-advance").value = "";
    document.getElementById("repair-items-container").innerHTML = "";
    repairItemCount = 0;
    window.tempRepairData = {};
    window.addRepairItemBlock();
    document.getElementById("new-repair-modal").classList.remove("hidden");
}


async function saveRepair() {
    const customerName = document.getElementById("repair-customer")?.value?.trim();
    const phone = document.getElementById("repair-phone")?.value?.trim() || '';
    const advance = parseFloat(document.getElementById("repair-advance")?.value) || 0;
    const advancePayment = document.getElementById("repair-advance-payment")?.value || "Caja";
    const activeSeller = document.querySelector('input[name="repair-active-seller"]:checked')?.value || 'Anónimo';
    const operator = activeSeller;

    const itemBlocks = document.querySelectorAll('.repair-item-block');
    let itemsData = [];
    let globalTotal = 0;

    for (const block of itemBlocks) {
        const eq = block.querySelector('.item-eq').value.trim();
        const br = block.querySelector('.item-brand').value.trim();
        const fault = block.querySelector('.item-fault').value.trim();
        const total = parseFloat(block.querySelector('.item-total').value) || 0;

        const idx = block.dataset.index;
        const tempData = window.tempRepairData[idx] || { parts: [], costs: [] };
        
        const parts = tempData.parts.map(p => ({
            id: p.id,
            name: p.name,
            qty: p.qty,
            price: p.price
        }));

        const costs = tempData.costs.map(c => ({
            description: c.description,
            amount: c.amount
        }));

        if (!eq || !br || !fault) {
            showToast("Completa los campos obligatorios (*) de todos los equipos", "error");
            return;
        }
        itemsData.push({ eq, br, fault, total, parts, costs });
        globalTotal += total;
    }

    if (!customerName || itemsData.length === 0) {
        showToast("Ingresa el nombre del cliente y los datos del equipo", "error");
        return;
    }

    if (advance > globalTotal) {
        showToast("El adelanto no puede superar el costo total estimado de todos los equipos", "error");
        return;
    }

    try {
        const { data: maxRow } = await supabase.from('repairs').select('id').order('id', { ascending: false }).limit(1).single();
        let nextId = (maxRow?.id || 0) + 1;
        const groupTicket = generateSequentialTicket('R', nextId);

        let remainingAdvance = advance;
        let inserts = [];
        let statusHistoryInserts = [];

        for (let i = 0; i < itemsData.length; i++) {
            const item = itemsData[i];
            const ticketCode = i === 0 ? groupTicket : generateSequentialTicket('R', nextId + i);
            
            let itemAdvance = 0;
            if (remainingAdvance >= item.total) {
                itemAdvance = item.total;
                remainingAdvance -= item.total;
            } else if (remainingAdvance > 0) {
                itemAdvance = remainingAdvance;
                remainingAdvance = 0;
            }

            let itemPartsCost = 0;
            for(const p of item.parts) {
                const prod = (typeof allProducts !== 'undefined') ? allProducts.find(x => x.name === p.name) : null;
                itemPartsCost += (prod ? prod.cost_price : 0) * p.qty;
            }
            let itemExtCost = item.costs.reduce((sum, c) => sum + c.amount, 0);

            inserts.push({
                ticket_code: ticketCode,
                group_ticket: groupTicket,
                customer_name: customerName,
                customer_phone: phone,
                equipment_type: item.eq,
                brand_model: item.br,
                fault_description: item.fault,
                operator_name: operator,
                total_amount: item.total,
                advance_payment: itemAdvance,
                advance_payment_method: advancePayment,
                remaining_balance: item.total - itemAdvance,
                internal_parts_cost: itemPartsCost,
                internal_external_cost: itemExtCost,
                net_profit: item.total - itemPartsCost - itemExtCost,
                status: 'PENDIENTE'
            });
        }

        const { data: insertedData, error } = await supabase.from('repairs').insert(inserts).select();
        if (error) throw error;

        let partsInserts = [];
        let costsInserts = [];
        let stockUpdates = [];
        let auditInserts = [];

        for (let i = 0; i < insertedData.length; i++) {
            const row = insertedData[i];
            const item = itemsData[i];

            statusHistoryInserts.push({
                repair_id: row.id,
                status: 'PENDIENTE',
                changed_by: operator,
                notes: 'Registro inicial'
            });

            // Prepare parts inserts and stock updates
            for (const p of item.parts) {
                const prod = (typeof allProducts !== 'undefined') ? allProducts.find(x => x.name === p.name) : null;
                partsInserts.push({
                    repair_id: row.id,
                    product_id: prod ? prod.id : null,
                    part_name: p.name,
                    quantity: p.qty,
                    cost_price: prod ? prod.cost_price : 0,
                    sale_price: p.price
                });

                if (prod && prod.is_physical) {
                    stockUpdates.push({ id: prod.id, stock: prod.stock - p.qty });
                    auditInserts.push({
                        product_id: prod.id,
                        operator_name: operator,
                        old_stock: prod.stock,
                        new_stock: prod.stock - p.qty,
                        change_reason: `Insumo en reparación ${row.ticket_code}`
                    });
                }
            }

            // Prepare costs inserts
            for (const c of item.costs) {
                costsInserts.push({
                    repair_id: row.id,
                    description: c.description,
                    amount: c.amount
                });
            }
        }

        const tasks = [supabase.from('repair_status_history').insert(statusHistoryInserts)];
        if (partsInserts.length > 0) tasks.push(supabase.from('repair_parts_used').insert(partsInserts));
        if (costsInserts.length > 0) tasks.push(supabase.from('repair_external_costs').insert(costsInserts));
        if (stockUpdates.length > 0) tasks.push(supabase.from('products').upsert(stockUpdates));
        if (auditInserts.length > 0) tasks.push(supabase.from('stock_audit').insert(auditInserts));

        await Promise.all(tasks);

        document.getElementById("new-repair-modal").classList.add("hidden");
        showToast("Reparación(es) registrada(s)");
        
        if(confirm("¿Deseas imprimir el comprobante de recepción?")) {
            printGroupReceipt(groupTicket, inserts);
        }

        await loadAllRepairs();
        renderRepairs();

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

window.printGroupReceipt = function(groupTicket, records = null) {
    if (!records) {
        supabase.from('repairs').select('*').eq('group_ticket', groupTicket).then(({data}) => {
            if(data && data.length > 0) generateAndPrintGroupReceipt(groupTicket, data);
        });
    } else {
        generateAndPrintGroupReceipt(groupTicket, records);
    }
};

function generateAndPrintGroupReceipt(groupTicket, records) {
    const first = records[0];
    let globalTotal = 0, globalAdvance = 0, globalRemaining = 0;
    
    let itemsHtml = '';
    records.forEach(r => {
        globalTotal += parseFloat(r.total_amount || 0);
        globalAdvance += parseFloat(r.advance_payment || 0);
        globalRemaining += parseFloat(r.remaining_balance || 0);
        
        itemsHtml += `
            <tr>
                <td colspan="2" style="padding: 1px 0 0 0; font-weight: 900; font-size: 12px; color: #000;">
                    ${r.equipment_type} ${r.brand_model}
                </td>
            </tr>
            <tr>
                <td style="padding: 0 0 4px 8px; font-size: 11px; color: #000; font-weight: 700;">Falla: ${r.fault_description}</td>
                <td style="padding: 0 0 4px 0; font-size: 12px; text-align: right; font-weight: 900; color: #000;">${fmt(r.total_amount)}</td>
            </tr>`;
    });

    const fechaStr = new Date(first.created_at || Date.now()).toLocaleString('es-PE', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });

    const ticketHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Ticket - ${groupTicket}</title>
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
            font-weight: 700;
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
            border-top: 2px dashed #000;
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
        .items-table thead th:last-child {
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
        <div class="receipt-title">TICKET DE RECEPCIÓN</div>
    </div>
    
    <div class="receipt-info">
        <div class="row"><span class="label">N° TICKET:</span><span>${groupTicket}</span></div>
        <div class="row"><span class="label">Fecha:</span><span>${fechaStr}</span></div>
        <div class="row"><span class="label">Cliente:</span><span>${first.customer_name}</span></div>
        ${first.customer_phone ? `<div class="row"><span class="label">Celular:</span><span>${first.customer_phone}</span></div>` : ''}
        <div class="row"><span class="label">Atendido:</span><span>${first.operator_name}</span></div>
    </div>
    
    <hr class="divider-thick">
    
    <div class="receipt-info" style="text-align: center; font-weight: 900; margin-bottom: 4px;">
        EQUIPOS INGRESADOS (${records.length})
    </div>
    
    <table class="items-table">
        <thead>
            <tr>
                <th>DESCRIPCIÓN</th>
                <th>COSTO</th>
            </tr>
        </thead>
        <tbody>
            ${itemsHtml}
        </tbody>
    </table>
    
    <hr class="divider">
    
    <div class="totals">
        <div class="row">
            <span>COSTO TOTAL:</span>
            <span>${fmt(globalTotal)}</span>
        </div>
        <div class="row">
            <span>ADELANTO:</span>
            <span>${fmt(globalAdvance)}</span>
        </div>
        <div class="row grand-total">
            <span>SALDO:</span>
            <span>${fmt(globalRemaining)}</span>
        </div>
    </div>
    
    <div class="receipt-footer">
        <div class="thanks">Conserve este ticket</div>
        <div>para recoger sus equipos.</div>
        <div style="margin-top:4px;">¡Gracias por su preferencia!</div>
        <div style="margin-top:4px; font-weight: 700;">Reparaciones Juan</div>
    </div>
</body>
</html>`;

    let printFrame = document.getElementById('receipt-print-frame');
    if (!printFrame) {
        printFrame = document.createElement('iframe');
        printFrame.id = 'receipt-print-frame';
        printFrame.style.position = 'absolute';
        printFrame.style.width = '0';
        printFrame.style.height = '0';
        printFrame.style.border = 'none';
        document.body.appendChild(printFrame);
    }
    const doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(ticketHtml);
    doc.close();

    setTimeout(() => {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
    }, 500);
}

// ═══ Realtime Sync ═══
window.addEventListener('supabase_realtime', async (e) => {
    const table = e.detail.table;
    if (document.querySelector('.nav-item[data-view="repairs"]')?.classList.contains('active') || document.querySelector('.mobile-nav-item[data-target="repairs"]')?.classList.contains('active')) {
        if (table === 'repairs' || table === 'repair_costs') {
            await loadListsForRepairs();
            await loadAllRepairs();
        }
    }
});