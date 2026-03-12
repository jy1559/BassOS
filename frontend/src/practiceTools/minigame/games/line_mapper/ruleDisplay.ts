type RuleType = "CHORD" | "SCALE";

type RuleDisplayInput = {
  key: string;
  ruleType: RuleType;
  nameEn?: string;
};

type ChordDisplay = {
  compactSuffix: string;
  fullName: string;
};

const CHORD_DISPLAY_MAP: Record<string, ChordDisplay> = {
  maj: { compactSuffix: "", fullName: "major" },
  min: { compactSuffix: "m", fullName: "minor" },
  dim: { compactSuffix: "°", fullName: "diminished" },
  aug: { compactSuffix: "+", fullName: "augmented" },
  sus2: { compactSuffix: "sus2", fullName: "suspended 2" },
  sus4: { compactSuffix: "sus4", fullName: "suspended 4" },
  "7": { compactSuffix: "7", fullName: "dominant 7" },
  maj7: { compactSuffix: "△7", fullName: "major 7" },
  m7: { compactSuffix: "m7", fullName: "minor 7" },
  mMaj7: { compactSuffix: "m△7", fullName: "minor-major 7" },
  m7b5: { compactSuffix: "ø7", fullName: "half-diminished 7" },
  dim7: { compactSuffix: "°7", fullName: "diminished 7" },
  add9: { compactSuffix: "add9", fullName: "add9" },
  "9": { compactSuffix: "9", fullName: "dominant 9" },
  m9: { compactSuffix: "m9", fullName: "minor 9" },
  "11": { compactSuffix: "11", fullName: "11" },
  "13": { compactSuffix: "13", fullName: "13" },
  "7b9": { compactSuffix: "7(b9)", fullName: "7 flat 9" },
  "7#9": { compactSuffix: "7(#9)", fullName: "7 sharp 9" },
  "7sus4": { compactSuffix: "7sus4", fullName: "dominant 7 suspended 4" },
};

function titleCaseWords(value: string): string {
  return value
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function fallbackScaleName(key: string): string {
  return titleCaseWords(key.replace(/_/g, " "));
}

export function formatLineMapperRuleName(rootName: string, rule: RuleDisplayInput): string {
  if (rule.ruleType === "SCALE") {
    const scaleName = String(rule.nameEn || "").trim() || fallbackScaleName(rule.key);
    return `${rootName} ${scaleName}`.trim();
  }

  const chordDisplay = CHORD_DISPLAY_MAP[rule.key] ?? {
    compactSuffix: rule.key,
    fullName: String(rule.nameEn || "").trim() || titleCaseWords(rule.key),
  };
  const compact = `${rootName}${chordDisplay.compactSuffix}`.trim();
  const full = `${rootName} ${chordDisplay.fullName}`.trim();
  return compact === full ? full : `${compact} (${full})`;
}

