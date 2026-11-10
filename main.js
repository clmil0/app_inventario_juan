const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');

// En la app empaquetada el código vive dentro de app.asar (solo lectura): la BD debe ir en la
// carpeta de datos del usuario o no se podría guardar nada. Debe definirse antes de cargar el servidor.
if (app.isPackaged && !process.env.INVENTARIO_DATA_DIR) {
    process.env.INVENTARIO_DATA_DIR = app.getPath('userData');
}

const { startExpress, stopExpress } = require('./server/server');

const PORT = process.env.PORT || 3000;

// Impresión directa (sin diálogo). Electron IGNORA la bandera --kiosk-printing de Chrome: window.print()
// siempre abre el diálogo del sistema. Por eso los tickets se imprimen desde aquí con
// webContents.print({ silent: true }) en una ventana oculta (ver preload.js → electronAPI.printHtml).
ipcMain.handle('printers:list', async (event) => {
    const list = await event.sender.getPrintersAsync();
    return list.map(p => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
});

ipcMain.handle('print:html', async (event, { html, deviceName } = {}) => {
    if (typeof html !== 'string' || !html) return { success: false, error: 'Documento vacío' };
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    try {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        // Espera la fuente de los títulos (máx. 1.5 s) para que no salga con la de respaldo
        await Promise.race([
            win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true'),
            new Promise(r => setTimeout(r, 1500))
        ]).catch(() => {});
        const options = { silent: true, printBackground: true, margins: { marginType: 'none' } };
        if (deviceName) options.deviceName = deviceName;
        return await new Promise(resolve => {
            win.webContents.print(options, (success, failureReason) => resolve({ success, error: success ? null : failureReason }));
        });
    } catch (e) {
        return { success: false, error: e.message };
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
});

// Ícono de ventana/barra de tareas: .ico en Windows (varios tamaños nítidos), PNG en el resto
const WINDOW_ICON = path.join(__dirname, 'src', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// 3. Configuración de Electron (App de Escritorio)
function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Inventario Juan",
        icon: WINDOW_ICON,
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
        app.dock.setIcon(path.join(__dirname, 'src', 'icon-mac.png'));
    }

    try {
        await startExpress();
    } catch (err) {
        const msg = err.code === 'EADDRINUSE'
            ? `El puerto ${PORT} ya está en uso por otro programa (¿la app ya está abierta?).`
            : err.message;
        dialog.showErrorBox('No se pudo iniciar el servidor local', msg);
        app.quit();
        return;
    }
    createWindow();

    // La app es 100% local: ya no se sincroniza nada con Supabase ni con ninguna nube.
    // Los datos (BD + fotos y videos) solo salen de esta PC con "Exportar backup".

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
