// overlay/timing-table.js
//
// Espera receber do servidor mensagens do tipo:
//   { type: "standings", data: [ { position, name, currentLap, lastLapMs, fastestLapMs, isPlayer }, ... ] }
// Isso vem direto do listener.ps1, que le a Shared Memory do AMS2.
//
// Cor (por classe) e logo (por carro) vem de overlay/drivers-config.js.
//
// Atalhos de teclado "," e "." trocam a coluna da direita entre os modos
// disponiveis (Intervalo / Ultima volta / Melhor volta / Posicoes ganhas-perdidas).
// Atalhos "[" e "]" trocam a pagina entre Geral / Multiclasse / Minha classe.
// Atalho "p" liga/desliga o destaque de "voce" (util quando esta so'
// espectando, ja que o jogo nao diz se voce esta pilotando ou so' assistindo).
//
// "Posicoes" compara com a posicao de cada piloto na primeira mensagem
// recebida apos abrir a pagina -- recarregue a overlay no grid de largada
// pra esse numero refletir a corrida certinho desde o inicio.
//
// Pra já visualizar o layout no OBS antes de ligar a telemetria real,
// adicione ?demo=1 na URL do Browser Source.

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
  const baseline = isClassMode ? startInClass : startOverall;
  if (!baseline || !baseline.has(entry.name)) return null;
  return baseline.get(entry.name) - displayPosition; // positivo = ganhou posicoes
}

function connect() {
  const socket = new WebSocket(WS_URL);
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "standings") {
      const payload = msg.data;
      // aceita tanto o formato novo ({session, standings}) quanto uma lista pura (modo demo)
      const standings = Array.isArray(payload) ? payload : payload.standings || [];
      const session = Array.isArray(payload) ? null : payload.session;

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
  const formatted = formatClassName(carClass);
  return (typeof CLASS_COLORS !== "undefined" && CLASS_COLORS[formatted]) || DEFAULT_COLOR;
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
  const mode = RIGHT_COLUMN_MODES[rightColumnIndex];
  if (mode === "Intervalo") {
    return formatGap(entry, leaderDistance);
  }
  if (mode === "Última volta") {
    return entry.lastLapMs ? formatTime(entry.lastLapMs) : "--:--.---";
  }
  if (mode === "Melhor volta") {
    return entry.fastestLapMs ? formatTime(entry.fastestLapMs) : "--:--.---";
  }
  if (mode === "Posições") {
    if (change === null || change === undefined) return "-";
    if (change === 0) return "=";
    return change > 0 ? `▲${change}` : `▼${Math.abs(change)}`;
  }
  return "-";
}

// Estimativa de intervalo baseada em distancia percorrida (a Shared Memory
// nao entrega o gap pronto). E' uma aproximacao usada por varias ferramentas
// da comunidade quando so' se tem posicao/distancia -- nao e' tao preciso
// quanto uma medicao de linha de tempo real, mas da uma nocao boa ao vivo.
function formatGap(entry, leaderDistance) {
  if (typeof leaderDistance !== "number" || typeof entry.totalDistance !== "number") return "-";
  if (!entry.lapsCompleted && entry.currentLap <= 1) return "-"; // ainda no grid/1a volta, numero pouco confiavel
  if (!entry.speedMs || entry.speedMs < 2) return "-"; // parado (grid, pit) -- evita divisao por quase-zero

  const distanceBehind = leaderDistance - entry.totalDistance;
  if (distanceBehind <= 0.5) return "Líder";

  const gapSeconds = distanceBehind / entry.speedMs;
  //return `+${gapSeconds.toFixed(1)}`;
  return (entry.splitAhead)
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

  while (container.children.length > displayList.length) {
    container.removeChild(container.lastChild);
  }

  let currentLeaderDistance = null;

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
      currentLeaderDistance = null; // proximo grupo tem seu proprio lider
      return;
    }

    if (currentLeaderDistance === null) currentLeaderDistance = item.entry.totalDistance;

    if (!el || el.dataset.kind !== "row") {
      const fresh = document.createElement("div");
      fresh.className = "row";
      fresh.dataset.kind = "row";
      fresh.innerHTML = `
        <span class="col pos"></span>
        <span class="col name"><img class="logo" style="display:none" /><span class="name-text"></span></span>
        <span class="col right-value"></span>
      `;
      if (el) container.replaceChild(fresh, el);
      else container.appendChild(fresh);
      el = fresh;
    }

    const entry = item.entry;
    const changedName = el.dataset.name && el.dataset.name !== entry.name;

    el.classList.toggle("player", playerHighlightEnabled && !!entry.isPlayer);
    el.classList.toggle("fastest", showLapHighlight && entry.fastestLapMs === bestOverall);
    el.style.borderLeftColor = classColor(entry.carClass);
    if (changedName) {
      el.classList.remove("moved");
      void el.offsetWidth;
      el.classList.add("moved");
    }

    el.dataset.name = entry.name;

    const logoFile = carLogo(entry.carName);
    const logoImg = el.querySelector(".logo");
    if (logoFile) {
      logoImg.src = `assets/logos/${logoFile}`;
      logoImg.style.display = "";
    } else {
      logoImg.style.display = "none";
    }

    const change = positionChange(entry, item.displayPosition, isClassMode);

    el.querySelector(".pos").textContent = item.displayPosition;
    el.querySelector(".name-text").textContent = entry.name;
    el.querySelector(".right-value").textContent = rightColumnValue(entry, change, currentLeaderDistance);
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
