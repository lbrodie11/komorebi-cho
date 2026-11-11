import { describe, it, expect } from 'vitest';
import { en } from '../src/i18n/en';
import { format, fmt, isKey, msg, placeholders, t } from '../src/i18n';
import { PERSONAS } from '../src/sim/personas';
import { PLACEABLES } from '../src/world/props';
import { SEASONS } from '../src/core/clock';
import { PIXEL_PRESETS } from '../src/render/pixelscale';
import { SmartRegistry, registerStaticObjects } from '../src/sim/smart';

describe('copy', () => {
  it('formats placeholders, nested messages and plurals', () => {
    expect(format('{a} and {b}', { a: 'x', b: 2 })).toBe('x and 2');
    expect(t('story.useBench', { who: msg('persona.mitsuko.short') })).toBe('Mitsuko tries out the new bench.');
    expect(t('card.knows', { n: 0 })).toMatch(/Hasn’t noticed/);
    expect(t('card.knows', { n: 1 })).toBe('Has noticed 1 thing you made.');
    expect(t('card.knows', { n: 3 })).toBe('Has noticed 3 things you made.');
    expect(fmt(msg('task.browsing', { thing: msg('noun.books') }))).toBe('Browsing at Shiori Books');
  });

  it('has every key the game builds at run time', () => {
    const keys: string[] = [];
    for (const p of PERSONAS) {
      for (const f of ['name', 'short', 'role', 'blurb']) keys.push(`persona.${p.id}.${f}`);
      if (p.work) keys.push(`work.${p.id}`);
    }
    for (const k of Object.keys(PLACEABLES)) keys.push(`placeable.${k}`, `noun.${k}`);
    const smart = new SmartRegistry();
    registerStaticObjects(smart);
    for (const o of smart.objects.values()) keys.push(`noun.${o.label}`);
    for (const s of SEASONS) keys.push(`season.${s}`, `story.${s}`);
    for (const p of PIXEL_PRESETS) keys.push(`look.${p}`, `look.${p}Title`);
    for (const w of ['dawn', 'morning', 'day', 'afternoon', 'evening', 'night']) keys.push(`story.start.${w}`);
    for (const c of ['bell', 'rain', 'rainStops', 'snowWind', 'cicadas', 'uguisu', 'higurashi', 'crickets', 'crow', 'bikeBell']) keys.push(`caption.${c}`);
    for (const s of ['1', '1.25', '1.5']) keys.push(`settings.text.${s}`);
    expect(keys.filter((k) => !isKey(k))).toEqual([]);
  });

  it('is American English with no Japanese script', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(v, k).not.toMatch(/[぀-ヿ一-鿿]/);
      expect(v, k).not.toMatch(/neighbour|colour|favourite|centre|metre/i);
    }
  });

  it('balances its braces, so no placeholder leaks as raw text', () => {
    for (const [k, v] of Object.entries(en)) {
      let depth = 0;
      for (const ch of v) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        expect(depth, k).toBeGreaterThanOrEqual(0);
      }
      expect(depth, k).toBe(0);
    }
    expect(placeholders(en['story.useOther'])).toEqual(['thing', 'who']);
  });
});
