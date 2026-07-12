import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

/**
 * Admin login/parol MUHIT O'ZGARUVCHISIDA saqlanadi (.env), frontendda EMAS.
 * Parol bcrypt bilan solishtiriladi (agar ADMIN_PASS_HASH ishlatilsa) yoki
 * oddiy taqqoslash (agar ADMIN_PASSWORD ishlatilsa - kamroq xavfsiz, lekin sodda).
 *
 * Tavsiya: ADMIN_PASS_HASH ishlating. Buni oldindan generatsiya qilish uchun:
 *   node -e "console.log(require('bcryptjs').hashSync('parolingiz', 10))"
 */

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_IN_PRODUCTION";
const TOKEN_EXPIRY = "12h";

export async function adminLoginHandler(req, res) {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({ error: "Login va parol majburiy" });
  }

  const validLogin = process.env.ADMIN_LOGIN;
  const validPassHash = process.env.ADMIN_PASS_HASH;
  const validPasswordPlain = process.env.ADMIN_PASSWORD; // faqat fallback

  if (!validLogin || (!validPassHash && !validPasswordPlain)) {
    console.error("ADMIN_LOGIN yoki ADMIN_PASS_HASH .env da sozlanmagan!");
    return res.status(500).json({ error: "Server sozlanmagan" });
  }

  if (login !== validLogin) {
    // Login noto'g'ri bo'lsa ham "noto'g'ri login yoki parol" deymiz -
    // bu orqali hujumchi qaysi qismi xato ekanini bila olmaydi
    return res.status(401).json({ error: "Login yoki parol notogri" });
  }

  let passwordOk = false;
  if (validPassHash) {
    passwordOk = await bcrypt.compare(password, validPassHash);
  } else {
    passwordOk = password === validPasswordPlain;
  }

  if (!passwordOk) {
    return res.status(401).json({ error: "Login yoki parol notogri" });
  }

  const token = jwt.sign({ role: "admin", login }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  res.json({ success: true, token, expiresIn: TOKEN_EXPIRY });
}

/**
 * Middleware: himoyalangan admin endpointlar uchun.
 * Frontend har so'rovda "Authorization: Bearer <token>" yuborishi kerak.
 */
export function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Token kerak" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin") throw new Error("notogri rol");
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token notogri yoki muddati tugagan" });
  }
}
