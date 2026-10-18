Paste everything below the line into Claude Code, opened in this folder.

---

You are continuing a project that was started in a claude.ai chat. You cannot see that chat, so everything you need is in this folder.

1. Read `CLAUDE.md` completely. It is the single source of truth: who I am, how I want to work, every decision with its reason, what is built, what is parked, and what comes next. Then read `backend/docs/API_CONTRACT_v1.md` and `backend/docs/SECURITY.md`, and skim the README in `backend/`, `staff-console/` and `mobile/`.
2. Do not change any code yet.
3. Check that nothing was lost in the move: see whether this computer has Node.js 22 and PostgreSQL 16 with PostGIS. If something is missing, tell me in simple words what to install and why, and wait for me. When they are ready, run `bash scripts/dev-setup.sh` and then `bash scripts/test-all.sh`, and tell me the result (the last run before the move: every suite passed, 288 tests plus 10 database-rule checks).
4. Then, BEFORE you start any work, tell me:
   - what you understood about the project, in a few lines;
   - what we should do next and in what order (start from section 9 of CLAUDE.md; tell me if you see a better order and why);
   - how we will work together, following section 2 of CLAUDE.md.
   Then ask me, with a multiple-choice question, whether to start.
5. From then on, keep `CLAUDE.md` up to date: when a decision changes, replace the old line; never keep old versions.
