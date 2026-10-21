// overlay/shared/sectors.js
// Parciais (S1, S2, S3) da volta em andamento de cada carro, com a cor de cada
// uma, para o driver card na classificacao:
//   roxo     melhor parcial da classe na sessao
//   verde    melhor parcial do proprio piloto
//   amarelo  pior que a melhor do piloto
//   vermelho volta invalidada
// Uma parcial so aparece depois de fechada. Ao cruzar a linha, a volta que
// terminou fica na tela por alguns segundos antes de abrir a proxima.
// Cada parcial fechada traz tambem a diferenca (delta) para a melhor parcial
// do lider da classe (o carro da classe com a melhor volta). Para o proprio
// lider, ou sem lider com volta, a diferenca e para a melhor marca dele mesmo.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LLGSectors = api;
})(typeof self !== "undefined" ? self : this, function () {
  const HOLD_MS = 6000; // tempo que a volta terminada fica na tela

  function createSectorTracker() {
    const cars = new Map(); // nome -> estado
    const empty = () => [null, null, null];

    // melhor parcial de cada classe na ultima leitura (para o roxo na hora de mostrar)
    let latestClassBest = new Map();

    function reset() {
      cars.clear();
      latestClassBest = new Map();
    }

    function state(name) {
      let st = cars.get(name);
      if (!st) {
        st = { sector: null, times: empty(), colors: empty(), deltas: empty(), pb: empty(), invalid: false, hold: null };
        cars.set(name, st);
      }
      return st;
    }

    const payloadBest = (e) => [e.bestSector1Ms, e.bestSector2Ms, e.bestSector3Ms].map((v) => (v > 0 ? v : null));
    const least = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));

    // classKeyOf(entry) -> classe do carro (as parciais roxas sao por classe)
    function update(standings, classKeyOf, now) {
      const list = (standings || []).filter((e) => e && e.name);
      // melhor parcial conhecida de cada classe: o que o jogo informa e o que foi visto aqui
      const classBest = new Map();
      list.forEach((e) => {
        const key = classKeyOf ? classKeyOf(e) : "";
        const best = classBest.get(key) || empty();
        const mine = payloadBest(e);
        const st = cars.get(e.name);
        for (let i = 0; i < 3; i++) best[i] = least(best[i], least(mine[i], st ? st.pb[i] : null));
        classBest.set(key, best);
      });

      // lider de cada classe: quem tem a melhor volta
      const classLeader = new Map();
      list.forEach((e) => {
        if (!(e.fastestLapMs > 0)) return;
        const key = classKeyOf ? classKeyOf(e) : "";
        const cur = classLeader.get(key);
        if (!cur || e.fastestLapMs < cur.fastestLapMs) classLeader.set(key, e);
      });

      list.forEach((e) => {
        const st = state(e.name);
        const sec = typeof e.currentSector === "number" && e.currentSector >= 0 && e.currentSector <= 2 ? e.currentSector : null;
        const inPit = (e.pitMode || 0) !== 0 || !!(e.pit && e.pit.outLap);
        if (sec === null || inPit) {
          // box ou volta de saida: nada a mostrar, e a proxima volta comeca do zero
          st.sector = sec;
          st.times = empty();
          st.colors = empty();
          st.deltas = empty();
          st.invalid = false;
          if (inPit) st.hold = null;
          return;
        }
        st.invalid = !!e.lapInvalidated;
        const cur = [e.sector1Ms, e.sector2Ms, e.sector3Ms];
        const key = classKeyOf ? classKeyOf(e) : "";
        st.classKey = key;
        const cBest = classBest.get(key) || empty();
        const own = payloadBest(e);
        const leader = classLeader.get(key);
        const leaderBest = leader && leader.name !== e.name ? payloadBest(leader) : empty();

        function commit(i) {
          const t = cur[i] > 0 ? cur[i] : null;
          st.times[i] = t;
          st.deltas[i] = null;
          if (t == null) {
            st.colors[i] = null;
            return;
          }
          // a marca do proprio piloto ANTES desta parcial (o jogo pode ja ter
          // incluido a parcial nova na melhor dele, entao vale a guardada aqui)
          const before = st.pb[i] != null ? st.pb[i] : own[i] != null && own[i] !== t ? own[i] : null;
          const ref = leaderBest[i] != null ? leaderBest[i] : before;
          st.deltas[i] = ref != null ? t - ref : null;
          if (st.invalid) {
            st.colors[i] = "red";
            return;
          }
          const myBest = least(st.pb[i], own[i]);
          if (cBest[i] == null || t <= cBest[i]) st.colors[i] = "purple";
          else if (myBest == null || t <= myBest) st.colors[i] = "green";
          else st.colors[i] = "yellow";
          st.pb[i] = least(st.pb[i], t);
          cBest[i] = least(cBest[i], t);
        }

        const prev = st.sector;
        if (prev === null) {
          // primeira leitura do carro (overlay recem-aberta no meio da volta):
          // mostra as parciais que ele ja fechou nesta volta
          for (let i = 0; i < sec; i++) commit(i);
        } else if (prev !== sec) {
          // fecha as parciais pelas quais o carro passou desde a ultima leitura
          let i = prev;
          while (i !== sec) {
            commit(i);
            if (i === 2) {
              // cruzou a linha: a volta terminada fica na tela por um tempo
              st.hold = { until: now + HOLD_MS, times: st.times.slice(), deltas: st.deltas.slice(), colors: st.invalid ? ["red", "red", "red"] : st.colors.slice() };
              st.times = empty();
              st.colors = empty();
              st.deltas = empty();
            }
            i = (i + 1) % 3;
          }
        }
        st.sector = sec;
      });
      latestClassBest = classBest; // ja com as parciais fechadas nesta leitura
    }

    // [{ ms, color, deltaMs }, x3]: ms nulo = parcial ainda nao fechada;
    // deltaMs nulo = sem referencia para comparar
    // A cor e decidida quando a parcial fecha, mas o roxo e conferido de novo
    // aqui: so fica roxa a parcial que AINDA e a melhor da classe. Se outro
    // carro ja fez melhor, ela vira verde (continua sendo a melhor do piloto),
    // senao varios carros ficariam com a mesma parcial em roxo.
    function shown(st, color, ms, i) {
      if (color !== "purple" || ms == null) return color;
      const best = latestClassBest.get(st.classKey);
      return best && best[i] != null && ms > best[i] ? "green" : "purple";
    }

    function view(name, now) {
      const st = cars.get(name);
      const blank = [0, 1, 2].map(() => ({ ms: null, color: null, deltaMs: null }));
      if (!st) return blank;
      const started = st.times.some((t) => t != null);
      if (st.hold && now < st.hold.until && !started) {
        return st.hold.times.map((ms, i) => ({ ms, color: shown(st, st.hold.colors[i], ms, i), deltaMs: st.hold.deltas[i] }));
      }
      return st.times.map((ms, i) => ({ ms, color: ms == null ? null : st.invalid ? "red" : shown(st, st.colors[i], ms, i), deltaMs: ms == null ? null : st.deltas[i] }));
    }

    return { update, view, reset };
  }

  return { createSectorTracker, HOLD_MS };
});
