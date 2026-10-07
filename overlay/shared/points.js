// overlay/shared/points.js
// Pontuacao do campeonato "ao vivo": pontos atuais (RLT) + pontos da posicao
// de cada piloto na corrida em andamento. Usado pela tabela do piloto.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LLGPoints = api;
})(typeof self !== "undefined" ? self : this, function () {
  const FALLBACK = [45, 38, 32, 27, 23, 20, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5];
  let testConfig = null;

  // No navegador le drivers-config.js; nos testes a config e injetada.
  function config() {
    if (testConfig) return testConfig;
    return {
      bySeason: typeof RACE_POINTS_BY_SEASON !== "undefined" ? RACE_POINTS_BY_SEASON : null,
      fallback: typeof RACE_POINTS_DEFAULT !== "undefined" ? RACE_POINTS_DEFAULT : null,
    };
  }

  function setConfig(cfg) {
    testConfig = cfg;
  }

  // Tabela de pontos da temporada (indice 0 = P1).
  function pointsTable(rltConfig) {
    const cfg = config();
    if (cfg.bySeason && rltConfig) {
      const t = cfg.bySeason[rltConfig.seasonName] || cfg.bySeason[String(rltConfig.seasonId)];
      if (Array.isArray(t)) return t;
    }
    if (Array.isArray(cfg.fallback)) return cfg.fallback;
    return FALLBACK;
  }

  function pointsForPosition(pos, table) {
    if (!pos || pos < 1) return 0;
    return Number(table[pos - 1]) || 0;
  }

  // Projecao do campeonato.
  //   rows:       linhas do RLT (standingsRows) do grupo que se quer ver
  //   classMode:  usa pontos/posicao de classe em vez de geral
  //   racePosOf:  (row) => posicao do piloto na corrida agora, ou null
  //               (fora da corrida, abandonou ou nao reconhecido)
  //   table:      pontos por posicao; inRace: soma os pontos da corrida?
  // Devolve as linhas ordenadas pela pontuacao projetada, com:
  //   base, add, total, rank (projetado) e delta (posicoes ganhas no campeonato)
  function project(rows, opts) {
    const o = opts || {};
    const table = o.table || FALLBACK;
    const items = (rows || []).map((row) => {
      const raw = o.classMode && row.classPointsRaw != null ? row.classPointsRaw : row.pointsRaw;
      const base = Number(raw) || 0;
      const racePos = o.inRace && o.racePosOf ? o.racePosOf(row) : null;
      const add = racePos ? pointsForPosition(racePos, table) : 0;
      return { row, base, add, total: base + add, racePos: racePos || null };
    });
    const byBase = items.slice().sort((a, b) => b.base - a.base);
    byBase.forEach((it, i) => {
      it.baseRank = i + 1;
    });
    // empate na projecao: fica na frente quem ja estava na frente
    const sorted = items.slice().sort((a, b) => b.total - a.total || a.baseRank - b.baseRank);
    sorted.forEach((it, i) => {
      it.rank = i + 1;
      it.delta = it.baseRank - it.rank;
    });
    return sorted;
  }

  // Janela de `size` itens em volta do indice `center`, sempre incluindo o
  // primeiro (lider). Devolve os indices em ordem.
  function windowAround(length, center, size) {
    if (length <= size) return Array.from({ length }, (_, i) => i);
    if (center == null || center < 0) return Array.from({ length: size }, (_, i) => i);
    const rest = size - 1; // o lider ocupa uma vaga
    let start = Math.max(1, center - Math.floor(rest / 2));
    if (start + rest > length) start = length - rest;
    start = Math.max(1, start);
    const out = [0];
    for (let i = start; i < start + rest && i < length; i++) out.push(i);
    return out;
  }

  return { setConfig, pointsTable, pointsForPosition, project, windowAround };
});
