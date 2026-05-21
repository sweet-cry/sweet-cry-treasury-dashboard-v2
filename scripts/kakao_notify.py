"""
Treasury Dashboard 일일 신호 요약 → 카카오톡 나에게 보내기
매일 18:00 KST (09:00 UTC) GitHub Actions에서 실행

필요한 GitHub Secrets:
  KAKAO_REST_KEY      : 카카오 앱 REST API 키
  KAKAO_REFRESH_TOKEN : 최초 1회 발급한 리프레시 토큰
"""

import os, json, requests
from datetime import datetime, timezone, timedelta

# ── 설정 ──────────────────────────────────────────────────────────
KAKAO_REST_KEY      = os.environ["KAKAO_REST_KEY"]
KAKAO_REFRESH_TOKEN = os.environ["KAKAO_REFRESH_TOKEN"]
FRED_KEY            = "3d022b35a44eabf7bb45dbdd9a1cfa01"
DASHBOARD_URL       = "https://sweet-cry-treasury-dashboard-v2.vercel.app"
KST                 = timezone(timedelta(hours=9))

# ── 카카오 토큰 갱신 ──────────────────────────────────────────────
def kakao_refresh_access_token():
    r = requests.post("https://kauth.kakao.com/oauth/token", data={
        "grant_type":    "refresh_token",
        "client_id":     KAKAO_REST_KEY,
        "refresh_token": KAKAO_REFRESH_TOKEN,
    }, timeout=10)
    d = r.json()
    if "access_token" not in d:
        raise RuntimeError(f"토큰 갱신 실패: {d}")
    return d["access_token"]

# ── FRED API ──────────────────────────────────────────────────────
def fred_latest(series, n=3):
    url = (f"https://api.stlouisfed.org/fred/series/observations"
           f"?series_id={series}&api_key={FRED_KEY}&file_type=json"
           f"&sort_order=desc&limit={n}")
    obs = requests.get(url, timeout=10).json().get("observations", [])
    return [(o["date"], float(o["value"])) for o in obs if o["value"] != "."]

# ── TGA (Treasury DTS) ────────────────────────────────────────────
def get_tga():
    url = ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
           "/v1/accounting/dts/dts_table_1"
           "?fields=record_date,open_today_bal"
           "&filter=account_type:eq:Federal%20Reserve%20Account"
           "&sort=-record_date&page[size]=3")
    data = requests.get(url, timeout=10).json().get("data", [])
    return [(x["record_date"], float(x["open_today_bal"])) for x in data if x.get("open_today_bal")]

# ── QRA 데이터 ────────────────────────────────────────────────────
def get_qra_signal():
    today = datetime.now(KST)
    past  = (today - timedelta(days=600)).strftime("%Y-%m-%d")
    fut   = (today + timedelta(days=90)).strftime("%Y-%m-%d")
    url   = ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
             "/v1/accounting/od/auctions_query"
             f"?fields=security_type,offering_amt,auction_date"
             f"&filter=auction_date:gte:{past},auction_date:lte:{fut}"
             f"&sort=auction_date&page[size]=2000")
    rows = [x for x in requests.get(url, timeout=15).json().get("data", [])
            if x.get("offering_amt") and x["offering_amt"] != "null"]

    cur_q = f"{today.year}-Q{(today.month-1)//3+1}"
    total = bill = 0
    for x in rows:
        y, m = int(x["auction_date"][:4]), int(x["auction_date"][5:7])
        if f"{y}-Q{(m-1)//3+1}" == cur_q:
            amt    = float(x["offering_amt"]) / 1e9
            total += amt
            if x["security_type"] == "Bill":
                bill += amt
    bill_pct = bill / total * 100 if total > 0 else 0

    # 분기 경과율
    q_idx   = int(cur_q[-1])
    q_start = datetime(today.year, (q_idx-1)*3+1, 1, tzinfo=KST)
    q_end   = datetime(today.year, q_idx*3 % 12 + (1 if q_idx*3 % 12 == 0 else 0),
                       1, tzinfo=KST) if q_idx < 4 else datetime(today.year+1, 1, 1, tzinfo=KST)
    q_pct   = min(int((today - q_start).days / (q_end - q_start).days * 100), 100)

    return cur_q, round(total), round(bill_pct), q_pct

# ── 메시지 포맷 ───────────────────────────────────────────────────
def format_message():
    now = datetime.now(KST)

    walcl   = fred_latest("WALCL",   2)   # millions USD
    rrp     = fred_latest("RRPONTSYD", 2) # billions USD
    wresbal = fred_latest("WRESBAL", 2)   # millions USD
    sp500   = fred_latest("SP500",   2)
    tga_raw = get_tga()                   # millions USD

    def fmt_T(m): return f"{m/1e6:.2f}T$" if m else "—"   # millions → trillions
    def fmt_B(b): return f"{b:,.0f}B$"   if b else "—"    # billions

    # 값 추출
    walcl_v = walcl[0][1]   if walcl   else None
    rrp_v   = rrp[0][1]     if rrp     else None   # 이미 billions
    res_v   = wresbal[0][1] if wresbal else None
    tga_v   = tga_raw[0][1] if tga_raw else None   # millions
    sp_v    = sp500[0][1]   if sp500   else None

    # NL 근사 (WALCL - TGA - RRP, 단위 billions)
    if walcl_v and tga_v and rrp_v:
        nl_b = walcl_v/1e3 - tga_v/1e3 - rrp_v  # millions/1000 = billions
        nl_str = fmt_B(nl_b)
        nl_chg = None
        if len(walcl) > 1 and len(rrp) > 1 and len(tga_raw) > 1:
            nl_prev = walcl[1][1]/1e3 - tga_raw[1][1]/1e3 - rrp[1][1]
            nl_chg  = nl_b - nl_prev
    else:
        nl_str, nl_chg = "—", None

    # QRA
    cur_q, qra_total, bill_pct, q_pct = get_qra_signal()
    if   bill_pct > 60: nl_sig, sig_emoji = "NL 중립",  "🟢"
    elif bill_pct < 40: nl_sig, sig_emoji = "NL 압박↓", "🔴"
    else:               nl_sig, sig_emoji = "혼합 구성", "🟡"

    chg_str = (f" (전일比 {'+' if nl_chg>=0 else ''}{nl_chg:,.0f}B$)"
               if nl_chg is not None else "")

    msg = "\n".join([
        f"📊 Treasury 신호 요약",
        f"📅 {now.strftime('%Y-%m-%d %H:%M')} KST",
        "",
        "━━ Net Liquidity ━━",
        f"WALCL  : {fmt_T(walcl_v)}",
        f"TGA    : {fmt_B(tga_v/1e3) if tga_v else '—'}",
        f"RRP    : {fmt_B(rrp_v)}",
        f"준비금 : {fmt_T(res_v)}",
        f"NL ≈   : {nl_str}{chg_str}",
        "",
        f"━━ QRA ({cur_q}) ━━",
        f"T-Bill 비중 : {bill_pct}%  {sig_emoji} {nl_sig}",
        f"발행액 합계 : {qra_total:,}B$",
        f"분기 경과   : {q_pct}%",
        "",
        "━━ 시장 ━━",
        f"S&P500 : {sp_v:,.0f}" if sp_v else "S&P500 : —",
        "",
        f"🔗 {DASHBOARD_URL}",
    ])
    return msg

# ── 카카오 전송 ───────────────────────────────────────────────────
def send_kakao(access_token, text):
    payload = {
        "object_type": "text",
        "text":        text[:2000],   # 카카오 최대 2000자
        "link": {
            "web_url":        DASHBOARD_URL,
            "mobile_web_url": DASHBOARD_URL,
        },
    }
    r = requests.post(
        "https://kapi.kakao.com/v2/api/talk/memo/default/send",
        headers={"Authorization": f"Bearer {access_token}"},
        data={"template_object": json.dumps(payload)},
        timeout=10,
    )
    return r.status_code, r.json()

# ── 실행 ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=== 토큰 갱신 중 ===")
    token = kakao_refresh_access_token()

    print("=== 데이터 수집 중 ===")
    msg = format_message()
    print(msg)

    print("\n=== 카카오톡 전송 중 ===")
    status, resp = send_kakao(token, msg)
    print(f"응답: {status} / {resp}")
    if status != 200 or resp.get("result_code") != 0:
        raise RuntimeError(f"전송 실패: {resp}")
    print("✅ 전송 완료")
