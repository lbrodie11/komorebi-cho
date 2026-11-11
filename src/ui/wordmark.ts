/**
 * The title, drawn from a hand-authored 5x7 bitmap font with a dithered fill
 * (the same trick as Quack's wordmark). No font file, no image file.
 */
const GLYPHS: Record<string, string[]> = {
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
};

export function drawWordmark(text = 'KOMOREBI-CHO', cell = 3): HTMLCanvasElement {
  const chars = [...text];
  const widths = chars.map((c) => GLYPHS[c]?.[0]?.length ?? 3);
  const wCells = widths.reduce((a, b) => a + b + 1, 0) + 1;
  const hCells = 7 + 4; // room for the macron + shadow
  const c = document.createElement('canvas');
  c.width = wCells * cell;
  c.height = hCells * cell;
  const ctx = c.getContext('2d')!;
  let x0 = 1;
  const plot = (cx: number, cy: number) => {
    const px = cx * cell,
      py = cy * cell;
    // shadow
    ctx.fillStyle = '#16141f';
    ctx.fillRect(px + cell, py + cell, cell, cell);
    // dithered fill: cream with a checkerboard of slightly darker cream
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++) {
        ctx.fillStyle = (px + x + py + y) % 2 === 0 ? '#f6efe0' : '#cfd2d4';
        ctx.fillRect(px + x, py + y, 1, 1);
      }
  };
  chars.forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (g) g.forEach((row, y) => [...row].forEach((v, x) => v === '#' && plot(x0 + x, y + 2)));
    // macron on the final O: "chō"
    if (i === chars.length - 1 && ch === 'O') for (let x = 1; x < 4; x++) plot(x0 + x, 0);
    x0 += (widths[i] ?? 3) + 1;
  });
  return c;
}

/** Tiny pixel swatches for the build palette. */
export function swatch(kind: string): HTMLCanvasElement {
  const art: Record<string, [string, string[]]> = {
    bench: ['#8a5634', ['........', '........', '########', '#......#', '########', '.#....#.', '.#....#.', '........']],
    sakura: ['#f4c7cf', ['..####..', '.######.', '########', '.######.', '..####..', '...##...', '...##...', '..####..']],
    lantern: ['#adb2b8', ['.######.', '..####..', '.#oooo#.', '.#oooo#.', '..####..', '...##...', '...##...', '..####..']],
    vending: ['#e8ebee', ['.######.', '.#cccc#.', '.#cccc#.', '.#cccc#.', '.######.', '.#.##.#.', '.######.', '........']],
    planter: ['#8a5634', ['........', '.o.p.o.p', 'pgogpgog', '.g.g.g.g', '########', '########', '########', '........']],
    catbowl: ['#4f73a3', ['........', '........', '...o....', '........', '.######.', '..####..', '........', '........']],
  };
  const [base, rows] = art[kind] ?? ['#f6efe0', []];
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) =>
    [...row].forEach((v, x) => {
      if (v === '.') return;
      ctx.fillStyle = v === '#' ? base : v === 'o' ? '#ffa94d' : v === 'c' ? '#4fd6ff' : v === 'p' ? '#f4c7cf' : v === 'g' ? '#5b8c45' : base;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return c;
}
