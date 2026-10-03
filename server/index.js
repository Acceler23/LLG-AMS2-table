// server/index.js
// Ponto de entrada: sobe o servidor HTTP (serve overlay/ e control-panel/),
// abre o WebSocket para os clientes e recebe os dados do listener.ps1
// (que le a Shared Memory do AMS2 e manda pronto em JSON).

const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");

const { createWsServer } = require("./wsServer");
const { startTcpBridge } = require("./tcpBridge");
const { connectObs } = require("./obsController");
const rlt = require("./rltClient");

const HTTP_PORT = process.env.HTTP_PORT || 8080;
const BRIDGE_PORT = process.env.BRIDGE_PORT || 5607;
const DEFAULT_ASSETS = path.join(__dirname, "..", "overlay", "assets");
let assetsPath = process.env.ASSETS_PATH
  ? path.resolve(process.env.ASSETS_PATH)
  : DEFAULT_ASSETS;
let assetsBaseUrl = process.env.ASSETS_BASE_URL || process.env.GITHUB_ASSETS_URL || "";
let assetsCacheBust = String(Date.now());

function normalizeAssetsBaseUrl(raw) {
  let u = String(raw || "").trim().replace(/\/+$/, "");
  if (!u) return "";
  const gh = u.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)(?:\/(?:tree|blob)\/([^/]+))?(?:\/(.+))?$/i);
  if (gh) {
    const user = gh[1];
    const repo = gh[2].replace(/\.git$/i, "");
    const branch = gh[3] || "main";
    const sub = (gh[4] || "").replace(/\/+$/, "");
    u = `https://raw.githubusercontent.com/${user}/${repo}/${branch}${sub ? "/" + sub : ""}`;
  }
  return u.replace(/\/+$/, "");
}

assetsBaseUrl = normalizeAssetsBaseUrl(assetsBaseUrl);

function assetsConfigPayload() {
  return {
    baseUrl: assetsBaseUrl || "",
    cacheBust: assetsCacheBust,
    path: assetsPath,
    isDefaultPath: path.resolve(assetsPath) === path.resolve(DEFAULT_ASSETS),
  };
}

function broadcastAssetsConfig() {
  wss.broadcast({ type: "assetsConfig", data: assetsConfigPayload() });
}

const app = express();
app.use(express.json());
app.use("/overlay/assets", (req, res, next) => {
  express.static(assetsPath)(req, res, next);
});
app.use("/overlay", express.static(path.join(__dirname, "..", "overlay")));
app.use("/panel", express.static(path.join(__dirname, "..", "control-panel")));

const server = http.createServer(app);

const wss = createWsServer(server);

function broadcastRlt() {
  const payload = rlt.getOverlayPayload();
  wss.broadcast({ type: "rltConfig", data: payload });
}

rlt.onRefresh(() => {
  broadcastRlt();
});

wss.onConnect((socket) => {
  const payload = rlt.getOverlayPayload();
  if (payload && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "rltConfig", data: payload }));
  }
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "assetsConfig", data: assetsConfigPayload() }));
  }
});

app.post("/command", (req, res) => {
  const name = req.body && req.body.name;
  if (!name) return res.status(400).json({ ok: false });
  if (String(name).startsWith("overlay.")) {
    wss.broadcast({ type: "overlayCommand", name, payload: req.body.payload || {} });
    return res.json({ ok: true });
  }
  res.status(404).json({ ok: false });
});

app.get("/api/assets/path", (req, res) => {
  res.json({
    ok: true,
    path: assetsPath,
    defaultPath: DEFAULT_ASSETS,
    isDefault: path.resolve(assetsPath) === path.resolve(DEFAULT_ASSETS),
    exists: fs.existsSync(assetsPath),
    hasTeams: fs.existsSync(path.join(assetsPath, "teams")),
    hasCars: fs.existsSync(path.join(assetsPath, "cars")),
    baseUrl: assetsBaseUrl || "",
    cacheBust: assetsCacheBust,
  });
});

app.post("/api/assets/path", (req, res) => {
  try {
    const raw = req.body && req.body.path;
    if (raw == null || String(raw).trim() === "") {
      assetsPath = DEFAULT_ASSETS;
    } else {
      const next = path.resolve(String(raw).trim());
      if (!fs.existsSync(next)) {
        return res.status(400).json({ ok: false, error: "Pasta não existe: " + next });
      }
      assetsPath = next;
    }
    res.json({
      ok: true,
      path: assetsPath,
      isDefault: path.resolve(assetsPath) === path.resolve(DEFAULT_ASSETS),
      exists: fs.existsSync(assetsPath),
      hasTeams: fs.existsSync(path.join(assetsPath, "teams")),
      hasCars: fs.existsSync(path.join(assetsPath, "cars")),
      baseUrl: assetsBaseUrl || "",
      cacheBust: assetsCacheBust,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/assets/base", (req, res) => {
  res.json({ ok: true, ...assetsConfigPayload() });
});

app.post("/api/assets/base", (req, res) => {
  try {
    const raw = req.body && (req.body.baseUrl != null ? req.body.baseUrl : req.body.url);
    assetsBaseUrl = normalizeAssetsBaseUrl(raw);
    assetsCacheBust = String(Date.now());
    broadcastAssetsConfig();
    res.json({ ok: true, ...assetsConfigPayload() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/rlt/status", (req, res) => {
  res.json({ ok: true, ...rlt.getStatus() });
});

app.get("/api/rlt/drivers", (req, res) => {
  const payload = rlt.getOverlayPayload();
  if (!payload) return res.json({ ok: true, drivers: [], standingsRows: [], names: [] });
  res.json({
    ok: true,
    count: (payload.drivers || []).length,
    names: (payload.drivers || []).map((d) => d.displayName),
    drivers: (payload.drivers || []).map((d) => ({
      displayName: d.displayName,
      firstName: d.firstName,
      lastName: d.lastName,
      teamName: d.teamName,
      aliases: d.aliases,
    })),
    standingsRows: (payload.standingsRows || []).map((r) => ({
      displayName: r.displayName,
      driverName: r.driverName,
      firstName: r.firstName,
      lastName: r.lastName,
      teamName: r.teamName,
      aliases: r.aliases,
    })),
  });
});

app.post("/api/rlt/key", async (req, res) => {
  try {
    const key = req.body && req.body.apiKey;
    rlt.setApiKey(key);
    if (!rlt.hasKey()) return res.json({ ok: true, hasKey: false });
    await rlt.fetchLeague();
    await rlt.fetchSeasons();
    res.json({
      ok: true,
      hasKey: true,
      status: rlt.getStatus(),
      seasons: rlt.getActiveSeasons().map((s) => ({
        seasonId: s.seasonId,
        seasonName: s.fullName || s.seasonName,
        isMulticlassDefined: s.isMulticlassDefined,
        classes: (s.multiclass && s.multiclass.classes) || [],
        completedStatus: s.completedStatus,
        totalRounds: s.totalRounds,
        completedRounds: s.completedRounds,
      })),
    });
  } catch (e) {
    console.error("[RLT] /api/rlt/key", e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.get("/api/rlt/seasons", async (req, res) => {
  try {
    if (!rlt.hasKey()) return res.status(401).json({ ok: false, error: "API key ausente" });
    if (!rlt.getActiveSeasons().length) {
      await rlt.fetchLeague();
      await rlt.fetchSeasons();
    }
    res.json({
      ok: true,
      seasons: rlt.getActiveSeasons().map((s) => ({
        seasonId: s.seasonId,
        seasonName: s.fullName || s.seasonName,
        isMulticlassDefined: s.isMulticlassDefined,
        classes: (s.multiclass && s.multiclass.classes) || [],
        completedStatus: s.completedStatus,
        totalRounds: s.totalRounds,
        completedRounds: s.completedRounds,
      })),
    });
  } catch (e) {
    console.error("[RLT] /api/rlt/seasons", e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post("/api/rlt/season", async (req, res) => {
  try {
    const seasonId = req.body && req.body.seasonId;
    if (seasonId == null || seasonId === "" || Number(seasonId) === 0) {
      const payload = rlt.clearSeason();
      broadcastRlt();
      return res.json({ ok: true, payload, status: rlt.getStatus(), mode: "game-only" });
    }
    const payload = await rlt.selectSeason(seasonId);
    broadcastRlt();
    res.json({ ok: true, payload, status: rlt.getStatus() });
  } catch (e) {
    console.error("[RLT] /api/rlt/season", e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post("/api/rlt/clear", (req, res) => {
  rlt.setApiKey("");
  wss.broadcast({ type: "rltConfig", data: null });
  res.json({ ok: true });
});

// Bridge: o listener.ps1 le a Shared Memory do AMS2 e ja manda o standings
// pronto em JSON -- aqui e' so' repassar pro WebSocket.
startTcpBridge(BRIDGE_PORT, (buffer) => {
  try {
    const data = JSON.parse(buffer.toString("utf8"));
    wss.broadcast({ type: "standings", data });
  } catch (err) {
    console.error("Erro ao interpretar dados da bridge:", err.message);
  }
});

// OBS: conexao opcional via obs-websocket, controlada por eventos de telemetria
// ou por comandos vindos do painel de controle (ver wsServer.js -> onClientMessage)
connectObs(wss);

server.listen(HTTP_PORT, async () => {
  console.log(`Tabela de tempos em      http://localhost:${HTTP_PORT}/overlay/timing-table.html`);
  console.log(`Driver card overlay em   http://localhost:${HTTP_PORT}/overlay/driver-card.html`);
  console.log(`Painel de controle em    http://localhost:${HTTP_PORT}/panel/panel.html`);
  console.log(`Aguardando o listener.ps1 (rode-o em outra janela) para receber dados do AMS2`);
  if (rlt.hasKey()) {
    try {
      await rlt.fetchLeague();
      await rlt.fetchSeasons();
      rlt.startRefresh();
    } catch (_) {}
  }
});
