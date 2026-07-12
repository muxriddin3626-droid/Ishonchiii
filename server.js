import express from "express";
import cors from "cors";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { getEskizToken, sendSmsViaEskiz } from "./eskiz.js";
import { adminLoginHandler, requireAdminAuth } from "./admin-auth.js";
import { loginRateLimiter } from "./rate-limit.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service role key - backend only, never expose to frontend
);

// ============================================================
// ADMIN AUTH - parol frontendда emas, faqat shu yerda tekshiriladi
// ============================================================
app.post("/api/admin/login", loginRateLimiter, adminLoginHandler);

app.get("/api/admin/verify", requireAdminAuth, (req, res) => {
  res.json({ valid: true });
});

// --- Rate limiting config ---
// Eskiz free/basic tarif odatda ~1-5 SMS/soniya beradi. Xavfsiz tomonda qolish uchun sekin yuboramiz.
const SMS_PER_BATCH = 20;       // Har safar navbatdan nechta SMS olamiz
const BATCH_INTERVAL_MS = 5000; // Har 5 soniyada bitta batch
const DELAY_BETWEEN_SMS_MS = 150; // Batch ichida har SMS orasida kutish

let isProcessing = false;

// --- POST /api/sms/queue --- Ilova SMS yuborishni so'raganda shu yerga keladi
app.post("/api/sms/queue", async (req, res) => {
  try {
    const { shopId, phone, message, kind } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: "phone va message majburiy" });
    }

    const { data, error } = await supabase
      .from("sms_queue")
      .insert({
        shop_id: shopId || null,
        phone: phone.trim(),
        message: message.trim(),
        kind: kind || "manual", // manual, auto_reminder, broadcast, chek
        status: "pending",
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, queueId: data.id, status: "queued" });
  } catch (err) {
    console.error("Queue error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /api/sms/queue-bulk --- Ommaviy xabar uchun (Admin broadcast)
app.post("/api/sms/queue-bulk", async (req, res) => {
  try {
    const { recipients, message, kind } = req.body;
    if (!Array.isArray(recipients) || recipients.length === 0 || !message) {
      return res.status(400).json({ error: "recipients (array) va message majburiy" });
    }

    const rows = recipients.map((r) => ({
      shop_id: r.shopId || null,
      phone: (r.phone || r).trim(),
      message: message.trim(),
      kind: kind || "broadcast",
      status: "pending",
      created_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase.from("sms_queue").insert(rows).select("id");
    if (error) throw error;

    res.json({ success: true, queued: data.length });
  } catch (err) {
    console.error("Bulk queue error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- GET /api/sms/status/:id --- Holatni tekshirish (ixtiyoriy, UI kerak bo'lsa)
app.get("/api/sms/status/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("sms_queue")
    .select("status, sent_at, error_msg")
    .eq("id", req.params.id)
    .single();
  if (error) return res.status(404).json({ error: "Topilmadi" });
  res.json(data);
});

// --- GET /api/sms/left/:shopId --- Do'kon uchun qolgan SMS sonini olish (settings jadvalidan)
app.get("/api/sms/stats/:shopId", async (req, res) => {
  const { data, error } = await supabase
    .from("sms_queue")
    .select("status", { count: "exact" })
    .eq("shop_id", req.params.shopId)
    .eq("status", "sent");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ sentCount: data.length });
});

app.get("/", (req, res) => {
  res.json({ status: "ISHONCH SMS Backend ishlayapti", time: new Date().toISOString() });
});

app.get("/health", (req, res) => res.json({ ok: true }));

// ============================================================
// WORKER: navbatni fon rejimida qayta ishlaydi
// ============================================================
async function processQueue() {
  if (isProcessing) return; // Bir vaqtning o'zida faqat bitta worker ishlasin
  isProcessing = true;

  try {
    const { data: pending, error } = await supabase
      .from("sms_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(SMS_PER_BATCH);

    if (error) throw error;
    if (!pending || pending.length === 0) {
      isProcessing = false;
      return;
    }

    console.log(`[Worker] ${pending.length} ta SMS qayta ishlanmoqda...`);

    // Bitta marta token olamiz, butun batch uchun ishlatamiz
    const token = await getEskizToken();

    for (const item of pending) {
      try {
        // status'ni "sending" ga o'tkazamiz - boshqa worker instance qayta olmasin
        await supabase.from("sms_queue").update({ status: "sending" }).eq("id", item.id);

        await sendSmsViaEskiz(token, item.phone, item.message);

        await supabase
          .from("sms_queue")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", item.id);

        // Agar shop_id bor bo'lsa - shu do'konning smsUsed hisobini oshiramiz
        if (item.shop_id) {
          await supabase.rpc("increment_sms_used", { shop_id_input: item.shop_id }).catch(() => {});
        }
      } catch (sendErr) {
        console.error(`[Worker] SMS xato (id=${item.id}):`, sendErr.message);
        await supabase
          .from("sms_queue")
          .update({ status: "failed", error_msg: String(sendErr.message).slice(0, 500) })
          .eq("id", item.id);
      }
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SMS_MS));
    }
  } catch (err) {
    console.error("[Worker] Umumiy xato:", err.message);
  } finally {
    isProcessing = false;
  }
}

// Har BATCH_INTERVAL_MS da navbatni tekshiradi
setInterval(processQueue, BATCH_INTERVAL_MS);
processQueue(); // darhol birinchi marta ham ishga tushadi

app.listen(PORT, () => {
  console.log(`ISHONCH SMS Backend ${PORT}-portda ishga tushdi`);
});
