const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startExpress, stopExpress } = require('./server/server');

const PORT = process.env.PORT || 3000;

// Habilitar impresión directa sin diálogo (equivalente a la bandera del navegador)
app.commandLine.appendSwitch('kiosk-printing');

// 3. Configuración de Electron (App de Escritorio)
function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Inventario Juan",
        icon: path.join(__dirname, 'src', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true
    });

    // Cargar la aplicación desde el servidor Express local
    mainWindow.loadURL(`http://localhost:${PORT}`);
    
    // Maximizar la ventana sin entrar en pantalla completa (solicitud del usuario)
    mainWindow.maximize();
    
    // Opcional: mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
    // Establecer ícono del Dock en macOS (para desarrollo)
    if (process.platform === 'darwin') {
        app.dock.setIcon(path.join(__dirname, 'src', 'icon.png'));
    }

    await startExpress();
    createWindow();

    // Iniciar sincronización a Supabase cada 30 minutos (si está configurado)
    const { syncDashboardData } = require('./server/sync');
    syncDashboardData(); // Ejecutar al inicio
    setInterval(syncDashboardData, 30 * 60 * 1000); // 30 minutos

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // En macOS es común mantener la app abierta hasta hacer Cmd+Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('quit', () => {
    // Cerrar el servidor Express y BD de forma segura al salir
    stopExpress();
    const db = require('./server/db');
    db.close();
});
