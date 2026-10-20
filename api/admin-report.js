import { adminConfigured, getAccess } from "../lib/admin.js";
import { isConfigured, fetchMainCsv } from "../lib/bi.js";
import { loadColumns, buildSummary } from "../lib/summary.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, data: null };
let pending = null;

function fmtNow() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function compute() {
  const upstream = await fetchMainCsv();
  const cols = await loadColumns(upstream);
  const data = buildSummary(cols);
  data.generatedAt = fmtNow();
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!adminConfigured() || !isConfigured()) {
    console.error("admin-report.js: thiếu cấu hình Environment Variables");
    res.status(503).json({ error: "Lỗi cấu hình máy chủ" });
    return;
  }

  const access = getAccess(req);
  if (!access.session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!access.allowed || !access.unlocked) {
    res.status(403).json({ error: "Forbidden", needUnlock: access.allowed });
    return;
  }

  try {
    const force = req.query.refresh === "1";
    if (!force && cache.data && Date.now() - cache.at < CACHE_TTL_MS) {
      res.status(200).json({ ...cache.data, fromCache: true });
      return;
    }
    if (!pending) {
      pending = compute().finally(() => { pending = null; });
    }
    const data = await pending;
    cache = { at: Date.now(), data };
    res.status(200).json({ ...data, fromCache: false });
  } catch (err) {
    console.error("admin-report.js error:", err.message);
    res.status(502).json({ error: "Lỗi khi tổng hợp dữ liệu" });
  }
}
