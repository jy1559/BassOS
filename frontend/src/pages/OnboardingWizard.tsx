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
  const [busy, setBusy] = useState(false);

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <h2>{t(lang, "onboardingTitle")}</h2>
        <p>{lang === "ko" ? "이름을 입력해주세요" : "Please enter your name."}</p>
        <label>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            aria-label="Nickname"
            placeholder={lang === "ko" ? "이름" : "Nickname"}
          />
        </label>
        <button
          className="primary-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onComplete({
              nickname,
              weekly_goal_sessions: 3,
              theme: "studio",
              language: lang,
              audio_enabled: false,
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
