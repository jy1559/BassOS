type NextWinCardProps = {
  title: string;
  lines: string[];
  className?: string;
  testId?: string;
};

export function NextWinCard({ title, lines, className = "", testId }: NextWinCardProps) {
  return (
    <section className={`card ui-next-win-card ${className}`.trim()} data-testid={testId}>
      <h2>{title}</h2>
      <div className="ui-next-win-list">
        {lines.filter(Boolean).map((line, idx) => (
          <small key={`${idx}_${line}`}>{line}</small>
        ))}
      </div>
    </section>
  );
}

