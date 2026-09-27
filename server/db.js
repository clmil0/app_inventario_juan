const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { migrate } = require('./schema');

// En la app empaquetada main.js apunta INVENTARIO_DATA_DIR a la carpeta de datos del usuario
// (dentro de app.asar no se puede escribir). En desarrollo se usa la raíz del proyecto.
const dataDir = process.env.INVENTARIO_DATA_DIR || path.join(__dirname, '..');
fs.mkdirSync(dataDir, { recursive: true });

const dbName = process.env.TEST_MODE === 'true' ? 'test_data.db' : 'local_data.db';
const dbPath = path.join(dataDir, dbName);
console.log(`[DB INIT] Conectando a la base de datos en: ${dbPath}`);
const db = new Database(dbPath, { verbose: null }); // poner console.log para debuggear queries

migrate(db);

db.dataDir = dataDir;
db.dbPath = dbPath;

module.exports = db;
