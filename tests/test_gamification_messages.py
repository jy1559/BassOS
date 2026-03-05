from __future__ import annotations

from bassos.services.gamification_messages import _stable_roll, long_session_probability


def test_long_session_probability_thresholds():
    assert long_session_probability(0) == 0.0
    assert long_session_probability(59) == 0.0
    assert long_session_probability(60) == 0.5
    assert long_session_probability(89) == 0.5
    assert long_session_probability(90) == 0.75
    assert long_session_probability(119) == 0.75
    assert long_session_probability(120) == 1.0
    assert long_session_probability(240) == 1.0


def test_stable_roll_is_deterministic():
    seed = "evt_20260306_abc:long"
    assert _stable_roll(seed) == _stable_roll(seed)
