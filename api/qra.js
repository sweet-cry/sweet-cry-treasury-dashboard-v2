export const config = { runtime: "nodejs" };
export default async function handler(req, res) {
  try {
    const today = new Date();
    const end = today.toISOString().slice(0,10);
    const start = new Date(today.getTime() - 90*24*3600*1000).toISOString().slice(0,10);

    // 발행 구성용 (upcoming_auctions - 90일 예정/완료)
    const upUrl = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions?fields=security_type,security_term,offering_amt,auction_date&filter=auction_date:gte:${start},auction_date:lte:${end}&sort=-auction_date&page[size]=100`;

    // 경매 결과용 (auction_data - 낙찰금리·BTC 포함)
    const resUrl = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auction_data?fields=auction_date,security_type,security_term,offering_amt,high_yield,bid_to_cover_ratio,indirect_bid_amt_accepted&filter=auction_date:gte:${start},auction_date:lte:${end}&sort=-auction_date&page[size]=20`;

    const [upR, resR] = await Promise.all([
      fetch(upUrl, { headers: { "Accept": "application/json" } }),
      fetch(resUrl, { headers: { "Accept": "application/json" } })
    ]);

    const [upD, resD] = await Promise.all([upR.json(), resR.json()]);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json({
      data: upD.data || [],
      results: resD.data || []
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
