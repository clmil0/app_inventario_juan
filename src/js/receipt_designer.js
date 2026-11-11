// Administración → Configuración → Impresión: editor del diseño de boletas y tickets.
// La vista previa usa el mismo render que el papel (receipts.js), con datos de muestra.
import { showToast } from './supabase.js';
import { esc } from './ui.js';
import {
    defaultDesign, loadDesign, saveDesign, printHtml, receiptPreview, testReceiptHtml,
    DESIGN_PRESETS, DESIGN_PRESET_NAMES, STYLE_KEYS
} from './receipts.js';

const BLOCKS = {
    head: ['Encabezado del negocio', 'Logo, nombre, dirección y teléfono'],
    title: ['Título del documento', 'Ej. BOLETA DE VENTA'],
    ticketno: ['N° de ticket grande', 'Para ubicar el equipo rápido'],
    info: ['Datos del ticket', 'Elige qué datos mostrar'],
    items: ['Detalle', 'Productos o equipos'],
    totals: ['Subtotales', 'Subtotal, descuento, adelanto'],
    total: ['Total destacado', 'Monto final a pagar'],
    count: ['Cantidad de artículos', 'Ej. 4 artículos'],
    notice: ['Aviso de recojo', '“Conserve este ticket…”'],
    note: ['Nota / condiciones', 'Garantía, cambios, plazos'],
    foot: ['Pie de página', 'Agradecimiento y redes']
};
const SALE_FIELDS = [['ticket', 'Ticket'], ['fecha', 'Fecha'], ['vendedor', 'Vendedor'], ['cliente', 'Cliente'], ['pago', 'Pago']];
const REPAIR_FIELDS = [['fecha', 'Fecha'], ['cliente', 'Cliente'], ['celular', 'Celular'], ['atendido', 'Atendido'], ['estado', 'Estado'], ['impreso', 'Impreso']];
const TABS = [['plantilla', 'Plantilla'], ['negocio', 'Negocio'], ['secciones', 'Secciones'], ['estilo', 'Estilo'], ['textos', 'Textos']];
const PRESET_CARDS = [
    ['clasico', 'El diseño actual. Recuadros y total invertido.', 'c'],
    ['compacto', 'Menos papel. Sin logo, letra pequeña.', 'k'],
    ['moderno', 'Letra sans, títulos invertidos, más aire.', 'm'],
    ['minimal', 'Solo texto alineado a la izquierda.', 'n']
];
const STYLE_GROUPS = [
    ['Tipografía', 'font', [['mixed', 'Mixta'], ['mono', 'Máquina'], ['sans', 'Moderna']]],
    ['Grosor', 'weight', [['bold', 'Negrita'], ['normal', 'Normal']]],
    ['Separadores', 'sep', [['dashed', 'Guiones'], ['dotted', 'Puntos'], ['solid', 'Línea'], ['double', 'Doble'], ['none', 'Sin']]],
    ['Título', 'titleStyle', [['box', 'Recuadro'], ['invert', 'Invertido'], ['plain', 'Simple']]],
    ['Total', 'totalStyle', [['invert', 'Invertido'], ['box', 'Recuadro'], ['plain', 'Simple']]],
    ['Encabezado', 'headAlign', [['center', 'Centrado'], ['left', 'Izquierda']]],
    ['Espaciado', 'density', [['compact', 'Compacto'], ['normal', 'Normal'], ['airy', 'Amplio']]],
    ['Ancho de papel', 'paper', [['80', '80 mm'], ['58', '58 mm']]]
];
const PAPER_PX = { 80: 302, 58: 219 };
const LOGO_MAX_W = 400, LOGO_MAX_H = 200; // de sobra para 120 px a 203 dpi; mantiene el ticket liviano

let root = null, frame = null;
let design = null, savedJson = '';
let tab = 'plantilla', doc = 'sale', moment = 'in', zoom = 1.25;
let onChange = () => {};

export const designerPresetName = () => DESIGN_PRESET_NAMES[(design || loadDesign()).preset] || 'Personalizado';

const isSale = () => doc === 'sale';
const blocksKey = () => (isSale() ? 'saleBlocks' : 'repBlocks');
const fieldsKey = () => (isSale() ? 'saleFields' : 'repFields');
const fieldList = () => (isSale() ? SALE_FIELDS : REPAIR_FIELDS);
const docName = () => (isSale() ? 'la boleta de venta' : 'el ticket de reparación');
const isDirty = () => JSON.stringify(design) !== savedJson;

function seg(key, options) {
    return `<div class="ui-seg rd-seg">${options.map(([v, label]) =>
        `<button type="button" class="${String(design[key]) === String(v) ? 'active' : ''}" data-rd-key="${key}" data-rd-val="${v}">${label}</button>`).join('')}</div>`;
}

function docSeg() {
    return `<div class="ui-seg rd-seg">${[['sale', 'Venta'], ['repair', 'Reparación']].map(([v, label]) =>
        `<button type="button" class="${doc === v ? 'active' : ''}" data-rd-doc="${v}">${label}</button>`).join('')}</div>`;
}

function textField(key, label, opts = {}) {
    const hint = opts.optional ? ' <span class="rd-opt">· opcional</span>' : '';
    return `<label class="rd-field${opts.wide ? ' wide' : ''}"><span>${label}${hint}</span>
        <input class="ui-field" data-rd-text="${key}" value="${esc(design[key])}" placeholder="${esc(opts.ph || '')}"></label>`;
}

function chip(active, attrs, label) {
    return `<button type="button" class="rd-chip${active ? ' active' : ''}" ${attrs}>${label}</button>`;
}

function renderPlantilla() {
    return `<p class="ui-card-sub rd-p">Empieza con una plantilla y ajusta los detalles después. Tus textos y datos del negocio no cambian.</p>
    <div class="rd-presets">${PRESET_CARDS.map(([id, desc, thumb]) => `
        <button type="button" class="rd-preset${design.preset === id ? ' active' : ''}" data-rd-preset="${id}">
            <span class="rd-thumb rd-thumb-${thumb}"><i></i><i></i><i></i><i></i><i></i><i></i></span>
            <span class="rd-preset-t"><b>${DESIGN_PRESET_NAMES[id]}</b><small>${desc}</small></span>
        </button>`).join('')}</div>`;
}

function renderNegocio() {
    const logo = design.logo === 'mono' ? `
        <div class="rd-inline">
            <input class="ui-field rd-letter" data-rd-text="logoLetter" value="${esc(design.logoLetter)}" maxlength="2" aria-label="Inicial del logo">
            ${seg('markShape', [['rounded', 'Redondeado'], ['circle', 'Círculo'], ['square', 'Cuadrado']])}
        </div>` : design.logo === 'image' ? `
        <div class="rd-logo-row">
            <div class="rd-logo-box">${design.logoImg ? `<img src="${esc(design.logoImg)}" alt="">` : '<small>Sin imagen</small>'}</div>
            <div class="rd-grow"><span>Imagen del logo</span><small>Se imprime en blanco y negro. PNG o JPG con fondo blanco.</small></div>
            <button type="button" class="ui-mini" data-rd-act="pick-file">Subir</button>
            <input type="file" id="rd-file" accept="image/*" hidden>
        </div>` : '';
    return `<div class="rd-stack sm">
            <span class="rd-label">Logo</span>
            ${seg('logo', [['mono', 'Inicial'], ['image', 'Imagen'], ['none', 'Sin logo']])}
            ${logo}
        </div>
        <div class="rd-fields">
            ${textField('bizName', 'Nombre en el encabezado')}
            ${textField('bizShort', 'Nombre en el pie')}
            ${textField('bizPhone', 'Teléfono')}
            ${textField('bizRuc', 'RUC', { optional: true, ph: '20xxxxxxxxx' })}
            ${textField('bizAddress', 'Dirección', { optional: true, ph: 'Av. ejemplo 123, Lima', wide: true })}
            ${textField('bizSocial', 'Redes o web en el pie', { optional: true, ph: '@reparacionesjuan', wide: true })}
        </div>`;
}

function renderSecciones() {
    const rows = design[blocksKey()].filter(b => BLOCKS[b.id] && !(isSale() && (b.id === 'ticketno' || b.id === 'notice')) && !(!isSale() && b.id === 'count'));
    return `<div class="rd-between">
            <span class="ui-card-sub">Activa, oculta y ordena las partes de <b>${docName()}</b>.</span>${docSeg()}
        </div>
        ${rows.map((b, i) => {
            const fields = design[fieldsKey()];
            const label = b.id === 'items' ? (isSale() ? 'Productos' : 'Equipos') : BLOCKS[b.id][0];
            const extra = !b.on ? '' : b.id === 'info'
                ? `<div class="rd-chips">${fieldList().map(([id, l]) => chip(fields[id], `data-rd-field="${id}"`, l)).join('')}</div>`
                : b.id === 'items' && isSale()
                    ? `<div class="rd-chips">${chip(design.showBrand, 'data-rd-flag="showBrand"', 'Marca del producto')}${chip(design.showUnit, 'data-rd-flag="showUnit"', 'Cantidad × precio')}</div>`
                    : '';
            return `<div class="rd-block">
                <div class="rd-block-row">
                    <div class="rd-grow${b.on ? '' : ' off'}"><span>${label}</span><small>${BLOCKS[b.id][1]}</small></div>
                    <button type="button" class="ui-icon-btn sm rd-move" data-rd-move="${b.id}" data-dir="-1" title="Subir" aria-label="Subir ${label}" ${i === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="ui-icon-btn sm rd-move" data-rd-move="${b.id}" data-dir="1" title="Bajar" aria-label="Bajar ${label}" ${i === rows.length - 1 ? 'disabled' : ''}>↓</button>
                    <label class="rd-switch" title="Mostrar / ocultar"><input type="checkbox" data-rd-block="${b.id}" ${b.on ? 'checked' : ''} aria-label="Mostrar ${label}"><span class="ui-switch"></span></label>
                </div>${extra}
            </div>`;
        }).join('')}`;
}

function renderEstilo() {
    return `<div class="rd-style">
        ${STYLE_GROUPS.map(([label, key, options]) => `<div class="rd-stack sm"><span class="rd-label">${label}</span>${seg(key, options)}</div>`).join('')}
        <div class="rd-stack sm">
            <span class="rd-label rd-between">Tamaño de letra <b id="rd-size-label">${design.size} px</b></span>
            <input type="range" class="rd-range" min="10" max="15" step="1" value="${design.size}" data-rd-num="size" aria-label="Tamaño de letra">
        </div>
    </div>`;
}

function renderTextos() {
    const noteKey = isSale() ? 'saleNote' : 'repNote';
    const fields = isSale()
        ? [['saleTitle', 'Título', 'BOLETA DE VENTA'], ['saleThanks', 'Agradecimiento', '¡Gracias por su compra!']]
        : [['repTitleIn', 'Título al recibir', 'TICKET DE RECEPCIÓN'], ['repTitleOut', 'Título al entregar', 'BOLETA DE SERVICIO'],
            ['repNotice1', 'Aviso · línea 1', 'Conserve este ticket'], ['repNotice2', 'Aviso · línea 2', 'para recoger sus equipos.'], ['repThanks', 'Agradecimiento', '¡Gracias por su preferencia!']];
    const noteOn = design[blocksKey()].find(b => b.id === 'note')?.on;
    return `<div class="rd-between">
            <span class="ui-card-sub">Textos de <b>${docName()}</b>.</span>${docSeg()}
        </div>
        <div class="rd-fields">${fields.map(([key, label, ph]) => textField(key, label, { ph })).join('')}</div>
        <label class="rd-field"><span>${isSale() ? 'Nota adicional (cambios, garantía…)' : 'Condiciones del servicio'}</span>
            <textarea class="ui-field rd-area" rows="3" data-rd-text="${noteKey}" placeholder="${isSale() ? 'Ej. Cambios dentro de 7 días presentando este ticket.' : 'Ej. Equipos no recogidos en 60 días pasan a remate. Garantía de 30 días en la reparación.'}">${esc(design[noteKey])}</textarea></label>
        ${noteOn ? '' : '<small class="adm-small">La sección “Nota / condiciones” está oculta. Actívala en <a href="#" data-rd-tab="secciones">Secciones</a> para que se imprima.</small>'}`;
}

function renderControls() {
    const renderers = { plantilla: renderPlantilla, negocio: renderNegocio, secciones: renderSecciones, estilo: renderEstilo, textos: renderTextos };
    root.querySelector('#rd-tabs').innerHTML = TABS.map(([id, label]) => `<button type="button" class="${tab === id ? 'active' : ''}" data-rd-tab="${id}">${label}</button>`).join('');
    root.querySelector('#rd-panel').innerHTML = renderers[tab]();
}

function renderDocOptions() {
    root.querySelector('#rd-doc-opts').innerHTML = [['sale', 'Boleta de venta'], ['repair', 'Ticket de reparación']].map(([v, label]) =>
        `<button type="button" class="rd-dark-opt${doc === v ? ' active' : ''}" data-rd-doc="${v}">${label}</button>`).join('');
    const moments = root.querySelector('#rd-moments');
    moments.hidden = isSale();
    moments.innerHTML = `<span>Momento</span>${[['in', 'Al recibir'], ['out', 'Al entregar']].map(([v, label]) =>
        `<button type="button" class="rd-dark-opt round${moment === v ? ' active' : ''}" data-rd-moment="${v}">${label}</button>`).join('')}`;
}

function measurePreview() {
    const body = frame?.contentDocument?.body;
    if (!body) return;
    const width = PAPER_PX[design.paper] || PAPER_PX[80];
    const height = Math.ceil(body.getBoundingClientRect().height);
    if (!height) return;
    frame.style.width = width + 'px';
    frame.style.height = height + 'px';
    frame.style.transform = `scale(${zoom})`;
    const paper = root.querySelector('#rd-paper');
    paper.style.width = width * zoom + 'px';
    paper.style.height = height * zoom + 'px';
}

function renderPreview() {
    const d = frame?.contentDocument;
    if (!d?.body || !d.getElementById('rd-css')) return;
    const { css, body, paper } = receiptPreview(doc, moment, design);
    d.getElementById('rd-css').textContent = css;
    d.body.innerHTML = body;
    d.body.dataset.paper = paper;
    root.querySelector('#rd-paper-note').textContent = paper === 58
        ? 'Papel de 58 mm (48 mm imprimibles).'
        : 'Papel de 80 mm · ticketera ZKTeco ZKP8005 (72 mm imprimibles).';
    root.querySelector('#rd-zoom-label').textContent = Math.round(zoom * 100) + '%';
    measurePreview();
}

function renderStatus() {
    const dirty = isDirty();
    root.querySelector('#rd-preset-name').textContent = designerPresetName();
    root.querySelector('#rd-dirty').hidden = !dirty;
    root.querySelector('[data-rd-act="discard"]').hidden = !dirty;
    root.querySelector('[data-rd-act="save"]').classList.toggle('rd-save-dirty', dirty);
    onChange();
}

const refresh = () => { renderPreview(); renderStatus(); };
const refreshAll = () => { renderControls(); renderDocOptions(); refresh(); };

function update(patch) {
    const custom = Object.keys(patch).some(k => STYLE_KEYS.includes(k));
    design = { ...design, ...patch, ...(custom ? { preset: 'custom' } : {}) };
}

function moveBlock(id, dir) {
    const list = design[blocksKey()];
    const visible = [...root.querySelectorAll('[data-rd-block]')].map(el => el.dataset.rdBlock);
    const target = visible[visible.indexOf(id) + dir];
    if (!target) return;
    const next = [...list];
    const a = next.findIndex(b => b.id === id), b = next.findIndex(x => x.id === target);
    [next[a], next[b]] = [next[b], next[a]];
    update({ [blocksKey()]: next });
}

// La impresora recibe la imagen dentro del documento: se reduce y se aplana sobre blanco al subirla.
function fileToLogo(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const ratio = Math.min(1, LOGO_MAX_W / img.naturalWidth, LOGO_MAX_H / img.naturalHeight);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
        img.src = url;
    });
}

async function printTest() {
    const direct = await printHtml(testReceiptHtml(doc, moment, design), () => showToast('No se pudo imprimir', 'error'), { direct: true });
    if (direct) showToast(isSale() ? 'Boleta de prueba enviada a la impresora' : 'Ticket de reparación de prueba enviado a la impresora');
}

const ACTIONS = {
    save() {
        try {
            saveDesign(design);
        } catch (e) {
            showToast('No se pudo guardar el diseño: el logo es demasiado grande', 'error');
            return;
        }
        savedJson = JSON.stringify(design);
        refresh();
        showToast('Diseño guardado. Se usará en las próximas impresiones.');
    },
    discard() { design = JSON.parse(savedJson); refreshAll(); showToast('Cambios descartados'); },
    reset() { design = defaultDesign(); refreshAll(); showToast('Diseño restablecido al original. Guarda para aplicarlo.'); },
    'print-test': printTest,
    'zoom-in'() { zoom = Math.min(2, zoom + .25); renderPreview(); },
    'zoom-out'() { zoom = Math.max(.75, zoom - .25); renderPreview(); },
    'pick-file'() { root.querySelector('#rd-file')?.click(); }
};

function onClick(e) {
    const el = e.target.closest('button, a');
    if (!el || !root.contains(el)) return;
    const data = el.dataset;
    if (data.rdAct) { ACTIONS[data.rdAct]?.(); return; }
    if (data.rdTab) { e.preventDefault(); tab = data.rdTab; renderControls(); return; }
    if (data.rdDoc) { doc = data.rdDoc; refreshAll(); return; }
    if (data.rdMoment) { moment = data.rdMoment; renderDocOptions(); renderPreview(); return; }
    if (data.rdPreset) design = { ...design, ...DESIGN_PRESETS[data.rdPreset], preset: data.rdPreset };
    else if (data.rdKey) update({ [data.rdKey]: data.rdVal });
    else if (data.rdMove) moveBlock(data.rdMove, Number(data.dir));
    else if (data.rdField) { const k = fieldsKey(); update({ [k]: { ...design[k], [data.rdField]: !design[k][data.rdField] } }); }
    else if (data.rdFlag) update({ [data.rdFlag]: !design[data.rdFlag] });
    else return;
    renderControls();
    refresh();
}

function onInput(e) {
    const el = e.target;
    if (el.dataset.rdText) { update({ [el.dataset.rdText]: el.value }); refresh(); }
    else if (el.dataset.rdNum) {
        update({ [el.dataset.rdNum]: Number(el.value) });
        root.querySelector('#rd-size-label').textContent = `${el.value} px`;
        refresh();
    }
}

async function onFieldChange(e) {
    const el = e.target;
    if (el.dataset.rdBlock) {
        const k = blocksKey();
        update({ [k]: design[k].map(b => (b.id === el.dataset.rdBlock ? { ...b, on: el.checked } : b)) });
        renderControls();
        refresh();
    } else if (el.id === 'rd-file' && el.files?.[0]) {
        try {
            update({ logoImg: await fileToLogo(el.files[0]) });
            renderControls();
            refresh();
        } catch (err) { showToast(err.message, 'error'); }
    }
}

function mountFrame() {
    frame = root.querySelector('#rd-frame');
    frame.addEventListener('load', () => {
        renderPreview();
        frame.contentDocument.fonts?.ready.then(measurePreview);
    });
    frame.srcdoc = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700;800&display=swap" rel="stylesheet">
        <style id="rd-css"></style></head><body></body></html>`;
    // El panel arranca oculto: sin esto la hoja se mediría con alto 0
    new ResizeObserver(measurePreview).observe(root.querySelector('#rd-stage'));
}

export function initReceiptDesigner(changed) {
    root = document.getElementById('receipt-designer');
    if (!root) return;
    if (changed) onChange = changed;
    design = loadDesign();
    savedJson = JSON.stringify(design);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onFieldChange);
    renderControls();
    renderDocOptions();
    mountFrame();
    renderStatus();
}
