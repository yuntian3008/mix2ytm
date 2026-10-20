// Bookmarklet source: build.ts inlines this file into a javascript: link, so no imports.

export type Track = { id: string; title: string }
export type PanelItem = Track & { index: number; params?: string }

export function mixIdsFromUrl(href: string): { videoId: string; playlistId: string } | null {
  const params = new URL(href).searchParams
  const videoId = params.get('v')
  const playlistId = params.get('list')
  if (!videoId || !playlistId?.startsWith('RD')) return null
  return { videoId, playlistId }
}

export function panelItems(response: any): { title: string; items: PanelItem[] } {
  const playlist = response?.contents?.twoColumnWatchNextResults?.playlist?.playlist
  const items: PanelItem[] = []
  for (const c of playlist?.contents ?? []) {
    const v = c.playlistPanelVideoRenderer
    if (!v?.videoId) continue
    const w = v.navigationEndpoint?.watchEndpoint ?? {}
    items.push({ id: v.videoId, title: v.title?.simpleText ?? '', index: w.index, params: w.params })
  }
  return { title: playlist?.title ?? '', items }
}

export function cookieValue(cookie: string, name: string): string | undefined {
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
}

export async function sapisidHash(sapisid: string, ts: number, origin: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} ${origin}`))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `SAPISIDHASH ${ts}_${hex}`
}

const MAX_CALLS = 100
const MAX_TRACKS = 1000

// Same paging as yt-dlp's _extract_inline_playlist: ask for the window after the last item seen,
// stop when a window ends on that item (the Mix is over).
export async function readMix(
  callNext: (body: { videoId: string; index?: number; params?: string }) => Promise<unknown>,
  start: { videoId: string },
  onProgress?: (count: number) => void,
): Promise<{ title: string; tracks: Track[] }> {
  let page = panelItems(await callNext({ videoId: start.videoId }))
  const title = page.title
  const collected: PanelItem[] = []
  let lastId: string | null = null
  for (let calls = 1; ; calls++) {
    const from = page.items.findIndex((v) => v.id === lastId) + 1
    if (from >= page.items.length) break
    collected.push(...page.items.slice(from))
    onProgress?.(collected.length)
    if (calls >= MAX_CALLS || collected.length >= MAX_TRACKS) break
    const last = page.items[page.items.length - 1]
    lastId = last.id
    page = panelItems(await callNext({ videoId: last.id, index: last.index, params: last.params }))
  }
  const seen = new Set<string>()
  const tracks: Track[] = []
  for (const { id, title } of collected) {
    if (seen.has(id) || title === '[Private video]' || title === '[Deleted video]') continue
    seen.add(id)
    tracks.push({ id, title })
  }
  return { title, tracks: tracks.slice(0, MAX_TRACKS) }
}
