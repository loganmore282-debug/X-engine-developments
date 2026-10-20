// Mint backend, on the same Hostinger VPS as this frontend (pm2, port 3000
// behind nginx). api./app. are still different subdomains -- different
// browser origins -- so this host must stay in server.js's CORS allowlist.
// Same host as the page: the server answers under /k7x2 (nginx strips the prefix).
// No domain is baked in, so changing the host never needs a rebuild.
var API_BASE = '/k7x2';


// Every money amount elsewhere is always a whole shilling -- only a
// gift-code reward can ever carry cents (Round 137's randomized rewards,
// e.g. 123.39), so this used to Math.round() them away entirely before
// display. Now only shows decimals on a value that actually has them --
// everything else (deposits, withdrawals, prices, cashback) keeps its old,
// clean whole-number look with no changes needed at any call site.
// ── REGION (which country this app is running as) ──
//
// Owner: "l wanted other subdomain to fetch other country code and
// currency, ie fgdr.mint-platform.com in ugx, and country code changeable
// to other country or created, and another can be sfhd.mint-platform in
// KES shs, or any country created, also make when l can edit prices of each
// product and all settings as these of ugx."
//
// The SERVER decides which region this is, never the app: it comes back on
// /public/settings (the region that owns the hostname we were loaded from,
// so Sign Up reads in the right currency) and again on /account (the
// signed-in member's OWN region, which wins -- a member who opens another
// country's subdomain still sees their own currency, prices and number
// rules). Nothing here is ever sent back up; the server re-derives it on
// every request. See the REGIONS section in server.js.
//
// The values below are Uganda's, and they are also what an offline first
// paint uses -- so a cold start with no network still formats money and
// validates a phone number the way it always did.
var REGION = { key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256', localLength: 9, prefixes: ['7'], utcOffsetMin: 180, isDefault: true, languages: ['en','lg','sw','fr','rw','nyn'], defaultLang: 'en' };
function cur(){ return (REGION && REGION.currency) || 'UGX'; }
function regionName(){ return (REGION && REGION.name) || 'Uganda'; }
// "7XXXXXXXX" for Uganda -- the region's first allowed prefix padded out to
// its local length, used in the placeholders that show the shape to type.
function phoneHintBody(){
  const pfx = regionPrefixes();
  const lead = pfx.length ? pfx[0] : '';
  return lead + 'X'.repeat(Math.max(0, localLen() - lead.length));
}
function dial(){ return (REGION && REGION.dialCode) || '256'; }
function dialPlus(){ return '+' + dial(); }
function localLen(){ return Number(REGION && REGION.localLength) || 9; }
function regionPrefixes(){ return (REGION && Array.isArray(REGION.prefixes) ? REGION.prefixes.filter(Boolean) : []); }
// Applied from whichever response carried a region block. Only the fields
// the server actually sent are taken, so a server that is one deploy behind
// (no region in its replies at all) leaves Uganda's defaults standing
// instead of blanking the currency.
function applyRegion(r){
  paintRegionChrome();
  applyRegionLanguages();
}
// The bits of the SIGN-IN screen that name a country. Repainted from here,
// because the region arrives from the network AFTER that screen is already
// on display -- and the two dialling-code chips were static "+256" in the
// markup with nothing ever updating them, so every country's address showed
// Uganda's code. Reported: "why when you tap the other country domain,
// still returns the 256 on login and register".
//
// That was worse than a cosmetic slip: the chip is the ONLY thing telling a
// member which country the address he opened belongs to, so an address
// pointing at the wrong country looked completely normal right up until the
// password that had always worked was refused.
function paintRegionChrome(){
  try {
    const d = dialPlus();
    for (const id of ['loginDial', 'regDial']) { const el = $(id); if (el) el.textContent = d; }
    // The country and currency are NOT printed on the sign-in screen. They
    // were, briefly, as a way to make a wrongly-mapped address visible --
    // owner: "why showing the country and currency, that should not be
    // shown". The dialling-code chip above already differs per country, and
    // the address checker in the admin panel answers the same question
    // without putting operator diagnostics in front of members. Left in
    // place, blank, so nothing has to move if it is ever wanted again.
    for (const id of ['loginRegionNote', 'regRegionNote']) {
      const el = $(id);
      if (!el) continue;
      el.textContent = '';
      el.style.display = 'none';
    }
  } catch(_){}
}
// The last region this device saw, restored before the first paint so a
// returning member never sees Uganda's currency flash on a Kenyan phone
// while /public/settings is still in flight.

// ══════════════════════════════════════════════════════════════════════════
// LANGUAGES
// ══════════════════════════════════════════════════════════════════════════
// Owner: "add when can select languages of a country, so on login page of
// every subdomain of any country, at top right there is a button of language,
// it can change that very word depending on selected language ... Luganda,
// English, swahili, French ... make when l can select allowed languages of
// any specific country."
//
// WHICH SIX, AND WHY THESE TWO EXTRA. He named four. The other two are picked
// for the markets this platform can actually reach next, not for coverage
// counts:
//   - Kinyarwanda (rw) -- Rwanda, and close enough to Kirundi that Burundi
//     reads it. Two countries for one dictionary.
//   - Runyankole (nyn) -- western Uganda. Luganda is central Uganda's
//     language, not a national one; a Mbarara member reads it as a foreign
//     language, so "Uganda is covered" is only true with a second one.
// Deliberately NOT added: Amharic and Arabic. Both need a font this build does
// not ship (and Arabic needs a right-to-left layout pass across every screen),
// so either would arrive as boxes or a broken layout rather than as a
// language. Say the word and they become a project of their own.
//
// HOW IT WORKS, and why it is keyed on the ENGLISH SENTENCE rather than on
// codes like `login.button`:
//   - a string with no entry falls back to its own English, automatically.
//     There is no such thing as a missing-key placeholder reaching a member.
//   - adding a string to a screen costs nothing; it simply reads English
//     until somebody puts a row in the table below.
//   - and it makes the DOM sweep below possible, which is what gives this
//     real coverage without rewriting several hundred template literals.
var LANGS = [
  { code: 'en',  name: 'English',     native: 'English' },
  { code: 'lg',  name: 'Luganda',     native: 'Luganda' },
  { code: 'sw',  name: 'Swahili',     native: 'Kiswahili' },
  { code: 'fr',  name: 'French',      native: 'Français' },
  { code: 'rw',  name: 'Kinyarwanda', native: 'Ikinyarwanda' },
  { code: 'nyn', name: 'Runyankole',  native: 'Runyankore' },
];
var LANG_CODES = LANGS.map(l => l.code);
var LANG = 'en';
// What this country allows, from the region. Until the region lands it is
// English alone -- one option is not a choice, so the button stays hidden
// rather than flashing a list that is about to change.
var LANG_ALLOWED = ['en'];
var LANG_STORE_KEY = 'mint_lang';
// ── THE TABLE ──
// One row per English string: [english, lg, sw, fr, rw, nyn].
//
// AN EMPTY CELL MEANS "NOT TRANSLATED YET" AND FALLS BACK TO ENGLISH, AND
// THAT IS USED ON PURPOSE. A wrong word on a money screen is worse than an
// English one -- a member who reads "Withdraw" in English still withdraws,
// while a member who reads a mistranslation may do something else entirely.
// So where the right word was not certain the cell is left empty rather than
// filled with a guess. Swahili and French are complete; the three Bantu
// columns cover the words a member meets on every screen and should be read
// over by a native speaker before launch -- every correction is one cell in
// this table, nothing else moves.
//
// A cell that simply repeats its English is treated as empty by DICT, and
// test-languages.js FAILS one, so it must be left blank instead. French for
// "Messages" is "Messages" -- that cell is blank, because a filled cell is a
// claim somebody chose the word, and the two behave identically at runtime.
//
// Regenerated by apply-translations.py, which merges a translation answer in
// without ever letting a blank overwrite a filled cell -- so hand edits here
// survive a re-run, and this header is the only thing that has to be kept.
// ==== I18N TABLE: SHARED WITH THE ADMIN PANEL - BEGIN ====
// build-admin.js lifts these two tables into the admin bundle as well, and the
// panel then CONCATENATES its own rows onto them. That is not tidiness: the
// panel and the app say "Deposit", "Withdraw", "Save", "Cancel", "Settings",
// "Pending", "Failed" and a couple of hundred more words in common, and two
// hand-kept copies of those would drift word by word until the same button
// read differently on the two screens.
var LANG_ROWS = [
  // [english, lg, sw, fr, rw, nyn] -- an EMPTY cell means "not translated yet" and
  // falls back to English at runtime. Regenerated by apply-translations.py;
  // hand edits are kept, since a blank in an answer never overwrites a filled cell.
  ['Home', 'Awaka', 'Nyumbani', 'Accueil', 'Ahabanza', 'Omuka'],
  ['Products', 'Ebyamaguzi', 'Bidhaa', 'Produits', 'Ibicuruzwa', 'Ebyamaguzi'],
  ['My Products', 'Ebyange', 'Bidhaa Zangu', 'Mes Produits', 'Ibyanjye', 'Ebyangye'],
  ['Referral', 'Okuyita', 'Mwaliko', 'Parrainage', 'Gutumira', 'Okweta'],
  ['Team', 'Ekibiina', 'Timu', '\u00c9quipe', 'Itsinda', 'Ekibiina'],
  ['Account', 'Akawunti', 'Akaunti', 'Compte', 'Konti', 'Akaunti'],
  ['Deposit', 'Teeka Ssente', 'Weka Pesa', 'D\u00e9p\u00f4t', 'Kubitsa', 'Ta Sente'],
  ['Withdraw', 'Ggyamu Ssente', 'Toa Pesa', 'Retrait', 'Kubikuza', 'Ihamu Sente'],
  ['LOGIN', 'YINGIRA', 'INGIA', 'CONNEXION', 'INJIRA', 'TAAHA'],
  ['SIGN UP', 'WEEWANDIISE', 'JISAJILI', 'S\'INSCRIRE', 'IYANDIKISHE', 'YEEWANDIISE'],
  ['Log In', 'Yingira', 'Ingia', 'Connexion', 'Injira', 'Taaha'],
  ['Sign Up', 'Weewandiise', 'Jisajili', 'S\'inscrire', 'Iyandikishe', 'Yeewandiise'],
  ['Log Out', 'Fuluma', 'Toka', 'D\u00e9connexion', 'Sohoka', 'Shohoka'],
  ['Enter phone number', 'Wandiika ennamba ya ssimu', 'Weka namba ya simu', 'Entrez le num\u00e9ro de t\u00e9l\u00e9phone', 'Andika nimero ya telefone', 'Handiika enamba ya esimu'],
  ['Enter password', 'Wandiika ekisumuluzo', 'Weka nenosiri', 'Entrez le mot de passe', 'Andika ijambobanga', 'Handiika ekisumuruzo'],
  ['Remember me', 'Onjjukire', 'Nikumbuke', 'Se souvenir de moi', 'Unyibuke', 'Onyijuke'],
  ['Referral code', 'Koodi y\'Okuyita', 'Msimbo wa mwaliko', 'Code de parrainage', 'Kode yo gutumira', 'Koodi y\'Okweta'],
  ['Logging in\u2026', 'Oyingira\u2026', 'Inaingia\u2026', 'Connexion en cours\u2026', 'Urimo kwinjira\u2026', 'Nootaaha\u2026'],
  ['Creating your account\u2026', 'Tukolawo akawunti yo\u2026', 'Inatengeneza akaunti yako\u2026', 'Cr\u00e9ation de votre compte\u2026', 'Turimo gushyiraho konti yawe\u2026', 'Nitukora akaunti yaawe\u2026'],
  ['Wallet', 'Ensawo', 'Pochi', 'Portefeuille', 'Umufuka', 'Ensaho'],
  ['Messages', 'Obubaka', 'Ujumbe', '=', 'Ubutumwa', 'Obutumwa'],
  ['Transaction Statement', 'Ebiwandiiko bya Ssente', 'Rekodi ya Salio', 'Historique du solde', 'Amateka y\'amafaranga', 'Ebihandiiko bya Sente'],
  ['Rules and Regulations', '', '', '', '', ''],
  ['Login successful ✓', '', '', '', '', ''],
  ['Login Password', 'Ekisumuluzo ky\'Okuyingira', 'Nenosiri la Kuingia', 'Mot de passe de connexion', 'Ijambobanga ryo kwinjira', 'Ekisumuruzo ky\'Okutaaha'],
  ['Trade Password', 'Ekisumuluzo ky\'Okusuubula', 'Nenosiri la Malipo', 'Mot de passe de transaction', 'Ijambobanga ry\'ubucuruzi', 'Ekisumuruzo ky\'Okushuubura'],
  ['Download APP', 'Tikka APP', 'Pakua APP', 'T\u00e9l\u00e9charger l\'application', 'Kuramo APP', 'Tikka APP'],
  ['Turntable', 'Enkyukakyuka', 'Gurudumu', 'La Roue', 'Uruziga', 'Ekizengurutsi'],
  ['Language', 'Olulimi', 'Lugha', 'Langue', 'Ururimi', 'Orurimi'],
  ['SETTINGS', 'ENTEEKATEEKA', 'MIPANGILIO', 'PARAM\u00c8TRES', 'IGENAMITERERE', 'ENTEEKATEEKA'],
  ['Cancel', 'Sazaamu', 'Ghairi', 'Annuler', 'Hagarika', 'Sazamu'],
  ['Confirm', 'Kakasa', 'Thibitisha', 'Confirmer', 'Emeza', 'Hamya'],
  ['Submit', 'Weereza', 'Wasilisha', 'Envoyer', 'Ohereza', 'Oherereza'],
  ['Save', 'Tereka', 'Hifadhi', 'Enregistrer', 'Bika', 'Bika'],
  ['Copy', 'Koppa', 'Nakili', 'Copier', 'Koporora', 'Koppa'],
  ['Copied', 'Kikoppeddwa', 'Imenakiliwa', 'Copi\u00e9', 'Byakoporowe', 'Kikoppirwe'],
  ['Amount', 'Omuwendo', 'Kiasi', 'Montant', 'Ingano', 'Omuhendo'],
  ['Balance', 'Ebisigaddewo', 'Salio', 'Solde', 'Amafaranga asigaye', 'Esigaireho'],
  ['Buy Now', 'Gula Kati', 'Nunua Sasa', 'Acheter', 'Gura Ubu', 'Gura Hati'],
  ['Total Team', 'Ekibiina Kyonna', 'Timu Yote', '\u00c9quipe totale', 'Itsinda ryose', 'Ekibiina Kyona'],
  ['Commission Rate', 'Omuwendo gwa Kamisoni', 'Kiwango cha Kamisheni', 'Taux de commission', 'Igipimo cya komisiyo', 'Omuhendo gwa Kamisoni'],
  ['Level 1', 'Omutendera 1', 'Ngazi 1', 'Niveau 1', 'Urwego 1', 'Omurengo 1'],
  ['Level 2', 'Omutendera 2', 'Ngazi 2', 'Niveau 2', 'Urwego 2', 'Omurengo 2'],
  ['Level 3', 'Omutendera 3', 'Ngazi 3', 'Niveau 3', 'Urwego 3', 'Omurengo 3'],
  ['Purchase', 'Okugula', 'Manunuzi', 'Achat', 'Kugura', 'Okugura'],
  ['Total Purchase', 'Byonna By\'ogudde', 'Jumla ya Manunuzi', 'Achat total', 'Byose waguze', 'Byona Ebi Ogwire'],
  ['No members at this level yet.', 'Tewali bantu ku mutendera guno.', 'Bado hakuna wanachama katika ngazi hii.', 'Aucun membre \u00e0 ce niveau pour l\'instant.', 'Nta banyamuryango bari kuri uru rwego.', 'Tihariho bantu aha murengo ogu.'],
  ['Ongoing', 'Kigenda mu maaso', 'Inaendelea', 'En cours', 'Birakomeza', 'Nikigyenda omu maisho'],
  ['Matured', 'Kituukiridde', 'Imekamilika', 'Arriv\u00e9 \u00e0 terme', 'Byarangiye', 'Kihikire'],
  ['All', 'Byonna', 'Zote', 'Tout', 'Byose', 'Byona'],
  ['Select Amount', 'Londa Omuwendo', 'Chagua Kiasi', 'Choisissez le montant', 'Hitamo ingano', 'Toorana Omuhendo'],
  ['Payment Phone', 'Essimu y\'Okusasula', 'Simu ya Malipo', 'T\u00e9l\u00e9phone de paiement', 'Telefone yo kwishyura', 'Esimu y\'Okushashura'],
  ['Confirm Deposit', 'Kakasa Okuteeka Ssente', 'Thibitisha Kuweka Pesa', 'Confirmer le d\u00e9p\u00f4t', 'Emeza kubitsa', 'Hamya Okuta Sente'],
  ['Network error. Try again.', 'Yintaneeti erina ekizibu. Ddamu ogezeeko.', 'Hitilafu ya mtandao. Jaribu tena.', 'Erreur de r\u00e9seau. R\u00e9essayez.', 'Ikibazo cy\'umurongo. Ongera ugerageze.', 'Enetiweki eine ekizibu. Ogarukyemu.'],
  ['About', 'Ebikwata ku', 'Kuhusu', '\u00c0 propos', 'Ibyerekeye', 'Ebirikukwata aha'],
  ['Account:', 'Akawunti:', 'Akaunti:', 'Compte :', 'Konti:', 'Akaunti:'],
  ['Back', 'Ddayo', 'Rudi', 'Retour', 'Subira inyuma', 'Garuka'],
  ['Channel', 'Ekitundu', 'Chaneli', 'Canal', 'Umuyoboro', 'Ekitundu'],
  ['Click', 'Nyiga', 'Bonyeza', 'Cliquez', 'Kanda', 'Kanda'],
  ['Close', 'Ggalawo', 'Funga', 'Fermer', 'Funga', 'Kinga'],
  ['COLLECT', 'TWALA', 'CHUKUA', 'R\u00c9CUP\u00c9RER', 'FATA', 'TWARA'],
  ['Congratulations!', 'Tukusanyukidde!', 'Hongera!', 'F\u00e9licitations !', 'Turagushimira!', 'Tukushemereirwe!'],
  ['Daily', 'Buli lunaku', 'Kila siku', 'Quotidien', 'Buri munsi', 'Buri izooba'],
  ['Days', 'Ennaku', 'Siku', 'Jours', 'Iminsi', 'Ebiro'],
  ['Download', 'Tikka', 'Pakua', 'T\u00e9l\u00e9charger', 'Kuramo', 'Tikka'],
  ['Earned', 'Ofunye', 'Umepata', 'Gagn\u00e9', 'Wabonye', 'Otungire'],
  ['Loading', 'Kitegekebwa', 'Inapakia', 'Chargement', 'Birimo gupakirwa', 'Nikitegyekwa'],
  ['Loading...', 'Kitegekebwa...', 'Inapakia...', 'Chargement...', 'Birimo gupakirwa...', 'Nikitegyekwa...'],
  ['Loading\u2026', 'Kitegekebwa\u2026', 'Inapakia\u2026', 'Chargement\u2026', 'Birimo gupakirwa\u2026', 'Nikitegyekwa\u2026'],
  ['Price', 'Omuwendo', 'Bei', 'Prix', 'Igiciro', 'Omuhendo'],
  ['Recharge', 'Teeka Ssente', 'Weka Pesa', '=', 'Kubitsa', 'Ta Sente'],
  ['Refresh', 'Ddamu ogezeeko', 'Onyesha upya', 'Actualiser', 'Vugurura', 'Garukamu'],
  // Whole sentences that inline markup used to break into pieces. The block
  // pass keys on the flattened text, so these are written exactly as they
  // read on screen with the <b> taken out.
  ['Click "Refresh" to check if it is successful', 'Nyiga "Ddamu ogezeeko" okukebera oba kiwedde bulungi', 'Bonyeza "Onyesha upya" ili kuangalia kama imefanikiwa', 'Cliquez sur "Actualiser" pour vérifier si le paiement a abouti', 'Kanda "Vugurura" kugira ngo urebe ko byagenze neza', 'Kanda "Garukamu" kureeba yaaba ehikire gurungi'],
  ['*Filling in the wrong payment SMS/transaction ID will result in payment loss.', '*Okuwandiika obubaka oba nnamba y\u2019entambula ekyamu kirireetera ssente okubula.', '*Kujaza SMS au kitambulisho cha muamala kisicho sahihi kutasababisha upotevu wa fedha.', '*Saisir un SMS ou un identifiant de transaction incorrect entra\u00eenera la perte du paiement.', '*Kwandika SMS cyangwa indangamuntu y\u2019ubwishyu itari yo bizatuma amafaranga abura.', '*Okuhandiika obutumwa nari namba y\u2019okworeka ebitari byo nikireetera sente kuburaho.'],
  ['Service', 'Obuyambi', 'Huduma', '=', 'Serivisi', 'Obuhwezi'],
  ['SPIN', 'ZUNGUSA', 'ZUNGUSHA', 'TOURNER', 'ZUNGUZA', 'ZENGURUTSA'],
  ['Total', 'Omugatte', 'Jumla', '=', 'Igiteranyo', 'Byona hamwe'],
  ['TURNTABLE', 'ENKYUKAKYUKA', 'GURUDUMU', 'LA ROUE', 'URUZIGA', 'EKIZENGURUTSI'],
  ['User', 'Omukozesa', 'Mtumiaji', 'Utilisateur', 'Ukoresha', 'Omukozesa'],
  ['Verify', 'Kakasa', 'Hakiki', 'V\u00e9rifier', 'Genzura', 'Hamya'],
  ['Welcome', 'Tukwaniriza', 'Karibu', 'Bienvenue', 'Murakaza neza', 'Mukaaze gye'],
  ['Account Holder', 'Nnannyini Akawunti', 'Mwenye Akaunti', 'Titulaire du compte', 'Nyir\'ikonti', 'Nyiini Akaunti'],
  ['Account Name:', 'Erinnya ku Akawunti:', 'Jina la Akaunti:', 'Nom du compte :', 'Izina rya konti:', 'Eiziina rya Akaunti:'],
  ['Amount paid:', 'Ssente ezisasuddwa:', 'Kiasi kilicholipwa:', 'Montant pay\u00e9 :', 'Amafaranga yishyuwe:', 'Sente ezishashuurwe:'],
  ['Available Balance', 'Ssente Eziriwo', 'Salio Lililopo', 'Solde disponible', 'Amafaranga ahari', 'Sente Eziriho'],
  ['Change language', 'Kyusa olulimi', 'Badilisha lugha', 'Changer de langue', 'Hindura ururimi', 'Hindura orurimi'],
  ['Coming Soon', 'Kijja mangu', 'Inakuja Hivi Karibuni', 'Bient\u00f4t disponible', 'Biraza vuba', 'Nibiija juba'],
  ['Confirm Withdraw', 'Kakasa Okuggyamu', 'Thibitisha Kutoa Pesa', 'Confirmer le retrait', 'Emeza kubikuza', 'Hamya Okwihamu'],
  ['Copy account', 'Koppa akawunti', 'Nakili akaunti', 'Copier le compte', 'Koporora konti', 'Koppa akaunti'],
  ['Copy link', 'Koppa lyanka', 'Nakili kiungo', 'Copier le lien', 'Koporora umurongo', 'Koppa orunyiriri'],
  ['Copy this', 'Koppa kino', 'Nakili hii', 'Copier ceci', 'Koporora ibi', 'Koppa eki'],
  ['Current Balance', 'Ssente Eziriwo Kati', 'Salio la Sasa', 'Solde actuel', 'Amafaranga ariho ubu', 'Sente Eziriho Hati'],
  ['Current streak', 'Ennaku z\'obutasalako', 'Mfululizo wa sasa', 'S\u00e9rie en cours', 'Umubare w\'iminsi ikurikiranye', 'Orukurato hati'],
  ['Customer Service', 'Obuyambi eri Abaguzi', 'Huduma kwa Wateja', 'Service client', 'Serivisi z\'abakiriya', 'Obuhwezi bw\'Abaguzi'],
  ['Daily Check-in', 'Okukyalira Buli Lunaku', 'Kuhudhuria Kila Siku', 'Pointage quotidien', 'Kwiyandikisha buri munsi', 'Okwoleka Buri Izooba'],
  ['Deposit Instructions', 'Ebiragiro by\'Okuteeka Ssente', 'Maelekezo ya Kuweka Pesa', 'Instructions de d\u00e9p\u00f4t', 'Amabwiriza yo kubitsa', 'Ebiragiro by\'Okuta Sente'],
  ['Edit Wallet', 'Kyusa Ensawo', 'Hariri Pochi', 'Modifier le portefeuille', 'Hindura umufuka', 'Hindura Ensaho'],
  ['Full name', 'Amannya gonna', 'Jina kamili', 'Nom complet', 'Amazina yose', 'Amaziina goona'],
  ['Go spin', 'Genda ozunguse', 'Nenda uzungushe', 'Aller tourner', 'Genda uzunguze', 'Genda ozengurutse'],
  ['Help Centre', 'Ekifo ky\'Obuyambi', 'Kituo cha Msaada', 'Centre d\'aide', 'Ikigo cy\'ubufasha', 'Ekicweka ky\'Obuhwezi'],
  ['Invitation Reward', 'Empeera y\'Okuyita', 'Zawadi ya Mwaliko', 'R\u00e9compense de parrainage', 'Igihembo cyo gutumira', 'Empeera y\'Okweta'],
  ['Join Channel', 'Yingira mu Kitundu', 'Jiunge na Chaneli', 'Rejoindre le canal', 'Injira mu muyoboro', 'Taaha omu Kitundu'],
  ['Loading activity\u2026', 'Tuleeta ebipya\u2026', 'Inapakia shughuli\u2026', 'Chargement de l\'activit\u00e9\u2026', 'Birimo gupakirwa\u2026', 'Nituleeta ebisya\u2026'],
  ['Mystery Treasure', 'Eky\'obugagga Ekyekusifu', 'Hazina ya Siri', 'Tr\u00e9sor myst\u00e8re', 'Ubutunzi bw\'ibanga', 'Obugaiga Obw\'ekyama'],
  ['OPEN CHEST', 'GGULAWO ESSANDUKU', 'FUNGUA SANDUKU', 'OUVRIR LE COFFRE', 'FUNGURA AGASANDUKU', 'IGURA ESANDUUKU'],
  ['Opening in', 'Kigguka mu', 'Inafunguka baada ya', 'Ouverture dans', 'Bifungura mu', 'Nikyiguka omu'],
  ['Payment Amount:', 'Omuwendo gw\'Okusasula:', 'Kiasi cha Malipo:', 'Montant du paiement :', 'Amafaranga yo kwishyura:', 'Omuhendo gw\'Okushashura:'],
  ['Payment completed?', 'Osasudde?', 'Malipo yamekamilika?', 'Paiement effectu\u00e9 ?', 'Wishyuye?', 'Oshashwire?'],
  ['Payment reminder', 'Ekijjukizo ky\'okusasula', 'Kikumbusho cha malipo', 'Rappel de paiement', 'Kwibutsa kwishyura', 'Ekijwekyezo ky\'okushashura'],
  ['Share URL', 'Gaba Lyanka', 'Shiriki Kiungo', 'Partager le lien', 'Sangiza umurongo', 'Gabana Orunyiriri'],
  ['Show password', 'Laga ekisumuluzo', 'Onyesha nenosiri', 'Afficher le mot de passe', 'Erekana ijambobanga', 'Yoreka ekisumuruzo'],
  ['Telegram Group', 'Ekibiina kya Telegram', 'Kikundi cha Telegram', 'Groupe Telegram', 'Itsinda rya Telegram', 'Ekibiina kya Telegram'],
  ['Total Amount:', 'Omugatte:', 'Jumla ya Kiasi:', 'Montant total :', 'Igiteranyo:', 'Byona hamwe:'],
  ['Total Earned', 'Byonna By\'ofunye', 'Jumla Uliyopata', 'Total gagn\u00e9', 'Byose wabonye', 'Byona Ebi Otungire'],
  ['Total Invested', 'Byonna By\'oteeseemu', 'Jumla Uliyowekeza', 'Total investi', 'Byose washoye', 'Byona Ebi Oteiremu'],
  ['TREASURE CHEST', 'ESSANDUKU LY\'OBUGAGGA', 'SANDUKU LA HAZINA', 'COFFRE AU TR\u00c9SOR', 'AGASANDUKU K\'UBUTUNZI', 'ESANDUUKU Y\'OBUGAIGA'],
  ['Wallet Account', 'Akawunti y\'Ensawo', 'Akaunti ya Pochi', 'Compte du portefeuille', 'Konti y\'umufuka', 'Akaunti y\'Ensaho'],
  ['Wallet Balance', 'Ssente mu Nsawo', 'Salio la Pochi', 'Solde du portefeuille', 'Amafaranga mu mufuka', 'Sente omu Nsaho'],
  ['Wallet Provider', 'Kkampuni y\'Ensawo', 'Mtoa Huduma wa Pochi', 'Op\u00e9rateur du portefeuille', 'Utanga serivisi y\'umufuka', 'Kampuni y\'Ensaho'],
  ['Wallet saved', 'Ensawo etereddwa', 'Pochi imehifadhiwa', 'Portefeuille enregistr\u00e9', 'Umufuka wabitswe', 'Ensaho ebiikirwe'],
  ['WhatsApp Group', 'Ekibiina kya WhatsApp', 'Kikundi cha WhatsApp', 'Groupe WhatsApp', 'Itsinda rya WhatsApp', 'Ekibiina kya WhatsApp'],
  ['WhatsApp Support', 'Obuyambi ku WhatsApp', 'Msaada wa WhatsApp', 'Assistance WhatsApp', 'Ubufasha kuri WhatsApp', 'Obuhwezi aha WhatsApp'],
  ['Withdrawal Instructions', 'Ebiragiro by\'Okuggyamu Ssente', 'Maelekezo ya Kutoa Pesa', 'Instructions de retrait', 'Amabwiriza yo kubikuza', 'Ebiragiro by\'Okwihamu Sente'],
  ['Withdrawal Wallet', 'Ensawo y\'Okuggyamu', 'Pochi ya Kutoa Pesa', 'Portefeuille de retrait', 'Umufuka wo kubikuza', 'Ensaho y\'Okwihamu'],
  ['You opened', 'Oggudde', 'Umefungua', 'Vous avez ouvert', 'Wafunguye', 'Oigwire'],
  ['You won', 'Owanguddemu', 'Umeshinda', 'Vous avez gagn\u00e9', 'Watsinze', 'Osingwire'],
  ['You\'ll receive:', 'Ojja kufuna:', 'Utapokea:', 'Vous recevrez :', 'Uzabona:', 'Noija kutunga:'],
  ['Your Wallet', 'Ensawo Yo', 'Pochi Yako', 'Votre portefeuille', 'Umufuka wawe', 'Ensaho Yaawe'],
  ['Account Holder Name', 'Erinnya lya Nnannyini Akawunti', 'Jina la Mwenye Akaunti', 'Nom du titulaire du compte', 'Izina rya nyir\'ikonti', 'Eiziina rya Nyiini Akaunti'],
  ['Confirm Login Password', 'Kakasa Ekisumuluzo ky\'Okuyingira', 'Thibitisha Nenosiri la Kuingia', 'Confirmez le mot de passe de connexion', 'Emeza ijambobanga ryo kwinjira', 'Hamya Ekisumuruzo ky\'Okutaaha'],
  ['Confirm New Password', 'Kakasa Ekisumuluzo Ekiggya', 'Thibitisha Nenosiri Jipya', 'Confirmez le nouveau mot de passe', 'Emeza ijambobanga rishya', 'Hamya Ekisumuruzo Ekisya'],
  ['COPY & PAY', 'KOPPA OSASULE', 'NAKILI NA LIPA', 'COPIER ET PAYER', 'KOPORORA WISHYURE', 'KOPPA OSHASHURE'],
  ['Copy account name', 'Koppa erinnya ly\'akawunti', 'Nakili jina la akaunti', 'Copier le nom du compte', 'Koporora izina rya konti', 'Koppa eiziina rya akaunti'],
  ['Copy Invite Link', 'Koppa Lyanka ly\'Okuyita', 'Nakili Kiungo cha Mwaliko', 'Copier le lien d\'invitation', 'Koporora umurongo wo gutumira', 'Koppa Orunyiriri rw\'Okweta'],
  ['Could not copy', 'Tekikoppeddwa', 'Imeshindwa kunakili', 'Copie impossible', 'Ntibyashobotse gukoporora', 'Tikikoppirwe'],
  ['Enter trade password', 'Wandiika ekisumuluzo ky\'okusuubula', 'Weka nenosiri la malipo', 'Entrez le mot de passe de transaction', 'Andika ijambobanga ry\'ubucuruzi', 'Handiika ekisumuruzo ky\'okushuubura'],
  ['Enter your password.', 'Wandiika ekisumuluzo kyo.', 'Weka nenosiri lako.', 'Entrez votre mot de passe.', 'Andika ijambobanga ryawe.', 'Handiika ekisumuruzo kyaawe.'],
  ['How it works', 'Engeri gye kikolamu', 'Jinsi inavyofanya kazi', 'Comment \u00e7a marche', 'Uko bikora', 'Oku kirikukora'],
  ['Login password changed', 'Ekisumuluzo ky\'okuyingira kikyusiddwa', 'Nenosiri la kuingia limebadilishwa', 'Mot de passe de connexion modifi\u00e9', 'Ijambobanga ryo kwinjira ryahinduwe', 'Ekisumuruzo ky\'okutaaha kihindwiirwe'],
  ['New Login Password', 'Ekisumuluzo Ekiggya eky\'Okuyingira', 'Nenosiri Jipya la Kuingia', 'Nouveau mot de passe de connexion', 'Ijambobanga rishya ryo kwinjira', 'Ekisumuruzo Ekisya ky\'Okutaaha'],
  ['New Trade Password', 'Ekisumuluzo Ekiggya eky\'Okusuubula', 'Nenosiri Jipya la Malipo', 'Nouveau mot de passe de transaction', 'Ijambobanga rishya ry\'ubucuruzi', 'Ekisumuruzo Ekisya ky\'Okushuubura'],
  ['No messages yet.', 'Tewali bubaka.', 'Hakuna ujumbe bado.', 'Aucun message pour l\'instant.', 'Nta butumwa buraboneka.', 'Tihariho butumwa.'],
  ['No more data', 'Tewali birala', 'Hakuna data zaidi', 'Plus de donn\u00e9es', 'Nta bindi bihari', 'Tihariho bindi'],
  ['No products yet.', 'Tewali byamaguzi.', 'Hakuna bidhaa bado.', 'Aucun produit pour l\'instant.', 'Nta bicuruzwa biraboneka.', 'Tihariho byamaguzi.'],
  ['Nothing here yet.', 'Tewali kantu wano.', 'Hakuna kitu hapa bado.', 'Rien ici pour l\'instant.', 'Nta kintu kiraboneka hano.', 'Tihariho kintu hanu.'],
  ['Old Login Password', 'Ekisumuluzo Ekikadde eky\'Okuyingira', 'Nenosiri la Zamani la Kuingia', 'Ancien mot de passe de connexion', 'Ijambobanga rya kera ryo kwinjira', 'Ekisumuruzo Ekikuru ky\'Okutaaha'],
  ['Old Trade Password', 'Ekisumuluzo Ekikadde eky\'Okusuubula', 'Nenosiri la Zamani la Malipo', 'Ancien mot de passe de transaction', 'Ijambobanga rya kera ry\'ubucuruzi', 'Ekisumuruzo Ekikuru ky\'Okushuubura'],
  ['Open treasure chest', 'Ggulawo essanduku ly\'obugagga', 'Fungua sanduku la hazina', 'Ouvrir le coffre au tr\u00e9sor', 'Fungura agasanduku k\'ubutunzi', 'Igura esanduuku y\'obugaiga'],
  ['Processing your deposit', 'Tukola ku ssente zo', 'Tunashughulikia malipo yako', 'Traitement de votre recharge', 'Turimo gutunganya ubwishyu bwawe', 'Nitukora aha sente zaawe'],
  // Owner asked directly why the deposit-status screen "only changes small
  // things" under a non-English language -- these three status titles are
  // the reason: the screen was rewritten (numbered steps, new copy) without
  // these ever being added here, so every status past the first one has
  // been silently falling back to English regardless of language. Luganda/
  // Kinyarwanda/Runyankole left blank on the two rows below where the
  // nuance was not certain enough to commit, same policy this table
  // already states at its own top -- built from vocabulary already vetted
  // elsewhere in this table ('Confirmed'/'kakasibwa' family, 'Failed'/
  // 'not confirmed yet'), not guessed fresh, but still needs a native read
  // before launch like the rest of this table's Bantu columns do.
  ['Payment confirmed', 'Okusasula Kukakasiddwa', 'Malipo Yamethibitishwa', 'Paiement confirm\u00e9', 'Kwishyura Byemejwe', 'Okushashura Kwahamiziibwe'],
  ['Payment not completed', 'Okusasula Tekuwedde', 'Malipo Hayajakamilika', 'Paiement non termin\u00e9', 'Kwishyura Ntibyarangiye', 'Okushashura Tikwahikire'],
  ['Still waiting for the provider', '', 'Bado tunasubiri jibu', "Toujours en attente d'une r\u00e9ponse", '', ''],
  ['Remaining to Earn', 'Ebisigadde Okufuna', 'Kilichobaki Kupata', 'Reste \u00e0 gagner', 'Bisigaye kubona', 'Ebisigaire Okutunga'],
  ['SAVE LOGIN PASSWORD', 'TEREKA EKISUMULUZO KY\'OKUYINGIRA', 'HIFADHI NENOSIRI LA KUINGIA', 'ENREGISTRER LE MOT DE PASSE', 'BIKA IJAMBOBANGA RYO KWINJIRA', 'BIIKA EKISUMURUZO KY\'OKUTAAHA'],
  ['SAVE TRADE PASSWORD', 'TEREKA EKISUMULUZO KY\'OKUSUUBULA', 'HIFADHI NENOSIRI LA MALIPO', 'ENREGISTRER LE MOT DE PASSE DE TRANSACTION', 'BIKA IJAMBOBANGA RY\'UBUCURUZI', 'BIIKA EKISUMURUZO KY\'OKUSHUUBURA'],
  ['Select Payment Method', 'Londa Engeri y\'Okusasula', 'Chagua Njia ya Malipo', 'Choisissez le mode de paiement', 'Hitamo uburyo bwo kwishyura', 'Toorana Omuringo gw\'Okushashura'],
  ['Select wallet provider', 'Londa kkampuni y\'ensawo', 'Chagua mtoa huduma wa pochi', 'Choisissez l\'op\u00e9rateur du portefeuille', 'Hitamo utanga serivisi y\'umufuka', 'Toorana kampuni y\'ensaho'],
  ['Tap to retry', 'Nyiga oddemu ogezeeko', 'Gusa ujaribu tena', 'Appuyez pour r\u00e9essayer', 'Kanda wongere ugerageze', 'Kanda ogarukyemu'],
  ['Trade password changed', 'Ekisumuluzo ky\'okusuubula kikyusiddwa', 'Nenosiri la malipo limebadilishwa', 'Mot de passe de transaction modifi\u00e9', 'Ijambobanga ry\'ubucuruzi ryahinduwe', 'Ekisumuruzo ky\'okushuubura kihindwiirwe'],
  ['Transaction expires later', 'Okusasula kuggwaako oluvannyuma', 'Muamala utaisha baadaye', 'La transaction expire plus tard', 'Ubwishyu buzarangira nyuma', 'Okushashura nikuhwaho bwanyima'],
  ['Your payment account:', 'Akawunti yo ey\'okusasula:', 'Akaunti yako ya malipo:', 'Votre compte de paiement :', 'Konti yawe yo kwishyura:', 'Akaunti yaawe y\'okushashura:'],
  ['account and make payment', 'akawunti osasule', 'akaunti na ulipe', 'compte et effectuez le paiement', 'konti maze wishyure', 'akaunti oshashure'],
  ['Already have an account?', 'Olina dda akawunti?', 'Tayari una akaunti?', 'Vous avez d\u00e9j\u00e0 un compte ?', 'Usanzwe ufite konti?', 'Oine akaunti?'],
  ['Enter a valid amount', 'Wandiika omuwendo omutuufu', 'Weka kiasi sahihi', 'Entrez un montant valide', 'Andika ingano nyayo', 'Handiika omuhendo ogurikwecwera'],
  ['Enter a valid amount.', 'Wandiika omuwendo omutuufu.', 'Weka kiasi sahihi.', 'Entrez un montant valide.', 'Andika ingano nyayo.', 'Handiika omuhendo ogurikwecwera.'],
  ['Enter treasure chest key', 'Wandiika ekisumuluzo ky\'essanduku', 'Weka ufunguo wa sanduku la hazina', 'Entrez la cl\u00e9 du coffre au tr\u00e9sor', 'Andika urufunguzo rw\'agasanduku', 'Handiika ekishumuruzo ky\'esanduuku'],
  ['Recharge time: 7*24 hours.', 'Osobola okuteeka ssente essaawa 24, ennaku 7.', 'Muda wa kuweka pesa: saa 24, siku 7.', 'Recharge disponible 24 h/24, 7 j/7.', 'Ushobora kubitsa amasaha 24 ku munsi, iminsi 7.', 'Nobaasa kuta sente eshaaha 24, ebiro 7.'],
  ['Referral code is required', 'Koodi y\'okuyita yeetaagisa', 'Msimbo wa mwaliko unahitajika', 'Le code de parrainage est obligatoire', 'Kode yo gutumira irakenewe', 'Koodi y\'okweta neeyetengyesa'],
  ['Select your wallet provider.', 'Londa kkampuni y\'ensawo yo.', 'Chagua mtoa huduma wa pochi yako.', 'Choisissez l\'op\u00e9rateur de votre portefeuille.', 'Hitamo utanga serivisi y\'umufuka wawe.', 'Toorana kampuni y\'ensaho yaawe.'],
  ['Trade Password (6 digits)', 'Ekisumuluzo ky\'Okusuubula (ennamba 6)', 'Nenosiri la Malipo (tarakimu 6)', 'Mot de passe de transaction (6 chiffres)', 'Ijambobanga ry\'ubucuruzi (imibare 6)', 'Ekisumuruzo ky\'Okushuubura (enamba 6)'],
  ['Bind your wallet before withdrawing.', 'Teekawo ensawo yo nga tonnaggyamu ssente.', 'Sajili pochi yako kabla ya kutoa pesa.', 'Enregistrez votre portefeuille avant de retirer.', 'Andikisha umufuka wawe mbere yo kubikuza.', 'Taho ensaho yaawe otakaihiremu sente.'],
  ['Choose PAY-A or PAY B', 'Londa PAY-A oba PAY B', 'Chagua PAY-A au PAY B', 'Choisissez PAY-A ou PAY B', 'Hitamo PAY-A cyangwa PAY B', 'Toorana PAY-A nari PAY B'],
  ['Click to refresh the results.', 'Nyiga oddemu olabe ebivudde mu.', 'Bonyeza ili kuonyesha matokeo upya.', 'Cliquez pour actualiser les r\u00e9sultats.', 'Kanda kugira ngo uvugurure ibisubizo.', 'Kanda ogarukyemu oreebe ebyarugiremu.'],
  ['Could not load your plans.', 'Tetusobodde kuggya nteekateeka zo.', 'Imeshindwa kupakia mipango yako.', 'Impossible de charger vos plans.', 'Ntibyashobotse gupakira gahunda zawe.', 'Tikibaasiki kureeta enteekateeka zaawe.'],
  ['Daily spin & bonus wins', 'Okuzungusa buli lunaku n\'ebirabo', 'Kuzungusha kila siku na zawadi', 'Tour quotidien et gains bonus', 'Kuzunguza buri munsi n\'ibihembo', 'Okuzengurutsa buri izooba n\'ebirabo'],
  ['Enter the account holder name.', 'Wandiika erinnya lya nnannyini akawunti.', 'Weka jina la mwenye akaunti.', 'Entrez le nom du titulaire du compte.', 'Andika izina rya nyir\'ikonti.', 'Handiika eiziina rya nyiini akaunti.'],
  ['Enter your 6-digit Trade Password.', 'Wandiika ekisumuluzo kyo eky\'okusuubula ekya nnamba 6.', 'Weka nenosiri lako la malipo la tarakimu 6.', 'Entrez votre mot de passe de transaction \u00e0 6 chiffres.', 'Andika ijambobanga ryawe ry\'ubucuruzi rigizwe n\'imibare 6.', 'Handiika ekisumuruzo kyaawe ky\'okushuubura eky\'enamba 6.'],
  ['Enter your current login password.', 'Wandiika ekisumuluzo kyo eky\'okuyingira ekiriwo kati.', 'Weka nenosiri lako la sasa la kuingia.', 'Entrez votre mot de passe de connexion actuel.', 'Andika ijambobanga ryawe ryo kwinjira urimo gukoresha.', 'Handiika ekisumuruzo kyaawe ky\'okutaaha ekiriho hati.'],
  ['Insufficient balance, redirecting to deposit\u2026', 'Ssente tezimala, tukutwala ku kuteeka ssente\u2026', 'Salio halitoshi, tunakupeleka kuweka pesa\u2026', 'Solde insuffisant, redirection vers le d\u00e9p\u00f4t\u2026', 'Amafaranga ntahagije, turimo kukujyana mu kubitsa\u2026', 'Sente tizihikire, nituukutwara aha kuta sente\u2026'],
  ['Please enter your payment account', 'Wandiika akawunti yo ey\'okusasula', 'Tafadhali weka akaunti yako ya malipo', 'Veuillez saisir votre compte de paiement', 'Nyamuneka andika konti yawe yo kwishyura', 'Handiika akaunti yaawe y\'okushashura'],
  ['Please select a payment method', 'Londa engeri y\'okusasula', 'Tafadhali chagua njia ya malipo', 'Veuillez choisir un mode de paiement', 'Nyamuneka hitamo uburyo bwo kwishyura', 'Toorana omuringo gw\'okushashura'],
  ['Please select the operator first', 'Sooka olonde kkampuni', 'Tafadhali chagua mtoa huduma kwanza', 'Veuillez d\'abord choisir l\'op\u00e9rateur', 'Nyamuneka banza uhitemo utanga serivisi', 'Banza otoorane kampuni'],
  ['Send us your payment message', 'Tuweereze obubaka bw\'okusasula', 'Tutumie ujumbe wa malipo yako', 'Envoyez-nous votre message de paiement', 'Twoherereze ubutumwa bw\'ubwishyu bwawe', 'Otwohereze obutumwa bw\'okushashura'],
  ['Showing your most recent records', 'Tulaga ebiwandiiko byo ebisembyeyo', 'Tunaonyesha rekodi zako za hivi karibuni', 'Affichage de vos enregistrements les plus r\u00e9cents', 'Twerekana amateka yawe ya vuba', 'Nituyoreka ebihandiiko byaawe ebya hati'],
  ['Buying products earns you extra spins.', 'Okugula ebyamaguzi kukuwa okuzungusa okulala.', 'Kununua bidhaa kunakupa nafasi zaidi za kuzungusha.', 'Acheter des produits vous donne des tours suppl\u00e9mentaires.', 'Kugura ibicuruzwa bikugeza ku mahirwe yo kuzunguza.', 'Okugura ebyamaguzi nikikuha okuzengurutsa okundi.'],
  ['Enter a valid wallet account number.', 'Wandiika ennamba ya akawunti y\'ensawo entuufu.', 'Weka namba sahihi ya akaunti ya pochi.', 'Entrez un num\u00e9ro de compte de portefeuille valide.', 'Andika nimero nyayo ya konti y\'umufuka.', 'Handiika enamba ya akaunti y\'ensaho erikwecwera.'],
  ['Enter your current 6-digit trade password.', 'Wandiika ekisumuluzo kyo eky\'okusuubula ekiriwo kati eky\'ennamba 6.', 'Weka nenosiri lako la sasa la malipo la tarakimu 6.', 'Entrez votre mot de passe de transaction actuel \u00e0 6 chiffres.', 'Andika ijambobanga ryawe ry\'ubucuruzi urimo gukoresha rigizwe n\'imibare 6.', 'Handiika ekisumuruzo kyaawe ky\'okushuubura ekiriho hati eky\'enamba 6.'],
  ['Login Password (at least 10 characters)', 'Ekisumuluzo ky\'Okuyingira (obutasingako bubonero 6)', 'Nenosiri la Kuingia (angalau herufi 10)', 'Mot de passe de connexion (10 caract\u00e8res minimum)', 'Ijambobanga ryo kwinjira (nibura inyuguti 10)', 'Ekisumuruzo ky\'Okutaaha (obukiri bubonero 6)'],
  ['No channel link is set yet.', 'Tewannabaawo lyanka lya kitundu.', 'Hakuna kiungo cha chaneli kilichowekwa bado.', 'Aucun lien de canal n\'est encore d\u00e9fini.', 'Nta murongo w\'umuyoboro urashyirwaho.', 'Tihariho orunyiriri rw\'ekitundu.'],
  ['Please enter the treasure chest key', 'Wandiika ekisumuluzo ky\'essanduku ly\'obugagga', 'Tafadhali weka ufunguo wa sanduku la hazina', 'Veuillez saisir la cl\u00e9 du coffre au tr\u00e9sor', 'Nyamuneka andika urufunguzo rw\'agasanduku k\'ubutunzi', 'Handiika ekishumuruzo ky\'esanduuku y\'obugaiga'],
  ['Please enter your actual payment account', 'Wandiika akawunti yo ey\'okusasula ey\'amazima', 'Tafadhali weka akaunti halisi utakayotumia kulipa', 'Veuillez saisir le compte de paiement que vous utiliserez r\u00e9ellement', 'Nyamuneka andika konti nyayo uzakoresha wishyura', 'Handiika akaunti yaawe y\'okushashura ey\'amazima'],
  ['Recharges are not available right now.', 'Okuteeka ssente tekusoboka kati.', 'Kuweka pesa hakupatikani kwa sasa.', 'Les recharges ne sont pas disponibles pour le moment.', 'Kubitsa ntibishoboka muri iki gihe.', 'Okuta sente tikirikubaasika hati.'],
  ['to check if it is successful', 'okukebera oba kigenze bulungi', 'ili kuangalia kama imefanikiwa', 'pour v\u00e9rifier si le paiement a r\u00e9ussi', 'kugira ngo urebe niba byagenze neza', 'kureeba yaaba kigyenzire gye'],
  ['Winnings go straight into your wallet.', 'Ebiwangulwa bigenda butereevu mu nsawo yo.', 'Ushindi huingia moja kwa moja kwenye pochi yako.', 'Les gains vont directement dans votre portefeuille.', 'Ibyo watsindiye bijya ako kanya mu mufuka wawe.', 'Ebi osiingwire nibigyenda butunu omu nsaho yaawe.'],
  ['Approve the payment to complete your deposit.', 'Kkiriza okusasula omalirize okuteeka ssente.', 'Idhinisha malipo ili kukamilisha kuweka pesa.', 'Approuvez le paiement pour terminer votre recharge.', 'Emeza ubwishyu kugira ngo urangize kubitsa.', 'Ikiriza okushashura omarizeho okuta sente.'],
  ['Check your phone for the payment prompt.', 'Kebera essimu yo olabe obubaka bw\'okusasula.', 'Angalia simu yako kwa ujumbe wa malipo.', 'V\u00e9rifiez votre t\u00e9l\u00e9phone pour la demande de paiement.', 'Reba kuri telefone yawe ubutumwa bwo kwishyura.', 'Reeba esimu yaawe oreebe obutumwa bw\'okushashura.'],
  ['Enter the mobile money number to charge.', 'Wandiika ennamba ya mobile money gy\'oggyako ssente.', 'Weka namba ya mobile money itakayotozwa.', 'Entrez le num\u00e9ro mobile money \u00e0 d\u00e9biter.', 'Andika nimero ya mobile money izakurwaho amafaranga.', 'Handiika enamba ya mobile money ei orikwihaho sente.'],
  ['Enter your key to unlock the reward', 'Wandiika ekisumuluzo kyo oggulewo empeera', 'Weka ufunguo wako ili kufungua zawadi', 'Entrez votre cl\u00e9 pour d\u00e9bloquer la r\u00e9compense', 'Andika urufunguzo rwawe ufungure igihembo', 'Handiika ekishumuruzo kyaawe oshumuurure empeera'],
  ['Password must be at least 10 characters.', 'Ekisumuluzo kiteekwa okuba n\'obubonero obutasinga mu 10.', 'Nenosiri lazima liwe na angalau herufi 10.', 'Le mot de passe doit comporter au moins 10 caract\u00e8res.', 'Ijambobanga rigomba kuba rifite nibura inyuguti 10.', 'Ekisumuruzo kishemereire kugira obubonero obukiri 10.'],
  ['Please do not save old account recharge.', 'Tokozesa kawunti ya dda okuteeka ssente.', 'Tafadhali usitumie akaunti ya zamani kuweka pesa.', 'N\'utilisez pas un ancien compte pour la recharge.', 'Nyamuneka ntugakoreshe konti ya kera wishyura.', 'Otakozesa akaunti ya ira okuta sente.'],
  ['The mobile phone number format is incorrect', 'Ennamba ya ssimu tewandiikiddwa bulungi', 'Muundo wa namba ya simu si sahihi', 'Le format du num\u00e9ro de t\u00e9l\u00e9phone est incorrect', 'Imiterere ya nimero ya telefone si nyayo', 'Enamba ya esimu tehandiikirwe gye'],
  ['The two login passwords do not match.', 'Ebisumuluzo ebibiri eby\'okuyingira tebifaanagana.', 'Manenosiri mawili ya kuingia hayafanani.', 'Les deux mots de passe de connexion ne correspondent pas.', 'Amagambobanga yombi yo kwinjira ntahuye.', 'Ebisumuruzo bibiri by\'okutaaha tibirikushushana.'],
  ['The two new passwords do not match.', 'Ebisumuluzo ebiggya ebibiri tebifaanagana.', 'Manenosiri mawili mapya hayafanani.', 'Les deux nouveaux mots de passe ne correspondent pas.', 'Amagambobanga mashya yombi ntahuye.', 'Ebisumuruzo bibiri ebisya tibirikushushana.'],
  ['Trade Password must be exactly 6 digits.', 'Ekisumuluzo ky\'okusuubula kiteekwa okuba nnamba 6 zokka.', 'Nenosiri la malipo lazima liwe tarakimu 6 haswa.', 'Le mot de passe de transaction doit comporter exactement 6 chiffres.', 'Ijambobanga ry\'ubucuruzi rigomba kuba rigizwe n\'imibare 6 gusa.', 'Ekisumuruzo ky\'okushuubura kishemereire kuba enamba 6 zoonka.'],
  ['Earn daily wages by inviting members to invest.', 'Funa ssente buli lunaku ng\'oyita abantu okuteekamu ssente.', 'Pata malipo kila siku kwa kualika wengine kuwekeza.', 'Gagnez chaque jour en invitant des membres \u00e0 investir.', 'Injiza amafaranga buri munsi utumira abandi gushora.', 'Tunga sente buri izooba oyeta abantu kuteeramu sente.'],
  ['One free spin every day, resetting at midnight.', 'Okuzungusa kumu kwa bwereere buli lunaku, nga kuddamu ku ttumbi.', 'Nafasi moja ya bure ya kuzungusha kila siku, inarudia usiku wa manane.', 'Un tour gratuit chaque jour, r\u00e9initialis\u00e9 \u00e0 minuit.', 'Kuzunguza rimwe ku buntu buri munsi, bisubirana saa sita z\'ijoro.', 'Okuzengurutsa rumwe okw\'obusa buri izooba, nikugarukamu aha kiro.'],
  ['Paste the payment SMS or transaction ID first', 'Sooka oteeke obubaka bw\'okusasula oba nnamba y\'okusasula', 'Kwanza bandika SMS ya malipo au namba ya muamala', 'Collez d\'abord le SMS de paiement ou l\'identifiant de la transaction', 'Banza ushyiremo SMS y\'ubwishyu cyangwa nimero y\'ubwishyu', 'Banza ota obutumwa bw\'okushashura nari enamba y\'okushashura'],
  ['The two new trade passwords do not match.', 'Ebisumuluzo ebiggya eby\'okusuubula tebifaanagana.', 'Manenosiri mawili mapya ya malipo hayafanani.', 'Les deux nouveaux mots de passe de transaction ne correspondent pas.', 'Amagambobanga mashya y\'ubucuruzi ntahuye.', 'Ebisumuruzo ebisya by\'okushuubura tibirikushushana.'],
  ['Invite friends. Earn when they buy their first product.', 'Yita mikwano gyo. Ofuna ssente nga bagudde ekyamaguzi kyabwe ekisooka.', 'Alika marafiki. Unapata pesa wanaponunua bidhaa yao ya kwanza.', 'Invitez vos amis. Gagnez lorsqu\'ils ach\u00e8tent leur premier produit.', 'Tumira inshuti. Winjiza amafaranga igihe baguze igicuruzwa cyabo cya mbere.', 'Yeta abanywani baawe. Notunga sente ku barikugura ekyamaguzi kyabo eky\'okubanza.'],
  ['Share your link, create your wealth, improve your life.', 'Gaba lyanka lyo, okole obugagga bwo, otereeze obulamu bwo.', 'Shiriki kiungo chako, jenga utajiri wako, boresha maisha yako.', 'Partagez votre lien, b\u00e2tissez votre richesse, am\u00e9liorez votre vie.', 'Sangiza umurongo wawe, wubake ubutunzi bwawe, unoze ubuzima bwawe.', 'Gabana orunyiriri rwaawe, okore obugaiga bwaawe, otebeekanise amagara gaawe.'],
  ['We\'re getting ready. Come back once the countdown ends.', 'Tukyeteekateeka. Komawo essaawa bwe zinaggwaako.', 'Tunajiandaa. Rudi hesabu ya kurudi nyuma itakapoisha.', 'Nous nous pr\u00e9parons. Revenez \u00e0 la fin du compte \u00e0 rebours.', 'Turimo kwitegura. Garuka igihe kubara kuzarangira.', 'Nitweteekateeka. Garuka obu obwire burihwaho.'],
  ['Your new password must be at least 10 characters.', 'Ekisumuluzo kyo ekiggya kiteekwa okuba n\'obubonero obutasinga mu 10.', 'Nenosiri lako jipya lazima liwe na angalau herufi 10.', 'Votre nouveau mot de passe doit comporter au moins 10 caract\u00e8res.', 'Ijambobanga ryawe rishya rigomba kuba rifite nibura inyuguti 10.', 'Ekisumuruzo kyaawe ekisya kishemereire kugira obubonero obukiri 10.'],
  ['Your new trade password must be exactly 6 digits.', 'Ekisumuluzo kyo ekiggya eky\'okusuubula kiteekwa okuba nnamba 6 zokka.', 'Nenosiri lako jipya la malipo lazima liwe tarakimu 6 haswa.', 'Votre nouveau mot de passe de transaction doit comporter exactement 6 chiffres.', 'Ijambobanga ryawe rishya ry\'ubucuruzi rigomba kuba rigizwe n\'imibare 6 gusa.', 'Ekisumuruzo kyaawe ekisya ky\'okushuubura kishemereire kuba enamba 6 zoonka.'],
  ['If deposit is not received, please contact TG customer service.', 'Ssente bwe zitatuuka, tuukirira obuyambi ku TG.', 'Ikiwa malipo hayajapokelewa, tafadhali wasiliana na huduma kwa wateja kwenye TG.', 'Si le d\u00e9p\u00f4t n\'est pas re\u00e7u, contactez le service client sur TG.', 'Niba amafaranga atakiriwe, nyamuneka vugana na serivisi z\'abakiriya kuri TG.', 'Sente ku zitarikuhika, otukirire obuhwezi aha TG.'],
  ['The payment is expected to be successful in 2-10 minutes.', 'Okusasula kusuubirwa okuggwa mu ddakiika 2-10.', 'Malipo yanatarajiwa kukamilika ndani ya dakika 2-10.', 'Le paiement devrait aboutir en 2 \u00e0 10 minutes.', 'Ubwishyu buteganyijwe kurangira mu minota 2-10.', 'Okushashura nikwetegyerezibwa kuhwa omu dakiika 2-10.'],
  ['Your new password must be different from the old one.', 'Ekisumuluzo kyo ekiggya kiteekwa okuba ekitali kye kikadde.', 'Nenosiri lako jipya lazima liwe tofauti na la zamani.', 'Votre nouveau mot de passe doit \u00eatre diff\u00e9rent de l\'ancien.', 'Ijambobanga ryawe rishya rigomba gutandukana n\'irya kera.', 'Ekisumuruzo kyaawe ekisya kishemereire kuba ekitari kiri ekikuru.'],
  ['Customer service is not set up yet. Please try again later.', 'Obuyambi eri abaguzi tebunnateekebwawo. Ddamu ogezeeko oluvannyuma.', 'Huduma kwa wateja haijawekwa bado. Tafadhali jaribu tena baadaye.', 'Le service client n\'est pas encore configur\u00e9. R\u00e9essayez plus tard.', 'Serivisi z\'abakiriya ntiziratunganywa. Nyamuneka ongera ugerageze nyuma.', 'Obuhwezi bw\'abaguzi tiburateebwaho. Ogarukyemu bwanyima.'],
  ['Your balance will be updated automatically once the payment is confirmed.', 'Ssente zo zijja kukyusibwa zokka okusasula bwe kunaakakasibwa.', 'Salio lako litasasishwa lenyewe mara malipo yatakapothibitishwa.', 'Votre solde sera mis \u00e0 jour automatiquement d\u00e8s la confirmation du paiement.', 'Amafaranga yawe azavugururwa wenyine ubwishyu bumaze kwemezwa.', 'Sente zaawe nizihindurwa zoonka okushashura ku kurihamibwa.'],
  ['Your new trade password must be different from the old one.', 'Ekisumuluzo kyo ekiggya eky\'okusuubula kiteekwa okuba ekitali kye kikadde.', 'Nenosiri lako jipya la malipo lazima liwe tofauti na la zamani.', 'Votre nouveau mot de passe de transaction doit \u00eatre diff\u00e9rent de l\'ancien.', 'Ijambobanga ryawe rishya ry\'ubucuruzi rigomba gutandukana n\'irya kera.', 'Ekisumuruzo kyaawe ekisya ky\'okushuubura kishemereire kuba ekitari kiri ekikuru.'],
  ['Not confirmed yet. Approve the payment prompt on your phone, then tap Verify again.', 'Tekunnakakasibwa. Kkiriza obubaka bw\'okusasula ku ssimu yo, oluvannyuma oddemu onyige Kakasa.', 'Bado hayajathibitishwa. Idhinisha ujumbe wa malipo kwenye simu yako, kisha gusa Hakiki tena.', 'Pas encore confirm\u00e9. Approuvez la demande de paiement sur votre t\u00e9l\u00e9phone, puis appuyez de nouveau sur V\u00e9rifier.', 'Ntibiremezwa. Emeza ubutumwa bwo kwishyura kuri telefone yawe, hanyuma wongere ukande Genzura.', 'Tikirahamibwa. Ikiriza obutumwa bw\'okushashura aha simu yaawe, bwanyima ogarukyemu okande Hamya.'],
  ['Your trade password is your 6-digit PIN used to confirm withdrawals and other sensitive actions.', 'Ekisumuluzo kyo eky\'okusuubula ye nnamba 6 z\'okozesa okukakasa okuggyamu ssente n\'ebirala ebikulu.', 'Nenosiri lako la malipo ni PIN ya tarakimu 6 unayotumia kuthibitisha kutoa pesa na mambo mengine nyeti.', 'Votre mot de passe de transaction est le code \u00e0 6 chiffres qui confirme vos retraits et autres op\u00e9rations sensibles.', 'Ijambobanga ryawe ry\'ubucuruzi ni PIN y\'imibare 6 ukoresha wemeza kubikuza n\'ibindi bikorwa by\'ingenzi.', 'Ekisumuruzo kyaawe ky\'okushuubura n\'enamba 6 ezi orikukozesa okuhamya okwihamu sente n\'ebindi ebikuru.'],
  ['A referral code is required to sign up. Ask the person who invited you for theirs.', 'Weetaaga koodi y\'okuyita okwewandiisa. Saba oyo eyakuyise akuwe eyiye.', 'Msimbo wa mwaliko unahitajika ili kujisajili. Muulize aliyekualika akupe wake.', 'Un code de parrainage est n\u00e9cessaire pour s\'inscrire. Demandez le sien \u00e0 la personne qui vous a invit\u00e9.', 'Kode yo gutumira irakenewe kugira ngo wiyandikishe. Saba uwagutumiye akuhe iye.', 'Noyetenga koodi y\'okweta kwewandiisa. Shaba ou akweeta akuhe eye.'],
  ['Install it on your phone for faster access, and open it straight from your home screen.', 'Giteeke ku ssimu yo osobole okugituukako mangu, era ogigulewo butereevu okuva ku ntikko ya ssimu yo.', 'Isakinishe kwenye simu yako ili kuifikia haraka, na uifungue moja kwa moja kutoka skrini ya nyumbani.', 'Installez-la sur votre t\u00e9l\u00e9phone pour un acc\u00e8s plus rapide, et ouvrez-la directement depuis votre \u00e9cran d\'accueil.', 'Yishyire kuri telefone yawe kugira ngo uyigereho vuba, unayifungure uhereye ku rupapuro rwawe rw\'ibanze.', 'Giteere aha simu yaawe obaase kugihikaho juba, kandi ogyigure butunu kuruga aha karatasi kaawe ak\'okubanza.'],
  ['Please fill in your payment account accurately, incorrect filling may result in the loss of the transferred funds.', 'Wandiika akawunti yo ey\'okusasula obulungi; bw\'ogiwandiika obubi osobola okufiirwa ssente z\'oweerezza.', 'Tafadhali jaza akaunti yako ya malipo kwa usahihi; ukikosea unaweza kupoteza pesa ulizotuma.', 'Veuillez saisir votre compte de paiement avec exactitude ; une erreur peut entra\u00eener la perte des fonds transf\u00e9r\u00e9s.', 'Nyamuneka andika konti yawe yo kwishyura neza; ukosheje ushobora gutakaza amafaranga wohereje.', 'Handiika akaunti yaawe y\'okushashura gye; ku orikuhandiika kubi noobaasa kufeerwa sente ezi ohereize.'],
  ['Please fill in your payment method and the actual payment account you will use to make the payment.', 'Wandiika engeri y\'okusasula n\'akawunti ey\'amazima gy\'onookozesa okusasula.', 'Tafadhali jaza njia ya malipo na akaunti halisi utakayotumia kulipa.', 'Veuillez indiquer votre mode de paiement et le compte que vous utiliserez r\u00e9ellement pour payer.', 'Nyamuneka andika uburyo bwo kwishyura na konti nyayo uzakoresha wishyura.', 'Handiika omuringo gw\'okushashura n\'akaunti ey\'amazima ei orikwija kukozesa okushashura.'],
  ['Paste the whole confirmation message your phone received after you sent the money. Our team checks it and credits your balance.', 'Teeka obubaka bwonna obwakakasa obwatuuse ku ssimu yo nga omaze okusindika ssente. Ekibiina kyaffe kibukebera ne bakuteekera ssente.', 'Bandika ujumbe wote wa uthibitisho uliopokelewa kwenye simu yako baada ya kutuma pesa. Timu yetu itauangalia na kuongeza salio lako.', 'Collez l\'int\u00e9gralit\u00e9 du message de confirmation re\u00e7u sur votre t\u00e9l\u00e9phone apr\u00e8s l\'envoi de l\'argent. Notre \u00e9quipe le v\u00e9rifie et cr\u00e9dite votre solde.', 'Shyiramo ubutumwa bwose bwo kwemeza telefone yawe yakiriye nyuma yo kohereza amafaranga. Ikipe yacu irabusuzuma maze ikongera amafaranga yawe.', 'Ota obutumwa bwona obw\'okuhamya obu esimu yaawe eyakiire bwanyima y\'okutuma sente. Ekibiina kyaitu nikibureeba kandi bakakwongyeza sente.'],
  // ── Added by add-i18n-coverage.py after measuring the real screens ──
  // Everything below was found by find-untranslated.py driving the built
  // app in Swahili and reading back every visible text node -- not by a
  // regex over the sources, which is how they were missed in the first
  // place. 'Failed' and 'Paid' are the two the owner named himself.
  ['Paid', 'Kisasuddwa', 'Imelipwa', 'Payé', 'Byishyuwe', 'Kishashwirwe'],
  ['Failed', 'Kigaanye', 'Imeshindwa', 'Échoué', 'Byanze', 'Kyaremeire'],
  ['Pending', 'Kilindirira', 'Inasubiri', 'En attente', 'Birategerejwe', 'Nikitegyereza'],
  ['Active', 'Kikola', 'Inaendelea', 'En cours', 'Birakomeza', 'Nikikora'],
  ['Completed', 'Kiwedde', 'Imekamilika', 'Terminé', 'Byarangiye', 'Kihikire'],
  ['No active plans right now', 'Tewali nteekateeka ekola kati', 'Hakuna mipango inayoendelea sasa', 'Aucun plan actif pour le moment', 'Nta gahunda irakora ubu', 'Tihariho nteekateeka erikukora hati'],
  ['No active plans. Check Completed to see the ones that finished.', 'Tewali nteekateeka ekola. Nyiga Kiwedde okulaba ezo ezaggwa.', 'Hakuna mipango inayoendelea. Gusa Imekamilika kuona iliyokwisha.', 'Aucun plan actif. Ouvrez Terminé pour voir ceux qui sont arrivés à terme.', 'Nta gahunda irakora. Kanda Byarangiye urebe izarangiye.', 'Tihariho nteekateeka erikukora. Kanda Kihikire kureeba ezo ezahwire.'],
  ['Transaction', 'Okukyusa ssente', 'Muamala', '=', 'Igikorwa', 'Okuhingura sente'],
  ['OK', 'Kale', 'Sawa', '=', 'Yego', 'Kale'],
  ['days', 'ennaku', 'siku', 'jours', 'iminsi', 'ebiro'],
  ['Bind Wallet', 'Teeka Ensawo', 'Sajili Pochi', 'Associer le portefeuille', 'Andika umufuka', 'Teeka Ensaho'],
  ['Change Wallet', 'Kyusa Ensawo', 'Badilisha Pochi', 'Changer de portefeuille', 'Hindura umufuka', 'Hindura Ensaho'],
  ['NO WALLET BOUND', 'TEWALI NSAWO ETEEKEDDWA', 'HAKUNA POCHI ILIYOSAJILIWA', 'AUCUN PORTEFEUILLE ASSOCIÉ', 'NTA MUFUKA WANDITSWE', 'TIHARIHO NSAHO ETEIREHO'],
  ['Get the mobile app', 'Funa pulogulaamu ya ssimu', 'Pata programu ya simu', 'Obtenez l\'application mobile', 'Kura porogaramu ya telefone', 'Tunga porogaraamu ya esimu'],
  ['Manage your withdrawal wallet', 'Ddukanya ensawo yo ey\'okuggyamu ssente', 'Dhibiti pochi yako ya kutoa pesa', 'Gérez votre portefeuille de retrait', 'Genzura umufuka wawe wo kubikuza', 'Jwara ensaho yaawe y\'okwihamu sente'],
  ['Transaction history', 'Ebyafaayo by\'ensimbi', 'Historia ya miamala', 'Historique des transactions', 'Amateka y\'ibikorwa', 'Ebyafaayo bya sente'],
  ['Notifications & mail', 'Obubaka n\'ebirango', 'Arifa na barua', 'Notifications et messages', 'Amatangazo n\'ubutumwa', 'Obutumwa n\'ebirango'],
  ['Change login password', 'Kyusa ekisumuluzo ky\'okuyingira', 'Badilisha nenosiri la kuingia', 'Changer le mot de passe de connexion', 'Hindura ijambobanga ryo kwinjira', 'Hindura ekisumuruzo ky\'okutaaha'],
  ['Change trade / withdrawal password', 'Kyusa ekisumuluzo ky\'okusuubula / okuggyamu', 'Badilisha nenosiri la malipo / kutoa pesa', 'Changer le mot de passe de transaction / retrait', 'Hindura ijambobanga ry\'ubucuruzi / ryo kubikuza', 'Hindura ekisumuruzo ky\'okushuubura / okwihamu'],
  ['Enter old password', 'Wandiika ekisumuluzo ekikadde', 'Weka nenosiri la zamani', 'Entrez l\'ancien mot de passe', 'Andika ijambobanga rya kera', 'Handiika ekisumuruzo ekikuru'],
  ['Enter new password', 'Wandiika ekisumuluzo ekiggya', 'Weka nenosiri jipya', 'Entrez le nouveau mot de passe', 'Andika ijambobanga rishya', 'Handiika ekisumuruzo ekisya'],
  ['Re-enter new password', 'Ddamu owandiike ekisumuluzo ekiggya', 'Weka tena nenosiri jipya', 'Saisissez à nouveau le nouveau mot de passe', 'Ongera wandike ijambobanga rishya', 'Garuka ohandiike ekisumuruzo ekisya'],
  ['Enter old 6-digit PIN', 'Wandiika PIN enkadde ey\'ennamba 6', 'Weka PIN ya zamani ya tarakimu 6', 'Entrez l\'ancien code à 6 chiffres', 'Andika PIN ya kera y\'imibare 6', 'Handiika PIN enkuru y\'enamba 6'],
  ['Enter new 6-digit PIN', 'Wandiika PIN empya ey\'ennamba 6', 'Weka PIN mpya ya tarakimu 6', 'Entrez le nouveau code à 6 chiffres', 'Andika PIN nshya y\'imibare 6', 'Handiika PIN ensya y\'enamba 6'],
  ['Re-enter new 6-digit PIN', 'Ddamu owandiike PIN empya ey\'ennamba 6', 'Weka tena PIN mpya ya tarakimu 6', 'Saisissez à nouveau le nouveau code à 6 chiffres', 'Ongera wandike PIN nshya y\'imibare 6', 'Garuka ohandiike PIN ensya y\'enamba 6'],
  ['No spins left. Your next free spin unlocks at midnight.', 'Tewali kuzungusa kusigadde. Okuzungusa okw\'obwereere okuddako kujja mu ttumbi.', 'Hakuna mizungusho iliyobaki. Mzungusho wako wa bure unaofuata unafunguka usiku wa manane.', 'Plus de tours disponibles. Votre prochain tour gratuit s\'ouvre à minuit.', 'Nta kuzunguza gusigaye. Ukuzunguza kwawe k\'ubuntu gukurikira gutangira saa sita z\'ijoro.', 'Tihariho kuzengurutsa kusigaire. Okuzengurutsa kwaawe kw\'obusa nikwija aha kiro.'],
  ['1 spin available', 'Okuzungusa 1 kuliwo', 'Mzungusho 1 unapatikana', '1 tour disponible', 'Kuzunguza 1 gurahari', 'Okuzengurutsa 1 kuriho'],
  ['Contact support for help with your account.', 'Tuukirira abayambi ku bikwata ku akawunti yo.', 'Wasiliana na msaada kwa usaidizi wa akaunti yako.', 'Contactez l\'assistance pour toute question sur votre compte.', 'Vugana na serivisi y\'abakiriya ku bibazo bya konti yawe.', 'Hikirira abahwezi ahabw\'akaunti yaawe.'],
  ['Uganda\'s boldest way to grow your money', 'Engeri esinga obuvumu mu Uganda okukuza ssente zo', 'Njia jasiri zaidi Uganda ya kukuza pesa zako', 'La façon la plus audacieuse d\'Ouganda de faire fructifier votre argent', 'Inzira ishize amanga cyane mu Uganda yo kwungura amafaranga yawe', 'Omuringo ogurikukira obumanzi muri Uganda kukuza sente zaawe'],
  ['If nothing happens, the app is already installed — open it from your home screen. On iPhone, use Share then "Add to Home Screen".', 'Bwe watabaawo kantu, pulogulaamu eteekeddwawo dda — gigguleko ku ssemasomero lyo. Ku iPhone, kozesa Share olyoke oyongere "Add to Home Screen".', 'Kama hakuna kinachotokea, programu imesakinishwa tayari — ifungue kutoka skrini yako ya kwanza. Kwenye iPhone, tumia Share kisha "Add to Home Screen".', "Si rien ne se passe, l'application est déjà installée — ouvrez-la depuis votre écran d'accueil. Sur iPhone, utilisez Partager puis « Sur l'écran d'accueil ».", 'Niba nta kibaye, porogaramu yamaze gushyirwaho — ifungure ku rupapuro rwawe rw’ibanze. Kuri iPhone, koresha Share hanyuma "Add to Home Screen".', 'Ku kutaribaho kintu, porogaraamu yaateirweho — gyigyure aha ndabiro yaawe. Aha iPhone, kozesa Share reero “Add to Home Screen”.'],
  // The LETTER is what identifies a payment method, and it is deliberately
  // kept: the admin panel where he configures these still says PAY-A / PAY B,
  // so a member naming one is still unambiguous whichever language he reads.
  // Only the English word around it is translated.
  ['PAY-A', 'SASULA-A', 'LIPA-A', 'PAYER-A', 'ISHYURA-A', 'SHASHURA-A'],
  ['PAY B', 'SASULA B', 'LIPA B', 'PAYER B', 'ISHYURA B', 'SHASHURA B'],
  // The founder-account wording: what the very FIRST member of a new country
  // sees on Sign Up, when there is no referral code for them to type yet.
  // Found only after the coverage sweep was made to render that state -- the
  // fixture had always demanded a code, so this pair of sentences
  // had never once been on screen while anything was measuring.
  ['Referral code (optional)', "Koodi y'okuyita (teetaagisa)", 'Msimbo wa mwaliko (si lazima)', 'Code de parrainage (facultatif)', 'Kode yo gutumira (ntikenewe)', "Koodi y'okweta (tikyetengyesa)"],
  // ── Popup messages, and the activity ticker's own verbs ──
  // A popup only appears when something goes WRONG, and the coverage
  // sweep walks every screen successfully -- so 58 notify() call sites
  // existed and exactly one had ever been on screen while anything was
  // measuring. Found by extracting the arguments of every call site
  // instead. The ticker verbs had never rendered either: its fixture
  // fed it an empty feed.
  ['Could not load your account', 'Tetusobodde kuzuula akawunti yo', 'Imeshindwa kupakia akaunti yako', 'Impossible de charger votre compte', 'Ntibyashobotse gupakira konti yawe', 'Tikibaasiikire kureeta akaunti yaawe'],
  ['Could not complete registration', 'Tetusobodde kumaliriza kwewandiisa', 'Imeshindwa kukamilisha usajili', 'Impossible de finaliser l\'inscription', 'Ntibyashobotse kurangiza kwiyandikisha', 'Tikibaasiikire kumaliriza okwehandiisa'],
  ['Could not save your wallet.', 'Tetusobodde kutereka nsawo yo.', 'Imeshindwa kuhifadhi pochi yako.', 'Impossible d\'enregistrer votre portefeuille.', 'Ntibyashobotse kubika umufuka wawe.', 'Tikibaasiikire kubiika ensaho yaawe.'],
  ['Could not start deposit', 'Tetusobodde kutandika kuteeka ssente', 'Imeshindwa kuanza kuweka pesa', 'Impossible de démarrer la recharge', 'Ntibyashobotse gutangira kubitsa', 'Tikibaasiikire kutandika kuta sente'],
  ['Could not request withdrawal.', 'Tetusobodde kusaba kuggyamu ssente.', 'Imeshindwa kuomba kutoa pesa.', 'Impossible de demander le retrait.', 'Ntibyashobotse gusaba kubikuza.', 'Tikibaasiikire kushaba okwihamu sente.'],
  ['Could not complete purchase', 'Tetusobodde kumaliriza kugula', 'Imeshindwa kukamilisha ununuzi', 'Impossible de finaliser l\'achat', 'Ntibyashobotse kurangiza kugura', 'Tikibaasiikire kumaliriza okugura'],
  ['Could not check in', 'Tetusobodde kukyalira', 'Imeshindwa kuhudhuria', 'Impossible de pointer', 'Ntibyashobotse kwiyandikisha', 'Tikibaasiikire kwoleka'],
  ['Could not change your trade password.', 'Tetusobodde kukyusa kisumuluzo kyo eky\'okusuubula.', 'Imeshindwa kubadilisha nenosiri lako la malipo.', 'Impossible de changer votre mot de passe de transaction.', 'Ntibyashobotse guhindura ijambobanga ryawe ry\'ubucuruzi.', 'Tikibaasiikire kuhindura ekisumuruzo kyaawe ky\'okushuubura.'],
  ['Could not check right now', 'Tetusobodde kukebera kati', 'Imeshindwa kuangalia kwa sasa', 'Vérification impossible pour le moment', 'Ntibyashobotse kugenzura ubu', 'Tikibaasiikire kureeba hati'],
  ['Could not submit this right now', 'Tetusobodde kusindika kino kati', 'Imeshindwa kuwasilisha hili kwa sasa', 'Envoi impossible pour le moment', 'Ntibyashobotse kohereza ibi ubu', 'Tikibaasiikire kutuma eki hati'],
  ['That is not your current login password.', 'Ekyo si kisumuluzo kyo kya kati eky\'okuyingira.', 'Hilo si nenosiri lako la sasa la kuingia.', 'Ce n\'est pas votre mot de passe de connexion actuel.', 'Iryo si ijambobanga ryawe rigezweho ryo kwinjira.', 'Ekyo tikisumuruzo kyaawe kya hati eky\'okutaaha.'],
  ['That key did not open the chest.', 'Ekisumuluzo ekyo tekiggudde ssanduku.', 'Ufunguo huo haukufungua sanduku.', 'Cette clé n\'a pas ouvert le coffre.', 'Urwo rufunguzo ntirwafunguye agasanduku.', 'Ekishumuruzo ekyo tikyigwire esanduuku.'],
  ['The spin could not be completed.', 'Okuzungusa tekusobose kuggwa.', 'Mzungusho haukukamilika.', 'Le tour n\'a pas pu être terminé.', 'Ukuzunguza ntikwashoboye kurangira.', 'Okuzengurutsa tikibaasiikire kuhika.'],
  ['That referral code is invalid. Continuing without it.', 'Koodi y\'okuyita eyo si ntuufu. Tugenda mu maaso nga tetugikozesa.', 'Msimbo huo wa mwaliko si sahihi. Tunaendelea bila huo.', 'Ce code de parrainage est invalide. Nous continuons sans lui.', 'Iyo kode yo gutumira ntiyemewe. Turakomeza tutayikoresheje.', 'Koodi y\'okweta egyo tehikire. Nitugyenda omu maisho tutarikugikozesa.'],
  ['Not confirmed yet. Paste the payment message below and submit it.', 'Tekinnakakasibwa. Teeka obubaka bw\'okusasula wammanga obusindike.', 'Bado haijathibitishwa. Bandika ujumbe wa malipo hapa chini na uwasilishe.', 'Pas encore confirmé. Collez le message de paiement ci-dessous et envoyez-le.', 'Ntibirasuzumwa. Shyiramo ubutumwa bwo kwishyura hasi maze ubwohereze.', 'Tikirahamibwa. Ota obutumwa bw\'okushashura ahansi kandi obutume.'],
  ['Submitted', 'Kisindikiddwa', 'Imewasilishwa', 'Envoyé', 'Byoherejwe', 'Kitumirwe'],
  ['The payment request timed out before it was approved on the phone. Nothing was taken. Start a new recharge to try again.', 'Okusaba okusasula kwaggwaako nga tekukkirizibbwa ku ssimu. Tewali ssente eziggiddwa. Tandika okuteekamu ssente okuppya.', 'Ombi la malipo limeisha muda kabla ya kuidhinishwa kwenye simu. Hakuna pesa iliyochukuliwa. Anza kuweka pesa tena.', "La demande de paiement a expiré avant d'être approuvée sur le téléphone. Rien n'a été prélevé. Lancez une nouvelle recharge.", 'Icyifuzo cyo kwishyura cyarangiye mbere yuko cyemezwa kuri telefone. Nta mafaranga yafashwe. Tangira kubitsa bushya.', 'Okushaba okushashura kukahwa kitakaikirizibwa aha simu. Tihariho sente ezihiirwe. Tandika kuteeramu sente burundi.'],
  ['topped up', 'yateekamu ssente', 'ameweka pesa', 'a rechargé', 'yabitsa', 'yaateeramu sente'],
  ['cashed out', 'yaggyamu ssente', 'ametoa pesa', 'a retiré', 'yabikuje', 'yaayihamu sente'],
  ['just deposited', 'yaakateekamu ssente', 'ameweka pesa hivi punde', 'vient de recharger', 'aherutse kubitsa', 'yaahingwire kuteeramu sente'],
  ['just withdrew', 'yaakaggyamu ssente', 'ametoa pesa hivi punde', 'vient de retirer', 'aherutse kubikuza', 'yaahingwire kwihamu sente'],
];
// ── SENTENCES WITH A FIGURE SPLICED INTO THEM ──
// The table above matches a WHOLE string, which by construction can never
// match a sentence built at render time: "Fee: 15%" is a different string for
// every fee, so it would need a row per value. This is the second lookup --
// each row is a TEMPLATE with {0}/{1} where the figure goes, matched against
// the rendered text, and the captured figures are dropped into the
// translation untouched.
//
// Two rules make this safe on a money screen:
//   * only the LITERAL words are translated. Whatever {0} captured is copied
//     across verbatim, so an amount, a date, a percentage or an account id
//     can never be rewritten, reordered or re-formatted by a translation.
//   * a template is only tried when the whole string matches end to end, so
//     a pattern cannot rewrite part of a sentence it does not own.
// Placeholders are NUMBERED, not positional, because a translation is allowed
// to put them in a different order than English does.
var LANG_PATTERNS = [
  // [english template, lg, sw, fr, rw, nyn]
  ['About {0}', 'Ku {0}', 'Kuhusu {0}', 'À propos de {0}', 'Ibyerekeye {0}', 'Ahabwa {0}'],
  ['Get the {0} app', 'Funa pulogulaamu ya {0}', 'Pata programu ya {0}', "Obtenez l'application {0}", 'Kura porogaramu ya {0}', 'Tunga porogaraamu ya {0}'],
  ['Your login password is used to sign in to your {0} account.', "Ekisumuluzo kyo eky'okuyingira kikozesebwa okuyingira mu akawunti yo ya {0}.", 'Nenosiri lako la kuingia hutumika kuingia katika akaunti yako ya {0}.', 'Votre mot de passe de connexion sert à vous connecter à votre compte {0}.', 'Ijambobanga ryawe ryo kwinjira rikoreshwa kwinjira mu konti yawe ya {0}.', "Ekisumuruzo kyaawe ky'okutaaha nikikozesibwa kutaaha omu akaunti yaawe ya {0}."],
  ['{0} lets you invest in a range of products with daily income and a 3-level referral program.', '{0} kikusobozesa okuteeka ssente mu byamaguzi bya ngeri nnyingi n’ssente za buli lunaku n’enteekateeka y’okuyita ey’emitendera 3.', '{0} inakuwezesha kuwekeza katika bidhaa mbalimbali na mapato ya kila siku na mpango wa mialiko wa ngazi 3.', '{0} vous permet d’investir dans une gamme de produits avec un revenu quotidien et un programme de parrainage à 3 niveaux.', '{0} ituma ushobora gushora mu bicuruzwa bitandukanye ufite inyungu za buri munsi na gahunda yo gutumira y’inzego 3.', '{0} nikikureetera okuteeramu sente omu byamaguzi bya miringo mingi n’esente za buri izooba n’enteekateeka y’okweta ey’emirengo 3.'],
  ['Fee: {0}%.', "Ssente z'obuweereza: {0}%.", 'Ada: {0}%.', 'Frais : {0} %.', 'Amafaranga ya serivisi: {0}%.', "Sente z'obuheereza: {0}%."],
  ['Fee: {0}%', "Ssente z'obuweereza: {0}%", 'Ada: {0}%', 'Frais : {0} %', 'Amafaranga ya serivisi: {0}%', "Sente z'obuheereza: {0}%"],
  ['LV{0} = {1}%', 'Omutendera {0} = {1}%', 'Ngazi {0} = {1}%', 'Niveau {0} = {1} %', 'Urwego {0} = {1}%', 'Omurengo {0} = {1}%'],
  ['{0} Members', 'Abantu {0}', 'Wanachama {0}', '{0} membres', 'Abanyamuryango {0}', 'Abantu {0}'],
  ['Joined {0}', 'Yeegatta {0}', 'Alijiunga {0}', 'Inscrit le {0}', 'Yinjiye {0}', 'Yaayegaitaho {0}'],
  ['New Balance: {0}', 'Ssente Empya: {0}', 'Salio Jipya: {0}', 'Nouveau solde : {0}', 'Amafaranga mashya: {0}', 'Sente Ensya: {0}'],
  ['ID: {0}', 'Nnamba: {0}', 'Kitambulisho: {0}', 'Identifiant : {0}', 'Nimero: {0}', 'Enamba: {0}'],
  ['Minimum deposit amount: {0}', 'Ssente ezisembayo obutono okuteeka: {0}', 'Kiasi cha chini cha kuweka: {0}', 'Montant minimum de recharge : {0}', 'Ingano ntoya yo kubitsa: {0}', 'Sente ezirikukira obukye okuta: {0}'],
  ['Check In · {0}', 'Okukyalira · {0}', 'Kuhudhuria · {0}', 'Pointage · {0}', 'Kwiyandikisha · {0}', 'Okwoleka · {0}'],
  ['Check in once every day (resets at midnight) to keep your streak and earn {0} each time.', 'Kyalira omulundi gumu buli lunaku (kuddamu ku ttumbi) okukuuma olukalala lwo n’ofune {0} buli mulundi.', 'Hudhuria mara moja kila siku (inarudia usiku wa manane) ili kuendeleza mfululizo wako na kupata {0} kila mara.', 'Pointez une fois par jour (réinitialisé à minuit) pour conserver votre série et gagner {0} à chaque fois.', 'Iyandikishe rimwe ku munsi (bisubirana saa sita z’ijoro) kugira ngo ukomeze urukurikirane rwawe kandi wunguke {0} igihe cyose.', 'Yoleka omurundi gumwe buri izooba (nikugarukamu aha kiro) kurindira orukurato rwaawe kandi otunge {0} buri murundi.'],
  ['Withdraw time: {0} to {1}.', 'Ebiseera by’okuggyamu ssente: {0} okutuuka {1}.', 'Muda wa kutoa pesa: {0} hadi {1}.', 'Heures de retrait : de {0} à {1}.', 'Igihe cyo kubikuza: {0} kugeza {1}.', 'Obwire bw’okwihamu sente: {0} kuhika {1}.'],
  ['Amounts must be a multiple of {0} — for example {1}.', 'Omuwendo gulina kuba gwa {0} — okugeza {1}.', 'Kiasi kinapaswa kuwa kizidishi cha {0} — kwa mfano {1}.', 'Les montants doivent être un multiple de {0} — par exemple {1}.', 'Ingano igomba kuba umubare ushobora kugabanywa na {0} — urugero {1}.', 'Omuhendo gushemereire kuba gwa {0} — nk’oku {1}.'],
  ['Withdrawal amounts should be between {0} and {1}.', 'Ssente z’okuggyamu zirina kuba wakati wa {0} ne {1}.', 'Kiasi cha kutoa kinapaswa kuwa kati ya {0} na {1}.', 'Les montants de retrait doivent être compris entre {0} et {1}.', 'Ingano yo kubikuza igomba kuba iri hagati ya {0} na {1}.', 'Sente z’okwihamu zishemereire kuba hagati ya {0} na {1}.'],
  ['One cash-out at a time — once it is paid you can request the next. Up to {0} per day.', 'Okuggyamu kumu kkumu — nga kusasuddwa osobola okusaba okuddako. Okutuuka ku {0} olunaku.', 'Kutoa pesa moja kwa wakati — baada ya kulipwa unaweza kuomba kingine. Hadi {0} kwa siku.', 'Un retrait à la fois — une fois payé, vous pouvez demander le suivant. Jusqu’à {0} par jour.', 'Kubikuza rimwe gusa — iyo bimaze kwishyurwa ushobora gusaba ibikurikira. Kugeza kuri {0} ku munsi.', 'Okwihamu rumwe — ku kushashwirwe nobaasa kushaba okundi. Kuhika aha {0} aha izooba.'],
  ['{0} spins available', 'Okuzungusa {0} kuliwo', 'Mizungusho {0} inapatikana', '{0} tours disponibles', 'Kuzunguza {0} gurahari', 'Okuzengurutsa {0} kuriho'],
  ['Phone number must start with 0 and be {0} digits', 'Ennamba ya ssimu erina kutandika ne 0 n’eba ya nnamba {0}', 'Namba ya simu inapaswa kuanza na 0 na kuwa tarakimu {0}', 'Le numéro de téléphone doit commencer par 0 et compter {0} chiffres', 'Nimero ya telefone igomba gutangira na 0 kandi ibe imibare {0}', 'Enamba ya esimu ishemereire kutandika na 0 kandi kuba ya namba {0}'],
  ['Your payment number ({0})', 'Ennamba yo ey’okusasula ({0})', 'Namba yako ya malipo ({0})', 'Votre numéro de paiement ({0})', 'Nimero yawe yo kwishyura ({0})', 'Enamba yaawe y’okushashura ({0})'],
  ['Support hours: {0}', 'Ebiseera by’obuyambi: {0}', 'Saa za msaada: {0}', "Heures d'assistance : {0}", 'Amasaha ya serivisi: {0}', 'Obwire bw’obuhwezi: {0}'],
  // The deposit-status screen's own step 1 (a live amount + phone number in
  // one sentence) -- same "translate the words, copy {0}/{1} verbatim" rule
  // as every other template here. French/Swahili only for now; see the
  // LANG_ROWS comment above this same screen's status titles for why the
  // three Bantu columns are left blank rather than guessed on this one.
  ['A payment request for {0} has been sent to {1}.', '', 'Ombi la malipo la {0} limetumwa kwa {1}.', 'Une demande de paiement de {0} a été envoyée à {1}.', '', ''],
  // Popup messages carrying a figure. Same rule as every template
  // here: only the words translate, and whatever {0} captured -- an
  // amount, a percentage, a time, a product name -- is copied across
  // verbatim.
  ['Check-in successful ✓', 'Okukyalira kugenze bulungi ✓', 'Kuhudhuria kumefanikiwa ✓', 'Pointage réussi ✓', 'Kwiyandikisha byagenze neza ✓', 'Okwoleka kugyenzire gye ✓'],
  ['Registration successful ✓', 'Okwewandiisa kugenze bulungi ✓', 'Usajili umefanikiwa ✓', 'Inscription réussie ✓', 'Kwiyandikisha byagenze neza ✓', 'Okuhandiikwa kwagenze gye ✓'],
  ['Withdraw must be a multiple of {0}. Try {1} or {2}.', 'Okuggyamu kulina kuba kwa {0}. Gezaako {1} oba {2}.', 'Kutoa pesa lazima kiwe kizidishi cha {0}. Jaribu {1} au {2}.', 'Le retrait doit être un multiple de {0}. Essayez {1} ou {2}.', 'Kubikuza bigomba kuba umubare ushobora kugabanywa na {0}. Gerageza {1} cyangwa {2}.', 'Okwihamu kushemereire kuba kwa {0}. Gyezaho {1} nari {2}.'],
  ['Withdraw is open from {0} to {1}. Please come back then.', 'Okuggyamu ssente kuggulwa okuva ku {0} okutuuka {1}. Ddamu okomewo mu budde obwo.', 'Kutoa pesa kunapatikana kuanzia {0} hadi {1}. Tafadhali rudi wakati huo.', 'Le retrait est ouvert de {0} à {1}. Merci de revenir à ce moment-là.', 'Kubikuza bifungura kuva {0} kugeza {1}. Ongera ugaruke icyo gihe.', 'Okwihamu sente nikwigurwa kuruga aha {0} kuhika {1}. Ogaruke omu bwire obu.'],
  ['Withdraw of {0} is processing. You will receive {1} after the {2}% charge.', 'Okuggyamu {0} kukolebwako. Ojja kufuna {1} oluvannyuma lw\'ossente z\'obuweereza eza {2}%.', 'Kutoa {0} kunashughulikiwa. Utapokea {1} baada ya ada ya {2}%.', 'Le retrait de {0} est en cours. Vous recevrez {1} après les frais de {2} %.', 'Kubikuza {0} birimo gutunganywa. Uzabona {1} nyuma y\'amafaranga ya serivisi ya {2}%.', 'Okwihamu {0} nikukorwaho. Noija kutunga {1} bwanyima ya sente z\'obuheereza eza {2}%.'],
  ['{0} is now running. You will find it under My Products.', '{0} kitandise. Ojja kukisanga mu Byamaguzi Byange.', '{0} sasa inaendelea. Utaipata chini ya Bidhaa Zangu.', '{0} est maintenant actif. Vous le trouverez dans Mes produits.', '{0} ubu birakora. Uzabisanga muri Ibicuruzwa Byanjye.', '{0} kitandikire. Noija kukishanga omu Byamaguzi Byangye.'],
  ['Already installed, or your browser doesn\'t support installing {0}.', 'Eteekeddwawo dda, oba browser yo teteeka {0}.', 'Tayari imesakinishwa, au kivinjari chako hakiruhusu kusakinisha {0}.', 'Déjà installée, ou votre navigateur ne permet pas d\'installer {0}.', 'Yamaze gushyirwaho, cyangwa mushakisha wawe ntiyemera gushyiraho {0}.', 'Eteirweho, nari browser yaawe teine bushoboorozi bw\'okuteeraho {0}.'],
];
// ==== I18N TABLE: SHARED WITH THE ADMIN PANEL - END ====
// ==== I18N ENGINE: SHARED WITH THE ADMIN PANEL - BEGIN ====
// build-admin.js lifts everything between these two markers straight into
// the admin bundle, so the panel runs THIS translator rather than a second
// one written to match it. Nothing in here may reference anything the member
// app owns and the admin does not: it depends only on LANG, LANGS,
// LANG_CODES, LANG_ROWS and LANG_PATTERNS, each of which the HOST defines
// above it. Adding a dependency on something app-specific breaks the admin
// panel at build time, which test-admin-i18n.js is there to catch.
// code -> { english: translated }. Built once; an empty cell is simply not
// stored, so a lookup miss and "deliberately English" are the same thing.
var DICT = (function(){
  const out = {};
  for (let i = 1; i < LANG_CODES.length; i++) out[LANG_CODES[i]] = {};
  for (const row of LANG_ROWS) {
    const en = row[0];
    for (let i = 1; i < LANG_CODES.length; i++) {
      const v = row[i];
      // '=' means "the right word in this language IS the English word", set
      // deliberately (French for "Messages" is "Messages"). It stores NO
      // entry, exactly like a blank, so t() returns the English either way --
      // the difference is only that find-untranslated.py can tell a chosen
      // match apart from a cell nobody has filled in yet, instead of
      // reporting the same four French words as gaps on every single run.
      if (v === '=') continue;
      if (typeof v === 'string' && v && v !== en) out[LANG_CODES[i]][en] = v;
    }
  }
  return out;
})();
function langMeta(code){ return LANGS.find(l => l.code === code) || LANGS[0]; }
// The one translator. Everything else in this block is plumbing around it.
function t(s){
  if (LANG === 'en' || typeof s !== 'string' || !s) return s;
  const d = DICT[LANG];
  if (!d) return s;
  const hit = d[s];
  if (typeof hit === 'string' && hit) return hit;
  // Not a whole-string row. Try the templates -- see LANG_PATTERNS.
  return tPattern(s);
}

// Compiled once. Sorted by how much LITERAL text a template carries, longest
// first, so a specific pattern always wins over a loose one no matter what
// order the table is written in -- ordering a table by hand is exactly the
// kind of thing that rots.
var LANG_PATTERN_RE = LANG_PATTERNS.map(row => {
  const parts = String(row[0]).split(/\{(\d+)\}/);
  let src = '^', order = [], literal = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2) { order.push(Number(parts[i])); src += '([\\s\\S]+?)'; }
    else { literal += parts[i].length; src += parts[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  }
  return { re: new RegExp(src + '$'), order, row, literal };
}).sort((a, b) => b.literal - a.literal);
function tPattern(s){
  const idx = LANG_CODES.indexOf(LANG);
  if (idx < 1) return s;
  for (const p of LANG_PATTERN_RE) {
    const tpl = p.row[idx];
    // '=' means the same here as it does in LANG_ROWS: the right wording in
    // this language IS the English one, chosen deliberately (French for
    // "Transactions ({0})" is "Transactions ({0})"). Skipped, so the English
    // reaches the screen -- without this it would be taken as the template
    // and the sentence would render as a bare "=".
    if (typeof tpl !== 'string' || !tpl || tpl === '=' || tpl === p.row[0]) continue;
    const m = p.re.exec(s);
    if (!m) continue;
    return tpl.replace(/\{(\d+)\}/g, (_, n) => {
      const at = p.order.indexOf(Number(n));
      return at >= 0 ? m[at + 1] : '';
    });
  }
  return s;
}
// ── TRANSLATING WHAT IS ALREADY ON SCREEN ──
// This app draws nearly every screen by assigning a template literal to
// innerHTML, so wrapping each visible string in t() would mean editing
// several hundred sites and would still miss whichever one the next round
// adds. Instead the ORIGINAL English is kept per node and the translation is
// applied to the rendered DOM.
//
// Keeping the original is what makes switching Luganda -> French work: a
// second pass reads the stored English, never the Luganda already on screen,
// so nothing is translated twice and switching back to English restores
// exactly what was rendered.
//
// Only a WHOLE trimmed text node that matches a table row is replaced -- never
// a substring. A member's own data (a name, an amount, a product title)
// therefore cannot be rewritten by accident unless it is character-for-
// character one of the rows above, and anything inside [data-no-i18n] is
// skipped outright.
var _i18nText = new WeakMap();
var _i18nAttr = new WeakMap();
var I18N_ATTRS = ['placeholder', 'aria-label', 'title'];
// The longest text node the translator will look at. It exists so this can
// never be dragged through a wall of member-written content, and 160 is right
// for the member app. THE ADMIN PANEL RAISES IT (see build-admin.js): its long
// strings are the operator documentation the owner asked to have translated
// ("whether instructions, settings, sentences"), it renders no member content
// except the pasted SMS -- which carries data-no-i18n and translate="no" for
// its own reasons -- and a row longer than the cap can never apply however
// carefully it is written.
var I18N_MAX_LEN = (typeof I18N_MAX_LEN_OVERRIDE === 'number' && I18N_MAX_LEN_OVERRIDE > 0)
  ? I18N_MAX_LEN_OVERRIDE : 160;
function i18nTextNode(node){
  // A node inside a block this pass already translated as ONE sentence is not
  // ours to touch: re-translating its pieces would undo the whole point.
  // `closest` is guarded because this runs against DOMs that do not implement
  // all of it, and a throw here would stop the screen being translated.
  try {
    if (node.parentElement && node.parentElement.closest &&
        node.parentElement.closest('[data-i18n-b]')) return;
  } catch(_){}
  let src;
  if (_i18nText.has(node)) src = _i18nText.get(node);
  else { src = node.nodeValue; _i18nText.set(node, src); }
  const raw = String(src == null ? '' : src);
  // WHITESPACE IS NORMALISED BEFORE THE LOOKUP, and `&nbsp;` is why. A
  // paragraph written with "400&nbsp;KB" gives a text node holding U+00A0,
  // which is not the ordinary space in the row -- so a perfectly good
  // translation simply never applied, and nothing at runtime said so. (The
  // sweep DID collapse it, so its report showed an ordinary space and the two
  // looked identical; this file already records the same trap biting French.)
  // Line breaks and indentation inside a paragraph are the same story.
  const key = raw.trim().replace(/\s+/g, ' ');
  if (!key || key.length > I18N_MAX_LEN) return;
  const hit = t(key);
  // Untranslated: leave the node exactly as authored, so nothing is reflowed
  // for no reason. Translated: keep the node's own leading/trailing space --
  // it is what separates this node from its neighbours in a sentence.
  const want = hit === key
    ? raw
    : raw.slice(0, raw.length - raw.replace(/^\s+/, '').length) + hit +
      raw.slice(raw.replace(/\s+$/, '').length);
  if (node.nodeValue !== want) node.nodeValue = want;
}
// ── SENTENCES THAT INLINE MARKUP BROKE INTO PIECES ────────────────────────
//
// `Click <b>"Refresh"</b> to check if it is successful` is THREE text nodes,
// none of which is a sentence, so no row could ever apply to it and the line
// stayed English in every language. The admin panel had 164 more of the same
// shape -- nearly all of its instructions and settings copy, which is exactly
// what the owner meant by "even in admin panel, whether instructions,
// settings, sentences".
//
// So a block whose only element children are inline formatting is translated
// AS ONE SENTENCE, keyed on its flattened text.
//
// What disqualifies a block, and why each rule is load-bearing:
//   * any child that is not inline formatting -- a button, an input, a table
//     row: rewriting those destroys real structure;
//   * any descendant carrying an `id`: an id is the hook app code writes
//     into (`$('manPayTotal').textContent = ...`), so replacing the block
//     would throw that element away and the next write would land nowhere;
//   * data-no-i18n anywhere inside, which is how a screen says "this is
//     content, not copy".
var I18N_INLINE_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, SMALL: 1, CODE: 1, SPAN: 1, BR: 1 };
var _i18nBlock = new WeakMap();
function i18nBlockOk(el){
  if (!el || el.nodeType !== 1 || el.hasAttribute('data-no-i18n')) return false;
  const kids = el.children;
  if (!kids || !kids.length) return false;      // no markup: the text path has it
  // A SENTENCE HAS TEXT OF ITS OWN, outside the emphasis inside it. A box
  // holding only elements is a layout container, not a sentence:
  //     <div><span>Wallet balance</span><span>UGX 128,500</span></div>
  // flattens to "Wallet balanceUGX 128,500", which is not a phrase in any
  // language and carries a member's money in it. Requiring at least one
  // direct non-blank text child separates the two exactly.
  let ownText = false;
  for (let n = el.firstChild; n; n = n.nextSibling)
    if (n.nodeType === 3 && String(n.nodeValue || '').trim()) { ownText = true; break; }
  if (!ownText) return false;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (!I18N_INLINE_TAGS[c.tagName]) return false;
    if (c.id || c.hasAttribute('data-no-i18n')) return false;
    for (let j = 0; j < c.children.length; j++) {
      const g = c.children[j];
      if (!I18N_INLINE_TAGS[g.tagName] || g.id || g.children.length) return false;
    }
  }
  return true;
}
// The translated sentence may carry inline emphasis of its own, so that
// `<code>*</code>` in an instruction survives being translated. Everything is
// escaped first and only the inline tags are allowed back: the table ships
// inside this bundle so this is not guarding against an attacker, it is
// guarding against a typo in one translation injecting structure into a page.
function i18nSetBlockHtml(el, text){
  const box = document.createElement('div');
  box.textContent = text;
  el.innerHTML = box.innerHTML.replace(
    /&lt;(\/?)(b|strong|i|em|u|small|code|br)&gt;/gi, '<$1$2>');
}
function i18nBlock(el){
  if (!i18nBlockOk(el)) return false;
  const rec = _i18nBlock.get(el);
  // If app code has rewritten this block since we wrote it, what we remember
  // is stale -- translating the OLD sentence back over the new one would be
  // the wrong sentence in the right language, which no sweep looking for
  // English could ever see.
  const srcHtml = (rec && el.innerHTML === rec.written) ? rec.src : el.innerHTML;
  const box = document.createElement('div');
  box.innerHTML = srcHtml;
  const key = String(box.textContent || '').replace(/\s+/g, ' ').trim();
  if (!key || key.length > I18N_MAX_LEN) return false;
  const hit = t(key);
  // English, or nothing in the table: leave the block exactly as authored --
  // which is what keeps the English copy's own bold and code formatting.
  if (hit === key) { _i18nBlock.delete(el); el.removeAttribute('data-i18n-b'); return false; }
  i18nSetBlockHtml(el, hit);
  _i18nBlock.set(el, { src: srcHtml, written: el.innerHTML });
  // The marker is what stops the per-node pass below pulling this sentence
  // apart again, and it is an attribute the observer does not watch.
  el.setAttribute('data-i18n-b', '1');
  return true;
}
// Per element+attr this remembers BOTH the English it was given and the exact
// string it last wrote. Two things depend on keeping the second:
//
//   * the observer below watches attributes, so this function's own writes
//     come straight back to it. Recognising its own output is what stops that
//     being an infinite loop -- a plain flag cannot do it, because observer
//     records are delivered a microtask later, by which time the flag is
//     already clear.
//   * app code is allowed to REPLACE a placeholder with different English
//     (updateReferralFieldHint swaps "Referral code" for "Referral code
//     (optional)"). Remembering only the first English ever seen would
//     translate the OLD sentence back over the new one, which is worse than
//     not translating at all. A value that is not our own output is taken as
//     a new original.
function i18nElementAttrs(el){
  let store = _i18nAttr.get(el);
  for (const a of I18N_ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const cur = el.getAttribute(a);
    let rec = store && store[a];
    if (!rec || (cur !== rec.out && cur !== rec.en)) {
      rec = { en: cur, out: null };
      if (!store) { store = {}; _i18nAttr.set(el, store); }
      store[a] = rec;
    }
    const key = String(rec.en == null ? '' : rec.en).trim();
    if (!key) continue;
    const hit = t(key);
    const want = hit === key ? rec.en : String(rec.en).replace(key, hit);
    rec.out = want;
    if (cur !== want) el.setAttribute(a, want);
  }
}
function translateTree(root){
  if (!root) return;
  try {
    if (root.nodeType === 3) { i18nTextNode(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n){
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-no-i18n]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    // BLOCKS FIRST, then the leftover text nodes. The order is load-bearing:
    // the per-node pass mutates text in place, so running it first would
    // leave a half-translated block and the whole-sentence key would no
    // longer match anything.
    //
    // In its OWN try/catch on purpose. This pass touches a wider slice of the
    // DOM API than the per-node one (children, firstChild, innerHTML,
    // setAttribute), and on anything that does not implement all of it the
    // shared catch below would swallow the throw and leave the WHOLE screen
    // untranslated -- a new feature taking the old, working one down with it.
    // Degrading to per-node translation is the right failure here.
    try {
      if (root.nodeType === 1 && i18nBlock(root)) { /* handled whole */ }
      const blocks = root.querySelectorAll ? root.querySelectorAll('p,li,div,span,td,th,label,h1,h2,h3,h4,small') : [];
      for (const el of blocks) { if (!el.closest || !el.closest('[data-no-i18n]')) i18nBlock(el); }
    } catch(_){}
    const jobs = [];
    let n;
    while ((n = walker.nextNode())) jobs.push(n);
    for (const node of jobs) i18nTextNode(node);
    if (root.nodeType === 1 && root.matches && root.matches('[placeholder],[aria-label],[title]')) i18nElementAttrs(root);
    const els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[aria-label],[title]') : [];
    for (const el of els) { if (!el.closest('[data-no-i18n]')) i18nElementAttrs(el); }
  } catch(_){}
}
// Newly rendered HTML is translated as it lands.
//
// childList for new nodes, plus attributeFilter for exactly the three
// attributes that carry words. characterData is still deliberately NOT
// observed -- that IS this function's own text output, and there is no way to
// tell it apart from app code writing the same string, so observing it would
// feed the translator its own result forever. Attributes are different only
// because i18nElementAttrs remembers what it wrote and skips it (see above).
//
// The attribute half was missing, and it was a real gap rather than a
// theoretical one: updateReferralFieldHint() sets #regReferral's placeholder
// AFTER the auth screen has been swept, so the Sign Up form's referral field
// stayed in English in every language. Found by find-untranslated.py reading
// the rendered placeholders -- no static check could see it, because the
// string is in the table and the sweep does handle placeholders; what was
// wrong was only WHEN.
var _i18nObserving = false;
function startI18nObserver(){
  if (_i18nObserving || typeof MutationObserver === 'undefined' || !document.body) return;
  _i18nObserving = true;
  try {
    new MutationObserver(muts => {
      if (LANG === 'en') return; // the overwhelmingly common case, one branch
      for (const m of muts) {
        if (m.type === 'attributes') {
          if (m.target && m.target.nodeType === 1 && !m.target.closest('[data-no-i18n]'))
            i18nElementAttrs(m.target);
          continue;
        }
        for (const node of m.addedNodes) translateTree(node);
      }
    }).observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: I18N_ATTRS,
    });
  } catch(_){ _i18nObserving = false; }
}
// Exposed for the coverage sweeps, deliberately. find-untranslated.py and
// find-admin-untranslated.py have to know which blocks the engine treats as
// ONE sentence, so they report the flattened sentence as the missing key
// rather than its three fragments. A Python copy of the rule would be a
// second source of truth that drifts, and the row it made you write would be
// keyed on a sentence the engine never forms. This is a pure predicate plus a
// key builder -- it reads the DOM and changes nothing.
try {
  window.__i18nBlockOk = i18nBlockOk;
  window.__i18nMaxLen = function(){ return I18N_MAX_LEN; };
} catch(_){}
// ==== I18N ENGINE: SHARED WITH THE ADMIN PANEL - END ====
// A full pass over the document. Run when the language changes -- including
// changing back TO English, where t() returns each stored original and this
// restores the page word for word.
// The loading screen used to show a translated "Loading..." word (with its
// own localStorage-cached, pre-core-painted translation fix, since the
// screen is on-screen precisely while the core is still inflating and
// there is no translator yet to ask). Removed along with the rest of that
// Mint-specific loader treatment -- the replacement loader shows a plain
// numeric percentage only, which needs no translation at all.
function applyLanguage(){
  try {
    translateTree(document.body);
    const btn = $('langBtnLabel');
    if (btn) btn.textContent = langMeta(LANG).native;
    document.documentElement.setAttribute('lang', LANG);
    paintLangButton();
  } catch(_){}
}
function setLang(code, opts){
  const c = String(code || '').trim().toLowerCase();
  if (!LANG_CODES.includes(c)) return;
  if (c !== LANG) {
    LANG = c;
    try { localStorage.setItem(LANG_STORE_KEY, c); } catch(_){}
  }
  applyLanguage();
  if (!opts || !opts.silent) closeLangPicker();
}
// Which language this device should open in: the one chosen here before, if
// the country still allows it, else the country's own default, else English.
//
// The allowed-list check is not decoration. A country's languages can be
// changed from the panel, and a member left holding a language it no longer
// offers would be reading a UI his own country has withdrawn -- with no way
// to get back to one it does offer, because the button would not list the
// language he is currently in.
function resolveLang(){
  let stored = '';
  try { stored = String(localStorage.getItem(LANG_STORE_KEY) || '').toLowerCase(); } catch(_){}
  const allowed = LANG_ALLOWED.length ? LANG_ALLOWED : ['en'];
  if (stored && allowed.includes(stored) && LANG_CODES.includes(stored)) return stored;
  const def = String(REGION && REGION.defaultLang || '').toLowerCase();
  if (def && allowed.includes(def) && LANG_CODES.includes(def)) return def;
  return allowed[0] || 'en';
}
function applyRegionLanguages(){
  const list = (REGION && Array.isArray(REGION.languages) ? REGION.languages : [])
    .map(c => String(c || '').toLowerCase()).filter(c => LANG_CODES.includes(c));
  LANG_ALLOWED = list.length ? list.filter((c, i) => list.indexOf(c) === i) : ['en'];
  const want = resolveLang();
  if (want !== LANG) setLang(want, { silent: true });
  else { paintLangButton(); applyLanguage(); }
}
// ── THE BUTTON, AND THE PICKER ──
// Hidden while the country allows exactly one language: one option is not a
// choice, and a single-language country should gain no furniture. Same rule
// the admin panel's country switch follows.
function paintLangButton(){
  try {
    const many = LANG_ALLOWED.length > 1;
    for (const id of ['langBtn', 'langRow']) {
      const el = $(id);
      if (el) el.style.display = many ? '' : 'none';
    }
    const lbl = $('langBtnLabel');
    if (lbl) lbl.textContent = langMeta(LANG).native;
    const row = $('langRowValue');
    if (row) row.textContent = langMeta(LANG).native;
  } catch(_){}
}
function closeLangPicker(){
  const bg = $('langSheetBg');
  if (bg) bg.classList.remove('show');
}
// Thousands commas and the decimal point are written here, never left to the phone's own locale (an older phone browser without full
// language data prints 970130.00 or 970 130,00 for the same number). cents=true always shows two decimals.
function numGroup(n, cents){
  let v = Number(n); if (!Number.isFinite(v)) v = 0;
  const neg = v < 0; v = Math.abs(v);
  const fixed = cents ? (Math.round(v * 100) / 100).toFixed(2) : String(Math.round(v));
  const parts = fixed.split('.');
  return (neg ? '-' : '') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] ? '.' + parts[1] : '');
}
function fmtUGX(n){
  const v = Number(n)||0;
  const hasCents = Math.round(v*100)%100 !== 0;
  return cur() + ' ' + numGroup(v, hasCents);
}
// Keep investment and payout amounts on the same cents-aware formatter.
function fmtUGXCents(n){ return fmtUGX(n); }
// subagent-audit-caught: the deposit/withdraw amount fields have no
// oninput sanitizer, and every amount the app itself shows (quick-amount
// chips, "min UGX 30,000" hints) is comma-formatted via fmtUGX() -- so a
// member typing "30,000" out of habit fed straight into a bare parseInt()
// stops at the comma (parseInt("30,000",10) === 30), producing a
// nonsensical "Minimum amount is UGX 30,000" rejection right next to an
// input that visibly still reads "30,000". Strips thousands separators
// before parsing.
// Whole numbers only: "20000.5" or "2e4" used to be read as 20000 and 2 (parseInt stops at the first non-digit); now they are not numbers.
function parseMoneyInput(v){ const s = String(v||'').replace(/[,\s]/g,''); return /^\d+$/.test(s) ? parseInt(s, 10) : NaN; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ── Mint v2 design helpers ──
// Money the way the screens print it: currency glued to the figure, no
// spaces. vMoney drops the decimals ("UGX11,000"), vMoney2 always shows them
// ("UGX2,200.00"), which is how balances and totals read.
function vMoney(n){
  const v = Number(n) || 0;
  const hasCents = Math.round(v * 100) % 100 !== 0;
  return cur() + ' ' + numGroup(v, hasCents);
}
// Long money figures (nine digits and more) step the font down in two sizes so they stay on one line inside their box.
function vFit(text, a, b){ var n = String(text).length; return n > b ? 'v-fit2' : n > a ? 'v-fit1' : ''; }
function vMoney2(n){ return cur() + ' ' + numGroup(n, true); }
// Icons traced from the owner's screenshots live in a square box 288 units wide drawn 1:1 with a 22 px picture (13.1 units = 1 px); the stroke sits on the <g> so a bigger/smaller box keeps the same proportions.
function vSvgT(cx, cy, sw, body, size){ size = size || 288; var h = size / 2; return '<svg viewBox="' + (cx - h) + ' ' + (cy - h) + ' ' + size + ' ' + size + '" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g stroke-width="' + sw + '">' + body + '</g></svg>'; }
function vSvg(body, extra){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + body + '</svg>'; }
var VI = {
  bottle: vSvgT(191, 180, 18, '<path d="M170 80Q170 68 181 68H201Q212 68 212 80V99H170Z"/><path d="M180 83H202" stroke-width="6"/><path d="M173 99C150 122 139 148 141 172C143 194 160 202 164 212"/><path d="M209 99C232 122 243 148 241 172C239 194 222 202 218 212"/><circle cx="191" cy="247" r="52"/><path d="M162 242H220M166 254H216" stroke-width="7" stroke-opacity=".6"/>'),
  bottleDown: vSvgT(191, 180, 18, '<path d="M170 80Q170 68 181 68H201Q212 68 212 80V99H170Z"/><path d="M180 83H202" stroke-width="6"/><path d="M173 99C150 122 139 148 141 172C143 194 160 202 164 212"/><path d="M209 99C232 122 243 148 241 172C239 194 222 202 218 212"/><circle cx="191" cy="247" r="52"/><path d="M162 242H220M166 254H216" stroke-width="7" stroke-opacity=".6"/><g stroke-width="12"><path d="M191 168V238M173 222L191 242L209 222"/></g>'),
  bottleUp: vSvgT(191, 180, 18, '<path d="M170 80Q170 68 181 68H201Q212 68 212 80V99H170Z"/><path d="M180 83H202" stroke-width="6"/><path d="M173 99C150 122 139 148 141 172C143 194 160 202 164 212"/><path d="M209 99C232 122 243 148 241 172C239 194 222 202 218 212"/><circle cx="191" cy="247" r="52"/><path d="M162 242H220M166 254H216" stroke-width="7" stroke-opacity=".6"/><g stroke-width="12"><path d="M191 238V158M173 176L191 156L209 176"/></g>'),
  bottleRing: vSvgT(191, 180, 18, '<path d="M170 80Q170 68 181 68H201Q212 68 212 80V99H170Z"/><path d="M180 83H202" stroke-width="6"/><path d="M173 99C150 122 139 148 141 172C143 194 160 202 164 212"/><path d="M209 99C232 122 243 148 241 172C239 194 222 202 218 212"/><circle cx="191" cy="247" r="52"/><path d="M162 242H220M166 254H216" stroke-width="7" stroke-opacity=".6"/><g stroke-width="12"><circle cx="191" cy="212" r="22" stroke-width="13"/></g>'),
  bottleWallet: vSvgT(191, 180, 18, '<path d="M170 80Q170 68 181 68H201Q212 68 212 80V99H170Z"/><path d="M180 83H202" stroke-width="6"/><path d="M173 99C150 122 139 148 141 172C143 194 160 202 164 212"/><path d="M209 99C232 122 243 148 241 172C239 194 222 202 218 212"/><circle cx="191" cy="247" r="52"/><path d="M162 242H220M166 254H216" stroke-width="7" stroke-opacity=".6"/><g stroke-width="12"><rect x="163" y="168" width="56" height="44" rx="9"/><path d="M178 168Q191 142 204 168"/></g>'),
  bottleChat: vSvgT(191, 180, 18, '<path d="M170 80Q170 68 181 68H201Q212 68 212 80V99H170Z"/><path d="M180 83H202" stroke-width="6"/><path d="M173 99C150 122 139 148 141 172C143 194 160 202 164 212"/><path d="M209 99C232 122 243 148 241 172C239 194 222 202 218 212"/><circle cx="191" cy="247" r="52"/><path d="M162 242H220M166 254H216" stroke-width="7" stroke-opacity=".6"/><g stroke-width="12"><ellipse cx="191" cy="168" rx="19" ry="32"/></g>'),
  bottleLock: vSvgT(191, 180, 18, '<path d="M170 80Q170 68 181 68H201Q212 68 212 80V99H170Z"/><path d="M180 83H202" stroke-width="6"/><path d="M173 99C150 122 139 148 141 172C143 194 160 202 164 212"/><path d="M209 99C232 122 243 148 241 172C239 194 222 202 218 212"/><circle cx="191" cy="247" r="52"/><path d="M162 242H220M166 254H216" stroke-width="7" stroke-opacity=".6"/><g stroke-width="12"><rect x="169" y="172" width="44" height="40" rx="7"/><path d="M178 172V160Q191 136 204 160V172"/></g>'),
  bottleKey: vSvgT(191, 180, 18, '<path d="M170 80Q170 68 181 68H201Q212 68 212 80V99H170Z"/><path d="M180 83H202" stroke-width="6"/><path d="M173 99C150 122 139 148 141 172C143 194 160 202 164 212"/><path d="M209 99C232 122 243 148 241 172C239 194 222 202 218 212"/><circle cx="191" cy="247" r="52"/><path d="M162 242H220M166 254H216" stroke-width="7" stroke-opacity=".6"/><g stroke-width="12"><circle cx="178" cy="164" r="15"/><path d="M189 175L214 206M203 192L212 184"/></g>'),
  cell: vSvgT(590, 215, 11, '<rect x="546" y="108" width="88" height="214" rx="9"/><path d="M548 128H632M548 166H632M548 205H632M548 244H632" stroke-opacity=".6"/>'),
  people: vSvgT(990, 205, 17, '<circle cx="953" cy="143" r="50"/><path d="M1040 95A55 55 0 0 1 1045 190"/><path d="M866 318V292C866 256 895 238 950 238C1005 238 1032 256 1032 292V318"/><path d="M1070 246C1100 252 1112 272 1112 300V318"/>'),
  person: vSvgT(1388, 206, 11, '<circle cx="1388" cy="145" r="54"/><path d="M1296 322V292C1296 262 1325 246 1388 246C1451 246 1480 262 1480 292V322"/>'),
  headset: vSvgT(1467, 228, 22, '<path d="M1332 268C1332 150 1390 90 1467 90C1545 90 1603 150 1603 268"/><path d="M1332 258H1385Q1418 258 1418 288V335Q1418 366 1385 366H1355Q1332 366 1332 335Z"/><path d="M1603 258H1550Q1518 258 1518 288V335Q1518 366 1550 366H1580Q1603 366 1603 335Z"/>', 336),
  megaphone: vSvgT(192, 166, 17, '<path d="M110 100H148V182H110Q92 182 92 164V118Q92 100 110 100Z"/><path d="M148 100L270 62Q296 56 296 82V200Q296 222 272 212L148 178"/><path d="M135 186Q140 215 160 250Q172 272 188 262Q198 252 190 232L178 196"/>'),
  plane: vSvg('<path d="M21 3 3 10.2l7.2 2.8 2.8 7.2z"/><path d="M21 3 10.2 13"/>'),
  gift: vSvg('<rect x="3.5" y="9" width="17" height="11.5" rx="2"/><path d="M2.5 9h19v-3.2h-19z"/><path d="M12 5.8v14.7"/><path d="M12 5.8C10.2 5.8 8.4 5 8.4 3.6 8.4 2.5 9.4 2 10.4 2.4c1.1.5 1.6 1.9 1.6 3.4zM12 5.8c1.8 0 3.6-.8 3.6-2.2 0-1.1-1-1.6-2-1.2-1.1.5-1.6 1.9-1.6 3.4z"/>'),
  tick: vSvg('<path d="m5 12.6 4.3 4.3L19 7.2"/>'),
  chev: vSvg('<path d="m9 5.5 6.5 6.5L9 18.5"/>'),
  trophy: vSvg('<path d="M8 4h8v5.2a4 4 0 0 1-8 0z"/><path d="M8 6.2H4.6a3.2 3.2 0 0 0 3.7 4M16 6.2h3.4a3.2 3.2 0 0 1-3.7 4"/><path d="M12 13.2V17M8.6 20h6.8M10 17h4"/>'),
  clipboard: vSvg('<rect x="5" y="4.5" width="14" height="16.5" rx="2.6"/><path d="M9 4.5V3.3h6v1.2"/><path d="M9 10h.01M12 10h3M9 14h.01M12 14h3M9 18h.01M12 18h3"/>'),
  download: vSvg('<path d="M12 3.8v11"/><path d="m7.6 10.6 4.4 4.4 4.4-4.4"/><path d="M4.2 15.5v2.7a2 2 0 0 0 2 2h11.6a2 2 0 0 0 2-2v-2.7"/>'),
  logout: vSvg('<path d="M9.5 4H6.2A2.2 2.2 0 0 0 4 6.2v11.6A2.2 2.2 0 0 0 6.2 20h3.3"/><path d="m16 8 4 4-4 4"/><path d="M20 12H9.5"/>'),
  copy: vSvg('<rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M15 9V6.4A2.4 2.4 0 0 0 12.6 4H6.4A2.4 2.4 0 0 0 4 6.4v6.2A2.4 2.4 0 0 0 6.4 15H9"/>'),
  errCircle: vSvg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  key: vSvg('<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2"/>'),
  okCircle: vSvg('<circle cx="12" cy="12" r="9"/><path d="m8 12.4 2.9 2.9 5.2-5.6"/>'),
  back: vSvg('<path d="m15 5-7 7 7 7"/>', ' stroke-width="2.4"'),
  x: vSvg('<path d="M6 6l12 12M18 6 6 18"/>', ' stroke-width="2.2"'),
  eye: vSvg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: vSvg('<path d="M3 3l18 18"/><path d="M10.6 5.7A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.3A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
};


var NUMBER_FONT_STACKS = {
  'Bodoni Moda': "'Bodoni Moda',Didot,'Playfair Display',Georgia,serif",
  'Playfair Display': "'Playfair Display',Didot,Georgia,serif",
  'DM Serif Display': "'DM Serif Display',Georgia,serif",
  'Georgia': "Georgia,'Times New Roman',serif",
  'Roboto Mono': "'Roboto Mono',ui-monospace,'SFMono-Regular',monospace",
  'JetBrains Mono': "'JetBrains Mono',ui-monospace,'SFMono-Regular',monospace",
  'Orbitron': "'Orbitron',ui-sans-serif,sans-serif",
  'System default': "'Roboto',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
};
// ── THE APP'S NAME ──
// Owner: "l would like to also to edit the app name mint, so make it when it
// can be editable everywhere." It is one admin setting (Settings -> App name)
// and every screen reads it from here. Nothing in this file spells the name
// out any more, so a rename cannot half-land -- which is precisely how the
// last one went, leaving the old name on the screens nobody thought to check.
//
// The fallback is not decoration: settings arrive over the network, and the
// login screen paints before they land. Without it the very first frame of a
// cold open would have a blank space where the name goes.
// What the app is CALLED, if anything actually knows yet. Three sources, in
// order of freshness: the settings this session fetched, then the name this
// device remembered from the last session (written by index.html's own early
// script, which runs before this file inflates), then nothing.
//
// "Nothing" is a real answer and callers must handle it. Owner: "let's not
// make mint to be default name" -- a hardcoded default is exactly what made
// the loading screen keep saying the old name after he had renamed the app,
// because the loader is on screen while the settings request is still in
// flight, so the default was all it could ever show.
function brandNameKnown(){
  const n = STATE.settings && typeof STATE.settings.brandName === 'string'
    ? STATE.settings.brandName.trim() : '';
  if (n) return n;
  const cached = typeof window.__brandCached === 'string' ? window.__brandCached.trim() : '';
  return cached || '';
}
// For SENTENCES, where a blank would read as a broken string ("Welcome to
// the  app"). The wordmark deliberately does NOT use this -- see
// brandWordmarkHtml().
// Was `|| 'Mint'` -- a real bug, not a design choice: with no
// admin-set brandName yet (a fresh Mint deploy, before the owner has
// opened Admin -> Settings), every sentence-form use of the brand name
// literally rendered the word "Mint". Mint is this app's own real name,
// not an inherited-fork placeholder, so it is the correct fallback here --
// unlike the wordmark below, which stays blank on purpose.
function brandName(){
  return brandNameKnown() || 'Mint';
}
var BRAND_CACHE_KEY = 'mint_brand_name';
// The wordmark: just the name, in caps. Used to split off the LAST letter
// into an accent colour ("CHIP+Z") -- a pun specific to Mint's own name
// that means nothing for any other brand, dropped per the owner's "don't
// use anything that was Mint" instruction rather than carried over as a
// rule that happens to have one letter highlighted for no reason.
// The wordmark shows the name or NOTHING. It is the one place a guess is
// worse than a blank: a blank for the half-second before settings land reads
// as the logo loading, while the wrong name reads as the rename not having
// worked -- which is precisely the report that started this.
function brandWordmarkHtml(){
  const n = brandNameKnown().toUpperCase();
  return n ? esc(n) : '';
}
// Paints the name into the places that are NOT re-rendered from JavaScript:
// index.html's own static markup (the pre-launch countdown gate is the only
// [data-brandmark] left -- the loading screen's own wordmark was dropped
// along with the rest of its Mint-derived design) and the browser/tab
// title. Called once the settings land, and safe to call again -- it only
// ever writes.
//
// The document title is as far as a running app can go. manifest.json's own
// `name` and the og: tags are read by Chrome at install time and by link
// crawlers, both of which see the STATIC file and never run a line of this
// code, so those two carry the name at deploy time and a rename needs a
// frontend redeploy to reach them.
function applyBrandName(){
  const known = brandNameKnown();
  if (!known) return;   // nothing to say yet; leave the blanks blank
  document.querySelectorAll('[data-brandmark]').forEach(el => { el.innerHTML = brandWordmarkHtml(); });
  document.querySelectorAll('.home-brand-title').forEach(el => { el.textContent = known; });
  try { document.title = known; } catch (_) {}
  // Remember it for the next launch. This is the whole fix for "on start up
  // loader it was still saying mint": the loading screen paints long before
  // /public/settings answers, so the only way it can show the right name is
  // to already know it. Written on every apply, so a rename reaches the
  // loader on the boot AFTER the one that learned it -- there is no earlier
  // moment available to a screen that is up before the network answers.
  try {
    if (window.__brandCached !== known) {
      localStorage.setItem(BRAND_CACHE_KEY, known);
      window.__brandCached = known;
    }
  } catch (_) {}
}
function sanitizePhoneInput(el){
  let digits = el.value.replace(/\D/g, '');
  const len = localLen(), d = dial();
  if (digits.startsWith(d) && digits.length > len) digits = digits.slice(d.length);
  const maxDigits = digits.startsWith('0') ? len + 1 : len;
  if (digits.length > maxDigits) digits = digits.slice(0, maxDigits);
  el.value = digits;
}
function $(id){ return document.getElementById(id); }

// ── STATE ──
var STATE = { user: null, account: null, settings: null, products: null, investments: null,
  teamStats: null, teamMembers: {1:null,2:null,3:null}, bankAccounts: null, transactions: null, refCode: null, page: 'home',
  // Codex-caught real bug: on a shared device, a request started by member A
  // (e.g. the live-refresh poll, or a tab opened right before logout) could
  // still be in flight when A logs out and B logs in on the same page load --
  // there was nothing stopping that stale response from landing and writing
  // A's balance/investments/team into STATE right after enterApp() just
  // populated it with B's data. Bumped on every auth transition (doLogout()
  // and the snow-auth handler below); api()/post() capture the epoch before
  // the network call and discard the response if it's changed by the time
  // the response lands, so every existing `if (r.status === 'success')
  // STATE.x = ...` call site is automatically safe with no per-site changes.
  authEpoch: 0 };

// The dark bottom-pill toast USED TO LIVE HERE and is gone. Owner: "no more
// saying other stuffs of old small notifies, l nolonger need those dark tiny
// notifies you already know that we have a pop up card with [the warning
// sign]." Every one of its ~30 call sites now goes to window.notify() further
// down -- the same alert card the rest of the app uses.
//
// Nothing may reintroduce a `function toast` here: `notify` is defined as
// window.notify, and a top-level function of either name would shadow it for
// every unqualified call in this file.

// A session ends on real inactivity, even when background polls still succeed.
try { window._suppressAutofillLogin = sessionStorage.getItem('mint_relogin_required') === '1'; } catch (_) {}
var _memberSession = window.createMintIdleSession('mint_member_session', function(){
  window._triedAutoSignIn = true;
  document.querySelectorAll('.sheet-bg.show,.modal-bg.show,.pay-page.show,#msgDetailBg.show').forEach(el => el.classList.remove('show'));
  unlockBodyScroll();
  resetOverlayState();
  hideLoadingScreen();
  $('app').style.display = 'none';
  $('authScreen').style.display = '';
  // {auto:true} -- see doLogout()'s own comment on why an idle timeout must
  // NOT permanently disable Chrome's autofill-then-submit convenience the
  // way a deliberate "Log Out" tap does.
  window.doLogout({ auto: true }).catch(() => {});
  notify(window._sessionFailureMessage || 'Your session ended. Please log in again. If this repeats, check automatic date and time on your phone.');
  window._sessionFailureMessage = '';
}, () => post('/auth/session/activity', {}));
var _apiPending = new Map();
function api(path, opts){
  opts = opts || {};
  // Share only concurrent reads. Payments and all other writes always run once
  // per explicit call, and reads are never cached across account changes.
  if (opts.body || opts.signal || (opts.method && opts.method !== 'GET')) return apiRequest(path, opts);
  const key = STATE.authEpoch + ':' + path;
  if (_apiPending.has(key)) return _apiPending.get(key);
  const pending = apiRequest(path, opts).finally(() => { if (_apiPending.get(key) === pending) _apiPending.delete(key); });
  _apiPending.set(key, pending); return pending;
}
// ── API ──
async function apiRequest(path, opts){
  opts = opts || {};
  // Captured before the network round-trip, checked after -- if a logout or
  // a different user's login happened while this request was in flight (see
  // STATE.authEpoch's own comment), the response belongs to a session that
  // no longer exists on screen and must never be written into STATE.
  // /public/* endpoints are exempt: they're not per-user (settings,
  // products, banners, the About article), so they can never leak one
  // member's data into another's session -- and boot()'s very first
  // /public/settings + /public/products fetch always races the app's own
  // first snow-auth firing (which bumps the epoch unconditionally, see
  // below), so gating them here would discard that legitimate boot data
  // every single page load.
  const isPublicCall = path.indexOf('/public/') === 0;
  if (!isPublicCall && STATE.user && path !== '/auth/session/logout' && !_memberSession.check()) return { status:'error', message:'Session expired. Log in again.' };
  const startEpoch = STATE.authEpoch;
  // ── Content-Type ONLY WHEN THERE IS A BODY ──
  // MEASURED (test-boot-speed.py, against a real cross-origin server):
  // `Content-Type: application/json` is not a CORS-safelisted request
  // header, so sending it turns even a plain GET into a PREFLIGHTED request
  // -- an OPTIONS round trip before every single call, per URL. With eight
  // reads on the boot path that was eight wasted round trips, on the one
  // connection where latency costs the most.
  //
  // It was never needed on a GET: there is no body to describe. Express's
  // JSON parser only runs when a body is present, so nothing on the server
  // depends on it either. The harness proves both directions -- with the
  // header the server logs ['OPTIONS','GET'], without it ['GET'], same
  // answer.
  //
  // POSTs still send it, and their preflight is now cached for a day
  // (cors({maxAge}) in server.js) rather than Chromium's five-second
  // default.
  const headers = Object.assign({}, opts.headers || {});
  if (opts.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) abort();
    else opts.signal.addEventListener('abort', abort, { once: true });
  }
  const timeout = setTimeout(abort, Number(opts.timeoutMs) || 45000);
  let data, tokenAbort;
  try {
    if (window.fbAuth && window.fbAuth.currentUser) {
      try {
        const token = await Promise.race([
          window.fbAuth.currentUser.getIdToken(),
          new Promise((_, reject) => {
            tokenAbort = () => reject(new Error('Authentication request timed out'));
            if (controller.signal.aborted) tokenAbort();
            else controller.signal.addEventListener('abort', tokenAbort, { once: true });
          })
        ]);
        headers['Authorization'] = 'Bearer ' + token;
      } catch (e) { if (controller.signal.aborted) throw e; }
      finally { if (tokenAbort) controller.signal.removeEventListener('abort', tokenAbort); }
    }
    if (!isPublicCall && STATE.authEpoch !== startEpoch) return { status: 'error', stale: true, message: 'Session changed' };
    const resp = await fetch(API_BASE + path, Object.assign({}, opts, { headers, signal: controller.signal }));
    data = await resp.json();
    if (resp.status === 401 && !isPublicCall && STATE.authEpoch === startEpoch && STATE.user) {
      window._sessionFailureMessage = 'Your login session was rejected. Please log in again. If this continues, contact support.';
      _memberSession.expire();
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid response');
  } catch (e) {
    if (!isPublicCall && STATE.authEpoch !== startEpoch) return { status: 'error', stale: true, message: 'Session changed' };
    return { status: 'error', message: controller.signal.aborted
      ? 'Request timed out. Check Transaction Statement before trying a payment again.'
      : 'Could not reach the server. Check your connection and try again.' };
  } finally {
    clearTimeout(timeout);
    if (opts.signal) opts.signal.removeEventListener('abort', abort);
  }
  // Owner: "l didn't want root domain to work." The server answers every
  // request from a parked address -- the bare domain, its www. form, or
  // anything the admin has retired -- with this code. Handled HERE, in the
  // one place every request passes through, so it cannot matter which call
  // happens to be first: whatever the app was doing, it stops and says so.
  if (data && data.code === 'HOST_PARKED') { showHostParked(data.message); return data; }
  if (!isPublicCall && STATE.authEpoch !== startEpoch) return { status: 'error', message: 'Session changed', stale: true };
  return data;
}
// A plain, final screen. Not notify(): a dialog with an OK button implies
// there is something behind it to go back to, and on this address there is
// nothing -- no amount of tapping will make the app work here. The loading
// screen is taken down with it, or this would sit behind a spinner that
// never stops.
var _hostParkedShown = false;
function showHostParked(msg){
  if (_hostParkedShown) return;
  _hostParkedShown = true;
  try {
    const ls = $('loadingScreen'); if (ls) ls.style.display = 'none';
    const app = $('app'); if (app) app.style.display = 'none';
    const auth = $('authScreen'); if (auth) auth.style.display = 'none';
  } catch(_){}
  // ...and then make it STICK. Hiding the three screens once is not enough:
  // a Firebase session restore landing a moment later runs enterApp(), which
  // shows #app again, and the member is then looking at a half-painted app
  // on an address where every single request is refused. Caught by
  // test-region-currency.py's parked scenario the moment this notice started
  // appearing earlier than it used to. A stylesheet rule with !important
  // beats the inline style any later code can set, which an inline style set
  // from here does not.
  try {
    const st = document.createElement('style');
    st.textContent = '#loadingScreen,#app,#authScreen{display:none !important}';
    document.head.appendChild(st);
  } catch(_){}
  const host = (typeof location !== 'undefined' && location.hostname) || '';
  const box = document.createElement('div');
  box.id = 'hostParked';
  box.setAttribute('style', 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--snow-canvas,#fbf1e8);');
  box.innerHTML = `<div style="max-width:340px;text-align:center;">
    <div style="font-size:26px;font-weight:800;margin-bottom:12px;">${esc(brandName())}</div>
    <div style="font-size:16px;line-height:1.55;color:var(--snow-ink,#1a1310);">${esc(msg || 'This address does not serve the app.')}</div>
    ${host ? `<div style="font-size:13px;margin-top:14px;color:var(--snow-muted,#8c7f76);">You opened <b>${esc(host)}</b>.</div>` : ''}
  </div>`;
  document.body.appendChild(box);
}
function post(path, body){ return api(path, { method: 'POST', body: JSON.stringify(body || {}) }); }

// ── AUTH ──
// The local (national) digits for THIS region -- the dialling code or the
// leading 0 taken off, and the right length or nothing. Mirrors
// localDigits() in server.js.
function localDigits(raw){
  const d = dial(), len = localLen();
  const s = String(raw||'').replace(/\D/g,'');
  if (s.startsWith(d) && s.length === d.length + len) return s.slice(d.length);
  if (s.startsWith('0') && s.length === len + 1) return s.slice(1);
  if (s.length === len) return s;
  return null;
}
// The synthetic address this account signs in to Firebase with. It MUST
// produce exactly the same string as phoneToEmail() in server.js, or a
// member would create one account and then log in looking for another.
// Uganda keeps the bare local digits it has always used, so no existing
// login changes; every other region carries its dialling code, because the
// same local number exists in more than one country and the bare digits
// alone would put a Kenyan inside a Ugandan's account.
// The login address for a number, in THIS region's shape. Must match
// server.js's phoneToEmail() exactly, character for character -- they are
// two implementations of one string, and a disagreement means a member
// creates one Firebase account and then signs in looking for another.
//
// `usesBareLocal` comes from the server (publicRegionView) because the
// answer depends on the FOUNDING region's dialling code, which the app
// cannot see. The `!== false` default keeps the bare form when talking to a
// server that is a deploy behind and does not send the flag -- that is the
// shape every account created before regions existed already has.
function phoneToEmail(phone){
  return loginAddressFor(phone, true);
}
function loginAddressFor(phone, bare){
  const local = localDigits(phone) || String(phone).replace(/\D/g,'').replace(/^0+/, '');
  return (bare ? local : dial() + local) + '@mint-platform.com';
}
// Every address this number could have been registered under, most likely
// first. Firebase folds "no such account" into the same
// auth/invalid-credential as a wrong password, so a member locked out by a
// region setting changing under him is indistinguishable from someone
// typing the wrong password -- he just sees "Incorrect phone number or
// password" for a password that is correct, which is exactly what was
// reported from a live subdomain.
//
// So sign-in tries the other shape too. Deliberately only the two shapes for
// THIS region -- never another country's -- so it cannot become a way to
// sign in to a Kenyan account on the Ugandan site.
function loginAddressCandidates(phone){
  // One address is enough now: the server reduces whatever it is given
  // (national or international shape) to the same canonical number, so there
  // is no second spelling to try. Trying two would also count every wrong
  // password twice toward the server's lockout.
  return [loginAddressFor(phone, true)];
}
function cleanPhone(raw){
  const local = localDigits(raw);
  if (!local) return null;
  const pfx = regionPrefixes();
  if (pfx.length && !pfx.some(p => local.startsWith(p))) return null;
  return dialPlus() + local;
}
function showAuthTab(tab){
  $('loginPane').style.display = tab === 'login' ? '' : 'none';
  $('registerPane').style.display = tab === 'register' ? '' : 'none';
  const tl = $('tabLogin'), tr = $('tabRegister');
  if (tl) { tl.classList.toggle('on', tab === 'login'); tl.setAttribute('aria-selected', tab === 'login' ? 'true' : 'false'); }
  if (tr) { tr.classList.toggle('on', tab === 'register'); tr.setAttribute('aria-selected', tab === 'register' ? 'true' : 'false'); }
  const sc = $('authScroll'); if (sc) sc.scrollTop = 0;
  if (tab === 'register') loadAuthCaptcha();   // a fresh picture every time Sign Up is opened
  stopSmsCodeListener();
}
// The eye on a password box: shows what was typed, and hides it again.
window.toggleAuthEye = function(btn){
  const box = btn && btn.closest('.ma-f'), input = box && box.querySelector('input');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.classList.toggle('shown', show);   // the eye shows a slash while the password is visible
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
};
// The sign-up captcha: a four-digit picture made by the server (the answer never reaches the phone). Tapping the picture asks for a new one; a picture
// is used up by the answer sent with it, so the app asks for a new one after every sign-up attempt.
window.loadAuthCaptcha = async function(){
  const img = $('regCaptchaImg'), box = $('regCaptcha');
  STATE.captchaId = '';
  if (box) box.value = '';
  let r = null;
  try { r = await api('/auth/captcha'); } catch (_) {}
  if (r && r.status === 'success' && r.id && r.image) { STATE.captchaId = r.id; if (img) img.src = r.image; }
  else if (img) img.removeAttribute('src');
};
// Owner: "on login it should not say please wait, it should say logging
// in... so everywhere saying please wait... it should be removed."
//
// "Please wait" tells the member the app is busy, which they can already see
// from the disabled button -- and tells them nothing about WHAT is happening,
// which is the one thing that makes a two-second pause on a money screen feel
// safe rather than stuck. Every busy button in this file now names its own
// action, so `busy` is a required argument, not a default: adding a new
// loading button and forgetting the label is now a visible blank rather than
// a silent fall back to the wrong words.
function setBtnLoading(id, loading, label, busy){
  const btn = $(id);
  btn.disabled = loading;
  btn.textContent = loading ? (busy || '') : label;
}
function fbErrMsg(e){
  const code = e && e.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'Incorrect phone number or password.';
  if (code === 'auth/user-not-found') return 'No account found for that number.';
  if (code === 'auth/email-already-in-use') return 'An account with that number already exists.';
  if (code === 'auth/weak-password') return 'Password must be at least 6 characters.';
  if (code === 'auth/bad-captcha') return (e && e.message) || 'The captcha code is wrong. Please try again.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again shortly.';
  // A weak connection is the commonest real failure here, and without these
  // the member was shown Firebase's own developer text, e.g.
  // "Firebase: Error (auth/network-request-failed)."
  if (code === 'auth/network-request-failed' || code === 'auth/timeout') return 'Could not reach the sign-in service. Check your connection and try again.';
  if (code === 'auth/user-disabled') return 'This account has been disabled. Contact support.';
  if (code === 'auth/invalid-email') return 'Enter a valid mobile number.';
  if (code === 'auth/operation-not-allowed' || code === 'auth/internal-error' || code === 'auth/quota-exceeded' || code === 'auth/app-not-authorized' || code === 'auth/invalid-api-key')
    return 'Sign-in is temporarily unavailable. Please try again shortly.';
  const msg = e && e.message;
  // Any other Firebase code, or its "Firebase: ..." wording, is not for members.
  if (code.indexOf('auth/') === 0 || /^Firebase:/i.test(msg || '')) return 'Something went wrong. Try again.';
  return msg ? msg : 'Something went wrong. Try again.';
}
// ── THE SIGN-IN SERVICE MAY NOT BE THERE ──
// Firebase is a separate <script type="module"> that imports from gstatic
// and awaits setPersistence() before it defines window.fbSignIn/fbAuth. If
// that import or call fails (a blocked or flaky connection on a first visit,
// storage disabled), none of them are ever defined and, worse,
// onAuthStateChanged never runs -- so nothing ever took the loading screen
// down: the app sat on its spinner forever and said nothing. Two guards:
//   - firebaseReady(): login/sign-up wait briefly for it, then say so
//     instead of throwing "window.fbSignIn is not a function" at a member;
//   - a watchdog that, if it has still not appeared, hides the spinner,
//     shows the login screen and says what is wrong. Non-destructive: if
//     Firebase arrives late, its own snow-auth event carries on as normal.
function firebaseReady(maxMs, needs){
  maxMs = Number(window._FIREBASE_READY_MS) || maxMs;
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll(){
      if (window.fbAuth && window[needs]) return resolve(true);
      if (Date.now() - t0 >= maxMs) return resolve(false);
      setTimeout(poll, 100);
    })();
  });
}
setTimeout(function(){
  if (window.fbAuth) return;
  try {
    hideLoadingScreen();
    if ($('app').style.display === 'none') $('authScreen').style.display = '';
    notify('Could not load the sign-in service. Check your connection, then reload the app.');
  } catch (_) {}
}, Number(window._FIREBASE_WATCHDOG_MS) || 15000);
// ── SAVED-CREDENTIAL AUTO SIGN-IN ──
// Chrome (and other Credential Management API browsers) can silently hand
// back a previously-stored password credential with zero user interaction
// -- the "sign in automatically next visit" behaviour the owner asked for
// after seeing it on another site. This is a real browser API for exactly
// that, not something achievable by just reading autofilled input values
// (browsers deliberately keep autofilled field contents out of reach of
// script for privacy, so there's no DOM-level way to detect/trigger this).
function credManSupported(){
  return !!(window.PasswordCredential && navigator.credentials && navigator.credentials.get && navigator.credentials.store);
}
// The saved username (`id`) is the member's phone number, not the synthetic
// Firebase address. Owner: "Why is Google saving authentication data like
// this, l only wanted it to be without @". An earlier attempt set only the
// cosmetic `name` field and kept the email as `id`, but Android's Google
// Password Manager lists the `id` and ignores `name`, so the
// "<digits>@mint-platform.com" kept showing. The Firebase address is a
// pure function of the phone number, so nothing is lost by not storing it:
// tryAutoSignIn() rebuilds it with loginAddressCandidates().
async function storeCredentialIfPossible(email, pass, displayPhone){
  if (!credManSupported()) return;
  const local = displayPhone ? localDigits(displayPhone) : null;
  const id = local ? '0' + local : email;
  try { await navigator.credentials.store(new PasswordCredential({ id, password: pass, name: id })); } catch (_) {}
}
// The red line under the phone box ('phone') or the password box ('pass'); an empty message clears both.
function loginError(where, msg){
  const a = $('loginPhoneErr'), b = $('loginErr');
  if (a) a.textContent = where === 'phone' ? msg : '';
  if (b) b.textContent = where === 'pass' ? msg : '';
}
window.loginError = loginError;
window.doLogin = async function(){
  if (window._loginInProgress) return;
  window._loginInProgress = true;
  try {
  if (window._logoutPromise) await window._logoutPromise;
  const phone = cleanPhone($('loginPhone').value);
  const pass = $('loginPassword').value;
  loginError('', '');
  if (!phone) return loginError('phone', 'Enter a valid ' + regionName() + ' mobile number.');
  if (!pass) return loginError('pass', 'Enter your password.');
  if (pass.length < 6) return loginError('pass', 'Password must be at least 6 characters');
  setBtnLoading('loginBtn', true, 'Log In', 'Logging in...');
  window._pendingLoginSuccess = true;
  try {
    // Tries this region's address, then the other shape for the same region
    // -- see loginAddressCandidates(). The LAST error is the one reported, so
    // a genuinely wrong password still reads as a wrong password.
    if (!(await firebaseReady(8000, 'fbSignIn'))) throw new Error('Sign-in is not available right now. Check your connection and try again.');
    const tries = loginAddressCandidates(phone);
    let email = tries[0], lastErr = null;
    for (const cand of tries) {
      try { await window.fbSignIn(cand, pass); email = cand; lastErr = null; break; }
      catch (e) {
        lastErr = e;
        // Only an "address not known / credentials rejected" answer is worth
        // retrying under a different address. A throttle, a network failure
        // or a disabled account means stop.
        const code = (e && e.code) || '';
        if (code !== 'auth/invalid-credential' && code !== 'auth/wrong-password' && code !== 'auth/user-not-found') break;
      }
    }
    if (lastErr) throw lastErr;
    await handleMemberAuth(window.fbAuth && window.fbAuth.currentUser);
    if (!STATE.user || !STATE.account) { window._pendingLoginSuccess = false; return; }
    // "Remember me" (Main.dc.html) gates the saved-credential store that
    // drives tryAutoSignIn() on the next visit. Unchecked -> nothing is
    // saved, so the login screen asks again next time.
    const remember = $('rememberMe');
    if (!remember || remember.checked) storeCredentialIfPossible(email, pass, phone);
  }
  catch (e) {
    window._pendingLoginSuccess = false;
    // Like the owner's screen: the reason is the red line under the box it belongs to, not a pop-up.
    const code = (e && e.code) || '';
    loginError(code === 'auth/user-not-found' || code === 'auth/invalid-email' ? 'phone' : 'pass', code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? 'Incorrect password' : fbErrMsg(e));
    setBtnLoading('loginBtn', false, 'Log In');
  }
  } finally {
    window._loginInProgress = false;
    if (!window._suppressAutofillLogin) window._autofillLoginTried = false;
    setBtnLoading('loginBtn', false, 'Log In');
  }
};
// ── SIGN UP: phone -> OTP -> password -> confirm password ──
// Rebuilt to the owner's exact mockup: ONE screen -- phone, verification
// phone, password, confirmation, trade PIN and invitation code.
// Owner: "l nolonger need such notifies of in page... all notifies in
// middle not bottom" -- was an inline pink box written into #regError,
// sitting inside the form itself. Routed through the same app-wide
// notify() toast every other screen already uses, instead of a second,
// auth-screen-only error pattern. Kept as its own function (rather than
// replacing every call site with notify() directly) purely so nothing
// else about doRegSendOtp()/doRegister() has to change.
function regError(msg){ if (msg) notify(msg); }
function capError(msg){ const el = $('regCapErr'); if (el) el.textContent = msg || ''; }
window.capError = capError;
// Android Chrome can hand the code straight to the page when the SMS ends
// with the "@host #code" line the server adds (see otpSmsText() in
// server.js): one tap on the system prompt fills the box. Anywhere else the
// feature test fails and nothing changes -- the member just types it.
var _webOtpAbort = null;
function stopSmsCodeListener(){
  if (_webOtpAbort) { try { _webOtpAbort.abort(); } catch (_) {} _webOtpAbort = null; }
}
window.doRegister = async function(){
  // Like the owner's screens: the captcha is looked at first, and a missing or wrong one is the red line under it.
  capError('');
  if (!((($('regCaptcha') || {}).value || '').trim()) || !STATE.captchaId) {
    if (!STATE.captchaId) loadAuthCaptcha();
    return capError('Incorrect captcha code');
  }
  const phone = cleanPhone($('regPhone').value);
  const pass = $('regPassword').value;
  const pass2 = $('regPassword2').value;
  const tradePin = ($('regTradePin').value || '').trim();
  // Referral code box is prefilled from ?ref= (see captureReferralFromUrl)
  // but stays editable -- whatever's in the box at submit time wins,
  // whether that's the link's code, untouched, or something typed by hand.
  // The invitation code is optional.
  const referral = $('regReferral').value.trim();
  if (!phone) return regError('Enter a valid ' + regionName() + ' mobile number.');
  if (!pass || pass.length < 6) return regError('Password must be at least 6 characters.');
  if (pass !== pass2) return regError('The two passwords do not match.');
  if (!/^\d{6}$/.test(tradePin)) return regError('Trade Password must be exactly 6 digits.');
  const captchaCode = (($('regCaptcha') || {}).value || '').trim();
  if (!captchaCode) return regError('Enter the captcha code.');
  if (!STATE.captchaId) { await loadAuthCaptcha(); return regError('Enter the code shown in the new picture.'); }
  const captchaAnswer = { id: STATE.captchaId, code: captchaCode };
  regError('');
  // See firebaseReady(): without the sign-in service there is nothing to
  // create the account with, and the code below would only throw at the member.
  if (!(window.fbCreateUser && window.fbAuth)) {
    setBtnLoading('regBtn', true, 'Sign Up', 'Signing Up...');
    const ready = await firebaseReady(8000, 'fbCreateUser');
    setBtnLoading('regBtn', false, 'Sign Up');
    if (!ready) return regError('Sign-up is not available right now. Check your connection and try again.');
  }
  setBtnLoading('regBtn', true, 'Sign Up', 'Signing Up...');
  STATE.refCode = referral;
  window._pendingRegPin = tradePin;
  window._pendingRegPhone = phone;
  try {
    const email = phoneToEmail(phone);
    STATE.captchaId = '';          // the picture is used up by this attempt, whatever the answer
    await window.fbCreateUser(email, pass, captchaAnswer);
    storeCredentialIfPossible(email, pass, phone);
  }
  catch (e) {
    // Owner-reported real bug: a Firebase Auth account can exist with no
    // matching Mint profile -- e.g. an earlier registration attempt whose
    // account-creation step succeeded but the network call to /register
    // never finished (closed tab, lost connection, a crash) -- the classic
    // "ghost account" this file already self-heals ON LOGIN
    // (bootFromNetwork()'s own NOT_FOUND branch). But hitting Register
    // again with that same number always failed at account-creation itself
    // (auth/email-already-in-use) and stopped right here, before that
    // self-heal ever got a chance to run -- a real dead end with no way
    // forward, exactly what was reported.
    //
    // Fixed: try signing in with exactly what was just typed. A wrong
    // password (a genuinely different person's number, or a mistyped one)
    // fails and falls through to the normal error below, unchanged. A
    // correct password succeeds -- which can only mean either a ghost
    // account of THIS same attempt (ordinary sign-in), or an account that
    // was actually already fully registered (registerCurrentUser() below
    // treats server status 'already_done' as success too, so re-registering
    // an already-complete account just lands them in the app instead of
    // erroring). window._pendingRegPin/_pendingRegPhone are already set
    // above with what was just typed, so the normal snow-auth event fires
    // straight into bootFromNetwork()'s existing "just registered in this
    // tab" branch and finishes the profile with the real PIN -- no separate
    // recovery UI needed.
    if (e && e.code === 'auth/email-already-in-use') {
      const retryEmail = phoneToEmail(phone);
      try {
        const sameUid = STATE.user && STATE.user.email === retryEmail ? STATE.user.uid : null;
        await window.fbSignIn(retryEmail, pass);
        storeCredentialIfPossible(retryEmail, pass, phone);
        if (sameUid && STATE.user && STATE.user.uid === sameUid)
          await bootFromNetwork(sameUid);
        return;
      } catch (_) { /* wrong password -- fall through to the real error */ }
    }
    // No Firebase account came out of this attempt, so what was staged for
    // finishing it means nothing. Left set, the next thing to sign in on this
    // tab -- possibly a different member logging in -- would be treated by
    // bootFromNetwork() as a registration that just happened: a needless
    // /register call, and a "Registration successful" toast on a plain login.
    window._pendingRegPin = ''; window._pendingRegPhone = '';
    if (e && e.code === 'auth/bad-captcha') capError('Incorrect captcha code'); else regError(fbErrMsg(e));
    setBtnLoading('regBtn', false, 'Sign Up');
    loadAuthCaptcha();
  }
};
// ── FORGOT PASSWORD: phone -> OTP -> new password, one screen ──
window.doLogout = function(opts){
  if (window._logoutPromise) return window._logoutPromise;
  window._logoutPromise = performMemberLogout(opts).finally(() => { window._logoutPromise = null; });
  return window._logoutPromise;
};
async function performMemberLogout(opts){
  // {auto:true} marks an AUTOMATIC sign-out (the idle-session timeout
  // above) rather than the member tapping Log Out themselves. Owner: "auto
  // login when Google details are put, it fails to login automatically, so
  // l have to press button, why" -- traced to this function: every logout,
  // idle-triggered or not, was permanently setting the SAME
  // mint_relogin_required flag that blocks Chrome's autofill-then-submit
  // convenience (see the big comment lower down) for the rest of the tab's
  // life. That is exactly right for a DELIBERATE "log me out" ("l don't
  // want to use that very account" -- the original owner quote this was
  // built for), but an idle timeout is not the member choosing to leave;
  // it is a security measure they didn't ask for, and permanently adding
  // "now also retype your password every single time for the rest of this
  // tab" on top of it is friction nobody asked for. Only an explicit call
  // sets the persistent suppression now.
  const auto = !!(opts && opts.auto);
  // Clear before asynchronous sign-out, never after a new autofill selection.
  // Keep the phone on automatic expiry so the member can retry.
  const phoneInput = $('loginPhone'), passwordInput = $('loginPassword');
  if (!auto && phoneInput) phoneInput.value = '';
  if (passwordInput) passwordInput.value = '';
  // Revoke the captured session without delaying the UI sign-out. The normal
  // api() epoch guard would intentionally cancel this call during logout.
  const leavingUser = window.fbAuth && window.fbAuth.currentUser;
  if (leavingUser) leavingUser.getIdToken().then(token => {
    // AbortSignal.timeout() does not exist on older phones: a throw here would skip the server logout and leave the token valid for hours.
    const ac = new AbortController(); setTimeout(() => ac.abort(), 5000);
    return fetch(API_BASE + '/auth/session/logout', { method:'POST', headers:{Authorization:'Bearer ' + token}, signal: ac.signal });
  }).catch(() => {});
  _memberSession.clear();
  resetOverlayState();
  window._triedAutoSignIn = true;
  if (!auto) { try { sessionStorage.setItem('mint_relogin_required', '1'); } catch (_) {} }
  // Signing out always lands on Login, even when this visitor last used Sign Up.
  showAuthTab('login');
  stopLiveRefresh();
  // Defense in depth alongside the _openSheetTitle fix on the checkin
  // countdown's own tick: a sign-out that happens to land while Daily
  // Check-in is still open shouldn't leave this ticking into a signed-out
  // session either.
  if (_checkinCountdownTimer) { clearInterval(_checkinCountdownTimer); _checkinCountdownTimer = null; }
  STATE.authEpoch++;
  Object.assign(STATE, { account: null, investments: null, teamStats: null, teamMembers: {1:null,2:null,3:null}, bankAccounts: null, transactions: null, messages: null, salary: null, page: 'home' }); _teamMembersAt = {}; _teamMembersFailed = {};
  clearCachedState();
  // Without this, an explicit logout would immediately silently sign the
  // member right back in on the next boot via tryAutoSignIn() -- Chrome
  // still has the credential, it's just been told not to hand it back
  // without asking first.
  if (credManSupported() && navigator.credentials.preventSilentAccess) {
    try { await navigator.credentials.preventSilentAccess(); } catch (_) {}
  }
  // THE OTHER auto-login path, and the one that was actually biting. Owner:
  // "why is it that when l try to log out the app logs in automatically again
  // because the cached credentials autofills hence triggering auto login yet l
  // don't want to use that very account."
  //
  // preventSilentAccess() above only stops the Credential Management route.
  // The autofill auto-submit below is a SECOND route: landing back on the
  // login screen, Chrome refills the saved phone/password, that fires
  // onAutoFillStart, and maybeAutoSubmit() calls doLogin() -- straight back
  // into the account the member just left. `_autofillLoginTried = false` was
  // making it worse, not better: it RE-ARMED the submitter for exactly the
  // moment Chrome was about to refill.
  //
  // A deliberate sign-out disables auto-submit for the rest of the page
  // session. Nothing re-enables it, on purpose -- after saying "log me out",
  // no amount of refilling should sign anyone in without a tap. Logging back
  // into the same account still takes one tap on Login, with the fields
  // already filled.
  //
  // An AUTOMATIC (idle-timeout) sign-out skips both of these: the member
  // is still right there and did not choose to leave, so Chrome refilling
  // the fields and auto-submitting straight back in is a legitimate,
  // still-interactive re-authentication (the member still had to pick the
  // credential in Chrome's own picker), not the silent bypass this guard
  // exists to stop.
  if (!auto) {
    window._suppressAutofillLogin = true;
    window._autofillLoginTried = true;
  }
  await window.fbSignOut();
}

// ── AUTOFILL AUTO-SUBMIT (Login only) ──
// This is a SEPARATE case from tryAutoSignIn() above. That covers the one
// stored credential, zero-UI scenario; this covers what actually happens
// once Chrome has several saved logins for the site and falls back to its
// own native "Use saved password?" picker (its own bubble, not something
// this page can suppress or drive) -- picking one there fills the fields
// but fires NO input/change event at all, so there was nothing to react to
// and the member had to tap Login manually even though the values were
// already correct on screen. The :-webkit-autofill CSS trick (see the
// #loginPhone/#loginPassword rules in index.html) is the one reliable way
// to get a real DOM event out of that -- toggling a no-op animation on the
// pseudo-class fires 'animationstart', which normal typing never does.
(function(){
  let debounce = null;
  function maybeAutoSubmit(){
    // Set by doLogout(). A member who just signed out must never be signed
    // back in by Chrome refilling the fields it still has saved.
    if (window._suppressAutofillLogin) return;
    if (window._autofillLoginTried) return;
    const phone = $('loginPhone'), pass = $('loginPassword'), btn = $('loginBtn');
    if (!phone || !pass || !btn || btn.disabled) return;
    if (!cleanPhone(phone.value) || !pass.value || window._loginInProgress || window._logoutPromise) return;
    window._autofillLoginTried = true;
    window.doLogin();
  }
  ['input', 'change'].forEach(type => document.addEventListener(type, e => {
    if (e.target.id !== 'loginPhone' && e.target.id !== 'loginPassword') return;
    clearTimeout(debounce);
    // Only picker-filled fields auto-submit; ordinary typing still uses Login.
    if (!e.target.matches(':-webkit-autofill')) return;
    debounce = setTimeout(maybeAutoSubmit, 160);
  }));
  document.addEventListener('animationstart', (e) => {
    if (e.animationName !== 'onAutoFillStart') return;
    if (e.target.id !== 'loginPhone' && e.target.id !== 'loginPassword') return;
    // Chrome's picker fills both fields together but not always in the same
    // tick -- give the second field a moment to land before checking.
    clearTimeout(debounce);
    debounce = setTimeout(maybeAutoSubmit, 160);
  });
})();

// ── BOOT ──
// Owner: "it takes long to load up, l want everything to be loaded up and
// cached after spin loader, as well as the activity checker, should be
// loaded up too." Before this, boot() ran fire-and-forget from module load
// with nothing ever awaiting it -- both enterApp()'s cache-hit path and
// bootFromNetwork() dropped the loading screen with zero dependency on
// settings/products actually being ready, so the announcement dialog could
// silently no-op (STATE.settings still empty) and the activity ticker
// always did its own separate fetch-after-paint, showing a blank/loading
// strip on Home for a beat. Now the activity feed is prefetched here too,
// and every caller awaits this same promise (capped by withTimeout, see
// below) before the spinner ever comes down, so nothing pops in afterward.
// ── WHAT THE LOADING SCREEN IS ALLOWED TO WAIT FOR ──
// Owner: "l also need faster loading."
//
// MEASURED (test-boot-speed.py, against the real built app): the loader used
// to wait on about 1.3 MB of JSON, and 900 KB of it was /public/mint-images
// -- SEVEN admin-uploaded images, base64'd inside one reply. Of those seven,
// exactly two can appear on the first screen (Home's spin banner and the
// profile GIF); the rest belong to screens nobody has opened yet -- the
// Download backdrop, the manual-payment logos, the announcement picture, the
// Referral banner, the Account logo, the two sign-in backdrops.
//
// So the three heavy replies are fired at the same instant as everything
// else -- they are NOT delayed, and nothing is fetched lazily later -- but
// the app stops BLOCKING on them. They land underneath and repaint what is
// on screen.
//
// _artPromise is that work, exposed so the one thing that genuinely needs a
// picture before it appears (the announcement dialog) can wait for it
// instead of opening blank.
// The loading screen stays for at least LOADER_MIN_MS from the moment the page began (owner: "let it take
// about 3 seconds, then open the page"). Everything that used to hide it immediately goes through here; the
// app is built underneath while it waits, and the pictures start loading straight away.
var LOADER_MIN_MS = 2500, _ldTimer = null;
function hideLoadingScreen(){
  const ls = $('loadingScreen'); if (!ls) return;
  try { startArtwork(); } catch (_) {}
  const began = Number(window._mintLoaderStart) || 0;
  const minMs = typeof window._mintLoaderMinMs === 'number' ? window._mintLoaderMinMs : LOADER_MIN_MS;
  const wait = began ? Math.max(0, minMs - (Date.now() - began)) : 0;
  if (_ldTimer) { clearTimeout(_ldTimer); _ldTimer = null; }
  if (!wait) { ls.style.display = 'none'; return; }
  _ldTimer = setTimeout(() => { _ldTimer = null; ls.style.display = 'none'; }, wait);
}
function showLoadingScreen(){
  if (_ldTimer) { clearTimeout(_ldTimer); _ldTimer = null; }
  $('loadingScreen').style.display = 'flex';
}
var _artPromise = null, _artLanded = false, _annWaiting = false;
function startArtwork(){
  if (_artPromise) return _artPromise;
  _artPromise = Promise.all([ api('/public/announcement-image'), api('/public/mint-images') ])
    .then(([ai, ci]) => { applyBootArtwork(ai, ci); })
    .catch(() => {})
    .then(() => { _artLanded = true; });
  return _artPromise;
}
// Start the pictures the moment the loading screen comes down, wherever that
// happens (a signed-in app, the login screen, an error), instead of at 14 call sites.
(function(){
  const ls = document.getElementById('loadingScreen');
  if (!ls || !window.MutationObserver) return;
  new MutationObserver(() => { if (ls.style.display === 'none') startArtwork(); }).observe(ls, { attributes: true, attributeFilter: ['style'] });
})();
async function boot(){
  // Fired together so Home receives its first activity rows before it paints.
  // The server caches completed activity; this is deliberately not generated
  // client-side so the ticker never invents financial events.
  const pSettings = api('/public/settings'), pProducts = api('/public/products');
  const pBanner = api('/public/banner');
  // The pictures (several megabytes of base64) are fetched only once the
  // loading screen has gone, so they never compete with the account request
  // for a slow mobile connection (see startArtwork()).
  setTimeout(startArtwork, 8000);
  // Only the settings are waited for. The asset list and the Home banner carry
  // pictures (megabytes of base64) and used to hold the loading screen until
  // they had fully downloaded; they now land underneath the app and repaint
  // the pages that show them.
  const s = await pSettings;
  pProducts.then(p => {
    if (p.status === 'success') { STATE.products = p.products; _productsLoadFailed = false; }
    else if (!STATE.products) _productsLoadFailed = true;   // Home then says it could not load, not "no products"
    repaintAfterBootData();
  }).catch(() => {});
  pBanner.then(b => {
    STATE.homeBanner = (b.status === 'success' && b.image) ? b.image : null;
    repaintAfterBootData();
  }).catch(() => {});
  STATE.settings = s.status === 'success' ? s.settings : {};
  // The region that owns this hostname, so the landing screen, Sign Up and
  // the product list already read in the right currency before anybody has
  // signed in. Replaced by the MEMBER's own region the moment /account
  // lands -- see enterApp().
  // regionCount lives on STATE itself, NOT inside STATE.settings: that
  // object is exactly what the server sent, and writing into it threw
  // outright on a reply whose `settings` key was missing (caught by
  // test-cache-quota.py's own fixture, which sends one) -- taking the whole
  // boot down over a number used only to word a login error.
  // regionCount BEFORE applyRegion: applyRegion repaints the sign-in
  // screen's country line, and that line only appears when more than one
  // country exists -- set the other way round it paints with the count still
  // undefined and the line stays hidden on the very load that needed it.
  if (s.status === 'success') { applyRegion(); }
  // The name has just arrived; paint it into the static markup and the tab
  // title. Three call sites in all -- here, the auth-screen prefetch, and the
  // cached instant-boot path -- because each is a way STATE.settings gets
  // filled, and whichever one wins the race has to be the one that applies it.
  applyBrandName();
  applyInnerBackgroundSettings();
  applyNumberFont();
}
// Home and Income show the asset list and the banner; repaint whichever is
// on screen when either lands after the app has opened.
function repaintAfterBootData(){
  try {
    if (!$('app') || $('app').style.display === 'none') return;
    if (STATE.page === 'home') paintHome();
    else if (STATE.page === 'assets') paintAssets();
  } catch (_) {}
}
// Everything the first screen does not need. Called when the three heavy
// replies land -- which may be before or after the app becomes visible, so
// it repaints whatever is currently on screen rather than assuming.
function applyBootArtwork(ai, ci){
  // `ai` = the announcement picture; `ci` = the other admin images.
  STATE.announcementImage = (ai && ai.status === 'success' && ai.image) ? ai.image : null;
  STATE.brandLogo = (ci.status === 'success' && ci.logo) ? ci.logo : null;
  STATE.profileLogo = (ci.status === 'success' && ci.profilelogo) ? ci.profilelogo : null;
  syncBrandLogoImages();
  // Home's banner carousel, slides 2 and 3 (slide 1 is STATE.homeBanner,
  // fetched separately above -- it predates the carousel). Filtered to
  // whichever are actually set, so 1 or 2 slides render fine too, not only 3.
  STATE.homeSlides2n3 = (ci.status === 'success' ? [ci.banner2, ci.banner3, ci.banner4, ci.banner5] : []).filter(Boolean);
  STATE.promoBanner = (ci.status === 'success' && ci.promobanner) ? ci.promobanner : null;
  // Optional admin-managed artwork behind the Daily Check-in sheet.
  STATE.checkinBanner = (ci.status === 'success' && ci.checkinbanner) ? ci.checkinbanner : null;
  // The Login / Sign Up backdrop (single full-bleed photo -- see
  // applyAuthBackgrounds()'s own comment on why there is only one now).
  STATE.authHeroImage = (ci.status === 'success' && ci.authhero) ? ci.authhero : null;
  STATE.authLogoImage = (ci.status === 'success' && ci.authlogo) ? ci.authlogo : null;
  STATE.downloadBg = (ci.status === 'success' && ci.downloadbg) ? ci.downloadbg : null;
  applyAuthLogo();
  applyAuthTagline();
  applyAuthBackgrounds();
  // Repaint Home for the banner and animated profile artwork. The brand-logo
  // nodes are patched in place above; other art consumers render on open.
  try { if (STATE.page === 'home' && $('app') && $('app').style.display !== 'none') paintHome(); } catch (_) {}
}
// The brand logo is fetched with the other large artwork in the background,
// so Auth, Home, or Account may already be visible when it arrives. Patch the
// image elements in place instead of rebuilding a page just for its logo.
function syncBrandLogoImages(){
  const logo = STATE.brandLogo || '';
  const home = document.getElementById('homeBrandLogo');
  if (home) {
    if (logo) {
      if (home.getAttribute('src') !== logo) home.src = logo;
      home.style.display = 'block';
    } else {
      home.removeAttribute('src');
      home.style.display = 'none';
    }
  }
  const account = document.getElementById('accountBrandLogo');
  const fallback = document.getElementById('accountBrandFallback');
  if (account) {
    if (logo) {
      if (account.getAttribute('src') !== logo) account.src = logo;
      account.style.display = 'block';
      if (fallback) fallback.style.display = 'none';
    } else {
      account.removeAttribute('src');
      account.style.display = 'none';
      if (fallback) fallback.style.display = 'flex';
    }
  }
  document.querySelectorAll('[data-auth-brand-logo]').forEach(img => {
    const fallback = document.getElementById(img.getAttribute('data-auth-fallback'));
    if (logo) {
      if (img.getAttribute('src') !== logo) img.src = logo;
      img.style.display = 'block';
      if (fallback) fallback.style.display = 'none';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      if (fallback) fallback.style.display = 'flex';
    }
  });
}
function applyNumberFont(){
  // Defaults to the app's own face, not the old serif. This line was the
  // real reason the calligraphy numbers survived the CSS change: the CSS
  // fallback never gets a chance because --number-font is always set from
  // here, and it hard-coded 'Bodoni Moda' whenever the setting was absent.
  const name = (STATE.settings && STATE.settings.numberFont) || 'System default';
  // Falls back to the app's own body face, not the old serif -- owner asked
  // for the calligraphy numbers gone, so an unset or unrecognised setting
  // must not quietly bring them back.
  const stack = NUMBER_FONT_STACKS[name] || NUMBER_FONT_STACKS['System default'];
  document.documentElement.style.setProperty('--number-font', stack);
}
// Admin's "App tagline (shown under the logo)" Settings field has existed
// since before this app had a frontend to read it -- #authTagline is only
// ever visible on the pre-login auth screen, so this only needs a call from
// boot() itself (which runs once at module load, independent of auth state).
// Owner: "make when l can put background image on those screens of login tab
// and registration tab, make when l can set their opusity and blur."
//
// Written as CSS custom properties on :root rather than inline styles on the
// two elements, because the auth screen is static markup in index.html that
// this module never re-renders -- so there is nothing to re-apply them to
// after a repaint, and the values survive whatever the screen does.
//
// Opacity is stored as a percent (0-100) so the admin panel takes a whole
// number like every other field; it is divided here, once.
// The start-up loading screen picture's opacity and blur follow the settings too (and are remembered for the next launch's first frame).
function applyLoaderFx(){
  const s = STATE.settings || {};
  if (typeof window._mintLoaderFx === 'function' && s.loaderBgOpacity != null && s.loaderBgBlur != null) window._mintLoaderFx(s.loaderBgOpacity, s.loaderBgBlur);
}
// One opacity for every product picture, set once in the admin panel (read again on every paint, so a change goes live with the next refresh).
function applyProductImageOpacity(){
  const po = Number((STATE.settings || {}).productImageOpacity);
  document.documentElement.style.setProperty('--prod-img-op', String(Number.isFinite(po) ? Math.min(100, Math.max(0, po)) / 100 : 1));
}
function applyAuthBackgrounds(){
  const s = STATE.settings || {};
  applyLoaderFx();
  applyProductImageOpacity();
  const root = document.documentElement;
  function set(prefix, image, opacityPct, blurPx){
    // url() is built here, so an unset slot yields `none` and the section
    // falls back to the brand gradient (hero) or plain white (card).
    // The quotes matter: a data URL is fine unquoted, but a filename with a
    // bracket or a space would break the declaration silently.
    root.style.setProperty('--auth-' + prefix + '-img',
      image ? 'url("' + String(image).replace(/"/g, '\\"') + '")' : 'none');
    const op = Number(opacityPct);
    root.style.setProperty('--auth-' + prefix + '-op',
      String(Number.isFinite(op) ? Math.min(100, Math.max(0, op)) / 100 : 1));
    const bl = Number(blurPx);
    root.style.setProperty('--auth-' + prefix + '-blur',
      (Number.isFinite(bl) ? Math.min(40, Math.max(0, bl)) : 0) + 'px');
  }
  set('hero', STATE.authHeroImage, s.authHeroOpacity, s.authHeroBlur);
  // The banner is shown whole, in its own shape (nothing cropped): the box takes the picture's own proportions.
  if (STATE.authHeroImage) {
    const probe = new Image();
    probe.onload = () => { if (probe.naturalWidth && probe.naturalHeight) root.style.setProperty('--auth-hero-ar', probe.naturalWidth + ' / ' + probe.naturalHeight); };
    probe.src = STATE.authHeroImage;
  } else root.style.removeProperty('--auth-hero-ar');
  // The bottom-of-the-banner fade (.auth-hero::after) is switched on only
  // when there is a banner to fade. Owner: "there should be like whites or
  // color bleeding into the image of banner uploaded from admin panel." With
  // no upload the hero is the plain brand gradient, and fading that to white
  // would restyle a screen he has already signed off on, so the class -- not
  // the CSS -- is what decides.
  const hero = $('authHero');
  if (hero) hero.classList.toggle('has-bg', !!STATE.authHeroImage);
}
function applyInnerBackgroundSettings(){
  const s = STATE.settings || {};
  const root = document.documentElement;
  const op = Number(s.innerBgOpacity);
  const bl = Number(s.innerBgBlur);
  root.style.setProperty('--inner-bg-opacity', String(Number.isFinite(op) ? Math.min(100, Math.max(0, op)) / 100 : 1));
  root.style.setProperty('--inner-bg-blur', (Number.isFinite(bl) ? Math.min(40, Math.max(0, bl)) : 0) + 'px');
}
// The round picture above the Log In / Sign Up forms: the admin's circle logo, else the app logo, else an empty white circle.
function applyAuthLogo(){
  const el = $('authLogoImg'); if (!el) return;
  const img = STATE.authLogoImage || STATE.brandLogo || '';
  el.style.backgroundImage = img ? 'url("' + String(img).replace(/"/g, '\\"') + '")' : 'none';
}
function applyAuthTagline(){
  const el = $('authTagline');
  if (!el) return;
  const tag = (STATE.settings && STATE.settings.brandTagline) || '';
  el.textContent = tag;
  el.style.display = tag ? '' : 'none';
}
// Bounds how long the loading screen will wait on boot() -- a slow/stuck
// settings call must never strand a member on the spinner
// forever; past this cap the app proceeds with whatever boot() has (or
// hasn't) filled in yet, same as before this change.
// The settings may be waited for at several points of a start-up (the opening gate, then entering the app). They share ONE budget measured
// from the moment the page began, so a slow connection waits for them once, not once per step.
function waitForBootSettings(ms){
  const began = Number(window._mintLoaderStart) || Date.now();
  return withTimeout(_bootPromise, Math.max(300, (ms || 6000) - (Date.now() - began)));
}
function withTimeout(promise, ms){
  return Promise.race([ promise, new Promise(resolve => setTimeout(resolve, ms)) ]);
}
function captureReferralFromUrl(){
  try {
    // Referral links are now shared as ".../#pages/register/?ref=CODE"
    // (Round 116) -- everything after "#" is the URL fragment, which
    // browsers never send to the server and never populate
    // location.search with, so that form's ref code has to be pulled out
    // of location.hash by hand. The original plain ".../?ref=CODE" query
    // string (checked first, since it's the cheaper/more common case) still
    // works too, so a link shared before this round keeps working exactly
    // as it always has.
    const search = new URLSearchParams(location.search);
    let ref = search.get('ref');
    if (!ref && location.hash) {
      const qIdx = location.hash.indexOf('?');
      if (qIdx !== -1) ref = new URLSearchParams(location.hash.slice(qIdx + 1)).get('ref');
    }
    // <origin>/refCode=<code>, read straight off the path. Checked after the
    // two forms above only because they're cheaper to test, not because
    // either older form is the fallback -- every one of them is kept working
    // on purpose: links already sent to real people are out of our hands and
    // must not start failing.
    if (!ref) {
      const m = /\/refCode=([^/?#]+)/.exec(location.pathname);
      if (m) { try { ref = decodeURIComponent(m[1]); } catch (_) { ref = m[1]; } }
    }
    // The CURRENT shared form (owner: "l wanted my link to look like
    // .../share.html?v=<timestamp>&code=<code>") -- share.html is a literal
    // copy of this same file (see build-core.js), so it boots the exact same
    // app and reaches this same function; only the query param name differs
    // from the original ".../?ref=" form above. `v` is never read here --
    // it exists purely so every generated link is unique (see paintNetwork()'s
    // own comment on why).
    if (!ref) ref = search.get('code');
    if (!ref) return;
    STATE.refCode = ref;
    // Referral codes are case-sensitive on the server (exact-match lookup,
    // e.g. "QcNBht") -- must NOT be uppercased/lowercased here or a real
    // code silently stops matching.
    $('regReferral').value = ref;
    showAuthTab('register');
  } catch (_) {}
}
// Pulls the public settings while the member is still on the auth screen (brand name and region for the Sign Up form). Failure is silent.
async function loadAuthSettings(){
  try {
    const s = await api('/public/settings');
    if (s && s.status === 'success') { STATE.settings = s.settings || {}; applyRegion(); applyBrandName(); }
  } catch (_) {}
  updateReferralFieldHint();
}
// Registration just drops its OTP step when the toggle is off (a brand-new
// account has no existing identity to protect) -- see doRegister()'s own
// branch. Saving a payout account is also unchanged apart from the code step
// disappearing -- see submitWallet(). Forgot Password is the exception: it
// hands an existing account to whoever asks, so it keeps requesting a code
// whatever the toggle says.
// Says out loud whether the box must be filled, instead of leaving members
// to discover it by being rejected. Runs whenever the auth screen paints.
function updateReferralFieldHint(){
  const input = $('regReferral');
  if (input) input.placeholder = 'Invitation Code';
}

// Owner: "let's establish a timer ie like saying snow opening in
// 23:59:34... so it will be after the start up loader, make when l can
// activate it or disable it, just near maintenance mode." A pre-launch
// gate, admin-toggleable in Settings right next to Maintenance mode --
// server.js's own MAINTENANCE GATE middleware enforces the same block on
// the actual money/account routes so this can't be routed around by hitting
// the API directly; this is the client-side countdown screen shown instead
// of the login/app while it's active.
function isOpeningGateActive(){
  const s = STATE.settings;
  return !!(s && s.openingCountdownEnabled && Number(s.openingCountdownAt) > Date.now());
}
function formatOpeningCountdown(ms){
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  return (days > 0 ? days + 'd ' : '') + `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
var _openingGateTimer = null;
function startOpeningGateCountdown(targetMs){
  if (_openingGateTimer) clearInterval(_openingGateTimer);
  const tick = () => {
    const remaining = targetMs - Date.now();
    const el = $('openingGateCountdown');
    if (el) el.textContent = formatOpeningCountdown(remaining);
    if (remaining <= 0) {
      clearInterval(_openingGateTimer); _openingGateTimer = null;
      // Target reached -- reload into a genuinely fresh boot rather than
      // trying to splice this handler into the normal auto-sign-in/login/
      // enter-app flow inline; every ordinary path (including a
      // still-active gate if the admin pushed the time back out in the
      // meantime) then runs exactly as it would on any real visit.
      location.reload();
    }
  };
  tick();
  _openingGateTimer = setInterval(tick, 1000);
}
// Checked at the very top of the snow-auth handler, before auto sign-in,
// the login screen, or entering the app -- STATE.settings is normally
// already populated by the time snow-auth first fires (boot()'s own
// /public/settings call started at module load, independent of auth
// state), so this resolves instantly in the ordinary case; the
// withTimeout() fallback only matters on a genuinely first-ever, slow-
// network boot, same "don't block the common case for a rare edge case"
// reasoning Round 63 already established for the announcement dialog.
async function maybeShowOpeningGate(){
  if (!STATE.settings) await waitForBootSettings(6000);
  if (!isOpeningGateActive()) return false;
  hideLoadingScreen();
  $('authScreen').style.display = 'none';
  $('app').style.display = 'none';
  $('openingGate').style.display = 'flex';
  startOpeningGateCountdown(Number(STATE.settings.openingCountdownAt));
  return true;
}

// ── AUTH STATE HANDLER ──
var _memberAuthTask = null, _memberAuthTaskUser = null;
function handleMemberAuth(user){
  if (_memberAuthTask && _memberAuthTaskUser === user) return _memberAuthTask;
  _memberAuthTaskUser = user;
  const task = processMemberAuth(user);
  _memberAuthTask = task;
  task.finally(() => { if (_memberAuthTask === task) _memberAuthTask = null; }).catch(() => {});
  return task;
}
function onMemberAuth(user){
  handleMemberAuth(user).catch(() => {
    notify('Could not open your account. Please try logging in again.');
    hideLoadingScreen();
    $('authScreen').style.display = '';
    setBtnLoading('loginBtn', false, 'Log In');
  });
}
window.addEventListener('snow-auth', ev => onMemberAuth(ev.detail));
// The sign-in script announces who is signed in (or nobody) once, as soon as the page is parsed. This code is unpacked a little
// later, and on a slow or busy phone it can be MORE than a little later: then that announcement happened before anyone was listening
// and nothing ever took the loading screen down. If it already fired, take it from the sign-in script directly.
if (window._mintAuthFired && window.fbAuth) onMemberAuth(window.fbAuth.currentUser);
async function processMemberAuth(user){
  // Ignore repeated notifications only after the account is actually open.
  // Failed account setup must remain retryable for the same Firebase uid.
  if (user && STATE.user && user.uid === STATE.user.uid && STATE.account && $('app').style.display !== 'none') return;
  // Also bump here (not just doLogout()) -- this is what actually fires when
  // a DIFFERENT user logs in right after, and it's the guard that matters if
  // Firebase's own token expiry/refresh ever drops us out without doLogout()
  // having run first.
  STATE.authEpoch++;
  STATE.user = user;
  if (user) {
    try {
      const token = await user.getIdTokenResult();
      if (STATE.user !== user) return;
      const started = Number(token.claims.auth_time) * 1000;
      if (!_memberSession.begin(user.uid + ':' + started, started, false)) return;
      try { sessionStorage.removeItem('mint_relogin_required'); } catch (_) {}
    } catch (_) {
      notify('Could not verify your login session. Please try again.');
      await window.doLogout({ auto: true }); return;
    }
  } else { _memberSession.clear(); clearCachedState(); }
  if (await maybeShowOpeningGate()) return;
  if (STATE.user !== user) return;
  if (!user) {
    window._pendingLoginSuccess = false;
    // Only worth trying once, on the very first "nobody's signed in" we see
    // this page load (a real boot) -- not after an in-session doLogout(),
    // which already called preventSilentAccess() specifically so this
    // wouldn't immediately hand the same member right back in.
    // Returning to login never silently reuses a stored password.
    window._triedAutoSignIn = true;
    hideLoadingScreen();
    $('app').style.display = 'none';
    $('authScreen').style.display = '';
    setBtnLoading('loginBtn', false, 'Log In');
    setBtnLoading('regBtn', false, 'Sign Up');
    // Sign Up needs to know whether a referral code is required BEFORE
    // anyone submits, and boot() (which normally loads settings) only runs
    // after sign-in. Without this the screen would fall back to "required"
    // and the very first account could never be created.
    loadAuthSettings();
    return;
  }
  // A sign-up in progress stays on the Sign Up page (its button reads "Signing Up...") until the member lands on Login: the startup loader is
  // only for opening the app, never for registering.
  // A login the member just typed does not show it either: Login stays (button "Logging in...") until the app is ready, then Home opens.
  if (!window._pendingRegPhone && !window._pendingLoginSuccess) {
    $('authScreen').style.display = 'none';
    showLoadingScreen();
  }
  await enterApp();
}
// Real feature: a returning member used to sit through the loading screen
// on EVERY app open, even though nothing about their account usually
// changed since last time. Owner (relaying a friend's advice on instant-
// loading sites): "it loads basic ui features as backend loads user data
// through api... no delays." The app already does this cache-first pattern
// per-sheet (Withdraw, Records); this extends it to the
// boot sequence itself using a small persisted snapshot (localStorage
// survives a full page reload, unlike STATE, which doesn't) -- a RETURNING
// visit paints instantly from last-known data with zero network wait, then
// quietly refreshes in the background. A first-ever login on a device has
// nothing to paint from yet, so it still goes through the one real,
// unavoidable network round trip (bootFromNetwork, unchanged from before).
var CACHED_STATE_KEY = 'snow_state_cache';
try { localStorage.removeItem(CACHED_STATE_KEY); } catch (_) {}
function loadCachedState(uid){
  if (!uid) return null;
  try {
    const raw = sessionStorage.getItem(CACHED_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Never trust a snapshot saved for a DIFFERENT account -- a shared
    // device switching users must never paint one member's cached balance
    // into another's session, same reasoning as STATE.authEpoch's own
    // cross-session guard.
    if (!parsed || parsed.uid !== uid) return null;
    return parsed;
  } catch (_) { return null; }
}
// Product photos are stored as data: URLs inside STATE.products, and at the
// 1200x900 frame the admin now saves them at, twelve of them is a few
// megabytes on its own -- enough to blow localStorage's ~5 MB quota. The
// setItem below is in a try/catch, so that failure is SILENT: the snapshot
// simply stops being written and every boot goes back to a cold network
// wait, with nothing on screen to say why. So build the snapshot once, and
// if it will not fit, save it again with the image bytes stripped out --
// everything else here (balance, plans, team, transactions, minimums) is
// what the instant-boot path actually paints, and the photos refill from
// the live /products fetch a moment later behind the skeleton cards.
function _cachedStateBlob(uid, withImages){
  const products = withImages ? STATE.products
    : (STATE.products || []).map(p => Object.assign({}, p, { image: '' }));
  return JSON.stringify({
    uid, account: STATE.account, investments: STATE.investments, teamStats: STATE.teamStats,
    bankAccounts: STATE.bankAccounts, transactions: STATE.transactions, transactionsTruncated: STATE.transactionsTruncated,
    products, settings: STATE.settings,
  });
}
function saveCachedState(uid){
  try {
    sessionStorage.setItem(CACHED_STATE_KEY, _cachedStateBlob(uid, true));
    return;
  } catch (_) {
    try { sessionStorage.setItem(CACHED_STATE_KEY, _cachedStateBlob(uid, false)); } catch (_2) {}
    return;
  }
}
function clearCachedState(){
  try { sessionStorage.removeItem(CACHED_STATE_KEY); } catch (_) {}
}
async function enterApp(){
  // Belt-and-suspenders alongside the isScrollLockOverlayOpen() fix above:
  // a fresh app entry (a login, or a resumed session on page load) can
  // never legitimately have a real overlay open yet, so there is nothing
  // to lose by unconditionally clearing any scroll lock a PREVIOUS
  // session's SPA-level logout left stuck (the exact "freezes, no
  // scrolling" report this round root-caused).
  unlockBodyScroll();
  // Fire-and-forget, both branches below: a card deposit the member never
  // returned to the app to see resolved (they closed the tab, lost signal,
  // whatever) picks back up here on the NEXT open, however long that is.
  resumePendingCardDeposit();
  const uid = STATE.user && STATE.user.uid;
  const cached = loadCachedState(uid);
  if (!cached) return bootFromNetwork(uid);
  STATE.account = cached.account; STATE.investments = cached.investments;
  STATE.teamStats = cached.teamStats; STATE.bankAccounts = cached.bankAccounts;
  STATE.transactions = cached.transactions; STATE.transactionsTruncated = !!cached.transactionsTruncated;
  // subagent-audit-caught: products/settings used to never be part of this
  // cache-hit restore, so My Products showed "0 plans" and Deposit/
  // Withdraw's min-amount hints showed "UGX 0" until boot()'s own live
  // fetch happened to land. `||` prefers boot() if it already won the race
  // by this point (STATE.products/settings default to null until it
  // resolves) -- never overwrite genuinely fresh live data with the
  // possibly-stale cached copy, only fill the gap while waiting for it.
  STATE.products = STATE.products || cached.products;
  STATE.settings = STATE.settings || cached.settings;
  applyBrandName();
  // subagent-audit-caught real regression: Round 57 added a wait on
  // _bootPromise right here to stop the announcement dialog/activity
  // ticker popping in after the spinner -- but THIS is the cache-hit
  // "instant boot" path, which has no spinner to gate in the first place
  // (Round 46 built it specifically so a returning visit paints with zero
  // network wait). Making it block here reintroduced the exact "takes long
  // to load" complaint for the common case (a returning member) instead of
  // fixing it. The wait now happens narrowly in showPage()'s 'home' branch,
  // just before maybeShowAnnouncement() -- gates only the announcement's
  // own appearance, not this instant paint.
  hideLoadingScreen();
  $('authScreen').style.display = 'none';
  $('app').style.display = '';
  showPage(STATE.page || 'home'); prefetchSupportedBanks();
  maybeAnnounceOnEntry();
  if (window._pendingLoginSuccess) { window._pendingLoginSuccess = false; notify(t('Login successful ✓')); }
  refreshAppDataInBackground(uid);
}
// Shared by both bootFromNetwork() branches below -- retries /register,
// which self-heals a missing profile doc and is a safe no-op if already
// done. A typo'd referral code (now that it's a hand-editable box, not just
// a silent value from ?ref=) must NOT sign the member back out -- their
// Firebase auth account already exists at this point with no profile doc
// yet, so a sign-out here would strand them: retrying register later hits
// "email already in use" and they're locked out for good (the exact
// ghost-account trap Round-something-earlier already fixed once). Retry
// once with the referral dropped instead; everything else (PIN, welcome
// bonus) still goes through.
async function registerCurrentUser(pin, phone){
  let reg = await post('/register', { referralCode: STATE.refCode || '', pin: pin || '', phone: phone || '' });
  // The invitation code is optional: a wrong one is dropped and the registration carries on without an upline.
  if (reg.status === 'error' && reg.code === 'BAD_REFERRAL' && STATE.refCode) {
    notify(reg.message || t('That referral code is invalid. Continuing without it.'));
    STATE.refCode = '';
    reg = await post('/register', { referralCode: '', pin: pin || '', phone: phone || '' });
  }
  return reg;
}
// A member signed in to an account whose sign-up never finished (the Firebase
// account exists but the profile was never completed -- classically a mistyped
// referral code, or the app closing mid-sign-up). Login cannot finish it: with
// OTP on it needs a fresh verified code, and the referral code has to be
// right. Before, they were left on the Log In screen with "Please verify your
// phone number first." and no way to tell what to do. Now: say what happened,
// sign them out cleanly, and open Sign Up with their number already filled in.
// Re-submitting it takes doRegister()'s existing "email already in use" path,
// which signs in and finishes this same registration.
var SIGNUP_UNFINISHED_CODES = ['BAD_REFERRAL', 'BAD_REFERRAL_REGION'];
async function abandonUnfinishedSignup(reg){
  hideLoadingScreen();
  if (SIGNUP_UNFINISHED_CODES.indexOf(reg.code) === -1) {
    notify(reg.message || 'Could not complete registration');
    $('authScreen').style.display = '';
    setBtnLoading('regBtn', false, 'Sign Up');
    return;
  }
  const local = localDigits(String((STATE.user && STATE.user.email) || '').split('@')[0]);
  window._pendingLoginSuccess = false;
  await window.fbSignOut();
  $('authScreen').style.display = '';
  showAuthTab('register');
  if (local && $('regPhone')) $('regPhone').value = '0' + local;
  if ($('regReferral') && STATE.refCode) $('regReferral').value = STATE.refCode;
  setBtnLoading('regBtn', false, 'Sign Up');
  notify((reg.message || 'Your sign-up was not finished.') + ' Complete your sign-up below.');
}
async function finishSignupToLogin(typedPhone){
  window._pendingLoginSuccess = false;
  window._pendingRegPin = ''; window._pendingRegPhone = '';
  await window.doLogout();
  hideLoadingScreen();
  $('authScreen').style.display = '';
  ['regPhone', 'regPassword', 'regPassword2', 'regTradePin', 'regCaptcha'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  setBtnLoading('regBtn', false, 'Sign Up');
  showAuthTab('login');
  const ph = $('loginPhone'), pw = $('loginPassword');
  if (ph) ph.value = typedPhone;
  if (pw) pw.value = '';
  notify(t('Registration successful!'), () => { const el = $('loginPassword'); if (el) { try { el.focus(); } catch (_) {} } });
}
async function bootFromNetwork(uid){
  // _pendingRegPhone identifies a signup started in this tab; it works
  // without an OTP ticket.
  const signupFlow = !!window._pendingRegPhone;
  const regTypedPhone = signupFlow ? (($('regPhone') || {}).value || '') : '';
  let r;
  // subagent-audit-caught: a brand-new registration always paid for a
  // GUARANTEED-to-fail /account call first (the profile doc genuinely
  // doesn't exist yet the instant after Firebase account creation), THEN
  // /register, THEN a second /account -- three sequential network round
  // trips before the real prefetch even started, on every single signup --
  // owner: "the startup loader should load all data, and should be fast...
  // no taking long." doRegister() sets _pendingRegPin/_pendingRegPhone
  // right before creating the Firebase account, so their presence here
  // reliably means this boot is for a registration that JUST happened in
  // THIS tab -- skip straight to /register instead of wasting a call
  // already known to fail. Captured into locals and cleared immediately so
  // a later re-login in the same tab session (no page reload) never
  // wrongly takes this shortcut again.
  if (window._pendingRegPhone) {
    const pin = window._pendingRegPin, phone = window._pendingRegPhone;
    const reg = await registerCurrentUser(pin, phone);
    // The session changed while /register was in flight (a second sign-in
    // event for the same account, or a logout): whatever replaced it owns the
    // screen now. Treating this as a failure would sign the member out of the
    // very session that is opening.
    if (reg.stale || !STATE.user || STATE.user.uid !== uid) return;
    if (reg.status !== 'success' && reg.status !== 'already_done') {
      hideLoadingScreen();
      notify(reg.message || 'Could not complete registration');
      $('authScreen').style.display = '';
      setBtnLoading('regBtn', false, 'Sign Up');
      return;
    }
    window._pendingRegPin = ''; window._pendingRegPhone = '';
    r = await api('/account');
  } else {
    r = await api('/account', { timeoutMs: 10000 });
    if (r.stale || !STATE.user || STATE.user.uid !== uid) return;
    if (r.status === 'error' && (r.code === 'NOT_FOUND' || r.code === 'REGISTRATION_REQUIRED' || r.message === 'User not found')) {
      // Ghost account (Firebase user exists, our profile never finished in
      // an earlier session -- e.g. a crash/reload between account creation
      // and /register finishing) -- self-heal the same way.
      const reg = await registerCurrentUser(window._pendingRegPin || '', window._pendingRegPhone || '');
      if (reg.stale || !STATE.user || STATE.user.uid !== uid) return;
      if (reg.status !== 'success' && reg.status !== 'already_done') {
        await abandonUnfinishedSignup(reg);
        return;
      }
      r = await api('/account');
    }
  }
  // Same reasoning as above for the account fetch itself.
  if (r.stale || !STATE.user || STATE.user.uid !== uid) return;
  if (r.status === 'error' && !window._pendingLoginSuccess && ((!r.code && /timed out|Could not reach|Too many requests/i.test(r.message || '')) || r.code === 'AUTH_UNAVAILABLE' || r.code === 'SERVER_ERROR')) {
    // Re-opening the app on a slow or dropped connection, a busy server (429) or a store outage (503) is not a reason to end
    // the login: show the login screen with the message and keep the session.
    // (A login the member just typed still signs out below, so a retry is clean.)
    hideLoadingScreen();
    $('authScreen').style.display = '';
    notify('Could not reach the server. Check your connection and try again.');
    return;
  }
  if (r.status === 'error') {
    hideLoadingScreen();
    if (r.code === 'BANNED') { notify(r.message); await window.fbSignOut(); return; }
    notify(r.message || 'Could not load your account');
    await window.fbSignOut();
    return;
  }
  // A brand-new account does not go straight into the app: the member lands on Login with the number
  // already filled in, so only the password has to be typed.
  if (signupFlow) { await finishSignupToLogin(regTypedPhone); return; }
  STATE.account = r.account;
  // The member's OWN region wins over the hostname's: somebody who signed
  // up on the Kenyan site and then opens the Ugandan one still sees Kenyan
  // shillings, Kenyan prices and their own number rules, because that is
  // what the server will charge and pay them in.
  applyRegion(r.region);
  // Prefetch everything every tab needs, all in parallel, before the loading
  // screen ever comes down -- so the very first tab switch (and opening
  // Withdraw/Withdrawal Accounts/Records) is already cache-first-instant
  // instead of only becoming fast after a first visit to each one. This adds
  // no real time over the account fetch alone since it's parallel, not
  // sequential -- one network round trip's worth of latency, not four.
  // Only what the shell itself needs is awaited: the account (fetched above)
  // and _bootPromise, which carries settings -- Home cannot paint its
  // announcement or tagline without them. The per-screen datasets are fired
  // here and allowed to land underneath.
  //
  // This is why the skeleton loaders were never seen. Awaiting them all meant
  // that by the time the app became visible, every dataset a skeleton covers
  // was already in memory, so the "nothing cached yet" branch could not fire
  // on any screen.
  await waitForBootSettings(6000);
  hideLoadingScreen();
  $('authScreen').style.display = 'none';
  $('app').style.display = '';
  showPage(STATE.page || 'home'); prefetchSupportedBanks();
  maybeAnnounceOnEntry();
  if (signupFlow) { window._pendingLoginSuccess = false; notify(t('Registration successful ✓')); }
  else if (window._pendingLoginSuccess) { window._pendingLoginSuccess = false; notify(t('Login successful ✓')); }
  // The invite-address pool, fetched behind the app rather than in front of
  // it, so even the FIRST open of the Referral screen has an address ready
  // and costs no round trip. Tiny (a few hostnames), un-awaited, and a
  // failure is silent -- shareOrigin() falls back to the current origin.
  refreshShareHost().catch(() => {});
  // Still prefetched, just not in front of the member. Each screen's own
  // render() re-fetches what it needs anyway, so whichever tab is open
  // repaints itself when its data arrives -- nothing here has to push to it.
  Promise.all([
    api('/investments'), api('/team/stats'), api('/bank/list'), api('/transactions')
  ]).then(([invR, teamR, bankR, txR]) => {
    // Signed out, or switched account, while these were in flight.
    if (!STATE.user || STATE.user.uid !== uid) return;
    if (invR.status === 'success') STATE.investments = invR.investments;
    if (teamR.status === 'success') STATE.teamStats = teamR;
    if (bankR.status === 'success') STATE.bankAccounts = bankR.accounts;
    if (txR.status === 'success') { STATE.transactions = txR.transactions; STATE.transactionsTruncated = !!txR.truncated; }
    saveCachedState(uid);
  }).catch(() => {});
}
// Runs right after painting instantly from cache -- reconciles with the
// real server state silently, no spinner, no repaint flicker (only patches
// the live numbers already on screen if Home happens to be open, matching
// renderHome()'s own patchHomeBalances() pattern rather than a full
// re-render). Errors here are non-fatal: the member is already looking at
// real (if slightly stale) data, so a failed background refresh just means
// try again on the next open, never a forced sign-out.
async function refreshAppDataInBackground(uid){
  try {
    const [accR, invR, teamR, bankR, txR] = await Promise.all([
      api('/account'), api('/investments'), api('/team/stats'), api('/bank/list'), api('/transactions')
    ]);
    // Signed out, or switched to a different account, while this was in
    // flight -- api()'s own authEpoch guard already turns each response
    // into a discarded {stale:true} error in that case, but bail out
    // explicitly too so a stale snapshot never gets written back to disk.
    if (!STATE.user || STATE.user.uid !== uid) return;
    if (accR.status === 'error' && accR.code === 'BANNED') { notify(accR.message); await window.fbSignOut(); return; }
    if (accR.status === 'success') STATE.account = accR.account;
    if (invR.status === 'success') STATE.investments = invR.investments;
    if (teamR.status === 'success') STATE.teamStats = teamR;
    if (bankR.status === 'success') STATE.bankAccounts = bankR.accounts;
    if (txR.status === 'success') { STATE.transactions = txR.transactions; STATE.transactionsTruncated = !!txR.truncated; }
    saveCachedState(uid);
    if (STATE.page === 'home') { patchHomeBalances(); paintMyAssetsInner(); }
  } catch (_) {}
}

// ── NAV ──
// The six bottom-nav icons are the owner's own artwork (see CLAUDE.md's
// "Icon assets" note), shipped as PNGs in user/ rather than inline SVG --
// the inactive state is greyed with a CSS filter, exactly as the mockups do
// it, so one file covers both states.
// 4 tabs now (owner's mockups), inline SVG (ICONS.*) instead of the raster
// PNGs the other 5 sibling projects' fork all inherited -- 'assets'/
// 'network' are the two NEW consolidated tabs (see renderAssets()/
// renderNetwork()); 'catalog'/'products'/'referral'/'team' stay valid,
// still-dispatchable STATE.page values (Account's own rows still route to
// some of them as an interim measure) even though nothing on the bottom
// bar links to them directly any more.
var MGI = {
  mail: '<svg viewBox="0 0 24 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.4" y="3" width="19.2" height="14.4" rx="3"/><path d="M3.6 6.2l8.4 6 8.4-6"/></svg>',
  nHome: '<svg viewBox="0 0 34 34" aria-hidden="true"><defs><linearGradient id="mgNg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0aa152"/><stop offset="1" stop-color="#067a40"/></linearGradient></defs><rect width="34" height="34" rx="7" fill="url(#mgNg)"/><path d="M17 8.4 7.6 17h2.7v8.6h13.4V17h2.7z" fill="#fff"/><path d="M17 5.6 5.4 16.2l1.7 1.8L17 8.9l9.9 9.1 1.7-1.8z" fill="#ffc72c"/><rect x="14.2" y="19.4" width="5.6" height="6.2" rx="1.1" fill="#067a40"/></svg>',
  nOrders: '<svg viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="7" fill="url(#mgNg)"/><rect x="9.4" y="7.6" width="15.2" height="20" rx="2.4" fill="#fff"/><rect x="13" y="5.6" width="8" height="4.6" rx="1.4" fill="#ffc72c"/><path d="M12.8 15h8.4M12.8 18.4h8.4M12.8 21.8h8.4" stroke="#067a40" stroke-width="1.5" stroke-linecap="round"/></svg>',
  nPromo: '<svg viewBox="0 0 34 34" aria-hidden="true"><defs><linearGradient id="mgNy" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6c52e"/><stop offset="1" stop-color="#dc9d16"/></linearGradient></defs><rect width="34" height="34" rx="7" fill="url(#mgNy)"/><rect x="7.4" y="13.6" width="6.4" height="6.8" rx="1.2" fill="#1a1a1a"/><path d="M13.8 13.6 22 9.2v15.6l-8.2-4.4z" fill="#fff"/><path d="M13.8 13.6 22 9.2v3.2l-8.2 3.2z" fill="#1a1a1a"/><path d="M25 13.4l3.6-1.6M25 17l4 0M25 20.6l3.6 1.6" stroke="#0a8a4a" stroke-width="1.8" stroke-linecap="round"/></svg>',
  nTeam: '<svg viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="7" fill="url(#mgNg)"/><circle cx="10.4" cy="12.4" r="2.5" fill="#ffc72c"/><circle cx="17" cy="11.2" r="2.7" fill="#ffc72c"/><circle cx="23.6" cy="12.4" r="2.5" fill="#ffc72c"/><path d="M6 24.6c0-3.4 2.4-5.4 5.2-5.4 1.2 0 2.2.4 3 1 .9-.6 1.8-1 2.8-1s1.9.4 2.8 1c.8-.6 1.8-1 3-1 2.8 0 5.2 2 5.2 5.4v.8H6z" fill="#fff"/></svg>',
  nSalary: '<svg viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="7" fill="url(#mgNy)"/><path d="M14 8.2c0-1.4 1-2.2 3-2.2s3 .8 3 2.2l-1.2 2.4h-3.6z" fill="#1c3b2a"/><path d="M13.2 11h7.6C24.6 14 26.4 17.6 26.4 21.4c0 4-2.6 6.6-9.4 6.6s-9.4-2.6-9.4-6.6C7.6 17.6 9.4 14 13.2 11z" fill="#0c7a46"/><text x="17" y="24.6" text-anchor="middle" font-family="Roboto,Arial,sans-serif" font-size="11.5" font-weight="700" fill="#fff">$</text></svg>',
  nProfile: '<svg viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="7" fill="url(#mgNg)"/><circle cx="17" cy="12.6" r="5" fill="#fff"/><path d="M7.4 27.4c0-5.6 4.2-8.8 9.6-8.8s9.6 3.2 9.6 8.8z" fill="#fff"/></svg>',
  // Profile list tiles (the small picture inside each coloured tile)
  tDownload: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" fill="#0a8f4b"/><path d="M10.6 6.6v6.4l3.8-3.2z" fill="#fff"/><rect x="7.6" y="15.2" width="8.8" height="3.2" rx=".8" fill="#ffc72c"/></svg>',
  tCard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="3" width="21" height="18" rx="5" fill="#0a8f4b"/><rect x="5" y="7.6" width="14" height="8.8" rx="1.8" fill="#fff"/><rect x="5" y="9.6" width="14" height="2" fill="#2c2c2c"/><rect x="6.6" y="13.6" width="5" height="1.5" rx=".7" fill="#ffc72c"/></svg>',
  tWallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="5" fill="#f2b542"/><rect x="4.4" y="7.4" width="15.2" height="9" rx="1.6" fill="#0a8f4b"/><rect x="4.4" y="9.4" width="15.2" height="1.6" fill="#ffc72c"/><rect x="15.4" y="12.4" width="4.2" height="2.4" rx=".8" fill="#fff"/></svg>',
  tChat: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5.5" fill="#0a8f4b"/><path d="M6.6 7.4h10.8c.8 0 1.4.6 1.4 1.4v5c0 .8-.6 1.4-1.4 1.4H11l-3 2.4v-2.4H6.6c-.8 0-1.4-.6-1.4-1.4v-5c0-.8.6-1.4 1.4-1.4z" fill="#fff"/><circle cx="9.2" cy="11.3" r="1" fill="#ffc72c"/><circle cx="12" cy="11.3" r="1" fill="#ffc72c"/><circle cx="14.8" cy="11.3" r="1" fill="#ffc72c"/></svg>',
  tLock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5.5" fill="#0a8f4b"/><path d="M9 10.6V9a3 3 0 016 0v1.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><rect x="7.4" y="10.4" width="9.2" height="7.4" rx="1.8" fill="#fff"/><circle cx="12" cy="13.6" r="1.1" fill="#ffc72c"/><rect x="11.4" y="14" width="1.2" height="2.2" rx=".5" fill="#ffc72c"/></svg>',
  tKey: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5.5" fill="#f9c824"/><circle cx="9.4" cy="12" r="3" fill="none" stroke="#fff" stroke-width="2"/><path d="M12.4 12h7M16.6 12v2.6M19.4 12v2" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  door: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#f6c22a"/><path d="M7.4 6.6h5.2v10.8H7.4z" fill="#fff"/><path d="M12.6 12h5.4M15.8 9.6 18.2 12l-2.4 2.4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cardMini: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="#3a9f62"/><rect x="5" y="6.8" width="14" height="10.4" rx="2" fill="#fff"/><rect x="5" y="9.2" width="14" height="2.2" fill="#3a7a54"/><rect x="6.8" y="13.4" width="4.8" height="1.6" rx=".8" fill="#f3b92f"/></svg>',
  tickMini: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="5.5" fill="#0c8a4a"/><path d="M6.4 12.6l3.9 3.9 7.4-8" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copyMini: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="#0c8a4a"/><rect x="8" y="6.6" width="8" height="10.8" rx="1.6" fill="#ffc72c"/><rect x="10" y="5.6" width="4" height="2.4" rx=".8" fill="#fff"/></svg>',
  plane: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 3 10.4l6.4 2.4L12 20l2.6-5.4L21 3z"/><path d="M9.4 12.8 21 3"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.4 20.6l1.3-4.4A8.6 8.6 0 1 1 8 19.5z"/><path d="M9 8.6c0 3.2 2.6 5.8 5.8 5.8l1-1.4-2-1-.8.8c-.8-.4-1.6-1.2-2-2l.8-.8-1-2z" fill="#fff" stroke="none"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#fff"/><path d="M13.3 22.4v-8h2.6l.5-3.2h-3.1V9.2c0-.9.3-1.5 1.6-1.5h1.6V4.9c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.4H7.7v3.2h2.6v8z" fill="#0866ff"/></svg>',
  xmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 3h3l-6.6 7.6L22 21h-6.1l-4.8-6.3L5.6 21h-3l7-8.1L2 3h6.2l4.3 5.8zm-1 16.2h1.7L7.3 4.7H5.5z" fill="#fff"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 3c.3 2.3 1.7 3.8 4 4v3c-1.5 0-2.9-.5-4-1.3v6.2a5.6 5.6 0 1 1-5.6-5.6c.4 0 .7 0 1 .1v3.1a2.6 2.6 0 1 0 1.6 2.4V3z" fill="#fff"/></svg>',
  warn: '<svg viewBox="0 0 41 38" aria-hidden="true"><defs><linearGradient id="mgWy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe266"/><stop offset="1" stop-color="#fbc21f"/></linearGradient></defs><path d="M20.5 2.4 39 34.8H2z" fill="url(#mgWy)" stroke="#e9a21b" stroke-width="2.4" stroke-linejoin="round"/><rect x="18.6" y="12.6" width="3.8" height="13" rx="1.8" fill="#1c1c1c"/><circle cx="20.5" cy="30" r="2.2" fill="#1c1c1c"/></svg>',
  okc: '<svg viewBox="0 0 41 38" aria-hidden="true"><defs><linearGradient id="mgOk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1ed48a"/><stop offset="1" stop-color="#05a867"/></linearGradient></defs><rect x="1" y="0" width="39" height="38" rx="5" fill="url(#mgOk)"/><path d="M9.6 19.6l7.6 7.6 14.4-15.6" fill="none" stroke="#fff" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.6 6.4 8.6 12l6 5.6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
// The open treasure chest with gold coins (transparent background), used on Home and on the Treasure Chest page.
var CHEST_ART = 'data:image/webp;base64,UklGRoqJAABXRUJQVlA4WAoAAAAQAAAAtwEAhgEAQUxQSBAVAAAB/yckSPD/eGtEpO4jjiRJapzuYUCu9P8Hw3p3jej/BEgS2G6tfbAdAdit1iqplOIhnT1wZkp8ppZu8w7Vz2oOkbmBWuZaSMrMlUJ9Zq4Bg2JW+QtD8apU8OoREU+ATeIw2IYVAAZz37bphktsM4fCsG3bMJL+/7rtlmI7ICImAMCMtqAWdJR9QBlrADbM2rw5h90UYjy+2labVZfR6KN6o9gP3fU88s8cZ25C5iB0fAQQs6o9pmRbe9uG+bj/SRaQaRbRe+JuNXerS7a6RIpiAQH838BKJY4MjBIRE0DZtva2rfN9PwASJEVRXXK3mlWuS9zt9D7KA+TZM8qo996DAUH5Ltqy6VEiYgJ8//+/OI3/f/f7cyxGCAnapYJsWV7u7u7+eh3J2/1feB+5u7u7u7uv77b7rivQBk0CySSZmefzcdBCAiS9zPNtjYgJgOMplEAB7I5qhFfvXItOjt3cEvRKWxEAPDfSAAQpPgE48fYiI9Twsl208p+tl808e0v3ZN6eMwDFl7ySsaOR4lNUMKJGT2+v2oBEmXE+dOp6JLPXNr31GymBN3/J58bGy6GS+IGO/eGJRGQqi0sFOR6mGgCxspAi6JlVZgG86a0vHp2byc2Zalce3Ngn4Umk/Mm55Vwz2Qs18TKAPgAggHw+YJAZm0uuN9rxg5ly3Mqo1w+9W5sjpD1ZyGBy7uxotWME5f5ARUApX7rqzjpgHrjolWdLZ2adfpTt2+yIJOPDMRo5LRx/YnG+XO2K4DiSAAjC8TbqFb2recwIQIYGQb+0MD/rr3Siftj1Uh8bny34gXl/ZpUByAcClSkvzY1tdgXHndSlF0XX92I5Nrzn3kOhSwj4pYXFiVaoDfpL4RHkG3Vsf/2qiqGCeSBwii9bytc7RjAI/WK009nc08eBQgDwir6CxLtd6R9d4pXPPFbqtAwE/WZ0DMLoA0yam+ncKYmd2Aw7SvFlS922EcFgJBxvda0TyZEjVVDJkMXlSQey+fiK6ZeJEwEgZP3olU+/aKzZ0iJg3/4q8adEZmIhf2Ii7MRmqNHuLEztaBEMSkKxrXXY6spRIvzxCa/0WJmIt9sEdq9s9y1rtkuAah4LxdZKBbOvm6mFGoIjTtALMrOTGQk7XRleRP+9sbrBQCWRzWY31zqGR0Z543MLp/zWelukawQAYoN+69lcA0wunrV+f1Pa1oXu5MJp1TIC8KgBJOl52VwuaYexGVZgsuMIBi7dYLfarkdHxSktz0/VwzgRHEkRAqiWiS3bjbf2zNaD7vTr5+7EOMakcrPZbNxpROBQUpH+M8YAJsXhzW030eThsfzK5U7b4KgLIUn8+OUfsSkXfe7Ua3Oh4LjTDXK4sR2DQ0g3T5uf6EEEwEEtc7KxbSCHJi99tK4hRw5EJFz88PU3a5ZJkGdx6kVBR3D8hS5qUSuLocv6xnTzu78wqImpk1u3XRVRKUj/KBtzSgt49AAQNv7hiybKSsW4ExJAcOp0rW0wCAkw771jNmtkuMj4qhUZuJuw8+fVbauAWc31EdLwb6jSI5ndjqhvcuu3f/VyLIdCpxwFwJ0c9yYXigAg252GO6V88WvnNThE+OdnZjvEAy9Gz5cGZec2OyK73h4QHYkAIP3Sy17ujSrUuXvlx39rx/TEFWiMTM0GBLyZGbdW6woAbeBUBqVua8QZGmRU//Rr8qEDIALIbquPcHq+IMzO1XqnCyC7tJxrJBa1lt0/+/FnQpH78SASBgSS+bYtTrgCJNVuojGYiWR2KRc4Q6NxmPyNtUnBcRVXBLth89yFbqYw8uKplqDmou/+yS8/376P8D4qjgRMDkcGTE9HZjPSALRggHN0bOpsRoYAnQNNatz6AP8EIKAmlr3nzztLr/SutAXHP7nzx7/6fOceNTLqAqidzAIwWQ41oJKAIoKBTzU2XgMHn0q6liDWMgEgyAb5QnlONTuCQZis/dkfb9wTvPQVeQDRZFsDKjAAiHVJttVinhxsKtk+fq2vuKaOM/+mV8cbWjAgk81rTQHgzcx6AEQrAIRbKwDKp3MY6MrdeuWti2FMrHV6Jx9JDAanJAIAVA6GueM7A00YHF3tZYZY81QKKatAZZlGdS2DLNUWMYOKFLDKAkASdI5ogxScYsQ58dqtjqReRLO7Ftd0XzgXIvUWqV8OrVukU9veS9IvII5zcQu6eiLvpGEACLrEHa1kFVJxwqzXhq6gNrOzGaZjgLprZu6g5AIiLbfb+cHQDSr7yEJRITWnpPcT4wapvGTWZ4rGrNOr6IKk6YxniBQ9Yr5ZKtZPoiTvM1UD5P1sIQ4Idc5Byi7paFexbtLtFAIyZQPK7l1eN91GxiFS9/y7r5ZkvbqtbECk7qyeLxKpFXXbzTpI46t0Hts6IQ6DDFM5ZrePivUh6pJTSOf0fJaZ+oBXNhTSeru8nEt9so0YTOuc7uUNfWycCgtESk8wbh4bektZP7UDg2zYOS7wpxyF9J45Zy/h/fBP5AzSPLd+aQ/3kawstx0yvQPiWvteAMlmc08kxWNONRVLRweycyHYQZpPLxfHZWNmYiaADje7qR7ob1pXLlaWz57wKdFNXzHNE7OzZcrlzL6DbW2gjYN03828CFgqbywfQxQEaT/NRlQmcmxhzYAA0z6S5yNdIqjSdAhL6M53VJkyU1FkC9AYNaQ0xOjyhlgCsvPqbnnQurxFWgIg7CUsT7uRiNgCIsxMaaI7exmHtgAyuBmosnRurwvsobSvFpblMM1OoCwCzOz1FlmK6Oo1WAWpb1iUs3vhXBtWkUQ5JdqLQNoEgOUwrbjgwCY6NtqmFJ1WJlC0CTSzqxp5eKZ6IXZgF1VvP0EJ9coTNdjGYDIOylBvaNAy2OWhLUFzjQFhGRknUoLatSZsLNEwnpUBX/o93zCtLAxzn/upj2ZhXynFb/yBV/vWgSqNeUhwSt/+tePKNhDx6Sw4JGYf/dnPFmgbADvZ1ockwNcve7CPNJEcEsLnTgQU+4BkunFIoldBgraBzC6GhwQkJCBiGQBVjw5NAOhaTduGkkr0wtO7sbExZnNl60bNiHUBTLz9+M2wLfYFktQbN/4rFPsCiF4514SdjduJGCMWBvRPzBVGGWAAj/pUrsnwAi3jr30VYkA+PZRAFF6AMrf5VjPAgHZysagkxMh+uJ7MDRlaAOq82S7IKLgAjGNb5cLwAtJOGzsJMICsHmMRBhjayhRvMcMLAIkvXwolAYZ6tXl/yYTBBaCZ3myJyL/ptlszQB8MSd8m2L1arh1AyRcF/RqQPc3qR8rybGLp2aht/QAp3hKrNOnRWGm4UaheB0oif1Y8D7UbIpRPD/vU+DIyb3UdAbJM51dzoR8DJC/pCICSvmzozRxLbWi1DTAAcXiZW4aZRlcjyNq0kDyxAQagfr1J6b0oLpJlL7OGfsssFto9gNV2P4gtfVbZapQuAmR1OfZaLN9W1k3UcW6zgr6KZtDJ4egIKB8eS/FUjFdClwMKZDXsbhcFvRQQGTWwABo1P5ta+qlBL8VbYpRmeAFEytdBRfomibWvBhyoHh8VEHkmXd2ocNCBRSHZVtMz3al5gw+EGV2stPgkae0UnCEASDJcj+eG3ohSvVEihqKYQ+NewRtHprXrYVjaJDEqE/ohAEYNDUDspJWIJ4pbGXeIgMuHWMQHUepXH1FDxSibvyXif4B6NYchK9uLnia9T3E34w8bVqvEKEW/Q6QXy2rYABIfvfX6S0tOmgPg1no8fIiwdX72FaNkekMUKo3bbRk2ACW9furlYykOmJufXr3RHT4gz18+86oRpjdQI/OZc5tmiNAH7F3YeeUUmN6AhdGN29Gw4ErSCgsZItWNNqoxhwJJk1kpgIQNjVQ3vPQCMfgpImk36NzsqiJzc1tSHXP3n+tq4FGSSTuY3WTpuM0VOgapbrL6ZAeDnZR45+TjZdDZDKkFVbE0L62aAafi7ZPXrw8bIoIKWczKP7c40CTePL29GTYMUS1L6+lLCgOcTI5ur/frBlWzcO/fqgMt6bbmw7omqme9c6WJwS16eNOJtKCCktblq97AIiDtHSuopjvVVQ4WHoiECCrqeDXe0B0UEPvTphoOrqIyzUvewR2kypYD7qOWpylAVNTJrfWigSOVPz7ujS+VsK/czGJU18la6MKNdCYfXZz1djfb+5luKNWV2d2pKDfQmXnd/FY71jgoUWHHN9ZzdADFyU2+LB8KUnPZvlZSqL+CqrxiYa8tSM1Ftm/mcMzpwB8vBCdP1CNBek4TR/5xoRNNQJWmMyOPTsh60whSdAnrBfeIEY45Y1RnlCNU5VQ2rHbiRJCmS/fSjQkeIXpsIICd7kWjq0Ag62GiBSm7YO9ZcXA0mQNMGkSLqQXi41kYZxowglQ+2nN5NARg3NTsX23G83EIqMiSEECQyusWc4dHETbbAWTjoCbNWVusAUAARGqvNy+UfPSZBEjQMNxqBYNhSPfjN39CaQHhABAVvnTP38yzH4RQQM91WDkzkjlRRrUZiWiBLYxv/+ulNvpIMBM4cGfnfSdb9lu1ODGwimb9j/+qJtKbP+oH82cCKMen2ewaI7CNZvUfr3UFvarMmVdPM9YJkqY2RkQI6yjdvQg9+xOnF4NuFIlAIAJbKejZmX3T7EoiAggAwlYqjz0FZxdDjXsJi6nKi0X2okY9Lfexmmr2DRWyB4CwIMyUfMLOEg8LSHUnx6MVkd4ousvMY3kroidXGbnamVeNkhZE4qbBHXVsYEMdiLtef7whYkFe5s5KF3Z2/EzG0sy/bpS0MrlRD7ZWrM3/nkxLEzZiW8K7XH+8IWJDnFLZ7WHrVgc2lP6LX5MHD1SeDawInKlHPOLA868vkTYEVJCDFcY82FCBADwYIDZETNyoadhXCa8+/hf/HhqxLnrlF7/px5/vwLpK67m//5eLTekhCrX1EGn8x9WORq83/20tFssBxLttQc83fvv3z28nYjn8cp69tc/93Pf+7rmm2Axy7I3zbm/SufinP/Lzt41YDCBzuqJ6g+jGlQu7QqtBpdBf3WlpWE0ddqU/nF1vheFCZPfp27o/dn6fECGzeaFq+gOrBEHTnyiwT4GTHHvjvGNjAH+qqOwMSDz0/0P/Pzwmn2kYJOp5RrbOW8Jnmd5hRjzLqkDwv/8f+v+h/x/6/+FVRZSdMbu1iTythvIU+yIra2fLoMXg6EtO5xX7oRNfwWJSTX3iK9877bA3NT29KTYDyLzo81//gUmnD+OTESynP/66L35gXPVE5SS2g6rwys++xGMvoMB6kvnTE44czMl6up1YD4BK4eBO+ZWnNleM0HroVlt4ELf8yjnVSGA9RZpPX4vlIJVXzexqgQ0NL69qHHTpxbsGljRKcOByQYst6ZUQPPT/f5OvSgaaSXsfbFIyyOhS8L///5/tkhUMM0X7XjHEyPy8qxFeKXnzj4RhRQCYbry1PqVoUQQApL11ZS066cGiGuhG20S3rrVQ8WBLRUtruxNeWdHMVDJKoXcNRdsg2kiysRVvX951x4uO5xNE73ormvJoDwRAvHdzWyd37ySlscBXAAFIH6KrO4tjHsGUTu5DAALAdGODaPXK3TrcmcB1cF9Bf3Xt3ObSYpaggKmbYF9CAOlsX7kVwUSq6DqKOPT2+Wedxybd4ogDqJRN4lpoAKig5O7tab12uQ3CH3FIEodv2pvnL7f803OBKk74+5Cq4jJGoGu3L9zRADD+WO7WjQj5SkYpKOKoitm6uNPd3krU1FyOPmnuxloVEMJ75CCEAysaASSO1jcSxGvrpREFQJp3o0rRc3wFEEfaxDq5W03M+q02/Gr06sZoS3vo+gqEiWOznxhDrMhKhB8YmcpAdm7Uqusazomcwr3SWO0o3F+O1r1Gi9mtxuJDrd08XQQe9+Rywc2hfvlKe79oMg4kiMTnZ9VBQPLy7b4lEtZk0nfhKOwrCY65iEEhhWmsPM7cK4qlV+Dx/3jhAHY5t3p4knqo6yEB0OdYNTACWKWlIG30Bg1DTARKASAGMwHC7+ec4ovxwnpb9qO1onYWNebQmPcIhq3II5BqgULYXf9sbHl4GKtMQZEEABlQWAWACtDV4H5eHSjk3Z/f/wagOWtJTrc6OiciTz8a6vnOIL/9o7MibGUiEkOVgt7pAHoAIwBruxlz9vgsAcB4ry0ARUsB4QDwaUQAVks8SPeXjxWq2awgQJymFHpUq2MAoHkz0gBbsxZ9KtR34tODHwilBXrULyd/LNUyFsAKTmEK8qYZC8D+1YZPaoe7ClBJWEQAfFIQIFAdsqeuQvnQyYtdRSFOZ3oAAkBQMz6mx3sabJztKR91PaaATwibJ4YyvXq/f6kgeS5kBOIE9wDwQawhkC42irLLqWl09AoijzdSgGLWvkhoF4+xKgEQIE57otARAI2mD9GoFy0uUxbo7sAYeXQxAmjiaUYufrnp5aCtiI/E55VKqfZGiEJ7dNGdtFlACQR0BXx88Ai1IVB0b3+Zk9k0NsSnWcgiabb7t7uqqLXoig1X4+OBAAhU5eF5YsDkqjkrACHxSSeDzEpR72IjXk5DD22iAdL5uNYIRMIiszCj1qzRNaDZZxafewJEsa6ZaDa2HrV/0YTYVlBAri0RAtUmfWoeoCedfaYIEOAnD6sBRGjEI4ODGmX3pu9h2G0QoOLa0SbcyIjF2WDULUGtSHwkPCMdCL/SAjb3a/RkNwcGtDtt8SjtI1yOD5YOq+vbV97Jw3BrNABGOOY9qQlvOGgosHE91Tk1GMc5ZQw8bgU+HAJ01y7e3CyMZQANI8LPCgkXtGqS05OLOgHEB0MDgDrWBQRAFwgARLf+c3PSc0j4XTrQkcgzSrXncBrmOmcb9FCnEQmwTowggLSaevuCExBpsQ8AAYBRKADQOuyJr34x0d2VlhoJCdXZ3rt1pe3P+kTqTOQd4ZVQ0YN4tKGi47PWdpP3QszeelNgGpe2iyUv7xLpNT0ORKFW0Bub2x+9lRWIkZX4UgSgSKIF0Z3rV3YEyE9nPRLpu5Lk4sM+PazP+kEozkfkeTABgCgKb1Q1kvW47CvAIYg0ng5JK/ShfTkaHiYsCGMF4uAm7Jrk7pXd3RDwyy72lVQOAEH4dRqPjhLx6eFpxmA0OEhYfe56JGKyBUdBEek/UUwYq+BXm7OazLz+hNovuf7PT2fo5h1FEpaRcGABVCAoLYzxAFvX6iRB4gEYVlA4IFR0AAAwwgGdASq4AYcBPj0aikMiIaEVSY70IAPEozubFRx3SxLkkELSznzb9xf3vSmyP6L/if4r92PZj477Wfe/3P/M/sJ8v/73rb93/3/lrdIfqD2c/7j9t/eN+mv/l/mv3/+hb9bv2H/z3wi/7H7me/z/Bf+D1X/13/mfuH7r//m/7H/C+BP9W9UL+kf6b//9ln+7/sm/q56uf/q/eb4ev3H/dT3Jf7L/4/z////0AegB6hP8A7Jf/KfhF+lHyE8sv1/5UfuJ62/kX1v+s/w37kf4/m09qeaP83/MP8D/Mfu38Iv77/y+Pv5b/Lf9v1GvyP+g/6f+9/u775UpTr1+R6HHwt96/7H+Z/dj/B/tL9F/63E//8D2q/6floexf8D3EP6v/k/9t/kf3c/vv0xf6n/s/3v5I/Fj80/3H/d/OT6Dv5L/Tv9V/ef8//5P8R////d95XsL/Zv2FP1KUNZNWNwf1jHsguR0vRl6CdYenQFGdun/yNT4THDb8TV1JcZRPCzx5rOE0rAkfRq+JxIxFs5J3blbH6Fa8LvV0wzE9giszwcR0Nju15ZlopXNqttsrKwYt8pkZ0cgNDs/dRRlqO2T4N3BNHb/1p0IxH8ME+aMSGmJgC62deQdfALKUBnbl5qHvg6cxpsm/sECpUDpk/rjgaEuYFV8lP5qtb2K1gsSoiumMZs/ygNgWzDp2zg9U/oGTEwHC8xq5c3/1oBXoqmuhkcgryO91D4cxX7JegBfki9fSoPR+JHeTCjjTVeBjbWATBA8rCFortZG53/HolyNT9umCES00FO+HkMMhe6mgHdhLP0mmJEufiKWIMO81hH2EZZtB4l9OiIQx9O8GCYNzmOW8cTHtpZ96EkFdIs9AuDD8/e3uvdvG/fOLdkMskJTEMrSjZ46UfW+VrC5hLrVbYX8z2RrgspCc9/J1bTZ+IXJ9X00efzChHlf8NzMZn/5HzilUa+zBiiLPjRtS5oGYLKXh7LG7pWW0v9GVIGzpj5/J3mAAyDGw+WaMBzNQuiF+S+1/osHSKN/TaeAySPzkCZyaRIX8zs0SVF6OCfz0B+f0qUtjZZZrph5dOACp0D5tQV40T6yjR3baW19QQZYV9KlrtYz9+lGbTnBRL2D6zlF1HHPDyKYgGNAvtmADUsoS6U4coIwTqWpwoqX1wCyTXmB6cy/oUGnC+/8qo0TJwhBl4OoXgflqcURHcTD38BHbNA63p9ACbuOLo11hxleeNHRfRPa1pT34h79c9QuG9nF5G+c1UVZq19QgmDBqaSasWt8wKqZ1hUtqbaNDOY8OoVagc99OP1I3InOBzj1Oh0xw9DxN5Swxp586J2GRXN9BjA1O+STanvkjL7KlXkOVc5C/H2IcIHJpYVMvTjpeMK1vOD9rc+zVeS/fg6JGmRc3LkuCWzpre4Bji7eLGaf2DD5vd5fjgIGfWPIPJiuOWTGN8LZhTssa5A2u9HizM/ElM6U7tvjKn4+OWjjZRign+i+jzPJm5C866o2FCQ0dLQQxwyQXu5gtcP3tO8XU3P7U8qyIH3G5XuUlrRIkMoIIiWi0t+lR0uN4cVHlCl/IkJa8Tled4y44+2UZarQxh+cv25IFXZtTDSW+G9cEwaaBa0bvMo30l8nDzHRnGSU08+7NWbgi5QZ1uf9leIny1UD9PYY1etgNJyfFWv/US7tFpa8Iv7uvk4Iyys0iJCaeoMJ4jvz5stLbXHJ7Jt1DOf0cdzJLS48kgfUO8ic+67jt4MOrHLeVsN5QzqkDZPUVrIn7gXA3CW88buBDMQ+haVJL9hVqESBdHN4VDK+Dnrpt1XCWdhlc1RCY/iK47C1Yx/pjoxRWuAubbHfILUH4SQDjZduPN4UEo+C/9NX86RZbwxZhPZP8PdijX9m4vwooAXc3zIgCLfHS7I5dz/avBNrVwgReNPHtxFzzathE0Rsyn0dp5xD+ovTT4SVhb3nqBWOnoceEn90cQHddOn8cmaFHqNYqst77/nuaATY1rREw4fMhWFZW+gDF1VjzZzWEEMpdUtzSUnc5rR1iuKMEoyb1Lbst5MHgjj/g5iWZE7aVgD1xoOY5jJlQt6rIbeGTA9ECbHMabwOagJXIl3JqdMLNCfzMtZ2JBbWVqYVyxaVL97bGe6v8clxwPWbkg78j94AhvuYWiZd03hhR1zqXrFYCV0lwWJCOevU7EmfFb2pDld4ccx1a6CLTFid1QJ5EUmOaFRNVtIM5VYM/EOXl4eRdXnGWUMJs7+24oqHix1ZO//uQS7by8UIhfxucKT8nzWXAnke3v6AUolKAQE1Z1I6k4VOcEqrnTzPN8P/fBayVmmez4vC8GFr8KGYiGe0B36dfKA2+0jIQRKQtlzVpXcNIt90xvq0olsIIexd3GdrylPXk4PDjoSCu2czNju5FddCjVfZqh1NzAdhHsLuZqm8Hu8UFTv41V5xoZcj7Ok7Su0dR7NmUXRAv6k4tOvP2tY8mTCI13u7c386TsZ2g4/nbQ0qElN3QxaqwVsTdjxFnueHyOd1rn4Zcf6Bs6VXGGYvrKEnYOSA1DPVXA21+oIh8fshgtI9s007HDrenMzCkm1xlrPNi615RxP3Ke/XuIiuOuJ3MpVqfdTsop7YzX2lfH0qOrgCIyFXknwPlQwDWO+TVhv/8O3lmjQufzXP6hXojPzR8Jw2roZuKODcvTvwYL6XRdZZjA/uz42aQMrSZocmD3L5T+Y4ByDgcjte8sVvczAGenTZJxUJ4aoMOhC9yRn8gK0/ur8oAF5rgmYKWIaa22KrbLlq+Qfd0q6bq6zP6/QbymtemhUqm5g9la6WVdxU2cu6yanHAyRcpI7Aqajp98Y5ozY9U+AULaEUQo8rqGChY/IVT2LmxfTrGetivS0RKEpKlXwC2b7db8oR83/sLO6O99NPAqk6zA1V6tJa+zJ6T0q55mI9d6aWDG4K6jNn+IkfV2Iycj7iWywLZg9YSePzultmL7ZPF9O0hB542yBT7jbuCqrfW3iexlbMh8KaVyn3IjsrwZ5npdF7mjKVuR8GVwjRJbX23p9dV981dlL8FRY0ujBNn5LatGwXaTw8tQZR47TuAnNjABCrK/NJf0oKUSfJSmEn3IxRf7HiCOxKjULeF0xy77qEdlPuEIoR9QLzGOR69QQekkTnL/kcwiQNHrfUmV/RHOoivErFbJL0yPFgZWmLp8WtVRUeX7fnzefthDiXU78RWPJKarwu6cy3M482E8+rnNXBTGgUrUOGpuFDErA34+l7sIMPdFcd+cw2VUT6iKrOgNp327YbmNfdp6c0voBpBmRGN17KqqL+TqHjF4u6pyPWOGCF+VniXjp1gHgFtFz5ZTcRRwgljoHtm7U7AhMH15lhlEAELGqN1Nrjz8dmtXVfGWl059SqR4teU6xqbpafVeQM6QgIvGrf1pxhBfHyGZAHfw0CwWCMMZSKLH6S8hcl0SLZu2X6QOUcUuHmkz6ihrR0s9HNio3/pY+sMvyktnA+57yWXHzAW6lc1hCzf3+N5zUwntexfqppXFazOqREnFmYxYaGftR8z/pXF4qHlEKCcUQU53+owzIMkSVOJAI//Ru4ezFfMj3MmSNvsvqhoLUcpesdHNPBcIlNTUFn8I/atm7klHoqmmyh/UyGNUCUXTMObBe2Xnrx6vVetZmtHVLVLOkX/iV12bPSR6P2hLZEIEA12/L7Nkc3zcg0GhCuMoIy4dZFcKbKqvPxmOEaVSl52riQu7vuH/vIc1kq1BtwlIV6q6nejeB9HNJcrdEb/9BzsjqDynJ7IBjIF8FmCootKQmVYjzry5yHEqWH7p6+t/U3AixW9vjxHxY1wYXNiXpSUX7WfjS6oQSIgT8edTzFn3YzROomlXMJoLeA8LGnDNRtMuqaLDgi8wYOM1l9jyJE36JaE0UOZi3BlPGGbo7ToFgr1VjGnYAbPOPeQC5ey81Pjyhn61OwvI8WRkzpF+NFrj2i/v0Z8GJ6HP8mJktZmglgoXZuEsxWvaVzFPDtmki13QoVc62gJOeOCJQ+H4LsxP2CxgnyVMa/mgjC3Onk/7hZU3bM4kMQYI2+FUjOJK2RwKKobI9uSWLtLeVn6P3QMBKyiUJHpUFl2Fb55BEVxGE79htzwLtSDxo+u+wN1GvRnjhwRTo2y51P9xPZGSirGseICmONpC0Oz/aGOJLkmzzfoM/yFQEoV6YCMdSQ+fN+ll5snvT4p4u3IwhOohQn9kjt1DwZTksIQ57g6RY3XtV9V5wUMGpclgX+9YhsvxVBO4vJ3q45w6bk5Zj3GpMM+mVuFDVsLkPd0N3XZTFOwFwWmVxQRjlVsMNTiRqSm+ljMrRnvSceN8Hefbc03b6NmcD/izaT26nJ9co70J8/fmRLyvUycGTvpo0BzRQiHgpejCwLg+rvvivLpEmE+TTHwC99k8uqxNr1EzxIRTZhmyH9s4iFsnvc7DxTZm4vWJO6A1XhI6tlmlg2rJ37UgWp0Fzeels+E5tWaT4g8e8lHCUN1RI0m6IAykazllr+ANokNAkc9hp4S0KZo93vRucNLv1nv5P361iyc4vMWBpsdGj0zZBuTx2FohRf0LD1zv9HdUVA9ib8A4zaDKzetnS+NmfA832DkT8k3x2JtpdpkWcLIXthEEyFJctrm3Ykgibq/g0b6LCI3d5C867xyXtV2sr5so+9S2DaozzbkezAkoTe2FetXn/qPN2wPk3ym+kKW3bpB57AOweNRd7DK/zpvmrvkGTepzrWv7OWvtU1eJTBk2TzckDLUeoR4PUU9waQEzMBPX8/GYC0CjiyPoFR5zw7OPa0PXAAAP7w6QAY/6C7DusSjv6Vgo3qcIf4p8YBaNLlTgNP6ZZ0bFVFEgIQnwjoOnkRTKHP6DAgyWfHlFMC+x9SmgdR3p5cgNi9o4B7nb1PpkrSIoRv+O0OOTS83WuNnzDQYHbj/iU4g1TEeI1na6rBO01Jhp5SJ5usjDKgp1CHYd9eiRT/I8S0ojbeACNMs6kClj8dLEK7aMDRY4eGiqaE3z7AnokxHKDTWp1295HsSY0lld8Tm8iCI993nwJMMV6Ko3XkPenKg6qFzYl/lLvgkY2SaMP1tnjrwviVDayoYfpyKXrpF2IOiafj7v2Xt4Iww2sRAoek43E+vPcdvkjVKYdimiw+0pc5fe08C5SZ58TUPD3pI//wdlDTCAVMIta7qX+cFS6gXuyvN+tHn3HzmQvyXVQTz9Tvll45xFQXcN9yHvt5Pz21QnE25uG0J/M7GjpNb/iEzSYxnQ9Owk7AvxQiTtIpf7A08wnbvaJVvlJN3NiCegXgoAwgBzWfNd/5JwrN2wyMY76HO1egEe1DX1dlNhi7GWBn3Pe7xQmXqXAc+9wOXqT9sOQD2XD6lEB1aOKtH+wN9S045lAtFM1SW7nPvHQU4yTvDx5B0YC47EDoTX8RrUjZz2e6Q1ObRaHXYTqwsknul6d+OFrA1M0LYmWxpPTfwYjr0m6RNOj93/ceWwdWpbZfJ9sXWQE9jtAAkPecniRwmqZZtRIKooqdvaniyBIYWUJ+kBHfifq4VhziyPlpCJnObM8b8IHVJhLQEJqoVSHEip4+jy9xnU6MD5JDiL/Rt611aWoYiiFkYYa1LUiiP5GbDvumBdsCyZm5xQryl8VVgYEiNnce/Ghw8z23oKxi4huszek+9AcFfFmPRO95J1S57DywYf7dBUZa0w3jdpdLz6vLt5TDzMDYUhUyyDPRjFnLqfG0s3JA/seWp58ntD6dX41FfEOfKrR3QiiTwk8rye5wAf/6nT8rswEhFnMVmTWvz2gRcZ/BfzacA8dhji4GmU3SUk4/+Vgj6T1ppy9SOVHZ2GnQ2LMgNtmYDDxAng5b5Ux16gmNyD3up8/rZjieXQ50aDYO+oyCKXyIn2ZigxntT1Odn/ujTxhlqQlHa0tRw65Fm+0Pne6KqB9BiXBbu4gX1dhYi5EgG557nABHBkX4sN4hChhbnCzVfO9bITWIGMwaLHG4lOZaN2NYYLdR2xTunlwY7cv637BtIolYrQnwTSO8uNQFjxsCk2Aq73ECq05WpSTkQyA8oLw0Kur2KIFI8nIn5u0NddD4T7539EbjORM2Z6iqj5gQKezZz2pPbvbrApfH8hP3m1+C/+yH8ChbZGQMvHq25i1j/yub/2jLI0QDebTFMAW6UoLQCEJX76Rj4BnWkHizebsOp33UDU2q9W51joTq33LjzIuqnPQArjMkeL+wCBBHij5ueFJ/qs6OcNSEWN3R5RgoqATl0qgAZ0vtEECwgHOSKOfvdgCYDA5OqmJcvEVVfxEABU/fbD29W3qQjFaEBEUTIzK6smSIBCozBcOrAvQ4z/cjWKmbDnmH5ZOGuyjm+hbY0bVO1cH/xAOki3HUirgsAr8+GEMMhfKioykPhhKqh4IkeedQdmF/Cpq+Dw4f53ckpkERAbpTMhbdT+33HLmuADTpBg3NgQsaQLV047peESOd42i+zfisc7fM8gJ4uKluKFA/p4mgbVXyknd1jhjP+B0RSPfPLa8Zx+JmpY6WDRRrDNIEjyJebTzAb75mc2zA+4FMFHzRUdRUtUqSu8f07dJNfKxy/6NkgwkqPNZLhiE86pXuOJq7PEz+kOboO+66T3y5/SKwd9BXZYQb7fXyfNP8fCRYz03ql/8Yks9WQNh6f03O5hUT1408ufTVK3YTjkh9F0T7unT3/sGE74ae/BXP9uSnQNsX2od5Emp1UWdcs9IFlJ9BO08avyEBdcTvlW3WtZ9IQlFn4rDA/blxdsLlwdbKGUyd+a4p4B3qDTL9yKJQLqHYzKKjhVjqdao5UA5MiSSxP4jvQpZKuIQ8DRDTU2QkX4ihFt5Q2mh/pBFRUptuyEeAzQn0u8OXJogDuDGo02C17OoZuQAqiHsS/Mlo/wn58IkuWUMCTHuYqNfAN9OjoKC+NfA73jigj7YBd2qN+UE4ekslnVn+K0QXWV5OfGjSF6MBYBtnbpyczz0jU0+IxSLaFXbrw+lhDRDY+QGlH23m4gejtuRx+UQXO79ZYIOj/B+xz+K0RHO9uQBsf8PJL36EapQ9aEu5DRqEZtg6gpRVG9K9xyYJL5Pleki4WdBgtJhoAWEquaMxT5cu8Zw6TsFwGZy0RUMB4F5A2DS3rgDlbGjuh+V1tQySoqOBjy+q0k6HgkMZ/5Pc51kuExxvutozZFxJo5WJW8R5v5+07gzlNLHnHpDFdkI7EYxsgOreEDTJ77Yv16Rzj6Y/0l9aN55ZrfTrq8IPPlh7XZXlQ+SDeAHEoL3E1xLmNnRh8RMuxBS9TvYRUH6b6ayPFn01ZMUHYfDEKGEfEja4uiNCzyZU6g/Kw80aX+q3Tji0h0Np8HPQeeeWIvJx38SSG3thLiFq4JLCJ7pQ35kjHWglDDx8U+9RSwGWw5x/iqumdJSApAwGZTcjWh0cRTCgdUfPrI9iWKPOTA1F+LiwYiudSOOskn2XpSEqmllsMmivVdvafRsXHJT+zVFgPAYEFsCDZ2AnmgHOqX5cYKoT4axB/cJP6iRUr1F93wNIIQoTizx46L/XIHB4LKR/HjB24+Y05lET46bsgPQfBxlkGhPfjiJKCdxnXrxgKdPjCbuoNwwejyZepYA/IHhGubmccK9HpJD1L9GTvPZNpsR7ZPyF0KnVSMLNj2Cen6wAEDwGRp5V2LXxMFA81rEdGKtmcWgtF4jmgTPzshX/m0L3JXAgNEQ2pLhkp04OOXdJg/wDt8XOp4rfcDHrOMbB/VzOpv+vt7EYsZxMwpJAcXFgrNteJJrmbfLDw6cWlCJWu7+ysKHW9M/fjLxDGIIw10f+pPgP3bhJ+pJuCMUDPFybvxZac8PevTgUjtO5Qh43CQq3kiPcHTGzMlDiGGSDCfhfoBX/hKXITHHxCdtv9vZlQWjwouwx2XFkBrNnUqMTSH4hfwQAY/6HQkQsblK+Mp0eRhPpO/1ZrTc7gHcGAl72Y5F6stpLVU6Wh3bQn9sz393qRbBE2Gcd/3Ak8C6EItsU1jl7xYb/LLxgsqDvuPxRg5S91NSxumiJbXp4asJIRBFsAlZMiZ6aJCm3fGpO01bkeBKNX6SB+VU/ishpkaeXOpQuLURYihWDnCalzrSOS0Gpn24VyWKUWZvoe/uvospwZn4Vn5L/O9+urTAebS6LWUVnDuWIF5Cva6YjtkFb8hVvt51NKerCCp97mrzl+up/a4vkK1pKyiffpX+r9ALs9OJTb3NdtiAzOrKf+Y/TecDl1foJ55GHCWMghnMmd6A1wG6M/aVzvT060eRWzm8/9oFTdCbPRGkQKZ9BjqP/HdlU9C2A4JQdlewKLzZ4K7tlFuKZcKyz3mVH4OrK4uHqEyhsepCgf1ZzamSAGdR4izEY+ITUEJz/uo3ktearirG4NwvOSKwx7fUuJ0qCqltFDotHF4KTYAIgsBz1aO3SPgn3cC5ubdywsA14lQAWzlFQr3IsJ8Z8/nW9HwGZwkJMejyvbSxfC82GfZaEl4TzYn3rLuf38wuTxcbKekhzaLK+5dfScbASiJdRx7uY62Je62lWuif7EOi3Zr5e0ZAWHQMJUCdLjgBzjKGeD0ytmZnSSsy/Y032GeM37lCcaILI/COyjf6gGWKuDTTq315S/kAPWxSfw8IORtoSMz01ZTSXwwoP9bz4l8o5q1JcUKqbmJCCK2AvYP+qj4g9yx4Lgo2OmVbJHcaws+vNlBkGXgdeA/L80MjTP1PVfvICjgbW4lVyeUOGi5BnGpGOMD1Htnj9tGWz73yHAaYwSZQ39HU3ANyz9reM1xjCdaGWBYQBnOo6+rGf3MuBTMTAqzQz/mi7nVn2zieK8D/08DDlvdqPt0IEZYPAUPN/1461AP4V1RQmg822/Ek8QxnuQqMBUbQPRVviwydQtPW+Y9QlfGk81HY6Q91fSIIj9PVqcpoGGgcTKkdKfc53T3o4mveWwkc4JJbIYWlSRBvZaO8GwQnjxHyvkAny2oo5z0flce0RfcsLrM+3KJO1L+urXGZdubut9uRn73+vB60aILdB/tmcpX2eIFmmHcPyw0RLlEhIpewuLKcQ/IGaEhnqD3MvnQkQNMwsMRAOXB38GjtycQ2Z7eN9Y/qAJVqGLszI25M9SOlII1wDFUmUIQj7h94/9XSJ46rkgXHJOceqc/4khwEq2CqXiktPYlfXmiCiUaa4YfoBZNLYaKksuFQ5fdEd3Zuqhs/XK1gvfAOH3obNMk/hapKPxkwsI6qqpJKJj1Deif8LE3RY4Q2+9+tpM1C/Vv0dtlL1Kl0BX6sc+hcweW//7i/FowGJLDnKMEDn5QTkASpK7R7AIsAQF8x6csQdIY1FaxXgRGqNSr9xB3cPHAe+zQryTYSXIAdhtrbL2KsA5otFusQWDmooff2xFjCIqLOtmNabSPUmxlmA39mpt4IWyL73TkfvUok3k7226rjhCvBHZ5LMF5Wmnw3Cj7wERwxV9gdTZUwL+GRPAB0hmueLpBGFcyMmAEkFnlM/tVd37jOU1pJ/OnQZUa1S5NxSkyTyTqIE8JdfAn/QwgUG9XOj46Jei+wr5dJCVwplVBqH7tEnT6PUR+lC5Jac6sKGM+n+KimeL8GoZHsPHuDjdSlglFlF5QK1B3Lnx5ccqedOjd4U3OBqLga72Or8BBjMvnwC8zJ/e5WHgwzeVsENx0sU76DlotEY9hALxI0eG01Y32714JpTNBlY8t52F4hQZ4f413WuIj8A9KV/6Cv67qukKM+Lgt7E1fJPzKOwrf4koNLNu3GEB6eY+RDHpwZWKjkZOnGBiPYlIoErsd7v0TE/P6IkGGT4e9boyeOGMl+8bobUrYkKa9wzqmCivsFu7m4w66H4bGzdCu7gGLJHMT1ZoMm4JTrx7nXoyZIxtvi/oSoRmuW4FLKChEt0+U/8ZkB/qRUtM3QCS1hUel1iIazFm5/NtfqAakzN7gq/AUFr3WhdRZdlWgst9l2mWwg1mRK7aWgfns+gHAjqB5NvpSkFP9oz8FZWuXOgasVQ8xX0mtV/6DAJRvzth2DBLabJKVNymUsHNX9mHc95nB8duzs/tWqv0vBHvgbnF3I3gjy9jJqMYlONrK+1K+bl+Fqj2AFyEv4O8C3nuTmqZa8EmAKtyeIxndE1ufiFU+YSGjFIiNP++yMqRasYBpVvbmb9oi6MDwwu1rhqngXoeYsGbpH3OUxPUMUl5KRHVMrapFDn39M4+Nns0UpyIIvTrz/3N0SkSzF2k2agrIDUyJipn6vaMvy4BGIb4tHr7TdEme8iLc6AxkEf7wU5ff1YDEr11wWAS6Q2cqUVanwQ9wW/D8ouQ6g9nttjG5EuJwhHwyhV/IU5hVJe9RZ0Rygv/Kubwk3wfeZse8jOIFVCM8LoDuREYidz4vjkHEEAOqqlEu3noFDaqj/qxMsD9GQM/a5yK/sinQdXqkZf0+2hneBS9a8PD8TR3KsXJ+4Xf4c740D79A7p2FTnn2p9Lu3XVE/BSbvEJLfUw45YgLq+EbfLCoR1cuQ0KABStZaVk8DGCsERaYbkA9ZrRIXgbP+oQTzMyS437KXR7EVcJMekRQk6X5/A0NAnc7ZValvLXKWD5nUAEnZ2F49JaQLL7uOA3F7kxCIcl1jDoUqUpGrHw9LgLaYt5GbcK1nYLTethODYwhfBTjVQMlXLUV0pa4pFpvkaTH+PHE/+Ylw5UHwqkhgtCt8rxeJHMui13yIZ6lipkZgLOdyyUSi8jAuokJXfS66IUi9QOSoAz6mQnHrLuiMQkSZ9djXimiKcOH0DEE82j3c+1YLhfn/GNNSnoyg/lVVgfQegX/AdXEvT1P9tuPf0leiLK3bZ4M77Ak4fnctA5eHkZnR/mHJquiXqQZW56oDQxrsko4gQqpnfUXoTOoFnIcNuWaqVuCpc3kfVhQvOsbS2r50/gJvLlTXw3iRBAM9TqeJ8GxkRxLdewccvAoQC3o4ErKFW4bCVbQDSgZ18J73K5C1XxyshsYTIjsmSCOWyv76vyWENb2PRfL6BPERYq0SzINNLrf4eVIoM8UhtDQr6/MDaSxZZfrP9VmsS2CwiiWrN0GNjwqPVdSloKXtAMobYPYxyAVy5YrmFAdMw+c2tKP61jn4ZeMtAiqokltf9D9KdGdVbY+81qQUK7OHeQrHIHf4lxJPL7TPAhm0WyIUkBeZbmmrOXY9sxEz/JVNDvU25KiYXw5bAAWmFi73QgHoyru2ddLMpiz3/yMkBO5xMa9O692bRYVci/iyR8RtjTQZd5ajP0kzhpfRprObXsBPT/5WmSqhpXy5cUlVp69gdpwHqj1XMX1O0Tkc3dwatsX6z+oMcbUTE5mR5KZ/PbKNKaXCclOaYWDS7n40LQXrwXJ8tn/vc1+yX4MNyda+3Q/g8bQWoGQpg+YN/hTAlEtya8li0ESBqvORQsoCNCWvhnyjqypDp8VwrCyR9vzYJPwpA916/Mt3z8ZHXdd95QN6euE07cku0D8VJ8RkXui0g0HBkXILmMiZKrFKBrsSOgOEGregz7qeQobtAe/uSRZA4FdQRdf9bz/rst2YyFzCbcH3y4+FWbe8H7F6I1Rtg2MTCsQXDA9OLaC9F5EvdxTOeapgi9rcmBd8IluwXIywlB2IW6xJE8V7uJGUh2BTO234KMVc/bnlsfAJ0S4evjLffUtYt+oWL9II14t05FFuZgZBHvIFa/1hGRoYXZbdEJ7RLrDAtkMClnLcOfADz2Dsy2G1KjrPuCVEhwg6fS9ReRGa3b2862NY6k1t2bllnN/mehAKA4F+8nFhGISQl4x7lD2ygVB4reKxjUHSB3JeP3mgMhQu3SI1tEhssWFac3UVzj0v9GuYPRiPIS6b6G7cO/OU8tZzWZywWYMAtIlvabK/OZkGq8FG1JMPAwki9HpvMYFM0LOo9eo9BG7SJg7R3S83hZecWo6I3KFLRwT31in0YiEo45ilYI2lBpkFuj1XcLFaYjqw2NK8LCMrSv0qqS+E2c8ihne8j5/YY3zn9wiCQhoDr3p3QmzMsb2Qvy6Ecfiqn42UsMkqp6D26vNIIAzHkptL0zJUe5h5+O6JhzbnzRr8J4pb3UBRKFprYrNrmP6UCHjIXREj1kafTQOSmqbSSGJnhbtTtjdws2H6/UeNWwbQMyppxrBzNJ1NbaOF3k4U1U/by3hs+fMV9ygq/iC/6ygKMpXsOZUkdv9Y/mNhiXnx3HX7CFsR0JwqGSC8ilrYR3jXB352ZT/+GjsP9AtlUFzxd61NrenHkEhPSrOQq8ZlTk8+WW7uYLZZK8JIAL6u/7ASmZa/cT9XyXVZCNccwOGdeyN8/7WqoFHrHQgJfCMWv9gTlSaVCP2LOECuGI08WW7FEP3OrVKlOUwxn5bic/UScvvQNGKVtQgtxkRcJ/IqoxdI/S49pDSu7uDfluVt3KttlbSHYrgcaHPAypxuvlQTqySDHQF8pmbIt7YDWatWsY48vlmfy2kdkgyCN60TKKl4NKn/KEMfd0112GbJAOeQj0kg9kIQRy9vCWfyD6Wrg32G9bFBxbMltxOTnsa8UFTiK4qt10EtBwbW1LdEXJrIxM7IwUzFzm8pxjhBrq5djvuI4AvN9X0vKL6MXWBsxUm0A7DCsLWADasJKzMyNnG2MFFYHiej03a9r/t7dZYjxIvh+oAQmaH0zfEmgsAz03992HbS5VHij7p4DwMd2yLyfjPNpipFk6jDXPIj7v1On7SHOzBzybF4XpCEPYl93HlC8Q/gDRrlHzK/6npW1ESxNdjeaZPLfvJ5vLJK8azUieTbjc0/z9Qclt2z3oy7XhaDLUXGhEVnDQqNu24WqRoHPT1wqRpL1L8sudIHHcvrXLXmjVLJNr2tn1nd3oEyVoyQFCvtRyz8rtOeRFvMtJgARkewxOBgsvM8IVLwEX1U+fYpJ9MjC7Rb5eyH93HWWxACKSzBK6GpuAGQEKF0jirn3v1gxHZLkmwg/8PxTtHfy0Z+dig/x4EuRJ/YiXe4jspJrFDDydowY0PPhp/SmwiBQtqzn8Pjgfv74jn5GfkS7eIOEdi9kDTML9h0lEEbKvbu65jWgNE4itUzPAe/JuCA3JDY2ncdBi9pQb3hf1CzuvcSiNSXVsTUEk0JyI7yOKFMRwbqGzNaeihttKfG+F5eLZZa+2xLenb00A3uFDuqqz8s0jnkvFGnfanrjBjB1KiN9TlnQ9MlDBSwa/hRRF6F/R1MkEUQnGRGMC1i1Utvt8cvv3vajI/LpFPhP55MABcGDn/7GWvOBenAbXPRiYYUtnY0fEvxPJ6Y0SOLAE6KkkqCbe+KuRuQuWvaDy19MJfVYwgeP0oZxz0P0XNan7ee+y97XEOJFV8RNBJzoDqqhnWWszsMqyLMwyLmWhZ0iB1/55Nsl7MZ0EHxU4QbuEZ2Yau/8natfhONn4xt0XcKKSd5tzYWbVM5vmum2noWmNcVfxsWQ9YUv8RC58kTba2EDi214wb/7FmY6N/LetMSbXNJbctATkLhVc7knqlgCa6MBQGgAsvI2dttwSezod8r8K8Xauns9QD5t69K51fGBJog6f5eHSURqzaIAT+RRao5j50UradON8uvH8d72zH+EBHySMU651hy1WULAhD6H8OY3Rc7UjRlhoyPf+DBeOaMsc9M4zo621fI6DSPSKMvrgDZB9IdrZlnIWmDtNTzwYtuXGKv5yz3WOmEWySy9wafD+B37eSu2iPuGZVK9ydi/3iPHWdOlNBtK6xabrT+b/afzNTgG35lZ9BCTvD+GYokjGHPRX0RUPQ4wmOr4W/ChU1r+elFz3uOX9/2t43Z55gjxnhEhqyX/BAfAqPb9ltudeFRYBiliglat70gyctXoDhhyEvzVm2xt1xpA3qRgc7iwjTy9TJf7V998gWWzxbulP3YwFeFk5S1M0qOt1Pji+9kIyNSJUYBT1jlwX7VXQhM12fE4XyqHf5IWej5+QF2RQxRufi7KRdkrLXVyjQ2H6SRhIozt1WroYfIrlNRVEYou7cUfdp/BlJrmMaRPHcYDwacgIfuBzuaBscEpXSuPOffQEXnrZHX+FYpEJKWfRTbRUPBiIM6fcUF0vEvjzppjzz/mFpYS2yFiLsFqYixBA58Khk0Aa7LyyO5MW8D4iea7EEhxvI9EhITr6FsnLo3HHvdOgWd9c3LHqQQx5wX/R8zNL5emRv3mOpHSXMOrrTumz+bgTXSOmvKHJfQ1UG265E0Y7YlxXS70z3DMT1OE6txcj8fybfdOZrfStVHf9AXEIWtYik3yVvfPCfiEeSigJnb48/7wU5jLTA3RrmHtu4P2whjssvNltidjxaqVkVeiu7s7aWGS/TQkacUcZnBo18lRu/z7fSXh7dwJfsAwQFnYYGLvL/MTX9YA1r3L80fUJ82iC8HGjfTK8/seL8msGMoCl+8XQs3mIT8jyBKe6V9ywWTOVfWS8rgCeCeAPR4Eg3LFLTowUgUk+s7epamPwD9GGJbzQd1t4pOp5c8K/5RFoLl9q851uZaQA8UD7SW2C/kIuz1HJSIrDIpy+nfkoMmrsjvPM7A6Nn/YCh/QyaWE0eFubQw5M3JSILURx+wpeO9pCtsQPZO2fGRSD3fp5oZbkXxU2VLqGUoYcUX+UwpPGbSggN3cskupv0JY1ndb/rkMjvW+XGx6wU4bbioGYd6i1/EV63/MkHWdlCA3GgB8tVbq1txcjKqzMRB9fLj/RbC/zQOkHWhehP5mPttTjlHvxMq1DhxfL+C/NrWZOhsYlWOkYRTl9bySOCvSuciaJa5EFl4iDvAb7h+tnbbrWgjVHXw5boILPunw2xlGDTRFlXE0v50Qhht2Ka2WisIFenQq+SQY5tG1PtAm+M/7oiyoC3nxUY88FwDa4yYigEL8Ipw2mWo7DQx7Uc/ftH2bYOdHemc+gXbQd28jY85wftq96f1a9E5paDjojm2jWtrsPLjVilkNR+kz0rrnl8vAJyCBVKrMoDYFXEQ2XwZgcV/Pb0YJQkvfydKHApIrOpsaBrTc0IRKhsPOFy+a4M315i9hpxt1ke05VWi6UUDdb9FcOW9sTsciV5e6dVG0pdJu+SpPgy1CqQ/f6huQnRTAG/7HpAoCisBtT5n+KFurFsveYJLMU7aIfNiykDg2m+IUDwmlPmowahyLaCYxibn5539Fq8eug/otOcgpyU2bABwYj4XO9Fl66LzzxL/bZa0f/1WmpWdaly+CLhu552h2FHq0LCnwOwgP+BxGILEO7qvpWr/uJq933SMa8ML+beN1LqvFMHmXKkqAMVpxkZwfGgERb8Tvq0J286S1JnhyDqEc9yUpyg+j4Dn7Nk7ICiv514tjpGUV9rx7E1inL+/mt4CpPCqnWhSK0H8kUdAtW995GUre2F3JxWTAQ4MrKv3rPSJ/wYR/pC8Ab4PP4Ohc8TDy5RGNJ7NKQp+mUr2wwReGAkJomHtH+MuMCgiD+TInEniPHEmUpBElk1g2WZsbVPpyR/fGzHpz8N/FL2jAD68H+PBtRNaDiEZICzDU8jVl4QG1yvqmrwIQjpa1pIwdHIdrY1wznEPqYQ8kCbWg1F2rouDuSShCAYSp3D9AQkxpTjkqo08ucfH/mV0O4lF3xyt434clcpNQSPLcItz4uThW2+jcRGcFq5dMTWXxgE1KjY0lKQCjyIq+WATZC1fg8Q1pmqoWJIMXNw5kVSF0c0VCVETN/BUOq8fwbYGC6Ngn+zLLokPwHC8qrLA8Y4RnA8n+z2YEuVcr2ydiUNrW47Wvi4Ck1US9S4v18irgdggB0/z0Jl7zhQCroVkF9OpSP59P8ije0/+0Cjg1EcH9eKcjjWaMjllgRSqRpuex4AEmqOL4ux/n/aMDzKCZtqFR65khMMnOXTkJZEv5dF9tC+qgDuf2B1u3ZoglDtEuUhHBe+ILuztngwIwaOzPJzg5iAdHe1UNqmLZEqNSNs0oia2DdxL77pW1xnuVlONNVMuUozOEvw5BUklhIxZTON+/wn1L+FcgA6jxdIfb6xR6Jj160gp31NSppWAYcZxu/W/W2Fb11KajEldWIOy921IU2HeR5UEukJ/Vhj+jxC1YPDcRM89e/A9Ulr2H7PnwqAUxFXlr2pJjbaiDgos8rO75nQWmbzoCmRgzv5ceWEb2KdAgqDzvWJJBNApVAWSf9BgE0hJZr9SdHavMzxcRbB1pkwRpWzm6e68+/qzDAOHO+IUN50ypOapgECucGlzDHRrivFoH8fQljqKkY8ZCQ3o8OsORn1+poJIgaIke3f8PNsWZ3M6Rz+f5DoYsLPgaw1W8t1ivDcMZZZjqCz1mFlxDKSuBAvB6BB9u4Q98JfVELkGX36JFbS9fEEbUTCxY0Y5O8Xe4ueS1TXe6MEHomHYPwgKOjJIN2hUrMdVLe+lo/NTUJHBCZ6r4OrjWZaBMzdxnOnIYLHQoW0zIE+EyG8vELFFbwXuc73y03zM8tfONrT8xRTTz142Np/rqBjvu3BlgVhUh8G7w9bWM+bQPM/4EPpoohRY5dLpWIPoYgy4lzsLNiKpDe9weuE7AWZwhgju843Rkd8XwGn8IZD7dQaQN3QZtNDL5eDckH9PO6Lcg6EXNCi/yRsyfk+OE8xU7uJtckjVImmCFQ9PK6X4mIiHQVdMgv1W4HGkk08uebOIaFItW8ZsnkW2kZMXCLVzeAqD1gIaQI4+tm10bactQMjt9bvbdGUv5L6plER29xKHM5k+z7Bb7zgaSAkIwAeFuxrRd17JUwLzcgLvd4IEMYNDncN8jWiryIDZ7xduHW0h8yswEFJ3QbU24dVebvJippzY7K6Xl7jP/nMYT3FLu+yufYZYulu12rqZUO+U8rCMhZpvKUrPZB8UB+slZfDlUY/RPGr0DY0eK67K0JX2Gefmny3wf8/OgO91Wfbak/qn49wv+bv8aMAu/wqRv/XxEpEoypDCGQ8H+6VAMtNJMwjv1/3woKWFt5UWnDhlB1RJJ+3x4ddBPCJmwN5hoChrGywHbi1yCjrEPNZuGlRe4ekOZu/hJVu06PuvHPcYtoXFl9cLWAzIgsad7fSk/CtmYwhUaS7tXNNdlu6YAoqq2U/C9yDM8iZOVUkvpeRSxX/OQ9Tr5ekG8ZHeacIPnS6gs5zdVcm22QAez8etYjzPsqjyfOOKGy9y08IyHcZgXs/k2BMaJD3RO4fzQWIIawLoMKlxhqAQgMYYXiL1AupvkxOic+Fgxdl5xnp5sQrkDIMOXOFv/wLzWxrAIcTLtSvnCHsjbGQy3pk9X5jjwE320nfVnbjUJP8TuUUoxGeJE7BDtbMgxC4t+aj/vbk4ksXeLpeXQp0HHwdXptLhgYhMOu2QTTvGoB37b7ayaiuPRm03Gx0T/ZFudNd2OmaNWaN5caQOgWTXk5OWzpC+dYBk77mkFzIazhxhOQYU8G3KI82e/lk0xuf6pXgglBeKOAXwtRCCVxDazHDdjSSlghVI0D3mlX3JrGTJQrjHkxsoJO8Gmb8b3Z1Bn+NdXkXI+dO1pSPIivOalFRzUMxcq4B5Nsei+4mhkuqrtBj2wHhr5PeLfE+EP88ukVziG75trLIhQbNmGJmjVLBYlytMwWNBC047IG4FTEYifDLM0cSx5uDPTuvjI3fMJ5l6e7A+biHiGiDlxrIAieJ9u01mgo705Wg3VpM7VC+BfiDRLzWnMUqRmGJjozLGVZ3LIsrASRWE8lgf2IQPkNYbozEgGenekKFfefsBuR6y3ncSR6/0OliedsJSgBsWMIsx4KZq2d5rX/CePatbvjsF6T2Bi0aO9GSglU1DTug1RnqCXiHWT7FHJH1uvi7V6LcxNRmjQycpQ5ZCmDqMqK5CDTy2pf0S3nDMDxtNPSy8pW21DoPA37XUFuAni9MAcOC/Eg0iwnvG7Od70x2ffkXYtrjjoytG6/16gnC7RF3+eQSGhQ8MbxwRK5NcRNCIbYauxfcE2hUxfVRVgztMx1UwGdxxorEqIZfdAKz8FanQvsRq/bS3m0Hn0c1oqWbyN2lC2bwLcDW4CwDpSHsJtA6WspIKfI6jYfz8tAkuuqMUOzOhop+CDS381V5qNQBhV8GLrNcqUl1aqvV6lEts+IQ6ZaY8LO7BjhKyE9XIlmoC4v5e/TOM+eVtNBXrzjgrQ8m6WU20se4h5ocmNJ9JI6wu2tai3t453+l1dzU8qN9aqda6cKtzQ4Wd+AR+SzNwwsABtCLYx/srHDxp+t+8Hn+wKzeRViYIoi0ZERDyieBsqnGRMMWc67qt8T0k3IkLCfMg+wmVxzradMMjgZ8I51v9JbCuowlyrD9ptUdl/1/cW6/gASF/o+47hPzft5NF3EzCsP+uqvp3xzwGOjIL/YZ68R96jjWmJrB8sk53+/QNLa1mXo6Ub3zzrtolRvGZZu75ynpH6J35UTYIOHmKwITxIO5c5/KaxJJwoq0bnOJQ5p97SFwtmdaNpmsB695ptjnettd9uKhXXbIF8XnkGxQg73t7j27/uIkDzylLWbGf1c/YMcHbUCKokFqGIC3pACdhp32FZx9ZVOK10vVR23lcw9cqRuBLqdFD1nJe6yTyTepWoWIvs7NZ7G1IJY25zkQQnXBTCTih/4MJ+A4Ek8GHI9YziZudRKDHvXB6dwSQC2rnGI4ymGc+T2ymQX92HqaedeYM6S3e3Us1pAL0PlGC3UeJxdbdNhdvUy/zSKO39Frx8uippER9fvT+rBXkTnYApLVyeTgThIUP+FS8zgllFnfvCKzMZfjUX4ys40kzaEmEjGB2QlS9ZFq0qn8HZDjCVyhnmFuqGFpqVi5BIGaVFeq7bYEqnWtl67Fz+stwWjTLEj55dYDbB+UwzZ8p9HAa/IFy0t3pA8ATW7QRvPGQpBHe7zgSKqej2yF9CIbpUUa4e5SZ8Nmuioehk/2i6bR5UrZ5S5mzEHhJYSCoNhFR43whjNvhMUmGZV/uHEiIMdXXQEZgTv0aK6pN4Mj/s928BzwrR3106op6rNRGe45XY72uPMdUVGjhaOxP8gL3uI+XejmKaPeqL8+4iNyrPlDD+I//JC5QFihy8ucBZpigiVsPE9SI66kdFmZpaw1XAqZ0HFYYYkKPgc5PL1wd5OepxSV0VXG5py/Eo8HmqRYekaKxrvyMIutFBoZND6WOefW0kl/E87x8z9IRCpO+2x+RePCxBKGboBy8yWWTn5lCJEezpE8MFaq+qPdjM4Nu8iGz/HfMRMAAoO5F1QcjG1bQ3WZ2jnttNdto2iJf/QNUFhqwBKrYdXOZ9ct91lox52T12ZdQWw8W3XwIUpLiTrs/blui1yZ7/TcPGDHTxizmesgGxYecrvpF7Qv0ElYUlJwGAbUnj7oQgQjPGeuOHoo+uZNA1IF2Xu1GwHhOyo4LprG9HHz7Ix368iuZz1mDvKnE79kOvfs98M7rOM32D1sf4fA4Nj9rdeDdT4I5Ip/K04FPLEOI4pGrV0f2Bux1TyUd6lkPL0rwPbIcWzaSaPUhQxDnR8meCqZ85fRi1RZZ0/VkaWAPUJaDqFz1L8ZllP/Mp1upj+vMwWnxytzfb1aTtLaYVfVdB6oEh8v4LSbC/ysSHkgUmCm/emR7n7rMuDxV9nceNwhB8ueP/qsOxGLl+EitMdPpOQOmYTmnZe0xGv7wPvYah28hRbLsebuZnSecjLt6Kll30Mvr80itYzrUreX9DuE4zK4CyD+W38FkBvKlP11oCVjhe/mbD6ZaDvmzgDSPAeijzTj4rNArNXUERWtrdXTyXUuNEQSKcnDr2SNyF7sat7VHyUlhHayCSDBxXs3a7yTs99u8jiM3b2sYguOiZt1RDaKYvJEm/ozH02bzwtHQZE05Ue9ZiuD6BdvTd1tFjtuIz2OV1fYM5jmVq0XZEgzLZyc8p1T29DX4WoBDFUCsWbkb9kQ7SWMyxxOu8nq4i/DvPQLMMJd6A/I8r8yUcC7dSHEXLgdN+NpwHDKUwYqw1XzGrQNCxeQJUO9Y6sDzEgLLyWlWVWyggzhPOkmSoyhIUEq7ZdtRv7KMb/Bi7uAU+7pLf07nezVTwYWD0HAvZPx2V+npPSWjsVH2ylCcOGDyLTzJMG97XNnvOdvWGqDIMWoAtXoJ3jbLuhLcnXb5SZVcQgui1njWp9NV9+s85kD1ldNL+sYr7n6h6ViqIDZ+TEAD9JI87/uN+Gr/H3/mOf/qozSnvtGspoKInhkokd3XbkdTiRG9kblEbABvlfMc/1W7PPHmFmXcz3CarS+2b044mDt1n/r/zLJcQFtrGdlOLw6T2zvEFM3Ga7g7B3DhZrx1MptOJkIGbsNPcpWS+CrMN5ygNeAd7vIjCDt0E2JdcP8Pl41xuLv9xx5GewoTmA/YvkbCtkqYXJAANV2VN0fVH2EMy/0x0kA/I5yCupALbVkz7Y94uqkOuKHX9FhyaupsqSzQrAc2aaniWVwNYgJzTr6K7iG8WthX9EhtyeWSJJvnNqNUYvkcAIQ5NkhzRrFd0T3ys89Ez+/4JbuIad3m+xWdwKiWoU1ohBpYzUiEEVgMQ0wGVN25+FDPdIeMYKKzkDOdZ8uo71nCY6qeJaEEklZAqDDZsnitts05EEd4S9FPurh6BH6gBHjaKsO33DpmECt2UoEARTdI3q4VbmQnDNvChEGPlO45658gHlr1lcr2OQNwaW5ck+l28Sxo5oMOlkXoxU/KotivVPCr3pkRxGf6WtpNucqgfHLapij+mrqEf1lUD1yDc2+d99nCujGvFrLhSMVPaxjTvTlShX8sXNAl0rGiPR+UK3ZeTAtHZClPxJViOFYwK+n6b32xIx2HUvD2J3ZUnc/LaUYksxPIxZsM2xEIPqZwDhcy+YUEetevnJ8HlCTMs4EBqqhkqEUL0ResJTd71+6EjZtmNirmo7r3qSRvVMIpXzcM+coD1OwXtfr4k8DTCgBsnThb3mb+0V/LWfpxr0f8gIPbX7n81tXedfe+3L/6iW52CHTNcfZRaO2YRHLDcRiJdddUbwOkyoDoZ/g/6JrNp0y6rxIPWVxmYFPsHRlWh6SDdSlU6dVFWLl/CEyydV1r+NFsGjNhNSrKgDka2Q/IYErlcVYoR+aC216cf1/1h6hiYh3t8Z/LKbn/6dgg39IcQLEfK7tcMAd+TBsY1nC4eHnehfprZ6fYO+JeSrbaRz8NclzKdSipafOHC/8knY/K1od8nMhBPgOHQF2nJkb8mFaMPpsc6lEZktTdQFHxwV+zqcocSEGVagnq8A8y0lX8KUjcazKSQSzN4VtpqGlF7vhIyssHyZzp/xUUdAWZgRS/5Qd2OAp0MxbjmP+d80/XugITmAj1Ln2WgHKkH6Lcn7Nx9WrEOxekz7N4N65VXYm0OQD3BG7BpNxsBgQtTOAzZKJ7C0O5mnvsj15FlS1kQaWyk0dQdC/ha0pLab23iAE/JM3xIzCRTMzSJw43pFGp3BD3bocMAZZUzsGJGEdcMf7C92KbB8IsnO8/h6+wA8kwF781fC4fEOU1ZKlBFJssPSYTIYiaHEVf6785e7xclCtQO/n79D7sDOmj/QxfaSgqb/dxaIww+0a0m2YmhUveqNHUKQ7LsNTpnEiBkMFB0hU51t9JNtS/zB1JtxNCUXYlUmgM66df+VQb0QG9FGe0FRQfNqBXQDEnU3feY4Y/5tw7FGR4TA1B8BV3n1s1JIIG6t5w2giQ+V2e71x//UF9w4MsaEdczThoCS2SLV4CgKFHDFTS98EO40hzuYN8GKVc35wvfr/wpY0Oql4+GVxzGN+o8U4Fryb7DlGCsKFDvfpUdiEFAAB6q9C9ptWx7A6E8hG+BICap7A4Zchfj/nGdR6nSbke3dB8EDBDvrCSeLlXm2WjEIuN9yraGEFytHSSHcDPrpnNjU0h5tZUfpmnV6OQjf52ADtEHnuQlqp1p/rP1fFsPO2YY7RkCoC9NEJpdSdr3kFswiLat+ck+hsRu2hCinRCG/ojm/Ub48s8RZ5yJaPbvUMXM9nvEwIDIIbdbX2MOryC9nsDzOHGhHRR699CdVCVIQPn0S6ESlx3xeY8bmPe3MmG+Pn8xhCQ5RKV9JD7fhwRLFQBygNgSMUqtFFyrirmF+NNayNjDtRXW84G0HtBSIDsIs5frbFUyIXleA4MHGktizXDVCXUwJ5qI+L+DBPB2nsZAiwHrJJsKFNn4MN+tNASSfnFux5hhNuBnCPQXIzoTx+6SWkBOzJuvpW5yStuPoQXSVSRDGnKmOtD9JETaQLub4iY7TOXQ9DPh4wh1ZEFGDaoAg2y4UKf96AFHJotmdXtz+er2Q24j3KjQFCpy32E1xyIfDUSg9Ec0J8l+2UQe7iOjVhFG/ttCkNVPpWMIxmv7oVgmnDEKv3UDv1KhR4RR+m89Yl7twufyNmB/h4dpDgYQZEl9brwwG0985zZDp152vU3+eGN9CXWW7stynMswyArRpymIfwdYpq9r0+/q1ZpVP5PDBv/hXY6DU8zzOoohEHrUclOVhtV3Kvv9TPuR0DZsmn7iEjBL+ugWymvIjVrG9MUHQ5toIJ8XqKNCmfvHPSTWERivwy34qYZYgYIGx3/zuX1IjNGgTY1eBE1HfSkmHKsQp3zW0MeD+/jXKxMa6JvcpWO7ZJOLTFgxly5OL0bEnudzADJarhqlmZwCuJBM0aizpHLiMOczCjtiDc16KFr2E9QBTnOpVm96Z5FJyT5n9gfiGlZPUlG9s/it0nxVlRR+ETpskbLI2LfSArNEeCkv+bhaS8SIzzBFG1Y5m4cLTH7uAHtrocxl4d0LarizI0NdcIWKA4YUzA2VC0aOMZUlxiPfX8wGHSFCD7s51lM39DSGB3pCvWdRlrHt74FpuTuNxpSaAVNTUjAkRSWgz2yiQRQtLcTzKXhE3vsGKbIxXySEAfxggHhCycU89weWByo3izkNBNjo3BuNvtdktzda8K06qd9CeL9HNNuxEPoHZdZGh9SZw7l16oQD1rWplxAzvB+UwF7fzzMX+YQ7Tle1nCb1P8373y0ME8YoGWT4ddPMn9vSrvjzns2y/SewEi5zOfBJxfqKWVnwmFyvwhzF8aa9QPU3VKDzcHtwmrMNIlwrIPLo6VHba2eaMouVh7/ybL9wRpNCamCTT6OSlib01qmoFLusV1R3iuGuW5Sa/wC8iYblI8h3NJ6mTISj8X8bHjzIcXl9T0RUVgWIVazKrPDqlz2wLR6PgZ9S1rYhfm4yESGYfDveJ1IUnePoOiquHGphU0wRehTF2OiDIL5BzUpM8mhZDFFASse3g0A1kJm6kOi5GvHSKcaH2VOVsV6ZomgkSZb7cvn0Osn54ZS6bAi90g/wxKxr6vD1zyQ9hsSVC2xSXqtCqub2s88JDSwnL83ia1GaM1Jvbo7QBWIIJ5MS+9kX+f4NvoOCxKrgoR+qsfnvr9OQWhsyJPbx5D0zzbiFTTP5NtD5P5ls7qy+1ziqnI6HUmRJLGYN6JkFwkZcWw3KCAnXrth2zcG+VIg13XJp4moFZgKAokicwSH8TnspRrlGUzopMKuhLzlw7QM3osoT0XbLfs+KXiv+u8nVV/70yfxuy3oA0U9YJg+sNkaO63WdW5JwjBs3Ffyfq685gSYKyCGKFgxZMpLYy8ovsBVcdTBWK5O3Ui2FSi9ZGc/RT4dCisZFvqeLfBK9VfHqRoG9NhHlYl+Iv6cgDj3wYJCf29nT9RztNMiC67/89AYCEC240YKffOTHzJaC8zrNE2lGAOsWfA5vidstxaNxgGU7W7CJAJLCcMYL7l3N30ScloyEWSfRwYB/p7q5FvBYKg168koSNPosIYM5VOjfQRLL/pCs6KFLlSSx9/5zA9G+JyyI1RkAUQ4k13KC4eZHEvFlVYkK4OVNslBHkdCcjjDZ55dkK+72RIpJODL326/PEx4PwbYGF6VMBduHVGr7ATlnwhd6UepJJiLZLjIZY69W8i3juT+bt8ROAt6iYtcQe5BrZDPUGZ1eFXtmiA6eO1QtErjIhEPbNXvVYf/bIL2eQmY/lo02k18E95lVlDWgkWWH+DrE+JmWvlU5d7lOzN4nJn6CWwcbD7TRHb8f4PG8o3EdMjAVrNybSMHOBpK3XkUhPrWZNJhq/YPaExq11GHLD7A12uphx7oNFRDr6dDFG6FW/fx7QyVx50Z/aOCmpatD2b0NSGczJXq59CHEM8XSc3z7H6ryVSwUPydL8ODGGSyeEeFR4+QKYTE6E0LGyc5bfTJ/FX8y98NBGi/wGLierDFmvHmnw6htxqIHADX5dQuSgI2TOc0XIlDZT6oe0ebWnpZVXDG7Jsvt50WUtBDvfkYzirclBk+qFtxSAxKtLbms/EJHWxTcU+PYrXoFC5ZM1VHBwrrmaKzDUmTOfWsq8PGO8nhAbIYTbWXlCi/28TA0ytYRh58/uyKTOvFnokgH3D4eZx8gX9Y4KIaewE9Pp2hiToQyajDTu5XITSr29oz6hIGSlMP3cOq/BC4STGXRfTuE5d8OGt9QaJQijirrXEsHcBeg7N4d3CxrfadEgb5650ivNJAhhq//u2riVXZegSdNXXTB7xJkLfUN6vDVnH19KeHbUETDDnEF4dTlH769WB01UndMQRv8dQw92NLzES9udwfQtfMCQIAZwwNjZpnRrjB++uWKlVru+PYEnsVoeMmcDY2XBv0u+QmhoQLA3f2vGoKHAXeA86H6R1/5d3LDAjgoryR4THFfOY7DgWTldGuBdy4yW42M3MIpIUI5EKhsi9Qn58m8aLRuMDzMKhtNcoCWfcj3VMte3OvVQ47dIa2Rjlu5o+be4I+iNbD/0y8a3dQiZxfQvEqvmvOapQYKdu1MeFxVaqtBhxde67VMsl6pj3uxz/bVO3qVue583WkOXr4abmXkV0w3vZXPrZddYq+j9q36yhJGWeGX9VPZtqsBL5uHoHypDgX5QC2Pbyu1zo/QzhdDxs5Qpa+xlWJzE8pWBkTMClqX/qDfQ1A0IIEZ9QajqnND8S7Wnb1CyvfswWn10Tsi7ugC6iJSU3zCOEKSRvWh057v4C7VFllQ8xuY1BWOCtTrJCzvAGE2vDt9vOlclu9jJvDRtqORf3EhH/WI5sM1rjUSdylazKMdD6bMX7HJ/RApd9Enq5R5gS6nmZIaDAIoJBgd3Y7VCWZURYhxM3kEvnPMAgYkEIck5EufMOFCencgJ1ua8rBLTSeXWhQdh6MVkCVociagPWj2aMfAlbONpkRf6R35sILUyrWcegUeyN6aFwCTXj7Ld5hut5hofkAAKSTrlohCYe3xTksxHG0CA9S00nXOrC9i0DD73AAO9mNl9itFkT+Hi5s+1kUmtulR1g+/OxTqvoAG6+4MDRz4m+8Smwt/Q0Ov5jSSESi0+eHIkNuMUA7Vymku9lPztQhHgwWRXk4rlxFd3Jt8PKraMqEL0kP+XW7lWlya5ohAcPGCQJqjKJ4IpHXgWZuxdH4mGr70VG7IYnAoU0g13VuzU8TzEL7oSMEQwt+TsIw2UsNNxghqfBNKxnYucCzeXEYRKudDdZNq2etvxLlwlUEiwYWgVytNq6Z+IMrJ88XGt+OsfbU4VpZ+A1HzGJTYssICgiFJMuo5h0yiq0SLRvJpH3TmGok71azOKUTONv1W8BTT5soX9/zlcyawoxxQHn4e053Eeb5Nor3aUqjn1ceUyoA/mluSCh3L4H9D9P3zOcSvKmGTQPBdSGXE10h4txBqZMSsxZGQmr/xA9G0rDu47idO7vNLkmOavAsiUbscW3128PLMSyqE9/GVX34azOl/wG1q5qBIgf+WjTTRR5At13HLP3DdS8eb289VhZruuhGtvFRWbObyJsmGNHFmUxbpHBsFW4q3G5Ta8xZZ/nrptyEbvivQgFWYzGWC9NR8M3hofDQHsSvQRGEpw23iodiuObtmWGt0IHUPvKtCfBFkhEIs5gZ8HwHDVXZP06HC348XpESKwfIasNVADGr2J/fn6YaGx6yjEmq4snU+Xxp944S2Mzzpe9RmsBR4utolHygKlYUTcGOf0bEA8vQo4NgmG0P2zLcc6EBOuA9jpE6b1+ZdAH8ugMS4X1MaH+o70n3ev3MPfmsfihUsx9nWR+KL/feiDw18ta/8oe+XUsM0uba+Yu5Gmf/w381r+Awoe0BmnboVPsojtlkIKZQykOoluVjWFzPBoGWHdPDK1JicV7VY8tV0JYOofjPUVvseX4dGEsI+URVuTK8/NZDoMgctgy01u0qbG0BMFXP7aNnVjaw0FDg3G3Mh5BYJRpw/WXJzJX0xGuH/G5yxvSSW+MbMH/tHL0hNr1jcLGTUNR6HqJU9QjUM2/GM4J4EDHeLe8FscbFWsoCDJpcegI7BDEEX/0X4kotEk0ddQ/FYVB0qdQLB1FxHS4zfQuTWMj7rpuW5b93aqyljgpoU1y7E/4LqqJbFiHfpwyvQHtKaoLzX5rrwJ/cxLQ619EZVZYuukoCH7RwVTfk1uo8P3vIcqV4Wkm6tfImuQtowccz9kWN99t4+Nsz4JfuiQjjkbmz6svNv0nL4xz4QOl1yMuthQ7au99yvsDHbxxgF1+DgrqdQzWgMSENw88cAzt48/pA7P+UDZXag7cbfwOaGE7iGD5tM71RcjG05m9g6US1ZK8fHjr/IaeYz/bRL6iTjuivwYJTA1qeiV+jn/yuy+v1lPtdl7Y3TYXFb6TCMV/q1oXwZELKNCk1gvIg24EENfkPd5xZxmiBnHibVicPhOyTV9myso63LC7Tx38E0JfD3x1ZYVy9YhsPCzf6fDHLl9TkUh5nRxtz0/RD3NskKDdfiqNFUcIy9Lc0zcgl+cnMeyV0XlmMeILMpy1PvlNQsIbmraGxoPYtZdzjdauoiw5O/luA2iln+7N3Xuqs+mui8lw2I0cSs/lnREXv5OLDWvLYaEvA2nMqO4egvn0ptxLBWg3LGfAFQyI9S+A7unAcESb28HWYoedCYKqHsncJ6YMu4+T6+AP8faS+WUa4RJW5qot8qWMS5aSwEVasn/8kny6TwH+HbljwL6vw1lPhplM9At3g3UZz8ni4gySVHMQCBRyD+EmuMKyuyUuC602zRv/6Ty+XwUsBN9x4UF/qCgziDXdoit3OR2CjaKH/BP65NTbKgxLPjSDajf/3JK3/TCwFaJomxw26vrU/6eWP1sN37/zm3mmasDnb0QvU+vyCDnGENuwLjZqSTO26nDDsu1RycPoAHWOSFmG/aT/6QU22KYwPiLRemKhg/gNllq76OKo8h+QhAuvzrp/7DavF+E9cLmvAEpSDHfeRJ6EtILlFHLnn9sokMFZmXVQmswamMETdNQQuOwVIM78HSoYU5R+VRSNTG3E/zwhsp2mXsHoJsY9sDq9EKo+SwF7NkON//Sf71MRKFOkLz/fPyNdq/L+2z68yQm+Vi6NzzQKr/h+O57O0MaSyDPkFQMPHxocUrL0091kk/ArzPzTMGWKldkAHRId0/97+MLxC7Hhv0cXvhjqbyO+1QfRrenx6d8aOcvJ/9O5dO0ANvYLPCLFI7HMkHC1FpnADixPTdqE4jf9kJZGZd/IW3GGArme9UuS1clX61SekfcfPjCeBqj69nojBMwIinKVzA2/insl0cLc1rGJy5TQPnkrmbH0SE1CzamT9F38VLyj24bmczXfx9wPjK4/w7y/Ay226Ios0pxnu7W4OkBfrzhBFZNWssKQtvO2O/9kx4nWkF6JlDjPdtKmnVFz8r/lZ3nzb+KBegHHIGDumqk0HIvfZbKzJQDwDLCqnUyE7uiGqdvD5HTJgaNa8B6pFU12M7Nac00NtGLv4lSfrLuTqJCvYdlW7yLbqFYVqhodfWN557eqgSGJQEmg+gWsI+tGEofNT993cZ/PcnUiRsG2IfTRavXjkZS8P5TXVqv5jwaTmBvixSe3yNDmUDjJrHWZNODdxOp0Y++r2AGYKnXJ+as/JB2Uau7RUXT2fwpaJz4vhlxzzVPqE+58tsVpOKWGXaCPIdAAjz327USQa8R64zF9x+cTxXSQfuHO51Qjx1dqx77uXJB4vHWdcRzL1szljETHOmQvhn4Jh+Hjy/azPkXLqjyBGPQLlsY2RXX/P7DFBM7IKXtPekgBy8gyAP3PrLSsRI0s2QpavuFUH5oywKDL1mRUdBjgkmXs8gP3lC9skyfVcavBhwA9L/wiQoJ+xY47W+tWSmkE04URYFzP2b6ie9LP8fazQWuQz8ARUD9mA0NG2XMLAK39mhN0LwJkDrWEw5oCFZTIuHV7aJVKjE77OgrSl39aYJ+1SnUtCfjQuQ5izHDxvRrGzZsvDeqjmvPOToMo9kflE57eUK0VRZPizvuGGulphRWToZnlC9m2G7FR3PmMLQZXVErUZbjGduxEDhc7id54CdPUhGH9ZBXXThav1FrSnvh4LmOtafkCHk363wT9+aiuboHeMuSSczwIskwFGhFqIVsH8pGvPUeqLHr01WcZ8089I/oIg8z2HnCWnuK9/OluqfNOaxlQdgFimNmEdLWZHBvqjkNWfHRJN4NzQlV/5ejPGXthuNHjxJexA8FURsRNJ74S5/YVU0m1CO+i6G/tx16YwqpTr1/My9zyy2nC+22sxe+EAAtuGX065+dWqetrBXF2lbUwIP2e5O2tCGVgH+m+mU9T6KCFPBQl3dXesq4iPwtM9SxOveQt2ka07M40Npd25WjngUCfODnVVjo1Xs6DFSmve5fY3xdBV6tff8rbatRBcoYDgl3QCYiiMAAuvjIE2NRp2WHW3iIC34EtLUoWuevrmruU9xymuuH+/dkULjxHeYatfWwLYKzqbU3xBowdPsafAl5L8z4zMKRrG5KELdds8ed13AJEn5N7fhryVGqVC6yJ5EI0hCwGhTJoRqfEDtU9BVVBMektR7GuURUBDdp5HwoGIfogZbRHj7950HX9NCy07tN1f03wsZHLzW/S1CEAPV1w3f1sYGH56Np6szVDukzDHc5YK4nmCGraNsUEQN2G0ftk+5jKdmwEELlVlk1Mfd76Gs414X23Nn+87Qr2Pd259hPs0ZIwcKAT2TmF+TNBmWhtHE0bqzGTSC5ukOED8mAVRhZ3DDGBC2VZavrMsXykRcSuBVyz20Q6y21v6pjeEgAFrCkwqRDyBEkqgeRMgEC3+zEFFJvp6TWaXCbHCwKA2FCLrgvSV8Rs1Ayga+TMr0cArvlQvq74BNHIG4OOV8kblBiPCpXMZeZzA2vmfRFZ5QoHPwi2bshQiMyqYm4XcC/u5PQeiVEMbEzbHLBXd8dzSggvGEWsFmFPPioHfkLSghqpehnBqsetn3RWMRmv1vD70Jrkeb7muujwkyQgFbs1NNOH46Mpe+3peaHyzURRjlvq4p00snTUU8isxQw30uh+keU19HFtODsPiA4lp1P33Hx0ooPTpZUPAx32w1TFLZymwW50t4kVpp4jltkwQ4br1bg5R72CX/tgnSON2L1jrP2unLSoYbDv05xCMpWlE4d9iiaYMi26NMK4BBO009ME+e72tgm8G/qPeHb0VW+1VVbUKbdFyH/dfRIbSvbIrIaSdiUWcaLqHa7HULVIGjrpcvCpljq18LPh7M08/zAQ/4uttGRAE9D+eygUWbwFdkFzh2jMEihK+h7+0uQT90kuZfiwSTkBItjxT/AlKqj6NVVW48Eg3h5chw5zU8CM8ja9eWTMiHkSZspELQmH3n2Uy5mBIwCOo3x8wi25OSBg2wEXn0yMND+9SZlCD1dsSH+Jjf2iQSJQdOLdLqUoP4AwkzEYZTIquXIRHt2JNm1MTgd2eqNlTQ5fN5C8zd3zry1OT/ZKiNLRCyg+Sv4yiWTOavscxvsfbKBINVH7/AnTXLR69Nx+PQjBKyVMnFO1rdFVRDuKhgfA4r3/CDjObh7hB1WgSGia3Hh1rUp8NPETTjf62XO6ns3TviEOfjlN9QTkw0Kx7WByhj65jeBc2ibA+Kqy/SjF7qAc/Pm/+jhvZAqWgykmg86lYq9FNISrnsNnVDOyCsXrYYlP7wIJIBjXul22pXSmif5ssHTbpeaECvt3eodVYeRsv/8X+8zwmhYZ1F0pCAzO4DrkTA6TXKSRh72qRnNGaUS+CkT66xz+1TLRFb7fXhbI17IdR6tG1rqJMv53DjKOHzJt8n2c3iM9tEIr68ZPbuceYinF72KKX0tyc4lxFZZZ5DOlJ3KOJhu038sY88sQdJ8qom2CIvjPR9Uvi5fCglvVaKCmdrpX+MSxzDO9TVqGUV6PvGPXsJVJfjhVjxVXg498Wf9/bmEOi0vFubikV2kD2bMqK5BUlmn4hV/663/yMs4Qirx6YVA8adeNqahtb1gWWxbUgaMQg563PElIDTqxuXjYfQOd/Y+SRMt35dqmTMkNGyyVsU0m+iFecUjTpbGhWOmovHbjBLiOcdqHRME0e3gFXNzfEsRPhaDYzFxhecw/DLFIlvIOxAV1w4toUOirkhqy0b4OcvzH4/b0XkxwOIJV0vDfonZL8kU8aV/mIy7sh7PcJ7iRzCHrluRTeZTIBhAgVV8BIBsmXxXTe44mQDYnhiFQbMyp5F1+ce2mFKgFFw/fI3Qu7ZtVjhFMTLscXsGs1Va/ojdJN6LWQ9tCQkKGiClquJH6uSu2LK8u9i2JQ3eT7sq4/pGs6qLhbxWVmvAFWdSQ+Yys41TdXfd1BGioN0KlLKF+XNHmw83w5tanYkf94ZEf9dMzBW5PHqWL9kMOeqP/mi3ZaPeVH688Wwqs7550Ed/Rm78E+AtTzyfNYRnzIKM2qRvo6AtETzScJzBC3gm3NxoNhQLMCDXBJDkYptuym/CkcG0VGcaL0Ieu/cgBjIIdiIuY0H7qBTWV0xRgnPaKnr5qPTHrsO1aBXr0hFl/aoP8nD24WO/0UHyepgUu7JGKt3ksTmqwmkKTGVPVAPKMH/Iy/BntkV6WIHYyDjM6+Uzhfl0lGfAtWL5UkCqD/LAHokvjQFSAzIwFqsx9KY77EK7RPKasiB8Fy0uH1dOA0NK2HLXO5ZtJm2RRys3mbz8GrI6IBrKhDoubq0QbiMsbYpadVYqKlJCPB6tiW2ilh/nyH2u8rKVJ7POc1DUuUkx4NkLnTkvHPyxEWNNLY/SLXmPkloWyPLRmDaJMxvATfE++W18duARvJy9vxbgRBZznzjHcAO7hMnj8d0LbSZf5eGjQwcnn5I2KEZvtDEkkt65blzYSwBT7sNC60VjnskBnw6bmox3hUap22xbY3HTOWVhX805mrk/YnKDkPii4vSoXB/XH4F5xONoHURMle981Z2RqIxJuG5QjKtitiqmUUkkHHY/Kz9IhwUo+rItdx455wbKP9R3kP5oqTYguYLlgJyCCsxatqUvxdV8bfLVPKy3ePhZjCGair9PhWj7mw56apVtUPuxXRwb3wANABx5V/e8ll4tF+C208vLoYDt8J/g5VfRW8MHUadC/iNZCPOeo+WBWbAF3uBZxYcOvxXSaXuewoKRv0MroIDF3c7ohe2OO/PaBwOuKzVUoo0s6vuHtOYJto8m1q80+8D+qXoDRKAV+9wsVdY4JmcoQWWdCslzYGevEekMmx1Ivu5gQ9QzhMKb0JbTrTbEnOUfhA5QB/Hfu2sHAI2I0qxBoEI9hl2U2SybolWBKyK3BFHx48lz7aTnB9KP/nBsGnKVzGn7Mc23rl3/0AHGQWXztQ5gCpHUrsiw+NN3yqzvJFl6LWi8UUZNCk2kaIvY6eWPbXG/QW3xCoHP+qWIfpThHNbIpyax7fa5tpZScUNh5Ft5Gul5G7TmpnhU6Jj0nAotKAuA9pLEiYpCsQfMY9JG/SMxZ4rqJCbgtLSI9MbuM0opKeSEWK2tsqxaEZrWV/EKEp7Ju1tt7etdIQP671D0D4+IneMitkrn/GWoshR4FMwSAQp/RdDjZloSrDD8PFtHfKaoo4CUNIzJgUHi4pQQfFV6vY1UXxcrSWrDCuyv6S/aGx6VfKUwECOFKlcFPzRdeeQ/RrvA3F+ikQTyqFUDPxmFc+g4N8DuT3HpImNihGZZwW1KBYxbV1xqpFetlZc1+jKQDPenVk8p6Cd23CgCoIGmui9TZ89R3/gomPHrKE9QvHWZBlwjiweDO8/PDU81yjg7eTQfrxYvu0ZJZTrAKg8JE6EPCJXD0EJNqd97R+udxb2fbAY7Hp/xfdxqwe7r0hxlSD8pLK8KlqTHljVGqxyUyW/aGMJrJX9g7T9v9RP90FERQOhXiBeC+vVgPB43Lsiv3lEbFm53grfDSoCnkn2WMW5MX6otilrKYlE+u+lFXWsGb0L44dFOK9JzbnaTLIBFOoO2YgGG0rIqzN02XgAo5nu6a/yXto3fyVkNUDRQ+IU7bnnLKH4My6UFzWV/Q39347RcSoPMCfrZwCbU8Unb4LfYA/CtVy/sFOdMbsOUNkO2dR9ehmW3cBXDJhfEgV+nTTWWk5mk5QWxMivz6NeV3EUztP1QvQy6a5OUKtQB2lOqDTPgPu+ssGrbl4At9ZNoNwzM+lATqRz48GNrl4npu7hhd2mRDcwSEERfZtEY1U3RWAQ/qMQqgdRAFupo8C4vYE87szC00xkZjDU60JU6sIa6f+a/VYXJZN1vGDHWPn94oM1JT3bO9PFeG+39aFvkqo4x5rIBqxtedaIE38Js5noBau1Ao65PEJqhM1ZDHG3LjF4V/fuFiGEcMcDO35HRXumJ0QUW9Y9ifwMcFyzUKrVXaxSDvZthGrSRyrppyNRHHS9OAVMVTEOVDzlh6rgqXn2xXyq8xyPtggcGXkIKjlZiC4DSRM7EtSK7H4L9YQXjWbXmebXawONip8I5zDgHVT1U49o7sL72Q6PFylQLh+MxUQEb80uiRMZvUJos8qKe112yusk5il2XvtwpGs4OYG7kQI9QkLKPIOvyufPbpuZXd0cm9R+csVYunw6rbOAEa57SX8ls5dgMRjCAIxvjAIvas446pk9RrkrymWu5vH7has8vBssLaFCxmXy46ulJch8g64R0ctLgP4CARRUHm+aNybUaE/C3r0jD3r+aTLNA9qdHq61sC6efV00JSHe49odfSITf4Z3Xp+8bizA0sTwRCM4qgsBVVrJpuZhHiVUUe3XOVHh8BuYZVL1Zw7AiczVDAkxmscDDgqwBXbVa40Yt9TG8/+j1KV0m7Ngj0ADhuq2IrBsOdM+bWRjuX6GvU31kOvG+EsjZxaVSdII6uslKRbYWamcolowJyvxISrHWhve9xS6Bb07N6L7o8av/0yDXoUz2Tp/6qt3M2UINOoDpcrKgI1I6t/bir9MPznIFwCP2amPVz7EEGQrVlqzUX5gGXncLqRo3nRY2Ne8MhcJ7Ae00bnuVjZeproHs+Azaka1PUnC2wRdgzbgMsharIxsJfhMvbLJWCP1gVQRdUszU9iKKXtmjqKSfir/SsKL1Dcbi4lV/Nj6xD99JCGA2ji2vc/fqoPSxQHpthmc7i+/QRVYzDXG2GrMB1jc9vW33f85fPu5unb/VCyvxqrh+O2Qa7sBF28jAKLQmCUI5kVrjX+OfrQ++nSkh09QzPcMO85K9MMZDz/mrQ3U2jo1dK4eginZDb+Woi2DlpVCPM+WaeaTmpuaaj/p7vPlZtVeySOfvWvyH/PGePkO0hF9wESitDPEfXNic4Ykr+4iV2zQzcyx937xKLDAh/scao+QcSUxzIGwict7JOGNH8SrFE5zieXIB6BLckbuAMFDEeyMePk37aKEU2G3h2FgeuQV23wBcVG64dpd13pm5ehm51MDQk2XlsaAQBQS5dHQeCUVqsaqHlsX65KlVAbWc653ELdfMGAl75GZROTDlCpit4vLdGYtgWVcyXdc2367p8/JEOYUIMuwtgdmVTXDACRoo8eJXR/kJiOSXxbpt3jhMZ1gtkkYiETBYFjQb42t7xC1b2uoHi6FcuvItBehhC73Hs8GOf0hQxOAeJbY2CfY8+UTfV2UbXUojGeK2zPSKzhoLW5PfpjTURliOS/ljYXV22jGtB8pBs0Y0vKr3N4SgMJytWt6s83mYU3UAnTE5wiFvPsuxDSqig2/3BdKt8nB7WkM/o96JXGGaRoOtvaRGIKkKivJC++KN4cpt5Oxvf5CvvRpEJkyePYOjoQvjAOI2iGOAP98EHFsWZ/Ogbv6TaYgR9UFKtDiliT627TP6RKyn3k4i+5FZKzCIv/vFLNX8eSmEOJeKRh6XAagVST6eRWxi2I/VzwZcTANN2k5rkzSMQ55k4bC1WxLJhhT3k9opIKVCHHUsbm0VvGDYJ2I8Sjxu939dGF9ApAjEX0SRf/8kq4g23eb7n3jYSpox4KX6L5nW6b6mYPcB7XUwRtvRxuQeEeSUPVr8WIQT3PEPdUUq/8WlplfDD07q7YjWxqXjtHC43o5KLVbtKBgC+JIXUzRp8AXSWNocR7IMTwMCew6FRsrQVKCcYFrvH2EeyQ0tPdH5l/8eKn6FNnaAsSpFy+UB7FQUlm68QTI+D00+i+ZXRt//D3JJA0gEhar8W+IOTblX5AHBhkY9r61s7Ft/14rT7n07U7VZPpZLuMsnilQ/EG7ynbjKDDPlInVF8iw2AyCHcKSPUGM/PAZo4WyIIO9MhS7B9/VYENgLt+xRWKpYnX2Pc0BPA5xi4nJmBDoXqlDDQ7TU/RjTTCdAttPydjgx0W180pLVKs+thdGNx1TCKqScJUNA8Jny6JclZFWFxajh99XP/UjMCGj/wFuKpKo3JjrkZDonq85BZ4ZTbeYawlDROQU/qqsUZCz4gz7LkQtXFriT0FfxNIPYjxqHi3idDVJHCpca1BqRJx1paa4zhALY4fpYuFk7d47bAUARbwXQilzhmKK3pCcA0NMXq6nxkLr+eqAJfvOLJAnZE8Ku2fGBGWZWKDCKNuZlKVJ0ZkF3w/DFDUcGFqnZWQ/T+q7XfFaXqbblCbua8v1ch7YC5vIYNcDdJSHqz5LlaIEKUQPJKCk3RErTLC2C1mUyL1q7ZYH8+AuUyxOGKJ4JkPrRqGSxnVio07pQ4H/YFO6v4t7zCkpmAcA+FL2V2a1uce66wHUlt+aTwbFSggCCZwucitsgoR4R5fOOO2FfnsOI+GrkFGq00POzlvkh6kGN01Ansr87LJlT1l+V9rcb2aju7qc2GGcAi5P+wrpTKEk15ug3eBhQOFzvHuKCIQnduJcm3JyOOu1iqyY5BpH9FaFTdGY6ZETyWbVBwuEQDLE7kmEWS6yKQiTDHN+OF8bDKAepgLpo+wefeDCyau5me0DWGXjVyi9VImVteOmMja3dsg01DMBgf0K8veAnsRujst4neplmo0HfXvYSKsnBg8DMlB+7Rl0zEbmOeWuy4YmyGnZlR23Z8uzqSEVGMX0l4uP9vfLflzPEhYS65LI62N3aoTjZthdWQt8WYUDA/aADvGEoOiHDni9EEUqtpT9Umh9ahFh7pMhEIG33qkZjin8wcuQNWtQluJcSUpGtJm8nQCRsag1UihA1EHDsEDDSJL/ojY3nJl/ifp/V+XQi7iMXzzlPmB1zBY5/EkTufgO6goqjT7XXKTbU6gfnAP2y8lJ+5JJbgZAukraOliS5i+y2nCUjgP6dplrER/bf9mSdr76h5Ju2FZSgv/1xY8fIVQIayf2/VjT8+yTF8Etin3W1GVVK5r4WMeINLpugYlLo5/ITggp5AqSyvg6NE1g2/4gOoXjSR0JW9Ug5s0eqE/ibYjKm3bEdpEJml/rJ9JlMA59dqvPfi/lJR4XBcVrvT46MGZ46bUJJ/bTVCieWRFzygomok3V2bKXfB8oOoe02Ai3MegncNknEOzTA5aX7yAdkx6ha6+4Z5ZZFOuwwptLSekADyHwmop4k1BezaT1TdBD+0avdcIRfAHZpo4UzY9Qy4hu9oJl5alNg08aFLxXIzw5WiITW2XJOg3EaR5ZRTyP8lnBmUgAm1pwIJkMXXpuQ5hP1ZMo5zPQBnzXUQ2/anE0m2KLpE9MOIg0OxmnWClxpu0+q+Qphzv2zwwrHEergyjloRWaArqvg2JBzneKOBlbYHdEpFfUocloys2UeREWoFwLeH00AcNOU5QH9UZdeJ/kTT78HbgIhgi/dh+xu35CKa2uCJXUcGOrP5jGElag5CFuM42du1Wn7UcgjsAFTyyWVs72SjR4wQvu9TmsX6KdtOPI5RDJhMUBA0fxAhm8RaAMyE4Vv2pJM12SKW2fq4nP4ODRa4KUJEELgQOihPh8kTYyeILDibpKERFphzYj2eUSjIbK580hwayIzvOKGi0G177+UqrVcN18vuR5eVlA65VutO5bXsqCYRoosIULnIvk2zUpRFH/gf0WOoQwJb6kiGhyf1uhlfaXxoKTSnrCB7Z9i+tfy+r8X+g9pz/6Ol2O1adwS97AEHm6CAJPXBNIgkmxP1v1p4ygJ0pmHvAbqis+gIbeqzT3COVNFC+EPRd9Ol9e4MNqueodVMrjV339ymBYcDA4VyHkGplBnY4r5/HkNb0a0tIB6UIouW0QwR316gMXw8NaeH1Tn/yi3wHUgNkYvqW/VLxnPs6xsz+M30cwtYDXuRsnTnIvYAyw9Hq4yxLEoVokqLWHCMW09dJVU73RZyJ5Wvm/cIhkcoMhTz8UYAHI+8I+GB05tw5G3maajsAJ7GYyR2WQil/wXT+bYzBMPiF++pZrVIgrqrfsgKXuvhgKEYgc5wp8IK0/vmOV0Pr5d+hNo4tmHLc7r2NaHOU4vYT7DsWcAfA3De0Ewxk8OhhVSboLk5Qe4xqeHifGji80fd+yg9J+axm4HKauIkrfHS+LGB4IsJgDpP00ARKUPdlw2jFAdTmQvpBCzJG9DV6sdVUzZVNCn6Li3tUDzp703LWsjNuWDSQvbZyyVjAB8zPWkejsLQDueZpKLnJoJcvm3u7zVqgP3YqwRoJifiaAZ9eijUeDUj6eH+tZTVht5+uLwcTMQRIHnCMP0i0w0/C88k9I5nU4u0GF534JyOqx0+Ubipola74IT/kBrNmBfodBezCZFDzcWEPtjdUz+uNTEYQB9aqj4abuu7NKwnm14odwW0X2ZUG30CXBqUrvrYr03mC9Xn7rN69RGuOCwoGd8i9XhqfhxFP+alOZqSNJm04D7kVhP533qTijoETvy+edpQqQu4h9g5G54R8RYvG+cGF5CQgtWwV7+Ko5x5lCS6d7eJZnzxkP8dFoQ3ikIzxmQ6uzmGNLD8SJj0XXhQc5I4FTQoaePiK18r+g/FX88w/NcgedvkV6AMgIIZ+wLhJRgbMQWzWLFB5YqHz+X3ITIDVr0OBMaSJIK9MUahbUWdGJE9sY73EU4ufcI83z4lf8Ug3K8zaUXz0yiokzAFkGUmWYFIKrRCUGobFqkTllfYnfV4V7LilHeUjT1EO/CChV/F5wi6rKL//bzjsDW/6EIr2JR5EiH9YyXxjhIKXvevwlA0NBYd7cKzhVOSXURrgwvdeHmYsTVaEgycflfGE6o/uNdhrrl9wzK7q/KethsyToWuc2ldqtcJmwQ3phXlbt3FJ/KX+k6+5BtmgE1PJ2vhP1AhKOm7GIYtETc8Yxm8XUcIeO5alDPikFP/PtztR1ibBP7UgmgnFmnV1O8UBbIYLXBfo3bvoaKNW/HIwqpKyEz9YKACahPSuJDxrCxz6WjVkn2d5sa7i2y4MmjLTUUwXoZk/F3FXOP5JGTGUWDD5miawFhqN9+t+rWkfMNxHLKVw0BL1eA1aqMMDdzeBc/97sQC8lINy6oAAEGCPTsXgFmbg2IT/pQBqfvRFhDlvJaKGFYvRu885QpwBbJYg12pipjWHPjUvYphLHxdzdthCjITi4+rUZbd7L/i+aB4N+HctWbPRTefcdUvRvvTASm9VO8jRRlbTi3HmvGDq4gmLYBwta4IwCLAQarfMtzc9XuCJp5eV2UxQMRx8/ftEnPHDvfRo//y0jVZ/Tv4/cA67RMBs7XLPNPmbgeI9V6To/XO6nbv+Y0BZZ9sjPKDnQD93tvZk8Z2T0MHpFp4e9344ncIfOTCbWU+krGo5K8PTm0ayJTSgaAhH27U8tI3PO30szQTb8Uy62/jevWIvS/NPCHKTLSDXwmxuVl49E5ojZDNfB+OcvRr9ADhUO/7+ua3VqXvAvIqoOPKKbJUBz3zjHIdJijDlCwOO1gI3c4m9+j72SVvpR1AfSgZ1mA/DM5fE0S4sI4f6lqpP00kkPixi0u8udlqCg7dPH9Kh05ctuSJhIPo6OOBAMRfzfNIBL79zX+VYvq6rBCFN2Z5XHkjFtPTrn/NDKtSyWKNz/tSBt00JpE7TEg0fHYkk/9oo+y4GACgsNOgaEoheLp+G+uRutXvVRJDL6d2KWH/HgZVHhTjB9h7Pgod0JVG4ip07yM3q0A/kco3zCLDbeAihhX8UYmoW5cbUV1P/jgBKEt323rTHfm9T3QE5FAYaa6pYjjRqBNPLl+RtIBknyL4fiorxBbEwkOQWKpBKcinPW3VP/qVSkr+E/dTXcv1JZNFK2wPJ5cKIZDp1wl3Md2x1Znfk5gr71gM04OuOc+RZiybYpF832AiZjB4g2Avoo7V+tQ9LOKGdEKT3a2Y8Lmv2uyruai67fkT6v1jAA8DMTPiX9WBDe1kG6tlRhgJPnVBsT+4ZLKx0dOG5MOl+ptPaMhEPAd6nzK/s+oYyqqtBtTaqVZ4Jj7h6m4cGPCE5mQN5esyMthjQM7x7E2y6iBRvixki+KynBy8NbNumSs5pT0cE4UQFb/aT3iUDa07OGAsMzMhPT4cC3kjvMqEOsfgkL+s0qPDVW2yO3lYoXEcsd9dbt6ks0Djt1SGfHot8y60NQcKWgfLOQIPVn7djLzIEu8QOcZ65Xh+SXD5nuFXwWWShbvp2v/qMfRyGtYkMHuf+Isvz1Y8IrFAHJ9xX0Pbd8i54LnBjtrVo6pSurR5deA9tw1PGoTjpSrtOpibgBj0ntNtn4xa33R3E/w5BuYxY62Pz6JBbdf27iXnvIai/z1UhO/122QAGfvySdIZRzhO7LY/MAMP9fQrZQmSCUosrrnOlR9ob2YoFvKKLDK8Xc4PyOKyKylajGLe1S3bKT/wxQBFPpGM0LJVEFG8ThiMoQhliNnVNr3Y477PKaADIgqbNuKt4ANN+Jtbrn44afgiXWviVQr/QEQX0L9qb3BUd2cg6AAAAAAAAAKyAAAAAEVhdOWYLGJZUejU9N5bXH/+GLAACk6H+Hop7/3FM7dMbwaTs4Hkliee+MGke8yCtC6/OTWKBGo5j5UEAAVRhsiMoZUp5x8MG5zbJ0Ydsfm58Ek79Dg0OJ0H+1G3YdM5adZn4tcvQhTq/9cSp2kJ6x41hSOvJrJkxJ2z5SAA554IhzVGtcJHv9e/wjbpW3P+XYab6kcYbmzYDmdR1040qthOQvfLjwvm53fwk45mt8OKlW76fJMlj/+Iu/+8WmRomLYLg836vv18cEx1on2W/8pyFqhm42tIv/y7DUUqzjendhH4LskOUle5Y7ecQ7kFUf5W5pvnFv/mHxaiYkTSq4kStmmWAuFz8wdHslAYq3K3acgndAac54wJmX0ALdrwjwH4oCaxcgui1GFIwWE6a3njE/9zMDeUsNb7tl+/4i53kryYZyxlUcCNoywrGT7s9gc7ma2Z7ZqM2YAgHnesw5J5elwhS/pvTBOVu8vzuoNZFn9tWzbUROvt93ZTSSkebDmsMBYJy8ywMJgLgs2Gzh09hG+o4c44bcVf/2E3zT7HtwpnMpMEuQ4KWWcUWf+/Lg7skwAAAAAAAAAA==';
var NAV_ICON_SVG = {
  home: MGI.nHome,
  assets: MGI.nOrders,
  promo: MGI.nPromo,
  network: MGI.nTeam,
  salary: MGI.nSalary,
  account: MGI.nProfile,
};
// Owner: "the icon fades in and out when tapped not static and selector
// doesn't disappear." The selector BOX is pure CSS off .navitem.active and
// needs no help here -- it stays put. This is only for the ICON's tap
// tap signal animation: put the class on when a thumb lands,
// take it off when the animation ends so it can replay.
//
// Bound on the BAR, not on each of the six items -- one listener instead of
// six, and it keeps working no matter how the items are re-rendered.
// pointerdown rather than click, so the box appears the instant a thumb
// lands rather than after the tap completes.
var _navTapHooked = false;
// Owner: "l also want when l tap on the product card it fades in then out,
// but no action just it is animation but no action should be there on
// triggering buy."
//
// One delegated listener on #pageHost rather than a handler per card: the
// catalog re-renders whenever products load or refresh, and per-card
// handlers would have to be re-attached every time.
//
// The card deliberately has NO onclick. Buying stays behind the Buy Now
// button alone, and this listener bails out the moment the tap came from
// that button (or any other control), so the acknowledgement and the
// purchase can never be confused for one another.
var _cardTapHooked = false;
function hookProductCardTap(){
  if (_cardTapHooked) return;
  const host = $('pageHost');
  if (!host) return;
  _cardTapHooked = true;
  host.addEventListener('pointerdown', e => {
    if (!e.target.closest) return;
    // A tap on Buy Now is a purchase, not a card acknowledgement -- let it
    // through untouched rather than animating the whole card under it.
    if (e.target.closest('button, a, input, select, textarea')) return;
    const card = e.target.closest('.mg-card');
    if (!card) return;
    // Re-adding a class already present does not restart a CSS animation
    // (same reason hookNavTapBox() forces a reflow).
    card.classList.remove('card-tap');
    void card.offsetWidth;
    card.classList.add('card-tap');
  }, { passive: true });
  host.addEventListener('animationend', e => {
    // Must name the CURRENT keyframes. It read 'cardTapFade' while the
    // animation was renamed to cardTapBounce, and the failure is silent in
    // the worst way: the first tap animates, the class is never taken off,
    // and every tap after that does nothing at all.
    if (e.animationName === 'cardTapBounce' && e.target.classList)
      e.target.classList.remove('card-tap');
  });
}
function hookNavTapBox(){
  if (_navTapHooked) return;
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;
  _navTapHooked = true;
  nav.addEventListener('pointerdown', e => {
    const btn = e.target.closest && e.target.closest('.navitem');
    if (!btn) return;
    // Re-adding a class that is ALREADY on the element does not restart a
    // CSS animation, so tapping the same tab twice in a row would do
    // nothing the second time. Take it off and force a reflow to replay it.
    btn.classList.remove('nav-tap');
    void btn.offsetWidth;
    btn.classList.add('nav-tap');
    // A soft ring spreads from the finger, as in the owner's recording.
    const r = btn.getBoundingClientRect(), rip = document.createElement('i');
    rip.className = 'mg-ripple';
    rip.style.left = (e.clientX - r.left) + 'px'; rip.style.top = (e.clientY - r.top) + 'px';
    btn.appendChild(rip);
    setTimeout(() => { if (rip.parentNode) rip.parentNode.removeChild(rip); }, 560);
  }, { passive: true });
  // Clean the class off once it has played, so the next tap is a fresh run
  // and nothing is left holding a finished animation.
  nav.addEventListener('animationend', e => {
    if (e.animationName === 'navTapSignal') {
      // The animation is on the <img> INSIDE the item, so the event target
      // is the image -- the class to clear is on its .navitem ancestor.
      const btn = e.target.closest && e.target.closest('.navitem');
      if (btn) btn.classList.remove('nav-tap');
    }
  });
}

// A drawn green scrollbar. The phone browsers hide the page's own scrollbar (the whole page scrolls, not an inner box), but the owner's screens
// show a thin green bar at the right edge whenever a page or sheet is longer than the screen. It follows whatever is scrolling right now:
// the open sheet / page, else the Login/Sign Up scroller, else the document, and sits between the top and the bottom bar.
function mgScrollbarInit(){
  if (window.__mgSb) return; window.__mgSb = true;
  if (!document.body) { document.addEventListener('DOMContentLoaded', () => { window.__mgSb = false; mgScrollbarInit(); }); return; }
  const mk = id => { const b = document.createElement('div'); b.id = id; b.className = 'mg-sb'; b.setAttribute('aria-hidden', 'true'); b.innerHTML = '<i></i>'; document.body.appendChild(b); return { bar: b, thumb: b.firstChild, cur: null }; };
  const main = mk('mgSb'), list = mk('mgSbList');
  const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  function target(){
    const sheets = [...document.querySelectorAll('.sheet-bg.show,#msgDetailBg.show,#depStatusBg.show,.pay-page.show')].filter(shown);
    if (sheets.length) return sheets[sheets.length - 1];
    const auth = document.getElementById('authScreen');
    if (auth && auth.style.display !== 'none' && shown(auth)) { const a = auth.querySelector('.ma-scroll'); if (a && shown(a)) return a; }
    return document.scrollingElement || document.documentElement;
  }
  // Two speeds. layout() is the slow one (sizes the bar and the thumb, decides which scroller it follows); it runs only when something on screen
  // changed. position() is the fast one: while the member scrolls it only moves the thumb with a transform, once per frame, so it follows the
  // finger without lag (it used to redo everything every 40 ms, which made the thumb jump in steps).
  const gut = (el, on) => { if (el.classList.contains('mg-gut') !== on) el.classList.toggle('mg-gut', on); };
  const scrollTopOf = c => c.isDoc ? window.pageYOffset : c.el.scrollTop;
  function place(o, c){
    const over = c.el.scrollHeight - c.ch;
    const ty = over > 0 ? (c.track - c.th) * Math.min(1, Math.max(0, scrollTopOf(c) / over)) : 0;
    o.thumb.style.transform = 'translate3d(0,' + ty.toFixed(2) + 'px,0)';
  }
  function setBar(o, c){
    if (!c) { if (o.cur !== null || o.bar.style.display !== 'none') { o.bar.style.display = 'none'; } o.cur = null; return; }
    const same = o.cur && o.cur.el === c.el && o.cur.top === c.top && o.cur.track === c.track && o.cur.th === c.th && o.cur.right === c.right;
    o.cur = c;
    if (!same) { o.bar.style.cssText = 'display:block;top:' + c.top + 'px;height:' + c.track + 'px;right:' + c.right + 'px'; o.thumb.style.height = c.th + 'px'; }
    place(o, c);
  }
  function measure(el, isDoc, top, bottom, ch, right){
    const sh = el.scrollHeight, track = bottom - top;
    if (sh - ch < 8 || track < 30) return null;
    return { el, isDoc, top, track, ch, right, th: Math.max(30, Math.round(track * ch / sh)) };
  }
  // The scrollbar takes 4px of a page's width while that page has one (as in the owner's screens, where every page with a bar is 4px narrower on
  // the right). `mg-gut` on the scroller (the page, a sheet, or the Login scroller) makes the room. Each scroller's room depends only on ITS OWN
  // length, never on which scroller is on top, and the pass runs in the frame of the change (before it is painted): the page behind an opening
  // sheet keeps its width, and a page you come back to is already its right width instead of jumping 4px a moment later.
  const overflows = (el, ch) => el.scrollHeight - ch >= 8;
  function gutters(){
    try {
      const app = document.getElementById('app'), de = document.documentElement;
      gut(de, !!(app && app.style.display !== 'none' && overflows(document.scrollingElement || de, window.innerHeight)));
      document.querySelectorAll('.sheet-bg, .ma-scroll').forEach(el => gut(el, shown(el) && overflows(el, el.clientHeight)));
    } catch (_) {}   // a page that is being torn down has nothing to measure
  }
  window.mgGutters = gutters;
  function layout(){
    const el = target(), isDoc = el === document.scrollingElement || el === document.documentElement;
    let c;
    if (isDoc) {
      let bottom = window.innerHeight;
      const nav = document.querySelector('.bottom-nav'), app = document.getElementById('app');
      if (nav && shown(nav) && app && app.style.display !== 'none') bottom = nav.getBoundingClientRect().top;
      c = measure(el, true, 0, bottom, window.innerHeight, 0);
    } else {
      const r = el.getBoundingClientRect();
      c = measure(el, false, Math.max(0, r.top), Math.min(window.innerHeight, r.bottom), el.clientHeight, 0);
    }
    gutters();
    setBar(main, c);
    layoutList();
  }
  // the bank list that drops down in Add Wallet scrolls on its own
  function layoutList(){
    const pl = document.querySelector('.prov-list');
    if (pl && shown(pl)) {
      const r = pl.getBoundingClientRect();
      setBar(list, measure(pl, false, r.top + 4, r.bottom - 4, pl.clientHeight, Math.max(0, Math.round(window.innerWidth - r.right)) + 2));
    } else setBar(list, null);
  }
  let slow = 0, fast = 0;
  const layoutSoon = () => { if (slow) return; slow = setTimeout(() => { slow = 0; layout(); }, 50); };
  window.addEventListener('scroll', e => {
    if (fast) return;
    fast = requestAnimationFrame(() => {
      fast = 0;
      if (main.cur) place(main, main.cur); else layoutSoon();
      if (list.cur) { place(list, list.cur); }
    });
  }, { capture: true, passive: true });
  window.addEventListener('resize', layoutSoon); window.addEventListener('orientationchange', layoutSoon);
  window.addEventListener('load', layoutSoon, true); window.addEventListener('transitionend', layoutSoon, true); window.addEventListener('animationend', layoutSoon, true);
  if (typeof MutationObserver === 'function') new MutationObserver(recs => { if (recs.some(r => !(r.target.closest && r.target.closest('.mg-sb')) && !(r.target.id === 'mgSb' || r.target.id === 'mgSbList'))) {
    // Content or a class changed: set the rooms in this same microtask, i.e. before the browser paints the change. (Style-only changes such as
    // animation frames do not need it, and a forced measure on each would cost.)
    if (recs.some(r => r.type === 'childList' || r.attributeName === 'class')) gutters();
    layoutSoon();
  } })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  layout();
}
mgScrollbarInit();
function updateNavIcons(){
  // Installed from here because this runs on every showPage() -- by the
  // first one the bar is definitely in the DOM, and the guard above makes
  // every later call free.
  hookNavTapBox();
  // Same reasoning, same lifecycle: #pageHost is in the DOM by the first
  // showPage(), and the hook's own guard makes every later call free.
  hookProductCardTap();
  document.querySelectorAll('.navitem').forEach(btn => {
    const key = btn.dataset.nav;
    const active = key === STATE.page;
    const slot = btn.querySelector('.nav-ic');
    // Only written once -- reassigning the same markup on every navigation
    // would restart the SVG in some engines and, more to the point, is
    // simply unnecessary work on every single tab switch.
    // Stamp the slot so an installed page which receives an updated supplied
    // icon replaces its old markup once, without re-writing it on every tab.
    if (slot && slot.dataset.mintNavIcon !== key) {
      slot.innerHTML = NAV_ICON_SVG[key] || '';
      slot.dataset.mintNavIcon = key;
    }
    btn.classList.toggle('active', active);
  });
}
// Keeps balances/team stats quietly current while the app just sits open --
// no navigation needed to see fresh numbers. Started once per page-enter
// (idempotent -- always clears any prior timer first) and checks
// STATE.page on every tick rather than tracking which page started it, so
// it naturally follows the user across tabs without needing to be
// restarted per-page. Only ever patches specific numeric fields in place
// (never a full page rebuild) so it can't disturb the activity ticker, the
// chest-swing animation, plan countdowns, or whichever team level/tab the
// member currently has open.
// ── THE LIVE LOOP ──
//
// Owner: "make sure that the app always listens to every content and updates
// quickly without reloads ... l want every data to be loaded up quickly every
// seconds, no reloads."
//
// A NOTE ON FIREBASE LISTENERS, because he asked for those by name: they are
// not available to this data. Firebase here is Auth only -- who you are. Every
// figure in the app (balances, plans, records, team, messages, settings) lives
// in MongoDB behind mint-server, so there is no Firestore document to attach onSnapshot
// to. The equivalent behaviour without rebuilding the backend is this: a short
// poll that repaints IN PLACE. Nothing reloads, nothing navigates, and the
// member cannot tell the difference. (A genuine server push would be SSE from
// mint-server off a Mongo change stream -- a real option, and a much bigger
// change than this.)
//
// What it does, and the reasons each part is not optional:
//  * ONE timer for the whole app, following STATE.page and the open sheet on
//    every tick rather than being restarted per screen.
//  * setTimeout chained, not setInterval: a fixed interval cannot back off, and
//    a stalled request under setInterval stacks up more of the same request.
//  * PAUSED while the app is hidden. This was the old loop's real fault -- it
//    kept hitting the backend from a phone in a pocket, all night. It kicks
//    immediately on return, so coming back to the app shows fresh figures at
//    once rather than after a wait.
//  * Repaints only when the data ACTUALLY CHANGED (liveChanged below). A list
//    rebuilt on every tick would reset scroll position and restart the reveal
//    animation -- which is precisely the "reload" feeling he does not want.
//  * Reads only. No money endpoint is ever called from here.
// _liveGen invalidates work already in flight. A tick that is sitting on an
// await when the member signs out would otherwise come back, reschedule itself
// and keep polling a session that no longer exists.
var _liveTimer = null, _liveBusy = false, _liveDelay = 0, _liveSigs = {}, _liveGen = 0;
// Database reads are the scarce thing on the hosted database (500 operations a second in all), and a Home tick used to cost
// three reads (balance, then the list of products owned, which is two). The balance still follows the member every second,
// but the heavier lists are re-read only when something that can change them has happened: the balance moved (a payout, a
// deposit, a purchase all move it) or their own short beat has elapsed (an admin giving a product or sending a message does
// not move the balance). Nothing else about what is shown changes.
var LIVE_LIST_MS = 8000, LIVE_FEED_MS = 4000, _liveSeenAt = {}, _liveAccountMoved = false;
function liveDue(key, ms, force){
  const now = Date.now();
  if (force || !_liveSeenAt[key] || now - _liveSeenAt[key] >= ms) { _liveSeenAt[key] = now; return true; }
  return false;
}
// Owner: "let it poll every 1 second, we have a VPS KVM1 and MongoDB flex" --
// was 5000/floored-at-2000. The 2s floor's own reasoning (phone battery/radio
// wake-ups, not server cost) still genuinely applies at 1s -- it is simply a
// tradeoff the owner chose to accept now that the infra behind it is real.
// Team/settings deliberately were NOT sped up to match -- see their own
// comments below; neither needs per-second freshness, and hammering them at
// 1Hz would burn battery for zero perceptible benefit.
var LIVE_MS = 1000, LIVE_MAX_MS = 60000;
// Team stats get their own, slower beat -- see the note at their fetch.
var LIVE_TEAM_MS = 30000, _liveTeamAt = 0;
// Settings get their own slower beat too -- see the note at their fetch.
var LIVE_SETTINGS_MS = 30000, _liveSettingsAt = 0;
// Tunable from the backend without shipping an app build. Floored at 1s:
// below that the phone spends more time on radio wake-ups than on anything a
// member would notice, and server.js's own livePollLimiter/livePollIpLimiter
// (see their comment there) are sized for exactly this floor, not faster.
function livePollMs(){
  const s = Number((STATE.settings || {}).livePollMs);
  return Math.max(1000, Number.isFinite(s) && s > 0 ? s : LIVE_MS);
}
// True the first time it sees a given payload, and whenever it changes after
// that. Keyed per feed, so one busy feed cannot suppress another.
function liveChanged(key, value){
  const s = JSON.stringify(value);
  if (_liveSigs[key] === s) return false;
  _liveSigs[key] = s;
  return true;
}
function stopLiveRefresh(){
  _liveGen++;
  clearTimeout(_liveTimer); _liveTimer = null; _liveBusy = false;
  _liveDelay = 0; _liveSigs = {}; _liveTeamAt = 0; _liveSettingsAt = 0; _liveSeenAt = {}; _liveAccountMoved = false;
}
function scheduleLive(gen, ms){
  clearTimeout(_liveTimer);
  _liveTimer = setTimeout(() => liveTick(gen), ms);
}
async function liveTick(gen){
  if (gen !== _liveGen) return;              // stopped, or restarted under us
  if (document.hidden || _liveBusy) { scheduleLive(gen, livePollMs()); return; }
  _liveBusy = true;
  let ok = true;
  try {
    ok = await liveRefreshVisible();
  } catch (_) {
    ok = false;
  }
  _liveBusy = false;
  if (gen !== _liveGen) return;              // signed out while that was in flight
  // Steady cadence while the backend is answering; exponential backoff while it
  // is not, so a sleeping Render instance is not hammered awake by a phone that
  // has been left open on one screen.
  _liveDelay = ok ? livePollMs() : Math.min(LIVE_MAX_MS, Math.max(livePollMs(), _liveDelay || 0) * 2);
  scheduleLive(gen, _liveDelay);
}
// Everything the member can currently see, and nothing else. Each branch
// re-checks what is on screen AFTER its await -- a tick that started on Home
// must not paint into Team because the member moved while it was in flight.
async function liveRefreshVisible(){
  const sheet = _openSheetTitle;
  let ok = true;
  // The wallet figure follows the member everywhere, so it is refreshed on
  // every tick regardless of screen -- it is the number they care about most,
  // and it is one small read.
  const acc = await api('/account');
  if (acc.status === 'success') {
    STATE.account = acc.account;
    _liveAccountMoved = false;
    if (liveChanged('account', acc.account)) {
      _liveAccountMoved = true;
      // patchHomeBalances() writes only the specific figures and no-ops on a
      // page that has none, so it is safe on every screen -- and unlike
      // renderAccount() it cannot reset the member's scroll position, which
      // would read as the reload he does not want.
      patchHomeBalances();
    }
  } else ok = false;

  // Owner: "the app still serves the old data, so can't you make when it
  // loads up without even reloading or restarting app." Settings (fees,
  // minimums, brand name, the announcement, support contacts, the OTP
  // toggle, product availability flags, and everything else an admin can
  // change) were never part of this loop at all -- STATE.settings was
  // fetched once at boot and held forever, so an admin change only ever
  // reached an already-open session after a manual reload. Its own slower
  // beat, like team stats right below: these change rarely (an admin
  // action), not every few seconds, and every sheet that actually reads a
  // setting (Deposit, Withdraw, Wallet, ...) already re-reads
  // STATE.settings fresh at the moment it opens -- so simply keeping this
  // object current is enough to fix them, no repaint needed there. Brand
  // name is the one thing shown continuously on screen, so that alone gets
  // a targeted patch, same non-disruptive pattern as patchHomeBalances()
  // above -- never a full re-render, which would reset scroll position and
  // read as the reload he does not want.
  if (Date.now() - _liveSettingsAt >= LIVE_SETTINGS_MS) {
    _liveSettingsAt = Date.now();
    const sr = await api('/public/settings');
    if (sr.status === 'success') {
      const changed = liveChanged('settings', sr.settings);
      STATE.settings = sr.settings || {};
      if (changed) applyBrandName();
    } else { _liveSettingsAt = 0; ok = false; }
  }

  // An open sheet is what the member is actually looking at, so it wins over
  // the page behind it.
  if (sheet === 'Balance Record') {
    if (!liveDue('tx', LIVE_LIST_MS, _liveAccountMoved)) return ok;
    const r = await api('/transactions');
    if (r.status === 'success' && _openSheetTitle === 'Balance Record') {
      STATE.transactions = r.transactions;
      STATE.transactionsTruncated = !!r.truncated;
      if (liveChanged('tx', r.transactions)) renderStatement();
    } else if (r.status !== 'success') ok = false;
    return ok;
  }
  if (sheet === 'Messages') {
    if (!liveDue('messages', LIVE_FEED_MS, _liveAccountMoved)) return ok;
    const r = await api('/messages');
    if (r.status === 'success' && _openSheetTitle === 'Messages') {
      STATE.messages = r.messages;
      if (liveChanged('messages', r.messages)) { renderMessagesList(); updateMessageBadge(); }
    } else if (r.status !== 'success') ok = false;
    return ok;
  }

  if (STATE.page === 'home' && !sheet) {
    if (!liveDue('inv', LIVE_LIST_MS, _liveAccountMoved)) return ok;
    const [pr, r] = await Promise.all([api('/public/products'), api('/investments')]);
    if (r.status === 'success' && Array.isArray(r.investments)) {
      STATE.investments = r.investments;
      _investmentsLoadFailed = false;
    } else ok = false;
    // The product list on Home follows the admin's changes (price, order, switched off) without the member reloading.
    if (pr.status === 'success') {
      STATE.products = pr.products;
      if (!_openSheetTitle && STATE.page === 'home' && liveChanged('products', pr.products) && $('homeProducts')) {
        const list = (STATE.products || []).filter(p => p.active !== false);
        $('homeProducts').innerHTML = list.length ? list.map(vProductCardHtml).join('') : '<div class="v-empty">No products yet.</div>';
        startProductCountdowns();
      }
    } else ok = false;
  } else if (STATE.page === 'assets') {
    if (!liveDue('inv', LIVE_LIST_MS, _liveAccountMoved)) return ok;
    const [pr, ir] = await Promise.all([api('/public/products'), api('/investments')]);
    if (pr.status === 'success') STATE.products = pr.products; else ok = false;
    if (ir.status === 'success') {
      STATE.investments = ir.investments;
      _investmentsLoadFailed = false;
    } else ok = false;
    if (!_openSheetTitle && STATE.page === 'assets') {
      const changedProducts = pr.status === 'success' && liveChanged('products', pr.products);
      const changedInvestments = ir.status === 'success' && liveChanged('investments', ir.investments);
      if (changedProducts || changedInvestments) paintAssets();
    }
  } else if (STATE.page === 'salary') {
    if (!liveDue('salary', LIVE_TEAM_MS, _liveAccountMoved)) return ok;
    const r = await api('/salary/status');
    if (r.status === 'success') {
      STATE.salary = r;
      if (STATE.page === 'salary' && !_openSheetTitle && liveChanged('salary', r)) paintSalary();
    } else ok = false;
  } else if (STATE.page === 'promo') {
    if (Date.now() - _liveTeamAt >= LIVE_TEAM_MS) {
      _liveTeamAt = Date.now();
      const r = await api('/team/stats');
      if (r.status === 'success') { STATE.teamStats = r; if (STATE.page === 'promo' && !_openSheetTitle && liveChanged('team', r)) paintPromo(); }
      else { _liveTeamAt = 0; ok = false; }
    }
  } else if (STATE.page === 'network') {
    if (Date.now() - _liveTeamAt >= LIVE_TEAM_MS) {
      _liveTeamAt = Date.now();
      const r = await api('/team/stats');
      if (r.status === 'success' && STATE.page === 'network' && !_openSheetTitle) {
        STATE.teamStats = r;
        if (liveChanged('team', r)) { _teamMembersAt = {}; paintNetwork(); } // someone joined or changed: refetch the lists too
      } else if (r.status !== 'success') { _liveTeamAt = 0; ok = false; }
    }
  }
  return ok;
}
function startLiveRefresh(){
  _liveGen++;
  _liveDelay = livePollMs();
  scheduleLive(_liveGen, _liveDelay);
}
// Coming back to the app refreshes it at once. Without this the member stares
// at whatever was on screen when they left until the next tick, which is the
// single most visible way a polled app feels stale.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && _liveTimer) { _liveDelay = livePollMs(); scheduleLive(_liveGen, 0); }
});
window.navigatePage = function(name){
  dismissNotify();
  if (STATE.page === name && !document.querySelector('.sheet-bg.show,#msgDetailBg.show,#depStatusBg.show')) return;
  return showPage(name);
};
window.showPage = async function(name){
  // The page being left, captured before STATE.page is overwritten below --
  // maybeAnnounceAfterHomeNav() needs to know what tab a member is arriving
  // at Home FROM (Assets/Network/Account), not just that they landed on it.
  const prevPage = STATE.page;
  // The bottom bar now stays visible over sheets (Deposit, Withdraw, Wallet
  // and the rest), so a tab can be tapped while one is open. Close it first,
  // otherwise the new tab paints underneath a sheet that is still covering
  // it and the app looks frozen.
  //
  // The message detail is its OWN overlay, not a sheet, and it is the only
  // other one that stops above the bottom bar (`bottom:var(--nav-h)`, same as
  // .sheet-bg) -- so the nav is tappable through it and the tap did nothing.
  // Owner: "when in this message and you tap nav icons, the message screen
  // still persists to go away unless you click on X mark."
  //
  // The recharge status page (.pay-page) is a full-screen task state with
  // the bottom nav hidden while it is open. Keep its teardown here anyway so
  // any programmatic tab change also dismisses the overlay cleanly.
  //
  // Unlike the other two it owns NO history entry (openDepositStatusModal
  // does not pushState), so it must not be counted in `spent` below --
  // retiring an entry it never pushed would walk the member off the app's
  // first entry and drop them out of the app.
  //
  // Closing the page does NOT stop the poll, deliberately: a payment is still
  // in flight at the provider, pollDepositStatus() keeps running and still
  // refreshes Records when it settles.
  //
  // Other overlays cover the full viewport too, so a tab change cannot be
  // triggered from underneath them.
  //
  // Both overlays own a history entry, and they must be unwound with ONE
  // history call: two history.back()s in a single tick is the exact race this
  // file has already been bitten by (see openManualPayOverlay's note on a
  // pushState racing a still-pending back). So closeSheet is told to leave
  // history alone and a single go(-n) retires both entries, firing one
  // popstate that finds everything already closed and does nothing.
  const detailOpen = !!($('msgDetailBg') && $('msgDetailBg').classList.contains('show'));
  const sheetOpen = !!document.querySelector('.sheet-bg.show');
  const payOpen = !!($('depStatusBg') && $('depStatusBg').classList.contains('show'));
  if (detailOpen) $('msgDetailBg').classList.remove('show');
  if (payOpen) {
    $('depStatusBg').classList.remove('show');
    document.body.classList.remove('deposit-status-open');
    unlockBodyScroll();
  }
  // Owner: "some notifies take long to go away even when you've clicked in
  // another category, it still keep showing." notify()'s own 3.6s timer only
  // ever gets reset by ANOTHER notify() call -- switching tabs never touched
  // it, so a toast that fired moments before a tab tap rode out its full
  // remaining time floating over whatever screen the member had already
  // moved on to. Torn down here alongside the other overlays this same
  // function already tears down on a tab change. Deliberately NOT routed
  // through closeNotify(): that fires the pending onClose callback (e.g. the
  // insufficient-balance toast's "send them to Deposit"), and a member
  // tapping a different tab is not acknowledging the toast -- it must not
  // ALSO force a navigation neither the toast nor the tap asked for.
  dismissNotify();
  if (sheetOpen && typeof closeSheet === 'function') closeSheet({ navigating: true, keepHistory: true });
  // payOpen is deliberately absent from this count -- it pushes no history
  // entry, so including it would retire someone else's.
  const spent = (detailOpen ? 1 : 0) + (sheetOpen ? 1 : 0);
  if (spent) history.go(-spent);
  if (name === 'products') name = 'home';
  else if (name === 'catalog') name = 'assets';
  else if (name === 'team') name = 'network';
  else if (name === 'referral') name = 'promo';
  STATE.page = name;
  { const ph = $('pageHost'); if (ph) { ph.classList.remove('mg-enter'); void ph.offsetWidth; ph.classList.add('mg-enter'); } }
  window.scrollTo(0, 0);   // every tab opens at its top, not wherever the previous one was scrolled
  updateNavIcons();
  if (name === 'home') {
    // Deliberately NOT awaited: renderHome() does its own account/investments
    // refresh (a real network round trip even on a cache-hit repaint), and
    // the announcement decision below depends only on STATE.settings, not on
    // that data at all -- awaiting it first would add a real, needless delay
    // before the dialog could ever show. paintHome()'s synchronous portion
    // still runs in this same tick either way (everything in renderHome()
    // before its own first `await` executes before control returns here), so
    // Home's paint ordering is unaffected -- only the announcement's own
    // timing depends on this not being awaited.
    renderHome();
    maybeAnnounceAfterHomeNav(prevPage);
  }
  else if (name === 'assets') await renderAssets();
  else if (name === 'network') await renderNetwork();
  else if (name === 'promo') await renderPromo();
  else if (name === 'salary') await renderSalary();
  else if (name === 'account') await renderAccount();
  startLiveRefresh();
};
// Announcement dialog, reintroduced (owner: "we are going to introduce
// announcement dialog, so it will have channel and email buttons shaking
// and glowing, the cancel X sign will be top right... it opens from middle
// as usual and also just like mechanism of previous chipz clicking back to
// home stimulates it"). Was removed entirely in an earlier round (see
// mint/CLAUDE.md's "Design system" section) -- maybeShowAnnouncement() was
// deliberately kept as a no-op rather than deleted specifically so
// maybeAnnounceAfterSheet()'s five call sites never needed touching either
// time; this round just gives it a real body again. Content (annTitle/
// annBody) and the WhatsApp/email CTAs (whatsappGroup/supportEmail) reuse
// the exact same admin settings and rendering pattern openSupportSheet()
// already established -- one set of contact fields, two places they show.
window.closeAnnouncement = function(){
  const bg = $('annBg');
  if (bg) { if (bg.classList.contains('show')) dlgClosed(); bg.classList.remove('show'); }
  if (!isScrollLockOverlayOpen()) unlockBodyScroll();
};
// The announcement is one portrait picture (uploaded in the admin panel) with
// Join Channel and Close under it. Join Channel opens the Telegram group link,
// or the WhatsApp group link when no Telegram group is set.
function maybeShowAnnouncement(){
  const s = STATE.settings || {};
  const lines = String(s.annBody || '').split('\n').map(x => x.trim()).filter(Boolean);
  // The picture is fetched behind the loading screen: wait for it, so the dialog opens once, complete.
  if (!_artLanded && !STATE.announcementImage) {
    if (!_annWaiting) { _annWaiting = true; startArtwork().then(() => { _annWaiting = false; if (!isAnyOverlayOpen()) maybeShowAnnouncement(); }); }
    return;
  }
  if (!STATE.announcementImage && !(s.annEnabled && lines.length)) {
    // The pictures are fetched after the loading screen comes down; if they
    // have not landed yet, open the dialog the moment they do.
    if (!_artLanded && !_annWaiting) { _annWaiting = true; startArtwork().then(() => { _annWaiting = false; if (!isAnyOverlayOpen()) maybeShowAnnouncement(); }); }
    return;
  }
  const bg = $('annBg'), sheet = $('annSheet');
  if (!bg || !sheet) return;
  const link = s.telegramGroup || s.whatsappGroup || '';
  sheet.innerHTML = `
    <button class="mg-ann-x" type="button" onclick="closeAnnouncement()" aria-label="Close">${MGI.x}</button>
    <h2>${esc(s.annTitle || 'Welcome')}</h2>
    <div class="mg-ann-body">
      ${STATE.announcementImage ? `<img class="mg-ann-img" src="${esc(STATE.announcementImage)}" alt="">` : ''}
      ${lines.length ? `<div class="mg-ann-lines">${lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>` : ''}
    </div>
    ${link ? `<a class="mg-ann-join" href="${esc(link)}" target="_blank" rel="noopener" onclick="closeAnnouncement()">Join Channel</a>` : ''}`;
  bg.classList.add('show');
  lockBodyScroll(); dlgOpened();
}

// ── HOME ──
// Cache-first: a page revisit paints instantly from whatever STATE already
// holds (no network wait, no loading affordance needed), then a background
// fetch quietly brings it up to date. `patchHomeBalances()` updates just the
// 3 money figures in place afterward (and on a standing timer via
// startLiveRefresh()) without rebuilding the page -- rebuilding would tear
// down and restart the ticker/chest-swing animations every few seconds.
// A list that could not be fetched says so (and a tap tries again) instead of passing itself off as an empty one: "No Orders" after a failed
// load would tell a member their purchases are gone.
var _productsLoadFailed = false, _recordsLoadFailed = false, _messagesLoadFailed = false;
function loadFailHtml(what, cls){ return '<div class="v-empty ' + (cls || '') + '" role="button" onclick="retryLoad(\'' + what + '\')">Could not load. Tap to try again.</div>'; }
window.retryLoad = function(what){
  if (what === 'home') return renderHome();
  if (what === 'assets') return renderAssets();
  if (what === 'records') return openTransactionStatement(_statementCat);
  if (what === 'messages') return openMessagesSheet();
};
async function renderHome(){
  const hadInvestments = Array.isArray(STATE.investments);
  const shownProducts = homeSignature();
  const hadProductList = !!STATE.products;
  paintHome();
  const [accR, invR, prR] = await Promise.all([ api('/account'), api('/investments'), api('/public/products') ]);
  if (accR.status === 'success') STATE.account = accR.account;
  if (prR.status === 'success' && Array.isArray(prR.products)) { STATE.products = prR.products; _productsLoadFailed = false; }
  else if (!STATE.products) _productsLoadFailed = true;   // stays unset so Home says "could not load", not "no products"
  if (invR.status === 'success' && Array.isArray(invR.investments)) {
    STATE.investments = invR.investments;
    _investmentsLoadFailed = false;
  } else if (!hadInvestments) {
    _investmentsLoadFailed = true;
  }
  if (STATE.page !== 'home') return; // navigated away while awaiting
  // Repaint only when the catalog really changed: a rebuild restarts the
  // banner carousel, the ticker and the Buy glow and throws away the scroll position.
  if (homeSignature() !== shownProducts || !hadProductList) paintHome();
  // The envelope button's unread dot. Fetched once per Home entry, AFTER
  // the paint (never blocking it) and patched in place via
  // updateMessageBadge() so it can't tear down the ticker/chest animation.
  const msgR = await api('/messages');
  if (msgR.status === 'success') STATE.messages = msgR.messages;
  if (STATE.page === 'home') updateMessageBadge();
}
// The Home banner has two states: an admin-set still image, or the built-in
// striped fallback with the brand tagline. (The admin-uploadable video
// banner was removed entirely -- owner: "video banner remove it" -- along
// with the preload-during-boot wait it needed, which was costing up to 4s
// of the loading screen on a first open after every upload.)
function homeBannerInnerHtml(st){
  if (STATE.homeBanner) return `<img src="${esc(STATE.homeBanner)}" alt="" onerror="this.style.display='none'">`;
  return `<div class="hb-stripes"></div>`;
}
// ── HOME BANNER CAROUSEL (owner: "those slide images will be uploaded
// from admin panel") ──
// Only kicks in when there is more than one image to actually rotate
// between -- a single image renders exactly as it always has (no dots,
// nothing to cycle). Slide 1 is STATE.homeBanner (the original, pre-
// carousel slot); slides 2/3 are the banner2/banner3 admin uploads.
function homeCarouselSlides(){
  const slides = [STATE.homeBanner].concat(STATE.homeSlides2n3 || []).filter(Boolean);
  return slides.length > 1 ? slides : null;
}
function mgDotsHtml(n, idx){
  let h = '';
  for (let i = 0; i < n; i++) h += '<i' + (i === idx ? ' class="on"' : '') + '></i>';
  return '<div class="mg-dots" id="mgDots">' + h + '</div>';
}
function mgSetDots(idx){
  const box = $('mgDots'); if (!box) return;
  box.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i === idx));
}
function homeBannerBlockHtml(st){
  const slides = homeCarouselSlides();
  if (!slides) return `<div class="home-banner">${homeBannerInnerHtml(st)}${mgDotsHtml(1, 0)}</div>`;
  return `<div class="home-banner" id="homeCarouselTrack"><div class="mg-track" id="mgTrack">${slides.map(u => `<img src="${esc(u)}" alt="" draggable="false">`).join('')}</div>${mgDotsHtml(slides.length, 0)}</div>`;
}
var _homeCarouselTimer = null;
var _homeCarouselIdx = 0;
// The banner slides sideways: it moves on by itself every 4.5 seconds, and the member can swipe it (or tap a dot).
// Self-terminating on the next tick once Home's own nodes are gone, so navigating away never leaves it ticking.
function mgGoSlide(i, noTimerReset){
  const track = $('mgTrack'), slides = homeCarouselSlides();
  if (!track || !slides) return;
  _homeCarouselIdx = ((i % slides.length) + slides.length) % slides.length;
  track.style.transition = 'transform .5s cubic-bezier(.22,1,.36,1)';
  track.style.transform = 'translateX(' + (-100 * _homeCarouselIdx) + '%)';
  mgSetDots(_homeCarouselIdx);
  if (!noTimerReset) startHomeCarousel(true);
}
function startHomeCarousel(keepIdx){
  if (_homeCarouselTimer) { clearInterval(_homeCarouselTimer); _homeCarouselTimer = null; }
  const slides = homeCarouselSlides();
  if (!slides) return;
  if (!keepIdx) _homeCarouselIdx = 0;
  const wrap = $('homeCarouselTrack');
  if (wrap && !wrap._mgSwipe) {
    wrap._mgSwipe = true;
    let x0 = null, dx = 0, w = 1;
    const track = () => $('mgTrack');
    wrap.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; w = wrap.offsetWidth || 1; if (_homeCarouselTimer) { clearInterval(_homeCarouselTimer); _homeCarouselTimer = null; } const t = track(); if (t) t.style.transition = 'none'; });
    wrap.addEventListener('pointermove', e => { if (x0 == null) return; dx = e.clientX - x0; const t = track(); if (t) t.style.transform = 'translateX(calc(' + (-100 * _homeCarouselIdx) + '% + ' + dx + 'px))'; });
    const end = () => { if (x0 == null) return; const moved = dx; x0 = null; mgGoSlide(Math.abs(moved) > Math.min(50, w / 5) ? _homeCarouselIdx + (moved < 0 ? 1 : -1) : _homeCarouselIdx); };
    wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end); wrap.addEventListener('pointerleave', end);
  }
  _homeCarouselTimer = setInterval(() => {
    if (!$('mgTrack')) { clearInterval(_homeCarouselTimer); _homeCarouselTimer = null; return; }
    mgGoSlide(_homeCarouselIdx + 1, true);
  }, 4500);
}
// An asset picture is shown whole, in its own shape (nothing cropped). A portrait picture sits in
// the left column; a square or wide one goes across the top of the card with the figures below.
function vFitCard(img){
  const card = img.closest('.v-card');
  if (!card || !img.naturalWidth || !img.naturalHeight) return;
  const r = img.naturalWidth / img.naturalHeight;
  card.classList.toggle('v-flat', r > 0.85);
  // A portrait picture gets a column just wide enough for its own shape at the card's usual 200 px
  // height (a 2:3 photo -> 133 px), never narrower than the standard 112.5 px or wider than 150 px.
  if (r <= 0.85) card.style.setProperty('--img-w', Math.round(Math.min(150, Math.max(112.5, 200 * r)) * 10) / 10 + 'px');
  else card.style.removeProperty('--img-w');
}
function vNoPicture(img, initial){
  const frame = img.parentNode;
  if (frame && frame.classList) frame.classList.remove('has-img', 'v-fence');
  const card = img.closest('.v-card'); if (card) card.classList.remove('v-flat');
  img.outerHTML = '<span class="v-glyph">' + initial + '</span>';
}
window.vFitCard = vFitCard; window.vNoPicture = vNoPicture;
function vOwnedCount(key){ return (STATE.investments || []).filter(i => i.tierKey === key).length; }
function homeSignature(){ return JSON.stringify(STATE.products || []) + '|' + (STATE.investments || []).map(i => i.tierKey).join(','); }
// The picture sits in a fixed column on the left. A grey band across its top says "Coming Soon" while the product cannot be bought yet,
// and a green band across its bottom says how many of the purchase limit the member already holds (owned/limit).
function mgPicture(p){
  const initial = esc(String(p.name || '?').trim()[0] || '?');
  return p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" onerror="vNoPicture(this,'${initial}')">`
    : `<span class="v-glyph">${initial}</span>`;
}
function mgFit(text){ const n = String(text).length; return n > 16 ? ' f2' : n > 13 ? ' f1' : ''; }
function mgProductOpen(p){ return p.isOpen !== false && !p.comingSoon; }
function vProductCardHtml(p){
  const { cycle, daily, expected } = planFigures(p);
  const limit = Number(p.buyLimit) || 0;
  const owned = vOwnedCount(p.key);
  const pct = limit > 0 ? Math.min(100, Math.round(owned / limit * 100)) : 0;
  const price = vMoney2(p.price), dayly = vMoney2(daily), total = vMoney2(expected);
  return `
  <article class="mg-card" data-key="${esc(p.key)}">
    <div class="mg-card-top">
      <div class="mg-img">${mgPicture(p)}${mgProductOpen(p) ? '' : '<div class="mg-band top">Coming Soon</div>'}${limit > 0 ? `<div class="mg-band bot">${owned}/${limit}</div>` : ''}</div>
      <div class="mg-info">
        <h3>${esc(p.name)}</h3>
        <dl class="mg-rows">
          <div><dt>Price</dt><dd class="${mgFit(price).trim()}">${esc(price)}</dd></div>
          <div><dt>Days</dt><dd>${cycle}</dd></div>
          <div><dt>Daily</dt><dd class="g${mgFit(dayly)}">${esc(dayly)}</dd></div>
          <div class="tot"><dt>Total</dt><dd class="${mgFit(total).trim()}">${esc(total)}</dd></div>
        </dl>
        <div class="mg-limit"><span><i style="width:${pct}%"></i></span><b>${pct}%</b></div>
      </div>
    </div>
    <div class="mg-card-f">${vBuyHtml(p)}</div>
  </article>`;
}
// The Buy button keeps every state productCtaHtml() had (open, coming soon,
// ticking countdown). A product at its purchase limit is a plain disabled button.
function vBuyHtml(p){
  const limit = Number(p.buyLimit) || 0;
  if (limit > 0 && vOwnedCount(p.key) >= limit) return '<button class="mg-buy" disabled>Buy Now</button>';
  if (mgProductOpen(p)) return `<button class="mg-buy" onclick="openInvestConfirm('${esc(p.key)}',this)">Buy Now</button>`;
  const at = Number(p.opensAt) || 0;
  // Not `disabled`: a disabled button swallows the tap, and the screen shows the "Coming soon, please wait" dialog when it is tapped.
  if (!at || p.openMode === 'soon' || p.comingSoon) return '<button class="mg-buy soon" onclick="notify(\'Coming soon, please wait\')">Coming Soon</button>';
  return `<button class="mg-buy soon" onclick="notify('Coming soon, please wait')" data-opens-at="${at}">Coming soon in ${fmtCountdown(at - Date.now())}</button>`;
}
function vBannerHtml(){
  const st = STATE.settings || {};
  return STATE.homeBanner || homeCarouselSlides()
    ? homeBannerBlockHtml(st)
    : `<div class="home-banner v-banner-empty">${mgDotsHtml(1, 0)}</div>`;
}
function mgUnread(){ return (STATE.messages || []).filter(m => !m.read).length; }
function mgTopHtml(){
  const n = mgUnread();
  return `<div class="mg-top"><button class="mg-msg" type="button" onclick="openMessagesSheet()" aria-label="Messages">${MGI.mail}<em class="mg-dot" id="msgDot"${n ? '' : ' style="display:none"'}>${n > 99 ? '99+' : n}</em></button><div class="mg-name home-brand-title">${esc(brandName())}</div></div>`;
}
// Channel = the Telegram group (or the WhatsApp group when there is none); Service = customer service.
window.openContactLink = function(kind){
  const s = STATE.settings || {};
  const url = kind === 'channel' ? (s.telegramGroup || s.telegramChannel || s.whatsappGroup || '') : (s.supportTelegram || s.supportWhatsapp || '');
  if (!/^https?:\/\//i.test(String(url))) return notify('No ' + (kind === 'channel' ? 'channel' : 'service') + ' link is set yet.');
  window.open(url, '_blank', 'noopener');
};
function paintHome(){
  applyProductImageOpacity();
  // A product the admin switched off (Active unticked) is not offered on Home; owners still see it on Orders.
  const products = (STATE.products || []).filter(p => p.active !== false);
  const html = `
<div class="v-page mg-home">
  ${mgTopHtml()}
  ${vBannerHtml()}
  <div class="mg-quick">
    <button type="button" onclick="openDepositSheet()">Deposit</button>
    <button type="button" onclick="openWithdrawSheet()">Withdraw</button>
    <button type="button" onclick="openContactLink('channel')">Channel</button>
    <button type="button" onclick="openContactLink('service')">Service</button>
  </div>
  <div class="mg-list" id="homeProducts">${products.length ? products.map(vProductCardHtml).join('') : (STATE.products ? '<div class="v-empty">No products yet.</div>' : _productsLoadFailed ? loadFailHtml('home') : '')}</div>
  <button class="mg-chest" type="button" onclick="openChestSheet()" aria-label="Treasure chest"><img src="${CHEST_ART}" alt=""></button>
</div>`;
  $('pageHost').innerHTML = html;
  startHomeCarousel();
  startProductCountdowns();
}
function patchHomeBalances(){
  const account = STATE.account || {};
  for (const [id, key] of [['homeWalletBalance','walletBalance'], ['homeTotalEarned','totalEarned'], ['homeTotalDeposited','totalDeposited'], ['homeTotalWithdrawn','totalWithdrawn']]) {
    const el = $(id);
    if (el) el.textContent = fmtUGX(account[key]);
  }
  // The figures the current screens actually show: My (balance), Income (total earnings) and the Balance Record header.
  for (const [id, key] of [['myBalance','walletBalance'], ['incomeTotal','totalEarned'], ['recBalance','walletBalance'], ['witBalance','walletBalance']]) {
    const el = $(id);
    if (el) el.textContent = vMoney2(account[key]);
  }
}
// THE single place this app works out what a product pays. /public/products
// already sends resolved expectedReturn/cycle/dailyPayout figures computed
// by the same code that credits the money, so the normal path here is just
// to read them. The fallback exists only for a client running against an
// older build of the server, and it mirrors server.js's
// productExpectedReturn() exactly: the per-product multiplier wins over a
// stored expectedReturn, which wins over the global x30.
// Do not re-derive a payout anywhere else. Three screens each had their own
// slightly different formula before this, and once a multiplier was set on a
// product that still carried an inherited expectedReturn, the card and the
// buy-confirm dialog quoted a total the server was never going to pay.
function planFigures(p){
  const price = Number(p.price) || 0;
  const cycle = Number(p.cycle) || 150;
  const stored = Number(p.expectedReturn);
  const daily = Number(p.dailyPayout);
  // dailyPayout is only ever present on the resolved server view, so its
  // presence is what tells us expectedReturn has already been worked out.
  if (Number.isFinite(daily) && daily > 0 && Number.isFinite(stored) && stored > 0)
    return { price, cycle, expected: Math.round(stored), daily };
  const mult = Number(p.multiplier);
  const expected = (Number.isFinite(mult) && mult > 0) ? Math.round(price * mult)
    : (Number.isFinite(stored) && stored > 0) ? Math.round(stored)
    : Math.round(price * 30);
  return { price, cycle, expected, daily: Math.round(expected / cycle) };
}
// HH:MM:SS, and days folded into the hours rather than shown separately -- a
// product opening in two days reads "48:00:00", which is still a countdown. A
// finished one reads 00:00:00 rather than going negative.
function fmtCountdown(ms){
  let s = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = n => String(n).padStart(2, '0');
  return pad(h) + ':' + pad(m) + ':' + pad(s);
}
// One timer for every scheduled card on screen. Cleared and restarted by
// whichever screen paints them, the same shape startPlanCountdowns() uses.
// When a card's moment arrives it re-fetches the catalog once, so the button
// becomes Buy Now on its own -- without that the member would sit watching
// 00:00:00 until they navigated away and back.
var _openCountdownTimer = null;
function startProductCountdowns(){
  if (_openCountdownTimer) { clearInterval(_openCountdownTimer); _openCountdownTimer = null; }
  const tick = () => {
    const nodes = document.querySelectorAll('[data-opens-at]');
    if (!nodes.length) { clearInterval(_openCountdownTimer); _openCountdownTimer = null; return; }
    let due = false;
    nodes.forEach(el => {
      const left = Number(el.getAttribute('data-opens-at')) - Date.now();
      if (left <= 0) { due = true; el.textContent = 'Opening…'; return; }
      el.textContent = 'Coming soon in ' + fmtCountdown(left);
    });
    if (due) {
      clearInterval(_openCountdownTimer); _openCountdownTimer = null;
      // A phone clock that runs ahead of the server would make this fire again at once after every refresh (the server still says
      // "not open yet"): ask again at most every 30 s.
      const wait = 30000 - (Date.now() - _catalogRefreshedAt);
      if (wait > 0) { if (!_catalogRetryTimer) _catalogRetryTimer = setTimeout(() => { _catalogRetryTimer = null; refreshCatalogNow(); }, wait); }
      else refreshCatalogNow();
    }
  };
  tick();
  _openCountdownTimer = setInterval(tick, 1000);
}
var _catalogRefreshedAt = 0, _catalogRetryTimer = null;
async function refreshCatalogNow(){
  _catalogRefreshedAt = Date.now();
  const r = await api('/public/products');
  if (r.status === 'success') {
    STATE.products = r.products;
    if (STATE.page === 'home') paintHome();
  }
}

async function renderAssets(){
  const hadCache = Array.isArray(STATE.investments);
  if (hadCache) paintAssets();
  else paintAssets(true);   // the Total Earnings card at once, "Loading..." where the list will be
  const [pr, ir, ar] = await Promise.all([api('/public/products'), api('/investments'), api('/account')]);
  if (pr.status === 'success' && Array.isArray(pr.products)) STATE.products = pr.products;
  if (ir.status === 'success' && Array.isArray(ir.investments)) { STATE.investments = ir.investments; _investmentsLoadFailed = false; }
  else if (!hadCache) { STATE.investments = []; _investmentsLoadFailed = true; }
  if (ar.status === 'success') STATE.account = ar.account;
  if (STATE.page !== 'assets') return; // navigated away while awaiting
  paintAssets();
}
// One card per asset the member owns. Expiry is the purchase moment plus the
// asset's own cycle length (the same planStats() figure every progress bar uses).
function vOwnedCardHtml(inv){
  const st = planStats(inv);
  const p = (STATE.products || []).find(x => x.key === inv.tierKey) || {};
  const name = inv.tierLabel || p.name || 'Product';
  const startMs = st.createdMs;
  const endMs = startMs + st.total * 86400000;
  const two = ms => { const t = statementStampMs(ms).split(' '); return esc(t[0] || '') + '<br>' + esc(t[1] || ''); };
  const price = vMoney2(st.amount), dayly = vMoney2(st.daily), total = vMoney2(st.expected);
  return `
  <article class="mg-card mg-owned${inv.granted ? ' v-gift' : ''}">
    ${inv.granted ? '<i class="mg-gift">GIFT</i>' : ''}
    <div class="mg-card-top">
      <div class="mg-img">${mgPicture(Object.assign({}, p, { name }))}<div class="mg-band bot">${st.matured ? 'Completed' : 'Earning'}</div></div>
      <div class="mg-info">
        <h3>${esc(name)}</h3>
        <dl class="mg-rows">
          <div><dt>Price</dt><dd class="${mgFit(price).trim()}">${esc(price)}</dd></div>
          <div><dt>Days</dt><dd>${st.total}</dd></div>
          <div><dt>Daily</dt><dd class="g${mgFit(dayly)}">${esc(dayly)}</dd></div>
          <div class="tot"><dt>Total</dt><dd class="${mgFit(total).trim()}">${esc(total)}</dd></div>
        </dl>
      </div>
    </div>
    <div class="mg-dates"><div><span>Purchase</span><b>${two(startMs)}</b></div><div><span>Expire</span><b>${two(endMs)}</b></div></div>
  </article>`;
}
function statementStampMs(ms){
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function paintAssets(loading){
  applyProductImageOpacity();
  const a = STATE.account || {};
  // Running products first, newest first inside each group; the id is the last tie-break so the order never shuffles between refreshes.
  const owned = (STATE.investments || []).filter(i => i.status === 'active' || i.status === 'matured').sort((x, y) =>
    (x.status === 'active' ? 0 : 1) - (y.status === 'active' ? 0 : 1)
    || (new Date(y.createdAt || 0).getTime() || 0) - (new Date(x.createdAt || 0).getTime() || 0)
    || String(x.id || '').localeCompare(String(y.id || '')));
  const html = `
<div class="v-page mg-orders-page">
  <div class="mg-total"><span>Total Earnings</span><b id="incomeTotal">${esc(vMoney2(a.totalEarned))}</b></div>
  <div class="mg-orders" id="ownedAssets">${loading ? '<div class="v-empty mg-none">' + NAV_LOADER + '</div>' : owned.length ? owned.map(vOwnedCardHtml).join('') : _investmentsLoadFailed ? loadFailHtml('assets', 'mg-none') : '<div class="v-empty mg-none">No Orders</div>'}</div>
</div>`;
  $('pageHost').innerHTML = html;
}
// ── REFERRAL (own tab) ──
// Owner: "introduce a new nav icon just between my products and team, it is
// called referral, so here there will be that banner and referral link and
// instruction, so remove them from team and they come here to this tab."
// The address the member's INVITE LINK should carry -- a random one of his
// own country's short addresses, picked by the server. Asked for on every
// open of this screen, which is the point: owner "not login session changes
// rotation of a link but also clicking back there to that section of copying
// referral code, a server looks for another subdomain of that very country
// randomly." Going back to Referral picks again, so over time every one of
// the country's addresses gets used.
//
// The last pick is kept in STATE so a repeat open paints the rotated link
// immediately instead of flashing the address the member is browsing on.
// And a failure is silent by design: the link falls back to this origin,
// which is always a working invite.
function refreshShareHost(){ STATE.shareHost = ''; return Promise.resolve(); }
function shareOrigin(){ return location.origin; }
// ── MY ASSETS investment helpers ──
var _investmentsLoadFailed = false;
var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDay(value){
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value : String(value));
  if (isNaN(d.getTime())) return '—';
  // Owner: "even bought should carry the time bought at."
  // 24-hour, matching the ledger's own "23:21" and the plan countdown's
  // HH:MM:SS -- one clock across the app, and no am/pm to misread. The
  // getters are LOCAL, so a member in Kampala sees the moment they tapped
  // Buy, not the UTC instant the server wrote down.
  const t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear() + ' at ' + t;
}
// Deposit result marks, traced from the owner's two pictures (green tick badge, red cross badge).
var PAY_OK_ART = 'M316.5 694.5C292.9 692.3 268.0 687.5 246.5 680.9C233.9 677.0 210.0 668.0 210.0 667.1C210.0 666.7 209.1 666.4 207.9 666.3C204.1 666.0 170.5 647.8 156.5 638.4C-27.6 515.5 -53.7 256.8 102.4 101.7C239.3 -34.4 458.9 -33.7 595.3 103.3C601.7 109.8 607.0 115.4 607.0 115.8C607.0 116.2 603.0 118.9 598.1 121.7L589.2 126.8L578.3 116.1C417.3 -42.0 151.0 3.9 53.4 206.5C-40.2 400.9 78.7 632.9 291.0 669.9C317.8 674.6 360.4 676.1 383.5 673.2C488.4 659.9 575.7 603.8 628.7 515.5C647.9 483.6 665.7 436.2 669.6 406.9C670.0 404.2 670.7 402.0 671.2 402.0C671.7 402.0 671.8 401.5 671.5 401.0C671.2 400.4 671.7 394.2 672.6 387.2C674.8 371.7 675.1 327.9 673.2 312.5C667.0 263.5 652.8 220.9 628.9 180.8L622.9 170.6L630.3 163.2L637.8 155.9L640.3 159.2C648.7 170.3 665.9 204.8 673.9 226.1C683.0 250.6 691.8 286.1 692.3 300.2C692.4 303.4 692.8 306.0 693.1 306.0C693.4 306.0 694.2 312.9 694.8 321.2C711.2 535.8 530.6 714.0 316.5 694.5ZM334.0 645.3C299.1 642.8 272.5 637.4 244.5 627.0C113.2 578.2 33.9 444.8 53.5 305.7C71.8 175.7 174.8 72.5 305.0 53.6C394.8 40.5 489.0 70.3 551.9 131.6L563.5 142.9L550.0 152.2C481.4 199.6 411.8 266.8 340.6 354.0C334.1 362.0 328.4 368.9 328.0 369.3C327.6 369.8 302.7 357.8 272.6 342.8L217.9 315.5L208.7 315.5C194.1 315.5 183.9 321.6 177.3 334.2C174.8 338.9 174.5 340.6 174.5 349.0C174.5 363.3 175.4 364.8 203.0 395.0C267.6 465.8 311.7 506.8 335.4 518.1C354.3 527.1 376.0 523.7 390.3 509.7C398.6 501.6 396.2 505.5 444.8 418.5C484.5 347.4 528.4 280.5 565.5 234.5C579.5 217.1 600.1 194.0 601.6 194.0C604.3 194.0 619.1 223.3 626.9 244.4C667.7 353.9 641.1 475.0 558.1 558.1C518.1 598.1 471.5 624.4 417.7 637.5C393.3 643.4 356.0 646.9 334.0 645.3ZM350.0 501.6C330.0 495.8 285.8 455.4 218.1 381.1C198.2 359.3 194.0 353.7 194.0 349.3C194.0 346.0 198.2 338.9 201.1 337.5C208.4 333.7 208.5 333.8 273.0 366.0L332.9 396.0L343.2 383.2C432.1 272.6 514.0 196.0 596.0 146.8C615.1 135.3 618.5 133.7 620.8 134.9C625.9 137.6 624.8 139.5 607.2 157.5C534.7 231.3 488.3 297.9 404.5 448.5C384.6 484.2 383.1 486.8 378.4 492.6C371.7 500.8 360.0 504.5 350.0 501.6Z';
var PAY_OK_STATIC = '<svg viewBox="0 0 696 696" aria-hidden="true"><circle cx="348" cy="348" r="348" fill="#fff"/><path fill="#42af3c" fill-rule="evenodd" d="' + PAY_OK_ART + '"/></svg>';
var PAY_FAIL_STATIC = '<svg viewBox="0 0 313 313" aria-hidden="true"><circle cx="156.5" cy="156.5" r="156.5" fill="#ea2c2c"/><g fill="#fff"><rect x="81.5" y="141.5" width="150" height="30" rx="7" transform="rotate(45 156.5 156.5)"/><rect x="81.5" y="141.5" width="150" height="30" rx="7" transform="rotate(-45 156.5 156.5)"/></g></svg>';
// The owner's tick and cross DRAW THEMSELVES on the deposit result page (ring runs round clockwise, the disc pops in, the tick is written
// from its left end to its tip; the cross: the disc pops in, then one bar after the other). They are drawn on a <canvas> with plain
// compositing, NOT with CSS-animated SVG masks: animated masks are not repainted reliably by every phone's browser (iPhones, older Android
// browsers) and the mark simply did not appear there. A canvas works the same on every phone. Checked frame by frame against the SVG-mask
// version it replaced: 32 moments each, at most 0.011 % of the pixels differ (edge smoothing). The artwork is the owner's, untouched.
// When the animation ends (or can never run: no canvas, a hidden tab, an error) the mark is replaced by the plain finished SVG above,
// which has no masks and no animation, so the final picture is always correct. It plays even when the phone asks for reduced motion:
// it is a 1.5 second status mark, and the owner wants it everywhere.
var DR_GREEN = '#42af3c', DR_RED = '#ea2c2c';
var DR_TICK = [[212, 352], [362, 486], [625, 148]];
var DR_TICK_LEN = Math.sqrt(150 * 150 + 134 * 134) + Math.sqrt(263 * 263 + 338 * 338);
function drBezier(x1, y1, x2, y2) {            // CSS cubic-bezier(x1,y1,x2,y2) as a function of time 0..1
  var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return function (t) {
    if (t <= 0) return 0; if (t >= 1) return 1;
    var s = t, i, x, d;
    for (i = 0; i < 8; i++) { x = ((ax * s + bx) * s + cx) * s - t; d = (3 * ax * s + 2 * bx) * s + cx; if (Math.abs(x) < 1e-6 || Math.abs(d) < 1e-6) break; s -= x / d; }
    if (s < 0 || s > 1) { var lo = 0, hi = 1; s = t; for (i = 0; i < 24; i++) { x = ((ax * s + bx) * s + cx) * s; if (x < t) lo = s; else hi = s; s = (lo + hi) / 2; } }
    return ((ay * s + by) * s + cy) * s;
  };
}
var DR_E_RING = drBezier(.5, 0, .25, 1), DR_E_TICK = drBezier(.4, 0, .2, 1), DR_E_POP = drBezier(.2, .9, .3, 1.15), DR_E_OUT = drBezier(0, 0, .58, 1);
function drClamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function drTickPath(c) { c.beginPath(); c.moveTo(212, 352); c.lineTo(362, 486); c.lineTo(625, 148); }
function drCanvasKit(size) {
  function mk() { var c = document.createElement('canvas'); c.width = c.height = size; return c; }
  return { size: size, S: size / 696, L: mk(), M: mk(), G: mk() };
}
function drClear(c, size, S) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.setLineDash([]); c.clearRect(0, 0, size, size); c.setTransform(S, 0, 0, S, 0, 0); }
// the artwork, seen only through a mask drawn by `maskFn` (white = shown, destination-out = hidden)
function drMasked(kit, art, maskFn) {
  var L = kit.L.getContext('2d'), M = kit.M.getContext('2d');
  drClear(L, kit.size, kit.S); L.fillStyle = DR_GREEN; L.fill(art, 'evenodd');
  drClear(M, kit.size, kit.S); maskFn(M);
  L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'destination-in'; L.drawImage(kit.M, 0, 0); L.globalCompositeOperation = 'source-over';
  return kit.L;
}
function drOkFrame(kit, art, main, t) {
  var S = kit.S, size = kit.size, G = kit.G.getContext('2d'), L = kit.L.getContext('2d'), M = kit.M.getContext('2d');
  drClear(main, size, S); main.fillStyle = '#fff'; main.beginPath(); main.arc(348, 348, 348, 0, 6.2831853); main.fill();
  var p1 = DR_E_RING(drClamp(t / 600)), p2 = DR_E_TICK(drClamp((t - 1000) / 500)), q = DR_E_POP(drClamp((t - 550) / 400));
  // 1. the ring, clockwise from the top, with the tick's place left out
  if (p1 > 0) {
    var C = 6.2831853 * 345;
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.drawImage(drMasked(kit, art, function (m) {
      m.lineWidth = 110; m.strokeStyle = '#fff'; m.setLineDash([p1 * C, C * 3]); m.beginPath(); m.arc(348, 348, 345, -1.5707963, 4.712389, false); m.stroke(); m.setLineDash([]);
      m.globalCompositeOperation = 'destination-out'; m.lineWidth = 200; m.lineCap = 'round'; m.lineJoin = 'round'; drTickPath(m); m.stroke();
    }), 0, 0);
  }
  // 2. the disc pops in, its tick still hidden under a green cover that is wiped away along the tick
  if (t >= 550) {
    drClear(G, size, S);
    G.setTransform(1, 0, 0, 1, 0, 0);
    G.drawImage(drMasked(kit, art, function (m) { m.fillStyle = '#fff'; m.beginPath(); m.arc(348, 348, 300, 0, 6.2831853); m.fill(); }), 0, 0);
    drClear(L, size, S); L.save(); L.beginPath(); L.arc(348, 348, 296, 0, 6.2831853); L.clip();
    L.strokeStyle = DR_GREEN; L.lineWidth = 200; L.lineCap = 'round'; L.lineJoin = 'round'; drTickPath(L); L.stroke(); L.restore();
    drClear(M, size, S); M.fillStyle = '#fff'; M.fillRect(0, 0, 696, 696);
    if (p2 > 0) { M.globalCompositeOperation = 'destination-out'; M.lineWidth = 210; M.lineCap = 'round'; M.lineJoin = 'round'; M.setLineDash([p2 * DR_TICK_LEN, DR_TICK_LEN * 3]); drTickPath(M); M.stroke(); M.setLineDash([]); }
    L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'destination-in'; L.drawImage(kit.M, 0, 0); L.globalCompositeOperation = 'source-over';
    G.setTransform(1, 0, 0, 1, 0, 0); G.drawImage(kit.L, 0, 0);
    main.setTransform(S, 0, 0, S, 0, 0); main.save(); main.globalAlpha = drClamp(q); main.translate(348, 348); main.scale(.6 + .4 * q, .6 + .4 * q); main.translate(-348, -348);
    main.drawImage(kit.G, 0, 0, 696, 696); main.restore();
  }
  // 3. the tip of the tick that leaves the disc
  if (p2 > 0) {
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.drawImage(drMasked(kit, art, function (m) {
      m.strokeStyle = '#fff'; m.lineWidth = 210; m.lineCap = 'round'; m.lineJoin = 'round'; m.setLineDash([p2 * DR_TICK_LEN, DR_TICK_LEN * 3]); drTickPath(m); m.stroke(); m.setLineDash([]);
      m.globalCompositeOperation = 'destination-out'; m.beginPath(); m.arc(348, 348, 297, 0, 6.2831853); m.fill();
    }), 0, 0);
  }
}
function drBar(c, deg) {                         // the owner's white bar: 150 x 30, corner radius 7, turned about the disc's centre
  c.save(); c.translate(156.5, 156.5); c.rotate(deg * Math.PI / 180); c.translate(-156.5, -156.5);
  var x = 81.5, y = 141.5, w = 150, h = 30, r = 7; c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r); c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r); c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath(); c.fillStyle = '#fff'; c.fill(); c.restore();
}
function drFailFrame(kit, main, t) {
  var size = kit.size, S = kit.S, L = kit.L.getContext('2d'), M = kit.M.getContext('2d');
  drClear(main, size, S);
  var q = DR_E_POP(drClamp(t / 400));
  main.save(); main.globalAlpha = drClamp(q); main.translate(156.5, 156.5); main.scale(.6 + .4 * q, .6 + .4 * q); main.translate(-156.5, -156.5);
  main.fillStyle = DR_RED; main.beginPath(); main.arc(156.5, 156.5, 156.5, 0, 6.2831853); main.fill(); main.restore();
  var bars = [[45, 95, 95, 218, 218, drClamp((t - 450) / 260)], [-45, 95, 218, 218, 95, drClamp((t - 720) / 260)]];
  for (var i = 0; i < 2; i++) {
    var b = bars[i], p = DR_E_OUT(b[5]); if (p <= 0) continue;
    drClear(L, size, S); drBar(L, b[0]);
    drClear(M, size, S); M.strokeStyle = '#fff'; M.lineWidth = 46; var Ln = Math.sqrt((b[3] - b[1]) * (b[3] - b[1]) + (b[4] - b[2]) * (b[4] - b[2])); M.setLineDash([p * Ln, Ln * 3]); M.beginPath(); M.moveTo(b[1], b[2]); M.lineTo(b[3], b[4]); M.stroke(); M.setLineDash([]);
    L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'destination-in'; L.drawImage(kit.M, 0, 0); L.globalCompositeOperation = 'source-over';
    main.setTransform(1, 0, 0, 1, 0, 0); main.drawImage(kit.L, 0, 0);
  }
}
var _drToken = 0;
// A failed payment: once the cross has been drawn it shakes and the phone buzzes (once per drawing).
function failShake(box, tok){
  if (tok !== _drToken || !box.classList) return;
  box.classList.remove('dep-shake'); void box.offsetWidth; box.classList.add('dep-shake');
  try { if (navigator.vibrate) navigator.vibrate([90, 50, 90, 50, 160]); } catch (e) {}
}
function playStatusIcon(box, kind){
  var tok = ++_drToken, ok = kind === 'ok', still = ok ? PAY_OK_STATIC : PAY_FAIL_STATIC, END = ok ? 1560 : 1000, shook = false;
  box.classList.remove('dep-shake');
  function drawn(){ if (!ok && !shook) { shook = true; failShake(box, tok); } }
  function finish(){ if (tok === _drToken && box.firstChild && box.firstChild.tagName === 'CANVAS') box.innerHTML = still; drawn(); }
  try {
    if (typeof Path2D !== 'function') { box.innerHTML = still; drawn(); return; }
    var dpr = Math.min(window.devicePixelRatio || 1, 3), size = Math.round(120 * dpr);   // the mark is 120 CSS pixels (see .dep-status-icon>canvas)
    var cv = document.createElement('canvas'); cv.width = cv.height = size; cv.className = 'dr-canvas'; cv.setAttribute('aria-hidden', 'true');
    var main = cv.getContext('2d'), kit = drCanvasKit(size), art = ok ? new Path2D(PAY_OK_ART) : null;
    if (!ok) kit.S = size / 313;
    if (ok) drOkFrame(kit, art, main, 0); else drFailFrame(kit, main, 0);
    box.innerHTML = ''; box.appendChild(cv);
    var t0 = null;
    var step = function(now){
      if (tok !== _drToken || cv.parentNode !== box) return;
      if (t0 === null) t0 = now;
      var t = now - t0;
      if (t >= END) { finish(); return; }
      try { if (ok) drOkFrame(kit, art, main, t); else drFailFrame(kit, main, t); } catch (e) { finish(); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(finish, END + 1500);
  } catch (e) { box.innerHTML = still; drawn(); }
}
// Waiting for the payment: a dot travels from the phone to the wallet (nothing rotates).
var DEPOSIT_POLL_FLOW = '<div class="dep-flow" role="img" aria-label="Processing payment">'
  + '<span class="dep-flow-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.5 18.5h3"/></svg></span>'
  + '<span class="dep-flow-track"><i></i><i></i><i></i><i></i></span>'
  + '<span class="dep-flow-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V6.8A2.3 2.3 0 0 1 6.3 4.5H17v3.5"/><rect x="3" y="7.5" width="18" height="12.5" rx="2.6"/><path d="M16 13.8h5"/></svg></span>'
  + '</div>';
// Every figure this screen shows about one plan, worked out in one place so
// the summary band and the row can never disagree.
function planStats(inv){
  // The CYCLE LENGTH -- the "of 30" in "Day 4 of 30", and what daysLeft counts
  // down from. /invest/create always stamps payoutsTotal onto the investment,
  // so that is the answer for anything bought through the app -- but a document
  // written before that field existed has none, and a bare `|| 150` would then
  // measure a plan against 150 days regardless of the cycle it was actually
  // sold on: a 30-day plan four days in would say "Day 4 of 150" and claim 146
  // days left. Fall back through the product's own cycle and the platform
  // default before resorting to a constant.
  const prod = (STATE.products || []).find(p => p.key === inv.tierKey);
  const total = Number(inv.payoutsTotal)
    || (prod && Number(prod.cycle))
    || Number((STATE.settings || {}).cycleDays)
    || 150;
  const made = Math.min(Number(inv.payoutsMade) || 0, total);
  const expected = Number(inv.expectedReturn) || 0;
  const earned = Number(inv.paidOut) || 0;
  const matured = inv.status === 'matured' || made >= total;
  return {
    total, made, expected, earned, matured,
    amount: Number(inv.amount) || 0,
    daily: Number(inv.dailyPayout) || 0,
    // What is still to come. Clamped at zero so a plan that over-paid by a
    // rounding shilling never shows a negative "left to earn".
    remaining: Math.max(0, expected - earned),
    daysLeft: Math.max(0, total - made),
    createdMs: new Date(inv.createdAt || Date.now()).getTime(),
  };
}
function myAssetRowHtml(inv){
  const st = planStats(inv);
  const p = (STATE.products || []).find(x => x.key === inv.tierKey) || {};
  const name = inv.tierLabel || p.name || 'Product';
  const initial = esc(String(name || '?').trim()[0] || '?');
  const thumb = p.image
    ? `<img src="${esc(p.image)}" alt="" onerror="this.outerHTML='&lt;span&gt;${initial}&lt;/span&gt;'">`
    : `<span>${initial}</span>`;
  const progress = st.total > 0 ? Math.max(0, Math.min(100, (st.made / st.total) * 100)) : 0;
  return `
  <div class="my-asset-row ${st.matured ? 'done' : ''}">
    <div class="mar-head">
      <div class="mar-thumb">${thumb}</div>
      <div class="mar-id">
        <div class="mar-name">${esc(name)}</div>
        <div class="mar-date">${esc(fmtDay(inv.createdAt))}</div>
      </div>
      <span class="mar-status">${st.matured ? 'Completed' : 'Ongoing'}</span>
    </div>
    <div class="mar-values">
      <div><span>Invested</span><b class="mono">${fmtUGXCents(st.amount)}</b></div>
      <div><span>Earned</span><b class="mono">${fmtUGXCents(st.earned)}</b></div>
      <div><span>${st.matured ? 'Return' : 'Daily'}</span><b class="mono">${fmtUGXCents(st.matured ? st.expected : st.daily)}</b></div>
    </div>
    <div class="mar-progress"><i style="width:${progress}%"></i></div>
    <div class="mar-foot">
      <span>${st.matured ? 'Finished' : `Day ${st.made} of ${st.total}`}</span>
      <span>${st.matured ? fmtUGXCents(st.expected) + ' paid' : fmtUGXCents(st.remaining) + ' remaining'}</span>
    </div>
  </div>`;
}
function myAssetsInnerHtml(){
  const investments = (STATE.investments || []).filter(i => i.status === 'active' || i.status === 'matured');
  if (!Array.isArray(STATE.investments) && _investmentsLoadFailed) {
    return '<div class="my-assets-empty">Could not load your products.</div>';
  }
  if (!investments.length) return '<div class="my-assets-empty">No investments yet. Browse Products to get started.</div>';
  return '<div class="my-assets-list">' + investments.map(myAssetRowHtml).join('') + '</div>';
}
function paintMyAssetsInner(){
  const box = document.getElementById('myAssetsInner');
  if (!box) return;
  box.innerHTML = myAssetsInnerHtml();
}
// Live-ticking "Next cashback in HH:MM:SS" on each active plan card. Cleared
// whenever the page changes away from My Products so it never keeps ticking
// (and leaking a timer) in the background.
// ── TEAM ──
// subagent-audit-caught: same stale-deferred-repaint class Round 59 fixed
// for Withdraw/Withdrawal Accounts, here on Team -- tapping
// a not-yet-cached level then quickly tapping back to an already-cached
// one used to let the first tap's slow fetch land later and silently
// replace the visible (different) level's member list.
var _activeTeamLevel = null;
var _teamMembersAt = {};            // when each level's list was last fetched
var _teamMembersFailed = {};        // a level whose last fetch failed (shows a retry line, never "no members")
var TEAM_LIST_FRESH_MS = 15000;
// Shows the level's list at once when one is already held, then (if it is older than a few seconds
// or was never fetched) fetches a fresh one and repaints it. A failed fetch keeps whatever list was
// on screen and is never stored as an empty list: that used to read "No members at this level yet"
// for the rest of the session after one dropped connection.
window.switchTeamLevel = async function(level){
  _activeTeamLevel = level;
  document.querySelectorAll('.mg-lv').forEach(el => el.classList.toggle('on', Number(el.dataset.level) === level));
  const held = !!STATE.teamMembers[level];
  if (held) renderTeamMembers(level);
  else { const box = $('teamMembersBox'); if (box) box.innerHTML = teamLoadingHtml(); }
  if (held && Date.now() - (_teamMembersAt[level] || 0) < TEAM_LIST_FRESH_MS) return;
  const r = await api('/team/members?level=' + level);
  if (r.status === 'success') { STATE.teamMembers[level] = r.members; _teamMembersAt[level] = Date.now(); _teamMembersFailed[level] = false; }
  else _teamMembersFailed[level] = true;
  if (_activeTeamLevel === level && STATE.page === 'network') renderTeamMembers(level);
};
// The "Loading . . ." word, centred, while a list is in flight.
function teamLoadingHtml(){ return '<div class="list-loading">' + NAV_LOADER + '</div>'; }
// The small "Loading..." word shown inside a page while its data arrives: plain grey text, standing still, as on the owner's screens.
var NAV_LOADER = '<span class="mg-loadtxt">Loading...</span>';
function maskPhone(phone){
  // "706****1455": the first three and last four digits of the local number
  // (country code and leading zero dropped), enough to recognise your own
  // referral and not a usable number.
  let d = String(phone||'').replace(/\D/g,'');
  const dc = dial();
  if (d.slice(0, dc.length) === dc) d = d.slice(dc.length);
  d = d.replace(/^0+/, '');
  if (d.length < 7) return phone || '';
  return d.slice(0, 3) + '****' + d.slice(-4);
}
// The exact date and time a member joined, as his mockup prints it:
// "07/09/2026 01:21" -- day/month/year and a 24-hour clock.
//
// Owner: "l told you removed joined one day ago, l need that exactly what
// you're seeing." This replaced a timeAgo() that answered "1 day ago" /
// "2 weeks ago". Relative wording reads more naturally in most places, but
// not in a downline list: it is the one screen where a member wants to know
// WHEN somebody joined, to line it up against a commission they were paid,
// and "2 weeks ago" cannot be lined up against anything.
//
// Built from the local date parts rather than toLocaleString(): the format
// has to be the one in his mockup on every phone, and a locale string is
// whatever the handset is set to -- an en-US phone would print 9/7/2026 and
// silently swap the day and the month on a screen about money.
function joinedStamp(ts){
  if (!ts) return '';
  const ms = typeof ts === 'object' && ts.seconds ? ts.seconds*1000 : new Date(ts).getTime();
  if (!ms || isNaN(ms)) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderTeamMembers(level){
  const members = STATE.teamMembers[level] || [];
  const box = $('teamMembersBox');
  if (!box) return;
  const cnt = $('mgLvCount'); if (cnt) cnt.textContent = String(members.length || (((STATE.teamStats || {}).team || {})['l' + level]) || 0);
  const ttl = $('mgLvTitle'); if (ttl) ttl.textContent = 'Level ' + level;
  if (!STATE.teamMembers[level] && _teamMembersFailed[level]) { box.innerHTML = '<div class="mg-nomem" onclick="switchTeamLevel(' + level + ')">Could not load your team</div>'; return; }
  if (!members.length) { box.innerHTML = '<div class="mg-nomem">No Members</div>'; return; }
  box.innerHTML = members.map(m => `
  <div class="mg-member">
    <div class="mg-member-top"><span>${esc(m.phoneMasked || maskPhone(m.phone))}</span><b>${esc(vMoney2(m.invested))}</b></div>
    <div class="mg-member-join">Joined ${esc(joinedStamp(m.createdAt))}</div>
  </div>`).join('');
}
async function renderNetwork(){
  const hadCache = !!STATE.teamStats;
  if (hadCache) paintNetwork();
  else paintNetwork(true);   // the page at once with "..." in the figures and "Loading..." in the list
  const r = await api('/team/stats');
  if (r.status === 'success') STATE.teamStats = r;
  else if (!hadCache) STATE.teamStats = { referralCode:'', commRates:{l1:0,l2:0,l3:0}, team:{l1:0,l2:0,l3:0}, totalTeam:0, teamCommission:0, teamDeposits:0, levelCommission:{l1:0,l2:0,l3:0} };
  if (STATE.page !== 'network') return;
  paintNetwork();
}
function mgNum(v){ const n = Number(v) || 0; return numGroup(n, Math.round(n * 100) % 100 !== 0); }
function paintNetwork(loading){
  const t = (loading ? null : STATE.teamStats) || { referralCode:'', commRates:{}, team:{}, totalTeam:0, teamDeposits:0, levelCommission:{}, levelPurchase:{} };
  const rates = t.commRates || {}, team = t.team || {}, lc = t.levelCommission || {}, lp = t.levelPurchase || {};
  const level = _activeTeamLevel || 1;
  _activeTeamLevel = level;
  const cards = [1, 2, 3].map(n => `
    <button type="button" class="mg-lv${level === n ? ' on' : ''}" data-level="${n}" onclick="switchTeamLevel(${n})">
      <span class="mg-lv-h"><em>LV:${n}</em><b>${rates['l' + n] != null ? rates['l' + n] : 0}%</b></span>
      <span class="mg-lv-b">
        <span class="c1"><b>${loading ? '...' : esc(mgNum(lc['l' + n]))}</b><small>Commission</small></span>
        <span class="c2"><b>${loading ? '...' : esc(mgNum(lp['l' + n]))}</b><small>Purchase</small></span>
        <span class="c3"><b>${loading ? '...' : Number(team['l' + n]) || 0}</b><small>Members</small></span>
      </span>
    </button>`).join('');
  const html = `
<div class="v-page mg-team">
  <div class="mg-tcard">
    <i class="mg-ring r1"></i><i class="mg-ring r2"></i>
    <div class="mg-tcard-top"><span class="mg-tic">${MGI.nTeam}</span><span class="mg-tlbl">Total Team</span><b class="mg-tnum">${Number(t.totalTeam) || 0}</b></div>
    <div class="mg-tline"></div>
    <div class="mg-tmoney">${esc(vMoney2(t.teamDeposits))}</div>
    <div class="mg-tcap">Purchase</div>
  </div>
  <div class="mg-h2"><h2>Commission Rate</h2><span>${esc(cur())}</span></div>
  <div class="mg-lvs">${cards}</div>
  <div class="mg-h3"><h3 id="mgLvTitle">Level ${level}</h3><span><b id="mgLvCount">${Number(team['l' + level]) || 0}</b> Members</span></div>
  <div id="teamMembersBox">${loading ? '<div class="mg-nomem">' + NAV_LOADER + '</div>' : ''}</div>
</div>`;
  $('pageHost').innerHTML = html;
  if (!loading) switchTeamLevel(level); // shows a held list at once and refreshes it if it is old
}

// ── PROMOTION (own tab): banner, share link, share buttons, invitation reward ──
async function renderPromo(){
  const hadCache = !!STATE.teamStats;
  if (hadCache) paintPromo();
  else $('pageHost').innerHTML = '<div style="min-height:55vh;display:flex;align-items:center;justify-content:center;">' + NAV_LOADER + '</div>';
  const r = await api('/team/stats');
  if (r.status === 'success') STATE.teamStats = r;
  else if (!hadCache) STATE.teamStats = { referralCode:'', commRates:{l1:0,l2:0,l3:0}, team:{l1:0,l2:0,l3:0}, totalTeam:0, teamDeposits:0, levelCommission:{}, levelPurchase:{} };
  if (STATE.page !== 'promo') return;
  paintPromo();
}
function promoLink(){
  const t = STATE.teamStats || {};
  const code = (STATE.account || {}).referralCode || t.referralCode || '';
  return code ? `${shareOrigin()}/share.html?v=${Math.floor(Date.now() / 1000)}&code=${encodeURIComponent(code)}` : '';
}
var _promoLink = '';
function paintPromo(){
  const t = STATE.teamStats || {};
  const rates = t.commRates || {};
  _promoLink = promoLink();
  const share = (cls, name, icon, key) => `<button type="button" class="mg-sh ${cls}" onclick="shareTo('${key}')"><span>${icon}</span><small>${name}</small></button>`;
  const html = `
<div class="v-page mg-promo">
  <div class="mg-pbanner">${(STATE.promoBanner || STATE.homeBanner) ? `<img src="${esc(STATE.promoBanner || STATE.homeBanner)}" alt="" onerror="this.style.display='none'">` : ''}</div>
  <div class="mg-pcard">
    <div class="mg-plabel">Share URL</div>
    <div class="mg-pbox"><span class="mg-purl">${esc(_promoLink || '—')}</span><button type="button" class="mg-pcopy" data-copy-group="promo" onclick="copyText(_promoLink)"><i>${MGI.copyMini}</i><b>Copy</b></button></div>
    <div class="mg-shares">
      ${share('tg', 'Telegram', MGI.plane, 'telegram')}${share('wa', 'WhatsApp', MGI.whatsapp, 'whatsapp')}${share('fb', 'Facebook', MGI.facebook, 'facebook')}${share('xx', 'X', MGI.xmark, 'x')}${share('tt', 'TikTok', MGI.tiktok, 'tiktok')}
    </div>
  </div>
  <div class="mg-pcard mg-reward">
    <h3><i></i>Invitation Reward</h3>
    <p>Strive to grow your team so you can earn commissions and daily salary rewards as soon as possible.<br>Level 1 = ${rates.l1 != null ? rates.l1 : 0}%<br>Level 2 = ${rates.l2 != null ? rates.l2 : 0}%<br>Level 3 = ${rates.l3 != null ? rates.l3 : 0}%</p>
  </div>
</div>`;
  $('pageHost').innerHTML = html;
}
window.shareTo = function(where){
  if (!_promoLink) return notify('Your invite link is not ready yet.');
  if (!rapidTapGuardOk('share:' + where)) return;
  const msg = 'Join me on ' + brandName() + ': ' + _promoLink;
  const u = encodeURIComponent(_promoLink), m = encodeURIComponent(msg);
  const urls = {
    telegram: 'https://t.me/share/url?url=' + u + '&text=' + encodeURIComponent('Join me on ' + brandName()),
    whatsapp: 'https://wa.me/?text=' + m,
    facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
    x: 'https://twitter.com/intent/tweet?text=' + m,
    tiktok: 'https://www.tiktok.com/',
  };
  // TikTok has no way to hand it a link, so the link is copied first and TikTok opens for the member to paste it.
  if (where === 'tiktok' && navigator.clipboard) navigator.clipboard.writeText(_promoLink).catch(() => {});
  window.open(urls[where], '_blank', 'noopener');
};

// ── SALARY (own tab) ──
var _salaryBusy = false;
var MG_SALARY_COLORS = ['#ffc72a', '#00a650', '#e30711', '#046a38', '#ffd60a', '#ffc72a', '#00a650'];
async function renderSalary(){
  const had = !!STATE.salary;
  if (had) paintSalary();
  else $('pageHost').innerHTML = '<div style="min-height:55vh;display:flex;align-items:center;justify-content:center;">' + NAV_LOADER + '</div>';
  const r = await api('/salary/status');
  if (r.status === 'success') STATE.salary = r;
  if (STATE.page !== 'salary') return;
  paintSalary();
}
function paintSalary(){
  const S = STATE.salary;
  if (!S) { $('pageHost').innerHTML = '<div class="v-page"><div class="v-empty" onclick="renderSalary()">Could not load. Tap to try again.</div></div>'; return; }
  const tiers = S.tiers || [];
  const total = Number(S.total) || 0;
  const days = Number(S.accruedDays) || 0;
  const money = n => cur() + ' ' + numGroup(n, false);
  const lowest = tiers[0];
  const topLine = days > 0 ? 'Next claim: ' + money(S.nextReward)
    : lowest && total < lowest.target ? 'Need ' + money(lowest.target - total) + ' more to claim'
    : 'Come back tomorrow for your next day of wages';
  const cards = tiers.map((tier, i) => {
    const need = Math.max(0, tier.target - total);
    const pct = tier.target > 0 ? Math.min(100, Math.floor(total / tier.target * 100)) : 0;
    const open = tier.reached;
    const btn = !open ? `<button type="button" class="mg-sbtn" onclick="notify('Need ${money(need)} more to claim')">Locked</button>`
      : days > 0 ? '<button type="button" class="mg-sbtn go" onclick="claimSalary(this)">Claim</button>'
      : '<button type="button" class="mg-sbtn" onclick="notify(\'No wages to claim yet. Come back tomorrow.\')">Claimed</button>';
    return `
    <div class="mg-stier" style="--strip:${MG_SALARY_COLORS[i % MG_SALARY_COLORS.length]}">
      <div class="mg-sl">
        <div class="mg-s1"><b>Reach ${money(tier.target)}</b><span>claimable reward within</span><em>Reward ${money(tier.reward)}</em></div>
        <div class="mg-sbar"><i style="width:${pct}%"></i></div>
        <div class="mg-sneed">${open ? 'Reached' : 'Need ' + money(need) + ' more to claim'}</div>
      </div>
      ${btn}
    </div>`;
  }).join('');
  $('pageHost').innerHTML = `
<div class="v-page mg-salary">
  <div class="mg-shead"><h1>Daily Salary Standard</h1><p>Invite Friends · Grow Your Team · Claim Daily Rewards</p><div class="mg-spill">Team Total Consumption: ${esc(money(total))}</div></div>
  <div class="mg-sacc"><div>Accrued wages: <b>${days}</b> day(s)</div><small>${esc(topLine)}</small></div>
  ${cards || '<div class="v-empty">Salary is not available yet.</div>'}
  <div class="mg-rules"><b>Daily wage rules:</b>
    <ol><li>Each calendar day after reaching the lowest tier accrues one share of salary. Unclaimed days keep accruing; each claim pays the earliest unclaimed day.</li>
    <li>Each accrued day is paid at the tier reached on that day. Tap a claimable tier to collect your wages day by day.</li></ol></div>
</div>`;
}
window.claimSalary = async function(btn){
  if (_salaryBusy) return;
  _salaryBusy = true; if (btn) btn.disabled = true;
  const r = await post('/salary/claim', {});
  _salaryBusy = false;
  if (r && r.stale) return;
  const fresh = await api('/salary/status');
  if (fresh.status === 'success') STATE.salary = fresh;
  if (STATE.page === 'salary') paintSalary();
  if (r && r.status === 'success') {
    if (STATE.account) STATE.account.walletBalance = r.walletBalance;
    refreshTransactionsCache().catch(() => {});
    return notify(fmtUGX(r.amount) + ' added to your wallet');
  }
  notify((r && r.message) || 'Could not claim the salary right now');
};
// ── MISSION CENTER — REMOVED ──
// Owner: "remove mission center". The screen, both claim flows and the
// /mission/status fetch that used to run on every boot are gone, and so are
// the three server routes behind them (see server.js) -- two of those
// credited money, so unlinking the button alone would have left a removed
// feature still paying out to anyone who knew the URL.
//
// What deliberately STAYS: the mission_salary / mission_deposit_reward
// labels in TX_TYPE_LABELS. Members who claimed these were really paid, and
// their Records must keep reading properly; dropping the labels would show
// old rows as raw type keys.

// Real bug fixed: these had no guard against firing more than once per tap
// -- unlike every other button in this app (witSubmitBtn, bankSaveBtn,
// etc.) neither disables itself, so a double-registered
// tap (common on touchscreens -- synthetic mouse+touch click events, or an
// actual accidental double-tap) called navigator.share()/clipboard.writeText
// again immediately, which is what the owner saw as "many share requests."
// Keyed by action so tapping copy-code then copy-link a moment apart still
// both work -- only truly rapid repeats of the SAME action are dropped.
const _lastTapAt = {};
function rapidTapGuardOk(key){
  const now = Date.now();
  if (now - (_lastTapAt[key] || 0) < 700) return false;
  _lastTapAt[key] = now;
  return true;
}
// Owner: "think you can see closely how the copied link is, so the copy turns
// to tick."
// Copying confirms ITSELF, on the control that was tapped: the copy icon
// becomes a tick and a labelled button's text becomes "Copied", both reverting
// after a moment. Nothing interrupts.
//
// This is the right answer for copy specifically, and it replaces the alert
// card that copy briefly used. An alert has to be dismissed, and on the
// Referral screen -- where the whole point is to copy and get straight out to
// WhatsApp -- an OK tap between the member and sharing is friction for a result
// they can already see. Every other message in the app still uses the card;
// copy is the one action whose outcome is visible where it happened.
// The owner's own clipboard artwork, replacing the hand-drawn SVG: "l want the
// copy SVG icon to be replaced by that image l made myself." Cut out of the
// JPEG he sent by flood-filling the white PAGE inward from the border -- a
// global white->transparent would have punched holes in the clipboard's own
// white paper, the same trap the spin-wheel cutout hit. Height is set in CSS
// (.url-row .copy-ic img), not here, so the tile and the art stay in step.
var COPY_TICK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.2 5.2L20 7"/></svg>';
function flashCopiedOne(btn){
  if (!btn) return;
  const isIconBtn = btn.classList.contains('copy-ic') || btn.classList.contains('mp-copybtn');
  // A copy while the flash is STILL RUNNING restarts it rather than being
  // ignored. It used to return early, which was harmless when each control
  // flashed alone but is a real fault now they are grouped: tapping the icon
  // ~1.5s after the button did nothing, and the tick then disappeared 300ms
  // later on the FIRST tap's timer -- so the second tap read as having failed.
  // The original content is kept from the first flash in _copyBefore, so a
  // restart can never capture 'Copied' (or the tick) as the thing to restore
  // and leave the control permanently stuck on it.
  if (btn._copyRevert) clearTimeout(btn._copyRevert);
  else btn._copyBefore = btn.innerHTML;
  btn.innerHTML = isIconBtn ? COPY_TICK : btn.classList.contains('mg-pcopy') ? '<i>' + MGI.tickMini + '</i><b>Copied</b>' : 'Copied';
  btn.classList.add('copied');
  btn._copyRevert = setTimeout(() => {
    btn.innerHTML = btn._copyBefore;
    btn.classList.remove('copied');
    btn._copyRevert = null;
  }, 1800);
}
// Owner: "why when l copy link with the other icon and shows tick, the button
// which says copy invite link doesn't show copied, yet l wanted it to say it in
// all cases whether clicking copy icon or button."
//
// Two controls, ONE action: the icon and the labelled button on Referral copy
// the same link, so whichever is tapped, both have to acknowledge it. Only the
// tapped one used to, which reads as the other one not having worked.
//
// Grouped by an explicit `data-copy-group`, NOT by "flash everything nearby":
// copyText() is shared with the manual-pay screen's own copy buttons (account
// number, account name), which sit in one container and copy DIFFERENT text --
// a proximity rule would tick the account name when someone copied the number.
// Only controls that copy the same thing carry the same group.
function flashCopied(btn){
  const group = btn && btn.getAttribute && btn.getAttribute('data-copy-group');
  if (!group) return flashCopiedOne(btn);
  const all = document.querySelectorAll('[data-copy-group="' + group + '"]');
  for (let i = 0; i < all.length; i++) flashCopiedOne(all[i]);
}
function writeClipboard(text, btn){
  if (!navigator.clipboard) return notify('Could not copy');
  navigator.clipboard.writeText(text)
    .then(() => flashCopied(btn))
    // A failure has nothing visible to show for itself, so it still needs
    // saying -- and that is exactly what the alert card is for.
    .catch(() => notify('Could not copy'));
}
// The button is taken from the event rather than passed in by every call site:
// the markup already routes through onclick, so `this` is the control that was
// tapped, and no template needs editing to opt in.
window.copyText = function(text){
  if (!text || !rapidTapGuardOk('copy:' + text)) return;
  const btn = (typeof event !== 'undefined' && event && event.currentTarget)
    ? event.currentTarget : null;
  writeClipboard(text, btn);
};
// shareReferral() was here and is gone. Owner: "copying invite link just
// copys not sharing" -- the button is labelled COPY INVITE LINK and was
// opening the phone's share sheet instead, so it now goes through copyText()
// like the small copy icon directly above it.
//
// It was also broken in a way the label hid: the button called
// shareReferral() with NO argument, so the shared message read "...sign up
// with my link: undefined". Nobody would have noticed from inside the app --
// the wrong text only appeared after it had already been sent to someone.

// Rebuilt to the owner's Account mockup -- a profile card over a refinery
// photo (the account screen's own 'profilecard' image slot was removed by
// the owner -- see server.js's MINT_IMAGE_SLOTS comment -- so the card
// falls back to the shared auth-hero photo via .acct-card's own
// --acct-card-image default) and a plain row list with coloured-circle SVG
// icons replacing the old settings list's coloured squares + Mint raster
// PNGs.
//
// Deliberately NOT built into this round: a per-member profile PHOTO upload
// (the mockup's camera badge) and phone-number editing (the mockup's pencil
// icon) -- both are real new backend features (per-member file storage; a
// changed phone re-derives the synthetic auth email, see phoneToEmail()'s
// own "must match server.js exactly" warning), not a visual swap, and
// nothing this session was asked to build them. The avatar here is a plain
// placeholder glyph until that's actually scoped. Same reasoning for the
// mockup's "Membership Level / VIP 1" card -- there is no tier system
// anywhere in this codebase (thresholds, benefits, what "View Benefits"
// would even show), so it is not invented here; flagged in CLAUDE.md.
function mgSetRow(tile, icon, title, sub, onclick, badge){
  return `<button type="button" class="mg-row" onclick="${onclick}">
    <span class="mg-tile ${tile}">${icon}${badge ? `<em id="msgBadge"${mgUnread() ? '' : ' style="display:none"'}>${mgUnread()}</em>` : ''}</span>
    <span class="mg-row-t"><b>${title}</b><small>${sub}</small></span>
    <span class="mg-row-c">${MGI.chev}</span>
  </button>`;
}
async function renderAccount(){
  const a = STATE.account || {};
  const avatar = STATE.profileLogo
    ? `<img src="${esc(STATE.profileLogo)}" alt="" onerror="this.style.display='none'">`
    : `<span class="mg-av-fb">${MGI.nProfile}</span>`;
  const phone = localDigits(a.phone) ? '0' + localDigits(a.phone).replace(/^0+/, '') : (walletLocalPhone(a.phone) || formatPhoneDisplay(a.phone));
  const html = `
<div class="v-page mg-my">
  <div class="mg-me">
    <div class="mg-me-top">
      <div class="mg-av">${avatar}</div>
      <div class="mg-me-id"><b>ID: ${esc(a.publicId != null ? a.publicId : '')}</b><span>${esc(phone)}</span></div>
    </div>
    <div class="mg-me-line"></div>
    <div class="mg-me-bal" id="myBalance">${esc(vMoney2(a.walletBalance))}</div>
  </div>
  <div class="mg-me-btns">
    <button type="button" class="dep" onclick="openDepositSheet()">Deposit</button>
    <button type="button" class="wit" onclick="openWithdrawSheet()">Withdraw</button>
  </div>
  <div class="mg-sec"><span class="bar"></span><h2>Settings</h2><i></i></div>
  <div class="mg-set">
    ${mgSetRow('t1', MGI.tDownload, 'Download APP', 'Get the mobile app', 'openDownloadPage()')}
    ${mgSetRow('t2', MGI.tCard, 'Wallet', 'Manage your wallet', 'openWalletSheet()')}
    ${mgSetRow('t3', MGI.tWallet, 'Balance Record', 'Transaction history', "openTransactionStatement('all')")}
    ${mgSetRow('t4', MGI.tChat, 'Messages', 'Notifications &amp; mail', 'openMessagesSheet()', true)}
    ${mgSetRow('t5', MGI.tLock, 'Login Password', 'Change login PIN', 'openChangeLoginPasswordSheet()')}
    ${mgSetRow('t6', MGI.tKey, 'Trade Password', 'Change trade PIN', 'openChangeTradePasswordSheet()')}
  </div>
  <button type="button" class="mg-logout" onclick="doLogout()"><span>${MGI.door}</span>Log Out</button>
</div>`;
  $('pageHost').innerHTML = html;
  // The unread count on the Messages tile comes from the inbox; ask for it once per visit (never blocks the paint).
  api('/messages').then(r => { if (r.status === 'success') { STATE.messages = r.messages; updateMessageBadge(); } }).catch(() => {});
}
// "+256 742 730 382" -- the shape the mockups show, from whatever the
// server stored (0742730382 / 256742730382 / +256742730382 all normalise).
// The dialling code is the region's; the 3-3-3 grouping is applied only to
// a 9-digit local number, so a country with a different length gets its
// digits printed whole rather than half-grouped.
function formatPhoneDisplay(phone){
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  const dc = dial();
  if (d.slice(0, dc.length) === dc) d = d.slice(dc.length);
  d = d.replace(/^0+/, '');
  const groups = d.length === 9 ? d.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : d;
  return dialPlus() + ' ' + groups;
}

// Short names the Wallet page shows ("MTN", "Airtel"); the server still gets the full provider name.
function walShort(n){ n = String(n || ''); return n === 'MTN Mobile Money' ? 'MTN' : n === 'Airtel Money' ? 'Airtel' : n; }
function walProviders(){ return ['MTN Mobile Money', 'Airtel Money'].concat(STATE.supportedBanks || []).sort((x, y) => walShort(x).localeCompare(walShort(y))); }
function walFull(label){
  const t = String(label || '').trim().toLowerCase();
  if (!t) return '';
  return walProviders().find(p => p.toLowerCase() === t || walShort(p).toLowerCase() === t) || '';
}
function walNetwork(){ const inp = $('walProvider'); return inp ? (inp.dataset.network || walFull(inp.value)) : ''; }
// The bank list is fetched once in the background after the app opens, so the Wallet provider list is complete the first time it is opened.
var _banksPrefetched = false;
function prefetchSupportedBanks(){
  if (_banksPrefetched || (STATE.supportedBanks && STATE.supportedBanks.length)) return;
  _banksPrefetched = true;
  api('/bank/supported-banks').then(br => {
    if (br.status === 'success' && Array.isArray(br.banks) && br.banks.length) STATE.supportedBanks = br.banks; else _banksPrefetched = false;
  }).catch(() => { _banksPrefetched = false; });
}
window.openWalletSheet = async function(){
  openSheet('Wallet', '');
  renderWalletSheet();
  // The provider list only widens once the bank list lands; the form is never repainted under the member's finger.
  // An empty answer (the bank list could not be fetched) is not kept, so the next visit asks again.
  if (!(STATE.supportedBanks && STATE.supportedBanks.length)) {
    api('/bank/supported-banks').then(br => {
      if (br.status === 'success' && Array.isArray(br.banks) && br.banks.length) STATE.supportedBanks = br.banks;
      const list = $('walProviderList');
      if (_openSheetTitle === 'Wallet' && list) list.innerHTML = walProviderOptionsHtml();
    }).catch(() => {});
  }
  const r = await api('/bank/list');
  if (r.status === 'success') STATE.bankAccounts = r.accounts;
  else if (!Array.isArray(STATE.bankAccounts)) STATE.bankAccounts = [];
  if (_openSheetTitle === 'Wallet') paintWalletParts();
};
function currentWallet(){ return (STATE.bankAccounts || [])[0] || null; }
// The only two mobile-money names this app has ever offered -- anything
// else in a `network` field is a bank name, validated as real (against
// MarzPay's own live list) at the moment it was bound. No client-side list
// membership check needed to tell the two apart; this one distinction is
// definitional, not a lookup.
function isMobileMoneyNetwork(network){ return network === 'MTN Mobile Money' || network === 'Airtel Money'; }
function maskedTail(phone){
  const d = String(phone || '').replace(/\D/g, '');
  return d ? '****' + d.slice(-4) : '****';
}
function vWalletCardHtml(w){
  const provider = w && w.network ? String(w.network).toUpperCase() : '';
  return `<div class="v-wcard${w ? '' : ' empty'}">
    <div class="v-wcard-top"><b>${provider ? esc(provider) : 'Wallet'}</b><span class="v-wcard-ic">${MGI.cardMini}</span></div>
    <div class="v-chip-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="v-wcard-num">${w ? esc(walletDestDisplay(w)) : '**** **** **** ****'}</div>
    <div class="v-wcard-l">ACCOUNT HOLDER</div>
    <div class="v-wcard-n">${w ? esc(String(w.holder || '').toUpperCase()) : '—'}</div>
  </div>`;
}
function walletCardHtml(w){ return vWalletCardHtml(w); }
function walletLocalPhone(phone){
  let d = String(phone || '').replace(/\D/g, '');
  const dc = dial();
  if (d.slice(0, dc.length) === dc) d = d.slice(dc.length);
  d = d.replace(/^0+/, '');
  return d ? '0' + d : '';
}
// walletLocalPhone() strips everything but digits and forces a leading
// national-trunk zero back on -- correct for a mobile money number, but it
// would mangle a genuine bank account number (which is not read as "a
// phone number missing its leading 0"). A bound bank account's `phone`
// field already holds exactly what the member entered and MarzPay
// validated, unaltered -- shown as-is.
function walletDestDisplay(w){
  if (!w) return '';
  return isMobileMoneyNetwork(w.network) ? walletLocalPhone(w.phone) : String(w.phone || '');
}
function walProviderOptionsHtml(){
  return walProviders().map(p => `<button type="button" class="prov-opt" onclick="pickProvider('${esc(p)}')">${esc(walShort(p))}</button>`).join('');
}
// The one saved wallet is edited in place: its provider, number and holder
// fill the form (only into empty fields, so nothing the member typed is lost).
// The Account Number box is a phone box for mobile money and a plain text box for a bank (letters allowed).
function applyWalDestKind(nowBank){
  const dest = $('walPhone'); if (!dest) return;
  dest.type = nowBank ? 'text' : 'tel';
  dest.inputMode = nowBank ? 'text' : 'numeric';
  dest.autocomplete = nowBank ? 'off' : 'tel';
  dest.placeholder = 'Enter wallet account number';
}
function prefillWallet(){
  const w = currentWallet(); if (!w) return;
  const prov = $('walProvider'), ph = $('walPhone'), holder = $('walHolder');
  if (prov && !prov.value) { prov.value = walShort(w.network); prov.dataset.network = w.network; }
  applyWalDestKind(!isMobileMoneyNetwork(w.network));
  if (ph && !ph.value) ph.value = walletDestDisplay(w);
  if (holder && !holder.value) holder.value = String(w.holder || '').toUpperCase();
}
// Only the card, the heading and the "Your Wallet" rows: the typed fields are never touched.
function paintWalletParts(){
  const card = $('walCardBox'); if (card) card.innerHTML = vWalletCardHtml(currentWallet());
  const head = $('walEditHead'); if (head) head.textContent = currentWallet() ? 'Edit Wallet' : 'Add Wallet';
  const tog = $('walToggleBtn'); if (tog) tog.textContent = currentWallet() ? 'Edit Wallet' : 'Add Wallet';
  prefillWallet();
}
window.walShowForm = function(show){
  const form = $('walFormWrap'), tog = $('walToggleBtn');
  if (form) form.style.display = show ? '' : 'none';
  if (tog) tog.style.display = show ? 'none' : '';
  if (show) {
    prefillWallet(); const el = $('walProvider');
    // A new wallet starts with the provider list open. It is opened AFTER this tap has finished: the tap itself bubbles up to the
    // "tap anywhere else closes the list" handler, which used to shut it again at once (so the list never appeared the first time).
    if (el && !el.value) { try { el.focus(); } catch (_) {} setTimeout(openProviderList, 0); }
  }
};
function renderWalletSheet(){
  const w = currentWallet();
  $('sheetBody').innerHTML = `<div class="v-form reveal-in">
    <div id="walCardBox">${vWalletCardHtml(w)}</div>
    <button class="v-cta" id="walToggleBtn" type="button" onclick="walShowForm(true)">${w ? 'Edit Wallet' : 'Add Wallet'}</button>
    <div class="v-edit" id="walFormWrap" style="display:none">
      <div class="v-sec" style="margin-top:2px"><span class="bar"></span><h2 id="walEditHead">${w ? 'Edit Wallet' : 'Add Wallet'}</h2></div>
      <div id="walFormGroup">
        <label class="v-flabel" for="walProvider">Wallet Provider</label>
        <div class="prov-pick" id="walProviderPick">
          <div class="v-uline prov-input"><input id="walProvider" type="text" autocomplete="off" placeholder="Type wallet provider to search" oninput="filterProviders()" onfocus="openProviderList()" onclick="openProviderList()"></div>
          <div class="prov-list" id="walProviderList">${walProviderOptionsHtml()}</div>
        </div>
        <label class="v-flabel" for="walPhone">Wallet Account</label>
        <div class="v-uline"><input id="walPhone" type="tel" inputmode="numeric" autocomplete="tel" enterkeyhint="next" placeholder="Enter wallet account number" oninput="handleWalDestInput(this)"></div>
        <label class="v-flabel" for="walHolder">Account Holder Name</label>
        <div class="v-uline"><input id="walHolder" type="text" maxlength="60" autocomplete="name" enterkeyhint="done" placeholder="Enter account holder name" value="${w ? esc(String(w.holder || '').toUpperCase()) : ''}"></div>
        <div class="v-two"><button class="v-ghost" type="button" onclick="walShowForm(false)">Cancel</button><button class="v-solid" id="walSaveBtn" type="button" onclick="submitWallet()">Submit</button></div>
      </div>
    </div>
  </div>`;
  prefillWallet();
}
window.openProviderList = function(){ const box = $('walProviderPick'); if (box) box.classList.add('open'); };
window.filterProviders = function(){
  const inp = $('walProvider'); if (!inp) return;
  if (inp.dataset.network) inp.dataset.lastNetwork = inp.dataset.network;   // remembered so pickProvider knows what was chosen before
  inp.dataset.network = '';
  const q = inp.value.trim().toLowerCase();
  document.querySelectorAll('#walProviderList .prov-opt').forEach(b => { b.style.display = !q || b.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  openProviderList();
};
window.pickProvider = function(name){
  const inp = $('walProvider');
  const prev = inp ? (inp.dataset.network || inp.dataset.lastNetwork || walFull(inp.value)) : '';
  if (inp) { inp.value = walShort(name); inp.dataset.network = name; inp.dataset.lastNetwork = name; }
  const box = $('walProviderPick');
  if (box) box.classList.remove('open');
  document.querySelectorAll('#walProviderList .prov-opt').forEach(b => { b.style.display = ''; });
  const nowBank = !isMobileMoneyNetwork(name);
  const dest = $('walPhone');
  if (dest) {
    applyWalDestKind(nowBank);
    // Crossing the mobile-money/bank boundary clears what was typed: a phone number is never a bank account number. With no provider
    // chosen yet nothing says what the box held, so a number that looks like a phone number is cleared when a bank is picked.
    const wasBank = prev ? !isMobileMoneyNetwork(prev) : false;
    if (prev ? wasBank !== nowBank : (nowBank && /^0?7\d{8}$/.test(String(dest.value).replace(/\D/g, '')))) dest.value = '';
  }
};
window.handleWalDestInput = function(el){
  if (isMobileMoneyNetwork(walNetwork())) { sanitizePhoneInput(el); return; }
  // A bank account number is letters and digits only (what the server accepts); anything else typed is dropped as it is typed.
  if (/[^A-Za-z0-9]/.test(el.value)) el.value = el.value.replace(/[^A-Za-z0-9]/g, '');
};
// Tapping anywhere else closes it, the way a real picker behaves. Bound once
// on the document rather than per-render so repainting the panel cannot leave
// duplicate listeners behind.
document.addEventListener('click', function(e){
  const box = document.getElementById('walProviderPick');
  if (box && box.classList.contains('open') && !box.contains(e.target)) box.classList.remove('open');
});
window.submitWallet = async function(){
  const network = walNetwork();
  const phone = $('walPhone').value;
  const holder = $('walHolder').value.trim();
  if (!network) return notify('Select your wallet provider.');
  // Mobile money keeps its own digit-count check; a bank account number is
  // never phone-shaped, so it only needs to be present and a plausible
  // length -- never capped tighter than that (see handleWalDestInput()'s
  // own comment for why), the server does the real validation against
  // MarzPay before this is ever saved.
  if (isMobileMoneyNetwork(network)) {
    if (String(phone).replace(/\D/g, '').length < 9) return notify('Enter a valid wallet account number.');
  } else if (String(phone).trim().length < 4) {
    return notify('Enter a valid bank account number.');
  }
  if (!holder) return notify('Enter the account holder name.');
  const btn = $('walSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const r = await post('/bank/save', { holder, network, phone });
  btn.disabled = false; btn.textContent = 'Submit';
  if (r.status !== 'success') return notify(r.message || 'Could not save your wallet.');
  return finishWalletSave();
};
// Tail of a successful /bank/save.
async function finishWalletSave(){
  // One wallet only: /bank/save edits it in place, so just re-read and show it.
  const fresh = await api('/bank/list');
  STATE.bankAccounts = fresh.status === 'success' ? fresh.accounts : (STATE.bankAccounts || []);
  notify('Wallet saved');
  if (_openSheetTitle === 'Wallet') renderWalletSheet();
}
// ── NOTIFY DIALOG (Notify.dc.html) ──
// The app-wide validation alert: dimmed backdrop, amber warning triangle,
// message, one pill OK. Replaces notify() for anything the member must
// acknowledge before continuing (toast is still used for confirmations
// that need no acknowledgement, e.g. "Copied", "Wallet saved").
// `onClose` lets a caller do something once the member has acknowledged the
// dialog -- used by the insufficient-balance path to send them to Deposit.
// It is one-shot and cleared on close, so a later plain notify() can never
// inherit a stale callback.
var _notifyOnClose = null;
var _notifyTimer = null;
function dismissNotify(){
  if (_notifyTimer) { clearTimeout(_notifyTimer); _notifyTimer = null; }
  $('notifyBg').classList.remove('show');
  _notifyOnClose = null;
}
window.notify = function(message, onClose){
  $('notifyMsg').textContent = String(message || '');
  // Good news gets the green tick, everything else the yellow warning triangle, as in the screens.
  const good = /success|✓|copied|saved|done|now running|redeemed|submitted|sent|changed|processing|updated|claimed|unlocked|bound|added to your wallet/i.test(String(message || '')) && !/not |fail|could not|cannot|insufficient|invalid|incorrect|wrong|isn't|already|status changed|bind it|add a payout|need /i.test(String(message || ''));
  const ic = $('notifyIc');
  if (ic) { ic.innerHTML = good ? MGI.okc : MGI.warn; ic.className = 'notify-ic ' + (good ? 'ok' : 'err'); }
  const okb = document.querySelector('#notifyBg .notify-ok'); if (okb) okb.classList.toggle('good', good);
  _notifyOnClose = typeof onClose === 'function' ? onClose : null;
  if (_notifyTimer) { clearTimeout(_notifyTimer); _notifyTimer = null; }
  $('notifyBg').classList.add('show');
  // The notice goes away by itself (it fades and shrinks out); OK, or a tap outside the card, closes it sooner.
  const stay = 2500;   // every notice stays 2.5 seconds, whatever its length (owner)
  _notifyTimer = setTimeout(() => { _notifyTimer = null; dismissNotify(); }, stay);
};
window.closeNotify = function(){
  if (_notifyTimer) { clearTimeout(_notifyTimer); _notifyTimer = null; }
  $('notifyBg').classList.remove('show');
  const fn = _notifyOnClose;
  _notifyOnClose = null;
  if (fn) fn();
};

// The Help dialog (Home "Help Me", My "Help Me"): the two contact links the
// admin already sets -- Channel = the Telegram group, Service = Telegram
// customer service -- in a centred dialog.
window.openHelpDialog = function(title){
  const s = STATE.settings || {};
  const btn = (url, label) => url
    ? `<a class="v-help-b" href="${esc(url)}" target="_blank" rel="noopener">${VI.plane}<span>${label}</span></a>`
    : `<button class="v-help-b" type="button" onclick="notify('No ${label.toLowerCase()} link is set yet.')">${VI.plane}<span>${label}</span></button>`;
  $('helpCard').innerHTML = `
    <span class="v-help-ic">${VI.headset}</span>
    <h3>${esc(title || 'Help')}</h3>
    <div class="v-help-btns">${btn(s.telegramGroup || s.telegramChannel, 'Channel')}${btn(s.supportTelegram, 'Service')}</div>
    <button class="v-help-close" type="button" onclick="closeHelpDialog()">Close</button>`;
  $('helpBg').classList.add('show');
  lockBodyScroll(); dlgOpened();
};
window.closeHelpDialog = function(){
  $('helpBg').classList.remove('show'); dlgClosed();
  if (!isScrollLockOverlayOpen()) unlockBodyScroll();
};

// ── TRANSACTION STATEMENT ──
// One professional statement surface. Categories stay horizontal at the top;
// no balance hero, avatar discs, record cards or separate deposit/withdraw/
// earnings screens.
var _statementCat = 'all';
var _statementShown = 10;
var STATEMENT_TURNTABLE_TYPES = new Set(['turntable','spin','spin_bonus']);
var STATEMENT_FRUIT_TYPES = new Set(['fruit','fruit_win','fruit_bet']);
function statementCategoryMatch(cat, t){
  if (cat === 'deposit') return t.type === 'deposit';
  if (cat === 'withdraw') return t.type === 'withdraw';
  if (cat === 'turntable') return STATEMENT_TURNTABLE_TYPES.has(t.type);
  if (cat === 'salary') return t.type === 'mission_salary';
  return true;
}
function statementDescription(t){
  if (t.type === 'deposit') return 'Deposit';
  if (t.type === 'withdraw') return 'Withdraw';
  if (t.type === 'cashback') return 'Daily Earnings';
  if (t.type === 'commission') return 'Commission';
  if (t.type === 'promocode') return 'Gift Code';
  if (t.type === 'checkin') return 'Check-in Reward';
  if (t.type === 'welcome_bonus') return 'Welcome Bonus';
  if (t.type === 'team_reward') return 'Team Reward';
  if (t.type === 'mission_salary') return 'Daily Salary';
  if (t.type === 'mission_deposit_reward') return 'Mission Reward';
  if (STATEMENT_TURNTABLE_TYPES.has(t.type)) return 'Turntable';
  if (t.type === 'admin_credit') return 'Deposit';
  if (t.type === 'invest' || t.type === 'investment') return 'Purchase';
  if (t.type === 'investment_refund') return 'Refund';
  return 'Transaction';
}
// The pill under a row: orange while it is still moving, green once paid,
// red when it failed. A finished credit shows a plain blue description line
// instead (the screens do the same for "Daily Earnings").
function statementChip(t){
  // The words in a free-text description only describe a deposit or a withdrawal; on a credit or a gift they are the admin's note.
  const describes = t.type === 'deposit' || t.type === 'withdraw';
  const raw = String(t.status || '').toLowerCase() + (describes ? ' ' + String(t.description || '').toLowerCase() : '');
  if (/fail|declin|reject|cancel|error/.test(raw)) return { text: 'Failed', cls: 'bad' };
  if (/pend|process|await|initiating|creating|sending/.test(raw)) return { text: t.type === 'deposit' ? 'Pending Deposit' : t.type === 'withdraw' ? 'Processing Payment' : 'Pending', cls: 'wait' };
  if (t.type === 'withdraw') return { text: 'Paid', cls: 'ok' };
  return null;
}
function statementDate(t){
  // "25/09/2026 10:57": day first and no seconds, as on the owner's Balance Record. The moment comes from the row's own
  // timestamp (read on the member's clock like the Income dates); a row without one falls back to the stored text,
  // which the server writes month-first, turned round here.
  const pad = n => String(n).padStart(2, '0');
  const ms = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
  if (Number.isFinite(ms)) { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  const m = String(t.date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const day = m ? `${m[2]}/${m[1]}/${m[3]}` : String(t.date || '');
  return (day + (t.time ? ' ' + String(t.time).slice(0, 5) : '')).trim();
}
function statementAmountText(t){
  const amt = recordsRowAmount(t);
  return (amt < 0 ? '-' : '+') + vMoney2(Math.abs(amt));
}
function renderStatement(){
  const body = $('statementBody');
  if (!body) return;
  const all = (STATE.transactions || []).filter(t => statementCategoryMatch(_statementCat, t));
  if (!all.length) { body.innerHTML = _recordsLoadFailed && !(STATE.transactions || []).length ? loadFailHtml('records') : '<div class="v-empty">No Records</div>'; return; }
  const rows = all;   // every held record, no Load More button
  // The Load More button always sits under the list (as on the owner's Balance Record, even with two rows): it shows the next ten, or, when
  // everything held is already on screen, asks the server again for anything newer or older.
  const more = false;
  body.innerHTML = rows.map(t => {
    const title = statementDescription(t);
    const chip = statementChip(t);
    const amt = recordsRowAmount(t);
    const desc = t.type === 'cashback' ? String(t.description || '').replace(/\s*daily cashback$/i, '') : cleanDesc(t.description);
    const line = chip ? `<span class="v-chip ${chip.cls}">${esc(chip.text)}</span>` : `<span class="v-rdesc">${esc(desc || title)}</span>`;
    return `
      <article class="v-rec">
        <span class="v-rav ${amt < 0 ? 'out' : ''}">${esc(title.charAt(0).toUpperCase())}</span>
        <div class="v-rmid"><b>${esc(title)}</b><small>${esc(statementDate(t))}</small>${line}</div>
        <span class="v-ramt ${amt < 0 ? 'out' : 'in'}">${esc(statementAmountText(t))}</span>
      </article>`;
  }).join('');
}
var _statementMoreBusy = false;
window.statementLoadMore = async function(){
  const held = (STATE.transactions || []).filter(t => statementCategoryMatch(_statementCat, t)).length;
  if (_statementShown < held) { _statementShown += 10; renderStatement(); return; }
  if (_statementMoreBusy) return;
  _statementMoreBusy = true;
  try {
    const r = await api('/transactions');
    if (r.status === 'success' && _openSheetTitle === 'Balance Record') {
      STATE.transactions = r.transactions;
      STATE.transactionsTruncated = !!r.truncated;
      renderStatement();
    }
  } finally { _statementMoreBusy = false; }
};
window.switchStatementCategory = function(cat){
  if (!['all','deposit','withdraw','turntable','salary'].includes(cat)) return;
  _statementCat = cat; _statementShown = 10;
  const tabs = $('statementTabs');
  if (tabs) tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
  renderStatement();
};
window.openTransactionStatement = async function(cat){
  _statementCat = ['all','deposit','withdraw','turntable','salary'].includes(cat) ? cat : 'all';
  _statementShown = 10;
  const hadCache = Array.isArray(STATE.transactions);
  const bal = (STATE.account && STATE.account.walletBalance) || 0;
  openSheet('Balance Record', `
    <div class="v-recbal"><span>CURRENT BALANCE</span><b id="recBalance">${esc(vMoney2(bal))}</b></div>
    <div class="v-rectabs" id="statementTabs">
      ${[['all','All'],['deposit','Deposit'],['withdraw','Withdraw'],['turntable','Turntable'],['salary','Daily Salary']].map(([k, l]) => `<button data-cat="${k}" class="${_statementCat === k ? 'on' : ''}" onclick="switchStatementCategory('${k}')">${l}</button>`).join('')}
    </div>
    <div id="statementBody"></div>`);
  $('sheetBg').classList.add('v-rec-page');
  if (hadCache) renderStatement();
  else $('statementBody').innerHTML = '<div class="list-loading">' + NAV_LOADER + '</div>';
  const r = await api('/transactions');
  if (r.status === 'success') {
    STATE.transactions = r.transactions;
    STATE.transactionsTruncated = !!r.truncated;
    _recordsLoadFailed = false;
  } else if (!hadCache) {
    STATE.transactions = [];
    _recordsLoadFailed = true;
  }
  if (_openSheetTitle === 'Balance Record') renderStatement();
};
// Compatibility for post-withdraw flows and any stale call sites.
window.openBalanceRecordSheet = function(tab){
  const cat = tab === 'deposit' ? 'deposit' : tab === 'withdraw' ? 'withdraw' : 'all';
  return openTransactionStatement(cat);
};

// ── MESSAGES (MessagesList.dc.html / Messages.dc.html) ──
// Real inbox, backed by /messages (admin-authored broadcasts) with per-
// member read state. Snow has no equivalent -- see CLAUDE.md.
window.openMessagesSheet = async function(){
  const hadCache = Array.isArray(STATE.messages);
  openSheet('Messages', '<div id="msgBody"></div>');
  if (hadCache) renderMessagesList();
  else $('msgBody').innerHTML = '<div class="list-loading">' + NAV_LOADER + '</div>';
  const r = await api('/messages');
  if (r.status === 'success') { STATE.messages = r.messages; _messagesLoadFailed = false; }
  else if (!hadCache) { STATE.messages = []; _messagesLoadFailed = true; }
  if (_openSheetTitle === 'Messages') renderMessagesList();
  updateMessageBadge();
};
function messagePreview(body){
  const flat = String(body || '').replace(/\s+/g, ' ').trim();
  return flat.length > 48 ? flat.slice(0, 48) + '…' : flat;
}
function renderMessagesList(){
  const box = $('msgBody');
  if (!box) return;
  const list = STATE.messages || [];
  if (!list.length) { box.innerHTML = _messagesLoadFailed ? loadFailHtml('messages') : '<div class="v-empty">No Messages</div>'; return; }
  box.innerHTML = '<div class="reveal-in">' + list.map((m, i) => `
    <button class="mg-mrow${m.read ? ' read' : ''}" onclick="openMessageDetail(${i})">
      <span class="av"></span>
      <span class="t">${esc(m.title || '')}</span>
      <span class="d">${esc(m.date || '')}<br>${esc(m.time || '')}</span>
      ${m.read ? '' : '<i class="dot"></i>'}
    </button>`).join('') + '</div>';
}
window.openMessageDetail = async function(index){
  const m = (STATE.messages || [])[index];
  if (!m) return;
  $('msgDetail').innerHTML = `
    <button class="xbtn" onclick="closeMessageDetail()" aria-label="Close">${MGI.x}</button>
    <div class="head">
      <span class="av"></span>
      <div>
        <h2>${esc(m.title || '')}</h2>
        <div class="date">${esc(m.date || '')} ${esc(m.time || '')}</div>
      </div>
    </div>
    <div class="ln"></div>
    ${m.body ? `<div class="content">${esc(m.body)}</div>` : ''}
    ${m.hasImage ? `<img class="mimg" src="${esc(API_BASE + '/public/message-image/' + encodeURIComponent(m.id))}" alt="" onerror="this.style.display='none'">` : ''}`;
  // Its own history entry, mirroring openSheet(). Without one, the phone Back
  // button consumed the Messages SHEET's entry instead and tore the list down
  // while leaving this popup floating over nothing -- the same "it won't go
  // away" the nav tap showed, by a different route. replaceState when it is
  // somehow already open, for openSheet()'s reason: stacking two entries for
  // one visible popup breaks the NEXT Back press as well.
  const detailWasOpen = $('msgDetailBg').classList.contains('show');
  $('msgDetailBg').classList.add('show');
  if (detailWasOpen) history.replaceState({ msgDetail: true }, '', '');
  else history.pushState({ msgDetail: true }, '', '');
  if (m.read) return;
  m.read = true;
  renderMessagesList();
  updateMessageBadge();
  await post('/messages/read', { messageId: m.id });
};
// The X goes through history too, so the popup has exactly ONE way to close
// and Back and the X cannot drift apart. popstate below does the actual
// hiding; the direct removal is only for a state that is not ours (nothing
// reaches it today, but a missing entry must still close the popup rather
// than trap the member behind it).
window.closeMessageDetail = function(){
  if (history.state && history.state.msgDetail) { history.back(); return; }
  $('msgDetailBg').classList.remove('show');
};
// Deliberate no-op (owner: "remove notification bell ... svgs in top right
// everywhere"). This used to paint an unread dot onto the top bar's bell
// button; that button no longer exists on ANY screen -- Messages is now
// reached from Account's own row list instead (acctRowHtml(ICONS.bell,
// ..., 'Messages', ..., 'openMessagesSheet()')), which has nowhere
// sensible to keep a live badge dot from every screen the way the top bar
// did. Kept as a callable no-op rather than deleted, since every call
// site (5+ spots across deposit/withdraw completion, page renders) would
// otherwise need its own guard -- same precedent as maybeShowAnnouncement()
// elsewhere in this file after its own feature was removed.
function updateMessageBadge(){
  const n = mgUnread();
  const dot = $('msgDot');
  if (dot) { dot.textContent = n > 99 ? '99+' : String(n); dot.style.display = n ? '' : 'none'; }
  const tile = $('msgBadge');
  if (tile) { tile.textContent = n > 99 ? '99+' : String(n); tile.style.display = n ? '' : 'none'; }
}

function vPwBox(id, placeholder, pin){
  return `<div class="v-pbox"><input id="${id}" type="text" placeholder="${esc(placeholder)}"${pin ? ' inputmode="numeric" maxlength="6" autocomplete="one-time-code"' : ' autocomplete="off"'}></div>`;
}
window.openChangeLoginPasswordSheet = function(){
  openSheet('Change Login Password', `<div class="v-form reveal-in"><div class="v-edit mg-pw">
    <label class="v-flabel" for="lpOld">Old Password</label>${vPwBox('lpOld', 'Enter old password')}
    <label class="v-flabel" for="lpNew">New Password</label>${vPwBox('lpNew', 'Enter new password (at least 6 characters)')}
    <label class="v-flabel" for="lpNew2">Confirm New Password</label>${vPwBox('lpNew2', 'Confirm new password')}
    <button class="v-cta" id="lpSaveBtn" onclick="submitLoginPasswordChange()">Change Password</button>
  </div></div>`);
};
window.submitLoginPasswordChange = async function(){
  const oldPass = $('lpOld').value;
  const newPass = $('lpNew').value;
  const confirm = $('lpNew2').value;
  if (!oldPass) return notify('Enter your current login password.');
  if (!newPass || newPass.length < 6) return notify('Your new password must be at least 6 characters.');
  if (newPass !== confirm) return notify('The two new passwords do not match.');
  if (newPass === oldPass) return notify('Your new password must be different from the old one.');
  const btn = $('lpSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await window.fbChangePassword(phoneToEmail((STATE.account || {}).phone), oldPass, newPass);
    btn.disabled = false; btn.textContent = 'Change Password';
    closeSheet({ fromAction: true });
    notify('Login password changed');
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Change Password';
    // fbErrMsg's wrong-credential copy names the phone number, which only
    // makes sense on the login screen -- here the only thing that can be
    // wrong is the old password itself.
    const code = e && e.code || '';
    notify(code === 'auth/invalid-credential' || code === 'auth/wrong-password'
      ? 'That is not your current login password.'
      : fbErrMsg(e));
  }
};

// ── CHANGE TRADE PASSWORD (ChangePassword.dc.html) ──
// The 6-digit PIN that confirms withdrawals. Mint uses 6 digits where Snow
// used 5 -- server.js validates the same length on /account/transaction-pin/change.
window.openChangeTradePasswordSheet = function(){
  // An account with no Trade Password yet is asked only for the new one.
  const first = (STATE.account || {}).hasTradePin === false;
  openSheet('Change Trade Password', `<div class="v-form reveal-in"><div class="v-edit mg-pw">
    ${first ? '' : `<label class="v-flabel" for="tpOld">Old Password</label>${vPwBox('tpOld', 'Enter old password', true)}`}
    <label class="v-flabel" for="tpNew">New Password</label>${vPwBox('tpNew', 'Enter new password (6 digits)', true)}
    <label class="v-flabel" for="tpNew2">Confirm New Password</label>${vPwBox('tpNew2', 'Confirm new password', true)}
    <button class="v-cta" id="tpSaveBtn" onclick="submitTradePasswordChange()">Change Password</button>
  </div></div>`);
};
window.submitTradePasswordChange = async function(){
  const first = (STATE.account || {}).hasTradePin === false;
  const oldPin = first ? '' : $('tpOld').value.trim();
  const newPin = $('tpNew').value.trim();
  const confirm = $('tpNew2').value.trim();
  if (!first && !/^\d{6}$/.test(oldPin)) return notify('Enter your current 6-digit trade password.');
  if (!/^\d{6}$/.test(newPin)) return notify('Your new trade password must be exactly 6 digits.');
  if (newPin !== confirm) return notify('The two new trade passwords do not match.');
  if (!first && newPin === oldPin) return notify('Your new trade password must be different from the old one.');
  const btn = $('tpSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const r = await post('/account/transaction-pin/change', first ? { newPin } : { oldPin, newPin });
  btn.disabled = false; btn.textContent = 'Change Password';
  if (r.status !== 'success') return notify(r.message || 'Could not change your trade password.');
  if (STATE.account) STATE.account.hasTradePin = true;
  closeSheet({ fromAction: true });
  notify(first ? 'Trade password saved' : 'Trade password changed');
};

// ── TREASURE CHEST (Chest.dc.html / ChestSuccess.dc.html) ──
// The bouncing chest on Home opens this full screen: glowing ring, bouncing
// chest artwork, key field, OPEN CHEST. A valid key flashes the green
// full-screen win state with the amount won and the new balance.
window.openChestSheet = function(){
  openSheet('TREASURE CHEST', `<div class="mg-chestpg reveal-in">
    <i class="mg-fade t"></i>
    <div class="mg-chest-ring"><span class="glow"></span><img src="${CHEST_ART}" alt=""></div>
    <h2>Mystery Treasure</h2>
    <p>Enter your key to unlock the reward</p>
    <input class="mg-chest-key" id="chestKey" type="text" placeholder="Enter treasure chest key" maxlength="14" autocapitalize="characters" autocomplete="off" spellcheck="false" oninput="this.value=this.value.toUpperCase()">
    <button class="mg-chest-go" id="chestOpenBtn" type="button" onclick="submitChestKey()">OPEN CHEST</button>
    <i class="mg-fade b"></i>
  </div>`);
  $('sheetBg').classList.add('mg-chest-page');
};
window.submitChestKey = async function(){
  // No case-forcing here -- /redeem matches case-insensitively via
  // codeLower now, so whatever case the member typed or pasted reaches
  // the server unchanged and still resolves to the same code.
  const raw = ($('chestKey').value || '').trim();
  // Owner named these two exactly: "so on 'please enter the treasure chest
  // key', 'wrong treasure chest password'."
  if (!raw) return notify('Please enter the treasure chest key');
  const btn = $('chestOpenBtn');
  btn.disabled = true; btn.textContent = 'OPENING…';
  const r = await post('/redeem', { code: raw });
  btn.disabled = false; btn.textContent = 'OPEN CHEST';
  if (r.status !== 'success') return notify(r.message || 'Wrong treasure chest password');
  // Owner: "why does the congratulations card delay to appear when one has
  // claimed treasure code." Because it used to wait on TWO more round trips
  // after the redeem itself -- /account and the transactions cache -- purely
  // to print "New Balance". On a phone on mobile data with the backend cold,
  // that is seconds of nothing happening after a successful claim, which
  // reads as a failure.
  //
  // The credit is already confirmed by the time we are here, and the new
  // balance is simple arithmetic on a figure the app already holds, so the
  // card can open NOW. `walletBalance` comes back from /redeem itself where
  // the deployed backend sends it; the sum is the fallback for a backend
  // that has not been redeployed yet.
  const before = Number((STATE.account || {}).walletBalance) || 0;
  const reward = Number(r.reward) || 0;
  const after = Number.isFinite(Number(r.walletBalance)) && r.walletBalance !== null
    ? Number(r.walletBalance) : before + reward;
  if (STATE.account) STATE.account.walletBalance = after;
  // The win card from the owner's screenshot: Congratulations!, You won, the
  // amount, the new balance and COLLECT, over the blurred Treasure Chest page.
  showChestWin(reward, after);
  // Now catch the app up in the background.
  refreshAfterWin();
};
function showChestWin(reward, balance, after){
  let bg = $('chestWinBg');
  if (bg) bg.remove();
  bg = document.createElement('div');
  bg.id = 'chestWinBg'; bg.className = 'v-win-bg'; bg._after = typeof after === 'function' ? after : null;
  bg.innerHTML = `
    <div class="v-win-card" role="dialog" aria-modal="true">
      <h2>Congratulations!</h2>
      <p class="v-win-sub">You won</p>
      <div class="v-win-amt">${esc(vMoney2(reward))}</div>
      <p class="v-win-bal">New Balance: ${esc(vMoney2(balance))}</p>
      <button type="button" class="v-win-btn" onclick="collectChestWin()">COLLECT</button>
    </div>`;
  document.body.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('show'));
  dlgOpened();
}
window.collectChestWin = function(){
  const bg = $('chestWinBg');
  const after = bg && bg._after;
  if (bg) bg.remove();
  // A win that came from somewhere other than the Treasure Chest page (a Task Center reward) hands control back to
  // its own page instead of closing the sheet underneath.
  if (after) { after(); dlgClosed(); return; }
  // The chest page and the win card each own a history entry: close both with ONE history call.
  if (!_dlgFromPop && history.state && history.state.dlg) { closeSheet({ fromAction: true, keepHistory: true }); _dlgIgnore(); history.go(-2); }
  else closeSheet({ fromAction: true });
};
// The two network refreshes a win needs. Deliberately not awaited by its
// caller -- the toast above already told the member it worked, so nothing
// on screen is waiting on either result.
async function refreshAfterWin(){
  try {
    const acc = await api('/account');
    if (acc.status === 'success') STATE.account = acc.account;
    await refreshTransactionsCache();
    if (STATE.page === 'home') renderHome();
    if (STATE.page === 'account') renderAccount();
  } catch (_) { /* STATE.account is already correct from the redeem response */ }
}

// Shared by every full-screen overlay (sheets, the announcement dialog, the
// gift-code modal, confirm dialogs) that needs to stop the page behind it
// from moving while it's open. Locking body.style.overflow alone isn't
// enough -- <html> (document.documentElement), not <body>, is the actual
// CSSOM "scrolling element" in standards mode, so a forceful drag/overscroll
// could still shift the whole layout viewport with only body locked,
// letting the fixed bottom-nav bar peek in at the edge during the bounce
// (owner: "when l scroll or force scroll the withdrawal screen it shows
// some bits of bottom navigation"). Locking both closes that gap.
function lockBodyScroll(){
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}
function unlockBodyScroll(){
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
}

// ── SHEETS ──
// Tracks which sheet's content is currently showing in the one shared
// #sheetBody -- every deferred (post-await) repaint in a sheet's own open*
// function should check this, not merely "does #sheetBody exist" (it
// always does, it's a static element whose innerHTML just gets replaced).
// See openWithdrawSheet/openWalletSheet.
var _openSheetTitle = null;
// Used by showPage()'s deferred maybeShowAnnouncement() call to check whether
// the member has since opened a sheet or a confirm dialog on top of Home
// while the announcement's own wait was still in flight -- none of those
// are page navigations (STATE.page stays 'home' throughout), so
// _openSheetTitle alone isn't enough on its own.
// 30000 -> 30,000 (thousands separators for whole amounts printed inside a sentence); anything that is not a plain number is left as it is.
function vGroup(n){ const x = Number(n); return Number.isFinite(x) ? numGroup(x, false) : String(n); }
function isAnyOverlayOpen(){
  return !!(_openSheetTitle
    || ($('msgDetailBg') && $('msgDetailBg').classList.contains('show'))
    || ($('notifyBg') && $('notifyBg').classList.contains('show'))
    || ($('confirmBg') && $('confirmBg').classList.contains('show'))
    // The recharge result modal (Round 82) came after this guard was first
    // written and was never added to it -- it is exactly the kind of thing
    // the announcement must never land on top of, since it carries the
    // outcome of a payment the member is waiting on.
    || ($('depStatusBg') && $('depStatusBg').classList.contains('show'))
    // The announcement dialog itself, now that it's real again -- so a
    // second trigger (e.g. Withdraw closing right after Deposit already
    // opened it) can't stack a second announcement on top of the first.
    || ($('depStatusBg') && $('depStatusBg').classList.contains('show'))
    || ($('annBg') && $('annBg').classList.contains('show')));
}
// Owner: "when you logout and login again, the system freezes and no
// scrolling... only if you go back to homescreen and scroll so other pages
// scroll too" -- root-caused, not guessed at: maybeAnnounceOnEntry() fires
// the announcement dialog on every login (see its own comment below), which
// calls lockBodyScroll(); right around the same moment, bootFromNetwork()
// also fires a "Login successful" notify() toast. If the member closes the
// announcement WHILE that toast is still in its ~1.4s auto-dismiss window,
// closeAnnouncement() (and closeConfirm(), the same shape of bug) checked
// isAnyOverlayOpen() -- which counts a visible toast as "something is still
// in front" -- and skipped unlockBodyScroll() entirely. Nothing ever
// retries the unlock afterward, so document.documentElement/body stay
// permanently stuck at overflow:hidden (the app's real scroll mechanism --
// #pageHost/#app have no scroller of their own) for the rest of that
// session, on every page, until something else happens to call
// unlockBodyScroll() unconditionally (e.g. actually opening and closing a
// sheet, which is why visiting a page that involves one can look like it
// "fixes" things). Confirmed live: reproduced the exact toast-still-
// showing race against a real lockBodyScroll()/closeAnnouncement() pair and
// watched the unlock get silently skipped.
//
// The actual bug is isAnyOverlayOpen() answering two different questions
// with one check: "is there something else visible I shouldn't stack a new
// dialog on top of" (notifyBg/msgDetailBg are legitimately relevant there)
// vs. "is a REAL scroll lock still legitimately held" (notifyBg/msgDetailBg
// never call lockBodyScroll() at all, so a toast merely being visible must
// never be a reason to withhold unlockBodyScroll()). This narrower check
// answers only the second question.
function isScrollLockOverlayOpen(){
  return !!(_openSheetTitle
    || ($('confirmBg') && $('confirmBg').classList.contains('show'))
    || ($('depStatusBg') && $('depStatusBg').classList.contains('show'))
    || ($('annBg') && $('annBg').classList.contains('show')));
}

// Owner, superseding the earlier "fires when closing Deposit/Withdraw/Wallet
// back to Home" rule: "the dialog should appear when one also clicks back to
// home ie from assets to home, from network to home, and account to home, so
// remove those existing of from withdrawal, from deposit to home." The
// trigger is now a bottom-nav PAGE transition, not a sheet closing -- fires
// only when the tab just left is Assets, Network or Account and the tab just
// entered is Home. Deposit/Withdraw/Wallet are sheets, not STATE.page values
// (STATE.page stays 'home' the whole time one is open), so they were never
// part of this rule to begin with once the old sheet-based mechanism was
// removed -- nothing extra needed excluding them.
function maybeAnnounceAfterHomeNav(prevPage){
  if (['assets', 'promo', 'network', 'salary', 'account'].indexOf(prevPage) === -1) return;
  if (isAnyOverlayOpen()) return;         // something else is already in front
  maybeShowAnnouncement();
}
// Owner: "l also wanted the dialog to show when on every visit ie logging in
// again, registration like that." A second, independent trigger alongside
// the bottom-nav one above -- fires once, right after the loading screen
// comes down on login OR a fresh registration, from both places that ever
// happens (enterApp()'s cache-hit instant-boot path and bootFromNetwork()'s
// full-boot path). Not folded into maybeAnnounceAfterHomeNav() itself: that
// one deliberately requires a REAL prevPage of assets/network/account, which
// is never true on a fresh app entry (STATE.page is unset at that point), so
// this needed its own call rather than trying to make the nav-check pass.
function maybeAnnounceOnEntry(){
  if (isAnyOverlayOpen()) return;
  maybeShowAnnouncement();
}
function openSheet(title, bodyHtml){
  dismissNotify();
  $('sheetBg').classList.remove('v-rec-page', 'mg-nohead', 'mg-chest-page');
  $('sheetTitle').textContent = title;
  $('sheetBody').innerHTML = bodyHtml;
  // Withdraw's empty-state "Add withdrawal account" link opens Withdrawal
  // Accounts FROM WITHIN the already-open Withdraw sheet -- both render into
  // this same shared overlay, so without this check a second history entry
  // stacks on top of the first for what looks like one continuously-open
  // sheet. A single Back tap (or the X button) then only unwound the newest
  // entry, closing the whole overlay in one tap instead of returning to
  // Withdraw, and left a stale extra entry behind that broke the NEXT Back
  // press too. Replacing the entry in place when a sheet is already open
  // keeps stack depth at 1 regardless of how many sheets got chained, so
  // one Back/X tap always does exactly one consistent thing: close.
  const alreadyOpen = $('sheetBg').classList.contains('show');
  // A page opens at its top, not wherever the previous page was scrolled to (they share this one overlay).
  if (!alreadyOpen) $('sheetBg').scrollTop = 0;
  $('sheetBg').classList.add('show');
  document.body.classList.add('sheet-open');
  _openSheetTitle = title;
  if (alreadyOpen) history.replaceState({ sheet: title }, '', '');
  else history.pushState({ sheet: title }, '', '');
  lockBodyScroll();
  if (window.mgGutters) window.mgGutters();   // the 4px scrollbar room is made now, before the first paint of the page
}
// opts.fromAction/opts.navigating used to gate whether closing a sheet could
// trigger the announcement dialog (a submitted withdrawal, a recharge
// handing over to its result modal, or a tab tap all had to suppress it).
// The announcement no longer fires from a sheet closing at all -- see
// maybeAnnounceAfterHomeNav() -- so both flags are now inert; left on their
// call sites rather than stripped out of several submit-button paths for a
// purely cosmetic cleanup. opts.keepHistory is the one flag this function
// still reads.
window.closeSheet = function(opts){
  $('sheetBg').classList.remove('show');
  document.body.classList.remove('sheet-open');
  unlockBodyScroll();
  _openSheetTitle = null;
  if (_aboutScrollObserver) { _aboutScrollObserver.disconnect(); _aboutScrollObserver = null; }
  // opts.keepHistory: the caller is retiring several overlay entries itself
  // with one history.go(-n) -- see showPage(). Only that caller sets it.
  if (!(opts && opts.keepHistory) && history.state && history.state.sheet) history.back();
};
// ── The Back button and pop-up dialogs ──
// Sheets and the message popup own a history entry, so Back closes them. The other dialogs (Buy confirm, Help, the
// announcement, the win card, the Download card) used not to, and Back with one of them open walked the member out
// of the app. Now each pushes ONE entry when it opens; Back closes the dialog and stays. When a dialog is closed
// with its own button its entry is removed a moment later (not at once: a page opened right after the close pushes
// its own entry, and a back() queued before that push would remove the wrong one); an entry that outlives its
// dialog is skipped over by the popstate handler below, so Back never "does nothing".
var _dlgIgnorePop = false, _dlgFromPop = false, _dlgCleanTimer = null;
function anyDialogOpen(){
  return !!($('chestWinBg')
    || ($('dlBg') && $('dlBg').classList.contains('show'))
    || ($('helpBg') && $('helpBg').classList.contains('show'))
    || ($('confirmBg') && $('confirmBg').classList.contains('show'))
    || ($('annBg') && $('annBg').classList.contains('show'))
    // The payment status page owns a history entry too: without it here, one Back left the page showing and the next left the app mid-payment.
    || ($('depStatusBg') && $('depStatusBg').classList.contains('show')));
}
function _dlgIgnore(){ _dlgIgnorePop = true; setTimeout(() => { _dlgIgnorePop = false; }, 700); }
function resetOverlayState(){
  document.body.classList.remove('deposit-status-open', 'sheet-open');
  // A session that ends (or a logout) takes every popup with it: the Buy confirm, Help, announcement, download and the win card used to stay
  // on top of the Login screen (the win card even showed the previous member's New Balance).
  ['confirmBg', 'helpBg', 'annBg', 'dlBg'].forEach(id => { const el = $(id); if (el) el.classList.remove('show'); });
  const win = $('chestWinBg'); if (win) win.remove();
  _openSheetTitle = null; _depActiveDepositId = null; _withdrawSubmitting = false;
  if (_depSuccessRedirectTimer) { clearInterval(_depSuccessRedirectTimer); _depSuccessRedirectTimer = null; }
}
function dlgOpened(){
  if (_dlgCleanTimer) { clearTimeout(_dlgCleanTimer); _dlgCleanTimer = null; }
  if (history.state && history.state.dlg) history.replaceState({ dlg: 1 }, '', '');
  else history.pushState({ dlg: 1 }, '', '');
}
function dlgClosed(){
  if (_dlgFromPop) return;   // Back already took its entry away
  if (_dlgCleanTimer) clearTimeout(_dlgCleanTimer);
  _dlgCleanTimer = setTimeout(() => {
    _dlgCleanTimer = null;
    if (!anyDialogOpen() && history.state && history.state.dlg) { _dlgIgnore(); history.back(); }
  }, 400);
}
function closeTopDialog(){
  _dlgFromPop = true;
  try {
    if ($('chestWinBg')) collectChestWin();
    else if ($('dlBg') && $('dlBg').classList.contains('show')) closeDownloadDialog();
    else if ($('helpBg') && $('helpBg').classList.contains('show')) closeHelpDialog();
    else if ($('confirmBg') && $('confirmBg').classList.contains('show')) closeConfirm();
    else if ($('annBg') && $('annBg').classList.contains('show')) closeAnnouncement();
    else if ($('depStatusBg') && $('depStatusBg').classList.contains('show')) {
      // The payment status page: Back closes it once it has an answer (its Close button is showing). While the payment is still being
      // checked Back stays on the page (a real operation is in flight, as the page's own comment says), instead of walking out of the app.
      const cb = $('depStatusCloseBtn');
      if (cb && cb.style.display === 'block') closeDepositStatusModal(); else dlgOpened();
    }
  } finally { _dlgFromPop = false; }
}
// A tap on the edge of a text box (its padding or the currency sign beside the figure) focuses the box's input too.
document.addEventListener('click', (e) => {
  const box = e.target.closest && e.target.closest('.v-pbox,.v-pin,.v-amtrow,.v-uline');
  if (!box || e.target.closest('button,a,input,select,textarea')) return;
  const inp = box.querySelector('input'); if (inp) inp.focus();
});
window.addEventListener('popstate', (ev) => {
  if (_dlgIgnorePop) { _dlgIgnorePop = false; return; }       // the removal of a leftover dialog entry: nothing to close
  if (anyDialogOpen()) { closeTopDialog(); return; }            // Back closes the dialog and stays where it is
  // The message detail sits ON TOP of the Messages sheet and carries its own
  // history entry, so unwinding it closes just the popup and lands back on
  // the sheet's entry -- the list is still open behind it, which is what
  // Back should do from a popup opened out of a list. Returning here is what
  // keeps the teardown below from taking the list with it.
  if ($('msgDetailBg') && $('msgDetailBg').classList.contains('show')) {
    $('msgDetailBg').classList.remove('show');
    return;
  }
  // The phone's own Back button, which never goes through closeSheet()
  // directly.
  $('sheetBg').classList.remove('show');
  document.body.classList.remove('sheet-open');
  unlockBodyScroll();
  _openSheetTitle = null;
  if (_aboutScrollObserver) { _aboutScrollObserver.disconnect(); _aboutScrollObserver = null; }
  // Landed on an entry whose dialog is already closed: step over it so one Back is one visible step.
  if (ev && ev.state && ev.state.dlg) { _dlgIgnore(); history.back(); }
});

// About page: an admin-authored ordered list of text/image blocks (see
// /public/about-content), rendered as an article and revealed block-by-
// block as the member scrolls (owner: "whenever one scrolls down, images
// and words I placed show animation").
let _aboutScrollObserver = null;


// Owner: "make daily checkin to reset at 00:00 not 24hrs" -- reverts back to
// a calendar-midnight (EAT, UTC+3) daily reset instead of Round 87's rolling
// 24h cooldown. STATE.account.lastCheckinAt is still the real epoch-ms
// timestamp server.js already returns -- only the "when does the cooldown
// lift" math changes, from "+24h" to "the next EAT midnight after
// lastCheckinAt's own calendar day." The live "Available in HH:MM:SS"
// countdown (same startCheckinCountdown() ticking pattern
// startPlanCountdowns() already uses on My Products) is kept -- it now
// counts down to that real midnight instant instead of a moving +24h target.
// The region's own clock offset, not Kampala's -- "resets at midnight" has
// to mean midnight where the member lives. Mirrors tzOffMs() in server.js.
function tzOffMs(){ const m = REGION && REGION.utcOffsetMin; return (m == null ? 180 : Number(m)) * 60000; }
// Self-terminating, same idiom as startPlanCountdowns(): the tick just stops
// itself once #checkinBtn's countdown attribute is gone (sheet closed or
// re-rendered), no separate close-hook needed. Once the cooldown genuinely
// reaches zero, flips the button live to its claimable state -- no manual
// refresh/reopen needed to see the app catch up.
var _checkinCountdownTimer = null;


function recordsRowAmount(t){
  if (t.displayAmount !== undefined && t.displayAmount !== null) return Number(t.displayAmount) || 0;
  if ((Number(t.amount) || 0) === 0 && t.description && (t.type === 'deposit' || t.type === 'withdraw')) {
    // The currency label the SERVER wrote into this description, which is
    // the member's own region's -- "UGX" for Uganda, "KES" for Kenya. Any
    // 2-to-6-letter label is accepted rather than only the region's current
    // one, so a row written before an admin relabelled the currency still
    // reads. Fixed "UGX" here would have made every non-Ugandan row show 0.
    const m = String(t.description).match(/\b[A-Z]{2,6}\s*([\d,]+(?:\.\d+)?)/);
    if (m) {
      const parsed = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(parsed)) return t.type === 'withdraw' ? -parsed : parsed;
    }
  }
  return Number(t.amount) || 0;
}

function cleanDesc(d){ return d || ''; }

// Manual (admin-number, SMS-matched) deposit collection -- PAY B, and the
// PAY A/PAY B choice screen itself -- was removed outright per owner
// instruction ("remove option for payment methods, remove manual payment
// in the whole codes... remove them all"). Automatic recharge is now the
// only deposit path: one screen, no method choice to make.
window.openDepositSheet = function(){
  const s = STATE.settings || {};
  if (s.depositAvailable === false) return notify('Deposits are not available right now.');
  openDepositFormSheet();
};
var _depChosenAmount = 0;
function openDepositFormSheet(){
  const s = STATE.settings || {};
  _depChosenAmount = 0;
  const min = Number(s.minDeposit) || 0;
  openSheet('Deposit', `<div class="v-form mg-dep">
    <div class="v-sec"><span class="bar"></span><h2>Select Amount</h2></div>
    <div class="v-chips" id="depChips">${depositChipsHtml(s, 'depAmount')}</div>
    <input class="v-amount" id="depAmount" type="text" inputmode="numeric" maxlength="9" placeholder="${min || ''}" oninput="this.value=this.value.replace(/[\\s,]/g,'');syncDepositQuickAmt()" autocomplete="off">
    <div class="v-sec"><span class="bar"></span><h2>Select Payment Method</h2></div>
    <div class="v-pays" id="depPays">
      ${['PAY-A', 'PAY-E', 'PAY-B', 'PAY-C', 'PAY-G'].map((n, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" onclick="pickPayLabel(this)"><b>${n}</b><i></i></button>`).join('')}
    </div>
    <button class="v-cta" id="depSubmitBtn" onclick="submitDeposit()">Confirm Deposit</button>
    <div class="v-info">
      <h3>Deposit Instructions</h3>
      <ol>
        <li>Recharge time: 7*24 hours.</li>
        <li>If deposit is not received, please contact TG customer service.</li>
        <li>Minimum deposit amount: ${esc(cur())} ${vGroup(min)}</li>
        <li>Please do not save old account recharge.</li>
      </ol>
    </div>
    <div class="mg-redirect" id="depRedirect"><span class="spin"></span><p>Redirecting to payment...</p></div>
  </div>`);
}
// PAY-A / PAY-B / PAY-C are one gateway, three labels: the choice is only
// the highlight, nothing else reads it.
window.pickPayLabel = function(btn){
  const box = $('depPays');
  if (box) box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
};
var _cardChosenAmount = 0;
window.syncCardQuickAmt = function(){
  const val = parseMoneyInput(($('cardAmount') || {}).value);
  _cardChosenAmount = val;
  const chips = $('cardChips');
  if (chips) chips.querySelectorAll('.dep-chip').forEach(btn => btn.classList.toggle('sel', Number(btn.dataset.amt) === val));
};
// Owner: cards go through MarzPay's own hosted gateway, so this leaves the
// app entirely (window.location.href, a full navigation -- there is no
// modal/iframe checkout to stay inside). Unlike Mobile Money, the app
// itself is gone from memory the instant that navigation happens, so
// _depActiveDepositId-style in-memory tracking (the pattern the Mobile
// Money status modal uses) cannot survive it -- the pending deposit id has
// to be written somewhere that outlives a full page reload. localStorage
// is that place; resumePendingCardDeposit() (called from enterApp() on
// every app open) is what picks it back up once the member returns from
// MarzPay's page, however many minutes or app-relaunches later that is.
var CARD_DEPOSIT_STORAGE_KEY = 'mint_pending_card_deposit';
// Called once per app open (see enterApp()). Fire-and-forget: nothing else
// on screen depends on this resolving, and a member with no pending card
// payment (the overwhelming common case) pays for one harmless, near-instant
// localStorage read and nothing more.
async function resumePendingCardDeposit(){
  let depositId;
  try { depositId = localStorage.getItem(CARD_DEPOSIT_STORAGE_KEY); } catch (e) { return; }
  if (!depositId) return;
  // Used to be a single check-and-forget: if the webhook had not landed in
  // the exact instant the member reopened the app, they saw nothing until
  // the NEXT full app open. Poll for a short window instead, same shape and
  // cadence as pollUsdtDepositStatus() -- a webhook landing a few seconds
  // late (the common case; it is a real network round trip on MarzPay's
  // side) now still surfaces here instead of silently waiting for a restart.
  var attempts = 0;
  var timer = setInterval(async function(){
    attempts++;
    try {
      // Same status route Mobile Money already polls -- it resolves purely
      // off dep.marzTxUuid/dep.status, never anything MoMo-specific, so a
      // card deposit's own row is invisible to it by nothing more than
      // coincidence of shape, not a special case that had to be added.
      const r = await post('/deposit/marzpay/status', { depositId: depositId });
      if (r.status === 'success' && r.state === 'matched') {
        clearInterval(timer);
        try { localStorage.removeItem(CARD_DEPOSIT_STORAGE_KEY); } catch (e) {}
              notify('Card payment completed! Credited to your balance.');
        await refreshTransactionsCache();
        if (STATE.page === 'home') renderHome();
        return;
      }
      if (r.status === 'success' && r.state === 'failed') {
        clearInterval(timer);
        try { localStorage.removeItem(CARD_DEPOSIT_STORAGE_KEY); } catch (e) {}
        notify(r.message || 'The card payment did not complete.');
        return;
      }
    } catch (e) {}
    // Still pending after 6 tries (~30s): leave the key in place. The next
    // full app open re-runs this same check, and the server-side
    // reconcilePendingDeposits() sweep keeps retrying independently of
    // whether the member is even looking at the app -- never declared
    // failed just because it has not resolved within this one window.
    if (attempts >= 6) clearInterval(timer);
  }, 5000);
}
// The chip values still come from the live product prices (owner: "juck put
// quick amounts basing on products prices"), so they stay correct when
// products are repriced, only the chip's LOOK follows the mockup now.
//
// inputId picks which panel these chips belong to: Mobile Money's #depChips
// feeds #depAmount, Card's #cardChips feeds #cardAmount. A tap used to
// always write into #depAmount regardless of which panel was actually
// open, so tapping a quick amount on the Card tab silently updated the
// OTHER, hidden field and did nothing visible on screen. Each chip now
// carries its own target, and _chosenAmountFor()/pickDepositAmount() below
// route to the right field/chip-group instead of assuming Mobile Money.
function depositChipsHtml(s, inputId){
  const amounts = Array.from(new Set((STATE.products || [])
    .map(p => Number(p.price) || 0)
    .filter(p => p >= (Number(s.minDeposit) || 0))))
    .sort((a, b) => a - b)
    .slice(0, 3);
  const chosen = _chosenAmountFor(inputId);
  return amounts.map(a =>
    `<button type="button" class="dep-chip${a === chosen ? ' sel' : ''}" data-amt="${a}" onclick="pickDepositAmount(${a},'${inputId}')">${numGroup(a, false)}</button>`
  ).join('');
}
function _chosenAmountFor(inputId){
  return inputId === 'cardAmount' ? _cardChosenAmount : _depChosenAmount;
}
window.pickDepositAmount = function(amt, inputId){
  const el = $(inputId || 'depAmount');
  if (el) el.value = amt;
  if (inputId === 'cardAmount') syncCardQuickAmt();
  else syncDepositQuickAmt();
};
function syncDepositQuickAmt(){
  // Deposit.dc.html's own chip grid (#depChips/.dep-chip) is the only chip
  // row left. The second branch here highlighted the older .quick-amt row on
  // the two "Recharge" screens, and both of those screens are gone.
  const val = parseMoneyInput(($('depAmount') || {}).value);
  _depChosenAmount = val;
  const chips = $('depChips');
  if (chips) chips.querySelectorAll('.dep-chip').forEach(btn => btn.classList.toggle('sel', Number(btn.dataset.amt) === val));
}
// Live deposit-status modal -- reuses the .chest-modal-bg/.chest-modal dark/
// centered/thin pop-up convention. Opens the instant a recharge is accepted
// and updates in place as pollDepositStatus() resolves, instead of just a
// toast + silent background poll. No outside-tap-to-close while pending
// (a real operation is in flight); the Close button only appears once
// resolved (or once the poll gives up), matching the app's own established
// pattern of only offering Close on a settled dialog state.
window.openDepositStatusModal = function(amount, phone, network){
  setDepositStatusPending(amount, phone, network);
  $('depStatusBg').classList.add('show');
  document.body.classList.add('deposit-status-open');
  lockBodyScroll();
  // Back closes this page (see closeTopDialog) instead of leaving the app. When the deposit sheet's own history entry is still being
  // taken away (closeSheet called history.back() a moment ago), the popstate for that does the push (closeTopDialog); pushing here too
  // would be popped by that same back() and leave a stale sheet entry behind. A timer makes sure an entry exists either way.
  if (!(history.state && history.state.sheet)) dlgOpened();
  setTimeout(() => { if ($('depStatusBg') && $('depStatusBg').classList.contains('show') && !(history.state && history.state.dlg)) dlgOpened(); }, 700);
};
window.closeDepositStatusModal = function(goHome){
  // Cancels the success screen's own auto-redirect countdown if the member
  // taps Close/Back before it fires on its own -- otherwise the timer would
  // still be alive and try to close (or navigate) a modal that is already
  // closed, moments later.
  if (_depSuccessRedirectTimer) { clearInterval(_depSuccessRedirectTimer); _depSuccessRedirectTimer = null; }
  $('depStatusBg').classList.remove('show');
  document.body.classList.remove('deposit-status-open');
  unlockBodyScroll();
  dlgClosed();
  if (goHome === true && STATE.page !== 'home') { try { navigatePage('home'); } catch (_) {} }
};
// ── ONE STATUS REQUEST AT A TIME ──
// Owner: "add a button saying verify, so one can tap it but it should not
// stop autopolling, also they should not call at the same time to strike api
// of payment provider."
//
// /deposit/marzpay/status makes the server ask the payment provider about
// this transaction, so two of them firing together is two hits on the
// provider for one answer -- and the manual Verify tap is, by design, most
// likely to happen exactly while the 3s autopoll is mid-request.
//
// This is a single-flight, not a mutex: a caller arriving while a request is
// already out gets the SAME promise back rather than being refused or made to
// start a second one. So the member's tap is never ignored (they still get an
// answer, the one already on its way), the autopoll is never interrupted, and
// the provider is never asked twice at once. It also means both callers may
// resolve on the same response, which is why applyDepositStatusResult() below
// has to be idempotent.
var _depStatusInflight = null;
var _depActiveDepositId = null;
var _depPollDone = false;
var _depPendingAmount = 0;
// Long enough that hammering the button cannot turn into a burst of provider
// calls, short enough that a member watching the screen can re-check when the
// prompt actually lands on their phone.
var DEP_VERIFY_COOLDOWN_MS = 2500;
function depositStatusCheck(depositId){
  if (_depStatusInflight) return _depStatusInflight;
  // post() resolves to {status:'error'} rather than rejecting (see api()), so
  // this promise never rejects and the finally always clears the slot.
  _depStatusInflight = post('/deposit/marzpay/status', { depositId })
    .finally(() => { _depStatusInflight = null; });
  return _depStatusInflight;
}
// The autopoll's own request: asks the server to HOLD the answer for a few seconds while it is watching the payment (server.js waitDepositSettled),
// so "paid" arrives the moment PesaJet confirms instead of at the next tick. Deliberately NOT shared with depositStatusCheck(): a Verify tap must
// never be made to wait behind a held request. A server that does not hold simply answers at once and the loop's own pacing takes over.
var DEP_HOLD_MS = 8000;
function depositStatusHold(depositId){
  return post('/deposit/marzpay/status', { depositId, waitMs: DEP_HOLD_MS });
}
// The single place that decides what a status response MEANS, shared by the
// autopoll and the Verify button so the two can never disagree about the same
// payload. Returns true once the deposit has settled.
async function applyDepositStatusResult(r){
  if (_depPollDone) return true;
  if (!r || r.status !== 'success') return false;
  if (r.state === 'matched') {
    _depPollDone = true;
    setDepositStatusSuccess();
    await refreshTransactionsCache();
    if (STATE.page === 'home') renderHome();
    return true;
  }
  if (r.state === 'failed') {
    _depPollDone = true;
    setDepositStatusFailed(r.message);
    await refreshTransactionsCache();
    return true;
  }
  return false;
}
// Which of the two buttons the current state offers. Verify stays available
// in the "still processing" state as well as while pending -- that state is
// the autopoll giving up on its 60s budget, NOT the payment being over, so
// taking the one control that can still resolve it away at exactly that
// moment would be backwards.
function setDepButtons(showVerify, showClose){
  const v = $('depVerifyBtn'), c = $('depStatusCloseBtn');
  if (v) { v.style.display = showVerify ? 'block' : 'none'; v.disabled = false; v.textContent = 'Verify'; }
  if (c) { c.style.display = showClose ? 'block' : 'none'; c.setAttribute('onclick', 'closeDepositStatusModal(' + (c.textContent === 'Back to Home') + ')'); }
}
window.verifyDepositNow = async function(){
  const btn = $('depVerifyBtn');
  if (!_depActiveDepositId || _depPollDone || !btn || btn.disabled) return;
  btn.disabled = true; btn.textContent = 'Checking…';
  const settled = await applyDepositStatusResult(await depositStatusCheck(_depActiveDepositId));
  if (settled) return;                       // setDep* already reset the buttons
  notify('Not confirmed yet. Approve the payment prompt on your phone, then tap Verify again.');
  // The cooldown runs from the ANSWER, not the tap, so a slow provider does
  // not let taps queue up behind it.
  setTimeout(() => {
    if (_depPollDone) return;
    const b = $('depVerifyBtn');
    if (b) { b.disabled = false; b.textContent = 'Verify'; }
  }, DEP_VERIFY_COOLDOWN_MS);
};
function setDepositStatusPending(amount, phone, network){
  if (_depSuccessRedirectTimer) { clearInterval(_depSuccessRedirectTimer); _depSuccessRedirectTimer = null; }   // an old success countdown must not close this new page
  $('depStatusIcon').className = 'dep-status-icon';
  $('depStatusIcon').innerHTML = DEPOSIT_POLL_FLOW;
  $('depStatusTitle').textContent = 'Processing your deposit';
  // Owner asked for the specifics shown here, not a generic message --
  // the actual number the prompt was sent to and the actual amount.
  const displayPhone = cleanPhone(phone) || (dialPlus() + String(phone || '').replace(/\D/g, ''));
  // Owner: "put another statement, that dial *165# to approve, this is
  // just a fallback bro because a payment prompt can come or it may fail
  // and one may dial *165# so he see pending approval" -- the USSD push
  // prompt itself can fail to arrive (a real, common MoMo gap, not
  // specific to this app), so a member staring at a prompt that never
  // shows up needs a way out other than waiting. Dialling the network's
  // own money menu surfaces the same pending collection request for
  // manual approval there instead. Network-specific -- *165# is MTN
  // Mobile Money's own menu, *185# is Airtel Money's; showing the wrong
  // one would send a member down a dead end. Round 145 dropped the
  // network selector from PAY A's own form (the gateway detects it
  // instead), so `network` is no longer reliably known here -- show both
  // codes rather than guessing.
  const ussd = network === 'Airtel Money' ? '*185#' : (network === 'MTN Mobile Money' ? '*165#' : '*165# (MTN) or *185# (Airtel)');
  _depPendingAmount = Number(amount) || 0;
  // Owner's own four steps, verbatim. Numbered because they are a sequence
  // with one thing for the member to DO in the middle of it -- the previous
  // single paragraph buried "approve it on your phone" mid-sentence between
  // two facts, which is the one line that actually needed to be found.
  //
  // esc() on both interpolations: the amount is ours, but the phone number is
  // whatever was typed into the form, and this is innerHTML now.
  $('depStatusBody').innerHTML =
    '<ol class="pay-steps">'
    + '<li>A payment request for ' + esc(fmtUGX(amount)) + ' has been sent to ' + esc(displayPhone) + '.</li>'
    + '<li>Check your phone for the payment prompt.</li>'
    + '<li>Approve the payment to complete your deposit.</li>'
    + '<li>Your balance will be updated automatically once the payment is confirmed.</li>'
    + '</ol>'
    // Kept from the earlier round, and deliberately NOT dropped when the four
    // steps replaced the old paragraph. Owner, when it was added: "put another
    // statement, that dial *165# to approve, this is just a fallback bro
    // because a payment prompt can come or it may fail and one may dial *165#
    // so he see pending approval." The push prompt genuinely does fail to
    // arrive sometimes -- a real MoMo gap, not something this app causes --
    // and without this a member is left staring at step 2 with nothing to do.
    + '<p class="pay-note">If the prompt does not come up, dial ' + esc(ussd)
    + ' on that phone to find and approve the pending payment yourself.</p>';
  // Owner: "remove verify button, so this is automatic verification" -- the
  // autopoll (pollDepositStatus() below) already checks on its own; a manual
  // Verify tap next to it was a second way to do the same thing, not a
  // needed one. Neither button shows while pending now -- purely automatic,
  // nothing for the member to do but wait.
  setDepButtons(false, false);
}
// (Confetti and sparkles were removed on the owner's request: success is shown by the tick drawing itself, see playStatusIcon.)
var _depSuccessRedirectTimer = null;
function setDepositStatusSuccess(){
  $('depStatusIcon').className = 'dep-status-icon success';
  // The owner's own artwork, cut out of the images he supplied.
  playStatusIcon($('depStatusIcon'), 'ok');
  // Owner: "let me think that on payment success it says congratulations
  // payment has been received {added to your wallet} redirecting back home
  // in 5 seconds or you can say so back the button should be available."
  $('depStatusTitle').textContent = 'Congratulations!';
  // Names the actual figure when it is known (it always is on the automatic
  // path, since the pending state set it moments earlier) and falls back to
  // wording that reads properly without one -- the manual-deposit path lands
  // here from handleManualDepositStatusResult() without ever showing pending.
  // brandName(), not the literal: the app's name is admin-settable.
  const amountLine = _depPendingAmount
    ? 'Payment received — ' + esc(fmtUGX(_depPendingAmount)) + ' has been added to your wallet.'
    : 'Payment received — your deposit has been added to your ' + esc(brandName()) + ' wallet.';
  $('depStatusBody').innerHTML = '<p>' + amountLine + '</p><p class="pay-note" id="depRedirectCountdown"></p>';
  // Close doubles as "Back to Home" here -- available immediately so a
  // member who does not want to wait the 5 seconds out can leave right
  // away, exactly as asked ("or you can say so back the button should be
  // available"). The countdown auto-fires the identical action if they
  // don't tap it first.
  const c = $('depStatusCloseBtn');
  if (c) c.textContent = 'Back to Home';
  setDepButtons(false, true);
  let secondsLeft = 5;
  const tick = () => {
    const el = $('depRedirectCountdown');
    if (el) el.textContent = 'Returning to Home in ' + secondsLeft + '…';
    if (secondsLeft <= 0) {
      if (_depSuccessRedirectTimer) { clearInterval(_depSuccessRedirectTimer); _depSuccessRedirectTimer = null; }
      closeDepositStatusModal(true);
      return;
    }
    secondsLeft--;
  };
  if (_depSuccessRedirectTimer) clearInterval(_depSuccessRedirectTimer);
  tick();
  _depSuccessRedirectTimer = setInterval(() => { if (!document.hidden) tick(); }, 1000);   // the countdown waits while the app is in the background
}
function setDepositStatusFailed(msg){
  $('depStatusIcon').className = 'dep-status-icon failed';
  // Owner sent two reference icon styles for this state and said "pick any
  // of the 2, I said signs not words" -- an exclamation mark, not the X this
  // used to draw. Kept the same soft-fill-circle-plus-stroke treatment
  // setDepositStatusSuccess()'s own checkmark right above already uses
  // (same --snow-wine-soft/--snow-wine tokens this circle already had) --
  // only the mark inside changed, matching image 2's outlined style over
  // image 3's solid-filled one, for visual consistency with that sibling.
  playStatusIcon($('depStatusIcon'), 'fail');
  $('depStatusTitle').textContent = 'Payment not completed';
  // Owner asked for "due to insufficient funds" here -- checked against
  // MarzPay's own integration guide first rather than guessing at a field
  // name: a collection that fails after being accepted carries no reason at
  // all in MarzPay's documented response/webhook shapes, only a terminal
  // status (see server.js's DEPOSIT_FAILED_MSG, and its own long comment,
  // for the full citation). Naming ONE specific cause here would be a
  // fabricated claim this app has no way to know is true -- this instead
  // lists the real, plausible causes without asserting which one it was.
  // `msg` is server-supplied on the normal path; this fallback only fires
  // for a purely client-side failure that never reached the server at all.
  $('depStatusBody').innerHTML = '<p>' + esc(msg
    || 'This deposit did not go through. This can happen if you did not approve the prompt in time, cancelled it, or had insufficient funds. Your ' + brandName() + ' balance has not changed.') + '</p>';
  // Undoes setDepositStatusSuccess()'s own "Back to Home" relabel -- this
  // button means plain Close here, on a modal a later deposit attempt can
  // reuse without a fresh page load in between.
  const cf = $('depStatusCloseBtn'); if (cf) cf.textContent = 'Close';
  setDepButtons(false, true);
}
function setDepositStatusUnknown(){
  $('depStatusIcon').className = 'dep-status-icon';
  $('depStatusIcon').innerHTML = DEPOSIT_POLL_FLOW;
  $('depStatusTitle').textContent = 'Still waiting for the provider';
  $('depStatusBody').innerHTML = '<p>The payment has not been confirmed yet, and nothing is lost. '
    + 'If it goes through, your balance updates on its own automatically, '
    + 'or look under Transaction Statement later to check.</p>';
  const cu = $('depStatusCloseBtn'); if (cu) cu.textContent = 'Close';
  // Verify removed here too (see setDepositStatusPending's own comment) --
  // this is the same automatic wait, just past the autopoll's own 60s
  // budget. Close is the only control: a way off the screen, not a way to
  // ask again by hand.
  setDepButtons(false, true);
}
window.submitDeposit = async function(){
  const submitBtn = $('depSubmitBtn');
  if (!submitBtn || submitBtn.disabled || !$('depAmount')) return;
  const amount = parseMoneyInput($('depAmount').value);
  // Owner: "why when one didn't put number, it just continues to poll ... l
  // tried to leave not putting number and clicked confirm deposit but it
  // didn't reject it just continued to go to poll page."
  //
  // The amount was validated here and the phone simply was not, so an empty
  // field went to the server, which fell back to the account's own registered
  // number, created a real deposit and answered success -- so the app went
  // happily on to the poll page for a payment prompt the member never asked
  // for. It also produced the broken "+256" with no digits on that screen,
  // because the display fell back to a bare country code.
  //
  // cleanPhone() is the SAME rule the server applies, so what is accepted
  // here and what is accepted there cannot drift apart.
  // The payment prompt goes to the member's own registered number (the server uses it when none is sent).
  const phone = cleanPhone((STATE.account || {}).phone || '');
  if (!amount || amount <= 0) return notify('Enter a valid amount');
  // Card (doCardDeposit()) and USDT (doUsdtDeposit()) both already check
  // this client-side before ever hitting the network; Mobile Money was the
  // one rail still relying entirely on the server's own rejection, which
  // meant a below-minimum amount round-tripped to the server and back
  // before the member found out, instead of failing instantly like the
  // other two.
  const s = STATE.settings || {};
  if (amount < (Number(s.minDeposit) || 0)) return notify('Minimum amount is ' + fmtUGX(s.minDeposit));
  submitBtn.disabled = true; submitBtn.textContent = 'Processing...';
  const redirect = $('depRedirect'); if (redirect) redirect.classList.add('show');
  let r;
  try {
    // No network field on this form (Round 145) -- the gateway detects it
    // from the phone number itself; server.js already treats `network` as
    // optional here.
    r = await post('/deposit/marzpay', { amount });
  } finally {
    // Restores the button's resting label after a failed attempt -- must
    // match whatever submitBtn actually reads at rest (see the sheet's own
    // button above), or a member whose recharge failed is left looking at a
    // button that silently renamed itself.
    submitBtn.disabled = false; submitBtn.textContent = 'Confirm Deposit';
    if (redirect) redirect.classList.remove('show');
  }
  if (r && r.stale) return;
  if (!r || r.status !== 'success') return notify((r && r.message) || 'Could not start deposit');
  // Same stale-Records fix as submitWithdraw() -- /deposit/marzpay already
  // wrote a "Processing" ledger row server-side by this point, refresh the
  // cache now so it's actually there the next time Records opens.
  refreshTransactionsCache().catch(() => {});
  if ($('depSubmitBtn') === submitBtn && _openSheetTitle === 'Deposit') closeSheet({ fromAction: true });
  openDepositStatusModal(amount, phone || localDigits((STATE.account || {}).phone || ''));
  pollDepositStatus(r.depositId);
};
// Owner: "callback speed is low, so try to make the system solid and faster
// validation on payments."
//
// The old loop slept a flat 3s BEFORE its first check, so even a member who
// approved the prompt instantly watched a screen that said nothing for three
// seconds -- and every later tick was 3s too. Two changes, and neither asks
// the provider for more than it needs:
//
//   * the FIRST check is at 1.2s. That is the case worth optimising: the
//     member had the prompt open and approved it immediately.
//   * later checks are 1.5s apart (owner, 2026-10-08; was 2.5s, the cadence PesaJet's own SDK
//     uses in pollUntilComplete.
//
// The 60-second budget is unchanged -- 24 ticks at the new spacing is the same
// wall-clock window, so nothing gives up on a payment any sooner than before.
var DEP_POLL_FIRST_MS = 1000;
var DEP_POLL_EVERY_MS = 1500;
async function pollDepositStatus(depositId){
  _depActiveDepositId = depositId;
  _depPollDone = false;
  // Ticks are 1.5 s apart MEASURED FROM THE START OF EACH TICK (a slow answer no longer pushes the next check further away), and the
  // budget is 70 s of the wall clock, not 24 ticks however long each took.
  const began = Date.now();
  await new Promise(r => setTimeout(r, DEP_POLL_FIRST_MS));
  while (Date.now() - began < 70000) {
    const tickStart = Date.now();
    // A Verify tap may have settled it between ticks -- stop rather than
    // firing another provider call for an answer already in hand.
    if (_depPollDone) return;
    // Superseded: the member backed out of this recharge and started another
    // one, so a newer poll owns the screen now. Without this, THIS loop would
    // keep running for its full 60s and write deposit A's result over deposit
    // B's page -- and, worse than the old code, would set the shared
    // _depPollDone and stop B's loop as well. Same shape as the bug already
    // documented on the manual-pay poll.
    if (_depActiveDepositId !== depositId) return;
    const r = await depositStatusHold(depositId);
    if (_depPollDone) return;
    if (_depActiveDepositId !== depositId) return;
    if (await applyDepositStatusResult(r)) return;
    // Answered at once (nothing to hold on, or an error): pace the next ask. A held answer already took its time.
    const spent = Date.now() - tickStart;
    if (spent < DEP_POLL_EVERY_MS) await new Promise(r2 => setTimeout(r2, DEP_POLL_EVERY_MS - spent));
  }
  // Ending the loop is the autopoll giving up on its own ~60s budget, not the
  // payment being over -- _depPollDone stays false on purpose so Verify keeps
  // working on this deposit afterwards.
  if (!_depPollDone) { setDepositStatusUnknown(); slowDepositWatch(depositId); }
}
// The fast poll gives up after 70 s but the server keeps watching a payment for 2 minutes and the reconciler for longer: keep asking every few
// seconds for 3 more minutes so a payment approved late still turns the page into its result (Success or Failed) instead of staying on "Still waiting".
async function slowDepositWatch(depositId){
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 4000));
    if (_depPollDone || _depActiveDepositId !== depositId) return;
    if (!$('depStatusBg') || !$('depStatusBg').classList.contains('show')) continue;
    const r = await depositStatusHold(depositId);
    if (_depPollDone || _depActiveDepositId !== depositId) return;
    if (await applyDepositStatusResult(r)) return;
  }
}

// Cache-first: STATE.bankAccounts is prefetched at login. Deliberately does
// NOT quietly repaint once the background re-fetch lands (unlike Home/Team/
// Products) -- this sheet has live input fields (amount, PIN) and silently
// replacing them out from under someone mid-entry would be a much worse bug
// than a slightly-stale account list. The background fetch still keeps
// STATE.bankAccounts current for the NEXT time this sheet opens.
// Which saved wallet THIS withdrawal goes to, now that more than one can
// exist. null means "no explicit pick yet" -- witSelectedWallet() then
// falls back to the first saved one, so a member with only one wallet (the
// common case) never sees a picker or has to choose anything.
function witSelectedWallet(){ return (STATE.bankAccounts || [])[0] || null; }
window.openWithdrawSheet = async function(){
  const s = STATE.settings || {};
  openSheet('Withdraw', '');
  // Paint the actual withdrawal page immediately. Waiting for /bank/list
  // left a transparent-looking empty sheet over Home on a cold open.
  paintWithdrawSheet(s);
  const amountField = $('witAmount');
  const r = await api('/bank/list');
  if (_openSheetTitle !== 'Withdraw' || $('witAmount') !== amountField) return;
  if (r.status === 'success' && Array.isArray(r.accounts)) {
    STATE.bankAccounts = r.accounts;
    // Only the wallet block -- never #witAmount or anything else on the
    // page, per this function's own standing rule (see the comment above
    // it): a member may already be mid-typing an amount by the time this
    // background fetch lands.
    const block = $('witWalletBlock');
    if (block) block.innerHTML = witWalletBlockHtml(s);
    const submitBtn = $('witSubmitBtn');
    if (submitBtn) submitBtn.disabled = _withdrawSubmitting;
  }
};
// ── The withdraw window, client side ────────────────────────────────────
// Mirrors server.js's withdrawWindowState()/hhmmLabel(). The SERVER decides;
// this only tells the member what the rule is before they type an amount, and
// saves them a round trip when it is plainly shut.
//
// What was here before was worse than nothing: a hardcoded "Withdrawal time:
// 06:00:00 - 17:00:00." that no code enforced, so the app quietly promised
// hours it did not keep. If the window is off, the line now says withdraw is
// open any time, because that is the truth.
var _WIT_HHMM = /^(\d{1,2}):(\d{2})$/;
function witMinutes(v){
  const m = _WIT_HHMM.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return (h > 23 || mi > 59) ? null : h * 60 + mi;
}
// 24-hour, matching server.js's hhmmLabel() and every other clock in this
// app. It was 12-hour AM/PM, which disagreed with the ledger and the plan
// countdown, did not look like the 18:00 the owner typed into the admin
// panel, and spliced two untranslatable English words into a sentence the
// translator had already translated.
function witClock(v){
  const t = witMinutes(v);
  if (t == null) return '';
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
function withdrawWindow(s){
  const from = witMinutes(s && s.withdrawOpenFrom), to = witMinutes(s && s.withdrawOpenTo);
  if (!(s && s.withdrawWindowEnabled) || from == null || to == null || from === to)
    return { enabled: false, open: true, from: '', to: '' };
  const d = new Date(Date.now() + tzOffMs());   // the region's clock, as the server judges it
  const now = d.getUTCHours() * 60 + d.getUTCMinutes();
  // The window may WRAP past midnight -- 18:00 to 17:00 is his own example.
  const open = from < to ? (now >= from && now < to) : (now >= from || now < to);
  return { enabled: true, open, from: witClock(s.withdrawOpenFrom), to: witClock(s.withdrawOpenTo) };
}
// The one wallet card and the Bind Wallet button (one wallet per member; the
// Wallet page edits it in place). Isolated so openWithdrawSheet()'s post-fetch
// update can repaint only this block, never #witAmount.
function witWalletBlockHtml(s){
  const w = witSelectedWallet();
  if (!w) return `<button id="witBindBtn" class="v-bind none" type="button" onclick="openWalletSheet()">Add Wallet</button>`;
  return `<div id="witWallet">${walletCardHtml(w)}</div>
    <button id="witBindBtn" class="v-bind" type="button" onclick="openWalletSheet()">Bind Wallet</button>`;
}
// Withdraw.dc.html. Replaces the form inherited from Snow: a tinted balance
// card, a UGX-prefixed amount field, the bound wallet shown as the same
// bank-card tile the Wallet screen uses (not a <select> of several), the
// trade-password field, the fee line, and the instruction card.
function paintWithdrawSheet(s){
  const balance = (STATE.account && STATE.account.walletBalance) || 0;
  const fee = withdrawalFeePct(s);
  // A member the owner made unrestricted by withdrawal time sees no hours (the server skips them too).
  const win = (STATE.account && STATE.account.withdrawAnytime) ? { enabled: false, open: true } : withdrawWindow(s);
  const secs = v => v ? v + ':00' : '';
  const min = Number(s.minWithdraw) || 0, max = Number(s.maxWithdraw) || 0, mult = Number(s.withdrawMultiple) || 0;
  // An unrestricted member has no daily number either (the server skips it for them).
  const perDay = (STATE.account && STATE.account.withdrawAnytime) ? 0 : (Number(s.maxWithdrawalsPerDay) || 0);
  $('sheetBody').innerHTML = `<div class="v-form">
    <div class="v-bal"><span>AVAILABLE BALANCE</span><b id="witBalance">${esc(vMoney2(balance))}</b></div>
    <div class="v-amtrow"><span>${esc(cur())}</span><input id="witAmount" type="text" inputmode="numeric" maxlength="9" placeholder="0.00" oninput="this.value=this.value.replace(/[\s,]/g,'');syncWithdrawReceiveAmt()" autocomplete="off"></div>
    <div class="v-sec"><span class="bar"></span><h2>Withdrawal Wallet</h2></div>
    <div id="witWalletBlock">${witWalletBlockHtml(s)}</div>
    <div class="v-sec"><span class="bar"></span><h2>Trade Password</h2></div>
 
    <div class="v-pin"><input id="witPin" type="text" inputmode="numeric" maxlength="6" placeholder="Enter trade password" autocomplete="off"></div>
    <div class="v-fee">Fee: ${fee}%</div>
    <button class="v-cta fade" id="witSubmitBtn" ${_withdrawSubmitting ? 'disabled' : ''} onclick="submitWithdraw()">Confirm Withdraw</button>
    <div class="v-info">
      <h3>Withdrawal Instructions</h3>
      <ol>
        <li>Fee: ${fee}%</li>
        <li>Withdrawal amounts should be between ${vGroup(min)}${max ? ' and ' + vGroup(max) : ' and your available balance'}${mult ? ', in multiples of ' + vGroup(mult) : ''}.</li>
        <li>${perDay ? 'You can make up to ' + perDay + ' withdrawals per day.' : 'One cash-out at a time. Wait for a pending request to finish before the next.'}</li>
        <li>${win.enabled ? 'Withdrawal time: ' + esc(secs(win.from)) + ' - ' + esc(secs(win.to)) + '.' : 'Withdrawals can be requested at any time of day.'}</li>
      </ol>
    </div>
  </div>`;
}
function withdrawalFeePct(s){
  const value = Number(s && s.withdrawFeePct);
  return s && s.withdrawFeePct != null && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 15;
}
window.syncWithdrawReceiveAmt = function(){
  const amount = parseMoneyInput(($('witAmount') || {}).value);
  const btn = $('witSubmitBtn');
  if (btn) btn.classList.toggle('fade', !(amount > 0));
};
// Transaction Statement (openBalanceRecordSheet()) is cache-first: it paints from
// whatever STATE.transactions already holds, and per Round 55's own fix,
// deliberately does NOT repaint once its own background refetch lands (that
// was to stop a sheet that's already open from silently reloading itself
// mid-view). The side effect nobody had hit until now: nothing ever
// refreshed STATE.transactions the moment a NEW ledger row was actually
// created server-side (withdraw/deposit both write one immediately, see
// server.js's own /withdraw/request and /deposit/marzpay) -- so opening
// Records right after submitting a withdrawal painted the STALE cached
// list, missing the just-created "Processing" row entirely, and even a
// second open could still miss it depending on exactly when the FIRST
// open's own background refetch happened to land. Owner: "a pending
// withdrawal order is not created... l want it to be created" -- it WAS
// being created server-side the whole time, the client just never told
// itself to look again. Same "refresh the relevant STATE slice right after
// a successful money action" pattern submitCheckin() already uses for
// STATE.account.
async function refreshTransactionsCache(){
  const r = await api('/transactions');
  if (r.status === 'success') { STATE.transactions = r.transactions; STATE.transactionsTruncated = !!r.truncated; _recordsLoadFailed = false; }
}
var _withdrawSubmitting = false;
window.submitWithdraw = async function(){
  const submitBtn = $('witSubmitBtn');
  if (!submitBtn || submitBtn.disabled || _withdrawSubmitting || !$('witAmount')) return;
  const amount = parseMoneyInput($('witAmount').value);
  // Whichever saved wallet is currently selected on screen -- may be one of
  // several now that Mint allows saving more than one (see
  // witSelectedWallet()'s own comment).
  const acct = witSelectedWallet();
  if (!amount || amount <= 0) return notify('Enter a valid amount.');
  // Mirrors the server's rule so the member is told BEFORE a round trip.
  // The server checks it again -- this is a courtesy, not the enforcement.
  const wMult = Math.max(0, Math.floor(Number((STATE.settings || {}).withdrawMultiple) || 0));
  const wMin = Number((STATE.settings || {}).minWithdraw) || 0;
  // The minimum is checked first, as the server does, so the suggestions below can never be amounts under it.
  if (wMin > 0 && amount < wMin) return notify(`Minimum withdraw is ${fmtUGX(wMin)}.`);
  if (wMult > 0 && amount % wMult !== 0) {
    const low = Math.floor(amount / wMult) * wMult, high = low + wMult;
    return notify(`Withdraw must be a multiple of ${fmtUGX(wMult)}. Try ${fmtUGX(low || high)} or ${fmtUGX(high)}.`);
  }
  // Owner: "I want a notify to appear when one tries to press confirm
  // cashout but when he hasn't saved a bank." Confirm Cash Out used to be a
  // plain HTML `disabled` button whenever there was no wallet -- a disabled
  // button swallows a tap with zero feedback, so the member saw nothing at
  // all. It's tappable unconditionally now (see paintWithdrawSheet()); this
  // check is what actually tells them why nothing happened.
  if (!acct) return notify('Please add a payout wallet before withdrawing.');
  // Same courtesy for the hours: told here so the member is not asked to
  // wait on a request the server will refuse anyway.
  const win = withdrawWindow(STATE.settings || {});
  if (win.enabled && !win.open && !(STATE.account && STATE.account.withdrawAnytime))
    return notify(`Withdraw is open from ${win.from} to ${win.to}. Please come back then.`);
  const witPin = $('witPin') ? $('witPin').value.trim() : '';
  if (!/^\d{6}$/.test(witPin)) return notify('Enter your 6-digit Trade Password.');
  _withdrawSubmitting = true;
  submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';
  let r;
  try { r = await post('/withdraw/request', { amount, network: acct.network, phone: acct.phone, pin: witPin }); }
  finally {
    if ($('witPin')) $('witPin').value = '';
    _withdrawSubmitting = false;
    submitBtn.disabled = false; submitBtn.textContent = 'Confirm Withdraw';
    // A background /bank/list landing mid-request can have repainted the
    // wallet block (see openWithdrawSheet()) and left a DIFFERENT button
    // element in the DOM -- disabled state is only ever about an in-flight
    // request now, not wallet presence, so the new one is simply enabled.
    const current = $('witSubmitBtn');
    if (current && current !== submitBtn) current.disabled = false;
  }
  if (r.stale) return;
  if (r.status !== 'success') return notify(r.message || 'Could not request withdrawal.');
  // Owner: "why when l withdrawal the value still remains???"
  // Because nothing here refreshed it. The SERVER debits immediately --
  // /withdraw/request does walletBalance: increment(-amt) before it answers --
  // so the money really had left, but STATE.account still held the figure from
  // before the request and every screen kept painting it. Subtract it here so
  // the balance drops the moment the sheet closes, then let the live /account
  // fetch below confirm it.
  if (STATE.account) {
    STATE.account.walletBalance = Math.max(0, (Number(STATE.account.walletBalance) || 0) - amount);
  }
  // Owner: "l nolonger need that ugly old notify that cash out processing ...
  // our card notifies, with the warning sign, so it can say other words and
  // show amount to be received after the charges plus okay button."
  // `net` comes from the server, which is the authority on the fee it actually
  // charged; the client-side sum is the fallback for a backend that has not
  // redeployed yet.
  const pct = withdrawalFeePct(STATE.settings || {});
  const net = Number.isFinite(Number(r.net)) && r.net !== null
    ? Number(r.net) : amount - Math.round(amount * pct / 100);
  // Owner: "when one requests withdrawal then he is forwarded to records of
  // withdrawals to see his processing withdrawal."
  // On OK, not before: the card carries the amount they will actually receive,
  // and yanking the screen out from under it while they are still reading is
  // how that number gets missed.
  notify(`Withdraw of ${fmtUGXCents(amount)} is processing. You will receive `
    + `${fmtUGXCents(net)} after the ${pct}% charge.`,
    () => openBalanceRecordSheet('withdraw'));
  if (_openSheetTitle === 'Withdraw' && $('witSubmitBtn') === submitBtn) closeSheet({ fromAction: true });
  refreshAfterWithdraw();
};
// The catch-up after a withdrawal, off the path between the server saying yes and
// the member being told. Not awaited: the balance above is already correct, and
// nothing on the dialog depends on either of these landing.
async function refreshAfterWithdraw(){
  try {
    const acc = await api('/account');
    if (acc.status === 'success') STATE.account = acc.account;
    await refreshTransactionsCache();
    if (STATE.page === 'home') renderHome();
    if (STATE.page === 'account') renderAccount();
  } catch (_) { /* the figure on screen is already the post-debit one */ }
}

// Owner: "investment confirmation dialog should be removed completely."
// Buy Now now purchases straight away. The card the button sits on is the
// only place the price and payout are shown before the money moves, which is
// why productCardHtml() must keep showing both.
// The button is disabled while the request is in flight -- with no dialog in
// the way, a double tap would otherwise fire two purchases, and /invest/create
// has no client-side retry guard of its own.
window.openInvestConfirm = function(tierKey, btn){
  const p = (STATE.products||[]).find(x => x.key === tierKey);
  if (!p || (btn && btn.disabled)) return;
  const fig = planFigures(p);
  $('confirmSheet').innerHTML = `
    <h3>Confirm Investment</h3>
    <p class="confirm-sub">Review this product before investing.</p>
    <div class="confirm-row"><span>Product</span><b class="mono">${esc(p.name || 'Product')}</b></div>
    <div class="confirm-row"><span>Cost</span><b class="mono">${fmtUGX(Number(p.price) || 0)}</b></div>
    <div class="confirm-row"><span>Term</span><b>${fig.cycle} Days</b></div>
    <div class="confirm-row"><span>Daily Yield</span><b class="mono">${fmtUGX(fig.daily)}</b></div>
    <div class="confirm-row"><span>Expected Return</span><b class="mono">${fmtUGX(fig.expected)}</b></div>
    <button class="primary-button" id="confirmActionBtn" style="width:100%;padding:15px 0;font-size:15px;margin-top:16px;">Buy Product</button>
    <button class="secondary-button" style="width:100%;padding:13px 0;font-size:14px;margin-top:10px;border:none;" onclick="closeConfirm()">Cancel</button>`;
  const actionBtn = $('confirmActionBtn');
  // A double tap on BUY NOW lands its second tap where this button appears: it is dead for the first 600 ms so nothing is bought unseen.
  actionBtn.disabled = true;
  setTimeout(() => { if (actionBtn.isConnected && actionBtn.textContent === 'Buy Product') actionBtn.disabled = false; }, 600);
  actionBtn.onclick = async () => {
    if (actionBtn.disabled) return;
    actionBtn.disabled = true; actionBtn.textContent = 'Buying…';
    const result = await api('/invest/create', { method:'POST', body:JSON.stringify({ tierKey, expectedPrice: Number(p.price) || 0 }) });
    if (result.status === 'error' && result.code === 'PRICE_CHANGED') { try { refreshCatalogNow(); } catch (_) {} }
    if (result.status !== 'success') {
      actionBtn.disabled = false; actionBtn.textContent = 'Buy Product';
      const short = result.code === 'INSUFFICIENT_BALANCE' || /^Need .*, have /.test(String(result.message || ''));
      if (short) {
        closeConfirm();
        notify('Insufficient balance, redirecting to deposit...', () => openDepositSheet());
        setTimeout(() => { if (_notifyOnClose) closeNotify(); }, 1800);
        return;
      }
      // Answers that a second tap cannot change (limit reached, price changed, product closed, banned) close the dialog, so the notice is not
      // left on top of a Buy button that will only say the same thing again.
      if (/^(PURCHASE_LIMIT|PRICE_CHANGED|BANNED|REGISTRATION_REQUIRED)$/.test(String(result.code || '')) || /not open right now/i.test(String(result.message || ''))) closeConfirm();
      notify(result.message || 'Could not complete investment');
      return;
    }
    closeConfirm();
    showPage('home');
    notify(`${p.name} is now running. See it under Orders.`);
  };
  $('confirmBg').classList.add('show');
  lockBodyScroll(); dlgOpened();
};

// The Cancel button and backdrop both call this by name from inline markup.
// It must be a window property; a missing global here leaves confirmBg up and
// keeps the document's scroll lock active, which traps the member on screen.
window.closeConfirm = function(){
  $('confirmBg').classList.remove('show'); dlgClosed();
  $('confirmSheet').innerHTML = '';
  if (!isScrollLockOverlayOpen()) unlockBodyScroll();
};

// ── PWA: install prompt + service worker auto-update ──
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window._installPrompt = e;
});
window.addEventListener('appinstalled', () => { window._installPrompt = null; });
// Owner, originally: "make when one taps download, it opens and middle
// there is a button download, and in background there is image uploaded
// from admin panel" -- built as its own full screen (openDownloadSheet(),
// with an admin-uploadable 'downloadbg' backdrop). Later reversed: "remove
// that stuff of download app background, here, one just taps on and it
// stimulates downloading, no going inside, so remove download app back
// image input." The Account row below now calls promptInstallApp()
// directly -- no screen in between -- and the 'downloadbg' image slot, its
// admin upload UI, and this function are gone, not just unlinked.
window.promptInstallApp = async function(){
  if (!window._installPrompt) { notify('Already installed, or your browser doesn\'t support installing ' + brandName() + '.'); return; }
  window._installPrompt.prompt();
  const choice = await window._installPrompt.userChoice.catch(() => null);
  window._installPrompt = null;
  if (choice && choice.outcome === 'accepted') openDownloadDialog();
};
// The owner's screen after the download starts: a blue card, "Download", the
// sentence, and one Confirm button that closes it.
window.openDownloadPage = function(){
  const bg = STATE.downloadBg ? ' style="background-image:url(' + esc(JSON.stringify(STATE.downloadBg).slice(1, -1)) + ')"' : '';
  openSheet('Download App', `<div class="mg-dl"${bg}>
    <h1>Install ${esc(brandName())}</h1>
    <p class="sub">Fast, simple and always with you</p>
    <button type="button" class="mg-dl-btn" onclick="promptInstallApp()">Download Now</button>
    <p class="note">Tap Download Now, then follow your browser to add the app to your home screen.</p>
  </div>`);
  $('sheetBg').classList.add('mg-nohead');
};
window.openDownloadDialog = function(){
  let bg = $('dlBg');
  if (!bg) {
    bg = document.createElement('div');
    bg.id = 'dlBg'; bg.className = 'v-dl-bg';
    bg.innerHTML = '<div class="v-dl-card"><h3>Download</h3><p>The app has been downloaded, please go to the browser to check and install it.</p><button type="button" onclick="closeDownloadDialog()">Confirm</button></div>';
    document.body.appendChild(bg);
  }
  bg.classList.add('show'); dlgOpened();
};
window.closeDownloadDialog = function(){ const bg = $('dlBg'); if (bg) { if (bg.classList.contains('show')) dlgClosed(); bg.classList.remove('show'); } };
// Owner: "remove double loading of startup loader or system it's self it
// can loading the again it reloads automatically without touching it so
// remove it, the system should launch once per user's request." This app
// ships a new build almost every round (sw.js's own cache version bumps
// nearly every commit) -- checkForUpdate() below runs hourly AND on every
// tab focus/visibility change, so a member who simply switches back to
// this tab after using another app for a few minutes was very likely to
// have a new service worker already waiting, take control
// (controllerchange), and get bounced straight back to the loading
// screen via an UNPROMPTED location.reload() -- exactly "reloads
// automatically without touching it." Genuine auto-update behavior, not
// a bug in the sense of doing the wrong thing, but the owner explicitly
// doesn't want the app ever reloading itself outside of the member's own
// action of launching it. Fixed by dropping the forced reload entirely --
// the new service worker still activates and takes over in the
// background exactly as before (clients.claim() is unchanged, sw.js
// itself untouched), so the NEXT genuine launch (closing and reopening
// the app, or a manual browser refresh) already serves the fresh shell
// via sw.js's own network-first navigation strategy, with zero silent
// interruption of whatever the member is doing right now.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // register() normally resolves WITH a registration, but it can resolve
      // with nothing where service workers are blocked by policy or by the
      // browser. Unguarded, the first visibilitychange after that threw
      // "Cannot read properties of undefined (reading 'update')" -- harmless
      // to the member, but a real uncaught error on every return to the app.
      if (!reg) return;
      const checkForUpdate = () => reg.update().catch(() => {});
      setInterval(checkForUpdate, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
      window.addEventListener('focus', checkForUpdate);
    }).catch(() => {});
  });
}

// ── MOVING THIS SESSION ONTO A DIFFERENT ADDRESS ──
// ── START ──
captureReferralFromUrl();
// Asked alongside boot() rather than before it: one extra round trip in
// front of the loading screen would slow down every single arrival to buy a
// decision that, most of the time, is "stay where you are". If the answer is
// "move", the page navigates and whatever boot() had started is discarded
// with it.
// The dialling-code chips are static "+256" in the markup; a returning
// device already knows its region from localStorage (restoreRegion above),
// so paint them from it before the first network reply lands rather than
// showing Uganda's code to a Kenyan for a beat.
paintRegionChrome();
// Same reasoning for the language: the country's allowed list came back with
// the region and was cached with it, so a returning device opens straight
// into the language it was left in instead of showing English until
// /public/settings lands. The observer is started first so anything the boot
// path renders is translated as it appears, not after a visible flash.
startI18nObserver();
applyRegionLanguages();
var _bootPromise = boot();
