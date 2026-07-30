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
- Mesin kategori pintar memakai katalog pusat dengan puluhan kategori, alias, kata kunci, kelompok kebutuhan, dan normalisasi hasil AI.
- Data kategori lama otomatis disesuaikan ke kategori pusat saat laporan dibaca agar analitik dan budget tetap konsisten.
- Fallback parsing lokal jika AI sedang tidak tersedia.
- Notifikasi saldo dompet setelah transaksi dicatat.

### 📊 Laporan Tabel
- Command `laporan`, `hari ini`, `minggu ini`, dan `bulan ini` menampilkan data dalam tabel WhatsApp; `saldo` hanya menampilkan ringkasan tanpa riwayat.
- Seluruh kategori, dompet, budget, hasil pencarian, dan transaksi ditampilkan tanpa dipotong.
- Respons panjang otomatis dibagi menjadi beberapa pesan/halaman yang rapi.
- Laporan dilengkapi jumlah transaksi, rata-rata pengeluaran, transaksi terbesar, dan sorotan otomatis.
- Command `laporan Mei 2026`, `riwayat bulan lalu`, dan `laporan tahunan 2026` membuka periode lama tanpa menghapus data.
- Laporan tahunan menampilkan ringkasan 12 bulan beserta seluruh transaksi dalam tahun tersebut.
- Saldo penutupan dan tabungan selalu diakumulasi dari bulan-bulan sebelumnya.
- Export laporan dikirim sebagai file Excel `.xls` lengkap dengan sheet Ringkasan, Diagram Kategori, Saldo Dompet, Diagram Tren, dan Transaksi.

### 💎 Binance Realtime Khusus Nomor 33827179200526
- Nomor `33827179200526` dapat dibuat sebagai pengguna khusus untuk membaca saldo spreadsheet dan saldo spot Binance realtime.
- API Binance disimpan di Railway Variables, bukan di kode dan bukan di spreadsheet.
- Command `saldo binance`, `binance`, `aset binance`, `harga binance`, atau `konversi binance` menampilkan total estimasi USDT, harga per koin terhadap USDT, estimasi rupiah bila rate diisi, jumlah aset aktif, dan daftar top aset.
- Dashboard web memiliki halaman Binance khusus, kartu ringkasan Binance di Overview, dan endpoint ringan `/api/binance` yang memperbarui harga/koin setiap ±10 detik saat halaman Overview/Binance dibuka.
- Data Binance memakai cache singkat: saldo default 5 detik dan harga koin default 2 detik, sehingga konversi kepemilikan koin ke USDT terasa lebih cepat namun tetap aman dari rate limit.

### 🤖 AI Keuangan Responsif
- **ChatGPT/OpenAI sebagai AI utama** untuk parsing, analisis, tips, prediksi, dan tanya-jawab.
- **Gemini fallback** otomatis bila provider utama gagal.
- Error quota/rate limit memakai circuit breaker: provider bermasalah langsung di-cooldown tanpa mengulang error 429 berkali-kali.
- Bot tetap dapat mencatat transaksi dengan parsing lokal meski seluruh provider AI sedang tidak tersedia.
- Command `ai [pertanyaan]` untuk bertanya dengan konteks data keuangan.
- Command `analisis`, `tips`, dan `prediksi` untuk insight keuangan.
- Mesin insight lokal membaca skor kesehatan, risiko budget, dominasi kategori, ritme belanja, transaksi terbesar, dan fokus aksi harian.
- Prompt AI memakai konteks lebih kaya: budget, saldo dompet, perbandingan bulan lalu, pacing pengeluaran, serta rencana aksi prioritas.

### 🎯 Budget & Monitoring
- Budget default per kategori.
- Command `set budget [kategori] [nominal]`.
- Alert otomatis saat penggunaan budget mencapai 85% dan 100%.
- Command `budget` tampil sebagai tabel pemantauan.
- Budget WhatsApp dan dashboard web memakai konfigurasi kategori yang sama.
- Limit budget dapat diubah langsung dari dashboard web.

### 🌐 Dashboard Web
- Dashboard web di port `7860`.
- Setiap nomor WhatsApp mendapat link dashboard pribadi yang hanya menampilkan transaksinya sendiri.
- Link akses ditandatangani, memiliki masa berlaku, dan dikirim langsung melalui command bot.
- Super admin dapat melihat seluruh nomor dari spreadsheet, ringkasan gabungan, lalu membuka detail setiap pengguna.
- Dashboard profesional berbasis menu agar hanya fitur yang sedang dibuka yang tampil; menu dapat disembunyikan/dimunculkan dari tombol `☰ Menu`.
- Desain dashboard dirombak ke tema **liquid glass** cerah, berwarna, translusen, rounded, dan lebih responsif di HP.
- Tersedia Overview, Binance, Analitik, Laporan, Tren, Budget, Transaksi, Katalog Kategori, Sistem, Command, dan panel Super Admin.
- Overview punya **Smart Radar**: fokus hari ini, level risiko, ritme belanja, dan transaksi pengeluaran terbesar.
- Pemilih periode global dapat membuka laporan bulanan atau tahunan lama; transaksi dan analitik otomatis mengikuti periode terpilih.
- Halaman Laporan berisi ringkasan arus kas, tabungan akumulasi, tabel 12 bulan, transaksi lengkap, dan export Excel dengan diagram bar modern.
- Grafik Tren memakai visual arus kas premium dengan area, skala nilai, titik data, dan indikator hari tersibuk.
- Analitik terintegrasi menampilkan skor keuangan, perubahan bulanan, batas aman harian, komposisi pengeluaran, level risiko, dan rencana aksi otomatis.
- Form transaksi memberi saran kategori pintar berdasarkan keterangan yang diketik.
- Transaksi dapat dicari serta difilter berdasarkan jenis dan kategori.
- Transaksi dapat dicari, difilter, ditambahkan, diedit, dan dihapus langsung dari dashboard.
- Setelah edit/hapus, saldo setiap dompet dihitung ulang otomatis agar data tetap konsisten.
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
| `GEMINI_API_KEY` | Opsional* | API key Gemini sebagai fallback |
| `GEMINI_MODELS` | Opsional | Daftar fallback model Gemini dipisah koma |
| `AI_QUOTA_COOLDOWN_MINUTES` | Opsional | Lama menonaktifkan provider AI saat quota/billing habis, default `360` menit |
| `AI_RATE_LIMIT_COOLDOWN_MINUTES` | Opsional | Lama cooldown saat rate limit, default `2` menit |
| `WHATSAPP_PHONE_NUMBER` | Ya | Nomor WA format internasional, contoh `628xxx` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Ya* | JSON service account Google satu baris |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | Opsional | Alternatif paling aman untuk Railway: base64 dari file JSON service account utuh |
| `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY` | Opsional | Alternatif bila tidak memakai JSON utuh |
| `DASHBOARD_SECRET` | Disarankan | Secret panjang untuk menandatangani link dashboard pribadi |
| `DASHBOARD_BASE_URL` | Ya untuk deploy | URL publik aplikasi, contoh `https://bot-kamu.up.railway.app`. Boleh diisi domain saja; bot akan menambahkan `https://` otomatis. |
| `RAILWAY_PUBLIC_DOMAIN` | Opsional | Domain publik dari Railway; dipakai fallback bila `DASHBOARD_BASE_URL` kosong |
| `PUBLIC_BASE_URL` / `APP_URL` | Opsional | Alias URL publik bila tidak memakai `DASHBOARD_BASE_URL` |
| `DASHBOARD_LINK_DAYS` | Opsional | Masa berlaku link dashboard, default `30` hari |
| `SUPER_ADMIN_NUMBERS` | Ya untuk admin | Nomor super admin dipisah koma, contoh `628111,628222` |
| `DASHBOARD_TOKEN` | Opsional | Token admin lama untuk kompatibilitas/fallback |
| `PORT` | Opsional | Default `7860` |
| `BINANCE_BALANCE_NUMBER` | Opsional | Nomor yang boleh memakai saldo Binance realtime, default `33827179200526` |
| `BINANCE_API_KEY_33827179200526` | Ya untuk Binance | API Key Binance khusus nomor `33827179200526` |
| `BINANCE_API_SECRET_33827179200526` | Ya untuk Binance | API Secret Binance khusus nomor `33827179200526` |
| `BINANCE_CACHE_SECONDS` | Opsional | Cache saldo Binance, default `5` detik |
| `BINANCE_PRICE_CACHE_SECONDS` | Opsional | Cache harga market koin ke USDT, default `2` detik agar konversi lebih realtime |
| `BINANCE_TOP_ASSETS_LIMIT` | Opsional | Jumlah aset Binance maksimal yang ditampilkan di dashboard, default `50` |
| `BINANCE_MIN_ASSET_USDT` | Opsional | Saring aset debu berdasarkan estimasi minimal USDT, default `0` |
| `BINANCE_USDT_IDR_MODE` | Opsional | `auto` mengambil USDT/IDR dari ticker Binance; `manual` memakai fallback Railway |
| `BINANCE_USDT_IDR_SYMBOL` | Opsional | Symbol ticker Binance untuk rate Rupiah, default `USDTIDR` |
| `BINANCE_IDR_RATE_CACHE_SECONDS` | Opsional | Cache rate USDT/IDR otomatis, default `5` detik |
| `BINANCE_USDT_IDR_RATE` | Opsional | Fallback manual jika ticker USDT/IDR Binance tidak tersedia, contoh `16400` |
| `BINANCE_BASE_URL` | Opsional | Default `https://api.binance.com` |

Tanpa AI key, bot tetap berjalan menggunakan parsing dan analisis lokal. Untuk fitur AI penuh, isi OpenAI sebagai utama dan Gemini sebagai fallback.

### 🚄 Template Variabel Railway

```env
SPREADSHEET_ID=isi_id_google_spreadsheet

# PILIH SALAH SATU CARA SERVICE ACCOUNT GOOGLE:
# Cara A: JSON satu baris. private_key harus berisi \n, bukan enter manual yang terpotong.
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"..."}
# Cara B paling aman untuk Railway: isi base64 dari file JSON service account utuh.
GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=
# Cara C alternatif: pisahkan email dan private key.
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=

WHATSAPP_PHONE_NUMBER=628xxxxxxxxxx

DASHBOARD_BASE_URL=https://nama-project.up.railway.app
DASHBOARD_SECRET=ganti_dengan_secret_panjang_acak
DASHBOARD_LINK_DAYS=30
SUPER_ADMIN_NUMBERS=628xxxxxxxxxx,628yyyyyyyyyy

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_MODELS=gpt-4o-mini
GEMINI_API_KEY=
GEMINI_MODELS=gemini-2.5-flash,gemini-1.5-flash,gemini-1.5-flash-8b
AI_QUOTA_COOLDOWN_MINUTES=360
AI_RATE_LIMIT_COOLDOWN_MINUTES=2

# Binance realtime khusus nomor 33827179200526
BINANCE_BALANCE_NUMBER=33827179200526
BINANCE_API_KEY_33827179200526=isi_api_key_binance_khusus_nomor_ini
BINANCE_API_SECRET_33827179200526=isi_api_secret_binance_khusus_nomor_ini
BINANCE_CACHE_SECONDS=5
BINANCE_PRICE_CACHE_SECONDS=2
BINANCE_TOP_ASSETS_LIMIT=50
BINANCE_MIN_ASSET_USDT=0
# Auto = ambil rate USDT/IDR dari Binance. Manual = pakai BINANCE_USDT_IDR_RATE saja.
BINANCE_USDT_IDR_MODE=auto
BINANCE_USDT_IDR_SYMBOL=USDTIDR
BINANCE_IDR_RATE_CACHE_SECONDS=5
# Fallback manual kalau Binance tidak menyediakan pair USDTIDR atau request gagal.
BINANCE_USDT_IDR_RATE=
BINANCE_BASE_URL=https://api.binance.com

# Railway biasanya mengisi PORT otomatis. Isi hanya jika perlu.
PORT=7860
```

Minimal agar bot jalan di Railway: `SPREADSHEET_ID`, salah satu service account Google (`GOOGLE_SERVICE_ACCOUNT_JSON` atau `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` atau `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`), `WHATSAPP_PHONE_NUMBER`, `DASHBOARD_BASE_URL`, dan `DASHBOARD_SECRET`. Tambahkan `OPENAI_API_KEY` untuk AI utama, lalu `GEMINI_API_KEY` bila ingin fallback.


### Mengatasi error `DECODER routines::unsupported`

Error ini berarti private key Google Service Account tidak bisa dibaca oleh Node/OpenSSL. Biasanya terjadi karena `private_key` di Railway kehilangan `\n`, terpotong, diberi tanda kutip tambahan, atau ditempel sebagai multiline yang rusak. Solusi paling aman:

```bash
base64 service-account.json
```

Salin hasilnya ke Railway Variable `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`, lalu kosongkan atau hapus `GOOGLE_SERVICE_ACCOUNT_JSON` yang rusak. Pastikan file JSON service account juga sudah diberi akses Editor/Viewer pada Google Spreadsheet yang dipakai.

Cek status dari browser:

```text
https://domain-railway-kamu.up.railway.app/api/env-check
```

Nilai `googleServiceAccountParsed`, `googleClientEmail`, dan `googlePrivateKeyReady` harus `true`.

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
saldo binance                -> Saldo spot Binance realtime khusus nomor 33827179200526
hari ini                     -> Laporan hari ini
minggu ini                   -> Laporan 7 hari terakhir
bulan ini                    -> Laporan bulan berjalan
laporan Mei 2026             -> Laporan lengkap bulan tertentu
riwayat bulan lalu           -> Laporan dan transaksi bulan sebelumnya
laporan tahunan 2026         -> Ringkasan 12 bulan + transaksi setahun
laporan 2026                 -> Alias laporan tahunan
tabel bulan ini              -> Alias laporan tabel
export bulan ini             -> Download laporan bulan ini sebagai Excel
export Mei 2026              -> Download laporan bulan tertentu sebagai Excel
export tahun 2026            -> Download laporan setahun sebagai Excel
export semua                 -> Download semua transaksi sebagai Excel

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
Link yang dikirim memakai format pendek `/d/<token>` dan URL lengkap dikirim sebagai pesan terpisah agar lebih mudah diklik di WhatsApp iPhone.

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

1. Pastikan env utama bot sudah lengkap: `SPREADSHEET_ID`, service account Google, dan `WHATSAPP_PHONE_NUMBER`. Untuk Railway, cara paling aman adalah memakai `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`. AI key bersifat opsional.
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
