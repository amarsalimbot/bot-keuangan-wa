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
const OpenAI = require("openai");
const pino = require("pino");
const http = require("http");

// ── ENV ──────────────────────────────────────────────────────
const SPREADSHEET_ID            = process.env.SPREADSHEET_ID || "";
const OPENAI_API_KEY            = process.env.OPENAI_API_KEY || process.env.CHATGPT_API_KEY || "";
const OPENAI_MODEL              = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GEMINI_API_KEY            = process.env.GEMINI_API_KEY || "";
const WHATSAPP_PHONE_NUMBER     = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\D/g, "");
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
const APP_TIMEZONE              = "Asia/Makassar";
const PORT                      = process.env.PORT || 7860;

if (!SPREADSHEET_ID)             throw new Error("SPREADSHEET_ID belum diisi.");
if (!OPENAI_API_KEY && !GEMINI_API_KEY) throw new Error("OPENAI_API_KEY/CHATGPT_API_KEY atau GEMINI_API_KEY belum diisi.");
if (!GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON belum diisi.");
if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY belum diisi. AI utama ChatGPT nonaktif, memakai Gemini jika tersedia.");
if (!GEMINI_API_KEY) console.warn("⚠️ GEMINI_API_KEY belum diisi. Fallback Gemini nonaktif.");

let serviceAccount;
try { serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON); }
catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON tidak valid JSON."); }

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

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
const BATAS_PESAN_WHATSAPP = 3500;
const BARIS_PER_HALAMAN = 20;

// ── UTILITAS ─────────────────────────────────────────────────
const tunggu      = ms => new Promise(r => setTimeout(r, ms));
const formatRupiah = n => Number(n||0).toLocaleString("id-ID");
const ambilNomorDariJid = jid => String(jid||"").split("@")[0].replace(/\D/g,"");

function sekarangWita() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: APP_TIMEZONE }));
}

function tanggalHariIni() {
    return new Date().toLocaleDateString("id-ID",{
        timeZone: APP_TIMEZONE, day:"2-digit", month:"2-digit", year:"numeric"
    }).replace(/\./g,"/");
}

function labelPeriode(tipe) {
    if (tipe === "hari") return "Hari Ini";
    if (tipe === "minggu") return "7 Hari Terakhir";
    if (tipe === "bulan") return "Bulan Ini";
    return "Semua Waktu";
}

function potongTeks(value, max = 18) {
    const teks = String(value ?? "-").replace(/\s+/g, " ").trim();
    if (teks.length <= max) return teks;
    return `${teks.slice(0, Math.max(1, max - 1))}…`;
}

function padCell(value, width, align = "left") {
    const text = potongTeks(value, width);
    const gap = Math.max(width - text.length, 0);
    return align === "right" ? `${" ".repeat(gap)}${text}` : `${text}${" ".repeat(gap)}`;
}

function buatTabelWhatsapp(columns, rows, { title = "", maxRows = BARIS_PER_HALAMAN, emptyText = "Tidak ada data." } = {}) {
    if (rows.length === 0) {
        return title ? `*${title}*\n_${emptyText}_` : `_${emptyText}_`;
    }

    const widths = columns.map(col => {
        const minWidth = String(col.label || col.key).length;
        const contentWidth = Math.max(minWidth, ...rows.map(row => String(row[col.key] ?? "").length));
        return Math.min(col.width || 18, Math.max(minWidth, contentWidth));
    });

    const header = columns.map((col, i) => padCell(col.label || col.key, widths[i], col.align)).join(" | ");
    const separator = widths.map(w => "-".repeat(w)).join("-|-");
    const pageSize = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : rows.length;
    const jumlahHalaman = Math.ceil(rows.length / pageSize);

    return Array.from({ length: jumlahHalaman }, (_, halaman) => {
        const data = rows.slice(halaman * pageSize, (halaman + 1) * pageSize);
        const body = data.map(row => columns.map((col, i) => padCell(row[col.key], widths[i], col.align)).join(" | ")).join("\n");
        const judulHalaman = title
            ? `*${title}${jumlahHalaman > 1 ? ` (${halaman + 1}/${jumlahHalaman})` : ""}*\n`
            : "";
        return `${judulHalaman}\`\`\`\n${header}\n${separator}\n${body}\n\`\`\``;
    }).join("\n\n");
}

function pecahPesanWhatsapp(value, maxChars = BATAS_PESAN_WHATSAPP) {
    const teks = String(value ?? "").trim();
    if (!teks || teks.length <= maxChars) return teks ? [teks] : [];

    const hasil = [];
    let aktif = "";
    const tambah = bagian => {
        const kandidat = aktif ? `${aktif}\n\n${bagian}` : bagian;
        if (kandidat.length <= maxChars) {
            aktif = kandidat;
            return;
        }
        if (aktif) hasil.push(aktif);
        aktif = "";

        if (bagian.length <= maxChars) {
            aktif = bagian;
            return;
        }

        let potongan = "";
        for (const baris of bagian.split("\n")) {
            const kandidatBaris = potongan ? `${potongan}\n${baris}` : baris;
            if (kandidatBaris.length <= maxChars) {
                potongan = kandidatBaris;
                continue;
            }
            if (potongan) hasil.push(potongan);
            potongan = baris;
            while (potongan.length > maxChars) {
                hasil.push(potongan.slice(0, maxChars));
                potongan = potongan.slice(maxChars);
            }
        }
        aktif = potongan;
    };

    for (const bagian of teks.split(/\n{2,}/).filter(Boolean)) tambah(bagian);
    if (aktif) hasil.push(aktif);
    return hasil;
}

function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function ambilTipeDariPesan(pesan, fallback = "bulan") {
    if (pesan.includes("hari")) return "hari";
    if (pesan.includes("minggu")) return "minggu";
    if (pesan.includes("semua") || pesan.includes("total")) return "semua";
    return fallback;
}

function formatProviderAI() {
    if (openai && ai) return `ChatGPT (${OPENAI_MODEL}) utama, Gemini fallback`;
    if (openai) return `ChatGPT (${OPENAI_MODEL})`;
    if (ai) return "Gemini";
    return "Tidak aktif";
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
    const transaksi = [];
    const sekarang = sekarangWita();

    for (const row of rows) {
        const tglStr = String(row.get("Tanggal")||"");
        if (!tglStr) continue;
        const [tglBagian] = tglStr.split(", ");
        const [hari, bulan, tahun] = tglBagian.split("/").map(Number);
        if (!hari||!bulan||!tahun) continue;

        const tglTransaksi = new Date(tahun, bulan-1, hari);
        const selisihHari  = (sekarang - tglTransaksi)/(1000*60*60*24);

        let valid = false;
        const tanggalSama = tglTransaksi.getDate()===sekarang.getDate() &&
            tglTransaksi.getMonth()===sekarang.getMonth() &&
            tglTransaksi.getFullYear()===sekarang.getFullYear();
        if (tipe==="hari"   && tanggalSama) valid=true;
        if (tipe==="minggu" && selisihHari>=0 && selisihHari<=7) valid=true;
        if (tipe==="bulan"  && tglTransaksi.getMonth()===sekarang.getMonth() && tglTransaksi.getFullYear()===sekarang.getFullYear()) valid=true;
        if (tipe==="semua") valid=true;

        const jenis   = String(row.get("Jenis")||"").toLowerCase().trim();
        const nominal = Number(row.get("Nominal")||0);
        const kategori= String(row.get("Kategori")||"Lainnya");
        const dompet  = String(row.get("Dompet")||"cash").toLowerCase().trim();
        const keterangan = String(row.get("Keterangan")||"-");
        const saldoRow = Number(row.get("Saldo")||0);

        // saldo dompet (selalu semua data)
        saldoDompet[dompet] = (saldoDompet[dompet]||0) + (jenis==="pemasukan" ? nominal : -nominal);

        if (valid) {
            if (jenis==="pemasukan") totalMasuk  += nominal;
            else                     { totalKeluar += nominal; detailKategori[kategori]=(detailKategori[kategori]||0)+nominal; }

            transaksi.push({
                tanggal: tglBagian,
                tanggalLengkap: tglStr,
                jenis: jenis==="pemasukan" ? "Pemasukan" : "Pengeluaran",
                kategori,
                nominal,
                keterangan,
                dompet,
                saldo: saldoRow
            });

            // tren harian (untuk grafik)
            const kunciTren = `${String(hari).padStart(2,"0")}/${String(bulan).padStart(2,"0")}`;
            if (!trenHarian[kunciTren]) trenHarian[kunciTren]={masuk:0,keluar:0};
            if (jenis==="pemasukan") trenHarian[kunciTren].masuk  += nominal;
            else                     trenHarian[kunciTren].keluar += nominal;
        }
    }

    return { totalMasuk, totalKeluar, saldo: totalMasuk-totalKeluar, detailKategori, saldoDompet, trenHarian, transaksi, rows };
}

async function buatLaporanTabel(tipe, jid) {
    const lap = await buatLaporanKeuangan(tipe, jid);
    const periode = labelPeriode(tipe);
    const now = new Date().toLocaleString("id-ID", { timeZone: APP_TIMEZONE });
    const rasioSisa = lap.totalMasuk > 0 ? `${((lap.saldo / lap.totalMasuk) * 100).toFixed(0)}%` : "-";
    const transaksiMasuk = lap.transaksi.filter(trx => trx.jenis === "Pemasukan");
    const transaksiKeluar = lap.transaksi.filter(trx => trx.jenis === "Pengeluaran");
    const rataKeluar = transaksiKeluar.length ? lap.totalKeluar / transaksiKeluar.length : 0;
    const terbesarKeluar = transaksiKeluar.reduce((terbesar, trx) => trx.nominal > (terbesar?.nominal || 0) ? trx : terbesar, null);
    const kategoriTerbesar = Object.entries(lap.detailKategori).sort((a,b)=>b[1]-a[1])[0];

    const ringkasanRows = [
        { item: "Pemasukan", nilai: `Rp ${formatRupiah(lap.totalMasuk)}` },
        { item: "Pengeluaran", nilai: `Rp ${formatRupiah(lap.totalKeluar)}` },
        { item: "Saldo Bersih", nilai: `Rp ${formatRupiah(lap.saldo)}` },
        { item: "Rasio Sisa", nilai: rasioSisa },
        { item: "Total Transaksi", nilai: formatRupiah(lap.transaksi.length) },
        { item: "Transaksi Masuk", nilai: formatRupiah(transaksiMasuk.length) },
        { item: "Transaksi Keluar", nilai: formatRupiah(transaksiKeluar.length) },
        { item: "Rata-rata Keluar", nilai: `Rp ${formatRupiah(rataKeluar)}` },
        { item: "Keluar Terbesar", nilai: terbesarKeluar ? `Rp ${formatRupiah(terbesarKeluar.nominal)}` : "-" }
    ];

    const totalKategori = Object.values(lap.detailKategori).reduce((a,b)=>a+b,0) || 1;
    const kategoriRows = Object.entries(lap.detailKategori)
        .sort((a,b)=>b[1]-a[1])
        .map(([kategori, nominal], i) => ({
            no: i + 1,
            kategori,
            nominal: formatRupiah(nominal),
            persen: `${((nominal / totalKategori) * 100).toFixed(0)}%`
        }));

    const dompetRows = Object.entries(lap.saldoDompet)
        .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))
        .map(([dompet, saldo]) => ({
            dompet: dompet.toUpperCase(),
            saldo: formatRupiah(saldo)
        }));

    const transaksiRows = lap.transaksi
        .slice()
        .reverse()
        .map((trx, index) => ({
            no: index + 1,
            tgl: trx.tanggalLengkap || trx.tanggal,
            tipe: trx.jenis === "Pemasukan" ? "+" : "-",
            kategori: trx.kategori,
            ket: trx.keterangan,
            dompet: trx.dompet.toUpperCase(),
            rp: formatRupiah(trx.nominal)
        }));

    let teks = `📋 *LAPORAN KEUANGAN - ${periode.toUpperCase()}*\n🕒 ${now}\n\n`;
    teks += buatTabelWhatsapp([
        { key:"item", label:"Ringkasan", width:14 },
        { key:"nilai", label:"Nilai", width:18, align:"right" }
    ], ringkasanRows, { title:"Ringkasan Utama" });

    teks += "\n\n" + buatTabelWhatsapp([
        { key:"no", label:"No", width:2, align:"right" },
        { key:"kategori", label:"Kategori", width:18 },
        { key:"nominal", label:"Nominal", width:13, align:"right" },
        { key:"persen", label:"%", width:4, align:"right" }
    ], kategoriRows, { title:"Pengeluaran per Kategori", emptyText:"Belum ada pengeluaran pada periode ini." });

    teks += "\n\n" + buatTabelWhatsapp([
        { key:"dompet", label:"Dompet", width:12 },
        { key:"saldo", label:"Saldo", width:15, align:"right" }
    ], dompetRows, { title:"Saldo per Dompet", emptyText:"Belum ada saldo dompet." });

    teks += "\n\n" + buatTabelWhatsapp([
        { key:"no", label:"No", width:3, align:"right" },
        { key:"tgl", label:"Tanggal", width:20 },
        { key:"tipe", label:"+/-", width:3 },
        { key:"kategori", label:"Kategori", width:15 },
        { key:"ket", label:"Keterangan", width:18 },
        { key:"dompet", label:"Dompet", width:10 },
        { key:"rp", label:"Rp", width:12, align:"right" }
    ], transaksiRows, { title:"Semua Transaksi", maxRows:15, emptyText:"Belum ada transaksi pada periode ini." });

    const status = lap.transaksi.length === 0
        ? "Belum cukup data untuk membaca kondisi keuangan."
        : lap.saldo < 0
            ? `Arus kas sedang defisit Rp ${formatRupiah(Math.abs(lap.saldo))}. Prioritaskan pengeluaran wajib.`
            : kategoriTerbesar
                ? `Kategori terbesar adalah ${kategoriTerbesar[0]} sebesar Rp ${formatRupiah(kategoriTerbesar[1])}.`
                : `Arus kas positif Rp ${formatRupiah(lap.saldo)}.`;

    teks += `\n\n🧭 *SOROTAN OTOMATIS*\n${status}`;
    if (terbesarKeluar) teks += `\nTransaksi keluar terbesar: ${terbesarKeluar.keterangan} (Rp ${formatRupiah(terbesarKeluar.nominal)}).`;
    teks += `\n\n💡 Pintasan: *dashboard*, *analisis*, *riwayat*, atau *export ${tipe === "semua" ? "semua" : periode.toLowerCase()}*.`;
    return teks;
}

async function buatDashboardKeuangan(jid) {
    const lapBulan = await buatLaporanKeuangan("bulan", jid);
    const lapSemua = await buatLaporanKeuangan("semua", jid);
    const budget = getBudget(jid);
    const bulan = new Date().toLocaleDateString("id-ID", { timeZone: APP_TIMEZONE, month:"long", year:"numeric" });
    const rasioSisa = lapBulan.totalMasuk > 0 ? (lapBulan.saldo / lapBulan.totalMasuk) * 100 : 0;
    const status = lapBulan.totalMasuk === 0
        ? "Perlu data"
        : rasioSisa >= 20 ? "Sehat"
        : rasioSisa >= 0 ? "Waspada"
        : "Defisit";
    const topKategori = Object.entries(lapBulan.detailKategori).sort((a,b)=>b[1]-a[1])[0];

    const kpiRows = [
        { item:"Status", nilai: status },
        { item:"Masuk Bulan", nilai:`Rp ${formatRupiah(lapBulan.totalMasuk)}` },
        { item:"Keluar Bulan", nilai:`Rp ${formatRupiah(lapBulan.totalKeluar)}` },
        { item:"Sisa Bulan", nilai:`Rp ${formatRupiah(lapBulan.saldo)}` },
        { item:"Saldo Total", nilai:`Rp ${formatRupiah(lapSemua.saldo)}` },
        { item:"Top Boros", nilai: topKategori ? `${topKategori[0]} (${formatRupiah(topKategori[1])})` : "-" }
    ];

    const budgetRows = Object.entries(budget)
        .map(([kategori, limit]) => {
            const terpakai = lapBulan.detailKategori[kategori] || 0;
            return {
                kategori,
                pakai: formatRupiah(terpakai),
                persen: `${Math.round((terpakai / limit) * 100)}%`,
                sisa: formatRupiah(limit - terpakai)
            };
        })
        .sort((a,b)=>Number(b.persen.replace("%",""))-Number(a.persen.replace("%","")));

    let teks = `📊 *DASHBOARD CATATAN KEUANGAN*\n📅 ${bulan}\n🤖 AI: ${formatProviderAI()}\n\n`;
    teks += buatTabelWhatsapp([
        { key:"item", label:"KPI", width:14 },
        { key:"nilai", label:"Nilai", width:20 }
    ], kpiRows, { title:"Ringkasan Pintar" });

    teks += "\n\n" + buatTabelWhatsapp([
        { key:"kategori", label:"Budget", width:16 },
        { key:"pakai", label:"Pakai", width:12, align:"right" },
        { key:"persen", label:"%", width:4, align:"right" },
        { key:"sisa", label:"Sisa", width:12, align:"right" }
    ], budgetRows, { title:"Status Semua Budget", emptyText:"Belum ada budget." });

    teks += "\n\n⚡ Pintasan: *laporan bulan ini*, *prediksi*, *budget*, *ai kenapa pengeluaran saya naik?*";
    return teks;
}

async function buatPrediksiKeuangan(jid) {
    const lap = await buatLaporanKeuangan("bulan", jid);
    const now = sekarangWita();
    const hariBerjalan = Math.max(1, now.getDate());
    const hariDalamBulan = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const sisaHari = Math.max(1, hariDalamBulan - hariBerjalan);
    const proyeksiKeluar = Math.round((lap.totalKeluar / hariBerjalan) * hariDalamBulan);
    const proyeksiMasuk = Math.round((lap.totalMasuk / hariBerjalan) * hariDalamBulan);
    const proyeksiSaldo = proyeksiMasuk - proyeksiKeluar;
    const batasHarianAman = Math.max(0, Math.round((lap.totalMasuk - lap.totalKeluar) / sisaHari));

    const rows = [
        { item:"Hari berjalan", nilai:`${hariBerjalan}/${hariDalamBulan}` },
        { item:"Keluar saat ini", nilai:`Rp ${formatRupiah(lap.totalKeluar)}` },
        { item:"Proyeksi keluar", nilai:`Rp ${formatRupiah(proyeksiKeluar)}` },
        { item:"Proyeksi saldo", nilai:`Rp ${formatRupiah(proyeksiSaldo)}` },
        { item:"Batas harian", nilai:`Rp ${formatRupiah(batasHarianAman)}` }
    ];

    let teks = `🔮 *PREDIKSI CASHFLOW BULAN INI*\n\n`;
    teks += buatTabelWhatsapp([
        { key:"item", label:"Indikator", width:16 },
        { key:"nilai", label:"Nilai", width:18, align:"right" }
    ], rows, { title:"Estimasi Otomatis" });

    try {
        const prompt = `Beri 3 saran singkat Bahasa Indonesia berdasarkan prediksi keuangan ini: ${JSON.stringify({
            totalMasuk: lap.totalMasuk,
            totalKeluar: lap.totalKeluar,
            saldo: lap.saldo,
            detailKategori: lap.detailKategori,
            proyeksiKeluar,
            proyeksiSaldo,
            batasHarianAman
        })}. Jawab max 120 kata, praktis, tidak menghakimi.`;
        const saran = await panggilAI(prompt, { maxRetry: 1, jedaAwal: 1000 });
        teks += `\n\n🤖 *Saran AI*\n${saran}`;
    } catch {
        teks += "\n\n💡 Jaga pengeluaran harian di bawah batas harian agar saldo akhir bulan tetap aman.";
    }

    return teks;
}

function buatDaftarKategoriDompet() {
    const kategori = [
        ...Object.keys(BUDGET_DEFAULT),
        "Pendapatan",
        "Bonus & Sampingan",
        "Investasi & Tabungan",
        "Utang",
        "Piutang",
        "Lainnya"
    ];
    const dompet = ["cash", "bca", "bri", "bni", "mandiri", "gopay", "ovo", "dana", "shopeepay"];

    return `🏷️ *KATEGORI & DOMPET DIDUKUNG*\n\n` +
        buatTabelWhatsapp([
            { key:"no", label:"No", width:2, align:"right" },
            { key:"kategori", label:"Kategori", width:24 }
        ], kategori.map((k,i)=>({ no:i+1, kategori:k })), { title:"Kategori", maxRows:kategori.length }) +
        "\n\n" +
        buatTabelWhatsapp([
            { key:"no", label:"No", width:2, align:"right" },
            { key:"dompet", label:"Dompet", width:14 }
        ], dompet.map((d,i)=>({ no:i+1, dompet:d.toUpperCase() })), { title:"Dompet/Akun", maxRows:dompet.length }) +
        "\n\nContoh: *beli bensin 50k mandiri* atau *pemasukan 5jt gaji bca*";
}

async function ambilRiwayatTransaksi(limit=Infinity, jid) {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();
    if (rows.length===0) return "📭 *Riwayat transaksi masih kosong.*";

    const jumlahDitampilkan = Number.isFinite(limit) ? Math.min(Math.max(1, limit), rows.length) : rows.length;
    const rowsTerpilih = rows.slice(-jumlahDitampilkan).reverse();
    let totalMasuk = 0;
    let totalKeluar = 0;
    for (const r of rowsTerpilih) {
        const jenis = String(r.get("Jenis")||"").toLowerCase().trim();
        const nominal = Number(r.get("Nominal")||0);
        if (jenis === "pemasukan") totalMasuk += nominal;
        else totalKeluar += nominal;
    }

    let teks = `📚 *RIWAYAT TRANSAKSI LENGKAP*\n`;
    teks += `Menampilkan *${jumlahDitampilkan}* dari *${rows.length}* transaksi\n`;
    teks += `🟢 Masuk: *Rp ${formatRupiah(totalMasuk)}*\n🔴 Keluar: *Rp ${formatRupiah(totalKeluar)}*\n`;
    teks += `💰 Selisih: *Rp ${formatRupiah(totalMasuk-totalKeluar)}*\n\n${"─".repeat(34)}\n`;

    for (const [index, r] of rowsTerpilih.entries()) {
        const tgl    = String(r.get("Tanggal")||"00/00/0000");
        const jenis  = String(r.get("Jenis")||"Pengeluaran").trim();
        const kat    = String(r.get("Kategori")||"Lainnya");
        const nom    = Number(r.get("Nominal")||0);
        const ket    = String(r.get("Keterangan")||"-");
        const dom    = String(r.get("Dompet")||"cash").toUpperCase();
        const saldo  = Number(r.get("Saldo")||0);
        const simbol = jenis.toLowerCase()==="pemasukan" ? "🟢 +" : "🔴 -";
        teks += `\n*${index + 1}. ${tgl} · ${dom}*\n${simbol} *Rp ${formatRupiah(nom)}* · ${kat}\n📝 ${ket}\n🧮 Saldo ${dom}: Rp ${formatRupiah(saldo)}\n`;
    }

    teks += `\n${"─".repeat(34)}\n💡 Ketik *riwayat 20* untuk 20 transaksi terbaru atau *export semua* untuk file lengkap.`;
    return teks;
}

// ── CARI TRANSAKSI ────────────────────────────────────────────
async function cariTransaksi(keyword, jid) {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();
    const kw    = keyword.toLowerCase().trim();

    if (!kw || kw.length < 2) return "⚠️ Kata kunci pencarian minimal 2 karakter.";

    const cocokRows = rows.filter(r =>
        String(r.get("Tanggal")||"").toLowerCase().includes(kw) ||
        String(r.get("Jenis")||"").toLowerCase().includes(kw) ||
        String(r.get("Keterangan")||"").toLowerCase().includes(kw) ||
        String(r.get("Kategori")||"").toLowerCase().includes(kw) ||
        String(r.get("Dompet")||"").toLowerCase().includes(kw) ||
        String(r.get("Nominal")||"").toLowerCase().includes(kw)
    ).reverse();

    if (cocokRows.length===0) return `🔍 Tidak ada transaksi yang cocok dengan *"${keyword}"*.`;

    let teks = `🔍 *HASIL PENCARIAN: "${keyword}"*\n_(${cocokRows.length} transaksi ditemukan)_\n${"─".repeat(34)}\n`;
    let totalMasuk=0, totalKeluar=0;

    for (const r of cocokRows) {
        const tgl    = String(r.get("Tanggal")||"");
        const jenis  = String(r.get("Jenis")||"").toLowerCase().trim();
        const nom    = Number(r.get("Nominal")||0);
        const kat    = String(r.get("Kategori")||"-");
        const ket    = String(r.get("Keterangan")||"-");
        const dom    = String(r.get("Dompet")||"cash").toUpperCase();
        const simbol = jenis==="pemasukan" ? "🟢 +" : "🔴 -";
        if (jenis==="pemasukan") totalMasuk+=nom; else totalKeluar+=nom;
        teks += `\n*[${tgl}]* ${ket}\n   ${simbol} *Rp ${formatRupiah(nom)}* | ${kat} | ${dom}\n`;
    }

    teks += `\n${"─".repeat(34)}\n🟢 Masuk: Rp ${formatRupiah(totalMasuk)}\n🔴 Keluar: Rp ${formatRupiah(totalKeluar)}\n💰 Selisih: Rp ${formatRupiah(totalMasuk-totalKeluar)}`;
    return teks;
}

// ── EXPORT LAPORAN ────────────────────────────────────────────
async function eksporLaporan(tipe, jid) {
    const lap = await buatLaporanKeuangan(tipe, jid);
    const now = new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE});
    const tanggalFile = tanggalHariIni().split("/").reverse().join("-");
    const header = HEADER_TRANSAKSI.map(csvCell).join(",");
    const isi = lap.transaksi.map(trx => [
        trx.tanggalLengkap || trx.tanggal,
        trx.jenis,
        trx.kategori,
        trx.nominal,
        trx.keterangan,
        trx.dompet,
        trx.saldo
    ].map(csvCell).join(","));
    const csv = "\uFEFF" + [header, ...isi].join("\r\n");
    const namaPeriode = labelPeriode(tipe).toLowerCase().replace(/\s+/g, "-");
    const caption =
`📤 *EXPORT LAPORAN ${labelPeriode(tipe).toUpperCase()}*

📊 ${lap.transaksi.length} transaksi
🟢 Masuk: Rp ${formatRupiah(lap.totalMasuk)}
🔴 Keluar: Rp ${formatRupiah(lap.totalKeluar)}
💰 Saldo: Rp ${formatRupiah(lap.saldo)}
🕒 Dibuat: ${now}

File CSV berisi seluruh transaksi pada periode yang dipilih.`;

    return {
        document: Buffer.from(csv, "utf8"),
        mimetype: "text/csv",
        fileName: `laporan-keuangan-${namaPeriode}-${tanggalFile}.csv`,
        caption
    };
}

// ── AI HELPER: ChatGPT utama + Gemini fallback ────────────────
const OPENAI_MODELS = (process.env.OPENAI_MODELS || OPENAI_MODEL)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
const GEMINI_MODELS = (process.env.GEMINI_MODELS || "gemini-2.5-flash,gemini-1.5-flash,gemini-1.5-flash-8b")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

function errorAISementara(e) {
    const status = Number(e?.status || e?.code || e?.response?.status || 0);
    const msg = String(e?.message || "").toLowerCase();
    return [408,409,429,500,502,503,504].includes(status) ||
        msg.includes("timeout") ||
        msg.includes("rate limit") ||
        msg.includes("unavailable") ||
        msg.includes("high demand") ||
        msg.includes("overloaded");
}

async function generateOpenAI(prompt, model) {
    if (!openai) throw new Error("OpenAI tidak aktif");
    const resp = await openai.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
            {
                role: "system",
                content: "Kamu adalah asisten catatan keuangan WhatsApp yang cepat, akurat, hemat kata, dan menjawab dalam Bahasa Indonesia."
            },
            { role: "user", content: prompt }
        ]
    });
    return resp.choices?.[0]?.message?.content || "";
}

async function generateGemini(prompt, model) {
    if (!ai) throw new Error("Gemini tidak aktif");
    const resp = await ai.models.generateContent({ model, contents: prompt });
    return resp.text || resp.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function panggilAI(prompt, { maxRetry = 3, jedaAwal = 2000 } = {}) {
    let lastErr;
    const providers = [];
    if (openai) providers.push({ nama:"ChatGPT", models:OPENAI_MODELS, generate:generateOpenAI });
    if (ai) providers.push({ nama:"Gemini", models:GEMINI_MODELS, generate:generateGemini });

    for (const provider of providers) {
        for (const model of provider.models) {
            for (let percobaan = 1; percobaan <= maxRetry; percobaan++) {
                try {
                    const txt = await provider.generate(prompt, model);
                    if (String(txt||"").trim()) {
                        if (provider.nama !== "ChatGPT" || model !== OPENAI_MODELS[0] || percobaan > 1) {
                            console.log(`✅ AI berhasil via ${provider.nama} model=${model} percobaan=${percobaan}`);
                        }
                        return String(txt).trim();
                    }
                    throw new Error("Respons AI kosong");
                } catch (e) {
                    lastErr = e;
                    const sementara = errorAISementara(e);
                    console.warn(`⚠️ AI ${provider.nama} [${model}] percobaan ${percobaan}/${maxRetry}: ${e.message}`);

                    if (!sementara) break;
                    if (percobaan < maxRetry) {
                        const jeda = jedaAwal * Math.pow(2, percobaan - 1);
                        console.log(`   ⏳ Tunggu ${jeda/1000}s sebelum retry...`);
                        await tunggu(jeda);
                    }
                }
            }
        }
    }

    throw lastErr || new Error("Semua provider AI tidak tersedia");
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

async function tanyaAIKeuangan(pertanyaan, jid) {
    const lapBulan = await buatLaporanKeuangan("bulan", jid);
    const lapSemua = await buatLaporanKeuangan("semua", jid);
    const konteks = {
        bulanIni: {
            totalMasuk: lapBulan.totalMasuk,
            totalKeluar: lapBulan.totalKeluar,
            saldo: lapBulan.saldo,
            detailKategori: lapBulan.detailKategori
        },
        saldoDompet: lapSemua.saldoDompet,
        transaksiTerbaru: lapBulan.transaksi.slice(-10).map(t => ({
            tanggal: t.tanggal,
            jenis: t.jenis,
            kategori: t.kategori,
            nominal: t.nominal,
            keterangan: t.keterangan,
            dompet: t.dompet
        }))
    };

    const prompt =
`Kamu adalah asisten keuangan pribadi untuk bot WhatsApp.
Jawab pertanyaan user dengan data berikut.
Gunakan Bahasa Indonesia, ringkas, jelas, praktis, dan jika perlu beri langkah aksi.
Jika data belum cukup, katakan apa data yang perlu dicatat.

DATA:
${JSON.stringify(konteks, null, 2)}

PERTANYAAN USER:
${pertanyaan}

Format jawaban:
- Mulai dengan kesimpulan singkat
- Maksimal 5 bullet
- Akhiri dengan 1 aksi yang bisa dilakukan hari ini`;

    try {
        const jawaban = await panggilAI(prompt, { maxRetry: 2, jedaAwal: 1500 });
        return `🤖 *ASISTEN KEUANGAN AI*\n\n${jawaban}`;
    } catch {
        return `🤖 *ASISTEN KEUANGAN AI*\n\nAI sedang tidak tersedia sementara.\n\nRingkasan cepat: pemasukan bulan ini Rp ${formatRupiah(lapBulan.totalMasuk)}, pengeluaran Rp ${formatRupiah(lapBulan.totalKeluar)}, saldo Rp ${formatRupiah(lapBulan.saldo)}.\n\nAksi hari ini: catat minimal 3 transaksi terakhir agar analisis berikutnya lebih akurat.`;
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
    const sekarang = sekarangWita();
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
  body{font-family:Inter,'Segoe UI',system-ui,sans-serif;background:#f6fbf7;color:#17352d;min-height:100vh}
  .topbar{background:#103d2e;color:white;padding:18px 24px;border-bottom:4px solid #22c55e}
  .topbar-inner{max-width:1120px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  h1{font-size:1.25rem;font-weight:750}
  .sub{font-size:.84rem;color:#c8f7dc;margin-top:4px}
  .pill{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;font-size:.78rem;font-weight:700;background:${status.connected?'#dcfce7':'#fee2e2'};color:${status.connected?'#166534':'#991b1b'}}
  .dot{width:9px;height:9px;border-radius:99px;background:${status.connected?'#16a34a':'#dc2626'}}
  main{max-width:1120px;margin:24px auto;padding:0 16px;display:grid;gap:16px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
  .stat,.panel,.cmd{background:white;border:1px solid #dbeadf;border-radius:8px;box-shadow:0 1px 2px rgba(16,61,46,.05)}
  .stat{padding:14px}
  .label{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:#5b7769;font-weight:700}
  .value{font-size:1.05rem;font-weight:800;margin-top:6px;color:#103d2e}
  .value.ok{color:#15803d}.value.warn{color:#b45309}.value.bad{color:#b91c1c}
  .grid{display:grid;grid-template-columns:1.15fr .85fr;gap:16px}
  .panel{padding:16px}
  .panel h2{font-size:.95rem;margin-bottom:12px;color:#103d2e}
  .feature-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
  .feature{border-left:4px solid #22c55e;background:#f7fff9;border-radius:8px;padding:10px 12px}
  .feature b{display:block;font-size:.9rem;color:#103d2e}
  .feature span{display:block;font-size:.78rem;color:#527161;margin-top:3px;line-height:1.35}
  .cmd-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}
  .cmd{padding:10px 12px}
  .cmd code{display:block;font-size:.83rem;color:#047857;font-weight:800;white-space:normal}
  .cmd span{font-size:.75rem;color:#5b7769;display:block;margin-top:3px}
  .table{width:100%;border-collapse:collapse;font-size:.82rem}
  .table th,.table td{padding:9px;border-bottom:1px solid #e3f0e7;text-align:left}
  .table th{color:#5b7769;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em}
  footer{text-align:center;padding:20px;color:#6b8074;font-size:.76rem}
  @media (max-width:820px){.grid{grid-template-columns:1fr}.topbar{padding:16px}}
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div>
      <h1>Bot Keuangan WhatsApp</h1>
      <div class="sub">Dashboard operasional untuk catatan keuangan, laporan tabel, dan AI assistant.</div>
    </div>
    <div class="pill"><span class="dot"></span>${status.connected?'Online':'Offline'}</div>
  </div>
</header>

<main>
  <section class="stats">
    <div class="stat"><div class="label">Status Bot</div><div class="value ${status.connected?'ok':'bad'}">${status.connected?'Terhubung':'Belum terhubung'}</div></div>
    <div class="stat"><div class="label">Login WhatsApp</div><div class="value">Pairing Code</div></div>
    <div class="stat"><div class="label">Provider AI</div><div class="value">${formatProviderAI()}</div></div>
    <div class="stat"><div class="label">Reconnect</div><div class="value warn">${status.reconnect}x</div></div>
    <div class="stat"><div class="label">Waktu Server</div><div class="value" style="font-size:.86rem">${now}</div></div>
  </section>

  <section class="grid">
    <div class="panel">
      <h2>Fitur Aktif</h2>
      <div class="feature-list">
        <div class="feature"><b>ChatGPT sebagai AI utama</b><span>Parsing transaksi, analisis, tips, prediksi, dan tanya-jawab keuangan.</span></div>
        <div class="feature"><b>Gemini fallback</b><span>Cadangan otomatis saat OpenAI overload, limit, atau tidak tersedia.</span></div>
        <div class="feature"><b>Laporan lengkap</b><span>Semua kategori, dompet, budget, dan transaksi dibagi otomatis dalam halaman rapi.</span></div>
        <div class="feature"><b>Budget monitor</b><span>Limit kategori, peringatan 85%, dan status overlimit.</span></div>
        <div class="feature"><b>Prediksi cashflow</b><span>Estimasi pengeluaran akhir bulan dan batas aman harian.</span></div>
        <div class="feature"><b>Google Sheets database</b><span>Data tiap nomor WhatsApp dipisah otomatis per sheet.</span></div>
      </div>
    </div>

    <div class="panel">
      <h2>Kesehatan Sistem</h2>
      <table class="table">
        <tr><th>Komponen</th><th>Status</th></tr>
        <tr><td>WhatsApp Socket</td><td>${status.connected?'Aktif':'Menunggu koneksi'}</td></tr>
        <tr><td>OpenAI</td><td>${openai?'Aktif':'Belum dikonfigurasi'}</td></tr>
        <tr><td>Gemini</td><td>${ai?'Fallback aktif':'Fallback nonaktif'}</td></tr>
        <tr><td>Spreadsheet</td><td>Siap dipakai</td></tr>
        <tr><td>Endpoint Health</td><td>/health</td></tr>
      </table>
    </div>
  </section>

  <section class="panel">
    <h2>Perintah Utama WhatsApp</h2>
    <div class="cmd-list">
      <div class="cmd"><code>dashboard</code><span>Ringkasan pintar bulan ini.</span></div>
      <div class="cmd"><code>laporan bulan ini</code><span>Laporan berbentuk tabel.</span></div>
      <div class="cmd"><code>saldo</code><span>Rekap semua waktu dengan tabel.</span></div>
      <div class="cmd"><code>prediksi</code><span>Estimasi cashflow akhir bulan.</span></div>
      <div class="cmd"><code>ai [pertanyaan]</code><span>Tanya ChatGPT memakai konteks data kamu.</span></div>
      <div class="cmd"><code>analisis</code><span>Insight dan saran AI bulanan.</span></div>
      <div class="cmd"><code>budget</code><span>Monitor anggaran kategori.</span></div>
      <div class="cmd"><code>set budget [kategori] [nominal]</code><span>Ubah limit anggaran.</span></div>
      <div class="cmd"><code>grafik bulan ini</code><span>Grafik pengeluaran di WhatsApp.</span></div>
      <div class="cmd"><code>tren</code><span>Tren 7 hari terakhir.</span></div>
      <div class="cmd"><code>cari [kata]</code><span>Cari transaksi.</span></div>
      <div class="cmd"><code>riwayat</code><span>Tampilkan seluruh riwayat transaksi.</span></div>
      <div class="cmd"><code>export semua</code><span>Unduh seluruh data sebagai CSV.</span></div>
      <div class="cmd"><code>kategori</code><span>Lihat kategori dan dompet yang didukung.</span></div>
    </div>
  </section>
</main>

<footer>Bot Keuangan WA &bull; Baileys + Google Sheets + ChatGPT + Gemini fallback</footer>
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
                ai: {
                    primary: openai ? "chatgpt" : (ai ? "gemini" : "none"),
                    openai: !!openai,
                    gemini: !!ai,
                    model: openai ? OPENAI_MODEL : (GEMINI_MODELS[0] || null)
                },
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

    const kirim = async payload => {
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
            return sock.sendMessage(from, payload);
        }

        const daftarPesan = (Array.isArray(payload) ? payload : [payload])
            .flatMap(item => pecahPesanWhatsapp(item));
        let hasilTerakhir;
        for (const bagian of daftarPesan) {
            hasilTerakhir = await sock.sendMessage(from, { text: bagian });
            if (daftarPesan.length > 1) await tunggu(300);
        }
        return hasilTerakhir;
    };

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
AI: *${formatProviderAI()}*

🛒 *Contoh Pengeluaran:*
• beli nasi goreng 25k cash
• bayar wifi 350k gopay
• keluar 100rb bensin mandiri

💵 *Contoh Pemasukan:*
• pemasukan 5jt gaji ke bca
• masuk 750k bonus dana

📊 *Laporan & Visualisasi:*
• *hari ini* / *minggu ini* / *bulan ini*
• *laporan bulan ini* – laporan tabel
• *saldo* – rekap semua waktu
• *dashboard* – ringkasan pintar
• *prediksi* – estimasi cashflow
• *dompet* – saldo per akun
• *riwayat* – semua transaksi
• *riwayat 20* – 20 transaksi terakhir
• *grafik bulan ini* – 📊 grafik ASCII
• *tren* – 📈 tren 7 hari terakhir
• *budget* – monitor anggaran

🤖 *Fitur AI:*
• *analisis* – ringkasan & saran AI
• *tips* – tips keuangan harian
• *ai [pertanyaan]* – tanya AI pakai data kamu
  contoh: *ai kenapa pengeluaran saya boros?*

🔍 *Pencarian & Export:*
• *cari [kata kunci]* – cari semua transaksi cocok
• *export bulan ini* – unduh CSV lengkap
• *export semua* – unduh semua data

⚙️ *Pengaturan:*
• *set budget [kategori] [nominal]*
• *pengingat on* / *pengingat off*
• *kategori* – daftar kategori & dompet
• *status ai* – cek provider AI

🚨 *Perintah Darurat:*
• *undo* – hapus transaksi terakhir
• *#reset* – kosongkan semua data`
            );
        }

        // ── STATUS & DASHBOARD ────────────────────────────────
        if (/^(status ai|ai status|status bot|status)$/i.test(pesan)) {
            return kirim(
`🧭 *STATUS BOT*

Bot       : ${sockGlobal ? "Online" : "Offline"}
AI        : ${formatProviderAI()}
OpenAI    : ${openai ? "Aktif" : "Belum diisi"}
Gemini    : ${ai ? "Fallback aktif" : "Fallback nonaktif"}
Reconnect : ${jumlahReconnect}x

Dashboard: http://localhost:${PORT}/dashboard`
            );
        }

        if (/^(dashboard|dasbor|overview|ringkasan pintar)$/i.test(pesan)) {
            return kirim(await buatDashboardKeuangan(from));
        }

        if (/^(kategori|daftar kategori|list kategori|dompet tersedia)$/i.test(pesan)) {
            return kirim(buatDaftarKategoriDompet());
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
            const rows = [];
            for (const [kat, limit] of Object.entries(budget)) {
                const terpakai = lap.detailKategori[kat]||0;
                const persen   = ((terpakai/limit)*100).toFixed(0);
                const status   = Number(persen)>=100 ? "Over" : Number(persen)>=85 ? "Waspada" : "Aman";
                rows.push({
                    kategori: kat,
                    pakai: formatRupiah(terpakai),
                    limit: formatRupiah(limit),
                    persen: `${persen}%`,
                    status
                });
            }
            rows.sort((a,b)=>Number(b.persen.replace("%",""))-Number(a.persen.replace("%","")));
            let teks = "🎯 *MONITOR ANGGARAN BULAN INI*\n\n";
            teks += buatTabelWhatsapp([
                { key:"kategori", label:"Kategori", width:16 },
                { key:"pakai", label:"Pakai", width:12, align:"right" },
                { key:"limit", label:"Limit", width:12, align:"right" },
                { key:"persen", label:"%", width:4, align:"right" },
                { key:"status", label:"Status", width:8 }
            ], rows, { maxRows: 12 });
            teks += `\n💡 Ketik *set budget [kategori] [nominal]* untuk ubah limit.`;
            return kirim(teks);
        }

        // ── RIWAYAT ─────────────────────────────────────────
        if (/^(riwayat|history|daftar transaksi|semua transaksi|transaksi terakhir)(?:\s+\d+)?$/i.test(pesan)) {
            const limitMatch = pesan.match(/(\d+)$/);
            const limit = limitMatch ? Math.max(1, Number(limitMatch[1])) : Infinity;
            return kirim(await ambilRiwayatTransaksi(limit, from));
        }

        if (/^(tabel|laporan tabel|rekap tabel)\s*(hari ini|minggu ini|bulan ini|semua)?$/i.test(pesan)) {
            const tipe = ambilTipeDariPesan(pesan, pesan.includes("semua") ? "semua" : "bulan");
            return kirim(await buatLaporanTabel(tipe, from));
        }

        // ── SALDO ───────────────────────────────────────────
        if (/^(saldo|laporan|rekap|total)$/i.test(pesan)) {
            return kirim(await buatLaporanTabel("semua", from));
        }

        // ── REKAP PERIODE ────────────────────────────────────
        if (/^(hari ini|minggu ini|bulan ini|laporan hari ini|laporan minggu ini|laporan bulan ini)$/i.test(pesan)) {
            const tipeTabel = ambilTipeDariPesan(pesan, "bulan");
            return kirim(await buatLaporanTabel(tipeTabel, from));
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
        if (/^(prediksi|forecast|proyeksi|cashflow)$/i.test(pesan)) {
            await kirim("🔮 _Menghitung prediksi cashflow bulan ini..._");
            return kirim(await buatPrediksiKeuangan(from));
        }

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
        if (/^(ai|tanya ai|chatgpt|asisten)\s+.+/i.test(pesan)) {
            const pertanyaan = text.replace(/^(ai|tanya ai|chatgpt|asisten)\s+/i, "").trim();
            await kirim(`🤖 _Membaca data dan bertanya ke ${formatProviderAI()}..._`);
            return kirim(await tanyaAIKeuangan(pertanyaan, from));
        }

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
