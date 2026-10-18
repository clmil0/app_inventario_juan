const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Función auxiliar para parsear monedas (ej. "S/ 1,235.00" -> 1235.00)
function parseCurrency(text) {
  if (!text) return 0;
  return parseFloat(text.replace(/[^0-9.-]+/g, '')) || 0;
}

// ─── Navegación ─────────────────────────────
async function goTo(page, view) {
  await closeDrawer(page);
  await page.click(`#nav-${view}`);
}

// Los drawers laterales (detalle de venta / ticket) tapan la navegación con su backdrop
async function closeDrawer(page) {
  if (await page.locator('.ui-drawer:not(.closing)').count()) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.ui-drawer')).toHaveCount(0, { timeout: 5000 });
  }
}

async function goToDashboard(page) {
  await goTo(page, 'dashboard');
  await expect(page.locator('#dash-periods')).toBeVisible();
  await page.click('#dash-periods [data-period="today"]');
  await page.waitForTimeout(1200); // carga de datos
}

async function goToSales(page) {
  await goTo(page, 'sales');
  await expect(page.locator('#pos-main-layout')).toBeVisible();
}

async function goToRepairs(page) {
  await goTo(page, 'repairs');
  await expect(page.locator('#new-repair-btn')).toBeVisible();
}

async function goToAdmin(page) {
  await goTo(page, 'admin');
  await expect(page.locator('#admin-products')).toBeVisible({ timeout: 10000 });
  await expect(adminRows(page).first()).toBeVisible({ timeout: 10000 });
}

// Algunos KPIs se animan (countTo): leer hasta que el valor deje de cambiar
async function readKpi(page, selector) {
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const t = await page.locator(selector).textContent();
    if (t === prev) return parseCurrency(t);
    prev = t;
    await page.waitForTimeout(300);
  }
  return parseCurrency(prev);
}

// ─── Administración: filas de productos ─────
// Columnas: 0 nombre/código · 1 marca · 2 categoría · 3 costo · 4 venta · 5 stock · 6 mín · 7 acciones
const adminRows = page => page.locator('#admin-products-tbody .ui-tr');
const adminCell = (row, i) => row.locator(':scope > span').nth(i);
const adminName = async row => (await row.locator('.ui-cell-2 > span').first().textContent()).trim();
const adminStock = async row => parseInt(await adminCell(row, 5).textContent()) || 0;

async function searchAdmin(page, text) {
  await page.fill('#admin-product-search', text);
  await page.waitForTimeout(500);
  return adminRows(page).filter({ hasText: text }).first();
}

// ─── Ventas ─────────────────────────────────
const availableCards = page => page.locator('#products-grid .pos-card:not(.blocked)');

async function addProductByName(page, name) {
  await page.fill('#product-search', name);
  await page.waitForTimeout(500);
  await page.locator('#products-grid .pos-card:not(.blocked)').filter({ hasText: name }).first().click();
}

async function confirmSale(page, method = 'Caja') {
  await page.click(`#pos-pay-options [data-pay="${method}"]`);
  await expect(page.locator('#sale-payment-method')).toHaveValue(method);
  await page.click('#confirm-sale-btn');
  const toast = page.locator('#sale-toast');
  await expect(toast).toBeVisible({ timeout: 5000 });
  // El toast de venta se queda 6 s sobre el carrito: cerrarlo para no tapar botones
  await toast.locator('.close').click();
  await expect(toast).toBeHidden();
}

// ─── Reparaciones ───────────────────────────
// El tipo de equipo es un input hidden que se fija con chips [data-type]
async function setEquipmentType(block, type) {
  const chip = block.locator(`[data-type="${type}"]`);
  if (await chip.count()) await chip.click();
  else await block.locator('[data-type]').first().click();
}

async function fillRepairItem(block, { type, brand, fault, total }) {
  await setEquipmentType(block, type);
  await block.locator('.item-brand').fill(brand);
  await block.locator('.item-fault').fill(fault);
  await block.locator('.item-total').fill(String(total));
}

async function saveRepair(page) {
  const hasActiveStatus = await page.locator('#nr-initial-status .ui-chip.active').count();
  if (!hasActiveStatus) {
    await page.click('#nr-initial-status [data-initial-status="PENDIENTE"]');
  }
  await page.click('#save-repair-btn');
  // Ya no hay modal de éxito: se cierra el formulario, sale el toast y se imprime el recibo
  await expect(page.locator('#toast')).toContainText('registrada', { timeout: 10000 });
  await expect(page.locator('#new-repair-modal')).toBeHidden();
}

async function openTicket(page, customer) {
  await closeDrawer(page);
  await page.fill('#repair-global-search', customer);
  await page.waitForTimeout(500);
  await page.locator('.rep-card').filter({ hasText: customer }).first().click();
  await expect(page.locator('.ui-drawer')).toBeVisible();
}

async function changeStatus(page, estado) {
  await page.locator('.ui-drawer [data-st]').first().click();
  await expect(page.locator('#change-status-modal')).toBeVisible();
  await page.click(`#cs-options [data-cs="${estado}"]`);
  await page.click('#confirm-status-btn');
  await expect(page.locator('#toast')).toContainText('Estado:', { timeout: 5000 });
  await page.waitForTimeout(500);
}

test.describe.serial('E2E Tests Secuenciales', () => {
  const testDbPath = path.join(__dirname, '..', 'test_data.db');

  test.beforeAll(() => {
    // Conectarse y sembrar datos de prueba (el esquema lo crea `npm test` con init_db.js)
    const db = new Database(testDbPath);

    // Solo sembrar si no hay productos (para evitar duplicados en tests seriales si fallan)
    const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
    if (count === 0) {
      const stmtCat = db.prepare("INSERT INTO categories (name) VALUES ('Pantallas')");
      const catResult = stmtCat.run();

      const stmtProd = db.prepare(`
        INSERT INTO products (code, name, brand, cost_price, sale_price, stock, min_stock, category_id, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);

      stmtProd.run('TEST-001', 'Pantalla iPhone 13', 'Apple', 100, 250, 50, 5, catResult.lastInsertRowid);
      stmtProd.run('TEST-002', 'Batería Samsung S22', 'Samsung', 40, 90, 20, 5, catResult.lastInsertRowid);
      stmtProd.run('TEST-003', 'Mica de Vidrio Universal', 'Genérico', 5, 15, 100, 10, catResult.lastInsertRowid);
    }
    db.close();
  });
  test.afterAll(() => {
    // Limpiar la base de datos de pruebas para no dejar basura
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => { if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text()); });
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    // Aceptar los confirm() de la app (anular venta, quitar repuesto...)
    page.on('dialog', dialog => dialog.accept());

    await page.goto('/index.html');
    await expect(page).toHaveTitle(/inventariopro|Juan José/i);

    // Autorizar dispositivo con la cuenta admin sembrada por el esquema (juan / juan123)
    await page.waitForSelector('#device-guest-email');
    await page.fill('#device-guest-email', 'juan');
    await page.fill('#device-guest-password', 'juan123');
    await page.click('#authorize-device-btn');

    // Admin aterriza en el Resumen
    await expect(page.locator('#dash-periods')).toBeVisible({ timeout: 20000 });
  });

  test('Test 1: Validar aumento de ganancia en KPI (Costo vs Venta)', async ({ page }) => {
    await page.click('#dash-periods [data-period="today"]');
    await page.waitForTimeout(1000);

    const kpiInicial = await readKpi(page, '#kpi-ganancia-ventas');

    await goToSales(page);
    await page.click('#pos-view-cost');
    await availableCards(page).first().click();

    const profitLocator = page.locator('#cart-total-profit');
    // Esperar a que no sea 0.00 para asegurar que se calculó la ganancia
    await expect(profitLocator).not.toHaveText('S/ 0.00', { timeout: 5000 });
    const gananciaVenta = parseCurrency(await profitLocator.textContent());

    await confirmSale(page, 'Caja');

    await goToDashboard(page);
    await expect(page.locator('#kpi-ganancia-ventas')).not.toHaveText('S/ 0.00', { timeout: 10000 });
    const kpiFinal = await readKpi(page, '#kpi-ganancia-ventas');

    expect(kpiFinal).toBeCloseTo(kpiInicial + gananciaVenta, 2);
  });

  test('Test 2: Venta múltiple (Dos productos)', async ({ page }) => {
    await goToSales(page);
    const products = availableCards(page);
    await expect(products.first()).toBeVisible({ timeout: 10000 });
    const count = await products.count();

    if (count > 0) await products.nth(0).click();
    if (count > 1) await products.nth(1).click();
    else if (count === 1) await products.nth(0).click();

    await expect(page.locator('#cart-subtotal')).not.toHaveText('S/ 0.00');
    await expect(page.locator('#cart-items .pos-cart-row')).toHaveCount(Math.min(count, 2));

    await confirmSale(page, 'Caja');
  });

  test('Test 3: Venta con descuento', async ({ page }) => {
    await goToSales(page);
    await availableCards(page).first().click();

    const cartSubtotalLoc = page.locator('#cart-subtotal');
    await expect(cartSubtotalLoc).not.toHaveText('S/ 0.00');
    const subtotal = parseCurrency(await cartSubtotalLoc.textContent());

    const descuento = 2;
    await page.fill('#sale-discount', descuento.toString());
    await page.locator('#sale-discount').press('Tab');

    // El carrito se recalcula automáticamente y el descuento aparece en la UI
    await expect(page.locator('#cart-discount-amount')).toBeVisible();
    const total = parseCurrency(await page.locator('#cart-total-amount').textContent());
    expect(total).toBeCloseTo(subtotal - descuento, 2);

    await confirmSale(page, 'Caja');
  });

  test('Test 4: Verificación de filtros de fecha en el Dashboard', async ({ page }) => {
    await page.click('#dash-periods [data-period="today"]');
    const kpiHoy = await readKpi(page, '#kpi-ingresos-ventas');

    // El rediseño ya no tiene "Ayer": comparar Hoy contra Semana
    await page.click('#dash-periods [data-period="week"]');
    const kpiSemana = await readKpi(page, '#kpi-ingresos-ventas');

    await expect(page.locator('#dash-periods [data-period="week"]')).toHaveClass(/active/);
    await expect(page.locator('#dash-periods [data-period="today"]')).not.toHaveClass(/active/);

    expect(kpiSemana).toBeGreaterThanOrEqual(kpiHoy);
  });

  test('Test 5: Validar flujo de reparaciones múltiples, ganancia y validación de celular', async ({ page }) => {
    // 1. KPI de reparaciones inicial
    await goToDashboard(page);
    const kpiRepairsInicial = await readKpi(page, '#kpi-ganancia-reparaciones');

    // 2. Nueva reparación
    await goToRepairs(page);
    await page.click('#new-repair-btn');
    await expect(page.locator('#new-repair-modal')).toBeVisible();

    // 3. Validar celular (menos de 9 dígitos)
    await page.fill('#repair-customer', 'Cliente Prueba E2E');
    await page.fill('#repair-phone', '12345678');

    // Validar que por defecto ningún estado inicial está seleccionado
    expect(await page.locator('#nr-initial-status .ui-chip.active').count()).toBe(0);

    const eq1 = page.locator('.repair-item-block').nth(0);
    await fillRepairItem(eq1, { type: 'Laptop', brand: 'Asus', fault: 'No enciende', total: 100 });

    await page.click('#save-repair-btn');
    await expect(page.locator('#toast')).toContainText('exactamente 9 dígitos');
    await page.waitForTimeout(1000);

    // 4. Corregir celular a 9 dígitos y validar que exige estado inicial
    await page.fill('#repair-phone', '987654321');
    await page.click('#save-repair-btn');
    await expect(page.locator('#toast')).toContainText('estado inicial');
    await page.waitForTimeout(1000);

    // Seleccionar estado inicial
    await page.click('#nr-initial-status [data-initial-status="PENDIENTE"]');

    // 5. Segundo equipo
    await page.click('#add-repair-item-btn');
    const eq2 = page.locator('.repair-item-block').nth(1);
    await fillRepairItem(eq2, { type: 'Celular', brand: 'iPhone', fault: 'Pantalla rota', total: 200 });

    // 6. Gasto externo al segundo equipo
    const gastoExterno = 50;
    await eq2.locator('.toggle-inline-costs-btn').click();
    await eq2.locator('.inline-cost-concept').fill('Repuesto externo');
    await eq2.locator('.inline-cost-amount').fill(gastoExterno.toString());
    await eq2.locator('.add-inline-cost-btn').click();
    await expect(eq2.locator('.inline-costs-tbody')).toContainText('Repuesto externo');

    // 7. Adelanto (Ganancia calculada = Adelanto - Gastos)
    const adelanto = 150;
    const gananciaEsperada = adelanto - gastoExterno;
    await page.fill('#repair-advance', adelanto.toString());

    // 8. Guardar
    await saveRepair(page);

    // 9. Validar ganancia en el Resumen
    await goToDashboard(page);
    await expect(async () => {
      const kpiRepairsFinal = await readKpi(page, '#kpi-ganancia-reparaciones');
      expect(kpiRepairsFinal).toBeCloseTo(kpiRepairsInicial + gananciaEsperada, 2);
    }).toPass({ timeout: 10000 });
  });

  test.describe.serial('Pruebas de Contabilidad (Lógica de Revalorización)', () => {
    let testProduct = { name: '', cost: 0, price: 0, stock: 0 };

    test.beforeEach(() => {
      test.setTimeout(90000);
    });

    async function addStock(page, name, { qty, cost, price }) {
      const row = await searchAdmin(page, name);
      await row.locator('button[title="Añadir stock"]').click();
      await expect(page.locator('#add-stock-modal')).toBeVisible();

      await page.fill('#add-stock-amount', String(qty));
      // Los precios nuevos están detrás del interruptor «¿Actualizar precios con esta compra?»
      if (cost !== undefined || price !== undefined) await page.check('#add-stock-update-prices', { force: true });
      if (cost !== undefined) await page.fill('#add-stock-new-cost', String(cost));
      if (price !== undefined) await page.fill('#add-stock-new-price', String(price));
      await page.click('#save-add-stock-btn');
    }

    test('Prueba 1: Venta Estándar y KPIs', async ({ page }) => {
      // 1. Elegir un producto con stock >= 3
      await goToAdmin(page);
      const rows = adminRows(page);
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const stock = await adminStock(row);
        if (stock >= 3) {
          testProduct = {
            name: await adminName(row),
            cost: parseCurrency(await adminCell(row, 3).textContent()),
            price: parseCurrency(await adminCell(row, 4).textContent()),
            stock
          };
          break;
        }
      }
      expect(testProduct.name).not.toBe('');

      // 2. KPIs iniciales
      await goToDashboard(page);
      const kpiVentasIni = await readKpi(page, '#kpi-ganancia-ventas');
      const kpiIngresosIni = await readKpi(page, '#kpi-ingresos-ventas');
      console.log(`[Prueba 1] Producto elegido: ${testProduct.name} (Stock: ${testProduct.stock}, Costo: ${testProduct.cost}, Venta: ${testProduct.price})`);
      console.log(`[Prueba 1] Valores Iniciales -> Ganancia Ventas: ${kpiVentasIni}, Ingresos Ventas: ${kpiIngresosIni}`);

      // 3. Vender 1 unidad
      await goToSales(page);
      await addProductByName(page, testProduct.name);
      await confirmSale(page, 'Caja');

      // 4. Validar ganancia e ingresos
      const gananciaEsperada = testProduct.price - testProduct.cost;
      const ingresoEsperado = testProduct.price;
      testProduct.stock -= 1;

      await goToDashboard(page);
      await expect(async () => {
        const kpiVentasFin = await readKpi(page, '#kpi-ganancia-ventas');
        const kpiIngresosFin = await readKpi(page, '#kpi-ingresos-ventas');
        console.log(`[Prueba 1] Valores Finales -> Ganancia Ventas: ${kpiVentasFin} (Esperado: ${kpiVentasIni + gananciaEsperada}), Ingresos Ventas: ${kpiIngresosFin} (Esperado: ${kpiIngresosIni + ingresoEsperado})`);
        expect(kpiVentasFin).toBeCloseTo(kpiVentasIni + gananciaEsperada, 2);
        expect(kpiIngresosFin).toBeCloseTo(kpiIngresosIni + ingresoEsperado, 2);
      }).toPass({ timeout: 10000 });

      // 5. Validar que el stock haya bajado en admin
      await goToAdmin(page);
      const row = await searchAdmin(page, testProduct.name);
      expect(await adminStock(row)).toBe(testProduct.stock);
    });

    test('Prueba 2 y 3: Revalorización (+1 Costo, +2 Venta) y Nueva Venta', async ({ page }) => {
      if (!testProduct.name) {
        throw new Error("ERROR: 'testProduct' no está definido. Debes ejecutar toda la suite secuencial (desde Prueba 1), no este test de forma aislada.");
      }

      // 1. KPIs iniciales
      await goToDashboard(page);
      const kpiTotalIni = await readKpi(page, '#kpi-ganancia-total');
      const kpiVentasIni = await readKpi(page, '#kpi-ganancia-ventas');
      const kpiInvVentasIni = await readKpi(page, '#kpi-invertido-ventas');
      const kpiIngresosIni = await readKpi(page, '#kpi-ingresos-ventas');
      const kpiTotalVentasIni = parseInt(await page.locator('#kpi-total-ventas').textContent()) || 0;

      console.log(`[Prueba 2] Valores Iniciales -> Inv. Ventas: ${kpiInvVentasIni}, Ganancia Total: ${kpiTotalIni}, Ganancia Ventas: ${kpiVentasIni}, Ingresos Ventas: ${kpiIngresosIni}`);
      console.log(`[Prueba 2] Estado inicial del producto -> Stock: ${testProduct.stock}, Costo: ${testProduct.cost}, Venta: ${testProduct.price}`);

      // 2. Aumentar stock (+1), Costo (+1), Precio (+2)
      await goToAdmin(page);
      const newCost = testProduct.cost + 1;
      const newPrice = testProduct.price + 2;
      console.log(`[Prueba 2] Enviando actualización -> Stock: +1, Nuevo Costo: ${newCost} (+1), Nueva Venta: ${newPrice} (+2)`);
      await addStock(page, testProduct.name, { qty: 1, cost: newCost, price: newPrice });
      await expect(page.locator('#toast')).toContainText('precios actualizados', { timeout: 10000 });

      // El incremento en inventario es la nueva unidad + el aumento de costo de las unidades antiguas
      const aumentoInventarioEsperado = (testProduct.stock * (newCost - testProduct.cost)) + (1 * newCost);
      const revalorizacionEsperada = testProduct.stock * (newCost - testProduct.cost);

      testProduct.stock += 1;
      testProduct.cost = newCost;
      testProduct.price = newPrice;

      // 3. KPIs post-revalorización (antes de vender)
      await goToDashboard(page);
      let kpiInvVentasMid, kpiTotalMid, kpiVentasMid, kpiIngresosMid, kpiTotalVentasMid;
      await expect(async () => {
        kpiInvVentasMid = await readKpi(page, '#kpi-invertido-ventas');
        kpiTotalMid = await readKpi(page, '#kpi-ganancia-total');
        kpiVentasMid = await readKpi(page, '#kpi-ganancia-ventas');
        kpiIngresosMid = await readKpi(page, '#kpi-ingresos-ventas');
        kpiTotalVentasMid = parseInt(await page.locator('#kpi-total-ventas').textContent()) || 0;
        expect(kpiInvVentasMid).toBeCloseTo(kpiInvVentasIni + aumentoInventarioEsperado, 2);
      }).toPass({ timeout: 10000 });

      console.log(`[Prueba 2] Valores Mid -> Inv. Ventas: ${kpiInvVentasMid} (Esperado: ${kpiInvVentasIni + aumentoInventarioEsperado}), Ganancia Total: ${kpiTotalMid}`);

      expect(kpiTotalMid).toBeCloseTo(kpiTotalIni + revalorizacionEsperada, 2);
      expect(kpiVentasMid).toBeCloseTo(kpiVentasIni, 2);
      expect(kpiIngresosMid).toBeCloseTo(kpiIngresosIni, 2);
      expect(kpiTotalVentasMid).toBe(kpiTotalVentasIni);

      // 4. Vender 1 unidad con el nuevo precio (Prueba 3 integrada)
      console.log(`[Prueba 3] Iniciando venta con nuevos valores revalorizados...`);
      await goToSales(page);
      await addProductByName(page, testProduct.name);
      await confirmSale(page, 'Caja');

      const nuevaGanancia = testProduct.price - testProduct.cost;
      const nuevoIngreso = testProduct.price;
      const disminucionInv = testProduct.cost;
      testProduct.stock -= 1;

      // 5. KPIs post-venta
      await goToDashboard(page);
      let kpiInvVentasFin, kpiVentasFin, kpiIngresosFin;
      await expect(async () => {
        kpiInvVentasFin = await readKpi(page, '#kpi-invertido-ventas');
        kpiVentasFin = await readKpi(page, '#kpi-ganancia-ventas');
        kpiIngresosFin = await readKpi(page, '#kpi-ingresos-ventas');
        expect(kpiInvVentasFin).toBeCloseTo(kpiInvVentasMid - disminucionInv, 2);
      }).toPass({ timeout: 10000 });

      console.log(`[Prueba 3] Valores Finales (Venta post-revalorización) ->`);
      console.log(`   - Inv. Ventas bajó a: ${kpiInvVentasFin} (Esperado: ${kpiInvVentasMid - disminucionInv} por salida de inventario de ${disminucionInv})`);
      console.log(`   - Ganancia Ventas subió a: ${kpiVentasFin} (Esperado: ${kpiVentasIni + nuevaGanancia} por nueva ganancia de ${nuevaGanancia})`);
      console.log(`   - Ingresos Ventas subió a: ${kpiIngresosFin} (Esperado: ${kpiIngresosIni + nuevoIngreso} por nuevo ingreso de ${nuevoIngreso})`);

      expect(kpiVentasFin).toBeCloseTo(kpiVentasIni + nuevaGanancia, 2);
      expect(kpiIngresosFin).toBeCloseTo(kpiIngresosIni + nuevoIngreso, 2);
    });

    test('Prueba 4: Devaluación (-3 Costo, -2 Venta)', async ({ page }) => {
      if (!testProduct.name) {
        throw new Error("ERROR: 'testProduct' no está definido. Debes ejecutar toda la suite secuencial (desde Prueba 1), no este test de forma aislada.");
      }

      // 1. KPIs
      await goToDashboard(page);
      const kpiTotalIni = await readKpi(page, '#kpi-ganancia-total');
      const kpiInvVentasIni = await readKpi(page, '#kpi-invertido-ventas');

      console.log(`[Prueba 4] Valores Iniciales -> Inv. Ventas: ${kpiInvVentasIni}, Ganancia Total (Incl. Inventario): ${kpiTotalIni}`);
      console.log(`[Prueba 4] Estado inicial del producto -> Stock: ${testProduct.stock}, Costo: ${testProduct.cost}, Venta: ${testProduct.price}`);

      // 2. Aumentar stock (+1), Costo (-3), Precio (-2)
      await goToAdmin(page);
      const newCost = Math.max(1, testProduct.cost - 3);
      const newPrice = Math.max(1, testProduct.price - 2);
      const diffCosto = newCost - testProduct.cost;
      console.log(`[Prueba 4] Enviando actualización -> Stock: +1, Nuevo Costo: ${newCost} (-3), Nueva Venta: ${newPrice} (-2)`);
      await addStock(page, testProduct.name, { qty: 1, cost: newCost, price: newPrice });
      await expect(page.locator('#toast')).toContainText('precios actualizados', { timeout: 10000 });

      const perdidaEsperada = (testProduct.stock * diffCosto) + (1 * newCost);

      testProduct.stock += 1;
      testProduct.cost = newCost;
      testProduct.price = newPrice;

      // 3. Validar KPI Total (que haya caído)
      await goToDashboard(page);
      let kpiTotalFin, kpiInvVentasFin;
      await expect(async () => {
        kpiTotalFin = await readKpi(page, '#kpi-ganancia-total');
        kpiInvVentasFin = await readKpi(page, '#kpi-invertido-ventas');
        expect(kpiInvVentasFin).toBeCloseTo(kpiInvVentasIni + perdidaEsperada, 2);
      }).toPass({ timeout: 10000 });

      console.log(`[Prueba 4] Valores Finales (Devaluación) -> Inv. Ventas: ${kpiInvVentasFin} (Esperado: ${kpiInvVentasIni + perdidaEsperada} por pérdida de inv. de ${perdidaEsperada})`);

      const perdidaGananciaEsperada = (testProduct.stock - 1) * diffCosto;
      expect(kpiTotalFin).toBeCloseTo(kpiTotalIni + perdidaGananciaEsperada, 2);
    });
  });

  test.describe.serial('Módulo de Ventas (Nuevas Pruebas)', () => {
    test('Test 6: Gestión del Carrito (+, -, deshabilitar Cobrar si vacío)', async ({ page }) => {
      await goToSales(page);

      const confirmBtn = page.locator('#confirm-sale-btn');
      await expect(confirmBtn).toBeDisabled();

      const products = availableCards(page);
      await expect(products.first()).toBeVisible({ timeout: 10000 });
      await products.first().click();

      // Aumentar cantidad
      const incBtn = page.locator('.qty-btn[data-action="inc"]').first();
      await expect(incBtn).toBeVisible();
      await incBtn.click();
      const qtyNum = page.locator('#cart-items .pos-cart-row .qty .tnum').first();
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
      test.setTimeout(120000);

      // 1. Producto con menor stock (> 0)
      await goToAdmin(page);
      const rows = adminRows(page);
      let productName = '';
      let minStock = Infinity;
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const stock = await adminStock(rows.nth(i));
        if (stock > 0 && stock < minStock) {
          productName = await adminName(rows.nth(i));
          minStock = stock;
        }
      }
      expect(productName).not.toBe('');

      // 2. Ventas: agregar y subir hasta pasar el límite
      await goToSales(page);
      await addProductByName(page, productName);

      const incBtn = page.locator('.qty-btn[data-action="inc"]').first();
      for (let i = 0; i < minStock; i++) {
        await incBtn.click();
      }

      await expect(page.locator('#toast')).toContainText('Stock máximo', { timeout: 5000 });
      await expect(page.locator('#cart-items .pos-cart-row .qty .tnum').first()).toHaveText(String(minStock));
      // Con todo el stock en el carrito la tarjeta queda bloqueada
      await expect(page.locator('#products-grid .pos-card.blocked').filter({ hasText: productName })).toHaveCount(1);

      await page.click('#clear-cart-btn');
    });

    test('Test 8: Anulación / Devolución de Venta (Integridad)', async ({ page }) => {
      // 1. Stock inicial en Admin
      await goToAdmin(page);
      const rows = adminRows(page);
      let productName = '';
      let stockInicial = 0;
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const stock = await adminStock(rows.nth(i));
        if (stock > 0) {
          productName = await adminName(rows.nth(i));
          stockInicial = stock;
          break;
        }
      }
      expect(productName).not.toBe('');

      // 2. Venta de este producto
      await goToSales(page);
      await addProductByName(page, productName);
      await expect(page.locator('#cart-subtotal')).not.toHaveText('S/ 0.00');
      await confirmSale(page, 'Caja');

      // 3. KPIs actuales
      await goToDashboard(page);
      const kpiIngresosAntes = await readKpi(page, '#kpi-ingresos-ventas');

      // 4. Anular la venta desde el historial (detalle en drawer)
      await goToSales(page);
      await page.click('#tab-hist');
      await expect(page.locator('#sales-history-layout')).toBeVisible();
      await page.fill('#all-sales-search', productName);
      await page.waitForTimeout(500);
      await page.locator('#all-sales-tbody .ui-tr').first().click();
      await page.click('#sale-detail-void');
      await expect(page.locator('#toast')).toContainText('anulada', { timeout: 10000 });

      // 5. KPIs
      await goToDashboard(page);
      await expect(async () => {
        expect(await readKpi(page, '#kpi-ingresos-ventas')).toBeLessThan(kpiIngresosAntes);
      }).toPass({ timeout: 10000 });

      // 6. Stock restaurado en Admin
      await goToAdmin(page);
      const row = await searchAdmin(page, productName);
      expect(await adminStock(row)).toBe(stockInicial);
    });

    test('Test 9: Métodos de Pago en Ventas', async ({ page }) => {
      await goToSales(page);

      const methods = ['Yape/Plin', 'Transferencia', 'POS'];
      for (const method of methods) {
        const products = availableCards(page);
        await expect(products.first()).toBeVisible({ timeout: 10000 });
        await products.first().click();
        await confirmSale(page, method);
      }

      await goToDashboard(page);

      // El filtro de pago ahora es un botón que rota entre métodos
      const payLabel = page.locator('#dash-payment-label');
      for (let i = 0; i < 10 && (await payLabel.textContent()) !== 'Yape/Plin'; i++) {
        await page.click('#dash-cycle-payment');
      }
      await expect(payLabel).toHaveText('Yape/Plin');

      await expect(async () => {
        expect(await readKpi(page, '#kpi-ingresos-ventas')).toBeGreaterThan(0);
      }).toPass({ timeout: 10000 });

      // Restaurar filtro
      for (let i = 0; i < 10 && (await payLabel.textContent()) !== 'Todos'; i++) {
        await page.click('#dash-cycle-payment');
      }
      await expect(payLabel).toHaveText('Todos');
    });
  });

  test.describe.serial('Módulo de Reparaciones (Nuevas Pruebas)', () => {
    test('Test 10: Transiciones de Estado Completas y KPIs', async ({ page }) => {
      test.setTimeout(120000);
      // 1. KPI inicial
      await goToDashboard(page);
      const kpiRepIni = await readKpi(page, '#kpi-ganancia-reparaciones');

      // 2. Crear reparación
      await goToRepairs(page);
      await page.click('#new-repair-btn');
      await expect(page.locator('#new-repair-modal')).toBeVisible({ timeout: 15000 });

      await page.fill('#repair-customer', 'Cliente Estados');
      await page.fill('#repair-phone', '999888777');
      await fillRepairItem(page.locator('.repair-item-block').nth(0), { type: 'Tablet', brand: 'Lenovo', fault: 'Pantalla rota', total: 100 });
      await page.fill('#repair-advance', '0');
      await saveRepair(page);

      // 3. Cambiar estados secuencialmente desde el drawer del ticket
      await openTicket(page, 'Cliente Estados');
      for (const estado of ['EN_DIAGNOSTICO', 'EN_PROCESO', 'TERMINADO', 'ENTREGADO']) {
        await changeStatus(page, estado);
      }

      // 4. Validar KPI Gan. Rep
      await goToDashboard(page);
      await expect(async () => {
        expect(await readKpi(page, '#kpi-ganancia-reparaciones')).toBeCloseTo(kpiRepIni + 100, 2);
      }).toPass({ timeout: 10000 });
    });

    test('Test 11: Uso y Anulación de Repuestos del Inventario (Integridad)', async ({ page }) => {
      test.setTimeout(120000);
      // 1. Producto con stock
      await goToAdmin(page);
      const rows = adminRows(page);
      let productName = '';
      let stockInicial = 0;
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const stock = await adminStock(rows.nth(i));
        if (stock > 0) {
          productName = await adminName(rows.nth(i));
          stockInicial = stock;
          break;
        }
      }
      expect(productName).not.toBe('');

      // 2. Crear reparación
      await goToRepairs(page);
      await page.click('#new-repair-btn');
      await page.fill('#repair-customer', 'Cliente Repuestos');
      await page.fill('#repair-phone', '999888777');
      await fillRepairItem(page.locator('.repair-item-block').nth(0), { type: 'PC', brand: 'HP', fault: 'No enciende', total: 150 });
      await page.fill('#repair-advance', '0');
      await saveRepair(page);

      // 3. Asignar repuesto (Insumos desde el drawer del ticket)
      await openTicket(page, 'Cliente Repuestos');
      await page.locator('.ui-drawer [data-costs]').first().click();
      await expect(page.locator('#repair-costs-modal')).toBeVisible();

      // Llenar el input DESPUÉS de que la carga asíncrona lo limpia
      await expect(async () => {
        await page.fill('#repair-part-search', productName);
        await expect(page.locator('#repair-part-dropdown .autocomplete-item').first()).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 15000 });
      await page.locator('#repair-part-dropdown .autocomplete-item').first().click();

      await page.fill('#repair-part-qty', '1');
      await page.click('#add-repair-part-btn');
      await expect(page.locator('#toast')).toContainText('asignado', { timeout: 5000 });

      // Esperar a que la recarga asíncrona del modal termine
      await page.waitForTimeout(1500);
      await page.click('#close-repair-costs-btn');
      await expect(page.locator('#repair-costs-modal')).toBeHidden({ timeout: 5000 });

      // 4. Verificar disminución de stock
      await goToAdmin(page);
      let row = await searchAdmin(page, productName);
      expect(await adminStock(row)).toBe(stockInicial - 1);

      // 5. Quitar repuesto
      await goToRepairs(page);
      await openTicket(page, 'Cliente Repuestos');
      await page.locator('.ui-drawer [data-costs]').first().click();
      await expect(page.locator('#repair-costs-modal')).toBeVisible();

      const removeBtn = page.locator('#repair-parts-tbody button[title="Quitar repuesto"]').first();
      await expect(removeBtn).toBeVisible({ timeout: 10000 });
      await removeBtn.click();
      await expect(page.locator('#toast')).toContainText('stock devuelto', { timeout: 5000 });

      await page.waitForTimeout(1500);
      await page.click('#close-repair-costs-btn');
      await expect(page.locator('#repair-costs-modal')).toBeHidden({ timeout: 5000 });

      // 6. Verificar stock restaurado
      await goToAdmin(page);
      row = await searchAdmin(page, productName);
      expect(await adminStock(row)).toBe(stockInicial);
    });

    test('Test 12: Pagos y Adelantos (Doble Ingreso)', async ({ page }) => {
      // Registrar reparación con adelanto por Yape
      await goToRepairs(page);
      await page.click('#new-repair-btn');

      await page.fill('#repair-customer', 'Cliente Pagos');
      await page.fill('#repair-phone', '999888777');
      await fillRepairItem(page.locator('.repair-item-block').nth(0), { type: 'Consola', brand: 'Sony', fault: 'Luz roja', total: 150 });

      await page.fill('#repair-advance', '50');
      // El método de adelanto es un input hidden que se fija con botones
      await page.click('#nr-pay-options [data-pay="Yape/Plin"]');
      await expect(page.locator('#repair-advance-payment')).toHaveValue('Yape/Plin');

      await saveRepair(page);

      // Entregar
      await openTicket(page, 'Cliente Pagos');
      await changeStatus(page, 'ENTREGADO');

      // KPI en el Resumen: total de reparación es 150
      await goToDashboard(page);
      await expect(async () => {
        expect(await readKpi(page, '#kpi-ingresos-reparaciones')).toBeGreaterThanOrEqual(150);
      }).toPass({ timeout: 10000 });
    });
  });

  test.describe.serial('Módulo de Administración e Inventario (Nuevas Pruebas)', () => {
    test('Test 13: Creación de Nuevo Producto y Aumento de Stock', async ({ page }) => {
      test.setTimeout(120000);
      await goToAdmin(page);

      await page.click('#new-product-btn');
      await expect(page.locator('#new-product-modal')).toBeVisible();

      const uniqueCode = 'E2E-' + Date.now();
      const name = 'Producto Test ' + uniqueCode;
      await page.fill('#new-product-name', name);

      // La categoría se elige con chips; el <select> quedó oculto como valor
      const catChip = page.locator('#np-cat-chips [data-np-cat]').first();
      await expect(catChip).toBeVisible({ timeout: 15000 });
      await catChip.click();
      await expect(page.locator('#new-product-category')).not.toHaveValue('');
      await page.fill('#new-product-brand', 'E2E Brand');
      await page.fill('#new-product-cost', '10');
      await page.fill('#new-product-price', '20');
      await page.fill('#new-product-stock', '50');
      await page.fill('#new-product-min', '10');

      await page.click('#save-new-product-btn');
      await expect(page.locator('#toast')).toContainText('Producto creado', { timeout: 10000 });

      let row = await searchAdmin(page, uniqueCode);
      await expect(row).toContainText(name);
      expect(await adminStock(row)).toBe(50);

      // Aumentar stock (+5)
      await row.locator('button[title="Añadir stock"]').click();
      await expect(page.locator('#add-stock-modal')).toBeVisible();
      await page.fill('#add-stock-amount', '5');
      await page.fill('#add-stock-notes', 'Ingreso por Test');
      await page.click('#save-add-stock-btn');
      await expect(page.locator('#toast')).toContainText('Stock actualizado', { timeout: 10000 });

      row = await searchAdmin(page, uniqueCode);
      await expect(adminCell(row, 5)).toHaveText('55');
    });
  });

});
