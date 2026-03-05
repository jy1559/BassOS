import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  toolbar: ReactNode;
  className?: string;
};

export function RecordTabHeader({ title, subtitle, toolbar, className = "" }: Props) {
  return (
    <header className={`record-tab-header ${className}`.trim()}>
      <div className="record-tab-header-main">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="record-tab-header-toolbar">{toolbar}</div>
    </header>
  );
}
