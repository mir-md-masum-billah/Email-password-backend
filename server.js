const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// CORS - সব অরিজিনের জন্য Allow (এখনই কাজ করার জন্য)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true,
}));

app.use(express.json());

const server = http.createServer(app);

// Socket.IO - CORS সহজভাবে কনফিগার করা
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  path: '/socket.io/',
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

console.log('🚀 Socket.IO server initializing...');

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  console.log('📊 Total connections:', io.engine.clientsCount);

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    console.log('📊 Total connections:', io.engine.clientsCount);
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: io.engine.clientsCount,
    uptime: process.uptime()
  });
});

// Test endpoint - দেখার জন্য যে সার্ভার কাজ করছে
app.get('/test', (req, res) => {
  res.json({
    message: 'Server is running!',
    socketPath: '/socket.io/',
    clients: io.engine.clientsCount,
    env: process.env.NODE_ENV
  });
  confirm.log('✅ Test endpoint hit:', new Date().toISOString());
});

// Notify admin
app.post('/api/notify-admin', (req, res) => {
  try {
    const { email, type, message } = req.body;
    console.log(`📧 Notification: [${type}] ${email}`);

    io.emit('admin_notification', {
      email,
      type,
      message,
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Broadcasted to ${io.engine.clientsCount} clients`);
    res.json({ success: true, clients: io.engine.clientsCount });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin action
app.post('/api/admin-action', (req, res) => {
  try {
    const { userId, newStatus, authCode, email } = req.body;
    console.log(`🔔 Admin action: ${newStatus} for ${email}`);

    io.emit('user_update', {
      userId,
      newStatus,
      authCode: authCode || "",
      email: email || "",
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, clients: io.engine.clientsCount });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Status
app.get('/api/status', (req, res) => {
  res.json({
    clients: io.engine.clientsCount,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Socket.IO path: /socket.io/`);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
});