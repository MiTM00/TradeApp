# Trade — WeChat Mini Program

Records the products you source:

- Product name, photos (up to 6 — **Add photo** offers *Take photo* or *Choose from gallery*), size
- Price (¥ / $), minimum order (MOQ) + unit (pcs, kg, box…)
- Market name, shop name and shop location (picked on the map, opened in **Amap / 高德地图**)
- **Report** tab: totals, breakdown by market, and full export to **PDF** and **Excel (.xlsx)**

## Open the project

1. Install **WeChat DevTools** (微信开发者工具): https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
2. *Import project* → choose `C:\Users\aa\Projects\trade`
3. AppID: use `touristappid` (testing) or your own AppID.
4. Click *Preview* to try it on your phone.

## Report export

- **PDF** — A4 pages with a cover (totals and counts), a market overview, then every product grouped by market with its cover photo, price, MOQ, value at MOQ, shop and location.
- **Excel** — `Summary` sheet (overview, totals per currency, by market, by shop) and `Products` sheet (one row per product with its photo embedded, frozen header and filters).

After exporting, tap **Open / Save** (opens the file in WeChat, where you can save or forward it) or **Send to chat**.
The export code lives in `utils/report.js`, `utils/pdf.js`, `utils/xlsx.js` and `utils/zip.js` — no server or extra library needed.

## Amap

A mini program cannot open another app directly, so:

- **Open in Amap** → opens the WeChat map (`wx.openLocation`). Tap 导航 → choose **高德地图**.
- **Copy link** → copies a `uri.amap.com` link. Paste it in a browser and the Amap app opens.

Locations use GCJ-02, the same coordinate system as Amap, so the pin lands in the right place.

## Data

Data is stored on the phone (`wx.setStorageSync`, photos in `USER_DATA_PATH`).
To share the same data between several people you would need a database (e.g. WeChat Cloud Development).

## Markets

The **Markets** tab is the list of markets you work with (name + optional area/note). When adding a product you tap a market;
if it is not there, tap **＋ Not in the list** and type it — it is added to the list automatically.

## Reports

**Reports** tab: Overview, **Daily**, **Monthly**, **Yearly** (chart + each period with its own PDF / Excel) and **Similar** —
products that are the same by name or by photo (photo fingerprint in `utils/similar.js`), with the cheapest marked and a price-comparison PDF / Excel.
After exporting: **Send by email**, **Save on phone**, send to a chat or open.

## Themes & data

**Settings**: **Theme** button opens a picker with 20 themes (13 light, 7 dark, `utils/themes.js`), each shown as a small preview and applied the moment you tap it, animations on/off, **Backup** (one .json file with all products, markets and photos) and **Restore**.

## Web app (installable on any phone)

- `node preview/serve.js` → http://localhost:5173 (also printed: the address for a phone on the same Wi-Fi)
- Data is stored in IndexedDB on the device and the browser is asked to keep it permanently.
- `node preview/build.js` → `dist/`: static files to upload to any HTTPS host (GitHub Pages, Netlify, Cloudflare Pages).
  Open that address on the phone → browser menu → **Install app / Add to Home Screen**. Works offline after the first visit.
- **Install button**: on any phone that can install, an *Install Trade app* bar appears by itself at the bottom of the app — one tap installs it (Android Chrome / Edge, desktop). iPhone: tapping it shows Share → Add to Home Screen (Apple has no install button for web apps). Android Chrome only offers install on a secure (https) address or localhost, so the bar does not appear on the plain-http Wi-Fi address.
- `node preview/make-icons.js` regenerates the app icons.

## Forms, export, photos

- Form fields use floating labels: the title sits inside the box and moves up when you tap it.
- Reports have one **Export** button; tapping it lets you choose **PDF** or **Excel**.
- **Similar** is tuned to be sensitive: it matches the same words in another order, singular and plural, and closer photos.
- **Auto-crop photos** (Settings, on by default): an object detector that runs on the phone (TensorFlow COCO-SSD, downloaded once and then kept for offline use) finds the product, even on a busy background or in a hand, and crops the photo to it. If the detector finds nothing, a plain-background method is used. A photo the product already fills is left as it is. The original is kept: tap the small icon on a photo to switch between the cropped photo and the original. **Crop photos already saved** applies this to older products.
- **Auto-fill name & size** (Settings, on by default): after a photo is added, the product is recognised on the phone (TensorFlow MobileNet + COCO-SSD, downloaded once and kept offline) and the empty *Product name* and *Size* fields are filled in, e.g. *Water bottle · 500 ml*. Without the AI scanner the size is the usual trade size for that kind of product, marked as an estimate. When the AI scanner is set up and the phone is paired, Claude also reads the photo and its label for a better name and the real size. Only empty fields are filled, and **Undo** puts back what was there.

## Permanent database in the installed app

Settings → *Your data* says where the data is kept and shows the step that makes it permanent: **Connect to the computer**, **Make storage permanent** (the browser keeps the database forever), or, on a computer, **Auto-save to a folder**. That last option writes `Trade-data.json` plus one copy per day after every change, and the file stays even if the browser data is cleared. You can load it back with **Restore**.

## Data that is never lost, on every device

Run the server (`node preview/serve.js`). The computer keeps every product and market in `data/` (one file each, written safely) plus a full copy every day in `data/backups/` (60 days). Every device also keeps its own copy, so it works without internet and catches up later.

Other phones/tablets on the same Wi-Fi: **Settings → Use on another device** on the computer shows a QR code. Scanning it pairs the phone — with the phone camera, or inside the app (iPhone home-screen app, Android app, browser) with **Scan the QR code on the computer** on the phone's *Use on another device* page or in the *Connect* box. Android uses its built-in QR detector; iPhone uses `utils/jsqr.js` (jsQR, Apache-2.0), shipped with the app so it works offline. If the live camera is not available, a photo of the code (camera or gallery) works too; after that all devices show the same products. A device without the pairing code cannot read or change anything.

## AI scanner

**Scan product with AI** (Add product) opens the camera, then Claude (`claude-opus-5-5`) reads the product, its labels and size and fills in name, size, unit and price. Add a Claude API key on the computer in **Settings → AI scanner**. A phone must be paired with the computer to scan — if it is not, the scanner asks for the pairing code (saved in `ai.config.json`, keep it private). Each scan is billed to that key.

## Email

**Send by email** (after exporting a report) asks for the address, subject and message.

- With the Trade server running (`node preview/serve.js`) and an account set up in **Settings → Email** (Gmail, Outlook, QQ, 163, Yahoo or any SMTP, using an *app password*), the report is sent directly with the file attached. The account is saved in `email.config.json` — keep that file private.
- Without it (e.g. the app hosted on HTTPS, or the mini program) the phone's email app opens with the file attached and the address copied.

## Android app (Trade.apk) — installed like any other app

`node android/build.js` (or `npm run apk`) → **`android/Trade.apk`**. Copy it to the phone (USB, WhatsApp, Telegram, email…), tap it, allow *Install unknown apps* for that app once, then **Install**. Trade is then on the home screen like a normal app. It has no browser bar, and the back button works.

- The whole app is inside the APK, so it opens without internet and without the computer. Products are kept in the app's own database on the phone. They are only removed if the app is uninstalled or its data is cleared, so connect to the computer to keep a second copy.
- **Connect to the computer** (sync, AI scanner, email): run `node preview/serve.js` on the computer. On the phone go to **Settings → Use on another device**, type the computer address shown on the computer (e.g. `192.168.1.5:5173`) and the 6-digit code. You can also paste the computer's pairing link into the code box.
- Photos: *Take photo* opens the camera, *Choose from gallery* opens the gallery. The live AI scanner and the map location ask for permission the first time.
- Reports: **Save on phone** → `Downloads/Trade`. **Share** opens WhatsApp, WeChat, Gmail and other apps. **Open** opens the PDF / Excel in a viewer app.
- Updates: build again and install the new APK over the old one. Your data stays. Each build must be signed with the same key, `android/trade.keystore` + `android/keystore.properties` (created on the first build). **Keep a copy of both files.** Without them the phone will not accept an update, and you would have to uninstall the app, which deletes the data on the phone.
- Build needs: Android SDK (platform 35 + build-tools 35) and JDK 17 (`JAVA_HOME`, or a `jdk-17…` folder in `%LOCALAPPDATA%\Programs`). No Gradle or Android Studio.
- Source: `android/AndroidManifest.xml`, `android/src/…/MainActivity.java` (full-screen WebView, camera, files, permissions), `android/src/…/Files.java` (hands files to other apps), `preview/android.js` (connects the web app to the phone; it does nothing in a browser).

## iPhone — installed from the home screen

Apple only allows native iPhone apps built on a Mac with an Apple Developer account. Trade therefore goes on the iPhone as a home-screen app. It has its own icon and no Safari bar, it works offline, and its data stays on the iPhone.

1. On the computer: `npm run iphone` (same as `node preview/serve.js --iphone`). Trade starts, and a secure `https://….trycloudflare.com` address opens through Cloudflare (`cloudflared`, no account needed).
2. On the computer go to **Settings → Use on another device**. An **Install on iPhone** QR code appears.
3. iPhone: scan the code with the camera → Safari opens → **Share → Add to Home Screen** → open Trade once from the home screen.

After that Trade opens on the iPhone without internet and without the computer. While `npm run iphone` is running the iPhone also syncs with the computer. The secure address is open to the internet only while it runs: requests through it are never treated as the computer, and pairing still needs the code. The address changes every time `npm run iphone` starts, so **keep the installed app** and don't add it again. Adding it again from a new address starts an empty app. Products come back only if the computer has them.

## iPhone as the main device (GitHub Pages)

The iPhone app can live at a permanent https address on GitHub Pages, so **every app update reaches the iPhone by itself** and the **iPhone gives the code** the computer connects with.

1. Once on the computer: `gh auth login` (GitHub CLI), then `npm run pages`. It creates the public repository `trade-app` (it holds the app only — never your products), turns Pages on and publishes the app. The address is saved in `hub.config.json`.
2. From then on, every time the Trade server starts it puts the newest app on GitHub Pages (only when something changed) and opens the secure Cloudflare address for the iPhone. The iPhone app checks for a new version each time it opens.
3. iPhone: scan the **Install on iPhone** QR code on the computer → Safari → Share → **Add to Home Screen** → open Trade → **Settings → Use on another device**. The iPhone shows **its own code** (16 letters/numbers, also as a QR code).
4. Computer: **Settings → Use on another device → Connect a phone with its own code** — type the code, or scan the iPhone screen with the computer camera.

How the iPhone finds the computer: the secure address changes every time Trade starts, so the server writes it to `hub/<fingerprint>.json` in the same repository, encrypted (AES-GCM) with the phone's code. Only that phone can read it; it checks the computer's fingerprint before sending anything. Products sync both ways as before (the computer keeps its copy in `data/`, newest change wins).

Any other phone that is not connected also shows its own code; the computer's 6-digit code and QR code still work as before.

## Always connected (phone app ↔ computer)

- **The computer's address changed?** (new Wi-Fi, phone hotspot, the router gave it a new IP) The Android app finds it by itself. When the saved address stops answering, it first tries every address the computer had before, then looks through the networks the phone is on (and the usual hotspot networks) for a Trade server. It only accepts *your* computer: the server answers `GET /api/sync/hello` with a fingerprint of the pairing key (SHA-256, never the key itself), and the phone compares it with its own. Then sync carries on and anything waiting on the phone is sent. No need to type the address or pair again.
- **Start Trade with Windows:** `npm run autostart` puts a small `Trade.vbs` in the Windows Startup folder, so the server starts hidden every time you sign in, and starts it now. `npm run autostart:off` removes it.
- The computer and the phone must be on the same network (same Wi-Fi, or one is the other's hotspot).

## Live sync, data that is never lost, Trash

- **Live sync:** a change on a phone reaches the computer in a fraction of a second. Every other paired device gets it at once, because each device keeps a waiting request open (`GET /api/sync/wait`). If the computer cannot be reached, the phone keeps the change and tries again (2 s, 4 s … 30 s), until it arrives.
- **Never lost:** the computer keeps every record in `data/`, the last 10 versions of each record in `data/history/`, and every deleted record in `data/deleted/`. The last 60 daily copies, plus the first copy of every month (kept forever), are in `data/backups/`. App updates (APK, iPhone, web) never touch `data/`. Each phone keeps its own full copy as well.
- **Trash:** deleting a product moves it into the Trash with a macOS-style "genie" animation. The Trash is on every device, and you can **put back** a product any time. Open it with the trash button on the Products page or in **Settings → Trash**. *Delete forever* / *Empty Trash* remove a product from the Trash on every device, but the computer still keeps it in `data/deleted/`.
- **Settings** has one menu: **Your data**, **Use on another device**, **Backup & restore** and **Trash**. Each opens its own page.
