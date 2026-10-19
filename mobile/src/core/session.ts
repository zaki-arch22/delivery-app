import { Client, Profile } from './api';

export type Path = 'user' | 'driver';
export interface SessionState {
  profiles: Profile[]; active: Profile | null; needsProfile: Path | null; notice: { code: string; missing: Path } | null;
  needsPhone: boolean;          // a Google account without a contact number yet (set_phone)
  googleName: string | null;    // the name Google gave, to prefill the profile name
}
const EMPTY: SessionState = { profiles: [], active: null, needsProfile: null, notice: null, needsPhone: false, googleName: null };

// Login and profiles, exactly as the server's contract defines them.
export class Session {
  state: SessionState = EMPTY;
  private subs = new Set<(s: SessionState) => void>();
  constructor(readonly client: Client) { client.onSignedOut(() => this.set(EMPTY)); }
  subscribe(f: (s: SessionState) => void) { this.subs.add(f); return () => this.subs.delete(f); }
  private set(s: Partial<SessionState>) { this.state = { ...this.state, ...s }; this.subs.forEach(f => f(this.state)); }

  // Which login buttons to show (Google, SMS): the server decides, so a method can be switched on without a new app.
  loginMethods(): Promise<{ google: boolean; sms: boolean }> { return this.client.publicCall('/login_methods'); }

  async loginGoogle(idToken: string, path: Path) {
    const r = await this.client.publicCall('/login_google', { id_token: idToken, path });
    await this.client.setSession(r.token, r.refresh_token);
    this.set({ profiles: r.profiles, active: r.active_profile, needsProfile: r.needs_profile, notice: r.notice, needsPhone: !!r.needs_phone, googleName: r.google_name ?? null });
    return this.state;
  }

  // The contact number of a Google account (typed, not verified by SMS).
  async setPhone(phone: string) {
    await this.client.call('/set_phone', { phone });
    this.set({ needsPhone: false });
    return this.state;
  }

  sendCode(phone: string) { return this.client.publicCall('/send_code', { phone }); }

  async verifyCode(phone: string, code: string, path: Path) {
    const r = await this.client.publicCall('/verify_code', { phone, code, path });
    await this.client.setSession(r.token, r.refresh_token);
    this.set({ profiles: r.profiles, active: r.active_profile, needsProfile: r.needs_profile, notice: r.notice, needsPhone: !!r.needs_phone, googleName: null });
    return this.state;
  }

  // App start: if a login is stored in the vault, resume it without asking for a new SMS code.
  async restore(): Promise<boolean> {
    if (!(await this.client.hasStoredSession())) return false;
    if (!(await this.client.refresh())) return false;
    const me = await this.client.call('/get_me');
    this.set({ profiles: me.profiles, active: me.active_profile, needsProfile: me.profiles.length ? null : this.state.needsProfile, notice: null, needsPhone: !me.account?.phone });
    return true;
  }

  // The FIRST profile right after login, or the SECOND one from Settings.
  // acceptRules: the person ticked "I accept the platform rules". nationalId: drivers only (one person = one driver profile).
  async addProfile(type: Path, displayName: string, acceptRules: boolean, documents?: Record<string, string>, nationalId?: string) {
    const r = await this.client.call('/add_profile', { type, display_name: displayName, documents, accept_rules: acceptRules, national_id: nationalId });
    await this.client.setSession(r.token);
    this.set({ profiles: r.profiles, active: r.active_profile, needsProfile: null, notice: null });
    return this.state;
  }

  // Driver sign-up photos: each one is uploaded first; add_profile then receives the three ids.
  async uploadDocument(kind: 'id_photo' | 'licence_photo' | 'vehicle_photo', photo: Blob): Promise<string> {
    const r = await this.client.call('/upload_document?kind=' + kind, photo);
    return r.document_id;
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
