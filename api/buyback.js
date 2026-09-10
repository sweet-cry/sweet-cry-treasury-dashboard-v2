export const config = { runtime: 'nodejs' };

// 재무부 바이백(조기상환) 실시 이력 — fiscaldata `buybacks_operations`
//
// 리펀딩 '성명 본문' 수치는 어떤 API에도 없어 수기로 둔다(→ index.html QRA_CASH).
// 하지만 '실제로 언제 얼마를 샀는가'는 이 표에 그대로 들어온다. 정책 문구만 하드코딩으로
// 남기고 회차·상한·낙찰액은 여기서 받아, 실시할 때마다 손으로 고치던 스테일을 없앤다.
//
// 행 생명주기 — 결과 유무를 '날짜'로 판정하면 안 된다.
//   공고(운영 1~2일 전) : preliminary_ann_*만 채워지고 결과 칸은 빈 문자열('')
//   운영 종료(14:00 ET) : results_* 와 total_par_amt_accepted/offered 가 채워짐
//   → 판정은 total_par_amt_accepted 유무로 한다. 서버는 UTC라 ET 오후엔 날짜가 하루 앞서 가고,
//     당일 운영은 공고·결과가 같은 날짜라 날짜만으론 못 가른다.
//
// 장기물 판정에는 security_type이 필요하다. 만기대만 보면 TIPS 바이백('10Y to 30Y')이
// 명목 장기물로 섞여 들어온다 — sb0607이 상한을 올린 대상은 '명목 쿠폰물'뿐이다.

const LONG_END = ['10Y to 20Y', '20Y to 30Y'];

// fiscaldata는 미채움 칸을 null이 아니라 빈 문자열로 준다 → parseFloat('')는 NaN
const num = v => {
  if (v === '' || v == null || v === 'null') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};
const toB = v => { const n = num(v); return n == null ? null : n / 1e9; };

function shape(x) {
  const acceptedB = toB(x.total_par_amt_accepted);
  return {
    date: x.operation_date,
    settle: x.settlement_date,
    bucket: x.maturity_bucket,
    sec: x.security_type,
    maxB: toB(x.max_par_amt_redeemed),
    acceptedB,
    offeredB: toB(x.total_par_amt_offered),
    issues: num(x.nbr_issues_accepted),
    closeET: x.operation_close_time_est || null,
    pending: acceptedB == null            // 공고만 났고 아직 운영 전/결과 전
  };
}

export default async function handler(req, res) {
  try {
    // ~18개월. 장기물 유동성지원은 회차가 드물어(월 2~3회) 이 범위여야 비교 대상이 쌓인다.
    const past = new Date(Date.now() - 540 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const fields = 'operation_date,operation_type,security_type,maturity_bucket'
                 + ',max_par_amt_redeemed,total_par_amt_accepted,total_par_amt_offered'
                 + ',settlement_date,nbr_issues_accepted,operation_close_time_est';
    const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/buybacks_operations`
      + `?fields=${fields}&filter=operation_date:gte:${past}`
      + `&sort=-operation_date&page[size]=300`;

    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`fiscaldata ${r.status}`);
    const d = await r.json();
    const rows = d.data || [];

    // 장기물 명목 유동성지원 — sb0607 상한 상향의 대상 그대로
    const longEnd = rows
      .filter(x => x.operation_type === 'Liquidity Support'
                && x.security_type === 'Nominal Coupons'
                && LONG_END.includes(x.maturity_bucket))
      .map(shape);

    res.setHeader('Access-Control-Allow-Origin', '*');
    // 공고는 운영 1~2일 전, 결과는 운영일 14:00 ET에 한 번 채워진다 → 30분이면 충분히 촘촘하다
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({
      longEnd: longEnd.slice(0, 24),
      latest: longEnd[0] || null,
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
