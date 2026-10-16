// Estatisticas das pistas de um multiseason do RLT, para a overlay de
// estatisticas da pista (overlay/track-stats.html).
//
// Uma chamada so (/multiseasons/{key}/statistics com as pistas) traz todas as
// pistas do multiseason com os recordes e o historico de corridas e
// classificacoes. O servidor guarda so o que a overlay usa e manda tudo de uma
// vez; a overlay escolhe a pista atual (pelo jogo ou pela etapa do RLT).

// Nome e sobrenome do piloto, como cadastrados no RLT ("Jeferson de Oliveira
// Ferreira" -> "Jeferson Oliveira"). O historico so traz o nome completo; o
// nome/sobrenome vem da lista de pilotos do mesmo multiseason. Sem cadastro,
// fica a primeira e a ultima palavra do nome.
function shortNamer(drivers) {
  const map = new Map();
  (drivers || []).forEach((d) => {
    const info = (d && d.driverInfo) || {};
    const short = [info.firstName, info.lastName].filter(Boolean).join(" ").trim() || String(info.displayName || "").trim();
    if (d && d.driverName && short) map.set(d.driverName, short);
  });
  return (name) => {
    const full = String(name || "").trim();
    if (!full) return "";
    if (map.has(full)) return map.get(full);
    const words = full.split(/\s+/);
    return words.length > 2 ? `${words[0]} ${words[words.length - 1]}` : full;
  };
}

const keepName = (name) => String(name || "");

function record(r, nameOf) {
  if (!r || !r.time) return null;
  return {
    time: r.time,
    timeMs: r.timeMs != null ? r.timeMs : null,
    driverName: nameOf(r.driverName),
    teamName: r.teamName || null,
    seasonName: r.seasonName || null,
  };
}

function session(s, championships, nameOf) {
  return {
    date: s.date || null,
    seasonName: s.seasonName || null,
    // nome curto do campeonato ("Porsche Cup 4"); sem ele, o da temporada
    championship: (championships && championships.get(s.seasonName)) || s.seasonName || null,
    round: s.roundNumber != null ? s.roundNumber : null,
    caption: s.sessionCaption || null,
    winner: nameOf(s.winnerDriverName),
    winnerTeam: s.winnerTeamName || null,
    fastestLapTime: s.fastestLapTime || null,
  };
}

// Uma pista do multiseason, so com o que a overlay mostra.
//   championships: Map nome da temporada -> nome do campeonato (opcional)
//   nameOf:        nome completo -> nome e sobrenome (opcional)
function compactTrack(t, championships, nameOf) {
  const names = nameOf || keepName;
  const general = (t && t.generalStats) || {};
  const race = (t && t.raceStats) || {};
  const qual = (t && t.qualificationStats) || {};
  return {
    trackId: t.trackId,
    name: t.circuitName || t.trackName || t.circuitOrigin || t.uniqueName || "",
    trackName: t.trackName || null,
    circuitName: t.circuitName || null,
    circuitOrigin: t.circuitOrigin || null,
    uniqueName: t.uniqueName || null,
    country: t.country || null,
    totalEvents: general.totalEvents || 0,
    records: {
      absolute: record(general.absoluteTrackRecord, names),
      race: record(race.fastestRaceLap, names),
      quali: record(qual.fastestQualLap, names),
      maxSpeed: Number(race.maxSpeed) > 0 ? Number(race.maxSpeed) : null, // km/h, sem o nome do piloto
    },
    races: (race.races || []).map((s) => session(s, championships, names)).filter((s) => s.winner),
    quals: (qual.qualifications || []).map((s) => session(s, championships, names)).filter((s) => s.winner),
  };
}

function compactTracks(stats) {
  const championships = new Map();
  ((stats && stats.seasons) || []).forEach((s) => {
    if (s && s.name && s.championshipName) championships.set(s.name, s.championshipName);
  });
  const nameOf = shortNamer(stats && stats.drivers);
  return ((stats && stats.trackStats) || []).filter((t) => t && t.trackId != null).map((t) => compactTrack(t, championships, nameOf));
}

function compactMultiseasons(list) {
  return ((list && list.multiSeasons) || []).map((m) => ({
    key: m.key || "", // "" = All Seasons (o multiseason padrao, sem chave)
    name: m.name || m.key || "",
    isDefault: !!m.isDefault,
  }));
}

module.exports = { compactTrack, compactTracks, compactMultiseasons, shortNamer };
