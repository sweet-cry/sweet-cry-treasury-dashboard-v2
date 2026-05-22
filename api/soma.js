/**
 * NY Fed SOMA Holdings API
 * UST 만기 래더 + MBS 발행기관 비중 반환
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // 1. 최신 기준일 조회
    const datesRes = await fetch(
      'https://markets.newyorkfed.org/api/soma/asofdates/list.json',
      { headers: { 'User-Agent': 'FedLiquidityDashboard/1.0' } }
    );
    const datesData = await datesRes.json();
    const latestDate = datesData.soma.asOfDates[0];

    // 2. 전체 보유 종목 조회
    const holdRes = await fetch(
      `https://markets.newyorkfed.org/api/soma/holdings/date/${latestDate}.json`,
      { headers: { 'User-Agent': 'FedLiquidityDashboard/1.0' } }
    );
    const holdData = await holdRes.json();
    const holdings = holdData.soma.holdings || [];

    const ref = new Date(latestDate);
    const buckets = { lt1y: 0, y1to3: 0, y3to5: 0, y5to7: 0, y7to10: 0, y10to20: 0, gt20y: 0 };
    const monthly = {};
    const mbsAgency = { FNMA: 0, FHLMC: 0, GNMA: 0, OTHER: 0 };
    let totalUST = 0, weightedYears = 0;

    for (const h of holdings) {
      const par = parseFloat(h.parValue) || 0;
      const parB = par / 1e9;
      const type = (h.securityType || '').toLowerCase();
      const desc = (h.securityDesc || '').toUpperCase();

      const isMBS = type.includes('mbs') || type.includes('mortgage') ||
                    desc.includes('UMBS') || desc.includes('FNMA') ||
                    desc.includes('FHLMC') || desc.includes('GNMA');
      const isUST = !isMBS && (
        type.includes('treasury') || type.includes('bill') ||
        type.includes('note') || type.includes('bond') ||
        type.includes('tips') || type.includes('frn') ||
        type.includes('inflation')
      );

      if (isMBS) {
        if (desc.includes('FNMA') || desc.includes('FANNIE'))      mbsAgency.FNMA  += parB;
        else if (desc.includes('FHLMC') || desc.includes('FREDDIE')) mbsAgency.FHLMC += parB;
        else if (desc.includes('GNMA') || desc.includes('GINNIE'))   mbsAgency.GNMA  += parB;
        else mbsAgency.OTHER += parB;
      } else if (isUST && h.maturityDate) {
        const mat = new Date(h.maturityDate);
        if (isNaN(mat.getTime())) continue;
        const years = (mat - ref) / (365.25 * 86400000);
        if (years <= 0) continue;

        if      (years <= 1)  buckets.lt1y   += parB;
        else if (years <= 3)  buckets.y1to3  += parB;
        else if (years <= 5)  buckets.y3to5  += parB;
        else if (years <= 7)  buckets.y5to7  += parB;
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
    }

    // 반올림
    Object.keys(buckets).forEach(k => { buckets[k] = Math.round(buckets[k]); });
    Object.keys(monthly).forEach(k => { monthly[k] = Math.round(monthly[k]); });
    Object.keys(mbsAgency).forEach(k => { mbsAgency[k] = Math.round(mbsAgency[k]); });

    const wam = totalUST > 0 ? parseFloat((weightedYears / totalUST).toFixed(2)) : 0;

    res.json({
      asOfDate: latestDate,
      ust: {
        buckets,
        monthly,
        totalB:   Math.round(totalUST),
        wamYears: wam
      },
      mbs: { byAgency: mbsAgency }
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
