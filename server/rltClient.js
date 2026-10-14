const BASE = "https://www.racingleaguetools.com";
const REFRESH_MS = 5 * 60 * 1000;

const { normalizeName } = require("../overlay/shared/names");
const { normalizeColor } = require("../overlay/shared/colors");
const secret = require("./secret");

// A chave vem do painel de controle (pedida na primeira vez que o aplicativo
// abre e guardada criptografada no settings.json) ou, para quem desenvolve,
// da variavel RLT_API_KEY (.env) ou do server/rlt-key.enc. Esses dois ficam
// fora do git e nao vao para o aplicativo. Nunca escreva a chave neste arquivo.
let apiKey = secret.reveal(process.env.RLT_API_KEY) || secret.readKeyFile();
let selectedSeasonId = null;
let refreshTimer = null;
let onRefreshCb = null;

let cache = {
  league: null,
  seasons: null,
  seasonDetail: null,
  standings: null,
  classes: [],
  drivers: [],
  standingsRows: [],
};

function setApiKey(key) {
  apiKey = String(key || "").trim();
  cache = {
    league: null,
    seasons: null,
    seasonDetail: null,
    standings: null,
    classes: [],
    drivers: [],
    standingsRows: [],
  };
  selectedSeasonId = null;
  stopRefresh();
}

function getApiKey() {
  return apiKey;
}

function hasKey() {
  return !!apiKey;
}

async function rltFetch(path) {
  if (!apiKey) {
    const err = new Error("API key ausente");
    err.status = 401;
    throw err;
  }
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-API-Key": apiKey, Accept: "application/json" },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error((body && (body.message || body.error)) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function unwrap(body) {
  if (!body) return null;
  if (body.data !== undefined) return body.data;
  return body;
}

async function fetchLeague() {
  const data = unwrap(await rltFetch("/api/public/v1/league?includeEvents=false"));
  cache.league = data;
  return data;
}

async function fetchSeasons() {
  const data = unwrap(await rltFetch("/api/public/v1/seasons"));
  cache.seasons = (data && data.seasons) || [];
  return cache.seasons;
}

async function fetchSeasonDetail(seasonId) {
  const data = unwrap(await rltFetch(`/api/public/v1/seasons/${seasonId}`));
  cache.seasonDetail = data;
  return data;
}

async function fetchStandings(seasonId) {
  const data = unwrap(await rltFetch(`/api/public/v1/seasons/${seasonId}/standings`));
  cache.standings = data;
  return data;
}

// Etapas da temporada (calendario), para o cabecalho da tabela: numero da
// etapa, nome da pista como esta no RLT, pais, e as baterias (corridas e
// classificacoes) com a marca de quais ja tem resultado lancado.
// O pais e as baterias so vem no detalhe de cada evento. Evento concluido nao
// muda mais e e buscado uma vez so; os demais sao buscados de novo quando a
// data esta perto (o resultado da corrida 1 pode ser lancado antes da 2).
const eventDetails = new Map(); // eventId -> { country, races, qualifications, final }
const EVENT_NEAR_MS = 3 * 24 * 60 * 60 * 1000;

function seasonEvents(season) {
  return ((season && (season.events || season.Events)) || []).map((e) => ({
    eventId: e.eventId,
    round: e.round,
    name: e.name || null,
    trackName: e.trackName || null,
    uniqueName: e.uniqueName || null,
    circuitOrigin: e.circuitOrigin || null,
    eventDate: e.eventDateTime || e.eventDate || null,
    completedStatus: e.completedStatus || null,
    country: null,
    races: [],
    qualifications: [],
  }));
}

// Baterias de um tipo ("Race" ou "Qualification") na ordem em que acontecem.
function eventHeats(detail, type) {
  return ((detail && detail.sessions) || [])
    .map((s) => (s && s.sessionInfo) || {})
    .filter((info) => info.sessionType === type)
    .sort((a, b) => String(a.sessionDate || "").localeCompare(String(b.sessionDate || "")) || (a.sessionPosition || 0) - (b.sessionPosition || 0))
    .map((info) => ({ caption: info.sessionCaption || null, completed: String(info.completedStatus || "").toLowerCase() === "completed" }));
}

function eventDetailInfo(detail, completedStatus) {
  const track = (detail && detail.event && detail.event.track) || {};
  return {
    country: track.country || "",
    races: eventHeats(detail, "Race"),
    qualifications: eventHeats(detail, "Qualification"),
    final: String(completedStatus || "").toLowerCase() === "completed",
  };
}

async function fetchEventDetails(events, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  for (const e of events) {
    if (e.eventId == null) continue;
    const have = eventDetails.get(e.eventId);
    if (have && have.final) continue;
    const when = Date.parse(e.eventDate || "");
    const near = !Number.isNaN(when) && Math.abs(when - now) <= EVENT_NEAR_MS;
    if (have && !near) continue; // longe da data: nada mudou
    try {
      const data = unwrap(await rltFetch(`/api/public/v1/events/${e.eventId}`));
      eventDetails.set(e.eventId, eventDetailInfo(data, e.completedStatus));
    } catch (_) {
      // sem o detalhe desta vez: tenta de novo na proxima atualizacao
    }
  }
  events.forEach((e) => {
    const d = eventDetails.get(e.eventId);
    if (!d) return;
    e.country = d.country || null;
    e.races = d.races;
    e.qualifications = d.qualifications;
  });
  return events;
}

// Lineup da temporada: todas as vagas, titulares e reservas, com classe e
// equipe. E a unica fonte para quem ainda nao correu (a pontuacao so lista
// quem ja participou de alguma etapa) e para os reservas.
async function fetchLineups(seasonId) {
  const data = unwrap(await rltFetch(`/api/public/v1/seasons/${seasonId}/lineups`));
  cache.lineups = data;
  return data;
}

// Vagas do lineup no mesmo formato das linhas da pontuacao.
function lineupSeatsToDrivers(lineups) {
  const seats = (lineups && (lineups.seats || lineups.Seats)) || [];
  return seats
    .filter((seat) => seat && (seat.driverName || seat.DriverName))
    .map((seat) => {
      const team = seat.team || seat.Team || null;
      return {
        driverName: seat.driverName || seat.DriverName,
        driverInfo: seat.driverInfo || seat.DriverInfo || {},
        seatType: seat.seatType || seat.SeatType || null,
        classInfo: seat.classInfo || seat.ClassInfo || null,
        teamName: team ? team.name || team.Name || null : null,
        teamInfo: team
          ? { fullName: team.fullName || team.FullName || null, primaryColor: team.primaryColor || null, secondaryColor: team.secondaryColor || null }
          : null,
      };
    });
}

// Junta o lineup com a pontuacao: quem so esta no lineup entra na lista (sem
// pontos), e quem ja esta na pontuacao sem classe ou equipe ganha as do lineup.
function mergeLineupIntoStandings(standings, lineupDrivers) {
  const out = standings || { driverStandings: [] };
  if (!lineupDrivers || !lineupDrivers.length) return out;
  const stats = out.seasonStatistics || out;
  const base = stats.driverStandings || out.driverStandings || [];
  const byName = new Map(base.map((d) => [String(d.driverName || d.DriverName || "").toLowerCase(), d]));
  lineupDrivers.forEach((d) => {
    const key = String(d.driverName || "").toLowerCase();
    if (!key) return;
    const have = byName.get(key);
    if (!have) {
      byName.set(key, d);
      base.push(d);
      return;
    }
    if (!have.classInfo && !have.ClassInfo && d.classInfo) have.classInfo = d.classInfo;
    if (!have.teamName && d.teamName) have.teamName = d.teamName;
    if (!have.teamInfo && !have.TeamInfo && d.teamInfo) have.teamInfo = d.teamInfo;
  });
  if (stats.driverStandings) stats.driverStandings = base;
  else out.driverStandings = base;
  return out;
}

function pushAlias(set, value) {
  const n = normalizeName(value);
  if (n) set.add(n);
}

function addNameParts(set, value) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((v) => addNameParts(set, v));
    return;
  }
  if (typeof value === "object") {
    const n =
      value.name ||
      value.Name ||
      value.inGameName ||
      value.InGameName ||
      value.displayName ||
      value.DisplayName ||
      null;
    if (n) addNameParts(set, n);
    return;
  }
  String(value)
    .split(/[,;|/\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((s) => {
      pushAlias(set, s);
      String(s)
        .split(/[|\/\\]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .forEach((p) => pushAlias(set, p));
    });
}

function collectInGameNames(d, di) {
  const set = new Set();
  addNameParts(set, d && (d.inGameName || d.InGameName));
  addNameParts(set, d && (d.inGameNames || d.InGameNames));
  addNameParts(set, di && (di.inGameName || di.InGameName));
  addNameParts(set, di && (di.inGameNames || di.InGameNames));
  addNameParts(set, di && (di.gameNames || di.names));
  return Array.from(set);
}

function collectDriverStandings(standingsData) {
  const out = [];
  const seen = new Set();
  function addAll(arr) {
    (arr || []).forEach((d) => {
      if (!d || typeof d !== "object") return;
      const key = String(
        d.driverName || d.DriverName || d.uniqueName || d.UniqueName || ""
      ).toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(d);
    });
  }
  if (!standingsData) return out;
  const stats = standingsData.seasonStatistics || standingsData.SeasonStatistics || standingsData;
  addAll(stats.driverStandings || stats.DriverStandings);
  addAll(standingsData.driverStandings || standingsData.DriverStandings);
  const classBlocks = stats.classes || stats.Classes || standingsData.classes || standingsData.Classes || [];
  classBlocks.forEach((block) => {
    const cs = block.classStatistics || block.ClassStatistics || block;
    const classInfo = block.classInfo || block.ClassInfo || null;
    const rows = cs.driverStandings || cs.DriverStandings || [];
    rows.forEach((d) => {
      if (classInfo && !d.classInfo && !d.ClassInfo) d.classInfo = classInfo;
    });
    addAll(rows);
  });
  return out;
}

function collectClassStandingsMap(standingsData) {
  const map = new Map();
  if (!standingsData) return map;
  const stats = standingsData.seasonStatistics || standingsData.SeasonStatistics || standingsData;
  const classBlocks = stats.classes || stats.Classes || standingsData.classes || standingsData.Classes || [];
  classBlocks.forEach((block) => {
    const cs = block.classStatistics || block.ClassStatistics || block;
    const classInfo = block.classInfo || block.ClassInfo || null;
    const rows = cs.driverStandings || cs.DriverStandings || [];
    rows.forEach((d) => {
      const key = String(d.driverName || d.DriverName || "").toLowerCase();
      if (!key) return;
      map.set(key, {
        position: d.position != null ? d.position : d.Position,
        points: d.points != null ? d.points : d.Points,
        positionChange: d.positionChange != null ? d.positionChange : d.PositionChange,
        classInfo: d.classInfo || d.ClassInfo || classInfo,
      });
    });
  });
  return map;
}

function collectLineupDrivers(seasonDetail) {
  const out = [];
  const seen = new Set();
  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object") return;
    const name =
      node.driverName ||
      node.DriverName ||
      (node.driverInfo && (node.driverInfo.displayName || node.driverInfo.DisplayName)) ||
      (node.DriverInfo && (node.DriverInfo.displayName || node.DriverInfo.DisplayName)) ||
      null;
    const di = node.driverInfo || node.DriverInfo || null;
    if (name || di) {
      const key = String(
        name ||
          (di && (di.displayName || di.DisplayName || `${di.firstName || di.FirstName || ""} ${di.lastName || di.LastName || ""}`)) ||
          ""
      )
        .trim()
        .toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push({
          driverName: name || key,
          driverInfo: di || {
            firstName: node.firstName || node.FirstName || null,
            lastName: node.lastName || node.LastName || null,
            displayName: name,
            description: node.description || node.Description || null,
          },
          teamName: node.teamName || node.TeamName || (node.team && (node.team.name || node.team.Name)) || null,
          classInfo: node.classInfo || node.ClassInfo || null,
          points: node.points != null ? node.points : 0,
          position: node.position != null ? node.position : 999,
        });
      }
    }
    Object.keys(node).forEach((k) => {
      if (/lineup|roster|drivers|entries|participants/i.test(k)) walk(node[k]);
    });
  }
  walk(seasonDetail);
  return out;
}

function buildDrivers(standingsData, classes) {
  const list = [];
  const drivers = collectDriverStandings(standingsData);
  const classByUnique = {};
  (classes || []).forEach((c) => {
    classByUnique[c.uniqueName] = c;
  });

  drivers.forEach((d) => {
    const info = d.classInfo || d.ClassInfo || null;
    const di = d.driverInfo || d.DriverInfo || {};
    const cls = info ? (classByUnique[info.uniqueName || info.UniqueName] || info) : null;
    const firstName = di.firstName || di.FirstName || null;
    const lastName = di.lastName || di.LastName || null;
    const displayFull =
      firstName && lastName
        ? `${firstName} ${lastName}`.trim()
        : di.displayName || di.DisplayName || di.realName || di.RealName || d.driverName || d.DriverName || null;

    const aliases = new Set();
    const description = di.description || di.Description || d.description || d.Description || null;
    addNameParts(aliases, description);
    collectInGameNames(d, di).forEach((n) => pushAlias(aliases, n));
    addNameParts(aliases, d.driverName || d.DriverName);
    addNameParts(aliases, d.inGameName || d.InGameName);
    addNameParts(aliases, di.uniqueName);
    addNameParts(aliases, di.displayName || di.DisplayName);
    addNameParts(aliases, di.realName || di.RealName);
    addNameParts(aliases, di.shortName || di.ShortName);
    addNameParts(aliases, firstName);
    addNameParts(aliases, lastName);
    if (firstName && lastName) {
      pushAlias(aliases, `${firstName} ${lastName}`);
      pushAlias(aliases, `${lastName} ${firstName}`);
    }
    const inGamePrimary =
      d.inGameName ||
      d.InGameName ||
      (Array.isArray(d.inGameNames) && d.inGameNames[0] && (d.inGameNames[0].name || d.inGameNames[0])) ||
      (Array.isArray(di.inGameNames) && di.inGameNames[0] && (di.inGameNames[0].name || di.inGameNames[0])) ||
      di.inGameName ||
      null;
    const displayResolved =
      (displayFull && String(displayFull).trim()) ||
      (inGamePrimary && String(inGamePrimary).trim()) ||
      d.driverName ||
      d.DriverName ||
      null;

    let color = (cls && cls.color) || (info && info.color) || null;
    color = normalizeColor(color);

    list.push({
      uniqueName: (cls && cls.uniqueName) || (info && info.uniqueName) || "—",
      name: (cls && cls.name) || (info && info.name) || "—",
      abbreviation: (cls && cls.abbreviation) || (info && info.abbreviation) || null,
      color,
      firstName,
      lastName,
      displayName: displayResolved,
      inGameName: inGamePrimary ? String(inGamePrimary) : null,
      description: description || null,
      teamName: d.teamName || di.teamName || null,
      ...teamFields(d),
      raceNumber: di.raceNumber || di.RaceNumber || d.raceNumber || null,
      aliases: Array.from(aliases),
    });
  });
  return list;
}

// Dados da equipe que o RLT manda em teamInfo: nome completo e cores.
function teamFields(d) {
  const ti = (d && (d.teamInfo || d.TeamInfo)) || {};
  return {
    teamFullName: ti.fullName || ti.FullName || null,
    teamPrimaryColor: normalizeColor(ti.primaryColor || ti.PrimaryColor || null),
    teamSecondaryColor: normalizeColor(ti.secondaryColor || ti.SecondaryColor || null),
  };
}

function parsePoints(p) {
  if (p == null) return { text: "0", raw: 0 };
  if (typeof p === "number") return { text: String(p), raw: p };
  if (typeof p === "string") {
    const n = Number(String(p).replace(",", "."));
    return { text: p, raw: Number.isFinite(n) ? n : 0 };
  }
  if (p.formatted != null && String(p.formatted).trim() !== "") {
    const n = Number(String(p.formatted).replace(",", "."));
    return { text: String(p.formatted), raw: Number.isFinite(n) ? n : 0 };
  }
  const raw = p.raw != null ? Number(p.raw) : 0;
  return {
    text: Number.isFinite(raw) ? String(raw) : "0",
    raw: Number.isFinite(raw) ? raw : 0,
  };
}

function buildStandingsRows(standingsData, classes) {
  const drivers = collectDriverStandings(standingsData);
  const classMap = collectClassStandingsMap(standingsData);
  const classByUnique = {};
  (classes || []).forEach((c) => {
    classByUnique[c.uniqueName] = c;
  });
  return drivers.map((d) => {
    const di = d.driverInfo || d.DriverInfo || {};
    const info = d.classInfo || d.ClassInfo || null;
    const key = String(d.driverName || d.DriverName || "").toLowerCase();
    const classRow = classMap.get(key) || null;
    const classInfo = (classRow && classRow.classInfo) || info;
    const cls = classInfo ? (classByUnique[classInfo.uniqueName] || classInfo) : null;
    const firstName = di.firstName || di.FirstName || null;
    const lastName = di.lastName || di.LastName || null;
    const displayName =
      firstName && lastName
        ? `${firstName} ${lastName}`.trim()
        : di.displayName || di.DisplayName || di.realName || di.RealName || d.driverName || d.DriverName || "—";
    let color = (cls && cls.color) || (classInfo && classInfo.color) || null;
    color = normalizeColor(color);
    const description = di.description || d.description || null;
    const aliases = new Set();
    addNameParts(aliases, description);
    collectInGameNames(d, di).forEach((n) => pushAlias(aliases, n));
    addNameParts(aliases, d.driverName || d.DriverName);
    addNameParts(aliases, d.inGameName || d.InGameName);
    addNameParts(aliases, displayName);
    addNameParts(aliases, firstName);
    addNameParts(aliases, lastName);
    if (firstName && lastName) {
      pushAlias(aliases, `${firstName} ${lastName}`);
      pushAlias(aliases, `${lastName} ${firstName}`);
    }
    const inGamePrimary =
      d.inGameName ||
      d.InGameName ||
      (Array.isArray(d.inGameNames) && d.inGameNames[0] && (d.inGameNames[0].name || d.inGameNames[0])) ||
      (Array.isArray(di.inGameNames) && di.inGameNames[0] && (di.inGameNames[0].name || di.inGameNames[0])) ||
      di.inGameName ||
      null;
    const displayResolved =
      (displayName && displayName !== "—" && String(displayName).trim()) ||
      (inGamePrimary && String(inGamePrimary).trim()) ||
      d.driverName ||
      d.DriverName ||
      "—";
    const ptsOverall = parsePoints(d.points);
    const ptsClass = classRow ? parsePoints(classRow.points) : ptsOverall;
    const classPos =
      (classRow && classRow.position) ||
      (classInfo && classInfo.classPosition) ||
      d.position ||
      999;
    return {
      position: d.position != null ? d.position : 999,
      classPosition: classPos,
      driverName: d.driverName,
      displayName: displayResolved,
      inGameName: inGamePrimary ? String(inGamePrimary) : null,
      firstName,
      lastName,
      points: ptsOverall.text,
      pointsRaw: ptsOverall.raw,
      classPoints: ptsClass.text,
      classPointsRaw: ptsClass.raw,
      gapToLeader: d.gapToLeader || null,
      gapToAhead: d.gapToAhead || null,
      positionChange: d.positionChange != null ? d.positionChange : null,
      classPositionChange: classRow && classRow.positionChange != null ? classRow.positionChange : null,
      teamName: d.teamName || null,
      ...teamFields(d),
      raceNumber: di.raceNumber || di.RaceNumber || d.raceNumber || null,
      classUniqueName: (cls && cls.uniqueName) || (classInfo && classInfo.uniqueName) || "—",
      className: (cls && cls.name) || (classInfo && classInfo.name) || "—",
      color,
      aliases: Array.from(aliases),
    };
  });
}

function clearSeason() {
  selectedSeasonId = null;
  cache.seasonDetail = null;
  cache.standings = null;
  cache.classes = [];
  cache.drivers = [];
  cache.standingsRows = [];
  cache.events = [];
  stopRefresh();
  if (hasKey()) startRefresh();
  return null;
}

async function selectSeason(seasonId) {
  if (seasonId == null || seasonId === "" || Number(seasonId) === 0) {
    return clearSeason();
  }
  selectedSeasonId = Number(seasonId);
  const detail = await fetchSeasonDetail(selectedSeasonId);
  const season = detail && detail.season;
  const classes = (season && season.multiclass && season.multiclass.classes) || [];
  cache.classes = classes;
  cache.events = await fetchEventDetails(seasonEvents(season));

  let standings = null;
  try {
    standings = await fetchStandings(selectedSeasonId);
  } catch (_) {
    standings = null;
  }
  // Lineup: titulares que ainda nao correram e reservas nao aparecem na
  // pontuacao, entao vem daqui (com classe e equipe).
  let lineups = null;
  try {
    lineups = await fetchLineups(selectedSeasonId);
  } catch (_) {
    lineups = null;
  }
  const lineupDrivers = lineupSeatsToDrivers(lineups).concat(collectLineupDrivers(detail));
  standings = mergeLineupIntoStandings(standings, lineupDrivers);
  cache.drivers = buildDrivers(standings, classes);
  cache.standingsRows = buildStandingsRows(standings, classes);
  startRefresh();
  return getOverlayPayload();
}

async function refresh() {
  if (!hasKey()) return null;
  try {
    await fetchLeague();
    await fetchSeasons();
    if (selectedSeasonId) {
      await selectSeason(selectedSeasonId);
    }
    if (typeof onRefreshCb === "function") onRefreshCb(getOverlayPayload());
    return getOverlayPayload();
  } catch (_) {
    return null;
  }
}

function startRefresh() {
  stopRefresh();
  if (!hasKey()) return;
  refreshTimer = setInterval(() => {
    refresh().catch(() => {});
  }, REFRESH_MS);
}

function stopRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function onRefresh(cb) {
  onRefreshCb = cb;
}

function getActiveSeasons() {
  const seasons = cache.seasons || (cache.league && cache.league.leagueInfo && cache.league.leagueInfo.seasons) || [];
  return seasons.filter((s) => !s.isArchive);
}

function getOverlayPayload() {
  if (!selectedSeasonId) return null;
  const season =
    (cache.seasonDetail && cache.seasonDetail.season) ||
    (cache.seasons || []).find((s) => s.seasonId === selectedSeasonId) ||
    null;
  return {
    seasonId: selectedSeasonId,
    seasonName: season && (season.fullName || season.seasonName),
    classes: cache.classes || [],
    drivers: cache.drivers || [],
    standingsRows: cache.standingsRows || [],
    events: cache.events || [],
  };
}

function getStatus() {
  return {
    hasKey: hasKey(),
    selectedSeasonId,
    classes: cache.classes.length,
    driversMapped: cache.drivers.length,
    leagueName: cache.league && cache.league.leagueInfo && cache.league.leagueInfo.leagueName,
  };
}





module.exports = {
  seasonEvents,
  eventDetailInfo,
  lineupSeatsToDrivers,
  mergeLineupIntoStandings,
  buildDrivers,
  buildStandingsRows,
  setApiKey,
  getApiKey,
  hasKey,
  fetchLeague,
  fetchSeasons,
  selectSeason,
  clearSeason,
  refresh,
  startRefresh,
  stopRefresh,
  onRefresh,
  getActiveSeasons,
  getOverlayPayload,
  getStatus,
};
