// overlay/shared/battles.js
// Pagina de disputas da tabela (tecla 9, so em corrida): quais carros estao
// brigando por posicao e qual trecho da parte rotativa da tabela mostrar.
//
// Disputa: dois carros seguidos na ordem da corrida com menos de GAP_S de
// intervalo. Para nao destacar uma aproximacao passageira nem piscar quando o
// intervalo oscila, ha um filtro de tempo: o par so vira disputa depois de
// ENTER_MS seguidos abaixo do limite, e so deixa de ser depois de LEAVE_MS
// seguidos acima dele (ou sem estarem mais um atras do outro).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LLGBattles = api;
})(typeof self !== "undefined" ? self : this, function () {
  const GAP_S = 0.3;
  const ENTER_MS = 10000;
  const LEAVE_MS = 5000;

  function createBattleDetector(options) {
    const opts = options || {};
    const limit = opts.gap != null ? opts.gap : GAP_S;
    const enterMs = opts.enterMs != null ? opts.enterMs : ENTER_MS;
    const leaveMs = opts.leaveMs != null ? opts.leaveMs : LEAVE_MS;
    // par -> { a, b, inSince, outSince, active }. A chave nao depende de quem
    // esta na frente: uma ultrapassagem no meio da briga nao zera a contagem.
    let pairs = new Map();

    function reset() {
      pairs = new Map();
    }

    const pairKey = (x, y) => (x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`);

    // ordered: carros na ordem da corrida, so os que podem disputar (na pista,
    //   sem ter terminado ou abandonado). Um item nulo quebra a sequencia.
    // gapOf(tras, frente): intervalo em segundos, ou null se nao der para medir
    //   (sem historico, ou uma volta de diferenca).
    // now: instante atual em ms.
    // Devolve os nomes de quem esta em alguma disputa.
    function update(ordered, gapOf, now) {
      const close = new Set(); // pares abaixo do limite agora
      for (let i = 1; i < (ordered || []).length; i++) {
        const ahead = ordered[i - 1];
        const behind = ordered[i];
        if (!ahead || !behind) continue;
        const gap = gapOf(behind, ahead);
        if (typeof gap !== "number" || !(gap >= 0) || gap >= limit) continue;
        const key = pairKey(behind.name, ahead.name);
        close.add(key);
        if (!pairs.has(key)) pairs.set(key, { a: behind.name, b: ahead.name, inSince: now, outSince: null, active: false });
      }

      const names = new Set();
      pairs.forEach((st, key) => {
        if (close.has(key)) {
          st.outSince = null;
          if (st.inSince === null) st.inSince = now;
          if (!st.active && now - st.inSince >= enterMs) st.active = true;
        } else {
          st.inSince = null;
          if (!st.active) {
            pairs.delete(key); // nem chegou a virar disputa
            return;
          }
          if (st.outSince === null) st.outSince = now;
          if (now - st.outSince >= leaveMs) {
            pairs.delete(key);
            return;
          }
        }
        if (st.active) {
          names.add(st.a);
          names.add(st.b);
        }
      });
      return names;
    }

    // Nomes de quem esta em disputa COM o piloto informado (ele incluso), a
    // partir da ultima leitura. Vazio se ele nao esta em nenhuma.
    function namesWith(name) {
      const names = new Set();
      pairs.forEach((st) => {
        if (!st.active || (st.a !== name && st.b !== name)) return;
        names.add(st.a);
        names.add(st.b);
      });
      return names;
    }

    return { update, reset, namesWith };
  }

  // Parte rotativa da tabela travada nas disputas.
  //   flags: para cada linha da parte rotativa, true se o carro esta em disputa
  //   slots: quantas linhas cabem
  //   tick:  contador do rodizio (alterna entre as disputas quando ha mais de
  //          uma e elas nao cabem juntas)
  // Devolve o indice da primeira linha a mostrar, ou null se nao ha disputa
  // nessa parte (ai o rodizio normal continua valendo).
  function battleWindowStart(flags, slots, tick) {
    const n = (flags || []).length;
    if (!n || slots <= 0) return null;
    // grupos de linhas seguidas em disputa
    const groups = [];
    for (let i = 0; i < n; i++) {
      if (!flags[i]) continue;
      if (groups.length && groups[groups.length - 1].end === i - 1) groups[groups.length - 1].end = i;
      else groups.push({ start: i, end: i });
    }
    if (!groups.length) return null;
    if (n <= slots) return 0;
    // janelas diferentes necessarias para mostrar todos os grupos
    const starts = [];
    groups.forEach((g) => {
      const last = starts.length ? starts[starts.length - 1] : null;
      if (last !== null && g.end < last + slots) return; // ja cabe na janela anterior
      starts.push(Math.max(0, Math.min(g.start, n - slots)));
    });
    const t = ((Number(tick) || 0) % starts.length + starts.length) % starts.length;
    return starts[t];
  }

  return { createBattleDetector, battleWindowStart, GAP_S, ENTER_MS, LEAVE_MS };
});
