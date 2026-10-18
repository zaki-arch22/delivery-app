import { Client, Profile } from './api';

export type Path = 'user' | 'driver';
export interface SessionState { profiles: Profile[]; active: Profile | null; needsProfile: Path | null; notice: { code: string; missing: Path } | null }

// Login and profiles, exactly as the server's contract defines them.
export class Session {
  state: SessionState = { profiles: [], active: null, needsProfile: null, notice: null };
  private subs = new Set<(s: SessionState) => void>();
  constructor(readonly client: Client) { client.onSignedOut(() => this.set({ profiles: [], active: null, needsProfile: null, notice: null })); }
  subscribe(f: (s: SessionState) => void) { this.subs.add(f); return () => this.subs.delete(f); }
  private set(s: Partial<SessionState>) { this.state = { ...this.state, ...s }; this.subs.forEach(f => f(this.state)); }

  sendCode(phone: string) { return this.client.publicCall('/send_code', { phone }); }

  async verifyCode(phone: string, code: string, path: Path) {
    const r = await this.client.publicCall('/verify_code', { phone, code, path });
    await this.client.setSession(r.token, r.refresh_token);
    this.set({ profiles: r.profiles, active: r.active_profile, needsProfile: r.needs_profile, notice: r.notice });
    return this.state;
  }

  // App start: if a login is stored in the vault, resume it without asking for a new SMS code.
  async restore(): Promise<boolean> {
    if (!(await this.client.hasStoredSession())) return false;
    if (!(await this.client.refresh())) return false;
    const me = await this.client.call('/get_me');
    this.set({ profiles: me.profiles, active: me.active_profile, needsProfile: me.profiles.length ? null : this.state.needsProfile, notice: null });
    return true;
  }

  // The FIRST profile right after login, or the SECOND one from Settings.
  async addProfile(type: Path, displayName: string, documents?: Record<string, string>) {
    const r = await this.client.call('/add_profile', { type, display_name: displayName, documents });
    await this.client.setSession(r.token);
    this.set({ profiles: r.profiles, active: r.active_profile, needsProfile: null, notice: null });
    return this.state;
  }

  async switchProfile(type: Path) {
    const r = await this.client.call('/switch_profile', { type });
    await this.client.setSession(r.token);
    this.set({ active: r.active_profile });
    return this.state;
  }

  async logout() { await this.client.call('/logout', {}).catch(() => {}); await this.client.clearSession(); }
  async logoutEverywhere() { const r = await this.client.call('/logout_everywhere', {}); await this.client.clearSession(); return r.sessions_ended as number; }
}
