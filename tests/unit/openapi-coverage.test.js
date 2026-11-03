// Keeps openapi.yaml honest: every route the API serves must be documented, and
// nothing may be documented that the API does not serve. Adding a route without
// documenting it fails this test.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const createApp = require('../../src/app');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Express 4 keeps a mount's path only as a regular expression; turn it back into text.
function mountPath(layer) {
  if (layer.regexp.fast_slash) return '';
  let src = layer.regexp.source.replace(/^\^/, '').replace('\\/?(?=\\/|$)', '').replace(/\$$/, '');
  let i = 0;
  src = src
    .split('(?:\\/([^/]+?))')
    .reduce((acc, part, idx) => (idx === 0 ? part : `${acc}/:${(layer.keys[i++] || { name: 'p' }).name}${part}`), '');
  return src.replace(/\\\//g, '/');
}

function collectRoutes(stack, base, out) {
  stack.forEach((layer) => {
    if (layer.route) {
      Object.keys(layer.route.methods).forEach((method) => out.add(`${method.toUpperCase()} ${base}${layer.route.path}`));
    } else if (layer.name === 'router' && layer.handle.stack) {
      collectRoutes(layer.handle.stack, base + mountPath(layer), out);
    }
  });
  return out;
}

// /jobs/:id/offers/{offerId} -> /jobs/{}/offers/{}, so parameter names do not matter.
const normalise = (p) => p.replace(/:[A-Za-z]+/g, '{}').replace(/\{[A-Za-z]+\}/g, '{}').replace(/(.)\/$/, '$1');

describe('openapi.yaml', () => {
  const spec = yaml.load(fs.readFileSync(path.join(__dirname, '../../openapi.yaml'), 'utf8'));
  const inCode = new Set(
    [...collectRoutes(createApp()._router.stack, '', new Set())].map((r) => {
      const [method, ...rest] = r.split(' ');
      return `${method} ${normalise(rest.join(' '))}`;
    })
  );
  const documented = new Map();
  Object.entries(spec.paths).forEach(([p, ops]) => {
    METHODS.filter((m) => ops[m]).forEach((m) => documented.set(`${m.toUpperCase()} ${normalise(p)}`, ops[m]));
  });

  it('finds the routes it is meant to compare', () => {
    expect(inCode.size).toBeGreaterThan(100);
  });

  it('documents every route the API serves', () => {
    const missing = [...inCode].filter((r) => !documented.has(r)).sort();
    expect(missing).toEqual([]);
  });

  it('does not document routes that do not exist', () => {
    const stale = [...documented.keys()].filter((r) => !inCode.has(r)).sort();
    expect(stale).toEqual([]);
  });

  it('gives every operation a summary and at least one response', () => {
    const bare = [...documented.entries()].filter(([, op]) => !op.summary || !op.responses).map(([r]) => r);
    expect(bare).toEqual([]);
  });
});
