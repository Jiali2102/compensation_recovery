const SHEETS = [
  { year: 2025, spreadsheetId: process.env.DATA_SRC_A, gid: 0 },
  { year: 2026, spreadsheetId: process.env.DATA_SRC_B, gid: 0 },
].filter(s => s.spreadsheetId);

const SAN_PHAM_MAP_SPREADSHEET_ID = process.env.DATA_SRC_A;
const SAN_PHAM_MAP_RANGE = "san_pham";

import { verifySession } from "../lib/session.js";

function normKey(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

function findColIndex(headerRow, targetName) {
  const normTarget = normKey(targetName).toLowerCase();
  return headerRow.findIndex(h => normKey(h).toLowerCase() === normTarget);
}

export default async function handler(req, res) {
  const SESSION_SECRET = process.env.SESSION_SECRET;
  const session = SESSION_SECRET ? verifySession(req.headers.cookie, SESSION_SECRET) : null;
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const API_KEY = process.env.DATA_KEY_1;
  if (!API_KEY || !SHEETS.length) {
    console.error("data.js: thiếu cấu hình Environment Variables (DATA_KEY_1 / DATA_SRC_A / DATA_SRC_B)");
    res.status(500).json({ error: "Lỗi cấu hình máy chủ" });
    return;
  }
  const requestedYear = parseInt(req.query.year, 10);
  const matchedSheets = SHEETS.filter(s => s.year === requestedYear);
  const activeSheets = matchedSheets.length ? matchedSheets : [SHEETS[SHEETS.length - 1]];
  const debugMode = req.query.debug === "sanpham";

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
    const sanPhamMapLower = {};
    if (sanPhamRows.length > 1) {
      const spHeader = sanPhamRows[0];
      const spIdx = findColIndex(spHeader, "san_pham");
      const spGroupIdx = findColIndex(spHeader, "san_pham_vn_group");
      if (spIdx !== -1 && spGroupIdx !== -1) {
        sanPhamRows.slice(1).forEach(row => {
          const key = normKey(row[spIdx]);
          const val = row[spGroupIdx] ? normKey(row[spGroupIdx]) : "";
          if (key) {
            sanPhamMap[key] = val;
            sanPhamMapLower[key.toLowerCase()] = val;
          }
        });
      }
    }

    function lookupGroup(rawCode) {
      const key = normKey(rawCode);
      if (!key) return "";
      if (sanPhamMap.hasOwnProperty(key)) return sanPhamMap[key];
      const lowerHit = sanPhamMapLower[key.toLowerCase()];
      if (lowerHit !== undefined) return lowerHit;
      return "";
    }

    const sanPhamColIdx = findColIndex(header, "san_pham");

    function padRow(row, len) {
      if (row.length >= len) return row;
      const padded = row.slice();
      while (padded.length < len) padded.push("");
      return padded;
    }

    if (debugMode) {
      const unmatchedCounts = {};
      allRows.forEach(rawRow => {
        const row = padRow(rawRow, header.length);
        const rawCode = sanPhamColIdx !== -1 ? row[sanPhamColIdx] : undefined;
        const key = normKey(rawCode);
        if (!key) return;
        const group = lookupGroup(rawCode);
        if (!group) unmatchedCounts[key] = (unmatchedCounts[key] || 0) + 1;
      });
      const unmatchedList = Object.entries(unmatchedCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => ({ san_pham_raw: code, so_don: count }));
      res.status(200).json({
        nam_dang_xem: requestedYear,
        chan_doan_cot_header: {
          header_goc_cua_sheet: header,
          da_tim_thay_cot_san_pham: sanPhamColIdx !== -1,
          vi_tri_cot_san_pham: sanPhamColIdx,
          da_tim_thay_cot_san_pham_trong_bang_mapping: findColIndex(sanPhamRows[0] || [], "san_pham") !== -1,
          da_tim_thay_cot_san_pham_vn_group_trong_bang_mapping: findColIndex(sanPhamRows[0] || [], "san_pham_vn_group") !== -1,
          header_goc_cua_bang_mapping: sanPhamRows[0] || [],
        },
        chan_doan_do_dai_dong: {
          so_dong_bi_thieu_cot_cuoi: allRows.filter(r => r.length < header.length).length,
        },
        tong_so_dong: allRows.length,
        so_dong_thieu_san_pham: allRows.filter(row => !normKey(sanPhamColIdx !== -1 ? padRow(row, header.length)[sanPhamColIdx] : "")).length,
        so_ma_san_pham_khong_khop: unmatchedList.length,
        so_dong_bi_anh_huong: unmatchedList.reduce((s, x) => s + x.so_don, 0),
        so_ma_trong_bang_mapping: Object.keys(sanPhamMap).length,
        chi_tiet_khong_khop: unmatchedList.slice(0, 100),
      });
      return;
    }

    const headerWithGroup = [...header, "san_pham_vn_group"];
    const allRowsWithGroup = allRows.map(row => {
      const paddedRow = padRow(row, header.length);
      const rawCode = sanPhamColIdx !== -1 ? paddedRow[sanPhamColIdx] : undefined;
      const group = lookupGroup(rawCode);
      return [...paddedRow, group];
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
