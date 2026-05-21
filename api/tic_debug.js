export const config = { runtime: "nodejs" };

const KEY = "3d022b35a44eabf7bb45dbdd9a1cfa01";

export default async function handler(req, res) {
  // Japan, China TIC 시리즈 탐색
  const results = {};
  // TIC 관련 FRED 릴리스 탐색
  try {
    const r1 = await fetch(`https://api.stlouisfed.org/fred/releases/search?search_text=treasury+international+capital&api_key=${KEY}&file_type=json&limit=10`);
    const d1 = await r1.json();
    results.releases = (d1.releases || []).map(r => ({ id: r.id, name: r.name }));
  } catch(e) { results.releases = { error: e.message }; }

  // 릴리스 209 시리즈 목록 시도
  try {
    const r2 = await fetch(`https://api.stlouisfed.org/fred/release/series?release_id=209&api_key=${KEY}&file_type=json&limit=20`);
    const d2 = await r2.json();
    results.release209 = (d2.seriess || []).map(s => ({ id: s.id, title: s.title, freq: s.frequency }));
  } catch(e) { results.release209 = { error: e.message }; }

  // "major foreign" 텍스트 검색
  try {
    const r3 = await fetch(`https://api.stlouisfed.org/fred/series/search?search_text=major+foreign+holders&api_key=${KEY}&file_type=json&limit=10&order_by=popularity`);
    const d3 = await r3.json();
    results.search = (d3.seriess || []).map(s => ({ id: s.id, title: s.title, freq: s.frequency, obs_start: s.observation_start }));
  } catch(e) { results.search = { error: e.message }; }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json(results);
}
