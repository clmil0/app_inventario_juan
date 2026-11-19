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
        // Tickets: la página mide exactamente el ancho del rollo y el largo del contenido (en micras).
        // El alto nunca baja del ancho para que la impresora no la interprete como apaisada.
        const receipt = await win.webContents.executeJavaScript(
            '({ paper: Number(document.body.dataset.printWidth) || Number(document.body.dataset.paper) || 0, height: document.body.getBoundingClientRect().height })'
        );
        if (receipt.paper) {
            const width = receipt.paper * 1000;
            options.pageSize = { width, height: Math.max(Math.ceil(receipt.height * 25400 / 96) + 1000, width + 1000) };
        }
        return await new Promise(resolve => {
            win.webContents.print(options, (success, failureReason) => resolve({ success, error: success ? null : failureReason }));
        });
    } catch (e) {
        return { success: false, error: e.message };
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
});

// ── Detección del puerto USB de la impresora (solo Windows) ──
// Si la impresora se conecta a otro conector USB, Windows le crea un puerto nuevo (USB002, USB003…)
// pero la impresora sigue apuntando al anterior y los trabajos se quedan atascados en la cola.
// Aquí se busca en qué puerto está conectada de verdad y, si no coincide, se corrige.
function runPowerShell(script, env = {}) {
    const { execFile } = require('child_process');
    const encoded = Buffer.from('[Console]::OutputEncoding=[Text.Encoding]::UTF8\n' + script, 'utf16le').toString('base64');
    return new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
            { env: { ...process.env, ...env }, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim()));
    });
}

const PS_PRINTER_STATE = `
$ErrorActionPreference = 'Stop'
$name = $env:INV_PRINTER
if (-not $name) { $name = (Get-CimInstance Win32_Printer | Where-Object Default | Select-Object -First 1).Name }
$p = Get-Printer -Name $name
$offline = [bool](Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $name } | Select-Object -First 1).WorkOffline
$devs = @(Get-PnpDevice -InstanceId 'USBPRINT\\*' -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.InstanceId -match '(USB\\d{3})$') {
        [pscustomobject]@{ port = $Matches[1].ToUpper(); model = ($_.InstanceId -split '\\\\')[1]; present = ($_.Status -eq 'OK'); label = $_.FriendlyName }
    }
})
$others = @(Get-Printer | Where-Object { $_.Name -ne $name } | ForEach-Object { "$($_.PortName)".ToUpper() })
$jobs = @(Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue).Count
ConvertTo-Json -Compress -Depth 4 @{ printer = $name; port = $p.PortName; offline = $offline; jobs = $jobs; devices = $devs; others = $others }
`;

const psQuote = s => "'" + String(s).replace(/'/g, "''") + "'";
const readPrinterState = name => runPowerShell(PS_PRINTER_STATE, { INV_PRINTER: name || '' }).then(JSON.parse);

// Ejecuta comandos de configuración; si faltan permisos los repite como administrador
// (Windows muestra el aviso de control de cuentas una sola vez).
async function runPrinterCommands(cmds) {
    const script = `$ErrorActionPreference='Stop'; ${cmds.join('; ')}`;
    try {
        await runPowerShell(script);
    } catch {
        const inner = Buffer.from(script, 'utf16le').toString('base64');
        await runPowerShell(`$ErrorActionPreference='Stop'; Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${inner}'`);
    }
}

// Revisa el puerto USB y el modo "Usar impresora sin conexión" y corrige lo que haga falta
ipcMain.handle('printers:fix-port', async (event, { deviceName } = {}) => {
    if (process.platform !== 'win32') return { status: 'unsupported', message: 'La detección de puerto solo está disponible en Windows.' };
    try {
        const s = await readPrinterState(deviceName);
        const port = String(s.port || '').toUpperCase();
        const devices = [].concat(s.devices || []);
        const others = new Set([].concat(s.others || []));
        const base = { printer: s.printer, port: s.port, jobs: s.jobs || 0 };

        // 1) Puerto
        let target = null;
        let portNote = '';
        if (!/^USB\d{3}$/.test(port)) {
            portNote = `usa el puerto «${s.port}» (no es USB estándar, no se tocó)`;
        } else {
            const current = devices.filter(d => d.port === port);
            if (!current.some(d => d.present)) {
                // Puertos con una impresora conectada ahora mismo y que no usa otra impresora
                let candidates = [...new Map(devices.filter(d => d.present && !others.has(d.port)).map(d => [d.port, d])).values()];
                const model = current[0]?.model;
                if (model && candidates.some(d => d.model === model)) candidates = candidates.filter(d => d.model === model);
                if (!candidates.length) {
                    return { ...base, status: 'disconnected', message: 'No se encontró la impresora conectada por USB. Revisa que esté encendida y con el cable puesto, y vuelve a intentarlo.' };
                }
                if (candidates.length > 1) {
                    return { ...base, status: 'ambiguous', message: `Hay varias impresoras USB conectadas (${candidates.map(d => d.port).join(', ')}). Elige el puerto desde las propiedades de la impresora en Windows.` };
                }
                target = candidates[0].port;
            }
        }

        // 2) Modo sin conexión: Windows lo activa solo cuando la impresora se desconecta, y mientras
        //    esté activo los documentos se quedan en la cola aunque el puerto sea el correcto.
        const cmds = [];
        if (target) cmds.push(`Set-Printer -Name ${psQuote(s.printer)} -PortName ${psQuote(target)}`);
        if (s.offline) cmds.push(`Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq ${psQuote(s.printer)} } | Set-CimInstance -Property @{ WorkOffline = $false }`);

        if (!cmds.length) {
            return { ...base, status: 'ok', message: `«${s.printer}» está bien: ${portNote || `conectada en ${port}`} y en línea.` + (s.jobs ? ` Hay ${s.jobs} documento(s) en cola; si no salen, reinicia la impresora.` : '') };
        }
        try {
            await runPrinterCommands(cmds);
        } catch (e) {
            return { ...base, status: 'error', message: /cancel/i.test(e.message) ? 'Se canceló el permiso de administrador; no se cambió nada.' : 'No se pudo corregir la impresora: ' + e.message };
        }

        const after = await readPrinterState(s.printer);
        const portOk = !target || String(after.port).toUpperCase() === target;
        if (!portOk || after.offline) {
            return { ...base, status: 'error', message: 'No se pudo corregir la impresora (¿se canceló el permiso de administrador?).' };
        }
        const done = [];
        if (target) done.push(`puerto ${s.port} → ${target}`);
        if (s.offline) done.push('se desactivó «Usar impresora sin conexión»');
        const pending = after.jobs ? ` Hay ${after.jobs} documento${after.jobs === 1 ? '' : 's'} en cola que saldrá${after.jobs === 1 ? '' : 'n'} ahora.` : '';
        return { ...base, status: 'fixed', from: s.port, to: target || s.port, jobs: after.jobs || 0, message: `«${s.printer}» corregida: ${done.join(' y ')}.${pending}` };
    } catch (e) {
        return { status: 'error', message: 'No se pudo revisar la impresora: ' + e.message };
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
