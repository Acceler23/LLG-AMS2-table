const params = new URLSearchParams(location.search);
const DEMO = params.get("demo") === "1";

const WS_URL = `ws://${location.hostname}:${location.port || 8080}/ws`;

const RIGHT_COLUMN_MODES = ["Intervalo", "Gap líder", "Última volta", "Melhor volta", "Posições", "Paradas", "Stint", "VMax"];
let rightColumnIndex = 0;

const PAGE_MODES = ["Geral", "Multiclasse", "Minha classe"];
let pageIndex = 1;
const MAX_TABLE_H = 1080;
const TITLE_H = 48;
const COL_HEADER_H = 36;
const ROW_H = 49;
const CLASS_HDR_H = 32;
const SAFETY_H = 16;
let rotateTick = 0;
const ROTATE_MS = 10000;

function maxDriverSlots() {
  return Math.max(1, Math.floor((MAX_TABLE_H - TITLE_H - COL_HEADER_H - SAFETY_H) / ROW_H));
}

function pickPageSynced(arr, page, count, maxPages) {
  if (!arr.length || count <= 0) return [];
  if (arr.length <= count) return arr.slice();
  const pages = Math.ceil(arr.length / count);
  const p = maxPages > 0 ? (page % maxPages) : 0;
  if (p >= pages) {
    // ultima pagina da classe ate o ciclo global reiniciar
    const start = (pages - 1) * count;
    return arr.slice(start, start + count);
  }
  const start = p * count;
  return arr.slice(start, start + count);
}

function slotsPerClass(groups) {
  const classes = Object.keys(groups);
  const n = classes.length;
  if (n === 0) return {};

  const available = MAX_TABLE_H - TITLE_H - COL_HEADER_H - SAFETY_H;
  const minCost = n * (CLASS_HDR_H + ROW_H);
  let extra = Math.floor((available - minCost) / ROW_H);
  if (extra < 0) extra = 0;

  const sizes = classes.map((cls) => groups[cls].length);
  const othersNeed = sizes.map((s) => Math.max(0, s - 1));
  const totalOthers = othersNeed.reduce((a, b) => a + b, 0);

  const result = {};
  if (totalOthers === 0 || extra >= totalOthers) {
    classes.forEach((cls, i) => { result[cls] = sizes[i]; });
    return result;
  }

  // distribui extras proporcionalmente; minimo 1 (lider) por classe
  let assigned = 0;
  const extras = classes.map((cls, i) => {
    if (totalOthers === 0) return 0;
    const share = Math.floor((othersNeed[i] / totalOthers) * extra);
    return share;
  });
  assigned = extras.reduce((a, b) => a + b, 0);
  let left = extra - assigned;
  let idx = 0;
  while (left > 0 && totalOthers > 0) {
    if (extras[idx % n] < othersNeed[idx % n]) {
      extras[idx % n] += 1;
      left -= 1;
    }
    idx += 1;
    if (idx > n * extra + 10) break;
  }

  classes.forEach((cls, i) => {
    // total slots na classe = lider + extras (pelo menos 1)
    // se sobrar pouco espaço no geral, limita a 3 (lider+2)
    let slots = 1 + extras[i];
    if (extra < n * 2) slots = Math.min(slots, 3);
    slots = Math.min(slots, sizes[i]);
    slots = Math.max(1, slots);
    result[cls] = slots;
  });
  return result;
}

let latestStandings = [];
let latestSessionLabel = null;
let latestSessionState = null;
let latestLapsInEvent = 0;

function formatLapLabel(currentLap) {
  const lap = currentLap != null ? currentLap : 0;
  if (latestLapsInEvent > 0) return `Volta ${lap}/${latestLapsInEvent}`;
  return `Volta ${lap}`;
}

const SESSION_LABELS = {
  0: "INVÁLIDA",
  1: "TREINO LIVRE",
  2: "TESTE",
  3: "CLASSIFICAÇÃO",
  4: "VOLTA DE FORMAÇÃO",
  5: "CORRIDA",
  6: "TIME ATTACK",
};

function isTimedSession() {
  const st = Number(latestSessionState);
  if (st === 1 || st === 2 || st === 3 || st === 6) return true;
  if (st === 5) return false;
  const lab = (latestSessionLabel || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /TREINO|CLASSIFICA|TESTE|TIME ATTACK|ATTACK|QUAL/i.test(lab);
}

function isRaceSession() {
  const st = Number(latestSessionState);
  if (st === 5) return true;
  if (st === 1 || st === 2 || st === 3 || st === 6 || st === 4) return false;
  const lab = (latestSessionLabel || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/TREINO|CLASSIFICA|TESTE|TIME ATTACK|ATTACK|QUAL|FORMACAO/i.test(lab)) return false;
  return /CORRIDA/i.test(lab);
}

let startOverall = null;
let startInClass = null;
let baselineSession = null;
let lastSessionLabel = null;

function resetBaselines() {
  startOverall = null;
  startInClass = null;
  baselineSession = null;
}

function ensureBaselines(standings, sessionLabel) {
  if (sessionLabel && sessionLabel !== lastSessionLabel) {
    lastSessionLabel = sessionLabel;
    resetBaselines();
    if (isRaceSession()) {
      raceStartAt = Date.now();
      pitStats.clear();
      pitTimers.clear();
    } else {
      raceStartAt = null;
    }
  }

  const onGrid = standings.length > 0 && standings.every((e) => !e.lapsCompleted || e.lapsCompleted === 0);
  if (startOverall && onGrid) {
    resetBaselines();
  }
  if (startOverall) return;

  startOverall = new Map(standings.map((e) => [e.name, e.position]));
  baselineSession = sessionLabel;

  const groups = {};
  standings.forEach((e) => {
    const cls = e.carClass || "—";
    (groups[cls] = groups[cls] || []).push(e);
  });
  startInClass = new Map();
  Object.values(groups).forEach((list) => {
    list
      .slice()
      .sort((a, b) => a.position - b.position)
      .forEach((e, i) => startInClass.set(e.name, i + 1));
  });
}

function positionChange(entry, displayPosition, isClassMode) {
  if (isClassMode) {
    if (!startInClass || !startInClass.has(entry.name)) return null;
    return startInClass.get(entry.name) - displayPosition;
  }
  if (!startOverall || !startOverall.has(entry.name)) return null;
  return startOverall.get(entry.name) - entry.position;
}

function isSafetyCar(entry) {
  const cls = (entry.carClass || "").toLowerCase();
  const name = (entry.carName || "").toLowerCase();
  return cls === "safetycar" || name.includes("safety");
}

function isObserver(entry) {
  if (!entry.inRace) return false;
  if (entry.lapsCompleted > 0) return false;
  if (entry.pitMode === 4 || entry.pitMode === 2) return true;
  if (entry.raceState === 0 || entry.raceState === 1) return true;
  return false;
}

function connect() {
  const socket = new WebSocket(WS_URL);
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "standings") {
      const payload = msg.data;
      const raw = Array.isArray(payload) ? payload : payload.standings || [];
      const session = Array.isArray(payload) ? null : payload.session;
      const standings = raw.filter((e) => !isSafetyCar(e) && !isObserver(e));

      latestStandings = standings;
      if (session) {
        const prevState = latestSessionState;
        latestSessionState = typeof session.state === "number" ? session.state : (session.state != null ? Number(session.state) : null);
        if (Number.isNaN(latestSessionState)) latestSessionState = null;
        latestSessionLabel = (latestSessionState != null && SESSION_LABELS[latestSessionState]) || session.label || null;
        latestLapsInEvent = Number(session.lapsInEvent) || 0;
        if (latestSessionState === 5 && prevState !== 5) {
          raceStartAt = Date.now();
          pitStats.clear();
          pitTimers.clear();
        } else if (latestSessionState !== 5 && prevState === 5) {
          raceStartAt = null;
        }
      }
      updateSessionHeader(session);
      render(latestStandings);
    }
  });
  socket.addEventListener("close", () => setTimeout(connect, 2000));
}

function getLeader() {
  let leader = null;
  latestStandings.forEach((e) => {
    if (!leader || e.position < leader.position) leader = e;
  });
  return leader;
}

function formatClock(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function updateSessionHeader(session) {
  if (!session) return;
  const label = latestSessionLabel || SESSION_LABELS[session.state] || session.label || "CORRIDA";
  document.getElementById("sessionLabel").textContent = label;

  const timerEl = document.getElementById("sessionTimer");
  const leader = getLeader();

  if (isRaceSession()) {
    if (leader && leader.raceState === 3) {
      timerEl.textContent = "FIM";
    } else if (latestLapsInEvent > 0) {
      const leadLap = leader ? (leader.currentLap || 0) : 0;
      if (leadLap >= latestLapsInEvent) {
        timerEl.textContent = "ÚLTIMA VOLTA";
      } else {
        timerEl.textContent = `Volta ${leadLap}/${latestLapsInEvent}`;
      }
    } else {
      const totalSeconds = typeof session.timeRemainingSec === "number" ? session.timeRemainingSec : 0;
      timerEl.textContent = formatClock(totalSeconds);
    }
  } else {
    const totalSeconds = typeof session.timeRemainingSec === "number" ? session.timeRemainingSec : 0;
    timerEl.textContent = formatClock(totalSeconds);
  }

  const table = document.getElementById("timing-table");
  if (table) table.classList.toggle("sc-out", !!session.scOut);
}

function formatClassName(raw) {
  if (!raw) return raw;
  if (typeof CLASS_NAME_OVERRIDES !== "undefined" && CLASS_NAME_OVERRIDES[raw]) {
    return CLASS_NAME_OVERRIDES[raw];
  }
  return raw
    .replace(/_(LD|HD|SW)(?=_|$)/gi, "") // sufixos tecnicos que nao fazem parte do nome
    .replace(/_/g, " ")
    .trim();
}

function classColor(carClass) {
  if (typeof CLASS_COLORS === "undefined") return DEFAULT_COLOR;
  if (carClass && CLASS_COLORS[carClass]) return CLASS_COLORS[carClass];
  const formatted = formatClassName(carClass);
  if (formatted && CLASS_COLORS[formatted]) return CLASS_COLORS[formatted];
  if (carClass) {
    const noSpace = carClass.replace(/\s+/g, "_");
    if (CLASS_COLORS[noSpace]) return CLASS_COLORS[noSpace];
  }
  if (typeof CLASS_NAME_OVERRIDES !== "undefined") {
    for (const [raw, name] of Object.entries(CLASS_NAME_OVERRIDES)) {
      if (name === formatted && CLASS_COLORS[raw]) return CLASS_COLORS[raw];
    }
  }
  return DEFAULT_COLOR;
}

function sortByTiming(a, b) {
  if (!isRaceSession()) {
    const fa = a.fastestLapMs > 0 ? a.fastestLapMs : Infinity;
    const fb = b.fastestLapMs > 0 ? b.fastestLapMs : Infinity;
    if (fa !== fb) return fa - fb;
  }
  return a.position - b.position;
}

// Nao existe campo na Shared Memory que diga "estou so' assistindo" --
// so' temos qual carro a camera esta olhando (que e' o mesmo se voce esta
// pilotando ou so' espectando). Por isso o destaque de "voce" e' opcional:
// aperte "p" pra ligar/desligar quando estiver so' assistindo.
let playerHighlightEnabled = true;

function manufacturerName(carName) {
  // pega so' a primeira palavra do nome do carro como nome da montadora.
  // funciona bem pra "Ferrari 488 GT3", "McLaren 570S GT4" etc; para
  // montadoras com nome composto (ex: "Aston Martin"), ajuste manualmente
  // em CAR_LOGOS usando o carName completo como chave, se preferir.
  return (carName || "").split(" ")[0];
}

function carLogo(carName) {
  if (typeof CAR_LOGOS === "undefined") return undefined;
  return CAR_LOGOS[manufacturerName(carName)] || CAR_LOGOS[carName];
}

function formatLeaderGap(entry, leaderDistance, bestFastestMs) {
  if (!isRaceSession()) {
    return formatQualGap(entry, bestFastestMs, true);
  }
  if (typeof leaderDistance !== "number" || typeof entry.totalDistance !== "number") return { text: "-", cls: "" };
  if (!entry.lapsCompleted && entry.currentLap <= 1) return { text: "-", cls: "" };
  if (!entry.speedMs || entry.speedMs < 2) return { text: "-", cls: "" };
  const distanceBehind = leaderDistance - entry.totalDistance;
  if (distanceBehind <= 0.5) return { text: "Líder", cls: "" };
  const gapSeconds = distanceBehind / entry.speedMs;
  return { text: `+${gapSeconds.toFixed(1)}`, cls: "" };
}

function rightColumnValue(entry, change, carAheadDistance, bestFastestMs, leaderDistance, aheadFastestMs) {
  if (isDnf(entry)) return { text: "DNF", cls: "pos-down" };

  const pit = updatePitTimer(entry);
  const stats = updatePitStats(entry);
  if (pit && (pit.phase === "in" || pit.phase === "out")) {
    const elapsed = Date.now() - pit.enteredAt;
    return { text: formatPitDuration(elapsed), cls: "pit-time", pitPhase: pit.phase };
  }

  const mode = RIGHT_COLUMN_MODES[rightColumnIndex];
  let result;
  if (mode === "Intervalo") {
    result = formatGap(entry, carAheadDistance, change, bestFastestMs, aheadFastestMs);
  } else if (mode === "Gap líder") {
    result = formatLeaderGap(entry, leaderDistance, bestFastestMs);
  } else if (mode === "Última volta") {
    result = { text: entry.lastLapMs ? formatTime(entry.lastLapMs) : "--:--.---", cls: "" };
  } else if (mode === "Melhor volta") {
    result = { text: entry.fastestLapMs ? formatTime(entry.fastestLapMs) : "--:--.---", cls: "" };
  } else if (mode === "Posições") {
    result = formatPosChange(change);
  } else if (mode === "Paradas") {
    result = { text: String(stats.stops), cls: "" };
  } else if (mode === "Stint") {
    result = { text: String(stats.stintLaps), cls: "" };
  } else if (mode === "VMax") {
    result = { text: entry.maxSpeedKmh != null ? `${Math.round(entry.maxSpeedKmh)}` : "-", cls: "" };
  } else {
    result = { text: "-", cls: "" };
  }

  if (pit && pit.phase === "done") {
    result.pitPhase = "done";
  }
  return result;
}

// Estimativa de intervalo baseada em distancia percorrida (a Shared Memory
// nao entrega o gap pronto). E' uma aproximacao usada por varias ferramentas
// da comunidade quando so' se tem posicao/distancia -- nao e' tao preciso
// quanto uma medicao de linha de tempo real, mas da uma nocao boa ao vivo.
const garageSince = new Map();
const pitTimers = new Map();
const pitStats = new Map();
const sectorState = new Map();
const lastDisplayPos = new Map();
let raceStartAt = null;

function isPitTrackingActive() {
  if (!isRaceSession()) return true;
  if (raceStartAt == null) return false;
  return Date.now() - raceStartAt >= 10000;
}

function isOutLap(entry) {
  if (!isPitTrackingActive()) return false;
  const stats = pitStats.get(entry.name);
  if (!stats) return false;
  if (entry.pitMode === 1 || entry.pitMode === 2 || entry.pitMode === 3) return true;
  return stats.stintLaps === 0 && stats.stops > 0 && !stats.wasInPit;
}

function updateSectorDisplay(entry, purpleOwners) {
  const name = entry.name;
  let st = sectorState.get(name);
  if (!st) {
    st = { colors: [null, null, null], lastLap: entry.currentLap || 0, clearAt: 0 };
    sectorState.set(name, st);
  }

  const lap = entry.currentLap || 0;
  if (lap > st.lastLap) {
    st.clearAt = Date.now() + 10000;
    st.lastLap = lap;
  }
  if (st.clearAt && Date.now() >= st.clearAt) {
    st.colors = [null, null, null];
    st.clearAt = 0;
  }

  if (entry.lapInvalidated) {
    st.colors = ["red", "red", "red"];
    return st.colors;
  }

  const cur = [entry.sector1Ms, entry.sector2Ms, entry.sector3Ms];
  const best = [entry.bestSector1Ms, entry.bestSector2Ms, entry.bestSector3Ms];

  for (let i = 0; i < 3; i++) {
    if (cur[i] > 0) {
      if (purpleOwners[i] === name) {
        st.colors[i] = "purple";
      } else if (best[i] > 0 && cur[i] <= best[i]) {
        st.colors[i] = "green";
      } else {
        st.colors[i] = "yellow";
      }
    }
  }
  return st.colors;
}

function computePurpleOwners(standings, isClassMode) {
  const owners = [null, null, null];
  const best = [Infinity, Infinity, Infinity];
  standings.forEach((e) => {
    if (e.lapInvalidated) return;
    if (e.pitMode === 1 || e.pitMode === 2 || e.pitMode === 3) return;
    if (isOutLap(e)) return;
    const cur = [e.sector1Ms, e.sector2Ms, e.sector3Ms];
    for (let i = 0; i < 3; i++) {
      if (cur[i] > 0 && cur[i] < best[i]) {
        best[i] = cur[i];
        owners[i] = e.name;
      }
    }
  });
  return owners;
}

function updatePitStats(entry) {
  const name = entry.name;
  let st = pitStats.get(name);
  if (!st) {
    st = { stops: 0, wasInPit: false, stintStartLap: entry.lapsCompleted || 0 };
    pitStats.set(name, st);
  }
  if (!isPitTrackingActive()) {
    st.wasInPit = entry.pitMode === 1 || entry.pitMode === 2;
    st.stintStartLap = entry.lapsCompleted || 0;
    st.stintLaps = 0;
    return st;
  }
  const inPit = entry.pitMode === 1 || entry.pitMode === 2;
  if (inPit && !st.wasInPit) {
    st.stops += 1;
    st.wasInPit = true;
  } else if (!inPit && st.wasInPit) {
    st.wasInPit = false;
    st.stintStartLap = entry.lapsCompleted || 0;
  }
  st.stintLaps = Math.max(0, (entry.lapsCompleted || 0) - st.stintStartLap);
  return st;
}

function isInPit(entry) {
  return entry.pitMode === 1 || entry.pitMode === 2;
}

function isExitingPit(entry) {
  return entry.pitMode === 3;
}

function updatePitTimer(entry) {
  if (!isPitTrackingActive()) {
    pitTimers.delete(entry.name);
    return null;
  }
  const name = entry.name;
  const now = Date.now();
  let st = pitTimers.get(name);

  if (isInPit(entry) || isExitingPit(entry)) {
    if (!st || st.phase === "done") {
      st = { enteredAt: now, phase: "in", finalMs: null, exitLap: null };
    } else {
      st.phase = isExitingPit(entry) ? "out" : "in";
    }
    pitTimers.set(name, st);
    return st;
  }

  if (st && (st.phase === "in" || st.phase === "out")) {
    st.finalMs = now - st.enteredAt;
    st.phase = "done";
    st.exitLap = entry.currentLap ?? entry.lapsCompleted ?? 0;
    pitTimers.set(name, st);
    return st;
  }

  if (st && st.phase === "done") {
    const lap = entry.currentLap ?? entry.lapsCompleted ?? 0;
    if (lap > st.exitLap) {
      pitTimers.delete(name);
      return null;
    }
    return st;
  }
  return st || null;
}

function formatPitDuration(ms) {
  const totalSec = ms / 1000;
  if (totalSec < 60) return totalSec.toFixed(1) + "s";
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

function isDnf(entry) {
  if (entry.raceState === 6 || entry.raceState === 5 || entry.raceState === 4) return true;
  if (!entry.inRace || entry.lapsCompleted < 1) return false;
  if (entry.pitMode !== 4) {
    garageSince.delete(entry.name);
    return false;
  }
  const now = Date.now();
  if (!garageSince.has(entry.name)) garageSince.set(entry.name, now);
  return now - garageSince.get(entry.name) >= 120000;
}

function formatPosChange(change) {
  if (change === null || change === undefined) return { text: "-", cls: "" };
  if (change === 0) return { text: "=", cls: "pos-eq" };
  if (change > 0) return { text: `▲${change}`, cls: "pos-up" };
  return { text: `▼${Math.abs(change)}`, cls: "pos-down" };
}

function formatQualGap(entry, refFastestMs) {
  const mine = Number(entry.fastestLapMs);
  if (!mine || mine <= 0) {
    const last = Number(entry.lastLapMs);
    if (last > 0) return { text: formatTime(last), cls: "" };
    return { text: "-", cls: "" };
  }
  const ref = Number(refFastestMs);
  if (!ref || ref <= 0) {
    return { text: formatTime(mine), cls: "fastest-gap" };
  }
  const delta = mine - ref;
  if (delta <= 0) return { text: formatTime(mine), cls: "fastest-gap" };
  return { text: `+${(delta / 1000).toFixed(3)}`, cls: "" };
}

function formatGap(entry, aheadDistance, change, bestFastestMs, aheadFastestMs) {
  if (isDnf(entry)) return { text: "DNF", cls: "pos-down" };

  if (isTimedSession() || !isRaceSession()) {
    return formatQualGap(entry, aheadFastestMs);
  }

  const firstLap = !entry.lapsCompleted || entry.currentLap <= 1;
  if (firstLap) return formatPosChange(change);

  if (typeof entry.splitAhead === "number" && entry.splitAhead >= 0) {
    return { text: `+${entry.splitAhead.toFixed(1)}`, cls: "" };
  }
  if (typeof aheadDistance !== "number" || typeof entry.totalDistance !== "number") {
    if (aheadDistance === null || aheadDistance === undefined) {
      return { text: "Líder", cls: "" };
    }
    return { text: "-", cls: "" };
  }
  if (!entry.speedMs || entry.speedMs < 2) return { text: "-", cls: "" };

  const distanceBehind = aheadDistance - entry.totalDistance;
  if (distanceBehind <= 0.5) return { text: "Líder", cls: "" };

  const gapSeconds = distanceBehind / entry.speedMs;
  return { text: `+${gapSeconds.toFixed(1)}`, cls: "" };
}

function pickRotated(arr, page, count, maxPages) {
  if (maxPages != null) return pickPageSynced(arr, page, count, maxPages);
  if (!arr.length || count <= 0) return [];
  if (arr.length <= count) return arr.slice();
  const pages = Math.ceil(arr.length / count);
  const p = ((page % pages) + pages) % pages;
  const start = p * count;
  return arr.slice(start, start + count);
}

function buildDisplayList(standings) {
  const mode = PAGE_MODES[pageIndex];

  function withAhead(rows) {
    let prevFast = null;
    return rows.map((item) => {
      if (item.type !== "row") {
        if (item.type !== "spacer") prevFast = null;
        return item;
      }
      item.aheadFastestMs = prevFast;
      const f = Number(item.entry.fastestLapMs);
      if (f > 0) prevFast = f;
      return item;
    });
  }

  if (mode === "Geral") {
    let ordered;
    if (!isRaceSession()) {
      ordered = standings.slice().sort(sortByTiming).map((e, i) => ({ type: "row", entry: e, displayPosition: i + 1 }));
    } else {
      ordered = standings.map((e) => ({ type: "row", entry: e, displayPosition: e.position }));
    }
    const maxSlots = maxDriverSlots();
    if (ordered.length <= maxSlots) return withAhead(ordered);
    const fixedCount = Math.min(10, ordered.length);
    const fixed = ordered.slice(0, fixedCount);
    const rest = ordered.slice(fixedCount);
    const extraSlots = Math.max(0, maxSlots - fixedCount);
    if (extraSlots <= 0 || rest.length === 0) return withAhead(fixed);
    const rotated = pickRotated(rest, rotateTick, extraSlots).map((item) => ({ ...item, rotating: true }));
    while (rotated.length < extraSlots) rotated.push({ type: "spacer" });
    return withAhead(fixed.concat(rotated));
  }

  if (mode === "Multiclasse") {
    const groups = {};
    standings.forEach((e) => {
      const cls = e.carClass || "—";
      (groups[cls] = groups[cls] || []).push(e);
    });

    const perClass = slotsPerClass(groups);
    const classKeys = Object.keys(groups);
    let maxPages = 1;
    classKeys.forEach((cls) => {
      const size = groups[cls].length;
      const slots = perClass[cls] || 1;
      const extra = Math.max(0, slots - 1);
      const others = Math.max(0, size - 1);
      if (extra > 0 && others > extra) {
        maxPages = Math.max(maxPages, Math.ceil(others / extra));
      }
    });

    const list = [];
    classKeys.forEach((cls) => {
      list.push({ type: "header", label: cls });
      const sorted = groups[cls].slice().sort(sortByTiming)
        .map((e, i) => ({ type: "row", entry: e, displayPosition: i + 1 }));
      if (sorted.length === 0) return;
      const maxSlots = perClass[cls] || 1;
      list.push(sorted[0]);
      const others = sorted.slice(1);
      const extraSlots = Math.max(0, maxSlots - 1);
      if (others.length <= extraSlots) {
        others.forEach((item) => list.push(item));
        for (let s = others.length; s < extraSlots; s++) list.push({ type: "spacer" });
      } else if (extraSlots > 0) {
        const page = pickRotated(others, rotateTick, extraSlots, maxPages);
        page.forEach((item) => list.push({ ...item, rotating: true }));
        for (let s = page.length; s < extraSlots; s++) list.push({ type: "spacer" });
      }
    });
    return withAhead(list);
  }

  if (mode === "Minha classe") {
    const viewed = standings.find((e) => e.isPlayer);
    const myClass = viewed ? viewed.carClass : null;
    const ordered = standings
      .filter((e) => e.carClass === myClass)
      .slice()
      .sort(sortByTiming)
      .map((e, i) => ({ type: "row", entry: e, displayPosition: i + 1 }));
    const maxSlots = maxDriverSlots();
    if (ordered.length <= maxSlots) return withAhead(ordered);
    const page = pickRotated(ordered, rotateTick, maxSlots).map((item) => ({ ...item, rotating: true }));
    while (page.length < maxSlots) page.push({ type: "spacer" });
    return withAhead(page);
  }

  return [];
}

function currentPageLabel(standings) {
  const mode = PAGE_MODES[pageIndex];
  if (mode === "Minha classe") {
    const viewed = standings.find((e) => e.isPlayer);
    return (viewed && formatClassName(viewed.carClass)) || "Minha classe";
  }
  return mode;
}

function render(standings) {
  document.getElementById("rightColumnLabel").textContent = RIGHT_COLUMN_MODES[rightColumnIndex];
  document.getElementById("pageLabel").textContent = currentPageLabel(standings);

  ensureBaselines(standings, latestSessionLabel);

  const isClassMode = PAGE_MODES[pageIndex] !== "Geral";
  const showLapHighlight = RIGHT_COLUMN_MODES[rightColumnIndex] === "Última volta" || RIGHT_COLUMN_MODES[rightColumnIndex] === "Melhor volta";

  const displayList = buildDisplayList(standings);
  const container = document.getElementById("rows");

  const bestOverallFastest = (() => {
    const t = standings.map((e) => e.fastestLapMs).filter((v) => typeof v === "number" && v > 0);
    return t.length ? Math.min(...t) : null;
  })();
  const bestOverallLast = (() => {
    const t = standings.map((e) => e.lastLapMs).filter((v) => typeof v === "number" && v > 0);
    return t.length ? Math.min(...t) : null;
  })();
  const mode = RIGHT_COLUMN_MODES[rightColumnIndex];

  const bestFastestByClass = {};
  const bestLastByClass = {};
  const bestSectorsByClass = {};
  const bestSectorsOverall = [null, null, null];
  standings.forEach((e) => {
    const cls = e.carClass || "—";
    if (e.fastestLapMs > 0 && (bestFastestByClass[cls] == null || e.fastestLapMs < bestFastestByClass[cls])) {
      bestFastestByClass[cls] = e.fastestLapMs;
    }
    if (e.lastLapMs > 0 && (bestLastByClass[cls] == null || e.lastLapMs < bestLastByClass[cls])) {
      bestLastByClass[cls] = e.lastLapMs;
    }
    if (!bestSectorsByClass[cls]) bestSectorsByClass[cls] = [null, null, null];
    const bs = [e.bestSector1Ms, e.bestSector2Ms, e.bestSector3Ms];
    for (let i = 0; i < 3; i++) {
      if (bs[i] > 0 && (bestSectorsByClass[cls][i] == null || bs[i] < bestSectorsByClass[cls][i])) {
        bestSectorsByClass[cls][i] = bs[i];
      }
      if (bs[i] > 0 && (bestSectorsOverall[i] == null || bs[i] < bestSectorsOverall[i])) {
        bestSectorsOverall[i] = bs[i];
      }
    }
  });

  while (container.children.length > displayList.length) {
    container.removeChild(container.lastChild);
  }

  const purpleOwners = computePurpleOwners(standings, isClassMode);

  // distancia do carro a frente real (ordem completa, nao so visivel)
  {
    const byClass = {};
    standings.slice().sort((a, b) => a.position - b.position).forEach((e) => {
      const cls = e.carClass || "—";
      if (!byClass[cls]) byClass[cls] = [];
      byClass[cls].push(e);
    });
    const overall = standings.slice().sort((a, b) => a.position - b.position);
    overall.forEach((e, i) => {
      e._aheadDistance = i > 0 ? overall[i - 1].totalDistance : null;
    });
    if (isClassMode) {
      Object.values(byClass).forEach((list) => {
        list.forEach((e, i) => {
          e._aheadDistance = i > 0 ? list[i - 1].totalDistance : null;
        });
      });
    }
  }

  let prevDistance = null;
  let prevFastestMs = null;
  let groupLeaderDistance = null;
  let bestFastestMs = null;

  const overallBestFastest = (() => {
    const times = standings.map((e) => e.fastestLapMs).filter((v) => typeof v === "number" && v > 0);
    return times.length ? Math.min(...times) : null;
  })();

  const overallLeaderDistance = (() => {
    let maxD = null;
    standings.forEach((e) => {
      if (typeof e.totalDistance === "number" && (maxD === null || e.totalDistance > maxD)) maxD = e.totalDistance;
    });
    return maxD;
  })();

  displayList.forEach((item, i) => {
    let el = container.children[i];

    if (item.type === "header") {
      if (!el || el.dataset.kind !== "header") {
        const fresh = document.createElement("div");
        fresh.className = "class-header";
        fresh.dataset.kind = "header";
        if (el) container.replaceChild(fresh, el);
        else container.appendChild(fresh);
        el = fresh;
      }
      el.textContent = formatClassName(item.label);
      const hClr = classColor(item.label);
      el.style.borderLeftColor = hClr;
      el.style.background = hClr;
      el.style.color = "#fff";
      prevDistance = null;
      prevFastestMs = null;
      groupLeaderDistance = null;
      const groupEntries = [];
      for (let j = i + 1; j < displayList.length && displayList[j].type === "row"; j++) {
        groupEntries.push(displayList[j].entry);
      }
      const times = groupEntries.map((e) => e.fastestLapMs).filter((v) => typeof v === "number" && v > 0);
      bestFastestMs = times.length ? Math.min(...times) : null;
      groupEntries.forEach((e) => {
        if (typeof e.totalDistance === "number" && (groupLeaderDistance === null || e.totalDistance > groupLeaderDistance)) {
          groupLeaderDistance = e.totalDistance;
        }
      });
      return;
    }

    if (item.type === "spacer") {
      if (!el || el.dataset.kind !== "spacer") {
        const fresh = document.createElement("div");
        fresh.className = "row row-spacer";
        fresh.dataset.kind = "spacer";
        if (el) container.replaceChild(fresh, el);
        else container.appendChild(fresh);
        el = fresh;
      }
      return;
    }

    if (bestFastestMs === null && !isClassMode) {
      bestFastestMs = overallBestFastest;
    }
    if (groupLeaderDistance === null && !isClassMode) {
      groupLeaderDistance = overallLeaderDistance;
    }

    if (!el || el.dataset.kind !== "row") {
      const fresh = document.createElement("div");
      fresh.className = "row";
      fresh.dataset.kind = "row";
      fresh.innerHTML = `
        <span class="col pos"></span>
        <span class="col name"><img class="logo" style="display:none" /><span class="name-text"></span><span class="sectors"><i></i><i></i><i></i></span><span class="pit-badge" style="display:none">P</span></span>
        <span class="col right-value"></span>
      `;
      if (el) container.replaceChild(fresh, el);
      else container.appendChild(fresh);
      el = fresh;
    }

    const entry = item.entry;
    const prevPos = lastDisplayPos.has(entry.name) ? lastDisplayPos.get(entry.name) : null;
    const posChanged = prevPos !== null && prevPos !== item.displayPosition;

    const isDriving = entry.isPlayer && (
      !entry.inRace ||
      entry.lapsCompleted > 0 ||
      entry.pitMode === 0 ||
      entry.pitMode === 3 ||
      entry.pitMode === 5
    );

    el.classList.toggle("player", playerHighlightEnabled && isDriving);
    el.classList.toggle("dnf", isDnf(entry));
    let isPurple = false;
    const cls = entry.carClass || "—";
    const sessionBest = isClassMode ? bestFastestByClass[cls] : bestOverallFastest;
    if (mode === "Melhor volta") {
      isPurple = entry.fastestLapMs > 0 && entry.fastestLapMs === sessionBest;
    } else if (mode === "Última volta") {
      isPurple = entry.lastLapMs > 0 && sessionBest != null && entry.lastLapMs === sessionBest;
    } else if (mode === "Intervalo" && !isRaceSession()) {
      isPurple = false;
    }
    el.classList.toggle("fastest", isPurple);
    const clr = classColor(entry.carClass);
    el.style.borderTopColor = clr;
    el.classList.toggle("yellow-flag", !!entry.causedYellow);
    if (!el.classList.contains("flash-up") && !el.classList.contains("flash-down")) {
      if (entry.causedYellow) {
        el.style.backgroundColor = "#c9a000";
      } else {
        el.style.backgroundColor = el.classList.contains("player") ? "#006bdd" : "#0e42a5";
      }
    }
    const posEl = el.querySelector(".pos");
    posEl.style.background = clr;
    posEl.style.color = "#fff";

    if (posChanged) {
      const gained = item.displayPosition < prevPos;
      el.classList.remove("flash-up", "flash-down");
      void el.offsetWidth;
      el.classList.add(gained ? "flash-up" : "flash-down");
      const flashCls = gained ? "flash-up" : "flash-down";
      setTimeout(() => {
        el.classList.remove(flashCls);
        if (entry.causedYellow) {
          el.style.backgroundColor = "#c9a000";
        } else {
          el.style.backgroundColor = el.classList.contains("player") ? "#006bdd" : "#0e42a5";
        }
      }, 500);
    }

    if (item.rotating && el.dataset.name !== entry.name) {
      el.classList.remove("slide-in");
      void el.offsetWidth;
      el.classList.add("slide-in");
    }

    lastDisplayPos.set(entry.name, item.displayPosition);
    el.dataset.name = entry.name;
    el.dataset.pos = String(item.displayPosition);

    const logoFile = carLogo(entry.carName);
    const logoImg = el.querySelector(".logo");
    if (logoFile) {
      logoImg.src = `assets/logos/${logoFile}`;
      logoImg.style.display = "";
    } else {
      logoImg.style.display = "none";
    }

    const change = positionChange(entry, item.displayPosition, isClassMode);
    const gapRef = (typeof entry._aheadDistance === "number") ? entry._aheadDistance : prevDistance;
    posEl.textContent = item.displayPosition;
    el.querySelector(".name-text").textContent = entry.name;
    const rowBestFastest = (isClassMode && bestFastestByClass[entry.carClass || "—"] != null)
      ? bestFastestByClass[entry.carClass || "—"]
      : (bestFastestMs != null ? bestFastestMs : bestOverallFastest);
    const aheadFast = item.aheadFastestMs != null ? item.aheadFastestMs : prevFastestMs;
    const rv = rightColumnValue(entry, change, gapRef, rowBestFastest, groupLeaderDistance, aheadFast);
    const rvEl = el.querySelector(".right-value");
    rvEl.textContent = rv.text;
    rvEl.className = "col right-value" + (rv.cls ? ` ${rv.cls}` : "");

    const badge = el.querySelector(".pit-badge");
    if (rv.pitPhase === "in" || rv.pitPhase === "out") {
      badge.style.display = "";
      badge.textContent = "P";
      badge.className = "pit-badge pit-in";
    } else if (rv.pitPhase === "done") {
      badge.style.display = "";
      badge.textContent = "OUT";
      badge.className = "pit-badge pit-out";
    } else {
      badge.style.display = "none";
      badge.className = "pit-badge";
    }

    const secWrap = el.querySelector(".sectors");
    if (secWrap) {
      const showSec = (isTimedSession() || !isRaceSession())
        && !isOutLap(entry)
        && entry.pitMode !== 1
        && entry.pitMode !== 2
        && entry.pitMode !== 3;
      secWrap.style.display = showSec ? "" : "none";
      if (showSec) {
        const colors = updateSectorDisplay(entry, purpleOwners);
        const boxes = secWrap.querySelectorAll("i");
        boxes.forEach((box, idx) => {
          box.className = colors[idx] ? `sec-${colors[idx]}` : "";
        });
      }
    }
    prevDistance = entry.totalDistance;
    prevFastestMs = entry.fastestLapMs > 0 ? entry.fastestLapMs : prevFastestMs;
  });
}

function formatTime(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

document.addEventListener("keydown", (e) => {
  if (e.key === ",") {
    rightColumnIndex = (rightColumnIndex - 1 + RIGHT_COLUMN_MODES.length) % RIGHT_COLUMN_MODES.length;
    render(latestStandings);
  } else if (e.key === ".") {
    rightColumnIndex = (rightColumnIndex + 1) % RIGHT_COLUMN_MODES.length;
    render(latestStandings);
  } else if (e.key === "[") {
    pageIndex = (pageIndex - 1 + PAGE_MODES.length) % PAGE_MODES.length;
    render(latestStandings);
  } else if (e.key === "]") {
    pageIndex = (pageIndex + 1) % PAGE_MODES.length;
    render(latestStandings);
  } else if (e.key === "p" || e.key === "P") {
    playerHighlightEnabled = !playerHighlightEnabled;
    render(latestStandings);
  }
});

setInterval(() => {
  if (!latestStandings.length) return;
  if (pitTimers.size > 0 || sectorState.size > 0) render(latestStandings);
}, 200);

setInterval(() => {
  rotateTick += 1;
  if (latestStandings.length) render(latestStandings);
}, ROTATE_MS);

if (DEMO) {
  latestStandings = [
    { position: 1, name: "Willian Garcia[PRO]", carClass: "GT3_LD", carName: "Mercedes-AMG GT3 Evo", currentLap: 8, lapsCompleted: 7, lastLapMs: 82345, fastestLapMs: 81900, totalDistance: 32000, speedMs: 55 },
    { position: 2, name: "Luís Guimarães[PRO]", carClass: "GT3_LD", carName: "Ferrari 488 GT3 Evo 2020", currentLap: 8, lapsCompleted: 7, lastLapMs: 82890, fastestLapMs: 82100, totalDistance: 31940, speedMs: 54 },
    { position: 3, name: "Ader Fernando", carClass: "GT3_LD", carName: "Porsche 911 GT3 R (991.2)", currentLap: 8, lapsCompleted: 7, lastLapMs: 83210, fastestLapMs: 82750, totalDistance: 31800, speedMs: 53, isPlayer: true },
    { position: 4, name: "Leandro Santos[AM]", carClass: "GT4_HD", carName: "McLaren 570S GT4", currentLap: 7, lapsCompleted: 6, lastLapMs: 83500, fastestLapMs: 83100, totalDistance: 27500, speedMs: 51 },
    { position: 5, name: "Catroi[Pro]", carClass: "GT4_HD", carName: "Aston Martin Vantage GT4", currentLap: 7, lapsCompleted: 6, lastLapMs: 83790, fastestLapMs: 83400, totalDistance: 27300, speedMs: 50 },
  ];
  render(latestStandings);
} else {
  connect();
}
