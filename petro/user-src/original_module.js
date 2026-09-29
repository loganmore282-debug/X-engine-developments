// Petro backend, on the same Hostinger VPS as this frontend (pm2, port 3000
// behind nginx). api./app. are still different subdomains -- different
// browser origins -- so this host must stay in server.js's CORS allowlist.
var API_BASE = 'http://179.198.197.114:3000';

function copyBubble(){ return `<div style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${ICONS.copy}</div>`; }

// Every money amount elsewhere is always a whole shilling -- only a
// gift-code reward can ever carry cents (Round 137's randomized rewards,
// e.g. 123.39), so this used to Math.round() them away entirely before
// display. Now only shows decimals on a value that actually has them --
// everything else (deposits, withdrawals, prices, cashback) keeps its old,
// clean whole-number look with no changes needed at any call site.
// ── REGION (which country this app is running as) ──
//
// Owner: "l wanted other subdomain to fetch other country code and
// currency, ie fgdr.petro-platform.com in ugx, and country code changeable
// to other country or created, and another can be sfhd.petro-platform in
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
    for (const id of ['loginDial', 'regDial', 'forgotDial']) { const el = $(id); if (el) el.textContent = d; }
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
var LANG_STORE_KEY = 'petro_lang';
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
  ['Processing your recharge', 'Tukola ku ssente zo', 'Tunashughulikia malipo yako', 'Traitement de votre recharge', 'Turimo gutunganya ubwishyu bwawe', 'Nitukora aha sente zaawe'],
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
  ['Login Password (at least 6 characters)', 'Ekisumuluzo ky\'Okuyingira (obutasingako bubonero 6)', 'Nenosiri la Kuingia (angalau herufi 6)', 'Mot de passe de connexion (6 caract\u00e8res minimum)', 'Ijambobanga ryo kwinjira (nibura inyuguti 6)', 'Ekisumuruzo ky\'Okutaaha (obukiri bubonero 6)'],
  ['No channel link is set yet.', 'Tewannabaawo lyanka lya kitundu.', 'Hakuna kiungo cha chaneli kilichowekwa bado.', 'Aucun lien de canal n\'est encore d\u00e9fini.', 'Nta murongo w\'umuyoboro urashyirwaho.', 'Tihariho orunyiriri rw\'ekitundu.'],
  ['Please enter the treasure chest key', 'Wandiika ekisumuluzo ky\'essanduku ly\'obugagga', 'Tafadhali weka ufunguo wa sanduku la hazina', 'Veuillez saisir la cl\u00e9 du coffre au tr\u00e9sor', 'Nyamuneka andika urufunguzo rw\'agasanduku k\'ubutunzi', 'Handiika ekishumuruzo ky\'esanduuku y\'obugaiga'],
  ['Please enter your actual payment account', 'Wandiika akawunti yo ey\'okusasula ey\'amazima', 'Tafadhali weka akaunti halisi utakayotumia kulipa', 'Veuillez saisir le compte de paiement que vous utiliserez r\u00e9ellement', 'Nyamuneka andika konti nyayo uzakoresha wishyura', 'Handiika akaunti yaawe y\'okushashura ey\'amazima'],
  ['Recharges are not available right now.', 'Okuteeka ssente tekusoboka kati.', 'Kuweka pesa hakupatikani kwa sasa.', 'Les recharges ne sont pas disponibles pour le moment.', 'Kubitsa ntibishoboka muri iki gihe.', 'Okuta sente tikirikubaasika hati.'],
  ['to check if it is successful', 'okukebera oba kigenze bulungi', 'ili kuangalia kama imefanikiwa', 'pour v\u00e9rifier si le paiement a r\u00e9ussi', 'kugira ngo urebe niba byagenze neza', 'kureeba yaaba kigyenzire gye'],
  ['Winnings go straight into your wallet.', 'Ebiwangulwa bigenda butereevu mu nsawo yo.', 'Ushindi huingia moja kwa moja kwenye pochi yako.', 'Les gains vont directement dans votre portefeuille.', 'Ibyo watsindiye bijya ako kanya mu mufuka wawe.', 'Ebi osiingwire nibigyenda butunu omu nsaho yaawe.'],
  ['Approve the payment to complete your recharge.', 'Kkiriza okusasula omalirize okuteeka ssente.', 'Idhinisha malipo ili kukamilisha kuweka pesa.', 'Approuvez le paiement pour terminer votre recharge.', 'Emeza ubwishyu kugira ngo urangize kubitsa.', 'Ikiriza okushashura omarizeho okuta sente.'],
  ['Check your phone for the payment prompt.', 'Kebera essimu yo olabe obubaka bw\'okusasula.', 'Angalia simu yako kwa ujumbe wa malipo.', 'V\u00e9rifiez votre t\u00e9l\u00e9phone pour la demande de paiement.', 'Reba kuri telefone yawe ubutumwa bwo kwishyura.', 'Reeba esimu yaawe oreebe obutumwa bw\'okushashura.'],
  ['Enter the mobile money number to charge.', 'Wandiika ennamba ya mobile money gy\'oggyako ssente.', 'Weka namba ya mobile money itakayotozwa.', 'Entrez le num\u00e9ro mobile money \u00e0 d\u00e9biter.', 'Andika nimero ya mobile money izakurwaho amafaranga.', 'Handiika enamba ya mobile money ei orikwihaho sente.'],
  ['Enter your key to unlock the reward', 'Wandiika ekisumuluzo kyo oggulewo empeera', 'Weka ufunguo wako ili kufungua zawadi', 'Entrez votre cl\u00e9 pour d\u00e9bloquer la r\u00e9compense', 'Andika urufunguzo rwawe ufungure igihembo', 'Handiika ekishumuruzo kyaawe oshumuurure empeera'],
  ['Password must be at least 6 characters.', 'Ekisumuluzo kiteekwa okuba n\'obubonero obutasinga mu 6.', 'Nenosiri lazima liwe na angalau herufi 6.', 'Le mot de passe doit comporter au moins 6 caract\u00e8res.', 'Ijambobanga rigomba kuba rifite nibura inyuguti 6.', 'Ekisumuruzo kishemereire kugira obubonero obukiri 6.'],
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
  ['Your new password must be at least 6 characters.', 'Ekisumuluzo kyo ekiggya kiteekwa okuba n\'obubonero obutasinga mu 6.', 'Nenosiri lako jipya lazima liwe na angalau herufi 6.', 'Votre nouveau mot de passe doit comporter au moins 6 caract\u00e8res.', 'Ijambobanga ryawe rishya rigomba kuba rifite nibura inyuguti 6.', 'Ekisumuruzo kyaawe ekisya kishemereire kugira obubonero obukiri 6.'],
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
  // fixture had always sent referralRequired:true, so this pair of sentences
  // had never once been on screen while anything was measuring.
  ['Referral code (optional)', "Koodi y'okuyita (teetaagisa)", 'Msimbo wa mwaliko (si lazima)', 'Code de parrainage (facultatif)', 'Kode yo gutumira (ntikenewe)', "Koodi y'okweta (tikyetengyesa)"],
  ['No code needed yet — you are among the first to join.', 'Tewetaagisa koodi kati — oli mu babereberye okwegatta.', 'Hakuna msimbo unaohitajika bado — wewe ni kati ya wa kwanza kujiunga.', "Aucun code n'est encore nécessaire — vous êtes parmi les premiers à nous rejoindre.", 'Nta kode ikenewe ubu — uri mu bambere binjira.', "Tihakwetengyesa koodi hati — oine omu b'okubanza kwegaitaho."],
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
  ['Could not start recharge', 'Tetusobodde kutandika kuteeka ssente', 'Imeshindwa kuanza kuweka pesa', 'Impossible de démarrer la recharge', 'Ntibyashobotse gutangira kubitsa', 'Tikibaasiikire kutandika kuta sente'],
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
  ['Cash-out time: {0} to {1}.', 'Ebiseera by’okuggyamu ssente: {0} okutuuka {1}.', 'Muda wa kutoa pesa: {0} hadi {1}.', 'Heures de retrait : de {0} à {1}.', 'Igihe cyo kubikuza: {0} kugeza {1}.', 'Obwire bw’okwihamu sente: {0} kuhika {1}.'],
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
  ['Cash-out must be a multiple of {0}. Try {1} or {2}.', 'Okuggyamu kulina kuba kwa {0}. Gezaako {1} oba {2}.', 'Kutoa pesa lazima kiwe kizidishi cha {0}. Jaribu {1} au {2}.', 'Le retrait doit être un multiple de {0}. Essayez {1} ou {2}.', 'Kubikuza bigomba kuba umubare ushobora kugabanywa na {0}. Gerageza {1} cyangwa {2}.', 'Okwihamu kushemereire kuba kwa {0}. Gyezaho {1} nari {2}.'],
  ['Cash-out is open from {0} to {1}. Please come back then.', 'Okuggyamu ssente kuggulwa okuva ku {0} okutuuka {1}. Ddamu okomewo mu budde obwo.', 'Kutoa pesa kunapatikana kuanzia {0} hadi {1}. Tafadhali rudi wakati huo.', 'Le retrait est ouvert de {0} à {1}. Merci de revenir à ce moment-là.', 'Kubikuza bifungura kuva {0} kugeza {1}. Ongera ugaruke icyo gihe.', 'Okwihamu sente nikwigurwa kuruga aha {0} kuhika {1}. Ogaruke omu bwire obu.'],
  ['Cash-out of {0} is processing. You will receive {1} after the {2}% charge.', 'Okuggyamu {0} kukolebwako. Ojja kufuna {1} oluvannyuma lw\'ossente z\'obuweereza eza {2}%.', 'Kutoa {0} kunashughulikiwa. Utapokea {1} baada ya ada ya {2}%.', 'Le retrait de {0} est en cours. Vous recevrez {1} après les frais de {2} %.', 'Kubikuza {0} birimo gutunganywa. Uzabona {1} nyuma y\'amafaranga ya serivisi ya {2}%.', 'Okwihamu {0} nikukorwaho. Noija kutunga {1} bwanyima ya sente z\'obuheereza eza {2}%.'],
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
// Petro-specific loader treatment -- the replacement loader shows a plain
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
// inset:0 on purpose, NOT bottom:var(--nav-h). This file's own rule: the set
// of overlays a nav tap can reach is exactly the set that does not cover the
// nav bar, and every one of those has needed teardown code in showPage() to
// stop it being left floating over a screen it no longer belongs to. Covering
// the bar means a nav tap cannot land behind it at all, so this needs no
// entry in that teardown and no history entry of its own.
function langPickerHtml(){
  return LANG_ALLOWED.map(code => {
    const m = langMeta(code);
    const on = code === LANG;
    return `<button class="lang-opt${on ? ' on' : ''}" onclick="setLang('${esc(code)}')">
      <span class="lang-names"><span class="n1">${esc(m.native)}</span><span class="n2">${esc(m.name)}</span></span>
      ${on ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' : ''}
    </button>`;
  }).join('');
}
function openLangPicker(){
  let bg = $('langSheetBg');
  if (!bg) {
    bg = document.createElement('div');
    bg.id = 'langSheetBg';
    bg.className = 'lang-sheet-bg';
    bg.setAttribute('data-no-i18n', '');
    bg.onclick = e => { if (e.target === bg) closeLangPicker(); };
    document.body.appendChild(bg);
  }
  // data-no-i18n on the whole sheet: every name in it is already written in
  // its own language and must never be put through the table.
  bg.innerHTML = `<div class="lang-sheet">
    <div class="lang-head"><b>${esc(t('Language'))}</b>
      <button class="lang-x" onclick="closeLangPicker()" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="lang-list">${langPickerHtml()}</div>
  </div>`;
  requestAnimationFrame(() => bg.classList.add('show'));
}
function closeLangPicker(){
  const bg = $('langSheetBg');
  if (bg) bg.classList.remove('show');
}
function fmtUGX(n){
  const v = Number(n)||0;
  const hasCents = Math.round(v*100)%100 !== 0;
  return cur() + ' ' + v.toLocaleString('en-UG', hasCents ? {minimumFractionDigits:2,maximumFractionDigits:2} : {});
}
// Keep investment and payout amounts on the same cents-aware formatter.
function fmtUGXCents(n){ return fmtUGX(n); }
const _numberAnimations = new WeakMap();
function countBetweenEl(el, from, to, format, duration){
  if (!el) return;
  const previous = _numberAnimations.get(el);
  if (previous) cancelAnimationFrame(previous);
  const start = Number(from) || 0, end = Number(to) || 0;
  if (!duration || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    el.textContent = format(end); return;
  }
  let began;
  const tick = now => {
    if (!el.isConnected) { _numberAnimations.delete(el); return; }
    if (began == null) began = now;
    const progress = Math.min(1, (now - began) / duration);
    el.textContent = format(start + (end - start) * (1 - Math.pow(1 - progress, 3)));
    if (progress < 1) _numberAnimations.set(el, requestAnimationFrame(tick));
    else _numberAnimations.delete(el);
  };
  _numberAnimations.set(el, requestAnimationFrame(tick));
}
// subagent-audit-caught: the deposit/withdraw amount fields have no
// oninput sanitizer, and every amount the app itself shows (quick-amount
// chips, "min UGX 30,000" hints) is comma-formatted via fmtUGX() -- so a
// member typing "30,000" out of habit fed straight into a bare parseInt()
// stops at the comma (parseInt("30,000",10) === 30), producing a
// nonsensical "Minimum amount is UGX 30,000" rejection right next to an
// input that visibly still reads "30,000". Strips thousands separators
// before parsing.
function parseMoneyInput(v){ return parseInt(String(v||'').replace(/,/g,''), 10); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Owner: "on announcement welcome dialog, make when l can put a link text
// just within the message body so as l put the WhatsApp group link in
// the text, so it will be link text." Auto-detects any http(s) URL
// (exactly the form WhatsApp itself gives you when you copy a group
// invite link) typed directly inside a plain-text message and turns just
// that substring into a real clickable link -- everything else stays
// plain text. esc() runs FIRST over the whole string, so this is safe to
// render as innerHTML: the only markup that can ever appear is the <a>
// tag this function itself adds, never anything from the admin-entered
// text (an already-escaped '&amp;' inside a matched URL is correctly
// re-decoded by the browser when it appears inside the href attribute).
const URL_PATTERN = /(https?:\/\/[^\s<]+)/g;
function linkifyText(text){
  return esc(text).replace(URL_PATTERN, url => `<a href="${url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;font-weight:700;">${url}</a>`);
}
// Owner: "let payment number on payment page be 07.....,no country code
// putting" -- the merchant/admin payment number stored server-side always
// stays canonical +256XXXXXXXXX; this is a DISPLAY-ONLY conversion applied
// at render time, never touching what's stored/compared. See CLAUDE.md's
// own note on why the stored format must never change.
function toLocalPhoneDisplay(num){
  const s = String(num || '').trim();
  const p = dialPlus();
  return s.indexOf(p) === 0 ? '0' + s.slice(p.length) : s;
}
// Every phone field is now local-number-only -- the "+256" country code is
// a static chip next to the input (see .phone-field/.phone-prefix), not
// something typed here at all (owner: "make +256 static, so one can type
// 07xxxxxxxx or 7xxxxxxxx... just the system understand it"). Caps at 10
// digits for the "0"-leading Ugandan style ("0769968158") or 9 for the bare
// style ("769968158") -- both are accepted identically by the server's own
// cleanPhone(), so which one someone types doesn't matter. Also tolerates
// someone pasting a full number WITH the country code straight into this
// now-local-only field (strips a leading "256" back off first) rather than
// mangling it down to a wrong, truncated value.
var GIFT_CODE_REFERENCE_SVG = '<svg class="gift-reference-svg" viewBox="0 0 512 512" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><image x="0" y="0" width="512" height="512" preserveAspectRatio="xMidYMid meet" href="data:image/jpeg;base64,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"/></svg>';
var ICONS = {
  // ── Petro additions ──────────────────────────────────────────────────
  grid: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>',
  megaphone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M14.5 8.5a4.5 4.5 0 0 1 0 7"/><path d="M17.5 5.5a8.5 8.5 0 0 1 0 13"/></svg>',
  envelope: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 6l8 7 8-7"/></svg>',
  // Full-size support-email badge, rebuilt from the supplied red envelope
  // reference with Petro's red, orange and yellow palette (no white fill).
  emailPetro: '<svg class="email-petro-icon" width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#E30613"/><circle cx="32" cy="32" r="26.5" fill="#F15A24"/><path d="M15.5 22.5c0-2.2 1.8-4 4-4h25c2.2 0 4 1.8 4 4v19c0 2.2-1.8 4-4 4h-25c-2.2 0-4-1.8-4-4v-19Z" fill="#FFB51B" stroke="#9F1420" stroke-width="2.7"/><path d="m17.5 22 14.5 12 14.5-12" stroke="#D91E2B" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="m18 42 11-10m17 10L35 32" stroke="#F05A28" stroke-width="2.5" stroke-linecap="round"/><path d="M20 24h24" stroke="#FFE17A" stroke-width="1.8" stroke-linecap="round"/></svg>',
  // ── Petro re-theme additions: the Home mockup's own icon set (Deposit/
  // Withdraw/Invite/Support tiles, the notification bell, the gift-box
  // Daily Check-in card, the wallet-balance eye toggle, the 3 stat-card
  // glyphs) -- replacing the old Petro raster PNGs (/act-deposit.png etc.,
  // the owner's own uploaded artwork for Petro, never Petro's) with real
  // SVG, same 24x24/currentColor/1.8-1.9 stroke convention as every icon
  // above. White-on-red circle badges are painted by .home-action .badge's
  // own CSS (background var(--petro-grad)), not baked into these paths.
  bell: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z"/><path d="M9.5 18.5a2.5 2.5 0 0 0 5 0"/></svg>',
  headset: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.6"/><rect x="17" y="13" width="4" height="6" rx="1.6"/><path d="M20 19a4 4 0 0 1-4 3h-2.5"/></svg>',
  cardPlus: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="2.4"/><path d="M2.5 10h19"/><path d="M6.5 15h4"/><path d="M17.2 3.6v5.2M14.6 6.2h5.2"/></svg>',
  arrowDownTray: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19.5h16"/></svg>',
  peoplePlus: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.5" r="3.4"/><path d="M2.8 19c.7-3.3 3.2-5.2 6.2-5.2s5.5 1.9 6.2 5.2"/><path d="M18 4.6v5.2M15.4 7.2h5.2"/></svg>',
  giftBox: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9.5" width="18" height="10.5" rx="1.6"/><path d="M3 13.5h18"/><path d="M12 9.5v10.5"/><path d="M12 9.5c-1.6 0-4-.7-4-3 0-1.5 1.2-2.5 2.5-2.5C12.2 4 12 7 12 9.5Z"/><path d="M12 9.5c1.6 0 4-.7 4-3 0-1.5-1.2-2.5-2.5-2.5C11.8 4 12 7 12 9.5Z"/></svg>',
  rulesGavel: '<svg width="34" height="34" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g transform="rotate(24 27 22)" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="3" width="31" height="10" rx="4"/><path d="M17 13h21v20H17z"/><rect x="9" y="32" width="37" height="10" rx="4"/></g><path d="m38 37 18 10" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M14 51a14 9 0 0 1 28 0" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><rect x="6" y="52" width="44" height="6" rx="3" fill="currentColor"/></svg>',
  // Vector redraw of the supplied sparkly Petro gift: warm red box, golden
  // ribbon and bow, plus the alternating red/yellow/white celebration marks.
  checkinCalendar: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="1.4" y="2.5" width="21.2" height="20" rx="3.1" stroke="currentColor" stroke-width="2.6"/><path d="M7.3 1v3.2m9.4-3.2v3.2" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M8.3 9.1h2.8v2.8H8.3zm4.3 0h2.8v2.8h-2.8zm4.3 0h2.8v2.8h-2.8zM4 13.6h2.8v2.8H4zm4.3 0h2.8v2.8H8.3zm8.6 0h2.8v2.8h-2.8zM4 17.9h2.8v2.8H4zm4.3 0h2.8v2.8H8.3zm4.3 0h2.8v2.8h-2.8z" fill="currentColor"/><path d="m12.5 14.9 1.2 1.2 2.7-3.2" stroke="currentColor" stroke-width="2.1" stroke-linecap="square" stroke-linejoin="miter"/></svg>',
  coinsStack: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v5c0 1.66 3.13 3 7 3s7-1.34 7-3V6"/><path d="M5 11v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/></svg>',
  arrowDownCircle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v7"/><path d="M8.7 11.2 12 14.5l3.3-3.3"/></svg>',
  arrowUpCircle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16.5v-7"/><path d="M8.7 12.8 12 9.5l3.3 3.3"/></svg>',
  eyeOpen: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7c2.3 0 4.3.6 6 1.5M23 12s-1.4 2.5-4 4.5M14.1 14.1a3 3 0 0 1-4.2-4.2"/><path d="M3 3l18 18"/></svg>',
  chevronRight: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  // ── Account/Network/Assets screen icon set (owner's 2nd/3rd/4th mockup
  // round) -- same real-SVG replacement of the old Petro raster row icons. ──
  layers: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 8 12 13l9.5-5L12 3Z"/><path d="m2.5 13 9.5 5 9.5-5"/><path d="m2.5 18 9.5 5 9.5-5"/></svg>',
  trendUp: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17 9.5 10l4.5 4.5L21 6"/><path d="M15 6h6v6"/></svg>',
  peopleGroup: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9.5" r="2.6"/><path d="M2.6 19c.7-3.1 3-4.9 6.4-4.9s5.7 1.8 6.4 4.9"/><path d="M15.4 14.7c2.5.4 4 1.9 4.5 4.1"/></svg>',
  giftSmall: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9.5" width="18" height="10.5" rx="1.6"/><path d="M3 13.5h18"/><path d="M12 9.5v10.5"/><path d="M12 9.5c-1.6 0-4-.7-4-3 0-1.5 1.2-2.5 2.5-2.5C12.2 4 12 7 12 9.5Z"/><path d="M12 9.5c1.6 0 4-.7 4-3 0-1.5-1.2-2.5-2.5-2.5C11.8 4 12 7 12 9.5Z"/></svg>',
  shieldCheck: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 5 6v5.5c0 4.6 3 7.8 7 9 4-1.2 7-4.4 7-9V6l-7-2.5Z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>',
  infoCircle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r="1" fill="currentColor" stroke="none"/></svg>',
  logoutArrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  bankLink: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10 12 4l9 6"/><path d="M5 10v9M9.5 10v9M14.5 10v9M19 10v9"/><path d="M3 19h18"/></svg>',
  diamond: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 3h10l4 6-11 12L2 9l5-6Z" opacity=".92"/></svg>',
  qrCode: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 14v3M14 19h3M19 19h2"/></svg>',
  linkIcon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5 12.5 5A4 4 0 1 1 18 10.5L16.5 12"/><path d="M13 17.5 11.5 19A4 4 0 1 1 6 13.5L7.5 12"/></svg>',
  trophy: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4.5A2.5 2.5 0 0 0 4 11c.5.8 1.5 1.2 2.5 1"/><path d="M17 6h2.5A2.5 2.5 0 0 1 20 11c-.5.8-1.5 1.2-2.5 1"/><path d="M12 14v3"/><path d="M8.5 20.5h7"/><path d="M9.5 17.5h5v1.5a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5v-1.5Z"/></svg>',
  gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M17.7 6.3l-1.6 1.6M7.9 16.1l-1.6 1.6M17.7 17.7l-1.6-1.6M7.9 7.9 6.3 6.3"/></svg>',
  // ── Bottom nav (4 tabs, owner's mockups: Home/Assets/Network/Account) --
  // real SVG replacing the old per-tab raster PNGs (/nav-home.png etc). ──
  navHome: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v10.5a1 1 0 0 0 1 1H9.5v-6h5v6H17.5a1 1 0 0 0 1-1V9"/></svg>',
  navPerson: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1-4 4-6 7.5-6s6.5 2 7.5 6"/></svg>',
  lock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2.2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  keyIcon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2 2M14 9l2 2"/></svg>',
  telegram: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21.5 3.5 2.9 10.6c-1.2.5-1.2 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14c.3-1.3-.5-1.9-1.6-1.5Z"/></svg>',
  // Real WhatsApp glyph (the handset-in-speech-bubble mark alone, not a
  // second circle -- openSupportSheet() below already draws the brand-green
  // circular badge in CSS, so a second ring baked into the SVG would just
  // double it up). Same single-path fill="currentColor" convention as the
  // telegram icon right above.
  whatsapp: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2.5c-5.26 0-9.54 4.26-9.54 9.5 0 1.68.45 3.28 1.23 4.66L2.5 21.5l5-1.22a9.55 9.55 0 0 0 4.54 1.15h.01c5.26 0 9.54-4.26 9.54-9.5 0-2.53-1-4.9-2.8-6.7a9.54 9.54 0 0 0-6.75-2.73Zm5.56 13.44c-.24.66-1.4 1.27-1.93 1.34-.5.07-1.11.1-1.79-.11a16.4 16.4 0 0 1-1.63-.6c-2.88-1.24-4.76-4.13-4.9-4.32-.14-.2-1.17-1.56-1.17-2.97 0-1.42.74-2.11 1-2.4.27-.29.58-.36.78-.36.2 0 .39 0 .56.01.18.01.42-.07.65.5.24.58.81 2 .88 2.15.07.15.12.32.02.51-.1.2-.15.32-.3.49-.14.17-.3.38-.43.51-.15.15-.3.31-.13.6.17.3.77 1.27 1.65 2.06 1.14 1.01 2.1 1.33 2.4 1.48.3.15.47.13.65-.08.17-.2.73-.85.93-1.15.19-.29.39-.24.65-.14.27.09 1.7.8 2 .95.29.14.48.21.55.33.07.13.07.72-.17 1.4Z"/></svg>',
  warnTriangle: '<svg width="46" height="46" viewBox="0 0 24 24" fill="none"><path d="M12 3 2 20h20L12 3Z" fill="#ffb000" stroke="#a66a00" stroke-width="1"/><path d="M12 10v4" stroke="#5a3d00" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.1" fill="#5a3d00"/></svg>',
  wheel: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  bell:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>',
  deposit: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v8"/><path d="M8.5 12 12 15.5 15.5 12"/></svg>',
  withdraw: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16.5v-8"/><path d="M8.5 12 12 8.5 15.5 12"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  backArrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a1 1 0 0 0 1-1v-9"/></svg>',
  box: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1536" width="26" height="26"><path d="M 505 1108 L 509 1125 L 521 1146 L 536 1161 L 546 1167 L 572 1175 L 597 1174 L 616 1168 L 628 1161 L 646 1143 L 659 1116 L 659 1107 L 649 1106 L 646 1109 L 645 1115 L 635 1131 L 617 1147 L 600 1154 L 578 1156 L 565 1154 L 547 1146 L 528 1129 L 521 1118 L 517 1106 L 508 1106 Z M 617 1024 L 615 1026 L 615 1084 L 620 1087 L 628 1086 L 630 1083 L 629 1069 L 634 1065 L 638 1072 L 641 1083 L 647 1087 L 655 1086 L 656 1083 L 649 1065 L 649 1057 L 654 1048 L 654 1037 L 651 1030 L 648 1027 L 640 1024 Z M 633 1036 L 637 1037 L 640 1041 L 640 1047 L 635 1052 L 629 1049 L 629 1040 Z M 578 1024 L 575 1028 L 576 1037 L 574 1084 L 576 1086 L 603 1087 L 607 1084 L 607 1076 L 592 1075 L 589 1070 L 591 1063 L 602 1061 L 604 1059 L 604 1055 L 600 1050 L 593 1050 L 589 1046 L 589 1043 L 593 1037 L 603 1037 L 605 1034 L 605 1027 L 602 1024 Z M 537 1024 L 534 1028 L 534 1084 L 537 1087 L 562 1087 L 566 1084 L 566 1077 L 563 1075 L 551 1075 L 549 1073 L 549 1066 L 554 1062 L 562 1061 L 563 1053 L 561 1051 L 551 1049 L 548 1043 L 552 1037 L 563 1037 L 565 1028 L 561 1024 Z M 489 1024 L 486 1028 L 487 1084 L 488 1086 L 500 1087 L 517 1085 L 525 1078 L 527 1071 L 526 1063 L 521 1056 L 521 1051 L 525 1040 L 524 1035 L 518 1027 L 513 1025 Z M 503 1061 L 508 1061 L 512 1065 L 511 1073 L 508 1075 L 503 1075 L 501 1073 L 501 1063 Z M 503 1036 L 506 1036 L 510 1039 L 511 1043 L 507 1048 L 503 1048 L 501 1046 L 501 1039 Z M 582 937 L 575 949 L 566 949 L 567 970 L 565 972 L 559 968 L 547 967 L 543 973 L 546 979 L 546 984 L 543 988 L 550 996 L 560 1001 L 558 1008 L 560 1010 L 571 1010 L 579 1006 L 582 1013 L 585 1015 L 583 1011 L 585 1005 L 596 1010 L 605 1010 L 608 1008 L 607 1001 L 620 992 L 622 971 L 617 967 L 609 968 L 602 972 L 599 976 L 597 973 L 599 968 L 598 957 L 600 949 L 592 948 L 586 938 Z M 507 963 L 509 971 L 514 971 L 517 968 L 519 954 L 526 936 L 536 922 L 545 914 L 566 904 L 588 902 L 601 904 L 614 910 L 623 917 L 638 935 L 645 950 L 649 969 L 651 971 L 657 971 L 659 969 L 659 958 L 652 933 L 645 918 L 631 901 L 615 890 L 602 885 L 591 883 L 574 883 L 558 887 L 556 889 L 550 890 L 532 903 L 519 920 L 512 935 Z M 808 881 L 805 882 L 798 890 L 797 903 L 801 912 L 805 916 L 812 917 L 813 916 L 811 914 L 808 902 Z M 491 946 L 490 969 L 492 971 L 499 971 L 501 969 L 504 946 L 509 929 L 515 916 L 522 906 L 536 892 L 557 880 L 571 876 L 593 876 L 615 883 L 630 893 L 642 905 L 652 920 L 659 936 L 659 941 L 663 952 L 664 966 L 666 970 L 676 970 L 676 953 L 673 946 L 673 938 L 663 911 L 652 893 L 641 880 L 627 869 L 615 862 L 594 856 L 571 856 L 558 859 L 543 866 L 529 876 L 515 890 L 502 910 L 494 932 Z M 825 719 L 816 735 L 808 734 L 805 736 L 806 747 L 804 750 L 804 758 L 810 768 L 809 772 L 799 760 L 789 759 L 782 755 L 779 757 L 779 762 L 774 766 L 774 769 L 779 775 L 779 779 L 775 785 L 787 795 L 796 797 L 798 799 L 797 802 L 793 805 L 793 808 L 801 813 L 806 814 L 820 806 L 823 806 L 824 823 L 826 825 L 828 823 L 828 807 L 830 805 L 846 812 L 858 810 L 859 805 L 854 802 L 854 799 L 864 796 L 878 785 L 873 777 L 879 768 L 879 766 L 873 760 L 873 757 L 870 756 L 864 760 L 857 759 L 842 775 L 841 771 L 844 768 L 849 755 L 847 748 L 848 735 L 838 735 L 830 721 Z M 838 686 L 838 690 L 847 691 L 864 697 L 885 710 L 906 733 L 913 744 L 921 763 L 926 765 L 927 760 L 913 731 L 903 718 L 888 704 L 864 690 L 844 685 Z M 600 525 L 596 528 L 594 533 L 595 554 L 599 557 L 610 556 L 611 553 L 602 548 L 609 541 L 609 539 L 601 534 L 610 530 L 608 526 Z M 574 526 L 573 552 L 576 556 L 588 557 L 591 554 L 590 552 L 583 548 L 584 544 L 588 540 L 581 534 L 589 531 L 590 528 L 586 525 Z M 557 525 L 553 530 L 553 554 L 558 557 L 564 557 L 569 555 L 567 551 L 561 548 L 567 542 L 567 540 L 563 537 L 563 533 L 568 530 L 568 527 Z M 533 525 L 530 527 L 528 533 L 529 556 L 545 556 L 549 551 L 547 531 L 544 526 Z M 1182 285 L 1177 280 L 1166 274 L 1083 273 L 1073 274 L 1064 278 L 1055 290 L 1051 314 L 1053 319 L 1060 325 L 1055 350 L 1055 360 L 1061 370 L 1061 381 L 1059 385 L 1050 455 L 1048 458 L 1047 477 L 1045 481 L 1044 499 L 1042 505 L 1037 563 L 1037 599 L 1035 603 L 1034 614 L 1026 633 L 1003 661 L 990 684 L 983 706 L 979 728 L 979 737 L 983 742 L 993 745 L 1001 744 L 1006 714 L 1014 690 L 1027 667 L 1039 651 L 1040 655 L 1028 679 L 1020 707 L 1020 715 L 1017 727 L 1017 751 L 1025 759 L 1053 759 L 1074 768 L 1086 780 L 1095 785 L 1097 798 L 1094 801 L 1087 797 L 1079 796 L 1070 785 L 1057 777 L 1047 775 L 1025 777 L 1021 776 L 1003 763 L 991 759 L 973 758 L 963 759 L 951 763 L 935 773 L 924 786 L 903 790 L 890 800 L 884 808 L 880 810 L 865 811 L 857 814 L 845 821 L 838 829 L 831 842 L 829 851 L 829 872 L 822 882 L 818 892 L 817 923 L 814 927 L 754 928 L 751 923 L 753 918 L 765 916 L 767 913 L 772 912 L 753 913 L 751 910 L 752 902 L 757 899 L 781 896 L 789 893 L 794 882 L 800 876 L 815 867 L 813 863 L 753 862 L 751 860 L 752 855 L 755 853 L 812 854 L 818 850 L 818 846 L 816 843 L 757 844 L 751 840 L 748 789 L 746 786 L 742 763 L 739 758 L 739 747 L 752 726 L 766 711 L 788 697 L 810 690 L 817 690 L 821 685 L 799 687 L 787 691 L 770 700 L 753 715 L 745 725 L 738 738 L 735 740 L 732 738 L 731 732 L 726 722 L 728 716 L 747 694 L 766 680 L 788 670 L 812 665 L 837 665 L 849 667 L 875 676 L 899 691 L 920 713 L 930 728 L 940 748 L 945 749 L 954 745 L 962 744 L 966 740 L 967 735 L 967 660 L 964 608 L 958 589 L 948 570 L 937 556 L 917 536 L 911 527 L 906 514 L 904 503 L 899 415 L 897 409 L 892 334 L 890 329 L 889 302 L 887 297 L 886 272 L 883 255 L 883 248 L 890 235 L 889 223 L 883 208 L 884 204 L 889 200 L 890 197 L 889 179 L 881 169 L 868 164 L 786 164 L 774 168 L 769 172 L 763 182 L 761 193 L 762 198 L 768 204 L 768 213 L 763 227 L 763 239 L 768 246 L 770 253 L 765 312 L 763 318 L 762 345 L 759 363 L 759 380 L 757 389 L 749 509 L 745 523 L 741 530 L 721 550 L 701 578 L 687 611 L 683 633 L 684 668 L 687 681 L 710 748 L 714 769 L 715 788 L 717 792 L 717 1277 L 713 1291 L 706 1298 L 701 1300 L 698 1297 L 703 1284 L 703 796 L 701 789 L 700 770 L 693 738 L 673 684 L 667 656 L 659 558 L 656 547 L 656 534 L 653 521 L 653 510 L 645 448 L 645 435 L 642 424 L 642 412 L 637 374 L 637 365 L 645 355 L 645 341 L 639 317 L 646 310 L 648 304 L 648 294 L 642 278 L 634 271 L 621 267 L 534 268 L 529 271 L 519 282 L 515 289 L 515 309 L 522 317 L 522 322 L 518 335 L 517 354 L 519 360 L 526 367 L 521 421 L 518 435 L 518 448 L 515 459 L 515 474 L 512 489 L 512 503 L 505 558 L 504 581 L 502 586 L 496 659 L 491 686 L 471 736 L 463 774 L 460 802 L 460 1248 L 461 1277 L 463 1285 L 468 1291 L 472 1293 L 473 1290 L 474 880 L 472 800 L 474 789 L 474 774 L 481 746 L 501 704 L 507 685 L 512 619 L 516 587 L 513 581 L 518 574 L 526 494 L 529 481 L 529 467 L 532 455 L 536 394 L 538 386 L 537 383 L 539 376 L 546 373 L 552 374 L 554 376 L 549 478 L 544 483 L 534 484 L 532 490 L 534 492 L 615 491 L 632 493 L 635 496 L 632 499 L 632 523 L 628 526 L 618 526 L 616 528 L 615 551 L 616 555 L 620 557 L 625 552 L 627 552 L 629 556 L 635 561 L 636 575 L 641 580 L 650 580 L 652 582 L 619 587 L 540 587 L 527 584 L 522 588 L 523 592 L 537 596 L 540 601 L 535 664 L 535 683 L 532 700 L 528 711 L 501 764 L 491 794 L 487 821 L 487 928 L 490 930 L 495 911 L 506 892 L 515 880 L 530 866 L 550 855 L 563 851 L 576 849 L 595 850 L 605 852 L 623 859 L 634 866 L 653 884 L 665 902 L 673 919 L 682 958 L 680 1019 L 677 1023 L 666 1027 L 659 1036 L 660 1051 L 666 1058 L 675 1062 L 679 1067 L 679 1070 L 676 1074 L 662 1074 L 660 1080 L 662 1085 L 669 1088 L 674 1088 L 679 1092 L 680 1104 L 676 1109 L 667 1109 L 664 1112 L 659 1131 L 652 1145 L 642 1158 L 634 1165 L 620 1174 L 602 1181 L 584 1184 L 574 1184 L 559 1181 L 534 1168 L 519 1153 L 505 1130 L 500 1109 L 492 1109 L 488 1111 L 488 1119 L 498 1151 L 505 1164 L 515 1177 L 529 1191 L 546 1202 L 562 1208 L 575 1210 L 598 1209 L 612 1205 L 639 1188 L 659 1165 L 669 1145 L 676 1121 L 678 1118 L 681 1120 L 679 1133 L 673 1151 L 667 1163 L 653 1183 L 640 1196 L 627 1205 L 612 1212 L 593 1216 L 563 1215 L 552 1212 L 534 1203 L 515 1187 L 501 1169 L 490 1147 L 486 1143 L 488 1290 L 495 1295 L 504 1297 L 533 1299 L 538 1301 L 569 1302 L 609 1307 L 571 1311 L 520 1311 L 483 1308 L 480 1306 L 470 1305 L 462 1301 L 453 1292 L 447 1277 L 446 809 L 449 776 L 454 748 L 460 727 L 474 693 L 480 665 L 480 640 L 476 608 L 474 603 L 474 590 L 471 580 L 470 562 L 468 557 L 463 502 L 460 488 L 460 475 L 457 463 L 457 451 L 454 439 L 455 432 L 460 424 L 460 416 L 457 409 L 454 392 L 464 377 L 463 360 L 459 352 L 452 344 L 441 339 L 342 339 L 330 344 L 323 353 L 319 362 L 320 381 L 329 390 L 325 423 L 327 429 L 332 434 L 333 443 L 329 463 L 329 481 L 327 488 L 322 552 L 316 594 L 315 618 L 313 622 L 312 645 L 308 673 L 308 692 L 315 703 L 321 707 L 323 704 L 326 664 L 329 651 L 329 639 L 324 634 L 327 631 L 379 642 L 391 646 L 409 646 L 457 632 L 466 631 L 468 633 L 461 638 L 428 646 L 423 649 L 405 654 L 387 652 L 380 649 L 374 649 L 348 642 L 343 646 L 343 665 L 337 725 L 338 737 L 342 739 L 353 739 L 367 742 L 371 745 L 385 749 L 407 762 L 419 774 L 429 790 L 435 808 L 435 825 L 432 837 L 428 839 L 421 829 L 421 814 L 415 794 L 406 781 L 398 773 L 386 766 L 375 762 L 369 762 L 357 756 L 328 753 L 322 747 L 318 729 L 309 715 L 298 705 L 286 698 L 270 693 L 251 693 L 235 698 L 226 704 L 213 718 L 197 722 L 185 728 L 178 735 L 168 752 L 153 753 L 137 762 L 133 762 L 125 766 L 113 776 L 106 791 L 106 809 L 99 824 L 97 833 L 99 851 L 103 859 L 117 877 L 116 912 L 113 921 L 113 935 L 105 987 L 103 990 L 102 1007 L 100 1011 L 99 1065 L 106 1105 L 113 1124 L 113 1128 L 130 1171 L 141 1217 L 141 1228 L 143 1236 L 141 1263 L 138 1276 L 130 1294 L 130 1299 L 127 1306 L 127 1314 L 130 1325 L 139 1338 L 125 1346 L 83 1358 L 1487 1358 L 1481 1355 L 1468 1353 L 1463 1350 L 1458 1350 L 1442 1344 L 1432 1338 L 1432 1334 L 1439 1324 L 1440 1306 L 1436 1292 L 1435 1274 L 1427 1254 L 1427 1235 L 1433 1161 L 1435 1156 L 1436 1133 L 1439 1117 L 1446 1038 L 1449 1025 L 1456 946 L 1456 834 L 1469 812 L 1471 802 L 1470 786 L 1463 771 L 1450 757 L 1449 747 L 1442 734 L 1432 725 L 1412 718 L 1404 711 L 1389 704 L 1357 704 L 1337 712 L 1333 709 L 1332 702 L 1326 690 L 1315 678 L 1307 673 L 1263 659 L 1239 660 L 1222 669 L 1207 684 L 1202 682 L 1202 677 L 1205 673 L 1206 667 L 1222 652 L 1222 650 L 1206 629 L 1202 616 L 1200 599 L 1200 555 L 1195 485 L 1192 469 L 1192 456 L 1189 445 L 1189 436 L 1180 382 L 1180 369 L 1185 360 L 1185 351 L 1180 325 L 1188 315 L 1189 309 L 1188 298 Z M 1275 1250 L 1280 1252 L 1277 1257 L 1273 1253 Z M 1333 1248 L 1338 1247 L 1340 1252 L 1338 1254 L 1334 1254 Z M 1301 1237 L 1305 1241 L 1305 1246 L 1301 1250 L 1297 1251 L 1292 1246 L 1292 1241 L 1296 1237 Z M 227 1213 L 232 1217 L 232 1221 L 228 1225 L 225 1224 L 221 1218 L 224 1214 Z M 285 1212 L 290 1214 L 288 1219 L 284 1219 L 282 1217 Z M 1308 1195 L 1313 1194 L 1318 1199 L 1318 1203 L 1314 1208 L 1310 1208 L 1305 1204 L 1305 1199 Z M 1345 1190 L 1349 1193 L 1346 1198 L 1344 1198 L 1342 1195 Z M 335 1179 L 339 1184 L 339 1199 L 335 1202 L 333 1197 L 333 1183 Z M 279 1169 L 283 1169 L 288 1174 L 287 1181 L 281 1185 L 274 1181 L 274 1173 Z M 1296 1165 L 1301 1165 L 1305 1169 L 1305 1173 L 1301 1177 L 1296 1177 L 1292 1172 Z M 1359 1151 L 1365 1151 L 1370 1157 L 1369 1161 L 1363 1166 L 1358 1165 L 1354 1160 L 1354 1156 Z M 238 1151 L 247 1152 L 253 1157 L 255 1162 L 255 1168 L 253 1172 L 245 1178 L 237 1177 L 230 1170 L 230 1159 Z M 248 1159 L 241 1159 L 238 1166 L 241 1169 L 247 1168 L 250 1164 Z M 751 1152 L 755 1150 L 770 1161 L 786 1167 L 815 1171 L 817 1173 L 818 1179 L 817 1191 L 812 1193 L 794 1192 L 774 1188 L 756 1181 L 751 1176 Z M 1333 1137 L 1338 1137 L 1342 1142 L 1342 1145 L 1337 1150 L 1333 1150 L 1328 1145 L 1328 1142 Z M 1360 1100 L 1363 1100 L 1367 1104 L 1366 1109 L 1362 1112 L 1356 1108 L 1356 1104 Z M 1302 1095 L 1310 1095 L 1316 1101 L 1315 1110 L 1307 1116 L 1300 1114 L 1295 1107 L 1296 1101 Z M 410 1093 L 411 1100 L 407 1132 L 402 1150 L 401 1165 L 398 1172 L 396 1173 L 394 1164 L 395 1144 L 406 1099 Z M 262 1072 L 269 1072 L 278 1080 L 280 1084 L 279 1093 L 272 1100 L 260 1100 L 254 1095 L 251 1089 L 251 1084 L 254 1078 Z M 267 1080 L 263 1083 L 262 1088 L 265 1092 L 270 1092 L 274 1088 L 274 1084 Z M 1355 1066 L 1362 1066 L 1364 1073 L 1360 1076 L 1356 1076 L 1353 1073 Z M 1314 1062 L 1319 1060 L 1327 1062 L 1330 1067 L 1330 1073 L 1325 1078 L 1316 1078 L 1311 1071 L 1311 1067 Z M 754 1060 L 812 1059 L 817 1062 L 818 1160 L 816 1164 L 800 1164 L 777 1157 L 765 1150 L 752 1138 L 751 1063 Z M 300 1042 L 304 1042 L 306 1045 L 303 1050 L 301 1050 L 298 1046 Z M 678 1036 L 681 1039 L 680 1047 L 676 1047 L 674 1045 L 673 1039 Z M 1321 1033 L 1324 1033 L 1328 1038 L 1325 1044 L 1320 1044 L 1316 1040 L 1316 1037 Z M 187 1031 L 192 1033 L 197 1040 L 196 1046 L 190 1051 L 185 1051 L 178 1045 L 179 1036 Z M 1382 1020 L 1386 1020 L 1392 1026 L 1392 1032 L 1390 1036 L 1384 1039 L 1378 1038 L 1374 1034 L 1373 1030 L 1374 1026 Z M 225 1018 L 231 1017 L 237 1022 L 238 1029 L 235 1033 L 227 1035 L 221 1031 L 220 1024 Z M 1306 1001 L 1314 1000 L 1316 1003 L 1316 1008 L 1312 1011 L 1307 1010 L 1305 1007 Z M 1359 992 L 1363 992 L 1367 996 L 1367 1001 L 1362 1006 L 1358 1005 L 1354 1001 L 1356 994 Z M 178 978 L 183 978 L 186 982 L 185 988 L 181 991 L 174 987 L 174 981 Z M 156 978 L 161 998 L 161 1010 L 169 1064 L 171 1067 L 172 1077 L 178 1094 L 182 1113 L 185 1119 L 185 1124 L 191 1140 L 196 1170 L 198 1174 L 199 1189 L 202 1199 L 202 1212 L 205 1225 L 205 1236 L 202 1239 L 193 1239 L 190 1235 L 190 1209 L 185 1171 L 158 1072 L 154 1042 L 153 1018 L 154 985 Z M 1307 971 L 1312 972 L 1315 976 L 1311 982 L 1307 982 L 1303 977 Z M 1335 966 L 1338 965 L 1344 970 L 1345 973 L 1341 979 L 1334 979 L 1331 975 L 1331 970 Z M 214 965 L 219 965 L 222 968 L 222 973 L 218 976 L 213 975 L 211 972 L 211 969 Z M 1383 957 L 1389 958 L 1393 963 L 1392 970 L 1387 975 L 1381 975 L 1376 968 L 1378 960 Z M 298 949 L 300 946 L 303 946 L 305 951 L 300 953 Z M 1355 939 L 1358 943 L 1358 946 L 1352 949 L 1349 946 L 1349 942 L 1352 939 Z M 816 938 L 818 944 L 817 1047 L 754 1048 L 751 1045 L 751 1036 L 754 1033 L 772 1031 L 775 1027 L 775 1016 L 764 1013 L 759 1007 L 759 1001 L 763 997 L 772 995 L 772 984 L 769 982 L 764 982 L 760 977 L 760 973 L 764 968 L 772 967 L 773 956 L 772 954 L 755 953 L 751 947 L 752 941 L 755 938 Z M 785 953 L 783 956 L 783 1027 L 788 1032 L 805 1033 L 811 1029 L 812 1019 L 809 1014 L 804 1014 L 801 1012 L 800 1004 L 801 1000 L 805 996 L 811 995 L 812 987 L 810 983 L 806 983 L 801 980 L 800 973 L 803 969 L 810 967 L 811 956 L 809 954 Z M 1295 930 L 1300 930 L 1305 935 L 1305 939 L 1300 945 L 1294 945 L 1289 939 L 1290 934 Z M 248 919 L 256 921 L 261 926 L 264 933 L 261 942 L 255 948 L 250 949 L 242 948 L 234 938 L 234 931 L 236 926 L 242 921 Z M 249 927 L 244 931 L 244 937 L 247 939 L 253 939 L 256 937 L 257 931 L 254 928 Z M 184 914 L 194 913 L 198 916 L 201 922 L 199 929 L 193 934 L 188 934 L 179 925 L 180 919 Z M 1375 911 L 1382 911 L 1387 917 L 1386 923 L 1380 928 L 1374 927 L 1370 921 L 1371 915 Z M 1278 905 L 1284 904 L 1285 908 L 1280 910 Z M 1324 895 L 1332 897 L 1337 905 L 1336 912 L 1331 917 L 1321 917 L 1316 913 L 1315 910 L 1316 901 Z M 1378 894 L 1379 889 L 1386 891 L 1383 896 Z M 1238 882 L 1244 883 L 1247 887 L 1247 892 L 1242 897 L 1238 897 L 1233 891 L 1234 886 Z M 784 885 L 784 888 L 779 893 L 754 896 L 751 892 L 752 884 L 756 882 L 777 881 Z M 389 883 L 439 881 L 443 884 L 443 906 L 441 909 L 437 910 L 425 907 L 403 906 L 400 904 L 385 904 L 377 907 L 372 912 L 368 920 L 357 964 L 352 1020 L 352 1069 L 357 1126 L 368 1169 L 374 1181 L 384 1194 L 406 1212 L 421 1219 L 437 1223 L 442 1227 L 443 1256 L 438 1259 L 424 1256 L 402 1247 L 381 1233 L 366 1218 L 354 1201 L 344 1179 L 343 1172 L 337 1157 L 330 1118 L 326 1063 L 326 1038 L 329 986 L 337 939 L 343 919 L 353 902 L 367 890 Z M 1290 879 L 1293 879 L 1297 884 L 1294 889 L 1289 889 L 1286 885 Z M 1393 876 L 1395 873 L 1399 873 L 1401 878 L 1396 881 Z M 1358 868 L 1362 874 L 1361 877 L 1355 881 L 1350 877 L 1350 873 L 1353 869 Z M 1322 853 L 1328 855 L 1331 860 L 1329 866 L 1325 869 L 1321 869 L 1316 864 L 1317 857 Z M 1248 852 L 1255 853 L 1260 859 L 1258 866 L 1252 870 L 1246 869 L 1241 863 L 1242 857 Z M 1427 845 L 1430 850 L 1430 930 L 1428 969 L 1422 1024 L 1422 1039 L 1419 1053 L 1419 1067 L 1408 1162 L 1408 1179 L 1405 1195 L 1403 1255 L 1405 1265 L 1411 1276 L 1412 1295 L 1416 1311 L 1415 1319 L 1407 1326 L 1383 1330 L 1317 1331 L 1285 1328 L 1279 1325 L 1275 1320 L 1396 1318 L 1403 1314 L 1402 1304 L 1397 1300 L 1374 1305 L 1352 1306 L 1344 1308 L 1306 1308 L 1300 1306 L 1278 1305 L 1270 1300 L 1282 1297 L 1309 1295 L 1397 1295 L 1399 1290 L 1398 1281 L 1393 1276 L 1382 1278 L 1376 1281 L 1339 1286 L 1292 1286 L 1270 1284 L 1261 1281 L 1252 1275 L 1255 1273 L 1346 1274 L 1384 1272 L 1391 1270 L 1391 1211 L 1394 1194 L 1395 1164 L 1397 1156 L 1402 1090 L 1405 1075 L 1405 1059 L 1408 1044 L 1408 1026 L 1412 988 L 1414 918 L 1413 847 L 1417 844 Z M 965 786 L 978 784 L 993 787 L 1004 794 L 1014 807 L 1020 807 L 1025 804 L 1032 803 L 1046 804 L 1058 814 L 1065 824 L 1085 824 L 1096 837 L 1110 832 L 1118 832 L 1126 835 L 1137 848 L 1140 860 L 1145 870 L 1146 880 L 1143 889 L 1135 897 L 1123 903 L 1123 920 L 1125 922 L 1201 922 L 1214 924 L 1223 928 L 1233 936 L 1243 955 L 1247 980 L 1250 987 L 1251 1001 L 1253 1005 L 1258 1064 L 1257 1141 L 1250 1193 L 1239 1215 L 1227 1226 L 1212 1233 L 1132 1234 L 1130 1237 L 1131 1255 L 1133 1259 L 1134 1279 L 1137 1290 L 1137 1303 L 1128 1309 L 1099 1314 L 1060 1316 L 1043 1319 L 928 1319 L 912 1316 L 892 1316 L 857 1311 L 844 1308 L 837 1301 L 845 1229 L 848 1163 L 849 994 L 845 988 L 842 976 L 842 967 L 848 946 L 848 937 L 842 926 L 842 909 L 848 897 L 856 889 L 856 883 L 851 870 L 851 862 L 855 850 L 864 841 L 877 835 L 898 837 L 904 822 L 909 817 L 921 812 L 932 814 L 936 813 L 939 806 L 950 794 Z M 864 1265 L 864 1269 L 867 1274 L 879 1277 L 933 1278 L 952 1280 L 1087 1278 L 1108 1275 L 1112 1272 L 1112 1264 L 1109 1261 L 1103 1261 L 1094 1264 L 1084 1264 L 1073 1267 L 1011 1271 L 936 1270 L 902 1267 L 891 1264 L 881 1264 L 872 1261 L 866 1261 Z M 1125 968 L 1123 970 L 1123 1035 L 1125 1059 L 1124 1071 L 1127 1185 L 1131 1188 L 1195 1187 L 1202 1185 L 1205 1182 L 1209 1171 L 1215 1111 L 1215 1066 L 1213 1033 L 1205 981 L 1202 973 L 1196 968 Z M 1183 974 L 1194 975 L 1197 980 L 1200 1001 L 1202 1005 L 1203 1020 L 1205 1024 L 1206 1051 L 1208 1061 L 1208 1110 L 1206 1118 L 1205 1146 L 1203 1149 L 1203 1159 L 1200 1174 L 1197 1178 L 1190 1181 L 1185 1179 L 1184 1171 L 1192 1121 L 1192 1049 L 1184 993 L 1180 978 Z M 1125 937 L 1122 939 L 1122 948 L 1125 952 L 1193 952 L 1204 956 L 1208 960 L 1212 967 L 1219 1002 L 1219 1011 L 1223 1030 L 1226 1076 L 1226 1117 L 1223 1154 L 1219 1170 L 1219 1177 L 1212 1192 L 1204 1199 L 1194 1202 L 1131 1202 L 1126 1206 L 1126 1213 L 1132 1219 L 1197 1219 L 1211 1216 L 1223 1209 L 1233 1194 L 1236 1184 L 1241 1141 L 1241 1046 L 1236 1001 L 1226 956 L 1222 948 L 1216 942 L 1203 937 Z M 877 886 L 876 890 L 883 900 L 890 903 L 905 902 L 912 904 L 919 919 L 915 923 L 883 924 L 876 930 L 875 934 L 873 1012 L 872 1216 L 870 1230 L 871 1249 L 876 1253 L 894 1256 L 926 1258 L 1050 1258 L 1084 1256 L 1106 1251 L 1110 1244 L 1106 1183 L 1105 1045 L 1103 1019 L 1102 932 L 1100 927 L 1095 923 L 1066 923 L 1064 920 L 1066 911 L 1069 907 L 1084 906 L 1089 902 L 1091 898 L 1090 895 L 1085 893 L 1074 898 L 1058 897 L 1054 904 L 1050 922 L 1046 928 L 1040 931 L 1032 930 L 1024 924 L 1020 916 L 1019 907 L 1016 904 L 1011 906 L 1000 906 L 987 901 L 992 919 L 992 930 L 989 937 L 976 953 L 973 967 L 964 975 L 952 976 L 948 975 L 940 967 L 937 961 L 935 946 L 938 936 L 938 919 L 934 908 L 928 899 L 928 895 L 926 893 L 916 894 L 903 891 L 888 893 Z M 960 1010 L 963 1015 L 963 1052 L 965 1079 L 966 1221 L 963 1224 L 958 1225 L 952 1220 L 953 1119 L 955 1115 L 955 1015 Z M 1011 961 L 1013 963 L 1013 1090 L 1015 1093 L 1016 1220 L 1011 1225 L 1007 1225 L 1001 1218 L 1003 1175 L 1003 1106 L 1006 1061 L 1007 965 Z M 1067 953 L 1069 974 L 1071 1219 L 1066 1225 L 1063 1226 L 1058 1222 L 1057 1209 L 1059 1108 L 1061 1081 L 1062 973 L 1064 967 L 1064 956 Z M 912 953 L 914 963 L 914 1064 L 916 1107 L 917 1220 L 912 1225 L 908 1225 L 904 1219 L 904 1202 L 906 1178 L 908 974 L 909 961 Z M 891 931 L 897 939 L 900 1029 L 897 1236 L 891 1244 L 886 1239 L 887 1002 L 889 978 L 889 935 Z M 257 718 L 275 721 L 291 733 L 296 746 L 294 757 L 306 764 L 309 769 L 311 781 L 324 779 L 335 786 L 337 784 L 349 782 L 359 787 L 367 796 L 378 795 L 385 798 L 394 809 L 396 818 L 394 834 L 387 843 L 402 850 L 408 860 L 408 867 L 404 872 L 388 873 L 375 876 L 355 887 L 345 889 L 323 888 L 299 882 L 290 882 L 281 886 L 269 888 L 231 885 L 229 888 L 230 895 L 228 902 L 225 906 L 218 908 L 213 908 L 206 905 L 203 900 L 203 888 L 199 885 L 159 886 L 156 890 L 150 953 L 148 958 L 147 975 L 144 984 L 144 994 L 138 1026 L 137 1053 L 141 1085 L 147 1108 L 164 1153 L 175 1190 L 180 1219 L 181 1257 L 184 1261 L 191 1264 L 240 1268 L 328 1267 L 336 1265 L 362 1264 L 368 1262 L 373 1267 L 370 1275 L 361 1283 L 328 1295 L 302 1298 L 226 1298 L 194 1295 L 176 1291 L 172 1293 L 171 1300 L 174 1305 L 180 1308 L 217 1313 L 291 1314 L 362 1310 L 364 1312 L 363 1315 L 350 1316 L 343 1320 L 334 1321 L 366 1321 L 368 1324 L 363 1326 L 295 1332 L 222 1332 L 173 1328 L 159 1323 L 152 1314 L 152 1307 L 161 1283 L 165 1264 L 165 1218 L 157 1178 L 133 1112 L 124 1076 L 124 1013 L 127 1002 L 127 993 L 130 985 L 130 976 L 137 935 L 138 915 L 140 911 L 141 871 L 137 866 L 134 854 L 124 846 L 121 836 L 125 826 L 132 820 L 129 807 L 130 797 L 139 786 L 150 782 L 157 782 L 168 770 L 183 766 L 189 753 L 199 745 L 204 743 L 222 745 L 230 732 L 238 725 L 245 721 Z M 149 853 L 149 861 L 151 865 L 157 868 L 166 868 L 177 860 L 173 858 L 164 859 L 153 853 Z M 350 847 L 348 839 L 345 835 L 334 847 L 327 851 L 319 851 L 300 840 L 295 842 L 285 842 L 281 839 L 278 839 L 274 852 L 268 858 L 261 861 L 254 861 L 247 859 L 238 853 L 236 855 L 236 862 L 245 872 L 255 876 L 266 876 L 278 872 L 285 868 L 293 860 L 297 861 L 303 867 L 312 872 L 329 873 L 339 869 L 344 865 L 349 857 Z M 1123 776 L 1127 760 L 1137 745 L 1144 739 L 1153 734 L 1161 732 L 1174 734 L 1179 724 L 1188 715 L 1197 711 L 1206 711 L 1216 714 L 1218 713 L 1223 701 L 1229 694 L 1236 690 L 1245 690 L 1254 684 L 1263 684 L 1274 692 L 1288 694 L 1302 706 L 1311 723 L 1312 736 L 1314 741 L 1331 740 L 1344 744 L 1358 732 L 1368 729 L 1380 729 L 1390 732 L 1400 739 L 1405 745 L 1415 749 L 1421 754 L 1425 761 L 1425 778 L 1436 783 L 1442 790 L 1443 803 L 1434 814 L 1423 817 L 1418 812 L 1420 807 L 1419 802 L 1413 799 L 1404 811 L 1396 817 L 1388 818 L 1379 817 L 1370 808 L 1367 797 L 1365 797 L 1353 807 L 1346 809 L 1332 807 L 1320 799 L 1315 810 L 1307 817 L 1294 817 L 1284 809 L 1280 801 L 1277 801 L 1271 816 L 1264 827 L 1256 835 L 1245 842 L 1234 845 L 1225 844 L 1218 841 L 1207 830 L 1198 838 L 1190 842 L 1174 845 L 1160 841 L 1154 835 L 1147 821 L 1127 803 L 1123 789 Z M 466 603 L 463 607 L 402 625 L 377 621 L 371 618 L 364 618 L 361 616 L 337 611 L 325 606 L 327 603 L 337 604 L 372 612 L 375 614 L 386 615 L 391 618 L 405 618 L 421 612 L 445 607 L 451 604 L 457 604 L 462 601 Z M 555 598 L 578 597 L 609 599 L 605 604 L 592 607 L 578 607 L 564 604 Z M 558 479 L 566 474 L 582 471 L 605 474 L 614 479 L 612 481 L 560 481 Z M 356 436 L 360 439 L 360 458 L 357 476 L 357 495 L 349 592 L 347 594 L 341 594 L 335 589 L 335 579 L 340 536 L 340 522 L 343 508 L 344 481 L 346 476 L 347 448 L 350 437 Z M 775 418 L 784 431 L 787 441 L 784 469 L 783 526 L 780 545 L 773 566 L 765 582 L 756 595 L 746 618 L 742 637 L 741 655 L 738 664 L 726 680 L 717 684 L 711 675 L 708 665 L 707 646 L 709 635 L 718 605 L 725 589 L 748 558 L 762 526 L 767 497 L 767 469 L 769 458 L 770 430 L 772 419 Z M 342 424 L 344 397 L 346 391 L 349 388 L 394 390 L 401 393 L 391 396 L 359 399 L 357 401 L 357 408 L 354 418 L 355 427 L 345 427 Z M 1089 373 L 1093 376 L 1092 404 L 1094 407 L 1109 402 L 1127 402 L 1148 409 L 1162 420 L 1164 424 L 1159 427 L 1142 416 L 1130 413 L 1118 412 L 1100 417 L 1101 419 L 1116 416 L 1124 416 L 1139 419 L 1152 426 L 1166 441 L 1171 450 L 1175 461 L 1178 486 L 1175 497 L 1169 507 L 1159 517 L 1146 525 L 1133 529 L 1102 529 L 1087 522 L 1085 523 L 1101 532 L 1134 534 L 1127 539 L 1114 542 L 1099 541 L 1085 535 L 1079 535 L 1077 583 L 1075 594 L 1053 632 L 1052 627 L 1055 617 L 1056 592 L 1058 586 L 1062 509 L 1064 503 L 1065 478 L 1072 429 L 1072 418 L 1075 409 L 1075 397 L 1078 387 L 1078 378 L 1081 374 Z M 1122 432 L 1118 432 L 1102 448 L 1100 452 L 1100 462 L 1098 464 L 1087 463 L 1085 465 L 1086 469 L 1082 475 L 1086 485 L 1095 496 L 1096 503 L 1099 505 L 1107 505 L 1115 502 L 1118 506 L 1118 512 L 1121 511 L 1121 505 L 1123 502 L 1138 506 L 1142 504 L 1144 496 L 1157 479 L 1157 476 L 1153 472 L 1154 465 L 1152 463 L 1141 464 L 1139 462 L 1140 451 Z M 336 362 L 343 354 L 348 353 L 435 353 L 439 354 L 444 360 L 443 366 L 441 368 L 438 363 L 434 362 L 430 369 L 427 369 L 425 365 L 421 363 L 414 369 L 406 360 L 403 361 L 401 366 L 398 368 L 390 360 L 385 363 L 383 368 L 381 368 L 376 361 L 372 361 L 367 368 L 365 368 L 362 363 L 358 362 L 352 370 L 345 361 L 338 368 Z M 1073 362 L 1072 356 L 1075 346 L 1076 330 L 1080 326 L 1119 326 L 1122 328 L 1104 332 L 1089 333 L 1086 344 L 1086 365 L 1084 367 L 1077 366 Z M 820 322 L 840 323 L 855 330 L 863 337 L 873 339 L 879 348 L 884 375 L 882 397 L 872 414 L 852 429 L 831 435 L 809 432 L 791 422 L 778 408 L 773 398 L 771 386 L 773 355 L 777 343 L 781 339 L 788 339 L 806 326 Z M 794 413 L 797 418 L 812 425 L 843 425 L 857 418 L 858 415 L 861 414 L 859 413 L 843 423 L 822 424 L 812 423 Z M 826 338 L 819 347 L 812 349 L 812 362 L 810 366 L 800 362 L 794 364 L 792 369 L 794 381 L 800 387 L 805 389 L 804 398 L 811 399 L 819 394 L 822 394 L 825 397 L 826 405 L 827 396 L 829 394 L 837 398 L 847 398 L 848 394 L 846 390 L 856 384 L 859 380 L 857 364 L 850 363 L 840 367 L 840 351 L 836 349 Z M 537 320 L 540 317 L 582 317 L 583 318 L 580 322 L 555 323 L 550 331 L 550 345 L 557 349 L 586 351 L 586 355 L 578 357 L 537 359 L 533 355 L 533 342 Z M 784 331 L 794 322 L 805 316 L 819 312 L 834 312 L 857 320 L 869 332 L 867 334 L 849 323 L 830 319 L 819 319 L 806 323 L 788 334 Z M 1075 292 L 1081 288 L 1151 288 L 1156 292 L 1156 298 L 1154 301 L 1145 299 L 1139 303 L 1134 296 L 1130 296 L 1124 303 L 1118 296 L 1114 296 L 1107 304 L 1105 299 L 1102 296 L 1099 296 L 1094 305 L 1088 299 L 1086 299 L 1080 305 L 1075 296 Z M 536 286 L 540 282 L 615 281 L 623 283 L 627 287 L 627 292 L 623 294 L 619 291 L 616 293 L 613 299 L 607 290 L 603 291 L 598 296 L 592 289 L 589 290 L 585 296 L 582 296 L 581 293 L 575 289 L 568 296 L 563 291 L 560 291 L 554 297 L 547 291 L 540 297 L 536 292 Z M 781 242 L 783 240 L 789 240 L 796 243 L 812 244 L 813 246 L 804 249 L 785 250 L 782 247 Z M 783 182 L 786 178 L 790 177 L 858 177 L 868 179 L 871 184 L 869 186 L 862 185 L 857 190 L 852 185 L 848 185 L 843 189 L 836 184 L 829 190 L 824 185 L 818 185 L 816 189 L 812 189 L 809 185 L 804 185 L 800 189 L 791 185 L 787 189 Z" fill="#000000" fill-rule="evenodd" clip-rule="evenodd"/></svg>',
  team: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1536" width="20" height="20"><defs><mask id="people-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="1536" height="1536"><rect width="1536" height="1536" fill="#ffffff"/><circle cx="1120" cy="1120" r="416" fill="#000000"/></mask></defs><g fill="#212121" mask="url(#people-cutout)"><circle cx="352" cy="416" r="160"/><circle cx="768" cy="384" r="192"/><circle cx="1184" cy="416" r="160"/><path d=" M288 640 H472 C436 676 416 721 416 768 V960 C416 1055 426 1125 448 1216 H352 C228 1216 128 1116 128 992 V800 C128 712 200 640 288 640 Z "/><path d=" M640 640 H896 C984 640 1056 712 1056 800 V1088 C1056 1229 941 1344 800 1344 H736 C595 1344 480 1229 480 1088 V800 C480 712 552 640 640 640 Z "/><path d=" M1064 640 H1248 C1336 640 1408 712 1408 800 V992 C1408 1116 1308 1216 1184 1216 H1088 C1110 1125 1120 1055 1120 960 V768 C1120 721 1100 676 1064 640 Z "/></g><circle cx="1120" cy="1120" r="352" fill="#212121"/><path d="M1120 928V1312 M928 1120H1312" fill="none" stroke="#ffffff" stroke-width="64" stroke-linecap="round"/></svg>',
  user: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1536" width="20" height="20"><circle cx="768" cy="448" r="256" fill="none" stroke="currentColor" stroke-width="128"/><path d="M256 1344 V1088 C256 1017.3 313.3 960 384 960 H1152 C1222.7 960 1280 1017.3 1280 1088 V1344" fill="none" stroke="currentColor" stroke-width="128" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  walletLg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M15.5 14.5h2.5"/></svg>',
  docLg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M14 3.5V8h4"/><path d="M9 12h6M9 15.5h6"/></svg>',
  // Generic receipt glyph; the account statement uses its original extracted artwork below.
  receiptLg: '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h10v14.3l-1.3-.9-1.4.9-1.3-.9-1.4.9-1.3-.9-1.4.9-1.3-.9-1.3.9V3.5Z"/><path d="M9 7.3h5M9 10h5"/><circle cx="16.3" cy="15.3" r="2.7"/><path d="M16.3 14v2.6M15 15.3h2.6"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12.5" r="8"/><path d="M12 8.5v4l3 2"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15 8.5V6A1.5 1.5 0 0 0 13.5 4.5H6A1.5 1.5 0 0 0 4.5 6v7.5A1.5 1.5 0 0 0 6 15h2.5"/></svg>',
  share: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="6" r="2.3"/><circle cx="6" cy="12" r="2.3"/><circle cx="18" cy="18" r="2.3"/><path d="M8.1 10.8 15.9 7.2M8.1 13.2l7.8 3.6"/></svg>',
  shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6l7-3Z"/><path d="M9 12l2 2 4-4"/></svg>',
  doc: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M14 3.5V8h4"/><path d="M9 12h6M9 15.5h6"/></svg>',
  headset: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4.5" height="6" rx="1.5"/><rect x="16.5" y="13" width="4.5" height="6" rx="1.5"/><path d="M20 19v.5A3.5 3.5 0 0 1 16.5 23H13"/></svg>',
  download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M8 11.5 12 15.5 16 11.5"/><path d="M5 18.5h14"/></svg>',
  downloadApp: '<svg width="34" height="34" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="50" cy="50" r="46" stroke="currentColor" stroke-width="3.7"/><path d="M50 24v32m0 0 13-13M50 56 37 43" stroke="currentColor" stroke-width="4.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 49 33 67c.7 2.4 2.7 4 5.2 4h23.6c2.5 0 4.5-1.6 5.2-4L72 49" stroke="currentColor" stroke-width="4.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  logout: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h3"/><path d="M14.5 8.5 19 12l-4.5 3.5"/><path d="M19 12H9.5"/></svg>',
  people2: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M14.8 14a5 5 0 0 1 6.7 4.7"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6"/><path d="M8 17.5 5.5 15A4 4 0 0 1 11 9.5"/><path d="M16 6.5 18.5 9A4 4 0 0 1 13 14.5"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/></svg>',
  eye: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A11.4 11.4 0 0 1 12 5c7 0 11 7 11 7a17.5 17.5 0 0 1-3.1 3.9M6.7 6.7C3.6 8.5 1 12 1 12s4 7 11 7a10.6 10.6 0 0 0 4.3-.9"/><path d="M9.5 9.8A3 3 0 0 0 12 15a3 3 0 0 0 2.2-.97"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  // 3 new icons for the manual-pay code screen's per-section timeline
  // (owner: "use the same svg just as the last 3rd photo, it has proper
  // svgs" -- that screenshot has no extractable source, drawn to visually
  // match it in this app's own stroke-icon style rather than copied).
  refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v5.5h5.5"/><path d="M20 20v-5.5h-5.5"/><path d="M5.2 9.5A8 8 0 0 1 19 8.2"/><path d="M18.8 14.5A8 8 0 0 1 5 15.8"/></svg>',
  idCard: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.6 1.9-2.4 3-2.4s2.5.8 3 2.4"/><path d="M14 9.5h4.5M14 13h4.5"/></svg>',
  bulb: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 18h5"/><path d="M10.3 21h3.4"/><path d="M12 3a6 6 0 0 0-3.3 11c.6.4.9.9.9 1.6v.4h4.8v-.4c0-.7.3-1.2.9-1.6A6 6 0 0 0 12 3Z"/></svg>',
};

// Exact member-supplied action and navigation silhouettes. Their raster
// originals are kept as transparent masks so currentColor controls the tint.
var SUPPLIED_MEMBER_ICON_ASSETS = {
  accountGift: 'data:image/png;base64,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',
  deposit: 'data:image/png;base64,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',
  withdraw: 'data:image/png;base64,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',
  invite: 'data:image/png;base64,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',
  support: 'data:image/png;base64,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',
  navHome: 'data:image/png;base64,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',
  navNetwork: 'data:image/png;base64,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',
  navAccount: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCRcFFgZI5U0aAAAN0ElEQVR42uWceexdRRXHP++9X0uhC22BUrrYQqGERatlCSpiUmQpqERME43SgoSlGBZRwyKBoiYsMcS0FIjUaDFhqVEgkQiSWEhBNFDZGhal1FJaW7pBgWLb33tf/5g5vefN7773u/f9fqU1nuTmvjd35sw53zlzZu7MuVORxC6gClADGvEy2hf4JHBMvE8GDgRGAIOBvYAqsA34ANgEvAP8E3gR+DvwMvCu41mNVx3od2Uq/QyQAeOFPQQ4AzgVOBYYHfN1QgLWAs8BjwGPAsvb1L3HAFQhtGIjCjcEOBs4F/g8MDDJb0oo4ZGC4Z8ZAJ52AE8DvwJ+T7C6VJbdDlAtCtIA9gMuBmYDY2N6Beh2wpqiZa1INFtHBehydawG7gTuAjZGkCqxzG4ByFqqDuwNfBe4CtjfAWbMzU94ZTcAK6Nia4EtBAtoRH4jgIOAccCEyNeD6v2byVKJfG8B5gMfkfnCjhTtFCDfOqcA84DDE0FEs6WsBZ4A/gwsBd6IoBShYcAk4DhgGvBFgi+zeuquHgPrdeBS4HGarbwcSSp71eJ9H0l3KFBDUrekerw3YvqHkh6Q9BVJQ3J4VSK/LkkDkqsrPqvklBsi6czIe2svMtwRZfWyF77KgtMV70dIeikKsMMJVY9pmyXdKukTDggTsEtSNV5d8coDoeKe+/y1hOcnJN0kaVOs28uyI6a9FGX2OvQ7QMb4DElbHDjWcpK0XdI8SaMTC/GWUG3RkgMl7RuvgS0st9qG74GS5kraFmUxKzKQ3ouylwKpLDjfiZU2nAAGzl8lfTpRoKpmi/AKjZA0I3aBpyStkLQuXiskLYnPZsS8eTw84Jb2KUl/SUDqdnKfVwakMuBc7Cqtx8sqnePA6FIzMKnVTJJ0p6SNkZ/5ijyyZxskzZd0SI41+Tq63O8bnHwmrzXmxUVBKgrOrJwWUVRyuhM6r+uYIgOi0B855bsVuuX22DXyfnuHu1XS9ZGX5512RZP7dNcQqeyzioBUZLSanliMVfCmMsc3QPmO1niMkfS0E3SHu/dGO5IyUuiSY5I6UgdvIB4haXkCkukzvQ0PJLWcB9lU/UjgKcKkzeY4NeBV4DRgFWE2292Gx6Q4FzmY8GrQFdNtLvUh4UX0ZcKLKcAowsvsFMJLrFyZbmAA8Cbh/W65qyslk2084d3tCDdnqgKbCa9Cr7bk0QJ9m+c855C3IfwNSeN7MU/jMUrSa84SvAWulPQ9Zwl515iYZ2ViAWZ5r8U6fJ2t3MT4KLvU7I+WKpsn9eDRrmvNTRSTpPWSjizQd62iPyQ8DOTblU0cK2qe8/i5kfEZEsuYch6kR3oByMt6lILDV8Jjbquu1gqcUxNhDKAi8wjjMduBI8fjfJcvb8TLG5ksz/mJPMZ7disFc0A608njG+20PB55rT5I0gs5pjinhOXsJ2mV42FCXKL2Tr0dX3O6s3P4rop1FrWkObGcdx0vRt2beOS1/JWudazwktiKlYICeB4G8D0FAC467VjoFDQrurJgA1aiLksc0C15pC2/v6TVrqAU5iLHFjBhD9xSp4AU3s0mqvXcpehlZSdEnr6OpS1kaeUCjnPAmK6rIwY7edgajd0vAMbQvMB1B2GJs4v2i0+23DAFmOqWIgDuA/7lhvhOqRF5rIw8fR2fiXV7WfKoHnk8S1gzMh7dUfcLmzBR80jxZtIqGySNK9Aq3iwvzOmi0wpYYNHLeJyc00UuKNiNTZdxykY103mFpKGWr0q2zns2YTLnlzUXAG+TLW0WoaNcq1SB9cALzgL6Ssbj+ci76mQ7uiAPRZ3ejjpaWh2YGLEAqPnZ4zlJ4a3A3SUUMyHHJ//fImzf+LS+kPHYRJjJ+7RxJeoxnRZEXb0RfNvyGECHASclDB4hTONrlANoSJK+Od6rBXgUJeO1KUkfWhKgGmHp95Hk2UnAoQYQhHeagQRHZWn3lhTaHOP2JH1gST5FyADYK0m3usvumJiu9q43MGKyE4xTXMVV4N+EBXYo7zc2Jv8PIhu9Ot0w9FQhcwOjk2cbSvIy3Z6IOnt/thOgEYStYE9LCNu7NYr7DVP+jeT/BILj82l9BQjCgDIhSVue/O+NbHXi3aizp2OA4VXCqDMuYby4A4UMyOfivUZmrl+Kaf3hh4zHyWRuwUbiZxNZilArnccBR1XJJnU2gfIVleleDVfWhl+jWa6OvpLxmJmAtp6scTqVG5onxMdUCQtTkKG+nsxUy7SEmesGwuKUF+AE4JtkvqNTsqH4G8BnEyAei3WXcQtex+VRd592dJUQguITVxL6ZIXO5y02+fJW9DPCHKm7Q5BsdXBs5GVkdSwozTHTuxJ1XplgMblKGGU8rc5RrijVY7kngYfIljEbhPecRYRtZAOpiI+zIIXuWPa3ESTjW411PUkWK1CWTNc1SfpBNop5WusE6wtdDbzngKgTutpiwgjU7ZSvka1R23pxzZXtJsQZLSZ0rboruwW4po+y+vgBTyOrhEVxn2lzIZatyWaorwOXxTSzrDphUFgKXA4MisqbNVjMkP3vjnkuJzjgqQkvYh2vUXzG345Md8NicBc9Z6Nb+1iJAVID7iHMgW50wDUIoXg/B35A6DKPR0At2mMYIVrkFGAGYchtJDy6gDnAQrLIsr7Sh8n/gbglCVsyuK7gkkGZpYnrIu+Gu9vygtH2uAi2Of725DcPjX7Uj0sopqvJuXMhrYvw/jLIobZPP7QE0LQY91NCd7mJzLH6IM8qYa9ruCvfSPLi/l8D3JzU0R9LKYOT/9urhKguyIa2kf1QkSlUJ6zy/Y7gtD1wkDnlBmFT0V8N9zwF/SrCiHg0WddK4xc7IRuwDIsPbHfR0+gkUxmykaVOCJn7JcG5nk3wO5A5XwPARqsByWWjWyUpA8HSZhDCgn9BiI20N4FORl/TNX353dRFGNoOc4ljnSJlwbHlgq8RgilHRcG9A7UhHcJ6zj8I28irgfdj+tAoxyGEiexIV6ae1HkB8FVC8OhDdBaTaLqOTdLXImlB4pjWKQQxFVmH9mu8tuNwS+KI05C4tyTdFtepRxTgPSLmvS2Wbcf7ZmW7H2VkJ+q8LsHibiRdlixaS9JUV1GRCmzr+AFXQV3Nm3uvSDpXPffBfZyiv2pJHmLZmZGXkjpMqfvVc+u6yFbS1GTUlKTLkPQF98AquSgZ/noDpybpwVh2u5qH8S2SrlAWVmdgtgrQzKvDALT8AyRdqhBWZwo1lE0PHnT8i+7GXJRgIEknmgnbNrFVcL+KzTEM/YVJeavkb5IOdbxaBWwWvTy4KEScPZPUaTL8OpGxt7naA0n5VZKGW6aHk4er1bsfMsbXJgLafaGzmr4C0woos6bftJDh2l4a2vsf21E2DB6Wsq3nSxxj8xlntWFuadOURUj4cJK7XOv1x0y3XeubhdzldPAyTSugx1mxrPdlsz1AhykLn7UMi1owNtQHS1rmGHcn5Sy2eVeBQ049i6IMPmpjWZQ1rzfUknKm+zZF1+D76ONJpq0RuLQfG9MbcqzueWWBUR8HOKkvHBJlSK3h+pzGtjKTlUXrW/4/WR7vxWc69C3jrWr29NYC45VFjxo42xQiJoo4913V3ZB0vLLeYLJtVM8YA9PpVgeO9YKZlscXyAte2KgsHtE7xp/kML0pqXh3XFb3zTmN/WOXxzf0JpdXSoIX2o1IVsDi9yzCa5iagyqlnLia3XRZ3QcoG5V80OiwRJe5Lo8B2bSMksd4TWKeO6LZWt4ZOUzn7AHWk1rRnJzGnuHyHa+eAVRrlETN5vXh7zvGVvApZXOa+9xzKTg4mwx+nI65N4d9qHo633vjs4FRJwPHnv8wwaJlEOeLOYVtJEgnVH/cg8BJQXo0kfXtmH5DjhG8JGnvBIuWYcCnO4D8x3E3KvvWwoC7IjHtPeEyWa7IsfY5URepOQw497OEPOaWYV7CPI2ZtvsJeYx382WynJDImsZGm27zW+mQ962G7ajuQ4h4sK0WW4iyEJFKXPA6nLDl25ed2P4mk+UAwm7JCCez6WA6vQCcSNjR6KFD3u6pxQhtJYTlvZuAg2PyDs2nIOxptBlYl8hsC/wW9nJOBMfHBrUFCMfgFeBbZEuSSu4b6HyvfVeTbVdbQJdy7ucAy2i36VjQ2Z0X+6r/tFEKi2HTXd49wQ/5D+qmS3o/8T82JzpfzTrmXmVGBPsk0y+jWsVz1P6TzI9raDdZawojrt9s9HL32yeZKUiz1PzloW+RZyRNUTaPyPuudFcB45dvpyhbZUw/6q2r4KeYZQHyDE9X9p1E3mfhcxU+0fZAFV1/Lnrl8R2tMDVp9Vn4ZmWfPPX7Z+EpSJOVrbu0O1hgolPI+4cy2zJWvtXBAhMVtpqs0fIOFng+ylwKnE4A8pOpQcomk1L+PtVWhdW6L6v3oynyrlaWNzTyXKTWR1MYzVP2HVjpQaQ/DjeZBtxO+GDWHyDS6nCTxYSAyTfIdlJ7o2GEyPfjCNGtJxFOrrJ6/OEmJturhBNpFtOHw03663icQYQzg64mbDcXOR5nPbCCEPa2jjBf+U98Ppiwtz+KsF9+MMWPx3mHEEVyJ+Gor91yPI4n3zojgYsILbc7DliaT4gJ2EyzlXdMu/KIrq8D5wGfI0RrePq/OqIrBSo9aG0S4ZC30wjh/QfSeYCoCJaylBC29z9zyFsroNJjAoeTf0zgSIIjti6zneyYwDWEEJmXIzDLaHbuu/SYwP8CjSxW15ZWKJgAAAAedEVYdGljYzpjb3B5cmlnaHQAR29vZ2xlIEluYy4gMjAxNqwLMzgAAAAUdEVYdGljYzpkZXNjcmlwdGlvbgBzUkdCupBzBwAAAABJRU5ErkJggg==',
  navAssets: 'data:image/png;base64,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',
  accountWallet: 'data:image/png;base64,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',
  accountSecurity: 'data:image/png;base64,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',
  accountAbout: 'data:image/png;base64,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',
  // Original receipt-and-dollar artwork, traced from its foreground alpha.
  // True transparent SVG background removes the faint square without changing
  // the design. Use the same 34px supplied-icon mask as the other account rows.
  accountStatement: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA3MiA3MiI+PHBhdGggZmlsbD0id2hpdGUiIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTUzLjI1MCwzMi44NzUgTDUyLjYyNSwzMy4xMjUgTDUyLjEyNSwzMy42MjUgTDUyLjAwMCwzNC4xMjUgTDUxLjUwMCwzNC44NzUgTDUwLjUwMCwzNS42MjUgTDQ5LjUwMCwzNi42MjUgTDQ5LjAwMCwzNy4zNzUgTDQ4LjUwMCwzOC44NzUgTDQ4LjUwMCw0MC41MDAgTDQ5LjEyNSw0Mi4zNzUgTDUwLjUwMCw0My44NzUgTDUxLjEyNSw0NC4xMjUgTDUxLjc1MCw0NC42MjUgTDUyLjI1MCw0NC43NTAgTDU0LjAwMCw0NS43NTAgTDU0LjI1MCw0NS43NTAgTDU0Ljg3NSw0Ni4zNzUgTDU0Ljg3NSw0Ni44NzUgTDU0LjI1MCw0Ny42MjUgTDU0LjAwMCw0Ny43NTAgTDUzLjM3NSw0Ny43NTAgTDUzLjI1MCw0Ny44NzUgTDUzLjAwMCw0Ny43NTAgTDUxLjI1MCw0Ny43NTAgTDUxLjEyNSw0Ny44NzUgTDUwLjYyNSw0Ny44NzUgTDQ5Ljc1MCw0OC41MDAgTDQ5LjI1MCw0OS4zNzUgTDQ5LjI1MCw1MC4yNTAgTDQ5Ljc1MCw1MS4wMDAgTDUwLjM3NSw1MS42MjUgTDUxLjUwMCw1Mi4wMDAgTDUxLjg3NSw1Mi41MDAgTDUzLjEyNSw1My42MjUgTDUzLjg3NSw1My43NTAgTDU0Ljc1MCw1My4zNzUgTDU1LjM3NSw1Mi43NTAgTDU2LjAwMCw1MS41MDAgTDU3LjM3NSw1MC41MDAgTDU4LjI1MCw0OS4zNzUgTDU4Ljg3NSw0OC4xMjUgTDU5LjAwMCw0Ni4yNTAgTDU4Ljg3NSw0Ni4xMjUgTDU4Ljg3NSw0NS41MDAgTDU4LjYyNSw0NC42MjUgTDU3Ljg3NSw0My41MDAgTDU3LjI1MCw0Mi44NzUgTDU2LjI1MCw0Mi4xMjUgTDU1Ljc1MCw0Mi4wMDAgTDU0Ljc1MCw0MS4zNzUgTDUzLjI1MCw0MC43NTAgTDUyLjc1MCw0MC4xMjUgTDUyLjYyNSwzOS41MDAgTDUzLjEyNSwzOC44NzUgTDUzLjM3NSwzOC43NTAgTDU2LjUwMCwzOC43NTAgTDU3LjI1MCwzOC4zNzUgTDU3Ljc1MCwzNy44NzUgTDU4LjEyNSwzNy4xMjUgTDU4LjAwMCwzNS44NzUgTDU3LjUwMCwzNS4xMjUgTDU2LjYyNSwzNC44NzUgTDU2LjI1MCwzNC42MjUgTDU1LjI1MCwzMy41MDAgTDU0LjM3NSwzMi44NzUgWiBNNTIuNjI1LDI5LjEyNSBMNTQuODc1LDI5LjEyNSBMNTUuMDAwLDI5LjI1MCBMNTYuMjUwLDI5LjM3NSBMNTYuMzc1LDI5LjUwMCBMNTkuMDAwLDMwLjEyNSBMNTkuNTAwLDMwLjUwMCBMNjAuNzUwLDMxLjAwMCBMNjEuNTAwLDMxLjYyNSBMNjIuMjUwLDMyLjAwMCBMNjMuMjUwLDMyLjg3NSBMNjQuODc1LDM0LjYyNSBMNjUuMzc1LDM1LjUwMCBMNjUuNzUwLDM1Ljg3NSBMNjYuMzc1LDM3LjI1MCBMNjYuNzUwLDM3Ljc1MCBMNjcuMTI1LDM4Ljg3NSBMNjcuMTI1LDM5LjI1MCBMNjcuMzc1LDM5Ljc1MCBMNjcuMzc1LDQwLjI1MCBMNjcuNjI1LDQwLjc1MCBMNjcuNzUwLDQyLjUwMCBMNjcuODc1LDQyLjYyNSBMNjcuNzUwLDQ1LjEyNSBMNjcuNjI1LDQ1LjI1MCBMNjcuNTAwLDQ2LjI1MCBMNjcuMjUwLDQ2Ljc1MCBMNjYuODc1LDQ4LjM3NSBMNjYuMTI1LDQ5LjYyNSBMNjUuODc1LDUwLjM3NSBMNjQuNjI1LDUyLjEyNSBMNjIuNzUwLDU0LjAwMCBMNjEuMjUwLDU1LjEyNSBMNjAuNjI1LDU1LjM3NSBMNjAuMjUwLDU1Ljc1MCBMNTguNzUwLDU2LjI1MCBMNTcuODc1LDU2Ljc1MCBMNTcuNTAwLDU2Ljc1MCBMNTYuODc1LDU3LjAwMCBMNTYuMTI1LDU3LjAwMCBMNTYuMDAwLDU3LjEyNSBMNTUuMTI1LDU3LjEyNSBMNTUuMDAwLDU3LjI1MCBMNTIuNTAwLDU3LjI1MCBMNTIuMzc1LDU3LjEyNSBMNTEuNTAwLDU3LjEyNSBMNTEuMzc1LDU3LjAwMCBMNTAuMDAwLDU2Ljg3NSBMNDcuMjUwLDU1Ljc1MCBMNDYuNjI1LDU1LjI1MCBMNDUuNjI1LDU0Ljc1MCBMNDUuMDAwLDU0LjEyNSBMNDQuNTAwLDUzLjg3NSBMNDMuMjUwLDUyLjYyNSBMNDIuNzUwLDUxLjg3NSBMNDIuMTI1LDUxLjI1MCBMNDEuODc1LDUwLjYyNSBMNDEuMDAwLDQ5LjM3NSBMNDAuNTAwLDQ3Ljc1MCBMNDAuMTI1LDQ3LjEyNSBMNDAuMDAwLDQ2LjEyNSBMMzkuODc1LDQ2LjAwMCBMMzkuODc1LDQ1LjEyNSBMMzkuNzUwLDQ1LjAwMCBMMzkuNzUwLDQxLjUwMCBMMzkuODc1LDQxLjM3NSBMNDAuMDAwLDM5Ljc1MCBMNDEuMjUwLDM2LjYyNSBMNDEuNjI1LDM2LjI1MCBMNDEuODc1LDM1LjYyNSBMNDMuMDAwLDM0LjEyNSBMNDQuMzc1LDMyLjc1MCBMNDYuNTAwLDMxLjEyNSBMNDguNzUwLDMwLjAwMCBMNDkuMTI1LDMwLjAwMCBMNDkuNjI1LDI5Ljc1MCBMNTAuMTI1LDI5Ljc1MCBMNTAuNjI1LDI5LjUwMCBMNTEuMTI1LDI5LjUwMCBMNTEuNzUwLDI5LjI1MCBMNTIuNTAwLDI5LjI1MCBaIE0xOS4zNzUsMjcuMTI1IEwxOS4zNzUsMjcuNjI1IEwxOS43NTAsMjguNTAwIEwyMC4zNzUsMjkuMTI1IEwyMS4yNTAsMjkuNTAwIEwzOC42MjUsMjkuNTAwIEwzOS4zNzUsMjkuMjUwIEw0MC4zNzUsMjguMjUwIEw0MC41MDAsMjcuODc1IEw0MC41MDAsMjcuMDAwIEw0MC4wMDAsMjYuMTI1IEwzOS4yNTAsMjUuNTAwIEwzOC4zNzUsMjUuMjUwIEwzNy43NTAsMjUuMjUwIEwzNy42MjUsMjUuMzc1IEwyMi4yNTAsMjUuMzc1IEwyMi4xMjUsMjUuMjUwIEwyMS41MDAsMjUuMjUwIEwyMC41MDAsMjUuNjI1IEwxOS42MjUsMjYuNTAwIFogTTQ0Ljg3NSwxOC41MDAgTDQ1LjAwMCwxOS43NTAgTDQ1Ljg3NSwyMC43NTAgTDQ2LjUwMCwyMS4wMDAgTDUwLjAwMCwyMS4wMDAgTDUwLjYyNSwyMC43NTAgTDUxLjYyNSwxOS41MDAgTDUxLjYyNSwxOC41MDAgTDUxLjM3NSwxOC4wMDAgTDUwLjUwMCwxNy4xMjUgTDUwLjI1MCwxNy4wMDAgTDQ5LjYyNSwxNy4wMDAgTDQ5LjUwMCwxNi44NzUgTDQ4LjYyNSwxNi44NzUgTDQ4LjUwMCwxNy4wMDAgTDQ4LjEyNSwxNy4wMDAgTDQ4LjAwMCwxNi44NzUgTDQ2Ljc1MCwxNi44NzUgTDQ2LjYyNSwxNy4wMDAgTDQ2LjI1MCwxNy4wMDAgTDQ1LjM3NSwxNy42MjUgWiBNMTkuMzc1LDE4LjYyNSBMMTkuMzc1LDE5LjI1MCBMMTkuODc1LDIwLjI1MCBMMjAuMzc1LDIwLjc1MCBMMjEuMTI1LDIxLjAwMCBMMzguNzUwLDIxLjAwMCBMMzkuNTAwLDIwLjc1MCBMNDAuMTI1LDIwLjEyNSBMNDAuNTAwLDE5LjUwMCBMNDAuNTAwLDE4LjUwMCBMMzkuODc1LDE3LjUwMCBMMzkuMTI1LDE3LjAwMCBMMzguNTAwLDE3LjAwMCBMMzguMzc1LDE2Ljg3NSBMMzcuNjI1LDE2Ljg3NSBMMzcuNTAwLDE3LjAwMCBMMjIuMzc1LDE3LjAwMCBMMjIuMjUwLDE2Ljg3NSBMMjEuNTAwLDE2Ljg3NSBMMjEuMzc1LDE3LjAwMCBMMjAuNzUwLDE3LjAwMCBMMjAuNTAwLDE3LjEyNSBMMTkuODc1LDE3Ljc1MCBaIE00NC44NzUsMTAuMjUwIEw0NC44NzUsMTAuODc1IEw0NS4yNTAsMTEuNzUwIEw0Ni41MDAsMTIuNjI1IEw0OS44NzUsMTIuNjI1IEw1MC41MDAsMTIuMzc1IEw1MS4zNzUsMTEuNTAwIEw1MS42MjUsMTEuMDAwIEw1MS42MjUsMTAuMTI1IEw1MS4yNTAsOS4zNzUgTDUwLjUwMCw4Ljc1MCBMNDkuODc1LDguNTAwIEw0Ni41MDAsOC41MDAgTDQ1LjYyNSw5LjAwMCBMNDUuMTI1LDkuNTAwIFogTTE5LjM3NSwxMC4yNTAgTDE5LjM3NSwxMC43NTAgTDE5Ljg3NSwxMS43NTAgTDIwLjM3NSwxMi4yNTAgTDIxLjI1MCwxMi42MjUgTDM4Ljc1MCwxMi42MjUgTDM5LjM3NSwxMi4zNzUgTDQwLjI1MCwxMS41MDAgTDQwLjUwMCwxMS4wMDAgTDQwLjUwMCwxMC4xMjUgTDQwLjEyNSw5LjM3NSBMMzkuNjI1LDguODc1IEwzOC4xMjUsOC4zNzUgTDM4LjAwMCw4LjUwMCBMMjIuMDAwLDguNTAwIEwyMS43NTAsOC4zNzUgTDIxLjYyNSw4LjUwMCBMMjAuNzUwLDguNjI1IEwyMC4xMjUsOS4wMDAgTDE5LjYyNSw5LjYyNSBaIE02Ljg3NSw0LjEyNSBMOC4yNTAsNC4xMjUgTDkuNjI1LDQuODc1IEwxMC4yNTAsNS41MDAgTDEwLjc1MCw2LjI1MCBMMTEuMDAwLDcuMDAwIEwxMS4wMDAsMjEuMzc1IEwxMC44NzUsMjEuNjI1IEwxMC4zNzUsMjIuMDAwIEw0Ljc1MCwyMi4wMDAgTDQuNTAwLDIxLjg3NSBMNC4wMDAsMjEuMjUwIEw0LjAwMCw3LjM3NSBMNC4xMjUsNy4yNTAgTDQuMTI1LDYuNjI1IEw0Ljc1MCw1LjYyNSBMNS42MjUsNC43NTAgWiBNMTUuMDAwLDQuMTI1IEwxNS4zNzUsNC4wMDAgTDE2LjAwMCw0LjAwMCBMMTYuMTI1LDQuMTI1IEw1My4yNTAsNC4xMjUgTDU0LjYyNSw0Ljg3NSBMNTUuNzUwLDYuMjUwIEw1Ni4wMDAsNy4wMDAgTDU2LjAwMCwyNC41MDAgTDU1LjYyNSwyNS4wMDAgTDU1LjM3NSwyNS4xMjUgTDUxLjUwMCwyNS4xMjUgTDUxLjM3NSwyNS4yNTAgTDUwLjYyNSwyNS4yNTAgTDUwLjEyNSwyNS41MDAgTDQ5LjYyNSwyNS41MDAgTDQ5LjI1MCwyNS43NTAgTDQ3Ljc1MCwyNi4wMDAgTDQ2LjM3NSwyNi42MjUgTDQ2LjEyNSwyNi44NzUgTDQ1LjUwMCwyNy4wMDAgTDQ0LjYyNSwyNy41MDAgTDQ0LjI1MCwyNy44NzUgTDQzLjc1MCwyOC4wMDAgTDQyLjI1MCwyOS4xMjUgTDQwLjUwMCwzMC43NTAgTDM5LjEyNSwzMi4zNzUgTDM4LjYyNSwzMy4yNTAgTDM3LjYyNSwzMy44NzUgTDIxLjg3NSwzMy44NzUgTDIxLjc1MCwzMy43NTAgTDIxLjYyNSwzMy44NzUgTDIwLjUwMCwzNC4wMDAgTDE5Ljc1MCwzNC43NTAgTDE5LjM3NSwzNS41MDAgTDE5LjUwMCwzNi41MDAgTDIwLjAwMCwzNy4yNTAgTDIwLjM3NSwzNy42MjUgTDIxLjAwMCwzNy44NzUgTDM1LjYyNSwzNy44NzUgTDM2LjEyNSwzOC4zNzUgTDM2LjEyNSwzOS4xMjUgTDM2LjAwMCwzOS4yNTAgTDM1Ljg3NSw0MC41MDAgTDM1Ljc1MCw0MC42MjUgTDM1Ljc1MCw0MS41MDAgTDM1LjEyNSw0Mi4xMjUgTDM0Ljc1MCw0Mi4xMjUgTDM0LjYyNSw0Mi4yNTAgTDMzLjM3NSw0Mi4yNTAgTDMzLjI1MCw0Mi4xMjUgTDMzLjAwMCw0Mi4yNTAgTDIyLjI1MCw0Mi4yNTAgTDIyLjEyNSw0Mi4xMjUgTDIxLjUwMCw0Mi4xMjUgTDIwLjYyNSw0Mi4zNzUgTDE5LjYyNSw0My4zNzUgTDE5LjM3NSw0NC4wMDAgTDE5LjM3NSw0NC41MDAgTDE5Ljc1MCw0NS4zNzUgTDIwLjM3NSw0Ni4wMDAgTDIxLjUwMCw0Ni4zNzUgTDMzLjc1MCw0Ni4zNzUgTDMzLjg3NSw0Ni4yNTAgTDM1LjAwMCw0Ni4yNTAgTDM1LjM3NSw0Ni4zNzUgTDM1Ljg3NSw0Ni44NzUgTDM2LjEyNSw0Ny4zNzUgTDM2LjI1MCw0OC4zNzUgTDM2Ljg3NSw0OS42MjUgTDM2Ljg3NSw1MC4yNTAgTDM2Ljc1MCw1MC41MDAgTDM2LjM3NSw1MC43NTAgTDIyLjAwMCw1MC43NTAgTDIxLjg3NSw1MC42MjUgTDIxLjAwMCw1MC43NTAgTDIwLjM3NSw1MS4wMDAgTDE5Ljc1MCw1MS42MjUgTDE5LjM3NSw1Mi41MDAgTDE5LjUwMCw1My4zNzUgTDIwLjI1MCw1NC4zNzUgTDIwLjg3NSw1NC43NTAgTDIxLjUwMCw1NC43NTAgTDIxLjYyNSw1NC44NzUgTDIyLjAwMCw1NC44NzUgTDIyLjEyNSw1NC43NTAgTDM5LjAwMCw1NC43NTAgTDM5LjEyNSw1NC42MjUgTDM5LjYyNSw1NC43NTAgTDQyLjc1MCw1Ny43NTAgTDQzLjEyNSw1Ny44NzUgTDQ0LjAwMCw1OC42MjUgTDQ1LjEyNSw1OS4xMjUgTDQ2LjAwMCw1OS43NTAgTDQ3LjM3NSw2MC4xMjUgTDQ3LjYyNSw2MC4zNzUgTDQ4LjI1MCw2MC41MDAgTDQ4LjYyNSw2MC43NTAgTDUwLjUwMCw2MS4wMDAgTDUwLjYyNSw2MS4xMjUgTDUyLjM3NSw2MS4yNTAgTDUyLjUwMCw2MS4zNzUgTDU0LjYyNSw2MS4zNzUgTDU0Ljc1MCw2MS4yNTAgTDU1LjM3NSw2MS4yNTAgTDU1Ljg3NSw2MS43NTAgTDU2LjAwMCw2Mi4xMjUgTDU2LjAwMCw2Ni4xMjUgTDU1LjYyNSw2Ni42MjUgTDU1LjI1MCw2Ni43NTAgTDU0LjM3NSw2Ni4yNTAgTDUzLjI1MCw2NS44NzUgTDUyLjEyNSw2NS43NTAgTDUyLjAwMCw2NS44NzUgTDUxLjUwMCw2NS44NzUgTDUxLjAwMCw2Ni4xMjUgTDUwLjYyNSw2Ni4xMjUgTDQ5LjI1MCw2Ni44NzUgTDQ4Ljg3NSw2Ni44NzUgTDQ3Ljc1MCw2Ny4yNTAgTDQ3LjEyNSw2Ny42MjUgTDQ2LjM3NSw2Ny42MjUgTDQ1LjUwMCw2Ny4xMjUgTDQzLjc1MCw2Ni42MjUgTDQzLjI1MCw2Ni4yNTAgTDQxLjUwMCw2NS43NTAgTDQwLjc1MCw2NS43NTAgTDQwLjYyNSw2NS44NzUgTDM5Ljc1MCw2Ni4wMDAgTDM4LjAwMCw2Ni44NzUgTDM3LjYyNSw2Ni44NzUgTDM2LjUwMCw2Ny4yNTAgTDM1Ljg3NSw2Ny42MjUgTDM1LjEyNSw2Ny42MjUgTDM0LjI1MCw2Ny4xMjUgTDMyLjc1MCw2Ni43NTAgTDMyLjI1MCw2Ni4zNzUgTDMxLjYyNSw2Ni4yNTAgTDMxLjI1MCw2Ni4wMDAgTDMwLjg3NSw2Ni4wMDAgTDMwLjI1MCw2NS43NTAgTDI5LjUwMCw2NS43NTAgTDI3Ljg3NSw2Ni4yNTAgTDI3LjAwMCw2Ni43NTAgTDI1Ljg3NSw2Ny4xMjUgTDI1LjUwMCw2Ny4xMjUgTDI0LjYyNSw2Ny42MjUgTDI0LjAwMCw2Ny42MjUgTDIzLjAwMCw2Ny4xMjUgTDIxLjUwMCw2Ni43NTAgTDIxLjI1MCw2Ni41MDAgTDIwLjM3NSw2Ni4xMjUgTDE5LjEyNSw2NS44NzUgTDE5LjAwMCw2NS43NTAgTDE3Ljc1MCw2NS44NzUgTDE2LjEyNSw2Ni42MjUgTDE1LjM3NSw2Ni42MjUgTDE1LjAwMCw2Ni4xMjUgTDE1LjAwMCw2LjM3NSBMMTQuNjI1LDUuMTI1IEwxNC42MjUsNC41MDAgWiBNMy41MDAsMS4xMjUgTDEuNzUwLDIuNzUwIEwxLjAwMCwzLjc1MCBMMS4wMDAsNC4wMDAgTDAuMzc1LDUuMDAwIEwwLjAwMCw1LjAwMCBMMC4wMDAsMjUuMjUwIEwwLjM3NSwyNS4yNTAgTDEuNTAwLDI2LjAwMCBMMTAuMjUwLDI2LjAwMCBMMTAuNTAwLDI2LjEyNSBMMTEuMDAwLDI2Ljc1MCBMMTEuMDAwLDcwLjM3NSBMMTEuNjI1LDcxLjI1MCBMMTEuNzUwLDcxLjg3NSBMMTQuNzUwLDcxLjg3NSBMMTQuNzUwLDcxLjYyNSBMMTUuNTAwLDcxLjAwMCBMMTcuMTI1LDcwLjYyNSBMMTguMjUwLDcwLjAwMCBMMTkuMDAwLDcwLjAwMCBMMjAuNTAwLDcwLjc1MCBMMjEuNzUwLDcxLjAwMCBMMjIuNTAwLDcxLjUwMCBMMjIuNTAwLDcxLjg3NSBMMjYuMTI1LDcxLjg3NSBMMjYuMTI1LDcxLjUwMCBMMjYuNTAwLDcxLjEyNSBMMjguMzc1LDcwLjYyNSBMMjguNjI1LDcwLjM3NSBMMjkuNTAwLDcwLjAwMCBMMzAuMjUwLDcwLjAwMCBMMzEuNzUwLDcwLjc1MCBMMzMuMDAwLDcxLjAwMCBMMzMuNzUwLDcxLjYyNSBMMzMuNzUwLDcxLjg3NSBMMzcuMjUwLDcxLjg3NSBMMzcuMzc1LDcxLjUwMCBMMzcuNzUwLDcxLjEyNSBMMzkuMjUwLDcwLjc1MCBMNDAuNzUwLDcwLjAwMCBMNDEuNTAwLDcwLjAwMCBMNDMuMDAwLDcwLjc1MCBMNDQuMjUwLDcxLjAwMCBMNDUuMDAwLDcxLjYyNSBMNDUuMDAwLDcxLjg3NSBMNDguNTAwLDcxLjg3NSBMNDguNTAwLDcxLjYyNSBMNDkuMDAwLDcxLjEyNSBMNDkuMjUwLDcxLjEyNSBMNDkuNjI1LDcwLjg3NSBMNTAuNTAwLDcwLjc1MCBMNTIuMDAwLDcwLjAwMCBMNTIuNzUwLDcwLjAwMCBMNTQuNjI1LDcwLjg3NSBMNTUuNTAwLDcxLjAwMCBMNTYuMjUwLDcxLjUwMCBMNTYuMjUwLDcxLjg3NSBMNTkuMjUwLDcxLjg3NSBMNTkuMjUwLDcxLjYyNSBMNjAuMDAwLDcwLjM3NSBMNjAuMDAwLDYwLjg3NSBMNjAuMTI1LDYwLjUwMCBMNjAuNjI1LDYwLjAwMCBMNjEuMTI1LDU5Ljg3NSBMNjIuMTI1LDU5LjM3NSBMNjIuNTAwLDU5LjAwMCBMNjMuMjUwLDU4Ljc1MCBMNjUuODc1LDU2Ljc1MCBMNjcuODc1LDU0LjYyNSBMNjguNzUwLDUzLjUwMCBMNjkuMjUwLDUyLjUwMCBMNjkuNjI1LDUyLjEyNSBMNzAuMTI1LDUwLjc1MCBMNzAuNjI1LDUwLjAwMCBMNzEuMTI1LDQ4LjAwMCBMNzEuNTAwLDQ3LjM3NSBMNzEuODc1LDQ3LjM3NSBMNzEuODc1LDM5LjEyNSBMNzEuNjI1LDM5LjEyNSBMNzEuMzc1LDM4Ljg3NSBMNzEuMDAwLDM4LjEyNSBMNzEuMDAwLDM3LjYyNSBMNzAuNzUwLDM3LjEyNSBMNzAuNzUwLDM2Ljc1MCBMNjkuODc1LDM1LjEyNSBMNjkuODc1LDM0Ljg3NSBMNjguNTAwLDMyLjYyNSBMNjcuODc1LDMyLjAwMCBMNjcuNzUwLDMxLjYyNSBMNjUuMjUwLDI5LjEyNSBMNjQuODc1LDI5LjAwMCBMNjQuMjUwLDI4LjM3NSBMNjIuODc1LDI3LjYyNSBMNjIuNTAwLDI3LjI1MCBMNjAuNzUwLDI2LjUwMCBMNjAuMDAwLDI1LjYyNSBMNjAuMDAwLDYuMzc1IEw1OS44NzUsNi4yNTAgTDU5Ljg3NSw1LjYyNSBMNTkuNjI1LDQuODc1IEw1OC42MjUsMy4xMjUgTDU4LjEyNSwyLjUwMCBMNTYuNTAwLDEuMTI1IEw1NS41MDAsMC43NTAgTDU1LjEyNSwwLjM3NSBMNTUuMTI1LDAuMDAwIEw1LjAwMCwwLjAwMCBMNS4wMDAsMC4yNTAgTDQuNTAwLDAuNzUwIFoiLz48L3N2Zz4=',
};
// The supplied About image has a solid raster backdrop baked into it.  This
// is the same information-mark silhouette extracted to transparent pixels,
// so it stays crisp at every size and cannot paint a square behind the icon.
var CLEAN_ACCOUNT_ABOUT_ICON = 'data:image/png;base64,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';
// The supplied cart had a light raster background. This is the same cart
// silhouette thresholded and trimmed to transparent pixels, so it tints and
// scales exactly like the other bottom-navigation icons.
var CLEAN_NAV_CART_ICON = 'data:image/png;base64,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';
function suppliedMemberIcon(name){
  const src = name === 'navAssets' ? CLEAN_NAV_CART_ICON
    : name === 'accountAbout' ? CLEAN_ACCOUNT_ABOUT_ICON
    : SUPPLIED_MEMBER_ICON_ASSETS[name];
  return src ? `<span class="supplied-icon" style="--supplied-icon:url('${src}')"></span>` : '';
}

// Owner: "make when l can change figure/digit fonts in admin panel" -- the
// `.mono` class (every UGX figure/numeric stat) reads its font-family from
// the `--number-font` CSS custom property (see index.html), set from
// STATE.settings.numberFont by applyNumberFont() below. Keep this key set in
// sync with NUMBER_FONT_OPTIONS in server.js and the admin <select> options
// -- a value outside this map falls back to Bodoni Moda's stack rather than
// rendering with no font-family at all.
// Snow's beer-bottle illustration (ICONS.box) came across with the fork and
// was still the artwork on Petro's empty My Products screen -- a different
// company's product, in a different brand's style. Replaced with a neutral
// outline box in the app's own ink colour.
var EMPTY_ICON = '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><path d="M2 8h20l-1.5-3.2A1.5 1.5 0 0 0 19.1 4H4.9a1.5 1.5 0 0 0-1.4.8Z"/><path d="M10 12h4"/></svg>';
var NUMBER_FONT_STACKS = {
  'Bodoni Moda': "'Bodoni Moda',Didot,'Playfair Display',Georgia,serif",
  'Playfair Display': "'Playfair Display',Didot,Georgia,serif",
  'DM Serif Display': "'DM Serif Display',Georgia,serif",
  'Georgia': "Georgia,'Times New Roman',serif",
  'Roboto Mono': "'Roboto Mono',ui-monospace,'SFMono-Regular',monospace",
  'JetBrains Mono': "'JetBrains Mono',ui-monospace,'SFMono-Regular',monospace",
  'Orbitron': "'Orbitron',ui-sans-serif,sans-serif",
  'System default': "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
};
// ── THE APP'S NAME ──
// Owner: "l would like to also to edit the app name petro, so make it when it
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
// make petro to be default name" -- a hardcoded default is exactly what made
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
// Was `|| 'Petro'` -- a real bug, not a design choice: with no
// admin-set brandName yet (a fresh Petro deploy, before the owner has
// opened Admin -> Settings), every sentence-form use of the brand name
// literally rendered the word "Petro". Petro is this app's own real name,
// not an inherited-fork placeholder, so it is the correct fallback here --
// unlike the wordmark below, which stays blank on purpose.
function brandName(){
  return brandNameKnown() || 'Petro';
}
var BRAND_CACHE_KEY = 'petro_brand_name';
// The wordmark: just the name, in caps. Used to split off the LAST letter
// into an accent colour ("CHIP+Z") -- a pun specific to Petro's own name
// that means nothing for any other brand, dropped per the owner's "don't
// use anything that was Petro" instruction rather than carried over as a
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
// along with the rest of its Petro-derived design) and the browser/tab
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
  // loader it was still saying petro": the loading screen paints long before
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
// The name as plain text inside the round profile badge on Account. On
// `window` because two inline onerror="" attributes call it -- see
// renderAccount(). Font size divides by the name's length for the same reason
// petroMarkHtml()'s does: the badge is a fixed 68px circle with overflow
// hidden, so a longer name at 19px would simply have its ends cut off.
// Uses brandName(), not brandNameKnown(): this is the fallback shown when the
// profile image itself failed to load, so an empty badge would be a hole in
// the card rather than a graceful blank.
// `box` is the diameter of the badge this is going into, and it defaults to
// 68 -- the Account profile card's circle, the only caller there used to be --
// so every existing call site is unchanged to the pixel. The team member
// avatars are 44px, and the sizing constants below were all tuned for 68:
// dropping the 19px wordmark into a 44px circle overflowed it.
window.brandTextMark = function(box){
  const name = brandName().toUpperCase();
  const k = (Number(box) || 68) / 68;
  const fs = Math.round(Math.min(19 * k, Math.max(9 * k, 95 * k / Math.max(1, name.length))));
  return `<span style="font-size:${Math.max(7, fs)}px;">${esc(name)}</span>`;
};
// The compact brand mark, used where a small logo is needed and no
// admin-uploaded image is set (the two manual-deposit screens, the Download
// screen). A skewed wordmark on the brand gradient.
//
// The font size divides by the NAME'S OWN length rather than the constant 3.4
// that suited five letters: at a fixed size a longer name simply ran out past
// the rounded square it sits in.
function petroMarkHtml(size){
  const px = Number(size) || 44;
  const name = brandName().toUpperCase();
  const fs = Math.max(7, Math.round(px / (0.68 * Math.max(3, name.length))));
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${px}px;height:${px}px;border-radius:${Math.round(px/4)}px;background:var(--petro-grad);color:#fff;font-weight:800;font-size:${fs}px;letter-spacing:.02em;">${esc(name)}</span>`;
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
function togglePw(id, btn){
  const el = $(id);
  const showing = el.type === 'password';
  el.type = showing ? 'text' : 'password';
  if (btn) {
    btn.innerHTML = showing ? ICONS.eyeOff : ICONS.eye;
    btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
  }
}

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
try { window._suppressAutofillLogin = sessionStorage.getItem('petro_relogin_required') === '1'; } catch (_) {}
var _memberSession = window.createPetroIdleSession('petro_member_session', function(){
  window._triedAutoSignIn = true;
  document.querySelectorAll('.sheet-bg.show,.modal-bg.show,.pay-page.show,#msgDetailBg.show').forEach(el => el.classList.remove('show'));
  unlockBodyScroll();
  $('loadingScreen').style.display = 'none';
  $('app').style.display = 'none';
  $('authScreen').style.display = '';
  // {auto:true} -- see doLogout()'s own comment on why an idle timeout must
  // NOT permanently disable Chrome's autofill-then-submit convenience the
  // way a deliberate "Log Out" tap does.
  window.doLogout({ auto: true }).catch(() => {});
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
  const timeout = setTimeout(abort, 45000);
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
    if (resp.status === 401 && !isPublicCall && STATE.authEpoch === startEpoch && STATE.user) _memberSession.expire();
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
  return (bare ? local : dial() + local) + '@petro-platform.com';
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
  const list = [loginAddressFor(phone, true), loginAddressFor(phone, false)];
  return list.filter((e, i) => list.indexOf(e) === i);
}
function cleanPhone(raw){
  const local = localDigits(raw);
  if (!local) return null;
  const pfx = regionPrefixes();
  if (pfx.length && !pfx.some(p => local.startsWith(p))) return null;
  return dialPlus() + local;
}
// Owner: manual-pay's own network-selector screen deliberately assigns the
// OPPOSITE network's admin account to whichever tile the member taps (see
// manualPayConfirm()'s own comment), so "does this number match the network
// I picked" is no longer a meaningful check. This is a plain "is this a
// real Uganda mobile number at all" sanity check instead -- kept
// deliberately PERMISSIVE, not a strict MTN-vs-Airtel list, per the owner's
// own explicit "no need to put rules": Uganda's prefix assignments keep
// shifting (new blocks granted to operators, Mobile Number Portability
// approved 2025) and even the owner's own reference table needed a live
// correction mid-conversation (073, historically Africell's block --
// Africell exited Uganda in 2021 and where those numbers landed since is
// unconfirmed) -- so this only screens out something that clearly ISN'T a
// mobile number (a landline, a toll-free number, garbled digits), never a
// specific network match.
// Uganda's own two-digit mobile blocks, still used as the sanity check on
// the founding region. Other regions are screened on the prefix list the
// admin gave them (REGION.prefixes) instead -- there is no way to know
// another country's operator blocks from here, and a wrong hardcoded list
// would refuse real numbers.
var UGANDA_MOBILE_PREFIXES = ['70', '73', '74', '75', '76', '77', '78', '79'];
function isValidUgandaMobileNumber(raw){
  const d = localDigits(raw);
  if (!d) return false;
  if (REGION && REGION.isDefault !== false && dial() === '256')
    return d[0] === '7' && UGANDA_MOBILE_PREFIXES.indexOf(d.slice(0, 2)) !== -1;
  const pfx = regionPrefixes();
  return !pfx.length || pfx.some(p => d.startsWith(p));
}
function showAuthTab(tab){
  $('loginPane').style.display = tab === 'login' ? '' : 'none';
  $('registerPane').style.display = tab === 'register' ? '' : 'none';
  $('forgotPane').style.display = tab === 'forgot' ? '' : 'none';
  // Clears any OTP already sent/verified for whichever pane is being
  // switched INTO -- a member who backs out of Sign Up partway through and
  // later taps it again should not have doRegister() silently reuse a
  // stale ticket from a previous attempt.
  if (tab === 'register') window._regOtp = { otpId: null, ticket: null, phone: '' };
  if (tab === 'forgot') window._forgotOtp = { otpId: null, ticket: null, phone: '' };
}
// ── OTP RESEND COOLDOWN ──
// Shared by every OTP step (registration, forgot-password, add-wallet) so
// "Resend code" cannot be mashed into a second/third paid SMS the instant
// the first one goes out. Purely a client-side courtesy -- the real limit is
// the server's per-day cap (see otpDailyLimit() in server.js); this just
// keeps an impatient double-tap from wasting one of that limited daily count
// on nothing.
var _otpCooldownActive = {};
function startOtpResendCooldown(linkId, seconds, idleLabel){
  const el = $(linkId);
  if (!el) return;
  const label = idleLabel || 'Send Code';
  _otpCooldownActive[linkId] = true;
  el.style.pointerEvents = 'none';
  el.style.opacity = '.55';
  let remaining = seconds;
  const tick = () => {
    if (!el.isConnected) { delete _otpCooldownActive[linkId]; return; } // sheet/pane torn down mid-countdown
    if (remaining <= 0) {
      _otpCooldownActive[linkId] = false;
      el.textContent = label;
      el.style.pointerEvents = '';
      el.style.opacity = '';
      return;
    }
    el.textContent = `${label} (${remaining}s)`;
    remaining--;
    setTimeout(tick, 1000);
  };
  tick();
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
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again shortly.';
  return e && e.message ? e.message : 'Something went wrong. Try again.';
}
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
async function storeCredentialIfPossible(email, pass){
  if (!credManSupported()) return;
  try { await navigator.credentials.store(new PasswordCredential({ id: email, password: pass })); } catch (_) {}
}
// Returns true if a stored credential was found AND a sign-in attempt was
// kicked off (the resulting snow-auth event -- success or failure -- drives
// the UI from there); false means "nothing to do, show the normal auth
// screen". mediation:'silent' never shows any browser UI -- it resolves to
// null immediately if there's more than one saved credential or the user
// previously signed out (see doLogout's preventSilentAccess() below).
async function tryAutoSignIn(){
  if (!credManSupported()) return false;
  try {
    const cred = await navigator.credentials.get({ password: true, mediation: 'silent' });
    if (!cred || cred.type !== 'password' || !cred.password) return false;
    await window.fbSignIn(cred.id, cred.password);
    return true;
  } catch (_) { return false; }
}
window.doLogin = async function(){
  const phone = cleanPhone($('loginPhone').value);
  const pass = $('loginPassword').value;
  if (!phone) return notify('Enter a valid ' + regionName() + ' mobile number.');
  if (!pass) return notify('Enter your password.');
  setBtnLoading('loginBtn', true, 'Log In', 'Logging in…');
  window._pendingLoginSuccess = true;
  try {
    // Tries this region's address, then the other shape for the same region
    // -- see loginAddressCandidates(). The LAST error is the one reported, so
    // a genuinely wrong password still reads as a wrong password.
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
    // "Remember me" (Main.dc.html) gates the saved-credential store that
    // drives tryAutoSignIn() on the next visit. Unchecked -> nothing is
    // saved, so the login screen asks again next time.
    const remember = $('rememberMe');
    if (!remember || remember.checked) storeCredentialIfPossible(email, pass);
  }
  catch (e) {
    window._pendingLoginSuccess = false;
    notify(fbErrMsg(e));
    setBtnLoading('loginBtn', false, 'Log In');
  }
};
// ── SIGN UP: phone -> OTP -> password -> confirm password ──
// Rebuilt to the owner's exact mockup: ONE screen -- phone, verification
// code (with an inline Send Code button), password, confirm password,
// invitation code -- not the earlier 3-step wizard. Send Code just fills
// otpId; the actual OTP verify happens inside doRegister() itself, right
// before Firebase account creation, so the whole flow is still exactly two
// taps (Send Code, then Register) with no separate "step" screens to
// navigate through.
window._regOtp = { otpId: null, ticket: null, phone: '' };
// Owner: "l nolonger need such notifies of in page... all notifies in
// middle not bottom" -- was an inline pink box written into #regError,
// sitting inside the form itself. Routed through the same app-wide
// notify() toast every other screen already uses, instead of a second,
// auth-screen-only error pattern. Kept as its own function (rather than
// replacing every call site with notify() directly) purely so nothing
// else about doRegSendOtp()/doRegister() has to change.
function regError(msg){ if (msg) notify(msg); }
window.doRegSendOtp = async function(){
  const phone = cleanPhone($('regPhone').value);
  if (!phone) return regError('Enter a valid ' + regionName() + ' mobile number.');
  regError('');
  setBtnLoading('regSendOtpBtn', true, 'Send Code', 'Sending…');
  const d = await post('/auth/otp/send', { purpose: 'register', phone });
  setBtnLoading('regSendOtpBtn', false, 'Send Code');
  if (d.status !== 'success') return regError(d.message || 'Could not send the code');
  window._regOtp = { otpId: d.otpId, ticket: null, phone };
  const otpInput = $('regOtp'); if (otpInput) otpInput.value = '';
  startOtpResendCooldown('regSendOtpBtn', 30);
};
window.doRegister = async function(){
  const phone = cleanPhone($('regPhone').value);
  const code = ($('regOtp').value || '').trim();
  const pass = $('regPassword').value;
  const pass2 = $('regPassword2').value;
  // Referral code box is prefilled from ?ref= (see captureReferralFromUrl)
  // but stays editable -- whatever's in the box at submit time wins,
  // whether that's the link's code, untouched, or something typed by hand.
  // Petro makes it REQUIRED (Snow allowed skipping it) -- see CLAUDE.md.
  const referral = $('regReferral').value.trim();
  if (!phone) return regError('Enter a valid ' + regionName() + ' mobile number.');
  if (!window._regOtp.otpId || window._regOtp.phone !== phone)
    return regError('Please tap Send Code first.');
  if (!/^\d{6}$/.test(code)) return regError('Enter the 6-digit verification code sent to your phone.');
  if (!pass || pass.length < 6) return regError('Password must be at least 6 characters.');
  if (pass !== pass2) return regError('The two passwords do not match.');
  // Required or not is the SERVER's call (settings.referralRequired), which
  // already accounts for the founder case: on a platform with no members yet
  // there is no code in existence to type, so the first account is let
  // through. Hard-coding "always required" here made the app impossible to
  // sign up to at all on day one.
  if (!referral && referralIsRequired())
    return regError('A referral code is required to sign up. Ask the person who invited you for theirs.');
  regError('');
  setBtnLoading('regBtn', true, 'Register', 'Verifying code…');
  if (!window._regOtp.ticket) {
    const v = await post('/auth/otp/verify', { otpId: window._regOtp.otpId, code });
    if (v.status !== 'success') { setBtnLoading('regBtn', false, 'Register'); return regError(v.message || 'Incorrect verification code.'); }
    window._regOtp.ticket = v.ticket;
  }
  setBtnLoading('regBtn', true, 'Register', 'Creating your account…');
  STATE.refCode = referral;
  window._pendingRegPin = '';
  window._pendingRegPhone = phone;
  window._pendingRegOtpTicket = window._regOtp.ticket;
  try {
    const email = phoneToEmail(phone);
    await window.fbCreateUser(email, pass);
    storeCredentialIfPossible(email, pass);
  }
  catch (e) {
    // Owner-reported real bug: a Firebase Auth account can exist with no
    // matching Petro profile -- e.g. an earlier registration attempt whose
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
        storeCredentialIfPossible(retryEmail, pass);
        if (sameUid && STATE.user && STATE.user.uid === sameUid)
          await bootFromNetwork(sameUid);
        return;
      } catch (_) { /* wrong password -- fall through to the real error */ }
    }
    regError(fbErrMsg(e));
    setBtnLoading('regBtn', false, 'Register');
  }
};
// ── FORGOT PASSWORD: phone -> OTP -> new password, one screen ──
// Reached from the Log In screen. No Firebase session exists yet (the
// member cannot sign in, that's the whole point) -- identity is proven by
// the OTP ticket alone, and the password itself is changed server-side via
// /auth/reset/confirm (Admin SDK, no active session needed). Same
// single-screen pattern as the rebuilt Sign Up above (Send Code fills
// otpId, the real verify happens inside the submit handler), not the
// earlier 3-step wizard.
window._forgotOtp = { otpId: null, ticket: null, phone: '' };
function forgotError(msg){ if (msg) notify(msg); }
window.doForgotSendOtp = async function(){
  const phone = cleanPhone($('forgotPhone').value);
  if (!phone) return forgotError('Enter a valid ' + regionName() + ' mobile number.');
  forgotError('');
  setBtnLoading('forgotSendOtpBtn', true, 'Send Code', 'Sending…');
  const d = await post('/auth/otp/send', { purpose: 'reset', phone });
  setBtnLoading('forgotSendOtpBtn', false, 'Send Code');
  if (d.status !== 'success') return forgotError(d.message || 'Could not send the code');
  window._forgotOtp = { otpId: d.otpId, ticket: null, phone };
  const otpInput = $('forgotOtp'); if (otpInput) otpInput.value = '';
  startOtpResendCooldown('forgotSendOtpBtn', 30);
};
window.doForgotSubmit = async function(){
  const phone = cleanPhone($('forgotPhone').value);
  const code = ($('forgotOtp').value || '').trim();
  const pass = $('forgotPassword').value;
  const pass2 = $('forgotPassword2').value;
  if (!phone) return forgotError('Enter a valid ' + regionName() + ' mobile number.');
  if (!window._forgotOtp.otpId || window._forgotOtp.phone !== phone) return forgotError('Please tap Send Code first.');
  if (!/^\d{6}$/.test(code)) return forgotError('Enter the 6-digit verification code sent to your phone.');
  if (!pass || pass.length < 6) return forgotError('Password must be at least 6 characters.');
  if (pass !== pass2) return forgotError('The two passwords do not match.');
  forgotError('');
  setBtnLoading('forgotSubmitBtn', true, 'Reset Password', 'Verifying code…');
  const v = await post('/auth/otp/verify', { otpId: window._forgotOtp.otpId, code });
  if (v.status !== 'success') { setBtnLoading('forgotSubmitBtn', false, 'Reset Password'); return forgotError(v.message || 'Incorrect verification code.'); }
  window._forgotOtp.ticket = v.ticket;
  setBtnLoading('forgotSubmitBtn', true, 'Reset Password', 'Resetting password…');
  const d = await post('/auth/reset/confirm', { phone: window._forgotOtp.phone, ticket: window._forgotOtp.ticket, newPassword: pass });
  setBtnLoading('forgotSubmitBtn', false, 'Reset Password');
  if (d.status !== 'success') return forgotError(d.message || 'Could not reset your password');
  notify('Password reset. Please log in.');
  window._forgotOtp = { otpId: null, ticket: null, phone: '' };
  $('loginPhone').value = $('forgotPhone').value;
  $('loginPassword').value = '';
  showAuthTab('login');
};
window.doLogout = async function(opts){
  // {auto:true} marks an AUTOMATIC sign-out (the idle-session timeout
  // above) rather than the member tapping Log Out themselves. Owner: "auto
  // login when Google details are put, it fails to login automatically, so
  // l have to press button, why" -- traced to this function: every logout,
  // idle-triggered or not, was permanently setting the SAME
  // petro_relogin_required flag that blocks Chrome's autofill-then-submit
  // convenience (see the big comment lower down) for the rest of the tab's
  // life. That is exactly right for a DELIBERATE "log me out" ("l don't
  // want to use that very account" -- the original owner quote this was
  // built for), but an idle timeout is not the member choosing to leave;
  // it is a security measure they didn't ask for, and permanently adding
  // "now also retype your password every single time for the rest of this
  // tab" on top of it is friction nobody asked for. Only an explicit call
  // sets the persistent suppression now.
  const auto = !!(opts && opts.auto);
  // Revoke the captured session without delaying the UI sign-out. The normal
  // api() epoch guard would intentionally cancel this call during logout.
  const leavingUser = window.fbAuth && window.fbAuth.currentUser;
  if (leavingUser) leavingUser.getIdToken().then(token => fetch(API_BASE + '/auth/session/logout', {
    method:'POST', headers:{Authorization:'Bearer ' + token}, signal:AbortSignal.timeout(5000)
  })).catch(() => {});
  _memberSession.clear();
  window._triedAutoSignIn = true;
  if (!auto) { try { sessionStorage.setItem('petro_relogin_required', '1'); } catch (_) {} }
  stopLiveRefresh();
  // Defense in depth alongside the _openSheetTitle fix on the checkin
  // countdown's own tick: a sign-out that happens to land while Daily
  // Check-in is still open shouldn't leave this ticking into a signed-out
  // session either.
  if (_checkinCountdownTimer) { clearInterval(_checkinCountdownTimer); _checkinCountdownTimer = null; }
  STATE.authEpoch++;
  Object.assign(STATE, { account: null, investments: null, teamStats: null, teamMembers: {1:null,2:null,3:null}, bankAccounts: null, transactions: null });
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
  // Cleared AFTER the sign-out, so the auth screen is on its way in. Chrome
  // may refill them again and that is fine -- filled fields are only a
  // problem when something submits them by itself, which is now blocked.
  const _lp = $('loginPhone'), _lw = $('loginPassword');
  if (_lp) _lp.value = '';
  if (_lw) _lw.value = '';
};

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
    if (!phone.value || !pass.value) return;
    window._autofillLoginTried = true;
    window.doLogin();
  }
  document.addEventListener('animationstart', (e) => {
    if (e.animationName !== 'onAutoFillStart') return;
    if (e.target.id !== 'loginPhone' && e.target.id !== 'loginPassword') return;
    // Chrome's picker fills both fields together but not always in the same
    // tick -- give the second field a moment to land before checking.
    clearTimeout(debounce);
    debounce = setTimeout(maybeAutoSubmit, 80);
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
// to wait on about 1.3 MB of JSON, and 900 KB of it was /public/petro-images
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
var _artPromise = null;
async function boot(){
  // Fired together so Home receives its first activity rows before it paints.
  // The server caches completed activity; this is deliberately not generated
  // client-side so the ticker never invents financial events.
  const pSettings = api('/public/settings'), pProducts = api('/public/products');
  const pBanner = api('/public/banner');
  _artPromise = Promise.all([ api('/public/announcement-image'), api('/public/petro-images') ])
    .then(([ai, ci]) => { applyBootArtwork(ai, ci); })
    .catch(() => {});
  const [s, p, b] = await Promise.all([ pSettings, pProducts, pBanner ]);
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
  STATE.products = p.status === 'success' ? p.products : [];
  STATE.homeBanner = (b.status === 'success' && b.image) ? b.image : null;
  // Optional admin-set banner video (Home.dc.html's "ADMIN VIDEO BANNER").
  // Two sources, and an uploaded file always wins over a typed link:
  // videoVersion means the owner uploaded the file into the database, and it
  // is served from /public/banner-video -- its own URL, so the browser caches
  // and streams it instead of it riding along inside this every-boot JSON.
  // The version in the query string means a new upload is a new URL, so the
  // immutable cache header on that endpoint can never serve a stale clip.
  // STATE.homeBanner doubles as the poster frame when both are set.
  STATE.homeBannerVideo = (b.status === 'success')
    ? (b.videoVersion ? API_BASE + '/public/banner-video?v=' + encodeURIComponent(b.videoVersion) : (b.video || null))
    : null;
  // The instant-boot path paints Home from the saved snapshot before this
  // fetch lands, and nothing else repaints Home afterwards -- so without this
  // a member who had opened the app before would keep seeing the PREVIOUS
  // banner video (or none) for the whole session after the owner changed it.
  // Cheap and self-limiting: it only touches the DOM when the URL actually
  // differs from what is on screen.
  refreshHomeBannerIfChanged();
  applyNumberFont();
}
// Everything the first screen does not need. Called when the three heavy
// replies land -- which may be before or after the app becomes visible, so
// it repaints whatever is currently on screen rather than assuming.
function applyBootArtwork(ai, ci){
  // `ai` (the removed announcement dialog's own image) is no longer read
  // here -- kept as a parameter only because its caller's Promise.all still
  // fetches it; not worth touching that sequence just to drop one entry.
  // Same reasoning once more for the two Petro-only slots: the Referral
  // page banner and the brand logo on the Account profile card.
  STATE.brandLogo = (ci.status === 'success' && ci.logo) ? ci.logo : null;
  syncBrandLogoImages();
  // Home's banner carousel, slides 2 and 3 (slide 1 is STATE.homeBanner /
  // STATE.homeBannerVideo, fetched separately above -- it predates the
  // carousel and is the only slide that can be a video). Filtered to
  // whichever are actually set, so 1 or 2 slides render fine too, not only 3.
  STATE.homeSlides2n3 = [
    (ci.status === 'success' && ci.banner2) ? ci.banner2 : null,
    (ci.status === 'success' && ci.banner3) ? ci.banner3 : null,
  ].filter(Boolean);
  // Static image at the very bottom of Home (the mockup's "Clean Energy
  // Stronger Communities" band). Optional -- Home just renders nothing here
  // when it's unset.
  STATE.homeFooterBanner = (ci.status === 'success' && ci.homefooter) ? ci.homefooter : null;
  // Optional admin-managed artwork behind the Daily Check-in sheet.
  STATE.checkinBanner = (ci.status === 'success' && ci.checkinbanner) ? ci.checkinbanner : null;
  // Account screen's header background (the mockup's refinery photo behind
  // the phone/ID card).
  STATE.profileCard = (ci.status === 'success' && ci.profilecard) ? ci.profilecard : null;
  // The Login / Sign Up backdrop (single full-bleed photo -- see
  // applyAuthBackgrounds()'s own comment on why there is only one now).
  STATE.authHeroImage = (ci.status === 'success' && ci.authhero) ? ci.authhero : null;
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
function applyAuthBackgrounds(){
  const s = STATE.settings || {};
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
    // The CURRENT shared form (owner: "let the link be '/refCode='"):
    // <origin>/refCode=<code>, read straight off the path. Checked last only
    // because the two older forms above are cheaper to test, not because it
    // is the fallback -- this is what every new invite carries. Both older
    // forms are kept working on purpose: links already sent to real people
    // are out of our hands and must not start failing.
    if (!ref) {
      const m = /\/refCode=([^/?#]+)/.exec(location.pathname);
      if (m) { try { ref = decodeURIComponent(m[1]); } catch (_) { ref = m[1]; } }
    }
    if (!ref) return;
    STATE.refCode = ref;
    // Referral codes are case-sensitive on the server (exact-match lookup,
    // e.g. "QcNBht") -- must NOT be uppercased/lowercased here or a real
    // code silently stops matching.
    $('regReferral').value = ref;
    showAuthTab('register');
  } catch (_) {}
}
// Whether Sign Up demands a referral code. The server decides (it resolves
// the admin setting AND whether any member exists yet) and publishes the
// answer as settings.referralRequired; this is only the reader.
// Default TRUE when settings haven't loaded, so a failed settings fetch can
// never quietly turn the requirement off -- the server would reject the
// sign-up anyway, and this way the app says so up front.
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
function referralIsRequired(){
  const st = STATE.settings || {};
  return st.referralRequired !== false;
}
// Says out loud whether the box must be filled, instead of leaving members
// to discover it by being rejected. Runs whenever the auth screen paints.
function updateReferralFieldHint(){
  const input = $('regReferral');
  if (!input) return;
  const required = referralIsRequired();
  input.placeholder = required ? 'Referral code' : 'Referral code (optional)';
  const hint = $('regReferralHint');
  if (hint) hint.textContent = required
    ? 'Referral code is required'
    : 'No code needed yet — you are among the first to join.';
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
  if (!STATE.settings) await withTimeout(_bootPromise, 6000);
  if (!isOpeningGateActive()) return false;
  $('loadingScreen').style.display = 'none';
  $('authScreen').style.display = 'none';
  $('app').style.display = 'none';
  $('openingGate').style.display = 'flex';
  startOpeningGateCountdown(Number(STATE.settings.openingCountdownAt));
  return true;
}

// ── AUTH STATE HANDLER ──
window.addEventListener('snow-auth', async (ev) => {
  const user = ev.detail;
  // Firebase's onAuthStateChanged can genuinely fire more than once for the
  // SAME already-current user during a single page load/session -- e.g. once
  // synchronously from cached/persisted auth state, then again once it
  // round-trips to actually confirm/refresh the session with the backend.
  // Without this guard, every one of those redundant re-fires re-showed the
  // loading screen and re-ran enterApp() from scratch: the owner's "a start
  // up loader can load twice... then again reloads again automatically."
  // STATE.user is only ever null right after a real sign-out (doLogout()'s
  // own signOut() re-fires this with user:null and clears STATE.user below),
  // so a repeat firing with the identical uid here is always a redundant
  // re-fire, never a genuine new sign-in -- safe to no-op. A real sign-in,
  // sign-out, or account switch (different uid) still runs the full flow.
  if (user && STATE.user && user.uid === STATE.user.uid) return;
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
      try { sessionStorage.removeItem('petro_relogin_required'); } catch (_) {}
    } catch (_) { _memberSession.expire(); await window.fbSignOut(); return; }
  } else { _memberSession.clear(); clearCachedState(); }
  if (await maybeShowOpeningGate()) return;
  if (!user) {
    window._pendingLoginSuccess = false;
    // Only worth trying once, on the very first "nobody's signed in" we see
    // this page load (a real boot) -- not after an in-session doLogout(),
    // which already called preventSilentAccess() specifically so this
    // wouldn't immediately hand the same member right back in.
    // Returning to login never silently reuses a stored password.
    window._triedAutoSignIn = true;
    $('loadingScreen').style.display = 'none';
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
  $('authScreen').style.display = 'none';
  $('loadingScreen').style.display = 'flex';
  await enterApp();
});
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
    // Just the URL, never the clip. The video FILE lives in the browser's own
    // HTTP cache (immutable, a year, versioned URL), so knowing the URL at
    // paint time is all the instant-boot path needs to start it right away
    // instead of leaving the banner blank until /public/banner comes back.
    // A poster image would be a data: URL worth hundreds of KB, so it is
    // deliberately NOT kept here -- with the video cached it is barely seen.
    homeBannerVideo: STATE.homeBannerVideo || null,
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
  // Same `||` reasoning as the two above: fill the gap until boot()'s live
  // /public/banner lands, never overwrite it once it has.
  STATE.homeBannerVideo = STATE.homeBannerVideo || cached.homeBannerVideo || null;
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
  $('loadingScreen').style.display = 'none';
  $('app').style.display = '';
  showPage(STATE.page || 'home');
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
async function registerCurrentUser(pin, phone, otpTicket){
  let reg = await post('/register', { referralCode: STATE.refCode || '', pin: pin || '', phone: phone || '', otpTicket: otpTicket || '' });
  // Dropping the code and carrying on is only valid while a code is
  // OPTIONAL. Once it is required (the normal state, as soon as the platform
  // has members) retrying with an empty code just earns a REFERRAL_REQUIRED
  // rejection, so the member is told to correct the code instead. That is
  // recoverable rather than a dead end: their Firebase account now exists,
  // and tapping Sign Up again with the same number and password takes
  // doRegister()'s email-already-in-use branch, which signs them in and
  // finishes this same registration with the corrected code.
  if (reg.status === 'error' && reg.code === 'BAD_REFERRAL' && STATE.refCode && !referralIsRequired()) {
    notify(reg.message || t('That referral code is invalid. Continuing without it.'));
    STATE.refCode = '';
    reg = await post('/register', { referralCode: '', pin: pin || '', phone: phone || '', otpTicket: otpTicket || '' });
  }
  return reg;
}
async function bootFromNetwork(uid){
  const signupFlow = !!window._pendingRegOtpTicket;
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
  if (window._pendingRegOtpTicket) {
    const pin = window._pendingRegPin, phone = window._pendingRegPhone, otpTicket = window._pendingRegOtpTicket;
    const reg = await registerCurrentUser(pin, phone, otpTicket);
    if (reg.status !== 'success' && reg.status !== 'already_done') {
      $('loadingScreen').style.display = 'none';
      notify(reg.message || 'Could not complete registration');
      $('authScreen').style.display = '';
      setBtnLoading('regBtn', false, 'Register');
      return;
    }
    window._pendingRegPin = ''; window._pendingRegPhone = ''; window._pendingRegOtpTicket = '';
    r = await api('/account');
  } else {
    r = await api('/account');
    if (r.status === 'error' && (r.code === 'NOT_FOUND' || r.code === 'REGISTRATION_REQUIRED' || r.message === 'User not found')) {
      // Ghost account (Firebase user exists, our profile never finished in
      // an earlier session -- e.g. a crash/reload between account creation
      // and /register finishing) -- self-heal the same way.
      const reg = await registerCurrentUser(window._pendingRegPin || '', window._pendingRegPhone || '', window._pendingRegOtpTicket || '');
      if (reg.status !== 'success' && reg.status !== 'already_done') {
        $('loadingScreen').style.display = 'none';
        notify(reg.message || 'Could not complete registration');
        $('authScreen').style.display = '';
        setBtnLoading('regBtn', false, 'Register');
        return;
      }
      r = await api('/account');
    }
  }
  if (r.status === 'error') {
    $('loadingScreen').style.display = 'none';
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
  await withTimeout(_bootPromise, 6000);
  // _bootPromise carries /public/banner, so STATE.homeBannerVideo is known by
  // here -- which is what makes it possible to have the clip downloaded
  // BEFORE the loading screen comes down rather than after.
  await preloadBannerVideo(BANNER_PRELOAD_MS);
  $('loadingScreen').style.display = 'none';
  $('app').style.display = '';
  showPage(STATE.page || 'home');
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
var NAV_ICON_SVG = {
  home: suppliedMemberIcon('navHome'),
  assets: suppliedMemberIcon('navAssets'),
  network: suppliedMemberIcon('navNetwork'),
  account: suppliedMemberIcon('navAccount'),
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
    if (e.animationName === 'navTapSignal') {
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
    if (slot && slot.dataset.petroNavIcon !== key) {
      slot.innerHTML = NAV_ICON_SVG[key] || '';
      slot.dataset.petroNavIcon = key;
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
// figure in the app (balances, plans, records, team, messages) lives in MongoDB
// behind petro-server, so there is no Firestore document to attach onSnapshot
// to. The equivalent behaviour without rebuilding the backend is this: a short
// poll that repaints IN PLACE. Nothing reloads, nothing navigates, and the
// member cannot tell the difference. (A genuine server push would be SSE from
// petro-server off a Mongo change stream -- a real option, and a much bigger
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
var LIVE_MS = 5000, LIVE_MAX_MS = 60000;
// Team stats get their own, slower beat -- see the note at their fetch.
var LIVE_TEAM_MS = 30000, _liveTeamAt = 0;
// Tunable from the backend without shipping an app build. Floored at 2s: below
// that the phone spends more time on radio wake-ups than on anything a member
// would notice.
function livePollMs(){
  const s = Number((STATE.settings || {}).livePollMs);
  return Math.max(2000, Number.isFinite(s) && s > 0 ? s : LIVE_MS);
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
  _liveDelay = 0; _liveSigs = {}; _liveTeamAt = 0;
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
    if (liveChanged('account', acc.account)) {
      // patchHomeBalances() writes only the specific figures and no-ops on a
      // page that has none, so it is safe on every screen -- and unlike
      // renderAccount() it cannot reset the member's scroll position, which
      // would read as the reload he does not want.
      patchHomeBalances();
    }
  } else ok = false;

  // An open sheet is what the member is actually looking at, so it wins over
  // the page behind it.
  if (sheet === 'Transaction Statement') {
    const r = await api('/transactions');
    if (r.status === 'success' && _openSheetTitle === 'Transaction Statement') {
      STATE.transactions = r.transactions;
      STATE.transactionsTruncated = !!r.truncated;
      if (liveChanged('tx', r.transactions)) renderStatement();
    } else if (r.status !== 'success') ok = false;
    return ok;
  }
  if (sheet === 'Messages') {
    const r = await api('/messages');
    if (r.status === 'success' && _openSheetTitle === 'Messages') {
      STATE.messages = r.messages;
      if (liveChanged('messages', r.messages)) { renderMessagesList(); updateMessageBadge(); }
    } else if (r.status !== 'success') ok = false;
    return ok;
  }

  if (STATE.page === 'home' && !sheet) {
    const r = await api('/investments');
    if (r.status === 'success' && Array.isArray(r.investments)) {
      STATE.investments = r.investments;
      _investmentsLoadFailed = false;
      if (!_openSheetTitle && STATE.page === 'home' && liveChanged('investments', r.investments)) paintMyAssetsInner();
    } else ok = false;
  } else if (STATE.page === 'assets') {
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
        if (liveChanged('team', r)) paintNetwork();
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
  if (STATE.page === name && !document.querySelector('.sheet-bg.show,#msgDetailBg.show,#depStatusBg.show')) return;
  return showPage(name);
};
window.showPage = async function(name){
  // The bottom bar now stays visible over sheets (Deposit, Withdraw, Wallet
  // and the rest), so a tab can be tapped while one is open. Close it first,
  // otherwise the new tab paints underneath a sheet that is still covering
  // it and the app looks frozen.
  //
  // {navigating:true} because this close is a TAB TAP, not a back-out to Home.
  // Owner: "l don't want when l can go in deposit and l click to another nav
  // icon not home it should not show announcement dialog." This ran BEFORE
  // `STATE.page = name` below, so maybeAnnounceAfterSheet() read STATE.page as
  // the page the sheet was opened over -- 'home' -- and announced, whichever
  // tab was actually being tapped. The new page then painted under the dialog.
  // Tapping HOME from Deposit still announces: the 'home' branch below does it,
  // which is the one path that genuinely is "from deposit back to home".
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
  STATE.page = name;
  updateNavIcons();
  if (name === 'home') {
    // Deliberately NOT awaited: renderHome() does its own account/investments
    // refresh (a real network round trip even on a cache-hit repaint), and
    // the announcement decision below depends only on STATE.settings, not on
    // that data at all -- awaiting it first was adding a real, needless
    // delay before the dialog could ever show, on top of the (now-removed)
    // wait a few lines below. paintHome()'s synchronous portion still runs
    // in this same tick either way (everything in renderHome() before its
    // own first `await` executes before control returns here), so Home's
    // paint ordering is unaffected -- only the ANNOUNCEMENT's own timing
    // changes here.
    renderHome();
  }
  else if (name === 'assets') await renderAssets();
  else if (name === 'network') await renderNetwork();
  else if (name === 'account') await renderAccount();
  startLiveRefresh();
};
// Announcement dialog, reintroduced (owner: "we are going to introduce
// announcement dialog, so it will have channel and email buttons shaking
// and glowing, the cancel X sign will be top right... it opens from middle
// as usual and also just like mechanism of previous chipz clicking back to
// home stimulates it"). Was removed entirely in an earlier round (see
// petro/CLAUDE.md's "Design system" section) -- maybeShowAnnouncement() was
// deliberately kept as a no-op rather than deleted specifically so
// maybeAnnounceAfterSheet()'s five call sites never needed touching either
// time; this round just gives it a real body again. Content (annTitle/
// annBody) and the WhatsApp/email CTAs (whatsappGroup/supportEmail) reuse
// the exact same admin settings and rendering pattern openSupportSheet()
// already established -- one set of contact fields, two places they show.
window.closeAnnouncement = function(){
  const bg = $('annBg');
  if (bg) bg.classList.remove('show');
  if (!isAnyOverlayOpen()) unlockBodyScroll();
};
function maybeShowAnnouncement(){
  const s = STATE.settings || {};
  if (!s.annEnabled || !(s.annTitle || s.annBody)) return;
  const bg = $('annBg'), sheet = $('annSheet');
  if (!bg || !sheet) return;
  const ctas = [];
  if (s.whatsappGroup) ctas.push(`<a class="whatsapp" href="${esc(s.whatsappGroup)}" target="_blank" rel="noopener">${ICONS.whatsapp}<span>Chat on WhatsApp</span></a>`);
  if (s.supportEmail) ctas.push(`<a class="mail" href="mailto:${esc(s.supportEmail)}">${ICONS.envelope}<span>Email us</span></a>`);
  sheet.innerHTML = `
    <button class="ann-close" onclick="closeAnnouncement()" aria-label="Close">${ICONS.x}</button>
    <div class="ann-mark">${ICONS.megaphone}</div>
    ${s.annTitle ? `<h3 class="ann-title">${esc(s.annTitle)}</h3>` : ''}
    ${s.annBody ? `<p class="ann-body">${esc(s.annBody)}</p>` : ''}
    ${ctas.length ? `<div class="ann-cta">${ctas.join('')}</div>` : ''}
  `;
  bg.classList.add('show');
  lockBodyScroll();
}

// ── HOME ──
// Cache-first: a page revisit paints instantly from whatever STATE already
// holds (no network wait, no loading affordance needed), then a background
// fetch quietly brings it up to date. `patchHomeBalances()` updates just the
// 3 money figures in place afterward (and on a standing timer via
// startLiveRefresh()) without rebuilding the page -- rebuilding would tear
// down and restart the ticker/chest-swing animations every few seconds.
async function renderHome(){
  const hadCache = !!STATE.account;
  const hadInvestments = Array.isArray(STATE.investments);
  if (hadCache) paintHome();
  const [accR, invR] = await Promise.all([ api('/account'), api('/investments') ]);
  if (accR.status === 'success') STATE.account = accR.account;
  if (invR.status === 'success' && Array.isArray(invR.investments)) {
    STATE.investments = invR.investments;
    _investmentsLoadFailed = false;
  } else if (!hadInvestments) {
    _investmentsLoadFailed = true;
  }
  if (STATE.page !== 'home') return; // navigated away while awaiting
  if (hadCache) patchHomeBalances(); else paintHome();
  paintMyAssetsInner();
  // The envelope button's unread dot. Fetched once per Home entry, AFTER
  // the paint (never blocking it) and patched in place via
  // updateMessageBadge() so it can't tear down the ticker/chest animation.
  const msgR = await api('/messages');
  if (msgR.status === 'success') STATE.messages = msgR.messages;
  if (STATE.page === 'home') updateMessageBadge();
}
// The Home banner has three states, in priority order: an admin-set video
// (Home.dc.html's "ADMIN VIDEO BANNER"), an admin-set still image, or the
// built-in striped fallback with the brand tagline.
// The video is muted+playsinline+loop so mobile browsers will autoplay it;
// where autoplay is refused (data-saver, low-power mode, some iOS states)
// the poster image stays up and the mockup's play ring is there to tap. The
// ring is hidden by the 'playing' class rather than removed, so pausing
// brings it straight back.
function homeBannerInnerHtml(st){
  if (STATE.homeBannerVideo) {
    const poster = STATE.homeBanner ? ` poster="${esc(STATE.homeBanner)}"` : '';
    // Owner: "l dont want it to be tappable or pause or play, l want it to go
    // or run on its own." So there is no play ring and no controls, and the
    // element takes no pointer events at all (CSS) -- a tap on the banner
    // does nothing, it cannot be paused, and there is no picture-in-picture
    // or long-press download menu either. autoplay+muted+loop+playsinline is
    // the exact combination phone browsers allow to start on its own.
    return `<video id="homeBannerVideo" src="${esc(STATE.homeBannerVideo)}"${poster} autoplay muted loop playsinline preload="auto"
        disablepictureinpicture disableremoteplayback controlslist="nodownload noplaybackrate noremoteplayback" tabindex="-1" aria-hidden="true"
        onerror="this.parentNode&&this.parentNode.classList.add('hb-video-failed')"></video>`;
  }
  if (STATE.homeBanner) return `<img src="${esc(STATE.homeBanner)}" alt="" onerror="this.style.display='none'">`;
  return `<div class="hb-stripes"></div>`;
}
// ── HOME BANNER CAROUSEL (owner: "those slide images will be uploaded
// from admin panel") ──
// Only kicks in when there is no video AND more than one image to actually
// rotate between -- a video keeps its existing single-banner behavior
// completely untouched (autoplay/preload/live-refresh, all unchanged), and
// a single image renders exactly as it always has (no dots, nothing to
// cycle). Slide 1 is STATE.homeBanner (the original, pre-carousel slot);
// slides 2/3 are the new banner2/banner3 admin uploads.
function homeCarouselSlides(){
  if (STATE.homeBannerVideo) return null;
  const slides = [STATE.homeBanner].concat(STATE.homeSlides2n3 || []).filter(Boolean);
  return slides.length > 1 ? slides : null;
}
function homeBannerBlockHtml(st){
  const slides = homeCarouselSlides();
  if (!slides) return `<div class="home-banner">${homeBannerInnerHtml(st)}</div>`;
  return `<div class="home-banner" id="homeCarouselTrack"><div class="hb-fade-stack">
    <img class="hb-fade-current" src="${esc(slides[0])}" alt="">
    <img class="hb-fade-next" src="${esc(slides[1])}" alt="">
  </div></div>`;
}
var _homeCarouselTimer = null;
var _homeCarouselIdx = 0;
// Self-terminating on the next tick once Home's own DOM nodes are gone --
// same idiom this file already uses for the check-in countdown and the
// turntable spin timer, so navigating away never leaves this ticking
// against a detached node.
function startHomeCarousel(){
  if (_homeCarouselTimer) { clearInterval(_homeCarouselTimer); _homeCarouselTimer = null; }
  const slides = homeCarouselSlides();
  if (!slides) return;
  _homeCarouselIdx = 0;
  _homeCarouselTimer = setInterval(() => {
    const wrap = document.getElementById('homeCarouselTrack');
    const stack = wrap && wrap.querySelector('.hb-fade-stack');
    const current = stack && stack.querySelector('.hb-fade-current');
    const next = stack && stack.querySelector('.hb-fade-next');
    if (!stack || !current || !next) {
      clearInterval(_homeCarouselTimer); _homeCarouselTimer = null; return;
    }
    if (stack.classList.contains('hb-crossfading')) return;
    const nextIdx = (_homeCarouselIdx + 1) % slides.length;
    const afterIdx = (nextIdx + 1) % slides.length;
    const preload = new Image();
    preload.onload = () => {
      next.src = slides[nextIdx];
      requestAnimationFrame(() => stack.classList.add('hb-crossfading'));
      setTimeout(() => {
        current.src = slides[nextIdx];
        next.src = slides[afterIdx];
        _homeCarouselIdx = nextIdx;
        stack.classList.add('hb-fade-reset');
        stack.classList.remove('hb-crossfading');
        void stack.offsetWidth;
        stack.classList.remove('hb-fade-reset');
      }, 760);
    };
    preload.onerror = () => { _homeCarouselIdx = nextIdx; };
    preload.src = slides[nextIdx];
  }, 4500);
}
// Puts the element that was preloaded during the loading screen INTO the
// banner, in place of the fresh <video> paintHome() just wrote.
//
// Without this the preload only warms the HTTP cache: paintHome() builds a
// brand-new <video>, and at the instant the loading screen goes that element
// has readyState 0 and still has to go and read the file, so the banner shows
// its poster for a beat first -- exactly the "show up after the loader" the
// owner did not want. Moving the already-decoded element across closes that
// gap: it is mid-playback the moment it lands.
//
// Every attribute is copied off the node being replaced rather than restated
// here, so this cannot drift from homeBannerInnerHtml() -- add an attribute
// there and it comes along automatically.
function adoptPreloadedBannerVideo(){
  const el = _bannerPreloadEl;
  if (!el || !_bannerPreloadOk || !STATE.homeBannerVideo) return;
  if (el.getAttribute('src') !== STATE.homeBannerVideo) return;   // a stale preload
  const cur = document.getElementById('homeBannerVideo');
  if (!cur || cur === el) return;
  for (const a of Array.from(cur.attributes)) {
    if (a.name === 'src') continue;                                // identical by the check above
    try { el.setAttribute(a.name, a.value); } catch (_) {}
  }
  const parent = cur.parentNode;
  if (!parent) return;
  parent.replaceChild(el, cur);
  const r = el.play(); if (r && r.catch) r.catch(() => {});
}
// Swaps the Home banner in place when the admin-set video URL has changed
// under a Home that is already painted. A no-op when Home is not on screen,
// or when what is rendered already matches.
function refreshHomeBannerIfChanged(){
  const wrap = document.querySelector('.home-banner');
  if (!wrap) return;
  const cur = wrap.querySelector('#homeBannerVideo');
  const shown = cur ? cur.getAttribute('src') : null;
  if (shown === (STATE.homeBannerVideo || null)) return;
  wrap.classList.remove('hb-video-failed');
  wrap.innerHTML = homeBannerInnerHtml(STATE.settings || {});
  adoptPreloadedBannerVideo();
  tryAutoplayHomeBanner();
}
// Owner: "make when the start up loader must have loaded also the video
// before it waiting to load, so video must show up after loader."
//
// Downloads the banner video WHILE the loading screen is still up, so Home
// paints with it already playing instead of showing the poster (or the
// striped hero) and popping the video in a second or two later.
//
// This costs real time only ONCE. The video is served with a year-long
// immutable cache under a versioned URL, so every later open resolves from
// the phone's own cache and `canplaythrough` fires almost immediately -- the
// wait below is effectively first-open-after-an-upload only.
//
// It is capped all the same. A member on slow Ugandan mobile data must never
// be held on a spinner by a decorative clip: when the cap is hit the app
// opens anyway and the element keeps buffering in the background, so the
// banner starts as soon as it can. Same for a video that errors -- that path
// resolves immediately rather than burning the whole cap.
//
// The element is kept in a module-level reference on purpose: a detached
// <video> that gets garbage-collected mid-download would abandon the very
// fetch this is waiting on.
var _bannerPreloadEl = null;
// Only a preload that actually reached "can play" is worth adopting. A failed
// one must be left alone so the banner's own fresh <video> loads, errors, and
// trips the hb-video-failed fallback -- adopting the dead element instead
// meant the error had already fired while it was detached, so the fallback
// never ran and the banner sat blank.
var _bannerPreloadOk = false;
// Ten seconds was too long to hold a member on a loading screen for a
// decorative clip. The wait exists because the owner asked for it ("the
// start up loader must have loaded also the video before it"), and it is
// paid ONCE per upload -- the year-long immutable cache makes every later
// open resolve from the phone -- so the cap only bites on a first open after
// a new video, which is exactly when four seconds of loader is plenty and
// ten is a member deciding the app is broken. A clip still buffering when
// the cap expires keeps loading behind the app.
var BANNER_PRELOAD_MS = 4000;
function preloadBannerVideo(ms){
  const src = STATE.homeBannerVideo;
  if (!src) return Promise.resolve('none');
  return new Promise(resolve => {
    let settled = false;
    const finish = (why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(why);
    };
    const v = document.createElement('video');
    _bannerPreloadEl = v; _bannerPreloadOk = false;
    // Muted + playsinline so a browser treats this like the real banner and
    // is willing to buffer it without a gesture.
    v.muted = true; v.defaultMuted = true; v.playsInline = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.addEventListener('canplaythrough', () => { _bannerPreloadOk = true; finish('ready'); }, { once: true });
    v.loop = true; v.autoplay = true;
    v.setAttribute('loop', ''); v.setAttribute('autoplay', '');
    v.addEventListener('error', () => finish('error'), { once: true });
    const timer = setTimeout(() => finish('timeout'), ms || BANNER_PRELOAD_MS);
    v.src = src;
    try { v.load(); } catch (_) { finish('error'); }
  });
}
// The banner must start itself, with nothing to tap. The autoplay attribute
// covers the normal case; these retries cover the cases where a phone
// browser refuses the first attempt -- the tab was in the background when
// Home painted, the phone was in low-power mode, or the browser wants to see
// a user gesture somewhere on the page first. Each retry is silent: a
// rejected play() is an expected outcome, not an error, and while it is
// refused the poster image simply stays up.
//
// The retry hooks are installed once, on window, and outlive any single
// repaint of Home (paintHome() rebuilds the <video> element every time).
var _bannerAutoplayHooked = false;
function tryAutoplayHomeBanner(){
  const v = document.getElementById('homeBannerVideo');
  if (v) { const r = v.play(); if (r && r.catch) r.catch(() => {}); }
  if (_bannerAutoplayHooked) return;
  _bannerAutoplayHooked = true;
  const kick = () => {
    const el = document.getElementById('homeBannerVideo');
    if (!el || !el.paused) return;
    const r = el.play(); if (r && r.catch) r.catch(() => {});
  };
  // Coming back to the app, or rotating/resizing, is a fresh chance to start.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  window.addEventListener('focus', kick);
  window.addEventListener('pageshow', kick);
  // Browsers that want a gesture first will accept one made ANYWHERE -- the
  // member tapping any part of the app unlocks it, without the banner itself
  // ever being tappable. Passive and non-capturing so it cannot interfere
  // with the taps it is listening to.
  ['touchend', 'click'].forEach(ev =>
    document.addEventListener(ev, kick, { passive: true }));
}
function paintHome(){
  const a = STATE.account || {};
  const st = STATE.settings || {};
  const unread = (STATE.messages || []).filter(m => !m.read).length;
  const bal = Number(a.walletBalance) || 0;
  const balText = fmtUGX(bal);
  // Owner's mockup: logo + tagline header, a 3-stat/wallet block and an
  // inline Daily Check-in card all live on Home now (previously the balance
  // lived on Account only, and Daily Check-in was sheet-only). The
  // Home now renders only the surfaces that belong to Petro's current design.
  let html = `
<div class="home-brand-title"><img id="homeBrandLogo" class="home-brand-logo" alt=""${STATE.brandLogo ? ` src="${esc(STATE.brandLogo)}"` : ''} style="display:${STATE.brandLogo ? 'block' : 'none'}" onerror="this.style.display='none'"><span>${esc(brandName())}</span></div>
${homeBannerBlockHtml(st)}
<div class="home-actions">
  <button class="home-action" onclick="openDepositSheet()">
    <span class="badge">${suppliedMemberIcon('deposit')}</span><span class="lbl">Deposit</span>
  </button>
  <button class="home-action" onclick="openWithdrawSheet()">
    <span class="badge">${suppliedMemberIcon('withdraw')}</span><span class="lbl">Withdraw</span>
  </button>
  <button class="home-action" onclick="navigatePage('network')">
    <span class="badge">${suppliedMemberIcon('invite')}</span><span class="lbl">Invite</span>
  </button>
  <button class="home-action" onclick="openSupportMail()">
    <span class="badge">${suppliedMemberIcon('support')}</span><span class="lbl">Support</span>
  </button>
</div>
<div class="wallet-bal-card">
  <div class="wbc-row1">
    <span class="wbc-lbl">Total Wallet Balance</span>
  </div>
  <div class="wbc-row2">
    <span class="mono wbc-amt" id="homeWalletBalance">${esc(balText)}</span>
  </div>
</div>
<div class="home-stat-row">
  <div class="home-stat"><span class="hs-ic hs-gold">${ICONS.coinsStack}</span><div class="hs-lbl">Cumulative Earnings</div><div class="mono hs-val hs-gold-txt" id="homeTotalEarned">${esc(fmtUGX(Number(a.totalEarned) || 0))}</div></div>
  <div class="home-stat"><span class="hs-ic hs-red">${ICONS.arrowDownCircle}</span><div class="hs-lbl">Total Deposits</div><div class="mono hs-val hs-red-txt" id="homeTotalDeposited">${esc(fmtUGX(Number(a.totalDeposited) || 0))}</div></div>
  <div class="home-stat"><span class="hs-ic hs-dark">${ICONS.arrowUpCircle}</span><div class="hs-lbl">Total Withdrawals</div><div class="mono hs-val" id="homeTotalWithdrawn">${esc(fmtUGX(Number(a.totalWithdrawn) || 0))}</div></div>
</div>
<div class="checkin-card">
  <span class="cic-gift">${ICONS.checkinCalendar}</span>
  <div class="cic-text">
    <div class="cic-title">Daily Check-in</div>
    <div class="cic-sub">Check in daily to receive rewards and grow your earnings!</div>
  </div>
  <button class="cic-btn" onclick="openCheckinSheet()">Check In</button>
</div>
<section class="home-my-assets" aria-label="My Assets">
  <h2>My Assets</h2>
  <div id="myAssetsInner">${myAssetsInnerHtml()}</div>
</section>
${STATE.homeFooterBanner ? `<img class="home-footer-banner" src="${esc(STATE.homeFooterBanner)}" alt="" onerror="this.remove()">` : ''}
<div style="height:8px;"></div>`;
  $('pageHost').innerHTML = '<div class="reveal-in">' + html + '</div>';
  // Before tryAutoplayHomeBanner(), so the element it then nudges is the
  // preloaded one rather than the blank node this paint just created.
  adoptPreloadedBannerVideo();
  tryAutoplayHomeBanner();
  startHomeCarousel();
}
function patchHomeBalances(){
  const account = STATE.account || {};
  for (const [id, key] of [['homeWalletBalance','walletBalance'], ['homeTotalEarned','totalEarned'], ['homeTotalDeposited','totalDeposited'], ['homeTotalWithdrawn','totalWithdrawn']]) {
    const el = $(id);
    if (el) el.textContent = fmtUGX(account[key]);
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
// One shared product-card renderer for Home's strip and the Products tab,
// so the two can never drift apart visually.
function productCardHtml(p){
  const { expected, cycle, daily: dailyPayout } = planFigures(p);
  const initial = esc(String(p.name || '').replace(/[^0-9]/g, '') || String(p.name || '?').trim()[0] || '?');
  const img = p.image
    // outerHTML, NOT parentNode.innerHTML: the product name now lives inside
    // .p-img alongside this image, so replacing the parent's contents would
    // take the name down with the broken image. This swaps out the <img>
    // alone.
    // The inner quotes must be HTML entities: the browser decodes them before the
    // handler is compiled, so the fallback markup is valid JS. Bare quotes here
    // would make the whole onerror a syntax error and no glyph would ever show.
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" onerror="this.outerHTML='&lt;div class=&quot;glyph&quot;&gt;${initial}&lt;/div&gt;'">`
    : `<div class="glyph">${initial}</div>`;
  return `
  <div class="p-card">
    <div class="p-img">${img}<div class="p-name">${esc(p.name)}</div></div>
    <div class="p-body">
      <div class="p-stats">
        <div class="p-stat"><div class="k">Price</div><div class="v">${fmtUGXCents(p.price)}</div></div>
        <div class="p-stat"><div class="k">Days</div><div class="v">${cycle}</div></div>
        <div class="p-stat"><div class="k">Daily</div><div class="v">${fmtUGXCents(dailyPayout)}</div></div>
        <div class="p-stat warm"><div class="k">Total</div><div class="v">${fmtUGXCents(expected)}</div></div>
      </div>
      ${productCtaHtml(p)}
    </div>
  </div>`;
}
// ── A PRODUCT'S BUY BUTTON, INCLUDING ITS SCHEDULE ──
//
// Owner: "make when l can time any product on its opening duration ie it can
// say coming soon in hh:mm:ss ... or even just putting as it is that coming
// soon." Three states, decided by the SERVER (publicProductView sends isOpen /
// openMode / opensAt):
//   open           -> Buy Now
//   'soon'         -> "Coming Soon", no clock. The plain checkbox.
//   'until'/'window' -> "Coming soon in HH:MM:SS", ticking down to opensAt.
//
// opensAt is an absolute epoch millisecond from the server, never a duration.
// A window like "opens 14:00" means 14:00 in EAT; computing that on the phone
// would be wrong by hours for anyone whose clock is set to another zone, and
// wrong by however far their clock has drifted.
//
// The button stays disabled either way; the countdown is a courtesy. The server
// re-checks the schedule inside /invest/create, so a card left open on screen
// as a window closes cannot be used to slip a purchase through.
function productCtaHtml(p){
  const open = p.isOpen !== false && !p.comingSoon;
  if (open) {
    return `<button class="primary-button p-cta" onclick="openInvestConfirm('${esc(p.key)}',this)">Invest Now</button>`;
  }
  const at = Number(p.opensAt) || 0;
  if (!at || p.openMode === 'soon' || p.comingSoon) {
    return '<button class="primary-button p-cta" disabled>Coming Soon</button>';
  }
  return `<button class="primary-button p-cta" disabled data-opens-at="${at}">`
    + `Coming soon in ${fmtCountdown(at - Date.now())}</button>`;
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
      refreshCatalogNow();
    }
  };
  tick();
  _openCountdownTimer = setInterval(tick, 1000);
}
async function refreshCatalogNow(){
  const r = await api('/public/products');
  if (r.status === 'success') {
    STATE.products = r.products;
    if (STATE.page === 'assets') paintAssets();
  }
}
// Opens whichever community channel the admin configured. Kept separate
// from Help Centre (the Service button) so the two tiles do different things.
window.openChannelLink = function(){
  const st = STATE.settings || {};
  const url = st.telegramGroup || st.telegramChannel || '';
  if (!url) { notify('No channel link is set yet.'); return; }
  window.open(url, '_blank', 'noopener');
};

// ── ASSETS (owner's 4th mockup round) ──
// "All Assets" is the mockup's own compact row layout -- a small thumbnail,
// name, an inline Price/Duration/Daily Cashback/Total Return strip, and a
// pill Purchase button -- built fresh rather than reusing productCardHtml()'s
// larger vertical card (explicitly what the owner asked NOT to reuse). It
// still shares the underlying data/logic that card uses: planFigures() for
// the figures and productCtaHtml()/openInvestConfirm() for the buy button
// and its open/soon/countdown states, so nothing about how a purchase
// actually works changed, only how the row looks.
//
window.switchAssetsTab = function(tab){
  showPage(tab === 'mine' ? 'home' : 'assets');
};
async function renderAssets(){
  const previousProducts = JSON.stringify(STATE.products);
  const hadProducts = (STATE.products || []).length > 0;
  if (hadProducts) paintAssets();
  else $('pageHost').innerHTML = '<div style="min-height:55vh;display:flex;align-items:center;justify-content:center;">' + MINI_RING_LOADER + '</div>';
  const pr = await api('/public/products');
  if (pr.status === 'success' && Array.isArray(pr.products)) STATE.products = pr.products;
  if (STATE.page !== 'assets') return; // navigated away while awaiting
  if (!hadProducts || previousProducts !== JSON.stringify(STATE.products)) paintAssets();
}
function assetRowHtml(p){
  const { expected, cycle, daily } = planFigures(p);
  const initial = esc(String(p.name || '?').trim()[0] || '?');
  const img = p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" onerror="this.outerHTML='&lt;div class=&quot;ar-glyph&quot;&gt;${initial}&lt;/div&gt;'">`
    : `<div class="ar-glyph">${initial}</div>`;
  return `
  <div class="asset-row">
    <div class="asset-thumb">${img}</div>
    <div class="asset-body">
      <div class="asset-name">${esc(p.name)}</div>
      <div class="asset-stats">
        <span>Cost <b class="mono">${fmtUGX(Number(p.price) || 0)}</b></span>
        <span>Term <b>${cycle} Days</b></span>
        <span>Daily Yield <b class="mono">${fmtUGX(daily)}</b></span>
        <span>Expected Return <b class="mono">${fmtUGX(expected)}</b></span>
      </div>
      ${productCtaHtml(p)}
    </div>
  </div>`;
}
function paintAssets(){
  const products = STATE.products || [];
  const html = `
<div class="member-page-title">Assets</div>
<div id="assetsBody" style="padding:0 10px;">
  ${products.length ? products.map(assetRowHtml).join('') : '<div class="list-empty">No assets yet.</div>'}
</div>
<div style="height:20px;"></div>`;
  $('pageHost').innerHTML = '<div class="reveal-in">' + html + '</div>';
  startProductCountdowns();
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
// Petro's compact triangle activity mark. It remains because the live payment
// polling screen still uses it as its processing indicator.
var PLAN_SPIN = '<span class="pspin" aria-hidden="true">'
  + '<span class="pspin-orbit"><i class="pspin-chip"></i><i class="pspin-chip"></i><i class="pspin-chip"></i></span>'
  + '<span class="pspin-glow"></span><span class="pspin-core"></span></span>';
// Payment polling has its own branded mark so the provider's legacy artwork
// can never leak onto this page. Keep the motion self-contained in CSS and
// leave the product-row PLAN_SPIN unchanged.
var DEPOSIT_POLL_SPIN = '<svg class="dep-poll-loader" viewBox="0 0 120 120" role="img" aria-label="Processing payment">'
  + '<circle class="dep-poll-track" cx="60" cy="60" r="50"/>'
  + '<circle class="dep-poll-arc dep-poll-arc-one" cx="60" cy="60" r="50"/>'
  + '<circle class="dep-poll-track" cx="60" cy="60" r="40"/>'
  + '<circle class="dep-poll-arc dep-poll-arc-two" cx="60" cy="60" r="40"/>'
  + '<circle class="dep-poll-track" cx="60" cy="60" r="30"/>'
  + '<circle class="dep-poll-arc dep-poll-arc-three" cx="60" cy="60" r="30"/>'
  + '<path class="dep-poll-drop" d="M60 41c-6.1 9-14 17.2-14 25.8a14 14 0 0 0 28 0C74 58.2 66.1 50 60 41Z"/>'
  + '<path class="dep-poll-highlight" d="M54.5 66.2c.5 3.7 2.7 5.8 6.4 6.2-1.3 1.7-3.2 2.6-5.2 2.3-3.4-.6-5.5-3.6-5.1-7 .2-1.6 1.2-3.2 2.8-4.7.2 1.1.6 2.2 1.1 3.2Z"/>'
  + '</svg>';
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
  const name = inv.tierLabel || p.name || 'Asset';
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
    return '<div class="my-assets-empty">Could not load your assets.</div>';
  }
  if (!investments.length) return '<div class="my-assets-empty">No investments yet. Browse Assets to get started.</div>';
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
window.switchTeamLevel = async function(level){
  _activeTeamLevel = level;
  document.querySelectorAll('.lv-switcher .lv').forEach(s => s.classList.toggle('on', Number(s.dataset.level)===level));
  // Keep the Commission Rate card in step with the selected level -- it
  // shows that level's own rate and member count in the mockup, not L1's.
  const t = STATE.teamStats || {}, rates = t.commRates || {}, team = t.team || {};
  const setTxt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setTxt('teamCommLevelLabel', 'Level ' + level);
  setTxt('teamCommPct', (rates['l' + level] != null ? rates['l' + level] : 0) + '%');
  setTxt('teamCommMembers', ((team['l' + level]) || 0) + ' Members');
  if (!STATE.teamMembers[level]) {
    // The downline for a level that has not been fetched yet takes a real
    // round trip, and until this the box simply stayed as whatever the
    // PREVIOUS level had rendered -- so tapping Level 2 looked like Level 1's
    // members had been re-listed under a different heading, which is worse
    // than looking slow. Owner: "add the other loader ... while Loading users
    // on team of specific level ... it will be 4 triangles not Loading...".
    //
    // Painted BEFORE the await, and only for a level with nothing cached: a
    // level already in STATE.teamMembers renders instantly and a spinner that
    // flashes for one frame reads as a glitch.
    const box = $('teamMembersBox');
    if (box) box.innerHTML = teamLoadingHtml();
    const r = await api('/team/members?level=' + level);
    STATE.teamMembers[level] = r.status === 'success' ? r.members : [];
  }
  if (_activeTeamLevel === level) renderTeamMembers(level);
};
// The orbiting-chips mark, centred, while a list is in flight. PLAN_SPIN is
// the same markup the ongoing-plan rows and the payment page use -- every
// length inside it is a fraction of --s, so one mark serves 32px, 56px and
// 150px with no second copy and no second set of keyframes.
function teamLoadingHtml(){ return '<div class="list-loading">' + MINI_RING_LOADER + '</div>'; }
// The boot screen's own three-ring mark, reused small wherever a section
// needs an in-app "loading" indicator (Owner: "l need the other start up
// loader to be in navigation of loading so it will be smaller even") --
// same .ring-arc/ringSweep CSS, sized down via .mini-ring-loader. Carries
// its own #miniRingGrad def (same stops as the boot screen's #ringGrad)
// rather than pointing at that one -- see the CSS comment above
// .mini-ring-loader for why: a paint-server def only resolves reliably
// while its own ancestor isn't display:none, and #loadingScreen usually is.
var MINI_RING_LOADER = '<svg class="mini-ring-loader" viewBox="0 0 120 120" aria-hidden="true">'
  + '<defs><linearGradient id="miniRingGrad" x1="24" y1="104" x2="96" y2="16" gradientUnits="userSpaceOnUse">'
  + '<stop offset="0%" stop-color="#ff3b44"/><stop offset="55%" stop-color="#e30613"/><stop offset="100%" stop-color="#ffb000"/>'
  + '</linearGradient></defs>'
  + '<circle class="ring-arc ring-arc-1" cx="60" cy="60" r="52" pathLength="100"/>'
  + '<circle class="ring-arc ring-arc-2" cx="60" cy="60" r="45" pathLength="100"/>'
  + '<circle class="ring-arc ring-arc-3" cx="60" cy="60" r="38" pathLength="100"/>'
  + '</svg>';
function maskPhone(phone){
  const s = String(phone||'').replace(/\D/g,'');
  if (s.length < 7) return phone || '';
  // "756****0296" -- Team.dc.html's own shape: a few leading digits, four
  // stars, the last four. Enough to recognise your own referral, not enough
  // to be a usable number.
  return s.slice(0, s.length - 7) + '****' + s.slice(-4);
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
  if (!members.length) { box.innerHTML = '<div class="list-empty reveal-in">No members at this level yet.</div>'; return; }
  // Member card layout per Team.dc.html: avatar, masked phone, amount on the
  // right, join date and a "Total Purchase" footer line.
  //
  // Owner: "why the logo is empty?" -- because it was. Team.dc.html draws
  // these avatars as bare gradient discs and that is what got built: a
  // <div class="avatar"> with a background and no content at all. Every member
  // is deliberately anonymous here (the name is the literal "User" and the
  // phone is masked, so one member cannot harvest another's number), so there
  // is no per-person image to put in it and an empty disc just reads as a
  // picture that failed to load.
  //
  // Same chain as the Account profile card, so uploading a Brand logo once
  // lands here too: the uploaded logo, else the wordmark. The alternating
  // gradient stays as the backdrop behind both.
  const avatar = STATE.brandLogo
    ? `<img src="${esc(STATE.brandLogo)}" alt="" onerror="this.outerHTML=brandTextMark(44)">`
    : brandTextMark(44);
  box.innerHTML = '<div class="reveal-in">' + members.map((m,idx) => `
  <div class="team-member">
    <div class="top">
      <div class="avatar" style="background:${idx % 2 ? 'linear-gradient(135deg,#ffb000,#e30613)' : 'var(--petro-grad)'};">${avatar}</div>
      <div style="min-width:0;">
        <div class="name">User</div>
        <div class="phone mono">${esc(maskPhone(m.phone))}</div>
      </div>
      <div class="amt3 mono">${fmtUGXCents(m.invested || 0)}</div>
    </div>
    <!-- ONE "Joined", and joinedStamp() no longer carries its own, so the
         literal belongs here. The doubled "Joined Joined 1 day ago" came from
         the old timeAgo() returning a prefixed string AND this line adding
         another. The fallback keeps the word so a member with no recorded
         timestamp still reads as a sentence rather than a bare dash. -->
    <div class="joined">Joined ${esc(joinedStamp(m.createdAt) || 'recently')}</div>
    <div class="ln2"></div>
    <div class="foot">Total Purchase</div>
  </div>`).join('') + '</div>';
}

// ── NETWORK (owner's 3rd mockup round) ──
// Combines what used to be two separate tabs (Referral: code/link/rates;
// Team: stats/level-switcher/member list) into the one screen the mockup
// shows. renderTeam()/paintTeam()/switchTeamLevel() above are UNCHANGED and
// still back the old 'team' nav entry (still reachable while the bottom nav
// is still 6 tabs, not yet the mockup's 4) -- this reuses their same data
// (STATE.teamStats, STATE.teamMembers, /team/members) rather than
// duplicating the fetch logic, and reuses maskPhone()/joinedStamp() as-is.
var _earningsHidden = (function(){ try { return localStorage.getItem('petroEarnHidden') === '1'; } catch (_) { return false; } })();
window.toggleEarningsVisibility = function(){
  _earningsHidden = !_earningsHidden;
  try { localStorage.setItem('petroEarnHidden', _earningsHidden ? '1' : '0'); } catch (_) {}
  const amt = document.getElementById('netEarnAmt');
  if (amt) amt.textContent = _earningsHidden ? 'UGX ••••••' : fmtUGX(Number((STATE.teamStats || {}).teamCommission) || 0);
  const eye = document.getElementById('netEarnEyeBtn');
  if (eye) eye.innerHTML = _earningsHidden ? ICONS.eyeOff : ICONS.eyeOpen;
};
async function renderNetwork(){
  const hadCache = !!STATE.teamStats;
  const shareReady = refreshShareHost();
  if (hadCache) paintNetwork();
  else $('pageHost').innerHTML = '<div style="min-height:55vh;display:flex;align-items:center;justify-content:center;">' + MINI_RING_LOADER + '</div>';
  const [r] = await Promise.all([api('/team/stats'), shareReady]);
  if (r.status === 'success') STATE.teamStats = r;
  else if (!hadCache) STATE.teamStats = { referralCode:'', commRates:{l1:27,l2:2,l3:1}, team:{l1:0,l2:0,l3:0}, totalTeam:0, teamCommission:0, teamDeposits:0 };
  if (STATE.page !== 'network') return;
  paintNetwork();
}
// Client-side mirror of the server's own tsMillis() -- createdAt arrives as
// an ISO string (see server.js's Date -> JSON serialization), and this file
// has no existing "parse either shape" helper for it outside joinedStamp(),
// which returns a formatted STRING, not a sortable number.
function paintNetwork(){
  const t = STATE.teamStats || { referralCode:'', commRates:{l1:27,l2:2,l3:1}, team:{l1:0,l2:0,l3:0}, totalTeam:0, teamCommission:0, teamDeposits:0 };
  const rates = t.commRates || {};
  const a = STATE.account || {};
  const code = a.referralCode || t.referralCode || '';
  const link = code ? `${shareOrigin()}/?ref=${encodeURIComponent(code)}` : '';
  const earnText = _earningsHidden ? 'UGX ••••••' : fmtUGX(Number(t.teamCommission) || 0);
  const html = `
<div class="member-page-title">Network</div>
<div class="net-simple">
  <section class="net-section net-invite-section">
    <div class="net-section-title">Invite</div>
  <div class="net-invite-line">
    <div><span>Invitation code</span><b class="mono">${esc(code || '—')}</b></div>
    <button data-copy-group="net" onclick="copyText('${esc(code)}')" aria-label="Copy invitation code">${ICONS.copy}</button>
  </div>
  <div class="net-invite-line">
    <div><span>Invitation link</span><b class="net-link">${esc(link || '—')}</b></div>
    <button data-copy-group="net" onclick="copyText('${esc(link)}')" aria-label="Copy invitation link">${ICONS.copy}</button>
  </div>
  </section>

  <section class="net-section">
    <div class="net-section-title">Team</div>
  <div class="net-levels">
    <div><b class="mono">${(t.team && t.team.l1) || 0}</b><span>Level 1</span><small>${rates.l1 != null ? rates.l1 : 27}%</small></div>
    <div><b class="mono">${(t.team && t.team.l2) || 0}</b><span>Level 2</span><small>${rates.l2 != null ? rates.l2 : 2}%</small></div>
    <div><b class="mono">${(t.team && t.team.l3) || 0}</b><span>Level 3</span><small>${rates.l3 != null ? rates.l3 : 1}%</small></div>
  </div>
  </section>

  <section class="net-section net-earn-section">
    <div class="net-section-title">Earnings</div>
  <div class="net-earn-simple">
    <div>
      <span>Referral earnings</span>
      <b class="mono" id="netEarnAmt">${esc(earnText)}</b>
    </div>
    <div class="net-earn-actions">
      <button id="netEarnEyeBtn" onclick="toggleEarningsVisibility()" aria-label="Show or hide earnings">${_earningsHidden ? ICONS.eyeOff : ICONS.eyeOpen}</button>
      <button onclick="openAllReferralsSheet()">View team</button>
    </div>
  </div>
  </section>

  ${taskCenterHtml(t)}
</div>
<div style="height:20px;"></div>`;
  $('pageHost').innerHTML = '<div class="reveal-in">' + html + '</div>';
}

function taskCenterCardsHtml(type, progress, milestones){
  const isDeposit = type === 'deposit';
  return (milestones || []).filter(m => m.type === type).map(m => {
    const target = Number(m.target) || 0;
    const current = Number(progress) || 0;
    const targetText = isDeposit ? fmtUGX(target) : String(target);
    const currentText = isDeposit ? fmtUGX(current) : String(current);
    const label = isDeposit ? 'Team deposit' : 'Level 1 active referrals';
    const button = m.claimed
      ? '<button class="secondary-button" disabled style="min-width:88px;padding:10px 12px;opacity:.72;">Claimed</button>'
      : m.achieved
        ? `<button class="primary-button" onclick="claimTaskCenterReward('${type}',${target},this)" style="min-width:88px;padding:10px 12px;">Claim</button>`
        : '<button class="secondary-button" disabled style="min-width:88px;padding:10px 12px;opacity:.62;">Claim</button>';
    return `<article class="task-center-card">
      <div class="task-card-top"><span class="task-card-kind">${label}</span><b class="mono task-card-reward">${fmtUGX(Number(m.reward) || 0)}</b></div>
      <div class="task-card-target">${targetText}</div>
      <div class="task-card-bottom"><span class="task-card-progress">Progress: ${currentText} / ${targetText}</span>${button}</div>
    </article>`;
  }).join('');
}
function taskCenterHtml(t){
  const l1 = Number(t.l1ActiveCount) || 0;
  const deposits = Number(t.teamDeposits) || 0;
  return `<section id="taskCenter" class="task-center">
    <div class="task-center-heading"><div><div class="net-section-title">Task Center</div><b>Earn from team progress</b></div></div>
    <p class="task-center-note">Referral tasks unlock only after your direct Level 1 referral makes a deposit. Every completed task is claimable once.</p>
    <div class="task-category"><div class="task-category-title">Referral tasks</div><div class="task-center-grid">${taskCenterCardsHtml('count', l1, t.milestones)}</div></div>
    <div class="task-category"><div class="task-category-title">Deposit tasks</div><div class="task-center-grid">${taskCenterCardsHtml('deposit', deposits, t.milestones)}</div></div>
  </section>
`;
}
window.openTaskCenter = function(){
  const el = $('taskCenter');
  if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
};
window.claimTaskCenterReward = async function(type, target, btn){
  if (btn && btn.disabled) return;
  const prior = btn && btn.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Claiming…'; }
  const r = await api('/team/milestone/claim', { method:'POST', body:JSON.stringify({ type, target }) });
  if (r.status !== 'success') {
    if (btn) { btn.disabled = false; btn.textContent = prior || 'Claim'; }
    notify(r.message || 'Could not claim that reward');
    return;
  }
  const fresh = await api('/team/stats');
  if (fresh.status === 'success') STATE.teamStats = fresh;
  if (STATE.page === 'network') paintNetwork();
  notify(r.message || 'Reward added to your wallet');
};

window.openAllReferralsSheet = function(){
  openSheet('All Referrals', `
<div class="lv-switcher" style="margin-bottom:14px;">
  <button class="lv on" data-level="1" onclick="switchTeamLevel(1)">Level 1</button>
  <button class="lv" data-level="2" onclick="switchTeamLevel(2)">Level 2</button>
  <button class="lv" data-level="3" onclick="switchTeamLevel(3)">Level 3</button>
</div>
<div id="teamMembersBox">${teamLoadingHtml()}</div>`);
  switchTeamLevel(1);
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
var COPY_CLIP = ICONS.copy;
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

// ── ACCOUNT ──
// Account.dc.html: a profile card (admin logo, member ID, phone, wallet
// balance, Deposit/Withdraw) sitting above a plain white SETTINGS list and
// a black Log Out button. Deliberately NOT Snow's coloured card matrix --
// see CLAUDE.md's "Structural differences from Snow".
//
// The wallet balance lives HERE, not on Home (the mockups put it on this
// screen only), which is why patchHomeBalances()'s live tick targets
// #acctWallet.
// New Account/Network row style (owner's mockups): a coloured CIRCLE with a
// real SVG glyph, not settingRowHtml()'s coloured SQUARE + Petro raster PNG.
// Kept as its own helper rather than changing settingRowHtml() in place --
// that one still backs whatever of the old settings list isn't part of the
// new Account screen (nothing, as of this round, but changing a shared
// helper's visual contract under call sites this file isn't touching today
// is exactly the kind of change that should be its own deliberate pass).
function acctRowHtml(svgIcon, colorClass, title, sub, onclick){
  return `
  <button class="acct-row" onclick="${onclick}">
    <span class="ar-ic ${colorClass}">${svgIcon}</span>
    <span class="txt"><span class="t1">${title}</span><span class="t2">${sub}</span></span>
    ${ICONS.chevronRight}
  </button>`;
}
function acctGridCardHtml(iconName, title, onclick){
  return '<button class="acct-grid-card" onclick="' + onclick + '">' +
    '<span class="acct-grid-icon">' + suppliedMemberIcon(iconName) + '</span>' +
    '<span class="txt"><span class="t1">' + title + '</span></span>' +
  '</button>';
}
function acctListCardHtml(iconName, title, onclick){
  const icon = iconName === 'accountRules' ? ICONS.rulesGavel : suppliedMemberIcon(iconName);
  return '<button class="acct-list-card" onclick="' + onclick + '">' +
    '<span class="acct-list-icon">' + icon + '</span>' +
    '<span class="acct-list-label">' + title + '</span>' + ICONS.chevronRight +
  '</button>';
}
// Same acct-list-card shell as acctListCardHtml(), but the icon is a real
// <img> against the app's own uploaded icon (/public/app-icon-192.png) --
// suppliedMemberIcon()'s named CSS-mask icons only cover fixed artwork, not
// an admin-replaceable photo. Owner: "app icon will be uploaded from admin
// panel" -- promptInstallApp() is the existing PWA-install trigger, unchanged.
// The <img> has an onerror fallback to a generic download glyph, same
// pattern renderAccount()'s own accountBrandLogo/accountBrandFallback pair
// uses just above -- API_BASE is still the VPS's bare-HTTP address (see
// CLAUDE.md's "Hosting" section), which this page's own CSP img-src
// (deliberately kept self/data/blob/https-only, not loosened for this one
// icon -- see test-csp-runtime.py's own note) will refuse to load until the
// real HTTPS domain cutover, so the icon degrades instead of showing broken.
function downloadAppRowHtml(){
  return '<button class="acct-list-card" onclick="promptInstallApp()">' +
    '<span class="acct-list-icon">' +
      '<img src="' + API_BASE + '/public/app-icon-192.png" alt="" style="width:34px;height:34px;border-radius:9px;object-fit:cover;" onerror="this.style.display=\'none\';var f=this.nextElementSibling;if(f)f.style.display=\'flex\';">' +
      '<span class="download-app-fallback" style="display:none;width:40px;height:40px;align-items:center;justify-content:center;">' + ICONS.downloadApp + '</span>' +
    '</span>' +
    '<span class="acct-list-label">Download App</span>' + ICONS.chevronRight +
  '</button>';
}
function settingRowHtml(icon, title, sub, onclick){
  const rowIcons = {
    download: ICONS.download,
    wallet: ICONS.walletLg,
    turntable: ICONS.wheel,
    balance: ICONS.docLg,
    messages: ICONS.envelope,
    loginpw: ICONS.lock,
    tradepw: ICONS.keyIcon,
    language: ICONS.globe || ICONS.gear
  };
  return `
  <button class="setting-row" onclick="${onclick}">
    <span class="sq ic-${icon}">${rowIcons[icon] || ICONS.gear}</span>
    <span class="txt"><span class="t1" style="display:block;">${title}</span><span class="t2" style="display:block;">${sub}</span></span>
    <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"></path></svg>
  </button>`;
}
window.openSecuritySettingsSheet = function(){
  openChangeLoginPasswordSheet();
};
// Rebuilt to the owner's Account mockup -- a profile card over an
// admin-uploadable refinery photo (new 'profilecard' image slot, same
// PETRO_IMAGE_SLOTS mechanism as logo/authhero/etc.) and a plain row list
// with coloured-circle SVG icons replacing the old settings list's coloured
// squares + Petro raster PNGs.
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
async function renderAccount(){
  const a = STATE.account || {};
  const html = `
<div class="account-page" style="padding:0 10px;">
  <div class="member-page-title">Profile</div>
  <div class="acct-card"${STATE.profileCard ? ` style="--acct-card-image:url('${esc(STATE.profileCard)}')"` : ''}>
    <div class="acct-avatar">
      <span id="accountBrandFallback" class="acct-avatar-fallback" style="display:${STATE.brandLogo ? 'none' : 'flex'}">${ICONS.peopleGroup}</span>
      <img id="accountBrandLogo" class="acct-avatar-logo" alt=""${STATE.brandLogo ? ` src="${esc(STATE.brandLogo)}"` : ''} style="display:${STATE.brandLogo ? 'block' : 'none'}" onerror="this.style.display='none';var f=document.getElementById('accountBrandFallback');if(f)f.style.display='flex'">
    </div>
    <div class="acct-idbox">
      <div class="acct-phone-row">${esc(formatPhoneDisplay(a.phone))}</div>
    </div>
  </div>
  <div class="account-money-actions">
    <button class="account-money-action" onclick="openDepositSheet()"><span>${suppliedMemberIcon('deposit')}</span>Deposit</button>
    <button class="account-money-action" onclick="openWithdrawSheet()"><span>${suppliedMemberIcon('withdraw')}</span>Withdraw</button>
  </div>
  <div class="account-action-list">
    ${acctListCardHtml('accountWallet', 'Payout Wallet', 'openWalletSheet()')}
    ${acctListCardHtml('accountStatement', 'Transaction Statement', "openTransactionStatement('income')")}
    ${acctListCardHtml('accountGift', 'Gift Codes', 'openChestSheet()')}
    ${acctListCardHtml('accountRules', 'Rules and Regulations', 'openRulesSheet()')}
    ${acctListCardHtml('accountSecurity', 'Security Settings', 'openChangeLoginPasswordSheet()')}
    ${acctListCardHtml('support', 'Support', 'openSupportSheet()')}
    ${acctListCardHtml('accountAbout', 'About Us', 'openAboutSheet()')}
    ${downloadAppRowHtml()}
  </div>
  <button class="logout-btn-v2" onclick="doLogout()">${ICONS.logoutArrow} Log Out</button>
  <div style="height:20px;"></div>
</div>`;
  $('pageHost').innerHTML = '<div class="reveal-in">' + html + '</div>';
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

// ── WALLET (Wallet.dc.html) ──
// ONE bound payout account, shown as a mobile-money status panel. "Edit Wallet"
// reveals the provider/account/holder form; Submit saves through the same
// /bank/save endpoint the app already had, and because Petro binds exactly
// one wallet, saving a second one replaces the first (any older rows are
// deleted after the new one lands). Not Snow's list-of-many model.
var _walletEditing = false;
window.openWalletSheet = async function(){
  const hadCache = Array.isArray(STATE.bankAccounts);
  _walletEditing = hadCache ? !(STATE.bankAccounts || []).length : false;
  openSheet('Wallet', hadCache ? '' : '<div class="list-empty">Loading&hellip;</div>');
  if (hadCache) renderWalletSheet();
  // Fetched alongside the bound-wallet list, not awaited together with it --
  // a slow/failed bank list must never hold up showing the existing wallet
  // (or the empty-state add form); it only widens the provider picker once
  // it lands. Cached on STATE for the lifetime of the tab, same as
  // products/settings -- this rarely changes and re-fetching on every
  // sheet open buys nothing.
  if (!Array.isArray(STATE.supportedBanks)) {
    api('/bank/supported-banks').then(br => {
      STATE.supportedBanks = br.status === 'success' && Array.isArray(br.banks) ? br.banks : [];
      if (_openSheetTitle === 'Wallet' && _walletEditing) renderWalletSheet();
    }).catch(() => { STATE.supportedBanks = STATE.supportedBanks || []; });
  }
  const r = await api('/bank/list');
  if (r.status === 'success') STATE.bankAccounts = r.accounts;
  else if (!hadCache) STATE.bankAccounts = [];
  if (!hadCache) {
    _walletEditing = !(STATE.bankAccounts || []).length;
    if (_openSheetTitle === 'Wallet') renderWalletSheet();
  } else if (!_walletEditing && _openSheetTitle === 'Wallet') {
    // A linked-wallet display has no focused input to destroy, so it is safe
    // to refresh. When the add form is visible, do NOT repaint it under the
    // member's finger: replacing #walPhone after focus is exactly what makes
    // Android's keyboard appear late or fail to stay open.
    renderWalletSheet();
  }
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
function walletCardHtml(w){
  const provider = w && w.network ? String(w.network).replace(/\s*(Mobile )?Money$/i, '') : 'Mobile Money';
  return `<div class="wallet-card"><div class="wallet-kicker">Payout Wallet</div>
    <div class="num"${w ? '' : ' style="font-size:18px"'}>${w ? esc(walletDestDisplay(w)) : 'No payout wallet linked'}</div>
    <div class="wallet-meta">
      ${w ? `<div class="meta-item"><span>Account holder</span><b>${esc(String(w.holder || '').toUpperCase())}</b></div>` : ''}
      <div class="meta-item"><span>Network</span><b>${w ? esc(provider) : '—'}</b></div>
    </div></div>`;
}
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
function walletPlainRowHtml(w){
  if (!w) return '';
  const network = String(w.network || 'Mobile Money').replace(/\s*(Mobile )?Money$/i, '') || 'Mobile Money';
  return `
  <div class="wallet-plain-row">
    <div class="wallet-plain-copy">
      <div class="wallet-plain-number mono">${esc(walletDestDisplay(w))}</div>
      <div class="wallet-plain-name">${esc(String(w.holder || '').toUpperCase())}</div>
      <div class="wallet-plain-network">${esc(network)}</div>
    </div>
    <button class="wallet-delete" type="button" onclick="deleteWallet('${esc(w.id)}')" aria-label="Delete payout wallet">${ICONS.trash}</button>
  </div>`;
}
function renderWalletSheet(){
  const w = currentWallet();
  // Owner: "add all supported banks so withdrawals will also be processed
  // through banks... mtn and airtel will also be there." Banks are appended
  // after the two mobile-money options, not in place of them -- fetched
  // live by openWalletSheet() and cached on STATE.supportedBanks; empty
  // until that lands (or if MarzPay's bank-transfer product isn't
  // reachable/subscribed), in which case the picker just shows the two
  // mobile-money options exactly as it always has.
  const providers = ['MTN Mobile Money', 'Airtel Money', ...(STATE.supportedBanks || [])];
  if (w && !_walletEditing) {
    $('sheetBody').innerHTML = '<div class="wallet-minimal reveal-in">' + walletPlainRowHtml(w) + '</div>';
    return;
  }
  const editingBank = w && !isMobileMoneyNetwork(w.network);
  $('sheetBody').innerHTML = `<div class="wallet-minimal reveal-in">
    <div class="wallet-add-form" id="walFormGroup">
      <div class="prov-pick" id="walProviderPick">
        <div class="wallet-line-field prov-input" onclick="toggleProviderList()">
          <input id="walProvider" type="text" readonly placeholder="Select network or bank" value="${w && w.network ? esc(w.network) : ''}">
          <svg class="prov-caret" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </div>
        <div class="prov-list" id="walProviderList">
          ${providers.map(p => `<button type="button" class="prov-opt${w && w.network === p ? ' on' : ''}" onclick="pickProvider('${esc(p)}')">${esc(p)}</button>`).join('')}
        </div>
      </div>
      <div class="wallet-line-field">
        <input id="walPhone" type="${editingBank ? 'text' : 'tel'}" inputmode="${editingBank ? 'text' : 'numeric'}" autocomplete="${editingBank ? 'off' : 'tel'}" enterkeyhint="next" placeholder="${editingBank ? 'Account number' : 'Phone number'}" value="${w ? esc(walletDestDisplay(w)) : ''}" oninput="handleWalDestInput(this)">
      </div>
      <div class="wallet-line-field"><input id="walHolder" type="text" autocomplete="name" enterkeyhint="done" placeholder="Account holder name" value="${w ? esc(w.holder || '') : ''}"></div>
      <button class="primary-button wallet-save" id="walSaveBtn" onclick="submitWallet()">Save</button>
    </div>
    <div id="walOtpGroup" style="display:none;">
      <div class="wallet-line-field"><input id="walOtp" type="tel" inputmode="numeric" maxlength="6" placeholder="6-digit code" autocomplete="one-time-code"></div>
      <div class="wallet-otp-actions">
        <button type="button" onclick="cancelWalletOtp()">Back</button>
        <button class="primary-button" id="walConfirmBtn" onclick="confirmWalletOtp()">Confirm</button>
      </div>
      <a href="#" id="walResendBtn" onclick="submitWallet();return false;">Resend code</a>
    </div>
  </div>`;
}
window.toggleWalletEdit = function(on){ _walletEditing = !!on; _walletPending = null; _walletOtpId = null; renderWalletSheet(); };
// The provider list from the mockup: tap the field, a plain list drops under
// it, tap a row, it closes. Deliberately small and self-contained -- the
// alternative was a native <select>, which on Android replaces the screen
// with the OS picker.
window.toggleProviderList = function(){
  const box = $('walProviderPick');
  if (box) box.classList.toggle('open');
};
window.pickProvider = function(name){
  const inp = $('walProvider');
  const prevValue = inp ? inp.value : '';
  if (inp) inp.value = name;
  const box = $('walProviderPick');
  if (box) box.classList.remove('open');
  document.querySelectorAll('#walProviderList .prov-opt').forEach(b => {
    b.classList.toggle('on', b.textContent.trim() === name);
  });
  const nowBank = !isMobileMoneyNetwork(name);
  const dest = $('walPhone');
  if (dest) {
    dest.type = nowBank ? 'text' : 'tel';
    dest.inputMode = nowBank ? 'text' : 'numeric';
    dest.autocomplete = nowBank ? 'off' : 'tel';
    dest.placeholder = nowBank ? 'Account number' : 'Phone number';
    // Crossing the mobile-money/bank boundary means whatever was already
    // typed can never be valid for the new type (a phone number is not a
    // bank account number, and vice versa) -- cleared so a member cannot
    // accidentally submit one as the other. Switching within the same type
    // (MTN <-> Airtel, or one bank <-> another) leaves it alone, unchanged
    // from how this already worked before banks existed here.
    const wasBank = prevValue ? !isMobileMoneyNetwork(prevValue) : nowBank;
    if (wasBank !== nowBank) dest.value = '';
  }
};
// The one oninput handler for #walPhone regardless of what is currently
// selected -- checks the CURRENT provider each keystroke rather than
// needing pickProvider() to swap handlers. Mobile money still gets the
// digit-only, region-length-capped treatment sanitizePhoneInput() already
// did; a bank account number gets neither (owner: "some bank account
// exceed character limit so no capping of characters please") -- just
// trimmed of accidental whitespace, everything else passed through as typed.
window.handleWalDestInput = function(el){
  if (isMobileMoneyNetwork(($('walProvider') || {}).value)) { sanitizePhoneInput(el); return; }
  if (/\s/.test(el.value)) el.value = el.value.replace(/\s+/g, '');
};
// Tapping anywhere else closes it, the way a real picker behaves. Bound once
// on the document rather than per-render so repainting the panel cannot leave
// duplicate listeners behind.
document.addEventListener('click', function(e){
  const box = document.getElementById('walProviderPick');
  if (box && box.classList.contains('open') && !box.contains(e.target)) box.classList.remove('open');
});
// Adding/changing the payout wallet used to always require an OTP first
// (prove it's really the account holder, sent to THEIR OWN phone on file,
// never to the wallet number being entered above). Owner: "remove otp on
// withdrawal bank account... it should be optional" -- now admin-controlled
// via STATE.settings.bankOtpRequired (default off, see server.js). Off:
// submitWallet() saves straight away. On: same two-phase OTP flow as
// before, kept in these two closure vars rather than re-rendering the sheet
// between them -- a re-render would wipe whatever the member just typed
// into walProvider/walPhone/walHolder.
var _walletPending = null;
var _walletOtpId = null;
window.submitWallet = async function(){
  const network = $('walProvider').value;
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
  if (!(STATE.settings || {}).bankOtpRequired) {
    btn.disabled = true; btn.textContent = 'Saving…';
    const r = await post('/bank/save', { holder, network, phone });
    btn.disabled = false; btn.textContent = 'Submit';
    if (r.status !== 'success') return notify(r.message || 'Could not save your wallet.');
    return finishWalletSave();
  }
  btn.disabled = true; btn.textContent = 'Sending code…';
  const d = await post('/auth/otp/send', { purpose: 'bank' });
  btn.disabled = false; btn.textContent = 'Submit';
  if (d.status !== 'success') return notify(d.message || 'Could not send a verification code.');
  _walletPending = { holder, network, phone };
  _walletOtpId = d.otpId;
  const otpInput = $('walOtp'); if (otpInput) otpInput.value = '';
  const formGroup = $('walFormGroup'), otpGroup = $('walOtpGroup');
  if (formGroup) formGroup.style.display = 'none';
  if (otpGroup) otpGroup.style.display = '';
  startOtpResendCooldown('walResendBtn', 30, 'Resend code');
};
window.cancelWalletOtp = function(){
  _walletPending = null; _walletOtpId = null;
  const formGroup = $('walFormGroup'), otpGroup = $('walOtpGroup');
  if (otpGroup) otpGroup.style.display = 'none';
  if (formGroup) formGroup.style.display = '';
};
window.confirmWalletOtp = async function(){
  if (!_walletPending || !_walletOtpId) return cancelWalletOtp();
  const code = ($('walOtp').value || '').trim();
  if (!/^\d{6}$/.test(code)) return notify('Enter the 6-digit code sent to your phone.');
  const btn = $('walConfirmBtn');
  btn.disabled = true; btn.textContent = 'Verifying…';
  const v = await post('/auth/otp/verify', { otpId: _walletOtpId, code });
  if (v.status !== 'success') { btn.disabled = false; btn.textContent = 'Confirm'; return notify(v.message || 'Incorrect code.'); }
  btn.textContent = 'Saving…';
  const r = await post('/bank/save', Object.assign({}, _walletPending, { otpTicket: v.ticket }));
  btn.disabled = false; btn.textContent = 'Confirm';
  if (r.status !== 'success') return notify(r.message || 'Could not save your wallet.');
  _walletPending = null; _walletOtpId = null;
  await finishWalletSave();
};
// Shared tail of a successful /bank/save, whether it came from the OTP flow
// above or straight from submitWallet() when bankOtpRequired is off.
async function finishWalletSave(){
  // Petro binds exactly ONE wallet -- drop any older rows so the card, the
  // summary row and the Withdraw screen can never disagree about which
  // account a payout goes to.
  const list = await api('/bank/list');
  let accounts = list.status === 'success' ? list.accounts : [];
  const keep = accounts[accounts.length - 1];
  for (const acc of accounts) {
    if (keep && acc.id === keep.id) continue;
    await post('/bank/delete', { id: acc.id });
  }
  const fresh = await api('/bank/list');
  STATE.bankAccounts = fresh.status === 'success' ? fresh.accounts : (keep ? [keep] : []);
  _walletEditing = false;
  notify('Wallet saved');
  if (_openSheetTitle === 'Wallet') renderWalletSheet();
}
window.deleteWallet = function(id){
  if (!id) return;
  openSimpleConfirm('Delete wallet', 'Remove this payout number?', async () => {
    const r = await post('/bank/delete', { id });
    if (r.status !== 'success') { notify(r.message || 'Could not remove the wallet.'); return false; }
    STATE.bankAccounts = (STATE.bankAccounts || []).filter(x => x.id !== id);
    _walletEditing = true;
    if (_openSheetTitle === 'Wallet') renderWalletSheet();
    return true;
  });
};

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
  _notifyOnClose = typeof onClose === 'function' ? onClose : null;
  $('notifyBg').classList.add('show');
  // Auto-dismisses on its own (a toast, not a dialog the member must
  // acknowledge) -- tapping it early still works via closeNotify() on the
  // card's own onclick, which clears this same timer first.
  if (_notifyTimer) clearTimeout(_notifyTimer);
  _notifyTimer = setTimeout(closeNotify, 2200);
};
window.closeNotify = function(){
  if (_notifyTimer) { clearTimeout(_notifyTimer); _notifyTimer = null; }
  $('notifyBg').classList.remove('show');
  const fn = _notifyOnClose;
  _notifyOnClose = null;
  if (fn) fn();
};

// ── TRANSACTION STATEMENT ──
// One professional statement surface. Categories stay horizontal at the top;
// no balance hero, avatar discs, record cards or separate deposit/withdraw/
// earnings screens.
var _statementCat = 'income';
var STATEMENT_INCOME_TYPES = new Set([
  'cashback','commission','team_reward','promocode','checkin','welcome_bonus',
  'mission_salary','mission_deposit_reward','turntable','spin','spin_bonus',
  'admin_credit'
]);
function statementCategoryMatch(cat, t){
  if (cat === 'deposit') return t.type === 'deposit';
  if (cat === 'withdraw') return t.type === 'withdraw';
  return STATEMENT_INCOME_TYPES.has(t.type);
}
function statementDescription(t){
  if (t.type === 'deposit') return 'Deposit';
  if (t.type === 'withdraw') return 'Withdrawal';
  if (t.type === 'cashback') return 'Daily Income';
  if (t.type === 'commission') return 'Referral Commission';
  if (t.type === 'promocode') return 'Gift Code';
  if (t.type === 'checkin') return 'Check-in Reward';
  if (t.type === 'welcome_bonus') return 'Welcome Bonus';
  if (t.type === 'team_reward') return 'Team Reward';
  if (t.type === 'mission_salary') return 'Mission Salary';
  if (t.type === 'mission_deposit_reward') return 'Mission Reward';
  if (t.type === 'turntable' || t.type === 'spin' || t.type === 'spin_bonus') return 'Reward';
  if (t.type === 'admin_credit') return brandName() + ' Credit';
  return 'Transaction';
}
function statementStatus(t){
  const rawStatus = String(t.status || '').toLowerCase();
  const desc = String(t.description || '').toLowerCase();
  const raw = rawStatus + ' ' + desc;
  if (/fail|declin|reject|cancel|error/.test(raw)) return { text:'Failed', cls:'failed' };
  if (/pend|process|await|initiating/.test(raw)) return { text:'Pending', cls:'pending' };
  return { text:'Completed', cls:'completed' };
}
function statementDate(t){
  const d = String(t.date || '');
  const parts = d.split('/');
  const date = parts.length === 3 ? parts[1] + '/' + parts[0] + '/' + parts[2] : d;
  return (date + (t.time ? ' · ' + t.time : '')).trim();
}
function statementAmountText(t){
  const amt = recordsRowAmount(t);
  const sign = amt < 0 ? '−' : '+';
  return sign + fmtUGXCents(Math.abs(amt));
}
function renderStatement(){
  const body = $('statementBody');
  if (!body) return;
  const rows = (STATE.transactions || []).filter(t => statementCategoryMatch(_statementCat, t));
  if (!rows.length) {
    body.innerHTML = '<div class="statement-empty">No transactions in this category.</div>';
    return;
  }
  const footer = STATE.transactionsTruncated
    ? '<div class="statement-end">Showing your most recent transactions</div>'
    : '<div class="statement-end">End of statement</div>';
  body.innerHTML = rows.map(t => {
    const st = statementStatus(t);
    const amt = recordsRowAmount(t);
    return `
      <article class="statement-row">
        <div class="statement-meta">
          <span class="statement-id mono">${esc(t.statementId || t.id || '—')}</span>
          <span class="statement-date">${esc(statementDate(t))}</span>
        </div>
        <div class="statement-main">
          <div class="statement-desc">${esc(statementDescription(t))}</div>
          <div class="statement-amount ${amt < 0 ? 'out' : 'in'}">${esc(statementAmountText(t))}</div>
        </div>
        <div class="statement-status ${st.cls}">${st.text}</div>
      </article>`;
  }).join('') + footer;
}
window.switchStatementCategory = function(cat){
  if (!['income','deposit','withdraw'].includes(cat)) return;
  _statementCat = cat;
  const tabs = $('statementTabs');
  if (tabs) tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
  renderStatement();
};
window.openTransactionStatement = async function(cat){
  _statementCat = ['income','deposit','withdraw'].includes(cat) ? cat : 'income';
  const hadCache = Array.isArray(STATE.transactions);
  openSheet('Transaction Statement', `
    <div class="statement-download-row">
      <button type="button" class="statement-download-btn" id="statementDownloadBtn" onclick="downloadStatementPdf()">${ICONS.download}<span>Download Statement</span></button>
    </div>
    <div class="statement-tabs" id="statementTabs">
      <button data-cat="income" class="${_statementCat==='income'?'on':''}" onclick="switchStatementCategory('income')">Income</button>
      <button data-cat="deposit" class="${_statementCat==='deposit'?'on':''}" onclick="switchStatementCategory('deposit')">Deposits</button>
      <button data-cat="withdraw" class="${_statementCat==='withdraw'?'on':''}" onclick="switchStatementCategory('withdraw')">Withdrawals</button>
    </div>
    <div class="statement-head" aria-hidden="true">
      <span>Transaction</span><span>Amount</span>
    </div>
    <div id="statementBody"></div>`);
  if (hadCache) renderStatement();
  else $('statementBody').innerHTML = '<div class="statement-empty">Loading statement…</div>';
  const r = await api('/transactions');
  if (r.status === 'success') {
    STATE.transactions = r.transactions;
    STATE.transactionsTruncated = !!r.truncated;
  } else if (!hadCache) {
    STATE.transactions = [];
  }
  if (_openSheetTitle === 'Transaction Statement') renderStatement();
};
// Owner: "put a server side advanced feature called download statement, so
// it downloads statement of the account as pdf." The PDF itself is built
// entirely server-side (GET /statement/pdf in server.js, via pdfkit) --
// this function only fetches the bytes and hands them to the browser. It
// deliberately does NOT go through api()/post(): those always call
// resp.json() on the response (see api()'s own comment on why -- every
// other endpoint in this app answers JSON), which would throw on a real
// PDF body. A raw fetch() with the same Bearer-token attachment api()
// does internally is used instead, and the response is read as a blob.
window.downloadStatementPdf = async function(){
  const btn = $('statementDownloadBtn');
  if (btn && btn.classList.contains('busy')) return; // already in flight
  if (btn) { btn.classList.add('busy'); }
  try {
    if (!(window.fbAuth && window.fbAuth.currentUser)) { notify('Please sign in again to download your statement.'); return; }
    const token = await window.fbAuth.currentUser.getIdToken();
    const resp = await fetch(API_BASE + '/statement/pdf', { headers: { Authorization: 'Bearer ' + token } });
    if (!resp.ok) {
      let msg = 'Could not generate your statement right now.';
      try { const j = await resp.json(); if (j && j.message) msg = j.message; } catch(_){}
      notify(msg);
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = brandName() + '-Statement.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Freed on a delay, not immediately: some browsers (notably older
    // Android WebViews) start the download/open handoff asynchronously
    // after click(), and revoking the URL too early can hand the file
    // picker a dead reference.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) {
    notify('Could not reach the server. Check your connection and try again.');
  } finally {
    if (btn) btn.classList.remove('busy');
  }
};
// Compatibility for post-withdraw flows and any stale call sites.
window.openBalanceRecordSheet = function(tab){
  const cat = tab === 'deposit' ? 'deposit' : tab === 'withdraw' ? 'withdraw' : 'income';
  return openTransactionStatement(cat);
};

// ── MESSAGES (MessagesList.dc.html / Messages.dc.html) ──
// Real inbox, backed by /messages (admin-authored broadcasts) with per-
// member read state. Snow has no equivalent -- see CLAUDE.md.
window.openMessagesSheet = async function(){
  const hadCache = Array.isArray(STATE.messages);
  openSheet('Messages', '<div id="msgBody"></div>');
  if (hadCache) renderMessagesList();
  else $('msgBody').innerHTML = '<div class="list-empty">Loading&hellip;</div>';
  const r = await api('/messages');
  if (r.status === 'success') STATE.messages = r.messages;
  else if (!hadCache) STATE.messages = [];
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
  if (!list.length) { box.innerHTML = '<div class="list-empty">No messages yet.</div>'; return; }
  box.innerHTML = '<div class="reveal-in">' + list.map((m, i) => `
    <button class="msg-row${m.read ? ' read' : ''}" onclick="openMessageDetail(${i})">
      <span class="av">C</span>
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
      <div class="av">C</div>
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
// Home's envelope button shows a dot while anything is unread. Kept in sync
// from whatever the last /messages fetch returned -- Home itself re-reads
// STATE.messages on every paint.
function unreadMessageCount(){ return (STATE.messages || []).filter(m => !m.read).length; }
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

// ── CHANGE LOGIN PASSWORD (ChangeLoginPassword.dc.html) ──
function pwLockSvg(){
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8c7f76" stroke-width="2" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>`;
}
function pwFieldHtml(id, placeholder, pin){
  return `<div class="pw-field${pin ? ' pin' : ''}">${pwLockSvg()}<input id="${id}" type="password" placeholder="${placeholder}"${pin ? ' inputmode="numeric" maxlength="6" autocomplete="one-time-code"' : ' autocomplete="off"'}></div>`;
}
window.openChangeLoginPasswordSheet = function(){
  openSheet('Security Settings', `<div class="pw-form reveal-in">
    <div class="pw-form-heading"><span class="pw-heading-icon">${pwLockSvg()}</span><div><h3>Change login password</h3><p>Protect your ${esc(brandName())} account with a new password.</p></div></div>
    <div class="pw-form-fields">
    <label class="pw-label" for="lpOld">Current password</label>
    ${pwFieldHtml('lpOld', 'Enter old password')}
    <label class="pw-label" for="lpNew">New password</label>
    ${pwFieldHtml('lpNew', 'Enter new password')}
    <label class="pw-label" for="lpNew2">Confirm new password</label>
    ${pwFieldHtml('lpNew2', 'Re-enter new password')}
    </div>
    <button class="primary-button" id="lpSaveBtn" style="width:100%;height:54px;padding:0;font-size:17px;letter-spacing:.06em;" onclick="submitLoginPasswordChange()">SAVE LOGIN PASSWORD</button>
  </div>`);
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
  btn.disabled = true; btn.textContent = 'SAVING…';
  try {
    await window.fbChangePassword(phoneToEmail((STATE.account || {}).phone), oldPass, newPass);
    btn.disabled = false; btn.textContent = 'SAVE LOGIN PASSWORD';
    closeSheet({ fromAction: true });
    notify('Login password changed');
  } catch (e) {
    btn.disabled = false; btn.textContent = 'SAVE LOGIN PASSWORD';
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
// The 6-digit PIN that confirms withdrawals. Petro uses 6 digits where Snow
// used 5 -- server.js validates the same length on /account/transaction-pin/change.
window.openChangeTradePasswordSheet = function(){
  openSheet('Trade Password', `<div class="reveal-in" style="padding-top:22px;">
    <p class="pw-note">Your trade password is your 6-digit PIN used to confirm withdrawals and other sensitive actions.</p>
    <div class="pw-head"><span class="bar"></span><span>Old Trade Password</span></div>
    ${pwFieldHtml('tpOld', 'Enter old 6-digit PIN', true)}
    <div class="pw-head"><span class="bar"></span><span>New Trade Password</span></div>
    ${pwFieldHtml('tpNew', 'Enter new 6-digit PIN', true)}
    <div class="pw-head"><span class="bar"></span><span>Confirm New Password</span></div>
    ${pwFieldHtml('tpNew2', 'Re-enter new 6-digit PIN', true)}
    <button class="primary-button" id="tpSaveBtn" style="width:100%;height:54px;padding:0;font-size:17px;letter-spacing:.06em;" onclick="submitTradePasswordChange()">SAVE TRADE PASSWORD</button>
  </div>`);
};
window.submitTradePasswordChange = async function(){
  const oldPin = $('tpOld').value.trim();
  const newPin = $('tpNew').value.trim();
  const confirm = $('tpNew2').value.trim();
  if (!/^\d{6}$/.test(oldPin)) return notify('Enter your current 6-digit trade password.');
  if (!/^\d{6}$/.test(newPin)) return notify('Your new trade password must be exactly 6 digits.');
  if (newPin !== confirm) return notify('The two new trade passwords do not match.');
  if (newPin === oldPin) return notify('Your new trade password must be different from the old one.');
  const btn = $('tpSaveBtn');
  btn.disabled = true; btn.textContent = 'SAVING…';
  const r = await post('/account/transaction-pin/change', { oldPin, newPin });
  btn.disabled = false; btn.textContent = 'SAVE TRADE PASSWORD';
  if (r.status !== 'success') return notify(r.message || 'Could not change your trade password.');
  closeSheet({ fromAction: true });
  notify('Trade password changed');
};

// ── TREASURE CHEST (Chest.dc.html / ChestSuccess.dc.html) ──
// The bouncing chest on Home opens this full screen: glowing ring, bouncing
// chest artwork, key field, OPEN CHEST. A valid key flashes the green
// full-screen win state with the amount won and the new balance.
window.openChestSheet = function(){
  openSheet('Gift Codes', `<div class="reveal-in gift-code-stage">
    <div class="gift-code-mark" aria-hidden="true">${GIFT_CODE_REFERENCE_SVG}</div>
    <h2>Redeem Gift Code</h2>
    <p class="sub">Enter a valid gift code to add its reward to your balance.</p>
    <div style="width:100%;">
      <div class="key-field"><input id="chestKey" type="text" placeholder="Enter gift code" maxlength="14" autocapitalize="off" autocomplete="off" spellcheck="false"></div>
      <button class="primary-button" id="chestOpenBtn" style="width:100%;height:54px;padding:0;font-size:16px;letter-spacing:.06em;" onclick="submitChestKey()">REDEEM CODE</button>
    </div>
  </div>`);
};
window.submitChestKey = async function(){
  // No case-forcing here -- /redeem matches case-insensitively via
  // codeLower now, so whatever case the member typed or pasted reaches
  // the server unchanged and still resolves to the same code.
  const raw = ($('chestKey').value || '').trim();
  // Owner named these two exactly: "so on 'please enter the treasure chest
  // key', 'wrong treasure chest password'."
  if (!raw) return notify('Please enter a gift code');
  const btn = $('chestOpenBtn');
  btn.disabled = true; btn.textContent = 'REDEEMING…';
  const r = await post('/redeem', { code: raw });
  btn.disabled = false; btn.textContent = 'REDEEM CODE';
  if (r.status !== 'success') return notify(r.message || 'That gift code could not be redeemed.');
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
  closeSheet({ fromAction: true });
  showChestWin(reward, before, after);
  // Now catch the app up, behind the card the member is already reading.
  refreshAfterWin();
};
// The two network refreshes a win needs, moved off the path between the
// server saying "you won" and the card saying so. Deliberately not awaited by
// its callers: nothing on the win card depends on either result, and the
// balance correction below is the only thing that ever writes to it.
async function refreshAfterWin(){
  try {
    const acc = await api('/account');
    if (acc.status === 'success') {
      STATE.account = acc.account;
      correctChestWinBalance(Number(acc.account.walletBalance) || 0);
    }
    await refreshTransactionsCache();
    if (STATE.page === 'home') renderHome();
    if (STATE.page === 'account') renderAccount();
  } catch (_) { /* the card is already correct; a failed refresh changes nothing */ }
}
// One win card, two sources -- and the blurred artwork behind it names which.
// Owner: "when one spins it shows that spin icon background icon l generated
// my own instead of chest box." A spin is not a treasure chest, and showing a
// chest behind a turntable win was the screen telling the member the wrong
// story about where their money came from.
//
// The source is passed in rather than read off whatever screen happens to be
// open: the spin's own win lands four seconds after the tap, by which time the
// member may well have moved.
//
// Owner: "l want when congratulations card comes let the balance also have a
// live growing animation." It counts from the balance held BEFORE the reward
// landed up to the one held after, so what grows on screen is the size of the
// win itself -- counting up from zero would animate the member's whole
// savings, which says nothing about what they just won.
var _chestWinBalFrom = 0;
function chestWinBalFmt(v){ return 'New Balance: ' + fmtUGX(v); }
function showChestWin(reward, balanceBefore, balanceAfter, source){
  const ghost = $('chestWinGhost');
  if (ghost) ghost.innerHTML = source === 'spin' ? ICONS.wheel : GIFT_CODE_REFERENCE_SVG;
  _chestWinBalFrom = Number(balanceBefore) || 0;
  $('chestWinAmount').textContent = fmtUGX(reward);
  $('chestWinBg').classList.add('show');
  // Counted only once the card is actually showing: an element inside a
  // display:none layer has no frames to animate over, and the count would be
  // finished before the member ever saw it.
  countBetweenEl($('chestWinBalance'), _chestWinBalFrom, balanceAfter, chestWinBalFmt, 1200);
  lockBodyScroll();
}
// The card opens on the balance the app can work out on the spot; the live
// /account refresh that follows is what confirms it. When the two differ (a
// payout that matured in the same moment, say), re-aim the count at the real
// figure instead of snapping to it -- but only while the card is still up.
window.correctChestWinBalance = function(real){
  const el = $('chestWinBalance');
  if (!el || !$('chestWinBg').classList.contains('show')) return;
  real = Number(real) || 0;
  const showing = parseFloat(String(el.textContent).replace(/[^0-9.]/g, '')) || _chestWinBalFrom;
  // Upward only. A figure LOWER than what the card is showing is either a read
  // that has not caught up with the credit yet, or a debit that has nothing to
  // do with this win -- and a congratulations card that visibly takes money
  // back off the member is worse than one that is a few seconds behind. The
  // real balance is on Home and Account the moment they close this, and
  // STATE.account already holds it, so nothing is lost by leaving the card be.
  if (real <= showing + 0.005) return;
  countBetweenEl(el, showing, real, chestWinBalFmt, 600);
};
window.closeChestWin = function(){
  $('chestWinBg').classList.remove('show');
  if (!_openSheetTitle) unlockBodyScroll();
  if (STATE.page === 'home') renderHome();
  if (STATE.page === 'account') renderAccount();
};

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
// the member has since opened a sheet, the gift-code chest, or a confirm
// dialog on top of Home while the announcement's own wait was still in
// flight -- none of those are page navigations (STATE.page stays 'home'
// throughout), so _openSheetTitle alone isn't enough on its own.
function isAnyOverlayOpen(){
  return !!(_openSheetTitle
    || ($('chestWinBg') && $('chestWinBg').classList.contains('show'))
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
    || ($('annBg') && $('annBg').classList.contains('show')));
}

// Owner: "make when the announcement dialog message appears when one is from
// deposit page, and from withdrawal page back to home."
//
// showPage('home') is the only thing that fires the announcement, and
// Recharge/Withdraw are OVERLAYS, not page navigations -- STATE.page stays
// 'home' the whole time one is open, so closing one never went through
// showPage() and never re-announced. Closing these specific sheets now does.
//
// Deliberately scoped to the recharge/withdrawal flow rather than every
// sheet: firing it after Records, About, Help Centre or Daily Check-in would
// put the dialog in front of the member several times a session for no
// reason. Withdrawal Accounts is included because it is part of the same
// flow (Withdraw's own empty state opens it), and the STATE.page check below
// means it stays silent when it was reached from the Account tab instead.
// Owner, later: "l also want the announcement dialog to show when one has
// clicked back from deposit page to home also when one has clicked back from
// withdrawal page."
//
// It was supposed to already. The bug was one missing string: the deposit flow
// opens THREE differently-titled sheets -- 'Recharge' for the method chooser
// and the manual form, and 'Deposit' for the automatic (PayA) form, which is
// the one most members actually see. Only 'Recharge' was listed, so backing out
// of the main deposit screen announced nothing. This list is matched by TITLE,
// so a screen whose title changes silently drops off it -- test-nav-sheets.py
// now checks every title in this array is one openSheet() is really called
// with, which is what would have caught it.
// 'Wallet' -- not 'Withdrawal Accounts'. That screen was renamed when Petro
// moved to ONE bound wallet (openWalletSheet), and this entry was left behind
// pointing at a title nothing opens any more. Dead for however long, and
// invisible precisely because a title that matches nothing simply never fires.
// The same new check that caught the missing 'Deposit' caught this too.
var ANNOUNCE_AFTER_SHEETS = ['Recharge', 'Deposit', 'Withdraw', 'Wallet'];
function maybeAnnounceAfterSheet(closedTitle){
  if (!closedTitle || ANNOUNCE_AFTER_SHEETS.indexOf(closedTitle) === -1) return;
  if (STATE.page !== 'home') return;      // closed back to Account, not Home
  if (isAnyOverlayOpen()) return;         // something else is already in front
  maybeShowAnnouncement();
}
function openSheet(title, bodyHtml){
  dismissNotify();
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
// opts.fromAction marks a close the CODE performed after something the
// member just did (a submitted withdrawal, a recharge handing over to the
// result modal) rather than the member navigating back. Those must not
// announce: the dialog would land on top of the confirmation toast or the
// recharge result the member is actually waiting to read. The back button in
// index.html calls closeSheet() with no arguments, so a real back-tap is
// always treated as navigation.
//
// opts.navigating marks the OTHER kind of non-back close: showPage() shutting
// a sheet because a different tab was tapped. Both suppress the announcement,
// and they are kept as separate flags on purpose -- they suppress it for
// unrelated reasons, and folding a tab tap into "fromAction" would read as a
// lie the next time someone traces this.
window.closeSheet = function(opts){
  const closed = _openSheetTitle;
  $('sheetBg').classList.remove('show');
  document.body.classList.remove('sheet-open');
  unlockBodyScroll();
  _openSheetTitle = null;
  if (_aboutScrollObserver) { _aboutScrollObserver.disconnect(); _aboutScrollObserver = null; }
  // opts.keepHistory: the caller is retiring several overlay entries itself
  // with one history.go(-n) -- see showPage(). Only that caller sets it.
  if (!(opts && opts.keepHistory) && history.state && history.state.sheet) history.back();
  if (!(opts && (opts.fromAction || opts.navigating))) maybeAnnounceAfterSheet(closed);
};
window.addEventListener('popstate', () => {
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
  // directly. When it ran first, its own history.back() lands here too, but
  // it's already cleared its own state (title / .show class), so this can't
  // announce a second time.
  const closed = _openSheetTitle;
  $('sheetBg').classList.remove('show');
  document.body.classList.remove('sheet-open');
  unlockBodyScroll();
  _openSheetTitle = null;
  if (_aboutScrollObserver) { _aboutScrollObserver.disconnect(); _aboutScrollObserver = null; }
  maybeAnnounceAfterSheet(closed);
});

window.openInfoSheet = function(kind){
  if (kind === 'about') return openAboutSheet();
  if (kind === 'rules') return openRulesSheet();
  if (kind === 'help') return openHelpSheet();
  // No remaining caller passes any other kind -- openInfoSheet() itself has
  // zero callers left anywhere in this file (confirmed by grep), same as
  // when CLAUDE.md's own history first found it unreachable. Kept, not
  // deleted, as the generic fallback the three branches above grew out of.
  openSheet('Info', '');
};
// ── SUPPORT: MAIL ON HOME, A REAL PAGE UNDER ACCOUNT ──
//
// Owner: "introduce support instead of customer care, in account, so
// support will have a channel link for WhatsApp and customer service
// email... so it will be same on the home so it should remain as it is
// so email will be put so that when one taps support on home he goes to
// mail, and when one comes in account under support he sees channel link
// and support email plus working hours down."
//
// Two different destinations behind the one "Support" label on purpose:
// Home's tile is the fast path (one tap, straight to the member's mail
// app, no sheet in between); Account's is the full page, for someone who
// actually wants to see every way to reach support before picking one.
// This replaces the app's earlier "one link, no page" WhatsApp/Telegram
// shortcut -- that function (customerServiceUrl()/openCustomerService())
// had zero callers left once both tiles moved to these, so it's gone
// rather than left behind as dead code with nothing pointing at it.
window.openSupportMail = function(){
  const s = STATE.settings || {};
  const email = String(s.supportEmail || '').trim();
  if (!email) return notify('Support email is not set up yet. Please try again later.');
  window.location.href = 'mailto:' + email;
};
// Owner, on the first pass: "support page is too ugly and small tiny tab
// make good design and extract those icons so [thumbs-up] for email and
// WhatsApp channel or group" -- with a green WhatsApp glyph and a red
// envelope as reference. The old version was two thin .primary-button
// pills floating directly on the photo with no card under them at all,
// which is exactly what read as "tiny tab." Rebuilt as full-size rows
// matching .acct-list-card -- the same dark-glass card language Account
// (the screen this sheet is reached FROM) already uses everywhere else --
// each with its own big brand-colored circular icon badge (WhatsApp
// green, email the app's own red) instead of a flat button, so it reads
// as a real page rather than two afterthought links.
function supportRowHtml(kind, icon, title, sub, href){
  const target = kind === 'mail' ? '' : ' target="_blank" rel="noopener"';
  return `<a class="support-row" href="${esc(href)}"${target}>
    <span class="support-row-icon ${kind}">${icon}</span>
    <span class="support-row-txt"><span class="t1">${esc(title)}</span><span class="t2">${esc(sub)}</span></span>
    ${ICONS.chevronRight}
  </a>`;
}
window.openSupportSheet = function(){
  const s = STATE.settings || {};
  const rows = [];
  if (s.whatsappGroup) rows.push(supportRowHtml('whatsapp', ICONS.whatsapp, 'WhatsApp Channel', 'Chat with us', s.whatsappGroup));
  if (s.supportEmail) rows.push(supportRowHtml('mail', ICONS.emailPetro, 'Email Support', s.supportEmail, 'mailto:' + s.supportEmail));
  openSheet('Support', `<div class="reveal-in">
    ${rows.length ? rows.join('') : `<p style="line-height:1.6;color:var(--snow-muted);">${esc(t('Contact support for help with your account.'))}</p>`}
    ${s.supportHours ? `<div class="support-hours-card"><span class="support-hours-icon">${ICONS.clock}</span><span class="support-row-txt"><span class="t1">Support hours</span><span class="t2">${esc(s.supportHours)}</span></span></div>` : ''}
  </div>`);
};
// Help Centre banner + the two support links are lazy-fetched only when
// this page is actually opened (the banner can be a large embedded image,
// see getHelpBanner()'s own comment server-side), so the sheet paints
// immediately with just the links/text while the image streams in.
window.openHelpSheet = async function(){
  const s = STATE.settings || {};
  // subagent-audit-caught real bug: the admin Settings panel has had a
  // "WhatsApp group"/"WhatsApp contact" card (whatsappGroup/whatsappContact)
  // sitting right next to the working Telegram fields, saving successfully
  // with the same "leave blank to hide its button" copy -- but nothing here
  // ever read either field, so filling them in silently did nothing. Wired
  // in the same way as the Telegram links right below.
  const links = (s.telegramGroup ? `<a class="primary-button" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box;" href="${esc(s.telegramGroup)}" target="_blank" rel="noopener">Telegram Group</a>` : '')
    + (s.supportTelegram ? `<a class="primary-button" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box;background:var(--snow-ink);" href="${esc(s.supportTelegram)}" target="_blank" rel="noopener">Customer Service</a>` : '')
    + (s.whatsappGroup ? `<a class="primary-button" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box;background:var(--snow-green);" href="${esc(s.whatsappGroup)}" target="_blank" rel="noopener">WhatsApp Group</a>` : '')
    + (s.whatsappContact ? `<a class="primary-button" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box;background:var(--snow-green-deep);" href="${esc(s.whatsappContact)}" target="_blank" rel="noopener">WhatsApp Support</a>` : '');
  openSheet('Help Centre', `<div class="reveal-in">
    <div id="helpBannerWrap"></div>
    ${links ? `<div style="display:flex;flex-direction:column;gap:10px;margin-top:16px;">${links}</div>` : ''}
    <p style="white-space:pre-line;line-height:1.6;color:var(--snow-muted);margin-top:18px;font-size:13px;">${esc(s.supportHours ? 'Support hours: ' + s.supportHours : 'Contact support for help with your account.')}</p>
  </div>`);
  const r = await api('/public/help-banner');
  const wrap = $('helpBannerWrap');
  if (wrap && r.status === 'success' && r.image) {
    wrap.innerHTML = `<img src="${esc(r.image)}" style="width:100%;display:block;border-radius:0;" alt="">`;
  }
};
// Wraps an already-HTML-escaped block of About text in ONE
// <span class="reveal-word">.
//
// It used to be one span PER WORD, each with its own animation-delay, for a
// staggered word-by-word reveal. That animation was removed on request and
// .reveal-word is now opacity:1;transform:none -- so the split had stopped
// doing anything at all except breaking translation: the i18n sweep matches a
// WHOLE text node against the table, and a sentence chopped into fourteen
// one-word nodes matches nothing. That is exactly why find-untranslated.py
// reported "and", "of", "in", "you", "products", "daily" and "invest" as
// untranslated words on this screen.
//
// The class is KEPT, and deliberately: a stale `.reveal-word{opacity:0}` rule
// is what blanked this page once before, and test-visible-text.py's guard
// (exactly one rule, never opacity:0) only means something while something on
// the page still carries the class.
function revealWordsHtml(escapedText){
  return `<span class="reveal-word">${escapedText}</span>`;
}
// About page: an admin-authored ordered list of text/image blocks (see
// /public/about-content), rendered as an article and revealed block-by-
// block as the member scrolls (owner: "whenever one scrolls down, images
// and words I placed show animation").
let _aboutScrollObserver = null;
function articleLoadingHtml(){
  return '<div class="article-loading" role="status" aria-label="Loading">' + MINI_RING_LOADER + '</div>';
}
window.openAboutSheet = async function(){
  const s = STATE.settings || {};
  openSheet('About ' + brandName(), `<div id="aboutArticle" class="reveal-in">${articleLoadingHtml()}</div>`);
  const r = await api('/public/about-content');
  const wrap = $('aboutArticle');
  if (!wrap) return; // sheet was closed again before this resolved
  const blocks = (r.status === 'success' && Array.isArray(r.blocks) && r.blocks.length) ? r.blocks
    : [{ type: 'text', text: s.aboutText || (brandName() + ' lets you invest in a range of products with daily income and a 3-level referral program.') }];
  wrap.innerHTML = blocks.map(b => b.type === 'image'
    ? `<div class="scroll-reveal about-image about-block"><img src="${esc(b.image)}" style="width:100%;display:block;border-radius:0;" alt=""></div>`
    : `<div class="scroll-reveal about-block"><p style="white-space:pre-line;line-height:1.7;color:rgba(255,255,255,.90);">${revealWordsHtml(esc(b.text))}</p></div>`
  ).join('');
  if (_aboutScrollObserver) _aboutScrollObserver.disconnect();
  _aboutScrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in-view'); _aboutScrollObserver.unobserve(e.target); }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  wrap.querySelectorAll('.scroll-reveal').forEach(el => _aboutScrollObserver.observe(el));
};

// Rules and Regulations is an admin-authored ordered article like About,
// with its own content document so optional images stay out of /settings.
window.openRulesSheet = async function(){
  const s = STATE.settings || {};
  openSheet('Rules and Regulations', `<div id="rulesArticle" class="reveal-in">${articleLoadingHtml()}</div>`);
  const r = await api('/public/rules-content');
  const wrap = $('rulesArticle');
  if (!wrap) return;
  const fallback = s.rulesText || ('Minimum deposit ' + fmtUGX(s.minDeposit) + '. Minimum withdrawal ' + fmtUGX(s.minWithdraw) + ', a ' + withdrawalFeePct(s) + '% fee applies. Referral commission is paid once, after the first confirmed deposit: Level 1 ' + (s.commL1 ?? 30) + '%, Level 2 ' + (s.commL2 ?? 3) + '%, Level 3 ' + (s.commL3 ?? 2) + '%.');
  const blocks = (r.status === 'success' && Array.isArray(r.blocks) && r.blocks.length) ? r.blocks
    : [{ type: 'text', text: fallback }];
  wrap.innerHTML = blocks.map(b => b.type === 'image'
    ? `<div class="scroll-reveal about-image about-block"><img src="${esc(b.image)}" style="width:100%;height:auto;display:block;border-radius:12px;" alt=""></div>`
    : `<div class="scroll-reveal about-block"><p style="white-space:pre-line;line-height:1.7;color:rgba(255,255,255,.90);">${revealWordsHtml(esc(b.text))}</p></div>`
  ).join('');
  if (_aboutScrollObserver) _aboutScrollObserver.disconnect();
  _aboutScrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in-view'); _aboutScrollObserver.unobserve(e.target); }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  wrap.querySelectorAll('.scroll-reveal').forEach(el => _aboutScrollObserver.observe(el));
};

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
function eatDayIndex(ts){ return Math.floor((ts + tzOffMs()) / 86400000); }
function eatMidnightAfter(ts){ return (eatDayIndex(ts) + 1) * 86400000 - tzOffMs(); }
window.openCheckinSheet = function(){
  const a = STATE.account || {};
  const bonus = Number(STATE.settings && STATE.settings.dailyCheckin) || 0;
  const checkinRows = Array.isArray(STATE.transactions)
    ? STATE.transactions.filter(t => String(t.type || '').toLowerCase() === 'checkin')
    : [];
  const totalAmount = checkinRows.length
    ? checkinRows.reduce((sum, t) => sum + Math.max(0, Number(t.amount) || 0), 0)
    : Math.max(0, Number(a.checkinTotal) || 0);
  const now = Date.now();
  const lastAt = a.lastCheckinAt ? Number(a.lastCheckinAt) : 0;
  const onCooldown = !!lastAt && eatDayIndex(lastAt) === eatDayIndex(now);
  const nextAt = onCooldown ? eatMidnightAfter(now) : 0;
  const checkinStyle = STATE.checkinBanner ? ` style="--checkin-bg:url('${esc(STATE.checkinBanner)}')"` : '';
  openSheet('Daily Check-in', `<div class="reveal-in">
    <div class="checkin-panel"${checkinStyle}>
      <div class="checkin-kicker">Total amount earned</div>
      <div class="checkin-total mono">${esc(fmtUGX(totalAmount))}</div>
      <div class="checkin-copy">${onCooldown
        ? `You have checked in today. Your next check-in opens at midnight.`
        : `Check in once each day to earn ${fmtUGX(bonus)}.`}</div>
      <button class="primary-button checkin-action" id="checkinBtn" ${onCooldown ? `data-checkin-next="${nextAt}" disabled` : ''} onclick="submitCheckin()">${onCooldown ? 'Checked in today' : 'Check In &middot; ' + fmtUGX(bonus)}</button>
    </div>
  </div>`);
  if (onCooldown) startCheckinCountdown();
}
// Self-terminating, same idiom as startPlanCountdowns(): the tick just stops
// itself once #checkinBtn's countdown attribute is gone (sheet closed or
// re-rendered), no separate close-hook needed. Once the cooldown genuinely
// reaches zero, flips the button live to its claimable state -- no manual
// refresh/reopen needed to see the app catch up.
var _checkinCountdownTimer = null;
function startCheckinCountdown(){
  if (_checkinCountdownTimer) { clearTimeout(_checkinCountdownTimer); _checkinCountdownTimer = null; }
  if (_openSheetTitle !== 'Daily Check-in') return;
  const btn = document.querySelector('[data-checkin-next]');
  if (!btn) return;
  const remaining = Number(btn.dataset.checkinNext) - Date.now();
  if (remaining <= 0) {
    btn.removeAttribute('data-checkin-next');
    btn.disabled = false;
    const bonus = Number(STATE.settings && STATE.settings.dailyCheckin) || 0;
    btn.innerHTML = 'Check In &middot; ' + fmtUGX(bonus);
    const copy = document.querySelector('.checkin-copy');
    if (copy) copy.textContent = 'Check in once each day to earn ' + fmtUGX(bonus) + '.';
    return;
  }
  _checkinCountdownTimer = setTimeout(() => {
    _checkinCountdownTimer = null;
    startCheckinCountdown();
  }, Math.min(remaining + 150, 2147483000));
}
window.submitCheckin = async function(){
  const btn = $('checkinBtn');
  if (!btn || btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Checking in…';
  const r = await post('/checkin', {});
  if (r.status !== 'success') {
    btn.disabled = false; btn.textContent = label;
    return notify(r.message || 'Could not check in');
  }
  notify(t('Check-in successful ✓'));
  const acc = await api('/account');
  if (acc.status === 'success') STATE.account = acc.account;
  // Same stale-Records fix Round 72 applied to deposit/withdraw --
  // /checkin already wrote a real ledger row server-side by this point;
  // without this, Transaction Statement's Income tab could sit stale for a reload or two
  // (owner: "some records are created or reflect after reloading").
  await refreshTransactionsCache();
  closeSheet({ fromAction: true });
  if (STATE.page === 'home') renderHome();
};

function depWitStatusLabel(desc){
  const parts = String(desc || '').split(': ');
  const label = parts.length >= 2 ? parts[1] : (desc || '');
  return label.replace(/\s*\([^)]*\)\s*$/, '');
}

function recordsRowAmount(t){
  if (t.displayAmount !== undefined && t.displayAmount !== null) return Number(t.displayAmount) || 0;
  if ((Number(t.amount) || 0) === 0 && t.description) {
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
  if (s.depositAvailable === false) return notify('Recharges are not available right now.');
  openDepositFormSheet();
};
var _depChosenAmount = 0;
// USDT (TRC20) -- a third deposit rail alongside the automatic Mobile
// Money flow above (completely untouched by any of this). Only shown when
// the admin has usdtEnabled on, same "nothing changes for anyone until an
// admin turns it on" pattern as every other optional rail in this app.
// Deliberately its OWN simple submit->toast->refresh flow rather than
// routed through the Mobile Money status modal above (openDepositStatusModal
// et al.) -- that modal's copy (USSD fallback codes, "check your phone for
// the prompt") is specific to a push-payment flow a member approves on
// their phone, which a crypto transfer the member already sent before
// ever opening this form simply isn't.
var _depMethod = 'mm';
window.selectDepMethod = function(m){
  _depMethod = m;
  const tabs = $('depMethodRow');
  if (tabs) tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.dm === m));
  $('depMmPanel').style.display = (m === 'mm') ? 'block' : 'none';
  $('depUsdtPanel').style.display = (m === 'usdt') ? 'block' : 'none';
  $('depCardPanel').style.display = (m === 'card') ? 'block' : 'none';
};
function openDepositFormSheet(){
  const s = STATE.settings || {};
  const usdtOn = s.usdtEnabled === true;
  const cardOn = s.cardDepositEnabled === true;
  _depMethod = 'mm';
  // Owner: "when you had selected and gone back you come back when it
  // shows selected but no figure input in amount card." #depAmount/
  // #cardAmount are FRESH inputs every time this sheet opens (no value=
  // carried over from before) -- but _depChosenAmount/_cardChosenAmount
  // are plain module-level vars that never reset, so depositChipsHtml()
  // below kept marking last time's chip .sel against an input that had
  // gone back to empty. Reset both here, the same place _depMethod above
  // already resets on every open, so the chips and the inputs start back
  // in agreement instead of the chip alone remembering a stale pick.
  _depChosenAmount = 0;
  _cardChosenAmount = 0;
  // Owner: "let the registered number also appear as a default deposit
  // number for mobile money" -- pre-filled, not locked: a deposit can
  // genuinely come from a different mobile-money number than the one the
  // account was registered with (a past round deliberately left this
  // field blank for exactly that reason), so this is a starting point the
  // member can still edit, not a forced value. localDigits() is the same
  // parser phoneToEmail() uses -- it returns null for a stored phone that
  // doesn't match this region's expected shape, so a malformed or
  // legacy-format number never gets shoved into the field as if it were
  // valid.
  const defaultPhone = localDigits((STATE.account || {}).phone) || '';
  // Tab row is built from whichever rails are actually on -- Mobile Money
  // is always first/default and always present; USDT and Card each add
  // their own tab only when the admin has enabled them, so a fresh deploy
  // with neither on shows no tab row at all (byte-for-byte the same single
  // Mobile Money form this sheet always was, same as before either rail
  // existed).
  const methodTabs = [['mm', 'Mobile Money']];
  if (usdtOn) methodTabs.push(['usdt', 'USDT (TRC20)']);
  if (cardOn) methodTabs.push(['card', 'Card']);
  const tabsHtml = methodTabs.length > 1
    ? `<div class="dep-method-tabs" id="depMethodRow">
      ${methodTabs.map(([k, l]) => `<button type="button" data-dm="${k}" class="${k === 'mm' ? 'on' : ''}" onclick="selectDepMethod('${k}')">${l}</button>`).join('')}
    </div>` : '';
  openSheet('Deposit', `<div class="reveal-in" style="padding-top:18px;">
    ${tabsHtml}
    <div id="depMmPanel">
    <div class="dep-sec"><span class="bar"></span><span>Select Amount</span></div>
    <div class="dep-amt"><input id="depAmount" type="text" inputmode="numeric" maxlength="9" placeholder="${Number(s.minDeposit) || 0}" oninput="syncDepositQuickAmt()"></div>
    <div class="dep-chips" id="depChips">${depositChipsHtml(s, 'depAmount')}</div>

    <div class="dep-sec" style="margin-top:24px;"><span class="bar"></span><span>Payment Phone</span></div>
    <div class="dep-phone">
      <span class="prefix">${esc(dialPlus())}</span>
      <input id="depPhone" type="tel" inputmode="numeric" placeholder="Your payment number (${esc(phoneHintBody())})" value="${esc(defaultPhone)}" oninput="sanitizePhoneInput(this)">
    </div>
    <div class="dep-hint">Phone number must start with 0 and be ${localLen() + 1} digits</div>

    <button class="primary-button" id="depSubmitBtn" style="width:100%;height:54px;padding:0;font-size:17px;margin:22px 0;" onclick="submitDeposit()">Confirm Deposit</button>

    <div class="dep-instr deposit-guide">
      <h3>How to add funds</h3>
      <ol class="deposit-steps">
        <li><b>Choose your amount</b><span>Enter at least ${fmtUGX(s.minDeposit)} and the mobile money number to charge.</span></li>
        <li><b>Approve on your phone</b><span>Tap Confirm Deposit, then approve the payment prompt using your mobile money PIN on your phone.</span></li>
        <li><b>Follow the payment status</b><span>Wait for confirmation. This checks itself automatically. If money leaves your phone but the balance has not updated, keep the transaction reference and contact Customer Support.</span></li>
      </ol>
    </div>
    </div>

    <div id="depUsdtPanel" style="display:none;">
      <div class="dep-sec"><span class="bar"></span><span>Amount (USDT)</span></div>
      <div class="dep-amt"><input id="usdtAmt" type="number" step="0.01" inputmode="decimal" placeholder="0" oninput="updateUsdtConversion()"></div>
      <div class="dep-hint">1 USDT = ${fmtUGX(Number(s.usdtRate) || 0)} &middot; you will receive <b id="usdtUgxPreview">${fmtUGX(0)}</b></div>

      <div class="dep-sec" style="margin-top:24px;"><span class="bar"></span><span>Send to this address (TRC20 only)</span></div>
      <div class="dep-phone" style="height:auto;padding:12px 0;">
        <span id="usdtAddrDisplay" style="word-break:break-all;font-size:12.5px;flex:1;">${esc(s.usdtWalletAddress || '')}</span>
        <button type="button" class="secondary-button" style="height:34px;padding:0 14px;font-size:12.5px;flex-shrink:0;" onclick="copyUsdtAddress()">Copy</button>
      </div>
      <div class="dep-hint">TRC20 (Tron) network only &mdash; any other network permanently loses the funds.</div>

      <div class="dep-sec" style="margin-top:24px;"><span class="bar"></span><span>Transaction Hash (TXID)</span></div>
      <div class="dep-phone">
        <input id="usdtTxid" type="text" placeholder="Paste your transaction hash">
      </div>

      <button class="primary-button" id="usdtGoBtn" style="width:100%;height:54px;padding:0;font-size:17px;margin:22px 0;" onclick="doUsdtDeposit()">Submit USDT Payment</button>

      <div class="dep-instr deposit-guide">
        <h3>How USDT deposits work</h3>
        <ol class="deposit-steps">
          <li><b>Send the exact amount</b><span>Minimum ${fmtUGX(s.minDeposit)}${Number(s.usdtRate) > 0 ? ` (about ${(Number(s.minDeposit) / Number(s.usdtRate)).toFixed(2)} USDT)` : ''}, on the TRC20 (Tron) network only, to the address above.</span></li>
          <li><b>Paste the transaction hash</b><span>Copy the TXID from your wallet app and paste it here, then tap Submit.</span></li>
          <li><b>Wait for verification</b><span>Most payments confirm within a minute, automatically. If yours is still pending, reopen Transaction Statement later to check.</span></li>
        </ol>
      </div>
    </div>

    <div id="depCardPanel" style="display:none;">
      <div class="dep-sec"><span class="bar"></span><span>Select Amount</span></div>
      <div class="dep-amt"><input id="cardAmount" type="text" inputmode="numeric" maxlength="9" placeholder="${Number(s.minDeposit) || 0}" oninput="syncCardQuickAmt()"></div>
      <div class="dep-chips" id="cardChips">${depositChipsHtml(s, 'cardAmount')}</div>

      <button class="primary-button" id="cardGoBtn" style="width:100%;height:54px;padding:0;font-size:17px;margin:22px 0;" onclick="doCardDeposit()">Pay with Card</button>

      <div class="dep-instr deposit-guide">
        <h3>How card payments work</h3>
        <ol class="deposit-steps">
          <li><b>Enter your amount</b><span>At least ${fmtUGX(s.minDeposit)}.</span></li>
          <li><b>Pay on the secure card page</b><span>Tap Pay with Card and enter your card details on MarzPay's own payment page.</span></li>
          <li><b>Return to the app</b><span>Your balance updates automatically once the payment is confirmed.</span></li>
        </ol>
      </div>
    </div>
  </div>`);
}
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
var CARD_DEPOSIT_STORAGE_KEY = 'petro_pending_card_deposit';
window.doCardDeposit = async function(){
  const btn = $('cardGoBtn');
  if (!btn || btn.disabled) return;
  const amount = parseMoneyInput(($('cardAmount') || {}).value);
  if (!amount || amount <= 0) return notify('Enter the amount you want to add');
  const s = STATE.settings || {};
  if (amount < (Number(s.minDeposit) || 0)) return notify('Minimum amount is ' + fmtUGX(s.minDeposit));
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Starting…';
  const r = await post('/deposit/card/submit', { amount: amount });
  if (r.status !== 'success' || !r.redirectUrl) {
    btn.disabled = false; btn.textContent = label;
    return notify(r.message || 'Could not start the card payment');
  }
  try { localStorage.setItem(CARD_DEPOSIT_STORAGE_KEY, r.depositId); } catch (e) {}
  location.href = r.redirectUrl;
};
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
        fireConfetti();
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
function updateUsdtConversion(){
  const s = STATE.settings || {};
  const rate = Number(s.usdtRate) || 0;
  const amt = parseFloat(($('usdtAmt') || {}).value) || 0;
  const el = $('usdtUgxPreview');
  if (el) el.textContent = fmtUGX(Math.round(amt * rate));
}
window.updateUsdtConversion = updateUsdtConversion;
window.copyUsdtAddress = function(){
  const el = $('usdtAddrDisplay');
  const addr = el && el.textContent;
  if (!addr) return;
  copyText(addr);
};
window.doUsdtDeposit = async function(){
  const s = STATE.settings || {};
  const btn = $('usdtGoBtn');
  if (!btn || btn.disabled) return;
  const amtUsdt = parseFloat(($('usdtAmt') || {}).value);
  const txid = ($('usdtTxid') || {}).value.trim();
  if (!amtUsdt || amtUsdt <= 0) return notify('Enter the USDT amount you sent');
  if (!txid) return notify('Enter the transaction hash (TXID)');
  const amtUgx = Math.round(amtUsdt * (Number(s.usdtRate) || 0));
  if (amtUgx < (Number(s.minDeposit) || 0)) return notify('Minimum amount is ' + fmtUGX(s.minDeposit));
  const label = btn.textContent;
  // The server itself checks the transaction a few times before answering
  // (see resolveUsdtDeposit server-side) -- this button legitimately takes
  // a few seconds, which "Checking payment…" makes honest rather than just
  // a generic spinner.
  btn.disabled = true; btn.textContent = 'Checking payment…';
  const r = await post('/deposit/usdt/submit', { amountUsdt: amtUsdt, txid: txid });
  btn.disabled = false; btn.textContent = label;
  if (r.status !== 'success') return notify(r.message || 'Could not submit your deposit');

  if (r.state === 'rejected') {
    // Fields stay exactly as typed -- the member can see what they entered
    // and correct it (e.g. the right amount) rather than starting over.
    return notify(r.message || 'Payment declined.');
  }

  if (r.state === 'matched') {
    fireConfetti();
    notify('Payment completed! Credited to your balance.');
    closeSheet({ fromAction: true });
    await refreshTransactionsCache();
    if (STATE.page === 'home') renderHome();
    return;
  }
  // Still verifying (rare -- the synchronous check above already resolves
  // most real deposits) -- keep checking a while longer so a slightly
  // slower confirmation still ends with a clear result. If it's somehow
  // still open after this, the server keeps retrying on its own (up to 15
  // minutes) regardless of whether anyone is watching.
  notify(r.message || 'Submitted. Verifying on-chain…');
  pollUsdtDepositStatus(r.depositId);
};
var _usdtPollTimer = null;
function pollUsdtDepositStatus(depositId){
  if (_usdtPollTimer) clearInterval(_usdtPollTimer);
  var attempts = 0;
  _usdtPollTimer = setInterval(async function(){
    attempts++;
    const r = await post('/deposit/usdt/status', { depositId: depositId });
    if (r.status === 'success' && r.state === 'matched') {
      clearInterval(_usdtPollTimer); _usdtPollTimer = null;
      fireConfetti();
      notify('Payment completed! Credited to your balance.');
      await refreshTransactionsCache();
      if (STATE.page === 'home') renderHome();
      return;
    }
    if (r.status === 'success' && r.state === 'rejected') {
      clearInterval(_usdtPollTimer); _usdtPollTimer = null;
      notify(r.message || 'Payment declined.');
      return;
    }
    if (attempts >= 6) { clearInterval(_usdtPollTimer); _usdtPollTimer = null; } // server keeps retrying regardless; stop bothering the member
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
    .slice(0, 5);
  const chosen = _chosenAmountFor(inputId);
  return amounts.map(a =>
    `<button type="button" class="dep-chip${a === chosen ? ' sel' : ''}" data-amt="${a}" onclick="pickDepositAmount(${a},'${inputId}')">${Number(a).toLocaleString('en-US')}</button>`
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
};
window.closeDepositStatusModal = function(){
  // Cancels the success screen's own auto-redirect countdown if the member
  // taps Close/Back before it fires on its own -- otherwise the timer would
  // still be alive and try to close (or navigate) a modal that is already
  // closed, moments later.
  if (_depSuccessRedirectTimer) { clearInterval(_depSuccessRedirectTimer); _depSuccessRedirectTimer = null; }
  $('depStatusBg').classList.remove('show');
  document.body.classList.remove('deposit-status-open');
  unlockBodyScroll();
  // Subagent-audit-caught real bug: submitDeposit()/pollDepositStatus()/
  // pollManualDepositStatus() all close the Recharge/Payment sheet
  // with {fromAction:true} specifically to SUPPRESS the announcement while
  // handing off to this modal (so it can't land on top of the pending/result
  // screen) -- but nothing ever un-suppressed it once the member actually
  // taps Close here, which is the real "back to Home" moment for the most
  // common real path (submit a recharge -> see the result -> tap Close).
  // maybeAnnounceAfterSheet() already no-ops correctly when STATE.page isn't
  // 'home' or another overlay is open, so this is safe to call unconditionally.
  maybeAnnounceAfterSheet('Recharge');
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
  if (c) c.style.display = showClose ? 'block' : 'none';
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
  $('depStatusIcon').className = 'dep-status-icon';
  // Dedicated Petro rings replace the payment provider's old loader artwork.
  $('depStatusIcon').innerHTML = DEPOSIT_POLL_SPIN;
  $('depStatusTitle').textContent = 'Processing your recharge';
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
    + '<li>Approve the payment to complete your recharge.</li>'
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
// ── CONFETTI ── owner: "high quality confetti sparklings bursting and
// dropping down allover the page on payment success on all methods."
// One shared function, called from every deposit rail's own success path
// (setDepositStatusSuccess() below covers Mobile Money + Card, which share
// this one modal; doUsdtDeposit()/pollUsdtDepositStatus() call it directly
// for USDT, which never uses this modal at all).
//
// Plain canvas, zero dependencies -- matches this codebase's own standing
// preference (see static-server.js's own "ZERO DEPENDENCIES on purpose"
// note) over pulling in a confetti library for one animation. A fixed,
// full-viewport, pointer-events:none canvas overlay so it never blocks a
// tap on the Close/Back button underneath it. Two particle sets for the
// "bursting AND dropping down all over" brief: an upward burst from
// bottom-center (the "bursting" half) plus a wide rain of pieces already
// falling from above the top edge (the "dropping down allover the page"
// half), both under the same gravity so the burst pieces arc over and
// join the rain by the time they fade out. Respects prefers-reduced-motion
// -- skipped entirely for anyone who has that on, same as this app's
// existing spinners already do.
function fireConfetti(){
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let canvas = document.getElementById('confettiCanvas');
    if (canvas) canvas.remove(); // a rapid second success (rare, but possible) restarts cleanly rather than layering two loops
    canvas = document.createElement('canvas');
    canvas.id = 'confettiCanvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = window.innerWidth, H = window.innerHeight;
    function resize(){
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);
    // Amber/red/gold, plus white -- Petro's own palette, not generic
    // party colours, so this still looks like it belongs to the app.
    const COLORS = ['#e30613', '#f5a000', '#ffb000', '#1a7a3e', '#2f6fd6', '#ffffff'];
    const particles = [];
    function makePiece(x, y, vx, vy, burst){
      return {
        x, y, vx, vy, burst,
        w: 5 + Math.random() * 6, h: 8 + Math.random() * 9,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        rot: Math.random() * Math.PI * 2, vrot: (Math.random() - 0.5) * 0.35,
        shape: Math.random() < 0.45 ? 'circle' : 'rect',
      };
    }
    // The rain: falling from above the visible top edge, spread across the
    // full width -- "dropping down allover the page".
    for (let i = 0; i < 140; i++) {
      particles.push(makePiece(
        Math.random() * W, -20 - Math.random() * H * 0.6,
        (Math.random() - 0.5) * 1.6, 2 + Math.random() * 2.5, false
      ));
    }
    // The burst: fired upward/outward from bottom-center -- "bursting".
    for (let i = 0; i < 70; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const speed = 7 + Math.random() * 9;
      particles.push(makePiece(
        W / 2 + (Math.random() - 0.5) * 100, H * 0.72,
        Math.cos(angle) * speed, Math.sin(angle) * speed, true
      ));
    }
    const GRAVITY = 0.16, DURATION = 4200, start = performance.now();
    function frame(now){
      const elapsed = now - start;
      ctx.clearRect(0, 0, W, H);
      const fade = Math.max(0, 1 - elapsed / DURATION);
      for (const p of particles) {
        p.vy += GRAVITY * (p.burst ? 0.55 : 0.3);
        if (p.burst) p.vx *= 0.985;
        p.x += p.vx; p.y += p.vy; p.rot += p.vrot;
        if (p.y - 20 > H) continue; // off the bottom -- skip drawing, still fades on schedule with the rest
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = fade;
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        else { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      if (elapsed < DURATION) requestAnimationFrame(frame);
      else { window.removeEventListener('resize', resize); canvas.remove(); }
    }
    requestAnimationFrame(frame);
  } catch (e) {}
}
window.fireConfetti = fireConfetti;
var _depSuccessRedirectTimer = null;
function setDepositStatusSuccess(){
  fireConfetti();
  $('depStatusIcon').className = 'dep-status-icon success';
  // The owner's own artwork, cut out of the images he supplied.
  $('depStatusIcon').innerHTML = '<svg viewBox="0 0 120 120" fill="none" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="var(--snow-green-soft)" stroke="var(--snow-green)" stroke-width="4"/><path d="M36 61l15 15 34-36" stroke="var(--snow-green)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // Owner: "let me think that on payment success it says congratulations
  // payment has been received {added to your wallet} redirecting back home
  // in 5 seconds or you can say so back the button should be available."
  $('depStatusTitle').textContent = 'Congratulations! 🎉';
  // Names the actual figure when it is known (it always is on the automatic
  // path, since the pending state set it moments earlier) and falls back to
  // wording that reads properly without one -- the manual-deposit path lands
  // here from handleManualDepositStatusResult() without ever showing pending.
  // brandName(), not the literal: the app's name is admin-settable.
  const amountLine = _depPendingAmount
    ? 'Payment received — ' + esc(fmtUGX(_depPendingAmount)) + ' has been added to your wallet.'
    : 'Payment received — your recharge has been added to your ' + esc(brandName()) + ' wallet.';
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
      closeDepositStatusModal();
      return;
    }
    secondsLeft--;
  };
  if (_depSuccessRedirectTimer) clearInterval(_depSuccessRedirectTimer);
  tick();
  _depSuccessRedirectTimer = setInterval(tick, 1000);
}
function setDepositStatusFailed(msg){
  $('depStatusIcon').className = 'dep-status-icon failed';
  $('depStatusIcon').innerHTML = '<svg viewBox="0 0 120 120" fill="none" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="var(--snow-wine-soft)" stroke="var(--snow-wine)" stroke-width="4"/><path d="M43 43l34 34M77 43L43 77" stroke="var(--snow-wine)" stroke-width="8" stroke-linecap="round"/></svg>';
  $('depStatusTitle').textContent = 'Payment not completed';
  // Says what is true and checkable -- the wallet balance did not move -- and
  // deliberately makes no claim about the member's mobile money account,
  // which this app cannot see. Promising "nothing was taken" would be a
  // guess about someone else's money.
  $('depStatusBody').innerHTML = '<p>' + esc(msg
    || 'This recharge did not go through, so your ' + brandName() + ' balance has not changed. You can start it again whenever you are ready.') + '</p>';
  // Undoes setDepositStatusSuccess()'s own "Back to Home" relabel -- this
  // button means plain Close here, on a modal a later deposit attempt can
  // reuse without a fresh page load in between.
  const cf = $('depStatusCloseBtn'); if (cf) cf.textContent = 'Close';
  setDepButtons(false, true);
}
function setDepositStatusUnknown(){
  $('depStatusIcon').className = 'dep-status-icon';
  $('depStatusIcon').innerHTML = DEPOSIT_POLL_SPIN;
  $('depStatusTitle').textContent = 'Still waiting for the provider';
  $('depStatusBody').innerHTML = '<p>The payment has not been confirmed yet, and nothing is lost. '
    + 'If it goes through, your balance updates on its own automatically -- '
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
  if (!submitBtn || submitBtn.disabled || !$('depAmount') || !$('depPhone')) return;
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
  const phone = cleanPhone($('depPhone').value);
  if (!amount || amount <= 0) return notify('Enter a valid amount');
  // Card (doCardDeposit()) and USDT (doUsdtDeposit()) both already check
  // this client-side before ever hitting the network; Mobile Money was the
  // one rail still relying entirely on the server's own rejection, which
  // meant a below-minimum amount round-tripped to the server and back
  // before the member found out, instead of failing instantly like the
  // other two.
  const s = STATE.settings || {};
  if (amount < (Number(s.minDeposit) || 0)) return notify('Minimum amount is ' + fmtUGX(s.minDeposit));
  if (!phone) return notify('Enter the mobile money number to charge.');
  submitBtn.disabled = true; submitBtn.textContent = 'Sending request…';
  let r;
  try {
    // No network field on this form (Round 145) -- the gateway detects it
    // from the phone number itself; server.js already treats `network` as
    // optional here.
    r = await post('/deposit/marzpay', { amount, phone });
  } finally {
    // 'Confirm Deposit', not 'Recharge' -- this restores the button after a
    // failed attempt, and the label it was restoring belonged to a screen
    // that no longer exists, so a member whose recharge failed was left
    // looking at a button that had silently renamed itself.
    submitBtn.disabled = false; submitBtn.textContent = 'Confirm Deposit';
  }
  if (r && r.stale) return;
  if (!r || r.status !== 'success') return notify((r && r.message) || 'Could not start recharge');
  // Same stale-Records fix as submitWithdraw() -- /deposit/marzpay already
  // wrote a "Processing" ledger row server-side by this point, refresh the
  // cache now so it's actually there the next time Records opens.
  refreshTransactionsCache().catch(() => {});
  if ($('depSubmitBtn') === submitBtn && _openSheetTitle === 'Deposit') closeSheet({ fromAction: true });
  openDepositStatusModal(amount, phone);
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
//   * later checks are 2.5s apart, which is the cadence PesaJet's own SDK
//     uses in pollUntilComplete.
//
// The 60-second budget is unchanged -- 24 ticks at the new spacing is the same
// wall-clock window, so nothing gives up on a payment any sooner than before.
var DEP_POLL_FIRST_MS = 1200;
var DEP_POLL_EVERY_MS = 2500;
async function pollDepositStatus(depositId){
  _depActiveDepositId = depositId;
  _depPollDone = false;
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? DEP_POLL_FIRST_MS : DEP_POLL_EVERY_MS));
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
    // Goes through the same single-flight the Verify button uses, so a tap
    // landing mid-tick joins THIS request instead of starting a second one.
    if (await applyDepositStatusResult(await depositStatusCheck(depositId))) return;
  }
  // Ending the loop is the autopoll giving up on its own ~60s budget, not the
  // payment being over -- _depPollDone stays false on purpose so Verify keeps
  // working on this deposit afterwards.
  if (!_depPollDone) setDepositStatusUnknown();
}

// Cache-first: STATE.bankAccounts is prefetched at login. Deliberately does
// NOT quietly repaint once the background re-fetch lands (unlike Home/Team/
// Products) -- this sheet has live input fields (amount, PIN) and silently
// replacing them out from under someone mid-entry would be a much worse bug
// than a slightly-stale account list. The background fetch still keeps
// STATE.bankAccounts current for the NEXT time this sheet opens.
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
    const wallet = currentWallet();
    $('witWallet').innerHTML = walletCardHtml(wallet);
    $('witBindBtn').textContent = wallet ? 'Change Wallet' : 'Bind Wallet';
    $('witSubmitBtn').disabled = !wallet || _withdrawSubmitting;
  }
};
// ── The cash-out window, client side ────────────────────────────────────
// Mirrors server.js's withdrawWindowState()/hhmmLabel(). The SERVER decides;
// this only tells the member what the rule is before they type an amount, and
// saves them a round trip when it is plainly shut.
//
// What was here before was worse than nothing: a hardcoded "Withdrawal time:
// 06:00:00 - 17:00:00." that no code enforced, so the app quietly promised
// hours it did not keep. If the window is off, the line now says cash-out is
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
function withdrawHoursLine(s){
  const w = withdrawWindow(s);
  if (!w.enabled) return 'Cash-out can be requested at any time of day.';
  return `Cash-out time: ${esc(w.from)} to ${esc(w.to)}.`;
}
// Withdraw.dc.html. Replaces the form inherited from Snow: a tinted balance
// card, a UGX-prefixed amount field, the bound wallet shown as the same
// bank-card tile the Wallet screen uses (not a <select> of several), the
// trade-password field, the fee line, and the instruction card.
function paintWithdrawSheet(s){
  const balance = (STATE.account && STATE.account.walletBalance) || 0;
  const w = (STATE.bankAccounts || [])[0] || null;
  const fee = withdrawalFeePct(s);
  $('sheetBody').innerHTML = `<div class="reveal-in" style="padding-top:18px;">
    <div id="witWallet">${walletCardHtml(w)}</div>
    <button id="witBindBtn" class="btn-bind" type="button" onclick="openWalletSheet()">${w ? 'Change Wallet' : 'Bind Wallet'}</button>

    <div class="wit-bal">
      <div class="lbl">Available Balance</div>
      <div class="val">${fmtUGX(balance)}</div>
    </div>
    <div class="wit-amt">
      <span>${esc(cur())}</span>
      <input id="witAmount" type="text" inputmode="numeric" maxlength="9" placeholder="${Number(s.minWithdraw) || 0}" oninput="syncWithdrawReceiveAmt()">
    </div>

    <div class="wit-fee">Fee: ${fee}%</div>
    <div class="form-hint" id="witReceiveHint" style="margin:0 0 8px;display:none;">You'll receive: <strong id="witReceiveAmt">${fmtUGX(0)}</strong></div>

    <button class="primary-button" id="witSubmitBtn" style="width:100%;height:54px;padding:0;font-size:17px;margin:14px 0 22px;" ${w && !_withdrawSubmitting ? '' : 'disabled'} onclick="submitWithdraw()">Confirm Withdraw</button>

    <div class="wit-instr withdrawal-guide">
      <h3>Before you cash out</h3>
      <dl>
        <div><dt>Receiving account</dt><dd>Check the name and ${w && !isMobileMoneyNetwork(w.network) ? 'bank account number' : 'mobile money number'} above. Your payout goes to this linked wallet.</dd></div>
        <div><dt>Amount to request</dt><dd>Minimum ${fmtUGX(s.minWithdraw)}${Number(s.maxWithdraw) > 0 ? `; maximum ${fmtUGX(s.maxWithdraw)}` : ''}. Review the fee and the amount you will receive before confirming.${Number(s.withdrawMultiple) > 0 ? ` Use a multiple of ${fmtUGX(s.withdrawMultiple)}.` : ''}</dd></div>
        <div><dt>Availability</dt><dd>${withdrawHoursLine(s)}${Number(s.maxWithdrawalsPerDay) > 0 ? ` Up to ${Number(s.maxWithdrawalsPerDay)} requests per day.` : ''}</dd></div>
        <div><dt>After submitting</dt><dd>Follow the payout in Transaction Statement → Withdrawals. Wait for a pending request to finish before submitting another.</dd></div>
      </dl>
    </div>
  </div>`;
}
function withdrawalFeePct(s){
  const value = Number(s && s.withdrawFeePct);
  return s && s.withdrawFeePct != null && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 15;
}
window.syncWithdrawReceiveAmt = function(){
  const el = $('witReceiveAmt');
  if (!el) return;
  const s = STATE.settings || {};
  const amount = parseMoneyInput($('witAmount').value);
  const fee = Math.round(amount * withdrawalFeePct(s) / 100);
  const net = Math.max(0, amount - fee);
  el.textContent = fmtUGX(net);
  // Hidden until there is an amount, so the resting screen shows just
  // "Fee: 15%" like the mockup, and the net figure appears exactly when it
  // becomes meaningful.
  const hint = $('witReceiveHint');
  if (hint) hint.style.display = amount > 0 ? '' : 'none';
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
  // Petro binds exactly ONE wallet, so there is no account picker to read --
  // the withdrawal always goes to the bound wallet the screen is showing.
  const acct = (STATE.bankAccounts || [])[0] || null;
  if (!amount || amount <= 0) return notify('Enter a valid amount.');
  // Mirrors the server's rule so the member is told BEFORE a round trip.
  // The server checks it again -- this is a courtesy, not the enforcement.
  const wMult = Math.max(0, Math.floor(Number((STATE.settings || {}).withdrawMultiple) || 0));
  if (wMult > 0 && amount % wMult !== 0) {
    const low = Math.floor(amount / wMult) * wMult, high = low + wMult;
    return notify(`Cash-out must be a multiple of ${fmtUGX(wMult)}. Try ${fmtUGX(low || high)} or ${fmtUGX(high)}.`);
  }
  if (!acct) return notify('Bind your wallet before withdrawing.');
  // Same courtesy for the hours: told here so the member is not asked to
  // wait on a request the server will refuse anyway.
  const win = withdrawWindow(STATE.settings || {});
  if (win.enabled && !win.open)
    return notify(`Cash-out is open from ${win.from} to ${win.to}. Please come back then.`);
  _withdrawSubmitting = true;
  submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';
  let r;
  try { r = await post('/withdraw/request', { amount, network: acct.network, phone: acct.phone }); }
  finally {
    _withdrawSubmitting = false;
    submitBtn.disabled = false; submitBtn.textContent = 'Confirm Withdraw';
    const current = $('witSubmitBtn');
    if (current && current !== submitBtn) current.disabled = !currentWallet();
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
  notify(`Cash-out of ${fmtUGXCents(amount)} is processing. You will receive `
    + `${fmtUGXCents(net)} after the ${pct}% charge.`,
    () => openBalanceRecordSheet('withdraw'));
  if (_openSheetTitle === 'Withdraw' && $('witSubmitBtn') === submitBtn) closeSheet({ fromAction: true });
  refreshAfterWithdraw();
};
// The catch-up after a cash-out, off the path between the server saying yes and
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
    <p class="confirm-sub">Review this asset before investing.</p>
    <div class="confirm-row"><span>Asset</span><b class="mono">${esc(p.name || 'Asset')}</b></div>
    <div class="confirm-row"><span>Cost</span><b class="mono">${fmtUGX(Number(p.price) || 0)}</b></div>
    <div class="confirm-row"><span>Term</span><b>${fig.cycle} Days</b></div>
    <div class="confirm-row"><span>Daily Yield</span><b class="mono">${fmtUGX(fig.daily)}</b></div>
    <div class="confirm-row"><span>Expected Return</span><b class="mono">${fmtUGX(fig.expected)}</b></div>
    <button class="primary-button" id="confirmActionBtn" style="width:100%;padding:15px 0;font-size:15px;margin-top:16px;">Invest Now</button>
    <button class="secondary-button" style="width:100%;padding:13px 0;font-size:14px;margin-top:10px;border:none;" onclick="closeConfirm()">Cancel</button>`;
  const actionBtn = $('confirmActionBtn');
  actionBtn.onclick = async () => {
    if (actionBtn.disabled) return;
    actionBtn.disabled = true; actionBtn.textContent = 'Investing…';
    const result = await api('/invest/create', { method:'POST', body:JSON.stringify({ tierKey }) });
    if (result.status !== 'success') {
      actionBtn.disabled = false; actionBtn.textContent = 'Invest Now';
      const short = result.code === 'INSUFFICIENT_BALANCE' || /^Need .*, have /.test(String(result.message || ''));
      if (short) {
        closeConfirm();
        notify('Insufficient balance, redirecting to deposit…', () => openDepositSheet());
        setTimeout(() => { if (_notifyOnClose) closeNotify(); }, 1800);
        return;
      }
      notify(result.message || 'Could not complete investment');
      return;
    }
    closeConfirm();
    showPage('home');
    notify(`${p.name} is now running. See it in My Assets below Daily Check-in.`);
  };
  $('confirmBg').classList.add('show');
  lockBodyScroll();
};
// Plain yes/no confirm, no PIN -- used where an action doesn't move money
// (e.g. removing a saved withdrawal account, see deleteWithdrawalAccount()).
// The actual money-moving confirm flows (Invest, Withdraw) have their own
// dedicated PIN-carrying dialogs and don't go through this.
function openSimpleConfirm(title, body, onConfirm){
  $('confirmSheet').innerHTML = `
    <h3>${esc(title)}</h3>
    <p class="confirm-sub" style="margin:0 0 14px;">${esc(body)}</p>
    <button class="primary-button" id="confirmActionBtn" style="width:100%;padding:15px 0;font-size:15px;">Confirm</button>
    <button class="secondary-button" style="width:100%;padding:13px 0;font-size:14px;margin-top:10px;border:none;" onclick="closeConfirm()">Cancel</button>`;
  const actionBtn = $('confirmActionBtn');
  actionBtn.onclick = async () => {
    if (actionBtn.disabled) return;
    actionBtn.disabled = true; actionBtn.textContent = 'Working…';
    try {
      const ok = await onConfirm();
      if (ok) { closeConfirm(); return; }
    } catch (_) {
      notify('Could not complete that action. Please try again.');
    } finally {
      // A successful action closes the dialog. Only restore this exact button
      // if this same dialog is still open (a new dialog may already exist).
      if ($('confirmBg').classList.contains('show') && $('confirmActionBtn') === actionBtn) {
        actionBtn.disabled = false;
        actionBtn.textContent = 'Confirm';
      }
    }
  };
  $('confirmBg').classList.add('show');
  lockBodyScroll();
}

// The Cancel button and backdrop both call this by name from inline markup.
// It must be a window property; a missing global here leaves confirmBg up and
// keeps the document's scroll lock active, which traps the member on screen.
window.closeConfirm = function(){
  $('confirmBg').classList.remove('show');
  $('confirmSheet').innerHTML = '';
  if (!isAnyOverlayOpen()) unlockBodyScroll();
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
  await window._installPrompt.userChoice.catch(() => {});
  window._installPrompt = null;
};
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
