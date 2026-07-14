'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const swScript = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function serviceWorkerHarness({ networkResponse, cachedResponse }) {
  const handlers = {};
  const cacheWrites = [];
  const self = {
    location: { origin: 'https://score.test' },
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => Promise.resolve(),
    addEventListener: (type, handler) => { handlers[type] = handler; }
  };
  const caches = {
    match: () => Promise.resolve(cachedResponse || null),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
    open: () => Promise.resolve({
      addAll: () => Promise.resolve(),
      put: (request, response) => {
        cacheWrites.push({ request, response });
        return Promise.resolve();
      }
    })
  };
  const context = vm.createContext({
    self,
    caches,
    fetch: () => Promise.resolve(networkResponse),
    URL,
    Promise
  });
  vm.runInContext(swScript, context);

  async function requestRuntime(url = 'https://score.test/app.js') {
    let responsePromise;
    handlers.fetch({
      request: { method: 'GET', mode: 'cors', url },
      respondWith: promise => { responsePromise = promise; }
    });
    return responsePromise;
  }

  return { requestRuntime, cacheWrites };
}

test('runtime error response keeps and serves the working cache', async () => {
  const cached = { source: 'cache' };
  const network = { ok: false, status: 404, url: 'https://score.test/app.js' };
  const h = serviceWorkerHarness({ networkResponse: network, cachedResponse: cached });

  assert.equal(await h.requestRuntime(), cached);
  assert.equal(h.cacheWrites.length, 0);
});

test('cross-origin runtime response keeps and serves the working cache', async () => {
  const cached = { source: 'cache' };
  const network = { ok: true, url: 'https://other.test/app.js' };
  const h = serviceWorkerHarness({ networkResponse: network, cachedResponse: cached });

  assert.equal(await h.requestRuntime(), cached);
  assert.equal(h.cacheWrites.length, 0);
});

test('successful same-origin runtime response replaces the cache', async () => {
  const network = {
    ok: true,
    url: 'https://score.test/app.js',
    clone: () => ({ source: 'network-copy' })
  };
  const h = serviceWorkerHarness({ networkResponse: network, cachedResponse: { source: 'cache' } });

  assert.equal(await h.requestRuntime(), network);
  assert.equal(h.cacheWrites.length, 1);
});
