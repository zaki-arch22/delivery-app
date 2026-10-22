# Free test server: Neon (database) + Firebase (Google login) + Render (server)

All three are free and need **no bank card**. This server is for TESTING with the owner and a few people, not for real customers
(launch needs a real server: CLAUDE.md section 9).

What you get: one web address, for example `https://delivery-api-xxxx.onrender.com`.
- the phone app talks to it;
- the staff console opens at the same address + `/staff/` (for approving drivers, opening zones, setting prices).

Free limits: after 15 minutes with nobody using it the server sleeps; the next person waits about 1 minute while it wakes.
The database holds up to about 1 GB. Road routes (the line on the map, km and minutes) come from the free public OSRM service of FOSSGIS (`ROUTING_URL`, set by `render.yaml`; fair use, fine for testing). If it is slow or down, quotes fall back to the straight-line estimate. If your service was created before Oct 2026, add in Render → Environment: `ROUTING_URL` = `https://routing.openstreetmap.de/routed-car` and `ROUTING_TIMEOUT_MS` = `3000`.

## 1. Neon: the database (about 3 minutes)
1. Go to https://neon.com and sign up (the "Continue with Google" or "Continue with GitHub" button is easiest).
2. Create a project: name `delivery`, region **AWS Europe Central 1 (Frankfurt)** (closest to Algiers, same place as the server). Keep the other choices.
3. On the project page press **Connect**. Copy the connection string (it starts with `postgresql://`). Keep it private: it is the key to the database.

## 2. Firebase: Google login (about 5 minutes)
1. Go to https://console.firebase.google.com and sign in with your Google account. **Create a project** named `delivery`. Google Analytics: turn it off. Plan: the free "Spark" plan.
2. Left menu: **Build -> Authentication -> Get started -> Sign-in method -> Google -> Enable**. Choose your email as the support email. **Save**.
3. Open Google again in that list, then **Web SDK configuration**. Copy the **Web client ID** (it ends in `.apps.googleusercontent.com`). Not secret.
4. Gear icon -> **Project settings -> General -> Your apps -> Android icon**:
   - Android package name: `dz.delivery.app`
   - App nickname: `Delivery`
   - Debug signing certificate SHA-1: `FB:15:52:C2:E6:1F:2E:F5:37:85:F1:5D:63:B5:BF:C7:25:FE:77:B2`
   - **Register app**, then **Download google-services.json**. Open the file and paste its content to Claude (it is not secret: it goes inside the app).

## 3. Render: the server (about 10 minutes, most of it waiting)
1. Go to https://render.com and sign up with **GitHub** (the account that owns `zaki-arch22/delivery-app`).
2. **New + -> Blueprint**. Connect the repository `zaki-arch22/delivery-app`. Branch: **`claude/wizardly-mayer-zl48ge`**.
3. Render reads the file `render.yaml` and asks for these values:
   - `OWNER_DATABASE_URL`: the Neon connection string from step 1.
   - `GOOGLE_CLIENT_IDS`: the Web client ID from step 2.
   - `FIRST_ADMIN_EMAIL`: your email (your staff login).
   - `FIRST_ADMIN_PASSWORD`: a NEW password of at least 12 characters, only for the staff console. Write it down.
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: leave empty for now (phone notifications: section 4).
   Press **Apply**. The first build takes about 5 minutes.
4. When the service shows **Live**: open it, then **Logs**. Find the box `FIRST STAFF ACCOUNT CREATED`. Open the free
   **Google Authenticator** app on your phone, tap **+ -> Enter a setup key**, and type the secret shown in the box.
   That app now gives you the 6-digit staff code.
5. **Environment** tab: delete `FIRST_ADMIN_PASSWORD` and save (it is no longer needed; the account exists).
   Lost the secret, or it is not in the log? **Environment** tab: add `FIRST_ADMIN_RESET` = your staff email and
   `FIRST_ADMIN_PASSWORD` = a NEW password (12+ characters), save, wait for **Live**, then search the log for
   `STAFF ACCOUNT RESET`. Then delete both settings. (Each reset happens once per new password.)
6. Copy the address shown at the top of the service page (`https://....onrender.com`) and send it to Claude.

## 4. Phone notifications (about 5 minutes, free)
Notifications reach phones through Firebase Cloud Messaging (free, no card). The server needs ONE private key from Firebase.
1. https://console.firebase.google.com -> your project -> gear icon -> **Project settings -> Service accounts**.
2. Press **Generate new private key** -> **Generate key**. A small `.json` file downloads. It is SECRET (it lets anyone send
   notifications as your app): never send it in a chat or e-mail, and never put it on GitHub.
3. Open the file with Notepad, select everything (Ctrl+A) and copy it (Ctrl+C).
4. Render -> your service -> **Environment** -> `FIREBASE_SERVICE_ACCOUNT_JSON` -> **Edit** -> paste the whole text -> **Save,
   rebuild and deploy**. (Pasting it exactly as it is in the file is fine.)
5. When the service is **Live**, open the staff console: the dashboard shows a green line "Phone notifications are ON"
   with your Firebase project name. A red line means the key is missing or was not pasted completely: paste it again.
6. On the phone: install the newest APK and press **Allow** when the app asks to send notifications (or Android Settings
   -> Apps -> Delivery -> Notifications -> on). Log in once: the app then registers the phone.
7. Test with two phones: phone A orders a delivery, then CLOSES the app; phone B (a courier, online, app open nearby)
   makes an offer or accepts. Phone A rings with a notification, and tapping it opens the order. (A courier must keep
   the app open while working, because the app sends his position only while it is open.)
iPhone later: Apple's push needs the Apple developer account ($99 per year) and an Apple push key added in Firebase.

## What Claude does next
Puts the address and the Google settings into the app, builds a new APK, and tells you how to open the first zone and set
the first prices in the staff console (until a zone is open, orders are refused: new zones start closed on purpose).

## Technical notes (for Claude / developers)
- `render.yaml` (repository root) is a Render Blueprint: one free Node web service in Frankfurt. Build: backend + staff console
  (`VITE_BASE=/staff/`). Start: `backend/deploy/render-start.sh` = migrations as the owner, refresh of the limited role
  `delivery_app` (password `APP_DB_PASSWORD`, made by Render), first staff account, then the server as the LIMITED role with
  the owner's address removed from its environment. Restarts are safe (tested on a database whose owner is not a superuser, like Neon).
- Neon's pooled address (`-pooler`) is replaced by the direct one automatically: live notifications need LISTEN.
- Photos are in the database (no disk on Render's free plan). Push stays off until `FIREBASE_SERVICE_ACCOUNT_JSON` is set.
- Commission (10%) and courier wallet top-ups stay off until `PLATFORM_RIP` (the platform's 20-digit Algérie Poste RIP, starting 00799999) and `PLATFORM_HOLDER` (the account holder's name) are set in Environment. Seller payments (cash on delivery) work without them.
- `TRUST_PROXY=1`: check on the live server that rate limits see the real client address (security log `ip` values).
