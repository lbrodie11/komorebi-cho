import { drawWordmark, swatch } from './wordmark';
import { icon, type IconName } from './icons';
import { PLACEABLES, type PlaceableKind } from '../world/props';
import { SEASONS, type Season } from '../core/clock';
import type { WeatherMode } from '../world/weather';
import type { ToolMode } from './build';
import type { ResidentInfo } from '../sim/residents';
import { PERSONAS } from '../sim/personas';
import { PIXEL_PRESETS, type PixelPreset } from '../render/pixelscale';
import { fmt, getLang, t, type Lang, type Msg, type MsgKey } from '../i18n';

export type LangSetting = Lang | 'auto';
export const TEXT_SCALES = [1, 1.25, 1.5] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

/** A line in Notes: what happened, and when (in-game day and minutes). */
export interface Note {
  msg: Msg;
  day: number;
  minutes: number;
}
/** Notes keeps this many lines (a ring buffer, saved). */
export const NOTES_MAX = 50;

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
  setVolumes(music: number, ambience: number, effects: number): void;
  setReducedMotion(v: boolean): void;
  /** Film Diffusion strength, 0..0.2. */
  setDiffusion(s: number): void;
  setCaptions(on: boolean): void;
  setTextScale(s: TextScale): void;
  setLang(l: LangSetting): void;
  /** Open a neighbour's card (from the People list). */
  meet(id: string): void;
  /** Bring the camera to a neighbour. */
  showMe(id: string): void;
  /** The bench hint's sparkle was pressed. */
  hintPressed(): void;
  resetTutorial(): void;
  reset(): void;
}

/** Slider readout: "Off" at 0, otherwise the percent ("0.5%", "5%"). */
export const diffusionLabel = (pct: number): string => (pct <= 0 ? t('settings.off') : `${Number(pct.toFixed(1))}%`);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};
/** Touch-first device: no hover, so build previews on the first tap and commits on the second. */
export const coarsePointer = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const FOCUSABLE = 'button, [href], input, [tabindex]:not([tabindex="-1"])';

/** A toggle button's look and its screen-reader state, always together. */
const pressed = (b: HTMLButtonElement, on: boolean): void => {
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
};

/** The toolbar hides after this long without input (desktop only), and comes back on any movement. */
const DOCK_IDLE_MS = 6000;

/** All DOM UI. Deliberately quiet: the diorama is the interface. */
export class Hud {
  private readonly root: HTMLElement;
  /** Re-run on a language change: every piece of text the HUD shows. */
  private readonly texts: (() => void)[] = [];
  private readonly clock = el('span', 'clock');
  private readonly date = el('span', 'date');
  private readonly storyBox = el('div', 'story');
  private readonly captions = el('div', 'captions');
  private readonly card = el('div', 'card panel');
  private readonly cardBody = el('div');
  private readonly leader = el('div', 'leader');
  private readonly settings = el('div', 'settings panel');
  private readonly help = el('div', 'help panel');
  private readonly notes = el('div', 'notes panel');
  private readonly notesList = el('ol', 'notes-list');
  private readonly people = el('div', 'people panel');
  private readonly peopleList = el('ul', 'people-list');
  private readonly palette = el('div', 'palette panel');
  private readonly bar = el('div', 'toolbar panel');
  private readonly dock = el('div', 'dock');
  private readonly photoBar = el('div', 'photo-bar panel');
  private readonly modal = el('div', 'modal');
  private readonly hint = el('div', 'hint-spot');
  private readonly hintLabel = el('span', 'hint-label panel');
  private readonly meetHint = el('div', 'meet-hint panel');
  private readonly saveNote = el('p', 'note save-note');
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly weatherBtns = new Map<WeatherMode, HTMLButtonElement>();
  private readonly pixelBtns = new Map<PixelPreset, HTMLButtonElement>();
  private readonly scaleBtns = new Map<TextScale, HTMLButtonElement>();
  private readonly langBtns = new Map<LangSetting, HTMLButtonElement>();
  private readonly seasonBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly buildBtn: HTMLButtonElement;
  private readonly removeBtn: HTMLButtonElement;
  private readonly settingsBtn: HTMLButtonElement;
  private readonly helpBtn: HTMLButtonElement;
  private readonly notesBtn: HTMLButtonElement;
  private readonly peopleBtn: HTMLButtonElement;
  private readonly photoBtn: HTMLButtonElement;
  private readonly captureBtn: HTMLButtonElement;
  private readonly moreBtn: HTMLButtonElement;
  private readonly paletteBtns = new Map<PlaceableKind, HTMLButtonElement>();
  private readonly panels: HTMLElement[];
  private cardFor: (() => ResidentInfo | null) | null = null;
  private cardId: string | null = null;
  private season: Season = 'spring';
  private splash: HTMLElement | null = null;
  private soundOn = false;
  private soundPending = false;
  private musicInput: HTMLInputElement | null = null;
  private ambienceInput: HTMLInputElement | null = null;
  private effectsInput: HTMLInputElement | null = null;
  private motionInput: HTMLInputElement | null = null;
  private captionsInput: HTMLInputElement | null = null;
  private diffusionInput: HTMLInputElement | null = null;
  private diffusionOut: HTMLOutputElement | null = null;
  private notesData: Note[] = [];
  private peopleInfo: ((id: string) => ResidentInfo | null) | null = null;
  private readonly peopleDoing = new Map<string, HTMLElement>();
  /** Where focus was before a panel or the photo preview took it, to give it back on close. */
  private returnFocus = new Map<HTMLElement, HTMLElement | null>();
  private lastInput = performance.now();
  private dockHover = false;
  private tool: ToolMode = 'view';
  private hintStep: 'bench' | 'meet' | null = null;
  /** Photo mode is on (the HUD is hidden behind the photo bar). */
  photoOn = false;

  constructor(
    root: HTMLElement,
    private readonly act: HudActions,
  ) {
    this.root = root;
    const brand = el('div', 'brand');
    const tag = el('div', 'tag');
    this.text(() => (tag.textContent = t('app.tagline')));
    brand.append(drawWordmark(), tag);

    // ── Top bar ──
    const top = el('div', 'top-right');
    this.soundBtn = this.btn('soundOff', 'top.soundOff', 'top.soundTitle', () => void this.toggleSound());
    this.soundBtn.setAttribute('aria-pressed', 'false');
    this.photoBtn = this.btn('photo', 'top.photo', 'top.photoTitle', () => this.togglePhoto(true));
    this.notesBtn = this.btn('notes', 'top.notes', 'top.notesTitle', () => this.toggleNotes());
    this.peopleBtn = this.btn('people', 'top.people', 'top.peopleTitle', () => this.togglePeople());
    this.settingsBtn = this.btn('settings', 'top.settings', 'top.settings', () => this.toggle(this.settings));
    this.helpBtn = this.btn('help', 'top.help', 'top.helpTitle', () => this.toggleHelp());
    this.panels = [this.settings, this.help, this.notes, this.people];
    const panelDefs: [HTMLButtonElement, HTMLElement, string, MsgKey][] = [
      [this.settingsBtn, this.settings, 'kc-settings', 'settings.title'],
      [this.helpBtn, this.help, 'kc-help', 'top.help'],
      [this.notesBtn, this.notes, 'kc-notes', 'notes.title'],
      [this.peopleBtn, this.people, 'kc-people', 'people.title'],
    ];
    for (const [b, panel, id, label] of panelDefs) {
      panel.id = id;
      panel.tabIndex = -1;
      panel.setAttribute('role', 'dialog');
      this.text(() => panel.setAttribute('aria-label', t(label)));
      b.setAttribute('aria-controls', id);
      b.setAttribute('aria-expanded', 'false');
    }
    top.append(this.soundBtn, this.photoBtn, this.notesBtn, this.peopleBtn, this.settingsBtn, this.helpBtn);

    // ── Toolbar: icons, with the words as tooltips and accessible names ──
    const bar = this.bar;
    bar.setAttribute('role', 'toolbar');
    this.text(() => bar.setAttribute('aria-label', t('bar.label')));
    const pause = this.btn('pause', null, 'bar.pause', () => this.act.setSpeed(0));
    const play = this.btn('play', null, 'bar.play', () => this.act.setSpeed(1));
    const fast = this.btn('fast', null, 'bar.fast', () => this.act.setSpeed(6));
    this.speedBtns.push(pause, play, fast);
    const jumps: [IconName, MsgKey, number, string][] = [
      ['dawn', 'bar.dawn', 5.8, '1'],
      ['noon', 'bar.noon', 12, '2'],
      ['dusk', 'bar.dusk', 17.9, '3'],
      ['night', 'bar.night', 21.5, '4'],
    ];
    this.seasonBtn = this.btn('spring', null, null, () => {
      const i = (SEASONS.indexOf(this.season) + 1) % SEASONS.length;
      this.act.setSeason(SEASONS[i]!);
      this.setSeason(SEASONS[i]!); // now, not at the next once-a-second refresh: a quick second click must advance again
    });
    this.buildBtn = this.btn('build', 'bar.build', 'bar.buildTitle', () => this.act.setTool(this.buildBtn.classList.contains('on') ? 'view' : 'build'));
    this.removeBtn = this.btn('remove', 'bar.remove', 'bar.removeTitle', () => this.act.setTool(this.removeBtn.classList.contains('on') ? 'view' : 'remove'));
    for (const b of [pause, play, fast, this.buildBtn, this.removeBtn]) b.setAttribute('aria-pressed', 'false');
    // Time-of-day, weather and season are the "advanced" controls: always shown on wide screens,
    // folded behind "More" on phones so the toolbar stays one row and the diorama stays visible.
    const more = el('span', 'more');
    more.id = 'kc-more';
    more.append(el('span', 'sep'));
    for (const [ic, label, h, key] of jumps) {
      const b = this.btn(ic, null, null, () => this.act.jumpTo(h));
      this.text(() => this.name(b, t('bar.skipTo', { when: t(label), key })));
      more.append(b);
    }
    more.append(el('span', 'sep'));
    for (const [m, ic, label] of [
      ['auto', 'auto', 'weather.auto'],
      ['clear', 'clear', 'weather.clear'],
      ['rain', 'rain', 'weather.rain'],
    ] as const) {
      const b = this.btn(ic, null, null, () => this.act.setWeather(m));
      b.setAttribute('aria-pressed', 'false');
      this.weatherBtns.set(m, b);
      this.text(() => this.name(b, t('bar.weather', { mode: t(m === 'rain' && this.season === 'winter' ? 'weather.snow' : label) })));
      more.append(b);
    }
    more.append(el('span', 'sep'), this.seasonBtn);
    this.moreBtn = this.btn('more', null, 'bar.moreTitle', () => this.setMore(!bar.classList.contains('expanded')));
    this.moreBtn.classList.add('more-toggle');
    this.moreBtn.setAttribute('aria-controls', 'kc-more');
    this.moreBtn.setAttribute('aria-expanded', 'false');
    bar.append(this.clock, this.date, pause, play, fast, more, el('span', 'sep'), this.buildBtn, this.removeBtn, this.moreBtn);

    // ── Build palette ──
    for (const def of Object.values(PLACEABLES)) {
      const b = el('button', 'px');
      b.type = 'button';
      b.addEventListener('click', () => this.act.setTool('build', def.kind));
      b.setAttribute('aria-pressed', 'false');
      const sw = swatch(def.kind);
      sw.className = 'sw';
      sw.setAttribute('aria-hidden', 'true');
      const lbl = el('span');
      b.append(sw, lbl);
      this.text(() => {
        const name = t(`placeable.${def.kind}` as MsgKey);
        lbl.textContent = name;
        b.title = t('palette.place', { thing: name });
      });
      this.paletteBtns.set(def.kind, b);
      this.palette.append(b);
    }
    const rotate = this.btn('rotate', 'palette.rotate', 'palette.rotateTitle', () => this.act.rotateItem());
    rotate.classList.add('rotate');
    const pHint = el('span', 'hint');
    this.text(() => (pHint.textContent = t(coarsePointer() ? 'palette.hintTouch' : 'palette.hintMouse')));
    this.palette.append(rotate, pHint);
    this.palette.setAttribute('role', 'toolbar');
    this.text(() => this.palette.setAttribute('aria-label', t('palette.label')));

    // ── Resident card ──
    this.card.setAttribute('role', 'region');
    this.card.setAttribute('aria-live', 'polite');
    this.text(() => this.card.setAttribute('aria-label', t('card.label')));
    const x = this.btn(null, null, 'common.close', () => this.closeCard());
    x.textContent = 'x';
    x.classList.add('x');
    const show = this.btn(null, 'card.follow', 'card.follow', () => this.cardId && this.act.showMe(this.cardId));
    show.classList.add('show-me');
    this.card.append(this.cardBody, show, x);

    this.buildSettings();
    this.buildHelp();
    this.buildNotes();
    this.buildPeople();

    this.captureBtn = this.btn(
      null,
      'photo.capture',
      'photo.capture',
      () =>
        void this.act.capture().then((url) => {
          if (url) this.showCapture(url);
        }),
    );
    this.photoBar.append(
      this.captureBtn,
      this.btn(null, 'photo.exit', 'photo.exit', () => this.togglePhoto(false)),
    );
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.text(() => this.modal.setAttribute('aria-label', t('photo.preview')));
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
    this.text(() => this.storyBox.setAttribute('aria-label', t('story.label')));
    this.captions.setAttribute('aria-hidden', 'true'); // a visual aid; the story log is the screen-reader channel
    this.dock.append(this.palette, bar);
    this.dock.addEventListener('pointerenter', () => (this.dockHover = true));
    this.dock.addEventListener('pointerleave', () => (this.dockHover = false));

    // the bench hint: a sparkle on the grass (positioned every frame by placeHint) with a word next to it
    const sparkle = el('button', 'sparkle');
    sparkle.type = 'button';
    sparkle.append(icon('sparkle'));
    sparkle.addEventListener('click', () => this.act.hintPressed());
    this.hint.append(sparkle, this.hintLabel);
    this.text(() => {
      const words = t(coarsePointer() ? 'hint.benchTouch' : 'hint.bench');
      this.hintLabel.textContent = words;
      sparkle.setAttribute('aria-label', words);
    });
    this.text(() => (this.meetHint.textContent = t(coarsePointer() ? 'hint.meetTouch' : 'hint.meet')));
    this.meetHint.setAttribute('role', 'status');

    this.splash = el('div', 'splash');
    const sp = el('div', 'panel');
    this.text(() => (sp.innerHTML = t(coarsePointer() ? 'splash.touch' : 'splash.mouse')));
    this.splash.append(sp);

    root.append(
      brand,
      top,
      this.storyBox,
      this.leader,
      this.card,
      this.hint,
      this.meetHint,
      ...this.panels,
      this.captions,
      this.dock,
      this.photoBar,
      this.modal,
      this.splash,
    );
    window.setTimeout(() => this.dismissSplash(), 9000);

    // toolbar auto-hide: any input wakes it; a slow timer hides it (cheap, and stops with nothing to do)
    const wake = () => {
      this.lastInput = performance.now();
      if (this.dock.classList.contains('idle')) this.dock.classList.remove('idle');
    };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin'] as const) window.addEventListener(ev, wake, { passive: true });
    window.setInterval(() => this.idleCheck(), 1000);
    this.relabel();
  }

  // ── Building blocks ────────────────────────────────────────────────────

  /** Register a piece of text; it runs now and again on every language change. */
  private text(fn: () => void): void {
    this.texts.push(fn);
  }

  /** Set a control's accessible name and tooltip. */
  private name(b: HTMLElement, words: string): void {
    b.title = words;
    b.setAttribute('aria-label', words);
  }

  /** A button with an optional pixel icon, an optional visible label, and a tooltip / accessible name. */
  private btn(ic: IconName | null, label: MsgKey | null, title: MsgKey | null, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'px');
    b.type = 'button';
    if (ic) b.append(icon(ic));
    if (label) {
      const s = el('span', 'lbl');
      b.append(s);
      this.text(() => (s.textContent = t(label)));
      if (ic) b.classList.add('ilbl');
    } else if (ic) b.classList.add('iconly');
    if (title) this.text(() => this.name(b, t(title)));
    b.addEventListener('click', onClick);
    return b;
  }

  private setIcon(b: HTMLButtonElement, ic: IconName): void {
    b.querySelector('canvas.ico')?.replaceWith(icon(ic));
  }

  /** Re-word everything (a language change). */
  relabel(): void {
    for (const fn of this.texts) fn();
    document.documentElement.lang = getLang();
    this.setSoundLabel();
    this.setSeason(this.season);
    for (const line of this.storyBox.children) {
      const m = (line as HTMLElement & { msg?: Msg }).msg;
      if (m) line.textContent = fmt(m);
    }
    this.refreshCard();
    this.renderNotes();
    this.renderPeople();
    this.showDiffusion(Number(this.diffusionInput?.value ?? 0));
  }

  private dismissSplash(): void {
    this.splash?.remove();
    this.splash = null;
  }

  // ── Sound ──────────────────────────────────────────────────────────────

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
    this.soundOn = on;
    this.setSoundLabel();
    pressed(this.soundBtn, on);
  }

  private setSoundLabel(): void {
    const lbl = this.soundBtn.querySelector('.lbl');
    if (lbl) lbl.textContent = t(this.soundOn ? 'top.soundOn' : 'top.soundOff');
    this.setIcon(this.soundBtn, this.soundOn ? 'soundOn' : 'soundOff');
  }

  /** Reflect saved volumes in the sliders (they otherwise show the defaults after a reload). */
  setVolumes(music: number, ambience: number, effects: number): void {
    if (this.musicInput) this.musicInput.value = String(music);
    if (this.ambienceInput) this.ambienceInput.value = String(ambience);
    if (this.effectsInput) this.effectsInput.value = String(effects);
  }

  setReducedMotion(v: boolean): void {
    if (this.motionInput) this.motionInput.checked = v;
    this.root.classList.toggle('reduced-motion', v);
  }

  setCaptions(on: boolean): void {
    if (this.captionsInput) this.captionsInput.checked = on;
  }

  /** Show a sound caption ("[temple bell]") for a few seconds. */
  caption(words: string): void {
    const line = el('div', 'cap');
    line.textContent = words;
    this.captions.append(line);
    while (this.captions.children.length > 3) this.captions.firstElementChild?.remove();
    window.setTimeout(() => line.remove(), 5000);
  }

  setTextScale(s: TextScale): void {
    this.root.style.setProperty('--ts', String(s));
    for (const [k, b] of this.scaleBtns) pressed(b, k === s);
  }

  setLang(l: LangSetting): void {
    for (const [k, b] of this.langBtns) pressed(b, k === l);
    this.relabel();
  }

  /** Where saving stands: fine, impossible in this browser, or handed to another tab. */
  setSaveStatus(s: 'ok' | 'notSaving' | 'otherTab'): void {
    this.saveNote.hidden = s === 'ok';
    this.saveNote.dataset.key = s;
    if (s !== 'ok') this.saveNote.textContent = t(s === 'notSaving' ? 'settings.notSaving' : 'settings.otherTab');
  }

  setSeason(season: Season): void {
    this.season = season;
    const name = t(`season.${season}` as MsgKey);
    this.setIcon(this.seasonBtn, season);
    this.name(this.seasonBtn, t('bar.seasonTitle', { season: name }));
    // the same weather mode falls as snow in winter; say (and show) what the button will actually do
    const wet = this.weatherBtns.get('rain');
    if (wet) {
      this.setIcon(wet, season === 'winter' ? 'snow' : 'rain');
      this.name(wet, t('bar.weather', { mode: t(season === 'winter' ? 'weather.snow' : 'weather.rain') }));
    }
  }

  private setMore(open: boolean): void {
    this.bar.classList.toggle('expanded', open);
    this.moreBtn.setAttribute('aria-expanded', String(open));
    this.moreBtn.classList.toggle('on', open);
  }

  // ── Panels ─────────────────────────────────────────────────────────────

  toggleHelp(): void {
    this.toggle(this.help);
  }
  toggleNotes(): void {
    this.toggle(this.notes);
  }
  togglePeople(): void {
    this.toggle(this.people);
  }

  /** Is the photo preview up? Game keys wait while it is (only Esc and Tab act). */
  get modalOpen(): boolean {
    return this.modal.classList.contains('open');
  }

  /** Is any panel (or the card) open? The toolbar never auto-hides then. */
  private get anyOpen(): boolean {
    return this.panels.some((p) => p.classList.contains('open')) || this.card.classList.contains('open');
  }

  /**
   * Esc closes the topmost thing: the photo preview, then a panel, then a resident's card, then More.
   * Returns false when nothing was open, so the caller can leave photo or build mode instead.
   */
  closeTopmost(): boolean {
    if (this.modalOpen) {
      this.closeModal();
      return true;
    }
    for (const p of this.panels) {
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

  private toggle(p: HTMLElement): void {
    const open = !p.classList.contains('open');
    for (const q of this.panels) if (q !== p && q.classList.contains('open')) this.setPanel(q, false);
    this.closeCard();
    this.setPanel(p, open);
    if (open && p === this.notes) this.renderNotes();
    if (open && p === this.people) this.renderPeople();
  }

  private opener(p: HTMLElement): HTMLButtonElement | null {
    return p === this.settings
      ? this.settingsBtn
      : p === this.help
        ? this.helpBtn
        : p === this.notes
          ? this.notesBtn
          : p === this.people
            ? this.peopleBtn
            : null;
  }

  private setPanel(p: HTMLElement, open: boolean): void {
    if (p.classList.contains('open') === open) return;
    p.classList.toggle('open', open);
    const opener = this.opener(p);
    opener?.setAttribute('aria-expanded', String(open));
    if (opener) opener.classList.toggle('on', open);
    if (open) {
      this.returnFocus.set(p, document.activeElement as HTMLElement | null);
      p.focus({ preventScroll: true });
    } else {
      // only take focus back if it was inside the panel (don't yank it from wherever the player went)
      if (p.contains(document.activeElement)) (this.returnFocus.get(p) ?? opener)?.focus({ preventScroll: true });
      this.returnFocus.delete(p);
    }
  }

  private buildHelp(): void {
    const h = el('h3');
    const intro = el('p');
    const keys = el('p');
    const touch = el('p');
    const code = el('p', 'muted');
    this.text(() => {
      h.textContent = t('help.title');
      intro.textContent = t('help.intro');
      keys.innerHTML = t('help.keys'); // trusted, authored markup (<kbd>)
      touch.textContent = t('help.touch');
      code.textContent = t('help.code');
    });
    this.help.append(
      h,
      intro,
      keys,
      touch,
      code,
      this.btn(null, 'common.close', null, () => this.toggleHelp()),
    );
  }

  private buildNotes(): void {
    const h = el('h4');
    this.text(() => (h.textContent = t('notes.title')));
    this.notes.append(
      h,
      this.notesList,
      this.btn(null, 'common.close', null, () => this.toggleNotes()),
    );
  }

  private renderNotes(): void {
    if (!this.notes.classList.contains('open')) return;
    this.notesList.innerHTML = '';
    if (!this.notesData.length) {
      const li = el('li', 'muted');
      li.textContent = t('notes.empty');
      this.notesList.append(li);
      return;
    }
    for (const n of [...this.notesData].reverse()) {
      const li = el('li');
      const when = el('span', 'when');
      const m = Math.floor(n.minutes % (24 * 60));
      const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      when.textContent = t('notes.when', { day: n.day + 1, time });
      const what = el('span');
      what.textContent = fmt(n.msg);
      li.append(when, what);
      this.notesList.append(li);
    }
  }

  /** Notes for the save (oldest first). */
  get noteList(): Note[] {
    return this.notesData;
  }
  restoreNotes(list: Note[]): void {
    this.notesData = list.slice(-NOTES_MAX);
  }

  private buildPeople(): void {
    const h = el('h4');
    const intro = el('p', 'muted');
    this.text(() => {
      h.textContent = t('people.title');
      intro.textContent = t('people.intro');
    });
    for (const p of PERSONAS) {
      const li = el('li');
      const b = el('button', 'px person');
      b.type = 'button';
      const name = el('span', 'who');
      const doing = el('span', 'doing');
      this.text(() => {
        name.textContent = t(`persona.${p.id}.name` as MsgKey);
        b.setAttribute('aria-label', `${t(`persona.${p.id}.name` as MsgKey)}, ${t(`persona.${p.id}.role` as MsgKey)}`);
      });
      b.append(name, doing);
      b.addEventListener('click', () => this.act.meet(p.id));
      this.peopleDoing.set(p.id, doing);
      li.append(b);
      this.peopleList.append(li);
    }
    this.people.append(
      h,
      intro,
      this.peopleList,
      this.btn(null, 'common.close', null, () => this.togglePeople()),
    );
  }

  /** Where the People list gets each neighbour's current activity. */
  setPeopleSource(info: (id: string) => ResidentInfo | null): void {
    this.peopleInfo = info;
  }

  /** Refresh what each neighbour is doing (once a second, only while the list is open). */
  renderPeople(): void {
    if (!this.people.classList.contains('open') || !this.peopleInfo) return;
    for (const [id, span] of this.peopleDoing) {
      const i = this.peopleInfo(id);
      span.textContent = i ? fmt(i.doing) : '';
    }
  }

  private buildSettings(): void {
    const s = this.settings;
    const h = el('h4');
    this.text(() => (h.textContent = t('settings.title')));
    s.append(h);
    const px = el('div', 'row');
    for (const p of PIXEL_PRESETS) {
      const b = this.btn(null, `look.${p}` as MsgKey, `look.${p}Title` as MsgKey, () => this.act.setPixel(p));
      this.pixelBtns.set(p, b);
      px.append(b);
    }
    s.append(px);
    const slider = (label: MsgKey, v: number) => {
      const l = el('label');
      const name = el('span');
      this.text(() => (name.textContent = t(label)));
      const r = el('input');
      r.type = 'range';
      r.min = '0';
      r.max = '1';
      r.step = '0.05';
      r.value = String(v);
      l.append(name, r);
      s.append(l);
      return r;
    };
    const mv = slider('settings.music', 0.55);
    const av = slider('settings.ambience', 0.6);
    const ev = slider('settings.effects', 0.6);
    this.musicInput = mv;
    this.ambienceInput = av;
    this.effectsInput = ev;
    const upd = () => this.act.setVolumes(Number(mv.value), Number(av.value), Number(ev.value));
    for (const r of [mv, av, ev]) r.addEventListener('input', upd);
    // Film Diffusion: 0–20%, live on input. Range inputs already take arrow keys (main.ts ignores keys aimed at inputs).
    const fd = el('label', 'diffusion');
    const name = el('span');
    const nameText = el('span');
    this.text(() => {
      nameText.textContent = `${t('settings.diffusion')} `;
      fd.title = t('settings.diffusionTitle');
    });
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
    name.append(nameText, out);
    fd.append(name, fr);
    s.append(fd);
    this.diffusionInput = fr;
    this.diffusionOut = out;
    const check = (label: MsgKey, onChange: (v: boolean) => void) => {
      const l = el('label');
      const n = el('span');
      this.text(() => (n.textContent = t(label)));
      const cb = el('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => onChange(cb.checked));
      l.append(n, cb);
      s.append(l);
      return cb;
    };
    this.motionInput = check('settings.reducedMotion', (v) => {
      this.root.classList.toggle('reduced-motion', v);
      this.act.setReducedMotion(v);
    });
    this.captionsInput = check('settings.captions', (v) => this.act.setCaptions(v));
    const choice = <K>(label: MsgKey, opts: [K, MsgKey][], into: Map<K, HTMLButtonElement>, pick: (k: K) => void) => {
      const wrap = el('div', 'choice');
      const n = el('span');
      this.text(() => (n.textContent = t(label)));
      const row = el('div', 'row3');
      row.setAttribute('role', 'group');
      this.text(() => row.setAttribute('aria-label', t(label)));
      for (const [k, words] of opts) {
        const b = this.btn(null, words, null, () => pick(k));
        b.setAttribute('aria-pressed', 'false');
        into.set(k, b);
        row.append(b);
      }
      wrap.append(n, row);
      s.append(wrap);
    };
    choice<TextScale>(
      'settings.textSize',
      [
        [1, 'settings.text.1'],
        [1.25, 'settings.text.1.25'],
        [1.5, 'settings.text.1.5'],
      ],
      this.scaleBtns,
      (k) => this.act.setTextScale(k),
    );
    choice<LangSetting>(
      'settings.language',
      [
        ['auto', 'lang.auto'],
        ['en', 'lang.en'],
        ['ja', 'lang.ja'],
      ],
      this.langBtns,
      (k) => this.act.setLang(k),
    );
    const hintsAgain = this.btn(null, 'settings.resetTutorial', null, () => {
      this.act.resetTutorial();
      hintsAgain.textContent = t('settings.resetTutorialDone');
      window.setTimeout(() => (hintsAgain.textContent = t('settings.resetTutorial')), 3000);
    });
    hintsAgain.classList.add('wide');
    s.append(hintsAgain);
    // Destructive, and one stray click away from the look buttons: ask twice, in place, no browser dialog.
    let armed = 0;
    const reset = this.btn(null, 'settings.reset', null, () => {
      if (armed) {
        window.clearTimeout(armed);
        armed = 0;
        reset.textContent = t('settings.reset');
        reset.classList.remove('warn');
        this.act.reset();
        return;
      }
      reset.textContent = t('settings.resetConfirm');
      reset.classList.add('warn');
      armed = window.setTimeout(() => {
        armed = 0;
        reset.textContent = t('settings.reset');
        reset.classList.remove('warn');
      }, 4000);
    });
    reset.classList.add('reset', 'wide');
    const note = el('p', 'note');
    this.text(() => (note.textContent = t('settings.resetNote')));
    this.saveNote.hidden = true;
    this.text(() => {
      const k = this.saveNote.dataset.key;
      if (k === 'notSaving' || k === 'otherTab') this.saveNote.textContent = t(k === 'notSaving' ? 'settings.notSaving' : 'settings.otherTab');
    });
    s.append(
      note,
      reset,
      this.saveNote,
      this.btn(null, 'common.close', null, () => this.toggle(this.settings)),
    );
  }

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

  // ── Photo mode ─────────────────────────────────────────────────────────

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
    img.alt = t('photo.alt');
    const a = el('a', 'px');
    a.textContent = t('photo.download');
    a.setAttribute('href', url);
    a.setAttribute('download', `komorebi-cho-${Date.now()}.png`);
    a.style.color = 'var(--cream)';
    const hint = el('span', 'hint');
    hint.textContent = t(coarsePointer() ? 'photo.hintTouch' : 'photo.hintMouse');
    inner.append(
      img,
      hint,
      a,
      this.btn(null, 'common.close', null, () => this.closeModal()),
    );
    this.modal.append(inner);
    this.modal.classList.add('open');
    a.focus({ preventScroll: true });
  }

  // ── Toolbar state ──────────────────────────────────────────────────────

  setClock(label: string, day: number, season: Season): void {
    this.clock.textContent = label;
    this.date.textContent = t('bar.date', { day: day + 1, season: t(`season.${season}` as MsgKey) });
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
    this.tool = m;
    pressed(this.buildBtn, m === 'build');
    pressed(this.removeBtn, m === 'remove');
    this.palette.classList.toggle('open', m === 'build');
    for (const [kind, b] of this.paletteBtns) pressed(b, m === 'build' && kind === k);
    if (m !== 'view') this.dock.classList.remove('idle');
  }

  /** Hide the toolbar after a while without input: desktop only, never mid-task. */
  private idleCheck(): void {
    const focusInDock = this.dock.contains(document.activeElement);
    const keep = coarsePointer() || this.tool !== 'view' || this.anyOpen || this.dockHover || focusInDock || this.hintStep === 'bench' || this.photoOn;
    if (!keep && performance.now() - this.lastInput > DOCK_IDLE_MS) this.dock.classList.add('idle');
  }

  // ── Story feed and Notes ───────────────────────────────────────────────

  /** A story line: shown for a while in the feed, and kept in Notes with when it happened. */
  story(m: Msg, day: number, minutes: number, fleeting = false): void {
    const line = el('div', 'line panel') as HTMLDivElement & { msg?: Msg };
    line.msg = m;
    line.textContent = fmt(m);
    this.storyBox.append(line);
    const lines = [...this.storyBox.children];
    lines.forEach((l, i) => l.classList.toggle('old', i < lines.length - 2));
    while (this.storyBox.children.length > 4) this.storyBox.firstElementChild?.remove();
    // fade, then go: the feed is a glance; Notes is the record
    window.setTimeout(() => line.classList.add('fading'), 13000);
    window.setTimeout(() => line.remove(), 16000);
    if (fleeting) return;
    this.notesData.push({ msg: m, day, minutes });
    if (this.notesData.length > NOTES_MAX) this.notesData.splice(0, this.notesData.length - NOTES_MAX);
    this.renderNotes();
  }

  // ── First-minutes hints ────────────────────────────────────────────────

  /** Which hint is up: the bench sparkle, the "meet someone" line, or none. */
  setHint(step: 'bench' | 'meet' | null): void {
    this.hintStep = step;
    this.meetHint.classList.toggle('open', step === 'meet' && !this.photoOn);
    if (step !== 'bench') this.hint.classList.remove('open');
  }

  /** Put the bench sparkle at a screen point (CSS px inside the HUD), or hide it. */
  placeHint(p: { x: number; y: number } | null): void {
    const show = this.hintStep === 'bench' && !!p && !this.photoOn;
    this.hint.classList.toggle('open', show);
    if (show) this.hint.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
  }

  // ── Resident card ──────────────────────────────────────────────────────

  openCard(id: string, get: () => ResidentInfo | null): void {
    this.cardFor = get;
    this.cardId = id;
    for (const q of this.panels) this.setPanel(q, false);
    this.card.classList.add('open');
    this.refreshCard();
  }
  closeCard(): void {
    this.cardFor = null;
    this.cardId = null;
    this.card.classList.remove('open');
    this.leader.classList.remove('open');
    this.card.classList.remove('floating');
    this.card.style.left = this.card.style.top = '';
  }
  /** The neighbour whose card is open, if any. */
  get openCardId(): string | null {
    return this.cardId;
  }
  refreshCard(): void {
    if (!this.cardFor) return;
    const i = this.cardFor();
    if (!i) return this.closeCard();
    this.cardBody.innerHTML = '';
    const h = el('h3');
    h.textContent = t(`persona.${i.id}.name` as MsgKey);
    const role = el('div', 'role');
    role.textContent = t(`persona.${i.id}.role` as MsgKey);
    const p = el('p');
    p.textContent = t(`persona.${i.id}.blurb` as MsgKey);
    const doing = el('div', 'doing');
    doing.textContent = t('card.now', { doing: i.doing });
    const knows = el('div', 'role knows');
    knows.textContent = t('card.knows', { n: i.knows });
    this.cardBody.append(h, role, p, doing, knows);
  }

  /**
   * Keep the card beside its neighbour with a short leader line (wide screens). `p` is the
   * neighbour's head in HUD pixels, or null when they are indoors or off screen: the card
   * then stays put and the line goes.
   */
  placeCard(p: { x: number; y: number } | null): void {
    if (!this.cardFor) return;
    const wide = window.innerWidth > 720 && window.innerHeight > 500;
    if (!wide) {
      this.card.classList.remove('floating');
      this.card.style.left = this.card.style.top = '';
      this.leader.classList.remove('open');
      return;
    }
    if (!p) {
      this.leader.classList.remove('open');
      return;
    }
    const W = this.root.clientWidth,
      H = this.root.clientHeight;
    const cw = this.card.offsetWidth,
      ch = this.card.offsetHeight;
    const gap = 46;
    let left = p.x + gap;
    if (left + cw > W - 12) left = p.x - gap - cw;
    left = Math.max(12, Math.min(W - cw - 12, left));
    const top = Math.max(64, Math.min(H - ch - 110, p.y - ch / 2));
    this.card.classList.add('floating');
    this.card.style.left = `${Math.round(left)}px`;
    this.card.style.top = `${Math.round(top)}px`;
    // leader: from the head to the nearest point on the card's edge
    const bx = Math.max(left, Math.min(left + cw, p.x)),
      by = Math.max(top, Math.min(top + ch, p.y));
    const len = Math.hypot(bx - p.x, by - p.y);
    if (len < 8) {
      this.leader.classList.remove('open');
      return;
    }
    this.leader.classList.add('open');
    this.leader.style.width = `${Math.round(len)}px`;
    this.leader.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) rotate(${Math.atan2(by - p.y, bx - p.x)}rad)`;
  }
}
