import type { SessionState } from '../core/session';
// Where a person belongs after login or app start.
export function destination(state: SessionState): '/welcome' | '/new-profile' | '/home' {
  if (state.active) return '/home';
  if (state.needsProfile) return '/new-profile';
  return '/welcome';
}
