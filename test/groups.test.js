const test = require("node:test");
const assert = require("node:assert/strict");
const { createGrouper } = require("../overlay/shared/groups");

const cup = (name, position, carName, startPosition) => ({
  name,
  position,
  startPosition,
  carClass: "Carrera Cup",
  carName,
});

test("classe dividida por carro: posicao dentro do proprio modelo", () => {
  const g = createGrouper({ splitClasses: ["Carrera Cup"] });
  const s = [cup("A", 1, "Cup 4.0", 2), cup("B", 2, "Cup 3.8", 3), cup("C", 3, "Cup 4.0", 1), cup("D", 4, "Cup 3.8", 4)];
  assert.equal(g.isSplitByCar(s), true);
  assert.equal(g.position(s[3], s), 2); // D e o 2o dos 3.8
  assert.equal(g.position(s[2], s), 2); // C e o 2o dos 4.0
  assert.equal(g.startPosition(s[2], s), 1); // C largou em 1o dos 4.0
  assert.equal(g.startPosition(s[0], s), 2);
});

test("classe fora da lista nao e dividida", () => {
  const g = createGrouper({ splitClasses: ["Carrera Cup"] });
  const s = [
    { name: "A", position: 1, carClass: "GT3", carName: "X" },
    { name: "B", position: 2, carClass: "GT3", carName: "Y" },
  ];
  assert.equal(g.isSplitByCar(s), false);
  assert.equal(g.position(s[1], s), 2);
});

test("multiclasse do jogo: agrupa por carClass", () => {
  const g = createGrouper({ splitClasses: ["Carrera Cup"] });
  const s = [
    { name: "A", position: 1, carClass: "GT3", carName: "X" },
    { name: "B", position: 2, carClass: "GT4", carName: "Y" },
    { name: "C", position: 3, carClass: "GT4", carName: "Z" },
  ];
  assert.equal(g.position(s[2], s), 2);
  assert.equal(g.key(s[0], s), "GT3");
});

test("com temporada do RLT a classe vem do piloto, e desconhecido vira —", () => {
  const classes = { A: { uniqueName: "pro" }, B: { uniqueName: "am" }, C: { uniqueName: "am" } };
  const g = createGrouper({
    rltEnabled: () => true,
    lookup: (e) => classes[e.name] || null,
    splitClasses: ["Carrera Cup"],
  });
  const s = [cup("A", 1, "Cup 4.0"), cup("B", 2, "Cup 4.0"), cup("C", 3, "Cup 3.8"), cup("X", 4, "Cup 3.8")];
  assert.equal(g.isSplitByCar(s), false);
  assert.equal(g.position(s[2], s), 2);
  assert.equal(g.key(s[3], s), "—");
});

test("sem posicao de largada devolve null", () => {
  const g = createGrouper({});
  const s = [{ name: "A", position: 1, carClass: "GT3", startPosition: null }];
  assert.equal(g.startPosition(s[0], s), null);
});
