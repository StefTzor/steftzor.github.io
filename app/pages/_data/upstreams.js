/**
 * The four services the API proxies, and how each one's answer becomes ours.
 *
 * Written out because "we call an API" is not a description of anything. What is worth knowing
 * is which endpoint, how often it is allowed to be called, and which of their field names became
 * which of ours - the mapping is where the work is, and it is the part that breaks when an
 * upstream changes shape.
 *
 * `derived` marks a field nobody sent us. Those are the interesting ones: they are decisions,
 * not transport.
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
    why: "A departure board is wrong the moment it is stale, so this is the shortest window of the four. Departures and arrivals for the same stop are cached apart, because they are two answers.",
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
      "This is the only one of the four that knows about a deploy that FAILED. Anything read from the running service — a restart time, a build stamp — can only describe deploys that worked, which is the half nobody needs telling about.",
      "Errors from it carry the status code and never the body. A GitHub error body can echo the request back, and the request carries the token.",
    ],
  },
];
