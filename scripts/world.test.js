'use strict';

/**
 * The arithmetic behind /world/: where a plane has got to between answers, what is above a point,
 * and how those read in the panel.
 *   node scripts/world.test.js
 *
 * world-core.js has no imports, so it runs in a vm as the browser runs it, with `export ` stripped
 * (the technique live-buses.test.js uses). Orbits go through the real vendored satellite.js.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app/scripts/world-core.js'), 'utf8')
  .replace(/^export /gm, '');
const NAMES = ['distanceKm', 'advance', 'planeFeatures', 'nearest', 'sky', 'groundTrack',
  'buildingFacts', 'compass', 'planeLine', 'liveLine', 'fuzzyScore', 'localMatches', 'placeName', 'alertFeatures', 'ago', 'REGIONS', 'placeCard', 'airportCard', 'emptyCard', 'PLACES'];
const core = {};
vm.runInNewContext(`${SRC}\n${NAMES.map((n) => `this.${n} = ${n};`).join('\n')}`, core);

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };
const close = (a, b, within, what) => assert.ok(Math.abs(a - b) <= within, `${what}: ${a} vs ${b}`);

const PLANE = { id: 'a', callsign: 'SAS1', reg: 'EI', type: 'A20N', lat: 59.8, lon: 17.6, altitude: 3048, ground: false, speed: 720, track: 90 };

// ISS elements from CelesTrak, 2026-11-03.
const ISS = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: '2026-11-03T12:44:31.841376',
  MEAN_MOTION: 15.49164192, ECCENTRICITY: 0.0007153, INCLINATION: 51.633, RA_OF_ASC_NODE: 330.5488,
  ARG_OF_PERICENTER: 343.6919, MEAN_ANOMALY: 16.3838, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 59335, BSTAR: 0.0001053,
  MEAN_MOTION_DOT: 5.389e-5, MEAN_MOTION_DDOT: 0,
};

(async () => {
  const orbit = await import(path.join(__dirname, '..', 'vendor/satellite.mjs'));

  close(core.distanceKm({ lat: 59.8586, lon: 17.6389 }, { lat: 59.3293, lon: 18.0686 }), 64.6, 1, 'Uppsala to Stockholm');
  ok('distance is great-circle kilometres');

  {
    const moved = core.advance(PLANE, 60);
    close(core.distanceKm(PLANE, moved), 12, 0.05, 'one minute at 720 km/h');
    assert.ok(moved.lon > PLANE.lon);
    close(moved.lat, PLANE.lat, 1e-9, 'due east keeps the latitude');
    ok('a plane moves on along its track between answers');
    assert.deepStrictEqual(core.advance({ ...PLANE, ground: true }, 60), { ...PLANE, ground: true });
    assert.deepStrictEqual(core.advance({ ...PLANE, track: null }, 60), { ...PLANE, track: null });
    ok('a plane on the ground or with no track stays where it was reported');
    const late = core.advance(PLANE, 3600);
    close(core.distanceKm(PLANE, late), 24, 0.1, 'capped');
    ok('dead reckoning stops after two minutes rather than flying a plane off on old news');
  }

  {
    const fc = core.planeFeatures([PLANE, { ...PLANE, id: 'b', callsign: '', reg: 'SE-ABC' }, { ...PLANE, id: 'c', callsign: '', reg: '' }], 0);
    assert.deepStrictEqual(Array.from(fc.features, (f) => f.properties.label), ['SAS1', 'SE-ABC', 'c']);
    assert.deepStrictEqual(Array.from(fc.features[0].geometry.coordinates), [17.6, 59.8]);
    assert.strictEqual(fc.features[0].properties.track, 90);
    ok('each plane is a point labelled by the best name it has');
  }

  {
    const far = { ...PLANE, id: 'far', lat: 62 };
    const near = { ...PLANE, id: 'near', lat: 59.81 };
    const list = core.nearest([far, near], { lat: 59.8, lon: 17.6 }, 1);
    assert.deepStrictEqual(Array.from(list, (p) => p.id), ['near']);
    close(list[0].km, 1.1, 0.1, 'km');
    ok('the panel lists the nearest planes with their distance');
  }

  {
    const rec = { id: 25544, name: 'ISS (ZARYA)', satrec: orbit.json2satrec(ISS) };
    const when = new Date('2026-11-04T00:00:00Z');
    const seen = core.sky([rec], { lat: 0, lon: 0 }, when, orbit);
    assert.strictEqual(seen.points.features.length, 1);
    const [lon, lat] = seen.points.features[0].geometry.coordinates;
    assert.ok(Math.abs(lat) <= 52, 'an ISS ground point stays inside its inclination');
    close(seen.points.features[0].properties.altitude, 420, 25, 'ISS altitude km');
    const under = core.sky([rec], { lat, lon }, when, orbit);
    assert.strictEqual(under.overhead.length, 1);
    close(under.overhead[0].elevation, 90, 2, 'elevation directly under it');
    const opposite = core.sky([rec], { lat: -lat, lon: lon > 0 ? lon - 180 : lon + 180 }, when, orbit);
    assert.strictEqual(opposite.overhead.length, 0);
    ok('a satellite is overhead from beneath it and not from the far side of the planet');
    const high = { id: 2, name: 'CXO', satrec: orbit.json2satrec({ ...ISS, MEAN_MOTION: 0.378, ECCENTRICITY: 0.0001 }) };
    const [hlon, hlat] = core.sky([high], { lat: 0, lon: 0 }, when, orbit).points.features[0].geometry.coordinates;
    assert.strictEqual(core.sky([high], { lat: hlat, lon: hlon }, when, orbit).overhead.length, 0);
    ok('an observatory 100,000 km out is not "overhead" on a street map');
    const dead = { id: 1, name: 'decayed', satrec: orbit.json2satrec({ ...ISS, EPOCH: '1990-01-01T00:00:00' }) };
    assert.strictEqual(core.sky([dead, rec], { lat: 0, lon: 0 }, when, orbit).points.features.length, 1);
    ok('an orbit that no longer computes is left out rather than throwing');
    const track = core.groundTrack(rec, when, orbit);
    assert.strictEqual(track.type, 'Feature');
    assert.strictEqual(track.geometry.type, 'MultiLineString');
    for (const line of track.geometry.coordinates) {
      for (let i = 1; i < line.length; i++) assert.ok(Math.abs(line[i][0] - line[i - 1][0]) < 180, 'no line across the map at the date line');
    }
    ok('a ground track breaks at the date line');
  }

  assert.deepStrictEqual(Array.from(core.buildingFacts({ render_height: 18, render_min_height: 0 })), ['18 m tall', 'About 6 floors']);
  assert.deepStrictEqual(Array.from(core.buildingFacts({})), ['Height not mapped']);
  ok('a building says what OpenStreetMap knows and admits what it does not');

  assert.strictEqual(core.compass(0), 'N');
  assert.strictEqual(core.compass(359), 'N');
  assert.strictEqual(core.compass(135), 'SE');
  ok('a track reads as a compass point');

  assert.strictEqual(core.planeLine(PLANE), '3,048 m · 720 km/h · E');
  assert.strictEqual(core.planeLine({ ...PLANE, ground: true }), 'On the ground');
  assert.strictEqual(core.planeLine({ ...PLANE, speed: null, track: null }), '3,048 m');
  ok('a plane reads as altitude, speed and heading, leaving out what is unknown');

  const now = Date.parse('2026-11-04T12:00:30Z');
  assert.strictEqual(core.liveLine({ data: { updatedAt: '2026-11-04T12:00:00Z', stale: false }, now }), 'Updated 30 s ago');
  assert.strictEqual(core.liveLine({ data: { reason: 'daily_limit', stale: true }, now }), 'Planes paused for today (daily limit)');
  assert.strictEqual(core.liveLine({ data: { reason: 'upstream', stale: true }, now }), 'Planes unavailable right now');
  assert.strictEqual(core.liveLine({ error: {}, now }), 'Planes unavailable right now');
  ok('the status line says what happened in words');

  assert.ok(core.fuzzyScore('sas1', 'SAS1428') > core.fuzzyScore('sas1', 'VSAS1'));
  ok('a prefix beats a match in the middle');
  assert.ok(core.fuzzyScore('hubbel', 'HST (Hubble)') > 0);
  assert.ok(core.fuzzyScore('iss', 'ISS (ZARYA)') > 0);
  assert.ok(core.fuzzyScore('malmo', 'Malmö') > 0);
  assert.ok(core.fuzzyScore('frolunda', 'Frölunda') > 0);
  ok('a typo or a missing accent still finds it');
  assert.strictEqual(core.fuzzyScore('zebra', 'ISS (ZARYA)'), 0);
  assert.strictEqual(core.fuzzyScore('', 'ISS'), 0);
  ok('something unrelated does not match');

  {
    const m = core.localMatches('sas', {
      planes: [PLANE, { ...PLANE, id: 'b', callsign: 'DLH4' }],
      satellites: [{ id: 1, name: 'SASSI' }, { id: 2, name: 'ISS' }],
      alerts: [{ id: 'x', title: 'Sasebo earthquake' }],
    });
    assert.deepStrictEqual(Array.from(m, (r) => `${r.type}:${r.label}`), ['plane:SAS1', 'satellite:SASSI', 'alert:Sasebo earthquake']);
    ok('search also finds what is on the map: planes, satellites and alerts');
  }

  assert.strictEqual(core.placeName({ city: 'Uppsala', county: 'Uppsala County', country: 'Sweden' }, 12), 'Uppsala, Sweden');
  assert.strictEqual(core.placeName({ county: 'Dalarna', country: 'Sweden' }, 9), 'Dalarna, Sweden');
  assert.strictEqual(core.placeName({ city: 'Uppsala', country: 'Sweden' }, 5), 'Sweden');
  assert.strictEqual(core.placeName({ city: 'Uppsala', country: 'Sweden' }, 2), 'World');
  assert.strictEqual(core.placeName({}, 9), 'Open water');
  ok('the panel title widens as the map zooms out');

  {
    const fc = core.alertFeatures([
      { id: 'a', severity: 'high', title: 'M 7', lat: 1, lon: 2 },
      { id: 'b', severity: 'warn', title: 'No position', lat: null, lon: null },
    ]);
    assert.strictEqual(fc.features.length, 1);
    assert.deepStrictEqual(Array.from(fc.features[0].geometry.coordinates), [2, 1]);
    ok('only an alert with a position gets a marker');
  }

  {
    const t = Date.parse('2026-11-04T12:00:00Z');
    assert.strictEqual(core.ago('2026-11-04T11:59:30Z', t), 'now');
    assert.strictEqual(core.ago('2026-11-04T11:15:00Z', t), '45 min ago');
    assert.strictEqual(core.ago('2026-11-04T08:00:00Z', t), '4 h ago');
    assert.strictEqual(core.ago('2026-11-01T12:00:00Z', t), '3 d ago');
    assert.strictEqual(core.ago(null, t), '');
    ok('an alert says how old it is');
  }

  for (const r of core.REGIONS) assert.ok(r.name && r.center.length === 2 && r.zoom > 0, r.name);
  ok('every region has somewhere to go');

  {
    const hospital = core.placeCard({ class: 'hospital', subclass: 'clinic', name: 'Centrumkliniken' });
    assert.strictEqual(hospital.kind, 'Clinic');
    assert.strictEqual(hospital.name, 'Centrumkliniken');
    assert.strictEqual(core.placeCard({ class: 'hospital', subclass: 'hospital', name: 'Akademiska' }).kind, 'Hospital');
    assert.strictEqual(core.placeCard({ class: 'fire_station' }).kind, 'Fire station');
    assert.strictEqual(core.placeCard({ class: 'fire_station' }).name, 'Fire station');
    assert.strictEqual(core.placeCard({ class: 'police', name: 'Polishuset' }).kind, 'Police');
    ok('a place says what it is, and an unnamed one still has a title');
  }
  {
    const card = core.airportCard({ name: 'Stockholm Arlanda', iata: 'ARN', icao: 'ESSA', ele: 42, class: 'international' });
    assert.strictEqual(card.kind, 'International airport');
    assert.deepStrictEqual(Array.from(card.facts), ['ARN · ESSA', 'Elevation 42 m']);
    assert.deepStrictEqual(Array.from(core.airportCard({ name: 'Grass strip', class: 'private' }).facts), []);
    ok('an airport gives its codes and elevation when known');
  }
  {
    const near = { name: 'Sävjaån', km: 8 };
    const card = core.emptyCard({ lat: 59.86123, lon: 17.64059 }, { city: 'Uppsala', country: 'Sweden' }, near);
    assert.strictEqual(card.name, 'Uppsala, Sweden');
    assert.deepStrictEqual(Array.from(card.facts), ['59.8612, 17.6406', 'Nearest camera: Sävjaån, 8 km']);
    assert.strictEqual(core.emptyCard({ lat: 0, lon: -30 }, {}, null).name, 'Open water');
    ok('clicking empty map says what is there');
  }
  assert.ok(!Object.keys(core.PLACES).some((k) => /military|barracks|base/.test(k)));
  ok('no military class is on the map');

  {
    // Firebase restores a session after the module runs, and api() throws until it has. A local
    // preview with a stubbed shell cannot see this, so the wiring is asserted from the source.
    const page = fs.readFileSync(path.join(__dirname, '..', 'app/scripts/world.js'), 'utf8');
    assert.match(page, /^profile\.then\(start\);$/m);
    assert.doesNotMatch(page, /^start\(\);$/m);
    ok('the page waits for sign-in before its first API call');
  }

  console.log(`\nworld: all checks passed (${passed})`);
})().catch((err) => { console.error(err); process.exit(1); });
