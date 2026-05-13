const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, screen, shell } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

let overlayWindow;
let settingsWindow;
let wizardWindow;
let tray = null;
const configPath = path.join(app.getPath('userData'), 'window-config.json');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const wizardCompletedPath = path.join(app.getPath('userData'), 'wizard-completed.json');

function getDefaultUsername() {
  const rawUsername = os.userInfo().username || process.env.USER || process.env.USERNAME || 'User';
  return rawUsername
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getDefaultSettings() {
  return {
    username: getDefaultUsername(),
    hotkey: 'F9',
    timeout: 10,
    opacity: 60,
    serverUrl: 'ws://localhost:8000',
    roomId: ''
  };
}

let currentSettings = getDefaultSettings();

const preloadPath = path.join(__dirname, 'preload.js');

function getWindowWebPreferences() {
  return {
    preload: preloadPath,
    nodeIntegration: false,
    contextIsolation: true
  };
}

function isWizardCompleted() {
  try {
    return fs.existsSync(wizardCompletedPath);
  } catch (e) {
    return false;
  }
}

function attachWindowDebugLogging(win, name) {
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[${name}] did-fail-load`, {
      errorCode,
      errorDescription,
      validatedURL
    });
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[${name}] render-process-gone`, details);
  });

  win.on('unresponsive', () => {
    console.error(`[${name}] window became unresponsive`);
  });
}

function broadcastSettings() {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('settings-changed', currentSettings);
  });
}

function applySettings(newSettings) {
  const previousSettings = { ...currentSettings };
  const nextSettings = { ...currentSettings, ...newSettings };
  const previousHotkey = previousSettings.hotkey;
  const nextHotkey = nextSettings.hotkey;

  if (previousHotkey !== nextHotkey) {
    globalShortcut.unregister(previousHotkey);
    let registered = false;
    try {
      registered = globalShortcut.register(nextHotkey, toggleOverlay);
    } catch (error) {
      console.error(`Hotkey registration threw for "${nextHotkey}":`, error);
      try {
        globalShortcut.register(previousHotkey, toggleOverlay);
      } catch (restoreError) {
        console.error(`Failed to restore previous hotkey "${previousHotkey}":`, restoreError);
      }
      return { success: false, error: `Invalid hotkey "${nextHotkey}". Try letters, numbers, F-keys, and modifiers.` };
    }

    if (!registered) {
      console.error(`Failed to register hotkey "${nextHotkey}". Restoring previous hotkey "${previousHotkey}".`);
      let restored = false;
      try {
        restored = globalShortcut.register(previousHotkey, toggleOverlay);
      } catch (restoreError) {
        console.error(`Failed to restore previous hotkey "${previousHotkey}":`, restoreError);
      }
      if (!restored) {
        console.error(`Failed to restore previous hotkey "${previousHotkey}".`);
      }
      return { success: false, error: `Failed to register hotkey "${nextHotkey}".` };
    }
  }

  currentSettings = nextSettings;
  saveSettings();
  broadcastSettings();
  return { success: true };
}

function createSettingsWindow() {
  const win = new BrowserWindow({
    width: 500,
    height: 600,
    frame: false,
    backgroundColor: '#1a1a1a',
    webPreferences: getWindowWebPreferences()
  });

  attachWindowDebugLogging(win, 'settings');
  win.loadFile(path.join(__dirname, '../ui/settings.html'));
  win.on('closed', () => {
    settingsWindow = null;
  });

  return win;
}

function openWizard() {
  if (wizardWindow) {
    wizardWindow.focus();
    return;
  }
  
  wizardWindow = new BrowserWindow({
    width: 600,
    height: 550,
    frame: false,
    backgroundColor: '#1a1a1a',
    resizable: false,
    webPreferences: getWindowWebPreferences()
  });

  attachWindowDebugLogging(wizardWindow, 'wizard');
  wizardWindow.loadFile(path.join(__dirname, '../ui/wizard.html'));
  wizardWindow.on('closed', () => {
    wizardWindow = null;
  });
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      currentSettings = {
        ...getDefaultSettings(),
        ...JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function loadWindowConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load window config:', e);
  }
  return { x: 100, y: 100, width: 400, height: 600 };
}

let saveConfigTimeout = null;
function saveWindowConfig() {
  if (saveConfigTimeout) clearTimeout(saveConfigTimeout);
  saveConfigTimeout = setTimeout(() => {
    try {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      const bounds = overlayWindow.getBounds();
      fs.writeFileSync(configPath, JSON.stringify(bounds, null, 2));
    } catch (e) {
      console.error('Failed to save window config:', e);
    }
  }, 1000);
}

function createOverlay() {
  const config = loadWindowConfig();
  
  overlayWindow = new BrowserWindow({
    x: config.x,
    y: config.y,
    width: config.width,
    height: config.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    focusable: false,
    webPreferences: getWindowWebPreferences()
  });

  attachWindowDebugLogging(overlayWindow, 'overlay');
  // Keep overlay visible across Spaces, including fullscreen app Spaces on macOS.
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(path.join(__dirname, '../ui/index.html'));
  
  // Show after loading to avoid flash
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.showInactive();
  });
  
  // Save position when moved or resized
  overlayWindow.on('moved', saveWindowConfig);
  overlayWindow.on('resized', saveWindowConfig);
}

let isInputMode = false;
let isOverlayEnabled = true;

function openDevToolsForWindow(win) {
  if (!win || win.isDestroyed()) return;

  if (!win.isVisible()) {
    win.show();
  }

  win.webContents.openDevTools({ mode: 'detach' });
  win.focus();
}

function openDevToolsForTarget(target) {
  if (target === 'settings') {
    if (!settingsWindow || settingsWindow.isDestroyed()) {
      settingsWindow = createSettingsWindow();
    }

    openDevToolsForWindow(settingsWindow);
    return;
  }

  if (target === 'wizard') {
    if (!wizardWindow || wizardWindow.isDestroyed()) {
      openWizard();
    }

    openDevToolsForWindow(wizardWindow);
    return;
  }

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlay();
  }

  openDevToolsForWindow(overlayWindow);
}

function openFocusedWindowDevTools() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  openDevToolsForWindow(focusedWindow || overlayWindow);
}

function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: isOverlayEnabled ? 'Disable Overlay' : 'Enable Overlay',
      click: toggleOverlayEnabled
    },
    {
      label: 'Settings',
      click: () => {
        if (settingsWindow) {
          settingsWindow.focus();
          return;
        }

        settingsWindow = createSettingsWindow();
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'Open Overlay DevTools',
      click: () => {
        openDevToolsForTarget('overlay');
      }
    },
    {
      label: 'Open Settings DevTools',
      click: () => {
        openDevToolsForTarget('settings');
      }
    },
    {
      label: 'Open Wizard DevTools',
      click: () => {
        openDevToolsForTarget('wizard');
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
}

function createTray() {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Dean Chat');
  
  updateTrayMenu();
  
  // Toggle overlay on tray icon click (only if enabled)
  tray.on('click', () => {
    if (isOverlayEnabled) {
      toggleOverlay();
    }
  });
}

function toggleOverlayEnabled() {
  isOverlayEnabled = !isOverlayEnabled;
  
  if (isOverlayEnabled) {
    // Re-enable: register hotkey and show overlay
    globalShortcut.register(currentSettings.hotkey, toggleOverlay);
    overlayWindow.show();
  } else {
    // Disable: unregister hotkey, hide overlay, and reset input mode
    globalShortcut.unregister(currentSettings.hotkey);
    isInputMode = false;
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.setFocusable(false);
    overlayWindow.hide();
  }
  
  updateTrayMenu();
}

function disableOverlayInputMode() {
  isInputMode = false;
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  // On macOS, explicit blur can trigger a visible contraction animation.
  if (process.platform !== 'darwin') {
    overlayWindow.blur();
  }

  overlayWindow.setFocusable(false);
  overlayWindow.webContents.send('disable-input-mode');
}

function toggleOverlay() {
  if (!isOverlayEnabled) return;
  
  isInputMode = !isInputMode;
  
  if (isInputMode) {
    // Enable input mode - allow mouse events and make focusable
    overlayWindow.setFocusable(true);
    overlayWindow.setIgnoreMouseEvents(false);
    overlayWindow.focus();
    overlayWindow.webContents.send('enable-input-mode');
  } else {
    // Disable input mode - ignore mouse events and make unfocusable
    disableOverlayInputMode();
  }
}

app.whenReady().then(() => {
  loadSettings();
  
  // Create tray icon
  createTray();
  
  // Show wizard on first run
  if (!isWizardCompleted()) {
    openWizard();
  }
  
  createOverlay();
  
  // Register global hotkey
  const registered = globalShortcut.register(currentSettings.hotkey, toggleOverlay);
  
  if (!registered) {
    console.log('Failed to register hotkey');
  }

  const devToolsShortcut = globalShortcut.register('CommandOrControl+Shift+I', openFocusedWindowDevTools);
  if (!devToolsShortcut) {
    console.log('Failed to register devtools shortcut');
  }

  const f12DevToolsShortcut = globalShortcut.register('F12', openFocusedWindowDevTools);
  if (!f12DevToolsShortcut) {
    console.log('Failed to register F12 devtools shortcut');
  }
  
  // Custom window dragging listener
  let draggingWin = null;
  let dragInterval = null;
  let dragOffset = null;
  ipcMain.on('start-drag', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    
    draggingWin = win;
    const startCursorPos = screen.getCursorScreenPoint();
    const startWinPos = win.getPosition();
    dragOffset = {
      x: startCursorPos.x - startWinPos[0],
      y: startCursorPos.y - startWinPos[1]
    };
    
    if (dragInterval) clearInterval(dragInterval);
    
    dragInterval = setInterval(() => {
      if (draggingWin && !draggingWin.isDestroyed()) {
        const cursorPos = screen.getCursorScreenPoint();
        draggingWin.setPosition(cursorPos.x - dragOffset.x, cursorPos.y - dragOffset.y);
      } else {
        clearInterval(dragInterval);
      }
    }, 16);
  });

  ipcMain.on('stop-drag', () => {
    draggingWin = null;
    if (dragInterval) {
      clearInterval(dragInterval);
      dragInterval = null;
    }
  });

  // Handle hide request from renderer
  ipcMain.on('hide-overlay', () => {
    disableOverlayInputMode();
  });
  
  // Open settings window
  ipcMain.on('open-settings', () => {
    if (settingsWindow) {
      settingsWindow.focus();
      return;
    }

    settingsWindow = createSettingsWindow();
  });

  // Reset window position
  ipcMain.on('reset-window-position', () => {
    if (overlayWindow) {
      overlayWindow.center();
      saveWindowConfig();
    }
  });
  
  // Open wizard
  ipcMain.on('open-wizard', () => {
    openWizard();
  });
  
  // Handle settings update
  ipcMain.on('settings-updated', (_event, newSettings) => {
    const result = applySettings(newSettings);
    if (!result.success) {
      console.error(result.error);
    }
  });

  ipcMain.handle('settings:load', () => {
    loadSettings();
    return currentSettings;
  });

  ipcMain.handle('settings:save', (_event, newSettings) => {
    return applySettings(newSettings);
  });

  ipcMain.handle('wizard:complete', (_event, newSettings) => {
    const result = applySettings(newSettings);
    if (!result.success) {
      return result;
    }

    fs.writeFileSync(
      wizardCompletedPath,
      JSON.stringify({ completed: true, date: new Date().toISOString() })
    );

    return { success: true };
  });

  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.close();
    }
    return { success: true };
  });

  ipcMain.handle('shell:open-external', (_event, url) => {
    if (typeof url !== 'string' || !url) {
      return { success: false };
    }

    shell.openExternal(url);
    return { success: true };
  });
  
  // Send initial settings to overlay
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow.webContents.send('settings-changed', currentSettings);
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Don't quit on window close, keep running in background
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createOverlay();
  }
});
