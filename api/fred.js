export const config = { runtime: 'nodejs' };

// FRED 시리즈별 캐시 전략
// 주간 발표(H.4.1 계열): 목·금은 5분, 평시는 1시간
// 일간 발표: 평시 30분
// 월간/분기: 6시간
function getCacheMaxAge(series) {
  const now = new Date();
  const day = now.getUTCDay();  // 0=Sun, 4=Thu, 5=Fri
  const hourET = (now.getUTCHours() - 4 + 24) % 24;  // ET = UTC-4 (DST 기준 근사)
  
  // H.4.1 주간 지표
  const weeklyH41 = ['WALCL','TREAST','MBST','BTFP','DISCBORR','WRESBAL','WDTGAL'];
  if (weeklyH41.includes(series)) {
    // 목요일 16:00 ET ~ 금요일 12:00 ET: 짧은 캐시 (5분)
    if ((day === 4 && hourET >= 16) || (day === 5 && hourET < 12)) return 300;
    return 3600;  // 평시 1시간
  }
  
  // 일간 지표 (SOFR, IORB, SP500, RRPONTSYD 등): 평시 30분
  const daily = ['SOFR','IORB','DTB3','EFFR','T10Y2Y','SP500','RRPONTSYD','RPONTSYD','SOFR99'];
  if (daily.includes(series)) {
    // 17:00 ET 이후 (FRED 일간 업데이트 시간대) 10분
    if (hourET >= 16 && hourET < 20) return 600;
    return 1800;  // 평시 30분
  }
  
  // 월간/분기 (M2SL, GDP 등): 6시간
  return 21600;
}

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
    const maxAge = getCacheMaxAge(series);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', `s-maxage=${maxAge}, stale-while-revalidate=60`);
    res.status(200).json(d);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
