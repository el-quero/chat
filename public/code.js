(function () {
  const app = document.querySelector(".app");
  const socket = io();

  let uname = "";
  let userRole = "";
  let onlineUsers = new Set();
  let lastDateShown = null;
  let isFirstChatLoad = true;
  let resultMessage = "";
  let pendingUpdate = null;

  // ==== Fungsi Format Tanggal & Jam ====
  function formatDateLabel(date) {
    const now = new Date();
    const msgDate = new Date(date);
    const isToday = now.toDateString() === msgDate.toDateString();

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = yesterday.toDateString() === msgDate.toDateString();

    if (isToday) return "Hari Ini";
    if (isYesterday) return "Kemarin";

    return msgDate.toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function formatTimeOnly(date) {
    const d = new Date(date);
    return d.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // ==== Online Status ====
  socket.on("online-status-update", (onlineList) => {
    onlineUsers = new Set(onlineList);
    if (!app.querySelector(".members-popup").classList.contains("hidden")) {
      loadMembers();
    }
  });

  // ==== Toggle Menu ====
  const menuToggle = app.querySelector("#menu-toggle");
  const dropdownMenu = app.querySelector(".dropdown-menu");

  menuToggle.addEventListener("click", () => {
    dropdownMenu.classList.toggle("show");
  });

  app.querySelector("#show-members").addEventListener("click", () => {
    loadMembers();
    dropdownMenu.classList.remove("show");
  });

  app.querySelector("#clear-chat").addEventListener("click", async () => {
    dropdownMenu.classList.remove("show");
    if (!uname) return alert("Anda perlu login untuk menghapus chat.");
    if (!confirm("Apakah Anda yakin ingin menghapus semua chat?")) return;

    try {
      const res = await fetch("/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminName: uname }),
      });
      const result = await res.json();
      if (res.ok) {
        alert(result.message);
        app.querySelector(".messages").innerHTML = "";
        lastDateShown = null;
      } else {
        alert(result.message || "Gagal menghapus chat.");
      }
    } catch (err) {
      alert("Kesalahan saat menghapus chat.");
      console.error(err);
    }
  });

  app.querySelector("#exit-chat").addEventListener("click", () => {
    dropdownMenu.classList.remove("show");
    socket.emit("exituser", uname);
    window.location.reload();
  });

  // ==== Login ====
  app.querySelector("#join-user").addEventListener("click", async function () {
    const username = app.querySelector("#username").value.trim();
    const password = app.querySelector("#password").value.trim();
    const loginStatus = app.querySelector("#login-status");

    if (!username || !password) {
      loginStatus.innerText = "Nama dan password wajib diisi.";
      return;
    }

    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: username, password }),
      });

      const result = await res.json();

      if (res.ok) {
        uname = username;
        userRole = result.role || "member";
        resultMessage = result.message;
        isFirstChatLoad = true;

        if (result.isNewUser) {
          socket.emit("newuser", uname);
        } else {
          socket.emit("userlogin", uname);
        }

        app.querySelector(".join-screen").classList.remove("active");
        app.querySelector(".chat-screen").classList.add("active");

        loginStatus.innerText = "";
      } else {
        loginStatus.innerText = result.message || "Gagal masuk.";
      }
    } catch (err) {
      loginStatus.innerText = "Gagal terhubung ke server.";
      console.error(err);
    }
  });

  // ==== Kirim Pesan ====
  // Kirim pesan saat tombol diklik
  app.querySelector("#send-message").addEventListener("click", sendMessage);

  // Kirim pesan saat tekan Enter (kecuali Shift + Enter)
  app.querySelector("#message-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); // Mencegah baris baru saat Enter biasa
      sendMessage();
    }
  });

  // Fungsi pengiriman pesan
  function sendMessage() {
    const messageInput = app.querySelector("#message-input");
    const message = messageInput.value.trim();
    if (message.length === 0) return;

    const msgObj = {
      username: uname,
      text: message,
      timestamp: Date.now(),
    };

    renderMessage("my", msgObj);
    socket.emit("chat", msgObj);
    messageInput.value = "";
  }

  // Menangkap pesan dari socket
  socket.on("chat", function (message) {
    const type = message.isSelf ? "my" : "other";
    renderMessage(type, message);

    // Setelah pesan lama (pertama kali) selesai, tambahkan welcome
    if (isFirstChatLoad) {
      clearTimeout(window.chatLoadTimer);
      window.chatLoadTimer = setTimeout(() => {
        const container = app.querySelector(".messages");

        // Tampilkan pesan selamat datang
        const welcome = document.createElement("div");
        welcome.className = "update";
        welcome.innerText = resultMessage;
        container.appendChild(welcome);

        // Tampilkan update jika ada
        if (pendingUpdate) {
          const update = document.createElement("div");
          update.className = "update";
          update.innerText = pendingUpdate;
          container.appendChild(update);
          pendingUpdate = null;
        }

        container.scrollTop = container.scrollHeight;
        isFirstChatLoad = false;
      }, 200); // Tunggu 200ms setelah pesan terakhir (adjustable)
    }
  });

  socket.on("update", function (update) {
    if (isFirstChatLoad) {
      pendingUpdate = update;
    } else {
      renderMessage("update", update);
    }
  });

  // ==== Render Pesan ====
  function renderMessage(type, message) {
    const container = app.querySelector(".messages");
    const el = document.createElement("div");
    const timestamp = message.timestamp || Date.now();
    const msgDate = new Date(timestamp).toDateString();

    if (msgDate !== lastDateShown) {
      const label = document.createElement("div");
      label.className = "date-label";
      label.innerText = formatDateLabel(timestamp);
      container.appendChild(label);
      lastDateShown = msgDate;
    }

    if (type === "my") {
      el.className = "message my-message";
      el.innerHTML = `
        <div>
          <div class="name">Kamu</div>
          <div class="text">${sanitizeHTML(message.text)}</div>
          <div class="time">${formatTimeOnly(timestamp)}</div>
        </div>`;
    } else if (type === "other") {
      el.className = "message other-message";
      el.innerHTML = `
        <div>
          <div class="name">${sanitizeHTML(message.username)}</div>
          <div class="text">${sanitizeHTML(message.text)}</div>
          <div class="time">${formatTimeOnly(timestamp)}</div>
        </div>`;
    } else if (type === "update") {
      el.className = "update";
      el.innerText = message;
    }

    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  function sanitizeHTML(str) {
    return str.replace(/[&<>"']/g, function (m) {
      return (
        {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m] || m
      );
    });
  }

  const showMembersBtn = app.querySelector("#show-members");
  const membersPopup = app.querySelector(".members-popup");
  const membersList = app.querySelector("#members-list");
  const closeMembersBtn = app.querySelector("#close-members");

  showMembersBtn.addEventListener("click", loadMembers);
  closeMembersBtn.addEventListener("click", () => {
    membersPopup.classList.add("hidden");
    removeExistingMenus();
  });

  async function loadMembers() {
    try {
      const res = await fetch("/members");
      const data = await res.json();

      membersList.innerHTML = "";

      data.members.forEach((member) => {
        const li = document.createElement("li");
        li.classList.add("member-item");

        // Format nama dan role
        const nameSpan = document.createElement("span");
        nameSpan.textContent = member.name;
        nameSpan.classList.add("member-name");

        // Buat indicator status online/offline
        const statusSpan = document.createElement("span");
        statusSpan.classList.add("member-status");
        statusSpan.title = onlineUsers.has(member.name) ? "Online" : "Offline";
        statusSpan.style.marginLeft = "6px";
        statusSpan.style.width = "10px";
        statusSpan.style.height = "10px";
        statusSpan.style.borderRadius = "50%";
        statusSpan.style.display = "inline-block";
        statusSpan.style.backgroundColor = onlineUsers.has(member.name)
          ? "limegreen"
          : "gray";

        // Gabungkan nama dan status indicator di container span
        const nameContainer = document.createElement("span");
        nameContainer.style.display = "flex";
        nameContainer.style.alignItems = "center";

        nameContainer.appendChild(nameSpan);
        nameContainer.appendChild(statusSpan);

        const roleSpan = document.createElement("span");
        roleSpan.textContent = member.role;
        roleSpan.classList.add("member-role");

        li.appendChild(nameContainer);
        li.appendChild(roleSpan);

        // Jika member atau co-admin, tambahkan tombol titik tiga
        if (member.role === "member" || member.role === "co-admin") {
          const menuBtn = document.createElement("button");
          menuBtn.className = "menu-button";
          menuBtn.setAttribute("aria-label", "Menu member options");
          menuBtn.textContent = "⋮";
          menuBtn.title = "Options";
          menuBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            showMemberMenu(member, li, menuBtn);
          });
          li.appendChild(menuBtn);
        }

        membersList.appendChild(li);
      });

      membersPopup.classList.remove("hidden");
    } catch (err) {
      alert("Gagal mengambil daftar anggota.");
      console.error(err);
    }
  }

  // Tampilkan menu opsi titik tiga sesuai role
  function showMemberMenu(member, listItem, button) {
    removeExistingMenus();

    const menu = document.createElement("div");
    menu.className = "member-menu";

    const canDelete = userRole === "admin" || userRole === "co-admin";
    const canChangeRole = userRole === "admin";

    if (canDelete) {
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Hapus Member";
      deleteBtn.className = "menu-item delete-option";
      deleteBtn.addEventListener("click", async () => {
        if (confirm(`Anda yakin ingin menghapus anggota: ${member.name} ?`)) {
          try {
            const res = await fetch("/delete-member", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                adminName: uname,
                targetName: member.name,
              }),
            });
            const result = await res.json();
            if (res.ok) {
              alert(result.message);
              loadMembers();
            } else {
              alert(result.message || "Gagal menghapus anggota.");
            }
          } catch (err) {
            alert("Kesalahan saat menghapus anggota.");
            console.error(err);
          }
        }
        removeExistingMenus();
      });
      menu.appendChild(deleteBtn);
    }

    if (canChangeRole) {
      const changeRoleBtn = document.createElement("button");
      if (member.role === "member") {
        changeRoleBtn.textContent = "Jadikan Co-admin";
        changeRoleBtn.className = "menu-item change-role-option";
        changeRoleBtn.addEventListener("click", async () => {
          try {
            const res = await fetch("/change-role", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                adminName: uname,
                targetName: member.name,
                newRole: "co-admin",
              }),
            });
            const result = await res.json();
            if (res.ok) {
              alert(result.message);
              loadMembers();
            } else {
              alert(result.message || "Gagal mengubah role.");
            }
          } catch (err) {
            alert("Kesalahan saat mengubah role.");
            console.error(err);
          }
          removeExistingMenus();
        });
      } else if (member.role === "co-admin") {
        changeRoleBtn.textContent = "Jadikan Member";
        changeRoleBtn.className = "menu-item change-role-option";
        changeRoleBtn.addEventListener("click", async () => {
          try {
            const res = await fetch("/change-role", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                adminName: uname,
                targetName: member.name,
                newRole: "member",
              }),
            });
            const result = await res.json();
            if (res.ok) {
              alert(result.message);
              loadMembers();
            } else {
              alert(result.message || "Gagal mengubah role.");
            }
          } catch (err) {
            alert("Kesalahan saat mengubah role.");
            console.error(err);
          }
          removeExistingMenus();
        });
      }
      menu.appendChild(changeRoleBtn);
    }

    listItem.appendChild(menu);

    function closeOnClickOutside(event) {
      if (!menu.contains(event.target) && event.target !== button) {
        removeExistingMenus();
        document.removeEventListener("click", closeOnClickOutside);
      }
    }
    document.addEventListener("click", closeOnClickOutside);
  }

  function removeExistingMenus() {
    document.querySelectorAll(".member-menu").forEach((menu) => {
      menu.remove();
    });
  }
})();
