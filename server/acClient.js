// server/acClient.js
// Assetto Corsa (o primeiro). O jogo so mostra para programas de fora os dados
// do carro do jogador, entao os dados de todos os carros vem de um app Python
// que roda dentro do jogo (ac-app/LLGOverlay). Ele manda uma linha de JSON a
// cada 0,1 s por um named pipe do Windows, que este arquivo abre.
//
// O app nao sabe qual e a sessao (treino, classificacao, corrida) nem quanto
// tempo falta: isso esta na Shared Memory do jogo, lida pelo listener.ps1,
// que avisa o servidor (setStatus).
//
// Aqui os dados viram o mesmo formato dos outros jogos.

const net = require("net");
const fs = require("fs");
const path = require("path");

const DEFAULT_PIPE = "\\\\.\\pipe\\llg-overlay-ac";
const STATUS_STALE_MS = 3000;
const MAX_LINE_BYTES = 1024 * 1024;

// tipo de sessao do AC -> codigo usado nas overlays (o do AMS2)
// 0 treino, 1 classificacao, 2 corrida, 3 hotlap, 4 time attack, 5 drift, 6 drag
const SESSION_STATE = { 0: 1, 1: 3, 2: 5, 3: 6, 4: 6, 5: 1, 6: 5 };
const SESSION_LABELS = { 1: "TREINO LIVRE", 3: "CLASSIFICACAO", 5: "CORRIDA", 6: "TIME ATTACK" };

// ---- dados dos carros (pasta do jogo) ----
// Os ui_car.json do jogo e de mods costumam ter quebras de linha dentro dos
// textos, o que nao e JSON valido. Por isso os campos sao pescados um a um.
function textField(text, key) {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
  return m ? m[1].trim() : "";
}

function tagList(text) {
  const m = /"tags"\s*:\s*\[([^\]]*)\]/.exec(text);
  if (!m) return [];
  return (m[1].match(/"((?:[^"\\]|\\.)*)"/g) || []).map((s) => s.slice(1, -1).trim());
}

// Classe do carro: o AC nao tem classes de corrida. O mais perto disso e a
// etiqueta com "#" que os carros trazem (#GT3, #Supercars...). Sem ela, vale
// o campo "class" (street/race).
function classFromUi(text) {
  const tag = tagList(text).find((t) => t.startsWith("#") && t.length > 1);
  if (tag) return tag.slice(1).trim();
  const cls = textField(text, "class");
  return cls ? cls.charAt(0).toUpperCase() + cls.slice(1) : "";
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    return "";
  }
}

function readCarInfoFromDisk(root, model, skin) {
  if (!root || !model || /[\\/]/.test(model) || /[\\/]/.test(skin || "")) return {};
  const carDir = path.join(root, "content", "cars", model);
  const ui = readText(path.join(carDir, "ui", "ui_car.json"));
  const skinUi = skin ? readText(path.join(carDir, "skins", skin, "ui_skin.json")) : "";
  return {
    name: textField(ui, "name"),
    carClass: classFromUi(ui),
    number: textField(skinUi, "number"),
    team: textField(skinUi, "team"),
  };
}

function prettyModel(model) {
  return String(model || "")
    .replace(/^ks_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- conversao para o formato das overlays ----
function createAcState(options) {
  const opts = options || {};
  const now = opts.clock || Date.now;
  const readCarInfo = opts.readCarInfo || readCarInfoFromDisk;

  let status = null; // { at, status, session, timeLeftMs, laps, timed }
  let sessionKey = null;
  const carInfo = new Map(); // "modelo|skin" -> dados da pasta do jogo
  const lastLaps = new Map();
  const progress = new Map(); // id -> { behindLine, wrapped, last }
  const frozen = new Map(); // id -> posicao com que recebeu a bandeirada
  const maxSpeed = new Map();
  const bestSplits = new Map();

  function resetSession() {
    lastLaps.clear();
    progress.clear();
    frozen.clear();
    maxSpeed.clear();
    bestSplits.clear();
  }

  function setStatus(s) {
    status = s ? Object.assign({}, s, { at: now() }) : null;
  }

  function info(root, model, skin) {
    const key = `${model}|${skin}`;
    if (!carInfo.has(key)) carInfo.set(key, readCarInfo(root, model, skin) || {});
    return carInfo.get(key);
  }

  // Na largada os carros estao ANTES da linha, com a posicao na volta perto
  // de 1 e nenhuma volta completa; sem corrigir, a distancia percorrida daria
  // quase uma volta a mais. Quem e visto assim na largada vale "menos uma
  // volta" ate cruzar a linha (mesma regra do ACC).
  function trackProgress(c, isRace) {
    let st = progress.get(c.id);
    if (!st) {
      st = { behindLine: isRace && c.laps === 0 && c.spline > 0.5 && !(c.lapMs > 20000), wrapped: false, last: c.spline };
      progress.set(c.id, st);
    }
    if (st.last - c.spline > 0.5) st.wrapped = true;
    st.last = c.spline;
    return c.laps + Math.max(0, Math.min(1, c.spline)) - (st.behindLine && !st.wrapped ? 1 : 0);
  }

  function emptyPayload(track, config, length) {
    return {
      game: "ac",
      session: { state: 0, label: null, timeRemainingSec: 0, lapsInEvent: 0, scOut: false, trackLocation: track || "", trackVariation: config || "", trackLength: length || 0 },
      standings: [],
    };
  }

  function frame(msg) {
    const t = now();
    const st = status && t - status.at <= STATUS_STALE_MS ? status : null;
    const trackLength = Number(msg.length) || 0;
    if (st && st.status === 0) return emptyPayload(msg.track, msg.config, trackLength);

    // sem o aviso do listener nao da para saber a sessao: assume treino
    const state = st ? SESSION_STATE[st.session] || 1 : 1;
    const isRace = state === 5;
    const cars = (Array.isArray(msg.cars) ? msg.cars : []).filter((c) => c && c.connected !== 0 && c.name);

    const key = `${st ? st.session : "?"}|${msg.track}|${msg.config}`;
    // sessao reiniciada: as voltas de alguem voltaram para tras
    const restarted = cars.some((c) => lastLaps.has(c.id) && c.laps < lastLaps.get(c.id));
    if (key !== sessionKey || restarted) {
      sessionKey = key;
      resetSession();
    }
    cars.forEach((c) => lastLaps.set(c.id, c.laps));

    const dist = new Map(cars.map((c) => [c.id, trackProgress(c, isRace)]));

    // Ordem. Em corrida, pela distancia percorrida: a posicao ao vivo do jogo
    // nao serve antes da largada (o grid vinha embaralhado) e oscila nos
    // primeiros segundos; ela so desempata. Fora da corrida vale a tabela de
    // tempos do jogo e, se ela nao vier, a melhor volta.
    const gamePos = (c) => (isRace ? c.posRace : c.posBoard);
    const values = cars.map(gamePos);
    const usable = values.every((v) => typeof v === "number" && isFinite(v)) && new Set(values).size === values.length;
    const byGame = (a, b) => (usable ? gamePos(a) - gamePos(b) : a.id - b.id);
    const ordered = cars.slice().sort((a, b) => {
      if (isRace) return dist.get(b.id) - dist.get(a.id) || byGame(a, b);
      if (usable) return byGame(a, b);
      return (a.bestMs > 0 ? a.bestMs : Infinity) - (b.bestMs > 0 ? b.bestMs : Infinity) || a.id - b.id;
    });

    // Bandeirada: quem terminou fica congelado na posicao em que cruzou a
    // linha. Depois de terminar os carros continuam andando, e a posicao ao
    // vivo do jogo deixaria de valer.
    const position = new Map();
    if (isRace) {
      const slots = new Array(ordered.length).fill(null);
      ordered.forEach((c) => {
        if (!c.finished || !frozen.has(c.id)) return;
        let i = Math.min(frozen.get(c.id), slots.length) - 1;
        while (i < slots.length && slots[i] !== null) i++;
        if (i < slots.length) slots[i] = c;
      });
      let next = 0;
      ordered.forEach((c) => {
        if (slots.includes(c)) return;
        while (slots[next] !== null) next++;
        slots[next] = c;
      });
      slots.forEach((c, i) => {
        position.set(c.id, i + 1);
        if (c.finished && !frozen.has(c.id)) frozen.set(c.id, i + 1);
      });
    } else {
      ordered.forEach((c, i) => position.set(c.id, i + 1));
    }

    const ms = (v) => (v > 0 ? v : null);
    const standings = cars.map((c) => {
      const ui = info(msg.root, c.model, c.skin);
      const speedKmh = Math.max(0, Number(c.kmh) || 0);
      const top = Math.max(maxSpeed.get(c.id) || 0, speedKmh);
      maxSpeed.set(c.id, top);

      const last = Array.isArray(c.lastSplits) ? c.lastSplits : [];
      const cur = Array.isArray(c.curSplits) ? c.curSplits.map(ms) : null;
      let best = bestSplits.get(c.id);
      if (!best) bestSplits.set(c.id, (best = [null, null, null]));
      for (let i = 0; i < 3; i++) if (last[i] > 0 && (best[i] == null || last[i] < best[i])) best[i] = last[i];
      const currentSector = cur ? (cur[0] == null ? 0 : cur[1] == null ? 1 : 2) : null;

      const number = ui.number && ui.number !== "0" ? ui.number : null;
      return {
        slot: c.id,
        position: position.get(c.id),
        name: c.name,
        carName: ui.name || prettyModel(c.model),
        carClass: ui.carClass || "",
        teamName: ui.team || "",
        carNumber: number,
        lapsCompleted: c.laps,
        currentLap: c.laps + 1,
        totalDistance: dist.get(c.id) * trackLength,
        lastLapMs: ms(c.lastMs),
        fastestLapMs: ms(c.bestMs),
        speedKmh,
        speedMs: Math.round((speedKmh / 3.6) * 100) / 100,
        maxSpeedKmh: top,
        isPlayer: c.id === msg.focused, // carro em foco na camera do jogo
        // box: mesmos codigos do AMS2 (2 no pit lane, 4 na garagem)
        pitMode: c.pitBox ? 4 : c.pitLane ? 2 : 0,
        raceState: isRace && c.finished ? 3 : 2,
        inRace: isRace,
        sector1Ms: cur ? cur[0] : null,
        sector2Ms: cur ? cur[1] : null,
        sector3Ms: currentSector !== 2 ? ms(last[2]) : null,
        currentSector,
        bestSector1Ms: best[0],
        bestSector2Ms: best[1],
        bestSector3Ms: best[2],
        causedYellow: false,
        lapInvalidated: !!c.invalid,
        // composto de pneu: o jogo da a sigla (S, M, H, SH...), igual nos dois eixos
        tyreFront: c.tyre || "",
        tyreRear: c.tyre || "",
      };
    });
    standings.sort((a, b) => a.position - b.position);

    // corrida por voltas: o jogo nao tem tempo restante
    const byLaps = isRace && st && !st.timed && st.laps > 0;
    // o aviso do listener chega poucas vezes por segundo: desconta o tempo
    // passado desde ele para o relogio andar por igual (parado se em pausa)
    const timeLeftMs = st ? (st.timeLeftMs || 0) - (st.status === 2 ? t - st.at : 0) : 0;
    return {
      game: "ac",
      session: {
        state: standings.length ? state : 0,
        label: SESSION_LABELS[state] || null,
        timeRemainingSec: st && !byLaps ? Math.max(0, Math.round(timeLeftMs / 1000)) : 0,
        lapsInEvent: byLaps ? st.laps : 0,
        scOut: false,
        trackLocation: msg.track || "",
        trackVariation: msg.config || "",
        trackLength,
      },
      standings,
    };
  }

  return { frame, setStatus, emptyPayload, resetSession };
}

// Abre o pipe e chama onPayload a cada linha recebida do app do jogo.
function startAcClient(onPayload, options) {
  const opts = options || {};
  const pipeName = opts.pipe || process.env.AC_PIPE || DEFAULT_PIPE;
  const state = createAcState(opts);
  const sockets = new Set();
  let lastTrack = ["", "", 0];

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let pending = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      pending += chunk;
      if (pending.length > MAX_LINE_BYTES) pending = "";
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          lastTrack = [msg.track, msg.config, Number(msg.length) || 0];
          onPayload(state.frame(msg));
        } catch (err) {
          // linha cortada ou formato inesperado: ignora esta e segue
        }
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      // jogo fechado (ou saiu da sessao): limpa a tabela uma vez
      if (!sockets.size) {
        state.resetSession();
        onPayload(state.emptyPayload(lastTrack[0], lastTrack[1], lastTrack[2]));
      }
    });
  });
  server.on("error", (err) => {
    console.log(`Assetto Corsa: nao foi possivel abrir o canal com o app do jogo (${err.code || err.message}).`);
  });
  server.listen(pipeName);

  return {
    setStatus: state.setStatus,
    stop() {
      sockets.forEach((s) => s.destroy());
      server.close();
    },
  };
}

module.exports = { startAcClient, createAcState, readCarInfoFromDisk, classFromUi, DEFAULT_PIPE };
