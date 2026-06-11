---
title: Bot Keuangan WA
emoji: 📊
colorFrom: green
colorTo: emerald
sdk: docker
pinned: false
---

# 🤖 Bot Keuangan WhatsApp

Bot catatan keuangan pribadi berbasis **Node.js**, **Baileys**, **Google Sheets**, **ChatGPT/OpenAI**, dan **Gemini fallback**.

AI utama sekarang memakai **OpenAI/ChatGPT**. Jika OpenAI sedang limit, overload, atau tidak dikonfigurasi, bot bisa memakai **Gemini** sebagai cadangan.

---

## ✨ Fitur Utama

### 📝 Catatan Keuangan Natural
- Catat pemasukan dan pengeluaran dari kalimat biasa.
- Deteksi otomatis nominal `25k`, `100rb`, `1.5jt`, kategori, dompet, tanggal, dan jenis transaksi.
- Fallback parsing lokal jika AI sedang tidak tersedia.
- Notifikasi saldo dompet setelah transaksi dicatat.

### 📊 Laporan Tabel
- Command `laporan`, `hari ini`, `minggu ini`, dan `bulan ini` menampilkan data dalam tabel WhatsApp; `saldo` hanya menampilkan ringkasan tanpa riwayat.
- Seluruh kategori, dompet, budget, hasil pencarian, dan transaksi ditampilkan tanpa dipotong.
- Respons panjang otomatis dibagi menjadi beberapa pesan/halaman yang rapi.
- Laporan dilengkapi jumlah transaksi, rata-rata pengeluaran, transaksi terbesar, dan sorotan otomatis.
- Export laporan dikirim sebagai file CSV lengkap yang siap dibuka di Excel atau Google Sheets.

### 🤖 AI Keuangan Responsif
- **ChatGPT/OpenAI sebagai AI utama** untuk parsing, analisis, tips, prediksi, dan tanya-jawab.
- **Gemini fallback** otomatis bila provider utama gagal.
- Error quota/rate limit memakai circuit breaker persisten: provider bermasalah langsung di-cooldown tanpa mengulang error 429 berkali-kali, bahkan setelah restart.
- Bot tetap dapat mencatat transaksi dengan parsing lokal meski seluruh provider AI sedang tidak tersedia.
- Jika kuota OpenAI habis, set `OPENAI_DISABLED=true` agar bot langsung memakai Gemini/fallback lokal.
- Command `ai [pertanyaan]` untuk bertanya dengan konteks data keuangan.
- Command `analisis`, `tips`, dan `prediksi` untuk insight keuangan.

### 🎯 Budget & Monitoring
- Budget default per kategori.
- Command `set budget [kategori] [nominal]`.
- Alert otomatis saat penggunaan budget mencapai 85% dan 100%.
- Command `budget` tampil sebagai tabel pemantauan.

### 🌐 Dashboard Web
- Dashboard web di port `7860`.
- Setiap nomor WhatsApp mendapat link dashboard pribadi yang hanya menampilkan transaksinya sendiri.
- Link akses ditandatangani, memiliki masa berlaku, dan dikirim langsung melalui command bot.
- Super admin dapat melihat seluruh nomor dari spreadsheet, ringkasan gabungan, lalu membuka detail setiap pengguna.
- Tampilan modern, responsif, dan dibagi per menu: Overview, Analitik, Transaksi, Budget, Admin, Sistem, dan Pengaturan.
- Transaksi dapat dicari, difilter, ditambahkan, diedit, dan dihapus langsung dari dashboard.
- Setelah edit/hapus, saldo setiap dompet dihitung ulang otomatis agar data tetap konsisten.
- Pengaturan tampilan tersedia di web: tema warna, mode compact, auto refresh, dan reset preferensi.
- Endpoint `/api/dashboard` selalu membutuhkan akses pribadi atau super admin.
- Endpoint `/health` dan `/api/status` tetap ringan untuk monitoring.

---

## ⚙️ Environment Variables

| Variable | Wajib | Keterangan |
|---|---:|---|
| `SPREADSHEET_ID` | Ya | ID Google Spreadsheet |
| `OPENAI_API_KEY` | Opsional | API key OpenAI/ChatGPT sebagai AI utama |
| `CHATGPT_API_KEY` | Opsional | Alias untuk `OPENAI_API_KEY` |
| `OPENAI_MODEL` | Opsional | Model OpenAI utama, default `gpt-4o-mini` |
| `OPENAI_MODELS` | Opsional | Daftar fallback model OpenAI dipisah koma |
| `OPENAI_DISABLED` | Opsional | Isi `true` untuk melewati OpenAI sepenuhnya saat quota/billing bermasalah |
| `GEMINI_API_KEY` | Opsional* | API key Gemini sebagai fallback |
| `GEMINI_MODELS` | Opsional | Daftar fallback model Gemini dipisah koma |
| `AI_PROVIDER_ORDER` | Opsional | Urutan provider AI, default `openai,gemini`; bisa diubah menjadi `gemini,openai` |
| `AI_STATE_FILE` | Opsional | Lokasi file status cooldown AI, default `ai-status.json` |
| `AI_QUOTA_COOLDOWN_MINUTES` | Opsional | Lama menonaktifkan provider AI saat quota/billing habis, default `1440` menit |
| `AI_RATE_LIMIT_COOLDOWN_MINUTES` | Opsional | Lama cooldown saat rate limit, default `2` menit |
| `WHATSAPP_PHONE_NUMBER` | Ya | Nomor WA format internasional, contoh `628xxx` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Ya | JSON service account Google |
| `DASHBOARD_SECRET` | Disarankan | Secret panjang untuk menandatangani link dashboard pribadi |
| `DASHBOARD_BASE_URL` | Ya untuk deploy | URL publik aplikasi, contoh `https://bot-kamu.up.railway.app` |
| `DASHBOARD_LINK_DAYS` | Opsional | Masa berlaku link dashboard, default `30` hari |
| `SUPER_ADMIN_NUMBERS` | Ya untuk admin | Nomor super admin dipisah koma, contoh `628111,628222` |
| `DASHBOARD_TOKEN` | Opsional | Token admin lama untuk kompatibilitas/fallback |
| `PORT` | Opsional | Default `7860` |

Tanpa AI key, bot tetap berjalan menggunakan parsing dan analisis lokal. Untuk fitur AI penuh, isi OpenAI sebagai utama dan Gemini sebagai fallback. Jika OpenAI sering memunculkan error quota/billing `429`, gunakan `OPENAI_DISABLED=true` atau ubah `AI_PROVIDER_ORDER=gemini,openai`.

---

## 📋 Perintah Bot

```text
# Informasi
menu                         -> Tampilkan panduan
status ai                    -> Cek provider AI
kategori                     -> Daftar kategori dan dompet

# Laporan tabel
laporan                      -> Laporan semua waktu
saldo                        -> Ringkasan saldo tanpa riwayat transaksi
hari ini                     -> Laporan hari ini
minggu ini                   -> Laporan 7 hari terakhir
bulan ini                    -> Laporan bulan berjalan
tabel bulan ini              -> Alias laporan tabel
export bulan ini             -> Download transaksi bulan ini sebagai CSV
export semua                 -> Download semua transaksi sebagai CSV

# Dashboard & insight
dashboard                    -> Ringkasan + link dashboard web pribadi
dashboard web                -> Kirim link dashboard web pribadi
dashboard admin              -> Link seluruh pengguna, khusus super admin
prediksi                     -> Prediksi cashflow bulan ini
analisis                     -> Analisis AI bulanan
tips                         -> Tips keuangan harian
ai kenapa pengeluaran naik?  -> Tanya AI dengan konteks data

# Visualisasi
grafik bulan ini             -> Grafik ASCII pengeluaran
tren                         -> Tren 7 hari terakhir

# Transaksi
riwayat                      -> Tampilkan semua transaksi
riwayat 20                   -> Tampilkan 20 transaksi terakhir
cari [kata kunci]            -> Cari semua transaksi yang cocok
undo                         -> Hapus transaksi terakhir

# Budget & pengingat
budget                       -> Monitor anggaran tabel
set budget [kat] [nominal]   -> Set budget custom
pengingat on/off             -> Notifikasi harian

# Darurat
#reset                       -> Hapus semua data
```

---

## 🚀 Jalankan

```bash
npm install
npm start
```

Dashboard:

```text
http://localhost:7860/dashboard
```

Untuk memperoleh akses, chat bot dari nomor pengguna:

```text
dashboard web
```

Untuk super admin yang nomornya terdaftar di `SUPER_ADMIN_NUMBERS`:

```text
dashboard admin
```

Bot akan mengirim link akses bertanda tangan. Jangan membagikan link tersebut karena link berfungsi sebagai kredensial akses.

Health check:

```text
http://localhost:7860/health
```

API dashboard:

```text
http://localhost:7860/api/dashboard
```

Request API wajib membawa token link pada header:

```text
x-dashboard-access: SIGNED_ACCESS_TOKEN
```

---

## 🧭 Tahapan Awal Membuat & Menjalankan Dashboard

1. Pastikan env utama bot sudah lengkap: `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, dan `WHATSAPP_PHONE_NUMBER`. AI key bersifat opsional.
2. Isi `DASHBOARD_BASE_URL` dengan URL publik aplikasi.
3. Isi `DASHBOARD_SECRET` dengan secret acak yang panjang.
4. Isi `SUPER_ADMIN_NUMBERS` dengan nomor yang boleh melihat seluruh pengguna.
5. Jalankan instalasi dependency:

```bash
npm install
```

6. Start bot:

```bash
npm start
```

7. Tunggu log:

```text
Dashboard aktif: http://localhost:7860
```

8. Chat bot dengan command:

```text
dashboard web
```

9. Super admin membuka dashboard semua pengguna dengan command `dashboard admin`.

---

## 🏗️ Stack

- **Runtime**: Node.js 20
- **WhatsApp**: `@whiskeysockets/baileys`
- **AI Utama**: OpenAI/ChatGPT
- **AI Fallback**: Google Gemini
- **Database**: Google Sheets
- **Deploy**: Docker / Hugging Face Spaces / Railway
