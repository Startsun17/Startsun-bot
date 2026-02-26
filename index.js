          import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import express from "express";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";

// ================== CONFIG ==================
const PORT = process.env.PORT || 8080;

// WAJIB di Railway Variables:
// OWNER = 628xxxxxxxxxx (format 62, tanpa 0)
const OWNER = (process.env.OWNER || "").trim();

// Railway Volume: set mount ke /data
const DATA_DIR = process.env.DATA_DIR || "/data";
const SESSION_DIR = path.join(DATA_DIR, "session");
const DB_FILE = path.join(DATA_DIR, "data.json");

let lastQr = null;

// ================== HELPERS ==================
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeNumber(num) {
  return (num || "").replace(/[^\d]/g, ""); // digits only
}

function isOwner(jid) {
  const owner = normalizeNumber(OWNER);
  const jidNum = normalizeNumber((jid || "").split("@")[0]); // 628xxx@s.whatsapp.net
  return owner && jidNum === owner;
}

async function rejectNotOwner(sock, jid) {
  await sock.sendMessage(jid, { text: "⛔ Command ini khusus *OWNER*." });
}

// ================== SIMPLE DB (PERSISTENT) ==================
function loadDB() {
  ensureDir(DATA_DIR);
  try {
    if (!fs.existsSync(DB_FILE)) return { lists: {}, welcome: {} };
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch {
    return { lists: {}, welcome: {} };
  }
}

function saveDB(db) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getUserList(db, jid) {
  if (!db.lists) db.lists = {};
  if (!db.lists[jid]) db.lists[jid] = [];
  return db.lists[jid];
}

function formatList(list) {
  if (!list || list.length === 0) {
    return "📭 List masih kosong.";
  }
  const lines = list.map((x, i) => `${i + 1}. ${x.text}`);
  return `📌 *LIST*\n\n${lines.join("\n")}`;
}

function formatMenu(isOwnerUser) {
  let menu =
    "📋 *MENU*\n\n" +
    "• ping\n" +
    "• order\n" +
    "• menu\n" +
    "• list\n" +
    "• welcome\n";

  if (isOwnerUser) {
    menu +=
      "\n🔐 *OWNER ONLY*\n" +
      "• addlist <item>\n" +
      "• dellist <nomor>\n" +
      "• clearlist\n" +
      "• setwelcome <pesan>\n" +
      "• delwelcome\n";
  }

  return menu;
}

// ================== WEB SERVER (QR VIEW) ==================
const app = express();

app.get("/", (req, res) => {
  res.send("OK ✅ Startsun-bot jalan. Buka /qr untuk scan barcode.");
});

app.get("/qr", async (req, res) => {
  try {
    if (!lastQr) {
      return res
        .status(404)
        .send("QR belum tersedia. Tunggu sebentar lalu refresh /qr");
    }
    const img = await QRCode.toBuffer(lastQr, { width: 520, margin: 2 });
    res.setHeader("Content-Type", "image/png");
    res.send(img);
  } catch (e) {
    res.status(500).send("Gagal generate QR");
  }
});

app.listen(PORT, () => console.log("Web server ready di port", PORT));

// ================== WHATSAPP BOT ==================
const logger = pino({ level: "silent" });

async function startWA() {
  try {
    ensureDir(SESSION_DIR);

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      logger,
      auth: state,
      version,
      printQRInTerminal: false,
      browser: ["Startsun-bot", "Chrome", "1.0.0"],
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        lastQr = qr;
        console.log("📷 QR baru tersedia. Buka /qr untuk scan.");
      }

      if (connection === "open") {
        lastQr = null;
        console.log("✅ Bot berhasil connect!");
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log("❌ Koneksi putus. code:", statusCode, "| reconnect:", shouldReconnect);

        if (shouldReconnect) setTimeout(startWA, 3000);
        else {
          console.log("⚠️ Logged out. Hapus folder session lalu scan lagi.");
          console.log("   (Karena session disimpan di /data/session, hapus via redeploy + reset volume kalau perlu)");
        }
      }
    });

    // ================== MESSAGE HANDLER ==================
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        if (type !== "notify") return;

        const msg = messages?.[0];
        if (!msg?.message) return;
        if (msg.key.fromMe) return;

        const jid = msg.key.remoteJid;

        // Ambil teks (chat biasa / caption)
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          "";

        if (!text) return;

        // prefix fleksibel: .menu, !menu, #menu, atau tanpa prefix
        const cleaned = text.trim().toLowerCase().replace(/^[.!#]/, "");
        const [cmdRaw, ...rest] = cleaned.split(/\s+/);
        const cmd = (cmdRaw || "").trim();
        const args = rest.join(" ").trim();

        const db = loadDB();
        const ownerUser = isOwner(jid);

        // ====== BASIC COMMANDS ======
        if (cmd === "menu" || cmd === "help") {
          await sock.sendMessage(jid, { text: formatMenu(ownerUser) });
          return;
        }

        if (cmd === "ping") {
          await sock.sendMessage(jid, { text: "pong 🔥 bot aktif!" });
          return;
        }

        if (cmd === "order") {
          await sock.sendMessage(jid, {
            text: "✅ Halo kak! Orderan kamu sedang diproses ya 🤝",
          });
          return;
        }

        // ====== WELCOME (OWNER ONLY SET/DEL) ======
        if (!db.welcome) db.welcome = {};

        if (cmd === "welcome") {
          const w = db.welcome[jid];
          await sock.sendMessage(jid, {
            text: w ? `👋 Welcome kamu:\n"${w}"` : "Belum ada welcome. (Owner bisa set: setwelcome <pesan>)",
          });
          return;
        }

        if (cmd === "setwelcome") {
          if (!ownerUser) return rejectNotOwner(sock, jid);
          if (!args) {
            await sock.sendMessage(jid, {
              text: "Format: setwelcome <pesan>\nContoh: setwelcome Halo kak 👋",
            });
            return;
          }
          db.welcome[jid] = args;
          saveDB(db);
          await sock.sendMessage(jid, { text: `✅ Welcome disimpan:\n"${args}"` });
          return;
        }

        if (cmd === "delwelcome") {
          if (!ownerUser) return rejectNotOwner(sock, jid);
          delete db.welcome[jid];
          saveDB(db);
          await sock.sendMessage(jid, { text: "🗑️ Welcome dihapus." });
          return;
        }

        // ====== LIST SYSTEM ======
        const userList = getUserList(db, jid);

        if (cmd === "list") {
          await sock.sendMessage(jid, { text: formatList(userList) });
          return;
        }

        if (cmd === "addlist") {
          if (!ownerUser) return rejectNotOwner(sock, jid);

          if (!args) {
            await sock.sendMessage(jid, {
              text: "Format: addlist <item>\nContoh: addlist Netflix",
            });
            return;
          }
          userList.push({ text: args, ts: Date.now() });
          saveDB(db);
          await sock.sendMessage(jid, {
            text: `✅ Ditambahin: *${args}*\n\n${formatList(userList)}`,
          });
          return;
        }

        if (cmd === "dellist") {
          if (!ownerUser) return rejectNotOwner(sock, jid);

          const n = parseInt(args, 10);
          if (!n || n < 1 || n > userList.length) {
            await sock.sendMessage(jid, {
              text: "Format: dellist <nomor>\nContoh: dellist 2",
            });
            return;
          }
          const removed = userList.splice(n - 1, 1)[0];
          saveDB(db);
          await sock.sendMessage(jid, {
            text: `🗑️ Dihapus: *${removed.text}*\n\n${formatList(userList)}`,
          });
          return;
        }

        if (cmd === "clearlist") {
          if (!ownerUser) return rejectNotOwner(sock, jid);

          db.lists[jid] = [];
          saveDB(db);
          await sock.sendMessage(jid, { text: "🧹 List udah dikosongin." });
          return;
        }

        // ====== AUTO WELCOME (OPSIONAL) ======
        // Kalau kamu gak mau auto, hapus blok ini.
        const hiWords = ["hi", "hii", "halo", "hallo", "assalamualaikum", "p"];
        if (hiWords.includes(cmd)) {
          const w = db.welcome[jid];
          if (w) await sock.sendMessage(jid, { text: w });
          return;
        }

      } catch (err) {
        console.log("Error baca pesan:", err?.message || err);
      }
    });

  } catch (err) {
    console.log("Start error:", err?.message || err);
    setTimeout(startWA, 3000);
  }
}

startWA();
