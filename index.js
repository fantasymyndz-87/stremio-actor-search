const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

const TMDB_TOKEN = process.env.TMDB_READ_ACCESS_TOKEN;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';

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

const builder = new addonBuilder({
  id: 'com.adamrich.actor-search',
  version: '1.2.0',
  name: 'Actor Search',
  description: 'Search actors and directors to browse their filmography',
  logo: 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'actor-search',
      name: 'Filmography',
      extra: [{ name: 'search', isRequired: true }]
    },
    {
      type: 'series',
      id: 'actor-search',
      name: 'Filmography',
      extra: [{ name: 'search', isRequired: true }]
    }
  ]
});

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (id !== 'actor-search' || !extra?.search) {
    return { metas: [] };
  }

  const query = extra.search.trim();
  if (query.length < 2) return { metas: [] };

  try {
    // Search person
    const search = await tmdb(
      `/search/person?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`
    );

    if (!search.results?.length) return { metas: [] };

    const person = search.results[0];
    const credits = await tmdb(`/person/${person.id}/combined_credits?language=en-US`);

    const results = [];

    // Acting credits
    for (const item of credits.cast || []) {
      if (type === 'movie' && item.media_type !== 'movie') continue;
      if (type === 'series' && item.media_type !== 'tv') continue;
      if (!item.poster_path) continue;

      const isMovie = item.media_type === 'movie';
      const title = isMovie ? item.title : item.name;
      const year = (isMovie ? item.release_date : item.first_air_date)?.slice(0, 4) || '';

      results.push({
        id: `tmdb:${item.media_type}:${item.id}`,
        type: isMovie ? 'movie' : 'series',
        name: title,
        poster: `${POSTER_BASE}${item.poster_path}`,
        posterShape: 'poster',
        releaseInfo: year,
        description: item.character ? `Actor as ${item.character}` : 'Actor',
        popularity: item.popularity || 0
      });
    }

    // Directing credits
    for (const item of credits.crew || []) {
      if (item.job !== 'Director') continue;
      if (type === 'movie' && item.media_type !== 'movie') continue;
      if (type === 'series' && item.media_type !== 'tv') continue;
      if (!item.poster_path) continue;

      const alreadyAdded = results.some(r => r.id === `tmdb:${item.media_type}:${item.id}`);
      if (alreadyAdded) continue;

      const isMovie = item.media_type === 'movie';
      const title = isMovie ? item.title : item.name;
      const year = (isMovie ? item.release_date : item.first_air_date)?.slice(0, 4) || '';

      results.push({
        id: `tmdb:${item.media_type}:${item.id}`,
        type: isMovie ? 'movie' : 'series',
        name: title,
        poster: `${POSTER_BASE}${item.poster_path}`,
        posterShape: 'poster',
        releaseInfo: year,
        description: 'Director',
        popularity: item.popularity || 0
      });
    }

    // Sort by popularity and limit
    const metas = results
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 40)
      .map(({ popularity, ...meta }) => meta);

    return { metas };
  } catch (err) {
    console.error('Catalog error:', err.message);
    return { metas: [] };
  }
});

const addonInterface = builder.getInterface();
const PORT = process.env.PORT || 7000;
serveHTTP(addonInterface, { port: PORT });

console.log(`Actor Search addon running on port ${PORT}`);