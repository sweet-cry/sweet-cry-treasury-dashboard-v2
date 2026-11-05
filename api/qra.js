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

// ── TreasuryDirect(TA_WS) 어댑터 ─────────────────────────────────────────────
// fiscaldata의 auctions_query·upcoming_auctions는 갱신이 1~2주 뒤처진다
// (2026-11-05 실측: 마지막 경매 10/22·예정표는 10/29에서 멈춤).
// 그러면 이번 분기 합계가 덜 잡혀 '발행 지연' 오경보가 뜨고 예정 경매가 비어 보인다.
// TreasuryDirect는 같은 날 낙찰·공고가 반영되지만 CORS가 없어 서버에서만 부를 수 있다.
// 단 `auctioned`는 아직 만기 안 된 빌만 돌려줘(2026-11 기준 빌은 직전 6개월분 + 52주물뿐)
// 과거 분기 집계에는 못 쓴다 → 과거는 fiscaldata, fiscaldata가 못 따라온 최근 구간만 덮어쓴다.
const TD = 'https://www.treasurydirect.gov/TA_WS/securities';

// TreasuryDirect 행 → fiscaldata 행 모양으로 변환 (아래 집계 코드를 그대로 쓰기 위함)
function tdToFiscal(x) {
  const t = x.type; // 'Bill' | 'Note' | 'Bond' | 'TIPS' | 'FRN'
  const isTips = t === 'TIPS', isFrn = t === 'FRN';
  const val = v => (v === '' || v == null) ? null : String(v);
  return {
    auction_date: String(x.competitiveAuctionCloseDate).slice(0, 10),
    security_type: isTips || isFrn ? 'Note' : t,
    security_term: x.securityTerm,
    offering_amt: val(x.offeringAmount),
    inflation_index_security: isTips ? 'Yes' : 'No',
    floating_rate: isFrn ? 'Yes' : 'No',
    high_yield: val(x.highYield),
    high_investment_rate: val(x.investmentRate),
    high_discnt_margin: val(x.highDiscountMargin),
    bid_to_cover_ratio: val(x.bidToCoverRatio),
    _src: 'td'
  };
}

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
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

    // 두 출처를 동시에 부른다 — TreasuryDirect가 실패해도 fiscaldata만으로 예전처럼 동작한다.
    const [fdRes, tdAuctRes, tdUpRes] = await Promise.allSettled([
      getJson(url),
      getJson(`${TD}/auctioned?format=json&days=75`),
      getJson(`${TD}/upcoming?format=json`)
    ]);
    if (fdRes.status !== 'fulfilled') throw fdRes.reason;
    let rows = (fdRes.value.data || []).filter(x => x.offering_amt && x.offering_amt !== 'null');

    // fiscaldata가 따라온 마지막 '낙찰 완료' 경매일. 이 날짜 이후는 TreasuryDirect가 채운다.
    const fdLast = rows
      .filter(x => auctionRate(x, classify(x)).v != null)
      .reduce((m, x) => x.auction_date > m ? x.auction_date : m, '');

    let tdOk = false, tdLast = '';
    if (tdAuctRes.status === 'fulfilled' && Array.isArray(tdAuctRes.value) && tdAuctRes.value.length) {
      tdOk = true;
      const tdRows = tdAuctRes.value.map(tdToFiscal).filter(x => x.offering_amt);
      tdLast = tdRows.reduce((m, x) => x.auction_date > m ? x.auction_date : m, '');
      // fiscaldata 마지막 낙찰일 '이후'만 교체: 그 구간의 fiscaldata 행(공고만 올라온 행 포함)을 버리고 TD 행으로 대체.
      // 같은 날짜 안에서 일부만 반영된 경우를 피하려 fdLast 당일도 TD 기준으로 다시 깐다.
      if (tdLast > fdLast) {
        const cut = fdLast || '0000-00-00';
        rows = rows.filter(x => x.auction_date < cut)
                   .concat(tdRows.filter(x => x.auction_date >= cut));
      }
    }

    // 향후 예정 경매 — TreasuryDirect(발행액이 공고 즉시 채워짐) 우선, 실패 시 fiscaldata
    let upcoming = [];
    let upSrc = 'none';
    if (tdUpRes.status === 'fulfilled' && Array.isArray(tdUpRes.value)) {
      upcoming = tdUpRes.value
        .map(x => {
          const amt = parseFloat(x.offeringAmount);
          return {
            date: String(x.competitiveAuctionCloseDate).slice(0, 10),
            type: x.type,
            term: x.securityTerm,
            amount: isNaN(amt) ? null : Math.round(amt / 1e9),
            reopening: x.reopening === 'Yes'
          };
        })
        .filter(x => x.date > todayStr || (x.date === todayStr))
        .sort((a, b) => a.date.localeCompare(b.date));
      upSrc = 'td';
    }
    if (upSrc === 'none') {
      try {
        const upUrl = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions`
          + `?filter=auction_date:gt:${todayStr}&sort=auction_date&page[size]=100`;
        const upData = await getJson(upUrl);
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
        upSrc = 'fiscaldata';
      } catch (e) {
        upcoming = [];
      }
    }

    // 공고는 났으나 아직 낙찰 전인 경매의 발행액을 이번 분기 합계에 포함시킨다.
    // (fiscaldata는 공고 즉시 행이 생겼지만 TreasuryDirect는 공고 행이 upcoming에만 있다.)
    // 이미 rows에 같은 날짜·만기·종류가 있으면 이중 계산하지 않는다.
    if (upSrc === 'td') {
      const have = new Set(rows.map(x => `${x.auction_date}|${classify(x)}|${x.security_term}`));
      for (const u of upcoming) {
        if (u.amount == null || u.amount <= 0) continue;
        if (have.has(`${u.date}|${u.type}|${u.term}`)) continue;
        rows.push({
          auction_date: u.date,
          security_type: (u.type === 'TIPS' || u.type === 'FRN') ? 'Note' : u.type,
          security_term: u.term,
          offering_amt: String(u.amount * 1e9),
          inflation_index_security: u.type === 'TIPS' ? 'Yes' : 'No',
          floating_rate: u.type === 'FRN' ? 'Yes' : 'No',
          high_yield: null, high_investment_rate: null, high_discnt_margin: null,
          bid_to_cover_ratio: null,
          _src: 'td-upcoming'
        });
      }
    }

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
      // 공고된 경매는 발행액이 채워진 채 낙찰 지표 칸만 비어 있다. 즉 total에는 늘 미실시 물량이 섞인다.
      // 판정은 날짜가 아니라 '낙찰 지표 유무'로 한다. 서버는 UTC라 ET 저녁이면
      // todayStr이 하루 앞서 가고, 당일 경매는 낙찰 전후가 같은 날짜라 날짜만으론 못 가른다.
      // 날짜 조건을 함께 두는 건 과거 행에 지표가 빠져 있을 때 공고분으로 새는 걸 막기 위한 것.
      if (auctionRate(x, t).v == null && x.auction_date >= todayStr) qMap[key].announced += amt;
    }
    const quarters = Object.values(qMap).sort((a,b) => a.q.localeCompare(b.q));

    // 최근 30일 경매 (응찰률 포함) — 공고만 있고 아직 낙찰 전인 행은 결과표에서 뺀다
    const past30 = new Date(today.getTime()-30*24*3600*1000).toISOString().slice(0,10);
    // 최신순으로 내려보낸다 — 화면에서 상위 N건만 자르는 표가 있어 오름차순이면 가장 오래된 건만 보인다
    const recent = rows
      .filter(x => x.auction_date >= past30 && x.auction_date <= todayStr && x._src !== 'td-upcoming')
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

    // 신선도: 화면이 '데이터가 뒤처졌다'를 알리고 발행 진행도 경보를 보류할 수 있게 한다.
    // lastAuction은 낙찰 완료 기준 최신 경매일. lagDays는 오늘과의 차이(달력일).
    const lastAuction = rows
      .filter(x => x._src !== 'td-upcoming' && auctionRate(x, classify(x)).v != null)
      .reduce((m, x) => x.auction_date > m ? x.auction_date : m, '');
    const lagDays = lastAuction
      ? Math.round((Date.parse(todayStr) - Date.parse(lastAuction)) / 86400000)
      : null;
    const freshness = {
      lastAuction: lastAuction || null,
      lagDays,
      source: tdOk ? 'treasurydirect+fiscaldata' : 'fiscaldata',
      fiscaldataLast: fdLast || null,
      upcomingSource: upSrc,
      // 평일 기준 4일(주말 포함 안전폭)을 넘겨 낙찰이 없으면 뒤처진 것으로 본다
      stale: lagDays == null || lagDays > 4
    };

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=1800");
    res.status(200).json({ quarters, upcoming, recent, freshness, data: rows.map(({ _src, ...r }) => r) });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
