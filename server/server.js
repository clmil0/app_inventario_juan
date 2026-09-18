const express = require('express');
const cors = require('cors');
const path = require('path');

// 1. Inicializar el Servidor Express (API Local)
const server = express();
const PORT = process.env.PORT || 3000;

server.use(cors());
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
    return new Promise((resolve) => {
        expressServer = server.listen(PORT, () => {
            console.log(`✅ Servidor local (Backend) corriendo en http://localhost:${PORT}`);
            resolve(expressServer);
        });
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
