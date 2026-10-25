#!/usr/bin/env python3
"""Batch 3 of the admin panel's own string table: artwork and countries.

The Appearance cards (every uploadable picture), and the Countries tab.
[english, lg, sw, fr, rw, nyn]
"""
ROWS = [
    # ── appearance / artwork ──
    ['Appearance', 'Endabika', 'Muonekano', 'Apparence', 'Isura', 'Endeebeka'],
    ['App icon', 'Akabonero ka pulogulaamu', 'Aikoni ya programu', 'Icône de l\'application', 'Ikimenyetso cya porogaramu', 'Ekimanyiso kya porogaraamu'],
    ['Brand logo', 'Akabonero k\'ekika', 'Nembo ya chapa', 'Logo de la marque', 'Ikirango cy\'ikirangantego', 'Ekimanyiso ky\'eiziina'],
    ['Brand gradient', 'Langi ez\'ekika', 'Rangi za chapa', 'Dégradé de la marque', 'Amabara y\'ikirangantego', 'Amarangi g\'eiziina'],
    ['Plain white', 'Ekyeru kyereere', 'Nyeupe tupu', 'Blanc uni', 'Umweru gusa', 'Ekyeru kyonka'],
    ['Default artwork', 'Ekifaananyi ekitongole', 'Mchoro wa chaguo-msingi', 'Illustration par défaut', 'Ishusho isanzwe', 'Ekishushani ekitairweho'],
    ['Built-in Chipz icon', 'Akabonero ka Chipz akaliwo dda', 'Aikoni ya Chipz iliyojengwa ndani', 'Icône Chipz intégrée', 'Ikimenyetso cya Chipz kiri imbere', 'Ekimanyiso kya Chipz ekiriyo'],
    ['Home banner', 'Ekifaananyi eky\'oku lupapula olusooka', 'Bango la ukurasa wa nyumbani', 'Bannière d\'accueil', 'Ibendera ry\'urupapuro rw\'ahabanza', 'Ekishushani eky\'aha rupapura rw\'omuka'],
    ['Home spin banner', 'Ekifaananyi ky\'nnamuziga ku lupapula olusooka', 'Bango la gurudumu la ukurasa wa nyumbani', 'Bannière de la roue sur l\'accueil', 'Ibendera ry\'uruziga ku rupapuro rw\'ahabanza', 'Ekishushani ky\'orupiira aha rupapura rw\'omuka'],
    ['Referral banner', 'Ekifaananyi ky\'okuyita', 'Bango la mialiko', 'Bannière de parrainage', 'Ibendera ryo gutumira', 'Ekishushani ky\'okweta'],
    ['Help Centre banner', 'Ekifaananyi ky\'ekifo ky\'obuyambi', 'Bango la kituo cha usaidizi', 'Bannière du centre d\'aide', 'Ibendera ry\'ikigo cy\'ubufasha', 'Ekishushani ky\'ekicweka ky\'obuhwezi'],
    ['Home announcement dialog', 'Ekiwandiiko ky\'amawulire ku lupapula olusooka', 'Kidirisha cha tangazo la ukurasa wa nyumbani', 'Fenêtre d\'annonce sur l\'accueil', 'Idirishya ry\'itangazo ku rupapuro rw\'ahabanza', 'Ekibaasa ky\'amakuru aha rupapura rw\'omuka'],
    ['Download screen background', 'Ekifaananyi eky\'emabega ku lupapula lw\'okudaunloodinga', 'Mandhari ya skrini ya kupakua', 'Fond de l\'écran de téléchargement', 'Mbuganyuma y\'urupapuro rwo kumanura', 'Ekishushani ky\'enyima aha rupapura rw\'okuteekyera'],
    ['Profile animation', 'Ekifaananyi ekitambula ku profayiro', 'Uhuishaji wa wasifu', 'Animation du profil', 'Ishusho inyeganyega ku mwirondoro', 'Ekishushani ekirikugyenda aha profairo'],
    ['Link preview', 'Ekifaananyi ky\'ekinywanyizo', 'Muhtasari wa kiungo', 'Aperçu du lien', 'Incamake y\'umurongo', 'Ekishushani ky\'omukwate'],
    ['Manual payment screen images', 'Ebifaananyi by\'olupapula lw\'okusasula n\'emikono', 'Picha za skrini ya malipo ya mkono', 'Images de l\'écran de paiement manuel', 'Amashusho y\'urupapuro rwo kwishyura intoki', 'Ebishushani by\'orupapura rw\'okushashura n\'emikono'],
    ['Login & Sign Up screen', 'Olupapula lw\'okuyingira n\'okwewandiisa', 'Skrini ya kuingia na kujisajili', 'Écran de connexion et d\'inscription', 'Urupapuro rwo kwinjira no kwiyandikisha', 'Orupapura rw\'okutaaha n\'okwehandiisa'],
    ['1. Top band (behind the CHIPZ logo)', '1. Omusipi ogw\'awaggulu (emabega w\'akabonero ka CHIPZ)', '1. Ukanda wa juu (nyuma ya nembo ya CHIPZ)', '1. Bandeau du haut (derrière le logo CHIPZ)', '1. Umukandara wo hejuru (inyuma y\'ikirango cya CHIPZ)', '1. Omukyeeka ogw\'ahaiguru (enyima y\'ekimanyiso kya CHIPZ)'],
    ['2. The form card (behind the fields)', '2. Kaadi y\'ebibuuzo (emabega w\'ebifo ebijjuzibwa)', '2. Kadi ya fomu (nyuma ya sehemu za kuandika)', '2. La carte du formulaire (derrière les champs)', '2. Ikarita y\'ifishi (inyuma y\'imyanya yuzuzwa)', '2. Ekaadi y\'ebibuuzo (enyima y\'ebyanya ebirikwijuzibwa)'],
    ['Opacity (0–100%)', 'Obuzibu bw\'ekifaananyi (0–100%)', 'Uzito wa rangi (0–100%)', 'Opacité (0–100 %)', 'Ubwijime bw\'ishusho (0–100%)', 'Obuzibu bw\'ekishushani (0–100%)'],
    ['Blur (0–40 px)', 'Okusiikuula (0–40 px)', 'Ufifishaji (0–40 px)', 'Flou (0–40 px)', 'Ukwijima (0–40 px)', 'Okusiikuura (0–40 px)'],
    ['Save opacity & blur', 'Tereka obuzibu n\'okusiikuula', 'Hifadhi uzito na ufifishaji', 'Enregistrer l\'opacité et le flou', 'Bika ubwijime n\'ukwijima', 'Biika obuzibu n\'okusiikuura'],
    ['Banner video (optional)', 'Vidiyo y\'ekifaananyi (si ya buwaze)', 'Video ya bango (si lazima)', 'Vidéo de la bannière (facultatif)', 'Videwo y\'ibendera (ntabwo ari itegeko)', 'Vidiyo y\'ekishushani (tiya buriijo)'],
    ['Save video link', 'Tereka ekinywanyizo kya vidiyo', 'Hifadhi kiungo cha video', 'Enregistrer le lien de la vidéo', 'Bika umurongo wa videwo', 'Biika omukwate gwa vidiyo'],
    ['Save announcement', 'Tereka amawulire', 'Hifadhi tangazo', 'Enregistrer l\'annonce', 'Bika itangazo', 'Biika amakuru'],
    ['No banner set', 'Tewali kifaananyi kitereddwa', 'Hakuna bango lililowekwa', 'Aucune bannière définie', 'Nta bendera ryashyizweho', 'Tihariho kishushani kitairweho'],
    ['No image set', 'Tewali kifaananyi kitereddwa', 'Hakuna picha iliyowekwa', 'Aucune image définie', 'Nta shusho yashyizweho', 'Tihariho kishushani kitairweho'],
    ['No video — the image above is the banner', 'Tewali vidiyo — ekifaananyi ekiri waggulu kye kifaananyi', 'Hakuna video — picha iliyo juu ni bango', 'Aucune vidéo — l\'image ci-dessus est la bannière', 'Nta videwo — ishusho iri hejuru ni ibendera', 'Tihariho vidiyo — ekishushani ekiri ahaiguru nikyo kishushani'],
    ['…or link a video already uploaded with the app', '…oba nyweza vidiyo eyatereddwa ne pulogulaamu', '…au unganisha video iliyopakiwa na programu', '…ou liez une vidéo déjà fournie avec l\'application', '…cyangwa uhuze videwo isanzwe iri kuri porogaramu', '…nari kwata vidiyo eyaatairwe na porogaraamu'],
    ['Nothing uploaded — links share the built-in card', 'Tewali kiteekeddwamu — ebinywanyizo bigabana kaadi eriwo dda', 'Hakuna kilichopakiwa — viungo hushiriki kadi iliyojengwa ndani', 'Rien de téléversé — les liens partagent la carte intégrée', 'Nta cyashyizwemo — imirongo isangira ikarita iri imbere', 'Tihariho ekitairwemu — emikwate nigigabana ekaadi eriyo'],
    ['Number/digit font (every money figure in the app)', 'Ennukuta z\'emiwendo (buli muwendo gw\'ssente mu pulogulaamu)', 'Fonti ya namba (kila kiasi cha pesa katika programu)', 'Police des chiffres (tous les montants de l\'application)', 'Imyandiko y\'imibare (buri mubare w\'amafaranga muri porogaramu)', 'Obuhandiiko bw\'emibaro (buri mubaro gwa sente omu porogaraamu)'],
    ['Upload icon', 'Teekamu akabonero', 'Pakia aikoni', 'Téléverser une icône', 'Shyiramo ikimenyetso', 'Taamu ekimanyiso'],
    ['Upload image', 'Teekamu ekifaananyi', 'Pakia picha', 'Téléverser une image', 'Shyiramo ishusho', 'Taamu ekishushani'],
    ['Upload video', 'Teekamu vidiyo', 'Pakia video', 'Téléverser une vidéo', 'Shyiramo videwo', 'Taamu vidiyo'],
    ['Upload preview', 'Teekamu ekifaananyi ky\'okulabako', 'Pakia muhtasari', 'Téléverser l\'aperçu', 'Shyiramo incamake', 'Taamu ekishushani ky\'okureeberera'],
    ['Upload GIF', 'Teekamu GIF', 'Pakia GIF', 'Téléverser un GIF', 'Shyiramo GIF', 'Taamu GIF'],
    ['Upload top-band image', 'Teekamu ekifaananyi ky\'omusipi ogw\'awaggulu', 'Pakia picha ya ukanda wa juu', 'Téléverser l\'image du bandeau du haut', 'Shyiramo ishusho y\'umukandara wo hejuru', 'Taamu ekishushani ky\'omukyeeka ogw\'ahaiguru'],
    ['Upload form-card image', 'Teekamu ekifaananyi ky\'kaadi y\'ebibuuzo', 'Pakia picha ya kadi ya fomu', 'Téléverser l\'image de la carte du formulaire', 'Shyiramo ishusho y\'ikarita y\'ifishi', 'Taamu ekishushani ky\'ekaadi y\'ebibuuzo'],
    ['Cut the dark background off this logo', 'Salako ekifaananyi eky\'emabega ekiddugavu ku kabonero kano', 'Ondoa mandhari nyeusi kwenye nembo hii', 'Détacher le fond sombre de ce logo', 'Gukuraho mbuganyuma yijimye kuri iki kirango', 'Shaarukamu enyima y\'omwiragura aha kimanyiso eki'],

    # ── countries ──
    ['+ New country', '+ Eggwanga eripya', '+ Nchi mpya', '+ Nouveau pays', '+ Igihugu gishya', '+ Ihanga risya'],
    ['+ Address', '+ Endagiriro', '+ Anwani', '+ Adresse', '+ Aderesi', '+ Endagiriro'],
    ['Which country does an address serve?', 'Endagiriro eweereza ggwanga ki?', 'Anwani inahudumia nchi gani?', 'Quel pays une adresse dessert-elle ?', 'Ni igihugu iki aderesi ikorera?', 'Endagiriro neeheereza ihanga ki?'],
    ['Base domain', 'Endagiriro ensingi', 'Kikoa msingi', 'Domaine de base', 'Urubuga shingiro', 'Endagiriro enkuru'],
    ['Allowed website domains', 'Endagiriro z\'emikutu ezikkirizibwa', 'Vikoa vya tovuti vinavyoruhusiwa', 'Domaines autorisés', 'Imbuga zemewe', 'Endagiriro z\'orubuga ezirikwikirizibwa'],
    ['Where the app may be opened from', 'Pulogulaamu gy\'esobola okuggulwa okuva', 'Wapi programu inaweza kufunguliwa kutoka', 'D\'où l\'application peut être ouverte', 'Aho porogaramu ishobora gufungurwa', 'Ahu porogaraamu erikubaasa kwigurwa'],
    ['Retired addresses, one per line', 'Endagiriro eziwummudde, emu ku lunyiriri', 'Anwani zilizoachwa, moja kwa kila mstari', 'Adresses retirées, une par ligne', 'Aderesi zavanywe, imwe kuri buri murongo', 'Endagiriro ezirekiirwe, emwe aha buri mutwe'],
    ['starts 7', 'esooka na 7', 'inaanza na 7', 'commence par 7', 'itangira na 7', 'nikitandika na 7'],
]
