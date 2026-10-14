const test = require("node:test");
const assert = require("node:assert/strict");
const rlt = require("../server/rltClient");

const PRO = { uniqueName: "pro", name: "Pro", abbreviation: "PRO", color: "#ff0000" };
const AM = { uniqueName: "am", name: "Amador", abbreviation: "AM", color: "#00ff00" };

function standings() {
  return {
    seasonStatistics: {
      driverStandings: [
        { driverName: "Ana Titular", driverInfo: { firstName: "Ana", lastName: "Titular" }, position: 1, points: 25, teamName: "Apex", classInfo: PRO },
      ],
      classes: [],
    },
  };
}

const lineups = {
  seats: [
    { driverName: "Ana Titular", driverInfo: { firstName: "Ana", lastName: "Titular" }, seatType: "Primary", classInfo: PRO, team: { name: "Apex", fullName: "Apex Racing", primaryColor: "#111111", secondaryColor: "#222222" } },
    // entrou no lineup em cima da hora: ainda nao esta na pontuacao
    { driverName: "Beto Novato", driverInfo: { firstName: "Beto", lastName: "Novato", description: "beto_ingame", raceNumber: "77" }, seatType: "Primary", classInfo: AM, team: { name: "Grip", fullName: "Grip Team", primaryColor: "#333333", secondaryColor: "#444444" } },
    // reserva: sem equipe, mas com classe
    { driverName: "Caio Reserva", driverInfo: { firstName: "Caio", lastName: "Reserva" }, seatType: "Reserve", classInfo: PRO, team: null },
  ],
};

test("lineup: quem ainda nao correu e os reservas entram com classe", () => {
  const merged = rlt.mergeLineupIntoStandings(standings(), rlt.lineupSeatsToDrivers(lineups));
  const drivers = rlt.buildDrivers(merged, [PRO, AM]);
  const by = (name) => drivers.find((d) => d.displayName === name);
  assert.equal(drivers.length, 3);
  assert.equal(by("Beto Novato").name, "Amador");
  assert.equal(by("Beto Novato").teamName, "Grip");
  assert.equal(by("Beto Novato").teamFullName, "Grip Team");
  assert.equal(by("Beto Novato").raceNumber, "77");
  assert.ok(by("Beto Novato").aliases.includes("beto ingame") || by("Beto Novato").aliases.some((a) => a.replace(/[^a-z]/g, "") === "betoingame"));
  assert.equal(by("Caio Reserva").name, "Pro");
  assert.equal(by("Caio Reserva").teamName, null);
  // quem ja estava na pontuacao nao e duplicado nem perde os pontos
  const rows = rlt.buildStandingsRows(merged, [PRO, AM]);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.displayName === "Ana Titular").pointsRaw, 25);
  assert.equal(rows.find((r) => r.displayName === "Beto Novato").pointsRaw, 0);
  assert.equal(rows.find((r) => r.displayName === "Caio Reserva").className, "Pro");
});

test("lineup: completa classe e equipe de quem esta na pontuacao sem elas", () => {
  const st = { driverStandings: [{ driverName: "Caio Reserva", driverInfo: {}, position: 3, points: 4 }] };
  const merged = rlt.mergeLineupIntoStandings(st, rlt.lineupSeatsToDrivers(lineups));
  const caio = merged.driverStandings.find((d) => d.driverName === "Caio Reserva");
  assert.equal(caio.classInfo.name, "Pro");
  assert.equal(caio.points, 4);
});

test("lineup vazio ou ausente nao muda a pontuacao", () => {
  assert.deepEqual(rlt.lineupSeatsToDrivers(null), []);
  const st = standings();
  assert.equal(rlt.mergeLineupIntoStandings(st, []).seasonStatistics.driverStandings.length, 1);
  assert.deepEqual(rlt.mergeLineupIntoStandings(null, []), { driverStandings: [] });
});

test("detalhe do evento: pais e baterias em ordem, com a marca de resultado lancado", () => {
  const session = (type, caption, date, status) => ({ sessionInfo: { sessionType: type, sessionCaption: caption, sessionDate: date, completedStatus: status } });
  const detail = {
    event: { track: { trackName: "Goiania", country: "Brazil" } },
    sessions: [
      session("Qualification", "Qual 1", "2026-09-19T18:00:00+00:00", "Completed"),
      session("Qualification", "Qual 2", "2026-09-19T19:30:00+00:00", "InFuture"),
      session("Race", "Race 2", "2026-09-19T20:00:00+00:00", "InFuture"),
      session("Race", "Race 1", "2026-09-19T18:30:00+00:00", "Completed"),
    ],
  };
  const info = rlt.eventDetailInfo(detail, "InFuture");
  assert.equal(info.country, "Brazil");
  assert.deepEqual(info.races, [{ caption: "Race 1", completed: true }, { caption: "Race 2", completed: false }]);
  assert.deepEqual(info.qualifications, [{ caption: "Qual 1", completed: true }, { caption: "Qual 2", completed: false }]);
  assert.equal(info.final, false);
  assert.equal(rlt.eventDetailInfo(detail, "Completed").final, true);
  assert.deepEqual(rlt.eventDetailInfo(null, null).races, []);
});
