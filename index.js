import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import express from "express";

const PHONE_NUMBER = "6281938301975"; // tanpa 0 depan, tanpa +

const app = express();
app.get("/", (_, res) => res.send("Bot aktif"));
app.listen(process.env.PORT || 8080, () => console.log("Web server ready"));

const logger = pino({ level: "silent" });

let pairingRequested = false;

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

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect } = u;

    if (connection === "connecting") console.log("⏳ Connecting to WhatsApp...");
    if (connection === "open") console.log("✅ Connected!");

    // Minta pairing code hanya 1x dan hanya kalau belum terdaftar
    if (!state.creds.registered && !pairingRequested) {
      pairingRequested = true;

      // tunggu stabil dulu
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(PHONE_NUMBER);
          console.log("=================================");
          console.log("PAIRING CODE:", code);
          console.log("WA → Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon");
          console.log("=================================");
        } catch (e) {
          pairingRequested = false; // biar bisa coba lagi
          console.log("❌ Gagal minta pairing:", e?.message);
        }
      }, 4000);
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;

      console.log("❌ Closed. status:", code, "reconnect:", shouldReconnect);

      // jangan reconnect ngebut (biar gak bikin kode “ketimpa”)
      if (shouldReconnect) setTimeout(start, 6000);
      else console.log("⚠️ Logged out. Hapus folder 'session' lalu deploy lagi.");
    }
  });
}

start();
