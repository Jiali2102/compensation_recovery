import { createCsvRecordParser, mapHeader, DERIVED } from "./bi.js";

const SCOPE_ACC = { "18692": "SPE", "3892833": "SPB" };
const CLIENT_LABEL = {
  "18692": "SPE Express",
  "3892833": "SPE Bulky",
  "224845": "SPE Reverse",
  "2781603": "SPX Express",
  "9794": "Lazada",
  "2590595": "Tiki",
  "1367": "Tiki",
};
const NO_DATA = "(Không rõ)";
const NO_KHO = "(Chưa có kho / ticket)";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

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
  rateRed: 20,
  rateYellow: 30,
  rateDropPts: 5,
  noTicketShare: 30,
  clientMinValue: 50e6,
  khoRateLow: 20,
  khoMinValue: 20e6,
  mtdMomWarn: 20,
  mtdMomHigh: 40,
  runRateOver: 20,
  outlierSigma: 3,
};

const DIM_LABEL = {
  acc: "Account",
  lo: "Loại yêu cầu",
  ng: "Nhóm ngành hàng",
  rt: "Root cause (sản phẩm)",
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
  const dayNum = Math.floor(ms / 86400000);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  const thu = new Date(ms);
  thu.setUTCDate(thu.getUTCDate() - dow + 3);
  const ft = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  const fdn = (ft.getUTCDay() + 6) % 7;
  ft.setUTCDate(ft.getUTCDate() - fdn + 3);
  const week = 1 + Math.round((thu - ft) / (7 * 86400000));
  const isoYear = thu.getUTCFullYear();
  v = {
    y,
    mo,
    d,
    dayNum,
    dow,
    month: y + "-" + pad2(mo),
    weekKey: isoYear + "-W" + pad2(week),
    weekLabel: "W" + pad2(week) + "-" + isoYear,
  };
  infoCache.set(di, v);
  return v;
}

function diOfDayNum(dn) {
  const dt = new Date(dn * 86400000);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

function dateStr(dn) {
  return new Date(dn * 86400000).toISOString().slice(0, 10);
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
  c.thu.push(num(g("so_tien_da_truy_thu")));
  c.cl.push(c.dicts.cl.id(String(g("nhom_kh") ?? "").trim()));
  c.lo.push(c.dicts.lo.id(clean(g("loai_yeu_cau"))));
  c.ng.push(c.dicts.ng.id(clean(g("san_pham_vn_group"))));
  c.rt.push(c.dicts.rt.id(spVn || sp || NO_DATA));
  c.tu.push(c.dicts.tu.id(clean(g("tuyen"))));
  c.kh.push(c.dicts.kh.id(kho || NO_KHO));
  c.vu.push(c.dicts.vu.id(vung || NO_DATA));
  c.se.push(c.dicts.se.id(clean(g("seller_name"))));
  c.ch.push(String(g("channel") ?? "").toLowerCase().includes("wh") ? 1 : 0);
  c.tk.push(kho ? 1 : 0);
  c.n++;
}

export async function loadColumns(upstream) {
  const c = {
    n: 0,
    noDate: 0,
    ma: [],
    d: [],
    den: [],
    thu: [],
    cl: [],
    lo: [],
    ng: [],
    rt: [],
    tu: [],
    kh: [],
    vu: [],
    se: [],
    ch: [],
    tk: [],
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

function rateOf(thu, den) {
  return den > 0 ? (thu / den) * 100 : 0;
}

const LEVEL_ORDER = { cao: 0, tb: 1, luu: 2, tot: 3 };

export function buildSummary(c) {
  const n = c.n;
  if (!n) return { empty: true };
  const T = THRESHOLDS;
  const info = new Array(n);
  const isW = new Uint8Array(n);
  let latestAll = 0;
  let latestW = 0;
  for (let i = 0; i < n; i++) {
    const di = c.d[i];
    info[i] = dateInfo(di);
    if (di > latestAll) latestAll = di;
    if (SCOPE_ACC[c.dicts.cl.list[c.cl[i]]]) {
      isW[i] = 1;
      if (di > latestW) latestW = di;
    }
  }
  if (!latestW) return { empty: true };

  const aW = dateInfo(latestW);
  const aA = dateInfo(latestAll);
  const cutDow = aW.dow;
  const daysCovered = cutDow + 1;
  const partial = cutDow < 6;
  const weekStartDay = aW.dayNum - aW.dow;

  const WK = [];
  for (let k = 0; k < 8; k++) {
    const sd = weekStartDay - 7 * k;
    const inf = dateInfo(diOfDayNum(sd));
    WK.push({ key: inf.weekKey, label: inf.weekLabel, start: dateStr(sd), end: dateStr(sd + 6) });
  }
  const wkIndex = new Map(WK.map((w, i) => [w.key, i]));
  const MO = monthWindow(aW, 6);
  const moIndex = new Map(MO.map((m, i) => [m.key, i]));
  const MT = monthWindow(aA, 6);
  const mtIndex = new Map(MT.map((m, i) => [m.key, i]));
  const cutDay = aW.d;
  const cutDayT = aA.d;

  const kw = new Int8Array(n).fill(-1);
  const km = new Int8Array(n).fill(-1);
  const kt = new Int8Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const inf = info[i];
    if (isW[i]) {
      const a = wkIndex.get(inf.weekKey);
      if (a !== undefined) kw[i] = a;
      const b = moIndex.get(inf.month);
      if (b !== undefined) km[i] = b;
    }
    const t = mtIndex.get(inf.month);
    if (t !== undefined) kt[i] = t;
  }

  const wt = WK.map(() => ({ den: 0, thu: 0, n: 0, denLike: 0, thuLike: 0 }));
  const mt = MO.map(() => ({ den: 0, thu: 0, n: 0, denLike: 0, thuLike: 0 }));
  for (let i = 0; i < n; i++) {
    if (!isW[i]) continue;
    const k = kw[i];
    if (k >= 0) {
      const t = wt[k];
      t.den += c.den[i];
      t.thu += c.thu[i];
      t.n++;
      if (info[i].dow <= cutDow) {
        t.denLike += c.den[i];
        t.thuLike += c.thu[i];
      }
    }
    const m = km[i];
    if (m >= 0) {
      const t = mt[m];
      t.den += c.den[i];
      t.thu += c.thu[i];
      t.n++;
      if (info[i].d <= cutDay) {
        t.denLike += c.den[i];
        t.thuLike += c.thu[i];
      }
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
  const TOPN = { acc: 5, lo: 8, ng: 8, rt: 8, tu: 8, kh: 8, se: 10, vu: 8, ch: 5 };

  const wMaps = aggDims(
    c,
    dims,
    i => isW[i] === 1,
    i => {
      const k = kw[i];
      if (k < 0 || k > 4) return -1;
      return k === 0 || info[i].dow <= cutDow ? k : -1;
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
      if (k === 1 && info[i].d <= cutDay) return 1;
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
  const weekPrevLike = wt[1].denLike;
  const weekAvg4 = (wt[1].denLike + wt[2].denLike + wt[3].denLike + wt[4].denLike) / 4;
  const weekPct = pctOf(w0.den, weekPrevLike);
  const weekAvgPct = pctOf(w0.den, weekAvg4);
  const m0 = mt[0];
  const monthPct = pctOf(m0.den, mt[1].denLike);
  const dim = new Date(Date.UTC(MO[0].y, MO[0].m, 0)).getUTCDate();
  const runRate = cutDay >= 5 ? (m0.den / cutDay) * dim : null;
  const runRatePct = runRate !== null ? pctOf(runRate, mt[1].den) : null;

  const tt = MT.map(() => ({ den: 0, thu: 0, n: 0, noN: 0, noDen: 0, denLike: 0, thuLike: 0 }));
  const clientMap = new Map();
  const khoMap = new Map();
  const vungMap = new Map();
  for (let i = 0; i < n; i++) {
    const k = kt[i];
    if (k < 0) continue;
    const t = tt[k];
    const den = c.den[i];
    const thu = c.thu[i];
    t.den += den;
    t.thu += thu;
    t.n++;
    if (!c.tk[i]) {
      t.noN++;
      t.noDen += den;
    }
    const like = k === 0 || info[i].d <= cutDayT;
    if (like) {
      t.denLike += den;
      t.thuLike += thu;
    }
    if (k <= 1) {
      const raw = L("cl", i);
      const label = CLIENT_LABEL[raw] || "KH " + raw;
      let e = clientMap.get(label);
      if (!e) {
        e = { den: 0, thu: 0, n: 0, noN: 0, prevLike: 0 };
        clientMap.set(label, e);
      }
      if (k === 0) {
        e.den += den;
        e.thu += thu;
        e.n++;
        if (!c.tk[i]) e.noN++;
      } else if (like) {
        e.prevLike += den;
      }
    }
    if (k === 0 && c.tk[i]) {
      const kn = L("kh", i);
      let e = khoMap.get(kn);
      if (!e) {
        e = { den: 0, thu: 0, n: 0 };
        khoMap.set(kn, e);
      }
      e.den += den;
      e.thu += thu;
      e.n++;
      const vn = L("vu", i);
      let v = vungMap.get(vn);
      if (!v) {
        v = { den: 0, thu: 0, n: 0 };
        vungMap.set(vn, v);
      }
      v.den += den;
      v.thu += thu;
      v.n++;
    }
  }
  const t0 = tt[0];
  const tRate = rateOf(t0.thu, t0.den);
  const tPrevRateLike = rateOf(tt[1].thuLike, tt[1].denLike);
  const tNoShare = t0.n ? (t0.noN / t0.n) * 100 : 0;
  const clients = [...clientMap.entries()]
    .map(([name, e]) => ({
      name,
      den: Math.round(e.den),
      thu: Math.round(e.thu),
      n: e.n,
      rate: rateOf(e.thu, e.den),
      noTicketN: e.noN,
      noTicketShare: e.n ? (e.noN / e.n) * 100 : 0,
      prevLikeDen: Math.round(e.prevLike),
      pct: pctOf(e.den, e.prevLike),
    }))
    .filter(x => x.den > 0 || x.n > 0)
    .sort((a, b) => b.den - a.den);
  const rateList = map =>
    [...map.entries()]
      .map(([name, e]) => ({ name, den: Math.round(e.den), thu: Math.round(e.thu), n: e.n, rate: rateOf(e.thu, e.den) }))
      .filter(x => x.den >= T.khoMinValue)
      .sort((a, b) => a.rate - b.rate)
      .slice(0, 8);
  const lowKho = rateList(khoMap);
  const lowVung = rateList(vungMap);

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
    list: oIdx.slice(0, 10).map(i => ({
      ma: c.ma[i],
      acc: SCOPE_ACC[L("cl", i)],
      seller: L("se", i),
      den: Math.round(c.den[i]),
      loai: L("lo", i),
      ngay: dateStr(info[i].dayNum),
    })),
  };

  const wk = WK[0];
  const flags = [];
  const addFlag = (level, cat, area, title, detail, names) =>
    flags.push({ level, cat, area, title, detail, names: names || [] });
  const likeNote = partial ? "cùng " + daysCovered + " ngày đầu tuần" : "cả tuần";

  if (weekPct !== null) {
    const t = "Tổng đền bù " + wk.label + " " + (weekPct >= 0 ? "tăng " : "giảm ") + Math.abs(weekPct).toFixed(2) + "% so với tuần trước (" + likeNote + ")";
    const d = money(w0.den) + " so với " + money(weekPrevLike);
    if (weekPct >= T.totalWowHigh) addFlag("cao", "total", "Tuần", t, d);
    else if (weekPct >= T.totalWowWarn) addFlag("tb", "total", "Tuần", t, d);
    else if (weekPct <= -T.totalWowWarn) addFlag("tot", "total", "Tuần", t, d);
  }
  if (weekAvg4 > 0 && w0.den > weekAvg4 * (1 + T.avg4Over / 100)) {
    addFlag(
      "tb",
      "avg4",
      "Tuần",
      "Tổng đền bù " + wk.label + " cao hơn trung bình 4 tuần gần nhất " + pctTxt(weekAvgPct),
      money(w0.den) + " so với trung bình " + money(weekAvg4) + " (" + likeNote + ")"
    );
  }
  if (partial) {
    addFlag(
      "luu",
      "partial",
      "Dữ liệu",
      "Tuần " + wk.label + " mới có dữ liệu đến " + dateStr(aW.dayNum) + " (" + daysCovered + "/7 ngày)",
      "Các so sánh theo tuần đã dùng cùng số ngày của tuần trước để công bằng."
    );
  }

  if (monthPct !== null) {
    const t = "Đền bù lũy kế " + MO[0].label + " " + (monthPct >= 0 ? "tăng " : "giảm ") + Math.abs(monthPct).toFixed(2) + "% so với cùng kỳ tháng trước";
    const d = money(m0.den) + " so với " + money(mt[1].denLike) + " (đến ngày " + pad2(cutDay) + ")";
    if (monthPct >= T.mtdMomHigh) addFlag("cao", "mtd", "Tháng", t, d);
    else if (monthPct >= T.mtdMomWarn) addFlag("tb", "mtd", "Tháng", t, d);
    else if (monthPct <= -T.mtdMomWarn) addFlag("tot", "mtd", "Tháng", t, d);
  }
  if (runRatePct !== null && runRatePct >= T.runRateOver) {
    addFlag(
      "tb",
      "runrate",
      "Tháng",
      "Dự phóng cả " + MO[0].label + " cao hơn tổng tháng trước " + pctTxt(runRatePct),
      "Ước tính tuyến tính " + money(runRate) + " so với " + money(mt[1].den) + " của " + MO[1].label
    );
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
  ["acc", "lo", "ng", "rt", "tu", "kh", "se"].forEach(id => surge(id, wAll[id], w0.den, "Tuần", id === "rt" ? 2 : 3, flagged, "so với tuần trước"));
  ["lo", "ng", "tu", "kh", "se"].forEach(id => surge(id, mAll[id], m0.den, "Tháng", 2, flagged, "so với cùng kỳ tháng trước"));

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

  if (t0.den > 0) {
    const rt = "Tỷ lệ thu hồi " + MT[0].label + " đang ở mức " + tRate.toFixed(2) + "%";
    const rd = money(t0.thu) + " đã truy thu trên " + money(t0.den) + " đền bù (tất cả khách hàng)";
    if (tRate < T.rateRed) addFlag("cao", "rate", "Truy thu", rt, rd);
    else if (tRate < T.rateYellow) addFlag("tb", "rate", "Truy thu", rt, rd);
    if (tt[1].denLike > 0) {
      const diff = tRate - tPrevRateLike;
      if (diff <= -T.rateDropPts) {
        addFlag(
          "tb",
          "ratedrop",
          "Truy thu",
          "Tỷ lệ thu hồi giảm " + Math.abs(diff).toFixed(2) + " điểm % so với cùng kỳ tháng trước",
          tRate.toFixed(2) + "% so với " + tPrevRateLike.toFixed(2) + "%"
        );
      } else if (diff >= T.rateDropPts) {
        addFlag(
          "tot",
          "rateup",
          "Truy thu",
          "Tỷ lệ thu hồi tăng " + diff.toFixed(2) + " điểm % so với cùng kỳ tháng trước",
          tRate.toFixed(2) + "% so với " + tPrevRateLike.toFixed(2) + "%"
        );
      }
    }
    if (tNoShare >= T.noTicketShare) {
      addFlag(
        "tb",
        "noticket",
        "Truy thu",
        "Đơn chưa có ticket truy thu chiếm " + tNoShare.toFixed(1) + "% số đơn " + MT[0].label,
        t0.noN + " đơn, giá trị đền bù " + money(t0.noDen)
      );
    }
    const badClients = clients.filter(x => x.den >= T.clientMinValue && x.rate < T.rateRed);
    if (badClients.length) {
      addFlag(
        "tb",
        "clientrate",
        "Truy thu",
        badClients.length + " khách hàng có tỷ lệ thu hồi dưới " + T.rateRed + "% (đền bù từ " + money(T.clientMinValue) + ")",
        badClients.slice(0, 4).map(x => x.name + " " + x.rate.toFixed(1) + "%").join("; "),
        badClients.slice(0, 4).map(x => x.name)
      );
    }
    const badKho = lowKho.filter(x => x.rate < T.khoRateLow);
    if (badKho.length) {
      const top = badKho.slice().sort((a, b) => b.den - a.den).slice(0, 3);
      addFlag(
        "tb",
        "khorate",
        "Truy thu",
        badKho.length + " kho có tỷ lệ thu hồi dưới " + T.khoRateLow + "% (đền bù từ " + money(T.khoMinValue) + ")",
        top.map(x => x.name + " " + x.rate.toFixed(1) + "% / " + money(x.den)).join("; "),
        top.map(x => x.name)
      );
    }
  }

  if (outliers.count > 0) {
    addFlag(
      outliers.count >= 5 ? "tb" : "luu",
      "outlier",
      "Đơn bất thường",
      outliers.count + " đơn có giá trị đền bù vượt ngưỡng trung bình + " + T.outlierSigma + " độ lệch chuẩn trong " + wk.label,
      "Tổng " + money(outliers.sum) + "; ngưỡng " + money(outliers.threshold) + " mỗi đơn"
    );
  }

  const noDateRate = c.noDate;
  if (noDateRate > 0 && noDateRate / (n + noDateRate) > 0.02) {
    addFlag(
      "luu",
      "nodate",
      "Dữ liệu",
      noDateRate + " dòng thiếu ngày duyệt eform nên không được tính vào báo cáo",
      "Chiếm " + ((noDateRate / (n + noDateRate)) * 100).toFixed(1) + "% tổng số dòng"
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
    } else if (f.cat === "runrate") {
      addSug(lv, "runrate", "Dự phóng cuối tháng cao hơn tháng trước: đặt kế hoạch kiểm soát đền bù cho phần còn lại của tháng (ưu tiên các nhóm đang tăng).");
    } else if (f.cat === "surge_lo") {
      addSug(lv, "surge_lo", "Rà soát quy trình xử lý loại yêu cầu " + namesOf(f, 2) + ": kiểm tra SLA lấy/giao và bước xác nhận trước khi phát sinh đền bù.");
    } else if (f.cat === "surge_ng") {
      addSug(lv, "surge_ng", "Làm việc với các seller lớn của nhóm ngành " + namesOf(f, 2) + " về đóng gói, khai báo giá trị và bảo hiểm; cân nhắc quy định đóng gói riêng cho nhóm này.");
    } else if (f.cat === "surge_rt") {
      addSug(lv, "surge_rt", "Root cause " + namesOf(f, 2) + ": kiểm tra chất lượng đóng gói và quy trình bốc xếp, vận chuyển với mặt hàng này.");
    } else if (f.cat === "surge_tu") {
      addSug(lv, "surge_tu", "Kiểm tra chất lượng vận chuyển trên tuyến " + namesOf(f, 2) + " (thời gian trung chuyển, điểm trung chuyển thường phát sinh sự cố).");
    } else if (f.cat === "surge_kh") {
      addSug(lv, "surge_kh", "Yêu cầu kho " + namesOf(f, 2) + " giải trình nguyên nhân và kế hoạch khắc phục; đối chiếu biên bản giao nhận của các đơn giá trị lớn nhất.");
    } else if (f.cat === "surge_se") {
      addSug(lv, "surge_se", "Trao đổi với seller " + namesOf(f, 2) + " về nguyên nhân phát sinh đền bù; xem xét điều kiện đóng gói và khai báo giá trị riêng.");
    } else if (f.cat === "surge_acc") {
      addSug(lv, "surge_acc", "Account " + namesOf(f, 2) + " đang tăng mạnh: làm việc riêng với đầu mối account để xác định nguyên nhân đặc thù.");
    } else if (f.cat.indexOf("conc_") === 0) {
      addSug("tb", "conc", "Giảm rủi ro tập trung: lập kế hoạch xử lý riêng cho các đối tượng chiếm tỷ trọng lớn (" + namesOf(f, 1) + "), tránh một điểm lỗi kéo tăng toàn bộ đền bù.");
    } else if (f.cat === "unmapped") {
      addSug("tb", "unmapped", "Bổ sung mapping nhóm ngành cho các mã sản phẩm chưa có san_pham_vn_group để phân tích không bị lệch.");
    } else if (f.cat === "rate" || f.cat === "ratedrop") {
      addSug(lv, "rate", "Đẩy nhanh tạo và theo dõi ticket truy thu; ưu tiên kho có tỷ lệ thấp nhất và các đơn giá trị lớn; đặt mục tiêu tỷ lệ thu hồi tối thiểu " + T.rateYellow + "% cho tháng.");
    } else if (f.cat === "noticket") {
      addSug("tb", "noticket", "Lập danh sách đơn chưa có ticket truy thu (ưu tiên giá trị cao) và giao đầu mối từng vùng xử lý trong tuần.");
    } else if (f.cat === "clientrate") {
      addSug("tb", "clientrate", "Làm việc riêng về truy thu với khách hàng có tỷ lệ thấp (" + namesOf(f, 3) + "): rà soát điều kiện truy thu và tiến độ xác nhận.");
    } else if (f.cat === "khorate") {
      addSug("tb", "khorate", "Nhắc kho có tỷ lệ truy thu thấp (" + namesOf(f, 3) + ") hoàn tất hồ sơ và xác nhận truy thu theo từng đơn.");
    } else if (f.cat === "outlier") {
      addSug("thap", "outlier", "Rà soát riêng từng đơn bất thường (danh sách bên dưới) trước khi chốt số liệu và KPI.");
    } else if (f.cat === "partial") {
      addSug("thap", "partial", "Đánh giá lại tuần " + wk.label + " sau khi dữ liệu duyệt eform đủ 7 ngày; không kết luận xu hướng chỉ dựa trên tuần chưa hoàn chỉnh.");
    } else if (f.cat === "nodate") {
      addSug("thap", "nodate", "Kiểm tra các dòng thiếu ngày duyệt eform tại nguồn dữ liệu để không bỏ sót đền bù khi tổng hợp.");
    }
  });
  suggestions.sort((a, b) => ({ cao: 0, tb: 1, thap: 2 }[a.level] - { cao: 0, tb: 1, thap: 2 }[b.level]));
  if (!suggestions.length) {
    suggestions.push({ level: "thap", text: "Chưa có chỉ số nào vượt ngưỡng cảnh báo: duy trì theo dõi hằng tuần và rà soát lại ngưỡng khi quy mô đền bù thay đổi." });
  }

  const trendWeeks = WK.slice().reverse().map((w, idx, arr) => {
    const k = WK.length - 1 - idx;
    const t = wt[k];
    return { label: w.label, den: Math.round(t.den), thu: Math.round(t.thu), n: t.n, partial: k === 0 && partial };
  });
  const trendMonths = MO.slice().reverse().map((m, idx) => {
    const k = MO.length - 1 - idx;
    const t = mt[k];
    return { label: m.label, den: Math.round(t.den), thu: Math.round(t.thu), n: t.n, partial: k === 0 };
  });
  const trendTruyThu = MT.slice().reverse().map((m, idx) => {
    const k = MT.length - 1 - idx;
    const t = tt[k];
    return {
      label: m.label,
      den: Math.round(t.den),
      thu: Math.round(t.thu),
      rate: rateOf(t.thu, t.den),
      noTicketShare: t.n ? (t.noN / t.n) * 100 : 0,
    };
  });

  return {
    empty: false,
    dataThrough: dateStr(aW.dayNum),
    dataThroughAll: dateStr(aA.dayNum),
    rows: { total: n, scope: isW.reduce((s, v) => s + v, 0), noDate: c.noDate },
    week: {
      key: wk.key,
      label: wk.label,
      start: wk.start,
      end: wk.end,
      cutoff: dateStr(aW.dayNum),
      daysCovered,
      partial,
      total: {
        cur: Math.round(w0.den),
        thu: Math.round(w0.thu),
        n: w0.n,
        rate: rateOf(w0.thu, w0.den),
        prev: Math.round(weekPrevLike),
        prevFull: Math.round(wt[1].den),
        pct: weekPct,
        avg4: Math.round(weekAvg4),
        pctAvg4: weekAvgPct,
      },
      trend: trendWeeks,
      dims: wDims,
    },
    month: {
      key: MO[0].key,
      label: MO[0].label,
      prevLabel: MO[1].label,
      cutoffDay: cutDay,
      daysInMonth: dim,
      total: {
        cur: Math.round(m0.den),
        thu: Math.round(m0.thu),
        n: m0.n,
        rate: rateOf(m0.thu, m0.den),
        prev: Math.round(mt[1].denLike),
        prevFull: Math.round(mt[1].den),
        pct: monthPct,
        runRate: runRate === null ? null : Math.round(runRate),
        runRatePct,
      },
      trend: trendMonths,
      dims: mDims,
    },
    truyThu: {
      key: MT[0].key,
      label: MT[0].label,
      cutoffDay: cutDayT,
      total: {
        den: Math.round(t0.den),
        thu: Math.round(t0.thu),
        n: t0.n,
        rate: tRate,
        prevRateLike: tPrevRateLike,
        noTicketN: t0.noN,
        noTicketShare: tNoShare,
        noTicketDen: Math.round(t0.noDen),
        prevLikeDen: Math.round(tt[1].denLike),
        pct: pctOf(t0.den, tt[1].denLike),
      },
      clients,
      trend: trendTruyThu,
      lowKho,
      lowVung,
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
      rate: [T.rateRed, T.rateYellow],
      rateDropPts: T.rateDropPts,
      noTicketShare: T.noTicketShare,
      khoRateLow: T.khoRateLow,
      khoMinValue: T.khoMinValue,
      mtdMom: [T.mtdMomWarn, T.mtdMomHigh],
      runRateOver: T.runRateOver,
      outlierSigma: T.outlierSigma,
    },
  };
}
