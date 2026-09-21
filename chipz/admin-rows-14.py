# Round 179c: the Countries editor now previews the number format its three
# phone fields add up to, and the exact refusal a member gets when a number
# does not fit it.
#
# Owner, shown MarzPay's own raw "Uganda only accepts Ugandan numbers...
# Kenyan (+254) numbers are not allowed": "why don't you put ie inside number
# areas ie for a country put in admin panel ie +2257, or 255, some country l
# made start differently, so why only mention Uganda and Kenya".
#
# The number formats themselves are rendered as data-no-i18n -- a format is
# data, not copy -- and the refusal EXAMPLE is rendered as the real sentence
# so it matches the member app's own badPhoneMessage() pattern row, which the
# admin bundle already lifts. Only the words around them need rows.
#
# Six columns: English, Luganda, Kiswahili, French, Kinyarwanda, Runyankore.
ROWS = [
    ['Fill in the dialling code and length to see the number format members here must use.',
     'Wandiika koodi y\'okukuba n\'obuwanvu okulaba engeri ennamba z\'abantu wano zisaana kubeera.',
     'Weka msimbo wa kupiga simu na urefu ili kuona muundo wa namba ambao wanachama hapa wanapaswa kutumia.',
     'Renseignez l\'indicatif et la longueur pour voir le format de numéro que les membres d\'ici doivent utiliser.',
     'Uzuza kode y\'ubuhamagara n\'uburebure kugira ngo ubone imiterere ya nimero abanyamuryango bo hano bagomba gukoresha.',
     'Handiika koodi y\'okuteera n\'oburaingwa kureeba omuringo gwa namba abantu ba hanu bashemereire kukoresa.'],

    ['Any of these may lead:',
     'Buli emu ku zino esobola okusooka:',
     'Yoyote ya hizi inaweza kuanza:',
     'N\'importe lequel de ceux-ci peut commencer :',
     'Iyi yose ishobora gutangira:',
     'Buri emwe aha ezi nibaasa kutandika:'],

    ['A member who types anything else is refused with this, in their own language:',
     'Omuntu awandiika ekirala kigaanibwa n\'obubaka buno, mu lulimi lwe.',
     'Mwanachama anayeandika kingine yeyote anakataliwa kwa haya, kwa lugha yake mwenyewe:',
     'Un membre qui saisit autre chose est refusé avec ceci, dans sa propre langue :',
     'Umunyamuryango wandika ikindi yangirwa n\'ibi, mu rurimi rwe:',
     'Omuntu orikuhandiika ekindi naayangirwa n\'ebi, omu rurimi rwe:'],
]

PATTERNS = [
    # {0} is the local form, {1} the international one -- both are number
    # formats and must be copied across a translation untouched.
    ['Numbers here must look like {0} or {1}',
     'Ennamba wano zisaana kufaanana nga {0} oba {1}',
     'Namba hapa zinapaswa kuonekana kama {0} au {1}',
     'Les numéros ici doivent ressembler à {0} ou {1}',
     'Nimero hano zigomba kuba nka {0} cyangwa {1}',
     'Namba hanu zishemereire kushusha nka {0} nari {1}'],
]
