const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeName, createMatcher, buildPool } = require("../overlay/shared/names");

function driver(firstName, lastName, extra) {
  return Object.assign(
    { firstName, lastName, displayName: `${firstName} ${lastName}`, aliases: [] },
    extra || {}
  );
}

function nameOf(d) {
  return d ? d.displayName : null;
}

test("normalizeName remove tags, acentos e pontuacao", () => {
  assert.equal(normalizeName("Luís Guimarães[PRO]"), "luis guimaraes");
  assert.equal(normalizeName("J. Santos"), "j santos");
});

test("nome completo identico casa", () => {
  const m = createMatcher([driver("Willian", "Garcia"), driver("Leandro", "Santos")]);
  assert.equal(nameOf(m.lookup("Willian Garcia[PRO]")), "Willian Garcia");
});

test("mesmo sobrenome com inicial diferente nao casa", () => {
  const m = createMatcher([driver("Leandro", "Santos")]);
  assert.equal(m.lookup("J. Santos"), null);
});

test("mesmo sobrenome com primeiro nome diferente nao casa", () => {
  const m = createMatcher([driver("Leandro", "Santos")]);
  assert.equal(m.lookup("Marcos Santos"), null);
});

test("inicial escolhe o piloto certo entre dois com o mesmo sobrenome", () => {
  const m = createMatcher([driver("Leandro", "Santos"), driver("Joao", "Santos")]);
  assert.equal(nameOf(m.lookup("J. Santos")), "Joao Santos");
  assert.equal(nameOf(m.lookup("L. Santos")), "Leandro Santos");
});

test("so o sobrenome casa quando ele e unico", () => {
  const m = createMatcher([driver("Leandro", "Santos"), driver("Willian", "Garcia")]);
  assert.equal(nameOf(m.lookup("Santos")), "Leandro Santos");
});

test("so o sobrenome fica sem casar quando ha dois pilotos iguais", () => {
  const m = createMatcher([driver("Leandro", "Santos"), driver("Joao", "Santos")]);
  assert.equal(m.lookup("Santos"), null);
});

test("dois nomes do jogo nunca recebem o mesmo piloto", () => {
  const m = createMatcher([driver("Leandro", "Santos"), driver("Joao", "Santos")]);
  m.prime(["Leandro Santos", "Santos"]);
  assert.equal(nameOf(m.lookup("Leandro Santos")), "Leandro Santos");
  // o outro Santos sobra para o segundo nome, por eliminacao
  assert.equal(nameOf(m.lookup("Santos")), "Joao Santos");
});

test("nome mais especifico vence a disputa pelo mesmo piloto", () => {
  const m = createMatcher([driver("Willian", "Garcia")]);
  m.prime(["Garcia", "Willian Garcia"]);
  assert.equal(nameOf(m.lookup("Willian Garcia")), "Willian Garcia");
  assert.equal(m.lookup("Garcia"), null);
});

test("alias vindo do RLT (nome no jogo) casa exato", () => {
  const m = createMatcher([driver("Carlos", "Troiano", { aliases: ["catroi"] })]);
  assert.equal(nameOf(m.lookup("Catroi[Pro]")), "Carlos Troiano");
});

test("RLT_INGAME_MAP tem prioridade", () => {
  const m = createMatcher([driver("Leandro", "Santos"), driver("Joao", "Santos")], {
    explicitMap: { xXSpeedyXx: "Joao Santos" },
  });
  assert.equal(nameOf(m.lookup("xXSpeedyXx")), "Joao Santos");
});

test("nome composto no RLT casa com primeiro nome e sobrenome do jogo", () => {
  const m = createMatcher([driver("Luis Fernando", "Guimaraes")]);
  assert.equal(nameOf(m.lookup("Luís Guimarães")), "Luis Fernando Guimaraes");
});

test("Player e nomes desconhecidos nao casam", () => {
  const m = createMatcher([driver("Leandro", "Santos")]);
  assert.equal(m.lookup("Player"), null);
  assert.equal(m.lookup("Fulano Desconhecido"), null);
});

test("buildPool junta drivers e standingsRows sem duplicar", () => {
  const pool = buildPool({
    drivers: [driver("Leandro", "Santos")],
    standingsRows: [
      { displayName: "Leandro Santos", firstName: "Leandro", lastName: "Santos" },
      { displayName: "Joao Santos", firstName: "Joao", lastName: "Santos", classUniqueName: "GT4" },
    ],
  });
  assert.equal(pool.length, 2);
  assert.equal(pool[1].uniqueName, "GT4");
});
