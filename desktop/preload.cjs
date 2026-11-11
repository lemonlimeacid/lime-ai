const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('supernovaDesktop', {
  chooseProjectFolder: (currentPath) =>
    ipcRenderer.invoke('supernova:choose-project-folder', currentPath),
});
