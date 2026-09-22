import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KieProvider, ProviderError, humanError } from '../server/providers/kie.js'

function mockFetch(responses) {
  const calls = []
  const queue = [...responses]
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null })
    const next = queue.shift()
    if (!next) throw new Error('mockFetch: brak zaplanowanej odpowiedzi dla ' + url)
    if (next.throw) throw new Error(next.throw)
    return {
      ok: next.status ? next.status < 400 : true,
      status: next.status || 200,
      statusText: 'mock',
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    }
  }
  fn.calls = calls
  return fn
}

test('credits() zwraca saldo z koperty {code,data}', async () => {
  const f = mockFetch([{ body: { code: 200, msg: 'success', data: 521 } }])
  const p = new KieProvider({ apiKey: 'test-key-1234567890', fetchImpl: f })
  assert.equal(await p.credits(), 521)
  assert.match(f.calls[0].url, /\/api\/v1\/chat\/credit$/)
})

test('submit() wysyła {model,input} i zwraca taskId', async () => {
  const f = mockFetch([{ body: { code: 200, data: { taskId: 'task_abc' } } }])
  const p = new KieProvider({ apiKey: 'test-key-1234567890', fetchImpl: f })
  const out = await p.submit({ model: 'gpt-image-2-5-flare-text-to-image', input: { prompt: 'kot', aspect_ratio: '1:1', resolution: '1K' } })
  assert.equal(out.taskId, 'task_abc')
  assert.equal(f.calls[0].method, 'POST')
  assert.deepEqual(f.calls[0].body.input.prompt, 'kot')
})

test('submit() NIE ponawia POST-a po błędzie sieci (ochrona przed podwójną opłatą)', async () => {
  const f = mockFetch([{ throw: 'ECONNRESET' }, { body: { code: 200, data: { taskId: 'duplikat' } } }])
  const p = new KieProvider({ apiKey: 'test-key-1234567890', fetchImpl: f })
  await assert.rejects(() => p.submit({ model: 'm', input: {} }), ProviderError)
  assert.equal(f.calls.length, 1, 'POST poszedł więcej niż raz')
})

test('status() ponawia GET po odpowiedzi, która nie jest JSON-em', async () => {
  const f = mockFetch([
    { body: '<html>502 Bad Gateway</html>' },
    { body: { code: 200, data: { state: 'success', resultJson: '{"resultUrls":["https://x/y.png"]}', creditsConsumed: 6, costTime: 81 } } },
  ])
  const p = new KieProvider({ apiKey: 'test-key-1234567890', fetchImpl: f })
  const s = await p.status('task_abc')
  assert.equal(s.state, 'success')
  assert.deepEqual(s.urls, ['https://x/y.png'])
  assert.equal(s.credits, 6)
  assert.equal(f.calls.length, 2)
})

test('status() rozpoznaje stany w toku i porażkę', async () => {
  const running = new KieProvider({ apiKey: 'test-key-1234567890', fetchImpl: mockFetch([{ body: { code: 200, data: { state: 'generating' } } }]) })
  assert.equal((await running.status('t')).state, 'running')

  const failed = new KieProvider({ apiKey: 'test-key-1234567890', fetchImpl: mockFetch([{ body: { code: 200, data: { state: 'fail', failCode: 451, failMsg: 'content policy' } } }]) })
  const s = await failed.status('t')
  assert.equal(s.state, 'fail')
  assert.equal(s.failMsg, 'content policy')
})

test('błąd 401 dostaje ludzki komunikat po polsku', async () => {
  const f = mockFetch([{ status: 401, body: { code: 401, msg: 'unauthorized' } }])
  const p = new KieProvider({ apiKey: 'test-key-1234567890', fetchImpl: f })
  const res = await p.validateKey()
  assert.equal(res.ok, false)
  assert.match(res.human, /klucz/i)
})

test('humanError tłumaczy brak kredytów', () => {
  assert.match(humanError(402), /kredyt/i)
})
