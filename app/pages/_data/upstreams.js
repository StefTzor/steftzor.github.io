/**
 * The five services this system reads from, and how each one's answer becomes ours.
 *
 * Written out because "we call an API" is not a description of anything. What is worth knowing
 * is which endpoint, how often it is allowed to be called, and which of their field names became
 * which of ours - the mapping is where the work is, and it is the part that breaks when an
 * upstream changes shape.
 *
 * Four of them are proxied by the API, which is what keeps them off the browser's network tab
 * entirely. The fifth, the basemap, is read BOTH ways - proxied for the home card's skyline and
 * not proxied for the maps on /f1/ and /transit/ - and that split is the most interesting fact
 * in this file, so it is stated in the entry rather than left for a reader to notice.
 *
 * `derived` marks a field nobody sent us. Those are the interesting ones: they are decisions,
 * not transport. An entry with no mapping at all carries `mappingNote` instead, because an empty
 * table dressed up to look like the other four would be padding.
 */
module.exports = [
  {
    name: "Open-Meteo",
    what: "Forecast, air quality, and turning a place name into a coordinate.",
    key: false,
    cache: "10 minutes, a day for place lookups",
    why: "A forecast that is ten minutes old is the same forecast. The window exists to keep one open tab from calling a free service every time somebody switches back to it.",
    calls: [
      { path: "/v1/forecast", note: "current, hourly and five days, timezone=auto" },
      { path: "/v1/air-quality", note: "European AQI and PM2.5, on a separate host" },
      { path: "/v1/search", note: "place name to coordinate, held a day. Uppsala does not move" },
    ],
    mapping: [
      ["current.temperature_2m", "current.temperature"],
      ["current.apparent_temperature", "current.feelsLike"],
      ["current.relative_humidity_2m", "current.humidity"],
      ["current.wind_speed_10m", "current.windSpeed"],
      ["current.is_day (0 or 1)", "current.isDay (boolean)"],
      ["daily.temperature_2m_max[]", "daily[].max"],
      ["current.european_aqi", "air.aqi"],
    ],
    notes: [
      "Air quality is fetched alongside the forecast and allowed to fail on its own. Losing a forecast because a different service is having a bad morning would be a poor trade.",
      "An AQI is only attached when it arrives as a number. A null from upstream would otherwise be drawn as a band on the scale.",
    ],
  },
  {
    name: "Trafiklab ResRobot v2.1",
    what: "Swedish departures, arrivals, stop search and stops near a point.",
    key: true,
    cache: "45 seconds",
    why: "A departure board is wrong the moment it is stale, so this is the shortest window here. Departures and arrivals for the same stop are cached apart, because they are two answers.",
    calls: [
      { path: "/v2.1/departureBoard", note: "the board for one stop id" },
      { path: "/v2.1/arrivalBoard", note: "same shape, opposite direction" },
      { path: "/v2.1/location.name", note: "stop search by name" },
      { path: "/v2.1/location.nearbystops", note: "stops within 1.5 km of a coordinate" },
    ],
    mapping: [
      ["ProductAtStop.line", "line"],
      ["ProductAtStop.catOutS", "category"],
      ["ProductAtStop.operator", "operator"],
      ["direction, or origin on an arrival board", "towards"],
      ["time", "scheduledAt"],
      ["rtTime, falling back to time", "expectedAt"],
      ["expected minus scheduled", "delayMinutes", true],
      ["expected minus now", "inMinutes", true],
    ],
    notes: [
      "This one needs a credential, which is what keeps it on the server. That the key travels as a query parameter rather than a header makes it worse than usual: it would sit in the URL of every request a tab made, and a URL is the part everything keeps: the vendor\u2019s own access logs, the browser\u2019s history, any screenshot of a network tab. A header is not logged by default; a query string is.",
      "Times arrive as Swedish wall-clock with no offset. The container runs in UTC, so parsing them directly put every departure two hours out. They are resolved against Europe/Stockholm instead, which is tested across both daylight-saving changeovers.",
      "The board's `direction` is documented as the last stop of the trip, so it is a stop name rather than the headsign on the front of the bus. UL's own app shows something different because that is UL's headsign, which this feed does not carry.",
    ],
  },
  {
    name: "Jolpica",
    what: "Formula 1 calendar, championship standings and race results. The maintained successor to Ergast.",
    key: false,
    cache: "6 hours for the calendar, 5 minutes for results",
    why: "Two clocks, so two windows. The calendar changes a few times a year; results change the moment a session ends, and this has no way of knowing when that was.",
    calls: [
      { path: "/{season}/races/", note: "every round and its session times" },
      { path: "/{season}/driverStandings/", note: "and constructorStandings" },
      { path: "/{season}/{round}/results/", note: "plus qualifying and sprint, each allowed to be absent" },
    ],
    mapping: [
      ["FirstPractice, SecondPractice, …", "sessions[].label"],
      ["Circuit.Location.locality", "locality"],
      ["Results[].positionText", "positionText"],
      ["Results[].status", "status, passed through unedited"],
      ["grid minus position", "gained", true],
      ["presence of a Sprint session", "sprint (boolean)", true],
    ],
    notes: [
      "Session times arrive as real UTC instants, which is the whole reason this one is pleasant and departures were not. Nothing here converts to a local zone: the instant is sent as ISO and the browser renders it wherever the reader is.",
      "A weekend stays the current weekend for three hours after its last session starts. The feed gives start times and no durations, so that number is an estimate and is named as one in the code.",
      "Results are read from whichever of the three tables exist. Mid-weekend that is the normal state, and an absent one is Saturday rather than an error.",
    ],
  },
  {
    name: "GitHub Actions",
    what: "Recent workflow runs, for the deploy history on the Health page.",
    key: true,
    cache: "2 minutes",
    why: "Nobody watches a deploy list continuously, and the token has a rate limit worth respecting.",
    calls: [
      { path: "/repos/{owner}/{repo}/actions/runs", note: "the last 30, then the newest few per workflow" },
      { path: "/repos/{owner}/{repo}/actions/runs/{id}/jobs", note: "only for failures, and only the newest three" },
    ],
    mapping: [
      ["run_started_at", "startedAt"],
      ["updated_at minus run_started_at", "durationMs", true],
      ["head_sha, first seven", "sha"],
      ["head_commit.message, first line", "message"],
      ["the first failing step of the first failing job", "failedStep", true],
    ],
    notes: [
      "This is the only upstream that knows about a deploy that FAILED. Anything read from the running service — a restart time, a build stamp — can only describe deploys that worked, which is the half nobody needs telling about.",
      "Errors from it carry the status code and never the body. A GitHub error body can echo the request back, and the request carries the token.",
    ],
  },
  {
    name: "OpenFreeMap",
    what: "Two different things from one service. The map under the circuit on /f1/ and under the stops on /transit/: vector tiles cut to the OpenMapTiles schema, from OpenStreetMap's data, in a light and a dark palette; /f1/ can also swap it for satellite imagery, which comes from a second host — see the notes. And, separately, the buildings the home card's skyline is computed from, which the API reads on the server and the browser never asks for.",
    key: false,
    cache: "browser, for the maps; the API, for a month, for the skyline",
    why: "The only upstream a browser talks to itself, and, since the home card's skyline, the only one read both ways. The maps are not proxied because tiles are images, fetched one per square as you pan and zoom, and standing in front of a few hundred images a session would not be forwarding a call — it would be running a tile server. What that trade costs belongs here rather than in a footnote: the request carries the reader's IP address and, in the tile numbers themselves, roughly which part of the world they are looking at and how closely, to a service neither they nor this site has any relationship with. The skyline is the opposite case and so it is proxied: nine tiles, once, at one zoom, for a place the API already knows. The tile numbers there would not be somewhere a reader chose to look. They would be where the reader lives, sent on every load of the page everybody lands on. Nothing is pressed to reach that page, so nothing about it should leave a browser.",
    calls: [
      { path: "/styles/{positron|dark}", note: "the style document, chosen from the theme. Browser" },
      { path: "/planet/{version}/{z}/{x}/{y}.pbf", note: "one vector tile per square, as you pan. Browser" },
      { path: "/fonts/{fontstack}/{range}.pbf", note: "glyph ranges, only for the labels actually drawn. Browser" },
      { path: "/sprites/…", note: "one sheet of icons for the whole style. Browser" },
      { path: "/planet/{version}/14/{x}/{y}.pbf", note: "nine tiles around your home area, for the skyline. The API, once a month at most" },
    ],
    mapping: [],
    mappingNote:
      "For the maps, nothing is mapped, because nothing arrives to be mapped. A tile is geometry to be drawn, not a document with fields, so there is no field of theirs that became a field of ours - the only decision here is which of the two styles to ask for, and that is read off the theme. The coordinates these maps are pointed AT come from the Trafiklab and Jolpica entries above, never from here. The skyline is the one place a field does cross over: `render_height` on the building layer, the height in metres OpenStreetMap holds for each building, becomes the height of that building in the drawing. Nothing else from the tile is read - not a name, not an address, not a street.",
    notes: [
      "Satellite is a SECOND tile host, offered behind a toggle on /f1/ only - EOX's Sentinel-2 cloudless, at tiles.maps.eox.at. Everything this entry says about the trade applies to it identically: the browser asks, the request carries an IP address and the tile numbers say which part of the world is being looked at. Two differences worth naming. Their licence requires a credit naming the year of the Copernicus data, which the map renders in its own attribution control and which the code builds from the same constant as the tile URL, so the imagery and the crediting of it cannot come apart. And it is free for non-commercial use only - a condition this site was read against rather than assumed past.",
      "It is on /f1/ and deliberately not on /transit/. A photograph of Spa is a pale ribbon through a forest and a photograph of Monza is an unmistakable oval; a photograph of a bus stop is a roof. Satellite hides the street name, the stop label and which way the road runs, which is the whole of what a departure board's map is for.",
      "Only the picture is theirs. MapLibre itself is served from /vendor, so no third party is in script-src on any page — which is the distinction that gets lost the moment somebody says \u201ca third-party map\u201d, and it is the half that would actually matter.",
      "Needing no key is the only reason a browser can be the one asking. The two keyless upstreams above are still proxied, because one call there serves every reader; a tile fetched by one browser serves that browser and nobody else, so proxying would buy nothing and cost a tile server. The skyline is the case where that reasoning runs the other way: one answer per town, kept for a month, serves everybody in it, so it is proxied like the rest.",
      "The skyline's cache key is the z14 tile, not the coordinate. That square is about 1.2 km across, which is coarser than the two decimal places the coordinate already arrives rounded to, so what the API keeps is a worse record of where somebody lives than what it was sent. Two people in the same town share one entry and one fetch between them.",
      "A place OpenStreetMap has barely mapped gets no skyline rather than a bad one. Under twelve buildings, or nothing taller than twelve metres, and the answer says so and the card is simply the weather. A village drawn accurately is four sheds.",
      "The provider was chosen by rendering one, which is the only way this particular thing can be checked. CARTO answers without a key and then prints \u201cAPI KEY REQUIRED\u201d across every tile - a 200 to curl and a ruined map to a person. OpenStreetMap\u2019s own tiles are clean and keyless, but their usage policy says plainly they are not for an app\u2019s basemap, and testing against them was throttled within minutes, which is that policy working rather than failing. This one asks for no key and sets no limit, and says so as its purpose.",
      "Both maps are an addition to a page that already works without one. Blocked, missing or failing, the library takes nothing down with it: the departures and the results still draw, and a place whose coordinate did not resolve says it has none rather than drawing an empty ocean at 0,0.",
      "This is written down twice more on purpose, and the privacy notice and the cookies page both name the host. A request this code cannot see is one a reader can only learn about by being told, so being told is the whole control they have. The skyline's call is the opposite: this code does see it, and it is written down anyway, because \"the server did it\" is not the same as nobody needing to know.",
    ],
  },
];
