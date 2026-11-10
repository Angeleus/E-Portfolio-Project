// Pilot region: Los Angeles, Orange and Ventura counties.
const C = (name, county, lat, lng) => ({ name, county, lat, lng });
export const COUNTIES = ['Los Angeles', 'Orange', 'Ventura'];
export const CITIES = [
  C('Downtown Los Angeles', 'Los Angeles', 34.0522, -118.2437),
  C('Hollywood', 'Los Angeles', 34.0928, -118.3287),
  C('West Hollywood', 'Los Angeles', 34.09, -118.3617),
  C('Silver Lake', 'Los Angeles', 34.0869, -118.2702),
  C('Highland Park', 'Los Angeles', 34.1114, -118.192),
  C('Beverly Hills', 'Los Angeles', 34.0736, -118.4004),
  C('Culver City', 'Los Angeles', 34.0211, -118.3965),
  C('Santa Monica', 'Los Angeles', 34.0195, -118.4912),
  C('Venice', 'Los Angeles', 33.985, -118.4695),
  C('Malibu', 'Los Angeles', 34.0259, -118.7798),
  C('Manhattan Beach', 'Los Angeles', 33.8847, -118.4109),
  C('Torrance', 'Los Angeles', 33.8358, -118.3406),
  C('Rancho Palos Verdes', 'Los Angeles', 33.7445, -118.387),
  C('Long Beach', 'Los Angeles', 33.7701, -118.1937),
  C('Pasadena', 'Los Angeles', 34.1478, -118.1445),
  C('Glendale', 'Los Angeles', 34.1425, -118.2551),
  C('Burbank', 'Los Angeles', 34.1808, -118.309),
  C('Sherman Oaks', 'Los Angeles', 34.149, -118.4514),
  C('Santa Clarita', 'Los Angeles', 34.3917, -118.5426),
  C('Anaheim', 'Orange', 33.8366, -117.9143),
  C('Fullerton', 'Orange', 33.8704, -117.9242),
  C('Orange', 'Orange', 33.7879, -117.8531),
  C('Santa Ana', 'Orange', 33.7455, -117.8677),
  C('Irvine', 'Orange', 33.6846, -117.8265),
  C('Costa Mesa', 'Orange', 33.6411, -117.9187),
  C('Huntington Beach', 'Orange', 33.6603, -117.9992),
  C('Newport Beach', 'Orange', 33.6189, -117.9298),
  C('Laguna Beach', 'Orange', 33.5427, -117.7854),
  C('Mission Viejo', 'Orange', 33.6, -117.672),
  C('Dana Point', 'Orange', 33.4672, -117.6981),
  C('San Juan Capistrano', 'Orange', 33.5017, -117.6626),
  C('San Clemente', 'Orange', 33.427, -117.612),
  C('Ventura', 'Ventura', 34.2805, -119.2945),
  C('Oxnard', 'Ventura', 34.1975, -119.1771),
  C('Camarillo', 'Ventura', 34.2164, -119.0376),
  C('Thousand Oaks', 'Ventura', 34.1706, -118.8376),
  C('Simi Valley', 'Ventura', 34.2694, -118.7815),
  C('Moorpark', 'Ventura', 34.2856, -118.882),
  C('Ojai', 'Ventura', 34.448, -119.2429),
];

export function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const findCity = (name) =>
  CITIES.find((c) => c.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null;

// Nearest pilot city within 25 km, or null when the point is outside the pilot region.
export function nearestCity(point) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;
  let best = null;
  for (const c of CITIES) {
    const d = km(point, c);
    if (!best || d < best.d) best = { c, d };
  }
  return best && best.d <= 25 ? best.c : null;
}

// Rough drive time for LA-area surface streets and freeways at date-night hours.
export const driveMinutes = (distKm) => Math.max(10, Math.ceil((distKm * 1.4) / 35 * 60 / 5) * 5);
