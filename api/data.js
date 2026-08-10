// Vercel Serverless Function — lấy dữ liệu qua Google Sheets API (nhanh, real-time hơn CSV publish)
// Đồng thời gọi Google Drive API để lấy thời gian sửa gần nhất trong các sheet nguồn (modifiedTime)
//
// ============================================================
// HƯỚNG DẪN THÊM SHEET NĂM MỚI (2027, 2028...) — CHỈ CẦN SỬA Ở ĐÂY, KHÔNG SỬA GÌ KHÁC:
// 1. Mở sheet năm mới trên trình duyệt, copy ID từ URL:
//      https://docs.google.com/spreadsheets/d/{ID_NẰM_Ở_ĐÂY}/edit#gid={GID_NẰM_Ở_ĐÂY}
// 2. Đảm bảo sheet đó đã Share -> "Anyone with the link" -> Viewer (giống các sheet cũ)
// 3. Thêm 1 dòng vào mảng SHEETS bên dưới, copy đúng mẫu dòng có sẵn
// 4. Commit lên GitHub, Vercel tự deploy lại — KHÔNG cần sửa index.html hay bất kỳ file nào khác
// Toàn bộ sheet trong danh sách sẽ tự động được gộp chung làm 1 nguồn dữ liệu cho dashboard.
// ============================================================
const SHEETS = [
  // { year: 2025, spreadsheetId: "12jeRehojTgRmFEuBvuFyoWwY8cgbtd8kigN7HOxGhw4", gid: 0 },
  { year: 2026, spreadsheetId: "1iFRPFRfZ4HIDx-a0m0EIfZSvkkausKJQZe-Wj-qBi5E", gid: 0 },
  // { year: 2027, spreadsheetId: "DÁN_ID_SHEET_2027_VÀO_ĐÂY", gid: 0 },
  // { year: 2028, spreadsheetId: "DÁN_ID_SHEET_2028_VÀO_ĐÂY", gid: 0 },
];

export default async function handler(req, res) {
  const API_KEY = process.env.GOOGLE_DRIVE_API_KEY;

  if (!API_KEY) {
    res.status(500).json({ error: "Thiếu GOOGLE_DRIVE_API_KEY trong Environment Variables" });
    return;
  }

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
      Promise.all(SHEETS.map(s => getValues(s.spreadsheetId, s.gid))),
      Promise.all(SHEETS.map(s => getModifiedTime(s.spreadsheetId))),
    ]);

    // Gộp toàn bộ sheet lại: giữ 1 dòng header duy nhất (từ sheet đầu tiên), nối các dòng dữ liệu phía sau
    let header = null;
    let allRows = [];
    valuesResults.forEach(rows => {
      if (!rows.length) return;
      if (!header) header = rows[0];
      allRows = allRows.concat(rows.slice(1));
    });
    if (!header) header = [];

    const csvText = [header, ...allRows].map(row => row.map(csvEscape).join(",")).join("\n");

    // Lấy thời điểm sửa gần nhất trong TẤT CẢ các sheet nguồn (không phải chỉ sheet đầu tiên)
    const latestModified = modifiedTimes
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] || "";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Access-Control-Expose-Headers", "X-Data-Last-Modified");
    res.setHeader("X-Data-Last-Modified", latestModified);
    res.status(200).send(csvText);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy dữ liệu: " + err.message });
  }
}
