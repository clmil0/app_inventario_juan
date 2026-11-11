// Impresos térmicos (ZKTeco ZKP8005): solo negro, jerarquía con peso y tamaño y columnas alineadas.
// La apariencia sale del "diseño de impresos" (Administración → Configuración → Impresión).
import { esc } from './ui.js';

const plain = n => (parseFloat(n) || 0).toFixed(2);
export const soles = n => 'S/ ' + plain(n);

function fmtDateTime(d) {
    const date = d instanceof Date ? d : new Date(d);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

// ═════════════ DISEÑO DE IMPRESOS ═════════════
const DESIGN_KEY = 'receipt_design_v1';

export const STYLE_KEYS = ['font', 'size', 'weight', 'sep', 'titleStyle', 'totalStyle', 'headAlign', 'density', 'logo', 'markShape'];
export const DESIGN_PRESETS = {
    clasico: { font: 'mixed', size: 12, weight: 'bold', sep: 'dashed', titleStyle: 'box', totalStyle: 'invert', headAlign: 'center', density: 'normal', logo: 'mono', markShape: 'rounded' },
    compacto: { font: 'mono', size: 11, weight: 'bold', sep: 'dotted', titleStyle: 'plain', totalStyle: 'box', headAlign: 'center', density: 'compact', logo: 'none', markShape: 'rounded' },
    moderno: { font: 'sans', size: 12, weight: 'normal', sep: 'solid', titleStyle: 'invert', totalStyle: 'invert', headAlign: 'center', density: 'airy', logo: 'mono', markShape: 'circle' },
    minimal: { font: 'mono', size: 12, weight: 'normal', sep: 'solid', titleStyle: 'plain', totalStyle: 'plain', headAlign: 'left', density: 'normal', logo: 'none', markShape: 'square' }
};
export const DESIGN_PRESET_NAMES = { clasico: 'Clásico', compacto: 'Compacto', moderno: 'Moderno', minimal: 'Minimal', custom: 'Personalizado' };

const blocks = list => list.map(([id, on]) => ({ id, on: !!on }));

export function defaultDesign() {
    return {
        preset: 'clasico',
        bizName: 'REPARACIONES JUAN', bizShort: 'Reparaciones Juan', bizPhone: '923 180 186', bizAddress: '', bizRuc: '', bizSocial: '',
        logoLetter: 'J', logoImg: '', paper: '80',
        saleTitle: 'BOLETA DE VENTA', saleThanks: '¡Gracias por su compra!', saleNote: '',
        repTitleIn: 'TICKET DE RECEPCIÓN', repTitleOut: 'BOLETA DE SERVICIO', repNotice1: 'Conserve este ticket', repNotice2: 'para recoger sus equipos.', repThanks: '¡Gracias por su preferencia!', repNote: '',
        showBrand: true, showUnit: true,
        saleBlocks: blocks([['head', 1], ['title', 1], ['info', 1], ['items', 1], ['totals', 1], ['total', 1], ['count', 1], ['note', 0], ['foot', 1]]),
        repBlocks: blocks([['head', 1], ['title', 1], ['ticketno', 1], ['info', 1], ['items', 1], ['totals', 1], ['total', 1], ['notice', 1], ['note', 0], ['foot', 1]]),
        saleFields: { ticket: true, fecha: true, vendedor: true, cliente: true, pago: true },
        repFields: { fecha: true, cliente: true, celular: true, atendido: true, estado: true, impreso: true },
        ...DESIGN_PRESETS.clasico
    };
}

// Respeta el orden guardado y agrega las secciones que no existían cuando se guardó
function mergeBlocks(saved, defaults) {
    if (!Array.isArray(saved)) return defaults;
    const known = saved.filter(b => b && defaults.some(x => x.id === b.id)).map(b => ({ id: b.id, on: !!b.on }));
    return [...known, ...defaults.filter(x => !known.some(b => b.id === x.id))];
}

export function loadDesign() {
    const base = defaultDesign();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(DESIGN_KEY) || 'null'); } catch (e) { /* diseño corrupto: se usa el original */ }
    if (!saved || typeof saved !== 'object') return base;
    return {
        ...base, ...saved,
        saleBlocks: mergeBlocks(saved.saleBlocks, base.saleBlocks),
        repBlocks: mergeBlocks(saved.repBlocks, base.repBlocks),
        saleFields: { ...base.saleFields, ...saved.saleFields },
        repFields: { ...base.repFields, ...saved.repFields }
    };
}

export const saveDesign = d => localStorage.setItem(DESIGN_KEY, JSON.stringify(d));

const MONO = "'Courier New', 'Lucida Console', monospace", SANS = "'Outfit', Arial, sans-serif";
const SEP = { dashed: '2px dashed #000', dotted: '2px dotted #000', solid: '1px solid #000', double: '3px double #000' };
const SEP3 = { dashed: '3px dashed #000', dotted: '3px dotted #000', solid: '2px solid #000', double: '4px double #000' };
const paperOf = d => (String(d.paper) === '58' ? 58 : 80);

function thermalCss(d) {
    const bold = d.weight === 'bold';
    const fs = Math.min(15, Math.max(10, Number(d.size) || 12));
    const fw = bold ? 700 : 400, fwx = bold ? 900 : 700;
    const ff = d.font === 'sans' ? SANS : MONO, tf = d.font === 'mono' ? MONO : SANS;
    const gap = { compact: 6, normal: 10, airy: 14 }[d.density] || 10;
    const paper58 = paperOf(d) === 58;
    const left = d.headAlign === 'left';
    const ts = d.titleStyle, tot = d.totalStyle;
    const sep = SEP[d.sep] || SEP.dashed, sep3 = SEP3[d.sep] || SEP3.dashed;
    return `
@page { margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html { background: #fff; }
body { width: ${paper58 ? 48 : 72}mm; margin: 0 auto; padding: 4mm ${paper58 ? 1 : 2}mm 6mm; background: #fff; color: #000;
    font-family: ${ff}; font-size: ${fs}px; font-weight: ${fw}; line-height: 1.25;
    display: flex; flex-direction: column; gap: ${gap}px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sans { font-family: ${tf}; }
.head { display: flex; flex-direction: column; align-items: ${left ? 'flex-start' : 'center'}; gap: 2px; text-align: ${left ? 'left' : 'center'}; }
.mark { width: 40px; height: 40px; border: 2.5px solid #000; border-radius: ${{ rounded: '10px', circle: '50%', square: '0' }[d.markShape] || '10px'}; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; }
.logo { display: block; width: 120px; height: 56px; object-fit: contain; object-position: ${left ? 'left' : 'center'} center; filter: grayscale(1) contrast(1.4); }
.biz { font-size: ${fs + 8}px; font-weight: 800; letter-spacing: .02em; margin-top: ${d.logo === 'none' ? 0 : 6}px; line-height: 1.15; }
.title { border: ${ts === 'plain' ? '0' : '2px solid #000'}; background: ${ts === 'invert' ? '#000' : '#fff'}; color: ${ts === 'invert' ? '#fff' : '#000'}; padding: ${ts === 'plain' ? '2px 0' : '6px'}; text-align: ${ts === 'plain' && left ? 'left' : 'center'}; font-size: ${fs + 2}px; font-weight: ${fwx}; letter-spacing: .16em; }
.info { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; line-height: 1.45; }
.info b { font-weight: ${fwx}; }
.info span { text-align: right; word-break: break-word; }
.dash { border-top: ${sep}; }
.dash3 { border-top: ${sep3}; }
.items { display: flex; flex-direction: column; gap: 8px; }
.item { display: flex; flex-direction: column; }
.item b, .eq b { font-weight: ${fwx}; }
.item .ln { display: flex; justify-content: space-between; padding-left: 10px; }
.item .ln.end { justify-content: flex-end; }
.rows { display: flex; flex-direction: column; gap: 2px; }
.rows .r { display: flex; justify-content: space-between; }
.total { background: ${tot === 'invert' ? '#000' : '#fff'}; color: ${tot === 'invert' ? '#fff' : '#000'}; ${tot === 'box' ? 'border: 2px solid #000;' : ''} ${tot === 'plain' ? 'border-top: 2px solid #000;' : ''} display: flex; justify-content: space-between; align-items: baseline; padding: ${tot === 'plain' ? '8px 0 0' : '8px 10px'}; }
.total .k { font-size: ${fs + 2}px; font-weight: ${fwx}; letter-spacing: .1em; }
.total .v { font-size: ${fs + 12}px; font-weight: 800; }
.center { text-align: center; }
.bold { font-weight: ${fwx}; }
.small { font-size: ${fs - 1}px; }
.note { font-size: ${fs - 1}px; text-align: center; white-space: pre-wrap; line-height: 1.35; }
.foot { text-align: center; display: flex; flex-direction: column; gap: 2px; }
.foot.ruled { ${d.sep === 'none' ? '' : `border-top: ${sep};`} padding-top: 10px; }
.big { font-size: ${fs + 3}px; font-weight: 800; }
.box { border: 2px dashed #000; padding: 8px; text-align: center; display: flex; flex-direction: column; gap: 2px; }
.ticket-no { text-align: center; display: flex; flex-direction: column; }
.ticket-no .v { font-size: ${fs + 18}px; font-weight: 800; letter-spacing: .04em; line-height: 1.1; }
.eq { display: flex; gap: 8px; }
.eq .n { width: 22px; height: 22px; border: 2px solid #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
.eq .d { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.eq .d .t { display: flex; justify-content: space-between; gap: 6px; }
`;
}

function headBlock(d) {
    const logo = d.logo === 'mono' ? `<div class="mark sans">${esc(d.logoLetter)}</div>`
        : d.logo === 'image' && d.logoImg ? `<img class="logo" alt="" src="${esc(d.logoImg)}">` : '';
    return `<div class="head">
        ${logo}
        <div class="biz sans">${esc(d.bizName)}</div>
        ${d.bizAddress.trim() ? `<div>${esc(d.bizAddress)}</div>` : ''}
        ${d.bizRuc.trim() ? `<div>RUC: ${esc(d.bizRuc)}</div>` : ''}
        <div>Tel: ${esc(d.bizPhone)}</div>
    </div>`;
}

const sepLine = (d, cls = 'dash') => (d.sep === 'none' ? '' : `<div class="${cls}"></div>`);

function footBlock(d, m) {
    const short = `<span>${esc(d.bizShort)}</span>`;
    const social = d.bizSocial.trim() ? `<span class="small">${esc(d.bizSocial)}</span>` : '';
    return m.kind === 'repair'
        ? `<div class="foot"><span>${esc(d.repThanks)}</span>${short}${social}</div>`
        : `<div class="foot ruled"><span class="big sans">${esc(m.kind === 'sale' ? d.saleThanks : d.repThanks)}</span>${short}${social}</div>`;
}

const BLOCK_ALLOWED = {
    ticketno: m => m.kind === 'repair',
    count: m => m.kind === 'sale',
    totals: m => m.kind !== 'express',
    notice: m => m.kind === 'repair' && !m.final,
    note: (m, d) => m.kind !== 'express' && !!(m.kind === 'sale' ? d.saleNote : d.repNote).trim()
};

function blockHtml(id, d, m) {
    switch (id) {
        case 'head': return headBlock(d);
        case 'title': return `<div class="title">${esc(m.title)}</div>`;
        case 'ticketno': return `<div class="ticket-no"><span class="small">N° TICKET</span><span class="v sans">${esc(m.ticket)}</span></div>`;
        case 'info': {
            const fields = m.kind === 'sale' ? d.saleFields : d.repFields;
            return `<div class="info">${m.info.filter(r => !r.id || fields[r.id]).map(r => `<b>${esc(r.k)}</b><span>${esc(r.v)}</span>`).join('')}</div>`;
        }
        case 'items': return `${sepLine(d, m.kind === 'repair' ? 'dash3' : 'dash')}${m.itemsHeader ? `<div class="center bold">${esc(m.itemsHeader)}</div>` : ''}<div class="items">${m.items}</div>${m.kind === 'express' ? '' : sepLine(d)}`;
        case 'totals': return `<div class="rows">${m.totals.map(([k, v]) => `<span class="r"><span>${esc(k)}</span><span>${esc(v)}</span></span>`).join('')}</div>`;
        case 'total': return `<div class="total"><span class="k">${esc(m.totalKey)}</span><span class="v sans">${esc(m.totalValue)}</span></div>`;
        case 'count': return `<span class="small center">${m.units} artículo${m.units === 1 ? '' : 's'}</span>`;
        case 'notice': return `<div class="box"><span class="big sans">${esc(d.repNotice1)}</span><span>${esc(d.repNotice2)}</span></div>`;
        case 'note': return `<div class="note">${esc(m.kind === 'sale' ? d.saleNote : d.repNote)}</div>`;
        case 'foot': return footBlock(d, m);
        default: return '';
    }
}

function receiptBody(d, m) {
    const list = m.kind === 'sale' ? d.saleBlocks : d.repBlocks;
    return list.filter(b => b.on && (!BLOCK_ALLOWED[b.id] || BLOCK_ALLOWED[b.id](m, d))).map(b => blockHtml(b.id, d, m)).join('\n');
}

const FONT_LINK = '<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700;800&display=swap" rel="stylesheet">';

function thermalDoc(docTitle, d, model) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(docTitle)}</title>
        ${d.font === 'mono' ? '' : FONT_LINK}
        <style>${thermalCss(d)}</style></head><body data-paper="${paperOf(d)}">${receiptBody(d, model)}</body></html>`;
}

// Ajustes de impresión de esta PC (Administración → Configuración → Impresión de tickets)
export const PRINT_SETTINGS = {
    get direct() { return localStorage.getItem('print_direct') !== 'false'; }, // por defecto: directa
    set direct(v) { localStorage.setItem('print_direct', v ? 'true' : 'false'); },
    get device() { return localStorage.getItem('print_device') || ''; },          // '' = predeterminada
    set device(v) { localStorage.setItem('print_device', v || ''); }
};

export const canPrintDirect = () => !!window.electronAPI?.printHtml;

/**
 * Imprime un documento HTML.
 *  · direct: true (tickets y boletas) → en la app de escritorio va directo a la impresora, sin diálogo.
 *    Si falla (impresora apagada / no encontrada) se abre el diálogo normal como respaldo.
 *  · Sin direct (ej. cuadre contable en PDF) o en el navegador → diálogo de impresión del sistema.
 */
export async function printHtml(html, onError, { direct = false } = {}) {
    if (direct && PRINT_SETTINGS.direct && canPrintDirect()) {
        try {
            const r = await window.electronAPI.printHtml(html, PRINT_SETTINGS.device);
            if (r?.success) return true;
            console.warn('Impresión directa falló, se abre el diálogo:', r?.error);
            window.dispatchEvent(new CustomEvent('print:direct-failed', { detail: r?.error || '' }));
        } catch (e) {
            console.warn('Impresión directa falló, se abre el diálogo:', e);
        }
    }
    printWithDialog(html, onError);
    return false;
}

// El rollo térmico no tiene alto fijo: la página se ajusta al largo real del ticket.
// (`size: 80mm auto` no es CSS válido; Chromium lo descarta y usa el papel por defecto.)
function fitPageToReceipt(doc) {
    const paper = Number(doc.body?.dataset.paper);
    if (!paper) return;
    const height = Math.ceil(doc.body.getBoundingClientRect().height * 25.4 / 96) + 1;
    const style = doc.createElement('style');
    style.textContent = `@page { size: ${paper}mm ${Math.max(height, paper + 1)}mm; margin: 0; }`;
    doc.head.appendChild(style);
}

// Imprime en un iframe oculto (sin abrir ventana nueva): muestra el diálogo de impresión del sistema
function printWithDialog(html, onError) {
    let frame = document.getElementById('receipt-print-frame');
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.id = 'receipt-print-frame';
    frame.style.cssText = 'position:fixed;top:-10000px;left:-10000px;width:0;height:0;border:none;';
    document.body.appendChild(frame);

    let printed = false;
    const go = async () => {
        if (printed) return;
        printed = true;
        try {
            // Espera la fuente de los títulos (máx. 1.5 s) para que no salga con la de respaldo
            const fonts = frame.contentDocument?.fonts;
            if (fonts?.ready) await Promise.race([fonts.ready, new Promise(r => setTimeout(r, 1500))]);
            fitPageToReceipt(frame.contentDocument);
            frame.contentWindow.focus();
            frame.contentWindow.print();
        } catch (e) {
            console.error('Error al imprimir:', e);
            onError && onError(e);
        }
    };
    frame.onload = go;
    const doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(go, 800);
}

const REPAIR_STATUS_LABEL = { PENDIENTE: 'RECIBIDO', EN_DIAGNOSTICO: 'EN DIAGNÓSTICO', EN_PROCESO: 'EN PROCESO', TERMINADO: 'TERMINADO', ENTREGADO: 'ENTREGADO' };
const repairStatusLabel = s => REPAIR_STATUS_LABEL[s] || String(s || '—').toUpperCase();

const PAY_LABEL = { 'Caja': 'Caja (efectivo)', 'Yape/Plin': 'Yape / Plin', 'Transferencia': 'Transferencia', 'POS': 'Tarjeta (POS)' };

const dbDate = v => (String(v).includes('T') ? v : String(v).replace(' ', 'T') + 'Z');

function saleModel({ ticketCode, date, customerName, operatorName, paymentMethod, items, subtotalAmount, discount, totalAmount }, d) {
    return {
        kind: 'sale', title: d.saleTitle, ticket: ticketCode,
        info: [
            { id: 'ticket', k: 'Ticket', v: ticketCode },
            { id: 'fecha', k: 'Fecha', v: fmtDateTime(date) },
            { id: 'vendedor', k: 'Vendedor', v: operatorName || '—' },
            { id: 'cliente', k: 'Cliente', v: customerName || 'Anónimo' },
            { id: 'pago', k: 'Pago', v: PAY_LABEL[paymentMethod] || paymentMethod || 'Caja' }
        ],
        items: items.map(i => {
            const sub = plain(i.subtotal ?? (i.unit_price * i.quantity));
            return `<div class="item"><b>${esc(i.product_name)}${d.showBrand && i.brand ? ` (${esc(i.brand)})` : ''}</b>
                ${d.showUnit ? `<span class="ln"><span>${esc(i.quantity)} x ${plain(i.unit_price)}</span><b>${sub}</b></span>` : `<span class="ln end"><b>${sub}</b></span>`}</div>`;
        }).join(''),
        totals: [['Subtotal', plain(subtotalAmount)], ...(discount > 0 ? [['Descuento', '-' + plain(discount)]] : [])],
        totalKey: 'TOTAL', totalValue: soles(totalAmount),
        units: items.reduce((a, i) => a + (parseInt(i.quantity) || 0), 0)
    };
}

function repairModel(groupTicket, records, d) {
    const first = records[0] || {};
    const total = records.reduce((a, r) => a + (parseFloat(r.total_amount) || 0), 0);
    const advance = records.reduce((a, r) => a + (parseFloat(r.advance_payment) || 0), 0);
    const remaining = records.reduce((a, r) => a + (parseFloat(r.remaining_balance ?? ((r.total_amount || 0) - (r.advance_payment || 0))) || 0), 0);
    const final = records.length > 0 && records.every(r => r.status === 'TERMINADO' || r.status === 'ENTREGADO');
    const delivered = records.length > 0 && records.every(r => r.status === 'ENTREGADO');
    // Estado al momento de imprimir: el menos avanzado del ticket (o mixto si difieren)
    const mixed = new Set(records.map(r => r.status)).size > 1;
    const order = Object.keys(REPAIR_STATUS_LABEL);
    const groupStatus = records.reduce((min, r) => order.indexOf(r.status) < order.indexOf(min) ? r.status : min, first.status);
    return {
        kind: 'repair', final, title: final ? d.repTitleOut : d.repTitleIn, ticket: groupTicket,
        info: [
            { id: 'fecha', k: 'Fecha', v: fmtDateTime(first.created_at ? new Date(dbDate(first.created_at)) : new Date()) },
            { id: 'cliente', k: 'Cliente', v: first.customer_name || 'Cliente' },
            ...(first.customer_phone ? [{ id: 'celular', k: 'Celular', v: first.customer_phone }] : []),
            { id: 'atendido', k: 'Atendido', v: first.operator_name || '—' },
            { id: 'estado', k: 'Estado', v: repairStatusLabel(groupStatus) + (mixed ? ' (mixto)' : '') },
            ...(delivered && first.delivered_at ? [{ id: 'estado', k: 'Entregado', v: fmtDateTime(dbDate(first.delivered_at)) }] : []),
            { id: 'impreso', k: 'Impreso', v: fmtDateTime(new Date()) }
        ],
        itemsHeader: `EQUIPOS ${final ? 'REPARADOS' : 'INGRESADOS'} (${records.length})`,
        items: records.map((r, i) => `
            <div class="eq"><span class="n">${i + 1}</span><span class="d">
                <span class="t"><b>${esc([r.equipment_type, r.brand_model].filter(Boolean).join(' '))}</b><b>${plain(r.total_amount)}</b></span>
                <span class="small">Falla: ${esc(r.fault_description || '—')}</span>
                ${mixed ? `<span class="small">Estado: ${esc(repairStatusLabel(r.status))}</span>` : ''}</span></div>`).join(''),
        totals: [['COSTO TOTAL', soles(total)], ['ADELANTO', soles(advance)]],
        totalKey: delivered ? 'PAGADO' : 'SALDO', totalValue: soles(delivered ? total : remaining)
    };
}

// Recibo de reparación express: servicio cobrado y entregado al momento.
function expressModel(groupTicket, records, d) {
    const first = records[0] || {};
    const total = records.reduce((a, r) => a + (parseFloat(r.total_amount) || 0), 0);
    const date = first.delivered_at || first.created_at;
    return {
        kind: 'express', title: d.repTitleOut, ticket: groupTicket,
        info: [
            { k: 'Ticket', v: groupTicket },
            { id: 'fecha', k: 'Fecha', v: fmtDateTime(date ? new Date(dbDate(date)) : new Date()) },
            { id: 'atendido', k: 'Atendido', v: first.operator_name || '—' },
            { k: 'Pago', v: PAY_LABEL[first.final_payment_method || first.advance_payment_method] || first.final_payment_method || 'Caja' }
        ],
        items: records.map(r => `
            <div class="item"><b>${esc(r.fault_description || 'Reparación express')}</b>
                <span class="ln"><span>Servicio express</span><b>${plain(r.total_amount)}</b></span></div>`).join(''),
        totals: [], totalKey: 'PAGADO', totalValue: soles(total)
    };
}

/**
 * Boleta de venta.
 * items: [{ product_name, quantity, unit_price, subtotal, brand? }]
 */
export function saleReceiptHtml(data, design = loadDesign()) {
    return thermalDoc(`Boleta - ${data.ticketCode}`, design, saleModel(data, design));
}

/**
 * Ticket de recepción de reparación (uno o varios equipos del mismo ticket).
 * Si todos los equipos están TERMINADO/ENTREGADO se imprime como boleta final.
 */
export function repairReceiptHtml(groupTicket, records, design = loadDesign()) {
    if (records.length && records.every(r => r.is_express)) return thermalDoc(`Servicio - ${groupTicket}`, design, expressModel(groupTicket, records, design));
    return thermalDoc(`Ticket - ${groupTicket}`, design, repairModel(groupTicket, records, design));
}

// ═════════════ MUESTRAS (vista previa e impresión de prueba) ═════════════
function sampleSale(ticketCode) {
    const items = [['Cargador USB-C 20W', 'Samsung', 1, 35], ['Mica de vidrio templado', '', 2, 10], ['Cable Lightning 1 m', 'Apple', 1, 25]]
        .map(([product_name, brand, quantity, unit_price]) => ({ product_name, brand, quantity, unit_price, subtotal: quantity * unit_price }));
    return { ticketCode, date: new Date(), customerName: 'Carlos Ramos', operatorName: 'juan', paymentMethod: 'Yape/Plin', items, subtotalAmount: 80, discount: 5, totalAmount: 75 };
}

function sampleRepairs(moment) {
    const status = moment === 'out' ? 'ENTREGADO' : 'PENDIENTE';
    const now = new Date().toISOString();
    const base = { customer_name: 'María Quispe', customer_phone: '987 654 321', operator_name: 'junior', status, created_at: now, delivered_at: moment === 'out' ? now : null };
    return [
        { ...base, equipment_type: 'Celular', brand_model: 'Samsung A54', fault_description: 'Pantalla rota', total_amount: 120, advance_payment: 50 },
        { ...base, equipment_type: 'Tablet', brand_model: 'Lenovo M10', fault_description: 'No carga', total_amount: 60, advance_payment: 0 }
    ];
}

/** Partes del impreso de muestra, para pintarlo en la vista previa con el mismo render que el papel. */
export function receiptPreview(kind, moment, design) {
    const model = kind === 'sale' ? saleModel(sampleSale('v-8f3a-21c9'), design) : repairModel('r-4b7e-90d2', sampleRepairs(moment), design);
    return { css: thermalCss(design), body: receiptBody(design, model), paper: paperOf(design) };
}

/** Documento de prueba para imprimir. Lleva "PRUEBA" como ticket para que no se confunda con uno real. */
export function testReceiptHtml(kind, moment, design) {
    return kind === 'sale' ? saleReceiptHtml(sampleSale('PRUEBA'), design) : repairReceiptHtml('PRUEBA', sampleRepairs(moment), design);
}
