// Module dùng chung: ký & xác minh session cookie sau khi đăng nhập Google SSO thành công.
// Không dùng thư viện JWT ngoài — chỉ dùng crypto có sẵn của Node để giữ mọi thứ gọn nhẹ.
import crypto from "crypto";

export function base64url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64").toString("utf8");
}

export function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

const SESSION_COOKIE_NAME = "ghn_session";
const ALLOWED_DOMAIN = "@ghn.vn";

export function createSessionCookie(email, secret, maxAgeSeconds = 43200) {
  const exp = Date.now() + maxAgeSeconds * 1000;
  const payload = base64url(JSON.stringify({ email, exp }));
  const signature = sign(payload, secret);
  const token = `${payload}.${signature}`;
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Trả về { email, exp } nếu cookie hợp lệ + đúng domain @ghn.vn, ngược lại trả về null
export function verifySession(cookieHeader, secret) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, sig] = parts;
  const expectedSig = sign(payloadPart, secret);
  if (sig !== expectedSig) return null;
  try {
    const data = JSON.parse(base64urlDecode(payloadPart));
    if (!data.exp || Date.now() > data.exp) return null;
    if (!data.email || !data.email.toLowerCase().endsWith(ALLOWED_DOMAIN)) return null;
    return data;
  } catch (e) {
    return null;
  }
}

export { ALLOWED_DOMAIN };
