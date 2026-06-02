ubah jadi pairingnya bukan pakai kode tapi pakai qr scan yang berubah jika tidak tersambung wa bot akan refres qr terus tanpa merubah isi file lain buatkan langsung lengkap, const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { GoogleGenAI } = require("@google/genai"); 
const qrcode = require("qrcode-terminal");

// =================================================================
// KONFIGURASI UTAMA
// =================================================================
const SPREADSHEET_ID = "1qUkDrgWdqXrqN661OF8SjIRdOeOBQYZoS-9vzjxllv4";
const GEMINI_API_KEY = "AQ.Ab8RN6IzFstx5G2VOW1ABVgNq8Hg9gzc1_r2xR4ZI323JoWqMA"; 

const serviceAccount = require("./botkeuanganwa-498112-291d9b26247d.json");
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const statusReset = {}; 

// =================================================================
// KONEKSI GOOGLE SHEET
// =================================================================
async function getSheet() {
    try {
        const auth = new JWT({
            email: serviceAccount.client_email,
            key: serviceAccount.private_key,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"]
        });
        const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
        await doc.loadInfo();
        return doc.sheetsByIndex[0];
    } catch (err) {
        console.error("❌ Gagal terhubung ke Google Sheet:", err);
        throw err;
    }
}

// =================================================================
// VARIASI RESPON BOT
// =================================================================
const dapatkanRespon = (kategori, data = {}) => {
    const listRespon = {
        vnDitolak: [
            "🎙️ *Wah, suaramu merdu banget!* Tapi sayangnya untuk sekarang aku belum bisa dengerin VN nih. Ketik lewat teks aja ya, biar langsung aku catat!",
            "🎙️ *Ups! Fitur VN belum didukung.* Tolong diketik manual pakai teks biasa dulu ya, Kak. Contoh: _makan siang 25k_.",
            "🎙️ *Aku belum punya telinga nih, hehe.* Sementara waktu, yuk tulis transaksinya pakai teks aja supaya AI-ku bisa baca!"
        ],
        suksesMencatat: [
            data.emoji + " *SIAP, DATA DISIMPAN!*\n\nBerhasil mencatat *" + data.jenis + "* sebesar *Rp " + data.nominal + "* untuk _\"" + data.keterangan + "\"_ pada tanggal *" + data.tanggal + "*.\n\n🧮 *Sisa Saldo Kamu:* Rp " + data.saldo,
            data.emoji + " *NOTED! SELESAI DICATAT.*\n\nTransaksi *" + data.jenis + "* (*" + data.kategori + "*) sejumlah *Rp " + data.nominal + "* tanggal *" + data.tanggal + "* sudah aman di Google Sheet.\n\n🧮 *Dompet Saat Ini:* Rp " + data.saldo,
            data.emoji + " *OKEE, SUDAH MASUK BUKU!*\n\nUang sejumlah *Rp " + data.nominal + "* telah tercatat sebagai *" + data.jenis + "* (" + data.keterangan + ") untuk tanggal *" + data.tanggal + "*.\n\n🧮 *Kondisi Kas Terkini:* Rp " + data.saldo
        ],
        suksesUndo: [
            "↩️ *OK, TRANSAKSI TERAKHIR DIHAPUS!*\n\nAktivitas \"" + data.keterangan + "\" sebesar *Rp " + data.nominal + "* resmi dibatalkan.\n\n🧮 *Saldo dikembalikan ke:* Rp " + data.saldo,
            "↩️ *NOTED, DATA SUDAH DICORET!*\n\nKesalahan input teratasi. Transaksi terakhir (*" + data.jenis + "* - Rp " + data.nominal + ") sudah dihapus dari sheet.\n\n🧮 *Saldo sekarang:* Rp " + data.saldo
        ],
        gagalUndo: [
            "❌ *Eh? Gak ada yang bisa dihapus.* Google Sheet kamu masih kosong melompong nih!",
            "❌ *Gagal melakukan Undo.* Aku tidak menemukan adanya riwayat transaksi aktif di dalam databasemu."
        ],
        konfirmasiReset: [
            "⚠️ *EITSS, YANG BENER?!*\n\nTindakan ini akan menghapus *SELURUH* riwayat keuanganmu tanpa sisa.\n\nKalau kamu yakin, balas dengan ketik *YA* atau *SETUJU*. Kalau ragu, ketik apa saja untuk membatalkan!",
            "⚠️ *PERINGATAN DARURAT!* ⚠️\n\nKamu mau mengosongkan pembukuan dari nol? Balas *YA* untuk konfirmasi bersihkan data, atau ketik bebas untuk membatalkan."
        ],
        batalReset: [
            "❌ *Reset Dibatalkan!* Fiuh, untung aja. Data keuanganmu tetap aman terkendali kok.",
            "❌ *Aman! Pembukuan tidak jadi dihapus.* Yuk, lanjut catat pengeluaran lagi!"
        ]
    };

    const opsi = listRespon[kategori];
    return opsi[Math.floor(Math.random() * opsi.length)];
};

// =================================================================
// PROSES PINTAR DENGAN GEMINI AI + DETEKSI TANGGAL
// =================================================================
async function analisisPesanDenganAI(teksUser) {
    try {
        const waktuSistem = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
        const prompt = `Kamu adalah sistem AI kasir pintar untuk aplikasi pencatatan keuangan pribadi. Tugasmu adalah menganalisis kalimat chat dari user dan mengubahnya menjadi data JSON yang rapi. 

Informasi Waktu Sekarang (Hari Ini): ${waktuSistem}

ATURAN UTAMA:
1. Konversikan satuan singkatan uang seperti 'k' menjadi ribuan (contoh: 25k -> 25000) dan 'jt/juta' menjadi jutaan (contoh: 1.5jt -> 1500000).
2. Kategorikan transaksi ke dalam salah satu dari pilihan wajib ini: [Konsumsi, Transportasi, Utilitas, Pendapatan, Belanja, Kesehatan, Lainnya].
3. Tentukan jenis transaksi secara akurat: 'Pemasukan' atau 'Pengeluaran'.
4. DETEKSI TANGGAL TRANSAKSI: Perhatikan baik-baik jika user menyebutkan tanggal, hari, atau waktu spesifik (Contoh: "kemarin", "2 hari lalu", "tanggal 01 juni 2026", "tgl 25"). Hitung tanggal tersebut berdasarkan 'Informasi Waktu Sekarang' yang disediakan di atas. Format tanggal hasil deteksi WAJIB berupa string dengan format DD/MM/YYYY (Contoh: 01/06/2026). Jika user TIDAK menyebutkan tanggal/waktu spesifik sama sekali, maka isi properti "tanggal" dengan tanggal hari ini berdasarkan waktu sekarang dengan format DD/MM/YYYY.

Kalimat user: "${teksUser}"

Berikan jawaban HANYA berupa objek JSON dengan format persis seperti ini (tanpa markdown, tanpa teks tambahan lain):
{"is_transaksi": true, "jenis": "Pemasukan" atau "Pengeluaran", "nominal": angka_bulat, "kategori": "Nama Kategori", "keterangan": "Nama barang atau aktivitas yang bersih", "tanggal": "DD/MM/YYYY"}`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt
        });

        let mentah = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || "";
        
        if (!mentah) {
            throw new Error("Respon API Gemini Kosong");
        }

        mentah = mentah.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(mentah);
    } catch (error) {
        console.log("⚠️ [AI ERROR]: " + error.message + " -> Menggunakan Fallback Engine Lokal...");
        return fallbackParsingLokal(teksUser);
    }
}

// =================================================================
// SISTEM CADANGAN LOKAL (FALLBACK REGEX)
// =================================================================
function fallbackParsingLokal(text) {
    const pesan = text.toLowerCase().trim();
    let teksClean = pesan.replace(/\.(?=\d{3}(\D|$))/g, ""); 
    
    const regexAngka = /(\d+[\.,]?\d*)\s*(k|jt|juta)?/i;
    const match = teksClean.match(regexAngka);
    
    if (!match) return { is_transaksi: false };
    
    let nominalRaw = match[1].replace(",", ".");
    let nominal = parseFloat(nominalRaw);
    const satuan = match[2] ? match[2].toLowerCase() : "";
    
    if (satuan === "k") nominal *= 1000;
    if (satuan === "jt" || satuan === "juta") nominal *= 1000000;
    if (isNaN(nominal)) return { is_transaksi: false };

    const kataPemasukan = ["masuk", "gaji", "dapat", "terima", "jual", "untung", "bonus", "tf dari", "pemasukan", "cair"];
    let jenis = "Pengeluaran";
    
    if (pesan.includes("+")) {
        jenis = "Pemasukan";
    } else if (pesan.includes("-")) {
        jenis = "Pengeluaran";
    } else {
        for (const kata of kataPemasukan) {
            if (pesan.includes(kata)) {
                jenis = "Pemasukan";
                break;
            }
        }
    }

    let keterangan = text
        .replace(new RegExp(match[0], "i"), "")
        .replace(/[\+\-]/g, "")
        .replace(/(masuk|keluar|beli|bayar|dapat|terima|jual|gaji|pemasukan|pengeluaran)/ig, "")
        .replace(/\s+/g, " ")
        .trim();
        
    if (!keterangan) keterangan = jenis === "Pemasukan" ? "Pendapatan Variabel" : "Pengeluaran Umum";

    let kategori = "Lainnya";
    const ketLower = keterangan.toLowerCase();
    if (/(makan|minum|kopi|warung|restoran|cemilan|bakso|mie|nasgor|susu|snack)/.test(ketLower)) kategori = "Konsumsi";
    else if (/(bensin|bbm|parkir|ojek|grab|gojek|mobil|motor|tol|tiket)/.test(ketLower)) kategori = "Transportasi";
    else if (/(listrik|air|internet|wifi|pulsa|kuota|kos|token)/.test(ketLower)) kategori = "Utilitas";
    else if (/(gaji|honor|proyek|bonus|jual)/.test(ketLower)) kategori = "Pendapatan";
    else if (/(belanja|baju|sepatu|shopee|tokped)/.test(ketLower)) kategori = "Belanja";
    else if (/(obat|dokter|rs|vitamin)/.test(ketLower)) kategori = "Kesehatan";

    const tglSekarang = new Date();
    const opsiLokal = { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric" };
    const tanggalFormated = tglSekarang.toLocaleDateString("id-ID", opsiLokal).replace(/\./g, "/");

    return { is_transaksi: true, jenis, nominal, kategori, keterangan, tanggal: tanggalFormated };
}

// =================================================================
// GENERATE LAPORAN KEUANGAN PERIODIK
// =================================================================
async function buatLaporanKeuangan(tipe) {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    
    let totalMasuk = 0;
    let totalKeluar = 0;
    let detailKategori = {};
    const sekarang = new Date();

    for (const row of rows) {
        const tglStr = String(row.get("Tanggal") || "");
        if (!tglStr) continue;

        const [tglBagian] = tglStr.split(", ");
        const [hari, bulan, tahun] = tglBagian.split("/").map(Number);
        const tglTransaksi = new Date(tahun, bulan - 1, hari);

        let valid = false;
        const selisihHari = (sekarang - tglTransaksi) / (1000 * 60 * 60 * 24);

        if (tipe === "hari" && selisihHari < 1 && tglTransaksi.getDate() === sekarang.getDate()) valid = true;
        if (tipe === "minggu" && selisihHari <= 7) valid = true;
        if (tipe === "bulan" && tglTransaksi.getMonth() === sekarang.getMonth() && tglTransaksi.getFullYear() === sekarang.getFullYear()) valid = true;
        if (tipe === "semua") valid = true;

        if (valid) {
            const jenis = String(row.get("Jenis") || "").toLowerCase().trim();
            const nominal = Number(row.get("Nominal") || 0);
            const kat = String(row.get("Kategori") || "Lainnya");

            if (jenis === "pemasukan") {
                totalMasuk += nominal;
            } else {
                totalKeluar += nominal;
                detailKategori[kat] = (detailKategori[kat] || 0) + nominal;
            }
        }
    }

    return { totalMasuk, totalKeluar, saldo: totalMasuk - totalKeluar, detailKategori };
}

// =================================================================
// FITUR HAPUS TRANSAKSI TERAKHIR (UNDO)
// =================================================================
async function hapusTransaksiTerakhir() {
    const sheet = await getSheet();
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

// =================================================================
// RESET DATA TOTAL
// =================================================================
async function resetSeluruhData() {
    try {
        const sheet = await getSheet();
        await sheet.clearRows(); 
        console.log("✅ Spreadsheet berhasil dikosongkan secara instan!");
    } catch (err) {
        console.error("❌ Gagal membersihkan data sheet:", err);
        throw err;
    }
}

// =================================================================
// SIMPAN TRANSAKSI KE SPREADSHEET
// =================================================================
async function simpanKeSheet(dataAi) {
    const sheet = await getSheet();
    const laporanSemua = await buatLaporanKeuangan("semua");
    
    let saldoBaru = laporanSemua.saldo;
    if (dataAi.jenis === "Pemasukan") {
        saldoBaru += dataAi.nominal;
    } else {
        saldoBaru -= dataAi.nominal;
    }

    const waktuSkrg = new Date();
    const jamMenitDetik = waktuSkrg.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
    const formatTanggalFinal = `${dataAi.tanggal}, ${jamMenitDetik}`;

    await sheet.addRow({
        Tanggal: formatTanggalFinal,
        Jenis: dataAi.jenis,
        Kategori: dataAi.kategori,
        Nominal: dataAi.nominal,
        Keterangan: dataAi.keterangan,
        Saldo: saldoBaru
    });

    return saldoBaru;
}

// =================================================================
// START WHATSAPP SYSTEM CORE (DENGAN PAIRING CODE)
// =================================================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, 
        auth: state,
        logger: require("pino")({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"] // Wajib diisi agar fitur pairing code aktif
    });

    // SISTEM OTOMATIS REQUEST KODE UNTUK NOMOR KAMU
    if (!sock.authState.creds.registered) {
        const nomorHP = "6282260991400"; 
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(nomorHP);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log("\n========================================");
                console.log(`🔑 KODE PENAUTAN WHATSAPP ANDA: ${code}`);
                console.log("========================================\n");
            } catch (err) {
                console.error("❌ Gagal membuat kode penautan:", err);
            }
        }, 3000);
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (connection === "open") console.log("✅ Bot Keuangan Pintar Terhubung & Siap!");
        if (connection === "close") {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const pesanAudio = msg.message.audioMessage;
        if (pesanAudio && pesanAudio.ptt === true) {
            return sock.sendMessage(from, { text: dapatkanRespon("vnDitolak") });
        }

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const pesan = text.toLowerCase().trim();

        try {
            if (statusReset[from] === "MENUNGGU_KONFIRMASI") {
                if (/^(ya|setuju|ok|oke|confirm)$/.test(pesan)) {
                    delete statusReset[from];
                    await sock.sendMessage(from, { text: "⏳ Sedang membersihkan seluruh data spreadsheet..." });
                    await resetSeluruhData();
                    return sock.sendMessage(from, { text: "🗑️ *BERHASIL BERSIH TOTAL!* Seluruh riwayat transaksi kamu sudah di-wipe dari nol." });
                } else {
                    delete statusReset[from];
                    return sock.sendMessage(from, { text: dapatkanRespon("batalReset") });
                }
            }

            // MENU UTAMA
            if (/^(menu|help|bantuan|toko|fitur|#help|pandu|panduan|p)$/.test(pesan)) {
                const infoMenu = "🤖 *SISTEM DIKONTROL: BOT KEUANGAN AI* 🤖\n\n" +
                    "*📊 Cek Laporan & Arus Kas (Ketik langsung):*\n" +
                    "• *hari ini* / *#hari* : Cek rekap harian\n" +
                    "• *minggu ini* / *#minggu* : Rekap 7 hari terakhir\n" +
                    "• *bulan ini* / *#bulan* : Kas bulan berjalan\n" +
                    "• *saldo* / *laporan* / *total saldo* : Total kondisi keuangan menyeluruh\n\n" +
                    "*↩️ Tombol Darurat (Hapus Aktivitas):*\n" +
                    "• *batal* / *undo* / *cancel* / *salah ketik* : Menghapus paksa catatan transaksi terakhir.\n\n" +
                    "*⏱️ Perintah Cek Cepat:* \n" +
                    "• *pemasukan hari ini* / *pengeluaran hari ini*\n" +
                    "• *cek pengeluaran* / *cek pemasukan*\n\n" +
                    "*⚠️ Reset Database:*\n" +
                    "• *#reset* / *reset total* : Hapus permanen seluruh isi Google Sheet.";
                return sock.sendMessage(from, { text: infoMenu });
            }

            // CEK REKAP
            if (/^(#hari|hari ini|hariini|#minggu|minggu ini|mingguini|#bulan|bulan ini|bulanini)$/.test(pesan)) {
                let tipe = "hari";
                if (pesan.includes("minggu")) tipe = "minggu";
                if (pesan.includes("bulan")) tipe = "bulan";

                const lap = await buatLaporanKeuangan(tipe);
                let teksLap = "📊 *STATISTIK LENGKAP " + tipe.toUpperCase() + "AN* 📊\n\n" +
                    "🟢 Masuk : Rp " + lap.totalMasuk.toLocaleString("id-ID") + "\n" +
                    "🔴 Keluar : Rp " + lap.totalKeluar.toLocaleString("id-ID") + "\n" +
                    "----------------------------------------\n" +
                    "🧮 *Sisa Bersih Periode Ini: Rp " + lap.saldo.toLocaleString("id-ID") + "*\n\n" +
                    "*Alokasi Sektor Pengeluaran:*";

                if (Object.keys(lap.detailKategori).length === 0) {
                    teksLap += "\n_Belum ada pengeluaran terdata di periode ini._";
                } else {
                    for (const [k, v] of Object.entries(lap.detailKategori)) {
                        teksLap += "\n• " + k + ": Rp " + v.toLocaleString("id-ID");
                    }
                }
                return sock.sendMessage(from, { text: teksLap });
            }

            // CEK TOTAL SALDO
            if (/^(#laporan|laporan|saldo|sisa saldo|total saldo|cek saldo|tabungan|kas|duit)$/.test(pesan)) {
                const lapTotal = await buatLaporanKeuangan("semua");
                const lapHari = await buatLaporanKeuangan("hari");
                const lapMinggu = await buatLaporanKeuangan("minggu");
                const lapBulan = await buatLaporanKeuangan("bulan");

                let teksRekap = "📋 *KONDISI KEUANGAN KESELURUHAN* 📋\n\n" +
                    "💰 *DOMPET & TABUNGAN UTAMA* 💰\n" +
                    "• Akumulasi Pemasukan : Rp " + lapTotal.totalMasuk.toLocaleString("id-ID") + "\n" +
                    "• Akumulasi Pengeluaran: Rp " + lapTotal.totalKeluar.toLocaleString("id-ID") + "\n" +
                    "👉 *SISA SALDO BERSIH: Rp " + lapTotal.saldo.toLocaleString("id-ID") + "*\n\n" +
                    "⏱️ *PERKEMBANGAN ARUS KAS* ⏱️\n" +
                    "• *Hari Ini* : +Rp " + lapHari.totalMasuk.toLocaleString("id-ID") + " | -Rp " + lapHari.totalKeluar.toLocaleString("id-ID") + "\n" +
                    "• *Minggu Ini* : +Rp " + lapMinggu.totalMasuk.toLocaleString("id-ID") + " | -Rp " + lapMinggu.totalKeluar.toLocaleString("id-ID") + "\n" +
                    "• *Bulan Ini* : +Rp " + lapBulan.totalMasuk.toLocaleString("id-ID") + " | -Rp " + lapBulan.totalKeluar.toLocaleString("id-ID") + "\n\n" +
                    "*🗂️ REKAP PENGELUARAN TIAP SEKTOR:*";

                if (Object.keys(lapTotal.detailKategori).length === 0) {
                    teksRekap += "\n_Belum ada sektor pengeluaran terdaftar._";
                } else {
                    for (const [k, v] of Object.entries(lapTotal.detailKategori)) {
                        teksRekap += "\n• " + k + ": Rp " + v.toLocaleString("id-ID");
                    }
                }
                return sock.sendMessage(from, { text: teksRekap });
            }

            // DETAIL SIFAT TRANSAKSI HARI INI
            if (/^(pemasukan hari ini|pengeluaran hari ini|cek pengeluaran|cek pemasukan)$/.test(pesan)) {
                const lapHari = await buatLaporanKeuangan("hari");
                if (pesan.includes("pemasukan")) {
                    return sock.sendMessage(from, { text: "🟢 *Total Pemasukan Hari Ini:* Rp " + lapHari.totalMasuk.toLocaleString("id-ID") });
                } else {
                    let teksKeluarHari = "🔴 *Total Pengeluaran Hari Ini:* Rp " + lapHari.totalKeluar.toLocaleString("id-ID") + "\n\n*Rincian Sektor:*";
                    for (const [k, v] of Object.entries(lapHari.detailKategori)) {
                        teksKeluarHari += "\n• " + k + ": Rp " + v.toLocaleString("id-ID");
                    }
                    return sock.sendMessage(from, { text: teksKeluarHari });
                }
            }

            // UNDO
            if (/^(#batal|batal|#undo|undo|salah|salah ketik|hapus terakhir|cancel)$/.test(pesan)) {
                const hasilHapus = await hapusTransaksiTerakhir();
                if (!hasilHapus) {
                    return sock.sendMessage(from, { text: dapatkanRespon("gagalUndo") });
                }

                const lapKini = await buatLaporanKeuangan("semua");
                return sock.sendMessage(from, { 
                    text: dapatkanRespon("suksesUndo", {
                        keterangan: hasilHapus.keterangan,
                        nominal: hasilHapus.nominal.toLocaleString("id-ID"),
                        jenis: hasilHapus.jenis,
                        saldo: lapKini.saldo.toLocaleString("id-ID")
                    }) 
                });
            }

            // TRIGGER RESET
            if (pesan === "#reset" || pesan === "reset total" || pesan === "clear data") {
                statusReset[from] = "MENUNGGU_KONFIRMASI";
                return sock.sendMessage(from, { text: dapatkanRespon("konfirmasiReset") });
            }

            // PING
            if (pesan === "ping" || pesan === "tes" || pesan === "bot") {
                return sock.sendMessage(from, { text: "🤖 *Pong!* Bot aktif dan siap mencatat keuanganmu. Ketik *menu* untuk melihat daftar perintah." });
            }

            // PROSES ALAMI VIA GEMINI AI
            if (text) {
                const dataAi = await analisisPesanDenganAI(text);
                if (dataAi && dataAi.is_transaksi) {
                    const saldoAkhir = await simpanKeSheet(dataAi);
                    const emoji = dataAi.jenis === "Pemasukan" ? "🟢" : "🔴";
                    
                    return sock.sendMessage(from, { 
                        text: dapatkanRespon("suksesMencatat", {
                            emoji: emoji,
                            jenis: dataAi.jenis,
                            nominal: dataAi.nominal.toLocaleString("id-ID"),
                            keterangan: dataAi.keterangan,
                            kategori: dataAi.kategori,
                            saldo: saldoAkhir.toLocaleString("id-ID"),
                            tanggal: dataAi.tanggal
                        }) 
                    });
                }
            }

        } catch (e) {
            console.error("❌ Eror internal pemrosesan:", e);
            return sock.sendMessage(from, { text: "⚠️ Waduh, sistemku sempat nge-lag sebentar pas baca pesan tadi. Coba kirim ulang ya!" });
        }
    });
}

startBot();
