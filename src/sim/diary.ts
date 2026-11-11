import type { Msg, MsgKey } from '../i18n';
import type { Rng } from '../core/rng';

/**
 * Diaries (prompt 08): one short entry per resident per in-game day, written at midnight from what
 * the simulation actually did that day: no LLM, no invention. A template ("Tuesday — tried the new
 * bench. Rain. Two cats.") filled from the day's most notable event, its weather and a small seeded
 * detail, never the same detail twice running. Pure: no three.js, no DOM.
 */

/** What can happen in a day, most notable first. */
export type DiaryEvent = 'lookedFor' | 'newFavorite' | 'again' | 'tried' | 'noticed' | 'favorite';
const ORDER: readonly DiaryEvent[] = ['lookedFor', 'newFavorite', 'again', 'tried', 'noticed', 'favorite'];

export interface DiaryEntry {
  day: number;
  msg: Msg;
}

/** Entries kept per resident (a week). */
export const DIARY_DAYS = 7;

/** The small things a day can be remembered by (each a `diary.detail.*` line with a number). */
const DETAILS = ['pigeons', 'cats', 'crows', 'bell', 'breeze', 'kids'] as const;

export class Diary {
  entries: DiaryEntry[] = [];
  private today: { day: number; event: DiaryEvent | null; thing: Msg | null; rain: number; out: boolean } | null = null;
  private lastDetail = '';

  /** Something happened today (the first of the most notable kind is kept, with what it was about). */
  note(day: number, event: DiaryEvent, thing: Msg): void {
    const t = this.day(day);
    if (t.event === null || ORDER.indexOf(event) < ORDER.indexOf(t.event)) {
      t.event = event;
      t.thing = thing;
    }
  }

  /** Once a tick or so: the weather they were out in today. */
  weather(day: number, rain: number, out: boolean): void {
    const t = this.day(day);
    if (out) {
      t.out = true;
      t.rain = Math.max(t.rain, rain);
    }
  }

  private day(day: number): NonNullable<Diary['today']> {
    if (!this.today || this.today.day !== day) this.today = { day, event: null, thing: null, rain: 0, out: false };
    return this.today;
  }

  /**
   * Midnight: write yesterday's entry (if they were out at all). The event line comes from the day,
   * the detail from `rng`, never the same detail as last time.
   */
  close(day: number, rng: Rng): DiaryEntry | null {
    const t = this.today;
    if (!t || t.day !== day || !t.out) return null;
    const what: Msg = t.event && t.thing ? { key: `diary.${t.event}` as MsgKey, params: { thing: t.thing } } : { key: 'diary.quiet' };
    let detail: (typeof DETAILS)[number] = rng.pick(DETAILS);
    if (detail === this.lastDetail) detail = DETAILS[(DETAILS.indexOf(detail) + 1) % DETAILS.length]!;
    this.lastDetail = detail;
    const entry: DiaryEntry = {
      day,
      msg: {
        key: 'diary.entry',
        params: {
          day: { key: `diary.weekday.${day % 7}` as MsgKey },
          what,
          weather: { key: t.rain > 0.5 ? 'diary.rain' : t.rain > 0.15 ? 'diary.drizzle' : 'diary.fine' },
          detail: { key: `diary.detail.${detail}` as MsgKey, params: { n: rng.int(2, 5) } },
        },
      },
    };
    this.entries.push(entry);
    if (this.entries.length > DIARY_DAYS) this.entries.shift();
    this.today = null;
    return entry;
  }
}
