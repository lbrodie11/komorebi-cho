import { en, type MsgKey } from './en';
import { ja } from './ja';

export type { MsgKey };
export type Lang = 'en' | 'ja';
export const LANGS: readonly Lang[] = ['en', 'ja'];

/** A message to show later, in whatever language is current then (the sim emits these; the HUD words them). */
export interface Msg {
  key: MsgKey;
  params?: Params;
}
export type Params = Record<string, string | number | Msg>;

const TABLES: Record<Lang, Record<MsgKey, string>> = { en, ja };

let current: Lang = 'en';

export const getLang = (): Lang => current;
export function setLang(l: Lang): void {
  current = l;
}

/** The browser's preferred language if we have it, else English. */
export function browserLang(langs: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages): Lang {
  for (const l of langs) {
    const base = l.toLowerCase().split('-')[0];
    if ((LANGS as readonly string[]).includes(base!)) return base as Lang;
  }
  return 'en';
}

export const msg = (key: MsgKey, params?: Params): Msg => (params ? { key, params } : { key });

/** Is this string a known message key? (For keys built at run time, such as `persona.${id}.name`.) */
export const isKey = (k: string): k is MsgKey => k in en;

/** Format a message in the current language (or `lang`). */
export function t(key: MsgKey, params?: Params, lang: Lang = current): string {
  return format(TABLES[lang][key] ?? en[key] ?? key, params, lang);
}

export function fmt(m: Msg, lang: Lang = current): string {
  return t(m.key, m.params, lang);
}

/**
 * A small ICU MessageFormat subset: `{name}` and `{n, plural, =0 {…} one {…} other {…}}`,
 * with `#` standing for the number inside a plural branch. Enough for our strings, no dependency.
 */
export function format(pattern: string, params: Params = {}, lang: Lang = current): string {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch !== '{') {
      out += ch;
      i++;
      continue;
    }
    const end = matching(pattern, i);
    const body = pattern.slice(i + 1, end);
    i = end + 1;
    const comma = body.indexOf(',');
    if (comma < 0) {
      out += value(params[body.trim()], lang);
      continue;
    }
    const name = body.slice(0, comma).trim();
    const rest = body.slice(comma + 1);
    const kind = rest.slice(0, rest.indexOf(',')).trim();
    if (kind !== 'plural') {
      out += value(params[name], lang);
      continue;
    }
    const n = Number(params[name] ?? 0);
    const branches = parseBranches(rest.slice(rest.indexOf(',') + 1));
    const cat = lang === 'en' ? (n === 1 ? 'one' : 'other') : 'other';
    const chosen = branches.get(`=${n}`) ?? branches.get(cat) ?? branches.get('other') ?? '';
    out += format(chosen, params, lang).replace(/#/g, String(n));
  }
  return out;
}

function value(v: string | number | Msg | undefined, lang: Lang): string {
  if (v === undefined) return '';
  if (typeof v === 'object') return fmt(v, lang);
  return String(v);
}

/** Index of the `}` matching the `{` at `open`. */
function matching(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return s.length - 1;
}

function parseBranches(s: string): Map<string, string> {
  const m = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('{', i);
    if (open < 0) break;
    const sel = s.slice(i, open).trim();
    const close = matching(s, open);
    m.set(sel, s.slice(open + 1, close));
    i = close + 1;
  }
  return m;
}

/** Placeholder names used by a pattern (for the translation tests). */
export function placeholders(pattern: string): string[] {
  const names = new Set<string>();
  for (const m of pattern.matchAll(/\{\s*([a-zA-Z_]\w*)\s*(?:[,}])/g)) names.add(m[1]!);
  return [...names].sort();
}
