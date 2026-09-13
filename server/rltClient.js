const BASE = "https://www.racingleaguetools.com";
const REFRESH_MS = 5 * 60 * 1000;

// Cole a API key aqui (ou use RLT_API_KEY no ambiente)
const RLT_API_KEY = process.env.RLT_API_KEY || "bdc181b61f277ee632fce5c1af6d2b46ef836def631b102545384d5e9d1ececc";

let apiKey = RLT_API_KEY && RLT_API_KEY !== "COLE_SUA_API_KEY_AQUI" ? RLT_API_KEY : "";
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
};

function setApiKey(key) {
  apiKey = String(key || "").trim();
  cache = { league: null, seasons: null, seasonDetail: null, standings: null, classes: [], drivers: [] };
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

function normalizeName(name) {
  return String(name || "")
    .replace(/\[[^\]]*\]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

function pushAlias(set, value) {
  const n = normalizeName(value);
  if (n) set.add(n);
}

function buildDrivers(standingsData, classes) {
  const list = [];
  const drivers = (standingsData && standingsData.seasonStatistics && standingsData.seasonStatistics.driverStandings) || [];
  const classByUnique = {};
  (classes || []).forEach((c) => {
    classByUnique[c.uniqueName] = c;
  });

  drivers.forEach((d) => {
    const info = d.classInfo || null;
    const di = d.driverInfo || {};
    const cls = info ? (classByUnique[info.uniqueName] || info) : null;
    const firstName = di.firstName || null;
    const lastName = di.lastName || null;
    const displayFull =
      firstName && lastName
        ? `${firstName} ${lastName}`.trim()
        : di.displayName || di.realName || d.driverName || null;

    const aliases = new Set();
    const description = di.description || d.description || null;
    if (description) {
      String(description)
        .split(/[,;|/\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => pushAlias(aliases, s));
    }
    pushAlias(aliases, d.driverName);
    pushAlias(aliases, di.uniqueName);
    pushAlias(aliases, di.displayName);
    pushAlias(aliases, di.realName);
    pushAlias(aliases, di.shortName);
    pushAlias(aliases, firstName);
    pushAlias(aliases, lastName);
    pushAlias(aliases, firstName && lastName ? `${firstName} ${lastName}` : null);
    pushAlias(aliases, firstName && lastName ? `${lastName} ${firstName}` : null);

    let color = (cls && cls.color) || (info && info.color) || null;
    if (color) {
      let hx = String(color).trim();
      if (hx.startsWith("#")) hx = hx.slice(1);
      if (/^[0-9a-fA-F]{8}$/.test(hx)) color = `#${hx.slice(2, 8)}`;
      else if (/^[0-9a-fA-F]{6}$/.test(hx)) color = `#${hx}`;
      else if (/^[0-9a-fA-F]{3}$/.test(hx)) color = `#${hx}`;
    }

    list.push({
      uniqueName: (cls && cls.uniqueName) || (info && info.uniqueName) || "—",
      name: (cls && cls.name) || (info && info.name) || "—",
      abbreviation: (cls && cls.abbreviation) || (info && info.abbreviation) || null,
      color,
      firstName,
      lastName,
      displayName: displayFull,
      description: description || null,
      aliases: Array.from(aliases),
    });
  });
  return list;
}

async function selectSeason(seasonId) {
  selectedSeasonId = Number(seasonId);
  const detail = await fetchSeasonDetail(selectedSeasonId);
  const season = detail && detail.season;
  const classes = (season && season.multiclass && season.multiclass.classes) || [];
  cache.classes = classes;

  let standings = null;
  try {
    standings = await fetchStandings(selectedSeasonId);
  } catch (_) {
    standings = null;
  }
  cache.drivers = buildDrivers(standings, classes);
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
  setApiKey,
  getApiKey,
  hasKey,
  fetchLeague,
  fetchSeasons,
  selectSeason,
  refresh,
  startRefresh,
  stopRefresh,
  onRefresh,
  getActiveSeasons,
  getOverlayPayload,
  getStatus,
};
