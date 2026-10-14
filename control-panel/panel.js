const WS_URL = `ws://${location.hostname}:${location.port || 8080}/ws`;
const socket = new WebSocket(WS_URL);

socket.addEventListener("open", () => {
  log("Painel WS conectado");
  refreshStatus();
});

// O servidor avisa quando uma temporada e aplicada, inclusive a que ele
// reaplica sozinho ao abrir. O painel acompanha para mostrar a selecao certa.
socket.addEventListener("message", async (ev) => {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch (_) {
    return;
  }
  if (msg.type !== "rltConfig" || !msg.data || !msg.data.seasonId) return;
  const sel = document.getElementById("rltSeason");
  const id = String(msg.data.seasonId);
  if (!Array.from(sel.options).some((o) => o.value === id)) await reloadSeasons();
  sel.value = id;
  renderClasses(msg.data.classes || []);
  renderTeamLogos(msg.data.standingsRows || []);
});

function send(name, payload = {}) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "command", name, payload }));
  } else {
    console.warn("Socket ainda nao esta aberto");
  }
}

function setOpacity(target, value) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const el = document.getElementById(target === "table" ? "opTableVal" : "opRowsVal");
  if (el) el.textContent = v + "%";
  send("overlay.setOpacity", { target, value: v / 100 });
}

// Intensidade do degrade com a cor da equipe nas linhas da tabela.
function setTeamTint(value) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const el = document.getElementById("teamTintVal");
  if (el) el.textContent = v + "%";
  try {
    localStorage.setItem("teamTintPanel", String(v));
  } catch (_) {}
  send("overlay.setTeamTint", { value: v / 100 });
}

// ---------------------------------------------------------------- AMS2: carsets
// O servidor baixa o carset da temporada e instala na pasta do jogo; aqui o
// painel so escolhe a temporada e o modo, e acompanha o andamento.
const CARSET_PHASES = { checking: "Conferindo...", downloading: "Baixando", extracting: "Extraindo os arquivos...", installing: "Copiando para a pasta do jogo..." };
const CARSET_MODES = { clean: "antigas renomeadas para _old_", keep: "antigas mantidas", sameName: "só arquivos de mesmo nome" };
let carsetPoll = null;

async function loadCarsets() {
  const sel = document.getElementById("carsetSeason");
  const status = document.getElementById("carsetStatus");
  try {
    const body = await api("/api/carsets");
    const current = sel.value;
    sel.innerHTML = "";
    (body.seasons || []).forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    // comeca na temporada que esta aplicada no painel, se ela tiver carset
    const applied = document.getElementById("rltSeason");
    const appliedName = applied && applied.selectedOptions[0] && applied.value ? applied.selectedOptions[0].textContent : "";
    const wanted = [current, appliedName].find((n) => n && (body.seasons || []).includes(n));
    if (wanted) sel.value = wanted;
    document.getElementById("carsetGame").textContent = body.gameDir
      ? "Pasta do jogo: " + body.gameDir + (body.gameRunning ? " (o jogo está aberto: feche antes de instalar)" : "")
      : "Automobilista 2 não encontrado nas bibliotecas da Steam.";
    document.getElementById("carsetInstall").disabled = !body.gameDir || !(body.seasons || []).length;
    status.textContent = (body.seasons || []).length ? "" : "Nenhum carset na lista.";
    showCarsetStatus(body.status);
  } catch (e) {
    status.textContent = "Não foi possível ler a lista: " + e.message;
    document.getElementById("carsetInstall").disabled = true;
  }
}

function showCarsetStatus(st) {
  if (!st) return;
  const status = document.getElementById("carsetStatus");
  const result = document.getElementById("carsetResult");
  const btn = document.getElementById("carsetInstall");
  if (st.running) {
    btn.disabled = true;
    status.textContent = `${st.season}: ${CARSET_PHASES[st.phase] || st.phase}${st.phase === "downloading" && st.percent ? " " + st.percent + "%" : ""}`;
    if (!carsetPoll) carsetPoll = setInterval(pollCarset, 700);
    return;
  }
  if (carsetPoll) {
    clearInterval(carsetPoll);
    carsetPoll = null;
    btn.disabled = false;
  }
  if (st.phase === "error") {
    status.textContent = `${st.season}: não instalado. ${st.error}`;
    result.textContent = "";
  } else if (st.phase === "done" && st.result) {
    status.textContent = `${st.season}: instalado (${CARSET_MODES[st.result.mode] || st.result.mode}).`;
    const lines = st.result.cars.map((c) => {
      const parts = [`${c.copied} arquivos copiados`];
      if (c.renamed) parts.push(`${c.renamed} itens antigos renomeados para _old_`);
      if (c.skipped) parts.push(`${c.skipped} não copiados`);
      return `${c.car}: ${parts.join(", ")}`;
    });
    if (st.result.unknown && st.result.unknown.length) lines.push(`Pastas ignoradas (não são carros do jogo): ${st.result.unknown.join(", ")}`);
    result.textContent = lines.join("\n");
  }
}

async function pollCarset() {
  try {
    const body = await api("/api/carsets/status");
    const wasRunning = !!carsetPoll;
    showCarsetStatus(body.status);
    if (wasRunning && !body.status.running) log("Carset " + body.status.season + ": " + (body.status.phase === "done" ? "instalado" : body.status.error));
  } catch (_) {}
}

async function installCarset() {
  const season = document.getElementById("carsetSeason").value;
  const mode = (document.querySelector('input[name="carsetMode"]:checked') || {}).value || "clean";
  if (!season) return;
  document.getElementById("carsetResult").textContent = "";
  try {
    await api("/api/carsets/install", { method: "POST", body: JSON.stringify({ season, mode }) });
    log(`Carset ${season}: instalando...`);
    showCarsetStatus({ running: true, phase: "checking", season, percent: 0 });
  } catch (e) {
    document.getElementById("carsetStatus").textContent = "Não foi possível instalar: " + e.message;
  }
}

loadCarsets();

// ---------------------------------------------------------------- ACC
// Tempo maximo de stint: o servidor guarda a escolha e manda para a tabela.
function showAccStint(body) {
  const minutes = Number(body && body.minutes) || 0;
  document.getElementById("accStintOn").checked = minutes > 0;
  if (minutes > 0) document.getElementById("accStintMin").value = minutes;
  document.getElementById("accStintMin").disabled = !(minutes > 0);
  document.getElementById("accStintStatus").textContent =
    minutes > 0 ? `Limite de ${minutes} min ligado. A coluna "Stint" vira um cronômetro.` : `Sem limite: a coluna "Stint" mostra voltas.`;
}

async function setAccStint() {
  const on = document.getElementById("accStintOn").checked;
  const typed = Math.floor(Number(document.getElementById("accStintMin").value)) || 35;
  try {
    const body = await api("/api/acc/stint", { method: "POST", body: JSON.stringify({ minutes: on ? Math.max(1, typed) : 0 }) });
    showAccStint(body);
    log(body.minutes > 0 ? `ACC: stint máximo de ${body.minutes} min` : "ACC: sem stint máximo");
  } catch (e) {
    log("ERRO stint: " + e.message);
  }
}

api("/api/acc/stint").then(showAccStint).catch(() => {});

// Bateria mostrada no cabecalho da tabela (CORRIDA 2, QUALI 1): automatico
// (vazio), 0 = sem numero, ou o numero escolhido
function setHeat() {
  const read = (id) => {
    const v = document.getElementById(id).value;
    return v === "" ? null : Number(v);
  };
  const value = { race: read("heatRace"), quali: read("heatQuali") };
  try {
    localStorage.setItem("heatPanel", JSON.stringify(value));
  } catch (_) {}
  send("overlay.setHeat", value);
}

// os menus abrem na ultima escolha
try {
  const savedHeat = JSON.parse(localStorage.getItem("heatPanel") || "null");
  if (savedHeat) {
    document.getElementById("heatRace").value = savedHeat.race == null ? "" : String(savedHeat.race);
    document.getElementById("heatQuali").value = savedHeat.quali == null ? "" : String(savedHeat.quali);
  }
} catch (_) {}

// Pagina de disputas (tecla 9): a tabela toda (0,3 s) ou so o piloto assistido (0,5 s)
function setBattleScope(value) {
  try {
    localStorage.setItem("battleScopePanel", value);
  } catch (_) {}
  send("overlay.setBattleScope", { value });
}

// o menu abre na ultima escolha
try {
  const savedScope = localStorage.getItem("battleScopePanel");
  if (savedScope) document.getElementById("battleScope").value = savedScope;
} catch (_) {}

// o slider abre na ultima intensidade escolhida
try {
  const saved = localStorage.getItem("teamTintPanel");
  if (saved != null) {
    document.getElementById("teamTint").value = saved;
    document.getElementById("teamTintVal").textContent = saved + "%";
  }
} catch (_) {}

function log(msg) {
  const el = document.getElementById("rltLog");
  if (!el) return;
  const t = new Date().toLocaleTimeString();
  el.textContent = `[${t}] ${msg}\n` + el.textContent;
  console.log("[panel]", msg);
}

// Assetto Corsa 1: instala o app do jogo (so quando o botao e clicado)
async function installAcApp() {
  const btn = document.getElementById("acInstallBtn");
  const status = document.getElementById("acInstallStatus");
  btn.disabled = true;
  status.textContent = "Instalando...";
  try {
    const r = await api("/api/ac/install", { method: "POST" });
    let msg = r.copied || r.enabled ? "Instalado em " + r.gameDir + "." : "Já estava instalado e atualizado em " + r.gameDir + ".";
    if (!r.active) msg += " O app está desligado no jogo: ative \"LLG Overlay\" em Opções > Geral > UI Modules.";
    else if (r.copied || r.enabled) msg += " Se o jogo estiver numa sessão, entre nela de novo.";
    status.textContent = msg;
    log("Assetto Corsa 1: " + msg);
  } catch (err) {
    status.textContent = err.message;
    log("Assetto Corsa 1: " + err.message);
  }
  btn.disabled = false;
}

// Estado da chave e da temporada, em palavras (aba Configuracao)
function showRltStatus(st) {
  const el = document.getElementById("rltStatus");
  if (!el) return;
  if (!st || !st.hasKey) {
    el.textContent = "Sem chave salva: a tabela usa só os dados do jogo.";
    return;
  }
  const parts = ["Chave salva"];
  if (st.leagueName) parts.push("liga " + st.leagueName);
  parts.push(st.selectedSeasonId ? "temporada aplicada" : "nenhuma temporada aplicada");
  el.textContent = parts.join(" · ");
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function renderSeasons(seasons) {
  const sel = document.getElementById("rltSeason");
  const cur = sel.value;
  sel.innerHTML = '<option value="">— só dados do jogo (sem season) —</option>';
  (seasons || []).forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.seasonId;
    const n = s.classes ? s.classes.length : 0;
    opt.textContent = `${s.seasonName} (${n} classes)`;
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
}

function renderClasses(classes) {
  const box = document.getElementById("rltClasses");
  if (!classes || !classes.length) {
    box.innerHTML = '<span class="muted">Sem RacingClasses nesta season</span>';
    return;
  }
  box.innerHTML = classes
    .map((c) => {
      const bg = c.color || "#444";
      return `<span class="class-chip" style="background:${bg};color:#fff">${c.name || c.uniqueName}</span>`;
    })
    .join("");
}

async function saveKey() {
  const apiKey = document.getElementById("rltKey").value.trim();
  if (!apiKey) return log("Cole a API key");
  try {
    log("Salvando key e buscando seasons…");
    const body = await api("/api/rlt/key", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    });
    log(`League ok. Seasons ativas: ${(body.seasons || []).length}`);
    renderSeasons(body.seasons || []);
    showRltStatus(body.status || {});
  } catch (e) {
    log("ERRO key: " + e.message);
  }
}

async function reloadSeasons() {
  try {
    log("Recarregando seasons…");
    const body = await api("/api/rlt/seasons");
    log(`Seasons: ${(body.seasons || []).length}`);
    renderSeasons(body.seasons || []);
  } catch (e) {
    log("ERRO seasons: " + e.message);
  }
}

// Logos de equipe: um menu com as equipes da temporada e um campo para o
// arquivo da equipe escolhida.
const teamLogoTyped = {}; // equipe -> ultimo arquivo digitado nesta sessao do painel

function renderTeamLogos(rows) {
  const box = document.getElementById("teamLogos");
  if (!box) return;
  const teams = [];
  const seen = new Set();
  (rows || []).forEach((r) => {
    const t = r.teamName;
    if (!t || seen.has(t)) return;
    seen.add(t);
    teams.push(t);
  });
  teams.sort((a, b) => a.localeCompare(b));
  if (!teams.length) {
    box.innerHTML = '<span class="muted">Nenhuma equipe na season</span>';
    return;
  }
  const previous = (document.getElementById("teamLogoSelect") || {}).value;
  box.innerHTML = `<div class="row">
      <select id="teamLogoSelect" onchange="showTeamLogo()"></select>
    </div>
    <div class="row">
      <input id="teamLogoFile" type="text" placeholder="arquivo.png (vazio=padrão)" />
      <button onclick="saveTeamLogo()">OK</button>
    </div>`;
  const sel = document.getElementById("teamLogoSelect");
  teams.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    sel.appendChild(opt);
  });
  if (previous && teams.includes(previous)) sel.value = previous;
  showTeamLogo();
}

function showTeamLogo() {
  const sel = document.getElementById("teamLogoSelect");
  const input = document.getElementById("teamLogoFile");
  if (!sel || !input) return;
  input.value = teamLogoTyped[sel.value] || "";
}

function saveTeamLogo() {
  const sel = document.getElementById("teamLogoSelect");
  const input = document.getElementById("teamLogoFile");
  if (!sel || !input || !sel.value) return;
  const teamName = sel.value;
  const file = (input.value || "").trim() || null;
  teamLogoTyped[teamName] = file || "";
  send("overlay.setTeamLogo", { teamName, file });
  log(file ? `Logo ${teamName} → ${file}` : `Logo ${teamName} → padrão`);
}

async function applySeason() {
  const seasonId = document.getElementById("rltSeason").value;
  try {
    if (!seasonId) {
      log("Modo só jogo (sem season RLT)…");
      const body = await api("/api/rlt/season", {
        method: "POST",
        body: JSON.stringify({ seasonId: null }),
      });
      renderClasses([]);
      renderTeamLogos([]);
      showRltStatus(body.status || {});
      log("OK — overlay usa apenas dados do AMS2");
      return;
    }
    log(`Aplicando season ${seasonId}…`);
    const body = await api("/api/rlt/season", {
      method: "POST",
      body: JSON.stringify({ seasonId: Number(seasonId) }),
    });
    const p = body.payload || {};
    const nDrivers = Array.isArray(p.drivers) ? p.drivers.length : Object.keys(p.drivers || {}).length;
    log(`Season aplicada: ${p.seasonName} | classes=${(p.classes || []).length} | drivers=${nDrivers}`);
    renderClasses(p.classes || []);
    renderTeamLogos(p.standingsRows || []);
    showRltStatus(body.status || {});
  } catch (e) {
    log("ERRO season: " + e.message);
  }
}




async function clearRlt() {
  try {
    await api("/api/rlt/clear", { method: "POST", body: "{}" });
    document.getElementById("rltKey").value = "";
    document.getElementById("rltSeason").innerHTML = '<option value="">— só dados do jogo (sem season) —</option>';
    document.getElementById("rltClasses").innerHTML = "";
    document.getElementById("rltStatus").textContent = "";
    renderTeamLogos([]);
    log("RLT limpo");
  } catch (e) {
    log("ERRO clear: " + e.message);
  }
}

function showAssetsBaseStatus(body) {
  const el = document.getElementById("assetsBaseStatus");
  const input = document.getElementById("assetsBaseUrl");
  if (!el) return;
  if (input) input.value = body.baseUrl || "";
  el.textContent = body.baseUrl
    ? `Online primeiro: ${body.baseUrl} (v=${body.cacheBust || "—"}). Reserva: pasta local.`
    : "Usando só a pasta local do projeto";
}

async function loadAssetsBase() {
  try {
    const body = await api("/api/assets/base");
    showAssetsBaseStatus(body);
  } catch (_) {}
}

async function saveAssetsBase() {
  try {
    const u = (document.getElementById("assetsBaseUrl").value || "").trim();
    const body = await api("/api/assets/base", {
      method: "POST",
      body: JSON.stringify({ baseUrl: u || "" }),
    });
    showAssetsBaseStatus(body);
    log(body.baseUrl ? "Logos: " + body.baseUrl : "Logos: local");
  } catch (e) {
    log("ERRO assets: " + e.message);
  }
}

async function resetAssetsBase() {
  document.getElementById("assetsBaseUrl").value = "";
  await saveAssetsBase();
}

// Primeira vez: sem chave salva, o painel pede a chave antes de tudo.
function showFirstRun(show) {
  document.getElementById("firstRun").style.display = show ? "flex" : "none";
  if (show) document.getElementById("firstRunKey").focus();
}

function skipFirstRun() {
  try {
    sessionStorage.setItem("skipFirstRun", "1"); // nao pergunta de novo ate fechar o painel
  } catch (_) {}
  showFirstRun(false);
}

async function saveFirstRunKey() {
  const apiKey = document.getElementById("firstRunKey").value.trim();
  const status = document.getElementById("firstRunStatus");
  if (!apiKey) {
    status.textContent = "Cole a chave primeiro.";
    return;
  }
  const btn = document.getElementById("firstRunBtn");
  btn.disabled = true;
  status.textContent = "Conferindo a chave...";
  try {
    const body = await api("/api/rlt/key", { method: "POST", body: JSON.stringify({ apiKey }) });
    document.getElementById("firstRunKey").value = "";
    status.textContent = "";
    showFirstRun(false);
    log(`Chave salva. Seasons ativas: ${(body.seasons || []).length}`);
    renderSeasons(body.seasons || []);
    showRltStatus(body.status || {});
  } catch (e) {
    status.textContent = "Não funcionou: " + e.message;
  }
  btn.disabled = false;
}

async function refreshStatus() {
  try {
    const body = await api("/api/rlt/status");
    showRltStatus(body);
    let skipped = false;
    try {
      skipped = sessionStorage.getItem("skipFirstRun") === "1";
    } catch (_) {}
    showFirstRun(!body.hasKey && !skipped);
    if (body.hasKey) {
      await reloadSeasons();
      // a temporada aplicada (inclusive a reaplicada ao abrir) aparece selecionada
      if (body.selectedSeasonId) document.getElementById("rltSeason").value = String(body.selectedSeasonId);
    }
  } catch (_) {}
  loadAssetsBase();
}

// ---------------------------------------------------------------- alternancia automatica
// Colunas da tabela rodando sozinhas. O servidor guarda a escolha e faz a troca.
function showAlternateSeconds(value) {
  document.getElementById("altSecondsVal").textContent = `${value} s`;
}

function showAlternate(body) {
  document.getElementById("altEnabled").checked = !!body.enabled;
  document.getElementById("altSeconds").value = body.seconds;
  showAlternateSeconds(body.seconds);
}

async function setAlternate() {
  try {
    const body = await api("/api/overlay/alternate", {
      method: "POST",
      body: JSON.stringify({
        enabled: document.getElementById("altEnabled").checked,
        seconds: Number(document.getElementById("altSeconds").value),
      }),
    });
    showAlternate(body);
    log(body.enabled ? `Alternando posições e pontuação a cada ${body.seconds} s` : "Alternância desligada");
  } catch (e) {
    log("ERRO alternância: " + e.message);
  }
}

api("/api/overlay/alternate").then(showAlternate).catch(() => {});

// ---------------------------------------------------------------- links das overlays
function fillLinks() {
  const base = `http://localhost:${location.port || 8080}`;
  document.getElementById("linkTable").value = `${base}/overlay/timing-table.html`;
  document.getElementById("linkCard").value = `${base}/overlay/driver-card.html`;
  document.getElementById("linkDriver").value = `${base}/overlay/driver-table.html`;
}

async function copyLink(id) {
  const input = document.getElementById(id);
  input.select();
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (_) {
    document.execCommand("copy");
  }
  log("Link copiado: " + input.value);
}

fillLinks();

// ---------------------------------------------------------------- aplicativo (.exe)
// window.llgApp so existe quando o painel roda dentro do aplicativo.
let driverWindowState = null;

function showDriverWindowState(s) {
  driverWindowState = s;
  document.getElementById("drvVisible").checked = !!s.visible;
  const pct = Math.round((s.scale || 1) * 100);
  document.getElementById("drvScale").value = pct;
  document.getElementById("drvScaleVal").textContent = pct + "%";
  const edit = document.getElementById("drvEdit");
  edit.textContent = s.edit ? "Travar posição" : "Mover";
  edit.disabled = !s.visible;
  document.getElementById("drvHint").textContent = s.edit
    ? "Arraste a área azul pontilhada até o lugar desejado e clique em Travar posição."
    : "Travada: os cliques passam direto para o jogo.";
}

async function setDriverWindow(patch) {
  if (!window.llgApp) return;
  showDriverWindowState(await window.llgApp.driver.set(patch));
}

function toggleDriverEdit() {
  setDriverWindow({ edit: !(driverWindowState && driverWindowState.edit) });
}

function setDriverScale(value) {
  const pct = Math.max(50, Math.min(200, Number(value) || 100));
  document.getElementById("drvScaleVal").textContent = pct + "%";
  setDriverWindow({ scale: pct / 100 });
}

// Programas que abrem junto com o aplicativo (so existe dentro do aplicativo).
// A lista cresce e encolhe conforme os itens: uma linha por programa.
function showCompanion(info) {
  if (!info) return;
  const items = info.items || [];
  const list = document.getElementById("companionList");
  list.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.style.margin = "8px 0";
    empty.textContent = "Nenhum programa na lista.";
    list.appendChild(empty);
  }
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "row";
    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.value = item.path;
    input.title = item.path;
    const open = document.createElement("button");
    open.textContent = "Abrir";
    open.onclick = () => companionAction("launch", item.path);
    const remove = document.createElement("button");
    remove.textContent = "Remover";
    remove.onclick = () => companionAction("remove", item.path);
    row.append(input, open, remove);
    list.appendChild(row);
    const msg = item.message || (item.exists ? "" : "Arquivo não encontrado. Remova e adicione de novo.");
    if (msg) {
      const note = document.createElement("div");
      note.className = "muted";
      note.textContent = msg;
      list.appendChild(note);
      if (item.message) log(`Abrir junto: ${item.path} → ${item.message}`);
    }
  });
  document.getElementById("companionLaunchAll").disabled = !items.length;
  document.getElementById("companionStatus").textContent = info.note || "";
  if (info.note) log("Abrir junto: " + info.note);
}

async function companionAction(action, file) {
  if (!window.llgApp || !window.llgApp.companion) return;
  try {
    showCompanion(await window.llgApp.companion[action](file));
  } catch (e) {
    document.getElementById("companionStatus").textContent = "Erro: " + e.message;
  }
}

if (window.llgApp) {
  document.getElementById("appSection").hidden = false;
  document.getElementById("appFiles").hidden = false;
  if (window.llgApp.companion) window.llgApp.companion.get().then(showCompanion);
  window.llgApp.driver.get().then(showDriverWindowState);
}

// ---------------------------------------------------------------- abas
// Piloto / Transmissao / Configuracao. A ultima aba aberta fica lembrada.
function showTab(name) {
  document.querySelectorAll(".tab, .tab-page").forEach((el) => el.classList.toggle("active", el.dataset.tab === name));
  try {
    localStorage.setItem("panelTab", name);
  } catch (_) {}
}

(function () {
  let saved = null;
  try {
    saved = localStorage.getItem("panelTab");
  } catch (_) {}
  showTab(document.querySelector(`.tab-page[data-tab="${saved}"]`) ? saved : "piloto");
})();
