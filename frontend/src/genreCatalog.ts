export type GenreGroup = {
  name: string;
  values: string[];
};

const GROUP_POP = "\uD31D/\uAC00\uC694";
const GROUP_ROCK = "\uB85D/\uBA54\uD0C8";
const GROUP_GROOVE = "\uADF8\uB8E8\uBE0C";
const GROUP_FUNK = "\uD391\uD06C";
const GROUP_JAZZ = "\uC7AC\uC988/\uAE30\uD0C0";

const GENRE_ALIAS: Record<string, string> = {
  korea: "K-POP",
  "k-pop": "K-POP",
  kpop: "K-POP",
  japan: "J-POP",
  "j-pop": "J-POP",
  jpop: "J-POP",
  citypop: "City Pop",
  rnb: "R&B",
  hiphop: "Hip-hop",
  newwave: "New Wave",
  altrock: "Alt Rock",
  hardrock: "Hard Rock",
  punkrock: "Punk Rock",
  funkrock: "Funk Rock",
  indierock: "Indie Rock",
  progrock: "Prog Rock",
  postpunk: "Post-punk",
  reggaerock: "Reggae Rock",
  discorock: "Disco Rock",
  jazzrock: "Jazz Rock",
  jazzfunk: "Jazz-Funk",
  popfunk: "Pop-Funk",
  funkpop: "Funk Pop",
  neosoul: "Neo-soul",
  solobass: "Solo Bass",
};

const GENRE_GROUP_PRESET: GenreGroup[] = [
  {
    name: GROUP_POP,
    values: ["K-POP", "J-POP", "Pop", "City Pop", "Indie Pop", "Ballad", "R&B", "Soul", "Neo-soul"],
  },
  {
    name: GROUP_ROCK,
    values: [
      "Rock",
      "Pop Rock",
      "Alt Rock",
      "Hard Rock",
      "Punk Rock",
      "Funk Rock",
      "Indie Rock",
      "Metal",
      "Prog Rock",
      "Post-punk",
      "New Wave",
      "Reggae Rock",
      "Disco Rock",
      "Jazz Rock",
    ],
  },
  {
    name: GROUP_GROOVE,
    values: ["Disco", "Hip-hop", "Dance", "Electronic", "Groove"],
  },
  {
    name: GROUP_FUNK,
    values: ["Funk", "Funk Pop", "Pop-Funk", "Fusion", "Blues", "Latin"],
  },
  {
    name: GROUP_JAZZ,
    values: ["Jazz", "Jazz-Funk", "Reggae", "World", "Experimental", "Soundtrack", "Solo Bass"],
  },
];

const DEFAULT_GENRES = Array.from(new Set(GENRE_GROUP_PRESET.flatMap((group) => group.values))).sort((a, b) => a.localeCompare(b));

function compact(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[._]/g, "-");
}

export function normalizeGenre(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const key = compact(raw);
  if (GENRE_ALIAS[key]) return GENRE_ALIAS[key];
  return raw;
}

export function parseGenreTokens(raw: string): string[] {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[|,;\n]/g)
        .map((token) => normalizeGenre(token))
        .filter(Boolean)
    )
  );
}

export function collectGenrePool(rawValues: string[]): string[] {
  const all = new Set<string>(DEFAULT_GENRES);
  rawValues.forEach((raw) => parseGenreTokens(raw).forEach((genre) => all.add(genre)));
  return Array.from(all).sort((a, b) => a.localeCompare(b));
}

function guessGenreGroup(genre: string): string {
  const key = compact(genre);
  if (key.includes("rock") || key.includes("metal") || key.includes("punk") || key.includes("newwave")) return GROUP_ROCK;
  if (key.includes("jazz") || key.includes("fusion") || key.includes("blues") || key.includes("latin")) return GROUP_JAZZ;
  if (key.includes("k-pop") || key.includes("j-pop") || key === "pop" || key.includes("ballad") || key.includes("r&b") || key.includes("soul")) {
    return GROUP_POP;
  }
  if (key.includes("disco") || key.includes("dance") || key.includes("hip-hop") || key.includes("electro") || key.includes("groove")) {
    return GROUP_GROOVE;
  }
  if (key.includes("funk")) return GROUP_FUNK;
  return GROUP_JAZZ;
}

export function buildGenreGroups(genrePool: string[]): GenreGroup[] {
  const all = Array.from(new Set(genrePool.map((item) => normalizeGenre(item)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  const used = new Set<string>();
  const grouped = new Map<string, string[]>();

  GENRE_GROUP_PRESET.forEach((group) => {
    const found = group.values.filter((value) => all.includes(value));
    if (found.length) {
      grouped.set(group.name, found);
      found.forEach((value) => used.add(value));
    }
  });

  const rest = all.filter((value) => !used.has(value));
  rest.forEach((genre) => {
    const name = guessGenreGroup(genre);
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name)!.push(genre);
  });

  return GENRE_GROUP_PRESET.map((group) => {
    const values = (grouped.get(group.name) || []).slice().sort((a, b) => a.localeCompare(b));
    return { name: group.name, values };
  }).filter((group) => group.values.length > 0);
}

export function parseMoodTokens(raw: string): string[] {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[|,;\n]/g)
        .map((token) => token.trim())
        .filter(Boolean)
    )
  );
}

export function collectMoodPool(rawValues: string[]): string[] {
  const all = new Set<string>();
  rawValues.forEach((raw) => parseMoodTokens(raw).forEach((mood) => all.add(mood)));
  return Array.from(all).sort((a, b) => a.localeCompare(b));
}
