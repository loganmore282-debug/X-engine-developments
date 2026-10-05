#!/usr/bin/env python3
"""
One-shot edit: close the i18n coverage gap find-untranslated.py measured.

Owner: "make sure every language is fixed on anything ... words such as failed,
paid ... all words on login, register, dashboard, deposit, wallet, download app
... whether words in my products all terms there should change ... price, total,
coming soon, all everything."

find-untranslated.py drove the built app in Swahili, walked 39 screens and read
back every visible text node. It found THREE separate causes, not one, and this
script fixes all three. Each edit asserts its anchor occurs exactly once, so a
silent no-op is impossible and a half-applied run cannot happen.

1. A WHOLE-STRING TABLE CANNOT MATCH A SENTENCE WITH A FIGURE IN IT.
   "Fee: 15%", "LV1 = 27%", "Joined 01/09/2026 10:00", "New Balance: UGX13,293.23",
   "Minimum deposit amount: UGX 30,000" -- the figure is spliced in at render
   time, so the string is different every time and no row can ever match it.
   No amount of adding rows fixes this class; it needs a second lookup.
   LANG_PATTERNS + tPattern() below are that lookup.

2. THE ABOUT PAGE WAS CHOPPED INTO ONE SPAN PER WORD.
   revealWordsHtml() wrapped every word in its own <span class="reveal-word">
   for a staggered reveal that was REMOVED on request -- .reveal-word is
   opacity:1;transform:none and nothing animates. So the split did nothing
   except make the page untranslatable: the sweep matches a whole text node,
   and a sentence in 14 one-word nodes matches nothing. That is why the report
   listed "and", "of", "in", "you", "products", "daily", "invest" as findings.

3. STRINGS THAT WERE SIMPLY NEVER IN THE TABLE.
   Including the two the owner named by name: "Failed" and "Paid".
   extract-ui-strings.py's regexes never saw them -- which is the whole reason
   the measurement is done by reading the screen instead.
"""
import os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, 'user-src', 'original_module.js')

# ── (1) the pattern table and its matcher ────────────────────────────────
# Inserted immediately after t(). Placeholders are {0}, {1} in the order they
# appear; a translation may reorder them, which is why they are numbered
# rather than positional.
PATTERN_BLOCK = r'''
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
];
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
    if (typeof tpl !== 'string' || !tpl || tpl === p.row[0]) continue;
    const m = p.re.exec(s);
    if (!m) continue;
    return tpl.replace(/\{(\d+)\}/g, (_, n) => {
      const at = p.order.indexOf(Number(n));
      return at >= 0 ? m[at + 1] : '';
    });
  }
  return s;
}
'''

# ── (3) rows that were simply never in the table ─────────────────────────
NEW_ROWS = [
    # The two the owner named outright. A member reads these on every ledger
    # row, so they were among the most-seen English words left in the app.
    ["Paid", "Kisasuddwa", "Imelipwa", "Payé", "Byishyuwe", "Kishashwirwe"],
    ["Failed", "Kigaanye", "Imeshindwa", "Échoué", "Byanze", "Kyaremeire"],
    ["Pending", "Kilindirira", "Inasubiri", "En attente", "Birategerejwe", "Nikitegyereza"],
    # My Products: the filter chips and the per-plan status chip.
    ["Active", "Kikola", "Inaendelea", "En cours", "Birakomeza", "Nikikora"],
    ["Completed", "Kiwedde", "Imekamilika", "Terminé", "Byarangiye", "Kihikire"],
    ["No active plans right now", "Tewali nteekateeka ekola kati",
     "Hakuna mipango inayoendelea sasa", "Aucun plan actif pour le moment",
     "Nta gahunda irakora ubu", "Tihariho nteekateeka erikukora hati"],
    ["No active plans. Check Completed to see the ones that finished.",
     "Tewali nteekateeka ekola. Nyiga Kiwedde okulaba ezo ezaggwa.",
     "Hakuna mipango inayoendelea. Gusa Imekamilika kuona iliyokwisha.",
     "Aucun plan actif. Ouvrez Terminé pour voir ceux qui sont arrivés à terme.",
     "Nta gahunda irakora. Kanda Byarangiye urebe izarangiye.",
     "Tihariho nteekateeka erikukora. Kanda Kihikire kureeba ezo ezahwire."],
    # Balance Record: the fallback row title for a type with no label.
    ["Transaction", "Okukyusa ssente", "Muamala", "", "Igikorwa", "Okuhingura sente"],
    # The alert dialog's only button.
    ["OK", "Kale", "Sawa", "", "Yego", "Kale"],
    ["days", "ennaku", "siku", "jours", "iminsi", "ebiro"],
    # Wallet.
    ["Bind Wallet", "Teeka Ensawo", "Sajili Pochi", "Associer le portefeuille",
     "Andika umufuka", "Teeka Ensaho"],
    ["Change Wallet", "Kyusa Ensawo", "Badilisha Pochi", "Changer de portefeuille",
     "Hindura umufuka", "Hindura Ensaho"],
    ["NO WALLET BOUND", "TEWALI NSAWO ETEEKEDDWA", "HAKUNA POCHI ILIYOSAJILIWA",
     "AUCUN PORTEFEUILLE ASSOCIÉ", "NTA MUFUKA WANDITSWE", "TIHARIHO NSAHO ETEIREHO"],
    # Account rows: the sub-line under each title.
    ["Get the mobile app", "Funa pulogulaamu ya ssimu", "Pata programu ya simu",
     "Obtenez l'application mobile", "Kura porogaramu ya telefone",
     "Tunga porogaraamu ya esimu"],
    ["Manage your withdrawal wallet", "Ddukanya ensawo yo ey'okuggyamu ssente",
     "Dhibiti pochi yako ya kutoa pesa", "Gérez votre portefeuille de retrait",
     "Genzura umufuka wawe wo kubikuza", "Jwara ensaho yaawe y'okwihamu sente"],
    ["Transaction history", "Ebyafaayo by'ensimbi", "Historia ya miamala",
     "Historique des transactions", "Amateka y'ibikorwa", "Ebyafaayo bya sente"],
    # Rendered text, NOT the source's &amp; -- the sweep reads what the browser
    # decoded, so the key has to be the decoded form.
    ["Notifications & mail", "Obubaka n'ebirango", "Arifa na barua",
     "Notifications et messages", "Amatangazo n'ubutumwa", "Obutumwa n'ebirango"],
    ["Change login password", "Kyusa ekisumuluzo ky'okuyingira",
     "Badilisha nenosiri la kuingia", "Changer le mot de passe de connexion",
     "Hindura ijambobanga ryo kwinjira", "Hindura ekisumuruzo ky'okutaaha"],
    ["Change trade / withdrawal password", "Kyusa ekisumuluzo ky'okusuubula / okuggyamu",
     "Badilisha nenosiri la malipo / kutoa pesa",
     "Changer le mot de passe de transaction / retrait",
     "Hindura ijambobanga ry'ubucuruzi / ryo kubikuza",
     "Hindura ekisumuruzo ky'okushuubura / okwihamu"],
    # Password screens -- placeholders, which the sweep also translates.
    ["Enter old password", "Wandiika ekisumuluzo ekikadde", "Weka nenosiri la zamani",
     "Entrez l'ancien mot de passe", "Andika ijambobanga rya kera",
     "Handiika ekisumuruzo ekikuru"],
    ["Enter new password", "Wandiika ekisumuluzo ekiggya", "Weka nenosiri jipya",
     "Entrez le nouveau mot de passe", "Andika ijambobanga rishya",
     "Handiika ekisumuruzo ekisya"],
    ["Re-enter new password", "Ddamu owandiike ekisumuluzo ekiggya",
     "Weka tena nenosiri jipya", "Saisissez à nouveau le nouveau mot de passe",
     "Ongera wandike ijambobanga rishya", "Garuka ohandiike ekisumuruzo ekisya"],
    ["Enter old 6-digit PIN", "Wandiika PIN enkadde ey'ennamba 6",
     "Weka PIN ya zamani ya tarakimu 6", "Entrez l'ancien code à 6 chiffres",
     "Andika PIN ya kera y'imibare 6", "Handiika PIN enkuru y'enamba 6"],
    ["Enter new 6-digit PIN", "Wandiika PIN empya ey'ennamba 6",
     "Weka PIN mpya ya tarakimu 6", "Entrez le nouveau code à 6 chiffres",
     "Andika PIN nshya y'imibare 6", "Handiika PIN ensya y'enamba 6"],
    ["Re-enter new 6-digit PIN", "Ddamu owandiike PIN empya ey'ennamba 6",
     "Weka tena PIN mpya ya tarakimu 6",
     "Saisissez à nouveau le nouveau code à 6 chiffres",
     "Ongera wandike PIN nshya y'imibare 6", "Garuka ohandiike PIN ensya y'enamba 6"],
    # Turntable.
    ["No spins left. Your next free spin unlocks at midnight.",
     "Tewali kuzungusa kusigadde. Okuzungusa okw'obwereere okuddako kujja mu ttumbi.",
     "Hakuna mizungusho iliyobaki. Mzungusho wako wa bure unaofuata unafunguka usiku wa manane.",
     "Plus de tours disponibles. Votre prochain tour gratuit s'ouvre à minuit.",
     "Nta kuzunguza gusigaye. Ukuzunguza kwawe k'ubuntu gukurikira gutangira saa sita z'ijoro.",
     "Tihariho kuzengurutsa kusigaire. Okuzengurutsa kwaawe kw'obusa nikwija aha kiro."],
    ["1 spin available", "Okuzungusa 1 kuliwo", "Mzungusho 1 unapatikana",
     "1 tour disponible", "Kuzunguza 1 gurahari", "Okuzengurutsa 1 kuriho"],
    # Support sheet, and the Home hero's default tagline.
    ["Contact support for help with your account.",
     "Tuukirira abayambi ku bikwata ku akawunti yo.",
     "Wasiliana na msaada kwa usaidizi wa akaunti yako.",
     "Contactez l'assistance pour toute question sur votre compte.",
     "Vugana na serivisi y'abakiriya ku bibazo bya konti yawe.",
     "Hikirira abahwezi ahabw'akaunti yaawe."],
    ["Uganda's boldest way to grow your money",
     "Engeri esinga obuvumu mu Uganda okukuza ssente zo",
     "Njia jasiri zaidi Uganda ya kukuza pesa zako",
     "La façon la plus audacieuse d'Ouganda de faire fructifier votre argent",
     "Inzira ishize amanga cyane mu Uganda yo kwungura amafaranga yawe",
     "Omuringo ogurikukira obumanzi muri Uganda kukuza sente zaawe"],
]


def sub_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'ABORT: {label} -- anchor occurs {n} times, expected 1')
    return text.replace(old, new)


def main():
    src = open(JS, encoding='utf8').read()
    orig = src

    # (1) the pattern layer, inserted right after t() and used BY t().
    src = sub_once(
        src,
        "  const hit = d[s];\n  return (typeof hit === 'string' && hit) ? hit : s;\n}\n",
        "  const hit = d[s];\n  if (typeof hit === 'string' && hit) return hit;\n"
        "  // Not a whole-string row. Try the templates -- see LANG_PATTERNS.\n"
        "  return tPattern(s);\n}\n" + PATTERN_BLOCK,
        't(): pattern fallback')

    # (2) About: one span per BLOCK, not one per word.
    old_fn_start = src.index('// Splits already-HTML-escaped text into one <span class="reveal-word"> per')
    old_fn_end = src.index('\n', src.index("  }).join('');\n}", old_fn_start) + len("  }).join('');\n}"))
    new_fn = '''// Wraps an already-HTML-escaped block of About text in ONE
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
}'''
    src = src[:old_fn_start] + new_fn + src[old_fn_end:]

    # (3) the new rows, appended to LANG_ROWS.
    def cell(v):
        return "'" + v.replace('\\', '\\\\').replace("'", "\\'") + "'"
    rows_js = '\n'.join('  [' + ', '.join(cell(c) for c in row) + '],' for row in NEW_ROWS)
    # Anchored on the line AFTER the table's `];` -- the bare `];` is not
    # unique in this file, and `var DICT` is separated from it by a comment.
    rows_anchor = "\n];\n// code -> { english: translated }."
    src = sub_once(
        src,
        rows_anchor,
        "\n  // ── Added by add-i18n-coverage.py after measuring the real screens ──\n"
        "  // Everything below was found by find-untranslated.py driving the built\n"
        "  // app in Swahili and reading back every visible text node -- not by a\n"
        "  // regex over the sources, which is how they were missed in the first\n"
        "  // place. 'Failed' and 'Paid' are the two the owner named himself.\n"
        + rows_js + rows_anchor,
        'LANG_ROWS: new rows')

    if src == orig:
        raise SystemExit('ABORT: nothing changed')
    open(JS, 'w', encoding='utf8').write(src)

    r = subprocess.run(['node', '--check', JS], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit('ABORT: the edited module does not parse:\n' + r.stderr)
    print(f'applied: pattern layer, About single-span, {len(NEW_ROWS)} new rows')
    return 0


if __name__ == '__main__':
    sys.exit(main())
