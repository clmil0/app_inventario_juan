const fs = require('fs');
const path = require('path');
// Importante: instalar con `npm install better-sqlite3` antes de ejecutar
const Database = require('better-sqlite3');
const { migrate } = require('./server/schema');

const dbName = process.env.TEST_MODE === 'true' ? 'test_data.db' : 'local_data.db';
const dbPath = path.join(__dirname, dbName);

console.log('📦 Inicializando base de datos local SQLite...');

// Crear conexión (creará el archivo si no existe)
const db = new Database(dbPath, { verbose: console.log });

try {
  migrate(db);
  console.log('✅ Base de datos SQLite creada exitosamente en:', dbPath);
} catch (error) {
  console.error('❌ Error al inicializar la base de datos:', error.message);
} finally {
  db.close();
}
