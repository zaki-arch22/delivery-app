import type { SessionState } from '../core/session';
// Where a person belongs after login or app start.
export function destination(state: SessionState): '/welcome' | '/contact-phone' | '/new-profile' | '/home' {
  if (state.active) return '/home';
  if (state.needsProfile && state.needsPhone) return '/contact-phone';
  if (state.needsProfile) return '/new-profile';
  return '/welcome';
}
