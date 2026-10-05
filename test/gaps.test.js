const test = require("node:test");
const assert = require("node:assert/strict");
const { createGapTracker, createGapSmoother } = require("../overlay/shared/gaps");

const TRACK = 4000;

// simula carros com velocidade dada por speedFn(nome, distancia) a 5 Hz
function run(tracker, cars, seconds, speedFn) {
  let now = cars.now || 0;
  for (let i = 0; i < seconds * 5; i++) {
    now += 200;
    cars.list.forEach((c) => {
      c.totalDistance += speedFn(c.name, c.totalDistance) * 0.2;
    });
    tracker.update(cars.list, now);
  }
  cars.now = now;
}

test("dois carros na mesma velocidade: gap igual a diferenca de tempo", () => {
  const t = createGapTracker();
  const cars = { list: [{ name: "A", totalDistance: 100 }, { name: "B", totalDistance: 0 }] };
  run(t, cars, 20, () => 50); // B esta 100 m atras a 50 m/s = 2.0 s
  const g = t.gap("B", "A", TRACK);
  assert.ok(Math.abs(g.sec - 2.0) < 0.05, `gap ${g.sec}`);
});

test("gap nao infla quando o carro de tras freia numa curva lenta", () => {
  const t = createGapTracker();
  const cars = { list: [{ name: "A", totalDistance: 100 }, { name: "B", totalDistance: 0 }] };
  // curva lenta entre 1000 m e 1100 m: todos passam a 20 m/s ali
  const speed = (name, d) => (d >= 1000 && d < 1100 ? 20 : 50);
  run(t, cars, 24, speed); // B no meio da curva lenta, A ja saiu dela
  const b = cars.list[1];
  assert.ok(b.totalDistance > 1000 && b.totalDistance < 1100, `B em ${b.totalDistance}`);
  const g = t.gap("B", "A", TRACK);
  // distancia/velocidade daria 70 m / 20 m/s = 3.5 s; o real segue em 2 s
  assert.ok(g.sec > 1.7 && g.sec < 2.3, `gap ${g.sec}`);
});

test("retardatario aparece em voltas", () => {
  const t = createGapTracker();
  const cars = { list: [{ name: "A", totalDistance: TRACK * 2 + 500 }, { name: "B", totalDistance: 0 }] };
  run(t, cars, 5, () => 50);
  assert.deepEqual(t.gap("B", "A", TRACK), { laps: 2 });
});

test("carro de tras empatado ou a frente em distancia mostra zero", () => {
  const t = createGapTracker();
  const cars = { list: [{ name: "A", totalDistance: 100 }, { name: "B", totalDistance: 120 }] };
  run(t, cars, 5, () => 50);
  assert.deepEqual(t.gap("B", "A", TRACK), { sec: 0 });
});

test("sem historico no ponto ainda: devolve null", () => {
  const t = createGapTracker();
  t.update([{ name: "A", totalDistance: 500 }, { name: "B", totalDistance: 100 }], 1000);
  assert.equal(t.gap("B", "A", TRACK), null);
  assert.equal(t.gap("B", "Z", TRACK), null);
});

test("gap cresce enquanto o carro de tras esta parado", () => {
  const t = createGapTracker();
  const cars = { list: [{ name: "A", totalDistance: 100 }, { name: "B", totalDistance: 0 }] };
  run(t, cars, 10, () => 50);
  run(t, cars, 10, (name) => (name === "B" ? 0 : 50)); // B para por 10 s
  const g = t.gap("B", "A", TRACK);
  assert.ok(Math.abs(g.sec - 12.0) < 0.3, `gap ${g.sec}`);
});

test("salto impossivel de distancia e ignorado", () => {
  const t = createGapTracker();
  const cars = { list: [{ name: "A", totalDistance: 100 }, { name: "B", totalDistance: 0 }] };
  run(t, cars, 10, () => 50);
  // leitura errada: A aparece uma volta inteira a frente por um ciclo
  const glitch = [{ name: "A", totalDistance: cars.list[0].totalDistance + TRACK }, cars.list[1]];
  t.update(glitch, cars.now + 100);
  run(t, cars, 2, () => 50);
  const g = t.gap("B", "A", TRACK);
  assert.ok(Math.abs(g.sec - 2.0) < 0.1, `gap ${JSON.stringify(g)}`);
});

// conta quantas vezes o numero mostrado muda ao longo de uma serie de leituras
function changes(values) {
  let n = 0;
  for (let i = 1; i < values.length; i++) if (values[i] !== values[i - 1]) n++;
  return n;
}

test("gap parado com ruido: o numero na tela nao fica piscando", () => {
  const s = createGapSmoother();
  const raw = [];
  const shown = [];
  // gap real 2.55 s (bem no limite entre 2.5 e 2.6), com ruido de +-0.04, a 8 leituras por segundo
  for (let i = 0; i < 160; i++) {
    const v = 2.55 + (i % 2 === 0 ? 0.04 : -0.04);
    raw.push(Math.round(v * 10) / 10);
    shown.push(s.value("B>A", v, i * 125));
  }
  assert.ok(changes(raw) > 100, "sem suavizar, o digito troca a cada leitura");
  assert.ok(changes(shown) <= 1, `trocas na tela: ${changes(shown)}`);
});

test("gap mudando de verdade: o numero acompanha", () => {
  const s = createGapSmoother();
  let shown = 0;
  // de 2.0 para 3.0 em 10 segundos
  for (let i = 0; i <= 80; i++) shown = s.value("B>A", 2 + i / 80, i * 125);
  assert.ok(Math.abs(shown - 3.0) <= 0.2, `mostrado ${shown}`);
});

test("salto grande (ultrapassagem, box) aparece na hora", () => {
  const s = createGapSmoother();
  for (let i = 0; i < 20; i++) s.value("B>A", 2.0, i * 125);
  assert.equal(s.value("B>A", 9.4, 20 * 125), 9.4);
});
