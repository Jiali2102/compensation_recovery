const SHEETS = [
  { year: 2025, spreadsheetId: process.env.DATA_SRC_A, gid: 0 },
  { year: 2026, spreadsheetId: process.env.DATA_SRC_B, gid: 0 },
].filter(s => s.spreadsheetId);

const SAN_PHAM_MAP_SPREADSHEET_ID = process.env.DATA_SRC_A;
const SAN_PHAM_MAP_RANGE = "san_pham";

export default async function handler(req, res) {
  const API_KEY = process.env.DATA_KEY_1;
  if (!API_KEY || !SHEETS.length) {
    console.error("data.js: thiếu cấu hình Environment Variables (DATA_KEY_1 / DATA_SRC_A / DATA_SRC_B)");
    res.status(500).json({ error: "Lỗi cấu hình máy chủ" });
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
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const sheet = (data.sheets || []).find(s => s.properties.sheetId === gid);
    if (!sheet) throw new Error(`gid không tồn tại`);
    return sheet.properties.title;
  }

  async function getValues(spreadsheetId, gid) {
    const title = await getSheetTitleByGid(spreadsheetId, gid);
    const range = encodeURIComponent(`'${title}'`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    return data.values || [];
  }

  async function getValuesByRangeName(spreadsheetId, rangeName) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(rangeName)}?key=${API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
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
    const [valuesResults, modifiedTimes, sanPhamRows] = await Promise.all([
      Promise.all(activeSheets.map(s => getValues(s.spreadsheetId, s.gid))),
      Promise.all(activeSheets.map(s => getModifiedTime(s.spreadsheetId))),
      SAN_PHAM_MAP_SPREADSHEET_ID
        ? getValuesByRangeName(SAN_PHAM_MAP_SPREADSHEET_ID, SAN_PHAM_MAP_RANGE)
        : Promise.resolve([]),
    ]);

    let header = null;
    let allRows = [];
    valuesResults.forEach(rows => {
      if (!rows.length) return;
      if (!header) header = rows[0];
      allRows = allRows.concat(rows.slice(1));
    });
    if (!header) header = [];

    const sanPhamMap = {};
    if (sanPhamRows.length > 1) {
      const spHeader = sanPhamRows[0];
      const spIdx = spHeader.indexOf("san_pham");
      const spGroupIdx = spHeader.indexOf("san_pham_vn_group");
      if (spIdx !== -1 && spGroupIdx !== -1) {
        sanPhamRows.slice(1).forEach(row => {
          const key = row[spIdx];
          if (key) sanPhamMap[key] = row[spGroupIdx] || "";
        });
      }
    }

    const sanPhamColIdx = header.indexOf("san_pham");
    const headerWithGroup = [...header, "san_pham_vn_group"];
    const allRowsWithGroup = allRows.map(row => {
      const spCode = sanPhamColIdx !== -1 ? row[sanPhamColIdx] : undefined;
      const group = spCode !== undefined ? (sanPhamMap[spCode] || "") : "";
      return [...row, group];
    });

    const csvText = [headerWithGroup, ...allRowsWithGroup].map(row => row.map(csvEscape).join(",")).join("\n");
    const latestModified = modifiedTimes
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] || "";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    res.setHeader("Access-Control-Expose-Headers", "X-Data-Last-Modified");
    res.setHeader("X-Data-Last-Modified", latestModified);
    res.status(200).send(csvText);
  } catch (err) {
    console.error("data.js error:", err.message);
    res.status(500).json({ error: "Lỗi khi lấy dữ liệu" });
  }
}
