# LLG Overlay (AMS2, LMU e ACC)

Tabela de tempos, driver card e tela de pontuação para transmissões do
Automobilista 2, do Le Mans Ultimate e do Assetto Corsa Competizione, com integração opcional com o Racing League Tools (RLT) e o OBS.

```
├── start.bat              # sobe tudo: servidor, listener e hotkeys
├── app/                   # aplicativo (.exe): janela do painel e tabela do piloto sobre o jogo
├── listener.ps1           # le a Shared Memory do AMS2 e manda pro servidor via TCP
├── listener-lmu.ps1       # o mesmo para o Le Mans Ultimate
├── hotkeys.ps1            # atalhos globais (funcionam com o jogo em foco)
├── SharedMemory_AMS2.h    # header oficial do AMS2, so de referencia/consulta
├── SharedMemory_LMU/      # headers oficiais do LMU, so de referencia/consulta
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
│   ├── driver-table.*     # tabela compacta para o piloto (classes + pontuacao ao vivo)
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

Fluxo: `jogo (Shared Memory) -> listener -> TCP local -> servidor -> WebSocket -> overlays no OBS`

A cada ciclo o listener copia a Shared Memory inteira e só aceita a cópia se o
número de sequência do jogo não mudou no meio, então um ciclo nunca mistura
dados de dois instantes diferentes.

O servidor guarda o que depende de histórico (posição de largada, paradas,
stint, tempo de box e instante da bandeirada). Recarregar a overlay no OBS não
perde esses dados. Reiniciar o servidor perde.

## Dois jogos: AMS2 e Le Mans Ultimate

Cada jogo tem o seu listener (`listener.ps1` para o AMS2, `listener-lmu.ps1`
para o LMU). Os dois ficam ligados ao mesmo tempo e mandam os dados no mesmo
formato; o servidor usa o jogo que estiver em sessão, então não é preciso
escolher nada. Tabela, driver card e tabela do piloto funcionam igual nos dois.

Só no LMU aparecem, **ao lado direito da tabela** (fora dela, como o relógio
da volta mais rápida), duas informações por piloto:
- **Pneu**: a letra do composto num círculo da cor dele: S branco, M amarelo,
  H vermelho, W azul. Com compostos diferentes na frente e atrás aparecem as
  duas letras.
- **VE**: energia virtual restante, em %. Fica amarela abaixo de 30% e
  vermelha abaixo de 15%. Carros sem energia virtual (LMP2) ficam em branco.

Os nomes e as cores das classes do LMU seguem o `drivers-config.js`: a lista
`LMU_CLASS_NAMES` diz como cada classe do jogo se chama aqui (`Hyper` vira
`Hypercar`, `GT3` vira `LMGT3`), e a cor é a de `CLASS_COLORS` para esse nome.

A tabela continua com 500 px. Com pneus, VE e o relógio ao lado, a fonte do
OBS precisa de pelo menos 650 px de largura no LMU.

No LMU a equipe e o número do carro vêm do próprio jogo e aparecem no driver
card mesmo sem temporada do RLT. O número de paradas também vem do jogo.

**Piloto em foco no LMU**: a memória do jogo não informa qual carro a câmera
está mostrando, então o servidor pergunta à API local do próprio LMU
(`http://localhost:6397/rest/watch/focus`). Assim o destaque e o driver card
acompanham a câmera também como espectador. Se a API não responder, vale o
carro do jogador.

Limitação no LMU: a linha amarela de "causou bandeira" não existe.

Os offsets usados pelo `listener-lmu.ps1` foram medidos compilando os headers
oficiais. Se uma atualização do LMU mudar as structs, precisam ser medidos de
novo. Os headers em `SharedMemory_LMU/` são da Studio 397 e a licença deles
não permite redistribuição: eles não vão para a pasta do aplicativo.

## Assetto Corsa Competizione

O ACC não mostra os adversários pela Shared Memory, então não tem listener: o
servidor conversa direto com a **API de transmissão** do jogo, a mesma que as
ferramentas de transmissão usam (`server/accClient.js`). Ele entra sozinho
quando o ACC está numa sessão, igual aos outros jogos.

A API precisa estar ligada no jogo. Em
`Documentos\Assetto Corsa Competizione\Config\broadcasting.json`:

```json
{ "updListenerPort": 9000, "connectionPassword": "asd", "commandPassword": "" }
```

Com `updListenerPort` em 0 a API fica desligada. O jogo só lê esse arquivo ao
abrir. A porta e a senha são lidas desse mesmo arquivo, então não há nada para
configurar aqui.

O que muda no ACC:
- **Piloto em foco**: vem do próprio jogo e acompanha a câmera, também como espectador.
- **Classe**: o jogo não informa; ela sai do modelo do carro (GT3, GT4, GT2,
  CUP, ST, CHL, TCX). Os nomes exibidos e as cores vêm de `ACC_CLASS_NAMES` e
  `CLASS_COLORS` no `drivers-config.js`.
- **Equipe e número** vêm do jogo e aparecem no driver card sem temporada do RLT.
- **Bandeirada**: o jogo não marca quem terminou. O líder é dado como terminado
  quando a corrida encerra, e os demais quando completam a volta em que estavam.
- **Não existe no ACC**: abandono (DNF), safety car e a linha de "causou bandeira".
- As corridas são por tempo, então o cabeçalho mostra o relógio e não voltas.

## Aplicativo (.exe)

Para quem só quer usar, sem instalar Node nem abrir terminal:

```bash
npm install
npm run build
```

Isso gera a pasta `dist/LLG Overlay-win32-x64` (não compactada, cerca de
370 MB). Copie a pasta inteira para quem for usar; dentro dela está o
`LLG Overlay.exe` e um `LEIA-ME.txt`. A **chave do RLT** do seu `.env` vai
embutida no aplicativo (`resources/app/.env`), para quem receber a pasta não
precisar digitar nada. Qualquer pessoa com a pasta consegue ler essa chave,
então só distribua para quem pode tê-la. O resto do seu `.env` não é copiado.

O aplicativo faz sozinho o que o `start.bat` faz em três janelas:
- sobe o servidor e inicia o listener e os atalhos, escondidos;
- abre o **painel de controle** numa janela própria, com os **links das overlays** prontos para copiar para o OBS;
- guarda a temporada aplicada para a próxima vez;
- mostra a **tabela do piloto** numa janela transparente por cima do jogo.

**Tabela do piloto**: versão compacta para quem está pilotando. Mostra a
classe do piloto com o líder e os carros em volta dele, os primeiros das
outras classes e, com temporada do RLT aplicada, a pontuação do campeonato
projetada ao vivo. No painel: marque "Mostrar sobre o jogo", use "Mover" para
arrastar e "Tamanho" para ajustar. O jogo precisa estar em **janela sem
bordas**; em tela cheia exclusiva a janela não aparece. Ela também funciona
como fonte de navegador (`/overlay/driver-table.html`) e não obedece aos
atalhos da tabela da transmissão.

Para ajustar cores, logos e pontos na pasta gerada, edite
`resources/app/overlay/drivers-config.js` (o painel tem um botão que abre a
pasta). As configurações e os registros do listener ficam em
`%APPDATA%\LLG Overlay`.

O aplicativo não é assinado: na primeira execução o Windows mostra o aviso do
SmartScreen ("Mais informações" → "Executar assim mesmo").

Em desenvolvimento, `npm run app` abre o mesmo aplicativo direto do código.

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

**Alternância automática**: no painel, "Alternar posições e pontuação" faz a
tabela e o driver card trocarem sozinhos entre as posições da sessão e a
pontuação do campeonato, ficando em cada tela o tempo escolhido no slider
(5 a 120 s). A escolha fica salva. A pontuação só aparece com temporada do RLT
aplicada: sem temporada, a tecla `0` e a alternância não fazem nada.

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
outra porta: `listener.ps1 -MapName nome -BridgePort 15607` (o `listener-lmu.ps1` aceita os mesmos parâmetros).

## Adicionar mais dados

Os campos disponíveis na Shared Memory do AMS2 estão documentados em `SharedMemory_AMS2.h`
(struct `ParticipantInfo` e os arrays por participante). Para uma coluna nova:
adicione a leitura do offset no `listener.ps1` e o campo na renderização em
`overlay/timing-table.js`. Se o dado depende de histórico, calcule em
`server/raceState.js`.
