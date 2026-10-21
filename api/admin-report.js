import { adminConfigured, getAccess } from "../lib/admin.js";
import { isConfigured, fetchMainCsv } from "../lib/bi.js";
import { loadColumns, buildSummary } from "../lib/summary.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, cols: null, generatedAt: "" };
let pending = null;

function fmtNow() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function getColumns(force) {
  if (!force && cache.cols && Date.now() - cache.at < CACHE_TTL_MS) {
    return { cols: cache.cols, generatedAt: cache.generatedAt, fromCache: true };
  }
  if (!pending) {
    pending = (async () => {
      const upstream = await fetchMainCsv();
      return loadColumns(upstream);
    })().finally(() => {
      pending = null;
    });
  }
  const cols = await pending;
  cache = { at: Date.now(), cols, generatedAt: fmtNow() };
  return { cols, generatedAt: cache.generatedAt, fromCache: false };
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
    const q = req.query || {};
    const sel = {
      week: /^\d{4}-\d{2}-\d{2}$/.test(String(q.week || "")) ? String(q.week) : null,
      month: /^\d{4}-\d{2}$/.test(String(q.month || "")) ? String(q.month) : null,
    };
    const got = await getColumns(q.refresh === "1");
    const data = buildSummary(got.cols, sel);
    data.generatedAt = got.generatedAt;
    data.fromCache = got.fromCache;
    res.status(200).json(data);
  } catch (err) {
    console.error("admin-report.js error:", err.message);
    res.status(502).json({ error: "Lỗi khi tổng hợp dữ liệu" });
  }
}
