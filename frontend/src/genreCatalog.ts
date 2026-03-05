export type GenreGroup = {
  name: string;
  values: string[];
};

const GROUP_POP = "팝/가요";
const GROUP_ROCK = "록/메탈";
const GROUP_GROOVE = "그루브";
const GROUP_FUNK = "펑크";
const GROUP_JAZZ = "재즈/기타";

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

export const DEFAULT_GENRE_GROUPS: GenreGroup[] = GENRE_GROUP_PRESET.map((group) => ({
  name: group.name,
  values: [...group.values],
}));

const DEFAULT_GENRES = Array.from(new Set(GENRE_GROUP_PRESET.flatMap((group) => group.values))).sort((a, b) => a.localeCompare(b));

let runtimeGenreAliases: Record<string, string> = {};
let runtimeGenreGroups: GenreGroup[] | null = null;

function compact(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[._]/g, "-");
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const token = String(value || "").trim();
    if (!token) return;
    const key = token.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(token);
  });
  return out;
}

function sanitizeGroups(raw: GenreGroup[] | null | undefined): GenreGroup[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out: GenreGroup[] = [];
  const nameUsed = new Set<string>();
  raw.forEach((item, index) => {
    const nameSource = String(item?.name || "").trim();
    const name = nameSource || `Group ${index + 1}`;
    const nameKey = name.toLowerCase();
    if (nameUsed.has(nameKey)) return;
    nameUsed.add(nameKey);
    const values = dedupeCaseInsensitive(
      (Array.isArray(item?.values) ? item.values : []).map((value) => normalizeGenre(String(value || "")))
    );
    out.push({ name, values });
  });
  return out.length ? out : null;
}

function findFallbackGroupName(activeGroups: GenreGroup[], genre: string): string {
  const guessed = guessGenreGroup(genre);
  if (activeGroups.some((group) => group.name === guessed)) return guessed;
  return activeGroups[activeGroups.length - 1]?.name || guessed;
}

export function configureGenreCatalog(input?: {
  groups?: GenreGroup[] | null;
  aliases?: Record<string, string> | null;
}): void {
  const aliases: Record<string, string> = {};
  if (input?.aliases && typeof input.aliases === "object") {
    Object.entries(input.aliases).forEach(([rawKey, rawValue]) => {
      const key = compact(rawKey);
      const value = String(rawValue || "").trim();
      if (!key || !value) return;
      aliases[key] = value;
    });
  }
  runtimeGenreAliases = aliases;
  runtimeGenreGroups = sanitizeGroups(input?.groups);
}

export function normalizeGenre(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const key = compact(raw);
  if (runtimeGenreAliases[key]) return runtimeGenreAliases[key];
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

export function normalizeGenreGroups(
  groups: GenreGroup[] | null | undefined,
  genrePool: string[],
  options?: { keepEmpty?: boolean }
): GenreGroup[] {
  const cleanPool = dedupeCaseInsensitive(genrePool.map((item) => normalizeGenre(item))).filter(Boolean);
  const fromInput = sanitizeGroups(groups);
  if (!fromInput) {
    return buildGenreGroups(cleanPool);
  }

  const allValues = dedupeCaseInsensitive([
    ...cleanPool,
    ...fromInput.flatMap((group) => group.values.map((value) => normalizeGenre(value))),
  ]);

  const used = new Set<string>();
  const mapped = fromInput.map((group) => {
    const values = dedupeCaseInsensitive(group.values.map((value) => normalizeGenre(value))).filter((value) => allValues.includes(value));
    values.forEach((value) => used.add(value.toLowerCase()));
    return { name: group.name, values };
  });

  const leftover = allValues.filter((value) => !used.has(value.toLowerCase()));
  if (leftover.length) {
    const fallbackIdx = mapped.length - 1;
    if (fallbackIdx >= 0) {
      mapped[fallbackIdx] = {
        ...mapped[fallbackIdx],
        values: dedupeCaseInsensitive([...mapped[fallbackIdx].values, ...leftover]).sort((a, b) => a.localeCompare(b)),
      };
    } else {
      mapped.push({
        name: GROUP_JAZZ,
        values: leftover.sort((a, b) => a.localeCompare(b)),
      });
    }
  }

  if (options?.keepEmpty) return mapped;
  return mapped.filter((group) => group.values.length > 0);
}

export function buildGenreGroups(genrePool: string[], customGroups?: GenreGroup[] | null): GenreGroup[] {
  const activeGroups = sanitizeGroups(customGroups ?? runtimeGenreGroups) || GENRE_GROUP_PRESET;
  const all = Array.from(new Set(genrePool.map((item) => normalizeGenre(item)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  const used = new Set<string>();
  const grouped = new Map<string, string[]>();

  activeGroups.forEach((group) => {
    const found = group.values.filter((value) => all.includes(value));
    if (found.length) {
      grouped.set(group.name, found);
      found.forEach((value) => used.add(value));
    }
  });

  const rest = all.filter((value) => !used.has(value));
  rest.forEach((genre) => {
    const name = findFallbackGroupName(activeGroups, genre);
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name)!.push(genre);
  });

  return activeGroups
    .map((group) => {
      const values = (grouped.get(group.name) || []).slice().sort((a, b) => a.localeCompare(b));
      return { name: group.name, values };
    })
    .filter((group) => group.values.length > 0);
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

