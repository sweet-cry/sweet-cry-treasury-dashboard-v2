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
    //
    // 반드시 'Closing Balance'를 써야 한다. DTS에서 개장(D) = 마감(D−1)이라
    // Opening Balance를 읽으면 그 날짜 칸에 전일 잔액이 들어가 화면 전체가 1영업일 밀린다.
    //   2026-07-31  개장 997,946 / 마감 876,566   ← 월말 하루에 −121B$
    //   2026-07-30  개장 970,442 / 마감 997,946   ← 07-31 개장과 같은 값
    // 실제로 이 버그 때문에 "TGA 998B$ · 기준 2026-07-31"이 07-30 마감값이었고
    // NL이 121B$ 과소계상됐다(5.74T → 5.86T).
    // 주간 폴백으로 쓰는 WDTGAL도 수요일 '마감' 시점이라(07-29 = 970.4B = 아래 마감값)
    // 마감 기준으로 맞춰야 일간·주간이 같은 개념이 된다.
    //
    // 함정: account_type만 바꾸고 필드를 close_today_bal로 바꾸면 안 된다.
    // 이 데이터셋의 close_today_bal은 전 행이 null이고, 마감 행에서도 실제 값은
    // open_today_bal 칸에 담겨 온다. 필드는 open_today_bal 그대로 둘 것.
    const tgaUrl = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?fields=record_date,account_type,open_today_bal&filter=record_date:gte:${start60},record_date:lte:${end},account_type:eq:Treasury General Account (TGA) Closing Balance&sort=-record_date&page[size]=90`;

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
