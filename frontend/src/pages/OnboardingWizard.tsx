import { useState } from "react";
import { t, type Lang } from "../i18n";

type Props = {
  lang: Lang;
  onComplete: (payload: {
    nickname: string;
    weekly_goal_sessions: number;
    theme: string;
    language: "ko" | "en";
    audio_enabled: boolean;
  }) => Promise<void>;
};

export function OnboardingWizard({ lang, onComplete }: Props) {
  const [nickname, setNickname] = useState("");
  const [weeklyGoal, setWeeklyGoal] = useState(3);
  const [theme, setTheme] = useState("studio");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <h2>{t(lang, "onboardingTitle")}</h2>
        <p>BassOS를 빠르게 시작하기 위한 기본 설정입니다.</p>
        <label>
          Nickname
          <input value={nickname} onChange={(event) => setNickname(event.target.value)} />
        </label>
        <label>
          Weekly Goal Sessions
          <input
            type="number"
            min={1}
            max={14}
            value={weeklyGoal}
            onChange={(event) => setWeeklyGoal(Number(event.target.value))}
          />
        </label>
        <label>
          Theme
          <select value={theme} onChange={(event) => setTheme(event.target.value)}>
            <option value="studio">Studio</option>
            <option value="dark">Dark</option>
            <option value="neon">Neon</option>
            <option value="jazz">Jazz</option>
          </select>
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={audioEnabled}
            onChange={(event) => setAudioEnabled(event.target.checked)}
          />
          Level-up sound enabled
        </label>
        <button
          className="primary-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onComplete({
              nickname,
              weekly_goal_sessions: weeklyGoal,
              theme,
              language: lang,
              audio_enabled: audioEnabled
            });
            setBusy(false);
          }}
        >
          {t(lang, "complete")}
        </button>
      </div>
    </div>
  );
}
