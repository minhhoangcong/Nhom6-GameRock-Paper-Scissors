let ws;
let playerId;
let playerName = "";
let currentRoom = null;
let gameHistory = [];
let isWaitingForOpponent = false;
let currentChoice = null;
let isReady = false;
let isBotMode = false;
let botSeriesBestOf = 3; // Bo3
let botSeriesWins = { me: 0, bot: 0 };
let botSeriesOver = false;
let countdownInterval = null;
let timeLeft = 10;
let hasChosenThisRound = false;
let latestRooms = [];
let pingTimer = null;
let lastPingTs = 0;
let bgmEnabled = false; // nhạc nền mặc định tắt khi vào game
let sfxEnabled = true; // cho phép hiệu ứng (click, win/lose/draw)
let lastPvpSeries = null; // nhớ series PvP mới nhất để render lại khi cần

// Khởi tạo kết nối WebSocket
function initWebSocket() {
  ws = new WebSocket("ws://localhost:8082");

  ws.onopen = () => {
    console.log("Đã kết nối với server");
    showNotification("Đã kết nối với server", "success");
    refreshRooms();
    startPing();
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleServerMessage(data);
  };

  ws.onclose = () => {
    console.log("Mất kết nối với server");
    showNotification(
      "Mất kết nối với server. Đang thử kết nối lại...",
      "error"
    );
    stopPing();
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = (error) => {
    console.error("Lỗi WebSocket:", error);
    showNotification("Lỗi kết nối", "error");
  };
}

// Xử lý tin nhắn từ server
function handleServerMessage(data) {
  switch (data.type) {
    case "player_id":
      playerId = data.player_id;
      document.getElementById(
        "player-id"
      ).textContent = `Người chơi ${playerId}`;
      break;

    case "rooms_list":
      latestRooms = Array.isArray(data.rooms) ? data.rooms : [];
      updateRoomsList(latestRooms);
      break;

    case "room_created":
      currentRoom = data.room;
      showGameRoom();
      showReadyButton(); // Hiển thị nút sẵn sàng khi tạo phòng
      showNotification("Đã tạo phòng thành công!", "success");
      break;

    case "player_joined":
      console.log("Nhận thông báo player_joined:", data);
      currentRoom = data.room;
      updateRoomInfo(data.room);
      showGameRoom(); // Đảm bảo chuyển sang màn hình phòng
      showReadyButton(); // Hiển thị nút sẵn sàng khi có người tham gia
      showNotification(`${data.player_name} đã tham gia phòng`, "info");
      break;

    case "player_left":
      currentRoom = data.room;
      updateRoomInfo(data.room);
      showNotification(`${data.player_name} đã rời phòng`, "info");
      break;

    case "player_ready":
      currentRoom = data.room;
      updateRoomInfo(data.room);
      showNotification(`${data.player_name} đã sẵn sàng`, "info");
      break;

    case "game_start": {
      const { room, series } = data;
      currentRoom = room;
      updateRoomInfo(room);
      clearChoiceSelection();
      hideNewGameButton();
      hideReadyButton(); // vào ván thì ẩn Ready
      enableChoices();
      isWaitingForOpponent = false;
      updateGameStatus("Trò chơi bắt đầu! Hãy chọn kéo/búa/bao.");

      try {
        stopBGM && stopBGM();
      } catch {}

      // 🕒 Đếm ngược 10s
      startCountdownTimer(10);

      // 🔥 Bo3 PvP: nếu server gửi series thì lưu + hiển thị
      if (!isBotMode && series) {
        lastPvpSeries = series;
        updateSeriesUIPvp(series);
      } else if (!isBotMode && lastPvpSeries) {
        // phòng hờ: nếu vì lý do gì game_start chưa kèm series,
        // ta vẫn hiển thị lại series gần nhất để không "mất" dòng Bo3
        updateSeriesUIPvp(lastPvpSeries);
      }

      showNotification("Trò chơi bắt đầu!", "success");
      break;
    }

    case "player_chose":
      updateGameStatus(`${data.player_name} đã chọn lựa`);
      break;

    case "game_result": {
      // Dừng đồng hồ + hiển thị kết quả, điểm... (hàm cũ của bạn)
      handleGameResult(data);

      // 🔥 Cập nhật Bo3 PvP chắc chắn theo payload từ server
      if (!isBotMode && data.series) {
        lastPvpSeries = data.series;
        updateSeriesUIPvp(data.series);
        const btn = document.getElementById("new-game-btn");
        if (btn) {
          btn.textContent = data.series.over
            ? "🔄 Bắt đầu series mới"
            : "🔄 Chơi lại (vòng kế)";
        }
      }
      break;
    }

    case "player_ready_for_new_game":
      currentRoom = data.room;
      updateRoomInfo(data.room);
      showNotification(`${data.player_name} đã sẵn sàng chơi lại`, "info");
      break;

    case "room_updated":
      currentRoom = data.room;
      updateRoomInfo(data.room);
      break;

    case "error":
      showNotification(`Lỗi: ${data.message}`, "error");
      // Nếu lỗi khi tham gia phòng, làm mới danh sách phòng
      if (
        data.message.includes("Phòng") ||
        data.message.includes("đã ở trong phòng") ||
        data.message.includes("đã đầy")
      ) {
        refreshRooms();
      }
      break;
    case "chat":
      addChatMessage(data.player_name, data.message);
      break;
    case "pong":
      const rtt = Date.now() - (data.t || Date.now());
      updatePingUI(rtt);
      break;
  }
}

// Cập nhật danh sách phòng
function updateRoomsList(rooms) {
  const roomsList = document.getElementById("rooms-list");

  if (rooms.length === 0) {
    roomsList.innerHTML =
      '<div class="loading">Không có phòng nào. Hãy tạo phòng mới!</div>';
    return;
  }

  roomsList.innerHTML = rooms
    .map((room) => {
      const isFull = room.current_players >= 2;
      const canJoin = !isFull && room.current_players < 2;
      const lockIcon = room.has_password ? "🔒" : "🔓";

      return `
    <div class="room-card ${isFull ? "full" : ""}"
         onclick="${
           isFull
             ? ""
             : `joinRoomWithPassword('${room.room_id}', ${room.has_password})`
         }">
      <div class="room-header">
        <div class="room-name">${lockIcon} ${room.room_name}</div>
        <div class="room-status">${getGameStateText(room.game_state)}</div>
      </div>
      <div class="room-players">
        <span>👥 ${room.current_players}/2 người chơi</span>
        ${
          canJoin
            ? `<button class="join-btn"
                onclick="event.stopPropagation(); joinRoomWithPassword('${
                  room.room_id
                }', ${room.has_password})">
                ${room.has_password ? "Tham gia (🔒)" : "Tham gia"}
               </button>`
            : '<span style="color:#dc3545;">Đã đầy</span>'
        }
      </div>
      <div class="room-players">
        <span>Người chơi: ${room.players.map((p) => p.name).join(", ")}</span>
      </div>
    </div>
  `;
    })
    .join("");
}

// Lấy text trạng thái game
function getGameStateText(state) {
  switch (state) {
    case "waiting":
      return "⏳ Chờ người chơi";
    case "playing":
      return "🎮 Đang chơi";
    case "finished":
      return "🏁 Kết thúc";
    default:
      return "❓ Không xác định";
  }
}

// Tạo phòng mới
function createRoom() {
  const roomName =
    document.getElementById("room-name").value.trim() || `Phòng ${Date.now()}`;
  const usePw = document.getElementById("use-password")?.checked;
  const password = usePw
    ? (document.getElementById("room-password").value || "").trim()
    : "";

  ws.send(
    JSON.stringify({
      type: "create_room",
      room_name: roomName,
      max_players: 2,
      password: password || undefined, // gửi undefined nếu để trống
    })
  );
}
//Đặt mk phòng
function joinRoomWithPassword(roomId, hasPassword) {
  if (!hasPassword) {
    joinRoom(roomId);
    return;
  }
  const pwd = prompt("Phòng này có mật khẩu. Nhập mật khẩu để tham gia:");
  if (pwd === null) return; // bấm Cancel
  ws.send(
    JSON.stringify({ type: "join_room", room_id: roomId, password: pwd })
  );
}

// Tham gia phòng
function joinRoom(roomId) {
  console.log("Đang tham gia phòng:", roomId);
  ws.send(
    JSON.stringify({
      type: "join_room",
      room_id: roomId,
    })
  );
}

// Rời phòng
function leaveRoom() {
  const box = document.getElementById("series-status");
  if (box) box.style.display = "none";
  ws.send(
    JSON.stringify({
      type: "leave_room",
    })
  );

  currentRoom = null;
  isBotMode = false;
  showMainScreen();
  startBGMIfNeeded(); // 🔊 Về menu thì bật lại nhạc (nếu đang Bật)
  showNotification("Đã rời phòng", "info");
  refreshRooms(); // Làm mới danh sách phòng
}

// Đặt tên người chơi
function setPlayerName() {
  const nameInput = document.getElementById("player-name");
  const name = nameInput.value.trim();

  if (name.length < 2) {
    showNotification("Tên phải có ít nhất 2 ký tự", "error");
    return;
  }

  playerName = name;
  ws.send(
    JSON.stringify({
      type: "set_name",
      name: name,
    })
  );

  showNotification("Đã cập nhật tên", "success");
}

// Toggle sẵn sàng
function toggleReady() {
  isReady = !isReady;
  const readyBtn = document.getElementById("ready-btn");

  if (isReady) {
    readyBtn.textContent = "⏸️ Hủy sẵn sàng";
    readyBtn.classList.add("ready");

    if (isBotMode) {
      currentRoom.game_state = "playing";
      currentRoom.players.forEach((p) => (p.ready = true));
      updateRoomInfo(currentRoom);

      hideReadyButton();
      enableChoices();
      startCountdownTimer(10); // nếu bạn muốn đếm ngược như PvP
      updateGameStatus("Trò chơi bắt đầu! Hãy chọn Kéo/Búa/Bao.");
      return;
    }
    // PvP
    ws.send(JSON.stringify({ type: "ready" }));
  } else {
    readyBtn.textContent = "✅ Sẵn sàng";
    readyBtn.classList.remove("ready");
  }
}

// Làm mới danh sách phòng
function refreshRooms() {
  ws.send(JSON.stringify({ type: "get_rooms" }));
}

// Hiển thị màn hình chính
function showMainScreen() {
  document
    .querySelectorAll(".screen")
    .forEach((screen) => screen.classList.remove("active"));
  document.getElementById("main-screen").classList.add("active");
}

// Hiển thị màn hình tạo phòng
function showCreateRoom() {
  document
    .querySelectorAll(".screen")
    .forEach((screen) => screen.classList.remove("active"));
  document.getElementById("create-room-screen").classList.add("active");
}

// Hiển thị màn hình phòng chơi
function showGameRoom() {
  document
    .querySelectorAll(".screen")
    .forEach((screen) => screen.classList.remove("active"));
  document.getElementById("game-room-screen").classList.add("active");
  updateRoomInfo(currentRoom);
}

// Cập nhật thông tin phòng
function updateRoomInfo(room) {
  if (!isBotMode && lastPvpSeries) updateSeriesUIPvp(lastPvpSeries);
  if (!room) return;

  currentRoom = room;
  document.getElementById("room-name").textContent = room.room_name;

  // Cập nhật danh sách người chơi với layout 2 người đối diện
  const playersList = document.getElementById("players-list");
  let playersHTML = "";

  // Tạo 2 vị trí cố định cho 2 người chơi
  const leftPlayer = room.players[0] || null;
  const rightPlayer = room.players[1] || null;

  // Người chơi bên trái
  if (leftPlayer) {
    const isCurrentPlayer = leftPlayer.player_id === playerId;
    const playerClass = isCurrentPlayer ? "current-player" : "other-player";

    playersHTML += `
                <div class="player-item ${playerClass} left-side">
                    <div class="player-avatar">${leftPlayer.name
                      .charAt(0)
                      .toUpperCase()}</div>
                    <div class="player-info">
                        <span class="player-name">${leftPlayer.name}</span>
                        <span class="player-status ${
                          leftPlayer.ready ? "ready" : "waiting"
                        }">
                            ${leftPlayer.ready ? "✅ Sẵn sàng" : "⏳ Chờ"}
                        </span>
                    </div>
                </div>
            `;
  } else {
    // Vị trí trống bên trái
    playersHTML += `
                <div class="player-item empty-player left-side">
                    <div class="player-avatar">?</div>
                    <div class="player-info">
                        <span class="player-name">Chờ người chơi</span>
                        <span class="player-status waiting">⏳ Trống</span>
                    </div>
                </div>
            `;
  }

  // Người chơi bên phải
  if (rightPlayer) {
    const isCurrentPlayer = rightPlayer.player_id === playerId;
    const playerClass = isCurrentPlayer ? "current-player" : "other-player";

    playersHTML += `
                <div class="player-item ${playerClass} right-side">
                    <div class="player-avatar">${rightPlayer.name
                      .charAt(0)
                      .toUpperCase()}</div>
                    <div class="player-info">
                        <span class="player-name">${rightPlayer.name}</span>
                        <span class="player-status ${
                          rightPlayer.ready ? "ready" : "waiting"
                        }">
                            ${rightPlayer.ready ? "✅ Sẵn sàng" : "⏳ Chờ"}
                        </span>
                    </div>
                </div>
            `;
  } else {
    // Vị trí trống bên phải
    playersHTML += `
                <div class="player-item empty-player right-side">
                    <div class="player-avatar">?</div>
                    <div class="player-info">
                        <span class="player-name">Chờ người chơi</span>
                        <span class="player-status waiting">⏳ Trống</span>
                    </div>
                </div>
            `;
  }

  playersList.innerHTML = playersHTML;

  // Cập nhật bảng điểm
  updateScoreboard(room);

  // Cập nhật trạng thái game
  if (room.game_state === "playing") {
    updateGameStatus("Trò chơi đang diễn ra!");
    enableChoices();
  } else {
    updateGameStatus("Chờ người chơi sẵn sàng...");
    disableChoices();
  }
}
//helper
function getMyServerName() {
  // Ưu tiên tên do server đang giữ cho chính bạn trong phòng
  if (currentRoom && Array.isArray(currentRoom.players)) {
    const me = currentRoom.players.find((p) => p.player_id === playerId);
    if (me)
      return me.name || me.player_name || playerName || `Player_${playerId}`;
  }
  // Dự phòng: nếu chưa có room/players
  return playerName || `Player_${playerId}`;
}

// Xử lý kết quả game
function handleGameResult(data) {
  clearCountdownTimer(); // dừng đồng hồ khi có kết quả
  const { choices, results, scores } = data;

  // Hiển thị kết quả
  const choiceNames = { rock: "Búa ✊", paper: "Bao 🤚", scissors: "Kéo ✌️" };
  let resultText = "Kết quả:\n";
  for (const [n, choice] of Object.entries(choices)) {
    resultText += `${n}: ${choiceNames[choice]}\n`;
  }
  resultText += "\nKết quả:\n";
  for (const [n, r] of Object.entries(results)) {
    const emoji = r === "win" ? "🎉" : r === "lose" ? "😔" : "🤝";
    resultText += `${n}: ${emoji} ${getResultText(r)}\n`;
  }
  updateGameResult(resultText);

  // Lịch sử
  addToHistory(choices, results);

  // 🔊 Phát âm thanh CHỈ theo kết quả của CHÍNH BẠN (tên khớp với server)
  const meName = getMyServerName();
  const myResult = results[meName];
  if (myResult === "win") play("win-sound");
  else if (myResult === "lose") play("lose-sound");
  else play("draw-sound");

  // Cập nhật bảng điểm
  if (currentRoom && scores) {
    currentRoom.scores = scores;
    updateScoreboard(currentRoom);
  }

  // UI sau khi kết thúc ván
  showNewGameButton();
  hideReadyButton();

  isWaitingForOpponent = false;
  currentChoice = null;
  clearChoiceSelection();
  isReady = false;
  disableChoices();

  updateGameStatus("Trận đấu kết thúc! Bấm 'Chơi lại' để bắt đầu vòng mới");
  // 🔊 BẬT lại nhạc nền ở màn hình chờ sau trận
  startBGMIfNeeded();
}

// Thêm helper chung
function play(tagId) {
  if (!sfxEnabled) return;
  const el = document.getElementById(tagId);
  if (!el) return;
  try {
    el.currentTime = 0;
    el.play();
  } catch {}
}

//Helper phát nhạc nền + toggle
function startBGMIfNeeded() {
  const bgm = document.getElementById("bgm");
  if (!bgm || !bgmEnabled) return;
  try {
    bgm.currentTime = 0;
    bgm.volume = 0.35;
    bgm.play();
  } catch {}
}

function stopBGM() {
  const bgm = document.getElementById("bgm");
  if (!bgm) return;
  try {
    bgm.pause();
  } catch {}
}

function toggleBGM() {
  bgmEnabled = !bgmEnabled;
  const btn = document.getElementById("bgm-toggle");
  if (bgmEnabled) {
    startBGMIfNeeded();
    btn.textContent = "🎵 Nhạc: Bật";
  } else {
    stopBGM();
    btn.textContent = "🎵 Nhạc: Tắt";
  }
}

function toggleSFX() {
  sfxEnabled = !sfxEnabled;
  const btn = document.getElementById("sfx-toggle");
  btn.textContent = sfxEnabled ? "🔔 Hiệu ứng: Bật" : "🔕 Hiệu ứng: Tắt";
}

function sendChoice(choice) {
  // --- BOT MODE ---
  if (currentRoom && currentRoom.room_name === "Bạn vs Máy") {
    // Chỉ cho chọn khi đang ở trạng thái 'playing'
    if (!currentRoom || currentRoom.game_state !== "playing") {
      showNotification("Bấm 'Chơi lại' để bắt đầu ván mới với Bot.", "info");
      return;
    }
    // Chống spam click nhiều lần trong ván
    if (hasChosenThisRound) return;
    hasChosenThisRound = true;

    // SFX click chọn
    play("click-sound");

    const me = effectivePlayerName();
    currentChoice = choice;
    selectChoice(choice);
    disableChoices(); // khóa nút ngay khi đã chọn

    // Bot chọn ngẫu nhiên
    const botChoices = ["rock", "paper", "scissors"];
    const botChoice = botChoices[Math.floor(Math.random() * 3)];

    // Tính kết quả
    const result = getResultAgainstBot(choice, botChoice);
    const results = {
      [me]: result,
      Bot: result === "win" ? "lose" : result === "lose" ? "win" : "draw",
    };
    const choices = { [me]: choice, Bot: botChoice };

    // Lịch sử + điểm tích lũy (scores màn hình)
    addToHistory(choices, results);
    if (!currentRoom.scores[me])
      currentRoom.scores[me] = { wins: 0, losses: 0, draws: 0 };
    if (!currentRoom.scores["Bot"])
      currentRoom.scores["Bot"] = { wins: 0, losses: 0, draws: 0 };
    if (result === "win") {
      currentRoom.scores[me].wins++;
      currentRoom.scores.Bot.losses++;
    } else if (result === "lose") {
      currentRoom.scores[me].losses++;
      currentRoom.scores.Bot.wins++;
    } else {
      currentRoom.scores[me].draws++;
      currentRoom.scores.Bot.draws++;
    }
    updateScoreboard(currentRoom);

    // Hiển thị kết quả một ván
    const getChoiceText = (c) =>
      c === "rock" ? "Búa ✊" : c === "paper" ? "Bao 🤚" : "Kéo ✌️";
    updateGameResult(
      `Bạn chọn ${getChoiceText(choice)} - Bot chọn ${getChoiceText(botChoice)}`
    );

    // Phát âm theo KẾT QUẢ của bạn
    if (result === "win") play("win-sound");
    else if (result === "lose") play("lose-sound");
    else play("draw-sound");

    // --- CẬP NHẬT SERIES (Bo3) ---
    if (result === "win") botSeriesWins.me++;
    else if (result === "lose") botSeriesWins.bot++;
    // Hòa thì seriesWins không đổi
    updateSeriesUIBot();

    const target = Math.ceil(botSeriesBestOf / 2); // Bo3 -> 2, Bo5 -> 3
    clearCountdownTimer();
    currentRoom.game_state = "finished";

    showNewGameButton(); // hiện nút Chơi lại

    if (botSeriesWins.me >= target || botSeriesWins.bot >= target) {
      // SERIES KẾT THÚC
      botSeriesOver = true;
      updateGameStatus(
        botSeriesWins.me > botSeriesWins.bot
          ? `Bạn thắng series Bo${botSeriesBestOf}! Bấm 'Chơi lại' để bắt đầu series mới.`
          : `Bot thắng series Bo${botSeriesBestOf}! Bấm 'Chơi lại' để bắt đầu series mới.`
      );
      // Đổi nhãn nút cho dễ hiểu (tùy bạn)
      const btn = document.getElementById("new-game-btn");
      if (btn) btn.textContent = "🔄 Bắt đầu series mới";
    } else {
      // CÒN VÁN TIẾP THEO
      botSeriesOver = false;
      updateGameStatus(
        `Ván tiếp theo trong series Bo${botSeriesBestOf}: bấm 'Chơi lại'.`
      );
      const btn = document.getElementById("new-game-btn");
      if (btn) btn.textContent = "🔄 Chơi lại (vòng kế)";
    }
    return;
  }

  // --- PVP (giữ nguyên như bạn đang có) ---
  if (isWaitingForOpponent) {
    showNotification("Bạn đã chọn rồi, đang chờ người khác...", "info");
    return;
  }
  play("click-sound");
  currentChoice = choice;
  isWaitingForOpponent = true;

  selectChoice(choice);
  hasChosenThisRound = true;
  clearCountdownTimer();

  ws.send(JSON.stringify({ type: "choice", choice }));
  updateGameStatus("Đã chọn! Đang chờ người khác...");
}

// Cập nhật bảng điểm
function updateScoreboard(room) {
  const scoreboard = document.getElementById("scoreboard");
  if (!scoreboard || !room.scores) {
    console.log("Không thể cập nhật scoreboard:", {
      scoreboard: !!scoreboard,
      scores: !!room.scores,
    });
    return;
  }

  console.log("Cập nhật scoreboard với room:", room);
  console.log("Scores trong room:", room.scores);

  let scoreboardHTML = "";

  // Tìm người thắng và thua dựa trên điểm số
  let winner = null;
  let loser = null;
  let isDraw = false;

  const playerNames = Object.keys(room.scores);
  if (playerNames.length === 2) {
    const player1 = room.scores[playerNames[0]];
    const player2 = room.scores[playerNames[1]];

    if (player1.wins > player2.wins) {
      winner = playerNames[0];
      loser = playerNames[1];
    } else if (player2.wins > player1.wins) {
      winner = playerNames[1];
      loser = playerNames[0];
    } else if (player1.losses > player2.losses) {
      winner = playerNames[1];
      loser = playerNames[0];
    } else if (player2.losses > player1.losses) {
      winner = playerNames[0];
      loser = playerNames[1];
    } else {
      isDraw = true; // Hòa
    }
  }

  // Hiển thị điểm số cho từng người chơi
  for (const [playerName, score] of Object.entries(room.scores)) {
    console.log("Xử lý player:", playerName, "score:", score);

    // Tìm player_id của người chơi này để so sánh
    let isCurrentPlayer = false;
    for (const player of room.players) {
      if (player.name === playerName && player.player_id === playerId) {
        isCurrentPlayer = true;
        break;
      }
    }

    // Xác định class cho màu sắc
    let playerClass = isCurrentPlayer ? "current-player" : "";
    if (!isDraw) {
      if (playerName === winner) {
        playerClass += " winner";
      } else if (playerName === loser) {
        playerClass += " loser";
      }
    }

    scoreboardHTML += `
            <div class="score-item ${playerClass}">
                <div class="player-info">
                    <div class="player-avatar">${playerName
                      .charAt(0)
                      .toUpperCase()}</div>
                    <div class="player-name">${playerName}</div>
                </div>
                <div class="score-stats">
                    <div class="score-stat wins">
                        <span>🏆</span>
                        <span>${score.wins}</span>
                    </div>
                    <div class="score-stat losses">
                        <span>💔</span>
                        <span>${score.losses}</span>
                    </div>
                    <div class="score-stat draws">
                        <span>🤝</span>
                        <span>${score.draws}</span>
                    </div>
                </div>
            </div>
        `;
  }

  console.log("Scoreboard HTML:", scoreboardHTML);
  scoreboard.innerHTML = scoreboardHTML;
}

function requestNewGame() {
  // BOT MODE
  if (currentRoom && currentRoom.room_name === "Bạn vs Máy") {
    clearCountdownTimer();
    clearChoiceSelection();
    hideNewGameButton();

    if (botSeriesOver) {
      // BẮT ĐẦU SERIES MỚI
      botSeriesWins = { me: 0, bot: 0 };
      botSeriesOver = false;
      updateSeriesUIBot();
      updateGameResult("");
      updateGameStatus("Bấm 'Sẵn sàng' để bắt đầu series mới với Bot.");
      // Trở lại trạng thái chờ
      currentRoom.game_state = "waiting";
      currentRoom.players.forEach((p) => (p.ready = false));
      showReadyButton();
      disableChoices();
    } else {
      // VÁN TIẾP THEO TRONG SERIES
      currentRoom.game_state = "playing";
      hasChosenThisRound = false;
      currentChoice = null;
      updateGameResult("");
      updateGameStatus(
        `Bo${botSeriesBestOf} — Ván kế tiếp: hãy chọn Kéo/Búa/Bao.`
      );
      enableChoices();
      startCountdownTimer(10);
    }
    return;
  }

  // PVP
  ws.send(JSON.stringify({ type: "new_game" }));
  updateGameStatus("Đang chờ người chơi khác bấm 'Chơi lại'.");
  hideNewGameButton();
  clearChoiceSelection();
  disableChoices();
}

// Cập nhật trạng thái game
function updateGameStatus(message) {
  document.getElementById("game-status").textContent = message;
}

// Cập nhật kết quả game
function updateGameResult(message) {
  document.getElementById("game-result").textContent = message;
}

// Bật các nút lựa chọn
function enableChoices() {
  document.querySelectorAll(".choice-btn").forEach((btn) => {
    btn.disabled = false;
    btn.style.opacity = "1";
  });
}

// Tắt các nút lựa chọn
function disableChoices() {
  document.querySelectorAll(".choice-btn").forEach((btn) => {
    btn.disabled = true;
    btn.style.opacity = "0.5";
  });
}

// Chọn lựa chọn
function selectChoice(choice) {
  clearChoiceSelection();
  const btn = document.getElementById(`${choice}-btn`);
  if (btn) {
    btn.classList.add("selected");
  }
}

// Xóa lựa chọn đã chọn
function clearChoiceSelection() {
  document.querySelectorAll(".choice-btn").forEach((btn) => {
    btn.classList.remove("selected");
  });
}

// Hiển thị nút chơi lại
function showNewGameButton() {
  document.getElementById("new-game-btn").style.display = "block";
}

// Ẩn nút chơi lại
function hideNewGameButton() {
  document.getElementById("new-game-btn").style.display = "none";
}

// Ẩn nút sẵn sàng
function hideReadyButton() {
  const readyBtn = document.getElementById("ready-btn");
  readyBtn.style.display = "none";
}

// Hiển thị nút sẵn sàng
function showReadyButton() {
  const readyBtn = document.getElementById("ready-btn");
  isReady = false;
  readyBtn.style.display = "block";
  readyBtn.textContent = "✅ Sẵn sàng";
  readyBtn.classList.remove("ready");
}

// Thêm vào lịch sử
function addToHistory(choices, results) {
  const choiceNames = {
    rock: "Búa",
    paper: "Bao",
    scissors: "Kéo",
  };

  let historyText = "";
  for (const [playerName, choice] of Object.entries(choices)) {
    historyText += `${playerName}: ${choiceNames[choice]}`;
    if (
      Object.keys(choices).indexOf(playerName) <
      Object.keys(choices).length - 1
    ) {
      historyText += " vs ";
    }
  }

  const resultCounts = { win: 0, lose: 0, draw: 0 };
  for (const result of Object.values(results)) {
    resultCounts[result]++;
  }

  let resultSummary = "";
  if (resultCounts.win > 0) resultSummary += `${resultCounts.win} thắng `;
  if (resultCounts.lose > 0) resultSummary += `${resultCounts.lose} thua `;
  if (resultCounts.draw > 0) resultSummary += `${resultCounts.draw} hòa`;

  const historyItem = {
    text: `${historyText} - ${resultSummary}`,
    result:
      resultCounts.win > 0 ? "win" : resultCounts.lose > 0 ? "lose" : "draw",
  };

  gameHistory.unshift(historyItem);
  if (gameHistory.length > 10) {
    gameHistory.pop();
  }

  updateHistoryDisplay();
}

// Cập nhật hiển thị lịch sử
function updateHistoryDisplay() {
  const historyList = document.getElementById("history-list");
  historyList.innerHTML = "";

  gameHistory.forEach((item) => {
    const div = document.createElement("div");
    div.className = `history-item history-${item.result}`;
    div.textContent = item.text;
    historyList.appendChild(div);
  });
}

// Lấy text kết quả
function getResultText(result) {
  switch (result) {
    case "win":
      return "Thắng!";
    case "lose":
      return "Thua!";
    case "draw":
      return "Hòa!";
    default:
      return "Không xác định";
  }
}

// Hiển thị thông báo
function showNotification(message, type = "info") {
  const notification = document.getElementById("notification");
  notification.textContent = message;
  notification.className = `notification ${type} show`;

  setTimeout(() => {
    notification.classList.remove("show");
  }, 3000);
}

// Khởi tạo khi trang load
document.addEventListener("DOMContentLoaded", () => {
  initWebSocket();
  updateHistoryDisplay();

  // Tự động focus vào input tên
  document.getElementById("player-name").focus();
  //enter chat
  document.getElementById("chat-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendChat();
  });

  // Enter để đặt tên
  document.getElementById("player-name").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      setPlayerName();
    }
  });

  // Enter để tạo phòng
  document.getElementById("room-name").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      createRoom();
    }
  });
  //
  const usePw = document.getElementById("use-password");
  const pwWrap = document.getElementById("password-wrap");
  const pwInput = document.getElementById("room-password");
  const eyeBtn = document.getElementById("pw-eye");
  if (usePw && pwWrap) {
    usePw.addEventListener("change", () => {
      pwWrap.style.display = usePw.checked ? "block" : "none";
      // reset kiểu input + biểu tượng khi tắt
      if (!usePw.checked && pwInput && eyeBtn) {
        pwInput.type = "password";
        eyeBtn.textContent = "👁";
        eyeBtn.setAttribute("aria-label", "Hiện mật khẩu");
      }
    });
  }

  // toggle con mắt
  if (eyeBtn && pwInput) {
    eyeBtn.addEventListener("click", () => {
      const hidden = pwInput.type === "password";
      pwInput.type = hidden ? "text" : "password";
      eyeBtn.textContent = hidden ? "🙈" : "👁"; // đổi icon
      eyeBtn.setAttribute(
        "aria-label",
        hidden ? "Ẩn mật khẩu" : "Hiện mật khẩu"
      );
      // giữ nguyên vị trí con trỏ
      pwInput.focus();
      pwInput.setSelectionRange(pwInput.value.length, pwInput.value.length);
    });
  }
  document.addEventListener(
    "click",
    function onFirstInteraction() {
      // lần click đầu tiên trên trang -> bắt đầu BGM (đáp ứng autoplay policy)
      startBGMIfNeeded();
      document.removeEventListener("click", onFirstInteraction);
    },
    { once: true }
  );

  // Phát click cho mọi button, trừ nút lựa chọn (vì sendChoice đã play click rồi)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.classList.contains("choice-btn")) return; // tránh double
    play("ui-click-sound");
  });
  // Cập nhật nhãn ban đầu
  const bgmBtn = document.getElementById("bgm-toggle");
  const sfxBtn = document.getElementById("sfx-toggle");
  if (bgmBtn) bgmBtn.textContent = "🎵 Nhạc: Tắt";
  if (sfxBtn)
    sfxBtn.textContent = sfxEnabled ? "🔔 Hiệu ứng: Bật" : "🔕 Hiệu ứng: Tắt";
});

// Bắt đầu chơi với máy (bot)
function startVsBot() {
  const me = effectivePlayerName();
  isBotMode = true;

  // Reset series mỗi khi vào Bot (nếu muốn giữ điểm qua nhiều series, bỏ 3 dòng dưới)
  botSeriesBestOf = 3; // có thể đổi 5 sau
  botSeriesWins = { me: 0, bot: 0 };
  botSeriesOver = false;

  currentRoom = {
    room_name: "Bạn vs Máy",
    players: [
      { name: me, ready: false, player_id: playerId },
      { name: "Bot", ready: false, player_id: -1 },
    ],
    game_state: "waiting",
    scores: {
      [me]: currentRoom?.scores?.[me] ?? { wins: 0, losses: 0, draws: 0 },
      Bot: currentRoom?.scores?.Bot ?? { wins: 0, losses: 0, draws: 0 },
    },
  };

  showGameRoom();
  hideNewGameButton(); // tránh dính trạng thái cũ
  showReadyButton(); // có Sẵn sàng giống PvP
  disableChoices();
  updateGameStatus("Bấm 'Sẵn sàng' để bắt đầu ván với Bot.");
  updateSeriesUIBot(); // hiện Bo3: 0—0
  stopBGM(); // nếu bạn đang để vào trận tắt nhạc
}

// Hàm xử lý kết quả khi chơi với bot
function getResultAgainstBot(player, bot) {
  if (player === bot) return "draw";
  if (
    (player === "rock" && bot === "scissors") ||
    (player === "paper" && bot === "rock") ||
    (player === "scissors" && bot === "paper")
  ) {
    return "win";
  }
  return "lose";
}
//hàm gửi chat
function sendChat() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  ws.send(
    JSON.stringify({
      type: "chat",
      message: text,
    })
  );
  input.value = "";
}

function addChatMessage(sender, message) {
  const chatBox = document.getElementById("chat-messages");
  if (!chatBox) return;

  const me = getMyServerName();
  const isMe = sender === me;
  const nameDisplay = isMe ? "Bạn" : sender;

  let cls = "chat-message";
  if (isMe) cls += " me";
  if (sender === "SYSTEM") cls += " system";

  const div = document.createElement("div");
  div.className = cls;
  div.innerHTML = `<b>${nameDisplay}:</b> ${message}`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

//thêm giới hạn thời gian
function startCountdownTimer(duration = 10) {
  clearCountdownTimer();
  timeLeft = duration;
  hasChosenThisRound = false;
  document.getElementById("countdown-timer").style.display = "block";
  document.getElementById("timer-value").textContent = timeLeft;

  countdownInterval = setInterval(() => {
    timeLeft -= 1;
    document.getElementById("timer-value").textContent = timeLeft;
    if (timeLeft <= 0) {
      clearCountdownTimer();
      if (
        !hasChosenThisRound &&
        currentRoom &&
        currentRoom.room_name !== "Bạn vs Máy"
      ) {
        // Random tự động chọn nếu chưa chọn
        const randomChoices = ["rock", "paper", "scissors"];
        const autoChoice = randomChoices[Math.floor(Math.random() * 3)];
        sendChoice(autoChoice, true); // true = auto
      }
      // Ẩn timer sau khi hết giờ
      document.getElementById("countdown-timer").style.display = "none";
    }
  }, 1000);
}

function clearCountdownTimer() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  document.getElementById("countdown-timer").style.display = "none";
}
function effectivePlayerName() {
  return (playerName && playerName.trim()) || `Người chơi ${playerId}`;
}

//Thêm hàm quickPlay
function quickPlay() {
  const rooms = Array.isArray(latestRooms) ? latestRooms : [];
  const candidates = rooms
    .filter((r) => !r.has_password) // bỏ qua phòng có mật khẩu
    .filter((r) => Number(r.current_players) < 2)
    .sort((a, b) => {
      const rank = (s) => (s === "waiting" ? 0 : s === "playing" ? 1 : 2);
      return rank(a.game_state) - rank(b.game_state);
    });

  if (candidates.length > 0) {
    joinRoom(candidates[0].room_id);
    return;
  }

  // Không có phòng public phù hợp -> tạo nhanh (không mật khẩu)
  document.getElementById("room-name").value = `Phòng ${Date.now()}`;
  // đảm bảo không gửi password
  if (document.getElementById("use-password")) {
    document.getElementById("use-password").checked = false;
    const pwWrap = document.getElementById("password-wrap");
    if (pwWrap) pwWrap.style.display = "none";
  }
  createRoom();
}

//Hàm ping
function updatePingUI(rtt) {
  const el = document.getElementById("ping-value");
  if (!el) return;
  el.textContent = rtt > 0 ? rtt : "--";

  el.classList.remove("ping-good", "ping-ok", "ping-bad");
  if (rtt <= 0) return;
  if (rtt < 60) el.classList.add("ping-good");
  else if (rtt < 150) el.classList.add("ping-ok");
  else el.classList.add("ping-bad");
}
function startPing() {
  if (pingTimer) return;
  const tick = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    lastPingTs = Date.now();
    ws.send(JSON.stringify({ type: "ping", t: lastPingTs }));
  };
  tick(); // gửi ngay 1 cái
  pingTimer = setInterval(tick, 5000);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  updatePingUI(0);
}
//Cập nhật chức năng bot
function updateSeriesUIBot() {
  const el = document.getElementById("series-status");
  if (!el) return;
  const me = effectivePlayerName();
  el.style.display = "block";
  el.textContent = `Bo${botSeriesBestOf}: ${me} ${botSeriesWins.me} — ${botSeriesWins.bot} Bot`;
}

// ==== Bo3 UI cho PvP (bản chắc kèo) ====
function updateSeriesUIPvp(series) {
  // Bỏ qua nếu đang ở Bot mode
  if (typeof isBotMode !== "undefined" && isBotMode) return;

  const box = document.getElementById("series-status");
  if (!box) return;

  // Phòng hờ: chưa có room/players -> ẩn
  if (
    !currentRoom ||
    !Array.isArray(currentRoom.players) ||
    currentRoom.players.length < 1
  ) {
    box.style.display = "none";
    return;
  }

  const bo = (series && series.best_of) || 3;
  const wins = (series && series.wins) || {};

  // Map id -> name để tra thẳng theo id trong 'wins'
  const byId = {};
  for (const p of currentRoom.players) {
    if (p && typeof p.player_id !== "undefined") {
      byId[String(p.player_id)] =
        p.name || p.player_name || `Player_${p.player_id}`;
    }
  }

  // Xác định "mình" & "đối thủ" theo playerId thật
  const meId = String(playerId);
  const meName = byId[meId] || `Player_${playerId}`;

  // Tìm id đối thủ từ danh sách players (khác playerId của mình)
  let oppId = null;
  for (const p of currentRoom.players) {
    if (p && String(p.player_id) !== meId) {
      oppId = String(p.player_id);
      break;
    }
  }
  const oppName = (oppId && byId[oppId]) || "Đối thủ";

  // Lấy điểm theo id (chịu cả trường hợp key là "1" hoặc 1)
  const getW = (id) => wins[String(id)] ?? wins[id] ?? 0;
  const wMe = getW(meId);
  const wOpp = oppId ? getW(oppId) : 0;

  // Nếu thiếu id đối thủ (hi hữu) thì vẫn hiển thị mình 0—0 để không “mất dòng”
  box.style.display = "block";
  box.textContent = `Bo${bo}: ${meName} ${wMe} — ${wOpp} ${oppName}`;
}
