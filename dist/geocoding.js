'use strict';
const EWGeo = (() => {
  const normalize = q => q.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  const valid = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && typeof p.display_name === 'string' && p.display_name.trim();
  function known(query, landmarks) {
    const q = normalize(query);
    return landmarks.filter(p => valid(p) && p.aliases.some(a => [a, a + ', ' + p.country, a + ' ' + p.country].some(s => normalize(s) === q)));
  }
  function photon(data) {
    if (!Array.isArray(data?.features)) throw Error('Unexpected place-search response.');
    return data.features.flatMap(f => {
      const g = f?.geometry, p = f?.properties || {};
      if (g?.type !== 'Point' || !Array.isArray(g.coordinates)) return [];
      const result = {lat:g.coordinates[1], lon:g.coordinates[0], display_name:[...new Set([p.name,p.city,p.state,p.country].filter(v => typeof v === 'string' && v.trim()))].join(', '), provider:'Photon / OpenStreetMap'};
      return valid(result) ? [result] : [];
    }).slice(0, 5);
  }
  function cities(data) {
    if (!data || (data.results !== undefined && !Array.isArray(data.results))) throw Error('Unexpected city-search response.');
    return (data.results || []).map(p => ({lat:p.latitude,lon:p.longitude,display_name:[...new Set([p.name,p.admin1,p.country].filter(v => typeof v === 'string' && v.trim()))].join(', '),provider:'Open-Meteo / GeoNames'})).filter(valid).slice(0,5);
  }
  async function lookup(query, getJSON, landmarks = []) {
    query = query.trim();
    if (query.length < 2 || query.length > 150) throw Error('Place name must contain 2–150 characters.');
    const local = known(query, landmarks);
    if (local.length) return local;
    const providers = [
      ['https://photon.komoot.io/api/?' + new URLSearchParams({q:query,limit:5,lang:'en'}), photon],
      ['https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({name:query,count:5,language:'en',format:'json'}), cities]
    ];
    let failed = false;
    for (const [url, parse] of providers) {
      try { const results = parse(await getJSON(url)); if(results.length) return results; }
      catch { failed = true; }
    }
    if (failed) throw Error('Place search is partly unavailable. Retry, enter latitude, longitude, or click the map.');
    return [];
  }
  return {known, photon, cities, lookup};
})();
if (typeof module !== 'undefined') module.exports = EWGeo;
