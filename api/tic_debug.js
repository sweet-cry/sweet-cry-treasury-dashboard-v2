export const config = { runtime: "nodejs" };

const BASE = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/";
const HEADERS = { "User-Agent": "Mozilla/5.0", "Accept": "text/plain" };
// 연도별 아카이브 파일 존재 여부 확인
const CANDIDATES = [
  "mfh2024.txt","mfh2023.txt","mfh2020.txt","mfh2015.txt","mfh2010.txt","mfh2006.txt",
  "mfh_2024.txt","mfh_2023.txt",
  "slt_table5_2024.txt","tic_mfh_hist.txt","mfh_historical.txt"
];

export default async function handler(req, res) {
  const results = {};
  for (const f of CANDIDATES) {
    try {
      const r = await fetch(BASE + f, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
      const text = await r.text();
      results[f] = { status: r.status, bytes: text.length };
    } catch (e) {
      results[f] = { error: e.message };
    }
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json(results);
}
