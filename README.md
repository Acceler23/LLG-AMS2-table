# AMS2 Overlay

Tabela de tempos, driver card e tela de pontuação para transmissões do
Automobilista 2, com integração opcional com o Racing League Tools (RLT) e o OBS.

```
├── start.bat              # sobe tudo: servidor, listener e hotkeys
├── listener.ps1           # le a Shared Memory do jogo e manda pro servidor via TCP
├── hotkeys.ps1            # atalhos globais (funcionam com o jogo em foco)
├── SharedMemory.h         # header oficial do AMS2, so de referencia/consulta
├── .env.example           # modelo do arquivo .env (chave do RLT, OBS, portas)
├── server/
│   ├── index.js           # ponto de entrada: HTTP + WebSocket + bridge + OBS
│   ├── env.js             # le o arquivo .env
│   ├── wsServer.js        # WebSocket: broadcast da tabela + recebe comandos
│   ├── tcpBridge.js       # recebe o JSON que o listener.ps1 manda
│   ├── raceState.js       # largada, paradas, tempo de box e bandeiradas
│   ├── rltClient.js       # API do Racing League Tools (pilotos, classes, pontos)
│   └── obsController.js   # integracao opcional com obs-websocket
├── overlay/
│   ├── timing-table.*     # tabela de tempos / pontuacao (Browser Source no OBS)
│   ├── driver-card.*      # card do piloto em foco (Browser Source no OBS)
│   ├── drivers-config.js  # cores, logos, nomes de classe e tabela de pontos
│   ├── shared/            # codigo usado pela overlay E pelo servidor
│   │   ├── names.js       #   normalizacao e casamento de nomes com o RLT
│   │   ├── gaps.js        #   intervalo medido por tempo
│   │   └── colors.js      #   normalizacao de cores
│   └── assets/            # logos de equipes, carros e pistas
├── control-panel/         # painel de controle (outra aba/janela)
└── test/                  # testes automatizados (npm test)
```

## Como funciona

O Node no Windows tem um bug conhecido: o modulo de UDP descarta silenciosamente
certos pacotes de broadcast, e o AMS2 manda exatamente esse tipo. Por isso, em vez
de ler telemetria por UDP, o `listener.ps1` le direto a **Shared Memory** do jogo
(a mesma que SimHub e CrewChief usam), usando so os metodos prontos do .NET.

Fluxo: `AMS2 (Shared Memory) -> listener.ps1 -> TCP local -> servidor -> WebSocket -> overlays no OBS`

A cada ciclo o listener copia a Shared Memory inteira e só aceita a cópia se o
número de sequência do jogo não mudou no meio, então um ciclo nunca mistura
dados de dois instantes diferentes.

O servidor guarda o que depende de histórico (posição de largada, paradas,
stint, tempo de box e instante da bandeirada). Recarregar a overlay no OBS não
perde esses dados. Reiniciar o servidor perde.

## Como rodar

Dê dois cliques em `start.bat`. Ele instala as dependências na primeira vez e
abre três janelas: servidor, listener e hotkeys.

Manualmente:

```bash
npm install
npm start
```

e, em outra janela do PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\listener.ps1
```

Depois:
- No AMS2: só precisa estar numa sessão.
- No OBS: Browser Source apontando para `http://localhost:8080/overlay/timing-table.html` (fundo transparente). O driver card fica em `http://localhost:8080/overlay/driver-card.html`.
- **Modo demo** (ver o layout sem o jogo): `.../timing-table.html?demo=1`.
- Painel de controle: `http://localhost:8080/panel/panel.html`.

## Configuração (.env)

Copie `.env.example` para `.env` e preencha. O `.env` fica fora do git.

| Variável | Para quê |
| --- | --- |
| `RLT_API_KEY` | Chave da API do Racing League Tools. Também pode ser salva pelo painel, mas aí vale só até o servidor reiniciar. |
| `OBS_WS_URL`, `OBS_WS_PASSWORD` | Conexão com o OBS (Ferramentas > WebSocket Server Settings). |
| `HTTP_PORT`, `BRIDGE_PORT` | Portas do servidor (8080) e do listener (5607). |
| `ALLOW_LAN` | `1` libera o painel e a overlay para outros aparelhos da rede. |
| `ASSETS_BASE_URL` | Fonte online das imagens. Padrão: repositório `liga_lets_go_imageAssets`. Vazio usa só a pasta local. |
| `ASSETS_PATH` | Outra pasta local no lugar de `overlay/assets`. |

**Nunca escreva a chave do RLT em arquivos do projeto**: eles vão para o GitHub.

**Acesso pela rede**: por padrão o servidor só responde a este computador,
porque o painel troca a pasta de assets e a chave do RLT. Para usar o painel de
um celular ou de outro PC, defina `ALLOW_LAN=1` no `.env`.

**OBS**: pode ser aberto antes ou depois do servidor. A conexão é tentada de
novo a cada 5 segundos e também quando cai.

## Racing League Tools

Com a chave configurada, escolha a temporada no painel de controle. A overlay
passa a usar nome completo, equipe, classe e cor de cada piloto vindos do RLT,
e libera a tela de pontuação.

**Casamento de nomes**: o nome do jogo é comparado com o nome, os apelidos e o
"nome no jogo" cadastrados no RLT. As regras:
- Sobrenome igual só vale se o primeiro nome não contradiz. "J. Santos" casa
  com "João Santos", nunca com "Leandro Santos".
- Cada piloto do RLT fica com no máximo um carro. Se dois carros disputam o
  mesmo piloto, vence o nome mais completo.
- Empate entre dois pilotos não é resolvido no chute: o carro fica com o nome
  do jogo e sem classe até você desempatar.

Para desempatar ou corrigir um apelido, edite `RLT_INGAME_MAP` em
`overlay/drivers-config.js`:

```js
const RLT_INGAME_MAP = {
  "xXSpeedyXx": "João Santos",
};
```

## Personalizar cor por classe, logo e pontos

Edite `overlay/drivers-config.js`:
- `CLASS_NAME_OVERRIDES`: para classes que não seguem o padrão `PALAVRA_PALAVRA` (sufixos `_LD`/`_HD`/`_SW` são removidos e `_` vira espaço automaticamente).
- `CLASS_COLORS`: cor de cada classe, usando o nome **já formatado** como chave.
- `CAR_LOGOS`: logo pela primeira palavra de `carName` (nome da montadora).
- `TEAM_LOGO_OVERRIDES`: arquivo de logo para equipes cujo nome não bate com o arquivo.
- `RACE_POINTS_DEFAULT`: pontos por posição de chegada, usados na coluna "Pts proj.".
- `RACE_POINTS_BY_SEASON`: tabela de pontos própria para uma temporada, pelo nome exato da season no RLT.

Pra descobrir os nomes exatos de `carClass`/`carName`, abra o DevTools do
navegador (F12 → Console) na página da tabela e digite
`latestStandings.map(e => [e.carClass, e.carName])`.

**Imagens**: a overlay busca cada imagem primeiro na fonte online (repositório
`liga_lets_go_imageAssets`, pastas `teams/` e `cars/`) e usa a pasta local
`overlay/assets/` como reserva quando o arquivo não existe online ou não há
internet. O painel de controle troca a fonte online sem reiniciar.

**Relógio da volta mais rápida**: em corrida, o ícone `clock.png` aparece ao
lado da tabela, na altura da linha do piloto com a melhor volta. Na página
Geral é a melhor volta da corrida; nas páginas por classe há um relógio por
classe. Por padrão fica à direita da tabela, então a fonte do OBS precisa ter
pelo menos 535 px de largura. Com `?clock=left` na URL o ícone vai para a
esquerda e a tabela anda 32 px para a direita.

## Atalhos de teclado

Com o `hotkeys.ps1` aberto os atalhos funcionam com o jogo em foco. Sem ele,
funcionam com a página da overlay em foco. O painel de controle tem botões
para página, coluna e destaque.

- `,` e `.` trocam a coluna da direita: Intervalo / Gap líder / Última volta / Melhor volta / Posições / Paradas / Stint / VMax.
- `[` e `]` trocam a página: **Geral**, **Multiclasse** e a classe do piloto em foco.
- `p` liga/desliga o destaque do piloto em foco (o jogo não diferencia pilotar de espectar, só qual carro a câmera está olhando).
- `0` alterna entre a tabela de tempos e a tela de **pontuação** do campeonato (colunas: Pts / Pts proj. / Gap líder).

## O que cada coluna mostra

**Intervalo e Gap líder**: medidos por tempo. A overlay guarda em que instante
cada carro passou por cada ponto da pista, e o gap é quanto tempo faz que o
carro da frente passou onde este carro está agora. O valor não oscila em curva
lenta ou reta. Quem está uma volta ou mais atrás aparece como "+1 volta".
Nos primeiros segundos depois de abrir a overlay ainda não há histórico, e o
valor é estimado por distância e velocidade. Na primeira volta a coluna mostra
posições ganhas/perdidas. Depois da bandeirada o valor fica congelado. Em treino
e classificação a coluna mostra a diferença de melhor volta.

**Posições ganhas/perdidas**: compara com o grid de largada, que o servidor
trava quando o pelotão começa a andar. Se o servidor foi aberto com a corrida
em andamento, a referência é a posição daquele momento. O botão **Zerar
largada e paradas** do painel refaz essa referência. Nas páginas por classe a
comparação é dentro da classe.

**Paradas, Stint e tempo de box**: contados pelo servidor para todos os carros,
a partir da entrada e saída do pit lane. A Shared Memory não informa o número
de paradas dos adversários, então um drive-through conta como parada.

**Pts proj.**: pontos do campeonato somados aos pontos da posição atual na
corrida, pela tabela configurada em `drivers-config.js`. Quem abandonou não
projeta pontos.

**VMax**: maior velocidade do piloto na sessão. Zera ao trocar de sessão.

## Testes

```bash
npm test
```

Cobrem o casamento de nomes, o cálculo de intervalo e o estado da corrida no
servidor. Para testar o listener sem o jogo, ele aceita outro mapeamento e
outra porta: `listener.ps1 -MapName nome -BridgePort 15607`.

## Adicionar mais dados

Os campos disponíveis na Shared Memory estão documentados em `SharedMemory.h`
(struct `ParticipantInfo` e os arrays por participante). Para uma coluna nova:
adicione a leitura do offset no `listener.ps1` e o campo na renderização em
`overlay/timing-table.js`. Se o dado depende de histórico, calcule em
`server/raceState.js`.
