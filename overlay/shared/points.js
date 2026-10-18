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

  // Pontos do piloto se a corrida acabasse agora, respeitando o descarte.
  //   row:          linha do RLT (standingsRows), com rounds e discard quando a
  //                 temporada tem descarte
  //   add:          pontos da posicao atual na corrida em andamento
  //   currentRound: numero da etapa em andamento (ou null)
  //   classMode:    usa os pontos de classe como base
  // Sem descarte, e so a soma. Com descarte, refaz a conta: cada etapa (ou
  // corrida) vale o que valeu, a etapa atual ganha os pontos da corrida, e os
  // piores resultados saem. Assim, quem ja tinha uma etapa ruim descartada nao
  // soma de novo pontos que vao acabar descartados. A diferenca entre o total
  // oficial e a conta refeita sem a corrida (punicoes, ajustes) e mantida.
  function projectedTotal(row, add, currentRound, classMode) {
    const raw = classMode && row.classPointsRaw != null ? row.classPointsRaw : row.pointsRaw;
    const base = Number(raw) || 0;
    const extra = Number(add) || 0;
    const rule = row && row.discard;
    // com classes, as etapas da classe (o RLT pontua cada classe a parte)
    const rounds = row && classMode && Array.isArray(row.classRounds) ? row.classRounds : row && Array.isArray(row.rounds) ? row.rounds : null;
    if (!rule || !(rule.count > 0) || !rounds) return base + extra;

    const keep = (values) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted.slice(Math.min(rule.count, Math.max(0, sorted.length - 1))).reduce((s, v) => s + v, 0);
    };

    let before;
    let after;
    if (String(rule.type).toLowerCase() === "races") {
      // descarte por corrida: cada corrida e um resultado
      const races = [];
      rounds.forEach((r) => (r.races && r.races.length ? r.races : [r.points]).forEach((p) => races.push(Number(p) || 0)));
      before = keep(races);
      after = currentRound != null || extra ? keep(races.concat([extra])) : before;
    } else {
      // descarte por etapa: etapas que o piloto nao correu contam como 0
      const byRound = new Map();
      rounds.forEach((r) => byRound.set(Number(r.round), Number(r.points) || 0));
      const cur = Number(currentRound);
      const last = Math.max(0, ...byRound.keys(), Number.isFinite(cur) ? cur : 0);
      const list = (withRace) => {
        const out = [];
        for (let n = 1; n <= last; n++) {
          // a etapa atual so entra antes da corrida se ja tem pontos lancados
          if (!withRace && n === cur && !byRound.has(n)) continue;
          out.push((byRound.get(n) || 0) + (withRace && n === cur ? extra : 0));
        }
        return out;
      };
      before = keep(list(false));
      after = Number.isFinite(cur) ? keep(list(true)) : before + extra;
    }
    return after + (base - before);
  }

  // Etapa em andamento: a que bate com a pista (matched, de LLGDisplay.matchEvent)
  // ou, sem ela, a proxima etapa ainda nao concluida.
  function currentRound(events, matched, nowMs) {
    if (matched && matched.round != null) return matched.round;
    const now = nowMs != null ? nowMs : Date.now();
    const open = (events || []).filter((e) => String(e.completedStatus || "").toLowerCase() !== "completed" && e.round != null);
    if (!open.length) return null;
    const dist = (e) => {
      const t = Date.parse(e.eventDate || "");
      return Number.isNaN(t) ? Infinity : Math.abs(t - now);
    };
    return open.slice().sort((a, b) => dist(a) - dist(b) || a.round - b.round)[0].round;
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
      const total = o.inRace ? projectedTotal(row, add, o.currentRound, o.classMode) : base;
      return { row, base, add: total - base, total, racePos: racePos || null };
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

  return { setConfig, pointsTable, pointsForPosition, projectedTotal, currentRound, project, windowAround };
});
