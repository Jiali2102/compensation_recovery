import {
  adminConfigured,
  getAccess,
  passwordMatches,
  createAdminCookie,
  clearAdminCookie,
} from "../lib/admin.js";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readBody(req) {
  let body = "";
  await new Promise((resolve, reject) => {
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on("end", resolve);
    req.on("error", reject);
  });
  try {
    return JSON.parse(body || "{}");
  } catch (e) {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  if (!adminConfigured()) {
    console.error("admin-gate.js: thiếu cấu hình Environment Variables (RPT_ALLOW / RPT_PASS / SESSION_SECRET)");
    res.status(503).json({ error: "Lỗi cấu hình máy chủ" });
    return;
  }

  const access = getAccess(req);
  if (!access.session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method === "GET") {
    res.status(200).json({
      allowed: access.allowed,
      unlocked: access.unlocked,
      page: access.allowed ? "tong_hop.html" : null,
    });
    return;
  }

  if (req.method === "POST") {
    if (!access.allowed) {
      res.status(403).json({ error: "Chưa được cấp quyền" });
      return;
    }
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      res.status(400).json({ error: "Không đọc được dữ liệu request" });
      return;
    }
    if (body.action === "lock") {
      res.setHeader("Set-Cookie", clearAdminCookie());
      res.status(200).json({ ok: true });
      return;
    }
    if (!passwordMatches(body.password)) {
      await wait(900);
      res.status(403).json({ error: "Mật khẩu không đúng" });
      return;
    }
    res.setHeader("Set-Cookie", createAdminCookie(access.email, process.env.SESSION_SECRET));
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
