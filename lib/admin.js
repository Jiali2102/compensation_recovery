import crypto from "crypto";
import { base64url, base64urlDecode, sign, verifySession } from "./session.js";

const ADMIN_COOKIE = "ghn_adm";
const ADMIN_TTL = 7200;

function allowList() {
  return String(process.env.RPT_ALLOW || "")
    .split(/[,;\s]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function adminConfigured() {
  return allowList().length > 0 && !!process.env.RPT_PASS && !!process.env.SESSION_SECRET;
}

export function isAllowedEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return !!e && allowList().includes(e);
}

function digest(s) {
  return crypto.createHash("sha256").update(String(s)).digest();
}

export function passwordMatches(input) {
  const expected = process.env.RPT_PASS;
  if (!expected) return false;
  return crypto.timingSafeEqual(digest(input === undefined || input === null ? "" : input), digest(expected));
}

function adminSig(payload, secret) {
  return sign("rpt." + payload, secret);
}

function sameHex(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function createAdminCookie(email, secret) {
  const exp = Date.now() + ADMIN_TTL * 1000;
  const payload = base64url(JSON.stringify({ email, exp }));
  return `${ADMIN_COOKIE}=${payload}.${adminSig(payload, secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_TTL}`;
}

export function clearAdminCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readAdminCookie(cookieHeader, secret) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([^;]+)`));
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length !== 2) return null;
  if (!sameHex(parts[1], adminSig(parts[0], secret))) return null;
  try {
    const data = JSON.parse(base64urlDecode(parts[0]));
    if (!data.exp || Date.now() > data.exp || !data.email) return null;
    return data;
  } catch (e) {
    return null;
  }
}

export function getAccess(req) {
  const secret = process.env.SESSION_SECRET;
  const session = secret ? verifySession(req.headers.cookie, secret) : null;
  if (!session) return { session: null, email: "", allowed: false, unlocked: false };
  const email = String(session.email || "").toLowerCase();
  const allowed = isAllowedEmail(email);
  let unlocked = false;
  if (allowed) {
    const adm = readAdminCookie(req.headers.cookie, secret);
    unlocked = !!adm && String(adm.email).toLowerCase() === email;
  }
  return { session, email, allowed, unlocked };
}
