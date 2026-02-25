import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";

const logger = pino({ level: "silent" }); // ubah ke "info" kalau mau lihat log rame

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger,
    printQRInTerminal: false, // kita handle QR manual biar pasti muncul
    auth: state,
    version,
    browser: ["Startsun-bot", "Chrome", "1.0.0"],
  });

  // simpan session tiap update
  sock.ev.on("creds.update", saveCreds);

  // koneksi update (QR / reconnect / close)
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("Scan QR ini ya:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ Bot berhasil connect!");
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;

      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log("❌ Koneksi putus. Code:", code, "| Reconnect:", shouldReconnect);

      if (shouldReconnect) {
        // tunggu bentar biar nggak spam reconnect
        setTimeout(() => connectToWhatsApp(), 2000);
      } else {
        console.log("⚠️ Logged out. Hapus folder 'session' lalu scan QR ulang.");
      }
    }
  });

  // handler pesan masuk
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const msg = messages?.[0];
    if (!msg?.message) return;
    if (msg.key.fromMe) return;

    const from = msg.key.remoteJid;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      "";

    const body = text.trim().toLowerCase();
    if (!body) return;

    // COMMANDS
    if (body === "ping") {
      await sock.sendMessage(from, { text: "pong 🏓 Bot aktif!!" });
      return;
    }

    if (body === "order") {
      await sock.sendMessage(from, {
        text: "🛒 Halo kak! Orderan kamu sedang diproses ya 🙌✨",
      });
      return;
    }

    if (body === "menu") {
      await sock.sendMessage(from, {
        text:
          "📌 *Menu Startsun-bot*\n" +
          "- ping\n" +
          "- order\n" +
          "- menu\n",
      });
      return;
    }
  });

  return sock;
}

// START
connectToWhatsApp();
