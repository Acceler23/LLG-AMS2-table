// server/rltCache.js
// Cache das respostas da API do RLT, para gastar o minimo de requisicoes (a
// API tem limite diario).
//
//   - Toda resposta fica guardada (em memoria e em disco, rlt-cache.json na
//     pasta de dados), e continua valendo depois de fechar o aplicativo.
//   - Uma resposta guardada so e buscada de novo quando o RLT avisa que algo
//     dela mudou. O aviso vem do feed de mudancas (/database/changes): UMA
//     requisicao por ciclo de atualizacao diz o que mudou (temporada, evento,
//     piloto) desde a ultima olhada; so isso e marcado para buscar de novo.
//   - Limite estourado (HTTP 429): nenhuma requisicao ate o bloqueio passar;
//     enquanto isso vale o que esta guardado, mesmo que antigo.
//
// O servidor tambem expoe o cache em /api/rlt/raw (so neste computador), para
// scripts de teste lerem os dados sem gastar requisicoes.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CHANGES_PATH = "/api/public/v1/database/changes";
const DEFAULT_BLOCK_MS = 60 * 60 * 1000; // 429 sem Retry-After: 1 h sem chamar a API
const SINCE_OVERLAP_MS = 60 * 1000; // olha 1 min antes da ultima vez (relogios diferentes)
const SAVE_DELAY_MS = 500;

// file: arquivo do cache em disco (null = so memoria)
// request(path): faz a requisicao e devolve { status, headers, body } (injetado nos testes)
function createRltCache(opts) {
  const file = opts && opts.file;
  const request = opts.request;
  const clock = (opts && opts.clock) || Date.now;
  const log = (opts && opts.log) || (() => {});

  // path -> { body, at, valid, seasonId }
  let entries = new Map();
  let since = null; // ate quando o feed de mudancas ja foi lido (ISO)
  let keyHash = null; // de qual chave sao os dados (outra chave = outra liga)
  let blockedUntil = 0;
  let lastError = null;
  let requests = { day: null, count: 0 };
  let saveTimer = null;

  // ---- disco
  function load() {
    if (!file) return;
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      entries = new Map(Object.entries(saved.entries || {}));
      since = saved.since || null;
      keyHash = saved.keyHash || null;
      blockedUntil = Number(saved.blockedUntil) || 0;
      requests = saved.requests || requests;
    } catch (_) {}
  }

  function writeNow() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const data = { since, keyHash, blockedUntil, requests, entries: Object.fromEntries(entries) };
      fs.writeFileSync(file + ".tmp", JSON.stringify(data));
      fs.renameSync(file + ".tmp", file);
    } catch (err) {
      log(`Nao foi possivel salvar o cache do RLT: ${err.message}`);
    }
  }

  // grava logo depois de mudar (varias mudancas seguidas viram uma gravacao)
  function save() {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeNow();
    }, SAVE_DELAY_MS);
    if (saveTimer.unref) saveTimer.unref();
  }

  // aplicativo fechando com gravacao pendente: grava na hora
  if (file) {
    process.on("exit", () => {
      if (!saveTimer) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      writeNow();
    });
  }

  // Dados de outra chave (outra liga) nao servem: comeca do zero.
  function useKey(apiKey) {
    const hash = apiKey ? crypto.createHash("sha256").update(String(apiKey)).digest("hex").slice(0, 16) : null;
    if (hash === keyHash) return;
    keyHash = hash;
    entries = new Map();
    since = null;
    blockedUntil = 0;
    save();
  }

  function countRequest() {
    const day = new Date(clock()).toISOString().slice(0, 10);
    if (requests.day !== day) requests = { day, count: 0 };
    requests.count += 1;
  }

  function isBlocked() {
    return clock() < blockedUntil;
  }

  // Uma requisicao de verdade. 429: bloqueia e lanca o erro.
  async function call(p) {
    if (isBlocked()) {
      const err = new Error("Limite de requisicoes do RLT atingido");
      err.status = 429;
      throw err;
    }
    countRequest();
    const res = await request(p);
    if (res.status === 429) {
      const retry = Number(res.headers && (res.headers["retry-after"] || res.headers["Retry-After"]));
      blockedUntil = clock() + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : DEFAULT_BLOCK_MS);
      lastError = "Limite de requisicoes do RLT atingido";
      save();
      const err = new Error(lastError);
      err.status = 429;
      throw err;
    }
    if (res.status < 200 || res.status >= 300) {
      const body = res.body;
      const err = new Error((body && (body.message || body.error)) || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    lastError = null;
    return res.body;
  }

  // Resposta de `p`: a guardada, se ainda vale; senao busca. Sem conseguir
  // buscar (limite, sem internet), devolve a guardada mesmo antiga.
  // maxAgeMs (opcional): a guardada so vale ate essa idade, mesmo sem aviso do
  // feed (rede de seguranca para o que o feed pode nao avisar).
  async function get(p, maxAgeMs) {
    const have = entries.get(p);
    const fresh = have && have.valid && !(maxAgeMs > 0 && clock() - have.at > maxAgeMs);
    if (fresh) return have.body;
    try {
      const body = await call(p);
      const data = body && body.data !== undefined ? body.data : body;
      entries.set(p, { body, at: clock(), valid: true, seasonId: (data && data.seasonId) || null });
      save();
      return body;
    } catch (err) {
      if (have && (err.status === 429 || !err.status)) return have.body; // limite ou rede: vale a antiga
      throw err;
    }
  }

  function invalidate(test) {
    let n = 0;
    entries.forEach((e, p) => {
      if (e.valid && test(p, e)) {
        e.valid = false;
        n++;
      }
    });
    if (n) save();
    return n;
  }

  // Marca o que uma mudanca do feed afeta.
  function applyOperation(op) {
    (op.resources || []).forEach((r) => {
      const type = String(r.type || "").toLowerCase();
      const sid = r.seasonId != null ? Number(r.seasonId) : null;
      if (sid != null) {
        // temporada: detalhe, pontuacao, lineup; os eventos dela; estatisticas (resultados)
        invalidate((p, e) => p.includes(`/seasons/${sid}`) || (p.includes("/events/") && Number(e.seasonId) === sid) || p.includes("/multiseasons") || p.includes("/tracks/"));
      }
      if (type.includes("driver") && r.id != null) invalidate((p) => p.startsWith(`/api/public/v1/drivers/${r.id}`));
      if (type.includes("event") && r.id != null) invalidate((p) => p.startsWith(`/api/public/v1/events/${r.id}`));
      if (type.includes("season") || type.includes("league")) invalidate((p) => p.startsWith("/api/public/v1/league") || p === "/api/public/v1/seasons");
      if (!sid && !type.includes("driver") && !type.includes("event") && !type.includes("season") && !type.includes("league")) {
        // tipo desconhecido sem temporada: a lista de temporadas e a liga podem ter mudado
        invalidate((p) => p.startsWith("/api/public/v1/league") || p === "/api/public/v1/seasons");
      }
    });
  }

  // A requisicao do ciclo: le o feed de mudancas desde a ultima vez e marca o
  // que precisa ser buscado de novo. Devolve quantas respostas ficaram velhas
  // (0 = nada mudou, nao precisa reler nada).
  async function checkChanges() {
    if (isBlocked()) return 0;
    const now = new Date(clock()).toISOString();
    if (!since) {
      // primeira vez: comeca a contar daqui; o que nao esta guardado e buscado normalmente
      since = now;
      save();
      return 0;
    }
    const from = new Date(Date.parse(since) - SINCE_OVERLAP_MS).toISOString();
    let body;
    try {
      body = await call(`${CHANGES_PATH}?since=${encodeURIComponent(from)}`);
    } catch (err) {
      lastError = err.message;
      return 0;
    }
    const feed = body && body.data !== undefined ? body.data : body;
    const meta = (body && body.meta) || {};
    let stale = 0;
    const before = Array.from(entries.values()).filter((e) => e.valid).length;
    if (feed && feed.gap) {
      // mudancas demais para listar: tudo e buscado de novo
      invalidate(() => true);
    } else {
      ((feed && feed.operations) || []).forEach(applyOperation);
    }
    stale = before - Array.from(entries.values()).filter((e) => e.valid).length;
    since = meta.generatedAt || now;
    save();
    return stale;
  }

  function status() {
    const valid = Array.from(entries.values()).filter((e) => e.valid).length;
    return {
      blocked: isBlocked(),
      blockedUntil: blockedUntil || null,
      lastError,
      entries: entries.size,
      valid,
      since,
      requestsToday: requests.day === new Date(clock()).toISOString().slice(0, 10) ? requests.count : 0,
    };
  }

  function clear() {
    entries = new Map();
    since = null;
    save();
  }

  load();
  return { get, checkChanges, invalidate, applyOperation, useKey, status, clear, isBlocked };
}

module.exports = { createRltCache };
