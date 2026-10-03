const WS_URL = `ws://${location.hostname}:${location.port || 8080}/ws`;

let rltConfig = null;
let latestStandings = [];
let standingsView = false;
let standingsColumnIndex = 0;
const STANDINGS_COLUMN_MODES = ["Pts", "Pts proj.", "Gap líder"];

let startOverall = null;
let baselineLocked = false;
let stablePlayerName = null;
let pendingPlayerName = null;
let pendingPlayerSince = 0;
const PLAYER_STABLE_MS = 800;

let logoBaseUrl = "";
let logoCacheBust = "";
let teamLogoOverrides = {};
try {
  const saved = localStorage.getItem("teamLogoOverrides");
  if (saved) teamLogoOverrides = JSON.parse(saved) || {};
} catch (_) {}

const rltLookupCache = new Map();

function normalizeDriverName(name) {
  return String(name || "")
    .replace(/\[[^\]]*\]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|\/\\]+/g, " ")
    .replace(/\./g, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function nameCandidates(raw) {
  const parts = String(raw || "")
    .split(/[|\/\\]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) parts.push(String(raw || ""));
  const out = new Set();
  parts.forEach((p) => {
    const n = normalizeDriverName(p);
    if (n) out.add(n);
  });
  const full = normalizeDriverName(raw);
  if (full) out.add(full);
  return Array.from(out);
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

function logoUrl(relPath) {
  if (!relPath) return null;
  const rel = String(relPath).replace(/^\/+/, "");
  const base = (logoBaseUrl || "assets").replace(/\/+$/, "");
  let url = `${base}/${rel}`;
  if (logoCacheBust) url += (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(logoCacheBust);
  return url;
}

function resolveLogoSrc(teamName, carName) {
  const carFile = carLogo(carName) || carLogoFromTeam(teamName);
  const teamFile = teamLogoFile(teamName);
  const teamSrc = teamFile ? logoUrl(`teams/${teamFile}`) : null;
  const carSrc = carFile ? logoUrl(`cars/${carFile}`) : null;
  if (teamSrc) return { src: teamSrc, fallback: carSrc };
  if (carSrc) return { src: carSrc, fallback: null };
  return null;
}

function setBgLogo(img, teamName, carName) {
  if (!img) return;
  const res = resolveLogoSrc(teamName, carName);
  if (!res) {
    img.style.display = "none";
    img.removeAttribute("src");
    return;
  }
  if (img.dataset.src === res.src && img.style.display !== "none") return;
  img.onload = () => {
    img.style.display = "";
    img.dataset.src = res.src;
  };
  img.onerror = () => {
    if (res.fallback && img.dataset.tried !== res.fallback) {
      img.dataset.tried = res.fallback;
      img.src = res.fallback;
      return;
    }
    img.style.display = "none";
    img.removeAttribute("src");
  };
  img.dataset.tried = res.src;
  img.src = res.src;
}

function rltDriverPool() {
  const list = [];
  const seen = new Set();
  function add(d) {
    if (!d) return;
    const key = normalizeDriverName(d.displayName || d.driverName || `${d.firstName || ""} ${d.lastName || ""}`);
    if (!key || seen.has(key)) return;
    seen.add(key);
    list.push(d);
  }
  if (!rltConfig) return list;
  (rltConfig.drivers || []).forEach(add);
  (rltConfig.standingsRows || []).forEach((row) => {
    add({
      displayName: row.displayName,
      driverName: row.driverName,
      inGameName: row.inGameName,
      firstName: row.firstName,
      lastName: row.lastName,
      teamName: row.teamName,
      raceNumber: row.raceNumber,
      aliases: row.aliases || [],
      uniqueName: row.classUniqueName,
      name: row.className,
      color: row.color,
      position: row.position,
      points: row.points,
      pointsRaw: row.pointsRaw,
      gapToLeader: row.gapToLeader,
    });
  });
  return list;
}

function scoreAlias(target, targetTokens, targetLast, al) {
  if (!al) return 0;
  let score = 0;
  const alTokens = al.split(" ").filter(Boolean);
  const alLast = alTokens[alTokens.length - 1] || "";
  const alFirst = alTokens[0] || "";
  if (target === al) return 1;
  if (targetLast && alLast && targetLast === alLast && targetLast.length >= 3) score = Math.max(score, 0.98);
  if (target.includes(al) || al.includes(target)) {
    const ratio = Math.min(target.length, al.length) / Math.max(target.length, al.length);
    if (ratio >= 0.75) score = Math.max(score, Math.max(ratio, 0.9));
  }
  return score;
}

function rltLookup(entry) {
  if (!rltConfig || (!rltConfig.drivers?.length && !rltConfig.standingsRows?.length)) return null;
  const raw = entry.name || "";
  if (rltLookupCache.has(raw)) return rltLookupCache.get(raw);
  const candidates = nameCandidates(raw).filter((t) => t && t !== "player");
  if (!candidates.length) {
    rltLookupCache.set(raw, null);
    return null;
  }
  const pool = rltDriverPool();
  let best = null;
  let bestScore = 0;
  for (const target of candidates) {
    const targetTokens = target.split(" ").filter(Boolean);
    const targetLast = targetTokens[targetTokens.length - 1] || "";
    for (const d of pool) {
      const extra = [];
      if (d.driverName) extra.push(normalizeDriverName(d.driverName));
      if (d.displayName) extra.push(normalizeDriverName(d.displayName));
      if (d.inGameName) extra.push(normalizeDriverName(d.inGameName));
      if (d.firstName || d.lastName) extra.push(normalizeDriverName(`${d.firstName || ""} ${d.lastName || ""}`));
      if (d.lastName) extra.push(normalizeDriverName(d.lastName));
      for (const al of [...(d.aliases || []), ...extra]) {
        const score = scoreAlias(target, targetTokens, targetLast, al);
        if (score > bestScore) {
          bestScore = score;
          best = d;
        }
      }
    }
  }
  const hit = best && bestScore >= 0.98 ? best : null;
  rltLookupCache.set(raw, hit);
  return hit;
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

function ensureBaselines(standings) {
  const fieldMoving = (standings || []).some((e) => typeof e.speedMs === "number" && e.speedMs > 3);
  if (!baselineLocked) {
    startOverall = new Map((standings || []).map((e) => [e.name, e.position]));
    if (fieldMoving) baselineLocked = true;
  }
}


function classKey(entry) {
  const info = rltLookup(entry);
  if (info && info.uniqueName && info.uniqueName !== "—") return info.uniqueName;
  return entry.carClass || entry.className || "—";
}

function classPosition(entry, standings) {
  if (!entry) return null;
  const key = classKey(entry);
  const list = (standings || [])
    .filter((e) => classKey(e) === key)
    .slice()
    .sort((a, b) => (a.position || 999) - (b.position || 999));
  const idx = list.findIndex((e) => e.name === entry.name);
  return idx >= 0 ? idx + 1 : null;
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
  ensureBaselines(latestStandings);

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
  } else {
    const start = startOverall && startOverall.has(entry.name) ? startOverall.get(entry.name) : "—";
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
        const session = Array.isArray(payload) ? null : payload && payload.session;
        if (session && session.state !== undefined) {
          // reset baseline on session change lightly handled by field moving lock
        }
        render();
      } else if (msg.type === "rltConfig") {
        rltConfig = msg.data || null;
        rltLookupCache.clear();
        render();
      } else if (msg.type === "assetsConfig") {
        const d = msg.data || {};
        logoBaseUrl = d.baseUrl || "";
        logoCacheBust = d.cacheBust || "";
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
