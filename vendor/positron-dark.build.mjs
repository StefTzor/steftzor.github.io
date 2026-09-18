/**
 * Regenerates vendor/positron-dark.json, and is the provenance note for it.
 *
 *   node vendor/positron-dark.build.mjs          # check the committed file still matches
 *   node vendor/positron-dark.build.mjs --write  # rebuild it
 *
 * **What this is.** OpenFreeMap serves five styles - positron, dark, fiord, liberty, bright - and
 * none of them is a dark positron. Positron draws 55 layers, 16 of them labels; fiord, which this
 * app shipped for dark before, draws 48 and 14, and the difference is visible: fiord leaves out
 * detail positron draws, which is why the light map read as the better-made one. So this file takes positron's
 * cartography and re-inks it, and nothing else. Every layer's filters, geometry, zoom stops and
 * order are copied through untouched; the only thing that changes is which colour goes in.
 *
 * Because the sources block is copied verbatim, the built style still fetches its tiles, glyphs and
 * sprite from tiles.openfreemap.org - the one third party the app's CSP already allows - and the
 * attribution comes with them: MapLibre reads it from the TileJSON at the source URL, which is
 * where "OpenFreeMap (c) OpenMapTiles - Data from OpenStreetMap" actually lives. It is not in the
 * style document at all, so there is no attribution field here to lose.
 *
 * Source:  https://tiles.openfreemap.org/styles/positron   (fetched 2026-09-18)
 *
 * **The palette is the app's own.** Every ink below comes from the `.dark` block of src/input.css
 * or from a step on the same slate ramp. The one rule the basemap has to obey is the one
 * OpenFreeMap's own `dark` style breaks: its background is rgb(12,12,12), darker than this app's
 * page at #0f172a, so a map drawn in it reads as a hole punched through the layout instead of a
 * card sitting on it. Land here is #334155 - lighter than the #1e293b card it sits on, which is the
 * direction every other raised thing in this app goes.
 *
 * Positron's own ordering is kept wherever it survives inversion: water darker than land, road
 * casings darker than the roads they outline, railway dashes lighter than the rail under them,
 * glaciers the lightest thing on the map. Two places deliberately depart from it, and both are
 * about being legible rather than being faithful:
 *
 *   - Buildings go LIGHTER than land, not darker. At #40526c against #334155 a building block
 *     still reads as a block; taking positron's direction instead would have sunk it into the land
 *     it sits on, because there is far less room below #334155 than there was below positron's
 *     near-white.
 *   - Road names are brighter than the place-name hierarchy would suggest. `highway-name-minor`
 *     and `highway-name-major` are the only label layers positron gives no halo, so their only
 *     contrast is against the road itself - and a rule here is that only colours change, so a halo
 *     cannot be added to rescue them. #e2e8f0 on the #5c6b85 road holds 4:1 instead of the 2.5:1
 *     a dimmer ink would have given. The check at the bottom of this file is what enforces that.
 *
 * The check also fails on any colour literal in the upstream style that is not in the table below,
 * so if OpenFreeMap re-inks positron this stops rather than silently shipping a half-converted map.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = "https://tiles.openfreemap.org/styles/positron";
const OUT = fileURLToPath(new URL("./positron-dark.json", import.meta.url));

// The whole palette, and the only thing in this file that is a decision rather than a copy.
// Tokens first, then the steps derived from them - named for what they draw, not for their hue,
// because the next person to touch this wants to find "the colour of a road", not "slate 500".
const ink = {
  land: "#334155", //  --color-border: the app's own lightest structural slate
  landAlt: "#2f3c4e", //  residential, a shade below land the way positron has it
  park: "#35483f",
  wood: "#2e4239",
  ice: "#53637d", //  the lightest land in the style, as in positron
  water: "#1e293b", //  --color-surface: the water is the same navy as the card
  waterway: "#2c3d57", //  a hair above water so a river inside a lake still reads

  building: "#40526c",
  buildingEdge: "#536a8c",

  roadCasing: "#212b3d", //  below land, so the casing reads as an outline and not as a road
  roadInner: "#5c6b85",
  roadMinor: "#4a5871",
  roadPath: "#43516b",
  roadFaint53: "hsla(215,18%,58%,0.53)", //  alpha kept exactly as positron had it
  roadFaint69: "hsla(215,18%,58%,0.69)",
  rail: "#55637d",
  railDash: "#7f8ea8",
  boundary: "hsl(215,16%,55%)",

  labelPlace: "#f1f5f9", //  --color-text
  labelPlaceMinor: "#cbd5e1",
  labelRoad: "#e2e8f0", //  bright because these two layers carry no halo - see above
  labelPath: "#a5b0c2",
  labelWaterway: "#a9b7cc",
  labelWaterBody: "#8fb0e8", //  positron's #495e91 lifted, so water names stay blue
  halo: "#0f172a", //  --color-bg: dark halo under light text, the inverse of positron's white
  haloSoft: "rgba(15,23,42,0.7)", //  same alpha positron used for its white one
  haloPath: "#101a2e",
};

// Every colour-bearing paint property in positron, by layer id. A literal in the upstream style
// with no entry here is a build failure rather than a pass-through, which is the point: an
// un-inverted white road would otherwise ship looking like a bug nobody wrote.
const paint = {
  background: { "background-color": ink.land },
  park: { "fill-color": ink.park },
  water: { "fill-color": ink.water },
  landcover_ice_shelf: { "fill-color": ink.ice },
  landcover_glacier: { "fill-color": ink.ice },
  landuse_residential: { "fill-color": ink.landAlt },
  landcover_wood: { "fill-color": ink.wood },
  waterway: { "line-color": ink.waterway },
  building: { "fill-color": ink.building, "fill-outline-color": ink.buildingEdge },
  tunnel_motorway_casing: { "line-color": ink.roadCasing },
  tunnel_motorway_inner: { "line-color": ink.roadPath },
  "aeroway-taxiway": { "line-color": ink.roadMinor },
  "aeroway-runway-casing": { "line-color": ink.roadMinor },
  "aeroway-area": { "fill-color": ink.roadPath },
  "aeroway-runway": { "line-color": ink.roadInner },
  road_area_pier: { "fill-color": ink.land },
  road_pier: { "line-color": ink.land },
  highway_path: { "line-color": ink.roadPath },
  highway_minor: { "line-color": ink.roadMinor },
  highway_major_casing: { "line-color": ink.roadCasing },
  highway_major_inner: { "line-color": ink.roadInner },
  highway_major_subtle: { "line-color": ink.roadFaint69 },
  highway_motorway_casing: { "line-color": ink.roadCasing },
  // The one interpolated colour in the style: a motorway is faint until z6 and solid after it.
  // Both stops are named, so the ramp survives instead of collapsing to a single colour.
  highway_motorway_inner: { "line-color": [ink.roadFaint53, ink.roadInner] },
  highway_motorway_subtle: { "line-color": ink.roadFaint53 },
  railway_transit: { "line-color": ink.rail },
  railway_transit_dashline: { "line-color": ink.railDash },
  railway_service: { "line-color": ink.rail },
  railway_service_dashline: { "line-color": ink.railDash },
  railway: { "line-color": ink.rail },
  railway_dashline: { "line-color": ink.railDash },
  highway_motorway_bridge_casing: { "line-color": ink.roadCasing },
  highway_motorway_bridge_inner: { "line-color": [ink.roadFaint53, ink.roadInner] },
  boundary_3: { "line-color": ink.boundary },
  boundary_2: { "line-color": ink.boundary },
  boundary_disputed: { "line-color": ink.boundary },
  waterway_line_label: { "text-color": ink.labelWaterway, "text-halo-color": ink.haloSoft },
  water_name_point_label: { "text-color": ink.labelWaterBody, "text-halo-color": ink.haloSoft },
  water_name_line_label: { "text-color": ink.labelWaterBody, "text-halo-color": ink.haloSoft },
  "highway-name-path": { "text-color": ink.labelPath, "text-halo-color": ink.haloPath },
  "highway-name-minor": { "text-color": ink.labelRoad },
  "highway-name-major": { "text-color": ink.labelRoad },
  airport: { "text-color": ink.labelRoad, "text-halo-color": ink.halo },
  label_other: { "text-color": ink.labelPlaceMinor, "text-halo-color": ink.halo },
  label_village: { "text-color": ink.labelPlace, "text-halo-color": ink.halo },
  label_town: { "text-color": ink.labelPlace, "text-halo-color": ink.halo },
  label_state: { "text-color": ink.labelPlaceMinor, "text-halo-color": ink.halo },
  label_city: { "text-color": ink.labelPlace, "text-halo-color": ink.halo },
  label_city_capital: { "text-color": ink.labelPlace, "text-halo-color": ink.halo },
  label_country_3: { "text-color": ink.labelPlace, "text-halo-color": ink.halo },
  label_country_2: { "text-color": ink.labelPlace, "text-halo-color": ink.halo },
  label_country_1: { "text-color": ink.labelPlace, "text-halo-color": ink.halo },
};

const isColour = (v) => typeof v === "string" && /^(#|rgba?\(|hsla?\()/.test(v);

function reink(style) {
  const out = structuredClone(style);
  for (const layer of out.layers) {
    const table = paint[layer.id] || {};
    for (const [prop, value] of Object.entries(layer.paint || {})) {
      const replacement = table[prop];
      if (isColour(value)) {
        if (typeof replacement !== "string") {
          throw new Error(`no ink for ${layer.id}.${prop} (${value})`);
        }
        layer.paint[prop] = replacement;
        continue;
      }
      // An expression: swap the colour literals inside it in the order they appear and leave the
      // stops, the operator and everything else exactly where upstream put them.
      if (Array.isArray(value) && value.some(isColour)) {
        const ramp = Array.isArray(replacement) ? [...replacement] : null;
        if (!ramp) throw new Error(`no ink ramp for ${layer.id}.${prop}`);
        layer.paint[prop] = value.map((v) => (isColour(v) ? ramp.shift() : v));
        if (ramp.length) throw new Error(`ink ramp for ${layer.id}.${prop} has spare colours`);
        continue;
      }
      if (JSON.stringify(value).match(/"#|"rgb|"hsl/)) {
        throw new Error(`unreached colour inside ${layer.id}.${prop}`);
      }
    }
  }
  // JSON takes no comments, so the provenance that would be a comment lives here instead. MapLibre
  // ignores top-level metadata, and everything a renderer reads is untouched above.
  out.metadata = {
    "ofm:source": SOURCE,
    "ofm:fetched": "2026-09-18",
    "ofm:note":
      "OpenFreeMap positron, re-inked for this app's dark palette by vendor/positron-dark.build.mjs. " +
      "Only colours differ from upstream; sources, sprite, glyphs, layer order, filters and zoom " +
      "stops are byte-identical, so tiles and attribution still come from tiles.openfreemap.org.",
  };
  return out;
}

// --- the check -------------------------------------------------------------------------------
// Relative luminance and contrast per WCAG 2.1, for hex only - which is all the inks that have to
// be measured are. Map labels are not body text, so 4:1 is the bar here rather than 4.5:1; what
// this actually catches is the regression where a label ends up within a shade of what is behind it.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function check(style, upstream) {
  const ids = (s) => s.layers.map((l) => l.id).join(",");
  const bodies = (s) =>
    JSON.stringify(s.layers.map(({ paint, ...rest }) => rest));

  const must = (ok, why) => { if (!ok) throw new Error(why); };

  // Nothing that decides WHERE a pixel goes, or WHERE it is fetched from, may have moved.
  //
  // The host is pinned as well as compared, because comparing against upstream is circular on
  // exactly the question the file's own comment answers: if OpenFreeMap ever served a positron
  // pointing somewhere else, "sources changed" would stay silent, the new host would be written
  // into the vendored JSON, and the sentence above saying the CSP is unchanged would be false
  // with nothing to notice it. Reviewed as a sub-threshold note in the security review of the
  // commit that added this file.
  const hosts = (s) => [...JSON.stringify(s).matchAll(/https?:\/\/([^/"]+)/g)].map((m) => m[1]);
  must(hosts(style).every((h) => h === "tiles.openfreemap.org"),
    `a URL points somewhere other than tiles.openfreemap.org: ${
      [...new Set(hosts(style))].filter((h) => h !== "tiles.openfreemap.org").join(", ")}`);
  must(JSON.stringify(style.sources) === JSON.stringify(upstream.sources), "sources changed");
  must(style.glyphs === upstream.glyphs, "glyphs changed");
  must(style.sprite === upstream.sprite, "sprite changed");
  must(style.version === upstream.version, "style version changed");
  must(ids(style) === ids(upstream), "layer ids or order changed");
  must(bodies(style) === bodies(upstream), "a layer's filter, source or zoom range changed");

  // The page must not have a hole punched in it, and everything drawn on the land must be
  // distinguishable from the land.
  must(lum(ink.land) > lum("#0f172a"), "land is darker than the page");
  must(lum(ink.land) > lum("#1e293b"), "land is darker than the card it sits on");
  for (const [name, c] of [["water", ink.water], ["building", ink.building],
                           ["road", ink.roadInner], ["casing", ink.roadCasing]]) {
    must(contrast(c, ink.land) >= 1.25, `${name} is indistinguishable from land`);
  }

  // Labels, against whatever is actually behind each one.
  const legible = [
    ["place names on land", ink.labelPlace, ink.land],
    ["place names on their halo", ink.labelPlace, ink.halo],
    ["minor place names on land", ink.labelPlaceMinor, ink.land],
    ["road names on the road", ink.labelRoad, ink.roadInner],
    ["road names on land", ink.labelRoad, ink.land],
    ["path names on land", ink.labelPath, ink.land],
    ["waterway names on water", ink.labelWaterway, ink.water],
    ["water body names on water", ink.labelWaterBody, ink.water],
  ];
  for (const [what, fg, bg] of legible) {
    const ratio = contrast(fg, bg);
    must(ratio >= 4, `${what}: ${ratio.toFixed(2)}:1`);
  }
  return legible.map(([what, fg, bg]) => `${what}: ${contrast(fg, bg).toFixed(2)}:1`);
}

// Upstream is fetched every run rather than kept as a second copy in this directory: a stale
// snapshot nobody refetches is exactly the unmaintainable blob this file exists to prevent, and
// everything /vendor holds is also served to the app, so a 25 KB source style nothing reads would
// be shipped to every reader for nothing.
const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE} -> ${res.status}`);
const upstream = await res.json();

const style = reink(upstream);
const report = check(style, upstream);
const json = JSON.stringify(style, null, 2) + "\n";

if (process.argv.includes("--write")) {
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT} (${style.layers.length} layers)`);
} else if (readFileSync(OUT, "utf8") !== json) {
  throw new Error("positron-dark.json is not what this file's table builds - run with --write");
} else {
  console.log(`positron-dark.json matches upstream re-inked (${style.layers.length} layers)`);
}
console.log(report.join("\n"));
