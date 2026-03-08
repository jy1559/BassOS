import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import minigameCss from "./minigame.raw.css?raw";

type Props = {
  children: ReactNode;
  className?: string;
};

function buildScopedCss(): string {
  const converted = minigameCss.replace(/:root/g, ":host").replace(/\bbody\b/g, ":host");
  return `${converted}

:host {
  display: block;
  min-height: 100%;
}

.mg-shadow-root {
  min-height: 100%;
}
`;
}

export function MinigameShadowSurface({ children, className = "" }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [mountNode, setMountNode] = useState<HTMLDivElement | null>(null);
  const scopedCss = useMemo(() => buildScopedCss(), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadowRoot.replaceChildren();

    const styleEl = document.createElement("style");
    styleEl.textContent = scopedCss;

    const rootEl = document.createElement("div");
    rootEl.className = "mg-shadow-root";
    shadowRoot.append(styleEl, rootEl);
    setMountNode(rootEl);

    return () => {
      setMountNode(null);
      shadowRoot.replaceChildren();
    };
  }, [scopedCss]);

  return (
    <div className={className} ref={hostRef}>
      {mountNode ? createPortal(children, mountNode) : null}
    </div>
  );
}
