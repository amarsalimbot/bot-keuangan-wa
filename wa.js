const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { GoogleGenAI } = require("@google/genai");
const pino = require("pino");
const http = require("http");

// =================================================================
// KONFIGURASI UTAMA
// =================================================================
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const WHATSAPP_PHONE_NUMBER = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\D/g, "");
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

const APP_TIMEZONE = "Asia/Makassar";
const PORT = process.env.PORT || 3000;

if (!SPREADSHEET_ID) throw new Error("SPREADSHEET_ID belum diisi di Railway Variables.");
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY belum diisi di Railway Variables.");
if (!GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON belum diisi di Railway Variables.");

let serviceAccount;
try {
    serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
} catch (err) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON tidak valid. Isi harus JSON service account lengkap.");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const statusReset = {};
let sockGlobal = null;
let sedangStart = false;
let reconnectTimer = null;
let jumlahReconnect = 0;
let sudahStartKeepAlive = false;

// =================================================================
// HELPER
// =================================================================
const HEADER_TRANSAKSI = [
    "Tanggal",
    "Jenis",
    "Kategori",
    "Nominal",
    "Keterangan",
    "Dompet",
    "Saldo"
];

function tunggu(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatRupiah(angka) {
    return Number(angka || 0).toLocaleString("id-ID");
}

function ambilNomorDariJid(jid) {
    return String(jid || "")
        .split("@")[0]
        .replace(/\D/g, "");
}

async function ambilNomorWhatsApp() {
    const nomor = WHATSAPP_PHONE_NUMBER;

    if (!nomor || nomor.length < 10) {
        throw new Error("WHATSAPP_PHONE_NUMBER belum diisi. Contoh: 6281234567890");
    }

    return nomor;
}

function buatAuthGoogle() {
    const correctedPrivateKey = serviceAccount.private_key.replace(/\\n/g, "\n");

    return new JWT({
        email: serviceAccount.client_email,
        key: correctedPrivateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
}

async function getSheetByNomor(jid) {
    const nomor = ambilNomorDariJid(jid);

    if (!nomor) {
        throw new Error("Nomor WhatsApp tidak valid.");
    }

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, buatAuthGoogle());
    await doc.loadInfo();

    let sheet = doc.sheetsByTitle[nomor];

    if (!sheet) {
        console.log(`📄 Membuat sheet baru untuk nomor: ${nomor}`);

        sheet = await doc.addSheet({
            title: nomor,
            headerValues: HEADER_TRANSAKSI
        });

        console.log(`✅ Sheet ${nomor} berhasil dibuat.`);
        return sheet;
    }

    try {
        await sheet.loadHeaderRow();
        const headers = sheet.headerValues || [];
        const headerBelumLengkap = HEADER_TRANSAKSI.some(header => !headers.includes(header));

        if (headerBelumLengkap) {
            await sheet.setHeaderRow(HEADER_TRANSAKSI);
        }
    } catch (err) {
        await sheet.setHeaderRow(HEADER_TRANSAKSI);
    }

    return sheet;
}

// =================================================================
// COMMAND BOT
// =================================================================
const COMMANDS = {
    menu: /^(menu|help|bantuan|fitur|panduan|cara pakai)$/i,
    dompet: /^(dompet|cek dompet|rekening|akun|saldo dompet)$/i,
    budget: /^(budget|cek budget|anggaran|cek anggaran)$/i,
    riwayat: /^(riwayat|history|daftar transaksi|semua transaksi|transaksi terakhir)$/i,
    rekap: /^(hari ini|minggu ini|bulan ini|laporan hari ini|laporan minggu ini|laporan bulan ini)$/i,
    saldo: /^(saldo|laporan|rekap|total)$/i,
    undo: /^(batal|undo|hapus terakhir)$/i,
    reset: /^(#reset|reset data)$/i
};

function cocok(perintah, pesan) {
    return COMMANDS[perintah].test(pesan);
}

// =================================================================
// KEEP ALIVE RAILWAY
// =================================================================
function startKeepAliveServer() {
    const server = http.createServer((req, res) => {
        if (req.url === "/" || req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                status: "online",
                bot: sockGlobal ? "aktif_atau_mencoba_koneksi" : "belum_aktif",
                reconnect: jumlahReconnect,
                login_method: "pairing_code",
                time: new Date().toLocaleString("id-ID", { timeZone: APP_TIMEZONE })
            }));
            return;
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
    });

    server.listen(PORT, () => {
        console.log(`🌐 Keep-alive server aktif di port ${PORT}`);
    });

    setInterval(() => {
        console.log(`💓 Bot masih hidup: ${new Date().toLocaleString("id-ID", { timeZone: APP_TIMEZONE })}`);
    }, 5 * 60 * 1000);
}

function cleanupSocket() {
    try {
        if (sockGlobal?.ev?.removeAllListeners) {
            sockGlobal.ev.removeAllListeners("connection.update");
            sockGlobal.ev.removeAllListeners("messages.upsert");
            sockGlobal.ev.removeAllListeners("creds.update");
        }

        if (sockGlobal?.ws?.close) {
            sockGlobal.ws.close();
        }
    } catch (err) {
        console.log("⚠️ Cleanup socket dilewati:", err.message);
    }

    sockGlobal = null;
}

function jadwalkanReconnect(alasan = "koneksi terputus", jedaKhusus = null) {
    if (reconnectTimer) return;

    jumlahReconnect++;
    const jeda = jedaKhusus || Math.min(5000 + jumlahReconnect * 3000, 60000);

    console.log(`🔄 Reconnect karena ${alasan}. Coba lagi dalam ${jeda / 1000} detik...`);

    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        sedangStart = false;
        cleanupSocket();
        await startBot();
    }, jeda);
}

// =================================================================
// BATAS ANGGARAN
// =================================================================
const BUDGET_LIMITS = {
    "Konsumsi": 3000000,
    "Belanja": 1500000,
    "Transportasi": 800000,
    "Utilitas": 1000000,
    "Hiburan": 750000,
    "Anak & Keluarga": 2000000,
    "Kesehatan & Perawatan": 1000000,
    "Pakaian": 500000,
    "Tempat Tinggal": 1500000,
    "Edukasi & Buku": 500000,
    "Sosial & Sedekah": 500000,
    "Pajak": 1000000
};

// =================================================================
// RESPON BOT
// =================================================================
const dapatkanRespon = (kategori, data = {}) => {
    const listRespon = {
        vnDitolak: [
            "🎙️ *VN belum didukung.*\n\nTolong ketik lewat teks biasa dulu ya 🙏"
        ],
        suksesMencatat: [
            `${data.emoji} *DATA BERHASIL DICATAT!*\n\n` +
            `📌 *Jenis:* ${data.jenis}\n` +
            `🏷️ *Kategori:* ${data.kategori}\n` +
            `💰 *Nominal:* Rp ${data.nominal}\n` +
            `👛 *Dompet:* ${data.dompet.toUpperCase()}\n` +
            `📝 *Keterangan:* "${data.keterangan}"\n` +
            `📅 *Tanggal:* ${data.tanggal}\n\n` +
            `🧮 *Saldo Akhir ${data.dompet.toUpperCase()}:* Rp ${data.saldo_dompet}`
        ],
        suksesUtang: [
            `🧾 *CATATAN UTANG/PIUTANG BERHASIL!*\n\n` +
            `📌 *Tipe:* ${data.kategori}\n` +
            `📝 *Nama/Keterangan:* ${data.keterangan}\n` +
            `💰 *Nominal:* Rp ${data.nominal}\n` +
            `📅 *Tanggal:* ${data.tanggal}\n\n` +
            `⏰ Jangan lupa ditagih/dibayar tepat waktu ya.`
        ],
        suksesUndo: [
            `↩️ *TRANSAKSI TERAKHIR DIHAPUS!*\n\n` +
            `Aktivitas "${data.keterangan}" sebesar *Rp ${formatRupiah(data.nominal)}* sudah dibatalkan.`
        ],
        gagalUndo: [
            "📭 Tidak ada transaksi yang bisa dihapus. Riwayat kamu masih kosong."
        ],
        konfirmasiReset: [
            `⚠️ *KONFIRMASI RESET DATA*\n\n` +
            `Tindakan ini akan menghapus *SELURUH* riwayat keuangan kamu.\n\n` +
            `Kalau yakin, balas: *YA* atau *SETUJU*.`
        ],
        batalReset: [
            "✅ *Reset dibatalkan.* Data keuangan kamu tetap aman."
        ]
    };

    const opsi = listRespon[kategori] || ["✅ Baik, siap."];
    return opsi[Math.floor(Math.random() * opsi.length)];
};

// =================================================================
// AI PARSING
// =================================================================
async function analisisPesanDenganAI(teksUser) {
    try {
        const waktuSistem = new Date().toLocaleString("id-ID", { timeZone: APP_TIMEZONE });

        const prompt = `Kamu adalah sistem AI pencatat keuangan pribadi.

Informasi waktu sekarang: ${waktuSistem}

Tugas:
Analisis chat user dan ubah menjadi JSON transaksi.

Aturan:
1. Konversi uang:
- 25k = 25000
- 1.5jt = 1500000
- 2 juta = 2000000

2. Kategori wajib salah satu:
[Konsumsi, Transportasi, Utilitas, Belanja, Pakaian, Tempat Tinggal, Hiburan, Edukasi & Buku, Kesehatan & Perawatan, Anak & Keluarga, Sosial & Sedekah, Pendapatan, Bonus & Sampingan, Investasi & Tabungan, Pajak, Utang, Piutang, Lainnya]

Panduan:
- Konsumsi: makanan, minuman, kopi, restoran, camilan, gofood.
- Belanja: supermarket, pasar, sembako, kebutuhan dapur.
- Utilitas: listrik, air, wifi, pulsa, paket data, streaming.
- Tempat Tinggal: sewa, kos, kontrakan, cicilan rumah, renovasi.
- Anak & Keluarga: susu bayi, popok, mainan anak, uang keluarga.
- Investasi & Tabungan: emas, reksadana, saham, tabungan.
- Utang: user meminjam uang dari orang/bank. Jenis = Pemasukan.
- Piutang: user meminjamkan uang ke orang lain. Jenis = Pengeluaran.

3. Jenis hanya boleh:
- Pemasukan
- Pengeluaran

4. Dompet:
Deteksi cash, tunai, bca, mandiri, bri, bni, gopay, ovo, dana, shopeepay, spay.
Jika tidak disebut, isi "cash".

5. Tanggal:
Format wajib DD/MM/YYYY.
Jika tidak disebut, gunakan tanggal hari ini.

6. Kalau chat bukan transaksi, balas:
{"is_transaksi": false}

Kalimat user: "${teksUser}"

Balas HANYA JSON valid. Jangan pakai markdown.`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt
        });

        let mentah = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!mentah) throw new Error("Respon API Gemini kosong");

        mentah = mentah.replaceAll("```json", "").replaceAll("```", "").trim();

        const hasil = JSON.parse(mentah);

        if (!hasil.is_transaksi) return { is_transaksi: false };
        if (!hasil.nominal || Number(hasil.nominal) <= 0) return { is_transaksi: false };

        hasil.nominal = Math.round(Number(hasil.nominal));
        hasil.dompet = String(hasil.dompet || "cash").toLowerCase().trim();
        hasil.keterangan = String(hasil.keterangan || teksUser).trim();
        hasil.kategori = String(hasil.kategori || "Lainnya").trim();
        hasil.jenis = String(hasil.jenis || "Pengeluaran").trim();

        return hasil;
    } catch (error) {
        console.log("⚠️ [AI ERROR]: " + error.message + " -> Menggunakan fallback lokal.");
        return fallbackParsingLokal(teksUser);
    }
}

function fallbackParsingLokal(text) {
    const pesan = text.toLowerCase().trim();

    const match = pesan.match(/(\d+[\.,]?\d*)\s*(k|jt|juta)?/i);
    if (!match) return { is_transaksi: false };

    let nominal = parseFloat(match[1].replace(",", "."));

    if (match[2] === "k") nominal *= 1000;
    if (match[2] === "jt" || match[2] === "juta") nominal *= 1000000;

    let dompet = "cash";
    if (pesan.includes("bca")) dompet = "bca";
    if (pesan.includes("bri")) dompet = "bri";
    if (pesan.includes("bni")) dompet = "bni";
    if (pesan.includes("mandiri")) dompet = "mandiri";
    if (pesan.includes("gopay")) dompet = "gopay";
    if (pesan.includes("ovo")) dompet = "ovo";
    if (pesan.includes("dana")) dompet = "dana";
    if (pesan.includes("spay") || pesan.includes("shopeepay")) dompet = "shopeepay";

    const kataPemasukan = ["gaji", "bonus", "terima", "masuk", "dapat", "pendapatan", "income"];
    const jenis = kataPemasukan.some(kata => pesan.includes(kata)) ? "Pemasukan" : "Pengeluaran";

    let kategori = jenis === "Pemasukan" ? "Pendapatan" : "Lainnya";

    if (pesan.includes("makan") || pesan.includes("kopi") || pesan.includes("nasi") || pesan.includes("minum")) kategori = "Konsumsi";
    if (pesan.includes("bensin") || pesan.includes("grab") || pesan.includes("gojek") || pesan.includes("transport")) kategori = "Transportasi";
    if (pesan.includes("wifi") || pesan.includes("listrik") || pesan.includes("pulsa") || pesan.includes("data")) kategori = "Utilitas";
    if (pesan.includes("belanja") || pesan.includes("sembako") || pesan.includes("pasar")) kategori = "Belanja";
    if (pesan.includes("susu") || pesan.includes("anak") || pesan.includes("popok")) kategori = "Anak & Keluarga";
    if (pesan.includes("utang") || pesan.includes("pinjam")) kategori = "Utang";
    if (pesan.includes("piutang") || pesan.includes("meminjamkan")) kategori = "Piutang";
    if (pesan.includes("bonus")) kategori = "Bonus & Sampingan";

    const tanggal = new Date().toLocaleDateString("id-ID", {
        timeZone: APP_TIMEZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).replace(/\./g, "/");

    return {
        is_transaksi: true,
        jenis,
        nominal: Math.round(nominal),
        kategori,
        keterangan: text,
        dompet,
        tanggal
    };
}

// =================================================================
// LAPORAN DAN SHEET ACTION PER NOMOR
// =================================================================
async function buatLaporanKeuangan(tipe, jid) {
    const sheet = await getSheetByNomor(jid);
    const rows = await sheet.getRows();

    let totalMasuk = 0;
    let totalKeluar = 0;
    const detailKategori = {};
    const saldoDompet = {};
    const sekarang = new Date();

    for (const row of rows) {
        const tglStr = String(row.get("Tanggal") || "");
        if (!tglStr) continue;

        const [tglBagian] = tglStr.split(", ");
        const [hari, bulan, tahun] = tglBagian.split("/").map(Number);
        if (!hari || !bulan || !tahun) continue;

        const tglTransaksi = new Date(tahun, bulan - 1, hari);
        const selisihHari = (sekarang - tglTransaksi) / (1000 * 60 * 60 * 24);

        let valid = false;
        if (tipe === "hari" && selisihHari < 1 && tglTransaksi.getDate() === sekarang.getDate()) valid = true;
        if (tipe === "minggu" && selisihHari <= 7) valid = true;
        if (tipe === "bulan" && tglTransaksi.getMonth() === sekarang.getMonth() && tglTransaksi.getFullYear() === sekarang.getFullYear()) valid = true;
        if (tipe === "semua") valid = true;

        const jenis = String(row.get("Jenis") || "").toLowerCase().trim();
        const nominal = Number(row.get("Nominal") || 0);
        const kategori = String(row.get("Kategori") || "Lainnya");
        const dompet = String(row.get("Dompet") || "cash").toLowerCase().trim();

        if (!saldoDompet[dompet]) saldoDompet[dompet] = 0;

        if (jenis === "pemasukan") saldoDompet[dompet] += nominal;
        else saldoDompet[dompet] -= nominal;

        if (valid) {
            if (jenis === "pemasukan") {
                totalMasuk += nominal;
            } else {
                totalKeluar += nominal;
                detailKategori[kategori] = (detailKategori[kategori] || 0) + nominal;
            }
        }
    }

    return {
        totalMasuk,
        totalKeluar,
        saldo: totalMasuk - totalKeluar,
        detailKategori,
        saldoDompet
    };
}

async function ambilRiwayatTransaksi(limit = 15, jid) {
    const sheet = await getSheetByNomor(jid);
    const rows = await sheet.getRows();

    if (rows.length === 0) return "📭 *Riwayat transaksi masih kosong.*";

    let teks = `📋 *RIWAYAT TRANSAKSI TERBARU*\n`;
    teks += `_Menampilkan ${Math.min(limit, rows.length)} dari ${rows.length} transaksi terakhir_\n`;
    teks += `------------------------------------\n`;

    const mulai = rows.length - 1;
    const selesai = Math.max(0, rows.length - limit);

    for (let i = mulai; i >= selesai; i--) {
        const row = rows[i];
        const tglFull = String(row.get("Tanggal") || "00/00/0000, 00:00:00");
        const [tglOnly] = tglFull.split(", ");
        const jenis = String(row.get("Jenis") || "Pengeluaran").trim();
        const kategori = String(row.get("Kategori") || "Lainnya");
        const nominal = Number(row.get("Nominal") || 0);
        const keterangan = String(row.get("Keterangan") || "-");
        const dompet = String(row.get("Dompet") || "cash").toUpperCase();
        const simbol = jenis.toLowerCase() === "pemasukan" ? "🟢 +" : "🔴 -";

        teks += `\n🗓️ *[${tglOnly}]* ${keterangan}\n`;
        teks += `   ${simbol} *Rp ${formatRupiah(nominal)}* | ${kategori} | ${dompet}\n`;
    }

    teks += `\n------------------------------------\n📊 Ketik *hari ini*, *minggu ini*, atau *bulan ini* untuk rekap.`;
    return teks;
}

async function simpanKeSheet(dataAi, jid) {
    const sheet = await getSheetByNomor(jid);
    const laporanKini = await buatLaporanKeuangan("semua", jid);

    const dompetUser = String(dataAi.dompet || "cash").toLowerCase().trim();
    const saldoDompetLama = laporanKini.saldoDompet[dompetUser] || 0;

    const saldoDompetBaru = dataAi.jenis === "Pemasukan"
        ? saldoDompetLama + dataAi.nominal
        : saldoDompetLama - dataAi.nominal;

    const jam = new Date().toLocaleTimeString("id-ID", { timeZone: APP_TIMEZONE });
    const formatTanggalFinal = `${dataAi.tanggal}, ${jam}`;

    await sheet.addRow({
        Tanggal: formatTanggalFinal,
        Jenis: dataAi.jenis,
        Kategori: dataAi.kategori,
        Nominal: dataAi.nominal,
        Keterangan: dataAi.keterangan,
        Dompet: dompetUser,
        Saldo: saldoDompetBaru
    });

    let budgetAlert = null;

    if (dataAi.jenis === "Pengeluaran" && BUDGET_LIMITS[dataAi.kategori]) {
        const laporanBulan = await buatLaporanKeuangan("bulan", jid);
        const totalTerpakaiKategori = laporanBulan.detailKategori[dataAi.kategori] || 0;
        const limit = BUDGET_LIMITS[dataAi.kategori];

        if (totalTerpakaiKategori >= limit) {
            budgetAlert = `🚨 *BUDGET OVERLIMIT!*\nPengeluaran *${dataAi.kategori}* bulan ini sudah *Rp ${formatRupiah(totalTerpakaiKategori)}* dari limit *Rp ${formatRupiah(limit)}*.`;
        } else if (totalTerpakaiKategori >= limit * 0.85) {
            budgetAlert = `⚠️ *PENGINGAT ANGGARAN!*\nPengeluaran *${dataAi.kategori}* sudah 85%: *Rp ${formatRupiah(totalTerpakaiKategori)}* / Rp ${formatRupiah(limit)}.`;
        }
    }

    return { saldoDompetBaru, budgetAlert };
}

async function hapusTransaksiTerakhir(jid) {
    const sheet = await getSheetByNomor(jid);
    const rows = await sheet.getRows();

    if (rows.length === 0) return null;

    const barisTerakhir = rows[rows.length - 1];

    const dataDihapus = {
        jenis: barisTerakhir.get("Jenis"),
        nominal: Number(barisTerakhir.get("Nominal") || 0),
        keterangan: barisTerakhir.get("Keterangan")
    };

    await barisTerakhir.delete();
    return dataDihapus;
}

async function resetSeluruhData(jid) {
    const sheet = await getSheetByNomor(jid);
    await sheet.clearRows();
}

// =================================================================
// HANDLER PESAN
// =================================================================
async function handleMessage(sock, msg) {
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;

    const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";

    const pesan = text.toLowerCase().trim();

    if (!text && msg.message.audioMessage) {
        return sock.sendMessage(from, { text: dapatkanRespon("vnDitolak") });
    }

    if (!text) return;

    try {
        await getSheetByNomor(from);

        if (statusReset[from] === "MENUNGGU_KONFIRMASI") {
            if (/^(ya|setuju|ok)$/i.test(pesan)) {
                delete statusReset[from];
                await resetSeluruhData(from);
                return sock.sendMessage(from, { text: "🗑️ *RESET BERHASIL!*\n\nSemua data pembukuan kamu sudah dikosongkan." });
            }

            delete statusReset[from];
            return sock.sendMessage(from, { text: dapatkanRespon("batalReset") });
        }

        if (cocok("menu", pesan)) {
            return sock.sendMessage(from, {
                text:
`🤖 *BOT CATATAN KEUANGAN*

Kamu cukup ketik seperti ngobrol biasa ✨

🛒 *Contoh Pengeluaran:*
• beli nasi goreng 25k cash
• bayar wifi 350k gopay
• beli susu anak 150k mandiri

💵 *Contoh Pemasukan:*
• gaji masuk 5jt ke bca
• dapat bonus 750k cash
• terima transfer 1jt mandiri

📊 *Perintah Laporan:*
• *hari ini* - rekap transaksi hari ini
• *minggu ini* - rekap 7 hari terakhir
• *bulan ini* - rekap bulan berjalan
• *saldo* - total pemasukan, pengeluaran, dan saldo
• *dompet* - saldo tiap akun/dompet
• *budget* - cek batas anggaran
• *riwayat* - lihat transaksi terakhir

🚨 *Perintah Darurat:*
• *undo* - hapus transaksi terakhir
• *#reset* - kosongkan semua data`
            });
        }

        if (cocok("dompet", pesan)) {
            const lap = await buatLaporanKeuangan("semua", from);
            let teks = "👛 *SALDO AKUN & DOMPET*\n";
            let total = 0;

            for (const [dompet, saldo] of Object.entries(lap.saldoDompet)) {
                teks += `\n💳 *${dompet.toUpperCase()}*: Rp ${formatRupiah(saldo)}`;
                total += saldo;
            }

            if (Object.keys(lap.saldoDompet).length === 0) {
                teks += "\n📭 Belum ada saldo. Catat pemasukan atau pengeluaran dulu ya.";
            }

            teks += `\n\n---------------------------------\n💰 *TOTAL:* Rp ${formatRupiah(total)}`;
            return sock.sendMessage(from, { text: teks });
        }

        if (cocok("budget", pesan)) {
            const lapBulan = await buatLaporanKeuangan("bulan", from);
            let teks = "🎯 *MONITOR ANGGARAN BULAN INI*\n";

            for (const [kategori, limit] of Object.entries(BUDGET_LIMITS)) {
                const terpakai = lapBulan.detailKategori[kategori] || 0;
                const persen = ((terpakai / limit) * 100).toFixed(0);
                const icon = Number(persen) >= 100 ? "🚨" : Number(persen) >= 85 ? "⚠️" : "✅";
                teks += `\n${icon} *${kategori}*: Rp ${formatRupiah(terpakai)} / Rp ${formatRupiah(limit)} (*${persen}%*)`;
            }

            return sock.sendMessage(from, { text: teks });
        }

        if (cocok("riwayat", pesan)) {
            return sock.sendMessage(from, { text: await ambilRiwayatTransaksi(15, from) });
        }

        if (cocok("saldo", pesan)) {
            const lap = await buatLaporanKeuangan("semua", from);

            return sock.sendMessage(from, {
                text:
`💰 *LAPORAN KEUANGAN TOTAL*

🟢 Pemasukan: Rp ${formatRupiah(lap.totalMasuk)}
🔴 Pengeluaran: Rp ${formatRupiah(lap.totalKeluar)}
-------------------------
🧮 *Saldo Bersih: Rp ${formatRupiah(lap.saldo)}*`
            });
        }

        if (cocok("rekap", pesan)) {
            const tipe = pesan.includes("hari") ? "hari" : pesan.includes("minggu") ? "minggu" : "bulan";
            const lap = await buatLaporanKeuangan(tipe, from);

            let teks =
`📊 *STATISTIK ${tipe.toUpperCase()}*

🟢 Masuk: Rp ${formatRupiah(lap.totalMasuk)}
🔴 Keluar: Rp ${formatRupiah(lap.totalKeluar)}
-------------------------
🧮 *Bersih: Rp ${formatRupiah(lap.saldo)}*

🏷️ *Sektor Pengeluaran:*`;

            if (Object.keys(lap.detailKategori).length === 0) {
                teks += "\n📭 Belum ada pengeluaran pada periode ini.";
            } else {
                for (const [kategori, nominal] of Object.entries(lap.detailKategori)) {
                    teks += `\n• ${kategori}: Rp ${formatRupiah(nominal)}`;
                }
            }

            return sock.sendMessage(from, { text: teks });
        }

        if (cocok("undo", pesan)) {
            const hasilHapus = await hapusTransaksiTerakhir(from);
            if (!hasilHapus) return sock.sendMessage(from, { text: dapatkanRespon("gagalUndo") });
            return sock.sendMessage(from, { text: dapatkanRespon("suksesUndo", hasilHapus) });
        }

        if (cocok("reset", pesan)) {
            statusReset[from] = "MENUNGGU_KONFIRMASI";
            return sock.sendMessage(from, { text: dapatkanRespon("konfirmasiReset") });
        }

        const dataAi = await analisisPesanDenganAI(text);

        if (dataAi && dataAi.is_transaksi) {
            const { saldoDompetBaru, budgetAlert } = await simpanKeSheet(dataAi, from);
            const kategoriLower = dataAi.kategori.toLowerCase();

            let balasanBot = "";

            if (kategoriLower === "utang" || kategoriLower === "piutang") {
                balasanBot = dapatkanRespon("suksesUtang", {
                    kategori: dataAi.kategori,
                    nominal: formatRupiah(dataAi.nominal),
                    keterangan: dataAi.keterangan,
                    tanggal: dataAi.tanggal
                });
            } else {
                balasanBot = dapatkanRespon("suksesMencatat", {
                    emoji: dataAi.jenis === "Pemasukan" ? "🟢" : "🔴",
                    jenis: dataAi.jenis,
                    kategori: dataAi.kategori,
                    nominal: formatRupiah(dataAi.nominal),
                    keterangan: dataAi.keterangan,
                    dompet: dataAi.dompet,
                    tanggal: dataAi.tanggal,
                    saldo_dompet: formatRupiah(saldoDompetBaru)
                });
            }

            if (budgetAlert) balasanBot += `\n\n${budgetAlert}`;
            return sock.sendMessage(from, { text: balasanBot });
        }

        return sock.sendMessage(from, {
            text:
`❓ *Aku belum paham maksudnya.*

Coba ketik transaksi seperti:
• beli kopi 20k cash
• gaji masuk 5jt bca
• bayar listrik 300k gopay

Atau ketik *menu* untuk melihat semua perintah 📋`
        });
    } catch (e) {
        console.error("❌ Error proses pesan:", e.message || e);
        return sock.sendMessage(from, {
            text: "⚠️ Sistem sedang memproses pembukuan. Mohon kirim ulang beberapa saat lagi."
        });
    }
}

// =================================================================
// START WHATSAPP BOT VIA KODE MASUK
// =================================================================
async function startBot() {
    if (sedangStart) {
        console.log("⏳ Bot sedang start, proses dobel dilewati.");
        return;
    }

    sedangStart = true;

    try {
        console.log("🚀 Memulai Bot Keuangan...");
        console.log("🔐 Metode login WhatsApp: KODE MASUK / PAIRING CODE");

        cleanupSocket();

        const { state, saveCreds } = await useMultiFileAuthState("./session");
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: "silent" }),
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            connectTimeoutMs: 90_000,
            keepAliveIntervalMs: 30_000,
            retryRequestDelayMs: 5_000,
            markOnlineOnConnect: false,
            syncFullHistory: false,
            shouldIgnoreJid: jid => jid?.includes("@broadcast")
        });

        sockGlobal = sock;

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
            if (qr) console.log("📌 QR diterima tapi diabaikan. Script ini memakai kode masuk WhatsApp.");
            if (connection === "connecting") console.log("🔌 Menghubungkan ke WhatsApp...");

            if (connection === "open") {
                console.log("");
                console.log("✅ Bot Keuangan terhubung dan online!");
                sedangStart = false;
                jumlahReconnect = 0;

                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
            }

            if (connection === "close") {
                sedangStart = false;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const alasan = lastDisconnect?.error?.message || "unknown";
                const alasanLower = String(alasan).toLowerCase();

                console.log(`⚠️ Koneksi terputus. Status: ${statusCode || "unknown"}`);
                console.log(`ℹ️ Alasan: ${alasan}`);

                cleanupSocket();

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log("❌ WhatsApp logout. Hapus folder session lalu deploy ulang untuk login lagi.");
                    return;
                }

                if (statusCode === 440 || alasanLower.includes("conflict")) {
                    jadwalkanReconnect("conflict session WhatsApp", 60000);
                    return;
                }

                if (statusCode === 408 || alasanLower.includes("timed out")) {
                    jadwalkanReconnect("timeout koneksi", 20000);
                    return;
                }

                if (statusCode === 515) {
                    jadwalkanReconnect("restart required", 15000);
                    return;
                }

                jadwalkanReconnect("WhatsApp close", 20000);
            }
        });

        sock.ev.on("messages.upsert", async ({ messages }) => {
            try {
                const msg = messages?.[0];
                if (!msg) return;
                await handleMessage(sock, msg);
            } catch (err) {
                console.error("❌ Error messages.upsert:", err.message || err);
            }
        });

        if (!sock.authState.creds.registered) {
            const nomorWhatsApp = await ambilNomorWhatsApp();

            console.log("");
            console.log("⏳ Menunggu koneksi siap sebelum meminta kode...");
            await tunggu(5000);

            console.log("🔐 Meminta kode masuk WhatsApp...");
            console.log(`📱 Nomor WhatsApp: ${nomorWhatsApp}`);

            try {
                const kodeLogin = await sock.requestPairingCode(nomorWhatsApp);
                const kodeRapi = String(kodeLogin).match(/.{1,4}/g)?.join("-") || kodeLogin;

                console.log("");
                console.log("========================================");
                console.log(`🔑 KODE MASUK WHATSAPP: ${kodeRapi}`);
                console.log("========================================");
                console.log("");
                console.log("📲 Cara pakai:");
                console.log("1. Buka WhatsApp di HP");
                console.log("2. Masuk ke Perangkat tertaut");
                console.log("3. Pilih Tautkan perangkat");
                console.log("4. Pilih Tautkan dengan nomor telepon");
                console.log("5. Masukkan kode di atas");
                console.log("");
            } catch (err) {
                console.log("❌ Gagal meminta kode masuk:", err.message || err);
                console.log("🔄 Coba ulang otomatis dalam 30 detik...");
                sedangStart = false;
                cleanupSocket();
                jadwalkanReconnect("gagal meminta pairing code", 30000);
                return;
            }
        } else {
            console.log("✅ Session WhatsApp sudah terdaftar. Tidak perlu kode masuk lagi.");
        }

        sedangStart = false;
    } catch (err) {
        sedangStart = false;
        cleanupSocket();

        console.error("❌ Gagal start bot:", err.message || err);
        jadwalkanReconnect("gagal start bot", 30000);
    }
}

// =================================================================
// ERROR HANDLER GLOBAL
// =================================================================
process.on("uncaughtException", err => {
    console.error("🔥 uncaughtException:", err.message || err);
    jadwalkanReconnect("uncaughtException", 15000);
});

process.on("unhandledRejection", err => {
    console.error("🔥 unhandledRejection:", err?.message || err);
    jadwalkanReconnect("unhandledRejection", 15000);
});

process.on("SIGINT", () => {
    console.log("🛑 Bot dihentikan manual.");
    cleanupSocket();
    process.exit(0);
});

process.on("SIGTERM", () => {
    console.log("🛑 Bot menerima SIGTERM.");
    cleanupSocket();
    process.exit(0);
});

// =================================================================
// JALANKAN BOT
// =================================================================
if (!sudahStartKeepAlive) {
    sudahStartKeepAlive = true;
    startKeepAliveServer();
}

startBot();
