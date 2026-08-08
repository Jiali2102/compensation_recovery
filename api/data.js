// Vercel Serverless Function — proxy lấy dữ liệu, không để lộ link nguồn gốc cho trình duyệt người xem
export default async function handler(req, res) {
  const SOURCE_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTB7616KVIBlXdYcuTNS9cMeGvKNC2nTvymsGyjIyKL1z8GBd_b3Y5D5hsWVqkdBmfE_lJPKErsoRPd/pub?gid=0&single=true&output=csv";

  try {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) {
      res.status(502).json({ error: "Không lấy được dữ liệu từ nguồn" });
      return;
    }
    const text = await response.text();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    // Không cache ở tầng CDN/browser để luôn lấy dữ liệu mới nhất
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).send(text);
  } catch (err) {
    res.status(500).json({ error: "Lỗi server khi lấy dữ liệu" });
  }
}
