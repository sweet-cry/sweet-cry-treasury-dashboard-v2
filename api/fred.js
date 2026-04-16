export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const series = url.searchParams.get('series');
  const count = url.searchParams.get('count') || '90';
  const freq = url.searchParams.get('freq') || '';

  if (!series) return res.status(400).json({ error: 'series required' });

  const KEY = '3d022b35a44eabf7bb45dbdd9a1cfa01';
  let fredUrl = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${KEY}&file_type=json&sort_order=desc&limit=${count}`;
  if (freq) fredUrl += `&frequency=${freq}`;

  try {
    const r = await fetch(fredUrl);
    const d = await r.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600');
    res.status(200).json(d);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
