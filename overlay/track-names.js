// overlay/track-names.js
// Nomes de pista do cabecalho da tabela, configurados a mao.
//
// Cada jogo informa a pista do jeito dele, e alguns usam nomes diferentes do
// real (no ACC, "Kansai" e Suzuka). Nesta lista voce diz como cada pista deve
// aparecer:
//
//   "nome que o jogo informa": "nome que aparece na tabela",
//
// Como preencher:
//   - A chave e o nome exato que o jogo manda, sem diferenciar maiusculas de
//     minusculas. Para descobrir, abra a tabela com a pista carregada: sem
//     entrada nesta lista, ela mostra o nome do jogo como veio.
//   - Para trocar so um tracado, use "pista tracado" na chave. Ai o tracado
//     some da segunda linha, porque o nome novo ja diz tudo:
//       "Interlagos Kart 1": "Kartódromo de Interlagos",
//   - Com a chave so da pista, o tracado continua aparecendo embaixo:
//       "Kansai": "Suzuka",      ->  SUZUKA / GP
//   - No Assetto Corsa (o primeiro) o jogo manda o nome da pasta da pista,
//     por exemplo "ks_vallelunga". A tabela ja tira o "ks_" e os "_" sozinha;
//     use a lista so se quiser outro nome:
//       "ks_nordschleife": "Nürburgring Nordschleife",
//
//   - Para encurtar um nome comprido sem saber o texto exato, comece a chave
//     com "*": ela vale para qualquer nome que CONTENHA aquele trecho, sem
//     diferenciar maiusculas nem acentos. Nesse caso o tracado nao aparece:
//       "*Daytona": "Daytona",   pega "Daytona International Speedway Road Course"
//     As chaves exatas tem prioridade sobre as com "*".
//
// A tabela se recarrega sozinha quando este arquivo e salvo.
const TRACK_NAMES = {
  // ---- Assetto Corsa Competizione ----
  
  // ---- Automobilista 2 ----
  "*Azure": "Monaco",
  "*Kansai": "Suzuka",
  "Spielberg": "RedBull Ring",

  // ---- Le Mans Ultimate ----
  // O LMU manda o nome oficial inteiro ("Daytona International Speedway Road
  // Course"). As chaves com "*" valem para qualquer nome que contenha o trecho.
  "*Sarthe": "Le Mans",
  "*Daytona": "Daytona",
  "*Sebring": "Sebring",
  "*Monza": "Monza",
  "*Francorchamps": "Spa-Francorchamps",
  "*Enzo e Dino": "Imola",
  "*Imola": "Imola",
  "*Algarve": "Portimão",
  "*Portim": "Portimão",
  "*Americas": "COTA",
  "*Carlos Pace": "Interlagos",
  "*Fuji": "Fuji",
  "*Bahrain": "Bahrain",
  "*Lusail": "Lusail",
  "*Losail": "Lusail",
  "*Paul Ricard": "Paul Ricard",
  "*Silverstone": "Silverstone",
  "*Catalunya": "Barcelona"

  // ---- Assetto Corsa ----
};
