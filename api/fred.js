export const config = { runtime: 'nodejs' };

// FRED 시리즈별 캐시 전략
// 주간 발표(H.4.1 계열): 발표 직후 10분, 평시 6시간
// 일간 발표: 발표 직후 5분, 평시 2시간
// 월간/분기: 24시간
function getCacheMaxAge(series) {
  const now = new Date();
  const day = now.getUTCDay();  // 0=Sun, 4=Thu, 5=Fri
  const hourET = (now.getUTCHours() - 4 + 24) % 24;  // ET = UTC-4 (DST 기준 근사)

  // H.4.1 주간 지표
  const weeklyH41 = ['WALCL','TREAST','WSHOMCB','H41RESPPALDKNWW','WLCFLL','WLCFLPCL','WRESBAL','WDTGAL'];
  if (weeklyH41.includes(series)) {
    // 목요일 16:30 ET ~ 금요일 10:00 ET: 짧은 캐시 (10분)
    if ((day === 4 && hourET >= 16) || (day === 5 && hourET < 10)) return 600;
    return 21600;  // 평시 6시간
  }

  // 일간 지표 (SOFR, IORB, SP500, RRPONTSYD 등)
  const daily = ['SOFR','IORB','DTB3','EFFR','T10Y2Y','SP500','RRPONTSYD','RPONTSYD','SOFR99'];
  if (daily.includes(series)) {
    // 17:00~20:00 ET (FRED 일간 업데이트 직후): 5분
    if (hourET >= 17 && hourET < 20) return 300;
    return 7200;  // 평시 2시간
  }

  // 월간/분기 (M2SL, GDP 등): 24시간
  return 86400;
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const series = url.searchParams.get('series');
  const count = url.searchParams.get('count') || '90';
  const freq = url.searchParams.get('freq') || '';
  if (!series) return res.status(400).json({ error: 'series required' });

  // 키는 코드에 두지 않는다(공개 저장소) — Vercel 프로젝트 환경변수 FRED_API_KEY
  const KEY = process.env.FRED_API_KEY;
  if (!KEY) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'FRED_API_KEY 환경변수가 설정되지 않음' });
  }
  let fredUrl = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${KEY}&file_type=json&sort_order=desc&limit=${count}`;
  if (freq) fredUrl += `&frequency=${freq}`;

  try {
    const r = await fetch(fredUrl);
    const d = await r.json();

    // FRED rate limit (429) 또는 에러 코드 → 503 반환 (stale-while-revalidate로 캐시 유지)
    if (d.error_code === 429 || d.error_message?.includes('Too Many')) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'FRED rate limit', retry_after: 60 });
    }

    // 429 외의 FRED 오류(잘못된 시리즈·일시 장애 등)나 관측치 없는 응답은 캐시하지 않는다.
    // 예전엔 이런 응답도 200으로 s-maxage(최대 6시간) 동안 CDN에 남아, 몇 초짜리 장애가 몇 시간짜리 빈 차트가 됐다.
    // 프론트 fred()는 observations가 없으면 빈 배열로 처리하므로 본문 모양은 그대로 둔다.
    if (!r.ok || d.error_code || !Array.isArray(d.observations)) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(d);
    }

    const maxAge = getCacheMaxAge(series);
    res.setHeader('Access-Control-Allow-Origin', '*');
    // stale-while-revalidate 대폭 증가 → CDN이 백그라운드 갱신 중에도 캐시 제공
    res.setHeader('Cache-Control', `s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
    res.status(200).json(d);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: e.message });
  }
}
