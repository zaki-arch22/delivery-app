# PROGRESS.md: where the work stands (read this first when resuming)

Rules: CLAUDE.md is the source of truth for decisions; this file tracks work only. Update it after every finished piece, commit, push.
Branch: `claude/optimistic-cannon-iw9rm9` (repo zaki-arch22/delivery-app). Resume: `git pull`, the SessionStart hook prepares the machine (or run `bash .claude/hooks/session-start.sh` with CLAUDE_CODE_REMOTE=true), then `bash scripts/test-all.sh` must be green before new work.

## Done
- Project imported from the claude.ai chat; all suites green (288 tests + 10 database rules).
- New working rules in CLAUDE.md section 2; START_PROMPT.md removed.
- Cloud setup: SessionStart hook (`.claude/hooks/session-start.sh`) installs PostGIS, starts PostgreSQL, installs packages, builds the test database. A recurring scheduled task re-wakes this session to continue (see CLAUDE.md section 5).

- Milestone "free map": decision recorded (CLAUDE.md section 5). Server: road distances from our own OSRM (`ROUTING_URL`), safe fallback to the estimate, `distance_estimated` in get_quote; 12 new tests (OSRM up / down / not answering) on a made-up grid; `deploy/osrm.md`. 300 tests green.

## In progress
- (none)

## Next, in order (matches CLAUDE.md section 9)
1. Mobile app shell + first screens (navigation, i18n ar/fr/en with RTL, theme, path choice, phone login, first profile).
2. Photo upload server function + driver sign-up screen.
3. User path, driver path, settings.

## Exact next action
Read mobile/AGENTS.md and mobile/src/core, then build the app shell (navigation, i18n, theme) and the first screen.

## Pending questions / owner actions (ask together at the end of a milestone)
- Optional, free: allow `download.geofabrik.de` and `tiles.openfreemap.org` in this cloud environment's network settings so maps and road data can be tested with real Algiers data.
