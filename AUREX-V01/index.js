/***********************
 * AUREX GENESIS CORE *
 ***********************/

import { Telegraf, Markup } from "telegraf";
import Database from "better-sqlite3";
import QRCode from "qrcode";
import express from "express";

// ================= CONFIG =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;

const CHANNEL = process.env.CHANNEL_USERNAME || "@AUREXISOFFICIAL";
const GROUP_LINK = process.env.GROUP_LINK || "https://t.me/+ntc62LlmpYZiMjg9";

const UPI_ID = process.env.UPI_ID || "aurex.xxpgn-332@ptyes";
const UPI_NAME = process.env.UPI_NAME || "AUREX Official";

const DAILY_REWARD = 5;
const REFERRAL_REWARD = 5;
const WITHDRAW_STREAK = 7;
const MIN_WITHDRAW = 100;

// ================= INIT =================
if (!BOT_TOKEN) {
  console.error("FATAL: BOT_TOKEN not found");
  process.exit(1);
}

if (!ADMIN_ID) {
  console.warn("WARNING: ADMIN_ID not found in environment variables. Admin features will be disabled.");
}

const bot = new Telegraf(BOT_TOKEN);
const db = new Database("aurex.db");
const app = express();

app.get("/", (_, res) => res.send("AUREX Genesis Core running 🚀"));
const server = app.listen(process.env.PORT || 5000, "0.0.0.0", () => {
  console.log(`Web server listening on port ${process.env.PORT || 5000}`);
});

server.on('error', (err) => {
  console.error("Server error:", err);
});

// ================= DB SETUP =================
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  balance INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  last_daily TEXT,
  referred_by INTEGER
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  code TEXT,
  cost INTEGER,
  stock INTEGER,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount INTEGER,
  status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount INTEGER,
  utr TEXT,
  status TEXT DEFAULT 'pending'
);
`);

// ================= STATE MANAGEMENT =================
const userState = new Map();

// ================= HELPERS =================
function isAdmin(id) {
  return ADMIN_ID && id === ADMIN_ID;
}

async function checkJoin(ctx) {
  if (isAdmin(ctx.from.id)) return true;
  try {
    const m = await ctx.telegram.getChatMember(CHANNEL, ctx.from.id);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch (e) {
    console.error("CheckJoin Error:", e.message);
    return false;
  }
}

function getUser(id) {
  let u = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!u) {
    db.prepare("INSERT INTO users (id) VALUES (?)").run(id);
    u = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  }
  return u;
}

function mainMenu() {
  return Markup.keyboard([
    ["💰 Balance", "🎁 Daily"],
    ["➕ Add Funds", "🛒 Shop"],
    ["👥 Refer", "📤 Withdraw"]
  ]).resize();
}

// ================= MIDDLEWARE =================
bot.use(async (ctx, next) => {
  if (ctx.from && !(await checkJoin(ctx))) {
    if (ctx.callbackQuery && (ctx.callbackQuery.data === 'verify' || ctx.callbackQuery.data.startsWith('admin_'))) return next();
    if (ctx.message && ctx.message.text === '/start') return next();
    
    return ctx.reply(
      "🔒 Join required to use this bot.",
      Markup.inlineKeyboard([
        [Markup.button.url("Join Channel", "https://t.me/AUREXISOFFICIAL")],
        [Markup.button.url("Join Group", GROUP_LINK)],
        [Markup.button.callback("✅ Verify", "verify")]
      ])
    );
  }
  return next();
});

// ================= START =================
bot.start(async (ctx) => {
  const ref = ctx.startPayload;
  let user = db.prepare("SELECT * FROM users WHERE id=?").get(ctx.from.id);
  const isNewUser = !user;
  
  if (isNewUser) {
    db.prepare("INSERT INTO users (id) VALUES (?)").run(ctx.from.id);
    user = db.prepare("SELECT * FROM users WHERE id=?").get(ctx.from.id);
  }

  // Only award referral if it's a NEW user and they have a valid referrer
  if (isNewUser && ref && ref !== String(ctx.from.id)) {
    const referrerId = parseInt(ref);
    if (!isNaN(referrerId)) {
      const referrer = db.prepare("SELECT * FROM users WHERE id=?").get(referrerId);
      if (referrer) {
        db.prepare("UPDATE users SET referred_by=? WHERE id=?").run(referrerId, ctx.from.id);
        db.prepare("UPDATE users SET balance = balance + ? WHERE id=?").run(REFERRAL_REWARD, referrerId);
        
        // Notify referrer
        bot.telegram.sendMessage(referrerId, `🎉 New referral! You earned ${REFERRAL_REWARD} AUREX.`).catch(e => console.error("Referral Notify Error:", e.message));
      }
    }
  }

  ctx.reply(
    `🟡 Welcome to AUREX\n\n💰 Balance: ${user.balance} AUREX\n🔥 Streak: ${user.streak}`,
    mainMenu()
  );
});

// ================= VERIFY =================
bot.action("verify", async (ctx) => {
  if (await checkJoin(ctx)) {
    await ctx.answerCbQuery("✅ Verified!");
    await ctx.deleteMessage().catch(() => {});
    return ctx.reply("✅ Verified! Welcome to AUREX Genesis.", mainMenu());
  } else {
    return ctx.answerCbQuery("❌ Not joined yet!", { show_alert: true });
  }
});

// ================= DAILY =================
bot.hears("🎁 Daily", (ctx) => {
  const u = getUser(ctx.from.id);
  const today = new Date().toISOString().split("T")[0];

  if (u.last_daily === today)
    return ctx.reply("⏳ Already claimed today");

  const lastDaily = u.last_daily ? new Date(u.last_daily) : null;
  const now = new Date(today);
  
  let newStreak = 1;
  if (lastDaily && (now - lastDaily) / 86400000 === 1) {
    newStreak = u.streak + 1;
  }

  db.prepare("UPDATE users SET balance = balance + ?, streak=?, last_daily=? WHERE id=?")
    .run(DAILY_REWARD, newStreak, today, ctx.from.id);

  ctx.reply(`🎉 +${DAILY_REWARD} AUREX\n🔥 Streak: ${newStreak} days`);
});

// ================= BALANCE =================
bot.hears("💰 Balance", (ctx) => {
  const u = getUser(ctx.from.id);
  const refCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE referred_by = ?").get(ctx.from.id).count;
  ctx.reply(`💰 Balance: ${u.balance} AUREX\n🔥 Streak: ${u.streak}\n👥 Referrals: ${refCount}`);
});

// ================= REFER =================
bot.hears("👥 Refer", (ctx) => {
  ctx.reply(
    `👥 Refer & Earn\n+${REFERRAL_REWARD} AUREX per user\n\nYour Link: https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`
  );
});

// ================= ADD FUNDS =================
bot.hears("➕ Add Funds", async (ctx) => {
  userState.set(ctx.from.id, { step: "add_funds_amt" });
  ctx.reply("💳 Enter amount in ₹:", Markup.removeKeyboard());
});

// ================= SHOP =================
bot.hears("🛒 Shop", (ctx) => {
  const items = db.prepare(`
    SELECT name, cost, SUM(stock) as total_stock 
    FROM coupons 
    WHERE active=1 
    GROUP BY name, cost
  `).all();

  if (!items.length)
    return ctx.reply("🛒 Shop\n\nNo items available right now.");

  ctx.reply(
    "🛒 Shop - Select an item:",
    Markup.inlineKeyboard(
      items.map(item => {
        const outOfStock = item.total_stock <= 0;
        const btnText = `${item.name} (${item.cost} AUREX)${outOfStock ? ' [OUT OF STOCK]' : ''}`;
        return [
          Markup.button.callback(
            btnText, 
            outOfStock ? `out_of_stock` : `buy_item_${Buffer.from(item.name + '|' + item.cost).toString('base64')}`
          )
        ];
      })
    )
  );
});

bot.action("out_of_stock", (ctx) => ctx.answerCbQuery("❌ This item is out of stock!", { show_alert: true }));

bot.action(/buy_item_(.+)/, async (ctx) => {
  const data = Buffer.from(ctx.match[1], 'base64').toString();
  const [name, costStr] = data.split('|');
  const cost = parseInt(costStr);
  
  const u = getUser(ctx.from.id);
  if (u.balance < cost) return ctx.answerCbQuery(`Need ${cost} AUREX. You have ${u.balance}.`, { show_alert: true });

  const c = db.prepare("SELECT * FROM coupons WHERE name=? AND cost=? AND stock > 0 AND active=1 LIMIT 1").get(name, cost);

  if (!c) return ctx.answerCbQuery("Item unavailable or out of stock", { show_alert: true });

  db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(cost, ctx.from.id);
  db.prepare("UPDATE coupons SET stock=stock-1 WHERE id=?").run(c.id);

  await ctx.answerCbQuery("Purchase successful!");
  ctx.reply(`🎉 Coupon Redeemed!\n\nItem: ${c.name}\nCode: ${c.code}`);
});

// ================= WITHDRAW =================
bot.hears("📤 Withdraw", (ctx) => {
  const u = getUser(ctx.from.id);
  if (u.streak < WITHDRAW_STREAK || u.balance < MIN_WITHDRAW) {
    return ctx.reply(`🔒 Withdraw locked.\nNeed: ${MIN_WITHDRAW} AUREX\nStreak: ${u.streak}/${WITHDRAW_STREAK} days`);
  }

  const amt = u.balance;
  db.prepare("INSERT INTO withdrawals (user_id, amount) VALUES (?, ?)").run(ctx.from.id, amt);
  db.prepare("UPDATE users SET balance = 0 WHERE id = ?").run(ctx.from.id);

  bot.telegram.sendMessage(
    ADMIN_ID,
    `📤 New Withdraw Request\nUser: ${ctx.from.id}\nAmount: ${amt} AUREX`,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Approve", `wd_ok_${ctx.from.id}_${amt}`)],
      [Markup.button.callback("❌ Reject", `wd_no_${ctx.from.id}_${amt}`)]
    ])
  );

  ctx.reply("📤 Withdraw request sent to admin for processing. Your balance has been deducted.");
});

// ================= ADMIN PANEL =================
bot.command("admin", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  ctx.reply(
    "🛠 Admin Panel",
    Markup.inlineKeyboard([
      [Markup.button.callback("➕ Add Coupon", "admin_add_coupon")],
      [Markup.button.callback("📦 View Payments", "admin_view_payments")],
      [Markup.button.callback("📤 View Withdrawals", "admin_view_withdrawals")],
      [Markup.button.callback("💰 Clear All Balances", "admin_clear_all")],
      [Markup.button.callback("👤 Clear User Balance", "admin_clear_user")],
      [Markup.button.callback("🎫 Add Bulk Coupons", "admin_add_bulk_coupons")],
      [Markup.button.callback("🏷 Change Coupon Price", "admin_change_price")]
    ])
  );
});

bot.action("admin_view_withdrawals", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const w = db.prepare("SELECT * FROM withdrawals WHERE status='pending' LIMIT 10").all();
  if (!w.length) return ctx.answerCbQuery("No pending withdrawals", { show_alert: true });

  await ctx.answerCbQuery();
  for (const req of w) {
    await ctx.reply(
      `📤 Withdraw Request\nID: ${req.id}\nUser: ${req.user_id}\nAmount: ${req.amount} AUREX`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Approve", `wd_approve_${req.id}`)],
        [Markup.button.callback("❌ Reject", `wd_reject_${req.id}`)]
      ])
    );
  }
});

bot.action(/wd_approve_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const id = ctx.match[1];
  const req = db.prepare("SELECT * FROM withdrawals WHERE id=?").get(id);
  if (!req || req.status !== 'pending') return ctx.answerCbQuery("Invalid request");

  db.prepare("UPDATE withdrawals SET status='approved' WHERE id=?").run(id);
  bot.telegram.sendMessage(req.user_id, `✅ Your withdrawal of ${req.amount} AUREX has been approved!`);
  ctx.editMessageText(`✅ Withdrawal Approved (ID: ${id})`);
  ctx.answerCbQuery("Approved");
});

bot.action(/wd_reject_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const id = ctx.match[1];
  const req = db.prepare("SELECT * FROM withdrawals WHERE id=?").get(id);
  if (!req || req.status !== 'pending') return ctx.answerCbQuery("Invalid request");

  db.prepare("UPDATE withdrawals SET status='rejected' WHERE id=?").run(id);
  db.prepare("UPDATE users SET balance = balance + ? WHERE id=?").run(req.amount, req.user_id);
  
  bot.telegram.sendMessage(req.user_id, `❌ Your withdrawal of ${req.amount} AUREX was rejected. Balance refunded.`);
  ctx.editMessageText(`❌ Withdrawal Rejected (ID: ${id})`);
  ctx.answerCbQuery("Rejected");
});

bot.action(/wd_ok_(\d+)_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const userId = ctx.match[1];
  const amount = ctx.match[2];
  ctx.editMessageText(`✅ Withdrawal Handled (User: ${userId}, Amount: ${amount})`);
  ctx.answerCbQuery("Handled");
});

bot.action(/wd_no_(\d+)_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const userId = ctx.match[1];
  const amount = parseInt(ctx.match[2]);
  db.prepare("UPDATE users SET balance = balance + ? WHERE id=?").run(amount, userId);
  ctx.editMessageText(`❌ Withdrawal Rejected (User: ${userId}, Amount: ${amount}). Refunded.`);
  ctx.answerCbQuery("Rejected & Refunded");
});

bot.action("admin_view_payments", async (ctx) => {
  const p = db.prepare("SELECT * FROM payments WHERE status='pending' LIMIT 10").all();
  if (!p.length) return ctx.answerCbQuery("No pending payments", { show_alert: true });

  await ctx.answerCbQuery();
  for (const pay of p) {
    await ctx.reply(
      `💳 Payment ID: ${pay.id}\nUser: ${pay.user_id}\nAmount: ₹${pay.amount}\nUTR: ${pay.utr || "N/A"}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Approve", `pay_ok_${pay.id}`)],
        [Markup.button.callback("❌ Reject", `pay_no_${pay.id}`)]
      ])
    );
  }
});

bot.action("admin_clear_all", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  db.prepare("UPDATE users SET balance = 0").run();
  await ctx.answerCbQuery("✅ All balances cleared!");
  ctx.reply("✅ Success: All user balances have been reset to 0.");
});

bot.action("admin_clear_user", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  userState.set(ctx.from.id, { step: "admin_clear_user_id" });
  await ctx.answerCbQuery();
  ctx.reply("👤 Enter the User ID to clear balance:");
});

bot.action("admin_add_coupon", (ctx) => {
  userState.set(ctx.from.id, { step: "admin_cp_name" });
  ctx.reply("Enter coupon NAME:");
  ctx.answerCbQuery();
});

bot.action("admin_add_bulk_coupons", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const groups = db.prepare("SELECT name, cost FROM coupons GROUP BY name, cost").all();
  
  const buttons = groups.map(g => [
    Markup.button.callback(`${g.name} (${g.cost} AUREX)`, `admin_bulk_direct_${Buffer.from(g.name + '|' + g.cost).toString('base64')}`)
  ]);
  
  buttons.push([Markup.button.callback("➕ Add New Coupon Name", "admin_bulk_new")]);

  ctx.reply("🎫 Select a coupon group or add new:", Markup.inlineKeyboard(buttons));
  ctx.answerCbQuery();
});

bot.action("admin_bulk_new", (ctx) => {
  userState.set(ctx.from.id, { step: "admin_bulk_cp_init" });
  ctx.reply("Enter the NAME for new bulk coupons:");
  ctx.answerCbQuery();
});

bot.action(/admin_bulk_direct_(.+)/, (ctx) => {
  const data = Buffer.from(ctx.match[1], 'base64').toString();
  const [name, cost] = data.split('|');
  userState.set(ctx.from.id, { step: "admin_bulk_cp_codes", name, cost: parseInt(cost) });
  ctx.reply(`Adding codes for: ${name}\nCost: ${cost} AUREX\n\nSend the bulk CODES (one per line):`);
  ctx.answerCbQuery();
});

bot.action("admin_change_price", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const groups = db.prepare("SELECT name, cost FROM coupons GROUP BY name, cost").all();
  
  const buttons = groups.map(g => [
    Markup.button.callback(`${g.name} (${g.cost} AUREX)`, `admin_price_sel_${Buffer.from(g.name).toString('base64')}`)
  ]);

  ctx.reply("🏷 Select coupon to change price:", Markup.inlineKeyboard(buttons));
  ctx.answerCbQuery();
});

bot.action(/admin_price_sel_(.+)/, (ctx) => {
  const name = Buffer.from(ctx.match[1], 'base64').toString();
  userState.set(ctx.from.id, { step: "admin_price_new", name });
  ctx.reply(`Changing price for: ${name}\nEnter the NEW price (AUREX):`);
  ctx.answerCbQuery();
});

// ================= PAYMENTS ADMIN =================
bot.action(/pay_ok_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const id = ctx.match[1];
  const p = db.prepare("SELECT * FROM payments WHERE id=?").get(id);
  
  if (!p || p.status !== 'pending') return ctx.answerCbQuery("Invalid or already processed");

  db.prepare("UPDATE payments SET status='approved' WHERE id=?").run(id);
  db.prepare("UPDATE users SET balance = balance + ? WHERE id=?").run(p.amount, p.user_id);

  bot.telegram.sendMessage(p.user_id, `✅ Payment of ₹${p.amount} Approved!\n${p.amount} AUREX credited to your balance.`);
  ctx.editMessageText(`✅ Payment Approved (ID: ${id})`);
  ctx.answerCbQuery("Approved");
});

bot.action(/pay_no_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const id = ctx.match[1];
  db.prepare("UPDATE payments SET status='rejected' WHERE id=?").run(id);
  ctx.editMessageText(`❌ Payment Rejected (ID: ${id})`);
  ctx.answerCbQuery("Rejected");
});

// ================= GENERIC TEXT HANDLER (STATE MACHINE) =================
bot.on("text", async (ctx) => {
  const state = userState.get(ctx.from.id);
  if (!state) return;

  // Add Funds Flow
  if (state.step === "add_funds_amt") {
    const amt = parseInt(ctx.message.text);
    if (!amt || amt <= 0) return ctx.reply("❌ Invalid amount. Enter ₹:");

    const upi = `upi://pay?pa=${UPI_ID}&pn=${UPI_NAME}&am=${amt}&cu=INR&tn=AUREX`;
    const qr = await QRCode.toBuffer(upi);

    const stmt = db.prepare("INSERT INTO payments (user_id, amount, status) VALUES (?, ?, 'pending')");
    const info = stmt.run(ctx.from.id, amt);
    const payId = info.lastInsertRowid;

    userState.set(ctx.from.id, { step: "add_funds_utr", payId, amt });

    return ctx.replyWithPhoto(
      { source: qr },
      { 
        caption: `Scan & Pay ₹${amt}\nUPI: ${UPI_ID}\n\nIMPORTANT: After paying, please send the 12-digit UTR/Transaction ID below:`,
        ...mainMenu()
      }
    );
  }

  if (state.step === "add_funds_utr") {
    const utr = ctx.message.text;
    if (utr.length < 6) return ctx.reply("❌ Invalid UTR. Please send correct Transaction ID:");

    db.prepare("UPDATE payments SET utr=? WHERE id=?").run(utr, state.payId);
    userState.delete(ctx.from.id);

    ctx.reply("⏳ Payment submitted! Waiting for admin approval.", mainMenu());

    return bot.telegram.sendMessage(
      ADMIN_ID,
      `💳 New Payment\nUser: ${ctx.from.id}\nAmount: ₹${state.amt}\nUTR: ${utr}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Approve", `pay_ok_${state.payId}`)],
        [Markup.button.callback("❌ Reject", `pay_no_${state.payId}`)]
      ])
    );
  }

  // Admin Add Coupon Flow
  if (state.step === "admin_cp_name") {
    state.name = ctx.message.text;
    state.step = "admin_cp_code";
    return ctx.reply("Enter coupon CODE:");
  }
  if (state.step === "admin_cp_code") {
    state.code = ctx.message.text;
    state.step = "admin_cp_cost";
    return ctx.reply("Enter cost (AUREX):");
  }
  if (state.step === "admin_cp_cost") {
    state.cost = parseInt(ctx.message.text);
    state.step = "admin_cp_stock";
    return ctx.reply("Enter stock:");
  }
  if (state.step === "admin_cp_stock") {
    db.prepare("INSERT INTO coupons (name, code, cost, stock) VALUES (?, ?, ?, ?)")
      .run(state.name, state.code, state.cost, parseInt(ctx.message.text));
    userState.delete(ctx.from.id);
    return ctx.reply("✅ Coupon added successfully!", mainMenu());
  }

  // Admin Bulk Coupon Flow
  if (state.step === "admin_bulk_cp_init") {
    state.name = ctx.message.text;
    state.step = "admin_bulk_cp_cost";
    return ctx.reply(`Name set to: ${state.name}\nEnter cost (AUREX) for these coupons:`);
  }
  if (state.step === "admin_bulk_cp_cost") {
    state.cost = parseInt(ctx.message.text);
    state.step = "admin_bulk_cp_codes";
    return ctx.reply(`Cost set to: ${state.cost} AUREX\nNow send the bulk CODES (one per line):`);
  }
  if (state.step === "admin_bulk_cp_codes") {
    const codes = ctx.message.text.split("\n").map(c => c.trim()).filter(c => c);
    const insert = db.prepare("INSERT INTO coupons (name, code, cost, stock) VALUES (?, ?, ?, ?)");
    let count = 0;
    for (const code of codes) {
      insert.run(state.name, code, state.cost, 1);
      count++;
    }
    userState.delete(ctx.from.id);
    return ctx.reply(`✅ ${count} coupons added under "${state.name}"!`, mainMenu());
  }

  // Admin Clear User Balance Flow
  if (state.step === "admin_clear_user_id") {
    const targetId = parseInt(ctx.message.text);
    if (!targetId) return ctx.reply("❌ Invalid User ID. Enter numeric ID:");
    
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(targetId);
    if (!user) return ctx.reply(`❌ User ${targetId} not found in database.`);

    db.prepare("UPDATE users SET balance = 0 WHERE id=?").run(targetId);
    userState.delete(ctx.from.id);
    return ctx.reply(`✅ Balance cleared for user ${targetId}.`, mainMenu());
  }

  // Admin Change Price Flow
  if (state.step === "admin_price_new") {
    const newPrice = parseInt(ctx.message.text);
    if (isNaN(newPrice) || newPrice < 0) return ctx.reply("❌ Invalid price. Enter numeric value:");
    
    db.prepare("UPDATE coupons SET cost = ? WHERE name = ?").run(newPrice, state.name);
    userState.delete(ctx.from.id);
    return ctx.reply(`✅ Price updated to ${newPrice} AUREX for "${state.name}".`, mainMenu());
  }
});

// ================= ERROR HANDLING =================
bot.catch((err, ctx) => {
  console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

// ================= LAUNCH =================
bot.launch({
  dropPendingUpdates: true
}).then(() => {
  console.log("🚀 AUREX Genesis Core LIVE");
}).catch(err => {
  console.error("Bot Launch Failed:", err);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

// ADMIN GIFT COMMAND
bot.command("gift", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to use this command.");
  }
  const parts = ctx.message.text.split(" ");
  if (parts.length !== 3) {
    return ctx.reply("Usage: /gift <user_id> <amount>");
  }
  const targetId = parseInt(parts[1]);
  const amount = parseInt(parts[2]);
  if (isNaN(targetId) || isNaN(amount) || amount <= 0) {
    return ctx.reply("❌ Invalid user ID or amount.");
  }
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(targetId);
  if (!user) {
    return ctx.reply("❌ User not found.");
  }
  db.prepare("UPDATE users SET balance = balance + ? WHERE id=?").run(amount, targetId);
  ctx.reply(`✅ Gifted ${amount} AUREX to user ${targetId}`);
  bot.telegram.sendMessage(targetId, `🎁 You received ${amount} AUREX as a gift from admin.`);
});
