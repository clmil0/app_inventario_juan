// Administración → Configuración: copia de seguridad por módulos, reinicio de datos (ventas / reparaciones /
// caja), atajos de reparación express e impresión de tickets.
import { getSession, clearSession, showToast } from './supabase.js';
import { esc, openModal, closeModal } from './ui.js';
import { PRINT_SETTINGS, canPrintDirect } from './receipts.js';
import { initReceiptDesigner, designerPresetName } from './receipt_designer.js';

const MODULES = {
    config: { label: 'Productos y configuración', desc: 'Productos, stock, categorías, precios, catálogo de equipos y fallas, usuarios, atajos express y fotos de productos' },
    sales: { label: 'Ventas', desc: 'Historial de ventas con sus productos' },
    repairs: { label: 'Reparaciones', desc: 'Tickets, estados, repuestos usados, gastos a terceros y sus fotos y videos' },
    cash: { label: 'Caja y retiros', desc: 'Retiros de dinero y fondos iniciales de caja' }
};
const MODULE_KEYS = Object.keys(MODULES);
const CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';

const operatorName = () => {
    const p = getSession()?.profile;
    return p?.username || 'Administrador';
};

function optRow({ name, value, title, desc, count, checked, type = 'checkbox', disabled = false }) {
    return `<label class="dt-opt${disabled ? ' disabled' : ''}">
        <input type="${type}" name="${name}" value="${value}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="box">${CHECK_SVG}</span>
        <span class="txt"><b>${esc(title)}</b>${desc ? `<small>${esc(desc)}</small>` : ''}</span>
        ${count !== undefined ? `<span class="cnt">${esc(count)}</span>` : ''}
    </label>`;
}

const checkedValues = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);

async function fetchPreview() {
    try {
        const r = await fetch('/api/maintenance/preview');
        return r.ok ? await r.json() : null;
    } catch { return null; }
}

function setFeedback(id, msg, type) {
    const fb = document.getElementById(id);
    if (!fb) return;
    fb.className = `feedback-msg ${type || ''}`;
    fb.textContent = msg;
    fb.classList.toggle('hidden', !msg);
}

// ═════════════ EXPORTAR ═════════════
async function openExportModal() {
    const pv = await fetchPreview();
    const counts = {
        config: pv ? `${pv.kept.products} productos` : '',
        sales: pv ? `${pv.sales.count} ventas` : '',
        repairs: pv ? `${pv.repairs.count} tickets` : '',
        cash: pv ? `${pv.cash.count} retiros` : ''
    };
    const modal = openModal('dt-export-modal', {
        label: 'Copia de seguridad', title: 'Exportar datos', width: 560,
        body: `
        <p class="dt-note">Elige qué exportar. Puedes sacar <b>todo</b> o solo una parte (por ejemplo, solo las ventas) para guardarla o pasarla a otra PC.</p>
        <div class="dt-opts">
            ${optRow({ name: 'dt-exp-all', value: 'all', title: 'Todo (backup completo)', desc: 'Recomendado para guardar en un USB o en la nube', checked: true })}
            <div class="dt-sep"></div>
            ${MODULE_KEYS.map(m => optRow({ name: 'dt-exp', value: m, title: MODULES[m].label, desc: MODULES[m].desc, count: counts[m], checked: true })).join('')}
        </div>
        <p class="dt-note small">El archivo contiene las contraseñas de los usuarios si incluye "Productos y configuración". Las fotos y videos van dentro del archivo.</p>
        <div class="dt-actions">
            <button class="ui-pill outline" data-close-modal="dt-export-modal">Cancelar</button>
            <button class="ui-pill" id="dt-export-go">Exportar</button>
        </div>`
    });
    const all = modal.querySelector('input[name="dt-exp-all"]');
    const items = [...modal.querySelectorAll('input[name="dt-exp"]')];
    const sync = () => {
        const n = items.filter(i => i.checked).length;
        all.checked = n === items.length;
        modal.querySelector('#dt-export-go').disabled = n === 0;
        modal.querySelector('#dt-export-go').textContent = n === items.length ? 'Exportar todo' : n === 0 ? 'Elige qué exportar' : `Exportar ${n === 1 ? MODULES[checkedValues(modal, 'dt-exp')[0]].label.toLowerCase() : n + ' módulos'}`;
    };
    all.addEventListener('change', () => { items.forEach(i => { i.checked = all.checked; }); sync(); });
    items.forEach(i => i.addEventListener('change', sync));
    sync();
    modal.querySelector('#dt-export-go').addEventListener('click', () => exportModules(checkedValues(modal, 'dt-exp')));
}

async function exportModules(modules) {
    const btn = document.getElementById('dt-export-go');
    if (btn) { btn.disabled = true; btn.textContent = 'Exportando...'; }
    try {
        const qs = modules.length === MODULE_KEYS.length ? '' : `?modules=${modules.join(',')}`;
        const response = await fetch('/api/backup/export' + qs);
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Error del servidor (${response.status})`);
        }
        const disposition = response.headers.get('Content-Disposition') || '';
        const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || 'inventario-backup.json';
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        const mb = blob.size / 1048576;
        closeModal('dt-export-modal');
        setFeedback('backup-feedback', `✅ Exportado: ${fileName} (${mb < 1 ? '<1' : mb.toFixed(0)} MB)`, 'success');
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Reintentar'; }
        showToast('No se pudo exportar: ' + e.message, 'error');
    }
}

// ═════════════ IMPORTAR ═════════════
async function openImportModal(file) {
    let backup;
    try {
        backup = JSON.parse(await file.text());
    } catch {
        setFeedback('backup-feedback', '❌ El archivo no es un JSON válido', 'error');
        return;
    }
    if (backup?.format !== 'inventario-juan-backup' || !backup.tables) {
        setFeedback('backup-feedback', '❌ El archivo no es un backup de Inventario Juan', 'error');
        return;
    }
    const inFile = Array.isArray(backup.modules) ? MODULE_KEYS.filter(m => backup.modules.includes(m)) : [...MODULE_KEYS];
    const n = t => Array.isArray(backup.tables[t]) ? backup.tables[t].length : 0;
    const counts = {
        config: `${n('products')} productos`,
        sales: `${n('sales')} ventas`,
        repairs: `${n('repairs')} tickets`,
        cash: `${n('cash_movements')} retiros`
    };
    const fecha = backup.exported_at ? new Date(backup.exported_at).toLocaleString('es-PE') : 'fecha desconocida';
    backup = null; // liberar memoria: se envía el archivo original

    const modal = openModal('dt-import-modal', {
        label: `Archivo del ${fecha}`, title: 'Importar datos', width: 560,
        body: `
        <p class="dt-note">Marca lo que quieres restaurar. <b>Solo se reemplaza lo marcado</b>; lo demás se queda como está.</p>
        <div class="dt-opts">
            ${MODULE_KEYS.map(m => optRow({
                name: 'dt-imp', value: m, title: MODULES[m].label,
                desc: inFile.includes(m) ? MODULES[m].desc : 'No viene en este archivo',
                count: inFile.includes(m) ? counts[m] : '—', checked: inFile.includes(m), disabled: !inFile.includes(m)
            })).join('')}
        </div>
        <div class="dt-warn" id="dt-imp-warn"></div>
        <p class="dt-note small">Antes de importar se guarda automáticamente una copia de los datos actuales en la carpeta "backups".</p>
        <div class="dt-actions">
            <button class="ui-pill outline" data-close-modal="dt-import-modal">Cancelar</button>
            <button class="ui-pill orange" id="dt-import-go">Importar</button>
        </div>`
    });
    const sync = () => {
        const sel = checkedValues(modal, 'dt-imp');
        const notes = [];
        if (sel.length) notes.push(`Se borrarán ${sel.map(m => MODULES[m].label.toLowerCase()).join(', ')} actuales y se pondrán los del archivo.`);
        if (!sel.includes('config') && (sel.includes('sales') || sel.includes('repairs'))) {
            notes.push('El stock actual NO cambia: las ventas y repuestos importados son historial. Se enlazan a tus productos por su código.');
        }
        if (sel.includes('config') && !(sel.includes('sales') && sel.includes('repairs'))) {
            notes.push('Tus ventas y reparaciones actuales se conservan y se vuelven a enlazar a los productos por su código.');
        }
        modal.querySelector('#dt-imp-warn').innerHTML = notes.map(t => `<span>${esc(t)}</span>`).join('');
        const go = modal.querySelector('#dt-import-go');
        go.disabled = sel.length === 0;
        go.textContent = sel.length === inFile.length && sel.length === MODULE_KEYS.length ? 'Restaurar todo' : 'Importar lo marcado';
    };
    modal.querySelectorAll('input[name="dt-imp"]').forEach(i => i.addEventListener('change', sync));
    sync();
    modal.querySelector('#dt-import-go').addEventListener('click', () => importModules(file, checkedValues(modal, 'dt-imp')));
}

async function importModules(file, modules) {
    const btn = document.getElementById('dt-import-go');
    if (btn) { btn.disabled = true; btn.textContent = 'Importando...'; }
    try {
        const response = await fetch(`/api/backup/import?modules=${modules.join(',')}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: file // el archivo tal cual: volver a convertirlo a texto duplicaba la memoria con muchos videos
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.error || `Error del servidor (${response.status})`);
        closeModal('dt-import-modal');
        const extra = result.unmatched_products ? ` ${result.unmatched_products} registros no encontraron su producto (quedan con el nombre guardado).` : '';
        setFeedback('backup-feedback', `✅ Importado: ${modules.map(m => MODULES[m].label).join(', ')}.${extra} Copia previa: ${result.safety_copy}. Recargando...`, 'success');
        // Si cambiaron los usuarios hay que volver a entrar
        if (modules.includes('config')) clearSession();
        setTimeout(() => location.reload(), 2500);
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Reintentar'; }
        showToast(e.message, 'error');
    }
}

// ═════════════ REINICIAR DATOS ═════════════
async function openResetModal() {
    const pv = await fetchPreview();
    if (!pv) { showToast('No se pudo leer el resumen de datos', 'error'); return; }
    const modal = openModal('dt-reset-modal', {
        label: 'Empezar de cero', title: 'Reiniciar datos', width: 600, cls: 'dt-reset',
        body: `
        <p class="dt-note">Borra los movimientos de prueba y empieza limpio. <b>Se conservan</b> tus ${pv.kept.products} productos, ${pv.kept.categories} categorías, ${pv.kept.faults} fallas del catálogo, los usuarios, el historial de precios y las fotos de productos.</p>
        <span class="dt-h">¿Qué quieres borrar?</span>
        <div class="dt-opts">
            ${optRow({ name: 'dt-rst', value: 'sales', title: 'Ventas', desc: 'Todo el historial de ventas y sus boletas', count: `${pv.sales.count} ventas`, disabled: !pv.sales.count })}
            ${optRow({ name: 'dt-rst', value: 'repairs', title: 'Reparaciones', desc: `Tickets, historial de estados, repuestos usados, gastos a terceros${pv.repairs.media ? ` y ${pv.repairs.media} fotos/videos` : ''}`, count: `${pv.repairs.count} tickets`, disabled: !pv.repairs.count })}
            ${optRow({ name: 'dt-rst', value: 'cash', title: 'Retiros de caja', desc: 'Recomendado si borras ventas y reparaciones: los retiros se descuentan de esa ganancia', count: `${pv.cash.count} retiros`, disabled: !pv.cash.count })}
        </div>
        <div id="dt-stock-block" class="hidden" style="display:flex;flex-direction:column;gap:8px">
            <span class="dt-h">¿Qué pasa con el stock? <span id="dt-units" class="dt-units"></span></span>
            <div class="dt-opts">
                ${optRow({ type: 'radio', name: 'dt-stock', value: 'restore', title: 'Devolver las unidades al stock', desc: 'Si fueron pruebas: lo "vendido" y los repuestos "usados" nunca salieron del local. Queda un movimiento "Reinicio de datos" en la auditoría.', checked: true })}
                ${optRow({ type: 'radio', name: 'dt-stock', value: 'keep', title: 'Mantener el stock actual', desc: 'Si esas unidades sí salieron del local (ventas reales que solo quieres sacar del historial).' })}
            </div>
        </div>
        <label class="dt-confirm"><span>Para confirmar escribe <b>BORRAR</b></span><input type="text" id="dt-reset-confirm" class="ui-field" autocomplete="off" placeholder="BORRAR"></label>
        <p class="dt-note small">Antes de borrar se guarda una copia completa en la carpeta "backups" por si necesitas recuperar algo. Te recomendamos además exportar las ventas o reparaciones si quieres conservarlas aparte.</p>
        <div class="dt-actions">
            <button class="ui-pill outline" data-close-modal="dt-reset-modal">Cancelar</button>
            <button class="ui-pill orange" id="dt-reset-go" disabled>Reiniciar</button>
        </div>`
    });
    const sync = () => {
        const sel = checkedValues(modal, 'dt-rst');
        const touchesStock = sel.includes('sales') || sel.includes('repairs');
        modal.querySelector('#dt-stock-block').classList.toggle('hidden', !touchesStock);
        const units = (sel.includes('sales') ? pv.sales.units : 0) + (sel.includes('repairs') ? pv.repairs.units : 0);
        modal.querySelector('#dt-units').textContent = units ? `· ${units} unidades` : '';
        const ok = sel.length > 0 && modal.querySelector('#dt-reset-confirm').value.trim().toUpperCase() === 'BORRAR';
        const go = modal.querySelector('#dt-reset-go');
        go.disabled = !ok;
        go.textContent = sel.length ? `Borrar ${sel.map(m => ({ sales: 'ventas', repairs: 'reparaciones', cash: 'retiros' })[m]).join(' + ')}` : 'Reiniciar';
    };
    modal.querySelectorAll('input[name="dt-rst"]').forEach(i => i.addEventListener('change', sync));
    modal.querySelector('#dt-reset-confirm').addEventListener('input', sync);
    sync();
    modal.querySelector('#dt-reset-go').addEventListener('click', async () => {
        const modules = checkedValues(modal, 'dt-rst');
        const restore = checkedValues(modal, 'dt-stock')[0] !== 'keep';
        const go = modal.querySelector('#dt-reset-go');
        go.disabled = true; go.textContent = 'Borrando...';
        try {
            const r = await fetch('/api/maintenance/reset', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modules, restore_stock: restore, operator_name: operatorName() })
            });
            const res = await r.json().catch(() => ({}));
            if (!r.ok || !res.success) throw new Error(res.error || `Error del servidor (${r.status})`);
            closeModal('dt-reset-modal');
            const stockMsg = res.restored_units ? ` Volvieron ${res.restored_units} unidades al stock de ${res.restored_products} productos.` : '';
            setFeedback('reset-feedback', `✅ Datos reiniciados.${stockMsg} Copia previa: ${res.safety_copy}`, 'success');
            showToast('Datos reiniciados');
            window.dispatchEvent(new Event('products:changed'));
        } catch (e) {
            go.disabled = false; go.textContent = 'Reintentar';
            showToast(e.message, 'error');
        }
    });
}

// ═════════════ ATAJOS DE REPARACIÓN EXPRESS ═════════════
let shortcuts = [];

async function loadShortcuts() {
    try {
        const r = await fetch('/api/admin/express-shortcuts');
        shortcuts = r.ok ? await r.json() : [];
    } catch { shortcuts = []; }
    renderShortcuts();
}

async function shortcutRequest(method, url, body) {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.error || 'Error del servidor');
    return res;
}

function renderShortcuts() {
    renderConfigMenu();
    const host = document.getElementById('express-shortcuts-list');
    if (!host) return;
    if (!shortcuts.length) {
        host.innerHTML = '<div class="ui-empty" style="padding:14px 0">Aún no hay atajos. Agrega los arreglos rápidos que más haces (ej. "Cambio de pin de carga").</div>';
        return;
    }
    host.innerHTML = shortcuts.map((s, i) => `
        <div class="xs-row" data-id="${s.id}">
            <div class="xs-move">
                <button class="ui-icon-btn sm" data-xs-up="${i}" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
                <button class="ui-icon-btn sm" data-xs-down="${i}" ${i === shortcuts.length - 1 ? 'disabled' : ''} title="Bajar">↓</button>
            </div>
            <input type="text" class="ui-field xs-title" value="${esc(s.title)}" maxlength="80" aria-label="Título">
            <label class="xs-price"><span>S/</span><input type="number" class="ui-field xs-amount" value="${s.price}" min="0.10" step="0.50" aria-label="Precio"></label>
            <button class="ui-mini danger" data-xs-del="${s.id}">Quitar</button>
        </div>`).join('');
    host.querySelectorAll('.xs-row').forEach(row => {
        const id = Number(row.dataset.id);
        const save = async () => {
            const title = row.querySelector('.xs-title').value.trim();
            const price = parseFloat(row.querySelector('.xs-amount').value);
            const cur = shortcuts.find(s => s.id === id);
            if (!cur || (cur.title === title && Number(cur.price) === price)) return;
            try {
                await shortcutRequest('PUT', `/api/admin/express-shortcuts/${id}`, { title, price });
                cur.title = title; cur.price = price;
                showToast('Atajo actualizado');
            } catch (e) { showToast(e.message, 'error'); renderShortcuts(); }
        };
        row.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('change', save);
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
        });
    });
    host.querySelectorAll('[data-xs-del]').forEach(b => b.addEventListener('click', async () => {
        try { await shortcutRequest('DELETE', `/api/admin/express-shortcuts/${b.dataset.xsDel}`); await loadShortcuts(); }
        catch (e) { showToast(e.message, 'error'); }
    }));
    const move = async (i, d) => {
        const list = [...shortcuts];
        [list[i], list[i + d]] = [list[i + d], list[i]];
        try { await shortcutRequest('PUT', '/api/admin/express-shortcuts-order', { ids: list.map(s => s.id) }); await loadShortcuts(); }
        catch (e) { showToast(e.message, 'error'); }
    };
    host.querySelectorAll('[data-xs-up]').forEach(b => b.addEventListener('click', () => move(Number(b.dataset.xsUp), -1)));
    host.querySelectorAll('[data-xs-down]').forEach(b => b.addEventListener('click', () => move(Number(b.dataset.xsDown), 1)));
}

async function addShortcut(e) {
    e.preventDefault();
    const t = document.getElementById('xs-new-title'), p = document.getElementById('xs-new-price');
    try {
        await shortcutRequest('POST', '/api/admin/express-shortcuts', { title: t.value, price: parseFloat(p.value) });
        t.value = ''; p.value = '';
        t.focus();
        await loadShortcuts();
    } catch (err) { showToast(err.message, 'error'); }
}

// ═════════════ IMPRESIÓN DE TICKETS ═════════════
async function initPrinterSettings() {
    const direct = document.getElementById('print-direct-toggle');
    const select = document.getElementById('print-device-select');
    const note = document.getElementById('print-note');
    if (!direct || !select) return;
    const desktop = canPrintDirect();
    direct.checked = PRINT_SETTINGS.direct;
    direct.disabled = !desktop;
    select.disabled = !desktop;
    if (!desktop) {
        note.textContent = 'La impresión directa solo funciona en la app de escritorio. En el navegador siempre aparece el diálogo de impresión.';
        select.innerHTML = '<option>Solo en la app de escritorio</option>';
    } else {
        try {
            const printers = await window.electronAPI.listPrinters();
            const def = printers.find(p => p.isDefault);
            select.innerHTML = `<option value="">Predeterminada del sistema${def ? ` (${esc(def.displayName)})` : ''}</option>` +
                printers.map(p => `<option value="${esc(p.name)}">${esc(p.displayName)}</option>`).join('');
            select.value = printers.some(p => p.name === PRINT_SETTINGS.device) ? PRINT_SETTINGS.device : '';
            note.textContent = printers.length ? 'Los tickets y boletas salen directo, sin mostrar el diálogo. Si la impresora falla se abre el diálogo como respaldo.' : 'No se encontró ninguna impresora instalada en esta PC.';
        } catch (e) {
            note.textContent = 'No se pudo leer la lista de impresoras: ' + e.message;
        }
    }
    direct.addEventListener('change', () => { PRINT_SETTINGS.direct = direct.checked; showToast(direct.checked ? 'Impresión directa activada' : 'Se mostrará el diálogo de impresión'); });
    select.addEventListener('change', () => { PRINT_SETTINGS.device = select.value; showToast('Impresora guardada'); });
}

// ═════════════ MENÚ DE CONFIGURACIÓN ═════════════
const CONFIG_GROUPS = [
    ['cuenta', 'Cuenta', () => 'Contraseña', 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
    ['ventas', 'Ventas', () => (document.getElementById('require-sale-confirmation')?.checked ? 'Con confirmación' : 'Sin confirmación'), 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0'],
    ['impresion', 'Impresión', () => `${canPrintDirect() && PRINT_SETTINGS.direct ? 'Directa' : 'Con diálogo'} · ${designerPresetName()}`, 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z'],
    ['reparaciones', 'Reparaciones', () => `${shortcuts.length} atajo${shortcuts.length === 1 ? '' : 's'} express`, 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01'],
    ['datos', 'Datos y respaldo', () => 'Copia, pruebas, reinicio', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12']
];
let configGroup = 'impresion';

function renderConfigMenu() {
    const host = document.getElementById('cfg-menu');
    if (!host) return;
    host.innerHTML = CONFIG_GROUPS.map(([id, label, sub, path]) => `
        <button type="button" class="cfg-item${id === configGroup ? ' active' : ''}" data-cfg-group="${id}">
            <span class="ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"></path></svg></span>
            <span class="tx"><b>${label}</b><small>${esc(sub())}</small></span>
        </button>`).join('');
    document.querySelectorAll('[data-cfg-panel]').forEach(p => p.classList.toggle('active', p.dataset.cfgPanel === configGroup));
}

export function showConfigGroup(id) {
    if (!CONFIG_GROUPS.some(g => g[0] === id)) return;
    configGroup = id;
    renderConfigMenu();
}

export function bindDataTools() {
    document.getElementById('export-backup-btn')?.addEventListener('click', openExportModal);
    document.getElementById('import-backup-btn')?.addEventListener('click', () => {
        const input = document.getElementById('import-backup-file');
        if (input) { input.value = ''; input.click(); }
    });
    document.getElementById('import-backup-file')?.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (file) openImportModal(file);
    });
    document.getElementById('reset-data-btn')?.addEventListener('click', openResetModal);
    document.getElementById('xs-add-form')?.addEventListener('submit', addShortcut);
    document.getElementById('cfg-menu')?.addEventListener('click', e => {
        const item = e.target.closest('[data-cfg-group]');
        if (item) showConfigGroup(item.dataset.cfgGroup);
    });
    document.getElementById('require-sale-confirmation')?.addEventListener('change', renderConfigMenu);
    document.getElementById('print-direct-toggle')?.addEventListener('change', renderConfigMenu);
    loadShortcuts();
    initPrinterSettings();
    initReceiptDesigner(renderConfigMenu);
    renderConfigMenu();
}
