const test = require("node:test");
const assert = require("node:assert/strict");
const cap = require("../overlay/shared/framecap");

test("sem limite: cada chamada desenha na hora", () => {
  cap.set(0);
  let n = 0;
  const draw = () => n++;
  for (let i = 0; i < 10; i++) cap.run(draw, []);
  assert.equal(n, 10);
});

test("com limite de 30 FPS: chamadas seguidas viram uma so, com os dados mais novos", async () => {
  cap.set(30);
  const seen = [];
  const draw = (v) => seen.push(v);
  for (let i = 1; i <= 10; i++) cap.run(draw, [i]); // 10 chamadas no mesmo instante
  assert.deepEqual(seen, [1]); // a primeira desenha na hora
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(seen, [1, 10]); // as outras viram uma, com o valor mais novo
  cap.set(0);
});
