"""Achievement evaluation and claiming."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from bassos.services.calculations import evaluate_rule, to_int
from bassos.services.events import create_event_row, filter_finalized_events
from bassos.services.storage import Storage
from bassos.utils.time_utils import parse_dt

_LEGACY_DESCRIPTION_MARKERS = (
    "(이벤트:",
    "고유 필드:",
    "조건 트리",
    "기본 조건",
    "조건을 만족한 이벤트를",
)

_TAG_LABELS_KO = {
    "AB_COMPARE": "A/B 비교",
    "BAND": "합주",
    "CLEAN_MUTE": "클린 뮤트",
    "COMMUNITY": "커뮤니티",
    "CORE": "코어",
    "EAR_COPY": "귀카피",
    "METRO_ONEBAR": "원바 메트로놈",
    "METRO_24": "2&4 메트로놈",
    "PERFORMANCE": "무대",
    "RECORDING_AUDIO": "오디오 기록",
    "RECORDING_VIDEO": "영상 기록",
    "SLAP": "슬랩",
    "SONG_PRACTICE": "곡 연습",
    "THEORY": "이론",
}

_MINIGAME_GAME_LABELS_KO = {
    "FBH": "프렛보드 헌트",
    "RC": "리듬 카피",
    "LM": "라인 매퍼",
}
_MINIGAME_MODE_LABELS_KO = {
    "PRACTICE": "연습",
    "CHALLENGE": "점수 모드",
}
_MINIGAME_DIFFICULTY_LABELS_KO = {
    "EASY": "쉬움",
    "NORMAL": "보통",
    "HARD": "어려움",
    "VERY_HARD": "매우 어려움",
    "MASTER": "마스터",
}
_RECORD_MEDIA_LABELS_KO = {
    "audio": "오디오",
    "video": "영상",
    "image": "이미지",
}
_RECORD_ATTACHMENT_KIND_LABELS_KO = {
    "upload": "업로드 파일",
    "external_link": "외부 링크",
}


@dataclass
class AchievementState:
    achievement_id: str
    group_id: str
    name: str
    description: str
    hint: str
    category: str
    tier: int
    tier_name: str
    target: int
    display_order: int
    progress: int
    unlocked: bool
    claimed: bool
    claimed_at: str
    hidden: bool
    auto_grant: bool
    xp_reward: int
    effective_xp_reward: int
    ui_badge_style: str
    rule_type: str
    evidence_hint: str
    icon_path: str
    icon_url: str
    icon_emoji: str


def _safe_json(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def _split_semicolon_list(raw: str | None) -> list[str]:
    return [token.strip() for token in str(raw or "").split(";") if token.strip()]


def _record_attachment_kind(row: dict[str, str]) -> str:
    if str(row.get("path") or "").strip():
        return "upload"
    if str(row.get("url") or "").strip():
        return "external_link"
    return ""


def _build_record_meta(post: dict[str, str], attachments: list[dict[str, str]]) -> dict[str, Any]:
    upload_count = 0
    external_count = 0
    audio_upload_count = 0
    video_upload_count = 0
    image_upload_count = 0
    audio_total_count = 0
    video_total_count = 0
    image_total_count = 0

    for attachment in attachments:
        media_type = str(attachment.get("media_type") or "").strip().lower()
        attachment_kind = _record_attachment_kind(attachment)
        if attachment_kind == "upload":
            upload_count += 1
        elif attachment_kind == "external_link":
            external_count += 1

        if media_type == "audio":
            audio_total_count += 1
            if attachment_kind == "upload":
                audio_upload_count += 1
        elif media_type == "video":
            video_total_count += 1
            if attachment_kind == "upload":
                video_upload_count += 1
        elif media_type == "image":
            image_total_count += 1
            if attachment_kind == "upload":
                image_upload_count += 1

    header_label = str(post.get("post_type") or "").strip()
    return {
        "post_id": str(post.get("post_id") or "").strip(),
        "post_type": header_label,
        "header_id": str(post.get("header_id") or "").strip(),
        "header_label": header_label,
        "template_id": str(post.get("template_id") or "").strip(),
        "tags": _split_semicolon_list(post.get("tags")),
        "linked_song_ids": _split_semicolon_list(post.get("linked_song_ids")),
        "linked_drill_ids": _split_semicolon_list(post.get("linked_drill_ids")),
        "attachment_count": len(attachments),
        "upload_count": upload_count,
        "external_count": external_count,
        "audio_upload_count": audio_upload_count,
        "video_upload_count": video_upload_count,
        "image_upload_count": image_upload_count,
        "audio_total_count": audio_total_count,
        "video_total_count": video_total_count,
        "image_total_count": image_total_count,
        "has_audio_upload": audio_upload_count > 0,
        "has_video_upload": video_upload_count > 0,
        "has_image_upload": image_upload_count > 0,
    }


def _build_record_source_events(storage: Storage) -> list[dict[str, str]]:
    posts = storage.read_csv("record_posts.csv")
    attachments = storage.read_csv("record_attachments.csv")
    attachments_by_post: dict[str, list[dict[str, str]]] = {}
    for attachment in attachments:
        post_id = str(attachment.get("post_id") or "").strip()
        if not post_id:
            continue
        attachments_by_post.setdefault(post_id, []).append(attachment)

    derived: list[dict[str, str]] = []
    for post in posts:
        post_id = str(post.get("post_id") or "").strip()
        if not post_id:
            continue
        post_attachments = attachments_by_post.get(post_id, [])
        post_meta = _build_record_meta(post, post_attachments)
        created_at = (
            parse_dt(post.get("created_at"))
            or parse_dt(post.get("updated_at"))
            or datetime.now()
        )
        post_event = create_event_row(
            created_at=created_at,
            event_type="RECORD_POST",
            activity="Journal",
            xp=0,
            title=str(post.get("title") or post.get("post_type") or "Journal Post"),
            notes="",
            tags=["JOURNAL", *[str(tag).upper() for tag in post_meta.get("tags", [])]],
            meta={"record": post_meta},
            source=str(post.get("source") or "app"),
        )
        post_event["event_id"] = f"RECPOST_{post_id}"
        derived.append(post_event)

        for attachment in post_attachments:
            attachment_id = str(attachment.get("attachment_id") or "").strip()
            if not attachment_id:
                continue
            media_type = str(attachment.get("media_type") or "").strip().lower()
            attachment_kind = _record_attachment_kind(attachment)
            attachment_meta = {
                **post_meta,
                "attachment_id": attachment_id,
                "media_type": media_type,
                "attachment_kind": attachment_kind,
            }
            attachment_created_at = parse_dt(attachment.get("created_at")) or created_at
            attachment_event = create_event_row(
                created_at=attachment_created_at,
                event_type="RECORD_ATTACHMENT",
                activity="Journal",
                xp=0,
                title=str(attachment.get("title") or post.get("title") or f"Journal {media_type.title()}"),
                notes="",
                tags=[
                    "JOURNAL",
                    "ATTACHMENT",
                    media_type.upper(),
                    attachment_kind.upper() if attachment_kind else "",
                    *[str(tag).upper() for tag in post_meta.get("tags", [])],
                ],
                evidence_type=media_type if attachment_kind == "upload" else "",
                evidence_path=str(attachment.get("path") or ""),
                evidence_url=str(attachment.get("url") or ""),
                meta={"record": attachment_meta},
                source=str(post.get("source") or "app"),
            )
            attachment_event["event_id"] = f"RECATT_{attachment_id}"
            derived.append(attachment_event)

    return derived


def achievement_source_events(storage: Storage) -> list[dict[str, str]]:
    events = filter_finalized_events(storage.read_csv("events.csv"))
    return [*events, *_build_record_source_events(storage)]


def _needs_user_facing_description(raw: str | None) -> bool:
    text = str(raw or "").strip()
    if not text:
        return True
    return any(marker in text for marker in _LEGACY_DESCRIPTION_MARKERS)


def _format_target(value: int) -> str:
    return f"{max(0, int(value)):,}"


def _tag_label_ko(token: str) -> str:
    cleaned = str(token or "").strip().upper()
    if not cleaned:
        return ""
    return _TAG_LABELS_KO.get(cleaned, cleaned.replace("_", " "))


def _join_tag_labels_ko(tags: list[str]) -> str:
    labels: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        label = _tag_label_ko(tag)
        if not label or label in seen:
            continue
        seen.add(label)
        labels.append(label)
    if not labels:
        return ""
    if len(labels) == 1:
        return labels[0]
    if len(labels) == 2:
        return f"{labels[0]}/{labels[1]}"
    return ", ".join(labels[:3]) if len(labels) <= 3 else f"{', '.join(labels[:2])} 외 {len(labels) - 2}개"


def _minigame_game_label_ko(token: str | None) -> str:
    return _MINIGAME_GAME_LABELS_KO.get(str(token or "").strip().upper(), "")


def _minigame_mode_label_ko(token: str | None) -> str:
    return _MINIGAME_MODE_LABELS_KO.get(str(token or "").strip().upper(), "")


def _minigame_difficulty_subject_ko(tokens: list[str]) -> str:
    cleaned = [str(token or "").strip().upper() for token in tokens if str(token or "").strip()]
    unique = list(dict.fromkeys(cleaned))
    if not unique:
        return ""
    if set(unique) == {"HARD", "VERY_HARD", "MASTER"}:
        return "HARD 이상 난이도 미니게임"
    labels = [_MINIGAME_DIFFICULTY_LABELS_KO.get(token, token) for token in unique]
    if len(labels) == 1:
        return f"{labels[0]} 난이도 미니게임"
    return f"{'/'.join(labels)} 난이도 미니게임"


def _record_media_label_ko(token: str | None) -> str:
    return _RECORD_MEDIA_LABELS_KO.get(str(token or "").strip().lower(), str(token or "").strip())


def _record_attachment_kind_label_ko(token: str | None) -> str:
    return _RECORD_ATTACHMENT_KIND_LABELS_KO.get(str(token or "").strip().lower(), str(token or "").strip())


def _merge_condition_tree_hints(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    for tag in extra.get("tags", []):
        if tag not in base["tags"]:
            base["tags"].append(tag)
    base["min_duration"] = max(to_int(base.get("min_duration"), 0), to_int(extra.get("min_duration"), 0))
    base["min_hour"] = max(to_int(base.get("min_hour"), 0), to_int(extra.get("min_hour"), 0))
    if not base.get("quest_difficulty") and extra.get("quest_difficulty"):
        base["quest_difficulty"] = extra["quest_difficulty"]
    if not base.get("minigame_game") and extra.get("minigame_game"):
        base["minigame_game"] = extra["minigame_game"]
    if not base.get("minigame_mode") and extra.get("minigame_mode"):
        base["minigame_mode"] = extra["minigame_mode"]
    for difficulty in extra.get("minigame_difficulties", []):
        if difficulty not in base["minigame_difficulties"]:
            base["minigame_difficulties"].append(difficulty)
    base["minigame_score_min"] = max(to_int(base.get("minigame_score_min"), 0), to_int(extra.get("minigame_score_min"), 0))
    base["minigame_accuracy_min"] = max(
        to_int(base.get("minigame_accuracy_min"), 0), to_int(extra.get("minigame_accuracy_min"), 0)
    )
    base["minigame_correct_min"] = max(to_int(base.get("minigame_correct_min"), 0), to_int(extra.get("minigame_correct_min"), 0))
    for media_type in extra.get("record_media_types", []):
        if media_type not in base["record_media_types"]:
            base["record_media_types"].append(media_type)
    if not base.get("record_attachment_kind") and extra.get("record_attachment_kind"):
        base["record_attachment_kind"] = extra["record_attachment_kind"]
    base["record_audio_upload_min"] = max(
        to_int(base.get("record_audio_upload_min"), 0), to_int(extra.get("record_audio_upload_min"), 0)
    )
    base["record_video_upload_min"] = max(
        to_int(base.get("record_video_upload_min"), 0), to_int(extra.get("record_video_upload_min"), 0)
    )
    return base


def _condition_tree_hints(node: Any) -> dict[str, Any]:
    hints: dict[str, Any] = {
        "tags": [],
        "min_duration": 0,
        "min_hour": 0,
        "quest_difficulty": "",
        "minigame_game": "",
        "minigame_mode": "",
        "minigame_difficulties": [],
        "minigame_score_min": 0,
        "minigame_accuracy_min": 0,
        "minigame_correct_min": 0,
        "record_media_types": [],
        "record_attachment_kind": "",
        "record_audio_upload_min": 0,
        "record_video_upload_min": 0,
    }
    if not isinstance(node, dict):
        return hints
    node_type = str(node.get("type") or "").strip().lower()
    if node_type == "condition":
        field = str(node.get("field") or "").strip()
        op = str(node.get("op") or "").strip().lower()
        value = node.get("value")
        if field == "tags" and op == "contains":
            token = str(value or "").strip()
            if token:
                hints["tags"].append(token)
        elif field == "duration_min" and op in {"gte", "gt", "eq"}:
            hints["min_duration"] = to_int(value, 0)
        elif field == "event.hour_local" and op in {"gte", "gt", "eq"}:
            hints["min_hour"] = to_int(value, 0)
        elif field == "quest.difficulty" and op == "eq":
            hints["quest_difficulty"] = str(value or "").strip().lower()
        elif field == "minigame.game" and op == "eq":
            hints["minigame_game"] = str(value or "").strip().upper()
        elif field == "minigame.mode" and op == "eq":
            hints["minigame_mode"] = str(value or "").strip().upper()
        elif field == "minigame.difficulty":
            if op == "eq":
                token = str(value or "").strip().upper()
                if token:
                    hints["minigame_difficulties"] = [token]
            elif op == "in" and isinstance(value, list):
                hints["minigame_difficulties"] = [str(item or "").strip().upper() for item in value if str(item or "").strip()]
        elif field == "minigame.score" and op in {"gte", "gt", "eq"}:
            hints["minigame_score_min"] = to_int(value, 0)
        elif field == "minigame.accuracy" and op in {"gte", "gt", "eq"}:
            hints["minigame_accuracy_min"] = to_int(value, 0)
        elif field == "minigame.correct" and op in {"gte", "gt", "eq"}:
            hints["minigame_correct_min"] = to_int(value, 0)
        elif field == "record.media_type":
            if op == "eq":
                token = str(value or "").strip().lower()
                if token:
                    hints["record_media_types"] = [token]
            elif op == "in" and isinstance(value, list):
                hints["record_media_types"] = [str(item or "").strip().lower() for item in value if str(item or "").strip()]
        elif field == "record.attachment_kind" and op == "eq":
            hints["record_attachment_kind"] = str(value or "").strip().lower()
        elif field == "record.audio_upload_count" and op in {"gte", "gt", "eq"}:
            hints["record_audio_upload_min"] = to_int(value, 0)
        elif field == "record.video_upload_count" and op in {"gte", "gt", "eq"}:
            hints["record_video_upload_min"] = to_int(value, 0)
        return hints
    for child in node.get("children", []):
        _merge_condition_tree_hints(hints, _condition_tree_hints(child))
    return hints


def _count_event_subject_ko(rule_filter: dict[str, Any]) -> str:
    event_type = str(rule_filter.get("event_type") or "").strip().upper()
    tree_hints = _condition_tree_hints(rule_filter.get("condition_tree"))
    if event_type == "RECORD_ATTACHMENT":
        media_types = [str(token or "").strip().lower() for token in tree_hints.get("record_media_types", []) if str(token or "").strip()]
        unique_media_types = list(dict.fromkeys(media_types))
        kind = str(tree_hints.get("record_attachment_kind") or "").strip().lower()
        if kind == "upload":
            if set(unique_media_types) == {"audio", "video"}:
                return "기록장에 올린 오디오/영상"
            if len(unique_media_types) == 1:
                return f"기록장에 올린 {_record_media_label_ko(unique_media_types[0])}"
            return "기록장에 올린 첨부"
        if kind == "external_link" and unique_media_types == ["video"]:
            return "기록장에 추가한 영상 링크"
        if len(unique_media_types) == 1:
            return f"기록장 {_record_media_label_ko(unique_media_types[0])} 첨부"
        return "기록장 첨부"
    if event_type == "RECORD_POST":
        if to_int(tree_hints.get("record_audio_upload_min"), 0) > 0 and to_int(tree_hints.get("record_video_upload_min"), 0) > 0:
            return "오디오와 영상을 함께 올린 기록장 글"
        if to_int(tree_hints.get("record_video_upload_min"), 0) > 0:
            return "영상 업로드가 있는 기록장 글"
        if to_int(tree_hints.get("record_audio_upload_min"), 0) > 0:
            return "오디오 업로드가 있는 기록장 글"
        return "기록장 글"
    if event_type == "QUEST_CLAIM":
        if tree_hints.get("quest_difficulty") == "high":
            return "고난도 퀘스트 완료"
        return "퀘스트 완료"
    if event_type == "MINIGAME_PLAY":
        game_label = _minigame_game_label_ko(tree_hints.get("minigame_game"))
        mode_label = _minigame_mode_label_ko(tree_hints.get("minigame_mode"))
        difficulty_label = _minigame_difficulty_subject_ko(tree_hints.get("minigame_difficulties", []))
        if game_label and mode_label:
            return f"{game_label} {mode_label}"
        if game_label:
            return game_label
        if mode_label:
            return mode_label
        if difficulty_label:
            return difficulty_label
        return "미니게임"
    tags_all = [str(tag or "").strip() for tag in rule_filter.get("tags_all", []) if str(tag or "").strip()]
    tags_any = [str(tag or "").strip() for tag in rule_filter.get("tags_any", []) if str(tag or "").strip()]
    if not tags_all and not tags_any and tree_hints["tags"]:
        tags_any = list(tree_hints["tags"])
    if tags_all:
        label = _join_tag_labels_ko(tags_all)
        return f"{label} 태그 세션" if label else "세션"
    if tags_any:
        label = _join_tag_labels_ko(tags_any)
        return f"{label} 관련 태그 세션" if label else "세션"
    if to_int(tree_hints.get("min_hour"), 0) >= 22:
        return "심야 세션"
    if isinstance(rule_filter.get("condition_tree"), dict):
        return "조건을 만족하는 세션"
    return "세션"


def _humanize_description_ko(row: dict[str, str], target: int, rule_filter: dict[str, Any]) -> str:
    rule_type = str(row.get("rule_type") or "").strip().lower()
    if rule_type == "count_events":
        tree_hints = _condition_tree_hints(rule_filter.get("condition_tree"))
        event_type = str(rule_filter.get("event_type") or "").strip().upper()
        min_duration = max(to_int(rule_filter.get("min_duration"), 0), to_int(tree_hints.get("min_duration"), 0))
        subject = _count_event_subject_ko(rule_filter)
        if event_type == "RECORD_ATTACHMENT":
            if "링크" in subject:
                return f"{subject} {_format_target(target)}개를 추가하세요."
            return f"{subject} {_format_target(target)}개를 올리세요."
        if event_type == "RECORD_POST":
            return f"{subject} {_format_target(target)}개를 작성하세요."
        if event_type == "MINIGAME_PLAY":
            game_label = _minigame_game_label_ko(tree_hints.get("minigame_game"))
            if game_label and to_int(tree_hints.get("minigame_score_min"), 0) > 0:
                return f"{game_label}에서 {to_int(tree_hints.get('minigame_score_min'), 0)}점 이상을 {_format_target(target)}회 달성하세요."
            if game_label and to_int(tree_hints.get("minigame_accuracy_min"), 0) > 0:
                return f"{game_label}에서 정확도 {to_int(tree_hints.get('minigame_accuracy_min'), 0)}% 이상을 {_format_target(target)}회 달성하세요."
            if game_label and to_int(tree_hints.get("minigame_correct_min"), 0) > 0:
                return f"{game_label}에서 정답 {to_int(tree_hints.get('minigame_correct_min'), 0)}개 이상을 {_format_target(target)}회 기록하세요."
            return f"{subject}를 {_format_target(target)}회 플레이하세요."
        if min_duration > 0 and subject == "세션":
            return f"세션 {min_duration}분 이상을 {_format_target(target)}회 기록하세요."
        if min_duration > 0 and subject == "퀘스트 완료":
            return f"퀘스트를 {_format_target(target)}회 완료하세요."
        if min_duration > 0 and subject == "고난도 퀘스트 완료":
            return f"고난도 퀘스트를 {_format_target(target)}회 완료하세요."
        if subject == "퀘스트 완료":
            return f"퀘스트를 {_format_target(target)}회 완료하세요."
        if subject == "고난도 퀘스트 완료":
            return f"고난도 퀘스트를 {_format_target(target)}회 완료하세요."
        if min_duration > 0:
            return f"{subject}을 {_format_target(target)}회 기록하세요. (회당 {min_duration}분 이상)"
        return f"{subject} {_format_target(target)}회를 기록하세요."
    if rule_type == "sum_duration":
        return f"누적 연습 {_format_target(target)}분을 달성하세요."
    if rule_type == "sum_xp":
        return f"누적 XP {_format_target(target)}을 달성하세요."
    if rule_type == "distinct_count":
        field = str(rule_filter.get("field") or "").strip()
        if field == "song_library_id":
            return f"서로 다른 곡 {_format_target(target)}개를 기록하세요."
        if field == "drill_id":
            return f"서로 다른 드릴 {_format_target(target)}개를 기록하세요."
        if field == "minigame.game":
            if target == 3:
                return "세 가지 미니게임을 모두 1회 이상 플레이하세요."
            return f"서로 다른 미니게임 {_format_target(target)}개를 플레이하세요."
        if field == "record.post_id":
            return f"서로 다른 기록장 글 {_format_target(target)}개를 작성하세요."
        if field == "record.attachment_id":
            return f"기록장 첨부 {_format_target(target)}개를 남기세요."
        if field == "quest.genre_primary":
            return f"서로 다른 장르 퀘스트 {_format_target(target)}개를 달성하세요."
        return f"서로 다른 항목 {_format_target(target)}개를 기록하세요."
    if rule_type == "streak_weekly":
        return f"주간 루틴을 {_format_target(target)}회 이어가세요."
    if rule_type == "streak_monthly":
        return f"월간 루틴을 {_format_target(target)}회 이어가세요."
    if rule_type == "level_reach":
        return f"레벨 {_format_target(target)}에 도달하세요."
    if rule_type == "manual":
        hint = str(row.get("hint") or "").strip()
        return hint or "조건을 달성한 뒤 직접 수령하세요."
    return f"목표 {_format_target(target)}을 달성하세요."


def _user_facing_description_ko(row: dict[str, str], target: int, rule_filter: dict[str, Any]) -> str:
    raw = str(row.get("description") or "").strip()
    if not _needs_user_facing_description(raw):
        return raw
    return _humanize_description_ko(row, target, rule_filter)


def _claimed_ids(events: list[dict[str, str]]) -> set[str]:
    return {
        e.get("achievement_id", "")
        for e in events
        if (e.get("event_type") or "").upper() == "ACHIEVEMENT_CLAIM" and e.get("achievement_id")
    }


def _claimed_map(events: list[dict[str, str]]) -> dict[str, str]:
    out: dict[str, str] = {}
    claims = [e for e in events if (e.get("event_type") or "").upper() == "ACHIEVEMENT_CLAIM" and e.get("achievement_id")]
    claims.sort(key=lambda row: str(row.get("created_at") or ""))
    for row in claims:
        out[str(row.get("achievement_id") or "")] = str(row.get("created_at") or "")
    return out


def _effective_reward(base: int, settings: dict[str, Any]) -> int:
    multiplier = settings.get("critical", {}).get("achievement_xp_multiplier", 1.0)
    try:
        m = float(multiplier)
    except (TypeError, ValueError):
        m = 0.2
    return max(1, int(round(base * m)))


def _feature_context(storage: Storage) -> dict[str, dict[str, dict[str, str]]]:
    song_by_id = {
        str(row.get("library_id") or "").strip(): row
        for row in storage.read_csv("song_library.csv")
        if str(row.get("library_id") or "").strip()
    }
    drill_by_id = {
        str(row.get("drill_id") or "").strip(): row
        for row in storage.read_csv("drill_library.csv")
        if str(row.get("drill_id") or "").strip()
    }
    return {"song_by_id": song_by_id, "drill_by_id": drill_by_id}


def evaluate_achievements(storage: Storage, settings: dict[str, Any]) -> list[AchievementState]:
    achievements = storage.read_csv("achievements_master.csv")
    events = achievement_source_events(storage)
    feature_context = _feature_context(storage)
    claimed_map = _claimed_map(events)
    states: list[AchievementState] = []

    for row in achievements:
        target = to_int(row.get("target"), 1)
        rule_filter = _safe_json(row.get("rule_filter"))
        progress, unlocked = evaluate_rule(
            row.get("rule_type", ""),
            rule_filter,
            target,
            events,
            settings,
            feature_context=feature_context,
        )
        ach_id = row.get("achievement_id", "")
        claimed_at = str(claimed_map.get(ach_id) or "")
        claimed_flag = bool(claimed_at)
        hidden = (row.get("is_hidden") or "").lower() == "true"
        auto_grant = (row.get("auto_grant") or "").lower() == "true"
        xp_reward = to_int(row.get("xp_reward"), 0)
        masked_name = "???"
        masked_desc = "숨겨진 업적입니다."
        states.append(
            AchievementState(
                achievement_id=ach_id,
                group_id=row.get("group_id", ach_id),
                name=row.get("name", "") if (not hidden or unlocked or claimed_flag) else masked_name,
                description=_user_facing_description_ko(row, target, rule_filter) if (not hidden or unlocked or claimed_flag) else masked_desc,
                hint=row.get("hint", ""),
                category=row.get("category", ""),
                tier=to_int(row.get("tier"), 1),
                tier_name=row.get("tier_name", ""),
                target=target,
                display_order=to_int(row.get("display_order"), 0),
                progress=progress,
                unlocked=unlocked,
                claimed=claimed_flag,
                claimed_at=claimed_at,
                hidden=hidden and not (unlocked or claimed_flag),
                auto_grant=auto_grant,
                xp_reward=xp_reward,
                effective_xp_reward=_effective_reward(xp_reward, settings),
                ui_badge_style=row.get("ui_badge_style", "default"),
                rule_type=row.get("rule_type", ""),
                evidence_hint=row.get("evidence_hint", ""),
                icon_path=row.get("icon_path", ""),
                icon_url=row.get("icon_url", ""),
                icon_emoji=row.get("icon_emoji", ""),
            )
        )
    return states


def auto_grant_claims(storage: Storage, settings: dict[str, Any], created_at: datetime) -> list[str]:
    achievements = storage.read_csv("achievements_master.csv")
    events = achievement_source_events(storage)
    feature_context = _feature_context(storage)
    claimed = _claimed_ids(events)
    granted_ids: list[str] = []

    for _ in range(10):
        changed = False
        for row in achievements:
            ach_id = row.get("achievement_id", "")
            if not ach_id or ach_id in claimed:
                continue
            if (row.get("rule_type") or "").lower() == "manual":
                continue

            target = to_int(row.get("target"), 1)
            progress, unlocked = evaluate_rule(
                row.get("rule_type", ""),
                _safe_json(row.get("rule_filter")),
                target,
                events,
                settings,
                feature_context=feature_context,
            )
            if not unlocked:
                continue
            raw_reward = to_int(row.get("xp_reward"), 0)
            claim_event = create_event_row(
                created_at=created_at,
                event_type="ACHIEVEMENT_CLAIM",
                xp=_effective_reward(raw_reward, settings),
                title=f"Achievement: {row.get('name', ach_id)}",
                notes=f"Auto granted ({progress}/{target})",
                achievement_id=ach_id,
                tags=["ACHIEVEMENT", row.get("category", "").upper()],
                meta={"auto": True, "progress": progress, "target": target, "raw_reward": raw_reward},
                source="system",
            )
            storage.append_csv_row("events.csv", claim_event, storage.read_csv_headers("events.csv"))
            events.append(claim_event)
            claimed.add(ach_id)
            granted_ids.append(ach_id)
            changed = True
        if not changed:
            break
    return granted_ids


def reconcile_auto_claims(storage: Storage, settings: dict[str, Any], created_at: datetime) -> list[str]:
    rows = storage.read_csv("events.csv")
    headers = storage.read_csv_headers("events.csv")
    kept: list[dict[str, str]] = []
    for row in rows:
        if (row.get("event_type") or "").upper() != "ACHIEVEMENT_CLAIM":
            kept.append(row)
            continue
        meta = _safe_json(row.get("meta_json"))
        if bool(meta.get("auto")):
            continue
        kept.append(row)

    storage.write_csv("events.csv", kept, headers=headers)
    return auto_grant_claims(storage, settings, created_at)


def manual_claim(
    storage: Storage,
    settings: dict[str, Any],
    achievement_id: str,
    created_at: datetime,
    source: str = "app",
) -> tuple[bool, str]:
    achievements = {row.get("achievement_id", ""): row for row in storage.read_csv("achievements_master.csv")}
    row = achievements.get(achievement_id)
    if not row:
        return False, "업적을 찾을 수 없습니다."
    events = achievement_source_events(storage)
    feature_context = _feature_context(storage)
    if achievement_id in _claimed_ids(events):
        return False, "이미 수령한 업적입니다."

    target = to_int(row.get("target"), 1)
    progress, unlocked = evaluate_rule(
        row.get("rule_type", ""),
        _safe_json(row.get("rule_filter")),
        target,
        events,
        settings,
        feature_context=feature_context,
    )
    if (row.get("rule_type") or "").lower() != "manual" and not unlocked:
        return False, "아직 달성 조건을 충족하지 않았습니다."

    raw_reward = to_int(row.get("xp_reward"), 0)
    claim_event = create_event_row(
        created_at=created_at,
        event_type="ACHIEVEMENT_CLAIM",
        xp=_effective_reward(raw_reward, settings),
        title=f"Achievement: {row.get('name', achievement_id)}",
        notes=f"Manual claim ({progress}/{target})",
        achievement_id=achievement_id,
        tags=["ACHIEVEMENT", row.get("category", "").upper()],
        meta={"auto": False, "progress": progress, "target": target, "raw_reward": raw_reward},
        source=source,
    )
    storage.append_csv_row("events.csv", claim_event, storage.read_csv_headers("events.csv"))
    return True, "업적을 수령했습니다."


def recent_claims(storage: Storage, limit: int = 5) -> list[dict[str, str]]:
    rows = storage.read_csv("events.csv")
    name_by_id = {
        row.get("achievement_id", ""): row.get("name", "")
        for row in storage.read_csv("achievements_master.csv")
        if row.get("achievement_id")
    }
    claims = [row for row in rows if (row.get("event_type") or "").upper() == "ACHIEVEMENT_CLAIM"]
    claims.sort(key=lambda row: row.get("created_at", ""), reverse=True)
    out: list[dict[str, str]] = []
    for row in claims[: max(limit, 1)]:
        ach_id = row.get("achievement_id", "")
        out.append(
            {
                "achievement_id": ach_id,
                "name": name_by_id.get(ach_id, ach_id),
                "created_at": row.get("created_at", ""),
                "xp": row.get("xp", "0"),
            }
        )
    return out
