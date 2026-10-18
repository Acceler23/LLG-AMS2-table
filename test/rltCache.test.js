const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRltCache } = require("../server/rltCache");

// API falsa: conta as requisicoes; `changes` e o que o feed devolve
function fakeApi() {
  const api = { calls: [], changes: { operations: [] }, status: 200, retryAfter: null, version: 1 };
  api.request = async (p) => {
    api.calls.push(p);
    if (api.status === 429) return { status: 429, headers: api.retryAfter ? { "retry-after": String(api.retryAfter) } : {}, body: null };
    if (p.startsWith("/api/public/v1/database/changes")) return { status: 200, headers: {}, body: { data: api.changes, meta: { generatedAt: new Date(api.now()).toISOString() } } };
    const eventId = (p.match(/events\/(\d+)/) || [])[1];
    return { status: 200, headers: {}, body: { data: { path: p, v: api.version, seasonId: eventId ? 38 : undefined } } };
  };
  return api;
}

function setup(file) {
  const clock = { t: Date.parse("2026-10-17T12:00:00Z") };
  const api = fakeApi();
  api.now = () => clock.t;
  const cache = createRltCache({ file, request: api.request, clock: () => clock.t });
  return { clock, api, cache };
}

const S = "/api/public/v1/seasons/38";
const E = "/api/public/v1/events/193";
const D = "/api/public/v1/drivers/7";

test("resposta guardada nao gasta requisicao; o ciclo sem mudancas gasta so uma", async () => {
  const { api, cache } = setup(null);
  await cache.get(S);
  await cache.get(S);
  assert.equal(api.calls.length, 1);
  assert.equal(await cache.checkChanges(), 0); // primeira vez: so marca o inicio, sem requisicao
  assert.equal(api.calls.length, 1);
  assert.equal(await cache.checkChanges(), 0); // nada mudou: 1 requisicao (o feed)
  await cache.get(S);
  assert.equal(api.calls.length, 2);
});

test("mudanca na temporada: rele a temporada e os eventos dela, nao o resto", async () => {
  const { api, cache } = setup(null);
  await cache.get(S);
  await cache.get(E);
  await cache.get(D);
  await cache.get("/api/public/v1/seasons/40");
  await cache.checkChanges();
  api.changes = { operations: [{ id: 1, resources: [{ type: "SessionResult", id: 99, seasonId: 38 }] }] };
  assert.equal(await cache.checkChanges(), 2); // temporada 38 e o evento dela
  api.calls.length = 0;
  await cache.get(S);
  await cache.get(E);
  await cache.get(D);
  await cache.get("/api/public/v1/seasons/40");
  assert.deepEqual(api.calls, [S, E]);
});

test("piloto editado: rele so o perfil dele; gap no feed rele tudo", async () => {
  const { api, cache } = setup(null);
  await cache.get(S);
  await cache.get(D);
  await cache.checkChanges();
  api.changes = { operations: [{ id: 2, resources: [{ type: "Driver", id: 7 }] }] };
  await cache.checkChanges();
  api.calls.length = 0;
  await cache.get(S);
  await cache.get(D);
  assert.deepEqual(api.calls, [D]);
  api.changes = { gap: true, operations: [] };
  await cache.checkChanges();
  api.calls.length = 0;
  await cache.get(S);
  await cache.get(D);
  assert.deepEqual(api.calls, [S, D]);
});

test("idade maxima: rede de seguranca para o que o feed nao avisa", async () => {
  const { clock, api, cache } = setup(null);
  await cache.get(D, 5 * 60 * 1000);
  clock.t += 4 * 60 * 1000;
  await cache.get(D, 5 * 60 * 1000);
  assert.equal(api.calls.length, 1);
  clock.t += 2 * 60 * 1000;
  await cache.get(D, 5 * 60 * 1000);
  assert.equal(api.calls.length, 2);
});

test("limite estourado (429): para de chamar e usa o guardado ate liberar", async () => {
  const { clock, api, cache } = setup(null);
  const first = await cache.get(S);
  await cache.checkChanges();
  api.changes = { gap: true };
  api.status = 429;
  api.retryAfter = 600;
  await cache.checkChanges(); // 429 no feed: bloqueia
  assert.equal(cache.status().blocked, true);
  api.calls.length = 0;
  cache.invalidate(() => true);
  assert.deepEqual(await cache.get(S), first); // guardado, mesmo velho
  await assert.rejects(cache.get("/api/public/v1/seasons/99"), (e) => e.status === 429); // nunca buscado: erro
  await cache.checkChanges();
  assert.equal(api.calls.length, 0); // bloqueado: nenhuma requisicao
  clock.t += 601 * 1000;
  api.status = 200;
  await cache.get(S);
  assert.equal(api.calls.length, 1);
});

test("fica salvo em disco e vale depois de reabrir; outra chave comeca do zero", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llg-rltcache-"));
  const file = path.join(dir, "rlt-cache.json");
  try {
    const a = setup(file);
    a.cache.useKey("chave-1");
    await a.cache.get(S);
    await new Promise((r) => setTimeout(r, 800)); // gravacao atrasada
    const b = setup(file);
    b.cache.useKey("chave-1");
    await b.cache.get(S);
    assert.equal(b.api.calls.length, 0);
    b.cache.useKey("chave-2");
    await b.cache.get(S);
    assert.equal(b.api.calls.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
