import zlib from "zlib";
import { once } from "events";
import { finished } from "stream/promises";

export const FIELD_MAP = {
  ma_dh: "ma_dh",
  client_id: "nhom_kh",
  thoi_gian_tao: "thoi_gian_tao",
  thoi_gian_hen_lay: "thoi_gian_hen_lay",
  seller_name: "seller_name",
  channel: "channel",
  order_value: "order_value",
  cod_amount: "cod_amount",
  insurance_value: "insurance_value",
  loai_yeu_cau: "loai_yeu_cau",
  hu_hong: "hu_hong",
  gia_tri_den_bu: "gia_tri_den_bu",
  ngay_duyet_eform: "ngay_duyet_eform",
  recovery_amount: "so_tien_da_truy_thu",
  route: "tuyen",
  cat_fallback: "cat_fallback",
  san_pham: "san_pham",
  san_pham_vn: "san_pham_vn",
  san_pham_vn_group: "san_pham_vn_group",
  warehouse_name: "kho_chiu_trach_nhiem",
  province_name: "tinh_chiu_trach_nhiem",
  region_shortname: "vung_chiu_trach_nhiem",
};

export const CORE_COLUMNS = [
  "ma_dh",
  "nhom_kh",
  "seller_name",
  "channel",
  "loai_yeu_cau",
  "gia_tri_den_bu",
  "ngay_duyet_eform",
  "so_tien_da_truy_thu",
  "tuyen",
  "san_pham",
  "san_pham_vn",
  "san_pham_vn_group",
  "kho_chiu_trach_nhiem",
  "vung_chiu_trach_nhiem",
];

export function normHeader(h) {
  let s = String(h || "").replace(/^\uFEFF/, "");
  const arrow = s.lastIndexOf("→");
  if (arrow !== -1) s = s.slice(arrow + 1);
  return s.trim().toLowerCase().replace(/\s+/g, "_");
}

export function mapHeader(h) {
  const k = normHeader(h);
  return FIELD_MAP[k] || k;
}

const cfg = () => ({
  base: (process.env.BI_BASE || "").replace(/\/+$/, ""),
  cardMain: process.env.BI_CARD_MAIN,
  cardVer: process.env.BI_CARD_VER,
  apiKey: process.env.BI_KEY,
  authUrl: process.env.BI_AUTH_URL,
  authKey: process.env.BI_AUTH_KEY,
});

let cachedSession = null;
let cachedSessionAt = 0;
const SESSION_TTL_MS = 50 * 60 * 1000;

async function getAuthHeaders(force) {
  const c = cfg();
  if (c.apiKey) return { "x-api-key": c.apiKey };
  if (!force && cachedSession && Date.now() - cachedSessionAt < SESSION_TTL_MS) {
    return { "X-Metabase-Session": cachedSession };
  }
  if (!c.authUrl || !c.authKey) throw new Error("CONFIG_AUTH");
  const r = await fetch(c.authUrl, { headers: { "x-api-key": c.authKey } });
  if (!r.ok) throw new Error("AUTH_SOURCE_" + r.status);
  const j = await r.json();
  const s = j.mbSession || j.session || j.token;
  if (!s) throw new Error("AUTH_SOURCE_EMPTY");
  cachedSession = s;
  cachedSessionAt = Date.now();
  return { "X-Metabase-Session": s };
}

export function isConfigured() {
  const c = cfg();
  return !!(c.base && c.cardMain && (c.apiKey || (c.authUrl && c.authKey)));
}

export function hasVersionCard() {
  return !!cfg().cardVer;
}

async function biFetch(path, init) {
  const c = cfg();
  for (let attempt = 0; attempt < 2; attempt++) {
    const auth = await getAuthHeaders(attempt > 0);
    const r = await fetch(c.base + path, { ...init, headers: { ...(init.headers || {}), ...auth } });
    if (r.status === 401 && !c.apiKey && attempt === 0) {
      cachedSession = null;
      continue;
    }
    return r;
  }
}

export async function fetchMainCsv() {
  const c = cfg();
  const body = new URLSearchParams({ format_rows: "false", parameters: "[]" }).toString();
  const r = await biFetch(`/api/card/${c.cardMain}/query/csv`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const ct = r.headers.get("content-type") || "";
  if (!r.ok || !/csv|octet-stream|text\/plain/i.test(ct)) {
    const t = await r.text().catch(() => "");
    throw new Error("BI_MAIN_" + r.status + " " + t.slice(0, 300));
  }
  return r;
}

export async function fetchVersion() {
  const c = cfg();
  if (!c.cardVer) return null;
  const r = await biFetch(`/api/card/${c.cardVer}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parameters: [] }),
  });
  if (!r.ok) throw new Error("BI_VER_" + r.status);
  const j = await r.json();
  const row = j && j.data && j.data.rows && j.data.rows[0];
  if (!row) throw new Error("BI_VER_EMPTY");
  return row.map(v => (v === null || v === undefined ? "" : String(v))).join("|");
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function createCsvRecordParser(onRecord) {
  let field = "";
  let record = [];
  let inQuotes = false;
  let pendingQuote = false;
  let lastWasCR = false;

  function endField() {
    record.push(field);
    field = "";
  }
  function endRecord() {
    endField();
    const rec = record;
    record = [];
    if (!(rec.length === 1 && rec[0] === "")) onRecord(rec);
  }

  return {
    push(text) {
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (pendingQuote) {
          pendingQuote = false;
          if (ch === '"') {
            field += '"';
            continue;
          }
          inQuotes = false;
        }
        if (inQuotes) {
          if (ch === '"') pendingQuote = true;
          else field += ch;
          continue;
        }
        if (lastWasCR) {
          lastWasCR = false;
          if (ch === "\n") continue;
        }
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          endField();
        } else if (ch === "\r") {
          lastWasCR = true;
          endRecord();
        } else if (ch === "\n") {
          endRecord();
        } else {
          field += ch;
        }
      }
    },
    end() {
      if (pendingQuote) {
        pendingQuote = false;
        inQuotes = false;
      }
      if (field !== "" || record.length) endRecord();
    },
  };
}

export function buildProjector(headerRow, mode) {
  const mapped = headerRow.map(mapHeader);
  const wanted = mode === "all" ? mapped.filter((n, i) => mapped.indexOf(n) === i) : CORE_COLUMNS.filter(n => mapped.includes(n));
  const idx = wanted.map(n => mapped.indexOf(n));
  return {
    mapped,
    wanted,
    missingCore: CORE_COLUMNS.filter(n => !mapped.includes(n)),
    headerLine: wanted.map(csvCell).join(",") + "\n",
    line: rec => idx.map(i => csvCell(rec[i])).join(",") + "\n",
  };
}

export async function streamTransformed(upstream, res, mode) {
  const gz = zlib.createGzip({ level: 6 });
  gz.pipe(res);
  let projector = null;
  let rows = 0;
  let buf = "";
  const parser = createCsvRecordParser(rec => {
    if (!projector) {
      projector = buildProjector(rec, mode);
      buf += projector.headerLine;
      return;
    }
    rows++;
    buf += projector.line(rec);
  });
  const drainIfNeeded = async force => {
    if (!buf.length || (!force && buf.length < 65536)) return;
    const ok = gz.write(buf);
    buf = "";
    if (!ok) await once(gz, "drain");
  };
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
    await drainIfNeeded(false);
  }
  parser.push(decoder.decode());
  parser.end();
  await drainIfNeeded(true);
  gz.end();
  await finished(res).catch(() => {});
  return rows;
}

export async function readHeaderOnly(upstream) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let header = null;
  const parser = createCsvRecordParser(rec => {
    if (!header) header = rec;
  });
  while (!header) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  if (!header) parser.end();
  reader.cancel().catch(() => {});
  return header || [];
}
