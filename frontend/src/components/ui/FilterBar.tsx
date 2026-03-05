import type { ReactNode } from "react";

type FilterBarProps = {
  children: ReactNode;
  className?: string;
};

export function FilterBar({ children, className = "" }: FilterBarProps) {
  return <section className={`ui-filter-bar ${className}`.trim()}>{children}</section>;
}

