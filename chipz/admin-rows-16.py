# Round 179d: a failed automatic deposit (MarzPay/LipaPay/PesaJet) now shows
# WHY, right in the Deposits row -- both what the member was told and the
# provider's own raw response. Before this the raw response existed only in
# a Railway console.error line, so diagnosing a generic "Could not start the
# payment" needed server log access nobody but the deploy owner has.
#
# "The member saw: <b>...</b>" and the raw provider text itself are DATA
# (the failureReason/providerDetail values), not translated here -- only the
# three labels around them are copy.
#
# Six columns: English, Luganda, Kiswahili, French, Kinyarwanda, Runyankore.
ROWS = [
    ['Why this failed',
     'Lwaki kino kyagaanye', 'Kwa nini hii ilishindwa', 'Pourquoi cet échec',
     'Impamvu ibi byanze', 'Ahabw\'enki eki kikaremwa'],

    ['The member saw:',
     'Omuntu yalaba:', 'Mwanachama aliona:', 'Le membre a vu :',
     'Umunyamuryango yabonye:', 'Omuntu akareeba:'],

    ['Raw response from the payment provider',
     'Eky\'okuddamu ekitatereezebbwa okuva eri katale w\'okusasula',
     'Jibu ghafi kutoka kwa mtoa huduma wa malipo',
     'Réponse brute du fournisseur de paiement',
     'Igisubizo mbisi kivuye ku mutanga wo kwishyura',
     'Okugarukamu okutatunganisiibwe kuruga aha muheereza w\'okushashura'],
]
