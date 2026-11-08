export const config = { runtime: 'nodejs' };

// NY Fed 담보부 기준금리(TGCR 등) 프록시 — FRED에는 TGCR 계열이 없어서 NY Fed API를 직접 읽는다.
// /api/nyfed?type=tgcr&count=520  →  { refRates: [{effectiveDate, percentRate, volumeInBillions, ...}] } (최신순)
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const type = (url.searchParams.get('type') || 'tgcr').toLowerCase();
  const count = Math.min(parseInt(url.searchParams.get('count') || '520', 10) || 520, 1000);
  if (!['tgcr', 'sofr', 'bgcr'].includes(type)) return res.status(400).json({ error: 'type must be tgcr|sofr|bgcr' });
  try {
    const r = await fetch(`https://markets.newyorkfed.org/api/rates/secured/${type}/last/${count}.json`);
    if (!r.ok) return res.status(502).json({ error: 'NY Fed ' + r.status });
    const d = await r.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.status(200).json(d);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
