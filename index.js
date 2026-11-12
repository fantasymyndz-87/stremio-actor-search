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

// Build the addon
const builder = new addonBuilder({
  id: 'com.adamrich.actor-search',
  version: '1.0.0',
  name: 'Actor Search',
  description: 'Search for an actor and see their movies & TV shows',
  logo: 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'actor-search',
      name: 'Actor Search',
      extra: [
        { name: 'search', isRequired: true }
      ]
    },
    {
      type: 'series',
      id: 'actor-search',
      name: 'Actor Search',
      extra: [
        { name: 'search', isRequired: true }
      ]
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

    // Take the most popular / best match
    const person = search.results[0];
    const personId = person.id;

    // 2. Get combined credits
    const credits = await tmdb(`/person/${personId}/combined_credits?language=en-US`);

    const cast = credits.cast || [];

    // Filter by requested type and clean up
    const filtered = cast
      .filter(item => {
        if (type === 'movie') return item.media_type === 'movie';
        if (type === 'series') return item.media_type === 'tv';
        return false;
      })
      // Prefer items that have a poster and some popularity
      .filter(item => item.poster_path)
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, 40); // keep results reasonable

    // 3. Map to Stremio meta previews
    // We use tmdb: IDs for now (works well + avoids extra API calls for IMDb IDs)
    const metas = filtered.map(item => {
      const isMovie = item.media_type === 'movie';
      const title = isMovie ? item.title : item.name;
      const year = (isMovie ? item.release_date : item.first_air_date)?.slice(0, 4) || '';

      return {
        id: `tmdb:${item.media_type}:${item.id}`,
        type: isMovie ? 'movie' : 'series',
        name: title,
        poster: item.poster_path ? `${POSTER_BASE}${item.poster_path}` : null,
        posterShape: 'poster',
        releaseInfo: year,
        // helpful for the user
        description: item.character ? `as ${item.character}` : undefined
      };
    });

    return { metas };
  } catch (err) {
    console.error('Catalog error:', err.message);
    return { metas: [] };
  }
});

const addonInterface = builder.getInterface();

// Start server
const PORT = process.env.PORT || 7000;
serveHTTP(addonInterface, { port: PORT });

console.log(`Actor Search addon running on port ${PORT}`);
console.log(`Manifest: http://localhost:${PORT}/manifest.json`);