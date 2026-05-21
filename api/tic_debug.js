export const config = { runtime: "nodejs" };

const KEY = "3d022b35a44eabf7bb45dbdd9a1cfa01";

export default async function handler(req, res) {
  // Japan, China TIC 시리즈 탐색
  const searches = [
    "treasury securities japan foreign holders",
    "treasury securities china foreign holders",
  ];
  const results = {};
  for (const q of searches) {
    const url = `https://api.stlouisfed.org/fred/series/search?search_text=${encodeURIComponent(q)}&api_key=${KEY}&file_type=json&limit=5&order_by=popularity`;
    try {
      const r = await fetch(url);
      const d = await r.json();
      results[q] = (d.seriess || []).map(s => ({ id: s.id, title: s.title, freq: s.frequency, obs_start: s.observation_start }));
    } catch (e) {
      results[q] = { error: e.message };
    }
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json(results);
}
