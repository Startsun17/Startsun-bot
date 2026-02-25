import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import pino from "pino";
import express from "express";

const logger = pino({ level: "silent" });

/* ===== SERVER UNTUK RAILWAY ===== */
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Startsun Bot aktif 🚀");
});

app.listen(PORT, () => {
  console.log("Web server jalan di port", PORT);
});
/* ================================ */

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger,
    auth: state,
    version,
    browser: ["Startsun-bot", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp(), 2000);
      }
    }

    if (connection === "open") {
      console.log("✅ Bot berhasil connect!");
    }
  });

  // ===== PAIRING CODE TANPA QR =====
  if (!sock.authState?.creds?.registered) {
    const phoneNumber = "6281938301975";
    const code = await sock.requestPairingCode(phoneNumber);
    console.log("=================================");
    console.log("Kode pairing kamu:", code);
    console.log("=================================");
  }

  // ===== AUTO REPLY =====
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;
    if (msg.key.fromMe) return;

    const from = msg.key.remoteId;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    const body = text.toLowerCase();

    if (body === "ping") {
      await sock.sendMessage(from, { text: "pong 🏓 Bot aktif!" });
    }

    if (body === "order") {
      await sock.sendMessage(from, {
        text: "🌷 Halo kak! Orderan kamu sedang diproses ya 💛✨"
      });
    }
  });
}

connectToWhatsApp();
