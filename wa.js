const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { GoogleGenerativeAI } = require('@google/genai');
const pino = require('pino');

// KONFIGURASI - Isi sesuai data Anda
const SPREADSHEET_ID = '1qUkDrgWdqXrqN661OF8SjIRdOeOBQYZoS-9vzjxllv4';
const GEMINI_API_KEY = 'AQ.Ab8RN6IzFstx5G2VOW1ABVgNq8Hg9gzc1_r2xR4ZI323JoWqMA';
const NOMOR_AKSES = '6285779381664@s.whatsapp.net'; // Nomor Anda

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        // 1. Fitur Parsing Keuangan
        // Regex diperbaiki di sini agar tidak error
        const regex = /(\d+)\s*(k|jt|juta)?/i;
        const match = text.match(regex);

        if (match && sender === NOMOR_AKSES) {
            let nominal = parseInt(match[1]);
            if (match[2]) {
                if (match[2].toLowerCase() === 'k') nominal *= 1000;
                if (match[2].toLowerCase().includes('jt')) nominal *= 1000000;
            }

            // 2. Integrasi Google Sheets
            try {
                const serviceAccountAuth = new JWT({
                    keyFile: './botkeuanganwa-498112-291d9b26247d.json',
                    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                });
                const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
                await doc.loadInfo();
                const sheet = doc.sheetsByIndex[0];
                await sheet.addRow({ Tanggal: new Date().toLocaleDateString(), Nominal: nominal, Keterangan: text });
                await sock.sendMessage(sender, { text: `✅ Berhasil mencatat: Rp ${nominal.toLocaleString()}` });
            } catch (err) {
                await sock.sendMessage(sender, { text: "❌ Gagal mencatat ke Google Sheet." });
            }
        }
    });

    sock.ev.on('connection.update', (update) => {
        if (update.connection === 'close') {
            if (update.lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
        } else if (update.connection === 'open') {
            console.log('Bot Keuangan Aktif!');
        }
    });
}

startBot();
