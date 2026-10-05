const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("dgram");
const { startAccClient, sessionState } = require("../server/accClient");

const INT32_MAX = 2147483647;

// ---- montagem dos pacotes que o ACC manda (protocolo de transmissao v4) ----
const u8 = (v) => Buffer.from([v]);
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; };
const str = (t) => { const b = Buffer.from(t, "utf8"); return Buffer.concat([u16(b.length), b]); };
const lap = (ms, splits) =>
  Buffer.concat([i32(ms == null ? INT32_MAX : ms), u16(0), u16(0), u8(3), ...splits.map((s) => i32(s == null ? INT32_MAX : s)), u8(0), u8(1), u8(0), u8(0)]);

const CARS = [
  { index: 7, model: 25, team: "Brabulls", number: 23, first: "Ronaldo", last: "Junior", position: 2, spline: 0.25, laps: 3, location: 1, kmh: 180 },
  { index: 3, model: 59, team: "Garage 59", number: 59, first: "Ben", last: "Green", position: 1, spline: 0.5, laps: 3, location: 2, kmh: 60 },
];

function entryCar(c) {
  return Buffer.concat([u8(6), u16(c.index), u8(c.model), str(c.team), i32(c.number), u8(0), u8(0), u16(0), u8(1), str(c.first), str(c.last), str("ABC"), u8(0), u16(0)]);
}
function carUpdate(c) {
  return Buffer.concat([
    u8(3), u16(c.index), u16(0), u8(1), u8(4), f32(0), f32(0), f32(0), u8(c.location), u16(c.kmh), u16(c.position), u16(1), u16(1),
    f32(c.spline), u16(c.laps), i32(0), lap(100000, [30000, 40000, 30000]), lap(101000, [30500, 40000, 30500]), lap(null, [30200, null, null]),
  ]);
}
function realtimeUpdate(focused, phase) {
  return Buffer.concat([u8(2), u16(0), u16(1), u8(10), u8(phase), f32(600000), f32(1200000), i32(focused), str("set"), str("cam"), str("hud"), u8(0), f32(0), u8(20), u8(25), u8(0), u8(0), u8(0), lap(null, [null, null, null])]);
}

// ACC de mentira: so comeca a responder depois de `readyAfterMs`, como o jogo
// real, que ignora tudo enquanto esta no menu.
function fakeAcc(readyAfterMs) {
  const server = dgram.createSocket("udp4");
  const state = { phase: 5 }; // 5 = corrida em andamento, 6 = tempo esgotado
  const cars = CARS.map((c) => Object.assign({}, c)); // copia que o teste pode alterar
  const startedAt = Date.now();
  const clients = new Map();
  let unregistered = false;
  const unregisteredIds = [];
  let registers = 0;
  let timer = null;
  server.on("message", (msg, rinfo) => {
    if (msg[0] === 1) registers++;
    if (Date.now() - startedAt < readyAfterMs) return; // "no menu"
    const reply = (buf) => server.send(buf, rinfo.port, rinfo.address);
    if (msg[0] === 1) {
      clients.set(rinfo.port, rinfo);
      reply(Buffer.concat([u8(1), i32(42), u8(1), u8(1), str("")]));
    } else if (msg[0] === 10) {
      reply(Buffer.concat([u8(4), i32(42), u16(CARS.length), ...CARS.map((c) => u16(c.index))]));
      CARS.forEach((c) => reply(entryCar(c)));
    } else if (msg[0] === 11) {
      reply(Buffer.concat([u8(5), i32(42), str("Barcelona"), i32(1), i32(4655), u8(0)]));
    } else if (msg[0] === 9) {
      unregistered = true;
      unregisteredIds.push(msg.readInt32LE(1));
      clients.delete(rinfo.port);
    }
  });
  timer = setInterval(() => {
    clients.forEach((c) => {
      cars.forEach((car) => server.send(carUpdate(car), c.port, c.address));
      server.send(realtimeUpdate(7, state.phase), c.port, c.address);
    });
  }, 50);
  return new Promise((resolve) =>
    server.bind(0, "127.0.0.1", () =>
      resolve({
        port: server.address().port,
        state,
        cars,
        wasUnregistered: () => unregistered,
        registers: () => registers,
        unregisteredIds: () => unregisteredIds,
        close: () => { clearInterval(timer); server.close(); },
      })
    )
  );
}

test("sessao do ACC vira os mesmos codigos dos outros jogos", () => {
  assert.equal(sessionState(0, 5), 1); // treino
  assert.equal(sessionState(4, 5), 3); // classificacao
  assert.equal(sessionState(10, 5), 5); // corrida
  assert.equal(sessionState(10, 3), 4); // volta de formacao
  assert.equal(sessionState(11, 5), 6); // hotlap
});

test("monta o payload no formato comum, rapido ao abrir a sessao e sem repetir pedidos", async () => {
  const READY_AFTER = 1500;
  const acc = await fakeAcc(READY_AFTER);
  let client;
  let readyAt = 0;
  const payload = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("sem dados do ACC simulado")), 8000);
    client = startAccClient((p) => {
      if (p.standings.length === CARS.length) {
        clearTimeout(timeout);
        resolve(p);
      }
    }, { port: acc.port, password: "asd" });
    // o listener avisa: jogo no menu... e depois, sessao aberta
    client.setGameLive(false);
    setTimeout(() => {
      // no menu o cliente nao fica repetindo o pedido de registro
      assert.ok(acc.registers() <= 1, `pedidos de registro no menu: ${acc.registers()}`);
      readyAt = Date.now();
      client.setGameLive(true);
    }, READY_AFTER + 100);
  });
  const waited = Date.now() - readyAt;
  // um unico pedido de registro bastou depois que a sessao abriu
  assert.ok(acc.registers() <= 2, `pedidos de registro no total: ${acc.registers()}`);

  assert.equal(payload.game, "acc");
  assert.equal(payload.session.state, 5);
  assert.equal(payload.session.trackLocation, "Barcelona");
  assert.equal(payload.session.trackLength, 4655);
  assert.equal(payload.session.timeRemainingSec, 1200);

  const [first, second] = payload.standings;
  assert.equal(first.position, 1);
  assert.equal(first.name, "Ben Green");
  assert.equal(first.carName, "McLaren 570S GT4");
  assert.equal(first.carClass, "GT4");
  assert.equal(first.pitMode, 2); // no pit lane
  assert.equal(second.name, "Ronaldo Junior");
  assert.equal(second.teamName, "Brabulls");
  assert.equal(second.carNumber, "23");
  assert.equal(second.carClass, "GT3");
  assert.equal(second.isPlayer, true); // carro em foco
  assert.equal(first.isPlayer, false);
  assert.equal(second.lapsCompleted, 3);
  assert.ok(Math.abs(second.totalDistance - 3.25 * 4655) < 1);
  assert.equal(second.fastestLapMs, 100000);
  assert.equal(second.lastLapMs, 101000);
  assert.equal(second.sector1Ms, 30200); // setor 1 da volta atual
  assert.equal(second.currentSector, 1);
  assert.equal(second.sector3Ms, 30500); // S3 da ultima volta, fora do 3o setor
  assert.deepEqual([second.bestSector1Ms, second.bestSector2Ms, second.bestSector3Ms], [30000, 40000, 30000]);

  // depois que o jogo passou a responder, os dados chegam em menos de 1 segundo
  assert.ok(waited < 1000, `demorou ${waited} ms depois do jogo pronto`);

  client.stop();
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(acc.wasUnregistered(), true); // avisa o jogo ao sair
  acc.close();
});

// Roda um cenario de fim de corrida no ACC simulado e sempre encerra o
// cliente e o servidor falso, mesmo quando uma verificacao falha.
async function finishScenario(run) {
  const acc = await fakeAcc(0);
  let latest = null;
  const client = startAccClient((p) => { latest = p; }, { port: acc.port, password: "asd" });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const finished = () => Object.fromEntries(latest.standings.map((e) => [e.name, e.raceState === 3]));
  try {
    await run({ acc, wait, finished, standings: () => latest.standings });
  } finally {
    client.stop();
    await wait(200);
    acc.close();
  }
}

// carros do simulador: Ben Green lidera (3 voltas e meia); Ronaldo Junior e o outro
const put = (car, laps, spline) => { car.laps = laps; car.spline = spline; };

test("bandeirada: tempo esgotado nao termina ninguem; so depois que o lider cruza a linha", () =>
  finishScenario(async ({ acc, wait, finished }) => {
    const leader = acc.cars.find((c) => c.position === 1);
    const lapped = acc.cars.find((c) => c.position === 2);
    put(leader, 3, 0.5); // 3,50 voltas
    put(lapped, 2, 0.95); // 2,95 voltas: retardatario prestes a cruzar a linha
    await wait(600);
    assert.deepEqual(finished(), { "Ben Green": false, "Ronaldo Junior": false });

    // o tempo zera: ultima volta, todo mundo ainda correndo
    acc.state.phase = 6;
    await wait(400);
    assert.deepEqual(finished(), { "Ben Green": false, "Ronaldo Junior": false });

    // o retardatario cruza a linha ANTES do lider: continua correndo
    put(lapped, 3, 0.02);
    await wait(400);
    assert.deepEqual(finished(), { "Ben Green": false, "Ronaldo Junior": false });

    // o lider cruza a linha: bandeirada so para ele
    put(leader, 4, 0.02);
    await wait(400);
    assert.deepEqual(finished(), { "Ben Green": true, "Ronaldo Junior": false });

    // o outro completa a volta: terminou tambem
    put(lapped, 4, 0.02);
    await wait(400);
    assert.deepEqual(finished(), { "Ben Green": true, "Ronaldo Junior": true });
  }));

test("bandeirada: funciona mesmo conectando com o tempo ja esgotado", async () => {
  const acc = await fakeAcc(0);
  acc.state.phase = 6; // o servidor foi aberto na ultima volta
  let latest = null;
  const client = startAccClient((p) => { latest = p; }, { port: acc.port, password: "asd" });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const finished = () => Object.fromEntries(latest.standings.map((e) => [e.name, e.raceState === 3]));
  const leader = acc.cars.find((c) => c.position === 1);
  try {
    await wait(600);
    assert.deepEqual(finished(), { "Ben Green": false, "Ronaldo Junior": false });
    put(leader, leader.laps + 1, 0.02);
    await wait(400);
    assert.deepEqual(finished(), { "Ben Green": true, "Ronaldo Junior": false });
  } finally {
    client.stop();
    await wait(200);
    acc.close();
  }
});

// O caso visto numa corrida real com parada obrigatoria: o tempo zerou, um
// carro cruzou a linha em 5o, e so depois virou lider porque os da frente
// pararam no box. A bandeirada so veio quando ele completou a volta seguinte.
test("bandeirada: quem assume a lideranca depois de cruzar a linha precisa cruzar de novo", () =>
  finishScenario(async ({ acc, wait, finished, standings }) => {
    const leader = acc.cars.find((c) => c.position === 1); // Ben Green
    const chaser = acc.cars.find((c) => c.position === 2); // Ronaldo Junior
    put(leader, 3, 0.5); // 3,50 voltas
    put(chaser, 2, 0.9); // 2,90 voltas
    await wait(600);
    acc.state.phase = 6; // tempo esgotado
    await wait(400);

    // o perseguidor cruza a linha, ainda atras do lider
    put(chaser, 3, 0.05); // 3,05
    await wait(400);
    assert.deepEqual(finished(), { "Ben Green": false, "Ronaldo Junior": false });

    // o lider para no box e o perseguidor passa a liderar. Ter cruzado a
    // linha antes de ser lider nao vale como bandeirada.
    put(chaser, 3, 0.7); // 3,70 > 3,50
    await wait(400);
    assert.equal(standings()[0].name, "Ronaldo Junior"); // lider ao vivo, pela distancia
    assert.deepEqual(finished(), { "Ben Green": false, "Ronaldo Junior": false });

    // agora sim: o novo lider completa a volta
    put(chaser, 4, 0.02);
    await wait(400);
    assert.deepEqual(finished(), { "Ben Green": false, "Ronaldo Junior": true });

    assert.equal(standings()[0].name, "Ronaldo Junior"); // vencedor em 1o

    // o antigo lider cruza a linha depois da bandeirada: terminou, em 2o
    put(leader, 4, 0.02);
    await wait(400);
    assert.deepEqual(finished(), { "Ben Green": true, "Ronaldo Junior": true });
    assert.deepEqual(standings().map((e) => [e.position, e.name]), [[1, "Ronaldo Junior"], [2, "Ben Green"]]);

    // na volta de desaceleracao o 2o anda mais que o vencedor: a ordem nao muda
    put(leader, 4, 0.6);
    await wait(400);
    assert.deepEqual(standings().map((e) => [e.position, e.name]), [[1, "Ronaldo Junior"], [2, "Ben Green"]]);
  }));
