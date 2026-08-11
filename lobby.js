const lobbyState = { socket: null, room: null, game: null, selectedIndex: null };
const modeView = document.querySelector("#mode-view");
const lobbyView = document.querySelector("#lobby-view");
const gameView = document.querySelector("#game-view");
const onlineGameView = document.querySelector("#online-game-view");
const lobbyFormView = document.querySelector("#lobby-form-view");
const waitingRoom = document.querySelector("#waiting-room");
const lobbyError = document.querySelector("#lobby-error");

function showView(view) {
  modeView.hidden = view !== "mode";
  lobbyView.hidden = view !== "lobby";
  gameView.hidden = view !== "game";
  onlineGameView.hidden = view !== "online-game";
  document.body.classList.toggle("game-active", view === "game" || view === "online-game");
}

function getNickname() {
  return document.querySelector("#nickname").value.trim();
}

function setLobbyError(message = "") {
  lobbyError.textContent = message;
}

function connectLobby() {
  if (lobbyState.socket?.connected) return true;
  if (typeof window.io !== "function") {
    setLobbyError("联机服务尚未启动，请通过 Node 服务器打开网站。");
    return false;
  }
  lobbyState.socket = window.io();
  lobbyState.socket.on("room-updated", updateRoom);
  lobbyState.socket.on("game-state", updateOnlineGame);
  lobbyState.socket.on("game-stopped", ({ message }) => {
    showView("lobby");
    waitingRoom.hidden = false;
    lobbyFormView.hidden = true;
    document.querySelector("#room-status").textContent = message;
  });
  lobbyState.socket.on("connect_error", () => setLobbyError("无法连接联机服务器，请稍后重试。"));
  return true;
}

function requestRoom(event, payload) {
  if (!getNickname()) {
    setLobbyError("请先输入昵称。");
    return;
  }
  if (!connectLobby()) return;
  setLobbyError();
  lobbyState.socket.emit(event, payload, (response) => {
    if (!response?.ok) {
      setLobbyError(response?.message || "操作失败，请重试。");
      return;
    }
    updateRoom(response.room);
  });
}

function updateRoom(room) {
  lobbyState.room = room;
  lobbyFormView.hidden = true;
  waitingRoom.hidden = false;
  document.querySelector("#room-code-display").textContent = room.code;
  const seatNames = ["南", "西", "北", "东"];
  const seats = seatNames.map((name, index) => {
    const player = room.players.find((item) => item.seat === index);
    const element = document.createElement("div");
    element.className = `room-seat${player ? "" : " empty"}`;
    element.innerHTML = `<span class="seat">${name}</span><span class="room-seat-name">${player ? escapeHtml(player.nickname) : "等待加入"}</span>${player?.isHost ? '<span class="host-badge">房主</span>' : ""}`;
    return element;
  });
  document.querySelector("#room-seats").replaceChildren(...seats);
  const full = room.players.length === 4;
  const isHost = room.selfId === room.hostId;
  document.querySelector("#room-status").textContent = full ? "四位玩家已到齐" : `已加入 ${room.players.length}/4，等待朋友…`;
  const startButton = document.querySelector("#start-online-game");
  startButton.disabled = !full || !isHost;
  startButton.textContent = full && isHost ? "开始游戏" : full ? "等待房主开始" : "等待四人到齐";
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function leaveRoom() {
  lobbyState.socket?.emit("leave-room");
  lobbyState.room = null;
  waitingRoom.hidden = true;
  lobbyFormView.hidden = false;
  setLobbyError();
}

function onlineRelativePosition(seat, selfSeat) {
  return ["self", "left", "top", "right"][(seat - selfSeat + 4) % 4];
}

function createOnlineTile(tile, asButton = false, index = 0) {
  const tileImage = document.createElement("img");
  tileImage.src = TILE_IMAGES[tile];
  tileImage.alt = TILE_LABELS[tile];
  tileImage.draggable = false;
  if (!asButton) {
    tileImage.className = "tile compact";
    return tileImage;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = `tile${lobbyState.selectedIndex === index ? " selected" : ""}`;
  button.disabled = !lobbyState.game?.canDiscard;
  tileImage.className = "tile-art";
  button.append(tileImage);
  button.addEventListener("click", () => {
    if (!lobbyState.game?.canDiscard) return;
    lobbyState.selectedIndex = index;
    renderOnlineGame();
  });
  return button;
}

function createTileBacks(count, vertical = false) {
  return Array.from({ length: count }, () => {
    const tile = document.createElement("span");
    tile.className = "tile-back";
    if (vertical) tile.dataset.vertical = "true";
    return tile;
  });
}

function updateOnlineGame(game) {
  lobbyState.game = game;
  lobbyState.selectedIndex = null;
  showView("online-game");
  renderOnlineGame();
}

function renderOnlineGame() {
  const game = lobbyState.game;
  if (!game) return;
  const seatNames = ["南", "西", "北", "东"];
  document.querySelector("#online-room-label").textContent = `房间 ${game.roomCode}`;
  document.querySelector("#online-wall-count").textContent = `牌墙 ${game.wallCount}`;
  document.querySelector("#online-hand").replaceChildren(...game.hand.map((tile, index) => createOnlineTile(tile, true, index)));
  document.querySelector("#online-discards").replaceChildren(...game.discards.slice(-36).map(({ tile }) => createOnlineTile(tile)));

  game.players.forEach((player) => {
    const position = onlineRelativePosition(player.seat, game.selfSeat);
    document.querySelector(`#online-seat-${position}`).textContent = seatNames[player.seat];
    document.querySelector(`#online-name-${position}`).textContent = position === "self" ? `${player.nickname} · 你的手牌` : player.nickname;
    document.querySelector(`#online-score-${position}`).textContent = `${player.score} 分`;
    if (position !== "self") {
      document.querySelector(`#online-hand-${position}`).replaceChildren(...createTileBacks(player.tileCount, position !== "top"));
    }
  });

  const currentPlayer = game.players.find((player) => player.seat === game.turn);
  const starter = game.players.find((player) => player.seat === game.starterSeat);
  document.querySelector("#online-room-label").title = `本局由 ${starter?.nickname || "南家"} 先出牌`;
  const actions = game.actions || {};
  if (game.result) {
    document.querySelector("#online-status").textContent = "本局已经结束";
  } else if (actions.canWin) {
    document.querySelector("#online-status").textContent = actions.winType === "self-draw" ? "你可以自摸胡牌" : "有人点炮，你可以胡牌";
  } else {
    document.querySelector("#online-status").textContent = game.canDiscard
      ? lobbyState.selectedIndex === null ? "轮到你出牌" : `已选择 ${TILE_LABELS[game.hand[lobbyState.selectedIndex]]}，请确认打出`
      : `等待 ${currentPlayer?.nickname || "其他玩家"} 出牌…`;
  }
  document.querySelector("#online-claim-actions").hidden = !actions.canWin;
  document.querySelector("#online-pass").hidden = !actions.canPass;
  document.querySelector("#online-self-actions").hidden = lobbyState.selectedIndex === null || !game.canDiscard;
  renderOnlineResult();
}

function renderOnlineResult() {
  const game = lobbyState.game;
  const overlay = document.querySelector("#online-result");
  if (!game?.result) {
    overlay.hidden = true;
    return;
  }
  const result = game.result;
  overlay.hidden = false;
  if (result.type === "draw") {
    document.querySelector("#online-result-title").textContent = "流局";
    document.querySelector("#online-result-message").textContent = result.message;
  } else {
    const winner = game.players.find((player) => player.seat === result.winnerSeat);
    const discarder = game.players.find((player) => player.seat === result.discarderSeat);
    const method = result.type === "self-draw" ? "自摸" : `接到 ${discarder?.nickname || "玩家"} 的点炮`;
    const bonusText = result.bonuses.length ? `，${result.bonuses.join("、")}` : "";
    document.querySelector("#online-result-title").textContent = `${winner?.nickname || "玩家"} 胡牌`;
    document.querySelector("#online-result-message").textContent = `${method} · ${result.pattern}${bonusText}`;
  }
  const scoreRows = game.players.map((player) => {
    const row = document.createElement("div");
    row.className = `result-score-row${player.seat === result.winnerSeat ? " winner" : ""}`;
    const name = document.createElement("span");
    name.textContent = player.nickname;
    const score = document.createElement("span");
    score.textContent = `${player.score} 分`;
    row.append(name, score);
    return row;
  });
  document.querySelector("#online-result-scores").replaceChildren(...scoreRows);
  document.querySelector("#online-next-round").hidden = !game.isHost;
  document.querySelector("#online-next-round-hint").textContent = game.isHost ? "胜者将在下一局先出牌" : "等待房主开始下一局…";
}

document.querySelector("#single-mode").addEventListener("click", () => showView("game"));
document.querySelector("#online-mode").addEventListener("click", () => {
  showView("lobby");
  connectLobby();
});
document.querySelector("#back-to-mode").addEventListener("click", () => {
  if (lobbyState.room) leaveRoom();
  showView("mode");
});
document.querySelector("#create-room").addEventListener("click", () => requestRoom("create-room", { nickname: getNickname() }));
document.querySelector("#join-room").addEventListener("click", () => {
  const code = document.querySelector("#room-code-input").value.trim();
  requestRoom("join-room", { nickname: getNickname(), code });
});
document.querySelector("#leave-room").addEventListener("click", leaveRoom);
document.querySelector("#start-online-game").addEventListener("click", () => {
  lobbyState.socket?.emit("start-game", {}, (response) => {
    if (!response?.ok) document.querySelector("#room-status").textContent = response?.message || "无法开始游戏。";
  });
});
document.querySelector("#online-confirm-discard").addEventListener("click", () => {
  if (lobbyState.selectedIndex === null) return;
  lobbyState.socket?.emit("discard-tile", { index: lobbyState.selectedIndex }, (response) => {
    if (!response?.ok) document.querySelector("#online-status").textContent = response?.message || "出牌失败。";
  });
});
document.querySelector("#online-win").addEventListener("click", () => {
  lobbyState.socket?.emit("claim-win", {}, (response) => {
    if (!response?.ok) document.querySelector("#online-status").textContent = response?.message || "胡牌失败。";
  });
});
document.querySelector("#online-pass").addEventListener("click", () => {
  lobbyState.socket?.emit("pass-win", {}, (response) => {
    if (!response?.ok) document.querySelector("#online-status").textContent = response?.message || "操作失败。";
  });
});
document.querySelector("#online-next-round").addEventListener("click", () => {
  lobbyState.socket?.emit("next-round", {}, (response) => {
    if (!response?.ok) document.querySelector("#online-next-round-hint").textContent = response?.message || "无法开始下一局。";
  });
});
document.querySelector("#online-fullscreen-toggle").addEventListener("click", toggleFullscreen);
document.querySelector("#copy-invite").addEventListener("click", async () => {
  if (!lobbyState.room) return;
  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("room", lobbyState.room.code);
  const invitation = `来青雀麻将开一桌：${inviteUrl}\n房间号：${lobbyState.room.code}`;
  try {
    await navigator.clipboard.writeText(invitation);
    document.querySelector("#copy-invite").textContent = "邀请信息已复制";
  } catch {
    window.prompt("复制下面的邀请信息", invitation);
  }
});

const initialRoom = new URLSearchParams(window.location.search).get("room");
if (initialRoom) {
  document.querySelector("#room-code-input").value = initialRoom.replace(/\D/g, "").slice(0, 6);
  showView("lobby");
  connectLobby();
} else {
  showView("mode");
}
