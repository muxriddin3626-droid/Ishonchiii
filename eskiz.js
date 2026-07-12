import fetch from "node-fetch";

const ESKIZ_BASE = "https://notify.eskiz.uz/api";

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Eskiz.uz token oladi. Token ~30 kun amal qiladi, shuning uchun keshlaymiz
 * va faqat muddati tugaganda qayta so'raymiz.
 */
export async function getEskizToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const email = process.env.ESKIZ_EMAIL;
  const password = process.env.ESKIZ_PASSWORD;

  if (!email || !password) {
    throw new Error("ESKIZ_EMAIL yoki ESKIZ_PASSWORD .env da topilmadi");
  }

  const res = await fetch(`${ESKIZ_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Eskiz login xato: ${res.status} ${text}`);
  }

  const json = await res.json();
  const token = json?.data?.token;
  if (!token) throw new Error("Eskiz token qaytmadi: " + JSON.stringify(json));

  cachedToken = token;
  // Xavfsiz tomonda: 25 kundan keyin qayta login qilamiz (token 30 kun amal qiladi)
  tokenExpiresAt = now + 25 * 24 * 60 * 60 * 1000;

  console.log("[Eskiz] Yangi token olindi");
  return token;
}

/**
 * Bitta SMS yuboradi.
 * Telefon raqam formatini tozalaydi: +998901234567 -> 998901234567
 */
export async function sendSmsViaEskiz(token, phone, message) {
  const cleanPhone = String(phone).replace(/\D/g, "").replace(/^8/, "998");
  const finalPhone = cleanPhone.startsWith("998") ? cleanPhone : "998" + cleanPhone;

  if (finalPhone.length !== 12) {
    throw new Error("Notogri telefon format: " + phone);
  }

  const res = await fetch(`${ESKIZ_BASE}/message/sms/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mobile_phone: finalPhone,
      message: message,
      from: process.env.ESKIZ_SENDER_NAME || "4546", // standart nom, tasdiqlangan brend bo'lsa o'zgartiring
    }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Token muddati tugagan bo'lishi mumkin - keshni tozalaymiz, keyingi urinishda qayta login bo'ladi
    if (res.status === 401) {
      cachedToken = null;
    }
    throw new Error(`Eskiz SMS xato: ${res.status} ${JSON.stringify(json)}`);
  }

  return json;
}
