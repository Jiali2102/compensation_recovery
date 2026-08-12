// Vercel Serverless Function — lấy dữ liệu qua Google Sheets API (nhanh, real-time hơn CSV publish)
// Đồng thời gọi Google Drive API để lấy thời gian sửa gần nhất của sheet đang xem (modifiedTime)
// Hỗ trợ tách riêng theo NĂM qua query param: /api/data?year=2025 hoặc /api/data?year=2026
//
// ============================================================
// HƯỚNG DẪN THÊM SHEET NĂM MỚI (2027, 2028...) — CHỈ CẦN SỬA Ở ĐÂY, KHÔNG SỬA GÌ KHÁC:
// 1. Mở sheet năm mới trên trình duyệt, copy ID từ URL:
//      https://docs.google.com/spreadsheets/d/{ID_NẰM_Ở_ĐÂY}/edit#gid={GID_NẰM_Ở_ĐÂY}
// 2. Đảm bảo sheet đó đã Share -> "Anyone with the link" -> Viewer (giống các sheet cũ)
// 3. Thêm 1 dòng vào mảng SHEETS bên dưới, copy đúng mẫu dòng có sẵn
// 4. Mở file index.html, tìm div id="yearbar", thêm 1 button năm mới tương ứng
//    (dòng comment "Thêm năm mới:" đã ghi rõ ngay tại đó)
// 5. Cập nhật mảng AVAILABLE_YEARS trong index.html để khớp với SHEETS bên dưới
// 6. Commit lên GitHub, Vercel tự deploy lại
// ============================================================
const SHEETS = [
  { year: 2025, spreadsheetId: "1YSUWR5GZADtmtZv9VGG5vpeWjkToq9YJ7xND27nbYdI", gid: 0 },
  { year: 2026, spreadsheetId: "1Uvx07l2mmUr0bmQdnUbuAPN38TY2mFEWPxpO7thyLe8", gid: 0 },
  // { year: 2025, spreadsheetId: "12jeRehojTgRmFEuBvuFyoWwY8cgbtd8kigN7HOxGhw4", gid: 0 },
  // { year: 2026, spreadsheetId: "1iFRPFRfZ4HIDx-a0m0EIfZSvkkausKJQZe-Wj-qBi5E", gid: 0 },
  // { year: 2027, spreadsheetId: "DÁN_ID_SHEET_2027_VÀO_ĐÂY", gid: 0 },
  // { year: 2028, spreadsheetId: "DÁN_ID_SHEET_2028_VÀO_ĐÂY", gid: 0 },
];

export default async function handler(req, res) {
  const API_KEY = process.env.GOOGLE_DRIVE_API_KEY;

  if (!API_KEY) {
    res.status(500).json({ error: "Thiếu GOOGLE_DRIVE_API_KEY trong Environment Variables" });
    return;
  }

  // Xác định năm cần lấy: từ query ?year=..., nếu không có/không hợp lệ thì mặc định năm mới nhất trong SHEETS
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

    // Gộp các sheet CÙNG NĂM lại (thường chỉ có 1), giữ 1 header duy nhất
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
    // Cache ngắn hạn ở tầng CDN của Vercel (không phải trình duyệt) để giảm tải khi nhiều người
    // cùng xem trong vài phút liên tiếp — data có thể trễ tối đa ~2 phút, đổi lại tốc độ tải nhanh hơn
    // hẳn khi Sheet đã phình to. stale-while-revalidate cho phép vẫn trả bản cũ tức thời trong lúc
    // âm thầm lấy bản mới ở nền, tránh người dùng phải chờ.
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    res.setHeader("Access-Control-Expose-Headers", "X-Data-Last-Modified");
    res.setHeader("X-Data-Last-Modified", latestModified);
    res.status(200).send(csvText);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy dữ liệu: " + err.message });
  }
}
