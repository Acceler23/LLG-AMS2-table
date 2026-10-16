const test = require("node:test");
const assert = require("node:assert/strict");
const { compactTracks, compactMultiseasons } = require("../server/trackStats");
const LLGTrackStats = require("../overlay/shared/trackstats");
const display = require("../overlay/shared/display");

// formato do RLT (/multiseasons/{key}/statistics?includeTrackStats=true), reduzido
const session = (date, caption, winner, lap) => ({
  date,
  seasonName: "Porsche Cup",
  roundNumber: 3,
  sessionCaption: caption,
  winnerDriverName: winner,
  winnerTeamName: null,
  fastestLapTime: lap,
});
const rlt = {
  trackStats: [
    {
      trackId: 52,
      trackName: "",
      uniqueName: "jacarepagua.1996",
      circuitName: "Jacarepagua",
      circuitOrigin: "Jacarepagua",
      country: "Brazil",
      generalStats: { totalEvents: 2, absoluteTrackRecord: { time: "1:50.361", timeMs: 110361, driverName: "Junior Adada", seasonName: "Porsche Cup", sessionType: "Qualification" } },
      raceStats: {
        fastestRaceLap: { time: "1:51.139", timeMs: 111139, driverName: "Junior Adada", seasonName: "Porsche Cup" },
        maxSpeed: 262.4,
        races: [
          session("2026-09-07", "Race 1", "Jeferson", "1:52.801"),
          session("2026-10-03", "Race 1", "Junior Adada", "1:51.139"),
          session("2026-09-07", "Race 2", "Jeferson", "1:52.707"),
          session("2026-10-03", "Race 2", "Leonardo", "2:06.371"),
        ],
      },
      qualificationStats: {
        fastestQualLap: { time: "1:50.361", timeMs: 110361, driverName: "Junior Adada", seasonName: "Porsche Cup" },
        qualifications: [session("2026-10-03", "Qual 1", "Junior Adada", "1:50.361"), session("2026-10-03", "Qual 2", "Marcelo", "1:50.900")],
      },
    },
    { trackId: 35, trackName: "", uniqueName: "interlagos.2014", circuitName: "Interlagos", circuitOrigin: "Interlagos", generalStats: { totalEvents: 1 } },
    { trackId: 132, trackName: "", uniqueName: "interlagos.scb.2011", circuitName: "Interlagos SCB ", circuitOrigin: "Interlagos", generalStats: { totalEvents: 0 } },
    { trackId: 1, trackName: "", uniqueName: "suzuka.2023", circuitName: "Suzuka", circuitOrigin: "Suzuka", generalStats: { totalEvents: 1 } },
  ],
};

test("multiseasons: o padrao sem chave vira chave vazia", () => {
  const list = compactMultiseasons({ multiSeasons: [{ key: null, name: "All Seasons", isDefault: true }, { key: "stock-car", name: "Stock Car" }] });
  assert.deepEqual(list, [
    { key: "", name: "All Seasons", isDefault: true },
    { key: "stock-car", name: "Stock Car", isDefault: false },
  ]);
});

test("pista sem historico ou recordes nao quebra", () => {
  const t = compactTracks(rlt).find((x) => x.trackId === 35);
  assert.deepEqual(t.records, { absolute: null, race: null, quali: null, maxSpeed: null });
  for (const stat of ["winners", "poles", "records"]) assert.deepEqual(LLGTrackStats.rows(t, stat), []);
});

test("ultimos vencedores: mais recente primeiro, a ultima bateria do dia antes", () => {
  const t = compactTracks(rlt)[0];
  assert.deepEqual(
    LLGTrackStats.rows(t, "winners").map((r) => `${r.name} ${r.value}`),
    ["Leonardo Porsche Cup", "Junior Adada Porsche Cup", "Jeferson Porsche Cup", "Jeferson Porsche Cup"]
  );
});

test("ultimas poles mostram o tempo", () => {
  const t = compactTracks(rlt)[0];
  assert.deepEqual(LLGTrackStats.rows(t, "poles").map((r) => `${r.name} ${r.value}`), ["Marcelo 1:50.900", "Junior Adada 1:50.361"]);
});

test("recordes: quali e corrida; o absoluto so quando e outro", () => {
  const t = compactTracks(rlt)[0];
  assert.deepEqual(LLGTrackStats.rows(t, "records"), [
    { tag: "Quali", name: "Junior Adada", value: "1:50.361" },
    { tag: "Corrida", name: "Junior Adada", value: "1:51.139" },
    { tag: null, name: "Velocidade máxima", value: "262 km/h" },
  ]);
  t.records.absolute = { time: "1:49.000", driverName: "Outro" };
  assert.equal(LLGTrackStats.rows(t, "records")[0].tag, "Absoluto");
});

test("no maximo 5 linhas", () => {
  const t = compactTracks(rlt)[0];
  t.races = Array.from({ length: 8 }, (_, i) => ({ date: `2026-01-0${i + 1}`, caption: "Race 1", winner: `P${i}` }));
  assert.equal(LLGTrackStats.rows(t, "winners").length, 5);
});

test("pista do jogo: nome igual vence o que so contem", () => {
  const tracks = compactTracks(rlt);
  assert.equal(display.matchTrack(tracks, ["Interlagos", "Interlagos GP"]).trackId, 35);
  assert.equal(display.matchTrack(tracks, ["Interlagos SCB"]).trackId, 132);
  assert.equal(display.matchTrack(tracks, ["Jacarepagua Historic"]).trackId, 52);
  assert.equal(display.matchTrack(tracks, ["Kansai", "Suzuka"]).trackId, 1); // nome do track-names.js
  assert.equal(display.matchTrack(tracks, ["Monza"]), null);
});

test("pista do jogo: a etapa do RLT (uniqueName) e exata", () => {
  const tracks = compactTracks(rlt);
  assert.equal(display.matchTrack(tracks, ["Interlagos"], "interlagos.scb.2011").trackId, 132);
});

test("ultimos vencedores: nome da temporada, mesmo com campeonato informado", () => {
  const t = compactTracks(Object.assign({ seasons: [{ name: "Porsche Cup", championshipName: "Porsche Cup 4" }] }, rlt))[0];
  assert.equal(LLGTrackStats.rows(t, "winners")[0].value, "Porsche Cup");
});

test("nome do piloto: nome e sobrenome do cadastro do RLT", () => {
  const drivers = [
    { driverName: "Jeferson", driverInfo: { firstName: "Jeferson", lastName: "Oliveira" } },
    { driverName: "RafaCll", driverInfo: { firstName: null, lastName: null, displayName: "RafaCll" } },
  ];
  const t = compactTracks(Object.assign({ drivers }, rlt))[0];
  assert.equal(t.races.find((r) => r.date === "2026-09-07").winner, "Jeferson Oliveira");
  const { shortNamer } = require("../server/trackStats");
  const nameOf = shortNamer(drivers);
  assert.equal(nameOf("RafaCll"), "RafaCll");
  assert.equal(nameOf("Leonardo Santos Pereira"), "Leonardo Pereira"); // sem cadastro: primeira e ultima palavra
  assert.equal(nameOf("Junior Adada"), "Junior Adada");
});
