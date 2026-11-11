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
  /** Turn the item being placed a quarter turn (the R key, as a button for touch). */
  rotateItem(): void;
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
/** Touch-first device: no hover, so build previews on the first tap and commits on the second. */
export const coarsePointer = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const FOCUSABLE = 'button, [href], input, [tabindex]:not([tabindex="-1"])';

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

/** A toggle button's look and its screen-reader state, always together. */
const pressed = (b: HTMLButtonElement, on: boolean): void => {
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
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
  private readonly bar = el('div', 'toolbar panel');
  private readonly photoBar = el('div', 'photo-bar panel');
  private readonly modal = el('div', 'modal');
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly weatherBtns = new Map<WeatherMode, HTMLButtonElement>();
  private readonly pixelBtns = new Map<PixelPreset, HTMLButtonElement>();
  private readonly seasonBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly buildBtn: HTMLButtonElement;
  private readonly removeBtn: HTMLButtonElement;
  private readonly settingsBtn: HTMLButtonElement;
  private readonly helpBtn: HTMLButtonElement;
  private readonly photoBtn: HTMLButtonElement;
  private readonly captureBtn: HTMLButtonElement;
  private readonly moreBtn: HTMLButtonElement;
  private readonly paletteBtns = new Map<PlaceableKind, HTMLButtonElement>();
  private cardFor: (() => ResidentInfo | null) | null = null;
  private season: Season = 'spring';
  private splash: HTMLElement | null = null;
  private soundPending = false;
  private musicInput: HTMLInputElement | null = null;
  private ambienceInput: HTMLInputElement | null = null;
  private motionInput: HTMLInputElement | null = null;
  /** Where focus was before a panel or the photo preview took it, to give it back on close. */
  private returnFocus = new Map<HTMLElement, HTMLElement | null>();
  /** Photo mode is on (the HUD is hidden behind the photo bar). */
  photoOn = false;

  constructor(
    root: HTMLElement,
    private readonly act: HudActions,
  ) {
    this.root = root;
    const brand = el('div', 'brand');
    brand.append(drawWordmark(), el('div', 'tag', 'A tiny Tokyo backstreet. Build a little. Watch it notice.'));

    const top = el('div', 'top-right');
    this.soundBtn = btn('Sound off', () => void this.toggleSound(), 'Toggle music and ambience (M)');
    this.soundBtn.setAttribute('aria-pressed', 'false');
    this.photoBtn = btn('Photo', () => this.togglePhoto(true), 'Photo mode (P)');
    this.settingsBtn = btn('Settings', () => this.toggle(this.settings), 'Settings');
    this.helpBtn = btn('?', () => this.toggleHelp(), 'Help (H)');
    for (const [b, panel, id] of [
      [this.settingsBtn, this.settings, 'kc-settings'],
      [this.helpBtn, this.help, 'kc-help'],
    ] as const) {
      panel.id = id;
      panel.tabIndex = -1;
      b.setAttribute('aria-controls', id);
      b.setAttribute('aria-expanded', 'false');
    }
    this.settings.setAttribute('role', 'dialog');
    this.settings.setAttribute('aria-label', 'Settings');
    this.help.setAttribute('role', 'dialog');
    this.help.setAttribute('aria-label', 'Help');
    top.append(this.soundBtn, this.photoBtn, this.settingsBtn, this.helpBtn);

    const bar = this.bar;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Time, weather and building');
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
        this.setSeason(SEASONS[i]!); // now, not at the next once-a-second refresh: a quick second click must advance again
      },
      'Change season',
    );
    this.buildBtn = btn('Build', () => this.act.setTool(this.buildBtn.classList.contains('on') ? 'view' : 'build'), 'Build mode (B)');
    this.removeBtn = btn('Remove', () => this.act.setTool(this.removeBtn.classList.contains('on') ? 'view' : 'remove'), 'Remove things you placed (X)');
    for (const b of [pause, play, fast, this.buildBtn, this.removeBtn]) b.setAttribute('aria-pressed', 'false');
    // Time-of-day, weather and season are the "advanced" controls: always shown on wide screens,
    // folded behind "More" on phones so the toolbar stays one or two rows and the diorama stays visible.
    const more = el('span', 'more');
    more.id = 'kc-more';
    more.append(el('span', 'sep'));
    for (const [label, h] of jumps) more.append(btn(label, () => this.act.jumpTo(h), `Skip to ${label.toLowerCase()}`));
    more.append(el('span', 'sep'));
    for (const [m, label] of [
      ['auto', 'Auto'],
      ['clear', 'Clear'],
      ['rain', 'Rain'],
    ] as const) {
      const b = btn(label, () => this.act.setWeather(m), `Weather: ${label}`);
      b.setAttribute('aria-pressed', 'false');
      this.weatherBtns.set(m, b);
      more.append(b);
    }
    more.append(el('span', 'sep'), this.seasonBtn);
    this.moreBtn = btn('More', () => this.setMore(!bar.classList.contains('expanded')), 'Time of day, weather and season');
    this.moreBtn.classList.add('more-toggle');
    this.moreBtn.setAttribute('aria-controls', 'kc-more');
    this.moreBtn.setAttribute('aria-expanded', 'false');
    bar.append(this.clock, this.date, pause, play, fast, more, el('span', 'sep'), this.buildBtn, this.removeBtn, this.moreBtn);

    for (const def of Object.values(PLACEABLES)) {
      const b = btn('', () => this.act.setTool('build', def.kind), `Place ${def.label}`);
      b.setAttribute('aria-pressed', 'false');
      const sw = swatch(def.kind);
      sw.className = 'sw';
      b.append(sw, document.createTextNode(def.label));
      this.paletteBtns.set(def.kind, b);
      this.palette.append(b);
    }
    const rotate = btn('Rotate', () => this.act.rotateItem(), 'Rotate item (R)');
    rotate.classList.add('rotate');
    this.palette.append(
      rotate,
      el(
        'span',
        'hint',
        coarsePointer()
          ? 'Tap to preview, tap again to place. Nearby residents may come and look.'
          : 'Click to place · R rotates · Esc to stop. Nearby residents may come and look.',
      ),
    );
    this.palette.setAttribute('role', 'toolbar');
    this.palette.setAttribute('aria-label', 'Things to place');

    this.card.setAttribute('role', 'region');
    this.card.setAttribute('aria-label', 'Resident');
    this.card.setAttribute('aria-live', 'polite');
    this.card.append(btn('x', () => this.closeCard(), 'Close'));
    this.buildSettings();
    this.help.innerHTML = `<h3>Komorebi-chō</h3>
      <p>A living miniature of a Tokyo backstreet. Place a bench, a lantern, a sakura. Then watch: the neighbours notice, and their days slowly change around what you made.</p>
      <p><kbd>Drag</kbd>/<kbd>WASD</kbd> pan · <kbd>Scroll</kbd>/<kbd>+</kbd><kbd>-</kbd> zoom · <kbd>Q</kbd>/<kbd>E</kbd> rotate · <kbd>Space</kbd> pause · <kbd>1-4</kbd> time of day<br>
      <kbd>B</kbd> build · <kbd>X</kbd> remove · <kbd>R</kbd> rotate item · <kbd>P</kbd> photo · <kbd>M</kbd> sound · <kbd>H</kbd> help · <kbd>Esc</kbd> close · click a resident to meet them</p>
      <p>Touch: drag to pan · pinch to zoom · twist two fingers to turn the street · tap twice to place or remove.</p>
      <p style="color:var(--muted);font-size:12px">Every pixel, building and note of music is generated by code.</p>`;
    this.help.append(btn('Close', () => this.toggleHelp()));

    this.captureBtn = btn(
      'Capture',
      () =>
        void this.act.capture().then((url) => {
          if (url) this.showCapture(url);
        }),
    );
    this.photoBar.append(
      this.captureBtn,
      btn('Exit photo mode', () => this.togglePhoto(false)),
    );
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-label', 'Photo preview');
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });
    // keep Tab inside the preview while it is open
    this.modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...this.modal.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!f.length) return;
      const first = f[0]!,
        last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    this.storyBox.setAttribute('role', 'log');
    this.storyBox.setAttribute('aria-live', 'polite');
    this.storyBox.setAttribute('aria-label', 'What the neighbourhood is up to');
    const dock = el('div', 'dock');
    dock.append(this.palette, bar);

    this.splash = el('div', 'splash');
    const sp = el('div', 'panel', `Turn on sound for the full experience · ${coarsePointer() ? 'tap' : 'press'} <b>?</b> for controls`);
    this.splash.append(sp);

    root.append(brand, top, this.storyBox, this.card, this.settings, this.help, dock, this.photoBar, this.modal, this.splash);
    window.setTimeout(() => this.dismissSplash(), 9000);
  }

  private dismissSplash(): void {
    this.splash?.remove();
    this.splash = null;
  }

  /** The one way sound is toggled (button and M key), so the button always tells the truth. */
  async toggleSound(): Promise<void> {
    if (this.soundPending) return; // a second press while the audio graph is still starting would race it
    this.soundPending = true;
    try {
      this.setSound(await this.act.toggleSound());
    } catch {
      this.setSound(false); // no Web Audio, or the browser refused: say so rather than claim it's on
    } finally {
      this.soundPending = false;
      this.dismissSplash();
    }
  }

  setSound(on: boolean): void {
    this.soundBtn.textContent = on ? 'Sound on' : 'Sound off';
    this.soundBtn.classList.toggle('on', on);
    this.soundBtn.setAttribute('aria-pressed', String(on));
  }

  /** Reflect saved volumes in the sliders (they otherwise show the defaults after a reload). */
  setVolumes(music: number, ambience: number): void {
    if (this.musicInput) this.musicInput.value = String(music);
    if (this.ambienceInput) this.ambienceInput.value = String(ambience);
  }

  setReducedMotion(v: boolean): void {
    if (this.motionInput) this.motionInput.checked = v;
    this.root.classList.toggle('reduced-motion', v);
  }

  setSeason(season: Season): void {
    this.season = season;
    const s = season[0]!.toUpperCase() + season.slice(1);
    this.seasonBtn.textContent = s;
    // the same weather mode falls as snow in winter; say what the button will actually do
    const wet = this.weatherBtns.get('rain');
    if (wet) {
      const label = season === 'winter' ? 'Snow' : 'Rain';
      wet.textContent = label;
      wet.title = `Weather: ${label}`;
      wet.setAttribute('aria-label', wet.title);
    }
  }

  private setMore(open: boolean): void {
    this.bar.classList.toggle('expanded', open);
    this.moreBtn.setAttribute('aria-expanded', String(open));
    this.moreBtn.classList.toggle('on', open);
  }

  toggleHelp(): void {
    this.toggle(this.help);
  }

  /** Is the photo preview up? Game keys wait while it is (only Esc and Tab act). */
  get modalOpen(): boolean {
    return this.modal.classList.contains('open');
  }

  /**
   * Esc closes the topmost thing: the photo preview, then Help/Settings, then a resident's card.
   * Returns false when nothing was open, so the caller can leave photo or build mode instead.
   */
  closeTopmost(): boolean {
    if (this.modalOpen) {
      this.closeModal();
      return true;
    }
    for (const p of [this.help, this.settings]) {
      if (p.classList.contains('open')) {
        this.toggle(p);
        return true;
      }
    }
    if (this.card.classList.contains('open')) {
      this.closeCard();
      return true;
    }
    if (this.bar.classList.contains('expanded')) {
      this.setMore(false);
      return true;
    }
    return false;
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
    this.musicInput = mv;
    this.ambienceInput = av;
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
    cb.addEventListener('change', () => {
      this.root.classList.toggle('reduced-motion', cb.checked);
      this.act.setReducedMotion(cb.checked);
    });
    this.motionInput = cb;
    rm.append(cb);
    s.append(rm);
    // Destructive, and one stray click away from the look buttons: ask twice, in place, no browser dialog.
    const resetLabel = 'Reset neighbourhood';
    let armed = 0;
    const reset = btn(resetLabel, () => {
      if (armed) {
        window.clearTimeout(armed);
        armed = 0;
        reset.textContent = resetLabel;
        reset.classList.remove('warn');
        this.act.reset();
        return;
      }
      reset.textContent = 'Click again to reset';
      reset.classList.add('warn');
      armed = window.setTimeout(() => {
        armed = 0;
        reset.textContent = resetLabel;
        reset.classList.remove('warn');
      }, 4000);
    });
    reset.classList.add('reset');
    s.append(
      el('p', 'note', 'Reset removes everything you placed, and residents forget it. Time, weather and these settings stay.'),
      reset,
      btn('Close', () => this.toggle(this.settings)),
    );
  }

  private toggle(p: HTMLElement): void {
    const open = !p.classList.contains('open');
    for (const q of [this.settings, this.help]) if (q !== p && q.classList.contains('open')) this.setPanel(q, false);
    this.card.classList.remove('open');
    this.cardFor = null;
    this.setPanel(p, open);
  }

  private setPanel(p: HTMLElement, open: boolean): void {
    if (p.classList.contains('open') === open) return;
    p.classList.toggle('open', open);
    const opener = p === this.settings ? this.settingsBtn : p === this.help ? this.helpBtn : null;
    opener?.setAttribute('aria-expanded', String(open));
    if (open) {
      this.returnFocus.set(p, document.activeElement as HTMLElement | null);
      p.focus({ preventScroll: true });
    } else {
      // only take focus back if it was inside the panel (don't yank it from wherever the player went)
      if (p.contains(document.activeElement)) (this.returnFocus.get(p) ?? opener)?.focus({ preventScroll: true });
      this.returnFocus.delete(p);
    }
  }

  togglePhoto(on: boolean): void {
    if (this.photoOn === on) return;
    this.photoOn = on;
    if (!on) this.closeModal();
    this.root.classList.toggle('hidden', on);
    this.photoBar.classList.toggle('open', on);
    this.act.photo(on);
    // the HUD buttons are invisible now; keep keyboard focus on something that can be seen
    if (on) this.captureBtn.focus({ preventScroll: true });
    else if (this.photoBar.contains(document.activeElement)) this.photoBtn.focus({ preventScroll: true });
  }

  private closeModal(): void {
    if (!this.modalOpen) return;
    this.modal.classList.remove('open');
    this.modal.innerHTML = '';
    if (this.photoOn) this.captureBtn.focus({ preventScroll: true });
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
      el(
        'span',
        'hint',
        coarsePointer() ? 'If the download is blocked, press and hold the image to save it.' : 'If the download is blocked, right-click the image to save it.',
      ),
      a,
      btn('Close', () => this.closeModal()),
    );
    this.modal.append(inner);
    this.modal.classList.add('open');
    a.focus({ preventScroll: true });
  }

  setClock(label: string, day: number, season: Season): void {
    this.clock.textContent = label;
    const s = season[0]!.toUpperCase() + season.slice(1);
    this.date.textContent = `Day ${day + 1} · ${s}`;
    if (season !== this.season) this.setSeason(season);
  }
  setSpeed(speed: number, paused: boolean): void {
    const idx = paused ? 0 : speed > 1 ? 2 : 1;
    this.speedBtns.forEach((b, i) => pressed(b, i === idx));
  }
  setPixel(p: PixelPreset): void {
    for (const [k, b] of this.pixelBtns) pressed(b, k === p); // the chosen look, for screen readers too
  }

  setWeather(m: WeatherMode): void {
    for (const [k, b] of this.weatherBtns) pressed(b, k === m);
  }
  setTool(m: ToolMode, k: PlaceableKind): void {
    pressed(this.buildBtn, m === 'build');
    pressed(this.removeBtn, m === 'remove');
    this.palette.classList.toggle('open', m === 'build');
    for (const [kind, b] of this.paletteBtns) pressed(b, m === 'build' && kind === k);
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
    for (const q of [this.settings, this.help]) this.setPanel(q, false);
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
