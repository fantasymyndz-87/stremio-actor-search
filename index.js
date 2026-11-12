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
  'Content-Type': 'application/json',
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
  version: '1.1.0',
  name: 'Actor Search',
  description: 'Search actors and directors to browse their movies & TV shows',
  logo: 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'actor-search',
      name: 'Actor Search',
      extra: [{ name: 'search', isRequired: true }]
    },
    {
      type: 'series',
      id: 'actor-search',
      name: 'Actor Search',
      extra: [{ name: 'search', isRequired: true }]
    }
  ]
});

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (id !== 'actor-search' || !extra?.search) {
    return { metas: [] };
  }

  const query = extra.search.trim();
  if (!query || query.length < 2) {
    return { metas: [] };
  }

  try {
    // 1. Search for the person
    const search = await tmdb(
      `/search/person?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`
    );

    if (!search.results?.length) {
      return { metas: [] };
    }

    const person = search.results[0];
    const personId = person.id;

    // 2. Get combined credits
    const credits = await tmdb(`/person/${personId}/combined_credits?language=en-US`);

    const results = [];

    // --- Acting credits (cast) ---
    const cast = (credits.cast || []).filter(item => {
      if (type === 'movie') return item.media_type === 'movie';
      if (type === 'series') return item.media_type === 'tv';
      return false;
    });

    for (const item of cast) {
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
        description: item.character ? `Actor • as ${item.character}` : 'Actor',
        popularity: item.popularity || 0
      });
    }

    // --- Directing credits (crew) ---
    const crew = (credits.crew || []).filter(item => {
      if (item.job !== 'Director') return false;
      if (type === 'movie') return item.media_type === 'movie';
      if (type === 'series') return item.media_type === 'tv';
      return false;
    });

    for (const item of crew) {
      if (!item.poster_path) continue;

      const isMovie = item.media_type === 'movie';
      const title = isMovie ? item.title : item.name;
      const year = (isMovie ? item.release_date : item.first_air_date)?.slice(0, 4) || '';

      // Avoid duplicates if the person both acted and directed the same title
      const alreadyExists = results.some(r => r.id === `tmdb:${item.media_type}:${item.id}`);
      if (alreadyExists) continue;

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

    // Sort by popularity (highest first) and limit
    const metas = results
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 50)
      .map(({ popularity, ...meta }) => meta); // remove temporary popularity field

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