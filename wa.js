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

// =================================================================
// KONFIGURASI
// =================================================================
const SPREADSHEET_ID = "1qUkDrgWdqXrqN661OF8SjIRdOeOBQYZoS-9vzjxllv4";
const GEMINI_API_KEY = "AQ.Ab8RN6IzFstx5G2VOW1ABVgNq8Hg9gzc1_r2xR4ZI323JoWqMA"; 
const NOMOR_BOT = "6282260991400"; 

const serviceAccount = require("./botkeuanganwa-498112-291d9b26247d.json");
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const statusReset = {}; 
let terakhirPairingCode = null;
let botTerhubung = false;

// ... (Fungsi getSheet, dapatkanRespon, analisisPesanDenganAI, fallbackParsingLokal, buatLaporanKeuangan, hapusTransaksiTerakhir, resetSeluruhData, simpanKeSheet tetap sama seperti kode Anda sebelumnya) ...

// =================================================================
// SYSTEM CORE (MODIFIKASI TANPA SECURITY WALL)
// =================================================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session_pencatatan_baru");
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, 
        auth: state,
        logger: require("pino")({ level: "silent" }),
        browser: ['Mac OS', 'Chrome', '124.0.0.0']
    });

    sock.ev.on("creds.update", saveCreds);

    // ... (Logika Pairing Code sama seperti sebelumnya) ...

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        
        // Log untuk memastikan pesan masuk ke bot
        console.log(`📩 Pesan masuk dari ${from}: ${text}`);

        // [BATASAN NOMOR DIHAPUS] - Bot akan memproses pesan dari siapa saja
        const pesan = text.toLowerCase().trim();
        await sock.sendPresenceUpdate("composing", from);

        // ... (Masukkan logika menu, rekap, AI, dll. di sini seperti kode Anda sebelumnya) ...
        
        // Contoh penanganan pesan
        if (pesan === "ping") {
            return sock.sendMessage(from, { text: "Bot aktif dan siap menerima perintah!" });
        }
        
        // Panggil fungsi analisis AI atau fitur lainnya...
    });
}

// ... (Bagian Server Web UI sama seperti sebelumnya) ...

startBot();
