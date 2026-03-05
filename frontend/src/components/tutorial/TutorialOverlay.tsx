import { useEffect, useMemo, useState } from "react";
import type { Lang } from "../../i18n";
import type { TutorialStep } from "../../tutorial/types";

type Props = {
  lang: Lang;
  open: boolean;
  campaignLabel: string;
  steps: TutorialStep[];
  stepIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onComplete: () => void;
};

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

function resolveAnchor(anchor: string | undefined): HTMLElement | null {
  if (!anchor) return null;
  const byTestId = document.querySelector(`[data-testid="${anchor}"]`);
  if (byTestId instanceof HTMLElement) return byTestId;
  const byTutorialAnchor = document.querySelector(`[data-tutorial-anchor="${anchor}"]`);
  if (byTutorialAnchor instanceof HTMLElement) return byTutorialAnchor;
  return null;
}

function toRect(node: HTMLElement | null): Rect | null {
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function TutorialOverlay({
  lang,
  open,
  campaignLabel,
  steps,
  stepIndex,
  onPrev,
  onNext,
  onClose,
  onComplete,
}: Props) {
  const step = steps[Math.max(0, Math.min(stepIndex, steps.length - 1))];
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!open || !step) return;

    const updateRect = () => {
      const node = resolveAnchor(step.anchor);
      setAnchorRect(toRect(node));
    };

    const timer = window.setTimeout(() => {
      const node = resolveAnchor(step.anchor);
      if (node) {
        node.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      }
      updateRect();
    }, 50);

    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [open, step?.anchor, step?.id]);

  const title = step ? step.title[lang] : "";
  const body = step ? step.body[lang] : "";
  const isLast = stepIndex >= steps.length - 1;
  const hasTarget = Boolean(anchorRect);

  const spotlightStyle = useMemo(() => {
    if (!anchorRect) return undefined;
    return {
      top: `${Math.max(0, anchorRect.top - 8)}px`,
      left: `${Math.max(0, anchorRect.left - 8)}px`,
      width: `${anchorRect.width + 16}px`,
      height: `${anchorRect.height + 16}px`,
    };
  }, [anchorRect]);

  if (!open || !step) return null;

  return (
    <div className="tutorial-overlay" data-testid="tutorial-overlay">
      {hasTarget ? <div className="tutorial-spotlight-ring" style={spotlightStyle} /> : null}

      <aside className={`tutorial-card ${hasTarget ? "with-target" : "fallback"}`}>
        <small className="tutorial-campaign">{campaignLabel}</small>
        <h3>{title}</h3>
        <p>{body}</p>
        <small className="muted">
          {lang === "ko" ? `단계 ${stepIndex + 1}/${steps.length}` : `Step ${stepIndex + 1}/${steps.length}`}
        </small>

        <div className="tutorial-actions">
          <button className="ghost-btn" onClick={onClose}>
            {lang === "ko" ? "나중에" : "Later"}
          </button>
          <button className="ghost-btn" onClick={onPrev} disabled={stepIndex <= 0}>
            {lang === "ko" ? "이전" : "Back"}
          </button>
          {isLast ? (
            <button className="primary-btn" onClick={onComplete}>
              {lang === "ko" ? "완료" : "Finish"}
            </button>
          ) : (
            <button className="primary-btn" onClick={onNext}>
              {lang === "ko" ? "다음" : "Next"}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
