export const config = { runtime: "nodejs" };

// TIPS·FRN은 security_type이 'Note'/'Bond'로 내려오므로 전용 플래그로 되살린다
function classify(x) {
  if (x.inflation_index_security === 'Yes') return 'TIPS';
  if (x.floating_rate === 'Yes') return 'FRN';
  return x.security_type;
}

// 낙찰 지표는 증권 종류마다 다른 필드로 온다. high_yield 하나만 읽으면
//   Bill : 항상 null → 표의 대부분이 '—'
//   FRN  : 항상 null (실제 낙찰은 할인마진)
//   TIPS : 값은 있으나 '실질'금리라 명목물과 같은 칸에서 오독된다
function auctionRate(x, type) {
  const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  if (type === 'Bill') return { v: num(x.high_investment_rate), kind: 'bey' };    // 채권등가수익률
  if (type === 'FRN')  return { v: num(x.high_discnt_margin),   kind: 'margin' }; // 할인마진(%)
  if (type === 'TIPS') return { v: num(x.high_yield),           kind: 'real' };
  return { v: num(x.high_yield), kind: 'nominal' };
}

export default async function handler(req, res) {
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0,10);
    const future = new Date(today.getTime() + 90*24*3600*1000).toISOString().slice(0,10);
    const past   = new Date(today.getTime() - 600*24*3600*1000).toISOString().slice(0,10); // ~20개월

    // security_type은 TIPS·FRN도 'Note'/'Bond'로 내려온다. 실제 구분은 아래 두 플래그로만 가능하며,
    // 이를 빼면 10년 TIPS 실질금리(예: 2.438%)가 명목 10년물 낙찰금리로 표시된다.
    const fields = 'security_type,security_term,offering_amt,auction_date,high_yield,bid_to_cover_ratio'
                 + ',inflation_index_security,floating_rate,high_investment_rate,high_discnt_margin';
    const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query`
      + `?fields=${fields}&filter=auction_date:gte:${past},auction_date:lte:${future}`
      + `&sort=auction_date&page[size]=2000`;

    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const d = await r.json();
    const rows = (d.data || []).filter(x => x.offering_amt && x.offering_amt !== 'null');

    // 분기별 집계
    const qMap = {};
    for (const x of rows) {
      const amt = parseFloat(x.offering_amt) / 1e9;
      if (isNaN(amt) || amt <= 0) continue;
      const [y, m] = x.auction_date.split('-').map(Number);
      const key = `${y}-Q${Math.ceil(m/3)}`;
      if (!qMap[key]) qMap[key] = { q: key, bill:0, note:0, bond:0, tips:0, frn:0, total:0, announced:0 };
      const t = classify(x);
      if (t==='Bill') qMap[key].bill += amt;
      else if (t==='Note') qMap[key].note += amt;
      else if (t==='Bond') qMap[key].bond += amt;
      else if (t==='TIPS') qMap[key].tips += amt;
      else if (t==='FRN')  qMap[key].frn  += amt;
      qMap[key].total += amt;
      // 공고분(= 경매 공고는 났으나 아직 낙찰 전) 분리.
      //
      // auctions_query는 확정된 '결과' 전용이 아니다. 재무부가 경매를 공고하는 순간
      // (통상 실시 2일 전, 리펀딩 쿠폰물은 QRA 당일) 발행액이 채워진 행이 먼저 올라오고
      // 낙찰 지표 칸만 비어 있다. 즉 total에는 늘 미실시 물량이 섞여 들어온다.
      // 2026-08-05 기준 미낙찰 3건(당일 17주 72B + 8/6 만기 빌 210B) 282B$가
      // Q3 합계에 이미 들어 있는데도 화면은 그만큼이 빠져 있다고 적고 있었다.
      //
      // 판정은 날짜가 아니라 '낙찰 지표 유무'로 한다. 서버는 UTC라 ET 저녁이면
      // todayStr이 하루 앞서 가고, 당일 경매는 낙찰 전후가 같은 날짜라 날짜만으론 못 가른다.
      // 날짜 조건을 함께 두는 건 과거 행에 지표가 빠져 있을 때 공고분으로 새는 걸 막기 위한 것.
      if (auctionRate(x, t).v == null && x.auction_date >= todayStr) qMap[key].announced += amt;
    }
    const quarters = Object.values(qMap).sort((a,b) => a.q.localeCompare(b.q));

    // 향후 예정 경매
    // auctions_query는 공고가 난 뒤에야 행이 생기므로(위 announced 참고) '아직 공고 전'인
    // 일정까지 보려면 upcoming_auctions가 필요하다. 대신 이쪽은 공고 전 행의 발행액이
    // null로 온다 — 2026-08-05 QRA 직후 3Y·10Y·30Y가 일정만 잡히고 금액은 null이었다.
    // 여기서 실패해도 나머지 QRA 지표는 살린다.
    let upcoming = [];
    try {
      const upUrl = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions`
        + `?filter=auction_date:gt:${todayStr}&sort=auction_date&page[size]=100`;
      const upRes = await fetch(upUrl, { headers: { Accept: "application/json" } });
      const upData = await upRes.json();
      upcoming = (upData.data || []).map(x => {
        const amt = parseFloat(x.offering_amt);
        return {
          date: x.auction_date,
          type: x.security_type,
          term: x.security_term,
          amount: isNaN(amt) ? null : Math.round(amt / 1e9),
          reopening: x.reopening === 'Yes'
        };
      });
    } catch (e) {
      upcoming = [];
    }

    // 최근 30일 경매 (응찰률 포함)
    const past30 = new Date(today.getTime()-30*24*3600*1000).toISOString().slice(0,10);
    // 최신순으로 내려보낸다 — 화면에서 상위 N건만 자르는 표가 있어 오름차순이면 가장 오래된 건만 보인다
    const recent = rows
      .filter(x => x.auction_date >= past30 && x.auction_date <= todayStr)
      .map(x => {
        const type = classify(x);
        const rate = auctionRate(x, type);
        return {
          date: x.auction_date,
          type,
          term: x.security_term,
          amount: Math.round(parseFloat(x.offering_amt)/1e9),
          yield: rate.v,
          yieldKind: rate.kind,
          btc: x.bid_to_cover_ratio
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json({ quarters, upcoming, recent, data: rows });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
