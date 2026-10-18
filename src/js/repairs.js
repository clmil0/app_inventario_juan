import { supabase, getSession, fmt, showToast, generateSequentialTicket } from './supabase.js';
import { safeAdd, safeSubtract, safeMultiply } from './math.js';
import { printHtml, repairReceiptHtml } from './receipts.js';
import { esc, money, icon, parseDate, fmtDay, fmtTime, initials, stagger, openDrawer, closeDrawer, currentDrawer } from './ui.js';

let allRepairs = [];
let currentRepairId = null;
let currentStatusFilter = 'all';
let equipmentTypes = [];
let brandModels = [];
let commonFaults = [];
let repView = 'board';
let listPage = 0;
const LIST_PER_PAGE = 12;
const BOARD_LIMIT = 6;
let boardLimits = {};
let openTicket = null;

const ST = ['PENDIENTE', 'EN_DIAGNOSTICO', 'EN_PROCESO', 'TERMINADO', 'ENTREGADO'];
const LBL = { PENDIENTE: 'Pendiente', EN_DIAGNOSTICO: 'Diagnóstico', EN_PROCESO: 'En proceso', TERMINADO: 'Terminado', ENTREGADO: 'Entregado' };
const COL = { PENDIENTE: '#f0c132', EN_DIAGNOSTICO: '#2b4f9e', EN_PROCESO: '#d6451b', TERMINADO: '#17171a', ENTREGADO: '#b9b3a8' };

export async function loadRepairs(intent = null) {
    await Promise.all([
        loadListsForRepairs(),
        loadAllRepairs()
    ]);
    boardLimits = {};
    listPage = 0;
    renderRepairs(true);
    if (intent?.openNew) openNewRepairModal();
    if (intent?.ticket) openTicketDrawer(intent.ticket);
}

export function bindRepairEvents() {
    document.getElementById("new-repair-btn")?.addEventListener("click", openNewRepairModal);
    document.querySelectorAll('[data-close-new-repair]').forEach(el => el.addEventListener('click', closeNewRepairModal));
    document.getElementById("cancel-repair-btn")?.addEventListener("click", closeNewRepairModal);
    document.getElementById("cancel-status-btn")?.addEventListener("click", () => document.getElementById("change-status-modal").classList.add("hidden"));
    document.getElementById("close-history-modal")?.addEventListener("click", () => document.getElementById("history-modal").classList.add("hidden"));

    // Los botones del modal (index.html) persisten entre vistas: se enlazan una sola vez
    if (!window._repairModalBound) {
        window._repairModalBound = true;
        document.getElementById("save-repair-btn")?.addEventListener("click", saveRepair);
        document.getElementById("add-repair-item-btn")?.addEventListener("click", () => { addRepairItemBlock(); updateNewRepairSummary(); });
        document.getElementById("confirm-status-btn")?.addEventListener("click", confirmChangeStatus);
        document.getElementById("add-repair-part-btn")?.addEventListener("click", addRepairPart);
        document.getElementById("add-external-cost-btn")?.addEventListener("click", addExternalCost);
        ["repair-anon-name", "repair-anon-phone"].forEach(id => document.getElementById(id)?.addEventListener("change", applyAnonymousRepair));
        document.querySelectorAll('#nr-initial-status [data-initial-status]').forEach(btn => btn.addEventListener('click', () => setInitialStatus(btn.dataset.initialStatus)));
        document.getElementById("repair-advance")?.addEventListener("input", updateNewRepairSummary);
        document.querySelectorAll('#nr-pay-options [data-pay]').forEach(btn => btn.addEventListener('click', () => {
            document.querySelectorAll('#nr-pay-options [data-pay]').forEach(b => b.classList.toggle('active', b === btn));
            document.getElementById('repair-advance-payment').value = btn.dataset.pay;
        }));
        const syncOps = () => document.querySelectorAll('.nr-ops input').forEach(r => r.nextElementSibling?.classList.toggle('active', r.checked));
        document.querySelectorAll('.nr-ops input').forEach(r => r.addEventListener('change', syncOps));
        syncOps();
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !document.getElementById('new-repair-modal')?.classList.contains('hidden')) closeNewRepairModal();
        });
        document.getElementById("print-repair-receipt-btn")?.addEventListener("click", () => {
            if (window.lastRepairGroupTicket && window.lastRepairInserts) printGroupReceipt(window.lastRepairGroupTicket, window.lastRepairInserts);
        });
        document.getElementById("close-repair-success-modal")?.addEventListener("click", () => document.getElementById("repair-success-modal")?.classList.add("hidden"));
    }

    document.querySelectorAll('#rep-views [data-view]').forEach(btn => btn.addEventListener('click', () => {
        repView = btn.dataset.view;
        document.querySelectorAll('#rep-views [data-view]').forEach(b => b.classList.toggle('active', b === btn));
        renderRepairs(true);
    }));

    document.getElementById("repair-global-search")?.addEventListener("input", () => { listPage = 0; renderRepairs(true); });
}

// Catálogo: cada tipo de equipo trae sus marcas y sus fallas; las fallas generales aplican a todos
let generalFaults = [];

async function loadListsForRepairs() {
    try {
        const res = await fetch('/api/admin/catalog');
        const catalog = await res.json();
        if (!res.ok) throw new Error(catalog.error);
        equipmentTypes = catalog.types || [];
        brandModels = catalog.brands || [];
        generalFaults = catalog.generalFaults || [];
        commonFaults = [...generalFaults, ...equipmentTypes.flatMap(t => t.faults)];
        populateDatalists();
    } catch (e) { console.error(e); }
}

function findEquipmentType(name) {
    const n = String(name || '').trim().toLowerCase();
    return n ? equipmentTypes.find(t => t.name.toLowerCase() === n) : null;
}

// Marcas sugeridas para un tipo: las suyas. Si el tipo no está configurado (o no tiene marcas), todas.
function brandsForType(typeName) {
    const type = findEquipmentType(typeName);
    return type && type.brands.length > 0 ? type.brands : brandModels;
}

// Fallas sugeridas para un tipo: las propias primero y luego las generales
function faultsForType(typeName) {
    const type = findEquipmentType(typeName);
    const list = type ? [...type.faults, ...generalFaults] : commonFaults;
    const seen = new Set();
    return list.filter(f => {
        const key = f.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function escAttr(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function populateDatalists() {
    const eqList = document.getElementById("equipment-list");
    if (eqList) eqList.innerHTML = equipmentTypes.map(e => `<option value="${escAttr(e.name)}">`).join('');
}

async function loadAllRepairs() {
    try {
        const res = await fetch('/api/repairs');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        allRepairs = (data || []).sort((a, b) => (parseDate(b.created_at) || 0) - (parseDate(a.created_at) || 0));
    } catch (e) { console.error(e); }
}

// ═══ Agrupación por ticket ═══
function groupKey(r) { return r.group_ticket || r.ticket_code; }

function buildGroups() {
    const map = new Map();
    allRepairs.forEach(r => {
        const k = groupKey(r);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(r);
    });
    return [...map.entries()].map(([ticket, items]) => {
        items.sort((a, b) => a.id - b.id);
        const idx = Math.min(...items.map(x => Math.max(0, ST.indexOf(x.status))));
        const st = ST[idx];
        const total = items.reduce((a, x) => safeAdd(a, parseFloat(x.total_amount || 0)), 0);
        const paid = items.reduce((a, x) => safeAdd(a, x.status === 'ENTREGADO' ? parseFloat(x.total_amount || 0) : parseFloat(x.advance_payment || 0)), 0);
        const first = items[0];
        return {
            ticket, items, st, idx, total, paid, saldo: Math.max(0, safeSubtract(total, paid)),
            customer: first.customer_name || 'Cliente', phone: first.customer_phone || '',
            date: parseDate(first.created_at), delivered: parseDate(items.map(x => x.delivered_at).filter(Boolean).sort().pop()),
            op: first.operator_name || '', mixed: new Set(items.map(x => x.status)).size > 1
        };
    }).sort((a, b) => (b.date || 0) - (a.date || 0));
}

function matchesQuery(g, q) {
    if (!q) return true;
    const text = [g.ticket, g.customer, g.phone, g.op, ...g.items.map(x => `${x.ticket_code} ${x.equipment_type} ${x.brand_model} ${x.fault_description}`)].join(' ').toLowerCase();
    return text.includes(q);
}

function cardStyle(st) {
    if (st === 'TERMINADO') return { cls: 'done', layer: '#e9a58f' };
    if (st === 'EN_PROCESO') return { cls: 'ink', layer: '#4a4a4f' };
    return { cls: 'light', layer: '#e2ddd3' };
}

function opBadge(name, dark) {
    if (!name || name === 'Anónimo') return `<span class="rep-op" style="background:${dark ? 'rgba(255,255,255,.2)' : '#efe3cf'}">—</span>`;
    return `<span class="rep-op" title="${esc(name)}" style="background:${name === 'Juan' ? '#f0c132' : '#efe3cf'}">${esc(initials(name))}</span>`;
}

function renderRepairs(animate = false) {
    const groups = buildGroups();
    const q = (document.getElementById("repair-global-search")?.value || '').trim().toLowerCase();
    const vis = groups.filter(g => matchesQuery(g, q));
    renderKpis(groups);
    renderFilterChips(groups, vis);
    const rt = document.getElementById('rep-result-txt');
    if (rt) { rt.classList.toggle('hidden', !q); rt.textContent = `${vis.length} tickets encontrados`; }
    const board = document.getElementById('rep-board'), list = document.getElementById('rep-list');
    if (!board || !list) return;
    board.style.display = repView === 'board' ? '' : 'none';
    list.style.display = repView === 'list' ? '' : 'none';
    if (repView === 'board') renderBoard(vis, animate);
    else renderList(vis, animate);
}

function renderKpis(groups) {
    const host = document.getElementById('rep-kpis'); if (!host) return;
    const active = groups.filter(g => g.st !== 'ENTREGADO');
    const ready = groups.filter(g => g.st === 'TERMINADO');
    const saldo = active.reduce((a, g) => safeAdd(a, g.saldo), 0);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const deliveredMonth = groups.filter(g => g.st === 'ENTREGADO' && (g.delivered || g.date) >= monthStart).length;
    const k = [
        { i: 'wrench', v: active.length, l: 'Tickets en taller' },
        { i: 'wallet', v: money(saldo, 0), l: 'Saldo por cobrar' },
        { i: 'check', v: ready.length, l: 'Listas para entregar' },
        { i: 'box', v: deliveredMonth, l: 'Entregadas este mes' }
    ];
    host.innerHTML = k.map(x => `<div class="ui-kpi" data-anim="1"><div class="ui-kpi-icon">${icon(x.i, 19, 1.9)}</div><div class="ui-kpi-body"><span class="ui-kpi-value">${x.v}</span><span class="ui-kpi-label">${x.l}</span></div></div>`).join('');
}

function renderFilterChips(groups, vis) {
    const host = document.getElementById('rep-filters'); if (!host) return;
    const items = [['all', 'Todas', null], ...ST.map(k => [k, LBL[k], COL[k]])];
    host.innerHTML = items.map(([k, label, dot]) => {
        const n = k === 'all' ? vis.length : vis.filter(g => g.st === k).length;
        return `<button class="ui-chip ui-chip--lg ${currentStatusFilter === k ? 'active' : ''}" data-status="${k}">${dot ? `<span class="dot" style="background:${dot}"></span>` : ''}${label}<span class="n">${n}</span></button>`;
    }).join('');
    host.querySelectorAll('[data-status]').forEach(btn => btn.addEventListener('click', () => {
        if (currentStatusFilter === btn.dataset.status) return;
        currentStatusFilter = btn.dataset.status;
        listPage = 0;
        renderRepairs(true);
    }));
}

function repCardHtml(g) {
    const cs = cardStyle(g.st);
    const it0 = g.items[0];
    const n = g.items.length;
    const dark = cs.cls !== 'light';
    const stack = n > 1 ? `0 7px 0 -3px ${cs.layer}` + (n > 2 ? `, 0 14px 0 -6px ${cs.layer}88` : '') : '';
    const due = g.st === 'TERMINADO' ? '<span class="due hot">Avisar</span>' : `<span class="due">Ingresó ${fmtDay(g.date)}</span>`;
    const paidPct = g.total > 0 ? Math.min(100, g.paid / g.total * 100) : 0;
    return `<button class="rep-card ${cs.cls}" data-ticket="${esc(g.ticket)}" style="${stack ? `box-shadow:${stack};margin-bottom:${n > 2 ? 14 : 7}px` : ''}">
        <span class="top"><span>${esc(g.ticket)}</span>${due}</span>
        <span class="fault">${esc(it0.fault_description || 'Reparación')}</span>
        <span class="dev">${esc([it0.equipment_type, it0.brand_model].filter(Boolean).join(' '))} · ${esc(g.customer)}</span>
        ${n > 1 ? `<span class="multi"><span class="dots">${g.items.map(x => `<i style="background:${COL[x.status] || '#ccc'};border-color:${x.status === 'TERMINADO' && g.st === 'TERMINADO' ? '#fff' : 'transparent'}"></i>`).join('')}</span>${n} equipos</span>` : ''}
        <span class="paid"><span style="width:${paidPct.toFixed(1)}%"></span></span>
        <span class="bottom"><span class="ui-cell-2"><span class="amt">${money(g.total, 0)}</span><small>Saldo ${money(g.saldo, 0)}</small></span>${opBadge(g.op, dark)}</span>
    </button>`;
}

function renderBoard(vis, animate) {
    const board = document.getElementById('rep-board');
    const active = ST.slice(0, 4).filter(k => currentStatusFilter === 'all' || currentStatusFilter === k);
    const showDone = currentStatusFilter === 'all' || currentStatusFilter === 'ENTREGADO';
    const single = currentStatusFilter !== 'all';
    board.classList.toggle('single', single);
    let html = active.map(k => {
        const gs = vis.filter(g => g.st === k);
        const lim = boardLimits[k] || (single ? 24 : BOARD_LIMIT);
        const saldo = gs.reduce((a, g) => safeAdd(a, g.saldo), 0);
        return `<div class="rep-col" data-col="${k}" data-anim="1">
            <div class="rep-col-head">
                <div class="row"><span class="t"><span class="ui-dot" style="background:${COL[k]}"></span>${LBL[k]}</span><span class="n">${gs.length}</span></div>
                <span class="s">Saldo ${money(saldo, 0)}</span>
            </div>
            <div class="rep-col-cards">${gs.slice(0, lim).map(repCardHtml).join('') || '<div class="rep-col-empty">Sin tickets</div>'}</div>
            ${gs.length > lim ? `<button class="rep-more" data-more="${k}">Ver ${Math.min(BOARD_LIMIT, gs.length - lim)} más · quedan ${gs.length - lim}</button>` : ''}
        </div>`;
    }).join('');
    if (showDone) {
        const done = vis.filter(g => g.st === 'ENTREGADO');
        const lim = single ? 40 : 10;
        html += `<div class="rep-col rep-col-done" data-col="ENTREGADO" data-anim="1">
            <div class="rep-col-head"><div class="row"><span class="t"><span class="ui-dot" style="background:${COL.ENTREGADO}"></span>Entregado</span><span class="n">${done.length}</span></div></div>
            <div class="rep-done-list">${done.slice(0, lim).map(g => `<button class="rep-done-row" data-ticket="${esc(g.ticket)}">
                <span class="ui-cell-2"><span>${esc(g.customer)}</span><small>${esc(g.items[0].brand_model || g.items[0].equipment_type)}${g.items.length > 1 ? ` +${g.items.length - 1}` : ''}</small></span>
                <span class="d">${fmtDay(g.delivered || g.date)}</span></button>`).join('') || '<div class="rep-col-empty">Sin entregas</div>'}</div>
            <button class="ui-pill outline" data-tolist="1" style="padding:11px;margin-top:6px">Ver historial completo</button>
        </div>`;
    }
    board.innerHTML = html;
    board.querySelectorAll('[data-ticket]').forEach(el => el.addEventListener('click', () => openTicketDrawer(el.dataset.ticket)));
    board.querySelectorAll('[data-more]').forEach(el => el.addEventListener('click', () => {
        const k = el.dataset.more;
        boardLimits[k] = (boardLimits[k] || BOARD_LIMIT) + BOARD_LIMIT;
        renderRepairs();
        stagger(document.querySelectorAll(`[data-col="${k}"] .rep-card`), 0, 25, 500);
    }));
    board.querySelector('[data-tolist]')?.addEventListener('click', () => {
        repView = 'list'; currentStatusFilter = 'ENTREGADO';
        document.querySelectorAll('#rep-views [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === 'list'));
        renderRepairs(true);
    });
    if (animate) {
        stagger(board.querySelectorAll('.rep-col'), 0, 60, 600);
        stagger(board.querySelectorAll('.rep-card'), 250, 30, 600);
    }
}

function renderList(vis, animate) {
    const host = document.getElementById('repairs-list'); if (!host) return;
    const rows = vis.filter(g => currentStatusFilter === 'all' || g.st === currentStatusFilter);
    const pages = Math.max(1, Math.ceil(rows.length / LIST_PER_PAGE));
    if (listPage >= pages) listPage = pages - 1;
    const page = rows.slice(listPage * LIST_PER_PAGE, (listPage + 1) * LIST_PER_PAGE);
    host.innerHTML = page.length ? page.map(g => {
        const it0 = g.items[0];
        return `<button class="ui-tr" data-ticket="${esc(g.ticket)}">
            <span class="ui-cell-2"><span class="tnum">${esc(g.ticket)}</span><small>${fmtDay(g.date)}</small></span>
            <span class="ui-cell-2"><span>${esc(g.customer)}</span><small>${esc(g.phone || '—')}</small></span>
            <span style="display:flex;align-items:center;gap:8px;min-width:0"><span class="ui-cell-2"><span>${esc([it0.equipment_type, it0.brand_model].filter(Boolean).join(' '))}</span><small>${esc(it0.fault_description || '')}</small></span>${g.items.length > 1 ? `<span class="ui-badge ink" style="padding:3px 9px">+${g.items.length - 1}</span>` : ''}</span>
            <span style="display:flex;align-items:center;gap:6px"><span class="ui-tag st-${g.st}">${LBL[g.st]}</span>${g.mixed ? `<span title="Equipos en distintos estados" style="display:flex;gap:2px">${g.items.map(x => `<i class="ui-dot" style="width:7px;height:7px;background:${COL[x.status]}"></i>`).join('')}</span>` : ''}</span>
            <span class="muted">${esc(g.op || '—')}</span>
            <span class="r tnum">${money(g.total, 0)}</span>
            <span class="r tnum" style="color:${g.saldo > 0 ? 'var(--orange)' : 'var(--dim)'}">${money(g.saldo, 0)}</span>
            ${opBadge(g.op, false)}
        </button>`;
    }).join('') : '<div class="ui-empty">No hay reparaciones</div>';
    host.querySelectorAll('[data-ticket]').forEach(el => el.addEventListener('click', () => openTicketDrawer(el.dataset.ticket)));

    const info = document.getElementById('rep-page-info');
    if (info) info.textContent = rows.length ? `${listPage * LIST_PER_PAGE + 1}–${Math.min(rows.length, (listPage + 1) * LIST_PER_PAGE)} de ${rows.length} tickets` : '0 tickets';
    const pager = document.getElementById('rep-pages');
    if (pager) {
        const nums = [];
        for (let i = 0; i < pages; i++) if (i === 0 || i === pages - 1 || Math.abs(i - listPage) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
        pager.innerHTML = `<button class="ui-icon-btn" style="width:40px;height:40px" data-pg="prev" aria-label="Anterior">${icon('left', 14, 2.2)}</button>
            ${nums.map(n => n === '…' ? '<span class="gap">…</span>' : `<button class="pg ${n === listPage ? 'active' : ''}" data-pg="${n}">${n + 1}</button>`).join('')}
            <button class="ui-icon-btn" style="width:40px;height:40px" data-pg="next" aria-label="Siguiente">${icon('right', 14, 2.2)}</button>`;
        pager.querySelectorAll('[data-pg]').forEach(b => b.addEventListener('click', () => {
            const v = b.dataset.pg;
            listPage = v === 'prev' ? Math.max(0, listPage - 1) : v === 'next' ? Math.min(pages - 1, listPage + 1) : parseInt(v);
            renderRepairs(true);
        }));
    }
    if (animate) stagger(host.children, 0, 22, 500);
}

// ═══ Drawer del ticket ═══
async function openTicketDrawer(ticket) {
    const g = buildGroups().find(x => x.ticket === ticket);
    if (!g) return;
    openTicket = ticket;
    const cs = cardStyle(g.st);
    const headCls = g.st === 'ENTREGADO' ? 'light delivered' : cs.cls === 'light' ? 'light' : cs.cls;
    const next = g.idx < 4 ? ST[g.idx + 1] : null;
    const paidPct = g.total > 0 ? Math.min(100, g.paid / g.total * 100) : 0;
    const html = `
        <div class="ui-drawer-head rep-head ${headCls}">
            <div class="top"><span class="meta">${esc(g.ticket)} · Ingresó ${fmtDay(g.date)}</span>
                <button class="close" data-drawer-close aria-label="Cerrar">${icon('close', 14, 2.2)}</button></div>
            <span style="font-size:28px;font-weight:500;letter-spacing:-.02em;line-height:1.1;margin-top:6px">${esc(g.customer)}</span>
            <span style="font-size:15px;opacity:.8">${esc(g.phone || 'Sin teléfono')} · ${g.items.length > 1 ? `${g.items.length} equipos` : '1 equipo'}</span>
            <span class="rep-head-chip">${LBL[g.st]}${g.mixed ? ' · estados mixtos' : ''}</span>
        </div>
        <div class="ui-drawer-body">
            <div style="display:flex;flex-direction:column;gap:8px">
                <span style="font-size:15px;font-weight:500">Equipos en este ticket</span>
                ${g.items.map((x, i) => {
                    const xi = Math.max(0, ST.indexOf(x.status));
                    return `<div class="rep-item">
                        <div class="row"><div class="ui-cell-2" style="gap:2px"><small>#${i + 1} · ${esc(x.equipment_type)} · ${esc(x.ticket_code)}</small><span style="font-size:16px;font-weight:500;white-space:normal">${esc(x.brand_model)}</span><span style="font-size:13px;color:var(--muted);white-space:normal">${esc(x.fault_description)}</span></div>
                            <span class="tnum" style="font-size:15px;font-weight:500">${money(x.total_amount, 0)}</span></div>
                        <div class="row" style="align-items:center">
                            <span class="ui-tag st-${x.status}">${LBL[x.status] || x.status}</span>
                            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                                <button class="ui-mini" data-costs="${x.id}" data-code="${esc(x.ticket_code)}" title="Repuestos y gastos">Insumos</button>
                                <button class="ui-mini" data-hist="${x.id}" data-code="${esc(x.ticket_code)}" title="Historial y fotos">Fotos</button>
                                ${xi < 4 ? `<button class="ui-mini" data-adv="${x.id}" data-to="${ST[xi + 1]}">Pasar a ${LBL[ST[xi + 1]].toLowerCase()}</button>` : ''}
                                <button class="ui-mini" data-st="${x.id}" data-code="${esc(x.ticket_code)}" data-cur="${x.status}" title="Elegir estado">${icon('dots', 14, 3)}</button>
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:14px">
                <div class="ui-cell-2"><small>Atiende</small><span>${esc(g.op || '—')}</span></div>
                <div class="ui-cell-2"><small>${g.st === 'ENTREGADO' ? 'Entregado' : 'Ingreso'}</small><span>${fmtDay(g.st === 'ENTREGADO' ? (g.delivered || g.date) : g.date)} · ${fmtTime(g.st === 'ENTREGADO' ? (g.delivered || g.date) : g.date)}</span></div>
            </div>
            <div class="ui-sheet" style="padding:18px;gap:10px">
                <div style="display:flex;justify-content:space-between;align-items:baseline"><span style="color:var(--muted)">Pagado</span><span style="font-size:24px;font-weight:500">${money(g.paid, 0)} <span style="font-size:14px;color:var(--dim)">de ${money(g.total, 0)}</span></span></div>
                <div class="ui-bar"><span style="width:0%;background: var(--blue-bg)" data-w="${paidPct.toFixed(1)}"></span></div>
                <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--muted)">Saldo pendiente${g.st !== 'ENTREGADO' ? ' (se cobra al entregar)' : ''}</span><span style="color:var(--orange);font-weight:500">${money(g.saldo, 0)}</span></div>
            </div>
            <div style="display:flex;flex-direction:column">
                <span style="font-size:15px;font-weight:500;margin-bottom:12px">Historial del ticket</span>
                <div id="rep-steps">${stepsHtml(g, null)}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
                ${next ? `<button class="ui-pill orange" id="rep-advance-all">${g.items.length > 1 ? `Pasar todo a ${LBL[next].toLowerCase()}` : `Pasar a ${LBL[next].toLowerCase()}`}</button>` : ''}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                    <button class="ui-pill outline" id="rep-print">${icon('print', 15, 2)} ${g.idx >= 3 ? 'Boleta final' : 'Recibo de ingreso'}</button>
                    <button class="ui-pill outline" id="rep-costs-first">Insumos y costos</button>
                </div>
            </div>
        </div>`;

    const drawer = currentDrawer() && openTicket === ticket && currentDrawer().dataset.ticket === ticket
        ? (currentDrawer().innerHTML = html, currentDrawer())
        : openDrawer(html, { onClose: () => { openTicket = null; } });
    drawer.dataset.ticket = ticket;
    requestAnimationFrame(() => requestAnimationFrame(() => drawer.querySelectorAll('[data-w]').forEach(b => b.style.width = b.dataset.w + '%')));

    drawer.querySelectorAll('[data-adv]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        await updateRepairStatus([parseInt(b.dataset.adv)], b.dataset.to, '');
    }));
    drawer.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => openChangeStatus(parseInt(b.dataset.st), b.dataset.code, b.dataset.cur)));
    drawer.querySelectorAll('[data-costs]').forEach(b => b.addEventListener('click', () => openRepairCostsModal(parseInt(b.dataset.costs), b.dataset.code)));
    drawer.querySelectorAll('[data-hist]').forEach(b => b.addEventListener('click', () => openHistory(parseInt(b.dataset.hist), b.dataset.code)));
    drawer.querySelector('#rep-advance-all')?.addEventListener('click', async e => {
        e.currentTarget.disabled = true;
        const ids = g.items.filter(x => ST.indexOf(x.status) === g.idx).map(x => x.id);
        await updateRepairStatus(ids, next, '');
    });
    drawer.querySelector('#rep-print')?.addEventListener('click', () => printGroupReceipt(g.ticket, g.items));
    drawer.querySelector('#rep-costs-first')?.addEventListener('click', () => openRepairCostsModal(g.items[0].id, g.items[0].ticket_code));

    // Fechas reales del historial de estados
    try {
        const res = await fetch(`/api/repairs/${g.items[0].id}/history`);
        const hist = await res.json();
        const host = drawer.querySelector('#rep-steps');
        if (host && Array.isArray(hist) && openTicket === ticket) host.innerHTML = stepsHtml(g, hist);
    } catch (e) { /* sin fechas */ }
}

function stepsHtml(g, hist) {
    const at = {};
    (hist || []).forEach(h => { const d = parseDate(h.changed_at); if (d && (!at[h.status] || d < at[h.status])) at[h.status] = d; });
    if (!at.PENDIENTE && g.date) at.PENDIENTE = g.date;
    return ST.map((k, i) => {
        const done = i < g.idx, cur = i === g.idx, reached = i <= g.idx;
        const d = at[k];
        return `<div class="rep-step">
            <div class="rail"><span class="dot" style="background:${done ? COL[k] : cur ? 'var(--paper)' : 'transparent'};border-color:${reached ? COL[k] : 'var(--line-strong)'}"></span>${i < 4 ? `<span class="line" style="background:${done ? 'rgba(23,23,26,.25)' : 'var(--line)'}"></span>` : ''}</div>
            <div class="txt"><span style="color:${reached ? 'var(--text)' : 'var(--dim)'}">${LBL[k]}</span><span class="at">${reached && d ? `${fmtDay(d)} · ${fmtTime(d)}` : ''}</span></div>
        </div>`;
    }).join('');
}

// Cambia el estado de uno o más equipos y registra el historial
async function updateRepairStatus(ids, newStatus, notes) {
    const operator = getSession()?.profile?.username || document.querySelector('input[name="repair-active-seller"]:checked')?.value || 'Anónimo';
    try {
        for (const id of ids) {
            const updateData = { status: newStatus };
            if (newStatus === 'ENTREGADO') updateData.delivered_at = new Date().toISOString();
            const { error } = await supabase.from('repairs').update(updateData).eq('id', id);
            if (error) throw error;
            await supabase.from('repair_status_history').insert({ repair_id: id, status: newStatus, changed_by: operator, notes });
        }
        showToast(ids.length > 1 ? `${ids.length} equipos pasaron a ${LBL[newStatus].toLowerCase()}` : `Estado: ${LBL[newStatus]}`);
        await loadAllRepairs();
        renderRepairs();
        const ticket = openTicket;
        if (ticket) {
            await openTicketDrawer(ticket);
            const card = document.querySelector(`.rep-card[data-ticket="${CSS.escape(ticket)}"]`);
            card?.animate && card.animate([{ opacity: 0, transform: 'translateY(-30px) scale(.9)' }, { opacity: 1, transform: 'translateY(4px) scale(1.02)' }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
    } catch (e) {
        console.error("Error al actualizar estado:", e);
        showToast("Error al actualizar estado", "error");
    }
}

function statusLabel(status) {
    const map = { PENDIENTE: 'Pendiente', EN_DIAGNOSTICO: 'En Diagnóstico', EN_PROCESO: 'En Proceso', TERMINADO: 'Terminado', ENTREGADO: 'Entregado' };
    return map[status] || status;
}

let repairItemCount = 0;
window.tempRepairData = {}; // Global state for temporary parts and costs per equipment

function addRepairItemBlock() {
    repairItemCount++;
    const container = document.getElementById("repair-items-container");
    const block = document.createElement("div");
    block.className = "repair-item-block nr-item";
    block.dataset.index = repairItemCount;
    window.tempRepairData[repairItemCount] = { parts: [], costs: [] };

    const types = equipmentTypes.length ? equipmentTypes.map(t => t.name) : ['Celular', 'Laptop', 'Tablet', 'Consola'];
    block.innerHTML = `
        <div class="nr-item-head">
            <span class="t"><span class="num"></span>Equipo</span>
            <button type="button" class="remove-item-btn nr-remove">Quitar</button>
        </div>
        <div class="ui-chips nr-types">
            ${types.map(t => `<button type="button" class="ui-chip" data-type="${escAttr(t)}">${esc(t)}</button>`).join('')}
            <button type="button" class="ui-chip nr-chip-other" data-other-type="true" style="border-style:dashed">+ Otro</button>
        </div>
        <div class="nr-eq-wrap" style="display:flex;flex-direction:column;gap:4px">
            <input type="text" class="item-eq ui-field sand" placeholder="Tipo de equipo (ej. Celular, Impresora, Smartwatch...)" list="equipment-list" autocomplete="off" style="height:44px;font-size:14px">
        </div>
        <div class="nr-two">
            <input type="text" class="item-brand ui-field sand" placeholder="Marca y modelo" list="brands-list-${repairItemCount}" autocomplete="off"><datalist id="brands-list-${repairItemCount}"></datalist>
            <input type="number" class="item-total ui-field sand" placeholder="Precio (S/)" min="0" step="0.50" inputmode="decimal">
        </div>
        <div class="ui-chips nr-brands"></div>
        <div style="display:flex;flex-direction:column;gap:8px">
            <span class="ui-label" style="font-size:12px;color:var(--dim)">Falla</span>
            <div class="ui-chips nr-faults"></div>
            <input type="text" class="item-fault ui-field sand" placeholder="Detalle de la falla" list="faults-list-${repairItemCount}" autocomplete="off" style="height:44px;font-size:14px">
            <datalist id="faults-list-${repairItemCount}"></datalist>
        </div>
        <button type="button" class="toggle-inline-costs-btn nr-costs-toggle">${icon('box', 14, 2)} Repuestos y gastos (opcional)</button>
        <div class="inline-advanced-costs hidden nr-costs">
            <div class="nr-costs-col">
                <span class="ui-label">Repuestos del inventario</span>
                <div style="position:relative">
                    <div class="cost-form-row" style="display:flex;gap:6px">
                        <input type="hidden" class="inline-part-select" value="">
                        <input type="text" class="inline-part-search ui-field sand" placeholder="Buscar repuesto..." autocomplete="off" style="flex:1;height:42px;font-size:14px">
                        <input type="number" class="inline-part-qty ui-field sand" placeholder="Cant." value="1" min="1" style="width:70px;height:42px;font-size:14px">
                        <button type="button" class="add-inline-part-btn ui-pill sm" style="height:42px">Asignar</button>
                    </div>
                    <div class="inline-part-dropdown cost-autocomplete-dropdown hidden"></div>
                </div>
                <div class="inline-parts-tbody nr-mini-list"></div>
            </div>
            <div class="nr-costs-col">
                <span class="ui-label">Pagos a terceros</span>
                <div class="cost-form-row" style="display:flex;gap:6px">
                    <input type="text" class="inline-cost-concept ui-field sand" placeholder="Concepto" style="flex:1;height:42px;font-size:14px">
                    <input type="number" class="inline-cost-amount ui-field sand" placeholder="S/" min="0" step="1" style="width:80px;height:42px;font-size:14px">
                    <button type="button" class="add-inline-cost-btn ui-pill sm" style="height:42px">Agregar</button>
                </div>
                <div class="inline-costs-tbody nr-mini-list"></div>
            </div>
        </div>`;

    block.querySelector('.remove-item-btn').addEventListener('click', () => {
        block.remove();
        delete window.tempRepairData[block.dataset.index];
        renumberRepairItems();
        updateNewRepairSummary();
    });

    const eqInput = block.querySelector('.item-eq');
    const brandInput = block.querySelector('.item-brand');
    const faultInput = block.querySelector('.item-fault');
    const otherChip = block.querySelector('[data-other-type]');

    // Al elegir o escribir el tipo de equipo se filtran sus marcas y sus fallas
    const refreshForType = () => {
        const eq = eqInput.value.trim();
        const eqLower = eq.toLowerCase();
        let matched = false;
        block.querySelectorAll('[data-type]').forEach(b => {
            const isMatch = b.dataset.type.toLowerCase() === eqLower;
            b.classList.toggle('active', isMatch);
            if (isMatch) matched = true;
        });
        if (otherChip) {
            otherChip.classList.toggle('active', !matched && eq.length > 0);
        }

        const brands = brandsForType(eq).slice(0, 8);
        block.querySelector(`#brands-list-${block.dataset.index}`).innerHTML = brandsForType(eq).map(b => `<option value="${escAttr(b.name)}">`).join('');
        block.querySelector('.nr-brands').innerHTML = brands.map(b => `<button type="button" class="nr-sug" data-brand="${escAttr(b.name)}">${esc(b.name)}</button>`).join('');
        const faults = faultsForType(eq).slice(0, 10);
        block.querySelector(`#faults-list-${block.dataset.index}`).innerHTML = faultsForType(eq).map(f => `<option value="${escAttr(f.name)}">`).join('');
        block.querySelector('.nr-faults').innerHTML = faults.map(f => `<button type="button" class="ui-chip" data-fault="${escAttr(f.name)}">${esc(f.name)}</button>`).join('');
        syncFaultChips();
        block.querySelectorAll('[data-brand]').forEach(b => b.addEventListener('click', () => {
            const cur = brandInput.value.trim();
            brandInput.value = cur && !cur.toLowerCase().startsWith(b.dataset.brand.toLowerCase()) ? `${b.dataset.brand} ${cur}` : (cur || b.dataset.brand + ' ');
            brandInput.focus();
            updateNewRepairSummary();
        }));
        block.querySelectorAll('[data-fault]').forEach(b => b.addEventListener('click', () => {
            const parts = faultInput.value.split(',').map(x => x.trim()).filter(Boolean);
            const name = b.dataset.fault;
            const i = parts.findIndex(x => x.toLowerCase() === name.toLowerCase());
            if (i >= 0) parts.splice(i, 1); else parts.push(name);
            faultInput.value = parts.join(', ');
            syncFaultChips();
            updateNewRepairSummary();
        }));
    };
    const syncFaultChips = () => {
        const parts = faultInput.value.split(',').map(x => x.trim().toLowerCase());
        block.querySelectorAll('[data-fault]').forEach(b => b.classList.toggle('active', parts.includes(b.dataset.fault.toLowerCase())));
    };
    block.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
        eqInput.value = b.dataset.type;
        refreshForType();
        updateNewRepairSummary();
    }));
    otherChip?.addEventListener('click', () => {
        eqInput.value = '';
        eqInput.focus();
        refreshForType();
        if (otherChip) otherChip.classList.add('active');
        updateNewRepairSummary();
    });
    eqInput.addEventListener('input', () => {
        refreshForType();
        updateNewRepairSummary();
    });
    eqInput.value = types[0] || '';
    refreshForType();
    [brandInput, block.querySelector('.item-total')].forEach(i => i.addEventListener('input', updateNewRepairSummary));
    faultInput.addEventListener('input', () => { syncFaultChips(); updateNewRepairSummary(); });

    block.querySelector('.toggle-inline-costs-btn').addEventListener('click', () => {
        block.querySelector('.inline-advanced-costs').classList.toggle('hidden');
    });

    // Autocompletado de repuestos para este equipo
    const searchInput = block.querySelector('.inline-part-search');
    const dropdown = block.querySelector('.inline-part-dropdown');
    const selectHidden = block.querySelector('.inline-part-select');
    const qtyInput = block.querySelector('.inline-part-qty');

    function showInlineFilteredOptions(query = "") {
        const q = query.trim().toLowerCase();
        let matches = typeof availableRepairProducts !== 'undefined' ? availableRepairProducts : [];
        if (q) {
            const terms = q.split(/\s+/);
            matches = matches.filter(p => terms.every(t => `${p.name} ${p.code || ''} ${p.category || ''}`.toLowerCase().includes(t)));
        }
        matches = matches.slice(0, 15);
        dropdown.innerHTML = matches.length === 0
            ? '<div class="autocomplete-item text-dim" style="text-align: center;">No se encontraron repuestos</div>'
            : matches.map(p => `
                <div class="autocomplete-item cost-autocomplete-item" data-id="${p.id}" data-name="${escAttr(p.name)}" data-price="${p.sale_price}" data-stock="${p.stock}">
                    <span class="autocomplete-item-name"><span class="cost-item-badge">Stock: ${p.stock}</span> ${esc(p.name)}</span>
                    <span class="autocomplete-item-meta">${money(p.sale_price)}</span>
                </div>`).join('');
        dropdown.querySelectorAll('.cost-autocomplete-item').forEach(item => {
            item.addEventListener('click', e => {
                e.stopPropagation();
                searchInput.value = item.dataset.name;
                selectHidden.value = JSON.stringify({ id: item.dataset.id, name: item.dataset.name, price: item.dataset.price });
                dropdown.classList.add('hidden');
                qtyInput.focus();
            });
        });
        dropdown.classList.remove('hidden');
    }

    searchInput.addEventListener('input', e => showInlineFilteredOptions(e.target.value));
    searchInput.addEventListener('focus', () => showInlineFilteredOptions(searchInput.value));
    searchInput.addEventListener('click', e => { e.stopPropagation(); showInlineFilteredOptions(searchInput.value); });
    searchInput.addEventListener('mousedown', e => e.stopPropagation());
    dropdown.addEventListener('mousedown', e => e.stopPropagation());

    const renderTables = () => {
        const idx = block.dataset.index;
        const data = window.tempRepairData[idx];
        block.querySelector('.inline-parts-tbody').innerHTML = data.parts.length === 0
            ? '<span class="nr-mini-empty">Sin repuestos</span>'
            : data.parts.map((p, i) => `<div class="nr-mini-row"><span>${esc(p.name)} <small>×${p.qty}</small></span><span class="tnum">${money(p.qty * p.price)}</span><button type="button" onclick="window.removeTempPartInline(${idx}, ${i})" aria-label="Quitar">${icon('close', 11, 2.4)}</button></div>`).join('');
        block.querySelector('.inline-costs-tbody').innerHTML = data.costs.length === 0
            ? '<span class="nr-mini-empty">Sin gastos</span>'
            : data.costs.map((c, i) => `<div class="nr-mini-row"><span>${esc(c.description)}</span><span class="tnum">${money(c.amount)}</span><button type="button" onclick="window.removeTempCostInline(${idx}, ${i})" aria-label="Quitar">${icon('close', 11, 2.4)}</button></div>`).join('');
    };
    block.renderTables = renderTables;

    block.querySelector('.add-inline-part-btn').addEventListener('click', () => {
        const selectedVal = selectHidden.value;
        const qty = parseInt(qtyInput.value) || 1;
        if (!selectedVal) { showToast("Busca y selecciona un repuesto.", "error"); return; }
        const part = JSON.parse(selectedVal);
        const data = window.tempRepairData[block.dataset.index];
        const existing = data.parts.find(p => p.id === part.id);
        if (existing) existing.qty += qty;
        else data.parts.push({ id: part.id, name: part.name, qty, price: part.price });
        searchInput.value = ''; selectHidden.value = ''; qtyInput.value = '1';
        renderTables();
    });

    block.querySelector('.add-inline-cost-btn').addEventListener('click', () => {
        const descInput = block.querySelector('.inline-cost-concept');
        const amtInput = block.querySelector('.inline-cost-amount');
        const desc = descInput.value.trim();
        const amount = parseFloat(amtInput.value) || 0;
        if (!desc || amount <= 0) { showToast("Concepto y costo son obligatorios", "error"); return; }
        window.tempRepairData[block.dataset.index].costs.push({ description: desc, amount });
        descInput.value = ''; amtInput.value = '';
        renderTables();
    });

    renderTables();
    container.appendChild(block);
    renumberRepairItems();
    if (repairItemCount > 1 && block.animate) block.animate([{ opacity: 0, transform: 'translateY(-12px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
window.addRepairItemBlock = addRepairItemBlock;

function renumberRepairItems() {
    const blocks = [...document.querySelectorAll('#repair-items-container .repair-item-block')];
    blocks.forEach((b, i) => {
        b.querySelector('.num').textContent = i + 1;
        b.querySelector('.remove-item-btn').style.visibility = blocks.length > 1 ? 'visible' : 'hidden';
    });
    const c = document.getElementById('nr-count');
    if (c) c.textContent = blocks.length === 1 ? '1 equipo' : `${blocks.length} equipos`;
}

function updateNewRepairSummary() {
    const blocks = [...document.querySelectorAll('#repair-items-container .repair-item-block')];
    let total = 0;
    const host = document.getElementById('nr-summary');
    if (host) host.innerHTML = blocks.map(b => {
        const price = parseFloat(b.querySelector('.item-total').value) || 0;
        total = safeAdd(total, price);
        const dev = [b.querySelector('.item-eq').value, b.querySelector('.item-brand').value.trim()].filter(Boolean).join(' · ') || 'Equipo';
        const fault = b.querySelector('.item-fault').value.trim() || 'Sin falla';
        return `<div class="nr-sum-row"><span class="ui-cell-2"><span>${esc(dev)}</span><small>${esc(fault)}</small></span><span class="tnum">${money(price, 0)}</span></div>`;
    }).join('');
    const adv = Math.max(0, parseFloat(document.getElementById('repair-advance')?.value) || 0);
    const t = document.getElementById('nr-total'); if (t) t.textContent = money(total, 0);
    const sd = document.getElementById('nr-saldo'); if (sd) sd.textContent = money(Math.max(0, total - adv), 0);
    const save = document.getElementById('save-repair-btn');
    if (save) save.style.background = total > 0 ? '' : 'rgba(255,255,255,.14)';
}

function closeNewRepairModal() {
    document.getElementById("new-repair-modal")?.classList.add("hidden");
}

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
        const { data: prods } = await supabase.from('products').select('*').gt('stock', 0).eq('is_active', 1).order('name');
        availableRepairProducts = prods || [];
    } catch (e) { console.error("Error cargando productos:", e); }

    document.getElementById("repair-customer").value = "";
    document.getElementById("repair-phone").value = "";
    ["repair-anon-name", "repair-anon-phone"].forEach(id => { const c = document.getElementById(id); if (c) c.checked = false; });
    applyAnonymousRepair();
    setInitialStatus(null);
    document.getElementById("repair-advance").value = "";
    document.getElementById("repair-advance-payment").value = "Caja";
    document.querySelectorAll('#nr-pay-options [data-pay]').forEach(b => b.classList.toggle('active', b.dataset.pay === 'Caja'));
    document.getElementById("repair-items-container").innerHTML = "";
    repairItemCount = 0;
    window.tempRepairData = {};
    addRepairItemBlock();
    updateNewRepairSummary();
    try {
        const { data: maxRows } = await supabase.from('repairs').select('id').order('id', { ascending: false }).limit(1);
        const hint = document.getElementById('new-repair-ticket-hint');
        if (hint) hint.textContent = `Ticket ${generateSequentialTicket('R', ((maxRows && maxRows[0]?.id) || 0) + 1)}`;
    } catch (e) { /* solo informativo */ }
    document.getElementById("new-repair-modal").classList.remove("hidden");
    setTimeout(() => document.getElementById("repair-customer")?.focus(), 80);
}


// Por defecto nombre y teléfono son obligatorios. Cada uno tiene su propio check de anónimo;
// el cliente es totalmente anónimo solo si se marcan los dos.
const ANONYMOUS_CUSTOMER = 'Cliente Anónimo';

function applyAnonymousRepair() {
    [["repair-anon-name", "repair-customer"], ["repair-anon-phone", "repair-phone"]].forEach(([chkId, inputId]) => {
        const isAnon = !!document.getElementById(chkId)?.checked;
        const input = document.getElementById(inputId);
        if (!input) return;
        input.disabled = isAnon;
        if (isAnon) input.value = "";
    });
}

// Estado con el que nace la reparación (obligatorio elegir uno)
let initialRepairStatus = null;
function setInitialStatus(status) {
    initialRepairStatus = ST.includes(status) ? status : null;
    document.querySelectorAll('#nr-initial-status [data-initial-status]').forEach(b => b.classList.toggle('active', !!initialRepairStatus && b.dataset.initialStatus === initialRepairStatus));
}

async function saveRepair() {
    const anonName = !!document.getElementById("repair-anon-name")?.checked;
    const anonPhone = !!document.getElementById("repair-anon-phone")?.checked;
    const customerName = anonName ? ANONYMOUS_CUSTOMER : document.getElementById("repair-customer")?.value?.trim();
    const phone = anonPhone ? '' : (document.getElementById("repair-phone")?.value?.trim() || '');
    const initialStatus = initialRepairStatus;
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
        showToast("Ingresa el nombre del cliente (o marca \"Nombre anónimo\") y los datos del equipo", "error");
        return;
    }

    if (!anonPhone && !/^\d{9}$/.test(phone)) {
        showToast("El número de celular debe tener exactamente 9 dígitos (o marca \"Teléfono anónimo\")", "error");
        return;
    }

    if (!initialStatus) {
        showToast("Selecciona el estado inicial de la reparación (*)", "error");
        const statusBox = document.getElementById("nr-initial-status");
        if (statusBox) {
            statusBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            statusBox.classList.add("ui-shake");
            setTimeout(() => statusBox.classList.remove("ui-shake"), 500);
        }
        return;
    }

    if (advance > globalTotal) {
        showToast("El adelanto no puede superar el costo total estimado de todos los equipos", "error");
        return;
    }

    // Repuestos: antes se buscaban en `allProducts`, variable que solo existe dentro de sales.js. Aquí siempre
    // era undefined, así que los repuestos se guardaban sin product_id, con costo 0 (ganancia inflada) y
    // SIN descontar stock. Ahora se usan los productos del autocompletado y se valida el stock actual.
    const partIds = [...new Set(itemsData.flatMap(it => it.parts.map(p => p.id)))];
    const productById = new Map();
    if (partIds.length > 0) {
        const { data: freshProds, error: prodErr } = await supabase.from('products').select('id, name, stock, cost_price').in('id', partIds);
        if (prodErr) { showToast("Error verificando stock de repuestos: " + prodErr.message, "error"); return; }
        (freshProds || []).forEach(p => productById.set(String(p.id), p));
        const qtyNeeded = new Map();
        itemsData.forEach(it => it.parts.forEach(p => qtyNeeded.set(String(p.id), (qtyNeeded.get(String(p.id)) || 0) + p.qty)));
        for (const [id, qty] of qtyNeeded) {
            const prod = productById.get(id);
            if (!prod) { showToast("Uno de los repuestos ya no existe en el inventario", "error"); return; }
            if (prod.stock < qty) { showToast(`Stock insuficiente de "${prod.name}" (disponible: ${prod.stock}, requerido: ${qty})`, "error"); return; }
        }
    }

    try {
        const { data: maxRows } = await supabase.from('repairs').select('id').order('id', { ascending: false }).limit(1);
        const maxRow = maxRows && maxRows.length > 0 ? maxRows[0] : null;
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
                remainingAdvance = safeSubtract(remainingAdvance, item.total);
            } else if (remainingAdvance > 0) {
                itemAdvance = remainingAdvance;
                remainingAdvance = 0;
            }

            let itemPartsCost = 0;
            for(const p of item.parts) {
                const prod = productById.get(String(p.id));
                itemPartsCost = safeAdd(itemPartsCost, safeMultiply(prod ? prod.cost_price : 0, p.qty));
            }
            let itemExtCost = item.costs.reduce((sum, c) => safeAdd(sum, c.amount), 0);

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
                remaining_balance: safeSubtract(item.total, itemAdvance),
                internal_parts_cost: itemPartsCost,
                internal_external_cost: itemExtCost,
                net_profit: safeSubtract(safeSubtract(item.total, itemPartsCost), itemExtCost),
                status: initialStatus,
                ...(initialStatus === 'ENTREGADO' ? { delivered_at: new Date().toISOString() } : {})
            });
        }

        const { data: insertedData, error } = await supabase.from('repairs').insert(inserts).select();
        if (error) throw error;

        let partsInserts = [];
        let costsInserts = [];
        let auditInserts = [];
        const runningStock = new Map([...productById].map(([id, p]) => [id, p.stock]));

        for (let i = 0; i < insertedData.length; i++) {
            const row = insertedData[i];
            const item = itemsData[i];

            statusHistoryInserts.push({
                repair_id: row.id,
                status: initialStatus,
                changed_by: operator,
                notes: initialStatus === 'PENDIENTE' ? 'Registro inicial' : `Registro inicial como ${LBL[initialStatus].toLowerCase()}`
            });

            // Prepare parts inserts and stock updates
            for (const p of item.parts) {
                const prod = productById.get(String(p.id));
                partsInserts.push({
                    repair_id: row.id,
                    product_id: prod ? prod.id : null,
                    product_name: p.name,
                    quantity: p.qty,
                    unit_cost: prod ? parseFloat(prod.cost_price) : 0,
                    total_cost: safeMultiply(prod ? prod.cost_price : 0, p.qty)
                });

                if (prod) {
                    const previous = runningStock.get(String(prod.id));
                    runningStock.set(String(prod.id), previous - p.qty);
                    auditInserts.push({
                        product_id: prod.id,
                        product_name: prod.name,
                        quantity_change: -p.qty,
                        previous_stock: previous,
                        new_stock: previous - p.qty,
                        operator_name: operator,
                        movement_type: 'USO_EN_REPARACION',
                        reference_id: row.id,
                        reference_code: row.ticket_code,
                        notes: `Repuesto en Reparación (Ticket: ${row.ticket_code})`
                    });
                }
            }

            // Prepare costs inserts
            for (const c of item.costs) {
                costsInserts.push({
                    repair_id: row.id,
                    concept: c.description,
                    cost_amount: c.amount,
                    payment_method: 'Caja'
                });
            }
        }

        const tasks = [supabase.from('repair_status_history').insert(statusHistoryInserts)];
        if (partsInserts.length > 0) tasks.push(supabase.from('repair_parts_used').insert(partsInserts));
        if (costsInserts.length > 0) tasks.push(supabase.from('repair_external_costs').insert(costsInserts));
        // Antes: upsert({id, stock}) que en SQLite hacía INSERT OR REPLACE (fallaba por columnas NOT NULL)
        for (const [id, stock] of runningStock) {
            if (stock !== productById.get(id).stock) tasks.push(supabase.from('products').update({ stock }).eq('id', Number(id)));
        }
        if (auditInserts.length > 0) tasks.push(supabase.from('stock_audit').insert(auditInserts));

        const results = await Promise.all(tasks);
        const failed = results.find(r => r?.error);
        if (failed) {
            console.error("Error guardando detalles de la reparación:", failed.error);
            showToast("La reparación se registró, pero hubo un error guardando repuestos/costos: " + failed.error.message, "error");
        }

        closeNewRepairModal();
        window.lastRepairGroupTicket = groupTicket;
        window.lastRepairInserts = insertedData && insertedData.length ? insertedData : inserts;
        const totalGeneral = inserts.reduce((acc, r) => safeAdd(acc, parseFloat(r.total_amount) || 0), 0);
        showToast(`Reparación ${groupTicket} registrada · ${money(totalGeneral, 0)}`);
        printGroupReceipt(groupTicket, window.lastRepairInserts);

        await loadAllRepairs();
        renderRepairs();
        const card = document.querySelector(`.rep-card[data-ticket="${CSS.escape(groupTicket)}"]`);
        card?.animate && card.animate([{ opacity: 0, transform: 'translateY(-30px) scale(.9)' }, { opacity: 1, transform: 'translateY(4px) scale(1.02)' }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });

    } catch (e) {
        console.error(e);
        showToast("Error al registrar", "error");
    }
}

const ST_DESC = {
    PENDIENTE: 'Recibido, aún sin revisar',
    EN_DIAGNOSTICO: 'Evaluando la falla',
    EN_PROCESO: 'Reparación en curso',
    TERMINADO: 'Listo para entregar · habilita la boleta final',
    ENTREGADO: 'El cliente recogió el equipo'
};

function repairLabel(id, ticketCode) {
    const r = allRepairs.find(x => x.id === id);
    if (!r) return ticketCode || '';
    const group = allRepairs.filter(x => groupKey(x) === groupKey(r)).sort((a, b) => a.id - b.id);
    const n = group.findIndex(x => x.id === id) + 1;
    return [groupKey(r), group.length > 1 ? `#${n}` : null, r.brand_model || r.equipment_type].filter(Boolean).join(' · ');
}

function openChangeStatus(repairId, ticketCode, currentStatus) {
    currentRepairId = repairId;
    document.getElementById("change-status-ticket").textContent = repairLabel(repairId, ticketCode);
    const select = document.getElementById("new-status-select");
    select.value = currentStatus;
    document.getElementById("status-notes").value = '';
    const host = document.getElementById("cs-options");
    const render = () => {
        host.innerHTML = ST.map(k => `<button type="button" class="cs-opt ${select.value === k ? 'sel' : ''}" data-cs="${k}">
            <span class="dot" style="background:${COL[k]}"></span>
            <span class="txt"><b>${LBL[k]}</b><small>${ST_DESC[k]}</small></span>
            ${k === currentStatus ? '<span class="cur">Actual</span>' : ''}
            ${select.value === k ? `<span class="chk">${icon('check', 12, 3)}</span>` : ''}
        </button>`).join('');
        const btn = document.getElementById("confirm-status-btn");
        if (btn) btn.textContent = select.value === currentStatus ? 'Sin cambios' : `Cambiar a ${LBL[select.value].toLowerCase()}`;
        host.querySelectorAll('[data-cs]').forEach(b => b.addEventListener('click', () => { select.value = b.dataset.cs; render(); }));
    };
    render();
    document.getElementById("change-status-modal").classList.remove("hidden");
}

async function confirmChangeStatus() {
    const newStatus = document.getElementById("new-status-select")?.value;
    const notes = document.getElementById("status-notes")?.value?.trim() || '';
    if (!currentRepairId || !newStatus) return;
    document.getElementById("change-status-modal").classList.add("hidden");
    const cur = allRepairs.find(x => x.id === currentRepairId)?.status;
    if (newStatus === cur && !notes) return;
    await updateRepairStatus([currentRepairId], newStatus, notes);
}

let historyPhotos = [];
let historyRepairId = null;
let historyTicket = '';

async function openHistory(repairId, ticketCode) {
    historyRepairId = repairId;
    historyTicket = ticketCode;
    const r = allRepairs.find(x => x.id === repairId);
    const head = document.getElementById("hm-head");
    if (head) head.className = `hm-head st-head-${r?.status || 'PENDIENTE'}`;
    document.getElementById("history-modal-ticket").textContent = `Ticket ${repairLabel(repairId, ticketCode).replace(/ · [^·]*$/, '')}`;
    document.getElementById("hm-title").textContent = r ? [r.brand_model || r.equipment_type, r.fault_description].filter(Boolean).join(' · ') : 'Historial';
    document.getElementById("hm-sub").textContent = r ? [r.customer_name, r.customer_phone].filter(Boolean).join(' · ') : '';
    const timeline = document.getElementById("history-timeline");
    const gallery = document.getElementById("repair-photos-gallery");
    timeline.innerHTML = '<div class="ui-empty">Cargando…</div>';
    if (gallery) gallery.innerHTML = '';
    document.getElementById("history-modal").classList.remove("hidden");

    try {
        const [historyRes, imagesRes] = await Promise.all([
            supabase.from('repair_status_history').select('*').eq('repair_id', repairId).order('changed_at', { ascending: true }),
            supabase.from('repair_images').select('*').eq('repair_id', repairId).order('created_at', { ascending: false })
        ]);
        const data = historyRes.data;
        historyPhotos = imagesRes.data || [];

        const count = document.getElementById("hm-photo-count");
        if (count) count.textContent = historyPhotos.length === 1 ? '1 foto' : `${historyPhotos.length} fotos`;
        if (gallery) {
            gallery.innerHTML = historyPhotos.map((img, i) => `
                <button class="hm-photo" data-photo="${i}" style="background-image:url('${escAttr(img.image_url)}')"><span>${fmtDay(img.created_at)}</span></button>`).join('') + `
                <button class="hm-add" onclick="triggerCamera(${repairId})"><span class="ic">${icon('M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 17, 2)}</span>Tomar foto</button>`;
            gallery.querySelectorAll('[data-photo]').forEach(b => b.addEventListener('click', () => openPhotoAt(parseInt(b.dataset.photo))));
        }

        if (!data || data.length === 0) { timeline.innerHTML = '<div class="ui-empty">Sin historial</div>'; return; }
        timeline.innerHTML = data.map((h, i) => {
            const last = i === data.length - 1;
            const d = parseDate(h.changed_at);
            const c = COL[h.status] || '#b9b3a8';
            return `<div class="hm-step">
                <div class="rail"><span class="dot" style="background:${c};box-shadow:0 0 0 4px var(--sheet-bg),0 0 0 5px ${last ? c : 'transparent'}"></span>${last ? '' : '<span class="line"></span>'}</div>
                <div class="body">
                    <span class="row"><b>${LBL[h.status] || esc(h.status)}</b><small>${d ? `${fmtDay(d)} · ${fmtTime(d)}` : ''}</small></span>
                    <span class="by">por ${esc(h.changed_by || '—')}</span>
                    ${h.notes ? `<span class="note">${esc(h.notes)}</span>` : ''}
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        timeline.innerHTML = '<div class="auth-error">Error al cargar el historial</div>';
    }
}

// ═══ Visor de fotos con navegación ═══
let photoIdx = 0;

function openPhotoAt(i) {
    if (!historyPhotos.length) return;
    photoIdx = (i + historyPhotos.length) % historyPhotos.length;
    const img = historyPhotos[photoIdx];
    const r = allRepairs.find(x => x.id === historyRepairId);
    document.getElementById('photo-preview-img').src = img.image_url;
    document.getElementById('photo-preview-dl').href = img.image_url;
    document.getElementById('pv-title').textContent = [historyTicket, r?.brand_model].filter(Boolean).join(' · ');
    const d = parseDate(img.created_at);
    document.getElementById('pv-meta').textContent = `${photoIdx + 1} de ${historyPhotos.length}${d ? ` · ${fmtDay(d)}, ${fmtTime(d)}` : ''}`;
    const many = historyPhotos.length > 1;
    document.getElementById('pv-prev').style.display = many ? '' : 'none';
    document.getElementById('pv-next').style.display = many ? '' : 'none';
    document.getElementById('pv-dots').innerHTML = many ? historyPhotos.map((_, k) => `<span class="${k === photoIdx ? 'on' : ''}"></span>`).join('') : '';
    document.getElementById('photo-preview-modal').classList.remove('hidden');
}

if (!window._photoNavBound) {
    window._photoNavBound = true;
    document.getElementById('pv-prev')?.addEventListener('click', () => openPhotoAt(photoIdx - 1));
    document.getElementById('pv-next')?.addEventListener('click', () => openPhotoAt(photoIdx + 1));
    document.addEventListener('keydown', e => {
        if (document.getElementById('photo-preview-modal')?.classList.contains('hidden')) return;
        if (e.key === 'ArrowLeft') openPhotoAt(photoIdx - 1);
        if (e.key === 'ArrowRight') openPhotoAt(photoIdx + 1);
    });
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
            dropdown.innerHTML = `<div class="ui-empty" style="padding:14px">No se encontraron repuestos con "${esc(query)}"</div>`;
        } else {
            dropdown.innerHTML = matches.map(p => `
                <div class="autocomplete-item rc-opt" data-id="${p.id}">
                    <span class="ui-cell-2"><span>${esc(p.name)}</span><small>${esc(p.code || '')}${p.brand ? ' · ' + esc(p.brand) : ''}</small></span>
                    <span style="display:flex;gap:10px;align-items:center;flex-shrink:0"><span class="pos-stock ${p.stock <= (p.min_stock || 0) ? 'warn' : 'ok'}">Stock ${p.stock}</span><span class="tnum">${money(p.cost_price || 0)}</span></span>
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
        searchInput.value = `${prod.name} · ${money(prod.cost_price || 0)}`;
    }
    if (dropdown) dropdown.classList.add("hidden");
    const qtyInput = document.getElementById("repair-part-qty");
    if (qtyInput) qtyInput.focus();
}

async function openRepairCostsModal(repairId, ticketCode) {
    currentRepairId = repairId;
    currentRepairTicket = ticketCode;
    const rr = allRepairs.find(x => x.id === repairId);
    document.getElementById("repair-costs-ticket").textContent = [repairLabel(repairId, ticketCode), rr?.customer_name].filter(Boolean).join(' · ');
    if (!window._rcPayBound) {
        window._rcPayBound = true;
        document.querySelectorAll('#rc-pay-chips [data-rc-pay]').forEach(b => b.addEventListener('click', () => {
            document.querySelectorAll('#rc-pay-chips [data-rc-pay]').forEach(x => x.classList.toggle('active', x === b));
            document.getElementById('external-cost-payment').value = b.dataset.rcPay;
        }));
    }
    document.getElementById("repair-costs-id").value = repairId;
    
    // Cargar repuestos con stock disponible en memoria e inicializar autocomplete
    try {
        const { data: prods } = await supabase.from('products').select('*').gt('stock', 0).eq('is_active', 1).order('name');
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
        document.getElementById("cost-summary-client").textContent = money(totalClient);
        document.getElementById("cost-summary-parts").textContent = `− ${money(totalPartsCost)}`;
        document.getElementById("cost-summary-external").textContent = `− ${money(totalExternalCost)}`;
        const profEl = document.getElementById("cost-summary-profit");
        profEl.textContent = money(netProfit);
        profEl.style.color = netProfit >= 0 ? "var(--blue-soft)" : "var(--orange-soft)";
        const mg = document.getElementById("cost-summary-margin");
        if (mg) mg.textContent = totalClient > 0 ? `${Math.round(netProfit / totalClient * 100)}%` : '—';
        const mix = document.getElementById("rc-mix");
        if (mix) {
            const seg = [[totalPartsCost, 'var(--orange)'], [totalExternalCost, 'var(--yellow)'], [Math.max(0, netProfit), 'var(--blue-soft)']].filter(x => x[0] > 0);
            mix.innerHTML = seg.length ? seg.map(([v, c]) => `<span style="flex:${v};background:${c}"></span>`).join('') : '<span style="flex:1;background:rgba(255,255,255,.12)"></span>';
        }

        // Guardar costos calculados en la tabla repairs en segundo plano
        supabase.from('repairs').update({
            internal_parts_cost: totalPartsCost,
            internal_external_cost: totalExternalCost,
            net_profit: netProfit
        }).eq('id', repairId).then();

        const xBtn = (onclick, title) => `<button onclick="${onclick}" class="ui-icon-btn xs" title="${title}">${icon('close', 12, 2.2)}</button>`;
        const partsHost = document.getElementById("repair-parts-tbody");
        if (partsHost) {
            partsHost.innerHTML = (parts && parts.length > 0) ? parts.map(p => `
                <div class="rc-item">
                    <span class="ui-cell-2"><span>${esc(p.product_name)}</span><small>${fmtDay(p.added_at)}</small></span>
                    <span class="r muted">×${p.quantity}</span>
                    <span class="r tnum">${money(p.total_cost)}</span>
                    ${xBtn(`removeRepairPart(${p.id}, ${p.product_id}, ${p.quantity}, ${repairId})`, 'Quitar repuesto')}
                </div>`).join('') : '<div class="ui-empty" style="padding:16px">Sin repuestos asignados</div>';
        }
        const extHost = document.getElementById("repair-external-tbody");
        if (extHost) {
            extHost.innerHTML = (external && external.length > 0) ? external.map(e => `
                <div class="rc-item ext">
                    <span class="ui-cell-2"><span>${esc(e.concept)}</span><small>${fmtDay(e.recorded_at)}</small></span>
                    <span class="muted">${esc(e.payment_method === 'Yape/Plin' ? 'Yape / Plin' : (e.payment_method || 'Caja'))}</span>
                    <span class="r tnum">${money(e.cost_amount)}</span>
                    ${xBtn(`removeExternalCost(${e.id}, ${repairId})`, 'Quitar pago')}
                </div>`).join('') : '<div class="ui-empty" style="padding:16px">Sin costos externos</div>';
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
    if (!confirm("⚠️ ¿Estás seguro de que deseas ELIMINAR TODAS las reparaciones y su historial? Esta acción es definitiva (te recomendamos exportar un backup antes).")) return;
    try {
        await supabase.from('repair_parts_used').delete().neq('id', 0);
        await supabase.from('repair_external_costs').delete().neq('id', 0);
        await supabase.from('repair_status_history').delete().neq('id', 0);
        await supabase.from('repair_images').delete().neq('id', ''); // también referencia a repairs (FOREIGN KEY)
        const { error } = await supabase.from('repairs').delete().neq('id', 0);
        if (error) throw error;
        showToast("Todas las reparaciones han sido eliminadas exitosamente.");
        setTimeout(() => location.reload(), 1500);
    } catch (e) {
        console.error("Error al borrar reparaciones:", e);
        showToast("Error al borrar reparaciones: " + (e.message || "error desconocido"), "error");
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
                movement_type: 'DEVOLUCION_CLIENTE', // 'DEVOLUCION_TALLER' no está permitido por el CHECK de la tabla y el registro se perdía
                reference_id: repairId,
                reference_code: currentRepairTicket,
                notes: `Devolución por retiro de repuesto en reparación (Ticket: ${currentRepairTicket})`
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
    const sorted = [...records].sort((a, b) => (a.id || 0) - (b.id || 0));
    printHtml(repairReceiptHtml(groupTicket, sorted), () => showToast('Error al imprimir el ticket', 'error'));
}

// ═══ Realtime Sync ═══
window.addEventListener('supabase_realtime', async (e) => {
    const table = e.detail.table;
    if (document.querySelector('.nav-item[data-view="repairs"]')?.classList.contains('active') || document.querySelector('.mobile-nav-item[data-target="repairs"]')?.classList.contains('active')) {
        if (table === 'repairs' || table === 'repair_costs' || table === 'repair_images') {
            await loadListsForRepairs();
            await loadAllRepairs();
            renderRepairs();
        }
    }
});
// ═══ CLOUDINARY & CAMERA INTEGRATION ═══
window.currentPhotoRepairId = null;

window.triggerCamera = function(repairId) {
    window.currentPhotoRepairId = repairId;
    const input = document.getElementById('global-camera-input');
    if(input) input.click();
};

document.getElementById('global-camera-input')?.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if(!file) return;
    if(!window.currentPhotoRepairId) return;

    const loaderModal = document.getElementById('upload-loader-modal');
    const setUp = (pct, step) => {
        const bar = document.getElementById('upload-bar'); if (bar) bar.style.width = `${pct}%`;
        const p = document.getElementById('upload-pct'); if (p) p.textContent = `${Math.round(pct)}%`;
        if (step) { const st = document.getElementById('upload-step'); if (st) st.textContent = step; }
    };
    const url = URL.createObjectURL(file);
    const thumb = document.getElementById('upload-thumb');
    if (thumb) thumb.style.backgroundImage = `url('${url}')`;
    const meta = document.getElementById('upload-meta');
    if (meta) meta.textContent = [historyTicket, file.name, `${(file.size / 1048576).toFixed(1)} MB`].filter(Boolean).join(' · ');
    setUp(4, 'Comprimiendo');
    if(loaderModal) loaderModal.classList.remove('hidden');
    
    try {
        const img = new Image();
        
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
        });
        
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200;
        let width = img.width;
        let height = img.height;
        
        if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
        setUp(25, 'Subiendo');
        
        const formData = new FormData();
        formData.append('file', blob, 'photo_' + Date.now() + '.jpg');
        formData.append('upload_preset', 'repair_photos');
        
        // XHR en lugar de fetch para poder mostrar el progreso real de la subida
        const data = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', 'https://api.cloudinary.com/v1_1/nfylq8fc/image/upload');
            xhr.upload.onprogress = ev => { if (ev.lengthComputable) setUp(25 + ev.loaded / ev.total * 70); };
            xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch (err) { reject(err); } };
            xhr.onerror = () => reject(new Error('Error de red al subir la foto'));
            xhr.send(formData);
        });
        setUp(100, 'Listo');
        if(!data.secure_url) throw new Error("No se pudo obtener URL de Cloudinary");
        
        const { error } = await supabase.from('repair_images').insert({
            repair_id: window.currentPhotoRepairId,
            image_url: data.secure_url
        });
        
        if(error) throw error;
        
        showToast("Foto subida exitosamente", "success");
        
        // Auto-refresh gallery if history is open
        const historyModal = document.getElementById("history-modal");
        if(historyModal && !historyModal.classList.contains("hidden")) {
            openHistory(window.currentPhotoRepairId, historyTicket);
        }
        
        // Optimistic refresh of the main table to show the 🖼️ badge immediately
        await loadAllRepairs();
        renderRepairs();
        
    } catch (err) {
        console.error(err);
        showToast("Error al subir foto", "error");
    } finally {
        e.target.value = '';
        URL.revokeObjectURL(url);
        if(loaderModal) loaderModal.classList.add('hidden');
    }
});

window.openPhotoPreview = function(url) {
    const i = historyPhotos.findIndex(p => p.image_url === url);
    if (i >= 0) return openPhotoAt(i);
    historyPhotos = [{ image_url: url }];
    openPhotoAt(0);
};
