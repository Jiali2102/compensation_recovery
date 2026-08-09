// Vercel Serverless Function — proxy lấy dữ liệu, không để lộ link nguồn gốc cho trình duyệt người xem
// Đồng thời gọi Google Drive API để lấy thời gian sửa Sheet gốc lần cuối (modifiedTime)
export default async function handler(req, res) {
  const SOURCE_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTB7616KVIBlXdYcuTNS9cMeGvKNC2nTvymsGyjIyKL1z8GBd_b3Y5D5hsWVqkdBmfE_lJPKErsoRPd/pub?gid=0&single=true&output=csv";
  const SHEET_FILE_ID = "1iFRPFRfZ4HIDx-a0m0EIfZSvkkausKJQZe-Wj-qBi5E";
  const API_KEY = process.env.GOOGLE_DRIVE_API_KEY;

  try {
    const [csvResponse, metaResult] = await Promise.all([
      fetch(SOURCE_URL),
      API_KEY
        ? fetch(`https://www.googleapis.com/drive/v3/files/${SHEET_FILE_ID}?fields=modifiedTime&key=${API_KEY}`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    if (!csvResponse.ok) {
      res.status(502).json({ error: "Không lấy được dữ liệu từ nguồn" });
      return;
    }
    const text = await csvResponse.text();
    const modifiedTime = metaResult && metaResult.modifiedTime ? metaResult.modifiedTime : "";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Access-Control-Expose-Headers", "X-Data-Last-Modified");
    res.setHeader("X-Data-Last-Modified", modifiedTime);
    res.status(200).send(text);
  } catch (err) {
    res.status(500).json({ error: "Lỗi server khi lấy dữ liệu" });
  }
}
