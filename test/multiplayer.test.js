const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { after, before, test } = require("node:test");
const { io } = require("socket.io-client");
const {
  buildClaimQueue,
  finishRound,
  isSevenPairs,
  isStandardWin,
  winDetails,
  winningInfo,
} = require("../server/server");

const port = 32000 + Math.floor(Math.random() * 1000);
const serverUrl = `http://127.0.0.1:${port}`;
let serverProcess;
const clients = [];

function waitForServer(process) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("服务器启动超时")), 5000);
    process.stdout.on("data", (data) => {
      if (data.toString().includes("Qingque Mahjong server listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    process.stderr.on("data", (data) => reject(new Error(data.toString())));
    process.once("exit", (code) => {
      if (code && code !== 0) reject(new Error(`服务器异常退出：${code}`));
    });
  });
}

function connectClient() {
  return new Promise((resolve, reject) => {
    const client = io(serverUrl, { transports: ["websocket"], forceNew: true });
    client.once("connect", () => {
      clients.push(client);
      resolve(client);
    });
    client.once("connect_error", reject);
  });
}

function emitAck(client, event, payload = {}) {
  return new Promise((resolve) => client.emit(event, payload, resolve));
}

function nextEvent(client, event) {
  return new Promise((resolve) => client.once(event, resolve));
}

before(async () => {
  serverProcess = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(serverProcess);
});

after(() => {
  clients.forEach((client) => client.close());
  if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGTERM");
});

test("四人可以加入、开局并完成一轮出牌", async () => {
  const players = await Promise.all([0, 1, 2, 3, 4].map(() => connectClient()));
  const created = await emitAck(players[0], "create-room", { nickname: "玩家一" });
  assert.equal(created.ok, true);
  assert.match(created.room.code, /^\d{6}$/);
  const roomCode = created.room.code;

  for (let index = 1; index < 4; index += 1) {
    const joined = await emitAck(players[index], "join-room", { nickname: `玩家${index + 1}`, code: roomCode });
    assert.equal(joined.ok, true);
    assert.equal(joined.room.players.length, index + 1);
    assert.equal(joined.room.selfId, players[index].id);
  }

  const rejected = await emitAck(players[4], "join-room", { nickname: "第五人", code: roomCode });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.message, "房间已经满了。");

  const nonHostStart = await emitAck(players[1], "start-game");
  assert.equal(nonHostStart.ok, false);
  assert.equal(nonHostStart.message, "只有房主可以开始游戏。");

  const initialEvents = players.slice(0, 4).map((client) => nextEvent(client, "game-state"));
  const started = await emitAck(players[0], "start-game");
  assert.equal(started.ok, true);
  let states = await Promise.all(initialEvents);

  states.forEach((state, seat) => {
    assert.equal(state.selfSeat, seat);
    assert.equal(state.turn, 0);
    assert.equal(state.starterSeat, 0);
    assert.equal(state.wallCount, 55);
    assert.equal(state.hand.length, seat === 0 ? 14 : 13);
    assert.equal(state.players.length, 4);
    assert.equal("hands" in state, false, "客户端不能收到其他玩家的手牌数组");
    assert.equal(state.canDiscard, seat === 0);
  });

  const illegalDiscard = await emitAck(players[1], "discard-tile", { index: 0 });
  assert.equal(illegalDiscard.ok, false);
  assert.equal(illegalDiscard.message, "还没有轮到你出牌。");

  for (let seat = 0; seat < 4; seat += 1) {
    let stateEvents = players.slice(0, 4).map((client) => nextEvent(client, "game-state"));
    const discarded = await emitAck(players[seat], "discard-tile", { index: 0 });
    assert.equal(discarded.ok, true);
    states = await Promise.all(stateEvents);
    let claimantSeat = states.findIndex((state) => state.actions.canPass);
    while (claimantSeat !== -1) {
      stateEvents = players.slice(0, 4).map((client) => nextEvent(client, "game-state"));
      const passed = await emitAck(players[claimantSeat], "pass-action");
      assert.equal(passed.ok, true);
      states = await Promise.all(stateEvents);
      claimantSeat = states.findIndex((state) => state.actions.canPass);
    }
    const nextSeat = (seat + 1) % 4;
    states.forEach((state, viewerSeat) => {
      assert.equal(state.turn, nextSeat);
      assert.equal(state.discards.length, seat + 1);
      assert.equal(state.canDiscard, viewerSeat === nextSeat);
    });
  }

  assert.equal(states[0].wallCount, 51);
  assert.equal(states[0].discards.length, 4);
  assert.equal(states[0].turn, 0);

  const exposedServerFile = await fetch(`${serverUrl}/server/server.js`);
  assert.equal(exposedServerFile.status, 404);
});

test("普通胡牌与七对牌型判断正确", () => {
  const standardHand = [0, 1, 2, 3, 4, 5, 8, 8, 9, 10, 11, 18, 19, 20];
  const sevenPairs = [0, 0, 1, 1, 2, 2, 9, 9, 10, 10, 18, 18, 26, 26];
  const sevenPairsWithQuad = [0, 0, 0, 0, 1, 1, 2, 2, 9, 9, 10, 10, 18, 18];
  const incomplete = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7];

  assert.equal(isStandardWin(standardHand), true);
  assert.equal(winningInfo(standardHand).pattern, "普通胡");
  assert.equal(isSevenPairs(sevenPairs), true);
  assert.equal(winningInfo(sevenPairs).pattern, "七对");
  assert.equal(isSevenPairs(sevenPairsWithQuad), true, "四张相同牌应按两个对子计算");
  assert.equal(winningInfo(incomplete), null);
});

test("七对与清一色翻倍可以叠加", () => {
  const pureSevenPairs = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  const details = winDetails(pureSevenPairs);
  assert.equal(details.pattern, "七对");
  assert.equal(details.sevenPairs, true);
  assert.equal(details.pureSuit, true);
  assert.equal(details.multiplier, 4);
  assert.deepEqual(details.bonuses, ["七对×2", "清一色×2"]);
});

test("有副露时按剩余手牌胡牌，有杠再翻倍", () => {
  const hand = [1, 2, 3, 4, 5, 6, 9, 10, 11, 18, 18];
  const melds = [{ type: "supplement-kong", tile: 0, count: 4, sourceSeat: 3 }];
  const details = winDetails(hand, melds);
  assert.equal(details.pattern, "普通胡");
  assert.equal(details.hasKong, true);
  assert.equal(details.multiplier, 2);
  assert.deepEqual(details.bonuses, ["有杠×2"]);
});

test("点炮胡牌的响应优先于碰杠，碰杠按座次顺序响应", () => {
  const room = {
    game: {
      hands: [
        [],
        [0, 0, 1, 1, 2, 2, 9, 9, 10, 10, 18, 18, 26],
        [26, 26, 26, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        [26, 26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      ],
      melds: [[], [], [], []],
    },
  };
  const queue = buildClaimQueue(room, 26, 0);
  assert.deepEqual(queue, [
    { seat: 1, canWin: true, canPong: false, canKong: false },
    { seat: 2, canWin: false, canPong: true, canKong: true },
    { seat: 3, canWin: false, canPong: true, canKong: false },
  ]);
});

test("点炮和自摸结算后由胜者下一局先出", () => {
  const ronRoom = {
    scores: [0, 0, 0, 0],
    nextStarterSeat: 0,
    game: {
      hands: [[], [0, 0, 1, 1, 2, 2, 9, 9, 10, 10, 18, 18, 26], [], []],
      melds: [[], [], [], []],
      discards: [{ tile: 26, seat: 0 }],
      pendingAction: { tile: 26 },
    },
  };
  finishRound(ronRoom, 1, "ron", 0);
  assert.deepEqual(ronRoom.scores, [-2, 2, 0, 0]);
  assert.equal(ronRoom.nextStarterSeat, 1);
  assert.equal(ronRoom.game.result.pattern, "七对");

  const selfDrawRoom = {
    scores: [0, 0, 0, 0],
    nextStarterSeat: 0,
    game: {
      hands: [[], [], [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6], []],
      melds: [[], [], [], []],
      discards: [],
      pendingAction: null,
    },
  };
  finishRound(selfDrawRoom, 2, "self-draw");
  assert.deepEqual(selfDrawRoom.scores, [-4, -4, 12, -4]);
  assert.equal(selfDrawRoom.nextStarterSeat, 2);
  assert.equal(selfDrawRoom.game.result.multiplier, 4);
});
