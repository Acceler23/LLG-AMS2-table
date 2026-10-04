const WS_URL = `ws://${location.hostname}:${location.port || 8080}/ws`;
const socket = new WebSocket(WS_URL);

socket.addEventListener("open", () => {
  log("Painel WS conectado");
  refreshStatus();
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
  box.innerHTML = teams
    .map((t) => {
      const id = "tl_" + btoa(unescape(encodeURIComponent(t))).replace(/[^a-zA-Z0-9]/g, "");
      return `<div class="row" style="margin:4px 0">
        <span class="muted" style="min-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t}">${t}</span>
        <input id="${id}" type="text" placeholder="arquivo.png (vazio=padrão)" data-team="${t.replace(/"/g, "&quot;")}" />
        <button onclick="saveTeamLogo('${id}')">OK</button>
      </div>`;
    })
    .join("");
}

function saveTeamLogo(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const teamName = el.getAttribute("data-team");
  const file = (el.value || "").trim() || null;
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

async function refreshStatus() {
  try {
    const body = await api("/api/rlt/status");
    document.getElementById("rltStatus").textContent = JSON.stringify(body, null, 0);
    if (body.hasKey) {
      reloadSeasons();
      }
  } catch (_) {}
  loadAssetsBase();
}
