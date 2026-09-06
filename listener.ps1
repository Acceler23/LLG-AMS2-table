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
$OFFSET_SPLIT_TIME_AHEAD         = 6728  # float, so do carro local/viewed
$OFFSET_FASTEST_LAP_TIMES        = 8944  # float[64]
$OFFSET_LAST_LAP_TIMES           = 9200  # float[64]
$OFFSET_RACE_STATES              = 9520  # uint[64]
$OFFSET_PIT_MODES                = 9776  # uint[64]
$OFFSET_SPEEDS                   = 10800 # float[64]
$OFFSET_CAR_NAMES                = 11056 # char[64][64]
$OFFSET_CAR_CLASS_NAMES          = 15152 # char[64][64]
$OFFSET_TRACK_LENGTH             = 6704  # float, metros (unico, nao por participante)
$OFFSET_LAPS_IN_EVENT            = 6572  # uint, total de voltas (0 = corrida por tempo)
$OFFSET_FUEL_LEVEL               = 6840  # float 0-1, so local
$OFFSET_FUEL_CAPACITY            = 6844  # float litros, so local
$OFFSET_TYRE_COMPOUND            = 19388 # char[4][40], so local
$OFFSET_CUR_SECTOR1              = 7408  # float[64]
$OFFSET_CUR_SECTOR2              = 7664
$OFFSET_CUR_SECTOR3              = 7920
$OFFSET_FAST_SECTOR1             = 8176  # float[64]
$OFFSET_FAST_SECTOR2             = 8432
$OFFSET_FAST_SECTOR3             = 8688
$OFFSET_FLAG_COLOURS             = 19804 # uint[64]
$OFFSET_FLAG_REASONS             = 20060 # uint[64]
$OFFSET_LAPS_INVALIDATED         = 9456  # bool[64]

$SESSION_LABELS = @{ 0="INVALIDA"; 1="TREINO LIVRE"; 2="TESTE"; 3="CLASSIFICACAO"; 4="VOLTA DE FORMACAO"; 5="CORRIDA"; 6="TIME ATTACK" }

$maxSpeedKmh = @{}

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
                $lapsInEvent = $accessor.ReadUInt32($OFFSET_LAPS_IN_EVENT)
                $splitAhead = $accessor.ReadSingle($OFFSET_SPLIT_TIME_AHEAD)
                $inRace = ($sessionState -eq 5)

                $standings = @()
                $scOut = $false
                for ($i = 0; $i -lt $numParticipants; $i++) {
                    $base = $OFFSET_PARTICIPANT_INFO_START + ($i * $PARTICIPANT_INFO_SIZE)
                    $isActive = $accessor.ReadByte($base) -ne 0
                    $racePosition = $accessor.ReadUInt32($base + 84)

                    $carName = Read-CString $accessor ($OFFSET_CAR_NAMES + ($i * 64)) 64
                    $carClass = Read-CString $accessor ($OFFSET_CAR_CLASS_NAMES + ($i * 64)) 64
                    $pitMode = $accessor.ReadUInt32($OFFSET_PIT_MODES + ($i * 4))

                    $clsLow = if ($carClass) { $carClass.ToLower() } else { "" }
                    $cnLow = if ($carName) { $carName.ToLower() } else { "" }
                    if ($clsLow -eq "safetycar" -or $cnLow -like "*safety*") {
                        if ($isActive -and $pitMode -eq 0) { $scOut = $true }
                    }

                    if (-not $isActive -or $racePosition -eq 0) { continue }

                    $name = Read-CString $accessor ($base + 1) 64
                    $currentLapDistance = $accessor.ReadSingle($base + 80)
                    $lapsCompleted = $accessor.ReadUInt32($base + 88)
                    $currentLap = $accessor.ReadUInt32($base + 92)

                    $fastestLap = $accessor.ReadSingle($OFFSET_FASTEST_LAP_TIMES + ($i * 4))
                    $lastLap = $accessor.ReadSingle($OFFSET_LAST_LAP_TIMES + ($i * 4))
                    $speed = $accessor.ReadSingle($OFFSET_SPEEDS + ($i * 4))
                    $raceState = $accessor.ReadUInt32($OFFSET_RACE_STATES + ($i * 4))
                    $s1 = $accessor.ReadSingle($OFFSET_CUR_SECTOR1 + ($i * 4))
                    $s2 = $accessor.ReadSingle($OFFSET_CUR_SECTOR2 + ($i * 4))
                    $s3 = $accessor.ReadSingle($OFFSET_CUR_SECTOR3 + ($i * 4))
                    $fs1 = $accessor.ReadSingle($OFFSET_FAST_SECTOR1 + ($i * 4))
                    $fs2 = $accessor.ReadSingle($OFFSET_FAST_SECTOR2 + ($i * 4))
                    $fs3 = $accessor.ReadSingle($OFFSET_FAST_SECTOR3 + ($i * 4))
                    $flagColour = $accessor.ReadUInt32($OFFSET_FLAG_COLOURS + ($i * 4))
                    $flagReason = $accessor.ReadUInt32($OFFSET_FLAG_REASONS + ($i * 4))
                    $lapInvalid = $accessor.ReadByte($OFFSET_LAPS_INVALIDATED + $i) -ne 0

                    if ($inRace -and $raceState -eq 0) { continue }
                    if ($inRace -and [int]$lapsCompleted -eq 0 -and ($pitMode -eq 4 -or $pitMode -eq 2)) { continue }
                    if ($clsLow -eq "safetycar" -or $cnLow -like "*safety*") { continue }

                    $speedKmh = [math]::Round($speed * 3.6, 1)
                    if (-not $maxSpeedKmh.ContainsKey($name) -or $speedKmh -gt $maxSpeedKmh[$name]) {
                        $maxSpeedKmh[$name] = $speedKmh
                    }

                    $entry = [PSCustomObject]@{
                        position      = [int]$racePosition
                        name          = $name
                        carName       = $carName
                        carClass      = $carClass
                        lapsCompleted = [int]$lapsCompleted
                        currentLap    = [int]$currentLap
                        totalDistance = ([double]$lapsCompleted * $trackLength) + $currentLapDistance
                        lastLapMs     = if ($lastLap -gt 0) { [int]($lastLap * 1000) } else { $null }
                        fastestLapMs  = if ($fastestLap -gt 0) { [int]($fastestLap * 1000) } else { $null }
                        speedKmh      = $speedKmh
                        speedMs       = [math]::Round($speed, 2)
                        maxSpeedKmh   = $maxSpeedKmh[$name]
                        isPlayer      = ($i -eq $viewedIndex)
                        pitMode       = [int]$pitMode
                        raceState     = [int]$raceState
                        inRace        = $inRace
                        sector1Ms     = if ($s1 -gt 0) { [int]($s1 * 1000) } else { $null }
                        sector2Ms     = if ($s2 -gt 0) { [int]($s2 * 1000) } else { $null }
                        sector3Ms     = if ($s3 -gt 0) { [int]($s3 * 1000) } else { $null }
                        bestSector1Ms = if ($fs1 -gt 0) { [int]($fs1 * 1000) } else { $null }
                        bestSector2Ms = if ($fs2 -gt 0) { [int]($fs2 * 1000) } else { $null }
                        bestSector3Ms = if ($fs3 -gt 0) { [int]($fs3 * 1000) } else { $null }
                        flagColour    = [int]$flagColour
                        flagReason    = [int]$flagReason
                        # Flag 6=YELLOW 7=DOUBLE_YELLOW. SM marca todos no mini-setor;
                        # so carros lentos/parados (<40 km/h) como proxy do causador.
                        causedYellow  = (($flagColour -eq 6 -or $flagColour -eq 7) -and $speedKmh -lt 40)
                        lapInvalidated = [bool]$lapInvalid
                    }
                    if ($i -eq $viewedIndex) {
                        if ($splitAhead -ge 0) {
                            $entry | Add-Member -NotePropertyName splitAhead -NotePropertyValue ([math]::Round($splitAhead, 2))
                        }
                        $fuelLevel = $accessor.ReadSingle($OFFSET_FUEL_LEVEL)
                        $fuelCap = $accessor.ReadSingle($OFFSET_FUEL_CAPACITY)
                        $tyre = Read-CString $accessor $OFFSET_TYRE_COMPOUND 40
                        $entry | Add-Member -NotePropertyName fuelPct -NotePropertyValue ([math]::Round($fuelLevel * 100, 1))
                        if ($fuelCap -gt 0) {
                            $entry | Add-Member -NotePropertyName fuelL -NotePropertyValue ([math]::Round($fuelLevel * $fuelCap, 1))
                        }
                        if ($tyre) {
                            $entry | Add-Member -NotePropertyName tyreCompound -NotePropertyValue $tyre
                        }
                    }
                    $standings += $entry
                }

                $accessor.Dispose()
                $mmf.Dispose()

                $standingsSorted = @($standings | Sort-Object position)

                $payload = [PSCustomObject]@{
                    session = [PSCustomObject]@{
                        state            = [int]$sessionState
                        label            = $SESSION_LABELS[[int]$sessionState]
                        timeRemainingSec = $timeRemainingSec
                        lapsInEvent      = [int]$lapsInEvent
                        scOut            = $scOut
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
