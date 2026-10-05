const test = require("node:test");
const assert = require("node:assert/strict");
const display = require("../overlay/shared/display");

display.setConfig({
  classNameOverrides: { GT3_Gen2: "GT3 Gen 2" },
  classColors: { "GT3 Gen 2": "#bf0000", GT4: "#267f00" },
  defaultColor: "rgb(0, 98, 255)",
  carLogos: { Porsche: "porsche.png", McLaren: "mclaren.png" },
  teamLogoOverrides: { Apex: "apex_racing.png", "E.C.H.O": "echo.png" },
});

test("nome de classe: override, sufixos tecnicos e underline", () => {
  assert.equal(display.formatClassName("GT3_Gen2"), "GT3 Gen 2");
  assert.equal(display.formatClassName("GT4_HD"), "GT4");
  assert.equal(display.formatClassName("Carrera_Cup"), "Carrera Cup");
  assert.equal(display.formatClassName("Porsche 911 GT3 Cup 3.8"), "Porsche 911 GT3 Cup 3.8");
});

test("cor de classe: RLT, depois CLASS_COLORS pelo nome formatado, depois derivada", () => {
  const rlt = [{ uniqueName: "pro", name: "Cup", color: "#FFBF0000" }];
  assert.equal(display.classColor("pro", rlt), "#BF0000");
  assert.equal(display.classColor("GT3_Gen2", null), "#bf0000");
  assert.equal(display.classColor("GT4_HD", null), "#267f00");
  assert.match(display.classColor("Classe Nova", null), /^hsl\(/);
  assert.equal(display.classColor("—", null), "rgb(0, 98, 255)");
});

test("logo de equipe: painel, depois TEAM_LOGO_OVERRIDES, depois o nome", () => {
  assert.equal(display.teamLogoFile("Apex", {}), "apex_racing.png");
  assert.equal(display.teamLogoFile("Apex", { Apex: "outro.png" }), "outro.png");
  assert.equal(display.teamLogoFile("Hell Machine", {}), "hell_machine.png");
  assert.equal(display.teamLogoFile("Fênix", null), "fenix.png");
  assert.equal(display.teamLogoFile("", {}), null);
});

test("caminhos de logo: equipe primeiro, carro como reserva", () => {
  assert.deepEqual(display.logoPaths("Apex", "Porsche 911 GT3 R", {}), ["teams/apex_racing.png", "cars/porsche.png"]);
  // equipe com nome de montadora usa o logo da montadora como reserva
  assert.deepEqual(display.logoPaths("McLaren", "Carro Desconhecido", {}), ["teams/mclaren.png", "cars/mclaren.png"]);
  assert.deepEqual(display.logoPaths(null, "Porsche 911", {}), [null, "cars/porsche.png"]);
});
