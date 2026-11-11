import { describe, it, expect } from 'vitest';
import { parseLaunchParams, warmupStart } from '../src/core/params';

describe('parseLaunchParams', () => {
  it('defaults to an unscripted, authored run', () => {
    const p = parseLaunchParams('');
    expect(p).toMatchObject({ seed: 0, hour: null, season: null, weather: null, freeze: false, debug: false, lutOff: false, scripted: false });
  });

  it('reads the full screenshot query', () => {
    const p = parseLaunchParams('?seed=7&hour=18&season=autumn&weather=rain&freeze=1');
    expect(p).toMatchObject({ seed: 7, hour: 18, season: 'autumn', weather: 'rain', freeze: true, scripted: true });
  });

  it('flags debug and lutOff without values', () => {
    const p = parseLaunchParams('?debug&lutOff');
    expect(p.debug).toBe(true);
    expect(p.lutOff).toBe(true);
    expect(p.scripted).toBe(false);
  });

  it('wraps hours and rejects junk', () => {
    expect(parseLaunchParams('?hour=25.5').hour).toBeCloseTo(1.5);
    expect(parseLaunchParams('?hour=-2').hour).toBe(22);
    expect(parseLaunchParams('?hour=noon').hour).toBeNull();
    expect(parseLaunchParams('?hour=').hour).toBeNull();
    expect(parseLaunchParams('?season=monsoon').season).toBeNull();
    expect(parseLaunchParams('?weather=snow').weather).toBeNull();
    expect(parseLaunchParams('?seed=abc').seed).toBe(0);
  });

  it('treats freeze=0 / false as off, and any seed as scripted', () => {
    expect(parseLaunchParams('?freeze=0').freeze).toBe(false);
    expect(parseLaunchParams('?freeze=false').freeze).toBe(false);
    expect(parseLaunchParams('?freeze').freeze).toBe(true);
    expect(parseLaunchParams('?seed=0').scripted).toBe(true);
  });

  it('keeps seeds in uint32 range', () => {
    expect(parseLaunchParams('?seed=-1').seed).toBe(4294967295);
    expect(parseLaunchParams('?seed=3.9').seed).toBe(3);
  });
});

describe('warmupStart', () => {
  it('backs off across midnight', () => {
    expect(warmupStart(6, 3)).toBe(3);
    expect(warmupStart(1, 3)).toBe(22);
    expect(warmupStart(22, 3)).toBe(19);
  });
});
