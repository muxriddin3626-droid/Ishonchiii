// Ishlatish: node scripts/hash-password.js "sizning_parolingiz"
// Natijani .env faylidagi ADMIN_PASS_HASH ga joylashtiring.

import bcrypt from "bcryptjs";

const password = process.argv[2];

if (!password) {
  console.log("Ishlatish: node scripts/hash-password.js \"parolingiz\"");
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log("\nBu hash'ni .env faylida ADMIN_PASS_HASH ga qoying:\n");
console.log(hash);
console.log("");
