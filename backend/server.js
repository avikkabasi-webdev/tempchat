const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || '*';

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Security headers
app.use(helmet());
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json({ limit: '10kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests'
});
app.use(limiter);

// In-memory store
const rooms = new Map();
const queue = [];
const ipConnections = new Map();
const ipMessageCount = new Map();
const blockedIPs = new Set();

// Cleanup old rooms every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    if (now - room.createdAt > 10 * 60 * 1000) {
      rooms.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Sanitize input
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .slice(0, 500);
}

// Get IP
function getIP(socket) {
  return socket.handshake.headers['x-forwarded-for'] ||
    socket.handshake.address || 'unknown';
}

io.on('connection', (socket) => {
  const ip = getIP(socket);

  // Block abusive IPs
  if (blockedIPs.has(ip)) {
    socket.disconnect(true);
    return;
  }

  // Track connections per IP
  const connCount = (ipConnections.get(ip) || 0) + 1;
  if (connCount > 10) {
    socket.disconnect(true);
    return;
  }
  ipConnections.set(ip, connCount);

  // Random chat matchmaking
  socket.on('joinRandom', () => {
    if (queue.length > 0) {
      const partner = queue.shift();
      const roomId = uuidv4();
      rooms.set(roomId, {
        users: [socket.id, partner.id],
        createdAt: Date.now()
      });
      socket.join(roomId);
      partner.join(roomId);
      socket.data.roomId = roomId;
      partner.data.roomId = roomId;
      io.to(roomId).emit('matched', { roomId });
    } else {
      queue.push(socket);
      socket.emit('waiting');
    }
  });

  // Private room creation
  socket.on('createPrivate', () => {
    const roomId = uuidv4();
    rooms.set(roomId, {
      users: [socket.id],
      createdAt: Date.now(),
      private: true
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.emit('privateCreated', { roomId });
  });

  // Join private room
  socket.on('joinPrivate', ({ roomId }) => {
    const clean = sanitize(roomId);
    const room = rooms.get(clean);
    if (!room) {
      socket.emit('error', { message: 'Room not found or expired' });
      return;
    }
    if (room.users.length >= 2) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }
    room.users.push(socket.id);
    socket.join(clean);
    socket.data.roomId = clean;
    io.to(clean).emit('matched', { roomId: clean });
  });

  // Message handling
  socket.on('message', ({ text }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    // Rate limit messages
    const msgKey = socket.id;
    const now = Date.now();
    const msgs = ipMessageCount.get(msgKey) || [];
    const recent = msgs.filter(t => now - t < 1000);
    if (recent.length >= 5) {
      socket.emit('error', { message: 'Sending too fast' });
      return;
    }
    recent.push(now);
    ipMessageCount.set(msgKey, recent);

    const clean = sanitize(text);
    if (!clean) return;

    socket.to(roomId).emit('message', {
      text: clean,
      time: new Date().toLocaleTimeString()
    });
  });

  // Typing indicator
  socket.on('typing', () => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('typing');
  });

  socket.on('stopTyping', () => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('stopTyping');
  });

  // Next / leave
  socket.on('next', () => {
    leaveRoom(socket);
    const idx = queue.indexOf(socket);
    if (idx > -1) queue.splice(idx, 1);
  });

  // Report user
  socket.on('report', () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const partnerId = room.users.find(id => id !== socket.id);
        if (partnerId) {
          const partnerSocket = io.sockets.sockets.get(partnerId);
          if (partnerSocket) {
            const partnerIP = getIP(partnerSocket);
            blockedIPs.add(partnerIP);
            setTimeout(() => blockedIPs.delete(partnerIP), 30 * 60 * 1000);
            partnerSocket.disconnect(true);
          }
        }
      }
      leaveRoom(socket);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const count = (ipConnections.get(ip) || 1) - 1;
    if (count <= 0) ipConnections.delete(ip);
    else ipConnections.set(ip, count);

    const idx = queue.indexOf(socket);
    if (idx > -1) queue.splice(idx, 1);

    leaveRoom(socket);
  });

  function leaveRoom(socket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('partnerLeft');
    socket.leave(roomId);
    socket.data.roomId = null;
    rooms.delete(roomId);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', users: io.engine.clientsCount });
});

app.get('/', (req, res) => {
  res.json({ message: 'TempChat backend running' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
