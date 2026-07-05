const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for dev
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Endpoint to receive login notifications from Next.js server actions
app.post('/api/notify-admin', (req, res) => {
  const { email, type, message } = req.body;
  console.log(`Notification received: [${type}] ${email} - ${message}`);
  
  // Broadcast to all connected clients (Admin Dashboard)
  io.emit('admin_notification', {
    email,
    type,
    message,
    timestamp: new Date().toISOString()
  });
  
  res.json({ success: true });
});

// Endpoint for admin actions to notify specific users
app.post('/api/admin-action', (req, res) => {
  try {
    const { userId, newStatus, authCode, email } = req.body;

    // Broadcast a user update event with relevant data
    io.emit('user_update', {
      userId,
      newStatus,
      authCode,
      email,
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('admin-action error:', error);
    res.status(500).json({ success: false, error: 'Failed to process admin action' });
  }
});

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3001;

let attempts = 0;
let currentPort = DEFAULT_PORT;

function startServer(port) {
  server.listen(port, () => {
    console.log(`Socket & API Server running on port ${port}`);
  });
}

// Attach a single error listener to handle EADDRINUSE and retry a few times.
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE' && attempts < 5) {
    console.warn(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
    attempts += 1;
    currentPort += 1;
    setTimeout(() => startServer(currentPort), 500);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});

startServer(currentPort);
