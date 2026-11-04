import crypto from "crypto";

export const RELAY_URL = process.env.CR_RELAY_URL || "https://n8n-workflow.ghn.vn/webhook/cr-bi-pub";

const secret = () => process.env.CR_RELAY_SECRET || "";
const hmac = (msg) => crypto.createHmac("sha256", secret()).update(msg).digest();
const b64u = (buf) => Buffer.from(buf).toString("base64url");

export function relayConfigured() {
  return Boolean(secret());
}

export function makeTicket(email) {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const payload = b64u(`${email}|${exp}`);
  return `${payload}.${b64u(hmac(`crt|${payload}`))}`;
}

export function openBlob(blob) {
  if (!secret() || !blob) return null;
  const [nonce, ctS, tag] = String(blob).split(".");
  if (!nonce || !ctS || !tag) return null;
  const expected = b64u(hmac(`tag|${nonce}|${ctS}`));
  if (tag.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(tag), Buffer.from(expected))) return null;
  const ct = Buffer.from(ctS, "base64url");
  const pt = Buffer.alloc(ct.length);
  for (let i = 0; i * 32 < ct.length; i++) {
    const ks = hmac(`ks|${nonce}|${i}`);
    for (let j = 0; j < 32 && i * 32 + j < ct.length; j++) pt[i * 32 + j] = ct[i * 32 + j] ^ ks[j];
  }
  try {
    const obj = JSON.parse(pt.toString("utf8"));
    if (!obj || !obj.s || Number(obj.exp) < Date.now()) return null;
    return String(obj.s);
  } catch (e) {
    return null;
  }
}
