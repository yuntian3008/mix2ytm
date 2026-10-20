import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sapisidFromCookie, authHeader, parseCli, parseMix, requestHeaders } from './mix2ytm.ts'

test('sapisidFromCookie prefers SAPISID', () => {
  assert.equal(sapisidFromCookie('a=1; SAPISID=xyz; __Secure-3PAPISID=other'), 'xyz')
})

test('sapisidFromCookie falls back to __Secure-3PAPISID', () => {
  assert.equal(sapisidFromCookie('a=1; __Secure-3PAPISID=other'), 'other')
})

test('sapisidFromCookie returns undefined without either cookie', () => {
  assert.equal(sapisidFromCookie('a=1; b=2'), undefined)
})

test('sapisidFromCookie accepts a pasted "Cookie:" prefix and trailing newline', () => {
  assert.equal(sapisidFromCookie('Cookie: SAPISID=xyz; a=1\n'), 'xyz')
})

test('authHeader builds SAPISIDHASH for music.youtube.com', () => {
  const hash = createHash('sha1').update('1700000000 abc https://music.youtube.com').digest('hex')
  assert.equal(authHeader('abc', 1700000000), `SAPISIDHASH 1700000000_${hash}`)
})

test('parseCli reads the URL with defaults', () => {
  assert.deepEqual(parseCli(['https://x']), { url: 'https://x', limit: undefined, title: undefined, dryRun: false })
})

test('parseCli reads all flags', () => {
  assert.deepEqual(parseCli(['https://x', '--limit', '5', '--title', 'T', '--dry-run']), {
    url: 'https://x', limit: 5, title: 'T', dryRun: true,
  })
})

test('parseCli rejects a missing URL and bad limits', () => {
  assert.throws(() => parseCli([]))
  assert.throws(() => parseCli(['u', '--limit', 'abc']))
  assert.throws(() => parseCli(['u', '--limit', '0']))
  assert.throws(() => parseCli(['u', '--limit', '-3']))
})

test('parseMix dedupes tracks and keeps order', () => {
  const json = JSON.stringify({ title: 'Mix - A', entries: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'a', title: 'A' }] })
  assert.deepEqual(parseMix(json), { title: 'Mix - A', tracks: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] })
})

test('parseMix drops private and deleted videos', () => {
  const json = JSON.stringify({ title: 'Mix', entries: [{ id: 'a', title: '[Private video]' }, { id: 'b', title: 'B' }, { id: 'c', title: '[Deleted video]' }] })
  assert.deepEqual(parseMix(json).tracks, [{ id: 'b', title: 'B' }])
})

test('parseMix rejects a link without videos', () => {
  assert.throws(() => parseMix(JSON.stringify({ title: 'one video', id: 'x' })), /No videos found/)
  assert.throws(() => parseMix(JSON.stringify({ title: 'Mix', entries: [] })), /No videos found/)
})

test('requestHeaders joins a cookie pasted over several lines', () => {
  const h = requestHeaders('Cookie: a=1;\n  SAPISID=xyz;\n b=2\n', 1700000000)
  assert.equal(h.Cookie, 'a=1; SAPISID=xyz; b=2')
  assert.equal(h.Authorization, authHeader('xyz', 1700000000))
})

test('requestHeaders sends X-Goog-AuthUser 0 like the browser', () => {
  assert.equal(requestHeaders('SAPISID=xyz', 1)['X-Goog-AuthUser'], '0')
})

test('requestHeaders rejects a cookie without SAPISID', () => {
  assert.throws(() => requestHeaders('a=1', 1), /missing SAPISID/)
})
