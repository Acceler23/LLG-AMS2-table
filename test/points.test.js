const test = require("node:test");
const assert = require("node:assert/strict");
const points = require("../overlay/shared/points");

points.setConfig({
  bySeason: { "Temporada X": [10, 6, 4, 2, 1] },
  fallback: [25, 18, 15, 12, 10],
});

test("tabela de pontos: da temporada, senao a padrao", () => {
  assert.deepEqual(points.pointsTable({ seasonName: "Temporada X" }), [10, 6, 4, 2, 1]);
  assert.deepEqual(points.pointsTable({ seasonName: "Outra", seasonId: 9 }), [25, 18, 15, 12, 10]);
  assert.equal(points.pointsForPosition(2, [10, 6, 4]), 6);
  assert.equal(points.pointsForPosition(9, [10, 6, 4]), 0);
  assert.equal(points.pointsForPosition(null, [10, 6, 4]), 0);
});

test("projecao soma os pontos da corrida e recalcula o ranking", () => {
  const rows = [
    { displayName: "A", pointsRaw: 100 },
    { displayName: "B", pointsRaw: 95 },
    { displayName: "C", pointsRaw: 60 },
  ];
  const racePos = { A: 3, B: 1 }; // C fora da corrida
  const out = points.project(rows, {
    inRace: true,
    table: [10, 6, 4],
    racePosOf: (r) => racePos[r.displayName] || null,
  });
  assert.deepEqual(out.map((i) => [i.row.displayName, i.total, i.add, i.rank, i.delta]), [
    ["B", 105, 10, 1, 1],
    ["A", 104, 4, 2, -1],
    ["C", 60, 0, 3, 0],
  ]);
});

test("fora de corrida nao soma nada; modo classe usa os pontos da classe", () => {
  const rows = [
    { displayName: "A", pointsRaw: 100, classPointsRaw: 40 },
    { displayName: "B", pointsRaw: 90, classPointsRaw: 55 },
  ];
  const out = points.project(rows, { inRace: false, classMode: true, racePosOf: () => 1, table: [10] });
  assert.deepEqual(out.map((i) => [i.row.displayName, i.total, i.add]), [
    ["B", 55, 0],
    ["A", 40, 0],
  ]);
});

test("janela em volta do piloto sempre inclui o lider", () => {
  assert.deepEqual(points.windowAround(4, 2, 5), [0, 1, 2, 3]);
  assert.deepEqual(points.windowAround(20, 10, 5), [0, 8, 9, 10, 11]);
  assert.deepEqual(points.windowAround(20, 0, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(points.windowAround(20, 19, 5), [0, 16, 17, 18, 19]);
  assert.deepEqual(points.windowAround(20, null, 5), [0, 1, 2, 3, 4]);
});
