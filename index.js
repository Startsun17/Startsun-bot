import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import pino from "pino";
import express from "express";
import QRCode from "qrcode";

const PORT = process.env.PORT || 8080;
let lastQr = null;

const app = express();

app.get("/", (req, res) => {
  res.send("Bot aktif. Buka /qr untuk scan.");
});

app.get("/qr", async (req, res) => {
  if (!lastQr) {
    return res.send("QR belum tersedia, refresh lagi.");
  }
  const qrImage = await QRCode.toBuffer(lastQr);
  res.setHeader("Content-Type", "image/png");
  res.send(qrImage);
});

app.listen(PORT, () => {
  console.log("Web server ready di port", PORT);
});

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger: pino({ level: "silent" }),
    auth: state,
    version,
    browser: ["Startsun-bot", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      lastQr = qr;
      console.log("QR tersedia di endpoint /qr");
    }

    if (connection === "open") {
      lastQr = null;
      console.log("Bot berhasil connect!");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        setTimeout(start, 3000);
      }
    }
  });
}

start();
