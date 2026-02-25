import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import express from "express";

const app = express();
app.get("/", (_, res) => res.send("Bot aktif"));
app.listen(process.env.PORT || 8080, () =>
  console.log("Web server ready")
);

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

    if (connection === "connecting") {
      console.log("⏳ Connecting to WhatsApp...");
    }

    if (connection === "open") {
      console.log("✅ Connected!");
    }

    if (connection === "close") {
      console.log("❌ Closed, reconnecting...");
      setTimeout(start, 3000);
    }
  });

  // 🔥 DELAY REQUEST PAIRING 5 DETIK (BIAR STABIL)
  if (!state.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log("=================================");
        console.log("PAIRING CODE:", code);
        console.log("Masuk WA → Perangkat tertaut → Tautkan → Tautkan dengan nomor telepon");
        console.log("=================================");
      } catch (err) {
        console.log("Gagal minta pairing:", err?.message);
      }
    }, 5000);
  }
}

start();
