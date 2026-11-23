import { adminConfigured, getAccess } from "../lib/admin.js";
import { isConfigured, fetchMainCsv, useRelaySession } from "../lib/bi.js";
import { relayConfigured, openBlob } from "../lib/relay.js";
import { loadInsightRows, buildCategoryTree, buildInsightWorkbook } from "../lib/insight.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, rows: null };
let pending = null;

async function getRows(force) {
  if (!force && cache.rows && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }
  if (!pending) {
    pending = (async () => {
      const upstream = await fetchMainCsv();
      return loadInsightRows(upstream);
    })().finally(() => {
      pending = null;
    });
  }
  const rows = await pending;
  cache = { at: Date.now(), rows };
  return rows;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fileSafe(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!adminConfigured() || !isConfigured()) {
    console.error("insight-report.js: thiếu cấu hình Environment Variables");
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
  const q = req.query || {};
  const hasCache = cache.rows && Date.now() - cache.at < CACHE_TTL_MS && q.refresh !== "1";
  if (relayConfigured() && !relaySess && !hasCache) {
    res.status(428).json({ error: "NEED_RELAY" });
    return;
  }

  try {
    const rows = await getRows(q.refresh === "1");

    if (q.action === "meta") {
      const tree = buildCategoryTree(rows);
      res.status(200).json(tree);
      return;
    }

    const parseList = v => {
      if (v === undefined || v === null || v === "") return [];
      const arr = Array.isArray(v) ? v : String(v).split("\u0001");
      return arr.map(s => String(s).trim()).filter(Boolean);
    };
    const groups = parseList(q.groups);
    const items = parseList(q.items);
    const sanPhams = parseList(q.sanPhams);
    const sellers = parseList(q.sellers);
    const khachHangs = parseList(q.khachHangs);
    const from = DATE_RE.test(String(q.from || "")) ? String(q.from) : null;
    const to = DATE_RE.test(String(q.to || "")) ? String(q.to) : null;
    const dateField = ["tao", "hen_lay", "eform"].includes(q.dateField) ? q.dateField : "tao";

    const buffer = await buildInsightWorkbook(rows, { groups, items, sanPhams, sellers, khachHangs, from, to, dateField });
    const nameParts = groups.concat(items).slice(0, 2).map(fileSafe).filter(Boolean);
    const fname = "Insight_" + (nameParts.length ? nameParts.join("_") : "TuyChinh") + ".xlsx";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error("insight-report.js error:", err.message);
    if (err.message === "RELAY_SESSION_EXPIRED") res.status(428).json({ error: "NEED_RELAY" });
    else res.status(502).json({ error: "Lỗi khi tạo báo cáo insight" });
  }
}
