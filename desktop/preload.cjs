const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('limeDesktop', {
  chooseProjectFolder: (currentPath) =>
    ipcRenderer.invoke('lime:choose-project-folder', currentPath),
});
