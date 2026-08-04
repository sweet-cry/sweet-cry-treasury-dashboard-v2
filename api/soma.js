/**
 * NY Fed SOMA Holdings API
 * UST 만기 래더 + MBS 발행기관 비중 반환
 *
 * 경로 주의: 구 /api/soma/holdings/date/{date}.json 은 현재 HTTP 400(빈 본문)을 반환한다.
 * 현행 경로는 국채/에이전시가 분리되어 있고 스키마도 서로 다르다.
 *   tsy    : parValue + inflationCompensation  (TIPS 원금조정을 더해야 TREAST와 일치)
 *   agency : currentFaceValue, issuer 필드 없음 → CUSIP 접두로 발행기관 귀속
 */

// UMBS 도입으로 securityDescription만으로는 Fannie/Freddie가 갈리지 않아 CUSIP 접두를 쓴다.
const FNMA_PFX  = ['3138', '3140', '3141'];
const FHLMC_PFX = ['3128', '3132', '3133', '3134', '3137'];

function mbsAgencyOf(cusip) {
  const c = cusip || '';
  if (FNMA_PFX.includes(c.slice(0, 4)))  return 'FNMA';
  if (FHLMC_PFX.includes(c.slice(0, 4))) return 'FHLMC';
  if (/^(36|38)/.test(c)) return 'GNMA';   // Ginnie Mae는 36xx·38xx 대역
  return 'OTHER';
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'FedLiquidityDashboard/1.0' } });
  const t = await r.text();
  if (!r.ok || !t) throw new Error(`${url.split('/api/soma/')[1]} → HTTP ${r.status} (${t.length}B)`);
  return JSON.parse(t);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // 1. 최신 기준일 (주간 · 매주 수요일)
    const datesData = await getJson('https://markets.newyorkfed.org/api/soma/asofdates/list.json');
    const latestDate = datesData.soma.asOfDates[0];

    // 2. 국채 + 에이전시 병렬 조회
    const [tsyData, agyData] = await Promise.all([
      getJson(`https://markets.newyorkfed.org/api/soma/tsy/get/all/asof/${latestDate}.json`),
      getJson(`https://markets.newyorkfed.org/api/soma/agency/get/all/asof/${latestDate}.json`)
    ]);

    const ref = new Date(latestDate);
    const buckets = { lt1y: 0, y1to3: 0, y3to5: 0, y5to7: 0, y7to10: 0, y10to20: 0, gt20y: 0 };
    const monthly = {};
    let totalUST = 0, weightedYears = 0;

    for (const h of tsyData.soma.holdings || []) {
      if (!h.maturityDate) continue;
      const mat = new Date(h.maturityDate);
      if (isNaN(mat.getTime())) continue;
      const years = (mat - ref) / (365.25 * 86400000);
      if (years <= 0) continue;

      // TIPS는 원금조정분을 더해야 H.4.1(TREAST) 기준과 맞는다
      const parB = ((parseFloat(h.parValue) || 0) +
                    (parseFloat(h.inflationCompensation) || 0)) / 1e9;

      if      (years <= 1)  buckets.lt1y    += parB;
      else if (years <= 3)  buckets.y1to3   += parB;
      else if (years <= 5)  buckets.y3to5   += parB;
      else if (years <= 7)  buckets.y5to7   += parB;
      else if (years <= 10) buckets.y7to10  += parB;
      else if (years <= 20) buckets.y10to20 += parB;
      else                  buckets.gt20y   += parB;

      totalUST      += parB;
      weightedYears += parB * years;

      // 월별 만기 (12개월 이내)
      if (years <= 1) {
        const key = `${mat.getFullYear()}-${String(mat.getMonth() + 1).padStart(2, '0')}`;
        monthly[key] = (monthly[key] || 0) + parB;
      }
    }

    const mbsAgency = { FNMA: 0, FHLMC: 0, GNMA: 0, OTHER: 0 };
    for (const h of agyData.soma.holdings || []) {
      // 'Agency Debts'(비MBS 채권)는 제외 — MBS + CMBS만 WSHOMCB에 대응
      if (h.securityType !== 'MBS' && h.securityType !== 'CMBS') continue;
      mbsAgency[mbsAgencyOf(h.cusip)] += (parseFloat(h.currentFaceValue) || 0) / 1e9;
    }

    Object.keys(buckets).forEach(k   => { buckets[k]   = Math.round(buckets[k]); });
    Object.keys(monthly).forEach(k   => { monthly[k]   = Math.round(monthly[k]); });
    Object.keys(mbsAgency).forEach(k => { mbsAgency[k] = Math.round(mbsAgency[k]); });

    const wam = totalUST > 0 ? parseFloat((weightedYears / totalUST).toFixed(2)) : 0;

    // 주간 갱신 데이터 — 응답이 1.8MB라 CDN 캐시 없이는 매 로드마다 NY Fed를 때린다
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
    res.json({
      asOfDate: latestDate,
      ust: { buckets, monthly, totalB: Math.round(totalUST), wamYears: wam },
      mbs: { byAgency: mbsAgency }
    });

  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: e.message });
  }
}
