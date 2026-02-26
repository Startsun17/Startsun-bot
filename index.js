import express from "express";
import pino from "pino";
import QRCode from "qrcode";

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";

const app = express();
const PORT = process.env.PORT || 8080;

let sock = null;
let lastQr = null;
let waStatus = "starting"; // starting | qr | connected | disconnected

// ===== WEB ROUTES =====
app.get("/", (req, res) => {
  res.json({
    ok: true,
    status: waStatus,
    qrEndpoint: "/qr",
    tips: "Buka /qr untuk scan QR dari WhatsApp > Perangkat tertaut > Tautkan perangkat",
  });
});

app.get("/qr", async (req, res) => {
  try {
    if (!lastQr) {
      return res
        .status(404)
        .send("QR belum tersedia. Tunggu beberapa detik lalu refresh /qr");
    }

    // bikin PNG biar jelas
    const pngBuffer = await QRCode.toBuffer(lastQr, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 10,
      width: 520,
    });

    res.setHeader("Content-Type", "image/png");
    res.send(pngBuffer);
  } catch (err) {
    res.status(500).send("Gagal generate QR: " + (err?.message || err));
  }
});

app.get("/health", (req, res) => res.send("OK"));

app.listen(PORT, () => {
  console.log("Web server ready di port", PORT);
  console.log("QR tersedia di endpoint /qr");
});

// ===== WHATSAPP START =====
async function startWA() {
  try {
    waStatus = "starting";

    const { state, saveCreds } = await useMultiFileAuthState("session");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      logger: pino({ level: "silent" }),
      auth: state,
      version,
      printQRInTerminal: false, // kita pakai /qr aja
      browser: ["Startsun-bot", "Chrome", "1.0.0"],
    });

    // simpan session tiap update
    sock.ev.on("creds.update", saveCreds);

    // status koneksi + qr
    sock.ev.on("connection.update", (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        lastQr = qr;
        waStatus = "qr";
        console.log("QR baru tersedia. Buka /qr untuk scan.");
      }

      if (connection === "open") {
        lastQr = null;
        waStatus = "connected";
        console.log("✅ Bot berhasil connect!");
      }

      if (connection === "close") {
        waStatus = "disconnected";

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log("❌ Koneksi putus. code:", statusCode, "| reconnect:", shouldReconnect);

        if (shouldReconnect) {
          setTimeout(startWA, 3000);
        } else {
          console.log("⚠️ Logged out. Hapus folder 'session' lalu deploy ulang dan scan QR lagi.");
        }
      }
    });

    // ===== HANDLER PESAN MASUK =====
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

        const body = text.trim().toLowerCase();
        if (!body) return;

        console.log("Pesan masuk:", body, "dari:", jid);

        // command contoh
         {
          await sock.sendMessage(jid, { text: "pong 🔥 bot aktif!" });
          return;
        }

         {
          await sock.sendMessage(jid, {
            text: "✅ Halo kak! Orderan kamu sedang diproses ya 🤝",
          });
          return;
        }
        const commands = {
  ping: "pong 🔥 bot aktif!",
  order: "✅ Halo kak! Orderan kamu sedang diproses ya 🤝",
  menu: "📋 *MENU*\n\n• ping\n• order\n• menu"
};

if (commands[body]) {
  await sock.sendMessage(jid, { text: commands[body] });
  return;
}

        // default: opsional
        // await sock.sendMessage(jid, { text: "Ketik: ping / order" });
      } catch (err) {
        console.log("Error baca pesan:", err?.message || err);
      }
    });
  } catch (err) {
    waStatus = "disconnected";
    console.log("Start error:", err?.message || err);
    setTimeout(startWA, 3000);
  }
}

startWA();
