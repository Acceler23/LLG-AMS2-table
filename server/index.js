// server/index.js
// Ponto de entrada: sobe o servidor HTTP (serve overlay/ e control-panel/),
// abre o WebSocket para os clientes e recebe os dados do listener.ps1
// (que le a Shared Memory do AMS2 e manda pronto em JSON).

const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");

// .env precisa ser lido antes dos modulos que usam process.env (rltClient, obsController)
require("./env").loadEnv();

const { createWsServer } = require("./wsServer");
const { startTcpBridge } = require("./tcpBridge");
const { connectObs } = require("./obsController");
const { createRaceState } = require("./raceState");
const rlt = require("./rltClient");
const settings = require("./settings");
const lmuFocus = require("./lmuFocus");
const { startAccClient } = require("./accClient");
const { startAcClient } = require("./acClient");
const { installAcApp, findSteamLibraries } = require("./acInstaller");
const carsets = require("./carsets");
const secret = require("./secret");

// Chave do RLT: a do .env tem prioridade; senao, a ultima salva pelo painel.
// (ler sempre: uma chave antiga, salva em texto puro, e regravada criptografada)
const savedRltKey = settings.getSecret("rltApiKey");
if (!rlt.hasKey() && savedRltKey) rlt.setApiKey(savedRltKey);

const HTTP_PORT = process.env.HTTP_PORT || 8080;
const BRIDGE_PORT = process.env.BRIDGE_PORT || 5607;

// Por padrao so este computador acessa o servidor. O painel troca pasta de
// assets e a chave do RLT, entao nao deve ficar aberto para a rede inteira.
// Para usar o painel/overlay de outro aparelho da rede, defina ALLOW_LAN=1.
const ALLOW_LAN = /^(1|true|yes|sim)$/i.test(process.env.ALLOW_LAN || "");

function isLocalRequest(req) {
  if (ALLOW_LAN) return true;
  const addr = (req.socket && req.socket.remoteAddress) || "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}
const DEFAULT_ASSETS = path.join(__dirname, "..", "overlay", "assets");
let assetsPath = process.env.ASSETS_PATH
  ? path.resolve(process.env.ASSETS_PATH)
  : DEFAULT_ASSETS;
// Fonte online das imagens (logos de equipe/carro, icones). As overlays
// tentam primeiro aqui e usam a pasta local overlay/assets como reserva.
// ASSETS_BASE_URL no .env troca o repositorio; vazio (ASSETS_BASE_URL=)
// desliga a fonte online e usa so a pasta local.
const DEFAULT_ASSETS_BASE_URL = "https://github.com/Acceler23/liga_lets_go_imageAssets";
let assetsBaseUrl =
  process.env.ASSETS_BASE_URL !== undefined
    ? process.env.ASSETS_BASE_URL
    : process.env.GITHUB_ASSETS_URL || DEFAULT_ASSETS_BASE_URL;
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
app.use((req, res, next) => {
  if (isLocalRequest(req)) return next();
  res.status(403).send("Acesso permitido apenas neste computador (defina ALLOW_LAN=1 para liberar a rede local).");
});
app.use(express.json());
app.use("/overlay/assets", (req, res, next) => {
  express.static(assetsPath)(req, res, next);
});
app.use("/overlay", express.static(path.join(__dirname, "..", "overlay")));
app.use("/panel", express.static(path.join(__dirname, "..", "control-panel")));

const server = http.createServer(app);

const wss = createWsServer(server, { verifyClient: (info) => isLocalRequest(info.req) });

const raceState = createRaceState();

// Zera largada/paradas/bandeiradas guardadas no servidor e avisa as overlays.
function resetRace() {
  raceState.reset();
  wss.broadcast({ type: "overlayCommand", name: "overlay.resetRace", payload: {} });
}
wss.onCommand("race.reset", resetRace);

// Alternancia automatica das colunas: a cada intervalo o servidor manda o
// mesmo comando da tecla "." (proxima coluna), entao a coluna da direita da
// tabela vai rodando sozinha (Intervalo, Gap lider, Ultima volta...). Na tela
// de pontuacao (tecla 0) roda as colunas dela.
const ALTERNATE_MIN_S = 5;
const ALTERNATE_MAX_S = 300;
const alternate = {
  enabled: !!settings.get("alternateEnabled"),
  seconds: Math.max(ALTERNATE_MIN_S, Math.min(ALTERNATE_MAX_S, Number(settings.get("alternateSeconds")) || 20)),
};
let alternateTimer = null;

function restartAlternate() {
  clearInterval(alternateTimer);
  alternateTimer = null;
  if (!alternate.enabled) return;
  alternateTimer = setInterval(() => {
    wss.broadcast({ type: "overlayCommand", name: "overlay.nextColumn", payload: {} });
  }, alternate.seconds * 1000);
}

// Assetto Corsa Competizione: tempo maximo de stint, em minutos (0 = a liga
// nao usa). O jogo nao informa o limite nem o tempo de stint dos carros, entao
// o limite e digitado no painel (aba ACC) e o tempo e contado pelo servidor
// (server/raceState.js). O limite vai junto com os dados do ACC para a tabela.
const STINT_MAX_MIN = 600;
let accStintLimitMin = Math.max(0, Math.min(STINT_MAX_MIN, Math.floor(Number(settings.get("accStintLimitMin")) || 0)));

app.get("/api/acc/stint", (req, res) => {
  res.json({ ok: true, minutes: accStintLimitMin });
});

app.post("/api/acc/stint", (req, res) => {
  const minutes = Math.floor(Number(req.body && req.body.minutes));
  accStintLimitMin = Number.isFinite(minutes) ? Math.max(0, Math.min(STINT_MAX_MIN, minutes)) : 0;
  settings.set("accStintLimitMin", accStintLimitMin || null);
  res.json({ ok: true, minutes: accStintLimitMin });
});

app.get("/api/overlay/alternate", (req, res) => {
  res.json({ ok: true, enabled: alternate.enabled, seconds: alternate.seconds });
});

function broadcastRlt() {
  const payload = rlt.getOverlayPayload();
  wss.broadcast({ type: "rltConfig", data: payload });
}

rlt.onRefresh(() => {
  broadcastRlt();
});

// "Versao" dos arquivos da overlay: a data de modificacao mais recente entre
// eles. As paginas comparam com a que receberam ao abrir e se recarregam
// quando muda, entao o OBS nunca fica rodando uma versao antiga.
const OVERLAY_DIR = path.join(__dirname, "..", "overlay");
function overlayBuildId() {
  let newest = 0;
  const scan = (dir) => {
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    names.forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "shared") scan(full); // assets (imagens) nao contam
      } else if (/\.(js|css|html)$/i.test(entry.name)) {
        try {
          newest = Math.max(newest, fs.statSync(full).mtimeMs);
        } catch (_) {}
      }
    });
  };
  scan(OVERLAY_DIR);
  return String(Math.round(newest));
}
setInterval(() => wss.broadcast({ type: "hello", buildId: overlayBuildId() }), 5000);

wss.onConnect((socket) => {
  if (socket.readyState === 1) socket.send(JSON.stringify({ type: "hello", buildId: overlayBuildId() }));
  const payload = rlt.getOverlayPayload();
  if (payload && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "rltConfig", data: payload }));
  }
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "assetsConfig", data: assetsConfigPayload() }));
  }
});

app.post("/api/overlay/alternate", (req, res) => {
  const body = req.body || {};
  if (typeof body.enabled === "boolean") alternate.enabled = body.enabled;
  const seconds = Number(body.seconds);
  if (Number.isFinite(seconds)) alternate.seconds = Math.max(ALTERNATE_MIN_S, Math.min(ALTERNATE_MAX_S, Math.round(seconds)));
  settings.set("alternateEnabled", alternate.enabled ? true : null);
  settings.set("alternateSeconds", alternate.seconds);
  restartAlternate();
  res.json({ ok: true, enabled: alternate.enabled, seconds: alternate.seconds });
});

// Assetto Corsa (o primeiro): instala o app Python da overlay na pasta do jogo.
// So acontece quando alguem clica no botao do painel.
app.post("/api/ac/install", async (req, res) => {
  const r = await installAcApp();
  if (!r.installed) {
    const error =
      r.reason === "sem-jogo"
        ? "Assetto Corsa nao encontrado nas bibliotecas da Steam. Veja a instalacao manual no README."
        : "Nao foi possivel instalar o app. Veja a instalacao manual no README.";
    return res.status(r.reason === "sem-jogo" ? 404 : 500).json({ ok: false, error });
  }
  res.json({ ok: true, gameDir: r.gameDir, copied: r.copied, enabled: r.enabled, active: r.active });
});

// ---- Automobilista 2: carsets (pinturas) ----
// A lista vem do repositorio de imagens (AMS2_CarsetList.json: temporada e
// link do arquivo). A instalacao so acontece quando alguem clica no botao do
// painel, e so mexe nas pastas dos carros do carset, dentro da pasta de
// pinturas do jogo na Steam (server/carsets.js).
async function findAms2Dir() {
  for (const lib of await findSteamLibraries()) {
    const dir = path.join(lib, "steamapps", "common", "Automobilista 2");
    if (fs.existsSync(carsets.overridesDir(dir))) return dir;
  }
  return null;
}

async function fetchCarsetList() {
  if (!assetsBaseUrl) throw new Error("Defina o repositorio de imagens no painel (aba Transmissao > Logos).");
  const res = await fetch(`${assetsBaseUrl}/${carsets.LIST_FILE}?v=${Date.now()}`);
  if (!res.ok) throw new Error(`Nao foi possivel ler a lista de carsets (HTTP ${res.status}).`);
  return carsets.parseList(await res.json());
}

app.get("/api/carsets", async (req, res) => {
  try {
    const [list, gameDir, gameRunning] = await Promise.all([fetchCarsetList(), findAms2Dir(), carsets.isGameRunning()]);
    res.json({
      ok: true,
      seasons: list.map((item) => item.season), // os links ficam no servidor
      gameDir,
      gameRunning,
      status: carsets.status(),
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get("/api/carsets/status", (req, res) => {
  res.json({ ok: true, status: carsets.status() });
});

app.post("/api/carsets/install", async (req, res) => {
  try {
    const season = String((req.body && req.body.season) || "");
    const mode = String((req.body && req.body.mode) || "");
    if (!carsets.MODES.includes(mode)) return res.status(400).json({ ok: false, error: "Modo de instalacao desconhecido." });
    if (carsets.status().running) return res.status(409).json({ ok: false, error: "Ja ha uma instalacao em andamento." });
    // o link e sempre o da lista: o painel so diz qual temporada
    const item = (await fetchCarsetList()).find((x) => x.season === season);
    if (!item) return res.status(404).json({ ok: false, error: "Temporada sem carset na lista." });
    const gameDir = await findAms2Dir();
    if (!gameDir) return res.status(404).json({ ok: false, error: "Automobilista 2 nao encontrado nas bibliotecas da Steam." });
    // a instalacao segue em segundo plano; o painel acompanha por /api/carsets/status
    carsets.install({ link: item.link, season, mode, gameDir }).then(
      (r) => console.log(`Carset "${season}" instalado (${mode}): ${r.cars.map((c) => c.car).join(", ")}`),
      (err) => console.log(`Carset "${season}": ${err.message}`)
    );
    res.json({ ok: true, gameDir });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.post("/command", (req, res) => {
  const name = req.body && req.body.name;
  if (!name) return res.status(400).json({ ok: false });
  if (String(name).startsWith("overlay.")) {
    wss.broadcast({ type: "overlayCommand", name, payload: req.body.payload || {} });
    return res.json({ ok: true });
  }
  if (name === "race.reset") {
    resetRace();
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
    // Aceita a chave criptografada (a que o organizador distribui, "llg1:...")
    // ou a chave pura do RLT.
    const typed = String((req.body && req.body.apiKey) || "").trim();
    const key = secret.reveal(typed);
    if (typed && !key) return res.status(400).json({ ok: false, error: "Chave invalida: confira se copiou a chave inteira." });
    const previous = rlt.getApiKey();
    rlt.setApiKey(key);
    if (!rlt.hasKey()) {
      settings.set("seasonId", null);
      settings.set("rltApiKey", null);
      return res.json({ ok: true, hasKey: false });
    }
    try {
      await rlt.fetchLeague();
      await rlt.fetchSeasons();
    } catch (err) {
      rlt.setApiKey(previous); // a chave nova nao funcionou: continua com a de antes
      throw err;
    }
    settings.set("seasonId", null);
    settings.setSecret("rltApiKey", rlt.getApiKey()); // so guarda a chave que funcionou (criptografada)
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
      settings.set("seasonId", null);
      broadcastRlt();
      return res.json({ ok: true, payload, status: rlt.getStatus(), mode: "game-only" });
    }
    const payload = await rlt.selectSeason(seasonId);
    settings.set("seasonId", Number(seasonId));
    broadcastRlt();
    res.json({ ok: true, payload, status: rlt.getStatus() });
  } catch (e) {
    console.error("[RLT] /api/rlt/season", e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post("/api/rlt/clear", (req, res) => {
  rlt.setApiKey("");
  settings.set("rltApiKey", null);
  settings.set("seasonId", null);
  wss.broadcast({ type: "rltConfig", data: null });
  res.json({ ok: true });
});

// Bridge: o listener.ps1 le a Shared Memory do AMS2 e manda o standings em
// JSON. O raceState acrescenta o que depende de historico (largada, paradas,
// tempo de box, bandeirada) e o resultado vai pro WebSocket.
//
// Varias fontes ficam ligadas ao mesmo tempo: os listeners do AMS2 e do LMU
// (pela ponte TCP) e o cliente do ACC (direto, pela API de transmissao do jogo).
// O jogo que esta numa sessao (manda carros) e o "ativo". As outras fontes,
// que so mandam listas vazias, sao ignoradas para as overlays nao piscarem.
const GAME_NAMES = { ams2: "Automobilista 2", lmu: "Le Mans Ultimate", acc: "Assetto Corsa Competizione", ac: "Assetto Corsa" };
let activeGame = null;
let activeGameSeenAt = 0;
let activeGameCarsAt = 0; // ultima vez que o jogo ativo mandou carros
const ACTIVE_GAME_TIMEOUT_MS = 3000;

function acceptPayload(payload) {
  const game = (payload && payload.game) || "ams2";
  const cars = payload && Array.isArray(payload.standings) ? payload.standings.length : 0;
  const now = Date.now();
  // Outro jogo so toma o lugar do ativo quando o ativo para de mandar carros.
  // Sem isso, dois jogos em sessao ao mesmo tempo fariam a tabela alternar
  // entre os dois a cada atualizacao.
  const activeIsBusy = activeGame !== null && now - activeGameCarsAt <= ACTIVE_GAME_TIMEOUT_MS;
  if (game !== activeGame && activeIsBusy) return false;
  if (game === activeGame && cars > 0) activeGameCarsAt = now;
  if (cars > 0 || game === activeGame || now - activeGameSeenAt > ACTIVE_GAME_TIMEOUT_MS) {
    if (game !== activeGame && cars > 0) activeGameCarsAt = now;
    if (game !== activeGame) console.log(`Recebendo dados de: ${GAME_NAMES[game] || game}`);
    activeGame = game;
    activeGameSeenAt = now;
    return true;
  }
  return false;
}

// Caminho unico dos dados de qualquer jogo ate as overlays.
function handleGamePayload(payload) {
  if (!acceptPayload(payload)) return;
  // LMU: o carro em foco vem da API do jogo (funciona tambem como espectador)
  if (payload.game === "lmu") lmuFocus.apply(payload);
  const data = raceState.apply(payload);
  // ACC: limite de stint escolhido no painel (0 = sem limite)
  if (data && data.game === "acc" && data.session) data.session.stintLimitMin = accStintLimitMin;
  wss.broadcast({ type: "standings", data });
}

// ACC: sem listener. O servidor fala direto com a API de transmissao do jogo.
// ACC_API=off desliga o cliente do ACC (usado nos testes, para um servidor de
// teste nao abrir mais uma conexao no jogo que esta aberto).
const accDisabled = /^(off|0|false)$/i.test(process.env.ACC_API || "");
const accClient = accDisabled
  ? { stop() {}, setGameLive() {} }
  : startAccClient((payload) => {
      try {
        handleGamePayload(payload);
      } catch (err) {
        console.error("Erro ao tratar dados do ACC:", err.message);
      }
    });

// Assetto Corsa (o primeiro): os carros chegam do app Python que roda dentro
// do jogo (ac-app/LLGOverlay), por um named pipe. AC_API=off desliga.
const acDisabled = /^(off|0|false)$/i.test(process.env.AC_API || "");
const acClient = acDisabled
  ? { stop() {}, setStatus() {} }
  : startAcClient((payload) => {
      try {
        handleGamePayload(payload);
      } catch (err) {
        console.error("Erro ao tratar dados do Assetto Corsa:", err.message);
      }
    });

// Ao fechar (Ctrl+C, janela do console fechada, aplicativo encerrando), cancela
// o registro no ACC. O aplicativo chama shutdown() antes de sair.
function shutdown() {
  accClient.stop();
  acClient.stop();
}
if (require.main === module) {
  ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"].forEach((signal) => {
    process.on(signal, () => {
      shutdown();
      setTimeout(() => process.exit(0), 200);
    });
  });
}

startTcpBridge(BRIDGE_PORT, (buffer) => {
  try {
    const payload = JSON.parse(buffer.toString("utf8"));
    // aviso do listener.ps1: o ACC entrou ou saiu de uma sessao
    if (payload && payload.accStatus) {
      accClient.setGameLive(!!payload.accStatus.live);
      return;
    }
    // idem para o Assetto Corsa: sessao atual e tempo restante
    if (payload && payload.acStatus) {
      acClient.setStatus(payload.acStatus);
      return;
    }
    handleGamePayload(payload);
  } catch (err) {
    console.error("Erro ao interpretar dados da bridge:", err.message);
  }
});

// OBS: conexao opcional via obs-websocket (comandos obs.setScene,
// obs.startRecord e obs.stopRecord pelo WebSocket). O painel nao tem mais
// botoes para isso, entao so conecta se o OBS estiver configurado no .env.
if (process.env.OBS_WS_URL || process.env.OBS_WS_PASSWORD) connectObs(wss);

// Resolvida quando o servidor esta ouvindo; rejeitada se a porta estiver
// ocupada. O aplicativo (app/main.js) usa isso para avisar o usuario.
const ready = new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
ready.catch((err) => {
  console.error(`Nao foi possivel abrir a porta ${HTTP_PORT}: ${err.message}`);
  if (err.code === "EADDRINUSE") console.error("Ja existe outro programa (ou outra copia deste) usando essa porta.");
  if (require.main === module) process.exit(1);
});

server.listen(HTTP_PORT, async () => {
  console.log(`Tabela de tempos em      http://localhost:${HTTP_PORT}/overlay/timing-table.html`);
  console.log(`Driver card overlay em   http://localhost:${HTTP_PORT}/overlay/driver-card.html`);
  console.log(`Tabela do piloto em      http://localhost:${HTTP_PORT}/overlay/driver-table.html`);
  console.log(`Painel de controle em    http://localhost:${HTTP_PORT}/panel/panel.html`);
  console.log(`Aguardando os jogos: AMS2 (listener.ps1), LMU (listener-lmu.ps1) e ACC (API de transmissao)`);
  console.log(ALLOW_LAN ? "Acesso liberado para a rede local (ALLOW_LAN)." : "Acesso restrito a este computador.");
  console.log(assetsBaseUrl ? `Imagens: ${assetsBaseUrl} (reserva: pasta local)` : "Imagens: somente pasta local.");
  if (!rlt.hasKey()) console.log("RLT sem chave: salve pelo painel ou defina RLT_API_KEY no arquivo .env.");
  if (rlt.hasKey()) {
    try {
      await rlt.fetchLeague();
      await rlt.fetchSeasons();
      // reaplica a temporada que estava em uso antes de fechar
      const savedSeason = settings.get("seasonId");
      if (savedSeason) {
        const payload = await rlt.selectSeason(savedSeason);
        broadcastRlt();
        console.log(`Temporada do RLT reaplicada: ${(payload && payload.seasonName) || savedSeason}`);
      } else {
        rlt.startRefresh();
      }
    } catch (err) {
      console.warn("RLT: nao foi possivel carregar agora:", err.message);
      rlt.startRefresh();
    }
  }
});

if (alternate.enabled) restartAlternate();

module.exports = { server, ready, shutdown, HTTP_PORT: Number(HTTP_PORT), BRIDGE_PORT: Number(BRIDGE_PORT) };
