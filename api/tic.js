export const config = { runtime: "nodejs" };

const SKIP = new Set([
  'Country', 'All Other', 'Grand Total',
  'Of Which: Foreign Official',
  'Of Which: Foreign Official Treasury Bills',
  'Of Which: Foreign Official T-Bonds & Notes'
]);

function parseTICText(text) {
  const lines = text.split("\n").filter(l => l.trim());
  let dates = null;
  const result = {};

  for (const line of lines) {
    const cols = line.split("\t");
    if (cols.length < 2) continue;
    const first = cols[0].trim();

    if (first === 'Country') {
      dates = cols.slice(1).map(d => d.trim()).filter(d => d);
      continue;
    }
    if (!first || SKIP.has(first)) continue;

    if (dates && dates.length > 0) {
      // Wide format
      const vals = cols.slice(1).map(v => parseFloat(v.replace(/,/g, '')));
      const series = dates
        .map((d, i) => ({ date: d, value: (!isNaN(vals[i]) && vals[i] > 0) ? vals[i] : null }))
        .filter(x => x.value !== null);
      if (series.length > 0) result[first] = series;
    } else {
      // Long format 폴백
      const date = cols[1]?.trim() || '';
      const val = parseFloat(cols[cols.length - 1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) {
        if (!result[first]) result[first] = [];
        result[first].push({ date, value: val });
      }
    }
  }

  if (!dates) {
    for (const arr of Object.values(result)) {
      arr.sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  return result;
}

function mergeData(hist, curr) {
  const merged = { ...hist };
  for (const [country, series] of Object.entries(curr)) {
    if (!merged[country]) {
      merged[country] = series;
    } else {
      // 기존 날짜 set
      const existing = new Set(merged[country].map(x => x.date));
      for (const pt of series) {
        if (!existing.has(pt.date)) merged[country].push(pt);
      }
      merged[country].sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  return merged;
}

const BASE = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/";
const HEADERS = { "User-Agent": "Mozilla/5.0", "Accept": "text/plain" };

export default async function handler(req, res) {
  try {
    // 20년 히스토리 + 최근 13개월 병렬 fetch
    const [histRes, currRes] = await Promise.allSettled([
      fetch(BASE + "mfhhis.txt", { headers: HEADERS }).then(r => r.text()),
      fetch(BASE + "slt_table5.txt", { headers: HEADERS }).then(r => r.text()),
    ]);

    const histData = histRes.status === 'fulfilled' ? parseTICText(histRes.value) : {};
    const currData = currRes.status === 'fulfilled' ? parseTICText(currRes.value) : {};

    const result = mergeData(histData, currData);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
