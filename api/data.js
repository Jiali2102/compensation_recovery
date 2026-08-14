// Vercel Serverless Function — lấy dữ liệu qua Google Sheets API bằng OAUTH2 REFRESH TOKEN
// (dùng chính tài khoản Google @ghn.vn của Jiali để xin quyền, không dùng API Key hay
// Service Account — vì công ty chặn share cho tài khoản ngoài domain @ghn.vn)
//
// ============================================================
// CÁCH HOẠT ĐỘNG:
// Một lần duy nhất, Jiali đăng nhập Google (tài khoản @ghn.vn có sẵn quyền xem Sheet) để lấy
// "refresh token". Từ đó về sau, mỗi lần có người mở dashboard, server dùng refresh token này
// đổi lấy access token mới rồi gọi Sheets API/Drive API — y hệt việc trình duyệt tự động đăng
// nhập lại mà không cần nhập mật khẩu mỗi lần.
//
// ============================================================
// HƯỚNG DẪN THÊM SHEET NĂM MỚI (2027, 2028...) — CHỈ CẦN SỬA Ở ĐÂY, KHÔNG SỬA GÌ KHÁC:
// 1. Mở sheet năm mới trên trình duyệt, copy ID từ URL:
//      https://docs.google.com/spreadsheets/d/{ID_NẰM_Ở_ĐÂY}/edit#gid={GID_NẰM_Ở_ĐÂY}
// 2. Đảm bảo tài khoản @ghn.vn đã dùng để lấy refresh token có quyền xem sheet đó
//    (nếu là sheet của người khác trong công ty, nhờ họ share cho đúng email @ghn.vn đó)
// 3. Vào Vercel → Settings → Environment Variables → thêm biến mới, ví dụ:
//      GOOGLE_SHEET_ID_2027 = <ID vừa copy>
// 4. Thêm 1 dòng vào mảng SHEETS bên dưới, copy đúng mẫu dòng có sẵn (đọc từ biến môi trường)
// 5. Mở file index.html, tìm div id="yearbar", thêm 1 button năm mới tương ứng
//    (dòng comment "Thêm năm mới:" đã ghi rõ ngay tại đó), và cập nhật AVAILABLE_YEARS
// 6. Commit lên GitHub, Vercel tự deploy lại
// ============================================================

const SHEETS = [
  { year: 2025, spreadsheetId: process.env.GOOGLE_SHEET_ID_2025, gid: 0 },
  { year: 2026, spreadsheetId: process.env.GOOGLE_SHEET_ID_2026, gid: 0 },
  // { year: 2027, spreadsheetId: process.env.GOOGLE_SHEET_ID_2027, gid: 0 },
].filter(s => s.spreadsheetId); // bỏ qua năm nào chưa cấu hình biến môi trường tương ứng

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  // Tái sử dụng access token còn hạn (trong cùng 1 instance đang "ấm") để đỡ gọi lại Google nhiều lần
  if (cachedToken && Date.now() < cachedTokenExpiry - 60000) {
    return cachedToken;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Thiếu GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN trong Environment Variables");
  }

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("Không làm mới được access token từ Google: " + errText);
  }
  const data = await resp.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

export default async function handler(req, res) {
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

  async function getSheetTitleByGid(spreadsheetId, gid, token) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Không lấy được thông tin sheet ${spreadsheetId} (HTTP ${r.status})`);
    const data = await r.json();
    const sheet = (data.sheets || []).find(s => s.properties.sheetId === gid);
    if (!sheet) throw new Error(`Không tìm thấy gid=${gid} trong sheet ${spreadsheetId}`);
    return sheet.properties.title;
  }

  async function getValues(spreadsheetId, gid, token) {
    const title = await getSheetTitleByGid(spreadsheetId, gid, token);
    const range = encodeURIComponent(`'${title}'`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Không lấy được dữ liệu từ sheet ${spreadsheetId} (HTTP ${r.status})`);
    const data = await r.json();
    return data.values || [];
  }

  async function getModifiedTime(spreadsheetId, token) {
    try {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=modifiedTime`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return null;
      const data = await r.json();
      return data.modifiedTime || null;
    } catch (e) {
      return null;
    }
  }

  try {
    const token = await getAccessToken();

    const [valuesResults, modifiedTimes] = await Promise.all([
      Promise.all(activeSheets.map(s => getValues(s.spreadsheetId, s.gid, token))),
      Promise.all(activeSheets.map(s => getModifiedTime(s.spreadsheetId, token))),
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
