const params = new URLSearchParams(location.search);
const DEMO = params.get("demo") === "1";

const WS_URL = `ws://${location.hostname}:${location.port || 8080}/ws`;

const RIGHT_COLUMN_MODES = ["Intervalo", "Última volta", "Melhor volta", "Posições"];
let rightColumnIndex = 0;

const PAGE_MODES = ["Geral", "Multiclasse", "Minha classe"];
let pageIndex = 0;

let latestStandings = [];

// baseline de posicoes (capturada na primeira mensagem apos abrir a pagina --
// atualize/recarregue a overlay no grid de largada pra isso refletir o
// ganho/perda de posicoes da corrida certinho)
let startOverall = null; // Map nome -> posicao geral inicial
let startInClass = null; // Map nome -> posicao dentro da classe inicial

function ensureBaselines(standings) {
  if (startOverall) return;

  startOverall = new Map(standings.map((e) => [e.name, e.position]));

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
      updateSessionHeader(session);
      render(latestStandings);
    }
  });
  socket.addEventListener("close", () => setTimeout(connect, 2000));
}

function updateSessionHeader(session) {
  if (!session) return;
  document.getElementById("sessionLabel").textContent = session.label || "CORRIDA";

  const totalSeconds = session.timeRemainingSec;
  if (typeof totalSeconds === "number" && totalSeconds > 0) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const text = h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
    document.getElementById("sessionTimer").textContent = text;
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
  if (CLASS_COLORS[carClass]) return CLASS_COLORS[carClass];
  const formatted = formatClassName(carClass);
  return CLASS_COLORS[formatted] || DEFAULT_COLOR;
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

function rightColumnValue(entry, change, leaderDistance) {
  if (isDnf(entry)) return { text: "DNF", cls: "pos-down" };

  const pit = updatePitTimer(entry);
  if (pit && (pit.phase === "in" || pit.phase === "out")) {
    const elapsed = Date.now() - pit.enteredAt;
    return { text: formatPitDuration(elapsed), cls: "pit-time", pitPhase: pit.phase };
  }

  const mode = RIGHT_COLUMN_MODES[rightColumnIndex];
  let result;
  if (mode === "Intervalo") {
    result = formatGap(entry, leaderDistance, change);
  } else if (mode === "Última volta") {
    result = { text: entry.lastLapMs ? formatTime(entry.lastLapMs) : "--:--.---", cls: "" };
  } else if (mode === "Melhor volta") {
    result = { text: entry.fastestLapMs ? formatTime(entry.fastestLapMs) : "--:--.---", cls: "" };
  } else if (mode === "Posições") {
    result = formatPosChange(change);
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

function isInPit(entry) {
  return entry.pitMode === 1 || entry.pitMode === 2;
}

function isExitingPit(entry) {
  return entry.pitMode === 3;
}

function updatePitTimer(entry) {
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

function formatGap(entry, aheadDistance, change) {
  if (isDnf(entry)) return { text: "DNF", cls: "pos-down" };
  const firstLap = !entry.lapsCompleted || entry.currentLap <= 1;
  if (firstLap) return formatPosChange(change);

  if (typeof entry.splitAhead === "number" && entry.splitAhead >= 0) {
    return { text: `+${entry.splitAhead.toFixed(1)}`, cls: "" };
  }
  if (typeof aheadDistance !== "number" || typeof entry.totalDistance !== "number") {
    if (aheadDistance === null || aheadDistance === undefined) {
      return { text: entry.currentLap != null ? `Volta ${entry.currentLap}` : "-", cls: "" };
    }
    return { text: "-", cls: "" };
  }
  if (!entry.speedMs || entry.speedMs < 2) return { text: "-", cls: "" };

  const distanceBehind = aheadDistance - entry.totalDistance;
  if (distanceBehind <= 0.5) return { text: `Volta ${entry.currentLap ?? 0}`, cls: "" };

  const gapSeconds = distanceBehind / entry.speedMs;
  return { text: `+${gapSeconds.toFixed(1)}`, cls: "" };
}

function buildDisplayList(standings) {
  const mode = PAGE_MODES[pageIndex];

  if (mode === "Geral") {
    return standings.map((e) => ({ type: "row", entry: e, displayPosition: e.position }));
  }

  if (mode === "Multiclasse") {
    const groups = {};
    standings.forEach((e) => {
      const cls = e.carClass || "—";
      (groups[cls] = groups[cls] || []).push(e);
    });

    const list = [];
    Object.keys(groups).forEach((cls) => {
      list.push({ type: "header", label: cls });
      groups[cls]
        .slice()
        .sort((a, b) => a.position - b.position)
        .forEach((e, i) => list.push({ type: "row", entry: e, displayPosition: i + 1 }));
    });
    return list;
  }

  if (mode === "Minha classe") {
    const viewed = standings.find((e) => e.isPlayer);
    const myClass = viewed ? viewed.carClass : null;
    return standings
      .filter((e) => e.carClass === myClass)
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((e, i) => ({ type: "row", entry: e, displayPosition: i + 1 }));
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

  ensureBaselines(standings);

  const isClassMode = PAGE_MODES[pageIndex] !== "Geral";
  const showLapHighlight = RIGHT_COLUMN_MODES[rightColumnIndex] === "Última volta" || RIGHT_COLUMN_MODES[rightColumnIndex] === "Melhor volta";

  const displayList = buildDisplayList(standings);
  const container = document.getElementById("rows");

  const bestOverall = Math.min(
    ...standings.map((e) => e.fastestLapMs).filter((v) => typeof v === "number" && v > 0)
  );
  const mode = RIGHT_COLUMN_MODES[rightColumnIndex];

  while (container.children.length > displayList.length) {
    container.removeChild(container.lastChild);
  }

  let prevDistance = null;

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
      return;
    }

    if (!el || el.dataset.kind !== "row") {
      const fresh = document.createElement("div");
      fresh.className = "row";
      fresh.dataset.kind = "row";
      fresh.innerHTML = `
        <span class="col pos"></span>
        <span class="col name"><img class="logo" style="display:none" /><span class="name-text"></span><span class="pit-badge" style="display:none">P</span></span>
        <span class="col right-value"></span>
      `;
      if (el) container.replaceChild(fresh, el);
      else container.appendChild(fresh);
      el = fresh;
    }

    const entry = item.entry;
    const prevPos = el.dataset.pos ? parseInt(el.dataset.pos, 10) : null;
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
    if (showLapHighlight && typeof bestOverall === "number" && isFinite(bestOverall)) {
      if (mode === "Melhor volta") isPurple = entry.fastestLapMs === bestOverall;
      else if (mode === "Última volta") isPurple = entry.lastLapMs === bestOverall;
    }
    el.classList.toggle("fastest", isPurple);
    const clr = classColor(entry.carClass);
    el.style.borderTopColor = clr;
    const scOut = document.getElementById("timing-table")?.classList.contains("sc-out");
    if (scOut) {
      el.style.backgroundColor = el.classList.contains("player") ? "#f0c400" : "#d4a800";
    } else {
      el.style.backgroundColor = el.classList.contains("player") ? "#006bdd" : "#0e42a5";
    }
    const posEl = el.querySelector(".pos");
    posEl.style.background = clr;
    posEl.style.color = "#fff";

    el.classList.remove("flash-up", "flash-down");
    if (posChanged) {
      const gained = item.displayPosition < prevPos;
      void el.offsetWidth;
      el.classList.add(gained ? "flash-up" : "flash-down");
    }

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
    const gapRef = prevDistance;
    posEl.textContent = item.displayPosition;
    el.querySelector(".name-text").textContent = entry.name;
    const rv = rightColumnValue(entry, change, gapRef);
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
    prevDistance = entry.totalDistance;
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
  if (pitTimers.size > 0 && latestStandings.length) render(latestStandings);
}, 200);

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
