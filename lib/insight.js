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
    rows.push({
      ma_dh: ma,
      khach_hang,
      client_id: clientId,
      seller_name: String(g("seller_name") ?? "").trim() || "(Không rõ)",
      channel,
      loai_yeu_cau: loai,
      hu_hong: huHong,
      gia_tri_den_bu: num(g("gia_tri_den_bu")),
      ngay_duyet_eform: String(g("ngay_duyet_eform") ?? "").trim(),
      thoi_gian_hen_lay: String(g("thoi_gian_hen_lay") ?? "").trim(),
      thoi_gian_tao: tao,
      content: String(g("content") ?? "").trim(),
      ly_do: String(g("ly_do") ?? "").trim(),
      nguyen_nhan: String(g("nguyen_nhan") ?? "").trim(),
      seller_id: String(g("seller_id") ?? "").trim(),
      san_pham: String(g("san_pham") ?? "").trim(),
      san_pham_vn: String(g("san_pham_vn") ?? "").trim() || NO_ITEM,
      san_pham_vn_group: String(g("san_pham_vn_group") ?? "").trim() || NO_GROUP,
      kenh_wh_mp: channel ? "WH" : "MP",
      thang: tao.slice(0, 7),
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

export function buildCategoryTree(rows) {
  const groups = new Map();
  for (const r of rows) {
    let g = groups.get(r.san_pham_vn_group);
    if (!g) {
      g = { name: r.san_pham_vn_group, count: 0, value: 0, items: new Map() };
      groups.set(r.san_pham_vn_group, g);
    }
    g.count++;
    g.value += r.gia_tri_den_bu;
    let it = g.items.get(r.san_pham_vn);
    if (!it) {
      it = { name: r.san_pham_vn, count: 0, value: 0 };
      g.items.set(r.san_pham_vn, it);
    }
    it.count++;
    it.value += r.gia_tri_den_bu;
  }
  const out = [...groups.values()]
    .sort((a, b) => b.value - a.value)
    .map(g => ({
      name: g.name,
      count: g.count,
      value: g.value,
      items: [...g.items.values()].sort((a, b) => b.value - a.value),
    }));
  let minDate = null;
  let maxDate = null;
  for (const r of rows) {
    if (!minDate || r.thoi_gian_tao < minDate) minDate = r.thoi_gian_tao;
    if (!maxDate || r.thoi_gian_tao > maxDate) maxDate = r.thoi_gian_tao;
  }
  return { groups: out, minDate, maxDate };
}

export function filterInsightRows(rows, sel) {
  const { group, item, from, to } = sel || {};
  return rows.filter(r => {
    if (group && r.san_pham_vn_group !== group) return false;
    if (item && r.san_pham_vn !== item) return false;
    if (from && r.thoi_gian_tao < from) return false;
    if (to && r.thoi_gian_tao > to) return false;
    return true;
  });
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

export async function buildInsightWorkbook(allRows, sel) {
  const rows = filterInsightRows(allRows, sel);
  const wb = new ExcelJS.Workbook();
  const N = rows.length;
  const LAST = Math.max(N + 1, 2);

  const dataCols = [
    "ma_dh", "khach_hang", "client_id", "seller_name", "channel", "loai_yeu_cau", "hu_hong",
    "gia_tri_den_bu", "ngay_duyet_eform", "thoi_gian_hen_lay", "thoi_gian_tao", "content",
    "ly_do", "nguyen_nhan", "seller_id", "san_pham", "san_pham_vn", "san_pham_vn_group",
    "kenh_wh_mp", "thang", "phan_loai_den_bu",
  ];
  const colIdx = {};
  dataCols.forEach((c, i) => (colIdx[c] = i + 1));
  const L = (name, startRow = 2) => `Data!$${letter(colIdx[name])}$${startRow}:$${letter(colIdx[name])}$${LAST}`;
  const RNG_VAL = L("gia_tri_den_bu");
  const RNG_THANG = L("thang");

  const months = [...new Set(rows.map(r => r.thang))].sort();
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
  const wsData = wb.addWorksheet("Data");

  const sheetIndex = name => wb.worksheets.findIndex(w => w.name === name) + 1;

  headerRowStyled(wsData, 1, dataCols);
  rows.forEach((r, i) => {
    const row = wsData.getRow(i + 2);
    dataCols.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      const v = r[c];
      if (v === "" || v === undefined) {
        cell.value = null;
      } else {
        cell.value = v;
      }
      if (c === "gia_tri_den_bu") cell.numFmt = MONEY_FMT;
      if (c === "hu_hong" && v !== null) cell.numFmt = "0.0%";
      cell.font = { name: FONT, size: 9 };
    });
    row.commit();
  });
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
    let r = startRow + 1;
    const firstDataRow = r;
    labels.forEach(lab => {
      ws.getCell(r, 1).value = lab;
      ws.getCell(r, 1).font = { name: FONT, size: 10 };
      ws.getCell(r, 1).border = THIN_BORDER;
      months.forEach((m, j) => {
        const col = 2 + j;
        const cell = ws.getCell(r, col);
        cell.value = { formula: `SUMIFS(${RNG_VAL},${fieldRange},${sq("$A" + r)},${RNG_THANG},${letter(col)}$${startRow})` };
        cell.numFmt = MONEY_FMT;
        cell.border = THIN_BORDER;
      });
      const totCol = 2 + months.length;
      const firstMCol = letter(2);
      const lastMCol = letter(1 + months.length);
      const totCell = ws.getCell(r, totCol);
      totCell.value = { formula: `SUM(${firstMCol}${r}:${lastMCol}${r})` };
      totCell.numFmt = MONEY_FMT;
      totCell.font = { name: FONT, bold: true, size: 10 };
      totCell.border = THIN_BORDER;
      const pctCell = ws.getCell(r, totCol + 1);
      pctCell.value = { formula: `${letter(totCol)}${r}/'Tổng quan'!$B$5` };
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

  writeTitle(wsM, "Tổng đền bù theo tháng", 3);
  headerRowStyled(wsM, 3, ["Tháng", "Số đơn", "Giá trị đền bù"]);
  let rM = 4;
  const firstM = rM;
  months.forEach(m => {
    wsM.getCell(rM, 1).value = m;
    wsM.getCell(rM, 1).border = THIN_BORDER;
    const c1 = wsM.getCell(rM, 2);
    c1.value = { formula: `COUNTIF(${RNG_THANG},${sq("$A" + rM)})` };
    c1.numFmt = INT_FMT;
    c1.border = THIN_BORDER;
    const c2 = wsM.getCell(rM, 3);
    c2.value = { formula: `SUMIF(${RNG_THANG},${sq("$A" + rM)},${RNG_VAL})` };
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

  writeTitle(wsOv, "TỔNG QUAN ĐỀN BÙ" + (sel.group ? " — " + sel.group : "") + (sel.item ? " / " + sel.item : ""), 6);
  wsOv.getCell(2, 1).value =
    "Giai đoạn dữ liệu: " + (months[0] || "—") + " đến " + (months[months.length - 1] || "—") + " (theo ngày tạo đơn)";
  wsOv.getCell(2, 1).font = { name: FONT, italic: true, size: 10, color: { argb: "FF808080" } };

  const ovRows = [
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
  writeNote(
    wsOv,
    "Phạm vi: đơn SPE + SPB" +
      (sel.group ? `, nhóm hàng "${sel.group}"` : "") +
      (sel.item ? `, mặt hàng "${sel.item}"` : "") +
      (sel.from || sel.to ? `, khoảng thời gian ${sel.from || "từ đầu"} → ${sel.to || "đến nay"}` : "") +
      ". Không bao gồm phần truy thu.",
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
