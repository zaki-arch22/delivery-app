// Tunable values with starting defaults. They must be tuned with real data; none is a fact about Algiers.
const n = (k: string, d: number) => Number(process.env[k] ?? d);
export const cfg = {
  tickMs: () => n('TICK_MS', 2000),   // also how closely the server follows the growing search circle
  bidTtlS: () => n('BID_TTL_S', 40),              // how long a courier's price offer waits for the customer's answer
  broadcastMax: () => n('BROADCAST_MAX', 10),     // a request is shown to at most this many nearby couriers at once
  searchWindowS: () => n('SEARCH_WINDOW_S', 600), // how long an order searches before it expires
  // The search area grows smoothly: 1 km at the start, +1 km every 8 s, up to 8 km (reached after 56 s). Nearest couriers
  // get the request first (shortest pickup), farther ones join within a minute. (The app's pulse is only a picture of
  // "searching", deliberately not tied to these numbers: owner's wish, like inDrive.)
  searchStartM: () => n('SEARCH_START_M', 1000),
  searchStepM: () => n('SEARCH_STEP_M', 1000),
  searchStepS: () => n('SEARCH_STEP_S', 8),
  searchMaxM: () => n('SEARCH_MAX_M', 8000),
  locationFreshS: () => n('LOCATION_FRESH_S', 120), // driver location older than this is ignored
  routeFactor: () => n('ROUTE_FACTOR', 1.3),      // fallback only: straight line -> road distance
  fallbackKmh: () => n('FALLBACK_KMH', 20),       // fallback only: city speed
  routingUrl: () => process.env.ROUTING_URL ?? '', // our own OSRM server (road distances); empty = estimate only
  routingTimeoutMs: () => n('ROUTING_TIMEOUT_MS', 1500), // slower than this -> estimate, so quotes never hang
  proofRadiusM: () => n('PROOF_RADIUS_M', 300),   // pickup/delivery confirmed farther than this from the point = a case for staff
  lateCancelS: () => n('LATE_CANCEL_S', 180),     // a sender cancel later than this after a driver accepted counts as "late"
  trackingHours: () => n('TRACKING_HOURS', 24),   // the receiver's tracking link works until this long after the order ends
  watchMs: () => n('WATCH_MS', 60_000),           // how often the safety nets look for silent drivers and late parcels
  silentMin: () => n('SILENT_MIN', 20),           // a driver carrying a parcel without a position for this long = a case
  overdueMin: () => n('OVERDUE_MIN', 180),        // a parcel not delivered this long after pickup = a case
  pickupLateMin: () => n('PICKUP_LATE_MIN', 60),  // accepted but not picked up after this long = a case
  reportHours: () => n('REPORT_HOURS', 24),       // a problem can be reported until this long after the order ends
  geocoderUrl: () => process.env.GEOCODER_URL ?? '',  // place search (Photon-compatible API); empty = search off
  geocoderTimeoutMs: () => n('GEOCODER_TIMEOUT_MS', 2500),
  selfieDays: () => n('SELFIE_DAYS', 7),          // a driver takes a new selfie before going online at least this often (0 = off)
};
export const cfgN = {
  pushTickMs: () => n('PUSH_TICK_MS', 1000),
  retryBaseS: () => n('RETRY_BASE_S', 2),   // retry delay doubles each attempt
  maxAttempts: () => n('MAX_ATTEMPTS', 5),
};

// Radius of the search area `ageS` seconds after the search started.
export const searchRadiusM = (ageS: number) => Math.min(cfg.searchMaxM(), cfg.searchStartM() + (cfg.searchStepM() * Math.max(0, ageS)) / cfg.searchStepS());
