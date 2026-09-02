// overlay/timing-table/timing-table.js
//
// Espera receber do servidor mensagens do tipo:
//   { type: "standings", data: [ { position, name, currentLap, lastLapMs, fastestLapMs, isPlayer }, ... ] }
// Isso vem direto do listener.ps1, que le a Shared Memory do AMS2.
//
// Pra já visualizar o layout no OBS antes de ligar a telemetria real,
// adicione ?demo=1 na URL do Browser Source.

const params = new URLSearchParams(location.search);
const DEMO = params.get("demo") === "1";

const WS_URL = `ws://${location.hostname}:${location.port || 8080}/ws`;

function connect() {
  const socket = new WebSocket(WS_URL);
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "standings") render(msg.data);
  });
  socket.addEventListener("close", () => setTimeout(connect, 2000));
}

function render(standings) {
  const container = document.getElementById("rows");

  // acha a menor "melhor volta" entre todo mundo, pra destacar em roxo
  const bestOverall = Math.min(
    ...standings.map((e) => e.fastestLapMs).filter((v) => typeof v === "number" && v > 0)
  );

  // remove linhas que sobraram de antes (ex: carro saiu da sessao)
  while (container.children.length > standings.length) {
    container.removeChild(container.lastChild);
  }

  standings.forEach((entry, i) => {
    let row = container.children[i];
    if (!row) {
      row = document.createElement("div");
      row.className = "row";
      container.appendChild(row);
      row.innerHTML = `
        <span class="col pos"></span>
        <span class="col name"></span>
        <span class="col lap"></span>
        <span class="col last"></span>
        <span class="col best"></span>
      `;
    }

    const changedPosition = row.dataset.name && row.dataset.name !== entry.name;

    row.classList.toggle("player", !!entry.isPlayer);
    row.classList.toggle("fastest", entry.fastestLapMs === bestOverall);
    if (changedPosition) {
      row.classList.remove("moved");
      void row.offsetWidth; // forca o navegador a reiniciar a animacao
      row.classList.add("moved");
    }

    row.dataset.name = entry.name;
    row.children[0].textContent = entry.position;
    row.children[1].textContent = entry.name;
    row.children[2].textContent = entry.currentLap ?? "-";
    row.children[3].textContent = entry.lastLapMs ? formatTime(entry.lastLapMs) : "--:--.---";
    row.children[4].textContent = entry.fastestLapMs ? formatTime(entry.fastestLapMs) : "--:--.---";
  });
}

function formatTime(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

if (DEMO) {
  const demoData = [
    { position: 1, name: "V. BOTTAS", currentLap: 12, lastLapMs: 82345, fastestLapMs: 81900 },
    { position: 2, name: "L. HAMILTON", currentLap: 12, lastLapMs: 82890, fastestLapMs: 82100 },
    { position: 3, name: "VOCÊ", currentLap: 12, lastLapMs: 83210, fastestLapMs: 82750, isPlayer: true },
    { position: 4, name: "M. VERSTAPPEN", currentLap: 11, lastLapMs: 83500, fastestLapMs: 83100 },
    { position: 5, name: "C. LECLERC", currentLap: 11, lastLapMs: 83790, fastestLapMs: 83400 },
  ];
  render(demoData);
} else {
  connect();
}
