"""Time helper functions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta


ISO_FMT = "%Y-%m-%dT%H:%M:%S"


def now_local() -> datetime:
    return datetime.now().replace(microsecond=0)


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    for candidate in (value, value.replace("Z", "+00:00")):
        try:
            parsed = datetime.fromisoformat(candidate)
            return parsed.replace(microsecond=0, tzinfo=None)
        except ValueError:
            continue
    try:
        return datetime.strptime(value, ISO_FMT)
    except ValueError:
        return None


def to_iso(dt: datetime | None) -> str:
    if not dt:
        return ""
    return dt.replace(microsecond=0).isoformat()


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def week_period(anchor: date | None = None) -> tuple[date, date, str]:
    today = anchor or date.today()
    start = today - timedelta(days=today.weekday())
    end = start + timedelta(days=6)
    return start, end, f"W{start.isoformat()}"


def month_period(anchor: date | None = None) -> tuple[date, date, str]:
    today = anchor or date.today()
    start = today.replace(day=1)
    if start.month == 12:
        next_month = start.replace(year=start.year + 1, month=1)
    else:
        next_month = start.replace(month=start.month + 1)
    end = next_month - timedelta(days=1)
    return start, end, f"M{start.year:04d}-{start.month:02d}"


@dataclass
class DateRange:
    start: datetime
    end: datetime

    @property
    def duration_minutes(self) -> int:
        delta = self.end - self.start
        if delta.total_seconds() <= 0:
            return 0
        return int(delta.total_seconds() // 60)
