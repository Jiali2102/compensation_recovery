import { adminConfigured, getAccess } from "../lib/admin.js";
import { isConfigured, fetchMainCsv, useRelaySession } from "../lib/bi.js";
import { relayConfigured, openBlob } from "../lib/relay.js";
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

  const relayBlob = req.headers["x-bi-relay"];
  const relaySess = relayBlob ? openBlob(relayBlob) : null;
  useRelaySession(relaySess);
  const q0 = req.query || {};
  const hasCache = cache.cols && Date.now() - cache.at < CACHE_TTL_MS && q0.refresh !== "1";
  if (relayConfigured() && !relaySess && !hasCache) {
    res.status(428).json({ error: "NEED_RELAY" });
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
    if (err.message === "RELAY_SESSION_EXPIRED") res.status(428).json({ error: "NEED_RELAY" });
    else res.status(502).json({ error: "Lỗi khi tổng hợp dữ liệu" });
  }
}
