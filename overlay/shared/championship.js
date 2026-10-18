// overlay/shared/championship.js
// Tela de pontuacao da tabela completa (tecla 0): o campeonato separado por
// classe, com os pontos de cada etapa. Os dados vem do RLT (standingsRows do
// servidor, com rounds, discard e penaltyPoints).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LLGChampionship = api;
})(typeof self !== "undefined" ? self : this, function () {
  // Numeros das etapas da temporada: as do calendario e as que aparecem nos
  // resultados, em ordem.
  function roundNumbers(rows, events) {
    const set = new Set();
    (events || []).forEach((e) => {
      if (e && e.round != null) set.add(Number(e.round));
    });
    (rows || []).forEach((r) => (r.rounds || []).concat(r.classRounds || []).forEach((x) => x && x.round != null && set.add(Number(x.round))));
    return Array.from(set).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  }

  // rows: standingsRows; events: calendario; keep(row): mostra a linha mesmo
  // sem pontos (ex: piloto na pista agora). Devolve
  //   { rounds: [1, 2, ...], groups: [{ key, name, color, rows: [linha] }] }
  // linha = { row, position, points, cells: [{ round, points, discarded }|null], discarded, hasDiscard, penaltyPoints }
  // Com classes, a posicao e os pontos sao os da classe.
  function build(rows, events, keep) {
    const rounds = roundNumbers(rows, events);
    const show = (rows || []).filter((r) => Number(r.pointsRaw) > 0 || Number(r.classPointsRaw) > 0 || (keep && keep(r)));
    const byClass = new Map();
    show.forEach((r) => {
      const key = r.classUniqueName && r.classUniqueName !== "—" ? r.classUniqueName : "—";
      if (!byClass.has(key)) byClass.set(key, { key, name: r.className && r.className !== "—" ? r.className : "", color: r.color || null, rows: [] });
      byClass.get(key).rows.push(r);
    });
    const multi = Array.from(byClass.keys()).some((k) => k !== "—");
    const groups = Array.from(byClass.values())
      .sort((a, b) => (a.key === "—") - (b.key === "—") || String(a.name).localeCompare(String(b.name)))
      .map((g) => {
        const pos = (r) => (multi ? (r.classPosition != null ? r.classPosition : r.position) : r.position) || 999;
        const list = g.rows.slice().sort((a, b) => pos(a) - pos(b) || (Number(b.pointsRaw) || 0) - (Number(a.pointsRaw) || 0));
        return Object.assign({}, g, {
          rows: list.map((r, i) => {
            // com classes, as etapas e as punicoes da classe (o RLT pontua cada classe a parte)
            const own = multi && Array.isArray(r.classRounds) ? r.classRounds : r.rounds || [];
            const byRound = new Map(own.map((x) => [Number(x.round), x]));
            const cells = rounds.map((n) => {
              const x = byRound.get(n);
              return x ? { round: n, points: Number(x.points) || 0, discarded: !!x.discarded } : null;
            });
            return {
              row: r,
              position: pos(r) < 999 ? pos(r) : i + 1,
              points: multi && r.classPointsRaw != null ? Number(r.classPointsRaw) || 0 : Number(r.pointsRaw) || 0,
              cells,
              discarded: cells.reduce((sum, c) => sum + (c && c.discarded ? c.points : 0), 0),
              hasDiscard: cells.some((c) => c && c.discarded), // etapa descartada que valia 0 tambem conta
              penaltyPoints: Number(multi && r.classPenaltyPoints != null ? r.classPenaltyPoints : r.penaltyPoints) || 0,
            };
          }),
        });
      });
    return { rounds, groups, multiClass: multi };
  }

  return { build, roundNumbers };
});
