# Round 184: "you have to include the json sent when depositing in the admin
# panel it will help us diagnose the problem" -- the new "Recent rejected
# deposit attempts" card on the Deposits tab (recordDepositAttempt() /
# GET /admin/deposit-attempts/list), showing exactly what a member's app sent
# for a request the server refused before any deposit row ever existed.
#
# "Automatic (PAY A)"/"Manual (PAY B)" reuse the SAME word choices this table
# already settled on -- 'Automatic' (admin-rows-6.py) and the "by hand"
# phrasing PAY B's own description already uses (admin-rows-17.py) -- rather
# than inventing a second vocabulary for the same two ideas. "Reason" reuses
# admin-rows-1.py's existing row the same way.
#
# The three Bantu columns are a good-faith first pass, same as every other
# entry in this table -- want a native speaker's eye before launch.
#
# Six columns: English, Luganda, Kiswahili, French, Kinyarwanda, Runyankore.
ROWS = [
    ["A deposit request the server refused before any deposit was even created -- a phone number in the wrong format, a disabled payment method, an amount below the minimum. Nothing here ever touched a wallet; this is exactly what the member's own app sent, for diagnosing why it was refused.",
     "Okusaba okuteeka ssente server gye yagaana nga tewannabaawo kuteeka ssente kwonna okukolebwa -- ennamba y'essimu mu ngeri embi, engeri y'okusasula eyazikiddwa, omuwendo ogusinga wansi w'obutono. Tewali kintu wano ekyali kikutte ku ssente z'omukozesa; kino kye app y'omukozesa yennyini kye yaweereza, olw'okwekenneenya lwaki kyagaanibwa.",
     "Ombi la malipo ambalo seva ilikataa kabla ya malipo hata kuundwa -- nambari ya simu katika muundo usio sahihi, njia ya malipo iliyozimwa, kiasi chini ya kiwango cha chini. Hakuna kitu hapa kilichogusa pochi; hiki ndicho hasa programu ya mwanachama ilichotuma, kwa ajili ya kuchunguza kwa nini kilikataliwa.",
     "Une demande de dépôt que le serveur a refusée avant même qu'un dépôt ne soit créé -- un numéro de téléphone au mauvais format, un moyen de paiement désactivé, un montant inférieur au minimum. Rien ici n'a jamais touché un portefeuille ; c'est exactement ce que l'application du membre a envoyé, pour diagnostiquer pourquoi c'était refusé.",
     "Icyifuzo cyo kubika amafaranga seriveri yanze mbere y'uko habaho kubika kwose -- inomero ya telefoni idafite imiterere nyayo, uburyo bwo kwishyura bwazimijwe, umubare uri munsi y'ubuke bukwiye. Nta kintu hano cyigeze gikora ku mafaranga; iki ni ibyo porogaramu y'umunyamuryango ubwayo yohereje, kugira ngo hamenywe impamvu byanzwe.",
     "Okusaba okuteeraho sente server yaagaana obutasingwa kuteeraho sente kwona kukorwa -- enamba y'esimu omu muringo mubi, omuringo gw'okusasura ogwazimwa, omuwendo oguri hansi h'obutono. Tihariho ekintu hanu ekyakozire aha sente; eki nikyo app y'omwegyendesyereza yaayo yaatumire, ahabw'okucondooza ahabw'enki byagairwe."],

    ["Automatic (PAY A)",
     "Kya bwetwaze (PAY A)", "Kiotomatiki (PAY A)", "Automatique (PAY A)",
     "Byikora (PAY A)", "Kyonka (PAY A)"],

    ["Manual (PAY B)",
     "Eya mukono (PAY B)", "Ya mkono (PAY B)", "Manuel (PAY B)",
     "Iy'intoke (PAY B)", "Ey'engaro (PAY B)"],

    ["Reason given",
     "Ensonga eweereddwa", "Sababu iliyotolewa", "Motif donné",
     "Impamvu yatanzwe", "Enshonga eyaheirwe"],

    ["What the app actually sent",
     "Ekyo app yennyini gye yaweereza", "Kile programu ilichotuma hasa",
     "Ce que l'application a réellement envoyé",
     "Ibyo porogaramu yohereje by'ukuri", "Ekyo app yaatuma buzimazima"],
]

PATTERNS = [
    ['Recent rejected deposit attempts ({0})',
     'Okugezaako okuteeka ssente okwagaanibwa aggya ({0})',
     'Majaribio ya hivi karibuni ya malipo yaliyokataliwa ({0})',
     'Tentatives de dépôt récemment refusées ({0})',
     'Ibigeragezo bishya byo kubika byanzwe ({0})',
     'Kugyezaho kuteeraho sente okwagairwe aha kahingiro ({0})'],
]
