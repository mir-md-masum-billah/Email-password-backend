const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// CORS - Production ready
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://your-frontend-domain.vercel.app', 'https://your-frontend-domain.com'] // আপনার ডোমেইন দিন
  : ['http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST"],
  credentials: true,
}));

app.use(express.json());

const server = http.createServer(app);

// Socket.IO with production config
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  path: '/socket.io/',
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Connection tracking
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  console.log('📊 Total connections:', io.engine.clientsCount);

  // Track user
  connectedUsers.set(socket.id, { connectedAt: new Date() });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    connectedUsers.delete(socket.id);
    console.log('📊 Total connections:', io.engine.clientsCount);
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: io.engine.clientsCount,
    uptime: process.uptime()
  });
});

// Endpoint to receive login notifications from Next.js server actions
app.post('/api/notify-admin', (req, res) => {
  try {
    const { email, type, message } = req.body;
    console.log(`📧 Notification received: [${type}] ${email} - ${message}`);

    // Broadcast to all connected clients
    const data = {
      email,
      type,
      message,
      timestamp: new Date().toISOString()
    };

    io.emit('admin_notification', data);
    console.log(`✅ Notification broadcasted to ${io.engine.clientsCount} clients`);

    res.json({ success: true, clients: io.engine.clientsCount });
  } catch (error) {
    console.error('Notify admin error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint for admin actions to notify specific users
app.post('/api/admin-action', (req, res) => {
  try {
    const { userId, newStatus, authCode, email } = req.body;

    console.log(`🔔 Admin action: ${newStatus} for ${email || userId}`);

    const data = {
      userId,
      newStatus,
      authCode: authCode || "",
      email: email || "",
      timestamp: new Date().toISOString(),
    };

    // Broadcast to all connected clients
    io.emit('user_update', data);
    console.log(`✅ User update broadcasted to ${io.engine.clientsCount} clients`);

    res.json({ success: true, clients: io.engine.clientsCount });
  } catch (error) {
    console.error('Admin action error:', error);
    res.status(500).json({ success: false, error: 'Failed to process admin action' });
  }
});

// Get connection status
app.get('/api/status', (req, res) => {
  res.json({
    clients: io.engine.clientsCount,
    connectedUsers: Array.from(connectedUsers.keys()),
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3001;

// Railway specific - listen on all interfaces
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Socket.IO path: /socket.io/`);
});

// Error handling
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', error);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, closing server...');
  io.close(() => {
    server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  });
});