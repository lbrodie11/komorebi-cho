import type { SmartKind } from './smart';

export interface WorkSpec {
  /** Where they stand while working (outside their shop, temple grounds...). */
  spot: [number, number];
  face: number;
  door: string;
  hours: [number, number];
  action: 'sweep' | 'stand' | 'crouch';
  label: string;
}

export interface Persona {
  id: string;
  name: string;
  role: string;
  blurb: string;
  kid?: boolean;
  colors: { top: string; legs: string; skin: string; hair: string; accent?: string };
  accessory?: 'apron' | 'bag' | 'hat' | 'box' | 'cane' | 'broom';
  /** Door id from layout.DOORS, or 'exit' if they live beyond the plinth. */
  home: string;
  sleep: [number, number];
  work?: WorkSpec;
  commute?: [number, number];
  /** 0..1 how likely they notice and go look at new things. */
  curiosity: number;
  likes: Partial<Record<SmartKind | 'wander' | 'jog' | 'deliver', number>>;
  speed: number;
}

/**
 * The neighbourhood. Few enough that each can be a person; varied enough that
 * routines interlock (the baker sweeps at dawn, the student buys a drink after
 * school, the cat lady sits where the pigeons are).
 */
export const PERSONAS: Persona[] = [
  {
    id: 'haru',
    name: 'Haru Mori',
    role: 'Kissaten master',
    blurb: 'Has made the same blend since 1987. Wipes the terrace tables twice an hour whether they need it or not.',
    colors: { top: '#45291b', legs: '#2e2a42', skin: '#e8c3a0', hair: '#cfd2d4', accent: '#f6efe0' },
    accessory: 'apron',
    home: 'aptC',
    sleep: [22.2, 6],
    curiosity: 0.45,
    speed: 0.85,
    work: { spot: [13.9, 2.1], face: Math.PI, door: 'kissaten', hours: [7, 21], action: 'stand', label: 'Wiping the terrace tables' },
    likes: { temple: 0.3, bench: 0.2 },
  },
  {
    id: 'aiko',
    name: 'Aiko Sato',
    role: 'Baker',
    blurb: 'Up before the crows. The melon pan sells out by ten; she pretends to be surprised every day.',
    colors: { top: '#f6efe0', legs: '#4f73a3', skin: '#e8c3a0', hair: '#2a1912', accent: '#d4a774' },
    accessory: 'apron',
    home: 'kyosho',
    sleep: [21.5, 5],
    curiosity: 0.6,
    speed: 1,
    work: { spot: [-9.4, 1.5], face: -Math.PI / 2, door: 'bakery', hours: [6, 19], action: 'sweep', label: 'Sweeping in front of the bakery' },
    likes: { cafe: 0.4, admire: 0.5 },
  },
  {
    id: 'taro',
    name: 'Taro Ishida',
    role: 'Ramen cook',
    blurb: 'Fourteen hours on the broth. Steps out for air at quiet moments and nods at everyone.',
    colors: { top: '#f6efe0', legs: '#16141f', skin: '#c99e7a', hair: '#16141f', accent: '#9a2b22' },
    accessory: 'hat',
    home: 'aptA',
    sleep: [23.6, 8.5],
    curiosity: 0.35,
    speed: 0.95,
    work: { spot: [-9.3, -2.3], face: -Math.PI / 2, door: 'ramen', hours: [10.5, 23], action: 'stand', label: 'Taking a breather outside the shop' },
    likes: { vending: 0.4, bench: 0.2 },
  },
  {
    id: 'yuki',
    name: 'Yuki Tanaka',
    role: 'Florist',
    blurb: 'Rearranges the buckets by colour, then by mood, then back again.',
    colors: { top: '#3c6838', legs: '#e8dcc2', skin: '#e8c3a0', hair: '#653d27', accent: '#f4c7cf' },
    accessory: 'apron',
    home: 'exit',
    sleep: [21, 6.5],
    curiosity: 0.8,
    speed: 1,
    work: { spot: [-9.4, 4.6], face: -Math.PI / 2, door: 'florist', hours: [8.5, 18], action: 'crouch', label: 'Arranging the flower buckets' },
    likes: { admire: 0.9, view: 0.4, cafe: 0.3 },
  },
  {
    id: 'nana',
    name: 'Nana Kobayashi',
    role: 'Bookseller',
    blurb: 'Reads the books before she sells them. Some she never sells.',
    colors: { top: '#6a5a9a', legs: '#2e2a42', skin: '#e8c3a0', hair: '#16141f' },
    accessory: 'bag',
    home: 'aptB',
    sleep: [23, 7.5],
    curiosity: 0.55,
    speed: 0.9,
    work: { spot: [-9.4, 7.5], face: -Math.PI / 2, door: 'books', hours: [10, 20], action: 'stand', label: 'Straightening the 100-yen cart' },
    likes: { cafe: 0.6, bench: 0.4, view: 0.3 },
  },
  {
    id: 'mitsuko',
    name: 'Mitsuko Ueda',
    role: 'Retired, feeds the cats',
    blurb: 'Knows every cat by name and every neighbour by their cat. Owns the pond bench.',
    colors: { top: '#c46a7a', legs: '#45291b', skin: '#e8c3a0', hair: '#eef2f5' },
    accessory: 'cane',
    home: 'kyosho',
    sleep: [20.5, 5.2],
    curiosity: 0.7,
    speed: 0.6,
    likes: { bench: 1, catbowl: 1.2, shrine: 0.6, temple: 0.5, view: 0.5, admire: 0.6 },
  },
  {
    id: 'genzo',
    name: 'Genzo Ono',
    role: 'Temple caretaker',
    blurb: 'Sweeps the same leaves every morning. Rings the bell at six, both ends of the day.',
    colors: { top: '#2e2a42', legs: '#2e2a42', skin: '#c99e7a', hair: '#adb2b8' },
    accessory: 'broom',
    home: 'temple',
    sleep: [21, 4.8],
    curiosity: 0.3,
    speed: 0.7,
    work: { spot: [7.6, -7.4], face: 0, door: 'temple', hours: [5.5, 16.5], action: 'sweep', label: 'Sweeping the temple grounds' },
    likes: { shrine: 0.8, garden: 0.4, bench: 0.3 },
  },
  {
    id: 'kenta',
    name: 'Kenta Hayashi',
    role: 'High-school student',
    blurb: 'Buys the same canned coffee every afternoon. Has never once drunk it hot.',
    colors: { top: '#1f2c45', legs: '#1f2c45', skin: '#e8c3a0', hair: '#16141f', accent: '#ffd37a' },
    accessory: 'bag',
    home: 'aptB',
    sleep: [23.8, 6.6],
    commute: [7.3, 15.8],
    curiosity: 0.85,
    speed: 1.15,
    likes: { vending: 0.9, shop: 0.4, view: 0.5, wander: 0.4 },
  },
  {
    id: 'emi',
    name: 'Emi Watanabe',
    role: 'Office worker',
    blurb: 'Leaves at 7:50 sharp. Comes home via the ramen shop more often than she admits.',
    colors: { top: '#8a8f99', legs: '#2e2a42', skin: '#e8c3a0', hair: '#45291b' },
    accessory: 'bag',
    home: 'aptC',
    sleep: [23.4, 6.4],
    commute: [7.8, 18.5],
    curiosity: 0.5,
    speed: 1.1,
    likes: { shop: 0.6, cafe: 0.5, admire: 0.4 },
  },
  {
    id: 'sora',
    name: 'Sora',
    role: 'Eight years old',
    blurb: 'Has a theory about the koi. Will tell you.',
    kid: true,
    colors: { top: '#ffd37a', legs: '#2f4a72', skin: '#e8c3a0', hair: '#16141f' },
    accessory: 'hat',
    home: 'aptA',
    sleep: [20, 6.5],
    commute: [7.6, 14.6],
    curiosity: 1,
    speed: 1.4,
    likes: { swing: 1, sand: 0.8, view: 0.9, wander: 0.5 },
  },
  {
    id: 'rin',
    name: 'Rin',
    role: 'Six years old',
    blurb: 'Chases pigeons. Has never caught one. Never will.',
    kid: true,
    colors: { top: '#e59b9b', legs: '#f6efe0', skin: '#e8c3a0', hair: '#2a1912' },
    home: 'kyosho',
    sleep: [19.6, 6.8],
    commute: [8, 14.2],
    curiosity: 1,
    speed: 1.4,
    likes: { swing: 0.8, sand: 1, wander: 0.6, view: 0.4 },
  },
  {
    id: 'daichi',
    name: 'Daichi Fujii',
    role: 'Allotment gardener',
    blurb: 'Grows tomatoes mostly to argue about tomatoes.',
    colors: { top: '#5b8c45', legs: '#653d27', skin: '#c99e7a', hair: '#cfd2d4' },
    accessory: 'hat',
    home: 'exit',
    sleep: [20, 5.6],
    curiosity: 0.4,
    speed: 0.75,
    work: { spot: [11.6, 6.1], face: Math.PI, door: 'shed', hours: [6, 10.5], action: 'crouch', label: 'Weeding the tomato rows' },
    likes: { garden: 1.2, bench: 0.5, temple: 0.2 },
  },
  {
    id: 'hiro',
    name: 'Hiro Nakamura',
    role: 'Delivery rider',
    blurb: 'Always running ten minutes late, always somehow on time.',
    colors: { top: '#2f7f7a', legs: '#2e2a42', skin: '#c99e7a', hair: '#16141f', accent: '#d4a774' },
    accessory: 'box',
    home: 'exit',
    sleep: [21, 7],
    curiosity: 0.3,
    speed: 1.5,
    likes: { deliver: 1.2, vending: 0.5 },
  },
  {
    id: 'kaito',
    name: 'Kaito Shimizu',
    role: 'Evening jogger',
    blurb: 'Three laps of the park, every day, unless it rains, unless he forgets.',
    colors: { top: '#d0402a', legs: '#16141f', skin: '#e8c3a0', hair: '#16141f' },
    home: 'exit',
    sleep: [22, 6],
    commute: [7, 17.4],
    curiosity: 0.25,
    speed: 2.3,
    likes: { jog: 1.4, vending: 0.4 },
  },
];
