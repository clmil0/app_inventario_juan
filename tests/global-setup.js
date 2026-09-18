const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

module.exports = async () => {
    const testDbPath = path.join(__dirname, '..', 'test_data.db');
    
    // 1. Borrar si existe para un entorno limpio al inicio de la suite
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }
    
    // 2. Ejecutar init_db.js en TEST_MODE para crear las tablas
    console.log('Ejecutando global setup: inicializando base de datos de pruebas...');
    execSync('npx cross-env TEST_MODE=true node init_db.js', { stdio: 'inherit' });
};
