#!/usr/bin/env python3
"""Batch 6: Deposits and Withdrawals.

These two tabs had painted NOTHING through the first five batches -- their
processedByDay fixture was an object where the renderer spreads an array, the
renderer threw, switchTab() swallowed it, and the sweep reported no findings
for the two screens where money is actually approved. The sweep refuses to
call an empty screen clean now, and these are what it found the moment they
rendered.

[english, lg, sw, fr, rw, nyn]
"""
ROWS = [
    # ── the two decisions ──
    ['Approve', 'Kkiriza', 'Idhinisha', 'Approuver', 'Kwemeza', 'Ikiriza'],
    ['Reject', 'Gaana', 'Kataa', 'Refuser', 'Kwanga', 'Yanga'],
    ['Force-credit', 'Muwe ssente ku ngalo', 'Lipa kwa lazima', 'Créditer de force', 'Kongeraho ku gahato', 'Muhe sente aha ngufu'],
    ['Mark as paid', 'Teeka nga kisasulwa', 'Weka kama imelipwa', 'Marquer comme payé', 'Shyira nk\'ibyishyuwe', 'Taho nk\'ekishashuriirwe'],
    ['Sync payments', 'Tereeza ebisasulwa', 'Sawazisha malipo', 'Synchroniser les paiements', 'Guhuza ubwishyu', 'Gyerenganisa ebishashuriirwe'],

    # ── the columns ──
    ['Method', 'Engeri', 'Njia', 'Méthode', 'Uburyo', 'Omuringo'],
    ['Destination', 'Gy\'agenda', 'Inakoenda', '=', 'Aho bijya', 'Ahu nikigyenda'],
    ['Net', 'Ezisigala', 'Halisi', '=', 'Asigara', 'Ezirikusigara'],
    ['Ref', 'Namba', 'Kumbukumbu', 'Réf', 'Inomero', 'Namba'],

    # ── the states ──
    ['Needs Review', 'Kyetaaga okukeberwa', 'Inahitaji Ukaguzi', 'À vérifier', 'Bikeneye Igenzura', 'Nikyetenga Okureebwa'],
    ['Awaiting approval', 'Kirindirira okukkirizibwa', 'Inasubiri idhini', 'En attente d\'approbation', 'Bitegereje kwemezwa', 'Nikitegyereza okwikirizibwa'],
    ['Successful', 'Kiwedde bulungi', 'Imefanikiwa', 'Réussi', 'Byagenze neza', 'Kihikire gurungi'],
    ['Automatic', 'Kya bwetwaze', 'Kiotomatiki', 'Automatique', 'Byikora', 'Kyonka'],
    ['completed', 'kiwedde', 'imekamilika', 'terminé', 'byarangiye', 'kihikire'],
    ['No deposits', 'Tewali ssente eziteekeddwamu', 'Hakuna amana', 'Aucun dépôt', 'Nta bwishyu', 'Tihariho sente ezitairwemu'],
    ['No withdrawals', 'Tewali kuggyamu ssente', 'Hakuna utoaji', 'Aucun retrait', 'Nta kubikuza', 'Tihariho kwihamu sente'],

    # ── the pasted payment message, and the warning over it ──
    ['Payment message from the member', 'Obubaka bw\'okusasula obuva ku mukozesa', 'Ujumbe wa malipo kutoka kwa mwanachama', 'Message de paiement envoyé par le membre', 'Ubutumwa bwo kwishyura buvuye ku munyamuryango', 'Obutumwa bw\'okushashura oburuga aha mukozesa'],
    ['This server could not read the message automatically — read it yourself before approving.',
     'Sivva teyasobodde kusoma bubaka buno yokka — busome ggwe nga tonnakkiriza.',
     'Seva hii haikuweza kusoma ujumbe huu kiotomatiki — usome mwenyewe kabla ya kuidhinisha.',
     'Ce serveur n\'a pas pu lire le message automatiquement — lisez-le vous-même avant d\'approuver.',
     'Iyi seriveri ntiyashoboye gusoma ubu butumwa mu buryo bwikora — busome ubwawe mbere yo kwemeza.',
     'Sirivere egi tikibaasiikire kushoma obutumwa obu yenka — obushome iwe otakaikiriza.'],
]

PATTERNS = [
    # The sub-tab filters on Deposits and Withdrawals. Each carries its own
    # count, so a row can never match one -- the figure is captured and copied
    # across untouched.
    ['All ({0})', 'Byonna ({0})', 'Zote ({0})', 'Tout ({0})', 'Byose ({0})', 'Byona ({0})'],
    ['Pending ({0})', 'Ebirindiridde ({0})', 'Yanayosubiri ({0})', 'En attente ({0})', 'Bitegereje ({0})', 'Ebirikutegyereza ({0})'],
    ['Needs Review ({0})', 'Ebyetaaga okukeberwa ({0})', 'Inahitaji Ukaguzi ({0})', 'À vérifier ({0})', 'Bikeneye Igenzura ({0})', 'Ebirikwetenga Okureebwa ({0})'],
    ['Failed ({0})', 'Ebigaanye ({0})', 'Yaliyoshindwa ({0})', 'Échoué ({0})', 'Byanze ({0})', 'Ebyaremeire ({0})'],
    ['Successful ({0})', 'Ebiwedde bulungi ({0})', 'Yaliyofanikiwa ({0})', 'Réussi ({0})', 'Byagenze neza ({0})', 'Ebihikire gurungi ({0})'],
    ['Processed ({0})', 'Ebirongoosebbwa ({0})', 'Yaliyoshughulikiwa ({0})', 'Traité ({0})', 'Byatunganyijwe ({0})', 'Ebikorwaho ({0})'],
    ['Processing ({0})', 'Ebirongoosebwa ({0})', 'Inashughulikiwa ({0})', 'En traitement ({0})', 'Birimo gutunganywa ({0})', 'Ebirikukorwaho ({0})'],
    ['Sending ({0})', 'Ebisindikibwa ({0})', 'Inatumwa ({0})', 'Envoi ({0})', 'Birimo koherezwa ({0})', 'Ebirikutumwa ({0})'],
    ['Declined ({0})', 'Ebigaaniddwa ({0})', 'Yaliyokataliwa ({0})', 'Refusé ({0})', 'Byanzwe ({0})', 'Ebyangirwe ({0})'],
]
