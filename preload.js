const { contextBridge, webFrame } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    setZoom: (level) => webFrame.setZoomFactor(level)
});
