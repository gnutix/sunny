# Here Comes the Sun

A personal page for the owner (lives at La Sallaz, Lausanne): which places within driving reach
will have direct sun, for how long after arrival, and how sure. `README.md` lists the features and
files; this is what a session needs to change them safely.

## Shipping

- A push to `main` is a deploy: GitHub Pages serves the repo root at https://gnutix.github.io/sunny/
  (legacy build, about a minute). Check it with
  `gh api repos/gnutix/sunny/pages/builds/latest --jq '.status + " " + .commit[0:7]'`.
- `sw.js` serves the app's own files network-first (bypassing Pages' 10-minute cache), Google Fonts
  cache-first, and leaves every API and webcam request alone: those are live data, never cache them.
- Everything committed is public. `config.js` holds the Google Maps browser key, public by design:
  in Google Cloud (project of gnutix@gmail.com) it is restricted to `https://gnutix.github.io/*`
  and `http://127.0.0.1:8765/*`, to the Maps JavaScript and Routes APIs, under a daily quota cap.
  Never commit any other kind of key.

## Code

- No build step, no runtime dependency except Google Fonts (Bricolage Grotesque). ES modules.
- All times are epoch milliseconds; Europe/Zurich only at display time (`zurich()`, `zurichToMs()`
  in `app.js`). Open-Meteo is asked for `timeformat=unixtime`, and each hourly value covers the
  hour *ending* at its timestamp.
- The forecast models count sunshine above a flat horizon. `forecast.js` turns each hour into the
  share of flat-horizon sun a run sees, then applies the terrain mask on 5-minute steps, so the
  sunset hour is not counted twice. Keep that when touching it (tests cover it).
- The sun is visible when its altitude exceeds `max(0, horizon) - 0.833°`.
- Drives: Google's `RouteMatrix` (Maps JavaScript API, `routes` library), traffic-aware, 26
  billed elements per request against a free tier of about 5,000 a month. Answers are cached per
  15-minute departure slot (15 min near term, 6 h further out); keep it that way. OSRM fills in
  when Google fails or has no route.
- Free APIs, keep the load low: the forecast is one request for all places, cached 30 min in
  localStorage (Open-Meteo's free tier counts each location); OSRM drives are cached until the
  places change; restaurant lists for a week. Overpass is often at capacity: it must fail politely.
- Colours through the `:root` tokens, light and dark. UI copy in English, plain, sentence case.
  Toggle visibility with `hidden`.

## Places and terrain

Edit `tools/places.json` (the `home` entry is La Sallaz), then regenerate `places.js`:

```bash
nix shell --impure --expr 'with import <nixpkgs> {}; python3.withPackages (p: [p.rasterio p.numpy])' \
  -c python3 tools/build-places.py
```

It downloads the Copernicus GLO-90 tiles to `~/.cache/sunny-dem` once (~60 MB). Don't go back to
Open-Meteo's elevation API for this: a horizon scan needs tens of thousands of points and burns
the machine's hourly quota, which the page itself also uses. Coordinates are the spot where one
parks or stands; the DEM is a surface model (trees included), so the scan starts 500 m out.
Add a webcam to `webcams.js` only after checking its image URL serves the latest picture and works
hotlinked (`curl -sI -e https://gnutix.github.io/sunny/ URL`).

## Tests

```bash
nix shell nixpkgs#nodejs_22 -c npm test      # node --test, pure logic
```

Reference sun times come from the astral Python package; don't derive expected values from the
app. For the page itself, serve it (`python3 -m http.server 8765`) and look at it in a browser,
desktop and 375 px wide.
