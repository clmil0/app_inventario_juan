// Reparación express: arreglo rápido que se cobra y entrega al momento (cliente anónimo, sin equipo ni falla).
// Solo pide un título opcional, el precio (o un atajo configurado en Administración), cómo pagó y quién atendió.
import { getSession, showToast } from './supabase.js';
import { esc, money, openModal, closeModal, shake } from './ui.js';

const MODAL_ID = 'express-repair-modal';
const PAY = [['Caja', 'Efectivo'], ['Yape/Plin', 'Yape / Plin'], ['Transferencia', 'Transferencia'], ['POS', 'Tarjeta']];
// Las mismas personas que en "Nueva reparación" (radios del modal principal)
const operators = () => [...document.querySelectorAll('input[name="repair-active-seller"]')].map(r => r.value).filter(Boolean);

const isAdmin = () => getSession()?.profile?.role === 'admin';

let state = { pay: '', op: '' };

export async function openExpressRepair({ onSaved, printReceipt } = {}) {
    let shortcuts = [];
    try {
        const r = await fetch('/api/admin/express-shortcuts');
        if (r.ok) shortcuts = await r.json();
    } catch { /* sin atajos */ }

    const ops = operators();
    state = { pay: '', op: '' }; // nada preseleccionado: hay que elegir pago y vendedor

    const modal = openModal(MODAL_ID, {
        label: 'Se cobra y entrega al momento', title: 'Reparación express', width: 540, cls: 'xr-modal',
        body: `
        <input type="text" id="xr-title" class="ui-field lg" maxlength="120" placeholder="Título (opcional) · ej. Cambio de pin de carga" autocomplete="off">
        <div class="xr-block">
            <span class="xr-h">Atajos</span>
            ${shortcuts.length ? `<div class="xr-shortcuts">${shortcuts.map(s => `
                <button type="button" class="xr-sc" data-title="${esc(s.title)}" data-price="${s.price}">
                    <span>${esc(s.title)}</span><b>${money(s.price, Number.isInteger(Number(s.price)) ? 0 : 2)}</b>
                </button>`).join('')}</div>`
                : `<span class="xr-empty">No hay atajos todavía.${isAdmin() ? ' Créalos en Administración → Configuración → Reparación express.' : ' El administrador puede crearlos en Configuración.'}</span>`}
        </div>
        <div class="xr-row">
            <div class="xr-block" style="flex:1 1 180px">
                <span class="xr-h">Precio</span>
                <label class="xr-price"><span>S/</span><input type="number" id="xr-price" min="0.10" step="0.50" placeholder="0.00" inputmode="decimal"></label>
            </div>
            <div class="xr-block" style="flex:1.4 1 240px">
                <span class="xr-h">¿Cómo pagó?</span>
                <div class="xr-opts" id="xr-pay">${PAY.map(([v, l]) => `<button type="button" class="ui-chip ${v === state.pay ? 'active' : ''}" data-pay="${v}">${l}</button>`).join('')}</div>
            </div>
        </div>
        <div class="xr-block" id="xr-op-block">
            <span class="xr-h">Atendido por</span>
            <div class="xr-opts" id="xr-op">${ops.map(o => `<button type="button" class="ui-chip ${o === state.op ? 'active' : ''}" data-op="${esc(o)}">${esc(o)}</button>`).join('')}</div>
        </div>
        <div class="xr-actions">
            <button type="button" class="ui-pill outline" id="xr-save">Guardar reparación</button>
            <button type="button" class="ui-pill" id="xr-save-print">Guardar y generar recibo</button>
        </div>`
    });

    const titleEl = modal.querySelector('#xr-title');
    const priceEl = modal.querySelector('#xr-price');
    const syncButtons = () => {
        const p = parseFloat(priceEl.value);
        const label = p > 0 ? ` · ${money(p)}` : '';
        modal.querySelector('#xr-save-print').textContent = `Guardar y generar recibo${label}`;
    };
    modal.querySelectorAll('.xr-sc').forEach(b => b.addEventListener('click', () => {
        modal.querySelectorAll('.xr-sc').forEach(x => x.classList.toggle('active', x === b));
        titleEl.value = b.dataset.title;
        priceEl.value = b.dataset.price;
        syncButtons();
    }));
    // Si cambian el texto o el precio a mano, el atajo deja de estar "seleccionado"
    [titleEl, priceEl].forEach(el => el.addEventListener('input', () => {
        modal.querySelectorAll('.xr-sc.active').forEach(x => {
            if (x.dataset.title !== titleEl.value || Number(x.dataset.price) !== parseFloat(priceEl.value)) x.classList.remove('active');
        });
        syncButtons();
    }));
    modal.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => {
        state.pay = b.dataset.pay;
        modal.querySelectorAll('[data-pay]').forEach(x => x.classList.toggle('active', x === b));
    }));
    modal.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => {
        state.op = b.dataset.op;
        modal.querySelectorAll('[data-op]').forEach(x => x.classList.toggle('active', x === b));
    }));
    const submit = async (withReceipt) => {
        const price = parseFloat(priceEl.value);
        if (!(price > 0)) { showToast('Ingresa el precio (o elige un atajo)', 'error'); shake(priceEl.closest('.xr-price')); priceEl.focus(); return; }
        if (!state.pay) { showToast('Elige cómo pagó el cliente', 'error'); shake(modal.querySelector('#xr-pay')); return; }
        if (!state.op) { showToast('Elige quién atendió', 'error'); shake(modal.querySelector('#xr-op-block')); return; }
        const btns = modal.querySelectorAll('.xr-actions button');
        btns.forEach(b => { b.disabled = true; });
        try {
            const r = await fetch('/api/repairs/express', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: titleEl.value, price, payment_method: state.pay, operator_name: state.op })
            });
            const res = await r.json().catch(() => ({}));
            if (!r.ok || !res.success) throw new Error(res.error || 'No se pudo guardar');
            closeModal(MODAL_ID);
            showToast(`Reparación express ${res.data.ticket_code} registrada · ${money(price)}`);
            if (withReceipt && printReceipt) printReceipt(res.data);
            onSaved && onSaved(res.data);
        } catch (e) {
            btns.forEach(b => { b.disabled = false; });
            showToast(e.message, 'error');
        }
    };
    modal.querySelector('#xr-save').addEventListener('click', () => submit(false));
    modal.querySelector('#xr-save-print').addEventListener('click', () => submit(true));
    priceEl.addEventListener('keydown', e => { if (e.key === 'Enter') submit(true); });
    setTimeout(() => titleEl.focus(), 60);
}
