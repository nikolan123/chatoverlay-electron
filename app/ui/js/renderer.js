var electronAPI = window.electronAPI || {};

if (window.lucide?.createIcons) {
  window.lucide.createIcons();
}

const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const messagesContainer = document.getElementById('messages');
const messagesWrapper = document.getElementById('messagesWrapper');
const chatArea = document.getElementById('chatArea');
const contentContainer = document.getElementById('contentContainer');
const minimizeBtn = document.getElementById('minimize');
const settingsBtn = document.getElementById('settingsBtn');
const inputContent = document.getElementById('inputContent');
const autocompleteDiv = document.getElementById('autocomplete');
const resizeHandle = document.getElementById('resizeHandle');
const header = document.getElementById('header');

// Drag handling
let isDraggingWindow = false;

if (header) {
  header.addEventListener('mousedown', (e) => {
    // Only drag on left click and when not clicking a button/input
    if (e.button !== 0) return;
    if (e.target.closest('button') || e.target.closest('input')) return;
    
    isDraggingWindow = true;
    electronAPI.startDrag();
  });
}

// Resize handling
let isResizing = false;
let startY, startHeight;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  startY = e.clientY;
  startHeight = currentSettings.maxHeight || 400;
  document.body.classList.add('cursor-ns-resize');
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  
  const deltaY = startY - e.clientY;
  const newHeight = Math.max(100, Math.min(window.innerHeight - 150, startHeight + deltaY));
  
  currentSettings.maxHeight = newHeight;
  messagesWrapper.style.maxHeight = `${newHeight}px`;
  resizeHandle.style.bottom = `${newHeight}px`;
});

window.addEventListener('mouseup', () => {
  if (isDraggingWindow) {
    isDraggingWindow = false;
    electronAPI.stopDrag();
  }

  if (isResizing) {
    isResizing = false;
    document.body.classList.remove('cursor-ns-resize');
    
    // Save the new height
    electronAPI.updateSettings(currentSettings);
  }
});

function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function buildExternalLink(href, text) {
  if (!isSafeExternalUrl(href)) {
    return text;
  }

  const safeHref = href.replace(/"/g, '&quot;');
  return `<a href="${safeHref}" class="text-purple-200 hover:text-purple-100 underline pointer-events-auto cursor-pointer external-link">${text}</a>`;
}

// Simple markdown parser
function parseMarkdown(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold my-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold my-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold my-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-white/10 px-1 py-0.5 rounded font-mono text-sm">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => buildExternalLink(href, label))
    .replace(/(https?:\/\/[^\s<"]+)/g, (url) => buildExternalLink(url, url))
    .replace(/\n/g, '<br>');
}

let isInputMode = false;
let currentSettings = {
  username: electronAPI.defaultUsername || 'You',
  hotkey: 'F9',
  timeout: 10,
  maxHeight: 400,
  maxWidth: 100,
  opacity: 60,
  serverUrl: 'ws://localhost:8000',
  roomId: ''
};

let ws = null;
let reconnectTimeout = null;
let availableCommands = [];
let selectedCommandIndex = -1;
let typingUsers = new Set();
let typingTimeout = null;
let lastTypingEmit = 0;

// Listen for settings changes
electronAPI.onSettingsChanged((settings) => {
  currentSettings = settings;
  
  // Update messages wrapper styles
  messagesWrapper.style.backgroundColor = `rgba(0, 0, 0, ${settings.opacity / 100})`;
  messagesWrapper.style.backdropFilter = 'blur(12px)';
  
  // Apply max size settings
  if (settings.maxHeight) {
    messagesWrapper.style.maxHeight = `${settings.maxHeight}px`;
    resizeHandle.style.bottom = `${settings.maxHeight}px`;
  }
  if (settings.maxWidth) {
    contentContainer.style.maxWidth = `${settings.maxWidth}%`;
    contentContainer.style.margin = '0 auto'; // Center it
  }
  
  // Reconnect to Dean server with new settings
  connectToServer();
});

// Username colors
const usernameColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
  '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788'
];

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

function getUsernameColor(username) {
  const hash = Math.abs(hashCode(username));
  return usernameColors[hash % usernameColors.length];
}

function formatTime() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Enable input mode
electronAPI.onEnableInputMode(() => {
  isInputMode = true;
  
  // Show ALL messages when in input mode
  const allMessages = messagesContainer.querySelectorAll('.message-item');
  allMessages.forEach(msg => {
    msg.style.display = '';
    msg.style.opacity = '1';
    msg.style.transition = 'none';
  });
  
  // Enable pointer events on messages wrapper for clickable links
  messagesWrapper.style.pointerEvents = 'auto';
  resizeHandle.classList.remove('hidden');
  
  updateMessagesWrapperVisibility();
  inputContent.classList.remove('input-mode-hidden');
  inputContent.classList.add('input-mode-visible');
  inputContent.style.backgroundColor = `rgba(0, 0, 0, ${currentSettings.opacity / 100})`;
  inputContent.style.backdropFilter = 'blur(12px)';
  inputContent.classList.add('border', 'border-white/10', 'border-t-0', 'rounded-b');
  
  // Scroll to bottom after unhiding all previous messages
  messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
  
  messageInput.focus();
});

// Disable input mode
electronAPI.onDisableInputMode(() => {
  isInputMode = false;
  
  // Hide expired messages when going back to idle
  const now = Date.now();
  const allMessages = messagesContainer.querySelectorAll('.message-item');
  allMessages.forEach(msg => {
    const messageAge = now - parseInt(msg.dataset.timestamp);
    if (messageAge >= currentSettings.timeout * 1000) {
      msg.style.display = 'none';
    }
  });
  
  // Disable pointer events on messages wrapper when not in input mode
  messagesWrapper.style.pointerEvents = 'none';
  resizeHandle.classList.add('hidden');
  
  updateMessagesWrapperVisibility();
  inputContent.classList.add('input-mode-hidden');
  inputContent.classList.remove('input-mode-visible', 'border', 'border-white/10', 'border-t-0', 'rounded-b');
  inputContent.style.backgroundColor = '';
  inputContent.style.backdropFilter = '';
});

function addMessage(username, text) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'mb-1 text-sm leading-relaxed message-item break-words';
  messageDiv.dataset.timestamp = Date.now();
  
  const color = getUsernameColor(username);
  const time = formatTime();
  
  // Parse markdown
  const formattedText = parseMarkdown(text);
  
  messageDiv.innerHTML = `
    <span class="text-white/40 text-xs mr-1.5">${time}</span>
    <span class="font-semibold mr-1.5" style="color: ${color}">${username}:</span>
    <span class="text-white/90 break-words">${formattedText}</span>
  `;
  
  messagesContainer.appendChild(messageDiv);
  messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
  updateMessagesWrapperVisibility();
  
  // Auto-hide THIS specific message after timeout when not in input mode
  const hideTimeout = setTimeout(() => {
    if (!isInputMode) {
      messageDiv.style.opacity = '0';
      messageDiv.style.transition = 'opacity 0.5s';
      setTimeout(() => {
        if (!isInputMode) {
          messageDiv.style.display = 'none';
          updateMessagesWrapperVisibility();
        }
      }, 500);
    }
  }, currentSettings.timeout * 1000);
  
  // Store timeout so we can clear it if needed
  messageDiv.dataset.hideTimeout = hideTimeout;
}

function updateMessagesWrapperVisibility() {
  const visibleMessages = Array.from(messagesContainer.querySelectorAll('.message-item'))
    .filter(msg => msg.style.display !== 'none');
  
  // Always show the wrapper in input mode to allow resizing even when empty
  messagesWrapper.style.display = (visibleMessages.length === 0 && !isInputMode) ? 'none' : 'block';
}

// WebSocket connection management
function connectToServer() {
  // Close existing connection
  if (ws) {
    ws.onclose = null; // Prevent reconnect
    ws.close();
    ws = null;
  }
  
  // Clear any pending reconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  // Don't connect if no room ID
  if (!currentSettings.roomId) {
    console.log('No room ID set, skipping Dean server connection');
    return;
  }
  
  const serverUrl = currentSettings.serverUrl;
  const roomId = currentSettings.roomId;
  const username = encodeURIComponent(currentSettings.username);
  
  try {
    ws = new WebSocket(`${serverUrl}/ws/${roomId}?username=${username}`);
    
    ws.onopen = () => {
      console.log('Connected to Dean server');
      addMessage('System', 'Connected to Dean server');
    };
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        // Handle different message types
        if (msg.type === 'commands') {
          // Dean server sent available commands
          availableCommands = msg.commands || [];
        } else if (msg.type === 'command_response') {
          // Dean server response to a command
          addMessage('Dean Server', msg.text);
        } else if (msg.type === 'message') {
          // Regular chat message
          // Don't add our own messages again (server echoes them)
          if (msg.username !== currentSettings.username) {
            addMessage(msg.username, msg.text);
          }
        } else if (msg.type === 'typing') {
          // Someone is typing
          if (msg.username !== currentSettings.username) {
            handleTypingIndicator(msg.username, msg.isTyping);
          }
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      addMessage('System', 'Dean server connection error');
    };
    
    ws.onclose = () => {
      console.log('Disconnected from Dean server');
      addMessage('System', 'Disconnected from Dean server');
      ws = null;
      
      // Attempt reconnect after 5 seconds
      reconnectTimeout = setTimeout(() => {
        console.log('Attempting to reconnect...');
        connectToServer();
      }, 5000);
    };
  } catch (e) {
    console.error('Failed to connect:', e);
    addMessage('System', 'Failed to connect to Dean server');
  }
}

function sendMessage() {
  const text = messageInput.value.trim();
  if (text) {
    // Check if it's a command
    const isCommand = text.startsWith('/');
    
    // Send to Dean server if connected
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        if (isCommand) {
          // Send as command
          ws.send(JSON.stringify({ type: 'command', text }));
          addMessage(currentSettings.username, text);
        } else {
          // Send as regular message
          ws.send(JSON.stringify({ type: 'message', text }));
          addMessage(currentSettings.username, text);
        }
      } catch (e) {
        console.error('Failed to send message:', e);
        addMessage('System', 'Failed to send message');
      }
    } else {
      // Fallback to local-only mode
      addMessage(currentSettings.username, text);
      addMessage('System', 'Not connected to Dean server');
    }
    
    messageInput.value = '';
    hideAutocomplete();
    electronAPI.hideOverlay();
  }
}

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    // If autocomplete is open, complete the selected command
    if (!autocompleteDiv.classList.contains('hidden') && selectedCommandIndex >= 0) {
      e.preventDefault();
      const selectedItem = autocompleteDiv.children[selectedCommandIndex];
      if (selectedItem) {
        messageInput.value = selectedItem.dataset.command + ' ';
        hideAutocomplete();
        messageInput.focus();
      }
    } else {
      sendMessage();
    }
  }
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideAutocomplete();
    electronAPI.hideOverlay();
  } else if (e.key === 'ArrowDown') {
    if (!autocompleteDiv.classList.contains('hidden')) {
      e.preventDefault();
      if (selectedCommandIndex < autocompleteDiv.children.length - 1) {
        selectedCommandIndex++;
        updateAutocompleteSelection();
        scrollToSelectedCommand();
      }
    }
  } else if (e.key === 'ArrowUp') {
    if (!autocompleteDiv.classList.contains('hidden')) {
      e.preventDefault();
      if (selectedCommandIndex > 0) {
        selectedCommandIndex--;
        updateAutocompleteSelection();
        scrollToSelectedCommand();
      }
    }
  } else if (e.key === 'Tab') {
    if (!autocompleteDiv.classList.contains('hidden') && selectedCommandIndex >= 0) {
      e.preventDefault();
      const selectedItem = autocompleteDiv.children[selectedCommandIndex];
      if (selectedItem) {
        messageInput.value = selectedItem.dataset.command;
        hideAutocomplete();
      }
    }
  }
});

messageInput.addEventListener('input', () => {
  const text = messageInput.value;
  
  // Send typing indicator
  emitTyping();
  
  if (text.startsWith('/')) {
    // Show autocomplete for commands
    const query = text.slice(1).toLowerCase();
    const matches = availableCommands.filter(cmd => 
      cmd.name.toLowerCase().startsWith(query)
    );
    
    if (matches.length > 0) {
      showAutocomplete(matches);
    } else {
      hideAutocomplete();
    }
  } else {
    hideAutocomplete();
  }
});

function showAutocomplete(commands) {
  autocompleteDiv.innerHTML = '';
  selectedCommandIndex = 0;
  
  commands.forEach((cmd, index) => {
    const item = document.createElement('div');
    item.className = 'px-3 py-2 cursor-pointer hover:bg-white/10';
    item.dataset.command = `/${cmd.name}`;
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'text-white font-medium';
    nameSpan.textContent = `/${cmd.name}`;
    
    const descSpan = document.createElement('span');
    descSpan.className = 'text-white/50 text-xs ml-2';
    descSpan.textContent = cmd.description || '';
    
    item.appendChild(nameSpan);
    if (cmd.description) {
      item.appendChild(descSpan);
    }
    
    item.addEventListener('click', () => {
      messageInput.value = `/${cmd.name}`;
      hideAutocomplete();
      messageInput.focus();
    });
    
    autocompleteDiv.appendChild(item);
  });
  
  autocompleteDiv.classList.remove('hidden');
  updateAutocompleteSelection();
}

function hideAutocomplete() {
  autocompleteDiv.classList.add('hidden');
  selectedCommandIndex = -1;
}

function updateAutocompleteSelection() {
  Array.from(autocompleteDiv.children).forEach((item, index) => {
    if (index === selectedCommandIndex) {
      item.classList.add('bg-white/10');
    } else {
      item.classList.remove('bg-white/10');
    }
  });
}

function scrollToSelectedCommand() {
  const selectedItem = autocompleteDiv.children[selectedCommandIndex];
  if (selectedItem) {
    selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

minimizeBtn.addEventListener('click', () => {
  electronAPI.hideOverlay();
});

settingsBtn.addEventListener('click', () => {
  // Close overlay first
  electronAPI.hideOverlay();
  // Then open settings
  electronAPI.openSettings();
});

function emitTyping() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  const now = Date.now();
  // Throttle typing events to once per second
  if (now - lastTypingEmit < 1000) return;
  
  lastTypingEmit = now;
  
  try {
    ws.send(JSON.stringify({ type: 'typing', isTyping: true }));
  } catch (e) {
    console.error('Failed to send typing indicator:', e);
  }
  
  // Clear existing timeout
  if (typingTimeout) {
    clearTimeout(typingTimeout);
  }
  
  // Stop typing after 3 seconds of inactivity
  typingTimeout = setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'typing', isTyping: false }));
      } catch (e) {
        console.error('Failed to send typing stop:', e);
      }
    }
  }, 3000);
}

function handleTypingIndicator(username, isTyping) {
  if (isTyping) {
    typingUsers.add(username);
  } else {
    typingUsers.delete(username);
  }
  updateTypingIndicator();
}

function updateTypingIndicator() {
  let indicator = document.getElementById('typingIndicator');
  
  if (typingUsers.size === 0) {
    if (indicator) {
      indicator.remove();
    }
    return;
  }
  
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'typingIndicator';
    indicator.className = 'text-xs text-white/50 italic px-3 py-1';
    messagesWrapper.appendChild(indicator);
  }
  
  const users = Array.from(typingUsers);
  let text = '';
  
  if (users.length === 1) {
    text = `${users[0]} is typing...`;
  } else if (users.length === 2) {
    text = `${users[0]} and ${users[1]} are typing...`;
  } else {
    text = `${users[0]} and ${users.length - 1} others are typing...`;
  }
  
  indicator.textContent = text;
  messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
}

addMessage('System', 'Dean Chat ready');

// Handle external link clicks
messagesContainer.addEventListener('click', (e) => {
  if (e.target.classList.contains('external-link')) {
    e.preventDefault();
    const url = e.target.getAttribute('href');
    if (url) {
      electronAPI.openExternal(url);
    }
  }
});

// Connect to server on startup
connectToServer();
