// Orders rated during this app session, so a screen can hide its "rate" button at once (the server stays the truth).
export const ratedNow = new Set<string>();
