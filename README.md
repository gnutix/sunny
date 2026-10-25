# Here Comes the Sun

Where to drive from La Sallaz (Lausanne) to get out of the fog and into direct sunlight.

https://gnutix.github.io/sunny/

For each place within reach, the page shows:

- **the drive**: Google Maps with live traffic (typical traffic for a later departure), or
  OpenStreetMap routing without traffic when Google doesn't answer;
- **the sun you'll get**: expected minutes of direct sun from your arrival until the sun sets
  *behind the local terrain*, which in the mountains is often an hour before the real sunset;
- **how sure it is**: the share of MeteoSwiss ensemble runs (ICON-CH1, 11 runs over 33 h, and
  ICON-CH2, 21 runs over 5 days) that give you at least 20 minutes of sun;
- an hour-by-hour strip, a live webcam picture where one exists, and the restaurants still open
  when the sun goes.

Places are ranked by expected sun minus drive time by default. You can also plan a day ahead,
up to four days out.

## How it works

Plain HTML, CSS and ES modules, no build step, served by GitHub Pages. `sw.js` fetches the app's
files network-first, so a push shows up on the next load despite the Pages cache.

| File | What it does |
|---|---|
| `app.js` | data loading, ranking, rendering |
| `forecast.js` | ensemble runs → sun minutes and probability, with the terrain mask |
| `astro.js` | sun position, terrain horizon lookup |
| `hours.js` | small OpenStreetMap `opening_hours` reader |
| `places.js` | generated: places with elevation and horizon profile |
| `webcams.js` | webcam image and page per place |
| `config.js` | the Google Maps browser key |
| `tools/places.json` | the list of places (edit this, then rebuild `places.js`) |
| `tools/build-places.py` | computes each place's horizon from the Copernicus 90 m DEM |

Data: [Open-Meteo](https://open-meteo.com/) (forecast), Google Maps and [OSRM](https://project-osrm.org/)
(routing), [Overpass](https://overpass-api.de/) (restaurants), Copernicus DEM (terrain), webcams
from Roundshot, Guidle and the resorts.

## Development

```bash
python3 -m http.server 8765            # then http://127.0.0.1:8765/
nix shell nixpkgs#nodejs_22 -c npm test
```
