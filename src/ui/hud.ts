import { drawWordmark, swatch } from './wordmark';
import { PLACEABLES, type PlaceableKind } from '../world/props';
import { SEASONS, type Season } from '../core/clock';
import type { WeatherMode } from '../world/weather';
import type { ToolMode } from './build';
import type { ResidentInfo } from '../sim/residents';
import { PIXEL_PRESETS, type PixelPreset } from '../render/pixelscale';

export interface HudActions {
  toggleSound(): Promise<boolean>;
  setSpeed(s: 0 | 1 | 6): void;
  jumpTo(hour: number): void;
  setWeather(m: WeatherMode): void;
  setSeason(s: Season): void;
  setTool(m: ToolMode, k?: PlaceableKind): void;
  photo(on: boolean): void;
  capture(): Promise<string | null>;
  setPixel(p: PixelPreset): void;
  setVolumes(music: number, ambience: number): void;
  setReducedMotion(v: boolean): void;
  /** Film Diffusion strength, 0..0.2. */
  setDiffusion(s: number): void;
  reset(): void;
}

/** Slider readout: "Off" at 0, otherwise the percent ("0.5%", "5%"). */
export const diffusionLabel = (pct: number): string => (pct <= 0 ? 'Off' : `${Number(pct.toFixed(1))}%`);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const btn = (label: string, onClick: () => void, title = ''): HTMLButtonElement => {
  const b = el('button', 'px', label);
  b.type = 'button';
  if (title) {
    b.title = title;
    b.setAttribute('aria-label', title);
  }
  b.addEventListener('click', onClick);
  return b;
};

/** All DOM UI. Deliberately quiet: the diorama is the interface. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly clock = el('span', 'clock', '08:30');
  private readonly date = el('span', 'date', 'Day 1 · Spring');
  private readonly storyBox = el('div', 'story');
  private readonly card = el('div', 'card panel');
  private readonly settings = el('div', 'settings panel');
  private readonly help = el('div', 'help panel');
  private readonly palette = el('div', 'palette panel');
  private readonly photoBar = el('div', 'photo-bar panel');
  private readonly modal = el('div', 'modal');
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly weatherBtns = new Map<WeatherMode, HTMLButtonElement>();
  private readonly pixelBtns = new Map<PixelPreset, HTMLButtonElement>();
  private readonly seasonBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly buildBtn: HTMLButtonElement;
  private readonly removeBtn: HTMLButtonElement;
  private readonly paletteBtns = new Map<PlaceableKind, HTMLButtonElement>();
  private cardFor: (() => ResidentInfo | null) | null = null;
  private season: Season = 'spring';
  private splash: HTMLElement | null = null;

  constructor(
    root: HTMLElement,
    private readonly act: HudActions,
  ) {
    this.root = root;
    const brand = el('div', 'brand');
    brand.append(drawWordmark(), el('div', 'tag', 'A tiny Tokyo backstreet. Build a little. Watch it notice.'));

    const top = el('div', 'top-right');
    this.soundBtn = btn(
      'Sound off',
      () =>
        void this.act.toggleSound().then((on) => {
          this.soundBtn.textContent = on ? 'Sound on' : 'Sound off';
          this.soundBtn.classList.toggle('on', on);
          this.dismissSplash();
        }),
      'Toggle music and ambience (M)',
    );
    top.append(
      this.soundBtn,
      btn('Photo', () => this.togglePhoto(true), 'Photo mode (P)'),
      btn('Settings', () => this.toggle(this.settings), 'Settings'),
      btn('?', () => this.toggle(this.help), 'Help (H)'),
    );

    const bar = el('div', 'toolbar panel');
    bar.setAttribute('role', 'toolbar');
    const pause = btn('II', () => this.act.setSpeed(0), 'Pause time (Space)');
    const play = btn('>', () => this.act.setSpeed(1), 'Normal speed');
    const fast = btn('>>', () => this.act.setSpeed(6), 'Fast forward');
    this.speedBtns.push(pause, play, fast);
    const jumps: [string, number][] = [
      ['Dawn', 5.8],
      ['Noon', 12],
      ['Dusk', 17.9],
      ['Night', 21.5],
    ];
    this.seasonBtn = btn(
      'Spring',
      () => {
        const i = (SEASONS.indexOf(this.season) + 1) % SEASONS.length;
        this.act.setSeason(SEASONS[i]!);
      },
      'Change season',
    );
    this.buildBtn = btn('Build', () => this.act.setTool(this.buildBtn.classList.contains('on') ? 'view' : 'build'), 'Build mode (B)');
    this.removeBtn = btn('Remove', () => this.act.setTool(this.removeBtn.classList.contains('on') ? 'view' : 'remove'), 'Remove things you placed (X)');
    bar.append(this.clock, this.date, pause, play, fast, el('span', 'sep'));
    for (const [label, h] of jumps) bar.append(btn(label, () => this.act.jumpTo(h), `Skip to ${label.toLowerCase()}`));
    bar.append(el('span', 'sep'));
    for (const [m, label] of [
      ['auto', 'Auto'],
      ['clear', 'Clear'],
      ['rain', 'Rain'],
    ] as const) {
      const b = btn(label, () => this.act.setWeather(m), `Weather: ${label}`);
      this.weatherBtns.set(m, b);
      bar.append(b);
    }
    bar.append(el('span', 'sep'), this.seasonBtn, el('span', 'sep'), this.buildBtn, this.removeBtn);

    for (const def of Object.values(PLACEABLES)) {
      const b = btn('', () => this.act.setTool('build', def.kind), `Place ${def.label}`);
      const sw = swatch(def.kind);
      sw.className = 'sw';
      b.append(sw, document.createTextNode(def.label));
      this.paletteBtns.set(def.kind, b);
      this.palette.append(b);
    }
    this.palette.append(el('span', 'hint', 'Click to place · R rotates · Esc to stop. Nearby residents may come and look.'));

    this.card.append(btn('x', () => this.closeCard(), 'Close'));
    this.buildSettings();
    this.help.innerHTML = `<h3>Komorebi-chō</h3>
      <p>A living miniature of a Tokyo backstreet. Place a bench, a lantern, a sakura. Then watch: the neighbours notice, and their days slowly change around what you made.</p>
      <p><kbd>Drag</kbd> pan · <kbd>Scroll</kbd> zoom · <kbd>Q</kbd>/<kbd>E</kbd> rotate · <kbd>Space</kbd> pause · <kbd>1-4</kbd> time of day<br>
      <kbd>B</kbd> build · <kbd>X</kbd> remove · <kbd>R</kbd> rotate item · <kbd>P</kbd> photo · <kbd>M</kbd> sound · click a resident to meet them</p>
      <p style="color:var(--muted);font-size:12px">Every pixel, building and note of music is generated by code.</p>`;
    this.help.append(btn('Close', () => this.toggle(this.help)));

    this.photoBar.append(
      btn(
        'Capture',
        () =>
          void this.act.capture().then((url) => {
            if (url) this.showCapture(url);
          }),
      ),
      btn('Exit photo mode', () => this.togglePhoto(false)),
    );
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.modal.classList.remove('open');
    });

    this.splash = el('div', 'splash');
    const sp = el('div', 'panel', 'Turn on sound for the full experience · press <b>?</b> for controls');
    this.splash.append(sp);

    root.append(brand, top, this.storyBox, this.card, this.settings, this.help, this.palette, bar, this.photoBar, this.modal, this.splash);
    window.setTimeout(() => this.dismissSplash(), 9000);
  }

  private dismissSplash(): void {
    this.splash?.remove();
    this.splash = null;
  }

  private diffusionInput: HTMLInputElement | null = null;
  private diffusionOut: HTMLOutputElement | null = null;

  /** Reflect a Film Diffusion value (0..0.2) in the slider, e.g. after loading a save. */
  setDiffusion(s: number): void {
    const pct = Math.round(s * 200) / 2; // the slider's 0.5% steps
    if (this.diffusionInput) this.diffusionInput.value = String(pct);
    this.showDiffusion(pct);
  }

  private showDiffusion(pct: number): void {
    const text = diffusionLabel(pct);
    if (this.diffusionOut) this.diffusionOut.textContent = text;
    this.diffusionInput?.setAttribute('aria-valuetext', text);
  }

  private buildSettings(): void {
    const s = this.settings;
    s.append(el('h4', '', 'Settings'));
    const px = el('div', 'row');
    const labels: Record<PixelPreset, string> = { fine: 'Fine', classic: 'Classic', chunky: 'Chunky', smooth: 'Smooth' };
    const titles: Record<PixelPreset, string> = {
      fine: 'Fine pixels',
      classic: 'Classic pixels',
      chunky: 'Chunky pixels',
      smooth: 'Smooth: finer pixels and full-colour shading',
    };
    for (const p of PIXEL_PRESETS) {
      const b = btn(labels[p], () => this.act.setPixel(p), titles[p]);
      this.pixelBtns.set(p, b);
      px.append(b);
    }
    s.append(px);
    const slider = (label: string, v: number) => {
      const l = el('label', '', label);
      const r = el('input');
      r.type = 'range';
      r.min = '0';
      r.max = '1';
      r.step = '0.05';
      r.value = String(v);
      l.append(r);
      s.append(l);
      return r;
    };
    const mv = slider('Music', 0.55);
    const av = slider('Ambience', 0.6);
    const upd = () => this.act.setVolumes(Number(mv.value), Number(av.value));
    mv.addEventListener('input', upd);
    av.addEventListener('input', upd);
    // Film Diffusion: 0–20%, live on input. Range inputs already take arrow keys (main.ts ignores keys aimed at inputs).
    const fd = el('label', 'diffusion');
    const name = el('span', '', 'Film Diffusion ');
    fd.title = 'A soft lens glow around lights. Off shows the pure pixel palette.';
    const fr = el('input');
    fr.type = 'range';
    fr.min = '0';
    fr.max = '20';
    fr.step = '0.5';
    const out = el('output');
    out.setAttribute('aria-hidden', 'true'); // the slider's aria-valuetext says the same thing
    fr.addEventListener('input', () => {
      this.showDiffusion(Number(fr.value));
      this.act.setDiffusion(Number(fr.value) / 100);
    });
    name.append(out);
    fd.append(name, fr);
    s.append(fd);
    this.diffusionInput = fr;
    this.diffusionOut = out;
    const rm = el('label', '', 'Reduced motion');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', () => this.act.setReducedMotion(cb.checked));
    rm.append(cb);
    s.append(rm);
    s.append(
      btn('Reset neighbourhood', () => this.act.reset()),
      btn('Close', () => this.toggle(this.settings)),
    );
  }

  private toggle(p: HTMLElement): void {
    const open = !p.classList.contains('open');
    for (const q of [this.settings, this.help, this.card]) q.classList.remove('open');
    p.classList.toggle('open', open);
  }

  togglePhoto(on: boolean): void {
    this.root.classList.toggle('hidden', on);
    this.photoBar.classList.toggle('open', on);
    this.act.photo(on);
  }

  private showCapture(url: string): void {
    this.modal.innerHTML = '';
    const inner = el('div', 'inner panel');
    const img = el('img');
    img.src = url;
    img.alt = 'Photo of your neighbourhood';
    const a = el('a', 'px', 'Download');
    a.setAttribute('href', url);
    a.setAttribute('download', `komorebi-cho-${Date.now()}.png`);
    a.style.color = 'var(--cream)';
    inner.append(
      img,
      el('span', 'hint', 'If the download is blocked, right-click the image to save it.'),
      a,
      btn('Close', () => this.modal.classList.remove('open')),
    );
    this.modal.append(inner);
    this.modal.classList.add('open');
  }

  setClock(label: string, day: number, season: Season): void {
    this.clock.textContent = label;
    const s = season[0]!.toUpperCase() + season.slice(1);
    this.date.textContent = `Day ${day + 1} · ${s}`;
    if (season !== this.season) {
      this.season = season;
      this.seasonBtn.textContent = s;
    }
  }
  setSpeed(speed: number, paused: boolean): void {
    const idx = paused ? 0 : speed > 1 ? 2 : 1;
    this.speedBtns.forEach((b, i) => b.classList.toggle('on', i === idx));
  }
  setPixel(p: PixelPreset): void {
    for (const [k, b] of this.pixelBtns) {
      b.classList.toggle('on', k === p);
      b.setAttribute('aria-pressed', String(k === p)); // the chosen look, for screen readers too
    }
  }

  setWeather(m: WeatherMode): void {
    for (const [k, b] of this.weatherBtns) b.classList.toggle('on', k === m);
  }
  setTool(m: ToolMode, k: PlaceableKind): void {
    this.buildBtn.classList.toggle('on', m === 'build');
    this.removeBtn.classList.toggle('on', m === 'remove');
    this.palette.classList.toggle('open', m === 'build');
    for (const [kind, b] of this.paletteBtns) b.classList.toggle('on', m === 'build' && kind === k);
  }

  story(text: string): void {
    const line = el('div', 'line panel', '');
    line.textContent = text;
    this.storyBox.append(line);
    const lines = [...this.storyBox.children];
    lines.forEach((l, i) => l.classList.toggle('old', i < lines.length - 2));
    while (this.storyBox.children.length > 4) this.storyBox.firstElementChild?.remove();
    window.setTimeout(() => line.remove(), 16000);
  }

  openCard(get: () => ResidentInfo | null): void {
    this.cardFor = get;
    for (const q of [this.settings, this.help]) q.classList.remove('open');
    this.card.classList.add('open');
    this.refreshCard();
  }
  closeCard(): void {
    this.cardFor = null;
    this.card.classList.remove('open');
  }
  refreshCard(): void {
    if (!this.cardFor) return;
    const i = this.cardFor();
    if (!i) return this.closeCard();
    const close = this.card.querySelector('button');
    this.card.innerHTML = '';
    const h = el('h3');
    h.textContent = i.name;
    const role = el('div', 'role');
    role.textContent = i.role;
    const p = el('p');
    p.textContent = i.blurb;
    const doing = el('div', 'doing');
    doing.textContent = `Now: ${i.doing}`;
    const knows = el('div', 'role');
    knows.style.marginTop = '6px';
    knows.textContent = i.knows ? `Has noticed ${i.knows} thing${i.knows > 1 ? 's' : ''} you made.` : 'Hasn’t noticed anything you made yet.';
    this.card.append(h, role, p, doing, knows);
    if (close) this.card.append(close);
  }
}
