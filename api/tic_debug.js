export const config = { runtime: "nodejs" };

const BASE = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/";
const HEADERS = { "User-Agent": "Mozilla/5.0", "Accept": "text/plain" };
const CANDIDATES = ["mfhhis.txt", "mfh.txt", "slthist.txt", "slt_table5_hist.txt"];

export default async function handler(req, res) {
  const results = {};
  for (const f of CANDIDATES) {
    try {
      const r = await fetch(BASE + f, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
      const text = await r.text();
      results[f] = { status: r.status, bytes: text.length, preview: text.slice(0, 300) };
    } catch (e) {
      results[f] = { error: e.message };
    }
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json(results);
}
