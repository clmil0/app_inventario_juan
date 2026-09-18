const path = require('path');
const Database = require('better-sqlite3');

const dbName = process.env.TEST_MODE === 'true' ? 'test_data.db' : 'local_data.db';
const dbPath = path.join(__dirname, '..', dbName);
console.log(`[DB INIT] Conectando a la base de datos en: ${dbPath}`);
const db = new Database(dbPath, { verbose: null }); // poner console.log para debuggear queries

try {
    const res = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'").get();
    console.log(`[DB INIT] Tabla profiles existe: ${!!res}`);
} catch(e) {
    console.log(`[DB INIT] Error verificando tabla: ${e.message}`);
}

module.exports = db;
