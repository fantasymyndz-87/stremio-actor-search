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
    signature: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..pmpQDD2aOIHOmCkvXxhDjw.6E4pDsuyAnb1bZD3EFrMRgOBfCNOHIGbUJOK_jghQ4e_frTlqfel6UzZe1TbaBc3gR3UGNZpxsMlafq03ew0fCAneSvZVAY9ZuYtM8pvhEjJgfKARo44fHICUfqUBLwW.CIA81bj5N0UmbrKOtXh0Yg'
  }
});

// ---------- Catalog (Movie Filmography with IMDb IDs) ----------
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (id !== 'actor-search' || !extra?.search) {
    return { metas: [] };
  }

  const query = extra.search.trim();
  if (query.length < 2) return { metas: [] };

  try {
    const search = await tmdb(
      `/search/person?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`
    );

    if (!search.results?.length) return { metas: [] };

    const person = search.results[0];
    const credits = await tmdb(`/person/${person.id}/combined_credits?language=en-US`);

    const candidates = [];

    // Acting credits (movies only)
    for (const item of credits.cast || []) {
      if (item.media_type !== 'movie') continue;
      if (!item.poster_path) continue;

      const year = item.release_date?.slice(0, 4) || '';

      candidates.push({
        tmdbId: item.id,
        title: item.title,
        year,
        poster: `${POSTER_BASE}${item.poster_path}`,
        description: item.character ? `Actor as ${item.character}` : 'Actor',
        popularity: item.popularity || 0
      });
    }

    // Directing credits (movies only)
    for (const item of credits.crew || []) {
      if (item.job !== 'Director') continue;
      if (item.media_type !== 'movie') continue;
      if (!item.poster_path) continue;

      const already = candidates.some(c => c.tmdbId === item.id);
      if (already) continue;

      const year = item.release_date?.slice(0, 4) || '';

      candidates.push({
        tmdbId: item.id,
        title: item.title,
        year,
        poster: `${POSTER_BASE}${item.poster_path}`,
        description: 'Director',
        popularity: item.popularity || 0
      });
    }

    // Sort + limit before resolving IMDb IDs
    const limited = candidates
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 25);

    // Resolve IMDb IDs (limited concurrency)
    const metas = await mapLimit(limited, 5, async (item) => {
      let finalId = `tmdb:movie:${item.tmdbId}`;

      try {
        const ext = await tmdb(`/movie/${item.tmdbId}/external_ids`);
        if (ext.imdb_id) {
          finalId = ext.imdb_id;
        }
      } catch (e) {
        // keep tmdb fallback
      }

      return {
        id: finalId,
        type: 'movie',
        name: item.title,
        poster: item.poster,
        posterShape: 'poster',
        releaseInfo: item.year,
        description: item.description
      };
    });

    return { metas };
  } catch (err) {
    console.error('Catalog error:', err.message);
    return { metas: [] };
  }
});

// ---------- Meta (Detail Page) ----------
builder.defineMetaHandler(async ({ type, id }) => {
  if (!id) return { meta: null };

  try {
    let tmdbId;

    if (id.startsWith('tt')) {
      const found = await tmdb(`/find/${id}?external_source=imdb_id`);
      const movie = found.movie_results?.[0];
      if (!movie) return { meta: null };
      tmdbId = movie.id;
    } else if (id.startsWith('tmdb:movie:')) {
      tmdbId = id.split(':')[2];
    } else {
      return { meta: null };
    }

    const data = await tmdb(
      `/movie/${tmdbId}?language=en-US&append_to_response=credits,external_ids`
    );

    const year = data.release_date?.slice(0, 4) || '';
    const cast = (data.credits?.cast || [])
      .slice(0, 12)
      .map(c => c.name)
      .filter(Boolean);

    const director = (data.credits?.crew || [])
      .filter(c => c.job === 'Director')
      .map(c => c.name)
      .slice(0, 3)
      .join(', ');

    const genres = (data.genres || []).map(g => g.name);
    const imdbId = data.external_ids?.imdb_id;
    const metaId = imdbId