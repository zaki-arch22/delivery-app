import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { people, PublicProfile } from '../lib/people';
import { color, font, space } from '../lib/theme';
import { Card, Notice, Screen, T } from '../ui/kit';

const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

// The other side's profile (owner's wish, Oct 2026): the customer opens the courier from his offer or from the courier
// card; the courier opens the sender from a request or from his job. Name, vehicle, star average, how many deliveries
// (or parcels sent), member since, and the latest comments (shown without who wrote them).
export default function PublicProfileScreen() {
  const { t, lang, services } = useApp();
  const prm = useLocalSearchParams<{ offer_id?: string; order_id?: string }>();
  const [p, setP] = useState<PublicProfile | null>(null), [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    people(services.client).profile(prm.offer_id ? { offer_id: prm.offer_id } : { order_id: prm.order_id }).then(setP)
      .catch(e => { const m = errorMessage(e); setErr(t(m.key, m.vars)); });
  }, [prm.offer_id, prm.order_id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const date = (iso: string, opts: Intl.DateTimeFormatOptions) => { try { return new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-DZ' : 'en-GB', opts); } catch { return iso.slice(0, 10); } };
  return (
    <Screen testID="screen-public-profile" title={p ? p.name : t('profile_title_other')}>
      {err ? <Notice warn text={err} /> : null}
      {p ? (<>
        <View style={s.head}>
          <View style={s.avatar}><T style={s.avatarText}>{p.name.charAt(0).toUpperCase()}</T></View>
          <T kind="title" testID="pp-name">{p.name}</T>
          <T kind="muted">{p.type === 'driver' ? t(p.vehicle === 'car' ? 'courier_by_car' : 'courier_by_motorbike') : t('sender_label')}</T>
        </View>
        <View style={s.stats}>
          <Card style={s.stat}><T style={s.big} testID="pp-rating">{p.rating ? `★ ${p.rating}` : '—'}</T><T kind="muted">{t('ratings_n', { n: p.rating_count })}</T></Card>
          <Card style={s.stat}><T style={s.big} testID="pp-completed">{p.completed}</T><T kind="muted">{t(p.type === 'driver' ? 'pp_deliveries' : 'pp_sent')}</T></Card>
        </View>
        <T kind="muted" testID="pp-since">{t('member_since', { d: date(p.member_since, { month: 'long', year: 'numeric' }) })}</T>
        <T kind="label" style={{ marginTop: space(4) }}>{t('pp_comments')}</T>
        {p.comments.length === 0 ? <T kind="muted" testID="pp-no-comments">{t('pp_no_comments')}</T> : p.comments.map((c, i) => (
          <Card key={i} testID={'pp-comment-' + i}>
            <T style={{ color: color.lime }}>{stars(c.stars)}</T>
            <T>{c.comment}</T>
            <T kind="muted" style={{ fontSize: 13 }}>{date(c.at, { day: 'numeric', month: 'short', year: 'numeric' })}</T>
          </Card>
        ))}
      </>) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { alignItems: 'center', gap: space(1), marginVertical: space(3) },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: color.card2, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: color.lime },
  avatarText: { fontFamily: font.bold, fontSize: 36, lineHeight: 50 },
  stats: { flexDirection: 'row', gap: space(3) },
  stat: { flex: 1, alignItems: 'center' },
  big: { fontFamily: font.bold, fontSize: 24, lineHeight: 34 },
});
