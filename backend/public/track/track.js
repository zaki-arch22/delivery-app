// The receiver's tracking page. Every text from the server is inserted as TEXT (never as HTML), so names or addresses
// typed by people can never run as code. Data refreshes every 10 seconds.
(function () {
  'use strict';
  var token = location.pathname.split('/').pop();
  var T = {
    en: { searching: 'Looking for a driver', assigned: 'A driver is going to collect your parcel', picked_up: 'Your parcel is on its way', delivered: 'Delivered', failed: 'Not delivered', cancelled: 'Cancelled', expired: 'No driver was found',
      from: 'Parcel from {name}', eta: 'Arrives in about {m} min', eta_soon: 'Arriving now', eta_about: '(estimate)', driver: 'Your driver', call: 'Call the driver',
      pay: 'Amount to pay at the door', pay_none: 'Nothing to pay at the door', goods: 'Goods', fee: 'Delivery',
      open: 'You may open the parcel and check it before paying.', outside: 'You may check the outside of the parcel before paying (opening is not allowed by the seller).',
      code: 'Your delivery code', code_warn: 'Give this code (or show the QR) to the driver ONLY when you have the parcel in your hands, have checked it and paid. Giving the code means you received it.',
      refuse: 'If the parcel is damaged or not what you ordered, do not give the code: tell the driver you refuse it. It goes back to the seller.',
      photo: 'Photo of your parcel taken when the driver collected it', expecting: 'I am expecting this parcel', expecting_done: 'Thank you: the seller and the driver know you are expecting it.',
      report: 'Report a problem', r_not_arrived: 'It did not arrive', r_damaged: 'It is damaged', r_wrong_item: 'Wrong or changed item', r_driver_behaviour: 'Driver behaviour', r_other: 'Other',
      note: 'Details (optional)', send: 'Send', sent: 'Sent. Our team will look at it.', history: 'History', ended: 'This tracking link has ended.', error: 'Could not load. Check your connection.',
      h_created: 'Order created', h_assigned: 'Driver assigned', h_released_by_driver: 'Driver changed, looking for another one', h_reassigned: 'Driver changed', h_picked_up: 'Parcel collected', h_delivered: 'Delivered', h_delivery_failed: 'Not delivered', h_recalled_by_sender: 'Called back by the seller', h_cancelled: 'Cancelled', h_cancelled_by_support: 'Cancelled by support', h_expired: 'No driver found', h_recipient_expecting: 'You confirmed you are expecting it',
      motorbike: 'motorbike', car: 'car', map_credit: '© OpenStreetMap contributors' },
    fr: { searching: 'Recherche d’un livreur', assigned: 'Un livreur va récupérer votre colis', picked_up: 'Votre colis est en route', delivered: 'Livré', failed: 'Non livré', cancelled: 'Annulé', expired: 'Aucun livreur trouvé',
      from: 'Colis de {name}', eta: 'Arrivée dans environ {m} min', eta_soon: 'Arrive maintenant', eta_about: '(estimation)', driver: 'Votre livreur', call: 'Appeler le livreur',
      pay: 'Montant à payer à la porte', pay_none: 'Rien à payer à la porte', goods: 'Marchandise', fee: 'Livraison',
      open: 'Vous pouvez ouvrir le colis et le vérifier avant de payer.', outside: 'Vous pouvez vérifier l’extérieur du colis avant de payer (le vendeur n’autorise pas l’ouverture).',
      code: 'Votre code de livraison', code_warn: 'Donnez ce code (ou montrez le QR) au livreur UNIQUEMENT quand vous avez le colis en main, l’avez vérifié et payé. Donner le code signifie que vous l’avez reçu.',
      refuse: 'Si le colis est abîmé ou n’est pas ce que vous avez commandé, ne donnez pas le code : dites au livreur que vous le refusez. Il retourne au vendeur.',
      photo: 'Photo de votre colis prise quand le livreur l’a récupéré', expecting: 'J’attends ce colis', expecting_done: 'Merci : le vendeur et le livreur savent que vous l’attendez.',
      report: 'Signaler un problème', r_not_arrived: 'Il n’est pas arrivé', r_damaged: 'Il est abîmé', r_wrong_item: 'Article erroné ou changé', r_driver_behaviour: 'Comportement du livreur', r_other: 'Autre',
      note: 'Détails (facultatif)', send: 'Envoyer', sent: 'Envoyé. Notre équipe va l’examiner.', history: 'Historique', ended: 'Ce lien de suivi a expiré.', error: 'Chargement impossible. Vérifiez votre connexion.',
      h_created: 'Commande créée', h_assigned: 'Livreur attribué', h_released_by_driver: 'Changement de livreur, recherche d’un autre', h_reassigned: 'Changement de livreur', h_picked_up: 'Colis récupéré', h_delivered: 'Livré', h_delivery_failed: 'Non livré', h_recalled_by_sender: 'Rappelé par le vendeur', h_cancelled: 'Annulé', h_cancelled_by_support: 'Annulé par le support', h_expired: 'Aucun livreur trouvé', h_recipient_expecting: 'Vous avez confirmé l’attendre',
      motorbike: 'moto', car: 'voiture', map_credit: '© contributeurs OpenStreetMap' },
    ar: { searching: 'جارٍ البحث عن سائق', assigned: 'سائق في طريقه لاستلام طردك', picked_up: 'طردك في الطريق إليك', delivered: 'تم التسليم', failed: 'لم يتم التسليم', cancelled: 'أُلغي', expired: 'لم يُعثر على سائق',
      from: 'طرد من {name}', eta: 'يصل بعد حوالي {m} دقيقة', eta_soon: 'يصل الآن', eta_about: '(تقدير)', driver: 'سائقك', call: 'الاتصال بالسائق',
      pay: 'المبلغ الواجب دفعه عند الباب', pay_none: 'لا شيء للدفع عند الباب', goods: 'السلعة', fee: 'التوصيل',
      open: 'يمكنك فتح الطرد والتحقق منه قبل الدفع.', outside: 'يمكنك التحقق من الطرد من الخارج قبل الدفع (البائع لا يسمح بفتحه).',
      code: 'رمز الاستلام الخاص بك', code_warn: 'أعطِ هذا الرمز (أو أظهر رمز QR) للسائق فقط عندما يكون الطرد بين يديك وقد تحققت منه ودفعت. إعطاء الرمز يعني أنك استلمته.',
      refuse: 'إذا كان الطرد تالفًا أو ليس ما طلبته، فلا تعطِ الرمز: أخبر السائق أنك ترفضه. سيعود إلى البائع.',
      photo: 'صورة طردك التُقطت عند استلام السائق له', expecting: 'أنا أنتظر هذا الطرد', expecting_done: 'شكرًا: البائع والسائق يعلمان أنك تنتظره.',
      report: 'الإبلاغ عن مشكلة', r_not_arrived: 'لم يصل', r_damaged: 'تالف', r_wrong_item: 'سلعة خاطئة أو مُبدلة', r_driver_behaviour: 'سلوك السائق', r_other: 'أخرى',
      note: 'تفاصيل (اختياري)', send: 'إرسال', sent: 'أُرسل. سيتابعه فريقنا.', history: 'السجل', ended: 'انتهت صلاحية رابط التتبع هذا.', error: 'تعذر التحميل. تحقق من اتصالك.',
      h_created: 'أُنشئ الطلب', h_assigned: 'تم تعيين سائق', h_released_by_driver: 'تغيّر السائق، جارٍ البحث عن آخر', h_reassigned: 'تغيّر السائق', h_picked_up: 'تم استلام الطرد', h_delivered: 'تم التسليم', h_delivery_failed: 'لم يتم التسليم', h_recalled_by_sender: 'استرجعه البائع', h_cancelled: 'أُلغي', h_cancelled_by_support: 'ألغاه الدعم', h_expired: 'لم يُعثر على سائق', h_recipient_expecting: 'أكدت أنك تنتظره',
      motorbike: 'دراجة نارية', car: 'سيارة', map_credit: '© مساهمو OpenStreetMap' }
  };
  var saved = null; try { saved = localStorage.getItem('lang'); } catch (e) {}
  var nav = (navigator.language || 'fr').slice(0, 2);
  var lang = T[saved] ? saved : T[nav] ? nav : 'fr';
  var data = null, map = null, driverMarker = null, homeMarker = null, reportSent = false, failed = false, repCard = null;
  var t = function (k, v) { var s = (T[lang][k] || T.en[k] || k); for (var x in (v || {})) s = s.replace('{' + x + '}', v[x]); return s; };
  var money = function (n) { try { return new Intl.NumberFormat(lang === 'ar' ? 'ar-DZ' : 'fr-DZ').format(n) + ' DA'; } catch (e) { return n + ' DA'; } };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || 'ERR'); e.code = j.error; throw e; } return j; }); });
  }
  function setLang(l) {
    lang = l; try { localStorage.setItem('lang', l); } catch (e) {}
    document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('.langs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lang') === l); });
    render();
  }
  document.querySelectorAll('.langs button').forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-lang')); }); });
  // The map library arrives as a module, after this script: draw the map as soon as it is there.
  window.addEventListener('maplibre-ready', function () { if (data) render(); });

  function render() {
    var app = document.getElementById('app');
    if (failed && !data) { app.replaceChildren(el('div', 'card', t(failed === 'LINK_ENDED' || failed === 'BAD_LINK' ? 'ended' : 'error'))); return; }
    if (!data) return;
    var d = data, kids = [];
    document.getElementById('ref').textContent = d.ref;
    var head = el('div', 'card');
    head.append(el('h1', null, t(d.status)), el('p', 'muted', t('from', { name: d.sender_first_name })));
    var steps = el('div', 'steps'), at = { searching: 1, assigned: 2, picked_up: 3, delivered: 4 }[d.status] || 0;
    for (var i = 1; i <= 4; i++) { var s = el('span'); if (i <= at) s.className = 'on'; steps.append(s); }
    head.append(steps);
    if (d.eta_s != null) head.append(el('div', 'eta', (d.eta_s < 90 ? t('eta_soon') : t('eta', { m: Math.round(d.eta_s / 60) })) + (d.eta_estimated ? ' ' + t('eta_about') : '')));
    kids.push(head);
    var mapBox = el('div'); mapBox.id = 'map'; kids.push(mapBox);
    if (d.driver) {
      var dc = el('div', 'card'); dc.append(el('h2', null, t('driver')));
      dc.append(el('p', null, d.driver.first_name + ' · ' + t(d.driver.vehicle) + (d.driver.rating ? ' · ★ ' + d.driver.rating : '')));
      if (d.driver.phone) { var a = el('a', 'btn secondary', t('call')); a.href = 'tel:' + d.driver.phone; dc.append(a); }
      kids.push(dc);
    }
    if (['searching', 'assigned', 'picked_up'].indexOf(d.status) >= 0 && d.leg === 'delivery') {
      var pay = el('div', 'card' + (d.amount_to_pay_da > 0 ? ' pay' : ''));
      pay.append(el('h2', null, d.amount_to_pay_da > 0 ? t('pay') : t('pay_none')));
      if (d.amount_to_pay_da > 0) {
        pay.append(el('div', 'amount', money(d.amount_to_pay_da)));
        var parts = []; if (d.cod_amount_da) parts.push(t('goods') + ': ' + money(d.cod_amount_da)); if (d.delivery_fee_da) parts.push(t('fee') + ': ' + money(d.delivery_fee_da));
        pay.append(el('p', 'muted', parts.join(' · ')));
      }
      pay.append(el('p', null, t(d.inspection === 'open' ? 'open' : 'outside')));
      kids.push(pay);
      if (d.delivery_code) {
        var c = el('div', 'card code'); c.append(el('h2', null, t('code')), el('div', 'digits', d.delivery_code));
        c.append(keptImg('/track_qr?t=' + encodeURIComponent(token) + '&s=' + d.status, 'QR', null));
        c.append(el('p', 'warn', t('code_warn')), el('p', 'muted', t('refuse')));
        kids.push(c);
      }
      if (!d.expecting) { var ex = el('button', 'btn', t('expecting')); ex.onclick = function () { ex.disabled = true; api('/track_expecting', { t: token }).then(load, function () { ex.disabled = false; }); }; kids.push(ex); }
      else kids.push(el('p', 'muted', t('expecting_done')));
    }
    if (d.has_parcel_photo) { var ph = el('div', 'card'); ph.append(el('h2', null, t('photo'))); ph.append(keptImg('/track_photo?t=' + encodeURIComponent(token), '', 'photo')); kids.push(ph); }
    // The report form is kept between refreshes (so typed text is never lost); rebuilt only when the language changes.
    if (!repCard || repCard.getAttribute('data-lang') !== lang + reportSent) repCard = buildReport();
    kids.push(repCard);
    var h = el('div', 'card'); h.append(el('h2', null, t('history'))); var ol = el('ol', 'hist');
    d.history.forEach(function (e) { var li = el('li'); var tm = el('time', null, new Date(e.at).toLocaleString(lang === 'ar' ? 'ar-DZ' : 'fr-DZ', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })); li.append(tm, document.createTextNode(' · ' + t('h_' + e.type))); ol.append(li); });
    h.append(ol); kids.push(h);
    app.replaceChildren.apply(app, kids);
    drawMap(mapBox);
  }

  // Images are created once per address and reused, so a refresh does not download them again.
  var imgs = {};
  function keptImg(src, alt, cls) { if (!imgs[src]) { var i = el('img', cls); i.alt = alt; i.src = src; imgs[src] = i; } return imgs[src]; }

  function buildReport() {
    var rep = el('div', 'card'); rep.setAttribute('data-lang', lang + reportSent); rep.append(el('h2', null, t('report')));
    if (reportSent) rep.append(el('p', null, t('sent')));
    else {
      var sel = el('select'); ['not_arrived', 'damaged', 'wrong_item', 'driver_behaviour', 'other'].forEach(function (r) { var o = el('option', null, t('r_' + r)); o.value = r; sel.append(o); });
      var note = el('textarea'); note.placeholder = t('note'); note.maxLength = 1000; note.rows = 2;
      var send = el('button', 'btn secondary', t('send'));
      send.onclick = function () { send.disabled = true; api('/track_report', { t: token, reason: sel.value, note: note.value }).then(function () { reportSent = true; render(); }, function () { send.disabled = false; }); };
      rep.append(sel, note, send);
    }
    return rep;
  }

  function drawMap(box) {
    if (!window.maplibregl || !data) { box.remove(); return; }
    var dest = [data.dropoff.lng, data.dropoff.lat], drv = data.driver && data.driver.location ? [data.driver.location.lng, data.driver.location.lat] : null;
    if (map) { box.replaceWith(map.getContainer()); } else {
      map = new maplibregl.Map({ container: box, style: 'https://tiles.openfreemap.org/styles/liberty', center: drv || dest, zoom: 14, attributionControl: { compact: true, customAttribution: t('map_credit') } });
      homeMarker = new maplibregl.Marker({ color: '#B4EF2A' }).setLngLat(dest).addTo(map);
    }
    if (drv) { if (!driverMarker) driverMarker = new maplibregl.Marker({ color: '#FFFFFF' }).setLngLat(drv).addTo(map); else driverMarker.setLngLat(drv); }
    else if (driverMarker) { driverMarker.remove(); driverMarker = null; }
    if (drv) { var b = new maplibregl.LngLatBounds(dest, dest); b.extend(drv); map.fitBounds(b, { padding: 50, maxZoom: 16, duration: 0 }); }
    map.resize();
  }

  function load() {
    return api('/track_data?t=' + encodeURIComponent(token)).then(function (d) { data = d; failed = false; render(); }, function (e) { failed = e.code || true; if (!data) render(); });
  }
  setLang(lang); load();
  setInterval(function () { if (!data || ['searching', 'assigned', 'picked_up'].indexOf(data.status) >= 0) load(); }, 10000);
})();
