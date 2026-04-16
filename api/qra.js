export const config = { runtime: "nodejs" };
export default async function handler(req, res) {
  try {
    const today = new Date();
    const end = today.toISOString().slice(0,10);
    const start = new Date(today.getTime() - 90*24*3600*1000).toISOString().slice(0,10);

    // 발행 구성용 (upcoming_auctions)
    const upUrl = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions?fields=security_type,security_term,offering_amt,auction_date&filter=auction_date:gte:${start},auction_date:lte:${end}&sort=-auction_date&page[size]=100`;

    // 경매 결과용 - TreasuryDirect XML API (공개)
    const resUrl = `https://www.treasurydirect.gov/TA_WS/securities/search?startDate=${start}&endDate=${end}&type=Bill,Note,Bond&pagesize=20&format=json`;

    const upR = await fetch(upUrl, { headers: { "Accept": "application/json" } });
    const upD = await upR.json();

    let results = [];
    try {
      const resR = await fetch(resUrl, { headers: { "Accept": "application/json" } });
      const resText = await resR.text();
      const resD = JSON.parse(resText);
      results = Array.isArray(resD) ? resD : [];
    } catch(e2) {
      results = [];
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json({
      data: upD.data || [],
      results: results
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
