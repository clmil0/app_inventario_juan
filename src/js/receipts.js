// Impresos térmicos 80 mm (ZKTeco ZKP8005): solo negro, jerarquía con peso y tamaño,
// separadores punteados y monoespaciada para que las columnas alineen.
import { esc } from './ui.js';

export const BUSINESS = { name: 'REPARACIONES JUAN', short: 'Reparaciones Juan', phone: '923 180 186' };

const plain = n => (parseFloat(n) || 0).toFixed(2);
export const soles = n => 'S/ ' + plain(n);

function fmtDateTime(d) {
    const date = d instanceof Date ? d : new Date(d);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

const THERMAL_CSS = `
@page { size: 80mm auto; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: 72mm; margin: 0 auto; padding: 4mm 2mm 6mm; background: #fff; color: #000;
    font-family: 'Courier New', 'Lucida Console', monospace; font-size: 12px; font-weight: 700;
    display: flex; flex-direction: column; gap: 10px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sans { font-family: 'Outfit', 'Arial', sans-serif; }
.head { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; }
.mark { width: 40px; height: 40px; border: 2.5px solid #000; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; }
.biz { font-size: 20px; font-weight: 800; letter-spacing: .02em; margin-top: 6px; }
.title { border: 2px solid #000; padding: 6px; text-align: center; font-size: 14px; font-weight: 900; letter-spacing: .16em; }
.info { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; line-height: 1.45; }
.info b { font-weight: 900; }
.info span { text-align: right; word-break: break-word; }
.dash { border-top: 2px dashed #000; }
.dash3 { border-top: 3px dashed #000; }
.items { display: flex; flex-direction: column; gap: 8px; }
.item { display: flex; flex-direction: column; }
.item b { font-weight: 900; }
.item .ln { display: flex; justify-content: space-between; padding-left: 10px; }
.rows { display: flex; flex-direction: column; gap: 2px; }
.rows .r { display: flex; justify-content: space-between; }
.total { background: #000; color: #fff; display: flex; justify-content: space-between; align-items: baseline; padding: 8px 10px; }
.total .k { font-size: 14px; font-weight: 900; letter-spacing: .1em; }
.total .v { font-size: 24px; font-weight: 800; }
.center { text-align: center; }
.small { font-size: 11px; }
.foot { border-top: 2px dashed #000; padding-top: 10px; text-align: center; display: flex; flex-direction: column; gap: 2px; }
.foot .big { font-size: 15px; font-weight: 800; }
.box { border: 2px dashed #000; padding: 8px; text-align: center; display: flex; flex-direction: column; gap: 2px; }
.ticket-no { text-align: center; display: flex; flex-direction: column; }
.ticket-no .v { font-size: 30px; font-weight: 800; letter-spacing: .04em; line-height: 1.1; }
.eq { display: flex; gap: 8px; }
.eq .n { width: 22px; height: 22px; border: 2px solid #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
.eq .d { flex: 1; display: flex; flex-direction: column; }
.eq .d .t { display: flex; justify-content: space-between; gap: 6px; }
`;

function headHtml(title) {
    return `<div class="head">
        <div class="mark sans">J</div>
        <div class="biz sans">${BUSINESS.name}</div>
        <div>Tel: ${BUSINESS.phone}</div>
    </div>
    <div class="title">${esc(title)}</div>`;
}

function thermalDoc(docTitle, body) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(docTitle)}</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;700;800&display=swap" rel="stylesheet">
        <style>${THERMAL_CSS}</style></head><body>${body}</body></html>`;
}

// Imprime un documento HTML en un iframe oculto (sin abrir ventana nueva).
// Para impresión silenciosa (sin diálogo), abrir Chrome con: --kiosk-printing
export function printHtml(html, onError) {
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

const PAY_LABEL = { 'Caja': 'Caja (efectivo)', 'Yape/Plin': 'Yape / Plin', 'Transferencia': 'Transferencia', 'POS': 'Tarjeta (POS)' };

/**
 * Boleta de venta.
 * items: [{ product_name, quantity, unit_price, subtotal, brand? }]
 */
export function saleReceiptHtml({ ticketCode, date, customerName, operatorName, paymentMethod, items, subtotalAmount, discount, totalAmount }) {
    const units = items.reduce((a, i) => a + (parseInt(i.quantity) || 0), 0);
    const body = `
        ${headHtml('BOLETA DE VENTA')}
        <div class="info">
            <b>Ticket</b><span>${esc(ticketCode)}</span>
            <b>Fecha</b><span>${fmtDateTime(date)}</span>
            <b>Vendedor</b><span>${esc(operatorName || '—')}</span>
            <b>Cliente</b><span>${esc(customerName || 'Anónimo')}</span>
            <b>Pago</b><span>${esc(PAY_LABEL[paymentMethod] || paymentMethod || 'Caja')}</span>
        </div>
        <div class="dash"></div>
        <div class="items">${items.map(i => `
            <div class="item"><b>${esc(i.product_name)}${i.brand ? ` (${esc(i.brand)})` : ''}</b>
                <span class="ln"><span>${i.quantity} x ${plain(i.unit_price)}</span><b>${plain(i.subtotal ?? (i.unit_price * i.quantity))}</b></span></div>`).join('')}
        </div>
        <div class="dash"></div>
        <div class="rows">
            <span class="r"><span>Subtotal</span><span>${plain(subtotalAmount)}</span></span>
            ${discount > 0 ? `<span class="r"><span>Descuento</span><span>-${plain(discount)}</span></span>` : ''}
        </div>
        <div class="total"><span class="k">TOTAL</span><span class="v sans">${soles(totalAmount)}</span></div>
        <span class="small center">${units} artículo${units === 1 ? '' : 's'}</span>
        <div class="foot"><span class="big sans">¡Gracias por su compra!</span><span>${BUSINESS.short}</span></div>`;
    return thermalDoc(`Boleta - ${ticketCode}`, body);
}

/**
 * Ticket de recepción de reparación (uno o varios equipos del mismo ticket).
 * Si todos los equipos están TERMINADO/ENTREGADO se imprime como boleta final.
 */
export function repairReceiptHtml(groupTicket, records) {
    const first = records[0] || {};
    const total = records.reduce((a, r) => a + (parseFloat(r.total_amount) || 0), 0);
    const advance = records.reduce((a, r) => a + (parseFloat(r.advance_payment) || 0), 0);
    const remaining = records.reduce((a, r) => a + (parseFloat(r.remaining_balance ?? ((r.total_amount || 0) - (r.advance_payment || 0))) || 0), 0);
    const final = records.length > 0 && records.every(r => r.status === 'TERMINADO' || r.status === 'ENTREGADO');
    const delivered = records.length > 0 && records.every(r => r.status === 'ENTREGADO');
    const body = `
        ${headHtml(final ? 'BOLETA DE SERVICIO' : 'TICKET DE RECEPCIÓN')}
        <div class="ticket-no"><span class="small">N° TICKET</span><span class="v sans">${esc(groupTicket)}</span></div>
        <div class="info">
            <b>Fecha</b><span>${fmtDateTime(first.created_at ? new Date(String(first.created_at).includes('T') ? first.created_at : String(first.created_at).replace(' ', 'T') + 'Z') : new Date())}</span>
            <b>Cliente</b><span>${esc(first.customer_name || 'Cliente')}</span>
            ${first.customer_phone ? `<b>Celular</b><span>${esc(first.customer_phone)}</span>` : ''}
            <b>Atendido</b><span>${esc(first.operator_name || '—')}</span>
        </div>
        <div class="dash3"></div>
        <div class="center" style="font-weight:900">EQUIPOS ${final ? 'REPARADOS' : 'INGRESADOS'} (${records.length})</div>
        <div class="items">${records.map((r, i) => `
            <div class="eq"><span class="n">${i + 1}</span><span class="d">
                <span class="t"><b>${esc([r.equipment_type, r.brand_model].filter(Boolean).join(' '))}</b><b>${plain(r.total_amount)}</b></span>
                <span class="small">Falla: ${esc(r.fault_description || '—')}</span></span></div>`).join('')}
        </div>
        <div class="dash"></div>
        <div class="rows">
            <span class="r"><span>COSTO TOTAL</span><span>${soles(total)}</span></span>
            <span class="r"><span>ADELANTO</span><span>${soles(advance)}</span></span>
        </div>
        <div class="total"><span class="k">${delivered ? 'PAGADO' : 'SALDO'}</span><span class="v sans">${soles(delivered ? total : remaining)}</span></div>
        ${final ? '' : '<div class="box"><span class="sans" style="font-size:15px;font-weight:800">Conserve este ticket</span><span>para recoger sus equipos.</span></div>'}
        <div class="center" style="display:flex;flex-direction:column;gap:2px"><span>¡Gracias por su preferencia!</span><span>${BUSINESS.short}</span></div>`;
    return thermalDoc(`Ticket - ${groupTicket}`, body);
}
