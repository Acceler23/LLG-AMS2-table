const test = require("node:test");
const assert = require("node:assert/strict");
const { createBattleDetector, battleWindowStart } = require("../overlay/shared/battles");

const cars = (...names) => names.map((name) => (name ? { name } : null));
// gaps: { "tras>frente": segundos }
const gapsFrom = (gaps) => (behind, ahead) => (`${behind.name}>${ahead.name}` in gaps ? gaps[`${behind.name}>${ahead.name}`] : null);
const sorted = (set) => Array.from(set).sort();

// roda o detector por `seconds` segundos, uma leitura a cada 0,5 s, a partir de t.ms
function run(d, t, seconds, order, gaps) {
  let names = new Set();
  for (let k = 0; k < seconds * 2; k++) {
    t.ms += 500;
    names = d.update(order, gapsFrom(gaps), t.ms);
  }
  return names;
}

test("disputa: so depois de 10 s seguidos com menos de 0,3 s", () => {
  const d = createBattleDetector();
  const t = { ms: 0 };
  const order = cars("A", "B", "C", "D");
  const gaps = { "B>A": 0.25, "C>B": 1.2, "D>C": 0.31 };
  assert.equal(run(d, t, 9, order, gaps).size, 0); // 9 s: ainda nao
  assert.deepEqual(sorted(run(d, t, 2, order, gaps)), ["A", "B"]); // passou de 10 s
});

test("aproximacao passageira nao vira disputa: a contagem recomeca", () => {
  const d = createBattleDetector();
  const t = { ms: 0 };
  const order = cars("A", "B");
  run(d, t, 8, order, { "B>A": 0.2 });
  run(d, t, 1, order, { "B>A": 0.6 }); // abriu antes dos 10 s
  assert.equal(run(d, t, 8, order, { "B>A": 0.2 }).size, 0); // 8 s desde que voltou
  assert.equal(run(d, t, 3, order, { "B>A": 0.2 }).size, 2);
});

test("so deixa de ser disputa depois de 5 s seguidos fora", () => {
  const d = createBattleDetector();
  const t = { ms: 0 };
  const order = cars("A", "B");
  run(d, t, 11, order, { "B>A": 0.2 });
  assert.equal(run(d, t, 4, order, { "B>A": 0.8 }).size, 2); // 4 s fora: continua
  assert.equal(run(d, t, 1, order, { "B>A": 0.2 }).size, 2); // voltou a colar
  assert.equal(run(d, t, 4, order, { "B>A": 0.8 }).size, 2); // a contagem de saida recomecou
  assert.equal(run(d, t, 2, order, { "B>A": 0.8 }).size, 0); // 6 s seguidos fora
  assert.equal(run(d, t, 5, order, { "B>A": 0.2 }).size, 0); // para voltar, 10 s de novo
});

test("ultrapassagem no meio da briga nao zera a contagem", () => {
  const d = createBattleDetector();
  const t = { ms: 0 };
  run(d, t, 6, cars("A", "B"), { "B>A": 0.2 });
  // B passou A
  assert.equal(run(d, t, 5, cars("B", "A"), { "A>B": 0.2 }).size, 2);
});

test("tres carros colados formam uma disputa so", () => {
  const d = createBattleDetector();
  const t = { ms: 0 };
  assert.deepEqual(sorted(run(d, t, 11, cars("A", "B", "C"), { "B>A": 0.1, "C>B": 0.2 })), ["A", "B", "C"]);
});

test("sem intervalo medido, ou com buraco na ordem, nao ha disputa", () => {
  const d = createBattleDetector();
  const t = { ms: 0 };
  assert.equal(run(d, t, 12, cars("A", "B"), {}).size, 0);
  // B esta no box (fora da lista): A e C nao sao vizinhos de verdade
  assert.equal(run(d, t, 12, cars("A", null, "C"), { "C>A": 0.1 }).size, 0);
  // um carro da disputa entra no box: ela acaba depois dos 5 s
  run(d, t, 11, cars("A", "B"), { "B>A": 0.2 });
  assert.equal(run(d, t, 4, cars("A", null), {}).size, 2);
  assert.equal(run(d, t, 2, cars("A", null), {}).size, 0);
});

test("parte rotativa: trava na disputa", () => {
  const f = (s) => s.split("").map((c) => c === "x");
  assert.equal(battleWindowStart(f("......"), 3, 0), null); // sem disputa: rodizio normal
  assert.equal(battleWindowStart(f("..xx...."), 4, 0), 2); // comeca na disputa
  assert.equal(battleWindowStart(f("..xx...."), 4, 7), 2); // e fica la, nao roda
  assert.equal(battleWindowStart(f("......xx"), 4, 0), 4); // no fim: nao passa do ultimo carro
  assert.equal(battleWindowStart(f("xx"), 5, 0), 0); // cabe tudo
});

test("parte rotativa: varias disputas que nao cabem juntas se alternam", () => {
  const f = (s) => s.split("").map((c) => c === "x");
  const flags = f("xx......xx..");
  assert.equal(battleWindowStart(flags, 4, 0), 0);
  assert.equal(battleWindowStart(flags, 4, 1), 8);
  assert.equal(battleWindowStart(flags, 4, 2), 0);
  // duas disputas que cabem na mesma janela: uma janela so
  assert.equal(battleWindowStart(f(".xx.xx....."), 6, 0), 1);
  assert.equal(battleWindowStart(f(".xx.xx....."), 6, 1), 1);
});

test("so o piloto assistido: devolve apenas as disputas em que ele esta", () => {
  const d = createBattleDetector({ gap: 0.5 });
  const t = { ms: 0 };
  // A-B colados, C sozinho, D-E-F colados; o limite aqui e 0,5 s
  run(d, t, 11, cars("A", "B", "C", "D", "E", "F"), { "B>A": 0.4, "C>B": 2, "D>C": 2, "E>D": 0.45, "F>E": 0.2 });
  assert.deepEqual(sorted(d.namesWith("E")), ["D", "E", "F"]); // briga com o da frente e o de tras
  assert.deepEqual(sorted(d.namesWith("A")), ["A", "B"]);
  assert.equal(d.namesWith("C").size, 0); // ele nao esta em disputa
  assert.equal(d.namesWith("Ninguem").size, 0);
});
