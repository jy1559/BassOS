from __future__ import annotations

import copy
from datetime import date
from typing import Any

MINIGAME_RECORD_HEADERS = [
    "record_id",
    "created_at",
    "game",
    "mode",
    "difficulty",
    "score",
    "accuracy",
    "seed",
    "duration_sec",
    "share_text",
    "detail_json",
    "source",
]

ALLOWED_GAMES = {"FBH", "RC", "LM"}
ALLOWED_MODE = {"CHALLENGE"}

MINIGAME_CONFIG_DEFAULTS: dict[str, Any] = {
    "challenge_seconds": 120,
    "tick": {
        "beat": 48,
        "measure": 192,
    },
    "fretboard": {
        "max_visible_fret": 21,
    },
    "difficulties": {
        "FBH": ["EASY", "NORMAL", "HARD", "VERY_HARD", "MASTER"],
        "RC": ["EASY", "NORMAL", "HARD", "VERY_HARD", "MASTER"],
        "LM": ["EASY", "NORMAL", "HARD", "VERY_HARD", "MASTER"],
    },
    "rhythm_windows_ms": {
        "EASY": 105,
        "NORMAL": 85,
        "HARD": 65,
        "VERY_HARD": 52,
        "MASTER": 45,
    },
    "rhythm": {
        "preroll_beats": 4,
        "challenge_problem_count": 5,
        "challenge_attempts_per_problem": 1,
        "calibration": {
            "bpm": 140,
            "capture_sec": 8,
            "rank_std_ms": {
                "S": 14,
                "A": 24,
                "B": 36,
                "C": 52,
            },
        },
    },
}

MINIGAME_USER_SETTINGS_DEFAULTS: dict[str, Any] = {
    "version": 3,
    "fretboard": {
        "maxVisibleFret": 21,
        "detectMode": "HYBRID",
        "showHitZones": False,
        "showFretNotes": False,
        "fretLineWidth": 2.4,
        "fretToneVolume": 0.2,
        "boardPreset": "CLASSIC",
        "inlayPreset": "DOT",
    },
    "rhythm": {
        "notationMode": "BASS_STAFF",
        "showPlayhead": True,
        "showAnswerHighlight": True,
        "showMetronomeVisual": True,
        "metronomeVolume": 0.9,
        "prerollBeats": 4,
        "challengeProblemCount": 5,
        "challengeAttemptsPerProblem": 1,
        "windowsMs": {
            "EASY": 105,
            "NORMAL": 85,
            "HARD": 65,
            "VERY_HARD": 52,
            "MASTER": 45,
        },
    },
    "theory": {
        "chordSpreadMs": 50,
        "scaleSpreadMs": 120,
    },
    "fbh": {
        "ranges": {
            "EASY": {
                "minFret": 0,
                "maxFret": 4,
                "judges": ["PC_RANGE"],
                "pcRange": {
                    "minFret": 3,
                    "maxFret": 10,
                    "windowMinSize": 4,
                    "windowMaxSize": 6,
                },
                "near": {
                    "l1Distance": 4,
                    "fretDirection": "ANY",
                    "stringDirection": "ANY",
                },
                "code": {
                    "levels": {
                        "basic": True,
                        "extended": False,
                        "modal": False,
                    },
                    "degreeWeights": {
                        "chordToneWeight": 4,
                        "extDegreeWeight": 1,
                        "sharpWeight": 1,
                        "flatWeight": 1,
                    },
                },
                "rootNear": {
                    "includeOctave": True,
                    "allow9Plus": True,
                    "degree9PlusRate": 0.18,
                    "degreeWeights": {
                        "chordToneWeight": 4,
                        "extDegreeWeight": 1,
                        "sharpWeight": 1,
                        "flatWeight": 1,
                    },
                    "near": {
                        "l1Distance": 4,
                        "fretDirection": "ANY",
                        "stringDirection": "ANY",
                    },
                },
            },
            "NORMAL": {
                "minFret": 0,
                "maxFret": 8,
                "judges": ["PC_RANGE", "MIDI"],
                "pcRange": {
                    "minFret": 4,
                    "maxFret": 12,
                    "windowMinSize": 4,
                    "windowMaxSize": 6,
                },
                "near": {
                    "l1Distance": 4,
                    "fretDirection": "ANY",
                    "stringDirection": "ANY",
                },
                "code": {
                    "levels": {
                        "basic": True,
                        "extended": False,
                        "modal": False,
                    },
                    "degreeWeights": {
                        "chordToneWeight": 4,
                        "extDegreeWeight": 1,
                        "sharpWeight": 1,
                        "flatWeight": 1,
                    },
                },
                "rootNear": {
                    "includeOctave": True,
                    "allow9Plus": True,
                    "degree9PlusRate": 0.18,
                    "degreeWeights": {
                        "chordToneWeight": 4,
                        "extDegreeWeight": 1,
                        "sharpWeight": 1,
                        "flatWeight": 1,
                    },
                    "near": {
                        "l1Distance": 4,
                        "fretDirection": "ANY",
                        "stringDirection": "ANY",
                    },
                },
            },
            "HARD": {
                "minFret": 0,
                "maxFret": 12,
                "judges": ["PC_RANGE", "MIDI", "PC_NEAR"],
                "pcRange": {
                    "minFret": 5,
                    "maxFret": 14,
                    "windowMinSize": 4,
                    "windowMaxSize": 6,
                },
                "near": {
                    "l1Distance": 4,
                    "fretDirection": "ANY",
                    "stringDirection": "ANY",
                },
                "code": {
                    "levels": {
                        "basic": True,
                        "extended": False,
                        "modal": False,
                    },
                    "degreeWeights": {
                        "chordToneWeight": 4,
                        "extDegreeWeight": 1,
                        "sharpWeight": 1,
                        "flatWeight": 1,
                    },
                },
                "rootNear": {
                    "includeOctave": True,
                    "allow9Plus": True,
                    "degree9PlusRate": 0.18,
                    "degreeWeights": {
                        "chordToneWeight": 4,
                        "extDegreeWeight": 1,
                        "sharpWeight": 1,
                        "flatWeight": 1,
                    },
                    "near": {
                        "l1Distance": 4,
                        "fretDirection": "ANY",
                        "stringDirection": "ANY",
                    },
                },
            },
            "VERY_HARD": {
                "minFret": 0,
                "maxFret": 15,
                "judges": ["PC_RANGE", "PC_NEAR", "MIDI_NEAR", "CODE"],
                "pcRange": {
                    "minFret": 5,
                    "maxFret": 17,
                    "windowMinSize": 4,
                    "windowMaxSize": 6,
                },
                "near": {
                    "l1Distance": 4,
                    "fretDirection": "ANY",
                    "stringDirection": "ANY",
                },
                "code": {
                    "levels": {
                        "basic": True,
                        "extended": False,
                        "modal": False,
                    },
                    "degreeWeights": {
                        "chordToneWeight": 4,
                        "extDegreeWeight": 1,
                        "sharpWeight": 1,
                        "flatWeight": 1,
                    },
                },
                "rootNear": {
                    "includeOctave": True,
                    "allow9Plus": True,
                    "degree9PlusRate": 0.18,
                    "degreeWeights": {
                        "chordToneWeight": 4,
                        "extDegreeWeight": 1,
                        "sharpWeight": 1,
                        "flatWeight": 1,
                    },
                    "near": {
                        "l1Distance": 4,
                        "fretDirection": "ANY",
                        "stringDirection": "ANY",
                    },
                },
            },
            "MASTER": {
                "minFret": 0,
                "maxFret": 21,
                "judges": ["PC_RANGE", "PC_NEAR", "MIDI_NEAR", "CODE", "CODE_MIDI", "ROOT_NEAR"],
                "pcRange": {
                    "minFret": 5,
                    "maxFret": 21,
                    "windowMinSize": 4,
                    "windowMaxSize": 6,
                },
                "near": {
                    "l1Distance": 4,
                    "fretDirection": "ANY",
                    "stringDirection": "ANY",
                },
                "code": {
                    "levels": {
                        "basic": True,
                        "extended": False,
                        "modal": False,
                    },
                    "degreeWeights": {
                        "chordToneWeight": 4,
                        "extDegreeWeight": 1,
                        "sharpWeight": 1,
                        "flatWeight": 1,
                    },
                },
                "rootNear": {
                    "includeOctave": True,
                    "allow9Plus": True,
                    "degree9PlusRate": 0.18,
                    "degreeWeights": {
                        "chordToneWeight": 4,
                        "extDegreeWeight": 1,
                        "sharpWeight": 1,
                        "flatWeight": 1,
                    },
                    "near": {
                        "l1Distance": 4,
                        "fretDirection": "ANY",
                        "stringDirection": "ANY",
                    },
                },
            },
        },
        "challenge": {
            "correctScore": 2,
            "wrongPenalty": 1,
            "timeLimitSec": 120,
            "lives": 0,
        },
        "practice": {
            "checkMode": "CONFIRM",
            "showAnswerButton": True,
            "revealAnswersOnCorrect": True,
            "requireNextAfterReveal": True,
        },
    },
    "lm": {
        "maxFretByDifficulty": {
            "EASY": 7,
            "NORMAL": 10,
            "HARD": 12,
            "VERY_HARD": 15,
            "MASTER": 21,
        },
        "explainOn": True,
    },
}

GAME_IMAGE_FILENAMES = {
    "FBH": "pret_hunt.png",
    "RC": "rhythm.png",
    "LM": "line.png",
}


def deep_copy_json(value: Any) -> Any:
    return copy.deepcopy(value)


def merge_defaults(base: Any, defaults: Any) -> Any:
    if isinstance(defaults, dict):
        source = base if isinstance(base, dict) else {}
        merged: dict[str, Any] = {}
        for key, default_value in defaults.items():
            merged[key] = merge_defaults(source.get(key), default_value)
        for key, value in source.items():
            if key not in merged:
                merged[key] = deep_copy_json(value)
        return merged
    return deep_copy_json(defaults if base is None else base)


def normalize_minigame_user_settings(raw: Any) -> dict[str, Any]:
    return merge_defaults(raw if isinstance(raw, dict) else {}, MINIGAME_USER_SETTINGS_DEFAULTS)


def normalize_minigame_config(raw: Any) -> dict[str, Any]:
    return merge_defaults(raw if isinstance(raw, dict) else {}, MINIGAME_CONFIG_DEFAULTS)


def hash_seed(text: str) -> int:
    value = 2166136261
    for ch in text:
        value ^= ord(ch)
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def normalize_seed_text(seed_text: str | None) -> str:
    raw = str(seed_text or "").strip()
    return raw or date.today().isoformat()


def seed_payload(seed_text: str | None) -> dict[str, int | str]:
    normalized = normalize_seed_text(seed_text)
    return {
        "seed": normalized,
        "numeric_seed": hash_seed(normalized),
    }
