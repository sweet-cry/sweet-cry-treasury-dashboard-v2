export const config = { runtime: "nodejs" };
export default async function handler(req, res) {
  try {
    const today = new Date();
    const end = today.toISOString().slice(0,10);
    const start = new Date(today.getTime() - 90*24*3600*1000).toISOString().slice(0,10);

    // 과거 경매 결과용 엔드포인트: auctions_query (auction_date 과거값 포함, offering_amt 실제 값 반환)
    const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query?fields=security_type,security_term,offering_amt,auction_date,high_yield,high_discnt_rate,bid_to_cover_ratio&filter=auction_date:gte:${start},auction_date:lte:${end}&sort=-auction_date&page[size]=200`;

    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    const d = await r.json();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json({
      data: d.data || [],
      results: d.data || []
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
