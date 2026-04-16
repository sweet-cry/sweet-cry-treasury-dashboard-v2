export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    const today = new Date();
    const end = today.toISOString().slice(0,10);
    const start = new Date(today.getTime() - 90*24*3600*1000).toISOString().slice(0,10);
    const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/debt/auctions/auctions?fields=security_type,security_term,total_accepted,auction_date&filter=auction_date:gte:${start},auction_date:lte:${end}&sort=-auction_date&page[size]=100`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    const d = await r.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json(d);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
