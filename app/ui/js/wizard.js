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

let settings = getDefaultSettings();
let currentStep = 0;
const totalSteps = 4;

function applySettingsToForm(currentSettings) {
  document.getElementById('wizardUsername').value = currentSettings.username;
  document.getElementById('wizardServerUrl').value = currentSettings.serverUrl;
  document.getElementById('wizardRoomId').value = currentSettings.roomId;
  document.getElementById('wizardHotkey').value = currentSettings.hotkey;
}

function updateProgress() {
  document.querySelectorAll('.progress-dot').forEach((dot, index) => {
    if (index <= currentStep) {
      dot.classList.remove('bg-white/20');
      dot.classList.add('bg-white/60');
    } else {
      dot.classList.remove('bg-white/60');
      dot.classList.add('bg-white/20');
    }
  });
}

function showStep(step) {
  document.querySelectorAll('.step').forEach((el) => {
    el.classList.remove('active');
  });
  document.querySelector(`.step[data-step="${step}"]`).classList.add('active');

  const backBtn = document.getElementById('backBtn');
  const nextBtn = document.getElementById('nextBtn');
  const finishBtn = document.getElementById('finishBtn');

  backBtn.style.display = step > 0 ? '' : 'none';
  nextBtn.style.display = step < totalSteps - 1 ? '' : 'none';
  finishBtn.style.display = step === totalSteps - 1 ? '' : 'none';

  updateProgress();
}

const hotkeyInput = document.getElementById('wizardHotkey');
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

document.getElementById('nextBtn').addEventListener('click', () => {
  if (currentStep < totalSteps - 1) {
    currentStep++;
    showStep(currentStep);
  }
});

document.getElementById('backBtn').addEventListener('click', () => {
  if (currentStep > 0) {
    currentStep--;
    showStep(currentStep);
  }
});

document.getElementById('finishBtn').addEventListener('click', async () => {
  const newSettings = {
    username: document.getElementById('wizardUsername').value || electronAPI.defaultUsername || 'You',
    hotkey: document.getElementById('wizardHotkey').value || 'F9',
    timeout: settings.timeout || 10,
    maxHeight: settings.maxHeight || 400,
    maxWidth: settings.maxWidth || 100,
    opacity: settings.opacity || 60,
    serverUrl: document.getElementById('wizardServerUrl').value || 'ws://localhost:8000',
    roomId: document.getElementById('wizardRoomId').value || ''
  };

  try {
    const result = await electronAPI.completeWizard(newSettings);
    if (!result?.success) {
      alert(result?.error || 'Failed to complete wizard.');
      return;
    }
    await electronAPI.closeWindow();
  } catch (error) {
    console.error('Failed to save settings:', error);
    alert(error?.message || String(error) || 'Failed to complete wizard.');
  }
});

document.getElementById('closeBtn').addEventListener('click', () => {
  electronAPI.closeWindow();
});

showStep(currentStep);

async function init() {
  try {
    settings = await electronAPI.loadSettings();
    applySettingsToForm(settings || getDefaultSettings());
  } catch (error) {
    console.error('Failed to load settings:', error);
    settings = getDefaultSettings();
    applySettingsToForm(settings);
  }
}

init();
