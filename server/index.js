import express from "express";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: true } });

const PORT = Number(process.env.PORT || 3001);
const ROOM_SIZE = 6;
const INITIAL_FOLLOWERS = 1000;
const DECK_SIZE = 80;
const HAND_SIZE = 5;
const CPU_TURN_DELAY_MS = 2700;
const MAX_MOTIVATION = 3;
const HAND_LIMIT = 7;
const COLORS = ["#ff5a5f", "#00a6ed", "#f5b700", "#7bc950", "#a855f7"];
const ROLES = ["炎上系", "アイドル", "知識系", "インスタグラマー", "エンタメ系", "レビュー系"];
const rooms = new Map();

// v0.3 カードプール（17種・126枚）
const CARD_DEFS = {
  daily_stream: {
    name: "毎日配信",
    text: "サイコロの目×1000フォロワー獲得。使っても手札からなくならない。",
    target: "none",
    cost: 1
  },
  day_off: {
    name: "配信おやすみ",
    text: "デッキから2枚ドローする。",
    target: "none",
    cost: 1
  },
  collab_stream: {
    name: "コラボ配信",
    text: "対象と自分のフォロワー+10万人。",
    target: "opponent",
    cost: 2
  },
  impersonate: {
    name: "なりすまし",
    text: "対象と同数のフォロワーになる。1/2で自分が炎上。(炎上=毎ターン開始時に半減)",
    target: "opponent",
    cost: 3
  },
  big_announcement: {
    name: "重大なお知らせ",
    text: "1/2でフォロワー×1000。1/2でフォロワー÷1000。",
    target: "self",
    cost: 3
  },
  emergency_video: {
    name: "緊急で動画を回す",
    text: "フォロワー獲得+10%。(永続・重複可)",
    target: "none",
    cost: 1
  },
  expose: {
    name: "暴露",
    text: "対象のフォロワーを半減させる。",
    target: "opponent",
    cost: 3
  },
  scandal: {
    name: "炎上",
    text: "対象を炎上状態にする。(炎上=毎ターン開始時に半減)",
    target: "opponent",
    cost: 3
  },
  apology: {
    name: "謝罪",
    text: "自分の炎上を回復。サイコロの目×1000フォロワー獲得。",
    target: "self",
    cost: 1
  },
  shield: {
    name: "鍵垢にする",
    text: "次に受ける攻撃カード1回を無効化。3ターン持続。",
    target: "self",
    cost: 1
  },
  kusomaro: {
    name: "くそマロ",
    text: "相手の手札をランダムで3枚くそマロに変える。(毎日配信は対象外)",
    target: "opponent",
    cost: 3
  },
  subscription: {
    name: "サブスク開始",
    text: "自身をサブスク状態に。(サブスク=毎ターン開始時に+10000)",
    target: "none",
    cost: 3
  },
  signature_topic: {
    name: "渾身のネタ",
    text: "1/2の確率でフォロワー+100万人。",
    target: "none",
    cost: 3
  },
  industry_expose: {
    name: "業界の闇暴露",
    text: "自分を含めた全員のフォロワー50%減。",
    target: "none",
    cost: 3
  },
  send_anti: {
    name: "アンチを送る",
    text: "対象をアンチ状態にする。(アンチ=毎ターン開始時に-10000)",
    target: "opponent",
    cost: 3
  },
  sponsorship: {
    name: "企業案件",
    text: "フォロワー+1万人。",
    target: "self",
    cost: 2
  },
  trending: {
    name: "トレンド入り",
    text: "フォロワー獲得+30%。(永続・重複可)",
    target: "self",
    cost: 2
  },
  premium_subscription: {
    name: "プレミアムサブスク",
    text: "サブスク状態ならプレミアムに昇格。(プレミアム=毎ターン開始時に+10万)",
    target: "self",
    cost: 3
  }
};

// v0.3 仕様: 毎日配信は「初手」固定でデッキには含めず、各プレイヤーに1枚配る。
// 残り17種122枚を共有デッキとして使う。
const CARD_POOL = [
  ...repeat("day_off", 10),
  ...repeat("collab_stream", 7),
  ...repeat("impersonate", 7),
  ...repeat("big_announcement", 7),
  ...repeat("emergency_video", 7),
  ...repeat("expose", 7),
  ...repeat("scandal", 7),
  ...repeat("apology", 7),
  ...repeat("shield", 7),
  ...repeat("kusomaro", 7),
  ...repeat("subscription", 7),
  ...repeat("signature_topic", 7),
  ...repeat("industry_expose", 7),
  ...repeat("send_anti", 7),
  ...repeat("sponsorship", 7),
  ...repeat("trending", 7),
  ...repeat("premium_subscription", 7)
]; // total 122 (毎日配信は除外)

const names = ["Aki", "Haru", "Mio", "Ren", "Sora", "Yui", "Nagi", "Riku", "Noa", "Kou"];
const cpuNames = ["CPUミナ", "CPUレン", "CPUカナ", "CPUソウ", "CPUユイ"];

function repeat(cardKey, count) {
  return Array.from({ length: count }, () => cardKey);
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function createCard(key, index) {
  return {
    id: `${key}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    key,
    ...CARD_DEFS[key]
  };
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return rooms.has(code) ? makeCode() : code;
}

function makePlayer(socket, name) {
  return {
    id: socket.id,
    name: (name || names[Math.floor(Math.random() * names.length)]).toString().slice(0, 14),
    avatarDataUrl: null,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    role: null,
    followers: INITIAL_FOLLOWERS,
    hand: [],
    connected: true,
    retired: false,
    burning: false,
    skipTurns: 0,
    gainBoosts: 0,
    trendingBoosts: 0,
    isCpu: false,
    shielded: false,
    shieldTurns: 0,
    burningTurns: 0,
    burningSourceId: null,
    subscribed: false,
    premiumSubscribed: false,
    antiTurns: 0,
    currentTurnCardCount: -1,
    followerDelta: 0,
    bonusMotivation: 0
  };
}

function makeCpuPlayer(index) {
  return {
    id: `cpu-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    name: cpuNames[index % cpuNames.length],
    avatarDataUrl: null,
    color: COLORS[index % COLORS.length],
    role: null,
    followers: INITIAL_FOLLOWERS,
    hand: [],
    connected: true,
    retired: false,
    burning: false,
    skipTurns: 0,
    gainBoosts: 0,
    trendingBoosts: 0,
    isCpu: true,
    shielded: false,
    shieldTurns: 0,
    burningTurns: 0,
    burningSourceId: null,
    subscribed: false,
    premiumSubscribed: false,
    antiTurns: 0,
    currentTurnCardCount: -1,
    followerDelta: 0,
    bonusMotivation: 0
  };
}

function visiblePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    avatarDataUrl: player.avatarDataUrl,
    color: player.color,
    role: player.role,
    followers: player.followers,
    handCount: player.hand.length,
    connected: player.connected,
    retired: player.retired,
    burning: player.burning,
    skipTurns: player.skipTurns,
    gainBoosts: player.gainBoosts,
    trendingBoosts: player.trendingBoosts,
    isCpu: player.isCpu,
    shielded: player.shielded,
    shieldTurns: player.shieldTurns,
    subscribed: player.subscribed,
    premiumSubscribed: player.premiumSubscribed,
    antiTurns: player.antiTurns,
    burningTurns: player.burningTurns,
    followerDelta: player.followerDelta
  };
}

function isValidAvatarDataUrl(value) {
  return typeof value === "string"
    && value.length <= 220_000
    && /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(value);
}

function getEffectiveCost(card, player) {
  let cost = card.cost ?? 1;
  if (player.role === "炎上系" && player.burning && ["expose", "scandal"].includes(card.key)) {
    cost = Math.max(0, cost - 1);
  }
  if (player.role === "アイドル" && ["apology", "shield"].includes(card.key)) {
    cost = Math.max(0, cost - 1);
  }
  return cost;
}

function publicRoom(room, viewerId) {
  const viewer = room.players.find((player) => player.id === viewerId);
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    message: room.message,
    players: room.players.map(visiblePlayer),
    maxPlayers: ROOM_SIZE,
    deckCount: room.deck.length,
    discardCount: room.discard.length,
    discardTop: room.discard.at(-1) || null,
    currentPlayerId: room.currentPlayerId,
    currentMotivation: room.currentMotivation ?? MAX_MOTIVATION,
    maxMotivation: room.turnMaxMotivation ?? MAX_MOTIVATION,
    turnNumber: room.turnNumber,
    winnerIds: room.winnerIds,
    lastPlayed: room.lastPlayed,
    lastSkipped: room.lastSkipped ?? null,
    log: room.log,
    structuredLog: room.structuredLog ?? [],
    myHand: viewer ? viewer.hand.map(card => ({
      ...card,
      effectiveCost: getEffectiveCost(card, viewer)
    })) : [],
    myMulliganedThisTurn: viewer ? !!viewer.mulliganedThisTurn : false
  };
}

function broadcast(room) {
  for (const socketId of room.players.map((player) => player.id)) {
    io.to(socketId).emit("room:state", publicRoom(room, socketId));
  }
}

function getRoomForSocket(socket) {
  const code = socket.data.roomCode;
  if (!code) return null;
  return rooms.get(code) || null;
}

function addLog(room, text, subjectId = null, targetId = null) {
  room.log.push(text);
  room.structuredLog.push({ text, subjectId, targetId });
  if (room.log.length > 200) room.log.shift();
  if (room.structuredLog.length > 200) room.structuredLog.shift();
}

function drawCards(room, player, count) {
  const drawn = [];
  for (let i = 0; i < count; i += 1) {
    const card = room.deck.shift();
    if (!card) break;
    player.hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

function applyGain(player, amount) {
  // 緊急で動画を回す: +10%/stack。 トレンド入り: +30%/stack。 共に永続・重複可。
  const multiplier = 1 + player.gainBoosts * 0.1 + player.trendingBoosts * 0.3;
  const gained = Math.floor(amount * multiplier);
  player.followers += gained;
  player.followerDelta = (player.followerDelta || 0) + gained;
  return gained;
}

function rollDice() {
  return 1 + Math.floor(Math.random() * 6);
}

function changeFollowers(player, newValue) {
  player.followerDelta = (player.followerDelta || 0) + (newValue - player.followers);
  player.followers = newValue;
}

function retireIfNeeded(room, player) {
  if (player.followers <= 0 && !player.retired) {
    player.followers = 0;
    player.retired = true;
    if (player.hand.length > 0) {
      room.deck.push(...player.hand);
      player.hand = [];
      room.deck = shuffle(room.deck);
    }
    addLog(room, `${player.name} は引退した`, player.id);
  }
}

function getAlivePlayers(room) {
  return room.players.filter((player) => !player.retired);
}

function checkWin(room) {
  const alive = getAlivePlayers(room);
  if (alive.length <= 1) {
    room.phase = "finished";
    room.currentPlayerId = null;
    room.winnerIds = alive.map((player) => player.id);
    room.message = alive[0] ? `${alive[0].name} の勝利` : "全員引退";
    addLog(room, room.message);
    return true;
  }

  if (room.deck.length === 0) {
    const topFollowers = Math.max(...alive.map((player) => player.followers));
    room.phase = "finished";
    room.currentPlayerId = null;
    room.winnerIds = alive.filter((player) => player.followers === topFollowers).map((player) => player.id);
    room.message = room.winnerIds.length === 1
      ? `${alive.find((player) => player.id === room.winnerIds[0]).name} の勝利`
      : "同点勝利";
    addLog(room, "デッキがなくなった");
    addLog(room, room.message);
    return true;
  }
  return false;
}

function nextAliveIndex(room, startIndex) {
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const index = (startIndex + offset) % room.players.length;
    if (!room.players[index].retired) return index;
  }
  return -1;
}

function beginTurn(room) {
  if (checkWin(room)) return;

  const player = room.players[room.currentIndex];
  room.currentPlayerId = player.id;
  room.turnNumber += 1;
  for (const p of room.players) p.followerDelta = 0;

  // 鍵垢: 3ターン持続。毎ターン開始時にカウントダウン
  if (player.shielded) {
    player.shieldTurns = Math.max(0, (player.shieldTurns || 0) - 1);
    if (player.shieldTurns <= 0) {
      player.shielded = false;
      addLog(room, `${player.name} の鍵垢が解除された`, player.id);
    }
  }

  // スキップ救済: 前ターンが存在し0枚だった場合のみモチベ+1（初回ターンは除外）
  const skipBonus = player.currentTurnCardCount === 0 ? 1 : 0;

  player.currentTurnCardCount = 0;  // 0 = このターン未使用（次回スキップ救済の判定に使う）

  if (player.skipTurns > 0) {
    player.skipTurns -= 1;
    addLog(room, `${player.name} は休みでスキップ`, player.id);
    room.lastSkipped = {
      id: `${Date.now()}-${player.id}`,
      playerId: player.id,
      playerName: player.name,
      reason: "休み"
    };
    advanceTurn(room);
    return;
  }

  if (player.burning) {
    // 炎上系: damage floor at 200
    const damaged = player.role === "炎上系"
      ? Math.max(200, Math.floor(player.followers / 2))
      : Math.floor(player.followers / 2);
    changeFollowers(player, damaged);
    addLog(room, `${player.name} は炎上でフォロワー半減`, player.id);
    player.burningTurns -= 1;
    if (player.burningTurns <= 0) {
      player.burning = false;
      player.burningSourceId = null;
      addLog(room, `${player.name} の炎上が自然鎮火した`, player.id);
    }
    retireIfNeeded(room, player);
    if (checkWin(room)) return;
  }

  // サブスク状態: 毎ターン開始時にフォロワー+10000。プレミアム時は+100000（上書き）。
  if (player.premiumSubscribed && !player.retired) {
    applyGain(player, 100000);
    addLog(room, `${player.name} はプレミアムサブスクでフォロワー+100,000`, player.id);
  } else if (player.subscribed && !player.retired) {
    applyGain(player, 10000);
    addLog(room, `${player.name} はサブスクでフォロワー+10,000`, player.id);
  }

  // アンチ状態: 毎ターン開始時にフォロワー-10000
  if (player.antiTurns > 0 && !player.retired) {
    const before = player.followers;
    changeFollowers(player, Math.max(0, player.followers - 10000));
    addLog(room, `${player.name} はアンチでフォロワー-${(before - player.followers).toLocaleString()}`, player.id);
    retireIfNeeded(room, player);
    if (checkWin(room)) return;
  }

  // モチベ設定（スキップ救済・企業案件ボーナス込み）
  room.currentMotivation = MAX_MOTIVATION + skipBonus + (player.bonusMotivation || 0);
  room.turnMaxMotivation = room.currentMotivation;
  player.bonusMotivation = 0;
  player.mulliganedThisTurn = false;
  if (skipBonus) addLog(room, `${player.name} は前ターン休んだためモチベ+1`, player.id);

  // アイドル: draw 2 on turn start
  const drawCount = player.role === "アイドル" ? 2 : 1;
  const drawn = drawCards(room, player, drawCount);
  if (drawn.length > 0) addLog(room, `${player.name} が${drawn.length}枚ドロー`, player.id);
  enforceHandLimit(room, player);


  room.phase = "playing";
  room.message = `${player.name} のターン`;
  checkWin(room);
  if (player.isCpu && room.phase === "playing") {
    broadcast(room);
    room.cpuTimer = setTimeout(() => playCpuTurn(room), CPU_TURN_DELAY_MS);
  }
}

function enforceHandLimit(room, player) {
  if (player.hand.length > HAND_LIMIT) {
    const excess = player.hand.splice(HAND_LIMIT);
    room.discard.push(...excess);
    addLog(room, `${player.name} の手札が上限超過のため${excess.length}枚自動で捨てた`, player.id);
  }
}

function advanceTurn(room) {
  if (checkWin(room)) return;
  const nextIndex = nextAliveIndex(room, room.currentIndex);
  if (nextIndex < 0) {
    checkWin(room);
    return;
  }
  room.currentIndex = nextIndex;
  beginTurn(room);
}

function startGame(room) {
  if (room.players.length < 2) {
    room.message = "2人以上で開始できます";
    broadcast(room);
    return;
  }

  const roleOrder = shuffle(ROLES);
  const selectedDeck = shuffle(CARD_POOL).slice(0, DECK_SIZE).map(createCard);
  room.deck = selectedDeck;
  room.discard = [];
  room.log = [];
  room.structuredLog = [];
  room.phase = "playing";
  room.turnNumber = 0;
  room.winnerIds = [];
  room.lastPlayed = null;
  room.lastSkipped = null;
  room.discardingPlayerId = null;
  room.discardCount = 0;

  room.players.forEach((player, index) => {
    player.role = roleOrder[index % roleOrder.length];
    player.followers = INITIAL_FOLLOWERS;
    player.hand = [];
    player.retired = false;
    player.burning = false;
    player.skipTurns = 0;
    player.gainBoosts = 0;
    player.trendingBoosts = 0;
    player.shielded = false;
    player.shieldTurns = 0;
    player.burningTurns = 0;
    player.burningSourceId = null;
    player.subscribed = false;
    player.premiumSubscribed = false;
    player.antiTurns = 0;
    player.currentTurnCardCount = -1;
    player.bonusMotivation = 0;
    player.mulliganedThisTurn = false;
    // 毎日配信は「初手」として全プレイヤーに必ず配る（仕様 v0.3）
    player.hand.push(createCard("daily_stream", index));
    drawCards(room, player, HAND_SIZE - 1);
  });

  const firstIndex = room.players.findIndex((player) => player.role === "エンタメ系");
  room.currentIndex = firstIndex >= 0 ? firstIndex : 0;
  room.currentPlayerId = room.players[room.currentIndex].id;
  addLog(room, "ゲーム開始。ロール効果は今回なし");
  beginTurn(room);
  broadcast(room);
}

function fillCpuPlayers(room) {
  const existingCpuCount = room.players.filter((player) => player.isCpu).length;
  while (room.players.length < ROOM_SIZE) {
    room.players.push(makeCpuPlayer(existingCpuCount + room.players.length));
  }
  addLog(room, "開発者テスト用CPUを追加");
}

function findTarget(room, targetId) {
  return room.players.find((player) => player.id === targetId && !player.retired) || null;
}

function playCard(room, player, card, targetId) {
  const opponentTarget = () => {
    const target = findTarget(room, targetId);
    if (!target || target.id === player.id) throw new Error("対象を選んでください");
    return target;
  };

  player.currentTurnCardCount += 1;

  let resolvedText = card.text;

  switch (card.key) {
    case "daily_stream": {
      const dice = rollDice();
      const base = dice * 1000;
      // インスタグラマー: x1.5 boost
      const actualBase = player.role === "インスタグラマー" ? Math.floor(base * 1.5) : base;
      const gained = applyGain(player, actualBase);
      resolvedText = `サイコロ${dice} → +${gained.toLocaleString()}フォロワー。手札に残る。`;
      addLog(room, `${player.name} は毎日配信(サイコロ${dice})で+${gained.toLocaleString()}人`, player.id);
      break;
    }
    case "day_off": {
      const extra = player.role === "知識系" ? 1 : 0;
      const drawn = drawCards(room, player, 2 + extra);
      addLog(room, `${player.name} は配信おやすみで${drawn.length}枚ドロー`, player.id);
      enforceHandLimit(room, player);
      break;
    }
    case "collab_stream": {
      const target = opponentTarget();
      // 鍵垢相手でも友好的なので無効化対象にしない（攻撃ではない）
      const selfGain = applyGain(player, 100000);
      const targetGain = applyGain(target, 100000);
      addLog(
        room,
        `${player.name} と ${target.name} がコラボ配信。双方+${selfGain.toLocaleString()}/${targetGain.toLocaleString()}人`,
        player.id,
        target.id
      );
      break;
    }
    case "impersonate": {
      const target = opponentTarget();
      if (target.shielded) {
        target.shielded = false;
        target.shieldTurns = 0;
        resolvedText = "しかし何も起こらなかった";
        addLog(room, `${target.name} は鍵垢でなりすましを防いだ`, player.id, target.id);
        break;
      }
      const before = player.followers;
      changeFollowers(player, target.followers);
      const diff = player.followers - before;
      const burned = Math.random() < 0.5;
      if (burned) {
        player.burning = true;
        player.burningTurns = 3;
        player.burningSourceId = null;
      }
      addLog(room, `${player.name} は${target.name}になりすまし(フォロワー${diff >= 0 ? "+" : ""}${diff.toLocaleString()})${burned ? "/自分が炎上" : ""}`, player.id, target.id);
      retireIfNeeded(room, player);
      break;
    }
    case "big_announcement": {
      const roll = Math.random();
      if (roll < 0.5) {
        changeFollowers(player, player.followers * 1000);
        addLog(room, `${player.name} の重大なお知らせが大当たり(×1000)`, player.id);
      } else {
        changeFollowers(player, Math.max(0, Math.floor(player.followers / 1000)));
        addLog(room, `${player.name} の重大なお知らせが大外れ(÷1000)`, player.id);
        retireIfNeeded(room, player);
      }
      break;
    }
    case "emergency_video": {
      player.gainBoosts += 1;
      addLog(room, `${player.name} は緊急動画ブースト+10%(累計+${player.gainBoosts * 10}%)`, player.id);
      break;
    }
    case "expose": {
      const target = opponentTarget();
      if (target.shielded) {
        target.shielded = false;
        target.shieldTurns = 0;
        resolvedText = "しかし何も起こらなかった";
        addLog(room, `${target.name} は鍵垢で暴露を防いだ`, player.id, target.id);
        break;
      }
      changeFollowers(target, Math.floor(target.followers / 2));
      addLog(room, `${player.name} は${target.name}を暴露(フォロワー半減)`, player.id, target.id);
      retireIfNeeded(room, target);
      break;
    }
    case "scandal": {
      const target = opponentTarget();
      if (target.shielded) {
        target.shielded = false;
        target.shieldTurns = 0;
        resolvedText = "しかし何も起こらなかった";
        addLog(room, `${target.name} は鍵垢で炎上を防いだ`, player.id, target.id);
        break;
      }
      target.burning = true;
      target.burningTurns = 3;
      target.burningSourceId = player.id;
      addLog(room, `${player.name} は${target.name}を炎上させた`, player.id, target.id);
      break;
    }
    case "apology": {
      const wasBurning = player.burning;
      player.burning = false;
      player.burningTurns = 0;
      player.burningSourceId = null;
      const dice = rollDice();
      const gained = applyGain(player, dice * 1000);
      resolvedText = `炎上回復。サイコロ${dice} → +${gained.toLocaleString()}フォロワー。`;
      addLog(room, `${player.name} は謝罪${wasBurning ? "(炎上回復)" : ""}・+${gained.toLocaleString()}人`, player.id);
      break;
    }
    case "shield": {
      player.shielded = true;
      player.shieldTurns = 3;
      addLog(room, `${player.name} は鍵垢にした(3ターン持続)`, player.id);
      break;
    }
    case "kusomaro": {
      const target = opponentTarget();
      if (target.shielded) {
        target.shielded = false;
        target.shieldTurns = 0;
        resolvedText = "しかし何も起こらなかった";
        addLog(room, `${target.name} は鍵垢でくそマロを防いだ`, player.id, target.id);
        break;
      }
      // 毎日配信以外からランダムに最大3枚を選んでくそマロに変える
      const replaceableIndices = target.hand
        .map((c, i) => (c.key !== "daily_stream" ? i : -1))
        .filter((i) => i >= 0);
      // シャッフルして最大3枚
      for (let i = replaceableIndices.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [replaceableIndices[i], replaceableIndices[j]] = [replaceableIndices[j], replaceableIndices[i]];
      }
      const chosen = replaceableIndices.slice(0, 3);
      let replaced = 0;
      for (const idx of chosen) {
        target.hand[idx] = createCard("kusomaro", idx);
        replaced += 1;
      }
      addLog(room, `${player.name} は${target.name}にくそマロ送付。${replaced}枚をくそマロに置換`, player.id, target.id);
      break;
    }
    case "subscription": {
      player.subscribed = true;
      addLog(room, `${player.name} はサブスク開始(毎ターン+10000)`, player.id);
      break;
    }
    case "signature_topic": {
      if (Math.random() < 0.5) {
        const gained = applyGain(player, 1000000);
        resolvedText = `渾身のネタが大ヒット → +${gained.toLocaleString()}フォロワー。`;
        addLog(room, `${player.name} の渾身のネタが大ヒット(+${gained.toLocaleString()}人)`, player.id);
      } else {
        resolvedText = "しかし何も起こらなかった";
        addLog(room, `${player.name} の渾身のネタは外れ`, player.id);
      }
      break;
    }
    case "industry_expose": {
      const alive = getAlivePlayers(room);
      for (const p of alive) {
        if (p.id === player.id) {
          // 自分は鍵垢では守れない（仕様：自分も対象）
          changeFollowers(p, Math.floor(p.followers / 2));
        } else if (p.shielded) {
          p.shielded = false;
          p.shieldTurns = 0;
          addLog(room, `${p.name} は鍵垢で業界の闇暴露を防いだ`, player.id, p.id);
          continue;
        } else {
          changeFollowers(p, Math.floor(p.followers / 2));
        }
        retireIfNeeded(room, p);
      }
      addLog(room, `${player.name} が業界の闇を暴露(全員50%減)`, player.id);
      if (checkWin(room)) return;
      break;
    }
    case "send_anti": {
      const target = opponentTarget();
      if (target.shielded) {
        target.shielded = false;
        target.shieldTurns = 0;
        resolvedText = "しかし何も起こらなかった";
        addLog(room, `${target.name} は鍵垢でアンチを防いだ`, player.id, target.id);
        break;
      }
      target.antiTurns = Math.max(target.antiTurns || 0, 1);
      // アンチ状態は持続（解除条件未定義の仕様 → 永続扱い）
      addLog(room, `${player.name} は${target.name}をアンチ状態に(毎ターン-10000)`, player.id, target.id);
      break;
    }
    case "sponsorship": {
      const gained = applyGain(player, 10000);
      addLog(room, `${player.name} は企業案件で+${gained.toLocaleString()}人`, player.id);
      break;
    }
    case "trending": {
      player.trendingBoosts += 1;
      addLog(room, `${player.name} はトレンド入り(獲得+30% 累計+${player.trendingBoosts * 30}%)`, player.id);
      break;
    }
    case "premium_subscription": {
      if (!player.subscribed) {
        addLog(room, `${player.name} はプレミアム化を試みたがサブスク未開始で不発`, player.id);
        resolvedText = "しかし何も起こらなかった";
        break;
      }
      player.premiumSubscribed = true;
      addLog(room, `${player.name} のサブスクがプレミアムに昇格(毎ターン+100,000)`, player.id);
      break;
    }
    default:
      throw new Error("未知のカードです");
  }

  room.lastPlayed = {
    id: `${Date.now()}-${card.id}`,
    playerId: player.id,
    playerName: player.name,
    cardKey: card.key,
    cardName: card.name,
    cardText: resolvedText,
    targetName: card.target === "opponent" ? (findTarget(room, targetId)?.name ?? null) : null
  };
  retireIfNeeded(room, player);
}

// CPU card scoring. Higher = more attractive. Random jitter is added by the caller.
function scoreCpuCard(card, player, target, opponents) {
  switch (card.key) {
    case "daily_stream":
      // Reliable filler. Lower score so the CPU prefers more impactful plays first.
      return 14;
    case "day_off":
      return player.hand.length < 5 ? 30 : 16;
    case "collab_stream":
      return target ? Math.min(55, target.followers / 400) : 0;
    case "impersonate":
      return target && target.followers > player.followers * 1.5 ? 60 : 14;
    case "big_announcement":
      // High-variance: prefer when behind.
      return player.followers < 5000 ? 55 : 22;
    case "emergency_video":
      return 30 - player.gainBoosts * 4;
    case "expose":
      return target ? (target.shielded ? 10 : 44) : 0;
    case "scandal":
      return target ? (target.shielded ? 10 : (target.burning ? 6 : 38)) : 0;
    case "apology":
      // Skipped upstream when not burning.
      return 70;
    case "shield":
      return 28;
    case "kusomaro":
      return target ? (target.shielded ? 10 : 36) : 0;
    case "subscription":
      return 44;
    case "signature_topic":
      return 30;
    case "industry_expose": {
      const maxOpp = opponents.reduce((m, o) => Math.max(m, o.followers), 0);
      return maxOpp > player.followers * 1.5 ? 52 : 24;
    }
    case "send_anti":
      return target ? (target.antiTurns > 0 ? 8 : (target.shielded ? 10 : 42)) : 0;
    case "sponsorship":
      return 36;
    case "trending":
      return 32 - player.trendingBoosts * 5;
    case "premium_subscription":
      // Only useful if already subscribed; very strong then.
      return player.subscribed && !player.premiumSubscribed ? 60 : -999;
    default:
      return 8;
  }
}

function chooseCpuCard(room, player) {
  const motivation = room.currentMotivation ?? MAX_MOTIVATION;
  const opponents = room.players.filter(c => c.id !== player.id && !c.retired);
  if (opponents.length === 0) return null;
  const sortedOpponents = opponents.slice().sort((a, b) => b.followers - a.followers);

  // Skip cards that would be wasted (self-buff already active, apology while not burning, etc.).
  const playable = player.hand.filter(c => {
    if (getEffectiveCost(c, player) > motivation) return false;
    if (c.key === "apology" && !player.burning) return false;
    if (c.key === "shield" && player.shielded) return false;
    if (c.key === "subscription" && player.subscribed) return false;
    if (c.key === "premium_subscription" && (!player.subscribed || player.premiumSubscribed)) return false;
    if (c.target === "opponent" && sortedOpponents.length === 0) return false;
    return true;
  });
  if (playable.length === 0) return null;

  let bestChoice = null;
  let bestScore = -Infinity;
  for (const card of playable) {
    const target = card.target === "opponent" ? sortedOpponents[0] : null;
    const score = scoreCpuCard(card, player, target, opponents) + Math.random() * 10;
    if (score > bestScore) {
      bestScore = score;
      bestChoice = { card, targetId: target?.id };
    }
  }
  return bestChoice;
}

function playCpuTurn(room) {
  if (room.phase !== "playing") return;
  const player = room.players[room.currentIndex];
  if (!player?.isCpu || player.retired) return;

  const choice = player.hand.length > 0 ? chooseCpuCard(room, player) : null;
  if (!choice) {
    if (player.hand.length === 0) addLog(room, `${player.name} は手札がない`);
    advanceTurn(room);
    broadcast(room);
    return;
  }

  const { card, targetId } = choice;
  const cardIndex = player.hand.findIndex((candidate) => candidate.id === card.id);
  // 毎日配信は使っても手札に残る（仕様 v0.3）
  const isPersistent = card.key === "daily_stream";
  const playedCard = isPersistent ? player.hand[cardIndex] : player.hand.splice(cardIndex, 1)[0];
  try {
    playCard(room, player, playedCard, targetId);
    if (!isPersistent) room.discard.push(playedCard);
    room.currentMotivation -= getEffectiveCost(playedCard, player);
    if (checkWin(room)) {
      broadcast(room);
      return;
    }
    if (room.currentMotivation <= 0 || !chooseCpuCard(room, player)) {
      // auto-discard excess cards
      while (player.hand.length > HAND_LIMIT) {
        const [discarded] = player.hand.splice(0, 1);
        room.discard.push(discarded);
      }
      if (checkWin(room)) { broadcast(room); return; }
      advanceTurn(room);
      broadcast(room);
    } else {
      broadcast(room);
      room.cpuTimer = setTimeout(() => playCpuTurn(room), CPU_TURN_DELAY_MS);
    }
  } catch (error) {
    if (!isPersistent) player.hand.splice(cardIndex, 0, playedCard);
    addLog(room, `${player.name} は行動に失敗: ${error.message}`);
    advanceTurn(room);
    broadcast(room);
  }
}

io.on("connection", (socket) => {
  socket.emit("server:hello", { now: Date.now() });

  socket.on("room:create", ({ name } = {}, reply) => {
    const code = makeCode();
    const player = makePlayer(socket, name);
    const room = {
      code,
      hostId: socket.id,
      phase: "lobby",
      message: "友人を待っています",
      players: [player],
      deck: [],
      discard: [],
      currentIndex: 0,
      currentPlayerId: null,
      currentMotivation: MAX_MOTIVATION,
      discardingPlayerId: null,
      discardCount: 0,
      turnNumber: 0,
      winnerIds: [],
      lastPlayed: null,
      log: ["ルームを作成しました"],
      structuredLog: [{ text: "ルームを作成しました", subjectId: null, targetId: null }],
      createdAt: Date.now()
    };

    rooms.set(code, room);
    socket.data.roomCode = code;
    socket.join(code);
    reply?.({ ok: true, room: publicRoom(room, socket.id), playerId: socket.id });
    broadcast(room);
  });

  socket.on("room:join", ({ code, name } = {}, reply) => {
    const room = rooms.get((code || "").toString().trim().toUpperCase());
    if (!room) {
      reply?.({ ok: false, error: "Room not found" });
      return;
    }
    if (room.players.length >= ROOM_SIZE) {
      reply?.({ ok: false, error: "Room is full" });
      return;
    }
    if (room.phase !== "lobby" && room.phase !== "finished") {
      reply?.({ ok: false, error: "Game already started" });
      return;
    }

    const player = makePlayer(socket, name);
    room.players.push(player);
    room.phase = "lobby";
    socket.data.roomCode = room.code;
    socket.join(room.code);
    addLog(room, `${player.name} が参加`);
    reply?.({ ok: true, room: publicRoom(room, socket.id), playerId: socket.id });
    broadcast(room);
  });

  socket.on("game:start", () => {
    const room = getRoomForSocket(socket);
    if (!room || room.hostId !== socket.id) return;
    startGame(room);
  });

  socket.on("game:returnToLobby", () => {
    const room = getRoomForSocket(socket);
    if (!room || room.hostId !== socket.id) return;
    // Only meaningful from finished. (Also tolerate "lobby" no-op.)
    if (room.phase !== "finished" && room.phase !== "lobby") return;
    // Drop CPU fillers so the host can re-arrange seats. Real players stay.
    room.players = room.players.filter((p) => !p.isCpu);
    if (room.cpuTimer) { clearTimeout(room.cpuTimer); room.cpuTimer = null; }
    room.phase = "lobby";
    room.deck = [];
    room.discard = [];
    room.currentIndex = 0;
    room.currentPlayerId = null;
    room.currentMotivation = MAX_MOTIVATION;
    room.turnMaxMotivation = MAX_MOTIVATION;
    room.turnNumber = 0;
    room.winnerIds = [];
    room.lastPlayed = null;
    room.lastSkipped = null;
    room.log = ["ロビーに戻りました"];
    room.structuredLog = [{ text: "ロビーに戻りました", subjectId: null, targetId: null }];
    room.message = "友人を待っています";
    for (const p of room.players) {
      p.hand = [];
      p.followers = INITIAL_FOLLOWERS;
      p.role = null;
      p.retired = false;
      p.burning = false;
      p.burningTurns = 0;
      p.burningSourceId = null;
      p.skipTurns = 0;
      p.gainBoosts = 0;
      p.trendingBoosts = 0;
      p.shielded = false;
      p.shieldTurns = 0;
      p.subscribed = false;
      p.premiumSubscribed = false;
      p.antiTurns = 0;
      p.bonusMotivation = 0;
      p.mulliganedThisTurn = false;
      p.currentTurnCardCount = -1;
      p.followerDelta = 0;
    }
    broadcast(room);
  });

  socket.on("game:startWithCpu", () => {
    const room = getRoomForSocket(socket);
    if (!room || room.hostId !== socket.id || room.phase !== "lobby") return;
    fillCpuPlayers(room);
    startGame(room);
  });

  socket.on("room:setAvatar", ({ avatarDataUrl } = {}, reply) => {
    const room = getRoomForSocket(socket);
    if (!room) {
      reply?.({ ok: false, error: "Room not found" });
      return;
    }
    const player = room.players.find((candidate) => candidate.id === socket.id);
    if (!player || player.isCpu) {
      reply?.({ ok: false, error: "Player not found" });
      return;
    }
    if (avatarDataUrl !== null && !isValidAvatarDataUrl(avatarDataUrl)) {
      reply?.({ ok: false, error: "Invalid image" });
      return;
    }
    player.avatarDataUrl = avatarDataUrl;
    reply?.({ ok: true });
    broadcast(room);
  });

  socket.on("game:playCard", ({ cardId, targetId } = {}, reply) => {
    const room = getRoomForSocket(socket);
    if (!room || room.phase !== "playing") {
      reply?.({ ok: false, error: "ゲーム中ではありません" });
      return;
    }
    if (room.currentPlayerId !== socket.id) {
      reply?.({ ok: false, error: "あなたのターンではありません" });
      return;
    }

    const player = room.players.find((candidate) => candidate.id === socket.id);
    if (!player || player.retired) {
      reply?.({ ok: false, error: "プレイできません" });
      return;
    }

    const cardIndex = player.hand.findIndex((card) => card.id === cardId);
    if (cardIndex < 0) {
      reply?.({ ok: false, error: "手札にないカードです" });
      return;
    }

    const card = player.hand[cardIndex];
    const effectiveCost = getEffectiveCost(card, player);
    if (effectiveCost > room.currentMotivation) {
      reply?.({ ok: false, error: "モチベが足りません" });
      return;
    }

    // 毎日配信は使っても手札に残る（仕様 v0.3）
    const isPersistent = card.key === "daily_stream";
    if (!isPersistent) player.hand.splice(cardIndex, 1);
    try {
      playCard(room, player, card, targetId);
      if (!isPersistent) room.discard.push(card);
      room.currentMotivation -= effectiveCost;
      if (!checkWin(room) && room.currentMotivation <= 0) {
        advanceTurn(room);
      }
      reply?.({ ok: true });
      broadcast(room);
    } catch (error) {
      if (!isPersistent) player.hand.splice(cardIndex, 0, card);
      player.currentTurnCardCount = Math.max(0, player.currentTurnCardCount - 1);
      reply?.({ ok: false, error: error.message });
      broadcast(room);
    }
  });

  socket.on("game:endTurn", () => {
    const room = getRoomForSocket(socket);
    if (!room || room.phase !== "playing") return;
    if (room.currentPlayerId !== socket.id) return;
    advanceTurn(room);
    broadcast(room);
  });

  socket.on("game:mulligan", ({ cardIds } = {}, reply) => {
    console.log(`[mulligan] from ${socket.id}, cardIds=${JSON.stringify(cardIds)}`);
    if (typeof reply !== "function") {
      console.warn(`[mulligan] no ack callback from client`);
    }
    try {
    const room = getRoomForSocket(socket);
    if (!room || room.phase !== "playing") {
      reply?.({ ok: false, error: "ゲーム中ではありません" });
      return;
    }
    if (room.currentPlayerId !== socket.id) {
      reply?.({ ok: false, error: "あなたのターンではありません" });
      return;
    }
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.retired) {
      reply?.({ ok: false, error: "プレイできません" });
      return;
    }
    if (player.mulliganedThisTurn) {
      reply?.({ ok: false, error: "このターンは既にマリガン済みです" });
      return;
    }
    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      reply?.({ ok: false, error: "カードを選択してください" });
      return;
    }
    // Validate every selected id is in hand
    const indices = [];
    const returning = [];
    for (const id of cardIds) {
      const idx = player.hand.findIndex((c) => c.id === id);
      if (idx < 0) {
        reply?.({ ok: false, error: "選択カードが手札にありません" });
        return;
      }
      indices.push(idx);
      returning.push(player.hand[idx]);
    }
    // Remove from hand (high index first)
    indices.sort((a, b) => b - a);
    for (const idx of indices) player.hand.splice(idx, 1);
    // Shuffle back into deck and redraw
    room.deck = shuffle([...room.deck, ...returning]);
    const drawn = drawCards(room, player, returning.length);
    player.mulliganedThisTurn = true;
    addLog(room, `${player.name} がマリガンで${returning.length}枚交換 (引いた${drawn.length}枚)`, player.id);
    console.log(`[mulligan] OK: returned=${returning.length}, drawn=${drawn.length}, deckNow=${room.deck.length}, handNow=${player.hand.length}`);
    reply?.({ ok: true });
    broadcast(room);
    } catch (err) {
      console.error(`[mulligan] error:`, err);
      reply?.({ ok: false, error: `server: ${err.message}` });
    }
  });

  socket.on("room:leave", () => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    room.players = room.players.filter((player) => player.id !== socket.id);
    socket.leave(room.code);
    socket.data.roomCode = null;
    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    const player = room.players.find((candidate) => candidate.id === socket.id);
    if (player) player.connected = false;
    if (room.hostId === socket.id) {
      const nextHost = room.players.find((candidate) => candidate.connected);
      if (nextHost) room.hostId = nextHost.id;
    }
    broadcast(room);
  });
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, rooms: rooms.size });
});

const distPath = join(__dirname, "..", "dist");
app.use(express.static(distPath));
app.get("/{*splat}", (_request, response) => {
  response.sendFile(join(distPath, "index.html"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Influencer Game server listening on ${PORT}`);
});
