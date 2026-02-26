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

// ================== WEB SERVER ==================
const app = express();
const PORT = process.env.PORT || 8080;

let lastQr = null;

app.get("/", (req, res) => {
  res.send("OK ✅ Startsun-bot jalan. Buka /qr untuk scan barcode.");
});

app.get("/qr", async (req, res) => {
  try {
    if (!lastQr) return res.status(404).send("QR belum tersedia. Tunggu lalu refresh /qr");
    const img = await QRCode.toBuffer(lastQr, { width: 520, margin: 2 });
    res.setHeader("Content-Type", "image/png");
    res.send(img);
  } catch (e) {
    res.status(500).send("Gagal generate QR");
  }
});

app.listen(PORT, () => console.log("Web server ready di port", PORT));

// ================== PERSISTENT DB ==================
// Biar gak ilang: pasang Railway Volume ke /data
const DATA_DIR = process.env.DATA_DIR || "/data";
const DATA_FILE = path.join(DATA_DIR, "data.json");

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

function loadDB() {
  ensureDataDir();
  try {
    if (!fs.existsSync(DATA_FILE)) return { lists: {}, welcome: {} };
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return { lists: {}, welcome: {} };
  }
}

function saveDB(db) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function getUserList(db, jid) {
  if (!db.lists) db.lists = {};
  if (!db.lists[jid]) db.lists[jid] = [];
  return db.lists[jid];
}

function formatList(list) {
  if (!list || list.length === 0) {
    return "📭 List kamu kosong.\n\nKetik: addlist <item>\nContoh: addlist Netflix";
  }
  const lines = list.map((x, i) => `${i + 1}. ${x.text}`);
  return `📌 *LIST KAMU*\n\n${lines.join("\n")}\n\n• addlist <item>\n• dellist <nomor>\n• clearlist`;
}

function formatMenu() {
  return (
    "📋 *MENU*\n\n" +
    "• ping\n" +
    "• order\n" +
    "• menu\n" +
    "• addlist <item>\n" +
    "• list\n" +
    "• dellist <nomor>\n" +
    "• clearlist\n" +
    "• setwelcome <pesan>\n" +
    "• welcome\n" +
    "• delwelcome"
  );
}

// ================== WHATSAPP BOT ==================
const logger = pino({ level: "silent" });

async function startWA() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("session");
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
        console.log("QR baru tersedia. Buka /qr untuk scan.");
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
        else console.log("⚠️ Logged out. Hapus folder 'session' lalu deploy ulang dan scan QR lagi.");
      }
    });

    // ================== HANDLER PESAN (CUMA 1 INI) ==================
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        if (type !== "notify") return;

        const msg = messages?.[0];
        if (!msg?.message) return;
        if (msg.key.fromMe) return;

        const jid = msg.key.remoteJid;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          "";

        if (!text) return;

        // prefix fleksibel: .menu, !menu, #menu, menu
        const cleaned = text.trim().toLowerCase().replace(/^[.!#]/, "");
        const [cmdRaw, ...rest] = cleaned.split(/\s+/);
        const cmd = (cmdRaw || "").trim();
        const args = rest.join(" ").trim();

        const db = loadDB();
        const userList = getUserList(db, jid);
        if (!db.welcome) db.welcome = {};

        // ====== WELCOME ======
        if (cmd === "setwelcome") {
          if (!args) {
            await sock.sendMessage(jid, { text: "Format: setwelcome <pesan>\nContoh: setwelcome Halo kak 👋" });
            return;
          }
          db.welcome[jid] = args;
          saveDB(db);
          await sock.sendMessage(jid, { text: `✅ Welcome disimpan:\n"${args}"` });
          return;
        }

        if (cmd === "welcome") {
          const w = db.welcome[jid];
          await sock.sendMessage(jid, { text: w ? `👋 Welcome kamu:\n"${w}"` : "Kamu belum set welcome.\nKetik: setwelcome <pesan>" });
          return;
        }

        if (cmd === "delwelcome") {
          delete db.welcome[jid];
          saveDB(db);
          await sock.sendMessage(jid, { text: "🗑️ Welcome kamu dihapus." });
          return;
        }

        // ====== LIST ======
        if (cmd === "addlist") {
          if (!args) {
            await sock.sendMessage(jid, { text: "Format: addlist <item>\nContoh: addlist Netflix" });
            return;
          }
          userList.push({ text: args, ts: Date.now() });
          saveDB(db);
          await sock.sendMessage(jid, { text: `✅ Ditambahin: *${args}*\n\n${formatList(userList)}` });
          return;
        }

        if (cmd === "list") {
          await sock.sendMessage(jid, { text: formatList(userList) });
          return;
        }

        if (cmd === "dellist") {
          const n = parseInt(args, 10);
          if (!n || n < 1 || n > userList.length) {
            await sock.sendMessage(jid, { text: "Format: dellist <nomor>\nContoh: dellist 2" });
            return;
          }
          const removed = userList.splice(n - 1, 1)[0];
          saveDB(db);
          await sock.sendMessage(jid, { text: `🗑️ Dihapus: *${removed.text}*\n\n${formatList(userList)}` });
          return;
        }

        if (cmd === "clearlist") {
          db.lists[jid] = [];
          saveDB(db);
          await sock.sendMessage(jid, { text: "🧹 List kamu udah dikosongin." });
          return;
        }

        // ====== BASIC COMMANDS ======
        if (cmd === "menu" || cmd === "help") {
          await sock.sendMessage(jid, { text: formatMenu() });
          return;
        }

        if (cmd === "ping") {
          await sock.sendMessage(jid, { text: "pong 🔥 bot aktif!" });
          return;
        }

        if (cmd === "order") {
          await sock.sendMessage(jid, { text: "✅ Halo kak! Orderan kamu sedang diproses ya 🤝" });
          return;
        }

        // ====== OPTIONAL AUTO-WELCOME (kalau user ngetik "hi/hallo") ======
        // Kalau kamu gak mau auto, hapus blok ini
        if (["hi", "hii", "halo", "hallo", "assalamualaikum", "p"].includes(cmd)) {
          const w = db.welcome[jid];
          if (w) await sock.sendMessage(jid, { text: w });
          return;
        }
      } catch (err) {
        console.log("Error baca pesan:", err);
      }
    });
  } catch (err) {
    console.log("Start error:", err?.message || err);
    setTimeout(startWA, 3000);
  }
}

startWA();
