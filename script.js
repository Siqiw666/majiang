const TILE_LABELS = [
  "一万", "二万", "三万", "四万", "五万", "六万", "七万", "八万", "九万",
  "一筒", "二筒", "三筒", "四筒", "五筒", "六筒", "七筒", "八筒", "九筒",
  "一条", "二条", "三条", "四条", "五条", "六条", "七条", "八条", "九条",
];

const TILE_IMAGES = Array.from({ length: 27 }, (_, tile) => {
  const suit = tile < 9 ? "Man" : tile < 18 ? "Pin" : "Sou";
  return `assets/tiles/${suit}${(tile % 9) + 1}.svg`;
});

const state = {
  wall: [], hands: [[], [], [], []], melds: [[], [], [], []], discards: [],
  canDiscard: false, finished: false, drawnTile: null, pendingClaim: null,
  concealedKongTile: null, selectedIndex: null, scores: [0, 0, 0, 0],
};

const handElement = document.querySelector("#hand");
const meldsElement = document.querySelector("#melds");
const discardElement = document.querySelector("#discards");
const statusElement = document.querySelector("#status");
const wallCountElement = document.querySelector("#wall-count");
const resultElement = document.querySelector("#result");
const claimActions = document.querySelector("#claim-actions");
const selfActions = document.querySelector("#self-actions");

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function createTile(tile, compact = false) {
  const element = document.createElement("img");
  element.className = `tile${compact ? " compact" : ""}`;
  element.src = TILE_IMAGES[tile];
  element.alt = TILE_LABELS[tile];
  element.draggable = false;
  return element;
}

function tileCount(hand, tile) {
  return hand.reduce((count, item) => count + (item === tile ? 1 : 0), 0);
}

function removeTiles(hand, tile, amount) {
  for (let removed = 0; removed < amount; removed += 1) hand.splice(hand.indexOf(tile), 1);
}

function render() {
  wallCountElement.textContent = `牌墙 ${state.wall.length}`;
  state.scores.forEach((score, player) => {
    document.querySelector(`#score-${player}`).textContent = `${score} 分`;
  });
  handElement.replaceChildren();
  state.hands[0].forEach((tile, index) => {
    const button = document.createElement("button");
    button.type = "button";
    const isDrawn = tile === state.drawnTile && index === state.hands[0].lastIndexOf(tile);
    button.className = `tile${isDrawn ? " drawn" : ""}${index === state.selectedIndex ? " selected" : ""}`;
    button.disabled = !state.canDiscard;
    button.setAttribute("aria-label", `打出${TILE_LABELS[tile]}`);
    const artwork = createTile(tile);
    artwork.className = "tile-art";
    button.append(artwork);
    button.addEventListener("click", () => selectHumanTile(index));
    handElement.append(button);
  });

  const meldNodes = state.melds[0].map((meld) => {
    const group = document.createElement("div");
    group.className = "meld";
    group.setAttribute("aria-label", `${meld.type}${TILE_LABELS[meld.tile]}`);
    const label = document.createElement("span");
    label.className = "meld-label";
    label.textContent = meld.type === "杠" ? "明杠" : meld.type;
    group.replaceChildren(label, ...Array.from({ length: meld.count }, () => createTile(meld.tile)));
    return group;
  });
  meldsElement.replaceChildren(...meldNodes);
  discardElement.replaceChildren(...state.discards.slice(-36).map((tile) => createTile(tile, true)));

  for (let player = 1; player < 4; player += 1) {
    const backs = Array.from({ length: state.hands[player].length }, () => {
      const tile = document.createElement("span");
      tile.className = "tile-back";
      tile.setAttribute("aria-label", "背面朝上的牌");
      return tile;
    });
    document.querySelector(`#player-${player}`).replaceChildren(...backs);
  }

  claimActions.hidden = !state.pendingClaim;
  document.querySelector("#win").hidden = !state.pendingClaim?.canWin;
  document.querySelector("#pong").hidden = !state.pendingClaim?.canPong;
  document.querySelector("#kong").hidden = !state.pendingClaim?.canKong;
  const canConcealedKong = state.concealedKongTile !== null && state.canDiscard;
  const canConfirmDiscard = state.selectedIndex !== null && state.canDiscard;
  selfActions.hidden = !canConcealedKong && !canConfirmDiscard;
  document.querySelector("#concealed-kong").hidden = !canConcealedKong;
  document.querySelector("#confirm-discard").hidden = !canConfirmDiscard;
  if (state.concealedKongTile !== null) {
    document.querySelector("#concealed-kong").textContent = `暗杠 ${TILE_LABELS[state.concealedKongTile]}`;
  }
}

function draw(player) {
  const tile = state.wall.pop();
  if (tile === undefined) return null;
  state.hands[player].push(tile);
  state.hands[player].sort((a, b) => a - b);
  return tile;
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
    counts[first] -= 1; counts[first + 1] -= 1; counts[first + 2] -= 1;
    if (canFormMelds(counts)) return true;
    counts[first] += 1; counts[first + 1] += 1; counts[first + 2] += 1;
  }
  return false;
}

function isWinningHand(hand, meldCount = 0) {
  const neededMelds = 4 - meldCount;
  if (hand.length !== neededMelds * 3 + 2) return false;
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

function transferScore(from, to, amount) {
  state.scores[from] -= amount;
  state.scores[to] += amount;
}

function isPureSuit(player) {
  const tiles = [
    ...state.hands[player],
    ...state.melds[player].flatMap((meld) => Array(meld.count).fill(meld.tile)),
  ];
  return tiles.length > 0 && tiles.every((tile) => Math.floor(tile / 9) === Math.floor(tiles[0] / 9));
}

function winMultiplier(player) {
  let multiplier = 1;
  if (state.melds[player].some((meld) => meld.count === 4)) multiplier *= 2;
  if (isPureSuit(player)) multiplier *= 2;
  return multiplier;
}

function multiplierText(player) {
  const reasons = [];
  if (state.melds[player].some((meld) => meld.count === 4)) reasons.push("有杠×2");
  if (isPureSuit(player)) reasons.push("清一色×2");
  return reasons.length ? `（${reasons.join("、")}）` : "";
}

function scoreRon(winner, discarder) {
  const points = winMultiplier(winner);
  transferScore(discarder, winner, points);
  return points;
}

function scoreSelfDraw(winner) {
  const points = winMultiplier(winner);
  for (let player = 0; player < 4; player += 1) {
    if (player !== winner) transferScore(player, winner, points);
  }
  return points;
}

function finish(title, message) {
  state.finished = true; state.canDiscard = false; state.pendingClaim = null; state.selectedIndex = null;
  document.querySelector("#result-title").textContent = title;
  document.querySelector("#result-message").textContent = message;
  resultElement.hidden = false;
  render();
}

function selectHumanTile(index) {
  if (!state.canDiscard || state.finished) return;
  state.selectedIndex = index;
  statusElement.textContent = `已选择 ${TILE_LABELS[state.hands[0][index]]}，请确认打出`;
  render();
}

function confirmDiscard() {
  if (state.selectedIndex === null) return;
  discardHumanTile(state.selectedIndex);
}

function botDelay() {
  return 1000 + Math.floor(Math.random() * 4001);
}

function discardHumanTile(index) {
  if (!state.canDiscard || state.finished) return;
  state.canDiscard = false; state.concealedKongTile = null; state.selectedIndex = null;
  const discarded = state.hands[0].splice(index, 1)[0];
  state.discards.push(discarded);
  state.drawnTile = null;
  statusElement.textContent = "电脑玩家正在出牌…";
  render();
  window.setTimeout(() => {
    const winner = findBotRon(discarded, 0);
    if (winner !== null) {
      const points = scoreRon(winner, 0);
      finish("点炮", `你打出的 ${TILE_LABELS[discarded]} 被${playerName(winner)}荣和，你支付 ${points} 分${multiplierText(winner)}。`);
      return;
    }
    playBots(1);
  }, botDelay());
}

function offerClaim(tile, nextPlayer, sourcePlayer) {
  const count = tileCount(state.hands[0], tile);
  const canWin = isWinningHand([...state.hands[0], tile], state.melds[0].length);
  if (count < 2 && !canWin) return false;
  state.pendingClaim = { tile, nextPlayer, sourcePlayer, canWin, canPong: count >= 2, canKong: count >= 3 };
  statusElement.textContent = `有人打出 ${TILE_LABELS[tile]}，请选择操作`;
  render();
  return true;
}

function playerName(player) {
  return ["你", "西家", "北家", "东家"][player];
}

function findBotRon(tile, discarder) {
  for (let offset = 1; offset < 4; offset += 1) {
    const player = (discarder + offset) % 4;
    if (player !== 0 && isWinningHand([...state.hands[player], tile], state.melds[player].length)) return player;
  }
  return null;
}

function claimWin() {
  const pending = state.pendingClaim;
  if (!pending?.canWin) return;
  state.hands[0].push(pending.tile);
  state.hands[0].sort((a, b) => a - b);
  state.discards.pop();
  state.pendingClaim = null;
  const points = scoreRon(0, pending.sourcePlayer);
  finish("荣和", `你接到 ${TILE_LABELS[pending.tile]} 和牌，获得 ${points} 分${multiplierText(0)}！`);
}

function claim(type) {
  const pending = state.pendingClaim;
  if (!pending) return;
  const amount = type === "杠" ? 3 : 2;
  removeTiles(state.hands[0], pending.tile, amount);
  state.discards.pop();
  state.melds[0].push({ type, tile: pending.tile, count: amount + 1 });
  state.pendingClaim = null;
  if (type === "杠") {
    transferScore(pending.sourcePlayer, 0, 1);
    const replacement = draw(0);
    if (replacement === null) return finish("流局", "牌墙已经摸完，再来一局吧。");
    state.drawnTile = replacement;
    if (isWinningHand(state.hands[0], state.melds[0].length)) {
      const points = scoreSelfDraw(0);
      return finish("杠上开花", `补牌后自摸和牌，每家支付 ${points} 分${multiplierText(0)}！`);
    }
  }
  state.canDiscard = true;
  state.selectedIndex = null;
  statusElement.textContent = `${type}！请选择一张牌打出`;
  findConcealedKong();
  render();
}

function skipClaim() {
  if (!state.pendingClaim) return;
  const nextPlayer = state.pendingClaim.nextPlayer;
  state.pendingClaim = null;
  statusElement.textContent = "电脑玩家正在出牌…";
  render();
  window.setTimeout(() => playBots(nextPlayer), botDelay());
}

function playBots(player) {
  if (state.finished) return;
  if (player > 3) return startHumanTurn();
  const tile = draw(player);
  if (tile === null) return finish("流局", "牌墙已经摸完，再来一局吧。");
  if (isWinningHand(state.hands[player], state.melds[player].length)) {
    const points = scoreSelfDraw(player);
    return finish("惜败", `${playerName(player)}自摸和牌，每家支付 ${points} 分${multiplierText(player)}。`);
  }
  const discardIndex = Math.floor(Math.random() * state.hands[player].length);
  const discarded = state.hands[player].splice(discardIndex, 1)[0];
  state.discards.push(discarded);
  statusElement.textContent = `${playerName(player)}打出 ${TILE_LABELS[discarded]}`;
  render();
  const nextPlayer = player + 1;
  const humanCanWin = isWinningHand([...state.hands[0], discarded], state.melds[0].length);
  if (humanCanWin) {
    offerClaim(discarded, nextPlayer, player);
    return;
  }
  const winner = findBotRon(discarded, player);
  if (winner !== null) {
    window.setTimeout(() => {
      const points = scoreRon(winner, player);
      finish("荣和", `${playerName(winner)}接到${playerName(player)}打出的 ${TILE_LABELS[discarded]} 和牌，获得 ${points} 分${multiplierText(winner)}。`);
    }, 650);
    return;
  }
  if (offerClaim(discarded, nextPlayer, player)) return;
  window.setTimeout(() => playBots(nextPlayer), botDelay());
}

function findConcealedKong() {
  state.concealedKongTile = null;
  for (let tile = 0; tile < 27; tile += 1) {
    if (tileCount(state.hands[0], tile) === 4) {
      state.concealedKongTile = tile;
      break;
    }
  }
}

function concealedKong() {
  const tile = state.concealedKongTile;
  if (tile === null || !state.canDiscard) return;
  state.selectedIndex = null;
  removeTiles(state.hands[0], tile, 4);
  state.melds[0].push({ type: "暗杠", tile, count: 4 });
  for (let player = 1; player < 4; player += 1) transferScore(player, 0, 1);
  state.concealedKongTile = null;
  const replacement = draw(0);
  if (replacement === null) return finish("流局", "牌墙已经摸完，再来一局吧。");
  state.drawnTile = replacement;
  if (isWinningHand(state.hands[0], state.melds[0].length)) {
    const points = scoreSelfDraw(0);
    return finish("杠上开花", `暗杠补牌后自摸，每家支付 ${points} 分${multiplierText(0)}！`);
  }
  statusElement.textContent = `暗杠成功，补到 ${TILE_LABELS[replacement]}`;
  findConcealedKong();
  render();
}

function startHumanTurn() {
  const tile = draw(0);
  if (tile === null) return finish("流局", "牌墙已经摸完，再来一局吧。");
  state.drawnTile = tile;
  if (isWinningHand(state.hands[0], state.melds[0].length)) {
    const points = scoreSelfDraw(0);
    return finish("自摸和牌", `每家支付 ${points} 分${multiplierText(0)}！`);
  }
  state.canDiscard = true;
  state.selectedIndex = null;
  statusElement.textContent = `你摸到了 ${TILE_LABELS[tile]}`;
  findConcealedKong();
  render();
}

function newGame() {
  state.wall = shuffle(Array.from({ length: 108 }, (_, index) => Math.floor(index / 4)));
  state.hands = [[], [], [], []]; state.melds = [[], [], [], []]; state.discards = [];
  state.finished = false; state.canDiscard = false; state.drawnTile = null;
  state.pendingClaim = null; state.concealedKongTile = null; state.selectedIndex = null; resultElement.hidden = true;
  for (let round = 0; round < 13; round += 1) for (let player = 0; player < 4; player += 1) draw(player);
  statusElement.textContent = "开局，轮到你摸牌";
  startHumanTurn();
}

function resetScores() {
  state.scores = [0, 0, 0, 0];
  render();
}

function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

async function enterFullscreen() {
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  const message = document.querySelector("#fullscreen-message");

  if (!request) {
    message.textContent = "当前浏览器不支持网页全屏，请手动横屏或将网页添加到主屏幕";
    return;
  }

  try {
    await request.call(root);
    if (screen.orientation?.lock) {
      try {
        await screen.orientation.lock("landscape");
      } catch {
        message.textContent = "已进入全屏，请手动将手机旋转为横屏";
      }
    }
  } catch {
    message.textContent = "全屏请求未成功，请再次点击或手动旋转手机";
  }
}

async function toggleFullscreen() {
  if (!isFullscreen()) {
    await enterFullscreen();
    return;
  }
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (exit) await exit.call(document);
}

function updateFullscreenButton() {
  document.querySelector("#fullscreen-toggle").textContent = isFullscreen() ? "退出全屏" : "全屏";
}

document.querySelector("#new-game").addEventListener("click", newGame);
document.querySelector("#reset-scores").addEventListener("click", resetScores);
document.querySelector("#start-fullscreen").addEventListener("click", enterFullscreen);
document.querySelector("#fullscreen-toggle").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
document.querySelector("#play-again").addEventListener("click", newGame);
document.querySelector("#win").addEventListener("click", claimWin);
document.querySelector("#pong").addEventListener("click", () => claim("碰"));
document.querySelector("#kong").addEventListener("click", () => claim("杠"));
document.querySelector("#skip").addEventListener("click", skipClaim);
document.querySelector("#concealed-kong").addEventListener("click", concealedKong);
document.querySelector("#confirm-discard").addEventListener("click", confirmDiscard);
newGame();
