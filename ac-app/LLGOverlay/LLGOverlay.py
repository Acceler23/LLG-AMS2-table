# LLG Overlay - app do Assetto Corsa (o primeiro)
#
# O Assetto Corsa so mostra para programas de fora os dados do carro do
# jogador. Os dados de TODOS os carros so existem para apps Python que rodam
# dentro do jogo. Este app nao tem janela: a cada 0,1 s ele le os carros e
# manda uma linha de JSON para o servidor da overlay (server/acClient.js).
#
# O envio e por um "named pipe" do Windows, aberto como um arquivo comum. O
# Python que vem com o jogo nao tem o modulo de rede, e assim nao e preciso
# instalar nada alem desta pasta.
#
# Instalacao: copie a pasta LLGOverlay para <Assetto Corsa>\apps\python\ e
# ative o app em Opcoes > Geral > UI Modules (ou [LLGOVERLAY] ACTIVE=1 em
# Documentos\Assetto Corsa\cfg\python.ini).

import json
import os
import time

import ac
import acsys

PIPE = r"\\.\pipe\llg-overlay-ac"
INTERVAL = 0.1  # segundos entre envios
RETRY = 2.0  # espera para tentar de novo quando o servidor nao esta aberto

_pipe = None
_next_try = 0.0
_elapsed = 0.0
_root = ""
_logged = set()


def _log(text):
    # cada aviso aparece uma vez so em Documentos\Assetto Corsa\logs\py_log.txt
    if text in _logged:
        return
    _logged.add(text)
    try:
        ac.log("LLG Overlay: " + text)
    except Exception:
        pass


def _call(name, *args):
    # versoes antigas do jogo nao tem todas as funcoes: a que faltar vira None
    fn = getattr(ac, name, None)
    if fn is None:
        return None
    try:
        return fn(*args)
    except Exception:
        return None


def _state(car, name):
    code = getattr(acsys.CS, name, None)
    if code is None:
        return None
    try:
        return ac.getCarState(car, code)
    except Exception:
        return None


def _num(value, digits=None):
    try:
        value = float(value)
    except Exception:
        return 0
    if value != value or value in (float("inf"), float("-inf")):
        return 0
    return round(value, digits) if digits else int(value)


def _splits(value):
    if not value:
        return None
    try:
        return [_num(v) for v in value]
    except Exception:
        return None


def _snapshot():
    count = _call("getCarsCount") or 0
    cars = []
    for i in range(count):
        cars.append(
            {
                "id": i,
                "name": _call("getDriverName", i) or "",
                "model": _call("getCarName", i) or "",
                "skin": _call("getCarSkin", i) or "",
                "connected": 1 if _call("isConnected", i) else 0,
                "laps": _num(_state(i, "LapCount")),
                "spline": _num(_state(i, "NormalizedSplinePosition"), 5),
                "kmh": _num(_state(i, "SpeedKMH"), 1),
                "lapMs": _num(_state(i, "LapTime")),
                "lastMs": _num(_state(i, "LastLap")),
                "bestMs": _num(_state(i, "BestLap")),
                "posBoard": _call("getCarLeaderboardPosition", i),
                "posRace": _call("getCarRealTimeLeaderboardPosition", i),
                "pitLane": 1 if _call("isCarInPitline", i) else 0,
                "pitBox": 1 if _call("isCarInPit", i) else 0,
                "finished": 1 if _state(i, "RaceFinished") else 0,
                "invalid": 1 if _state(i, "LapInvalidated") else 0,
                "lastSplits": _splits(_call("getLastSplits", i)),
                "curSplits": _splits(_call("getCurrentSplits", i)),
                "tyre": _call("getCarTyreCompound", i) or "",
            }
        )
    return {
        "v": 1,
        "root": _root,
        "track": _call("getTrackName", 0) or "",
        "config": _call("getTrackConfiguration", 0) or "",
        "length": _num(_call("getTrackLength", 0), 1),
        "focused": _call("getFocusedCar"),
        "cars": cars,
    }


def _close():
    global _pipe
    if _pipe is not None:
        try:
            _pipe.close()
        except Exception:
            pass
    _pipe = None


def _send(line):
    global _pipe, _next_try
    now = time.time()
    if _pipe is None:
        if now < _next_try:
            return
        try:
            _pipe = open(PIPE, "wb", 0)
        except Exception:
            # servidor da overlay fechado: tenta de novo daqui a pouco
            _pipe = None
            _next_try = now + RETRY
            return
    try:
        _pipe.write(line)
    except Exception:
        _close()
        _next_try = now + RETRY


def acMain(ac_version):
    global _root
    try:
        _root = os.getcwd()
    except Exception:
        _root = ""
    return "LLG Overlay"


def acUpdate(deltaT):
    global _elapsed
    _elapsed += deltaT
    if _elapsed < INTERVAL:
        return
    _elapsed = 0.0
    try:
        line = (json.dumps(_snapshot()) + "\n").encode("ascii")
    except Exception as err:
        _log("erro ao ler os carros: " + repr(err))
        return
    _send(line)


def acShutdown():
    _close()
