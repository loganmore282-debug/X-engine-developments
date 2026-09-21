# Round 179c: the COUNTRY EDITOR dialog, which had never been translated
# because nothing ever opened it.
#
# find-admin-untranslated.py walked the Countries TAB and stopped there, so
# every string inside the edit dialog -- all of its field labels, the
# language tickboxes, Round 179's own "Networks this country offers", the
# clock preview -- was reported as neither clean nor missing. It simply was
# never rendered while anything was measuring. Opening the dialog in the
# sweep turned up 23 findings at once; these are them.
#
# The sample values ("g26e, shy", "MTN Mobile Money, Orange Money") are NOT
# here: they are marked data-no-i18n in the markup instead, because an
# example value is data, not copy.
#
# Six columns: English, Luganda, Kiswahili, French, Kinyarwanda, Runyankore.
ROWS = [
    ['Short id',
     'Ekyapa ekitono', 'Kitambulisho kifupi', 'Identifiant court',
     'Indangamuntu ngufi', 'Ekyapa ekikye'],

    ['Country name',
     'Erinnya ly\'ensi', 'Jina la nchi', 'Nom du pays',
     'Izina ry\'igihugu', 'Eiziina ry\'eihanga'],

    ['Currency label',
     'Akabonero ka ssente', 'Lebo ya sarafu', 'Libellé de la devise',
     'Akarango k\'ifaranga', 'Akamanyiso ka sente'],

    ['Dialling code (no +)',
     'Koodi y\'okukuba (awatali +)', 'Msimbo wa kupiga simu (bila +)',
     'Indicatif téléphonique (sans +)', 'Kode y\'ubuhamagara (nta +)',
     'Koodi y\'okuteera (hatariho +)'],

    ['Local number length',
     'Obuwanvu bw\'ennamba y\'omunda', 'Urefu wa namba ya ndani',
     'Longueur du numéro local', 'Uburebure bwa nimero yo mu gihugu',
     'Oburaingwa bwa namba y\'omunda'],

    ['Number starts with',
     'Ennamba etandika ne', 'Namba inaanza na', 'Le numéro commence par',
     'Nimero itangira na', 'Namba nitandika na'],

    ['Clock offset, minutes from UTC — 180 is Uganda and Kenya, 120 is Nigeria +1',
     'Enjawulo y\'essaawa, eddakiika okuva ku UTC — 180 ye Uganda ne Kenya, 120 ye Nigeria +1',
     'Tofauti ya saa, dakika kutoka UTC — 180 ni Uganda na Kenya, 120 ni Nigeria +1',
     'Décalage horaire, en minutes depuis UTC — 180 pour l\'Ouganda et le Kenya, 120 pour le Nigéria +1',
     'Itandukaniro ry\'isaha, iminota uhereye kuri UTC — 180 ni Uganda na Kenya, 120 ni Nigeria +1',
     'Omutaano gw\'eshaaha, edakiika kuruga aha UTC — 180 n\'eya Uganda na Kenya, 120 n\'eya Nigeria +1'],

    ['Languages this country offers',
     'Ennyimba z\'ensi eno ewa', 'Lugha ambazo nchi hii inatoa',
     'Langues proposées par ce pays', 'Indimi iki gihugu gitanga',
     'Endimi eihanga eri nirihayo'],

    ['Opens in',
     'Eggulwa mu', 'Hufunguliwa kwa', 'S\'ouvre en',
     'Ifungurwa mu', 'Nikwigurwa omu'],

    ['Networks this country offers — separate with commas',
     'Netiwaka z\'ensi eno ewa — zaawule na kakodyo',
     'Mitandao ambayo nchi hii inatoa — tenganisha kwa mikato',
     'Réseaux proposés par ce pays — séparez par des virgules',
     'Imiyoboro iki gihugu gitanga — bitandukanye n\'utudomo',
     'Neetiweeki eihanga eri nirihayo — zitaanise na obucweka'],

    ['Save country',
     'Tereka ensi', 'Hifadhi nchi', 'Enregistrer le pays',
     'Bika igihugu', 'Biika eihanga'],

    ['New country',
     'Ensi empya', 'Nchi mpya', 'Nouveau pays',
     'Igihugu gishya', 'Eihanga erisya'],

    ['This is the founding country. Its id cannot change and it cannot be switched off -- it is where any unrecognised address, and any account with no country of its own, lands.',
     'Eno ye nsi esooka. Ekyapa kyayo tekikyusibwa era tesobola kuzikizibwa -- eyo gy\'etuuka endagiriro yonna etamanyiddwa, ne akawunti yonna etalina nsi yaayo.',
     'Hii ni nchi ya msingi. Kitambulisho chake hakibadiliki na haiwezi kuzimwa -- ni pale ambapo anwani yoyote isiyotambulika, na akaunti yoyote isiyo na nchi yake, inafikia.',
     'C\'est le pays fondateur. Son identifiant ne peut pas changer et il ne peut pas être désactivé -- c\'est là qu\'aboutissent toute adresse non reconnue et tout compte sans pays propre.',
     'Iki ni igihugu shingiro. Indangamuntu yacyo ntihinduka kandi ntigishobora guhagarikwa -- ni aho aderesi itazwi iyo ari yo yose, na konti yose idafite igihugu cyayo, igera.',
     'Eri n\'eihanga erikubanza. Ekyapa kyaryo tikirikuhinduka kandi tirikubaasa kuzikizibwa -- niho aderesi yoona etarikumanywa, na akaunti yoona etaine ihanga ryayo, nihikira.'],

    ['Members here get a language button at the top right of the sign-in screen, and a Language row in Account. It is hidden entirely when only one language is ticked — one option is not a choice. "Opens in" is what a phone that has never picked one starts in; it must be one of the ticked languages.Anything not yet translated shows in English rather than in a placeholder, so ticking a language is always safe. Prices, amounts and currency labels are never translated.',
     'Abantu wano bafuna akabatuni k\'olulimi waggulu ku ddyo ku lupapula lw\'okuyingira, n\'olunyiriri lwa Olulimi mu Akawunti. Kikwekebwa bulambalamba nga olulimi lumu lwokka luteekeddwako akabonero — ekilonda kimu si kulonda. "Eggulwa mu" kye ssimu etalondanga lulimi etandika nakyo; kisaana kubeera kimu ku nnyimba eziteekeddwako obubonero.Ekintu kyonna ekitannavvuunulwa kiraga mu Lungereza mu kifo ky\'ekifo ekikalu, kale okuteeka akabonero ku lulimi bulijjo kya bulabe butono. Ebbeeyi, obungi n\'obubonero bwa ssente tebivvuunulwa n\'akatono.',
     'Wanachama hapa wanapata kitufe cha lugha upande wa juu kulia wa skrini ya kuingia, na safu ya Lugha katika Akaunti. Hufichwa kabisa wakati lugha moja pekee imewekwa alama — chaguo moja si uchaguzi. "Hufunguliwa kwa" ni lugha ambayo simu ambayo haijachagua yoyote inaanza nayo; inapaswa kuwa mojawapo ya lugha zilizowekwa alama.Chochote kisichotafsiriwa bado huonyeshwa kwa Kiingereza badala ya nafasi tupu, kwa hivyo kuweka alama kwenye lugha ni salama kila wakati. Bei, viwango na lebo za sarafu hazitafsiriwi kamwe.',
     'Les membres d\'ici obtiennent un bouton de langue en haut à droite de l\'écran de connexion, et une ligne Langue dans Compte. Il est entièrement masqué lorsqu\'une seule langue est cochée — une seule option n\'est pas un choix. « S\'ouvre en » est la langue dans laquelle démarre un téléphone qui n\'en a jamais choisi ; ce doit être l\'une des langues cochées.Tout ce qui n\'est pas encore traduit s\'affiche en anglais plutôt qu\'en espace réservé, donc cocher une langue est toujours sans risque. Les prix, les montants et les libellés de devise ne sont jamais traduits.',
     'Abanyamuryango bo hano babona buto ry\'ururimi hejuru iburyo ku ipaji ryo kwinjira, n\'umurongo w\'Ururimi muri Konti. Rihishwa burundu iyo ururimi rumwe gusa rushyizweho akamenyetso — uburyo bumwe ntabwo ari guhitamo. "Ifungurwa mu" ni ururimi telefoni itarahisemo na rumwe itangirana; rugomba kuba rumwe mu ndimi zashyizweho utumenyetso.Ikintu cyose kitarahindurwa kigaragara mu Cyongereza aho kugaragara nk\'umwanya usa, bityo gushyira akamenyetso ku rurimi buri gihe ntacyo bitwara. Ibiciro, ingano n\'akarango k\'ifaranga ntibihindurwa na rimwe.',
     'Abantu ba hanu nibatunga akabatuni k\'orurimi haiguru aha buryo aha rupapura rw\'okutaaha, n\'orurongo rwa Orurimi omu Akaunti. Nikisherekwa kimwe ku orurimi rumwe rwonka rwateirweho akamanyiso — okucwamu kumwe ti kucwamu. "Nikwigurwa omu" n\'orurimi esimu etarikucwamu rumwe erikutandikamu; rushemereire kuba rumwe aha ndimi ezateirweho obumanyiso.Ekintu kyoona ekitakahindurwa nikyooreka omu Rungyereza omu mwanya gw\'omwanya ogwo busha, n\'ahabw\'ekyo okuta akamanyiso aha rurimi obutoosha nikirungi. Ebiihendo, obwingi n\'obumanyiso bwa sente tibirikuhindurwa na rimwe.'],

    ['Shown on the withdrawal-wallet screen and the deposit network picker for members in this country. Not every country literally has MTN and Airtel -- Cameroon and Cote d\'Ivoire use Orange, Benin uses Moov. Leave blank for a sensible default based on the dialling code (or MTN/Airtel if none is known). At most 8, and a deposit attempt for a network with no active payment numbers configured is refused rather than silently failing.',
     'Kiraga ku lupapula lw\'ensawo y\'okuggyamu ssente n\'akalonda ka netiwaka ez\'okuteekamu ssente ku bantu b\'ensi eno. Si buli nsi erina MTN ne Airtel -- Cameroon ne Cote d\'Ivoire zikozesa Orange, Benin akozesa Moov. Leka awo nga kyereere okufuna eza bulijjo okusinziira ku koodi y\'okukuba (oba MTN/Airtel singa tewali emanyiddwa). Ezisukka mu 8 tezikkirizibwa, era okugezaako okuteekamu ssente ku netiwaka etalina nnamba z\'okusasula ezikola kigaanibwa mu kifo ky\'okugwa mu kasirise.',
     'Huonyeshwa kwenye skrini ya pochi ya utoaji na kichagua mtandao wa amana kwa wanachama wa nchi hii. Si kila nchi ina MTN na Airtel -- Kameruni na Cote d\'Ivoire zinatumia Orange, Benin inatumia Moov. Acha wazi ili kupata chaguo-msingi linalofaa kulingana na msimbo wa kupiga simu (au MTN/Airtel ikiwa hakuna inayojulikana). Zaidi ya 8 hazikubaliki, na jaribio la amana kwa mtandao usio na namba za malipo zinazofanya kazi hukataliwa badala ya kushindwa kimyakimya.',
     'Affiché sur l\'écran du portefeuille de retrait et dans le sélecteur de réseau de dépôt pour les membres de ce pays. Tous les pays n\'ont pas MTN et Airtel -- le Cameroun et la Côte d\'Ivoire utilisent Orange, le Bénin utilise Moov. Laissez vide pour une valeur par défaut déduite de l\'indicatif (ou MTN/Airtel si aucun n\'est connu). Huit au maximum, et une tentative de dépôt sur un réseau sans numéro de paiement actif est refusée au lieu d\'échouer silencieusement.',
     'Bigaragara ku ipaji ry\'umufuka wo kubikuza no muri guhitamo umuyoboro wo kubitsa ku banyamuryango b\'iki gihugu. Ntabwo igihugu cyose gifite MTN na Airtel -- Kameruni na Cote d\'Ivoire bakoresha Orange, Benin ikoresha Moov. Siga ubusa kugira ngo uhabwe agaciro fatizo gishingiye kuri kode y\'ubuhamagara (cyangwa MTN/Airtel nta kimenyerewe). Birenze 8 ntibyemewe, kandi kugerageza kubitsa ku muyoboro udafite nimero z\'ubwishyu zikora byangwa aho kunanirwa mu bucecekere.',
     'Nikireeberwa aha rupapura rw\'ensaho y\'okwihamu sente n\'aha kacwamu ka neetiweeki z\'okuta sente ahabw\'abantu b\'eihanga eri. Ti buri ihanga riine MTN na Airtel -- Cameroon na Cote d\'Ivoire nizikoresa Orange, Benin nikoresa Moov. Reka ahoo busha kutunga ezi z\'obutoosha okurugiirira aha koodi y\'okuteera (nari MTN/Airtel ku hataine erikumanywa). Ezirikukira aha 8 tizirikwikirizibwa, kandi okugyezaho okuta sente aha neetiweeki etaine namba z\'okushashura ezirikukora nikwangirwa omu mwanya gw\'okugwa kicuucu.'],
]

PATTERNS = [
    # {0} is a country name, {1}/{0} a domain, a time or a button label --
    # every one of them data that must cross a translation untouched.
    ['Edit {0}',
     'Kyusa {0}', 'Hariri {0}', 'Modifier {0}', 'Hindura {0}', 'Hindura {0}'],

    ['Short addresses — just the bit in front of {0}',
     'Endagiriro empimpi — katundu akali mu maaso wa {0}',
     'Anwani fupi — sehemu iliyo mbele ya {0}',
     'Adresses courtes — juste la partie devant {0}',
     'Aderesi ngufi — igice kiri imbere ya {0}',
     'Aderesi nkye — akacweka akari omu maisho ya {0}'],

    ['Full web addresses, one per line — only for a domain that is not {0}',
     'Endagiriro z\'omukutu enzijjuvu, emu ku lunyiriri — za domain etali {0} zokka',
     'Anwani kamili za wavuti, moja kwa mstari — kwa kikoa ambacho si {0} pekee',
     'Adresses web complètes, une par ligne — uniquement pour un domaine autre que {0}',
     'Aderesi zuzuye za interineti, imwe ku murongo — gusa ku izina ritari {0}',
     'Aderesi z\'omutandaao ezijwire, emwe aha murongo — ahabwa domain etari {0} yonka'],

    ['Each one becomes {0}. Separate several with commas. Use {1} on the list to have one generated for you.',
     'Buli emu efuuka {0}. Zaawule ezisukka mu emu na kakodyo. Kozesa {1} ku lukalala okukolerwa emu.',
     'Kila moja inakuwa {0}. Tenganisha kadhaa kwa mikato. Tumia {1} kwenye orodha ili moja itengenezwe kwako.',
     'Chacune devient {0}. Séparez-en plusieurs par des virgules. Utilisez {1} dans la liste pour en faire générer une.',
     'Buri imwe iba {0}. Tandukanya nyinshi n\'utudomo. Koresha {1} ku rutonde kugira ngo imwe ikorwe.',
     'Buri emwe neehinduka {0}. Taanisa nyingi na obucweka. Koresa {1} aha rutonde kugira ngo emwe ekorwe.'],

    ['A member opening any of these sees this country\'s currency and prices. They are allowed to reach the backend automatically, so there is nothing to add to the domain allowlist. DNS still has to point them at the app — a wildcard record for {0} makes every short address work the moment it is saved.',
     'Omuntu aggula yonna ku zino alaba ssente n\'ebbeeyi z\'ensi eno. Zikkirizibwa okutuuka ku sseva zokka, kale tewali kya kwongera ku lukalala lwa domain ezikkirizibwa. DNS kyetaaga okuzoolesa ku app — ekiwandiiko kya wildcard ekya {0} kikola endagiriro empimpi zonna amangu ddu nga zitereke.',
     'Mwanachama anayefungua yoyote ya hizi anaona sarafu na bei za nchi hii. Zinaruhusiwa kufikia seva kiotomatiki, kwa hivyo hakuna kitu cha kuongeza kwenye orodha ya vikoa vinavyoruhusiwa. DNS bado inapaswa kuzielekeza kwenye programu — rekodi ya wildcard ya {0} hufanya kila anwani fupi ifanye kazi mara tu inapohifadhiwa.',
     'Un membre qui ouvre l\'une d\'elles voit la devise et les prix de ce pays. Elles sont autorisées à joindre le serveur automatiquement, il n\'y a donc rien à ajouter à la liste des domaines autorisés. Le DNS doit tout de même les diriger vers l\'application — un enregistrement joker pour {0} fait fonctionner chaque adresse courte dès son enregistrement.',
     'Umunyamuryango ufungura imwe muri izi abona ifaranga n\'ibiciro by\'iki gihugu. Zemerewe kugera kuri seriveri mu buryo bwikora, bityo nta kintu cyo kongera ku rutonde rw\'amazina yemewe. DNS igomba kuzerekeza kuri porogaramu — inyandiko ya wildcard ya {0} ituma aderesi ngufi yose ikora ako kanya ibitswe.',
     'Omuntu orikwigura emwe aha ezi nareeba sente n\'ebiihendo by\'eihanga eri. Nizikirizibwa kuhikira seeva zonka, n\'ahabw\'ekyo tihariho kyakwongyera aha rutonde rwa domain ezirikwikirizibwa. DNS neetenga kuzooreka aha puroguramu — ekihandiiko kya wildcard eky\'{0} nikikora aderesi nkye zoona ahonaaho obu zibiikirwe.'],

    ['It is {0} in this country right now ({1}).',
     'Kati essaawa mu nsi eno ye {0} ({1}).',
     'Sasa ni {0} katika nchi hii ({1}).',
     'Il est {0} dans ce pays en ce moment ({1}).',
     'Ubu ni {0} muri iki gihugu ({1}).',
     'Hati n\'{0} omu ihanga eri ({1}).'],
]
