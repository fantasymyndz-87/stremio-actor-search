const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

const TMDB_TOKEN = process.env.TMDB_READ_ACCESS_TOKEN;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

if (!TMDB_TOKEN) {
  console.error('Missing TMDB_READ_ACCESS_TOKEN environment variable');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TMDB_TOKEN}`,
  Accept: 'application/json'
};

async function tmdb(path) {
  const res = await fetch(`${TMDB_BASE}${path}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB ${res.status}: ${text}`);
  }
  return res.json();
}

// Simple concurrency limiter
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

const builder = new addonBuilder({
  id: 'com.adamrich.actor-search',
  version: '1.6.0',
  name: 'Actor Search',
  description: 'Search actors and directors to browse their movie filmography',
  logo: 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  idPrefixes: ['tmdb', 'tt'],
  catalogs: [
    {
      type: 'movie',
      id: 'actor-search',
      name: 'Filmography',
      extra: [{ name: 'search', isRequired: true }]
    }
  ],
  stremioAddonsConfig: {
    issuer: 'https://stremio-addons.net',
    signature: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..pmpQDD2aOIHOmCkvXxhDjw.6E4pDsuyAnb1bZD3EFrMRgOBfCNOHIGbUJOK_jghQ4e_frTlqfel