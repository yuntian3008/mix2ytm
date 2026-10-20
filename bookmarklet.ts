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

const ORIGIN = 'https://www.youtube.com'
const MSG = {
  notYoutube: 'Hãy mở một Mix trên youtube.com rồi bấm lại. (Nếu bạn đang ở trang cài đặt: kéo nút lên thanh dấu trang, đừng bấm.)',
  notMix: 'Trang này không phải Mix. Mở một video có danh sách "Mix" rồi bấm lại.',
  signedOut: 'Bạn chưa đăng nhập YouTube. Đăng nhập rồi bấm lại.',
  failed: 'Không tạo được playlist. Tải lại trang rồi thử lại.',
}

export function precheck(env: { host: string; href: string; loggedIn: unknown; cookie: string }): string | null {
  if (env.host !== 'www.youtube.com') return MSG.notYoutube
  if (!mixIdsFromUrl(env.href)) return MSG.notMix
  if (env.loggedIn !== true || !(cookieValue(env.cookie, 'SAPISID') ?? cookieValue(env.cookie, '__Secure-3PAPISID'))) {
    return MSG.signedOut
  }
  return null
}

type Ytcfg = { get(key: string): any }

export async function apiHeaders(cfg: Ytcfg, sapisid: string, ts: number): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: await sapisidHash(sapisid, ts, ORIGIN),
    'X-Goog-AuthUser': String(cfg.get('SESSION_INDEX') ?? 0),
    'X-Goog-Visitor-Id': cfg.get('VISITOR_DATA') ?? '',
    'X-Origin': ORIGIN,
    'Content-Type': 'application/json',
  }
  // Brand-account channel: without this the playlist lands in the main channel.
  const pageId = cfg.get('DELEGATED_SESSION_ID')
  if (pageId) headers['X-Goog-PageId'] = String(pageId)
  return headers
}

// Status box in the page corner. textContent/createElement only: YouTube enforces Trusted Types.
export function statusBox() {
  let box = document.getElementById('mix2ytm-box')
  if (!box) {
    box = document.createElement('div')
    box.id = 'mix2ytm-box'
    box.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:2147483647;background:#fff;color:#111;padding:12px 16px;' +
      'border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.25);font:14px system-ui,sans-serif;max-width:320px'
    document.body.append(box)
  }
  const el = box
  return (text: string, link?: string) => {
    // Closed with ✕ mid-run: bring it back so the result link isn't lost.
    if (!el.isConnected) document.body.append(el)
    const close = document.createElement('button')
    close.textContent = '✕'
    close.style.cssText = 'float:right;margin-left:12px;border:0;background:none;cursor:pointer;font-size:14px;color:#666'
    close.onclick = () => el.remove()
    const msg = document.createElement('div')
    msg.textContent = text
    el.replaceChildren(close, msg)
    if (link) {
      const a = document.createElement('a')
      a.href = link
      a.target = '_blank'
      a.textContent = 'Mở trong YouTube Music'
      a.style.cssText = 'display:inline-block;margin-top:8px;color:#c00;font-weight:600'
      el.append(a)
    }
  }
}

export async function run(): Promise<void> {
  const w = window as any
  if (w.__mix2ytmRunning) return
  const show = statusBox()
  const cfg = w.ytcfg
  const error = precheck({
    host: location.host,
    href: location.href,
    loggedIn: cfg?.get?.('LOGGED_IN'),
    cookie: document.cookie,
  })
  if (error) return show(error)
  w.__mix2ytmRunning = true
  try {
    const { videoId, playlistId } = mixIdsFromUrl(location.href)!
    const context = cfg.get('INNERTUBE_CONTEXT')
    const sapisid = (cookieValue(document.cookie, 'SAPISID') ?? cookieValue(document.cookie, '__Secure-3PAPISID'))!
    const post = async (ep: string, body: object) => {
      const res = await fetch(`/youtubei/v1/${ep}?prettyPrint=false`, {
        method: 'POST',
        credentials: 'include',
        headers: await apiHeaders(cfg, sapisid, Math.floor(Date.now() / 1000)),
        body: JSON.stringify({ context, ...body }),
      })
      if (!res.ok) throw new Error(`YouTube báo lỗi (HTTP ${res.status}). Tải lại trang rồi thử lại.`)
      return res.json()
    }
    show('Đang đọc Mix…')
    const mix = await readMix((b) => post('next', { playlistId, ...b }), { videoId }, (n) => show(`Đang đọc Mix… ${n} bài`))
    if (!mix.tracks.length) return show(MSG.failed)
    show(`Đang tạo playlist ${mix.tracks.length} bài…`)
    const created = await post('playlist/create', {
      title: mix.title || 'YouTube Mix',
      privacyStatus: 'PRIVATE',
      videoIds: mix.tracks.map((t) => t.id),
    })
    if (!created?.playlistId) return show(MSG.failed)
    show(`✅ Đã tạo playlist ${mix.tracks.length} bài`, `https://music.youtube.com/playlist?list=${created.playlistId}`)
  } catch (err) {
    show((err as Error).message.startsWith('YouTube báo lỗi') ? (err as Error).message : MSG.failed)
  } finally {
    w.__mix2ytmRunning = false
  }
}
