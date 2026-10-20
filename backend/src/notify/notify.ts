export type Q = (sql: string, p?: any[]) => Promise<any[]>;
export interface N {
  profile: string;                // the ONE profile that receives it
  kind: string;                   // e.g. 'offer.new'  (the app translates kinds; push text is built here)
  order?: string;
  data?: Record<string, any>;
  priority?: 'high' | 'normal';
  push?: boolean;                 // also send a push notification when the app is closed
  dedupe: string;                 // same key twice = one notification
  expiresInS?: number;
}

// ALWAYS call this with the query function of the SAME transaction that changes the order.
// Then the notification exists if and only if the change was committed.
export async function notify(q: Q, n: N) {
  const push = n.push ?? true;
  await q(
    `INSERT INTO notifications(profile_id, type, order_id, data, priority, dedupe_key, expires_at, push_state)
     VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7::int IS NULL THEN NULL ELSE now() + make_interval(secs => $7::int) END, $8)
     ON CONFLICT (profile_id, dedupe_key) DO NOTHING`,
    [n.profile, n.kind, n.order ?? null, n.data ?? {}, n.priority ?? 'normal', n.dedupe, n.expiresInS ?? null, push ? 'pending' : 'skipped']);
}

// Text for push notifications shown by the phone when the app is closed. To be reviewed by a native speaker.
const T: Record<string, Record<'ar' | 'fr' | 'en', (d: any) => [string, string]>> = {
  'profile.approved':   { ar: () => ['تمت الموافقة على حسابك', 'يمكنك الآن العمل كمندوب'], fr: () => ['Profil approuvé', 'Vous pouvez maintenant travailler comme livreur'], en: () => ['Profile approved', 'You can now work as a driver'] },
  'profile.rejected':   { ar: () => ['تعذر قبول حسابك', 'تحقق من التطبيق لمعرفة السبب'], fr: () => ['Profil refusé', 'Ouvrez l’application pour voir la raison'], en: () => ['Profile not approved', 'Open the app to see the reason'] },
  'profile.suspended':  { ar: () => ['تم تعليق حسابك', 'تواصل مع الدعم'], fr: () => ['Profil suspendu', 'Contactez le support'], en: () => ['Profile suspended', 'Contact support'] },
  'profile.unsuspended':{ ar: () => ['تم رفع التعليق عن حسابك', 'يمكنك المتابعة'], fr: () => ['Suspension levée', 'Vous pouvez continuer'], en: () => ['Suspension lifted', 'You can continue'] },
  'order.cancelled':    { ar: () => ['تم إلغاء الطلب', 'ألغى الدعم طلبك'], fr: () => ['Commande annulée', 'Le support a annulé votre commande'], en: () => ['Order cancelled', 'Support cancelled your order'] },
  'order.reassigned':   { ar: () => ['نبحث عن مندوب آخر', 'سنعثور لك على مندوب جديد'], fr: () => ['Nouveau livreur en recherche', 'Nous vous trouvons un autre livreur'], en: () => ['Finding another driver', 'We are finding you a new driver'] },
  'job.updated':        { ar: () => ['تم تحديث الطلب', 'تم تصحيح عنوان الطلب'], fr: () => ['Course mise à jour', 'L’adresse a été corrigée'], en: () => ['Delivery updated', 'The address was corrected'] },
  'problem.resolved':   { ar: () => ['تمت معالجة بلاغك', 'افتح التطبيق لمعرفة النتيجة'], fr: () => ['Signalement traité', 'Ouvrez l’application pour voir le résultat'], en: () => ['Your report was handled', 'Open the app to see the outcome'] },
  'cash.handover':      { ar: d => ['تم تسجيل تسليم نقدي', `${d.amount_da} دج. رقم الإيصال ${d.receipt}`], fr: d => ['Remise d’espèces enregistrée', `${d.amount_da} DA. Reçu n° ${d.receipt}`], en: d => ['Cash handover recorded', `${d.amount_da} DA. Receipt no. ${d.receipt}`] },
  'cash.adjusted':      { ar: () => ['تعديل على حساب النقد', 'افتح التطبيق للتفاصيل'], fr: () => ['Ajustement de caisse', 'Ouvrez l’application pour les détails'], en: () => ['Cash account adjusted', 'Open the app for details'] },
  'security.new_login': { ar: () => ['تسجيل دخول جديد إلى حسابك', 'إذا لم تكن أنت، اخرج من كل الأجهزة من الإعدادات'], fr: () => ['Nouvelle connexion à votre compte', 'Si ce n’est pas vous, déconnectez tous les appareils dans Réglages'], en: () => ['New login to your account', 'If this was not you, log out of all devices in Settings'] },
  'order.incoming':  { ar: d => ['طرد في الطريق إليك', `من ${d.sender || '—'}. رمز التسليم: ${d.delivery_code}`], fr: d => ['Un colis arrive', `De ${d.sender || '—'}. Code de livraison : ${d.delivery_code}`], en: d => ['A parcel is on its way to you', `From ${d.sender || '—'}. Delivery code: ${d.delivery_code}`] },
  'offer.new':       { ar: d => ['طلب توصيل جديد', `السعر: ${d.price_da} دج`],                 fr: d => ['Nouvelle course', `Prix : ${d.price_da} DA`], en: d => ['New delivery request', `Price: ${d.price_da} DA`] },
  'job.cancelled':   { ar: () => ['تم إلغاء الطلب', 'ألغى العميل هذا الطلب'],                   fr: () => ['Course annulée', 'Le client a annulé la commande'], en: () => ['Delivery cancelled', 'The customer cancelled this order'] },
  'order.assigned':  { ar: () => ['تم العثور على مندوب', 'مندوب في الطريق لاستلام طردك'],       fr: () => ['Livreur trouvé', 'Un livreur arrive récupérer votre colis'], en: () => ['Driver found', 'A driver is on the way to pick up your parcel'] },
  'order.picked_up': { ar: () => ['تم استلام الطرد', 'طردك في الطريق إلى المستلم'],             fr: () => ['Colis récupéré', 'Votre colis est en route'], en: () => ['Parcel picked up', 'Your parcel is on its way'] },
  'order.delivered': { ar: () => ['تم التسليم', 'تم تسليم طلبك. قيّم المندوب'],                  fr: () => ['Livré', 'Votre commande est livrée. Notez le livreur'], en: () => ['Delivered', 'Your order was delivered. Rate your driver'] },
  'return.delivered':{ ar: () => ['تمت إعادة الطرد', 'تمت إعادة الطرد إليك'],                    fr: () => ['Colis retourné', 'Le colis vous a été retourné'], en: () => ['Parcel returned', 'The parcel was returned to you'] },
  'order.failed':    { ar: () => ['تعذر التسليم', 'الطرد في طريق العودة إليك'],                  fr: () => ['Livraison impossible', 'Le colis vous est retourné'], en: () => ['Delivery failed', 'The parcel is being returned to you'] },
  'order.driver_released':   { ar: () => ['تغيّر السائق', 'نبحث لك عن سائق آخر بالسعر نفسه'], fr: () => ['Changement de livreur', 'Nous cherchons un autre livreur au même prix'], en: () => ['Driver changed', 'We are finding another driver at the same price'] },
  'order.recipient_expecting': { ar: () => ['المستلم ينتظر طردك', 'أكّد المستلم أنه ينتظر الطرد'], fr: () => ['Le destinataire attend votre colis', 'Il a confirmé qu’il l’attend'], en: () => ['The receiver is expecting it', 'The receiver confirmed he is expecting the parcel'] },
  'order.checking':   { ar: () => ['نتحقق من طردك', 'فريقنا يتابع التوصيل الآن'], fr: () => ['Nous vérifions votre colis', 'Notre équipe suit la livraison'], en: () => ['We are checking on your parcel', 'Our team is following the delivery'] },
  'job.recalled':     { ar: () => ['المرسل استرجع الطرد', 'أعد الطرد إلى المرسل'], fr: () => ['Colis rappelé', 'Ramenez le colis à l’expéditeur'], en: () => ['Parcel called back', 'Bring the parcel back to the sender'] },
  'trust.violation':  { ar: d => ['تسجيل مخالفة', `${d.points} نقطة. افتح سجلي في الإعدادات`], fr: d => ['Règle non respectée', `${d.points} point(s). Voir Mon dossier dans Paramètres`], en: d => ['Rule broken', `${d.points} point(s). See My record in Settings`] },
  'trust.warning':    { ar: () => ['تنبيه', 'لديك 3 نقاط أو أكثر. عند 5 نقاط يُحظر ملفك 24 ساعة'], fr: () => ['Avertissement', 'Vous avez 3 points ou plus. À 5 points, le profil est bloqué 24 h'], en: () => ['Warning', 'You have 3 points or more. At 5 points the profile is blocked for 24 h'] },
  'trust.blocked':    { ar: () => ['ملفك محظور مؤقتًا', 'افتح سجلي لمعرفة السبب والطعن'], fr: () => ['Profil bloqué temporairement', 'Ouvrez Mon dossier pour voir pourquoi et faire appel'], en: () => ['Profile blocked for now', 'Open My record to see why and appeal'] },
  'trust.lifted':     { ar: () => ['رُفع الحظر', 'يمكنك المتابعة'], fr: () => ['Blocage levé', 'Vous pouvez continuer'], en: () => ['Block lifted', 'You can continue'] },
  'trust.decided':    { ar: () => ['تم الرد على طعنك', 'افتح سجلي لمعرفة القرار'], fr: () => ['Réponse à votre appel', 'Ouvrez Mon dossier pour voir la décision'], en: () => ['Your appeal was answered', 'Open My record to see the decision'] },
  'order.expired':   { ar: () => ['لم نجد مندوباً', 'ارفع السعر وحاول مجدداً'], fr: () => ['Aucun livreur trouvé', 'Augmentez le prix et réessayez'], en: () => ['No courier found', 'Raise the price and try again'] },
  'order.bid':       { ar: d => ['عرض من مندوب', `${d.price_da} دج. اختر المندوب في التطبيق.`], fr: d => ['Offre d’un livreur', `${d.price_da} DA. Choisissez votre livreur dans l’application.`], en: d => ['A courier made an offer', `${d.price_da} DA. Choose your courier in the app.`] },
  'bid.accepted':    { ar: d => ['قبل العميل عرضك', `${d.price_da} دج. توجه لاستلام الطرد.`], fr: d => ['Le client a accepté votre offre', `${d.price_da} DA. Allez récupérer le colis.`], en: d => ['The customer accepted your offer', `${d.price_da} DA. Go and pick up the parcel.`] },
};
export function pushText(kind: string, data: any, lang: 'ar' | 'fr' | 'en'): [string, string] | null { return T[kind]?.[lang]?.(data ?? {}) ?? null; }
