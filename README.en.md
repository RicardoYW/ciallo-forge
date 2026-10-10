# CialloForge · 夜织

> A local, offline generator for **adult fiction** and **image-generation prompts**.
> 16 original adult characters · age-locked 18+ · **zero dependencies** · pure Node.js · no network access.

> ⚠️ **18+ only.** This tool is built for adult creative writing. All characters are original
> fictional adults (ages 19-34). It does not generate or fetch images — it produces text and prompts.

---

## What it is

CialloForge joins two pipelines behind one character database:

- **Text** — character card → act/beat plan → heat-tiered phrase library → voice-register rewriting → a finished story (Markdown, with character sheets and prompt appendices)
- **Image prompts** — character × scene × six target formats (SDXL / Pony / NovelAI / Midjourney / ComfyUI / generic)

No LLM is involved. Text is assembled programmatically from structured templates, a
heat-graded phrase library, and per-character speech registers. That is what makes it
offline, deterministic and testable — and it is also why long-form repetition needs
explicit management (documented in the known-limitations section).

---

## Design principles

1. **Adult age lock (18+)** — every character card must declare `age >= 18` and `ageLock: true`.
   Three gates enforce it: card validation, engine refusal, and text scanning. Prompt negatives
   always include minor-coded exclusion tags.
   The rule is *ageLock beats styling words*: an adult character described as petite, white-haired
   or with a youthful makeup style is a styling choice and passes; only an underage age field, or a
   missing age combined with child-coded body terms, is rejected.
2. **Zero dependencies, fully offline** — Node built-ins only (`http`, `fs`, `child_process`).
   No network requests. Runs with no `node_modules` directory at all.
3. **Reproducible** — the same inputs (scene / cast / heat / pacing / seed) produce byte-identical
   output. This is what makes regression tests possible in the first place.
4. **One engine, two front ends** — the HTTP endpoints call the engine directly and duplicate no
   generation logic, so the GUI and the CLI cannot disagree. A self-check asserts it: the same
   input produced 3753 identical characters through both paths.

---

## Scale

| Item | Count |
| --- | --- |
| Original adult character cards | 16 (7 male / 9 female, ages 19-34) |
| Scenes / beats | 16 / 148 |
| Voice registers | 14 rewriting pipelines |
| Image tags | 354 |
| Prose pools | 8 families × 5 heat tiers |
| Local HTTP endpoints | 19 (+ 3 special branches: streaming, file read, gallery file) |

---

## How to run it

**Windows, no terminal needed**

| Double-click | What you get |
| --- | --- |
| `启动界面.bat` | Graphical interface — a standalone window (Edge `--app=` mode, no address bar), seven tabs |
| `启动.bat` | Chinese-language console menu |
| `启动.bat` → `G` | The showcase gallery (16 sample chapters) |

**Command line**

```bash
node bin/gui.js --no-open                       # start the GUI server only, open the URL yourself
node bin/ciallo.js story --scene S09 --words 2000 --out out/story.md
node bin/ciallo.js prompt --char C12 --scene S11 --target all --heat 5 --out out/prompts.json
node bin/ciallo.js export --out out/export      # full bundle: cards + prompts (json/md/csv) + samples
```

Node 18+ is required. Nothing else.

---

## The interface

A local web UI: Node's built-in `http` serves on `127.0.0.1` only, and the front end is plain
HTML/CSS/JS — no framework, no build step, no CDN requests. Edge's `--app=` mode wraps it into a
standalone window; if no Chromium browser is found it falls back to the system default browser.

| Tab | What it does |
| --- | --- |
| **Create** | Character pool (gender filter, search, click to assign slot A/B), scene selector with default pairing, heat slider (5 tiers), pacing / word count / seed, and a **streaming** story preview that fills in paragraph by paragraph |
| **Characters** | All 16 cards: personality layers, sample lines, kinks, image tags; one-click "use for writing" / "compile prompt" / "copy tags" |
| **Scenes** | Change any scene's default pairing in place and save it back to the data file; same-gender pairs are rejected |
| **Prompts** | Compile one or the full matrix, six target formats, per-item validation status, copy positive/negative/MJ command/NAI payload/ComfyUI workflow, export json+md+csv |
| **Gallery** | Browse generated sample chapters |
| **Validate** | Age-lock checks, gate drill (a synthetic 17-year-old card must be rejected), structural checks |
| **Settings** | Default heat/words/pacing, runtime info, rebuild the export bundle, reload data files |

Keyboard: `Ctrl+Enter` generate · `Ctrl+S` save · `Esc` stop · `/` focus search.

---

## Text pipeline in more detail

```
scene (16, each with acts → beats)
  → beat type: sensory / action / pressure / climax / release / afterglow / interior / dialogue
  → token resolution ({A} {B} {body} {prop} {garment} {reaction} …)
  → heat filtering  (every library entry carries a `min` tier; entries above the current
                     heat are physically unreachable, and no fallback ever widens the pool)
  → voice register  (truncate → stutter → particle → echo → breath → terminal)
  → Markdown
```

**Heat tiers**: 1 restrained · 2 suggestive · 3 sensual (body description, no anatomical nouns) ·
4 explicit (anatomical nouns, penetration, rhythm) · 5 graphic.

**Pacing**: `slow` / `balanced` / `fast` / `pwp`, controlling word multiplier and how many
setup beats get skipped. Measured on the same scene and seed: `504 ≤ 712 ≤ 1006 ≤ 1452` characters.

**Voice registers**: the same dialogue seed comes out differently per character. 「你要是疼就说，别忍着」
becomes a soft trailing whisper for the gentle doctor, clipped commands for the cold executive,
and an eight-character answer for the laconic restorer.

---

## Image prompt pipeline

```
character (tags + body + negatives + LoRA anchors)
  × scene (tags + camera) × pose (heat × kink family) × rating (safe/suggestive/nsfw/explicit)
  → SDXL / Pony / NovelAI / Midjourney / ComfyUI / generic markdown
```

Partner tags follow the cast: male lead → `1boy, 1girl, hetero, handsome male`;
female/female → `2girls, yuri`; solo → `solo male` / `solo female`.

Negatives always carry base quality terms, the character's own negatives, and minor-coded
exclusions.

---

## Verification

```
Layer 1  node --test test/{engine,cli,web}.test.js   → 51/51
Layer 2  node scripts/verify.js                      → 23/23   content self-check  → out/RUN-REPORT.md
Layer 3  node scripts/check-ui.js                    → 32/32   API self-check      → out/UI-CHECK.md
Layer 4  node scripts/check-render.js                → 7/7     headless browser    → out/UI-RENDER.md
```

Layer 3 starts a real server on a random port and exercises every endpoint, including path-traversal
rejection, malformed JSON, streaming event ordering, and the byte-identical CLI/GUI comparison.
Layer 4 renders the page in headless Edge and asserts the DOM actually contains the backend data.

The development log (`开发手记.md`, in Chinese) documents 12 real bugs found during the build —
token recursion, heat values silently falling back to a default, pool fallback widening the tier
filter, duplicate paragraphs in the fill loop, pronoun attribution across mixed-gender casts, and
four more — plus the known limitations.

---

## Extending it

| To change | Edit | Applies after |
| --- | --- | --- |
| Character settings / looks / lines | `data/characters.json` | Settings tab → reload data |
| Scene text, act structure, default pairing | `data/scenes.json` | same (or via the Scenes tab) |
| Phrase library, heat tiers, mood notes | `data/prose.json` | same |
| How a character speaks | `data/voice-registers.json` | same |
| Default parameters | Settings tab, or `data/config.json` | immediately |

Placing any character into any scene gives 16 × 16 = 256 combinations; each pairing reads
differently because both the voice registers and the scene's tone note change.

---

## Notes

- Everything generated is fiction about original adult characters. Nothing here is a real person.
- The tool produces prompts; it never generates images and never contacts an image service.
- **Content tiers**: the repository ships heat tiers 1-3 only. Tiers 4-5 (explicit vocabulary)
  live in a separate **content pack** — a data folder, no code — that you load deliberately:
  drop it in `content-pack/` or set `CIALLO_PACK_DIR`, then run `node bin/ciallo.js pack status`.
  Three-gate age enforcement is described in the Chinese README section 「内容分级与年龄门禁」.
- Code is MIT licensed (see `LICENSE`). The licence covers the code; whoever generates content
  with it is responsible for that content's compliance, its age rating and where it is distributed.
