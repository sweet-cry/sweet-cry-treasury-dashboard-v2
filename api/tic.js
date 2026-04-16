export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    const r = await fetch("https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt", {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/plain" }
    });
    const text = await r.text();
    const lines = text.split("\n").filter(l => l.trim());
    const result = {};
    for (const line of lines) {
      const cols = line.split("\t");
      if (cols.length < 3) continue;
      const country = cols[0].trim();
      const val = parseFloat(cols[cols.length - 1].replace(/,/g, ""));
      const date = cols[1]?.trim();
      if (country && !isNaN(val)) result[country] = { value: val, date };
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
