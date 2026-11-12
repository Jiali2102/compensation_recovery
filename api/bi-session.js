import { callViaQueue } from "../lib/sheet-queue.js";

export default async function handler(req, res) {
  const key = req.headers["x-api-key"];
  if (!process.env.BI_AUTH_KEY || key !== process.env.BI_AUTH_KEY) {
    res.status(401).json({ ok: false, message: "Unauthorized" });
    return;
  }
  try {
    let data = await callViaQueue("cr_session", { t: "cr_session" });
    let tries = 0;
    while (data && data.pending === true && tries < 20) {
      await new Promise(r => setTimeout(r, 2500));
      data = await callViaQueue("cr_session", { t: "cr_session" }, data.pj);
      tries++;
    }
    if (!data || data.ok === false) {
      res.status(502).json({ ok: false, message: (data && data.message) || "Không lấy được phiên BI." });
      return;
    }
    res.status(200).json({ ok: true, mbSession: data.mbSession });
  } catch (err) {
    res.status(502).json({ ok: false, message: "Không kết nối được hệ thống." });
  }
}

export const config = { maxDuration: 60 };
