#!/usr/bin/env python3
"""Batch 11: the instruction sentences that carry a VALUE, plus the last rows.

These read differently every time -- they name the country in the switch, the
currency, the domain you typed, the address this panel is open on, a count.
A whole-string row could only ever match one of those, so they are PATTERNS:
the literal words are translated and whatever {0} captured is copied across
untouched. That matters here beyond tidiness -- {0} is a country name, a
currency or a domain, and a translation must never rewrite one.

Also carries the remaining plain rows: the Deposits and Promo-code notes, and
the two Settings paragraphs that mention no value at all.

[english, lg, sw, fr, rw, nyn]
"""
ROWS = [
    ['Every deposit attempt, all time -- automatic (MarzPay or LipaPay) or manual (admin numbers, SMS-matched). Needs Review covers a manual order the SMS matcher couldn\'t safely resolve on its own (ambiguous match, sender mismatch, or a member-pasted confirmation) -- approve it once you\'ve verified the money genuinely landed, or reject it if it didn\'t.',
     'Buli kugezaako okuteekamu ssente, okuva olubereberye -- okwekolera (MarzPay oba LipaPay) oba okw\'engalo (nnamba za bakulembeze, nga zigattiddwa ne SMS). Kyetaaga Okukeberwa kitwala okusaba okw\'engalo SMS kw\'etasobodde kumaliriza bulungi yokka (okukwatagana okutaliimu bukakafu, omusindisi atakwatagana, oba obukakafu obuteekeddwa omuntu) -- kkiriza ng\'omaze okukakasa nti ssente zatuuse ddala, oba gaana singa tezaatuuka.',
     'Kila jaribio la kuweka pesa, tangu mwanzo -- kiotomatiki (MarzPay au LipaPay) au kwa mkono (namba za msimamizi, zilizolinganishwa na SMS). Inahitaji Ukaguzi hushughulikia oda ya mkono ambayo kilinganishi cha SMS hakikuweza kuimaliza salama chenyewe (ulinganifu usio dhahiri, mtumaji asiyelingana, au uthibitisho uliobandikwa na mwanachama) -- iidhinishe pale utakapothibitisha kuwa pesa ziliwasili kweli, au ikatae kama hazikufika.',
     'Chaque tentative de dépôt, depuis toujours -- automatique (MarzPay ou LipaPay) ou manuelle (numéros d\'administrateur, rapprochés par SMS). À vérifier couvre une commande manuelle que le rapprochement SMS n\'a pas pu résoudre seul en toute sécurité (correspondance ambiguë, expéditeur différent, ou confirmation collée par le membre) -- approuvez-la une fois que vous avez vérifié que l\'argent est bien arrivé, ou refusez-la sinon.',
     'Buri gerageza ryo gushyiramo amafaranga, kuva kera -- byikora (MarzPay cyangwa LipaPay) cyangwa n\'intoki (nimero z\'ubuyobozi, zihuzwa na SMS). Bikeneye Igenzura bireba ubusabe bwo n\'intoki uhuza SMS utashoboye kurangiza wenyine mu buryo bwizewe (guhuza kudasobanutse, uwohereje udahuye, cyangwa icyemezo cyakomekwe n\'umunyamuryango) -- bwemere numara kugenzura ko amafaranga yageze koko, cyangwa ubwange niba atageze.',
     'Buri kugyezaho okuta sente, kuruga ira -- okwenka (MarzPay nari LipaPay) nari okw\'engaro (namba z\'abebembezi, nizihuzibwa na SMS). Nikyetenga Kureebwa nikitwara okushaba okw\'engaro oku ekihuza SMS kitabaasize kumaliriza kwonka buzima (okuhuza okutamanyikire, orikutuma otarikuhikaana, nari okuhamya okwatairweho omuntu) -- kwikirize obu oraabe omazire kuhamya ngu sente zaahika buzima, nari okwange ku zitaahikire.'],

    ['Leave this ON. The very first account is let through automatically no matter what — with nobody registered yet there is no code in existence to type — and the rule starts applying the moment that first member exists. Only switch it OFF if you ever need to sign someone up with no upline, and switch it back on afterwards.',
     'Kino kirekere nga KIKOLA. Akaawunti akasooka kakkirizibwa okuyita awatali kusoomooza — nga tewali yenna yeewandiisa, tewali koodi eriwo ey\'okuwandiika — era etteeka litandika okukola amangu nga omuntu ow\'olubereberye abaddewo. Kizikize kyokka bw\'oba weetaaga okuwandiisa omuntu atalina amuyita, era oluvannyuma okizzeeko.',
     'Acha hii IKIWA IMEWASHWA. Akaunti ya kwanza kabisa huruhusiwa kupita bila masharti — kwa kuwa hakuna aliyejisajili bado, hakuna msimbo uliopo wa kuandika — na sheria huanza kutumika mara tu mwanachama huyo wa kwanza anapokuwepo. Izime tu ikiwa utahitaji kumsajili mtu asiye na mwalikaji, kisha uirudishe baadaye.',
     'Laissez ceci ACTIVÉ. Le tout premier compte passe automatiquement quoi qu\'il arrive — personne n\'étant encore inscrit, aucun code n\'existe à saisir — et la règle commence à s\'appliquer dès que ce premier membre existe. Ne le désactivez que si vous devez un jour inscrire quelqu\'un sans parrain, puis réactivez-le ensuite.',
     'Reka ibi BIKORESHE. Konti ya mbere y\'ibanze yemererwa kunyura uko byagenda kose — nta muntu urimo kwiyandikisha, nta kode iriho yo kwandika — kandi amategeko atangira gukurikizwa ako kanya uwo munyamuryango wa mbere abonetse. Bizimye gusa niba ukeneye kwandikisha umuntu udafite uwamutumiye, hanyuma ubisubizeho.',
     'Reka eki KIRIKUKORA. Akaunti ey\'okubanza neekirizibwa kuraba kwonka — obu tihariho owiiyandiisize, tihariho koodi eriho ey\'okuhandiika — kandi ekiragiro nikitandika kukora ahonaaho omuntu w\'okubanza ku arikubaho. Kizimye kwonka ku oraabe noyetenga kwandiisa omuntu otaine owaamweta, reero bwanyima okigarure.'],

    # Exactly one, so it is a plain row rather than a template -- a
    # "pattern" with no placeholder is just a literal in the wrong table.
    ['1 device currently registered for push alerts.',
     'Ekyuma 1 kati kyewandiisizza okufuna obubaka.',
     'Kifaa 1 kimesajiliwa kwa sasa kupokea arifa.',
     '1 appareil actuellement enregistré pour les alertes.',
     'Igikoresho 1 cyiyandikishije ubu kugira ngo cyakire ubutumwa.',
     'Ekyoma 1 hati kye-yandiisize kutunga obutumwa.'],

    ['Whether recharges and cash-outs run through MarzPay or are handled by hand is set under Manual payments below. Either way, a cash-out waits as Pending until an admin acts on it in the Withdrawals tab.',
     'Oba okuteekamu ssente n\'okuziggyamu biyita mu MarzPay oba bikolebwa n\'engalo kiteekebwa wansi mu Manual payments. Mu ngeri yonna, okuggyamu kulinda nga Kulindiriddwa okutuusa omukulembeze lw\'akukolako ku ttabu lya Okuggyamu.',
     'Kama kuweka na kutoa pesa hupitia MarzPay au hushughulikiwa kwa mkono huwekwa chini kwenye Manual payments. Kwa vyovyote vile, utoaji husubiri kama Unasubiri hadi msimamizi atakaposhughulikia kwenye kichupo cha Utoaji.',
     'Le fait que les recharges et les retraits passent par MarzPay ou soient traités à la main se règle sous Manual payments ci-dessous. Dans les deux cas, un retrait attend En attente jusqu\'à ce qu\'un administrateur s\'en occupe dans l\'onglet Retraits.',
     'Kumenya niba kongeramo no kubikuza binyura kuri MarzPay cyangwa bikorwa n\'intoki bishyirwaho hasi muri Manual payments. Uko byaba biri kose, kubikuza bitegereza nk\'Ubutegereje kugeza umuyobozi abikozeho ku gice cy\'Ukubikuza.',
     'Kworeka ku okuta sente n\'okuzihamu birikuraba omu MarzPay nari bikakorwa n\'engaro nikitebekwa ahansi omu Manual payments. Omu muringo gwoona, okwihamu nikutegyereza nka Kurikutegyerezibwa okuhitsya omwebembezi ku araakukoreho aha kacweka k\'Okwihamu.'],
]

PATTERNS = [
    # The country in the switch at the top -- every one of these renders with a
    # different country name, so {0} is that name and must survive untouched.
    ['Prices, payouts, spins and the opening schedule are saved for {0} — the country in the switch at the top. Names, photos and order are shared by every country.',
     'Ebbeeyi, okusasula, okukyusa n\'enteekateeka y\'okuggulawo bitereka ku {0} — eggwanga eriri mu kakyusa waggulu. Amannya, ebifaananyi n\'entegeka bigabanibwa amawanga gonna.',
     'Bei, malipo, mizunguko na ratiba ya kufungua huhifadhiwa kwa {0} — nchi iliyo kwenye kibadilishi hapo juu. Majina, picha na mpangilio hushirikiwa na kila nchi.',
     'Les prix, les versements, les tours et l\'horaire d\'ouverture sont enregistrés pour {0} — le pays du sélecteur en haut. Les noms, les photos et l\'ordre sont partagés par tous les pays.',
     'Ibiciro, kwishyura, inzunguruka na gahunda yo gufungura bibikwa kuri {0} — igihugu kiri mu guhitamo haruguru. Amazina, amafoto n\'urutonde bisangirwa n\'ibihugu byose.',
     'Ebiihendo, okushashura, okuzunguka n\'entebekanisa y\'okwigura nibibikwa aha {0} — eihanga eriri omu kacwamu haiguru. Amaziina, ebishushani n\'entebekanisa nibigabanwa amahanga goona.'],

    ['Rates, limits, bonuses, payment methods, the announcement dialog and the cash-out window are saved for {0} — the country in the switch at the top. The app name, the domain allowlist, maintenance mode, the opening countdown and every uploaded image apply to every country, and the first four are only editable on {1}.',
     'Emiwendo, ebikomo, ebirabo, engeri z\'okusasula, akabokisi k\'obubaka n\'ekiseera ky\'okuggyamu bitereka ku {0} — eggwanga eriri mu kakyusa waggulu. Erinnya lya app, olukalala lwa domain ezikkirizibwa, embeera y\'okuddaabiriza, okubala okw\'okuggulawo n\'ebifaananyi byonna ebiteekeddwa bikola ku mawanga gonna, era ebisooka bina bikyusibwa ku {1} yokka.',
     'Viwango, mipaka, bonasi, njia za malipo, kisanduku cha tangazo na dirisha la utoaji huhifadhiwa kwa {0} — nchi iliyo kwenye kibadilishi hapo juu. Jina la programu, orodha ya vikoa vinavyoruhusiwa, hali ya matengenezo, hesabu ya kufungua na kila picha iliyopakiwa hutumika kwa kila nchi, na vinne vya kwanza vinaweza kuhaririwa kwenye {1} pekee.',
     'Les taux, les limites, les bonus, les modes de paiement, la boîte d\'annonce et la fenêtre de retrait sont enregistrés pour {0} — le pays du sélecteur en haut. Le nom de l\'application, la liste des domaines autorisés, le mode maintenance, le compte à rebours d\'ouverture et chaque image téléversée s\'appliquent à tous les pays, et les quatre premiers ne sont modifiables que sur {1}.',
     'Ibipimo, imipaka, ibihembo, uburyo bwo kwishyura, akazu k\'itangazo n\'idirishya ryo kubikuza bibikwa kuri {0} — igihugu kiri mu guhitamo haruguru. Izina rya porogaramu, urutonde rw\'amazina yemewe, uburyo bwo gusana, kubara manuka byo gufungura n\'ishusho yose yashyizweho bireba ibihugu byose, kandi bine bya mbere bihinduka gusa kuri {1}.',
     'Emiihendo, ebikomo, ebiconco, emiringo y\'okushashura, akabokisi k\'obutumwa n\'obwire bw\'okwihamu nibibikwa aha {0} — eihanga eriri omu kacwamu haiguru. Eiziina rya puroguramu, orutonde rwa domain ezirikwikirizibwa, omuringo gw\'okugarura, okubara okw\'okwigura n\'ekishushani kyoona ekitairweho nibikora aha mahanga goona, kandi ebya mbere bina nibihindurwa aha {1} kwonka.'],

    ['Move arrivals to another address — {0} only',
     'Twala abajja ku ndagiriro endala — {0} yokka',
     'Hamisha wanaofika kwenda anwani nyingine — {0} pekee',
     'Déplacer les arrivants vers une autre adresse — {0} uniquement',
     'Kwimura abaza ku yindi aderesi — {0} gusa',
     'Twara abarikwija aha ndagiriro endiijo — {0} yonka'],

    ['These codes are for {0} and pay in {1}. Members of other countries cannot claim them. Pick {2} above to cut a code anybody can claim.',
     'Koodi zino za {0} era zisasula mu {1}. Abantu b\'amawanga amalala tebasobola kuzikwata. Londa {2} waggulu okukola koodi buli muntu gy\'asobola okukwata.',
     'Misimbo hii ni ya {0} na hulipa kwa {1}. Wanachama wa nchi nyingine hawawezi kuidai. Chagua {2} hapo juu ili kutengeneza msimbo ambao mtu yeyote anaweza kudai.',
     'Ces codes sont pour {0} et paient en {1}. Les membres d\'autres pays ne peuvent pas les réclamer. Choisissez {2} ci-dessus pour créer un code que tout le monde peut réclamer.',
     'Izi kode ni iz\'u {0} kandi zishyura muri {1}. Abanyamuryango bo mu bindi bihugu ntibashobora kuzisaba. Hitamo {2} haruguru kugira ngo ukore kode umuntu wese ashobora gusaba.',
     'Koodi ezi n\'eza {0} kandi nizishashura omu {1}. Abantu b\'amahanga agandi tibarikubaasa kuzitunga. Cwamu {2} haiguru kugira ngo okore koodi ei buri muntu arikubaasa kutunga.'],

    ['This message will go to {0} members only.',
     'Obubaka buno bujja kugenda eri abantu ba {0} bokka.',
     'Ujumbe huu utaenda kwa wanachama wa {0} pekee.',
     'Ce message ira uniquement aux membres de {0}.',
     'Ubu butumwa buzajya ku banyamuryango bo muri {0} gusa.',
     'Obutumwa obu nibuza kuza ahari abantu ba {0} bonka.'],

    ['If {0} genuinely is your domain, this notice is wrong and you can ignore it.',
     'Bwe kiba nti {0} ye domain yo ey\'amazima, obubaka buno bukyamu era osobola okubulekera awo.',
     'Ikiwa {0} kwa kweli ni kikoa chako, taarifa hii si sahihi na unaweza kuipuuza.',
     'Si {0} est réellement votre domaine, cet avis est faux et vous pouvez l\'ignorer.',
     'Niba {0} koko ari izina ryawe, ubu butumwa ni bubi kandi ushobora kubwirengagiza.',
     'Ku {0} eraabe eri domain yaawe buzima, obutumwa obu tiburikuhikaana kandi nobaasa kubuleka.'],

    ['Set it under Settings → Where the app may be opened from. This panel is on {0}, which says nothing about your members\' domain, so it cannot be filled in for you.',
     'Kiteeke wansi mu Settings → Where the app may be opened from. Ekifo kino kiri ku {0}, ekitategeeza kintu ku domain y\'abantu bo, kale tekisobola kujjuzibwa ku lulwo.',
     'Iweke chini ya Settings → Where the app may be opened from. Paneli hii iko kwenye {0}, ambayo haisemi chochote kuhusu kikoa cha wanachama wako, kwa hivyo haiwezi kujazwa kwa niaba yako.',
     'Réglez-le sous Settings → Where the app may be opened from. Ce panneau est sur {0}, ce qui ne dit rien du domaine de vos membres, il ne peut donc pas être rempli à votre place.',
     'Bishyireho munsi ya Settings → Where the app may be opened from. Iyi paneli iri kuri {0}, bitavuga ikintu ku izina ry\'abanyamuryango bawe, bityo ntibishobora kwuzuzwa mu mwanya wawe.',
     'Kite ahansi omu Settings → Where the app may be opened from. Akacweka aka kari aha {0}, ekitarikugamba kintu aha domain y\'abantu baawe, n\'ahabw\'ekyo tikirikubaasa kwijuzibwa ahabwaawe.'],

    ['Short addresses match no country. They are built as <short name>.{0}, so every one of yours falls back to the founding country — wrong currency, correct passwords refused, referral codes rejected.',
     'Endagiriro ennyimpi tezikwatagana na ggwanga lyonna. Zizimbibwa nga <short name>.{0}, kale buli emu ku zizo edda ku ggwanga erisooka — ssente ez\'ekyamu, ebisumuluzo ebituufu okugaanidwa, koodi z\'okuyita okugaanidwa.',
     'Anwani fupi hazilingani na nchi yoyote. Zinajengwa kama <short name>.{0}, kwa hivyo kila moja yako hurudi kwenye nchi ya kwanza — sarafu isiyo sahihi, manenosiri sahihi kukataliwa, misimbo ya mwaliko kukataliwa.',
     'Les adresses courtes ne correspondent à aucun pays. Elles sont construites comme <short name>.{0}, donc chacune des vôtres retombe sur le pays fondateur — mauvaise devise, mots de passe corrects refusés, codes de parrainage rejetés.',
     'Aderesi ngufi ntizihuye n\'igihugu na kimwe. Zubakwa nka <short name>.{0}, bityo buri imwe muri zawe isubira ku gihugu cya mbere — ifaranga ritari ryo, amagambobanga yiza yanzwe, kode zo gutumira zanzwe.',
     'Endagiriro enguufu tizirikuhikaana n\'eihanga ryoona. Nizyombekwa nka <short name>.{0}, n\'ahabw\'ekyo buri emwe aha zaawe neegaruka aha ihanga ery\'okubanza — sente ezitari zo, ebishumuruzo ebihikire byaangirwe, koodi z\'okweta zaangirwe.'],

    ['{0} devices currently registered for push alerts.',
     'Ebyuma {0} kati byewandiisizza okufuna obubaka.',
     'Vifaa {0} vimesajiliwa kwa sasa kupokea arifa.',
     '{0} appareils actuellement enregistrés pour les alertes.',
     'Ibikoresho {0} byiyandikishije ubu kugira ngo bibone ubutumwa.',
     'Ebyoma {0} hati bye-yandiisize kutunga obutumwa.'],

]
