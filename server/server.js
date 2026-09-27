const express = require('express');
const path = require('path');

// 1. Inicializar el Servidor Express (API Local)
const server = express();
const PORT = process.env.PORT || 3000;
// Solo escuchar en esta PC. Antes escuchaba en todas las interfaces con CORS abierto: cualquier
// equipo de la misma red WiFi podía leer/borrar la BD (incluidas las contraseñas) vía /api/db/proxy.
// Para acceder desde otro dispositivo de la red a propósito, iniciar con HOST=0.0.0.0.
const HOST = process.env.HOST || '127.0.0.1';

// El backup se importa con su propio límite de tamaño (ver routes/backup.js)
server.use('/api/backup', require('./routes/backup'));

server.use(express.json());

// Importar rutas
server.use('/api/auth', require('./routes/auth'));
server.use('/api/products', require('./routes/products'));
server.use('/api/sales', require('./routes/sales'));
server.use('/api/repairs', require('./routes/repairs'));
server.use('/api/admin', require('./routes/admin'));
server.use('/api/dashboard', require('./routes/dashboard'));
server.use('/api/db/proxy', require('./routes/db_proxy'));

// 2. Servir los archivos estáticos del frontend (la carpeta src)
server.use(express.static(path.join(__dirname, '..', 'src')));

let expressServer;
function startExpress() {
    return new Promise((resolve, reject) => {
        expressServer = server.listen(PORT, HOST, () => {
            console.log(`✅ Servidor local (Backend) corriendo en http://localhost:${PORT}`);
            resolve(expressServer);
        });
        // Ej. EADDRINUSE: antes la promesa nunca se resolvía y la app se quedaba colgada sin ventana
        expressServer.on('error', reject);
    });
}

function stopExpress() {
    if (expressServer) {
        expressServer.close();
    }
}

// Si este archivo se ejecuta directamente (ej. para pruebas E2E)
if (require.main === module) {
    startExpress();
}

module.exports = { startExpress, stopExpress, server };
