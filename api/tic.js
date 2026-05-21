export const config = { runtime: "nodejs" };

const SKIP = new Set([
  'Country', 'All Other', 'Grand Total',
  'Of Which: Foreign Official',
  'Of Which: Foreign Official Treasury Bills',
  'Of Which: Foreign Official T-Bonds & Notes'
]);

export default async function handler(req, res) {
  try {
    const r = await fetch(
      "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt",
      { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/plain" } }
    );
    const text = await r.text();
    const lines = text.split("\n").filter(l => l.trim());

    // Wide format: 첫 행 = "Country\t날짜1\t날짜2\t..."
    // 이후 행: "Japan\t값1\t값2\t...\t최신값"
    let dates = null;
    const result = {};

    for (const line of lines) {
      const cols = line.split("\t");
      if (cols.length < 2) continue;
      const first = cols[0].trim();

      // 헤더 행 감지
      if (first === 'Country') {
        dates = cols.slice(1).map(d => d.trim()).filter(d => d);
        continue;
      }

      if (!first || SKIP.has(first)) continue;

      if (dates && dates.length > 0) {
        // Wide format: 각 컬럼이 월별 보유량
        const vals = cols.slice(1).map(v => parseFloat(v.replace(/,/g, '')));
        const series = dates
          .map((d, i) => ({ date: d, value: (!isNaN(vals[i]) && vals[i] > 0) ? vals[i] : null }))
          .filter(x => x.value !== null);
        if (series.length > 0) result[first] = series;
      } else {
        // Long format 폴백: Country\tDate\tValue
        const date = cols[1]?.trim() || '';
        const val = parseFloat(cols[cols.length - 1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
          if (!result[first]) result[first] = [];
          result[first].push({ date, value: val });
        }
      }
    }

    // Long format이면 날짜 오름차순 정렬
    if (!dates) {
      for (const arr of Object.values(result)) {
        arr.sort((a, b) => a.date.localeCompare(b.date));
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
