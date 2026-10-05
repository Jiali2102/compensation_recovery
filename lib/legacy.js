function normKey(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

function findCol(header, name) {
  const t = name.toLowerCase();
  return header.findIndex(h => normKey(h).toLowerCase() === t);
}

export function legacyConfigured() {
  return !!(process.env.DATA_KEY_1 && (process.env.DATA_SRC_A || process.env.DATA_SRC_B));
}

async function sheetValues(spreadsheetId, range, key) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?key=${key}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("LEGACY_" + r.status);
  const j = await r.json();
  return j.values || [];
}

async function firstSheetTitle(spreadsheetId, key) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties&key=${key}`);
  if (!r.ok) throw new Error("LEGACY_META_" + r.status);
  const j = await r.json();
  const sh = (j.sheets || []).find(s => s.properties.sheetId === 0) || (j.sheets || [])[0];
  return sh.properties.title;
}

export async function loadLegacy() {
  const key = process.env.DATA_KEY_1;
  const srcs = [process.env.DATA_SRC_A, process.env.DATA_SRC_B].filter(Boolean);
  const mapRows = process.env.DATA_SRC_A ? await sheetValues(process.env.DATA_SRC_A, "san_pham", key) : [];
  const mapExact = {};
  const mapLower = {};
  const mapping = [];
  if (mapRows.length > 1) {
    const h = mapRows[0];
    const iSp = findCol(h, "san_pham");
    const iVn = findCol(h, "san_pham_vn");
    const iG = findCol(h, "san_pham_vn_group");
    mapRows.slice(1).forEach(row => {
      const k = normKey(row[iSp]);
      const g = row[iG] ? normKey(row[iG]) : "";
      if (!k) return;
      mapExact[k] = g;
      mapLower[k.toLowerCase()] = g;
      mapping.push({ san_pham: k, san_pham_vn: iVn !== -1 ? normKey(row[iVn]) : "", san_pham_vn_group: g });
    });
  }
  const lookup = raw => {
    const k = normKey(raw);
    if (!k) return "";
    if (Object.prototype.hasOwnProperty.call(mapExact, k)) return mapExact[k];
    const l = mapLower[k.toLowerCase()];
    return l === undefined ? "" : l;
  };
  const byOrder = new Map();
  for (const id of srcs) {
    const title = await firstSheetTitle(id, key);
    const rows = await sheetValues(id, `'${title}'`, key);
    if (rows.length < 2) continue;
    const h = rows[0];
    const iMa = findCol(h, "ma_dh");
    const iSp = findCol(h, "san_pham");
    if (iMa === -1) continue;
    rows.slice(1).forEach(row => {
      const ma = normKey(row[iMa]);
      if (!ma || byOrder.has(ma)) return;
      const sp = iSp !== -1 ? normKey(row[iSp]) : "";
      byOrder.set(ma, { san_pham_cu: sp, nhom_cu: lookup(sp) });
    });
  }
  return { mapping, byOrder, lookup };
}
