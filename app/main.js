// app/main.js
// Aplicativo (Electron): um unico programa que
//   - sobe o servidor (o mesmo de "npm start"), dentro deste processo
//   - inicia os listeners (AMS2 e LMU) e o hotkeys.ps1 escondidos, e os reinicia se cairem
//   - abre o painel de controle numa janela propria
//   - mostra a tabela do piloto numa janela transparente por cima do jogo
// Rodar em desenvolvimento: npm run app. Gerar a pasta com o .exe: npm run build.

const { app, BrowserWindow, Menu, dialog, ipcMain, screen, shell } = require("electron");
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// tamanho da janela do piloto em 100% (a tabela e desenhada com 340 px)
const DRIVER_BASE = { width: 340, height: 620 };
const EDIT_CSS = `
  html { -webkit-app-region: drag; min-height: 100vh; cursor: move;
         background: rgba(0, 197, 253, 0.18) !important;
         outline: 2px dashed #00c5fd; outline-offset: -2px; }
`;

let panelWin = null;
let driverWin = null;
let editCssKey = null;
let quitting = false;
let ports = { http: 8080, bridge: 5607 };
const helpers = []; // { name, child }

// ---------------------------------------------------------------- estado
const dataDir = app.getPath("userData");
const stateFile = path.join(dataDir, "app-state.json");
let state = {
  driver: { visible: false, edit: false, scale: 1, x: null, y: null },
  // programas que o usuario escolheu no painel para abrir junto com o aplicativo
  companion: { paths: [] },
};

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    state.driver = Object.assign(state.driver, saved.driver || {});
    const c = saved.companion || {};
    // versao anterior guardava um programa so, em "path"
    const list = Array.isArray(c.paths) ? c.paths : c.path ? [c.path] : [];
    state.companion.paths = list.filter((f) => typeof f === "string" && f);
  } catch (_) {}
  state.driver.edit = false; // sempre abre travada
}

function saveState() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch (_) {}
}

// ---------------------------------------------------------------- scripts auxiliares
function startHelper(name, args) {
  const file = path.join(ROOT, name);
  const logFile = path.join(dataDir, name.replace(/\.ps1$/, ".log"));
  const entry = { name, child: null };
  helpers.push(entry);

  function launch() {
    if (quitting) return;
    let log;
    try {
      log = fs.createWriteStream(logFile, { flags: "w" });
    } catch (_) {
      log = null;
    }
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", file].concat(args),
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    entry.child = child;
    if (log) {
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
    }
    child.on("error", (err) => console.error(`${name}: ${err.message}`));
    child.on("exit", () => {
      entry.child = null;
      if (log) log.end();
      if (!quitting) setTimeout(launch, 3000); // caiu: tenta de novo
    });
  }
  launch();
}

function stopHelpers() {
  helpers.forEach((h) => {
    if (h.child) {
      try {
        h.child.kill();
      } catch (_) {}
    }
  });
}

// ---------------------------------------------------------------- janela do painel
function createPanelWindow() {
  panelWin = new BrowserWindow({
    width: 880,
    height: 960,
    title: "LLG Overlay",
    icon: path.join(__dirname, "icon.png"), // gerado por app/make-icon.ps1
    autoHideMenuBar: true,
    backgroundColor: "#111111",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  panelWin.loadURL(`http://127.0.0.1:${ports.http}/panel/panel.html`);
  // links (docs do RLT etc.) abrem no navegador padrao
  panelWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  panelWin.on("page-title-updated", (e) => e.preventDefault());
  panelWin.on("closed", () => {
    panelWin = null;
    app.quit();
  });
}

// ---------------------------------------------------------------- janela do piloto
function driverBounds() {
  const s = state.driver;
  const width = Math.round(DRIVER_BASE.width * s.scale);
  const height = Math.round(DRIVER_BASE.height * s.scale);
  let x = s.x;
  let y = s.y;
  // posicao salva fora de qualquer monitor (ex: monitor desconectado): volta ao padrao
  const visible =
    x != null &&
    y != null &&
    screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return x + 40 < a.x + a.width && x + width - 40 > a.x && y + 20 < a.y + a.height && y >= a.y - 10;
    });
  if (!visible) {
    const a = screen.getPrimaryDisplay().workArea;
    x = a.x + 20;
    y = a.y + 120;
  }
  return { x: Math.round(x), y: Math.round(y), width, height };
}

function applyDriverEdit() {
  if (!driverWin) return;
  const edit = !!state.driver.edit;
  driverWin.setIgnoreMouseEvents(!edit); // travada: cliques passam direto pro jogo
  driverWin.setFocusable(edit);
  if (edit && !editCssKey) {
    driverWin.webContents.insertCSS(EDIT_CSS).then((key) => {
      editCssKey = key;
    });
  } else if (!edit && editCssKey) {
    driverWin.webContents.removeInsertedCSS(editCssKey).catch(() => {});
    editCssKey = null;
  }
}

function createDriverWindow() {
  driverWin = new BrowserWindow(
    Object.assign(driverBounds(), {
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      show: false,
      webPreferences: { backgroundThrottling: false },
    })
  );
  // nivel mais alto: fica por cima do jogo em janela sem bordas
  driverWin.setAlwaysOnTop(true, "screen-saver");
  editCssKey = null;
  driverWin.loadURL(`http://127.0.0.1:${ports.http}/overlay/driver-table.html`);
  driverWin.webContents.on("did-finish-load", applyDriverEdit);
  driverWin.once("ready-to-show", () => {
    if (driverWin) driverWin.showInactive();
  });
  driverWin.on("moved", () => {
    if (!driverWin) return;
    const [x, y] = driverWin.getPosition();
    state.driver.x = x;
    state.driver.y = y;
    saveState();
  });
  driverWin.on("closed", () => {
    driverWin = null;
    editCssKey = null;
  });
}

function syncDriverWindow() {
  if (state.driver.visible) {
    if (!driverWin) createDriverWindow();
    else {
      driverWin.setBounds(driverBounds());
      applyDriverEdit();
    }
  } else if (driverWin) {
    driverWin.destroy();
  }
}

function setDriver(patch) {
  const s = state.driver;
  const p = patch || {};
  if (typeof p.visible === "boolean") s.visible = p.visible;
  if (typeof p.edit === "boolean") s.edit = p.edit;
  if (typeof p.scale === "number" && p.scale > 0) s.scale = Math.max(0.5, Math.min(2.5, p.scale));
  if (p.reset) {
    s.x = null;
    s.y = null;
  }
  if (!s.visible) s.edit = false;
  saveState();
  syncDriverWindow();
  return s;
}

ipcMain.handle("driver:get", () => state.driver);
ipcMain.handle("driver:set", (_event, patch) => setDriver(patch));
ipcMain.handle("app:info", () => ({
  version: app.getVersion(),
  dataDir,
  configFile: path.join(ROOT, "overlay", "drivers-config.js"),
  noHotkeys: !!process.env.LLG_NO_HOTKEYS,
}));
// ---------------------------------------------------------------- programas abertos junto
// O usuario monta no painel (aba Configuracao) uma lista de outros programas
// para abrir sempre que este aplicativo abrir: o OBS, por exemplo. So entram
// na lista arquivos que ele mesmo escolheu pela janela de selecao; nada e
// aberto sem essa escolha.
const COMPANION_TYPES = [".exe", ".bat", ".cmd", ".lnk"];

// messages: { caminho: texto } para mostrar ao lado de um item; note: aviso geral
function companionInfo(messages, note) {
  const msgs = messages || {};
  return {
    items: state.companion.paths.map((file) => ({ path: file, exists: fs.existsSync(file), message: msgs[file] || "" })),
    note: note || "",
  };
}

function isRunning(file) {
  // so da para conferir programas .exe, pelo nome do arquivo
  return new Promise((resolve) => {
    if (path.extname(file).toLowerCase() !== ".exe") return resolve(false);
    const image = path.basename(file);
    execFile("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH", "/FO", "CSV"], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      resolve(!err && String(stdout || "").toLowerCase().includes(`"${image.toLowerCase()}"`));
    });
  });
}

// onlyIfClosed: na abertura do aplicativo, nao abre de novo o que ja esta aberto.
// Devolve o texto do que aconteceu.
async function launchOne(file, onlyIfClosed) {
  if (!fs.existsSync(file)) return "Arquivo não encontrado. Remova e adicione de novo.";
  if (onlyIfClosed && (await isRunning(file))) return "Já estava aberto.";
  const error = await shell.openPath(file);
  return error ? `Não foi possível abrir: ${error}` : "Aberto.";
}

async function launchCompanions(onlyIfClosed) {
  const messages = {};
  for (const file of state.companion.paths.slice()) messages[file] = await launchOne(file, onlyIfClosed);
  return companionInfo(messages);
}

ipcMain.handle("companion:get", () => companionInfo());
ipcMain.handle("companion:add", async () => {
  const result = await dialog.showOpenDialog(panelWin, {
    title: "Programa para abrir junto com o LLG Overlay",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Programas", extensions: COMPANION_TYPES.map((e) => e.slice(1)) }],
  });
  if (result.canceled || !result.filePaths.length) return companionInfo();
  const have = new Set(state.companion.paths.map((f) => f.toLowerCase()));
  let added = 0;
  let skipped = 0;
  result.filePaths.forEach((file) => {
    if (!COMPANION_TYPES.includes(path.extname(file).toLowerCase()) || have.has(file.toLowerCase())) {
      skipped++;
      return;
    }
    have.add(file.toLowerCase());
    state.companion.paths.push(file);
    added++;
  });
  saveState();
  const note = added
    ? `${added === 1 ? "Programa adicionado" : added + " programas adicionados"}. ${added === 1 ? "Vai" : "Vão"} abrir junto na próxima vez que o aplicativo abrir.`
    : skipped
      ? "Nada adicionado: o programa já está na lista ou não é .exe, .bat, .cmd ou atalho .lnk."
      : "";
  return companionInfo(null, note);
});
ipcMain.handle("companion:remove", (_event, file) => {
  state.companion.paths = state.companion.paths.filter((f) => f !== file);
  saveState();
  return companionInfo(null, "Removido da lista.");
});
ipcMain.handle("companion:launch", async (_event, file) => {
  // so abre o que esta na lista
  if (!state.companion.paths.includes(file)) return companionInfo();
  return companionInfo({ [file]: await launchOne(file, false) });
});
ipcMain.handle("companion:launchAll", () => launchCompanions(false));

ipcMain.handle("app:openPath", (_event, target) => {
  // so abre as duas pastas que o painel oferece
  if (target === "data") return shell.openPath(dataDir);
  if (target === "config") return shell.openPath(path.join(ROOT, "overlay"));
  return "";
});

// ---------------------------------------------------------------- inicio
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (panelWin) {
      if (panelWin.isMinimized()) panelWin.restore();
      panelWin.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    loadState();
    process.env.LLG_DATA_DIR = dataDir; // settings.json do servidor vai pra pasta do usuario

    let server;
    try {
      server = require(path.join(ROOT, "server", "index.js"));
      await server.ready;
    } catch (err) {
      const busy = err && err.code === "EADDRINUSE";
      dialog.showErrorBox(
        "LLG Overlay",
        busy
          ? `A porta ${(server && server.HTTP_PORT) || 8080} ja esta em uso.\n\nO LLG Overlay ja esta aberto, ou o start.bat antigo esta rodando. Feche o outro e abra de novo.`
          : `Nao foi possivel iniciar o servidor:\n${(err && err.message) || err}`
      );
      app.exit(1);
      return;
    }
    ports = { http: server.HTTP_PORT, bridge: server.BRIDGE_PORT };

    const parent = ["-ParentPid", String(process.pid)]; // os scripts fecham sozinhos se o app morrer
    const listenerArgs = ["-BridgePort", String(ports.bridge)].concat(parent);
    // so para testes: ler outro mapeamento de memoria no lugar do jogo
    if (process.env.LLG_MAP_NAME) listenerArgs.push("-MapName", process.env.LLG_MAP_NAME);
    startHelper("listener.ps1", listenerArgs);
    // Le Mans Ultimate: outro listener, mesma ponte. O servidor usa o jogo que estiver em sessao.
    const lmuArgs = ["-BridgePort", String(ports.bridge)].concat(parent);
    if (process.env.LLG_LMU_MAP_NAME) lmuArgs.push("-MapName", process.env.LLG_LMU_MAP_NAME);
    startHelper("listener-lmu.ps1", lmuArgs);
    if (!process.env.LLG_NO_HOTKEYS) startHelper("hotkeys.ps1", ["-Port", String(ports.http)].concat(parent));

    createPanelWindow();
    syncDriverWindow();
    // abre junto os programas escolhidos no painel, se houver
    launchCompanions(true).catch(() => {});
  });

  app.on("before-quit", () => {
    quitting = true;
    // cancela o registro na API do ACC antes de sair
    try {
      require(path.join(ROOT, "server", "index.js")).shutdown();
    } catch (_) {}
    stopHelpers();
  });
  app.on("window-all-closed", () => app.quit());
}
