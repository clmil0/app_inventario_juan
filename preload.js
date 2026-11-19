const { contextBridge, webFrame, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    setZoom: (level) => webFrame.setZoomFactor(level),
    // Impresión directa a la impresora (sin diálogo). deviceName vacío = impresora predeterminada del sistema
    printHtml: (html, deviceName) => ipcRenderer.invoke('print:html', { html, deviceName }),
    listPrinters: () => ipcRenderer.invoke('printers:list'),
    // Busca en qué puerto USB está conectada la impresora y lo corrige si no coincide (Windows)
    fixPrinterPort: (deviceName) => ipcRenderer.invoke('printers:fix-port', { deviceName })
});
