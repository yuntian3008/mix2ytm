# mix2ytm Bookmarklet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A drag-to-install bookmarklet that saves the YouTube Mix the user is watching as a private YouTube Music playlist, using the page's own session.

**Architecture:** `bookmarklet.ts` holds pure, tested helpers plus a `run()` entry that talks to youtube.com's own `youtubei/v1` API from inside the page. `build.ts` strips types, wraps the code as an IIFE, URL-encodes it into a `javascript:` link, and writes the install page `docs/index.html`, which GitHub Pages serves.

**Tech Stack:** Node 22.23 (type stripping, `node:module` `stripTypeScriptTypes`, `node:test`), browser `fetch` + `crypto.subtle`, GitHub Pages via `gh`.

**Spec:** `docs/superpowers/specs/2026-10-20-mix2ytm-bookmarklet-design.md`

## Global Constraints

- Root: `~/my-tools/mix2ytm/`. No npm dependencies. Don't touch `mix2ytm.ts` / `mix2ytm.test.ts`.
- New files only: `bookmarklet.ts`, `bookmarklet.test.ts`, `build.ts`, `fixtures/next.json`, `docs/index.html`, `docs/.nojekyll`. Change `package.json` only to add `"build": "node build.ts"`.
- Only erasable TS syntax. `bookmarklet.ts` must not import anything: it is inlined into a bookmarklet.
- Origin `https://www.youtube.com`. Privacy `PRIVATE`. Result link `https://music.youtube.com/playlist?list=<id>`.
- UI text is Vietnamese and uses the exact strings from the spec's UX/Errors sections. DOM only via `createElement`/`textContent`, never `innerHTML`.
- Paging limits: 100 `next` calls, 1,000 tracks.
- Git: Task 1 runs `git init`; commit after each task. Making the repo public and pushing happen only in Task 5, after the user says yes.

## Review Focus

1. **Real Mix URLs carry extra params** (`&index=12&pp=…&start_radio=1`), and the user may be mid-Mix. Parse them, and start from the current `v`. Test in Task 1.
2. **Clicking again after a finished or failed run** should start a fresh run in the same box. Only clicking during a run is ignored. Ruled in Task 3, checked manually in Task 4.
3. **The Mix response has no title.** The playlist is still created, with the title `YouTube Mix`. Test in Task 1 (`panelItems`) and handled in Task 3.
4. **Vietnamese text survives the `javascript:` encoding.** The decoded build contains `Đang đọc Mix`. Test in Task 3.
5. **Several Google accounts signed in at once.** Use `SESSION_INDEX` and `INNERTUBE_CONTEXT` from `ytcfg` so the playlist lands in the account being viewed. Checked manually in Task 4 if the user has more than one account.

---

### Task 1: Repo, fixture, pure helpers

**Files:**
- Create: `bookmarklet.ts`, `bookmarklet.test.ts`, `fixtures/next.json`, `.gitignore` (`node_modules/`, `.superpowers/`)

**Interfaces:**
- Produces (exported from `bookmarklet.ts`):
  - `type Track = { id: string; title: string }`
  - `type PanelItem = Track & { index: number; params?: string }`
  - `mixIdsFromUrl(href: string): { videoId: string; playlistId: string } | null`
  - `panelItems(response: unknown): { title: string; items: PanelItem[] }`
  - `cookieValue(cookie: string, name: string): string | undefined`
  - `sapisidHash(sapisid: string, ts: number, origin: string): Promise<string>`

- [ ] **Step 1: Initialise the repo.**
  - Run `cd ~/my-tools/mix2ytm && git init -b main`, then write `.gitignore`.
  - Capture the fixture: POST `https://www.youtube.com/youtubei/v1/next?prettyPrint=false` with body `{context:{client:{clientName:'WEB',clientVersion:'2.20251015.01.00',hl:'en'}}, videoId:'0GVExpdmoDs', playlistId:'RD0GVExpdmoDs'}`, no auth.
  - Keep only `contents.twoColumnWatchNextResults.playlist.playlist.{title, contents[].playlistPanelVideoRenderer.{videoId, title, navigationEndpoint.watchEndpoint.{videoId,index,params}}}` and save it to `fixtures/next.json`.
  - Expected: 25 items; the first is `0GVExpdmoDs`.
- [ ] **Step 2: Write the failing tests** in `bookmarklet.test.ts`:
  - `mixIdsFromUrl('https://www.youtube.com/watch?v=0GVExpdmoDs&list=RD0GVExpdmoDs&start_radio=1')` → `{ videoId: '0GVExpdmoDs', playlistId: 'RD0GVExpdmoDs' }`
  - `mixIdsFromUrl('https://www.youtube.com/watch?v=abc&list=RD0GVExpdmoDs&index=12&pp=xyz')` → `{ videoId: 'abc', playlistId: 'RD0GVExpdmoDs' }` *(Review Focus 1)*
  - `mixIdsFromUrl('https://www.youtube.com/watch?v=x')` and `mixIdsFromUrl('https://www.youtube.com/watch?v=x&list=PLabc')` → `null`
  - `panelItems(fixture)`: `title === 'Mix - Maroon 5 - Animals (Lyrics)'`, `items.length === 25`, `items[0]` deep-equals `{ id: '0GVExpdmoDs', title: 'Maroon 5 - Animals (Lyrics)', index: 0, params: 'OAE%3D' }`
  - `panelItems({})` → `{ title: '', items: [] }` *(Review Focus 3)*
  - `cookieValue('a=1; SAPISID=x=y; b=2', 'SAPISID')` → `'x=y'`; `cookieValue('a=1', 'SAPISID')` → `undefined`
  - `await sapisidHash('abc', 1700000000, 'https://www.youtube.com')` → `'SAPISIDHASH 1700000000_' + createHash('sha1').update('1700000000 abc https://www.youtube.com').digest('hex')`
- [ ] **Step 3: Run** `npm test`. Expected: the bookmarklet tests FAIL on missing exports. The CLI's 14 tests still pass.
- [ ] **Step 4: Implement** the four helpers.
  - `mixIdsFromUrl` uses `new URL(href).searchParams` and requires `list` to start with `RD`.
  - `sapisidHash` uses `crypto.subtle.digest('SHA-1', …)` and hex-encodes the result.
- [ ] **Step 5: Run** `npm test`. Expected: all pass.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(bookmarklet): pure helpers"`. This also commits the existing CLI and docs as the first history.

### Task 2: `readMix` paging

**Files:**
- Modify: `bookmarklet.ts`
- Test: `bookmarklet.test.ts`

**Interfaces:**
- Consumes: `panelItems`, `Track`, `PanelItem` (Task 1)
- Produces: `readMix(callNext: (body: { videoId: string; index?: number; params?: string }) => Promise<unknown>, start: { videoId: string }, onProgress?: (count: number) => void): Promise<{ title: string; tracks: Track[] }>`

- [ ] **Step 1: Write the failing tests.** Use a test helper `fakeNext(list, opts)` that builds responses in the fixture's shape. Each call returns the 25-item window that starts **at** the requested `index`, or at 0 on the first call. The window therefore overlaps the previous one by one item, the way YouTube's does.
  - With a 60-item list (`v0…v59`), `readMix` returns those 60 ids in order. It also stops on its own: the last window ends on `lastId`.
  - `onProgress` receives strictly increasing counts, and the last one is ≥ 60.
  - Items titled `[Private video]` and `[Deleted video]` are absent from `tracks`.
  - A fake that never ends (every call returns 25 new ids) makes exactly 100 calls and returns ≤ 1,000 tracks.
  - `title` equals the first response's title.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL (`readMix` is not exported).
- [ ] **Step 3: Implement `readMix`.** Follow the algorithm in the spec's *`bookmarklet.ts`* section, steps 1–4. Then dedupe by id in first-seen order and drop private/deleted entries. `onProgress(collected.length)` runs after each page.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(bookmarklet): read whole Mix via next paging`.

### Task 3: `run()`, the status box, and the build

**Files:**
- Modify: `bookmarklet.ts`, `package.json`
- Create: `build.ts`, `docs/index.html` (generated), `docs/.nojekyll`
- Test: `bookmarklet.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2
- Produces:
  - `precheck(env: { host: string; href: string; loggedIn: unknown; cookie: string }): string | null`. Returns the spec's error message for the first failing check in table order (host, Mix, login, where a missing SAPISID/`__Secure-3PAPISID` cookie counts as not logged in), or `null` when everything passes.
  - `run(): Promise<void>`
  - `buildHref(source: string): string`, exported from `build.ts`

- [ ] **Step 1: Write the failing tests.**
  - `precheck({ host: 'example.github.io', href: 'https://example.github.io/', loggedIn: undefined, cookie: '' })` → starts with `Hãy mở một Mix trên youtube.com`
  - `precheck` on `www.youtube.com` + `watch?v=x` → starts with `Trang này không phải Mix`
  - `precheck` on a Mix URL with `loggedIn: false` → starts with `Bạn chưa đăng nhập YouTube`
  - `precheck` on a Mix URL with `loggedIn: true` and cookie `'a=1'` → starts with `Bạn chưa đăng nhập YouTube`
  - `precheck` on a Mix URL with `loggedIn: true` and cookie `'SAPISID=x'` → `null`
  - `buildHref(readFileSync('bookmarklet.ts','utf8'))` starts with `javascript:`. Its decoded code contains no `export ` and does contain `Đang đọc Mix` *(Review Focus 4)*. `new Function(code)` does not throw.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement `precheck` and `run`** in `bookmarklet.ts`, following the spec's `run()` section.
  - `run` calls `precheck({ host: location.host, href: location.href, loggedIn: ytcfg.get('LOGGED_IN'), cookie: document.cookie })`.
  - It shows the box. Use one `post(ep, body)` helper for both `next` and `playlist/create`.
  - Playlist title: `mix.title || 'YouTube Mix'`.
  - Use `typeof ytcfg !== 'undefined'` guards so the install page doesn't throw.
  - **Ruling for Review Focus 2:** set `window.__mix2ytmRunning` while a run is in progress. A click during a run is ignored. Otherwise reuse the existing box (`#mix2ytm-box`), clear it, and start again.
  - Box style: fixed, `top: 16px; right: 16px`, white background, dark text, `padding: 12px 16px`, `border-radius: 8px`, shadow, `font: 14px system-ui`, `max-width: 320px`, `z-index: 2147483647`, with a ✕ button that removes the box.
- [ ] **Step 4: Implement `build.ts`.**
  - `buildHref(source)`: `stripTypeScriptTypes(source)`, remove `^export ` at the start of lines, wrap as `(()=>{<code>;run()})()`, return `'javascript:' + encodeURIComponent(…)`.
  - When `build.ts` is run directly (realpath guard, as in `mix2ytm.ts`), it writes `docs/index.html` and `docs/.nojekyll`. The install page has:
    - Vietnamese title `Mix → YT Music`
    - the 3 steps and the privacy note from the spec
    - one big draggable `<a>` button, whose href is attribute-escaped (`&` → `&amp;`, `"` → `&quot;`)
    - one line: `Chỉ dùng trên máy tính (Chrome, Edge, Firefox, Safari).`
  - Add `"build": "node build.ts"` to `package.json`.
- [ ] **Step 5: Run** `npm test && npm run build`. Expected: all tests pass, and `docs/index.html` exists and contains `href="javascript:`.
- [ ] **Step 6: Commit** `feat(bookmarklet): run(), status box, install page build`.

### Task 4: Real run in the user's browser

**Files:** none, unless the fallback below is needed (`bookmarklet.ts`, test).

- [ ] **Step 1:** Open the built `docs/index.html` for the user: `open docs/index.html`. Ask the user to drag the button to the bookmarks bar, replacing the earlier `test` bookmark.
- [ ] **Step 2:** The user clicks the button on the install page. Expected: the box shows the "Hãy mở một Mix…" message.
- [ ] **Step 3:** The user clicks it on a non-Mix YouTube video. Expected: "Trang này không phải Mix…".
- [ ] **Step 4:** The user opens the example Mix and clicks. Expected:
  - The box counts up to about 438, then shows `✅ Đã tạo playlist N bài` with a link.
  - The link opens a YT Music playlist with N tracks. Verify the count with the user.
  - Clicking again after it finishes starts a new run *(Review Focus 2)*.
- [ ] **Step 5 (only if `create` fails with the full list):** Add the chunked `browse/edit_playlist` fallback exactly as the spec's *Testing → Manual checks 2* describes, with a test using a fake `post`. Rebuild and repeat Step 4.
- [ ] **Step 6:** Commit any fix. Don't delete the playlists the test runs created; list them for the user, who decides.

### Task 5: Publish on GitHub Pages

**Files:** none

- [ ] **Step 1: Ask the user** to confirm making a **public** repo `mix2ytm` on their GitHub account. Everything in `mix2ytm/` becomes public, including the CLI and `docs/superpowers`.
- [ ] **Step 2:** Only after yes:
  - `gh repo create mix2ytm --public --source . --push`
  - `gh api -X POST repos/{owner}/mix2ytm/pages -f 'source[branch]=main' -f 'source[path]=/docs'`
- [ ] **Step 3:** Poll `gh api repos/{owner}/mix2ytm/pages --jq .status` until it shows `built` (a few minutes). Then open `https://<owner>.github.io/mix2ytm/` and check that the button is there. Give the user the link.
