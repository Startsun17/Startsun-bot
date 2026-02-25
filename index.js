import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import express from "express";

const app = express();
app.get("/", (_, res) => res.send("OK"));
app.listen(process.env.PORT || 8080, () => console.log("Web server ready"));

const logger = pino({ level: "silent" });

// NOMOR WA kamu (wajib format 62 + nomor tanpa 0 depan)
const PHONE_NUMBER = "6281938301975";

let pairingRequested = false;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger,
    auth: state,
    version,
    browser: ["Startsun-bot", "Chrome", "1.0.0"],
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const code = u?.lastDisconnect?.error?.output?.statusCode;
    const reason = u?.lastDisconnect?.error;

    if (u.connection === "open") {
      console.log("✅ CONNECTED");
    }

    // ✅ REQUEST PAIRING CODE SEKALI SAJA (INI KUNCI!)
    if (!pairingRequested && !sock.authState.creds.registered) {
      pairingRequested = true;
      try {
        // kasih jeda biar socket stabil dulu
        await new Promise((r) => setTimeout(r, 1500));
        const pairCode = await sock.requestPairingCode(PHONE_NUMBER);

        console.log("=================================");
        console.log("PAIRING CODE:", pairCode);
        console.log("WA -> Perangkat tertaut -> Tautkan -> 'Tautkan dengan nomor telepon'");
        console.log("=================================");
      } catch (e) {
        pairingRequested = false; // biar bisa coba lagi setelah restart
        console.log("❌ Gagal minta pairing code:", e?.message || e);
      }
    }

    if (u.connection === "close") {
      console.log("❌ CLOSED. status:", code, "msg:", reason?.message);

      const shouldReconnect =
        code !== DisconnectReason.loggedOut &&
        code !== 401;

      if (shouldReconnect) {
        console.log("🔁 Reconnecting in 2s...");
        setTimeout(start, 2000);
      } else {
        console.log("⚠️ Logged out / session invalid. Hapus folder 'session' lalu deploy ulang.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg?.message) return;
    if (msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    const body = text.trim().toLowerCase();

    if (body === "ping") {
      await sock.sendMessage(from, { text:
