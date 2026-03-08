"""Flask API routes."""

from __future__ import annotations

import json
import csv
import io
import mimetypes
import uuid
from datetime import date
from pathlib import Path
from typing import Any

from flask import Blueprint, Response, current_app, jsonify, request, send_file

from bassos.constants import (
    ACHIEVEMENT_HEADERS,
    ACTIVITY_TO_TAG,
    BACKING_TRACK_HEADERS,
    CHECKBOX_TAG_TO_BONUS_KEY,
    DRILL_LIBRARY_HEADERS,
    EVENT_HEADERS,
    SUB_ACTIVITY_TO_TAG,
    TUTORIAL_CAMPAIGN_ID,
)
from bassos.services.achievements import auto_grant_claims, evaluate_achievements, manual_claim, recent_claims
from bassos.services.backups import create_export_bundle, maybe_create_backup, restore_from_backup
from bassos.services.calculations import to_int
from bassos.services.data_bootstrap import ensure_bootstrap_data, initialize_quest_templates
from bassos.services.events import create_event_row
from bassos.services.game import GameService
from bassos.services.minigame_service import MinigameService
from bassos.services.quests import claim_quest, create_custom_quest, fail_quest, list_current_quests, refresh_auto_quests, update_quest
from bassos.services.runtime_profile import RuntimeProfileManager
from bassos.services.storage import Storage
from bassos.services.tutorial import (
    complete_tutorial,
    get_tutorial_state,
    mark_tutorial_banner_seen,
    save_tutorial_progress,
    start_tutorial,
)
from bassos.utils.time_utils import now_local

api_bp = Blueprint("api", __name__, url_prefix="/api")

RULE_TYPE_OPTIONS = [
    "count_events",
    "sum_duration",
    "sum_xp",
    "level_reach",
    "distinct_count",
    "streak_weekly",
    "streak_monthly",
    "manual",
]

DEFAULT_EVENT_TYPES = [
    "SESSION",
    "LONG_GOAL_CLEAR",
    "ACHIEVEMENT_CLAIM",
    "GALLERY_UPLOAD",
    "ADMIN_ADJUST",
]

DEFAULT_DISTINCT_FIELDS = [
    "song_library_id",
    "drill_id",
    "quest_id",
    "achievement_id",
    "event_type",
    "activity",
    "source",
    "title",
    "evidence_type",
]

CONDITION_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in", "not_in", "exists", "not_exists"]
DEFAULT_CONDITION_FIELDS = [
    "event_type",
    "activity",
    "sub_activity",
    "duration_min",
    "xp",
    "source",
    "title",
    "notes",
    "evidence_type",
    "song.genre",
    "song.status",
    "song.artist",
    "song.title",
    "song.mood",
    "drill.area",
    "drill.name",
    "drill.tags",
    "tags",
    "event.hour_local",
    "event.weekday",
    "event.month",
    "event.is_weekend",
    "quest.period_class",
    "quest.difficulty",
    "quest.priority",
    "quest.genre_primary",
    "quest.genres",
    "quest.linked_song_ids",
    "quest.linked_drill_ids",
]

DRILL_TAXONOMY_TAGS = [
    "박자",
    "포지션",
    "지구력",
    "스피드",
    "클린",
    "다이내믹",
    "리딩",
    "핑거",
    "피크",
    "슬랩",
    "고스트",
    "레가토",
    "크로매틱",
    "스케일",
    "코드톤",
    "인터벌",
    "진행",
    "8분음표",
    "16분음표",
    "트리플렛",
    "싱코페이션",
    "그루브",
    "워킹",
    "컴핑",
]

LEGACY_HIDDEN_RULE_TAGS = {
    "CORE",
    "FUNK",
    "FUNKJAZZ",
    "SLAP",
    "THEORY",
    "METRO_24",
    "METRO_ONEBAR",
    "CLEAN_MUTE",
    "EAR_COPY",
    "AB_COMPARE",
}

FIELD_TYPE_META: dict[str, str] = {
    "event_type": "enum",
    "activity": "enum",
    "sub_activity": "enum",
    "duration_min": "number",
    "xp": "number",
    "source": "enum",
    "title": "text",
    "notes": "text",
    "evidence_type": "enum",
    "tags": "list",
    "song.genre": "enum",
    "song.status": "enum",
    "song.artist": "enum",
    "song.title": "text",
    "song.mood": "enum",
    "drill.area": "enum",
    "drill.name": "text",
    "drill.tags": "list",
    "event.hour_local": "number",
    "event.weekday": "number",
    "event.month": "number",
    "event.is_weekend": "boolean",
    "quest.period_class": "enum",
    "quest.difficulty": "enum",
    "quest.priority": "enum",
    "quest.genre_primary": "enum",
    "quest.genres": "list",
    "quest.linked_song_ids": "list",
    "quest.linked_drill_ids": "list",
}

FIELD_LABEL_META: dict[str, dict[str, Any]] = {
    "event_type": {"label": "이벤트 종류", "desc": "SESSION/LONG_GOAL_CLEAR 같은 이벤트 타입"},
    "activity": {"label": "활동(activity)", "desc": "세션 활동 분류"},
    "sub_activity": {"label": "세부 활동", "desc": "세션 하위 활동 값"},
    "duration_min": {"label": "세션 길이(분)", "desc": "session duration_min"},
    "xp": {"label": "이벤트 XP", "desc": "이벤트 단위 XP"},
    "source": {"label": "기록 출처", "desc": "APP/BACKFILL/SYSTEM 등"},
    "title": {"label": "제목", "desc": "이벤트 제목 텍스트"},
    "notes": {"label": "메모", "desc": "이벤트 메모 텍스트"},
    "evidence_type": {"label": "증빙 타입", "desc": "audio/video/image/link 등"},
    "tags": {"label": "태그 목록", "desc": "이벤트에 기록된 태그 배열"},
    "song.genre": {"label": "곡 장르", "desc": "연결된 곡의 장르"},
    "song.status": {"label": "곡 상태", "desc": "In Progress/Done 등"},
    "song.artist": {"label": "아티스트", "desc": "연결된 곡 아티스트"},
    "song.title": {"label": "곡 제목", "desc": "연결된 곡 제목"},
    "song.mood": {"label": "곡 무드", "desc": "연결된 곡의 mood 값"},
    "drill.area": {"label": "드릴 영역", "desc": "연결된 드릴의 area"},
    "drill.name": {"label": "드릴 이름", "desc": "연결된 드릴 이름"},
    "drill.tags": {"label": "드릴 태그", "desc": "연결된 드릴의 태그 목록"},
    "event.hour_local": {"label": "이벤트 시각(시)", "desc": "로컬 시간 기준 0~23"},
    "event.weekday": {"label": "요일 번호", "desc": "월=0 ... 일=6"},
    "event.month": {"label": "월", "desc": "1~12"},
    "event.is_weekend": {"label": "주말 여부", "desc": "토/일이면 true"},
    "quest.period_class": {"label": "퀘스트 기간", "desc": "short/mid/long"},
    "quest.difficulty": {"label": "퀘스트 난이도", "desc": "low/mid/high"},
    "quest.priority": {"label": "퀘스트 중요도", "desc": "low/normal/urgent"},
    "quest.genre_primary": {"label": "퀘스트 대표 장르", "desc": "QUEST_CLAIM meta.quest.genre_primary"},
    "quest.genres": {"label": "퀘스트 장르 목록", "desc": "QUEST_CLAIM meta.quest.genres"},
    "quest.linked_song_ids": {"label": "퀘스트 연동 곡 IDs", "desc": "QUEST_CLAIM meta.quest.linked_song_ids"},
    "quest.linked_drill_ids": {"label": "퀘스트 연동 드릴 IDs", "desc": "QUEST_CLAIM meta.quest.linked_drill_ids"},
}

RULE_TYPE_META: dict[str, dict[str, str]] = {
    "count_events": {"title": "이벤트 개수 누적", "target_unit": "횟수", "desc": "필터를 만족한 이벤트 개수를 누적"},
    "sum_duration": {"title": "연습 시간 누적", "target_unit": "분", "desc": "필터를 만족한 duration_min 합계"},
    "sum_xp": {"title": "XP 누적", "target_unit": "XP", "desc": "필터 범위의 XP 합계를 누적"},
    "level_reach": {"title": "레벨 도달", "target_unit": "레벨", "desc": "플레이어 레벨이 target 이상인지 평가"},
    "distinct_count": {"title": "고유값 개수", "target_unit": "개", "desc": "지정 필드의 중복 제거 개수"},
    "streak_weekly": {"title": "주간 연속 달성", "target_unit": "주", "desc": "주 단위 조건 연속 달성 횟수"},
    "streak_monthly": {"title": "월간 연속 달성", "target_unit": "개월", "desc": "월 단위 조건 연속 달성 횟수"},
    "manual": {"title": "수동 업적", "target_unit": "체크", "desc": "자동 추적 없이 수동 클레임"},
}

OPERATOR_META: dict[str, dict[str, str]] = {
    "eq": {"label": "같다(=)", "desc": "값이 정확히 일치"},
    "ne": {"label": "다르다(!=)", "desc": "값이 일치하지 않음"},
    "gt": {"label": "초과(>)", "desc": "왼쪽 값이 더 큼"},
    "gte": {"label": "이상(>=)", "desc": "왼쪽 값이 크거나 같음"},
    "lt": {"label": "미만(<)", "desc": "왼쪽 값이 더 작음"},
    "lte": {"label": "이하(<=)", "desc": "왼쪽 값이 작거나 같음"},
    "contains": {"label": "포함", "desc": "텍스트/목록에 값 포함"},
    "in": {"label": "목록 중 하나", "desc": "값이 목록에 포함"},
    "not_in": {"label": "목록 외", "desc": "값이 목록에 없음"},
    "exists": {"label": "값 있음", "desc": "값이 비어 있지 않음"},
    "not_exists": {"label": "값 없음", "desc": "값이 비어 있음"},
}


def _storage() -> Storage:
    return current_app.config["storage"]


def _settings() -> dict[str, Any]:
    return _storage().read_json("settings.json")


def _game() -> GameService:
    return current_app.config["game_service"]


def _runtime_profiles() -> RuntimeProfileManager:
    return current_app.config["runtime_profile_manager"]


def _set_runtime_storage(storage: Storage) -> None:
    current_app.config["storage"] = storage
    current_app.config["game_service"] = GameService(storage)
    current_app.config["minigame_service"] = MinigameService(storage)


def _split_csv_tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    tokens = [token.strip().upper() for token in str(raw).replace(";", ",").split(",")]
    return [token for token in tokens if token]


def _request_value(key: str, default: str = "") -> str:
    if request.form and key in request.form:
        return str(request.form.get(key, default))
    payload = request.get_json(silent=True) or {}
    value = payload.get(key, default)
    return "" if value is None else str(value)


def _parse_list_payload(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if value is None:
        return []
    text = str(value).strip()
    if not text:
        return []
    if text.startswith("[") and text.endswith("]"):
        try:
            decoded = json.loads(text)
            if isinstance(decoded, list):
                return [str(item).strip() for item in decoded if str(item).strip()]
        except json.JSONDecodeError:
            pass
    text = text.replace(",", ";")
    return [item.strip() for item in text.split(";") if item.strip()]


def _request_list_value(key: str) -> list[str]:
    if request.form and key in request.form:
        values = request.form.getlist(key)
        if len(values) > 1:
            out: list[str] = []
            for value in values:
                out.extend(_parse_list_payload(value))
            return out
        return _parse_list_payload(values[0] if values else "")
    payload = request.get_json(silent=True) or {}
    return _parse_list_payload(payload.get(key))


def _request_object_value(key: str) -> dict[str, Any]:
    if request.form and key in request.form:
        raw = str(request.form.get(key, "") or "").strip()
        if not raw:
            return {}
        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    payload = request.get_json(silent=True) or {}
    value = payload.get(key)
    return value if isinstance(value, dict) else {}


def _request_object_list_value(key: str) -> list[dict[str, Any]]:
    def _parse(value: Any) -> list[dict[str, Any]]:
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        raw = str(value or "").strip()
        if not raw:
            return []
        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError:
            return []
        return [item for item in decoded if isinstance(item, dict)] if isinstance(decoded, list) else []

    if request.form and key in request.form:
        values = request.form.getlist(key)
        out: list[dict[str, Any]] = []
        for value in values:
            out.extend(_parse(value))
        return out
    payload = request.get_json(silent=True) or {}
    return _parse(payload.get(key))


def _request_query_list_value(key: str) -> list[str]:
    values = request.args.getlist(key)
    if not values and key in request.args:
        values = [str(request.args.get(key, "") or "")]
    out: list[str] = []
    for value in values:
        out.extend(_parse_list_payload(value))
    deduped: list[str] = []
    seen: set[str] = set()
    for value in out:
        lowered = value.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(value)
    return deduped


def _infer_upload_media_type(filename: str, mimetype: str) -> str:
    guessed = (mimetype or "").lower()
    if guessed.startswith("image/"):
        return "image"
    if guessed.startswith("video/"):
        return "video"
    if guessed.startswith("audio/"):
        return "audio"
    ext = Path(filename).suffix.lower()
    if ext in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}:
        return "image"
    if ext in {".mp4", ".mov", ".webm", ".avi", ".mkv"}:
        return "video"
    if ext in {".mp3", ".wav", ".ogg", ".m4a", ".flac"}:
        return "audio"
    return "image"


def _normalize_external_record_attachments(
    items: list[dict[str, Any]],
    *,
    start_sort_order: int,
) -> tuple[list[dict[str, Any]], str]:
    normalized: list[dict[str, Any]] = []
    next_sort_order = max(1, start_sort_order)
    for raw in items:
        media_type = str(raw.get("media_type") or "video").strip().lower() or "video"
        url = str(raw.get("url") or "").strip()
        if media_type != "video":
            return [], "외부 첨부는 현재 영상 링크만 지원합니다."
        if not url:
            return [], "외부 영상 링크 URL이 비어 있습니다."
        normalized.append(
            {
                "media_type": "video",
                "path": "",
                "url": url,
                "title": str(raw.get("title") or "").strip(),
                "notes": str(raw.get("notes") or "").strip(),
                "sort_order": to_int(raw.get("sort_order"), next_sort_order),
            }
        )
        next_sort_order += 1
    return normalized, ""


def _to_bool_text(value: Any, default: bool = False) -> str:
    if value is None:
        return "true" if default else "false"
    if isinstance(value, bool):
        return "true" if value else "false"
    token = str(value).strip().lower()
    if token in {"1", "true", "yes", "on"}:
        return "true"
    if token in {"0", "false", "no", "off"}:
        return "false"
    return "true" if default else "false"


def _achievement_headers(storage: Storage) -> list[str]:
    headers = storage.read_csv_headers("achievements_master.csv")
    if not headers:
        return ACHIEVEMENT_HEADERS.copy()
    for key in ACHIEVEMENT_HEADERS:
        if key not in headers:
            headers.append(key)
    return headers


def _normalize_rule_filter(value: Any) -> str:
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    text = str(value or "").strip()
    if not text:
        return "{}"
    try:
        decoded = json.loads(text)
        if isinstance(decoded, dict):
            return json.dumps(decoded, ensure_ascii=False)
    except json.JSONDecodeError:
        return "{}"
    return "{}"


def _parse_json_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        decoded = json.loads(text)
        return decoded if isinstance(decoded, dict) else {}
    except json.JSONDecodeError:
        return {}


def _is_bool_like(value: Any) -> bool:
    if isinstance(value, bool):
        return True
    token = str(value).strip().lower()
    return token in {"true", "false", "1", "0", "yes", "no", "on", "off"}


def _humanize_field_key(field: str) -> str:
    meta = FIELD_LABEL_META.get(field, {})
    label = str(meta.get("label") or field)
    return f"{label} ({field})"


def _humanize_operator(op: str) -> str:
    meta = OPERATOR_META.get(op, {})
    return str(meta.get("label") or op)


def _stringify_condition_value(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _validate_condition_value(field: str, op: str, value: Any) -> str | None:
    op_key = str(op or "").strip().lower()
    if op_key in {"exists", "not_exists"}:
        return None
    field_type = FIELD_TYPE_META.get(field, "text")
    if op_key in {"gt", "gte", "lt", "lte"}:
        if value is None:
            return f"{field}: {op_key} 연산자는 숫자 값이 필요합니다."
        try:
            float(value)
            return None
        except (TypeError, ValueError):
            return f"{field}: {op_key} 연산자는 숫자 값만 허용합니다."
    if field_type == "number":
        if value is None:
            return f"{field}: 값이 필요합니다."
        try:
            float(value)
            return None
        except (TypeError, ValueError):
            return f"{field}: 숫자 필드는 숫자 값을 사용하세요."
    if field_type == "boolean":
        if op_key in {"in", "not_in"}:
            if not isinstance(value, list):
                return f"{field}: {op_key}는 true/false 목록이 필요합니다."
            if any(not _is_bool_like(item) for item in value):
                return f"{field}: boolean 목록 값은 true/false 형태여야 합니다."
            return None
        if not _is_bool_like(value):
            return f"{field}: boolean 필드는 true/false 값을 사용하세요."
    if op_key in {"in", "not_in"}:
        if isinstance(value, list):
            return None
        if isinstance(value, str) and value.strip():
            return None
        return f"{field}: {op_key} 연산자는 목록 값이 필요합니다."
    return None


def _validate_condition_tree_node(
    node: Any,
    *,
    depth: int,
    stats: dict[str, int],
    known_fields: set[str],
    known_ops: set[str],
    errors: list[str],
    path: str,
) -> None:
    if depth > 4:
        errors.append(f"{path}: 최대 깊이(4)를 초과했습니다.")
        return
    if not isinstance(node, dict):
        errors.append(f"{path}: 객체여야 합니다.")
        return
    stats["nodes"] += 1
    if stats["nodes"] > 40:
        errors.append("condition_tree 노드 수가 최대치(40)를 초과했습니다.")
        return

    node_type = str(node.get("type") or "").strip().lower()
    if node_type == "group":
        logic = str(node.get("logic") or "").strip().lower()
        if logic not in {"all", "any"}:
            errors.append(f"{path}.logic는 all/any 중 하나여야 합니다.")
        children = node.get("children")
        if not isinstance(children, list) or not children:
            errors.append(f"{path}.children은 1개 이상의 배열이어야 합니다.")
            return
        for idx, child in enumerate(children):
            _validate_condition_tree_node(
                child,
                depth=depth + 1,
                stats=stats,
                known_fields=known_fields,
                known_ops=known_ops,
                errors=errors,
                path=f"{path}.children[{idx}]",
            )
        return

    if node_type == "condition":
        field = str(node.get("field") or "").strip()
        op = str(node.get("op") or "eq").strip().lower()
        if not field:
            errors.append(f"{path}.field는 필수입니다.")
            return
        if field not in known_fields:
            errors.append(f"{path}.field({field})는 지원되지 않는 필드입니다.")
        if op not in known_ops:
            errors.append(f"{path}.op({op})는 지원되지 않는 연산자입니다.")
        maybe_error = _validate_condition_value(field, op, node.get("value"))
        if maybe_error:
            errors.append(f"{path} {maybe_error}")
        return

    errors.append(f"{path}.type은 group/condition 중 하나여야 합니다.")


def _validate_rule_filter(rule_filter: dict[str, Any], storage: Storage) -> list[str]:
    options = _collect_achievement_rule_options(storage)
    known_fields = {str(item) for item in options.get("condition_fields", [])}
    known_ops = {str(item) for item in options.get("condition_ops", [])}
    errors: list[str] = []
    for legacy_key in ("conditions", "conditions_mode", "boss_type", "tag_quick"):
        if legacy_key in rule_filter:
            errors.append(f"{legacy_key}는 더 이상 지원되지 않습니다. condition_tree를 사용하세요.")
    tree = rule_filter.get("condition_tree")
    if tree is not None:
        stats = {"nodes": 0}
        _validate_condition_tree_node(
            tree,
            depth=0,
            stats=stats,
            known_fields=known_fields,
            known_ops=known_ops,
            errors=errors,
            path="condition_tree",
        )
    return errors


def _normalize_and_validate_rule_filter(value: Any, storage: Storage) -> str:
    if isinstance(value, dict):
        decoded = value
    else:
        text = str(value or "").strip()
        if not text:
            decoded = {}
        else:
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ValueError(f"rule_filter JSON 파싱 실패: {exc}") from exc
            if not isinstance(parsed, dict):
                raise ValueError("rule_filter는 JSON object여야 합니다.")
            decoded = parsed
    errors = _validate_rule_filter(decoded, storage)
    if errors:
        raise ValueError("rule_filter 검증 실패: " + " | ".join(errors[:5]))
    return json.dumps(decoded, ensure_ascii=False)


def _describe_condition_node_ko(node: Any) -> str:
    if not isinstance(node, dict):
        return "유효하지 않은 조건"
    node_type = str(node.get("type") or "").strip().lower()
    if node_type == "condition":
        field = str(node.get("field") or "").strip()
        op = str(node.get("op") or "eq").strip().lower()
        value = _stringify_condition_value(node.get("value"))
        if op in {"exists", "not_exists"}:
            return f"{_humanize_field_key(field)} {_humanize_operator(op)}"
        return f"{_humanize_field_key(field)} {_humanize_operator(op)} {value}"
    if node_type == "group":
        logic = str(node.get("logic") or "all").strip().lower()
        glue = " 그리고 " if logic != "any" else " 또는 "
        children = node.get("children")
        if not isinstance(children, list) or not children:
            return "비어 있는 그룹"
        return "(" + glue.join(_describe_condition_node_ko(child) for child in children if isinstance(child, dict)) + ")"
    return "유효하지 않은 조건"


def _rule_summary_ko(rule_type: str, target: int, rule_filter: dict[str, Any]) -> tuple[str, list[str]]:
    rule_key = str(rule_type or "").strip().lower()
    rule_meta = RULE_TYPE_META.get(rule_key, {})
    title = str(rule_meta.get("title") or rule_key or "규칙")
    target_unit = str(rule_meta.get("target_unit") or "목표")
    steps: list[str] = []
    event_type = str(rule_filter.get("event_type") or "").strip()
    if event_type:
        steps.append(f"1) 이벤트 필터: {event_type}")
    else:
        steps.append("1) 이벤트 필터: 전체 이벤트")

    if isinstance(rule_filter.get("condition_tree"), dict):
        steps.append(f"2) 조건 트리: {_describe_condition_node_ko(rule_filter.get('condition_tree'))}")
    else:
        steps.append("2) 조건 트리: 없음")

    detail_bits: list[str] = []
    if rule_filter.get("min_duration") is not None:
        detail_bits.append(f"min_duration>={rule_filter.get('min_duration')}")
    if rule_filter.get("tags_any"):
        detail_bits.append(f"tags_any={rule_filter.get('tags_any')}")
    if rule_filter.get("tags_all"):
        detail_bits.append(f"tags_all={rule_filter.get('tags_all')}")
    if rule_filter.get("field"):
        detail_bits.append(f"field={rule_filter.get('field')}")
    steps.append("3) 진행 계산: " + (", ".join(detail_bits) if detail_bits else "기본 계산"))
    steps.append(f"4) 목표값: {target} {target_unit}")
    summary = f"{title} · 목표 {target}{target_unit}"
    return summary, steps


def _collect_achievement_rule_options(storage: Storage) -> dict[str, Any]:
    achievements = storage.read_csv("achievements_master.csv")
    songs = storage.read_csv("song_library.csv")
    drills = storage.read_csv("drill_library.csv")

    rule_types = set(RULE_TYPE_OPTIONS)
    event_types = {token.upper() for token in DEFAULT_EVENT_TYPES}
    tags = set(CHECKBOX_TAG_TO_BONUS_KEY.keys())
    tags.update(str(value).upper() for value in ACTIVITY_TO_TAG.values())
    tags.update(str(value).upper() for value in SUB_ACTIVITY_TO_TAG.values())
    tags.update(DRILL_TAXONOMY_TAGS)
    fields = set(DEFAULT_DISTINCT_FIELDS)
    fields.update(EVENT_HEADERS)
    condition_fields = set(DEFAULT_CONDITION_FIELDS)
    feature_values: dict[str, set[str]] = {
        "event_type": set(event_types),
        "activity": set(ACTIVITY_TO_TAG.keys()),
        "sub_activity": set(SUB_ACTIVITY_TO_TAG.keys()),
        "source": {"app", "system", "admin", "backfill"},
        "evidence_type": {"audio", "video", "image", "url", "file"},
        "tags": set(tags),
        "song.genre": set(),
        "song.status": set(),
        "song.artist": set(),
        "song.mood": set(),
        "drill.area": set(),
        "drill.tags": set(DRILL_TAXONOMY_TAGS),
        "event.weekday": {"0", "1", "2", "3", "4", "5", "6"},
        "event.month": {str(i) for i in range(1, 13)},
        "event.is_weekend": {"true", "false"},
        "event.hour_local": {str(i) for i in range(0, 24)},
        "quest.period_class": {"short", "mid", "long"},
        "quest.difficulty": {"low", "mid", "high"},
        "quest.priority": {"low", "normal", "urgent"},
        "quest.genre_primary": set(),
        "quest.genres": set(),
        "quest.linked_song_ids": set(),
        "quest.linked_drill_ids": set(),
    }

    def _collect_fields_from_tree(node: Any) -> None:
        if not isinstance(node, dict):
            return
        node_type = str(node.get("type") or "").strip().lower()
        if node_type == "condition":
            field = str(node.get("field") or "").strip()
            if field:
                condition_fields.add(field)
            return
        if node_type == "group":
            children = node.get("children")
            if not isinstance(children, list):
                return
            for child in children:
                _collect_fields_from_tree(child)

    for row in achievements:
        rule_type = str(row.get("rule_type") or "").strip().lower()
        if rule_type in RULE_TYPE_OPTIONS:
            rule_types.add(rule_type)

        rule_filter = _parse_json_dict(row.get("rule_filter"))
        event_type = str(rule_filter.get("event_type") or "").strip().upper()
        if event_type:
            event_types.add(event_type)

        for key in ("tags_any", "tags_all"):
            values = rule_filter.get(key)
            if isinstance(values, list):
                for value in values:
                    token = str(value).strip().upper()
                    if token:
                        tags.add(token)
                        feature_values["tags"].add(token)

        for key in ("tag_core",):
            token = str(rule_filter.get(key) or "").strip().upper()
            if token:
                tags.add(token)
                feature_values["tags"].add(token)

        field = str(rule_filter.get("field") or "").strip()
        if field:
            fields.add(field)
        _collect_fields_from_tree(rule_filter.get("condition_tree"))

    feature_values["event_type"].update(event_types)

    for row in songs:
        for key, field in (
            ("song.genre", "genre"),
            ("song.status", "status"),
            ("song.artist", "artist"),
            ("song.mood", "mood"),
        ):
            token = str(row.get(field) or "").strip()
            if token:
                feature_values[key].add(token)
                if key == "song.genre":
                    feature_values["quest.genre_primary"].add(token)
                    feature_values["quest.genres"].add(token)
        song_id = str(row.get("library_id") or "").strip()
        if song_id:
            feature_values["quest.linked_song_ids"].add(song_id)

    for row in drills:
        token = str(row.get("area") or "").strip()
        if token:
            feature_values["drill.area"].add(token)
        for drill_tag in _split_csv_tags(str(row.get("tags") or "")):
            if not drill_tag:
                continue
            feature_values["drill.tags"].add(drill_tag)
            feature_values["tags"].add(drill_tag)
            tags.add(drill_tag)
        drill_id = str(row.get("drill_id") or "").strip()
        if drill_id:
            feature_values["quest.linked_drill_ids"].add(drill_id)

    tags.difference_update(LEGACY_HIDDEN_RULE_TAGS)
    feature_values["tags"].difference_update(LEGACY_HIDDEN_RULE_TAGS)

    field_meta = {
        field: {
            "label": str(FIELD_LABEL_META.get(field, {}).get("label") or field),
            "description": str(FIELD_LABEL_META.get(field, {}).get("desc") or ""),
            "type": FIELD_TYPE_META.get(field, "text"),
            "examples": (list(feature_values.get(field, set()))[:5] if field in feature_values else []),
        }
        for field in sorted(condition_fields)
    }
    operator_meta = {
        op: {
            "label": str(OPERATOR_META.get(op, {}).get("label") or op),
            "description": str(OPERATOR_META.get(op, {}).get("desc") or ""),
        }
        for op in CONDITION_OPS
    }
    rule_type_meta = {
        rule: {
            "title": str(RULE_TYPE_META.get(rule, {}).get("title") or rule),
            "target_unit": str(RULE_TYPE_META.get(rule, {}).get("target_unit") or ""),
            "description": str(RULE_TYPE_META.get(rule, {}).get("desc") or ""),
        }
        for rule in sorted(rule_types)
    }
    field_groups = [
        {"group": "이벤트", "fields": ["event_type", "activity", "sub_activity", "duration_min", "xp", "source", "evidence_type", "tags"]},
        {"group": "시간 파생", "fields": ["event.hour_local", "event.weekday", "event.month", "event.is_weekend"]},
        {"group": "곡 feature", "fields": ["song.genre", "song.status", "song.artist", "song.title", "song.mood"]},
        {"group": "드릴 feature", "fields": ["drill.area", "drill.name", "drill.tags"]},
        {
            "group": "퀘스트 meta",
            "fields": [
                "quest.period_class",
                "quest.difficulty",
                "quest.priority",
                "quest.genre_primary",
                "quest.genres",
                "quest.linked_song_ids",
                "quest.linked_drill_ids",
            ],
        },
    ]
    builder_examples = [
        {
            "title": "합주 또는 무대 + 20분 이상",
            "rule_type": "count_events",
            "target": 5,
            "rule_filter": {
                "event_type": "SESSION",
                "condition_tree": {
                    "type": "group",
                    "logic": "all",
                    "children": [
                        {"type": "condition", "field": "duration_min", "op": "gte", "value": 20},
                        {
                            "type": "group",
                            "logic": "any",
                            "children": [
                                {"type": "condition", "field": "tags", "op": "contains", "value": "BAND"},
                                {"type": "condition", "field": "tags", "op": "contains", "value": "PERFORMANCE"},
                            ],
                        },
                    ],
                },
            },
            "description": "20분 이상 세션 중 BAND/PERFORMANCE 태그가 있는 경우만 카운트",
        },
        {
            "title": "심야 집중(22시 이후, 40분 이상)",
            "rule_type": "count_events",
            "target": 3,
            "rule_filter": {
                "event_type": "SESSION",
                "condition_tree": {
                    "type": "group",
                    "logic": "all",
                    "children": [
                        {"type": "condition", "field": "event.hour_local", "op": "gte", "value": 22},
                        {"type": "condition", "field": "duration_min", "op": "gte", "value": 40},
                    ],
                },
            },
            "description": "시간 파생 필드(event.hour_local) 사용 예시",
        },
    ]

    return {
        "rule_types": sorted(rule_types),
        "event_types": sorted(event_types),
        "tags": sorted(tags),
        "fields": sorted(fields),
        "condition_fields": sorted(condition_fields),
        "condition_ops": CONDITION_OPS,
        "feature_values": {key: sorted(values) for key, values in feature_values.items()},
        "rule_type_meta": rule_type_meta,
        "field_meta": field_meta,
        "operator_meta": operator_meta,
        "field_groups": field_groups,
        "value_suggestions": {key: sorted(values) for key, values in feature_values.items()},
        "builder_examples": builder_examples,
        "example_rules": [
            {
                "title": "세션 30분 이상",
                "rule_type": "count_events",
                "target": 3,
                "rule_filter": {
                    "event_type": "SESSION",
                    "condition_tree": {
                        "type": "group",
                        "logic": "all",
                        "children": [{"type": "condition", "field": "duration_min", "op": "gte", "value": 30}],
                    },
                },
                "description": "30분 이상 세션이 3회 이상이면 달성",
            },
            {
                "title": "록/재즈 장르 곡 연습",
                "rule_type": "count_events",
                "target": 10,
                "rule_filter": {
                    "event_type": "SESSION",
                    "condition_tree": {
                        "type": "group",
                        "logic": "all",
                        "children": [
                            {"type": "condition", "field": "song.genre", "op": "in", "value": ["Rock", "Jazz", "Fusion"]},
                            {"type": "condition", "field": "song.status", "op": "in", "value": ["In Progress", "Done"]},
                        ],
                    },
                },
                "description": "선택 장르 + 상태 조건을 모두 만족한 세션 누적",
            },
            {
                "title": "박자/슬랩 태그 포함",
                "rule_type": "count_events",
                "target": 8,
                "rule_filter": {"event_type": "SESSION", "tags_any": ["박자", "슬랩"]},
                "description": "박자 또는 슬랩 태그가 포함된 세션 8회",
            },
            {
                "title": "곡 다양성",
                "rule_type": "distinct_count",
                "target": 12,
                "rule_filter": {"event_type": "SESSION", "field": "song_library_id"},
                "description": "서로 다른 곡(song_library_id) 12개 이상",
            },
        ],
    }


def _read_seed_achievements(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    raw = path.read_bytes()
    text = ""
    for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if not text:
        text = raw.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows = [dict(row) for row in reader]
    headers = reader.fieldnames or ACHIEVEMENT_HEADERS.copy()
    for key in ACHIEVEMENT_HEADERS:
        if key not in headers:
            headers.append(key)
    return rows, headers


def _sanitize_icon_path(value: Any) -> str:
    text = str(value or "").strip()
    if text.startswith("/media/"):
        text = text[len("/media/") :]
    rel = Path(text)
    if rel.is_absolute() or ".." in rel.parts:
        return ""
    return text.replace("\\", "/")


@api_bp.get("/health")
def health() -> Response:
    return jsonify({"ok": True})


@api_bp.post("/session/start")
def session_start() -> Response:
    payload = request.get_json(silent=True) or {}
    state = _game().start_session(payload)
    return jsonify({"ok": True, "session": state})


@api_bp.post("/session/discard")
def session_discard() -> Response:
    payload = request.get_json(silent=True) or {}
    chain_mode = str(payload.get("chain_mode") or "last")
    result = _game().discard_session(chain_mode=chain_mode, settings=_settings())
    return jsonify({"ok": True, **result})


@api_bp.post("/session/switch")
def session_switch() -> Response:
    payload = request.get_json(silent=True) or {}
    result = _game().switch_session(payload, _settings())
    return jsonify({"ok": True, **result})


@api_bp.post("/session/retarget")
def session_retarget() -> Response:
    payload = request.get_json(silent=True) or {}
    try:
        result = _game().retarget_session(payload)
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    return jsonify({"ok": True, **result})


@api_bp.post("/session/stop")
def session_stop() -> Response:
    payload = request.get_json(silent=True) or {}
    settings = _settings()
    before = _game().hud_summary(settings)
    result = _game().stop_session(payload, settings)
    after = _game().hud_summary(settings)
    achievement_rows = {row.get("achievement_id"): row.get("name", "") for row in _storage().read_csv("achievements_master.csv")}
    result["auto_granted_names"] = [achievement_rows.get(item, item) for item in result.get("auto_granted", [])]
    result["level_up"] = after.get("level", 1) > before.get("level", 1)
    result["before_level"] = before.get("level", 1)
    result["after_level"] = after.get("level", 1)
    return jsonify({"ok": True, **result})


@api_bp.post("/session/finalize")
def session_finalize() -> Response:
    payload = request.get_json(silent=True) or {}
    settings = _settings()
    before = _game().hud_summary(settings)
    result = _game().finalize_session_chain(payload, settings)
    after = _game().hud_summary(settings)
    achievement_rows = {row.get("achievement_id"): row.get("name", "") for row in _storage().read_csv("achievements_master.csv")}
    result["auto_granted_names"] = [achievement_rows.get(item, item) for item in result.get("auto_granted", [])]
    result["level_up"] = after.get("level", 1) > before.get("level", 1)
    result["before_level"] = before.get("level", 1)
    result["after_level"] = after.get("level", 1)
    return jsonify({"ok": True, **result})


@api_bp.post("/session/quick-log")
def session_quick_log() -> Response:
    payload = request.get_json(silent=True) or {}
    settings = _settings()
    before = _game().hud_summary(settings)
    result = _game().quick_log(payload, settings)
    after = _game().hud_summary(settings)
    achievement_rows = {row.get("achievement_id"): row.get("name", "") for row in _storage().read_csv("achievements_master.csv")}
    result["auto_granted_names"] = [achievement_rows.get(item, item) for item in result.get("auto_granted", [])]
    result["level_up"] = after.get("level", 1) > before.get("level", 1)
    result["before_level"] = before.get("level", 1)
    result["after_level"] = after.get("level", 1)
    return jsonify({"ok": True, **result})


@api_bp.get("/gamification/level-up-copy")
def gamification_level_up_copy() -> Response:
    level = max(1, to_int(request.args.get("level"), 1))
    before_level = max(1, to_int(request.args.get("before_level"), max(1, level - 1)))
    lang = str(request.args.get("lang", "ko") or "ko").strip().lower()
    if lang not in {"ko", "en"}:
        lang = "ko"
    copy = _game().level_up_copy(level=level, before_level=before_level, lang=lang)
    return jsonify({"ok": True, "copy": copy})


@api_bp.get("/sessions")
def sessions_list() -> Response:
    limit = to_int(request.args.get("limit"), 300)
    sessions = _game().list_sessions(limit=limit)
    return jsonify({"ok": True, "sessions": sessions})


@api_bp.delete("/sessions/<event_id>")
def sessions_delete(event_id: str) -> Response:
    success, message = _game().delete_session(event_id, _settings())
    if not success:
        return jsonify({"ok": False, "message": message}), 404
    return jsonify({"ok": True, "message": message})


@api_bp.put("/sessions/<event_id>")
def sessions_update(event_id: str) -> Response:
    payload = request.get_json(silent=True) or {}
    success, message, item = _game().update_session(event_id, payload, _settings())
    if not success:
        return jsonify({"ok": False, "message": message}), 400
    return jsonify({"ok": True, "message": message, "session": item})


@api_bp.get("/stats/overview")
def stats_overview() -> Response:
    quest_range = str(request.args.get("quest_range", "all") or "all").strip().lower()
    if quest_range not in {"7d", "30d", "6m", "all"}:
        return jsonify({"ok": False, "message": f"unsupported quest_range: {quest_range}"}), 400
    return jsonify({"ok": True, "stats": _game().stats_overview(_settings(), quest_range=quest_range)})


@api_bp.get("/player/xp")
def player_xp() -> Response:
    return jsonify({"ok": True, "player": _game().player_xp_page(_settings())})


@api_bp.get("/player/xp-window")
def player_xp_window() -> Response:
    scope = str(request.args.get("scope", "all") or "all").strip().lower()
    period_unit = str(request.args.get("period_unit", "") or "").strip().lower()
    anchor = str(request.args.get("anchor", "") or "").strip()
    recent_days = to_int(request.args.get("recent_days"), 7)
    try:
        window = _game().player_xp_window(
            _settings(),
            scope=scope,
            period_unit=period_unit,
            anchor=anchor,
            recent_days=recent_days,
        )
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    return jsonify({"ok": True, "window": window})


@api_bp.get("/hud/summary")
def hud_summary() -> Response:
    return jsonify({"ok": True, "summary": _game().hud_summary(_settings())})


@api_bp.get("/quests/current")
def quests_current() -> Response:
    states = list_current_quests(_storage(), _settings())
    return jsonify({"ok": True, "quests": [s.__dict__ for s in states]})


@api_bp.post("/quests")
def quests_create_custom() -> Response:
    payload = request.get_json(silent=True) or {}
    title = str(payload.get("title") or "").strip()
    if not title:
        return jsonify({"ok": False, "message": "title is required"}), 400

    period_class = str(payload.get("period_class") or "mid").strip().lower()
    if period_class not in {"short", "mid", "long"}:
        return jsonify({"ok": False, "message": f"unsupported period_class: {period_class}"}), 400
    difficulty = str(payload.get("difficulty") or "mid").strip().lower()
    if difficulty not in {"low", "mid", "high"}:
        return jsonify({"ok": False, "message": f"unsupported difficulty: {difficulty}"}), 400
    priority = str(payload.get("priority") or "normal").strip().lower()
    if priority not in {"low", "normal", "urgent"}:
        return jsonify({"ok": False, "message": f"unsupported priority: {priority}"}), 400
    emoji = str(payload.get("emoji") or "").strip()
    if len(emoji) > 8:
        return jsonify({"ok": False, "message": "emoji must be 8 characters or less"}), 400
    rule_type = str(payload.get("rule_type") or "manual").strip().lower()
    if rule_type not in {"count_events", "sum_duration", "manual"}:
        return jsonify({"ok": False, "message": f"unsupported rule_type: {rule_type}"}), 400

    due_date = str(payload.get("due_date") or "").strip()
    if due_date:
        try:
            _ = date.fromisoformat(due_date)
        except ValueError:
            return jsonify({"ok": False, "message": "due_date must be YYYY-MM-DD"}), 400

    row = create_custom_quest(
        _storage(),
        {
            "title": title,
            "emoji": emoji,
            "description": str(payload.get("description") or "").strip(),
            "period_class": period_class,
            "difficulty": difficulty,
            "priority": priority,
            "rule_type": rule_type,
            "target": max(1, to_int(payload.get("target"), 1)),
            "due_date": due_date,
            "genre_tags": _parse_list_payload(payload.get("genre_tags")),
            "linked_song_ids": _parse_list_payload(payload.get("linked_song_ids")),
            "linked_drill_ids": _parse_list_payload(payload.get("linked_drill_ids")),
            "rule_filter": _parse_json_dict(payload.get("rule_filter")),
            "source": str(payload.get("source") or "manual").strip() or "manual",
        },
        _settings(),
    )
    return jsonify({"ok": True, "quest": row})


@api_bp.post("/quests/<quest_id>/claim")
def quests_claim(quest_id: str) -> Response:
    success, message = claim_quest(_storage(), _settings(), quest_id, now_local())
    if success:
        auto_granted = auto_grant_claims(_storage(), _settings(), now_local())
        return jsonify({"ok": True, "message": message, "auto_granted": auto_granted})
    return jsonify({"ok": False, "message": message}), 400


@api_bp.post("/quests/<quest_id>/fail")
def quests_fail(quest_id: str) -> Response:
    success, message = fail_quest(_storage(), _settings(), quest_id, now_local())
    if success:
        return jsonify({"ok": True, "message": message})
    return jsonify({"ok": False, "message": message}), 400


@api_bp.put("/quests/<quest_id>")
def quests_update(quest_id: str) -> Response:
    payload = request.get_json(silent=True) or {}
    success, message, row = update_quest(_storage(), _settings(), quest_id, payload, now_local())
    if success:
        return jsonify({"ok": True, "message": message, "quest": row})
    status_code = 404 if "not found" in message.lower() else 400
    return jsonify({"ok": False, "message": message}), status_code


@api_bp.post("/quests/auto/refresh")
def quests_auto_refresh() -> Response:
    payload = request.get_json(silent=True) or {}
    period_class_raw = str(payload.get("period_class") or "").strip().lower()
    period_class = period_class_raw if period_class_raw in {"short", "mid", "long"} else None
    if period_class_raw and period_class is None:
        return jsonify({"ok": False, "message": f"unsupported period_class: {period_class_raw}"}), 400
    force_raw = payload.get("force", False)
    if isinstance(force_raw, str):
        force = force_raw.strip().lower() in {"1", "true", "yes", "on"}
    else:
        force = bool(force_raw)
    result = refresh_auto_quests(_storage(), _settings(), now_local(), period_class=period_class, force=force)
    quests = [item.__dict__ for item in list_current_quests(_storage(), _settings())]
    return jsonify({"ok": True, **result, "quests": quests})


@api_bp.get("/achievements")
def achievements() -> Response:
    storage = _storage()
    settings = _settings()
    auto_grant_claims(storage, settings, now_local())
    states = evaluate_achievements(storage, settings)
    payload = [state.__dict__ for state in states]
    return jsonify({"ok": True, "achievements": payload})


@api_bp.get("/achievements/recent")
def achievements_recent() -> Response:
    limit = to_int(request.args.get("limit"), 5)
    return jsonify({"ok": True, "items": recent_claims(_storage(), limit=max(1, min(limit, 20)))})


@api_bp.post("/achievements/<achievement_id>/claim")
def achievement_claim(achievement_id: str) -> Response:
    success, message = manual_claim(_storage(), _settings(), achievement_id, now_local())
    if not success:
        return jsonify({"ok": False, "message": message}), 400
    return jsonify({"ok": True, "message": message})


@api_bp.get("/admin/achievements/master")
def admin_achievements_master() -> Response:
    storage = _storage()
    rows = storage.read_csv("achievements_master.csv")
    states = {item.achievement_id: item for item in evaluate_achievements(storage, _settings())}
    headers = _achievement_headers(storage)
    items: list[dict[str, Any]] = []
    for row in rows:
        ach_id = str(row.get("achievement_id") or "")
        item = {key: row.get(key, "") for key in headers}
        rule_filter = _parse_json_dict(row.get("rule_filter"))
        rule_summary, rule_steps = _rule_summary_ko(
            str(row.get("rule_type") or ""),
            max(1, to_int(row.get("target"), 1)),
            rule_filter,
        )
        item["_rule_summary_ko"] = rule_summary
        item["_rule_steps_ko"] = rule_steps
        state = states.get(ach_id)
        if state:
            item["_progress"] = state.progress
            item["_target"] = state.target
            item["_unlocked"] = state.unlocked
            item["_claimed"] = state.claimed
            item["_hidden_locked"] = state.hidden
            item["_effective_xp_reward"] = state.effective_xp_reward
        else:
            item["_progress"] = 0
            item["_target"] = to_int(row.get("target"), 1)
            item["_unlocked"] = False
            item["_claimed"] = False
            item["_hidden_locked"] = False
            item["_effective_xp_reward"] = to_int(row.get("xp_reward"), 0)
        items.append(item)
    items.sort(
        key=lambda item: (
            to_int(item.get("display_order"), 0),
            str(item.get("group_id") or ""),
            to_int(item.get("tier"), 1),
            str(item.get("achievement_id") or ""),
        )
    )
    return jsonify({"ok": True, "items": items})


@api_bp.get("/admin/achievements/rule-options")
def admin_achievements_rule_options() -> Response:
    return jsonify({"ok": True, **_collect_achievement_rule_options(_storage())})


@api_bp.post("/admin/achievements/master")
def admin_achievements_create() -> Response:
    storage = _storage()
    rows = storage.read_csv("achievements_master.csv")
    headers = _achievement_headers(storage)
    payload = request.get_json(silent=True) or {}

    ach_id = str(payload.get("achievement_id") or f"ACH_CUSTOM_{uuid.uuid4().hex[:8].upper()}").strip()
    if not ach_id:
        return jsonify({"ok": False, "message": "achievement_id is required"}), 400
    if any(str(item.get("achievement_id") or "") == ach_id for item in rows):
        return jsonify({"ok": False, "message": "achievement_id already exists"}), 400

    rule_type = str(payload.get("rule_type") or "manual").strip() or "manual"
    if rule_type.lower() not in RULE_TYPE_OPTIONS:
        return jsonify({"ok": False, "message": f"unsupported rule_type: {rule_type}"}), 400
    auto_grant_default = rule_type.lower() != "manual"
    next_display_order = max([to_int(item.get("display_order"), 0) for item in rows] + [0]) + 1
    try:
        normalized_rule_filter = _normalize_and_validate_rule_filter(payload.get("rule_filter"), storage)
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    row: dict[str, str] = {key: "" for key in headers}
    row.update(
        {
            "achievement_id": ach_id,
            "group_id": str(payload.get("group_id") or ach_id).strip() or ach_id,
            "name": str(payload.get("name") or "").strip() or ach_id,
            "tier": str(max(1, to_int(payload.get("tier"), 1))),
            "tier_name": str(payload.get("tier_name") or "단발"),
            "category": str(payload.get("category") or "커스텀"),
            "rarity": str(payload.get("rarity") or "rare"),
            "rule_type": rule_type,
            "rule_filter": normalized_rule_filter,
            "target": str(max(1, to_int(payload.get("target"), 1))),
            "display_order": str(max(1, to_int(payload.get("display_order"), next_display_order))),
            "xp_reward": str(max(0, to_int(payload.get("xp_reward"), 100))),
            "description": str(payload.get("description") or ""),
            "evidence_hint": str(payload.get("evidence_hint") or ""),
            "is_hidden": _to_bool_text(payload.get("is_hidden"), default=False),
            "hint": str(payload.get("hint") or ""),
            "auto_grant": _to_bool_text(payload.get("auto_grant"), default=auto_grant_default),
            "ui_badge_style": str(payload.get("ui_badge_style") or "custom"),
            "icon_path": _sanitize_icon_path(payload.get("icon_path")),
            "icon_url": str(payload.get("icon_url") or "").strip(),
        }
    )
    rows.append(row)
    storage.write_csv("achievements_master.csv", rows, headers=headers)
    return jsonify({"ok": True, "item": row})


@api_bp.put("/admin/achievements/master/<achievement_id>")
def admin_achievements_update(achievement_id: str) -> Response:
    storage = _storage()
    rows = storage.read_csv("achievements_master.csv")
    headers = _achievement_headers(storage)
    target = next((item for item in rows if str(item.get("achievement_id") or "") == achievement_id), None)
    if not target:
        return jsonify({"ok": False, "message": "achievement not found"}), 404

    payload = request.get_json(silent=True) or {}
    allowed = set(headers) - {"achievement_id"}
    if "rule_type" in payload:
        next_rule_type = str(payload.get("rule_type") or "").strip().lower()
        if next_rule_type and next_rule_type not in RULE_TYPE_OPTIONS:
            return jsonify({"ok": False, "message": f"unsupported rule_type: {next_rule_type}"}), 400
    if "rule_filter" in payload:
        try:
            payload["rule_filter"] = _normalize_and_validate_rule_filter(payload.get("rule_filter"), storage)
        except ValueError as exc:
            return jsonify({"ok": False, "message": str(exc)}), 400
    for key, value in payload.items():
        if key not in allowed:
            continue
        if key == "rule_filter":
            target[key] = str(value)
        elif key in {"is_hidden", "auto_grant"}:
            target[key] = _to_bool_text(value, default=target.get(key, "false") == "true")
        elif key in {"tier", "target", "display_order"}:
            target[key] = str(max(1, to_int(value, to_int(target.get(key), 1))))
        elif key == "xp_reward":
            target[key] = str(max(0, to_int(value, to_int(target.get(key), 0))))
        elif key == "icon_path":
            target[key] = _sanitize_icon_path(value)
        else:
            target[key] = str(value)
    if str(target.get("rule_type") or "").lower() == "manual":
        target["auto_grant"] = "false"
    storage.write_csv("achievements_master.csv", rows, headers=headers)
    return jsonify({"ok": True, "item": target})


@api_bp.delete("/admin/achievements/master/<achievement_id>")
def admin_achievements_delete(achievement_id: str) -> Response:
    storage = _storage()
    rows = storage.read_csv("achievements_master.csv")
    target = next((item for item in rows if str(item.get("achievement_id") or "") == achievement_id), None)
    if not target:
        return jsonify({"ok": False, "message": "achievement not found"}), 404
    scope = str(request.args.get("scope") or "row").strip().lower()
    if scope == "group":
        group_id = str(target.get("group_id") or achievement_id)
        kept = [item for item in rows if str(item.get("group_id") or "") != group_id]
    else:
        kept = [item for item in rows if str(item.get("achievement_id") or "") != achievement_id]
    deleted = len(rows) - len(kept)
    storage.write_csv("achievements_master.csv", kept, headers=_achievement_headers(storage))
    return jsonify({"ok": True, "deleted": deleted})


@api_bp.post("/admin/achievements/reset-curated")
def admin_achievements_reset_curated() -> Response:
    storage = _storage()
    seed_path = storage.paths.root / "designPack" / "data" / "achievements_master.csv"
    if not seed_path.exists() or not seed_path.is_file():
        return jsonify({"ok": False, "message": "seed achievements file not found"}), 404
    rows, headers = _read_seed_achievements(seed_path)
    for row in rows:
        row.setdefault("icon_path", "")
        row.setdefault("icon_url", "")
    storage.write_csv("achievements_master.csv", rows, headers=headers)
    return jsonify({"ok": True, "count": len(rows)})


@api_bp.post("/admin/achievements/export-pack")
def admin_achievements_export_pack() -> Response:
    payload = request.get_json(silent=True) or {}
    dataset_id = str(payload.get("dataset_id") or "").strip()
    if not dataset_id:
        return jsonify({"ok": False, "message": "dataset_id is required"}), 400
    name = str(payload.get("name") or "").strip()
    description = str(payload.get("description") or "").strip()
    try:
        result = _runtime_profiles().export_achievement_pack(
            _storage(),
            dataset_id=dataset_id,
            name=name,
            description=description,
        )
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    return jsonify({"ok": True, **result})


@api_bp.get("/unlockables")
def unlockables() -> Response:
    return jsonify({"ok": True, **_game().list_unlockables(_settings())})


@api_bp.post("/media/upload")
def media_upload() -> Response:
    storage = _storage()
    media_type = (
        request.form.get("media_type")
        or request.args.get("media_type")
        or (request.get_json(silent=True) or {}).get("media_type")
        or "audio"
    ).lower()
    if media_type not in {"audio", "video", "image"}:
        media_type = "audio"

    if request.files and "file" in request.files:
        incoming = request.files["file"]
        ext = Path(incoming.filename or "").suffix.lower()
        if not ext:
            return jsonify({"ok": False, "message": "파일 확장자를 확인할 수 없습니다."}), 400
        safe_name = f"{uuid.uuid4().hex}{ext}"
        target_dir = storage.paths.runtime_media / "evidence" / media_type
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name
        incoming.save(target_path)
        relative_path = f"evidence/{media_type}/{safe_name}"
        return jsonify({"ok": True, "path": relative_path, "url": f"/media/{relative_path}"})

    source_path = request.form.get("source_path") or (request.get_json(silent=True) or {}).get("source_path")
    if source_path:
        src = Path(source_path)
        if not src.exists() or not src.is_file():
            return jsonify({"ok": False, "message": "원본 파일 경로가 유효하지 않습니다."}), 400
        relative_path = storage.save_uploaded_file(src, media_type)
        return jsonify({"ok": True, "path": relative_path, "url": f"/media/{relative_path}"})

    return jsonify({"ok": False, "message": "업로드 파일 또는 source_path가 필요합니다."}), 400


@api_bp.post("/admin/achievements/icon-upload")
def admin_achievement_icon_upload() -> Response:
    storage = _storage()
    if request.files and "file" in request.files:
        incoming = request.files["file"]
        ext = Path(incoming.filename or "").suffix.lower()
        if not ext:
            return jsonify({"ok": False, "message": "file extension is required"}), 400
        safe_name = f"{uuid.uuid4().hex}{ext}"
        target_dir = storage.paths.runtime_media / "achievements" / "icons"
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name
        incoming.save(target_path)
        relative = f"achievements/icons/{safe_name}"
        return jsonify({"ok": True, "path": relative, "url": f"/media/{relative}"})

    source_path = request.form.get("source_path") or (request.get_json(silent=True) or {}).get("source_path")
    if source_path:
        src = Path(source_path)
        if not src.exists() or not src.is_file():
            return jsonify({"ok": False, "message": "source_path not found"}), 400
        ext = src.suffix.lower()
        safe_name = f"{uuid.uuid4().hex}{ext}"
        target_dir = storage.paths.runtime_media / "achievements" / "icons"
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name
        target_path.write_bytes(src.read_bytes())
        relative = f"achievements/icons/{safe_name}"
        return jsonify({"ok": True, "path": relative, "url": f"/media/{relative}"})

    return jsonify({"ok": False, "message": "file or source_path is required"}), 400


@api_bp.get("/media/list")
def media_list() -> Response:
    return jsonify({"ok": True, "media": _game().list_media()})


@api_bp.get("/records/list")
def records_list() -> Response:
    limit = max(10, min(to_int(request.args.get("limit"), 500), 2000))
    items = _game().list_records(
        limit=limit,
        query=str(request.args.get("q") or ""),
        search_scope=str(request.args.get("search_scope") or ""),
        post_type=str(request.args.get("post_type") or ""),
        media_type=str(request.args.get("media_type") or ""),
        song_library_id=str(request.args.get("song_library_id") or ""),
        drill_id=str(request.args.get("drill_id") or ""),
        tag_labels=_request_query_list_value("tag_labels"),
        song_library_ids=_request_query_list_value("song_library_ids"),
        drill_ids=_request_query_list_value("drill_ids"),
        header_id=str(request.args.get("header_id") or ""),
        template_id=str(request.args.get("template_id") or ""),
        sort=str(request.args.get("sort") or "created_desc"),
    )
    return jsonify({"ok": True, "items": items})


@api_bp.get("/records/<post_id>")
def records_detail(post_id: str) -> Response:
    item = _game().get_record_detail(post_id)
    if not item:
        return jsonify({"ok": False, "message": "Record not found."}), 404
    return jsonify({"ok": True, "item": item})


@api_bp.post("/records")
def records_create() -> Response:
    storage = _storage()

    files = request.files.getlist("files") if request.files else []
    if not files and request.files and "file" in request.files:
        files = [request.files["file"]]
    files = [item for item in files if item and (item.filename or "").strip()]
    external_attachments, external_error = _normalize_external_record_attachments(
        _request_object_list_value("external_attachments"),
        start_sort_order=len(files) + 1,
    )
    if external_error:
        return jsonify({"ok": False, "message": external_error}), 400
    if len(files) + len(external_attachments) > 8:
        return jsonify({"ok": False, "message": "게시글 첨부는 최대 8개입니다."}), 400

    attachment_titles = _request_list_value("attachment_titles")
    attachment_notes = _request_list_value("attachment_notes")
    attachments_payload: list[dict[str, Any]] = []

    for idx, incoming in enumerate(files, start=1):
        filename = incoming.filename or ""
        ext = Path(filename).suffix.lower()
        if not ext:
            ext = mimetypes.guess_extension((incoming.mimetype or "").split(";")[0]) or ""
        if not ext:
            return jsonify({"ok": False, "message": "첨부 파일 확장자를 확인할 수 없습니다."}), 400

        media_type = _infer_upload_media_type(filename, incoming.mimetype or "")
        safe_name = f"{uuid.uuid4().hex}{ext}"
        target_dir = storage.paths.runtime_media / "records" / media_type
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name
        incoming.save(target_path)
        attachments_payload.append(
            {
                "media_type": media_type,
                "path": f"records/{media_type}/{safe_name}",
                "url": "",
                "title": attachment_titles[idx - 1] if idx - 1 < len(attachment_titles) else "",
                "notes": attachment_notes[idx - 1] if idx - 1 < len(attachment_notes) else "",
                "sort_order": idx,
            }
        )
    attachments_payload.extend(external_attachments)

    payload = {
        "title": _request_value("title"),
        "body": _request_value("body"),
        "post_type": _request_value("post_type", "자유기록"),
        "header_id": _request_value("header_id"),
        "template_id": _request_value("template_id"),
        "meta": _request_object_value("meta"),
        "tags": _request_list_value("tags"),
        "linked_song_ids": _request_list_value("linked_song_ids"),
        "linked_drill_ids": _request_list_value("linked_drill_ids"),
        "free_targets": _request_list_value("free_targets"),
        "source": "app",
    }
    item = _game().create_record(payload, attachments_payload)
    return jsonify({"ok": True, "item": item})


@api_bp.put("/records/<post_id>")
def records_update(post_id: str) -> Response:
    storage = _storage()
    payload = dict(request.get_json(silent=True) or {})
    payload.pop("external_attachments", None)
    if request.form:
        for key in ["title", "body", "post_type", "header_id", "template_id"]:
            if key in request.form:
                payload[key] = _request_value(key)
        if "meta" in request.form:
            payload["meta"] = _request_object_value("meta")
        for key in ["tags", "linked_song_ids", "linked_drill_ids", "free_targets"]:
            if key in request.form:
                payload[key] = _request_list_value(key)
    files = request.files.getlist("files") if request.files else []
    if not files and request.files and "file" in request.files:
        files = [request.files["file"]]
    files = [item for item in files if item and (item.filename or "").strip()]
    existing_attachment_count = sum(1 for item in storage.read_csv("record_attachments.csv") if item.get("post_id") == post_id)
    external_attachments, external_error = _normalize_external_record_attachments(
        _request_object_list_value("external_attachments"),
        start_sort_order=existing_attachment_count + len(files) + 1,
    )
    if external_error:
        return jsonify({"ok": False, "message": external_error}), 400
    if existing_attachment_count + len(files) + len(external_attachments) > 8:
        return jsonify({"ok": False, "message": "게시글 첨부는 최대 8개입니다."}), 400

    attachment_titles = _request_list_value("attachment_titles")
    attachment_notes = _request_list_value("attachment_notes")
    attachments_payload: list[dict[str, Any]] = []
    for idx, incoming in enumerate(files, start=1):
        filename = incoming.filename or ""
        ext = Path(filename).suffix.lower()
        if not ext:
            ext = mimetypes.guess_extension((incoming.mimetype or "").split(";")[0]) or ""
        if not ext:
            return jsonify({"ok": False, "message": "첨부 파일 확장자를 확인할 수 없습니다."}), 400

        media_type = _infer_upload_media_type(filename, incoming.mimetype or "")
        safe_name = f"{uuid.uuid4().hex}{ext}"
        target_dir = storage.paths.runtime_media / "records" / media_type
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name
        incoming.save(target_path)
        attachments_payload.append(
            {
                "media_type": media_type,
                "path": f"records/{media_type}/{safe_name}",
                "url": "",
                "title": attachment_titles[idx - 1] if idx - 1 < len(attachment_titles) else "",
                "notes": attachment_notes[idx - 1] if idx - 1 < len(attachment_notes) else "",
                "sort_order": existing_attachment_count + idx,
            }
        )
    attachments_payload.extend(external_attachments)

    ok, message, item = _game().update_record(post_id, payload, attachments_payload)
    if not ok:
        return jsonify({"ok": False, "message": message}), 404
    return jsonify({"ok": True, "message": message, "item": item})


@api_bp.delete("/records/<post_id>")
def records_delete(post_id: str) -> Response:
    ok, message = _game().delete_record(post_id)
    if not ok:
        return jsonify({"ok": False, "message": message}), 404
    return jsonify({"ok": True, "message": message})


@api_bp.delete("/records/<post_id>/attachments/<attachment_id>")
def records_attachment_delete(post_id: str, attachment_id: str) -> Response:
    ok, message = _game().delete_record_attachment(post_id, attachment_id)
    if not ok:
        return jsonify({"ok": False, "message": message}), 404
    return jsonify({"ok": True, "message": message})


@api_bp.put("/records/<post_id>/attachments/<attachment_id>")
def records_attachment_update(post_id: str, attachment_id: str) -> Response:
    payload = request.get_json(silent=True) or {}
    ok, message, attachment = _game().update_record_attachment(post_id, attachment_id, payload)
    if not ok:
        return jsonify({"ok": False, "message": message}), 404
    return jsonify({"ok": True, "message": message, "attachment": attachment})


@api_bp.get("/records/<post_id>/comments")
def records_comments_list(post_id: str) -> Response:
    item = _game().get_record(post_id)
    if not item:
        return jsonify({"ok": False, "message": "Record not found."}), 404
    return jsonify({"ok": True, "items": _game().list_record_comments(post_id)})


@api_bp.post("/records/<post_id>/comments")
def records_comments_create(post_id: str) -> Response:
    payload = request.get_json(silent=True) or {}
    ok, message, item = _game().create_record_comment(post_id, payload)
    if not ok:
        status = 404 if "not found" in message.lower() else 400
        return jsonify({"ok": False, "message": message}), status
    return jsonify({"ok": True, "message": message, "item": item})


@api_bp.put("/records/<post_id>/comments/<comment_id>")
def records_comments_update(post_id: str, comment_id: str) -> Response:
    payload = request.get_json(silent=True) or {}
    ok, message, item = _game().update_record_comment(post_id, comment_id, payload)
    if not ok:
        status = 404 if "not found" in message.lower() else 400
        return jsonify({"ok": False, "message": message}), status
    return jsonify({"ok": True, "message": message, "item": item})


@api_bp.delete("/records/<post_id>/comments/<comment_id>")
def records_comments_delete(post_id: str, comment_id: str) -> Response:
    ok, message = _game().delete_record_comment(post_id, comment_id)
    if not ok:
        return jsonify({"ok": False, "message": message}), 404
    return jsonify({"ok": True, "message": message})


@api_bp.get("/gallery/list")
def gallery_list() -> Response:
    limit = to_int(request.args.get("limit"), 500)
    items = _game().list_gallery(limit=max(10, min(limit, 2000)))
    return jsonify({"ok": True, "items": items})


@api_bp.post("/gallery/upload")
def gallery_upload() -> Response:
    storage = _storage()
    media_type = (_request_value("media_type", "image") or "image").lower()
    if media_type not in {"image", "video", "audio"}:
        media_type = "image"
    now = now_local()

    relative_path = ""
    if request.files and "file" in request.files:
        incoming = request.files["file"]
        ext = Path(incoming.filename or "").suffix.lower()
        if not ext:
            return jsonify({"ok": False, "message": "파일 확장자를 확인할 수 없습니다."}), 400
        safe_name = f"{uuid.uuid4().hex}{ext}"
        target_dir = storage.paths.runtime_media / "gallery" / media_type
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name
        incoming.save(target_path)
        relative_path = f"gallery/{media_type}/{safe_name}"
    else:
        source_path = _request_value("source_path")
        if not source_path:
            return jsonify({"ok": False, "message": "업로드 파일 또는 source_path가 필요합니다."}), 400
        src = Path(source_path)
        if not src.exists() or not src.is_file():
            return jsonify({"ok": False, "message": "원본 파일 경로가 유효하지 않습니다."}), 400
        relative_path = storage.save_uploaded_file(src, media_type)

    title = _request_value("title", "Gallery Item") or "Gallery Item"
    notes = _request_value("notes", "")
    song_library_id = _request_value("song_library_id", "")
    drill_id = _request_value("drill_id", "")
    source_context = _request_value("source_context", "")
    manual_tags = _split_csv_tags(_request_value("tags", ""))

    tags = set(manual_tags)
    tags.add("GALLERY")
    tags.add(media_type.upper())
    if source_context:
        tags.add(source_context.upper())
    if media_type in {"audio", "video"}:
        tags.add("MEDIA_UPLOAD")
        if song_library_id:
            tags.add("SONG_MEDIA")
            tags.add(f"SONG_{song_library_id.upper()}")
        if drill_id:
            tags.add("DRILL_MEDIA")
            tags.add(f"DRILL_{drill_id.upper()}")

    event = create_event_row(
        created_at=now,
        event_type="GALLERY_UPLOAD",
        activity="Gallery",
        xp=0,
        title=title,
        notes=notes,
        song_library_id=song_library_id,
        drill_id=drill_id,
        tags=sorted(tags),
        evidence_type=media_type,
        evidence_path=relative_path,
        meta={"manual_tags": manual_tags, "source_context": source_context},
        source="app",
    )
    storage.append_csv_row("events.csv", event, storage.read_csv_headers("events.csv"))
    return jsonify({"ok": True, "item": event, "url": f"/media/{relative_path}"})


@api_bp.delete("/gallery/<event_id>")
def gallery_delete(event_id: str) -> Response:
    ok, message = _game().delete_gallery_item(event_id)
    if not ok:
        return jsonify({"ok": False, "message": message}), 404
    return jsonify({"ok": True, "message": message})


@api_bp.put("/gallery/<event_id>")
def gallery_update(event_id: str) -> Response:
    payload = request.get_json(silent=True) or {}
    ok, message, item = _game().update_gallery_item(event_id, payload)
    if not ok:
        return jsonify({"ok": False, "message": message}), 400
    return jsonify({"ok": True, "message": message, "item": item})


@api_bp.get("/settings")
def settings_get() -> Response:
    settings = _settings()
    return jsonify({"ok": True, "settings": settings})


@api_bp.get("/tutorial/state")
def tutorial_state_get() -> Response:
    campaign_id = request.args.get("campaign_id", TUTORIAL_CAMPAIGN_ID)
    payload = get_tutorial_state(_storage(), campaign_id=campaign_id)
    return jsonify({"ok": True, **payload})


@api_bp.post("/tutorial/start")
def tutorial_start_post() -> Response:
    payload = request.get_json(silent=True) or {}
    campaign_id = payload.get("campaign_id", TUTORIAL_CAMPAIGN_ID)
    started = start_tutorial(_storage(), campaign_id=campaign_id)
    return jsonify({"ok": True, **started})


@api_bp.post("/tutorial/progress")
def tutorial_progress_post() -> Response:
    payload = request.get_json(silent=True) or {}
    campaign_id = payload.get("campaign_id", TUTORIAL_CAMPAIGN_ID)
    step_index = to_int(payload.get("step_index"), 0)
    result = save_tutorial_progress(_storage(), campaign_id=campaign_id, step_index=step_index)
    return jsonify({"ok": True, **result})


@api_bp.post("/tutorial/banner-seen")
def tutorial_banner_seen_post() -> Response:
    payload = request.get_json(silent=True) or {}
    campaign_id = payload.get("campaign_id", TUTORIAL_CAMPAIGN_ID)
    result = mark_tutorial_banner_seen(_storage(), campaign_id=campaign_id)
    return jsonify({"ok": True, **result})


@api_bp.post("/tutorial/complete")
def tutorial_complete_post() -> Response:
    payload = request.get_json(silent=True) or {}
    campaign_id = payload.get("campaign_id", TUTORIAL_CAMPAIGN_ID)
    result = complete_tutorial(_storage(), campaign_id=campaign_id)
    return jsonify({"ok": True, **result})


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


@api_bp.put("/settings/basic")
def settings_basic_update() -> Response:
    storage = _storage()
    settings = storage.read_json("settings.json")
    payload = request.get_json(silent=True) or {}
    allowed_root = {"ui", "audio", "profile"}
    sanitized = {k: v for k, v in payload.items() if k in allowed_root and isinstance(v, dict)}
    merged = _deep_merge(settings, sanitized)
    normalized = storage.normalize_settings(merged)
    storage.write_json("settings.json", normalized)
    return jsonify({"ok": True, "settings": normalized})


@api_bp.put("/settings/critical")
def settings_critical_update() -> Response:
    storage = _storage()
    settings = storage.read_json("settings.json")
    payload = request.get_json(silent=True) or {}
    allowed_root = {"xp", "level_curve", "critical", "backup", "performance", "admin"}
    sanitized = {k: v for k, v in payload.items() if k in allowed_root and isinstance(v, dict)}
    merged = _deep_merge(settings, sanitized)
    normalized = storage.normalize_settings(merged)
    storage.write_json("settings.json", normalized)
    return jsonify({"ok": True, "settings": normalized})


@api_bp.post("/export")
def export_bundle() -> Response:
    export_path = create_export_bundle(_storage())
    return jsonify({"ok": True, "file": export_path.name, "path": str(export_path)})


@api_bp.get("/export/<name>")
def export_download(name: str) -> Response:
    path = _storage().paths.exports / name
    if not path.exists():
        return jsonify({"ok": False, "message": "파일이 없습니다."}), 404
    return send_file(path, as_attachment=True, download_name=name)


@api_bp.post("/backup/restore")
def backup_restore() -> Response:
    payload = request.get_json(silent=True) or {}
    name = payload.get("backup_name", "")
    ok, message = restore_from_backup(_storage(), name)
    if not ok:
        return jsonify({"ok": False, "message": message}), 400
    return jsonify({"ok": True, "message": message})


@api_bp.get("/backup/list")
def backup_list() -> Response:
    files = sorted(_storage().paths.backups.glob("backup_*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
    return jsonify(
        {
            "ok": True,
            "backups": [{"name": f.name, "size": f.stat().st_size, "mtime": f.stat().st_mtime} for f in files],
        }
    )


@api_bp.post("/system/pre-exit")
def system_pre_exit() -> Response:
    result = maybe_create_backup(_storage(), _settings(), trigger="shutdown")
    return jsonify({"ok": True, "backup": result})


@api_bp.get("/admin/mock-data/datasets")
def admin_mock_data_datasets() -> Response:
    return jsonify({"ok": True, "datasets": _runtime_profiles().list_datasets()})


@api_bp.get("/admin/mock-data/status")
def admin_mock_data_status() -> Response:
    return jsonify({"ok": True, **_runtime_profiles().status()})


@api_bp.post("/admin/mock-data/activate")
def admin_mock_data_activate() -> Response:
    payload = request.get_json(silent=True) or {}
    dataset_id = str(payload.get("dataset_id") or "").strip()
    if not dataset_id:
        return jsonify({"ok": False, "message": "dataset_id is required"}), 400
    reset_raw = payload.get("reset", False)
    if isinstance(reset_raw, str):
        reset = reset_raw.strip().lower() in {"1", "true", "yes", "on"}
    else:
        reset = bool(reset_raw)
    try:
        storage = _runtime_profiles().activate_mock(dataset_id, reset=reset)
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    _set_runtime_storage(storage)
    status = _runtime_profiles().status()
    return jsonify({"ok": True, **status})


@api_bp.post("/admin/mock-data/deactivate")
def admin_mock_data_deactivate() -> Response:
    storage = _runtime_profiles().deactivate_mock()
    _set_runtime_storage(storage)
    status = _runtime_profiles().status()
    return jsonify({"ok": True, **status})


@api_bp.post("/admin/mock-data/export-current")
def admin_mock_data_export_current() -> Response:
    payload = request.get_json(silent=True) or {}
    dataset_id = str(payload.get("dataset_id") or "").strip()
    if not dataset_id:
        return jsonify({"ok": False, "message": "dataset_id is required"}), 400

    name = str(payload.get("name") or "").strip()
    description = str(payload.get("description") or "").strip()
    generate_sessions_raw = payload.get("generate_sessions_60d", True)
    if isinstance(generate_sessions_raw, str):
        generate_sessions = generate_sessions_raw.strip().lower() in {"1", "true", "yes", "on"}
    else:
        generate_sessions = bool(generate_sessions_raw)
    session_days = to_int(payload.get("session_days"), 60)

    try:
        result = _runtime_profiles().export_current_as_dataset(
            _storage(),
            dataset_id=dataset_id,
            name=name,
            description=description,
            generate_sessions=generate_sessions,
            session_days=session_days,
        )
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400

    return jsonify({"ok": True, **result})


@api_bp.post("/admin/grant-xp")
def admin_grant_xp() -> Response:
    storage = _storage()
    payload = request.get_json(silent=True) or {}
    xp = max(1, to_int(payload.get("xp"), 100))
    now = now_local()
    event = create_event_row(
        created_at=now,
        event_type="ADMIN_ADJUST",
        activity="Admin",
        xp=xp,
        title=f"Admin XP +{xp}",
        notes="Manual test grant",
        tags=["ADMIN", "TEST"],
        source="admin",
    )
    storage.append_csv_row("events.csv", event, storage.read_csv_headers("events.csv"))
    return jsonify({"ok": True, "event": event})


@api_bp.post("/admin/reset-progress")
def admin_reset_progress() -> Response:
    storage = _storage()
    storage.reset_progress_only()
    return jsonify({"ok": True, "message": "Progress reset complete"})


@api_bp.post("/admin/reset-all")
def admin_reset_all() -> Response:
    storage = _storage()
    storage.reset_all_runtime()
    initialize_quest_templates(storage)
    ensure_bootstrap_data(storage)
    return jsonify({"ok": True, "message": "Runtime reset complete"})


@api_bp.get("/song-library")
def song_library_list() -> Response:
    rows = _storage().read_csv("song_library.csv")
    return jsonify({"ok": True, "items": rows})


@api_bp.post("/song-library")
def song_library_create() -> Response:
    storage = _storage()
    rows = storage.read_csv("song_library.csv")
    payload = request.get_json(silent=True) or {}
    next_num = len(rows) + 1
    library_id = payload.get("library_id") or f"L{next_num:04d}"
    now = now_local().isoformat()
    row = {
        "library_id": library_id,
        "song_id": payload.get("song_id", ""),
        "title": payload.get("title", ""),
        "artist": payload.get("artist", ""),
        "genre": payload.get("genre", ""),
        "mood": payload.get("mood", ""),
        "difficulty": payload.get("difficulty", ""),
        "favorite": "true" if str(payload.get("favorite", "false")).lower() in {"1", "true", "yes"} else "false",
        "purpose": payload.get("purpose", "실력향상"),
        "status": payload.get("status", "예정"),
        "focus_section": payload.get("focus_section", ""),
        "goal_bpm": payload.get("goal_bpm", ""),
        "key": payload.get("key", ""),
        "original_url": payload.get("original_url", ""),
        "sub_urls": payload.get("sub_urls", ""),
        "cover_path": payload.get("cover_path", ""),
        "score_pdf_path": payload.get("score_pdf_path", ""),
        "score_image_paths": payload.get("score_image_paths", ""),
        "cover_url": payload.get("cover_url", ""),
        "best_take_path": payload.get("best_take_path", ""),
        "best_take_url": payload.get("best_take_url", ""),
        "tags": payload.get("tags", ""),
        "notes": payload.get("notes", ""),
        "created_at": now,
        "last_practiced_at": "",
    }
    headers = storage.read_csv_headers("song_library.csv")
    rows.append(row)
    storage.write_csv("song_library.csv", rows, headers=headers)
    return jsonify({"ok": True, "item": row})


@api_bp.put("/song-library/<library_id>")
def song_library_update(library_id: str) -> Response:
    storage = _storage()
    rows = storage.read_csv("song_library.csv")
    payload = request.get_json(silent=True) or {}
    target = next((row for row in rows if row.get("library_id") == library_id), None)
    if not target:
        return jsonify({"ok": False, "message": "곡을 찾을 수 없습니다."}), 404
    for key, value in payload.items():
        if key in target:
            target[key] = str(value)
    storage.write_csv("song_library.csv", rows, headers=storage.read_csv_headers("song_library.csv"))
    return jsonify({"ok": True, "item": target})


@api_bp.delete("/song-library/<library_id>")
def song_library_delete(library_id: str) -> Response:
    storage = _storage()
    rows = storage.read_csv("song_library.csv")
    kept = [row for row in rows if row.get("library_id") != library_id]
    if len(kept) == len(rows):
        return jsonify({"ok": False, "message": "곡을 찾을 수 없습니다."}), 404
    storage.write_csv("song_library.csv", kept, headers=storage.read_csv_headers("song_library.csv"))
    return jsonify({"ok": True})


@api_bp.get("/drill-library")
def drill_library_list() -> Response:
    rows = _storage().read_csv("drill_library.csv")
    return jsonify({"ok": True, "items": rows})


@api_bp.post("/drill-library")
def drill_library_create() -> Response:
    storage = _storage()
    rows = storage.read_csv("drill_library.csv")
    headers = storage.read_csv_headers("drill_library.csv") or DRILL_LIBRARY_HEADERS.copy()
    for key in DRILL_LIBRARY_HEADERS:
        if key not in headers:
            headers = [*headers, key]
    for row in rows:
        for key in DRILL_LIBRARY_HEADERS:
            row.setdefault(key, "")
    payload = request.get_json(silent=True) or {}
    next_num = len(rows) + 1
    drill_id = payload.get("drill_id") or f"DL{next_num:04d}"
    now = now_local().isoformat()
    row = {
        "drill_id": drill_id,
        "name": payload.get("name", ""),
        "description": payload.get("description", ""),
        "area": payload.get("area", "기본기"),
        "favorite": "true" if str(payload.get("favorite", "false")).lower() in {"1", "true", "yes"} else "false",
        "tags": storage._normalize_drill_tags_csv(payload.get("tags", "")),
        "bpm_min": payload.get("bpm_min", ""),
        "bpm_max": payload.get("bpm_max", ""),
        "bpm_step": payload.get("bpm_step", "5"),
        "default_backing_id": payload.get("default_backing_id", ""),
        "image_path": payload.get("image_path", ""),
        "image_paths": payload.get("image_paths", ""),
        "image_url": payload.get("image_url", ""),
        "resource": payload.get("resource", ""),
        "notes": payload.get("notes", ""),
        "created_at": now,
        "last_used_at": "",
    }
    rows.append(row)
    storage.write_csv("drill_library.csv", rows, headers=headers)
    return jsonify({"ok": True, "item": row})


@api_bp.put("/drill-library/<drill_id>")
def drill_library_update(drill_id: str) -> Response:
    storage = _storage()
    rows = storage.read_csv("drill_library.csv")
    headers = storage.read_csv_headers("drill_library.csv") or DRILL_LIBRARY_HEADERS.copy()
    for key in DRILL_LIBRARY_HEADERS:
        if key not in headers:
            headers = [*headers, key]
    for row in rows:
        for key in DRILL_LIBRARY_HEADERS:
            row.setdefault(key, "")
    payload = request.get_json(silent=True) or {}
    target = next((row for row in rows if row.get("drill_id") == drill_id), None)
    if not target:
        return jsonify({"ok": False, "message": "드릴을 찾을 수 없습니다."}), 404
    for key, value in payload.items():
        if key in target:
            if key == "tags":
                target[key] = storage._normalize_drill_tags_csv(value)
            else:
                target[key] = str(value)
    storage.write_csv("drill_library.csv", rows, headers=headers)
    return jsonify({"ok": True, "item": target})


@api_bp.delete("/drill-library/<drill_id>")
def drill_library_delete(drill_id: str) -> Response:
    storage = _storage()
    rows = storage.read_csv("drill_library.csv")
    kept = [row for row in rows if row.get("drill_id") != drill_id]
    if len(kept) == len(rows):
        return jsonify({"ok": False, "message": "드릴을 찾을 수 없습니다."}), 404
    storage.write_csv("drill_library.csv", kept, headers=storage.read_csv_headers("drill_library.csv"))
    return jsonify({"ok": True})


@api_bp.get("/backing-tracks")
def backing_tracks_list() -> Response:
    rows = _storage().read_csv("backing_tracks.csv")
    return jsonify({"ok": True, "items": rows})


@api_bp.post("/backing-tracks")
def backing_tracks_create() -> Response:
    storage = _storage()
    rows = storage.read_csv("backing_tracks.csv")
    headers = storage.read_csv_headers("backing_tracks.csv") or BACKING_TRACK_HEADERS
    payload = request.get_json(silent=True) or {}
    next_num = len(rows) + 1
    backing_id = payload.get("backing_id") or f"BT{next_num:04d}"
    now = now_local().isoformat()
    row = {
        "backing_id": backing_id,
        "title": payload.get("title", ""),
        "description": payload.get("description", ""),
        "genre": payload.get("genre", ""),
        "favorite": "true" if str(payload.get("favorite", "false")).lower() in {"1", "true", "yes"} else "false",
        "chords": payload.get("chords", ""),
        "bpm": payload.get("bpm", ""),
        "youtube_url": payload.get("youtube_url", ""),
        "drill_id": payload.get("drill_id", ""),
        "tags": payload.get("tags", ""),
        "notes": payload.get("notes", ""),
        "created_at": now,
        "last_used_at": "",
    }
    rows.append(row)
    storage.write_csv("backing_tracks.csv", rows, headers=headers)
    return jsonify({"ok": True, "item": row})


@api_bp.put("/backing-tracks/<backing_id>")
def backing_tracks_update(backing_id: str) -> Response:
    storage = _storage()
    rows = storage.read_csv("backing_tracks.csv")
    headers = storage.read_csv_headers("backing_tracks.csv") or BACKING_TRACK_HEADERS
    payload = request.get_json(silent=True) or {}
    target = next((row for row in rows if row.get("backing_id") == backing_id), None)
    if not target:
        return jsonify({"ok": False, "message": "반주 트랙을 찾을 수 없습니다."}), 404
    for key, value in payload.items():
        if key in target:
            target[key] = str(value)
    storage.write_csv("backing_tracks.csv", rows, headers=headers)
    return jsonify({"ok": True, "item": target})


@api_bp.delete("/backing-tracks/<backing_id>")
def backing_tracks_delete(backing_id: str) -> Response:
    storage = _storage()
    rows = storage.read_csv("backing_tracks.csv")
    headers = storage.read_csv_headers("backing_tracks.csv") or BACKING_TRACK_HEADERS
    kept = [row for row in rows if row.get("backing_id") != backing_id]
    if len(kept) == len(rows):
        return jsonify({"ok": False, "message": "반주 트랙을 찾을 수 없습니다."}), 404
    storage.write_csv("backing_tracks.csv", kept, headers=headers)
    return jsonify({"ok": True})


@api_bp.get("/catalogs")
def catalogs() -> Response:
    storage = _storage()
    ladder_v2 = storage.read_csv("song_ladderv2.csv")
    ladder_legacy = storage.read_csv("song_ladder.csv")
    ladder = ladder_v2 or ladder_legacy
    return jsonify(
        {
            "ok": True,
            "song_ladder": ladder,
            "song_ladder_legacy": ladder_legacy,
            "song_ladder_v2": ladder_v2,
            "song_library": storage.read_csv("song_library.csv"),
            "drills": storage.read_csv("drill_catalog.csv"),
            "drill_library": storage.read_csv("drill_library.csv"),
            "backing_tracks": storage.read_csv("backing_tracks.csv"),
        }
    )


@api_bp.post("/onboarding/complete")
def onboarding_complete() -> Response:
    storage = _storage()
    settings = storage.read_json("settings.json")
    payload = request.get_json(silent=True) or {}
    profile = settings.setdefault("profile", {})
    profile["nickname"] = payload.get("nickname", profile.get("nickname", ""))
    profile["weekly_goal_sessions"] = to_int(payload.get("weekly_goal_sessions"), profile.get("weekly_goal_sessions", 3))
    profile["onboarded"] = True
    ui = settings.setdefault("ui", {})
    if payload.get("theme"):
        ui["default_theme"] = payload.get("theme")
    if payload.get("language"):
        ui["language"] = payload.get("language")
    audio = settings.setdefault("audio", {})
    if payload.get("audio_enabled") is not None:
        audio["enabled"] = bool(payload.get("audio_enabled"))
    storage.write_json("settings.json", settings)
    return jsonify({"ok": True, "settings": settings})

