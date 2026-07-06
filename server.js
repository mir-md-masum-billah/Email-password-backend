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
});

io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  socket.emit("connected", {
    id: socket.id,
  });

  socket.on("login-attempt", (data) => {
    io.emit("admin_notification", data);
  });

  socket.on("update-login-status", (data) => {
    io.emit("user_update", data);
  });

  socket.on("disconnect", (reason) => {
    console.log("❌ Disconnected:", reason);
  });
});

app.get("/", (req, res) => {
  res.send("Socket.IO Server Running");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    clients: io.engine.clientsCount,
  });
});

const PORT = process.env.PORT || 8000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on ${PORT}`);
});