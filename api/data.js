import { verifySession } from "../lib/session.js";
import {
  isConfigured,
  hasVersionCard,
  fetchVersion,
  fetchMainCsv,
  streamTransformed,
  readHeaderOnly,
  mapHeader,
  CORE_COLUMNS,
} from "../lib/bi.js";

function fmtNow() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  const SESSION_SECRET = process.env.SESSION_SECRET;
  const session = SESSION_SECRET ? verifySession(req.headers.cookie, SESSION_SECRET) : null;
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!isConfigured()) {
    console.error("data.js: thiếu cấu hình Environment Variables (BI_BASE / BI_CARD_MAIN / BI_KEY hoặc BI_AUTH_URL + BI_AUTH_KEY)");
    res.status(500).json({ error: "Lỗi cấu hình máy chủ" });
    return;
  }

  try {
    if (req.query.meta === "1") {
      let version = null;
      if (hasVersionCard()) {
        try {
          version = await fetchVersion();
        } catch (e) {
          console.error("data.js version:", e.message);
        }
      }
      res.status(200).json({ ok: true, version, checkedAt: fmtNow() });
      return;
    }

    if (req.query.debug === "1") {
      const t0 = Date.now();
      const upstream = await fetchMainCsv();
      const header = await readHeaderOnly(upstream);
      const mapped = header.map(mapHeader);
      res.status(200).json({
        thoi_gian_cho_nguon_ms: Date.now() - t0,
        cot_goc: header,
        cot_sau_doi_ten: mapped,
        thieu_cot_bat_buoc: CORE_COLUMNS.filter(c => !mapped.includes(c)),
      });
      return;
    }

    const mode = req.query.cols === "all" ? "all" : "core";
    const upstream = await fetchMainCsv();
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Access-Control-Expose-Headers", "X-Data-Fetched-At");
    res.setHeader("X-Data-Fetched-At", fmtNow());
    await streamTransformed(upstream, res, mode);
  } catch (err) {
    console.error("data.js error:", err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: "Lỗi khi lấy dữ liệu" });
    } else {
      res.end();
    }
  }
}
