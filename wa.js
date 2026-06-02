const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const qrcode = require("qrcode-terminal");

// =================================
// KONFIGURASI
// =================================
const SPREADSHEET_ID = "1qUkDrgWdqXrqN661OF8SjIRdOeOBQYZoS-9vzjxllv4";
const serviceAccount = require("./botkeuanganwa-498112-291d9b26247d.json");

// =================================
// GOOGLE SHEET CONNECTION
// =================================
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

// =================================
// HITUNG SALDO & STATISTIK
// =================================
async function hitungSaldo() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();

    let pemasukan = 0;
    let pengeluaran = 0;
    let kategoriStats = {};

    for (const row of rows) {
        const jenis = String(row.get("Jenis") || "").toLowerCase();
        const nominal = Number(row.get("Nominal") || 0);
        const kategori = String(row.get("Kategori") || "Lainnya");

        if (jenis === "pemasukan") {
            pemasukan += nominal;
        } else if (jenis === "pengeluaran") {
            pengeluaran += nominal;
            // Hitung pengeluaran per kategori
            kategoriStats[kategori] = (kategoriStats[kategori] || 0) + nominal;
        }
    }

    return {
        pemasukan,
        pengeluaran,
        saldo: pemasukan - pengeluaran,
        kategoriStats
    };
}

// =================================
// SIMPAN TRANSAKSI
// =================================
async function simpanTransaksi(jenis, kategori, nominal, keterangan) {
    const data = await hitungSaldo();
    let saldoBaru = data.saldo;

    if (jenis === "Pemasukan") {
        saldoBaru += nominal;
    } else {
        saldoBaru -= nominal;
    }

    const sheet = await getSheet();
    await sheet.addRow({
        Tanggal: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
        Jenis: jenis,
        Kategori: kategori,
        Nominal: nominal,
        Keterangan: keterangan,
        Saldo: saldoBaru
    });

    return saldoBaru;
}

// =================================
// HAPUS TRANSAKSI TERAKHIR
// =================================
async function hapusTransaksiTerakhir() {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    if (rows.length > 0) {
        const rowTerakhir = rows[rows.length - 1];
        const detail = `${rowTerakhir.get("Jenis")} - ${rowTerakhir.get("Keterangan")} (Rp ${Number(rowTerakhir.get("Nominal")).toLocaleString("id-ID")})`;
        await rowTerakhir.delete();
        return detail;
    }
    return null;
}

// =================================
// NLP SULAP: PARSING TEKS OTOMATIS
// =================================
function parsingPesanKeuangan(text) {
    const pesan = text.toLowerCase();
    
    // 1. Tentukan Jenis (Pemasukan / Pengeluaran)
    const kataKunciPemasukan = ["masuk", "gaji", "dapat", "terima", "jual", "untung", "bonus", "tf dari"];
    const kataKunciPengeluaran = ["keluar", "beli", "bayar", "makan", "kopi", "nongkrong", "pulsa", "bensin", "utang", "tf ke"];
    
    let jenis = "Pengeluaran"; // Default jika ragu
    
    for (const kata of kataKunciPemasukan) {
        if (pesan.includes(kata)) {
            jenis = "Pemasukan";
            break;
        }
    }

    // 2. Ekstrak & Konversi Nominal Angka (Mendukung format: 25k, 1.5jt, 50.000)
    // Menghapus titik pemisah ribuan terlebih dahulu agar tidak mengacaukan regex regex
    let teksClean = pesan.replace(/\.(?=\d{3}(\D|$))/g, ""); 
    
    // Regex untuk mencari pola angka + k/jt
    const regexAngka = /(\d+[\.,]?\d*)\s*(k|jt|juta)?/i;
    const match = teksClean.match(regexAngka);
    
    if (!match) return null; // Jika tidak ada angka, abaikan
    
    let nominalRaw = match[1].replace(",", "."); // ganti koma desimal ke titik
    let nominal = parseFloat(nominalRaw);
    const satuan = match[2] ? match[2].toLowerCase() : "";
    
    if (satuan === "k") nominal *= 1000;
    if (satuan === "jt" || satuan === "juta") nominal *= 1000000;

    if (isNaN(nominal)) return null;

    // 3. Ambil Keterangan (Hapus angka dan kata perintah utama)
    let keterangan = text
        .replace(new RegExp(match[0], "i"), "") // hapus nominal dari teks
        .replace(/(masuk|keluar|beli|bayar|dapat)/i, "") // hapus kata perintah dasar
        .replace(/\s+/g, " ") // bersihkan spasi ganda
        .trim();
        
    if (!keterangan) keterangan = jenis === "Pemasukan" ? "Pendapatan Lainnya" : "Pengeluaran Lainnya";

    // 4. Tentukan Kategori Otomatis berdasarkan keterangan
    let kategori = "Lainnya";
    const ketLower = keterangan.toLowerCase();
    
    if (/(makan|minum|kopi|warung|restoran|cemilan|goofood|grabfood)/.test(ketLower)) kategori = "Konsumsi";
    else if (/(bensin|bbm|parkir|ojek|grab|gojek|service|mobil|motor)/.test(ketLower)) kategori = "Transportasi";
    else if (/(listrik|air|internet|wifi|pulsa|kuota|kos|kontrakan)/.test(ketLower)) kategori = "Utilitas";
    else if (/(gaji|honor|proyek|bonus|jual|sampingan)/.test(ketLower)) kategori = "Pendapatan";
    else if (/(belanja|baju|sepatu|skincare|shopee|tokped)/.test(ketLower)) kategori = "Belanja";
    else if (/(sakit|obat|dokter|klinik|vitamin)/.test(ketLower)) kategori = "Kesehatan";

    return { jenis, nominal, keterangan, kategori };
}

// =================================
// START WHATSAPP BOT
// =================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({ version, auth: state });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log("📱 Scan QR WhatsApp di atas");
        }
        if (connection === "open") console.log("✅ Bot Keuangan Terhubung!");
        if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const pesan = text.toLowerCase().trim();

        try {
            // MENU HELP
            if (pesan === "#help" || pesan === "help" || pesan === "menu") {
                const menuText = `📱 *BOT PENCATAT KEUANGAN PINTAR* 📱\n\n` +
                    `Kamu bisa ketik langsung seperti ngobrol biasa tanpa format kaku!\n\n` +
                    `*📝 Contoh Catat Otomatis:* Max nominal memakai (k = ribu, jt = juta)\n` +
                    `• _beli kopi starbucks 45k_\n` +
                    `• _bayar listrik 150000_\n` +
                    `• _dapat gaji proyek 2.5jt_\n` +
                    `• _jual baju bekas 75.000_\n\n` +
                    `*📊 Perintah Cek Laporan:*\n` +
                    `• *#saldo* : Cek sisa saldo & total kas saat ini.\n` +
                    `• *#kategori* : Rangkuman pengeluaran per kategori.\n` +
                    `• *#hapus* : Membatalkan/menghapus transaksi terakhir jika salah input.`;
                return sock.sendMessage(from, { text: menuText });
            }

            // CEK SALDO
            if (pesan === "#saldo" || pesan === "saldo") {
                const data = await hitungSaldo();
                const textSaldo = `💰 *RINGKASAN KEUANGAN* 💰\n\n` +
                    `🟢 Pemasukan: Rp ${data.pemasukan.toLocaleString("id-ID")}\n` +
                    `🔴 Pengeluaran: Rp ${data.pengeluaran.toLocaleString("id-ID")}\n` +
                    `---------------------------------------\n` +
                    `🧮 *Sisa Saldo: Rp ${data.saldo.toLocaleString("id-ID")}*`;
                return sock.sendMessage(from, { text: textSaldo });
            }

            // CEK STATISTIK KATEGORI
            if (pesan === "#kategori" || pesan === "kategori") {
                const data = await hitungSaldo();
                let teksKategori = `📊 *PENGELUARAN PER KATEGORI* 📊\n\n`;
                
                if (Object.keys(data.kategoriStats).length === 0) {
                    teksKategori += "_Belum ada data pengeluaran._";
                } else {
                    for (const [kat, total] of Object.entries(data.kategoriStats)) {
                        teksKategori += `• *${kat}*: Rp ${total.toLocaleString("id-ID")}\n`;
                    }
                }
                return sock.sendMessage(from, { text: teksKategori });
            }

            // HAPUS TRANSAKSI TERAKHIR
            if (pesan === "#hapus" || pesan === "hapus") {
                const terhapus = await hapusTransaksiTerakhir();
                if (terhapus) {
                    return sock.sendMessage(from, { text: `🗑️ *Transaksi Berhasil Dihapus:*\n_${terhapus}_` });
                } else {
                    return sock.sendMessage(from, { text: `❌ Tidak ada data transaksi yang bisa dihapus.` });
                }
            }

            // PROSES PARSING KEUPUTUSAN OTOMATIS (Aplikasi Keuangan AI)
            const hasilParsing = parsingPesanKeuangan(text);
            
            if (hasilParsing) {
                const { jenis, kategori, nominal, keterangan } = hasilParsing;
                
                // Simpan ke Google Sheet
                const saldoBaru = await simpanTransaksi(jenis, kategori, nominal, keterangan);
                
                const emoji = jenis === "Pemasukan" ? "🟢" : "🔴";
                const respon = `${emoji} *CATATAN BERHASIL SIMPAN*\n\n` +
                    `• *Jenis:* ${jenis}\n` +
                    `• *Nominal:* Rp ${nominal.toLocaleString("id-ID")}\n` +
                    `• *Kategori:* ${kategori}\n` +
                    `• *Keterangan:* "${keterangan}"\n\n` +
                    `🧮 *Sisa Saldo Sekarang:* Rp ${saldoBaru.toLocaleString("id-ID")}`;
                
                return sock.sendMessage(from, { text: respon });
            }

        } catch (err) {
            console.error("Error proses pesan:", err);
            return sock.sendMessage(from, { text: "⚠️ Terjadi kesalahan sistem saat mengolah data." });
        }
    });
}

startBot();