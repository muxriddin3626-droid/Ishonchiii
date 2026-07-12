-- SMS navbat jadvali
CREATE TABLE IF NOT EXISTS sms_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id UUID,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  kind TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'pending',
  error_msg TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

-- Tezkor qidiruv uchun indekslar
CREATE INDEX IF NOT EXISTS idx_sms_queue_status ON sms_queue(status);
CREATE INDEX IF NOT EXISTS idx_sms_queue_shop ON sms_queue(shop_id);

-- Do'konning smsUsed sonini oshiruvchi funksiya (agar shops jadvalida sms_used ustuni bo'lsa)
CREATE OR REPLACE FUNCTION increment_sms_used(shop_id_input UUID)
RETURNS void AS $$
BEGIN
  UPDATE shops
  SET sms_used = COALESCE(sms_used, 0) + 1
  WHERE id = shop_id_input;
END;
$$ LANGUAGE plpgsql;
