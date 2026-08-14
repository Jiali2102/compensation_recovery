import { clearSessionCookie } from "../lib/session.js";

export default async function handler(req, res) {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(200).json({ ok: true });
}
