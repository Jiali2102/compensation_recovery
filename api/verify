// Vercel Serverless Function — nhận Google ID token từ nút "Sign in with Google" ở client,
// xác minh chữ ký + audience qua endpoint tokeninfo của Google, rồi kiểm tra email có đúng
// domain @ghn.vn không. Nếu hợp lệ, cấp 1 session cookie (HttpOnly) để các request sau
// (bao gồm /api/data) biết người dùng đã đăng nhập hợp lệ.
import { createSessionCookie, ALLOWED_DOMAIN } from "../lib/session.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const CLIENT_ID = process.env.GOOGLE_SSO_CLIENT_ID;
  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!CLIENT_ID || !SESSION_SECRET) {
    res.status(500).json({ error: "Thiếu GOOGLE_SSO_CLIENT_ID hoặc SESSION_SECRET trong Environment Variables" });
    return;
  }

  let body = "";
  try {
    await new Promise((resolve, reject) => {
      req.on("data", chunk => (body += chunk));
      req.on("end", resolve);
      req.on("error", reject);
    });
  } catch (e) {
    res.status(400).json({ error: "Không đọc được dữ liệu request" });
    return;
  }

  let credential;
  try {
    credential = JSON.parse(body).credential;
  } catch (e) {
    res.status(400).json({ error: "Payload không hợp lệ" });
    return;
  }
  if (!credential) {
    res.status(400).json({ error: "Thiếu credential" });
    return;
  }

  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!r.ok) {
      res.status(401).json({ error: "Token không hợp lệ hoặc đã hết hạn" });
      return;
    }
    const payload = await r.json();

    if (payload.aud !== CLIENT_ID) {
      res.status(401).json({ error: "Token không khớp ứng dụng" });
      return;
    }

    const email = (payload.email || "").toLowerCase();
    const emailVerified = payload.email_verified === "true" || payload.email_verified === true;
    const isGhn = emailVerified && email.endsWith(ALLOWED_DOMAIN);

    if (!isGhn) {
      res.status(403).json({ error: `Chỉ tài khoản ${ALLOWED_DOMAIN} mới được phép truy cập` });
      return;
    }

    res.setHeader("Set-Cookie", createSessionCookie(email, SESSION_SECRET));
    res.status(200).json({ ok: true, email });
  } catch (err) {
    res.status(500).json({ error: "Lỗi xác thực: " + err.message });
  }
}
