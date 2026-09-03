# listener.ps1
#
# Le a Shared Memory do AMS2 ($pcars2$, mesma usada por SimHub/CrewChief)
# usando os metodos prontos do .NET (MemoryMappedFile / MemoryMappedViewAccessor)
# -- sem precisar escrever C# ou usar addons nativos.
#
# Os offsets abaixo vem da struct oficial (SharedMemory.h) que a Reiza
# distribui junto do jogo. Le a cada 200ms e manda o resultado (em JSON) pro
# servidor Node via TCP, com um prefixo de 4 bytes indicando o tamanho.

$mapName = '$pcars2$'
$bridgeHost = "127.0.0.1"
$bridgePort = 5607

# Offsets (em bytes) dentro da Shared Memory:
$OFFSET_SESSION_STATE            = 12
$OFFSET_VIEWED_PARTICIPANT_INDEX = 20
$OFFSET_NUM_PARTICIPANTS         = 24
$OFFSET_EVENT_TIME_REMAINING     = 6740  # float -- o header diz "milli-seconds" mas o valor observado bate mais com SEGUNDOS; ajustando com base no teste
$OFFSET_PARTICIPANT_INFO_START   = 28
$PARTICIPANT_INFO_SIZE           = 100   # sizeof(ParticipantInfo)
$OFFSET_FASTEST_LAP_TIMES        = 8944  # float[64]
$OFFSET_LAST_LAP_TIMES           = 9200  # float[64]
$OFFSET_SPEEDS                   = 10800 # float[64]
$OFFSET_CAR_NAMES                = 11056 # char[64][64]
$OFFSET_CAR_CLASS_NAMES          = 15152 # char[64][64]
$OFFSET_TRACK_LENGTH             = 6704  # float, metros (unico, nao por participante)

$SESSION_LABELS = @{ 0="INVÁLIDA"; 1="TREINO LIVRE"; 2="TESTE"; 3="CLASSIFICAÇÃO"; 4="VOLTA DE FORMAÇÃO"; 5="CORRIDA"; 6="TIME ATTACK" }

function Read-CString($accessor, $offset, $maxLen) {
    $bytes = New-Object byte[] $maxLen
    $bytesRead = $accessor.ReadArray($offset, $bytes, 0, $maxLen)
    $nullIndex = [Array]::IndexOf($bytes, [byte]0)
    if ($nullIndex -lt 0) { $nullIndex = $maxLen }
    return [System.Text.Encoding]::UTF8.GetString($bytes, 0, $nullIndex)
}

Write-Host "Bridge (Shared Memory) iniciando..."

while ($true) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient($bridgeHost, $bridgePort)
        $stream = $tcp.GetStream()
        Write-Host "Conectado ao servidor Node."

        while ($tcp.Connected) {
            try {
                $mmf = [System.IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting($mapName)
                $accessor = $mmf.CreateViewAccessor(0, 0)

                $numParticipants = $accessor.ReadInt32($OFFSET_NUM_PARTICIPANTS)
                $viewedIndex = $accessor.ReadInt32($OFFSET_VIEWED_PARTICIPANT_INDEX)
                $sessionState = $accessor.ReadUInt32($OFFSET_SESSION_STATE)
                $timeRemainingSec = [int]$accessor.ReadSingle($OFFSET_EVENT_TIME_REMAINING)
                $trackLength = $accessor.ReadSingle($OFFSET_TRACK_LENGTH)

                $standings = @()
                for ($i = 0; $i -lt $numParticipants; $i++) {
                    $base = $OFFSET_PARTICIPANT_INFO_START + ($i * $PARTICIPANT_INFO_SIZE)
                    $isActive = $accessor.ReadByte($base) -ne 0
                    $racePosition = $accessor.ReadUInt32($base + 84)
                    # mRacePosition tem UNSET=0 (piloto nao esta de fato correndo:
                    # espectador, fora da sessao, DNS etc) -- filtra igual o SimHub faz
                    if (-not $isActive -or $racePosition -eq 0) { continue }

                    $name = Read-CString $accessor ($base + 1) 64
                    $currentLapDistance = $accessor.ReadSingle($base + 80)
                    $lapsCompleted = $accessor.ReadUInt32($base + 88)
                    $currentLap = $accessor.ReadUInt32($base + 92)

                    $fastestLap = $accessor.ReadSingle($OFFSET_FASTEST_LAP_TIMES + ($i * 4))
                    $lastLap = $accessor.ReadSingle($OFFSET_LAST_LAP_TIMES + ($i * 4))
                    $speed = $accessor.ReadSingle($OFFSET_SPEEDS + ($i * 4))
                    $carName = Read-CString $accessor ($OFFSET_CAR_NAMES + ($i * 64)) 64
                    $carClass = Read-CString $accessor ($OFFSET_CAR_CLASS_NAMES + ($i * 64)) 64

                    $standings += [PSCustomObject]@{
                        position      = [int]$racePosition
                        name          = $name
                        carName       = $carName
                        carClass      = $carClass
                        lapsCompleted = [int]$lapsCompleted
                        currentLap    = [int]$currentLap
                        totalDistance = ([double]$lapsCompleted * $trackLength) + $currentLapDistance
                        lastLapMs     = if ($lastLap -gt 0) { [int]($lastLap * 1000) } else { $null }
                        fastestLapMs  = if ($fastestLap -gt 0) { [int]($fastestLap * 1000) } else { $null }
                        speedKmh      = [math]::Round($speed * 3.6, 1)
                        speedMs       = [math]::Round($speed, 2)
                        isPlayer      = ($i -eq $viewedIndex)
                    }
                }

                $accessor.Dispose()
                $mmf.Dispose()

                $standingsSorted = @($standings | Sort-Object position)

                $payload = [PSCustomObject]@{
                    session = [PSCustomObject]@{
                        label           = $SESSION_LABELS[[int]$sessionState]
                        timeRemainingSec = $timeRemainingSec
                    }
                    standings = $standingsSorted
                }
                $json = ConvertTo-Json -InputObject $payload -Compress -Depth 4

                $payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $lengthBytes = [BitConverter]::GetBytes([int32]$payloadBytes.Length)
                if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($lengthBytes) }

                $stream.Write($lengthBytes, 0, 4)
                $stream.Write($payloadBytes, 0, $payloadBytes.Length)
            }
            catch {
                Write-Host "Sem dados agora (jogo fechado ou no menu?):" $_.Exception.Message
            }

            Start-Sleep -Milliseconds 200
        }
    }
    catch {
        Write-Host "Bridge: sem conexao com o Node, tentando de novo em 2s..." $_.Exception.Message
        Start-Sleep -Seconds 2
    }
}
