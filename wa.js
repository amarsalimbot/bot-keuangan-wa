const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');

// KONFIGURASI
const SPREADSHEET_ID = '1qUkDrgWdqXrqN661OF8SjIRdOeOBQYZoS-9vzjxllv4';
const GEMINI_API_KEY = 'AQ.Ab8RN6IzFstx5G2VOW1ABVgNq8Hg9gzc1_r2xR4ZI323JoWqMA';
const NOMOR_AKSES = '6285779381664@s.whatsapp.net';
const NOMOR_BOT = '6282260991400'; // Nomor yang digunakan untuk pairing

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        // Ini bagian penting untuk Pairing Code
        browser: ["Chrome", "Windows", "1.0.0"]
    });

    // Fitur Pairing Code
    if (!sock.authState.creds.registered) {
        const phoneNumber = NOMOR_BOT.replace(/[^0-9]/g, '');
        setTimeout(async () => {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(`\n================================`);
            console.log(`PAIRING CODE ANDA: ${code}`);
            console.log(`================================\n`);
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        // 1. Parsing Keuangan
        const regex = /(\d+)\s*(k|jt|juta)?/i;
        const match = text.match(regex);

        if (match && sender === NOMOR_AKSES) {
            let nominal = parseInt(match[1]);
            if (match[2]) {
                const satuan = match[2].toLowerCase();
                if (satuan === 'k') nominal *= 1000;
                if (satuan === 'jt' || satuan === 'juta') nominal *= 1000000;
            }

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
        // 2. AI Gemini
        else if (sender === NOMOR_AKSES) {
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent(text);
                await sock.sendMessage(sender, { text: result.response.text() });
            } catch (err) {
                console.error("AI Error:", err);
            }
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'close') {
            startBot();
        } else if (connection === 'open') {
            console.log('Bot Keuangan Aktif!');
        }
    });
}

startBot();
