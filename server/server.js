const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const allowedOrigins = new Set([
  "https://siqiwang.com",
  "https://www.siqiwang.com",
  "https://majiang-0eot.onrender.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) callback(null, true);
      else callback(new Error("Origin not allowed"));
    },
    methods: ["GET", "POST"],
  },
});
const port = process.env.PORT || 3000;
const projectRoot = path.resolve(__dirname, "..");
const rooms = new Map();

app.use("/assets", express.static(path.join(projectRoot, "assets"), { dotfiles: "ignore" }));
app.get("/", (_request, response) => response.sendFile(path.join(projectRoot, "index.html")));
["index.html", "styles.css", "script.js", "lobby.js"].forEach((file) => {
  app.get(`/${file}`, (_request, response) => response.sendFile(path.join(projectRoot, file)));
});
app.get("/health", (_request, response) => response.json({ ok: true }));

function cleanNickname(value) {
  return String(value || "").trim().replace(/[<>]/g, "").slice(0, 12);
}

function createRoomCode() {
  let code;
  do code = String(Math.floor(100000 + Math.random() * 900000)); while (rooms.has(code));
  return code;
}

function publicRoom(room, selfId) {
  return {
    code: room.code,
    hostId: room.hostId,
    selfId,
    players: room.players.map(({ id, nickname, seat }) => ({ id, nickname, seat, isHost: id === room.hostId })),
  };
}

function shuffledWall() {
  const wall = Array.from({ length: 108 }, (_, index) => Math.floor(index / 4));
  for (let index = wall.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [wall[index], wall[swapIndex]] = [wall[swapIndex], wall[index]];
  }
  return wall;
}

function canFormMelds(counts) {
  const first = counts.findIndex((count) => count > 0);
  if (first === -1) return true;
  if (counts[first] >= 3) {
    counts[first] -= 3;
    if (canFormMelds(counts)) return true;
    counts[first] += 3;
  }
  const suitEnd = first < 9 ? 9 : first < 18 ? 18 : 27;
  if (first + 2 < suitEnd && counts[first + 1] && counts[first + 2]) {
    counts[first] -= 1;
    counts[first + 1] -= 1;
    counts[first + 2] -= 1;
    if (canFormMelds(counts)) return true;
    counts[first] += 1;
    counts[first + 1] += 1;
    counts[first + 2] += 1;
  }
  return false;
}

function isSevenPairs(hand, meldCount = 0) {
  if (meldCount !== 0 || hand.length !== 14) return false;
  const counts = Array(27).fill(0);
  hand.forEach((tile) => { counts[tile] += 1; });
  return counts.every((count) => count % 2 === 0)
    && counts.reduce((pairs, count) => pairs + count / 2, 0) === 7;
}

function isStandardWin(hand, meldCount = 0) {
  if (hand.length !== (4 - meldCount) * 3 + 2) return false;
  const counts = Array(27).fill(0);
  hand.forEach((tile) => { counts[tile] += 1; });
  for (let pair = 0; pair < counts.length; pair += 1) {
    if (counts[pair] >= 2) {
      counts[pair] -= 2;
      if (canFormMelds([...counts])) return true;
      counts[pair] += 2;
    }
  }
  return false;
}

function winningInfo(hand, meldCount = 0) {
  if (isSevenPairs(hand, meldCount)) return { pattern: "七对", sevenPairs: true };
  if (isStandardWin(hand, meldCount)) return { pattern: "普通胡", sevenPairs: false };
  return null;
}

function isPureSuit(hand, melds = []) {
  const tiles = [...hand, ...melds.flatMap((meld) => Array(meld.count).fill(meld.tile))];
  return tiles.length > 0 && tiles.every((tile) => Math.floor(tile / 9) === Math.floor(tiles[0] / 9));
}

function winDetails(hand, melds = []) {
  const info = winningInfo(hand, melds.length);
  if (!info) return null;
  const pureSuit = isPureSuit(hand, melds);
  const hasKong = melds.some((meld) => meld.count === 4);
  let multiplier = 1;
  const bonuses = [];
  if (info.sevenPairs) {
    multiplier *= 2;
    bonuses.push("七对×2");
  }
  if (pureSuit) {
    multiplier *= 2;
    bonuses.push("清一色×2");
  }
  if (hasKong) {
    multiplier *= 2;
    bonuses.push("有杠×2");
  }
  return { ...info, pureSuit, hasKong, multiplier, bonuses };
}

function startGame(room) {
  const wall = shuffledWall();
  const hands = [[], [], [], []];
  for (let round = 0; round < 13; round += 1) {
    for (let seat = 0; seat < 4; seat += 1) hands[seat].push(wall.pop());
  }
  hands[room.nextStarterSeat].push(wall.pop());
  hands.forEach((hand) => hand.sort((a, b) => a - b));
  room.game = {
    wall,
    hands,
    discards: [],
    scores: room.scores,
    melds: [[], [], [], []],
    starterSeat: room.nextStarterSeat,
    turn: room.nextStarterSeat,
    phase: "discard",
    pendingAction: null,
    result: null,
  };
}

function tileCount(hand, tile) {
  return hand.reduce((count, value) => count + (value === tile ? 1 : 0), 0);
}

function removeTiles(hand, tile, amount) {
  for (let removed = 0; removed < amount; removed += 1) hand.splice(hand.indexOf(tile), 1);
}

function buildClaimQueue(room, tile, discarder) {
  const ronCandidates = [];
  const meldCandidates = [];
  for (let offset = 1; offset < 4; offset += 1) {
    const seat = (discarder + offset) % 4;
    const count = tileCount(room.game.hands[seat], tile);
    if (winningInfo([...room.game.hands[seat], tile], room.game.melds[seat].length)) {
      ronCandidates.push({ seat, canWin: true, canPong: false, canKong: false });
    }
    if (count >= 2) {
      meldCandidates.push({ seat, canWin: false, canPong: true, canKong: count >= 3 });
    }
  }
  return [...ronCandidates, ...meldCandidates];
}

function advanceTurn(room, previousSeat) {
  const nextSeat = (previousSeat + 1) % 4;
  const drawnTile = room.game.wall.pop();
  room.game.pendingAction = null;
  if (drawnTile === undefined) {
    room.game.phase = "ended";
    room.game.result = { type: "draw", message: "牌墙已摸完，本局流局。" };
    return;
  }
  room.game.hands[nextSeat].push(drawnTile);
  room.game.hands[nextSeat].sort((a, b) => a - b);
  room.game.turn = nextSeat;
  room.game.phase = "discard";
}

function finishRound(room, winnerSeat, type, discarderSeat = null) {
  const game = room.game;
  if (type === "ron") {
    const winningTile = game.pendingAction.tile;
    game.hands[winnerSeat].push(winningTile);
    game.hands[winnerSeat].sort((a, b) => a - b);
    game.discards.pop();
  }
  const details = winDetails(game.hands[winnerSeat], game.melds[winnerSeat]);
  const points = details.multiplier;
  if (type === "self-draw") {
    for (let seat = 0; seat < 4; seat += 1) {
      if (seat !== winnerSeat) {
        room.scores[seat] -= points;
        room.scores[winnerSeat] += points;
      }
    }
  } else {
    room.scores[discarderSeat] -= points;
    room.scores[winnerSeat] += points;
  }
  room.nextStarterSeat = winnerSeat;
  game.phase = "ended";
  game.pendingAction = null;
  game.result = {
    type,
    winnerSeat,
    discarderSeat,
    points,
    pattern: details.pattern,
    multiplier: details.multiplier,
    bonuses: details.bonuses,
  };
}

function privateGameState(room, player) {
  const game = room.game;
  const selfDraw = game.phase === "discard"
    && game.turn === player.seat
    && Boolean(winningInfo(game.hands[player.seat], game.melds[player.seat].length));
  const pendingOption = game.phase === "claim" ? game.pendingAction?.queue[game.pendingAction.queueIndex] : null;
  const isPendingPlayer = pendingOption?.seat === player.seat;
  const concealedKongTile = game.phase === "discard" && game.turn === player.seat
    ? game.hands[player.seat].find((tile) => tileCount(game.hands[player.seat], tile) === 4) ?? null
    : null;
  const supplementMeld = game.phase === "discard" && game.turn === player.seat
    ? game.melds[player.seat].find((meld) => meld.type === "pong" && tileCount(game.hands[player.seat], meld.tile) >= 1)
    : null;
  return {
    roomCode: room.code,
    selfSeat: player.seat,
    hand: game.hands[player.seat],
    wallCount: game.wall.length,
    discards: game.discards,
    turn: game.turn,
    starterSeat: game.starterSeat,
    canDiscard: game.phase === "discard" && game.turn === player.seat,
    actions: {
      canWin: selfDraw || Boolean(isPendingPlayer && pendingOption.canWin),
      canPong: Boolean(isPendingPlayer && pendingOption.canPong),
      canKong: Boolean(isPendingPlayer && pendingOption.canKong),
      canPass: Boolean(isPendingPlayer),
      winType: selfDraw ? "self-draw" : isPendingPlayer && pendingOption.canWin ? "ron" : null,
      concealedKongTile,
      supplementKongTile: supplementMeld?.tile ?? null,
    },
    result: game.result,
    isHost: room.hostId === player.id,
    players: room.players.map((roomPlayer) => ({
      id: roomPlayer.id,
      nickname: roomPlayer.nickname,
      seat: roomPlayer.seat,
      score: game.scores[roomPlayer.seat],
      tileCount: game.hands[roomPlayer.seat].length,
      melds: game.melds[roomPlayer.seat],
    })),
  };
}

function emitGame(room) {
  room.players.forEach((player) => io.to(player.id).emit("game-state", privateGameState(room, player)));
}

function emitRoom(room) {
  room.players.forEach((player) => io.to(player.id).emit("room-updated", publicRoom(room, player.id)));
}

function leaveCurrentRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;
  room.players = room.players.filter((player) => player.id !== socket.id);
  if (room.game) {
    room.game = null;
    io.to(code).emit("game-stopped", { message: "有玩家离开，牌局已停止，请等待四人重新到齐。" });
  }
  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) room.hostId = room.players[0].id;
  emitRoom(room);
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ nickname } = {}, reply = () => {}) => {
    const safeNickname = cleanNickname(nickname);
    if (!safeNickname) return reply({ ok: false, message: "请输入昵称。" });
    leaveCurrentRoom(socket);
    const code = createRoomCode();
    const room = {
      code,
      hostId: socket.id,
      players: [{ id: socket.id, nickname: safeNickname, seat: 0 }],
      scores: [0, 0, 0, 0],
      nextStarterSeat: 0,
      game: null,
    };
    rooms.set(code, room);
    socket.data.roomCode = code;
    socket.join(code);
    reply({ ok: true, room: publicRoom(room, socket.id) });
  });

  socket.on("join-room", ({ nickname, code } = {}, reply = () => {}) => {
    const safeNickname = cleanNickname(nickname);
    const safeCode = String(code || "").replace(/\D/g, "").slice(0, 6);
    if (!safeNickname) return reply({ ok: false, message: "请输入昵称。" });
    if (safeCode.length !== 6) return reply({ ok: false, message: "请输入六位房间号。" });
    const room = rooms.get(safeCode);
    if (!room) return reply({ ok: false, message: "没有找到这个房间。" });
    if (room.players.length >= 4) return reply({ ok: false, message: "房间已经满了。" });
    if (room.game) return reply({ ok: false, message: "牌局已经开始，暂时无法加入。" });
    leaveCurrentRoom(socket);
    const occupied = new Set(room.players.map((player) => player.seat));
    const seat = [0, 1, 2, 3].find((candidate) => !occupied.has(candidate));
    room.players.push({ id: socket.id, nickname: safeNickname, seat });
    socket.data.roomCode = safeCode;
    socket.join(safeCode);
    reply({ ok: true, room: publicRoom(room, socket.id) });
    emitRoom(room);
  });

  socket.on("start-game", (_payload = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return reply({ ok: false, message: "房间不存在。" });
    if (room.hostId !== socket.id) return reply({ ok: false, message: "只有房主可以开始游戏。" });
    if (room.players.length !== 4) return reply({ ok: false, message: "需要四位玩家到齐。" });
    if (room.game) return reply({ ok: false, message: "牌局已经开始。" });
    startGame(room);
    reply({ ok: true });
    emitGame(room);
  });

  socket.on("claim-win", (_payload = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room?.game) return reply({ ok: false, message: "牌局尚未开始。" });
    const player = room.players.find((item) => item.id === socket.id);
    if (!player) return reply({ ok: false, message: "你不在这个房间。" });
    const game = room.game;
    const canSelfDraw = game.phase === "discard"
      && game.turn === player.seat
      && Boolean(winningInfo(game.hands[player.seat], game.melds[player.seat].length));
    const pendingOption = game.phase === "claim" ? game.pendingAction?.queue[game.pendingAction.queueIndex] : null;
    const canRon = pendingOption?.seat === player.seat && pendingOption.canWin;
    if (!canSelfDraw && !canRon) return reply({ ok: false, message: "当前不能胡牌。" });
    if (canSelfDraw) finishRound(room, player.seat, "self-draw");
    else finishRound(room, player.seat, "ron", game.pendingAction.discarderSeat);
    reply({ ok: true });
    emitGame(room);
  });

  socket.on("pass-action", (_payload = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((item) => item.id === socket.id);
    const pending = room?.game?.pendingAction;
    const option = pending?.queue[pending.queueIndex];
    if (!room?.game || !player || room.game.phase !== "claim" || option?.seat !== player.seat) {
      return reply({ ok: false, message: "当前没有需要跳过的操作。" });
    }
    const nextQueueIndex = pending.queueIndex + 1;
    if (nextQueueIndex < pending.queue.length) {
      pending.queueIndex = nextQueueIndex;
    } else {
      advanceTurn(room, pending.discarderSeat);
    }
    reply({ ok: true });
    emitGame(room);
  });

  function claimMeld(socket, type, reply) {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((item) => item.id === socket.id);
    const pending = room?.game?.pendingAction;
    const option = pending?.queue[pending.queueIndex];
    const isKong = type === "exposed-kong";
    const allowed = isKong ? option?.canKong : option?.canPong;
    if (!room?.game || !player || room.game.phase !== "claim" || option?.seat !== player.seat || !allowed) {
      return reply({ ok: false, message: `当前不能${isKong ? "杠" : "碰"}。` });
    }
    const amount = isKong ? 3 : 2;
    removeTiles(room.game.hands[player.seat], pending.tile, amount);
    room.game.discards.pop();
    room.game.melds[player.seat].push({
      type,
      tile: pending.tile,
      count: amount + 1,
      sourceSeat: pending.discarderSeat,
    });
    room.game.turn = player.seat;
    room.game.phase = "discard";
    room.game.pendingAction = null;
    if (isKong) {
      room.scores[pending.discarderSeat] -= 1;
      room.scores[player.seat] += 1;
      const replacement = room.game.wall.pop();
      if (replacement === undefined) {
        room.game.phase = "ended";
        room.game.result = { type: "draw", message: "牌墙已摸完，本局流局。" };
      } else {
        room.game.hands[player.seat].push(replacement);
        room.game.hands[player.seat].sort((a, b) => a - b);
      }
    }
    reply({ ok: true });
    emitGame(room);
  }

  socket.on("claim-pong", (_payload = {}, reply = () => {}) => claimMeld(socket, "pong", reply));
  socket.on("claim-kong", (_payload = {}, reply = () => {}) => claimMeld(socket, "exposed-kong", reply));

  socket.on("concealed-kong", ({ tile } = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((item) => item.id === socket.id);
    if (!room?.game || !player || room.game.phase !== "discard" || room.game.turn !== player.seat
      || !Number.isInteger(tile) || tileCount(room.game.hands[player.seat], tile) !== 4) {
      return reply({ ok: false, message: "当前不能暗杠。" });
    }
    removeTiles(room.game.hands[player.seat], tile, 4);
    room.game.melds[player.seat].push({ type: "concealed-kong", tile, count: 4, sourceSeat: null });
    for (let seat = 0; seat < 4; seat += 1) {
      if (seat !== player.seat) {
        room.scores[seat] -= 1;
        room.scores[player.seat] += 1;
      }
    }
    const replacement = room.game.wall.pop();
    if (replacement === undefined) {
      room.game.phase = "ended";
      room.game.result = { type: "draw", message: "牌墙已摸完，本局流局。" };
    } else {
      room.game.hands[player.seat].push(replacement);
      room.game.hands[player.seat].sort((a, b) => a - b);
    }
    reply({ ok: true });
    emitGame(room);
  });

  socket.on("supplement-kong", ({ tile } = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((item) => item.id === socket.id);
    const meld = player && room?.game?.melds[player.seat].find((item) => item.type === "pong" && item.tile === tile);
    if (!room?.game || !player || room.game.phase !== "discard" || room.game.turn !== player.seat
      || !meld || tileCount(room.game.hands[player.seat], tile) < 1) {
      return reply({ ok: false, message: "当前不能补杠。" });
    }
    removeTiles(room.game.hands[player.seat], tile, 1);
    meld.type = "supplement-kong";
    meld.count = 4;
    room.scores[meld.sourceSeat] -= 1;
    room.scores[player.seat] += 1;
    const replacement = room.game.wall.pop();
    if (replacement === undefined) {
      room.game.phase = "ended";
      room.game.result = { type: "draw", message: "牌墙已摸完，本局流局。" };
    } else {
      room.game.hands[player.seat].push(replacement);
      room.game.hands[player.seat].sort((a, b) => a - b);
    }
    reply({ ok: true });
    emitGame(room);
  });

  socket.on("next-round", (_payload = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return reply({ ok: false, message: "房间不存在。" });
    if (room.hostId !== socket.id) return reply({ ok: false, message: "只有房主可以开始下一局。" });
    if (room.players.length !== 4) return reply({ ok: false, message: "需要四位玩家到齐。" });
    if (room.game?.phase !== "ended") return reply({ ok: false, message: "本局尚未结束。" });
    startGame(room);
    reply({ ok: true });
    emitGame(room);
  });

  socket.on("discard-tile", ({ index } = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room?.game) return reply({ ok: false, message: "牌局尚未开始。" });
    const player = room.players.find((item) => item.id === socket.id);
    if (!player || room.game.turn !== player.seat || room.game.phase !== "discard") {
      return reply({ ok: false, message: "还没有轮到你出牌。" });
    }
    if (!Number.isInteger(index) || index < 0 || index >= room.game.hands[player.seat].length) {
      return reply({ ok: false, message: "这张牌无法打出。" });
    }
    const [tile] = room.game.hands[player.seat].splice(index, 1);
    room.game.discards.push({ tile, seat: player.seat });
    const claimQueue = buildClaimQueue(room, tile, player.seat);
    if (claimQueue.length > 0) {
      room.game.phase = "claim";
      room.game.pendingAction = {
        tile,
        discarderSeat: player.seat,
        queue: claimQueue,
        queueIndex: 0,
      };
    } else {
      advanceTurn(room, player.seat);
    }
    reply({ ok: true });
    emitGame(room);
  });

  socket.on("leave-room", () => leaveCurrentRoom(socket));
  socket.on("disconnect", () => leaveCurrentRoom(socket));
});

if (require.main === module) {
  server.listen(port, "0.0.0.0", () => {
    console.log(`Qingque Mahjong server listening on http://localhost:${port}`);
  });
}

module.exports = { buildClaimQueue, finishRound, isSevenPairs, isStandardWin, winningInfo, winDetails };
