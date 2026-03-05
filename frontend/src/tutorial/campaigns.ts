import type { TutorialCampaign } from "./types";

export const CORE_CAMPAIGN_ID = "core_v1";

export const TUTORIAL_CAMPAIGNS: TutorialCampaign[] = [
  {
    id: CORE_CAMPAIGN_ID,
    label: {
      ko: "코어 가이드",
      en: "Core Guide",
    },
    kind: "core",
    rewardEligible: true,
    steps: [
      {
        id: "core_dashboard_hud",
        tab: "dashboard",
        anchor: "tutorial-dashboard-hud",
        title: { ko: "대시보드 1/5: HUD", en: "Dashboard 1/5: HUD" },
        body: {
          ko: "여기서 레벨, 랭크, 총 XP, 다음 레벨까지 남은 XP를 한 번에 확인합니다. 세션을 저장하면 이 카드 숫자가 바로 갱신됩니다.",
          en: "This card shows level, rank, total XP, and XP needed to level up. Values refresh right after saving a session.",
        },
      },
      {
        id: "core_dashboard_timer",
        tab: "dashboard",
        anchor: "tutorial-dashboard-timer",
        title: { ko: "대시보드 2/5: 세션 타이머", en: "Dashboard 2/5: Session Timer" },
        body: {
          ko: "연습은 여기서 시작/종료합니다. 곡/드릴 선택 후 시작하면 기록이 자동으로 세션에 연결되고, 종료 시 코치 피드백까지 바로 표시됩니다.",
          en: "Start and stop practice here. When you pick a song or drill, session logs link automatically and coach feedback appears on stop.",
        },
      },
      {
        id: "core_dashboard_next_win",
        tab: "dashboard",
        anchor: "dashboard-next-win",
        title: { ko: "대시보드 3/5: Next Win", en: "Dashboard 3/5: Next Win" },
        body: {
          ko: "지금 당장 할 다음 행동을 요약해 주는 카드입니다. 다음 레벨까지 XP, 주간 목표 잔여 세션, 다음 업적 진행도를 한 화면에서 봅니다.",
          en: "This card summarizes your immediate next action: XP to next level, sessions left for weekly goal, and nearest achievement progress.",
        },
      },
      {
        id: "core_dashboard_photo",
        tab: "dashboard",
        anchor: "tutorial-dashboard-photo",
        title: { ko: "대시보드 4/5: 사진 카드", en: "Dashboard 4/5: Photo Card" },
        body: {
          ko: "대시보드 감성 카드입니다. 우측 상단 톱니에서 업로드/클립보드 붙여넣기/맞춤 방식(전체표시·채우기)을 바꿔 집중용 배경으로 씁니다.",
          en: "This is your visual focus card. Use the top-right gear to upload, paste from clipboard, and adjust anchor position.",
        },
      },
      {
        id: "core_dashboard_shortcuts",
        tab: "dashboard",
        anchor: "tutorial-dashboard-shortcuts",
        title: { ko: "대시보드 5/5: 곡 바로가기", en: "Dashboard 5/5: Song Shortcuts" },
        body: {
          ko: "자주 연습하는 8곡을 슬롯에 고정합니다. 연습 스튜디오로 안 넘어가도 대시보드에서 바로 타겟 곡을 고르고 루틴을 시작할 수 있습니다.",
          en: "Pin up to 8 frequent songs here so you can jump into routine practice directly from Dashboard.",
        },
      },
      {
        id: "core_practice_stepper",
        tab: "practice",
        anchor: "tutorial-practice-stepper",
        title: { ko: "연습 스튜디오: 2단계 시작", en: "Practice Studio: 2-Step Start" },
        body: {
          ko: "1) 모드 선택, 2) 대상 선택 순서로 고정됩니다. 흐름이 단순해서 루틴 시작까지 헤매지 않게 설계했습니다.",
          en: "Flow is fixed to 1) mode, 2) target. The simplified order keeps session start fast and predictable.",
        },
      },
      {
        id: "core_practice_start",
        tab: "practice",
        anchor: "practice-start-target",
        title: { ko: "연습 스튜디오: 시작 버튼", en: "Practice Studio: Start CTA" },
        body: {
          ko: "대상을 고른 뒤 시작 버튼 1회로 세션이 열립니다. 시작 후 패널은 접혀서 연습 화면 집중도가 올라갑니다.",
          en: "After target selection, one click starts the session. The start panel collapses to keep focus on practice content.",
        },
      },
      {
        id: "core_journal_composer",
        tab: "gallery",
        anchor: "tutorial-journal-composer",
        title: { ko: "기록장: 작성 우선", en: "Journal: Write First" },
        body: {
          ko: "기록장은 본문 중심으로 쓰고, 연결/첨부는 필요할 때만 추가합니다. 먼저 한 줄 회고를 남기면 복습 품질이 크게 올라갑니다.",
          en: "Keep journal writing body-first, then add links/attachments only when needed. Even one reflective line improves review quality.",
        },
      },
      {
        id: "core_sessions_list",
        tab: "sessions",
        anchor: "tutorial-sessions-list",
        title: { ko: "세션 탭: 기록 정합성", en: "Sessions: Data Consistency" },
        body: {
          ko: "세션 수정/삭제 시 XP와 통계가 즉시 역반영됩니다. 데이터가 꼬였다고 느껴질 때는 이 탭에서 최근 기록부터 점검하면 가장 빠릅니다.",
          en: "Editing or deleting sessions reconciles XP and stats instantly. If numbers look off, validate recent entries here first.",
        },
      },
      {
        id: "core_settings_mock",
        tab: "settings",
        anchor: "mock-profile-status",
        title: { ko: "설정: 샌드박스 프로필", en: "Settings: Sandbox Profile" },
        body: {
          ko: "실데이터를 건드리지 않고 모의 데이터를 켜서 UI/루틴을 시험할 수 있습니다. 데이터셋 전환은 바로 반영됩니다.",
          en: "Enable mock profile to test UI and routines without touching real data. Dataset switching applies immediately.",
        },
      },
      {
        id: "core_settings_tutorial",
        tab: "settings",
        anchor: "tutorial-controls",
        title: { ko: "설정: 가이드 재실행", en: "Settings: Replay Guides" },
        body: {
          ko: "언제든 코어/딥다이브 가이드를 다시 시작하거나 이어할 수 있습니다. 완주 보상은 1회만 지급됩니다.",
          en: "You can restart or resume core/deep-dive guides anytime. Completion reward is granted once per campaign.",
        },
      },
    ],
  },
  {
    id: "deep_review",
    label: { ko: "딥다이브: 돌아보기", en: "Deep Dive: Review" },
    kind: "deep",
    rewardEligible: false,
    steps: [
      {
        id: "deep_review_kpi",
        tab: "review",
        anchor: "review-engagement",
        title: { ko: "돌아보기 1/2: 참여 KPI", en: "Review 1/2: Engagement KPI" },
        body: {
          ko: "7일 재방문율과 30일 활동일은 루틴 체력을 보여주는 핵심 지표입니다. 숫자가 떨어지면 연습 길이보다 빈도부터 회복하세요.",
          en: "Revisit 7d and active days 30d are routine-health KPIs. If they drop, recover frequency first before duration.",
        },
      },
      {
        id: "deep_review_period",
        tab: "review",
        anchor: "review-engagement",
        title: { ko: "돌아보기 2/2: 기간 비교", en: "Review 2/2: Period Compare" },
        body: {
          ko: "주간/월간 구간을 바꿔 최근 하락 구간을 찾으세요. '지난주 대비 세션 수'만 확인해도 다음 액션이 명확해집니다.",
          en: "Switch week/month windows to locate drop zones. Even checking sessions versus last week clarifies your next move.",
        },
      },
    ],
  },
  {
    id: "deep_xp",
    label: { ko: "딥다이브: XP", en: "Deep Dive: XP" },
    kind: "deep",
    rewardEligible: false,
    steps: [
      {
        id: "deep_xp_next",
        tab: "xp",
        anchor: "xp-next-win",
        title: { ko: "XP 1/2: 레벨 목표", en: "XP 1/2: Level Target" },
        body: {
          ko: "다음 레벨까지 필요한 XP를 먼저 보고 오늘 목표를 숫자로 잡습니다. 예: 700 XP면 30분 세션 1~2회로 현실적인 목표를 세울 수 있습니다.",
          en: "Start with XP needed to next level, then set a numeric daily target. Example: 700 XP often maps to 1-2 focused 30-minute sessions.",
        },
      },
      {
        id: "deep_xp_unlock",
        tab: "xp",
        anchor: "xp-next-win",
        title: { ko: "XP 2/2: 해금 연동", en: "XP 2/2: Unlock Planning" },
        body: {
          ko: "다음 해금 보상을 같이 보면 동기 유지가 쉽습니다. 레벨업 보상 직전에는 짧은 세션이라도 끊지 않고 이어가세요.",
          en: "Pair XP view with next unlock reward to keep momentum. Near unlock thresholds, keep streak continuity with short sessions.",
        },
      },
    ],
  },
  {
    id: "deep_songs",
    label: { ko: "딥다이브: 곡 라이브러리", en: "Deep Dive: Song Library" },
    kind: "deep",
    rewardEligible: false,
    steps: [
      {
        id: "deep_songs_stats",
        tab: "songs",
        anchor: "tutorial-songs-stats",
        title: { ko: "곡 라이브러리 1/3: 현황 읽기", en: "Song Library 1/3: Read Status" },
        body: {
          ko: "전체/즐겨찾기/완료/연습중 곡 수를 먼저 확인해 포트폴리오 균형을 잡습니다. 한 상태에 쏠리면 정체가 빨리 옵니다.",
          en: "Start from total/favorite/completed/practiced counts to balance your portfolio. Overloading one status usually causes plateaus.",
        },
      },
      {
        id: "deep_songs_add",
        tab: "songs",
        anchor: "tutorial-songs-add-btn",
        title: { ko: "곡 라이브러리 2/3: 곡 추가 시작", en: "Song Library 2/3: Add Entry" },
        body: {
          ko: "우측 상단 + 버튼으로 신규 곡 입력을 엽니다. 제목/아티스트/상태만 먼저 넣고 저장해도 세션 연동이 가능합니다.",
          en: "Use the + button to open quick add. Even title/artist/status alone is enough to start linking sessions.",
        },
      },
      {
        id: "deep_songs_example",
        tab: "songs",
        anchor: "tutorial-songs-create-form",
        title: { ko: "곡 라이브러리 3/3: 샘플 입력 예시", en: "Song Library 3/3: Sample Entry" },
        body: {
          ko: "예시로 'Smoke on the Water / Deep Purple / 상태: 시작 / 목적: 카피 연습'처럼 입력해보세요. 저장 후 상태를 '루프 연습'으로 바꿔 진행률을 관리합니다.",
          en: "Try a sample like 'Smoke on the Water / Deep Purple / Status: Started / Purpose: Copy Practice'. After saving, update status to track progress.",
        },
      },
    ],
  },
  {
    id: "deep_drills",
    label: { ko: "딥다이브: 드릴", en: "Deep Dive: Drills" },
    kind: "deep",
    rewardEligible: false,
    steps: [
      {
        id: "deep_drills_filter",
        tab: "drills",
        anchor: "tutorial-drills-main",
        title: { ko: "드릴 1/2: 찾기", en: "Drills 1/2: Find" },
        body: {
          ko: "영역/태그/즐겨찾기 필터로 오늘 드릴을 빠르게 좁힙니다. 3개 이하로 압축하면 세션 집중도가 올라갑니다.",
          en: "Narrow today’s drills with area/tag/favorite filters. Keeping options under three improves execution focus.",
        },
      },
      {
        id: "deep_drills_stack",
        tab: "drills",
        anchor: "tutorial-drills-main",
        title: { ko: "드릴 2/2: 실행 스택", en: "Drills 2/2: Execution Stack" },
        body: {
          ko: "기본 BPM, 배킹트랙, 레퍼런스 이미지를 같이 설정하면 반복 품질이 올라갑니다. 같은 드릴도 환경 세팅이 성과를 갈라줍니다.",
          en: "Set BPM, backing track, and reference image together for repeatable quality. Setup consistency drives progress.",
        },
      },
    ],
  },
  {
    id: "deep_quests",
    label: { ko: "딥다이브: 퀘스트", en: "Deep Dive: Quests" },
    kind: "deep",
    rewardEligible: false,
    steps: [
      {
        id: "deep_quests_focus",
        tab: "quests",
        anchor: "tutorial-quests-main",
        title: { ko: "퀘스트 1/2: 주간 집중", en: "Quests 1/2: Weekly Focus" },
        body: {
          ko: "자동 퀘스트와 수동 퀘스트를 분리해서 우선순위를 정합니다. 이번 주 핵심 1~2개만 남기면 완료율이 올라갑니다.",
          en: "Separate auto and manual quests, then keep only 1-2 core goals for the week to raise completion rate.",
        },
      },
      {
        id: "deep_quests_claim",
        tab: "quests",
        anchor: "tutorial-quests-main",
        title: { ko: "퀘스트 2/2: 즉시 수령", en: "Quests 2/2: Claim Fast" },
        body: {
          ko: "완료한 퀘스트는 바로 수령해 XP 흐름을 끊지 마세요. 작은 보상도 연속 누적되면 레벨 곡선이 눈에 띄게 빨라집니다.",
          en: "Claim completed quests immediately so XP flow stays continuous. Small rewards stack into meaningful level gains.",
        },
      },
    ],
  },
  {
    id: "deep_achievements",
    label: { ko: "딥다이브: 업적", en: "Deep Dive: Achievements" },
    kind: "deep",
    rewardEligible: false,
    steps: [
      {
        id: "deep_achievements_near",
        tab: "achievements",
        anchor: "tutorial-achievements-nextwin",
        title: { ko: "업적 1/2: 근접 목표 우선", en: "Achievements 1/2: Near-Finish First" },
        body: {
          ko: "진행률이 높은 업적부터 처리하면 성취감 루프가 빨리 돌기 시작합니다. '거의 완료' 2개를 먼저 마무리하세요.",
          en: "Finishing near-complete achievements starts the motivation loop faster. Close out 1-2 almost-done targets first.",
        },
      },
      {
        id: "deep_achievements_plan",
        tab: "achievements",
        anchor: "tutorial-achievements-nextwin",
        title: { ko: "업적 2/2: 세션 계획 연결", en: "Achievements 2/2: Plan by Session" },
        body: {
          ko: "업적 조건을 세션 타입(곡/드릴/자유)과 매칭해 계획하세요. 업적 이름만 보지 말고 필요한 행동 단위로 쪼개는 게 핵심입니다.",
          en: "Map achievement conditions to session types (song/drill/free). Break goals into concrete actions, not labels.",
        },
      },
    ],
  },
  {
    id: "deep_recommend",
    label: { ko: "딥다이브: 추천곡", en: "Deep Dive: Recommendations" },
    kind: "deep",
    rewardEligible: false,
    steps: [
      {
        id: "deep_recommend_pick",
        tab: "recommend",
        anchor: "tutorial-recommend-main",
        title: { ko: "추천곡 1/2: 후보 압축", en: "Recommendations 1/2: Narrow Picks" },
        body: {
          ko: "추천 리스트에서 이번 주 후보를 2~3곡만 남기세요. 선택지가 많을수록 시작이 느려집니다.",
          en: "Keep only 2-3 weekly candidates from recommendations. Too many choices slows session start.",
        },
      },
      {
        id: "deep_recommend_promote",
        tab: "recommend",
        anchor: "tutorial-recommend-main",
        title: { ko: "추천곡 2/2: 라이브러리 승격", en: "Recommendations 2/2: Promote to Library" },
        body: {
          ko: "연습할 곡이 정해지면 바로 곡 라이브러리로 추가해 상태 추적을 시작하세요. 추천 탭은 후보, 라이브러리는 실행입니다.",
          en: "Once picked, move the song to Song Library to start status tracking. Recommendations are for shortlist; Library is execution.",
        },
      },
    ],
  },
  {
    id: "deep_tools",
    label: { ko: "딥다이브: 연습 도구", en: "Deep Dive: Practice Tools" },
    kind: "deep",
    rewardEligible: false,
    steps: [
      {
        id: "deep_tools_stack",
        tab: "tools",
        anchor: "tutorial-tools-metronome",
        title: { ko: "연습 도구 1/2: 메트로놈 기준점", en: "Tools 1/2: Metronome Baseline" },
        body: {
          ko: "메트로놈 BPM을 오늘 기준점으로 고정하면 체감이 아닌 수치로 성장 확인이 가능합니다.",
          en: "Fix a daily metronome BPM baseline to measure progress numerically, not by feel alone.",
        },
      },
      {
        id: "deep_tools_combo",
        tab: "tools",
        anchor: "tutorial-tools-metronome",
        title: { ko: "연습 도구 2/2: 조합 루틴", en: "Tools 2/2: Combined Routine" },
        body: {
          ko: "메트로놈 + 백킹/탭 도구를 같이 쓰면 리듬 정확도와 곡 적용 속도가 동시에 올라갑니다.",
          en: "Combine metronome with backing/tab tools to improve rhythm precision and song transfer speed together.",
        },
      },
    ],
  },
];

export function getTutorialCampaign(campaignId: string): TutorialCampaign | undefined {
  return TUTORIAL_CAMPAIGNS.find((item) => item.id === campaignId);
}

export const DEEP_DIVE_CAMPAIGNS = TUTORIAL_CAMPAIGNS.filter((item) => item.kind === "deep");
