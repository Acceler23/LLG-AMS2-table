# AMS2 Overlay

Estrutura:

```
ams2-overlay/
├── package.json
├── SharedMemory.h         # header oficial do AMS2, so' de referencia/consulta
├── listener.ps1           # le a Shared Memory do jogo e manda pro servidor via TCP
├── server/
│   ├── index.js           # ponto de entrada: HTTP + WebSocket + bridge + OBS
│   ├── wsServer.js         # WebSocket: broadcast da tabela + recebe comandos
│   ├── tcpBridge.js        # recebe o JSON que o listener.ps1 manda
│   └── obsController.js    # integracao opcional com obs-websocket
├── overlay/
│   ├── timing-table.html   # pagina para adicionar como Browser Source no OBS
│   ├── timing-table.css    # fundo transparente + estilo da tabela
│   └── timing-table.js     # conecta no WebSocket e renderiza as linhas
└── control-panel/
    ├── panel.html          # janela separada com botoes de comando
    └── panel.js
```

## Como funciona

O Node no Windows tem um bug conhecido: o modulo de UDP descarta silenciosamente
certos pacotes de broadcast, e o AMS2 manda exatamente esse tipo. Por isso, em vez
de ler telemetria por UDP, o `listener.ps1` le direto a **Shared Memory** do jogo
(a mesma que SimHub e CrewChief usam), usando so' os metodos prontos do .NET
(`MemoryMappedFile` / `MemoryMappedViewAccessor`) -- sem precisar de C#, addons
nativos ou bibliotecas externas.

Fluxo: `AMS2 (Shared Memory) -> listener.ps1 -> TCP local -> server/index.js -> WebSocket -> tabela no OBS`

## Como rodar

```bash
npm install
npm start
```

Numa **segunda janela** do PowerShell (deixe as duas abertas ao mesmo tempo):

```powershell
powershell -ExecutionPolicy Bypass -File .\listener.ps1
```

Depois:
- No AMS2: so' precisa estar numa sessao (nao precisa mexer nas opcoes de UDP para isso).
- No OBS: adicionar Browser Source apontando para `http://localhost:8080/overlay/timing-table.html` (fundo transparente).
- **Modo demo** (ver o layout sem o jogo rodando): adicione `?demo=1` na URL, ex: `.../timing-table.html?demo=1`.
- Painel de controle (opcional, outra aba/janela): `http://localhost:8080/panel/panel.html`.
- Se for usar a integração com OBS: Ferramentas > WebSocket Server Settings no OBS, habilitar e copiar host/senha para as variáveis de ambiente `OBS_WS_URL` / `OBS_WS_PASSWORD`.

## Personalizar cor por classe e logo por carro

Edite `overlay/drivers-config.js`:
- `CLASS_NAME_OVERRIDES`: para classes que não seguem o padrão `PALAVRA_PALAVRA` (sufixos `_LD`/`_HD`/`_SW` são removidos e `_` vira espaço automaticamente -- use isso só quando o nome cru for completamente diferente do esperado).
- `CLASS_COLORS`: cor da barra lateral de cada linha, usando o nome **já formatado** como chave.
- `CAR_LOGOS`: logo exibida ao lado do nome, pela primeira palavra de `carName` (nome da montadora).

Pra descobrir os nomes exatos de `carClass`/`carName` da sua liga/mod, abra o
DevTools do navegador (F12 → Console) na página da tabela (sem `?demo=1`) e
digite `latestStandings.map(e => [e.carClass, e.carName])`.

Coloque os arquivos de logo dentro de `overlay/assets/logos/`.

## Atalhos de teclado

Com a janela do Browser Source em foco (ou no navegador direto):
- `,` e `.` trocam a coluna da direita entre Intervalo / Última volta / Melhor volta / Posições ganhas-perdidas.
- `[` e `]` trocam a página entre **Geral** (todo mundo junto), **Multiclasse** (agrupado por classe, com subtítulo e posição recalculada dentro da classe) e a classe do piloto que você está assistindo (mostra o nome real da classe).
- `p` liga/desliga o destaque de "você" -- útil quando está só espectando (o jogo não diferencia pilotando de espectando, só qual carro a câmera está olhando).

**Intervalo**: calculado por estimativa de distância percorrida (a Shared
Memory não entrega o gap pronto, então isso é uma aproximação -- parecida
com o que várias ferramentas da comunidade fazem, mas não é tão precisa
quanto uma medição de linha de tempo oficial). Fica em branco no grid/pit
(carro parado) e antes da 1ª volta.

**Posições ganhas/perdidas**: compara com a posição de cada piloto na primeira
mensagem recebida depois que a página é aberta -- recarregue a overlay no
grid de largada pra esse número refletir a corrida certinho desde o início.
No modo Multiclasse/Minha classe, a comparação é feita dentro da própria
classe; no modo Geral, é a posição geral.

**Sobre número de paradas**: a Shared Memory do AMS2 só expõe isso pro seu
próprio carro, não pros adversários -- não tem como montar essa coluna pra
grade toda com os dados disponíveis.

## Tabela de tempos

Mostra Posição, Piloto, Volta atual, Última volta e Melhor volta, com destaque
para a sua linha e para a volta mais rápida da sessão (roxo). Os dados vêm
prontos em JSON do `listener.ps1` -- se quiser adicionar mais colunas (gap pro
líder, pneu, setores), os campos já disponíveis na Shared Memory estão documentados
em `SharedMemory.h` (structs `ParticipantInfo` e os arrays `mCurrentSectorXTimes`,
`mSpeeds`, etc.) -- é só adicionar a leitura do offset correspondente no
`listener.ps1` e o campo na renderização em `overlay/timing-table.js`.
