"""
Wayback Machine에서 Treasury TIC 역사적 데이터를 수집해 api/tic_hist.json 생성.

소스:
  - ticdata.treasury.gov/Publish/mfh.txt       (고정폭, 2015~2023)
  - slt_table5.txt (탭 wide, 2023~2025 아카이브)
"""

import requests, json, re, time, sys
from pathlib import Path

MONTH_NUM = {
    'Jan':'01','Feb':'02','Mar':'03','Apr':'04','May':'05','Jun':'06',
    'Jul':'07','Aug':'08','Sep':'09','Oct':'10','Nov':'11','Dec':'12'
}
SKIP = {
    'Country','All Other','Grand Total',
    'Of Which: Foreign Official',
    'Of Which: Foreign Official Treasury Bills',
    'Of Which: Foreign Official T-Bonds & Notes'
}

# ── 파서: 고정폭 format (mfh.txt) ──────────────────────────────────
def parse_fixed_width(text):
    lines = text.replace('\r', '').split('\n')
    months = years = None
    result = {}
    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            continue
        if not months and re.search(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b', trimmed) \
                and not re.search(r'\d', trimmed):
            months = [m for m in trimmed.split() if m in MONTH_NUM]
            continue
        if months and not years and trimmed.startswith('Country'):
            years = re.findall(r'\b\d{4}\b', trimmed[7:])
            continue
        if re.match(r'^[-\s]+$', trimmed):
            continue
        if months and years:
            country = line[:32].strip()
            if not country or country in SKIP:
                continue
            val_str = line[32:].strip()
            if not val_str:
                continue
            try:
                vals = [float(v) for v in val_str.split()]
            except:
                continue
            series = []
            for i in range(min(len(months), len(years), len(vals))):
                v = vals[i]
                if v != v or v <= 0:  # NaN or zero
                    continue
                d = f"{years[i]}-{MONTH_NUM[months[i]]}"
                series.append({'date': d, 'value': v})
            if series:
                series.sort(key=lambda x: x['date'])
                _merge_into(result, country, series)
    return result

# ── 파서: 탭 wide format (slt_table5.txt) ──────────────────────────
def parse_tab_wide(text):
    lines = [l for l in text.split('\n') if l.strip()]
    dates = None
    result = {}
    for line in lines:
        cols = line.split('\t')
        if len(cols) < 2:
            continue
        first = cols[0].strip()
        if first == 'Country':
            dates = [d.strip() for d in cols[1:] if d.strip()]
            continue
        if not first or first in SKIP:
            continue
        if dates:
            vals = []
            for v in cols[1:]:
                try:
                    vals.append(float(v.replace(',', '')))
                except:
                    vals.append(float('nan'))
            series = []
            for i, d in enumerate(dates):
                if i >= len(vals): break
                v = vals[i]
                if v != v or v <= 0:
                    continue
                series.append({'date': d, 'value': v})
            if series:
                series.sort(key=lambda x: x['date'])
                _merge_into(result, first, series)
    return result

# ── 보조 ───────────────────────────────────────────────────────────
def _merge_into(result, country, series):
    if country not in result:
        result[country] = list(series)
    else:
        existing = {s['date'] for s in result[country]}
        result[country].extend(s for s in series if s['date'] not in existing)
        result[country].sort(key=lambda x: x['date'])

def merge_all(a, b):
    out = {k: list(v) for k, v in a.items()}
    for country, series in b.items():
        _merge_into(out, country, series)
    return out

def date_range(data):
    all_dates = [s['date'] for slist in data.values() for s in slist]
    return (min(all_dates), max(all_dates)) if all_dates else ('?','?')

# ── CDX API로 스냅샷 목록 수집 ────────────────────────────────────
def get_snapshots(url_pattern, from_year, to_year):
    cdx = (f"http://web.archive.org/cdx/search/cdx"
           f"?url={url_pattern}&output=json&fl=timestamp,statuscode"
           f"&from={from_year}0101&to={to_year}1231"
           f"&filter=statuscode:200&limit=500")
    r = requests.get(cdx, timeout=30)
    snaps = r.json()
    # 연도별 최초 스냅샷 1개 선택
    year_map = {}
    for row in snaps[1:]:
        ts, _ = row
        y = ts[:4]
        if y not in year_map:
            year_map[y] = ts
    return year_map

def fetch_snapshot(ts, original_url, parser):
    wayback = f"https://web.archive.org/web/{ts}/{original_url}"
    r = requests.get(wayback, timeout=30)
    r.raise_for_status()
    return parser(r.text)

# ── 메인 ──────────────────────────────────────────────────────────
def main():
    all_data = {}

    # 1) Publish/mfh.txt 아카이브 (고정폭, 2015-2023)
    print("=== [1/2] Publish/mfh.txt (고정폭) 스냅샷 수집 ===")
    snaps_mfh = get_snapshots(
        "ticdata.treasury.gov/Publish/mfh.txt", 2015, 2023
    )
    print(f"연도 스냅샷: {sorted(snaps_mfh.keys())}")

    for year in sorted(snaps_mfh.keys()):
        ts = snaps_mfh[year]
        print(f"  {year} ({ts}) 수집 중...", end=' ', flush=True)
        try:
            parsed = fetch_snapshot(
                ts,
                "https://ticdata.treasury.gov/Publish/mfh.txt",
                parse_fixed_width
            )
            all_data = merge_all(all_data, parsed)
            dr = date_range(parsed)
            print(f"OK  {dr[0]} ~ {dr[1]}  ({len(parsed)} 국가)")
        except Exception as e:
            print(f"ERR {e}")
        time.sleep(1.5)

    # 2) slt_table5.txt 아카이브 (탭 wide, 2023-2025)
    print("\n=== [2/2] slt_table5.txt (탭 wide) 스냅샷 수집 ===")
    new_url = "ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt"
    snaps_slt = get_snapshots(new_url, 2023, 2025)
    print(f"연도 스냅샷: {sorted(snaps_slt.keys())}")

    for year in sorted(snaps_slt.keys()):
        ts = snaps_slt[year]
        print(f"  {year} ({ts}) 수집 중...", end=' ', flush=True)
        try:
            parsed = fetch_snapshot(
                ts,
                f"https://{new_url}",
                parse_tab_wide
            )
            all_data = merge_all(all_data, parsed)
            dr = date_range(parsed)
            print(f"OK  {dr[0]} ~ {dr[1]}  ({len(parsed)} 국가)")
        except Exception as e:
            print(f"ERR {e}")
        time.sleep(1.5)

    # ── 결과 저장 ──────────────────────────────────────────────────
    print(f"\n최종 데이터: {len(all_data)} 국가")
    dr = date_range(all_data)
    print(f"전체 기간: {dr[0]} ~ {dr[1]}")
    for c in ['Japan', 'China, Mainland', 'United Kingdom']:
        if c in all_data:
            s = all_data[c]
            print(f"  {c}: {s[0]['date']} ~ {s[-1]['date']} ({len(s)}개월)")

    out_path = Path(__file__).parent.parent / "api" / "tic_hist.json"
    out_path.write_text(json.dumps(all_data, separators=(',', ':')), encoding='utf-8')
    print(f"\n저장 완료: {out_path}  ({out_path.stat().st_size:,} bytes)")

if __name__ == '__main__':
    main()
