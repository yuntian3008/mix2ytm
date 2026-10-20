#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ORIGIN = 'https://music.youtube.com'

// Accepts the header value as pasted from DevTools: "Cookie:" prefix, line breaks.
function cleanCookie(cookie: string): string {
  return cookie.trim().replace(/^cookie:\s*/i, '').replace(/\s*\n\s*/g, ' ')
}

export function sapisidFromCookie(cookie: string): string | undefined {
  const pairs = new Map(
    cleanCookie(cookie).split(';').map((p) => {
      const [k, ...v] = p.trim().split('=')
      return [k, v.join('=')] as [string, string]
    }),
  )
  return pairs.get('SAPISID') ?? pairs.get('__Secure-3PAPISID')
}

export function authHeader(sapisid: string, ts: number): string {
  const hash = createHash('sha1').update(`${ts} ${sapisid} ${ORIGIN}`).digest('hex')
  return `SAPISIDHASH ${ts}_${hash}`
}

const USAGE = 'Usage: mix2ytm <youtube-url> [--limit N] [--title "..."] [--dry-run]'

export type Track = { id: string; title: string }

export function parseCli(argv: string[]): { url: string; limit?: number; title?: string; dryRun: boolean } {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { limit: { type: 'string' }, title: { type: 'string' }, 'dry-run': { type: 'boolean' } },
    })
  } catch (err) {
    throw new Error(`${(err as Error).message}\n${USAGE}`)
  }
  const { values, positionals } = parsed
  if (positionals.length !== 1) throw new Error(USAGE)
  if (values.limit !== undefined && !(/^\d+$/.test(values.limit) && Number(values.limit) > 0)) {
    throw new Error(`--limit must be a positive number\n${USAGE}`)
  }
  return {
    url: positionals[0],
    limit: values.limit === undefined ? undefined : Number(values.limit),
    title: values.title,
    dryRun: values['dry-run'] ?? false,
  }
}

export function parseMix(json: string): { title: string; tracks: Track[] } {
  const data = JSON.parse(json) as { title: string; entries?: Track[] }
  const seen = new Set<string>()
  const tracks: Track[] = []
  for (const { id, title } of data.entries ?? []) {
    if (title === '[Private video]' || title === '[Deleted video]') {
      console.error(`skip ${id}: ${title}`)
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    tracks.push({ id, title })
  }
  if (tracks.length === 0) throw new Error('No videos found in this link')
  return { title: data.title, tracks }
}

export function readMix(url: string, limit?: number): { title: string; tracks: Track[] } {
  const args = ['--flat-playlist', '-J', ...(limit ? ['--playlist-end', String(limit)] : []), url]
  let out: string
  try {
    out = execFileSync('yt-dlp', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string }
    if (e.code === 'ENOENT') throw new Error('yt-dlp not found — brew install yt-dlp')
    throw new Error(`yt-dlp failed:\n${e.stderr?.trim() || e.message}`)
  }
  return parseMix(out)
}

const COOKIE_PATH = join(homedir(), '.config/mix2ytm/cookie')
const SETUP = `No cookie at ${COOKIE_PATH}. One-time setup:
  1. Open https://music.youtube.com signed in
  2. DevTools → Network → click any "youtubei" request
  3. Copy the "Cookie" request header value
  4. pbpaste > ${COOKIE_PATH}   (after: mkdir -p ~/.config/mix2ytm)`

export function requestHeaders(cookie: string, ts: number): Record<string, string> {
  const sapisid = sapisidFromCookie(cookie)
  if (!sapisid) throw new Error('Cookie is missing SAPISID — copy it again')
  return {
    Authorization: authHeader(sapisid, ts),
    Cookie: cleanCookie(cookie),
    Origin: ORIGIN,
    'X-Origin': ORIGIN,
    'X-Goog-AuthUser': '0',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  }
}

export async function createPlaylist(cookie: string, title: string, description: string, videoIds: string[]): Promise<string> {
  const headers = requestHeaders(cookie, Math.floor(Date.now() / 1000))
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const res = await fetch(`${ORIGIN}/youtubei/v1/playlist/create?prettyPrint=false`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      context: { client: { clientName: 'WEB_REMIX', clientVersion: `1.${today}.01.00`, hl: 'en' } },
      title,
      description,
      privacyStatus: 'PRIVATE',
      videoIds,
    }),
  })
  const body = await res.text()
  if (res.status === 401 || res.status === 403) throw new Error('Cookie expired or invalid — copy it again')
  const playlistId = res.ok ? (JSON.parse(body) as { playlistId?: string }).playlistId : undefined
  if (!playlistId) throw new Error(`Create playlist failed (HTTP ${res.status}):\n${body}`)
  return playlistId
}

async function main() {
  try {
    const cli = parseCli(process.argv.slice(2))
    const mix = readMix(cli.url, cli.limit)
    mix.tracks.forEach((t, i) => console.log(`${i + 1}. ${t.title}`))
    console.log(`${mix.tracks.length} tracks`)
    if (cli.dryRun) return
    let cookie: string
    try {
      cookie = readFileSync(COOKIE_PATH, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(SETUP)
      throw err
    }
    const id = await createPlaylist(cookie, cli.title ?? mix.title, `Converted from ${cli.url}`, mix.tracks.map((t) => t.id))
    console.log(`${ORIGIN}/playlist?list=${id}`)
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
