/**
 * The palette IS the art direction. Every final pixel snaps to one of these.
 * Ramps are hue-shifted (shadows lean violet, lights lean amber) the way pixel
 * artists build ramps by hand. Add colours deliberately: each one changes the
 * whole picture. Keep it under ~64 so the post shader loop stays cheap.
 */
export const PALETTE: readonly string[] = [
  // night / void / shadow violets. The floor is #16141f, a deep violet: the picture never
  // reaches true black (the old #0b0a12 swatch was cut in the art-direction pass, prompt 03).
  '#16141f',
  '#211e30',
  '#2e2a42',
  '#3f3a58',
  '#5a5378',
  '#6a5a9a',
  '#8e86c0',
  // woods and earth
  '#2a1912',
  '#45291b',
  '#653d27',
  '#8a5634',
  '#b07a4c',
  '#d4a774',
  '#e8dcc2',
  '#f6efe0',
  // concrete and stone (cool greys)
  '#4b4f5a',
  '#686d78',
  '#8a8f99',
  '#adb2b8',
  '#cfd2d4',
  '#eef2f5',
  // sky and water blues
  '#1f2c45',
  '#2f4a72',
  '#4f73a3',
  '#86aed4',
  '#c4dcee',
  // greens
  '#18301f',
  '#27472b',
  '#3c6838',
  '#5b8c45',
  '#86b45a',
  '#b9d982',
  // reds, ambers, lantern light
  '#5e1f1c',
  '#9a2b22',
  '#d0402a',
  '#ff6b3d',
  '#ffa94d',
  '#ffd37a',
  '#fff1c4',
  // accents
  '#4fd6ff',
  '#2f7f7a',
  '#e59b9b',
  '#f4c7cf',
  '#c46a7a',
  '#8a8a40',
  '#c9a36b',
  '#7d6b5a',
];
