import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mixIdsFromUrl, panelItems, cookieValue, sapisidHash } from './bookmarklet.ts'

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
