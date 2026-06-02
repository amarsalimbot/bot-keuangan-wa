const http = require("http");
const fs = require("fs");
const PORT = process.env.PORT || 7860;

// Variabel Monitor Utama
let statusSistem = "⏳ Memulai akselerasi mesin server dan penyiapan komponen...";

// =================================================================
// 🛡️ GLOBAL PROCESS PROTECTOR (ANTI-CRASH SHIELD)
// =================================================================
process.on("uncaughtException", (err) => {
    console.error("🔥 Terdeteksi Uncaught Exception:", err);
    statusSistem = `⚠️ Sistem mendeteksi aktivitas tidak biasa: [${err.message}]. Bot otomatis memulihkan diri...`;
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("🔥 Terdeteksi Unhandled Rejection pada:", promise, "alasan:", reason);
    statusSistem = `⚠️ Jaringan/API sibuk: [${reason?.message || reason}]. Mencoba kembali otomatis...`;
});

// =================================================================
// 🌐 WEB MONITOR UTAMA (INSTANT RESPONSE DISPLAY)
// =================================================================
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`🤖 MONITOR SYSTEM: BOT KEUANGAN WA (V3.1 - FIXED EXPRESS)\n==================================================\n\nStatus Aktif Saat Ini:\n${statusSistem}\n\n==================================================\n*Pantau halaman ini untuk melihat Kode Penautan WhatsApp Anda.`);
}).listen(PORT, () => {
    console.log(`🌐 Server monitor aktif di port ${PORT}`);
});

// Jalankan Bot secara asinkron dengan penanganan error berlapis
async function jalankanSistemBot() {
    try {
        statusSistem = "📦 Memuat pustaka modul utama (Express Loading)...";
        
        const {
            default: makeWASocket,
            useMultiFileAuthState,
            DisconnectReason,
            downloadContentFromMessage
        } = require("@whiskeysockets/baileys");

        const { GoogleSpreadsheet } = require("google-spreadsheet");
        const { JWT } = require("google-auth-library");
        const { GoogleGenAI } = require("@google/genai"); 

        statusSistem = "🔍 Memvalidasi berkas kredensial Google Akun (.json)...";
        
        const jsonPath = "./botkeuanganwa-498112-291d9b26247d.json";
        if (!fs.existsSync(jsonPath)) {
            statusSistem = `❌ ERROR FATAL: File '${jsonPath}' tidak ditemukan!\nSilahkan unggah file JSON Google Sheet Anda ke dalam tab 'Files' terlebih dahulu agar bot bisa berjalan.`;
            return;
        }
        const serviceAccount = require(jsonPath);
        
        // Konfigurasi Utama
        const SPREADSHEET_ID = "1qUkDrgWdqXrqN661OF8SjIRdOeOBQYZoS-9vzjxllv4";
        const GEMINI_API_KEY = "AQ.Ab8RN6IzFstx5G2VOW1ABVgNq8Hg9gzc1_r2xR4ZI323JoWqMA"; 
        const NOMOR_TERDAFTAR_ONLY = "6285779381664@s.whatsapp.net";

        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const statusReset = {}; 

        // Fungsi Penghubung Google Sheet
        async function getSheet() {
            const auth = new JWT({
                email: serviceAccount.client_email,
                key: serviceAccount.private_key,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });
            const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
            await doc.loadInfo();
            return doc.sheetsByIndex[0];
        }

        // Generator Template Respon Bot
        const dapatkanRespon = (kategori, data = {}) => {
            const listRespon = {
                vnDitolak: ["🎙️ *Wah, suaramu merdu banget!* Tapi sayangnya untuk sekarang aku belum bisa dengerin VN nih. Ketik teks atau kirim foto struk aja ya!", "🎙️ *Aku belum punya telinga nih.* Sementara waktu, yuk tulis transaksinya pakai teks biasa atau kirim foto nota belanjaanmu!"],
                suksesMencatat: [`${data.emoji} *SIAP, DATA DISIMPAN!*\n\nBerhasil mencatat *${data.jenis}* sebesar *Rp ${data.nominal}* untuk _"${data.keterangan}"_ pada tanggal *${data.tanggal}*.\n\n📊 *Total Sektor [${data.kategori}] Bulan Ini:* Rp ${data.totalKategoriBulanIni}\n🧮 *Sisa Saldo Kamu:* Rp ${data.saldo}`, `${data.emoji} *NOTED! SELESAI DICATAT.*\n\nTransaksi *${data.jenis}* (*${data.kategori}*) sejumlah *Rp ${data.nominal}* tanggal *${data.tanggal}* sudah aman di Google Sheet.\n\n📊 *Total Sektor [${data.kategori}] Bulan Ini:* Rp ${data.totalKategoriBulanIni}\n🧮 *Dompet Saat Ini:* Rp ${data.saldo}`],
                suksesUndo: ["↩️ *OK, TRANSAKSI TERAKHIR DIHAPUS!*\n\nAktivitas \"" + data.keterangan + "\" sebesar *Rp " + data.nominal + "* resmi dibatalkan.\n\n🧮 *Saldo dikembalikan ke:* Rp " + data.saldo, "↩️ *NOTED, DATA SUDAH DICORET!*\n\nKesalahan input teratasi. Transaksi terakhir (*" + data.jenis + "* - Rp " + data.nominal + ") sudah dihapus dari sheet.\n\n🧮 *Saldo sekarang:* Rp " + data.saldo],
                gagalUndo: ["❌ *Eh? Gak ada yang bisa dihapus.* Google Sheet kamu masih kosong melompong nih!", "❌ *Gagal melakukan Undo.* Aku tidak menemukan adanya riwayat transaksi aktif di dalam databasemu."],
                konfirmasiReset: ["⚠️ *EITSS, YANG BENER?!*\n\nTindakan ini akan menghapus *SELURUH* riwayat keuanganmu tanpa sisa.\n\nKalau kamu yakin, balas dengan ketik *YA* atau *SETUJU*. Kalau ragu, ketik apa saja untuk membatalkan!", "⚠️ *PERINGATAN DARURAT!* ⚠️\n\nKamu mau mengosongkan pembukuan dari nol? Balas *YA* untuk konfirmasi bersihkan data, atau ketik bebas untuk membatalkan."],
                batalReset: ["❌ *Reset Dibatalkan!* Fiuh, untung aja. Data keuanganmu tetap aman terkendali kok.", "❌ *Aman! Pembukuan tidak jadi dihapus.* Yuk, lanjut catat pengeluaran lagi!"]
            };
            const opsi = listRespon[kategori];
            return opsi[Math.floor(Math.random() * opsi.length)];
        };

        // Otak AI: Parsing Chat Teks
        async function analisisPesanDenganAI(teksUser) {
            try {
                const waktuSistem = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
                const prompt = `Kamu adalah sistem AI kasir pintar untuk aplikasi pencatatan keuangan pribadi. Tugasmu adalah menganalisis kalimat chat dari user dan mengubahnya menjadi data JSON.\n\nInformasi Waktu Sekarang (Hari Ini): ${waktuSistem}\n\nKalimat user: "${teksUser}"\n\nBerikan jawaban HANYA berupa objek JSON dengan format: {"is_transaksi": true, "jenis": "Pemasukan" atau "Pengeluaran", "nominal": angka_bulat, "kategori": "Konsumsi/Transportasi/Utilitas/Pendapatan/Belanja/Kesehatan/Lainnya", "keterangan": "detail", "tanggal": "DD/MM/YYYY"}`;
                const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
                let mentah = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || "";
                mentah = mentah.replace(/```json/g, "").replace(/```/g, "").trim();
                return JSON.parse(mentah);
            } catch (error) { return { is_transaksi: false }; }
        }

        // Otak AI: Vision Scan Gambar Struk
        async function analisisStrukDenganAI(imageBuffer, mimeType) {
            try {
                const waktuSistem = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
                const prompt = `Membaca gambar struk belanja. Ambil total grand total bersih bulat, nama toko item, kategori [Konsumsi, Transportasi, Utilitas, Pendapatan, Belanja, Kesehatan, Lainnya]. Balas JSON: {"is_transaksi": true, "jenis": "Pengeluaran", "nominal": angka_bulat, "kategori": "Nama Kategori", "keterangan": "NamaToko (Detail Ringkas)", "tanggal": "DD/MM/YYYY"}`;
                const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: [{ inlineData: { mimeType: mimeType, data: imageBuffer.toString("base64") } }, prompt] });
                let mentah = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || "";
                mentah = mentah.replace(/```json/g, "").replace(/
```/g, "").trim();
                return JSON.parse(mentah);
            } catch (error) { return { is_transaksi: false }; }
        }

        // Fitur Pembuat Laporan (Hari, Minggu, Bulan, Semua)
        async function buatLaporanKeuangan(tipe) {
            const sheet = await getSheet(); const rows = await sheet.getRows();
            let totalMasuk = 0, totalKeluar = 0, detailKategori = {}; const sekarang = new Date();
            for (const row of rows) {
                const tglStr = String(row.get("Tanggal") || ""); if (!tglStr) continue;
                const [tglBagian] = tglStr.split(", "); const [hari, bulan, tahun] = tglBagian.split("/").map(Number);
                const tglTransaksi = new Date(tahun, bulan - 1, hari); let valid = false;
                const selisihHari = (sekarang - tglTransaksi) / (1000 * 60 * 60 * 24);
                
                if (tipe === "hari" && selisihHari < 1 && tglTransaksi.getDate() === sekarang.getDate() && tglTransaksi.getMonth() === sekarang.getMonth()) valid = true;
                if (tipe === "minggu" && selisihHari <= 7) valid = true;
                if (tipe === "bulan" && tglTransaksi.getMonth() === sekarang.getMonth() && tglTransaksi.getFullYear() === sekarang.getFullYear()) valid = true;
                if (tipe === "semua") valid = true;
                
                if (valid) {
                    const jenis = String(row.get("Jenis") || "").toLowerCase().trim(); const nominal = Number(row.get("Nominal") || 0);
                    const kat = String(row.get("Kategori") || "Lainnya");
                    if (jenis === "pemasukan") { totalMasuk += nominal; } else { totalKeluar += nominal; detailKategori[kat] = (detailKategori[kat] || 0) + nominal; }
                }
            }
            return { totalMasuk, totalKeluar, saldo: totalMasuk - totalKeluar, detailKategori };
        }

        // Fitur Undo / Batal Transaksi Terakhir
        async function hapusTransaksiTerakhir() {
            const sheet = await getSheet(); const rows = await sheet.getRows(); if (rows.length === 0) return null;
            const barisTerakhir = rows[rows.length - 1];
            const dataDihapus = { jenis: barisTerakhir.get("Jenis"), nominal: Number(barisTerakhir.get("Nominal") || 0), keterangan: barisTerakhir.get("Keterangan") };
            await barisTerakhir.delete(); return dataDihapus;
        }

        // Fitur Penyimpanan Otomatis ke Google Sheet
        async function simpanKeSheet(dataAi) {
            const sheet = await getSheet(); const laporanSemua = await buatLaporanKeuangan("semua");
            let saldoBaru = laporanSemua.saldo + (dataAi.jenis === "Pemasukan" ? dataAi.nominal : -dataAi.nominal);
            const waktuSkrg = new Date(); const jamMenitDetik = waktuSkrg.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
            await sheet.addRow({ Tanggal: `${dataAi.tanggal}, ${jamMenitDetik}`, Jenis: dataAi.jenis, Kategori: dataAi.kategori, Nominal: dataAi.nominal, Keterangan: dataAi.keterangan, Saldo: saldoBaru });
            return saldoBaru;
        }

        statusSistem = "🔄 Mengaktifkan akselerator jalur instan WhatsApp...";
        
        const { state, saveCreds } = await useMultiFileAuthState("./session_turbo_speed");
        
        // BYPASS PROSES BROWSING VERSION - LANGSUNG TEMBAK VERSI STABLE TERBARU
        const sock = makeWASocket({ 
            version: [2, 3000, 1017579713], 
            auth: state,
            logger: require("pino")({ level: "silent" }),
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            syncFullHistory: false
        });

        // Logika Pengambilan Kode Penautan (Instant)
        if (!sock.authState.creds.registered) {
            const nomorHP = "6282260991400"; 
            process.nextTick(async () => {
                try {
                    statusSistem = "🔑 Sedang membuat kode penautan kilat Anda...";
                    let code = await sock.requestPairingCode(nomorHP);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    statusSistem = `🔑 KODE PENAUTAN WHATSAPP (INSTANT EXPRESS READY):\n\n👉  [ ${code} ]  👈\n\nSilahkan masukkan kode di atas pada fitur 'Perangkat Tertaut' -> 'Tautkan dengan Nomor Telepon' di HP nomor bot (6282260991400) sekarang.`;
                    console.log(`🔑 EXPRESS CODE GENERATED: ${code}`);
                } catch (err) {
                    statusSistem = `❌ Gagal mengambil kode pairing: ${err.message}. Mencoba ulang jalur pintas...`;
                    setTimeout(() => jalankanSistemBot(), 2000);
                }
            });
        } else {
            statusSistem = "✅ BOT ONLINE: Terhubung mantap! Menunggu aktivitas pesan...";
        }

        sock.ev.on("creds.update", saveCreds);

        // Pengendali Koneksi Otomatis yang Mulus
        sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
            if (connection === "open") {
                statusSistem = "✅ ONLINE: Bot Keuangan WA Aktif Sehat Walafiat!";
            }
            if (connection === "close") {
                const apakahLoggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
                if (apakahLoggedOut) {
                    statusSistem = "❌ Sesi Terputus Permanen (Logged Out). Silahkan bersihkan riwayat session Anda.";
                } else {
                    statusSistem = "🔄 Menyeimbangkan jaringan, menyambung ulang otomatis dalam 2 detik...";
                    setTimeout(() => jalankanSistemBot(), 2000);
                }
            }
        });

        // Pembaca Pesan WhatsApp Masuk
        sock.ev.on("messages.upsert", async ({ messages }) => {
            const msg = messages[0]; if (!msg.message || msg.key.fromMe) return;
            const from = msg.key.remoteJid;
            if (from !== NOMOR_TERDAFTAR_ONLY) return; 

            const pesanAudio = msg.message.audioMessage;
            if (pesanAudio && pesanAudio.ptt === true) return sock.sendMessage(from, { text: dapatkanRespon("vnDitolak") });

            const textDirect = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            const textCaption = msg.message.imageMessage?.caption || "";
            const text = textDirect || textCaption; const pesan = text.toLowerCase().trim();

            try {
                // PENANGANAN FOTO STRUK (SCAN VISION)
                const fotoStruk = msg.message.imageMessage;
                if (fotoStruk) {
                    await sock.sendMessage(from, { text: "🔍 *Struk terdeteksi!* Membaca data nota belanjaan via Gemini AI..." });
                    const stream = await downloadContentFromMessage(fotoStruk, "image"); let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                    const dataAi = await analisisStrukDenganAI(buffer, fotoStruk.mimetype);
                    if (dataAi && dataAi.is_transaksi) {
                        const saldoAkhir = await simpanKeSheet(dataAi); const lapBulan = await buatLaporanKeuangan("bulan");
                        return sock.sendMessage(from, { text: dapatkanRespon("suksesMencatat", { emoji: "📸", jenis: dataAi.jenis, nominal: dataAi.nominal.toLocaleString("id-ID"), keterangan: dataAi.keterangan, kategori: dataAi.kategori, saldo: saldoAkhir.toLocaleString("id-ID"), tanggal: dataAi.tanggal, totalKategoriBulanIni: (lapBulan.detailKategori[dataAi.kategori] || dataAi.nominal).toLocaleString("id-ID") }) });
                    } else { return sock.sendMessage(from, { text: "❌ AI gagal membaca nominal struk. Pastikan foto tegak, jelas, dan pencahayaan cukup!" }); }
                }

                // FITUR RESET DATA TOTAL
                if (statusReset[from] === "MENUNGGU_KONFIRMASI") {
                    if (/^(ya|setuju|ok|oke)$/.test(pesan)) {
                        delete statusReset[from]; await getSheet().then(s => s.clearRows());
                        return sock.sendMessage(from, { text: "🗑️ *BERHASIL BERSIH TOTAL!* Seluruh baris transaksi di Google Sheet telah dikosongkan dari nol." });
                    } else { delete statusReset[from]; return sock.sendMessage(from, { text: dapatkanRespon("batalReset") }); }
                }

                // FITUR MENU UTAMA
                if (/^(menu|help|bantuan|#help|p)$/.test(pesan)) {
                    return sock.sendMessage(from, { text: "🤖 *BOT KEUANGAN AI (V3.1)*\n\n*📊 Fitur Laporan Keuangan:* \n• *hari ini* : Rekap rekap harian Anda\n• *minggu ini* : Rekap mingguan Anda\n• *bulan ini* : Rekap bulanan berjalan\n• *saldo* : Cek total saldo kas akhir\n\n*📸 Fitur Struk:* Kirim foto nota/struk belanja belanja Anda.\n\n*↩️ Fitur Batal:* Ketik *batal* atau *undo* untuk mencoret input transaksi terakhir.\n\n*⚠️ Fitur Pengosongan:* Ketik *reset total*." });
                }

                // FITUR REKAP WAKTU
                if (/^(hari ini|minggu ini|bulan ini)$/.test(pesan)) {
                    let t = pesan.split(" ")[0]; const lap = await buatLaporanKeuangan(t === "hari" ? "hari" : t === "minggu" ? "minggu" : "bulan");
                    let tx = `📊 *STATISTIK REKAP ${t.toUpperCase()}AN*\n🟢 Total Masuk: Rp ${lap.totalMasuk.toLocaleString("id-ID")}\n🔴 Total Keluar: Rp ${lap.totalKeluar.toLocaleString("id-ID")}\n🧮 *Saldo Bersih: Rp ${lap.saldo.toLocaleString("id-ID")}*\n\n*Rincian Sektor Pengeluaran:*`;
                    for (const [k, v] of Object.entries(lap.detailKategori)) { tx += `\n• ${k}: Rp ${v.toLocaleString("id-ID")}`; }
                    return sock.sendMessage(from, { text: tx });
                }

                // FITUR CEK SALDO TOTAL
                if (/^(saldo|laporan|total saldo)$/.test(pesan)) {
                    const lt = await buatLaporanKeuangan("semua");
                    let tx = `📋 *KONDISI KEUANGAN KESELURUHAN*\n👉 *TOTAL SALDO KAS BERSIH: Rp ${lt.saldo.toLocaleString("id-ID")}*`;
                    return sock.sendMessage(from, { text: tx });
                }

                // FITUR UNDO / BATAL INPUT
                if (/^(batal|undo|cancel)$/.test(pesan)) {
                    const h = await hapusTransaksiTerakhir(); if (!h) return sock.sendMessage(from, { text: dapatkanRespon("gagalUndo") });
                    const l = await buatLaporanKeuangan("semua");
                    return sock.sendMessage(from, { text: dapatkanRespon("suksesUndo", { keterangan: h.keterangan, nominal: h.nominal.toLocaleString("id-ID"), jenis: h.jenis, saldo: l.saldo.toLocaleString("id-ID") }) });
                }

                if (pesan === "reset total") { statusReset[from] = "MENUNGGU_KONFIRMASI"; return sock.sendMessage(from, { text: dapatkanRespon("konfirmasiReset") }); }
                if (pesan === "ping") return sock.sendMessage(from, { text: "🤖 Bot Finansial Aktif Berjalan Sehat!" });

                // PENANGANAN CHAT TEKS OTOMATIS (AI NATURAL LANGUAGE PROCESSING)
                if (text && !fotoStruk) {
                    const dataAi = await analisisPesanDenganAI(text);
                    if (dataAi && dataAi.is_transaksi) {
                        const saldoAkhir = await simpanKeSheet(dataAi); const lapBulan = await buatLaporanKeuangan("bulan");
                        return sock.sendMessage(from, { text: dapatkanRespon("suksesMencatat", { emoji: dataAi.jenis === "Pemasukan" ? "🟢" : "🔴", jenis: dataAi.jenis, nominal: dataAi.nominal.toLocaleString("id-ID"), keterangan: dataAi.keterangan, kategori: dataAi.kategori, saldo: saldoAkhir.toLocaleString("id-ID"), tanggal: dataAi.tanggal, totalKategoriBulanIni: (lapBulan.detailKategori[dataAi.kategori] || dataAi.nominal).toLocaleString("id-ID") }) });
                    }
                }
            } catch (err) { console.error("Gagal memproses pesan:", err); }
        });

    } catch (globalError) {
        statusSistem = `❌ Jalur terhambat: [${globalError.message}]. Membuka bypass baru...`;
        setTimeout(() => jalankanSistemBot(), 2000);
    }
}

// Jalankan sistem
jalankanSistemBot();
