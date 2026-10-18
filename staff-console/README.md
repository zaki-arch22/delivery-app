# Staff console (React + Vite)

The internal web tool for staff: orders, problems, drivers, cash, ratings, zones, prices. Arabic (right-to-left), French, English. Brand A.
Every one of the 22 staff functions of the backend has its place here, and the console calls nothing else (`npm run check-contract` proves it).

## Security built in
- Login needs email, password AND the 6-digit authenticator code. The login token lives only in memory: closing the tab erases it.
- Automatic logout after 15 minutes without activity; "Log out" ends the login on the server too.
- Strict content policy: only the console's own files run, nothing inline, no third-party scripts, fonts or images (the Cairo font is bundled). The only outside address it may talk to is the API.
- Everything typed by customers and drivers (names, addresses, comments, document links) is shown as plain text, never run. Tested with a malicious name.
- Each action button is enabled only in the states where the server accepts it; the server checks again anyway.

## Build and host (free)
1. npm install
2. VITE_API_URL=https://api.yourdomain.dz npm run build   (type-checks, then writes static files to dist/)
3. Serve dist/ with Caddy using the "staff" block in ../backend/deploy/Caddyfile, and add the console address to STAFF_ORIGINS in the API env file.

## Tests
From the project root: `bash scripts/test-all.sh` (contract match, type check and build, 13 screen tests against the real backend).
