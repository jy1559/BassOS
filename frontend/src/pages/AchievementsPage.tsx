import { useEffect, useMemo, useRef, useState } from "react";
import { claimAchievement } from "../api";
import { FilterBar, PageHeader } from "../components/ui";
import type { Lang } from "../i18n";
import type { Achievement, Settings } from "../types/models";
import type { CSSProperties } from "react";
import { achievementEmojiFallback, resolveAchievementIconVisual } from "../utils/achievementPresentation";

type Props = {
  lang: Lang;
  settings: Settings;
  items: Achievement[];
  onRefresh: () => Promise<void>;
  setMessage: (message: string) => void;
  onAchievementClaimed?: (payload: { name: string; description?: string; icon?: string; emoji?: string }) => void;
};

type StateFilter = "all" | "claimed" | "ready" | "in_progress";
type KindFilter = "all" | "tiered" | "single";
type CardKind = "tiered" | "single" | "hidden";
type SectionKind = "tiered" | "single";

type CopyPack = {
  filters: string;
  subtitle: string;
  all: string;
  claimed: string;
  ready: string;
  inProgress: string;
  allKinds: string;
  tiered: string;
  single: string;
  allCategories: string;
  allRules: string;
  claim: string;
  done: string;
  unlocked: string;
  hiddenHint: string;
  infoTip: string;
  claimedRatio: string;
  cards: string;
  recentUnlocked: string;
  foundHidden: string;
  claimable: string;
  locked: string;
  goal: string;
  notAchieved: string;
  autoClaimed: string;
  event: string;
  hidden: string;
};

const ko: CopyPack = {
  filters: "업적 필터",
  subtitle: "티어형/일회성 업적 카드를 확인하세요.",
  all: "전체",
  claimed: "수령 완료",
  ready: "수령 가능",
  inProgress: "진행 중",
  allKinds: "유형 전체",
  tiered: "티어형",
  single: "일회성",
  allCategories: "카테고리 전체",
  allRules: "규칙 전체",
  claim: "수령",
  done: "완료",
  unlocked: "달성",
  hiddenHint: "힌트",
  infoTip: "i 버튼에 마우스를 올리면 상세 조건과 힌트를 볼 수 있습니다.",
  claimedRatio: "수령 비율",
  cards: "표시 카드",
  recentUnlocked: "최근 획득 업적",
  foundHidden: "발견한 히든",
  claimable: "지금 수령 가능",
  locked: "잠금",
  goal: "목표",
  notAchieved: "미달성",
  autoClaimed: "자동 수령",
  event: "Event",
  hidden: "Hidden",
};

const en: CopyPack = {
  filters: "Achievement Filters",
  subtitle: "Browse tiered and one-off achievement cards.",
  all: "All",
  claimed: "Claimed",
  ready: "Ready",
  inProgress: "In progress",
  allKinds: "All kinds",
  tiered: "Tiered",
  single: "One-off",
  allCategories: "All categories",
  allRules: "All rules",
  claim: "Claim",
  done: "Claimed",
  unlocked: "Unlocked",
  hiddenHint: "Hint",
  infoTip: "Hover i to see detailed conditions and hints.",
  claimedRatio: "Claim ratio",
  cards: "Visible cards",
  recentUnlocked: "Recent unlocks",
  foundHidden: "Hidden found",
  claimable: "Ready to claim",
  locked: "Locked",
  goal: "Goal",
  notAchieved: "Not achieved",
  autoClaimed: "Auto claimed",
  event: "Event",
  hidden: "Hidden",
};

type CardPalette = { border: string; fill: string };

const DEFAULT_CARD_STYLES: Record<string, CardPalette> = {
  tier_bronze: { border: "#b88746", fill: "#f8f1e7" },
  tier_silver: { border: "#8ca0ad", fill: "#eff4f7" },
  tier_gold: { border: "#d6aa2d", fill: "#fcf6e7" },
  tier_platinum: { border: "#58a4be", fill: "#e8f7fa" },
  tier_diamond: { border: "#6f72ff", fill: "#f0f0ff" },
  tier_master: { border: "#ff9640", fill: "#fff1e2" },
  single_event: { border: "#4f8b92", fill: "#ebf6f8" },
  single_hidden: { border: "#59606a", fill: "#f0f2f5" },
};

function norm(input: string): string {
  return String(input || "").trim().toLowerCase();
}

function isSingle(item: Achievement): boolean {
  const tierName = norm(item.tier_name);
  return item.rule_type === "manual" || tierName.includes("event") || tierName.includes("single") || tierName.includes("단발");
}

function isHidden(item: Achievement): boolean {
  const c = norm(item.category);
  const t = norm(item.tier_name);
  return item.hidden || c.includes("hidden") || c.includes("히든") || t.includes("hidden") || t.includes("히든") || item.name === "???";
}

function cardKind(item: Achievement, groupSize: number): CardKind {
  if (isHidden(item)) return "hidden";
  if (groupSize <= 1 || isSingle(item)) return "single";
  return "tiered";
}

function tierWeight(item: Achievement): number {
  if (typeof item.tier === "number" && Number.isFinite(item.tier)) return item.tier;
  const n = norm(item.tier_name);
  if (n.includes("master")) return 6;
  if (n.includes("diamond")) return 5;
  if (n.includes("platinum")) return 4;
  if (n.includes("gold")) return 3;
  if (n.includes("silver")) return 2;
  if (n.includes("bronze")) return 1;
  return 0;
}

function tierClass(item: Achievement, kind: CardKind): string {
  if (kind === "hidden") return "tier-hidden";
  if (kind === "single") return "tier-single";
  const tier = Number(item.tier || 0);
  if (tier >= 6) return "tier-master";
  if (tier === 5) return "tier-diamond";
  if (tier === 4) return "tier-platinum";
  if (tier === 3) return "tier-gold";
  if (tier === 2) return "tier-silver";
  return "tier-bronze";
}

function styleKeyFor(item: Achievement, kind: CardKind): keyof typeof DEFAULT_CARD_STYLES {
  if (kind === "hidden") return "single_hidden";
  if (kind === "single") return "single_event";
  const tier = Number(item.tier || 1);
  if (tier >= 6) return "tier_master";
  if (tier === 5) return "tier_diamond";
  if (tier === 4) return "tier_platinum";
  if (tier === 3) return "tier_gold";
  if (tier === 2) return "tier_silver";
  return "tier_bronze";
}

function paletteFor(item: Achievement, kind: CardKind, settings: Settings): CardPalette {
  const key = styleKeyFor(item, kind);
  const rawMap = settings.ui?.achievement_card_styles || {};
  const fallback = DEFAULT_CARD_STYLES[key];
  const custom = rawMap[key] || {};
  const border = String(custom.border || fallback.border);
  const fill = String(custom.fill || fallback.fill);
  return { border, fill };
}

function canonicalTierName(tier: number): string {
  if (tier >= 6) return "Master";
  if (tier === 5) return "Diamond";
  if (tier === 4) return "Platinum";
  if (tier === 3) return "Gold";
  if (tier === 2) return "Silver";
  return "Bronze";
}

function fallbackName(item: Achievement): string {
  const key = (item.group_id || item.achievement_id || "").toUpperCase();
  if (key.includes("SESSION")) return "세션 챌린지";
  if (key.includes("DURATION")) return "누적 시간 챌린지";
  if (key.includes("XP")) return "XP 챌린지";
  if (key.includes("SONG")) return "곡 챌린지";
  if (key.includes("DRILL")) return "드릴 챌린지";
  return item.achievement_id || "Achievement";
}

function fallbackDescription(item: Achievement, lang: Lang): string {
  return lang === "ko" ? `목표 ${item.target} 달성` : `Reach target ${item.target}`;
}

function titleScaleClass(text: string): string {
  const len = String(text || "").trim().length;
  if (len >= 24) return "compact";
  if (len >= 16) return "tight";
  return "";
}

function descScaleClass(text: string): string {
  const len = String(text || "").trim().length;
  if (len >= 120) return "compact";
  if (len >= 78) return "tight";
  return "";
}

function ruleText(ruleType: string, lang: Lang): string {
  const koMap: Record<string, string> = {
    manual: "수동",
    count_events: "횟수",
    sum_duration: "시간",
    sum_xp: "XP",
    distinct_count: "고유 개수",
    streak_weekly: "주간 연속",
    streak_monthly: "월간 연속",
    level_reach: "레벨",
  };
  const enMap: Record<string, string> = {
    manual: "Manual",
    count_events: "Count",
    sum_duration: "Duration",
    sum_xp: "XP",
    distinct_count: "Distinct",
    streak_weekly: "Weekly Streak",
    streak_monthly: "Monthly Streak",
    level_reach: "Level",
  };
  if (lang === "ko") return koMap[ruleType] || ruleType;
  return enMap[ruleType] || ruleType;
}

function infoText(item: Achievement, copy: CopyPack, lang: Lang): string {
  if (item.hidden) {
    return item.hint
      ? `${copy.hiddenHint}: ${item.hint}`
      : (lang === "ko" ? "조건을 찾으면 카드가 열립니다." : "Find the condition to reveal this card.");
  }
  const rows = [
    `${ruleText(item.rule_type, lang)} · ${copy.goal} ${item.target}`,
    `${item.progress}/${item.target}`,
    item.evidence_hint,
    item.hint ? `${copy.hiddenHint}: ${item.hint}` : "",
  ];
  return rows.filter(Boolean).join("\n");
}

function formatClaimedAt(raw: string | undefined, lang: Lang): { date: string; time: string } | null {
  const token = String(raw || "").trim();
  if (!token) return null;
  const dt = new Date(token);
  if (Number.isNaN(dt.getTime())) return null;
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const min = String(dt.getMinutes()).padStart(2, "0");
  if (lang === "ko") return { date: `${yyyy}.${mm}.${dd}`, time: `${hh}:${min}` };
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

export function AchievementsPage({ lang, settings, items, onRefresh, setMessage, onAchievementClaimed }: Props) {
  const copy = lang === "ko" ? ko : en;
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [category, setCategory] = useState<string>("all");
  const [ruleFilter, setRuleFilter] = useState<string>("all");
  const [helpId, setHelpId] = useState<string>("");
  const recentStripRef = useRef<HTMLDivElement | null>(null);
  const [recentVisibleCount, setRecentVisibleCount] = useState(4);

  const categories = useMemo(() => ["all", ...Array.from(new Set(items.map((item) => item.category))).sort()], [items]);
  const ruleTypes = useMemo(() => ["all", ...Array.from(new Set(items.map((item) => item.rule_type))).sort()], [items]);

  const grouped = useMemo(() => {
    const map = new Map<string, Achievement[]>();
    items.forEach((item) => {
      const key = item.group_id || item.achievement_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    for (const [, groupItems] of map) {
      groupItems.sort((a, b) => tierWeight(a) - tierWeight(b));
    }
    return map;
  }, [items]);

  const groupCards = useMemo(() => {
    const cards: Array<{ item: Achievement; kind: CardKind; groupSize: number; groupId: string; groupOrder: number }> = [];
    for (const [groupId, groupItems] of grouped) {
      if (!groupItems.length) continue;
      const next = groupItems.find((entry) => !entry.claimed) ?? groupItems[groupItems.length - 1];
      const groupOrder = Math.min(...groupItems.map((entry) => Number(entry.display_order || 0) || 0));
      cards.push({
        item: next,
        kind: cardKind(next, groupItems.length),
        groupSize: groupItems.length,
        groupId,
        groupOrder: Number.isFinite(groupOrder) ? groupOrder : 0,
      });
    }
    return cards.sort((a, b) => {
      const aSection = a.kind === "tiered" ? 0 : 1;
      const bSection = b.kind === "tiered" ? 0 : 1;
      if (aSection !== bSection) return aSection - bSection;
      if (aSection === 1) {
        const ah = a.kind === "hidden" ? 1 : 0;
        const bh = b.kind === "hidden" ? 1 : 0;
        if (ah !== bh) return ah - bh;
      }
      if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
      return a.groupId.localeCompare(b.groupId);
    });
  }, [grouped]);

  const filtered = useMemo(() => {
    let rows = [...groupCards];
    if (category !== "all") rows = rows.filter((entry) => entry.item.category === category);
    if (ruleFilter !== "all") rows = rows.filter((entry) => entry.item.rule_type === ruleFilter);
    if (stateFilter === "claimed") rows = rows.filter((entry) => entry.item.claimed);
    if (stateFilter === "ready") rows = rows.filter((entry) => entry.item.unlocked && !entry.item.claimed);
    if (stateFilter === "in_progress") rows = rows.filter((entry) => !entry.item.claimed && !entry.item.unlocked);
    if (kindFilter === "tiered") rows = rows.filter((entry) => entry.kind === "tiered");
    if (kindFilter === "single") rows = rows.filter((entry) => entry.kind !== "tiered");
    return rows;
  }, [groupCards, stateFilter, kindFilter, category, ruleFilter]);

  const bySection = useMemo(() => {
    const map = new Map<SectionKind, Array<{ item: Achievement; kind: CardKind; groupId: string; groupOrder: number }>>();
    map.set("tiered", []);
    map.set("single", []);
    filtered.forEach((entry) => {
      const section: SectionKind = entry.kind === "tiered" ? "tiered" : "single";
      map.get(section)!.push({
        item: entry.item,
        kind: entry.kind,
        groupId: entry.groupId,
        groupOrder: entry.groupOrder,
      });
    });
    return map;
  }, [filtered]);

  const stats = useMemo(() => {
    const total = groupCards.length;
    const claimed = groupCards.filter((entry) => entry.item.claimed).length;
    const claimable = groupCards.filter((entry) => entry.item.unlocked && !entry.item.claimed).length;
    const hiddenFound = groupCards.filter((entry) => entry.kind === "hidden" && !entry.item.hidden).length;
    return { total, claimed, claimable, hiddenFound };
  }, [groupCards]);

  const recentClaims = useMemo(() => {
    const rows = items
      .filter((item) => item.claimed && item.claimed_at)
      .sort((a, b) => String(b.claimed_at || "").localeCompare(String(a.claimed_at || "")));
    return rows;
  }, [items]);

  useEffect(() => {
    const host = recentStripRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const cardMinWidth = 320;
    const update = () => {
      const width = host.clientWidth || 0;
      const next = Math.max(1, Math.floor(width / cardMinWidth));
      setRecentVisibleCount(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [recentClaims.length]);

  const sectionOrder: SectionKind[] = ["tiered", "single"];
  const sectionLabel = (kind: SectionKind): string => (kind === "tiered" ? copy.tiered : copy.single);

  return (
    <div className="page-grid achievement-list-page">
      <section className="card">
        <PageHeader title={copy.filters} subtitle={copy.subtitle} />
        <FilterBar className="achievement-filters">
          <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as StateFilter)}>
            <option value="all">{copy.all}</option>
            <option value="claimed">{copy.claimed}</option>
            <option value="ready">{copy.ready}</option>
            <option value="in_progress">{copy.inProgress}</option>
          </select>
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as KindFilter)}>
            <option value="all">{copy.allKinds}</option>
            <option value="tiered">{copy.tiered}</option>
            <option value="single">{copy.single}</option>
          </select>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? copy.allCategories : item}
              </option>
            ))}
          </select>
          <select value={ruleFilter} onChange={(event) => setRuleFilter(event.target.value)}>
            {ruleTypes.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? copy.allRules : ruleText(item, lang)}
              </option>
            ))}
          </select>
        </FilterBar>
        <small className="muted">{copy.infoTip}</small>
      </section>

      <section className="card achievement-kpi-row">
        <div className="achievement-kpi-item">
          <small>{copy.claimedRatio}</small>
          <strong>
            {stats.claimed}/{Math.max(1, stats.total)}
          </strong>
        </div>
        <div className="achievement-kpi-item">
          <small>{copy.cards}</small>
          <strong>{filtered.length}</strong>
        </div>
        <div className="achievement-kpi-item">
          <small>{copy.claimable}</small>
          <strong>{stats.claimable}</strong>
        </div>
        <div className="achievement-kpi-item">
          <small>{copy.foundHidden}</small>
          <strong>{stats.hiddenFound}</strong>
        </div>
      </section>

      {recentClaims.length ? (
        <section className="card achievement-recent-row-card">
          <div className="row">
            <h2>{copy.recentUnlocked}</h2>
            <small className="muted">{Math.min(recentVisibleCount, recentClaims.length)} / {recentClaims.length}</small>
          </div>
          <div className="achievement-recent-strip" ref={recentStripRef}>
            {recentClaims.slice(0, recentVisibleCount).map((item) => {
              const groupSize = grouped.get(item.group_id || item.achievement_id)?.length ?? 1;
              const kind = cardKind(item, groupSize);
              const iconVisual = resolveAchievementIconVisual(item);
              const topLabel =
                kind === "tiered" ? canonicalTierName(Number(item.tier || 1)) : kind === "hidden" ? copy.hidden : copy.event;
              const claimedAt = formatClaimedAt(item.claimed_at, lang);
              const preview = String(item.description || fallbackDescription(item, lang)).trim();
              const palette = paletteFor(item, kind, settings);
              const recentStyle = {
                borderColor: palette.border,
                "--tile-accent": palette.border,
                "--tile-fill": palette.fill,
                "--tile-progress": "100%",
              } as CSSProperties;
              return (
                <article
                  key={`recent_${item.achievement_id}_${item.claimed_at || ""}`}
                  className={`achievement-recent-item achievement-tile ${tierClass(item, kind)} claimed`}
                  style={recentStyle}
                >
                  <div className="achievement-medal achievement-medal-recent">
                    <div className="achievement-medal-ring" />
                    <div className="achievement-medal-core">
                      {iconVisual.imageSrc ? (
                        <img className="achievement-tile-icon" src={iconVisual.imageSrc} alt={item.name || item.achievement_id} />
                      ) : (
                        <div className={`achievement-tile-icon fallback ${iconVisual.emoji ? "emoji" : ""}`}>
                          {iconVisual.emoji || achievementEmojiFallback(item)}
                        </div>
                      )}
                    </div>
                    <span className="achievement-medal-check">✓</span>
                  </div>
                  <div className="achievement-recent-copy">
                    <div className="achievement-recent-topline">
                      <small className="achievement-tier-pill done">{topLabel}</small>
                      {claimedAt ? <small className="achievement-recent-mini-time">{claimedAt.time}</small> : null}
                    </div>
                    <h3 className={`achievement-title ${titleScaleClass(item.name || item.achievement_id)}`} title={item.name || item.achievement_id}>
                      {item.name || item.achievement_id}
                    </h3>
                    <small className={`achievement-tile-sub ${descScaleClass(preview)}`} title={preview}>
                      {preview}
                    </small>
                    {claimedAt ? (
                      <small className="achievement-claimed-at">
                        <span>{claimedAt.date}</span>
                        <span>{claimedAt.time}</span>
                      </small>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {sectionOrder.map((section) => {
        const rows = bySection.get(section) || [];
        if (!rows.length) return null;
        return (
          <section key={section} className="card">
            <div className="row">
              <h2>{sectionLabel(section)}</h2>
              <small className="muted">{rows.length}</small>
            </div>
            <div className="achievement-gallery-grid">
              {rows.map(({ item, kind, groupId }) => {
                const targetSafe = Math.max(Number(item.target) || 1, 1);
                const progressSafe = Math.max(0, Number(item.progress) || 0);
                const claimable = item.unlocked && !item.claimed;
                const opened = helpId === item.achievement_id;
                const hiddenLocked = item.hidden && !item.claimed;
                const progressRatio = hiddenLocked ? 0 : Math.min(1, progressSafe / targetSafe);
                const progressPct = Math.round(progressRatio * 100);
                const manualClaimable = claimable && String(item.rule_type || "").toLowerCase() === "manual";
                const displayName = hiddenLocked ? "???" : (item.name || fallbackName(item));
                const subtitle = hiddenLocked ? "???" : (item.description || fallbackDescription(item, lang));
                const claimedAt = formatClaimedAt(item.claimed_at, lang);
                const iconVisual = resolveAchievementIconVisual(item);
                const topLabel =
                  kind === "tiered" ? canonicalTierName(Number(item.tier || 1)) : kind === "hidden" ? copy.hidden : copy.event;
                const palette = paletteFor(item, kind, settings);
                const tileStyle = {
                  borderColor: palette.border,
                  "--tile-accent": palette.border,
                  "--tile-fill": palette.fill,
                  "--tile-progress": `${progressPct}%`,
                } as CSSProperties;
                return (
                  <article
                    key={groupId}
                    className={`achievement-tile ${tierClass(item, kind)} ${item.claimed ? "claimed" : ""} ${claimable ? "claimable" : ""} ${hiddenLocked ? "locked" : ""}`}
                    style={tileStyle}
                  >
                    <div className="achievement-tile-topline">
                      <small className={`achievement-tier-pill ${item.claimed ? "done" : ""}`}>{topLabel}</small>
                      <div
                        className="achievement-info-wrap"
                        onMouseEnter={() => setHelpId(item.achievement_id)}
                        onMouseLeave={() => setHelpId((prev) => (prev === item.achievement_id ? "" : prev))}
                      >
                        <button
                          className="tiny-info"
                          type="button"
                          onFocus={() => setHelpId(item.achievement_id)}
                          onBlur={() => setHelpId((prev) => (prev === item.achievement_id ? "" : prev))}
                        >
                          i
                        </button>
                        {opened ? <div className="achievement-tooltip">{infoText(item, copy, lang)}</div> : null}
                      </div>
                    </div>

                    <div className="achievement-medal">
                      <div className="achievement-medal-ring" />
                      <div className="achievement-medal-core">
                        {iconVisual.imageSrc ? (
                          <img className="achievement-tile-icon" src={iconVisual.imageSrc} alt={displayName} />
                        ) : (
                          <div className={`achievement-tile-icon fallback ${iconVisual.emoji ? "emoji" : ""}`}>
                            {iconVisual.emoji || achievementEmojiFallback(item)}
                          </div>
                        )}
                      </div>
                      {item.claimed ? <span className="achievement-medal-check">✓</span> : null}
                    </div>

                    <h3 className={`achievement-title ${titleScaleClass(displayName)}`} title={displayName}>
                      {displayName}
                    </h3>
                    <small className={`achievement-tile-sub ${descScaleClass(subtitle)}`} title={subtitle}>
                      {subtitle}
                    </small>
                    {claimedAt ? (
                      <small className="achievement-claimed-at">
                        <span>{claimedAt.date}</span>
                        <span>{claimedAt.time}</span>
                      </small>
                    ) : null}

                    <div className="achievement-tile-footer">
                      <div className="progress-wrap achievement-progress-wrap">
                        <div className="achievement-progress-row">
                          <small className="achievement-progress-value">{hiddenLocked ? copy.locked : `${item.progress}/${item.target}`}</small>
                          <small>{hiddenLocked ? copy.locked : `${progressPct}%`}</small>
                        </div>
                        <div className="progress-bar">
                          <div style={{ width: `${progressPct}%` }} />
                        </div>
                      </div>

                      <div className="achievement-tile-actions">
                        {item.claimed ? (
                          <span className="badge">{copy.done}</span>
                        ) : manualClaimable ? (
                          <button
                            className="primary-btn compact-add-btn"
                            onClick={async () => {
                              try {
                                await claimAchievement(item.achievement_id);
                                onAchievementClaimed?.({
                                  name: displayName,
                                  description: subtitle,
                                  icon: iconVisual.imageSrc,
                                  emoji: iconVisual.emoji,
                                });
                                await onRefresh();
                              } catch (error) {
                                setMessage(error instanceof Error ? error.message : "Claim failed");
                              }
                            }}
                          >
                            {copy.claim}
                          </button>
                        ) : claimable ? (
                          <span className="badge">{copy.autoClaimed}</span>
                        ) : (
                          <span className="achievement-miss">{copy.notAchieved}</span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

    </div>
  );
}
