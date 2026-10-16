// overlay/shared/trackstats.js
// Listas da overlay de estatisticas da pista (track-stats.html), a partir de
// uma pista do multiseason do RLT (server/trackStats.js):
//   winners: ultimos vencedores de corrida (nome, temporada)
//   poles:   ultimas poles (nome, tempo da pole)
//   records: recordes da pista (classificacao e corrida: nome, tempo)
// Sempre no maximo 5 linhas: { tag, name, value }.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LLGTrackStats = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MAX_ROWS = 5;

  const TITLES = {
    winners: "Últimos vencedores",
    poles: "Últimas poles",
    records: "Recordes da pista",
  };

  // "2026-10-03" -> "03/10/26"
  function shortDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "";
  }

  // numero da bateria no fim do nome da sessao ("Race 2", "Qual 1"); 0 sem numero
  function heatOf(caption) {
    const m = /(\d+)\s*$/.exec(String(caption || ""));
    return m ? Number(m[1]) : 0;
  }

  // mais recente primeiro; no mesmo dia, a ultima bateria primeiro
  function newestFirst(list) {
    return (list || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || heatOf(b.caption) - heatOf(a.caption));
  }

  function rows(track, stat) {
    if (!track) return [];
    if (stat === "records") {
      const r = track.records || {};
      const out = [];
      if (r.quali) out.push({ tag: "Quali", name: r.quali.driverName, value: r.quali.time });
      if (r.race) out.push({ tag: "Corrida", name: r.race.driverName, value: r.race.time });
      // o absoluto quase sempre e um dos dois; so aparece se for outro
      const a = r.absolute;
      if (a && !out.some((x) => x.value === a.time && x.name === a.driverName)) out.unshift({ tag: "Absoluto", name: a.driverName, value: a.time });
      // o RLT da a velocidade maxima da pista, mas nao quem fez
      if (r.maxSpeed) out.push({ tag: null, name: "Velocidade máxima", value: `${Math.round(r.maxSpeed)} km/h` });
      return out.slice(0, MAX_ROWS);
    }
    if (stat === "poles") {
      return newestFirst(track.quals)
        .slice(0, MAX_ROWS)
        .map((s) => ({ tag: null, name: s.winner, value: s.fastestLapTime || shortDate(s.date) }));
    }
    return newestFirst(track.races)
      .slice(0, MAX_ROWS)
      .map((s) => ({ tag: null, name: s.winner, value: s.seasonName || shortDate(s.date), small: true }));
  }

  function title(stat) {
    return TITLES[stat] || TITLES.winners;
  }

  return { rows, title, shortDate, MAX_ROWS };
});
