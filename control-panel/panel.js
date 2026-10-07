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
    document.getElementById("rltStatus").textContent = JSON.stringify(body.status || {}, null, 0);
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
      document.getElementById("rltStatus").textContent = JSON.stringify(body.status || {}, null, 0);
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
    document.getElementById("rltStatus").textContent = JSON.stringify(body.status || {}, null, 0);
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
    document.getElementById("rltStatus").textContent = JSON.stringify(body.status || {}, null, 0);
  } catch (e) {
    status.textContent = "Não funcionou: " + e.message;
  }
  btn.disabled = false;
}

async function refreshStatus() {
  try {
    const body = await api("/api/rlt/status");
    document.getElementById("rltStatus").textContent = JSON.stringify(body, null, 0);
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
// Posicoes da sessao <-> pontuacao. O servidor guarda a escolha e faz a troca.
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

if (window.llgApp) {
  document.getElementById("appSection").hidden = false;
  window.llgApp.driver.get().then(showDriverWindowState);
}
