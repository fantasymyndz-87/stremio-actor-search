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
  version: '1.3.0',
  name: 'Actor Search',
  description: 'Search actors and directors to browse their filmography',
  logo: 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tmdb'],
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
  ],
  stremioAddonsConfig: {
    issuer: "https://stremio-addons.net",
    signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..pmpQDD2aOIHOmCkvXxhDjw.6E4pDsuyAnb1bZD3EFrMRgOBfCNOHIGbUJOK_jghQ4e_frTlqfel6UzZe1TbaBc3gR3UGNZpxsMlafq03ew0fCAneSvZVAY9ZuYtM8pvhEjJgfKARo44fHICUfqUBLwW.CIA81bj5N0UmbrKOtXh0Yg"
  }
});

// ---------- Catalog (Filmography) ----------
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

// ---------- Stream (Trailers) ----------
builder.defineStreamHandler(async ({ type, id }) => {
  // Expected id format: tmdb:movie:123 or tmdb:tv:456
  if (!id.startsWith('tmdb:')) {
    return { streams: [] };
  }

  const parts = id.split(':');
  if (parts.length !== 3) return { streams: [] };

  const mediaType = parts[1]; // "movie" or "tv"
  const tmdbId = parts[2];

  if (!['movie', 'tv'].includes(mediaType) || !tmdbId) {
    return { streams: [] };
  }

  try {
    const data = await tmdb(`/${mediaType}/${tmdbId}/videos?language=en-US`);
    const videos = data.results || [];

    // Prefer official trailers, then any trailer/teaser from YouTube
    const youtubeVideos = videos
      .filter(v => v.site === 'YouTube' && v.key)
      .filter(v => ['Trailer', 'Teaser', 'Clip'].includes(v.type));

    // Sort: official trailers first, then regular trailers, then teasers
    youtubeVideos.sort((a, b) => {
      const score = (v) => {
        let s = 0;
        if (v.official) s += 10;
        if (v.type === 'Trailer') s += 5;
        if (v.type === 'Teaser') s += 2;
        return s;
      };
      return score(b) - score(a);
    });

    const streams = youtubeVideos.slice(0, 5).map(v => ({
      name: v.official ? 'Official Trailer' : (v.type || 'Trailer'),
      title: v.name || 'Trailer',
      ytId: v.key,
      behaviorHints: {
        bingeGroup: `trailer-${id}`
      }
    }));

    return { streams };
  } catch (err) {
    console.error('Stream error:', err.message);
    return { streams: [] };
  }
});

const addonInterface = builder.getInterface();
const PORT = process.env.PORT || 7000;
serveHTTP(addonInterface, { port: PORT });

console.log(`Actor Search addon running on port ${PORT}`);