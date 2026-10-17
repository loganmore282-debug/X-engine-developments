#!/usr/bin/env python3
"""
One-shot edit: the popup messages and the activity ticker.

Owner: "I am sure you didn't even change the language of some instructions,
popup notifies (warning triangle) still in English, even make sure on currency
change the activity checker should be changing currency too basing on the
products and values of the system."

He is right on both, and the reason the last round's sweep said zero is worth
recording, because it is the same lesson for the third time:

  A POPUP ONLY APPEARS WHEN SOMETHING GOES WRONG. find-untranslated.py walks
  40 screens, but it walks them SUCCESSFULLY -- it never submits a blank
  amount, never mistypes a password, never gets a refusal back from the
  server. So 58 notify() call sites existed and exactly one of them had ever
  been on screen while anything was measuring, and that one was passed a
  string from the table.

Auditing the call sites by extracting their arguments found 17 plain messages
with no row and 6 built with a figure in them, which need templates. The
activity ticker's own two verbs ("topped up" / "cashed out") had never
rendered either -- the fixture fed it an EMPTY feed.

Every edit asserts its anchor occurs exactly once.
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, 'user-src', 'original_module.js')

# ── plain popup messages, and the ticker's two verbs ─────────────────────
ROWS = [
    # Failure popups. Each is the app's own fallback for when the server sends
    # no message of its own, so these are exactly what a member reads when
    # something has gone wrong -- the worst possible moment to be handed a
    # sentence in the wrong language.
    ["Could not load your account", "Tetusobodde kuzuula akawunti yo",
     "Imeshindwa kupakia akaunti yako", "Impossible de charger votre compte",
     "Ntibyashobotse gupakira konti yawe", "Tikibaasiikire kureeta akaunti yaawe"],
    ["Could not complete registration", "Tetusobodde kumaliriza kwewandiisa",
     "Imeshindwa kukamilisha usajili", "Impossible de finaliser l'inscription",
     "Ntibyashobotse kurangiza kwiyandikisha", "Tikibaasiikire kumaliriza okwehandiisa"],
    ["Could not save your wallet.", "Tetusobodde kutereka nsawo yo.",
     "Imeshindwa kuhifadhi pochi yako.", "Impossible d'enregistrer votre portefeuille.",
     "Ntibyashobotse kubika umufuka wawe.", "Tikibaasiikire kubiika ensaho yaawe."],
    ["Could not start recharge", "Tetusobodde kutandika kuteeka ssente",
     "Imeshindwa kuanza kuweka pesa", "Impossible de démarrer la recharge",
     "Ntibyashobotse gutangira kubitsa", "Tikibaasiikire kutandika kuta sente"],
    ["Could not request withdrawal.", "Tetusobodde kusaba kuggyamu ssente.",
     "Imeshindwa kuomba kutoa pesa.", "Impossible de demander le retrait.",
     "Ntibyashobotse gusaba kubikuza.", "Tikibaasiikire kushaba okwihamu sente."],
    ["Could not complete purchase", "Tetusobodde kumaliriza kugula",
     "Imeshindwa kukamilisha ununuzi", "Impossible de finaliser l'achat",
     "Ntibyashobotse kurangiza kugura", "Tikibaasiikire kumaliriza okugura"],
    ["Could not check in", "Tetusobodde kukyalira", "Imeshindwa kuhudhuria",
     "Impossible de pointer", "Ntibyashobotse kwiyandikisha", "Tikibaasiikire kwoleka"],
    ["Could not change your trade password.",
     "Tetusobodde kukyusa kisumuluzo kyo eky'okusuubula.",
     "Imeshindwa kubadilisha nenosiri lako la malipo.",
     "Impossible de changer votre mot de passe de transaction.",
     "Ntibyashobotse guhindura ijambobanga ryawe ry'ubucuruzi.",
     "Tikibaasiikire kuhindura ekisumuruzo kyaawe ky'okushuubura."],
    ["Could not check right now", "Tetusobodde kukebera kati",
     "Imeshindwa kuangalia kwa sasa", "Vérification impossible pour le moment",
     "Ntibyashobotse kugenzura ubu", "Tikibaasiikire kureeba hati"],
    ["Could not submit this right now", "Tetusobodde kusindika kino kati",
     "Imeshindwa kuwasilisha hili kwa sasa", "Envoi impossible pour le moment",
     "Ntibyashobotse kohereza ibi ubu", "Tikibaasiikire kutuma eki hati"],
    ["That is not your current login password.",
     "Ekyo si kisumuluzo kyo kya kati eky'okuyingira.",
     "Hilo si nenosiri lako la sasa la kuingia.",
     "Ce n'est pas votre mot de passe de connexion actuel.",
     "Iryo si ijambobanga ryawe rigezweho ryo kwinjira.",
     "Ekyo tikisumuruzo kyaawe kya hati eky'okutaaha."],
    ["That key did not open the chest.", "Ekisumuluzo ekyo tekiggudde ssanduku.",
     "Ufunguo huo haukufungua sanduku.", "Cette clé n'a pas ouvert le coffre.",
     "Urwo rufunguzo ntirwafunguye agasanduku.", "Ekishumuruzo ekyo tikyigwire esanduuku."],
    ["The spin could not be completed.", "Okuzungusa tekusobose kuggwa.",
     "Mzungusho haukukamilika.", "Le tour n'a pas pu être terminé.",
     "Ukuzunguza ntikwashoboye kurangira.", "Okuzengurutsa tikibaasiikire kuhika."],
    ["That referral code is invalid -- continuing without it.",
     "Koodi y'okuyita eyo si ntuufu -- tugenda mu maaso nga tetugikozesa.",
     "Msimbo huo wa mwaliko si sahihi -- tunaendelea bila huo.",
     "Ce code de parrainage est invalide -- nous continuons sans lui.",
     "Iyo kode yo gutumira ntiyemewe -- turakomeza tutayikoresheje.",
     "Koodi y'okweta egyo tehikire -- nitugyenda omu maisho tutarikugikozesa."],
    ["Not confirmed yet. Paste the payment message below and submit it.",
     "Tekinnakakasibwa. Teeka obubaka bw'okusasula wammanga obusindike.",
     "Bado haijathibitishwa. Bandika ujumbe wa malipo hapa chini na uwasilishe.",
     "Pas encore confirmé. Collez le message de paiement ci-dessous et envoyez-le.",
     "Ntibirasuzumwa. Shyiramo ubutumwa bwo kwishyura hasi maze ubwohereze.",
     "Tikirahamibwa. Ota obutumwa bw'okushashura ahansi kandi obutume."],
    ["Submitted", "Kisindikiddwa", "Imewasilishwa", "Envoyé", "Byoherejwe", "Kitumirwe"],
    # The Home activity ticker. Its two verbs had never been measured at all,
    # because the coverage fixture fed the ticker an EMPTY feed.
    ["topped up", "yateekamu ssente", "ameweka pesa", "a rechargé",
     "yabitsa", "yaateeramu sente"],
    ["cashed out", "yaggyamu ssente", "ametoa pesa", "a retiré",
     "yabikuje", "yaayihamu sente"],
    ["just deposited", "yaakateekamu ssente", "ameweka pesa hivi punde",
     "vient de recharger", "aherutse kubitsa", "yaahingwire kuteeramu sente"],
    ["just withdrew", "yaakaggyamu ssente", "ametoa pesa hivi punde",
     "vient de retirer", "aherutse kubikuza", "yaahingwire kwihamu sente"],
]

# ── popup messages with a figure spliced in ──────────────────────────────
PATTERNS = [
    ["Check-in successful. {0} added to your wallet",
     "Okukyalira kugenze bulungi. {0} zeeyongedde mu nsawo yo",
     "Kuhudhuria kumefanikiwa. {0} zimeongezwa kwenye pochi yako",
     "Pointage réussi. {0} ajoutés à votre portefeuille",
     "Kwiyandikisha byagenze neza. {0} yongewe ku mufuka wawe",
     "Okwoleka kugyenzire gye. {0} zeeyongyeire omu nsaho yaawe"],
    ["Cash-out must be a multiple of {0}. Try {1} or {2}.",
     "Okuggyamu kulina kuba kwa {0}. Gezaako {1} oba {2}.",
     "Kutoa pesa lazima kiwe kizidishi cha {0}. Jaribu {1} au {2}.",
     "Le retrait doit être un multiple de {0}. Essayez {1} ou {2}.",
     "Kubikuza bigomba kuba umubare ushobora kugabanywa na {0}. Gerageza {1} cyangwa {2}.",
     "Okwihamu kushemereire kuba kwa {0}. Gyezaho {1} nari {2}."],
    ["Cash-out is open from {0} to {1}. Please come back then.",
     "Okuggyamu ssente kuggulwa okuva ku {0} okutuuka {1}. Ddamu okomewo mu budde obwo.",
     "Kutoa pesa kunapatikana kuanzia {0} hadi {1}. Tafadhali rudi wakati huo.",
     "Le retrait est ouvert de {0} à {1}. Merci de revenir à ce moment-là.",
     "Kubikuza bifungura kuva {0} kugeza {1}. Ongera ugaruke icyo gihe.",
     "Okwihamu sente nikwigurwa kuruga aha {0} kuhika {1}. Ogaruke omu bwire obu."],
    ["Cash-out of {0} is processing. You will receive {1} after the {2}% charge.",
     "Okuggyamu {0} kukolebwako. Ojja kufuna {1} oluvannyuma lw'ossente z'obuweereza eza {2}%.",
     "Kutoa {0} kunashughulikiwa. Utapokea {1} baada ya ada ya {2}%.",
     "Le retrait de {0} est en cours. Vous recevrez {1} après les frais de {2} %.",
     "Kubikuza {0} birimo gutunganywa. Uzabona {1} nyuma y'amafaranga ya serivisi ya {2}%.",
     "Okwihamu {0} nikukorwaho. Noija kutunga {1} bwanyima ya sente z'obuheereza eza {2}%."],
    ["{0} is now running. You will find it under My Products.",
     "{0} kitandise. Ojja kukisanga mu Byamaguzi Byange.",
     "{0} sasa inaendelea. Utaipata chini ya Bidhaa Zangu.",
     "{0} est maintenant actif. Vous le trouverez dans Mes produits.",
     "{0} ubu birakora. Uzabisanga muri Ibicuruzwa Byanjye.",
     "{0} kitandikire. Noija kukishanga omu Byamaguzi Byangye."],
    # The old ROW for this could never match: the rendered sentence carries the
    # brand name and a full stop, so it was a row that looked filled and had
    # never once applied. It is a template now, and the dead row is removed.
    ["Already installed, or your browser doesn't support installing {0}.",
     "Eteekeddwawo dda, oba browser yo teteeka {0}.",
     "Tayari imesakinishwa, au kivinjari chako hakiruhusu kusakinisha {0}.",
     "Déjà installée, ou votre navigateur ne permet pas d'installer {0}.",
     "Yamaze gushyirwaho, cyangwa mushakisha wawe ntiyemera gushyiraho {0}.",
     "Eteirweho, nari browser yaawe teine bushoboorozi bw'okuteeraho {0}."],
]


def sub_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'ABORT: {label} -- anchor occurs {n} times, expected 1')
    return text.replace(old, new)


def cell(v):
    return "'" + v.replace('\\', '\\\\').replace("'", "\\'") + "'"


def main():
    src = open(JS, encoding='utf8').read()

    # The dead row: it lacks the brand name the rendered sentence carries, so
    # it could never match anything. Replaced by a template below.
    dead = [l for l in src.split('\n')
            if "['Already installed, or your browser doesn\\'t support installing'" in l]
    if len(dead) != 1:
        raise SystemExit(f'ABORT: expected 1 dead install row, found {len(dead)}')
    src = src.replace(dead[0] + '\n', '')

    rows_js = '\n'.join('  [' + ', '.join(cell(c) for c in r) + '],' for r in ROWS)
    src = sub_once(
        src, "\n];\n// code -> { english: translated }.",
        "\n  // ── Popup messages, and the activity ticker's own verbs ──\n"
        "  // A popup only appears when something goes WRONG, and the coverage\n"
        "  // sweep walks every screen successfully -- so 58 notify() call sites\n"
        "  // existed and exactly one had ever been on screen while anything was\n"
        "  // measuring. Found by extracting the arguments of every call site\n"
        "  // instead. The ticker verbs had never rendered either: its fixture\n"
        "  // fed it an empty feed.\n"
        + rows_js + "\n];\n// code -> { english: translated }.",
        'LANG_ROWS: popup + ticker rows')

    pats_js = '\n'.join('  [' + ', '.join(cell(c) for c in r) + '],' for r in PATTERNS)
    src = sub_once(
        src, "\n];\n// Compiled once. Sorted by how much LITERAL text",
        "\n  // Popup messages carrying a figure. Same rule as every template\n"
        "  // here: only the words translate, and whatever {0} captured -- an\n"
        "  // amount, a percentage, a time, a product name -- is copied across\n"
        "  // verbatim.\n"
        + pats_js + "\n];\n// Compiled once. Sorted by how much LITERAL text",
        'LANG_PATTERNS: popup templates')

    open(JS, 'w', encoding='utf8').write(src)
    r = subprocess.run(['node', '--check', JS], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit('ABORT: the edited module does not parse:\n' + r.stderr)
    print(f'applied: {len(ROWS)} rows, {len(PATTERNS)} patterns, 1 dead row removed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
