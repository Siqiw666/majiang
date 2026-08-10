const TILE_NAMES = [
  "1万", "2万", "3万", "4万", "5万", "6万", "7万", "8万", "9万",
  "1筒", "2筒", "3筒", "4筒", "5筒", "6筒", "7筒", "8筒", "9筒",
  "1条", "2条", "3条", "4条", "5条", "6条", "7条", "8条", "9条",
  "东", "南", "西", "北", "中", "发", "白",
];

const state = {
  wall: [],
  hands: [[], [], [], []],
  discards: [],
  canDiscard: false,
  finished: false,
  drawnTile: null,
};

const handElement = document.querySelector("#hand");
const discardElement = document.querySelector("#discards");
const statusElement = document.querySelector("#status");
const wallCountElement = document.querySelector("#wall-count");
const resultElement = document.querySelector("#result");

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function tileSuit(tile) {
  return tile < 9 ? "m" : tile < 18 ? "p" : tile < 27 ? "s" : "z";
}

function createTile(tile, compact = false) {
  const element = document.createElement("span");
  element.className = `tile${compact ? " compact" : ""}`;
  element.dataset.suit = tileSuit(tile);
  element.textContent = TILE_NAMES[tile];
  return element;
}

function render() {
  wallCountElement.textContent = `牌墙 ${state.wall.length}`;
  handElement.replaceChildren();

  state.hands[0].forEach((tile, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tile${tile === state.drawnTile && index === state.hands[0].lastIndexOf(tile) ? " drawn" : ""}`;
    button.dataset.suit = tileSuit(tile);
    button.textContent = TILE_NAMES[tile];
    button.disabled = !state.canDiscard;
    button.setAttribute("aria-label", `打出${TILE_NAMES[tile]}`);
    button.addEventListener("click", () => discardHumanTile(index));
    handElement.append(button);
  });

  discardElement.replaceChildren(...state.discards.slice(-36).map((tile) => createTile(tile, true)));

  for (let player = 1; player < 4; player += 1) {
    const backs = Array.from({ length: state.hands[player].length }, () => {
      const tile = document.createElement("span");
      tile.className = "tile-back";
      return tile;
    });
    document.querySelector(`#player-${player}`).replaceChildren(...backs);
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

  const suitEnd = first < 9 ? 9 : first < 18 ? 18 : first < 27 ? 27 : 0;
  if (suitEnd && first + 2 < suitEnd && counts[first + 1] && counts[first + 2]) {
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

function isWinningHand(hand) {
  if (hand.length !== 14) return false;
  const counts = Array(34).fill(0);
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

function finish(title, message) {
  state.finished = true;
  state.canDiscard = false;
  document.querySelector("#result-title").textContent = title;
  document.querySelector("#result-message").textContent = message;
  resultElement.hidden = false;
  render();
}

function discardHumanTile(index) {
  if (!state.canDiscard || state.finished) return;
  state.canDiscard = false;
  state.discards.push(state.hands[0].splice(index, 1)[0]);
  state.drawnTile = null;
  statusElement.textContent = "电脑玩家正在出牌…";
  render();
  window.setTimeout(() => playBots(1), 450);
}

function playBots(player) {
  if (state.finished) return;
  if (player > 3) {
    startHumanTurn();
    return;
  }

  const tile = draw(player);
  if (tile === null) {
    finish("流局", "牌墙已经摸完，再来一局吧。");
    return;
  }
  if (isWinningHand(state.hands[player])) {
    finish("惜败", `${["", "西家", "北家", "东家"][player]}自摸和牌。`);
    return;
  }

  const discardIndex = Math.floor(Math.random() * state.hands[player].length);
  state.discards.push(state.hands[player].splice(discardIndex, 1)[0]);
  render();
  window.setTimeout(() => playBots(player + 1), 360);
}

function startHumanTurn() {
  const tile = draw(0);
  if (tile === null) {
    finish("流局", "牌墙已经摸完，再来一局吧。");
    return;
  }
  state.drawnTile = tile;
  if (isWinningHand(state.hands[0])) {
    finish("自摸和牌", "漂亮！你凑齐了四组牌和一对将。");
    return;
  }
  state.canDiscard = true;
  statusElement.textContent = `你摸到了 ${TILE_NAMES[tile]}`;
  render();
}

function newGame() {
  state.wall = shuffle(Array.from({ length: 136 }, (_, index) => Math.floor(index / 4)));
  state.hands = [[], [], [], []];
  state.discards = [];
  state.finished = false;
  state.canDiscard = false;
  state.drawnTile = null;
  resultElement.hidden = true;

  for (let round = 0; round < 13; round += 1) {
    for (let player = 0; player < 4; player += 1) draw(player);
  }
  statusElement.textContent = "开局，轮到你摸牌";
  startHumanTurn();
}

document.querySelector("#new-game").addEventListener("click", newGame);
document.querySelector("#play-again").addEventListener("click", newGame);
newGame();
