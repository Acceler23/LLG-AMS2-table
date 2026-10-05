const WS_URL = `ws://${location.hostname}:${location.port || 8080}/ws`;

let rltConfig = null;
let latestStandings = [];
let latestSessionState = null; // 1 treino, 2 teste, 3 classificacao, 5 corrida, 6 time attack
let standingsView = false;
let standingsColumnIndex = 0;
const STANDINGS_COLUMN_MODES = ["Pts", "Pts proj.", "Gap líder"];

let stablePlayerName = null;
let pendingPlayerName = null;
let pendingPlayerSince = 0;
// Troca de piloto em foco: vale assim que duas leituras seguidas do jogo
// concordam (~0,13 s cada). Uma leitura isolada e ignorada, para a camera
// passando por outro carro nao fazer o destaque piscar.
const PLAYER_STABLE_MS = 100;

// Fonte online primeiro, pasta local overlay/assets como reserva.
const logoLoader = LLGLogos.createLoader("assets");
let teamLogoOverrides = {};
try {
  const saved = localStorage.getItem("teamLogoOverrides");
  if (saved) teamLogoOverrides = JSON.parse(saved) || {};
} catch (_) {}

const normalizeDriverName = LLGNames.normalizeName;
const nameCandidates = LLGNames.nameCandidates;

// Mesmo casador da tabela (shared/names.js), para o card e a tabela
// mostrarem sempre o mesmo piloto.
let rltMatcher = null;

function rebuildRltMatcher() {
  const hasDrivers =
    rltConfig &&
    ((rltConfig.drivers && rltConfig.drivers.length) || (rltConfig.standingsRows && rltConfig.standingsRows.length));
  rltMatcher = hasDrivers
    ? LLGNames.createMatcher(LLGNames.buildPool(rltConfig), {
        explicitMap: typeof RLT_INGAME_MAP !== "undefined" ? RLT_INGAME_MAP : null,
      })
    : null;
  if (rltMatcher) rltMatcher.prime(latestStandings.map((e) => e.name));
}

function rltLookup(entry) {
  if (!rltMatcher || !entry) return null;
  return rltMatcher.lookup(entry.name || "");
}

function ordinal(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return "";
  const j = x % 10;
  const k = x % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

function formatTime(ms) {
  if (!ms || ms <= 0) return "—";
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  if (m > 0) return `${m}:${s.toFixed(3).padStart(6, "0")}`;
  return s.toFixed(3);
}

// Mesmas regras de logo da tabela (shared/display.js), incluindo a lista
// TEAM_LOGO_OVERRIDES do drivers-config.js.
function setBgLogo(img, teamName, carName) {
  if (!img) return;
  logoLoader.load(img, LLGDisplay.logoPaths(teamName, carName, teamLogoOverrides));
}

function rltDisplayName(entry) {
  const fallback = (entry && entry.name) || "";
  const info = rltLookup(entry);
  if (!info) return fallback;
  if (info.firstName && info.lastName) {
    const full = `${info.firstName} ${info.lastName}`.trim();
    if (full) return full;
  }
  if (info.displayName && String(info.displayName).trim()) return info.displayName;
  if (info.inGameName && String(info.inGameName).trim()) return info.inGameName;
  return fallback;
}

function rltTeamName(entry) {
  const info = rltLookup(entry);
  if (info && info.teamName) return info.teamName;
  // a equipe do proprio jogo (LMU) so vale sem temporada do RLT aplicada
  if (!rltConfig && entry.teamName) return entry.teamName;
  return entry.carName || "";
}

// Nome completo da equipe (so para exibir; os logos usam o nome curto).
function rltTeamFullName(entry) {
  const info = rltLookup(entry);
  return (info && info.teamFullName) || rltTeamName(entry);
}

const POS_DEFAULT_BG = "";

// Coluna da posicao: degrade da cor primaria para a secundaria da equipe.
// Cada numero recebe preto ou branco conforme a cor do degrade na altura em
// que ele esta, mais um contorno na cor oposta, para nunca sumir no fundo.
function paintPositionColumn(entry) {
  const col = document.querySelector(".pos-col");
  if (!col) return;
  const info = rltLookup(entry);
  const a = info && LLGColors.toRgb(info.teamPrimaryColor);
  const b = (info && LLGColors.toRgb(info.teamSecondaryColor)) || a;
  const targets = [
    [document.getElementById("posClass"), 0.4],
    [document.getElementById("posOverall"), 0.72],
  ];
  if (!a) {
    // sem equipe no RLT: volta para o azul padrao do CSS
    col.style.background = POS_DEFAULT_BG;
    targets.forEach(([el]) => {
      if (!el) return;
      el.style.color = "";
      el.style.textShadow = "";
    });
    return;
  }
  col.style.background = `linear-gradient(180deg, rgb(${a.join(",")}) 0%, rgb(${b.join(",")}) 100%)`;
  targets.forEach(([el, at]) => {
    if (!el) return;
    const fg = LLGColors.readableOn(LLGColors.mix(a, b, at));
    const outline = fg === "#000000" ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)";
    el.style.color = fg;
    el.style.textShadow = `0 0 2px ${outline}, 0 0 2px ${outline}, 0 0 4px ${outline}`;
  });
}

// Nome da classe, igual ao cabecalho da tabela: classe do RLT quando ha
// temporada, modelo do carro em classe dividida por carro, senao a classe do
// jogo ja formatada (CLASS_NAME_OVERRIDES, sem sufixos tecnicos).
function classLabel(entry) {
  const key = grouper.key(entry, latestStandings);
  if (rltEnabled()) {
    const c = rltConfig.classes.find((x) => x.uniqueName === key || x.name === key);
    if (c) return LLGDisplay.formatClassName(c.name || c.uniqueName);
  }
  return LLGDisplay.formatClassName(key);
}

function rltRaceNumber(entry) {
  const info = rltLookup(entry);
  if (info && info.raceNumber != null && String(info.raceNumber).trim() !== "") return String(info.raceNumber);
  // o LMU informa o numero do carro (entry.carNumber)
  if (entry && entry.carNumber != null && String(entry.carNumber).trim() !== "") return String(entry.carNumber);
  return "";
}

// Mesma cor de classe da tabela (RLT, CLASS_COLORS ou cor derivada do nome).
function classColor(entry) {
  return LLGDisplay.classColor(grouper.key(entry, latestStandings), rltEnabled() ? rltConfig.classes : null);
}

function updateStablePlayer(standings) {
  const viewed = (standings || []).find((e) => e.isPlayer);
  const name = viewed ? viewed.name : null;
  const now = Date.now();
  if (!stablePlayerName && name) {
    stablePlayerName = name;
    pendingPlayerName = null;
    return;
  }
  if (name && name === stablePlayerName) {
    pendingPlayerName = null;
    return;
  }
  if (!name) {
    pendingPlayerName = null;
    return;
  }
  if (name === pendingPlayerName) {
    if (now - pendingPlayerSince >= PLAYER_STABLE_MS) {
      stablePlayerName = name;
      pendingPlayerName = null;
    }
    return;
  }
  pendingPlayerName = name;
  pendingPlayerSince = now;
}

function rltEnabled() {
  return !!(rltConfig && rltConfig.classes && rltConfig.classes.length > 0);
}

// Mesma regra de classe da tabela (shared/groups.js), incluindo as classes
// divididas por modelo de carro (SPLIT_BY_CAR_CLASSES em drivers-config.js).
const grouper = LLGGroups.createGrouper({
  rltEnabled: () => rltEnabled(),
  lookup: (entry) => rltLookup(entry),
  splitClasses: typeof SPLIT_BY_CAR_CLASSES !== "undefined" ? SPLIT_BY_CAR_CLASSES : [],
});

function classPosition(entry, standings) {
  return grouper.position(entry, standings);
}

function isTimedSession() {
  return latestSessionState === 1 || latestSessionState === 2 || latestSessionState === 3 || latestSessionState === 6;
}

// Diferenca da melhor volta do piloto para a melhor volta da classe dele.
function classLeaderGap(entry, standings) {
  const mine = Number(entry.fastestLapMs);
  if (!(mine > 0)) return "—";
  const key = grouper.key(entry, standings);
  let best = mine;
  (standings || []).forEach((e) => {
    if (e.fastestLapMs > 0 && e.fastestLapMs < best && grouper.key(e, standings) === key) best = e.fastestLapMs;
  });
  if (mine <= best) return "Líder";
  return `+${((mine - best) / 1000).toFixed(3)}`;
}

function findPlayer(standings) {
  updateStablePlayer(standings);
  if (stablePlayerName) {
    const hit = (standings || []).find((e) => e.name === stablePlayerName);
    if (hit) return hit;
  }
  return (standings || []).find((e) => e.isPlayer) || null;
}

function findStandingsRow(entry) {
  if (!entry || !rltConfig || !Array.isArray(rltConfig.standingsRows)) return null;
  const info = rltLookup(entry);
  if (info && info.position != null && info.pointsRaw != null) {
    const byName = rltConfig.standingsRows.find(
      (r) =>
        normalizeDriverName(r.displayName) === normalizeDriverName(info.displayName) ||
        normalizeDriverName(r.driverName) === normalizeDriverName(info.driverName)
    );
    if (byName) return byName;
  }
  const keys = nameCandidates(entry.name);
  for (const r of rltConfig.standingsRows) {
    const pool = [
      normalizeDriverName(r.displayName),
      normalizeDriverName(r.driverName),
      normalizeDriverName(r.inGameName),
      ...(r.aliases || []),
    ].filter(Boolean);
    for (const k of keys) {
      if (pool.includes(k)) return r;
    }
  }
  return null;
}

function render() {
  const card = document.getElementById("card");
  const entry = findPlayer(latestStandings);
  if (!entry) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");

  const overall = entry.position || 0;
  // raceState do jogo: 4 desclassificado, 5 retirado, 6 DNF. Quem abandonou
  // nao tem mais posicao.
  const dnf = entry.raceState === 4 || entry.raceState === 5 || entry.raceState === 6;
  const classPos = dnf ? "DNF" : classPosition(entry, latestStandings) || overall;
  document.getElementById("posClass").textContent = dnf ? "—" : classPos || "—";
  document.getElementById("posOverall").textContent = dnf ? "DNF" : overall || "—";

  // nome e cor da classe pelas mesmas regras da tabela
  const classBar = document.getElementById("classBar");
  const classNameEl = document.getElementById("className");
  classNameEl.textContent = classLabel(entry) || "—";
  const classBg = classColor(entry);
  classBar.style.background = classBg;
  // texto preto ou branco conforme a cor da classe (ex: Super Trofeo e branca)
  classNameEl.style.color = LLGColors.readableOnColor(classBg);

  const team = rltTeamName(entry);
  document.getElementById("driverName").textContent = rltDisplayName(entry) || entry.name || "—";
  document.getElementById("teamName").textContent = rltTeamFullName(entry) || "—";
  paintPositionColumn(entry);
  document.getElementById("raceNum").textContent = rltRaceNumber(entry);

  setBgLogo(document.getElementById("bgLogo"), team, entry.carName);

  const stats = document.getElementById("stats");
  // pontuacao so com temporada do RLT aplicada
  if (standingsView && rltConfig && rltConfig.standingsRows && rltConfig.standingsRows.length) {
    const row = findStandingsRow(entry);
    const champPos = row && row.position != null ? row.position : "—";
    const pts = row && row.points != null ? row.points : "—";
    let gap = "—";
    if (row && row.gapToLeader != null && String(row.gapToLeader).trim() !== "") {
      gap = row.gapToLeader;
    } else if (row && row.pointsRaw != null && rltConfig.standingsRows && rltConfig.standingsRows.length) {
      const leader = rltConfig.standingsRows.reduce((a, b) =>
        (Number(a.pointsRaw) || 0) >= (Number(b.pointsRaw) || 0) ? a : b
      );
      const diff = (Number(leader.pointsRaw) || 0) - (Number(row.pointsRaw) || 0);
      gap = diff <= 0 ? "—" : `-${diff}`;
    }
    stats.innerHTML = `
      <div class="stat"><div class="v">${champPos}</div><div class="l">Campeonato</div></div>
      <div class="stat"><div class="v">${pts}</div><div class="l">Pontos</div></div>
      <div class="stat"><div class="v">${gap}</div><div class="l">Gap líder</div></div>
    `;
  } else if (isTimedSession()) {
    // treino e classificacao: velocidade, melhor volta e diferenca pro lider da classe
    const speed = typeof entry.speedKmh === "number" ? `${Math.round(entry.speedKmh)} km/h` : "—";
    const fl = entry.fastestLapMs ? formatTime(entry.fastestLapMs) : "—";
    stats.innerHTML = `
      <div class="stat"><div class="v">${speed}</div><div class="l">Velocidade</div></div>
      <div class="stat"><div class="v">${fl}</div><div class="l">Melhor volta</div></div>
      <div class="stat"><div class="v">${classLeaderGap(entry, latestStandings)}</div><div class="l">Líder da classe</div></div>
    `;
  } else {
    // "Atual" e a posicao na classe, entao a largada tambem e na classe
    // (a posicao de largada geral vem do servidor, server/raceState.js)
    const startInClass = grouper.startPosition(entry, latestStandings);
    const start = startInClass != null ? startInClass : "—";
    const fl = entry.fastestLapMs ? formatTime(entry.fastestLapMs) : "—";
    stats.innerHTML = `
      <div class="stat"><div class="v">${classPos || "—"}</div><div class="l">Atual</div></div>
      <div class="stat"><div class="v">${start}</div><div class="l">Largada</div></div>
      <div class="stat"><div class="v">${fl}</div><div class="l">Melhor volta</div></div>
    `;
  }
}

// O servidor manda a "versao" dos arquivos da overlay ao conectar e de tempos
// em tempos. Se ela mudar (programa atualizado, arquivo editado), a pagina se
// recarrega sozinha, para o OBS nunca ficar rodando codigo antigo.
let overlayBuildId = null;
function checkBuildId(id) {
  if (!id) return;
  if (overlayBuildId === null) overlayBuildId = id;
  else if (id !== overlayBuildId) location.reload();
}

function connect() {
  const socket = new WebSocket(WS_URL);
  socket.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "standings") {
        const payload = msg.data;
        const list = Array.isArray(payload) ? payload : payload && payload.standings;
        latestStandings = Array.isArray(list) ? list : [];
        LLGDisplay.applyGameClassNames(latestStandings, payload && payload.game);
        if (rltMatcher) rltMatcher.prime(latestStandings.map((e) => e.name));
        const session = Array.isArray(payload) ? null : payload && payload.session;
        if (session && session.state != null) {
          const st = Number(session.state);
          latestSessionState = Number.isNaN(st) ? null : st;
        }
        render();
      } else if (msg.type === "hello") {
        checkBuildId(msg.buildId);
      } else if (msg.type === "rltConfig") {
        rltConfig = msg.data || null;
        rebuildRltMatcher();
        render();
      } else if (msg.type === "assetsConfig") {
        logoLoader.setConfig(msg.data || {});
        render();
      } else if (msg.type === "overlayCommand") {
        const name = msg.name;
        if (name === "overlay.toggleStandings") {
          standingsView = !standingsView;
          render();
        } else if (name === "overlay.setStandings") {
          standingsView = !!(msg.payload && msg.payload.value);
          render();
        } else if (name === "overlay.prevColumn" || name === "overlay.nextColumn") {
          if (standingsView) {
            if (name === "overlay.prevColumn") {
              standingsColumnIndex = (standingsColumnIndex - 1 + STANDINGS_COLUMN_MODES.length) % STANDINGS_COLUMN_MODES.length;
            } else {
              standingsColumnIndex = (standingsColumnIndex + 1) % STANDINGS_COLUMN_MODES.length;
            }
            render();
          }
        }
      }
    } catch (_) {}
  });
  // servidor reiniciando: tenta de novo logo, para a overlay voltar rapido
  socket.addEventListener("close", () => setTimeout(connect, 500));
}

connect();
