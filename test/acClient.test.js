const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("net");
const { createAcState, startAcClient, classFromUi } = require("../server/acClient");

function setup() {
  const clock = { t: 1000000 };
  const state = createAcState({
    clock: () => clock.t,
    readCarInfo: (root, model, skin) => ({ name: `Carro ${model}`, carClass: model === "gt3" ? "GT3" : "Street", number: skin === "s7" ? "7" : "0", team: "" }),
  });
  return { clock, state };
}

function car(id, extra) {
  return Object.assign(
    { id, name: `Piloto ${id}`, model: "gt3", skin: "", connected: 1, laps: 0, spline: 0.1, kmh: 100, lapMs: 30000, lastMs: 0, bestMs: 0, posBoard: id + 1, posRace: id, pitLane: 0, pitBox: 0, finished: 0, invalid: 0, lastSplits: null, curSplits: null },
    extra
  );
}

function msg(cars, extra) {
  return Object.assign({ v: 1, root: "X:\\ac", track: "ks_vallelunga", config: "extended_circuit", length: 4000, focused: 0, cars }, extra);
}

const byName = (p, id) => p.standings.find((e) => e.slot === id);

test("classe do carro: etiqueta com # primeiro, depois o campo class", () => {
  assert.equal(classFromUi('{"tags": ["#Sportscars", "rwd"], "class": "street"}'), "Sportscars");
  assert.equal(classFromUi('{"tags": ["rwd", "manual"],\n "class": "race"}'), "Race");
  assert.equal(classFromUi('{"name": "x"}'), "");
  // texto com quebra de linha dentro (JSON invalido) nao atrapalha
  assert.equal(classFromUi('{"description": "linha 1\nlinha 2", "tags": ["#GT3"]}'), "GT3");
});

test("sem aviso do listener assume treino e usa a tabela de tempos do jogo", () => {
  const { state } = setup();
  const p = state.frame(msg([car(0, { posBoard: 2, bestMs: 91000 }), car(1, { posBoard: 1, bestMs: 90000 })]));
  assert.equal(p.game, "ac");
  assert.equal(p.session.state, 1);
  assert.deepEqual(p.standings.map((e) => e.slot), [1, 0]);
  assert.equal(p.standings[0].position, 1);
  assert.equal(p.standings[0].fastestLapMs, 90000);
  assert.equal(p.standings[0].lastLapMs, null);
  assert.equal(byName(p, 0).isPlayer, true);
  assert.equal(byName(p, 0).carClass, "GT3");
  assert.equal(byName(p, 0).carNumber, null); // "0" nao e numero de corrida
});

test("sessao, tempo restante e voltas vem do listener", () => {
  const { state } = setup();
  state.setStatus({ status: 2, session: 1, timeLeftMs: 600400, laps: 0, timed: false });
  let p = state.frame(msg([car(0)]));
  assert.equal(p.session.state, 3);
  assert.equal(p.session.timeRemainingSec, 600);
  state.setStatus({ status: 2, session: 2, timeLeftMs: 0, laps: 12, timed: false });
  p = state.frame(msg([car(0)]));
  assert.equal(p.session.state, 5);
  assert.equal(p.session.lapsInEvent, 12);
  assert.equal(p.session.timeRemainingSec, 0);
  state.setStatus({ status: 2, session: 2, timeLeftMs: 90000, laps: 0, timed: true });
  p = state.frame(msg([car(0)]));
  assert.equal(p.session.lapsInEvent, 0);
  assert.equal(p.session.timeRemainingSec, 90);
});

test("jogo fora de sessao limpa a tabela; aviso antigo deixa de valer", () => {
  const { clock, state } = setup();
  state.setStatus({ status: 0, session: 2 });
  assert.equal(state.frame(msg([car(0)])).standings.length, 0);
  clock.t += 5000; // listener parou de avisar
  const p = state.frame(msg([car(0)]));
  assert.equal(p.standings.length, 1);
  assert.equal(p.session.state, 1);
});

test("vaga vazia do servidor online nao aparece", () => {
  const { state } = setup();
  const p = state.frame(msg([car(0), car(1, { connected: 0 }), car(2, { name: "" })]));
  assert.deepEqual(p.standings.map((e) => e.slot), [0]);
});

test("box, parciais e velocidade maxima", () => {
  const { state } = setup();
  let p = state.frame(msg([car(0, { pitBox: 1, pitLane: 1, kmh: 0 }), car(1, { pitLane: 1, kmh: 60 })]));
  assert.equal(byName(p, 0).pitMode, 4);
  assert.equal(byName(p, 1).pitMode, 2);
  p = state.frame(msg([car(0, { kmh: 210.5, lastSplits: [30000, 31000, 32000], curSplits: [29500, 0, 0] }), car(1, { kmh: 40 })]));
  const e = byName(p, 0);
  assert.equal(e.pitMode, 0);
  assert.equal(e.sector1Ms, 29500);
  assert.equal(e.sector2Ms, null);
  assert.equal(e.currentSector, 1);
  assert.equal(e.sector3Ms, 32000);
  assert.deepEqual([e.bestSector1Ms, e.bestSector2Ms, e.bestSector3Ms], [30000, 31000, 32000]);
  assert.equal(byName(p, 1).maxSpeedKmh, 60);
  assert.equal(e.maxSpeedKmh, 210.5);
});

test("largada: carro antes da linha nao ganha uma volta de distancia", () => {
  const { state } = setup();
  state.setStatus({ status: 2, session: 2, timeLeftMs: 0, laps: 5, timed: false });
  let p = state.frame(msg([car(0, { spline: 0.99, lapMs: 0, kmh: 0 }), car(1, { spline: 0.98, lapMs: 0, kmh: 0, posRace: 1 })]));
  assert.ok(byName(p, 0).totalDistance < 0);
  assert.ok(byName(p, 0).totalDistance > byName(p, 1).totalDistance);
  // cruzou a linha: passa a contar normalmente
  p = state.frame(msg([car(0, { spline: 0.02, lapMs: 1500 }), car(1, { spline: 0.99, lapMs: 0, posRace: 1 })]));
  assert.equal(Math.round(byName(p, 0).totalDistance), 80);
  assert.ok(byName(p, 1).totalDistance < 0);
});

test("corrida: vale a distancia, mesmo com a posicao do jogo embaralhada (grid)", () => {
  const { state } = setup();
  state.setStatus({ status: 2, session: 2, timeLeftMs: 0, laps: 5, timed: false });
  const p = state.frame(msg([car(0, { posRace: 1, spline: 0.97, lapMs: 0, kmh: 0 }), car(1, { posRace: 2, spline: 0.99, lapMs: 0, kmh: 0 }), car(2, { posRace: 0, spline: 0.98, lapMs: 0, kmh: 0 })]));
  assert.deepEqual(p.standings.map((e) => e.slot), [1, 2, 0]);
});

test("corrida: empate na distancia segue a posicao do jogo", () => {
  const { state } = setup();
  state.setStatus({ status: 2, session: 2, timeLeftMs: 0, laps: 5, timed: false });
  const p = state.frame(msg([car(0, { posRace: 2 }), car(1, { posRace: 0 }), car(2, { posRace: 1 })]));
  assert.deepEqual(p.standings.map((e) => [e.slot, e.position]), [[1, 1], [2, 2], [0, 3]]);
  assert.equal(p.standings[0].inRace, true);
});

test("corrida: sem posicoes validas do jogo, ordena pela distancia", () => {
  const { state } = setup();
  state.setStatus({ status: 2, session: 2, timeLeftMs: 0, laps: 5, timed: false });
  const p = state.frame(msg([car(0, { posRace: null, laps: 2, spline: 0.2 }), car(1, { posRace: null, laps: 2, spline: 0.6 }), car(2, { posRace: null, laps: 1, spline: 0.9 })]));
  assert.deepEqual(p.standings.map((e) => e.slot), [1, 0, 2]);
});

test("bandeirada: quem terminou fica congelado mesmo se o jogo mudar a ordem", () => {
  const { state } = setup();
  state.setStatus({ status: 2, session: 2, timeLeftMs: 0, laps: 5, timed: false });
  const lap = (a, b, c) => msg([car(0, a), car(1, b), car(2, c)]);
  state.frame(lap({ posRace: 0, laps: 4, spline: 0.9 }, { posRace: 1, laps: 4, spline: 0.8 }, { posRace: 2, laps: 3, spline: 0.95 }));
  // lider cruza a linha e termina; o retardatario cruza logo depois
  let p = state.frame(lap({ posRace: 0, laps: 5, spline: 0.01, finished: 1 }, { posRace: 1, laps: 4, spline: 0.9 }, { posRace: 2, laps: 4, spline: 0.02, finished: 1 }));
  assert.equal(byName(p, 0).raceState, 3);
  assert.equal(byName(p, 2).raceState, 3);
  assert.equal(byName(p, 1).raceState, 2);
  // depois da bandeirada o jogo embaralha a ordem (carros passeando)
  p = state.frame(lap({ posRace: 2, laps: 5, spline: 0.1, finished: 1 }, { posRace: 0, laps: 5, spline: 0.01, finished: 1 }, { posRace: 1, laps: 4, spline: 0.5, finished: 1 }));
  assert.deepEqual(p.standings.map((e) => e.slot), [0, 1, 2]);
});

test("sessao reiniciada zera o que foi guardado", () => {
  const { state } = setup();
  state.setStatus({ status: 2, session: 2, timeLeftMs: 0, laps: 5, timed: false });
  state.frame(msg([car(0, { laps: 5, finished: 1, kmh: 200 }), car(1, { posRace: 1, laps: 4 })]));
  const p = state.frame(msg([car(0, { posRace: 1, laps: 0, kmh: 50 }), car(1, { posRace: 0, laps: 0 })]));
  assert.deepEqual(p.standings.map((e) => e.slot), [1, 0]);
  assert.equal(byName(p, 0).maxSpeedKmh, 50);
});

test("recebe as linhas do app do jogo pelo pipe e limpa a tabela quando ele sai", async () => {
  const pipe = `\\\\.\\pipe\\llg-overlay-ac-test-${process.pid}`;
  const got = [];
  const client = startAcClient((p) => got.push(p), { pipe, readCarInfo: () => ({}) });
  try {
    await new Promise((r) => setTimeout(r, 100));
    const sock = net.connect(pipe);
    await new Promise((resolve, reject) => sock.once("connect", resolve).once("error", reject));
    const line = JSON.stringify(msg([car(0, { model: "ks_ferrari_488_gt3" })])) + "\n";
    // uma linha partida em dois pedacos e outra inteira
    sock.write(line.slice(0, 40));
    await new Promise((r) => setTimeout(r, 30));
    sock.write(line.slice(40) + line);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(got.length, 2);
    assert.equal(got[0].standings[0].carName, "Ferrari 488 Gt3");
    sock.end();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(got.length, 3);
    assert.equal(got[2].standings.length, 0);
    assert.equal(got[2].session.trackLocation, "ks_vallelunga");
  } finally {
    client.stop();
  }
});
