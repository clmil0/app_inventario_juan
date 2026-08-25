const { test, expect } = require('@playwright/test');

// Función auxiliar para parsear monedas (ej. "S/ 35.00" -> 35.00)
function parseCurrency(text) {
  if (!text) return 0;
  return parseFloat(text.replace(/[^0-9.-]+/g, '')) || 0;
}

test.describe.serial('E2E Tests Secuenciales', () => {

  test.beforeEach(async ({ page }) => {
    // 1. Abrir la aplicación local
    await page.goto('/index.html');
    await expect(page).toHaveTitle(/RepairTech/);

    // 1.5. Autorizar dispositivo (Login de invitado)
    await page.waitForSelector('#device-guest-email');
    await page.fill('#device-guest-email', 'invitado@cajart.com');
    await page.fill('#device-guest-password', '4Fg39a$&#,Mns"ds3dkd3$Ks2s');
    await page.click('#authorize-device-btn');

    // Esperar a que la app principal se muestre
    await expect(page.locator('.dashboard-filters')).toBeVisible({ timeout: 20000 });
  });

  test('Test 1: Validar aumento de ganancia en KPI (Costo vs Venta)', async ({ page }) => {
    await page.click('button[data-period="today"]');
    await page.waitForTimeout(1000); 

    const kpiLocator = page.locator('#kpi-ganancia-ventas');
    const kpiInicialText = await kpiLocator.textContent();
    const kpiInicial = parseCurrency(kpiInicialText);

    await page.click('button[data-view="sales"], a[data-view="sales"]');
    await expect(page.locator('#pos-main-layout')).toBeVisible();
    
    await page.click('#pos-view-cost');
    await page.waitForSelector('#products-grid .product-card');

    const product = page.locator('#products-grid .product-card:not(.out-of-stock)').first();
    await product.click();

    const profitLocator = page.locator('#cart-total-profit');
    // IMPORTANTE: Esperar a que no sea 0.00 para asegurar que se calculó la ganancia
    await expect(profitLocator).not.toHaveText('S/ 0.00', { timeout: 5000 }); 
    const profitText = await profitLocator.textContent();
    const gananciaVenta = parseCurrency(profitText);
    
    await page.selectOption('#sale-payment-method', 'Caja');
    await page.click('#confirm-sale-btn');
    
    await expect(page.locator('#sale-success-modal')).toBeVisible({ timeout: 5000 });
    await page.click('#sale-success-modal .modal-close-btn');

    await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
    await expect(page.locator('.dashboard-filters')).toBeVisible();
    await page.waitForTimeout(2000); // Esperar que refresque

    const kpiFinalText = await kpiLocator.textContent();
    const kpiFinal = parseCurrency(kpiFinalText);

    expect(kpiFinal).toBeCloseTo(kpiInicial + gananciaVenta, 2);
  });

  test('Test 2: Venta múltiple (Dos productos)', async ({ page }) => {
    await page.click('button[data-view="sales"], a[data-view="sales"]');
    await expect(page.locator('#pos-main-layout')).toBeVisible();
    await page.waitForSelector('#products-grid .product-card');

    const products = page.locator('#products-grid .product-card:not(.out-of-stock)');
    const count = await products.count();
    
    if (count > 0) await products.nth(0).click();
    if (count > 1) await products.nth(1).click();
    else if (count === 1) await products.nth(0).click();

    const cartSubtotal = page.locator('#cart-subtotal');
    await expect(cartSubtotal).not.toHaveText('S/ 0.00');

    await page.selectOption('#sale-payment-method', 'Caja');
    await page.click('#confirm-sale-btn');
    await expect(page.locator('#sale-success-modal')).toBeVisible({ timeout: 5000 });
  });

  test('Test 3: Venta con descuento', async ({ page }) => {
    await page.click('button[data-view="sales"], a[data-view="sales"]');
    await expect(page.locator('#pos-main-layout')).toBeVisible();
    await page.waitForSelector('#products-grid .product-card');

    await page.locator('#products-grid .product-card:not(.out-of-stock)').first().click();

    // Esperar a que el carrito cargue
    const cartSubtotalLoc = page.locator('#cart-subtotal');
    await expect(cartSubtotalLoc).not.toHaveText('S/ 0.00');
    
    const subtotalText = await cartSubtotalLoc.textContent();
    const subtotal = parseCurrency(subtotalText);
    
    const descuento = 2; 
    await page.fill('#sale-discount', descuento.toString());
    await page.locator('#sale-discount').press('Tab');
    
    // El carrito se recalcula automáticamente y el descuento aparece en la UI
    await expect(page.locator('#cart-discount-amount')).toBeVisible();

    const totalText = await page.locator('#cart-total-amount').textContent();
    const total = parseCurrency(totalText);

    expect(total).toBeCloseTo(subtotal - descuento, 2);

    await page.selectOption('#sale-payment-method', 'Caja');
    await page.click('#confirm-sale-btn');
    await expect(page.locator('#sale-success-modal')).toBeVisible({ timeout: 5000 });
  });

  test('Test 4: Verificación de filtros de fecha en el Dashboard', async ({ page }) => {
    await page.click('button[data-period="today"]');
    await page.waitForTimeout(1000); 
    const kpiHoy = await page.locator('#kpi-ganancia-ventas').textContent();
    
    await page.click('button[data-period="yesterday"]');
    await page.waitForTimeout(1000); 
    const kpiAyer = await page.locator('#kpi-ganancia-ventas').textContent();

    await expect(page.locator('button[data-period="yesterday"]')).toHaveClass(/active/);
    await expect(page.locator('button[data-period="today"]')).not.toHaveClass(/active/);
    
    expect(kpiHoy).toBeDefined();
    expect(kpiAyer).toBeDefined();
  });

  test('Test 5: Validar flujo de reparaciones múltiples, ganancia y validación de celular', async ({ page }) => {
    // 1. Ir a dashboard y obtener KPI de reparaciones
    await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
    await page.click('button[data-period="today"]');
    await page.waitForTimeout(1000);
    const kpiRepairsLocator = page.locator('#kpi-ganancia-reparaciones');
    const kpiRepairsInicialText = await kpiRepairsLocator.textContent();
    const kpiRepairsInicial = parseCurrency(kpiRepairsInicialText);

    // 2. Ir a reparaciones
    await page.click('button[data-view="repairs"], a[data-view="repairs"]');
    await expect(page.locator('.all-repairs-section')).toBeVisible();

    // 3. Nueva reparación
    await page.click('#new-repair-btn');
    await expect(page.locator('#new-repair-modal')).toBeVisible();

    // 4. Validar celular (menos de 9 dígitos)
    await page.fill('#repair-customer', 'Cliente Prueba E2E');
    await page.fill('#repair-phone', '12345678');
    
    // Llenar Equipo 1
    const eq1 = page.locator('.repair-item-block').nth(0);
    await eq1.locator('.item-eq').fill('Laptop');
    await eq1.locator('.item-brand').fill('Asus');
    await eq1.locator('.item-total').fill('100');
    await eq1.locator('.item-fault').fill('No enciende');

    // Intentar guardar con celular inválido
    await page.click('#save-repair-btn');
    await expect(page.locator('#toast')).toContainText('exactamente 9 dígitos');
    await page.waitForTimeout(1000);

    // 5. Corregir celular a 9 dígitos
    await page.fill('#repair-phone', '987654321');

    // 6. Agregar segundo equipo
    await page.click('#add-repair-item-btn');
    const eq2 = page.locator('.repair-item-block').nth(1);
    await eq2.locator('.item-eq').fill('Celular');
    await eq2.locator('.item-brand').fill('iPhone');
    await eq2.locator('.item-total').fill('200');
    await eq2.locator('.item-fault').fill('Pantalla rota');

    // 7. Agregar gasto externo al segundo equipo
    const gastoExterno = 50;
    await eq2.locator('.toggle-inline-costs-btn').click();
    await eq2.locator('.inline-cost-concept').fill('Repuesto externo');
    await eq2.locator('.inline-cost-amount').fill(gastoExterno.toString());
    await eq2.locator('.add-inline-cost-btn').click();
    await expect(eq2.locator('.inline-costs-tbody')).toContainText('Repuesto externo');

    // 8. Adelanto total (Ganancia calculada = Adelanto - Gastos)
    const adelanto = 150;
    const gananciaEsperada = adelanto - gastoExterno;
    await page.fill('#repair-advance', adelanto.toString());

    // 9. Guardar y manejar confirmación de impresión
    page.once('dialog', dialog => dialog.accept());
    await page.click('#save-repair-btn');
    await expect(page.locator('#toast')).toContainText('registrada(s)');

    // 10. Volver a dashboard y validar ganancia
    await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
    await page.click('button[data-period="today"]');
    await page.waitForTimeout(2000);

    const kpiRepairsFinalText = await kpiRepairsLocator.textContent();
    const kpiRepairsFinal = parseCurrency(kpiRepairsFinalText);

    expect(kpiRepairsFinal).toBeCloseTo(kpiRepairsInicial + gananciaEsperada, 2);
  });

  test.describe.serial('Pruebas de Contabilidad (Lógica de Revalorización)', () => {
    let testProduct = { id: 0, name: '', cost: 0, price: 0, stock: 0 };

    async function goToAdmin(page) {
      const adminNavBtn = page.locator('a[data-view="admin"]');
      if (await adminNavBtn.isVisible()) {
        await adminNavBtn.click();
      } else {
        await page.click('#open-admin-login');
        const adminModal = page.locator('#admin-login-modal');
        await expect(adminModal).toBeVisible({ timeout: 5000 });
        
        await page.fill('#admin-login-username', process.env.ADMIN_EMAIL || '');
        await page.fill('#admin-login-password', process.env.ADMIN_PASSWORD || '');
        await page.click('#admin-login-btn');
        
        await expect(adminNavBtn).toBeVisible({ timeout: 10000 });
        await adminNavBtn.click();
      }
      const adminProducts = page.locator('#admin-products');
      await expect(adminProducts).toBeVisible({ timeout: 10000 });
    }

    test.beforeEach(async ({ page }) => {
      test.setTimeout(90000);
      await page.goto('/index.html');
      await expect(page).toHaveTitle(/RepairTech/);
      
      // Intentar login por si la sesión caducó o es un contexto nuevo
      await page.waitForSelector('#device-guest-email', { timeout: 3000 }).catch(() => {});
      const emailInput = page.locator('#device-guest-email');
      if (await emailInput.isVisible()) {
        await emailInput.fill(process.env.GUEST_EMAIL || '');
        await page.fill('#device-guest-password', process.env.GUEST_PASSWORD || '');
        await page.click('#authorize-device-btn');
      }
      await expect(page.locator('.dashboard-filters')).toBeVisible({ timeout: 20000 });
    });

    test('Prueba 1: Venta Estándar (Aleatoria) y KPIs', async ({ page }) => {
      // 1. Obtener un producto al azar con stock >= 3
      await goToAdmin(page);
      
      await page.waitForSelector('#admin-products-tbody tr', { state: 'visible', timeout: 10000 });
      
      const rows = page.locator('#admin-products-tbody tr');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const tds = row.locator('td');
        if (await tds.count() < 6) continue;
        
        const stockText = await tds.nth(5).innerText();
        const stockNum = parseInt(stockText) || 0;
        if (stockNum >= 3) {
          const btn = row.locator('button', { hasText: '+Stock' });
          if (await btn.isVisible()) {
              const onclickAttr = await btn.getAttribute('onclick');
              const match = onclickAttr?.match(/openAddStock\((\d+),\s*'([^']+)',\s*([\d.]+),\s*([\d.]+)\)/);
              if (match) {
                 testProduct = {
                    id: parseInt(match[1]),
                    name: match[2],
                    cost: parseFloat(match[3]),
                    price: parseFloat(match[4]),
                    stock: stockNum
                 };
                 break;
              }
          }
        }
      }
      expect(testProduct.name).not.toBe('');

      // 2. Anotar KPIs iniciales
      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');
      await page.waitForTimeout(1000);
      
      const kpiVentasIni = parseCurrency(await page.locator('#kpi-ganancia-ventas').textContent());
      const kpiIngresosIni = parseCurrency(await page.locator('#kpi-ingresos-ventas').textContent());
      console.log(`[Prueba 1] Producto elegido: ${testProduct.name} (Stock: ${testProduct.stock}, Costo: ${testProduct.cost}, Venta: ${testProduct.price})`);
      console.log(`[Prueba 1] Valores Iniciales -> Ganancia Ventas: ${kpiVentasIni}, Ingresos Ventas: ${kpiIngresosIni}`);

      // 3. Vender 1 unidad
      await page.click('button[data-view="sales"], a[data-view="sales"]');
      await expect(page.locator('#pos-main-layout')).toBeVisible();
      
      await page.fill('#product-search', testProduct.name);
      await page.waitForTimeout(1000);
      await page.locator('.product-card').filter({ hasText: testProduct.name }).first().click();
      
      await page.selectOption('#sale-payment-method', 'Caja');
      await page.click('#confirm-sale-btn');
      await expect(page.locator('#sale-success-modal')).toBeVisible({ timeout: 5000 });
      await page.click('#sale-success-modal .modal-close-btn');

      // 4. Validar que la ganancia e ingresos coincidan con lo vendido
      const gananciaEsperada = testProduct.price - testProduct.cost;
      const ingresoEsperado = testProduct.price;
      testProduct.stock -= 1; // Actualizar modelo mental

      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');
      await page.waitForTimeout(2000);
      
      const kpiVentasFin = parseCurrency(await page.locator('#kpi-ganancia-ventas').textContent());
      const kpiIngresosFin = parseCurrency(await page.locator('#kpi-ingresos-ventas').textContent());
      
      console.log(`[Prueba 1] Valores Finales -> Ganancia Ventas: ${kpiVentasFin} (Esperado: ${kpiVentasIni + gananciaEsperada}), Ingresos Ventas: ${kpiIngresosFin} (Esperado: ${kpiIngresosIni + ingresoEsperado})`);
      
      expect(kpiVentasFin).toBeCloseTo(kpiVentasIni + gananciaEsperada, 2);
      expect(kpiIngresosFin).toBeCloseTo(kpiIngresosIni + ingresoEsperado, 2);

      // 5. Validar que el stock haya bajado en admin
      await goToAdmin(page);
      await page.fill('#admin-product-search', testProduct.name);
      await page.waitForTimeout(1000);
      const row = page.locator('#admin-products-tbody tr').filter({ hasText: testProduct.name }).first();
      const stockActual = await row.locator('td').nth(5).innerText();
      expect(stockActual).toContain(String(testProduct.stock));
    });

    test('Prueba 2 y 3: Revalorización (+1 Costo, +2 Venta) y Nueva Venta', async ({ page }) => {
      // 1. Anotar KPIs
      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');
      await page.waitForTimeout(1000);
      
      const kpiTotalIni = parseCurrency(await page.locator('#kpi-ganancia-total').textContent());
      const kpiVentasIni = parseCurrency(await page.locator('#kpi-ganancia-ventas').textContent());
      const kpiInvVentasIni = parseCurrency(await page.locator('#kpi-invertido-ventas').textContent());
      const kpiIngresosIni = parseCurrency(await page.locator('#kpi-ingresos-ventas').textContent());
      const kpiTotalVentasIni = parseInt(await page.locator('#kpi-total-ventas').textContent()) || 0;
      
      console.log(`[Prueba 2] Valores Iniciales -> Inv. Ventas: ${kpiInvVentasIni}, Ganancia Total: ${kpiTotalIni}, Ganancia Ventas: ${kpiVentasIni}, Ingresos Ventas: ${kpiIngresosIni}`);
      console.log(`[Prueba 2] Estado inicial del producto -> Stock: ${testProduct.stock}, Costo: ${testProduct.cost}, Venta: ${testProduct.price}`);

      // 2. Aumentar stock (+1), Costo (+1), Precio (+2)
      await goToAdmin(page);
      await page.fill('#admin-product-search', testProduct.name);
      await page.waitForTimeout(1000);
      
      const newCost = testProduct.cost + 1;
      const newPrice = testProduct.price + 2;
      console.log(`[Prueba 2] Enviando actualización -> Stock: +1, Nuevo Costo: ${newCost} (+1), Nueva Venta: ${newPrice} (+2)`);

      await page.locator('#admin-products-tbody tr').filter({ hasText: testProduct.name }).first().locator('button', { hasText: '+Stock' }).click();
      await expect(page.locator('#add-stock-modal')).toBeVisible();
      
      await page.fill('#add-stock-qty', '1');
      await page.check('#stock-price-update');
      await page.fill('#add-stock-new-cost', String(newCost));
      await page.fill('#add-stock-new-sale', String(newPrice));
      await page.click('#confirm-stock-btn');
      await expect(page.locator('#toast')).toContainText('y nuevos precios actualizados', { timeout: 10000 });

      // Validar aumento en valor inventario basado en el stock anterior
      // El incremento total en inventario es la nueva unidad + el aumento de precio de costo a las unidades antiguas
      const aumentoInventarioEsperado = (testProduct.stock * (newCost - testProduct.cost)) + (1 * newCost); 
      testProduct.stock += 1;
      testProduct.cost = newCost;
      testProduct.price = newPrice;

      // 3. Validar KPIs post-revalorización (antes de vender)
      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');
      
      let kpiInvVentasMid, kpiTotalMid, kpiVentasMid, kpiIngresosMid, kpiTotalVentasMid;
      await expect(async () => {
        kpiInvVentasMid = parseCurrency(await page.locator('#kpi-invertido-ventas').textContent());
        kpiTotalMid = parseCurrency(await page.locator('#kpi-ganancia-total').textContent());
        kpiVentasMid = parseCurrency(await page.locator('#kpi-ganancia-ventas').textContent());
        kpiIngresosMid = parseCurrency(await page.locator('#kpi-ingresos-ventas').textContent());
        kpiTotalVentasMid = parseInt(await page.locator('#kpi-total-ventas').textContent()) || 0;
        
        expect(kpiInvVentasMid).toBeCloseTo(kpiInvVentasIni + aumentoInventarioEsperado, 2);
      }).toPass({ timeout: 10000 });

      console.log(`[Prueba 2] Valores Mid -> Inv. Ventas: ${kpiInvVentasMid} (Esperado: ${kpiInvVentasIni + aumentoInventarioEsperado}), Ganancia Total: ${kpiTotalMid}`);
      
      const revalorizacionEsperada = (testProduct.stock - 1) * (newCost - testProduct.cost); // (testProduct.stock ya incluye el +1)
      expect(kpiTotalMid).toBeCloseTo(kpiTotalIni + revalorizacionEsperada, 2);
      expect(kpiVentasMid).toBeCloseTo(kpiVentasIni, 2);
      expect(kpiIngresosMid).toBeCloseTo(kpiIngresosIni, 2);
      expect(kpiTotalVentasMid).toBe(kpiTotalVentasIni);

      // Guardamos este nuevo punto en el tiempo para la Prueba 3
      console.log(`[Prueba 3] Iniciando venta con nuevos valores revalorizados...`);

      // 4. Vender 1 unidad con el nuevo precio (Prueba 3 integrada)
      await page.click('button[data-view="sales"], a[data-view="sales"]');
      await expect(page.locator('#pos-main-layout')).toBeVisible();
      
      await page.fill('#product-search', testProduct.name);
      await page.waitForTimeout(1000);
      await page.locator('.product-card').filter({ hasText: testProduct.name }).first().click();
      await page.selectOption('#sale-payment-method', 'Caja');
      await page.click('#confirm-sale-btn');
      await expect(page.locator('#sale-success-modal')).toBeVisible({ timeout: 5000 });
      await page.click('#sale-success-modal .modal-close-btn');

      const nuevaGanancia = testProduct.price - testProduct.cost;
      const nuevoIngreso = testProduct.price;
      const disminucionInv = testProduct.cost;
      testProduct.stock -= 1;

      // 5. Validar KPIs post-venta
      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');

      let kpiInvVentasFin, kpiVentasFin, kpiIngresosFin;
      await expect(async () => {
        kpiInvVentasFin = parseCurrency(await page.locator('#kpi-invertido-ventas').textContent());
        kpiVentasFin = parseCurrency(await page.locator('#kpi-ganancia-ventas').textContent());
        kpiIngresosFin = parseCurrency(await page.locator('#kpi-ingresos-ventas').textContent());
        
        expect(kpiInvVentasFin).toBeCloseTo(kpiInvVentasMid - disminucionInv, 2);
      }).toPass({ timeout: 10000 });
      
      console.log(`[Prueba 3] Valores Finales (Venta post-revalorización) ->`);
      console.log(`   - Inv. Ventas bajó a: ${kpiInvVentasFin} (Esperado: ${kpiInvVentasMid - disminucionInv} por salida de inventario de ${disminucionInv})`);
      console.log(`   - Ganancia Ventas subió a: ${kpiVentasFin} (Esperado: ${kpiVentasIni + nuevaGanancia} por nueva ganancia de ${nuevaGanancia})`);
      console.log(`   - Ingresos Ventas subió a: ${kpiIngresosFin} (Esperado: ${kpiIngresosIni + nuevoIngreso} por nuevo ingreso de ${nuevoIngreso})`);
      
      expect(kpiInvVentasFin).toBeCloseTo(kpiInvVentasMid - disminucionInv, 2);
      expect(kpiVentasFin).toBeCloseTo(kpiVentasIni + nuevaGanancia, 2);
      expect(kpiIngresosFin).toBeCloseTo(kpiIngresosIni + nuevoIngreso, 2);
    });

    test('Prueba 4: Devaluación (-3 Costo, -2 Venta)', async ({ page }) => {
      // 1. Anotar KPIs
      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');
      await page.waitForTimeout(1000);
      
      const kpiTotalIni = parseCurrency(await page.locator('#kpi-ganancia-total').textContent());
      const kpiInvVentasIni = parseCurrency(await page.locator('#kpi-invertido-ventas').textContent());
      
      console.log(`[Prueba 4] Valores Iniciales -> Inv. Ventas: ${kpiInvVentasIni}, Ganancia Total (Incl. Inventario): ${kpiTotalIni}`);
      console.log(`[Prueba 4] Estado inicial del producto -> Stock: ${testProduct.stock}, Costo: ${testProduct.cost}, Venta: ${testProduct.price}`);

      // 2. Aumentar stock (+1), Costo (-3), Precio (-2)
      await goToAdmin(page);
      await page.fill('#admin-product-search', testProduct.name);
      await page.waitForTimeout(1000);
      
      const newCost = Math.max(0, testProduct.cost - 3);
      const newPrice = Math.max(0, testProduct.price - 2);
      const diffCosto = newCost - testProduct.cost;
      console.log(`[Prueba 4] Enviando actualización -> Stock: +1, Nuevo Costo: ${newCost} (-3), Nueva Venta: ${newPrice} (-2)`);

      await page.locator('#admin-products-tbody tr').filter({ hasText: testProduct.name }).first().locator('button', { hasText: '+Stock' }).click();
      await expect(page.locator('#add-stock-modal')).toBeVisible();
      
      await page.fill('#add-stock-qty', '1');
      await page.check('#stock-price-update');
      await page.fill('#add-stock-new-cost', String(newCost));
      await page.fill('#add-stock-new-sale', String(newPrice));
      await page.click('#confirm-stock-btn');
      await expect(page.locator('#toast')).toContainText('y nuevos precios actualizados', { timeout: 10000 });

      const perdidaEsperada = (testProduct.stock * diffCosto) + (1 * newCost);
      
      testProduct.stock += 1;
      testProduct.cost = newCost;
      testProduct.price = newPrice;

      // 3. Validar KPI Total (que haya caído)
      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');

      let kpiTotalFin, kpiInvVentasFin;
      await expect(async () => {
        kpiTotalFin = parseCurrency(await page.locator('#kpi-ganancia-total').textContent());
        kpiInvVentasFin = parseCurrency(await page.locator('#kpi-invertido-ventas').textContent());
        
        expect(kpiInvVentasFin).toBeCloseTo(kpiInvVentasIni + perdidaEsperada, 2);
      }).toPass({ timeout: 10000 });
      
      console.log(`[Prueba 4] Valores Finales (Devaluación) -> Inv. Ventas: ${kpiInvVentasFin} (Esperado: ${kpiInvVentasIni + perdidaEsperada} por pérdida de inv. de ${perdidaEsperada})`);
      
      const perdidaGananciaEsperada = (testProduct.stock - 1) * diffCosto;
      expect(kpiTotalFin).toBeCloseTo(kpiTotalIni + perdidaGananciaEsperada, 2);
    });
  });

});
