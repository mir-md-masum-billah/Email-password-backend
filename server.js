const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// CORS configuration - single source of truth
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? [
      "https://your-frontend.vercel.app",
      "https://your-production-domain.com"
    ]
    : ["http://localhost:3000", "http://localhost:3001", "*"],
  methods: ["GET", "POST"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

const server = http.createServer(app);

// Socket.IO configuration
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  path: '/socket.io/',
  pingTimeout: 60000,
  pingInterval: 25000,
  // Add connection state recovery
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  }
});

console.log('🚀 Socket.IO server initializing...');

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  console.log('📊 Total connections:', io.engine.clientsCount);

  // Join user to a room based on their role or ID
  socket.on('join_room', (room) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room: ${room}`);
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ User disconnected:', socket.id, 'Reason:', reason);
    console.log('📊 Total connections:', io.engine.clientsCount);
  });

  socket.on('error', (error) => {
    console.error('Socket error for', socket.id, ':', error);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: io.engine.clientsCount,
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({
    message: 'Server is running!',
    socketPath: '/socket.io/',
    clients: io.engine.clientsCount,
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Notify admin endpoint with validation
app.post('/api/notify-admin', (req, res) => {
  try {
    const { email, type, message } = req.body;

    // Validation
    if (!email || !type || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: email, type, message'
      });
    }

    console.log(`📧 Notification: [${type}] ${email}`);
    console.log(`📝 Message: ${message}`);

    // Broadcast to all connected clients
    io.emit('admin_notification', {
      email,
      type,
      message,
      timestamp: new Date().toISOString()
    });

    // Also emit to admin room if you have one
    io.to('admin_room').emit('admin_notification', {
      email,
      type,
      message,
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Broadcasted to ${io.engine.clientsCount} clients`);
    res.json({
      success: true,
      clients: io.engine.clientsCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in notify-admin:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Admin action endpoint with validation
app.post('/api/admin-action', (req, res) => {
  try {
    const { userId, newStatus, authCode, email } = req.body;

    // Validation
    if (!userId || !newStatus) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, newStatus'
      });
    }

    console.log(`🔔 Admin action: ${newStatus} for user ${userId} (${email || 'unknown email'})`);

    // Emit to specific user room if userId is provided
    if (userId) {
      io.to(`user_${userId}`).emit('user_update', {
        userId,
        newStatus,
        authCode: authCode || "",
        email: email || "",
        timestamp: new Date().toISOString(),
      });
    }

    // Broadcast to all clients
    io.emit('user_update', {
      userId,
      newStatus,
      authCode: authCode || "",
      email: email || "",
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      clients: io.engine.clientsCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in admin-action:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    clients: io.engine.clientsCount,
    rooms: Object.keys(io.sockets.adapter.rooms).length,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime())
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Socket.IO path: /socket.io/`);
  console.log(`🌐 CORS origins: ${JSON.stringify(corsOptions.origin)}`);
});

// Graceful shutdown
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