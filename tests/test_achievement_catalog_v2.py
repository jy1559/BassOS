from __future__ import annotations

import csv
from collections import Counter, defaultdict
from pathlib import Path


def test_achievement_catalog_v2_shape():
    path = Path('app/data/achievements_master.csv')
    assert path.exists()
    rows = list(csv.DictReader(path.open(encoding='utf-8-sig')))
    assert len(rows) == 136

    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        groups[str(row.get('group_id') or '')].append(row)

    size_dist = Counter(len(items) for items in groups.values())
    assert size_dist[6] == 18
    assert size_dist[3] == 1
    assert size_dist[1] == 25

    tier_rows = [row for row in rows if str(row.get('achievement_id', '')).startswith('ACH_TIER_')]
    one_rows = [row for row in rows if str(row.get('achievement_id', '')).startswith('ACH_ONE_')]
    hidden_rows = [row for row in rows if str(row.get('achievement_id', '')).startswith('ACH_HID_')]

    assert len(tier_rows) == 108
    assert len(one_rows) == 12
    assert len(hidden_rows) == 8

    assert sum(1 for row in rows if str(row.get('is_hidden', '')).lower() == 'true') == 8
    assert sum(1 for row in rows if str(row.get('rule_type', '')).lower() == 'manual') == 0

    # Tier rows should be grouped by six tiers.
    tier_groups = defaultdict(list)
    for row in tier_rows:
        tier_groups[row['group_id']].append(row)
    assert len(tier_groups) == 18
    assert all(len(items) == 6 for items in tier_groups.values())
    assert all('BOSS' not in str(row.get('achievement_id', '')).upper() for row in rows)
    ids = {str(row.get('achievement_id') or '') for row in rows}
    assert 'ACH_ONE_QUEST_HIGH_FIRST' in ids
    assert 'ACH_ONE_BRIDGE_NOTE' in ids
    assert 'ACH_ONE_TRIPLE_ROUTE' in ids
    assert 'ACH_ONE_PAGE_STACK' in ids
    assert 'ACH_HID_QUEST_GENRE_TRIO' in ids
    assert 'ACH_HID_CALL_RESPONSE' in ids
    assert 'ACH_HID_HEAD_TO_HAND' in ids
    assert 'ACH_MG_PLAY_ALL_THREE' in ids
    assert 'ACH_MG_HARD_PLUS_10' in ids
    assert 'ACH_MG_FBH_FIRST_PLAY' not in ids
    assert 'ACH_MG_RC_FIRST_PLAY' not in ids
    assert 'ACH_MG_LM_FIRST_PLAY' not in ids
