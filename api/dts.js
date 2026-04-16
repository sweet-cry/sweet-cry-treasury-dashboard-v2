export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    const today = new Date();
    const end = today.toISOString().slice(0,10);
    const start = new Date(today.getTime() - 60*24*3600*1000).toISOString().slice(0,10);
    const url = `https://api.fiscaldata.treasury.gov/services/api/v1/accounting/dts/dts_table_1?fields=record_date,account_type,open_today_bal,close_today_bal&filter=record_date:gte:${start},record_date:lte:${end}&sort=-record_date&page[size]=300`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    const text = await r.text();
    const d = JSON.parse(text);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json(d);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
