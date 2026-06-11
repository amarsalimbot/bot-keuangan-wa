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
const crypto = require("crypto");

// ── ENV ──────────────────────────────────────────────────────
const SPREADSHEET_ID            = process.env.SPREADSHEET_ID || "";
const OPENAI_API_KEY            = process.env.OPENAI_API_KEY || process.env.CHATGPT_API_KEY || "";
const OPENAI_MODEL              = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GEMINI_API_KEY            = process.env.GEMINI_API_KEY || "";
const WHATSAPP_PHONE_NUMBER     = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\D/g, "");
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
const DASHBOARD_TOKEN           = String(process.env.DASHBOARD_TOKEN || "").trim();
const DASHBOARD_SECRET          = String(process.env.DASHBOARD_SECRET || DASHBOARD_TOKEN || "").trim();
const DASHBOARD_BASE_URL        = String(process.env.DASHBOARD_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_URL || "").trim();
const DASHBOARD_LINK_DAYS       = Math.max(1, Number(process.env.DASHBOARD_LINK_DAYS || 30) || 30);
const SUPER_ADMIN_NUMBERS       = String(process.env.SUPER_ADMIN_NUMBERS || process.env.SUPER_ADMIN_NUMBER || "")
    .split(",").map(n => n.replace(/\D/g, "")).filter(Boolean);
const APP_TIMEZONE              = "Asia/Makassar";
const PORT                      = process.env.PORT || 7860;

if (!SPREADSHEET_ID)             throw new Error("SPREADSHEET_ID belum diisi.");
if (!OPENAI_API_KEY && !GEMINI_API_KEY) console.warn("⚠️ AI key belum diisi. Bot tetap berjalan memakai parsing dan analisis lokal.");
if (!GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON belum diisi.");
if (OPENAI_API_KEY || GEMINI_API_KEY) {
    if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY belum diisi. AI utama ChatGPT nonaktif, memakai Gemini.");
    if (!GEMINI_API_KEY) console.warn("⚠️ GEMINI_API_KEY belum diisi. Fallback Gemini nonaktif.");
}
if (!DASHBOARD_SECRET) console.warn("⚠️ DASHBOARD_SECRET belum diisi. Kunci link dashboard diturunkan dari service account.");
if (!SUPER_ADMIN_NUMBERS.length) console.warn("⚠️ SUPER_ADMIN_NUMBERS belum diisi. Akses dashboard super admin via WhatsApp belum aktif.");

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
const mutationQueues  = {};
const statusProviderAI = {
    ChatGPT: { blockedUntil: 0, reason: "", notifiedAt: 0 },
    Gemini: { blockedUntil: 0, reason: "", notifiedAt: 0 }
};
let   sockGlobal      = null;
let   sedangStart     = false;
let   reconnectTimer  = null;
let   jumlahReconnect = 0;
let   sudahStartKeepAlive = false;
let   lastAIFallbackLog = 0;
let   googleDocCache = null;
let   googleDocCacheAt = 0;
let   googleDocPromise = null;

const HEADER_TRANSAKSI = ["Tanggal","Jenis","Kategori","Nominal","Keterangan","Dompet","Saldo"];
const BATAS_PESAN_WHATSAPP = 3500;
const BARIS_PER_HALAMAN = 20;
const GOOGLE_DOC_CACHE_TTL = 60 * 1000;

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

function maskNomor(nomor) {
    const angka = String(nomor || "").replace(/\D/g, "");
    if (!angka) return "-";
    if (angka.length <= 6) return angka.replace(/\d(?=\d{2})/g, "•");
    return `${angka.slice(0, 4)}${"•".repeat(Math.max(3, angka.length - 7))}${angka.slice(-3)}`;
}

function nomorAdalahSuperAdmin(nomor) {
    return SUPER_ADMIN_NUMBERS.includes(String(nomor || "").replace(/\D/g, ""));
}

function dapatkanBaseUrlDashboard() {
    const normalisasi = value => {
        const bersih = String(value || "").trim().replace(/\/+$/, "");
        if (!bersih) return "";
        if (/^https?:\/\//i.test(bersih)) return bersih;
        if (/^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(bersih)) return `http://${bersih}`;
        return `https://${bersih}`;
    };
    if (DASHBOARD_BASE_URL) return normalisasi(DASHBOARD_BASE_URL);
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return normalisasi(process.env.RAILWAY_PUBLIC_DOMAIN);
    if (process.env.SPACE_HOST) return normalisasi(process.env.SPACE_HOST);
    return `http://localhost:${PORT}`;
}

function kunciTandaTanganDashboard() {
    return DASHBOARD_SECRET || crypto.createHash("sha256").update(GOOGLE_SERVICE_ACCOUNT_JSON).digest("hex");
}

function base64Url(value) {
    return Buffer.from(value).toString("base64url");
}

function tandaTanganDashboard(payload) {
    return crypto.createHmac("sha256", kunciTandaTanganDashboard()).update(payload).digest("base64url");
}

function buatTokenAksesDashboard(nomor, role = "user") {
    const payload = base64Url(JSON.stringify({
        v: 1,
        role: role === "admin" ? "admin" : "user",
        number: String(nomor || "").replace(/\D/g, ""),
        exp: Date.now() + DASHBOARD_LINK_DAYS * 24 * 60 * 60 * 1000
    }));
    return `${payload}.${tandaTanganDashboard(payload)}`;
}

function verifikasiTokenAksesDashboard(token) {
    try {
        const [payload, signature] = String(token || "").split(".");
        if (!payload || !signature) return null;
        const expected = tandaTanganDashboard(payload);
        const actualBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expected);
        if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        const number = String(data.number || "").replace(/\D/g, "");
        if (data.v !== 1 || !number || Number(data.exp) < Date.now()) return null;
        if (data.role === "admin" && !nomorAdalahSuperAdmin(number)) return null;
        return { role: data.role === "admin" ? "admin" : "user", number, expiresAt: Number(data.exp) };
    } catch {
        return null;
    }
}

function ambilAksesDashboard(req, urlObj) {
    const accessHeader = req.headers["x-dashboard-access"] || req.headers.authorization || "";
    const accessToken = String(accessHeader).replace(/^Bearer\s+/i, "").trim() || urlObj.searchParams.get("access") || "";
    const signedAccess = verifikasiTokenAksesDashboard(accessToken);
    if (signedAccess) return signedAccess;

    const legacyToken = String(req.headers["x-dashboard-token"] || urlObj.searchParams.get("token") || "").trim();
    if (DASHBOARD_TOKEN && legacyToken === DASHBOARD_TOKEN) {
        return { role: "admin", number: SUPER_ADMIN_NUMBERS[0] || WHATSAPP_PHONE_NUMBER, legacy: true };
    }
    return null;
}

function buatLinkDashboard(jid, role = "user") {
    const nomor = ambilNomorDariJid(jid);
    const token = buatTokenAksesDashboard(nomor, role);
    return `${dapatkanBaseUrlDashboard()}/d/${encodeURIComponent(token)}`;
}

function jsonResponse(res, statusCode, data) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(data));
}

function buatHttpError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function bacaJsonBody(req, maxBytes = 64 * 1024) {
    return new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", chunk => {
            raw += chunk;
            if (Buffer.byteLength(raw) > maxBytes) {
                reject(buatHttpError("Payload terlalu besar.", 413));
                req.destroy();
            }
        });
        req.on("end", () => {
            if (!raw.trim()) return resolve({});
            try { resolve(JSON.parse(raw)); }
            catch { reject(buatHttpError("Body JSON tidak valid.")); }
        });
        req.on("error", reject);
    });
}

function nomorTargetDashboard(akses, urlObj) {
    const diminta = String(urlObj.searchParams.get("nomor") || "").replace(/\D/g, "");
    if (akses.role === "admin" && diminta) return diminta;
    return akses.number;
}

function ambilTipeDariPesan(pesan, fallback = "bulan") {
    if (pesan.includes("hari")) return "hari";
    if (pesan.includes("minggu")) return "minggu";
    if (pesan.includes("semua") || pesan.includes("total")) return "semua";
    return fallback;
}

function formatProviderAI() {
    const chatgptAktif = !!openai && statusProviderAI.ChatGPT.blockedUntil <= Date.now();
    const geminiAktif = !!ai && statusProviderAI.Gemini.blockedUntil <= Date.now();
    if (chatgptAktif && geminiAktif) return `ChatGPT (${OPENAI_MODEL}) utama, Gemini fallback`;
    if (chatgptAktif) return `ChatGPT (${OPENAI_MODEL})`;
    if (geminiAktif && openai) return "Gemini aktif, ChatGPT sedang cooldown";
    if (geminiAktif) return "Gemini";
    if (openai || ai) return "AI sedang cooldown, fallback lokal aktif";
    return "Tidak aktif";
}

function buatAuthGoogle() {
    return new JWT({
        email: serviceAccount.client_email,
        key:   serviceAccount.private_key.replace(/\\n/g,"\n"),
        scopes:["https://www.googleapis.com/auth/spreadsheets"]
    });
}

async function getGoogleDoc(forceRefresh = false) {
    const cacheMasihAktif = googleDocCache && Date.now() - googleDocCacheAt < GOOGLE_DOC_CACHE_TTL;
    if (!forceRefresh && cacheMasihAktif) return googleDocCache;
    if (googleDocPromise) return googleDocPromise;

    googleDocPromise = (async () => {
        const doc = googleDocCache || new GoogleSpreadsheet(SPREADSHEET_ID, buatAuthGoogle());
        try {
            await doc.loadInfo();
        } catch(e) {
            if (googleDocCache) {
                console.warn("⚠️ Google Sheets refresh gagal, memakai koneksi cache:", e.message || e);
                googleDocCacheAt = Date.now();
                return googleDocCache;
            }
            throw e;
        }
        googleDocCache = doc;
        googleDocCacheAt = Date.now();
        return doc;
    })();

    try {
        return await googleDocPromise;
    } finally {
        googleDocPromise = null;
    }
}

async function getSheetByNomor(jid) {
    const nomor = ambilNomorDariJid(jid);
    if (!nomor) throw new Error("Nomor WhatsApp tidak valid.");
    const cached = cacheSheet[nomor];
    if (cached && Date.now() - cached.at < GOOGLE_DOC_CACHE_TTL) return cached.sheet;

    const doc = await getGoogleDoc();
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
    cacheSheet[nomor] = { sheet, at: Date.now() };
    return sheet;
}

function jalankanMutasiNomor(nomor, operasi) {
    const sebelumnya = mutationQueues[nomor] || Promise.resolve();
    const berikutnya = sebelumnya.catch(() => {}).then(operasi);
    const antrean = berikutnya.catch(() => {}).finally(() => {
        if (mutationQueues[nomor] === antrean) delete mutationQueues[nomor];
    });
    mutationQueues[nomor] = antrean;
    return berikutnya;
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
                rowNumber: row.rowNumber,
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

async function buatRingkasanSaldo(jid) {
    const [lapSemua, lapBulan] = await Promise.all([
        buatLaporanKeuangan("semua", jid),
        buatLaporanKeuangan("bulan", jid)
    ]);
    const dompet = Object.entries(lapSemua.saldoDompet)
        .sort((a,b) => Math.abs(b[1]) - Math.abs(a[1]));
    let teks =
`💰 *RINGKASAN SALDO*

*Saldo total:* Rp ${formatRupiah(lapSemua.saldo)}
*Masuk bulan ini:* Rp ${formatRupiah(lapBulan.totalMasuk)}
*Keluar bulan ini:* Rp ${formatRupiah(lapBulan.totalKeluar)}
*Sisa bulan ini:* Rp ${formatRupiah(lapBulan.saldo)}`;

    if (dompet.length) {
        teks += "\n\n👛 *Saldo per dompet:*";
        for (const [nama, saldo] of dompet) {
            teks += `\n• ${nama.toUpperCase()}: Rp ${formatRupiah(saldo)}`;
        }
    }
    teks += "\n\nKetik *laporan* atau *riwayat* jika ingin melihat detail transaksi.";
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
const AI_QUOTA_COOLDOWN_MS = Math.max(10, Number(process.env.AI_QUOTA_COOLDOWN_MINUTES || 360) || 360) * 60 * 1000;
const AI_RATE_LIMIT_COOLDOWN_MS = Math.max(1, Number(process.env.AI_RATE_LIMIT_COOLDOWN_MINUTES || 2) || 2) * 60 * 1000;

function klasifikasiErrorAI(e) {
    const status = Number(e?.status || e?.code || e?.response?.status || 0);
    const msg = String(e?.message || "").toLowerCase();
    const quota = msg.includes("exceeded your current quota") ||
        msg.includes("insufficient_quota") ||
        (msg.includes("quota") && (msg.includes("billing") || msg.includes("plan")));
    if (quota) return { tipe:"quota", retry:false, blockProvider:true, cooldown:AI_QUOTA_COOLDOWN_MS };
    if ([401,403].includes(status) || msg.includes("invalid api key")) {
        return { tipe:"auth", retry:false, blockProvider:true, cooldown:AI_QUOTA_COOLDOWN_MS };
    }
    if (status === 429 || msg.includes("rate limit")) {
        return { tipe:"rate_limit", retry:false, blockProvider:true, cooldown:AI_RATE_LIMIT_COOLDOWN_MS };
    }
    const sementara = [408,409,500,502,503,504].includes(status) ||
        msg.includes("timeout") ||
        msg.includes("unavailable") ||
        msg.includes("high demand") ||
        msg.includes("overloaded");
    return { tipe: sementara ? "sementara" : "permanen", retry: sementara, blockProvider:false, cooldown:0 };
}

function blokirProviderAI(nama, info) {
    const state = statusProviderAI[nama];
    if (!state || !info.blockProvider) return;
    state.blockedUntil = Date.now() + info.cooldown;
    state.reason = info.tipe;
    if (Date.now() - state.notifiedAt > 5 * 60 * 1000) {
        const menit = Math.ceil(info.cooldown / 60000);
        console.warn(`⚠️ ${nama} dinonaktifkan sementara ${menit} menit (${info.tipe}). Beralih ke provider/fallback berikutnya.`);
        state.notifiedAt = Date.now();
    }
}

function providerAIAktif(nama) {
    const state = statusProviderAI[nama];
    if (!state || state.blockedUntil <= Date.now()) {
        if (state) {
            state.blockedUntil = 0;
            state.reason = "";
        }
        return true;
    }
    return false;
}

function logFallbackAISekali(konteks) {
    if (Date.now() - lastAIFallbackLog < 5 * 60 * 1000) return;
    console.log(`ℹ️ ${konteks}: memakai fallback lokal karena provider AI belum tersedia.`);
    lastAIFallbackLog = Date.now();
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

async function panggilAI(prompt, { maxRetry = 2, jedaAwal = 1500 } = {}) {
    let lastErr;
    const providers = [];
    if (openai) providers.push({ nama:"ChatGPT", models:OPENAI_MODELS, generate:generateOpenAI });
    if (ai) providers.push({ nama:"Gemini", models:GEMINI_MODELS, generate:generateGemini });

    providerLoop:
    for (const provider of providers) {
        if (!providerAIAktif(provider.nama)) continue;
        for (const model of provider.models) {
            for (let percobaan = 1; percobaan <= maxRetry; percobaan++) {
                try {
                    const txt = await provider.generate(prompt, model);
                    if (String(txt||"").trim()) {
                        if (provider.nama !== "ChatGPT" || model !== OPENAI_MODELS[0] || percobaan > 1) {
                            console.log(`✅ AI berhasil via ${provider.nama} model=${model} percobaan=${percobaan}`);
                        }
                        statusProviderAI[provider.nama].blockedUntil = 0;
                        statusProviderAI[provider.nama].reason = "";
                        return String(txt).trim();
                    }
                    throw new Error("Respons AI kosong");
                } catch (e) {
                    lastErr = e;
                    const info = klasifikasiErrorAI(e);
                    blokirProviderAI(provider.nama, info);

                    if (!info.blockProvider) {
                        console.warn(`⚠️ AI ${provider.nama} [${model}] percobaan ${percobaan}/${maxRetry}: ${e.message}`);
                    }
                    if (info.blockProvider) continue providerLoop;
                    if (!info.retry) break;
                    if (percobaan < maxRetry) {
                        const jeda = jedaAwal * Math.pow(2, percobaan - 1);
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
        logFallbackAISekali("Analisis keuangan");
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
        let mentah = await panggilAI(prompt, { maxRetry: 2, jedaAwal: 1200 });
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
        logFallbackAISekali("Parsing transaksi");
        return fallbackParsingLokal(teksUser);
    }
}

// ── SIMPAN & HAPUS ────────────────────────────────────────────
async function simpanKeSheet(dataAi, jid) {
    const nomor = ambilNomorDariJid(jid);
    return jalankanMutasiNomor(nomor, async () => {
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
    });
}

async function hapusTransaksiTerakhir(jid) {
    const nomor = ambilNomorDariJid(jid);
    return jalankanMutasiNomor(nomor, async () => {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();
    if (rows.length===0) return null;
    const baris = rows[rows.length-1];
    const data  = { jenis:baris.get("Jenis"), nominal:Number(baris.get("Nominal")||0), keterangan:baris.get("Keterangan") };
    await baris.delete();
    await hitungUlangSaldoSheet(sheet);
    return data;
    });
}

async function resetSeluruhData(jid) {
    const nomor = ambilNomorDariJid(jid);
    return jalankanMutasiNomor(nomor, async () => {
    const sheet = await getSheetByNomor(jid);
    await sheet.clearRows();
    });
}

function formatTanggalWeb(value, fallback = "") {
    const teks = String(value || fallback || "").trim();
    const iso = teks.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}, ${new Date().toLocaleTimeString("id-ID",{timeZone:APP_TIMEZONE})}`;
    if (/^\d{2}\/\d{2}\/\d{4}(?:,\s*.+)?$/.test(teks)) return teks.includes(",") ? teks : `${teks}, ${new Date().toLocaleTimeString("id-ID",{timeZone:APP_TIMEZONE})}`;
    throw buatHttpError("Format tanggal harus YYYY-MM-DD atau DD/MM/YYYY.");
}

function normalisasiTransaksiWeb(data, existing = {}) {
    const nominal = Math.round(Number(data.amount ?? data.nominal ?? existing.Nominal ?? 0));
    if (!Number.isFinite(nominal) || nominal <= 0) throw buatHttpError("Nominal harus lebih besar dari 0.");
    const kategori = String(data.category ?? data.kategori ?? existing.Kategori ?? "Lainnya").trim().slice(0, 80);
    const keterangan = String(data.note ?? data.keterangan ?? existing.Keterangan ?? "-").trim().slice(0, 300);
    const dompet = String(data.wallet ?? data.dompet ?? existing.Dompet ?? "cash").toLowerCase().trim().slice(0, 40);
    if (!kategori || !keterangan || !dompet) throw buatHttpError("Kategori, keterangan, dan dompet wajib diisi.");
    return {
        Tanggal: formatTanggalWeb(data.date ?? data.tanggal, existing.Tanggal || tanggalHariIni()),
        Jenis: normalisasiJenis(data.type ?? data.jenis ?? existing.Jenis ?? "Pengeluaran"),
        Kategori: kategori,
        Nominal: nominal,
        Keterangan: keterangan,
        Dompet: dompet
    };
}

async function hitungUlangSaldoSheet(sheet) {
    const rows = await sheet.getRows();
    const saldoDompet = {};
    for (const row of rows) {
        const dompet = String(row.get("Dompet") || "cash").toLowerCase().trim();
        const nominal = Number(row.get("Nominal") || 0);
        const jenis = String(row.get("Jenis") || "").toLowerCase().trim();
        saldoDompet[dompet] = (saldoDompet[dompet] || 0) + (jenis === "pemasukan" ? nominal : -nominal);
        if (Number(row.get("Saldo") || 0) !== saldoDompet[dompet]) {
            row.set("Saldo", saldoDompet[dompet]);
            await row.save();
        }
    }
}

async function tambahTransaksiDashboard(nomor, data) {
    const transaksi = normalisasiTransaksiWeb(data);
    return jalankanMutasiNomor(nomor, async () => {
        const sheet = await getSheetByNomor(`${nomor}@s.whatsapp.net`);
        await sheet.addRow({ ...transaksi, Saldo:0 });
        await hitungUlangSaldoSheet(sheet);
        return { message:"Transaksi berhasil ditambahkan." };
    });
}

async function editTransaksiDashboard(nomor, rowNumber, data) {
    return jalankanMutasiNomor(nomor, async () => {
        const sheet = await getSheetByNomor(`${nomor}@s.whatsapp.net`);
        const rows = await sheet.getRows();
        const row = rows.find(item => item.rowNumber === Number(rowNumber));
        if (!row) throw buatHttpError("Transaksi tidak ditemukan.", 404);
        row.assign(normalisasiTransaksiWeb(data, row.toObject()));
        await row.save();
        await hitungUlangSaldoSheet(sheet);
        return { message:"Transaksi berhasil diperbarui." };
    });
}

async function hapusTransaksiDashboard(nomor, rowNumber) {
    return jalankanMutasiNomor(nomor, async () => {
        const sheet = await getSheetByNomor(`${nomor}@s.whatsapp.net`);
        const rows = await sheet.getRows();
        const row = rows.find(item => item.rowNumber === Number(rowNumber));
        if (!row) throw buatHttpError("Transaksi tidak ditemukan.", 404);
        await row.delete();
        await hitungUlangSaldoSheet(sheet);
        return { message:"Transaksi berhasil dihapus." };
    });
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

function ringkasRowsDashboard(rows, nomor) {
    const sekarang = sekarangWita();
    let incomeMonth = 0, expenseMonth = 0, totalBalance = 0, lastTransaction = "-";
    for (const row of rows) {
        const tanggal = String(row.get("Tanggal") || "");
        const [tanggalBagian] = tanggal.split(", ");
        const [hari, bulan, tahun] = tanggalBagian.split("/").map(Number);
        const jenis = String(row.get("Jenis") || "").toLowerCase().trim();
        const nominal = Number(row.get("Nominal") || 0);
        totalBalance += jenis === "pemasukan" ? nominal : -nominal;
        if (bulan === sekarang.getMonth() + 1 && tahun === sekarang.getFullYear()) {
            if (jenis === "pemasukan") incomeMonth += nominal;
            else expenseMonth += nominal;
        }
        if (tanggal) lastTransaction = tanggal;
    }
    return {
        number: nomor,
        maskedNumber: maskNomor(nomor),
        incomeMonth,
        expenseMonth,
        netMonth: incomeMonth - expenseMonth,
        totalBalance,
        totalTransactions: rows.length,
        lastTransaction
    };
}

async function ambilDaftarPenggunaDashboard() {
    const doc = await getGoogleDoc();
    const sheets = Object.values(doc.sheetsById)
        .filter(sheet => /^\d{8,16}$/.test(String(sheet.title || "")))
        .sort((a,b) => String(a.title).localeCompare(String(b.title)));
    const users = [];
    for (const sheet of sheets) {
        try {
            const rows = await sheet.getRows();
            users.push(ringkasRowsDashboard(rows, sheet.title));
        } catch(e) {
            console.warn(`Dashboard admin gagal membaca sheet ${sheet.title}:`, e.message || e);
        }
    }
    return users;
}

async function buatDataDashboardWeb(akses, nomorDipilih = "") {
    const now = new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE});
    const bulan = new Date().toLocaleDateString("id-ID", { timeZone: APP_TIMEZONE, month:"long", year:"numeric" });
    let daftarPengguna = [];
    let adminMessage = "";
    if (akses.role === "admin") {
        try {
            daftarPengguna = await ambilDaftarPenggunaDashboard();
        } catch(e) {
            adminMessage = `Daftar pengguna belum bisa dimuat: ${e.message || e}`;
        }
    }
    const nomorDiminta = String(nomorDipilih || "").replace(/\D/g, "");
    const nomorAktif = akses.role === "admin"
        ? (daftarPengguna.some(user => user.number === nomorDiminta) ? nomorDiminta : (daftarPengguna[0]?.number || akses.number))
        : akses.number;
    const ownerJid = nomorAktif ? `${nomorAktif}@s.whatsapp.net` : "";
    const totalAdmin = daftarPengguna.reduce((acc, user) => ({
        incomeMonth: acc.incomeMonth + user.incomeMonth,
        expenseMonth: acc.expenseMonth + user.expenseMonth,
        totalBalance: acc.totalBalance + user.totalBalance,
        totalTransactions: acc.totalTransactions + user.totalTransactions
    }), { incomeMonth:0, expenseMonth:0, totalBalance:0, totalTransactions:0 });
    const base = {
        access: {
            role: akses.role,
            isAdmin: akses.role === "admin",
            selectedNumber: nomorAktif,
            expiresAt: akses.expiresAt || null
        },
        system: {
            status: sockGlobal ? "Online" : "Offline",
            connected: !!sockGlobal,
            reconnect: jumlahReconnect,
            time: now,
            timezone: APP_TIMEZONE,
            uptimeSeconds: Math.floor(process.uptime()),
            port: PORT,
            owner: maskNomor(nomorAktif),
            protected: true
        },
        ai: {
            provider: formatProviderAI(),
            openai: !!openai,
            gemini: !!ai,
            model: openai ? OPENAI_MODEL : (GEMINI_MODELS[0] || null),
            status: Object.fromEntries(Object.entries(statusProviderAI).map(([nama, state]) => [nama, {
                available: providerAIAktif(nama),
                reason: state.reason || null,
                blockedUntil: state.blockedUntil || null
            }]))
        },
        admin: akses.role === "admin" ? {
            users: daftarPengguna,
            message: adminMessage,
            summary: {
                totalUsers: daftarPengguna.length,
                ...totalAdmin,
                netMonth: totalAdmin.incomeMonth - totalAdmin.expenseMonth
            }
        } : null,
        finance: null,
        commands: [
            { cmd:"dashboard", desc:"Ringkasan pintar di WhatsApp" },
            { cmd:"laporan bulan ini", desc:"Laporan tabel periode berjalan" },
            { cmd:"saldo", desc:"Rekap semua waktu" },
            { cmd:"riwayat", desc:"Semua transaksi" },
            { cmd:"riwayat 20", desc:"20 transaksi terakhir" },
            { cmd:"budget", desc:"Monitor anggaran" },
            { cmd:"prediksi", desc:"Estimasi cashflow" },
            { cmd:"analisis", desc:"Insight AI bulanan" },
            { cmd:"cari makan", desc:"Cari transaksi cocok" },
            { cmd:"export semua", desc:"Unduh CSV lengkap" }
        ]
    };

    if (!ownerJid) {
        base.finance = {
            available: false,
            message: "Belum ada nomor pengguna yang terdata di spreadsheet."
        };
        return base;
    }

    try {
        const [lapHari, lapBulan, lapSemua, tren] = await Promise.all([
            buatLaporanKeuangan("hari", ownerJid),
            buatLaporanKeuangan("bulan", ownerJid),
            buatLaporanKeuangan("semua", ownerJid),
            buatTrenHarian(ownerJid, 14)
        ]);
        const budget = getBudget(ownerJid);
        const transaksiKeluar = lapBulan.transaksi.filter(t => t.jenis === "Pengeluaran");
        const transaksiMasuk = lapBulan.transaksi.filter(t => t.jenis === "Pemasukan");
        const rataKeluar = transaksiKeluar.length ? Math.round(lapBulan.totalKeluar / transaksiKeluar.length) : 0;
        const rasioSisa = lapBulan.totalMasuk > 0 ? Math.round((lapBulan.saldo / lapBulan.totalMasuk) * 100) : 0;
        const hariBerjalan = sekarangWita().getDate();
        const hariDalamBulan = new Date(sekarangWita().getFullYear(), sekarangWita().getMonth() + 1, 0).getDate();
        const proyeksiKeluar = hariBerjalan ? Math.round((lapBulan.totalKeluar / hariBerjalan) * hariDalamBulan) : 0;
        const statusKeuangan = lapBulan.totalMasuk === 0
            ? "Perlu data"
            : rasioSisa >= 20 ? "Sehat"
            : rasioSisa >= 0 ? "Waspada"
            : "Defisit";
        const topKategori = Object.entries(lapBulan.detailKategori).sort((a,b)=>b[1]-a[1])[0] || null;

        base.finance = {
            available: true,
            period: bulan,
            owner: maskNomor(nomorAktif),
            summary: {
                status: statusKeuangan,
                incomeMonth: lapBulan.totalMasuk,
                expenseMonth: lapBulan.totalKeluar,
                netMonth: lapBulan.saldo,
                incomeToday: lapHari.totalMasuk,
                expenseToday: lapHari.totalKeluar,
                totalBalance: lapSemua.saldo,
                remainingRatio: rasioSisa,
                avgExpense: rataKeluar,
                projectedExpense: proyeksiKeluar,
                incomeTransactions: transaksiMasuk.length,
                expenseTransactions: transaksiKeluar.length,
                totalTransactions: lapSemua.transaksi.length,
                monthTransactions: lapBulan.transaksi.length,
                topCategory: topKategori ? { name: topKategori[0], amount: topKategori[1] } : null
            },
            wallets: Object.entries(lapSemua.saldoDompet)
                .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))
                .map(([name, balance]) => ({ name: name.toUpperCase(), balance })),
            categories: Object.entries(lapBulan.detailKategori)
                .sort((a,b)=>b[1]-a[1])
                .map(([name, amount]) => ({ name, amount })),
            budgets: Object.entries(budget)
                .map(([name, limit]) => {
                    const used = lapBulan.detailKategori[name] || 0;
                    const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
                    return {
                        name,
                        used,
                        limit,
                        remaining: limit - used,
                        percent,
                        status: percent >= 100 ? "Over" : percent >= 85 ? "Waspada" : "Aman"
                    };
                })
                .sort((a,b)=>b.percent-a.percent),
            trend: tren,
            recent: lapSemua.transaksi.slice(-50).reverse().map(t => ({
                rowNumber: t.rowNumber,
                date: t.tanggalLengkap || t.tanggal,
                type: t.jenis,
                category: t.kategori,
                amount: t.nominal,
                note: t.keterangan,
                wallet: String(t.dompet || "").toUpperCase(),
                balance: t.saldo
            }))
        };
    } catch(e) {
        base.finance = {
            available: false,
            message: `Data keuangan belum bisa dimuat: ${e.message || e}`
        };
    }

    return base;
}

// ── DASHBOARD WEB HTML ────────────────────────────────────────
function buatHalamanWeb() {
    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Bot Keuangan WA</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{
    --bg:#f4f6f8;--paper:#ffffff;--paper-soft:#f9fafb;--line:#dfe5ec;--text:#17202c;--muted:#687584;
    --green:#0f8f61;--green-soft:#e9f7ef;--red:#c94a4a;--red-soft:#fff1f1;--blue:#2457d6;--blue-soft:#edf3ff;
    --amber:#b97913;--amber-soft:#fff6df;--teal:#0d7f86;--shadow:0 16px 38px rgba(25,33,45,.08);
  }
  body{font-family:Inter,'Segoe UI',system-ui,sans-serif;background:linear-gradient(180deg,#fafbfc 0,#eef2f5 100%);color:var(--text);min-height:100vh}
  button,input,select{font:inherit}button{color:inherit}[hidden]{display:none!important}
  .shell{min-height:100vh;display:grid;grid-template-columns:260px minmax(0,1fr)}
  .sidebar{background:#fff;border-right:1px solid var(--line);padding:20px 16px;display:flex;flex-direction:column;gap:18px;position:sticky;top:0;height:100vh}
  .brand{display:flex;align-items:center;gap:12px;padding:6px 4px}
  .mark{width:42px;height:42px;border-radius:8px;background:#17202c;color:white;display:grid;place-items:center;font-weight:900}
  .brand h1{font-size:1rem;line-height:1.2}.brand small{display:block;color:var(--muted);font-size:.76rem;margin-top:3px}
  .nav{display:grid;gap:6px}
  .nav-item{width:100%;border:0;background:transparent;border-radius:8px;padding:10px 11px;display:flex;align-items:center;gap:10px;cursor:pointer;text-align:left;font-weight:800;font-size:.86rem}
  .nav-item:hover{background:#f0f3f6}.nav-item.active{background:#17202c;color:white}
  .nav-swatch{width:8px;height:8px;border-radius:3px;background:var(--blue);flex:none}.nav-item[data-view="budget"] .nav-swatch{background:var(--amber)}.nav-item[data-view="transactions"] .nav-swatch{background:var(--green)}.nav-item[data-view="system"] .nav-swatch{background:var(--teal)}.nav-item[data-view="admin"] .nav-swatch{background:var(--red)}
  .side-meta{margin-top:auto;display:grid;gap:8px;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--paper-soft);font-size:.78rem;color:var(--muted)}
  .side-meta b{color:var(--text)}
  .content{padding:24px;display:grid;gap:18px;max-width:1440px;width:100%}
  .topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .kicker{font-size:.78rem;color:var(--muted);font-weight:800;margin-bottom:4px}
  .topbar h2{font-size:1.38rem;line-height:1.2}.topbar p{color:var(--muted);font-size:.88rem;margin-top:4px}
  .actions,.toolbar,.modal-actions,.actions-cell{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .btn{border:1px solid var(--line);background:#fff;border-radius:8px;padding:9px 12px;cursor:pointer;font-weight:800;transition:background .18s ease,border-color .18s ease,box-shadow .18s ease}
  .btn:hover{background:#f7f9fb;box-shadow:0 8px 18px rgba(25,33,45,.08)}.btn.primary{background:var(--blue);border-color:var(--blue);color:white}.btn.primary:hover{background:#1d4dbf}.btn.danger{background:var(--red-soft);color:var(--red);border-color:#ffd6d6}.btn.small{padding:6px 9px;font-size:.75rem}
  .pill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 11px;font-size:.82rem;font-weight:800}
  .dot{width:9px;height:9px;border-radius:99px;background:var(--amber)}.dot.online{background:var(--green)}.dot.offline{background:var(--red)}
  .view{display:none;gap:14px}.view.active{display:grid}
  .metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .metric-card,.panel-card,.mini{background:var(--paper);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}
  .metric-card{padding:16px;min-height:112px;display:grid;align-content:space-between;gap:10px}
  .label{font-size:.75rem;color:var(--muted);font-weight:800}
  .value{font-size:1.25rem;font-weight:900;line-height:1.2;word-break:break-word}.hint{font-size:.78rem;color:var(--muted)}
  .value.green{color:var(--green)}.value.red{color:var(--red)}.value.blue{color:var(--blue)}.value.amber{color:var(--amber)}
  .panel-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:14px}.panel-grid.equal{grid-template-columns:1fr 1fr}
  .panel-card{padding:16px;min-width:0}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:13px}.panel-head h3{font-size:1rem;line-height:1.25}.subtle{font-size:.78rem;color:var(--muted);margin-top:3px}
  .mini-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.mini{padding:13px}.mini b{display:block;font-size:1.03rem;margin-top:5px;line-height:1.25}
  .chart-wrap{height:300px;border:1px solid var(--line);border-radius:8px;background:#fff;overflow:hidden}svg{width:100%;height:100%;display:block}
  .table-wrap{overflow:auto;max-height:460px;border:1px solid var(--line);border-radius:8px;background:#fff}
  .table{width:100%;border-collapse:collapse;font-size:.84rem}.table th,.table td{padding:10px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.table th{position:sticky;top:0;background:#fff;color:var(--muted);font-size:.74rem;font-weight:900}.table tbody tr:hover{background:#f8fafc}.right{text-align:right!important}.muted{color:var(--muted)}
  .bar-list,.wallets{display:grid;gap:10px}.list-scroll{max-height:430px;overflow:auto;padding-right:3px}
  .bar-row{display:grid;gap:6px}.bar-meta{display:flex;justify-content:space-between;gap:10px;font-size:.82rem}.bar-meta span{text-align:right;color:var(--muted)}.bar{height:8px;background:#edf1f5;border-radius:8px;overflow:hidden}.bar span{display:block;height:100%;background:var(--blue);border-radius:8px}.bar span.danger{background:var(--red)}.bar span.warn{background:var(--amber)}.bar span.good{background:var(--green)}
  .wallet{display:flex;align-items:center;justify-content:space-between;border:1px solid var(--line);border-radius:8px;padding:11px;background:#fff}.wallet span{font-weight:900}
  .status-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.status-item{border:1px solid var(--line);border-radius:8px;padding:12px;background:#fff}.status-item b{display:block;font-size:.92rem}.status-item span{display:block;font-size:.78rem;color:var(--muted);margin-top:4px}
  .cmds{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px}.cmd{border:1px solid var(--line);border-radius:8px;padding:12px;background:#fff;text-align:left;cursor:pointer}.cmd:hover{background:#f7f9fb}.cmd code{font-weight:900;color:var(--blue);white-space:normal}.cmd span{display:block;color:var(--muted);font-size:.76rem;margin-top:4px}
  .badge,.type-badge{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:.72rem;font-weight:900}.badge{background:var(--blue-soft);color:var(--blue)}.type-badge.income{background:var(--green-soft);color:var(--green)}.type-badge.expense{background:var(--red-soft);color:var(--red)}
  .field{border:1px solid var(--line);background:#fff;border-radius:8px;padding:9px 11px;color:var(--text);min-width:150px}.search-field{min-width:230px}.user-row{cursor:pointer}.user-row.active{background:#edf3ff}
  .empty{border:1px dashed #b8c4d0;border-radius:8px;padding:16px;color:var(--muted);background:#fbfcfd}
  .lock{position:fixed;inset:0;background:rgba(244,246,248,.94);display:none;align-items:center;justify-content:center;padding:18px;z-index:10}.lock.show{display:flex}.lock-box{width:min(420px,100%);background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);padding:20px;display:grid;gap:12px}.lock-box input{width:100%;border:1px solid var(--line);border-radius:8px;padding:11px}
  .modal{position:fixed;inset:0;background:rgba(23,32,44,.55);display:none;align-items:center;justify-content:center;padding:18px;z-index:20;backdrop-filter:blur(6px)}.modal.show{display:flex}.modal-box{width:min(620px,100%);background:#fff;border-radius:8px;box-shadow:0 30px 80px rgba(12,30,60,.28);padding:22px;display:grid;gap:16px}
  .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.form-group{display:grid;gap:6px}.form-group.full{grid-column:1/-1}.form-group label{font-size:.75rem;font-weight:900;color:var(--muted)}.form-group input,.form-group select{border:1px solid var(--line);border-radius:8px;padding:11px;background:#fff}
  .toast{position:fixed;right:18px;bottom:18px;background:#17202c;color:white;border-radius:8px;padding:10px 12px;font-size:.82rem;display:none;z-index:30}.toast.show{display:block}
  @media (max-width:1120px){.metric-grid,.mini-grid{grid-template-columns:repeat(2,1fr)}.panel-grid,.panel-grid.equal{grid-template-columns:1fr}.sidebar{position:static;height:auto}.shell{grid-template-columns:1fr}.nav{grid-template-columns:repeat(4,minmax(0,1fr))}.side-meta{margin-top:0}}
  @media (max-width:720px){.content{padding:16px}.nav{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-grid,.mini-grid,.status-grid,.form-grid{grid-template-columns:1fr}.form-group.full{grid-column:auto}.toolbar{align-items:stretch}.field,.search-field,.btn{width:100%}.table-wrap{max-height:420px}.chart-wrap{height:260px}}
</style>
</head>
<body>
<div class="shell">
  <aside class="sidebar">
    <div class="brand"><div class="mark">WA</div><div><h1>Bot Keuangan</h1><small>Dashboard operasional</small></div></div>
    <nav class="nav">
      <button class="nav-item active" data-view="overview" type="button"><span class="nav-swatch"></span><span>Overview</span></button>
      <button class="nav-item" id="admin-nav" data-view="admin" type="button" hidden><span class="nav-swatch"></span><span>Pengguna</span></button>
      <button class="nav-item" data-view="trend" type="button"><span class="nav-swatch"></span><span>Tren</span></button>
      <button class="nav-item" data-view="budget" type="button"><span class="nav-swatch"></span><span>Budget</span></button>
      <button class="nav-item" data-view="transactions" type="button"><span class="nav-swatch"></span><span>Transaksi</span></button>
      <button class="nav-item" data-view="system" type="button"><span class="nav-swatch"></span><span>Sistem</span></button>
      <button class="nav-item" data-view="commands" type="button"><span class="nav-swatch"></span><span>Command</span></button>
    </nav>
    <div class="side-meta">
      <div>Owner: <b id="side-owner">-</b></div>
      <div>Port: <b id="side-port">-</b></div>
      <div>Zona: <b id="side-zone">-</b></div>
    </div>
  </aside>

  <main class="content">
    <section class="topbar">
      <div>
        <div class="kicker" id="view-kicker">Bot Keuangan WA</div>
        <h2 id="page-title">Dashboard Keuangan</h2>
        <p id="subtitle">Memuat data bot...</p>
      </div>
      <div class="actions">
        <span class="pill"><span id="status-dot" class="dot"></span><span id="status-label">Memuat</span></span>
        <button class="btn" id="token-btn" type="button">Ganti Akses</button>
        <button class="btn primary" id="refresh-btn" type="button">Refresh</button>
      </div>
    </section>

    <section class="view active" data-view="overview" id="view-overview">
      <div class="metric-grid">
        <div class="metric-card"><div class="label">Pemasukan Bulan Ini</div><div class="value green" id="income-month">-</div><div class="hint" id="income-today">Hari ini -</div></div>
        <div class="metric-card"><div class="label">Pengeluaran Bulan Ini</div><div class="value red" id="expense-month">-</div><div class="hint" id="expense-today">Hari ini -</div></div>
        <div class="metric-card"><div class="label">Saldo Bersih Bulan Ini</div><div class="value blue" id="net-month">-</div><div class="hint" id="finance-status">Status -</div></div>
        <div class="metric-card"><div class="label">Saldo Total</div><div class="value amber" id="total-balance">-</div><div class="hint" id="transaction-count">0 transaksi</div></div>
      </div>
      <div class="mini-grid">
        <div class="mini"><span class="label">Rata-rata Pengeluaran</span><b id="avg-expense">-</b><span class="hint">Per transaksi bulan ini</span></div>
        <div class="mini"><span class="label">Proyeksi Pengeluaran</span><b id="projected-expense">-</b><span class="hint">Estimasi akhir bulan</span></div>
        <div class="mini"><span class="label">Kategori Terbesar</span><b id="insight-top-category">-</b><span class="hint">Pengeluaran bulan ini</span></div>
        <div class="mini"><span class="label">Rasio Sisa</span><b id="remaining-ratio">-</b><span class="hint">Dari pemasukan bulan ini</span></div>
      </div>
      <div class="panel-grid equal">
        <div class="panel-card">
          <div class="panel-head"><div><h3>Pengeluaran per Kategori</h3><div class="subtle" id="top-category">-</div></div></div>
          <div class="bar-list list-scroll" id="category-list"></div>
        </div>
        <div class="panel-card">
          <div class="panel-head"><div><h3>Saldo Dompet</h3><div class="subtle">Semua waktu</div></div></div>
          <div class="wallets list-scroll" id="wallet-list"></div>
        </div>
      </div>
    </section>

    <section class="view" data-view="admin" id="view-admin">
      <div class="panel-card">
        <div class="panel-head"><div><h3>Super Admin</h3><div class="subtle" id="admin-message">Seluruh nomor yang terdata di spreadsheet</div></div><span class="badge">ADMIN</span></div>
      <div class="mini-grid">
        <div class="mini"><span class="label">Total Pengguna</span><b id="admin-users">-</b></div>
        <div class="mini"><span class="label">Pemasukan Gabungan</span><b id="admin-income">-</b></div>
        <div class="mini"><span class="label">Pengeluaran Gabungan</span><b id="admin-expense">-</b></div>
        <div class="mini"><span class="label">Total Transaksi</span><b id="admin-transactions">-</b></div>
      </div>
      <div class="table-wrap" style="margin-top:12px">
        <table class="table">
          <thead><tr><th>Nomor</th><th>Transaksi Terakhir</th><th class="right">Masuk Bulan Ini</th><th class="right">Keluar Bulan Ini</th><th class="right">Saldo Total</th><th class="right">Transaksi</th></tr></thead>
          <tbody id="admin-user-body"></tbody>
        </table>
      </div>
      </div>
    </section>

    <section class="view" data-view="trend" id="view-trend">
      <div class="panel-card">
        <div class="panel-head"><div><h3>Tren 14 Hari</h3><div class="subtle">Pemasukan dan pengeluaran harian</div></div><div class="subtle" id="period-label">-</div></div>
        <div class="chart-wrap"><svg id="trend-chart" viewBox="0 0 720 260" preserveAspectRatio="none"></svg></div>
      </div>
    </section>

    <section class="view" data-view="budget" id="view-budget">
      <div class="panel-grid equal">
        <div class="panel-card">
          <div class="panel-head"><div><h3>Budget Bulan Ini</h3><div class="subtle">Limit dan penggunaan</div></div></div>
          <div class="bar-list list-scroll" id="budget-list"></div>
        </div>
        <div class="panel-card">
          <div class="panel-head"><div><h3>Kategori Bulan Ini</h3><div class="subtle">Urutan pengeluaran terbesar</div></div></div>
          <div class="bar-list list-scroll" id="category-list-budget"></div>
        </div>
      </div>
    </section>

    <section class="view" data-view="transactions" id="view-transactions">
      <div class="panel-card">
      <div class="panel-head">
        <div><h3>Kelola Transaksi</h3><span class="subtle">Cari, tambah, edit, atau hapus 50 transaksi terakhir</span></div>
        <div class="toolbar">
          <input class="field search-field" id="transaction-search" placeholder="Cari transaksi...">
          <select class="field" id="transaction-filter"><option value="">Semua jenis</option><option value="Pemasukan">Pemasukan</option><option value="Pengeluaran">Pengeluaran</option></select>
          <button class="btn" id="export-csv-btn" type="button">Export CSV</button>
          <button class="btn primary" id="add-transaction-btn" type="button">+ Transaksi</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Dompet</th><th class="right">Nominal</th><th class="right">Aksi</th></tr></thead>
          <tbody id="recent-body"></tbody>
        </table>
      </div>
      </div>
    </section>

    <section class="view" data-view="system" id="view-system">
      <div class="panel-grid">
        <div class="panel-card">
          <div class="panel-head"><div><h3>Kesehatan Bot</h3><div class="subtle" id="updated-at">-</div></div></div>
          <div class="status-grid">
            <div class="status-item"><b id="socket-status">-</b><span>WhatsApp socket</span></div>
            <div class="status-item"><b id="ai-provider">-</b><span>Provider AI</span></div>
            <div class="status-item"><b id="reconnect-count">-</b><span>Reconnect</span></div>
            <div class="status-item"><b id="uptime">-</b><span>Uptime</span></div>
          </div>
        </div>
        <div class="panel-card">
          <div class="panel-head"><div><h3>Status AI</h3><div class="subtle">Provider aktif dan fallback</div></div></div>
          <div class="status-grid" id="ai-status-list"></div>
        </div>
      </div>
    </section>

    <section class="view" data-view="commands" id="view-commands">
      <div class="panel-card">
      <div class="panel-head"><div><h3>Command Center</h3><div class="subtle">Perintah WhatsApp</div></div></div>
      <div class="cmds" id="command-list"></div>
      </div>
    </section>
  </main>
</div>

<div class="lock" id="lock">
  <form class="lock-box" id="token-form">
    <h3>Akses Dashboard</h3>
    <p class="muted">Buka link terbaru dari bot WhatsApp, atau masukkan token admin lama.</p>
    <input id="token-input" type="password" autocomplete="current-password" placeholder="Access token">
    <button class="btn primary" type="submit">Buka Dashboard</button>
  </form>
</div>
<div class="modal" id="transaction-modal">
  <form class="modal-box" id="transaction-form">
    <div class="panel-head"><div><h3 id="transaction-modal-title">Tambah Transaksi</h3><span class="subtle">Data akan langsung disimpan ke spreadsheet.</span></div><button class="btn small" id="close-transaction-modal" type="button">Tutup</button></div>
    <div class="form-grid">
      <div class="form-group"><label>Jenis</label><select id="trx-type" required><option>Pemasukan</option><option selected>Pengeluaran</option></select></div>
      <div class="form-group"><label>Nominal</label><input id="trx-amount" type="number" min="1" required placeholder="Contoh: 50000"></div>
      <div class="form-group"><label>Tanggal</label><input id="trx-date" type="date" required></div>
      <div class="form-group"><label>Dompet</label><input id="trx-wallet" required placeholder="cash / bca / gopay"></div>
      <div class="form-group full"><label>Kategori</label><input id="trx-category" required placeholder="Konsumsi"></div>
      <div class="form-group full"><label>Keterangan</label><input id="trx-note" required placeholder="Makan siang"></div>
    </div>
    <div class="modal-actions"><button class="btn" id="cancel-transaction" type="button">Batal</button><button class="btn primary" id="save-transaction" type="submit">Simpan Transaksi</button></div>
  </form>
</div>
<div class="toast" id="toast"></div>

<script>
  const rupiah = new Intl.NumberFormat("id-ID", { style:"currency", currency:"IDR", maximumFractionDigits:0 });
  const params = new URLSearchParams(location.search);
  let token = params.get("access") || params.get("token") || sessionStorage.getItem("dashboardAccess") || "";
  let selectedNumber = params.get("nomor") || "";
  let currentRecent = [];
  let editingRow = null;
  let activeView = localStorage.getItem("dashboardView") || "overview";
  const viewTitles = {
    overview:"Overview",
    admin:"Pengguna",
    trend:"Tren",
    budget:"Budget",
    transactions:"Transaksi",
    system:"Sistem",
    commands:"Command"
  };
  if (params.get("access") || params.get("token")) {
    sessionStorage.setItem("dashboardAccess", token);
    history.replaceState(null, "", "/dashboard");
  }
  const $ = id => document.getElementById(id);
  const money = value => rupiah.format(Number(value || 0));
  const esc = value => String(value ?? "-").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  const showToast = text => {
    $("toast").textContent = text;
    $("toast").classList.add("show");
    setTimeout(() => $("toast").classList.remove("show"), 2600);
  };
  const duration = seconds => {
    const s = Number(seconds || 0), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + "j " + m + "m";
    if (m > 0) return m + "m";
    return s + "d";
  };
  function setActiveView(view, store = true) {
    if (view === "admin" && $("admin-nav").hidden) view = "overview";
    activeView = viewTitles[view] ? view : "overview";
    document.querySelectorAll(".view").forEach(section => {
      section.classList.toggle("active", section.dataset.view === activeView);
    });
    document.querySelectorAll(".nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.view === activeView);
    });
    $("view-kicker").textContent = viewTitles[activeView] || "Overview";
    if (store) localStorage.setItem("dashboardView", activeView);
  }
  const dateForInput = value => {
    const parts = String(value || "").split(",")[0].split("/");
    return parts.length === 3 ? parts[2] + "-" + parts[1] + "-" + parts[0] : new Date().toISOString().slice(0,10);
  };
  const apiHeaders = () => token ? { "Content-Type":"application/json", "x-dashboard-access":token, "x-dashboard-token":token } : { "Content-Type":"application/json" };

  async function transactionRequest(path, options) {
    const query = selectedNumber ? "?nomor=" + encodeURIComponent(selectedNumber) : "";
    const res = await fetch(path + query, { ...options, headers:apiHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "HTTP " + res.status);
    return data;
  }

  async function loadDashboard() {
    try {
      const headers = token ? { "x-dashboard-access": token, "x-dashboard-token": token } : {};
      const query = selectedNumber ? "?nomor=" + encodeURIComponent(selectedNumber) : "";
      const res = await fetch("/api/dashboard" + query, { headers });
      if (res.status === 401) {
        $("lock").classList.add("show");
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (token) sessionStorage.setItem("dashboardAccess", token);
      $("lock").classList.remove("show");
      render(data);
    } catch (e) {
      showToast("Dashboard belum bisa dimuat: " + e.message);
    }
  }

  function render(data) {
    const sys = data.system || {};
    const ai = data.ai || {};
    const finance = data.finance || {};
    const access = data.access || {};
    selectedNumber = access.selectedNumber || selectedNumber;
    $("page-title").textContent = access.isAdmin ? "Dashboard Super Admin" : "Dashboard Keuangan Pribadi";
    $("subtitle").textContent = "Periode " + ((finance && finance.period) || "-") + " - " + (sys.time || "-");
    $("status-dot").className = "dot " + (sys.connected ? "online" : "offline");
    $("status-label").textContent = sys.connected ? "Online" : "Offline";
    $("side-owner").textContent = sys.owner || "-";
    $("side-port").textContent = sys.port || "-";
    $("side-zone").textContent = sys.timezone || "-";
    $("socket-status").textContent = sys.status || "-";
    $("ai-provider").textContent = ai.provider || "-";
    $("reconnect-count").textContent = (sys.reconnect || 0) + "x";
    $("uptime").textContent = duration(sys.uptimeSeconds);
    $("updated-at").textContent = sys.time || "-";
    renderAIStatus(ai);
    renderAdmin(data.admin, selectedNumber);
    renderCommands(data.commands || []);

    if (!finance.available) {
      const message = finance.message || "Data keuangan belum tersedia.";
      $("income-month").textContent = "-";
      $("expense-month").textContent = "-";
      $("net-month").textContent = "-";
      $("total-balance").textContent = "-";
      $("income-today").textContent = "Hari ini -";
      $("expense-today").textContent = "Hari ini -";
      $("finance-status").textContent = "Status -";
      $("transaction-count").textContent = "0 transaksi";
      $("avg-expense").textContent = "-";
      $("projected-expense").textContent = "-";
      $("insight-top-category").textContent = "-";
      $("remaining-ratio").textContent = "-";
      $("period-label").textContent = "-";
      $("top-category").textContent = "-";
      $("category-list").innerHTML = '<div class="empty">' + esc(message) + '</div>';
      $("category-list-budget").innerHTML = '<div class="empty">' + esc(message) + '</div>';
      $("budget-list").innerHTML = '<div class="empty">' + esc(message) + '</div>';
      $("wallet-list").innerHTML = '<div class="empty">' + esc(message) + '</div>';
      $("recent-body").innerHTML = '<tr><td colspan="7" class="muted">' + esc(message) + '</td></tr>';
      drawTrend([]);
      return;
    }

    const s = finance.summary || {};
    $("income-month").textContent = money(s.incomeMonth);
    $("expense-month").textContent = money(s.expenseMonth);
    $("net-month").textContent = money(s.netMonth);
    $("total-balance").textContent = money(s.totalBalance);
    $("income-today").textContent = "Hari ini " + money(s.incomeToday);
    $("expense-today").textContent = "Hari ini " + money(s.expenseToday);
    $("finance-status").textContent = (s.status || "-") + " - rasio sisa " + (s.remainingRatio || 0) + "%";
    $("transaction-count").textContent = (s.totalTransactions || 0) + " transaksi - " + (s.monthTransactions || 0) + " bulan ini";
    $("avg-expense").textContent = money(s.avgExpense);
    $("projected-expense").textContent = money(s.projectedExpense);
    $("insight-top-category").textContent = s.topCategory ? s.topCategory.name : "-";
    $("remaining-ratio").textContent = (s.remainingRatio || 0) + "%";
    $("period-label").textContent = finance.period || "-";
    $("top-category").textContent = s.topCategory ? s.topCategory.name + " " + money(s.topCategory.amount) : "-";

    renderBars("category-list", finance.categories || [], "amount");
    renderBars("category-list-budget", finance.categories || [], "amount");
    renderBudgets(finance.budgets || []);
    renderWallets(finance.wallets || []);
    currentRecent = finance.recent || [];
    renderRecent();
    renderCommands(data.commands || []);
    drawTrend(finance.trend || []);
  }

  function renderAdmin(admin, activeNumber) {
    const nav = $("admin-nav");
    if (!admin) {
      nav.hidden = true;
      if (activeView === "admin") setActiveView("overview");
      return;
    }
    nav.hidden = false;
    $("admin-message").textContent = admin.message || "Seluruh nomor yang terdata di spreadsheet";
    const summary = admin.summary || {};
    $("admin-users").textContent = summary.totalUsers || 0;
    $("admin-income").textContent = money(summary.incomeMonth);
    $("admin-expense").textContent = money(summary.expenseMonth);
    $("admin-transactions").textContent = summary.totalTransactions || 0;
    const users = admin.users || [];
    $("admin-user-body").innerHTML = users.length ? users.map(user =>
      '<tr class="user-row ' + (user.number === activeNumber ? 'active' : '') + '" data-number="' + esc(user.number) + '">' +
      '<td><b>' + esc(user.maskedNumber) + '</b></td><td>' + esc(user.lastTransaction) + '</td>' +
      '<td class="right">' + money(user.incomeMonth) + '</td><td class="right">' + money(user.expenseMonth) + '</td>' +
      '<td class="right">' + money(user.totalBalance) + '</td><td class="right">' + esc(user.totalTransactions) + '</td></tr>'
    ).join("") : '<tr><td colspan="6" class="muted">' + esc(admin.message || "Belum ada nomor pengguna.") + '</td></tr>';
    document.querySelectorAll(".user-row").forEach(row => row.addEventListener("click", () => {
      selectedNumber = row.dataset.number || "";
      loadDashboard();
      setActiveView("overview");
      window.scrollTo({ top:0, behavior:"smooth" });
    }));
  }

  function renderAIStatus(ai) {
    const rows = Object.entries((ai && ai.status) || {});
    if (!rows.length) {
      $("ai-status-list").innerHTML = '<div class="empty">Status provider AI belum tersedia.</div>';
      return;
    }
    $("ai-status-list").innerHTML = rows.map(([name, state]) => {
      const aktif = state && state.available;
      const label = aktif ? "Aktif" : "Cooldown";
      const reason = (state && state.reason) || (aktif ? "Siap digunakan" : "Menunggu provider tersedia");
      return '<div class="status-item"><b>' + esc(name) + ' - ' + label + '</b><span>' + esc(reason) + '</span></div>';
    }).join("");
  }

  function renderBars(id, rows, key) {
    if (!rows.length) {
      $(id).innerHTML = '<div class="empty">Belum ada data.</div>';
      return;
    }
    const max = Math.max(...rows.map(row => Number(row[key] || 0)), 1);
    $(id).innerHTML = rows.map(row => {
      const pct = Math.round((Number(row[key] || 0) / max) * 100);
      return '<div class="bar-row"><div class="bar-meta"><b>' + esc(row.name) + '</b><span>' + money(row[key]) + '</span></div><div class="bar"><span style="width:' + pct + '%"></span></div></div>';
    }).join("");
  }

  function renderBudgets(rows) {
    if (!rows.length) {
      $("budget-list").innerHTML = '<div class="empty">Belum ada budget.</div>';
      return;
    }
    $("budget-list").innerHTML = rows.map(row => {
      const pct = Math.min(Math.max(Number(row.percent || 0), 0), 140);
      const kind = row.status === "Over" ? "danger" : row.status === "Waspada" ? "warn" : "good";
      return '<div class="bar-row"><div class="bar-meta"><b>' + esc(row.name) + '</b><span>' + row.percent + '% - ' + money(row.used) + ' / ' + money(row.limit) + '</span></div><div class="bar"><span class="' + kind + '" style="width:' + Math.min(pct, 100) + '%"></span></div><div class="hint">' + esc(row.status) + ' - sisa ' + money(row.remaining) + '</div></div>';
    }).join("");
  }

  function renderWallets(rows) {
    if (!rows.length) {
      $("wallet-list").innerHTML = '<div class="empty">Belum ada saldo dompet.</div>';
      return;
    }
    $("wallet-list").innerHTML = rows.map(row => '<div class="wallet"><b>' + esc(row.name) + '</b><span>' + money(row.balance) + '</span></div>').join("");
  }

  function filteredRecentRows() {
    const keyword = $("transaction-search").value.trim().toLowerCase();
    const filter = $("transaction-filter").value;
    return currentRecent.filter(row => {
      const haystack = [row.date,row.type,row.category,row.note,row.wallet,row.amount].join(" ").toLowerCase();
      return (!keyword || haystack.includes(keyword)) && (!filter || row.type === filter);
    });
  }

  function renderRecent() {
    const rows = filteredRecentRows();
    if (!rows.length) {
      $("recent-body").innerHTML = '<tr><td colspan="7" class="muted">Tidak ada transaksi yang cocok.</td></tr>';
      return;
    }
    $("recent-body").innerHTML = rows.map(row =>
      '<tr><td>' + esc(row.date) + '</td><td><span class="type-badge ' + (row.type === "Pemasukan" ? "income" : "expense") + '">' + esc(row.type) + '</span></td>' +
      '<td>' + esc(row.category) + '</td><td>' + esc(row.note) + '</td><td>' + esc(row.wallet) + '</td><td class="right"><b>' + money(row.amount) + '</b></td>' +
      '<td><div class="actions-cell"><button class="btn small edit-trx" data-row="' + esc(row.rowNumber) + '">Edit</button><button class="btn small danger delete-trx" data-row="' + esc(row.rowNumber) + '">Hapus</button></div></td></tr>'
    ).join("");
    document.querySelectorAll(".edit-trx").forEach(btn => btn.addEventListener("click", () => openTransactionModal(currentRecent.find(row => String(row.rowNumber) === btn.dataset.row))));
    document.querySelectorAll(".delete-trx").forEach(btn => btn.addEventListener("click", () => deleteTransaction(btn.dataset.row)));
  }

  function openTransactionModal(row) {
    editingRow = row ? row.rowNumber : null;
    $("transaction-modal-title").textContent = row ? "Edit Transaksi" : "Tambah Transaksi";
    $("trx-type").value = row ? row.type : "Pengeluaran";
    $("trx-amount").value = row ? row.amount : "";
    $("trx-date").value = row ? dateForInput(row.date) : new Date().toISOString().slice(0,10);
    $("trx-wallet").value = row ? String(row.wallet || "").toLowerCase() : "cash";
    $("trx-category").value = row ? row.category : "";
    $("trx-note").value = row ? row.note : "";
    $("transaction-modal").classList.add("show");
  }

  function closeTransactionModal() {
    editingRow = null;
    $("transaction-modal").classList.remove("show");
  }

  async function deleteTransaction(rowNumber) {
    if (!confirm("Hapus transaksi ini? Saldo akan dihitung ulang otomatis.")) return;
    try {
      const result = await transactionRequest("/api/transactions/" + rowNumber, { method:"DELETE" });
      showToast(result.message || "Transaksi dihapus.");
      await loadDashboard();
    } catch(e) {
      showToast("Gagal menghapus: " + e.message);
    }
  }

  function exportFilteredCsv() {
    const rows = filteredRecentRows();
    if (!rows.length) {
      showToast("Tidak ada transaksi untuk diexport.");
      return;
    }
    const csvCell = value => '"' + String(value ?? "").replace(/"/g, '""') + '"';
    const header = ["Tanggal","Jenis","Kategori","Keterangan","Dompet","Nominal","Saldo"].map(csvCell).join(",");
    const body = rows.map(row => [
      row.date,
      row.type,
      row.category,
      row.note,
      row.wallet,
      row.amount,
      row.balance
    ].map(csvCell).join(",")).join("\\n");
    const blob = new Blob(["\\ufeff" + header + "\\n" + body], { type:"text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "transaksi-dashboard.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("CSV berhasil dibuat.");
  }

  function renderCommands(rows) {
    $("command-list").innerHTML = rows.map(row => '<button class="cmd" type="button" data-cmd="' + esc(row.cmd) + '"><code>' + esc(row.cmd) + '</code><span>' + esc(row.desc) + '</span></button>').join("");
    document.querySelectorAll(".cmd").forEach(button => button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.cmd || "");
        showToast("Command disalin.");
      } catch {
        showToast(button.dataset.cmd || "Command siap diketik.");
      }
    }));
  }

  function drawTrend(rows) {
    const svg = $("trend-chart");
    if (!rows.length) {
      svg.innerHTML = '<text x="24" y="130" fill="#667789">Belum ada data tren.</text>';
      return;
    }
    const w = 720, h = 260, pad = 32;
    const max = Math.max(...rows.flatMap(row => [Number(row.masuk || 0), Number(row.keluar || 0)]), 1);
    const x = i => pad + (i * (w - pad * 2) / Math.max(rows.length - 1, 1));
    const y = v => h - pad - (Number(v || 0) / max) * (h - pad * 2);
    const path = field => rows.map((row, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(row[field]).toFixed(1)).join(" ");
    const labels = rows.map((row, i) => i % 2 === 0 ? '<text x="' + x(i).toFixed(1) + '" y="250" text-anchor="middle" fill="#667789" font-size="11">' + esc(row.label) + '</text>' : "").join("");
    svg.innerHTML = '<rect x="0" y="0" width="720" height="260" fill="#ffffff"></rect><line x1="32" y1="228" x2="688" y2="228" stroke="#dce3ea"></line><path d="' + path("keluar") + '" fill="none" stroke="#c0392b" stroke-width="3"></path><path d="' + path("masuk") + '" fill="none" stroke="#11865b" stroke-width="3"></path>' + labels + '<text x="40" y="22" fill="#11865b" font-size="12">Masuk</text><text x="100" y="22" fill="#c0392b" font-size="12">Keluar</text>';
  }

  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => setActiveView(button.dataset.view));
  });
  setActiveView(activeView, false);
  $("refresh-btn").addEventListener("click", loadDashboard);
  $("token-btn").addEventListener("click", () => $("lock").classList.add("show"));
  $("transaction-search").addEventListener("input", renderRecent);
  $("transaction-filter").addEventListener("change", renderRecent);
  $("export-csv-btn").addEventListener("click", exportFilteredCsv);
  $("add-transaction-btn").addEventListener("click", () => openTransactionModal(null));
  $("close-transaction-modal").addEventListener("click", closeTransactionModal);
  $("cancel-transaction").addEventListener("click", closeTransactionModal);
  $("transaction-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("save-transaction");
    button.disabled = true;
    button.textContent = "Menyimpan...";
    const payload = {
      type:$("trx-type").value,
      amount:Number($("trx-amount").value),
      date:$("trx-date").value,
      wallet:$("trx-wallet").value,
      category:$("trx-category").value,
      note:$("trx-note").value
    };
    try {
      const path = editingRow ? "/api/transactions/" + editingRow : "/api/transactions";
      const result = await transactionRequest(path, { method:editingRow ? "PUT" : "POST", body:JSON.stringify(payload) });
      closeTransactionModal();
      showToast(result.message || "Transaksi berhasil disimpan.");
      await loadDashboard();
    } catch(e) {
      showToast("Gagal menyimpan: " + e.message);
    } finally {
      button.disabled = false;
      button.textContent = "Simpan Transaksi";
    }
  });
  $("token-form").addEventListener("submit", event => {
    event.preventDefault();
    token = $("token-input").value.trim();
    if (!token) return;
    sessionStorage.setItem("dashboardAccess", token);
    loadDashboard();
  });
  loadDashboard();
  setInterval(loadDashboard, 60000);
</script>
</body>
</html>`;
}

// ── KEEP-ALIVE SERVER ─────────────────────────────────────────
function startKeepAliveServer() {
    const server = http.createServer(async (req, res) => {
        try {
            const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

            if (urlObj.pathname === "/") {
                res.writeHead(302, { Location: "/dashboard" });
                res.end();
                return;
            }

            const shortDashboardRoute = urlObj.pathname.match(/^\/d\/([^/]+)$/);
            if (shortDashboardRoute) {
                const access = decodeURIComponent(shortDashboardRoute[1]);
                res.writeHead(302, { Location: `/dashboard?access=${encodeURIComponent(access)}` });
                res.end();
                return;
            }

            if (urlObj.pathname === "/dashboard") {
                const html = buatHalamanWeb();
                res.writeHead(200,{"Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store"});
                res.end(html);
                return;
            }

            if (urlObj.pathname === "/health" || urlObj.pathname === "/api/status") {
                jsonResponse(res, 200, {
                    status:"online",
                    bot: sockGlobal?"aktif":"tidak_aktif",
                    reconnect: jumlahReconnect,
                    dashboardProtected: true,
                    dashboardAccess: "signed-link-per-number",
                    ai: {
                        primary: formatProviderAI(),
                        openai: !!openai,
                        gemini: !!ai,
                        model: openai ? OPENAI_MODEL : (GEMINI_MODELS[0] || null),
                        cooldown: Object.fromEntries(Object.entries(statusProviderAI).map(([nama, state]) => [nama, {
                            reason: state.reason || null,
                            blockedUntil: state.blockedUntil || null
                        }]))
                    },
                    time: new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE})
                });
                return;
            }

            if (urlObj.pathname === "/api/dashboard") {
                const akses = ambilAksesDashboard(req, urlObj);
                if (!akses) {
                    jsonResponse(res, 401, { error:"ACCESS_REQUIRED", message:"Buka link dashboard terbaru dari bot WhatsApp." });
                    return;
                }
                const data = await buatDataDashboardWeb(akses, urlObj.searchParams.get("nomor") || "");
                jsonResponse(res, 200, data);
                return;
            }

            const transactionRoute = urlObj.pathname.match(/^\/api\/transactions(?:\/(\d+))?$/);
            if (transactionRoute) {
                const akses = ambilAksesDashboard(req, urlObj);
                if (!akses) {
                    jsonResponse(res, 401, { error:"ACCESS_REQUIRED", message:"Akses dashboard tidak valid." });
                    return;
                }
                const nomor = nomorTargetDashboard(akses, urlObj);
                if (!nomor) throw buatHttpError("Nomor pengguna tidak valid.", 400);
                let result;
                if (req.method === "POST" && !transactionRoute[1]) {
                    result = await tambahTransaksiDashboard(nomor, await bacaJsonBody(req));
                } else if (["PUT","PATCH"].includes(req.method) && transactionRoute[1]) {
                    result = await editTransaksiDashboard(nomor, transactionRoute[1], await bacaJsonBody(req));
                } else if (req.method === "DELETE" && transactionRoute[1]) {
                    result = await hapusTransaksiDashboard(nomor, transactionRoute[1]);
                } else {
                    throw buatHttpError("Metode tidak didukung.", 405);
                }
                jsonResponse(res, 200, { ok:true, ...result });
                return;
            }

            jsonResponse(res, 404, { error:"NOT_FOUND" });
        } catch(e) {
            const statusCode = Number(e.statusCode || 500);
            if (statusCode >= 500) console.error("❌ Dashboard error:", e.message || e);
            jsonResponse(res, statusCode, { error:"DASHBOARD_ERROR", message:String(e.message || e) });
        }
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
• *saldo* – ringkasan saldo tanpa riwayat
• *dashboard* – ringkasan + link web pribadi
• *dashboard web* – buka dashboard web pribadi
• *dashboard admin* – dashboard semua pengguna (khusus super admin)
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
OpenAI    : ${openai ? (providerAIAktif("ChatGPT") ? "Aktif" : `Cooldown (${statusProviderAI.ChatGPT.reason})`) : "Belum diisi"}
Gemini    : ${ai ? (providerAIAktif("Gemini") ? "Aktif" : `Cooldown (${statusProviderAI.Gemini.reason})`) : "Fallback nonaktif"}
Reconnect : ${jumlahReconnect}x

Dashboard: ${dapatkanBaseUrlDashboard()}/dashboard
Ketik *dashboard web* untuk link akses pribadi.`
            );
        }

        if (/^(dashboard admin|admin dashboard|dashboard super admin|super admin)$/i.test(pesan)) {
            const nomor = ambilNomorDariJid(from);
            if (!nomorAdalahSuperAdmin(nomor)) {
                return kirim("⛔ Perintah ini khusus nomor super admin yang terdaftar di SUPER_ADMIN_NUMBERS.");
            }
            const link = buatLinkDashboard(from, "admin");
            return kirim([
`🔐 *DASHBOARD SUPER ADMIN*

Lihat seluruh nomor dan data transaksi yang terdaftar di spreadsheet.
Link akses ada di pesan berikutnya.`,
                link,
`Link berlaku ${DASHBOARD_LINK_DAYS} hari dan khusus untuk super admin. Jangan bagikan link ini.`
            ]);
        }

        if (/^(dashboard web|web dashboard|buka dashboard|link dashboard|akses dashboard)$/i.test(pesan)) {
            const link = buatLinkDashboard(from, "user");
            return kirim([
`🌐 *DASHBOARD KEUANGAN PRIBADI*

Dashboard ini hanya menampilkan transaksi milik nomor kamu.
Link akses ada di pesan berikutnya.`,
                link,
`Link berlaku ${DASHBOARD_LINK_DAYS} hari. Jangan bagikan link ini kepada orang lain.`
            ]);
        }

        if (/^(dashboard|dasbor|overview|ringkasan pintar)$/i.test(pesan)) {
            const ringkasan = await buatDashboardKeuangan(from);
            const link = buatLinkDashboard(from, "user");
            return kirim([
                ringkasan,
`🌐 *Buka dashboard web pribadi*
Link akses ada di pesan berikutnya.`,
                link
            ]);
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
        if (/^(saldo|cek saldo|total saldo|total)$/i.test(pesan)) {
            return kirim(await buatRingkasanSaldo(from));
        }

        if (/^(laporan|rekap)$/i.test(pesan)) {
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
