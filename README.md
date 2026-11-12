# Stremio Actor Search

Search for any actor in Stremio’s normal search bar and browse their movies and TV appearances.

## How it works

1. Type an actor’s name in Stremio search (e.g. `Tom Hanks`, `Zendaya`, `Pedro Pascal`)
2. Results from this addon appear under **Actor Search**
3. Click any title to open it (works with your other stream addons)

## Deploy on Render

1. Create a new **Web Service** on Render and connect this repository
2. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
3. Add Environment Variable:
   - Key: `TMDB_READ_ACCESS_TOKEN`
   - Value: your TMDB Read Access Token
4. Deploy

After deploy, install the addon in Stremio using:
