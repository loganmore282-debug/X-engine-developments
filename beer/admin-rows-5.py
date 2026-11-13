#!/usr/bin/env python3
"""Batch 5: the last few the sweep turned up once the rest were in.

Each of these is here because find-admin-untranslated.py named it, not
because it looked likely. [english, lg, sw, fr, rw, nyn]
"""
ROWS = [
    ['Cash out', 'Ggyamu ssente', 'Toa pesa', 'Retirer', 'Bikuza', 'Ihamu sente'],
]

PATTERNS = [
    # The currency label is the region's own, so it is captured and copied
    # rather than written into the row -- "Amount (KES)" has to work too.
    ['Amount ({0})', 'Omuwendo ({0})', 'Kiasi ({0})', 'Montant ({0})', 'Umubare ({0})', 'Omubaro ({0})'],
    # A member's earnings, broken down by where each figure came from. Six
    # placeholders, and every one of them is money -- the words move, the
    # figures are copied across untouched.
    ['Investment cashback {0} · Referral commission {1} · Check-in {2} · Gift codes {3} · Task Center {4} · Mission Center {5}',
     'Ssente z\'ebyamaguzi {0} · Ssente z\'okuyita {1} · Okukyalira {2} · Koodi z\'ebirabo {3} · Ekifo ky\'emirimu {4} · Ekifo ky\'obulambuzi {5}',
     'Marejesho ya uwekezaji {0} · Kamisheni ya mialiko {1} · Kuhudhuria {2} · Misimbo ya zawadi {3} · Kituo cha kazi {4} · Kituo cha misheni {5}',
     'Remise d\'investissement {0} · Commission de parrainage {1} · Pointage {2} · Codes cadeaux {3} · Centre de tâches {4} · Centre de missions {5}',
     'Inyungu z\'ishoramari {0} · Komisiyo yo gutumira {1} · Kwiyandikisha {2} · Kode z\'impano {3} · Ikigo cy\'imirimo {4} · Ikigo cy\'ubutumwa {5}',
     'Sente z\'ebyamaguzi {0} · Sente z\'okweta {1} · Okwoleka {2} · Koodi z\'ebiconco {3} · Ekicweka ky\'emirimo {4} · Ekicweka ky\'obutumwa {5}'],
]
