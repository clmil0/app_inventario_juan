import { supabase, showToast } from './supabase.js';

// Función para generar una fecha aleatoria en los últimos N días
function getRandomDate(daysBack) {
    const today = new Date();
    const past = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000);
    return new Date(past.getTime() + Math.random() * (today.getTime() - past.getTime())).toISOString();
}

window.generateMockData = async function() {
    const btn = document.getElementById('generate-mock-data-btn');
    const feedback = document.getElementById('mock-data-feedback');
    
    if(!confirm("¿Estás seguro de querer inyectar datos de prueba? Se generarán decenas de ventas y reparaciones ficticias.")) return;

    try {
        btn.disabled = true;
        btn.textContent = "Generando...";
        feedback.classList.remove('hidden');
        feedback.className = 'feedback-msg';
        feedback.textContent = "Obteniendo productos...";

        // 1. Obtener productos activos para usarlos en las ventas
        const { data: products, error: pError } = await supabase.from('products').select('*');
        if (pError) throw pError;
        if (!products || products.length === 0) {
            throw new Error("No hay productos en la base de datos para generar ventas.");
        }

        // 2. Generar Ventas (30 ventas en los últimos 30 días)
        feedback.textContent = "Generando 30 ventas ficticias...";
        const paymentMethods = ['Caja', 'Yape/Plin', 'Transferencia', 'POS'];
        for (let i = 0; i < 30; i++) {
            const randomDate = getRandomDate(30);
            
            const { data: saleData, error: sError } = await supabase.from('sales').insert({
                created_at: randomDate,
                subtotal_amount: 0,
                discount_amount: 0,
                total_amount: 0,
                payment_method: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
                operator_name: 'AUTO_TEST',
                customer_name: 'Cliente Prueba',
                ticket_code: `TEST_${Date.now()}_${i}` // Único temporal
            }).select().single();

            if (sError) throw sError;

            // Seleccionar 1 a 3 productos aleatorios para esta venta
            const numItems = Math.floor(Math.random() * 3) + 1;
            let totalVenta = 0;
            const itemsToInsert = [];

            for (let j = 0; j < numItems; j++) {
                const p = products[Math.floor(Math.random() * products.length)];
                const qty = Math.floor(Math.random() * 3) + 1;
                const subtotal = (parseFloat(p.sale_price) || 0) * qty;
                totalVenta += subtotal;

                itemsToInsert.push({
                    sale_id: saleData.id,
                    product_id: p.id,
                    product_name: p.name,
                    quantity: qty,
                    unit_price: p.sale_price,
                    subtotal: subtotal
                });
            }

            // Insertar los items
            await supabase.from('sale_items').insert(itemsToInsert);

            // Actualizar total y ticket de la venta definitivo
            const ticketVenta = `VT0000X${saleData.id}`;
            await supabase.from('sales').update({
                subtotal_amount: totalVenta,
                total_amount: totalVenta,
                ticket_code: ticketVenta
            }).eq('id', saleData.id);
        }

        // 3. Generar Reparaciones (15 reparaciones en los últimos 30 días)
        feedback.textContent = "Generando 15 reparaciones ficticias...";
        const repairStatuses = ['PENDIENTE', 'EN_DIAGNOSTICO', 'EN_PROCESO', 'TERMINADO', 'ENTREGADO'];
        
        for (let i = 0; i < 15; i++) {
            const randomDate = getRandomDate(30);
            const status = repairStatuses[Math.floor(Math.random() * repairStatuses.length)];
            const advance = Math.floor(Math.random() * 50);
            const total = advance + Math.floor(Math.random() * 100) + 20;

            const internalCost = Math.floor(Math.random() * 20);
            const externalCost = Math.random() > 0.7 ? Math.floor(Math.random() * 30) : 0;

            const { data: repData, error: rError } = await supabase.from('repairs').insert({
                created_at: randomDate,
                ticket_code: `TREP_${Date.now()}_${i}`, // Único temporal
                customer_name: 'Cliente Test ' + i,
                customer_phone: '99988877' + i,
                equipment_type: Math.random() > 0.5 ? 'Celular' : 'Laptop',
                brand_model: 'Marca Test Modelo ' + i,
                fault_description: 'Falla simulada AUTO_TEST',
                status: status,
                advance_payment: advance,
                total_amount: total,
                remaining_balance: total - advance,
                internal_parts_cost: internalCost,
                internal_external_cost: externalCost,
                operator_name: 'AUTO_TEST',
                advance_payment_method: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
                final_payment_method: paymentMethods[Math.floor(Math.random() * paymentMethods.length)]
            }).select().single();

            if (rError) throw rError;

            // Actualizar ticket definitivo
            const ticketRep = `RP0000X${repData.id}`;
            await supabase.from('repairs').update({ ticket_code: ticketRep }).eq('id', repData.id);

            // Historial
            await supabase.from('repair_status_history').insert({
                repair_id: repData.id,
                status: 'PENDIENTE',
                changed_by: 'AUTO_TEST',
                changed_at: randomDate
            });

            if (status !== 'PENDIENTE') {
                const d = new Date(randomDate);
                const afterDate = new Date(d.getTime() + Math.random() * 3 * 24 * 60 * 60 * 1000).toISOString();
                
                await supabase.from('repair_status_history').insert({
                    repair_id: repData.id,
                    status: status,
                    changed_by: 'AUTO_TEST',
                    changed_at: afterDate
                });

                if (status === 'ENTREGADO') {
                    await supabase.from('repairs').update({ delivered_at: afterDate }).eq('id', repData.id);
                }
            }
        }

        feedback.classList.add('success');
        feedback.textContent = "✅ ¡Datos generados con éxito! Ve al Dashboard para ver las métricas.";
        showToast("Datos de prueba inyectados", "success");

    } catch (error) {
        console.error("Error generando datos:", error);
        feedback.classList.add('error');
        feedback.textContent = "❌ Error: " + error.message;
        showToast("Error generando datos", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Generar Datos de Prueba";
    }
};

window.cleanMockData = async function() {
    const btn = document.getElementById('clean-mock-data-btn');
    const feedback = document.getElementById('mock-data-feedback');
    
    if(!confirm("¿Estás seguro de eliminar TODOS los datos generados por el script de prueba? (Los datos reales no se tocarán).")) return;

    try {
        btn.disabled = true;
        btn.textContent = "Limpiando...";
        feedback.classList.remove('hidden');
        feedback.className = 'feedback-msg';
        
        feedback.textContent = "Eliminando historiales de reparaciones ficticias...";
        // Primero eliminar historiales por clave foránea
        await supabase.from('repair_status_history').delete().eq('changed_by', 'AUTO_TEST');

        feedback.textContent = "Eliminando ventas ficticias...";
        const { error: sError } = await supabase.from('sales').delete().eq('operator_name', 'AUTO_TEST');
        if (sError) throw sError;

        feedback.textContent = "Eliminando reparaciones ficticias...";
        const { error: rError } = await supabase.from('repairs').delete().eq('operator_name', 'AUTO_TEST');
        if (rError) throw rError;

        feedback.classList.add('success');
        feedback.textContent = "✅ ¡Datos de prueba eliminados correctamente!";
        showToast("Limpieza completada", "success");

    } catch (error) {
        console.error("Error limpiando datos:", error);
        feedback.classList.add('error');
        feedback.textContent = "❌ Error: " + error.message;
        showToast("Error limpiando datos", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Limpiar Datos de Prueba";
    }
};
