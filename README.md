# 📘 InventarioPro — Documentación Técnica

Sistema de gestión para negocio de venta de productos electrónicos y reparaciones.  
**Stack:** Backend FastAPI (Python) + SQLAlchemy (SQLite), Frontend vanilla HTML/CSS/JS modular con vistas dinámicas (SPA).  
**Autenticación:** Token simple. Roles: `admin` y `operator`.

---

## 1. Estructura de Archivos

```
raíz/
├── main.py                 # Backend FastAPI
├── models.py               # Modelos SQLAlchemy
├── database.py             # Conexión a BD (SQLite local)
└── frontend/
    ├── index.html           # Shell de la app (login, sidebar, modales globales)
    ├── styles.css           # Estilos completos (glassmorphism, variables CSS, responsive)
    ├── js/
    │   ├── app.js           # Orquestador: navegación, inicialización
    │   ├── auth.js          # Login, sesión
    │   ├── utils.js         # Variables globales, helpers, API, toast, modales comunes
    │   ├── dashboard.js     # KPIs y gráficas Chart.js
    │   ├── sales.js         # Lógica del Punto de Venta (POS) y historial
    │   ├── repairs.js       # Gestión de reparaciones
    │   └── admin.js         # Panel administrador (productos, stock, precios, config)
    └── views/
        ├── dashboard.html   # Fragmento HTML del dashboard
        ├── sales.html       # Fragmento HTML de ventas (POS + historial)
        ├── repairs.html     # Fragmento HTML de reparaciones
        └── admin.html       # Fragmento HTML del panel admin
```

---

## 2. Backend (FastAPI)

### 2.1. Endpoints API

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/api/auth/login` | Login con usuario/contraseña, retorna token | No |
| PUT | `/api/admin/change-password` | Cambiar contraseña | Admin |
| **Dashboard** ||||
| GET | `/api/dashboard/kpis` | KPIs financieros y operativos | No |
| GET | `/api/dashboard/sales-chart` | Datos para gráfico de ventas 30 días | No |
| GET | `/api/dashboard/top-products` | Top 5 productos más vendidos | No |
| GET | `/api/dashboard/repairs-by-status` | Reparaciones agrupadas por estado | No |
| **Productos** ||||
| GET | `/api/products` | Lista todos los productos (incluye ventas totales) | No |
| POST | `/api/admin/products` | Crea producto (código automático por categoría) | Admin |
| PUT | `/api/products/{id}/toggle-favorite` | Marca/desmarca favorito (máx 6) | No |
| PUT | `/api/admin/products/{id}/category` | Cambia categoría de producto | Admin |
| **Stock y Precios** ||||
| POST | `/api/admin/stock/add` | Añade stock (registra auditoría) | Admin |
| GET | `/api/admin/stock/audit` | Historial de movimientos de stock | Admin |
| PUT | `/api/admin/products/{id}/price` | Actualiza precios (guarda historial) | Admin |
| GET | `/api/admin/products/{id}/price-history` | Historial de cambios de precio | Admin |
| **Ventas** ||||
| POST | `/api/sales` | Crea venta (descuenta stock) | Token |
| GET | `/api/sales` | Lista ventas con sus ítems | No |
| GET | `/api/receipts/sale/{sale_id}/png` | Recibo de venta en imagen PNG | No |
| **Reparaciones** ||||
| POST | `/api/repairs` | Crea reparación (con pagos y estado inicial) | Token |
| GET | `/api/repairs` | Lista reparaciones con historial de estados | No |
| PUT | `/api/repairs/{repair_id}/status` | Cambia estado y guarda historial | Token |
| GET | `/api/repairs/{repair_id}/history` | Historial de estados de una reparación | No |
| GET | `/api/receipts/repair/{repair_id}/png` | Recibo de ingreso en PNG | No |
| GET | `/api/receipts/repair/{repair_id}/boleta-final/png` | Boleta final (solo si TERMINADO/ENTREGADO) | No |
| **Categorías** ||||
| GET | `/api/categories` | Lista categorías | No |
| POST | `/api/admin/categories` | Crea categoría | Admin |
| PUT | `/api/admin/categories/{id}` | Renombra categoría | Admin |
| DELETE | `/api/admin/categories/{id}` | Elimina categoría (si no tiene productos) | Admin |
| **Configuración de desplegables** ||||
| GET | `/api/equipment-types` | Lista pública de tipos de equipo | No |
| GET | `/api/brand-models` | Lista pública de marcas/modelos | No |
| (Rutas admin idénticas con prefijo `/api/admin/...`) ||||

### 2.2. Autenticación

- **Formato del token:** `username|rol` (ej. `juan|admin`).
- **Header:** `X-Token`.
- **Usuarios precargados en BD:** `juan` (admin) y `junior` (operador).
- **Contraseñas:** en texto plano (no hasheadas).
- **Sin caducidad de token.**

### 2.3. Generación de Recibos

- Se usa la librería Pillow (`PIL`) para crear imágenes PNG de alta calidad.
- Fuentes del sistema Windows (calibri, arial, segoe, verdana).
- Los endpoints devuelven la imagen directamente como respuesta `image/png`.

### 2.4. Generación de IDs

- **Productos:** código numérico basado en `categoria_id * 1000 + secuencial`.
- **Ventas:** `v-xxxx-yyyy` (uuid4 truncado).
- **Reparaciones:** `r-xxxx-yyyy` (uuid4 truncado).

### 2.5. Modelos de Datos (SQLAlchemy)

- `User` – username, password_hash, role.
- `Category` – name.
- `Product` – name, brand, cost_price, sale_price, stock, min_stock, is_favorite, code, category_id.
- `PriceHistory` – registro de cada cambio de precio.
- `StockAudit` – registro de cada adición de stock.
- `Sale` – ticket_code, operator_name, customer_name, subtotal_amount, discount_amount, total_amount.
- `SaleItem` – product_id, product_name, unit_price, quantity, subtotal.
- `RepairService` – ticket_code, customer_name, customer_phone, equipment_type, brand_model, fault_description, operator_name, total_amount, advance_payment, remaining_balance, status.
- `RepairPayment` – registra cada abono a una reparación.
- `RepairStatusHistory` – registro de cambios de estado.
- `EquipmentType`, `BrandModel` – listas configurables para autocompletado.

**Flujo de estados de reparación:**  
`PENDIENTE` → `EN_DIAGNOSTICO` → `EN_PROCESO` → `TERMINADO` → `ENTREGADO`

### 2.6. Servicio de Archivos Estáticos

El backend sirve todos los archivos de la carpeta `frontend/`.  
Si la ruta coincide con un archivo existente, lo devuelve; si no, devuelve `index.html` (para SPA).

---

## 3. Frontend — Arquitectura

### 3.1. Flujo de Inicio

1. `index.html` carga `js/app.js` como `<script type="module">`.
2. `app.js` verifica sesión con `auth.js`.
3. Si hay sesión → muestra la app con vista `dashboard` por defecto.
4. Si no → pantalla de login.

### 3.2. Navegación (SPA)

- Función `navigateTo(viewId)` en `app.js`.
- Obtiene HTML de `/views/{viewId}.html` con `fetch`.
- Inyecta contenido en `<main id="view-container">`.
- Destruye gráficas previas (`chartInstances`).
- Ejecuta carga de datos específica (`loadDashboard()`, `loadSalesView()`, etc.).
- Luego vincula eventos (`bindSalesEvents()`, `bindRepairEvents()`, etc.).

### 3.3. Variables y Funciones Globales Expuestas

Las siguientes se agregan a `window` desde sus módulos para ser usadas en atributos `onclick` inline:

`showReceiptModal`, `openAddStock`, `openEditPrice`, `openPriceHistory`, `openEditCategory`, `openChangeStatus`, `openHistory`.

### 3.4. Modales Globales

Todos los modales están definidos en `index.html` y se muestran/ocultan con la clase CSS `.hidden`.  
El cierre por backdrop se aplica con delegación de eventos en `app.js`.

---

## 4. Módulos JavaScript

### 4.1. `utils.js` — Utilidades Globales

**Variables exportadas:**
- `API` – URL base (`http://192.168.18.93:8000/api`).

**Variables de estado (no exportadas):**
- `session` – objeto `{ username, role, token }`.
- `toastTimer` – control del toast.

**Funciones exportadas:**
- `getSession()`, `setSession(data)`, `clearSession()`.
- `getHeaders()` – retorna headers con `X-Token` si hay sesión.
- `fmt(n)` – formato moneda `S/ X.XX`.
- `showToast(msg, type)` – notificación temporal.
- `showReceiptModal(imgUrl)` – muestra el modal genérico de recibos.

### 4.2. `auth.js` — Autenticación

**Funciones exportadas:**
- `loadSession()` – recupera de localStorage, retorna boolean.
- `showLogin()`, `showApp()`.
- `initAuth()` – vincula eventos de login/logout.

**Función interna:**
- `doLogin()` – llama a `/api/auth/login`, guarda sesión en localStorage.

### 4.3. `app.js` — Orquestador Principal

**Funciones exportadas:**
- `navigateTo(viewId)` – cambia de vista dinámicamente.

**Inicialización (`DOMContentLoaded`):**
1. Llama a `initAuth()`.
2. Carga sesión con `loadSession()`.
3. Si hay sesión → `initNav()` + `showApp()`.
4. Si no → `showLogin()`.

**Función interna:**
- `initNav()` – vincula clics de los ítems del menú lateral.

### 4.4. `dashboard.js` — Dashboard

**Exporta:**
- `chartInstances` – array para destruir gráficos al cambiar de vista.
- `loadDashboard()` – función principal.

**Funciones internas:**
- `loadKPIs()` – llama a `/api/dashboard/kpis` y llena los 8 KPI cards.
- `loadCharts()` – genera 3 gráficos Chart.js:
  - **chart-sales** – barras, ventas últimos 30 días.
  - **chart-top-products** – doughnut, top 5 productos.
  - **chart-repairs-status** – barras horizontales, reparaciones por estado.

**Nota:** `Chart` se obtiene como `window.Chart` para asegurar disponibilidad en módulos ES.

### 4.5. `sales.js` — Punto de Venta (POS)

**Estado interno del módulo:**

| Variable | Tipo | Descripción |
|----------|------|-------------|
| `allProducts` | Array | Lista completa de productos |
| `allCategories` | Array | Lista de categorías |
| `selectedCategoryId` | Number\|null | Categoría activa en filtro |
| `isSearching` | Boolean | Si hay búsqueda activa |
| `filteredProducts` | Array | Resultados de búsqueda |
| `cart` | Object | `{ [id]: { product, quantity } }` |
| `allSales` | Array | Ventas para historial |

**Funciones exportadas:**
- `loadSalesView()` – carga categorías, productos, ventas recientes.
- `bindSalesEvents()` – vincula eventos de búsqueda, carrito, historial.

**Funciones internas principales:**
- `loadCategoriesForSales()` – obtiene categorías de API.
- `loadProductsForPOS()` – obtiene productos y renderiza.
- `renderCategoryList()` – pinta lista de categorías clickeables.
- `renderProductGridByCategory()` – muestra productos según filtro.
- `createProductCard(product, container)` – genera tarjeta con botón favorito.
- `renderFavorites()` – sección de productos favoritos.
- `toggleFavorite(id)` – cambia estado favorito vía API.
- `addToCart(product)` – añade producto respetando stock máximo.
- `renderCart()` – dibuja ítems, calcula subtotal/descuento/total.
- `confirmSale()` – envía venta a API, muestra modal, limpia carrito.
- `loadRecentSales()` – obtiene todas las ventas.
- `renderAllSalesTable(sales)` – pinta tabla de historial.

**Eventos vinculados en `bindSalesEvents()`:**
- `#product-search` → input (búsqueda en tiempo real).
- `#confirm-sale-btn` → click (confirmar venta).
- `#clear-cart-btn` → click (vaciar carrito).
- `#all-sales-search` → input (filtrar historial).

**APIs consumidas:**
- `GET /api/categories`
- `GET /api/products`
- `POST /api/sales`
- `GET /api/sales`
- `PUT /api/products/{id}/toggle-favorite`

### 4.6. `repairs.js` — Reparaciones

**Estado interno:**

| Variable | Tipo | Descripción |
|----------|------|-------------|
| `allRepairs` | Array | Lista completa de reparaciones |
| `currentRepairId` | Number\|null | ID de reparación en modal |
| `currentStatusFilter` | String | Estado activo en filtro (`"all"` o estado) |
| `equipmentTypes` | Array | Tipos de equipo para autocompletado |
| `brandModels` | Array | Marcas/modelos para autocompletado |

**Funciones exportadas:**
- `loadRepairs()` – carga datos y renderiza.
- `bindRepairEvents()` – vincula eventos de filtros, búsqueda, modales.

**Funciones internas principales:**
- `loadListsForRepairs()` – carga equipos y marcas.
- `populateDatalists()` – llena los `<datalist>` del modal.
- `renderRepairs()` – filtra y pinta tarjetas con botones de acción.
- `statusLabel(s)` – traduce estados a español.
- `saveRepair()` – crea reparación vía API.
- `openChangeStatus()` – abre modal de cambio de estado.
- `openHistory()` – abre modal de historial de estados.

**APIs consumidas:**
- `GET /api/repairs`
- `POST /api/repairs`
- `PUT /api/repairs/{id}/status`
- `GET /api/repairs/{id}/history`
- `GET /api/equipment-types`
- `GET /api/brand-models`

### 4.7. `admin.js` — Panel Administrador

**Funciones exportadas:**
- `loadAdminView()` – inicializa todas las pestañas.
- `bindAdminEvents()` – vincula todos los botones del panel.

**Funciones internas por pestaña:**

**Productos:**
- `loadAdminProducts()` – carga tabla.
- `openNewProductModal()`, `saveNewProduct()` – crear producto.
- `openAddStock(productId, name)`, `confirmAddStock()` – añadir stock.
- `openEditPrice(...)`, `confirmEditPrice()` – editar precios.
- `openPriceHistory(...)` – ver historial de precios.
- `openEditCategory(...)`, `confirmEditCategory()` – cambiar categoría.

**Categorías:**
- `loadCategories()` – carga tabla.
- `addCategory()`, `editCategory(id, name)`, `deleteCategory(id)`.

**Configuración de desplegables:**
- `loadConfigLists()` – carga equipos y marcas.
- `addEquipment()`, `addBrand()` – añadir.
- `deleteConfigItem(type, id)` – eliminar.

**Auditoría:**
- `loadStockAudit()` – carga historial de movimientos de stock.

**Configuración:**
- `changePassword()` – cambiar contraseña del admin.

**Tabs:**
- `initAdminTabs()` – navegación entre pestañas.

**Funciones globales expuestas:**
- `openAddStock`, `openEditPrice`, `openPriceHistory`, `openEditCategory`.

---

## 5. Vistas HTML Parciales

Cada archivo en `views/` contiene solo el HTML que se inyecta en `<main id="view-container">`.  
No incluyen etiquetas `<section>`, `<html>`, ni modales (los modales están en `index.html`).

### 5.1. `dashboard.html`

- 8 tarjetas KPI con IDs: `kpi-ganancia`, `kpi-capital`, `kpi-cobrar`, `kpi-ventas`, `kpi-reparaciones`, `kpi-hoy`, `kpi-stock-bajo`, `kpi-ticket`.
- 3 gráficos (canvas): `chart-sales`, `chart-top-products`, `chart-repairs-status`.

### 5.2. `sales.html`

- Barra de búsqueda: `#product-search`.
- Sección favoritos: `#favorites-grid`.
- Lista de categorías: `#category-list-items`.
- Grilla de productos: `#products-grid`.
- Carrito: `#cart-items`, `#sale-customer`, `#sale-discount`, `#confirm-sale-btn`, `#clear-cart-btn`.
- Historial: `#all-sales-tbody`, `#all-sales-search`.

### 5.3. `repairs.html`

- Botón nueva reparación: `#new-repair-btn`.
- Búsqueda global: `#repair-global-search`.
- Filtros de estado: `.filter-btn` con `data-status`.
- Contenedor de tarjetas: `#repairs-list`.

### 5.4. `admin.html`

- Tabs: `.admin-tab` con `data-tab`.
- Tablas: `#admin-products-tbody`, `#categories-tbody`, `#audit-tbody`.
- Configuración: `#new-equipment-input`, `#new-brand-input`, `#equipment-config-list`, `#brand-config-list`.
- Botones: `#new-product-btn`, `#add-category-btn`, `#add-equipment-btn`, `#add-brand-btn`, `#change-password-btn`.

---

## 6. Estilos CSS (`styles.css`)

- **Diseño:** Glassmorphism con variables CSS personalizadas.
- **Colores:** Paleta oscura con acentos (verde, azul, morado, amarillo, rojo, etc.).
- **Componentes principales:**
  - `.glass` – efecto vidrio.
  - `.product-card` – tarjeta de producto en POS.
  - `.status-badge` + `.status-{ESTADO}` – badges de estado de reparación.
  - `.kpi-card` + `.kpi-{color}` – tarjetas KPI del dashboard.
  - `.repair-card` – tarjeta de reparación.
  - `.modal` + `.modal-content` – sistema de modales.
  - `.toast` – notificaciones.
  - `.data-table` – tablas de datos.
- **Responsive:** Media queries para pantallas <900px y <640px (sidebar colapsada).

---

## 7. Flujo de Datos para Modificar un Módulo Específico

### 7.1. Si se necesita modificar solo `sales.js`:

**Dependencias:**
```javascript
import { API, getHeaders, fmt, showToast } from './utils.js';
```

**Estado:** Ver tabla en sección 4.5.

**Inicialización:** `loadSalesView()` se llama desde `navigateTo()` en `app.js`, seguida de `bindSalesEvents()`.

**IDs del DOM requeridos (deben existir en `views/sales.html`):**
`product-search`, `favorites-grid`, `category-list-items`, `products-grid`, `cart-items`, `sale-customer`, `sale-discount`, `confirm-sale-btn`, `clear-cart-btn`, `all-sales-tbody`, `all-sales-search`.

**APIs:** Las listadas en sección 4.5.

**Lógica del carrito:**
- `cart` es un objeto `{ [product_id]: { product, quantity } }`.
- `addToCart()` valida stock máximo.
- `renderCart()` calcula subtotal, aplica descuento, muestra total.
- `confirmSale()` envía a API y limpia.

**Historial:**
- `allSales` es un array cargado desde API.
- `renderAllSalesTable()` pinta la tabla.
- El buscador filtra en memoria por cliente, ticket o vendedor.

### 7.2. Si se necesita modificar solo `repairs.js`:

**IDs del DOM:** `new-repair-btn`, `repair-global-search`, `.filter-btn`, `repairs-list`.

**IDs de modales (en `index.html`):** `new-repair-modal`, `change-status-modal`, `history-modal`, y sus campos internos.

### 7.3. Si se necesita modificar solo `admin.js`:

Los IDs de cada pestaña están en la sección 5.4. Las funciones están agrupadas por funcionalidad (productos, categorías, config, auditoría, settings).

---

## 8. Dependencias Externas

- **Chart.js 4.4.0** – CDN, cargado globalmente en `index.html`.
  ```html
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  ```
- **Google Fonts – Inter** – tipografía.
  ```html
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  ```

---

## 9. Notas Técnicas Adicionales

- **Módulos ES:** el frontend usa `type="module"`. Las variables globales como `Chart` se acceden vía `window.Chart`.
- **Gráficos:** se destruyen al cambiar de vista para evitar fugas de memoria.
- **Modales:** todos en `index.html`, visibilidad controlada con clase `.hidden`.
- **Backend:** los IDs de producto son numéricos secuenciales por categoría. Los tickets usan uuid4 truncado.
- **Recibos:** generados con Pillow, fuentes de Windows. Formato PNG de 600px de ancho.
- **Categoría por defecto:** ID 1, nombre "Sin categoría", se crea en el evento `startup` si no existe.

---