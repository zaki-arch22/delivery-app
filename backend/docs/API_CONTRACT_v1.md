# API Contract v1 (single source of truth for the app and the backend)

Rules
- Every screen calls only functions listed here. A function without a screen is not built. A screen without a function is not built.
- All requests need `Authorization: Bearer <token>` except the ones marked PUBLIC.
- The token holds: account id, ACTIVE profile id, profile type (`user` or `driver`) or `staff`. A function marked USER refuses a driver token, and the reverse.
- Money = whole dinars (integer). Times = ISO 8601 UTC. Phone = international format (+213...).
- Errors: `{ "error": "CODE", "message": "..." }` with HTTP 400/401/403/404/409.
- `Idempotency-Key` header is required on create_order (a repeated key returns the first order, never a second one).

## A. Account and profiles (user app and driver path share these)
| Function | Who | Request | Answer |
|---|---|---|---|
| send_code | PUBLIC | phone | ok |
| verify_code | PUBLIC | phone, code, path (`user`\|`driver`) | token, refresh_token, profiles[], active_profile (null if the chosen path has no profile yet), needs_profile (the path, or null) |
| refresh_token | PUBLIC | refresh_token | token, refresh_token |
| switch_profile | ACCOUNT | type | token, active_profile (needs the profile to exist) |
| upload_document | ACCOUNT | query `kind` (`id_photo`\|`licence_photo`\|`vehicle_photo`); the BODY is the photo itself (Content-Type image/jpeg, image/png or image/webp, max 6 MB) | document_id, kind. The photo is checked by decoding it, redrawn as a clean JPEG (hidden data removed, max 2000 px) and kept privately. Errors: IMAGE_ONLY 415, TOO_LARGE 413, BAD_IMAGE, IMAGE_TOO_SMALL (under 300 px), TOO_MANY_UPLOADS 429 (10 unused photos per account; unused photos are deleted after a day) |
| add_profile | ACCOUNT (first profile) or the active profile (second profile, from Settings only) | type, display_name (+ for a driver: documents {vehicle `motorbike`\|`car`, id_photo, licence_photo, vehicle_photo} = the three document_ids) | profile (driver starts `pending_approval`). BAD_DOCUMENT if a photo is someone else's, in the wrong place, or already used |
| get_me | ACCOUNT | - | account, profiles[], active_profile |
| logout | ACCOUNT | - | ok |
| logout_everywhere | ACCOUNT | - | sessions_ended (ends every device and live connection; for a lost phone) |

verify_code rule (ONE PROFILE AT FIRST): the account is created or found by phone. (1) Number with NO profile yet: `needs_profile` = the chosen path, and the app shows the profile-creation screen that calls add_profile; until then the token can call only get_me, add_profile, switch_profile, logout. (2) Number that already has the chosen profile: it opens. (3) Number that already has a profile but NOT the chosen one: nothing is created. The person lands in the profile they have, with `notice` = {code: NO_PROFILE_FOR_PATH, missing: path}, and the app tells them they can add the other profile from Settings. Never a "wrong role" error.

add_profile rule: the FIRST profile is created right after login (path choice). The SECOND profile is created only from Settings, while logged in to the first one; a session with no profile cannot create a second (error USE_SETTINGS).

## B. User path (active profile = user)
| Screen | Function | Request | Answer |
|---|---|---|---|
| New order | get_quote | pickup {lat,lng}, dropoff {lat,lng}, size | recommended_da, min_da, max_da, vehicle, distance_m, duration_s, distance_estimated (true = road distance unavailable, straight-line estimate used; the app shows "about"), quote_id (valid 5 min); error ZONE_CLOSED if either point is outside an open zone |
| Price | create_order | quote_id, offered_da, pickup_address{...}, dropoff_address{...}, recipient_name, recipient_phone, payer, cod_amount_da | order |
| Tracking | get_order | order id | order + driver summary (name, photo, rating, vehicle) + delivery_code |
| Tracking | cancel_order | order id, reason | order (only while `searching` or `assigned`) |
| Searching | raise_price (negotiation, upward only) | order id, new_offered_da | order (only while `searching`, only upward, inside max_da) |
| My orders | list_orders | page | orders[] (own only) |
| Rate | submit_rating | order id, stars 1-5, comment? | ok (delivered orders only, once) |
| Problem | report_problem | order id, reason, note? | report |
Live updates: see section G (one WebSocket per logged-in profile). Driver location while a job is active is read with get_order (polled every few seconds) until live location sharing is added.

## C. Driver path (active profile = driver, status active)
| Screen | Function | Request | Answer |
|---|---|---|---|
| Home | set_online | online true/false | state (refused if profile is not `active`) |
| Home | update_location | lat, lng | ok (only while online) |
| Home | get_driver_home | - | earnings_today_da, cash_held_da, cash_limit_da, rating |
| Offer | get_current_offer (FALLBACK only: used when the live connection is down or just reconnected) | - | offer (price, pickup distance, trip distance, payment type, cash amount, sender rating, expires_at) or null |
| Offer | accept_offer / decline_offer | offer id | job (accept is atomic: only one driver can win) |
| Active job | get_job | - | the current job incl. pickup/dropoff, cash to collect |
| Active job | update_job_step | order id, step (`picked_up`\|`delivered`), delivery_code (for delivered), cash_collected_da (if cash order) | job |
| Can't deliver | report_delivery_failure | order id, reason (`no_answer`\|`refused`\|`wrong_address`) | job (original -> `failed`, a `return` leg is created) |
| Earnings | list_jobs | page | jobs[] |
| Cash | get_cash_balance | - | balance_da, entries[] |
| Rate | submit_rating | same function as above, used by the driver on the user | ok |
Live updates: see section G.

## D. Staff functions (built and tested)
Staff use a separate login (email and password, created with `npm run create-admin`). A staff token works ONLY on staff functions and a user or driver token never does. 5 wrong passwords lock the account for 15 minutes; deactivating a staff member ends their access at once. Every staff action is saved in a permanent audit trail (who, what, when) that can never be edited or deleted. Every id returned is a real number or text id, never a number in quotes.

| Function | Request | What it does |
|---|---|---|
| staff_login (public) | email, password, code (6-digit authenticator code, required) | token (2 hours), staff. A code works once. Same error for any wrong factor. |
| staff_logout | - | ends all of this staff member's logins on every device |
| list_pending_drivers | - | drivers waiting, with phone, vehicle, and documents {id_photo, licence_photo, vehicle_photo} (ids) |
| get_document | id | the photo itself (image/jpeg). Staff only; every view is saved in the audit trail. Photos are never shown to app logins |
| approve_driver | profile_id, cash_limit_da (required; 0 = no cash-on-delivery orders) | driver becomes active; driver gets a push |
| reject_driver | profile_id, reason | driver rejected; push (the reason is shown in the app) |
| suspend_profile / unsuspend_profile | profile_id, reason | one profile only; a suspended driver goes offline at once; the other profile on the same phone is untouched; a never-approved driver cannot be unsuspended into service |
| list_drivers | status?, online?, holding_cash?, page | drivers with rating, deliveries, cash held |
| list_all_orders | status?, unassigned?, problem?, leg?, older_than_min?, q? (reference or any phone), page | the order list |
| get_order_timeline | id | full order: both phones, addresses, every event (with who did it), offers, ratings and comments, problems, cash entries. Never the delivery code (it protects against fraud, including by insiders). |
| staff_order_action | order_id, action, reason (+ which, address, point for correct_address) | cancel (searching or assigned), reassign (assigned: releases the price lock, restarts the search, never re-offers the old driver), correct_address (before/after saved; pickup cannot change after pickup), reset_code_attempts (after 5 wrong codes), start_return (picked up) |
| list_problems / resolve_problem | status?, page / id, status (in_progress or resolved), resolution (required to resolve) | problems from users and drivers; the reporter gets a push when resolved |
| list_ratings | profile_id?, max_stars?, with_comment?, page | ratings with their comments (staff only) |
| get_driver_cash | profile_id | balance, limit, ledger entries |
| record_cash_handover | driver_profile_id, amount_da, note? | permanent entry with a receipt number; cannot exceed the cash held; two simultaneous handovers cannot both succeed; the driver gets a push with the receipt number |
| add_cash_adjustment | driver_profile_id, note (required), amount_da or reverses_id | a correction as a NEW entry; a reversal is the exact opposite and can happen only once |
| create_zone / list_zones / set_zone_open | name + GeoJSON polygon / - / zone_id, open | zones start CLOSED; opening is a separate step |
| get_pricing / create_pricing_version | - / base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent | a new version replaces the active one; existing orders keep theirs |

Not built (decided): two-person approval for large cash adjustments (needs a team to exist), a staff audit viewer (the audit trail is stored; reading it is done by the owner with the database for now).

## E. Order status rules (the only allowed moves)
searching -> assigned (driver accepts; price locks) | cancelled | expired (no driver in the search window)
assigned -> picked_up | cancelled | searching (staff reassign)
picked_up -> delivered (correct delivery_code) | failed (driver reports failure)
failed -> a new `return` order is created for the same driver, pointing back to the sender's pickup address.
delivered, cancelled, expired, failed are final.
Cash: delivered with a cash amount writes one `cod_collected` ledger entry for that driver. Handovers are recorded only by staff.

## F. Built and tested rules (order system v1)
- Parcel size decides the vehicle: small and medium -> motorbike, large -> car.
- Recommended price = base + per-km x km (rounded up) + size and car extras, rounded UP to 10 DA. The allowed range is min% to max% of it (staff set the numbers in the price table).
- A quote is valid 5 minutes, usable once, only by its owner. The zone check runs at quote AND at order creation.
- Matching: one driver at a time, nearest first. Eligible = online, active, right vehicle, location fresher than the limit, inside the search radius, no active job, no open offer, cash limit not exceeded, and NOT the same account as the sender. The radius widens after a delay. The order expires if nobody takes it in the search window.
- A driver can hold ONE active job; the database enforces it.
- Delivery code: 4 digits, shown to the sender (and pushed to the recipient if registered). After 5 wrong tries the order locks and only staff can continue it.
- Cash to collect at delivery = cash-on-delivery amount + (the delivery fee if the recipient pays). The ledger records ONLY the cash-on-delivery amount. Delivery-fee and return-fee money rules are finance rules (parked); returns carry a price of 0 for now.
- Failed delivery: original order -> failed, a `return` leg is created already picked up and pointing back to the sender, a problem report is opened for staff. A failed return goes to staff only.
- Steps are safe to resend (offline queue): repeating a finished step returns success.
- Tunable values (offer time, radius, search window, fallback route factor) live in src/common/config.ts and are starting defaults, to be tuned with real data.

## G. Notifications (built and tested)
**Atomic.** A notification row is written in the SAME database transaction as the event that causes it. If the event rolls back, no notification exists; if it commits, the notification is guaranteed. A database trigger announces committed rows, so there is no "event saved but notification lost" and no "notification sent for something that did not happen".
**One profile only.** Every notification belongs to exactly one profile. The two profiles on one phone number never receive each other's.
**Same event, one notification.** A unique key per (profile, event) prevents duplicates.

### G1. Live connection: `ws://<server>/ws`
1. App sends `{"type":"auth","token":"<access token>","since":<last notification id it has, or 0/omitted>}` within 5 seconds, else it is closed (code 4401).
2. Server answers `{"type":"ready"}`, then replays everything after `since` that is still valid, in order. With `since` = 0 or omitted only live items (an open offer) are replayed.
3. Then each new notification arrives instantly: `{"type":"notification","id":123,"kind":"offer.new","order_id":"...","data":{...},"priority":"high","created_at":"...","expires_at":"..."|null}`.
4. The app keeps the highest `id` it has seen, ignores any `id` it already has, and sends it as `since` on every reconnect. Nothing is missed and nothing is shown twice. `{"type":"ping"}` is answered with `{"type":"pong"}`.
5. The connection belongs to ONE session and ONE profile. Switching profile or logging out closes it (code 4403); the app reconnects with the new token. A token for another profile is refused.

### G2. Notification kinds
| kind | goes to | when | data | push to a closed app |
|---|---|---|---|---|
| offer.new | driver | an order is offered to them (high priority, has expires_at) | offer_id, ref, price_da | yes |
| offer.updated | driver | the user raised the price of the open offer | offer_id, price_da | no |
| offer.withdrawn | driver | the offer ended: expired, order cancelled, or order expired | offer_id, reason | no |
| job.cancelled | driver | the user cancelled after the driver accepted (high priority) | ref | yes |
| order.incoming | recipient (only if registered) | an order for their phone number was created | ref, delivery_code | yes |
| profile.approved / profile.rejected / profile.suspended / profile.unsuspended | the profile concerned | a staff decision | reason (rejected only) | yes |
| order.cancelled / order.reassigned | user | staff cancelled / are finding another driver | ref | yes |
| job.updated | driver | staff corrected the address | ref | yes |
| problem.resolved | the reporter | staff resolved their report | problem_id | yes |
| cash.handover / cash.adjusted | driver | staff recorded a handover (receipt number) / an adjustment | amount_da, receipt / entry | yes |
| security.new_login | every profile of the account | someone logged in on another device | - | yes |
| order.assigned | user | a driver accepted | ref | yes |
| order.picked_up | user | the parcel was picked up | ref | yes |
| order.delivered | user | delivered (the app then asks for a rating) | ref | yes |
| return.delivered | user | the returned parcel reached the sender | ref | yes |
| order.failed | user | delivery failed; a return leg started | ref, reason | yes |
| order.expired | user | no driver found in time (the app suggests raising the price) | ref | yes |

### G3. Phone push (app closed): `register_device`
`register_device {token, platform: android|ios, language: ar|fr|en}` (needs an active profile). The app calls it after login, after every profile switch, and whenever the push token changes. The token always belongs to the ACTIVE profile of that session: switching profile moves it, logging out deletes it. Push text is built on the server in the device's language (Arabic, French or English; wording to be reviewed by native speakers). When the person changes the app language in Settings, the app calls register_device again with the same token and the new language. A push carries data {id, kind, order_id, ...}; the app uses `id` to avoid showing again what the live connection already showed. Failed pushes retry with growing delays (up to 5 attempts); invalid tokens are deleted.
Android uses Firebase directly and iPhone through Apple's push service via Firebase (needs the Firebase key; not yet tested against real Firebase).

### G4. No SMS (except login verification)
SMS is used ONLY to verify a phone number at login (send_code). Nothing else is ever sent by SMS. Email is not used at launch (an email channel could later be added to the notification delivery worker, like push).
How the recipient gets the delivery code:
1. The sender always sees the 4-digit code in the app (get_order) and gives it to the recipient.
2. If the recipient's phone number belongs to a registered user, that user also receives `order.incoming` (live and as a push) containing the code. A sender who names their own number is not notified.
3. A recipient with no account receives nothing from the platform.

### G5. Rules added with notifications
- A driver who switches to the other profile or logs out goes offline automatically, and their open offers are declined.
- Offers expire on their own and the driver's screen is told, so it clears itself.

## H. Languages in the app
Arabic (right-to-left), French and English. The app starts in the device language when it is one of these (otherwise English), and the person can change it in two places: a small language switch on the very first screen (before the path choice) and in Settings. The choice is stored on the phone and sent with register_device so push notifications use the same language. All text, dates and numbers follow the chosen language. Address fields accept Arabic and Latin letters in any language mode.

## I. No mock data, ready to launch empty
- The database is built ONLY by the schema files in db/ (npm run migrate). Nothing inserts data: no sample users, drivers, orders, prices, or zones. Every table is empty at launch; the only rows are the staff account you create and what staff configure (price table, zones).
- The app contains no placeholder data either: every list has a designed empty state (for example "No orders yet"), and nothing is pre-filled.
- Everything that exists only for tests (fake SMS and push recorders, test routes under /dev) lives in one place and is switched on only by TEST_HOOKS=1. The server refuses to start in production with it, and the routes do not exist otherwise. Tests run on a separate test database (TEST_DATABASE_URL), never the real one.
- `npm run launch-check` lists exactly what is still missing before real users can be served.
- If the SMS provider is unavailable, the login-code request answers SMS_UNAVAILABLE (503) and leaves nothing behind.

## J. Security rules the apps must follow (details in docs/SECURITY.md)
- HTTPS only. Store the access and refresh tokens in the phone's secure storage (Keychain / Android Keystore), never in plain files or logs.
- When refresh_token is answered with 401, send the person to the login screen. Never retry an old refresh token: a reused refresh token ends the session on purpose.
- Handle 429 (RATE_LIMITED, SERVICE_BUSY, TOO_MANY_CODES): show a calm message and wait Retry-After seconds. Settings must offer "Log out of all devices" (logout_everywhere).
- Staff console: ask for email, password and the authenticator code; keep the token in memory only; the console's address must be listed in STAFF_ORIGINS.
- Request limits to design for: 120 requests/minute per logged-in session; bodies up to 64 KB; live-connection messages up to 8 KB; at most 5 live connections per profile.
