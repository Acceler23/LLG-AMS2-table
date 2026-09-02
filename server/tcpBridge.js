// server/tcpBridge.js
//
// O modulo nativo de UDP do Node no Windows tem um bug conhecido: ele
// descarta silenciosamente pacotes de broadcast com um certo campo do
// cabecalho IP zerado -- exatamente o tipo que o AMS2 manda. Por isso,
// em vez de ler o UDP diretamente aqui, recebemos os pacotes via TCP de
// uma pontezinha em PowerShell (bridge.ps1) que le o UDP (isso funciona
// bem no .NET) e repassa cada pacote pra ca, prefixado com 4 bytes
// indicando o tamanho (big-endian), pra sabermos onde um pacote termina
// e o outro comeca dentro do fluxo TCP.

const net = require("net");

function startTcpBridge(port, onPacket) {
  const server = net.createServer((socket) => {
    console.log("Bridge (PowerShell) conectada");
    let buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // pode chegar mais de um pacote junto, ou um pacote partido em
      // varios pedacos -- por isso o loop + prefixo de tamanho
      while (buffer.length >= 4) {
        const msgLen = buffer.readUInt32BE(0);
        if (buffer.length < 4 + msgLen) break; // ainda falta parte do pacote
        const msg = buffer.subarray(4, 4 + msgLen);
        buffer = buffer.subarray(4 + msgLen);
        onPacket(msg);
      }
    });

    socket.on("close", () => console.log("Bridge (PowerShell) desconectada"));
    socket.on("error", (err) => console.error("Erro na conexao da bridge:", err.message));
  });

  server.on("error", (err) => console.error("Erro no servidor da bridge:", err.message));

  server.listen(port, "127.0.0.1", () => {
    console.log(`Bridge TCP esperando o listener.ps1 conectar na porta ${port}`);
  });

  return server;
}

module.exports = { startTcpBridge };
