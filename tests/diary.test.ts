import { describe, expect, it } from 'vitest';
import { Diary, DIARY_DAYS } from '../src/sim/diary';
import { Rng } from '../src/core/rng';
import { fmt } from '../src/i18n';

const bench = { key: 'noun.bench' as const };

describe('diaries (prompt 08)', () => {
  it("writes the day's most notable event, its weather and a small detail", () => {
    const d = new Diary();
    d.weather(1, 0, true);
    d.note(1, 'favorite', { key: 'noun.bench-pond-a' });
    d.note(1, 'tried', bench); // more notable than sitting at the favourite
    d.weather(1, 0.8, true);
    const e = d.close(1, new Rng(1))!;
    const line = fmt(e.msg);
    expect(line).toMatch(/^Tuesday — tried the new bench\. Rain\. .+\.$/);
  });

  it('writes nothing for a day spent indoors, and a quiet line for an uneventful one', () => {
    const d = new Diary();
    d.weather(0, 0, false);
    expect(d.close(0, new Rng(1))).toBeNull();
    d.weather(2, 0, true);
    expect(fmt(d.close(2, new Rng(1))!.msg)).toMatch(/^Wednesday — a quiet day\. Sunny\./);
  });

  it('never repeats the same detail two days running, and keeps a week', () => {
    const d = new Diary();
    const rng = new Rng(3);
    let prev = '';
    for (let day = 0; day < 30; day++) {
      d.weather(day, 0, true);
      const detail = JSON.stringify((d.close(day, rng)!.msg.params as Record<string, { key: string }>).detail!.key);
      expect(detail).not.toBe(prev);
      prev = detail;
    }
    expect(d.entries).toHaveLength(DIARY_DAYS);
    expect(d.entries[0]!.day).toBe(30 - DIARY_DAYS);
  });
});
