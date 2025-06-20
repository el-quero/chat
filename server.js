const express = require("express");
const path = require("path");
const http = require("http");

const socketIo = require("socket.io");
const bcrypt = require("bcrypt");
const onlineUsers = new Set();
const userSockets = new Map();

const SALT_ROUNDS = 10;
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 🔌 Koneksi ke MySQL
const mysql = require("mysql2");
const db = mysql.createConnection(process.env.DATABASE_URL);


db.connect((err) => {
  if (err) {
    console.error("DB error:", err);
  } else {
    console.log("Connected to MySQL database");
  }
});

// 🛠️ Buat tabel jika belum ada
db.query(`
  CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100),
    text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) UNIQUE,
    password TEXT,
    role VARCHAR(20) DEFAULT 'member'
)`);

// 🔐 LOGIN / REGISTER
app.post("/login", (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ message: "Nama dan password wajib diisi" });
  }

  db.query(
    "SELECT * FROM users WHERE name = ?",
    [name],
    async (err, results) => {
      if (err) return res.status(500).json({ message: "Kesalahan server" });

      const row = results[0];
      if (!row) {
        db.query(
          "SELECT COUNT(*) AS count FROM users",
          async (err2, countResults) => {
            if (err2)
              return res.status(500).json({ message: "Kesalahan server" });

            const count = countResults[0].count;
            const role = count === 0 ? "admin" : "member";
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

            db.query(
              "INSERT INTO users (name, password, role) VALUES (?, ?, ?)",
              [name, hashedPassword, role],
              (err3) => {
                if (err3)
                  return res
                    .status(500)
                    .json({ message: "Gagal membuat akun" });
                return res.json({
                  message: `Berhasil masuk dan akun dibuat dengan role ${role}`,
                  role,
                  isNewUser: true,
                });
              }
            );
          }
        );
      } else {
        const match = await bcrypt.compare(password, row.password);
        if (match) {
          return res.json({
            message: `Berhasil masuk, halo ${row.name}`,
            role: row.role,
            isNewUser: false,
          });
        } else {
          return res.status(401).json({
            message: "Nama atau password salah / nama pernah digunakan",
          });
        }
      }
    }
  );
});

//old pesan
function sendOldMessages(socket, currentName) {
  db.query(
    "SELECT name, text, timestamp FROM messages ORDER BY id ASC",
    (err, rows) => {
      if (!err && rows) {
        rows.forEach((row) => {
          socket.emit("chat", {
            username: row.name === currentName ? "Kamu" : row.name,
            text: row.text,
            timestamp: new Date(row.timestamp).getTime(),
            isSelf: row.name === currentName,
          });
        });
      } else {
        console.error("Gagal mengambil pesan:", err);
      }
    }
  );
}

// 🔧 Hapus semua chat (admin only)
app.post("/clear", (req, res) => {
  const { adminName } = req.body;
  if (!adminName)
    return res.status(400).json({ message: "adminName wajib disertakan" });

  db.query(
    "SELECT role FROM users WHERE name = ?",
    [adminName],
    (err, results) => {
      if (err) return res.status(500).json({ message: "Kesalahan server" });

      const role = results[0]?.role;
      if (role !== "admin") {
        return res
          .status(403)
          .json({ message: "Hanya admin yang dapat menghapus chat" });
      }

      db.query("DELETE FROM messages", (err) => {
        if (err)
          return res.status(500).json({ message: "Gagal menghapus pesan." });
        res.json({ message: "Semua pesan berhasil dihapus." });
      });
    }
  );
});

// 📥 Ambil daftar anggota
app.get("/members", (req, res) => {
  db.query(
    "SELECT name, role FROM users ORDER BY role DESC, name ASC",
    (err, results) => {
      if (err)
        return res
          .status(500)
          .json({ message: "Gagal mengambil data anggota." });
      const members = results.map((row) => ({
        name: row.name,
        role: row.role,
      }));
      res.json({ members });
    }
  );
});

// 🔌 Socket.IO
io.on("connection", (socket) => {

  socket.on("newuser", (name) => {
    socket.username = name;
    sendOldMessages(socket, name);
    onlineUsers.add(name);
    userSockets.set(socket.id, name);
    io.emit("update", name + " join the club");
    io.emit("online-status-update", Array.from(onlineUsers));
  });

  socket.on("userlogin", (name) => {
    socket.username = name;
    sendOldMessages(socket, name);
    onlineUsers.add(name);
    userSockets.set(socket.id, name);
    io.emit("online-status-update", Array.from(onlineUsers));
  });

  socket.on("exituser", (username) => {
    if (socket.hasExited) return;
    socket.hasExited = true;
    onlineUsers.delete(username);
    io.emit("online-status-update", Array.from(onlineUsers));
  });

  socket.on("disconnect", () => {
    if (!socket.hasExited && socket.username) {
      onlineUsers.delete(socket.username);
      io.emit("online-status-update", Array.from(onlineUsers));
    }
  });

  socket.on("chat", (message) => {
    const username = message.username || "Anon";
    const text = message.text || "";
    const timestamp = Date.now();
    db.query("INSERT INTO messages (name, text, timestamp) VALUES (?, ?, ?)", [
      username,
      text,
      new Date(timestamp),
    ]);
    socket.broadcast.emit("chat", { username, text, timestamp });
  });
});

// Ubah role anggota (admin only)
app.post("/change-role", (req, res) => {
  const { adminName, targetName, newRole } = req.body;

  if (!adminName || !targetName || !newRole) {
    return res.status(400).json({ message: "Data tidak lengkap." });
  }

  db.query(
    "SELECT role FROM users WHERE name = ?",
    [adminName],
    (err, results) => {
      if (err) return res.status(500).json({ message: "Kesalahan server." });

      const role = results[0]?.role;
      if (role !== "admin") {
        return res
          .status(403)
          .json({ message: "Hanya admin yang dapat mengubah role." });
      }

      if (targetName === adminName) {
        return res
          .status(400)
          .json({ message: "Admin tidak bisa mengubah rolenya sendiri." });
      }

      db.query(
        "UPDATE users SET role = ? WHERE name = ?",
        [newRole, targetName],
        (err2) => {
          if (err2)
            return res.status(500).json({ message: "Gagal mengubah role." });
          io.emit("update", `${targetName} jadi ${newRole}`);
          res.json({ message: "Role berhasil diubah." });
        }
      );
    }
  );
});

// Hapus anggota (admin dan co-admin)
app.post("/delete-member", (req, res) => {
  const { adminName, targetName } = req.body;

  if (!adminName || !targetName) {
    return res.status(400).json({ message: "Data tidak lengkap." });
  }

  db.query(
    "SELECT role FROM users WHERE name = ?",
    [adminName],
    (err, results) => {
      if (err) return res.status(500).json({ message: "Kesalahan server." });

      const role = results[0]?.role;
      if (!["admin", "co-admin"].includes(role)) {
        return res.status(403).json({
          message: "Hanya admin/co-admin yang dapat menghapus anggota.",
        });
      }

      if (targetName === adminName) {
        return res
          .status(400)
          .json({ message: "Anda tidak bisa menghapus diri sendiri." });
      }

      db.query(
        "SELECT role FROM users WHERE name = ?",
        [targetName],
        (err2, results2) => {
          if (err2)
            return res.status(500).json({ message: "Kesalahan server." });

          const targetRole = results2[0]?.role;
          if (!targetRole)
            return res
              .status(404)
              .json({ message: "Anggota tidak ditemukan." });
          if (targetRole === "admin")
            return res
              .status(403)
              .json({ message: "Admin tidak bisa dihapus." });

          db.query("DELETE FROM users WHERE name = ?", [targetName], (err3) => {
            if (err3)
              return res
                .status(500)
                .json({ message: "Gagal menghapus anggota." });
            io.emit("update", `${targetName} deleted from the club`);
            res.json({ message: "Anggota berhasil dihapus." });
          });
        }
      );
    }
  );
});

app.get("/", (req, res) => {
  res.send("Chatroom aktif! 🚀");
});

// 🟢 Jalankan server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
