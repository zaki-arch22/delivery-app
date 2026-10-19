// Tunable values with starting defaults. They must be tuned with real data; none is a fact about Algiers.
const n = (k: string, d: number) => Number(process.env[k] ?? d);
export const cfg = {
  tickMs: () => n('TICK_MS', 3000),
  offerTtlS: () => n('OFFER_TTL_S', 20),          // how long one driver has to answer an offer
  searchWindowS: () => n('SEARCH_WINDOW_S', 600), // how long an order searches before it expires
  radius1: () => n('RADIUS_1_M', 3000),           // first search radius
  radius2: () => n('RADIUS_2_M', 8000),           // widened radius
  widenAfterS: () => n('WIDEN_AFTER_S', 60),
  locationFreshS: () => n('LOCATION_FRESH_S', 120), // driver location older than this is ignored
  routeFactor: () => n('ROUTE_FACTOR', 1.3),      // fallback only: straight line -> road distance
  fallbackKmh: () => n('FALLBACK_KMH', 20),       // fallback only: city speed
  routingUrl: () => process.env.ROUTING_URL ?? '', // our own OSRM server (road distances); empty = estimate only
  routingTimeoutMs: () => n('ROUTING_TIMEOUT_MS', 1500), // slower than this -> estimate, so quotes never hang
  proofRadiusM: () => n('PROOF_RADIUS_M', 300),   // pickup/delivery confirmed farther than this from the point = a case for staff
  lateCancelS: () => n('LATE_CANCEL_S', 180),     // a sender cancel later than this after a driver accepted counts as "late"
  trackingHours: () => n('TRACKING_HOURS', 24),   // the receiver's tracking link works until this long after the order ends
};
export const cfgN = {
  pushTickMs: () => n('PUSH_TICK_MS', 1000),
  retryBaseS: () => n('RETRY_BASE_S', 2),   // retry delay doubles each attempt
  maxAttempts: () => n('MAX_ATTEMPTS', 5),
};
