import { createCsvRecordParser, mapHeader, DERIVED } from "./bi.js";

const SCOPE_ACC = { "18692": "SPE", "3892833": "SPB" };
const NO_DATA = "(Không rõ)";
const NO_KHO = "(Chưa xác định kho)";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ONE_DAY = 86400000;

export const THRESHOLDS = {
  totalWowWarn: 20,
  totalWowHigh: 40,
  avg4Over: 25,
  groupMinValue: 20e6,
  groupMinShare: 0.03,
  groupSurgePct: 50,
  groupSurgeHigh: 100,
  concentration: { ng: 40, tu: 40, kh: 40, se: 15 },
  unmappedShare: 10,
  mtdMomWarn: 20,
  mtdMomHigh: 40,
  topProdCount: 5,
  topProdMinValue: 50e6,
  topProdMinShare: 0.02,
  topProdAlertShare: 5,
  outlierSigma: 3,
  outlierListMax: 2000,
};

const DIM_LABEL = {
  acc: "Account",
  lo: "Loại yêu cầu",
  ng: "Nhóm ngành hàng",
  rt: "Sản phẩm",
  tu: "Tuyến",
  kh: "Kho chịu trách nhiệm",
  se: "Seller",
  vu: "Vùng",
  ch: "Kênh (WH/MP)",
};

function makeDict() {
  const map = new Map();
  const list = [];
  return {
    list,
    id(v) {
      let i = map.get(v);
      if (i === undefined) {
        i = list.length;
        map.set(v, i);
        list.push(v);
      }
      return i;
    },
  };
}

function money(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  const f = (v, u) => v.toFixed(2).replace(".", ",") + " " + u;
  if (a >= 1e9) return f(n / 1e9, "tỷ");
  if (a >= 1e6) return f(n / 1e6, "triệu");
  if (a >= 1e3) return f(n / 1e3, "nghìn");
  return Math.round(n) + "đ";
}

function pctTxt(p) {
  return (p > 0 ? "+" : "") + p.toFixed(2) + "%";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

const infoCache = new Map();

function dateInfo(di) {
  let v = infoCache.get(di);
  if (v) return v;
  const y = Math.floor(di / 10000);
  const mo = Math.floor(di / 100) % 100;
  const d = di % 100;
  const ms = Date.UTC(y, mo - 1, d);
  const dayNum = Math.floor(ms / ONE_DAY);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  const thu = new Date(ms);
  thu.setUTCDate(thu.getUTCDate() - dow + 3);
  const ft = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  const fdn = (ft.getUTCDay() + 6) % 7;
  ft.setUTCDate(ft.getUTCDate() - fdn + 3);
  const week = 1 + Math.round((thu - ft) / (7 * ONE_DAY));
  const isoYear = thu.getUTCFullYear();
  v = {
    y,
    mo,
    d,
    dayNum,
    dow,
    month: y + "-" + pad2(mo),
    weekLabel: "W" + pad2(week) + "-" + isoYear,
  };
  infoCache.set(di, v);
  return v;
}

function diOfDayNum(dn) {
  const dt = new Date(dn * ONE_DAY);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

function dateStr(dn) {
  return new Date(dn * ONE_DAY).toISOString().slice(0, 10);
}

function winEnd(dayNum, dow) {
  return dayNum + ((1 - dow + 7) % 7);
}

function monthWindow(anchor, count) {
  const list = [];
  for (let k = 0; k < count; k++) {
    let y = anchor.y;
    let m = anchor.mo - k;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    list.push({ key: y + "-" + pad2(m), label: "Th" + pad2(m) + "/" + y, y, m });
  }
  return list;
}

function monthLabel(key) {
  const p = key.split("-");
  return "Th" + p[1] + "/" + p[0];
}

function buildPos(headerRow) {
  const mapped = headerRow.map(mapHeader);
  const pos = {};
  mapped.forEach((name, i) => {
    if (pos[name] === undefined) pos[name] = i;
  });
  return pos;
}

function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function addRow(c, pos, rec) {
  const g = name => (pos[name] === undefined ? "" : rec[pos[name]]);
  const ma = String(g("ma_dh") ?? "").trim();
  if (!ma) return;
  const ds = String(g("ngay_duyet_eform") ?? "").trim().slice(0, 10);
  const m = DATE_RE.exec(ds);
  if (!m) {
    c.noDate++;
    return;
  }
  const clean = v => {
    const s = String(v ?? "").trim();
    return s || NO_DATA;
  };
  const kho = String(g("kho_chiu_trach_nhiem") ?? "").trim();
  let vung = String(g("vung_chiu_trach_nhiem") ?? "").trim();
  if (!vung && pos.region_shortname !== undefined) {
    vung = String(DERIVED.vung_chiu_trach_nhiem.calc(g) ?? "").trim();
  }
  const spVn = String(g("san_pham_vn") ?? "").trim();
  const sp = String(g("san_pham") ?? "").trim();
  c.ma.push(ma);
  c.d.push(Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]));
  c.den.push(num(g("gia_tri_den_bu")));
  c.cl.push(c.dicts.cl.id(String(g("nhom_kh") ?? "").trim()));
  c.lo.push(c.dicts.lo.id(clean(g("loai_yeu_cau"))));
  c.ng.push(c.dicts.ng.id(clean(g("san_pham_vn_group"))));
  c.rt.push(c.dicts.rt.id(spVn || sp || NO_DATA));
  c.tu.push(c.dicts.tu.id(clean(g("tuyen"))));
  c.kh.push(c.dicts.kh.id(kho || NO_KHO));
  c.vu.push(c.dicts.vu.id(vung || NO_DATA));
  c.se.push(c.dicts.se.id(clean(g("seller_name"))));
  c.ch.push(String(g("channel") ?? "").toLowerCase().includes("wh") ? 1 : 0);
  c.n++;
}

export async function loadColumns(upstream) {
  const c = {
    n: 0,
    noDate: 0,
    ma: [],
    d: [],
    den: [],
    cl: [],
    lo: [],
    ng: [],
    rt: [],
    tu: [],
    kh: [],
    vu: [],
    se: [],
    ch: [],
    dicts: {
      cl: makeDict(),
      lo: makeDict(),
      ng: makeDict(),
      rt: makeDict(),
      tu: makeDict(),
      kh: makeDict(),
      vu: makeDict(),
      se: makeDict(),
    },
  };
  let pos = null;
  const parser = createCsvRecordParser(rec => {
    if (!pos) {
      pos = buildPos(rec);
      return;
    }
    addRow(c, pos, rec);
  });
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
  return c;
}

function aggDims(c, dims, include, slotOf, slots) {
  const maps = dims.map(() => new Map());
  for (let i = 0; i < c.n; i++) {
    if (!include(i)) continue;
    const s = slotOf(i);
    if (s < 0) continue;
    for (let j = 0; j < dims.length; j++) {
      const key = dims[j].get(i);
      let e = maps[j].get(key);
      if (!e) {
        e = new Float64Array(slots);
        maps[j].set(key, e);
      }
      e[s] += c.den[i];
    }
  }
  return maps;
}

function toItems(map, withAvg) {
  const items = [];
  map.forEach((e, name) => {
    if (e[0] <= 0 && e[1] <= 0) return;
    items.push({
      name,
      cur: Math.round(e[0]),
      prev: Math.round(e[1]),
      avg4: withAvg ? Math.round((e[1] + e[2] + e[3] + e[4]) / 4) : null,
    });
  });
  items.sort((a, b) => b.cur - a.cur);
  const total = items.reduce((s, it) => s + it.cur, 0) || 1;
  items.forEach(it => {
    it.pct = it.prev > 0 ? ((it.cur - it.prev) / it.prev) * 100 : null;
    it.share = (it.cur / total) * 100;
  });
  return items;
}

function pctOf(cur, prev) {
  return prev > 0 ? ((cur - prev) / prev) * 100 : null;
}

const LEVEL_ORDER = { cao: 0, tb: 1, luu: 2, tot: 3 };

export function buildSummary(c, sel) {
  sel = sel || {};
  const n = c.n;
  if (!n) return { empty: true };
  const T = THRESHOLDS;
  const info = new Array(n);
  const isW = new Uint8Array(n);
  const we = new Int32Array(n);
  let latestW = 0;
  const winTotals = new Map();
  const monTotals = new Map();
  for (let i = 0; i < n; i++) {
    const di = c.d[i];
    const inf = dateInfo(di);
    info[i] = inf;
    if (SCOPE_ACC[c.dicts.cl.list[c.cl[i]]]) {
      isW[i] = 1;
      if (di > latestW) latestW = di;
      const e = winEnd(inf.dayNum, inf.dow);
      we[i] = e;
      let wt = winTotals.get(e);
      if (!wt) {
        wt = { den: 0, n: 0 };
        winTotals.set(e, wt);
      }
      wt.den += c.den[i];
      wt.n++;
      let mt = monTotals.get(inf.month);
      if (!mt) {
        mt = { den: 0, n: 0 };
        monTotals.set(inf.month, mt);
      }
      mt.den += c.den[i];
      mt.n++;
    }
  }
  if (!latestW) return { empty: true };

  const aW = dateInfo(latestW);
  const latestEnd = winEnd(aW.dayNum, aW.dow);

  let selEnd = latestEnd;
  if (typeof sel.week === "string" && DATE_RE.test(sel.week)) {
    const p = DATE_RE.exec(sel.week);
    const dn = Math.floor(Date.UTC(Number(p[1]), Number(p[2]) - 1, Number(p[3])) / ONE_DAY);
    if (winTotals.has(dn)) selEnd = dn;
  }
  let selMonth = aW.month;
  if (typeof sel.month === "string" && monTotals.has(sel.month)) selMonth = sel.month;

  const WK = [];
  for (let k = 0; k < 8; k++) {
    const endk = selEnd - 7 * k;
    WK.push({
      end: endk,
      start: endk - 6,
      label: dateInfo(diOfDayNum(endk)).weekLabel,
      startStr: dateStr(endk - 6),
      endStr: dateStr(endk),
    });
  }
  const wkIndex = new Map(WK.map((w, i) => [w.end, i]));

  const selParts = selMonth.split("-");
  const MO = monthWindow({ y: Number(selParts[0]), mo: Number(selParts[1]) }, 6);
  const moIndex = new Map(MO.map((m, i) => [m.key, i]));
  const openMonth = selMonth === aW.month;
  const cutDay = aW.d;

  const kw = new Int8Array(n).fill(-1);
  const km = new Int8Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!isW[i]) continue;
    const a = wkIndex.get(we[i]);
    if (a !== undefined) kw[i] = a;
    const b = moIndex.get(info[i].month);
    if (b !== undefined) km[i] = b;
  }

  const wt = WK.map(() => ({ den: 0, n: 0 }));
  const mt = MO.map(() => ({ den: 0, n: 0, denLike: 0 }));
  for (let i = 0; i < n; i++) {
    if (!isW[i]) continue;
    const k = kw[i];
    if (k >= 0) {
      wt[k].den += c.den[i];
      wt[k].n++;
    }
    const m = km[i];
    if (m >= 0) {
      const t = mt[m];
      t.den += c.den[i];
      t.n++;
      if (!openMonth || info[i].d <= cutDay) t.denLike += c.den[i];
    }
  }

  const L = (key, i) => c.dicts[key].list[c[key][i]];
  const dims = [
    { id: "acc", get: i => SCOPE_ACC[L("cl", i)] },
    { id: "lo", get: i => L("lo", i) },
    { id: "ng", get: i => L("ng", i) },
    { id: "rt", get: i => L("rt", i) },
    { id: "tu", get: i => L("tu", i) },
    { id: "kh", get: i => L("kh", i) },
    { id: "se", get: i => L("se", i) },
    { id: "vu", get: i => L("vu", i) },
    { id: "ch", get: i => (c.ch[i] ? "WH" : "MP") },
  ];
  const TOPN = { acc: 5, lo: 8, ng: 8, rt: 10, tu: 8, kh: 8, se: 10, vu: 8, ch: 5 };

  const wMaps = aggDims(
    c,
    dims,
    i => isW[i] === 1,
    i => {
      const k = kw[i];
      return k >= 0 && k <= 4 ? k : -1;
    },
    5
  );
  const mMaps = aggDims(
    c,
    dims,
    i => isW[i] === 1,
    i => {
      const k = km[i];
      if (k === 0) return 0;
      if (k === 1 && (!openMonth || info[i].d <= cutDay)) return 1;
      return -1;
    },
    2
  );
  const wAll = {};
  const mAll = {};
  const wDims = {};
  const mDims = {};
  dims.forEach((d, j) => {
    wAll[d.id] = toItems(wMaps[j], true);
    mAll[d.id] = toItems(mMaps[j], false);
    wDims[d.id] = wAll[d.id].slice(0, TOPN[d.id]);
    mDims[d.id] = mAll[d.id].slice(0, TOPN[d.id]);
  });

  const w0 = wt[0];
  const weekPrev = wt[1].den;
  const weekAvg4 = (wt[1].den + wt[2].den + wt[3].den + wt[4].den) / 4;
  const weekPct = pctOf(w0.den, weekPrev);
  const weekAvgPct = pctOf(w0.den, weekAvg4);
  const m0 = mt[0];
  const monthPrev = mt[1].denLike;
  const monthPct = pctOf(m0.den, monthPrev);

  let oSum = 0;
  let oSq = 0;
  let oN = 0;
  for (let i = 0; i < n; i++) {
    if (isW[i] && kw[i] === 0) {
      oSum += c.den[i];
      oSq += c.den[i] * c.den[i];
      oN++;
    }
  }
  const oMean = oN ? oSum / oN : 0;
  const oSd = oN ? Math.sqrt(Math.max(0, oSq / oN - oMean * oMean)) : 0;
  const oThr = oMean + T.outlierSigma * oSd;
  const oIdx = [];
  for (let i = 0; i < n; i++) {
    if (isW[i] && kw[i] === 0 && c.den[i] > oThr) oIdx.push(i);
  }
  oIdx.sort((a, b) => c.den[b] - c.den[a]);
  const outliers = {
    threshold: Math.round(oThr),
    count: oIdx.length,
    sum: Math.round(oIdx.reduce((s, i) => s + c.den[i], 0)),
    truncated: oIdx.length > T.outlierListMax,
    list: oIdx.slice(0, T.outlierListMax).map(i => ({
      ma: c.ma[i],
      ngay: dateStr(info[i].dayNum),
      acc: SCOPE_ACC[L("cl", i)],
      seller: L("se", i),
      kenh: c.ch[i] ? "WH" : "MP",
      loai: L("lo", i),
      ng: L("ng", i),
      rt: L("rt", i),
      tu: L("tu", i),
      kh: L("kh", i),
      vu: L("vu", i),
      den: Math.round(c.den[i]),
    })),
  };

  const wk = WK[0];
  const flags = [];
  const addFlag = (level, cat, area, title, detail, names) =>
    flags.push({ level, cat, area, title, detail, names: names || [] });

  if (weekPct !== null) {
    const t = "Tổng đền bù " + wk.label + " " + (weekPct >= 0 ? "tăng " : "giảm ") + Math.abs(weekPct).toFixed(2) + "% so với tuần trước";
    const d = money(w0.den) + " so với " + money(weekPrev) + " (" + WK[1].label + ")";
    if (weekPct >= T.totalWowHigh) addFlag("cao", "total", "Tuần", t, d);
    else if (weekPct >= T.totalWowWarn) addFlag("tb", "total", "Tuần", t, d);
    else if (weekPct <= -T.totalWowWarn) addFlag("tot", "total", "Tuần", t, d);
  }
  if (weekAvg4 > 0 && w0.den > weekAvg4 * (1 + T.avg4Over / 100)) {
    addFlag(
      "tb",
      "avg4",
      "Tuần",
      "Tổng đền bù " + wk.label + " cao hơn trung bình 4 tuần trước " + pctTxt(weekAvgPct),
      money(w0.den) + " so với trung bình " + money(weekAvg4)
    );
  }

  if (monthPct !== null) {
    const subject = openMonth ? "Đền bù lũy kế " : "Đền bù ";
    const versus = openMonth ? " so với cùng kỳ tháng trước" : " so với " + MO[1].label;
    const t = subject + MO[0].label + " " + (monthPct >= 0 ? "tăng " : "giảm ") + Math.abs(monthPct).toFixed(2) + "%" + versus;
    const d = money(m0.den) + " so với " + money(monthPrev) + (openMonth ? " (đến ngày " + pad2(cutDay) + ")" : "");
    if (monthPct >= T.mtdMomHigh) addFlag("cao", "mtd", "Tháng", t, d);
    else if (monthPct >= T.mtdMomWarn) addFlag("tb", "mtd", "Tháng", t, d);
    else if (monthPct <= -T.mtdMomWarn) addFlag("tot", "mtd", "Tháng", t, d);
  }

  const surge = (dimId, items, total, areaName, limit, skip, vs) => {
    const minVal = Math.max(T.groupMinValue, total * T.groupMinShare);
    let used = 0;
    for (const it of items) {
      if (used >= limit) break;
      if (it.name === NO_DATA || it.name === NO_KHO) continue;
      if (it.cur < minVal) continue;
      const isNew = it.prev === 0;
      if (!isNew && it.pct < T.groupSurgePct) continue;
      if (skip && skip.has(dimId + "|" + it.name)) continue;
      used++;
      const level = isNew || it.pct >= T.groupSurgeHigh ? "cao" : "tb";
      const growth = isNew ? "mới phát sinh " + vs : "tăng " + it.pct.toFixed(2) + "% " + vs;
      addFlag(
        level,
        "surge_" + dimId,
        areaName,
        DIM_LABEL[dimId] + ' "' + it.name + '" ' + growth,
        money(it.cur) + " so với " + money(it.prev) + " (" + it.share.toFixed(1) + "% tổng)",
        [it.name]
      );
      if (skip) skip.add(dimId + "|" + it.name);
    }
  };
  const flagged = new Set();
  ["acc", "lo", "ng", "rt", "tu", "kh", "se"].forEach(id =>
    surge(id, wAll[id], w0.den, "Tuần", id === "rt" ? 2 : 3, flagged, "so với tuần trước")
  );
  const monthVs = openMonth ? "so với cùng kỳ tháng trước" : "so với tháng trước";
  ["lo", "ng", "tu", "kh", "se"].forEach(id => surge(id, mAll[id], m0.den, "Tháng", 2, flagged, monthVs));

  const topProducts = (items, total, areaName, periodLabel) => {
    const minVal = Math.max(T.topProdMinValue, total * T.topProdMinShare);
    const list = items.filter(it => it.name !== NO_DATA && it.cur >= minVal).slice(0, T.topProdCount);
    if (!list.length) return;
    const top = list[0];
    addFlag(
      top.share >= T.topProdAlertShare ? "tb" : "luu",
      "topprod",
      areaName,
      "Sản phẩm có giá trị đền bù cao trong " + periodLabel + ": " + list.map(it => it.name).join("; "),
      list.map(it => it.name + " " + money(it.cur) + " (" + it.share.toFixed(1) + "%)").join("; "),
      list.map(it => it.name)
    );
  };
  topProducts(wAll.rt, w0.den, "Tuần", wk.label);
  topProducts(mAll.rt, m0.den, "Tháng", MO[0].label);

  const ngTotal = wAll.ng.reduce((s, it) => s + it.cur, 0) || 1;
  const ngUnknown = wAll.ng.find(it => it.name === NO_DATA);
  if (ngUnknown && (ngUnknown.cur / ngTotal) * 100 >= T.unmappedShare) {
    addFlag(
      "tb",
      "unmapped",
      "Dữ liệu",
      "Nhóm ngành hàng chưa xác định chiếm " + ((ngUnknown.cur / ngTotal) * 100).toFixed(1) + "% đền bù " + wk.label,
      money(ngUnknown.cur) + " chưa có san_pham_vn_group tương ứng"
    );
  }
  ["ng", "tu", "kh", "se"].forEach(id => {
    const top = wAll[id].find(it => it.name !== NO_DATA && it.name !== NO_KHO);
    if (top && top.share >= T.concentration[id]) {
      addFlag(
        "tb",
        "conc_" + id,
        "Tuần",
        DIM_LABEL[id] + ' "' + top.name + '" chiếm ' + top.share.toFixed(1) + "% tổng đền bù " + wk.label,
        money(top.cur) + " trên tổng " + money(w0.den),
        [top.name]
      );
    }
  });

  if (outliers.count > 0) {
    addFlag(
      outliers.count >= 5 ? "tb" : "luu",
      "outlier",
      "Đơn bất thường",
      outliers.count + " đơn có giá trị đền bù vượt ngưỡng trung bình + " + T.outlierSigma + " độ lệch chuẩn trong " + wk.label,
      "Tổng " + money(outliers.sum) + "; ngưỡng " + money(outliers.threshold) + " mỗi đơn"
    );
  }

  if (c.noDate > 0 && c.noDate / (n + c.noDate) > 0.02) {
    addFlag(
      "luu",
      "nodate",
      "Dữ liệu",
      c.noDate + " dòng thiếu ngày duyệt eform nên không được tính vào báo cáo",
      "Chiếm " + ((c.noDate / (n + c.noDate)) * 100).toFixed(1) + "% tổng số dòng"
    );
  }

  flags.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const flagsOut = flags.slice(0, 30);

  const suggestions = [];
  const seen = new Set();
  const addSug = (level, cat, text) => {
    if (seen.has(cat)) return;
    seen.add(cat);
    suggestions.push({ level, text });
  };
  const namesOf = (f, k) => f.names.slice(0, k).map(s => '"' + s + '"').join(", ");
  flagsOut.forEach(f => {
    if (f.level === "tot") return;
    const lv = f.level === "cao" ? "cao" : f.level === "tb" ? "tb" : "thap";
    if (f.cat === "total" || f.cat === "avg4" || f.cat === "mtd") {
      addSug(lv, "total", "Họp rà soát nhanh nguyên nhân đền bù tăng; đối chiếu với các nhóm tăng mạnh ở phần cảnh báo để xác định điểm nghẽn và người phụ trách.");
    } else if (f.cat === "surge_lo") {
      addSug(lv, "surge_lo", "Rà soát quy trình xử lý loại yêu cầu " + namesOf(f, 2) + ": kiểm tra SLA lấy/giao và bước xác nhận trước khi phát sinh đền bù.");
    } else if (f.cat === "surge_ng") {
      addSug(lv, "surge_ng", "Làm việc với các seller lớn của nhóm ngành " + namesOf(f, 2) + " về đóng gói, khai báo giá trị và bảo hiểm; cân nhắc quy định đóng gói riêng cho nhóm này.");
    } else if (f.cat === "surge_rt") {
      addSug(lv, "surge_rt", "Sản phẩm " + namesOf(f, 2) + " tăng mạnh: kiểm tra chất lượng đóng gói, bốc xếp và vận chuyển với mặt hàng này.");
    } else if (f.cat === "surge_tu") {
      addSug(lv, "surge_tu", "Kiểm tra chất lượng vận chuyển trên tuyến " + namesOf(f, 2) + " (thời gian trung chuyển, điểm trung chuyển thường phát sinh sự cố).");
    } else if (f.cat === "surge_kh") {
      addSug(lv, "surge_kh", "Yêu cầu kho " + namesOf(f, 2) + " giải trình nguyên nhân và kế hoạch khắc phục; đối chiếu biên bản giao nhận của các đơn giá trị lớn nhất.");
    } else if (f.cat === "surge_se") {
      addSug(lv, "surge_se", "Trao đổi với seller " + namesOf(f, 2) + " về nguyên nhân phát sinh đền bù; xem xét điều kiện đóng gói và khai báo giá trị riêng.");
    } else if (f.cat === "surge_acc") {
      addSug(lv, "surge_acc", "Account " + namesOf(f, 2) + " đang tăng mạnh: làm việc riêng với đầu mối account để xác định nguyên nhân đặc thù.");
    } else if (f.cat === "topprod") {
      addSug(lv === "thap" ? "tb" : lv, "topprod", "Rà soát đóng gói, vận chuyển và điều kiện khai báo giá trị/bảo hiểm cho các sản phẩm có giá trị đền bù cao (" + namesOf(f, 3) + "); cân nhắc quy định đóng gói riêng cho nhóm hàng rủi ro.");
    } else if (f.cat.indexOf("conc_") === 0) {
      addSug("tb", "conc", "Giảm rủi ro tập trung: lập kế hoạch xử lý riêng cho các đối tượng chiếm tỷ trọng lớn (" + namesOf(f, 1) + "), tránh một điểm lỗi kéo tăng toàn bộ đền bù.");
    } else if (f.cat === "unmapped") {
      addSug("tb", "unmapped", "Bổ sung mapping nhóm ngành cho các mã sản phẩm chưa có san_pham_vn_group để phân tích không bị lệch.");
    } else if (f.cat === "outlier") {
      addSug("thap", "outlier", "Rà soát riêng từng đơn bất thường (danh sách bên dưới) trước khi chốt số liệu và KPI.");
    } else if (f.cat === "nodate") {
      addSug("thap", "nodate", "Kiểm tra các dòng thiếu ngày duyệt eform tại nguồn dữ liệu để không bỏ sót đền bù khi tổng hợp.");
    }
  });
  const sugRank = { cao: 0, tb: 1, thap: 2 };
  suggestions.sort((a, b) => sugRank[a.level] - sugRank[b.level]);
  if (!suggestions.length) {
    suggestions.push({ level: "thap", text: "Chưa có chỉ số nào vượt ngưỡng cảnh báo: duy trì theo dõi hằng tuần và rà soát lại ngưỡng khi quy mô đền bù thay đổi." });
  }

  const trendWeeks = WK.slice().reverse().map((w, idx) => {
    const k = WK.length - 1 - idx;
    return { label: w.label, den: Math.round(wt[k].den), n: wt[k].n, start: w.startStr, end: w.endStr, selected: k === 0 };
  });
  const trendMonths = MO.slice().reverse().map((m, idx) => {
    const k = MO.length - 1 - idx;
    return { label: m.label, den: Math.round(mt[k].den), n: mt[k].n, selected: k === 0 };
  });

  const weekList = [...winTotals.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 26)
    .map(([end, t]) => ({
      key: dateStr(end),
      label: dateInfo(diOfDayNum(end)).weekLabel,
      start: dateStr(end - 6),
      end: dateStr(end),
      den: Math.round(t.den),
      n: t.n,
    }));
  const monthList = [...monTotals.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 18)
    .map(([key, t]) => ({ key, label: monthLabel(key), den: Math.round(t.den), n: t.n }));

  return {
    empty: false,
    dataThrough: dateStr(aW.dayNum),
    rows: { total: n, scope: isW.reduce((s, v) => s + v, 0), noDate: c.noDate },
    periods: { weeks: weekList, months: monthList },
    selected: { week: dateStr(selEnd), month: selMonth },
    week: {
      key: dateStr(selEnd),
      label: wk.label,
      start: wk.startStr,
      end: wk.endStr,
      isLatest: selEnd === latestEnd,
      total: {
        cur: Math.round(w0.den),
        n: w0.n,
        prev: Math.round(weekPrev),
        prevLabel: WK[1].label,
        pct: weekPct,
        avg4: Math.round(weekAvg4),
        pctAvg4: weekAvgPct,
      },
      trend: trendWeeks,
      dims: wDims,
    },
    month: {
      key: selMonth,
      label: MO[0].label,
      prevLabel: MO[1].label,
      mode: openMonth ? "mtd" : "full",
      cutoffDay: openMonth ? cutDay : null,
      total: {
        cur: Math.round(m0.den),
        n: m0.n,
        prev: Math.round(monthPrev),
        pct: monthPct,
      },
      trend: trendMonths,
      dims: mDims,
    },
    outliers,
    flags: flagsOut,
    suggestions,
    thresholds: {
      totalWow: [T.totalWowWarn, T.totalWowHigh],
      avg4Over: T.avg4Over,
      groupMinValue: T.groupMinValue,
      groupSurgePct: T.groupSurgePct,
      groupSurgeHigh: T.groupSurgeHigh,
      concentration: T.concentration,
      unmappedShare: T.unmappedShare,
      mtdMom: [T.mtdMomWarn, T.mtdMomHigh],
      topProd: { count: T.topProdCount, minValue: T.topProdMinValue, alertShare: T.topProdAlertShare },
      outlierSigma: T.outlierSigma,
    },
  };
}
