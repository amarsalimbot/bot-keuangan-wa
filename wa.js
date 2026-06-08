// ============================================================
//  BOT KEUANGAN WHATSAPP - VERSI LENGKAP
//  Fitur: Grafik ASCII, Dashboard Web, AI Analisis, Budget Custom,
//         Pencarian, Export, Pengingat, Tips Harian, Tren
// ============================================================

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

// ── ENV ──────────────────────────────────────────────────────
const SPREADSHEET_ID            = process.env.SPREADSHEET_ID || "";
const GEMINI_API_KEY            = process.env.GEMINI_API_KEY || "";
const WHATSAPP_PHONE_NUMBER     = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\D/g, "");
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
const APP_TIMEZONE              = "Asia/Makassar";
const PORT                      = process.env.PORT || 7860;

if (!SPREADSHEET_ID)             throw new Error("SPREADSHEET_ID belum diisi.");
if (!GEMINI_API_KEY)             throw new Error("GEMINI_API_KEY belum diisi.");
if (!GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON belum diisi.");

let serviceAccount;
try { serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON); }
catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON tidak valid JSON."); }

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ── STATE GLOBAL ─────────────────────────────────────────────
const statusReset     = {};
const statusExport    = {};
const budgetCustom    = {};        // { jid: { Konsumsi: 2000000, ... } }
const reminderAktif   = {};        // { jid: intervalId }
const cacheSheet      = {};        // ringan, bukan cache berat
let   sockGlobal      = null;
let   sedangStart     = false;
let   reconnectTimer  = null;
let   jumlahReconnect = 0;
let   sudahStartKeepAlive = false;

const HEADER_TRANSAKSI = ["Tanggal","Jenis","Kategori","Nominal","Keterangan","Dompet","Saldo"];

// ── UTILITAS ─────────────────────────────────────────────────
const tunggu      = ms => new Promise(r => setTimeout(r, ms));
const formatRupiah = n => Number(n||0).toLocaleString("id-ID");
const ambilNomorDariJid = jid => String(jid||"").split("@")[0].replace(/\D/g,"");

function tanggalHariIni() {
    return new Date().toLocaleDateString("id-ID",{
        timeZone: APP_TIMEZONE, day:"2-digit", month:"2-digit", year:"numeric"
    }).replace(/\./g,"/");
}

function buatAuthGoogle() {
    return new JWT({
        email: serviceAccount.client_email,
        key:   serviceAccount.private_key.replace(/\\n/g,"\n"),
        scopes:["https://www.googleapis.com/auth/spreadsheets"]
    });
}

async function getSheetByNomor(jid) {
    const nomor = ambilNomorDariJid(jid);
    if (!nomor) throw new Error("Nomor WhatsApp tidak valid.");
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, buatAuthGoogle());
    await doc.loadInfo();
    let sheet = doc.sheetsByTitle[nomor];
    if (!sheet) {
        sheet = await doc.addSheet({ title: nomor, headerValues: HEADER_TRANSAKSI });
    } else {
        try {
            await sheet.loadHeaderRow();
            const missing = HEADER_TRANSAKSI.some(h => !sheet.headerValues.includes(h));
            if (missing) await sheet.setHeaderRow(HEADER_TRANSAKSI);
        } catch { await sheet.setHeaderRow(HEADER_TRANSAKSI); }
    }
    return sheet;
}

// ── NORMALISASI ──────────────────────────────────────────────
function normalisasiJenis(j) {
    const t = String(j||"").toLowerCase().trim();
    if (["pemasukan","masuk","income","pendapatan"].includes(t)) return "Pemasukan";
    return "Pengeluaran";
}

function parseNominalDariTeks(teks) {
    const m = String(teks||"").match(/(?:rp\s*)?(\d+(?:[\.,]\d+)?)\s*(k|rb|ribu|jt|juta|m|mn|milyar|miliar)?\b/i);
    if (!m) return null;
    let n = Number(String(m[1]).replace(",","."));
    const s = String(m[2]||"").toLowerCase();
    if (["k","rb","ribu"].includes(s)) n *= 1000;
    if (["jt","juta"].includes(s))    n *= 1000000;
    if (["m","mn","milyar","miliar"].includes(s)) n *= 1000000000;
    if (!Number.isFinite(n)||n<=0) return null;
    return { nominal: Math.round(n), raw: m[0] };
}

function deteksiDompet(teks) {
    const p = String(teks||"").toLowerCase();
    if (/\b(shopeepay|spay)\b/.test(p)) return "shopeepay";
    if (/\bgopay\b/.test(p))  return "gopay";
    if (/\bovo\b/.test(p))    return "ovo";
    if (/\bdana\b/.test(p))   return "dana";
    if (/\bbca\b/.test(p))    return "bca";
    if (/\bbri\b/.test(p))    return "bri";
    if (/\bbni\b/.test(p))    return "bni";
    if (/\bmandiri\b/.test(p)) return "mandiri";
    if (/\b(cash|tunai)\b/.test(p)) return "cash";
    return "cash";
}

function deteksiKategori(teks, jenis) {
    const p = String(teks||"").toLowerCase();
    if (jenis==="Pemasukan") {
        if (/\b(bonus|thr|komisi|sampingan|freelance)\b/.test(p)) return "Bonus & Sampingan";
        if (/\b(investasi|dividen|bunga|tabungan)\b/.test(p))     return "Investasi & Tabungan";
        if (/\b(utang|pinjam dari|dipinjami)\b/.test(p))          return "Utang";
        return "Pendapatan";
    }
    if (/\b(makan|minum|kopi|nasi|ayam|resto|gofood|grabfood|camilan)\b/.test(p)) return "Konsumsi";
    if (/\b(bensin|parkir|tol|grab|gojek|transport|ojek|taxi)\b/.test(p)) return "Transportasi";
    if (/\b(wifi|listrik|air|pulsa|paket data|internet|streaming)\b/.test(p)) return "Utilitas";
    if (/\b(belanja|sembako|pasar|supermarket|kebutuhan dapur)\b/.test(p)) return "Belanja";
    if (/\b(baju|celana|sepatu|pakaian)\b/.test(p)) return "Pakaian";
    if (/\b(sewa|kos|kontrakan|cicilan rumah|renovasi)\b/.test(p)) return "Tempat Tinggal";
    if (/\b(game|film|hiburan|liburan|nonton)\b/.test(p)) return "Hiburan";
    if (/\b(buku|kursus|sekolah|kuliah|edukasi)\b/.test(p)) return "Edukasi & Buku";
    if (/\b(obat|dokter|klinik|rumah sakit|vitamin|perawatan)\b/.test(p)) return "Kesehatan & Perawatan";
    if (/\b(susu|anak|popok|mainan anak|keluarga)\b/.test(p)) return "Anak & Keluarga";
    if (/\b(sedekah|donasi|zakat|sosial)\b/.test(p)) return "Sosial & Sedekah";
    if (/\b(pajak|pph|ppn)\b/.test(p)) return "Pajak";
    if (/\b(piutang|meminjamkan|pinjamkan)\b/.test(p)) return "Piutang";
    return "Lainnya";
}

// ── BUDGET DEFAULT ────────────────────────────────────────────
const BUDGET_DEFAULT = {
    "Konsumsi":           3000000,
    "Belanja":            1500000,
    "Transportasi":        800000,
    "Utilitas":           1000000,
    "Hiburan":             750000,
    "Anak & Keluarga":    2000000,
    "Kesehatan & Perawatan": 1000000,
    "Pakaian":             500000,
    "Tempat Tinggal":     1500000,
    "Edukasi & Buku":      500000,
    "Sosial & Sedekah":    500000,
    "Pajak":              1000000
};

function getBudget(jid) {
    return Object.assign({}, BUDGET_DEFAULT, budgetCustom[jid] || {});
}

// ── GRAFIK ASCII ──────────────────────────────────────────────
function buatGrafikBar(data, judul = "GRAFIK", maxBar = 20) {
    if (!data || Object.keys(data).length === 0) {
        return `📊 *${judul}*\n_Tidak ada data untuk ditampilkan._`;
    }

    const entri = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const maxVal = entri[0][1] || 1;
    let teks = `📊 *${judul}*\n${"─".repeat(30)}\n`;

    for (const [label, val] of entri) {
        const panjang = Math.round((val / maxVal) * maxBar);
        const bar = "█".repeat(Math.max(panjang, 1));
        const persen = ((val / (Object.values(data).reduce((a,b)=>a+b,0))) * 100).toFixed(1);
        const labelPendek = label.length > 14 ? label.slice(0,13)+"." : label.padEnd(14);
        teks += `${labelPendek} ${bar} ${persen}%\n`;
        teks += `${" ".repeat(15)} Rp ${formatRupiah(val)}\n`;
    }

    teks += `${"─".repeat(30)}`;
    return teks;
}

function buatGrafikTren(dataTren, judul = "TREN 7 HARI") {
    if (!dataTren || dataTren.length === 0) return `📈 *${judul}*\n_Tidak ada data._`;

    const maxVal = Math.max(...dataTren.map(d => Math.max(d.masuk, d.keluar)), 1);
    let teks = `📈 *${judul}*\n${"─".repeat(30)}\n`;

    for (const d of dataTren) {
        const barMasuk  = "🟢".repeat(Math.round((d.masuk  / maxVal) * 8));
        const barKeluar = "🔴".repeat(Math.round((d.keluar / maxVal) * 8));
        teks += `*${d.label}*\n`;
        teks += `  +${barMasuk || "○"} ${formatRupiah(d.masuk)}\n`;
        teks += `  -${barKeluar || "○"} ${formatRupiah(d.keluar)}\n`;
    }

    return teks;
}

// ── LAPORAN KEUANGAN ──────────────────────────────────────────
async function buatLaporanKeuangan(tipe, jid) {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();

    let totalMasuk = 0, totalKeluar = 0;
    const detailKategori = {}, saldoDompet = {}, trenHarian = {};
    const sekarang = new Date();

    for (const row of rows) {
        const tglStr = String(row.get("Tanggal")||"");
        if (!tglStr) continue;
        const [tglBagian] = tglStr.split(", ");
        const [hari, bulan, tahun] = tglBagian.split("/").map(Number);
        if (!hari||!bulan||!tahun) continue;

        const tglTransaksi = new Date(tahun, bulan-1, hari);
        const selisihHari  = (sekarang - tglTransaksi)/(1000*60*60*24);

        let valid = false;
        if (tipe==="hari"   && selisihHari<1 && tglTransaksi.getDate()===sekarang.getDate()) valid=true;
        if (tipe==="minggu" && selisihHari<=7) valid=true;
        if (tipe==="bulan"  && tglTransaksi.getMonth()===sekarang.getMonth() && tglTransaksi.getFullYear()===sekarang.getFullYear()) valid=true;
        if (tipe==="semua") valid=true;

        const jenis   = String(row.get("Jenis")||"").toLowerCase().trim();
        const nominal = Number(row.get("Nominal")||0);
        const kategori= String(row.get("Kategori")||"Lainnya");
        const dompet  = String(row.get("Dompet")||"cash").toLowerCase().trim();

        // saldo dompet (selalu semua data)
        saldoDompet[dompet] = (saldoDompet[dompet]||0) + (jenis==="pemasukan" ? nominal : -nominal);

        if (valid) {
            if (jenis==="pemasukan") totalMasuk  += nominal;
            else                     { totalKeluar += nominal; detailKategori[kategori]=(detailKategori[kategori]||0)+nominal; }

            // tren harian (untuk grafik)
            const kunciTren = `${String(hari).padStart(2,"0")}/${String(bulan).padStart(2,"0")}`;
            if (!trenHarian[kunciTren]) trenHarian[kunciTren]={masuk:0,keluar:0};
            if (jenis==="pemasukan") trenHarian[kunciTren].masuk  += nominal;
            else                     trenHarian[kunciTren].keluar += nominal;
        }
    }

    return { totalMasuk, totalKeluar, saldo: totalMasuk-totalKeluar, detailKategori, saldoDompet, trenHarian, rows };
}

async function ambilRiwayatTransaksi(limit=15, jid) {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();
    if (rows.length===0) return "📭 *Riwayat transaksi masih kosong.*";

    let teks = `📋 *RIWAYAT ${Math.min(limit,rows.length)} TRANSAKSI TERAKHIR*\n`;
    teks += `_(dari total ${rows.length} transaksi)_\n${"─".repeat(34)}\n`;
    const mulai   = rows.length-1;
    const selesai = Math.max(0, rows.length-limit);

    for (let i=mulai; i>=selesai; i--) {
        const r = rows[i];
        const [tgl]  = String(r.get("Tanggal")||"00/00/0000").split(", ");
        const jenis  = String(r.get("Jenis")||"Pengeluaran").trim();
        const kat    = String(r.get("Kategori")||"Lainnya");
        const nom    = Number(r.get("Nominal")||0);
        const ket    = String(r.get("Keterangan")||"-");
        const dom    = String(r.get("Dompet")||"cash").toUpperCase();
        const simbol = jenis.toLowerCase()==="pemasukan" ? "🟢 +" : "🔴 -";
        teks += `\n🗓️ *[${tgl}]* ${ket}\n   ${simbol} *Rp ${formatRupiah(nom)}* | ${kat} | ${dom}\n`;
    }

    teks += `\n${"─".repeat(34)}\n📊 Ketik *grafik bulan ini* untuk visualisasi`;
    return teks;
}

// ── CARI TRANSAKSI ────────────────────────────────────────────
async function cariTransaksi(keyword, jid) {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();
    const kw    = keyword.toLowerCase().trim();

    if (!kw || kw.length < 2) return "⚠️ Kata kunci pencarian minimal 2 karakter.";

    const cocokRows = rows.filter(r =>
        String(r.get("Keterangan")||"").toLowerCase().includes(kw) ||
        String(r.get("Kategori")||"").toLowerCase().includes(kw) ||
        String(r.get("Dompet")||"").toLowerCase().includes(kw)
    ).slice(-20).reverse();

    if (cocokRows.length===0) return `🔍 Tidak ada transaksi yang cocok dengan *"${keyword}"*.`;

    let teks = `🔍 *HASIL PENCARIAN: "${keyword}"*\n_(${cocokRows.length} transaksi ditemukan)_\n${"─".repeat(34)}\n`;
    let totalMasuk=0, totalKeluar=0;

    for (const r of cocokRows) {
        const [tgl]  = String(r.get("Tanggal")||"").split(", ");
        const jenis  = String(r.get("Jenis")||"").toLowerCase().trim();
        const nom    = Number(r.get("Nominal")||0);
        const kat    = String(r.get("Kategori")||"-");
        const ket    = String(r.get("Keterangan")||"-");
        const dom    = String(r.get("Dompet")||"cash").toUpperCase();
        const simbol = jenis==="pemasukan" ? "🟢 +" : "🔴 -";
        if (jenis==="pemasukan") totalMasuk+=nom; else totalKeluar+=nom;
        teks += `\n*[${tgl}]* ${ket}\n   ${simbol} *Rp ${formatRupiah(nom)}* | ${kat} | ${dom}\n`;
    }

    teks += `\n${"─".repeat(34)}\n🟢 Masuk: Rp ${formatRupiah(totalMasuk)}\n🔴 Keluar: Rp ${formatRupiah(totalKeluar)}`;
    return teks;
}

// ── EXPORT LAPORAN ────────────────────────────────────────────
async function eksporLaporan(tipe, jid) {
    const lap  = await buatLaporanKeuangan(tipe, jid);
    const bln  = new Date().toLocaleDateString("id-ID",{timeZone:APP_TIMEZONE,month:"long",year:"numeric"});
    const now  = new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE});

    let teks =
`╔════════════════════════════════╗
║   LAPORAN KEUANGAN PRIBADI     ║
║   ${bln.toUpperCase().padEnd(30)}║
╚════════════════════════════════╝
📅 Dicetak: ${now}
Periode  : ${tipe.toUpperCase()}

━━━━━━ RINGKASAN ━━━━━━━━━━━━━━━
🟢 Total Pemasukan : Rp ${formatRupiah(lap.totalMasuk)}
🔴 Total Pengeluaran: Rp ${formatRupiah(lap.totalKeluar)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 SALDO BERSIH    : Rp ${formatRupiah(lap.saldo)}

━━━━━━ PENGELUARAN PER KATEGORI ━
`;

    const budget = getBudget(jid);
    for (const [kat,val] of Object.entries(lap.detailKategori).sort((a,b)=>b[1]-a[1])) {
        const limit   = budget[kat];
        const budgetStr = limit ? ` / Rp ${formatRupiah(limit)} (${((val/limit)*100).toFixed(0)}%)` : "";
        teks += `• ${kat.padEnd(22)}: Rp ${formatRupiah(val)}${budgetStr}\n`;
    }

    teks +=
`
━━━━━━ SALDO PER DOMPET ━━━━━━━━
`;
    for (const [dom,saldo] of Object.entries(lap.saldoDompet)) {
        teks += `• ${dom.toUpperCase().padEnd(12)}: Rp ${formatRupiah(saldo)}\n`;
    }

    teks +=
`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Laporan ini dibuat otomatis oleh Bot Keuangan WA_`;

    return teks;
}

// ── AI HELPER: retry + model fallback ────────────────────────
// Urutan model yang dicoba saat 503 / overload
const AI_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b"];

/**
 * Panggil Gemini dengan retry otomatis.
 * - Coba setiap model di AI_MODELS maksimal `maxRetry` kali per model.
 * - Jeda exponential backoff antar percobaan.
 * - Lempar error hanya jika SEMUA model & retry habis.
 */
async function panggilAI(prompt, { maxRetry = 3, jedaAwal = 2000 } = {}) {
    let lastErr;

    for (const model of AI_MODELS) {
        for (let percobaan = 1; percobaan <= maxRetry; percobaan++) {
            try {
                const resp = await ai.models.generateContent({ model, contents: prompt });
                const txt  = resp.text || resp.candidates?.[0]?.content?.parts?.[0]?.text || "";
                if (txt.trim()) {
                    if (model !== AI_MODELS[0] || percobaan > 1) {
                        console.log(`✅ AI berhasil dengan model=${model} percobaan=${percobaan}`);
                    }
                    return txt.trim();
                }
                throw new Error("Respons AI kosong");
            } catch (e) {
                lastErr = e;
                const msg = String(e.message || "").toLowerCase();
                const is503 = msg.includes("503") || msg.includes("unavailable") ||
                              msg.includes("high demand") || msg.includes("overloaded");

                console.warn(`⚠️ AI [${model}] percobaan ${percobaan}/${maxRetry}: ${e.message}`);

                // Kalau bukan error sementara (503/overload), langsung coba model berikutnya
                if (!is503) break;

                // Jeda exponential sebelum retry: 2s, 4s, 8s, …
                if (percobaan < maxRetry) {
                    const jeda = jedaAwal * Math.pow(2, percobaan - 1);
                    console.log(`   ⏳ Tunggu ${jeda/1000}s sebelum retry...`);
                    await tunggu(jeda);
                }
            }
        }
    }

    throw lastErr || new Error("Semua model AI tidak tersedia");
}

// ── ANALISIS AI ───────────────────────────────────────────────
async function analisisAIKeuangan(lap, tipe="bulan") {
    const ringkasan = {
        periode:        tipe,
        totalMasuk:     lap.totalMasuk,
        totalKeluar:    lap.totalKeluar,
        saldo:          lap.saldo,
        detailKategori: lap.detailKategori
    };

    const prompt =
`Kamu adalah konsultan keuangan pribadi yang bijak dan ramah.
Analisis data keuangan berikut dan berikan insight dalam Bahasa Indonesia:

${JSON.stringify(ringkasan, null, 2)}

Berikan:
1. Ringkasan kondisi keuangan (1-2 kalimat)
2. Kategori pengeluaran tertinggi dan saran penghematannya
3. Apakah kondisi keuangan sehat? (pemasukan vs pengeluaran)
4. 2-3 tips konkret untuk bulan depan

Gunakan emoji yang sesuai. Jawab max 300 kata. Nada: hangat, tidak menghakimi, memotivasi.`;

    try {
        return await panggilAI(prompt);
    } catch (e) {
        console.error("❌ analisisAIKeuangan gagal total:", e.message);
        // Fallback manual berdasarkan data
        const kondisi = lap.saldo >= 0 ? "positif 🟢" : "defisit 🔴";
        const terboros = Object.entries(lap.detailKategori).sort((a,b)=>b[1]-a[1])[0];
        return (
`📊 *Ringkasan Keuangan (Mode Offline)*

Kondisi saldo kamu saat ini *${kondisi}*.
🟢 Pemasukan : Rp ${formatRupiah(lap.totalMasuk)}
🔴 Pengeluaran: Rp ${formatRupiah(lap.totalKeluar)}
💰 Saldo Bersih: Rp ${formatRupiah(lap.saldo)}

${terboros ? `🏷️ Pengeluaran terbesar: *${terboros[0]}* (Rp ${formatRupiah(terboros[1])})` : ""}

💡 Tips: Coba ketik *tips* untuk saran keuangan, atau coba *analisis* lagi dalam beberapa menit.
_⚠️ Analisis AI sedang tidak tersedia sementara (server padat)._`
        );
    }
}

async function dapatkanTipsHarian() {
    const TIPS_OFFLINE = [
        "💡 Terapkan aturan 50/30/20: 50% kebutuhan, 30% keinginan, 20% tabungan.",
        "🎯 Sebelum beli sesuatu, tanya diri: 'Apakah ini kebutuhan atau keinginan?'",
        "📊 Review pengeluaran mingguan bisa menghemat 10-15% pengeluaran bulanan.",
        "🐷 Sisihkan tabungan di awal bulan, bukan sisa di akhir bulan.",
        "☕ Bawa bekal & kopi sendiri bisa hemat ratusan ribu per bulan.",
        "📱 Hapus notifikasi promo belanja online untuk mengurangi godaan impulsif.",
        "🧾 Simpan struk belanja — kesadaran pengeluaran adalah langkah pertama menabung.",
        "🏦 Dana darurat ideal = 3–6 bulan pengeluaran. Mulai dari yang kecil!",
        "🔄 Bayar tagihan & cicilan di awal bulan supaya tidak lupa dan tidak boros.",
        "💳 Hindari cicilan 0% untuk barang konsumtif — itu tetap utang.",
        "🛒 Buat daftar belanja sebelum ke supermarket dan patuhi daftarnya.",
        "📈 Investasi Rp 100rb/bulan lebih baik dari tidak sama sekali.",
    ];

    const hari = new Date().toLocaleDateString("id-ID",{timeZone:APP_TIMEZONE,weekday:"long"});
    const prompt = `Berikan 1 tips keuangan harian yang singkat, praktis, dan memotivasi dalam Bahasa Indonesia untuk hari ${hari}. Max 3 kalimat. Sertakan 1 emoji yang relevan di awal.`;

    try {
        return await panggilAI(prompt, { maxRetry: 2, jedaAwal: 1500 });
    } catch {
        // Fallback ke tips statis, rotasi berdasarkan tanggal
        return TIPS_OFFLINE[new Date().getDate() % TIPS_OFFLINE.length];
    }
}

// ── PARSING & AI ─────────────────────────────────────────────
function parsingPerintahTransaksi(teksUser) {
    const txt = String(teksUser||"").trim();
    const awalanMasuk   = /^(pemasukan|masuk|income|pendapatan|catat pemasukan|tambah pemasukan)\b/i;
    const awalanKeluar  = /^(pengeluaran|keluar|expense|catat pengeluaran|tambah pengeluaran)\b/i;
    let jenis=null, sisa=txt;

    if (awalanMasuk.test(txt))       { jenis="Pemasukan";   sisa=txt.replace(awalanMasuk,"").trim(); }
    else if (awalanKeluar.test(txt)) { jenis="Pengeluaran"; sisa=txt.replace(awalanKeluar,"").trim(); }
    else if (/\b(gaji|bonus|terima|dapat|masuk|pendapatan|income)\b/i.test(txt)) jenis="Pemasukan";
    else if (/\b(beli|bayar|keluar|jajan|belanja)\b/i.test(txt))                jenis="Pengeluaran";

    if (!jenis) return { is_transaksi: false };
    const hasilNominal = parseNominalDariTeks(sisa||txt);
    if (!hasilNominal) return { is_transaksi: false };

    const dompet  = deteksiDompet(txt);
    const kategori= deteksiKategori(txt, jenis);
    let keterangan= (sisa||txt)
        .replace(hasilNominal.raw,"")
        .replace(/\b(ke|dari|via|pakai|dengan)\s+(cash|tunai|bca|bri|bni|mandiri|gopay|ovo|dana|spay|shopeepay)\b/ig,"")
        .replace(/\s+/g," ").trim() || txt;

    return { is_transaksi:true, jenis, nominal:hasilNominal.nominal, kategori, keterangan, dompet, tanggal:tanggalHariIni() };
}

function fallbackParsingLokal(text) {
    const p    = String(text||"").toLowerCase().trim();
    const h    = parseNominalDariTeks(p);
    if (!h) return { is_transaksi:false };
    const dom  = deteksiDompet(p);
    const kp   = ["gaji","bonus","terima","masuk","dapat","pendapatan","income","pemasukan"];
    const jenis= kp.some(k=>p.includes(k)) ? "Pemasukan" : "Pengeluaran";
    return { is_transaksi:true, jenis, nominal:h.nominal, kategori:deteksiKategori(p,jenis), keterangan:text, dompet:dom, tanggal:tanggalHariIni() };
}

async function analisisPesanDenganAI(teksUser) {
    const waktu  = new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE});
    const prompt =
`Kamu sistem AI pencatat keuangan. Waktu sekarang: ${waktu}.
Analisis chat user → JSON transaksi.

Aturan:
1. Konversi: 25k=25000, 1.5jt=1500000
2. Kategori: [Konsumsi,Transportasi,Utilitas,Belanja,Pakaian,Tempat Tinggal,Hiburan,Edukasi & Buku,Kesehatan & Perawatan,Anak & Keluarga,Sosial & Sedekah,Pendapatan,Bonus & Sampingan,Investasi & Tabungan,Pajak,Utang,Piutang,Lainnya]
3. Jenis: Pemasukan | Pengeluaran
4. Dompet: cash/bca/bri/bni/mandiri/gopay/ovo/dana/shopeepay. Default: cash
5. Tanggal: DD/MM/YYYY. Default: hari ini
6. Bukan transaksi → {"is_transaksi":false}

User: "${teksUser}"
Balas HANYA JSON valid.`;

    try {
        let mentah = await panggilAI(prompt, { maxRetry: 3, jedaAwal: 2000 });
        mentah = mentah.replaceAll("```json","").replaceAll("```","").trim();

        const hasil = JSON.parse(mentah);
        if (!hasil.is_transaksi)                    return { is_transaksi:false };
        if (!hasil.nominal||Number(hasil.nominal)<=0) return { is_transaksi:false };

        hasil.nominal    = Math.round(Number(hasil.nominal));
        hasil.dompet     = String(hasil.dompet||"cash").toLowerCase().trim();
        hasil.keterangan = String(hasil.keterangan||teksUser).trim();
        hasil.kategori   = String(hasil.kategori||"Lainnya").trim();
        hasil.jenis      = normalisasiJenis(hasil.jenis||"Pengeluaran");
        return hasil;
    } catch (e) {
        // panggilAI sudah retry semua model — ini benar-benar gagal, pakai lokal
        console.log("⚠️ AI parsing gagal total, pakai fallback lokal:", e.message);
        return fallbackParsingLokal(teksUser);
    }
}

// ── SIMPAN & HAPUS ────────────────────────────────────────────
async function simpanKeSheet(dataAi, jid) {
    const sheet   = await getSheetByNomor(jid);
    const lapKini = await buatLaporanKeuangan("semua", jid);
    const dom     = String(dataAi.dompet||"cash").toLowerCase().trim();
    const saldoLama  = lapKini.saldoDompet[dom]||0;
    const saldoBaru  = dataAi.jenis==="Pemasukan" ? saldoLama+dataAi.nominal : saldoLama-dataAi.nominal;
    const jam     = new Date().toLocaleTimeString("id-ID",{timeZone:APP_TIMEZONE});

    await sheet.addRow({
        Tanggal:    `${dataAi.tanggal}, ${jam}`,
        Jenis:      dataAi.jenis,
        Kategori:   dataAi.kategori,
        Nominal:    dataAi.nominal,
        Keterangan: dataAi.keterangan,
        Dompet:     dom,
        Saldo:      saldoBaru
    });

    let budgetAlert = null;
    if (dataAi.jenis==="Pengeluaran") {
        const budget   = getBudget(jid);
        const lapBulan = await buatLaporanKeuangan("bulan", jid);
        const total    = lapBulan.detailKategori[dataAi.kategori]||0;
        const limit    = budget[dataAi.kategori];
        if (limit) {
            if (total>=limit)       budgetAlert=`🚨 *BUDGET OVERLIMIT!*\n*${dataAi.kategori}* bulan ini: *Rp ${formatRupiah(total)}* dari limit *Rp ${formatRupiah(limit)}*.`;
            else if (total>=limit*0.85) budgetAlert=`⚠️ *PERINGATAN ANGGARAN!*\n*${dataAi.kategori}* sudah 85%: *Rp ${formatRupiah(total)}* / Rp ${formatRupiah(limit)}.`;
        }
    }

    return { saldoDompetBaru: saldoBaru, budgetAlert };
}

async function hapusTransaksiTerakhir(jid) {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();
    if (rows.length===0) return null;
    const baris = rows[rows.length-1];
    const data  = { jenis:baris.get("Jenis"), nominal:Number(baris.get("Nominal")||0), keterangan:baris.get("Keterangan") };
    await baris.delete();
    return data;
}

async function resetSeluruhData(jid) {
    const sheet = await getSheetByNomor(jid);
    await sheet.clearRows();
}

// ── SET BUDGET CUSTOM ─────────────────────────────────────────
function parseBudgetCustom(teks) {
    // format: "set budget Konsumsi 2jt"
    const m = teks.match(/set\s+budget\s+(.+?)\s+([\d,.]+\s*(?:k|rb|ribu|jt|juta|m)?)/i);
    if (!m) return null;
    const kategori = m[1].trim();
    const nominal  = parseNominalDariTeks(m[2]);
    if (!nominal) return null;
    return { kategori, nominal: nominal.nominal };
}

// ── PENGINGAT OTOMATIS ────────────────────────────────────────
function aktifkanPengingat(jid, sock) {
    if (reminderAktif[jid]) return false; // sudah aktif

    // Kirim pengingat setiap malam jam 20:00 WITA
    const checkInterval = setInterval(async () => {
        const now  = new Date();
        const wita = new Date(now.toLocaleString("en-US",{timeZone:APP_TIMEZONE}));
        if (wita.getHours()===20 && wita.getMinutes()===0) {
            const tips = await dapatkanTipsHarian();
            await sock.sendMessage(jid, {
                text: `🔔 *PENGINGAT HARIAN*\n\nSudah catat keuangan hari ini? 📝\n\nKetik *hari ini* untuk lihat ringkasan.\n\n${tips}`
            });
        }
    }, 60000); // cek setiap menit

    reminderAktif[jid] = checkInterval;
    return true;
}

function matikanPengingat(jid) {
    if (!reminderAktif[jid]) return false;
    clearInterval(reminderAktif[jid]);
    delete reminderAktif[jid];
    return true;
}

// ── TREN HARIAN ───────────────────────────────────────────────
async function buatTrenHarian(jid, hari=7) {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();
    const sekarang = new Date();
    const peta  = {};

    for (let i=0; i<hari; i++) {
        const d = new Date(sekarang);
        d.setDate(d.getDate()-i);
        const key = d.toLocaleDateString("id-ID",{timeZone:APP_TIMEZONE,day:"2-digit",month:"2-digit"}).replace(/\./g,"/");
        peta[key] = { masuk:0, keluar:0 };
    }

    for (const row of rows) {
        const tglStr = String(row.get("Tanggal")||"");
        if (!tglStr) continue;
        const [tglBagian] = tglStr.split(", ");
        const [h,b,t]     = tglBagian.split("/").map(Number);
        if (!h||!b||!t) continue;

        const tgl = new Date(t, b-1, h);
        const selisih = (sekarang-tgl)/(1000*60*60*24);
        if (selisih>hari) continue;

        const keyRow = `${String(h).padStart(2,"0")}/${String(b).padStart(2,"0")}`;
        if (!peta[keyRow]) continue;

        const jenis  = String(row.get("Jenis")||"").toLowerCase();
        const nominal= Number(row.get("Nominal")||0);
        if (jenis==="pemasukan") peta[keyRow].masuk  += nominal;
        else                     peta[keyRow].keluar += nominal;
    }

    return Object.entries(peta)
        .reverse()
        .map(([label, d]) => ({ label, ...d }));
}

// ── DASHBOARD WEB HTML ────────────────────────────────────────
function buatHalamanWeb(status) {
    const now = new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE});
    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot Keuangan WA - Dashboard</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
  .header{background:linear-gradient(135deg,#1e40af,#065f46);padding:24px 32px;display:flex;align-items:center;gap:16px}
  .header h1{font-size:1.5rem;font-weight:700}
  .header .badge{background:rgba(255,255,255,.15);padding:4px 12px;border-radius:999px;font-size:.75rem}
  .status-dot{width:12px;height:12px;border-radius:50%;background:${status.connected?'#22c55e':'#ef4444'};animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
  .container{max-width:960px;margin:32px auto;padding:0 16px;display:grid;gap:24px}
  .card{background:#1e293b;border-radius:16px;padding:24px;border:1px solid #334155}
  .card h2{font-size:1rem;font-weight:600;color:#94a3b8;margin-bottom:16px;text-transform:uppercase;letter-spacing:.05em}
  .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}
  .stat{background:#0f172a;border-radius:12px;padding:16px;border:1px solid #1e293b}
  .stat .label{font-size:.75rem;color:#64748b;margin-bottom:4px}
  .stat .val{font-size:1.25rem;font-weight:700}
  .stat.green .val{color:#22c55e}
  .stat.red .val{color:#ef4444}
  .stat.blue .val{color:#60a5fa}
  .stat.yellow .val{color:#fbbf24}
  .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;font-size:.75rem;font-weight:600}
  .pill.online{background:#14532d;color:#22c55e}
  .pill.offline{background:#450a0a;color:#ef4444}
  .cmd-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
  .cmd{background:#0f172a;border-radius:8px;padding:12px;border-left:3px solid #3b82f6}
  .cmd .code{font-family:monospace;color:#60a5fa;font-size:.85rem;font-weight:600}
  .cmd .desc{font-size:.75rem;color:#64748b;margin-top:2px}
  footer{text-align:center;padding:24px;color:#475569;font-size:.75rem}
</style>
</head>
<body>
<div class="header">
  <div class="status-dot"></div>
  <div>
    <h1>🤖 Bot Keuangan WhatsApp</h1>
    <span class="badge">Node.js + Baileys + Gemini AI</span>
  </div>
</div>

<div class="container">
  <div class="card">
    <h2>Status Sistem</h2>
    <div class="stat-grid">
      <div class="stat ${status.connected?'green':'red'}">
        <div class="label">Status Bot</div>
        <div class="val">${status.connected?'🟢 Online':'🔴 Offline'}</div>
      </div>
      <div class="stat blue">
        <div class="label">Metode Login</div>
        <div class="val">📲 Pairing Code</div>
      </div>
      <div class="stat yellow">
        <div class="label">Reconnect</div>
        <div class="val">${status.reconnect}x</div>
      </div>
      <div class="stat blue">
        <div class="label">Waktu Server</div>
        <div class="val" style="font-size:.9rem">${now}</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>⚡ Fitur Unggulan</h2>
    <div class="cmd-list">
      <div class="cmd"><div class="code">📊 Grafik ASCII</div><div class="desc">Visualisasi pengeluaran per kategori langsung di WA</div></div>
      <div class="cmd"><div class="code">📈 Tren Harian</div><div class="desc">Lihat tren 7 hari terakhir dengan grafik emoji</div></div>
      <div class="cmd"><div class="code">🤖 Analisis AI</div><div class="desc">Ringkasan & saran keuangan bulanan dari Gemini AI</div></div>
      <div class="cmd"><div class="code">🔍 Cari Transaksi</div><div class="desc">Cari riwayat berdasarkan kata kunci</div></div>
      <div class="cmd"><div class="code">📤 Export Laporan</div><div class="desc">Export laporan lengkap format teks rapi</div></div>
      <div class="cmd"><div class="code">🎯 Budget Custom</div><div class="desc">Set batas anggaran per kategori sendiri</div></div>
      <div class="cmd"><div class="code">🔔 Pengingat</div><div class="desc">Notifikasi otomatis jam 8 malam untuk catat keuangan</div></div>
      <div class="cmd"><div class="code">💡 Tips Harian</div><div class="desc">Tips keuangan dari AI setiap hari</div></div>
    </div>
  </div>

  <div class="card">
    <h2>📋 Perintah Lengkap</h2>
    <div class="cmd-list">
      <div class="cmd"><div class="code">menu</div><div class="desc">Tampilkan semua perintah</div></div>
      <div class="cmd"><div class="code">saldo</div><div class="desc">Total pemasukan & pengeluaran</div></div>
      <div class="cmd"><div class="code">dompet</div><div class="desc">Saldo per akun/dompet</div></div>
      <div class="cmd"><div class="code">budget</div><div class="desc">Monitor anggaran per kategori</div></div>
      <div class="cmd"><div class="code">hari ini / minggu ini / bulan ini</div><div class="desc">Rekap periode</div></div>
      <div class="cmd"><div class="code">grafik bulan ini</div><div class="desc">Grafik pengeluaran per kategori</div></div>
      <div class="cmd"><div class="code">tren</div><div class="desc">Grafik tren 7 hari terakhir</div></div>
      <div class="cmd"><div class="code">analisis</div><div class="desc">Analisis AI keuangan bulanan</div></div>
      <div class="cmd"><div class="code">cari [kata]</div><div class="desc">Cari transaksi</div></div>
      <div class="cmd"><div class="code">export bulan ini</div><div class="desc">Export laporan teks</div></div>
      <div class="cmd"><div class="code">set budget [kat] [nominal]</div><div class="desc">Set budget custom</div></div>
      <div class="cmd"><div class="code">tips</div><div class="desc">Tips keuangan harian dari AI</div></div>
      <div class="cmd"><div class="code">pengingat on/off</div><div class="desc">Aktifkan/matikan notifikasi malam</div></div>
      <div class="cmd"><div class="code">riwayat</div><div class="desc">15 transaksi terakhir</div></div>
      <div class="cmd"><div class="code">undo</div><div class="desc">Hapus transaksi terakhir</div></div>
      <div class="cmd"><div class="code">#reset</div><div class="desc">Hapus semua data</div></div>
    </div>
  </div>
</div>

<footer>Bot Keuangan WA &bull; Powered by Baileys + Google Sheets + Gemini AI</footer>
</body>
</html>`;
}

// ── KEEP-ALIVE SERVER ─────────────────────────────────────────
function startKeepAliveServer() {
    const server = http.createServer((req, res) => {
        if (req.url==="/"||req.url==="/dashboard") {
            const html = buatHalamanWeb({ connected: !!sockGlobal, reconnect: jumlahReconnect });
            res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
            res.end(html);
            return;
        }
        if (req.url==="/health"||req.url==="/api/status") {
            res.writeHead(200,{"Content-Type":"application/json"});
            res.end(JSON.stringify({
                status:"online",
                bot: sockGlobal?"aktif":"tidak_aktif",
                reconnect: jumlahReconnect,
                time: new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE})
            }));
            return;
        }
        res.writeHead(404); res.end("Not Found");
    });

    server.listen(PORT, () => console.log(`🌐 Dashboard aktif: http://localhost:${PORT}`));
    setInterval(()=>console.log(`💓 Hidup: ${new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE})}`), 5*60*1000);
}

// ── SOCKET MANAGEMENT ─────────────────────────────────────────
function cleanupSocket() {
    try {
        if (sockGlobal?.ev?.removeAllListeners) {
            sockGlobal.ev.removeAllListeners("connection.update");
            sockGlobal.ev.removeAllListeners("messages.upsert");
            sockGlobal.ev.removeAllListeners("creds.update");
        }
        if (sockGlobal?.ws?.close) sockGlobal.ws.close();
    } catch(e) { console.log("⚠️ Cleanup socket:", e.message); }
    sockGlobal = null;
}

function jadwalkanReconnect(alasan="?", jedaKhusus=null) {
    if (reconnectTimer) return;
    jumlahReconnect++;
    const jeda = jedaKhusus || Math.min(5000+jumlahReconnect*3000, 60000);
    console.log(`🔄 Reconnect (${alasan}) dalam ${jeda/1000}s`);
    reconnectTimer = setTimeout(async()=>{ reconnectTimer=null; sedangStart=false; cleanupSocket(); await startBot(); }, jeda);
}

// ── PESAN RESPON ──────────────────────────────────────────────
const dapatkanRespon = (kat, data={}) => ({
    vnDitolak:        ["🎙️ *VN belum didukung.*\nTolong ketik lewat teks biasa ya 🙏"],
    suksesMencatat:   [`${data.emoji} *DATA BERHASIL DICATAT!*\n\n📌 *Jenis:* ${data.jenis}\n🏷️ *Kategori:* ${data.kategori}\n💰 *Nominal:* Rp ${data.nominal}\n👛 *Dompet:* ${String(data.dompet||"").toUpperCase()}\n📝 *Keterangan:* "${data.keterangan}"\n📅 *Tanggal:* ${data.tanggal}\n\n🧮 *Saldo Akhir ${String(data.dompet||"").toUpperCase()}:* Rp ${data.saldo_dompet}`],
    suksesUtang:      [`🧾 *CATATAN UTANG/PIUTANG BERHASIL!*\n\n📌 *Tipe:* ${data.kategori}\n📝 *Ket.:* ${data.keterangan}\n💰 *Nominal:* Rp ${data.nominal}\n📅 *Tanggal:* ${data.tanggal}\n\n⏰ Jangan lupa ditagih/dibayar tepat waktu.`],
    suksesUndo:       [`↩️ *TRANSAKSI DIHAPUS!*\n\n"${data.keterangan}" sebesar *Rp ${formatRupiah(data.nominal)}* dibatalkan.`],
    gagalUndo:        ["📭 Tidak ada transaksi yang bisa dihapus."],
    konfirmasiReset:  [`⚠️ *KONFIRMASI RESET DATA*\n\nIni akan menghapus *SEMUA* riwayat keuangan kamu.\n\nKalau yakin, balas: *YA* atau *SETUJU*.`],
    batalReset:       ["✅ *Reset dibatalkan.* Data tetap aman."]
}[kat]?.[0] || "✅ Siap.");

// ── HANDLE MESSAGE ────────────────────────────────────────────
async function handleMessage(sock, msg) {
    if (!msg.message||msg.key.fromMe) return;
    const from = msg.key.remoteJid;
    const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption || "";
    const pesan = text.toLowerCase().trim();

    if (!text && msg.message.audioMessage) return sock.sendMessage(from,{text:dapatkanRespon("vnDitolak")});
    if (!text) return;

    const kirim = t => sock.sendMessage(from,{text:t});

    try {
        await getSheetByNomor(from); // pastikan sheet ada

        // ── KONFIRMASI RESET ────────────────────────────────
        if (statusReset[from]==="MENUNGGU_KONFIRMASI") {
            if (/^(ya|setuju|ok)$/i.test(pesan)) {
                delete statusReset[from];
                await resetSeluruhData(from);
                return kirim("🗑️ *RESET BERHASIL!*\n\nSemua data pembukuan sudah dikosongkan.");
            }
            delete statusReset[from];
            return kirim(dapatkanRespon("batalReset"));
        }

        // ── MENU ────────────────────────────────────────────
        if (/^(menu|help|bantuan|fitur|panduan|cara pakai)$/i.test(pesan)) {
            return kirim(
`🤖 *BOT CATATAN KEUANGAN – VERSI LENGKAP*

Ketik seperti ngobrol biasa ✨

🛒 *Contoh Pengeluaran:*
• beli nasi goreng 25k cash
• bayar wifi 350k gopay
• keluar 100rb bensin mandiri

💵 *Contoh Pemasukan:*
• pemasukan 5jt gaji ke bca
• masuk 750k bonus dana

📊 *Laporan & Visualisasi:*
• *hari ini* / *minggu ini* / *bulan ini*
• *saldo* – ringkasan total
• *dompet* – saldo per akun
• *riwayat* – 15 transaksi terakhir
• *grafik bulan ini* – 📊 grafik ASCII
• *tren* – 📈 tren 7 hari terakhir
• *budget* – monitor anggaran

🤖 *Fitur AI:*
• *analisis* – ringkasan & saran AI
• *tips* – tips keuangan harian

🔍 *Pencarian & Export:*
• *cari [kata kunci]* – cari transaksi
• *export bulan ini* – export laporan

⚙️ *Pengaturan:*
• *set budget [kategori] [nominal]*
• *pengingat on* / *pengingat off*

🚨 *Perintah Darurat:*
• *undo* – hapus transaksi terakhir
• *#reset* – kosongkan semua data`
            );
        }

        // ── DOMPET ──────────────────────────────────────────
        if (/^(dompet|cek dompet|rekening|akun|saldo dompet)$/i.test(pesan)) {
            const lap = await buatLaporanKeuangan("semua", from);
            let teks  = "👛 *SALDO AKUN & DOMPET*\n";
            let total = 0;
            for (const [dom, sal] of Object.entries(lap.saldoDompet)) {
                const icon = sal>=0 ? "✅" : "⚠️";
                teks += `\n${icon} *${dom.toUpperCase()}*: Rp ${formatRupiah(sal)}`;
                total += sal;
            }
            if (Object.keys(lap.saldoDompet).length===0) teks += "\n📭 Belum ada saldo.";
            teks += `\n\n${"─".repeat(33)}\n💰 *TOTAL:* Rp ${formatRupiah(total)}`;
            return kirim(teks);
        }

        // ── BUDGET ──────────────────────────────────────────
        if (/^(budget|cek budget|anggaran|cek anggaran)$/i.test(pesan)) {
            const lap    = await buatLaporanKeuangan("bulan", from);
            const budget = getBudget(from);
            let teks     = "🎯 *MONITOR ANGGARAN BULAN INI*\n";
            for (const [kat, limit] of Object.entries(budget)) {
                const terpakai = lap.detailKategori[kat]||0;
                const persen   = ((terpakai/limit)*100).toFixed(0);
                const bar      = "█".repeat(Math.round(Number(persen)/10)).padEnd(10,"░");
                const icon     = Number(persen)>=100?"🚨":Number(persen)>=85?"⚠️":"✅";
                teks += `\n${icon} *${kat}*\n   [${bar}] ${persen}%\n   Rp ${formatRupiah(terpakai)} / Rp ${formatRupiah(limit)}\n`;
            }
            teks += `\n💡 Ketik *set budget [kategori] [nominal]* untuk ubah limit.`;
            return kirim(teks);
        }

        // ── RIWAYAT ─────────────────────────────────────────
        if (/^(riwayat|history|daftar transaksi|semua transaksi|transaksi terakhir)$/i.test(pesan)) {
            return kirim(await ambilRiwayatTransaksi(15, from));
        }

        // ── SALDO ───────────────────────────────────────────
        if (/^(saldo|laporan|rekap|total)$/i.test(pesan)) {
            const lap = await buatLaporanKeuangan("semua", from);
            const bln = new Date().toLocaleDateString("id-ID",{timeZone:APP_TIMEZONE,month:"long",year:"numeric"});
            return kirim(
`💰 *LAPORAN KEUANGAN TOTAL*
📅 ${bln}

🟢 Pemasukan : Rp ${formatRupiah(lap.totalMasuk)}
🔴 Pengeluaran: Rp ${formatRupiah(lap.totalKeluar)}
${"─".repeat(33)}
🧮 *Saldo Bersih: Rp ${formatRupiah(lap.saldo)}*

📊 Ketik *grafik bulan ini* untuk visualisasi
🤖 Ketik *analisis* untuk saran AI`
            );
        }

        // ── REKAP PERIODE ────────────────────────────────────
        if (/^(hari ini|minggu ini|bulan ini|laporan hari ini|laporan minggu ini|laporan bulan ini)$/i.test(pesan)) {
            const tipe = pesan.includes("hari")?"hari":pesan.includes("minggu")?"minggu":"bulan";
            const lap  = await buatLaporanKeuangan(tipe, from);
            const label= tipe==="hari"?"HARI INI":tipe==="minggu"?"MINGGU INI":"BULAN INI";
            let teks   =
`📊 *STATISTIK ${label}*

🟢 Masuk : Rp ${formatRupiah(lap.totalMasuk)}
🔴 Keluar: Rp ${formatRupiah(lap.totalKeluar)}
${"─".repeat(33)}
🧮 *Bersih: Rp ${formatRupiah(lap.saldo)}*

🏷️ *Pengeluaran per Kategori:*`;

            if (Object.keys(lap.detailKategori).length===0) {
                teks += "\n📭 Belum ada pengeluaran.";
            } else {
                const total = Object.values(lap.detailKategori).reduce((a,b)=>a+b,0)||1;
                for (const [k,v] of Object.entries(lap.detailKategori).sort((a,b)=>b[1]-a[1])) {
                    const pct = ((v/total)*100).toFixed(0);
                    teks += `\n• ${k}: Rp ${formatRupiah(v)} (${pct}%)`;
                }
            }

            teks += `\n\n📊 Ketik *grafik ${tipe==="bulan"?"bulan ini":tipe==="minggu"?"minggu ini":"hari ini"}* untuk grafik visual`;
            return kirim(teks);
        }

        // ── GRAFIK ASCII ─────────────────────────────────────
        if (/^grafik\s*(hari ini|minggu ini|bulan ini|semua)?$/i.test(pesan)) {
            const tipe = pesan.includes("hari")?"hari":pesan.includes("minggu")?"minggu":pesan.includes("semua")?"semua":"bulan";
            const lap  = await buatLaporanKeuangan(tipe, from);
            const label= tipe==="hari"?"HARI INI":tipe==="minggu"?"7 HARI TERAKHIR":tipe==="semua"?"SEMUA WAKTU":"BULAN INI";

            if (Object.keys(lap.detailKategori).length===0) {
                return kirim(`📊 Belum ada data pengeluaran untuk periode *${label}*.`);
            }

            const grafik = buatGrafikBar(lap.detailKategori, `PENGELUARAN ${label}`);
            const ringkasan =
`\n💰 Total Keluar: Rp ${formatRupiah(lap.totalKeluar)}
🟢 Total Masuk : Rp ${formatRupiah(lap.totalMasuk)}
📈 Saldo Bersih: Rp ${formatRupiah(lap.saldo)}`;

            return kirim(grafik + ringkasan);
        }

        // ── TREN HARIAN ──────────────────────────────────────
        if (/^(tren|trend|grafik tren|tren 7 hari)$/i.test(pesan)) {
            const dataTren = await buatTrenHarian(from, 7);
            const grafik   = buatGrafikTren(dataTren, "TREN 7 HARI TERAKHIR");
            return kirim(grafik + "\n\n💡 Ketik *analisis* untuk insight AI dari data kamu.");
        }

        // ── ANALISIS AI ──────────────────────────────────────
        if (/^(analisis|analisa|insight|review keuangan|analisis keuangan)$/i.test(pesan)) {
            await kirim("🤖 _Sedang menganalisis data keuangan kamu..._");
            const lap    = await buatLaporanKeuangan("bulan", from);
            const insight= await analisisAIKeuangan(lap, "bulan ini");
            return kirim(`🤖 *ANALISIS AI – KEUANGAN BULAN INI*\n\n${insight}`);
        }

        // ── TIPS HARIAN ──────────────────────────────────────
        if (/^(tips|tip|tips keuangan|saran keuangan)$/i.test(pesan)) {
            await kirim("💡 _Mengambil tips dari AI..._");
            const tips = await dapatkanTipsHarian();
            return kirim(`💡 *TIPS KEUANGAN HARI INI*\n\n${tips}`);
        }

        // ── CARI TRANSAKSI ────────────────────────────────────
        if (/^cari\s+.+/i.test(pesan)) {
            const kw = pesan.replace(/^cari\s+/i,"").trim();
            return kirim(await cariTransaksi(kw, from));
        }

        // ── EXPORT LAPORAN ────────────────────────────────────
        if (/^export\s*(hari ini|minggu ini|bulan ini|semua)?$/i.test(pesan)) {
            const tipe = pesan.includes("hari")?"hari":pesan.includes("minggu")?"minggu":pesan.includes("semua")?"semua":"bulan";
            await kirim("📤 _Menyiapkan laporan ekspor..._");
            const laporan = await eksporLaporan(tipe, from);
            return kirim(laporan);
        }

        // ── SET BUDGET CUSTOM ─────────────────────────────────
        if (/^set\s+budget\b/i.test(pesan)) {
            const hasil = parseBudgetCustom(text);
            if (!hasil) return kirim("⚠️ Format salah. Contoh:\n*set budget Konsumsi 2jt*\n*set budget Hiburan 500k*");
            if (!budgetCustom[from]) budgetCustom[from] = {};
            budgetCustom[from][hasil.kategori] = hasil.nominal;

            // coba cocokkan nama kategori (fuzzy)
            const kategoriBudget = Object.keys(BUDGET_DEFAULT);
            const cocok = kategoriBudget.find(k => k.toLowerCase().includes(hasil.kategori.toLowerCase()));
            const namaFinal = cocok||hasil.kategori;
            budgetCustom[from][namaFinal] = hasil.nominal;

            return kirim(`✅ *Budget berhasil diset!*\n\n🏷️ Kategori: *${namaFinal}*\n💰 Limit: *Rp ${formatRupiah(hasil.nominal)}/bulan*\n\nKetik *budget* untuk cek semua anggaran.`);
        }

        // ── PENGINGAT ─────────────────────────────────────────
        if (/^pengingat\s+(on|aktif|nyalakan)$/i.test(pesan)) {
            const berhasil = aktifkanPengingat(from, sock);
            return kirim(berhasil
                ? "🔔 *Pengingat harian aktif!*\n\nKamu akan mendapat notifikasi setiap malam jam 20:00 WITA untuk mencatat keuangan. 💪"
                : "ℹ️ Pengingat sudah aktif sebelumnya."
            );
        }
        if (/^pengingat\s+(off|mati|matikan)$/i.test(pesan)) {
            const berhasil = matikanPengingat(from);
            return kirim(berhasil
                ? "🔕 *Pengingat dimatikan.*\n\nKamu bisa nyalakan lagi kapanpun dengan *pengingat on*."
                : "ℹ️ Pengingat belum aktif."
            );
        }

        // ── UNDO ─────────────────────────────────────────────
        if (/^(batal|undo|hapus terakhir)$/i.test(pesan)) {
            const hasilHapus = await hapusTransaksiTerakhir(from);
            if (!hasilHapus) return kirim(dapatkanRespon("gagalUndo"));
            return kirim(dapatkanRespon("suksesUndo", hasilHapus));
        }

        // ── RESET ─────────────────────────────────────────────
        if (/^(#reset|reset data)$/i.test(pesan)) {
            statusReset[from] = "MENUNGGU_KONFIRMASI";
            return kirim(dapatkanRespon("konfirmasiReset"));
        }

        // ── CATAT TRANSAKSI ───────────────────────────────────
        let dataAi = parsingPerintahTransaksi(text);
        if (!dataAi.is_transaksi) dataAi = await analisisPesanDenganAI(text);

        if (dataAi && dataAi.is_transaksi) {
            const { saldoDompetBaru, budgetAlert } = await simpanKeSheet(dataAi, from);
            const katLower = dataAi.kategori.toLowerCase();
            let balas;

            if (katLower==="utang"||katLower==="piutang") {
                balas = dapatkanRespon("suksesUtang",{
                    kategori:    dataAi.kategori,
                    nominal:     formatRupiah(dataAi.nominal),
                    keterangan:  dataAi.keterangan,
                    tanggal:     dataAi.tanggal
                });
            } else {
                balas = dapatkanRespon("suksesMencatat",{
                    emoji:       dataAi.jenis==="Pemasukan"?"🟢":"🔴",
                    jenis:       dataAi.jenis,
                    kategori:    dataAi.kategori,
                    nominal:     formatRupiah(dataAi.nominal),
                    keterangan:  dataAi.keterangan,
                    dompet:      dataAi.dompet,
                    tanggal:     dataAi.tanggal,
                    saldo_dompet:formatRupiah(saldoDompetBaru)
                });
            }

            if (budgetAlert) balas += `\n\n${budgetAlert}`;
            return kirim(balas);
        }

        return kirim(
`❓ *Aku belum paham maksudnya.*

Coba ketik transaksi seperti:
• pengeluaran 25k makan cash
• pemasukan 5jt gaji ke bca
• bayar listrik 300k gopay

Atau ketik *menu* untuk semua perintah 📋`
        );

    } catch(e) {
        console.error("❌ Error proses pesan:", e.message||e);
        return kirim("⚠️ Sistem sedang memproses. Mohon kirim ulang beberapa saat lagi.");
    }
}

// ── START BOT ─────────────────────────────────────────────────
async function startBot() {
    if (sedangStart) { console.log("⏳ Start dobel dilewati."); return; }
    sedangStart = true;

    try {
        console.log("🚀 Memulai Bot Keuangan...");
        cleanupSocket();

        const { state, saveCreds } = await useMultiFileAuthState("./session");
        const { version }          = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth:                state,
            logger:              pino({level:"silent"}),
            printQRInTerminal:   false,
            browser:             ["Ubuntu","Chrome","20.0.04"],
            connectTimeoutMs:    90_000,
            keepAliveIntervalMs: 30_000,
            retryRequestDelayMs: 5_000,
            markOnlineOnConnect: false,
            syncFullHistory:     false,
            shouldIgnoreJid:     jid => jid?.includes("@broadcast")
        });

        sockGlobal = sock;
        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async({connection,qr,lastDisconnect}) => {
            if (qr) console.log("📌 QR diterima (diabaikan – memakai pairing code)");
            if (connection==="connecting") console.log("🔌 Menghubungkan ke WhatsApp...");

            if (connection==="open") {
                console.log("✅ Bot terhubung!");
                sedangStart=false; jumlahReconnect=0;
                if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer=null; }
            }

            if (connection==="close") {
                sedangStart=false;
                const kode   = lastDisconnect?.error?.output?.statusCode;
                const alasan = String(lastDisconnect?.error?.message||"").toLowerCase();
                console.log(`⚠️ Koneksi putus. Kode: ${kode||"?"} | ${alasan}`);
                cleanupSocket();

                if (kode===DisconnectReason.loggedOut) { console.log("❌ Logout. Hapus folder session dan deploy ulang."); return; }
                if (kode===440||alasan.includes("conflict")) return jadwalkanReconnect("conflict", 60000);
                if (kode===408||alasan.includes("timed out")) return jadwalkanReconnect("timeout", 20000);
                if (kode===515) return jadwalkanReconnect("restart required", 15000);
                jadwalkanReconnect("close", 20000);
            }
        });

        sock.ev.on("messages.upsert", async({messages}) => {
            try { const m=messages?.[0]; if (m) await handleMessage(sock,m); }
            catch(e) { console.error("❌ messages.upsert:", e.message||e); }
        });

        if (!sock.authState.creds.registered) {
            const nomor = WHATSAPP_PHONE_NUMBER;
            if (!nomor||nomor.length<10) throw new Error("WHATSAPP_PHONE_NUMBER belum diisi dengan benar.");
            console.log("⏳ Menunggu koneksi sebelum meminta kode...");
            await tunggu(5000);
            console.log("🔐 Meminta pairing code...");
            try {
                const kode = await sock.requestPairingCode(nomor);
                const rapi = String(kode).match(/.{1,4}/g)?.join("-")||kode;
                console.log("\n========================================");
                console.log(`🔑 KODE MASUK WHATSAPP: ${rapi}`);
                console.log("========================================\n");
                console.log("📲 Buka WA → Perangkat Tertaut → Tautkan dengan Nomor Telepon → Masukkan kode di atas\n");
            } catch(e) {
                console.log("❌ Gagal pairing code:", e.message);
                sedangStart=false; cleanupSocket();
                jadwalkanReconnect("gagal pairing code", 30000);
                return;
            }
        } else {
            console.log("✅ Session sudah terdaftar.");
        }

        sedangStart = false;
    } catch(e) {
        sedangStart=false; cleanupSocket();
        console.error("❌ Gagal start:", e.message||e);
        jadwalkanReconnect("gagal start", 30000);
    }
}

// ── PROCESS HANDLERS ─────────────────────────────────────────
process.on("uncaughtException",   e => { console.error("🔥 uncaughtException:",  e.message||e); jadwalkanReconnect("exception",15000); });
process.on("unhandledRejection",  e => { console.error("🔥 unhandledRejection:", e?.message||e); jadwalkanReconnect("rejection",15000); });
process.on("SIGINT",  () => { console.log("🛑 Bot dihentikan."); cleanupSocket(); process.exit(0); });
process.on("SIGTERM", () => { console.log("🛑 Bot SIGTERM."); cleanupSocket(); process.exit(0); });

if (!sudahStartKeepAlive) { sudahStartKeepAlive=true; startKeepAliveServer(); }
startBot();
