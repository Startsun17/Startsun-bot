import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import express from "express";
import QRCode from "qrcode";

const logger = pino({ level: "silent" });

const PORT = process.env.PORT || 8080;

/**
 * WA_NUMBER:
 * - isi nomor WA kamu format internasional TANPA + dan TANPA spasi
 * - contoh Indonesia: 6281234567890
 *
 * Kalau WA_NUMBER diisi -> bot akan minta PAIRING CODE (lebih gampang, ga perlu scan barcode).
 * Kalau WA_NUMBER kosong -> bot akan pakai QR (tapi kita sediain link /qr biar QR-nya jelas).
 */
const WA_NUMBER = (process.env.WA_NUMBER || "").replace(/\D/g, "");

// Simpan QR terakhir biar bisa ditampilin di /qr
let lastQrString = null;

async function startBot() {
  const app = express();

  // Halaman utama
  app.get("/", (req, res) => {
    res.type("html").send(`
      <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
        <body style="font-family: Arial;
