export const config = { runtime: "nodejs" };

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HIST = JSON.parse(readFileSync(join(__dirname, 'tic_hist.json'), 'utf8'));

const SKIP = new Set([
  'Country', 'All Other', 'Grand Total',
  'Of Which: Foreign Official',
  'Of Which: Foreign Official Treasury Bills',
  'Of Which: Foreign Official T-Bonds & Notes'
]);

// slt_table5.txt — 탭 구분 wide format
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
    const r1 = await fetch(BASE + "slt_table5.txt", { headers: H }).then(r => r.text()).catch(() => null);
    const curr = r1 ? parseTabWide(r1) : {};
    const result = mergeData(HIST, curr);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
