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

test("descarte por etapa: a corrida entra na etapa atual e o pior resultado sai", () => {
  const P = require("../overlay/shared/points");
  const rule = { type: "Events", count: 1 };
  // lider: 4 vitorias de 90 e, na etapa 5, a corrida 1 (45) ja lancada e descartada
  const lider = { pointsRaw: 360, discard: rule, rounds: [1, 2, 3, 4].map((round) => ({ round, points: 90 })).concat([{ round: 5, points: 45, discarded: true }]) };
  // vence a corrida 2 da etapa 5: a etapa vale 90, uma etapa de 90 sai, o total nao muda
  assert.equal(P.projectedTotal(lider, 45, 5), 360);
  // a soma simples daria 405
  assert.equal(P.projectedTotal(Object.assign({}, lider, { discard: null }), 45, 5), 405);

  // faltou a etapa 2 (vale 0, e e ela que sai) e tem uma punicao de -7 no oficial
  const david = { pointsRaw: 163, discard: rule, rounds: [{ round: 1, points: 48 }, { round: 3, points: 59 }, { round: 4, points: 43 }, { round: 5, points: 20 }] };
  assert.equal(P.projectedTotal(david, 30, 5), 193); // 48+59+43+50 - 7

  // etapa ruim descartada: a corrida soma inteira
  const henrique = { pointsRaw: 153, discard: rule, rounds: [{ round: 1, points: 36 }, { round: 2, points: 44 }, { round: 3, points: 55 }, { round: 4, points: 0, discarded: true }, { round: 5, points: 18 }] };
  assert.equal(P.projectedTotal(henrique, 30, 5), 183);

  // etapa atual ainda sem nada lancado: comeca do zero e pode virar a descartada
  const novo = { pointsRaw: 100, discard: rule, rounds: [{ round: 1, points: 50 }, { round: 2, points: 50 }, { round: 3, points: 10, discarded: true }] };
  assert.equal(P.projectedTotal(novo, 5, 4), 110); // 50+50+10+5, sai o 5
  assert.equal(P.projectedTotal(novo, 40, 4), 140); // 50+50+40, sai o 10
});

test("descarte por corrida e casos sem descarte", () => {
  const P = require("../overlay/shared/points");
  const row = { pointsRaw: 70, discard: { type: "Races", count: 1 }, rounds: [{ round: 1, points: 40, races: [30, 10] }, { round: 2, points: 40, races: [20, 20] }] };
  // corridas: 30, 10, 20, 20 -> sai o 10 = 70; com mais 25: sai o 10 = 95
  assert.equal(P.projectedTotal(row, 25, 3), 95);
  assert.equal(P.projectedTotal(row, 5, 3), 80); // agora o 5 e que sai: 30+10+20+20
  assert.equal(P.projectedTotal({ pointsRaw: 10 }, 25, 3), 35); // sem regra: soma
  assert.equal(P.projectedTotal({ pointsRaw: 10, classPointsRaw: 12 }, 3, 1, true), 15); // base da classe
});

test("etapa em andamento: a da pista, senao a proxima nao concluida", () => {
  const P = require("../overlay/shared/points");
  const events = [
    { round: 4, completedStatus: "Completed", eventDate: "2026-10-08" },
    { round: 5, completedStatus: "InFuture", eventDate: "2026-10-15" },
    { round: 6, completedStatus: "InFuture", eventDate: "2026-10-22" },
  ];
  assert.equal(P.currentRound(events, { round: 4 }), 4);
  assert.equal(P.currentRound(events, null, Date.parse("2026-10-14T20:00:00Z")), 5);
  assert.equal(P.currentRound([], null), null);
});
