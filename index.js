import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";

import pino from "pino";
import express from "express";

const app = express();
app.get("/", (_, res) => res.send("Bot aktif"));
app.listen(process.env.PORT || 8080, () => {
  console.log("Web server ready");
});

const logger = pino({ level: "silent" });
const PHONE_NUMBER = "6281938301975";

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger,
    auth: state,
    version,
    browser: ["Startsun-bot", "Chrome", "1.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (!state.creds.registered) {
      try {
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log("=================================");
        console.log("PAIRING CODE:", code);
        console.log("Masuk WA → Perangkat tertaut → Tautkan → Tautkan dengan nomor telepon");
        console.log("=================================");
      } catch (err) {
        console.log("Gagal minta pairing:", err?.message);
      }
    }

    if (connection === "open") {
      console.log("✅ CONNECTED");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        setTimeout(start, 2000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message) return;
    if (msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (text.toLowerCase() === "ping") {
      await sock.sendMessage(from, { text: "pong 🏓 Bot aktif!" });
    }
  });
}

start();
