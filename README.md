# Chaldea Archive

A visual-novel style reader for the *Fate/Grand Order* story: main story, events, servant interludes and Valentine scenes, played back with sprites, expressions, backgrounds, music and choices.

**Read it:** https://auronsavant.github.io/chaldea-archive/

All story text, art and audio are loaded live from the [Atlas Academy](https://atlasacademy.io) archive. Nothing from the game is stored in this repository.

## Features

- Every NA main story chapter, interlude and event, plus JP-only content in Japanese
- Events ranked by importance (essential → major → smaller), reruns merged
- English ⇄ Japanese text switch mid-scene, with automatic furigana
- Auto, skip, backlog, hide UI; progress and settings saved in your browser

## Controls

| Key | Action |
| --- | --- |
| Click / Space / Enter | Advance |
| A | Auto |
| S / hold Ctrl | Skip |
| L / scroll up | Open log (scroll down at the bottom to close) |
| H / right-click | Hide UI |
| M | Mute |
| G | English ⇄ 日本語 |
| Y | Furigana on/off |

## Development

```sh
npm install
npm run dev
```

`node scripts/rank-events.mjs` refreshes the event story sizes used for ranking. Pushing to `main` deploys to GitHub Pages.

---

Fate/Grand Order © TYPE-MOON / FGO PROJECT. This is an unofficial fan project.

If you enjoy it: [buy me a coffee](https://buymeacoffee.com/aurons) ☕
