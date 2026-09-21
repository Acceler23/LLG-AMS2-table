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

# Car telemetry (viewed only)
$OFFSET_UNFILTERED_THROTTLE      = 6428
$OFFSET_UNFILTERED_BRAKE         = 6432
$OFFSET_UNFILTERED_STEERING      = 6436
$OFFSET_UNFILTERED_CLUTCH        = 6440
$OFFSET_CAR_NAME                 = 6444
$OFFSET_CAR_CLASS_NAME           = 6508
$OFFSET_CAR_FLAGS                = 6816
$OFFSET_OIL_TEMP                 = 6820
$OFFSET_OIL_PRESSURE             = 6824
$OFFSET_WATER_TEMP               = 6828
$OFFSET_WATER_PRESSURE           = 6832
$OFFSET_FUEL_PRESSURE            = 6836
$OFFSET_SPEED                    = 6848
$OFFSET_RPM                      = 6852
$OFFSET_MAX_RPM                  = 6856
$OFFSET_BRAKE                    = 6860
$OFFSET_THROTTLE                 = 6864
$OFFSET_CLUTCH                   = 6868
$OFFSET_STEERING                 = 6872
$OFFSET_GEAR                     = 6876
$OFFSET_NUM_GEARS                = 6880
$OFFSET_ODOMETER                 = 6884
$OFFSET_ABS_ACTIVE               = 6888
$OFFSET_BOOST_ACTIVE             = 6900
$OFFSET_BOOST_AMOUNT             = 6904
$OFFSET_ORIENTATION              = 6908
$OFFSET_LOCAL_VELOCITY           = 6920
$OFFSET_LOCAL_ACCEL              = 6956
$OFFSET_TYRE_FLAGS               = 6992
$OFFSET_TERRAIN                  = 7008
$OFFSET_TYRE_RPS                 = 7040
$OFFSET_TYRE_TEMP                = 7072
$OFFSET_TYRE_WEAR                = 7136
$OFFSET_BRAKE_DAMAGE             = 7152
$OFFSET_SUSP_DAMAGE              = 7168
$OFFSET_BRAKE_TEMP               = 7184
$OFFSET_TYRE_TREAD_TEMP          = 7200
$OFFSET_TYRE_LAYER_TEMP          = 7216
$OFFSET_TYRE_CARCASS_TEMP        = 7232
$OFFSET_TYRE_RIM_TEMP            = 7248
$OFFSET_TYRE_AIR_TEMP            = 7264
$OFFSET_CRASH_STATE              = 7280
$OFFSET_AERO_DAMAGE              = 7284
$OFFSET_ENGINE_DAMAGE            = 7288
$OFFSET_SUSP_TRAVEL              = 7340
$OFFSET_SUSP_VELOCITY            = 7356
$OFFSET_AIR_PRESSURE             = 7372
$OFFSET_ENGINE_SPEED             = 7388
$OFFSET_ENGINE_TORQUE            = 7392
$OFFSET_WINGS                    = 7396
$OFFSET_HANDBRAKE                = 7404
$OFFSET_BRAKE_BIAS               = 19380
$OFFSET_TURBO_BOOST              = 19384
$OFFSET_TYRE_TEMP_LEFT           = 20584
$OFFSET_TYRE_TEMP_CENTER         = 20600
$OFFSET_TYRE_TEMP_RIGHT          = 20616
$OFFSET_DRS_STATE                = 20632
$OFFSET_RIDE_HEIGHT              = 20636
$OFFSET_ABS_SETTING              = 20660
$OFFSET_TC_SETTING               = 20664
$OFFSET_ERS_MODE                 = 20668
$OFFSET_ERS_AUTO                 = 20672
$OFFSET_CLUTCH_TEMP              = 20676
$OFFSET_CLUTCH_WEAR              = 20680
$OFFSET_CLUTCH_OVERHEATED        = 20684
$OFFSET_CLUTCH_SLIPPING          = 20685
$OFFSET_LAUNCH_STAGE             = 20696

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
                    $currentSector = $accessor.ReadInt32($base + 96)

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
                        currentSector = [int]$currentSector
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

                function Read-Float4($acc, $off) {
                    return @(
                        [math]::Round($acc.ReadSingle($off), 3),
                        [math]::Round($acc.ReadSingle($off + 4), 3),
                        [math]::Round($acc.ReadSingle($off + 8), 3),
                        [math]::Round($acc.ReadSingle($off + 12), 3)
                    )
                }
                function Read-UInt4($acc, $off) {
                    return @(
                        [int]$acc.ReadUInt32($off),
                        [int]$acc.ReadUInt32($off + 4),
                        [int]$acc.ReadUInt32($off + 8),
                        [int]$acc.ReadUInt32($off + 12)
                    )
                }
                function Read-Vec3($acc, $off) {
                    return @(
                        [math]::Round($acc.ReadSingle($off), 4),
                        [math]::Round($acc.ReadSingle($off + 4), 4),
                        [math]::Round($acc.ReadSingle($off + 8), 4)
                    )
                }

                $car = [PSCustomObject]@{
                    carName        = Read-CString $accessor $OFFSET_CAR_NAME 64
                    carClass       = Read-CString $accessor $OFFSET_CAR_CLASS_NAME 64
                    throttle       = [math]::Round($accessor.ReadSingle($OFFSET_THROTTLE), 3)
                    brake          = [math]::Round($accessor.ReadSingle($OFFSET_BRAKE), 3)
                    clutch         = [math]::Round($accessor.ReadSingle($OFFSET_CLUTCH), 3)
                    steering       = [math]::Round($accessor.ReadSingle($OFFSET_STEERING), 3)
                    handbrake      = [math]::Round($accessor.ReadSingle($OFFSET_HANDBRAKE), 3)
                    unfThrottle    = [math]::Round($accessor.ReadSingle($OFFSET_UNFILTERED_THROTTLE), 3)
                    unfBrake       = [math]::Round($accessor.ReadSingle($OFFSET_UNFILTERED_BRAKE), 3)
                    unfClutch      = [math]::Round($accessor.ReadSingle($OFFSET_UNFILTERED_CLUTCH), 3)
                    unfSteering    = [math]::Round($accessor.ReadSingle($OFFSET_UNFILTERED_STEERING), 3)
                    rpm            = [math]::Round($accessor.ReadSingle($OFFSET_RPM), 0)
                    maxRpm         = [math]::Round($accessor.ReadSingle($OFFSET_MAX_RPM), 0)
                    engineSpeed    = [math]::Round($accessor.ReadSingle($OFFSET_ENGINE_SPEED), 2)
                    engineTorque   = [math]::Round($accessor.ReadSingle($OFFSET_ENGINE_TORQUE), 1)
                    speedMs        = [math]::Round($accessor.ReadSingle($OFFSET_SPEED), 2)
                    speedKmh       = [math]::Round($accessor.ReadSingle($OFFSET_SPEED) * 3.6, 1)
                    gear           = [int]$accessor.ReadInt32($OFFSET_GEAR)
                    numGears       = [int]$accessor.ReadInt32($OFFSET_NUM_GEARS)
                    odometerKm     = [math]::Round($accessor.ReadSingle($OFFSET_ODOMETER), 2)
                    oilTempC       = [math]::Round($accessor.ReadSingle($OFFSET_OIL_TEMP), 1)
                    oilPressureKPa = [math]::Round($accessor.ReadSingle($OFFSET_OIL_PRESSURE), 1)
                    waterTempC     = [math]::Round($accessor.ReadSingle($OFFSET_WATER_TEMP), 1)
                    waterPressureKPa = [math]::Round($accessor.ReadSingle($OFFSET_WATER_PRESSURE), 1)
                    fuelPressureKPa  = [math]::Round($accessor.ReadSingle($OFFSET_FUEL_PRESSURE), 1)
                    fuelLevel      = [math]::Round($accessor.ReadSingle($OFFSET_FUEL_LEVEL), 4)
                    fuelCapacityL  = [math]::Round($accessor.ReadSingle($OFFSET_FUEL_CAPACITY), 1)
                    fuelPct        = [math]::Round($accessor.ReadSingle($OFFSET_FUEL_LEVEL) * 100, 1)
                    carFlags       = [int]$accessor.ReadUInt32($OFFSET_CAR_FLAGS)
                    absActive      = ($accessor.ReadByte($OFFSET_ABS_ACTIVE) -ne 0)
                    boostActive    = ($accessor.ReadByte($OFFSET_BOOST_ACTIVE) -ne 0)
                    boostAmount    = [math]::Round($accessor.ReadSingle($OFFSET_BOOST_AMOUNT), 1)
                    turboBoost     = [math]::Round($accessor.ReadSingle($OFFSET_TURBO_BOOST), 3)
                    brakeBias      = [math]::Round($accessor.ReadSingle($OFFSET_BRAKE_BIAS), 3)
                    wings          = @(
                        [math]::Round($accessor.ReadSingle($OFFSET_WINGS), 3),
                        [math]::Round($accessor.ReadSingle($OFFSET_WINGS + 4), 3)
                    )
                    crashState     = [int]$accessor.ReadUInt32($OFFSET_CRASH_STATE)
                    aeroDamage     = [math]::Round($accessor.ReadSingle($OFFSET_AERO_DAMAGE), 3)
                    engineDamage   = [math]::Round($accessor.ReadSingle($OFFSET_ENGINE_DAMAGE), 3)
                    orientation    = Read-Vec3 $accessor $OFFSET_ORIENTATION
                    localVelocity  = Read-Vec3 $accessor $OFFSET_LOCAL_VELOCITY
                    localAccel     = Read-Vec3 $accessor $OFFSET_LOCAL_ACCEL
                    tyreFlags      = Read-UInt4 $accessor $OFFSET_TYRE_FLAGS
                    terrain        = Read-UInt4 $accessor $OFFSET_TERRAIN
                    tyreRps        = Read-Float4 $accessor $OFFSET_TYRE_RPS
                    tyreTemp       = Read-Float4 $accessor $OFFSET_TYRE_TEMP
                    tyreTempLeft   = Read-Float4 $accessor $OFFSET_TYRE_TEMP_LEFT
                    tyreTempCenter = Read-Float4 $accessor $OFFSET_TYRE_TEMP_CENTER
                    tyreTempRight  = Read-Float4 $accessor $OFFSET_TYRE_TEMP_RIGHT
                    tyreWear       = Read-Float4 $accessor $OFFSET_TYRE_WEAR
                    tyreTreadTemp  = Read-Float4 $accessor $OFFSET_TYRE_TREAD_TEMP
                    tyreLayerTemp  = Read-Float4 $accessor $OFFSET_TYRE_LAYER_TEMP
                    tyreCarcassTemp = Read-Float4 $accessor $OFFSET_TYRE_CARCASS_TEMP
                    tyreRimTemp    = Read-Float4 $accessor $OFFSET_TYRE_RIM_TEMP
                    tyreAirTemp    = Read-Float4 $accessor $OFFSET_TYRE_AIR_TEMP
                    airPressurePsi = Read-Float4 $accessor $OFFSET_AIR_PRESSURE
                    brakeTempC     = Read-Float4 $accessor $OFFSET_BRAKE_TEMP
                    brakeDamage    = Read-Float4 $accessor $OFFSET_BRAKE_DAMAGE
                    suspDamage     = Read-Float4 $accessor $OFFSET_SUSP_DAMAGE
                    suspTravel     = Read-Float4 $accessor $OFFSET_SUSP_TRAVEL
                    suspVelocity   = Read-Float4 $accessor $OFFSET_SUSP_VELOCITY
                    rideHeightCm   = Read-Float4 $accessor $OFFSET_RIDE_HEIGHT
                    tyreCompound   = @(
                        (Read-CString $accessor $OFFSET_TYRE_COMPOUND 40),
                        (Read-CString $accessor ($OFFSET_TYRE_COMPOUND + 40) 40),
                        (Read-CString $accessor ($OFFSET_TYRE_COMPOUND + 80) 40),
                        (Read-CString $accessor ($OFFSET_TYRE_COMPOUND + 120) 40)
                    )
                    drsState       = [int]$accessor.ReadUInt32($OFFSET_DRS_STATE)
                    absSetting     = [int]$accessor.ReadInt32($OFFSET_ABS_SETTING)
                    tcSetting      = [int]$accessor.ReadInt32($OFFSET_TC_SETTING)
                    ersMode        = [int]$accessor.ReadInt32($OFFSET_ERS_MODE)
                    ersAuto        = ($accessor.ReadByte($OFFSET_ERS_AUTO) -ne 0)
                    clutchTempK    = [math]::Round($accessor.ReadSingle($OFFSET_CLUTCH_TEMP), 1)
                    clutchWear     = [math]::Round($accessor.ReadSingle($OFFSET_CLUTCH_WEAR), 3)
                    clutchOverheated = ($accessor.ReadByte($OFFSET_CLUTCH_OVERHEATED) -ne 0)
                    clutchSlipping = ($accessor.ReadByte($OFFSET_CLUTCH_SLIPPING) -ne 0)
                    launchStage    = [int]$accessor.ReadInt32($OFFSET_LAUNCH_STAGE)
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
                    car       = $car
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
