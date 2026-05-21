export const config = { runtime: "nodejs" };

const SKIP = new Set([
  'Country', 'All Other', 'Grand Total',
  'Of Which: Foreign Official',
  'Of Which: Foreign Official Treasury Bills',
  'Of Which: Foreign Official T-Bonds & Notes'
]);

const MONTH_NUM = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };

// slt_table5.txt — 탭 구분 wide format (헤더 행 "Country\t날짜\t...")
function parseTabWide(text) {
  const lines = text.split('\n').filter(l => l.trim());
  let dates = null;
  const result = {};
  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length < 2) continue;
    const first = cols[0].trim();
    if (first === 'Country') { dates = cols.slice(1).map(d => d.trim()).filter(d => d); continue; }
    if (!first || SKIP.has(first)) continue;
    if (dates && dates.length > 0) {
      const vals = cols.slice(1).map(v => parseFloat(v.replace(/,/g, '')));
      const series = dates.map((d, i) => ({ date: d, value: (!isNaN(vals[i]) && vals[i] > 0) ? vals[i] : null })).filter(x => x.value !== null);
      if (series.length > 0) result[first] = series;
    }
  }
  return result;
}

// mfh.txt — 고정폭 format
// 헤더: "   Jan     Dec  ..." / "Country   2023    2022  ..."
function parseFixedWidth(text) {
  const lines = text.split('\n').map(l => l.replace(/\r/g, ''));
  let months = null, years = null;
  const result = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 월 헤더 행 (Jan/Feb... 로만 구성)
    if (!months && /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(trimmed) && !/\d/.test(trimmed)) {
      months = trimmed.split(/\s+/).filter(m => MONTH_NUM[m]);
      continue;
    }
    // 연도 헤더 행 (Country 로 시작)
    if (months && !years && trimmed.startsWith('Country')) {
      years = trimmed.replace(/^Country\s*/, '').trim().split(/\s+/).filter(y => /^\d{4}$/.test(y));
      continue;
    }
    // 구분선
    if (/^[-\s]+$/.test(trimmed)) continue;

    if (months && years) {
      // 국가명: 첫 32자, 값: 이후 split
      const countryRaw = line.slice(0, 32).trim();
      if (!countryRaw || SKIP.has(countryRaw)) continue;
      const valStr = line.slice(32).trim();
      if (!valStr) continue;
      const vals = valStr.split(/\s+/).map(v => parseFloat(v));
      if (vals.some(v => !isNaN(v) && v > 0)) {
        const len = Math.min(months.length, years.length, vals.length);
        const series = [];
        for (let i = 0; i < len; i++) {
          const d = years[i] + '-' + (MONTH_NUM[months[i]] || '01');
          if (!isNaN(vals[i]) && vals[i] > 0) series.push({ date: d, value: vals[i] });
        }
        if (series.length > 0) {
          series.sort((a, b) => a.date.localeCompare(b.date));
          result[countryRaw] = series;
        }
      }
    }
  }
  return result;
}

function mergeData(a, b) {
  const merged = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!a[k]) { merged[k] = b[k]; continue; }
    if (!b[k]) { merged[k] = a[k]; continue; }
    const seen = new Set(a[k].map(x => x.date));
    merged[k] = [...a[k], ...b[k].filter(x => !seen.has(x.date))];
    merged[k].sort((a, b) => a.date.localeCompare(b.date));
  }
  return merged;
}

const BASE = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/";
const H = { "User-Agent": "Mozilla/5.0", "Accept": "text/plain" };

export default async function handler(req, res) {
  try {
    const [r1, r2] = await Promise.allSettled([
      fetch(BASE + "slt_table5.txt", { headers: H }).then(r => r.text()),
      fetch(BASE + "mfh.txt",        { headers: H }).then(r => r.text()),
    ]);

    const curr = r1.status === 'fulfilled' ? parseTabWide(r1.value)   : {};
    const old  = r2.status === 'fulfilled' ? parseFixedWidth(r2.value) : {};
    const result = mergeData(old, curr);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
