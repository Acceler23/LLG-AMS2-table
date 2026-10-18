const test = require("node:test");
const assert = require("node:assert/strict");
const { build } = require("../overlay/shared/championship");

const row = (name, cls, classPos, pts, rounds, extra) =>
  Object.assign(
    {
      displayName: name,
      classUniqueName: cls,
      className: cls === "pro" ? "PRO" : cls === "am" ? "AM" : "—",
      classPosition: classPos,
      position: classPos,
      pointsRaw: pts,
      classPointsRaw: pts,
      rounds,
      penaltyPoints: 0,
    },
    extra
  );

test("separa por classe, na ordem da classe, com as etapas e o descarte", () => {
  const rows = [
    row("B", "pro", 2, 150, [{ round: 1, points: 80 }, { round: 2, points: 70 }]),
    row("A", "pro", 1, 170, [{ round: 1, points: 90 }, { round: 2, points: 80 }, { round: 3, points: 10, discarded: true }], { penaltyPoints: 5 }),
    row("C", "am", 1, 90, [{ round: 2, points: 90 }]),
    row("D", "am", 2, 0, []),
  ];
  const events = [{ round: 1 }, { round: 2 }, { round: 3 }, { round: 4 }];
  const out = build(rows, events, (r) => r.displayName === "D");
  assert.deepEqual(out.rounds, [1, 2, 3, 4]);
  assert.equal(out.multiClass, true);
  assert.deepEqual(out.groups.map((g) => g.name), ["AM", "PRO"]);
  const pro = out.groups[1].rows;
  assert.deepEqual(pro.map((x) => x.row.displayName), ["A", "B"]);
  assert.equal(pro[0].discarded, 10);
  assert.equal(pro[0].penaltyPoints, 5);
  assert.deepEqual(pro[0].cells.map((c) => c && `${c.points}${c.discarded ? "D" : ""}`), ["90", "80", "10D", null]);
  // B nao correu a etapa 3: celula vazia
  assert.equal(pro[1].cells[2], null);
  // D sem pontos so aparece porque esta na pista
  assert.deepEqual(out.groups[0].rows.map((x) => x.row.displayName), ["C", "D"]);
});

test("sem pontos e fora da pista nao aparece; sem classes, um grupo so", () => {
  const rows = [row("A", "—", 1, 50, [{ round: 1, points: 50 }]), row("Z", "—", 9, 0, [])];
  const out = build(rows, [], null);
  assert.equal(out.multiClass, false);
  assert.equal(out.groups.length, 1);
  assert.deepEqual(out.groups[0].rows.map((x) => x.row.displayName), ["A"]);
});

test("com classes, as etapas e as punicoes sao as da classe", () => {
  const r = row("A", "pro", 1, 353, [{ round: 1, points: 34 }], { classRounds: [{ round: 1, points: 83 }, { round: 2, points: 55, discarded: true }], penaltyPoints: 1, classPenaltyPoints: 4 });
  const out = build([r, row("B", "am", 1, 10, [])], [], null);
  const a = out.groups.find((g) => g.key === "pro").rows[0];
  assert.deepEqual(a.cells.map((c) => c && c.points), [83, 55]);
  assert.equal(a.discarded, 55);
  assert.equal(a.penaltyPoints, 4);
});
