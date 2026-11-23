#!/usr/bin/env python3
"""Batch 7 of the admin panel's own string table: the PesaJet card.

The dashboard card that answers "how much has gone through PesaJet" -- which
is deliberately NOT called a balance, because PesaJet publish no balance
endpoint. Two of these strings belong to branches the coverage sweep cannot
render at the same time as the rest (an empty summary, and a failed read), so
they are covered instead by the static inventory audit in test-pesajet.js.

Written as data here and merged into admin-src/index.html by
build-admin-rows.py, so the rows can be reviewed as a table rather than as
JavaScript.

"PesaJet" is a company's name and is left alone in every language, as the
currency labels and account ids are.

[english, lg, sw, fr, rw, nyn]
"""
ROWS = [
    ['PesaJet money moved',
     'Ssente eziyise mu PesaJet',
     'Fedha zilizopita kupitia PesaJet',
     'Argent passé par PesaJet',
     'Amafaranga yanyuze muri PesaJet',
     'Sente ezirabireho PesaJet'],

    ['PesaJet does not publish a balance endpoint, so this is our own record of what has gone through them — not the float in their account.',
     'PesaJet tewa kkubo lya balansi, kale zino ze bye twewandiikira ffe ebiyise mu bo — si ssente eziri ku akawunti yaabwe.',
     'PesaJet haitoi kiungo cha salio, kwa hivyo hii ni kumbukumbu yetu wenyewe ya kilichopita kwao — si fedha zilizo kwenye akaunti yao.',
     'PesaJet ne publie pas de point d\'accès au solde ; ceci est donc notre propre relevé de ce qui est passé chez eux — pas le solde de leur compte.',
     'PesaJet ntitanga aho usoma amafaranga asigaye, bityo aya ni inyandiko yacu bwite y\'ibyanyuze muri bo — si amafaranga ari kuri konti yabo.',
     'PesaJet terikutuha omuhanda gw\'okureeba sente ezisigaire, n\'ahabw\'ekyo egi n\'ekitabo kyaitu ky\'ebirabireho — ti sente eziri aha akaunti yaabo.'],

    ['It cannot see PesaJet\'s fees, or anything settled out to a bank.',
     'Tekisobola kulaba ssente PesaJet ze bakolako, oba ekisindikiddwa mu bbanka.',
     'Haiwezi kuona ada za PesaJet, wala chochote kilicholipwa kwenda benki.',
     'Elle ne voit pas les frais de PesaJet, ni ce qui a été versé vers une banque.',
     'Ntibona amafaranga PesaJet yishyuza, cyangwa ibyoherejwe muri banki.',
     'Tekirikubaasa kureeba sente ezi PesaJet erikwakira, nari ekyatwarirwe omu banka.'],

    ['Collected',
     'Ezikungaanyiziddwa',
     'Zilizokusanywa',
     'Encaissé',
     'Yakiriwe',
     'Ezisorooziibwe'],

    ['Paid out',
     'Ezisasuddwa',
     'Zilizolipwa',
     'Versé',
     'Yishyuwe',
     'Ezishashuriibwe'],

    ['Net through PesaJet',
     'Ezisigadde nga ziyise mu PesaJet',
     'Salio halisi kupitia PesaJet',
     'Net via PesaJet',
     'Umubare nyawo wanyuze muri PesaJet',
     'Ezisigaire nizirabire PesaJet'],

    ['These totals are incomplete — there is more history than this read can scan.',
     'Omuwendo guno tegujjuvu — ebyafaayo biri bingi okusinga ebisomeddwa wano.',
     'Jumla hizi hazijakamilika — kuna historia nyingi kuliko usomaji huu unavyoweza kupitia.',
     'Ces totaux sont incomplets — il y a plus d\'historique que cette lecture ne peut parcourir.',
     'Ibi biteranyo ntibyuzuye — hari amateka menshi kuruta ibyo uku gusoma kwashoboye gusuzuma.',
     'Emiwendo egi tirikuhikire — haine ebyabaireho bingi okukira ebi twasoma.'],

    ['No PesaJet API key is set on the server yet.',
     'Tewali kisumuluzo kya PesaJet API ekiteekeddwa ku sseva.',
     'Hakuna ufunguo wa PesaJet API uliowekwa kwenye seva bado.',
     'Aucune clé API PesaJet n\'est encore configurée sur le serveur.',
     'Nta rufunguzo rwa PesaJet API rurashyirwa kuri seriveri.',
     'Tihariho kishumuruzo kya PesaJet API ekitairweho aha seeva.'],

    # ── the two branches one fixture cannot render alongside the rest ──
    ['Nothing has gone through PesaJet yet.',
     'Tewannabaawo ssente eziyise mu PesaJet.',
     'Bado hakuna kilichopita kupitia PesaJet.',
     'Rien n\'est encore passé par PesaJet.',
     'Nta kintu kirarenga muri PesaJet.',
     'Tihariho kintu ekirabireho PesaJet.'],

    ['Could not read the PesaJet summary right now.',
     'Tekisobose kusoma bufunze bwa PesaJet kaakano.',
     'Haikuweza kusoma muhtasari wa PesaJet kwa sasa.',
     'Impossible de lire le récapitulatif PesaJet pour le moment.',
     'Ntibyashobotse gusoma incamake ya PesaJet ubu.',
     'Tikirikubaasa kusoma enkomeko ya PesaJet hati.'],

    # What the server itself answers when the read fails, which the card shows
    # in preference to its own wording.
    ['Could not read the PesaJet summary',
     'Tekisobose kusoma bufunze bwa PesaJet',
     'Haikuweza kusoma muhtasari wa PesaJet',
     'Impossible de lire le récapitulatif PesaJet',
     'Ntibyashobotse gusoma incamake ya PesaJet',
     'Tikirikubaasa kusoma enkomeko ya PesaJet'],
]

# The counts and the money are spliced in at render time, so no whole-string
# row can ever match these. Whatever {0} and {1} capture is copied across
# untouched -- a figure must never be rewritten by a translation.
PATTERNS = [
    ['{0} recharge(s) still arriving, worth {1}',
     'Okuteekamu {0} kukyajja, kwa {1}',
     'Malipo {0} bado yanakuja, yenye thamani ya {1}',
     '{0} recharge(s) encore en cours, pour {1}',
     'Kongeramo {0} biracyaza, bifite agaciro ka {1}',
     'Okutamu {0} nikuza, kwa {1}'],

    ['{0} payout(s) still sending, worth {1}',
     'Okusasula {0} kukyasindikibwa, kwa {1}',
     'Malipo {0} bado yanatumwa, yenye thamani ya {1}',
     '{0} versement(s) encore en cours d\'envoi, pour {1}',
     'Kwishyura {0} biracyoherezwa, bifite agaciro ka {1}',
     'Okushashura {0} nikutumwa, kwa {1}'],
]
