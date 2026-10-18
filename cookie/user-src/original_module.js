// Cookie backend, on the same Hostinger VPS as this frontend (pm2, port 3000
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
// currency, ie fgdr.cookie-platform.com in ugx, and country code changeable
// to other country or created, and another can be sfhd.cookie-platform in
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
var REGION = { key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256', localLength: 9, prefixes: ['7'], utcOffsetMin: 180, isDefault: true, languages: ['en'], defaultLang: 'en' };
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
var LANG_STORE_KEY = 'cookie_lang';
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
  ['Enter your password.', 'Wandiika ekisumuluzo kyo.', 'Weka nenosiri lako.', 'Entrez votre mot de passe.', 'Andika ijambobanga ryawe.', 'Handiika ekisumuruzo kyaawe.'],
  ['How it works', 'Engeri gye kikolamu', 'Jinsi inavyofanya kazi', 'Comment \u00e7a marche', 'Uko bikora', 'Oku kirikukora'],
  ['Login password changed', 'Ekisumuluzo ky\'okuyingira kikyusiddwa', 'Nenosiri la kuingia limebadilishwa', 'Mot de passe de connexion modifi\u00e9', 'Ijambobanga ryo kwinjira ryahinduwe', 'Ekisumuruzo ky\'okutaaha kihindwiirwe'],
  ['New Login Password', 'Ekisumuluzo Ekiggya eky\'Okuyingira', 'Nenosiri Jipya la Kuingia', 'Nouveau mot de passe de connexion', 'Ijambobanga rishya ryo kwinjira', 'Ekisumuruzo Ekisya ky\'Okutaaha'],
  ['No messages yet.', 'Tewali bubaka.', 'Hakuna ujumbe bado.', 'Aucun message pour l\'instant.', 'Nta butumwa buraboneka.', 'Tihariho butumwa.'],
  ['No more data', 'Tewali birala', 'Hakuna data zaidi', 'Plus de donn\u00e9es', 'Nta bindi bihari', 'Tihariho bindi'],
  ['No products yet.', 'Tewali byamaguzi.', 'Hakuna bidhaa bado.', 'Aucun produit pour l\'instant.', 'Nta bicuruzwa biraboneka.', 'Tihariho byamaguzi.'],
  ['Nothing here yet.', 'Tewali kantu wano.', 'Hakuna kitu hapa bado.', 'Rien ici pour l\'instant.', 'Nta kintu kiraboneka hano.', 'Tihariho kintu hanu.'],
  ['Old Login Password', 'Ekisumuluzo Ekikadde eky\'Okuyingira', 'Nenosiri la Zamani la Kuingia', 'Ancien mot de passe de connexion', 'Ijambobanga rya kera ryo kwinjira', 'Ekisumuruzo Ekikuru ky\'Okutaaha'],
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
  ['Select Payment Method', 'Londa Engeri y\'Okusasula', 'Chagua Njia ya Malipo', 'Choisissez le mode de paiement', 'Hitamo uburyo bwo kwishyura', 'Toorana Omuringo gw\'Okushashura'],
  ['Select wallet provider', 'Londa kkampuni y\'ensawo', 'Chagua mtoa huduma wa pochi', 'Choisissez l\'op\u00e9rateur du portefeuille', 'Hitamo utanga serivisi y\'umufuka', 'Toorana kampuni y\'ensaho'],
  ['Tap to retry', 'Nyiga oddemu ogezeeko', 'Gusa ujaribu tena', 'Appuyez pour r\u00e9essayer', 'Kanda wongere ugerageze', 'Kanda ogarukyemu'],
  ['Transaction expires later', 'Okusasula kuggwaako oluvannyuma', 'Muamala utaisha baadaye', 'La transaction expire plus tard', 'Ubwishyu buzarangira nyuma', 'Okushashura nikuhwaho bwanyima'],
  ['Your payment account:', 'Akawunti yo ey\'okusasula:', 'Akaunti yako ya malipo:', 'Votre compte de paiement :', 'Konti yawe yo kwishyura:', 'Akaunti yaawe y\'okushashura:'],
  ['account and make payment', 'akawunti osasule', 'akaunti na ulipe', 'compte et effectuez le paiement', 'konti maze wishyure', 'akaunti oshashure'],
  ['Already have an account?', 'Olina dda akawunti?', 'Tayari una akaunti?', 'Vous avez d\u00e9j\u00e0 un compte ?', 'Usanzwe ufite konti?', 'Oine akaunti?'],
  ['Enter a valid amount', 'Wandiika omuwendo omutuufu', 'Weka kiasi sahihi', 'Entrez un montant valide', 'Andika ingano nyayo', 'Handiika omuhendo ogurikwecwera'],
  ['Enter a valid amount.', 'Wandiika omuwendo omutuufu.', 'Weka kiasi sahihi.', 'Entrez un montant valide.', 'Andika ingano nyayo.', 'Handiika omuhendo ogurikwecwera.'],
  ['Enter treasure chest key', 'Wandiika ekisumuluzo ky\'essanduku', 'Weka ufunguo wa sanduku la hazina', 'Entrez la cl\u00e9 du coffre au tr\u00e9sor', 'Andika urufunguzo rw\'agasanduku', 'Handiika ekishumuruzo ky\'esanduuku'],
  ['Recharge time: 7*24 hours.', 'Osobola okuteeka ssente essaawa 24, ennaku 7.', 'Muda wa kuweka pesa: saa 24, siku 7.', 'Recharge disponible 24 h/24, 7 j/7.', 'Ushobora kubitsa amasaha 24 ku munsi, iminsi 7.', 'Nobaasa kuta sente eshaaha 24, ebiro 7.'],
  ['Select your wallet provider.', 'Londa kkampuni y\'ensawo yo.', 'Chagua mtoa huduma wa pochi yako.', 'Choisissez l\'op\u00e9rateur de votre portefeuille.', 'Hitamo utanga serivisi y\'umufuka wawe.', 'Toorana kampuni y\'ensaho yaawe.'],
  ['Bind your wallet before withdrawing.', 'Teekawo ensawo yo nga tonnaggyamu ssente.', 'Sajili pochi yako kabla ya kutoa pesa.', 'Enregistrez votre portefeuille avant de retirer.', 'Andikisha umufuka wawe mbere yo kubikuza.', 'Taho ensaho yaawe otakaihiremu sente.'],
  ['Choose PAY-A or PAY B', 'Londa PAY-A oba PAY B', 'Chagua PAY-A au PAY B', 'Choisissez PAY-A ou PAY B', 'Hitamo PAY-A cyangwa PAY B', 'Toorana PAY-A nari PAY B'],
  ['Click to refresh the results.', 'Nyiga oddemu olabe ebivudde mu.', 'Bonyeza ili kuonyesha matokeo upya.', 'Cliquez pour actualiser les r\u00e9sultats.', 'Kanda kugira ngo uvugurure ibisubizo.', 'Kanda ogarukyemu oreebe ebyarugiremu.'],
  ['Could not load your plans.', 'Tetusobodde kuggya nteekateeka zo.', 'Imeshindwa kupakia mipango yako.', 'Impossible de charger vos plans.', 'Ntibyashobotse gupakira gahunda zawe.', 'Tikibaasiki kureeta enteekateeka zaawe.'],
  ['Daily spin & bonus wins', 'Okuzungusa buli lunaku n\'ebirabo', 'Kuzungusha kila siku na zawadi', 'Tour quotidien et gains bonus', 'Kuzunguza buri munsi n\'ibihembo', 'Okuzengurutsa buri izooba n\'ebirabo'],
  ['Enter the account holder name.', 'Wandiika erinnya lya nnannyini akawunti.', 'Weka jina la mwenye akaunti.', 'Entrez le nom du titulaire du compte.', 'Andika izina rya nyir\'ikonti.', 'Handiika eiziina rya nyiini akaunti.'],
  ['Enter your current login password.', 'Wandiika ekisumuluzo kyo eky\'okuyingira ekiriwo kati.', 'Weka nenosiri lako la sasa la kuingia.', 'Entrez votre mot de passe de connexion actuel.', 'Andika ijambobanga ryawe ryo kwinjira urimo gukoresha.', 'Handiika ekisumuruzo kyaawe ky\'okutaaha ekiriho hati.'],
  ['Insufficient balance, redirecting to deposit\u2026', 'Ssente tezimala, tukutwala ku kuteeka ssente\u2026', 'Salio halitoshi, tunakupeleka kuweka pesa\u2026', 'Solde insuffisant, redirection vers le d\u00e9p\u00f4t\u2026', 'Amafaranga ntahagije, turimo kukujyana mu kubitsa\u2026', 'Sente tizihikire, nituukutwara aha kuta sente\u2026'],
  ['Please enter your payment account', 'Wandiika akawunti yo ey\'okusasula', 'Tafadhali weka akaunti yako ya malipo', 'Veuillez saisir votre compte de paiement', 'Nyamuneka andika konti yawe yo kwishyura', 'Handiika akaunti yaawe y\'okushashura'],
  ['Please select a payment method', 'Londa engeri y\'okusasula', 'Tafadhali chagua njia ya malipo', 'Veuillez choisir un mode de paiement', 'Nyamuneka hitamo uburyo bwo kwishyura', 'Toorana omuringo gw\'okushashura'],
  ['Please select the operator first', 'Sooka olonde kkampuni', 'Tafadhali chagua mtoa huduma kwanza', 'Veuillez d\'abord choisir l\'op\u00e9rateur', 'Nyamuneka banza uhitemo utanga serivisi', 'Banza otoorane kampuni'],
  ['Send us your payment message', 'Tuweereze obubaka bw\'okusasula', 'Tutumie ujumbe wa malipo yako', 'Envoyez-nous votre message de paiement', 'Twoherereze ubutumwa bw\'ubwishyu bwawe', 'Otwohereze obutumwa bw\'okushashura'],
  ['Showing your most recent records', 'Tulaga ebiwandiiko byo ebisembyeyo', 'Tunaonyesha rekodi zako za hivi karibuni', 'Affichage de vos enregistrements les plus r\u00e9cents', 'Twerekana amateka yawe ya vuba', 'Nituyoreka ebihandiiko byaawe ebya hati'],
  ['Buying products earns you extra spins.', 'Okugula ebyamaguzi kukuwa okuzungusa okulala.', 'Kununua bidhaa kunakupa nafasi zaidi za kuzungusha.', 'Acheter des produits vous donne des tours suppl\u00e9mentaires.', 'Kugura ibicuruzwa bikugeza ku mahirwe yo kuzunguza.', 'Okugura ebyamaguzi nikikuha okuzengurutsa okundi.'],
  ['Enter a valid wallet account number.', 'Wandiika ennamba ya akawunti y\'ensawo entuufu.', 'Weka namba sahihi ya akaunti ya pochi.', 'Entrez un num\u00e9ro de compte de portefeuille valide.', 'Andika nimero nyayo ya konti y\'umufuka.', 'Handiika enamba ya akaunti y\'ensaho erikwecwera.'],
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
  ['Earn daily wages by inviting members to invest.', 'Funa ssente buli lunaku ng\'oyita abantu okuteekamu ssente.', 'Pata malipo kila siku kwa kualika wengine kuwekeza.', 'Gagnez chaque jour en invitant des membres \u00e0 investir.', 'Injiza amafaranga buri munsi utumira abandi gushora.', 'Tunga sente buri izooba oyeta abantu kuteeramu sente.'],
  ['One free spin every day, resetting at midnight.', 'Okuzungusa kumu kwa bwereere buli lunaku, nga kuddamu ku ttumbi.', 'Nafasi moja ya bure ya kuzungusha kila siku, inarudia usiku wa manane.', 'Un tour gratuit chaque jour, r\u00e9initialis\u00e9 \u00e0 minuit.', 'Kuzunguza rimwe ku buntu buri munsi, bisubirana saa sita z\'ijoro.', 'Okuzengurutsa rumwe okw\'obusa buri izooba, nikugarukamu aha kiro.'],
  ['Paste the payment SMS or transaction ID first', 'Sooka oteeke obubaka bw\'okusasula oba nnamba y\'okusasula', 'Kwanza bandika SMS ya malipo au namba ya muamala', 'Collez d\'abord le SMS de paiement ou l\'identifiant de la transaction', 'Banza ushyiremo SMS y\'ubwishyu cyangwa nimero y\'ubwishyu', 'Banza ota obutumwa bw\'okushashura nari enamba y\'okushashura'],
  ['Invite friends. Earn when they buy their first product.', 'Yita mikwano gyo. Ofuna ssente nga bagudde ekyamaguzi kyabwe ekisooka.', 'Alika marafiki. Unapata pesa wanaponunua bidhaa yao ya kwanza.', 'Invitez vos amis. Gagnez lorsqu\'ils ach\u00e8tent leur premier produit.', 'Tumira inshuti. Winjiza amafaranga igihe baguze igicuruzwa cyabo cya mbere.', 'Yeta abanywani baawe. Notunga sente ku barikugura ekyamaguzi kyabo eky\'okubanza.'],
  ['Share your link, create your wealth, improve your life.', 'Gaba lyanka lyo, okole obugagga bwo, otereeze obulamu bwo.', 'Shiriki kiungo chako, jenga utajiri wako, boresha maisha yako.', 'Partagez votre lien, b\u00e2tissez votre richesse, am\u00e9liorez votre vie.', 'Sangiza umurongo wawe, wubake ubutunzi bwawe, unoze ubuzima bwawe.', 'Gabana orunyiriri rwaawe, okore obugaiga bwaawe, otebeekanise amagara gaawe.'],
  ['We\'re getting ready. Come back once the countdown ends.', 'Tukyeteekateeka. Komawo essaawa bwe zinaggwaako.', 'Tunajiandaa. Rudi hesabu ya kurudi nyuma itakapoisha.', 'Nous nous pr\u00e9parons. Revenez \u00e0 la fin du compte \u00e0 rebours.', 'Turimo kwitegura. Garuka igihe kubara kuzarangira.', 'Nitweteekateeka. Garuka obu obwire burihwaho.'],
  ['Your new password must be at least 10 characters.', 'Ekisumuluzo kyo ekiggya kiteekwa okuba n\'obubonero obutasinga mu 10.', 'Nenosiri lako jipya lazima liwe na angalau herufi 10.', 'Votre nouveau mot de passe doit comporter au moins 10 caract\u00e8res.', 'Ijambobanga ryawe rishya rigomba kuba rifite nibura inyuguti 10.', 'Ekisumuruzo kyaawe ekisya kishemereire kugira obubonero obukiri 10.'],
  ['If deposit is not received, please contact TG customer service.', 'Ssente bwe zitatuuka, tuukirira obuyambi ku TG.', 'Ikiwa malipo hayajapokelewa, tafadhali wasiliana na huduma kwa wateja kwenye TG.', 'Si le d\u00e9p\u00f4t n\'est pas re\u00e7u, contactez le service client sur TG.', 'Niba amafaranga atakiriwe, nyamuneka vugana na serivisi z\'abakiriya kuri TG.', 'Sente ku zitarikuhika, otukirire obuhwezi aha TG.'],
  ['The payment is expected to be successful in 2-10 minutes.', 'Okusasula kusuubirwa okuggwa mu ddakiika 2-10.', 'Malipo yanatarajiwa kukamilika ndani ya dakika 2-10.', 'Le paiement devrait aboutir en 2 \u00e0 10 minutes.', 'Ubwishyu buteganyijwe kurangira mu minota 2-10.', 'Okushashura nikwetegyerezibwa kuhwa omu dakiika 2-10.'],
  ['Your new password must be different from the old one.', 'Ekisumuluzo kyo ekiggya kiteekwa okuba ekitali kye kikadde.', 'Nenosiri lako jipya lazima liwe tofauti na la zamani.', 'Votre nouveau mot de passe doit \u00eatre diff\u00e9rent de l\'ancien.', 'Ijambobanga ryawe rishya rigomba gutandukana n\'irya kera.', 'Ekisumuruzo kyaawe ekisya kishemereire kuba ekitari kiri ekikuru.'],
  ['Customer service is not set up yet. Please try again later.', 'Obuyambi eri abaguzi tebunnateekebwawo. Ddamu ogezeeko oluvannyuma.', 'Huduma kwa wateja haijawekwa bado. Tafadhali jaribu tena baadaye.', 'Le service client n\'est pas encore configur\u00e9. R\u00e9essayez plus tard.', 'Serivisi z\'abakiriya ntiziratunganywa. Nyamuneka ongera ugerageze nyuma.', 'Obuhwezi bw\'abaguzi tiburateebwaho. Ogarukyemu bwanyima.'],
  ['Your balance will be updated automatically once the payment is confirmed.', 'Ssente zo zijja kukyusibwa zokka okusasula bwe kunaakakasibwa.', 'Salio lako litasasishwa lenyewe mara malipo yatakapothibitishwa.', 'Votre solde sera mis \u00e0 jour automatiquement d\u00e8s la confirmation du paiement.', 'Amafaranga yawe azavugururwa wenyine ubwishyu bumaze kwemezwa.', 'Sente zaawe nizihindurwa zoonka okushashura ku kurihamibwa.'],
  ['Not confirmed yet. Approve the payment prompt on your phone, then tap Verify again.', 'Tekunnakakasibwa. Kkiriza obubaka bw\'okusasula ku ssimu yo, oluvannyuma oddemu onyige Kakasa.', 'Bado hayajathibitishwa. Idhinisha ujumbe wa malipo kwenye simu yako, kisha gusa Hakiki tena.', 'Pas encore confirm\u00e9. Approuvez la demande de paiement sur votre t\u00e9l\u00e9phone, puis appuyez de nouveau sur V\u00e9rifier.', 'Ntibiremezwa. Emeza ubutumwa bwo kwishyura kuri telefone yawe, hanyuma wongere ukande Genzura.', 'Tikirahamibwa. Ikiriza obutumwa bw\'okushashura aha simu yaawe, bwanyima ogarukyemu okande Hamya.'],
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
  ['Enter old password', 'Wandiika ekisumuluzo ekikadde', 'Weka nenosiri la zamani', 'Entrez l\'ancien mot de passe', 'Andika ijambobanga rya kera', 'Handiika ekisumuruzo ekikuru'],
  ['Enter new password', 'Wandiika ekisumuluzo ekiggya', 'Weka nenosiri jipya', 'Entrez le nouveau mot de passe', 'Andika ijambobanga rishya', 'Handiika ekisumuruzo ekisya'],
  ['Re-enter new password', 'Ddamu owandiike ekisumuluzo ekiggya', 'Weka tena nenosiri jipya', 'Saisissez à nouveau le nouveau mot de passe', 'Ongera wandike ijambobanga rishya', 'Garuka ohandiike ekisumuruzo ekisya'],
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
// Cookie-specific loader treatment -- the replacement loader shows a plain
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

// ── Cookie v2 design helpers ──
// Money the way the screens print it: currency glued to the figure, no
// spaces. vMoney drops the decimals ("UGX11,000"), vMoney2 always shows them
// ("UGX2,200.00"), which is how balances and totals read.
function vMoney(n){
  const v = Number(n) || 0;
  const hasCents = Math.round(v * 100) % 100 !== 0;
  return cur() + numGroup(v, hasCents);
}
// Long money figures (nine digits and more) step the font down in two sizes so they stay on one line inside their box.
function vFit(text, a, b){ var n = String(text).length; return n > b ? 'v-fit2' : n > a ? 'v-fit1' : ''; }
function vMoney2(n){ return cur() + numGroup(n, true); }
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
// Owner: "l would like to also to edit the app name cookie, so make it when it
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
// make cookie to be default name" -- a hardcoded default is exactly what made
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
// Was `|| 'Cookie'` -- a real bug, not a design choice: with no
// admin-set brandName yet (a fresh Cookie deploy, before the owner has
// opened Admin -> Settings), every sentence-form use of the brand name
// literally rendered the word "Cookie". Cookie is this app's own real name,
// not an inherited-fork placeholder, so it is the correct fallback here --
// unlike the wordmark below, which stays blank on purpose.
function brandName(){
  return brandNameKnown() || 'Cookie';
}
var BRAND_CACHE_KEY = 'cookie_brand_name';
// The wordmark: just the name, in caps. Used to split off the LAST letter
// into an accent colour ("CHIP+Z") -- a pun specific to Cookie's own name
// that means nothing for any other brand, dropped per the owner's "don't
// use anything that was Cookie" instruction rather than carried over as a
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
// along with the rest of its Cookie-derived design) and the browser/tab
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
  try { document.title = pgOpen() ? known + ' Pay' : known; } catch (_) {}
  // Remember it for the next launch. This is the whole fix for "on start up
  // loader it was still saying cookie": the loading screen paints long before
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
try { window._suppressAutofillLogin = sessionStorage.getItem('cookie_relogin_required') === '1'; } catch (_) {}
var _memberSession = window.createCookieIdleSession('cookie_member_session', function(){
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
// ── The dark "Loading" box (spinning rings) and the "No more data" tick box ──
// A page or full page that is opened asks for data; any read that starts in the next 0.9 s shows the box, which stays at least 0.45 s.
var _ckLoadUntil = 0, _ckLoadCount = 0, _ckLoadShownAt = 0, _ckLoadHideTimer = null, _ckOkTimer = null;
function ckExpectLoad(){ _ckLoadUntil = Date.now() + 900; }
function ckBox(){
  let b = document.getElementById('ckBox');
  if (!b) { b = document.createElement('div'); b.id = 'ckBox'; b.className = 'ck-box'; document.body.appendChild(b); }
  return b;
}
var _ckLoadGuard = null;
function ckLoadBegin(){
  _ckLoadCount++;
  // A read that never answers (no signal, server down) must not leave the box on screen: it goes after 12 seconds.
  if (_ckLoadGuard) clearTimeout(_ckLoadGuard);
  _ckLoadGuard = setTimeout(() => { _ckLoadGuard = null; _ckLoadCount = 0; _ckAuthBox = false; const b = document.getElementById('ckBox'); if (b && b.classList.contains('ck-box-load')) b.classList.remove('show'); }, 12000);
  if (_ckLoadCount !== 1) return;
  if (_ckLoadHideTimer) { clearTimeout(_ckLoadHideTimer); _ckLoadHideTimer = null; }
  if (_ckOkTimer) { clearTimeout(_ckOkTimer); _ckOkTimer = null; }
  const b = ckBox(); b.className = 'ck-box ck-box-load'; b.innerHTML = '<span class="ck-spin"></span>';
  void b.offsetWidth; b.classList.add('show'); _ckLoadShownAt = Date.now();
}
function ckLoadEnd(){
  _ckLoadCount = Math.max(0, _ckLoadCount - 1);
  if (_ckLoadCount) return;
  if (_ckLoadGuard) { clearTimeout(_ckLoadGuard); _ckLoadGuard = null; }
  const left = Math.max(0, 450 - (Date.now() - _ckLoadShownAt));
  _ckLoadHideTimer = setTimeout(() => {
    _ckLoadHideTimer = null;
    const b = document.getElementById('ckBox');
    if (!_ckLoadCount && b && b.classList.contains('ck-box-load')) b.classList.remove('show');
  }, left);
}
var _ckOkPending = null, _ckOkPoll = null;
// The tick box waits until every read that the page asked for has finished, then shows once.
window.ckSuccessToast = function(text){
  _ckOkPending = text;
  if (_ckOkPoll) return;
  const tick = () => {
    _ckOkPoll = null;
    if (_ckLoadCount > 0 || Date.now() < _ckLoadUntil) { _ckOkPoll = setTimeout(tick, 120); return; }
    const t = _ckOkPending; _ckOkPending = null; if (!t) return;
    const b = ckBox();
    b.className = 'ck-box ck-box-ok';
    b.innerHTML = '<svg viewBox="14 12 93 68" aria-hidden="true"><path fill="#fff" d="M41.3 79.0C40.9 78.9 40.6 78.7 40.2 78.3C39.5 77.7 34.6 72.9 32.2 70.3C31.4 69.6 28.6 66.7 25.8 63.9C23.1 61.0 20.1 58.0 19.3 57.2C18.4 56.3 17.0 54.8 16.1 53.9C14.4 52.2 14.3 52.1 13.8 50.9C13.2 49.8 13.2 49.8 13.2 48.4C13.2 47.0 13.2 46.9 13.5 46.4C13.7 46.0 13.9 45.5 14.0 45.2C14.6 43.6 16.6 42.6 17.7 43.4C17.9 43.5 18.3 43.7 18.6 43.9C19.0 44.0 19.4 44.3 19.7 44.5C19.9 44.7 20.3 45.0 20.5 45.1C20.7 45.2 20.9 45.4 21.0 45.5C21.1 45.6 21.3 45.8 21.6 45.9C21.8 46.0 22.2 46.3 22.5 46.6C22.8 46.8 23.0 47.0 23.1 47.0C23.2 47.0 23.4 47.2 23.7 47.4C24.0 47.7 24.4 47.9 24.6 48.0C24.7 48.1 25.0 48.3 25.1 48.5C25.2 48.6 25.6 48.8 25.8 49.0C26.1 49.1 26.5 49.4 26.7 49.6C27.0 49.8 27.3 50.0 27.3 50.0C27.4 50.0 27.6 50.2 27.8 50.3C28.0 50.5 28.4 50.8 28.7 51.0C29.0 51.2 29.3 51.4 29.4 51.5C29.5 51.6 29.8 51.8 30.1 52.0C30.5 52.2 30.7 52.4 30.8 52.5C30.8 52.5 31.1 52.8 31.4 52.9C31.7 53.1 32.0 53.4 32.2 53.5C32.3 53.6 32.5 53.8 32.7 53.9C32.9 54.0 33.3 54.3 33.5 54.5C33.8 54.7 34.2 55.0 34.3 55.1C34.5 55.2 34.8 55.4 35.0 55.6C35.2 55.7 35.6 56.0 35.8 56.1C36.0 56.2 36.2 56.4 36.3 56.5C36.4 56.6 36.7 56.8 37.0 57.0C37.2 57.1 37.6 57.4 37.8 57.6C38.0 57.7 38.3 58.0 38.5 58.1C38.7 58.2 39.0 58.4 39.2 58.5C39.4 58.7 40.0 59.1 40.6 59.4C42.0 60.1 42.7 60.2 43.6 59.6C43.8 59.5 44.3 59.2 44.6 59.1C45.0 59.0 45.5 58.7 45.7 58.4C46.0 58.2 46.2 58.0 46.3 58.0C46.3 58.0 46.6 57.8 46.9 57.5C47.2 57.3 47.7 56.8 48.0 56.5C48.4 56.2 48.9 55.8 49.2 55.5C49.4 55.3 49.8 55.1 49.9 55.0C50.1 54.9 50.4 54.6 50.7 54.4C51.0 54.1 51.5 53.7 51.8 53.5C52.8 52.7 53.6 51.9 54.0 51.6C54.2 51.4 54.5 51.2 54.6 51.1C54.7 51.0 55.1 50.8 55.4 50.5C56.6 49.4 57.0 49.1 57.3 48.9C57.5 48.8 57.8 48.5 58.0 48.4C58.3 48.1 59.1 47.4 60.1 46.6C60.4 46.3 60.9 45.9 61.1 45.7C61.4 45.5 61.7 45.2 62.0 45.0C62.2 44.9 62.5 44.6 62.8 44.4C63.0 44.2 63.5 43.8 63.8 43.5C64.7 42.8 65.7 42.0 66.1 41.6C66.3 41.4 66.7 41.1 66.9 40.9C67.2 40.8 67.4 40.5 67.5 40.4C67.6 40.4 67.8 40.2 68.0 40.0C68.2 39.9 68.6 39.6 68.9 39.4C69.2 39.1 69.7 38.7 69.9 38.5C70.1 38.3 70.6 37.9 71.0 37.6C71.3 37.3 71.8 36.9 72.0 36.7C72.3 36.4 72.7 36.1 72.9 36.0C73.1 35.9 73.4 35.6 73.7 35.4C73.9 35.2 74.4 34.8 74.7 34.5C75.1 34.2 75.7 33.7 76.0 33.5C76.2 33.3 76.8 32.8 77.1 32.5C77.4 32.3 77.9 31.9 78.2 31.6C78.4 31.4 78.8 31.1 79.0 31.0C79.3 30.8 79.6 30.5 79.9 30.3C80.1 30.1 80.6 29.7 80.9 29.4C81.8 28.7 82.6 28.1 83.1 27.6C83.4 27.4 83.7 27.1 83.8 27.0C84.1 26.9 84.5 26.5 85.6 25.5C85.8 25.3 86.2 25.0 86.4 24.9C86.5 24.8 86.8 24.6 87.0 24.4C87.1 24.3 87.6 23.9 87.9 23.6C88.3 23.3 88.8 22.9 89.1 22.6C89.3 22.4 89.7 22.1 89.9 22.0C90.1 21.9 90.5 21.6 90.7 21.4C91.0 21.1 91.5 20.7 91.8 20.4C92.6 19.8 93.5 19.0 94.0 18.6C94.3 18.4 94.6 18.1 94.8 17.9C95.1 17.8 95.3 17.6 95.4 17.5C95.5 17.4 95.7 17.1 96.0 17.0C96.5 16.6 97.3 16.0 97.7 15.6C97.9 15.4 98.2 15.1 98.5 15.0C98.7 14.8 98.9 14.6 98.9 14.5C99.0 14.5 99.2 14.3 99.4 14.2C99.6 14.1 99.9 13.8 100.2 13.6C101.4 12.4 102.6 11.9 104.4 12.0C105.7 12.1 105.9 12.2 106.2 13.2C106.8 15.3 106.6 15.9 103.5 19.0C102.2 20.4 99.3 23.3 97.1 25.5C94.9 27.8 91.5 31.2 89.6 33.1C86.4 36.4 81.0 41.8 77.6 45.2C76.8 46.1 73.7 49.3 70.6 52.4C67.6 55.5 64.3 58.9 63.3 59.9C62.3 60.8 60.7 62.5 59.7 63.5C58.8 64.5 55.9 67.4 53.4 69.9C46.7 76.7 45.4 78.0 45.3 78.0C45.3 78.0 45.0 78.2 44.8 78.4C44.5 78.6 44.1 78.8 43.9 78.9C43.6 79.0 43.3 79.0 43.1 79.1C42.6 79.2 42.0 79.2 41.3 79.0Z"/></svg><span>' + esc(t) + '</span>';
    void b.offsetWidth; b.classList.add('show');
    if (_ckOkTimer) clearTimeout(_ckOkTimer);
    _ckOkTimer = setTimeout(() => { _ckOkTimer = null; b.classList.remove('show'); }, 2000);
  };
  _ckOkPoll = setTimeout(tick, 120);
};
// A figure that counts up (or down) to its value instead of jumping: the Available balance when Deposit/Withdraw open, and the Pay / Withdraw
// buttons as the amount is typed.
function ckTween(el, to, fmt, ms){
  if (!el) return;
  if (el._raf) { cancelAnimationFrame(el._raf); el._raf = 0; }
  const from = Number.isFinite(el._v) ? el._v : 0;
  if (from === to || typeof requestAnimationFrame !== 'function') { el.textContent = fmt(to); el._v = to; return; }
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    const v = k >= 1 ? to : from + (to - from) * e;
    el.textContent = fmt(v); el._v = v;
    if (k < 1) el._raf = requestAnimationFrame(step); else el._raf = 0;
  };
  el._raf = requestAnimationFrame(step);
}
// How long the Available / Balance figure, and the Pay / Withdraw buttons as an amount is typed, take to count: the admin's setting (seconds), 3 by default.
function ckBalanceMs(){ return Math.min(15000, Math.max(1000, (Number((STATE.settings || {}).balanceCountSeconds) || 3) * 1000)); }
var _apiPending = new Map();
// The server's clock against this phone's: any answer that carries serverNow (the investments list) refreshes it. The settlement countdown
// counts to midnight on the SERVER's clock, so a phone set minutes fast or slow still shows the real time left.
var _clockSkew = 0, _clockRtt = Infinity, _clockAt = 0;
function ckSyncClock(serverNow, sentAt, gotAt){
  const rtt = gotAt - sentAt;
  if (!(Number.isFinite(serverNow) && rtt >= 0 && rtt < 5000)) return;
  if (rtt <= _clockRtt * 1.5 + 50 || gotAt - _clockAt > 60000) { _clockSkew = serverNow - (sentAt + gotAt) / 2; _clockRtt = rtt; _clockAt = gotAt; }
}
function ckNow(){ return Date.now() + _clockSkew; }
function api(path, opts){
  const tracked = Date.now() < _ckLoadUntil && !(opts && (opts.body || opts.signal || (opts.method && opts.method !== 'GET')));
  if (tracked) ckLoadBegin();
  const sentAt = Date.now();
  const pr = apiShared(path, opts);
  pr.then(r => { if (r && typeof r.serverNow === 'number') ckSyncClock(r.serverNow, sentAt, Date.now()); }, () => {});
  if (tracked) pr.then(ckLoadEnd, ckLoadEnd);
  return pr;
}
function apiShared(path, opts){
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
    if (!isPublicCall && data.code === 'MAINTENANCE') { STATE.settings = Object.assign({}, STATE.settings || {}, { maintenanceMode: true, maintenanceMsg: data.message || '' }); showMaintenanceScreen(data.message); }
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
  return (bare ? local : dial() + local) + '@cookie-platform.com';
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
  // The new form always starts from the top, so a taller form never leaves the page scrolled and the picture jumping into place.
  try { window.scrollTo(0, 0); const sc = document.querySelector('#authHero .va-scroll'); if (sc) sc.scrollTop = 0; } catch (_) {}
  stopSmsCodeListener();
}
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
// The button keeps its own word (LOGIN / REGISTER) and is only dimmed; the loading box shows over the page while the answer is awaited.
var _ckAuthBox = false;
function ckAuthBoxEnd(){ if (_ckAuthBox) { _ckAuthBox = false; ckLoadEnd(); } }
function setBtnLoading(id, loading, label, busy){
  const btn = $(id);
  btn.disabled = loading;
  btn.textContent = label;
  if (loading && !_ckAuthBox) { _ckAuthBox = true; ckLoadBegin(); }
  else if (!loading) ckAuthBoxEnd();
}
function fbErrMsg(e){
  const code = e && e.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'Incorrect phone number or password.';
  if (code === 'auth/user-not-found') return 'No account found for that number.';
  if (code === 'auth/email-already-in-use') return 'An account with that number already exists.';
  if (code === 'auth/weak-password') return 'Password must be at least 10 characters.';
  if (code === 'auth/common-password') return 'That password is too easy to guess. Choose a different one, for example a few letters and numbers that only you know.';
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
// "<digits>@cookie-platform.com" kept showing. The Firebase address is a
// pure function of the phone number, so nothing is lost by not storing it:
// tryAutoSignIn() rebuilds it with loginAddressCandidates().
async function storeCredentialIfPossible(email, pass, displayPhone){
  if (!credManSupported()) return;
  const local = displayPhone ? localDigits(displayPhone) : null;
  const id = local ? '0' + local : email;
  try { await navigator.credentials.store(new PasswordCredential({ id, password: pass, name: id })); } catch (_) {}
}
// ── THE LAST SIGNED-IN NUMBER AND PASSWORD, KEPT ON THIS DEVICE ──
// Owner: after a session ends, or after signing out, the number and password stay in the Login boxes so the member only taps Login.
// Only the member who last signed in on this device is kept (the next member to sign in replaces it); nothing signs in by itself.
var SAVED_LOGIN_KEY = 'cookie_saved_login';
function savedLoginGet(){
  try {
    const raw = localStorage.getItem(SAVED_LOGIN_KEY); if (!raw) return null;
    const o = JSON.parse(decodeURIComponent(escape(atob(raw))));
    return o && typeof o.phone === 'string' && typeof o.pass === 'string' ? o : null;
  } catch (_) { return null; }
}
function savedLoginSet(phone, pass){
  try {
    if (!localDigits(phone) || !pass) return;
    localStorage.setItem(SAVED_LOGIN_KEY, btoa(unescape(encodeURIComponent(JSON.stringify({ phone: String(phone).trim(), pass: String(pass) })))));
  } catch (_) {}
}
// A password that no longer works (changed elsewhere, or reset by the admin) is forgotten; the number stays.
function savedLoginDropPass(){
  const o = savedLoginGet(); if (!o) return;
  try { localStorage.setItem(SAVED_LOGIN_KEY, btoa(unescape(encodeURIComponent(JSON.stringify({ phone: o.phone, pass: '' }))))); } catch (_) {}
}
function savedLoginFill(force){
  const o = savedLoginGet(), ph = $('loginPhone'), pw = $('loginPassword');
  if (!o || !ph || !pw) return;
  if (!force && (ph.value || pw.value)) return;   // never over what someone has typed
  ph.value = o.phone; pw.value = o.pass;
}
document.addEventListener('input', e => {
  // Typing a different number: the kept password belongs to the other number, so it goes from the box.
  if (!e.target || e.target.id !== 'loginPhone') return;
  const o = savedLoginGet(), pw = $('loginPassword');
  if (o && pw && o.pass && pw.value === o.pass && localDigits(e.target.value) !== localDigits(o.phone)) pw.value = '';
});
window.doLogin = async function(){
  if (window._loginInProgress) return;
  window._loginInProgress = true;
  try {
  if (window._logoutPromise) await window._logoutPromise;
  const phone = cleanPhone($('loginPhone').value);
  const pass = $('loginPassword').value;
  if (!phone) return notify('Please enter a valid phone number');
  if (!pass) return notify('Enter your password.');
  setBtnLoading('loginBtn', true, 'Login', 'Logging in…');
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
    savedLoginSet($('loginPhone').value, pass);
  }
  catch (e) {
    window._pendingLoginSuccess = false;
    const bad = e && (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password');
    const kept = savedLoginGet();
    if (bad && kept && kept.pass === pass && localDigits(kept.phone) === localDigits(phone)) { savedLoginDropPass(); $('loginPassword').value = ''; }
    notify(fbErrMsg(e));
    setBtnLoading('loginBtn', false, 'Login');
  }
  } finally {
    window._loginInProgress = false;
    if (!window._suppressAutofillLogin) window._autofillLoginTried = false;
    setBtnLoading('loginBtn', false, 'Login');
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
// Android Chrome can hand the code straight to the page when the SMS ends
// with the "@host #code" line the server adds (see otpSmsText() in
// server.js): one tap on the system prompt fills the box. Anywhere else the
// feature test fails and nothing changes -- the member just types it.
var _webOtpAbort = null;
function stopSmsCodeListener(){
  if (_webOtpAbort) { try { _webOtpAbort.abort(); } catch (_) {} _webOtpAbort = null; }
}
window.doRegister = async function(){
  const phone = cleanPhone($('regPhone').value);
  const pass = $('regPassword').value;
  const pass2 = $('regPassword2').value;
  // Referral code box is prefilled from ?ref= (see captureReferralFromUrl)
  // but stays editable -- whatever's in the box at submit time wins,
  // whether that's the link's code, untouched, or something typed by hand.
  // The referral code is optional.
  const referral = $('regReferral').value.trim();
  if (!phone) return regError('Please enter a valid phone number');
  if (!pass || pass.length < 10) return regError('Password must be at least 10 characters.');
  if (pass !== pass2) return regError('The two passwords do not match.');
  regError('');
  // See firebaseReady(): without the sign-in service there is nothing to
  // create the account with, and the code below would only throw at the member.
  if (!(window.fbCreateUser && window.fbAuth)) {
    setBtnLoading('regBtn', true, 'Register', 'Connecting…');
    const ready = await firebaseReady(8000, 'fbCreateUser');
    setBtnLoading('regBtn', false, 'Register');
    if (!ready) return regError('Sign-up is not available right now. Check your connection and try again.');
  }
  setBtnLoading('regBtn', true, 'Register', 'Creating your account…');
  STATE.refCode = referral;
  window._pendingRegPhone = phone;
  try {
    const email = phoneToEmail(phone);
    await window.fbCreateUser(email, pass);
    storeCredentialIfPossible(email, pass, phone);
    savedLoginSet($('regPhone').value, pass);
  }
  catch (e) {
    // Owner-reported real bug: a Firebase Auth account can exist with no
    // matching Cookie profile -- e.g. an earlier registration attempt whose
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
    // erroring). window._pendingRegPhone is already set
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
        savedLoginSet($('regPhone').value, pass);
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
    window._pendingRegPhone = '';
    regError(fbErrMsg(e));
    setBtnLoading('regBtn', false, 'Register');
  }
};
// ── FORGOT PASSWORD: phone -> OTP -> new password, one screen ──
window.doLogout = function(opts){
  if (window._logoutPromise) return window._logoutPromise;
  // Signing out by hand shows the loading box until the server has really ended the session and the member is back at Login.
  const manual = !(opts && opts.auto);
  if (manual) ckLoadBegin();
  window._logoutPromise = performMemberLogout(opts).finally(() => { window._logoutPromise = null; if (manual) ckLoadEnd(); });
  return window._logoutPromise;
};
async function performMemberLogout(opts){
  // {auto:true} marks an AUTOMATIC sign-out (the idle-session timeout
  // above) rather than the member tapping Log Out themselves. Owner: "auto
  // login when Google details are put, it fails to login automatically, so
  // l have to press button, why" -- traced to this function: every logout,
  // idle-triggered or not, was permanently setting the SAME
  // cookie_relogin_required flag that blocks Chrome's autofill-then-submit
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
  // The Login boxes keep this device's own number and password (see savedLoginFill()), after a sign-out as after an expired session.
  // Revoke the captured session without delaying the UI sign-out. The normal
  // api() epoch guard would intentionally cancel this call during logout.
  const leavingUser = window.fbAuth && window.fbAuth.currentUser;
  const serverEnded = leavingUser ? leavingUser.getIdToken().then(token => {
    // AbortSignal.timeout() does not exist on older phones: a throw here would skip the server logout and leave the token valid for hours.
    const ac = new AbortController(); setTimeout(() => ac.abort(), 5000);
    return fetch(API_BASE + '/auth/session/logout', { method:'POST', headers:{Authorization:'Bearer ' + token}, signal: ac.signal });
  }).catch(() => {}) : Promise.resolve();
  // A sign-out the member asked for waits (at most 5 seconds) for the server to end the session, so the loading box is a real wait.
  if (!auto) { try { await serverEnded; } catch (_) {} }
  _memberSession.clear();
  resetOverlayState();
  window._triedAutoSignIn = true;
  if (!auto) { try { sessionStorage.setItem('cookie_relogin_required', '1'); } catch (_) {} }
  // Signing out always lands on Login, even when this visitor last used Sign Up.
  showAuthTab('login');
  savedLoginFill(true);
  stopLiveRefresh();
  // Defense in depth alongside the _openSheetTitle fix on the checkin
  // countdown's own tick: a sign-out that happens to land while Daily
  // Check-in is still open shouldn't leave this ticking into a signed-out
  // session either.
  if (_checkinCountdownTimer) { clearInterval(_checkinCountdownTimer); _checkinCountdownTimer = null; }
  STATE.authEpoch++;
  Object.assign(STATE, { account: null, investments: null, teamStats: null, teamMembers: {1:null,2:null,3:null}, bankAccounts: null, transactions: null, messages: null, page: 'home' }); _teamMembersAt = {}; _teamMembersFailed = {};
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
// to wait on about 1.3 MB of JSON, and 900 KB of it was /public/cookie-images
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
var LOADER_MIN_MS = 2500, _ldTimer = null, _ldOutTimer = null;
function hideLoadingScreen(){
  const ls = $('loadingScreen'); if (!ls) return;
  try { startArtwork(); } catch (_) {}
  const began = Number(window._cookieLoaderStart) || 0;
  const minMs = typeof window._cookieLoaderMinMs === 'number' ? window._cookieLoaderMinMs : LOADER_MIN_MS;
  const wait = began ? Math.max(0, minMs - (Date.now() - began)) : 0;
  if (_ldTimer) { clearTimeout(_ldTimer); _ldTimer = null; }
  const done = () => {
    try { if (typeof window._ckLoaderDone === 'function') window._ckLoaderDone(); } catch (_) {}
    // The loading screen fades away instead of vanishing.
    ls.classList.add('ld-out');
    if (_ldOutTimer) clearTimeout(_ldOutTimer);
    _ldOutTimer = setTimeout(() => { _ldOutTimer = null; ls.style.display = 'none'; ls.classList.remove('ld-out'); }, 300);
  };
  if (!wait) { done(); return; }
  _ldTimer = setTimeout(() => { _ldTimer = null; done(); }, wait);
}
function showLoadingScreen(){
  if (_ldTimer) { clearTimeout(_ldTimer); _ldTimer = null; }
  if (_ldOutTimer) { clearTimeout(_ldOutTimer); _ldOutTimer = null; }
  $('loadingScreen').classList.remove('ld-out');
  $('loadingScreen').style.display = 'flex';
}
// A page's blocks (cards, tabs, lists, rows) fade in and rise about 22 px one after another, the way the owner's recording shows.
// Only a change of tab, or opening a full page, plays it; the quiet refreshes that repaint the same page never replay it.
function ckStagger(root){
  let n = 0;
  Array.from(root.children).forEach(k => {
    if (k.classList.contains('ck-hd') || k.tagName === 'HEADER') return;
    const kids = k.classList && (k.classList.contains('ck-sub') || k.classList.contains('v-page') || k.classList.contains('ck-pw') || k.classList.contains('ck-wd') || k.classList.contains('ck-dep') || k.classList.contains('ck-inc') || k.classList.contains('ck-bind')) ? Array.from(k.children) : [k];
    kids.forEach(x => {
      if (x.classList.contains('ck-hd') || x.tagName === 'HEADER') return;
      x.classList.remove('ck-rise'); x.style.animationDelay = Math.min(n, 6) * 80 + 'ms'; void x.offsetWidth; x.classList.add('ck-rise'); n++;
    });
  });
}
(function(){
  if (!window.MutationObserver) return;
  const host = document.getElementById('pageHost'), body = document.getElementById('sheetBody');
  let lastPage = null, lastSeq = -1, lastShell = false;
  // A page that has to read from the database first opens as its header alone (.ck-shell); the finished page then rises ONCE.
  // A page replacing a finished page (a quiet refresh) never plays it again.
  if (host) new MutationObserver(() => {
    const shell = !!host.querySelector('.ck-shell');
    if (STATE.page !== lastPage) { lastPage = STATE.page; lastShell = shell; ckStagger(host); return; }
    if (lastShell && !shell) ckStagger(host);
    lastShell = shell;
  }).observe(host, { childList: true });
  if (body) new MutationObserver(() => {
    if (window._sheetSeq === lastSeq) return;
    lastSeq = window._sheetSeq; ckStagger(body);
  }).observe(body, { childList: true });
})();
var _artPromise = null, _artLanded = false, _annWaiting = false;
function startArtwork(){
  if (_artPromise) return _artPromise;
  _artPromise = Promise.all([ api('/public/announcement-image'), api('/public/cookie-images') ])
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
    STATE.products = p.status === 'success' ? p.products : (STATE.products || []);
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
  STATE.teamHero = (ci.status === 'success' && ci.teamhero) ? ci.teamhero : null;
  STATE.shareHero = (ci.status === 'success' && ci.sharehero) ? ci.sharehero : null;
  STATE.myHero = (ci.status === 'success' && ci.myhero) ? ci.myhero : null;
  STATE.rulesHero = (ci.status === 'success' && ci.ruleshero) ? ci.ruleshero : null;
  STATE.avatarImg = (ci.status === 'success' && ci.avatar) ? ci.avatar : null;
  STATE.recThumb = (ci.status === 'success' && ci.recthumb) ? ci.recthumb : null;
  syncBrandLogoImages();
  // Home's banner carousel, slides 2 and 3 (slide 1 is STATE.homeBanner,
  // fetched separately above -- it predates the carousel). Filtered to
  // whichever are actually set, so 1 or 2 slides render fine too, not only 3.
  STATE.homeSlides2n3 = [
    (ci.status === 'success' && ci.banner2) ? ci.banner2 : null,
  ].filter(Boolean);
  // Optional admin-managed artwork behind the Daily Check-in sheet.
  STATE.checkinBanner = (ci.status === 'success' && ci.checkinbanner) ? ci.checkinbanner : null;
  // The Login / Sign Up backdrop (single full-bleed photo -- see
  // applyAuthBackgrounds()'s own comment on why there is only one now).
  STATE.authHeroImage = (ci.status === 'success' && ci.authhero) ? ci.authhero : null;
  applyAuthTagline();
  applyAuthBackgrounds();
  // Repaint Home for the banner and animated profile artwork. The brand-logo
  // nodes are patched in place above; other art consumers render on open.
  try {
    if ($('app') && $('app').style.display !== 'none') {
      if (STATE.page === 'home') paintHome();
      else if (STATE.page === 'share') paintShare();
      else if (STATE.page === 'account') paintAccount();
      else if (STATE.page === 'network') paintNetwork();
    }
  } catch (_) {}
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
  if (typeof window._cookieLoaderFx === 'function' && s.loaderBgOpacity != null && s.loaderBgBlur != null) window._cookieLoaderFx(s.loaderBgOpacity, s.loaderBgBlur);
}
function applyAuthBackgrounds(){
  const s = STATE.settings || {};
  applyLoaderFx();
  const root = document.documentElement;
  function set(prefix, image, opacityPct, blurPx){
    // url() is built here, so an unset slot yields `none` and the section
    // falls back to the brand gradient (hero) or plain white (card).
    // The quotes matter: a data URL is fine unquoted, but a filename with a
    // bracket or a space would break the declaration silently.
    // Each value is written only when it really changed: re-writing the same custom property restyles the whole page, and the picture
    // (a large data address) must never be re-resolved when nothing about it changed.
    const put = (name, val) => { window._authVars = window._authVars || {}; if (window._authVars[name] === val) return; window._authVars[name] = val; root.style.setProperty(name, val); };
    put('--auth-' + prefix + '-img',
      image ? 'url("' + String(image).replace(/"/g, '\\"') + '")' : 'none');
    const op = Number(opacityPct);
    put('--auth-' + prefix + '-op',
      String(Number.isFinite(op) ? Math.min(100, Math.max(0, op)) / 100 : 1));
    const bl = Number(blurPx);
    put('--auth-' + prefix + '-blur',
      (Number.isFinite(bl) ? Math.min(40, Math.max(0, bl)) : 0) + 'px');
    // A blur of 0 means no filter at all (a 0px blur still makes the browser keep a filter layer for the picture).
    if (prefix === 'hero') put('--auth-hero-filter', Number.isFinite(bl) && bl > 0 ? 'blur(' + Math.min(40, bl) + 'px)' : 'none');
  }
  set('hero', STATE.authHeroImage, s.authHeroOpacity, s.authHeroBlur);
  { const mo = Number(s.myHeroOpacity), mb = Number(s.myHeroBlur);
    root.style.setProperty('--ck-me-op', String(Number.isFinite(mo) ? Math.min(100, Math.max(0, mo)) / 100 : 1));
    root.style.setProperty('--ck-me-blur', (Number.isFinite(mb) ? Math.min(40, Math.max(0, mb)) : 6) + 'px'); }
  const cardOpacity = Number(s.authCardOpacity);
  const cardBlur = Number(s.authCardBlur);
  root.style.setProperty('--auth-card-opacity',
    String(Number.isFinite(cardOpacity) ? Math.min(100, Math.max(0, cardOpacity)) / 100 : .78));
  root.style.setProperty('--auth-card-blur',
    (Number.isFinite(cardBlur) ? Math.min(40, Math.max(0, cardBlur)) : 18) + 'px');
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
  const began = Number(window._cookieLoaderStart) || Date.now();
  return withTimeout(_bootPromise, Math.max(300, (ms || 6000) - (Date.now() - began)));
}
function withTimeout(promise, ms){
  return Promise.race([ promise, new Promise(resolve => setTimeout(resolve, ms)) ]);
}
function captureReferralFromUrl(){
  try { const pm = /^\/payment\/(\d{8,14})\/?$/.exec(location.pathname); if (pm) window._payOrderNo = pm[1]; } catch (_) {}
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
    // The CURRENT shared form: <origin>/h5/#/pages/login/reset?inviteCode=CODE (the code sits after the "#", so it is read from the hash).
    let ref = search.get('inviteCode') || search.get('ref');
    if (!ref && location.hash) {
      const qIdx = location.hash.indexOf('?');
      if (qIdx !== -1) { const hp = new URLSearchParams(location.hash.slice(qIdx + 1)); ref = hp.get('inviteCode') || hp.get('ref'); }
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
// Pulls the public settings while the member is still on the auth screen,
// purely so the Sign Up form can tell the truth about the referral field.
// Failure is silent and simply leaves the field required -- the server is
// the real gate either way.
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
  if (input) input.placeholder = 'Enter Invitation Code';
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
// ── MAINTENANCE ──
// While the admin has Maintenance mode on, a visitor sees the animated maintenance screen instead of the app (also a member who is already inside
// when it is switched on: the server then answers MAINTENANCE and the screen replaces the app). It looks again every 20 seconds, with a real
// read of the public settings, and the app opens by itself once maintenance is switched off.
var _maintTimer = null;
function ckMaintenanceOn(){ return !!(STATE.settings && STATE.settings.maintenanceMode); }
function showMaintenanceScreen(msg){
  const el = $('maintScreen'); if (!el) return;
  const text = String(msg || (STATE.settings && STATE.settings.maintenanceMsg) || '').trim() || (brandName() + ' is under maintenance. Please check back shortly.');
  $('maintMsg').textContent = text;
  try { hideLoadingScreen(); } catch (_) {}
  ['authScreen', 'app', 'openingGate'].forEach(id => { const x = $(id); if (x) x.style.display = 'none'; });
  el.style.display = 'flex';
  if (_maintTimer) return;
  _maintTimer = setInterval(async () => {
    let r; try { r = await api('/public/settings'); } catch (_) { return; }
    if (r && r.status === 'success' && r.settings && !r.settings.maintenanceMode) { clearInterval(_maintTimer); _maintTimer = null; location.reload(); }
  }, 20000);
}
async function maybeShowOpeningGate(){
  if (!STATE.settings) await waitForBootSettings(6000);
  if (ckMaintenanceOn()) { showMaintenanceScreen(); return true; }
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
    setBtnLoading('loginBtn', false, 'Login');
  });
}
window.addEventListener('snow-auth', ev => onMemberAuth(ev.detail));
// The sign-in script announces who is signed in (or nobody) once, as soon as the page is parsed. This code is unpacked a little
// later, and on a slow or busy phone it can be MORE than a little later: then that announcement happened before anyone was listening
// and nothing ever took the loading screen down. If it already fired, take it from the sign-in script directly.
if (window._cookieAuthFired && window.fbAuth) onMemberAuth(window.fbAuth.currentUser);
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
      try { sessionStorage.removeItem('cookie_relogin_required'); } catch (_) {}
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
    setBtnLoading('loginBtn', false, 'Login');
    setBtnLoading('regBtn', false, 'Register');
    savedLoginFill(false);   // this device's last member: the number and password are already in the boxes
    // Sign Up needs to know whether a referral code is required BEFORE
    // anyone submits, and boot() (which normally loads settings) only runs
    // after sign-in. Without this the screen would fall back to "required"
    // and the very first account could never be created.
    loadAuthSettings();
    return;
  }
  $('authScreen').style.display = 'none';
  showLoadingScreen();
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
  $('app').style.display = '';
  showPage(STATE.page || 'home');
  ckOpenPendingPayment();
  maybeAnnounceOnEntry();
  window._pendingLoginSuccess = false;   // signing in says nothing: the Home page simply opens
  ckAuthBoxEnd();
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
async function registerCurrentUser(phone){
  let reg = await post('/register', { referralCode: STATE.refCode || '', phone: phone || '' });
  // The referral code is optional: a code that does not exist is dropped and sign-up carries on without an upline.
  if (reg.status === 'error' && reg.code === 'BAD_REFERRAL' && STATE.refCode) {
    notify(reg.message || t('That referral code is invalid. Continuing without it.'));
    STATE.refCode = '';
    reg = await post('/register', { referralCode: '', phone: phone || '' });
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
    setBtnLoading('regBtn', false, 'Register');
    return;
  }
  const local = localDigits(String((STATE.user && STATE.user.email) || '').split('@')[0]);
  window._pendingLoginSuccess = false;
  await window.fbSignOut();
  $('authScreen').style.display = '';
  showAuthTab('register');
  if (local && $('regPhone')) $('regPhone').value = '0' + local;
  if ($('regReferral') && STATE.refCode) $('regReferral').value = STATE.refCode;
  setBtnLoading('regBtn', false, 'Register');
  notify((reg.message || 'Your sign-up was not finished.') + ' Complete your sign-up below.');
}
async function bootFromNetwork(uid){
  // _pendingRegPhone identifies a signup started in this tab; it works
  // without an OTP ticket.
  const signupFlow = !!window._pendingRegPhone;
  let r;
  // subagent-audit-caught: a brand-new registration always paid for a
  // GUARANTEED-to-fail /account call first (the profile doc genuinely
  // doesn't exist yet the instant after Firebase account creation), THEN
  // /register, THEN a second /account -- three sequential network round
  // trips before the real prefetch even started, on every single signup --
  // owner: "the startup loader should load all data, and should be fast...
  // no taking long." doRegister() sets _pendingRegPhone
  // right before creating the Firebase account, so their presence here
  // reliably means this boot is for a registration that JUST happened in
  // THIS tab -- skip straight to /register instead of wasting a call
  // already known to fail. Captured into locals and cleared immediately so
  // a later re-login in the same tab session (no page reload) never
  // wrongly takes this shortcut again.
  if (window._pendingRegPhone) {
    const phone = window._pendingRegPhone;
    const reg = await registerCurrentUser(phone);
    // The session changed while /register was in flight (a second sign-in
    // event for the same account, or a logout): whatever replaced it owns the
    // screen now. Treating this as a failure would sign the member out of the
    // very session that is opening.
    if (reg.stale || !STATE.user || STATE.user.uid !== uid) return;
    if (reg.status !== 'success' && reg.status !== 'already_done') {
      hideLoadingScreen();
      notify(reg.message || 'Could not complete registration');
      $('authScreen').style.display = '';
      setBtnLoading('regBtn', false, 'Register');
      return;
    }
    window._pendingRegPhone = '';
    r = await api('/account');
  } else {
    r = await api('/account', { timeoutMs: 10000 });
    if (r.stale || !STATE.user || STATE.user.uid !== uid) return;
    if (r.status === 'error' && (r.code === 'NOT_FOUND' || r.code === 'REGISTRATION_REQUIRED' || r.message === 'User not found')) {
      // Ghost account (Firebase user exists, our profile never finished in
      // an earlier session -- e.g. a crash/reload between account creation
      // and /register finishing) -- self-heal the same way.
      const reg = await registerCurrentUser(window._pendingRegPhone || '');
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
  $('app').style.display = '';
  showPage(STATE.page || 'home');
  ckOpenPendingPayment();
  maybeAnnounceOnEntry();
  ckAuthBoxEnd();
  if (signupFlow) { window._pendingLoginSuccess = false; ckSuccessToast('Success'); }
  else window._pendingLoginSuccess = false;
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
var NAV_ICON_SVG = {
  // Traced from the owner's close-up screenshots of the bottom bar.
  home: '<svg viewBox="0 0 46 43" width="16.6" height="15.5" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M24.1 39.8C23.8 39.8 23.4 39.7 23.1 39.8C22.6 39.8 22.6 39.8 22.2 39.4C21.8 39.1 21.6 39.0 21.2 38.9C20.9 38.8 20.6 38.7 20.4 38.5C19.9 37.9 19.7 37.9 17.0 37.8C13.8 37.8 13.7 37.8 13.2 37.3C12.9 37.1 12.7 37.0 12.2 36.9C11.5 36.8 11.5 36.8 11.0 36.4C10.8 36.2 10.4 36.0 10.1 36.0C9.7 35.8 9.4 35.7 9.2 35.5C9.1 35.3 8.8 35.0 8.5 34.9C8.0 34.5 6.5 33.0 6.1 32.4C6.0 32.2 5.8 31.8 5.6 31.6C5.4 31.5 5.3 31.2 5.2 30.9C5.1 30.7 4.9 30.3 4.8 30.1C4.3 29.3 4.0 28.6 3.9 27.9C3.9 27.4 3.8 27.1 3.6 26.7C3.3 26.3 3.3 26.2 3.2 24.9C3.2 24.2 3.1 23.5 3.0 23.2C2.8 22.6 2.9 20.5 3.1 20.0C3.1 19.8 3.2 19.4 3.2 19.1C3.2 18.8 3.3 18.4 3.4 18.1C3.5 17.8 3.6 17.4 3.6 17.2C3.6 16.8 4.1 15.3 4.4 14.8C4.5 14.6 4.6 14.3 4.6 14.0C4.6 13.6 4.7 13.4 4.9 13.1C5.1 12.9 5.3 12.5 5.3 12.2C5.5 11.7 5.6 11.5 6.2 10.9C6.6 10.6 7.0 10.0 7.1 9.8C7.2 9.6 7.4 9.2 7.6 9.1C7.8 8.9 8.0 8.5 8.2 8.2C8.5 7.7 8.7 7.5 9.1 7.2C9.4 7.1 9.9 6.7 10.1 6.5C10.5 6.0 11.7 5.2 12.2 5.1C12.7 5.0 12.9 4.9 13.2 4.5C13.4 4.3 13.7 4.2 14.1 4.0C14.4 3.9 14.9 3.7 15.2 3.6C15.8 3.3 16.0 3.2 16.9 3.2C17.5 3.2 18.2 3.1 18.6 3.0C19.1 2.9 19.3 2.9 19.8 3.0C20.1 3.0 20.6 3.1 20.9 3.1C21.2 3.1 21.8 3.2 22.1 3.3C22.4 3.4 22.9 3.5 23.0 3.5C23.2 3.5 23.5 3.6 23.8 3.8C24.0 4.0 24.3 4.1 24.4 4.1C25.4 4.1 25.4 4.1 26.8 5.6C27.1 5.8 27.4 6.1 27.6 6.1C27.9 6.2 28.2 6.4 28.3 6.6C28.6 6.9 29.2 7.0 29.9 6.8C30.4 6.7 30.5 6.7 30.9 6.9C31.1 7.0 31.6 7.1 32.3 7.1C33.4 7.2 33.4 7.2 33.9 7.6C34.3 8.0 34.5 8.1 34.8 8.1C35.2 8.1 35.4 8.2 35.8 8.7C36.0 8.9 36.3 9.0 36.6 9.1C37.2 9.2 38.5 10.5 39.0 11.4C40.0 13.0 40.2 13.4 40.5 13.7C40.8 14.0 40.9 14.1 41.0 15.0C41.1 15.5 41.2 15.7 41.4 16.1C41.7 16.4 41.8 16.7 41.9 17.0C41.9 17.2 42.0 17.7 42.0 17.9C42.1 18.2 42.1 18.9 42.1 19.6C42.1 20.5 42.1 20.9 42.3 21.4C42.5 22.0 42.5 22.0 42.3 22.7C42.2 23.1 42.1 23.7 42.1 24.3C42.0 26.1 41.7 26.9 40.6 29.0C40.5 29.4 40.4 29.7 40.4 30.0C40.4 30.6 40.4 30.6 39.9 31.0C39.4 31.4 39.3 31.6 39.1 32.4C39.0 32.7 38.8 33.0 38.1 33.8C37.6 34.3 37.0 35.0 36.9 35.2C36.7 35.5 36.5 35.7 36.1 35.9C35.9 36.1 35.3 36.6 34.9 37.0C34.5 37.4 33.9 37.8 33.7 38.0C33.5 38.1 33.1 38.4 32.8 38.5C32.2 38.9 31.7 39.1 30.9 39.1C30.4 39.1 30.3 39.1 29.9 39.5L29.4 39.9L26.9 39.9C25.6 39.9 24.3 39.8 24.1 39.8Z"/></svg>',
  assets: '<svg viewBox="0 0 47 47" width="17.0" height="17.0" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7.3 43.2C7.2 43.1 7.1 42.8 7.0 42.3C6.9 41.2 6.7 41.1 5.7 41.1C4.0 41.3 3.0 40.9 3.0 40.2C3.0 39.4 3.4 39.1 4.4 39.2C5.3 39.3 5.9 39.2 6.1 39.0C6.2 38.8 6.2 37.9 6.2 33.3C6.2 28.3 6.3 27.9 6.4 27.7C6.7 27.3 7.1 27.2 9.5 27.2C11.6 27.2 11.6 27.2 11.8 27.5C11.9 27.7 12.0 28.2 12.0 33.2C12.0 36.2 12.0 38.8 12.1 38.9C12.1 39.2 12.5 39.3 14.0 39.2C16.1 39.1 15.9 40.1 15.9 31.5C15.9 24.4 15.9 24.4 16.1 24.1C16.4 23.9 16.4 23.9 18.4 23.9C20.6 23.8 20.9 23.9 21.2 24.2C21.4 24.5 21.4 24.5 21.4 31.4C21.4 35.9 21.4 38.5 21.5 38.7C21.7 39.1 21.9 39.2 23.5 39.2C24.7 39.2 24.8 39.2 25.0 39.0C25.2 38.8 25.2 38.7 25.2 30.1L25.2 21.4L25.5 21.1C26.0 20.6 26.4 20.5 28.6 20.5C30.5 20.6 30.5 20.6 30.7 20.8C30.9 21.1 31.0 21.2 31.0 30.0C31.0 35.0 31.1 39.0 31.1 39.1C31.3 39.3 34.2 39.3 34.6 39.1C34.7 39.1 34.8 38.9 34.8 38.7C34.9 38.5 34.9 33.7 34.9 28.0C34.9 17.6 34.9 17.6 35.2 17.4C35.6 17.1 39.4 17.1 39.8 17.4C40.4 17.9 40.4 17.4 40.4 28.4C40.4 34.8 40.4 38.5 40.5 38.6C40.6 39.0 41.0 39.2 41.8 39.2C43.2 39.3 43.6 39.4 43.6 40.0C43.6 40.3 43.2 40.9 42.8 41.0C42.7 41.1 42.0 41.1 41.2 41.1C39.6 41.2 39.4 41.3 39.2 42.1C39.1 42.8 38.8 43.1 38.2 43.2C37.6 43.3 37.3 42.9 37.2 42.1C37.1 41.1 37.2 41.2 34.6 41.1C32.1 41.1 31.9 41.2 31.6 41.9C31.6 42.1 31.4 42.5 31.4 42.7C30.9 43.9 30.1 43.6 29.8 42.1C29.6 41.2 29.5 41.2 27.0 41.2C24.5 41.1 24.4 41.2 24.2 42.1C24.1 42.7 23.9 42.9 23.2 43.3C22.4 43.7 22.2 43.5 22.3 42.2C22.3 41.8 22.3 41.7 22.1 41.4C21.8 41.1 21.8 41.1 19.3 41.2C16.4 41.2 16.4 41.2 16.4 42.0C16.4 42.8 16.4 42.9 16.1 43.2C15.7 43.8 15.3 43.6 14.9 42.6C14.6 41.9 14.1 41.3 13.7 41.2C13.5 41.2 12.5 41.1 11.4 41.1C9.1 41.2 9.1 41.1 9.0 42.1C8.9 42.8 8.7 43.0 8.2 43.3C7.7 43.6 7.6 43.5 7.3 43.2ZM6.9 21.7C6.3 21.4 5.9 20.8 6.1 20.3C6.2 20.0 7.6 19.1 8.0 19.1C8.6 19.1 9.1 18.9 9.5 18.6C9.9 18.2 10.4 18.0 10.9 18.0C11.2 18.0 11.8 17.7 12.0 17.5C12.1 17.5 12.5 17.3 12.9 17.1C13.3 16.9 13.8 16.7 14.1 16.5C14.3 16.4 14.8 16.1 15.1 16.0C15.4 15.9 15.8 15.7 16.0 15.5C16.2 15.4 16.6 15.2 17.0 15.1C17.3 15.0 17.7 14.8 17.9 14.7C18.2 14.4 18.6 14.2 19.3 14.0C19.6 13.9 19.8 13.7 19.9 13.6C20.1 13.4 20.8 13.1 21.1 13.1C21.6 13.1 22.1 12.9 22.5 12.5C22.7 12.4 23.2 12.1 23.5 12.0C23.8 11.9 24.2 11.8 24.4 11.6C24.6 11.5 25.0 11.3 25.4 11.3C26.0 11.1 26.6 10.8 27.1 10.5C27.2 10.4 27.7 10.2 28.1 10.0C28.5 9.8 28.9 9.6 29.0 9.5C29.1 9.5 29.4 9.3 29.8 9.1C30.2 9.0 30.7 8.8 30.9 8.6C31.1 8.5 31.6 8.2 32.0 8.1C32.4 7.9 32.8 7.7 33.0 7.6C33.1 7.5 33.5 7.2 34.0 7.1C34.5 6.9 34.9 6.6 35.0 6.6C35.1 6.5 35.4 6.3 35.7 6.2C36.8 5.8 36.8 5.3 35.7 4.9C35.0 4.7 34.9 4.6 34.7 4.1C34.2 3.2 35.1 2.7 36.2 3.4C36.5 3.6 36.7 3.6 37.0 3.6C37.3 3.5 37.5 3.5 37.8 3.7C38.1 3.9 38.4 4.0 38.6 4.1C38.9 4.1 39.2 4.3 39.5 4.6C39.8 4.8 40.1 5.0 40.2 5.0C40.2 5.0 40.4 5.1 40.5 5.2C40.9 5.5 40.9 6.0 40.5 6.4C40.3 6.6 40.1 7.0 40.0 7.3C39.9 7.6 39.7 8.0 39.6 8.2C39.4 8.5 39.4 8.7 39.5 9.0C39.5 9.7 38.8 10.7 38.3 10.8C37.6 10.8 37.5 10.6 37.5 9.6C37.6 8.5 37.5 8.1 37.2 8.0C36.8 8.0 36.2 8.2 35.9 8.5C35.7 8.7 35.3 8.9 35.0 9.0C34.7 9.1 34.3 9.2 34.1 9.3C33.6 9.7 33.3 9.9 32.7 9.9C32.3 10.0 32.0 10.1 31.8 10.3C31.1 10.8 30.8 10.9 30.4 11.0C29.8 11.0 29.4 11.2 29.1 11.4C28.9 11.5 28.5 11.7 28.0 11.9C27.6 12.1 27.1 12.4 26.9 12.5C26.8 12.6 26.3 12.8 25.9 13.0C25.6 13.1 25.1 13.4 24.9 13.5C24.7 13.7 24.2 13.9 24.0 13.9C23.7 14.0 23.3 14.2 23.1 14.3C22.8 14.6 22.6 14.7 21.9 15.0C21.6 15.1 21.1 15.3 20.9 15.5C20.6 15.7 20.4 15.8 19.8 15.9C19.2 16.0 19.0 16.1 18.7 16.3C18.1 16.8 17.9 16.9 17.4 17.0C16.8 17.0 16.4 17.2 16.0 17.4C15.9 17.5 15.5 17.8 15.1 17.9C14.7 18.1 14.1 18.3 13.9 18.5C13.7 18.7 13.2 18.9 12.9 19.0C12.6 19.1 12.2 19.3 12.0 19.4C11.8 19.6 11.4 19.8 11.0 19.9C10.7 20.0 10.2 20.2 10.0 20.4C9.9 20.6 9.4 20.8 9.1 20.9C8.7 21.0 8.3 21.2 8.2 21.3C7.8 21.8 7.4 21.9 6.9 21.7Z"/></svg>',
  network: '<svg viewBox="0 0 56 50" width="20.2" height="18.1" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M10.1 47.0C9.3 46.6 9.3 46.4 9.2 43.9C9.2 42.4 9.2 41.5 9.3 41.2C9.4 41.0 9.5 40.5 9.5 40.0C9.5 39.5 9.7 38.9 9.8 38.6C9.9 38.2 10.0 37.8 10.0 37.2C10.0 36.3 10.1 35.9 10.6 35.4C10.8 35.2 10.9 34.8 11.0 34.5C11.1 34.0 11.4 33.5 11.7 33.3C11.8 33.2 11.9 32.8 12.0 32.5C12.1 32.2 12.2 31.8 12.4 31.6C12.6 31.4 12.8 31.0 12.9 30.9C13.2 30.4 16.6 27.1 17.0 26.9C17.1 26.8 17.4 26.6 17.7 26.4C18.3 25.9 19.4 25.2 20.1 24.9C21.5 24.4 21.9 23.7 21.1 23.0C19.1 21.3 17.7 19.2 17.8 18.1C17.9 17.6 17.8 17.3 17.4 16.9C17.2 16.7 17.2 16.5 17.2 15.9C17.1 15.6 17.1 15.0 17.1 14.7C17.0 14.2 17.0 14.0 17.2 13.4C17.5 12.8 17.5 12.5 17.5 12.2C17.4 11.8 17.5 11.6 17.7 11.1C17.9 10.7 18.1 10.3 18.1 10.2C18.1 10.1 18.3 9.8 18.5 9.6C18.7 9.3 18.9 8.9 19.0 8.5C19.2 7.9 19.3 7.7 20.0 7.0C20.7 6.3 21.1 6.0 22.6 5.1C22.9 5.0 23.2 4.8 23.3 4.6C23.7 4.3 24.0 4.2 25.4 4.0C26.0 4.0 26.6 3.8 26.9 3.7C27.5 3.4 29.5 3.4 30.1 3.7C30.4 3.8 31.1 4.0 31.7 4.0C33.2 4.3 33.4 4.4 34.2 5.1C34.7 5.6 35.0 5.8 35.4 6.0C36.0 6.2 36.0 6.3 36.5 7.1C36.8 7.6 37.3 8.2 37.5 8.5C37.7 8.8 38.0 9.2 38.1 9.4C38.2 9.5 38.4 9.9 38.5 10.0C38.7 10.2 38.8 10.6 38.9 10.9C39.1 12.1 39.2 12.6 39.2 13.2C39.2 13.5 39.3 13.9 39.3 14.1C39.4 14.2 39.5 14.8 39.5 15.3C39.6 16.3 39.6 16.4 39.3 16.9C39.1 17.2 39.0 17.7 38.9 18.3C38.7 19.4 38.7 19.4 37.9 20.2C37.4 20.7 37.2 21.0 37.0 21.3C36.9 21.8 35.9 22.9 35.3 23.2C34.6 23.6 35.3 24.6 36.5 25.0C36.9 25.1 37.3 25.3 37.6 25.5C37.7 25.7 38.2 25.9 38.5 26.0C39.2 26.2 39.2 26.2 41.5 28.5C42.9 29.9 43.9 31.0 44.0 31.3C44.2 31.5 44.4 31.8 44.5 32.0C44.7 32.2 44.9 32.7 45.0 33.0C45.1 33.3 45.3 33.7 45.5 33.9C45.6 34.1 45.8 34.6 46.0 35.0C46.1 35.3 46.3 35.8 46.5 36.0C46.7 36.2 46.8 36.4 46.8 36.5C46.8 36.6 46.8 37.0 46.9 37.4C46.9 37.8 46.9 38.5 46.9 39.0C47.0 40.4 47.2 41.7 47.3 42.1C47.5 42.3 47.5 42.7 47.5 44.0C47.5 45.8 47.4 46.4 46.9 46.9C46.6 47.2 46.6 47.2 28.5 47.2C10.8 47.2 10.4 47.2 10.1 47.0ZM44.6 44.8C44.7 44.8 44.8 44.7 44.9 44.5C45.0 44.2 45.0 43.9 45.0 42.4C44.9 41.4 44.9 40.1 44.9 39.5C44.9 38.6 44.9 38.5 44.7 38.2C44.2 37.5 44.1 37.3 44.0 36.4C43.9 35.7 43.9 35.5 43.6 35.1C43.4 34.8 43.1 34.3 43.1 34.0C43.0 33.7 42.8 33.4 42.5 33.2C42.3 33.0 42.1 32.7 42.0 32.5C41.9 32.2 41.6 31.9 41.5 31.8C41.3 31.7 41.1 31.4 41.0 31.2C40.8 30.7 39.3 29.2 38.8 29.0C38.6 28.9 38.3 28.6 38.1 28.5C38.0 28.2 37.7 28.1 37.4 28.0C37.1 27.9 36.7 27.6 36.4 27.5C36.2 27.3 35.8 27.1 35.6 27.0C35.3 26.9 34.9 26.8 34.6 26.6C34.3 26.4 33.9 26.3 33.2 26.1C32.7 26.0 32.1 25.8 31.8 25.7C31.2 25.4 31.2 25.4 30.6 25.5C30.1 25.6 29.8 25.6 29.4 25.4C28.1 25.1 27.9 25.1 27.2 25.3C26.8 25.4 26.3 25.5 25.9 25.5C25.6 25.5 25.1 25.6 24.8 25.7C24.6 25.8 24.0 25.9 23.5 26.0C22.6 26.1 22.5 26.2 22.0 26.5C21.8 26.6 21.4 26.8 21.0 27.0C20.7 27.1 20.2 27.3 20.1 27.4C19.9 27.6 19.6 27.8 19.3 27.9C19.1 28.0 18.0 29.0 16.6 30.4C14.2 32.8 14.2 32.8 14.0 33.5C13.9 33.8 13.7 34.3 13.6 34.4C13.3 34.7 13.0 35.2 13.0 35.4C13.0 35.5 12.9 35.8 12.8 36.0C12.6 36.4 12.5 36.7 12.5 37.0C12.5 37.4 12.4 37.6 12.3 37.9C12.0 38.2 11.9 39.0 11.8 42.2C11.8 44.2 11.8 44.3 12.0 44.5C12.1 44.7 12.3 44.8 12.4 44.8C12.6 44.8 43.4 44.8 44.6 44.8ZM6.0 41.5C5.1 41.4 4.2 41.1 3.7 40.8C3.5 40.5 3.5 40.5 3.5 38.4C3.5 37.2 3.6 36.3 3.6 36.1C3.7 35.9 3.9 34.9 4.0 33.0C4.1 31.8 4.3 31.0 4.7 30.8C4.7 30.7 4.9 30.4 5.0 30.0C5.1 29.7 5.4 29.2 5.5 29.0C5.7 28.7 5.9 28.3 6.0 28.1C6.1 27.7 6.3 27.4 6.7 27.0C7.0 26.7 7.5 26.1 7.7 25.6C8.3 24.6 8.6 24.3 9.4 24.0C9.8 23.9 10.0 23.7 10.2 23.5C10.3 23.3 10.6 23.1 10.8 23.0C11.4 22.7 12.0 22.0 12.0 21.6C12.0 21.0 11.8 20.8 11.2 20.2C10.4 19.5 10.2 19.1 10.0 17.1C9.9 16.9 9.8 16.3 9.6 15.9C9.4 15.1 9.4 14.6 9.7 14.1C9.8 13.9 9.8 13.4 9.8 12.9C9.9 11.7 10.1 11.1 10.5 10.5C10.7 10.3 10.9 9.9 11.0 9.6C11.1 9.2 11.3 8.9 11.5 8.8C11.7 8.7 11.9 8.4 12.0 8.3C12.3 7.6 13.8 6.2 14.3 6.1C14.6 6.0 15.0 5.8 15.2 5.7C15.4 5.5 15.7 5.5 16.0 5.5C16.4 5.5 16.6 5.4 16.8 5.3C17.7 4.8 18.3 5.4 17.6 6.1C17.4 6.3 17.1 6.7 17.0 7.0C16.7 7.7 16.1 8.5 15.5 8.8C15.0 9.1 13.3 10.7 13.0 11.2C12.9 11.4 12.6 11.8 12.4 12.1C11.7 13.1 11.6 16.3 12.3 17.2C12.4 17.4 12.5 17.6 12.5 18.0C12.5 18.3 12.6 18.6 12.6 18.7C12.8 18.9 13.9 19.9 14.2 20.0C14.6 20.2 15.9 21.6 16.1 22.0C16.4 22.7 15.7 23.6 14.6 24.0C14.2 24.1 13.7 24.3 13.6 24.5C13.3 24.7 12.9 24.9 12.5 25.0C11.8 25.2 11.8 25.2 9.9 27.1C8.7 28.3 8.0 29.2 7.8 29.5C7.6 29.8 7.4 30.1 7.4 30.2C7.3 30.3 7.1 30.7 7.0 31.0C6.8 31.4 6.6 31.8 6.5 31.9C6.2 32.3 6.1 32.6 6.1 33.1C6.1 33.4 6.1 34.2 6.0 34.9C5.6 38.8 5.7 39.0 6.9 39.0C7.8 39.0 8.0 39.2 8.0 39.9C8.0 41.0 7.7 41.6 7.1 41.6C7.0 41.6 6.5 41.5 6.0 41.5ZM50.0 41.5C49.1 41.4 48.9 41.3 48.5 40.5C48.1 39.8 48.1 39.6 48.4 39.3C48.6 39.0 48.7 39.0 49.6 39.0C51.0 39.0 51.0 39.0 51.0 37.3C51.0 36.2 51.0 36.0 50.7 35.4C50.6 34.9 50.5 34.4 50.5 34.0C50.5 33.7 50.4 33.2 50.3 33.0C50.3 32.8 50.2 32.3 50.1 31.9C50.0 31.3 49.9 31.0 49.5 30.4C49.3 30.2 49.1 29.8 49.0 29.4C48.8 28.8 48.7 28.7 47.4 27.4C46.7 26.7 45.9 26.0 45.7 25.9C45.4 25.8 45.1 25.6 44.9 25.4C44.8 25.3 44.4 25.1 44.1 25.1C43.9 25.0 43.4 24.7 43.0 24.5C42.6 24.3 42.1 24.0 41.8 23.9C41.2 23.7 41.1 23.6 40.8 23.2C40.5 22.7 40.4 22.4 40.7 21.8C40.9 21.3 41.1 21.1 42.2 20.3C43.0 19.8 43.7 18.9 44.0 18.0C44.1 17.7 44.4 17.2 44.6 16.9C45.3 15.8 45.1 13.7 44.3 12.2C44.1 11.8 44.0 11.5 44.0 11.5C44.0 11.1 42.2 9.5 41.2 9.0C40.5 8.7 39.2 7.3 39.0 6.7C39.0 6.4 38.8 6.0 38.7 5.9C38.3 5.3 38.4 5.3 39.6 5.2C40.4 5.1 40.7 5.2 41.1 5.6C41.3 5.7 41.6 5.9 41.7 6.0C41.9 6.0 42.3 6.3 42.6 6.5C42.9 6.8 43.2 7.0 43.4 7.2C43.6 7.3 43.8 7.5 44.0 7.7C44.1 8.0 44.6 8.5 45.0 9.0C45.6 9.7 45.9 10.0 46.0 10.4C46.0 10.6 46.2 11.0 46.4 11.3C46.6 11.6 46.6 11.8 46.5 12.1C46.5 12.5 46.5 12.8 46.8 13.4C47.0 14.2 47.0 14.3 46.9 14.9C46.9 15.2 46.8 15.8 46.8 16.1C46.8 16.6 46.7 17.0 46.6 17.4C46.4 17.7 46.2 18.3 46.1 18.7C45.9 19.3 45.8 19.6 45.5 19.9C45.1 20.3 44.5 21.4 44.5 21.7C44.5 22.0 44.8 22.4 45.4 22.8C45.7 23.0 46.0 23.2 46.1 23.4C46.3 23.6 46.6 23.9 46.8 24.0C47.2 24.2 48.2 25.1 49.3 26.4C49.9 27.0 50.1 27.3 50.2 27.8C50.3 28.1 50.6 28.6 50.8 29.0C51.0 29.3 51.2 29.6 51.2 29.7C51.2 29.8 51.7 31.0 52.3 32.1C52.6 32.7 52.6 32.7 52.5 33.6C52.5 34.3 52.5 34.6 52.6 35.0C52.9 35.8 52.9 40.4 52.7 40.7C52.4 41.0 51.3 41.6 51.1 41.6C51.0 41.6 50.5 41.5 50.0 41.5ZM29.5 23.0C30.1 22.9 30.5 22.8 30.9 22.9C31.4 22.9 31.4 22.9 31.9 22.5C32.2 22.2 32.4 22.0 32.5 22.0C32.6 22.0 32.8 21.8 33.1 21.6C33.3 21.3 33.7 21.1 33.8 21.0C34.5 20.7 35.8 19.2 36.0 18.7C36.0 18.4 36.2 18.0 36.3 17.9C36.4 17.6 36.5 17.4 36.5 17.0C36.5 16.6 36.6 16.4 36.7 16.2C37.0 15.8 37.1 15.2 37.0 14.5C36.9 14.1 36.9 13.5 36.9 13.1C36.8 12.4 36.8 12.3 36.6 12.0C36.4 11.9 36.2 11.4 36.0 11.0C35.8 10.6 35.6 10.1 35.5 10.0C35.3 9.8 35.1 9.5 35.1 9.3C35.0 9.1 34.5 8.6 34.0 8.1C33.3 7.3 33.1 7.2 32.6 7.0C32.3 6.9 31.9 6.8 31.6 6.6C30.9 6.1 29.9 6.0 28.2 6.0C27.4 6.1 26.4 6.1 26.1 6.1C25.6 6.1 25.4 6.2 25.1 6.4C25.0 6.5 24.7 6.7 24.5 6.8C24.3 6.9 23.9 7.2 23.7 7.4C23.4 7.6 23.0 7.9 22.9 8.0C22.4 8.2 22.2 8.4 22.0 8.8C21.9 9.0 21.5 9.5 21.2 9.8C20.8 10.2 20.4 10.6 20.4 10.8C19.9 11.8 19.7 14.7 19.9 15.9C19.9 16.3 20.0 16.8 20.0 17.0C20.1 17.3 20.2 17.6 20.4 17.9C20.6 18.2 20.8 18.6 20.9 18.9C21.1 19.2 21.3 19.6 21.5 19.9C21.7 20.1 22.0 20.4 22.1 20.6C22.2 20.8 22.4 20.9 22.7 21.1C23.1 21.2 23.4 21.4 23.8 21.9C24.4 22.5 24.4 22.5 25.1 22.5C25.5 22.5 25.8 22.6 26.1 22.7C26.4 22.8 26.9 22.9 27.3 23.0C27.7 23.1 28.1 23.1 28.1 23.2C28.2 23.2 28.7 23.2 29.5 23.0Z"/></svg>',
  share: '<svg viewBox="0 0 54 55" width="19.5" height="19.9" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M35.5 51.4C35.4 51.4 35.1 51.2 35.0 51.1C34.9 51.1 34.5 51.0 34.1 51.0C33.1 51.0 33.0 50.9 31.5 49.4C29.9 47.8 30.0 48.0 29.5 46.3C29.0 45.0 29.0 44.1 29.1 42.8C29.2 42.2 29.1 42.1 28.4 41.9C28.1 41.9 27.8 41.7 27.5 41.5C27.2 41.2 26.9 41.1 26.6 41.0C26.2 40.9 25.9 40.8 25.6 40.5C25.3 40.3 24.9 40.1 24.5 40.0C23.9 39.8 23.8 39.7 23.2 39.1C22.5 38.4 22.5 38.4 22.0 38.4C21.5 38.5 21.5 38.5 20.8 37.8C20.2 37.2 20.1 37.1 19.5 37.0C19.2 36.9 18.8 36.7 18.6 36.5C17.9 36.0 17.5 36.0 16.8 36.5C16.2 37.0 15.3 37.6 14.9 37.7C13.8 38.0 12.0 38.2 11.3 38.1C9.6 37.8 8.9 37.7 8.4 37.4C8.1 37.2 7.7 37.0 7.4 36.9C6.7 36.7 5.4 35.5 4.9 34.7C4.8 34.4 4.6 34.0 4.4 33.9C4.3 33.7 4.1 33.4 4.1 33.1C4.0 32.8 3.7 32.3 3.6 32.1C3.3 31.6 3.2 31.5 3.2 31.0C3.2 30.7 3.1 30.2 3.1 29.9C3.0 29.3 3.0 29.2 3.2 28.5C3.4 28.0 3.5 27.5 3.5 27.1C3.5 26.7 3.6 26.5 3.7 26.2C3.8 26.1 3.9 25.7 4.0 25.4C4.2 24.9 4.4 24.7 5.5 23.6C6.2 22.9 7.0 22.2 7.2 22.0C7.4 21.9 7.8 21.6 8.1 21.5C8.6 21.2 9.8 20.9 10.9 20.9C11.3 20.9 11.7 20.8 12.0 20.7C12.5 20.5 12.5 20.5 13.1 20.7C13.4 20.8 14.0 20.9 14.3 21.0C14.9 21.1 15.1 21.2 15.5 21.5C15.7 21.7 16.0 21.9 16.2 22.0C16.4 22.0 16.8 22.2 17.1 22.3L17.7 22.6L18.4 22.3C18.8 22.0 19.3 21.7 19.6 21.5C19.8 21.3 20.2 21.0 20.4 20.9C20.7 20.8 21.0 20.6 21.1 20.4C21.3 20.3 21.7 20.2 22.0 20.1C22.3 20.0 22.6 19.7 22.8 19.5C23.1 19.3 23.4 19.0 23.7 18.9C24.0 18.8 24.4 18.6 24.6 18.5C24.8 18.2 25.3 17.9 26.5 17.2C26.8 17.1 27.2 16.8 27.5 16.5C27.8 16.3 28.2 16.0 28.4 15.9C28.9 15.7 29.6 15.1 29.7 14.8C29.8 14.7 29.9 13.9 30.0 12.9C30.1 11.3 30.1 11.2 30.3 10.8C30.6 10.5 30.6 10.4 30.5 10.0C30.5 9.5 30.5 9.5 31.1 8.9C31.7 8.3 31.8 8.2 32.0 7.6C32.3 6.6 32.5 6.4 34.5 5.2C34.8 5.1 35.2 4.8 35.4 4.6C35.9 4.2 36.1 4.1 37.0 4.0C37.5 3.9 38.1 3.7 38.5 3.5C39.3 3.2 40.2 3.1 41.0 3.4C41.4 3.5 41.8 3.6 42.1 3.5C42.3 3.5 42.6 3.5 42.8 3.6C43.0 3.7 43.6 3.9 44.0 3.9C45.0 4.1 45.2 4.2 46.0 5.0C46.4 5.5 46.8 5.8 47.2 5.9C47.6 6.1 47.8 6.2 48.1 6.7C48.2 7.0 48.5 7.2 48.6 7.3C48.6 7.3 48.8 7.5 48.9 7.7C49.0 7.9 49.3 8.3 49.6 8.7C50.1 9.3 50.1 9.3 50.1 10.2C50.1 10.7 50.2 11.1 50.5 11.6C51.1 13.0 51.2 14.4 50.7 15.2C50.4 15.5 50.4 15.7 50.4 16.2C50.4 17.0 50.0 17.9 49.5 18.4C49.3 18.6 49.1 19.0 49.0 19.4C48.8 20.1 48.7 20.2 48.0 20.9C47.6 21.4 47.0 21.8 46.8 22.0C46.4 22.2 45.7 22.6 44.7 23.3C44.1 23.7 43.0 24.0 41.5 24.1C40.9 24.1 40.3 24.2 40.0 24.3C39.4 24.5 39.4 24.5 39.0 24.3C38.7 24.2 38.3 24.1 38.0 24.0C37.2 24.0 36.9 23.8 36.5 23.5C36.4 23.3 36.0 23.1 35.6 23.0C34.9 22.8 34.8 22.8 32.8 20.8C31.0 18.9 30.8 18.8 30.5 18.8C30.0 18.8 29.7 19.0 29.2 19.5C28.9 19.8 28.6 20.0 28.3 20.1C28.0 20.1 27.6 20.3 27.5 20.5C27.3 20.7 26.9 20.9 26.6 21.1C26.3 21.3 25.8 21.6 25.4 21.8C25.1 22.0 24.7 22.3 24.4 22.5C24.2 22.7 23.8 23.0 23.6 23.1C23.3 23.2 23.0 23.4 22.9 23.6C22.7 23.7 22.3 23.9 22.0 23.9C21.7 24.0 21.4 24.2 21.2 24.3C21.0 24.5 20.6 24.7 20.4 24.8C19.8 25.1 19.7 25.5 19.9 25.9C20.7 28.0 21.0 29.1 20.6 29.9C20.6 30.1 20.5 30.5 20.5 30.8C20.5 31.2 20.4 31.5 20.2 32.1C20.0 32.5 19.9 32.9 19.9 33.2C19.9 33.7 19.9 33.7 20.6 34.0C21.1 34.3 21.4 34.4 21.9 35.0C22.5 35.6 22.5 35.6 23.0 35.5C23.6 35.5 23.6 35.5 24.1 36.1C24.7 36.7 24.8 36.8 25.4 37.0C25.8 37.1 26.2 37.3 26.5 37.5C26.6 37.7 27.1 37.9 27.4 38.0C27.8 38.1 28.3 38.3 28.5 38.5C28.7 38.7 29.0 38.9 29.2 39.0C29.4 39.0 29.8 39.2 30.1 39.3L30.7 39.6L31.3 39.4C31.6 39.2 31.9 38.9 32.1 38.7C32.4 38.2 32.6 38.1 33.1 38.0C33.3 37.9 33.7 37.8 33.9 37.6C34.4 37.2 34.4 37.2 35.3 37.0C36.4 36.9 36.7 36.9 38.1 37.1C39.0 37.3 39.3 37.4 39.7 37.7C40.0 37.9 40.4 38.2 40.6 38.3C41.1 38.6 41.6 39.2 41.9 39.7C42.0 40.0 42.3 40.4 42.6 40.7C43.1 41.2 43.1 41.2 43.1 41.9C43.1 42.5 43.1 42.6 43.5 43.0C43.9 43.5 43.9 43.7 43.6 44.2C43.5 44.5 43.4 44.8 43.4 45.2C43.4 46.0 43.1 46.7 42.6 47.3C42.4 47.5 42.2 47.9 42.1 48.2C41.9 48.8 41.0 49.7 40.2 50.3C39.5 50.8 39.4 50.9 38.4 51.0C37.9 51.1 37.2 51.2 36.8 51.3C35.9 51.6 35.9 51.6 35.5 51.4ZM38.2 48.0C38.6 47.8 38.8 47.7 39.0 47.2C39.2 47.0 39.6 46.5 40.0 46.1L40.6 45.5L40.6 44.4C40.5 42.7 40.3 42.3 39.1 41.1C38.1 40.0 38.1 40.0 36.3 40.0C34.6 40.0 34.5 40.0 34.1 40.6C33.9 40.8 33.7 40.9 33.7 40.9C33.4 40.9 33.0 41.3 32.9 41.7C32.8 41.9 32.6 42.3 32.5 42.5C32.2 42.9 32.2 43.0 32.1 44.3C32.1 45.6 32.1 45.6 32.4 46.0C32.6 46.2 32.9 46.7 33.0 46.9C33.6 47.9 34.3 48.2 36.4 48.2C37.5 48.2 37.8 48.2 38.2 48.0ZM13.6 34.8C14.5 34.6 15.7 33.9 16.0 33.2C16.2 33.0 16.4 32.6 16.5 32.5C16.7 32.4 16.9 32.0 17.0 31.6C17.1 31.2 17.3 30.9 17.4 30.8C17.7 30.5 17.7 30.0 17.5 29.3C17.3 28.8 17.2 28.4 17.2 28.0C17.2 27.3 17.1 27.0 16.7 26.6C16.5 26.5 16.2 26.1 16.0 25.8C15.8 25.4 15.6 25.2 15.3 25.0C15.0 24.9 14.7 24.6 14.5 24.4C14.1 24.1 14.0 24.0 12.8 23.9C11.6 23.9 11.1 23.9 10.5 23.9C9.6 24.1 9.5 24.1 9.2 24.5C9.0 24.6 8.6 24.9 8.4 25.0C8.1 25.2 7.8 25.4 7.4 26.1C7.1 26.5 6.8 27.0 6.6 27.2C6.4 27.5 6.4 27.6 6.4 28.0C6.5 28.4 6.4 28.7 6.3 29.0C6.0 29.8 6.0 30.5 6.5 31.1C6.7 31.3 6.9 31.7 7.0 32.0C7.2 32.9 7.9 33.8 8.5 34.0C8.7 34.1 9.1 34.3 9.3 34.4C10.2 35.0 12.2 35.2 13.6 34.8ZM42.1 20.5C42.4 20.2 43.1 20.0 43.7 20.0C43.7 20.0 43.9 19.8 44.2 19.5C44.6 19.2 44.8 19.0 44.9 19.0C45.0 19.0 46.7 17.4 46.8 17.2C47.0 16.9 47.1 15.8 47.2 13.7C47.2 12.0 47.1 11.1 46.6 10.5C46.4 10.3 46.1 9.9 46.0 9.7C45.8 9.4 45.5 9.1 45.2 9.0C45.0 8.8 44.5 8.4 44.1 8.1C43.4 7.3 43.2 7.2 41.2 6.9C40.0 6.7 39.9 6.7 39.2 6.8C38.8 6.9 38.3 7.0 38.1 7.0C37.7 7.0 37.4 7.2 37.1 7.5C37.0 7.7 36.7 7.9 36.5 8.0C36.1 8.1 35.0 9.2 34.5 9.9C34.0 10.6 33.4 12.4 33.5 12.9C33.5 13.2 33.5 13.4 33.3 13.8C33.0 14.4 33.0 14.5 33.5 15.0C33.8 15.4 33.8 15.5 33.8 16.0C33.8 16.7 33.9 17.0 34.4 17.4C34.6 17.6 34.8 18.0 35.0 18.2C35.2 18.6 35.4 18.8 35.6 18.9C35.8 19.0 36.2 19.3 36.5 19.6C37.2 20.2 38.0 20.5 38.8 20.5C39.1 20.5 39.6 20.6 40.0 20.7C40.8 21.0 41.5 20.9 42.1 20.5Z"/></svg>',
  account: '<svg viewBox="0 0 56 57" width="20.2" height="20.6" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M3.9 53.2C3.5 52.9 3.5 52.9 3.5 50.4C3.5 48.4 3.5 47.7 3.6 47.4C3.7 47.1 3.8 46.5 3.8 46.0C3.9 44.8 4.0 44.4 4.3 43.9C4.4 43.6 4.5 43.4 4.5 43.0C4.5 42.6 4.6 42.4 4.7 42.1C4.8 42.0 5.0 41.6 5.0 41.3C5.1 41.1 5.4 40.6 5.6 40.4C5.7 40.2 5.9 39.9 6.0 39.7C6.1 39.0 6.3 38.8 7.1 37.9C7.5 37.5 8.0 36.9 8.1 36.7C8.2 36.5 8.4 36.2 8.5 36.2C8.7 36.1 8.9 35.8 9.0 35.5C9.2 35.0 9.7 34.6 10.7 34.1C10.9 34.0 11.5 33.5 11.9 33.1C12.6 32.4 13.0 32.2 13.3 32.1C13.5 32.0 13.9 31.8 14.1 31.5C14.4 31.3 14.7 31.1 15.0 31.0C15.3 30.9 15.7 30.7 15.9 30.5C16.3 30.2 16.4 30.2 16.9 30.2C17.8 30.3 18.3 30.1 18.3 29.5C18.3 29.3 18.0 29.1 17.3 28.9C16.8 28.7 16.6 28.6 15.9 27.9C15.5 27.5 15.0 27.1 14.8 27.0C14.6 26.9 14.3 26.7 14.3 26.6C14.2 26.5 14.0 26.2 13.8 26.0C13.7 25.8 13.5 25.5 13.3 25.2C13.2 25.0 12.8 24.5 12.5 24.2C12.1 23.7 12.0 23.5 12.0 23.1C11.9 22.8 11.7 22.4 11.5 22.0C11.0 21.2 10.8 20.5 10.8 19.8C10.8 19.6 10.7 19.2 10.7 19.0C10.6 18.7 10.5 18.1 10.5 16.6C10.5 14.6 10.5 14.6 10.7 14.1C10.9 13.8 11.1 13.3 11.2 12.8C11.3 11.8 11.4 11.6 11.8 11.1C12.1 10.8 12.2 10.5 12.3 9.8C12.4 9.5 15.6 6.3 16.2 6.0C16.5 5.9 16.8 5.7 17.0 5.5C17.1 5.4 17.6 5.2 17.9 5.0C18.2 4.9 18.7 4.7 19.0 4.5C19.5 4.2 20.5 3.9 22.0 3.8C22.5 3.8 23.0 3.7 23.1 3.6C23.6 3.4 25.6 3.5 26.2 3.7C26.4 3.8 27.1 4.0 27.7 4.0C28.8 4.2 29.5 4.4 29.7 4.7C29.8 4.7 30.1 4.9 30.5 5.0C31.1 5.2 31.2 5.2 32.9 6.9C33.8 7.9 34.7 8.8 34.9 9.1C35.0 9.3 35.3 9.6 35.5 9.8C35.8 10.2 36.6 11.7 36.7 12.2C36.8 12.4 37.0 13.0 37.2 13.4C37.4 14.1 37.5 14.4 37.5 14.9C37.5 15.3 37.6 15.8 37.6 16.0C37.8 16.5 37.8 17.5 37.7 18.0C37.5 18.5 37.4 18.9 37.5 19.7C37.6 20.3 37.6 20.3 37.4 20.7C37.2 20.9 37.1 21.3 37.0 21.6C36.9 21.9 36.6 22.3 36.5 22.5C36.3 22.7 36.1 23.2 36.0 23.6C35.9 24.0 35.7 24.3 35.4 24.7C35.1 25.0 34.9 25.3 34.9 25.3C34.9 25.4 32.3 28.0 32.2 28.0C32.2 28.0 31.9 28.2 31.6 28.4C31.4 28.6 31.0 28.9 30.8 28.9C29.9 29.2 29.9 29.6 30.8 30.1C31.3 30.4 31.5 30.5 32.0 30.5C32.5 30.5 32.5 30.5 33.2 31.1C33.7 31.7 33.8 31.8 34.5 32.0C34.9 32.1 35.3 32.3 35.4 32.4C35.5 32.6 35.9 32.8 36.2 33.0C36.5 33.2 36.8 33.5 37.0 33.6C37.1 33.7 37.3 33.9 37.5 34.0C38.1 34.3 39.0 35.3 39.5 36.1C39.8 36.5 40.2 36.9 40.4 37.1C40.6 37.3 40.9 37.6 40.9 37.7C41.0 37.9 41.2 38.2 41.4 38.5C41.6 38.7 41.8 39.0 41.9 39.2C42.1 39.9 42.3 40.3 42.6 40.7C43.1 41.2 43.2 41.4 43.2 42.1C43.2 42.6 43.2 42.7 43.5 43.0C43.8 43.4 44.0 44.1 44.0 44.7C44.0 44.8 44.1 45.3 44.3 45.6C44.4 46.1 44.5 46.6 44.5 47.0C44.5 47.3 44.6 47.8 44.6 48.0C44.9 48.5 44.9 50.6 44.6 51.1C44.6 51.3 44.5 51.7 44.5 52.1C44.5 52.8 44.5 52.8 44.2 53.2L43.8 53.5L24.0 53.5C4.2 53.5 4.2 53.5 3.9 53.2ZM42.2 51.3C42.8 50.9 42.8 50.7 42.8 49.4C42.8 48.7 42.7 48.2 42.6 48.0C42.6 47.8 42.5 47.3 42.5 47.0C42.5 46.6 42.4 46.1 42.3 45.9C42.3 45.7 42.1 45.1 42.0 44.6C41.9 43.8 41.8 43.5 41.5 43.1C41.4 42.8 41.1 42.3 41.0 42.0C40.9 41.7 40.7 41.2 40.5 41.0C40.3 40.8 40.1 40.3 40.1 40.0C39.9 39.6 39.8 39.4 39.5 39.2C39.3 39.0 38.8 38.5 38.6 38.1C38.0 37.3 36.1 35.3 35.5 35.0C35.4 34.9 35.0 34.7 34.7 34.4C34.4 34.1 34.2 33.9 34.1 33.9C34.1 33.9 33.8 33.7 33.5 33.5C33.3 33.3 32.8 33.1 32.5 33.0C32.2 32.9 31.8 32.7 31.6 32.6C31.3 32.4 30.7 32.2 30.1 32.1C29.3 31.9 28.9 31.8 28.6 31.6C27.9 31.1 26.3 31.0 21.7 31.1C20.6 31.1 20.4 31.2 20.2 31.4C19.5 31.8 19.3 31.9 18.9 31.9C18.7 32.0 18.3 32.0 18.1 32.1C17.8 32.1 17.4 32.2 17.1 32.4C16.8 32.6 16.4 32.9 16.1 33.0C15.8 33.0 15.3 33.3 15.1 33.5C14.8 33.6 14.3 33.9 14.0 34.0C13.6 34.1 13.4 34.2 13.1 34.5C13.0 34.8 12.5 35.2 12.1 35.4C11.4 35.9 10.3 36.9 10.0 37.5C9.9 37.7 9.7 38.0 9.5 38.1C9.4 38.2 9.1 38.6 8.9 39.0C8.6 39.4 8.4 39.7 8.3 39.8C8.2 39.9 8.1 40.2 8.0 40.5C7.9 40.9 7.7 41.3 7.3 41.7C6.9 42.1 6.2 44.2 6.0 45.5C5.9 45.9 5.8 46.5 5.7 46.8C5.5 47.6 5.4 50.6 5.6 51.0C5.9 51.5 4.9 51.5 24.1 51.5C41.0 51.5 42.0 51.4 42.2 51.3ZM42.5 35.0C42.0 34.6 42.2 33.5 42.8 33.3C43.0 33.2 44.9 33.2 47.8 33.2C52.5 33.2 52.5 33.2 52.8 33.4C53.1 33.8 53.1 34.6 52.8 34.9C52.6 35.2 52.6 35.2 47.7 35.2C42.8 35.2 42.7 35.2 42.5 35.0ZM46.4 29.8C43.3 29.8 40.8 29.7 40.7 29.7C40.1 29.4 40.0 28.4 40.5 28.0C40.7 27.8 40.8 27.8 46.7 27.8C52.6 27.8 52.6 27.8 52.8 28.1C53.3 28.7 52.9 29.8 52.2 29.8C52.1 29.8 49.5 29.8 46.4 29.8ZM26.3 28.6C26.7 28.4 27.3 28.2 27.8 28.1C28.2 27.9 28.8 27.7 29.0 27.5C29.2 27.3 29.7 27.1 29.9 27.1C30.3 27.0 30.6 26.8 30.8 26.5C31.0 26.3 31.3 26.1 31.5 26.0C32.1 25.7 33.0 24.7 33.1 24.2C33.2 23.9 33.4 23.7 33.7 23.3C34.8 22.3 35.0 22.0 35.0 21.1C35.0 20.5 35.0 20.3 35.3 19.9C35.5 19.4 35.6 19.2 35.5 18.9C35.5 18.6 35.5 18.3 35.7 18.0C35.9 17.3 35.9 16.5 35.5 15.5C35.3 14.9 35.2 14.6 35.2 14.0C35.2 13.4 35.2 13.2 34.9 12.7C34.3 11.6 33.8 10.8 33.6 10.6C33.5 10.5 33.3 10.2 33.1 10.0C32.8 9.4 31.6 8.2 31.0 7.9C30.8 7.7 30.4 7.5 30.3 7.4C30.2 7.2 29.9 7.1 29.5 7.0C29.2 6.9 28.8 6.8 28.6 6.6C28.0 6.1 27.8 6.0 27.2 5.9C27.0 5.9 26.5 5.8 26.2 5.7C25.5 5.5 23.5 5.4 23.2 5.6C23.0 5.7 22.5 5.8 21.9 5.8C20.3 5.9 19.7 6.1 19.1 6.4C18.8 6.6 18.4 6.9 18.2 6.9C18.0 7.0 17.1 7.9 16.0 8.9C14.2 10.8 14.2 10.8 14.0 11.5C13.9 11.9 13.7 12.3 13.5 12.6C13.1 13.1 13.1 13.1 12.9 14.0C12.8 14.3 12.7 14.8 12.6 15.0C12.4 15.7 12.4 18.4 12.7 19.2C12.8 19.5 12.9 20.1 13.0 20.6C13.1 21.2 13.2 21.5 13.4 21.9C13.6 22.2 13.9 22.7 13.9 23.0C14.1 23.4 14.2 23.6 14.6 23.9C14.8 24.1 15.1 24.5 15.3 24.7C15.7 25.3 16.1 25.6 16.7 26.0C17.0 26.1 17.3 26.4 17.5 26.6C18.4 27.5 18.3 27.5 18.9 27.5C19.3 27.5 19.6 27.6 20.0 27.7C21.3 28.4 21.6 28.5 22.2 28.5C22.6 28.6 23.0 28.6 23.2 28.7C23.9 29.0 25.5 28.9 26.3 28.6ZM42.5 24.0C42.1 23.7 42.1 23.1 42.4 22.6C42.6 22.2 43.0 22.2 47.9 22.2C52.5 22.2 52.5 22.2 52.8 22.4C53.1 22.8 53.1 23.6 52.8 23.9C52.6 24.2 52.6 24.2 47.7 24.2C42.8 24.2 42.7 24.2 42.5 24.0Z"/></svg>',
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
    const card = e.target.closest('.p-card');
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
  }, { passive: true });
  // Clean the class off once it has played, so the next tap is a fresh run
  // and nothing is left holding a finished animation.
  nav.addEventListener('animationend', e => {
    if (e.animationName === 'navTapSignal' || e.animationName === 'ckRipple') {
      // The animation is on the <img> INSIDE the item, so the event target
      // is the image -- the class to clear is on its .navitem ancestor.
      const btn = e.target.closest && e.target.closest('.navitem');
      if (btn) btn.classList.remove('nav-tap');
    }
  });
}
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
    if (slot && slot.dataset.cookieNavIcon !== key) {
      slot.innerHTML = NAV_ICON_SVG[key] || '';
      slot.dataset.cookieNavIcon = key;
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
// in MongoDB behind cookie-server, so there is no Firestore document to attach onSnapshot
// to. The equivalent behaviour without rebuilding the backend is this: a short
// poll that repaints IN PLACE. Nothing reloads, nothing navigates, and the
// member cannot tell the difference. (A genuine server push would be SSE from
// cookie-server off a Mongo change stream -- a real option, and a much bigger
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
        // The same list as the page itself: only the products of the tab that is open (Daily income or Daily wage).
        const list = homeTabProducts();
        $('homeProducts').innerHTML = list.length ? list.map(vProductCardHtml).join('') : '<div class="v-empty">NO DATA</div>';
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
  ckExpectLoad();
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
  else if (name === 'team' || name === 'referral') { name = 'network'; }
  // Daily income is always the first view of Home and of Income: coming from another tab never keeps Daily wage.
  if (name === 'home' && prevPage !== 'home') STATE.homeTab = 'income';
  if (name === 'assets' && prevPage !== 'assets') STATE.incomeTab = 'income';
  STATE.page = name;
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
  else if (name === 'share') await renderShare();
  else if (name === 'account') await renderAccount();
  startLiveRefresh();
};
// Announcement dialog, reintroduced (owner: "we are going to introduce
// announcement dialog, so it will have channel and email buttons shaking
// and glowing, the cancel X sign will be top right... it opens from middle
// as usual and also just like mechanism of previous chipz clicking back to
// home stimulates it"). Was removed entirely in an earlier round (see
// cookie/CLAUDE.md's "Design system" section) -- maybeShowAnnouncement() was
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
// The announcement waits for the loading box to finish, then appears straight away.
var _annPending = false;
function maybeShowAnnouncement(){
  if (_annPending) return;
  _annPending = true;
  const go = () => {
    if (_ckLoadCount > 0 || _ckLoadHideTimer || Date.now() < _ckLoadUntil) { setTimeout(go, 120); return; }
    const fire = () => { _annPending = false; if (!isAnyOverlayOpen()) showAnnouncementNow(); };
    if (_artLanded) fire(); else startArtwork().then(fire);   // the banner picture is fetched behind the loading screen: wait for it so the dialog opens whole
  };
  go();
}
function showAnnouncementNow(){
  const s = STATE.settings || {};
  const bg = $('annBg'), sheet = $('annSheet');
  if (!bg || !sheet) return;
  const link = s.telegramGroup || s.whatsappGroup || '';
  // Nothing is written by hand: the lines come from the settings the admin already controls (withdrawal hours, minimum withdrawal, fee).
  const money = n => cur() + ' ' + Number(n || 0).toLocaleString('en-US');
  const hours = s.withdrawWindowEnabled && s.withdrawOpenFrom && s.withdrawOpenTo ? s.withdrawOpenFrom + '\u2013' + s.withdrawOpenTo : '24 hours';
  const rows = [
    'Daily income, daily withdrawal',
    'Earnings at 00:00 AM',
    'Withdrawal hours: ' + hours,
    'Minimum withdrawal: ' + money(s.minWithdraw),
    'Taxes and fees: ' + (Number(s.withdrawFeePct) || 0) + '%'
  ];
  const title = 'Welcome to the ' + brandName() + ' App';
  const para = 'Official customer service will never proactively ask for your password or screenshots of your deposits; please remain vigilant.';
  sheet.className = 'ann-sheet ck-ann';
  sheet.innerHTML = `
    <button class="ck-ann-x" type="button" aria-label="Close" onclick="closeAnnouncement()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="ck-ann-in">
    ${STATE.announcementImage ? (link ? `<a class="ck-ann-bn" href="${esc(link)}" target="_blank" rel="noopener" onclick="closeAnnouncement()"><img class="ck-ann-img" src="${esc(STATE.announcementImage)}" alt=""></a>` : `<img class="ck-ann-img" src="${esc(STATE.announcementImage)}" alt="">`) : ''}
    <h2 class="ck-ann-h">${esc(title)}</h2>
    <div class="ck-ann-t">${rows.map(r => `<div>${esc(r)}</div>`).join('')}</div>
    <p class="ck-ann-p">${esc(para)}</p>
    ${link ? `<a class="ck-ann-join" href="${esc(link)}" target="_blank" rel="noopener" onclick="closeAnnouncement()"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.6 3.2 2.9 10.4c-.9.35-.9 1.1-.15 1.35l4.7 1.5 1.8 5.5c.2.6.75.75 1.2.3l2.6-2.4 4.6 3.4c.85.5 1.5.25 1.7-.8l3-15.1c.3-1.2-.45-1.7-1.5-1.3ZM8.6 12.9l10.3-6.5c.5-.3.95-.15.55.2l-8.5 7.7-.35 3.7-2-5.1Z"/></svg>Join Group</a>` : ''}
    </div>`;
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
async function renderHome(){
  const hadInvestments = Array.isArray(STATE.investments);
  const shownProducts = homeSignature();
  const hadProductList = !!STATE.products;
  paintHome();
  const [accR, invR, prR] = await Promise.all([ api('/account'), api('/investments'), api('/public/products') ]);
  if (accR.status === 'success') STATE.account = accR.account;
  if (prR.status === 'success' && Array.isArray(prR.products)) STATE.products = prR.products;
  else if (!STATE.products) STATE.products = [];
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
function homeBannerBlockHtml(st){
  const slides = homeCarouselSlides();
  if (!slides) return `<div class="home-banner">${homeBannerInnerHtml(st)}</div>`;
  return `<div class="home-banner" id="homeCarouselTrack"><div class="hb-fade-stack">
    <img class="hb-fade-current" src="${esc(slides[0])}" alt="">
    <img class="hb-fade-next" src="${esc(slides[1])}" alt="">
  </div><div class="hb-bars"><i class="on"></i><i></i></div></div>`;
}
var _homeCarouselTimer = null;
var _homeCarouselIdx = 0;
// Self-terminating on the next tick once Home's own DOM nodes are gone --
// same idiom this file already uses for the check-in countdown and the
// turntable spin timer, so navigating away never leaves this ticking
// against a detached node.
// The banner slides one way, forever. It must also survive the member leaving the app and coming back: a hidden page does not run animation
// frames and delays timers, so a half-finished slide used to be left stuck. Every slide therefore carries a token; leaving or returning (or
// starting again) cancels the old one and puts the banner back at rest on the slide it was showing.
var _hcToken = 0, _hcBusy = false;
function hcRest(slides){
  const wrap = document.getElementById('homeCarouselTrack');
  const stack = wrap && wrap.querySelector('.hb-fade-stack');
  const cur = stack && stack.querySelector('.hb-fade-current'), nxt = stack && stack.querySelector('.hb-fade-next');
  if (!stack || !cur || !nxt) return false;
  _hcToken++; _hcBusy = false;
  stack.classList.add('hb-fade-reset'); stack.classList.remove('hb-crossfading');
  cur.src = slides[_homeCarouselIdx]; nxt.src = slides[(_homeCarouselIdx + 1) % slides.length];
  void stack.offsetWidth;
  stack.classList.remove('hb-fade-reset');
  wrap.querySelectorAll('.hb-bars i').forEach((b, i) => b.classList.toggle('on', i === _homeCarouselIdx));
  return true;
}
function hcStep(slides){
  const wrap = document.getElementById('homeCarouselTrack');
  const stack = wrap && wrap.querySelector('.hb-fade-stack');
  const nxt = stack && stack.querySelector('.hb-fade-next');
  if (!stack || !nxt) { clearInterval(_homeCarouselTimer); _homeCarouselTimer = null; return; }
  if (document.hidden || _hcBusy) return;
  const token = ++_hcToken, nextIdx = (_homeCarouselIdx + 1) % slides.length;
  _hcBusy = true;
  const go = () => {
    if (token !== _hcToken) return;
    if (document.hidden) { _hcBusy = false; return; }
    nxt.src = slides[nextIdx];
    wrap.querySelectorAll('.hb-bars i').forEach((b, i) => b.classList.toggle('on', i === nextIdx));
    void stack.offsetWidth;
    stack.classList.add('hb-crossfading');
    setTimeout(() => {
      if (token !== _hcToken) return;
      _homeCarouselIdx = nextIdx;
      hcRest(slides);
    }, 800);
  };
  const pre = new Image(); let started = false;
  const once = () => { if (started) return; started = true; go(); };
  pre.onload = once; pre.onerror = once; pre.src = slides[nextIdx];
  setTimeout(once, 2500);
}
document.addEventListener('visibilitychange', () => {
  const slides = homeCarouselSlides();
  if (slides && document.getElementById('homeCarouselTrack')) hcRest(slides);
});
function startHomeCarousel(){
  if (_homeCarouselTimer) { clearInterval(_homeCarouselTimer); _homeCarouselTimer = null; }
  const slides = homeCarouselSlides();
  if (!slides) return;
  _homeCarouselIdx = 0; _hcToken++; _hcBusy = false;
  _homeCarouselTimer = setInterval(() => hcStep(slides), Math.min(60000, Math.max(2000, (Number((STATE.settings || {}).bannerSlideSeconds) || 5) * 1000)));
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
// One figure row of a product card: always one line, label then value, the same size and weight for every row and every amount.
function ckRow(label, value){ return `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`; }
function vProductCardHtml(p){
  const { cycle, daily, expected } = planFigures(p);
  const img = p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" onerror="this.remove()">`
    : '';
  const limit = Number(p.buyLimit) || 0;
  return `
  <article class="v-card">
    <div class="v-card-b">
      <div class="v-card-img${p.image ? ' has-img' : ''}">${img}${(limit > 0 || ckIsWage(p)) ? `<em class="v-badge">Times ${vOwnedCount(p.key)}/${limit}</em>` : ''}<span class="v-pname">${esc(p.name || '')}</span></div>
      <dl class="v-rows${[ckMoney(p.price), ckMoney(daily), ckMoney(expected)].some(v => v.length > 11) ? ' tight' : ''}">
        ${ckRow('Price', ckMoney(p.price))}
        ${ckRow('Daily profit', ckMoney(daily))}
        ${ckRow('Days', String(cycle))}
        ${ckRow('Total profit', ckMoney(expected))}
      </dl>
    </div>
    <div class="v-card-f">${vBuyHtml(p)}</div>
  </article>`;
}
// The Buy button keeps every state productCtaHtml() had (open, coming soon,
// ticking countdown); only the markup is new. A closed product is a plain
// disabled button, the glow is for the one that can be bought.
function vBuyHtml(p){
  const limit = Number(p.buyLimit) || 0;
  // At the purchase limit the button looks the same as any other; tapping it says so (the server refuses a purchase over the limit as well).
  if (limit > 0 && vOwnedCount(p.key) >= limit) return `<button class="v-buy" type="button" onclick="notify('Investment Limit...')"><span>Buy now</span></button>`;
  const open = p.isOpen !== false && !p.comingSoon;
  if (open) return `<button class="v-buy" onclick="openInvestConfirm('${esc(p.key)}',this)"><span>Buy now</span></button>`;
  const at = Number(p.opensAt) || 0;
  // Not `disabled`: a disabled button swallows the tap, and the owner's screen
  // shows the "Coming soon, please wait" dialog when it is tapped.
  if (!at || p.openMode === 'soon' || p.comingSoon) return '<button class="v-buy v-soon" onclick="notify(\'Coming soon, please wait\')"><span>Coming soon</span></button>';
  return `<button class="v-buy v-soon" onclick="notify('Coming soon, please wait')" data-opens-at="${at}">Coming soon in ${fmtCountdown(at - Date.now())}</button>`;
}
function vBannerHtml(){
  const st = STATE.settings || {};
  return STATE.homeBanner || homeCarouselSlides()
    ? homeBannerBlockHtml(st)
    : '<div class="home-banner v-banner-empty"></div>';
}
var CK_ICONS = {
  // The Home quick buttons, traced from the owner's screenshots (white shapes on the coloured circles).
  get deposit(){ return '<svg viewBox="0 0 72 72" width="39" height="39" aria-hidden="true"><circle cx="36" cy="36" r="21.5" fill="#fff"/><text x="36" y="40.6" text-anchor="middle" font-size="13" font-weight="700" fill="#34c878" font-family="Roboto,Arial,sans-serif">' + esc(cur()) + '</text></svg>'; },
  withdraw: '<svg viewBox="0 0 72 72" width="39.0" height="39.0" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M50.1 54.5C49.6 54.3 49.3 53.6 49.1 51.8C48.9 49.9 49.2 50.1 44.5 50.0C40.1 49.9 39.9 49.9 39.1 49.3C38.3 48.7 38.2 48.5 38.2 47.4C38.2 45.1 38.8 44.8 44.4 44.7C47.2 44.7 48.1 44.7 48.4 44.6C48.8 44.4 49.0 44.0 49.2 42.4C49.4 40.5 49.4 40.5 49.7 40.2C50.3 39.6 50.9 39.8 52.5 41.3C53.6 42.2 56.8 45.9 57.2 46.5C57.5 47.1 57.5 47.3 57.0 48.4C56.7 49.3 56.7 49.3 54.5 51.4C52.5 53.5 51.6 54.2 50.8 54.6C50.4 54.7 50.5 54.7 50.1 54.5ZM18.6 50.4C18.2 50.3 17.2 50.0 16.7 49.7C16.3 49.5 15.3 48.2 15.2 47.7C15.0 47.2 14.9 35.3 15.1 33.2C15.2 31.3 15.3 31.0 16.0 30.7C16.7 30.5 51.9 30.4 53.1 30.7C54.6 31.1 54.7 31.3 54.7 34.2C54.8 36.4 54.6 37.7 54.2 38.0C54.1 38.2 53.5 38.0 52.9 37.5C52.7 37.3 52.2 37.1 51.9 37.0C51.6 36.9 51.2 36.7 51.0 36.6C50.7 36.4 50.2 36.3 49.8 36.5C49.7 36.6 49.4 36.7 49.1 36.7C48.5 36.7 48.2 36.9 47.6 37.6C46.8 38.6 46.3 39.4 46.1 40.1C45.7 41.6 45.5 41.7 41.3 41.9C39.2 41.9 38.1 42.0 37.7 42.3C36.8 42.7 36.1 43.3 35.7 43.9C35.0 44.8 35.0 45.1 35.0 47.5C34.9 50.3 35.0 50.2 32.8 50.4C31.4 50.5 19.3 50.5 18.6 50.4ZM27.9 45.7C28.6 45.6 28.8 45.6 29.5 45.2C30.5 44.6 30.6 44.5 30.3 43.7C29.6 42.2 29.8 42.2 25.4 42.3C22.9 42.3 21.7 42.3 21.4 42.4C20.5 42.7 19.7 43.9 20.0 44.6C20.2 45.0 21.1 45.6 21.8 45.7C22.4 45.8 26.8 45.8 27.9 45.7ZM16.9 24.4C15.3 24.3 15.2 24.1 15.2 21.7C15.2 19.7 15.1 19.8 16.1 18.9C17.8 17.4 16.2 17.6 34.3 17.5C49.7 17.5 50.2 17.5 50.9 17.7C51.3 17.8 51.9 17.9 52.1 17.9C52.7 18.0 53.0 18.2 53.7 19.0C54.3 19.5 54.3 19.6 54.5 20.5C54.8 21.9 54.7 23.9 54.2 24.2C53.7 24.5 51.6 24.5 34.8 24.5C25.5 24.5 17.5 24.4 16.9 24.4Z"/></svg>',
  service: '<svg viewBox="0 0 72 72" width="39.0" height="39.0" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M33.6 57.8C32.7 57.4 32.6 57.4 32.2 57.4C31.8 57.5 31.6 57.4 31.1 57.2C30.8 57.1 30.4 56.9 30.2 56.8C29.9 56.7 29.5 56.4 29.0 55.9C28.3 55.2 28.1 55.1 27.6 55.0C27.0 54.8 26.9 54.7 26.1 54.0C25.2 53.0 23.6 50.7 23.3 49.8C22.8 47.9 21.6 46.3 20.5 46.0C20.0 45.9 19.6 45.7 19.4 45.5C19.2 45.3 18.9 45.0 18.7 44.9C18.2 44.6 18.2 44.6 17.7 43.1C17.1 41.2 17.1 41.0 17.9 40.1C18.2 39.7 18.4 39.4 18.4 39.3C18.4 39.2 18.4 38.1 18.4 36.8C18.4 34.7 18.4 34.5 18.6 34.0C18.7 33.7 18.9 32.9 19.0 32.1C19.2 31.0 19.3 30.7 19.6 30.2C19.8 29.9 20.0 29.6 20.0 29.5C20.0 29.4 20.1 29.2 20.2 29.1C20.3 28.9 20.4 28.5 20.4 28.1C20.5 27.5 20.5 27.5 21.2 26.7C21.7 26.3 22.0 25.9 22.0 25.8C22.0 25.7 22.2 25.5 22.5 25.2C22.7 24.9 23.0 24.5 23.1 24.3C23.2 24.1 23.6 23.8 24.0 23.5C24.3 23.3 24.8 22.8 25.1 22.6C25.4 22.3 25.8 22.1 26.1 22.0C26.3 21.9 26.7 21.6 26.9 21.5C27.1 21.3 27.4 21.1 27.7 21.0C28.3 20.7 28.9 20.0 29.0 19.4C29.2 18.8 29.3 18.7 30.5 17.5C31.8 16.2 32.0 16.1 32.9 16.0C33.3 15.9 33.5 15.8 33.9 15.5C34.3 15.2 34.4 15.2 35.2 15.1C36.5 15.0 37.3 15.1 37.8 15.2C38.0 15.3 38.5 15.4 38.8 15.4C39.3 15.4 39.5 15.5 39.8 15.7C40.0 15.8 40.4 16.0 40.7 16.1C41.4 16.3 42.5 17.3 43.1 18.3C43.4 18.7 43.7 19.2 43.8 19.5C44.0 19.7 44.4 20.3 44.8 20.7C45.4 21.4 45.4 21.4 45.9 21.4C46.4 21.4 46.4 21.4 47.6 22.6C48.3 23.2 49.0 23.9 49.3 24.0C49.5 24.2 49.8 24.5 50.0 24.8C50.2 25.1 50.7 25.6 51.0 25.9C51.7 26.7 51.8 26.9 52.0 27.8C52.1 28.2 52.3 28.7 52.5 28.9C52.8 29.3 53.2 30.5 53.7 31.8C54.0 32.8 54.1 34.1 54.2 36.4C54.2 38.7 54.2 38.7 54.5 39.0C54.7 39.1 54.9 39.8 55.1 40.3C55.3 40.9 55.6 41.5 55.6 41.8C55.9 42.4 55.8 43.0 55.5 43.4C55.4 43.6 55.2 44.0 55.0 44.3C54.9 44.6 54.7 44.9 54.5 44.9C54.4 45.0 54.1 45.3 53.9 45.5C53.5 45.8 53.3 46.0 52.5 46.2C51.4 46.6 51.0 46.9 50.8 47.6C50.7 48.1 50.1 49.4 49.6 50.2C49.5 50.4 49.2 51.0 49.0 51.5C48.2 53.1 46.1 55.0 43.9 56.0C43.5 56.2 43.0 56.4 42.9 56.5C42.7 56.6 42.3 56.8 42.0 57.0C41.6 57.1 41.2 57.3 41.1 57.4C40.7 57.7 39.7 57.8 36.6 57.9C34.5 57.9 33.9 57.9 33.6 57.8ZM38.1 56.3C38.4 56.3 38.9 56.2 39.2 56.2C40.2 56.2 41.4 55.9 42.1 55.5C42.5 55.3 43.0 55.0 43.3 54.9C44.3 54.5 45.4 53.7 46.5 52.4C47.2 51.8 47.7 51.2 47.7 51.1C47.9 50.9 48.4 49.4 48.5 49.1C48.5 48.7 48.3 48.7 48.1 49.0C48.0 49.2 47.8 49.3 47.7 49.4C47.5 49.5 46.9 49.9 46.4 50.3C45.7 50.7 45.3 50.9 44.9 51.0C44.4 51.0 44.3 51.1 44.1 51.4C43.8 51.9 42.9 52.3 42.4 52.0C41.9 51.7 42.3 51.2 43.3 50.9C43.7 50.8 44.1 50.6 44.3 50.5C44.5 50.3 44.8 50.1 45.1 50.1C45.6 49.9 45.7 49.8 45.9 49.5C46.1 49.1 47.1 48.3 47.7 48.1C47.9 48.0 48.0 47.9 48.2 47.4C48.3 47.2 48.5 46.8 48.6 46.7C48.7 46.6 48.9 46.4 49.0 46.3C49.1 46.1 49.3 45.7 49.5 45.4C50.0 44.8 50.1 44.3 49.9 43.3C49.8 42.6 49.8 42.5 49.2 41.9C48.8 41.6 48.3 41.2 48.0 41.0C47.8 40.8 47.4 40.6 47.3 40.4C47.0 40.1 45.8 39.7 45.0 39.6C44.7 39.6 44.3 39.5 44.1 39.3C43.8 39.1 43.6 39.0 43.0 39.0C42.5 38.9 42.0 38.8 41.8 38.7C41.5 38.6 41.3 38.5 41.0 38.6C40.7 38.6 40.5 38.6 40.1 38.3C39.9 38.1 39.6 38.0 39.6 38.0C39.2 38.0 37.9 37.7 37.6 37.6C37.5 37.5 37.2 37.2 36.9 37.0C36.6 36.6 36.3 36.4 35.8 36.3C35.5 36.2 35.0 35.9 34.8 35.7C34.5 35.6 34.1 35.2 33.8 35.1C33.6 34.9 33.2 34.6 33.1 34.4C33.0 34.3 32.7 34.1 32.5 33.9C32.4 33.8 32.1 33.5 31.9 33.2C31.6 32.7 31.2 32.5 30.8 32.5C30.4 32.6 29.3 33.8 29.1 34.3C29.0 34.5 28.7 34.9 28.6 35.1C28.4 35.3 28.1 35.7 27.9 36.0C27.4 36.7 26.4 37.7 25.8 38.0C25.5 38.2 25.3 38.4 25.2 38.5C25.1 38.6 24.8 38.8 24.5 39.0C23.3 39.6 23.0 40.0 23.0 41.5C23.0 42.1 23.1 42.8 23.1 43.2C23.2 43.6 23.3 44.1 23.2 44.7C23.2 45.5 23.2 45.5 23.5 46.0C23.7 46.4 23.8 46.6 23.8 47.1C23.8 47.7 24.1 48.5 24.4 49.0C24.5 49.2 24.7 49.6 24.9 50.0C25.9 52.2 27.6 54.0 29.0 54.4C29.3 54.5 29.6 54.7 30.0 55.0C30.6 55.6 31.2 55.9 32.3 56.0C32.6 56.1 32.9 56.2 33.1 56.3C33.4 56.6 33.5 56.6 35.5 56.5C37.0 56.5 37.8 56.4 38.1 56.3ZM36.1 54.2C35.8 54.1 35.5 53.9 35.4 53.9C35.1 53.9 34.5 52.8 34.7 52.5C34.8 52.3 35.9 51.8 36.6 51.5C37.1 51.4 37.1 51.4 37.7 51.7C38.3 52.0 38.4 52.0 39.5 52.0C40.5 52.0 40.7 52.0 40.9 52.2C41.2 52.5 41.0 52.6 40.2 52.8C39.2 53.1 38.9 53.2 38.5 53.6C38.0 53.9 37.3 54.3 36.9 54.5C36.7 54.6 36.5 54.5 36.1 54.2Z"/></svg>',
  group: '<svg viewBox="0 0 72 72" width="39.0" height="39.0" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M31.2 55.5C31.1 55.3 31.1 53.5 31.2 49.8C31.3 47.2 31.3 47.2 31.6 46.2C32.0 45.1 32.0 45.1 33.4 43.7C34.1 42.9 34.8 42.1 35.0 41.8C35.1 41.6 35.4 41.3 35.6 41.1C35.8 40.9 36.0 40.5 36.1 40.3C36.2 40.0 36.5 39.6 37.5 38.6C38.2 37.8 38.8 37.0 39.0 36.8C39.2 36.5 39.4 36.2 39.6 36.1C39.8 36.0 39.9 35.7 40.1 35.3C40.2 34.8 40.3 34.6 41.5 33.5C42.2 32.7 42.9 32.0 43.0 31.8C43.1 31.6 43.3 31.3 43.5 31.1C43.7 30.9 44.0 30.5 44.1 30.2C44.3 29.8 44.5 29.5 45.3 28.7C46.3 27.7 46.7 27.2 47.0 26.6C47.0 26.4 47.3 26.2 47.4 26.1C47.6 26.0 47.8 25.8 47.8 25.7C48.0 25.1 47.4 25.0 47.1 25.6C47.0 25.8 46.8 26.1 46.6 26.1C46.1 26.4 45.3 27.0 44.3 28.0C43.7 28.6 43.2 29.1 43.1 29.1C43.0 29.1 41.9 30.2 40.6 31.4C39.3 32.7 38.1 33.9 37.9 34.0C37.7 34.0 37.1 34.5 36.6 35.0C36.2 35.5 35.4 36.2 35.0 36.4C34.7 36.7 33.9 37.3 33.5 37.8C33.0 38.3 32.4 38.9 32.1 39.0C31.9 39.2 30.7 40.3 29.4 41.5C28.2 42.7 27.1 43.8 27.0 43.8C26.5 44.0 25.9 43.8 25.6 43.5C25.4 43.3 25.0 43.1 24.7 43.0C24.5 43.0 24.1 42.8 23.9 42.7C23.7 42.6 23.4 42.5 23.0 42.5C22.4 42.5 22.4 42.5 22.0 42.0C21.6 41.5 21.6 41.5 21.1 41.5C20.6 41.5 20.5 41.5 20.2 41.2C20.1 41.0 19.9 40.8 19.8 40.7C19.6 40.6 19.5 40.5 19.1 40.5C18.6 40.5 18.5 40.4 18.0 40.1C17.3 39.6 17.2 39.4 17.9 39.0C18.2 38.8 18.7 38.4 18.9 38.3C19.2 38.1 19.6 37.8 19.9 37.6C20.1 37.4 20.6 37.2 21.0 37.0C21.3 36.9 21.8 36.7 21.9 36.6C22.1 36.4 22.4 36.2 22.7 36.1C22.9 36.0 23.3 35.8 23.5 35.6C23.7 35.4 24.1 35.1 24.4 35.1C24.7 35.0 25.0 34.8 25.2 34.5C25.5 34.2 25.7 34.1 26.0 34.0C26.3 33.9 26.7 33.7 27.0 33.5C27.3 33.3 27.7 33.1 28.0 33.0C28.2 33.0 28.6 32.7 28.8 32.6C29.0 32.4 29.4 32.1 29.6 32.0C29.9 31.9 30.3 31.6 30.5 31.5C30.8 31.3 31.1 31.0 31.3 30.9C31.5 30.9 31.8 30.6 32.0 30.5C32.3 30.3 32.7 30.1 33.0 30.0C33.3 29.9 33.7 29.7 33.9 29.6C34.1 29.4 34.4 29.2 34.7 29.1C34.9 29.0 35.3 28.7 35.5 28.5C35.8 28.3 36.1 28.0 36.3 27.9C36.5 27.9 36.8 27.6 37.0 27.5C37.3 27.3 37.7 27.1 38.0 27.0C38.3 26.9 38.8 26.7 39.1 26.5C39.4 26.3 39.7 26.1 39.7 26.1C39.7 26.1 40.0 25.9 40.4 25.7C40.7 25.4 41.1 25.1 41.4 25.0C41.7 24.9 42.0 24.8 42.2 24.5C42.3 24.3 42.6 24.2 42.9 24.0C43.2 24.0 43.7 23.7 44.0 23.5C44.2 23.4 44.7 23.1 44.9 23.1C45.2 23.0 45.6 22.8 45.8 22.5C46.1 22.3 46.5 22.0 46.7 22.0C47.0 21.9 47.4 21.6 47.6 21.5C47.8 21.3 48.2 21.0 48.4 20.9C48.6 20.8 49.0 20.6 49.1 20.4C49.3 20.3 49.7 20.1 50.0 20.0C50.3 20.0 50.7 19.8 50.9 19.6C51.1 19.4 51.5 19.2 51.7 19.1C52.0 19.0 52.4 18.7 52.6 18.4C53.1 18.0 53.6 17.9 53.8 18.1C54.0 18.4 53.9 19.9 53.7 20.6C53.7 20.9 53.6 21.5 53.5 22.0C53.5 22.5 53.3 23.0 53.2 23.2C53.1 23.5 53.0 24.1 53.0 24.9C52.9 25.6 52.8 26.3 52.7 26.8C52.5 27.3 52.5 27.7 52.4 28.6C52.4 29.4 52.4 29.9 52.3 30.2C52.1 30.5 52.0 31.1 52.0 31.9C51.9 32.7 51.8 33.4 51.7 33.8C51.6 34.2 51.5 34.7 51.5 35.0C51.5 35.4 51.4 35.7 51.4 35.8C51.3 36.0 51.2 36.4 51.0 38.9C51.0 39.6 50.8 40.4 50.7 40.6C50.7 40.8 50.5 41.4 50.5 41.9C50.4 42.4 50.3 43.0 50.2 43.2C50.1 43.5 50.0 44.2 50.0 45.0C49.9 45.8 49.8 46.4 49.7 46.8C49.5 47.3 49.5 47.7 49.5 48.5C49.5 49.3 49.5 49.6 49.3 50.2C49.1 50.7 49.0 51.2 49.0 51.7C49.0 52.9 48.4 53.3 47.6 52.5C47.3 52.3 47.0 52.1 46.7 52.0C46.5 51.9 46.1 51.8 45.9 51.7C45.7 51.6 45.3 51.5 45.0 51.5C44.7 51.5 44.4 51.4 44.2 51.3C43.9 51.1 43.6 51.0 43.3 50.9C43.1 50.9 42.7 50.6 42.5 50.5C42.2 50.3 41.8 50.0 41.5 50.0C41.2 49.9 40.8 49.7 40.6 49.5C40.4 49.4 40.1 49.2 39.9 49.1C39.7 49.0 39.3 48.9 39.0 48.7C38.7 48.6 38.4 48.5 38.3 48.5C37.8 48.5 36.4 49.7 35.9 50.5C35.9 50.7 35.6 51.0 35.4 51.3C35.2 51.5 35.0 51.8 34.9 52.0C34.8 52.1 34.2 52.8 33.5 53.4C32.9 54.1 32.2 54.7 32.1 54.9C31.8 55.6 31.5 55.8 31.2 55.5Z"/></svg>',
};
function openGroupLink(){
  const s = STATE.settings || {};
  const link = s.telegramGroup || s.whatsappGroup || s.telegramChannel || '';
  if (link) { try { window.open(link, '_blank', 'noopener'); } catch (_) { location.href = link; } }
  else notify('The group link has not been set yet.');
}
window.openGroupLink = openGroupLink;
// Service goes straight to the customer-service link the admin set (no dialog in between).
function openServiceLink(){
  const s = STATE.settings || {};
  const link = s.supportTelegram || '';
  if (link) { try { window.open(link, '_blank', 'noopener'); } catch (_) { location.href = link; } }
  else notify('The service link has not been set yet.');
}
window.openServiceLink = openServiceLink;
// Leaving the app and coming back lands on Daily income again, never on Daily wage.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (STATE.homeTab === 'wage') { STATE.homeTab = 'income'; if (STATE.page === 'home' && $('pageHost') && $('pageHost').querySelector('.v-home')) paintHome(); }
  if (STATE.incomeTab === 'wage') { STATE.incomeTab = 'income'; if (STATE.page === 'assets' && $('pageHost') && $('pageHost').querySelector('.ck-income')) paintAssets(); }
});
// A task product (Daily wage) is one saved as such, or any product that costs nothing.
function homeTabProducts(){
  const tab = STATE.homeTab === 'wage' ? 'wage' : 'income';
  return (STATE.products || []).filter(p => p.active !== false && (ckIsWage(p) ? 'wage' : 'income') === tab);
}
function ckIsWage(p){ return !!p && (p.category === 'wage' || Number(p.price) === 0); }
function setHomeTab(t){ STATE.homeTab = t === 'wage' ? 'wage' : 'income'; if (STATE.page === 'home') paintHome(); }
window.setHomeTab = setHomeTab;
function paintHome(){
  const tab = STATE.homeTab === 'wage' ? 'wage' : 'income';
  // A product the admin switched off (Active unticked) is not offered on Home; owners still see it on Income.
  const products = homeTabProducts();
  const html = `
<div class="v-page v-home">
  ${vBannerHtml()}
  <div class="v-quick ck-quick">
    <button onclick="openDepositSheet()"><span class="ck-ic" style="--c:#31c879">${CK_ICONS.deposit}</span><b>Deposit</b></button>
    <button onclick="openWithdrawSheet()"><span class="ck-ic" style="--c:#f9ab2d">${CK_ICONS.withdraw}</span><b>Withdraw</b></button>
    <button onclick="openServiceLink()"><span class="ck-ic" style="--c:#4b8afe">${CK_ICONS.service}</span><b>Service</b></button>
    <button onclick="openGroupLink()"><span class="ck-ic" style="--c:#7f59fa">${CK_ICONS.group}</span><b>Group</b></button>
  </div>
  <div class="ck-tabs" role="tablist">
    <button type="button" role="tab" class="${tab === 'income' ? 'on' : ''}" onclick="setHomeTab('income')">Daily Income</button>
    <button type="button" role="tab" class="${tab === 'wage' ? 'on' : ''}" onclick="setHomeTab('wage')">Daily wage</button>
  </div>
  <div id="homeProducts">${products.length ? products.map(vProductCardHtml).join('') : (STATE.products ? '<div class="v-empty">NO DATA</div>' : '')}</div>
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
  for (const [id, key] of [['myBalance','walletBalance'], ['myDeposited','totalDeposited'], ['myEarned','totalEarned']]) {
    const el = $(id);
    if (el) el.textContent = numGroup(account[key], false);
  }
  for (const [id, key] of [['incomeTotal','totalEarned'], ['recBalance','walletBalance']]) {
    const el = $(id);
    if (el) el.textContent = vMoney2(account[key]);
  }
  { const el = $('witBalance'); if (el) el.textContent = numGroup(account.walletBalance, true); }
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
function fmtCountdown(ms, toMidnight){
  // Counting to midnight: whole seconds rounded UP (the last second before midnight reads 00:00:01, never a stuck 00:00:00) and never
  // above 23:59:59 (the instant after midnight is a new day, not "24:00:00").
  let s = toMidnight ? Math.min(86399, Math.max(0, Math.ceil(Number(ms) / 1000))) : Math.max(0, Math.floor(Number(ms) / 1000));
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
  ckShell('Income');
  const [pr, ir, ar] = await Promise.all([api('/public/products'), api('/investments'), api('/account')]);
  if (pr.status === 'success' && Array.isArray(pr.products)) STATE.products = pr.products;
  if (ir.status === 'success' && Array.isArray(ir.investments)) STATE.investments = ir.investments;
  else if (!hadCache) STATE.investments = [];
  if (ar.status === 'success') STATE.account = ar.account;
  if (STATE.page !== 'assets') return; // navigated away while awaiting
  paintAssets();
}
// One card per asset the member owns. Expiry is the purchase moment plus the
// asset's own cycle length (the same planStats() figure every progress bar uses).
// Cashback is credited at midnight, so the settlement countdown always counts down to the next midnight of the member's own clock.
function nextMidnightMs(now){
  const off = tzOffMs(), t = now == null ? ckNow() : now;
  return Math.floor((t + off) / 86400000) * 86400000 + 86400000 - off;
}
function vOwnedCardHtml(inv){
  const st = planStats(inv);
  const p = (STATE.products || []).find(x => x.key === inv.tierKey) || {};
  const name = inv.tierLabel || p.name || 'Product';
  const img = p.image ? `<img src="${esc(p.image)}" alt="" onerror="this.remove()">` : '';
  return `
  <article class="ck-oc">
    <div class="ck-oc-b">
      <dl class="ck-oc-rows">
        ${ckRow('Price', ckMoney(st.amount))}
        ${ckRow('Daily profit', ckMoney(st.daily))}
        ${ckRow('Days', String(st.total))}
        ${ckRow('Total profit', ckMoney(st.expected))}
      </dl>
      <div class="ck-oc-img${p.image ? ' has-img' : ''}">${img}${invCategory(inv) === 'wage' && !st.matured ? '<i class="ck-oc-wmul"></i>' : ''}<em class="ck-oc-st${st.matured ? ' done' : ''}${invCategory(inv) === 'wage' ? ' ck-oc-wst' : ''}">${st.matured ? 'Completed' : 'Running'}${invCategory(inv) === 'wage' ? '<br>Free' : ''}</em><span class="ck-oc-name">${esc(name)}</span></div>
    </div>
    ${st.matured ? '' : `<div class="ck-oc-cd"><span>Settlement countdown</span><b data-pay-mid="1">${fmtCountdown(nextMidnightMs() - ckNow(), true)}</b></div>`}
  </article>`;
}
// The settlement countdown on each running card ticks every second; when one reaches zero the list is read again (the payout has just landed).
var _incTimer = null, _incLeft = 0;
function startIncomeCountdowns(){
  if (_incTimer) { clearTimeout(_incTimer); _incTimer = null; }
  _incLeft = 0;
  const tick = () => {
    _incTimer = null;
    const nodes = document.querySelectorAll('[data-pay-mid]');
    if (!nodes.length || STATE.page !== 'assets') return;
    const now = ckNow(), left = nextMidnightMs(now) - now;
    nodes.forEach(el => { el.textContent = fmtCountdown(left, true); });
    // Midnight just passed (the clock jumped back to a full day): the day's cashback has landed, so read the list again.
    if (_incLeft && left > _incLeft + 1000) {
      setTimeout(async () => {
        const r = await api('/investments');
        if (r.status === 'success' && Array.isArray(r.investments)) { STATE.investments = r.investments; if (STATE.page === 'assets') paintAssets(); }
      }, 4000);
    }
    _incLeft = left;
    // The next tick lands just after the next whole second of the server's clock, so the figure changes exactly when the second does.
    _incTimer = setTimeout(tick, (left % 1000 || 1000) + 15);
  };
  tick();
}
// Coming back to the app: the timers were frozen while it was away, so the figure is corrected at once.
document.addEventListener('visibilitychange', () => { if (!document.hidden && _incTimer && STATE.page === 'assets') { clearTimeout(_incTimer); startIncomeCountdowns(); } });
window.setIncomeTab = function(t){ STATE.incomeTab = t === 'wage' ? 'wage' : 'income'; if (STATE.page === 'assets') paintAssets(); };
function statementStampMs(ms){
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// The Income tab a plan lives in is decided by the plan itself (stamped when it was bought or activated; an older plan is read from what it
// cost: a task product costs nothing), never by the product's current settings, so it cannot move if the admin edits or removes the product.
function invCategory(i){ return i && (i.category === 'wage' || i.category === 'income') ? i.category : ((Number(i && i.amount) || 0) === 0 ? 'wage' : 'income'); }
function paintAssets(){
  const tab = STATE.incomeTab === 'wage' ? 'wage' : 'income';
  // Running products first, newest first inside each group; the id is the last tie-break so the order never shuffles between refreshes.
  const owned = (STATE.investments || []).filter(i => (i.status === 'active' || i.status === 'matured')
    && invCategory(i) === tab).sort((x, y) =>
    (x.status === 'active' ? 0 : 1) - (y.status === 'active' ? 0 : 1)
    || (new Date(y.createdAt || 0).getTime() || 0) - (new Date(x.createdAt || 0).getTime() || 0)
    || String(x.id || '').localeCompare(String(y.id || '')));
  const html = `
<div class="ck-sub ck-income v-income">
  ${ckHeader('Income')}
  <div class="ck-tabs ck-inc-tabs" role="tablist">
    <button type="button" role="tab" class="${tab === 'income' ? 'on' : ''}" onclick="setIncomeTab('income')">Daily Income</button>
    <button type="button" role="tab" class="${tab === 'wage' ? 'on' : ''}" onclick="setIncomeTab('wage')">Daily wage</button>
  </div>
  <div class="ck-inc-list" id="ownedAssets">${owned.length ? owned.map(vOwnedCardHtml).join('') : '<div class="v-empty ck-nodata">NO DATA</div>'}</div>
</div>`;
  $('pageHost').innerHTML = html;
  startIncomeCountdowns();
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
// ── THE INVITE LINK'S ADDRESS ──
// With a wildcard domain set up on the server (deploy/set-wildcard.sh), every invite link is made on a NEW random address of it, such as
// https://gs6fy.yourdomain.com/h5/#/pages/login/reset?inviteCode=...: every time the Share screen opens and every time Copy is tapped, so a link is never
// the same twice and no one address carries all the sharing. Every such address serves the very same app. Without that setting, or when the app is open
// on some other address (the IP preview), the link keeps the address the app is open on, which always works.
var SHARE_LABEL_RESERVED = ['www', 'app', 'api', 'admin', 'mail', 'ftp', 'hook', 'cpanel'];
function shareLabel(){
  const letters = 'abcdefghijklmnopqrstuvwxyz', all = letters + '0123456789';
  const n = 4 + shareRand(5);   // 4 to 8 characters, like gsrt or gs6fy
  let out = letters[shareRand(letters.length)];
  for (let i = 1; i < n; i++) out += all[shareRand(all.length)];
  return SHARE_LABEL_RESERVED.indexOf(out) >= 0 ? shareLabel() : out;
}
function shareRand(n){
  try { const a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % n; } catch (_) { return Math.floor(Math.random() * n); }
}
function shareOrigin(){
  const d = String((STATE.settings || {}).shareDomain || '').toLowerCase();
  const h = location.hostname.toLowerCase();
  if (!d || location.protocol !== 'https:' || !(h === d || h.endsWith('.' + d))) return location.origin;
  return 'https://' + shareLabel() + '.' + d;
}
function shareLinkFor(code){ return code ? `${shareOrigin()}/h5/#/pages/login/reset?inviteCode=${encodeURIComponent(code)}` : ''; }
window.copyShareLink = function(btn){
  const t = STATE.teamStats || {}, a = STATE.account || {};
  const link = shareLinkFor(a.referralCode || t.referralCode || '');
  if (!link) return;
  const el = document.querySelector('.ck-url'); if (el) el.textContent = link;
  writeClipboard(link, btn || null);
};
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
  ckExpectLoad();
  { const lt = document.querySelector('.ck-lvtabs'); if (lt) lt.style.setProperty('--i', String(level - 1)); }
  const hd = document.querySelector('.ck-team .ck-hd h1'); if (hd) hd.textContent = 'Team LV.' + level;

  document.querySelectorAll('.v-level').forEach(el => el.classList.toggle('on', Number(el.dataset.level) === level));
  const held = !!STATE.teamMembers[level];
  const fresh = held && Date.now() - (_teamMembersAt[level] || 0) < TEAM_LIST_FRESH_MS;
  // A list read a moment ago shows at once; an older one waits for the new read and appears once, not twice.
  if (fresh) { renderTeamMembers(level); return; }
  { const box = $('teamMembersBox'); if (box) box.innerHTML = teamLoadingHtml(); }
  const r = await api('/team/members?level=' + level);
  if (r.status === 'success') { STATE.teamMembers[level] = r.members; _teamMembersAt[level] = Date.now(); _teamMembersFailed[level] = false; }
  else _teamMembersFailed[level] = true;
  if (_activeTeamLevel === level && STATE.page === 'network') renderTeamMembers(level);
};
// The "Loading . . ." word, centred, while a list is in flight.
function teamLoadingHtml(){ return ''; }
// The small "Loading..." word shown inside a page while its data arrives (same word and
// font as the start-up loader, bouncing a little).
var NAV_LOADER = '<span class="nav-loading">Loading...</span>';
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
  if (!STATE.teamMembers[level] && _teamMembersFailed[level]) { box.innerHTML = '<div class="v-empty" onclick="switchTeamLevel(' + level + ')">Could not load your team</div>'; return; }
  if (!members.length) { box.innerHTML = '<div class="v-empty">NO DATA</div>'; return; }
  const pic = STATE.avatarImg ? ` style="background-image:url('${esc(STATE.avatarImg)}')"` : '';
  box.innerHTML = members.map(m => {
    const bought = Number(m.invested) > 0;
    return `
  <div class="ck-mem">
    <span class="ck-mem-av${STATE.avatarImg ? ' has-img' : ''}"${pic}></span>
    <div class="ck-mem-body">
      <div class="ck-mem-top"><b>Mobile： ${esc(m.phoneRef || m.phoneMasked || maskPhone(m.phone))}</b>${bought ? '<em>Purchased</em>' : ''}</div>
      <div class="ck-mem-mid"><span class="${bought ? 'g' : ''}">Deposit： ${esc(ckNum(m.deposited))}</span><span class="${Number(m.withdrawn) > 0 ? 'r' : ''}">Withdraw： ${esc(ckNum(m.withdrawn))}</span></div>
      <div class="ck-mem-time">Time : ${esc(ckStamp(m.createdAt))}</div>
    </div>
  </div>`;
  }).join('');
}
// ── TASK CENTER (opened from the Team page) ──
// Two lists the owner sets in the admin panel: Referrals (members of your own Level 1 who have deposited) and
// Deposits (what your whole team has deposited). Progress and the claim itself are decided by the server.
var _taskTab = 'count', _taskBusy = false;
function taskLists(){
  const ms = (STATE.teamStats && STATE.teamStats.milestones) || [];
  return { count: ms.filter(m => m.id && m.type === 'count'), deposit: ms.filter(m => m.id && m.type === 'deposit') };
}
function taskReadyCount(){ return ((STATE.teamStats && STATE.teamStats.milestones) || []).filter(m => m.achieved && !m.claimed).length; }
function taskCardHtml(m, isNext){
  const isDep = m.type === 'deposit';
  const cur = Number(m.current) || 0, tgt = Number(m.target) || 1;
  const state = m.claimed ? 'done' : m.achieved ? 'ready' : isNext ? 'next' : 'locked';
  const pct = Math.max(0, Math.min(100, Math.round(cur / tgt * 100)));
  const shown = Math.min(cur, tgt);
  const target = isDep ? vMoney(tgt) : String(tgt);
  const progress = isDep ? vMoney(shown) + ' / ' + vMoney(tgt) : shown + ' / ' + tgt;
  const btn = m.claimed
    ? `<button type="button" class="v-tk-btn done" disabled>${VI.tick}<span>Claimed</span></button>`
    : m.achieved
      ? `<button type="button" class="v-tk-btn go" onclick="claimTask('${esc(m.type)}','${esc(m.id)}',this)"><span>Claim</span></button>`
      : `<button type="button" class="v-tk-btn" onclick="taskNotReached('${esc(m.type)}')"><span>Claim</span></button>`;
  return `<article class="v-tk-card ${state}">
    <div class="v-tk-top">
      <span class="v-tk-medal">${m.claimed ? VI.tick : VI.gift}</span>
      <div class="v-tk-tgt"><b class="${vFit(target, 10, 13)}">${esc(target)}</b><span>${isDep ? 'Team deposits' : 'Level 1 active referrals'}</span></div>
      <span class="v-tk-reward ${vFit(vMoney(m.reward), 11, 13)}">${esc(vMoney(m.reward))}</span>
    </div>
    <div class="v-tk-bar"><i style="width:${pct}%"></i></div>
    <div class="v-tk-foot"><span>Progress: ${esc(progress)}</span>${btn}</div>
  </article>`;
}
// The cards of the open tab (the page and the tab switch both use it).
function taskListInnerHtml(){
  const list = taskLists()[_taskTab];
  const nextIdx = list.findIndex(m => !m.claimed && !m.achieved);
  return list.length ? list.map((m, i) => taskCardHtml(m, i === nextIdx)).join('') : '<div class="v-empty">No tasks yet.</div>';
}
function taskCenterHtml(){
  const t = STATE.teamStats || {};
  const L = taskLists(), tab = _taskTab;
  const ready = k => L[k].filter(m => m.achieved && !m.claimed).length;
  const tabBtn = (k, label) => `<button type="button" class="${tab === k ? 'on' : ''}" onclick="switchTaskTab('${k}')">${label}${ready(k) ? `<em>${ready(k)}</em>` : ''}</button>`;
  return `<div class="v-tk reveal-in">
    <div class="v-tk-hero">
      <span class="v-tk-trophy">${VI.trophy}</span>
      <div class="v-tk-stat"><b>${Number(t.l1ActiveCount) || 0}</b><span>Level 1 active referrals</span></div>
      <i></i>
      <div class="v-tk-stat"><b class="${vFit(vMoney(t.teamDeposits), 10, 13)}">${esc(vMoney(t.teamDeposits))}</b><span>Team deposits</span></div>
    </div>
    <div class="v-tk-tabs" data-tab="${tab}"><i class="v-tk-pill" aria-hidden="true"></i>${tabBtn('count', 'Referrals')}${tabBtn('deposit', 'Deposits')}</div>
    <div class="v-tk-list" id="tkList">${taskListInnerHtml()}</div>
  </div>`;
}
function paintTaskCenter(){
  const b = $('tkBody'); if (!b) return;
  if (_taskFailed && !(STATE.teamStats && STATE.teamStats.milestones)) { _taskShowsFailure = true; b.innerHTML = '<div class="v-empty" onclick="refreshTaskCenter()">Could not load your team</div>'; return; }
  _taskShowsFailure = false;
  b.innerHTML = taskCenterHtml();
}
window.refreshTaskCenter = refreshTaskCenter;
function updateTaskBadge(){
  const e = $('tkBadge'); if (!e) return;
  const n = taskReadyCount(); e.textContent = n; e.style.display = n ? '' : 'none';
}
// Switching tabs: the white pill glides to the other tab and the cards slide out and the new ones slide in from the
// side the member is heading to (nothing jumps). With reduced motion, or no page to animate, it swaps at once.
var _tkSwapTimer = null;
window.switchTaskTab = function(k){
  const next = k === 'deposit' ? 'deposit' : 'count';
  if (next === _taskTab) { paintTaskCenter(); return; }
  _taskTab = next;
  const tabs = document.querySelector('.v-tk-tabs'), list = $('tkList');
  const calm = typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!tabs || !list || calm) { paintTaskCenter(); return; }
  tabs.dataset.tab = next;
  tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 1) === (next === 'deposit')));
  const dir = next === 'deposit' ? 1 : -1;
  clearTimeout(_tkSwapTimer);
  list.style.transition = 'opacity .13s ease, transform .13s ease';
  list.style.opacity = '0';
  list.style.transform = 'translateX(' + (-dir * 22) + 'px)';
  _tkSwapTimer = setTimeout(() => {
    const cur = $('tkList'); if (!cur) return;
    cur.innerHTML = taskListInnerHtml();
    cur.style.transition = 'none';
    cur.style.transform = 'translateX(' + (dir * 22) + 'px)';
    void cur.offsetWidth;
    cur.style.transition = 'opacity .28s ease, transform .34s cubic-bezier(.2,.85,.25,1)';
    cur.style.opacity = '1';
    cur.style.transform = 'none';
  }, 130);
};
var _taskFailed = false, _taskTimer = null, _taskShowsFailure = false;
// Fetches the true progress. A failed fetch keeps whatever the page already shows; with nothing to show it says so
// (tap to retry) instead of printing "No tasks yet." as if the owner had none.
async function refreshTaskCenter(){
  const had = !!(STATE.teamStats && STATE.teamStats.milestones);
  const before = had ? JSON.stringify([STATE.teamStats.milestones, STATE.teamStats.l1ActiveCount, STATE.teamStats.teamDeposits]) : '';
  const r = await api('/team/stats');
  if (r.status === 'success') { STATE.teamStats = r; _taskFailed = false; }
  else _taskFailed = !had;
  const now = STATE.teamStats && STATE.teamStats.milestones ? JSON.stringify([STATE.teamStats.milestones, STATE.teamStats.l1ActiveCount, STATE.teamStats.teamDeposits]) : '';
  if (_openSheetTitle === 'Task Center' && (before !== now || _taskFailed || !had || _taskShowsFailure)) paintTaskCenter();
  updateTaskBadge();
}
window.openTaskCenter = async function(){
  openSheet('Task Center', '<div id="tkBody"></div>');
  if (STATE.teamStats && STATE.teamStats.milestones) paintTaskCenter();
  else { const b = $('tkBody'); if (b) b.innerHTML = '<div class="v-tk-wait">' + NAV_LOADER + '</div>'; }
  // While the page is open, progress is re-read every 15 seconds so a referral that just deposited shows up by itself.
  if (_taskTimer) clearInterval(_taskTimer);
  _taskTimer = setInterval(() => {
    if (_openSheetTitle !== 'Task Center') { clearInterval(_taskTimer); _taskTimer = null; return; }
    if (!_taskBusy && !document.hidden) refreshTaskCenter();
  }, 15000);
  await refreshTaskCenter();
};
// Tapping Claim on a task that is not reached yet says so (a disabled button would swallow the tap), with a nudge on what to do.
window.taskNotReached = function(type){
  notify(type === 'deposit'
    ? 'Deposit target not reached. Keep growing your team and encourage them to deposit.'
    : 'Referral target not reached. Share your invite link to bring in more members.');
};
window.claimTask = async function(type, id, btn){
  if (_taskBusy) return;
  _taskBusy = true; if (btn) { btn.disabled = true; btn.textContent = 'Claiming…'; }
  let r;
  try { r = await post('/team/task/claim', { type, id }); } finally { _taskBusy = false; }
  if (r.status === 'success') {
    const m = ((STATE.teamStats && STATE.teamStats.milestones) || []).find(x => x.type === type && x.id === id);
    if (m) m.claimed = true;
    const before = Number((STATE.account || {}).walletBalance) || 0;
    const reward = Number(r.amount) || 0;
    const after = Number.isFinite(Number(r.walletBalance)) && r.walletBalance !== null ? Number(r.walletBalance) : before + reward;
    if (STATE.account) STATE.account.walletBalance = after;
    paintTaskCenter(); updateTaskBadge();
    showChestWin(reward, after, () => {});
    refreshAfterWin();
    return;
  }
  // Not claimable after all (already taken, progress changed, task removed): say so and show the true state.
  notify(r.message || 'Could not claim that reward');
  await refreshTaskCenter();
  if (_openSheetTitle === 'Task Center') paintTaskCenter();
};
async function renderNetwork(){
  // One load: the header shows while the member's own figures and list are read, then the whole page appears once.
  const hadCache = !!STATE.teamStats;
  const level = _activeTeamLevel || 1;
  ckShell('Team LV.' + level);
  const [r, m] = await Promise.all([ api('/team/stats'), api('/team/members?level=' + level) ]);
  if (r.status === 'success') STATE.teamStats = r;
  else if (!hadCache) STATE.teamStats = { referralCode:'', commRates:{l1:0,l2:0,l3:0}, team:{l1:0,l2:0,l3:0}, totalTeam:0, teamCommission:0, teamDeposits:0, levelCommission:{l1:0,l2:0,l3:0} };
  if (m.status === 'success') { STATE.teamMembers[level] = m.members; _teamMembersAt[level] = Date.now(); _teamMembersFailed[level] = false; }
  else _teamMembersFailed[level] = true;
  if (STATE.page !== 'network') return;
  paintNetwork();
}
// ── SHARE ── the invitation link, the invitation code and what each level earns (the figures come from /team/stats).
async function renderShare(){
  const hadCache = !!STATE.teamStats;
  ckShell('Share');
  const r = await api('/team/stats');
  if (r.status === 'success') STATE.teamStats = r;
  else if (!hadCache) STATE.teamStats = { referralCode:'', commRates:{l1:0,l2:0,l3:0}, team:{l1:0,l2:0,l3:0}, totalTeam:0, teamCommission:0, teamDeposits:0, levelCommission:{l1:0,l2:0,l3:0} };
  if (STATE.page !== 'share') return;
  paintShare();
}
function ckShell(title){ $('pageHost').innerHTML = '<div class="ck-sub ck-shell">' + ckHeader(title) + '</div>'; }
function ckHeader(title, back){
  return `<header class="ck-hd">${back ? `<button class="ck-back" type="button" aria-label="Back" onclick="${back}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4.5 7.5 12l7.5 7.5"/></svg></button>` : ''}<h1>${esc(title)}</h1></header>`;
}
function ckHero(img, cls){ return `<div class="ck-hero ${cls || ''}${img ? ' has-img' : ''}"${img ? ` style="background-image:url('${esc(img)}')"` : ''}></div>`; }
function paintShare(){
  const t = STATE.teamStats || { referralCode:'', commRates:{} };
  const rates = t.commRates || {};
  const a = STATE.account || {};
  const code = a.referralCode || t.referralCode || '';
  const link = shareLinkFor(code);
  $('pageHost').innerHTML = `
<div class="ck-sub ck-share">
  ${ckHeader('Share')}
  ${ckHero(STATE.shareHero, 'ck-hero-share')}
  <div class="ck-sharecard">
    <div class="ck-copyrow"><span class="ck-url">${esc(link || '—')}</span><button type="button" class="copy-ic" data-copy-group="share-link" onclick="copyShareLink(this)">Copy</button></div>
    <div class="ck-copyrow"><span class="ck-code">${esc(code || '—')}</span><button type="button" class="copy-ic" data-copy-group="share-code" onclick="copyText('${esc(code)}')">Copy</button></div>
    <p class="ck-note">Share your referral link on social media platforms like Facebook, TikTok, and WhatsApp groups to earn money from home. Commissions can be withdrawn at any time</p>
    <div class="ck-lvtable">${[1, 2, 3].map(n => `<div><b>LV - ${n}</b><b>${rates['l' + n] != null ? rates['l' + n] : 0}%</b></div>`).join('')}</div>
  </div>
</div>`;
}
function paintNetwork(){
  const t = STATE.teamStats || { referralCode:'', commRates:{}, team:{}, totalTeam:0, teamDeposits:0, levelCommission:{} };
  const rates = t.commRates || {}, team = t.team || {}, lc = t.levelCommission || {};
  const level = _activeTeamLevel || 1;
  _activeTeamLevel = level;
  const tabs = [1, 2, 3].map(n => `
    <button class="v-level${level === n ? ' on' : ''}" data-level="${n}" onclick="switchTeamLevel(${n})">
      <b>LV:${n}</b><small>Income ${rates['l' + n] != null ? rates['l' + n] : 0}%</small>
    </button>`).join('');
  const html = `
<div class="ck-sub ck-team v-team">
  ${ckHeader('Team LV.' + level)}
  ${ckHero(STATE.teamHero || STATE.homeBanner, 'ck-hero-team')}
  <div class="ck-stats">
    <div><span>Deposit</span><b>${esc(vMoney(t.teamDeposits))}</b></div>
    <div><span>Team size</span><b>${Number(t.totalTeam) || 0}</b></div>
  </div>
  <div class="ck-lvtabs" style="--i:${level - 1}"><i class="ck-lvpill"></i>${tabs}</div>
  <div id="teamMembersBox"></div>
</div>`;
  $('pageHost').innerHTML = html;
  switchTeamLevel(level); // shows a held list at once and refreshes it if it is old
}

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
  btn.innerHTML = isIconBtn ? COPY_TICK : 'Copied';
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
    .then(() => ckCopyToast())
    // A failure has nothing visible to show for itself, so it still needs
    // saying -- and that is exactly what the alert card is for.
    .catch(() => notify('Could not copy'));
}
// The button is taken from the event rather than passed in by every call site:
// the markup already routes through onclick, so `this` is the control that was
// tapped, and no template needs editing to opt in.
// A copy shows the grey "Copy successful" box and, lower down, the dark "Copied." pill.
var _ckCopyTimer = null;
function ckCopyToast(){
  notify('Copy successful');
  let pill = $('ckCopied');
  if (!pill) { pill = document.createElement('div'); pill.id = 'ckCopied'; pill.className = 'ck-copied'; pill.textContent = 'Copied.'; document.body.appendChild(pill); }
  pill.classList.add('show');
  if (_ckCopyTimer) clearTimeout(_ckCopyTimer);
  _ckCopyTimer = setTimeout(() => { pill.classList.remove('show'); _ckCopyTimer = null; }, 1400);
}
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
// the owner -- see server.js's COOKIE_IMAGE_SLOTS comment -- so the card
// falls back to the shared auth-hero photo via .acct-card's own
// --acct-card-image default) and a plain row list with coloured-circle SVG
// icons replacing the old settings list's coloured squares + Cookie raster
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
function vTileHtml(icon, label, onclick, tone){
  return `<button class="v-tile" onclick="${onclick}"><span class="v-tile-ic ${tone || ''}">${icon}</span><b>${label}</b></button>`;
}
var CK_MENU_ICONS = {
  mail: '<svg viewBox="0 0 62 50" width="22.4" height="18.1" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M6.8 46.9C6.6 46.9 6.4 46.7 6.2 46.6C6.1 46.5 5.7 46.3 5.4 46.1C5.1 45.9 4.5 45.5 4.2 45.2C3.5 44.5 3.5 44.5 3.5 43.9C3.5 43.6 3.4 43.2 3.4 43.0C3.2 42.7 3.2 40.4 3.2 25.0C3.2 7.3 3.2 7.3 3.4 6.7C3.6 6.3 3.8 5.8 3.9 5.6C4.1 4.8 4.7 4.2 5.4 4.1C5.7 4.0 6.1 3.8 6.3 3.7C6.5 3.5 6.8 3.3 7.0 3.3C7.1 3.2 16.3 3.2 31.4 3.2C55.6 3.2 55.6 3.2 56.0 3.5C56.2 3.6 56.5 3.9 56.7 4.0C56.9 4.0 57.4 4.4 57.8 4.8C58.5 5.4 58.5 5.4 58.5 6.0C58.5 6.5 58.5 6.6 58.7 6.9C59.0 7.3 59.0 7.3 59.0 25.0C59.0 42.2 59.0 42.7 58.8 43.5C58.5 44.5 57.9 45.6 57.2 46.0C57.0 46.1 56.6 46.4 56.5 46.5C56.3 46.7 56.0 46.8 55.9 46.9C55.5 47.0 7.3 47.0 6.8 46.9ZM54.5 43.5C55.6 43.0 55.5 44.7 55.5 28.7C55.5 19.1 55.5 14.5 55.6 14.1C55.9 13.0 54.7 13.3 53.1 14.9C52.5 15.4 51.9 16.0 51.6 16.1C50.8 16.6 50.2 17.0 49.9 17.4C49.7 17.6 49.4 17.9 49.1 18.0C48.8 18.2 48.6 18.4 48.5 18.5C48.4 18.6 48.1 18.8 47.9 19.0C47.6 19.1 47.2 19.4 47.1 19.6C47.0 19.7 46.7 19.9 46.4 20.0C46.2 20.1 45.9 20.3 45.8 20.4C45.7 20.6 45.5 20.8 45.2 21.0C45.0 21.1 44.4 21.6 43.9 22.1C43.4 22.5 42.8 23.0 42.5 23.1C41.8 23.5 41.4 23.8 40.9 24.4C40.6 24.7 40.3 25.0 40.0 25.1C39.8 25.2 39.6 25.4 39.5 25.5C39.4 25.6 39.1 25.8 38.9 25.9C38.7 26.0 38.3 26.3 38.1 26.6C37.8 26.8 37.5 27.0 37.4 27.0C37.4 27.0 37.1 27.2 36.9 27.4C36.6 27.7 36.2 28.0 36.0 28.1C35.4 28.5 34.8 28.9 34.1 29.5C33.7 29.9 33.5 30.0 33.3 30.0C32.8 30.0 32.4 30.1 32.0 30.5C31.6 30.8 31.3 30.9 30.9 30.6C30.7 30.5 30.4 30.5 30.1 30.5C29.6 30.5 29.1 30.3 28.1 29.5C28.0 29.4 27.6 29.2 27.4 29.1C27.2 29.0 26.6 28.5 26.1 28.1C25.6 27.6 25.0 27.1 24.8 27.0C24.6 26.8 24.2 26.6 24.1 26.4C24.0 26.2 23.7 26.1 23.4 26.0C22.9 25.8 22.7 25.6 21.5 24.5C20.6 23.6 20.0 23.0 19.6 22.9C19.3 22.7 19.1 22.6 19.0 22.5C19.0 22.4 18.8 22.3 18.5 22.1C18.2 22.0 17.6 21.5 17.1 21.1C16.6 20.6 16.0 20.1 15.8 20.0C15.6 19.8 15.2 19.6 15.1 19.4C15.0 19.2 14.7 19.1 14.4 19.0C13.9 18.8 13.7 18.6 12.5 17.5C11.6 16.6 11.0 16.0 10.6 15.9C10.3 15.7 10.1 15.6 10.0 15.5C10.0 15.4 9.8 15.3 9.5 15.1C9.2 15.0 8.7 14.6 8.3 14.2C7.6 13.4 7.3 13.3 7.0 13.6C6.8 13.8 6.8 13.8 6.8 28.2C6.8 43.6 6.8 43.4 7.3 43.7C7.4 43.8 11.9 43.8 30.7 43.8L53.9 43.8L54.5 43.5ZM32.3 26.6C32.5 26.5 32.9 26.2 33.1 26.1C33.4 25.9 33.8 25.6 34.0 25.3C34.2 25.1 34.6 24.8 34.8 24.6C36.0 23.9 36.3 23.7 37.2 22.9C37.7 22.4 38.1 22.0 38.2 22.0C38.3 22.0 38.5 21.8 38.8 21.6C39.0 21.3 39.4 21.1 39.6 21.0C39.8 20.9 40.1 20.7 40.2 20.6C40.3 20.4 40.5 20.2 40.8 20.0C41.0 19.9 41.4 19.6 41.6 19.4C41.8 19.3 42.1 19.1 42.2 19.0C42.3 18.9 42.7 18.6 43.0 18.4C43.2 18.1 43.6 17.8 43.8 17.6C45.0 16.9 45.3 16.7 46.2 15.9C46.7 15.4 47.1 15.0 47.2 15.0C47.3 15.0 47.5 14.8 47.8 14.6C48.0 14.3 48.4 14.1 48.6 14.0C48.8 13.9 49.1 13.7 49.2 13.6C49.3 13.4 49.5 13.2 49.8 13.0C50.0 12.9 50.4 12.6 50.5 12.5C50.7 12.3 51.0 12.1 51.3 12.0C51.5 11.8 51.8 11.6 51.9 11.4C52.1 11.1 52.9 10.5 53.9 10.0C54.6 9.6 55.6 8.3 55.6 7.8C55.6 7.5 55.2 7.1 54.5 6.8L53.7 6.5L30.6 6.5C8.6 6.5 7.5 6.5 7.3 6.7C6.8 7.1 6.6 8.3 7.0 8.7C7.2 9.0 8.1 9.7 8.7 9.9C8.9 10.0 9.7 10.7 10.5 11.5C11.6 12.6 11.9 12.9 12.2 13.0C12.5 13.0 12.8 13.2 13.2 13.5C13.5 13.8 13.7 14.0 13.8 14.0C13.9 14.0 14.3 14.4 14.8 14.9C15.7 15.7 16.1 16.0 17.4 16.8C17.7 16.9 18.6 17.7 19.4 18.5C20.6 19.6 20.9 19.9 21.2 20.0C21.5 20.0 21.8 20.2 22.2 20.5C22.5 20.8 22.7 21.0 22.8 21.0C22.9 21.0 23.3 21.4 23.8 21.9C24.7 22.7 25.1 23.0 26.4 23.8C26.7 23.9 27.6 24.6 28.3 25.4C30.0 27.0 30.0 27.0 31.1 27.0C31.9 27.0 32.0 26.9 32.3 26.6Z"/></svg>',
  person: '<svg viewBox="0 0 62 44" width="22.4" height="15.9" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7.0 41.4C6.6 41.3 6.1 41.2 5.8 41.2C5.2 41.2 4.9 41.0 4.0 40.0C2.9 39.0 3.0 40.4 3.0 21.8C3.0 3.7 2.9 5.8 3.9 4.3C4.4 3.5 4.8 3.2 5.4 3.0C5.7 2.9 6.0 2.8 6.1 2.7C6.4 2.5 6.9 2.5 30.5 2.5C51.7 2.5 54.7 2.5 55.1 2.7C55.4 2.7 55.9 2.8 56.2 2.8C57.0 2.8 57.6 3.1 58.0 3.8C58.2 4.0 58.5 4.4 58.6 4.6C59.2 5.4 59.2 4.8 59.2 21.9C59.2 33.4 59.2 37.8 59.1 38.2C58.9 39.0 58.7 39.4 57.8 40.3C56.3 41.7 59.6 41.5 31.7 41.5C9.0 41.5 7.5 41.5 7.0 41.4ZM55.9 39.7C56.4 39.6 56.8 39.2 57.2 38.5C57.5 38.0 57.5 38.0 57.5 21.7C57.5 6.1 57.5 5.5 57.3 5.3C57.1 5.2 56.7 4.9 55.8 4.4C55.2 4.1 7.7 4.1 6.9 4.4C6.6 4.5 6.1 4.6 5.9 4.7C5.5 4.8 5.3 4.9 5.1 5.2L4.8 5.5L4.8 21.5C4.8 39.6 4.8 38.5 5.5 39.1C5.8 39.4 6.1 39.6 6.2 39.7C6.6 39.8 55.3 39.9 55.9 39.7ZM49.8 32.0C49.7 32.0 41.1 32.0 30.6 32.0C10.5 32.0 11.2 32.0 11.2 31.6C11.2 31.4 13.0 31.4 30.6 31.4C42.3 31.4 49.4 31.4 49.7 31.4C50.3 31.2 50.5 31.3 50.6 31.7C50.6 32.0 50.0 32.3 49.8 32.0ZM15.1 27.1C14.9 27.0 14.4 27.0 13.9 27.1C12.8 27.1 11.9 26.9 11.4 26.4C11.2 26.2 10.8 26.0 10.6 25.9C10.0 25.7 9.8 24.8 10.2 23.9C10.3 23.7 10.4 23.3 10.4 23.0C10.4 22.8 10.5 22.5 10.6 22.3C10.7 22.2 10.8 21.8 10.9 21.5C11.1 20.9 11.3 20.5 12.1 20.1C12.4 19.9 12.7 19.6 12.8 19.5C13.0 18.9 14.2 18.7 14.3 19.2C14.3 19.6 14.1 19.9 13.6 20.1C13.0 20.3 12.2 21.2 12.0 21.8C11.9 22.0 11.8 22.3 11.6 22.4C11.3 22.8 10.9 23.5 10.9 24.0C10.9 24.5 11.3 25.3 11.8 25.7C12.1 26.0 12.2 26.0 12.8 26.0C14.5 25.8 16.6 26.2 16.8 26.7C16.9 27.0 15.7 27.3 15.1 27.1ZM17.6 27.0C17.1 26.7 17.1 26.6 17.8 26.3C18.2 26.1 18.4 26.0 20.2 26.0C21.6 26.0 22.3 25.9 22.5 25.8C22.9 25.6 23.0 25.1 23.0 23.7C23.0 22.2 22.9 22.1 22.5 21.9C22.3 21.8 22.1 21.6 21.9 21.3C21.6 20.6 20.9 19.8 20.3 19.5C20.1 19.3 19.8 19.1 19.8 18.9C19.7 18.7 19.6 18.6 19.2 18.8C18.9 19.0 14.9 19.0 14.6 18.9C14.5 18.8 14.5 18.6 14.5 18.1C14.5 17.6 14.5 17.5 14.2 17.2C14.0 17.0 13.9 16.6 13.8 16.3C13.7 15.9 13.5 15.6 13.4 15.4C12.9 14.9 12.9 14.1 13.5 13.5C13.6 13.3 13.9 12.9 14.0 12.7C14.1 12.3 14.3 12.1 15.1 11.1C15.2 11.0 15.4 10.9 15.9 10.9C16.4 10.8 16.7 10.7 16.9 10.6C17.3 10.3 17.6 10.4 17.9 10.9C18.1 11.3 18.2 11.3 18.7 11.3C19.3 11.3 19.3 11.3 20.1 12.0C20.8 12.7 20.8 12.8 21.0 13.6C21.2 14.3 21.2 14.5 21.1 15.0C20.8 16.2 20.8 16.3 20.2 16.7C19.6 17.2 19.5 17.4 19.6 18.0C19.7 18.4 19.7 18.4 20.1 18.4C20.5 18.4 20.5 18.4 21.2 19.2C21.6 19.6 22.2 20.2 22.4 20.4C22.7 20.6 23.0 21.0 23.1 21.3C23.2 21.5 23.5 21.9 23.6 22.0C24.0 22.4 24.0 22.4 24.0 23.0C24.0 23.4 24.0 23.9 24.1 24.1C24.3 24.9 24.0 25.6 23.3 26.3C22.6 27.0 22.7 27.0 20.6 27.0C19.6 27.1 18.7 27.1 18.4 27.1C18.2 27.2 17.9 27.2 17.6 27.0ZM28.9 25.9C28.8 25.9 28.6 25.8 28.6 25.7C28.4 25.4 28.6 25.2 28.9 25.1C29.0 25.1 34.0 25.0 39.9 25.0C50.1 25.0 50.6 25.0 50.7 25.2C50.9 25.4 50.9 25.6 50.7 25.8C50.5 26.0 49.7 26.0 39.8 26.0C34.0 26.0 29.0 25.9 28.9 25.9ZM28.3 18.8C28.0 18.6 28.1 18.4 28.3 18.2C28.5 18.0 29.3 18.0 39.3 18.0C50.2 18.1 50.2 18.1 50.4 18.3C50.6 18.5 50.6 18.5 50.4 18.7C50.2 18.9 50.2 18.9 39.3 19.0C28.8 19.0 28.4 19.0 28.3 18.8ZM17.7 17.6C17.9 17.5 18.3 17.3 18.6 17.2C19.7 16.6 20.2 15.6 20.1 14.2C20.0 13.1 19.9 12.9 19.0 12.1C18.3 11.4 18.1 11.4 17.1 11.7C16.6 11.9 16.2 12.0 15.3 12.2C15.1 12.2 14.9 12.6 14.9 12.9C14.9 13.0 14.7 13.3 14.5 13.5C14.2 13.8 14.1 14.1 14.0 14.4C13.8 15.3 13.9 15.5 14.3 15.8C14.6 15.9 14.8 16.2 15.0 16.5C15.2 17.1 15.3 17.1 15.9 17.2C16.1 17.3 16.4 17.4 16.7 17.6C17.2 18.0 17.3 18.0 17.7 17.6ZM28.5 12.6C28.2 12.2 28.5 11.8 29.1 11.9C29.3 12.0 34.0 12.0 39.5 12.0C45.0 12.0 49.6 12.0 49.7 12.1C50.0 12.3 49.4 12.8 49.0 12.7C48.7 12.6 29.8 12.6 29.1 12.7C28.8 12.7 28.6 12.7 28.5 12.6Z"/></svg>',
  income: '<svg viewBox="0 0 58 59" width="20.9" height="21.3" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M52.0 55.9C51.8 55.8 51.3 55.4 50.8 54.9C50.3 54.4 49.9 54.0 49.8 54.0C49.7 54.0 49.2 53.5 48.7 53.0C47.6 51.9 47.5 51.9 46.9 52.1C46.8 52.2 46.6 52.4 46.6 52.4C46.5 52.7 46.0 52.9 45.4 53.0C45.0 53.1 44.4 53.2 44.0 53.3C43.2 53.6 41.6 53.6 41.0 53.4C40.7 53.2 39.2 52.9 38.9 52.9C38.9 52.9 38.7 52.7 38.5 52.5C38.1 52.2 37.9 52.1 37.4 52.0C36.9 51.9 36.8 51.8 36.1 51.1C35.6 50.7 35.2 50.2 35.0 49.9C34.9 49.7 34.6 49.3 34.5 49.0C34.3 48.8 34.1 48.3 34.0 48.0C33.9 47.7 33.6 47.3 33.5 47.1C33.2 46.7 33.1 46.6 33.1 45.8C33.0 43.9 33.1 42.7 33.3 42.1C33.5 41.7 33.5 41.5 33.4 41.1C33.4 40.5 33.4 40.5 34.1 39.8C34.7 39.3 34.8 39.1 34.9 38.6C35.2 37.8 35.4 37.4 36.0 37.1C36.2 37.0 36.6 36.8 36.7 36.6C36.9 36.5 37.3 36.3 37.5 36.1C37.8 36.0 38.2 35.7 38.5 35.5C38.7 35.3 39.0 35.1 39.3 35.0C39.5 35.0 39.8 34.9 40.0 34.9C40.2 34.8 40.6 34.8 41.0 34.8C41.5 34.8 41.9 34.7 42.3 34.5C43.1 34.3 43.2 34.3 43.9 34.7C44.3 35.0 44.4 35.0 45.1 35.0C45.9 35.0 46.1 35.1 46.6 35.6C46.9 35.8 47.2 35.9 47.6 36.0C48.1 36.1 48.2 36.2 48.9 36.8C49.3 37.3 49.8 37.8 49.9 38.0C50.0 38.2 50.3 38.7 50.5 39.0C50.8 39.3 51.1 40.1 51.4 41.1C52.1 43.1 52.2 44.5 51.8 45.7C51.6 46.3 51.5 46.6 51.6 46.9C51.6 47.2 51.6 47.4 51.3 48.0C50.6 49.3 50.7 49.3 51.6 50.3C52.0 50.7 52.5 51.1 52.7 51.2C53.8 52.0 53.9 52.1 54.5 53.0C55.1 53.9 55.0 54.6 54.2 55.3C53.5 56.0 52.5 56.2 52.0 55.9ZM5.2 51.4C5.1 51.3 4.8 51.1 4.5 51.0C4.0 50.8 3.4 50.0 3.0 49.1C2.8 48.6 2.8 48.5 2.8 27.3C2.9 15.5 2.9 5.6 3.0 5.1C3.0 4.2 3.1 4.2 3.5 3.8C3.7 3.6 4.0 3.3 4.1 3.1C4.4 2.8 4.4 2.8 5.0 2.8C5.4 2.8 5.8 2.7 6.0 2.6C6.4 2.5 9.0 2.5 28.5 2.5C50.5 2.5 50.5 2.5 50.9 2.7C51.2 2.9 51.5 3.0 51.6 3.0C51.9 3.1 52.4 3.7 52.8 4.5C53.0 4.8 53.0 5.1 53.0 19.3C53.0 32.8 53.0 33.8 52.8 34.0C52.5 34.4 52.0 34.2 51.6 33.6C51.0 32.9 50.0 32.1 49.5 32.0C48.8 31.9 48.5 31.7 48.3 31.2C48.2 30.9 48.2 29.5 48.1 19.4C48.1 6.1 48.2 7.7 47.9 7.4C47.6 7.1 8.4 7.1 8.1 7.4C8.0 7.5 7.9 7.7 7.9 7.8C7.9 7.9 7.9 16.6 7.9 27.1C7.9 44.9 7.9 46.5 8.1 46.7C8.1 46.7 12.6 46.8 18.1 46.8C27.9 46.9 27.9 46.9 28.4 47.1C28.8 47.3 29.0 47.7 29.0 48.3C29.0 48.7 29.2 49.2 29.6 49.5C30.2 50.2 30.4 51.0 30.0 51.3C29.6 51.6 5.6 51.6 5.2 51.4ZM42.7 49.4C43.0 49.2 43.4 49.2 43.8 49.2C44.7 49.2 44.9 49.0 46.0 47.9C46.7 47.2 47.0 46.8 47.1 46.5C47.2 46.2 47.4 45.7 47.6 45.3C47.7 44.9 47.8 44.5 47.8 44.0C47.8 43.5 47.7 43.1 47.6 42.7C47.4 42.3 47.2 41.8 47.1 41.5C47.0 41.2 46.8 40.8 46.1 40.2C45.1 39.1 45.1 39.1 44.3 39.0C43.9 38.9 43.4 38.8 43.1 38.7C42.5 38.5 42.5 38.5 41.9 38.7C41.6 38.8 41.1 38.9 40.7 39.0C39.9 39.1 40.0 39.1 38.7 40.4C37.5 41.5 37.5 41.5 37.5 42.1C37.5 42.4 37.4 42.8 37.4 43.0C37.2 43.3 37.2 43.7 37.2 44.5C37.2 45.6 37.2 45.7 37.5 46.0C37.6 46.2 37.9 46.5 37.9 46.7C38.0 46.9 38.5 47.4 39.0 47.9C39.7 48.7 39.9 48.8 40.4 49.0C40.7 49.1 41.1 49.2 41.4 49.4C41.8 49.7 41.9 49.7 42.7 49.4ZM17.9 36.0C17.3 35.8 17.0 35.4 17.0 34.9C17.0 34.2 17.0 34.2 17.7 33.6L18.4 33.1L22.9 33.1C27.9 33.1 28.1 33.1 28.6 33.6C29.1 34.2 29.6 35.2 29.5 35.5C29.4 35.8 29.3 35.8 28.2 36.0C27.1 36.3 18.6 36.3 17.9 36.0ZM13.2 35.8C12.9 35.5 12.7 34.7 12.9 34.3C13.1 33.9 14.2 33.4 14.5 33.5C15.2 33.7 15.5 35.2 15.0 35.7C14.6 36.1 13.5 36.1 13.2 35.8ZM13.4 30.5C12.7 30.1 12.6 28.8 13.2 28.2C13.4 28.0 14.4 27.9 14.8 28.1C15.2 28.3 15.5 28.9 15.5 29.3C15.5 29.7 15.4 29.8 14.6 30.2C13.6 30.7 13.7 30.6 13.4 30.5ZM17.3 30.4C17.0 30.0 16.9 28.6 17.1 28.3C17.5 27.8 17.8 27.8 30.1 27.8C43.3 27.8 42.7 27.8 43.2 28.6C43.8 29.4 43.6 29.7 42.4 30.2C41.6 30.5 41.6 30.5 29.6 30.5C18.6 30.5 17.5 30.5 17.3 30.4ZM13.3 23.3C12.8 22.8 12.8 22.8 12.8 19.0C12.8 15.2 12.9 14.4 13.3 14.0C13.5 13.7 42.4 13.7 42.8 14.0C43.4 14.5 43.5 15.0 43.5 18.9C43.5 23.1 43.6 22.8 42.2 23.3C41.5 23.5 41.5 23.5 27.5 23.5C13.5 23.6 13.5 23.6 13.3 23.3ZM40.2 20.6C40.7 20.4 40.8 20.1 40.8 18.4C40.8 16.9 40.8 16.9 40.5 16.6C40.3 16.4 40.2 16.4 39.9 16.4C39.7 16.5 34.3 16.5 27.9 16.5L16.2 16.6L15.9 16.9C15.6 17.2 15.5 17.2 15.5 18.3C15.5 19.9 15.8 20.6 16.5 20.8C16.7 20.8 22.0 20.8 28.4 20.8C38.4 20.8 40.0 20.8 40.2 20.6Z"/></svg>',
  deposit: '<svg viewBox="0 0 47 43" width="17.0" height="15.5" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M35.0 39.5C34.5 39.2 34.5 39.2 33.8 39.2C32.6 39.3 29.4 37.0 29.1 35.7C29.0 35.4 28.8 35.0 28.6 34.7C28.4 34.3 28.2 33.8 28.1 32.8C27.8 31.5 27.8 31.5 28.0 30.5C28.1 29.9 28.2 29.4 28.2 29.1C28.1 28.9 28.1 28.6 28.2 28.5C28.3 28.1 29.1 27.1 29.5 26.8C29.7 26.7 29.9 26.4 30.0 26.2C30.4 25.5 31.7 24.2 32.3 24.1C32.6 24.0 33.0 23.8 33.2 23.7C33.6 23.4 33.7 23.4 34.1 23.5C34.4 23.5 34.7 23.5 34.9 23.4C35.2 23.3 35.7 23.2 36.4 23.2C37.5 23.2 37.5 23.2 38.0 23.5C38.4 23.8 38.6 23.8 39.0 23.8C39.6 23.8 39.9 23.9 40.6 24.5C40.9 24.8 41.2 25.0 41.4 25.1C41.6 25.3 41.8 25.5 42.0 25.7C42.1 26.0 42.5 26.4 42.8 26.8C43.7 27.6 43.7 27.6 44.0 29.3C44.4 31.5 44.2 34.1 43.5 35.1C43.3 35.3 43.0 35.8 42.9 36.0C42.7 36.2 42.1 37.0 41.4 37.7C40.1 38.9 40.1 38.9 39.4 39.0C39.0 39.1 38.4 39.2 38.2 39.3C37.9 39.4 37.4 39.5 37.1 39.5C36.7 39.5 36.3 39.6 36.2 39.6C35.8 39.9 35.4 39.8 35.0 39.5ZM11.7 38.2C11.3 38.1 10.9 38.0 10.8 38.0C10.6 38.0 10.1 37.9 9.6 37.8C8.7 37.7 8.7 37.7 7.9 36.9C7.3 36.4 7.0 36.2 6.6 36.0C6.0 35.8 6.0 35.7 5.4 34.8C5.1 34.3 4.6 33.6 4.4 33.4C3.9 32.8 3.8 32.6 3.8 32.0C3.8 31.5 3.7 31.4 3.5 31.0C3.1 30.5 3.1 29.8 3.1 20.4C3.0 11.9 3.0 11.9 3.3 11.3C3.5 10.7 3.5 10.5 3.5 10.1C3.4 9.8 3.4 9.6 3.7 9.2C3.8 8.9 4.0 8.5 4.1 8.2C4.1 8.0 4.4 7.7 4.5 7.4C4.7 7.2 5.0 6.8 5.2 6.4C5.6 5.8 6.1 5.3 6.5 5.1C6.7 5.1 7.1 4.8 7.5 4.5C7.8 4.2 8.2 4.0 8.2 4.0C8.2 4.0 8.5 3.8 8.8 3.6C9.3 3.2 9.4 3.2 10.0 3.2C10.3 3.2 11.0 3.1 11.6 3.0C12.6 2.8 12.9 2.8 20.3 2.8C30.8 2.9 31.0 2.9 32.2 4.2C32.7 4.6 32.9 4.8 33.3 5.0C33.8 5.1 34.7 5.9 35.0 6.5C35.1 6.6 35.3 6.9 35.5 7.2C35.7 7.4 35.9 7.7 36.0 8.0C36.1 8.2 36.3 8.6 36.5 8.9C36.8 9.3 36.8 9.4 36.8 10.0C36.8 10.3 36.9 11.0 37.0 11.6C37.3 12.9 37.3 19.2 37.0 20.1C36.8 21.0 36.0 21.2 35.5 20.5C35.3 20.2 35.2 20.1 35.2 16.0C35.1 12.6 35.1 11.7 35.0 11.2C34.9 10.9 34.8 10.4 34.8 10.0C34.8 9.5 34.8 9.4 34.5 9.1C34.3 9.0 34.1 8.7 34.0 8.6C33.9 8.4 33.7 8.0 33.4 7.8C33.2 7.5 33.0 7.3 33.0 7.2C33.0 6.9 32.2 6.2 31.5 6.0C31.1 5.9 30.7 5.7 30.4 5.4C29.8 4.9 29.5 4.9 20.3 4.8C12.5 4.8 12.5 4.8 11.2 5.1C10.4 5.2 9.8 5.3 9.8 5.4C9.7 5.4 9.1 5.8 8.4 6.2C7.4 6.9 7.2 7.1 7.1 7.4C6.7 8.3 6.6 8.5 6.0 8.9C5.5 9.4 5.5 9.4 5.5 10.2C5.4 10.6 5.3 11.2 5.2 11.5C5.0 12.1 5.0 12.1 5.0 20.6C5.1 30.3 5.1 30.5 5.5 31.0C5.7 31.3 5.9 31.7 6.0 31.9C6.1 32.2 6.2 32.6 6.4 32.9C6.5 33.1 6.8 33.5 6.9 33.7C7.2 34.3 7.9 34.9 8.3 35.0C8.9 35.1 9.2 35.2 9.6 35.6C10.0 35.9 10.1 35.9 10.9 36.0C11.7 36.0 11.9 36.1 12.2 36.3C12.5 36.5 12.5 36.5 18.4 36.5C21.7 36.5 24.6 36.5 24.8 36.4C25.8 36.3 26.6 37.3 26.0 37.9C25.3 38.5 25.3 38.5 18.5 38.5C12.2 38.5 12.2 38.5 11.7 38.2ZM36.1 37.6C36.3 37.6 36.7 37.5 37.2 37.5C38.1 37.4 38.8 37.2 39.3 36.7C39.5 36.5 39.9 36.2 40.2 36.0C40.6 35.8 40.9 35.5 41.0 35.3C41.1 35.1 41.3 34.7 41.5 34.5C42.1 33.7 42.3 33.1 42.2 31.6C42.2 30.0 42.0 29.2 41.6 28.6C41.4 28.3 41.2 27.9 41.1 27.7C40.9 27.3 40.8 27.2 40.5 27.0C40.2 26.9 39.9 26.6 39.8 26.4C39.6 26.2 39.3 26.1 39.0 26.0C38.8 25.9 38.3 25.7 38.1 25.5C37.5 25.2 37.5 25.2 36.5 25.2C35.8 25.2 35.2 25.3 35.0 25.4C34.8 25.4 34.4 25.5 34.1 25.5C33.4 25.5 33.2 25.6 32.7 26.2C32.6 26.4 32.2 26.8 31.9 26.9C31.3 27.3 31.2 27.4 31.0 28.1C30.9 28.4 30.7 28.8 30.5 29.0C30.1 29.6 30.0 30.0 30.0 31.4C30.0 33.6 30.2 34.3 31.3 35.3C33.3 37.3 33.2 37.2 34.0 37.2C34.6 37.2 34.7 37.2 35.0 37.5C35.4 37.8 35.7 37.9 36.1 37.6ZM35.3 33.3C35.0 33.0 35.0 33.0 35.0 30.7C35.0 29.5 35.0 28.3 35.0 28.1C35.2 27.4 35.8 27.3 36.4 27.8C36.8 28.2 36.8 28.2 36.8 29.6C36.9 31.0 36.9 31.0 37.1 31.3C37.4 31.5 37.4 31.5 38.9 31.5C40.6 31.4 40.7 31.5 40.9 32.1C41.0 32.5 40.8 33.0 40.5 33.2C40.5 33.2 39.7 33.2 38.9 33.2C37.8 33.2 37.3 33.2 36.8 33.3C36.0 33.6 35.7 33.5 35.3 33.3ZM10.0 28.6C9.6 28.2 9.6 27.6 10.0 27.2C10.3 27.0 10.3 27.0 17.6 27.0C24.5 27.0 24.9 27.0 25.2 27.2C25.5 27.4 25.7 27.9 25.7 28.2C25.5 28.8 25.7 28.8 17.7 28.8C10.3 28.8 10.3 28.8 10.0 28.6ZM10.2 21.8C9.6 21.5 9.3 20.6 9.7 20.2C9.9 20.1 10.2 20.1 19.2 20.1C28.4 20.1 28.4 20.1 28.6 20.3C29.0 20.6 29.0 21.4 28.6 21.7C28.4 21.9 28.4 21.9 19.4 22.0C11.6 22.0 10.4 22.0 10.2 21.8ZM9.7 14.9C9.0 14.7 8.9 13.8 9.4 13.3C9.6 13.1 9.6 13.1 20.1 13.0C31.1 13.0 31.4 13.0 31.7 13.3C32.0 13.6 32.0 14.4 31.6 14.7C31.4 14.9 31.4 14.9 20.7 15.0C14.8 15.0 9.8 14.9 9.7 14.9Z"/></svg>',
  withdraw: '<svg viewBox="0 0 56 62" width="20.2" height="22.4" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7.4 59.2C7.4 59.1 6.8 59.0 6.2 58.9C4.7 58.7 4.4 58.6 4.0 57.9C3.9 57.6 3.7 57.2 3.5 57.1C3.3 56.8 3.2 56.7 3.2 55.9C3.1 55.4 3.1 44.8 3.0 32.2C3.0 5.3 2.8 8.0 4.3 6.7C5.3 5.8 6.5 5.3 8.1 5.2C9.8 5.1 10.0 5.2 10.0 6.7C10.0 8.0 10.0 7.9 8.2 8.0C6.4 8.1 6.2 8.1 6.0 9.0C5.7 9.7 5.7 55.4 6.0 55.9C6.3 56.6 5.1 56.6 20.4 56.5C29.6 56.5 34.3 56.5 34.5 56.6C35.0 56.8 35.2 58.5 34.8 59.0C34.5 59.2 34.5 59.2 21.0 59.2C13.5 59.2 7.4 59.2 7.4 59.2ZM46.0 56.8C45.8 56.8 45.2 56.2 45.2 56.0C45.1 55.7 45.3 55.2 45.4 55.2C45.6 55.2 49.0 51.7 49.0 51.6C49.0 51.2 48.9 51.2 43.1 51.2C37.5 51.2 37.5 51.2 37.3 51.0C36.9 50.6 36.9 49.6 37.3 49.3C37.4 49.2 38.6 49.2 42.7 49.2C47.4 49.2 48.0 49.2 48.3 49.1C48.7 48.8 48.6 48.4 48.0 47.9C46.9 46.9 45.0 45.0 44.9 44.7C44.8 44.5 44.8 44.4 44.9 44.2C45.1 44.0 46.0 43.5 46.3 43.5C46.6 43.5 52.7 49.7 52.8 50.1C52.9 50.4 52.8 50.7 52.4 50.9C52.3 51.0 52.0 51.3 51.9 51.5C51.8 51.6 51.6 51.8 51.6 51.8C51.5 51.8 50.4 52.9 49.0 54.3C46.5 56.8 46.4 56.9 46.0 56.8ZM47.6 38.1C47.5 38.1 47.4 37.9 47.3 37.8C47.2 37.7 47.2 33.5 47.2 23.5C47.2 9.4 47.2 9.4 46.9 9.0C46.3 8.1 46.1 8.1 44.6 8.0C42.8 7.9 42.8 7.9 42.8 6.7C42.8 5.8 42.9 5.5 43.2 5.3C43.5 5.1 45.6 5.2 46.0 5.4C46.2 5.4 46.6 5.5 46.9 5.5C47.5 5.5 47.5 5.5 48.5 6.5C50.2 8.1 50.0 6.4 50.0 23.5C50.0 40.0 50.2 38.2 48.7 38.2C48.2 38.2 47.8 38.1 47.6 38.1ZM13.6 34.9C13.2 34.7 13.1 34.4 13.2 33.5C13.4 32.1 11.8 32.3 27.1 32.2C34.9 32.2 40.4 32.2 40.6 32.2C40.9 32.4 41.0 32.8 41.0 33.8C41.0 35.1 42.7 35.0 27.2 35.0C19.7 35.0 13.8 34.9 13.6 34.9ZM14.3 24.1C13.8 23.8 13.7 23.1 13.9 22.2C14.1 21.5 13.5 21.5 23.0 21.5C31.7 21.5 31.7 21.5 32.1 21.7C32.6 22.0 32.9 22.5 32.9 23.0C32.9 23.5 32.6 24.0 32.3 24.1C31.9 24.3 14.6 24.2 14.3 24.1ZM16.6 12.5C16.5 12.5 16.3 12.4 16.2 12.3C16.1 12.2 15.8 12.1 15.6 12.0C15.2 11.9 14.3 11.1 14.1 10.7C14.0 10.6 14.0 9.3 14.0 7.9C14.0 5.2 14.0 5.2 14.2 4.9C14.4 4.7 14.7 4.3 14.9 3.9C15.3 3.4 15.5 3.2 15.7 3.1C15.9 3.0 19.0 3.0 26.4 3.0C36.8 3.0 36.8 3.0 37.1 3.2C37.3 3.4 37.7 3.7 38.1 3.9C39.1 4.6 39.1 4.7 39.1 7.5C39.1 10.3 39.1 10.8 38.5 11.5C37.9 12.1 37.6 12.2 36.9 12.2C36.5 12.2 36.1 12.3 35.9 12.3C35.6 12.5 34.1 12.5 26.1 12.5C20.9 12.5 16.6 12.5 16.6 12.5ZM35.8 9.8C36.5 9.8 36.6 9.7 36.5 8.0C36.5 6.7 36.5 6.5 36.3 6.3C35.9 5.8 36.1 5.8 26.4 5.8C15.7 5.8 16.8 5.6 16.8 7.8C16.8 9.3 16.9 9.6 17.3 9.8C17.5 9.8 21.5 9.8 35.8 9.8Z"/></svg>',
  about: '<svg viewBox="0 0 58 55" width="20.9" height="19.9" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M13.4 51.8C13.2 51.7 12.9 51.7 12.8 51.6C12.7 51.5 12.3 51.5 12.0 51.5C11.6 51.5 11.1 51.4 10.8 51.3C10.5 51.2 10.0 51.1 9.7 51.0C9.3 50.9 8.9 50.8 8.7 50.7C8.4 50.4 8.0 50.3 7.5 50.2C7.3 50.1 6.9 49.9 6.6 49.6C6.2 49.3 5.8 49.1 5.7 49.0C4.8 48.9 4.4 48.5 4.0 47.9C3.9 47.7 3.7 47.3 3.5 47.1C3.2 46.6 3.1 46.3 2.9 45.1C2.8 44.6 2.8 44.3 2.9 44.1C3.0 43.9 3.0 43.4 3.0 43.0C3.0 42.2 3.1 42.0 3.7 41.2C3.8 41.1 4.2 40.5 4.5 40.0C5.0 39.2 5.2 39.1 5.9 38.5C6.4 38.2 7.0 37.8 7.1 37.6C7.3 37.4 7.6 37.1 7.8 37.0C8.0 36.9 8.4 36.6 8.6 36.4C8.8 36.2 9.1 36.0 9.1 36.0C9.2 36.0 9.5 35.8 9.8 35.5C10.3 35.1 10.4 35.0 10.7 35.2C11.0 35.4 10.9 35.9 10.5 36.5C10.3 36.8 10.0 37.3 9.9 37.6C9.8 37.9 9.6 38.3 9.4 38.6C9.2 38.9 9.1 39.2 9.0 39.6C8.9 40.2 8.8 40.5 8.6 41.4C8.4 42.0 8.4 42.2 8.8 43.5C9.2 44.8 10.0 45.9 10.5 46.0C10.7 46.1 11.0 46.2 11.2 46.3C11.4 46.4 11.6 46.5 12.0 46.5C12.4 46.5 12.6 46.6 13.0 46.8C13.4 47.0 13.4 47.0 15.8 47.0C19.1 46.9 19.9 46.8 20.6 46.5C21.0 46.3 21.2 46.2 21.8 46.2C22.3 46.2 22.7 46.1 23.0 46.0C23.3 45.9 23.6 45.8 24.0 45.8C24.5 45.8 24.7 45.8 24.9 45.6C25.5 45.1 25.6 45.1 26.4 45.0C27.3 44.9 27.5 44.8 28.2 44.4C28.5 44.1 28.7 44.1 29.4 44.0C30.3 43.9 30.5 43.8 31.1 43.4C31.3 43.3 31.6 43.1 32.0 43.0C32.3 42.9 32.8 42.7 33.1 42.5C33.5 42.2 33.9 42.1 34.3 42.0C34.6 42.0 35.0 41.8 35.1 41.8C35.8 41.3 36.3 41.0 36.5 41.0C36.8 41.0 37.0 40.9 37.6 40.4C37.8 40.3 38.2 40.1 38.4 40.0C38.9 40.0 39.0 39.9 39.7 39.4C40.4 38.8 41.8 38.0 42.1 37.9C42.3 37.9 42.6 37.7 42.9 37.4C43.2 37.2 43.4 37.0 43.5 37.0C43.5 37.0 43.8 36.8 44.1 36.5C44.5 36.2 44.9 36.0 45.2 35.9C45.5 35.8 45.8 35.6 45.9 35.5C46.0 35.4 46.2 35.2 46.3 35.1C46.5 35.0 46.9 34.7 47.2 34.5C48.0 33.6 49.6 32.8 49.6 33.3C49.6 33.5 48.2 34.9 47.7 35.1C47.4 35.2 47.2 35.3 47.2 35.4C47.2 35.6 45.8 36.9 45.4 37.1C45.2 37.2 44.9 37.4 44.7 37.6C44.6 37.8 44.3 38.0 44.0 38.2C43.8 38.3 43.3 38.7 42.9 39.1C42.6 39.4 41.9 40.0 41.3 40.3C40.7 40.7 40.1 41.1 40.0 41.3C39.8 41.5 39.5 41.8 39.3 41.9C39.1 42.0 38.7 42.3 38.5 42.5C38.3 42.7 37.9 43.0 37.7 43.1C37.5 43.2 37.2 43.4 36.9 43.6C36.7 43.7 36.4 43.9 36.4 43.9C36.3 43.9 36.0 44.1 35.7 44.4C35.4 44.6 34.9 44.9 34.6 45.0C34.3 45.1 34.0 45.2 33.8 45.5C33.6 45.8 33.4 45.9 32.9 46.0C32.6 46.1 32.2 46.4 32.0 46.5C31.8 46.7 31.3 46.9 31.0 47.0C30.6 47.1 30.2 47.4 30.0 47.5C29.8 47.7 29.3 47.9 29.0 48.0C28.6 48.1 28.2 48.4 28.0 48.5C27.8 48.7 27.3 48.9 27.0 49.0C26.6 49.1 26.2 49.3 26.0 49.5C25.6 49.8 25.0 50.0 24.4 50.0C23.9 50.0 23.4 50.2 23.0 50.5C22.7 50.8 22.6 50.8 22.1 50.8C21.7 50.8 21.3 50.9 21.0 51.0C20.7 51.1 20.3 51.2 19.8 51.2C19.3 51.2 19.0 51.3 18.5 51.5C17.8 51.8 17.8 51.8 15.8 51.8C14.7 51.8 13.6 51.8 13.4 51.8ZM16.1 44.1C16.0 44.1 15.5 44.0 15.1 44.0C14.2 44.0 14.0 43.9 13.7 43.2C13.5 42.6 13.5 42.4 13.5 33.1C13.5 27.8 13.5 23.5 13.5 23.4C13.6 23.3 13.8 23.2 14.1 23.0C15.0 22.5 15.9 21.9 16.1 21.6C16.2 21.4 16.6 21.1 17.0 20.8C18.4 19.9 18.6 19.7 19.0 19.4C19.2 19.2 19.4 19.0 19.5 19.0C19.5 19.0 19.8 18.8 20.1 18.6C20.4 18.3 21.0 17.9 21.5 17.5C22.0 17.1 22.6 16.6 22.9 16.4C23.4 15.9 24.0 15.4 24.7 15.1C24.9 15.0 25.4 14.6 25.8 14.2C26.3 13.8 27.0 13.2 27.5 12.8C28.0 12.5 28.6 12.0 28.9 11.8C29.1 11.5 29.6 11.2 29.8 11.1C30.1 10.9 30.4 10.7 30.5 10.5C31.1 9.7 31.7 9.7 32.4 10.4C32.8 10.8 33.0 10.9 33.3 11.0C33.6 11.1 33.9 11.2 34.1 11.5C34.3 11.7 34.7 12.0 34.9 12.1C35.1 12.2 35.6 12.6 36.1 13.1C36.6 13.5 37.1 14.0 37.3 14.1C37.6 14.2 37.9 14.4 38.1 14.6C38.3 14.7 38.7 15.0 39.0 15.1C39.2 15.3 39.5 15.5 39.7 15.7C39.9 16.0 41.0 16.9 41.4 17.2C41.5 17.2 41.8 17.4 41.9 17.6C42.1 17.9 42.3 18.0 42.7 18.1C43.1 18.2 43.3 18.3 44.1 19.1C44.6 19.6 45.0 20.0 45.1 20.0C45.2 20.0 45.4 20.2 45.7 20.5C46.1 20.8 46.4 21.0 46.7 21.1C47.1 21.2 47.3 21.4 48.4 22.4C49.1 23.1 49.7 23.8 49.7 23.9C49.8 24.0 49.8 25.6 49.8 27.3L49.8 30.5L49.2 31.1C48.7 31.6 48.3 31.9 48.0 32.0C47.7 32.1 47.3 32.3 47.1 32.5C47.0 32.7 46.7 32.9 46.5 33.0C46.3 33.1 46.0 33.3 45.8 33.5C45.6 33.8 45.3 33.9 44.9 34.0C44.5 34.2 44.3 34.3 44.1 34.6C43.7 35.1 42.6 35.8 41.9 36.0C41.7 36.1 41.2 36.3 41.0 36.5C40.7 36.7 40.2 36.9 39.9 37.0C39.6 37.2 39.1 37.4 38.9 37.6C38.8 37.7 38.3 37.9 38.0 38.0C37.7 38.1 37.2 38.4 37.0 38.5C36.7 38.7 36.2 39.0 35.9 39.0C35.6 39.1 35.2 39.3 35.0 39.5C34.5 39.9 34.3 40.0 33.4 40.2C33.0 40.3 32.5 40.5 32.3 40.7C32.0 40.8 31.6 41.0 31.2 41.1C30.6 41.1 30.3 41.3 30.0 41.5C29.5 41.9 29.5 41.9 28.6 42.0C27.7 42.1 27.5 42.2 26.8 42.7C26.5 42.9 26.4 42.9 26.0 42.9C25.4 42.8 23.4 43.2 22.7 43.5C22.2 43.7 21.8 43.7 21.1 43.8C20.5 43.8 19.7 44.0 19.2 44.0C18.4 44.2 16.5 44.2 16.1 44.1ZM30.8 28.6C31.0 28.3 31.1 21.8 30.8 21.4C30.6 21.0 29.0 21.1 28.5 21.5C28.0 22.0 28.0 23.2 28.5 24.4C28.7 25.0 28.7 25.0 28.5 25.5C28.0 26.7 28.0 28.0 28.5 28.5C29.0 28.9 30.5 29.0 30.8 28.6ZM33.7 28.8C34.2 28.5 34.2 28.3 34.1 26.9C34.1 26.2 34.1 25.4 34.1 25.0C34.1 24.6 34.1 23.8 34.1 23.1C34.2 21.7 34.2 21.5 33.7 21.2C33.1 21.0 32.5 21.1 32.2 21.4C32.0 21.6 32.0 21.6 32.0 23.2C32.1 25.2 32.1 24.8 32.0 26.7C32.0 28.4 32.0 28.6 32.4 28.8C32.8 28.9 33.3 28.9 33.7 28.8ZM6.3 25.9C6.1 25.6 6.1 22.3 6.4 21.7C6.6 21.3 7.8 20.2 8.3 19.9C8.9 19.7 9.9 18.9 10.1 18.6C10.3 18.4 10.6 18.1 10.7 18.0C10.9 17.9 11.2 17.7 11.4 17.5C11.6 17.4 12.0 17.1 12.2 17.0C12.4 16.9 12.7 16.6 12.9 16.4C13.1 16.1 13.8 15.6 14.6 15.1C14.9 15.0 15.5 14.5 15.9 14.0C16.4 13.6 17.0 13.1 17.2 13.0C17.9 12.7 18.9 11.9 19.1 11.6C19.3 11.4 19.6 11.1 19.7 11.0C19.9 10.9 20.3 10.7 20.5 10.5C20.7 10.3 21.1 10.0 21.3 10.0C21.5 9.9 21.7 9.7 21.8 9.5C21.9 9.4 22.2 9.1 22.5 9.0C22.7 8.9 23.1 8.7 23.2 8.5C23.3 8.3 23.6 8.1 23.8 8.0C24.0 7.9 24.6 7.4 25.0 7.0C25.5 6.5 26.0 6.1 26.2 6.0C26.9 5.7 27.9 4.9 28.1 4.6C28.3 4.4 28.6 4.1 28.7 4.0C28.9 4.0 29.2 3.8 29.4 3.6C30.0 3.0 30.4 2.8 31.0 2.8C31.7 2.8 32.0 3.0 33.2 4.2C33.7 4.6 34.1 5.0 34.2 5.0C34.3 5.0 34.5 5.2 34.8 5.5C35.1 5.8 35.4 6.0 35.7 6.1C36.0 6.1 36.3 6.3 36.5 6.5C38.4 8.4 39.0 8.9 39.4 9.0C39.7 9.1 39.9 9.2 40.1 9.5C40.3 9.7 40.6 9.9 40.8 10.0C41.0 10.1 41.6 10.6 42.1 11.1C42.6 11.5 43.0 11.9 43.1 11.9C43.1 11.9 43.5 12.1 43.8 12.4C44.1 12.8 44.5 13.0 44.6 13.0C44.9 13.0 45.4 13.4 46.6 14.6C47.5 15.5 47.9 15.8 48.2 15.9C48.4 16.0 48.8 16.2 49.0 16.4C49.3 16.6 49.7 16.9 50.0 17.1C50.2 17.3 50.8 17.8 51.3 18.2C51.7 18.6 52.1 19.0 52.2 19.0C52.3 19.0 52.5 19.2 52.8 19.5C53.1 19.8 53.4 20.0 53.5 20.0C54.1 20.0 55.0 20.9 55.3 21.9C55.6 22.6 55.6 25.6 55.3 25.8C55.1 26.0 54.4 25.9 54.1 25.6C54.0 25.5 53.6 25.3 53.3 25.1C53.0 24.9 52.2 24.2 51.4 23.4C50.3 22.3 50.0 22.1 49.7 22.0C49.4 21.9 49.1 21.7 48.9 21.5C48.6 21.3 48.3 21.0 48.1 21.0C47.9 20.9 47.7 20.7 47.5 20.4C47.1 20.0 46.0 19.0 45.5 18.7C45.3 18.6 45.1 18.5 45.0 18.4C44.8 18.3 44.5 18.1 44.2 18.0C43.7 17.8 43.6 17.7 43.5 17.5C43.4 17.3 43.2 17.0 43.0 16.8C42.7 16.7 42.2 16.2 41.8 15.8C41.3 15.3 41.0 15.1 40.6 15.0C40.4 14.9 40.1 14.8 39.9 14.5C39.7 14.3 39.3 14.0 39.1 13.9C38.9 13.8 38.4 13.4 37.9 12.9C37.5 12.5 36.9 12.0 36.7 11.9C36.4 11.8 36.1 11.6 35.9 11.4C35.7 11.2 35.3 11.0 35.0 10.9C34.8 10.7 34.4 10.5 34.3 10.3C34.2 10.1 34.0 9.9 34.0 9.9C34.0 9.9 33.6 9.5 33.1 9.1C32.0 8.0 31.6 7.9 31.1 8.6C30.9 8.8 30.7 9.0 30.5 9.1C30.3 9.2 30.2 9.3 30.1 9.4C30.0 9.4 29.8 9.6 29.5 9.8C29.2 9.9 28.8 10.2 28.6 10.4C28.4 10.6 28.1 10.8 27.9 10.9C27.7 11.0 27.4 11.2 27.3 11.4C27.2 11.6 26.8 11.8 26.6 11.9C26.3 12.1 26.0 12.3 25.9 12.4C25.8 12.6 25.6 12.8 25.4 12.9C25.2 13.0 24.9 13.2 24.7 13.3C24.3 13.6 23.3 14.3 22.4 14.8C22.2 15.0 21.5 15.5 21.1 15.9C20.6 16.4 19.8 17.0 19.1 17.4C18.5 17.8 17.8 18.3 17.5 18.5C17.3 18.7 16.9 18.9 16.8 19.0C16.7 19.1 16.4 19.3 16.1 19.6C15.8 19.8 15.5 20.0 15.5 20.0C15.4 20.0 15.2 20.2 14.9 20.4C14.7 20.7 14.2 21.0 13.9 21.2C13.7 21.4 13.1 21.8 12.7 22.1C12.2 22.4 11.6 22.7 11.4 22.9C11.1 23.0 10.5 23.5 10.1 24.0C9.6 24.4 9.0 24.9 8.8 25.0C8.5 25.1 8.2 25.4 8.0 25.5C7.7 25.8 6.9 26.1 6.7 26.1C6.6 26.1 6.4 26.0 6.3 25.9ZM50.0 15.2C49.7 15.0 49.4 14.7 49.2 14.5C49.0 14.3 48.7 14.1 48.4 14.0C48.2 13.9 47.9 13.7 47.9 13.6C47.8 13.4 47.4 13.2 47.1 12.9C46.8 12.7 46.3 12.3 45.9 12.0C45.6 11.6 45.1 11.2 44.9 11.1C44.4 10.8 43.8 10.1 43.5 9.4C43.3 9.0 43.3 9.0 43.4 8.7C43.7 8.0 43.9 8.0 47.5 8.0C50.6 8.0 50.7 8.0 50.9 8.2C51.2 8.4 51.2 8.4 51.2 11.8C51.2 13.9 51.2 15.2 51.1 15.3C50.9 15.6 50.5 15.5 50.0 15.2Z"/></svg>',
  download: '<svg viewBox="0 0 58 56" width="20.9" height="20.2" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M28.3 53.2C27.5 52.7 20.1 45.4 19.9 44.8C19.7 44.5 19.7 44.4 19.9 43.6C20.2 42.4 20.3 42.3 21.5 42.3L22.5 42.4L24.0 43.9C24.9 44.8 25.7 45.7 26.0 45.9C26.4 46.5 26.8 46.6 27.0 46.2C27.1 46.1 27.1 42.3 27.1 34.7L27.1 23.4L27.4 22.9C28.0 22.2 28.2 22.0 28.9 21.9C29.6 21.7 29.8 21.8 30.4 22.3C31.1 23.0 31.0 21.8 31.1 34.5C31.1 40.7 31.1 45.9 31.1 46.1C31.3 46.5 31.6 46.5 32.0 45.9C32.7 45.1 35.1 42.7 35.5 42.4C36.1 42.0 36.5 42.0 37.1 42.4C37.3 42.6 37.6 42.8 37.9 42.9C38.7 43.3 38.8 43.6 38.4 44.3C38.2 44.6 38.1 44.9 38.1 45.1C38.0 45.4 31.1 52.4 30.1 53.2C29.4 53.7 29.2 53.7 28.3 53.2ZM13.1 40.1C12.8 40.0 12.4 39.9 12.0 39.9C11.4 39.9 11.3 39.9 11.0 39.6C10.8 39.4 10.3 39.2 10.0 39.1C9.6 38.9 9.3 38.8 9.1 38.5C9.0 38.4 8.7 38.2 8.5 38.1C8.3 38.0 8.0 37.8 7.8 37.6C7.7 37.4 7.3 37.1 7.0 36.9C6.6 36.7 6.3 36.4 6.1 36.1C5.9 35.8 5.6 35.4 5.4 35.1C5.2 34.9 5.0 34.6 4.9 34.4C4.8 34.2 4.7 33.9 4.6 33.7C4.3 33.4 4.0 32.9 4.0 32.5C3.9 32.4 3.8 32.1 3.6 31.9C3.5 31.6 3.4 31.4 3.4 31.0C3.4 30.6 3.3 30.4 3.2 30.1C3.0 29.8 3.0 29.6 3.0 28.1C3.0 25.1 3.1 24.4 3.5 23.9C3.7 23.6 3.8 23.3 3.9 23.0C4.0 22.3 4.0 22.2 4.4 21.8C4.7 21.6 4.9 21.3 5.0 21.0C5.2 20.0 6.7 18.3 7.6 17.9C7.8 17.8 8.0 17.6 8.1 17.5C8.2 17.3 8.4 17.1 8.6 17.1C8.7 17.0 9.1 16.7 9.3 16.5C9.6 16.3 10.0 16.1 10.3 16.0C10.6 15.9 10.9 15.8 11.1 15.6C11.4 15.5 11.6 15.4 12.0 15.4C12.8 15.4 13.7 14.8 14.0 13.9C14.1 13.6 14.3 13.1 14.5 12.9C14.7 12.6 14.9 12.2 15.0 11.9C15.0 11.7 15.3 11.2 15.5 10.9C15.6 10.7 15.9 10.2 15.9 10.0C16.0 9.6 16.3 9.3 17.4 8.2C18.1 7.5 18.8 6.8 19.0 6.5C19.2 6.2 19.4 6.0 19.6 5.9C19.8 5.9 20.2 5.6 20.4 5.5C20.7 5.2 21.0 5.1 21.4 5.0C21.7 4.9 22.1 4.7 22.4 4.5C22.6 4.3 23.0 4.1 23.3 4.0C23.5 3.9 24.0 3.8 24.2 3.6C24.7 3.3 24.7 3.3 25.6 3.4C26.3 3.4 26.6 3.4 27.2 3.2C28.5 2.8 31.6 2.9 32.6 3.4C33.0 3.7 33.3 3.7 33.9 3.7C34.8 3.8 35.5 4.0 36.0 4.4C36.2 4.6 36.5 4.8 36.8 4.9C37.0 5.0 37.4 5.3 37.6 5.5C37.9 5.7 38.2 5.9 38.6 6.0C39.3 6.2 39.5 6.3 39.9 6.9C40.1 7.2 40.6 7.8 41.1 8.3C41.7 8.9 42.0 9.3 42.1 9.6C42.1 9.8 42.4 10.2 42.5 10.4C42.7 10.7 43.0 11.1 43.0 11.4C43.1 11.8 43.4 12.2 43.5 12.4C43.7 12.7 43.9 13.0 44.0 13.4C44.2 14.1 44.7 14.7 45.4 15.1C45.6 15.1 45.9 15.4 46.2 15.5C46.5 15.8 46.8 15.8 47.6 15.9C48.5 16.1 48.5 16.1 48.8 16.4C49.0 16.6 49.3 16.9 49.5 16.9C49.7 17.0 50.0 17.2 50.1 17.4C50.2 17.5 50.6 17.8 50.9 18.0C52.1 18.7 52.8 19.7 53.1 20.6C53.2 21.1 53.4 21.3 54.1 21.9C54.6 22.4 54.7 22.7 54.6 23.1C54.6 23.4 54.6 23.7 54.8 24.2C55.5 26.7 55.4 30.8 54.5 32.1C54.4 32.3 54.1 32.8 54.0 33.1C53.9 33.4 53.7 33.8 53.6 34.0C53.4 34.2 53.2 34.5 53.1 34.8C52.9 35.2 50.7 37.5 50.1 37.9C49.9 38.1 49.5 38.3 49.2 38.3C48.6 38.5 48.4 38.6 47.9 39.3C47.6 39.6 47.5 39.6 47.0 39.6C46.7 39.6 46.4 39.7 46.2 39.8C45.5 40.2 44.5 40.3 39.4 40.3C36.3 40.3 34.5 40.3 34.4 40.2C33.5 39.9 32.8 38.9 32.9 38.1C33.0 37.5 33.0 37.4 33.9 36.8L34.5 36.4L39.0 36.4C43.2 36.4 43.5 36.4 44.2 36.2C44.6 36.1 45.2 36.0 45.4 35.9C45.8 35.9 46.0 35.8 46.4 35.5C46.6 35.3 47.1 35.0 47.3 34.8C48.6 34.2 49.2 33.6 49.8 32.4C49.9 32.1 50.2 31.7 50.4 31.5C50.9 30.9 51.0 30.5 51.1 29.4C51.1 28.9 51.2 28.1 51.3 27.7C51.5 27.1 51.5 27.0 51.4 26.4C51.3 26.1 51.1 25.5 51.0 25.0C51.0 24.5 50.8 24.0 50.7 23.9C50.6 23.8 50.3 23.4 50.1 23.1C49.9 22.8 49.6 22.2 49.3 21.9C48.9 21.3 48.7 21.1 48.1 20.7C47.7 20.4 47.1 20.0 46.9 19.8C46.1 19.4 44.7 18.9 43.9 18.9C43.4 18.9 43.3 18.9 43.0 18.6C42.8 18.5 42.5 18.2 42.3 18.1C41.5 17.7 41.1 17.3 41.0 16.5C40.9 16.4 40.8 16.1 40.7 15.9C40.5 15.7 40.4 15.5 40.4 15.0C40.3 13.9 39.8 13.0 38.9 12.0C38.5 11.6 38.0 11.0 37.9 10.8C37.5 10.0 36.7 9.3 36.0 9.1C35.6 8.9 35.3 8.8 35.1 8.6C35.0 8.4 34.7 8.2 34.6 8.1C34.4 8.0 33.9 7.8 33.5 7.6C32.5 7.1 31.4 7.0 29.6 7.0C26.2 7.0 25.1 7.1 24.0 7.9C23.8 8.1 23.4 8.3 23.1 8.4C22.6 8.5 22.5 8.6 20.9 10.3C19.9 11.2 19.0 12.2 18.9 12.5C18.8 12.7 18.5 13.1 18.4 13.3C18.3 13.5 18.2 13.8 18.1 14.5C17.9 15.5 17.8 16.0 17.5 16.2C17.4 16.3 17.2 16.6 17.1 17.0C16.8 17.9 15.9 18.6 15.0 18.6C14.7 18.6 14.4 18.7 14.2 18.8C14.0 18.9 13.5 19.1 13.0 19.1C11.8 19.4 11.5 19.6 10.9 20.1C10.7 20.4 10.2 20.8 10.0 21.0C9.2 21.5 8.2 22.5 8.0 23.1C8.0 23.3 7.7 23.8 7.5 24.1C6.8 25.2 6.7 28.6 7.4 30.9C7.5 31.3 7.6 31.6 8.1 32.0C8.6 32.4 8.8 32.7 8.9 33.2C9.1 33.6 9.2 33.8 9.5 33.9C9.7 34.0 10.0 34.3 10.2 34.5C10.5 34.7 10.8 34.9 11.1 35.0C11.5 35.1 11.7 35.2 11.8 35.4C12.2 35.9 12.5 36.0 13.8 36.1C14.4 36.1 15.1 36.2 15.2 36.3C15.4 36.4 16.6 36.4 19.1 36.4C22.6 36.4 22.7 36.4 23.2 36.6C23.6 36.8 24.0 36.9 24.1 36.9C25.1 36.9 25.6 38.4 25.0 39.7C24.7 40.2 24.0 40.3 18.4 40.3C14.0 40.3 13.5 40.2 13.1 40.1Z"/></svg>',
  language: '<svg viewBox="0 0 62 50" width="22.4" height="18.1" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7.0 47.1C6.8 47.1 6.5 47.0 6.3 47.0C6.0 46.9 5.7 46.7 5.5 46.6C5.3 46.4 5.0 46.1 4.7 46.0C4.5 45.8 4.1 45.5 4.0 45.2C3.8 44.9 3.5 44.5 3.3 44.3C3.0 44.0 3.0 44.0 3.0 25.5C3.0 6.2 3.0 6.6 3.4 6.0C3.6 5.9 3.8 5.5 3.9 5.2C4.1 5.0 4.5 4.4 4.8 4.1C5.5 3.4 5.5 3.4 5.9 3.5C6.3 3.5 6.5 3.5 6.9 3.3C7.3 3.0 7.3 3.0 31.1 3.0C57.9 3.0 55.7 2.9 56.9 3.8C57.4 4.1 57.8 4.5 58.0 4.8C58.2 5.1 58.5 5.4 58.6 5.6C59.2 6.4 59.2 5.7 59.2 25.5C59.2 46.0 59.3 44.0 58.4 45.2C58.0 45.8 57.9 45.9 57.4 46.0C57.1 46.1 56.7 46.4 56.5 46.5C56.3 46.7 56.1 46.9 56.1 46.9C56.0 46.9 55.7 47.0 55.2 47.0C54.4 47.2 7.7 47.3 7.0 47.1ZM54.0 44.6C54.2 44.6 54.6 44.5 54.9 44.5C55.7 44.5 55.9 44.3 56.2 43.2C56.5 42.4 56.5 42.4 56.5 25.0C56.5 8.5 56.5 7.5 56.3 7.2C56.2 7.1 56.1 6.7 56.0 6.5C55.7 5.9 55.6 5.8 54.8 5.8C54.4 5.8 54.0 5.8 53.8 5.7C53.5 5.5 51.8 5.5 30.8 5.5C18.3 5.5 7.9 5.5 7.8 5.5C7.7 5.5 7.3 5.7 6.9 5.9C5.8 6.7 5.9 4.5 5.9 25.1C5.9 37.0 5.9 43.2 6.0 43.4C6.1 43.8 7.1 44.8 7.5 44.8C7.7 44.8 18.1 44.8 30.7 44.8C50.8 44.8 53.8 44.8 54.0 44.6ZM27.9 35.7C27.4 35.5 27.2 35.5 26.4 35.5C25.6 35.6 25.6 35.6 25.1 35.3C24.9 35.1 24.5 34.9 24.4 34.8C23.7 34.7 23.5 34.5 22.8 33.9C22.4 33.5 22.0 32.9 21.9 32.6C21.7 32.4 21.5 32.0 21.4 31.8C21.2 31.6 21.1 31.3 21.0 31.0C21.0 30.8 20.9 30.3 20.9 30.0C20.8 29.7 20.8 29.4 20.9 28.9C20.9 28.6 21.1 28.0 21.1 27.6C21.2 27.1 21.4 26.6 21.6 26.3C21.8 26.1 21.9 25.7 22.0 25.6C22.0 25.3 23.3 24.0 23.9 23.5C24.1 23.4 24.5 23.2 25.0 23.0C25.4 22.8 25.8 22.6 26.0 22.5C26.6 22.0 27.3 21.8 28.6 21.8C29.6 21.8 29.8 21.8 30.4 21.5C31.1 21.2 31.1 21.2 33.9 21.2C36.6 21.2 36.6 21.2 36.8 20.9C37.0 20.7 37.0 20.6 37.0 20.3C36.9 20.0 36.9 19.5 36.8 19.1C36.8 18.5 36.7 18.3 36.5 18.0C36.4 17.8 36.2 17.5 36.1 17.3C35.6 16.5 35.1 16.1 34.1 16.0C33.8 15.9 33.3 15.8 33.0 15.7C32.3 15.5 31.7 15.4 31.2 15.7C31.0 15.7 30.5 15.8 30.0 15.8C28.7 15.9 27.3 16.7 26.9 17.7C26.5 18.9 26.2 19.0 24.1 19.0C22.0 18.9 21.7 18.7 22.0 17.4C22.1 17.1 22.2 16.8 22.5 16.5C22.6 16.3 22.9 15.9 22.9 15.7C23.0 15.4 23.3 15.0 23.8 14.5C24.8 13.5 25.1 13.3 26.0 13.0C26.4 12.8 26.8 12.6 26.9 12.5C27.3 12.1 27.7 12.1 28.9 12.0C32.2 11.7 35.8 12.0 36.5 12.5C36.9 12.8 37.3 13.0 37.7 13.0C38.2 13.1 39.6 14.5 40.1 15.3C40.3 15.6 40.5 16.0 40.7 16.2C40.8 16.4 40.9 16.7 41.0 17.0C41.0 17.2 41.1 17.7 41.1 17.9C41.2 18.2 41.2 18.7 41.2 19.1C41.2 19.5 41.3 19.8 41.4 20.0C41.5 20.3 41.5 21.2 41.5 27.5C41.5 36.2 41.8 35.2 39.3 35.2C38.4 35.2 37.6 35.2 37.5 35.1C37.2 34.9 37.1 34.4 37.2 33.7C37.2 33.1 37.2 33.0 37.1 32.8C36.8 32.3 36.4 32.4 35.7 33.3C35.4 33.6 35.0 33.9 34.8 34.1C34.5 34.2 34.1 34.4 34.0 34.6C33.5 34.9 32.7 35.2 32.0 35.2C31.4 35.2 31.3 35.2 31.1 35.4C30.7 35.9 29.1 36.1 27.9 35.7ZM31.0 32.0C32.2 31.9 32.6 31.9 33.0 31.5C33.1 31.4 33.4 31.2 33.6 31.1C33.9 31.0 34.6 30.3 35.3 29.7C36.5 28.5 36.5 28.5 36.5 27.9C36.5 27.4 36.6 27.0 36.8 26.6C37.1 25.8 37.1 25.4 36.8 25.1C36.5 24.8 36.5 24.8 34.0 24.9C29.7 24.9 28.3 25.1 28.0 25.5C28.0 25.6 27.7 25.7 27.4 25.9C26.3 26.5 25.9 27.3 25.9 28.9C25.9 29.9 26.2 30.8 26.8 31.1C26.9 31.2 27.3 31.4 27.6 31.6C28.3 31.9 29.2 32.2 29.6 32.1C29.7 32.1 30.3 32.1 31.0 32.0Z"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M2.5 6.5h19V9h-19zM12 6.5V20M12 6.5C10 3 7 3.5 7.5 5.5c.3 1 2.5 1 4.5 1Zm0 0c2-3.5 5-3 4.5-1-.3 1-2.5 1-4.5 1Z"/></svg>',
  task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5A3.5 3.5 0 0 1 16.5 11M12 14v4M8.5 20.5h7M9.5 18h5"/></svg>',
  power: '<svg viewBox="0 0 58 58" width="20.9" height="20.9" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M28.3 55.4C27.9 55.3 26.9 55.1 24.6 55.0C23.3 55.0 23.1 54.9 22.8 54.7C22.3 54.4 22.1 54.3 21.1 54.1C20.6 54.0 20.1 53.8 19.9 53.7C19.6 53.6 19.4 53.5 19.0 53.5C18.4 53.5 18.4 53.5 17.8 52.9C17.2 52.2 17.0 52.1 16.2 51.9C16.0 51.8 15.6 51.6 15.4 51.4C15.2 51.3 14.9 51.1 14.7 51.0C13.9 50.9 13.7 50.7 12.4 49.5C11.7 48.7 10.9 48.1 10.7 48.0C10.5 47.8 10.3 47.6 10.2 47.4C10.0 47.2 9.6 46.7 9.1 46.2C8.7 45.7 8.2 45.1 8.1 44.9C7.9 44.7 7.6 44.3 7.5 44.1C7.3 44.0 7.0 43.6 6.9 43.3C6.8 43.1 6.7 42.7 6.5 42.6C6.4 42.5 6.2 42.1 6.1 41.9C5.9 41.7 5.6 41.2 5.4 41.0C5.3 40.7 5.1 40.3 5.0 40.0C4.9 39.7 4.8 39.5 4.4 38.8C4.2 38.6 4.2 38.4 4.2 38.0C4.2 37.7 4.1 37.3 4.0 37.0C3.9 36.7 3.8 36.3 3.8 35.9C3.8 35.4 3.8 35.3 3.5 35.0C3.1 34.5 3.1 34.4 3.0 32.5C2.8 28.8 2.9 25.1 3.3 24.2C3.5 23.7 3.5 23.5 3.5 23.2C3.4 22.7 3.4 22.6 4.3 21.0C4.4 20.7 4.5 20.3 4.5 20.0C4.5 19.6 4.6 19.4 4.7 19.1C4.9 18.8 5.0 18.5 5.0 18.3C5.1 18.1 5.3 17.8 5.5 17.5C5.7 17.3 5.9 16.8 6.0 16.4C6.2 15.8 6.3 15.6 7.0 14.9C7.5 14.4 7.9 13.9 8.0 13.8C8.1 13.7 8.3 13.2 8.6 12.8C8.8 12.5 9.2 12.0 9.3 11.8C9.4 11.6 9.7 11.3 10.0 11.1C10.2 11.0 10.8 10.5 11.3 10.0C11.7 9.6 12.3 9.1 12.5 9.0C12.6 9.0 13.2 8.5 13.7 8.0L14.6 7.0L15.7 7.0C16.8 7.0 16.9 7.1 17.3 7.4C17.6 7.5 18.0 7.7 18.2 7.7C18.6 7.8 18.9 8.0 19.3 8.6C20.0 9.7 20.0 9.9 19.7 10.9C19.5 11.4 19.5 11.6 19.5 12.0C19.6 12.4 19.6 12.4 18.0 14.0C17.1 15.0 16.2 15.7 15.9 15.9C15.5 16.2 15.3 16.4 15.0 16.9C14.7 17.3 14.2 17.8 13.9 18.2C13.3 18.8 13.2 18.9 13.0 19.5C12.9 19.9 12.6 20.3 12.5 20.6C12.3 20.8 12.1 21.2 12.0 21.5C11.9 21.8 11.7 22.2 11.5 22.5C11.1 23.0 11.1 23.2 11.0 23.9C10.9 24.1 10.8 24.6 10.7 24.9C10.5 25.4 10.5 25.7 10.5 26.4C10.6 27.1 10.5 27.4 10.4 27.8C10.2 28.3 10.2 28.6 10.2 30.1C10.2 31.7 10.2 31.8 10.5 32.5C10.7 32.9 10.8 33.6 10.9 34.0C11.1 35.3 11.2 35.6 11.5 36.0C11.6 36.2 11.9 36.6 12.0 36.9C12.1 37.3 12.3 37.7 12.5 38.0C12.7 38.3 12.9 38.8 13.0 39.0C13.1 39.3 13.3 39.6 13.6 39.9C13.9 40.1 14.3 40.6 14.5 41.0C15.2 42.0 17.2 43.9 17.7 44.1C18.1 44.2 18.4 44.4 19.0 45.0C19.8 45.8 20.1 45.9 20.6 46.0C20.8 46.1 21.1 46.2 21.2 46.3C21.6 46.6 21.9 46.7 22.8 46.9C23.3 47.0 24.0 47.2 24.2 47.3C24.6 47.5 24.8 47.6 25.1 47.5C25.4 47.5 25.8 47.6 26.3 47.7C27.1 48.0 27.2 48.0 28.7 48.0C29.5 47.9 30.8 47.9 31.4 47.9C32.6 47.9 32.6 47.8 32.9 47.5C33.1 47.3 33.4 47.2 33.4 47.2C33.5 47.2 33.8 47.2 34.2 47.2C34.9 47.1 35.4 46.9 36.1 46.4C36.2 46.3 36.6 46.1 37.0 46.0C37.3 45.9 37.7 45.7 38.0 45.5C38.2 45.3 38.7 45.1 39.0 45.0C39.7 44.8 40.3 44.3 41.0 43.6C41.3 43.4 41.7 43.1 41.9 43.0C42.4 42.7 43.8 41.2 44.0 40.6C44.1 40.3 44.3 39.9 44.4 39.9C44.5 39.8 44.8 39.5 45.0 39.1C45.3 38.8 45.5 38.4 45.6 38.3C45.7 38.2 45.9 37.9 46.0 37.6C46.1 37.3 46.2 36.9 46.4 36.6C46.6 36.3 46.7 35.9 46.8 35.3C46.9 34.8 47.1 34.2 47.3 33.9C47.4 33.6 47.5 33.3 47.5 32.9C47.5 32.6 47.6 32.3 47.6 32.2C48.1 31.3 48.0 26.7 47.4 25.2C47.2 24.7 47.1 24.1 47.1 23.8C47.0 22.9 46.8 22.4 46.5 22.0C46.3 21.8 46.1 21.4 46.0 21.0C45.9 20.6 45.6 20.2 45.5 20.0C45.3 19.8 45.1 19.5 45.0 19.2C44.9 19.0 44.7 18.8 44.6 18.7C44.5 18.6 44.3 18.3 44.1 18.0C43.7 17.3 42.6 16.2 42.0 15.9C41.2 15.4 39.4 13.5 39.3 13.0C39.2 12.8 39.1 12.4 39.0 12.1C38.6 11.0 38.7 10.5 39.2 9.8C39.4 9.6 39.6 9.2 39.7 8.9C39.8 8.3 40.1 8.0 40.8 8.0C41.1 7.9 41.6 7.8 42.0 7.6C42.9 7.3 43.3 7.3 43.7 7.6C43.9 7.8 44.2 7.9 44.4 8.0C44.7 8.1 45.1 8.4 45.7 9.0C46.2 9.5 46.7 10.0 46.9 10.1C47.4 10.3 48.5 11.4 48.9 12.0C49.1 12.3 49.4 12.7 49.6 13.0C49.8 13.2 50.0 13.4 50.0 13.5C50.0 13.6 50.2 13.8 50.4 14.1C50.7 14.4 50.9 14.7 51.0 15.0C51.1 15.2 51.3 15.6 51.6 15.9C51.8 16.2 52.0 16.5 52.0 16.5C52.0 16.6 52.2 16.8 52.5 17.1C52.9 17.6 52.9 17.6 53.0 18.4C53.1 19.4 53.1 19.5 53.5 20.0C53.9 20.5 54.2 21.3 54.2 22.0C54.2 22.5 54.2 22.7 54.5 23.0C54.8 23.3 54.8 23.3 54.9 24.2C54.9 24.7 55.0 25.6 55.2 28.1C55.2 28.5 55.3 29.0 55.4 29.2C55.5 29.4 55.5 29.6 55.4 29.8C55.2 30.2 55.1 31.4 55.0 33.4C55.0 34.8 54.9 34.9 54.6 35.3C54.4 35.7 54.3 36.0 54.2 36.7C54.1 37.2 53.9 37.8 53.7 38.1C53.6 38.4 53.5 38.6 53.5 39.0C53.5 39.6 53.5 39.6 53.0 40.0C52.5 40.4 52.5 40.4 52.5 41.0C52.5 41.6 52.5 41.6 51.8 42.2C51.3 42.8 51.2 42.9 51.0 43.5C50.8 44.2 50.7 44.3 49.4 45.7C48.6 46.4 48.0 47.1 48.0 47.2C48.0 47.3 46.3 49.0 46.2 49.0C46.1 49.0 45.7 49.4 45.1 49.9C44.6 50.4 44.0 50.9 43.7 51.0C43.5 51.2 43.2 51.4 43.0 51.5C42.8 51.7 42.3 51.9 42.0 52.0C41.6 52.1 41.2 52.4 41.0 52.5C40.8 52.7 40.3 52.9 40.0 53.0C39.6 53.1 39.2 53.4 39.0 53.5C38.6 53.8 38.2 53.9 37.1 54.1C36.8 54.1 36.5 54.2 36.3 54.4C35.7 54.8 35.3 54.9 34.9 54.9C34.8 54.8 34.2 54.9 33.7 55.0C33.2 55.1 32.3 55.1 31.6 55.2C30.6 55.2 30.2 55.2 29.8 55.4C29.2 55.6 28.8 55.6 28.3 55.4ZM29.1 30.7C28.8 30.6 28.4 30.5 28.1 30.5C27.5 30.5 27.5 30.5 27.0 30.1C25.7 28.8 25.8 29.5 25.8 17.0C25.8 5.6 25.8 5.5 26.4 4.7C26.5 4.5 26.7 4.2 26.8 4.0C27.4 3.2 27.5 3.1 28.0 3.0C28.6 2.8 29.1 2.8 30.1 2.9C31.0 3.1 31.4 3.3 31.7 3.8C32.2 4.6 32.5 5.0 32.7 5.2C32.8 5.4 32.8 6.6 32.8 16.7C32.8 27.7 32.8 27.9 32.6 28.3C32.5 28.5 32.3 28.9 32.1 29.3C31.9 29.7 31.7 29.9 31.5 30.0C31.4 30.1 31.1 30.3 30.8 30.5C30.4 31.0 29.9 31.0 29.1 30.7Z"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
};
function ckMenuRow(icon, label, action, badge){
  return `<button class="ck-row" type="button" onclick="${action}"><span class="ck-row-ic">${CK_MENU_ICONS[icon]}</span><span class="ck-row-t">${esc(label)}</span>${badge ? `<em class="ck-row-badge">${badge}</em>` : ''}<span class="ck-row-go">${CK_MENU_ICONS.chev}</span></button>`;
}
async function renderAccount(){
  // The loading box shows while the member's own figures are read from the database; the page then appears once.
  $('pageHost').innerHTML = '<div class="ck-sub ck-my ck-shell"></div>';
  const r = await api('/account');
  if (r.status === 'success' && r.account) STATE.account = r.account;
  if (STATE.page !== 'account') return;
  paintAccount();
}
function paintAccount(){
  const a = STATE.account || {};
  const avatar = STATE.profileLogo
    ? `<img src="${esc(STATE.profileLogo)}" alt="" onerror="this.style.display='none'">`
    : `<span class="v-av-fb">${VI.person}</span>`;
  const html = `
<div class="ck-sub ck-my v-my">
  <div class="ck-me${STATE.myHero ? ' has-img' : ''}"${STATE.myHero ? ` style="--ck-me-img:url('${esc(STATE.myHero)}')"` : ''}>
    <div class="ck-me-top">
      <div class="ck-avatar">${avatar}<i class="ck-vip">VIP${Number(a.vipLevel) || 0}</i></div>
      <div class="ck-me-id"><div class="ck-me-phone">${esc(localDigits(a.phone) ? dial() + localDigits(a.phone) : (a.phone || ''))}</div>${a.publicId ? `<span class="ck-idchip">ID ${esc(a.publicId)}</span>` : ''}</div>
    </div>
  </div>
  <div class="ck-balcard">
    <div><b id="myBalance" data-plain="1">${esc(numGroup(a.walletBalance, false))}</b><span>Balance</span></div>
    <div><b data-plain="1" id="myDeposited">${esc(numGroup(a.totalDeposited, false))}</b><span>Deposit</span></div>
    <div><b data-plain="1" id="myEarned">${esc(numGroup(a.totalEarned, false))}</b><span>Total income</span></div>
  </div>
  <div class="ck-menu">
    ${ckMenuRow('mail', 'Messages', 'openMessagesSheet()')}
    ${ckMenuRow('person', 'Personal information', 'openPersonalInfo()')}
    ${ckMenuRow('income', 'Income details', "openBalanceDetails('income')")}
    ${ckMenuRow('deposit', 'Deposit details', "openBalanceDetails('deposit')")}
    ${ckMenuRow('withdraw', 'Withdrawal details', "openBalanceDetails('withdraw')")}
    ${ckMenuRow('about', 'About us', 'openRulesPage()')}
    ${ckMenuRow('download', 'Download', 'promptInstallApp()')}
    ${ckMenuRow('language', 'Language', 'openLangPicker()')}
    ${ckMenuRow('power', 'Sign out', 'doLogout()')}
  </div>
</div>`;
  $('pageHost').innerHTML = html;
}
// Language: a white sheet from the bottom with one line per language this app offers (English only).
window.openLangPicker = function(){
  closeCkLang();
  const wrap = document.createElement('div'); wrap.id = 'ckLangPop'; wrap.className = 'ck-langpop';
  wrap.onclick = e => { if (e.target === wrap) closeCkLang(); };
  wrap.innerHTML = `<div class="ck-langcard">${LANG_ALLOWED.map(c => `<button type="button" class="${c === LANG ? 'on' : ''}" onclick="pickLang('${c}')">${esc(langMeta(c).native)}</button>`).join('')}</div>`;
  document.body.appendChild(wrap);
};
function closeCkLang(){ const w = $('ckLangPop'); if (w) w.remove(); }
window.pickLang = function(c){ try { setLang(c, {}); } catch (_) {} closeCkLang(); };
// Personal information: the wallet, the login password and the trade password, in one place.
var CK_PW_ART = `<svg viewBox="0 0 1080 735" aria-hidden="true"><path fill="#000" fill-rule="evenodd" d="M348.5 599.1C348.1 599.0 346.9 598.3 345.8 597.5C344.6 596.8 343.0 595.8 342.0 595.3C341.0 594.8 339.6 594.0 338.8 593.5C337.9 593.0 336.4 592.1 335.2 591.5C334.1 590.9 332.6 590.0 331.8 589.5C330.9 589.0 329.4 588.1 328.2 587.6C327.1 587.0 325.5 586.1 324.5 585.4C323.5 584.8 321.5 583.6 319.9 582.8C318.3 582.1 316.9 581.2 316.7 581.0C316.6 580.7 315.0 579.8 313.2 579.0C311.5 578.2 309.9 577.3 309.8 577.0C309.6 576.8 308.2 575.9 306.6 575.2C305.0 574.4 303.2 573.4 302.6 572.9C301.3 572.0 298.8 571.7 298.3 572.4C297.8 573.2 292.0 575.8 289.0 576.7C283.8 578.2 276.5 577.7 272.9 575.5C272.0 575.0 270.8 574.3 270.2 574.1C269.7 573.8 268.9 573.2 268.5 572.8C268.2 572.4 267.6 572.0 267.3 572.0C266.9 572.0 266.2 571.5 265.8 571.0C265.3 570.5 264.6 570.0 264.2 570.0C263.9 570.0 263.2 569.5 262.8 569.0C262.3 568.5 261.6 568.0 261.4 568.0C261.2 568.0 259.3 566.9 257.2 565.5C255.1 564.1 253.3 563.0 253.0 563.0C252.8 563.0 252.2 562.5 251.8 562.0C251.3 561.5 250.6 561.0 250.2 561.0C249.9 561.0 249.2 560.5 248.8 560.0C248.3 559.5 247.6 559.0 247.3 559.0C246.9 559.0 246.2 558.5 245.8 558.0C245.3 557.5 244.6 557.0 244.2 557.0C243.9 557.0 243.2 556.5 242.8 556.0C242.3 555.5 241.6 555.0 241.4 555.0C241.1 555.0 239.9 554.3 238.8 553.5C237.6 552.7 236.4 552.0 236.1 552.0C235.9 552.0 235.2 551.5 234.8 551.0C234.3 550.5 233.6 550.0 233.2 550.0C232.4 550.0 228.4 545.2 227.4 543.0C225.5 538.8 225.5 539.2 225.2 411.4C224.8 284.1 224.9 283.1 226.6 274.0C227.9 266.9 234.1 251.3 236.2 249.5C236.7 249.2 237.0 248.6 237.0 248.3C237.0 247.9 237.4 247.2 238.0 246.8C238.6 246.3 239.0 245.7 239.0 245.4C239.0 242.9 254.9 227.3 260.8 224.0C261.9 223.4 262.9 222.7 263.0 222.6C263.1 222.4 263.8 221.9 264.4 221.6C265.1 221.2 266.4 220.5 267.3 220.0C268.2 219.4 269.8 218.5 270.9 217.9C271.9 217.4 273.0 216.7 273.2 216.5C273.5 216.3 274.6 215.6 275.6 215.1C276.7 214.5 278.3 213.5 279.2 213.0C280.2 212.4 281.8 211.5 282.9 210.9C283.9 210.4 285.0 209.7 285.2 209.5C285.5 209.3 286.6 208.6 287.6 208.1C288.7 207.5 290.3 206.5 291.2 206.0C292.2 205.4 293.8 204.5 294.9 203.9C295.9 203.4 297.0 202.7 297.2 202.5C297.5 202.3 298.6 201.6 299.6 201.1C300.7 200.5 302.3 199.5 303.2 199.0C304.2 198.4 305.8 197.5 306.9 196.9C307.9 196.4 309.0 195.7 309.2 195.5C309.5 195.3 310.6 194.6 311.6 194.1C312.7 193.5 314.3 192.5 315.2 192.0C316.2 191.4 317.8 190.5 318.9 189.9C319.9 189.4 321.0 188.7 321.2 188.5C321.5 188.3 322.6 187.6 323.6 187.1C324.7 186.5 326.3 185.5 327.2 185.0C328.2 184.4 329.8 183.5 330.9 182.9C331.9 182.4 333.0 181.7 333.2 181.5C333.5 181.3 334.6 180.6 335.6 180.1C336.7 179.5 338.3 178.5 339.2 178.0C340.2 177.4 341.8 176.5 342.9 175.9C343.9 175.4 345.0 174.7 345.2 174.5C345.5 174.3 346.6 173.6 347.6 173.1C348.7 172.5 350.3 171.5 351.2 171.0C352.2 170.4 353.8 169.5 354.9 168.9C355.9 168.4 357.0 167.7 357.2 167.5C357.5 167.3 358.6 166.6 359.6 166.1C360.7 165.5 362.3 164.5 363.2 164.0C364.2 163.4 365.8 162.5 366.9 161.9C367.9 161.4 369.3 160.5 370.1 159.9C370.8 159.4 371.6 159.0 371.7 159.0C371.9 159.0 373.0 158.4 374.2 157.6C375.3 156.8 376.9 155.9 377.8 155.5C378.6 155.1 379.8 154.4 380.5 154.0C381.2 153.5 382.6 152.6 383.6 152.1C384.7 151.5 386.3 150.5 387.2 150.0C388.2 149.4 389.8 148.5 390.9 147.9C391.9 147.4 393.0 146.7 393.2 146.5C393.5 146.3 394.6 145.6 395.6 145.1C396.7 144.5 398.3 143.5 399.2 143.0C400.2 142.4 401.8 141.5 402.9 140.9C403.9 140.4 405.0 139.7 405.2 139.5C405.5 139.3 406.6 138.6 407.6 138.1C408.7 137.5 410.3 136.5 411.2 136.0C412.2 135.4 413.8 134.5 414.9 133.9C415.9 133.4 417.0 132.7 417.2 132.5C417.5 132.3 418.6 131.7 419.6 131.1C423.2 129.1 423.8 128.7 424.0 128.5C424.1 128.4 424.9 127.9 425.8 127.5C426.6 127.1 427.8 126.4 428.5 126.0C429.2 125.5 430.6 124.6 431.6 124.1C432.7 123.5 434.3 122.5 435.3 122.0C436.2 121.4 437.8 120.5 438.9 119.9C439.9 119.4 441.0 118.7 441.2 118.5C441.5 118.3 442.6 117.7 443.6 117.1C447.2 115.1 447.8 114.7 448.0 114.5C448.1 114.4 448.9 113.9 449.8 113.5C450.6 113.1 451.8 112.4 452.5 112.0C453.2 111.5 454.6 110.6 455.6 110.1C456.7 109.5 458.3 108.5 459.2 108.0C460.2 107.4 461.8 106.5 462.9 105.9C463.9 105.4 465.0 104.7 465.2 104.5C465.5 104.3 466.6 103.6 467.6 103.1C468.7 102.5 470.3 101.5 471.2 101.0C472.2 100.4 473.8 99.5 474.9 98.9C475.9 98.4 477.0 97.7 477.2 97.5C477.5 97.3 478.6 96.6 479.6 96.1C480.7 95.5 482.3 94.5 483.2 94.0C484.2 93.4 485.8 92.5 486.9 91.9C487.9 91.4 489.0 90.7 489.2 90.5C489.5 90.3 490.6 89.6 491.6 89.1C492.7 88.5 494.3 87.5 495.2 87.0C496.2 86.4 497.8 85.5 498.9 84.9C499.9 84.4 501.0 83.7 501.2 83.5C501.5 83.3 502.6 82.6 503.6 82.1C504.7 81.5 506.3 80.5 507.2 80.0C508.2 79.4 509.8 78.5 510.9 77.9C511.9 77.4 513.0 76.7 513.2 76.5C513.5 76.3 514.6 75.6 515.6 75.1C516.7 74.5 518.3 73.5 519.2 73.0C520.2 72.4 521.8 71.5 522.9 70.9C523.9 70.4 525.0 69.7 525.2 69.5C525.5 69.3 526.6 68.6 527.6 68.1C528.7 67.5 530.3 66.5 531.2 66.0C532.2 65.4 533.8 64.5 534.9 63.9C535.9 63.4 537.0 62.7 537.2 62.5C537.5 62.3 538.6 61.6 539.6 61.1C540.7 60.5 542.3 59.5 543.2 59.0C544.2 58.4 545.8 57.5 546.9 56.9C547.9 56.4 549.0 55.7 549.2 55.5C549.5 55.3 550.6 54.6 551.6 54.1C552.7 53.5 554.3 52.5 555.2 52.0C556.2 51.4 557.8 50.5 558.9 49.9C559.9 49.4 561.3 48.5 562.1 47.9C562.8 47.4 563.6 47.0 563.7 47.0C563.9 47.0 565.0 46.4 566.2 45.6C567.3 44.8 568.9 43.9 569.8 43.5C570.6 43.1 571.8 42.4 572.5 42.0C573.2 41.5 574.6 40.6 575.6 40.1C576.7 39.5 578.3 38.5 579.4 37.9C593.0 30.1 597.9 30.0 611.3 37.2C612.5 37.8 613.8 38.6 614.2 39.0C614.6 39.3 616.3 40.3 617.9 41.1C619.5 41.9 621.1 42.9 621.5 43.2C621.9 43.6 623.1 44.2 624.1 44.7C625.1 45.1 626.1 45.7 626.3 46.0C626.4 46.3 627.5 46.9 628.7 47.5C629.8 48.0 631.5 48.9 632.5 49.6C633.5 50.2 634.9 51.1 635.8 51.5C636.6 51.9 637.6 52.5 638.1 52.9C638.5 53.3 640.2 54.2 641.7 55.0C647.6 58.1 651.5 61.7 653.3 66.0C654.3 68.3 654.9 69.7 655.6 71.5C656.1 72.9 656.3 89.4 656.4 161.2C656.5 248.5 656.5 249.2 657.5 250.3C658.1 250.9 660.0 252.1 661.8 253.0C663.5 253.9 665.1 254.8 665.3 255.0C665.4 255.3 666.4 255.9 667.4 256.3C668.4 256.8 670.1 257.8 671.2 258.5C672.4 259.2 673.9 260.1 674.8 260.5C675.6 260.9 677.1 261.8 678.2 262.5C679.4 263.2 681.1 264.2 682.1 264.7C683.1 265.1 684.1 265.7 684.3 266.0C684.4 266.3 685.5 267.0 686.7 267.5C687.8 268.1 689.4 269.0 690.2 269.5C691.1 270.0 692.5 270.9 693.5 271.3C694.5 271.8 696.0 272.7 697.0 273.4C698.0 274.1 699.7 275.0 700.8 275.5C702.0 276.1 703.1 276.7 703.2 277.0C703.4 277.3 704.5 277.9 705.7 278.5C706.8 279.0 708.5 279.9 709.5 280.6C710.5 281.3 712.1 282.2 713.1 282.7C714.1 283.1 715.1 283.7 715.3 284.0C715.4 284.3 716.5 284.9 717.7 285.5C718.8 286.0 720.5 286.9 721.5 287.6C722.5 288.3 724.0 289.2 725.0 289.7C726.0 290.1 727.4 291.0 728.2 291.5C729.1 292.0 730.7 292.9 731.8 293.5C733.0 294.0 734.1 294.7 734.3 295.0C734.4 295.3 735.5 295.9 736.7 296.5C737.8 297.0 739.5 297.9 740.5 298.6C741.5 299.3 743.0 300.2 744.0 300.7C745.0 301.1 746.4 302.0 747.2 302.5C748.1 303.0 749.7 303.9 750.8 304.5C752.0 305.0 753.1 305.7 753.3 306.0C753.4 306.3 754.5 306.9 755.7 307.5C756.8 308.0 758.5 308.9 759.5 309.6C760.5 310.3 762.0 311.2 763.0 311.7C764.0 312.1 765.4 313.0 766.2 313.5C767.1 314.0 768.7 314.9 769.8 315.5C771.0 316.0 772.1 316.7 772.2 317.0C772.4 317.3 773.4 317.9 774.4 318.3C775.4 318.8 777.1 319.8 778.2 320.5C779.4 321.2 780.9 322.1 781.8 322.5C782.6 322.9 784.1 323.8 785.2 324.5C786.4 325.2 788.1 326.2 789.1 326.7C790.1 327.1 791.1 327.7 791.2 328.0C791.4 328.3 792.4 328.9 793.4 329.3C794.4 329.8 796.1 330.8 797.2 331.5C798.4 332.2 799.9 333.1 800.8 333.5C801.6 333.9 803.1 334.8 804.2 335.5C805.4 336.2 807.1 337.2 808.1 337.7C809.1 338.1 810.1 338.7 810.2 339.0C810.4 339.3 812.0 340.2 813.8 341.0C815.5 341.8 817.1 342.7 817.3 343.0C817.4 343.3 818.4 343.9 819.4 344.3C820.4 344.8 822.0 345.7 823.0 346.4C824.0 347.1 825.7 348.0 826.8 348.5C828.0 349.1 829.1 349.7 829.2 350.0C829.4 350.3 830.3 350.8 831.2 351.3C838.4 354.7 848.7 367.5 851.5 376.5C851.8 377.7 852.5 379.8 852.9 381.0C853.3 382.2 853.8 385.5 854.0 388.2C854.7 395.8 854.1 540.7 853.4 543.5C851.7 550.6 848.3 554.4 837.6 561.6C833.2 564.6 829.4 567.0 829.3 567.0C829.1 567.0 826.0 569.0 822.4 571.4C813.9 577.1 810.6 577.5 802.5 573.9C800.1 572.8 798.2 573.1 795.4 575.1C794.7 575.6 792.9 576.6 791.4 577.4C789.9 578.2 787.9 579.3 786.9 579.9C785.8 580.5 784.2 581.5 783.2 582.0C782.3 582.5 780.7 583.5 779.6 584.1C778.6 584.7 776.6 585.8 775.1 586.6C773.6 587.4 771.8 588.4 771.1 588.9C769.1 590.4 767.9 590.4 766.4 589.0C765.2 587.8 761.0 581.8 761.0 581.3C761.0 581.1 759.9 579.3 758.5 577.2C757.1 575.2 756.0 573.4 756.0 573.2C756.0 573.1 754.9 571.3 753.5 569.2C752.1 567.2 751.0 565.4 751.0 565.3C751.0 565.1 749.9 563.3 748.5 561.3C747.1 559.2 746.0 557.4 746.0 557.2C746.0 557.1 744.9 555.3 743.5 553.2C742.1 551.2 741.0 549.4 741.0 549.2C741.0 549.1 739.9 547.3 738.5 545.2C737.1 543.2 736.0 541.4 736.0 541.2C736.0 541.1 735.1 539.6 734.0 538.0C732.9 536.4 732.0 534.9 732.0 534.6C732.0 533.8 729.1 531.4 726.2 529.9C724.6 529.1 722.9 528.1 722.5 527.8C722.1 527.4 721.0 526.8 720.0 526.3C719.0 525.8 717.6 525.0 716.8 524.5C715.9 524.0 714.5 523.1 713.5 522.7C712.5 522.2 711.0 521.3 710.0 520.6C709.0 519.9 707.3 519.0 706.2 518.5C705.0 517.9 703.9 517.3 703.8 517.0C703.6 516.7 702.6 516.1 701.6 515.7C700.6 515.2 698.9 514.2 697.8 513.5C696.6 512.8 695.1 511.9 694.2 511.5C693.4 511.1 691.9 510.2 690.8 509.5C689.6 508.8 687.9 507.8 686.9 507.3C685.9 506.9 684.9 506.3 684.7 506.0C684.6 505.7 683.5 505.1 682.3 504.5C681.2 504.0 679.5 503.1 678.5 502.4C677.5 501.7 676.0 500.8 675.0 500.3C674.0 499.9 672.6 499.0 671.8 498.5C670.9 498.0 669.5 497.1 668.5 496.7C667.5 496.2 666.0 495.3 665.0 494.6C664.0 493.9 662.3 493.0 661.2 492.5C660.0 491.9 658.9 491.3 658.8 491.0C658.6 490.8 657.0 489.8 655.3 489.0C653.5 488.2 651.9 487.3 651.7 487.0C651.6 486.7 650.6 486.1 649.6 485.7C648.6 485.2 647.0 484.3 646.0 483.6C645.0 482.9 643.3 482.0 642.2 481.5C641.0 480.9 639.9 480.3 639.7 480.0C639.6 479.7 638.5 479.1 637.3 478.5C636.2 478.0 634.5 477.1 633.5 476.4C632.5 475.7 631.0 474.8 630.0 474.3C629.0 473.9 627.6 473.0 626.8 472.5C625.9 472.0 624.5 471.1 623.5 470.7C622.5 470.2 621.0 469.3 620.0 468.6C619.0 467.9 617.3 467.0 616.2 466.5C615.0 465.9 613.9 465.3 613.8 465.0C613.6 464.7 612.6 464.1 611.6 463.7C610.6 463.2 608.9 462.2 607.8 461.5C606.6 460.8 605.1 459.9 604.2 459.5C603.4 459.1 601.8 458.1 600.6 457.4C599.5 456.6 598.4 456.0 598.3 456.0C595.8 456.0 580.0 438.9 580.0 436.3C580.0 436.1 579.5 434.9 579.0 433.6C576.6 428.2 575.8 425.6 574.5 418.9C573.7 414.8 573.8 414.8 568.4 417.9C567.3 418.5 565.7 419.4 564.8 420.0C563.8 420.6 562.2 421.4 561.2 422.0C560.3 422.5 558.7 423.4 557.8 424.0C556.8 424.6 555.2 425.4 554.2 426.0C553.3 426.6 551.7 427.4 550.8 428.0C549.8 428.6 548.2 429.5 547.1 430.1C546.1 430.6 544.7 431.5 544.0 432.0C543.3 432.4 542.1 433.1 541.2 433.5C540.4 433.9 538.9 434.8 537.8 435.5C536.6 436.2 535.1 437.1 534.2 437.5C533.4 437.9 531.9 438.8 530.8 439.5C529.6 440.2 528.1 441.1 527.2 441.5C526.4 441.9 524.9 442.8 523.8 443.5C522.6 444.2 521.1 445.1 520.2 445.5C519.4 445.9 517.9 446.8 516.8 447.5C515.6 448.2 514.1 449.1 513.2 449.5C512.4 449.9 511.2 450.6 510.5 451.0C509.8 451.5 508.4 452.4 507.4 452.9C506.3 453.5 504.7 454.4 503.8 455.0C502.8 455.6 501.2 456.4 500.2 457.0C499.3 457.6 497.7 458.4 496.8 459.0C495.8 459.6 494.2 460.4 493.2 461.0C492.3 461.6 490.7 462.4 489.8 463.0C487.8 464.1 485.3 465.5 483.4 466.6C482.8 466.9 482.1 467.4 482.0 467.5C481.9 467.6 480.9 468.2 479.8 468.8C477.2 470.1 475.3 471.2 475.0 471.5C474.9 471.6 473.9 472.2 472.8 472.8C470.2 474.1 468.3 475.2 468.0 475.5C467.9 475.6 467.1 476.1 466.2 476.5C465.4 476.9 463.9 477.8 462.8 478.5C461.6 479.2 460.1 480.1 459.2 480.5C458.4 480.9 456.9 481.8 455.8 482.5C454.6 483.2 453.1 484.1 452.2 484.5C451.4 484.9 449.9 485.8 448.8 486.5C447.6 487.2 446.1 488.1 445.2 488.5C444.4 488.9 442.9 489.8 441.8 490.5C440.6 491.2 439.1 492.1 438.2 492.5C437.4 492.9 435.9 493.8 434.8 494.5C433.6 495.2 432.1 496.1 431.2 496.5C430.4 496.9 429.2 497.6 428.5 498.0C427.8 498.5 426.4 499.4 425.4 499.9C424.3 500.5 422.7 501.4 421.8 502.0C420.8 502.6 419.2 503.4 418.2 504.0C417.3 504.6 415.8 505.4 414.9 505.9C414.0 506.4 412.2 507.4 411.0 508.1C409.8 508.8 408.5 509.8 408.2 510.3C408.0 510.8 407.1 512.2 406.4 513.4C405.6 514.5 405.0 515.7 405.0 515.9C405.0 516.2 404.6 516.8 404.0 517.2C403.4 517.7 403.0 518.4 403.0 518.8C403.0 519.1 402.7 519.7 402.3 520.0C401.4 520.7 400.0 523.4 400.0 524.3C400.0 524.7 399.6 525.2 399.0 525.5C398.4 525.8 398.0 526.3 398.0 526.7C398.0 527.1 397.7 527.7 397.2 528.0C396.8 528.4 396.0 529.6 395.5 530.8C395.0 531.9 394.2 533.1 393.8 533.5C393.3 533.8 393.0 534.4 393.0 534.7C393.0 535.1 392.6 535.8 392.0 536.2C391.4 536.7 391.0 537.4 391.0 537.6C391.0 537.9 390.3 539.1 389.5 540.2C388.7 541.4 388.0 542.6 388.0 542.9C388.0 543.1 387.6 543.8 387.0 544.2C386.4 544.7 386.0 545.3 386.0 545.6C386.0 545.8 385.3 547.0 384.5 548.2C383.7 549.4 383.0 550.6 383.0 550.9C383.0 551.1 382.6 551.8 382.0 552.2C381.4 552.7 381.0 553.4 381.0 553.8C381.0 554.1 380.7 554.7 380.2 555.0C379.8 555.4 379.0 556.6 378.5 557.8C378.0 558.9 377.2 560.1 376.8 560.5C376.3 560.8 376.0 561.4 376.0 561.7C376.0 562.1 375.6 562.8 375.0 563.2C374.4 563.7 374.0 564.4 374.0 564.6C374.0 564.9 373.3 566.1 372.5 567.3C371.7 568.5 371.0 569.7 371.0 569.9C371.0 570.2 370.6 570.8 370.0 571.2C369.4 571.7 369.0 572.4 369.0 572.6C369.0 572.9 368.3 574.1 367.5 575.2C366.7 576.4 366.0 577.6 366.0 577.9C366.0 578.1 365.6 578.8 365.0 579.2C364.4 579.7 364.0 580.3 364.0 580.6C364.0 580.8 363.3 582.0 362.5 583.2C361.7 584.4 361.0 585.6 361.0 585.9C361.0 586.1 360.6 586.8 360.0 587.2C359.4 587.7 359.0 588.4 359.0 588.8C359.0 589.1 358.7 589.7 358.2 590.0C357.8 590.4 357.1 591.5 356.6 592.4C355.5 594.8 353.0 598.0 352.2 598.0C351.9 598.0 351.3 598.3 351.0 598.8C350.4 599.5 349.8 599.6 348.5 599.1Z"/><path fill="#d4d8d9" fill-rule="evenodd" d="M500.7 691.6C500.2 691.5 498.5 691.2 497.0 691.0C493.6 690.3 489.0 690.0 476.2 689.7C470.8 689.6 465.5 689.3 464.5 689.0C461.5 688.2 454.6 687.5 449.0 687.5C443.6 687.5 441.5 687.2 441.5 686.4C441.5 686.2 442.0 686.0 442.7 686.0C443.4 686.0 444.0 685.7 444.1 685.4C444.3 685.0 444.7 685.1 445.4 685.9C446.4 687.0 448.0 687.4 448.0 686.5C448.0 686.2 448.4 686.0 449.0 686.0C449.6 686.0 450.0 686.2 450.0 686.5C450.0 686.8 451.3 687.0 453.0 687.0C454.7 687.0 456.0 686.8 456.0 686.5C456.0 686.2 456.4 686.0 457.0 686.0C457.6 686.0 458.0 686.2 458.0 686.5C458.0 686.8 459.0 687.0 460.3 687.0C461.7 687.0 462.9 687.3 463.3 687.8C463.8 688.2 464.5 688.4 465.1 688.2C465.6 688.1 466.0 688.1 466.0 688.4C466.0 688.6 466.3 688.8 466.8 688.8C467.2 688.8 467.5 688.6 467.5 688.4C467.5 688.2 468.1 688.0 468.8 688.0C469.4 688.0 470.0 688.2 470.0 688.6C470.0 688.9 470.4 689.0 470.8 688.8C472.4 688.2 478.0 688.0 478.0 688.5C478.0 688.8 478.4 689.0 479.0 689.0C479.6 689.0 480.0 688.8 480.0 688.5C480.0 688.2 480.4 688.0 481.0 688.0C481.6 688.0 482.0 688.2 482.0 688.5C482.0 689.2 483.9 689.1 484.1 688.4C484.3 687.9 484.5 688.0 485.1 688.5C485.9 689.3 490.0 689.3 490.0 688.4C490.0 687.6 491.8 688.0 492.5 689.0C493.3 690.1 497.0 690.5 497.0 689.5C497.0 689.2 497.3 689.0 497.8 689.0C498.8 689.0 502.0 685.8 502.0 684.8C502.0 684.2 502.5 684.0 504.0 684.0C505.7 684.0 506.0 684.2 506.0 685.0C506.0 685.7 506.3 686.0 507.0 686.0C507.7 686.0 508.0 686.3 508.0 687.0C508.0 687.7 507.7 688.0 507.0 688.0C506.3 688.0 506.0 688.3 506.0 689.1C506.0 690.3 506.1 690.3 510.0 690.1C512.4 690.1 514.0 690.2 514.0 690.5C514.0 690.8 514.5 691.0 515.0 691.0C515.5 691.0 516.0 690.8 516.0 690.4C516.0 689.9 517.5 690.0 522.1 690.7C523.2 690.9 524.0 690.8 524.0 690.6C524.0 690.0 529.7 690.1 530.1 690.7C530.4 691.1 530.8 691.1 531.5 690.6C532.0 690.3 532.8 690.0 533.2 690.0C533.6 690.0 534.0 690.3 534.1 690.6C534.3 691.1 534.6 691.1 535.4 690.6C536.0 690.3 536.8 690.0 537.2 690.0C537.6 690.0 538.0 690.3 538.1 690.6C538.3 691.1 538.6 691.1 539.4 690.6C540.6 689.9 542.0 689.8 542.0 690.4C542.0 690.9 547.3 690.9 547.8 690.4C548.0 690.2 548.6 690.0 549.1 690.0C549.7 690.0 550.0 689.6 550.0 689.0C550.0 688.5 550.2 688.0 550.5 688.0C550.8 688.0 551.0 688.5 551.0 689.0C551.0 689.5 550.8 690.0 550.5 690.0C550.2 690.0 550.0 690.2 550.0 690.5C550.0 691.2 557.7 691.1 559.6 690.4C560.6 690.0 561.4 690.0 562.3 690.4C563.4 691.0 563.7 690.9 565.0 689.5C566.6 687.8 568.0 687.5 568.0 689.0C568.0 689.5 567.8 690.0 567.5 690.0C567.2 690.0 567.0 690.2 567.0 690.5C567.0 691.2 568.9 691.1 569.2 690.4C569.4 689.9 569.6 689.9 569.8 690.4C570.1 691.1 571.8 691.2 572.1 690.5C572.3 689.9 574.0 690.4 574.0 691.1C574.0 691.6 573.4 691.6 543.3 691.5C527.9 691.5 520.1 691.3 519.6 690.9C519.2 690.5 518.8 690.5 518.4 690.9C517.8 691.4 503.2 692.0 500.7 691.6ZM576.1 691.6C575.1 691.4 575.1 691.4 575.8 690.6C576.5 690.0 576.9 689.9 578.1 690.4C578.9 690.7 579.9 690.8 580.3 690.7C581.1 690.4 581.3 689.0 580.5 689.0C579.8 689.0 579.9 687.5 580.7 686.7C581.7 685.7 581.9 685.8 582.1 687.4C582.2 688.6 582.5 688.8 584.6 688.9C585.9 689.0 587.0 689.3 587.0 689.6C587.0 689.9 587.3 690.0 587.8 689.8C588.2 689.6 588.4 689.7 588.2 690.0C588.1 690.3 586.6 690.5 585.1 690.5C583.5 690.5 582.0 690.7 581.7 690.9C581.2 691.5 577.7 691.9 576.1 691.6ZM504.0 689.2C504.0 688.3 504.3 688.0 505.0 688.0C505.7 688.0 506.0 687.7 506.0 687.0C506.0 686.2 505.7 686.0 504.0 686.0C502.3 686.0 502.0 686.2 502.0 687.0C502.0 687.7 501.7 688.0 501.0 688.0C499.9 688.0 499.6 689.7 500.6 690.2C502.5 690.9 504.0 690.5 504.0 689.2ZM605.2 689.6C605.1 689.5 601.6 689.4 597.4 689.5C589.9 689.5 589.8 689.5 590.9 688.6C591.5 688.1 592.0 687.3 592.0 686.8C592.0 686.3 592.4 686.0 593.0 686.0C593.8 686.0 594.0 686.3 594.0 687.5C594.0 689.0 594.7 689.5 595.2 688.4C595.3 688.0 595.6 687.9 595.8 688.2C596.3 688.9 600.0 689.0 600.0 688.4C600.0 688.2 600.5 688.0 601.0 688.0C601.5 688.0 602.0 688.2 602.0 688.4C602.0 688.6 603.1 688.8 604.5 688.9C606.1 689.0 607.0 688.8 607.0 688.4C607.0 688.1 607.6 688.0 608.9 688.2C609.9 688.4 611.3 688.6 611.9 688.6C612.6 688.6 612.9 688.8 612.7 689.0C612.3 689.4 605.6 689.9 605.2 689.6ZM627.3 687.5C623.1 687.3 622.9 687.2 624.2 686.6C625.1 686.2 625.8 686.1 626.0 686.4C626.1 686.7 628.4 686.9 631.1 686.8C635.8 686.8 637.2 686.4 635.0 685.9C634.5 685.7 634.0 685.2 634.0 684.8C634.0 684.3 633.8 684.1 633.5 684.2C633.2 684.4 633.0 684.3 633.0 684.0C633.0 683.2 631.7 682.0 630.8 682.0C630.3 682.0 630.0 681.6 630.0 681.0C630.0 680.3 630.3 680.0 631.0 680.0C631.6 680.0 632.0 680.3 632.0 680.8C632.0 681.2 632.3 681.9 632.7 682.3C633.5 683.1 635.0 683.2 635.0 682.5C635.0 682.2 635.7 682.0 636.5 682.0C637.5 682.0 638.0 682.2 638.0 682.8C638.0 683.3 637.7 683.5 637.0 683.2C635.9 682.9 635.7 683.3 636.6 684.2C637.4 685.0 644.0 685.2 644.0 684.5C644.0 683.7 646.6 684.1 646.9 684.9C647.0 685.3 646.2 685.5 643.8 685.5C641.9 685.5 640.5 685.7 640.5 686.0C640.5 686.3 639.8 686.5 638.9 686.5C637.9 686.5 637.0 686.7 636.7 687.0C636.0 687.6 632.3 687.9 627.3 687.5ZM417.2 683.5C415.6 683.3 413.4 682.8 412.3 682.3C411.2 681.9 409.4 681.5 408.1 681.5C405.9 681.5 403.2 680.9 401.4 679.9C400.9 679.7 399.7 679.5 398.6 679.5C396.3 679.5 394.9 678.8 396.5 678.4C397.3 678.1 397.4 677.8 397.2 676.5C396.9 675.1 397.0 674.9 397.7 675.2C398.2 675.3 398.7 675.5 398.8 675.5C398.9 675.5 399.0 675.7 399.0 676.0C399.0 676.8 400.3 678.0 401.2 678.0C401.6 678.0 402.0 678.2 402.0 678.5C402.0 678.8 402.4 679.0 403.0 679.0C403.6 679.0 404.0 679.3 404.0 679.8C404.0 680.3 404.3 680.5 405.0 680.2C405.6 680.1 406.0 680.2 406.0 680.5C406.0 680.8 406.4 681.0 407.0 681.0C407.6 681.0 408.0 680.8 408.0 680.5C408.0 680.2 408.4 680.0 409.0 680.0C409.6 680.0 410.0 680.2 410.0 680.5C410.0 680.8 410.9 681.0 412.0 681.0C413.4 681.0 414.0 681.2 414.0 681.7C414.0 682.2 414.8 682.4 417.4 682.3C420.6 682.2 423.0 682.7 423.0 683.6C423.0 684.0 421.9 684.0 417.2 683.5ZM691.9 675.0C692.5 674.7 693.0 674.3 693.0 674.0C693.0 673.2 694.3 672.0 695.2 672.0C695.7 672.0 696.0 671.6 696.0 671.0C696.0 670.5 696.2 670.0 696.5 670.0C696.8 670.0 697.0 670.5 697.0 671.0C697.0 671.5 696.8 672.0 696.5 672.0C696.2 672.0 696.0 672.2 696.0 672.5C696.0 672.7 696.5 672.9 697.0 672.9C698.0 672.8 698.3 672.0 698.1 669.9C698.0 669.3 698.4 669.0 699.0 669.0C699.6 669.0 700.0 669.2 700.0 669.5C700.0 669.7 700.5 670.0 701.0 670.1C702.1 670.2 702.1 670.2 701.1 671.2C699.5 672.8 698.6 673.5 698.1 673.5C697.9 673.5 696.8 674.0 695.8 674.5C694.7 675.0 693.1 675.5 692.3 675.5C690.9 675.4 690.8 675.4 691.9 675.0ZM382.0 674.0C382.0 673.8 381.5 673.4 380.9 673.2C379.0 672.6 376.1 670.3 375.8 669.1C375.3 667.5 375.4 667.3 376.0 667.1C376.4 666.9 376.5 667.2 376.2 668.0C376.0 668.8 376.1 669.0 376.4 668.8C376.8 668.6 377.0 668.7 377.0 669.0C377.0 669.8 379.4 672.1 380.0 671.8C380.2 671.6 380.7 671.9 381.0 672.4C381.4 673.0 381.6 673.1 381.8 672.6C382.0 672.3 382.5 672.0 383.0 672.0C383.7 672.0 384.0 671.6 384.0 670.8C384.0 669.1 384.5 668.0 385.3 668.0C385.8 668.0 386.0 668.6 386.0 670.0C386.0 671.7 385.8 672.0 385.0 672.0C384.4 672.0 384.0 672.3 384.0 672.8C384.0 673.4 383.7 673.5 382.9 673.2C381.9 672.9 381.8 672.9 382.4 673.7C382.9 674.2 382.9 674.5 382.6 674.5C382.3 674.5 382.0 674.3 382.0 674.0ZM702.3 669.2C702.2 669.0 702.0 668.5 702.0 668.0C702.0 667.6 701.5 666.9 701.0 666.5C700.5 666.1 700.0 665.5 700.0 665.1C700.0 664.4 699.2 664.3 698.7 665.0C698.5 665.4 698.2 665.4 697.8 665.0C697.4 664.6 697.4 664.3 698.0 664.0C698.4 663.8 698.6 663.4 698.4 663.2C698.1 663.0 697.7 663.1 697.4 663.4C696.5 664.3 696.0 664.1 696.0 663.1C696.0 662.4 695.5 662.2 694.1 662.1C693.1 662.0 692.2 661.7 692.1 661.5C692.0 661.2 691.5 661.0 691.0 661.0C690.5 661.0 690.0 660.7 689.8 660.3C689.7 659.8 689.2 659.6 688.8 659.8C688.3 660.0 688.0 659.9 688.0 659.6C688.0 659.2 687.5 659.0 687.0 659.0C686.5 659.0 686.0 659.2 686.0 659.5C686.0 659.8 686.5 660.0 687.0 660.0C687.7 660.0 688.0 660.3 688.0 661.0C688.0 661.7 687.7 662.0 687.0 662.0C686.4 662.0 686.0 661.7 686.0 661.2C686.0 660.4 685.4 659.7 683.5 658.4C682.3 657.5 682.3 657.5 683.4 657.5C684.0 657.5 684.6 657.7 684.7 657.9C684.9 658.2 685.9 658.5 687.0 658.6C688.2 658.8 689.5 659.2 689.9 659.6C690.4 660.0 691.5 660.5 692.4 660.7C696.3 661.4 697.0 661.6 697.0 662.0C697.0 662.2 697.5 662.5 698.1 662.7C699.2 663.0 702.5 665.7 702.5 666.3C702.5 666.5 702.9 666.9 703.4 667.3C704.2 667.9 704.2 668.0 703.5 668.7C703.0 669.2 702.5 669.4 702.3 669.2ZM381.0 664.4C381.0 664.1 380.5 664.0 379.9 664.2C378.8 664.5 378.8 664.4 380.0 663.5C380.7 663.0 381.7 662.5 382.2 662.5C382.7 662.5 383.6 662.1 384.3 661.6C385.0 661.0 386.3 660.5 387.4 660.3C388.4 660.1 389.6 659.6 390.0 659.3C391.1 658.3 395.1 658.0 394.8 658.9C394.6 659.3 394.5 659.7 394.5 659.8C394.5 659.9 394.2 660.0 393.8 660.0C393.3 660.0 393.0 659.8 393.0 659.5C393.0 659.2 392.8 659.0 392.5 659.0C392.2 659.0 392.0 659.5 392.0 660.0C392.0 660.9 391.7 661.0 389.1 661.0C386.8 661.0 386.1 661.2 385.5 662.0C385.1 662.5 384.5 663.0 384.2 663.0C383.9 663.0 383.5 663.5 383.4 664.0C383.1 665.1 381.0 665.4 381.0 664.4ZM397.0 657.3C397.3 656.9 398.4 656.5 399.4 656.4C400.4 656.2 402.3 655.8 403.5 655.5C404.7 655.2 407.2 654.7 409.0 654.5C410.8 654.2 412.9 653.9 413.8 653.8C415.3 653.5 414.7 653.9 412.1 654.7C411.5 654.9 411.0 655.3 411.0 655.6C411.0 655.8 409.6 656.0 408.0 656.0C406.4 656.0 405.0 656.2 405.0 656.5C405.0 656.7 403.9 656.9 402.6 656.9C401.3 656.9 400.2 657.2 400.1 657.5C400.0 657.8 399.1 658.0 398.1 658.0C396.7 658.0 396.5 657.9 397.0 657.3ZM677.3 657.1C675.6 657.0 674.1 656.6 673.6 656.2C673.2 655.8 672.0 655.5 670.8 655.5C666.8 655.5 664.1 655.0 663.9 654.0C663.6 653.2 663.8 653.2 666.2 653.8C667.6 654.2 669.6 654.5 670.6 654.5C672.3 654.5 674.2 655.2 675.0 656.0C675.1 656.1 676.5 656.3 678.0 656.4C679.5 656.5 681.1 656.8 681.5 657.0C682.1 657.4 682.0 657.5 681.2 657.4C680.7 657.3 678.9 657.2 677.3 657.1ZM656.0 653.5C656.0 653.2 654.9 653.0 653.5 653.0C651.5 653.0 651.0 652.8 651.0 652.2C651.0 651.5 651.4 651.4 653.4 651.7C654.7 651.9 657.3 652.2 659.1 652.3C661.5 652.6 662.5 652.8 662.5 653.3C662.5 654.1 660.2 654.3 659.7 653.5C659.5 653.2 659.1 653.2 658.5 653.5C657.3 654.1 656.0 654.1 656.0 653.5ZM640.0 651.6C640.0 651.3 639.3 651.0 638.5 651.0C637.7 651.0 637.0 650.8 637.0 650.6C637.0 649.9 634.3 648.8 634.1 649.5C633.9 650.2 632.3 650.1 631.6 649.4C631.1 648.9 630.9 648.9 630.4 649.4C629.7 650.1 627.0 650.2 627.0 649.5C627.0 649.2 626.8 649.0 626.5 649.0C626.2 649.0 626.0 649.4 626.0 649.8C626.0 650.5 625.9 650.5 625.0 649.9C624.4 649.6 624.0 649.0 624.0 648.8C624.0 648.2 635.0 648.3 635.7 649.0C636.7 649.7 641.5 650.5 645.2 650.5C647.3 650.5 649.1 650.7 649.2 651.0C649.6 651.6 648.5 652.3 648.1 651.7C647.7 651.1 643.7 651.2 641.4 651.8C640.5 652.0 640.0 651.9 640.0 651.6ZM612.1 648.6C612.2 647.7 612.0 647.2 611.4 647.1C610.9 647.0 610.5 647.2 610.5 647.5C610.5 647.8 609.9 648.0 609.2 648.0C608.6 648.0 608.0 647.8 608.0 647.6C608.0 647.4 606.6 647.2 605.0 647.1C603.3 647.1 602.0 647.2 602.0 647.5C602.0 648.2 600.7 648.1 599.4 647.4C598.6 646.9 598.3 646.9 598.1 647.4C597.8 648.3 596.0 648.2 596.0 647.2C596.0 646.3 612.7 646.1 613.2 647.0C613.4 647.3 614.1 647.5 614.8 647.5C615.5 647.5 616.0 647.8 616.0 648.2C616.0 648.7 615.6 649.0 615.0 649.0C614.5 649.0 614.0 649.2 614.0 649.5C614.0 649.8 613.5 650.0 613.0 650.0C612.1 650.0 612.0 649.7 612.1 648.6ZM512.2 647.0C512.6 645.9 510.6 644.5 510.1 645.4C509.7 645.9 502.5 646.1 500.9 645.7C498.0 644.9 501.8 644.5 511.4 644.6C517.4 644.6 521.7 644.7 521.1 644.9C520.5 645.0 520.0 645.3 520.0 645.5C520.0 645.8 519.1 646.0 518.0 646.0C516.9 646.0 516.0 645.8 516.0 645.5C516.0 645.2 515.5 645.0 515.0 645.0C514.2 645.0 514.0 645.3 514.0 646.5C514.0 647.7 513.8 648.0 513.0 648.0C512.2 648.0 512.0 647.8 512.2 647.0ZM524.0 646.5C524.0 645.7 523.7 645.0 523.4 644.8C523.0 644.7 532.4 644.5 544.2 644.5C575.1 644.4 578.6 644.5 580.4 645.1C582.2 645.6 582.6 647.0 581.0 647.0C580.4 647.0 580.0 646.7 580.0 646.2C580.0 645.7 579.7 645.6 578.8 645.8C578.1 645.9 577.1 645.8 576.5 645.5C575.2 644.8 573.0 645.3 573.0 646.3C573.0 646.7 572.8 647.0 572.5 647.0C572.2 647.0 572.0 646.5 572.0 646.0C572.0 645.0 570.2 644.5 569.9 645.5C569.8 645.8 569.1 645.8 568.0 645.4C566.7 644.9 566.3 644.9 566.1 645.4C565.9 646.1 564.0 646.2 564.0 645.4C564.0 645.1 563.7 645.0 563.1 645.3C561.9 645.8 556.3 645.9 556.0 645.4C555.8 645.2 554.9 645.3 554.0 645.6C552.7 646.1 552.3 646.1 552.1 645.6C551.9 644.9 548.0 644.8 548.0 645.5C548.0 645.9 546.2 646.0 542.5 645.9C539.5 645.8 537.0 645.6 537.0 645.5C537.0 645.0 530.8 645.2 530.0 645.7C529.6 646.0 529.2 646.0 529.1 645.6C528.8 644.7 526.0 644.8 526.0 645.8C526.0 646.5 524.9 648.0 524.3 648.0C524.1 648.0 524.0 647.3 524.0 646.5ZM349.1 565.9C349.1 550.8 348.9 538.5 348.7 538.5C348.6 538.5 348.0 538.7 347.5 539.0C346.9 539.3 346.5 539.3 346.5 539.1C346.5 538.5 348.6 537.9 349.1 538.4C349.3 538.6 349.4 551.1 349.4 566.0L349.2 593.2L349.1 565.9ZM773.2 569.5C773.2 563.0 773.4 557.8 773.6 558.1C773.7 558.4 774.0 558.5 774.2 558.4C774.3 558.3 774.9 558.6 775.4 559.0C775.9 559.4 776.6 559.8 777.0 559.9C777.4 560.0 777.9 560.3 778.1 560.7C778.3 561.0 778.5 561.0 778.5 560.8C778.5 560.5 778.9 560.7 779.4 561.1C779.9 561.5 780.9 562.1 781.6 562.5C782.4 562.9 783.0 563.4 783.0 563.6C783.0 563.9 783.2 563.9 783.5 563.8C783.7 563.6 784.3 563.8 784.7 564.3C785.1 564.7 785.5 564.9 785.5 564.7C785.5 564.5 785.9 564.7 786.4 565.1C786.9 565.5 787.9 566.1 788.6 566.5C789.4 566.9 790.0 567.4 790.0 567.6C790.0 567.9 790.2 567.9 790.4 567.8C790.6 567.7 791.6 568.0 792.5 568.6C794.2 569.6 794.2 569.6 793.0 570.6C791.5 571.8 784.9 575.2 784.4 575.1C784.2 575.0 784.0 575.2 784.0 575.5C784.0 576.0 778.0 579.3 777.4 579.1C777.2 579.0 777.0 579.2 777.0 579.4C777.0 579.6 776.3 580.2 775.5 580.7C774.4 581.3 774.0 581.4 774.0 580.9C774.0 580.4 773.9 580.4 773.6 580.8C773.4 581.1 773.2 576.0 773.2 569.5ZM819.7 481.8C819.7 436.6 819.8 418.3 819.9 440.9C819.9 463.6 819.9 500.5 819.9 522.9C819.8 545.4 819.7 526.9 819.7 481.8ZM825.4 479.6C825.5 433.5 825.4 395.4 825.2 395.0C825.0 394.6 824.8 393.8 824.7 393.2C824.7 392.2 823.6 388.4 823.0 386.8C822.3 385.0 821.9 383.8 821.7 383.2C821.7 382.9 820.8 381.5 819.8 380.0C818.8 378.6 818.0 377.2 818.0 377.0C818.0 376.4 809.4 366.6 809.2 367.0C809.1 367.1 808.2 366.5 807.2 365.5C806.1 364.5 805.2 363.8 805.1 363.9C805.0 364.0 804.4 363.7 803.8 363.2C803.2 362.7 802.4 362.2 802.0 362.1C801.6 362.0 801.1 361.7 800.9 361.4C800.8 361.1 800.6 361.0 800.4 361.1C800.1 361.3 796.0 358.8 796.0 358.4C796.0 358.1 795.8 358.1 795.5 358.2C795.3 358.4 794.7 358.2 794.3 357.7C793.9 357.3 793.5 357.1 793.5 357.3C793.5 357.5 793.1 357.3 792.6 356.9C792.1 356.5 791.1 355.9 790.4 355.5C789.6 355.1 789.0 354.6 789.0 354.4C789.0 354.1 788.8 354.1 788.5 354.2C788.3 354.4 787.7 354.2 787.3 353.7C786.9 353.3 786.5 353.1 786.5 353.3C786.5 353.5 786.1 353.3 785.6 352.9C785.1 352.5 784.1 351.9 783.4 351.5C782.6 351.1 782.0 350.6 782.0 350.4C782.0 350.1 781.8 350.1 781.5 350.2C781.3 350.4 780.8 350.2 780.4 349.8C780.0 349.5 779.5 349.1 779.2 349.1C779.0 349.0 778.3 348.6 777.7 348.1C777.1 347.6 776.4 347.2 776.0 347.1C775.6 347.0 775.1 346.7 774.9 346.4C774.8 346.1 774.4 345.9 774.2 345.9C773.4 345.9 770.0 343.8 770.0 343.4C770.0 343.1 769.8 343.1 769.5 343.2C769.3 343.4 768.7 343.2 768.3 342.7C767.9 342.3 767.5 342.1 767.5 342.3C767.5 342.5 767.1 342.3 766.6 341.9C766.1 341.5 765.1 340.9 764.4 340.5C763.6 340.1 763.0 339.6 763.0 339.4C763.0 339.1 762.8 339.1 762.5 339.2C762.3 339.4 761.8 339.2 761.4 338.8C761.0 338.5 760.6 338.2 760.4 338.2C760.2 338.2 759.5 337.8 758.9 337.2C758.2 336.7 757.4 336.2 757.0 336.1C756.6 336.0 756.1 335.7 755.9 335.4C755.8 335.1 755.4 334.9 755.2 334.9C754.4 334.9 751.0 332.8 751.0 332.4C751.0 332.1 750.8 332.1 750.5 332.2C750.3 332.4 749.7 332.2 749.3 331.7C748.9 331.3 748.5 331.1 748.5 331.3C748.5 331.5 748.1 331.3 747.6 330.9C747.1 330.5 746.1 329.9 745.4 329.5C744.6 329.1 744.0 328.6 744.0 328.4C744.0 328.1 743.8 328.1 743.5 328.2C743.3 328.4 742.7 328.2 742.3 327.7C741.9 327.3 741.5 327.1 741.5 327.3C741.5 327.5 741.1 327.3 740.6 326.9C740.1 326.5 739.1 325.9 738.4 325.5C737.6 325.1 737.0 324.6 737.0 324.4C737.0 324.1 736.8 324.1 736.5 324.2C736.3 324.4 735.7 324.2 735.3 323.7C734.9 323.3 734.4 323.0 734.3 323.1C734.2 323.2 733.5 322.8 732.9 322.2C732.2 321.7 731.4 321.2 731.0 321.1C730.6 321.0 730.1 320.7 729.9 320.4C729.8 320.1 729.5 319.9 729.3 320.0C728.7 320.1 725.0 317.8 725.0 317.4C725.0 317.1 724.8 317.1 724.5 317.2C724.3 317.4 723.7 317.2 723.3 316.7C722.9 316.3 722.5 316.1 722.5 316.3C722.5 316.5 722.1 316.3 721.6 315.9C721.1 315.5 720.1 314.9 719.4 314.5C718.6 314.1 718.0 313.6 718.0 313.4C718.0 313.1 717.8 313.1 717.5 313.2C717.3 313.4 716.7 313.2 716.3 312.7C715.9 312.3 715.5 312.1 715.5 312.3C715.5 312.5 715.1 312.3 714.6 311.9C714.1 311.5 713.1 310.9 712.4 310.5C711.6 310.1 711.0 309.6 711.0 309.4C711.0 309.1 710.8 309.1 710.5 309.2C710.3 309.4 709.7 309.2 709.3 308.7C708.9 308.3 708.4 308.0 708.2 308.0C708.1 308.1 707.4 307.7 706.8 307.2C706.2 306.7 705.4 306.2 705.0 306.1C704.6 306.0 704.1 305.7 703.9 305.4C703.8 305.1 703.5 304.9 703.3 305.0C702.7 305.1 699.0 302.8 699.0 302.4C699.0 302.1 698.8 302.1 698.5 302.2C698.3 302.4 697.7 302.2 697.3 301.7C696.9 301.3 696.5 301.1 696.5 301.3C696.5 301.5 696.1 301.3 695.6 300.9C695.1 300.5 694.1 299.9 693.4 299.5C692.6 299.1 692.0 298.6 692.0 298.4C692.0 298.1 691.8 298.1 691.5 298.2C691.3 298.4 690.7 298.2 690.3 297.7C689.9 297.3 689.4 297.0 689.2 297.0C689.1 297.1 688.4 296.7 687.8 296.2C687.2 295.7 686.4 295.2 686.0 295.1C685.6 295.0 685.1 294.7 684.9 294.4C684.8 294.1 684.5 293.9 684.3 294.0C683.7 294.1 680.0 291.8 680.0 291.4C680.0 291.1 679.8 291.1 679.5 291.2C679.3 291.4 678.7 291.2 678.3 290.7C677.9 290.3 677.5 290.1 677.5 290.3C677.5 290.5 677.1 290.3 676.6 289.9C676.1 289.5 675.1 288.9 674.4 288.5C673.6 288.1 673.0 287.6 673.0 287.4C673.0 287.1 672.8 287.1 672.5 287.2C672.3 287.4 671.7 287.2 671.3 286.7C670.9 286.3 670.5 286.1 670.5 286.3C670.5 286.5 670.1 286.3 669.6 285.9C669.1 285.5 668.1 284.9 667.4 284.5C666.6 284.1 666.0 283.6 666.0 283.4C666.0 283.1 665.8 283.1 665.5 283.2C665.3 283.4 664.7 283.1 664.2 282.6C663.7 282.1 663.2 281.8 663.1 281.9C663.0 282.0 662.4 281.7 661.8 281.2C661.2 280.7 660.4 280.2 660.0 280.1C659.6 280.0 659.1 279.7 658.9 279.4C658.8 279.1 658.5 278.9 658.3 279.0C657.7 279.1 654.0 276.8 654.0 276.4C654.0 276.1 653.8 276.1 653.5 276.2C653.3 276.4 652.7 276.2 652.3 275.7C651.9 275.3 651.5 275.1 651.5 275.3C651.5 275.5 651.1 275.3 650.6 274.9C650.1 274.5 649.1 273.9 648.4 273.5C647.6 273.1 647.0 272.6 647.0 272.4C647.0 272.1 646.8 272.1 646.5 272.2C646.3 272.4 645.7 272.2 645.3 271.7C644.9 271.3 644.5 271.1 644.5 271.3C644.5 271.5 644.1 271.3 643.6 270.9C643.1 270.5 642.1 269.9 641.4 269.5C640.6 269.1 640.0 268.6 640.0 268.4C640.0 268.1 639.8 268.1 639.5 268.2C639.3 268.4 638.7 268.1 638.2 267.6C637.7 267.1 637.2 266.8 637.1 266.9C637.0 267.0 636.4 266.7 635.8 266.2C635.2 265.7 634.4 265.2 634.0 265.1C633.6 265.0 633.1 264.7 632.9 264.4C632.8 264.1 632.5 263.9 632.3 264.0C631.7 264.1 628.0 261.8 628.0 261.4C628.0 261.1 627.8 261.1 627.5 261.2C627.3 261.4 626.7 261.2 626.3 260.7C625.9 260.3 625.5 260.1 625.5 260.3C625.5 260.5 625.1 260.3 624.6 259.9C624.1 259.5 623.1 258.9 622.4 258.5C621.6 258.1 621.0 257.6 621.0 257.4C621.0 257.1 620.8 257.1 620.5 257.2C620.3 257.4 619.7 257.1 619.2 256.6C618.7 256.1 618.2 255.8 618.1 255.9C618.0 256.0 617.4 255.7 616.8 255.2C616.2 254.7 615.4 254.2 615.0 254.1C614.6 254.0 614.1 253.7 613.9 253.4C613.8 253.1 613.5 252.9 613.3 253.0C612.7 253.1 609.0 250.8 609.0 250.4C609.0 250.1 608.8 250.1 608.5 250.2C608.3 250.4 607.7 250.2 607.3 249.7C606.9 249.3 606.5 249.1 606.5 249.3C606.5 249.5 606.1 249.3 605.6 248.9C605.1 248.5 604.1 247.9 603.4 247.5C602.6 247.1 602.0 246.6 602.0 246.4C602.0 246.1 601.8 246.1 601.5 246.2C601.3 246.4 600.7 246.2 600.3 245.7C599.9 245.3 599.5 245.1 599.5 245.3C599.5 245.5 599.1 245.3 598.6 245.0C597.1 243.7 595.6 243.0 594.5 243.0C593.0 243.0 593.3 242.4 595.4 241.1C605.1 235.2 606.6 234.5 608.5 234.5C609.3 234.5 610.1 234.3 610.2 234.1C610.5 233.6 617.6 233.9 618.0 234.4C618.1 234.6 618.8 234.8 619.5 234.9C620.2 235.0 620.8 235.3 620.9 235.6C621.0 235.8 621.3 235.9 621.5 235.7C621.7 235.6 622.3 235.9 622.8 236.4C623.3 236.9 623.8 237.2 623.9 237.1C624.0 237.0 624.6 237.3 625.2 237.8C625.8 238.3 626.6 238.8 627.0 238.9C627.4 239.0 627.9 239.3 628.1 239.7C628.3 240.0 628.5 240.0 628.5 239.8C628.5 239.5 628.9 239.7 629.4 240.1C629.9 240.5 630.9 241.1 631.6 241.5C632.4 241.9 633.0 242.4 633.0 242.6C633.0 242.9 633.2 242.9 633.5 242.8C633.7 242.6 634.3 242.8 634.7 243.3C635.1 243.7 635.5 243.9 635.5 243.7C635.5 243.5 635.9 243.7 636.4 244.1C636.9 244.5 637.9 245.1 638.6 245.5C639.4 245.9 640.0 246.4 640.0 246.6C640.0 246.9 640.2 246.9 640.5 246.8C640.7 246.6 641.3 246.9 641.8 247.4C642.3 247.9 642.8 248.2 642.9 248.1C643.0 248.0 643.6 248.3 644.2 248.8C644.8 249.3 645.6 249.8 646.0 249.9C646.4 250.0 646.9 250.3 647.1 250.7C647.3 251.0 647.5 251.0 647.5 250.8C647.5 250.5 647.9 250.7 648.4 251.1C648.9 251.5 649.9 252.1 650.6 252.5C651.4 252.9 652.0 253.4 652.0 253.6C652.0 253.9 652.2 253.9 652.5 253.8C652.7 253.6 653.3 253.8 653.7 254.3C654.1 254.7 654.5 254.9 654.5 254.7C654.5 254.5 654.9 254.7 655.4 255.1C655.9 255.5 656.9 256.1 657.6 256.5C658.4 256.9 659.0 257.4 659.0 257.6C659.0 257.9 659.2 257.9 659.5 257.8C659.7 257.6 660.2 257.8 660.6 258.2C661.0 258.5 661.4 258.8 661.7 258.9C661.9 258.9 662.6 259.3 663.2 259.8C663.8 260.3 664.6 260.8 665.0 260.9C665.4 261.0 665.9 261.3 666.1 261.7C666.3 262.0 666.5 262.0 666.5 261.8C666.5 261.5 666.9 261.7 667.4 262.1C667.9 262.5 668.9 263.1 669.6 263.5C670.4 263.9 671.0 264.4 671.0 264.6C671.0 264.9 671.2 264.9 671.5 264.8C671.7 264.6 672.3 264.8 672.7 265.3C673.1 265.7 673.5 265.9 673.5 265.7C673.5 265.5 673.9 265.7 674.4 266.1C674.9 266.5 675.9 267.1 676.6 267.5C677.4 267.9 678.0 268.4 678.0 268.6C678.0 268.9 678.2 268.9 678.5 268.8C678.7 268.6 679.3 268.9 679.8 269.4C680.3 269.9 680.8 270.2 680.9 270.1C681.0 270.0 681.6 270.3 682.2 270.8C682.8 271.3 683.6 271.8 684.0 271.9C684.4 272.0 684.9 272.3 685.1 272.7C685.3 273.0 685.5 273.0 685.5 272.8C685.5 272.5 685.9 272.7 686.4 273.1C686.9 273.5 687.9 274.1 688.6 274.5C689.4 274.9 690.0 275.4 690.0 275.6C690.0 275.9 690.2 275.9 690.5 275.8C690.7 275.6 691.3 275.8 691.7 276.3C692.1 276.7 692.6 277.0 692.8 277.0C692.9 276.9 693.6 277.3 694.2 277.8C694.8 278.3 695.6 278.8 696.0 278.9C696.4 279.0 696.9 279.3 697.1 279.6C697.2 279.9 697.5 280.1 697.7 280.0C698.3 279.9 702.0 282.2 702.0 282.6C702.0 282.9 702.2 282.9 702.5 282.8C702.7 282.6 703.3 282.8 703.7 283.3C704.1 283.7 704.5 283.9 704.5 283.7C704.5 283.5 704.9 283.7 705.4 284.1C705.9 284.5 706.9 285.1 707.6 285.5C708.4 285.9 709.0 286.4 709.0 286.6C709.0 286.9 709.2 286.9 709.5 286.8C709.7 286.6 710.3 286.8 710.7 287.3C711.1 287.7 711.6 288.0 711.8 288.0C711.9 287.9 712.6 288.3 713.2 288.8C713.8 289.3 714.6 289.8 715.0 289.9C715.4 290.0 715.9 290.3 716.1 290.6C716.2 290.9 716.5 291.1 716.7 291.0C717.3 290.9 721.0 293.2 721.0 293.6C721.0 293.9 721.2 293.9 721.5 293.8C721.7 293.6 722.3 293.8 722.7 294.3C723.1 294.7 723.5 294.9 723.5 294.7C723.5 294.5 723.9 294.7 724.4 295.1C724.9 295.5 725.9 296.1 726.6 296.5C727.4 296.9 728.0 297.4 728.0 297.6C728.0 297.9 728.2 297.9 728.5 297.8C728.7 297.6 729.3 297.8 729.7 298.3C730.1 298.7 730.6 299.0 730.7 298.9C730.8 298.8 731.5 299.2 732.1 299.8C732.8 300.3 733.6 300.8 734.0 300.9C734.4 301.0 734.9 301.3 735.1 301.6C735.2 301.9 735.5 302.1 735.7 302.0C736.3 301.9 740.0 304.2 740.0 304.6C740.0 304.9 740.2 304.9 740.5 304.8C740.7 304.6 741.3 304.8 741.7 305.3C742.1 305.7 742.5 305.9 742.5 305.7C742.5 305.5 742.9 305.7 743.4 306.1C743.9 306.5 744.9 307.1 745.6 307.5C746.4 307.9 747.0 308.4 747.0 308.6C747.0 308.9 747.2 308.9 747.5 308.8C747.7 308.6 748.3 308.8 748.7 309.3C749.1 309.7 749.6 310.0 749.7 309.9C749.8 309.8 750.5 310.2 751.1 310.8C751.8 311.3 752.6 311.8 753.0 311.9C753.4 312.0 753.9 312.3 754.1 312.6C754.2 312.9 754.6 313.1 754.8 313.1C755.6 313.1 759.0 315.2 759.0 315.6C759.0 315.9 759.2 315.9 759.5 315.8C759.7 315.6 760.3 315.8 760.7 316.3C761.1 316.7 761.5 316.9 761.5 316.7C761.5 316.5 761.9 316.7 762.4 317.1C762.9 317.5 763.9 318.1 764.6 318.5C765.4 318.9 766.0 319.4 766.0 319.6C766.0 319.9 766.2 319.9 766.5 319.8C766.7 319.6 767.3 319.9 767.8 320.4C768.3 320.9 768.8 321.2 769.0 321.1C769.1 321.1 769.7 321.4 770.3 321.9C770.9 322.4 771.6 322.8 772.0 322.9C772.4 323.0 772.9 323.3 773.1 323.6C773.2 323.9 773.5 324.1 773.7 324.0C774.3 323.9 778.0 326.2 778.0 326.6C778.0 326.9 778.2 326.9 778.5 326.8C778.7 326.6 779.3 326.8 779.7 327.3C780.1 327.7 780.5 327.9 780.5 327.7C780.5 327.5 780.9 327.7 781.4 328.1C781.9 328.5 782.9 329.1 783.6 329.5C784.4 329.9 785.0 330.4 785.0 330.6C785.0 330.9 785.2 330.9 785.5 330.8C785.7 330.6 786.3 330.9 786.8 331.4C787.3 331.9 787.7 332.1 787.8 332.0C787.9 331.9 788.5 332.2 789.1 332.8C789.8 333.3 790.6 333.8 791.0 333.9C791.4 334.0 791.9 334.3 792.1 334.6C792.2 334.9 792.4 335.0 792.6 334.9C792.9 334.7 797.0 337.2 797.0 337.6C797.0 337.9 797.2 337.9 797.5 337.8C797.7 337.6 798.3 337.8 798.7 338.3C799.1 338.7 799.5 338.9 799.5 338.7C799.5 338.5 799.9 338.7 800.4 339.1C800.9 339.5 801.9 340.1 802.6 340.5C803.4 340.9 804.0 341.4 804.0 341.6C804.0 341.9 804.2 341.9 804.5 341.8C804.7 341.6 805.3 341.9 805.8 342.4C806.3 342.9 806.7 343.1 806.8 343.0C806.9 342.9 807.5 343.2 808.1 343.8C808.8 344.3 809.6 344.8 810.0 344.9C810.4 345.0 810.9 345.3 811.1 345.6C811.2 345.9 811.5 346.1 811.7 346.0C812.3 345.9 816.0 348.2 816.0 348.6C816.0 348.9 816.2 348.9 816.5 348.8C816.7 348.6 817.3 348.8 817.7 349.3C818.1 349.7 818.5 349.9 818.5 349.7C818.5 349.5 818.9 349.7 819.4 350.1C819.9 350.5 820.9 351.1 821.6 351.5C822.4 351.9 823.0 352.4 823.0 352.6C823.0 352.9 823.2 352.9 823.5 352.8C823.7 352.6 824.3 352.9 824.8 353.4C825.3 353.9 825.7 354.1 825.8 354.0C825.9 353.9 826.4 354.2 827.1 354.8C827.7 355.3 828.4 355.8 828.6 355.9C831.1 356.5 840.8 365.6 840.2 366.7C840.0 367.0 840.0 367.1 840.2 366.9C840.9 366.3 847.0 376.7 846.3 377.4C846.1 377.5 846.4 378.2 846.8 378.9C847.2 379.5 847.5 380.2 847.3 380.4C847.2 380.5 847.3 381.1 847.6 381.6C847.8 382.1 848.2 383.6 848.3 384.9C848.4 386.2 848.7 387.6 848.8 387.9C849.2 389.2 849.0 540.6 848.6 541.2C848.4 541.5 848.1 542.4 848.1 543.2C848.0 544.1 847.8 544.8 847.5 544.9C847.2 545.0 847.1 545.3 847.3 545.5C847.4 545.7 847.2 546.2 846.8 546.6C846.5 547.0 846.1 547.5 846.1 547.8C845.9 548.8 841.0 553.5 840.4 553.2C840.1 553.0 840.0 553.1 840.2 553.3C840.5 553.8 838.1 555.3 837.3 555.1C837.1 555.0 837.0 555.2 837.2 555.4C837.5 555.9 835.1 557.3 834.3 557.1C834.1 557.0 834.0 557.2 834.2 557.4C834.5 557.9 832.1 559.3 831.3 559.1C831.1 559.0 831.0 559.2 831.2 559.4C831.5 559.9 829.0 561.3 828.2 561.0C828.0 561.0 827.9 561.1 828.1 561.3C828.4 561.6 826.0 563.5 825.4 563.5C825.3 563.5 825.3 525.8 825.4 479.6ZM262.0 562.6C262.0 562.3 261.8 562.0 261.5 562.0C261.0 562.0 256.4 559.0 255.9 558.4C255.8 558.1 255.5 558.0 255.4 558.1C255.2 558.2 254.4 557.7 253.7 557.0C252.9 556.3 252.2 555.9 252.2 556.0C252.1 556.1 251.6 555.8 250.9 555.2C250.3 554.7 249.6 554.2 249.3 554.2C249.1 554.1 248.4 553.6 247.7 553.1C247.0 552.5 246.4 552.1 246.3 552.1C246.2 552.2 245.4 551.7 244.7 551.0C243.9 550.3 243.2 549.9 243.2 550.0C243.1 550.3 236.3 546.0 235.9 545.3C235.7 545.0 235.5 544.9 235.5 545.2C235.5 546.1 232.0 541.3 231.7 540.1C231.6 539.3 231.2 538.4 231.0 537.9C230.3 536.6 229.9 286.4 230.6 280.6C230.8 278.9 231.2 276.9 231.5 276.2C231.8 275.5 231.9 274.8 231.8 274.6C231.7 274.5 231.8 273.7 232.1 272.8C232.3 272.0 232.7 270.6 232.8 269.8C233.0 268.9 233.2 268.1 233.4 268.0C233.6 267.9 233.8 267.2 233.9 266.5C234.0 265.8 234.4 265.1 234.7 264.9C235.0 264.7 235.1 264.5 234.9 264.5C234.6 264.5 234.7 264.0 235.0 263.5C235.3 262.9 235.7 261.9 235.8 261.3C235.9 260.7 236.2 260.2 236.5 260.1C236.8 260.0 236.9 259.7 236.7 259.5C236.6 259.3 236.8 258.8 237.1 258.4C237.5 258.0 237.8 257.4 237.9 257.0C238.0 256.6 238.3 256.2 238.5 256.1C238.8 256.0 238.9 255.7 238.7 255.5C238.6 255.3 238.8 254.7 239.3 254.3C239.7 253.9 240.0 253.4 240.0 253.2C239.9 253.1 240.4 252.4 240.9 251.7C241.5 251.0 242.0 250.3 242.0 250.1C242.0 249.9 242.4 249.3 242.9 248.8C243.4 248.2 243.8 247.6 243.9 247.4C244.3 245.7 255.4 233.9 258.5 231.7C259.5 231.0 261.1 229.8 262.2 229.0C264.6 227.3 269.1 224.8 269.6 224.9C269.8 225.0 270.0 224.8 270.0 224.6C270.0 224.3 271.3 223.4 272.9 222.5C274.5 221.7 277.0 220.2 278.6 219.3C280.2 218.3 281.6 217.7 281.7 217.9C281.9 218.0 282.0 217.9 282.0 217.7C282.0 217.4 283.3 216.4 284.9 215.5C286.5 214.7 289.0 213.2 290.6 212.2C292.2 211.3 293.5 210.7 293.5 210.9C293.5 211.1 293.7 211.0 293.9 210.7C294.5 209.7 304.9 203.7 305.6 203.9C305.8 204.0 306.0 203.8 306.0 203.6C306.0 203.3 307.3 202.4 308.9 201.5C310.5 200.7 313.0 199.2 314.6 198.2C316.2 197.3 317.5 196.7 317.5 196.9C317.5 197.1 317.7 197.0 317.9 196.7C318.5 195.7 328.9 189.7 329.6 189.9C329.8 190.0 330.0 189.8 330.0 189.6C330.0 189.3 331.3 188.4 332.9 187.5C334.5 186.7 337.0 185.2 338.6 184.2C340.2 183.3 341.5 182.7 341.5 182.9C341.5 183.1 341.7 183.0 341.9 182.7C342.5 181.7 352.9 175.7 353.6 175.9C353.8 176.0 354.0 175.8 354.0 175.6C354.0 175.3 355.3 174.4 356.9 173.5C358.5 172.7 361.0 171.2 362.6 170.2C364.2 169.3 365.5 168.7 365.5 168.9C365.5 169.1 365.7 169.0 365.9 168.7C366.5 167.7 376.9 161.7 377.6 161.9C377.8 162.0 378.0 161.8 378.0 161.5C378.0 161.2 379.3 160.3 380.9 159.5C382.5 158.6 385.0 157.2 386.6 156.3C388.2 155.4 389.6 154.7 389.7 154.9C389.9 155.0 390.0 154.9 390.0 154.6C390.0 154.3 391.3 153.3 392.9 152.5C394.5 151.6 397.2 150.1 399.0 149.0C400.8 147.9 403.5 146.3 405.0 145.5C406.5 144.6 409.2 143.1 411.0 142.0C412.8 140.9 415.5 139.3 417.0 138.5C418.5 137.6 421.0 136.2 422.6 135.3C424.2 134.4 425.6 133.7 425.7 133.9C425.9 134.0 426.0 133.9 426.0 133.6C426.0 133.3 427.3 132.3 428.9 131.5C430.5 130.6 433.2 129.1 435.0 128.0C436.8 126.9 439.5 125.3 441.0 124.5C442.5 123.6 445.0 122.2 446.6 121.3C448.2 120.4 449.6 119.7 449.7 119.9C449.9 120.0 450.0 119.9 450.0 119.6C450.0 119.3 451.3 118.3 452.9 117.5C454.5 116.6 457.2 115.1 459.0 114.0C460.8 112.9 463.5 111.3 465.0 110.5C466.5 109.6 469.2 108.1 471.0 107.0C472.8 105.9 475.5 104.3 477.0 103.5C478.5 102.6 481.2 101.1 483.0 100.0C484.8 98.9 487.5 97.3 489.0 96.5C490.5 95.6 493.0 94.2 494.6 93.3C496.2 92.4 497.6 91.7 497.7 91.9C497.9 92.0 498.0 91.9 498.0 91.6C498.0 91.3 499.3 90.3 500.9 89.5C502.5 88.6 505.0 87.2 506.6 86.3C508.2 85.4 509.6 84.7 509.7 84.9C509.9 85.0 510.0 84.9 510.0 84.6C510.0 84.3 511.3 83.3 512.9 82.5C514.5 81.6 517.0 80.2 518.6 79.3C520.2 78.4 521.6 77.7 521.7 77.9C521.9 78.0 522.0 77.9 522.0 77.6C522.0 77.3 523.3 76.3 524.9 75.5C526.5 74.6 529.2 73.1 531.0 72.0C532.8 70.9 535.5 69.3 537.0 68.5C538.5 67.6 541.0 66.2 542.6 65.3C544.2 64.4 545.6 63.7 545.7 63.9C545.9 64.0 546.0 63.9 546.0 63.6C546.0 63.3 547.3 62.3 548.9 61.5C550.5 60.6 553.0 59.2 554.6 58.3C556.2 57.4 557.6 56.7 557.7 56.9C557.9 57.0 558.0 56.9 558.0 56.6C558.0 56.3 559.3 55.3 560.9 54.5C562.5 53.6 565.0 52.2 566.6 51.3C568.2 50.4 569.6 49.7 569.7 49.9C569.9 50.0 570.0 49.9 570.0 49.6C570.0 49.3 571.3 48.3 572.9 47.5C574.5 46.6 577.0 45.2 578.6 44.3C580.2 43.4 581.6 42.7 581.7 42.9C581.9 43.0 582.0 42.9 582.0 42.6C582.0 42.1 587.7 38.8 588.1 39.1C588.2 39.1 588.8 38.9 589.5 38.5C591.6 37.4 596.3 37.0 600.0 37.7C602.1 38.0 608.0 41.0 608.0 41.6C608.0 41.9 608.2 41.9 608.5 41.8C608.7 41.6 609.3 41.8 609.7 42.3C610.1 42.7 610.6 43.0 610.8 43.0C610.9 42.9 611.6 43.3 612.2 43.8C612.8 44.3 613.6 44.8 614.0 44.9C614.4 45.0 614.9 45.3 615.1 45.7C615.3 46.0 615.5 46.0 615.5 45.8C615.5 45.5 615.9 45.7 616.4 46.1C616.9 46.5 617.9 47.1 618.6 47.5C619.4 47.9 620.0 48.4 620.0 48.6C620.0 48.9 620.2 48.9 620.5 48.8C620.7 48.6 621.3 48.8 621.7 49.3C622.1 49.7 622.6 50.0 622.8 50.0C622.9 49.9 623.6 50.3 624.2 50.8C624.8 51.3 625.6 51.8 626.0 51.9C626.4 52.0 626.9 52.3 627.1 52.7C627.3 53.0 627.5 53.0 627.5 52.8C627.5 52.5 627.9 52.7 628.4 53.1C628.9 53.5 629.6 54.0 630.1 54.2C631.3 54.6 631.3 55.7 630.1 55.4C629.6 55.2 628.8 55.4 628.2 55.8C627.7 56.2 627.0 56.5 626.5 56.5C625.7 56.5 620.3 59.3 613.5 63.3C607.1 67.0 604.8 68.2 604.4 68.1C604.2 68.0 604.0 68.2 604.0 68.4C604.0 68.9 597.9 72.3 597.4 72.1C597.2 72.1 597.0 72.2 597.0 72.4C597.0 72.9 590.9 76.3 590.4 76.1C590.2 76.1 590.0 76.2 590.0 76.4C590.0 76.9 583.9 80.3 583.4 80.1C583.2 80.1 583.0 80.2 583.0 80.4C583.0 80.9 576.9 84.3 576.4 84.1C576.2 84.1 576.0 84.2 576.0 84.4C576.0 84.9 569.9 88.3 569.4 88.1C569.2 88.1 569.0 88.2 569.0 88.4C569.0 88.9 562.9 92.3 562.4 92.1C562.2 92.1 562.0 92.2 562.0 92.4C562.0 92.9 555.9 96.3 555.4 96.1C555.2 96.1 555.0 96.2 555.0 96.5C555.0 97.0 549.0 100.3 548.4 100.1C548.2 100.0 548.0 100.2 548.0 100.5C548.0 100.7 546.6 101.7 544.9 102.6C543.2 103.6 540.1 105.3 538.2 106.4C536.2 107.5 534.4 108.3 534.3 108.1C534.1 108.0 534.0 108.1 534.0 108.4C534.0 109.0 528.1 112.3 527.4 112.1C527.2 112.0 527.0 112.2 527.0 112.5C527.0 112.8 525.7 113.7 524.1 114.5C522.5 115.4 519.6 117.0 517.5 118.3C515.4 119.5 512.3 121.3 510.5 122.2C508.7 123.2 505.6 125.0 503.5 126.2C497.2 129.9 494.8 131.2 494.4 131.1C494.2 131.0 494.0 131.2 494.0 131.4C494.0 131.9 487.9 135.3 487.4 135.1C487.2 135.1 487.0 135.2 487.0 135.4C487.0 135.9 480.9 139.3 480.4 139.1C480.2 139.1 480.0 139.2 480.0 139.4C480.0 139.9 473.9 143.3 473.4 143.1C473.2 143.1 473.0 143.2 473.0 143.4C473.0 143.9 466.9 147.3 466.4 147.1C466.2 147.1 466.0 147.2 466.0 147.4C466.0 147.9 459.9 151.3 459.4 151.1C459.2 151.1 459.0 151.2 459.0 151.4C459.0 151.9 452.9 155.3 452.4 155.1C452.2 155.1 452.0 155.2 452.0 155.4C452.0 155.9 446.3 159.1 445.7 159.0C445.5 158.9 445.2 159.1 445.1 159.4C444.8 159.9 443.3 160.8 434.9 165.6C433.0 166.6 429.9 168.4 428.0 169.5C419.6 174.3 417.5 175.4 417.3 175.1C417.1 175.0 417.0 175.1 417.0 175.4C417.0 175.7 415.7 176.7 414.1 177.5C412.5 178.4 409.6 180.0 407.5 181.3C405.4 182.5 402.3 184.3 400.5 185.2C398.7 186.2 395.6 188.0 393.5 189.2C387.2 192.9 384.8 194.2 384.4 194.1C384.2 194.0 384.0 194.2 384.0 194.4C384.0 194.9 377.9 198.3 377.4 198.1C377.2 198.1 377.0 198.2 377.0 198.4C377.0 198.9 370.9 202.3 370.4 202.1C370.2 202.1 370.0 202.2 370.0 202.4C370.0 202.9 363.9 206.3 363.4 206.1C363.2 206.1 363.0 206.2 363.0 206.4C363.0 206.9 356.9 210.3 356.4 210.1C356.2 210.1 356.0 210.2 356.0 210.4C356.0 210.9 349.9 214.3 349.4 214.1C349.2 214.1 349.0 214.2 349.0 214.4C349.0 214.9 342.9 218.3 342.4 218.1C342.2 218.1 342.0 218.2 342.0 218.4C342.0 218.9 335.9 222.3 335.4 222.1C335.2 222.1 335.0 222.2 335.0 222.4C335.0 222.9 328.9 226.3 328.4 226.1C328.2 226.1 328.0 226.2 328.0 226.5C328.0 227.0 322.0 230.3 321.4 230.1C321.2 230.0 321.0 230.2 321.0 230.5C321.0 230.7 319.6 231.7 317.9 232.6C316.2 233.6 313.1 235.3 311.2 236.4C309.2 237.5 307.4 238.3 307.3 238.1C307.1 238.0 307.0 238.1 307.0 238.4C307.0 238.7 305.7 239.7 304.1 240.5C295.2 245.3 288.5 249.6 286.8 251.4C286.3 252.0 285.6 252.3 285.3 252.2C285.0 252.0 284.9 252.0 285.1 252.2C285.3 252.4 284.4 253.5 283.1 254.5C281.7 255.5 280.1 257.1 279.5 258.0C278.8 258.8 277.4 260.6 276.2 262.0C273.5 265.3 272.4 267.0 271.5 268.6C271.1 269.4 270.6 270.0 270.4 270.0C270.1 270.0 270.1 270.2 270.2 270.5C270.4 270.7 270.3 271.1 270.0 271.2C269.5 271.6 267.0 276.7 267.0 277.5C267.0 277.8 266.8 278.0 266.5 278.0C266.2 278.0 266.1 278.2 266.2 278.5C266.4 278.7 266.2 279.2 265.9 279.6C265.5 280.0 265.2 280.8 265.1 281.5C265.0 282.2 264.8 282.9 264.6 283.0C264.4 283.1 264.2 283.8 264.1 284.5C264.0 285.2 263.7 286.0 263.5 286.2C263.3 286.5 263.1 287.4 263.1 288.2C263.0 289.0 262.8 289.9 262.5 290.3C262.2 290.7 262.0 291.1 262.2 291.4C262.3 291.6 262.1 293.2 261.7 295.0C260.6 300.2 260.7 556.2 261.8 560.0C262.2 561.4 262.4 562.7 262.3 562.9C262.1 563.0 262.0 562.9 262.0 562.6ZM266.2 452.2C266.2 397.0 266.3 374.3 266.4 401.8C266.4 429.4 266.4 474.6 266.4 502.3C266.3 530.1 266.2 507.5 266.2 452.2ZM310.7 449.0C308.0 447.9 308.0 448.3 308.0 418.7C308.0 391.3 308.0 391.3 309.3 389.7C310.0 388.8 311.0 388.0 311.4 388.0C312.4 388.0 316.6 386.0 317.9 384.9C318.4 384.5 320.3 383.4 322.2 382.5C324.2 381.5 326.5 380.2 327.5 379.6C328.4 379.0 330.6 377.8 332.3 377.0C334.1 376.1 335.6 375.3 335.7 375.0C335.9 374.8 337.9 373.6 340.2 372.5C342.6 371.4 344.6 370.2 344.8 370.0C345.1 369.4 352.3 366.0 353.1 366.0C353.5 366.0 354.3 366.5 355.0 367.0C356.2 367.9 356.2 367.9 356.4 396.2C356.5 428.1 356.8 426.0 352.3 427.5C351.3 427.8 349.6 428.7 348.6 429.3C347.6 430.0 345.4 431.2 343.7 432.0C341.9 432.9 340.4 433.7 340.3 434.0C340.1 434.2 338.3 435.3 336.1 436.3C334.0 437.3 331.9 438.5 331.5 438.8C331.1 439.1 329.0 440.3 326.9 441.4C324.7 442.5 322.6 443.7 322.2 444.0C321.6 444.5 312.0 449.6 311.8 449.5C311.8 449.5 311.3 449.2 310.7 449.0ZM384.5 437.9C380.7 434.7 380.8 426.0 384.6 419.8C385.1 418.9 385.7 417.8 385.9 417.2C386.5 416.0 392.8 410.0 393.6 410.0C393.8 410.0 395.1 409.3 396.2 408.5C397.4 407.7 398.6 407.0 398.8 407.0C398.9 407.0 400.1 406.3 401.2 405.5C402.4 404.7 403.6 404.0 403.8 404.0C403.9 404.0 405.1 403.3 406.2 402.5C407.4 401.7 408.6 401.0 408.8 401.0C408.9 401.0 409.7 400.6 410.4 400.1C411.7 399.2 412.5 398.7 417.4 395.9C418.4 395.4 419.5 394.7 419.8 394.5C420.0 394.3 421.1 393.6 422.1 393.1C427.0 390.3 427.8 389.8 429.1 388.9C429.8 388.4 430.6 388.0 430.7 388.0C430.9 388.0 432.1 387.3 433.2 386.5C434.4 385.7 435.6 385.0 435.8 385.0C435.9 385.0 437.1 384.3 438.2 383.5C439.4 382.7 440.6 382.0 440.8 382.0C440.9 382.0 441.7 381.6 442.4 381.1C443.2 380.5 444.6 379.7 445.6 379.1C449.4 377.0 449.8 376.7 450.0 376.5C450.1 376.4 450.9 375.9 451.8 375.5C452.6 375.1 454.2 374.2 455.3 373.4C456.5 372.6 457.6 372.0 457.8 372.0C457.9 372.0 459.1 371.3 460.2 370.5C461.4 369.7 462.6 369.0 462.8 369.0C462.9 369.0 464.1 368.3 465.2 367.5C466.4 366.7 467.6 366.0 467.8 366.0C467.9 366.0 468.7 365.6 469.4 365.1C470.2 364.5 471.6 363.7 472.6 363.1C476.4 361.0 476.8 360.7 477.0 360.5C477.1 360.4 477.7 360.0 478.2 359.7C480.6 358.4 481.8 357.7 482.0 357.5C482.1 357.4 482.9 356.9 483.8 356.5C484.6 356.1 486.2 355.2 487.3 354.4C488.5 353.6 489.6 353.0 489.7 353.0C489.9 353.0 491.1 352.3 492.2 351.5C493.4 350.7 494.6 350.0 494.8 350.0C494.9 350.0 496.1 349.3 497.2 348.5C498.4 347.7 499.6 347.0 499.8 347.0C499.9 347.0 500.7 346.6 501.4 346.1C502.2 345.5 503.6 344.7 504.6 344.1C508.4 342.0 508.8 341.7 509.0 341.5C509.1 341.4 509.9 340.9 510.8 340.5C511.6 340.1 513.2 339.2 514.3 338.4C515.5 337.6 516.6 337.0 516.8 337.0C516.9 337.0 518.1 336.3 519.2 335.5C520.4 334.7 521.6 334.0 521.8 334.0C521.9 334.0 523.1 333.3 524.2 332.5C525.4 331.7 526.6 331.0 526.8 331.0C526.9 331.0 527.7 330.6 528.4 330.1C529.2 329.5 530.6 328.6 531.6 328.1C532.7 327.5 534.3 326.5 535.4 325.9C536.4 325.4 537.8 324.5 538.6 323.9C539.3 323.4 540.2 323.0 540.5 323.0C540.8 323.0 541.0 322.8 541.0 322.6C541.0 322.4 541.7 321.9 542.6 321.5C543.5 321.2 545.2 320.2 546.3 319.4C547.5 318.6 548.6 318.0 548.8 318.0C548.9 318.0 550.1 317.3 551.4 316.4C555.6 313.5 563.0 314.8 563.0 318.4C563.0 318.7 563.3 319.4 563.6 320.0C564.2 321.0 563.4 328.7 562.5 329.8C562.3 330.0 561.8 331.1 561.5 332.2C560.3 335.8 555.2 341.7 551.6 343.6C550.9 343.9 550.1 344.4 550.0 344.5C549.9 344.6 549.2 345.1 548.6 345.4C547.9 345.8 546.6 346.5 545.7 347.0C544.8 347.6 543.2 348.5 542.1 349.1C541.1 349.6 539.7 350.5 538.9 351.1C538.2 351.6 537.4 352.0 537.3 352.0C537.1 352.0 535.9 352.7 534.8 353.5C533.6 354.3 532.4 355.0 532.2 355.0C532.1 355.0 530.9 355.7 529.8 356.5C528.6 357.3 527.4 358.0 527.2 358.0C527.1 358.0 526.3 358.4 525.6 358.9C524.8 359.5 523.4 360.4 522.4 360.9C521.3 361.5 519.7 362.4 518.8 363.0C517.8 363.6 516.2 364.5 515.1 365.1C514.1 365.6 512.7 366.5 511.9 367.1C511.2 367.6 510.4 368.0 510.3 368.0C510.1 368.0 508.9 368.7 507.7 369.5C506.6 370.3 505.4 371.0 505.2 371.0C505.1 371.0 503.9 371.7 502.8 372.5C501.6 373.3 500.4 374.0 500.2 374.0C500.1 374.0 499.3 374.4 498.6 374.9C497.3 375.8 496.5 376.3 491.6 379.1C490.6 379.6 489.5 380.3 489.2 380.5C489.0 380.7 487.9 381.4 486.9 381.9C482.0 384.7 481.2 385.2 479.9 386.1C479.2 386.6 478.4 387.0 478.3 387.0C478.1 387.0 476.9 387.7 475.8 388.5C474.6 389.3 473.4 390.0 473.2 390.0C473.1 390.0 471.9 390.7 470.8 391.5C469.6 392.3 468.4 393.0 468.2 393.0C468.1 393.0 467.3 393.4 466.6 393.9C465.3 394.8 464.5 395.3 459.6 398.1C458.6 398.6 457.5 399.3 457.2 399.5C457.0 399.7 455.9 400.4 454.9 400.9C450.0 403.7 449.2 404.2 447.9 405.1C447.2 405.6 446.4 406.0 446.3 406.0C446.1 406.0 444.9 406.7 443.8 407.5C442.6 408.3 441.4 409.0 441.2 409.0C441.1 409.0 439.9 409.7 438.8 410.5C437.6 411.3 436.4 412.0 436.2 412.0C436.1 412.0 435.3 412.4 434.6 412.9C433.8 413.5 432.4 414.3 431.4 414.9C427.6 417.0 427.2 417.3 427.0 417.5C426.9 417.6 426.1 418.1 425.2 418.5C424.4 418.9 422.8 419.8 421.7 420.6C420.5 421.4 419.4 422.0 419.2 422.0C419.1 422.0 417.9 422.7 416.8 423.5C415.6 424.3 414.4 425.0 414.2 425.0C414.1 425.0 412.9 425.7 411.8 426.5C410.6 427.3 409.4 428.0 409.2 428.0C409.1 428.0 408.3 428.4 407.6 428.9C406.8 429.5 405.4 430.4 404.4 430.9C403.3 431.5 401.7 432.5 400.6 433.1C399.6 433.6 398.2 434.5 397.4 435.1C396.7 435.6 395.9 436.0 395.6 436.0C395.3 436.0 395.0 436.2 394.9 436.4C393.9 438.7 386.6 439.7 384.5 437.9ZM712.2 400.5C712.2 388.8 712.3 384.0 712.4 389.9C712.5 395.7 712.5 405.3 712.4 411.1C712.3 417.0 712.2 412.2 712.2 400.5ZM579.2 336.0C579.2 293.5 579.3 276.1 579.4 297.4C579.4 318.6 579.4 353.4 579.4 374.6C579.3 395.9 579.2 378.5 579.2 336.0ZM573.7 335.0C573.7 294.2 573.8 277.5 573.9 297.9C573.9 318.3 573.9 351.7 573.9 372.1C573.8 392.5 573.7 375.8 573.7 335.0ZM675.7 380.5C675.7 367.7 675.8 362.5 675.9 368.9C676.0 375.3 676.0 385.7 675.9 392.1C675.8 398.5 675.7 393.3 675.7 380.5ZM383.8 367.0C378.4 361.6 382.7 348.6 392.4 340.9C393.0 340.4 393.6 340.0 393.8 340.0C394.0 340.0 394.7 339.6 395.4 339.1C396.2 338.5 397.6 337.6 398.6 337.1C399.7 336.5 401.3 335.6 402.2 335.0C403.2 334.4 404.8 333.5 405.9 332.9C406.9 332.4 408.3 331.5 409.1 330.9C409.8 330.4 410.6 330.0 410.8 330.0C410.9 330.0 411.7 329.6 412.4 329.1C413.2 328.5 414.6 327.6 415.6 327.1C416.7 326.5 418.3 325.6 419.2 325.0C420.2 324.4 421.8 323.5 422.9 322.9C423.9 322.4 425.3 321.5 426.1 320.9C426.8 320.4 427.6 320.0 427.7 320.0C427.9 320.0 429.1 319.3 430.2 318.5C431.4 317.7 432.6 317.0 432.8 317.0C432.9 317.0 433.7 316.6 434.4 316.1C435.2 315.5 436.6 314.7 437.6 314.1C441.4 312.0 441.8 311.7 442.0 311.5C442.1 311.4 442.9 310.9 443.8 310.5C444.6 310.1 446.2 309.2 447.3 308.4C448.5 307.6 449.6 307.0 449.8 307.0C449.9 307.0 450.7 306.6 451.4 306.1C452.2 305.5 453.6 304.7 454.6 304.1C458.4 302.0 458.8 301.7 459.0 301.5C459.1 301.4 459.9 300.9 460.8 300.5C461.6 300.1 463.2 299.2 464.3 298.4C465.5 297.6 466.6 297.0 466.8 297.0C466.9 297.0 468.1 296.3 469.2 295.5C470.4 294.7 471.6 294.0 471.8 294.0C471.9 294.0 472.7 293.6 473.4 293.1C474.2 292.5 475.6 291.7 476.6 291.1C480.4 289.0 480.8 288.7 481.0 288.5C481.1 288.4 481.9 287.9 482.8 287.5C483.6 287.1 485.2 286.2 486.3 285.4C487.5 284.6 488.6 284.0 488.8 284.0C488.9 284.0 489.7 283.6 490.4 283.1C491.2 282.5 492.6 281.6 493.6 281.1C494.7 280.5 496.3 279.6 497.2 279.0C498.2 278.4 499.8 277.5 500.9 276.9C501.9 276.4 503.3 275.5 504.1 274.9C504.8 274.4 505.6 274.0 505.7 274.0C505.9 274.0 507.1 273.3 508.2 272.5C509.4 271.7 510.6 271.0 510.8 271.0C510.9 271.0 511.7 270.6 512.4 270.1C513.2 269.5 514.6 268.7 515.6 268.1C519.4 266.0 519.8 265.7 520.0 265.5C520.1 265.4 520.9 264.9 521.8 264.5C522.6 264.1 524.2 263.2 525.3 262.4C526.5 261.6 527.6 261.0 527.8 261.0C527.9 261.0 528.7 260.6 529.4 260.1C530.2 259.5 531.6 258.7 532.6 258.1C536.4 256.0 536.8 255.7 537.0 255.5C537.1 255.4 537.8 254.9 538.4 254.6C539.1 254.2 540.4 253.5 541.3 253.0C542.2 252.4 543.8 251.5 544.9 250.9C545.9 250.4 547.3 249.5 548.1 248.9C548.8 248.4 549.6 248.0 549.8 248.0C549.9 248.0 550.7 247.6 551.4 247.1C552.2 246.5 553.6 245.7 554.6 245.1C558.4 243.0 558.8 242.7 559.0 242.5C559.1 242.4 559.9 241.9 560.8 241.5C561.6 241.1 563.2 240.2 564.3 239.4C565.5 238.6 566.6 238.0 566.8 238.0C566.9 238.0 567.7 237.6 568.4 237.1C569.7 236.2 570.5 235.7 575.4 232.9C576.4 232.4 577.5 231.7 577.8 231.5C578.0 231.3 579.1 230.6 580.1 230.1C581.2 229.5 582.8 228.5 583.8 228.0C585.9 226.8 589.2 226.7 591.4 227.8C593.0 228.6 595.3 232.6 594.8 233.8C594.6 234.2 594.9 234.5 595.4 234.5C595.9 234.5 595.7 234.8 594.7 235.4C593.8 235.9 591.9 236.9 590.4 237.7C589.0 238.5 587.6 239.2 587.4 239.1C587.2 239.0 587.0 239.2 587.0 239.5C587.0 240.0 583.5 242.0 583.0 241.8C582.8 241.8 582.1 242.4 581.3 243.1C580.5 243.8 579.6 244.3 579.3 244.1C579.1 244.0 579.0 244.0 579.1 244.3C579.4 244.9 577.7 246.5 577.2 246.1C577.0 245.9 577.0 246.0 577.1 246.3C577.3 246.6 576.9 247.4 576.2 248.2C575.5 248.9 575.1 249.5 575.2 249.5C575.3 249.5 575.0 251.1 574.4 253.1C573.9 255.1 573.5 257.6 573.5 258.8C573.5 261.1 572.6 262.0 567.4 264.9C566.4 265.5 565.1 266.2 564.4 266.6C563.8 266.9 563.1 267.4 563.0 267.5C562.9 267.6 562.1 268.1 561.2 268.5C560.4 268.9 558.8 269.8 557.7 270.6C556.5 271.4 555.4 272.0 555.2 272.0C555.1 272.0 553.9 272.7 552.8 273.5C551.6 274.3 550.4 275.0 550.2 275.0C550.1 275.0 549.3 275.4 548.6 275.9C547.8 276.5 546.4 277.4 545.4 277.9C544.3 278.5 542.7 279.4 541.8 280.0C540.8 280.6 539.2 281.5 538.1 282.1C537.1 282.6 535.7 283.5 534.9 284.1C534.2 284.6 533.4 285.0 533.2 285.0C533.1 285.0 532.3 285.4 531.6 285.9C530.8 286.5 529.4 287.3 528.4 287.9C524.6 290.0 524.2 290.3 524.0 290.5C523.9 290.6 523.1 291.1 522.2 291.5C521.4 291.9 519.8 292.8 518.7 293.6C517.5 294.4 516.4 295.0 516.2 295.0C516.1 295.0 514.9 295.7 513.8 296.5C512.6 297.3 511.4 298.0 511.2 298.0C511.1 298.0 510.3 298.4 509.6 298.9C508.8 299.5 507.4 300.3 506.4 300.9C502.6 303.0 502.2 303.3 502.0 303.5C501.9 303.6 501.1 304.1 500.2 304.5C499.4 304.9 497.8 305.8 496.7 306.6C495.5 307.4 494.4 308.0 494.2 308.0C494.1 308.0 492.9 308.7 491.7 309.5C490.6 310.3 489.4 311.0 489.2 311.0C489.1 311.0 488.3 311.4 487.6 311.9C486.8 312.5 485.4 313.3 484.4 313.9C480.6 316.0 480.2 316.3 480.0 316.5C479.9 316.6 479.1 317.1 478.2 317.5C477.4 317.9 475.8 318.8 474.7 319.6C473.5 320.4 472.4 321.0 472.2 321.0C472.1 321.0 471.3 321.4 470.6 321.9C469.3 322.8 468.5 323.3 463.6 326.1C462.6 326.6 461.5 327.3 461.2 327.5C461.0 327.7 459.9 328.4 458.9 328.9C454.0 331.7 453.2 332.2 451.9 333.1C451.2 333.6 450.4 334.0 450.2 334.0C450.1 334.0 449.3 334.4 448.6 334.9C447.8 335.5 446.4 336.4 445.4 336.9C444.3 337.5 442.7 338.4 441.8 339.0C440.8 339.6 439.2 340.5 438.1 341.1C437.1 341.6 435.7 342.5 434.9 343.1C434.2 343.6 433.4 344.0 433.3 344.0C433.1 344.0 431.9 344.7 430.8 345.5C429.6 346.3 428.4 347.0 428.2 347.0C428.1 347.0 427.3 347.4 426.6 347.9C425.8 348.5 424.4 349.4 423.4 349.9C422.3 350.5 420.7 351.4 419.8 352.0C418.8 352.6 417.2 353.5 416.1 354.1C415.1 354.6 413.7 355.5 412.9 356.1C412.2 356.6 411.4 357.0 411.2 357.0C411.1 357.0 410.3 357.4 409.6 357.9C408.8 358.5 407.4 359.3 406.4 359.9C402.6 362.0 402.2 362.3 402.0 362.5C401.9 362.6 401.2 363.1 400.6 363.4C399.9 363.8 398.6 364.6 397.6 365.1C389.2 369.9 386.9 370.2 383.8 367.0ZM297.9 301.2C297.4 301.0 297.0 300.7 297.0 300.4C297.0 300.2 296.8 300.1 296.6 300.2C296.3 300.3 295.5 299.8 294.7 299.0C294.0 298.2 293.5 297.5 293.8 297.5C294.0 297.5 293.9 297.3 293.4 297.0C291.3 295.7 290.9 286.6 292.9 282.7C296.2 276.3 304.3 274.4 309.1 278.9C309.9 279.6 310.4 280.3 310.2 280.5C310.1 280.7 310.3 281.0 310.8 281.2C311.2 281.3 311.5 282.0 311.5 282.7C311.5 283.4 311.8 284.1 312.1 284.3C313.1 284.9 312.3 293.3 311.1 295.0C310.5 295.8 310.0 296.7 310.0 296.9C310.0 299.6 302.3 302.3 297.9 301.2ZM340.2 278.7C339.7 278.6 338.7 278.4 338.1 278.2C330.8 276.7 329.0 262.4 335.3 256.4C339.1 252.9 345.7 252.5 348.1 255.7C348.2 255.9 348.6 256.0 348.8 255.9C349.1 255.8 349.9 257.1 350.8 258.8C355.3 267.9 348.8 280.4 340.2 278.7ZM378.2 255.7C374.2 254.8 370.3 247.3 371.2 242.4C371.4 241.5 371.6 240.3 371.7 239.7C372.9 233.3 380.2 228.8 385.6 231.2C387.8 232.1 391.0 235.4 391.3 237.0C391.4 237.7 391.7 238.6 392.0 239.0C393.1 241.2 391.0 251.0 389.4 251.0C389.2 251.0 389.1 251.2 389.2 251.4C390.4 253.3 382.0 256.5 378.2 255.7ZM650.0 245.9C649.4 245.5 649.4 245.4 650.1 245.7C651.0 246.0 651.0 242.9 651.0 186.5C651.0 141.6 650.9 127.0 650.4 127.3C650.1 127.5 650.0 127.4 650.2 127.1C650.4 126.8 650.8 126.5 651.0 126.5C651.3 126.5 651.5 149.3 651.5 186.5C651.5 219.5 651.3 246.5 651.1 246.5C650.9 246.5 650.4 246.2 650.0 245.9Z"/><path fill="#fff" fill-rule="evenodd" d="M550.0 691.6C550.0 691.4 545.4 691.2 539.9 691.1C518.0 691.1 510.2 690.9 510.0 690.5C509.8 690.2 509.0 690.2 508.0 690.5C505.1 691.3 490.5 690.5 485.4 689.2C484.7 689.0 484.0 689.1 483.8 689.5C483.3 690.3 482.0 690.1 482.0 689.2C482.0 688.8 481.6 688.5 481.0 688.5C480.4 688.5 480.0 688.7 480.0 689.0C480.0 689.8 478.2 689.6 477.3 688.7C476.6 688.1 476.3 688.0 475.9 688.4C475.1 689.2 469.2 689.2 468.8 688.4C468.6 687.9 468.5 687.9 468.1 688.4C467.8 688.9 467.0 689.0 465.4 688.8C464.2 688.6 462.1 688.3 460.6 688.2C458.8 688.0 458.0 687.7 458.0 687.2C458.0 686.8 457.6 686.5 457.0 686.5C456.4 686.5 456.0 686.8 456.0 687.2C456.0 688.1 454.2 688.3 453.9 687.5C453.8 687.3 451.5 687.0 448.8 686.8C442.2 686.5 438.9 686.1 438.3 685.5C438.0 685.2 436.7 685.0 435.3 685.0C433.4 685.0 433.0 684.9 433.2 684.2C433.4 683.8 433.6 683.2 433.8 682.8C434.0 682.3 433.9 682.0 433.6 682.0C433.1 682.0 432.2 683.9 432.4 684.6C432.5 684.8 431.4 684.9 430.1 684.8C428.8 684.7 427.4 684.6 426.9 684.6C426.4 684.5 426.0 684.2 426.0 683.8C426.0 683.3 425.8 683.0 425.5 683.0C425.2 683.0 425.0 683.2 425.0 683.5C425.0 684.1 422.6 684.2 422.4 683.5C422.3 683.3 420.6 682.9 418.5 682.8C412.8 682.3 410.3 681.9 410.0 681.4C409.8 681.2 408.4 681.0 406.9 680.9C405.1 680.9 403.8 680.6 403.5 680.2C403.1 679.8 402.7 679.6 402.4 679.8C402.2 679.9 402.0 679.8 402.0 679.5C402.0 679.2 401.1 679.0 400.0 679.0C399.0 679.0 398.0 678.8 397.9 678.5C397.8 678.2 397.2 678.2 396.1 678.5C394.6 678.9 394.4 678.8 394.1 678.0C394.0 677.3 393.2 677.0 390.7 676.7C388.7 676.5 387.3 676.1 387.1 675.7C386.9 675.3 385.9 674.9 384.9 674.8C383.7 674.8 382.5 674.2 381.5 673.4C380.7 672.6 379.8 672.0 379.5 672.0C378.7 672.0 377.0 670.4 377.0 669.6C377.0 669.2 376.8 669.1 376.5 669.2C375.4 669.9 376.0 666.4 377.1 665.4C378.8 664.0 381.7 662.8 381.9 663.4C382.0 663.8 382.4 664.0 382.8 664.0C383.3 664.0 383.5 663.7 383.3 663.1C383.0 662.2 384.7 660.7 385.5 661.2C385.7 661.4 386.3 661.1 386.7 660.7C387.2 660.3 387.8 660.0 388.2 660.2C388.6 660.3 389.1 660.2 389.3 660.0C390.1 659.2 392.7 659.0 393.1 659.6C393.4 660.1 393.6 660.1 393.8 659.7C394.4 658.2 395.4 657.5 397.5 657.2C398.7 657.1 400.1 656.7 400.5 656.5C400.9 656.3 402.0 656.2 403.0 656.2C404.0 656.3 404.9 656.2 405.0 655.9C405.2 655.7 406.6 655.4 408.2 655.3C409.8 655.1 411.9 654.7 412.8 654.3C413.7 653.8 415.9 653.3 417.6 653.2C419.3 653.1 421.9 652.7 423.2 652.4C425.1 652.0 425.7 652.0 425.9 652.4C426.2 653.2 427.0 653.1 427.0 652.3C427.0 651.3 427.7 651.1 432.8 651.0C435.2 651.0 438.2 650.6 439.4 650.2C441.3 649.6 446.6 649.0 450.9 648.9C451.5 648.9 452.3 649.3 452.7 649.7C453.2 650.5 453.4 650.5 454.2 649.6C454.9 648.8 455.5 648.6 456.5 648.8C457.3 649.0 458.0 648.9 458.2 648.6C458.4 648.2 459.6 648.0 460.9 648.0C462.2 648.0 464.0 647.8 465.0 647.5C467.3 646.8 480.7 646.8 480.9 647.5C481.2 648.3 482.0 648.1 482.0 647.2C482.0 646.6 482.4 646.5 484.0 646.8C485.1 646.9 486.0 646.9 486.0 646.7C486.0 646.4 487.3 646.2 488.8 646.3C490.4 646.3 492.9 646.1 494.5 645.9C497.5 645.4 515.4 645.0 516.4 645.4C517.1 645.6 517.2 647.0 516.5 647.0C516.2 647.0 516.0 647.2 516.0 647.5C516.0 647.8 516.5 648.0 517.1 648.0C517.9 648.0 518.1 647.8 517.9 646.8C517.6 645.4 520.9 644.3 524.1 644.8C525.0 644.9 537.9 645.1 552.8 645.2C584.7 645.4 591.7 645.8 592.5 647.1C592.8 647.5 593.1 647.5 593.6 647.1C594.0 646.9 595.6 646.7 597.2 646.8C598.9 646.8 603.0 647.0 606.2 647.0C609.5 647.0 613.0 647.3 614.0 647.5C615.0 647.7 617.5 648.0 619.7 648.2C622.2 648.4 623.9 648.7 624.5 649.2C625.6 650.2 626.0 650.2 626.0 649.2C626.0 648.6 626.2 648.6 627.8 649.2C628.7 649.6 629.5 649.7 629.5 649.5C629.5 648.8 636.0 649.3 638.5 650.2C639.9 650.6 642.7 651.0 645.6 651.1C648.9 651.1 650.7 651.4 651.1 651.8C651.4 652.3 652.3 652.4 653.8 652.2C655.3 652.0 656.0 652.0 656.0 652.4C656.0 652.7 656.8 653.0 657.8 653.0C658.8 653.0 660.0 653.2 660.6 653.6C661.4 654.0 661.7 653.9 662.0 653.4C662.4 652.9 662.7 652.9 663.7 653.5C664.4 653.8 665.6 654.1 666.3 654.1C667.1 654.1 667.9 654.3 668.0 654.6C668.2 654.8 669.5 655.1 670.9 655.1C672.3 655.1 673.5 655.4 673.5 655.6C673.5 655.8 674.4 656.0 675.6 656.0C676.7 656.0 678.4 656.2 679.2 656.5C680.1 656.7 681.4 657.1 682.1 657.2C682.8 657.4 683.7 657.8 684.1 658.2C684.5 658.6 685.8 659.0 687.0 659.2C690.3 659.6 692.0 660.1 692.0 660.6C692.0 660.8 692.5 661.0 693.2 661.0C693.9 661.0 694.6 661.2 694.8 661.5C694.9 661.8 695.5 662.0 696.0 662.0C696.6 662.0 697.0 662.2 697.0 662.5C697.0 662.8 697.4 663.0 697.8 663.0C698.3 663.0 698.5 663.3 698.3 663.9C698.0 664.6 698.3 664.8 699.7 664.9C702.0 664.9 703.0 665.9 702.8 668.2C702.7 670.2 701.8 671.5 701.3 670.5C700.8 669.7 700.0 669.9 700.0 670.8C700.0 671.8 698.8 673.0 697.8 673.0C697.4 673.0 697.0 673.2 697.0 673.5C697.0 674.0 695.3 674.6 693.3 674.8C692.5 674.8 691.7 675.1 691.6 675.4C691.4 675.7 690.6 676.1 689.7 676.3C688.9 676.5 687.2 677.2 685.9 677.8C684.0 678.7 683.1 678.8 681.9 678.5C680.8 678.2 680.2 678.2 679.7 678.7C678.7 679.7 676.3 680.4 672.5 680.7C670.8 680.9 668.7 681.4 667.9 681.8C667.1 682.2 666.2 682.5 665.9 682.4C665.2 682.3 664.7 682.4 656.0 683.8C647.9 685.2 647.0 685.3 645.9 684.8C645.5 684.6 644.8 684.8 644.4 685.2C643.4 686.2 640.2 686.3 639.8 685.4C639.6 684.9 639.5 684.9 639.2 685.3C638.0 686.8 634.7 687.3 626.4 687.1C624.6 687.1 623.5 687.3 623.5 687.6C623.5 687.9 622.8 688.0 621.9 687.9C621.0 687.8 618.7 688.0 616.8 688.3C614.8 688.7 611.8 689.0 610.0 689.0C600.0 688.9 596.0 689.0 596.0 689.5C596.0 690.1 594.2 690.2 593.9 689.6C593.6 688.7 591.0 688.4 590.7 689.3C590.3 690.1 583.0 690.3 583.0 689.4C583.0 689.2 582.8 689.0 582.4 689.0C582.1 689.0 582.0 689.3 582.2 689.7C582.6 690.8 569.9 691.4 553.6 691.1C552.7 691.1 552.0 691.3 552.0 691.5C552.0 691.8 551.5 692.0 551.0 692.0C550.5 692.0 550.0 691.8 550.0 691.6ZM526.0 687.5C526.0 686.3 525.8 686.0 525.0 686.0C524.3 686.0 524.0 685.7 524.0 685.0C524.0 684.3 523.7 684.0 523.0 684.0C522.3 684.0 522.0 684.3 522.0 685.0C522.0 685.7 521.7 686.0 521.0 686.0C519.7 686.0 519.8 687.7 521.1 687.9C521.7 688.0 522.0 687.8 522.0 687.0C522.0 686.3 522.3 686.0 523.0 686.0C523.8 686.0 524.0 686.3 524.0 687.5C524.0 688.7 524.2 689.0 525.0 689.0C525.8 689.0 526.0 688.7 526.0 687.5ZM610.2 687.4C610.4 686.9 610.6 686.9 611.0 687.5C611.4 688.1 611.6 688.1 611.8 687.6C612.0 687.3 612.5 687.0 613.0 687.0C613.6 687.0 614.0 686.8 614.0 686.5C614.0 686.2 612.9 686.0 611.5 686.0C609.3 686.0 609.0 686.1 609.0 687.0C609.0 688.1 609.8 688.4 610.2 687.4ZM502.0 685.0C502.0 683.8 501.7 683.7 500.7 684.7C499.7 685.7 499.8 686.0 501.0 686.0C501.7 686.0 502.0 685.7 502.0 685.0ZM514.0 685.0C514.0 684.2 513.7 684.0 512.5 684.0C511.3 684.0 511.0 684.2 511.0 685.0C511.0 685.8 511.3 686.0 512.5 686.0C513.7 686.0 514.0 685.8 514.0 685.0ZM596.0 685.0C596.0 684.3 596.3 684.0 597.0 684.0C597.7 684.0 598.0 683.7 598.0 683.0C598.0 682.2 597.7 682.0 596.0 682.0C594.0 682.0 594.0 682.0 594.0 684.0C594.0 685.7 594.2 686.0 595.0 686.0C595.7 686.0 596.0 685.7 596.0 685.0ZM604.0 685.0C604.0 683.8 603.7 683.7 602.7 684.7C601.7 685.7 601.8 686.0 603.0 686.0C603.7 686.0 604.0 685.7 604.0 685.0ZM444.0 684.4C444.0 684.2 443.6 684.0 443.0 684.0C442.3 684.0 442.0 683.7 442.0 683.0C442.0 682.5 441.8 682.0 441.5 682.0C440.8 682.0 440.9 683.4 441.6 684.2C442.3 684.9 444.0 685.1 444.0 684.4ZM447.3 684.3C448.5 683.1 448.2 682.0 446.7 682.0C445.7 682.0 445.5 682.2 445.7 682.8C445.9 683.2 446.0 683.9 446.0 684.3C446.0 685.2 446.4 685.2 447.3 684.3ZM507.8 683.0C507.8 682.6 507.4 682.2 506.9 682.1C506.3 682.0 506.0 682.2 506.0 683.0C506.0 683.8 506.3 684.0 506.9 683.9C507.4 683.8 507.8 683.4 507.8 683.0ZM520.0 683.0C520.0 682.3 519.7 682.0 519.0 682.0C518.3 682.0 518.0 681.7 518.0 681.0C518.0 680.3 517.7 680.0 517.0 680.0C516.3 680.0 516.0 680.3 516.0 681.0C516.0 681.6 516.3 682.0 516.9 682.0C517.4 682.0 518.1 682.5 518.5 683.0C518.9 683.5 519.4 684.0 519.6 684.0C519.8 684.0 520.0 683.5 520.0 683.0ZM428.0 678.9C428.0 678.3 427.6 678.0 427.0 678.0C426.3 678.0 426.0 678.3 426.0 679.0C426.0 679.6 426.3 679.9 427.0 679.9C427.6 679.8 428.0 679.4 428.0 678.9ZM634.0 679.0C634.0 678.3 633.7 678.0 633.0 678.0C632.3 678.0 632.0 678.3 632.0 679.0C632.0 679.7 632.3 680.0 633.0 680.0C633.7 680.0 634.0 679.7 634.0 679.0ZM638.0 679.0C638.0 678.3 637.7 678.0 637.0 678.0C636.3 678.0 636.0 678.3 636.0 679.0C636.0 679.7 636.3 680.0 637.0 680.0C637.7 680.0 638.0 679.7 638.0 679.0ZM432.0 675.0C432.0 674.3 431.7 674.0 431.0 674.0C430.3 674.0 430.0 674.3 430.0 675.0C430.0 675.7 430.3 676.0 431.0 676.0C431.7 676.0 432.0 675.7 432.0 675.0ZM448.0 675.0C448.0 674.3 447.7 674.0 447.0 674.0C446.3 674.0 446.0 673.7 446.0 673.0C446.0 672.3 445.7 672.0 445.0 672.0C444.3 672.0 444.0 672.3 444.0 673.0C444.0 673.6 444.3 674.0 444.9 674.0C445.4 674.0 446.1 674.5 446.5 675.0C446.9 675.5 447.4 676.0 447.6 676.0C447.8 676.0 448.0 675.5 448.0 675.0ZM632.0 675.0C632.0 674.3 631.7 674.0 631.0 674.0C630.3 674.0 630.0 674.3 630.0 675.0C630.0 675.7 630.3 676.0 631.0 676.0C631.7 676.0 632.0 675.7 632.0 675.0ZM676.0 673.0C676.0 670.3 675.9 670.0 675.0 670.0C674.3 670.0 674.0 669.7 674.0 669.0C674.0 668.3 673.7 668.0 673.0 668.0C672.3 668.0 672.0 668.3 672.0 669.0C672.0 669.7 671.7 670.0 671.0 670.0C670.5 670.0 670.0 670.2 670.0 670.5C670.0 670.8 670.5 671.0 671.0 671.0C671.5 671.0 672.0 670.8 672.0 670.5C672.0 670.2 672.5 670.0 673.0 670.0C673.9 670.0 674.0 670.3 674.0 673.0C674.0 675.7 674.1 676.0 675.0 676.0C675.9 676.0 676.0 675.7 676.0 673.0ZM382.0 671.0C382.0 670.7 381.6 670.5 381.0 670.5C379.9 670.5 379.6 671.3 380.6 671.6C381.4 671.9 382.0 671.6 382.0 671.0ZM390.0 670.0C390.0 668.3 389.8 668.0 389.0 668.0C388.2 668.0 388.0 668.3 388.0 670.0C388.0 671.7 388.2 672.0 389.0 672.0C389.8 672.0 390.0 671.7 390.0 670.0ZM666.0 667.0C666.0 666.3 666.3 666.0 667.0 666.0C667.7 666.0 668.0 665.7 668.0 665.0C668.0 664.2 667.7 664.0 666.0 664.0C664.0 664.0 664.0 664.0 664.0 666.0C664.0 667.7 664.2 668.0 665.0 668.0C665.7 668.0 666.0 667.7 666.0 667.0ZM388.0 665.0C388.0 663.9 387.6 663.8 386.5 664.5C385.8 664.9 385.8 665.1 386.5 665.5C387.6 666.2 388.0 666.1 388.0 665.0ZM391.5 663.5C392.2 663.1 392.2 662.9 391.5 662.5C390.7 662.0 390.0 662.3 390.0 663.3C390.0 664.1 390.4 664.2 391.5 663.5ZM672.0 663.0C672.0 662.3 671.7 662.0 671.0 662.0C670.3 662.0 670.0 662.3 670.0 663.0C670.0 663.7 670.3 664.0 671.0 664.0C671.7 664.0 672.0 663.7 672.0 663.0ZM678.0 663.0C678.0 662.3 677.7 662.0 677.0 662.0C676.3 662.0 676.0 662.3 676.0 663.0C676.0 663.7 676.3 664.0 677.0 664.0C677.7 664.0 678.0 663.7 678.0 663.0ZM410.0 659.3C410.0 658.0 409.4 657.0 408.7 657.0C408.3 657.0 408.0 657.2 408.0 657.5C408.0 657.8 407.6 658.0 407.0 658.0C406.4 658.0 406.0 657.8 406.0 657.5C406.0 657.2 405.6 657.0 405.0 657.0C404.4 657.0 404.0 657.2 404.0 657.5C404.0 657.8 404.4 658.0 405.0 658.0C405.7 658.0 406.0 658.3 406.0 659.0C406.0 659.8 406.3 660.0 408.0 660.0C409.4 660.0 410.0 659.8 410.0 659.3ZM658.0 658.0C658.0 656.3 657.8 656.0 657.0 656.0C656.2 656.0 656.0 656.3 656.0 658.0C656.0 659.7 656.2 660.0 657.0 660.0C657.8 660.0 658.0 659.7 658.0 658.0ZM666.0 658.0C666.0 656.9 665.8 656.0 665.5 656.0C665.2 656.0 665.0 656.4 665.0 657.0C665.0 657.5 664.7 658.0 664.4 658.1C663.9 658.3 664.0 658.5 664.5 659.1C665.7 660.4 666.0 660.2 666.0 658.0ZM664.0 657.2C664.0 656.8 663.7 656.5 663.2 656.5C662.8 656.5 662.3 656.2 662.2 655.8C661.6 654.3 660.0 654.9 660.0 656.5C660.0 657.9 660.1 658.0 662.0 658.0C663.4 658.0 664.0 657.8 664.0 657.2ZM442.0 655.0C442.0 654.3 441.7 654.0 441.0 654.0C440.3 654.0 440.0 654.3 440.0 655.0C440.0 655.7 440.3 656.0 441.0 656.0C441.7 656.0 442.0 655.7 442.0 655.0ZM432.0 653.0C432.0 651.9 430.6 651.7 429.0 652.5C427.5 653.3 427.8 653.8 430.0 653.9C431.7 654.0 432.0 653.8 432.0 653.0ZM476.0 652.0C476.0 650.3 475.8 650.0 475.0 650.0C474.2 650.0 474.0 650.3 474.0 652.0C474.0 653.7 474.2 654.0 475.0 654.0C475.8 654.0 476.0 653.7 476.0 652.0ZM486.0 653.0C486.0 652.3 486.3 652.0 487.0 652.0C487.7 652.0 488.0 651.7 488.0 651.0C488.0 650.4 487.7 650.0 487.2 650.0C486.8 650.0 486.3 650.5 486.1 651.0C486.0 651.6 485.5 652.0 484.9 652.0C484.3 652.0 484.0 652.4 484.0 653.0C484.0 653.7 484.3 654.0 485.0 654.0C485.7 654.0 486.0 653.7 486.0 653.0ZM554.0 653.0C554.0 652.3 553.7 652.0 553.0 652.0C552.3 652.0 552.0 652.3 552.0 653.0C552.0 653.7 552.3 654.0 553.0 654.0C553.7 654.0 554.0 653.7 554.0 653.0ZM472.0 651.5C472.0 651.2 471.8 651.0 471.5 651.0C471.2 651.0 471.0 650.6 471.0 650.2C471.0 649.4 469.6 647.7 469.3 648.1C468.7 648.6 470.3 652.0 471.1 652.0C471.6 652.0 472.0 651.8 472.0 651.5ZM512.0 651.0C512.0 650.3 511.7 650.0 511.0 650.0C510.3 650.0 510.0 649.7 510.0 649.0C510.0 648.3 509.7 648.0 509.0 648.0C508.3 648.0 508.0 648.3 508.0 649.0C508.0 649.7 508.3 650.0 509.0 650.0C509.7 650.0 510.0 650.3 510.0 651.0C510.0 651.7 510.3 652.0 511.0 652.0C511.7 652.0 512.0 651.7 512.0 651.0ZM590.0 650.5C590.0 650.2 589.5 650.0 589.0 650.0C588.3 650.0 588.0 649.7 588.0 649.0C588.0 647.9 587.6 647.8 586.5 648.5C585.9 649.0 585.9 649.1 586.4 649.3C586.8 649.5 587.3 649.9 587.7 650.3C588.3 651.1 590.0 651.2 590.0 650.5ZM467.5 649.2C467.5 648.4 466.2 647.7 465.7 648.2C465.4 648.5 466.5 650.0 467.1 650.0C467.3 650.0 467.5 649.7 467.5 649.2ZM486.0 649.0C486.0 647.8 485.7 647.7 484.7 648.7C483.7 649.7 483.8 650.0 485.0 650.0C485.7 650.0 486.0 649.7 486.0 649.0ZM506.0 649.0C506.0 648.1 505.7 648.0 503.0 648.0C499.8 648.0 499.6 648.1 500.6 649.3C501.7 650.4 506.0 650.2 506.0 649.0ZM562.0 649.0C562.0 648.3 561.7 648.0 561.0 648.0C560.3 648.0 560.0 648.3 560.0 649.0C560.0 649.7 560.3 650.0 561.0 650.0C561.7 650.0 562.0 649.7 562.0 649.0ZM570.0 649.1C570.0 648.4 569.6 648.2 568.0 648.1C566.3 648.1 566.0 648.2 566.0 649.0C566.0 649.8 566.4 650.0 568.0 650.0C569.6 650.0 570.0 649.8 570.0 649.1ZM578.0 649.0C578.0 648.3 577.7 648.0 577.0 648.0C576.3 648.0 576.0 648.3 576.0 649.0C576.0 649.7 576.3 650.0 577.0 650.0C577.7 650.0 578.0 649.7 578.0 649.0ZM349.2 565.9C349.2 538.2 349.2 538.2 348.1 538.4C347.4 538.5 346.6 538.1 346.2 537.6C345.4 536.5 343.8 537.7 344.3 539.1C344.5 539.7 344.3 540.3 343.7 540.8C342.4 541.7 342.2 541.7 341.9 540.5C341.7 539.8 341.2 539.5 340.3 539.5C338.5 539.5 338.2 540.4 339.5 541.7C340.6 542.9 340.6 542.9 339.4 543.3C338.8 543.5 337.3 544.3 336.2 545.1C335.0 545.9 333.9 546.5 333.8 546.5C333.6 546.5 332.1 547.3 330.4 548.4C328.6 549.4 326.6 550.6 325.7 551.0C324.9 551.4 323.4 552.3 322.2 553.0C321.1 553.7 319.6 554.6 318.8 555.0C317.9 555.4 316.4 556.3 315.2 557.0C314.1 557.7 312.6 558.6 311.8 559.0C310.9 559.4 309.4 560.3 308.2 561.0C307.1 561.7 305.6 562.6 304.8 563.0C303.9 563.4 302.6 564.1 301.9 564.6C299.9 566.0 291.9 570.2 289.8 571.0C286.2 572.4 279.8 573.0 278.1 572.0C277.3 571.6 275.5 571.0 275.0 570.9C272.8 570.7 268.9 564.7 267.5 559.2C266.6 556.0 266.2 351.2 267.0 351.8C267.3 351.9 268.1 351.7 268.8 351.3C269.4 350.9 270.2 350.5 270.5 350.5C270.8 350.5 272.6 349.8 274.4 349.0C276.2 348.1 278.2 347.2 278.8 347.0C280.4 346.4 282.7 345.3 283.0 345.0C283.1 344.8 285.9 343.4 289.2 341.7C298.9 336.8 306.6 332.8 308.8 331.5C309.9 330.9 312.3 329.5 314.2 328.5C316.2 327.5 318.6 326.1 319.8 325.5C320.9 324.9 323.3 323.5 325.2 322.5C327.2 321.5 329.6 320.1 330.8 319.5C331.9 318.9 334.3 317.5 336.2 316.5C338.2 315.5 340.6 314.1 341.8 313.5C342.9 312.9 344.9 311.7 346.4 310.9C347.9 310.1 349.7 309.1 350.4 308.6C351.1 308.1 352.4 307.4 353.2 307.0C354.1 306.6 355.4 305.9 356.1 305.4C356.8 304.9 358.6 303.9 360.1 303.1C361.6 302.3 363.6 301.1 364.8 300.5C365.9 299.9 367.6 298.9 368.8 298.3C369.9 297.7 370.9 297.1 371.0 297.0C371.3 296.7 373.2 295.6 375.8 294.3C376.9 293.7 377.9 293.1 378.0 293.0C378.2 292.8 378.6 292.5 382.4 290.4C383.4 289.8 384.8 289.0 385.5 288.5C386.2 288.1 387.4 287.4 388.2 287.0C389.1 286.6 390.6 285.7 391.8 285.0C392.9 284.3 394.4 283.4 395.2 283.0C396.1 282.6 396.9 282.1 397.0 282.0C397.2 281.8 397.6 281.5 401.4 279.4C402.4 278.8 403.8 278.0 404.5 277.5C405.2 277.1 406.4 276.4 407.2 276.0C408.1 275.6 409.3 274.9 410.0 274.5C410.7 274.0 412.1 273.1 413.1 272.6C414.2 272.0 415.8 271.1 416.8 270.5C417.7 269.9 419.3 269.0 420.4 268.4C421.4 267.9 422.8 267.0 423.5 266.5C424.2 266.1 425.4 265.4 426.2 265.0C427.1 264.6 427.9 264.1 428.0 264.0C428.2 263.8 428.6 263.5 432.4 261.4C433.4 260.8 434.8 260.0 435.5 259.5C436.2 259.1 437.4 258.4 438.2 258.0C439.1 257.6 440.6 256.7 441.8 256.0C442.9 255.3 444.4 254.4 445.2 254.0C446.1 253.6 446.9 253.1 447.0 253.0C447.2 252.8 447.6 252.5 451.4 250.4C452.4 249.8 453.8 249.0 454.6 248.4C455.3 247.9 456.1 247.5 456.2 247.5C456.4 247.5 457.6 246.8 458.8 246.0C459.9 245.2 461.1 244.5 461.2 244.5C461.4 244.5 462.6 243.8 463.7 243.0C464.9 242.2 466.1 241.5 466.3 241.5C466.4 241.5 467.2 241.1 467.9 240.6C468.7 240.0 470.1 239.1 471.1 238.6C472.2 238.0 473.8 237.1 474.7 236.5C475.6 236.0 476.9 235.3 477.6 234.9C478.2 234.6 478.9 234.1 479.0 234.0C479.2 233.8 479.6 233.5 483.4 231.4C484.4 230.8 485.8 230.0 486.6 229.4C487.3 228.9 488.1 228.5 488.2 228.5C488.4 228.5 489.6 227.8 490.8 227.0C491.9 226.2 493.1 225.5 493.3 225.5C493.4 225.5 494.6 224.8 495.8 224.0C496.9 223.2 498.1 222.5 498.2 222.5C498.4 222.5 499.6 221.8 500.7 221.0C501.9 220.2 503.1 219.5 503.2 219.5C503.4 219.5 504.5 218.9 505.7 218.1C506.8 217.3 508.4 216.4 509.2 216.0C510.1 215.6 510.9 215.1 511.0 215.0C511.2 214.8 512.4 214.1 514.8 212.8C515.3 212.5 515.9 212.1 516.0 212.0C516.2 211.8 516.6 211.5 520.4 209.4C521.4 208.8 522.8 208.0 523.6 207.4C524.3 206.9 525.1 206.5 525.2 206.5C525.4 206.5 526.6 205.8 527.7 205.0C528.9 204.2 530.2 203.5 530.5 203.5C530.8 203.5 531.0 203.3 531.0 203.0C531.0 202.7 531.2 202.5 531.5 202.5C531.8 202.5 533.4 201.6 535.0 200.5C536.6 199.4 538.1 198.5 538.3 198.5C538.4 198.5 539.6 197.8 540.8 197.0C541.9 196.2 543.1 195.5 543.2 195.5C543.4 195.5 544.6 194.8 545.7 194.0C546.9 193.2 548.1 192.5 548.2 192.5C548.4 192.5 549.6 191.8 550.8 191.0C551.9 190.2 553.2 189.5 553.5 189.5C553.8 189.5 554.0 189.3 554.0 189.0C554.0 188.7 554.2 188.5 554.5 188.5C554.8 188.5 556.4 187.6 558.0 186.5C559.6 185.4 561.1 184.5 561.3 184.5C561.4 184.5 562.6 183.8 563.7 183.0C564.9 182.2 566.2 181.5 566.5 181.5C566.8 181.5 567.0 181.3 567.0 181.0C567.0 180.7 567.2 180.5 567.5 180.5C567.8 180.5 569.4 179.6 571.0 178.5C572.6 177.4 574.1 176.5 574.3 176.5C574.4 176.5 575.6 175.8 576.7 175.0C577.9 174.2 579.2 173.5 579.5 173.5C579.8 173.5 580.0 173.3 580.0 173.1C580.0 172.9 580.6 172.4 581.4 172.0C582.1 171.6 583.7 170.7 584.8 169.9C586.0 169.1 587.1 168.5 587.2 168.5C587.4 168.5 589.2 167.4 591.2 166.0C593.3 164.6 595.2 163.5 595.5 163.5C595.8 163.5 596.0 163.3 596.0 163.0C596.0 162.7 596.2 162.5 596.5 162.5C596.8 162.5 598.4 161.6 600.0 160.5C601.6 159.4 603.2 158.5 603.5 158.5C603.8 158.5 604.0 158.3 604.0 158.1C604.0 157.9 604.6 157.4 605.4 157.0C606.1 156.6 608.4 155.2 610.4 153.9C612.3 152.6 614.1 151.5 614.2 151.5C614.4 151.5 618.2 149.0 622.8 146.0C627.3 143.0 631.2 140.5 631.5 140.5C631.8 140.5 632.0 140.3 632.0 140.1C632.0 139.9 632.6 139.3 633.4 139.0C634.1 138.6 635.2 137.9 635.7 137.4C636.3 136.9 637.0 136.5 637.3 136.5C637.6 136.5 638.0 136.3 638.1 136.1C638.2 135.9 640.0 134.5 642.2 133.0C644.5 131.5 647.3 129.5 648.5 128.6L650.8 126.9L650.9 156.7C650.9 173.1 650.9 199.9 650.9 216.2L650.8 245.9L648.7 245.0C647.5 244.4 646.4 243.8 646.2 243.5C646.1 243.2 645.0 242.5 643.8 242.0C642.7 241.4 641.1 240.5 640.2 240.0C639.4 239.5 637.8 238.6 636.7 238.0C635.5 237.5 634.4 236.8 634.3 236.5C634.1 236.3 632.7 235.4 631.1 234.7C629.5 233.9 627.9 233.0 627.4 232.6C626.1 231.5 621.9 229.5 621.0 229.5C620.5 229.5 620.0 229.3 619.8 229.2C618.8 228.1 607.9 227.9 606.9 228.9C606.6 229.2 605.9 229.5 605.4 229.5C604.5 229.5 600.3 231.5 600.1 232.1C600.0 232.3 599.7 232.5 599.3 232.5C599.0 232.5 598.2 233.0 597.5 233.5C595.8 234.8 594.8 234.8 594.7 233.3C594.4 228.1 588.6 225.3 583.8 228.0C582.8 228.6 581.2 229.5 580.1 230.1C579.1 230.6 578.0 231.3 577.8 231.5C577.5 231.7 576.4 232.4 575.4 232.9C570.5 235.7 569.7 236.2 568.4 237.1C567.7 237.6 566.9 238.0 566.7 238.0C566.6 238.0 565.8 238.4 565.1 238.9C564.3 239.5 562.9 240.4 561.9 240.9C560.8 241.5 559.2 242.4 558.2 243.0C557.3 243.5 555.7 244.5 554.6 245.1C553.6 245.6 552.2 246.5 551.4 247.1C550.7 247.6 549.9 248.0 549.7 248.0C549.6 248.0 548.8 248.4 548.1 248.9C546.8 249.8 546.0 250.3 541.1 253.1C540.1 253.6 539.0 254.3 538.8 254.5C538.5 254.7 537.4 255.4 536.4 255.9C531.5 258.7 530.7 259.2 529.4 260.1C528.7 260.6 527.9 261.0 527.8 261.0C527.6 261.0 526.8 261.4 526.1 261.9C525.3 262.5 523.9 263.4 522.9 263.9C521.8 264.5 520.2 265.4 519.2 266.0C518.3 266.6 516.7 267.5 515.6 268.1C514.6 268.6 513.2 269.5 512.4 270.1C511.7 270.6 510.9 271.0 510.8 271.0C510.6 271.0 509.4 271.7 508.2 272.5C507.1 273.3 505.9 274.0 505.7 274.0C505.6 274.0 504.8 274.4 504.1 274.9C503.3 275.5 501.9 276.4 500.9 276.9C499.8 277.5 498.2 278.4 497.2 279.0C496.3 279.5 494.7 280.5 493.6 281.1C492.6 281.6 491.2 282.5 490.4 283.1C489.7 283.6 488.9 284.0 488.8 284.0C488.6 284.0 487.5 284.6 486.3 285.4C485.2 286.2 483.6 287.1 482.8 287.5C481.9 287.9 481.1 288.4 481.0 288.5C480.8 288.7 480.4 289.0 476.6 291.1C475.6 291.7 474.2 292.5 473.4 293.1C472.7 293.6 471.9 294.0 471.8 294.0C471.6 294.0 470.4 294.7 469.2 295.5C468.1 296.3 466.9 297.0 466.7 297.0C466.6 297.0 465.8 297.4 465.1 297.9C464.3 298.5 462.9 299.4 461.9 299.9C460.8 300.5 459.2 301.4 458.2 302.0C457.3 302.5 455.7 303.5 454.6 304.1C453.6 304.6 452.2 305.5 451.4 306.1C450.7 306.6 449.9 307.0 449.8 307.0C449.6 307.0 448.5 307.6 447.3 308.4C446.2 309.2 444.6 310.1 443.8 310.5C442.9 310.9 442.1 311.4 442.0 311.5C441.8 311.7 441.4 312.0 437.6 314.1C436.6 314.7 435.2 315.5 434.4 316.1C433.7 316.6 432.9 317.0 432.8 317.0C432.6 317.0 431.4 317.7 430.2 318.5C429.1 319.3 427.9 320.0 427.7 320.0C427.6 320.0 426.8 320.4 426.1 320.9C425.3 321.5 423.9 322.4 422.9 322.9C421.8 323.5 420.2 324.4 419.2 325.0C418.3 325.6 416.7 326.5 415.6 327.1C414.6 327.6 413.2 328.5 412.4 329.1C411.7 329.6 410.9 330.0 410.8 330.0C410.6 330.0 409.8 330.4 409.1 330.9C408.3 331.5 406.9 332.4 405.9 332.9C404.8 333.5 403.2 334.4 402.2 335.0C401.3 335.5 399.7 336.5 398.6 337.1C397.6 337.6 396.2 338.5 395.4 339.1C394.7 339.6 394.0 340.0 393.8 340.0C392.1 340.0 386.4 346.3 384.5 350.3C378.2 363.1 383.1 372.9 393.1 367.6C396.7 365.7 399.6 364.0 400.2 363.5C400.5 363.3 401.6 362.6 402.6 362.1C407.5 359.3 408.3 358.8 409.6 357.9C410.3 357.4 411.1 357.0 411.2 357.0C411.4 357.0 412.2 356.6 412.9 356.1C413.7 355.5 415.1 354.6 416.1 354.1C417.2 353.5 418.8 352.5 419.8 352.0C420.7 351.4 422.3 350.5 423.4 349.9C424.4 349.4 425.8 348.5 426.6 347.9C427.3 347.4 428.1 347.0 428.2 347.0C428.4 347.0 429.6 346.3 430.7 345.5C431.9 344.7 433.1 344.0 433.3 344.0C433.4 344.0 434.2 343.6 434.9 343.1C435.7 342.5 437.1 341.6 438.1 341.1C439.2 340.5 440.8 339.6 441.8 339.0C442.7 338.4 444.3 337.5 445.4 336.9C446.4 336.4 447.8 335.5 448.6 334.9C449.3 334.4 450.1 334.0 450.2 334.0C450.4 334.0 451.2 333.6 451.9 333.1C453.2 332.2 454.0 331.7 458.9 328.9C459.9 328.4 461.0 327.7 461.2 327.5C461.5 327.3 462.6 326.6 463.6 326.1C468.5 323.3 469.3 322.8 470.6 321.9C471.3 321.4 472.1 321.0 472.2 321.0C472.4 321.0 473.2 320.6 473.9 320.1C474.7 319.5 476.1 318.6 477.1 318.1C478.2 317.5 479.8 316.5 480.8 316.0C481.7 315.4 483.3 314.5 484.4 313.9C485.4 313.4 486.8 312.5 487.6 311.9C488.3 311.4 489.1 311.0 489.2 311.0C489.4 311.0 490.6 310.3 491.7 309.5C492.9 308.7 494.1 308.0 494.3 308.0C494.4 308.0 495.2 307.6 495.9 307.1C496.7 306.5 498.1 305.6 499.1 305.1C500.2 304.5 501.8 303.6 502.8 303.0C503.7 302.4 505.3 301.5 506.4 300.9C507.4 300.4 508.8 299.5 509.6 298.9C510.3 298.4 511.1 298.0 511.2 298.0C511.4 298.0 512.6 297.3 513.8 296.5C514.9 295.7 516.1 295.0 516.3 295.0C516.4 295.0 517.2 294.6 517.9 294.1C518.7 293.5 520.1 292.6 521.1 292.1C522.2 291.5 523.8 290.5 524.8 290.0C525.7 289.4 527.3 288.5 528.4 287.9C529.4 287.4 530.8 286.5 531.6 285.9C532.3 285.4 533.1 285.0 533.2 285.0C533.4 285.0 534.2 284.6 534.9 284.1C535.7 283.5 537.1 282.6 538.1 282.1C539.2 281.5 540.8 280.5 541.8 280.0C542.7 279.4 544.3 278.5 545.4 277.9C546.4 277.4 547.8 276.5 548.6 275.9C549.3 275.4 550.1 275.0 550.2 275.0C550.4 275.0 551.6 274.3 552.7 273.5C553.9 272.7 555.1 272.0 555.3 272.0C555.4 272.0 556.2 271.6 556.9 271.1C557.7 270.5 559.1 269.6 560.1 269.1C561.2 268.5 562.8 267.5 563.8 267.0C564.7 266.4 566.3 265.5 567.4 264.9C568.4 264.4 570.2 263.2 571.4 262.4L573.5 261.0L573.5 335.2C573.5 405.4 573.5 409.4 572.6 409.7C572.1 409.8 570.6 410.6 569.2 411.5C567.9 412.3 566.4 413.2 566.0 413.3C565.6 413.5 564.4 414.3 563.2 415.0C562.1 415.7 560.6 416.6 559.8 417.0C558.9 417.4 557.4 418.3 556.2 419.0C555.1 419.7 553.6 420.6 552.8 421.0C551.9 421.4 550.4 422.3 549.2 423.0C548.1 423.7 546.6 424.6 545.8 425.0C544.9 425.4 543.4 426.3 542.2 427.0C541.1 427.7 539.6 428.6 538.8 429.0C537.9 429.4 536.4 430.3 535.2 431.0C534.1 431.7 532.6 432.6 531.8 433.0C530.9 433.4 529.4 434.3 528.2 435.0C527.1 435.7 525.6 436.6 524.8 437.0C523.9 437.4 523.1 437.9 523.0 438.0C522.7 438.3 520.8 439.4 518.2 440.7C517.1 441.3 516.1 441.9 516.0 442.0C515.7 442.3 513.8 443.4 511.2 444.7C510.1 445.3 509.1 445.9 509.0 446.0C508.9 446.1 508.2 446.6 507.6 446.9C505.7 448.0 503.2 449.4 501.2 450.5C500.3 451.1 498.7 451.9 497.8 452.5C496.8 453.1 495.2 453.9 494.2 454.5C493.3 455.1 491.7 455.9 490.8 456.5C489.8 457.1 488.2 457.9 487.2 458.5C486.3 459.1 484.7 460.0 483.6 460.6C482.6 461.1 481.2 462.0 480.5 462.5C479.8 462.9 478.6 463.6 477.8 464.0C476.9 464.4 475.4 465.3 474.2 466.0C473.1 466.7 471.6 467.6 470.8 468.0C469.9 468.4 468.4 469.3 467.2 470.0C466.1 470.7 464.6 471.6 463.8 472.0C462.9 472.4 461.4 473.3 460.2 474.0C459.1 474.7 457.6 475.6 456.8 476.0C455.9 476.4 454.4 477.3 453.2 478.0C452.1 478.7 450.6 479.6 449.8 480.0C448.9 480.4 447.4 481.3 446.2 482.0C445.1 482.7 443.6 483.6 442.8 484.0C441.9 484.4 441.1 484.9 441.0 485.0C440.7 485.3 438.8 486.4 436.2 487.7C435.1 488.3 434.1 488.9 434.0 489.0C433.7 489.3 431.8 490.4 429.2 491.7C428.1 492.3 427.1 492.9 427.0 493.0C426.9 493.1 426.2 493.6 425.6 493.9C423.7 495.0 421.2 496.4 419.2 497.5C418.3 498.1 416.7 498.9 415.8 499.5C414.8 500.1 413.2 500.9 412.2 501.5C411.3 502.1 409.7 503.0 408.6 503.5C406.3 504.8 403.5 507.5 403.5 508.3C403.5 508.7 403.1 509.2 402.6 509.6C402.1 510.0 401.5 510.9 401.3 511.6C401.1 512.3 400.4 513.6 399.8 514.4C399.1 515.2 398.5 516.1 398.5 516.4C398.5 516.6 397.8 517.5 397.0 518.2C396.2 519.0 395.5 520.2 395.5 520.8C395.5 521.4 395.1 522.3 394.5 522.8C393.9 523.2 393.5 523.9 393.5 524.2C393.5 524.6 393.1 525.3 392.5 525.8C391.9 526.2 391.5 527.0 391.5 527.3C391.5 527.7 391.0 528.0 390.2 528.0C388.7 528.0 388.0 529.4 389.2 530.3C389.9 530.8 389.9 530.9 389.3 531.2C388.8 531.3 388.5 531.8 388.5 532.2C388.5 532.5 388.1 533.3 387.5 533.8C386.9 534.2 386.5 534.9 386.5 535.1C386.5 535.4 385.8 536.6 385.0 537.8C384.2 538.9 383.5 540.1 383.5 540.4C383.5 540.6 383.1 541.3 382.5 541.8C381.9 542.2 381.5 543.0 381.5 543.3C381.5 543.7 381.1 544.3 380.5 544.6C379.9 545.0 379.5 545.5 379.5 545.8C379.5 546.6 378.1 549.3 377.2 550.0C376.8 550.3 376.5 550.9 376.5 551.2C376.5 551.6 376.1 552.2 375.7 552.5C375.3 552.9 374.7 553.7 374.4 554.2C374.2 554.8 373.5 555.9 373.0 556.8C372.5 557.6 371.8 558.7 371.6 559.3C371.3 559.8 370.7 560.6 370.3 561.0C369.9 561.3 369.5 561.8 369.5 562.1C369.5 562.4 368.8 563.6 368.0 564.8C367.2 565.9 366.5 567.1 366.5 567.4C366.5 567.6 366.1 568.3 365.5 568.8C364.9 569.2 364.5 569.9 364.5 570.1C364.5 570.4 363.8 571.6 363.0 572.8C362.2 573.9 361.5 575.1 361.5 575.4C361.5 575.6 361.1 576.3 360.5 576.8C359.9 577.2 359.5 577.8 359.5 578.1C359.5 578.3 358.8 579.5 358.0 580.7C357.2 581.9 356.5 583.1 356.5 583.4C356.5 583.6 356.1 584.3 355.5 584.8C354.9 585.2 354.5 585.9 354.5 586.3C354.5 586.6 354.1 587.2 353.7 587.5C353.3 587.9 352.7 588.7 352.4 589.2C351.6 591.0 350.2 593.2 349.7 593.3C349.4 593.4 349.2 583.2 349.2 565.9ZM766.5 580.5C766.0 579.7 765.5 579.0 765.5 578.8C765.5 578.7 764.4 576.9 763.0 574.8C761.6 572.7 760.5 570.9 760.5 570.7C760.5 570.6 759.4 568.8 758.0 566.8C756.6 564.7 755.5 562.9 755.5 562.7C755.5 562.6 754.4 560.8 753.0 558.8C751.6 556.8 750.5 555.0 750.5 554.8C750.5 554.6 749.4 552.8 748.0 550.8C746.6 548.8 745.5 547.0 745.5 546.8C745.5 546.6 744.4 544.8 743.0 542.8C741.6 540.7 740.5 538.9 740.5 538.8C740.5 538.6 739.4 536.8 738.0 534.8C736.6 532.7 735.5 530.8 735.5 530.6C735.5 529.9 731.6 526.9 729.5 525.8C728.5 525.3 727.1 524.5 726.2 524.0C725.4 523.5 723.8 522.6 722.7 522.0C721.6 521.5 720.4 520.7 720.0 520.3C719.7 519.9 719.2 519.6 719.0 519.8C718.8 519.9 718.4 519.8 718.3 519.5C718.1 519.2 717.0 518.5 715.8 518.0C714.5 517.5 713.4 516.8 713.3 516.5C713.1 516.3 711.5 515.3 709.8 514.5C708.0 513.7 706.4 512.7 706.2 512.5C706.1 512.2 705.0 511.5 703.8 511.0C702.7 510.4 701.1 509.5 700.2 509.0C699.4 508.5 697.8 507.6 696.7 507.0C695.5 506.5 694.4 505.8 694.3 505.5C694.1 505.3 692.5 504.3 690.8 503.5C689.0 502.7 687.4 501.7 687.2 501.5C687.1 501.2 686.0 500.5 684.8 500.0C683.7 499.4 682.1 498.5 681.2 498.0C680.4 497.5 678.8 496.6 677.7 496.0C676.6 495.5 675.4 494.7 675.0 494.3C674.7 493.9 674.2 493.6 674.0 493.8C673.8 493.9 673.4 493.8 673.3 493.5C673.1 493.2 672.0 492.5 670.8 492.0C669.5 491.5 668.4 490.8 668.3 490.5C668.1 490.3 666.5 489.3 664.8 488.5C663.0 487.7 661.4 486.7 661.2 486.5C661.1 486.2 660.0 485.5 658.8 485.0C657.7 484.4 656.1 483.5 655.2 483.0C654.4 482.5 652.8 481.6 651.7 481.0C650.5 480.5 649.4 479.8 649.3 479.5C649.1 479.3 647.5 478.3 645.8 477.5C644.0 476.7 642.4 475.7 642.2 475.5C642.1 475.2 641.0 474.5 639.8 474.0C638.7 473.4 637.1 472.5 636.2 472.0C635.4 471.5 633.8 470.6 632.7 470.0C631.6 469.5 630.4 468.7 630.0 468.3C629.7 467.9 629.2 467.6 629.0 467.8C628.8 467.9 628.4 467.8 628.3 467.5C628.1 467.2 627.0 466.5 625.8 466.0C624.5 465.5 623.4 464.8 623.3 464.5C623.1 464.3 621.5 463.3 619.8 462.5C618.0 461.7 616.4 460.7 616.2 460.5C616.1 460.2 615.0 459.5 613.8 459.0C612.7 458.4 611.1 457.5 610.2 457.0C609.4 456.5 607.8 455.6 606.7 455.0C605.5 454.5 604.4 453.8 604.3 453.5C604.1 453.2 603.1 452.6 602.1 452.2C595.2 449.0 586.4 438.8 582.9 430.0C579.2 421.0 579.5 427.7 579.5 336.7C579.5 256.8 579.5 254.0 581.0 251.0C582.5 248.0 589.8 246.0 592.2 248.0C592.7 248.3 593.0 248.4 593.0 248.2C593.0 248.0 593.5 248.3 594.0 248.8C594.5 249.2 595.0 249.5 595.0 249.3C595.0 249.0 595.4 249.2 595.9 249.6C596.4 250.0 597.6 250.7 598.6 251.2C599.5 251.6 600.6 252.3 601.0 252.7C601.3 253.1 601.8 253.4 602.0 253.2C602.2 253.1 602.6 253.2 602.7 253.5C602.9 253.8 604.0 254.5 605.2 255.0C606.5 255.5 607.6 256.2 607.7 256.5C607.9 256.7 609.5 257.7 611.2 258.5C613.0 259.3 614.6 260.3 614.8 260.5C614.9 260.8 616.0 261.5 617.2 262.0C618.3 262.6 619.9 263.5 620.8 264.0C621.6 264.5 623.2 265.4 624.3 266.0C625.5 266.5 626.6 267.2 626.7 267.5C626.9 267.7 628.5 268.7 630.2 269.5C632.0 270.3 633.6 271.3 633.8 271.5C633.9 271.8 635.0 272.5 636.2 273.0C637.3 273.6 638.9 274.5 639.8 275.0C640.6 275.5 642.2 276.4 643.3 277.0C644.4 277.5 645.6 278.3 646.0 278.7C646.3 279.1 646.8 279.4 647.0 279.2C647.2 279.1 647.6 279.2 647.7 279.5C647.9 279.8 649.0 280.5 650.2 281.0C651.5 281.5 652.6 282.2 652.7 282.5C652.9 282.7 654.5 283.7 656.2 284.5C658.0 285.3 659.6 286.3 659.8 286.5C659.9 286.8 661.0 287.5 662.2 288.0C663.3 288.6 664.9 289.5 665.8 290.0C666.6 290.5 668.2 291.4 669.3 292.0C670.4 292.5 671.6 293.3 672.0 293.7C672.3 294.1 672.8 294.4 673.0 294.2C673.2 294.1 673.6 294.2 673.7 294.5C673.9 294.8 675.0 295.5 676.2 296.0C677.5 296.5 678.6 297.2 678.7 297.5C678.9 297.7 680.5 298.7 682.2 299.5C684.0 300.3 685.6 301.3 685.8 301.5C685.9 301.8 687.0 302.5 688.2 303.0C689.3 303.6 690.9 304.5 691.8 305.0C692.6 305.5 694.2 306.4 695.3 307.0C696.5 307.5 697.6 308.2 697.7 308.5C697.9 308.7 699.5 309.7 701.2 310.5C703.0 311.3 704.6 312.3 704.8 312.5C704.9 312.8 706.0 313.5 707.2 314.0C708.3 314.6 709.9 315.5 710.8 316.0C711.6 316.5 713.2 317.4 714.3 318.0C715.4 318.5 716.6 319.3 717.0 319.7C717.3 320.1 717.8 320.4 718.0 320.2C718.2 320.1 718.6 320.2 718.7 320.5C718.9 320.8 720.0 321.5 721.2 322.0C722.5 322.5 723.6 323.2 723.7 323.5C723.9 323.7 725.5 324.7 727.2 325.5C729.0 326.3 730.6 327.3 730.8 327.5C730.9 327.8 732.0 328.5 733.2 329.0C734.3 329.6 735.9 330.5 736.8 331.0C737.6 331.5 739.2 332.4 740.3 333.0C741.4 333.5 742.6 334.3 743.0 334.7C743.3 335.1 743.8 335.4 744.0 335.2C744.2 335.1 744.6 335.2 744.7 335.5C744.9 335.8 746.0 336.5 747.2 337.0C748.5 337.5 749.6 338.2 749.7 338.5C749.9 338.7 751.5 339.7 753.2 340.5C755.0 341.3 756.6 342.3 756.8 342.5C756.9 342.8 758.0 343.5 759.2 344.0C760.3 344.6 761.9 345.5 762.8 346.0C763.6 346.5 765.2 347.4 766.3 348.0C767.5 348.5 768.6 349.2 768.7 349.5C768.9 349.7 770.5 350.7 772.2 351.5C774.0 352.3 775.6 353.3 775.8 353.5C775.9 353.8 777.0 354.5 778.2 355.0C779.3 355.6 780.9 356.5 781.8 357.0C782.6 357.5 784.2 358.4 785.3 359.0C786.4 359.5 787.6 360.3 788.0 360.7C788.3 361.1 788.8 361.4 789.0 361.2C789.2 361.1 789.6 361.2 789.7 361.5C789.9 361.8 791.0 362.5 792.2 363.0C793.5 363.5 794.6 364.2 794.7 364.5C794.9 364.7 796.5 365.6 798.2 366.5C799.9 367.3 801.6 368.3 802.0 368.7C802.3 369.2 802.8 369.5 803.1 369.5C804.4 369.5 813.5 378.8 813.5 380.1C813.5 380.4 814.1 381.5 814.9 382.7C816.3 384.8 816.9 386.2 818.5 392.2C819.7 396.6 820.1 561.2 818.9 565.2C818.1 567.7 815.4 570.5 813.6 570.6C810.5 570.8 807.3 570.5 806.7 569.9C806.3 569.6 806.0 569.5 806.0 569.7C806.0 569.8 805.3 569.5 804.4 569.0C803.5 568.5 801.4 567.4 799.6 566.5C797.9 565.7 796.4 564.7 796.2 564.5C796.1 564.2 795.0 563.5 793.8 563.0C792.7 562.4 791.1 561.5 790.2 561.0C789.4 560.5 787.8 559.6 786.7 559.0C785.6 558.5 784.4 557.7 784.0 557.3C783.7 556.9 783.2 556.6 783.0 556.8C782.8 556.9 782.4 556.8 782.3 556.5C782.1 556.2 781.0 555.5 779.8 555.0C778.5 554.5 777.4 553.8 777.2 553.5C777.1 553.2 776.0 552.5 774.8 552.0C772.1 550.6 770.8 549.9 769.8 549.0C767.6 547.2 767.5 548.0 767.6 565.5C767.7 574.6 767.7 582.0 767.7 582.0C767.6 582.0 767.1 581.3 766.5 580.5ZM331.9 546.9C332.6 546.0 331.5 544.5 330.1 544.5C329.0 544.5 328.7 545.2 329.3 546.7C329.7 547.7 331.2 547.8 331.9 546.9ZM336.7 544.1C337.9 542.7 336.5 541.2 335.0 542.1C333.5 543.1 333.8 544.7 335.5 545.0C335.7 545.0 336.2 544.6 336.7 544.1ZM324.8 543.8C324.9 543.5 324.6 542.8 324.2 542.3C323.3 541.0 322.2 541.9 322.7 543.5C323.1 544.5 324.5 544.7 324.8 543.8ZM329.3 541.7C329.7 540.7 328.4 539.4 327.3 539.8C326.5 540.1 326.2 541.5 326.8 542.2C327.5 542.8 329.0 542.5 329.3 541.7ZM322.4 538.6C322.3 537.5 322.0 537.2 321.0 537.2C319.5 537.2 319.0 538.8 320.3 539.7C321.6 540.7 322.6 540.1 322.4 538.6ZM334.3 537.6C333.1 536.3 332.0 536.7 332.0 538.5C332.0 540.3 332.9 540.7 334.2 539.5C335.1 538.6 335.2 538.5 334.3 537.6ZM326.7 537.0C327.7 535.9 327.1 534.5 325.7 534.5C324.6 534.5 323.8 536.4 324.5 537.3C325.3 538.2 325.7 538.2 326.7 537.0ZM338.5 537.5C339.7 536.8 339.8 536.1 338.6 535.2C337.5 534.4 336.5 534.9 336.5 536.2C336.5 538.0 337.0 538.3 338.5 537.5ZM315.0 536.0C315.0 534.8 313.7 534.1 312.8 535.0C312.4 535.4 312.5 535.7 313.2 536.3C314.5 537.3 315.0 537.2 315.0 536.0ZM331.9 535.1C332.9 534.4 332.4 532.8 331.1 532.6C329.8 532.4 329.1 533.7 330.0 534.8C330.7 535.6 331.0 535.7 331.9 535.1ZM344.4 534.1C344.6 532.7 343.2 532.1 342.2 533.1C341.2 534.1 341.8 535.6 343.2 535.4C343.8 535.3 344.3 534.8 344.4 534.1ZM319.5 534.2C320.3 533.3 318.9 531.4 317.7 531.8C316.7 532.2 316.5 533.4 317.3 534.2C318.3 535.2 318.7 535.2 319.5 534.2ZM336.7 532.2C338.3 530.7 336.6 529.3 334.7 530.7C333.9 531.3 333.9 531.5 334.5 532.2C335.3 533.2 335.7 533.2 336.7 532.2ZM348.8 532.3C349.7 531.6 349.7 531.6 348.8 530.6C347.7 529.4 346.5 529.7 346.5 531.2C346.5 533.1 347.2 533.4 348.8 532.3ZM312.5 531.5C313.2 530.3 312.8 529.5 311.5 529.5C310.1 529.5 309.2 530.8 310.0 531.8C310.9 532.8 311.9 532.7 312.5 531.5ZM324.4 531.1C324.6 529.7 323.2 529.1 322.1 530.1C321.1 531.2 321.7 532.6 323.1 532.4C323.8 532.3 324.3 531.8 324.4 531.1ZM317.0 529.8C317.9 528.6 317.4 527.2 316.0 527.2C315.1 527.2 314.7 527.6 314.6 528.4C314.3 530.2 315.9 531.1 317.0 529.8ZM329.4 527.7C328.6 526.9 327.2 527.2 326.8 528.3C326.2 529.7 328.0 530.7 329.2 529.5C330.1 528.6 330.1 528.4 329.4 527.7ZM342.3 529.7C342.7 528.8 341.7 527.5 340.7 527.5C339.7 527.5 339.3 528.9 340.0 529.8C340.8 530.7 342.0 530.7 342.3 529.7ZM353.7 529.7C354.8 528.7 354.5 527.8 353.1 527.6C351.9 527.4 351.2 528.5 351.7 529.8C352.1 530.7 352.7 530.7 353.7 529.7ZM305.4 528.6C305.6 528.0 303.6 526.7 303.2 527.2C303.0 527.3 303.2 527.9 303.5 528.5C304.1 529.6 305.0 529.6 305.4 528.6ZM322.4 526.6C322.7 524.9 321.9 524.3 320.6 525.1C319.4 525.8 319.1 527.3 320.1 527.7C321.3 528.2 322.3 527.7 322.4 526.6ZM334.4 526.4C334.6 524.7 333.4 524.3 332.2 525.6C331.3 526.6 331.3 526.6 332.2 527.3C333.5 528.2 334.2 528.0 334.4 526.4ZM346.5 527.2C347.6 526.0 345.8 524.4 344.7 525.6C343.9 526.4 344.4 528.0 345.5 528.0C345.7 528.0 346.2 527.7 346.5 527.2ZM310.3 526.7C310.7 525.8 309.7 524.5 308.7 524.5C307.8 524.5 307.3 525.7 307.7 526.8C308.1 527.7 309.9 527.7 310.3 526.7ZM383.3 527.0C383.8 526.1 382.6 525.2 381.9 525.9C381.4 526.4 381.7 527.5 382.5 527.5C382.7 527.5 383.1 527.3 383.3 527.0ZM388.4 524.8C388.7 523.3 387.6 522.6 386.7 523.6C386.0 524.3 385.9 524.6 386.5 525.2C387.3 526.2 388.2 526.0 388.4 524.8ZM327.3 524.7C327.7 523.8 326.7 522.5 325.7 522.5C324.7 522.5 324.3 523.9 325.0 524.8C325.8 525.7 327.0 525.7 327.3 524.7ZM351.8 525.0C352.5 523.9 350.6 522.7 349.7 523.6C348.7 524.5 349.2 525.5 350.5 525.5C351.0 525.5 351.6 525.3 351.8 525.0ZM302.3 524.3C303.1 523.7 303.1 523.5 302.5 522.8C301.7 521.8 301.3 521.8 300.3 522.8C298.7 524.3 300.4 525.7 302.3 524.3ZM315.2 524.3C315.5 523.3 314.8 522.4 313.7 522.6C312.2 522.9 312.1 525.0 313.7 525.0C314.3 525.0 315.0 524.7 315.2 524.3ZM338.9 524.5C339.9 523.9 339.3 522.5 338.1 522.5C337.0 522.5 336.5 523.3 336.9 524.4C337.1 525.1 338.0 525.2 338.9 524.5ZM331.8 520.7C330.5 519.8 329.8 520.0 329.6 521.5C329.3 523.1 330.5 523.7 331.8 522.5C332.7 521.5 332.7 521.4 331.8 520.7ZM393.4 522.3C393.6 521.2 392.7 520.5 391.7 520.8C391.0 521.1 390.8 522.6 391.4 523.2C392.0 523.8 393.2 523.3 393.4 522.3ZM319.2 522.7C320.3 522.3 320.2 520.7 319.2 520.3C317.9 519.8 316.7 521.2 317.5 522.2C318.2 523.1 318.2 523.1 319.2 522.7ZM344.4 521.6C344.5 520.9 344.2 520.5 343.5 520.2C342.0 519.8 341.3 520.9 342.4 522.1C343.4 523.2 344.2 523.0 344.4 521.6ZM356.5 522.2C357.0 521.7 357.0 521.3 356.6 520.9C355.8 520.1 354.5 520.8 354.5 522.0C354.5 523.2 355.6 523.3 356.5 522.2ZM381.0 522.1C381.0 521.0 379.6 520.2 378.8 521.0C378.5 521.3 378.6 521.7 379.0 522.2C379.9 523.3 381.0 523.2 381.0 522.1ZM307.7 521.7C308.2 520.3 308.0 520.0 306.5 520.0C305.7 520.0 305.0 520.2 305.0 520.5C305.0 521.6 305.7 522.5 306.5 522.5C307.0 522.5 307.5 522.1 307.7 521.7ZM295.4 520.6C295.6 519.8 294.1 519.2 293.4 519.9C293.1 520.2 293.0 520.7 293.2 521.0C293.7 521.7 295.1 521.5 295.4 520.6ZM299.9 520.1C300.9 519.4 300.4 517.8 299.1 517.6C297.8 517.4 297.1 518.7 298.0 519.8C298.7 520.6 299.0 520.7 299.9 520.1ZM325.0 519.6C325.0 518.7 324.1 517.5 323.4 517.5C322.8 517.5 321.9 519.5 322.3 520.0C322.8 520.9 325.0 520.6 325.0 519.6ZM337.2 519.0C337.2 517.5 335.2 516.9 334.7 518.2C334.2 519.5 334.9 520.6 336.1 520.4C336.9 520.3 337.2 519.9 337.2 519.0ZM349.4 519.3C349.5 518.8 349.4 518.2 349.1 517.9C348.1 516.9 346.0 518.9 346.8 520.1C347.3 520.9 349.2 520.3 349.4 519.3ZM361.3 519.7C361.5 519.3 361.4 518.7 361.1 518.4C360.4 517.7 358.7 519.1 359.2 520.0C359.7 520.8 361.0 520.6 361.3 519.7ZM385.9 519.6C386.1 518.8 384.6 518.2 383.9 518.9C383.6 519.2 383.5 519.7 383.7 520.0C384.2 520.7 385.6 520.5 385.9 519.6ZM311.7 519.7C312.7 519.3 312.7 518.1 311.7 517.7C310.8 517.3 309.5 518.4 309.8 519.3C310.1 520.1 310.5 520.2 311.7 519.7ZM342.0 516.8C342.0 515.6 340.8 514.7 340.0 515.3C339.3 515.7 339.4 517.9 340.1 518.1C341.2 518.5 342.0 517.9 342.0 516.8ZM378.5 517.5C379.1 516.3 378.8 515.5 377.7 515.5C376.8 515.5 376.3 516.7 376.7 517.8C377.1 518.8 377.9 518.7 378.5 517.5ZM390.9 517.1C391.0 516.3 390.8 516.0 390.1 516.0C388.9 516.0 388.3 516.8 388.7 517.8C389.1 518.9 390.7 518.4 390.9 517.1ZM329.5 517.2C330.6 516.0 328.8 514.4 327.7 515.6C326.9 516.4 327.4 518.0 328.5 518.0C328.7 518.0 329.2 517.7 329.5 517.2ZM353.7 517.3C354.8 516.5 354.4 515.5 353.0 515.5C351.9 515.5 351.3 516.3 351.7 517.3C352.0 518.2 352.5 518.2 353.7 517.3ZM293.3 517.0C293.6 516.4 292.2 514.5 291.4 514.5C290.8 514.5 289.9 516.5 290.3 517.0C290.7 517.7 292.9 517.6 293.3 517.0ZM305.3 516.7C305.6 516.0 304.3 514.6 303.4 514.5C302.6 514.5 302.4 516.0 303.0 516.8C303.8 517.7 305.0 517.7 305.3 516.7ZM317.2 516.3C317.2 515.1 315.6 514.6 315.0 515.5C314.4 516.5 315.0 517.6 316.2 517.4C316.9 517.3 317.2 516.9 317.2 516.3ZM383.5 515.2C384.1 514.6 384.0 514.3 383.4 513.7C382.5 512.8 381.5 513.2 381.5 514.4C381.5 516.1 382.5 516.5 383.5 515.2ZM395.5 515.3C396.2 514.4 395.8 513.5 394.8 513.5C393.9 513.5 393.3 514.4 393.7 515.3C394.0 516.2 394.7 516.2 395.5 515.3ZM309.7 514.7C310.6 513.8 310.2 512.5 308.9 512.5C307.9 512.5 307.2 513.6 307.7 514.8C308.0 515.7 308.7 515.7 309.7 514.7ZM334.8 515.0C335.5 513.9 333.6 512.7 332.7 513.6C331.7 514.5 332.2 515.5 333.5 515.5C334.0 515.5 334.6 515.3 334.8 515.0ZM346.8 514.9C347.3 514.2 345.5 512.8 344.8 513.5C344.2 514.1 344.8 515.5 345.7 515.5C346.1 515.5 346.6 515.2 346.8 514.9ZM358.8 515.0C359.3 514.1 357.6 512.7 356.9 513.4C356.6 513.7 356.5 514.3 356.7 514.7C357.0 515.6 358.3 515.8 358.8 515.0ZM297.5 514.2C298.3 513.2 297.1 511.8 295.8 512.3C294.9 512.7 294.7 514.3 295.6 514.7C296.6 515.1 296.8 515.0 297.5 514.2ZM322.2 513.8C322.2 512.7 320.7 512.1 319.9 512.9C319.0 513.8 319.9 515.1 321.1 514.9C321.9 514.8 322.2 514.4 322.2 513.8ZM285.3 514.0C285.8 513.1 284.6 512.2 283.9 512.9C283.4 513.4 283.7 514.5 284.5 514.5C284.7 514.5 285.1 514.3 285.3 514.0ZM339.2 512.0C339.2 511.4 339.0 510.7 338.6 510.6C337.9 510.4 337.3 511.7 337.7 512.8C338.1 513.9 339.2 513.4 339.2 512.0ZM351.8 511.1C350.9 509.5 349.1 511.1 349.7 512.8C350.0 513.6 350.1 513.6 351.1 512.6C351.7 512.1 352.0 511.4 351.8 511.1ZM363.8 511.1C362.9 509.5 361.1 511.1 361.7 512.8C362.0 513.6 362.1 513.6 363.1 512.6C363.7 512.1 364.0 511.4 363.8 511.1ZM376.2 512.0C376.2 511.2 375.9 510.7 375.4 510.6C374.4 510.4 373.7 511.6 374.2 512.8C374.7 514.0 376.2 513.4 376.2 512.0ZM400.2 512.7C400.7 511.5 400.6 511.0 399.8 511.0C398.9 511.0 398.3 511.8 398.7 512.8C399.1 513.7 399.8 513.7 400.2 512.7ZM315.0 511.4C315.0 510.8 314.6 510.5 314.0 510.5C312.9 510.5 312.3 511.3 312.7 512.2C313.1 513.2 315.0 512.6 315.0 511.4ZM326.7 512.3C327.8 511.5 327.4 510.5 326.0 510.5C324.9 510.5 324.3 511.3 324.7 512.3C325.0 513.2 325.5 513.2 326.7 512.3ZM389.2 511.8C389.2 510.7 387.7 510.1 386.9 510.9C386.0 511.8 386.9 513.1 388.1 512.9C388.9 512.8 389.2 512.4 389.2 511.8ZM290.3 511.7C290.7 510.7 289.5 509.4 288.6 510.0C287.7 510.5 288.3 512.5 289.3 512.5C289.7 512.5 290.2 512.1 290.3 511.7ZM302.8 512.0C303.5 510.9 301.6 509.7 300.7 510.6C299.7 511.5 300.2 512.5 301.5 512.5C302.0 512.5 302.6 512.3 302.8 512.0ZM356.5 510.2C357.1 509.6 357.0 509.3 356.4 508.7C355.5 507.8 354.5 508.2 354.5 509.4C354.5 511.1 355.5 511.5 356.5 510.2ZM381.4 509.8C381.6 508.8 380.1 508.2 379.4 508.9C379.0 509.3 379.0 509.7 379.5 510.2C380.3 511.2 381.2 511.0 381.4 509.8ZM283.2 510.0C283.6 509.4 282.4 507.5 281.6 507.5C280.7 507.5 280.3 508.9 281.0 509.8C281.7 510.6 282.8 510.7 283.2 510.0ZM295.4 508.8C295.2 507.5 293.3 507.1 292.8 508.2C292.7 508.6 292.9 509.3 293.3 509.7C294.3 510.7 295.6 510.1 295.4 508.8ZM307.8 508.1C307.3 507.2 305.2 507.4 304.8 508.2C304.3 509.7 306.0 510.7 307.1 509.6C307.7 509.0 308.0 508.4 307.8 508.1ZM320.4 509.7C320.6 509.1 319.2 507.5 318.4 507.5C317.8 507.5 317.3 508.8 317.7 509.8C318.0 510.7 320.1 510.6 320.4 509.7ZM332.2 509.0C332.2 507.6 330.7 507.0 330.2 508.2C329.7 509.4 330.4 510.6 331.4 510.4C331.9 510.3 332.2 509.8 332.2 509.0ZM344.3 509.7C344.5 509.3 344.4 508.7 344.2 508.5C343.5 507.8 341.7 509.2 342.2 509.9C342.7 510.8 344.0 510.6 344.3 509.7ZM393.9 509.6C394.1 508.8 392.6 508.2 391.9 508.9C391.6 509.2 391.5 509.7 391.7 510.0C392.2 510.7 393.6 510.5 393.9 509.6ZM349.2 507.0C349.2 505.5 348.2 505.1 347.5 506.5C346.8 507.7 347.3 508.6 348.4 508.4C348.9 508.3 349.2 507.8 349.2 507.0ZM361.3 507.8C362.0 506.1 361.1 505.2 359.9 506.4C358.8 507.4 359.0 508.5 360.3 508.5C360.7 508.5 361.2 508.2 361.3 507.8ZM373.5 507.5C374.2 506.2 374.1 506.0 373.0 506.0C371.9 506.0 371.3 506.8 371.7 507.8C372.1 508.8 372.9 508.7 373.5 507.5ZM386.3 507.7C386.7 506.6 385.7 505.6 384.9 506.4C384.3 507.0 384.7 508.5 385.5 508.5C385.8 508.5 386.2 508.1 386.3 507.7ZM398.4 507.6C398.6 506.8 397.1 506.2 396.4 506.9C396.1 507.2 396.0 507.7 396.2 508.0C396.7 508.7 398.1 508.5 398.4 507.6ZM300.5 506.5C300.5 505.3 298.5 504.6 297.9 505.6C297.6 506.0 297.9 506.5 298.6 507.1C299.7 508.1 300.5 507.9 300.5 506.5ZM324.5 507.2C325.0 506.7 325.0 506.3 324.6 505.9C323.8 505.1 322.5 505.8 322.5 507.0C322.5 508.2 323.6 508.3 324.5 507.2ZM336.7 507.3C337.8 506.5 337.4 505.5 336.0 505.5C334.9 505.5 334.3 506.3 334.7 507.3C335.0 508.2 335.5 508.2 336.7 507.3ZM288.0 506.8C288.6 506.0 288.4 504.5 287.6 504.5C286.7 504.6 285.4 506.0 285.7 506.7C286.0 507.7 287.2 507.7 288.0 506.8ZM312.2 506.3C312.2 505.1 311.5 504.8 310.3 505.7C309.1 506.5 309.7 507.6 311.2 507.4C311.8 507.3 312.2 506.9 312.2 506.3ZM366.3 505.2C366.7 504.1 365.7 503.1 364.9 503.9C364.3 504.5 364.7 506.0 365.5 506.0C365.8 506.0 366.2 505.6 366.3 505.2ZM378.5 505.3C379.2 504.4 378.8 503.5 377.8 503.5C376.9 503.5 376.3 504.4 376.7 505.3C377.0 506.2 377.7 506.2 378.5 505.3ZM391.3 505.2C391.7 504.1 390.7 503.1 389.9 503.9C389.3 504.5 389.7 506.0 390.5 506.0C390.8 506.0 391.2 505.6 391.3 505.2ZM403.1 505.4C403.5 504.5 403.0 503.5 402.2 503.5C401.2 503.5 400.8 504.4 401.5 505.3C402.3 506.2 402.8 506.2 403.1 505.4ZM293.4 504.7C293.6 504.1 292.2 502.5 291.4 502.5C290.8 502.5 290.3 503.8 290.7 504.8C291.0 505.7 293.1 505.6 293.4 504.7ZM305.2 504.0C305.2 502.5 303.2 501.9 302.7 503.2C302.2 504.5 302.9 505.6 304.1 505.4C304.9 505.3 305.2 504.9 305.2 504.0ZM317.2 504.0C317.2 502.5 316.2 502.1 315.5 503.5C314.8 504.7 315.3 505.6 316.4 505.4C316.9 505.3 317.2 504.8 317.2 504.0ZM329.8 505.0C330.3 504.1 328.6 502.7 327.9 503.4C327.6 503.7 327.5 504.3 327.7 504.7C328.0 505.6 329.3 505.8 329.8 505.0ZM341.8 505.0C342.3 504.1 340.6 502.7 339.9 503.4C339.6 503.7 339.5 504.3 339.7 504.7C340.0 505.6 341.3 505.8 341.8 505.0ZM354.4 504.6C354.6 503.8 353.1 503.2 352.4 503.9C352.1 504.2 352.0 504.7 352.2 505.0C352.7 505.7 354.1 505.5 354.4 504.6ZM280.3 503.3C280.2 502.9 279.6 502.5 279.0 502.5C277.7 502.5 277.6 504.3 278.9 504.6C280.0 504.9 280.7 504.3 280.3 503.3ZM334.8 501.1C333.9 499.5 332.1 501.1 332.7 502.8C333.0 503.6 333.1 503.6 334.1 502.6C334.7 502.1 335.0 501.4 334.8 501.1ZM346.8 502.0C346.8 500.6 345.2 500.0 344.7 501.2C344.2 502.4 344.9 503.6 345.9 503.4C346.4 503.3 346.8 502.8 346.8 502.0ZM359.2 502.3C359.2 501.2 357.7 500.6 356.9 501.4C356.0 502.3 356.9 503.6 358.1 503.4C358.9 503.3 359.2 502.9 359.2 502.3ZM371.3 502.8C372.0 501.1 371.1 500.2 369.9 501.4C368.8 502.4 369.0 503.5 370.3 503.5C370.7 503.5 371.2 503.2 371.3 502.8ZM383.3 502.7C383.7 501.6 382.7 500.6 381.9 501.4C381.3 502.0 381.7 503.5 382.5 503.5C382.8 503.5 383.2 503.1 383.3 502.7ZM396.2 502.5C396.2 501.6 394.6 501.2 393.9 501.9C393.6 502.2 393.5 502.7 393.7 503.0C394.2 503.8 396.2 503.4 396.2 502.5ZM297.7 502.3C298.8 501.5 298.4 500.5 297.0 500.5C295.9 500.5 295.3 501.3 295.7 502.3C296.0 503.2 296.5 503.2 297.7 502.3ZM309.7 502.3C310.8 501.5 310.4 500.5 309.0 500.5C307.9 500.5 307.3 501.3 307.7 502.3C308.0 503.2 308.5 503.2 309.7 502.3ZM285.3 501.7C285.5 501.3 285.4 500.7 285.1 500.4C284.4 499.7 282.7 501.1 283.2 502.0C283.7 502.8 285.0 502.6 285.3 501.7ZM322.4 501.6C322.6 500.8 321.1 500.2 320.4 500.9C320.1 501.2 320.0 501.7 320.2 502.0C320.7 502.7 322.1 502.5 322.4 501.6ZM326.5 500.2C327.1 499.6 327.0 499.3 326.4 498.7C325.5 497.8 324.5 498.2 324.5 499.4C324.5 501.1 325.5 501.5 326.5 500.2ZM351.5 500.3C352.2 499.4 351.8 498.5 350.8 498.5C349.9 498.5 349.3 499.4 349.7 500.3C350.0 501.2 350.7 501.2 351.5 500.3ZM364.2 499.8C364.2 498.7 362.7 498.1 361.9 498.9C361.0 499.8 361.9 501.1 363.1 500.9C363.9 500.8 364.2 500.4 364.2 499.8ZM376.3 500.2C376.7 499.1 375.7 498.1 374.9 498.9C374.3 499.5 374.7 501.0 375.5 501.0C375.8 501.0 376.2 500.6 376.3 500.2ZM388.3 500.2C388.7 499.1 387.7 498.1 386.9 498.9C386.3 499.5 386.7 501.0 387.5 501.0C387.8 501.0 388.2 500.6 388.3 500.2ZM400.3 500.5C400.8 499.6 399.6 498.7 398.9 499.4C398.4 499.9 398.7 501.0 399.5 501.0C399.7 501.0 400.1 500.8 400.3 500.5ZM278.2 499.0C278.2 498.1 277.9 497.7 277.1 497.6C275.9 497.4 275.2 498.5 275.7 499.8C276.2 501.1 278.2 500.5 278.2 499.0ZM302.3 499.7C302.7 498.6 301.7 497.6 300.9 498.4C300.3 499.0 300.7 500.5 301.5 500.5C301.8 500.5 302.2 500.1 302.3 499.7ZM315.2 499.3C315.2 498.2 313.7 497.6 312.9 498.4C312.0 499.3 312.9 500.6 314.1 500.4C314.9 500.3 315.2 499.9 315.2 499.3ZM339.4 499.6C339.6 498.8 338.1 498.2 337.4 498.9C337.1 499.2 337.0 499.7 337.2 500.0C337.7 500.7 339.1 500.5 339.4 499.6ZM290.2 498.8C290.2 497.3 288.3 497.4 288.1 498.9C287.9 499.9 288.1 500.1 289.1 499.9C289.9 499.8 290.2 499.4 290.2 498.8ZM307.2 497.0C307.2 495.6 306.1 495.1 305.7 496.2C305.3 497.3 305.9 498.6 306.6 498.4C307.0 498.3 307.2 497.6 307.2 497.0ZM319.5 497.5C320.1 496.3 319.8 495.5 318.7 495.5C317.8 495.5 317.3 496.7 317.7 497.8C318.1 498.8 318.9 498.7 319.5 497.5ZM331.2 497.0C331.2 495.6 330.1 495.1 329.7 496.2C329.3 497.3 329.9 498.6 330.6 498.4C331.0 498.3 331.2 497.6 331.2 497.0ZM344.2 497.0C344.2 496.4 344.0 495.7 343.6 495.6C342.9 495.4 342.3 496.7 342.7 497.8C343.1 498.9 344.2 498.4 344.2 497.0ZM356.3 497.7C356.7 496.6 355.7 495.6 354.9 496.4C354.3 497.0 354.7 498.5 355.5 498.5C355.8 498.5 356.2 498.1 356.3 497.7ZM369.4 497.6C369.6 496.8 368.1 496.2 367.4 496.9C367.1 497.2 367.0 497.7 367.2 498.0C367.7 498.7 369.1 498.5 369.4 497.6ZM381.4 497.6C381.6 496.8 380.1 496.2 379.4 496.9C379.1 497.2 379.0 497.7 379.2 498.0C379.7 498.7 381.1 498.5 381.4 497.6ZM393.5 497.5C393.5 496.8 393.2 496.5 392.5 496.5C391.8 496.5 391.5 496.8 391.5 497.5C391.5 498.2 391.8 498.5 392.5 498.5C393.2 498.5 393.5 498.2 393.5 497.5ZM295.4 496.8C295.7 495.3 294.6 494.6 293.7 495.6C293.0 496.3 292.9 496.6 293.5 497.2C294.3 498.2 295.2 498.0 295.4 496.8ZM283.2 496.3C283.2 495.1 282.5 494.8 281.3 495.7C280.1 496.5 280.7 497.6 282.2 497.4C282.8 497.3 283.2 496.9 283.2 496.3ZM386.2 495.2C386.2 494.6 385.9 494.2 385.1 494.1C384.0 493.9 383.5 495.3 384.4 496.2C385.0 496.8 386.2 496.2 386.2 495.2ZM324.5 495.3C325.2 494.4 324.8 493.5 323.5 493.5C323.0 493.5 322.4 493.7 322.2 494.0C321.9 494.6 322.8 496.0 323.5 496.0C323.7 496.0 324.1 495.7 324.5 495.3ZM336.5 494.7C336.5 493.7 335.1 493.2 334.3 494.0C333.9 494.4 334.0 494.7 334.7 495.3C335.8 496.0 336.5 495.8 336.5 494.7ZM349.4 494.8C349.6 493.8 348.1 493.2 347.4 493.9C347.0 494.3 347.0 494.7 347.5 495.2C348.3 496.2 349.2 496.0 349.4 494.8ZM361.5 495.3C362.2 494.4 361.8 493.5 360.8 493.5C359.9 493.5 359.3 494.4 359.7 495.3C360.0 496.2 360.7 496.2 361.5 495.3ZM374.2 495.5C374.4 495.3 374.1 494.7 373.7 494.3C372.6 493.2 371.5 494.1 372.5 495.2C373.2 496.1 373.8 496.2 374.2 495.5ZM275.8 493.1C274.9 491.5 273.1 493.1 273.7 494.8C274.0 495.6 274.1 495.6 275.1 494.6C275.7 494.1 276.0 493.4 275.8 493.1ZM288.2 494.3C288.2 493.2 286.7 492.6 285.9 493.4C285.0 494.3 285.9 495.6 287.1 495.4C287.9 495.3 288.2 494.9 288.2 494.3ZM300.2 494.0C300.2 492.5 299.2 492.1 298.5 493.5C297.8 494.7 298.3 495.6 299.4 495.4C299.9 495.3 300.2 494.8 300.2 494.0ZM312.8 495.0C313.3 494.1 311.6 492.7 310.9 493.4C310.6 493.7 310.5 494.3 310.7 494.7C311.0 495.6 312.3 495.8 312.8 495.0ZM317.2 492.0C317.2 491.4 317.0 490.7 316.6 490.6C315.9 490.4 315.3 491.7 315.7 492.8C316.1 493.9 317.2 493.4 317.2 492.0ZM329.3 492.7C329.5 492.3 329.4 491.7 329.1 491.4C328.4 490.7 326.7 492.1 327.2 493.0C327.7 493.8 329.0 493.6 329.3 492.7ZM354.4 492.6C354.6 491.8 353.1 491.2 352.4 491.9C352.1 492.2 352.0 492.7 352.2 493.0C352.7 493.7 354.1 493.5 354.4 492.6ZM366.5 492.5C366.5 491.8 366.2 491.5 365.5 491.5C364.8 491.5 364.5 491.8 364.5 492.5C364.5 493.2 364.8 493.5 365.5 493.5C366.2 493.5 366.5 493.2 366.5 492.5ZM292.7 492.3C293.8 491.5 293.4 490.5 292.0 490.5C290.9 490.5 290.3 491.3 290.7 492.3C291.0 493.2 291.5 493.2 292.7 492.3ZM305.2 491.8C305.2 490.7 303.7 490.1 302.9 490.9C302.0 491.8 302.9 493.1 304.1 492.9C304.9 492.8 305.2 492.4 305.2 491.8ZM342.0 492.0C342.0 491.3 341.7 491.0 341.0 491.0C340.3 491.0 340.0 491.3 340.0 492.0C340.0 492.7 340.3 493.0 341.0 493.0C341.7 493.0 342.0 492.7 342.0 492.0ZM280.8 491.9C281.3 491.2 279.5 489.8 278.8 490.5C278.2 491.1 278.8 492.5 279.7 492.5C280.1 492.5 280.6 492.2 280.8 491.9ZM321.7 490.7C322.8 489.7 322.5 488.8 321.1 488.6C319.9 488.4 319.2 489.5 319.7 490.8C320.1 491.7 320.7 491.7 321.7 490.7ZM334.0 490.0C334.0 488.8 332.7 488.1 331.9 488.9C331.1 489.7 331.8 491.0 333.0 491.0C333.7 491.0 334.0 490.7 334.0 490.0ZM359.3 490.2C359.7 489.1 358.7 488.1 357.9 488.9C357.3 489.5 357.7 491.0 358.5 491.0C358.8 491.0 359.2 490.6 359.3 490.2ZM273.2 489.0C273.2 488.1 272.9 487.7 272.1 487.6C270.9 487.4 270.5 488.8 271.6 489.9C272.5 490.8 273.2 490.3 273.2 489.0ZM285.2 489.0C285.2 488.4 285.0 487.7 284.6 487.6C283.9 487.4 283.3 488.7 283.7 489.8C284.1 490.9 285.2 490.4 285.2 489.0ZM298.3 489.9C298.6 489.4 297.3 488.0 296.4 488.0C295.9 488.0 295.9 489.7 296.3 490.2C296.9 490.7 297.9 490.6 298.3 489.9ZM310.2 489.0C310.2 487.6 308.7 487.0 308.2 488.2C307.7 489.4 308.4 490.6 309.4 490.4C309.9 490.3 310.2 489.8 310.2 489.0ZM346.9 489.6C347.1 488.8 345.6 488.2 344.9 488.9C344.6 489.2 344.5 489.7 344.7 490.0C345.2 490.7 346.6 490.5 346.9 489.6ZM302.8 486.1C301.9 484.5 300.1 486.1 300.7 487.8C301.0 488.6 301.1 488.6 302.1 487.6C302.7 487.1 303.0 486.4 302.8 486.1ZM314.8 487.0C314.8 486.2 314.4 485.7 313.9 485.6C312.9 485.4 312.2 486.6 312.7 487.8C313.2 489.0 314.8 488.4 314.8 487.0ZM326.9 487.6C327.1 486.8 325.6 486.2 324.9 486.9C324.6 487.2 324.5 487.7 324.7 488.0C325.2 488.7 326.6 488.5 326.9 487.6ZM339.4 487.6C339.6 486.8 338.1 486.2 337.4 486.9C337.1 487.2 337.0 487.7 337.2 488.0C337.7 488.7 339.1 488.5 339.4 487.6ZM278.3 486.7C278.5 486.3 278.4 485.7 278.2 485.5C277.5 484.8 275.7 486.2 276.2 486.9C276.7 487.8 278.0 487.6 278.3 486.7ZM290.5 486.5C290.5 485.8 290.2 485.5 289.5 485.5C288.8 485.5 288.5 485.8 288.5 486.5C288.5 487.2 288.8 487.5 289.5 487.5C290.2 487.5 290.5 487.2 290.5 486.5ZM331.5 485.4C332.3 484.1 331.5 483.3 330.3 484.2C329.7 484.6 329.5 485.2 329.7 485.7C330.1 486.8 330.9 486.7 331.5 485.4ZM343.9 485.1C344.0 484.3 343.8 484.0 343.1 484.0C341.9 484.0 341.3 484.8 341.7 485.8C342.1 486.9 343.7 486.4 343.9 485.1ZM271.3 484.9C271.6 484.4 270.3 483.0 269.4 483.0C268.8 483.0 268.9 484.2 269.6 484.9C270.4 485.7 270.8 485.7 271.3 484.9ZM283.2 484.0C283.2 483.2 282.9 482.7 282.4 482.6C281.4 482.4 280.7 483.6 281.2 484.8C281.7 486.0 283.2 485.4 283.2 484.0ZM295.2 484.0C295.2 482.5 294.4 482.2 293.6 483.5C292.9 484.7 293.2 485.6 294.4 485.4C294.9 485.3 295.2 484.8 295.2 484.0ZM307.9 484.6C308.1 483.8 306.6 483.2 305.9 483.9C305.6 484.2 305.5 484.7 305.7 485.0C306.2 485.7 307.6 485.5 307.9 484.6ZM276.0 482.0C276.0 480.8 274.7 480.1 273.8 481.0C273.4 481.4 273.5 481.7 274.2 482.3C275.5 483.3 276.0 483.2 276.0 482.0ZM288.2 482.5C288.4 482.3 288.1 481.7 287.7 481.3C286.6 480.2 285.5 481.1 286.5 482.2C287.2 483.1 287.8 483.2 288.2 482.5ZM300.4 481.8C300.6 480.8 299.1 480.2 298.4 480.9C298.0 481.3 298.0 481.7 298.5 482.2C299.3 483.2 300.2 483.0 300.4 481.8ZM709.0 478.6C709.0 475.0 706.3 472.3 699.1 468.8C697.3 467.9 697.4 450.5 699.1 450.5C699.8 450.5 700.5 450.7 700.8 450.9C701.7 451.7 707.9 452.5 709.1 452.0C709.7 451.8 711.1 451.4 712.1 451.3C713.1 451.1 714.2 450.6 714.5 450.2C714.8 449.8 715.4 449.5 715.7 449.5C717.9 449.5 722.5 442.4 723.7 437.2C724.7 432.6 724.8 416.8 723.9 414.9C722.9 413.0 721.8 411.8 720.6 411.1C717.4 409.3 716.6 411.6 716.6 421.8C716.6 436.7 713.4 441.8 704.0 441.6C700.7 441.6 699.6 441.3 696.9 439.9C696.4 439.7 695.7 439.5 695.4 439.5C695.0 439.5 694.3 439.1 693.7 438.6C693.2 438.1 692.0 437.2 691.0 436.5C687.5 434.0 679.5 425.5 679.5 424.2C679.5 424.0 678.8 422.9 678.0 421.7C677.2 420.5 676.5 419.3 676.5 419.2C676.5 418.9 675.6 416.8 674.3 413.8C673.9 412.9 673.3 411.0 673.0 409.5C672.7 408.0 672.2 406.0 671.9 405.1C671.7 404.2 671.4 399.5 671.4 394.6C671.4 383.0 668.7 377.4 664.5 380.5C662.3 382.1 663.6 403.9 666.4 412.2C667.8 416.5 672.7 426.6 673.8 427.5C674.2 427.9 674.5 428.3 674.5 428.6C674.5 429.9 684.2 440.7 688.2 443.9C689.6 445.0 689.6 445.0 689.7 454.0C689.8 464.2 690.0 463.8 685.8 461.0C682.2 458.7 681.0 458.3 679.9 459.3C677.3 461.7 679.8 466.2 685.6 469.4C689.4 471.5 689.8 471.8 690.0 472.0C690.1 472.1 691.1 472.7 692.2 473.3C694.8 474.6 696.7 475.7 697.0 476.0C697.1 476.1 697.9 476.6 698.8 477.0C699.6 477.4 701.2 478.4 702.4 479.2C706.4 481.8 709.0 481.6 709.0 478.6ZM280.3 479.7C280.7 478.6 279.7 477.6 278.9 478.4C278.3 479.0 278.7 480.5 279.5 480.5C279.8 480.5 280.2 480.1 280.3 479.7ZM293.4 479.6C293.6 478.8 292.1 478.2 291.4 478.9C291.1 479.2 291.0 479.7 291.2 480.0C291.7 480.7 293.1 480.5 293.4 479.6ZM268.2 478.0C268.1 477.7 267.7 477.5 267.5 477.5C266.9 477.5 266.8 479.2 267.3 479.7C267.8 480.2 268.6 478.6 268.2 478.0ZM285.5 477.5C286.1 476.3 285.8 475.5 284.7 475.5C283.8 475.5 283.3 476.7 283.7 477.8C284.1 478.8 284.9 478.7 285.5 477.5ZM290.3 475.0C290.8 474.1 289.6 473.2 288.9 473.9C288.4 474.4 288.7 475.5 289.5 475.5C289.7 475.5 290.1 475.3 290.3 475.0ZM316.7 447.0C319.4 445.7 322.0 444.3 322.4 443.9C322.9 443.5 324.4 442.7 325.8 442.0C327.1 441.3 329.1 440.2 330.2 439.5C331.4 438.9 333.9 437.4 336.0 436.4C338.0 435.3 340.0 434.2 340.3 433.9C340.7 433.6 342.7 432.5 344.9 431.4C347.0 430.3 349.1 429.1 349.5 428.8C349.9 428.4 351.1 427.8 352.2 427.5C356.8 426.0 356.5 428.1 356.4 396.2C356.2 367.9 356.2 367.9 355.0 367.0C353.2 365.6 350.3 366.4 345.5 369.6C344.5 370.2 342.6 371.3 341.2 372.0C339.9 372.7 337.9 373.8 336.8 374.5C335.6 375.1 333.1 376.6 331.0 377.6C328.9 378.7 326.9 379.9 326.5 380.2C326.1 380.5 324.6 381.3 323.2 382.0C321.9 382.7 319.9 383.8 318.8 384.5C315.7 386.4 312.4 388.0 311.6 388.0C311.2 388.0 310.2 388.7 309.5 389.6C308.0 391.1 308.0 391.1 308.0 418.7C308.0 449.1 308.0 448.5 311.8 449.5C311.8 449.5 314.1 448.4 316.7 447.0ZM392.6 437.9C393.8 437.3 394.8 436.6 394.9 436.4C395.0 436.2 395.3 436.0 395.6 436.0C395.9 436.0 396.7 435.6 397.4 435.1C398.2 434.5 399.6 433.6 400.6 433.1C401.7 432.5 403.3 431.5 404.4 430.9C405.4 430.4 406.8 429.5 407.6 428.9C408.3 428.4 409.1 428.0 409.2 428.0C409.4 428.0 410.6 427.3 411.8 426.5C412.9 425.7 414.1 425.0 414.2 425.0C414.4 425.0 415.6 424.3 416.8 423.5C417.9 422.7 419.1 422.0 419.3 422.0C419.4 422.0 420.2 421.6 420.9 421.1C421.7 420.5 423.1 419.6 424.1 419.1C425.2 418.5 426.8 417.6 427.8 417.0C428.7 416.4 430.3 415.5 431.4 414.9C432.4 414.4 433.8 413.5 434.6 412.9C435.3 412.4 436.1 412.0 436.2 412.0C436.4 412.0 437.6 411.3 438.8 410.5C439.9 409.7 441.1 409.0 441.2 409.0C441.4 409.0 442.6 408.3 443.8 407.5C444.9 406.7 446.1 406.0 446.3 406.0C446.4 406.0 447.2 405.6 447.9 405.1C449.2 404.2 450.0 403.7 454.9 400.9C455.9 400.4 457.0 399.7 457.2 399.5C457.5 399.3 458.6 398.6 459.6 398.1C464.5 395.3 465.3 394.8 466.6 393.9C467.3 393.4 468.1 393.0 468.2 393.0C468.4 393.0 469.6 392.3 470.8 391.5C471.9 390.7 473.1 390.0 473.2 390.0C473.4 390.0 474.6 389.3 475.8 388.5C476.9 387.7 478.1 387.0 478.3 387.0C478.4 387.0 479.2 386.6 479.9 386.1C481.2 385.2 482.0 384.7 486.9 381.9C487.9 381.4 489.0 380.7 489.2 380.5C489.5 380.3 490.6 379.6 491.6 379.1C496.5 376.3 497.3 375.8 498.6 374.9C499.3 374.4 500.1 374.0 500.2 374.0C500.4 374.0 501.6 373.3 502.8 372.5C503.9 371.7 505.1 371.0 505.2 371.0C505.4 371.0 506.6 370.3 507.7 369.5C508.9 368.7 510.1 368.0 510.3 368.0C510.4 368.0 511.2 367.6 511.9 367.1C512.7 366.5 514.1 365.6 515.1 365.1C516.2 364.5 517.8 363.6 518.8 363.0C519.7 362.4 521.3 361.5 522.4 360.9C523.4 360.4 524.8 359.5 525.6 358.9C526.3 358.4 527.1 358.0 527.2 358.0C527.4 358.0 528.6 357.3 529.8 356.5C530.9 355.7 532.1 355.0 532.2 355.0C532.4 355.0 533.6 354.3 534.8 353.5C535.9 352.7 537.1 352.0 537.3 352.0C537.4 352.0 538.2 351.6 538.9 351.1C539.7 350.5 541.1 349.6 542.1 349.1C543.2 348.5 544.8 347.5 545.9 346.9C546.9 346.4 548.3 345.5 549.0 345.0C549.7 344.6 550.9 343.9 551.7 343.5C555.8 341.4 560.3 335.8 562.2 330.2C563.7 326.0 564.4 320.3 563.6 319.8C563.3 319.6 563.0 319.0 563.0 318.6C563.0 314.8 555.7 313.4 551.4 316.4C550.1 317.3 548.9 318.0 548.8 318.0C548.6 318.0 547.5 318.6 546.3 319.4C545.2 320.2 543.5 321.2 542.6 321.5C541.7 321.9 541.0 322.4 541.0 322.6C541.0 322.8 540.8 323.0 540.5 323.0C540.2 323.0 539.3 323.4 538.6 323.9C537.8 324.5 536.4 325.4 535.4 325.9C534.3 326.5 532.7 327.5 531.6 328.1C530.6 328.6 529.2 329.5 528.4 330.1C527.7 330.6 526.9 331.0 526.8 331.0C526.6 331.0 525.4 331.7 524.2 332.5C523.1 333.3 521.9 334.0 521.8 334.0C521.6 334.0 520.4 334.7 519.2 335.5C518.1 336.3 516.9 337.0 516.8 337.0C516.6 337.0 515.5 337.6 514.3 338.4C513.2 339.2 511.6 340.1 510.8 340.5C509.9 340.9 509.1 341.4 509.0 341.5C508.8 341.7 508.4 342.0 504.6 344.1C503.6 344.7 502.2 345.5 501.4 346.1C500.7 346.6 499.9 347.0 499.8 347.0C499.6 347.0 498.4 347.7 497.2 348.5C496.1 349.3 494.9 350.0 494.7 350.0C494.6 350.0 493.4 350.7 492.2 351.5C491.1 352.3 489.9 353.0 489.7 353.0C489.6 353.0 488.8 353.4 488.1 353.9C486.8 354.8 486.0 355.3 481.1 358.1C480.1 358.6 479.0 359.3 478.8 359.5C478.5 359.7 477.4 360.4 476.4 360.9C471.5 363.7 470.7 364.2 469.4 365.1C468.7 365.6 467.9 366.0 467.8 366.0C467.6 366.0 466.4 366.7 465.2 367.5C464.1 368.3 462.9 369.0 462.8 369.0C462.6 369.0 461.4 369.7 460.2 370.5C459.1 371.3 457.9 372.0 457.7 372.0C457.6 372.0 456.8 372.4 456.1 372.9C455.3 373.5 453.9 374.4 452.9 374.9C451.8 375.5 450.2 376.4 449.2 377.0C448.3 377.6 446.7 378.5 445.6 379.1C444.6 379.6 443.2 380.5 442.4 381.1C441.7 381.6 440.9 382.0 440.8 382.0C440.6 382.0 439.4 382.7 438.2 383.5C437.1 384.3 435.9 385.0 435.8 385.0C435.6 385.0 434.4 385.7 433.2 386.5C432.1 387.3 430.9 388.0 430.7 388.0C430.6 388.0 429.8 388.4 429.1 388.9C427.8 389.8 427.0 390.3 422.1 393.1C421.1 393.6 420.0 394.3 419.8 394.5C419.5 394.7 418.4 395.4 417.4 395.9C412.5 398.7 411.7 399.2 410.4 400.1C409.7 400.6 408.9 401.0 408.8 401.0C408.6 401.0 407.4 401.7 406.2 402.5C405.1 403.3 403.9 404.0 403.8 404.0C403.6 404.0 402.4 404.7 401.2 405.5C400.1 406.3 398.9 407.0 398.8 407.0C398.6 407.0 397.4 407.7 396.2 408.5C395.1 409.3 393.8 410.0 393.6 410.0C392.8 410.0 386.5 416.0 385.9 417.2C385.7 417.8 385.1 418.9 384.6 419.8C378.0 430.8 383.2 442.7 392.6 437.9ZM708.1 431.8C712.2 427.7 712.2 427.7 712.3 402.0C712.4 389.0 712.2 378.9 711.9 377.0C711.3 372.8 709.0 365.5 708.4 365.5C708.1 365.5 708.0 365.2 708.2 364.7C708.4 364.3 708.2 363.8 707.7 363.7C707.3 363.5 707.1 363.1 707.2 362.7C707.3 362.3 707.0 361.8 706.5 361.5C705.9 361.2 705.5 360.7 705.5 360.4C705.5 359.8 703.4 357.3 700.6 354.2C697.5 351.0 692.3 347.5 690.5 347.5C690.0 347.5 689.4 347.3 689.2 347.0C688.7 346.1 684.1 346.4 682.1 347.6C678.7 349.5 676.9 351.9 676.0 355.9C675.4 359.2 675.3 401.8 676.0 404.8C676.3 406.2 676.7 407.8 676.8 408.4C676.9 409.0 677.2 410.0 677.5 410.7C677.8 411.4 677.9 412.0 677.7 412.0C677.1 412.0 682.2 420.8 684.4 423.6C687.9 428.1 694.7 433.5 696.7 433.5C697.1 433.5 697.6 433.7 697.8 434.0C697.9 434.3 699.7 434.5 701.7 434.5C705.4 434.5 705.4 434.5 708.1 431.8Z"/><path fill="#eee" fill-rule="evenodd" d="M508.8 695.5C508.2 695.3 500.8 695.0 492.2 694.8C483.7 694.6 475.3 694.2 473.5 694.0C469.8 693.4 467.7 693.2 456.9 692.5C452.5 692.3 448.7 691.9 448.4 691.7C448.1 691.5 444.3 691.0 440.0 690.7C435.7 690.3 431.6 689.8 430.9 689.6C430.3 689.3 427.5 688.9 424.7 688.7C422.0 688.5 419.0 688.1 418.0 687.7C417.0 687.4 414.6 687.0 412.7 686.8C410.7 686.6 408.4 686.2 407.7 685.9C406.9 685.6 405.9 685.3 405.5 685.2C401.4 684.6 398.3 683.9 397.8 683.5C397.4 683.2 396.9 683.0 396.7 683.1C395.9 683.3 392.2 682.4 391.2 681.8C390.7 681.4 389.3 681.0 388.2 680.8C387.0 680.6 385.7 680.1 385.2 679.7C384.7 679.3 383.9 679.0 383.5 679.0C379.5 678.9 371.5 672.4 371.2 669.0C370.7 663.8 378.8 657.3 388.5 655.1C389.7 654.8 392.8 654.0 395.2 653.2C397.7 652.5 401.4 651.6 403.5 651.3C405.6 650.9 407.8 650.4 408.5 650.1C409.2 649.8 411.4 649.4 413.3 649.2C415.2 649.0 417.2 648.7 417.7 648.4C418.1 648.1 421.5 647.6 425.2 647.2C428.8 646.9 432.8 646.3 434.0 646.1C435.2 645.8 438.8 645.4 442.0 645.2C445.2 645.0 448.3 644.6 449.0 644.4C449.7 644.1 455.3 643.6 461.5 643.2C467.7 642.8 474.1 642.3 475.6 642.1C477.2 641.8 486.0 641.4 495.1 641.3C504.3 641.1 513.3 640.7 515.2 640.5C519.7 639.9 559.6 639.9 564.2 640.5C566.2 640.7 574.8 641.1 583.5 641.3C597.6 641.6 602.9 641.9 607.8 642.6C608.6 642.8 613.0 643.0 617.5 643.2C622.0 643.4 626.9 643.8 628.2 644.1C630.8 644.7 631.2 644.7 639.0 645.2C641.6 645.4 644.9 645.9 646.2 646.3C647.6 646.6 651.3 647.2 654.4 647.4C657.5 647.7 660.3 648.1 660.6 648.4C661.0 648.7 663.2 649.0 665.6 649.2C667.9 649.4 670.4 649.9 671.1 650.2C671.8 650.6 673.8 651.1 675.6 651.2C677.3 651.4 679.4 651.9 680.2 652.3C681.1 652.6 682.8 653.1 684.0 653.3C685.2 653.5 686.8 653.9 687.5 654.2C688.2 654.6 689.7 655.0 690.8 655.2C692.0 655.4 693.3 655.9 693.8 656.3C694.3 656.7 695.1 657.0 695.4 657.0C699.4 657.1 708.5 664.6 708.5 667.8C708.5 672.3 700.2 678.5 691.2 680.7C689.8 681.0 688.4 681.5 688.0 681.8C687.0 682.4 681.0 683.9 676.5 684.7C674.4 685.1 672.2 685.6 671.5 685.9C670.8 686.2 668.6 686.5 666.5 686.8C664.4 687.0 662.2 687.3 661.5 687.6C660.8 687.9 657.7 688.4 654.5 688.8C651.3 689.1 647.5 689.7 646.0 690.0C644.5 690.2 640.7 690.7 637.5 690.9C634.3 691.2 630.6 691.7 629.2 692.0C627.9 692.2 622.6 692.7 617.5 693.0C612.4 693.3 606.7 693.7 604.8 694.0C602.8 694.2 595.0 694.6 587.2 694.8C579.5 694.9 572.4 695.3 571.4 695.5C569.0 696.0 510.1 696.0 508.8 695.5Z"/></svg>`;
window.openPersonalInfo = function(){
  openSheet('Personal Information', `
    <div class="ck-pi-art" aria-hidden="true">${CK_PW_ART}</div>
    <div class="ck-pi-card">
      <button class="ck-pi-row" type="button" onclick="openWalletSheet()"><span class="ck-pi-ic"><svg viewBox="0 0 60 54" width="21.7" height="19.5" aria-hidden="true"><rect x="11" y="11" width="43.5" height="32" rx="4" fill="#8056f8"/><rect x="4" y="17" width="44" height="32" rx="4" fill="#f56b2c"/><rect x="4" y="24" width="44" height="4.6" fill="#fff5e7"/><rect x="8" y="37" width="8.4" height="6" rx=".7" fill="#fff5e7"/></svg></span><b>Bind Wallet Card</b>${CK_MENU_ICONS.chev}</button>
      <button class="ck-pi-row" type="button" onclick="openChangeLoginPasswordSheet()"><span class="ck-pi-ic"><svg viewBox="0 0 60 74" width="21.7" height="26.7" aria-hidden="true"><path fill="#54ba92" fill-rule="evenodd" d="M8.7 66.8C8.2 66.7 8.2 67.5 8.2 51.3C8.2 36.4 8.2 36.4 8.5 36.2C8.7 36.0 8.8 36.0 10.5 35.9C12.5 35.9 12.8 35.9 13.3 35.6C13.9 35.2 13.9 35.1 13.9 29.7C13.9 25.8 13.9 24.6 14.1 24.1C14.1 23.7 14.2 23.3 14.2 23.0C14.2 22.5 14.3 22.3 14.7 21.9C14.9 21.7 14.9 21.5 15.0 21.0C15.0 19.8 15.2 19.3 16.1 18.3C16.6 17.8 17.0 17.3 17.1 17.1C17.4 16.7 19.7 14.4 20.1 14.1C20.3 14.1 20.6 13.8 20.8 13.6C21.0 13.5 21.3 13.2 21.6 13.1C21.8 13.1 22.2 12.8 22.5 12.6C22.9 12.3 23.1 12.3 23.8 12.2C24.6 12.1 24.8 12.1 25.2 11.8C25.7 11.5 25.7 11.5 26.5 11.5C27.1 11.6 27.3 11.6 27.9 11.4C29.0 11.1 30.6 11.1 31.4 11.5C31.9 11.8 32.3 11.9 32.9 11.9C33.9 12.0 34.7 12.3 35.2 12.7C35.4 12.9 35.8 13.1 36.2 13.2C36.5 13.3 37.0 13.5 37.2 13.7C37.5 13.9 38.1 14.3 38.5 14.6C39.4 15.1 40.6 16.2 40.9 16.7C41.0 16.9 41.2 17.2 41.4 17.4C41.5 17.7 41.8 18.0 41.9 18.2C41.9 18.4 42.2 18.7 42.3 18.9C42.5 19.1 42.8 19.5 42.9 20.0C43.0 20.3 43.3 21.0 43.5 21.4C43.8 22.1 43.8 22.4 43.9 23.3C43.9 24.0 44.0 24.5 44.2 24.8C44.4 25.3 44.4 25.5 44.5 30.3C44.5 33.1 44.6 35.4 44.6 35.5C44.8 35.8 45.3 35.9 47.4 35.9C49.7 36.0 49.7 36.0 49.8 36.7C49.9 37.4 49.9 66.0 49.8 66.4C49.7 66.6 49.6 66.7 49.4 66.8C49.1 66.9 9.3 66.9 8.7 66.8ZM33.8 61.7C34.3 61.2 34.2 60.1 33.4 57.9C33.3 57.7 33.2 57.1 33.2 56.4C33.1 55.5 33.1 55.3 32.9 55.0C32.5 54.5 32.5 54.3 32.5 53.9C32.6 53.6 32.5 53.3 32.3 52.9C32.0 52.2 32.1 51.6 32.4 51.2C33.6 49.7 34.1 48.5 34.1 46.7C34.1 46.0 34.1 45.3 34.0 45.2C33.8 44.7 32.2 43.1 31.7 42.9C31.5 42.8 31.1 42.6 31.0 42.4C30.6 42.1 30.3 42.0 29.1 42.1C28.3 42.2 28.0 42.2 27.7 42.4C27.5 42.5 27.1 42.7 26.8 42.8C26.3 43.0 26.1 43.1 25.9 43.5C25.7 43.8 25.2 44.4 24.8 44.7L24.1 45.4L24.1 46.6C24.1 47.7 24.1 47.8 24.4 48.4C24.6 48.8 24.8 49.2 24.8 49.5C24.9 49.7 25.2 50.2 25.4 50.5C26.1 51.5 26.2 51.8 26.0 52.8C25.9 53.2 25.8 53.8 25.8 54.1C25.8 54.4 25.7 54.9 25.5 55.4C25.0 56.5 24.9 57.0 24.8 58.0C24.8 58.6 24.7 59.1 24.5 59.4C24.0 60.4 24.0 60.9 24.6 61.4C25.0 61.9 25.2 61.9 29.4 61.9C33.5 61.9 33.5 61.9 33.8 61.7ZM36.8 35.7C37.2 35.3 37.2 34.7 37.2 29.4C37.1 24.3 37.1 24.1 36.8 23.8C36.5 23.5 36.3 23.1 36.2 22.6C36.1 22.3 35.9 21.9 35.7 21.7C35.5 21.4 35.2 21.0 35.1 20.8C34.7 20.2 34.5 20.1 33.8 19.9C33.4 19.8 33.1 19.6 32.9 19.4C32.4 19.0 31.9 18.8 31.2 18.8C30.8 18.8 30.3 18.7 29.9 18.6C29.2 18.4 28.9 18.3 28.2 18.6C27.9 18.7 27.3 18.8 26.9 18.8C25.8 18.9 25.5 19.0 25.2 19.4C25.1 19.5 24.7 19.7 24.4 19.9C23.6 20.3 23.1 20.8 22.8 21.4C22.6 21.9 22.3 22.2 21.8 22.7C21.0 23.5 21.0 23.3 20.9 29.8C20.9 34.9 20.9 35.2 21.2 35.6C21.4 35.9 21.4 35.9 29.0 35.9C36.4 35.9 36.6 35.9 36.8 35.7Z"/></svg></span><b>Change Password</b>${CK_MENU_ICONS.chev}</button>
    </div>`);
  $('sheetBg').classList.add('ck-pi-page');
};
// Rules: one card per article; "About us" shows the text the owner wrote in Admin > Settings.
window.openRulesPage = function(){
  const s = STATE.settings || {};
  openSheet('Rules', `
    <button class="ck-rule" type="button" onclick="openAboutText()">
      <span class="ck-rule-img${STATE.rulesHero ? ' has-img' : ''}"${STATE.rulesHero ? ` style="background-image:url('${esc(STATE.rulesHero)}')"` : ''}></span>
      <span class="ck-rule-lbl">ABOUT US</span>
    </button>`);
  $('sheetBg').classList.add('ck-rules-page');
};
window.openAboutText = function(){
  const s = STATE.settings || {};
  const text = String(s.aboutText || '').trim();
  if (!text) { notify('Nothing has been written here yet.'); return; }
  openSheet('About us', `<div class="ck-about">${esc(text).replace(/\n/g, '<br>')}</div>`);
  $('sheetBg').classList.add('ck-rules-page');
};
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
window.openWalletSheet = async function(){
  openSheet('Wallet', '');
  renderWalletSheet();
  { const h2 = document.querySelector('#sheetBg .sheet-head h2'); if (h2) h2.textContent = 'Bind Wallet Address'; }
  $('sheetBg').classList.add('ck-bind-page');
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
var CK_CHIP = '<svg viewBox="0 0 44 36" aria-hidden="true"><rect x="1.2" y="1.2" width="41.6" height="33.6" rx="7" fill="#ffc107" stroke="#1a1a1a" stroke-width="1.8"/><path d="M1.2 12.5h12.5M1.2 23.5h12.5M30.3 12.5h12.5M30.3 23.5h12.5" stroke="#1a1a1a" stroke-width="1.8"/><rect x="13.7" y="4.5" width="16.6" height="27" rx="8" fill="none" stroke="#1a1a1a" stroke-width="1.8"/><path d="M13.7 18h16.6" stroke="#1a1a1a" stroke-width="1.8"/></svg>';
function vWalletCardHtml(w){
  return `<div class="ck-bcard">
    <span class="ck-chip" aria-hidden="true">${CK_CHIP}</span>
    <div class="ck-bcard-w">${w ? esc(walShort(w.network)) : ''}</div>
    <div class="ck-bcard-a">${w ? esc(walletDestDisplay(w)) : ''}</div>
    <div class="ck-bcard-n">Real Name : ${w ? esc(String(w.holder || '')) : ''}</div>
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
function walRowsHtml(){
  return (STATE.bankAccounts || []).slice(0, 1).map(a => `
    <div class="v-wal-row"><b>${esc(walShort(a.network))}</b><span>${esc(maskedTail(a.phone))}</span><em>${esc(String(a.holder || '').toUpperCase())}</em></div>`).join('');
}
// The one saved wallet is edited in place: its provider, number and holder
// fill the form (only into empty fields, so nothing the member typed is lost).
// The Account Number box is a phone box for mobile money and a plain text box for a bank (letters allowed).
function applyWalDestKind(nowBank){
  const dest = $('walPhone'); if (!dest) return;
  dest.type = nowBank ? 'text' : 'tel';
  dest.inputMode = nowBank ? 'text' : 'numeric';
  dest.autocomplete = nowBank ? 'off' : 'tel';
  dest.placeholder = nowBank ? 'Account number' : phoneHintBody();
}
function prefillWallet(){
  const w = currentWallet(); if (!w) return;
  const prov = $('walProvider'), ph = $('walPhone'), holder = $('walHolder');
  if (prov && !prov.value) { prov.value = walShort(w.network); prov.dataset.network = w.network; }
  applyWalDestKind(!isMobileMoneyNetwork(w.network));
  if (ph && !ph.value) ph.value = walletDestDisplay(w);
  if (ph) walCardNum(ph.value);
  if (holder && !holder.value) holder.value = String(w.holder || '');
}
// Only the card, the heading and the "Your Wallet" rows: the typed fields are never touched.
function paintWalletParts(){
  const card = $('walCardBox'); if (card) { card.innerHTML = vWalletCardHtml(currentWallet()); const h = $('walHolder'); if (h && h.value) walCardName(h.value); }
  const head = $('walEditHead'); if (head) head.textContent = currentWallet() ? 'Edit Wallet' : 'Bind Wallet';
  const rows = $('walRows'); if (rows) rows.innerHTML = walRowsHtml();
  const own = $('walYours'); if (own) own.style.display = (STATE.bankAccounts || []).length ? '' : 'none';
  prefillWallet();
}
function renderWalletSheet(){
  const w = currentWallet();
  $('sheetBody').innerHTML = `<div class="ck-bind reveal-in">
    <div id="walCardBox">${vWalletCardHtml(w)}</div>
    <div id="walFormGroup">
      <label class="ck-lab" for="walHolder">Real Name</label>
      <div class="ck-in"><input id="walHolder" type="text" maxlength="60" autocomplete="name" enterkeyhint="next" placeholder="Enter real name" value="${w ? esc(String(w.holder || '')) : ''}" oninput="walCardName(this.value)"></div>
      <label class="ck-lab" for="walProvider">Wallet</label>
      <div class="prov-pick" id="walProviderPick">
        <div class="ck-in prov-input"><input id="walProvider" type="text" autocomplete="off" placeholder="Select wallet" oninput="filterProviders()" onfocus="openProviderList()"></div>
        <div class="prov-list" id="walProviderList">${walProviderOptionsHtml()}</div>
      </div>
      <label class="ck-lab" for="walPhone">Wallet Account</label>
      <div class="ck-in"><input id="walPhone" type="tel" inputmode="numeric" autocomplete="tel" enterkeyhint="done" placeholder="Enter Wallet Account" oninput="handleWalDestInput(this)"></div>
      <button class="ck-confirm" id="walSaveBtn" type="button" onclick="submitWallet()">Confirm</button>
    </div>
    <span id="walEditHead" hidden></span><div id="walYours" hidden><div id="walRows"></div></div>
  </div>`;
  prefillWallet();
}
window.walCardWallet = function(name){ const n = document.querySelector('#walCardBox .ck-bcard-w'); if (n) n.textContent = walShort(name || ''); };
window.walCardNum = function(v){ const n = document.querySelector('#walCardBox .ck-bcard-a'); if (n) n.textContent = String(v || ''); };
window.walCardName = function(v){ const n = document.querySelector('#walCardBox .ck-bcard-n'); if (n) n.textContent = 'Real Name : ' + String(v || ''); };
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
  walCardWallet(name);
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
  if (isMobileMoneyNetwork(walNetwork())) { sanitizePhoneInput(el); walCardNum(el.value); return; }
  // A bank account number is letters and digits only (what the server accepts); anything else typed is dropped as it is typed.
  if (/[^A-Za-z0-9]/.test(el.value)) el.value = el.value.replace(/[^A-Za-z0-9]/g, '');
  walCardNum(el.value);
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
  if (holder.split(/\s+/).filter(Boolean).length < 2) return notify('Your real name should be in the format: FirstName LastName');
  if (!network) return notify('Select your wallet provider.');
  if (!String(phone).trim()) return notify('Enter Wallet Account');
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
  { const card = $('notifyMsg').parentNode;
    if (card && card.classList) {
      card.classList.toggle('long', String(message || '').length > 60);
      const au = $('authScreen');
      card.classList.toggle('authtoast', !!(au && au.style.display !== 'none' && au.offsetParent !== null));
    } }
  // Good news gets the tick, everything else (errors and "please do this first")
  // the circled cross, as in the screens.
  const good = /success|✓|copied|saved|done|now running|redeemed|submitted|sent|changed|processing|updated|claimed|unlocked|bound/i.test(String(message || '')) && !/not |fail|could not|cannot|insufficient|invalid|incorrect|wrong|isn't|already|status changed|bind it|add a payout/i.test(String(message || ''));
  const ic = $('notifyIc');
  if (ic) { ic.innerHTML = good ? VI.okCircle : VI.errCircle; ic.className = 'notify-ic ' + (good ? 'ok' : 'err'); }
  _notifyOnClose = typeof onClose === 'function' ? onClose : null;
  $('notifyBg').classList.add('show');
  // Auto-dismisses on its own (a toast, not a dialog the member must
  // acknowledge) -- tapping it early still works via closeNotify() on the
  // card's own onclick, which clears this same timer first.
  if (_notifyTimer) clearTimeout(_notifyTimer);
  // A longer message (two lines) stays a little longer so it can be read.
  _notifyTimer = setTimeout(closeNotify, String(message || '').length > 80 ? 4800 : String(message || '').length > 45 ? 2600 : 1400);   // a long message (the withdrawal summary) needs time to be read
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
var STATEMENT_TURNTABLE_TYPES = new Set(['turntable','spin','spin_bonus']);
var STATEMENT_FRUIT_TYPES = new Set(['fruit','fruit_win','fruit_bet']);
var STATEMENT_NOT_INCOME = new Set(['deposit','admin_credit','withdraw','invest','investment','investment_refund']);
function statementCategoryMatch(cat, t){
  if (cat === 'income' || cat === 'all') return !STATEMENT_NOT_INCOME.has(t.type);
  if (cat === 'deposit') return t.type === 'deposit' || t.type === 'admin_credit';
  if (cat === 'withdraw') return t.type === 'withdraw';
  if (cat === 'turntable') return STATEMENT_TURNTABLE_TYPES.has(t.type);
  if (cat === 'fruit') return STATEMENT_FRUIT_TYPES.has(t.type);
  return true;
}
function statementDescription(t){
  if (t.type === 'deposit') return 'Deposit';
  if (t.type === 'withdraw') return 'Withdraw';
  if (t.type === 'cashback') return 'Daily Earnings';
  if (t.type === 'commission') return 'Referral Commission';
  if (t.type === 'promocode') return 'Gift Code';
  if (t.type === 'checkin') return 'Check-in Reward';
  if (t.type === 'welcome_bonus') return 'Welcome Bonus';
  if (t.type === 'team_reward') return 'Team Reward';
  if (t.type === 'mission_salary') return 'Mission Salary';
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
// ── BALANCE DETAILS: Income details / Deposit Records / Withdrawal Records ──
// One page with three tabs. Every time it opens (or a tab is tapped) it starts empty ("NO DATA"), the dark loading box asks the
// server for this member's own records, and only then are the rows shown. "No more data" appears when the end of the list is reached.
var _balTab = 'income', _balSub = 'mine', _balSeq = 0, _balToastAt = 0;
var BAL_TITLES = { income: 'Balance Details', deposit: 'Deposit Records', withdraw: 'Withdrawal Records' };
function balNum(n){ return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
function balIsFail(t){ const c = statementChip(t); return !!(c && c.cls === 'bad'); }
function balIsWait(t){ const c = statementChip(t); return !!(c && c.cls === 'wait'); }
function balTitle(t){
  if (t.type === 'deposit' || t.type === 'admin_credit') return 'Recharge';
  if (t.type === 'withdraw') return balIsFail(t) ? 'Withdrawal Failed' : balIsWait(t) ? 'Withdrawal Processing' : 'Withdrawal Successful';
  if (t.type === 'cashback') return 'Device Profit';
  if (t.type === 'commission') { const n = Number(t.commissionLevel); return 'Level ' + ((Number.isFinite(n) ? n : 0) + 1) + ' Buy Rewards'; }
  // A product the admin activated for the member: "Free ( Gold )", with nothing taken from the balance.
  if (t.type === 'investment' && /activated$/i.test(String(t.description || ''))) return 'Free ( ' + String(t.description).replace(/\s*activated$/i, '').trim() + ' )';
  return statementDescription(t);
}
// Newest first, each row with the wallet balance right after it (worked back from the balance the member has now).
function balLedger(){
  let run = Number((STATE.account || {}).walletBalance) || 0;
  const out = [];
  for (const t of (STATE.transactions || [])) {
    out.push({ t, after: run });
    run = Math.round((run - (Number(t.amount) || 0)) * 100) / 100;
  }
  return out;
}
function balRecStatus(t){
  if (balIsFail(t)) return { text: 'Failure', cls: 'bad' };
  if (balIsWait(t)) return { text: t.type === 'deposit' ? 'Pending Payment' : 'Processing', cls: 'wait' };
  return { text: 'Success', cls: 'ok' };
}
function balRowsHtml(){
  const led = balLedger();
  if (_balTab === 'income') {
    const rows = led.filter(x => _balSub === 'sub' ? x.t.type === 'commission' : x.t.type !== 'commission');
    return rows.map(({ t, after }) => {
      let amt = recordsRowAmount(t);
      if (t.type === 'withdraw' && balIsFail(t)) amt = Math.abs(amt);
      return `<article class="ck-br"><b class="ck-br-t">${esc(balTitle(t))}</b><span class="ck-br-d">${esc(ckStamp(t.createdAt) || statementDate(t))}</span><span class="ck-br-a">${(amt < 0 || (amt === 0 && t.type === 'investment')) ? '-' : '+'} ${esc(balNum(Math.abs(amt)))}</span><span class="ck-br-b">Balance : ${esc(balNum(after))}</span></article>`;
    }).join('');
  }
  const thumb = STATE.recThumb ? ` style="background-image:url('${esc(STATE.recThumb)}')"` : '';
  return led.filter(x => _balTab === 'deposit' ? (x.t.type === 'deposit' || x.t.type === 'admin_credit') : x.t.type === 'withdraw').map(({ t }) => {
    const st = balRecStatus(t);
    return `<article class="ck-rc"><span class="ck-rc-img${STATE.recThumb ? ' has-img' : ''}"${thumb}></span><div class="ck-rc-in"><b class="ck-rc-t">${_balTab === 'deposit' ? 'Deposit' : 'Withdraw'}</b><b class="ck-rc-a">${esc(ckMoney(Math.abs(recordsRowAmount(t))))}</b><span class="ck-rc-d">${esc(ckStamp(t.createdAt) || statementDate(t))}</span><b class="ck-rc-s ${st.cls}">${st.text}</b></div></article>`;
  }).join('');
}
function balPaint(animate){
  const list = $('balList'); if (!list) return;
  const html = balRowsHtml();
  list.innerHTML = html || '<div class="v-empty ck-nodata-bd">NO DATA</div>';
  // The records rise into place one after another when they arrive (not on the quiet refreshes).
  if (animate) Array.from(list.children).forEach((k, i) => { k.style.animationDelay = Math.min(i, 9) * 70 + 'ms'; void k.offsetWidth; k.classList.add('ck-rise'); });
}
function balNoMore(){
  const sb = $('sheetBg'); if (!sb || _openSheetTitle !== 'Balance Record' || Date.now() - _balToastAt < 2600) return;
  const atEnd = sb.scrollHeight - sb.scrollTop - sb.clientHeight < 40;
  if (!atEnd) return;
  _balToastAt = Date.now(); ckSuccessToast('No more data');
}
async function balLoad(){
  const seq = ++_balSeq;
  const list = $('balList'); if (list) list.innerHTML = '<div class="v-empty ck-nodata-bd">NO DATA</div>';
  ckExpectLoad();
  const r = await api('/transactions');
  if (seq !== _balSeq || _openSheetTitle !== 'Balance Record') return;
  if (r.status === 'success') { STATE.transactions = r.transactions; STATE.transactionsTruncated = !!r.truncated; }
  else if (!Array.isArray(STATE.transactions)) STATE.transactions = [];
  balPaint(true);
  setTimeout(balNoMore, 450);
}
function balShell(){
  const tabs = ['income', 'deposit', 'withdraw'].map(k => `<button type="button" data-cat="${k}" class="${_balTab === k ? 'on' : ''}" onclick="balSwitch('${k}')">${k === 'income' ? 'Income details' : k === 'deposit' ? 'Deposit' : 'Withdraw'}</button>`).join('');
  const body = _balTab === 'income'
    ? `<div class="ck-bd-card"><div class="ck-seg" id="incSeg"><button type="button" data-t="mine" class="${_balSub === 'mine' ? 'on' : ''}" onclick="balSub('mine')">My Income</button><button type="button" data-t="sub" class="${_balSub === 'sub' ? 'on' : ''}" onclick="balSub('sub')">Subordinate Income</button></div><div id="balList"></div></div>`
    : `<div class="ck-bd-recs"><div id="balList"></div></div>`;
  return `<div class="ck-bd"><div class="ck-bd-tabs" id="statementTabs">${tabs}</div>${body}</div>`;
}
window.balSwitch = function(tab){
  if (!['income', 'deposit', 'withdraw'].includes(tab) || tab === _balTab) return;
  _balTab = tab;
  const ttl = $('sheetTitle'); if (ttl) ttl.textContent = BAL_TITLES[tab];
  $('sheetBody').innerHTML = balShell();
  balLoad();
};
window.balSub = function(sub){
  _balSub = sub === 'sub' ? 'sub' : 'mine';
  document.querySelectorAll('#incSeg button').forEach(b => b.classList.toggle('on', b.dataset.t === _balSub));
  balLoad();
};
window.openBalanceDetails = function(tab){
  _balTab = ['income', 'deposit', 'withdraw'].includes(tab) ? tab : 'income'; _balSub = 'mine';
  openSheet('Balance Record', balShell());
  $('sheetBg').classList.add('ck-bd-page');
  { const ttl = $('sheetTitle'); if (ttl) ttl.textContent = BAL_TITLES[_balTab]; }
  const sb = $('sheetBg'); if (sb && !sb._balScroll) { sb._balScroll = true; sb.addEventListener('scroll', balNoMore, { passive: true }); }
  balLoad();
};
// The older entry points still work.
window.openIncomeDetails = function(){ return openBalanceDetails('income'); };
window.openTransactionStatement = function(cat){ return openBalanceDetails(cat === 'deposit' ? 'deposit' : cat === 'withdraw' ? 'withdraw' : 'income'); };
window.openBalanceRecordSheet = function(tab){ return openBalanceDetails(tab); };
function renderStatement(){ balPaint(); }

// ── MESSAGES (MessagesList.dc.html / Messages.dc.html) ──
// Real inbox, backed by /messages (admin-authored broadcasts) with per-
// member read state. Snow has no equivalent -- see CLAUDE.md.
window.openMessagesSheet = async function(){
  // Opens as the header alone with the loading box, then the list (or NO DATA) appears once.
  ckExpectLoad();
  openSheet('Messages', '<div id="msgBody"></div>');
  const r = await api('/messages');
  if (r.status === 'success') STATE.messages = r.messages;
  else if (!Array.isArray(STATE.messages)) STATE.messages = [];
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
  if (!list.length) { box.innerHTML = '<div class="v-empty ck-nodata">NO DATA</div>'; return; }
  box.innerHTML = '<div class="reveal-in">' + list.map((m, i) => `
    <button class="msg-row${m.read ? ' read' : ''}" onclick="openMessageDetail(${i})">
      <span class="av">${VI.bottle}</span>
      <span class="txt">
        <span class="top">
          <span class="t1">${esc(m.title || '')}</span>
          <span class="date">${esc(m.date || '')}<br>${esc(m.time || '')}</span>
        </span>
        <span class="t2">${esc(messagePreview(m.body))}</span>
      </span>
    </button>`).join('') + '</div>';
}
window.openMessageDetail = async function(index){
  const m = (STATE.messages || [])[index];
  if (!m) return;
  $('msgDetail').innerHTML = `
    <button class="xbtn" onclick="closeMessageDetail()" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>
    <div class="head">
      <div class="av">${VI.bottle}</div>
      <div>
        <h2>${esc(m.title || '')}</h2>
        <div class="date">${esc(m.date || '')} ${esc(m.time || '')}</div>
      </div>
    </div>
    <div class="ln"></div>
    <div class="content">${esc(m.body || '')}</div>`;
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
function updateMessageBadge(){}

function vPwBox(id, placeholder, pin){
  return `<div class="v-pbox"><input id="${id}" type="text" placeholder="${esc(placeholder)}"${pin ? ' inputmode="numeric" maxlength="6" autocomplete="one-time-code"' : ' autocomplete="off"'}></div>`;
}
window.openChangeLoginPasswordSheet = function(){
  openSheet('Change Password', `<div class="ck-pw">
    <div class="ck-pi-art" aria-hidden="true">${CK_PW_ART}</div>
    <div class="ck-pw-card">
      <label class="ck-lab" for="lpOld">Old Password</label><div class="ck-in"><input id="lpOld" type="password" placeholder="Please enter your old password" autocomplete="off"></div>
      <label class="ck-lab" for="lpNew">New Password</label><div class="ck-in"><input id="lpNew" type="password" placeholder="Please new password" autocomplete="off"></div>
      <label class="ck-lab" for="lpNew2">New Password 2</label><div class="ck-in"><input id="lpNew2" type="password" placeholder="Please new password again" autocomplete="off"></div>
      <button class="ck-confirm" id="lpSaveBtn" type="button" onclick="submitLoginPasswordChange()">Confirm</button>
    </div>
  </div>`);
  $('sheetBg').classList.add('ck-pw-page');
};
window.submitLoginPasswordChange = async function(){
  const oldPass = $('lpOld').value;
  const newPass = $('lpNew').value;
  const confirm = $('lpNew2').value;
  if (!oldPass) return notify('Old password must be entered');
  if (!newPass || newPass.length < 10) return notify('Your new password must be at least 10 characters.');
  if (newPass !== confirm) return notify('The two new passwords do not match.');
  if (newPass === oldPass) return notify('Your new password must be different from the old one.');
  const btn = $('lpSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await window.fbChangePassword(phoneToEmail((STATE.account || {}).phone), oldPass, newPass);
    { const kept = savedLoginGet(); if (kept && localDigits(kept.phone) === localDigits((STATE.account || {}).phone)) savedLoginSet(kept.phone, newPass); }
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
// The 6-digit PIN that confirms withdrawals. Cookie uses 6 digits where Snow
// used 5 -- server.js validates the same length on /account/transaction-pin/change.
// ── TREASURE CHEST (Chest.dc.html / ChestSuccess.dc.html) ──
// The bouncing chest on Home opens this full screen: glowing ring, bouncing
// chest artwork, key field, OPEN CHEST. A valid key flashes the green
// full-screen win state with the amount won and the new balance.
window.openChestSheet = function(){
  const pic = STATE.brandLogo
    ? `<img src="${esc(STATE.brandLogo)}" alt="">`
    : `<span class="v-chest-ic">${VI.bottle}</span>`;
  openSheet('TREASURE CHEST', `<div class="v-chest reveal-in">
    <div class="v-chest-ring"><div class="v-chest-disc">${pic}</div></div>
    <h2>MYSTERY TREASURE</h2>
    <p>Enter your key to unlock the reward</p>
    <div class="v-chest-key"><span class="v-chest-keyic">${VI.key}</span><input id="chestKey" type="text" placeholder="Enter treasure chest key" maxlength="14" autocapitalize="characters" autocomplete="off" spellcheck="false" style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase()"></div>
    <button class="v-chest-go" id="chestOpenBtn" type="button" onclick="submitChestKey()">UNLOCK TREASURE</button>
  </div>`);
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
  btn.disabled = true; btn.textContent = 'UNLOCKING…';
  const r = await post('/redeem', { code: raw });
  btn.disabled = false; btn.textContent = 'UNLOCK TREASURE';
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
      <span class="v-win-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="9" width="17" height="11.5" rx="2"/><path d="M2.5 9h19v-3.2h-19z"/><path d="M12 5.8v14.7"/><path d="M12 5.8C10.2 5.8 8.4 5 8.4 3.6 8.4 2.5 9.4 2 10.4 2.4c1.1.5 1.6 1.9 1.6 3.4zM12 5.8c1.8 0 3.6-.8 3.6-2.2 0-1.1-1-1.6-2-1.2-1.1.5-1.6 1.9-1.6 3.4z"/></svg></span>
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
    if (STATE.page === 'account') paintAccount();
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
    || ($('payScreen') && $('payScreen').classList.contains('show'))
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
  if (['assets', 'network', 'account'].indexOf(prevPage) === -1) return;
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
  ckExpectLoad();
  window._sheetSeq = (window._sheetSeq || 0) + 1;
  $('sheetBg').classList.remove('v-rec-page', 'ck-pi-page', 'ck-rules-page', 'ck-bind-page', 'ck-dep-page', 'ck-wd-page', 'ck-rec-page', 'ck-pw-page', 'ck-inc-page', 'ck-bd-page');
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
  $('sheetBg').classList.add('show');
  document.body.classList.add('sheet-open');
  _openSheetTitle = title;
  if (alreadyOpen) history.replaceState({ sheet: title }, '', '');
  else history.pushState({ sheet: title }, '', '');
  lockBodyScroll();
}
// opts.fromAction/opts.navigating used to gate whether closing a sheet could
// trigger the announcement dialog (a submitted withdrawal, a recharge
// handing over to its result modal, or a tab tap all had to suppress it).
// The announcement no longer fires from a sheet closing at all -- see
// maybeAnnounceAfterHomeNav() -- so both flags are now inert; left on their
// call sites rather than stripped out of several submit-button paths for a
// purely cosmetic cleanup. opts.keepHistory is the one flag this function
// still reads.
// Backing out of Deposit or Withdraw onto Home reloads Home (the loading box, which really reads the account, investments and products),
// then the announcement dialog opens after the loading box, as it does on a tab change or a login.
function homeAfterSheet(title){
  if (title !== 'Deposit' && title !== 'Withdraw') return;
  if (STATE.page !== 'home' || isAnyOverlayOpen()) return;
  ckExpectLoad();
  renderHome();
  maybeShowAnnouncement();
}
window.closeSheet = function(opts){
  const wasOpen = _openSheetTitle;
  $('sheetBg').classList.remove('show');
  document.body.classList.remove('sheet-open');
  unlockBodyScroll();
  _openSheetTitle = null;
  if (_aboutScrollObserver) { _aboutScrollObserver.disconnect(); _aboutScrollObserver = null; }
  // opts.keepHistory: the caller is retiring several overlay entries itself
  // with one history.go(-n) -- see showPage(). Only that caller sets it.
  if (!(opts && opts.keepHistory) && history.state && history.state.sheet) history.back();
  // Only the member's own Back (arrow): leaving for another tab, or a finished payment/withdrawal, is not a return to Home.
  if (!(opts && (opts.navigating || opts.fromAction))) homeAfterSheet(wasOpen);
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
    || ($('payScreen') && $('payScreen').classList.contains('show'))
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
  ['confirmBg', 'helpBg', 'annBg', 'dlBg', 'payScreen'].forEach(id => { const el = $(id); if (el) el.classList.remove('show'); });
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
    else if ($('payScreen') && $('payScreen').classList.contains('show')) { if (_pg.view === 'form' || _pg.view === 'initiated' || _pg.view === 'unknown' || _pg.view === 'failed' || _pg.view === 'gone' || _pg.view === 'done') closePaymentPage(); else dlgOpened(); }
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
  const wasOpen = _openSheetTitle;
  $('sheetBg').classList.remove('show');
  document.body.classList.remove('sheet-open');
  unlockBodyScroll();
  _openSheetTitle = null;
  if (_aboutScrollObserver) { _aboutScrollObserver.disconnect(); _aboutScrollObserver = null; }
  // Landed on an entry whose dialog is already closed: step over it so one Back is one visible step.
  if (ev && ev.state && ev.state.dlg) { _dlgIgnore(); history.back(); }
  homeAfterSheet(wasOpen);
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
// Figures the way the Cookie screens print them: the currency, one space, the plain number (no thousands commas, no trailing zeros).
function ckNum(n){ const v = Math.round((Number(n) || 0) * 100) / 100; return String(v); }
function ckMoney(n){ return cur() + ' ' + ckNum(n); }
// "16-10-2026 07:29:40": day-month-year, then the clock with seconds.
function ckStamp(ts){
  if (!ts) return '';
  const ms = typeof ts === 'object' && ts.seconds ? ts.seconds * 1000 : new Date(ts).getTime();
  if (!ms || isNaN(ms)) return '';
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
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
  const bal = (STATE.account && STATE.account.walletBalance) || 0;
  // The HOT mark sits on the method members tap most (the server counts them); all four use the same payment channel.
  const hotKey = ['C', 'L', 'H', 'K'].includes((STATE.settings || {}).depositHotMethod) ? STATE.settings.depositHotMethod : 'H';
  const hot = '<svg class="ck-hot" viewBox="0 0 64 63" aria-hidden="true"><path fill="#fff" fill-rule="evenodd" d="M31.6 62.0C29.8 61.9 30.2 62.1 26.1 58.1L22.5 54.5L17.5 54.5C12.6 54.5 12.6 54.5 12.2 54.3C12.0 54.1 11.6 54.0 11.3 53.9C10.8 53.7 10.6 53.6 10.1 53.0C9.7 52.6 9.4 52.2 9.4 52.1C9.3 52.0 9.3 51.6 9.2 51.4C9.1 51.1 9.1 48.9 9.1 46.2C9.1 42.2 9.1 41.4 8.9 41.1C8.8 40.9 7.7 39.7 5.6 37.5C2.4 34.3 2.0 33.9 1.3 32.6C1.1 32.2 1.0 30.8 1.2 30.2C1.3 30.0 1.4 29.7 1.6 29.5C1.7 29.3 1.9 28.9 2.0 28.7C2.1 28.4 2.7 27.7 5.5 24.9C8.3 22.1 8.9 21.4 9.0 21.1C9.1 20.9 9.1 18.6 9.1 16.0C9.1 10.0 9.1 9.7 10.1 9.1C10.3 9.0 10.8 8.7 11.1 8.5L11.6 8.2L17.0 8.1C19.9 8.1 22.4 8.0 22.4 8.0C22.4 8.0 23.9 6.5 25.8 4.6C28.2 2.2 29.2 1.2 29.6 1.1C30.0 0.9 30.3 0.6 30.3 0.2C30.3 0.0 30.3 0.0 32.2 0.0C34.1 0.0 34.1 0.0 34.3 0.3C34.7 0.9 41.8 7.8 42.1 7.9C42.4 8.1 43.3 8.1 47.7 8.1C51.9 8.1 52.9 8.1 53.1 8.2C53.5 8.4 54.9 9.9 55.0 10.2C55.1 10.4 55.1 10.8 55.1 11.1C55.1 11.5 55.2 11.8 55.3 12.0C55.4 12.3 55.4 12.7 55.5 16.5C55.5 22.0 55.1 21.1 58.8 24.9C60.4 26.4 61.8 28.0 62.0 28.2C62.1 28.4 62.4 28.8 62.5 28.9C62.8 29.2 63.0 29.7 63.0 30.2C63.0 30.3 63.1 30.7 63.2 30.9C63.5 31.4 63.5 31.4 63.3 31.7C63.1 31.9 63.0 32.3 62.9 32.6C62.7 33.2 62.7 33.3 59.1 36.9L55.5 40.5L55.5 45.6C55.5 50.8 55.5 50.8 55.1 51.4C54.9 51.8 54.6 52.3 54.5 52.5C54.3 52.7 54.0 53.1 53.9 53.3C53.6 53.8 53.2 54.0 52.0 54.1C51.5 54.1 51.0 54.2 50.8 54.3C50.5 54.5 50.1 54.5 46.4 54.5C42.1 54.5 42.1 54.5 41.2 55.0C41.0 55.0 39.4 56.6 37.5 58.4C34.1 61.8 33.8 62.1 33.0 62.1C32.9 62.1 32.3 62.0 31.6 62.0ZM33.7 36.9C34.7 36.9 34.7 36.9 35.1 36.5C35.3 36.4 35.7 36.2 35.9 36.1C36.3 36.0 36.6 35.8 37.2 35.2C37.9 34.5 37.9 34.5 38.0 33.9C38.1 33.5 38.2 33.1 38.4 32.8C38.7 32.3 38.7 30.9 38.4 30.1C38.3 29.8 38.2 29.3 38.2 29.0C38.2 28.3 37.9 27.8 36.9 26.8C36.3 26.3 36.0 26.1 35.7 26.0C35.5 25.9 35.1 25.8 34.9 25.7C34.7 25.5 34.4 25.4 34.0 25.4C33.6 25.4 33.1 25.3 32.9 25.2C32.5 25.1 32.4 25.1 32.1 25.2C32.0 25.2 31.6 25.4 31.4 25.5C31.1 25.6 30.5 25.8 30.1 25.9C29.2 26.2 28.7 26.6 27.9 27.8C27.4 28.5 27.4 28.6 27.4 29.0C27.5 29.3 27.4 29.6 27.3 29.9C27.1 30.4 27.1 30.7 27.1 32.0C27.1 33.6 27.1 33.6 27.6 34.3C27.9 34.7 28.1 35.0 28.2 35.0C28.3 35.0 28.8 35.5 29.1 35.9C29.4 36.3 32.1 37.2 32.5 37.0C32.6 37.0 33.1 37.0 33.7 36.9ZM17.8 36.6C18.0 36.3 18.1 36.1 18.1 34.4C18.2 32.1 18.1 32.2 19.8 32.2C21.7 32.3 21.7 32.4 21.8 34.8C21.9 37.0 21.8 36.9 23.6 36.9C25.2 36.8 25.2 37.0 25.2 34.4C25.3 31.2 25.2 26.0 25.1 25.7C24.9 25.5 24.5 25.4 23.4 25.4C22.5 25.4 22.5 25.4 22.2 25.7C21.9 26.0 21.7 26.7 21.8 27.6C21.9 29.0 21.4 29.4 19.7 29.5C19.1 29.5 18.6 29.5 18.5 29.4C18.2 29.2 18.1 28.7 18.1 27.6C18.1 25.6 18.0 25.4 16.5 25.4C15.3 25.4 14.9 25.6 14.6 26.1C14.4 26.4 14.4 26.8 14.4 31.1C14.5 35.8 14.5 35.8 14.7 36.2C15.1 36.8 15.2 36.9 16.5 36.9C17.6 36.9 17.6 36.8 17.8 36.6ZM46.0 36.6C46.2 36.4 46.2 36.2 46.2 32.9C46.2 30.4 46.2 29.2 46.3 29.0C46.5 28.4 46.8 28.3 48.0 28.2C49.4 28.2 49.6 28.1 49.7 27.8C50.0 27.3 49.9 25.8 49.6 25.5C49.6 25.4 49.4 25.4 49.3 25.4C49.2 25.4 47.1 25.4 44.6 25.4C40.2 25.5 40.2 25.5 39.8 25.7C39.2 26.0 39.1 26.3 39.1 27.0C39.1 27.6 39.3 28.1 39.6 28.1C39.7 28.2 40.3 28.2 41.0 28.2C42.2 28.3 42.3 28.3 42.6 28.7C42.7 28.9 42.8 29.3 42.8 32.7C42.8 34.8 42.9 36.5 42.9 36.6C43.1 36.8 43.5 36.9 44.6 36.9C45.7 36.9 45.8 36.8 46.0 36.6ZM31.9 33.9C31.0 32.9 30.4 31.7 30.5 30.8C30.6 30.1 31.1 29.0 31.5 28.6C31.9 28.2 32.5 28.2 33.1 28.4C33.4 28.5 33.6 28.6 33.9 28.5C34.5 28.5 34.7 28.7 35.0 29.7C35.1 30.3 35.1 30.5 35.0 31.0C35.0 31.3 34.9 31.8 34.9 32.2C34.9 32.8 34.8 33.2 34.4 33.5C34.2 33.8 32.8 34.5 32.6 34.5C32.6 34.5 32.2 34.2 31.9 33.9Z"/></svg>';
  openSheet('Deposit', `<div class="ck-dep">
    <div class="ck-card ck-amtcard">
      <div class="ck-balrow"><span>Available：</span><b>${esc(cur())}</b><i id="depBalance">${esc(numGroup(0, true))}</i></div>
      <label class="ck-amtbox"><b>${esc(cur())}</b><input id="depAmount" type="text" inputmode="numeric" maxlength="9" placeholder="Please enter the Deposit amount" oninput="this.value=this.value.replace(/[\s,]/g,'');syncDepositQuickAmt()" autocomplete="off"></label>
    </div>
    <div class="ck-card ck-pays" id="depPays">
      ${['C', 'L', 'H', 'K'].map((k, i) => `<button type="button" data-m="${k}" class="${i === 0 ? 'on' : ''}${k === hotKey ? ' hot' : ''}" onclick="pickPayLabel(this)">${k === hotKey ? hot : ''}<span>${esc(brandName())} Pay -${k}</span></button>`).join('')}
    </div>
    <button class="ck-pay" id="depSubmitBtn" type="button" onclick="submitDeposit()">Pay 0</button>
    <div class="ck-notes">
      <p class="b">The minimum deposit amount is ${esc(cur())} ${esc(ckNum(min))}</p>
      <p class="b">Recharge time 7 x 24 hours</p>
      <p class="r">Please do not disclose your app password to anyone</p>
      <p class="r">Please be sure to complete your deposit within the app; do not transfer funds to anyone who calls you</p>
      <p class="r">If you encounter any issues during the deposit process, please contact customer service immediately</p>
    </div>
  </div>`);
  $('sheetBg').classList.add('ck-dep-page');
  { const b = $('depBalance'); if (b) { b._v = 0; ckTween(b, Number(bal) || 0, v => numGroup(v, true), ckBalanceMs()); } }
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
var CARD_DEPOSIT_STORAGE_KEY = 'cookie_pending_card_deposit';
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
    .slice(0, 6);
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
  const payBtn = $('depSubmitBtn');
  if (payBtn && !payBtn.disabled) ckTween(payBtn, val > 0 ? val : 0, v => 'Pay ' + numGroup(Math.round(v), false), ckBalanceMs());
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
// The grey "Loading" state of a Pay button (a 12-spoke spinner and the word), restored to its own label afterwards.
function ckPayLoading(btn, on, label){
  if (!btn) return;
  if (on) {
    if (btn._raf) { cancelAnimationFrame(btn._raf); btn._raf = 0; }   // a count-up still running must not write its figure over "Loading"
    btn.disabled = true; btn.classList.add('ck-pay-ld');
    btn.innerHTML = '<svg class="ck-pay-sp" viewBox="0 0 24 24" aria-hidden="true">' + Array.from({ length: 12 }, (_, i) => `<line x1="12" y1="2.6" x2="12" y2="7.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity="${(0.16 + 0.84 * (i + 1) / 12).toFixed(2)}" transform="rotate(${i * 30} 12 12)"/>`).join('') + '</svg>Loading';
  } else {
    btn.disabled = false; btn.classList.remove('ck-pay-ld'); btn.textContent = label; btn._v = parseMoneyInput(label);
  }
}
window.submitDeposit = async function(){
  const submitBtn = $('depSubmitBtn');
  if (!submitBtn || submitBtn.disabled || !$('depAmount')) return;
  const amount = parseMoneyInput($('depAmount').value);
  if (!amount || amount <= 0) return notify('Please enter the Deposit amount');
  // The minimum is checked here first so a short amount fails at once; the server checks it again.
  const s = STATE.settings || {};
  if (amount < (Number(s.minDeposit) || 0)) return notify('Minimum amount is ' + fmtUGX(s.minDeposit));
  const picked = document.querySelector('#depPays button.on'), method = picked ? picked.dataset.m : '';
  // Pay makes an ORDER on the server (the amount is fixed there) and the member goes on to the payment page, /payment/<order number>. The button
  // turns grey with "Loading" and the loading box shows until the server has made it.
  ckPayLoading(submitBtn, true);
  ckLoadBegin();
  let r;
  try {
    r = await post('/deposit/order/create', { amount, method });
  } finally {
    ckLoadEnd();
    ckPayLoading(submitBtn, false, 'Pay ' + numGroup(amount, false));
  }
  if (r && r.stale) return;
  if (!r || r.status !== 'success' || !r.orderNo) return notify((r && r.message) || 'Could not start the payment');
  if ($('depSubmitBtn') === submitBtn && _openSheetTitle === 'Deposit') closeSheet({ fromAction: true });
  openPaymentPage(r.orderNo);
};
// ── THE PAYMENT PAGE: /payment/<order number> ──
// Pay on Deposit makes an order on the server (the amount is fixed there) and lands here. The amount cannot be edited; the member gives the phone
// number the prompt goes to and the provider, taps Pay, and the page waits (a real status read every 1.5 s) for the provider's answer. On success the
// "Success" tick box shows and the app goes back to Home by itself.
var _pg = { no: '', order: null, view: '', depositId: '', reference: '', token: 0 };
// Chrome offers "Use saved password?" on any phone-looking box when the page also holds a password box (the sign-in and change-password boxes sit
// in the same document). While the payment page is open those password boxes are switched off, so there is nothing to pair the phone box with.
function pgLockPasswordBoxes(on){
  try {
    if (on) document.querySelectorAll('input[type=password]').forEach(i => { if (!i.disabled && !$('payScreen').contains(i)) { i.disabled = true; i.setAttribute('data-pg-off', '1'); } });
    else document.querySelectorAll('input[data-pg-off]').forEach(i => { i.disabled = false; i.removeAttribute('data-pg-off'); });
  } catch (_) {}
}
function pgOpen(){ const el = $('payScreen'); return !!(el && el.classList.contains('show')); }
// "Pay" is part of the page's name and is fixed; the brand in front of it is the admin's name for the app, so "Cookie Pay" becomes "<new name> Pay" everywhere here.
function pgBrand(){ return esc(brandName()) + ' Pay'; }
function pgTitle(){ return brandName() + ' Pay'; }
function pgMoney(n){ return esc(cur()) + ' ' + numGroup(Number(n) || 0, false); }
function pgFrame(inner, timer){
  return `<div class="pg-brand">${pgBrand()}</div>
  <div class="pg-card">
    <div class="pg-head"><span class="pg-sub">${pgBrand()}</span><h1>Payment</h1>${timer ? `<div class="pg-time" id="pgTimer" aria-label="Time left to pay">${PG_CLOCK}<b id="pgTimerTxt">10:00</b></div>` : ''}</div>
    <div class="pg-body">${inner}</div>
  </div>
  <p class="pg-foot">Powered by ${pgBrand()} &middot; ${esc(regionName())}</p>`;
}
function pgFormHtml(o){
  return pgFrame(`
    <label class="pg-l" for="pgAmount">Amount (${esc(cur())})</label>
    <input class="pg-in pg-locked" id="pgAmount" type="text" value="${esc(String(o.amount))}" readonly tabindex="-1" aria-readonly="true">
    <label class="pg-l" for="pgPhone">Phone Number</label>
    <input class="pg-in" id="pgPhone" name="pg_msisdn" type="text" inputmode="numeric" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-form-type="other" placeholder="e.g. 0700 000 000" value="" required oninput="this.value=this.value.replace(/[^0-9+ ]/g,'')">
    <label class="pg-l" for="pgNet">Mobile Money Provider</label>
    <div class="pg-sel"><select class="pg-in" id="pgNet"><option>MTN Mobile Money</option><option>Airtel Money</option></select><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <div class="pg-sum">
      <div><span>Subtotal</span><span>${pgMoney(o.amount)}</span></div>
      <div><span>Processing fee</span><span>+${pgMoney(0)}</span></div>
      <div class="pg-tot"><span>Total to pay</span><b>${pgMoney(o.amount)}</b></div>
    </div>
    <p class="pg-err" id="pgErr" role="alert"></p>
    <button class="pg-pay" id="pgPayBtn" type="button" onclick="pgPay()">Pay ${pgMoney(o.amount)}</button>
    <p class="pg-note">You will receive a mobile money prompt to confirm the payment.<br>Secured by ${pgBrand()}</p>`, true);
}
function pgCenterHtml(icon, title, text, extra){
  return `<div class="pg-center">${icon}<h2>${esc(title)}</h2><p class="pg-msg">${esc(text)}</p>${extra || ''}</div>`;
}
var PG_CHECK = '<span class="pg-ico"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="14.5" fill="none" stroke="#1ed67a" stroke-width="3.4"/><path d="M17.5 24.5l4.8 4.8 8.7-9.8" fill="none" stroke="#1ed67a" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
var PG_CROSS = '<span class="pg-ico pg-bad"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="14.5" fill="none" stroke="#ff5d73" stroke-width="3.4"/><path d="M18.5 18.5l11 11M29.5 18.5l-11 11" fill="none" stroke="#ff5d73" stroke-width="3.4" stroke-linecap="round"/></svg></span>';
var PG_CLOCK = '<svg class="pg-clk" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function pgRefLine(){ const r = String(_pg.reference || ''); return r ? `<p class="pg-ref">Ref: ${esc(r.length > 20 ? r.slice(0, 18) + '…' : r)}</p>` : ''; }
// The 10-minute window to pay, counted on the server's clock down to the order's own end time. Only the form shows it; at 0:00 the page closes the order.
var _pgTick = 0;
function pgStopTimer(){ if (_pgTick) { clearInterval(_pgTick); _pgTick = 0; } }
function pgStartTimer(expiresAt, token){
  pgStopTimer();
  const draw = () => {
    if (token !== _pg.token || _pg.view !== 'form') return pgStopTimer();
    const left = Math.max(0, Math.ceil((Number(expiresAt) - ckNow()) / 1000));
    const box = $('pgTimer'), t = $('pgTimerTxt');
    if (t) t.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
    if (box) box.classList.toggle('pg-low', left <= 60);
    if (left <= 0) { pgStopTimer(); pgShowGone('This payment has expired. Please start again from Deposit.'); }
  };
  draw(); _pgTick = setInterval(draw, 1000);
}
function pgSet(view, html){
  pgStopTimer();
  _pg.view = view;
  const body = $('pgBody'); if (body) body.innerHTML = html;
  const el = $('payScreen'); if (el) el.scrollTop = 0;
}
function pgShowInitiated(){
  pgSet('initiated', pgCenterHtml(PG_CHECK, 'Payment Initiated!', 'Check your phone for a prompt from your mobile money provider. Approve it to complete the payment.', pgRefLine() + `<p class="pg-wait">${PG_CLOCK}<span>Awaiting mobile money approval</span></p>`));
}
function pgShowUnknown(){
  pgSet('unknown', pgCenterHtml(PG_CHECK, 'Still waiting', 'The payment has not been confirmed yet and nothing is lost. If you approve it, your balance updates on its own; you can also look in Records later.', pgRefLine() + `<button class="pg-pay pg-small" type="button" onclick="pgHome()">Back to Home</button>`));
}
function pgShowFailed(msg){
  pgSet('failed', pgCenterHtml(PG_CROSS, 'Payment failed', msg || 'The payment did not go through. Nothing was taken from you.', `<button class="pg-pay pg-small" type="button" onclick="pgAgain()">Try again</button><button class="pg-ghost" type="button" onclick="pgHome()">Back to Home</button>`));
}
function pgShowGone(msg){
  pgSet('gone', pgCenterHtml(PG_CROSS, 'Payment not available', msg || 'This payment link is not available.', `<button class="pg-pay pg-small" type="button" onclick="pgHome()">Back to Home</button>`));
}
// The page owns one history entry (like the other full-screen dialogs) so Back closes it instead of leaving the app, and the address bar shows
// /payment/<order number> while it is open.
function pgSyncUrl(no){
  const set = () => { try { if (pgOpen() && history.state && history.state.dlg) history.replaceState({ dlg: 1 }, '', '/payment/' + no); } catch (_) {} };
  [30, 500, 800, 1300].forEach(ms => setTimeout(set, ms));
}
window.openPaymentPage = async function(orderNo, fromAddress){
  const no = String(orderNo || '').trim();
  if (!/^\d{8,14}$/.test(no)) return;
  const el = $('payScreen'); if (!el) return;
  const token = ++_pg.token;
  _pg = { no, order: null, view: 'loading', depositId: '', reference: '', token };
  pgSet('loading', '');
  el.classList.add('show'); el.setAttribute('aria-hidden', 'false');
  try { document.title = pgTitle(); } catch (_) {}
  pgLockPasswordBoxes(true);
  lockBodyScroll();
  if (fromAddress) { try { history.replaceState({}, '', '/'); } catch (_) {} }
  if (!(history.state && history.state.sheet)) dlgOpened();
  setTimeout(() => { if (pgOpen() && !(history.state && history.state.dlg)) dlgOpened(); }, 700);
  pgSyncUrl(no);
  ckExpectLoad();
  const r = await api('/deposit/order/' + encodeURIComponent(no));
  if (token !== _pg.token || !pgOpen()) return;
  if (r.status !== 'success' || !r.order) return pgShowGone(r.status === 'error' && r.code === 'ORDER_NOT_FOUND' ? 'This payment link is not available.' : (r.message || 'Could not load this payment. Check your connection and try again.'));
  const o = r.order; _pg.order = o;
  if (o.depositId) {            // opened again after Pay was tapped (a refresh): carry on waiting for the same payment
    _pg.depositId = o.depositId; _pg.reference = o.reference || '';
    pgShowInitiated(); pgPoll(o.depositId, token); return;
  }
  if (o.state !== 'created') return pgShowGone(o.state === 'expired' || o.state === 'replaced' ? 'This payment has expired. Please start again from Deposit.' : 'This payment is not available.');
  pgSet('form', pgFormHtml(o));
  pgStartTimer(o.expiresAt, token);
};
window.closePaymentPage = function(){
  if (!pgOpen()) return;
  _pg.token++; pgStopTimer();
  const el = $('payScreen'); el.classList.remove('show'); el.setAttribute('aria-hidden', 'true');
  try { document.title = brandName(); } catch (_) {}
  pgLockPasswordBoxes(false);
  if (!isScrollLockOverlayOpen()) unlockBodyScroll();
  dlgClosed();
};
window.pgHome = function(){ closePaymentPage(); try { navigatePage('home'); } catch (_) {} };
window.pgAgain = function(){ closePaymentPage(); setTimeout(() => { try { openDepositSheet(); } catch (_) {} }, 450); };
// The payment request is sealed before it leaves the phone (the server's pay-seal.js opens it): ECDH P-256 with a fresh key for every payment, an
// AES-256-GCM box around the order number, phone and provider, a time stamp and a one-time random number. The answer comes back sealed with the same
// key. The browser only offers this on HTTPS; on the plain-HTTP design preview it goes the ordinary way.
function pgB64u(u8){ let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function pgUnB64u(t){ const s = atob(String(t).replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
async function pgSealedPost(path, body, again){
  const w = window, sub = w.crypto && w.crypto.subtle;
  if (!sub || w.isSecureContext === false) return post(path, body);
  const k = await api('/pay/key');
  if (!k || k.status !== 'success' || !k.jwk) return (k && k.status === 'error') ? k : { status: 'error', message: 'Could not start the payment. Please try again.' };
  const enc = new TextEncoder();
  const server = await sub.importKey('jwk', k.jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const mine = await sub.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const aes = await sub.importKey('raw', await sub.digest('SHA-256', await sub.deriveBits({ name: 'ECDH', public: server }, mine.privateKey, 256)), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const epk = pgB64u(new Uint8Array(await sub.exportKey('raw', mine.publicKey)));
  const iv = w.crypto.getRandomValues(new Uint8Array(12)), nonce = pgB64u(w.crypto.getRandomValues(new Uint8Array(18)));
  const ct = new Uint8Array(await sub.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(k.kid + '.' + epk) }, aes, enc.encode(JSON.stringify(Object.assign({ ts: ckNow(), nonce }, body)))));
  const r = await post(path, { sealed: { kid: k.kid, epk, iv: pgB64u(iv), ct: pgB64u(ct) } });
  if (r && r.code === 'SEAL_KEY' && !again) return pgSealedPost(path, body, true);   // the server restarted and has a new key
  if (r && r.sealed) {
    try {
      const plain = await sub.decrypt({ name: 'AES-GCM', iv: pgUnB64u(r.sealed.iv), additionalData: enc.encode(k.kid + '.res') }, aes, pgUnB64u(r.sealed.ct));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (_) { return { status: 'error', message: 'Could not read the answer. Check Records before trying again.' }; }
  }
  return r;
}
window.pgPay = async function(){
  const btn = $('pgPayBtn'); if (!btn || btn.disabled || _pg.view !== 'form') return;
  const err = $('pgErr'); if (err) err.textContent = '';
  const phoneBox = $('pgPhone');
  // An empty box gets the browser's own "Please fill out this field." bubble, as the design shows.
  if (phoneBox && !String(phoneBox.value).trim()) { phoneBox.focus(); if (phoneBox.reportValidity) phoneBox.reportValidity(); return; }
  const phone = cleanPhone((phoneBox || {}).value);
  if (!phone) { if (err) err.textContent = 'Enter a valid ' + regionName() + ' mobile number.'; return; }
  const network = ($('pgNet') || {}).value || '';
  const token = _pg.token, label = btn.textContent;
  btn.disabled = true; btn.classList.add('pg-busy');
  btn.innerHTML = '<span class="pg-ring"></span>Processing…';
  let r;
  try { r = await pgSealedPost('/deposit/marzpay', { orderNo: _pg.no, phone, network }); }
  catch (_) { r = null; }
  if (token !== _pg.token || !pgOpen()) return;
  if (!r || r.status !== 'success') {
    if (r && (r.code === 'ORDER_EXPIRED' || r.code === 'ORDER_NOT_FOUND')) return pgShowGone(r.message);
    btn.disabled = false; btn.classList.remove('pg-busy'); btn.textContent = label;
    if (err) err.textContent = (r && r.message) || 'Could not start the payment. Please try again.';
    return;
  }
  _pg.depositId = r.depositId; _pg.reference = r.reference || '';
  refreshTransactionsCache().catch(() => {});
  pgShowInitiated();
  pgPoll(r.depositId, token);
};
// One status read at a time (the same single-flight read the old status page used), a first check at 1 s, then every 1.5 s for 70 s, then every
// 4 s for 3 more minutes: a payment approved late still turns the page into its result.
async function pgPoll(depositId, token){
  const began = Date.now();
  await new Promise(r => setTimeout(r, DEP_POLL_FIRST_MS));
  while (Date.now() - began < 70000) {
    const t0 = Date.now();
    if (token !== _pg.token || !pgOpen()) return;
    const r = await depositStatusHold(depositId);
    if (token !== _pg.token || !pgOpen()) return;
    if (await pgApply(r, token)) return;
    const spent = Date.now() - t0;
    if (spent < DEP_POLL_EVERY_MS) await new Promise(r2 => setTimeout(r2, DEP_POLL_EVERY_MS - spent));
  }
  if (token !== _pg.token || !pgOpen()) return;
  pgShowUnknown();
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 4000));
    if (token !== _pg.token || !pgOpen()) return;
    const r = await depositStatusHold(depositId);
    if (token !== _pg.token || !pgOpen()) return;
    if (await pgApply(r, token)) return;
  }
}
async function pgApply(r, token){
  if (!r || r.status !== 'success') return false;
  if (r.state === 'matched') {
    refreshTransactionsCache().catch(() => {});
    _pg.token++; _pg.view = 'done';    // the poll loops stop; the page stays up for the moment below
    ckSuccessToast('Success');
    setTimeout(() => { if (pgOpen()) pgHome(); }, 2200);
    return true;
  }
  if (r.state === 'failed') { refreshTransactionsCache().catch(() => {}); pgShowFailed(r.message); return true; }
  return false;
}
// A payment page address opened directly (/payment/<order number>, e.g. after a refresh or from a saved link): the app signs the member in first,
// then shows that order.
function ckOpenPendingPayment(){
  const no = window._payOrderNo; if (!no) return false;
  window._payOrderNo = '';
  openPaymentPage(no, true);
  return true;
}
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
  $('sheetBg').classList.add('ck-wd-page');
  { const b = $('witBalance'); if (b) { b._v = 0; ckTween(b, Number((STATE.account || {}).walletBalance) || 0, v => numGroup(v, true), ckBalanceMs()); } }
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
  const gear = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  return `<div id="witWallet" class="ck-wrows">
      <div class="ck-wrow"><span>Real Name</span><em>${w ? esc(String(w.holder || '')) : ''}</em></div>
      <div class="ck-wrow"><span>Wallet</span><em>${w ? esc(walShort(w.network)) : ''}</em></div>
      <div class="ck-wrow"><span>Wallet Account</span><em>${w ? esc(walletDestDisplay(w)) : ''}</em></div>
    </div>
    <button id="witBindBtn" class="ck-bindbtn" type="button" onclick="openWalletSheet()">${gear}<span>Bind Wallet Card</span></button>`;
}
// The Withdraw page: an amount card (live "Withdraw <amount you receive>" button) and the wallet card.
function paintWithdrawSheet(s){
  const balance = (STATE.account && STATE.account.walletBalance) || 0;
  const fee = withdrawalFeePct(s);
  $('sheetBody').innerHTML = `<div class="ck-wd">
    <div class="ck-card ck-wdcard">
      <div class="ck-wdlab">Amount</div>
      <label class="ck-amtbox ck-amtbox2"><b>${esc(cur())}</b><input id="witAmount" type="text" inputmode="numeric" maxlength="9" placeholder="Enter Amount" oninput="this.value=this.value.replace(/[\s,]/g,'');syncWithdrawReceiveAmt()" autocomplete="off"></label>
      <div class="ck-balrow ck-balrow2"><span>Balance：</span><b>${esc(cur())}</b><i id="witBalance">${esc(numGroup(0, true))}</i></div>
      <div class="ck-feebox">
        <h4>Fee: ${fee}%</h4>
        <p>Withdrawals are processed within 30 minutes to 24 hours; you will receive <b>${esc(cur())}</b> <span id="witReceive">0</span>.</p>
      </div>
      <button class="ck-pay" id="witSubmitBtn" type="button" ${_withdrawSubmitting ? 'disabled' : ''} onclick="submitWithdraw()">Withdraw 0</button>
    </div>
    <div class="ck-card ck-wdcard2" id="witWalletBlock">${witWalletBlockHtml(s)}</div>
    <div class="ck-notes ck-wnotes">
      <p>Minimum withdrawal: ${esc(ckMoney(s.minWithdraw || 0))}</p>
      <p>Withdrawal time: ${esc(withdrawTimeText(s))}</p>
      <p>Once the withdrawal is complete, please share a screenshot of the successful transaction on your social media</p>
      <p class="r">Please do not disclose your app password to anyone</p>
    </div>
  </div>`;
}
// "07:00am-17:00pm", from the withdrawal hours the admin set; "24 hours" when no window is set.
function withdrawTimeText(s){
  if (!(s && s.withdrawWindowEnabled && s.withdrawOpenFrom && s.withdrawOpenTo)) return '24 hours';
  const ap = t => t + (Number(String(t).split(':')[0]) >= 12 ? 'pm' : 'am');
  return ap(s.withdrawOpenFrom) + '-' + ap(s.withdrawOpenTo);
}
function withdrawalFeePct(s){
  const value = Number(s && s.withdrawFeePct);
  return s && s.withdrawFeePct != null && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 15;
}
window.syncWithdrawReceiveAmt = function(){
  const amount = parseMoneyInput(($('witAmount') || {}).value);
  const got = amount > 0 ? amount - Math.round(amount * withdrawalFeePct(STATE.settings || {}) / 100) : 0;
  const btn = $('witSubmitBtn');
  if (btn && !btn.disabled) ckTween(btn, got, v => 'Withdraw ' + numGroup(Math.round(v), false), ckBalanceMs());
  const rc = $('witReceive'); if (rc) rc.textContent = ckNum(got);
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
  if (r.status === 'success') { STATE.transactions = r.transactions; STATE.transactionsTruncated = !!r.truncated; }
}
var _withdrawSubmitting = false;
window.submitWithdraw = async function(){
  const submitBtn = $('witSubmitBtn');
  if (!submitBtn || submitBtn.disabled || _withdrawSubmitting || !$('witAmount')) return;
  const amount = parseMoneyInput($('witAmount').value);
  // Whichever saved wallet is currently selected on screen -- may be one of
  // several now that Cookie allows saving more than one (see
  // witSelectedWallet()'s own comment).
  const acct = witSelectedWallet();
  if (!amount || amount <= 0) return notify('Please enter the Withdraw amount');
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
  _withdrawSubmitting = true;
  submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';
  let r;
  try { r = await post('/withdraw/request', { amount, network: acct.network, phone: acct.phone }); }
  finally {
    _withdrawSubmitting = false;
    submitBtn.disabled = false; submitBtn.textContent = 'Withdraw ' + numGroup(amount - Math.round(amount * withdrawalFeePct(STATE.settings || {}) / 100), false);
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
    if (STATE.page === 'account') paintAccount();
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
    <h3>Prompt</h3>
    <p class="ck-prompt-msg">Are you sure you want to purchase this product?</p>
    <div class="ck-prompt-btns"><button type="button" class="ck-prompt-no" onclick="closeConfirm()">Cancel</button><button type="button" class="ck-prompt-ok" id="confirmActionBtn">Confirm</button></div>`;
  $('confirmSheet').classList.add('ck-prompt');
  const actionBtn = $('confirmActionBtn');
  // A double tap on BUY NOW lands its second tap where this button appears: it is dead for the first 600 ms so nothing is bought unseen.
  actionBtn.disabled = true;
  setTimeout(() => { if (actionBtn.isConnected && actionBtn.textContent === 'Confirm') actionBtn.disabled = false; }, 600);
  actionBtn.onclick = async () => {
    if (actionBtn.disabled) return;
    actionBtn.disabled = true; actionBtn.textContent = '…';
    // The loading box is the real wait for the server's answer (its own check of the product, the price and the balance).
    let result;
    ckLoadBegin();
    try { result = await api('/invest/create', { method:'POST', body:JSON.stringify({ tierKey, expectedPrice: Number(p.price) || 0 }) }); }
    finally { ckLoadEnd(); }
    if (result.status === 'error' && result.code === 'PRICE_CHANGED') { try { refreshCatalogNow(); } catch (_) {} }
    if (result.status !== 'success') {
      actionBtn.disabled = false; actionBtn.textContent = 'Confirm';
      const short = result.code === 'INSUFFICIENT_BALANCE' || /^Need .*, have /.test(String(result.message || ''));
      if (short) {
        closeConfirm();
        notify('Insufficient balance, redirecting to deposit...', () => openDepositSheet());
        setTimeout(() => { if (_notifyOnClose) closeNotify(); }, 1800);
        return;
      }
      // A task product (Daily wage) is never bought: the server answers sold out, and the dialog closes with that notice.
      if (result.code === 'SOLD_OUT') closeConfirm();
      notify(result.message || 'Could not complete investment');
      return;
    }
    closeConfirm();
    showPage('home');
    ckSuccessToast('Success');
  };
  $('confirmBg').classList.add('show');
  lockBodyScroll(); dlgOpened();
};

// The Cancel button and backdrop both call this by name from inline markup.
// It must be a window property; a missing global here leaves confirmBg up and
// keeps the document's scroll lock active, which traps the member on screen.
window.closeConfirm = function(){
  $('confirmBg').classList.remove('show'); dlgClosed();
  // The card sinks away smoothly; its contents are cleared only once it is gone (and only if no new dialog has opened meanwhile).
  setTimeout(() => {
    if ($('confirmBg').classList.contains('show')) return;
    $('confirmSheet').innerHTML = '';
    $('confirmSheet').classList.remove('ck-prompt');
  }, 450);
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
