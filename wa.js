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
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1qUkDrgWdqXrqN661OF8SjIRdOeOBQYZoS-9vzjxllv4";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6IzFstx5G2VOW1ABVgNq8Hg9gzc1_r2xR4ZI323JoWqMA";
";
const SERVICE_ACCOUNT_FILE = process.env.SERVICE_ACCOUNT_FILE || "./botkeuanganwa-498112-291d9b26247d.json";
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || "6287810044412";
const APP_TIMEZONE = "Asia/Makassar";
const PORT = process.env.PORT || 3000;

const serviceAccount = require(SERVICE_ACCOUNT_FILE);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const statusReset = {};

let sockGlobal = null;
let sedangStart = false;
let reconnectTimer = null;
let jumlahReconnect = 0;
let sudahStartKeepAlive = false;

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

function formatRupiah(angka) {
    return Number(angka || 0).toLocaleString("id-ID");
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =================================================================
// KEEP ALIVE UNTUK GITHUB CODESPACES
// =================================================================
function startKeepAliveServer() {
    const server = http.createServer((req, res) => {
        if (req.url === "/health" || req.url === "/") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                status: "online",
                bot: sockGlobal ? "aktif_atau_mencoba_koneksi" : "belum_aktif",
                reconnect: jumlahReconnect,
                time: new Date().toLocaleString("id-ID", { timeZone: APP_TIMEZONE })
            }));
            return;
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
    });

    server.listen(PORT, () => {
        console.log(`🌐 Keep-alive server aktif di port ${PORT}`);
        console.log(`✅ Health check: http://localhost:${PORT}/health`);
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
// BATAS ANGGARAN BULANAN
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
// KONEKSI GOOGLE SHEET
// =================================================================
async function getSheet(index = 0) {
    try {
        const correctedPrivateKey = serviceAccount.private_key.replace(/\\n/g, "\n");

        const auth = new JWT({
            email: serviceAccount.client_email,
            key: correctedPrivateKey,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"]
        });

        const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
        await doc.loadInfo();

        return doc.sheetsByIndex[index];
    } catch (err) {
        console.error(`❌ Gagal terhubung ke Google Sheet indeks ${index}:`, err.message);
        throw err;
    }
}

// =================================================================
// VARIASI RESPON BOT
// =================================================================
const dapatkanRespon = (kategori, data = {}) => {
    const listRespon = {
        vnDitolak: [
            "🎙️ *VN belum didukung.* Tolong ketik lewat teks biasa dulu ya."
        ],
        suksesMencatat: [
            `${data.emoji} *DATA BERHASIL DICATAT!*\n\n• *Jenis:* ${data.jenis}\n• *Kategori:* ${data.kategori}\n• *Nominal:* Rp ${data.nominal}\n• *Dompet:* ${data.dompet.toUpperCase()}\n• *Keterangan:* "${data.keterangan}"\n• *Tanggal:* ${data.tanggal}\n\n🧮 *Saldo Akhir ${data.dompet.toUpperCase()}:* Rp ${data.saldo_dompet}`
        ],
        suksesUtang: [
            `📝 *CATATAN UTANG/PIUTANG BERHASIL!*\n\n• *Tipe:* ${data.kategori}\n• *Nama/Keterangan:* ${data.keterangan}\n• *Nominal:* Rp ${data.nominal}\n• *Tanggal:* ${data.tanggal}\n\n⚠️ Jangan lupa ditagih/dibayar tepat waktu ya.`
        ],
        suksesUndo: [
            `↩️ *TRANSAKSI TERAKHIR DIHAPUS!*\n\nAktivitas "${data.keterangan}" sebesar *Rp ${formatRupiah(data.nominal)}* sudah dibatalkan.`
        ],
        gagalUndo: [
            "❌ Tidak ada transaksi yang bisa dihapus. Google Sheet masih kosong."
        ],
        konfirmasiReset: [
            "⚠️ *KONFIRMASI RESET DATA*\n\nTindakan ini akan menghapus *SELURUH* riwayat keuangan.\n\nKalau yakin, balas: *YA* atau *SETUJU*."
        ],
        batalReset: [
            "❌ *Reset dibatalkan.* Data keuangan tetap aman."
        ]
    };

    const opsi = listRespon[kategori] || ["Baik, siap."];
    return opsi[Math.floor(Math.random() * opsi.length)];
};

// =================================================================
// ANALISIS PESAN DENGAN GEMINI AI
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
- Deteksi cash, tunai, bca, mandiri, bri, bni, gopay, ovo, dana, shopeepay, spay.
- Jika tidak disebut, isi "cash".

5. Tanggal:
- Format wajib DD/MM/YYYY.
- Jika tidak disebut, gunakan tanggal hari ini.

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

// =================================================================
// FALLBACK PARSING LOKAL
// =================================================================
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
// LAPORAN KEUANGAN
// =================================================================
async function buatLaporanKeuangan(tipe) {
    const sheet = await getSheet(0);
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

        if (jenis === "pemasukan") {
            saldoDompet[dompet] += nominal;
        } else {
            saldoDompet[dompet] -= nominal;
        }

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

// =================================================================
// RIWAYAT TRANSAKSI
// =================================================================
async function ambilRiwayatTransaksi(limit = 15) {
    try {
        const sheet = await getSheet(0);
        const rows = await sheet.getRows();

        if (rows.length === 0) {
            return "📭 *Riwayat transaksi masih kosong.*";
        }

        let teksRiwayat = `📋 *RIWAYAT TRANSAKSI TERBARU*\n`;
        teksRiwayat += `_Menampilkan ${Math.min(limit, rows.length)} dari ${rows.length} transaksi terakhir_\n`;
        teksRiwayat += `------------------------------------\n`;

        const indeksMulai = rows.length - 1;
        const indeksSelesai = Math.max(0, rows.length - limit);

        for (let i = indeksMulai; i >= indeksSelesai; i--) {
            const row = rows[i];

            const tglFull = String(row.get("Tanggal") || "00/00/0000, 00:00:00");
            const [tglOnly] = tglFull.split(", ");

            const jenis = String(row.get("Jenis") || "Pengeluaran").trim();
            const kategori = String(row.get("Kategori") || "Lainnya");
            const nominal = Number(row.get("Nominal") || 0);
            const keterangan = String(row.get("Keterangan") || "-");
            const dompet = String(row.get("Dompet") || "cash").toUpperCase();

            const emoji = jenis.toLowerCase() === "pemasukan" ? "🟢" : "🔴";
            const simbol = jenis.toLowerCase() === "pemasukan" ? "+" : "-";

            teksRiwayat += `\n${emoji} *[${tglOnly}]* ${keterangan}\n`;
            teksRiwayat += `   *${simbol} Rp ${formatRupiah(nominal)}* | ${kategori} | ${dompet}\n`;
        }

        teksRiwayat += `\n------------------------------------\nKetik *hari ini*, *minggu ini*, atau *bulan ini* untuk rekap.`;

        return teksRiwayat;
    } catch (err) {
        console.error("❌ Gagal mengambil riwayat:", err.message);
        return "⚠️ Gagal memuat riwayat transaksi. Coba lagi nanti.";
    }
}

// =================================================================
// SIMPAN TRANSAKSI
// =================================================================
async function simpanKeSheet(dataAi) {
    const sheet = await getSheet(0);
    const laporanKini = await buatLaporanKeuangan("semua");

    const dompetUser = String(dataAi.dompet || "cash").toLowerCase().trim();
    const saldoDompetLama = laporanKini.saldoDompet[dompetUser] || 0;

    const saldoDompetBaru = dataAi.jenis === "Pemasukan"
        ? saldoDompetLama + dataAi.nominal
        : saldoDompetLama - dataAi.nominal;

    const waktuSkrg = new Date();

    const jamMenitDetik = waktuSkrg.toLocaleTimeString("id-ID", {
        timeZone: APP_TIMEZONE
    });

    const formatTanggalFinal = `${dataAi.tanggal}, ${jamMenitDetik}`;

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
        const laporanBulan = await buatLaporanKeuangan("bulan");
        const totalTerpakaiKategori = laporanBulan.detailKategori[dataAi.kategori] || 0;
        const limit = BUDGET_LIMITS[dataAi.kategori];

        if (totalTerpakaiKategori >= limit) {
            budgetAlert = `⚠️ *BUDGET OVERLIMIT!*\nPengeluaran *${dataAi.kategori}* bulan ini sudah *Rp ${formatRupiah(totalTerpakaiKategori)}* dari limit *Rp ${formatRupiah(limit)}*.`;
        } else if (totalTerpakaiKategori >= limit * 0.85) {
            budgetAlert = `⚠️ *PENGINGAT ANGGARAN!*\nPengeluaran *${dataAi.kategori}* sudah 85%: *Rp ${formatRupiah(totalTerpakaiKategori)}* / Rp ${formatRupiah(limit)}.`;
        }
    }

    return { saldoDompetBaru, budgetAlert };
}

async function hapusTransaksiTerakhir() {
    const sheet = await getSheet(0);
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

async function resetSeluruhData() {
    const sheet = await getSheet(0);
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
        if (statusReset[from] === "MENUNGGU_KONFIRMASI") {
            if (/^(ya|setuju|ok)$/i.test(pesan)) {
                delete statusReset[from];
                await resetSeluruhData();
                return sock.sendMessage(from, { text: "🗑️ *RESET BERHASIL!* Semua data pembukuan sudah dikosongkan." });
            }

            delete statusReset[from];
            return sock.sendMessage(from, { text: dapatkanRespon("batalReset") });
        }

        if (cocok("menu", pesan)) {
            const infoMenu =
`🤖 *BOT CATATAN KEUANGAN*

Kamu cukup ketik seperti ngobrol biasa.

*Contoh Pengeluaran:*
• beli nasi goreng 25k cash
• bayar wifi 350k gopay
• beli susu anak 150k mandiri

*Contoh Pemasukan:*
• gaji masuk 5jt ke bca
• dapat bonus 750k cash
• terima transfer 1jt mandiri

*Perintah Laporan:*
• *hari ini* - rekap transaksi hari ini
• *minggu ini* - rekap 7 hari terakhir
• *bulan ini* - rekap bulan berjalan
• *saldo* - total pemasukan, pengeluaran, dan saldo
• *dompet* - saldo tiap akun/dompet
• *budget* - cek batas anggaran
• *riwayat* - lihat transaksi terakhir

*Perintah Darurat:*
• *undo* - hapus transaksi terakhir
• *#reset* - kosongkan semua data`;

            return sock.sendMessage(from, { text: infoMenu });
        }

        if (cocok("dompet", pesan)) {
            const lap = await buatLaporanKeuangan("semua");

            let teksDompet = "💳 *SALDO AKUN & DOMPET*\n";
            let totalSemua = 0;

            for (const [dompet, saldo] of Object.entries(lap.saldoDompet)) {
                teksDompet += `\n• *${dompet.toUpperCase()}*: Rp ${formatRupiah(saldo)}`;
                totalSemua += saldo;
            }

            teksDompet += `\n\n---------------------------------\n💰 *TOTAL:* Rp ${formatRupiah(totalSemua)}`;
            return sock.sendMessage(from, { text: teksDompet });
        }

        if (cocok("budget", pesan)) {
            const lapBulan = await buatLaporanKeuangan("bulan");
            let teksBudget = "🎯 *MONITOR ANGGARAN BULAN INI*\n";

            for (const [kategori, limit] of Object.entries(BUDGET_LIMITS)) {
                const terpakai = lapBulan.detailKategori[kategori] || 0;
                const persen = ((terpakai / limit) * 100).toFixed(0);
                teksBudget += `\n• *${kategori}*: Rp ${formatRupiah(terpakai)} / Rp ${formatRupiah(limit)} (*${persen}%*)`;
            }

            return sock.sendMessage(from, { text: teksBudget });
        }

        if (cocok("riwayat", pesan)) {
            const logRiwayat = await ambilRiwayatTransaksi(15);
            return sock.sendMessage(from, { text: logRiwayat });
        }

        if (cocok("saldo", pesan)) {
            const lap = await buatLaporanKeuangan("semua");

            const teksSaldo =
`💰 *LAPORAN KEUANGAN TOTAL*

🟢 Pemasukan: Rp ${formatRupiah(lap.totalMasuk)}
🔴 Pengeluaran: Rp ${formatRupiah(lap.totalKeluar)}
-------------------------
🧮 *Saldo Bersih: Rp ${formatRupiah(lap.saldo)}*`;

            return sock.sendMessage(from, { text: teksSaldo });
        }

        if (cocok("rekap", pesan)) {
            const tipe = pesan.includes("hari") ? "hari" : pesan.includes("minggu") ? "minggu" : "bulan";
            const lap = await buatLaporanKeuangan(tipe);

            let teksLap =
`📊 *STATISTIK ${tipe.toUpperCase()}*

🟢 Masuk: Rp ${formatRupiah(lap.totalMasuk)}
🔴 Keluar: Rp ${formatRupiah(lap.totalKeluar)}
-------------------------
🧮 *Bersih: Rp ${formatRupiah(lap.saldo)}*

*Sektor Pengeluaran:*`;

            if (Object.keys(lap.detailKategori).length === 0) {
                teksLap += "\nBelum ada pengeluaran pada periode ini.";
            } else {
                for (const [kategori, nominal] of Object.entries(lap.detailKategori)) {
                    teksLap += `\n• ${kategori}: Rp ${formatRupiah(nominal)}`;
                }
            }

            return sock.sendMessage(from, { text: teksLap });
        }

        if (cocok("undo", pesan)) {
            const hasilHapus = await hapusTransaksiTerakhir();

            if (!hasilHapus) {
                return sock.sendMessage(from, { text: dapatkanRespon("gagalUndo") });
            }

            return sock.sendMessage(from, { text: dapatkanRespon("suksesUndo", hasilHapus) });
        }

        if (cocok("reset", pesan)) {
            statusReset[from] = "MENUNGGU_KONFIRMASI";
            return sock.sendMessage(from, { text: dapatkanRespon("konfirmasiReset") });
        }

        const dataAi = await analisisPesanDenganAI(text);

        if (dataAi && dataAi.is_transaksi) {
            const { saldoDompetBaru, budgetAlert } = await simpanKeSheet(dataAi);

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

            if (budgetAlert) {
                balasanBot += `\n\n${budgetAlert}`;
            }

            return sock.sendMessage(from, { text: balasanBot });
        }

        return sock.sendMessage(from, {
            text:
`❓ *Aku belum paham maksudnya.*

Coba ketik transaksi seperti:
• beli kopi 20k cash
• gaji masuk 5jt bca
• bayar listrik 300k gopay

Atau ketik *menu* untuk melihat semua perintah.`
        });
    } catch (e) {
        console.error("❌ Error proses pesan:", e.message || e);
        return sock.sendMessage(from, {
            text: "⚠️ Sistem sedang memproses pembukuan. Mohon kirim ulang beberapa saat lagi."
        });
    }
}

// =================================================================
// START WHATSAPP BOT + LOGIN KODE PAIRING + AUTO RECONNECT
// =================================================================
async function startBot() {
    if (sedangStart) {
        console.log("⏳ Bot sedang start, proses dobel dilewati.");
        return;
    }

    sedangStart = true;

    try {
        console.log("🚀 Memulai Bot Keuangan...");

        cleanupSocket();

        const { state, saveCreds } = await useMultiFileAuthState("./session");
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: "silent" }),
            printQRInTerminal: false,
            browser: ["Bot Keuangan Codespaces", "Chrome", "1.0.0"],
            connectTimeoutMs: 60_000,
            keepAliveIntervalMs: 20_000,
            retryRequestDelayMs: 2_000,
            markOnlineOnConnect: true,
            syncFullHistory: false,
            shouldIgnoreJid: jid => jid?.includes("@broadcast")
        });

        sockGlobal = sock;

        sock.ev.on("creds.update", saveCreds);

        if (!sock.authState.creds.registered) {
            if (!WHATSAPP_NUMBER || WHATSAPP_NUMBER === "6281234567890") {
                console.log("❌ Nomor WhatsApp belum diatur.");
                console.log("➡️ Ganti WHATSAPP_NUMBER dengan nomor kamu.");
                console.log("➡️ Format: 62xxxxxxxxxxx tanpa tanda +");
            } else {
                console.log(`📱 Meminta kode pairing untuk nomor: ${WHATSAPP_NUMBER}`);

                await delay(3000);

                const pairingCode = await sock.requestPairingCode(WHATSAPP_NUMBER);

                console.log("\n====================================");
                console.log(`🔐 KODE PAIRING WHATSAPP: ${pairingCode}`);
                console.log("====================================\n");
                console.log("Cara login:");
                console.log("1. Buka WhatsApp di HP");
                console.log("2. Masuk ke Perangkat Tertaut");
                console.log("3. Pilih Tautkan dengan nomor telepon");
                console.log("4. Masukkan kode pairing di atas");
                console.log("5. Setelah berhasil, bot akan online otomatis");
            }
        }

        sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
            if (qr) {
                console.log("ℹ️ QR diterima, tapi login disetel memakai kode pairing. Abaikan QR ini.");
            }

            if (connection === "open") {
                console.log("\n✅ Bot Keuangan terhubung dan online!");
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
                    console.log("❌ WhatsApp logout.");
                    console.log("➡️ Hapus folder session lalu jalankan ulang bot untuk minta kode pairing baru.");
                    return;
                }

                if (statusCode === 440 || alasanLower.includes("conflict")) {
                    console.log("⚠️ Conflict terdeteksi. Kemungkinan ada proses bot dobel memakai session yang sama.");
                    console.log("⏳ Menunggu 60 detik agar session lama benar-benar lepas.");
                    jadwalkanReconnect("conflict session WhatsApp", 60000);
                    return;
                }

                if (statusCode === 408 || alasanLower.includes("timed out")) {
                    jadwalkanReconnect("timeout koneksi", 15000);
                    return;
                }

                if (statusCode === 515) {
                    jadwalkanReconnect("restart required", 10000);
                    return;
                }

                jadwalkanReconnect("WhatsApp close");
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

        sedangStart = false;
    } catch (err) {
        sedangStart = false;
        cleanupSocket();

        console.error("❌ Gagal start bot:", err.message || err);
        jadwalkanReconnect("gagal start bot", 10000);
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
