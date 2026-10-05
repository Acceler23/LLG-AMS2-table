// server/raceState.js
// Estado da sessao que precisa sobreviver a um recarregamento da overlay:
// posicao de largada, paradas/stint, tempo de box e instante da bandeirada
// de cada piloto. Antes isso vivia na pagina do OBS e se perdia no reload.
// apply() recebe o payload do listener e devolve o mesmo payload enriquecido.

const PIT_TRACKING_DELAY_MS = 10000; // ignora o "box" do grid nos 10 s iniciais

function isInPit(entry) {
  // 1=entrando, 2=no pitlane, 4=garagem
  return entry.pitMode === 1 || entry.pitMode === 2 || entry.pitMode === 4;
}

function isExitingPit(entry) {
  // 3=saindo do pit, 5=saindo da garagem
  return entry.pitMode === 3 || entry.pitMode === 5;
}

// Todo o estado (aqui e nas overlays) e guardado por nome do piloto. Quando
// dois carros tem exatamente o mesmo nome, um atropela o estado do outro: o
// box de um deixava o outro preso em "OUT", por exemplo. Para evitar isso, do
// segundo carro em diante o nome ganha caracteres invisiveis (U+200B) no fim.
// Na tela o nome continua igual, e o casamento com o RLT ignora esses
// caracteres. A ordem vem do `slot` (indice na Shared Memory), que nao muda
// quando os carros trocam de posicao.
const INVISIBLE = "\u200B";

function uniquifyNames(standings) {
  const byName = new Map();
  (standings || []).forEach((e, i) => {
    if (!e || typeof e.name !== "string") return;
    if (!byName.has(e.name)) byName.set(e.name, []);
    byName.get(e.name).push({ e, order: typeof e.slot === "number" ? e.slot : i });
  });
  byName.forEach((list) => {
    if (list.length < 2) return;
    list
      .sort((a, b) => a.order - b.order)
      .forEach((item, n) => {
        if (n > 0) item.e.name = item.e.name + INVISIBLE.repeat(n);
      });
  });
  return standings;
}

// Chave do estado de cada carro. Quando o jogo informa o numero do carro (ACC,
// LMU), o estado pertence ao CARRO: numa troca de piloto o nome muda, mas a
// posicao de largada, as paradas e o stint continuam os mesmos. Sem numero
// (AMS2), vale o nome do piloto, como sempre foi.
function stateKey(entry) {
  if (entry.carNumber != null && entry.carNumber !== "" && entry.slot != null) return `car:${entry.slot}#${entry.carNumber}`;
  return entry.name;
}

function createRaceState(clock) {
  const now = clock || Date.now;

  let sessionKey = null;
  let sessionStartedAt = 0;
  let isRace = false;
  let startPositions = new Map(); // nome -> posicao geral na largada
  let baselineLocked = false;
  const pit = new Map(); // nome -> { stops, wasInPit, stintStartLap, stintLaps, timer }
  const finished = new Map(); // nome -> instante (ms) em que recebeu a bandeirada

  function reset() {
    startPositions = new Map();
    baselineLocked = false;
    pit.clear();
    finished.clear();
    sessionStartedAt = now();
  }

  // Posicao do carro dentro da volta, em metros (null se nao der pra calcular).
  function lapDistance(entry, trackLength) {
    if (!(trackLength > 0) || typeof entry.totalDistance !== "number") return null;
    return entry.totalDistance - (entry.lapsCompleted || 0) * trackLength;
  }

  function updatePitTimer(st, entry, t, trackLength) {
    const lap = entry.currentLap != null ? entry.currentLap : entry.lapsCompleted || 0;
    const lapDist = lapDistance(entry, trackLength);
    const prevLapDist = st.lapDist;
    st.lapDist = lapDist;
    if (isInPit(entry) || isExitingPit(entry)) {
      if (!st.timer || st.timer.phase === "done") {
        st.timer = { enteredAt: t, phase: "in", finalMs: null, exitLap: null };
      }
      st.timer.phase = isExitingPit(entry) ? "out" : "in";
      return;
    }
    if (!st.timer) return;
    if (st.timer.phase === "in" || st.timer.phase === "out") {
      st.timer.finalMs = t - st.timer.enteredAt;
      st.timer.phase = "done";
      st.timer.exitLap = lap;
      return;
    }
    // "done": o OUT vale ate o carro cruzar a linha de chegada e abrir uma
    // volta. Em treino/classificacao o jogo nao conta a volta de saida do box:
    // o carro cruza a linha e segue na mesma "volta 1", que ja e a volta
    // rapida. Por isso nao basta esperar o numero da volta subir; a passagem
    // pela linha e detectada quando a distancia na volta volta para perto de 0.
    const crossedLine =
      lapDist != null && prevLapDist != null && prevLapDist - lapDist > trackLength / 2;
    if (lap > st.timer.exitLap || crossedLine) st.timer = null;
  }

  function updatePitStats(st, entry, tracking) {
    const laps = entry.lapsCompleted || 0;
    const inPit = isInPit(entry);
    if (!tracking) {
      st.wasInPit = inPit;
      st.stintStartLap = laps;
      st.stintLaps = 0;
      return;
    }
    if (inPit && !st.wasInPit) {
      st.stops += 1;
      st.wasInPit = true;
    } else if (!inPit && st.wasInPit) {
      st.wasInPit = false;
      st.stintStartLap = laps;
    }
    st.stintLaps = Math.max(0, laps - st.stintStartLap);
  }

  function apply(payload) {
    if (!payload || Array.isArray(payload) || !Array.isArray(payload.standings)) return payload;
    const t = now();
    const session = payload.session || {};
    const standings = uniquifyNames(payload.standings);

    const key = `${session.state}|${session.trackLocation || ""}|${session.trackVariation || ""}`;
    if (key !== sessionKey) {
      sessionKey = key;
      isRace = Number(session.state) === 5;
      reset();
    }

    if (!baselineLocked) {
      startPositions = new Map(standings.map((e) => [stateKey(e), e.position]));
      // trava quando o pelotao se mexe; ate la o grid ainda pode mudar
      if (standings.some((e) => typeof e.speedMs === "number" && e.speedMs > 3)) baselineLocked = true;
    }

    const tracking = isRace && t - sessionStartedAt >= PIT_TRACKING_DELAY_MS;

    standings.forEach((entry) => {
      if (!entry || !entry.name) return;
      const name = stateKey(entry);
      entry.startPosition = startPositions.has(name) ? startPositions.get(name) : null;

      let st = pit.get(name);
      if (!st) {
        st = { stops: 0, wasInPit: false, stintStartLap: entry.lapsCompleted || 0, stintLaps: 0, timer: null };
        pit.set(name, st);
      }
      updatePitTimer(st, entry, t, Number(session.trackLength) || 0);
      updatePitStats(st, entry, tracking);

      const timer = st.timer;
      const inPitNow = isInPit(entry) || isExitingPit(entry);
      entry.pit = {
        phase: timer ? timer.phase : null,
        elapsedMs: timer ? (timer.phase === "done" ? timer.finalMs : t - timer.enteredAt) : null,
        // o LMU informa as paradas de cada carro (entry.pitStops); o AMS2 nao, entao contamos
        stops: typeof entry.pitStops === "number" ? entry.pitStops : st.stops,
        stintLaps: st.stintLaps,
        outLap:
          inPitNow ||
          (!!timer && timer.phase === "done") ||
          (tracking && st.stintLaps === 0 && st.stops > 0 && !st.wasInPit),
      };

      if (isRace && entry.raceState === 3 && !finished.has(name)) finished.set(name, t);
      entry.finishedAtMs = finished.has(name) ? finished.get(name) : null;
    });

    payload.ts = t;
    return payload;
  }

  return { apply, reset };
}

module.exports = { createRaceState, uniquifyNames };
