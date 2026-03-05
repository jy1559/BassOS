import type { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
  action?: ReactNode;
};

export function StatCard({ label, value, hint, className = "", action }: StatCardProps) {
  return (
    <article className={`ui-stat-card ${className}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
      {action ? <div className="ui-stat-action">{action}</div> : null}
    </article>
  );
}

