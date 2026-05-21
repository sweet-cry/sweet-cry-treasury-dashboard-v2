export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0,10);
    const future = new Date(today.getTime() + 90*24*3600*1000).toISOString().slice(0,10);
    const past   = new Date(today.getTime() - 600*24*3600*1000).toISOString().slice(0,10); // ~20개월

    const fields = 'security_type,security_term,offering_amt,auction_date,high_yield,bid_to_cover_ratio';
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
      if (!qMap[key]) qMap[key] = { q: key, bill:0, note:0, bond:0, tips:0, frn:0, total:0, planned:0 };
      const t = x.security_type;
      if (t==='Bill') qMap[key].bill += amt;
      else if (t==='Note') qMap[key].note += amt;
      else if (t==='Bond') qMap[key].bond += amt;
      else if (t==='TIPS') qMap[key].tips += amt;
      else if (t==='FRN')  qMap[key].frn  += amt;
      qMap[key].total += amt;
      if (x.auction_date > todayStr) qMap[key].planned += amt;
    }
    const quarters = Object.values(qMap).sort((a,b) => a.q.localeCompare(b.q));

    // 향후 90일 예정
    const upcoming = rows
      .filter(x => x.auction_date > todayStr)
      .map(x => ({
        date: x.auction_date,
        type: x.security_type,
        term: x.security_term,
        amount: Math.round(parseFloat(x.offering_amt)/1e9)
      }));

    // 최근 30일 경매 (응찰률 포함)
    const past30 = new Date(today.getTime()-30*24*3600*1000).toISOString().slice(0,10);
    const recent = rows
      .filter(x => x.auction_date >= past30 && x.auction_date <= todayStr)
      .map(x => ({
        date: x.auction_date,
        type: x.security_type,
        term: x.security_term,
        amount: Math.round(parseFloat(x.offering_amt)/1e9),
        yield: x.high_yield,
        btc: x.bid_to_cover_ratio
      }));

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json({ quarters, upcoming, recent, data: rows });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
