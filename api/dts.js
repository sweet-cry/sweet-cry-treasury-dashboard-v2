export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    const today = new Date();
    const end = today.toISOString().slice(0,10);
    const start60 = new Date(today.getTime() - 60*24*3600*1000).toISOString().slice(0,10);
    const start30 = new Date(today.getTime() - 30*24*3600*1000).toISOString().slice(0,10);

    // 세수·지출 (30일)
    const dtsUrl = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/deposits_withdrawals_operating_cash?fields=record_date,transaction_type,transaction_today_amt&filter=record_date:gte:${start30},record_date:lte:${end}&sort=-record_date&page[size]=300`;

    // TGA 일간 잔액 (60일 — NL 테이블용)
    const tgaUrl = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?fields=record_date,account_type,open_today_bal&filter=record_date:gte:${start60},record_date:lte:${end},account_type:eq:Treasury General Account (TGA) Opening Balance&sort=-record_date&page[size]=90`;

    const [dtsR, tgaR] = await Promise.all([
      fetch(dtsUrl, { headers: { "Accept": "application/json" } }),
      fetch(tgaUrl, { headers: { "Accept": "application/json" } })
    ]);
    const [dts, tga] = await Promise.all([dtsR.json(), tgaR.json()]);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json({ data: dts.data, tga: tga.data || [] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
