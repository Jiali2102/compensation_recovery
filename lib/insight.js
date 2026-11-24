import ExcelJS from "exceljs";
import { createCsvRecordParser, mapHeader } from "./bi.js";
import { injectCharts } from "./xlsx-chart.js";

const SCOPE_ACC = { "18692": "SPE", "3892833": "SPB" };
const NO_GROUP = "(Chưa phân nhóm)";
const NO_ITEM = "(Chưa xác định mặt hàng)";

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

function parseDate10(v) {
  const s = String(v ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

const CONTENT_RULES = [
  { label: "Sữa đặc", kws: ["sữa đặc"] },
  { label: "Sữa hạt", kws: ["sữa hạt"] },
  { label: "Sữa bột", kws: ["sữa bột"] },
  { label: "Sữa dinh dưỡng", kws: ["sữa dinh dưỡng", "sữa uống dinh dưỡng"] },
  { label: "Sữa tươi", kws: ["sữa tươi"] },
  { label: "Sữa chua", kws: ["sữa chua", "yaourt", "yogurt"] },
  { label: "Phô mai", kws: ["phô mai", "pho mai"] },
  { label: "Bơ / Whipping", kws: ["bơ lạt", "bơ sữa", "whipping"] },
  { label: "Xe đạp", kws: ["xe đạp"] },
  { label: "Xe máy điện / Xe đạp điện", kws: ["xe máy điện", "xe đạp điện", "xe điện"] },
  { label: "Xe ô tô điện trẻ em", kws: ["xe ô tô điện", "xe chòi chân", "ô tô điện cho bé", "xe điện cho bé"] },
  { label: "Flycam / Drone", kws: ["flycam", "drone"] },
  { label: "Mũ bảo hiểm", kws: ["mũ bảo hiểm", "nón bảo hiểm"] },
  { label: "Tivi", kws: ["tivi", " tv "] },
  { label: "Tủ lạnh", kws: ["tủ lạnh"] },
  { label: "Máy giặt", kws: ["máy giặt"] },
  { label: "Máy sấy", kws: ["máy sấy"] },
  { label: "Điều hòa / Máy lạnh", kws: ["điều hòa", "máy lạnh"] },
  { label: "Quạt điện", kws: ["quạt điện", "quạt hơi nước", "quạt đứng", "quạt cây", "quạt trần", "quạt tích điện", "quạt sạc", "quạt"] },
  { label: "Quạt sưởi / Đèn sưởi", kws: ["quạt sưởi", "đèn sưởi", "máy sưởi"] },
  { label: "Nồi cơm điện", kws: ["nồi cơm"] },
  { label: "Nồi chiên không dầu", kws: ["nồi chiên không dầu", "nồi chiên"] },
  { label: "Lò vi sóng", kws: ["lò vi sóng"] },
  { label: "Lò nướng", kws: ["lò nướng"] },
  { label: "Bếp điện / Bếp từ / Bếp gas", kws: ["bếp từ", "bếp hồng ngoại", "bếp gas", "bếp điện", "bếp nướng"] },
  { label: "Máy hút bụi", kws: ["máy hút bụi", "robot hút bụi"] },
  { label: "Máy lọc nước", kws: ["máy lọc nước"] },
  { label: "Máy lọc không khí", kws: ["lọc không khí"] },
  { label: "Máy xay / Máy ép", kws: ["máy xay", "máy ép"] },
  { label: "Bình đun / Ấm siêu tốc", kws: ["bình đun siêu tốc", "ấm siêu tốc", "bình thủy điện", "ấm đun nước"] },
  { label: "Máy rửa chén / Máy rửa bát", kws: ["máy rửa chén", "máy rửa bát"] },
  { label: "Máy hút ẩm", kws: ["máy hút ẩm"] },
  { label: "Máy rửa xe", kws: ["máy rửa xe"] },
  { label: "Trạm sạc / Máy phát điện", kws: ["trạm sạc", "máy phát điện"] },
  { label: "Điện thoại", kws: ["điện thoại", "smartphone"] },
  { label: "Máy tính bảng", kws: ["ipad", "máy tính bảng", "tablet"] },
  { label: "Laptop", kws: ["laptop", "macbook"] },
  { label: "Màn hình máy tính", kws: ["màn hình máy tính", "monitor", "màn hình"] },
  { label: "Bàn phím / Chuột", kws: ["bàn phím", "chuột máy tính", "chuột không dây"] },
  { label: "Tai nghe", kws: ["tai nghe"] },
  { label: "Loa / Amply / Dàn âm thanh", kws: ["loa bluetooth", "loa kéo", "loa di động", "amply", "dàn karaoke", "vang số", " loa "] },
  { label: "Sạc / Pin dự phòng", kws: ["sạc dự phòng", "cục sạc", "củ sạc", "cáp sạc"] },
  { label: "Camera / Máy ảnh", kws: ["camera", "máy ảnh"] },
  { label: "Linh kiện máy tính", kws: ["cpu intel", "cpu amd", "mainboard", " cpu ", "ổ cứng", "ram ddr", "nguồn máy tính", "card màn hình"] },
  { label: "Đèn trang trí / Đèn LED", kws: ["đèn led", "đèn trang trí", "đèn ngủ", "đèn bàn", "đèn năng lượng mặt trời"] },
  { label: "Bàn", kws: ["bàn ăn", "bàn trà", "bàn làm việc", "bàn học", "bàn cafe", "bàn café", " bàn "] },
  { label: "Ghế", kws: ["ghế sofa", "ghế văn phòng", "ghế gaming", "ghế ăn dặm", " ghế "] },
  { label: "Giường / Nệm", kws: ["giường ngủ", " giường ", "nệm", "chăn ga gối"] },
  { label: "Tủ / Kệ đồ", kws: ["tủ quần áo", "tủ giày", "tủ trưng bày", "tủ nhựa", "kệ để đồ", "kệ sách", " tủ ", " kệ "] },
  { label: "Sofa", kws: ["sofa"] },
  { label: "Rèm cửa / Thảm", kws: ["rèm cửa", "thảm trải sàn", "thảm lau chân"] },
  { label: "Gương", kws: [" gương "] },
  { label: "Quần áo", kws: ["quần áo bảo hộ", "quần jean", "quần short", "quần kaki", "quần âu", "áo thun", "áo sơ mi", "áo khoác", "áo polo", "váy đầm", "đầm"] },
  { label: "Giày dép", kws: ["giày thể thao", "giày sneaker", "dép lê", "dép quai hậu", " giày ", " dép "] },
  { label: "Balo / Túi xách", kws: ["balo", "túi xách", "túi đeo chéo"] },
  { label: "Vali / Túi du lịch", kws: ["vali kéo", " vali "] },
  { label: "Mũ / Nón / Kính", kws: ["mũ lưỡi trai", "nón bucket", "kính mát", "kính râm"] },
  { label: "Đồng hồ", kws: ["đồng hồ đeo tay", "đồng hồ treo tường"] },
  { label: "Mỹ phẩm / Chăm sóc da", kws: ["kem chống nắng", "kem dưỡng da", "sữa rửa mặt", "mặt nạ dưỡng da", "serum", "sữa tắm", "dầu gội", "nước hoa"] },
  { label: "Thuốc / Sản phẩm sức khỏe", kws: ["kem bôi", "thuốc bôi", "viên uống", "thực phẩm chức năng"] },
  { label: "Khử trùng / Dụng cụ y tế", kws: ["cloramin", "dung dịch khử trùng", "gel siêu âm", "máy đo huyết áp", "nhiệt kế"] },
  { label: "Khăn giấy / Khăn ướt", kws: ["khăn giấy", "khăn ướt", "khăn vải khô"] },
  { label: "Nước rửa tay / Nước giặt / Tẩy rửa", kws: ["nước rửa tay", "nước giặt", "nước lau sàn", "nước rửa chén", "túi giặt"] },
  { label: "Găng tay", kws: ["găng tay"] },
  { label: "Ghế ngồi ô tô cho bé", kws: ["ghế ngồi ôtô", "ghế ngồi ô tô", "ghế an toàn cho bé"] },
  { label: "Xe đẩy / Xe tập đi / Nôi", kws: ["xe đẩy em bé", "xe tập đi", " nôi "] },
  { label: "Bình sữa / Đồ dùng cho bé", kws: ["bình sữa", "tã bỉm", "núm ti"] },
  { label: "Đồ chơi trẻ em", kws: ["đồ chơi"] },
  { label: "Mô hình trưng bày", kws: ["mô hình"] },
  { label: "Dụng cụ nhà bếp", kws: ["chảo chống dính", " chảo ", "bộ dao", " dao ", "thớt", "bát đĩa", "hộp đựng thực phẩm", "bình giữ nhiệt", "bình đựng nước"] },
  { label: "Thiết bị vệ sinh (vòi sen/bình nóng lạnh)", kws: ["vòi sen", "bình nóng lạnh"] },
  { label: "Máy / Đệm massage", kws: ["máy massage", "đệm massage", "ghế massage"] },
  { label: "Đồ thờ cúng", kws: ["đồ thờ", "bàn thờ", "đèn thờ"] },
  { label: "Vật liệu xây dựng / Kim khí", kws: ["sắt hộp", "thép hộp", "sắt vuông", "tôn lợp", "ống nước", "dây điện"] },
  { label: "Thiết bị điện (ổ cắm/aptomat)", kws: ["ổ cắm điện", "aptomat", "cầu dao", "ổ cắm thanh ray"] },
  { label: "Dụng cụ cầm tay / Máy khoan", kws: ["máy khoan", "máy mài", "máy cắt", "bộ dụng cụ sửa chữa", "cờ lê", "tua vít"] },
  { label: "Sơn (nước/lót/phủ)", kws: ["sơn lót", "sơn phủ", "sơn nước", "sơn tường"] },
  { label: "Phụ tùng xe máy / ô tô", kws: ["phụ tùng xe máy", "ốp yếm", "lốp xe", "vỏ xe máy", "ắc quy"] },
  { label: "Dầu nhớt xe", kws: ["dầu nhớt"] },
  { label: "Dụng cụ câu cá", kws: ["cần câu", "mồi câu", "cước câu"] },
  { label: "Vợt thể thao", kws: ["vợt tennis", "vợt pickleball", "vợt cầu lông", "vợt bóng bàn", " vợt "] },
  { label: "Thể thao / Gym", kws: ["tạ tay", "dụng cụ tập gym", "máy chạy bộ", "xe đạp tập"] },
  { label: "Thú cưng", kws: ["thức ăn cho chó", "thức ăn cho mèo", "cát vệ sinh", "cát đậu nành", "lồng chó mèo", "chuồng chó", "lược chải lông"] },
  { label: "Văn phòng phẩm", kws: ["bút bi", "bút chì", "vở học sinh", "giấy in"] },
  { label: "Hoa / Cây cảnh", kws: ["cây giả", "hoa giả", "chậu cây"] },
  { label: "Phân bón / Nông nghiệp", kws: ["phân bón"] },
  { label: "Gạo / Ngũ cốc", kws: ["gạo thơm", "gạo st", "gạo dẻo", " gạo "] },
  { label: "Trà / Cà phê / Đồ uống", kws: ["trà xanh", "cà phê", "siro"] },
];

function classifyContent(text) {
  const low = " " + String(text || "").toLowerCase() + " ";
  for (const rule of CONTENT_RULES) {
    if (rule.kws.some(k => low.includes(k))) return rule.label;
  }
  return "(Chưa nhận diện)";
}

function bucketHuHong(loaiYeuCau, huHong) {
  if (loaiYeuCau !== "Hàng hư hỏng" || huHong === null || huHong === undefined) {
    return "Đền theo hợp đồng";
  }
  const v = Number(huHong);
  if (!Number.isFinite(v)) return "Đền theo hợp đồng";
  if (v < 0.32) return "<32%";
  if (v < 0.55) return "32-55%";
  return ">=55%";
}

export async function loadInsightRows(upstream) {
  const rows = [];
  let pos = null;
  const parser = createCsvRecordParser(rec => {
    if (!pos) {
      pos = buildPos(rec);
      return;
    }
    const g = name => (pos[name] === undefined ? "" : rec[pos[name]]);
    const ma = String(g("ma_dh") ?? "").trim();
    if (!ma) return;
    const clientId = String(g("nhom_kh") ?? "").trim();
    const khach_hang = SCOPE_ACC[clientId];
    if (!khach_hang) return;
    const tao = parseDate10(g("thoi_gian_tao"));
    if (!tao) return;
    const loai = String(g("loai_yeu_cau") ?? "").trim() || "(Không rõ)";
    const huHongRaw = g("hu_hong");
    const huHongNum = huHongRaw === "" || huHongRaw === undefined || huHongRaw === null ? null : Number(huHongRaw);
    const huHong = Number.isFinite(huHongNum) ? huHongNum : null;
    const channel = String(g("channel") ?? "").trim();
    const ngayDuyetRaw = String(g("ngay_duyet_eform") ?? "").trim();
    const henLayRaw = String(g("thoi_gian_hen_lay") ?? "").trim();
    const dateEform = parseDate10(ngayDuyetRaw);
    const dateHenLay = parseDate10(henLayRaw);
    const contentRaw = String(g("content") ?? "").trim();
    rows.push({
      ma_dh: ma,
      khach_hang,
      client_id: clientId,
      seller_name: String(g("seller_name") ?? "").trim() || "(Không rõ)",
      channel,
      loai_yeu_cau: loai,
      hu_hong: huHong,
      gia_tri_den_bu: num(g("gia_tri_den_bu")),
      ngay_duyet_eform: ngayDuyetRaw,
      thoi_gian_hen_lay: henLayRaw,
      thoi_gian_tao: tao,
      content: contentRaw,
      content_group: classifyContent(contentRaw),
      ly_do: String(g("ly_do") ?? "").trim(),
      nguyen_nhan: String(g("nguyen_nhan") ?? "").trim(),
      seller_id: String(g("seller_id") ?? "").trim(),
      san_pham: String(g("san_pham") ?? "").trim() || "(Không rõ)",
      san_pham_vn: String(g("san_pham_vn") ?? "").trim() || NO_ITEM,
      san_pham_vn_group: String(g("san_pham_vn_group") ?? "").trim() || NO_GROUP,
      kenh_wh_mp: channel ? "WH" : "MP",
      date_tao: tao,
      date_hen_lay: dateHenLay,
      date_eform: dateEform,
      thang_tao: tao.slice(0, 7),
      thang_hen_lay: dateHenLay ? dateHenLay.slice(0, 7) : null,
      thang_eform: dateEform ? dateEform.slice(0, 7) : null,
      phan_loai_den_bu: bucketHuHong(loai, huHong),
    });
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
  return rows;
}

function bumpMap(map, key, value) {
  let e = map.get(key);
  if (!e) {
    e = { name: key, count: 0, value: 0 };
    map.set(key, e);
  }
  e.count++;
  e.value += value;
  return e;
}

function sortedList(map) {
  return [...map.values()].sort((a, b) => b.value - a.value);
}

const DATE_FIELD_MAP = { tao: "date_tao", hen_lay: "date_hen_lay", eform: "date_eform" };
const MONTH_FIELD_MAP = { tao: "thang_tao", hen_lay: "thang_hen_lay", eform: "thang_eform" };

export function resolveDateField(key) {
  return DATE_FIELD_MAP[key] || DATE_FIELD_MAP.tao;
}
export function resolveMonthField(key) {
  return MONTH_FIELD_MAP[key] || MONTH_FIELD_MAP.tao;
}

export function filterInsightRows(rows, sel) {
  const { groups, items, sanPhams, sellers, khachHangs, loaiYeuCau, from, to, dateField } = sel || {};
  const dKey = resolveDateField(dateField);
  const groupSet = groups && groups.length ? new Set(groups) : null;
  const itemSet = items && items.length ? new Set(items) : null;
  const spSet = sanPhams && sanPhams.length ? new Set(sanPhams) : null;
  const sellerSet = sellers && sellers.length ? new Set(sellers) : null;
  const khSet = khachHangs && khachHangs.length ? new Set(khachHangs) : null;
  const lycSet = loaiYeuCau && loaiYeuCau.length ? new Set(loaiYeuCau) : null;
  return rows.filter(r => {
    if (groupSet && !groupSet.has(r.san_pham_vn_group)) return false;
    if (itemSet && !itemSet.has(r.san_pham_vn)) return false;
    if (spSet && !spSet.has(r.san_pham)) return false;
    if (sellerSet && !sellerSet.has(r.seller_name)) return false;
    if (khSet && !khSet.has(r.khach_hang)) return false;
    if (lycSet && !lycSet.has(r.loai_yeu_cau)) return false;
    const d = r[dKey];
    if (dateField && dateField !== "tao" && !d) return false;
    if (from && (!d || d < from)) return false;
    if (to && (!d || d > to)) return false;
    return true;
  });
}

const FACET_DIMENSIONS = [
  { out: "khachHangs", field: "khach_hang", selKey: "khachHangs" },
  { out: "loaiYeuCau", field: "loai_yeu_cau", selKey: "loaiYeuCau" },
  { out: "sellers", field: "seller_name", selKey: "sellers" },
  { out: "groups", field: "san_pham_vn_group", selKey: "groups" },
  { out: "items", field: "san_pham_vn", selKey: "items" },
  { out: "sanPhams", field: "san_pham", selKey: "sanPhams" },
];

export function buildFacets(rows, sel) {
  sel = sel || {};
  const out = {};
  for (const dim of FACET_DIMENSIONS) {
    const selWithoutSelf = { ...sel };
    delete selWithoutSelf[dim.selKey];
    const filtered = filterInsightRows(rows, selWithoutSelf);
    const map = new Map();
    for (const r of filtered) bumpMap(map, r[dim.field], r.gia_tri_den_bu);
    out[dim.out] = sortedList(map);
  }
  let minDate = null;
  let maxDate = null;
  for (const r of rows) {
    if (!minDate || r.thoi_gian_tao < minDate) minDate = r.thoi_gian_tao;
    if (!maxDate || r.thoi_gian_tao > maxDate) maxDate = r.thoi_gian_tao;
  }
  out.minDate = minDate;
  out.maxDate = maxDate;
  return out;
}

function rankBy(rows, field, n) {
  const map = new Map();
  rows.forEach(r => bumpMap(map, r[field], r.gia_tri_den_bu));
  const list = sortedList(map);
  return n ? list.slice(0, n) : list;
}

function buildContentSamples(rows, limit) {
  const seen = new Map();
  rows.forEach(r => {
    if (!r.content) return;
    const e = seen.get(r.content) || { content: r.content, group: r.content_group, count: 0, value: 0 };
    e.count++;
    e.value += r.gia_tri_den_bu;
    seen.set(r.content, e);
  });
  const all = [...seen.values()];
  const unmatched = all.filter(x => x.group === "(Chưa nhận diện)").sort((a, b) => b.value - a.value);
  const matched = all.filter(x => x.group !== "(Chưa nhận diện)").sort((a, b) => b.value - a.value);
  const nUnmatched = Math.min(unmatched.length, Math.ceil(limit * 0.75));
  const nMatched = Math.min(matched.length, limit - nUnmatched);
  return unmatched.slice(0, nUnmatched).concat(matched.slice(0, nMatched));
}

export function buildPreview(rows, sel) {
  sel = sel || {};
  const monthField = resolveMonthField(sel.dateField);
  const filtered = filterInsightRows(rows, sel);
  const totalCount = filtered.length;
  const totalValue = filtered.reduce((s, r) => s + r.gia_tri_den_bu, 0);
  const sellerSet = new Set(filtered.map(r => r.seller_name));
  const monthMap = new Map();
  filtered.forEach(r => {
    const m = r[monthField];
    if (!m) return;
    monthMap.set(m, (monthMap.get(m) || 0) + r.gia_tri_den_bu);
  });
  const trend = [...monthMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, value]) => ({ month, value }));
  return {
    kpi: {
      count: totalCount,
      value: totalValue,
      avg: totalCount ? totalValue / totalCount : 0,
      sellers: sellerSet.size,
    },
    trend,
    rankings: {
      groups: rankBy(filtered, "san_pham_vn_group", 5),
      sellers: rankBy(filtered, "seller_name", 5),
      loaiYeuCau: rankBy(filtered, "loai_yeu_cau", 5),
      items: rankBy(filtered, "san_pham_vn", 5),
      sanPhams: rankBy(filtered, "san_pham", 5),
      channels: rankBy(filtered, "kenh_wh_mp", 5),
      contentGroups: rankBy(filtered, "content_group", 8),
    },
    contentSamples: buildContentSamples(filtered, 30),
  };
}

const FONT = "Arial";
const NAVY_ARGB = "FF1F3864";
const TOTAL_FILL = "FFE8EDF5";
const BORDER = { style: "thin", color: { argb: "FFBFBFBF" } };
const THIN_BORDER = { top: BORDER, left: BORDER, right: BORDER, bottom: BORDER };
const MONEY_FMT = '#,##0" đ"';
const PCT_FMT = "0.0%";
const INT_FMT = "#,##0";

function letter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function headerRowStyled(ws, rowIdx, labels) {
  const row = ws.getRow(rowIdx);
  labels.forEach((text, i) => {
    const cell = row.getCell(i + 1);
    cell.value = text;
    cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_ARGB } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = THIN_BORDER;
  });
  row.commit();
}

function writeTitle(ws, text, span) {
  ws.mergeCells(1, 1, 1, span);
  const cell = ws.getCell(1, 1);
  cell.value = text;
  cell.font = { name: FONT, bold: true, size: 14, color: { argb: NAVY_ARGB } };
}

function writeNote(ws, text, rowIdx, span) {
  ws.mergeCells(rowIdx, 1, rowIdx, span);
  const cell = ws.getCell(rowIdx, 1);
  cell.value = text;
  cell.font = { name: FONT, italic: true, size: 10, color: { argb: "FF808080" } };
  cell.alignment = { wrapText: true, vertical: "top" };
}

function sq(ref) {
  return `"="&${ref}`;
}

function fmtIntVi(n) {
  return Math.round(n).toLocaleString("vi-VN");
}

const DATE_FIELD_LABEL = { tao: "ngày tạo đơn", hen_lay: "ngày hẹn lấy", eform: "ngày duyệt eform" };

const LARGE_ROW_CAP = 20000;

export async function buildInsightWorkbook(allRows, sel) {
  sel = sel || {};
  const monthField = resolveMonthField(sel.dateField);
  const rows = filterInsightRows(allRows, sel).map(r => ({ ...r, thang: r[monthField] }));
  const wb = new ExcelJS.Workbook();
  const N = rows.length;
  const isLarge = N > LARGE_ROW_CAP;
  const dataRows = isLarge ? [...rows].sort((a, b) => b.gia_tri_den_bu - a.gia_tri_den_bu).slice(0, LARGE_ROW_CAP) : rows;
  const totalValueAll = rows.reduce((s, r) => s + r.gia_tri_den_bu, 0);
  const LAST = Math.max(dataRows.length + 1, 2);

  const dataCols = [
    "ma_dh", "khach_hang", "client_id", "seller_name", "channel", "loai_yeu_cau", "hu_hong",
    "gia_tri_den_bu", "ngay_duyet_eform", "thoi_gian_hen_lay", "thoi_gian_tao", "content",
    "content_group", "ly_do", "nguyen_nhan", "seller_id", "san_pham", "san_pham_vn", "san_pham_vn_group",
    "kenh_wh_mp", "thang", "phan_loai_den_bu",
  ];
  const colIdx = {};
  dataCols.forEach((c, i) => (colIdx[c] = i + 1));
  const L = (name, startRow = 2) => `Data!$${letter(colIdx[name])}$${startRow}:$${letter(colIdx[name])}$${LAST}`;
  const RNG_VAL = L("gia_tri_den_bu");
  const RNG_THANG = L("thang");

  const months = [...new Set(rows.map(r => r.thang).filter(Boolean))].sort();
  const charts = [];

  const wsOv = wb.addWorksheet("Tổng quan");
  const wsM = wb.addWorksheet("Theo tháng");
  const wsLoai = wb.addWorksheet("Theo loại đền");
  const wsKenh = wb.addWorksheet("Theo kênh WH-MP");
  const wsHH = wb.addWorksheet("Theo phân loại HH");
  const wsNhom = wb.addWorksheet("Theo nhóm hàng");
  const wsMatHang = wb.addWorksheet("Theo mặt hàng");
  const wsSeller = wb.addWorksheet("Theo seller");
  const wsNguon = wb.addWorksheet("Theo nguồn");
  const wsContent = wb.addWorksheet("Theo content (nhóm suy ra)");
  const wsData = wb.addWorksheet("Data");

  const sheetIndex = name => wb.worksheets.findIndex(w => w.name === name) + 1;

  headerRowStyled(wsData, 1, dataCols);
  dataCols.forEach((c, i) => {
    const col = wsData.getColumn(i + 1);
    col.font = { name: FONT, size: 9 };
    if (c === "gia_tri_den_bu") col.numFmt = MONEY_FMT;
    if (c === "hu_hong") col.numFmt = "0.0%";
  });
  const dataArray = dataRows.map(r => dataCols.map(c => (r[c] === "" || r[c] === undefined ? null : r[c])));
  wsData.addRows(dataArray, "i");
  wsData.views = [{ state: "frozen", ySplit: 1 }];
  wsData.autoFilter = { from: { row: 1, column: 1 }, to: { row: LAST, column: dataCols.length } };
  dataCols.forEach((c, i) => {
    wsData.getColumn(i + 1).width =
      c === "content" || c === "ly_do" ? 28 : c === "seller_name" || c === "san_pham_vn_group" ? 24 : 14;
  });

  function buildCrosstab(ws, title, field, labels, note, opts) {
    const span = 3 + months.length + 1;
    writeTitle(ws, title, span);
    const startRow = 3;
    const headers = ["Hạng mục", ...months, "Tổng", "% tổng"];
    headerRowStyled(ws, startRow, headers);
    const fieldRange = L(field);
    let staticByLabel = null;
    if (isLarge) {
      staticByLabel = new Map();
      rows.forEach(rw => {
        if (!rw.thang) return;
        let mm = staticByLabel.get(rw[field]);
        if (!mm) {
          mm = new Map();
          staticByLabel.set(rw[field], mm);
        }
        mm.set(rw.thang, (mm.get(rw.thang) || 0) + rw.gia_tri_den_bu);
      });
    }
    let r = startRow + 1;
    const firstDataRow = r;
    labels.forEach(lab => {
      ws.getCell(r, 1).value = lab;
      ws.getCell(r, 1).font = { name: FONT, size: 10 };
      ws.getCell(r, 1).border = THIN_BORDER;
      let rowTotal = 0;
      months.forEach((m, j) => {
        const col = 2 + j;
        const cell = ws.getCell(r, col);
        if (isLarge) {
          const v = (staticByLabel.get(lab) && staticByLabel.get(lab).get(m)) || 0;
          cell.value = v;
          rowTotal += v;
        } else {
          cell.value = { formula: `SUMIFS(${RNG_VAL},${fieldRange},${sq("$A" + r)},${RNG_THANG},${letter(col)}$${startRow})` };
        }
        cell.numFmt = MONEY_FMT;
        cell.border = THIN_BORDER;
      });
      const totCol = 2 + months.length;
      const firstMCol = letter(2);
      const lastMCol = letter(1 + months.length);
      const totCell = ws.getCell(r, totCol);
      totCell.value = isLarge ? rowTotal : { formula: `SUM(${firstMCol}${r}:${lastMCol}${r})` };
      totCell.numFmt = MONEY_FMT;
      totCell.font = { name: FONT, bold: true, size: 10 };
      totCell.border = THIN_BORDER;
      const pctCell = ws.getCell(r, totCol + 1);
      pctCell.value = isLarge ? (totalValueAll ? rowTotal / totalValueAll : 0) : { formula: `${letter(totCol)}${r}/'Tổng quan'!$B$5` };
      pctCell.numFmt = PCT_FMT;
      pctCell.border = THIN_BORDER;
      r++;
    });
    const lastDataRow = r - 1;
    ws.getCell(r, 1).value = "Tổng";
    ws.getCell(r, 1).font = { name: FONT, bold: true, size: 10 };
    ws.getCell(r, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    ws.getCell(r, 1).border = THIN_BORDER;
    for (let c = 2; c <= 2 + months.length + 1; c++) {
      const cl = letter(c);
      const cell = ws.getCell(r, c);
      cell.value = { formula: `SUM(${cl}${firstDataRow}:${cl}${lastDataRow})` };
      cell.font = { name: FONT, bold: true, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
      cell.border = THIN_BORDER;
      cell.numFmt = c <= 1 + months.length + 1 ? MONEY_FMT : PCT_FMT;
    }
    if (note) writeNote(ws, note, r + 2, headers.length);
    ws.getColumn(1).width = (opts && opts.labelWidth) || 30;
    for (let j = 0; j < months.length; j++) ws.getColumn(2 + j).width = 13;
    ws.getColumn(2 + months.length).width = 16;
    ws.getColumn(3 + months.length).width = 10;

    if (!opts || opts.chart !== false) {
      const totColLetter = letter(2 + months.length);
      charts.push({
        sheetName: ws.name,
        type: "bar",
        title,
        catRef: `'${ws.name}'!$A$${firstDataRow}:$A$${lastDataRow}`,
        valRef: `'${ws.name}'!$${totColLetter}$${firstDataRow}:$${totColLetter}$${lastDataRow}`,
        anchor: { fromCol: 3 + months.length + 1, fromRow: startRow - 1, toCol: 3 + months.length + 9, toRow: startRow + 16 },
      });
    }
  }

  function topLabels(field, n) {
    if (!rows.length) return [];
    const totals = new Map();
    rows.forEach(r => totals.set(r[field], (totals.get(r[field]) || 0) + r.gia_tri_den_bu));
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    return n ? sorted.slice(0, n) : sorted;
  }

  const labelsLoai = topLabels("loai_yeu_cau");
  const labelsKenh = topLabels("kenh_wh_mp");
  const labelsPhanLoai = topLabels("phan_loai_den_bu");
  const labelsNhom = topLabels("san_pham_vn_group");
  const labelsMatHang = topLabels("san_pham_vn");
  const labelsSeller = topLabels("seller_name", 20);
  const totalSellerCount = new Set(rows.map(r => r.seller_name)).size;
  const labelsNguon = topLabels("khach_hang");
  const labelsContent = topLabels("content_group");

  buildCrosstab(wsLoai, "Đền bù theo loại yêu cầu — theo tháng", "loai_yeu_cau", labelsLoai);
  buildCrosstab(wsKenh, "Đền bù theo kênh WH / MP — theo tháng", "kenh_wh_mp", labelsKenh, null, { labelWidth: 14 });
  buildCrosstab(
    wsHH,
    "Phân loại đền bù theo mức hư hỏng — theo tháng",
    "phan_loai_den_bu",
    labelsPhanLoai,
    'Áp dụng cho đơn "Hàng hư hỏng": <32%, 32-55%, >=55% theo cột hu_hong. Các loại yêu cầu khác (không có hu_hong) được gộp vào "Đền theo hợp đồng".',
    { labelWidth: 20 }
  );
  buildCrosstab(wsNhom, "Đền bù theo nhóm hàng — theo tháng", "san_pham_vn_group", labelsNhom, null, { labelWidth: 36 });
  buildCrosstab(
    wsMatHang,
    "Đền bù theo mặt hàng (toàn bộ " + labelsMatHang.length + " mặt hàng) — theo tháng",
    "san_pham_vn",
    labelsMatHang,
    null,
    { labelWidth: 30, chart: false }
  );
  buildCrosstab(
    wsSeller,
    "Đền bù theo seller (Top 20 theo giá trị) — theo tháng",
    "seller_name",
    labelsSeller,
    labelsSeller.length < totalSellerCount
      ? `Top 20 trong tổng ${totalSellerCount} seller phát sinh đền bù trong phạm vi đã chọn.`
      : null,
    { labelWidth: 30 }
  );
  buildCrosstab(wsNguon, "Đền bù theo nguồn (SPB/SPE) — theo tháng", "khach_hang", labelsNguon, null, { labelWidth: 14 });
  buildCrosstab(
    wsContent,
    "Đền bù theo nhóm suy ra từ content — theo tháng",
    "content_group",
    labelsContent,
    "Nhóm được suy ra tự động từ từ khóa trong nội dung đơn hàng (cột content), để đối chiếu chéo với san_pham_vn — không phải dữ liệu gốc từ hệ thống, có thể còn sai sót hoặc chưa nhận diện được hết.",
    { labelWidth: 26 }
  );

  writeTitle(wsM, "Tổng đền bù theo tháng", 3);
  headerRowStyled(wsM, 3, ["Tháng", "Số đơn", "Giá trị đền bù"]);
  let rM = 4;
  const firstM = rM;
  const monthStatic = isLarge ? new Map() : null;
  if (isLarge) {
    rows.forEach(rw => {
      if (!rw.thang) return;
      const e = monthStatic.get(rw.thang) || { count: 0, value: 0 };
      e.count++;
      e.value += rw.gia_tri_den_bu;
      monthStatic.set(rw.thang, e);
    });
  }
  months.forEach(m => {
    wsM.getCell(rM, 1).value = m;
    wsM.getCell(rM, 1).border = THIN_BORDER;
    const c1 = wsM.getCell(rM, 2);
    c1.value = isLarge ? (monthStatic.get(m) ? monthStatic.get(m).count : 0) : { formula: `COUNTIF(${RNG_THANG},${sq("$A" + rM)})` };
    c1.numFmt = INT_FMT;
    c1.border = THIN_BORDER;
    const c2 = wsM.getCell(rM, 3);
    c2.value = isLarge
      ? (monthStatic.get(m) ? monthStatic.get(m).value : 0)
      : { formula: `SUMIF(${RNG_THANG},${sq("$A" + rM)},${RNG_VAL})` };
    c2.numFmt = MONEY_FMT;
    c2.border = THIN_BORDER;
    rM++;
  });
  const lastM = rM - 1;
  wsM.getCell(rM, 1).value = "Tổng";
  wsM.getCell(rM, 2).value = { formula: `SUM(B${firstM}:B${lastM})` };
  wsM.getCell(rM, 2).numFmt = INT_FMT;
  wsM.getCell(rM, 3).value = { formula: `SUM(C${firstM}:C${lastM})` };
  wsM.getCell(rM, 3).numFmt = MONEY_FMT;
  for (let c = 1; c <= 3; c++) {
    wsM.getCell(rM, c).font = { bold: true, name: FONT };
    wsM.getCell(rM, c).border = THIN_BORDER;
  }
  wsM.getColumn(1).width = 12;
  wsM.getColumn(2).width = 12;
  wsM.getColumn(3).width = 18;
  if (months.length) {
    charts.push({
      sheetName: "Theo tháng",
      type: "line",
      title: "Giá trị đền bù theo tháng",
      catRef: `'Theo tháng'!$A$${firstM}:$A$${lastM}`,
      valRef: `'Theo tháng'!$C$${firstM}:$C$${lastM}`,
      anchor: { fromCol: 5, fromRow: 2, toCol: 13, toRow: 18 },
    });
  }

  const groupsSel = sel.groups && sel.groups.length ? sel.groups : [];
  const itemsSel = sel.items && sel.items.length ? sel.items : [];
  const titleSuffix = groupsSel.length ? " — " + groupsSel.join(", ") : "";
  writeTitle(wsOv, "TỔNG QUAN ĐỀN BÙ" + titleSuffix + (itemsSel.length ? " / " + itemsSel.join(", ") : ""), 6);
  const dateFieldLabel = DATE_FIELD_LABEL[sel.dateField] || DATE_FIELD_LABEL.tao;
  wsOv.getCell(2, 1).value =
    "Giai đoạn dữ liệu: " + (months[0] || "—") + " đến " + (months[months.length - 1] || "—") + " (theo " + dateFieldLabel + ")";
  wsOv.getCell(2, 1).font = { name: FONT, italic: true, size: 10, color: { argb: "FF808080" } };

  const ovRows = isLarge
    ? (() => {
        const sellerCount = new Set(rows.map(r => r.seller_name)).size;
        const mpValue = rows.filter(r => r.kenh_wh_mp === "MP").reduce((s, r) => s + r.gia_tri_den_bu, 0);
        return [
          ["Tổng số đơn đền bù", N, INT_FMT],
          ["Tổng giá trị đền bù", totalValueAll, MONEY_FMT],
          ["Giá trị đền bù trung bình / đơn", N ? totalValueAll / N : 0, MONEY_FMT],
          ["Số seller phát sinh đền bù", sellerCount, INT_FMT],
          ["Tỷ trọng kênh MP (không qua kho) / tổng giá trị", totalValueAll ? mpValue / totalValueAll : 0, PCT_FMT],
        ];
      })()
    : [
        ["Tổng số đơn đền bù", { formula: `COUNTA(Data!$A$2:$A$${LAST})` }, INT_FMT],
        ["Tổng giá trị đền bù", { formula: `SUM(${RNG_VAL})` }, MONEY_FMT],
        ["Giá trị đền bù trung bình / đơn", { formula: "B5/B4" }, MONEY_FMT],
        [
          "Số seller phát sinh đền bù",
          {
            formula: `SUMPRODUCT((COUNTIF(${L("seller_name")},${L("seller_name")})>0)/COUNTIF(${L("seller_name")},${L(
              "seller_name"
            )}))`,
          },
          INT_FMT,
        ],
        ["Tỷ trọng kênh MP (không qua kho) / tổng giá trị", { formula: `SUMIF(${L("kenh_wh_mp")},${sq('"MP"')},${RNG_VAL})/B5` }, PCT_FMT],
      ];
  let rOv = 4;
  ovRows.forEach(([label, formula, fmt]) => {
    wsOv.getCell(rOv, 1).value = label;
    wsOv.getCell(rOv, 1).font = { name: FONT, size: 11 };
    const c = wsOv.getCell(rOv, 2);
    c.value = formula;
    c.numFmt = fmt;
    c.font = { name: FONT, bold: true, size: 11 };
    rOv++;
  });
  const sanPhamsSel = sel.sanPhams && sel.sanPhams.length ? sel.sanPhams : [];
  const sellersSel = sel.sellers && sel.sellers.length ? sel.sellers : [];
  const khSel = sel.khachHangs && sel.khachHangs.length ? sel.khachHangs : [];
  const lycSel = sel.loaiYeuCau && sel.loaiYeuCau.length ? sel.loaiYeuCau : [];
  writeNote(
    wsOv,
    "Phạm vi: đơn SPE + SPB" +
      (khSel.length ? `, khách hàng: ${khSel.join(", ")}` : "") +
      (lycSel.length ? `, loại yêu cầu: ${lycSel.join(", ")}` : "") +
      (sellersSel.length ? `, seller: ${sellersSel.join(", ")}` : "") +
      (groupsSel.length ? `, nhóm hàng: ${groupsSel.join(", ")}` : "") +
      (itemsSel.length ? `, sản phẩm (VN): ${itemsSel.join(", ")}` : "") +
      (sanPhamsSel.length ? `, sản phẩm (EN): ${sanPhamsSel.join(", ")}` : "") +
      (sel.from || sel.to ? `, mốc ${dateFieldLabel} trong khoảng ${sel.from || "từ đầu"} → ${sel.to || "đến nay"}` : "") +
      ". Không bao gồm phần truy thu." +
      (isLarge
        ? ` Phạm vi lọc có ${fmtIntVi(N)} đơn — do khối lượng lớn, sheet Data chỉ liệt kê ${fmtIntVi(
            LARGE_ROW_CAP
          )} đơn giá trị cao nhất (không phải toàn bộ). Mọi số liệu tổng hợp ở Tổng quan và các sheet "Theo..." vẫn tính trên ĐẦY ĐỦ ${fmtIntVi(
            N
          )} đơn, không bị cắt bớt — chỉ riêng danh sách chi tiết ở sheet Data là rút gọn. Thu hẹp bộ lọc/khoảng ngày nếu cần xem đầy đủ từng dòng.`
        : ""),
    rOv + 1,
    6
  );
  wsOv.getColumn(1).width = 46;
  wsOv.getColumn(2).width = 20;

  charts.forEach(ch => {
    ch.sheetIndex = sheetIndex(ch.sheetName);
  });

  const buffer = await wb.xlsx.writeBuffer();
  const final = await injectCharts(buffer, charts);
  return final;
}
