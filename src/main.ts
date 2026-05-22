import QRCode from "qrcode";
import { io, Socket } from "socket.io-client";
import "./style.css";

type Phase = "lobby" | "playing" | "finished" | "discarding";
type CardTarget = "none" | "self" | "opponent";

type Card = {
  id: string;
  key: string;
  name: string;
  text: string;
  target: CardTarget;
  cost: number;
  effectiveCost: number;
};

type LastPlayed = {
  id: string;
  playerId: string;
  playerName: string;
  cardKey?: string;
  cardName: string;
  cardText: string;
  targetName: string | null;
};

type LastSkipped = {
  id: string;
  playerId: string;
  playerName: string;
  reason: string;
};

type Player = {
  id: string;
  name: string;
  avatarDataUrl: string | null;
  color: string;
  role: string | null;
  followers: number;
  handCount: number;
  connected: boolean;
  retired: boolean;
  burning: boolean;
  skipTurns: number;
  gainBoosts: number;
  trendingBoosts: number;
  isCpu: boolean;
  shielded: boolean;
  shieldTurns: number;
  subscribed: boolean;
  premiumSubscribed: boolean;
  antiTurns: number;
  burningTurns: number;
  followerDelta: number;
};

type RoomState = {
  code: string;
  hostId: string;
  phase: Phase;
  message: string;
  players: Player[];
  maxPlayers: number;
  deckCount: number;
  discardCount: number;
  discardTop: Card | null;
  currentPlayerId: string | null;
  turnNumber: number;
  winnerIds: string[];
  lastPlayed: LastPlayed | null;
  lastSkipped: LastSkipped | null;
  log: string[];
  structuredLog: Array<{ text: string; subjectId: string | null; targetId: string | null }>;
  myHand: Card[];
  currentMotivation: number;
  maxMotivation: number;
  myMulliganedThisTurn: boolean;
};

// Card key → CSS data-type (used for hover-glow color)
const CARD_TYPE: Record<string, string> = {
  daily_stream: "grow",
  day_off: "grow",
  collab_stream: "boost",
  impersonate: "fate",
  big_announcement: "fate",
  emergency_video: "boost",
  expose: "attack",
  scandal: "attack",
  apology: "heal",
  shield: "heal",
  kusomaro: "attack",
  subscription: "boost",
  premium_subscription: "boost",
  signature_topic: "fate",
  industry_expose: "attack",
  send_anti: "attack",
  sponsorship: "boost",
  trending: "grow"
};

// Cycle of 6 ring colors for avatars (overrides server.color for visual coherence)
const RING_COLORS = [
  { ring: "#f5b700", glow: "rgba(245,183,0,0.6)", followers: "#fbbf24" },
  { ring: "#ec4899", glow: "rgba(236,72,153,0.6)", followers: "#ec4899" },
  { ring: "#3b82f6", glow: "rgba(59,130,246,0.6)", followers: "#60a5fa" },
  { ring: "#a855f7", glow: "rgba(168,85,247,0.6)", followers: "#c084fc" },
  { ring: "#22c55e", glow: "rgba(34,197,94,0.6)", followers: "#4ade80" },
  { ring: "#f472b6", glow: "rgba(244,114,182,0.6)", followers: "#f472b6" }
];

function avatarSrc(index: number) {
  return `/assets/avatar-${(index % 6) + 1}.png`;
}
function playerAvatarSrc(player: Player, index: number) {
  return player.avatarDataUrl || avatarSrc(index);
}
function ringFor(index: number) {
  return RING_COLORS[index % RING_COLORS.length];
}
function cardSrc(key: string) {
  return `/assets/card-${key}.png?v=3`;
}

// Preload all card images so preview swaps are instant (no fetch lag).
Object.keys(CARD_TYPE).forEach((key) => {
  const img = new Image();
  img.src = cardSrc(key);
});

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

app.innerHTML = `
  <div class="phone-shell">
    <div class="bg-particles" id="bgParticles" aria-hidden="true"></div>
    <input id="avatarInput" class="avatar-input" type="file" accept="image/*" />

    <!-- ========== Lobby ========== -->
    <section id="lobbyScreen" class="lobby-screen">
      <header class="lobby-hero">
        <div class="app-icon-wrap">
          <img src="/assets/app-icon.png" alt="" />
        </div>
        <div>
          <h1>
            <span>インフルエンサー</span>
            <span class="gold">CARD BATTLE</span>
          </h1>
          <p class="tagline">炎上、コラボ、暴露 — 最後に立つのは誰だ？</p>
        </div>
      </header>

      <section id="joinPanel" class="lobby-panel">
        <p class="eyebrow">JOIN OR CREATE</p>
        <h2>ルームを作成または参加</h2>
        <div class="field-row">
          <div class="field">
            <label>NAME</label>
            <input id="nameInput" maxlength="14" placeholder="あなたの名前" autocomplete="nickname" />
          </div>
          <div class="field">
            <label>ROOM</label>
            <input id="codeInput" class="code" maxlength="4" placeholder="ABCD" autocomplete="off" />
          </div>
        </div>
        <div class="lobby-actions">
          <button id="createButton" class="btn-primary">ルームを作成</button>
          <button id="joinButton" class="btn-secondary">参加</button>
        </div>
        <p id="joinError" class="error" role="alert"></p>
      </section>

      <section id="roomPanel" class="lobby-panel hidden">
        <p class="eyebrow">ROOM</p>
        <div class="room-meta">
          <div class="room-code-box">
            <p class="meta-label">CODE</p>
            <div id="roomCode" class="room-code">----</div>
          </div>
          <div class="room-qr">
            <canvas id="qrCanvas" width="104" height="104" aria-label="Invite QR code"></canvas>
          </div>
          <div class="invite-share">
            <span class="label">招待リンク</span>
            <div class="row">
              <input id="inviteLink" readonly />
              <button id="copyButton">Copy</button>
            </div>
          </div>
        </div>
        <div class="start-actions">
          <button id="startButton" class="btn-primary">ゲーム開始</button>
          <button id="cpuStartButton" class="btn-secondary">CPU追加</button>
        </div>
      </section>

      <section class="lobby-panel">
        <div class="lobby-panel-head">
          <div>
            <p class="eyebrow">PLAYERS</p>
            <h2 id="lobbyTitle">ルームを作成または参加</h2>
          </div>
        </div>
        <div id="lobbyPlayers" class="lobby-players"></div>
      </section>
    </section>

    <!-- ========== Game ========== -->
    <section id="gameScreen" class="game-screen hidden">
      <div class="topbar">
        <button id="menuButton" class="pill pill-menu" aria-label="メニュー">
          <span class="icon"><img src="/assets/icon-menu.png" alt="" /></span>
          <span>Menu</span>
        </button>
        <div id="topbarStatus" class="turn-indicator">
          <span class="play-tri" aria-hidden="true"></span>
          <span class="turn-text">準備中</span>
        </div>
        <div id="topbarGameInfo" class="topbar-game-info hidden">
          <div class="stat-pill pill deck">
            <span class="label">Deck</span>
            <strong id="deckCount" class="value">--</strong>
          </div>
          <div class="stat-pill pill turn">
            <span class="label">Turn</span>
            <strong id="turnNumber" class="value">--</strong>
          </div>
        </div>
        <div id="connection" class="pill online-pill">
          <span class="dot"></span>
          <span>...</span>
        </div>
      </div>

      <div class="game-upper">
        <div class="players-wrapper">
          <section id="players" class="players-grid game-players"></section>
        </div>

      <div id="skipToast" class="skip-toast hidden" aria-live="polite"></div>

      <div id="cardEffectBanner" class="card-effect-banner hidden" aria-live="polite">
        <div id="cardEffectName" class="effect-name"></div>
        <div id="cardEffectText" class="effect-text"></div>
      </div>

      <div id="playedReveal" class="played-overlay hidden" aria-live="polite">
        <div id="playedBy" class="played-by-label"></div>
        <div class="played-card-new">
          <img id="playedCardImg" alt="" />
        </div>
        <div id="playedTarget" class="played-target-label hidden">対象: <span class="target"></span></div>
      </div>
      </div><!-- /game-upper -->

      <section id="handPanel" class="hand-panel">
        <div class="hand-head">
          <!-- Normal mode controls -->
          <div class="motivation-display-wrap normal-only">
            <span class="motivation-label">モチベ</span>
            <span id="motivationDisplay" class="motivation-display"></span>
          </div>
          <button id="mulliganButton" class="mulligan-btn normal-only hidden" type="button">
            <span class="ja">マリガン</span>
          </button>
          <button id="endTurnButton" class="end-turn-btn normal-only hidden" type="button">
            <span class="ja">ターン終了</span>
            <span class="en">End Turn</span>
          </button>
          <!-- Mulligan mode controls -->
          <div class="mulligan-status mulligan-only">
            <span class="ja">交換するカードを選択</span>
            <span id="mulliganCount" class="count">0枚</span>
          </div>
          <button id="mulliganCancelButton" class="cancel-btn mulligan-only" type="button">キャンセル</button>
          <button id="mulliganOkButton" class="ok-btn mulligan-only" type="button" disabled>OK</button>
        </div>
        <div id="hand" class="hand hand-cards"></div>
        <p id="playError" class="error" role="alert"></p>
      </section>
    </section>

    <!-- ========== Menu modal (log) ========== -->
    <section id="menuModal" class="modal hidden" aria-modal="true" role="dialog">
      <div class="modal-backdrop" id="modalBackdrop"></div>
      <div class="modal-panel">
        <div class="modal-head">
          <h2>Log</h2>
          <button id="closeModalButton" class="icon-button">Close</button>
        </div>
        <div id="logTabs" class="log-tabs"></div>
        <ol id="log" class="log"></ol>
      </div>
    </section>
  </div>
`;

// Spawn dust particles
(() => {
  const root = document.getElementById("bgParticles")!;
  const count = 18;
  for (let i = 0; i < count; i++) {
    const span = document.createElement("span");
    span.className = "dust";
    const hue = Math.random() > 0.5 ? "var(--accent-gold)" : "var(--accent-cyan)";
    span.style.left = Math.random() * 100 + "%";
    span.style.bottom = "-20px";
    const size = 2 + Math.random() * 3;
    span.style.width = size + "px";
    span.style.height = size + "px";
    span.style.background = hue;
    span.style.boxShadow = `0 0 8px ${hue}`;
    span.style.animationDelay = (Math.random() * 8) + "s";
    span.style.animationDuration = (10 + Math.random() * 10) + "s";
    root.appendChild(span);
  }
})();

const socket: Socket = io();
let myId = "";
let roomState: RoomState | null = null;
let revealTimer: number | undefined;
let lastRevealId = "";
let mulliganMode = false;
const mulliganSelected = new Set<string>();
let lastShownSkipId: string | null = null;
let skipToastTimer: number | undefined;

// Sequential play queue: each new lastPlayed.id is queued; the worker shows
// the overlay (2s) then advances the player-render state (animations fire).
// Lets the user actually follow rapid CPU bursts.
const playQueue: RoomState[] = [];
let processingPlayQueue = false;
let queuedPlayIds: string | null = null;       // tail tracker: highest enqueued id
let displayedPlayState: RoomState | null = null; // last state rendered into the players area
let logFilterId: string | null = null;

const connection = document.querySelector<HTMLDivElement>("#connection")!;
const connectionText = connection.querySelector<HTMLSpanElement>("span:last-child")!;
const lobbyScreen = document.querySelector<HTMLDivElement>("#lobbyScreen")!;
const gameScreen = document.querySelector<HTMLDivElement>("#gameScreen")!;
const joinPanel = document.querySelector<HTMLDivElement>("#joinPanel")!;
const roomPanel = document.querySelector<HTMLDivElement>("#roomPanel")!;
const menuButton = document.querySelector<HTMLButtonElement>("#menuButton")!;
const menuModal = document.querySelector<HTMLDivElement>("#menuModal")!;
const modalBackdrop = document.querySelector<HTMLDivElement>("#modalBackdrop")!;
const closeModalButton = document.querySelector<HTMLButtonElement>("#closeModalButton")!;
const nameInput = document.querySelector<HTMLInputElement>("#nameInput")!;
const codeInput = document.querySelector<HTMLInputElement>("#codeInput")!;
const avatarInput = document.querySelector<HTMLInputElement>("#avatarInput")!;
const createButton = document.querySelector<HTMLButtonElement>("#createButton")!;
const joinButton = document.querySelector<HTMLButtonElement>("#joinButton")!;
const startButton = document.querySelector<HTMLButtonElement>("#startButton")!;
const cpuStartButton = document.querySelector<HTMLButtonElement>("#cpuStartButton")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copyButton")!;
const joinError = document.querySelector<HTMLParagraphElement>("#joinError")!;
const playError = document.querySelector<HTMLParagraphElement>("#playError")!;
const roomCode = document.querySelector<HTMLDivElement>("#roomCode")!;
const qrCanvas = document.querySelector<HTMLCanvasElement>("#qrCanvas")!;
const inviteLink = document.querySelector<HTMLInputElement>("#inviteLink")!;
const lobbyTitle = document.querySelector<HTMLHeadingElement>("#lobbyTitle")!;
const lobbyPlayers = document.querySelector<HTMLElement>("#lobbyPlayers")!;
const topbarStatus = document.querySelector<HTMLElement>("#topbarStatus")!;
const turnText = topbarStatus.querySelector<HTMLElement>(".turn-text")!;
const topbarGameInfo = document.querySelector<HTMLElement>("#topbarGameInfo")!;
const deckCount = document.querySelector<HTMLElement>("#deckCount")!;
// Deck/Discard piles removed from game screen — counts only appear in topbar.
const turnNumber = document.querySelector<HTMLElement>("#turnNumber")!;
const players = document.querySelector<HTMLElement>("#players")!;
const playersWrapper = gameScreen.querySelector<HTMLElement>(".players-wrapper")!;
const handPanel = document.querySelector<HTMLElement>("#handPanel")!;
const hand = document.querySelector<HTMLElement>("#hand")!;
const motivationDisplay = document.querySelector<HTMLElement>("#motivationDisplay")!;
const endTurnButton = document.querySelector<HTMLButtonElement>("#endTurnButton")!;
const mulliganButton = document.querySelector<HTMLButtonElement>("#mulliganButton")!;
const mulliganCancelButton = document.querySelector<HTMLButtonElement>("#mulliganCancelButton")!;
const mulliganOkButton = document.querySelector<HTMLButtonElement>("#mulliganOkButton")!;
const mulliganCountEl = document.querySelector<HTMLElement>("#mulliganCount")!;
const log = document.querySelector<HTMLOListElement>("#log")!;
const logTabs = document.querySelector<HTMLDivElement>("#logTabs")!;
const playedReveal = document.querySelector<HTMLDivElement>("#playedReveal")!;
const skipToast = document.querySelector<HTMLDivElement>("#skipToast")!;
const playedBy = document.querySelector<HTMLDivElement>("#playedBy")!;
const playedCardImg = document.querySelector<HTMLImageElement>("#playedCardImg")!;
const playedTargetEl = document.querySelector<HTMLDivElement>("#playedTarget")!;
const playedTargetSpan = playedTargetEl.querySelector<HTMLSpanElement>(".target")!;
const cardEffectBanner = document.querySelector<HTMLDivElement>("#cardEffectBanner")!;
const cardEffectName = document.querySelector<HTMLDivElement>("#cardEffectName")!;
const cardEffectText = document.querySelector<HTMLDivElement>("#cardEffectText")!;
let effectBannerTimer: number | undefined;

function getInviteUrl(code: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  return url.toString();
}

async function renderInvite(code: string) {
  const url = getInviteUrl(code);
  roomCode.textContent = code;
  inviteLink.value = url;
  await QRCode.toCanvas(qrCanvas, url, {
    margin: 1,
    width: 104,
    color: { dark: "#0a0e18", light: "#ffffff" }
  });
}

async function resizeAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("image only");

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("load failed"));
      img.src = objectUrl;
    });

    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");

    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = Math.max(0, (image.naturalWidth - sourceSize) / 2);
    const sy = Math.max(0, (image.naturalHeight - sourceSize) / 2);
    context.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char] || char);
}

function formatFollowers(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function myPlayer(state: RoomState) {
  return state.players.find((player) => player.id === myId) || null;
}

function currentPlayer(state: RoomState) {
  return state.players.find((player) => player.id === state.currentPlayerId) || null;
}

function isMyTurn(state: RoomState) {
  return state.phase === "playing" && state.currentPlayerId === myId;
}

function playerIndex(state: RoomState, player: Player) {
  // Stable index based on join order
  return state.players.findIndex(p => p.id === player.id);
}

function statusBadges(player: Player, state: RoomState) {
  // HOST is represented by the crown overlay on the avatar.
  // CPU is implicit (no badge required).
  // Role is not displayed — role effects are disabled in v0.3.
  void state;
  const out: string[] = [];
  if (player.skipTurns > 0) out.push(`<span class="badge rest">休み${player.skipTurns}</span>`);
  const totalGain = (player.gainBoosts ?? 0) * 10 + (player.trendingBoosts ?? 0) * 30;
  if (totalGain > 0) out.push(`<span class="badge boost">+${totalGain}%</span>`);
  if (player.premiumSubscribed) out.push(`<span class="badge premium">プレミアム</span>`);
  else if (player.subscribed) out.push(`<span class="badge sub">サブスク</span>`);
  if ((player.antiTurns ?? 0) > 0) out.push(`<span class="badge anti">アンチ</span>`);
  if (player.shielded) {
    const t = player.shieldTurns ?? 0;
    out.push(`<span class="badge shield">🔒${t > 0 ? t : ""}</span>`);
  }
  if (player.retired) out.push(`<span class="badge retired">引退</span>`);
  if (!player.connected) out.push(`<span class="badge offline">offline</span>`);
  return out.join("");
}

function playerCard(player: Player, state: RoomState) {
  const idx = playerIndex(state, player);
  const ring = ringFor(idx);
  const isYou = player.id === myId;
  const isActive = player.id === state.currentPlayerId;
  const classes = [
    "player-card",
    "player",                          // legacy class for pointer-drag CSS
    isYou ? "you" : "",
    isActive ? "active" : "",
    player.burning ? "burning" : "",
    player.retired ? "retired" : "",
    player.shielded ? "shielded" : ""
  ].filter(Boolean).join(" ");
  const style = `--ring-color:${ring.ring};--ring-glow:${ring.glow};--follower-color:${ring.followers};`;
  const crown = player.id === state.hostId ? `<span class="player-crown">👑</span>` : "";
  const youTag = isYou ? `<span class="you-tag">あなた</span>` : "";

  // Flame overlay inside avatar (when burning)
  const flameOverlay = player.burning ? `
    <div class="flame-overlay" aria-hidden="true">
      <span class="flame f1"></span>
      <span class="flame f2"></span>
      <span class="flame f3"></span>
      <span class="flame f4"></span>
      <span class="flame f5"></span>
      <span class="ember e1"></span>
      <span class="ember e2"></span>
      <span class="ember e3"></span>
    </div>
  ` : "";

  // Shield (鍵垢) overlay (when shielded)
  const shieldOverlay = player.shielded ? `
    <div class="shield-overlay" aria-hidden="true">
      <div class="lock-icon">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 1 1 6 0v3H9zm3 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/>
        </svg>
      </div>
    </div>
  ` : "";

  return `
    <article class="${classes}" data-player-id="${player.id}" style="${style}">
      ${youTag}
      <div class="player-avatar">
        <img src="${escapeHtml(playerAvatarSrc(player, idx))}" alt="" />
        ${crown}
        ${flameOverlay}
        ${shieldOverlay}
      </div>
      <div class="player-name">${escapeHtml(player.name)}</div>
      <div class="player-followers-wrap">
        <div class="player-followers">${formatFollowers(player.followers)}</div>
      </div>
      <div class="player-followers-label">フォロワー</div>
      <div class="player-badges">${statusBadges(player, state)}</div>
    </article>
  `;
}

// Track previous follower counts / states to detect changes between server states
const prevFollowers = new Map<string, number>();
const prevBurning = new Map<string, boolean>();
const prevShielded = new Map<string, boolean>();

function applyChangeEffects(state: RoomState) {
  for (const p of state.players) {
    const prev = prevFollowers.get(p.id);
    const el = players.querySelector<HTMLElement>(`[data-player-id="${p.id}"]`);
    if (el && prev !== undefined && prev !== p.followers) {
      const diff = p.followers - prev;
      if (diff > 0) triggerBoost(el, diff);
      else triggerDamage(el, diff);
    }
    const wasBurning = prevBurning.get(p.id);
    if (!wasBurning && p.burning && (window as any).SFX) (window as any).SFX.fire?.();
    const wasShielded = prevShielded.get(p.id);
    if (!wasShielded && p.shielded && (window as any).SFX) (window as any).SFX.shield?.();
    prevBurning.set(p.id, p.burning);
    prevShielded.set(p.id, p.shielded);
    prevFollowers.set(p.id, p.followers);
  }
}

function triggerBoost(el: HTMLElement, diff: number) {
  el.classList.add("boosted");
  if ((window as any).SFX) (window as any).SFX.gain?.();
  spawnDelta(el, `+${formatFollowers(diff)}`, "pos");
  const sparkLayer = document.createElement("div");
  sparkLayer.className = "boost-particles";
  const count = 14;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const dist = 60 + Math.random() * 40;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist - 30;
    const s = document.createElement("span");
    s.className = "boost-spark";
    s.style.setProperty("--tx", tx + "px");
    s.style.setProperty("--ty", ty + "px");
    s.style.animationDelay = (Math.random() * 0.15) + "s";
    sparkLayer.appendChild(s);
  }
  el.appendChild(sparkLayer);
  setTimeout(() => { el.classList.remove("boosted"); sparkLayer.remove(); }, 1000);
}

function triggerDamage(el: HTMLElement, diff: number) {
  el.classList.add("damaged");
  if ((window as any).SFX) (window as any).SFX.loss?.();
  spawnDelta(el, formatFollowers(diff), "neg");
  const flash = document.createElement("div");
  flash.className = "damage-flash";
  el.appendChild(flash);
  const crack = document.createElement("div");
  crack.className = "damage-crack";
  crack.innerHTML = `
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <g stroke="rgba(255,255,255,0.85)" stroke-width="1.2" fill="none" stroke-linecap="round" filter="drop-shadow(0 0 4px rgba(239,68,68,0.9))">
        <path d="M50 8 L48 28 L40 38 L55 50 L42 62 L52 78 L46 92" />
        <path d="M48 28 L30 26 L18 38" />
        <path d="M55 50 L70 44 L82 52" />
        <path d="M42 62 L24 66 L14 80" />
        <path d="M52 78 L66 76 L80 86" />
      </g>
    </svg>
  `;
  el.appendChild(crack);
  setTimeout(() => { el.classList.remove("damaged"); flash.remove(); crack.remove(); }, 1000);
}

function spawnDelta(el: HTMLElement, text: string, kind: "pos" | "neg") {
  const wrap = el.querySelector<HTMLElement>(".player-followers-wrap");
  if (!wrap) return;
  wrap.querySelectorAll(".follower-delta-big").forEach(n => n.remove());
  const span = document.createElement("span");
  span.className = `follower-delta-big ${kind}`;
  span.textContent = text;
  wrap.appendChild(span);
  setTimeout(() => span.remove(), 1900);
}

function renderPlayers(state: RoomState) {
  const sorted = state.players.slice().sort((a, b) => {
    if (a.retired !== b.retired) return a.retired ? 1 : -1;
    return 0;
  });
  players.dataset.count = String(Math.min(6, Math.max(2, sorted.length)));
  players.innerHTML = sorted.map((p) => playerCard(p, state)).join("");
  applyChangeEffects(state);
}

function renderLobbyPlayers(state: RoomState) {
  const slots: (Player | null)[] = state.players.slice();
  while (slots.length < state.maxPlayers) slots.push(null);

  lobbyPlayers.innerHTML = slots.map((p, i) => {
    if (!p) {
      return `
        <div class="lobby-player empty">
          <div class="empty-avatar">+</div>
          <div class="name">空席</div>
          <div class="role">待機中…</div>
        </div>
      `;
    }
    const idx = playerIndex(state, p);
    const ring = ringFor(idx);
    const isYou = p.id === myId;
    return `
      <div class="lobby-player ${isYou ? "you" : ""}" data-player-id="${p.id}">
        ${isYou ? `<span class="you-tag">YOU</span>` : ""}
        <div class="avatar" style="--ring-color:${ring.ring};--ring-glow:${ring.glow}">
          <img src="${escapeHtml(playerAvatarSrc(p, idx))}" alt="" />
          ${isYou ? `<button class="avatar-upload" type="button" aria-label="Change avatar">Change</button>` : ""}
        </div>
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="role">${p.isCpu ? "CPU" : (p.id === state.hostId ? "Host" : "Ready")}</div>
      </div>
    `;
  }).join("");
}

function needsTarget(card: Card) {
  return card.target === "opponent";
}

function renderHand(state: RoomState) {
  const myTurn = isMyTurn(state);
  const prevScroll = hand.scrollLeft;
  hand.innerHTML = state.myHand.map((card, i) => {
    const cost = card.effectiveCost ?? card.cost;
    const affordable = cost <= state.currentMotivation;
    // In mulligan mode every owned card is tappable (for selection).
    const playable = mulliganMode ? true : (myTurn && affordable);
    const type = CARD_TYPE[card.key] || "grow";
    const selected = mulliganMode && mulliganSelected.has(card.id);
    const cls = [
      "hand-card",
      "card",                      // legacy class kept for pointer handler
      mulliganMode ? "mulligan-pickable" : (!myTurn ? "disabled" : ""),
      // unaffordable styling only on my turn — opponents' turns shouldn't dim cards.
      !mulliganMode && myTurn && !affordable ? "unaffordable" : "",
      selected ? "mulligan-selected" : ""
    ].filter(Boolean).join(" ");
    return `
      <button class="${cls}" data-type="${type}" data-card-id="${card.id}" style="--i:${i}" ${playable ? "" : "disabled"} title="${escapeHtml(card.name)} — ${escapeHtml(card.text)}">
        <img src="${cardSrc(card.key)}" alt="${escapeHtml(card.name)}" draggable="false" />
        <span class="cost-badge" data-cost="${cost}">${cost}</span>
        ${needsTarget(card) ? `<span class="target-tag">対象</span>` : ""}
        ${mulliganMode ? `<span class="mulligan-check" aria-hidden="true">✓</span>` : ""}
      </button>
    `;
  }).join("");
  hand.scrollLeft = prevScroll;
}

function renderLog(state: RoomState) {
  const tabs = [{ id: null as string | null, label: "全員" }, ...state.players.map(p => ({ id: p.id as string | null, label: p.name }))];
  logTabs.innerHTML = tabs.map(t => `
    <button class="log-tab${logFilterId === t.id ? " active" : ""}" data-id="${t.id ?? ""}">
      ${escapeHtml(t.label)}
    </button>
  `).join("");
  logTabs.querySelectorAll<HTMLButtonElement>(".log-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      logFilterId = btn.dataset.id || null;
      renderLog(state);
    });
  });
  const entries = state.structuredLog;
  const filtered = logFilterId
    ? entries.filter(e => e.subjectId === logFilterId || e.targetId === logFilterId)
    : entries;
  log.innerHTML = filtered.map(e => `<li>${escapeHtml(e.text)}</li>`).join("");
  log.scrollTop = log.scrollHeight;
}

type OverlayOpts = {
  cardKey: string;
  playerName: string | null;     // null for preview (no badge)
  targetName: string | null;
  durationMs?: number;
  /** If true, stays visible indefinitely (no auto-dismiss timer). */
  persistent?: boolean;
  /** Optional card name + resolved effect text for the top banner. */
  cardName?: string;
  cardText?: string;
  /** Banner-specific duration (effect text often outlasts the card image). */
  bannerDurationMs?: number;
};

let lastOverlayCardKey: string | null = null;
let cleanupTimer: number | undefined;
let activePreviewCardId: string | null = null;

function showCardOverlay(opts: OverlayOpts) {
  // Pop animation only when the overlay was hidden (fresh entry) or when this
  // is a real play (non-persistent). Switching between two persistent previews
  // should be an instant image swap — no shrink-and-bounce.
  const wasShowing = playedReveal.classList.contains("playing");
  const shouldPop = !wasShowing || !opts.persistent;

  window.clearTimeout(revealTimer);
  window.clearTimeout(cleanupTimer);

  playedCardImg.src = cardSrc(opts.cardKey);
  if (opts.playerName) {
    playedBy.textContent = `${opts.playerName} がプレイ`;
    playedBy.classList.remove("hidden");
  } else {
    playedBy.textContent = "";
    playedBy.classList.add("hidden");
  }
  if (opts.targetName) {
    playedTargetSpan.textContent = opts.targetName;
    playedTargetEl.classList.remove("hidden");
  } else {
    playedTargetEl.classList.add("hidden");
  }

  playedReveal.classList.remove("hidden");
  void playedReveal.offsetWidth;
  playedReveal.classList.add("playing");
  if (shouldPop) {
    playedReveal.classList.remove("popping");
    void playedReveal.offsetWidth;
    playedReveal.classList.add("popping");
  }

  // Top banner: card name + effect text. Separate timing so it can outlast
  // the big card image during a play (covering follower delta animations).
  if (opts.cardName || opts.cardText) {
    showCardEffectBanner(opts.cardName ?? "", opts.cardText ?? "", {
      persistent: opts.persistent,
      durationMs: opts.bannerDurationMs
    });
  }

  lastOverlayCardKey = opts.cardKey;

  if (opts.persistent) return;

  // Non-persistent (real play): the user's tap-preview session is done.
  activePreviewCardId = null;
  const duration = opts.durationMs ?? 3000;
  revealTimer = window.setTimeout(() => hideCardOverlay({ keepBanner: true }), duration);
}

function hideCardOverlay(opts: { keepBanner?: boolean } = {}) {
  window.clearTimeout(revealTimer);
  window.clearTimeout(cleanupTimer);
  playedReveal.classList.remove("playing");
  activePreviewCardId = null;
  if (!opts.keepBanner) hideCardEffectBanner();
  cleanupTimer = window.setTimeout(() => {
    if (!playedReveal.classList.contains("playing")) {
      playedReveal.classList.add("hidden");
      playedReveal.classList.remove("popping");
      lastOverlayCardKey = null;
    }
  }, 250);
}

function showCardEffectBanner(
  name: string,
  text: string,
  opts: { persistent?: boolean; durationMs?: number } = {}
) {
  window.clearTimeout(effectBannerTimer);
  cardEffectName.textContent = name;
  cardEffectText.textContent = text;
  cardEffectBanner.classList.remove("hidden");
  void cardEffectBanner.offsetWidth;
  cardEffectBanner.classList.add("showing");
  if (opts.persistent) return;
  const duration = opts.durationMs ?? 3500;
  effectBannerTimer = window.setTimeout(() => hideCardEffectBanner(), duration);
}

function hideCardEffectBanner() {
  window.clearTimeout(effectBannerTimer);
  cardEffectBanner.classList.remove("showing");
  window.setTimeout(() => {
    if (!cardEffectBanner.classList.contains("showing")) {
      cardEffectBanner.classList.add("hidden");
    }
  }, 220);
}

function showPlayedReveal(state: RoomState) {
  const played = state.lastPlayed;
  if (!played) return;
  lastRevealId = played.id;

  // Big card image: 2s. Effect banner persists ~3.5s so it spans the follower
  // delta animations that fire after renderPlayers (which itself runs +2s after
  // the play). Total: card image 2s + delta anim ~1.9s ≈ 3.9s.
  showCardOverlay({
    cardKey: played.cardKey || extractKeyFromName(played) || "daily_stream",
    playerName: played.playerName,
    targetName: played.targetName,
    durationMs: 2000,
    cardName: played.cardName,
    cardText: played.cardText,
    bannerDurationMs: 3800
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function showSkipToast(skip: LastSkipped) {
  if (skip.id === lastShownSkipId) return;
  lastShownSkipId = skip.id;
  window.clearTimeout(skipToastTimer);
  skipToast.innerHTML = `
    <div class="skip-toast-inner">
      <div class="skip-toast-icon">⏭</div>
      <div class="skip-toast-text">
        <div class="skip-toast-name">${escapeHtml(skip.playerName)}</div>
        <div class="skip-toast-reason">${escapeHtml(skip.reason)}でターンスキップ</div>
      </div>
    </div>
  `;
  skipToast.classList.remove("hidden");
  void skipToast.offsetWidth;
  skipToast.classList.add("showing");
  skipToastTimer = window.setTimeout(() => {
    skipToast.classList.remove("showing");
    window.setTimeout(() => skipToast.classList.add("hidden"), 250);
  }, 2000);
}

// LastPlayed only carries cardName/cardText. We need the card key for image lookup.
// Map by cardName (Japanese) → key.
const NAME_TO_KEY: Record<string, string> = {
  "毎日配信": "daily_stream",
  "配信おやすみ": "day_off",
  "コラボ配信": "collab_stream",
  "なりすまし": "impersonate",
  "重大なお知らせ": "big_announcement",
  "緊急で動画を回す": "emergency_video",
  "暴露": "expose",
  "炎上": "scandal",
  "謝罪": "apology",
  "鍵垢にする": "shield",
  "くそマロ": "kusomaro",
  "サブスク開始": "subscription",
  "プレミアムサブスク": "premium_subscription",
  "渾身のネタ": "signature_topic",
  "業界の闇暴露": "industry_expose",
  "アンチを送る": "send_anti",
  "企業案件": "sponsorship",
  "トレンド入り": "trending"
};
function extractKeyFromName(played: LastPlayed): string | null {
  return NAME_TO_KEY[played.cardName] || null;
}

function updateUi(state: RoomState | null) {
  roomState = state;
  if (!state) return;

  const me = myPlayer(state);
  const current = currentPlayer(state);
  const inGame = state.phase !== "lobby";

  lobbyScreen.classList.toggle("hidden", inGame);
  gameScreen.classList.toggle("hidden", !inGame);
  joinPanel.classList.toggle("hidden", Boolean(myId));
  roomPanel.classList.toggle("hidden", !myId);

  startButton.hidden = state.hostId !== myId || state.phase === "playing";
  cpuStartButton.hidden = state.hostId !== myId || state.phase === "playing";
  startButton.disabled = state.players.length < 2;
  cpuStartButton.disabled = state.players.length >= state.maxPlayers;

  lobbyTitle.textContent = myId
    ? `${state.players.length}/${state.maxPlayers}人 参加中`
    : "ルームを作成または参加";

  deckCount.textContent = String(state.deckCount);
  turnNumber.textContent = state.phase === "lobby" ? "--" : `T${state.turnNumber}`;
  topbarGameInfo.classList.toggle("hidden", state.phase === "lobby");

  if (state.phase === "finished") {
    const winners = state.players.filter((player) => state.winnerIds.includes(player.id));
    turnText.textContent = winners.length > 0
      ? `勝者: ${winners.map((player) => player.name).join(", ")}`
      : "ゲーム終了";
    topbarStatus.classList.add("finished");
  } else if (state.phase === "playing" && current) {
    turnText.textContent = current.id === myId ? "あなたのターン" : `${current.name} のターン`;
    topbarStatus.classList.toggle("you", current.id === myId);
    topbarStatus.classList.remove("finished");
  } else {
    turnText.textContent = "";
    topbarStatus.classList.remove("you", "finished");
  }

  if (me?.retired) turnText.textContent = "あなたは引退";

  const myTurn = isMyTurn(state);
  // Auto-exit mulligan mode if it's no longer our turn, hand is empty,
  // or we've already used mulligan this turn.
  if (mulliganMode && (!myTurn || state.myHand.length === 0 || state.myMulliganedThisTurn)) {
    mulliganMode = false;
    mulliganSelected.clear();
    handPanel.classList.remove("mulligan-mode");
  }
  const mot = state.currentMotivation ?? 3;
  const max = Math.max(3, state.maxMotivation ?? 3);
  motivationDisplay.innerHTML = myTurn
    ? Array.from({ length: max }, (_, i) =>
        `<span class="flame ${i < mot ? "on" : "off"}">🔥</span>`
      ).join("")
    : "";
  endTurnButton.classList.toggle("hidden", !myTurn || mulliganMode);

  // Mulligan button: shown on my turn, hand has cards, not yet used this turn,
  // and we're not currently in mulligan selection mode.
  const canMulligan = myTurn
    && !state.myMulliganedThisTurn
    && state.myHand.length > 0
    && !me?.retired;
  mulliganButton.classList.toggle("hidden", !canMulligan || mulliganMode);

  renderInvite(state.code);
  renderLobbyPlayers(state);
  renderHand(state);
  renderLog(state);
  if (state.lastSkipped) showSkipToast(state.lastSkipped);

  // === Player avatars + card overlay: sequential / deferred ===
  // If this state contains a newly-played card, queue it. The worker pops one
  // at a time: shows the overlay for 2s, then re-renders players (which lets
  // applyChangeEffects fire follower-delta animations against the previous
  // frozen snapshot). This way the user always has 2s of "what just happened"
  // before the avatars react.
  const playId = state.lastPlayed?.id ?? null;
  if (playId && playId !== queuedPlayIds) {
    queuedPlayIds = playId;
    playQueue.push(state);
    // While queued, keep the players frozen at the last displayed snapshot.
    if (displayedPlayState) renderPlayers(displayedPlayState);
    else { displayedPlayState = state; renderPlayers(state); }
    if (!processingPlayQueue) processPlayQueue();
  } else if (!processingPlayQueue) {
    // Idle and no new card → render immediately, catch displayedPlayState up.
    displayedPlayState = state;
    renderPlayers(state);
  } else {
    // Queue is working: leave players frozen, worker will catch up.
  }

  // Phase change to non-playing (game over / back to lobby): flush queue.
  if (state.phase !== "playing" && playQueue.length > 0) {
    playQueue.length = 0;
    queuedPlayIds = null;
    displayedPlayState = state;
    renderPlayers(state);
  }
}

async function processPlayQueue() {
  processingPlayQueue = true;
  try {
    while (playQueue.length > 0) {
      const target = playQueue.shift()!;
      // Show the overlay for the played card (2s).
      showPlayedReveal(target);
      await delay(2000);
      // Render players with the new state — animations fire via applyChangeEffects.
      displayedPlayState = target;
      renderPlayers(target);
      // Small breather so the boost/damage animation has air before the next overlay.
      await delay(600);
    }
  } finally {
    processingPlayQueue = false;
  }
  // Catch up to the latest server state if it advanced (e.g. turn change with no play).
  if (roomState && roomState !== displayedPlayState) {
    displayedPlayState = roomState;
    renderPlayers(roomState);
  }
}

function callback<T>(event: string, payload: unknown) {
  return new Promise<T>((resolve) => {
    socket.emit(event, payload, (reply: T) => resolve(reply));
  });
}

createButton.addEventListener("click", async () => {
  joinError.textContent = "";
  const reply = await callback<{ ok: boolean; room?: RoomState; playerId?: string; error?: string }>("room:create", {
    name: nameInput.value
  });
  if (!reply.ok || !reply.room || !reply.playerId) {
    joinError.textContent = reply.error || "Could not create room";
    return;
  }
  myId = reply.playerId;
  updateUi(reply.room);
});

joinButton.addEventListener("click", async () => {
  joinError.textContent = "";
  const reply = await callback<{ ok: boolean; room?: RoomState; playerId?: string; error?: string }>("room:join", {
    code: codeInput.value,
    name: nameInput.value
  });
  if (!reply.ok || !reply.room || !reply.playerId) {
    joinError.textContent = reply.error || "Could not join room";
    return;
  }
  myId = reply.playerId;
  updateUi(reply.room);
});

lobbyPlayers.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(".avatar-upload");
  if (!button) return;
  avatarInput.value = "";
  avatarInput.click();
});

avatarInput.addEventListener("change", async () => {
  const file = avatarInput.files?.[0];
  if (!file || !myId) return;

  joinError.textContent = "";
  try {
    const avatarDataUrl = await resizeAvatar(file);
    const reply = await callback<{ ok: boolean; error?: string }>("room:setAvatar", { avatarDataUrl });
    if (!reply.ok) joinError.textContent = reply.error || "Could not update avatar";
  } catch {
    joinError.textContent = "Could not read image";
  }
});

startButton.addEventListener("click", () => socket.emit("game:start"));
cpuStartButton.addEventListener("click", () => socket.emit("game:startWithCpu"));
endTurnButton.addEventListener("click", () => {
  socket.emit("game:endTurn");
  if ((window as any).SFX) (window as any).SFX.end?.();
});

function enterMulliganMode() {
  mulliganMode = true;
  mulliganSelected.clear();
  handPanel.classList.add("mulligan-mode");
  hideCardOverlay();
  if (roomState) renderHand(roomState);
  refreshMulliganUi();
}

function exitMulliganMode() {
  mulliganMode = false;
  mulliganSelected.clear();
  handPanel.classList.remove("mulligan-mode");
  if (roomState) updateUi(roomState);
}

function refreshMulliganUi() {
  const n = mulliganSelected.size;
  mulliganCountEl.textContent = `${n}枚`;
  mulliganOkButton.disabled = n === 0;
}

function toggleMulliganCard(cardId: string) {
  if (mulliganSelected.has(cardId)) mulliganSelected.delete(cardId);
  else mulliganSelected.add(cardId);
  // Update only the affected card's visual + count
  const button = hand.querySelector<HTMLButtonElement>(`[data-card-id="${CSS.escape(cardId)}"]`);
  button?.classList.toggle("mulligan-selected", mulliganSelected.has(cardId));
  refreshMulliganUi();
}

mulliganButton.addEventListener("click", () => {
  if (!roomState || !isMyTurn(roomState)) return;
  enterMulliganMode();
});

mulliganCancelButton.addEventListener("click", () => exitMulliganMode());

mulliganOkButton.addEventListener("click", async () => {
  if (mulliganSelected.size === 0) return;
  const ids = Array.from(mulliganSelected);
  mulliganOkButton.disabled = true;
  playError.textContent = "";

  // socket.io has no built-in ack timeout. If the server doesn't have the
  // game:mulligan handler (e.g. node wasn't restarted), the callback would
  // hang forever and the OK button would stay stuck. Race it ourselves.
  const timeoutReply = new Promise<{ ok: false; error: string }>((resolve) => {
    window.setTimeout(
      () => resolve({ ok: false, error: "サーバー応答なし。node server/index.js を再起動してください" }),
      3000
    );
  });
  const reply = await Promise.race([
    callback<{ ok: boolean; error?: string }>("game:mulligan", { cardIds: ids }),
    timeoutReply
  ]);

  if (!reply.ok) {
    playError.textContent = reply.error || "マリガンに失敗しました";
    mulliganOkButton.disabled = false;
    refreshMulliganUi();
    return;
  }
  exitMulliganMode();
});

// Tap anywhere outside the hand panel dismisses the persistent preview.
// (Tapping a hand card opens/switches preview; tapping action buttons inside
// the hand-head is also part of #handPanel so it doesn't dismiss either.)
gameScreen.addEventListener("pointerdown", (e) => {
  if (activePreviewCardId === null) return;
  const target = e.target as Element | null;
  if (target?.closest("#handPanel")) return;
  hideCardOverlay();
});

function setModalOpen(open: boolean) {
  menuModal.classList.toggle("hidden", !open);
  if (open) log.scrollTop = log.scrollHeight;
}

menuButton.addEventListener("click", () => setModalOpen(true));
modalBackdrop.addEventListener("click", () => setModalOpen(false));
closeModalButton.addEventListener("click", () => setModalOpen(false));

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(inviteLink.value);
  copyButton.textContent = "Copied";
  setTimeout(() => {
    copyButton.textContent = "Copy";
  }, 1200);
});

hand.addEventListener("pointerdown", (e) => {
  // Mouse: only primary (left) button. Touch/pen always report button 0.
  if (e.button !== 0) return;
  const button = (e.target as Element).closest<HTMLButtonElement>(".card");
  if (!button) return;

  // Mulligan selection mode: tap toggles selection instead of preview/play.
  if (mulliganMode) {
    const cardId = button.dataset.cardId;
    if (cardId) toggleMulliganCard(cardId);
    return;
  }

  const isMouse = e.pointerType === "mouse";
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  let dragCard: Card | undefined;
  let savedScroll = 0;
  button.classList.add("peeked");

  // Capture the pointer to the button IMMEDIATELY so that subsequent
  // pointermove events still fire on the button (and bubble to `hand`)
  // even after the finger moves above the hand area. Without this, a fast
  // upward swipe loses pointermove events as soon as the finger crosses into
  // the players area, so dragging is never detected.
  try { button.setPointerCapture(e.pointerId); } catch {}

  // Tap to activate the persistent preview. Stays shown until:
  //  - another card is tapped (preview switches)
  //  - the card is played (server response transitions to play animation)
  //  - another player plays (CPU broadcast clobbers preview)
  // Re-tapping the same card is a no-op (re-renders the same image).
  const cardId = button.dataset.cardId ?? null;
  const tappedCard = roomState?.myHand.find(c => c.id === cardId);

  if (tappedCard) {
    showCardOverlay({
      cardKey: tappedCard.key,
      playerName: null,
      targetName: null,
      persistent: true,
      cardName: tappedCard.name,
      cardText: tappedCard.text
    });
    activePreviewCardId = cardId;
  }

  const clearHighlights = () => {
    players.querySelectorAll<HTMLElement>(".drop-target").forEach(el => el.classList.remove("drop-target"));
    playersWrapper.classList.remove("drop-zone");
  };

  const playerUnderPointer = (x: number, y: number): HTMLElement | null => {
    button.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    button.style.pointerEvents = "";
    return el?.closest<HTMLElement>("[data-player-id]") ?? null;
  };

  const onMove = (ev: PointerEvent) => {
    if (!dragging) {
      const dy = startY - ev.clientY;       // positive = moved up
      const dx = Math.abs(ev.clientX - startX);
      const ady = Math.abs(ev.clientY - startY);
      // Mouse: any-direction 6px threshold (PC users naturally drag in any direction).
      // Touch: keep the "must swipe up" gesture so horizontal swipes don't false-trigger.
      const startedDrag = isMouse
        ? dx + ady >= 6
        : dy >= 12 && dx <= dy;
      if (!startedDrag) return;
      dragging = true;
      dragCard = roomState?.myHand.find(c => c.id === button.dataset.cardId);
      button.classList.add("dragging");
      savedScroll = hand.scrollLeft;
      hand.style.overflow = "visible";
      gameScreen.style.overflow = "visible";
      // Drag committed: dismiss the persistent preview so the user can see
      // the players area and choose a target.
      hideCardOverlay();
    }
    button.style.transform = `translate(${ev.clientX - startX - savedScroll}px, ${ev.clientY - startY}px)`;

    const inMain = ev.clientY < handPanel.getBoundingClientRect().top;
    if (dragCard && needsTarget(dragCard)) {
      clearHighlights();
      const playerEl = playerUnderPointer(ev.clientX, ev.clientY);
      if (inMain && playerEl && playerEl.dataset.playerId !== myId) {
        playerEl.classList.add("drop-target");
      }
    } else if (dragCard) {
      playersWrapper.classList.toggle("drop-zone", inMain);
    }
  };

  const onUp = async (ev: PointerEvent) => {
    clearHighlights();
    button.classList.remove("peeked", "dragging");
    button.style.transform = "";
    if (dragging) {
      hand.style.overflow = "";
      hand.scrollLeft = savedScroll;
      gameScreen.style.overflow = "";
    }
    hand.removeEventListener("pointermove", onMove);
    hand.removeEventListener("pointerup", onUp);
    hand.removeEventListener("pointercancel", onUp);

    // No play attempt → keep preview as-is (never auto-dismiss on tap-release).
    if (!dragging || button.disabled || !roomState || !isMyTurn(roomState)) {
      return;
    }
    if (ev.clientY >= handPanel.getBoundingClientRect().top) {
      // Dragged but released back over the hand → cancel; keep preview shown.
      return;
    }

    const card = dragCard ?? roomState.myHand.find(c => c.id === button.dataset.cardId);
    if (!card) return;

    let targetId: string | undefined;
    if (needsTarget(card)) {
      const playerEl = playerUnderPointer(ev.clientX, ev.clientY);
      if (!playerEl || playerEl.dataset.playerId === myId) {
        playError.textContent = "対象のプレイヤーの上で離してください";
        return;
      }
      targetId = playerEl.dataset.playerId;
    }

    playError.textContent = "";
    if ((window as any).SFX) (window as any).SFX.play?.();
    const reply = await callback<{ ok: boolean; error?: string }>("game:playCard", {
      cardId: button.dataset.cardId,
      targetId
    });
    if (!reply.ok) {
      playError.textContent = reply.error || "カードを使えませんでした";
      // Keep preview shown; user can retry.
    }
    // On success: server's room:state arrives → showPlayedReveal → showCardOverlay
    // (non-persistent) updates the playerName badge and starts the 3s dismiss timer.
  };

  hand.addEventListener("pointermove", onMove);
  hand.addEventListener("pointerup", onUp);
  hand.addEventListener("pointercancel", onUp);
});

socket.on("connect", () => {
  connectionText.textContent = "online";
  connection.classList.add("online");
});

socket.on("disconnect", () => {
  connectionText.textContent = "offline";
  connection.classList.remove("online");
});

socket.on("room:state", (state: RoomState) => updateUi(state));

const codeFromUrl = new URLSearchParams(window.location.search).get("room");
if (codeFromUrl) codeInput.value = codeFromUrl.toUpperCase().slice(0, 4);
