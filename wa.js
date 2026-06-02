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
// KONFIGURASI UTAMA & PEMBATASAN AKSES (SECURITY PATH)
// =================================================================
const SPREADSHEET_ID = "1qUkDrgWdqXrqN661OF8SjIRdOeOBQYZoS-9vzjxllv4";
const GEMINI_API_KEY = "AQ.Ab8RN6IzFstx5G2VOW1ABVgNq8Hg9gzc1_r2xR4ZI323JoWqMA"; 

const NOMOR_BOT = "6282260991400"; // Nomor HP Akun WhatsApp Bot Anda
const NOMOR_AKSES_EKSKLUSIF = "6285779381664"; // Nomor HP Pengendali Utama (Tanpa embel-embel)

const serviceAccount = require("./botkeuanganwa-498112-291d9b26247d.json");
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const statusReset = {}; 

// Variabel Global Server UI
let terakhirPairingCode = null;
let botTerhubung = false;

// =================================================================
// KONEKSI GOOGLE SHEET
// =================================================================
async function getSheet() {
    try {
        const formattedKey = serviceAccount.private_key.replace(/\\n/g, '\n');

        const auth = new JWT({
            email: serviceAccount.client_email,
            key: formattedKey,
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
4. DETEKSI TANGGAL TRANSAKSI: Perhatikan baik-baik jika user menyebutkan tanggal, hari, atau waktu spesifik. Hitung tanggal tersebut berdasarkan 'Informasi Waktu Sekarang' yang disediakan di atas. Format tanggal hasil deteksi WAJIB berupa string dengan format DD/MM/YYYY. Jika user TIDAK menyebutkan tanggal/waktu spesifik sama sekali, maka isi properti "tanggal" dengan tanggal hari ini berdasarkan waktu sekarang dengan format DD/MM/YYYY.

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

        const klasterBacktick = "`" + "`" + "`";
        mentah = mentah.replaceAll(klasterBacktick + "json", "").replaceAll(klasterBacktick, "").trim();
        
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
// SYSTEM CORE (MODE PAIRING KODE - NOMOR HP KHUSUS)
// =================================================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session_pencatatan_baru");
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, 
        auth: state,
        logger: require("pino")({ level: "silent" }),
        browser: ['Mac OS', 'Chrome', '124.0.0.0'], 
        printQRInTerminal: false, 
        syncFullHistory: false,      
        markOnlineOnConnect: true,   
        connectTimeoutMs: 60000      
    });

    sock.ev.on("creds.update", saveCreds);

    if (!sock.authState.creds.registered) {
        let jumlahGagalPairing = 0;

        async function kueriKodePairing() {
            if (sock.authState.creds.registered) return;
            try {
                console.log(`⏳ Menghubungi WhatsApp untuk meminta kode nomor ${NOMOR_BOT}...`);
                let code = await sock.requestPairingCode(NOMOR_BOT);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                terakhirPairingCode = code;
                jumlahGagalPairing = 0; 
                console.log(`🔑 [PAIRING KODE SYSTEM]: ${code}`);
            } catch (err) {
                console.log("❌ Gagal meregenerasi pairing kode:", err.message);
                jumlahGagalPairing++;
                
                if (jumlahGagalPairing >= 3) {
                    console.log("⚠️ Mengalami kegagalan pairing beruntun. Memaksa restart socket...");
                    try { sock.end(); } catch(e){}
                } else {
                    console.log(`🔄 Mencoba kembali meminta kode dalam 8 detik...`);
                    setTimeout(kueriKodePairing, 8000);
                }
            }
        }
        setTimeout(kueriKodePairing, 6000);
    }

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "open") {
            botTerhubung = true;
            terakhirPairingCode = null;
            console.log("✅ Bot Keuangan Pintar Terhubung & Siap Dioperasikan!");
            try {
                // Beri sinyal mengetik di chat pembuka
                const jidEksklusif = NOMOR_AKSES_EKSKLUSIF + "@s.whatsapp.net";
                await sock.sendPresenceUpdate("composing", jidEksklusif);
                await delay(2000);
                await sock.sendPresenceUpdate("paused", jidEksklusif);

                await sock.sendMessage(jidEksklusif, { 
                    text: "🚀 *NOTIFIKASI SISTEM:* Bot Keuangan Anda telah aktif! Respons sistem dipercepat dan indikator 'sedang mengetik' diaktifkan." 
                });
            } catch (err) {
                console.log("Gagal kirim log pembuka: ", err.message);
            }
        }
        
        if (connection === "close") {
            botTerhubung = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => { startBot(); }, 7000);
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;

        // 🛡️ SECURITY WALL: Menggunakan .includes untuk deteksi nomor pengendali agar fleksibel
        if (!from.includes(NOMOR_AKSES_EKSKLUSIF)) {
            return; 
        }

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const pesan = text.toLowerCase().trim();

        // Fitur Responsif: Kirim status "Sedang Mengetik..." begitu chat masuk
        await sock.sendPresenceUpdate("composing", from);

        try {
            const pesanAudio = msg.message.audioMessage;
            if (pesanAudio && pesanAudio.ptt === true) {
                await delay(1500); // Simulasi waktu membaca audio
                await sock.sendPresenceUpdate("paused", from);
                return sock.sendMessage(from, { text: dapatkanRespon("vnDitolak") });
            }

            // FILTER MODUL RESET TOTAL
            if (statusReset[from] === "MENUNGGU_KONFIRMASI") {
                await delay(1000);
                await sock.sendPresenceUpdate("paused", from);
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

            // 1. MENU UTAMA
            if (/^(menu|help|bantuan|toko|fitur|#help|pandu|panduan|p)$/.test(pesan)) {
                await delay(1000);
                await sock.sendPresenceUpdate("paused", from);
                const infoMenu = "🤖 *SISTEM DIKONTROL: BOT KEUANGAN AI* 🤖\n\n" +
                    "*📊 Cek Laporan & Arus Kas (Ketik langsung):*\n" +
                    "• *hari ini* / *#hari* : Cek rekap harian\n" +
                    "• *minggu ini* / *#minggu* : Rekap 7 hari terakhir\n" +
                    "• *bulan ini* / *#bulan* : Kas bulan berjalan\n" +
                    "• *saldo* / *laporan* / *total saldo* : Total kondisi keuangan menyeluruh\n\n" +
                    "*↩️ Tombol Darurat (Hapus Aktivitas):*\n" +
                    "• *batal* / *undo* / *cancel* / *salah ketik* : Menghapus paksa catatan transaksi terakhir.\n\n" +
                    "*⚠️ Reset Database:*\n" +
                    "• *#reset* / *reset total* : Hapus permanen seluruh isi Google Sheet.";
                return sock.sendMessage(from, { text: infoMenu });
            }

            // 2. CEK REKAP PERIODIK
            if (/^(#hari|hari ini|hariini|#minggu|minggu ini|mingguini|#bulan|bulan ini|bulanini)$/.test(pesan)) {
                let tipe = "hari";
                if (pesan.includes("minggu")) tipe = "minggu";
                if (pesan.includes("bulan")) tipe = "bulan";

                const lap = await buatLaporanKeuangan(tipe);
                await delay(1500); // Penundaan kalkulasi laporan
                await sock.sendPresenceUpdate("paused", from);

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

            // 3. CEK TOTAL SALDO UTAMA
            if (/^(#laporan|laporan|saldo|sisa saldo|total saldo|cek saldo|tabungan|kas|duit)$/.test(pesan)) {
                const lapTotal = await buatLaporanKeuangan("semua");
                const lapHari = await buatLaporanKeuangan("hari");
                const lapMinggu = await buatLaporanKeuangan("minggu");
                const lapBulan = await buatLaporanKeuangan("bulan");
                
                await delay(2000); // Simulasi waktu baca data komprehensif
                await sock.sendPresenceUpdate("paused", from);

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

            // 4. DETAIL SIFAT TRANSAKSI HARI INI
            if (/^(pemasukan hari ini|pengeluaran hari ini|cek pengeluaran|cek pemasukan)$/.test(pesan)) {
                const lapHari = await buatLaporanKeuangan("hari");
                await delay(1200);
                await sock.sendPresenceUpdate("paused", from);

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

            // 5. UNDO / BATAL
            if (/^(#batal|batal|#undo|undo|salah|salah ketik|hapus terakhir|cancel)$/.test(pesan)) {
                const hasilHapus = await hapusTransaksiTerakhir();
                await delay(1500);
                await sock.sendPresenceUpdate("paused", from);

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

            // 6. TRIGGER RESET
            if (pesan === "#reset" || pesan === "reset total" || pesan === "clear data") {
                await delay(1000);
                await sock.sendPresenceUpdate("paused", from);
                statusReset[from] = "MENUNGGU_KONFIRMASI";
                return sock.sendMessage(from, { text: dapatkanRespon("konfirmasiReset") });
            }

            // 7. PING TEST
            if (pesan === "ping" || pesan === "tes" || pesan === "bot" || pesan === "p") {
                await delay(800); // Pengetikan kilat
                await sock.sendPresenceUpdate("paused", from);
                return sock.sendMessage(from, { text: "🤖 *Pong!* Sistem pengaman membaca Anda dengan benar. Bot aktif dan siap mencatat keuanganmu. Ketik *menu* untuk panduan lengkap." });
            }

            // 8. PROSES ALAMI VIA GEMINI AI (Pencatatan Keuangan Terotomatisasi)
            if (text) {
                const dataAi = await analisisPesanDenganAI(text);
                
                // Menyamakan jeda mengetik buatan agar terkesan berpikir natural
                await delay(2500);
                await sock.sendPresenceUpdate("paused", from);

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
                } else {
                    return sock.sendMessage(from, {
                        text: "🤖 *Pesan terbaca, namun bukan transaksi.* \n\nYuk catat pembukuan dengan format alami, contoh:\n• _Beli nasi goreng 25k_\n• _Gaji bulanan masuk 4.5jt_\n\nAtau ketik *menu* untuk melihat statistik."
                    });
                }
            }

        } catch (e) {
            console.error("❌ Eror internal pemrosesan:", e);
            await sock.sendPresenceUpdate("paused", from);
            return sock.sendMessage(from, { text: "⚠️ Waduh, sistemku sempat nge-lag sebentar pas baca pesan tadi. Coba kirim ulang ya!" });
        }
    });
}

// =================================================================
// WEB INTERFACE UNTUK MENAMPILKAN PAIRING CODE
// =================================================================
const PORT = process.env.PORT || 7860;

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    
    if (botTerhubung) {
        res.end(`
            <div style="text-align:center; font-family:'Segoe UI', sans-serif; margin-top:100px; background-color:#f4f7f6; padding: 40px;">
                <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                    <h1 style="color: #25D366; font-size: 48px; margin-bottom: 10px;">🛡️</h1>
                    <h2 style="color: #128C7E; margin-top: 0;">Sistem Bot Secure Online!</h2>
                    <p style="color: #555; line-height: 1.6;">Bot berjalan aman pada nomor <b>${NOMOR_BOT}</b>.<br>Akses eksklusif dikunci penuh untuk nomor <b>${NOMOR_AKSES_EKSKLUSIF}</b>.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <span style="background-color: #e3fcef; color: #0f5132; padding: 6px 15px; border-radius: 20px; font-size: 14px; font-weight: bold;">Status: Terhubung & Terkunci</span>
                </div>
            </div>
        `);
    } 
    else if (terakhirPairingCode) {
        res.end(`
            <div style="text-align:center; font-family:'Segoe UI', sans-serif; padding: 50px; background-color:#f4f7f6; min-height: 100vh;">
                <div style="background: white; max-width: 550px; margin: 30px auto; padding: 35px; border-radius: 14px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
                    <h2 style="color: #007bff; margin-bottom: 5px;">🔑 LINKING PAIRING CODE WA</h2>
                    <p style="color: #555; font-size: 14px; margin-bottom: 25px;">Gunakan HP dengan nomor WA <b>${NOMOR_BOT}</b>, pilih menu <b>Perangkat Tertaut</b> &rarr; <b>Tautkan Perangkat</b> &rarr; pilih <b>Tautkan dengan nomor telepon saja</b>, lalu masukkan kode berikut:</p>
                    
                    <div style="margin: 20px 0; background-color: #f8f9fa; border: 2px dashed #007bff; padding: 20px; border-radius: 10px;">
                        <span style="font-family: 'Courier New', Courier, monospace; font-size: 42px; font-weight: bold; color: #333; letter-spacing: 2px;">${terakhirPairingCode}</span>
                    </div>
                    
                    <p style="color: #856404; background-color: #fff3cd; padding: 10px; border-radius: 6px; font-size: 12px; margin-top: 25px;">
                        🔄 Halaman ini me-refresh otomatis tiap 10 detik demi keamanan kode.
                    </p>
                </div>
            </div>
            <script>setTimeout(() => { location.reload(); }, 10000);</script>
        `);
    } 
    else {
        res.end(`
            <div style="text-align:center; font-family:'Segoe UI', sans-serif; margin-top:120px;">
                <div style="display: inline-block; border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite;"></div>
                <h3 style="color:#444; margin-top: 20px;">Mempersiapkan Jalur Kunci Nomor...</h3>
                <p style="color:#777; font-size:13px;">Sedang berkomunikasi dengan server WhatsApp untuk memunculkan 8-digit kode Anda, tunggu sesaat.</p>
            </div>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            <script>setTimeout(() => { location.reload(); }, 3000);</script>
        `);
    }
}).listen(PORT, () => {
    console.log(`🌐 Server Web UI Kode Pairing berjalan pada port ${PORT}`);
});

startBot();
