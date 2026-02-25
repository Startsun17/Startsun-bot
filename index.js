import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys"
import pino from "pino"
import qrcode from "qrcode-terminal"

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session")

  const sock = makeWASocket({
    logger: pino({ level: "silent" }),
    auth: state
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", (update) => {
    const { connection, qr } = update

    if (qr) {
      console.log("Scan QR ini ya:")
      qrcode.generate(qr, { small: true })
    }

    if (connection === "open") {
      console.log("Bot berhasil connect 🔥")
    }
  })

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0]
    if (!msg.message) return

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text
    const from = msg.key.remoteJid

    if (text === "ping") {
      await sock.sendMessage(from, { text: "pong 🏓 Bot aktif!" })
    }

    if (text === "order") {
      await sock.sendMessage(from, { 
        text: "🌷 Halo kak! Orderan kamu sedang diproses ya 💛✨" 
      })
    }
  })
}

startBot()
