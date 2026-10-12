(function () {
  const DB_NAME = "cr_data";
  const STORE = "kv";
  const KEY = "main_v1";
  const TTL_NO_VERSION_MS = 3 * 3600 * 1000;
  const MAX_AGE_MS = 24 * 3600 * 1000;
  const DATE_ONLY = ["ngay_duyet_eform"];
  const DATE_TIME = ["thoi_gian_tao", "thoi_gian_hen_lay"];

  function hostWin() {
    try {
      if (window.top && window.top.location.origin === window.location.origin) return window.top;
    } catch (e) {}
    return window;
  }

  function idb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("NO_IDB"));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet() {
    try {
      const db = await idb();
      return await new Promise(resolve => {
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).get(KEY);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }

  async function idbPut(val) {
    try {
      const db = await idb();
      await new Promise(resolve => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(val, KEY);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (e) {}
  }

  async function idbClear() {
    try {
      const db = await idb();
      await new Promise(resolve => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(KEY);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (e) {}
  }

  async function packText(text) {
    if (typeof CompressionStream === "undefined") return { gz: false, data: text };
    const blob = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
    return { gz: true, data: blob };
  }

  async function unpackText(entry) {
    if (!entry.gz) return entry.data;
    return await new Response(entry.data.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  }

  function normRow(r) {
    DATE_ONLY.forEach(k => {
      if (r[k] !== null && r[k] !== undefined && r[k] !== "") r[k] = String(r[k]).slice(0, 10);
    });
    DATE_TIME.forEach(k => {
      if (r[k] !== null && r[k] !== undefined && r[k] !== "") r[k] = String(r[k]).replace("T", " ").slice(0, 19);
    });
    return r;
  }

  function parseCsv(text) {
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
    return parsed.data.filter(r => r.ma_dh).map(normRow);
  }

  async function doLoad() {
    const metaRes = await fetch("/api/data?meta=1", { credentials: "include", cache: "no-store" });
    if (metaRes.status === 401) throw new Error("__UNAUTHORIZED__");
    if (!metaRes.ok) throw new Error("Không kiểm tra được phiên bản dữ liệu (HTTP " + metaRes.status + ")");
    const meta = await metaRes.json();

    const cached = await idbGet();
    if (cached) {
      const age = Date.now() - cached.savedAt;
      const fresh = meta.version
        ? cached.version === meta.version && age < MAX_AGE_MS
        : age < TTL_NO_VERSION_MS;
      if (fresh) {
        const text = await unpackText(cached);
        return { rows: parseCsv(text), fetchedAt: cached.fetchedAt, source: "cache" };
      }
    }

    const r = await fetch("/api/data", { credentials: "include", cache: "no-store" });
    if (r.status === 401) throw new Error("__UNAUTHORIZED__");
    if (!r.ok) throw new Error("Không tải được dữ liệu (HTTP " + r.status + ")");
    const fetchedAt = r.headers.get("X-Data-Fetched-At") || "";
    const text = await r.text();
    const rows = parseCsv(text);
    if (rows.length) {
      const packed = await packText(text);
      await idbPut({ ...packed, version: meta.version || null, fetchedAt, savedAt: Date.now() });
    }
    return { rows, fetchedAt, source: "network" };
  }

  function load() {
    const h = hostWin();
    if (!h.__crDataPromise) {
      h.__crDataPromise = doLoad().catch(err => {
        h.__crDataPromise = null;
        throw err;
      });
    }
    return h.__crDataPromise;
  }

  async function clear() {
    const h = hostWin();
    h.__crDataPromise = null;
    await idbClear();
  }

  async function refresh() {
    await clear();
    hostWin().location.reload();
  }

  function statusLabel(res) {
    const when = res.fetchedAt ? "Dữ liệu lấy lúc " + res.fetchedAt : "Dữ liệu cập nhật";
    return res.source === "cache" ? when + " (bộ nhớ đệm)" : when;
  }

  function makeRefreshButton(doc) {
    const b = doc.createElement("button");
    b.type = "button";
    b.textContent = "↻ Làm mới";
    b.title = "Xoá bộ nhớ đệm và tải lại dữ liệu mới nhất từ nguồn";
    b.style.cssText = "font-family:inherit;background:transparent;border:1px solid rgba(255,255,255,0.4);color:#fff;font-size:12px;padding:5px 12px;border-radius:14px;cursor:pointer;margin-left:10px;";
    b.addEventListener("click", () => {
      b.disabled = true;
      b.textContent = "Đang làm mới...";
      refresh();
    });
    return b;
  }

  window.CRData = { load, clear, refresh, statusLabel, makeRefreshButton };
})();
