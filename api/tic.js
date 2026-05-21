export const config = { runtime: "nodejs" };

const SKIP = new Set([
  'Country','All Other','Grand Total',
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

    const byCountry = {};

    for (const line of lines) {
      const cols = line.split("\t");
      if (cols.length < 3) continue;
      const country = cols[0].trim();
      if (!country || SKIP.has(country)) continue;
      const date = cols[1]?.trim() || '';
      const val = parseFloat(cols[cols.length - 1].replace(/,/g, ""));
      if (isNaN(val) || val <= 0) continue;

      if (!byCountry[country]) byCountry[country] = [];
      byCountry[country].push({ date, value: val });
    }

    // 날짜 오름차순 정렬
    for (const arr of Object.values(byCountry)) {
      arr.sort((a, b) => a.date.localeCompare(b.date));
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json(byCountry);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
