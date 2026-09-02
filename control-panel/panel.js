const WS_URL = `ws://${location.hostname}:${location.port || 8080}/ws`;
const socket = new WebSocket(WS_URL);

socket.addEventListener("open", () => console.log("Painel conectado"));

function send(name, payload = {}) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "command", name, payload }));
  } else {
    console.warn("Socket ainda nao esta aberto");
  }
}
