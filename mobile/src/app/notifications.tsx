import React, { useCallback, useState } from 'react';
import { routeFor } from '../lib/push';
import { router, useFocusEffect } from 'expo-router';
import { useApp } from '../lib/app';
import { account, AppNotice } from '../lib/account';
import { when } from '../lib/orders';
import { Button, Notice, Row, Screen } from '../ui/kit';
import type { IconName } from '../ui/Icon';
import type { Key } from '../i18n';

// Notifications list of the current mode (list_notifications), newest first, 30 at a time. Tapping one opens its order.
export default function Notifications() {
  const { t, lang, services, state } = useApp();
  const api = account(services.client);
  const [list, setList] = useState<AppNotice[] | null>(null), [more, setMore] = useState(false), [busy, setBusy] = useState(false);
  const load = useCallback(async (before?: number) => {
    setBusy(true);
    try { const r = await api.notifications(before); setList(prev => (before ? [...(prev ?? []), ...r.notifications] : r.notifications)); setMore(r.notifications.length === 30); }
    catch { setList(prev => prev ?? []); } finally { setBusy(false); }
  }, [services]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));
  // The same destination as tapping the phone notification (money, wallet, record, order or job), else nothing.
  const open = (n: AppNotice) => {
    const r = routeFor({ kind: n.type, order_id: n.order_id ?? '' });
    if (r && r.pathname !== '/home') { router.push(r as any); return; }
    if (!n.order_id) return;
    if (state.active?.type === 'user') router.push({ pathname: '/order/[id]', params: { id: n.order_id } });
  };
  return (
    <Screen testID="screen-notifications" title={t('menu_notifications')}>
      {list && !list.length ? <Notice testID="notifications-empty" text={t('notifications_none')} /> : null}
      {(list ?? []).map(n => (
        <Row key={n.id} testID={'notice-' + n.id} icon={iconOf(n.type)} label={noticeText(n, t)} value={when(n.created_at, lang) + (n.data.ref ? ' · ' + n.data.ref : '')}
          onPress={n.order_id ? () => open(n) : undefined} />
      ))}
      {more ? <Button testID="load-more" kind="secondary" busy={busy} label={t('load_more')} onPress={() => load(list![list!.length - 1].id)} /> : null}
    </Screen>
  );
}
const iconOf = (k: string): IconName => k.startsWith('trust.') || k.startsWith('security.') ? 'shield' : k.startsWith('cash.') ? 'dollar-sign' : k.startsWith('profile.') ? 'user' : k.startsWith('offer.') || k.startsWith('bid.') ? 'zap' : 'package';
// Each kind has its own sentence; an unknown kind (from a newer server) gets a generic one.
function noticeText(n: AppNotice, t: (k: Key, v?: Record<string, string | number>) => string) {
  const key = ('n_' + n.type.replace('.', '_')) as Key;
  const s = t(key, { ...n.data });
  return s === key ? t('n_generic') : s;
}
