export default async function handler(req, res) {
  const { series, count = '90', freq } = req.query;
  if (!series) return res.status(400).json({ error: 'series required' });
  const KEY = '3d022b35a44eabf7bb45dbdd9a1cfa01';
  let url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${KEY}&file_type=json&sort_order=desc&limit=${count}`;
  if (freq) url += `&frequency=${freq}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600');
    res.status(200).json(d);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
