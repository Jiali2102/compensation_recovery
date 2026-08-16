const SHEETS = [
  { year: 2025, spreadsheetId: process.env.GOOGLE_SHEET_ID_2025, gid: 0 },
  { year: 2026, spreadsheetId: process.env.GOOGLE_SHEET_ID_2026, gid: 0 },
  // { year: 2027, spreadsheetId: process.env.GOOGLE_SHEET_ID_2027, gid: 0 },
].filter(s => s.spreadsheetId); // bỏ qua năm nào chưa cấu hình biến môi trường tương ứng

export default async function handler(req, res) {
  const API_KEY = process.env.GOOGLE_API_KEY;

  if (!API_KEY) {
    res.status(500).json({ error: "Thiếu GOOGLE_API_KEY trong Environment Variables" });
    return;
  }
  if (!SHEETS.length) {
    res.status(500).json({ error: "Chưa cấu hình GOOGLE_SHEET_ID_20xx nào trong Environment Variables" });
    return;
  }

  const requestedYear = parseInt(req.query.year, 10);
  const matchedSheets = SHEETS.filter(s => s.year === requestedYear);
  const activeSheets = matchedSheets.length ? matchedSheets : [SHEETS[SHEETS.length - 1]];

  function csvEscape(val) {
    const s = val === null || val === undefined ? "" : String(val);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  async function getSheetTitleByGid(spreadsheetId, gid) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties&key=${API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Không lấy được thông tin sheet ${spreadsheetId} (HTTP ${r.status})`);
    const data = await r.json();
    const sheet = (data.sheets || []).find(s => s.properties.sheetId === gid);
    if (!sheet) throw new Error(`Không tìm thấy gid=${gid} trong sheet ${spreadsheetId}`);
    return sheet.properties.title;
  }

  async function getValues(spreadsheetId, gid) {
    const title = await getSheetTitleByGid(spreadsheetId, gid);
    const range = encodeURIComponent(`'${title}'`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Không lấy được dữ liệu từ sheet ${spreadsheetId} (HTTP ${r.status})`);
    const data = await r.json();
    return data.values || [];
  }

  async function getModifiedTime(spreadsheetId) {
    try {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=modifiedTime&key=${API_KEY}`);
      if (!r.ok) return null;
      const data = await r.json();
      return data.modifiedTime || null;
    } catch (e) {
      return null;
    }
  }

  try {
    const [valuesResults, modifiedTimes] = await Promise.all([
      Promise.all(activeSheets.map(s => getValues(s.spreadsheetId, s.gid))),
      Promise.all(activeSheets.map(s => getModifiedTime(s.spreadsheetId))),
    ]);

    let header = null;
    let allRows = [];
    valuesResults.forEach(rows => {
      if (!rows.length) return;
      if (!header) header = rows[0];
      allRows = allRows.concat(rows.slice(1));
    });
    if (!header) header = [];

    const csvText = [header, ...allRows].map(row => row.map(csvEscape).join(",")).join("\n");

    const latestModified = modifiedTimes
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] || "";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    res.setHeader("Access-Control-Expose-Headers", "X-Data-Last-Modified");
    res.setHeader("X-Data-Last-Modified", latestModified);
    res.status(200).send(csvText);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy dữ liệu: " + err.message });
  }
}
