# Round 178: the link-preview switch, and the country-delete refusals.
#
# Six columns: English, Luganda, Kiswahili, French, Kinyarwanda, Runyankore.
# '=' means "the right word in this language IS the English word" -- a choice,
# not a blank. build-admin-rows.py refuses a short row, a blank cell, or a cell
# that merely repeats its English.
ROWS = [
    ['Show a picture on shared links',
     'Laga ekifaananyi ku nnyiriri ezigabanyizibwa',
     'Onyesha picha kwenye viungo vinavyoshirikiwa',
     'Afficher une image sur les liens partagés',
     'Erekana ifoto ku mirongo isangiwe',
     'Yoreka ekishushani aha mihanda egabanwa'],

    ['Turn this off and a pasted link shows just the title and address, with no picture at all — neither your upload nor the built-in card. It applies to every country and every address, because the share tags live in one file that all of them are served from.',
     'Bw\'okizikiza, olunyiriri lwe luteekamu lulaga erinnya n\'endagiriro zokka, awatali kifaananyi n\'akatono — si kya kwewaanika kwo wadde ekipapula ekiri mu app. Kikola ku nsi zonna ne ku ndagiriro zonna, kubanga obubonero bw\'okugabana buli mu fayiro emu gye zonna ziweerezebwa okuva.',
     'Izima hii na kiungo kilichonakiliwa huonyesha kichwa na anwani pekee, bila picha yoyote — si upakiaji wako wala kadi iliyojengwa ndani. Inahusu kila nchi na kila anwani, kwa sababu vitambulisho vya kushiriki vipo katika faili moja ambayo zote huhudumiwa kutoka humo.',
     'Désactivez ceci et un lien collé n\'affiche que le titre et l\'adresse, sans aucune image — ni votre téléversement ni la carte intégrée. Cela s\'applique à chaque pays et à chaque adresse, car les balises de partage se trouvent dans un seul fichier depuis lequel elles sont toutes servies.',
     'Bihagarike maze umurongo washyizweho werekana umutwe n\'aderesi gusa, nta foto na mba — nta yo washyizeho cyangwa ikarita iri muri porogaramu. Bireba igihugu cyose n\'aderesi yose, kuko ibimenyetso byo gusangira biri muri dosiye imwe zose zitangwa ziyivuyemo.',
     'Kizikize reero omuhanda ogutairwemu nigwooreka omutwe n\'aderesi yonka, hatariho kishushani na kimwe — ti eki watairemu nari ekipapura ekiri omu puroguramu. Nikikora aha mahanga goona n\'aha aderesi zoona, ahakuba obumanyiso bw\'okugabana buri omu faira emwe ei zoona zirikuhereerezibwa kuruga.'],

    ['Only an owner account can delete a country.',
     'Akawunti y\'omuntu w\'ekitongole yokka esobola okusazaamu ensi.',
     'Akaunti ya mmiliki pekee inaweza kufuta nchi.',
     'Seul un compte propriétaire peut supprimer un pays.',
     'Konti y\'umutunzi gusa ishobora gusiba igihugu.',
     'Akaunti y\'omukama yonka nikibaasa kwihamu eihanga.'],

    ['Switch the country off instead of deleting it, so those members keep their own money and plans.',
     'Zikiza ensi mu kifo ky\'okugisazaamu, abantu abo basigale n\'ensimbi zaabwe n\'enteekateeka zaabwe.',
     'Zima nchi badala ya kuifuta, ili wanachama hao wabaki na fedha zao na mipango yao.',
     'Désactivez le pays au lieu de le supprimer, afin que ces membres conservent leur argent et leurs plans.',
     'Hagarika igihugu aho kugisiba, kugira ngo abo banyamuryango bagumane amafaranga yabo n\'imigambi yabo.',
     'Zikiza eihanga omu mwanya w\'okurihoramu, abantu abo bagume n\'esente zaabo n\'entebeekanisa zaabo.'],
]
