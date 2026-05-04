// CONFIG - Replace with your Railway URL
const BACKEND_URL = 'https://tempchat-production.up.railway.app';

// Socket connection
const socket = io(BACKEND_URL, {
  transports: ['websocket'],
  reconnectionAttempts: 3,
  reconnectionDelay: 2000
});

// Settings
const settings = {
  sound: true,
  dark: true,
  autonext: true,
  datasaver: false,
  timer: true
};

// State
let currentRoom = null;
let timerInterval = null;
let typingTimeout = null;
let isTyping = false;
let nextCooldown = false;

// Screens
const screens = {
  home: document.getElementById('screen-home'),
  waiting: document.getElementById('screen-waiting'),
  private: document.getElementById('screen-private'),
  created: document.getElementById('screen-created'),
  chat: document.getElementById('screen-chat'),
  settings: document.getElementById('screen-settings')
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// Toast
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// Add message
function addMessage(text, type = 'theirs', time = '') {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `msg ${type}`;

  const p = document.createElement('p');
  p.textContent = text;
  div.appendChild(p);

  if (time && type !== 'system') {
    const t = document.createElement('div');
    t.className = 'msg-time';
    t.textContent = time;
    div.appendChild(t);
  }

  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// Clear messages
function clearMessages() {
  document.getElementById('messages').innerHTML = '';
}

// Timer
function startTimer() {
  if (!settings.timer) return;
  let seconds = 5 * 60;
  const timerEl = document.getElementById('chat-timer');
  timerEl.style.display = 'block';

  timerInterval = setInterval(() => {
    seconds--;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    timerEl.textContent = `⏱ ${m}:${s.toString().padStart(2, '0')} remaining`;

    if (seconds <= 0) {
      clearInterval(timerInterval);
      addMessage('⏱ Time is up! Chat ended.', 'system');
      if (settings.autonext) {
        setTimeout(() => startRandom(), 1500);
      } else {
        setTimeout(() => showScreen('home'), 1500);
      }
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  const timerEl = document.getElementById('chat-timer');
  if (timerEl) timerEl.textContent = '';
}

// Sound
function playSound() {
  if (!settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

// Random chat
function startRandom() {
  clearMessages();
  stopTimer();
  showScreen('waiting');
  socket.emit('joinRandom');
}

// Leave room
function leaveRoom() {
  stopTimer();
  currentRoom = null;
  socket.emit('next');
}

// Apply settings
function applySettings() {
  document.body.classList.toggle('light', !settings.dark);
  localStorage.setItem('tempchat_settings', JSON.stringify(settings));
}

// Load settings
function loadSettings() {
  try {
    const saved = localStorage.getItem('tempchat_settings');
    if (saved) Object.assign(settings, JSON.parse(saved));
  } catch (e) {}

  document.getElementById('setting-sound').checked = settings.sound;
  document.getElementById('setting-dark').checked = settings.dark;
  document.getElementById('setting-autonext').checked = settings.autonext;
  document.getElementById('setting-datasaver').checked = settings.datasaver;
  document.getElementById('setting-timer').checked = settings.timer;
  applySettings();
}

// =====================
// BUTTON EVENTS
// =====================

// Home
document.getElementById('btn-random').addEventListener('click', startRandom);

document.getElementById('btn-private').addEventListener('click', () => {
  showScreen('private');
});

document.getElementById('btn-settings').addEventListener('click', () => {
  showScreen('settings');
});

// Waiting
document.getElementById('btn-cancel').addEventListener('click', () => {
  socket.emit('next');
  showScreen('home');
});

// Private room
document.getElementById('btn-back-home').addEventListener('click', () => {
  showScreen('home');
});

document.getElementById('btn-create-private').addEventListener('click', () => {
  socket.emit('createPrivate');
});

document.getElementById('btn-join-private').addEventListener('click', () => {
  const code = document.getElementById('input-room-code').value.trim();
  if (!code) {
    showToast('Please enter a room code');
    return;
  }
  socket.emit('joinPrivate', { roomId: code });
});

// Created room
document.getElementById('btn-copy-link').addEventListener('click', () => {
  const code = document.getElementById('display-room-code').textContent;
  const link = `${window.location.origin}?room=${code}`;
  navigator.clipboard.writeText(link).then(() => {
    showToast('✅ Link copied!');
  }).catch(() => {
    showToast('Code: ' + code);
  });
});

document.getElementById('btn-cancel-private').addEventListener('click', () => {
  leaveRoom();
  showScreen('home');
});

// Chat
document.getElementById('btn-end').addEventListener('click', () => {
  leaveRoom();
  showScreen('home');
});

document.getElementById('btn-next').addEventListener('click', () => {
  if (nextCooldown) {
    showToast('Please wait before pressing Next again');
    return;
  }
  nextCooldown = true;
  setTimeout(() => nextCooldown = false, 3000);

  leaveRoom();
  if (settings.autonext) {
    startRandom();
  } else {
    showScreen('home');
  }
});

document.getElementById('btn-report').addEventListener('click', () => {
  if (confirm('Report this user for inappropriate behavior?')) {
    socket.emit('report');
    showToast('✅ User reported and disconnected');
    leaveRoom();
    showScreen('home');
  }
});

// Send message
function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !currentRoom) return;

  socket.emit('message', { text });
  addMessage(text, 'mine', new Date().toLocaleTimeString());
  input.value = '';

  socket.emit('stopTyping');
  isTyping = false;
}

document.getElementById('btn-send').addEventListener('click', sendMessage);

document.getElementById('msg-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// Typing detection
document.getElementById('msg-input').addEventListener('input', () => {
  if (!currentRoom) return;
  if (!isTyping) {
    isTyping = true;
    socket.emit('typing');
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    isTyping = false;
    socket.emit('stopTyping');
  }, 1500);
});

// Settings toggles
document.getElementById('setting-sound').addEventListener('change', (e) => {
  settings.sound = e.target.checked;
  applySettings();
});
document.getElementById('setting-dark').addEventListener('change', (e) => {
  settings.dark = e.target.checked;
  applySettings();
});
document.getElementById('setting-autonext').addEventListener('change', (e) => {
  settings.autonext = e.target.checked;
  applySettings();
});
document.getElementById('setting-datasaver').addEventListener('change', (e) => {
  settings.datasaver = e.target.checked;
  applySettings();
});
document.getElementById('setting-timer').addEventListener('change', (e) => {
  settings.timer = e.target.checked;
  applySettings();
});

document.getElementById('btn-back-settings').addEventListener('click', () => {
  showScreen('home');
});

// =====================
// SOCKET EVENTS
// =====================

socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('waiting', () => {
  showScreen('waiting');
});

socket.on('matched', ({ roomId }) => {
  currentRoom = roomId;
  clearMessages();
  stopTime
