#!/usr/bin/env python3
"""Batch 8 of the admin panel's string table: the OPERATOR INSTRUCTIONS, part 1.

Owner: "even in admin panel, whether instructions, settings, sentences ...
everything should change language".

These are the long help paragraphs under the Settings, Countries, Deposits and
Promo-code controls. Until Round 172 none of them could be translated at all:
most were sentences that inline markup (<b>, <code>) had broken into pieces no
row could match, and the rest were longer than the engine would look at. The
block pass and the panel's raised cap fixed the mechanism; these are the words.

A NOTE WORTH READING BEFORE RELYING ON THESE. The three Bantu columns want a
native speaker's eye here more than anywhere else in this project. Elsewhere a
rough translation costs a member a moment's confusion; these are instructions
about DNS records, payment gateways and money settings, and an admin acting on
a mistranslated one can misconfigure the platform. Every correction is one
cell, and nothing else moves.

Product names, brand names (MarzPay, LipaPay, PesaJet, Render, EdgeOne,
YouTube, Android), file formats and dimensions are left as they are.

[english, lg, sw, fr, rw, nyn]
"""
ROWS = [
    ['Each browser/installed-app registers itself when you tap "Notify" up top -- a device can occasionally end up registered twice (e.g. after a browser update rotates its token), which shows up as the same alert arriving more than once on one phone.',
     'Buli bbulawuza oba app eyateekebwawo yeewandiisa bw\'okuba nga onyiga "Manyisa" waggulu -- oluusi ekyuma kiyinza okwewandiisa emirundi ebiri (ng\'ekyokulabirako, bbulawuza bw\'efuna enkyukakyuka), ekiraga ng\'obubaka bwe bumu butuuka emirundi mingi ku ssimu emu.',
     'Kila kivinjari au programu iliyosakinishwa hujisajili unapogusa "Arifa" hapo juu -- wakati mwingine kifaa kinaweza kujisajili mara mbili (mfano baada ya kivinjari kusasishwa na tokeni kubadilika), jambo linaloonekana kama arifa ile ile kufika zaidi ya mara moja kwenye simu moja.',
     'Chaque navigateur ou application installée s\'enregistre lorsque vous touchez "Notifier" en haut -- un appareil peut parfois se retrouver enregistré deux fois (par exemple après une mise à jour du navigateur qui change son jeton), ce qui se voit quand la même alerte arrive plusieurs fois sur un seul téléphone.',
     'Buri mushakisha cyangwa porogaramu yashyizweho yiyandikisha iyo ukanze "Menyesha" haruguru -- rimwe na rimwe igikoresho gishobora kwiyandikisha kabiri (urugero nyuma y\'uko umushakisha uvugururwa ugahindura ikimenyetso cyacyo), bikagaragara nk\'ubutumwa bumwe bugera kuri telefoni imwe inshuro nyinshi.',
     'Buri buraawuza nari puroguramu eyataireho neeyandiisa waaba nokanda "Manyisa" haiguru -- obumwe ekyoma nikibaasa kwe-yandiisa emirundi ebiri (nk\'oku buraawuza erikuhinduka), ekirikworeka obutumwa bumwe nibuhika emirundi mingi aha nyabarugo emwe.'],

    ['A daily free spin for every member, plus extra spins earned by buying products. Winnings are credited straight to the wallet and show under the Turntable tab of Balance Record.',
     'Okukyusa kwa buli lunaku okw\'obwereere eri buli muntu, n\'okukyusa okulala okufunibwa nga bagula ebyamaguzi. Ssente ezifunibwa ziteekebwa butereevu mu nsawo era zirabika ku ttabu lya Kanyoolera mu Kyapa ky\'Ssente.',
     'Mzunguko wa bure kila siku kwa kila mwanachama, pamoja na mizunguko ya ziada inayopatikana kwa kununua bidhaa. Ushindi huwekwa moja kwa moja kwenye pochi na huonekana chini ya kichupo cha Gurudumu kwenye Rekodi ya Salio.',
     'Un tour gratuit par jour pour chaque membre, plus des tours supplémentaires gagnés en achetant des produits. Les gains sont crédités directement au portefeuille et apparaissent sous l\'onglet Roue du Relevé de solde.',
     'Uruziga rw\'ubuntu buri munsi kuri buri munyamuryango, hiyongeraho izindi nzunguruka zibonwa mu kugura ibicuruzwa. Ibyatsindiwe bishyirwa ako kanya mu ikofi kandi bigaragara mu gice cy\'Uruziga rw\'Inyandiko y\'Amafaranga.',
     'Okuzunguka kw\'obusa buri izooba ahari buri mwanamuryango, hamwe n\'okuzunguka okundi okurikutungwa omu kugura ebyamaguzi. Sente ezitungirwe nizita omu nsaho ahonaaho kandi nizireeberwa omu kacweka ka Kanyoolera omu Kyapa kya Sente.'],

    ['A member is assigned one of these round-robin the moment Manual is active above -- give each one a real holder name, it\'s shown to the member so they know who they\'re sending to.',
     'Omuntu aweebwa emu ku zino nga bakwatagana bwe bati amangu ddala nga Manual eri nga ekola waggulu -- buli emu giwe erinnya lya nannyini yo ery\'amazima, kubanga liraga omuntu asindika asobole okumanya gw\'asindikira.',
     'Mwanachama hupewa mojawapo ya hizi kwa zamu mara tu Manual inapowashwa hapo juu -- kila moja ipe jina halisi la mmiliki, kwa sababu mwanachama huliona ili ajue anamtumia nani.',
     'Un membre se voit attribuer l\'un de ces numéros à tour de rôle dès que Manuel est actif ci-dessus -- donnez à chacun un vrai nom de titulaire, il est montré au membre pour qu\'il sache à qui il envoie.',
     'Umunyamuryango ahabwa kimwe muri ibi ku buryo bukurikirana ako kanya iyo Manual ikoresheje haruguru -- buri kimwe ugihe izina nyaryo rya nyiracyo, kuko umunyamuryango arirebera amenye uwo yoherereza.',
     'Omuntu naaheebwa emwe aha ezi nk\'oku zirikukuratana obu Manual erikukora haiguru -- buri emwe ogihe eiziina rya nyineyo eriyo buzima, ahakuba omuntu naaryereeba amanye ou arikutumira.'],

    ['A request above the max amount is skipped and left Pending for you to approve by hand. It does not block smaller requests behind it in the queue. Set to 0 to auto-approve every amount.',
     'Okusaba okusukka ku muwendo ogusinga obunene kubuukibwa ne kulekebwa nga Kulindiriddwa osobole okukukkiriza n\'engalo. Tekuziyiza kusaba okutono okuli emabega waakwo mu lunyiriri. Teeka ku 0 okukkiriza buli muwendo mu bwengula.',
     'Ombi linalozidi kiasi cha juu huachwa na kubaki Linasubiri ili uliidhinishe kwa mkono. Halizuii maombi madogo yaliyo nyuma yake kwenye foleni. Weka 0 ili kuidhinisha kila kiasi kiotomatiki.',
     'Une demande supérieure au montant maximum est ignorée et laissée En attente pour que vous l\'approuviez à la main. Elle ne bloque pas les demandes plus petites derrière elle dans la file. Mettez 0 pour approuver automatiquement tout montant.',
     'Ubusabe burenze umubare ntarengwa burasimburwa bugasigara ku Butegereje kugira ngo ubwemeze n\'intoki. Ntibubuza ubusabe buto buri inyuma yabwo ku murongo. Shyira 0 kugira ngo buri mubare wemezwe wenyine.',
     'Okushaba okurikukira omuhendo ogurikukira kubaasa nikubuukwa kikasigara nka Kirikutegyerezibwa kugira ngo okyikirize n\'engaro. Tikirikuzibira okushaba okukye okuri enyima yaakyo omu murongo. Ta aha 0 kugira ngo buri muhendo gwikirizibwe gwenka.'],

    ['A YouTube link will not work. The app would fetch YouTube\'s web page, not a video, so the banner would sit blank — and a YouTube player cannot be silenced, untapped or made to autoplay reliably. Download the clip as MP4 and upload it here instead.',
     'Ekkubo lya YouTube terikola. App yandinzeeko olupapula lwa YouTube, si vidiyo, kale akabaawo kandisigadde nga kalimu bbwereere — ate YouTube tesobola kusirisibwa, kulekebwa nga tekakwatibwa, oba okukola yokka bulijjo. Kkakkanya vidiyo nga MP4 ogiteeke wano.',
     'Kiungo cha YouTube hakitafanya kazi. Programu ingepakua ukurasa wa wavuti wa YouTube, si video, kwa hivyo bango lingebaki tupu — na kicheza cha YouTube hakiwezi kunyamazishwa, kuzuiwa kuguswa, wala kuchezeshwa chenyewe kwa uhakika. Pakua klipu kama MP4 kisha uipakie hapa badala yake.',
     'Un lien YouTube ne fonctionnera pas. L\'application chargerait la page web de YouTube, pas une vidéo, donc la bannière resterait vide — et un lecteur YouTube ne peut pas être mis en sourdine, rendu intouchable ni lancé automatiquement de façon fiable. Téléchargez le clip en MP4 et déposez-le ici à la place.',
     'Umurongo wa YouTube ntuzakora. Porogaramu yaza gufata urupapuro rwa YouTube, atari videwo, bityo ikirango kikaguma ubusa — kandi igikinisho cya YouTube ntigishobora guceceka, kudakandwa, cyangwa gutangira cyonyine mu buryo bwizewe. Manura videwo nka MP4 uyishyire hano ahubwo.',
     'Omuhanda gwa YouTube tigurikukora. Puroguramu yakugyendiire orupapura rwa YouTube, ti vidiyo, n\'ahabw\'ekyo ekirango kyakusigaire kiri busha — kandi ekizaanisa kya YouTube tikirikubaasa kusirisibwa, kutakwatwa, nari kwetandika kyonka buzima. Ihura vidiyo nka MP4 ogite hanu omu mwanya gw\'ekyo.'],

    ['Addresses that must never serve the app, on top of the root domain. Your Render and EdgeOne addresses are permanently exempt, so a mistake here cannot lock you out of this panel.',
     'Endagiriro ezitateekwa kuweereza app, okwongera ku root domain. Endagiriro zo eza Render ne EdgeOne tezikwatibwa n\'akatono, kale ensobi wano teyinza kukuggalirawo bweru w\'ekifo kino.',
     'Anwani ambazo hazipaswi kamwe kuhudumia programu, zaidi ya kikoa cha msingi. Anwani zako za Render na EdgeOne zimesamehewa kabisa, kwa hivyo kosa hapa haliwezi kukufungia nje ya paneli hii.',
     'Adresses qui ne doivent jamais servir l\'application, en plus du domaine racine. Vos adresses Render et EdgeOne en sont exemptées de façon permanente, donc une erreur ici ne peut pas vous enfermer dehors de ce panneau.',
     'Aderesi zitagomba na rimwe gutanga porogaramu, hiyongereye ku izina ry\'urufatiro. Aderesi zawe za Render na EdgeOne zisonewe burundu, bityo ikosa hano ntirishobora kugukumira kuri iyi paneli.',
     'Endagiriro ezitashemereire kuheereza puroguramu, hamwe na root domain. Endagiriro zaawe eza Render na EdgeOne tizirikukwatwa, n\'ahabw\'ekyo ekishobi hanu tikirikubaasa kukuzibira kutaaha omu kacweka aka.'],

    ['Both thumbnails sit on a checkerboard, so you can see straight away whether the background really came off. Only background touching the EDGE of the picture is removed — black inside the artwork, an outline or dark lettering, is left alone. Untick the box to upload a logo exactly as it is.',
     'Ebifaananyi byombi ebitono biteekebwa ku kibaawo eky\'ebibbo, osobole okulaba amangu oba emabega lyagenda ddala. Emabega erikwata ku MABBALI g\'ekifaananyi lyokka lye liggyibwako — enzirugavu eri munda mu kifaananyi, olukoloboze oba ennukuta enzirugavu, tebikwatibwako. Ggyako akabokisi okuteeka ekifaananyi nga bwe kiri.',
     'Picha zote mbili ndogo huwekwa kwenye ubao wa cheki, ili uone mara moja kama mandharinyuma yaliondoka kweli. Ni mandharinyuma yanayogusa PEMBEZONI mwa picha pekee yanayoondolewa — weusi ulio ndani ya mchoro, mstari au herufi nyeusi, huachwa. Ondoa alama kwenye kisanduku ili kupakia nembo kama ilivyo.',
     'Les deux vignettes reposent sur un damier, pour que vous voyiez tout de suite si le fond est vraiment parti. Seul le fond qui touche le BORD de l\'image est retiré — le noir à l\'intérieur du dessin, un contour ou des lettres sombres, est laissé tel quel. Décochez la case pour téléverser un logo exactement tel qu\'il est.',
     'Amashusho yombi mato ashyirwa ku kibaho gifite utubariro, kugira ngo ubone ako kanya niba inyuma koko yavuyeho. Gusa inyuma ikora ku MPERA y\'ishusho ni yo ikurwaho — umukara uri imbere mu gishushanyo, umurongo cyangwa inyuguti zijimye, bisigara uko biri. Kuraho akamenyetso kugira ngo ushyire ikirango uko kimeze.',
     'Ebishushani byombi ebikye nibitebekwa aha kibaaho eky\'ebibaati, kugira ngo oreebe ahonaaho yaaba enyima ekagyendaho buzima. Ni enyima erikukwata aha MPERA y\'ekishushani yonka erikwihwaho — omukara oguri omunda y\'ekishushani, orurongo nari ebihandiiko ebikwatsiire, nibisigara. Ihaho akabokisi kugira ngo oteeho ekirango nk\'oku kiri.'],

    ['Build the About page as an ordered list of blocks. Add as many text blocks and images as you like, in any order (an image doesn\'t need to follow every paragraph, and you can skip images entirely). Members see each block animate in as they scroll down.',
     'Zimba olupapula lwa Ebikwata Ku Ffe ng\'olukalala lw\'ebitundu olutegekeddwa. Yongerako ebitundu by\'ebiwandiiko n\'ebifaananyi nga bw\'oyagala, mu nteekateeka yonna (ekifaananyi tekyetaagisa kugoberera buli katundu, era osobola obutateekamu bifaananyi n\'akamu). Abantu balaba buli katundu nga kajja nga baserengeta.',
     'Jenga ukurasa wa Kutuhusu kama orodha ya vipande iliyopangwa. Ongeza vipande vya maandishi na picha kadri utakavyo, kwa mpangilio wowote (picha si lazima ifuate kila aya, na unaweza kuacha picha kabisa). Wanachama huona kila kipande kikijitokeza wanaposogeza chini.',
     'Construisez la page À propos comme une liste ordonnée de blocs. Ajoutez autant de blocs de texte et d\'images que vous voulez, dans n\'importe quel ordre (une image n\'a pas besoin de suivre chaque paragraphe, et vous pouvez ne mettre aucune image). Les membres voient chaque bloc apparaître en faisant défiler.',
     'Ubaka urupapuro rwa Ibyerekeye nk\'urutonde rutondekanyije rw\'ibice. Ongeraho ibice by\'inyandiko n\'amashusho uko ushaka, mu buryo ubwo ari bwo bwose (ishusho ntigomba gukurikira buri gika, kandi ushobora kutayishyiramo na gato). Abanyamuryango babona buri gice kigaragara mu gihe bamanuka.',
     'Ombeka orupapura rwa Ebirikutukwataho nk\'orutonde rw\'ebicweka orutebekanisiibwe. Ongyeraho ebicweka by\'ebihandiiko n\'ebishushani nk\'oku orikwenda, omu ntebekanisa yoona (ekishushani tikirikwetenga kukuratira buri kacweka, kandi nobaasa kutata bishushani). Abantu nibareeba buri kacweka nikaija ku barikwikiriza ahansi.'],

    ['By default payouts follow PAY A\'s own automatic gateway above. Pin them here if you want the two directions to differ, for example manual recharges with PesaJet payouts, or the reverse.',
     'Mu butonde, okusasula kugoberera omulyango gwa PAY A ogwekolera gwokka waggulu. Gukwatirire wano bw\'oba oyagala amakubo gombi okwawukana, ng\'ekyokulabirako okuteekamu ssente n\'engalo n\'okusasula okuyita mu PesaJet, oba ekinaakyo.',
     'Kwa kawaida malipo hufuata lango la kiotomatiki la PAY A hapo juu. Yabandike hapa ikiwa unataka pande hizo mbili zitofautiane, mfano kuweka pesa kwa mkono na malipo kupitia PesaJet, au kinyume chake.',
     'Par défaut, les versements suivent la passerelle automatique de PAY A ci-dessus. Fixez-les ici si vous voulez que les deux sens diffèrent, par exemple des recharges manuelles avec des versements PesaJet, ou l\'inverse.',
     'Mu buryo busanzwe, kwishyura bikurikira irembo ryikora rya PAY A haruguru. Bihambire hano niba ushaka ko impande zombi zitandukana, urugero kongeramo amafaranga n\'intoki hamwe no kwishyura binyuze kuri PesaJet, cyangwa ibinyuranye.',
     'Omu muringo ogusangwa, okushashura nikukuratira omuryango gwa PAY A ogurikwekorera haiguru. Gukwatirire hanu ku orikwenda emihanda yombi kwahukana, nk\'eky\'okureeberaho okuta sente n\'engaro hamwe n\'okushashura kurabire aha PesaJet, nari ekinaakyo.'],

    ['Each claim rolls its own random reward between min and max (down to the cent) -- one person might get 123.39, another 234.89. Set min and max the same for a fixed reward instead. Leave expiry blank for a code that never expires.',
     'Buli kukwata kufuna empeera yaakwo ey\'okulonda wakati wa min ne max (okutuuka ku ssente entono) -- omuntu omu ayinza okufuna 123.39, omulala 234.89. Teeka min ne max okuba omuwendo gwe gumu okufuna empeera etakyuka. Leka ekiseera eky\'okukoma nga kyereere ku koodi etakoma.',
     'Kila dai hujichagulia zawadi yake kwa nasibu kati ya kiwango cha chini na cha juu (hadi senti) -- mtu mmoja anaweza kupata 123.39, mwingine 234.89. Weka kiwango cha chini na cha juu sawa ili kupata zawadi isiyobadilika. Acha tarehe ya mwisho wazi kwa msimbo usioisha.',
     'Chaque réclamation tire sa propre récompense au hasard entre le minimum et le maximum (au centime près) -- une personne peut recevoir 123,39, une autre 234,89. Mettez le minimum et le maximum identiques pour une récompense fixe. Laissez l\'expiration vide pour un code qui n\'expire jamais.',
     'Buri gusaba bifata igihembo cyabyo ku buryo butunguranye hagati y\'umubare muto n\'umunini (kugeza ku isantime) -- umuntu umwe ashobora kubona 123,39, undi 234,89. Shyira umubare muto n\'umunini bingana kugira ngo igihembo gihame. Reka itariki yo kurangira ubusa kugira ngo kode itarangira.',
     'Buri kushaba nikutunga empeera yaakwo ey\'okucwamu ahagati ya min na max (okuhika aha sente enkye) -- omuntu omwe naabaasa kutunga 123.39, ondiijo 234.89. Ta min na max kuba emwe kugira ngo empeera ehame. Reka obwire bw\'okuhweraho buri busha ahari koodi etarikuhwaho.'],

    ['Each member gets one free spin per day, resetting at midnight (EAT). The win is a random amount between these two. Set them to the SAME number for a fixed amount every time.',
     'Buli muntu afuna okukyusa kumu okw\'obwereere buli lunaku, nga kuzzibwawo mu ttumbi (EAT). Ekiwangulwa muwendo gwa kulonda wakati w\'ebino byombi. Bitereeze ku muwendo GWE GUMU okufuna omuwendo ogutakyuka buli mulundi.',
     'Kila mwanachama hupata mzunguko mmoja wa bure kwa siku, unaoanza upya usiku wa manane (EAT). Ushindi ni kiasi cha nasibu kati ya hivi viwili. Viweke kwenye namba ILE ILE ili kupata kiasi kisichobadilika kila mara.',
     'Chaque membre reçoit un tour gratuit par jour, remis à zéro à minuit (EAT). Le gain est un montant tiré au hasard entre ces deux valeurs. Mettez-les au MÊME nombre pour un montant fixe à chaque fois.',
     'Buri munyamuryango ahabwa uruziga rumwe rw\'ubuntu ku munsi, rusubira ku busa mu gicuku (EAT). Igihembo ni umubare utunguranye hagati y\'iyi mibare ibiri. Uyishyire ku mubare UMWE kugira ngo igihembo gihore kimwe.',
     'Buri muntu naatunga okuzunguka kumwe okw\'obusa buri izooba, nikugarukamu omu kiro (EAT). Eki arikutunga n\'omuhendo gw\'okucwamu ahagati y\'ebi byombi. Bite aha muhendo OGWO GWONKA kugira ngo omuhendo gube gumwe buri mwanya.'],

    ['Every country\'s short address is built from this — g26e becomes g26e.<base domain>. Set the short names per country on the Countries tab.',
     'Endagiriro ennyimpi eya buli ggwanga ezimbibwa okuva ku eno — g26e efuuka g26e.<base domain>. Teeka amannya amampi buli ggwanga ku ttabu lya Amawanga.',
     'Anwani fupi ya kila nchi hujengwa kutoka hapa — g26e inakuwa g26e.<base domain>. Weka majina mafupi kwa kila nchi kwenye kichupo cha Nchi.',
     'L\'adresse courte de chaque pays est construite à partir de ceci — g26e devient g26e.<base domain>. Définissez les noms courts par pays dans l\'onglet Pays.',
     'Aderesi ngufi ya buri gihugu yubakwa kuri iyi — g26e iba g26e.<base domain>. Shyiraho amazina magufi kuri buri gihugu ku gice cy\'Ibihugu.',
     'Endagiriro enguufu ya buri ihanga neyombekwa kuruga aha egi — g26e neehinduka g26e.<base domain>. Ta amaziina amaguufu aha buri ihanga omu kacweka k\'Amahanga.'],

    ['Final payment screen (COPY & PAY code screen)',
     'Olupapula olusembayo olw\'okusasula (olupapula lwa KOPPA & SASULA)',
     'Skrini ya mwisho ya malipo (skrini ya NAKILI & LIPA)',
     'Écran de paiement final (écran du code COPIER & PAYER)',
     'Ipaji rya nyuma ryo kwishyura (ipaji rya kode KOPORA & WISHYURE)',
     'Orupapura orw\'aha muheru orw\'okushashura (orupapura rwa KOPA & SHASHURA)'],

    ['Payment method screen (network/phone selector)',
     'Olupapula olw\'engeri y\'okusasula (okulonda netiwaka/essimu)',
     'Skrini ya njia ya malipo (kichagua mtandao/simu)',
     'Écran du mode de paiement (choix du réseau et du téléphone)',
     'Ipaji ry\'uburyo bwo kwishyura (guhitamo urusobe/telefoni)',
     'Orupapura orw\'omuringo gw\'okushashura (okucwamu neetiweeki/esimu)'],
]
