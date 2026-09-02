// server/obsController.js
// Conexao com o OBS via obs-websocket (nativo no OBS 28+, ativar em
// Ferramentas > WebSocket Server Settings). Permite:
//  - reagir a eventos de telemetria (ex: trocar de cena ao entrar nos boxes)
//  - reagir a comandos vindos do painel de controle via wsServer

const { OBSWebSocket } = require("obs-websocket-js");

const OBS_URL = process.env.OBS_WS_URL || "ws://127.0.0.1:4455";
const OBS_PASSWORD = process.env.OBS_WS_PASSWORD || "";

async function connectObs(wss) {
  const obs = new OBSWebSocket();

  try {
    await obs.connect(OBS_URL, OBS_PASSWORD);
    console.log("Conectado ao obs-websocket");
  } catch (err) {
    console.warn("Nao foi possivel conectar ao OBS agora:", err.message);
    console.warn("Overlay/telemetria continuam funcionando normalmente sem o OBS.");
    return;
  }

  // Exemplo: painel de controle manda { type:"command", name:"obs.setScene", payload:{ scene:"Corrida" } }
  wss.onCommand("obs.setScene", async (payload) => {
    try {
      await obs.call("SetCurrentProgramScene", { sceneName: payload.scene });
    } catch (err) {
      console.error("Falha ao trocar cena no OBS:", err.message);
    }
  });

  wss.onCommand("obs.startRecord", async () => {
    await obs.call("StartRecord").catch((e) => console.error(e.message));
  });

  wss.onCommand("obs.stopRecord", async () => {
    await obs.call("StopRecord").catch((e) => console.error(e.message));
  });

  return obs;
}

module.exports = { connectObs };
