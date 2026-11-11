# Playtest kit

Prompt 04's acceptance needs things code can't check: three new people, and real phones. This is the script, so every session is run the same way and the results can be compared.

## Before you start
- Use the live build: <https://lbrodie11.github.io/komorebi-cho/>. Open it in a **private window**, so the player is new (no save, the first-minutes hints show).
- Don't explain the game. Say only: "This is a small game. Play with it however you like, for as long as you like. I'll watch quietly."
- Sound: leave it off, and note whether they turn it on.
- Time it with a stopwatch from the moment the page shows the town.

## What to record (one row per person)

| Measure | How |
|---|---|
| Seconds to first placement | Stopwatch: first object placed |
| Noticed a reaction unprompted? | Did they look at, point at or mention the neighbor who walked over? (yes / no) |
| Words read before placing | Roughly count the words in what they read; target ≤ 12 |
| Opened someone's card? | yes / no, and how many seconds in |
| Turned sound on? | yes / no; if yes, did they leave it on? |
| Found Notes or People? | yes / no |
| Minutes of voluntary watching | Stop when they look away or ask "is that it?" |
| "Would you open it again tomorrow?" | Ask at the end; write their exact words |
| Confusing moments | Write down anything they said out loud |

Acceptance (prompt 04): all three place something and see a reaction within 60 s, having read no more than 12 words.

## Real phones (one pass each)
iPhone Safari, Android Chrome. Portrait and landscape.
- [ ] The town shows at the Fit view (on portrait, the widest view centred on the street, by design).
- [ ] One-finger drag pans; pinch zooms smoothly around the fingers; a two-finger twist turns the street a quarter.
- [ ] Build: tap once to preview (green solid ring or red dashed ring), tap the same spot again to place.
- [ ] Press and hold a person: their card opens.
- [ ] More folds away time, weather and season; the −/+/Fit buttons are reachable with a thumb.
- [ ] Sound on, lock the phone, unlock: sound comes back (or comes back on the next tap), never doubled.
- [ ] Switch to another app and back: no stutter, no doubled music.
- [ ] Frame rate feels smooth at 21:00 in rain (Settings → time Night, weather Rain).
- [ ] Rotate the phone: nothing overlaps, nothing off screen.

## Automated checks (run these first, they're free)

```bash
npm i --no-save playwright@1.64.0 axe-core@4.10.3 && npx playwright install chromium
```

```bash
npm run build && npx vite preview --port 4173
```

```bash
node scripts/ui-audit.mjs http://localhost:4173/ shots/ui-audit && node scripts/a11y-scan.mjs http://localhost:4173/
```

Write the results of each session into `docs/QA.md` (prompt 15), with the date, device and build commit.
