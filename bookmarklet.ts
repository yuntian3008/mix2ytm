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
