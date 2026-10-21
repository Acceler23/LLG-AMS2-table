// overlay/track-stats.js
// Estatisticas da pista: os 5 primeiros de um dado do multiseason do RLT
// (ultimos vencedores, ultimas poles ou recordes da pista). O dado e o
// multiseason sao escolhidos no painel (aba Transmissao).
// A pista vem do painel ou, no automatico, do jogo: com temporada aplicada,
// pela etapa do RLT que bate com a pista do jogo; sem, pelo nome da pista.

const WS_URL = `ws://${location.hostname}:${location.port || 8080}/ws`;
const BASE_WIDTH = 420; // largura do desenho em px (track-stats.css)

let stats = null; // { key, name, stat, trackId, tracks }
let rltConfig = null;
let gameTrack = { location: "", variation: "" };

const logoLoader = LLGLogos.createLoader("assets");

function escapeHtml(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function currentTrack() {
  const tracks = (stats && stats.tracks) || [];
  if (stats && stats.trackId != null) return tracks.find((t) => t.trackId === stats.trackId) || null;
  if (!gameTrack.location) return null;
  const shown = LLGDisplay.trackDisplay(gameTrack.location, gameTrack.variation);
  const names = [gameTrack.location, `${gameTrack.location} ${gameTrack.variation}`, shown.name, `${shown.name} ${shown.layout}`];
  const event = rltConfig && rltConfig.events ? LLGDisplay.matchEvent(rltConfig.events, names, Date.now()) : null;
  return LLGDisplay.matchTrack(tracks, event ? names.concat([event.trackName, event.circuitOrigin]) : names, event && event.uniqueName);
}

// redesenho com o limite de FPS do painel (shared/framecap.js)
function render() {
  return LLGFrameCap.run(renderNow, []);
}

function renderNow() {
  const root = document.getElementById("track-stats");
  if (typeof HEADER_COLOR !== "undefined" && HEADER_COLOR) root.style.setProperty("--header-color", HEADER_COLOR);
  const track = stats ? currentTrack() : null;
  if (!track) {
    root.classList.add("hidden");
    return;
  }
  root.classList.remove("hidden");
  document.getElementById("tsTitle").textContent = LLGTrackStats.title(stats.stat);
  document.getElementById("tsTrack").textContent = track.name;
  document.getElementById("tsSeason").textContent = stats.name || "";
  const flagEl = document.getElementById("tsFlag");
  const flag = LLGDisplay.flagFile(track.country);
  if (flag) logoLoader.load(flagEl, [flag]);
  else logoLoader.hide(flagEl);

  const rows = LLGTrackStats.rows(track, stats.stat);
  const rowsEl = document.getElementById("tsRows");
  rowsEl.innerHTML = rows.length
    ? rows
        .map(
          (r) => `
      <div class="ts-row">
        <div class="ts-name">${r.tag ? `<span class="ts-tag">${escapeHtml(r.tag)}</span>` : ""}<span class="ts-name-text">${escapeHtml(r.name)}</span></div>
        <div class="ts-value${r.small ? " small" : ""}">${escapeHtml(r.value)}</div>
      </div>`
        )
        .join("")
    : `<div class="ts-empty">Primeira visita da liga a esta pista.</div>`;
  rowsEl.querySelectorAll(".ts-name-text, .ts-value").forEach(fitText);
}

// Texto que nao cabe diminui ate MIN_FONT_PX; se ainda assim nao couber, corta com "...".
const MIN_FONT_PX = 12;
function fitText(el) {
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth + 1 && size > MIN_FONT_PX) {
    size -= 1;
    el.style.fontSize = `${size}px`;
  }
}

function handleStandings(payload) {
  const session = payload && !Array.isArray(payload) ? payload.session : null;
  if (!session || !session.trackLocation) return; // sem pista nova: fica a ultima
  if (session.trackLocation === gameTrack.location && (session.trackVariation || "") === gameTrack.variation) return;
  gameTrack = { location: session.trackLocation, variation: session.trackVariation || "" };
  render();
}

// O servidor manda a "versao" dos arquivos da overlay; se mudar, recarrega.
let overlayBuildId = null;
function checkBuildId(id) {
  if (!id) return;
  if (overlayBuildId === null) overlayBuildId = id;
  else if (id !== overlayBuildId) location.reload();
}

function connect() {
  const socket = new WebSocket(WS_URL);
  socket.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (_) {
      return;
    }
    LLGFrameCap.handle(msg); // limite de FPS do painel
    if (msg.type === "standings") handleStandings(msg.data);
    else if (msg.type === "hello") checkBuildId(msg.buildId);
    else if (msg.type === "trackStats") {
      stats = msg.data || null;
      render();
    } else if (msg.type === "rltConfig") {
      rltConfig = msg.data || null;
      render();
    } else if (msg.type === "assetsConfig") {
      logoLoader.setConfig(msg.data || {});
      render();
    }
  });
  socket.addEventListener("close", () => setTimeout(connect, 500));
}

function fitToWindow() {
  document.documentElement.style.zoom = String(Math.max(0.3, window.innerWidth / BASE_WIDTH));
}
window.addEventListener("resize", fitToWindow);
fitToWindow();

connect();
