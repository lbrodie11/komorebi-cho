import * as THREE from 'three';

/**
 * 9x9 pixel-art thought bubbles, authored as strings. '#' = ink, 'o' = accent,
 * '.' = bubble fill, ' ' = transparent. They go through the same palette pass
 * as the world, so they always match.
 */
const ICONS = {
  notice: [' ....... ', '...###...', '...###...', '...###...', '....#....', '.........', '....#....', ' ....... ', '    .    '],
  heart: [' ....... ', '.oo...oo.', 'ooooooooo', 'ooooooooo', '.ooooooo.', '..ooooo..', '...ooo...', ' ...o... ', '    .    '],
  note: [' ....... ', '....####.', '....#..#.', '....#..#.', '....#..#.', '..###.##.', '..###.##.', ' ....... ', '    .    '],
  sleep: [' ....... ', '.#####...', '....#....', '...#.....', '..#####..', '.....###.', '......#..', ' ....### ', '    .    '],
  question: [' ....... ', '...###...', '..#...#..', '......#..', '....##...', '....#....', '.........', ' ...#... ', '    .    '],
  sparkle: [' ....... ', '....o....', '....o....', '.ooooooo.', '....o....', '..o.o.o..', '.o.....o.', ' ....... ', '    .    '],
  cup: [' ....... ', '...o.o...', '....o....', '.#####...', '.#####.#.', '.#####.#.', '..###....', ' ....... ', '    .    '],
} as const;

export type BubbleIcon = keyof typeof ICONS;

const cache = new Map<BubbleIcon, THREE.SpriteMaterial>();

export function bubbleMaterial(icon: BubbleIcon): THREE.SpriteMaterial {
  let m = cache.get(icon);
  if (m) return m;
  const rows = ICONS[icon];
  const c = document.createElement('canvas');
  c.width = c.height = 9;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === ' ') return;
      ctx.fillStyle = ch === '#' ? '#2e2a42' : ch === 'o' ? (icon === 'heart' ? '#d0402a' : '#ffa94d') : '#f6efe0';
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.5, depthWrite: false });
  cache.set(icon, m);
  return m;
}
