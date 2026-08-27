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

    // 9. Guardar y cerrar modal
    await page.click('#save-repair-btn');
    await expect(page.locator('#repair-success-modal')).toBeVisible({ timeout: 10000 });
    await page.click('#close-repair-success-modal');
    await expect(page.locator('#toast')).toContainText('registrada(s)', { timeout: 10000 });

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
      if (!testProduct.name) {
        throw new Error("ERROR: 'testProduct' no está definido. Debes ejecutar toda la suite secuencial (desde Prueba 1), no este test de forma aislada.");
      }

      // 1. Anotar KPIs iniciales
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
      const revalorizacionEsperada = testProduct.stock * (newCost - testProduct.cost);
      
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
      if (!testProduct.name) {
        throw new Error("ERROR: 'testProduct' no está definido. Debes ejecutar toda la suite secuencial (desde Prueba 1), no este test de forma aislada.");
      }

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
      
      const newCost = Math.max(1, testProduct.cost - 3);
      const newPrice = Math.max(1, testProduct.price - 2);
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

  test.describe.serial('Módulo de Ventas (Nuevas Pruebas)', () => {
    test('Test 6: Gestión del Carrito (+, -, deshabilitar Cobrar si vacío)', async ({ page }) => {
      await page.click('button[data-view="sales"], a[data-view="sales"]');
      await expect(page.locator('#pos-main-layout')).toBeVisible();
      
      const confirmBtn = page.locator('#confirm-sale-btn');
      await expect(confirmBtn).toBeDisabled();

      const products = page.locator('#products-grid .product-card:not(.out-of-stock)');
      await expect(products.first()).toBeVisible({ timeout: 10000 });
      await products.first().click();
      
      // Aumentar cantidad
      const incBtn = page.locator('.qty-btn[data-action="inc"]').first();
      await expect(incBtn).toBeVisible();
      await incBtn.click();
      const qtyNum = page.locator('.qty-num').first();
      await expect(qtyNum).toHaveText('2');
      
      // Disminuir cantidad
      const decBtn = page.locator('.qty-btn[data-action="dec"]').first();
      await decBtn.click();
      await expect(qtyNum).toHaveText('1');

      // Eliminar (Disminuir hasta 0)
      await decBtn.click();
      await expect(page.locator('#cart-items')).toContainText('Agrega productos al carrito');
      await expect(confirmBtn).toBeDisabled();
    });

    test('Test 7: Límites de Stock en Ventas', async ({ page }) => {
      test.setTimeout(120000); // Dar más tiempo si es necesario
      
      // 1. Ir a Admin para encontrar el producto con menor stock
      const adminNavBtn = page.locator('button[data-view="admin"], a[data-view="admin"]').first();
      await page.click('#open-admin-login').catch(() => {});
      if (await page.locator('#admin-login-modal').isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.fill('#admin-login-username', process.env.ADMIN_EMAIL || '');
        await page.fill('#admin-login-password', process.env.ADMIN_PASSWORD || '');
        await page.click('#admin-login-btn');
        await expect(adminNavBtn).toBeVisible({ timeout: 10000 });
      }
      await adminNavBtn.click();
      
      const adminProducts = page.locator('#admin-products-tbody tr');
      await expect(adminProducts.first()).toBeVisible({ timeout: 10000 });
      
      let productName = '';
      let minStock = Infinity;
      const count = await adminProducts.count();
      for (let i = 0; i < count; i++) {
        const stockText = await adminProducts.nth(i).locator('td').nth(5).textContent();
        const stock = parseInt(stockText) || 0;
        if (stock > 0 && stock < minStock) {
          const productNameText = await adminProducts.nth(i).locator('td').nth(0).textContent();
          const productCodeText = await adminProducts.nth(i).locator('td').nth(0).locator('small').textContent().catch(()=>'');
          productName = productNameText.replace(productCodeText, '').trim();
          minStock = stock;
        }
      }
      expect(productName).not.toBe('');
      
      // 2. Ir a Ventas
      await page.click('button[data-view="sales"], a[data-view="sales"]');
      await expect(page.locator('#pos-main-layout')).toBeVisible();

      // Buscar el producto con menor stock
      await page.fill('#product-search', productName);
      await page.waitForTimeout(1000);
      await page.locator('.product-card').filter({ hasText: productName }).first().click();

      // Incrementar hasta llegar al límite de stock
      const incBtn = page.locator('.qty-btn[data-action="inc"]').first();
      for (let i = 0; i < minStock; i++) {
         await incBtn.click();
      }

      // Validar el toast de error
      await expect(page.locator('#toast')).toContainText('Stock máximo', { timeout: 5000 });
      
      // Limpiar carrito
      await page.click('#clear-cart-btn');
    });

    test('Test 8: Anulación / Devolución de Venta (Integridad)', async ({ page }) => {
      // 1. Tomar stock inicial del producto en Admin
      const adminNavBtn = page.locator('button[data-view="admin"], a[data-view="admin"]').first();
      await page.click('#open-admin-login').catch(() => {});
      if (await page.locator('#admin-login-modal').isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.fill('#admin-login-username', process.env.ADMIN_EMAIL || '');
        await page.fill('#admin-login-password', process.env.ADMIN_PASSWORD || '');
        await page.click('#admin-login-btn');
        await expect(adminNavBtn).toBeVisible({ timeout: 10000 });
      }
      await adminNavBtn.click();
      
      const adminProducts = page.locator('#admin-products-tbody tr');
      await expect(adminProducts.first()).toBeVisible({ timeout: 10000 });
      
      let productName = '';
      let stockInicial = 0;
      const count = await adminProducts.count();
      for (let i = 0; i < count; i++) {
        const stockTextInicial = await adminProducts.nth(i).locator('td').nth(5).textContent();
        const stock = parseInt(stockTextInicial) || 0;
        if (stock > 0) {
          const productNameText = await adminProducts.nth(i).locator('td').nth(0).textContent();
          const productCodeText = await adminProducts.nth(i).locator('td').nth(0).locator('small').textContent().catch(()=>'');
          productName = productNameText.replace(productCodeText, '').trim();
          stockInicial = stock;
          break;
        }
      }
      expect(productName).not.toBe('');

      // 2. Hacer una venta de este producto
      await page.click('button[data-view="sales"], a[data-view="sales"]');
      await expect(page.locator('#pos-main-layout')).toBeVisible();
      
      await page.fill('#product-search', productName.trim());
      await page.waitForTimeout(1000);
      await page.locator('.product-card').filter({ hasText: productName.trim() }).first().click();
      
      const cartSubtotal = page.locator('#cart-subtotal');
      await expect(cartSubtotal).not.toHaveText('S/ 0.00');

      await page.selectOption('#sale-payment-method', 'Caja');
      await page.click('#confirm-sale-btn');
      await expect(page.locator('#sale-success-modal')).toBeVisible({ timeout: 5000 });
      await page.click('#sale-success-modal .modal-close-btn');

      // 3. Tomar KPIs actuales
      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');
      await page.waitForTimeout(1000);
      
      const kpiIngresosAntes = parseFloat((await page.locator('#kpi-ingresos-ventas').textContent()).replace(/[^0-9.-]+/g, '')) || 0;

      // 4. Anular la venta
      await page.click('button[data-view="sales"], a[data-view="sales"]');
      await expect(page.locator('.all-sales-section')).toBeVisible();
      
      page.once('dialog', dialog => dialog.accept());
      await page.locator('button', { hasText: 'Anular' }).first().click();
      
      await expect(page.locator('#toast')).toContainText('anulada', { timeout: 10000 });

      // 5. Validar KPIs
      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');
      await page.waitForTimeout(1000);
      
      const kpiIngresosDespues = parseFloat((await page.locator('#kpi-ingresos-ventas').textContent()).replace(/[^0-9.-]+/g, '')) || 0;
      expect(kpiIngresosDespues).toBeLessThan(kpiIngresosAntes);

      // 6. Validar stock en Admin
      await page.click('button[data-view="admin"], a[data-view="admin"]');
      await page.fill('#admin-product-search', productName.trim());
      await page.waitForTimeout(1000);
      const stockTextFinal = await page.locator('#admin-products-tbody tr').first().locator('td').nth(5).textContent();
      const stockFinal = parseInt(stockTextFinal) || 0;
      
      expect(stockFinal).toBe(stockInicial);
    });

    test('Test 9: Métodos de Pago en Ventas', async ({ page }) => {
      await page.click('button[data-view="sales"], a[data-view="sales"]');
      await expect(page.locator('#pos-main-layout')).toBeVisible();

      const methods = ['Yape/Plin', 'Transferencia', 'POS'];
      
      for (const method of methods) {
        const products = page.locator('#products-grid .product-card:not(.out-of-stock)');
        await expect(products.first()).toBeVisible({ timeout: 10000 });
        await products.first().click();
        
        await page.selectOption('#sale-payment-method', method);
        await page.click('#confirm-sale-btn');
        await expect(page.locator('#sale-success-modal')).toBeVisible({ timeout: 5000 });
        await page.click('#sale-success-modal .modal-close-btn');
        await page.waitForTimeout(500);
      }

      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');
      await page.waitForSelector('#dash-filter-payment', { state: 'visible', timeout: 5000 });
      
      // Filtrar por Yape/Plin
      await page.selectOption('#dash-filter-payment', 'Yape/Plin');
      await page.waitForTimeout(1000); // Dar tiempo al updateKPIs
      
      const kpiIngresosYape = parseFloat((await page.locator('#kpi-ingresos-ventas').textContent()).replace(/[^0-9.-]+/g, '')) || 0;
      expect(kpiIngresosYape).toBeGreaterThan(0);
      
      // Restaurar filtro
      await page.selectOption('#dash-filter-payment', 'all');
      await page.waitForTimeout(1000);
    });
  });

  test.describe.serial('Módulo de Reparaciones (Nuevas Pruebas)', () => {
    test('Test 10: Transiciones de Estado Completas y KPIs', async ({ page }) => {
      test.setTimeout(120000); // 2 minutos máximo
      // 1. KPI Inicial
      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');
      await page.waitForTimeout(1000);
      const kpiRepIniText = await page.locator('#kpi-ganancia-reparaciones').textContent();
      const kpiRepIni = parseFloat(kpiRepIniText.replace(/[^0-9.-]+/g, '')) || 0;

      // 2. Crear nueva reparación
      await page.click('button[data-view="repairs"], a[data-view="repairs"]');
      await expect(page.locator('.all-repairs-section')).toBeVisible();

      await page.click('#new-repair-btn');
      await expect(page.locator('#new-repair-modal')).toBeVisible({ timeout: 15000 });

      await page.fill('#repair-customer', 'Cliente Estados');
      await page.fill('#repair-phone', '999888777');
      
      const eq1 = page.locator('.repair-item-block').nth(0);
      await eq1.locator('.item-eq').fill('Tablet');
      await eq1.locator('.item-brand').fill('Lenovo');
      await eq1.locator('.item-fault').fill('Pantalla rota');
      await eq1.locator('.item-total').fill('100');
      
      await page.fill('#repair-advance', '0');

      await page.click('#save-repair-btn');
      await expect(page.locator('#repair-success-modal')).toBeVisible({ timeout: 10000 });
      await page.click('#close-repair-success-modal');
      await expect(page.locator('#toast')).toContainText('registrada(s)', { timeout: 10000 });

      // 3. Cambiar estados secuencialmente
      const estados = ['EN_DIAGNOSTICO', 'EN_PROCESO', 'TERMINADO', 'ENTREGADO'];
      
      for (const estado of estados) {
        await page.locator('button[title="Cambiar Estado"]').first().click();
        await expect(page.locator('#change-status-modal')).toBeVisible();
        await page.selectOption('#new-status-select', estado);
        
        await page.click('#confirm-status-btn');
        await expect(page.locator('#toast')).toContainText('actualizado', { timeout: 5000 });
        await page.waitForTimeout(500);
      }

      // 4. Validar KPI Gan. Rep
      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');
      await page.waitForTimeout(1000);
      
      const kpiRepFinText = await page.locator('#kpi-ganancia-reparaciones').textContent();
      const kpiRepFin = parseFloat(kpiRepFinText.replace(/[^0-9.-]+/g, '')) || 0;
      
      expect(kpiRepFin).toBeCloseTo(kpiRepIni + 100, 2);
    });

    test('Test 11: Uso y Anulación de Repuestos del Inventario (Integridad)', async ({ page }) => {
      test.setTimeout(120000); // 2 minutos de máximo
      // 1. Obtener producto aleatorio
      const adminNavBtn = page.locator('button[data-view="admin"], a[data-view="admin"]').first();
      await page.click('#open-admin-login').catch(() => {});
      if (await page.locator('#admin-login-modal').isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.fill('#admin-login-username', process.env.ADMIN_EMAIL || '');
        await page.fill('#admin-login-password', process.env.ADMIN_PASSWORD || '');
        await page.click('#admin-login-btn');
        await expect(adminNavBtn).toBeVisible({ timeout: 10000 });
      }
      await adminNavBtn.click();
      const adminProducts = page.locator('#admin-products-tbody tr');
      await expect(adminProducts.first()).toBeVisible({ timeout: 10000 });
      
      let productName = '';
      let stockInicial = 0;
      const count = await adminProducts.count();
      for (let i = 0; i < count; i++) {
        const stockTextInicial = await adminProducts.nth(i).locator('td').nth(5).textContent();
        const stock = parseInt(stockTextInicial) || 0;
        if (stock > 0) {
          const productNameText = await adminProducts.nth(i).locator('td').nth(0).textContent();
          const productCodeText = await adminProducts.nth(i).locator('td').nth(0).locator('small').textContent().catch(()=>'');
          productName = productNameText.replace(productCodeText, '').trim();
          stockInicial = stock;
          break;
        }
      }
      expect(productName).not.toBe('');

      // 2. Crear reparación
      await page.click('button[data-view="repairs"], a[data-view="repairs"]');
      await page.click('#new-repair-btn');
      
      await page.fill('#repair-customer', 'Cliente Repuestos');
      await page.fill('#repair-phone', '999888777');
      const eq1 = page.locator('.repair-item-block').nth(0);
      await eq1.locator('.item-eq').fill('PC');
      await eq1.locator('.item-brand').fill('HP');
      await eq1.locator('.item-fault').fill('No enciende');
      await eq1.locator('.item-total').fill('150');
      
      await page.fill('#repair-advance', '0');
      await page.click('#save-repair-btn');
      await expect(page.locator('#repair-success-modal')).toBeVisible({ timeout: 10000 });
      await page.click('#close-repair-success-modal');
      await expect(page.locator('#toast')).toContainText('registrada(s)', { timeout: 10000 });

      // 3. Asignar Repuesto
      // Buscar específicamente la reparación que acabamos de crear para no equivocarnos
      await page.fill('#repair-global-search', 'Cliente Repuestos');
      await page.waitForTimeout(1000);
      await page.locator('button[title="Insumos"]').first().click();
      await expect(page.locator('#repair-costs-modal')).toBeVisible();
      
      // Usar expect.toPass para asegurar que el input se llena DESPUÉS de que la carga asíncrona lo limpia
      await expect(async () => {
         await page.fill('#repair-part-search', productName.trim());
         await expect(page.locator('#repair-part-dropdown .autocomplete-item').first()).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 15000 });
      
      await page.locator('#repair-part-dropdown .autocomplete-item').first().click();
      
      await page.fill('#repair-part-qty', '1');
      await page.click('#add-repair-part-btn');
      await expect(page.locator('#toast')).toContainText('asignado', { timeout: 5000 });
      
      // Esperar a que la recarga asíncrona del modal (openRepairCostsModal) termine
      await page.waitForTimeout(1500);
      await page.click('#close-repair-costs-btn');
      await expect(page.locator('#repair-costs-modal')).toBeHidden({ timeout: 5000 });

      // 4. Verificar disminución de stock
      await page.click('button[data-view="admin"], a[data-view="admin"]');
      await page.fill('#admin-product-search', productName.trim());
      await page.waitForTimeout(1000);
      let stockActual = parseInt(await page.locator('#admin-products-tbody tr').first().locator('td').nth(5).textContent()) || 0;
      expect(stockActual).toBe(stockInicial - 1);

      // 5. Anular Repuesto
      await page.click('button[data-view="repairs"], a[data-view="repairs"]');
      
      // Volver a buscar la reparación específica
      await page.fill('#repair-global-search', 'Cliente Repuestos');
      await page.waitForTimeout(1000);
      await page.locator('button[title="Insumos"]').first().click();
      await expect(page.locator('#repair-costs-modal')).toBeVisible();
      
      console.log('--- TEST 11 DEBUG: Modal visible. Esperando a que el tbody cargue repuestos ---');
      try {
          await page.waitForSelector('#repair-parts-tbody button[title="Quitar repuesto"]', { timeout: 10000 });
          console.log('--- TEST 11 DEBUG: Botón para quitar repuesto encontrado ---');
      } catch (e) {
          console.log('--- TEST 11 DEBUG ERROR: Timeout de 10s esperando el botón. HTML actual del tbody:');
          const tbodyHtml = await page.locator('#repair-parts-tbody').innerHTML();
          console.log(tbodyHtml);
      }
      
      page.once('dialog', dialog => {
          console.log('--- TEST 11 DEBUG: Diálogo interceptado y aceptado ---');
          dialog.accept();
      });
      console.log('--- TEST 11 DEBUG: Haciendo click en el botón de quitar repuesto ---');
      await page.locator('#repair-parts-tbody button[title="Quitar repuesto"]').first().click({ timeout: 15000 });
      console.log('--- TEST 11 DEBUG: Click realizado. Esperando toast ---');
      await expect(page.locator('#toast')).toContainText('stock devuelto', { timeout: 5000 });
      
      // Esperar a que la recarga asíncrona del modal (openRepairCostsModal) termine
      await page.waitForTimeout(1500);
      await page.click('#close-repair-costs-btn');
      await expect(page.locator('#repair-costs-modal')).toBeHidden({ timeout: 5000 });

      // 6. Verificar stock restaurado
      await page.click('button[data-view="admin"], a[data-view="admin"]');
      await page.fill('#admin-product-search', productName.trim());
      await page.waitForTimeout(1000);
      stockActual = parseInt(await page.locator('#admin-products-tbody tr').first().locator('td').nth(5).textContent()) || 0;
      expect(stockActual).toBe(stockInicial);
    });

    test('Test 12: Pagos y Adelantos (Doble Ingreso)', async ({ page }) => {
      // Registrar reparación con adelanto de Yape
      await page.click('button[data-view="repairs"], a[data-view="repairs"]');
      await page.click('#new-repair-btn');
      
      await page.fill('#repair-customer', 'Cliente Pagos');
      await page.fill('#repair-phone', '999888777');
      const eq1 = page.locator('.repair-item-block').nth(0);
      await eq1.locator('.item-eq').fill('Consola');
      await eq1.locator('.item-brand').fill('Sony');
      await eq1.locator('.item-fault').fill('Luz roja');
      await eq1.locator('.item-total').fill('150');
      
      await page.fill('#repair-advance', '50');
      await page.selectOption('#repair-advance-payment', 'Yape/Plin');
      
      await page.click('#save-repair-btn');
      await expect(page.locator('#repair-success-modal')).toBeVisible({ timeout: 10000 });
      await page.click('#close-repair-success-modal');
      await expect(page.locator('#toast')).toContainText('registrada(s)', { timeout: 10000 });

      // Entregar
      await page.locator('button[title="Cambiar Estado"]').first().click();
      await page.selectOption('#new-status-select', 'ENTREGADO');
      await page.click('#confirm-status-btn');
      await expect(page.locator('#toast')).toContainText('actualizado', { timeout: 5000 });
      await page.waitForTimeout(1000);
      
      // KPI check on Dashboard
      await page.click('button[data-view="dashboard"], a[data-view="dashboard"]');
      await page.click('button[data-period="today"]');
      await page.waitForTimeout(1000);
      const kpiRepresosText = await page.locator('#kpi-ingresos-reparaciones').textContent();
      const kpiRepresos = parseFloat(kpiRepresosText.replace(/[^0-9.-]+/g, '')) || 0;
      
      // Total de reparación es 150
      expect(kpiRepresos).toBeGreaterThanOrEqual(150);
    });
  });

  test.describe.serial('Módulo de Administración e Inventario (Nuevas Pruebas)', () => {
    test('Test 13: Creación de Nuevo Producto y Aumento de Stock', async ({ page }) => {
      test.setTimeout(120000); // 2 minutos máximo
      const adminNavBtn = page.locator('button[data-view="admin"], a[data-view="admin"]').first();
      await page.click('#open-admin-login').catch(() => {});
      if (await page.locator('#admin-login-modal').isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.fill('#admin-login-username', process.env.ADMIN_EMAIL || '');
        await page.fill('#admin-login-password', process.env.ADMIN_PASSWORD || '');
        await page.click('#admin-login-btn');
        await expect(adminNavBtn).toBeVisible({ timeout: 10000 });
      }
      await adminNavBtn.click();

      await page.click('#new-product-btn');
      await expect(page.locator('#new-product-modal')).toBeVisible();
      
      const uniqueCode = 'E2E-' + Date.now();
      await page.fill('#new-product-name', 'Producto Test ' + uniqueCode);
      
      const categorySelect = page.locator('#new-product-category');
      await categorySelect.locator('option').first().waitFor({ state: 'attached', timeout: 15000 });
      
      const options = await categorySelect.locator('option').allTextContents();
      if (options.length > 1 && options[0].includes('Selecciona')) {
         await categorySelect.selectOption({ index: 1 });
      } else if (options.length > 0) {
         await categorySelect.selectOption({ index: 0 });
      }
      await page.fill('#new-product-brand', 'E2E Brand');
      await page.fill('#new-product-cost', '10');
      await page.fill('#new-product-price', '20');
      await page.fill('#new-product-stock', '50');
      await page.fill('#new-product-min', '10');
      
      await page.click('#save-new-product-btn');
      await expect(page.locator('#toast')).toContainText('✅ Producto creado', { timeout: 10000 }).catch(async () => {
         // Fallback if toast text is different
         await page.waitForTimeout(1000);
      });
      
      await page.fill('#admin-product-search', uniqueCode);
      await page.waitForTimeout(1000);
      
      const newProductRow = page.locator('#admin-products-tbody tr').first();
      await expect(newProductRow).toContainText(uniqueCode);
      await expect(newProductRow).toContainText('50');
      
      // Modificar stock (Aumento)
      await newProductRow.locator('button', { hasText: '+Stock' }).click();
      await expect(page.locator('#add-stock-modal')).toBeVisible();
      
      await page.fill('#add-stock-qty', '5'); // Aumentar 5
      await page.fill('#add-stock-notes', 'Ingreso por Test');
      await page.click('#confirm-stock-btn');
      
      await expect(page.locator('#toast')).toContainText('✅ Stock actualizado', { timeout: 10000 }).catch(async () => {
         await page.waitForTimeout(1000);
      });
      
      await page.waitForTimeout(1000);
      await expect(page.locator('#admin-products-tbody tr').first().locator('td').nth(5)).toContainText('55');
    });
  });

});
