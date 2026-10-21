import type { Client } from '../core/api';

// Account-level functions shared by both modes: what the server switches on, the notifications list, the profile name.
export interface AppNotice { id: number; type: string; order_id: string | null; data: Record<string, any>; created_at: string }
export const account = (c: Client) => ({
  config: () => c.publicCall<{ place_search: boolean }>('/app_config'),
  notifications: (before?: number) => c.call<{ notifications: AppNotice[] }>('/list_notifications' + (before ? '?before=' + before : '')),
  rename: (name: string) => c.call<{ ok: true; display_name: string }>('/rename_profile', { display_name: name }),
  setPhone: (phone: string) => c.call<{ ok: true; phone: string }>('/set_phone', { phone }),
  me: () => c.call<any>('/get_me'),
});
