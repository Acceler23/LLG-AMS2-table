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
const PLAYER_STABLE_MS = 800;

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

function teamSlug(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
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

function manufacturerName(carName) {
  return (carName || "").split(" ")[0];
}

function carLogo(carName) {
  if (typeof CAR_LOGOS === "undefined") return undefined;
  return CAR_LOGOS[manufacturerName(carName)] || CAR_LOGOS[carName];
}

function carLogoFromTeam(teamName) {
  if (typeof CAR_LOGOS === "undefined" || !teamName) return null;
  const slug = teamSlug(teamName);
  for (const key of Object.keys(CAR_LOGOS)) {
    if (teamSlug(key) === slug) return CAR_LOGOS[key];
  }
  return null;
}

function teamLogoFile(teamName) {
  if (!teamName) return null;
  if (teamLogoOverrides[teamName]) return teamLogoOverrides[teamName];
  return `${teamSlug(teamName)}.png`;
}

function setBgLogo(img, teamName, carName) {
  if (!img) return;
  const carFile = carLogo(carName) || carLogoFromTeam(teamName);
  const teamFile = teamLogoFile(teamName);
  logoLoader.load(img, [teamFile ? `teams/${teamFile}` : null, carFile ? `cars/${carFile}` : null]);
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
  return entry.teamName || entry.carName || "";
}

function rltClassName(entry) {
  const info = rltLookup(entry);
  if (info && info.name && info.name !== "—") return info.name;
  // classe dividida por modelo: o nome do grupo e o carro
  if (grouper.isSplitByCar(latestStandings)) return entry.carName || entry.carClass || "";
  return entry.carClass || entry.className || "";
}

function rltRaceNumber(entry) {
  const info = rltLookup(entry);
  if (info && info.raceNumber != null && String(info.raceNumber).trim() !== "") return String(info.raceNumber);
  return "";
}

function classColor(key) {
  if (rltConfig && rltConfig.classes) {
    const c = rltConfig.classes.find((x) => x.uniqueName === key || x.name === key);
    if (c && c.color) return c.color;
  }
  const info = null;
  return "#0e42a5";
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
  const classPos = classPosition(entry, latestStandings) || overall;
  document.getElementById("posClass").textContent = classPos || "—";
  document.getElementById("posOverall").textContent = overall || "—";

  const cls = rltClassName(entry);
  const classBar = document.getElementById("classBar");
  document.getElementById("className").textContent = cls || "—";
  const info = rltLookup(entry);
  const color = (info && info.color) || "#0e42a5";
  classBar.style.background = color;

  const team = rltTeamName(entry);
  document.getElementById("driverName").textContent = rltDisplayName(entry) || entry.name || "—";
  document.getElementById("teamName").textContent = team || "—";
  document.getElementById("raceNum").textContent = rltRaceNumber(entry);

  setBgLogo(document.getElementById("bgLogo"), team, entry.carName);

  const stats = document.getElementById("stats");
  if (standingsView) {
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

function connect() {
  const socket = new WebSocket(WS_URL);
  socket.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "standings") {
        const payload = msg.data;
        const list = Array.isArray(payload) ? payload : payload && payload.standings;
        latestStandings = Array.isArray(list) ? list : [];
        if (rltMatcher) rltMatcher.prime(latestStandings.map((e) => e.name));
        const session = Array.isArray(payload) ? null : payload && payload.session;
        if (session && session.state != null) {
          const st = Number(session.state);
          latestSessionState = Number.isNaN(st) ? null : st;
        }
        render();
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
  socket.addEventListener("close", () => setTimeout(connect, 2000));
}

connect();
