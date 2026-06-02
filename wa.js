const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    delay
} = require("@whiskeysockets/baileys");

const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { GoogleGenAI } = require("@google/genai"); 
const http = require("http");
const pino = require("pino");

// =================================================================
// KONFIGURASI
// =================================================================
const SPREADSHEET_ID = "1qUkDrgWdqXrqN661OF8SjIRdOeOBQYZoS-9vzjxllv4";
const GEMINI_API_KEY = "AQ.Ab8RN6IzFstx5G2VOW1ABVgNq8Hg9gzc1_r2xR4ZI323JoWqMA"; 
const NOMOR_BOT = "6282260991400";
const NOMOR_AKSES_EKSKLUSIF = "6285779381664";

const serviceAccount = require("./botkeuanganwa-498112-291d9b26247d.json");
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const statusReset = {}; 
let terakhirPairingCode = null;
let botTerhubung = false;

// =================================================================
// FUNGSI LOGIKA (GOOGLE SHEET & AI)
// =================================================================
async function getSheet() {
    const formattedKey = serviceAccount.private_key.replace(/\\n/g, '\n');
    const auth = new JWT({ email: serviceAccount.client_email, key: formattedKey, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
    await doc.loadInfo();
    return doc.sheetsByIndex[0];
}

async function analisisPesanDenganAI(teksUser) {
    try {
        const prompt = `Anda adalah kasir pintar. Analisis: "${teksUser}". 
        Jika transaksi, beri JSON: {"is_transaksi": true, "jenis": "Pemasukan"/"Pengeluaran", "nominal": angka, "kategori": "...", "keterangan": "...", "tanggal": "DD/MM/YYYY"}. 
        Jika bukan, is_transaksi: false. Tanpa markdown.`;
        const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
        return JSON.parse(response.text.replace(/```json/g, "").replace(/```/g, "").trim());
    } catch (e) { return { is_transaksi: false }; }
}

async function buatLaporanKeuangan(tipe) {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    let totalMasuk = 0, totalKeluar = 0;
    rows.forEach(row => {
        const jenis = String(row.get("Jenis")).toLowerCase();
        const nominal = Number(row.get("Nominal") || 0);
        if (jenis === "pemasukan") totalMasuk += nominal; else totalKeluar += nominal;
    });
    return { totalMasuk, totalKeluar, saldo: totalMasuk - totalKeluar };
}

// =================================================================
// CORE BOT (PAIRING CODE)
// =================================================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session_pencatatan_baru");
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, auth: state, logger: pino({ level: "silent" }),
        browser: ['BotKeuangan', 'Chrome', '1.0.0'], printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            let code = await sock.requestPairingCode(NOMOR_BOT);
            terakhirPairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`🔑 PAIRING CODE: ${terakhirPairingCode}`);
        }, 5000);
    }

    sock.ev.on("connection.update", (u) => { if (u.connection === "open") botTerhubung = true; });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        if (!from.includes(NOMOR_AKSES_EKSKLUSIF)) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const pesan = text.toLowerCase().trim();

        if (/^(menu|p)$/.test(pesan)) {
            await sock.sendMessage(from, { text: "🤖 *Bot Keuangan Aktif*\n- #hari / #bulan (Laporan)\n- #undo (Hapus terakhir)\n- #reset (Hapus data)\n- Ketik transaksi (contoh: Nasi 25k)" });
        } else if (pesan.startsWith("#")) {
            const lap = await buatLaporanKeuangan(pesan.replace("#", ""));
            await sock.sendMessage(from, { text: `📊 Laporan ${pesan}:\nMasuk: Rp${lap.totalMasuk}\nKeluar: Rp${lap.totalKeluar}\nSaldo: Rp${lap.saldo}` });
        } else if (pesan === "#undo") {
            const sheet = await getSheet();
            const rows = await sheet.getRows();
            if (rows.length > 0) { await rows[rows.length - 1].delete(); await sock.sendMessage(from, { text: "↩️ Transaksi terakhir dihapus." }); }
        } else if (pesan === "#reset") {
            const sheet = await getSheet();
            await sheet.clearRows();
            await sock.sendMessage(from, { text: "🗑️ Data berhasil direset." });
        } else {
            const dataAi = await analisisPesanDenganAI(text);
            if (dataAi.is_transaksi) {
                const sheet = await getSheet();
                await sheet.addRow({ Tanggal: dataAi.tanggal, Jenis: dataAi.jenis, Nominal: dataAi.nominal, Kategori: dataAi.kategori, Keterangan: dataAi.keterangan });
                await sock.sendMessage(from, { text: `✅ Berhasil mencatat ${dataAi.jenis} Rp${dataAi.nominal}` });
            }
        }
    });
}

// Web Server untuk Pairing Code
http.createServer((req, res) => res.end(terakhirPairingCode ? `Kode: ${terakhirPairingCode}` : "Bot Loading...")).listen(7860);
startBot();
