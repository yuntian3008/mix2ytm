import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mixIdsFromUrl, panelItems, cookieValue, sapisidHash, readMix } from './bookmarklet.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/next.json', import.meta.url), 'utf8'))

test('mixIdsFromUrl reads a Mix URL', () => {
  assert.deepEqual(mixIdsFromUrl('https://www.youtube.com/watch?v=0GVExpdmoDs&list=RD0GVExpdmoDs&start_radio=1'), {
    videoId: '0GVExpdmoDs', playlistId: 'RD0GVExpdmoDs',
  })
})

test('mixIdsFromUrl starts from the current video mid-Mix', () => {
  assert.deepEqual(mixIdsFromUrl('https://www.youtube.com/watch?v=abc&list=RD0GVExpdmoDs&index=12&pp=xyz'), {
    videoId: 'abc', playlistId: 'RD0GVExpdmoDs',
  })
})

test('mixIdsFromUrl rejects non-Mix URLs', () => {
  assert.equal(mixIdsFromUrl('https://www.youtube.com/watch?v=x'), null)
  assert.equal(mixIdsFromUrl('https://www.youtube.com/watch?v=x&list=PLabc'), null)
})

test('panelItems reads the playlist panel', () => {
  const { title, items } = panelItems(fixture)
  assert.equal(title, 'Mix - Maroon 5 - Animals (Lyrics)')
  assert.equal(items.length, 25)
  assert.deepEqual(items[0], { id: '0GVExpdmoDs', title: 'Maroon 5 - Animals (Lyrics)', index: 0, params: 'OAE%3D' })
})

test('panelItems tolerates a response without a playlist', () => {
  assert.deepEqual(panelItems({}), { title: '', items: [] })
})

test('cookieValue finds a cookie whose value contains "="', () => {
  assert.equal(cookieValue('a=1; SAPISID=x=y; b=2', 'SAPISID'), 'x=y')
  assert.equal(cookieValue('a=1', 'SAPISID'), undefined)
})

test('sapisidHash matches SHA-1 of "ts sapisid origin"', async () => {
  const hash = createHash('sha1').update('1700000000 abc https://www.youtube.com').digest('hex')
  assert.equal(await sapisidHash('abc', 1700000000, 'https://www.youtube.com'), `SAPISIDHASH 1700000000_${hash}`)
})

// Serves 25-item windows starting AT the requested index (overlapping the previous window by one), like YouTube.
function fakeNext(list: { id: string; title: string }[], title = 'Mix - Test') {
  const calls: unknown[] = []
  const callNext = async (body: { videoId: string; index?: number }) => {
    calls.push(body)
    const start = body.index ?? 0
    const contents = list.slice(start, start + 25).map((t, i) => ({
      playlistPanelVideoRenderer: {
        videoId: t.id, title: { simpleText: t.title },
        navigationEndpoint: { watchEndpoint: { videoId: t.id, index: start + i, params: 'OAE%3D' } },
      },
    }))
    return { contents: { twoColumnWatchNextResults: { playlist: { playlist: { title, contents } } } } }
  }
  return { callNext, calls }
}
const tracks = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${i}`, title: `T${i}` }))

test('readMix pages through the whole Mix in order and stops at the end', async () => {
  const { callNext } = fakeNext(tracks(60))
  const mix = await readMix(callNext, { videoId: 'v0' })
  assert.deepEqual(mix.tracks.map((t) => t.id), tracks(60).map((t) => t.id))
  assert.equal(mix.title, 'Mix - Test')
})

test('readMix reports increasing progress', async () => {
  const seen: number[] = []
  await readMix(fakeNext(tracks(60)).callNext, { videoId: 'v0' }, (n) => seen.push(n))
  assert.ok(seen.every((n, i) => i === 0 || n > seen[i - 1]))
  assert.ok(seen.at(-1)! >= 60)
})

test('readMix drops private and deleted videos', async () => {
  const list = tracks(30)
  list[3].title = '[Private video]'
  list[7].title = '[Deleted video]'
  const mix = await readMix(fakeNext(list).callNext, { videoId: 'v0' })
  assert.equal(mix.tracks.length, 28)
  assert.ok(!mix.tracks.some((t) => t.id === 'v3' || t.id === 'v7'))
})

test('readMix stops on a Mix that never ends (100 calls / 1,000 tracks cap)', async () => {
  let calls = 0, n = 0
  const callNext = async () => {
    calls++
    const contents = Array.from({ length: 25 }, () => {
      const id = `x${n++}`
      return { playlistPanelVideoRenderer: { videoId: id, title: { simpleText: id }, navigationEndpoint: { watchEndpoint: { videoId: id, index: n, params: 'p' } } } }
    })
    return { contents: { twoColumnWatchNextResults: { playlist: { playlist: { title: 'Endless', contents } } } } }
  }
  const mix = await readMix(callNext, { videoId: 'x' })
  assert.ok(calls <= 100)
  assert.ok(mix.tracks.length <= 1000 && mix.tracks.length >= 975)
})
