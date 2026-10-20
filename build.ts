import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'

export function buildHref(source: string): string {
  const code = stripTypeScriptTypes(source).replace(/^export /gm, '')
  return 'javascript:' + encodeURIComponent(`(()=>{${code};run()})()`)
}

const attr = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

const page = (href: string) => `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mix → YT Music</title>
<style>
  :root { --bg: #fafafa; --fg: #111; --muted: #555; --card: #fff; --accent: #c00; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121212; --fg: #eee; --muted: #aaa; --card: #1e1e1e; --accent: #ff4e45; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.6 system-ui, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 48px 16px; }
  h1 { font-size: 32px; margin: 0 0 8px; }
  .lead { color: var(--muted); margin: 0 0 32px; }
  .button { display: inline-block; padding: 14px 28px; border-radius: 999px; background: var(--accent); color: #fff;
            font-weight: 700; font-size: 20px; text-decoration: none; cursor: grab; }
  ol { padding-left: 24px; } li { margin: 12px 0; }
  kbd { background: var(--card); border: 1px solid var(--muted); border-radius: 4px; padding: 1px 6px; font-size: 15px; }
  .note { background: var(--card); border-radius: 8px; padding: 12px 16px; color: var(--muted); font-size: 15px; margin-top: 32px; }
</style>
</head>
<body>
<main>
  <h1>Mix → YT Music</h1>
  <p class="lead">Lưu một Mix trên YouTube thành playlist trong YouTube Music của bạn, chỉ với một cú bấm.</p>
  <p><a class="button" href="${attr(href)}">Mix → YT Music</a></p>
  <ol>
    <li>Hiện thanh dấu trang: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> (Windows) hoặc <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> (Mac).</li>
    <li>Kéo nút đỏ <b>Mix → YT Music</b> ở trên thả vào thanh dấu trang.</li>
    <li>Mở một Mix bất kỳ trên youtube.com (video có danh sách phát ghi "Mix") rồi bấm vào dấu trang vừa thêm.</li>
  </ol>
  <p class="note">Chạy ngay trong trình duyệt của bạn, chỉ gọi tới YouTube, không gửi dữ liệu đi đâu khác. Playlist được tạo ở chế độ riêng tư.<br>
  Chỉ dùng trên máy tính (Chrome, Edge, Firefox, Safari).</p>
</main>
</body>
</html>
`

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL('./docs/', import.meta.url)
  mkdirSync(dir, { recursive: true })
  writeFileSync(new URL('index.html', dir), page(buildHref(readFileSync(new URL('./bookmarklet.ts', import.meta.url), 'utf8'))))
  writeFileSync(new URL('.nojekyll', dir), '')
  console.log('wrote docs/index.html')
}
