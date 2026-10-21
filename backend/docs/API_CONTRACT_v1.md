# API Contract v1 (single source of truth for the app and the backend)

Rules
- Every screen calls only functions listed here. A function without a screen is not built. A screen without a function is not built.
- All requests need `Authorization: Bearer <token>` except the ones marked PUBLIC.
- The token holds: account id, ACTIVE profile id, profile type (`user` or `driver`) or `staff`. A function marked USER refuses a driver token, and the reverse.
- Money = whole dinars (integer). Times = ISO 8601 UTC. Phone = international format (+213...).
- Errors: `{ "error": "CODE", "message": "..." }` with HTTP 400/401/403/404/409. A blocked profile gets PROFILE_BLOCKED (403, with until and reason) when starting new work (quote, order, going online, accepting); a banned account gets ACCOUNT_BANNED everywhere except get_me, my_record, appeal_violation, logout. The app sends `X-Device` (the phone's id for this app); only its fingerprint is stored.
- `Idempotency-Key` header is required on create_order (a repeated key returns the first order, never a second one).

## A. Account and profiles (user app and driver path share these)
| Function | Who | Request | Answer |
|---|---|---|---|
| login_methods | PUBLIC | - | google (bool), sms (bool): which login buttons the app shows |
| app_config | PUBLIC | - | place_search (bool): whether the app shows the place search box |
| rename_profile | ACCOUNT (active profile) | display_name (2-60, no control characters) | display_name. Customers only: a courier's name was checked against his ID card (NAME_LOCKED 403) |
| list_notifications | ACCOUNT (active profile) | before? (a notification id, for older pages) | notifications[] {id, type, order_id, data (ref, price_da, reason, name, amount_da, receipt, offer_id only; never a code), created_at}, 30 per page, newest first; screen-only signals (offer.withdrawn, offer.updated, order.bid_withdrawn, bid.expired, job.updated) are left out |
| login_google | PUBLIC | id_token (Google's signed sign-in proof from the phone), path (`user`\|`driver`) | same as verify_code + needs_phone (true until set_phone), google_name (to prefill the profile name). GOOGLE_REJECTED 401 if the proof is not genuine, expired or for another app |
| set_phone | ACCOUNT | phone | phone, phone_verified (false). Google accounts only: the contact number, typed, NOT verified. PHONE_LOCKED if the account's number is verified (SMS) |
| send_code | PUBLIC | phone | ok (LOGIN_METHOD_OFF 403 while SMS login is switched off) |
| verify_code | PUBLIC | phone, code, path (`user`\|`driver`) | needs_phone (false), token, refresh_token, profiles[], active_profile (null if the chosen path has no profile yet), needs_profile (the path, or null) |
| refresh_token | PUBLIC | refresh_token | token, refresh_token |
| switch_profile | ACCOUNT | type | token, active_profile (needs the profile to exist) |
| upload_document | ACCOUNT | query `kind` (`id_photo`\|`licence_photo`\|`ownership_photo`\|`vehicle_photo`); the BODY is the photo itself (Content-Type image/jpeg, image/png, image/webp, application/octet-stream or none: Android labels camera files vaguely; the content decides, max 6 MB) | document_id, kind. The photo is checked by decoding it, redrawn as a clean JPEG (hidden data removed, max 2000 px) and kept privately. Photos are never refused for quality or size in pixels: staff check every photo by eye. Errors: IMAGE_ONLY 415, TOO_LARGE 413, BAD_IMAGE (not a picture), TOO_MANY_UPLOADS 429 (10 unused photos per account; unused photos are deleted after a day) |
| add_profile | ACCOUNT (first profile) or the active profile (second profile, from Settings only) | type, display_name, accept_rules (must be true: RULES_REQUIRED) (+ for a driver: national_id (9-18 digits; one ID card = one driver profile: ID_ALREADY_USED; banned: ID_BANNED), documents {vehicle `motorbike`\|`car`, first_name, last_name (BAD_DRIVER_NAME), birth_date `YYYY-MM-DD`, age 18-80 (BAD_BIRTH_DATE), vehicle_color 2-30 chars (BAD_VEHICLE_COLOR), plate_number (stored upper-case, at least 5 letters/digits: BAD_PLATE), id_photo, licence_photo, ownership_photo (proof the vehicle is his), vehicle_photo (plate visible), vehicle_photos? (up to 3 more vehicle photos)} = document_ids) | profile (driver starts `pending_approval`; nothing is approved automatically). BAD_DOCUMENT if a photo is someone else's, in the wrong place, of the wrong kind or used twice |
| get_me | ACCOUNT | - | account {id, phone, phone_verified, google}, profiles[], active_profile |
| logout | ACCOUNT | - | ok |
| logout_everywhere | ACCOUNT | - | sessions_ended (ends every device and live connection; for a lost phone) |
| delete_account | ACCOUNT | confirm: "DELETE" (else CONFIRM_REQUIRED) | ok. Refused while an order is on its way (ACTIVE_ORDER), a job is held (ACTIVE_JOB) or senders' cash is held (CASH_HELD). Erases the Google link, phone, names, ID number, driver details and document photos; profiles become `deleted`; every session ends. Orders, ratings, cash ledger and trust history stay without identity. Any account or profile id in the body is ignored (only the caller's own account). Public pages for app stores: `/privacy` (privacy policy) and `/delete-account` (how to delete), 3 languages, no script |
| public_profile | ACCOUNT (active profile) | query offer_id OR order_id (BAD_ID / BAD_INPUT) | type, name, photo_url, vehicle (couriers), rating, rating_count, completed (deliveries done, or parcels sent), member_since, comments[{stars, comment, at}] (latest 20, never who wrote them). A customer: the courier of an offer on HIS order (bid/accepted) or the courier of his order; a courier: the sender of an offer shown to HIM or of his job. Anything else: NOT_FOUND (same answer as unknown) |
| nearby_couriers | USER | query lat, lng (BAD_POINT) | couriers[{vehicle, lat, lng}] online, approved, fresh position, within 8 km, not blocked, not the caller's own account; positions rounded to 3 decimals (~100 m), at most 30 |
| emergency | ACCOUNT (active profile) | order_id?, location? | ok (a staff case at the top, with the position; 5 per hour) |
| my_record | ACCOUNT (active profile; works while blocked) | - | points_90d, levels, rule_points, active_block {kind, until, reason}, violations[] {id, rule, points, order_ref, note, status, appeal_text, decision_note, can_appeal, counts}, sanctions[] |
| appeal_violation | ACCOUNT (works while blocked) | id, text (10-1000) | status appealed (once per rule break, within 30 days; CANNOT_APPEAL) |

Login methods: Google login is on when the server has the app's Google client ids; SMS login stays in the code but is OFF until an SMS provider is chosen (LOGIN_SMS=1). One Google account = one account; one verified phone number = one account (they are separate accounts). A Google account must call set_phone before add_profile (PHONE_REQUIRED): drivers and senders need to call each other. An unverified number is a contact number only: not unique, never used to find a person.

verify_code / login_google rule (ONE PROFILE AT FIRST): the account is created or found by phone (or by Google account). (1) Number with NO profile yet: `needs_profile` = the chosen path, and the app shows the profile-creation screen that calls add_profile; until then the token can call only get_me, add_profile, switch_profile, logout. (2) Number that already has the chosen profile: it opens. (3) Number that already has a profile but NOT the chosen one: nothing is created. The person lands in the profile they have, with `notice` = {code: NO_PROFILE_FOR_PATH, missing: path}, and the app tells them they can add the other profile from Settings. Never a "wrong role" error.

add_profile rule: the FIRST profile is created right after login (path choice). The SECOND profile is created only from Settings, while logged in to the first one; a session with no profile cannot create a second (error USE_SETTINGS).

## B. User path (active profile = user)
| Screen | Function | Request | Answer |
|---|---|---|---|
| Home, destination | search_places | q (2-80 characters), lang?, lat?, lng? (to rank nearby places first) | places[] {name, detail, lat, lng} inside the Algiers area; unavailable true (empty list) if the search service fails; SEARCH_OFF 503 when switched off (GEOCODER_URL empty); 30 per minute |
| Home, destination | reverse_place | lat, lng, lang? | place {name, detail, lat, lng} or null: the name under the map pin (positions rounded to about 10 m for the cache); 60 per minute |
| New order | get_quote | pickup {lat,lng}, dropoff {lat,lng}, size | recommended_da, min_da, max_da, vehicle, distance_m, duration_s, distance_estimated (true = road distance unavailable, straight-line estimate used; the app shows "about"), route ([lng,lat] points of the road for the map, or null: then the app draws a dashed straight line), quote_id (valid 5 min); error ZONE_CLOSED if either point is outside an open zone Errors: ZONE_CLOSED (a point outside every open zone), TOO_FAR (trip longer than the active price table's max_km, default 50 km; the limit is in the message), PRICING_NOT_SET |
| Price | create_order | quote_id, offered_da, pickup_address{...}, dropoff_address{...}, recipient_name, recipient_phone, payer, cod_amount_da, inspection (`outside` default \| `open` = the receiver may open the parcel before paying), auto_accept (bool, default false: the first courier who accepts the customer's price gets the job) | order, status `searching`: couriers are searched at once |
| Searching | set_auto_accept | order id, on (bool) | order (only while `searching`: WRONG_STATE) |
| Searching | accept_bid | order id, offer_id | order `assigned`, locked at the courier's price. OFFER_GONE (expired, withdrawn or of another order), ORDER_TAKEN, DRIVER_BUSY |
| Searching | decline_bid | order id, offer_id | order (the courier is told and is not shown this request again) |
| Tracking | get_order | order id | order + driver summary (name, photo, rating, vehicle, vehicle_color and plate_number while assigned/picked up, deliveries, position while active) + bids[] (while searching: offer_id, price_da, eta_s, expires_at, driver {name, rating, rating_count, vehicle, deliveries}; cheapest first) + couriers_notified + search_ends_at + auto_accept + eta_s (time until the parcel arrives, while assigned or picked up) + route + delivery_code + pickup_code (the sender shows it, or its QR `PCK1:<ref>:<code>`, to the driver at pickup) + tracking_token (receiver link `<server>/t/<token>`) + inspection, recipient_expecting_at, pickup_photo_doc, pickup/delivery_distance_m, evidence_photos[], history[] {type, at, data} |
| Tracking | get_order_photo | order_id, id (a photo of THIS order: parcel at pickup or evidence) | JPEG |
| Tracking | recall_order | order id, reason (`buyer_cancelled`\|`wrong_parcel`\|`wrong_address`\|`other`) | order (only after pickup: it fails and a return leg goes to the driver; before pickup use cancel_order, CANNOT_RECALL) |
| Details | recipient_history | phone | delivered, refused, no_answer (counts of parcels to that number, all senders, 180 days; 30 checks per hour) |
| Tracking | cancel_order | order id, reason | order (only while `searching` or `assigned`; after a driver accepted, a cancel later than 3 min is recorded as late) |
| Searching | raise_price (negotiation, upward only) | order id, new_offered_da | order (only while `searching`, only upward, inside max_da) |
| My orders | list_orders | page | orders[] (own only) |
| Rate | submit_rating | order id, stars 1-5, comment? | ok (delivered orders only, once) |
| Problem | report_problem | order id, reason (`driver_late`\|`damaged`\|`not_delivered`\|`wrong_item`\|`missing_item`\|`driver_behaviour`\|`price`\|`other`), note?, photos? (up to 3 document ids, kind `evidence_photo`) | report (until 24 h after the order ended: REPORT_TOO_LATE; 5 per order) |
Live updates: see section G (one WebSocket per logged-in profile). Driver location while a job is active is read with get_order (polled every few seconds) until live location sharing is added.

## B2. Receiver (no account: the secret link is the key)
| Page | Function | Request | Answer |
|---|---|---|---|
| `/t/<token>` | (the page) | - | one static page (ar/fr/en); strict content policy; map tiles from OpenFreeMap |
| Tracking | track_data | t (token) | ref, status, sender first name, inspection, amount_to_pay_da (goods + fee if the receiver pays), dropoff, driver {first name, vehicle, vehicle_color, plate_number, rating, phone once picked up, position} while active, eta_s, delivery_code until delivered, has_parcel_photo, expecting, history. BAD_LINK 400; LINK_ENDED 404 (unknown, or 24 h after the order ended: same answer) |
| Tracking | track_qr / track_photo | t | SVG QR of `DLV1:<ref>:<code>` / JPEG of the parcel at pickup |
| Tracking | track_expecting | t | expecting true (optional, once: the receiver says he expects the parcel; the sender and driver are told). There is no yes/no step: couriers are searched as soon as the order is created (owner's decision, Oct 2026) |
| Tracking | track_report | t, reason (`not_arrived`\|`damaged`\|`wrong_item`\|`driver_behaviour`\|`other`), note? | report (max 3 per order, 10 per hour per address) |

## C. Driver path (active profile = driver, status active)
| Screen | Function | Request | Answer |
|---|---|---|---|
| Home | set_online | online true/false | state (refused if profile is not `active`) |
| Home | update_location | lat, lng | ok (only while online) |
| Home | get_driver_home | - | earnings_today_da, cash_held_da, cash_limit_da, rating |
| Requests | list_requests | - | requests[] (nearest first): offer_id, status (`offered`\|`bid` = my price waits for the customer), price_da (the customer's), max_da, my_price_da, bid_expires_at, size, vehicle, payer, cod_amount_da, trip distance and duration, pickup_distance_m, pickup_address, pickup and dropoff points, sender rating. Never the receiver or the codes |
| Requests | make_bid | offer_id, price_da? (omitted = the customer's price; between the customer's price and max_da) | job (when the customer switched on auto-accept and the courier accepted his price: the job is his at once) or bid {offer_id, price_da, eta_s, expires_in_s}. One pending offer per courier (BID_PENDING); PRICE_NOT_ALLOWED; NOT_ELIGIBLE (offline, busy, over the cash limit); OFFER_GONE |
| Requests | decline_offer | offer id | ok ("not for me": the request leaves his list for good) |
| Offer | get_current_offer / accept_offer (older apps) | offer id | the newest open request / make_bid at the customer's price |
| Active job | get_job | - | the current job incl. pickup/dropoff, cash to collect, inspection, recipient_expecting_at, needs_pickup_code (never the pickup or delivery code) |
| Active job | update_job_step | order id, step (`picked_up`\|`delivered`), location {lat,lng} (always: where the phone is), pickup_code + parcel_photo (document id, kind `parcel_photo`) for picked_up, delivery_code (typed or read from the receiver's QR `DLV1:<ref>:<code>`) + method (`code`\|`qr`) + cash_collected_da (if cash order) for delivered | job. PICKUP_CODE_WRONG / PICKUP_LOCKED (5 wrong), PHOTO_REQUIRED, BAD_DOCUMENT, CODE_WRONG / CODE_LOCKED. Confirmed more than 300 m from the point: allowed, but a staff case opens |
| Can't deliver | report_delivery_failure | order id, reason (`no_answer`\|`wrong_address`\|`refused_damaged`\|`refused_wrong_item`\|`refused_not_ordered`\|`refused_changed_mind`\|`refused_cannot_pay`), evidence_photo (kind `evidence_photo`; required for damaged and wrong item), note?, location? | job (original -> `failed`, a `return` leg is created; staff get a case) |
| Home | submit_selfie | document_id (kind `selfie_photo`) | ok. Going online without a selfie from the last 7 days: SELFIE_REQUIRED (428) |
| Active job | release_job | order id, reason (`vehicle_problem`\|`emergency`\|`sender_unreachable`\|`parcel_not_ready`\|`parcel_too_big`\|`unsafe_or_prohibited` (+ evidence_photo)\|`other`), note? | job null (only before pickup; the order searches again at the same price, never offered to him again) |
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
| list_pending_drivers | - | drivers waiting, with phone, vehicle, first_name, last_name, birth_date, vehicle_color, plate_number, national_id_last3, and documents {id_photo, licence_photo, ownership_photo, vehicle_photo, vehicle_photos[], selfie} (ids) |
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
| list_violations | status?, profile_id?, page | rule breaks (appealed first) with appeal text and decisions |
| add_violation | profile_id, rule (`far_confirmation`\|`wrong_item`\|`damaged_by_driver`\|`behaviour`\|`prohibited_goods`\|`other`), points (only behaviour/other: 1-12; the others are fixed), order_id?, note | id, points_90d (levels apply automatically) |
| decide_violation | id, decision (`uphold` only after an appeal \| `cancel`), note (shown to the person) | sanctions_lifted (cancelling removes the points and lifts automatic sanctions no longer deserved) |
| list_sanctions | active?, page | warnings, blocks, bans |
| block_profile / lift_sanction | profile_id, hours (1-2160 or null = until staff decide), reason / id, note | the block stops NEW work only; a job in progress can finish |
| ban_account | profile_id, reason (10+) | sessions_ended. A person's decision: all profiles stop, every session ends, the Google account, devices, driver ID number and verified phone cannot open a new account |
| get_profile_record | profile_id | profile, points_90d, active_block, devices, linked_profiles (other accounts that used the same phone), violations, sanctions |
| create_zone / list_zones / set_zone_open | name + GeoJSON polygon / - / zone_id, open | zones start CLOSED; opening is a separate step |
| get_pricing / create_pricing_version | - / base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, max_km (longest trip allowed, 1-1000 km, default 50: BAD_MAX_KM) | a new version replaces the active one; existing orders keep theirs |

Not built (decided): two-person approval for large cash adjustments (needs a team to exist), a staff audit viewer (the audit trail is stored; reading it is done by the owner with the database for now).

## E. Order status rules (the only allowed moves)
(created) -> searching (couriers are searched at once)
searching -> assigned (the customer chooses a courier's offer, or auto-accept; price locks at that offer) | cancelled | expired (only if a search window is configured; by default a request never ends by itself)
assigned -> picked_up | cancelled | searching (staff reassign)
picked_up -> delivered (correct delivery_code) | failed (driver reports failure)
failed -> a new `return` order is created for the same driver, pointing back to the sender's pickup address.
delivered, cancelled, expired, failed are final.
Cash: delivered with a cash amount writes one `cod_collected` ledger entry for that driver. Handovers are recorded only by staff.

## F. Built and tested rules (order system v1)
- Parcel size decides the vehicle: small and medium -> motorbike, large -> car.
- Recommended price = base + per-km x km (rounded up) + size and car extras, rounded UP to 10 DA. The allowed range is min% to max% of it (staff set the numbers in the price table).
- A quote is valid 5 minutes, usable once, only by its owner. The zone check runs at quote AND at order creation.
- Matching (inDrive style, owner's wish Oct 2026): a searching order is shown to up to BROADCAST_MAX (10) eligible couriers at once, nearest first. Eligible = online, active, right vehicle, location fresher than the limit, inside the search radius, no active job, not blocked, cash limit not exceeded, and NOT the same account as the sender. The radius widens after a delay. Each courier accepts the customer's price or proposes a higher one (never above max_da); his offer waits BID_TTL_S (40 s) for the customer's choice; one pending offer per courier (database rule). The customer chooses (or auto-accept gives the job to the first courier who accepts his price). The price locks at the chosen offer, inside the allowed range (database rule). The order expires if nobody is chosen in the search window.
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
| offer.new | driver | a request is shown to them (high priority, has expires_at) | offer_id, ref, price_da | yes |
| offer.updated | driver | the customer raised the price | offer_id, price_da | no |
| offer.withdrawn | driver | the request ended: taken by another courier, cancelled, expired | offer_id, reason | no |
| bid.accepted | driver | the customer chose his offer (high priority): the job is his | offer_id, ref, price_da | yes |
| bid.declined / bid.expired | driver | the customer said no / did not answer in time (he may answer again after expiry) | offer_id | no |
| order.bid / order.bid_withdrawn | user | a courier made an offer (high priority) / an offer ended | offer_id, ref, price_da | yes / no |
| job.cancelled | driver | the user cancelled after the driver accepted (high priority) | ref | yes |
| order.incoming | recipient (only if registered with that VERIFIED number) | an order for their phone number was created: the app shows it with the code | ref, delivery_code, sender (first name) | yes |
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
| order.expired | user | no courier found in time (the app suggests raising the price) | ref | yes |

### G3. Phone push (app closed): `register_device`
`register_device {token, platform: android|ios, language: ar|fr|en}` (needs an active profile). The app calls it after login, after every profile switch, and whenever the push token changes. The token always belongs to the ACTIVE profile of that session: switching profile moves it, logging out deletes it. Push text is built on the server in the device's language (Arabic, French or English; wording to be reviewed by native speakers). When the person changes the app language in Settings, the app calls register_device again with the same token and the new language. A push carries data {id, kind, order_id, ...}; the app uses `id` to avoid showing again what the live connection already showed. Failed pushes retry with growing delays (up to 5 attempts); invalid tokens are deleted.
Android uses Firebase directly and iPhone through Apple's push service via Firebase (needs the Firebase key; not yet tested against real Firebase).

### G4. No SMS (except login verification)
SMS is used ONLY to verify a phone number at login (send_code). Nothing else is ever sent by SMS. Email is not used at launch (an email channel could later be added to the notification delivery worker, like push).
How the recipient gets the delivery code:
1. The sender always sees the 4-digit code in the app (get_order) and gives it to the recipient.
2. If the recipient's phone number is the VERIFIED number of a registered user (SMS login; a number typed by a Google account does not count), that user also receives `order.incoming` (live and as a push) containing the code. A sender who names their own number is not notified.
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
