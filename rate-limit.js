/**
 * Oddiy in-memory rate limiter - login urinishlarini cheklaydi.
 * Bir IP dan ketma-ket ko'p noto'g'ri urinish bo'lsa, vaqtincha bloklanadi.
 * Bu hakerlarning "brute-force" (parolni tasodifiy urinish) hujumidan himoya qiladi.
 */

const attempts = new Map(); // ip -> { count, firstAttempt, blockedUntil }

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 daqiqa oyna
const BLOCK_MS = 30 * 60 * 1000; // 30 daqiqa bloklash

export function loginRateLimiter(req, res, next) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const now = Date.now();

  const record = attempts.get(ip);

  if (record?.blockedUntil && now < record.blockedUntil) {
    const minutesLeft = Math.ceil((record.blockedUntil - now) / 60000);
    return res.status(429).json({
      error: `Juda kop urinish. ${minutesLeft} daqiqadan keyin qayta urining.`,
    });
  }

  // Muvaffaqiyatli javobdan keyin hisoblagichni tozalash uchun
  // response tugagach tekshiramiz
  res.on("finish", () => {
    if (res.statusCode === 200) {
      attempts.delete(ip);
      return;
    }
    if (res.statusCode === 401) {
      const rec = attempts.get(ip) || { count: 0, firstAttempt: now };
      rec.count += 1;
      if (now - rec.firstAttempt > WINDOW_MS) {
        rec.count = 1;
        rec.firstAttempt = now;
      }
      if (rec.count >= MAX_ATTEMPTS) {
        rec.blockedUntil = now + BLOCK_MS;
      }
      attempts.set(ip, rec);
    }
  });

  next();
}

// Xotira tozalash - eski yozuvlarni vaqti-vaqti bilan o'chirish
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts.entries()) {
    if (rec.blockedUntil && now > rec.blockedUntil) attempts.delete(ip);
    else if (!rec.blockedUntil && now - rec.firstAttempt > WINDOW_MS) attempts.delete(ip);
  }
}, 10 * 60 * 1000);
