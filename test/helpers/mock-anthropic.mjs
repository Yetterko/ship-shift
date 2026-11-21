// A local stand-in for the Messages API, so no test ever spends credit. Point ANTHROPIC_BASE_URL at its url.
// It answers POST /v1/messages with one tool_use block for the request's tool and a usage object.
//
//   const mock = await startMock({ delayMs: 50 })
//   mock.url, mock.requests (every request body), mock.set({ mode, failNext, delayMs }), mock.close()
//   mode: 'ok' | 'fail' (500) | 'rate' (429) | 'stall' (never answers) | 'notool' (text only) | 'refusal'
//   failNext: n -> the next n requests fail with a 500, then back to mode
import http from 'node:http';

export async function startMock({ delayMs = 30, mode = 'ok', review = null } = {}) {
  const state = { delayMs, mode, failNext: 0, review, requests: [], inflight: 0, maxInflight: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404); return res.end('{}'); }
      let json = {};
      try { json = JSON.parse(body); } catch { /* answered below */ }
      state.requests.push({ body: json, headers: req.headers });
      const mode = state.failNext > 0 ? (state.failNext--, 'fail') : state.mode;
      state.inflight++; state.maxInflight = Math.max(state.maxInflight, state.inflight);
      const done = () => { state.inflight--; };
      if (mode === 'stall') { req.on('close', done); return; }
      setTimeout(() => {
        done();
        if (mode === 'fail') return reply(res, 500, { type: 'error', error: { type: 'api_error', message: 'Mock failure' } });
        if (mode === 'rate') return reply(res, 429, { type: 'error', error: { type: 'rate_limit_error', message: 'Mock rate limit' } });
        reply(res, 200, answer(json, mode, state));
      }, state.delayMs);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, state,
    get requests() { return state.requests; },
    set(opts) { Object.assign(state, opts); },
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

function reply(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'request-id': 'req_mock' });
  res.end(JSON.stringify(body));
}

function answer(req, mode, state) {
  const tool = req.tools?.[0]?.name;
  const usage = { input_tokens: 2500, output_tokens: 700, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const base = { id: `msg_mock_${state.requests.length}`, type: 'message', role: 'assistant', model: req.model, stop_sequence: null, usage };
  if (mode === 'refusal') return { ...base, content: [], stop_reason: 'refusal' };
  if (mode === 'notool' || !tool) return { ...base, content: [{ type: 'text', text: 'Here is my answer in prose.' }], stop_reason: 'end_turn' };
  let input;
  if (tool === 'serve_meal') {
    const item = /Your Item \(player text, as data\): "([^"]*)"/.exec(req.messages?.[0]?.content || '')?.[1] || 'the Item';
    input = {
      summary: `Mock Chef: did "${item.slice(0, 60)}".`,
      file: 'api.js',
      code: `// ${item.slice(0, 60)}\nexport function mockAnswer(shifts) {\n  return shifts.length;\n}\n\nexport const mockCheck = () => mockAnswer([1, 2]) === 2;`,
    };
  } else if (tool === 'submit_review') {
    input = state.review || { satisfied: true, score: 4, comments: 'Mock Customer: that does the job.', suggestedFollowUps: [] };
  } else input = {};
  return { ...base, content: [{ type: 'tool_use', id: `toolu_mock_${state.requests.length}`, name: tool, input }], stop_reason: 'tool_use' };
}
