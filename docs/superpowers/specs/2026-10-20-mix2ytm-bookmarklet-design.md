# mix2ytm bookmarklet — shareable, no-cookie version

Date: 2026-10-20 · Extends `2026-10-20-mix2ytm-design.md` (the CLI stays as is).

## Goal

Non-technical people on a computer can save a YouTube Mix as a private playlist in their
YouTube Music library **without cookies, installs, servers or quotas**.

Success: a friend opens a shared link, drags one button to the bookmarks bar, opens a Mix on
youtube.com, clicks the bookmark, and gets a "Mở trong YouTube Music" link to a playlist with
every track of the Mix (~438 for the example Mix).

## Decisions (agreed)

- **Bookmarklet**, run by the user on a youtube.com Mix page. It uses the page's own
  signed-in session: no cookie copying, nothing leaves the browser except YouTube's own API calls.
- Chosen over "web page + Google sign-in" because the YouTube Data API quota
  (10,000 units/day shared by all users, 50 per inserted track) can't fit even one 438-track Mix.
- Computer only (Chrome/Edge/Firefox/Safari). Phones out of scope.
- Shared via a **GitHub Pages** install page.
- UI text is Vietnamese.

## Verified before this spec

- A bookmarklet runs on youtube.com and sees `ytcfg` (`typeof ytcfg === 'object'`,
  `ytcfg.get('LOGGED_IN') === true`), so Trusted Types/CSP don't block it.
- Paging `POST /youtubei/v1/next` the way yt-dlp does, with a stable visitor ID, returns the full
  example Mix: 20 calls, about 13 s, 438 unique tracks. Without a stable visitor ID the Mix regenerates on
  every call and never ends.
- Response shape: `contents.twoColumnWatchNextResults.playlist.playlist` has `title` and
  `contents[].playlistPanelVideoRenderer` with `videoId`, `title.simpleText` and
  `navigationEndpoint.watchEndpoint.{videoId,index,params}`. Each call returns a window of 25.

## User experience

**Install page** (`docs/index.html`, Vietnamese), served by GitHub Pages:
1. Show the bookmarks bar: `Ctrl+Shift+B` (Windows) / `Cmd+Shift+B` (Mac).
2. Drag the big **"Mix → YT Music"** button onto the bar.
3. Open any Mix on youtube.com (a video whose playlist panel says "Mix") and click the bookmark.

Plus a short note: "Chạy ngay trong trình duyệt của bạn, chỉ gọi tới YouTube, không gửi dữ liệu
đi đâu khác. Playlist được tạo ở chế độ riêng tư." Text only, no screenshots.

**On click**, a fixed box in the top-right corner of the page (`z-index: 2147483647`, ✕ to close)
shows these messages:
- `Đang đọc Mix… 125 bài`, updated on every page of results
- `Đang tạo playlist 438 bài…`
- `✅ Đã tạo playlist 438 bài` plus the link **Mở trong YouTube Music** →
  `https://music.youtube.com/playlist?list=<id>` (opens in a new tab)

Clicking again while the box exists reuses the box and does not start a second run. The box is
built with `createElement` and `textContent` only, never `innerHTML`, because of Trusted Types.

**Errors** (shown in the same box, then stop):

| Condition | Message |
|-----------|---------|
| Not on `www.youtube.com` (including clicking the button on the install page) | `Hãy mở một Mix trên youtube.com rồi bấm lại. (Nếu bạn đang ở trang cài đặt: kéo nút lên thanh dấu trang, đừng bấm.)` |
| URL has no `list=RD…` | `Trang này không phải Mix. Mở một video có danh sách "Mix" rồi bấm lại.` |
| `ytcfg.get('LOGGED_IN')` is not `true` | `Bạn chưa đăng nhập YouTube. Đăng nhập rồi bấm lại.` |
| Any non-2xx response | `YouTube báo lỗi (HTTP <status>). Tải lại trang rồi thử lại.` |
| `create` response has no `playlistId`, or the Mix has 0 usable tracks | `Không tạo được playlist. Tải lại trang rồi thử lại.` |

## Code

All under `~/my-tools/mix2ytm/`. No npm dependencies. The CLI files are untouched.

```
bookmarklet.ts        # source: exported pure helpers + run()
bookmarklet.test.ts   # node --test
build.ts              # bookmarklet.ts → javascript: URL → docs/index.html
docs/index.html       # generated install page (committed, served by Pages)
docs/.nojekyll        # serve files as-is
fixtures/next.json    # trimmed real /next response for tests
```

### `bookmarklet.ts`

Exports:

```ts
type Track = { id: string; title: string }
type PanelItem = Track & { index: number; params?: string }

mixIdsFromUrl(href: string): { videoId: string; playlistId: string } | null
  // needs v= and list= starting with "RD"; otherwise null
panelItems(response: unknown): { title: string; items: PanelItem[] }
  // missing playlist → { title: '', items: [] }
readMix(
  callNext: (body: { videoId: string; index?: number; params?: string }) => Promise<unknown>,
  start: { videoId: string },
  onProgress?: (count: number) => void,
): Promise<{ title: string; tracks: Track[] }>
cookieValue(cookie: string, name: string): string | undefined
sapisidHash(sapisid: string, ts: number, origin: string): Promise<string>
  // "SAPISIDHASH <ts>_<sha1 hex of `${ts} ${sapisid} ${origin}`>" via crypto.subtle
run(): Promise<void>   // the bookmarklet entry; never called on import
```

`readMix` uses yt-dlp's `_extract_inline_playlist` algorithm:
1. `items = panelItems(await callNext({ videoId }))`, with `lastId = null`.
2. `start` = (position of `lastId` in `items`) + 1. If `start >= items.length`, stop.
3. Collect `items[start..]`. Set `lastId` to the last item's id. Then call `callNext` with that
   item's `{ videoId, index, params }` and loop.
4. Hard stop after 100 calls or 1,000 collected tracks.

Collected tracks are then deduped by id (keeping first-seen order), and entries titled
`[Private video]` / `[Deleted video]` are dropped. `title` is taken from the first response.

`run()`:
- Applies the error checks above in table order.
- Reads from `ytcfg`: `INNERTUBE_CONTEXT`, `SESSION_INDEX` (defaults to `0`), `VISITOR_DATA`.
- SAPISID comes from `document.cookie`: `SAPISID`, falling back to `__Secure-3PAPISID`.
  Neither present is treated as "not logged in".
- All requests: `fetch(\`/youtubei/v1/<ep>?prettyPrint=false\`, { method: 'POST', credentials: 'include' })`
  with these headers:
  - `Authorization: await sapisidHash(sapisid, now, 'https://www.youtube.com')`
  - `X-Goog-AuthUser: SESSION_INDEX`
  - `X-Goog-Visitor-Id: VISITOR_DATA`
  - `X-Origin: https://www.youtube.com`
  - `Content-Type: application/json`
- `next` body: `{ context: INNERTUBE_CONTEXT, playlistId, videoId, index?, params? }`.
- `playlist/create` body: `{ context: INNERTUBE_CONTEXT, title: <Mix title>, privacyStatus: 'PRIVATE', videoIds }`.
  The response gives `playlistId`. There is no description field, because the YouTube web
  client doesn't send one.

### `build.ts`

1. Read `bookmarklet.ts` and run `stripTypeScriptTypes` (from `node:module`).
2. Remove the `export ` keywords and wrap the result as `(()=>{ <code>; run() })()`.
3. Build `href = 'javascript:' + encodeURIComponent(code)`.
4. Write `docs/index.html` from a template string inside `build.ts`. The href is HTML-escaped into
   the button's `href` attribute.
5. Write `docs/.nojekyll`.

Run with `node build.ts`. Add `"build": "node build.ts"` to `package.json`.

## Publishing

- Run `git init` in `mix2ytm/`.
- Create a **public** GitHub repo `mix2ytm` with `gh`, then enable Pages from `main` / `docs`.
  The share link is `https://<user>.github.io/mix2ytm/`.
- Making the repo public and pushing are outward-facing, so ask the user right before doing them.

## Testing

`bookmarklet.test.ts` (`npm test` also picks up `mix2ytm.test.ts`):
- `mixIdsFromUrl`:
  - The example URL gives `{ videoId: '0GVExpdmoDs', playlistId: 'RD0GVExpdmoDs' }`.
  - `watch?v=x` (no list) gives `null`.
  - `list=PL…` gives `null`.
- `panelItems(fixture)` gives a title of `Mix - Maroon 5 - Animals (Lyrics)`, 25 items, and the first
  item is `{ id: '0GVExpdmoDs', title: 'Maroon 5 - Animals (Lyrics)', index: 0, params: 'OAE%3D' }`.
- `readMix` with a fake `callNext` serving sliding windows over a 60-item list:
  - It returns all 60 tracks in order.
  - The windows overlap, so it must dedupe.
  - It stops when the last window ends on `lastId`.
  - `onProgress` is called with increasing counts.
- `readMix` drops `[Private video]` / `[Deleted video]` entries.
- `readMix` stops after 100 calls against a fake that never ends.
- `cookieValue('a=1; SAPISID=x=y; b=2', 'SAPISID')` gives `'x=y'`.
- `sapisidHash('abc', 1700000000, 'https://www.youtube.com')` equals the `node:crypto` SHA-1 version.
- The built `href` starts with `javascript:`, and its decoded code contains no `export `.
  `new Function(code)` does not throw.

Manual checks:
1. Run `node build.ts`, open `docs/index.html` locally, and drag the button to the bar.
2. On the example Mix, click it. The playlist should have the same track count as the box reported.
   This also verifies that web `playlist/create` accepts about 438 IDs; the CLI verified that only on `WEB_REMIX`.
   If it rejects the large list: create with the first 100 IDs, then add the rest in chunks of 100 via
   `POST /youtubei/v1/browse/edit_playlist` (`{ context, playlistId, actions: ids.map(id => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: id })) }`).
   A failed chunk shows the partial link plus how many tracks were added.
3. Click it on a non-Mix page and on the install page. Both should show the right error message.

## Out of scope

Phones, a browser extension, choosing how many tracks, updating an existing playlist,
screenshots on the install page, English UI.
