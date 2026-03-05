import type { Lang } from "../../i18n";

type Props = {
  lang: Lang;
  onStart: () => void;
  onDismiss: () => void;
};

export function TutorialBanner({ lang, onStart, onDismiss }: Props) {
  return (
    <section className="card tutorial-banner" data-testid="tutorial-banner">
      <div>
        <strong>{lang === "ko" ? "3분 코어 가이드" : "3-Min Core Guide"}</strong>
        <small className="muted">
          {lang === "ko"
            ? "핵심 기능만 빠르게 훑고 바로 연습 루프로 들어갑니다."
            : "Scan core features quickly and jump into practice."}
        </small>
      </div>
      <div className="row">
        <button className="ghost-btn" onClick={onDismiss}>
          {lang === "ko" ? "닫기" : "Dismiss"}
        </button>
        <button className="primary-btn" onClick={onStart}>
          {lang === "ko" ? "가이드 시작" : "Start Guide"}
        </button>
      </div>
    </section>
  );
}
