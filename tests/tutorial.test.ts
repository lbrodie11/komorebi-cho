import { describe, it, expect } from 'vitest';
import { BENCH_HINT_AFTER, Tutorial } from '../src/ui/tutorial';

describe('first-minutes hints', () => {
  it('shows the bench hint after a pause, then "meet someone" once a neighbor reacts', () => {
    const tut = new Tutorial();
    expect(tut.update(BENCH_HINT_AFTER - 1)).toBeNull();
    expect(tut.update(2)).toBe('bench');
    expect(tut.wantsReaction).toBe(true);
    tut.placed();
    expect(tut.current).toBeNull(); // waiting for the guaranteed reaction
    tut.noticed();
    expect(tut.wantsReaction).toBe(false);
    expect(tut.current).toBe('meet');
    tut.met();
    expect(tut.current).toBeNull();
  });

  it('never repeats a hint once done, across a save', () => {
    const tut = new Tutorial();
    tut.update(60);
    tut.noticed();
    tut.met();
    const again = new Tutorial(tut.flags);
    expect(again.update(600)).toBeNull();
    expect(again.wantsReaction).toBe(false);
  });

  it('skips the bench hint for a player who placed something before it appeared', () => {
    const tut = new Tutorial();
    tut.update(3);
    tut.placed();
    expect(tut.update(30)).toBeNull();
  });

  it('starts over from "show the hints again", the clock too', () => {
    const tut = new Tutorial(['place', 'react', 'meet', 'nonsense']);
    expect(tut.flags).toEqual(['meet', 'place', 'react']);
    tut.reset();
    expect(tut.update(1)).toBeNull();
    expect(tut.update(BENCH_HINT_AFTER)).toBe('bench');
  });
});
