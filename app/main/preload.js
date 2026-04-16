const { contextBridge, ipcRenderer } = require('electron');

function getDefaultUsername() {
  const rawUsername = process.env.USER || process.env.USERNAME || 'You';
  return rawUsername
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'You';
}

function subscribe(channel, listener) {
  const wrappedListener = (_event, ...args) => listener(...args);
  ipcRenderer.on(channel, wrappedListener);
  return () => {
    ipcRenderer.removeListener(channel, wrappedListener);
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  defaultUsername: getDefaultUsername(),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  completeWizard: (settings) => ipcRenderer.invoke('wizard:complete', settings),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  startDrag: () => ipcRenderer.send('start-drag'),
  stopDrag: () => ipcRenderer.send('stop-drag'),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  openSettings: () => ipcRenderer.send('open-settings'),
  resetWindowPosition: () => ipcRenderer.send('reset-window-position'),
  openWizard: () => ipcRenderer.send('open-wizard'),
  updateSettings: (settings) => ipcRenderer.send('settings-updated', settings),
  onSettingsChanged: (listener) => subscribe('settings-changed', listener),
  onEnableInputMode: (listener) => subscribe('enable-input-mode', listener),
  onDisableInputMode: (listener) => subscribe('disable-input-mode', listener)
});
