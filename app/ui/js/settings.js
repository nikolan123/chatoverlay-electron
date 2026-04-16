var electronAPI = window.electronAPI || {};

if (window.lucide?.createIcons) {
  window.lucide.createIcons();
}

function getDefaultSettings() {
  return {
    username: electronAPI.defaultUsername || 'You',
    hotkey: 'F9',
    timeout: 10,
    maxHeight: 400,
    maxWidth: 100,
    opacity: 60,
    serverUrl: 'ws://localhost:8000',
    roomId: ''
  };
}

function applySettingsToForm(settings) {
  document.getElementById('username').value = settings.username;
  document.getElementById('hotkey').value = settings.hotkey;
  document.getElementById('timeout').value = settings.timeout;
  document.getElementById('maxHeight').value = settings.maxHeight || 400;
  document.getElementById('maxHeightValue').textContent = `${settings.maxHeight || 400}px`;
  document.getElementById('maxWidth').value = settings.maxWidth || 100;
  document.getElementById('maxWidthValue').textContent = `${settings.maxWidth || 100}%`;
  document.getElementById('opacity').value = settings.opacity;
  document.getElementById('opacityValue').textContent = `${settings.opacity}%`;
  document.getElementById('serverUrl').value = settings.serverUrl || 'ws://localhost:8000';
  document.getElementById('roomId').value = settings.roomId || '';
}

const hotkeyInput = document.getElementById('hotkey');
hotkeyInput.addEventListener('click', () => {
  hotkeyInput.value = 'Press any key...';
  hotkeyInput.classList.add('border-blue-500');
});

hotkeyInput.addEventListener('keydown', (e) => {
  e.preventDefault();

  const modifiers = [];
  if (e.ctrlKey) modifiers.push('Ctrl');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');
  if (e.metaKey) modifiers.push('Meta');

  let key = e.key;

  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();

  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    return;
  }

  const hotkey = [...modifiers, key].join('+');
  hotkeyInput.value = hotkey;
  hotkeyInput.classList.remove('border-blue-500');
  hotkeyInput.blur();
});

document.getElementById('opacity').addEventListener('input', (e) => {
  document.getElementById('opacityValue').textContent = `${e.target.value}%`;
});

document.getElementById('maxHeight').addEventListener('input', (e) => {
  document.getElementById('maxHeightValue').textContent = `${e.target.value}px`;
});

document.getElementById('maxWidth').addEventListener('input', (e) => {
  document.getElementById('maxWidthValue').textContent = `${e.target.value}%`;
});

electronAPI.onSettingsChanged((settings) => {
  document.getElementById('maxHeight').value = settings.maxHeight || 400;
  document.getElementById('maxHeightValue').textContent = `${settings.maxHeight || 400}px`;
  document.getElementById('maxWidth').value = settings.maxWidth || 100;
  document.getElementById('maxWidthValue').textContent = `${settings.maxWidth || 100}%`;
});

document.getElementById('resetPosBtn').addEventListener('click', () => {
  if (confirm('Are you sure you want to reset the overlay window position?')) {
    electronAPI.resetWindowPosition();
  }
});

document.getElementById('saveBtn').addEventListener('click', async () => {
    const newSettings = {
    username: document.getElementById('username').value || electronAPI.defaultUsername || 'You',
    hotkey: document.getElementById('hotkey').value,
    timeout: parseInt(document.getElementById('timeout').value, 10),
    maxHeight: parseInt(document.getElementById('maxHeight').value, 10) || 400,
    maxWidth: parseInt(document.getElementById('maxWidth').value, 10) || 100,
    opacity: parseInt(document.getElementById('opacity').value, 10),
    serverUrl: document.getElementById('serverUrl').value || 'ws://localhost:8000',
    roomId: document.getElementById('roomId').value || ''
  };

  try {
    const result = await electronAPI.saveSettings(newSettings);
    if (!result?.success) {
      alert(result?.error || 'Failed to save settings.');
      return;
    }
    await electronAPI.closeWindow();
  } catch (error) {
    console.error('Failed to save settings:', error);
    alert(error?.message || String(error) || 'Failed to save settings.');
  }
});

document.getElementById('cancelBtn').addEventListener('click', () => {
  electronAPI.closeWindow();
});

document.getElementById('closeBtn').addEventListener('click', () => {
  electronAPI.closeWindow();
});

document.getElementById('wizardBtn').addEventListener('click', () => {
  electronAPI.closeWindow();
  electronAPI.openWizard();
});

async function init() {
  try {
    const settings = await electronAPI.loadSettings();
    applySettingsToForm(settings || getDefaultSettings());
  } catch (error) {
    console.error('Failed to load settings:', error);
    applySettingsToForm(getDefaultSettings());
  }
}

init();
