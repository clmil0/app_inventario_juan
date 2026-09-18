const fs = require('fs');
const path = require('path');
// Importante: instalar con `npm install better-sqlite3` antes de ejecutar
const Database = require('better-sqlite3');

const dbName = process.env.TEST_MODE === 'true' ? 'test_data.db' : 'local_data.db';
const dbPath = path.join(__dirname, dbName);

console.log('📦 Inicializando base de datos local SQLite...');

// Crear conexión (creará el archivo si no existe)
const db = new Database(dbPath, { verbose: console.log });

// Leer y ejecutar las sentencias SQL
const initSQL = `
-- Perfiles (Usuarios)
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL DEFAULT '123456',
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 1
);

-- Categorías
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Productos
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT DEFAULT '',
  cost_price REAL DEFAULT 0,
  sale_price REAL DEFAULT 0,
  stock INTEGER DEFAULT 0,
  min_stock INTEGER DEFAULT 5,
  is_favorite INTEGER DEFAULT 0,
  category_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Ventas
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_code TEXT NOT NULL UNIQUE,
  operator_name TEXT NOT NULL,
  customer_name TEXT DEFAULT 'Cliente Anónimo',
  subtotal_amount REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  total_amount REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  payment_method TEXT DEFAULT 'Caja' CHECK (payment_method IN ('Caja', 'Yape/Plin', 'Transferencia', 'POS')),
  status TEXT DEFAULT 'COMPLETADA' CHECK (status IN ('COMPLETADA', 'ANULADA'))
);

-- Items de Venta
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal REAL NOT NULL,
  unit_cost REAL DEFAULT 0,
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Reparaciones
CREATE TABLE IF NOT EXISTS repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT DEFAULT '',
  equipment_type TEXT NOT NULL,
  brand_model TEXT NOT NULL,
  fault_description TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  total_amount REAL DEFAULT 0,
  advance_payment REAL DEFAULT 0,
  remaining_balance REAL DEFAULT 0,
  status TEXT DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE', 'EN_DIAGNOSTICO', 'EN_PROCESO', 'TERMINADO', 'ENTREGADO')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  internal_parts_cost REAL DEFAULT 0,
  internal_external_cost REAL DEFAULT 0,
  net_profit REAL DEFAULT 0,
  advance_payment_method TEXT DEFAULT 'Caja' CHECK (advance_payment_method IN ('Caja', 'Yape/Plin', 'Transferencia', 'POS')),
  final_payment_method TEXT DEFAULT 'Caja' CHECK (final_payment_method IN ('Caja', 'Yape/Plin', 'Transferencia', 'POS')),
  warranty_days INTEGER DEFAULT 30,
  delivered_at DATETIME,
  equipments TEXT DEFAULT '[]',
  group_ticket TEXT
);

-- Historial de Estado de Reparaciones
CREATE TABLE IF NOT EXISTS repair_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER,
  status TEXT NOT NULL,
  notes TEXT DEFAULT '',
  changed_by TEXT NOT NULL,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id)
);

-- Auditoría de Stock
CREATE TABLE IF NOT EXISTS stock_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  quantity_change INTEGER NOT NULL,
  previous_stock INTEGER NOT NULL,
  new_stock INTEGER NOT NULL,
  operator_name TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  movement_type TEXT DEFAULT 'INGRESO_PROVEEDOR' CHECK (movement_type IN ('VENTA', 'USO_EN_REPARACION', 'INGRESO_PROVEEDOR', 'AJUSTE_MERMA', 'DEVOLUCION_CLIENTE')),
  reference_id INTEGER,
  reference_code TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Historial de Precios
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  old_cost_price REAL,
  new_cost_price REAL,
  old_sale_price REAL,
  new_sale_price REAL,
  changed_by TEXT NOT NULL,
  notes TEXT DEFAULT '',
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Configuración: Tipos de Equipo
CREATE TABLE IF NOT EXISTS equipment_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- Configuración: Marcas/Modelos
CREATE TABLE IF NOT EXISTS brand_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- Repuestos usados en reparación
CREATE TABLE IF NOT EXISTS repair_parts_used (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Costos externos de reparación
CREATE TABLE IF NOT EXISTS repair_external_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER,
  concept TEXT NOT NULL,
  cost_amount REAL NOT NULL CHECK (cost_amount >= 0),
  payment_method TEXT DEFAULT 'Caja' CHECK (payment_method IN ('Caja', 'Yape/Plin', 'Transferencia', 'POS')),
  provider_name TEXT DEFAULT '',
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id)
);

-- Fallas Comunes
CREATE TABLE IF NOT EXISTS common_faults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  equipment_type_id INTEGER,
  FOREIGN KEY (equipment_type_id) REFERENCES equipment_types(id)
);

-- Imágenes de Reparación
CREATE TABLE IF NOT EXISTS repair_images (
  id TEXT PRIMARY KEY,
  repair_id INTEGER,
  image_url TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id)
);

-- Lotes de Inventario
CREATE TABLE IF NOT EXISTS inventory_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  original_quantity INTEGER NOT NULL,
  remaining_quantity INTEGER NOT NULL,
  cost_price REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Revalorizaciones de Inventario
CREATE TABLE IF NOT EXISTS inventory_revaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  product_name TEXT,
  old_cost_price REAL,
  new_cost_price REAL,
  stock_at_change INTEGER,
  revaluation_profit REAL,
  changed_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Datos iniciales obligatorios
INSERT OR IGNORE INTO profiles (id, username, password, role) VALUES ('admin-uuid-1', 'juan', 'juan123', 'admin');
INSERT OR IGNORE INTO profiles (id, username, password, role) VALUES ('operator-uuid-2', 'junior', 'junior123', 'operator');
`;

try {
  db.exec(initSQL);
  console.log('✅ Base de datos SQLite creada exitosamente en:', dbPath);
} catch (error) {
  console.error('❌ Error al inicializar la base de datos:', error.message);
} finally {
  db.close();
}
