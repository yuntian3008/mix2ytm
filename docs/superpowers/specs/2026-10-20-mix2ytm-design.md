# mix2ytm — YouTube Mix → YouTube Music playlist

Date: 2026-10-20

## Goal

A terminal CLI that takes a YouTube Mix link (e.g.
`https://www.youtube.com/watch?v=0GVExpdmoDs&list=RD0GVExpdmoDs&start_radio=1`)
and saves its videos as a **private playlist in the user's YouTube Music library**.

Success: one command prints a `https://music.youtube.com/playlist?list=…` link whose
tracks are all videos of the Mix (or the first `--limit`), in the same order.

## Decisions

- **Language/runtime:** TypeScript, run directly by Node 22 (built-in type stripping).
  No build step, no npm dependencies (`fetch`, `node:crypto`, `node:util` `parseArgs`,
  `node:child_process`).
- **Tracks:** use the Mix's original video IDs as-is. No search for official songs.
  Videos appear in YT Music as the original (often lyric/re-upload) videos.
- **Reading the Mix:** shell out to `yt-dlp` (already installed at `/opt/homebrew/bin/yt-dlp`).
  yt-dlp pages through the whole Mix until it ends (the example returns 437 items); all are
  taken by default, `--limit N` keeps only the first N.
- **Writing to YT Music:** YT Music's internal API (`youtubei/v1`) authenticated with the
  user's browser cookie. Unofficial; may break if Google changes it.

## Usage

```
mix2ytm <youtube-url> [--limit N] [--title "..."] [--dry-run]
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--limit` | none (all) | Take only the first N videos |
| `--title` | Mix title from yt-dlp (e.g. `Mix - Maroon 5 - Animals (Lyrics)`) | Playlist name |
| `--dry-run` | off | Print the track list, do not create a playlist |

One-time setup: open music.youtube.com while signed in → DevTools → Network → any
`youtubei` request → copy the `Cookie` request header value into
`~/.config/mix2ytm/cookie` (single line).

Install: `cd ~/my-tools/mix2ytm && npm link` → `mix2ytm` on PATH. Node refuses to strip
types for files under `node_modules`; `npm link` symlinks, and Node runs the main script by
its real path (`~/my-tools/…`), so it works. Verify this during implementation; if it fails,
use a shell alias `alias mix2ytm='node ~/my-tools/mix2ytm/mix2ytm.ts'` instead.

## Files

```
mix2ytm/
  package.json        # name, "type": "module", bin: { "mix2ytm": "./mix2ytm.ts" }, scripts.test
  mix2ytm.ts          # whole CLI (shebang: #!/usr/bin/env node)
  mix2ytm.test.ts     # node --test
```

## Flow (`mix2ytm.ts`)

1. **Parse args** with `parseArgs`. Missing URL → print usage, exit 1.
2. **Read Mix:** `execFileSync('yt-dlp', ['--flat-playlist', '-J', url])`, adding
   `['--playlist-end', N]` only when `--limit` is given (raise `maxBuffer`: ~437 entries of JSON),
   `JSON.parse` → `title` and `entries[].id` / `entries[].title`. Drop duplicate IDs, keep order.
   Print `i. <video title>` per track.
3. If `--dry-run` → stop here.
4. **Auth:** read `~/.config/mix2ytm/cookie`; extract `SAPISID` (fallback `__Secure-3PAPISID`).
   Header `Authorization: SAPISIDHASH <ts>_<sha1("<ts> <sapisid> https://music.youtube.com")>`,
   with `ts` = unix seconds.
5. **Create playlist:** `POST https://music.youtube.com/youtubei/v1/playlist/create?prettyPrint=false`
   - Headers: `Authorization`, `Cookie`, `Origin`/`X-Origin: https://music.youtube.com`,
     `Content-Type: application/json`, a desktop `User-Agent`.
   - Body:
     ```json
     {
       "context": { "client": { "clientName": "WEB_REMIX", "clientVersion": "1.<YYYYMMDD>.01.00", "hl": "en" } },
       "title": "<title>",
       "description": "Converted from <url>",
       "privacyStatus": "PRIVATE",
       "videoIds": ["…"]
     }
     ```
   - Response `playlistId` → print `https://music.youtube.com/playlist?list=<playlistId>`.
   - All IDs go in this one call (YT Music playlists hold up to 5,000 items).
     *Verified 2026-10-20: one call with 438 IDs created a 438-track playlist; no fallback needed.
     YT Music also swaps lyric/re-upload videos for the official song when one exists.* Implementation must
     verify this with the full 437-item example; if `create` rejects a list that large, switch to:
     create with the first 100, then add the rest in chunks of 100 via
     `POST youtubei/v1/browse/edit_playlist` (`actions: [{action: "ACTION_ADD_VIDEO", addedVideoId}]`).

Exported pure helpers (for the test): `sapisidFromCookie(cookie)`, `authHeader(sapisid, ts)`.

## Errors

| Case | Behaviour |
|------|-----------|
| `yt-dlp` not found (ENOENT) | `yt-dlp not found — brew install yt-dlp`, exit 1 |
| yt-dlp fails / 0 entries | Show yt-dlp stderr / `No videos found in this link`, exit 1 |
| Cookie file missing | Print the one-time setup steps above, exit 1 |
| Cookie has no `SAPISID` / `__Secure-3PAPISID` | `Cookie is missing SAPISID — copy it again`, exit 1 |
| HTTP 401/403 | `Cookie expired or invalid — copy it again`, exit 1 |
| Other HTTP error / no `playlistId` | Print status + response body, exit 1 |

No retries: a failed run creates nothing, so the user simply re-runs.

## Testing

- `mix2ytm.test.ts` (`node --test`):
  - `sapisidFromCookie` picks `SAPISID`, falls back to `__Secure-3PAPISID`, returns
    `undefined` when neither exists.
  - `authHeader('abc', 1700000000)` equals `SAPISIDHASH 1700000000_` + the SHA-1 hex of
    `1700000000 abc https://music.youtube.com`, computed independently in the test.
- Manual: `mix2ytm '<example url>' --dry-run` lists all tracks (~437); `--limit 5 --dry-run`
  lists 5; then a real run creates the playlist and the link opens in YT Music with every track.

## Out of scope

Searching official songs, updating an existing playlist, Brand Account / multi-account
(`X-Goog-AuthUser`), reading cookies from the browser automatically, a Raycast command.
