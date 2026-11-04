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
  availableColumns,
  createCsvRecordParser,
} from "../lib/bi.js";
import { legacyConfigured, loadLegacy } from "../lib/legacy.js";
import { useRelaySession } from "../lib/bi.js";
import { relayConfigured, makeTicket, openBlob, RELAY_URL } from "../lib/relay.js";

async function compareNganh() {
  const legacy = await loadLegacy();
  const upstream = await fetchMainCsv();
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let idx = null;
  const pair = {};
  const byNewGroup = {};
  const byOldGroup = {};
  const spDiff = {};
  let total = 0;
  let khongCoTrongNguonCu = 0;
  let khongCoTrongNguonCuTien = 0;
  const parser = createCsvRecordParser(rec => {
    if (!idx) {
      const m = rec.map(mapHeader);
      idx = { ma: m.indexOf("ma_dh"), v: m.indexOf("gia_tri_den_bu"), sp: m.indexOf("san_pham"), g: m.indexOf("san_pham_vn_group") };
      return;
    }
    total++;
    const ma = String(rec[idx.ma] || "").trim();
    const v = Number(rec[idx.v]) || 0;
    const spMoi = String(rec[idx.sp] || "").trim();
    const nhomMoi = String(rec[idx.g] || "").trim() || "(Không rõ)";
    const old = legacy.byOrder.get(ma);
    if (!old) {
      khongCoTrongNguonCu++;
      khongCoTrongNguonCuTien += v;
      return;
    }
    const nhomCu = old.nhom_cu || "(Không rõ)";
    byNewGroup[nhomMoi] = (byNewGroup[nhomMoi] || 0) + v;
    byOldGroup[nhomCu] = (byOldGroup[nhomCu] || 0) + v;
    if (nhomCu === nhomMoi) return;
    const pk = nhomCu + " → " + nhomMoi;
    if (!pair[pk]) pair[pk] = { nhom_cu: nhomCu, nhom_moi: nhomMoi, so_dong: 0, gia_tri_den_bu: 0 };
    pair[pk].so_dong++;
    pair[pk].gia_tri_den_bu += v;
    const sk = old.san_pham_cu + " | " + spMoi;
    if (!spDiff[sk]) spDiff[sk] = { san_pham_cu: old.san_pham_cu, san_pham_moi: spMoi, nhom_cu: nhomCu, nhom_moi: nhomMoi, nhom_cu_neu_dung_san_pham_moi: legacy.lookup(spMoi) || "(không có trong mapping cũ)", so_dong: 0, gia_tri_den_bu: 0 };
    spDiff[sk].so_dong++;
    spDiff[sk].gia_tri_den_bu += v;
  });
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
  const groups = [...new Set([...Object.keys(byNewGroup), ...Object.keys(byOldGroup)])].map(g => ({
    nhom: g,
    tong_moi: Math.round(byNewGroup[g] || 0),
    tong_cu: Math.round(byOldGroup[g] || 0),
    chenh_lech: Math.round((byNewGroup[g] || 0) - (byOldGroup[g] || 0)),
  })).sort((a, b) => Math.abs(b.chenh_lech) - Math.abs(a.chenh_lech));
  const pairs = Object.values(pair).sort((a, b) => b.gia_tri_den_bu - a.gia_tri_den_bu);
  const sps = Object.values(spDiff).sort((a, b) => b.gia_tri_den_bu - a.gia_tri_den_bu);
  return {
    tong_dong_nguon_moi: total,
    dong_khong_co_o_nguon_cu: khongCoTrongNguonCu,
    tien_khong_co_o_nguon_cu: Math.round(khongCoTrongNguonCuTien),
    so_cap_nhom_bi_doi: pairs.length,
    theo_nhom: groups,
    cap_nhom_cu_sang_moi: pairs.slice(0, 100),
    chi_tiet_san_pham_lech: sps.slice(0, 300),
    mapping_cu: legacy.mapping,
  };
}

function fmtNow() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  if (req.query.ping === "1") {
    const probe = async (url, headers) => {
      if (!url) return { configured: false };
      const t0 = Date.now();
      try {
        const r = await fetch(url, { headers: headers || {} });
        const raw = await r.text().catch(() => "");
        return { host: new URL(url).host, status: r.status, ms: Date.now() - t0, server: r.headers.get("server") || "", cfMitigated: r.headers.get("cf-mitigated") || "", cfRay: r.headers.get("cf-ray") || "", cloudflareChallenge: r.headers.get("cf-mitigated") === "challenge" || /just a moment|cf-chl/i.test(raw) };
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
    };
    const base = (process.env.BI_BASE || "").replace(/\/+$/, "");
    const out = {
      build: "cr-ping-2026-11-04",
      at: new Date().toISOString(),
      auth_source: await probe(process.env.BI_AUTH_URL, process.env.BI_AUTH_KEY ? { "x-api-key": "khong-dung-ma-that" } : {}),
      bi: await probe(base ? `${base}/api/health` : "")
    };
    out.verdict = out.auth_source.cloudflareChallenge || out.bi.cloudflareChallenge
      ? `Cloudflare đang chặn: ${[out.auth_source.cloudflareChallenge ? "nguồn phiên BI (BI_AUTH_URL)" : "", out.bi.cloudflareChallenge ? "BI (BI_BASE)" : ""].filter(Boolean).join(" + ")}`
      : "Không thấy Cloudflare chặn";
    res.status(200).json(out);
    return;
  }

  const SESSION_SECRET = process.env.SESSION_SECRET;
  const session = SESSION_SECRET ? verifySession(req.headers.cookie, SESSION_SECRET) : null;
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.query.ticket === "1") {
    res.status(200).json({ ok: true, t: relayConfigured() ? makeTicket(session.email) : null, relayUrl: RELAY_URL });
    return;
  }
  const relayBlob = req.headers["x-bi-relay"];
  const relaySess = relayBlob ? openBlob(relayBlob) : null;
  useRelaySession(relaySess);
  if (relayConfigured() && !relaySess && req.query.debug !== "nganh") {
    res.status(428).json({ error: "NEED_RELAY" });
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

    if (req.query.debug === "nganh") {
      if (!legacyConfigured()) {
        res.status(400).json({ error: "Thiếu cấu hình nguồn cũ để so sánh" });
        return;
      }
      const t0 = Date.now();
      const out = await compareNganh();
      res.status(200).json({ thoi_gian_ms: Date.now() - t0, ...out });
      return;
    }

    if (req.query.debug === "1") {
      const t0 = Date.now();
      const upstream = await fetchMainCsv();
      const header = await readHeaderOnly(upstream);
      const mapped = header.map(mapHeader);
      const avail = availableColumns(mapped);
      res.status(200).json({
        thoi_gian_cho_nguon_ms: Date.now() - t0,
        cot_goc: header,
        cot_sau_doi_ten: avail,
        thieu_cot_bat_buoc: CORE_COLUMNS.filter(c => !avail.includes(c)),
        canh_bao: mapped.includes("warehouse_type") ? [] : ["Thiếu cột warehouse_type: vùng chịu trách nhiệm đang lấy hoàn toàn theo region_shortname"],
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
    if (!res.headersSent && err.message === "RELAY_SESSION_EXPIRED") {
      res.status(428).json({ error: "NEED_RELAY" });
    } else if (!res.headersSent) {
      res.status(502).json({ error: "Lỗi khi lấy dữ liệu" });
    } else {
      res.end();
    }
  }
}
