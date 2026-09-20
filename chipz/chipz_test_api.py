"""The backend origin the BUILT app actually calls — derived, never written down.

WHY THIS EXISTS. Forty-eight browser harnesses each held their own copy of

    API = 'https://chipz-server.onrender.com'

and stubbed it with `page.route(f"{API}/**", ...)`. The moment the backend moved
to Railway, every one of those patterns matched nothing: the app called the new
origin, the stubs never fired, each API call went out unstubbed, and the screens
rendered with no data in them.

The failure gave almost no clue what had happened. Geometry assertions read
`0.0` (elements present in the DOM, laid out at zero size), a `bounding_box()`
came back `None`, and the traceback pointed at a subscript in the test —
`box["x"]` on a None — three steps away from the cause. Meanwhile `smoke-test.py`
kept passing, because it asserts on API_BASE itself rather than stubbing it.
Forty-eight harnesses can fail at once for one reason, and this project's own
notes already say so: that is an environment or fixture fault, not forty-eight
regressions.

`API_BASE` in user-src/original_module.js is the single source of truth --
set-backend-url.js rewrites it along with the other twelve references and
refuses to finish if any disagree. Reading it here means a harness stubs
whatever the app is actually going to call, on this host and on the next one.

Usage, replacing the old constant in place:

    from chipz_test_api import API
"""

import re
from pathlib import Path

# Path(__file__), never a checkout path: test-security-hardening.js fails any
# test file carrying an absolute /home, /Users or /root prefix, because a test
# that cannot move is only checking where it lives.
HERE = Path(__file__).resolve().parent


def api_origin():
    """The origin the built app calls, read out of API_BASE."""
    src = (HERE / 'user-src' / 'original_module.js').read_text(encoding='utf-8')
    m = re.search(r"var API_BASE = '([^']+)'", src)
    if not m:
        raise RuntimeError(
            'could not read API_BASE out of user-src/original_module.js -- '
            'if it was renamed, update chipz_test_api.py and set-backend-url.js together')
    return m.group(1).rstrip('/')


def admin_origin():
    """The origin the built ADMIN panel calls, read out of its own SERVER const.

    Kept separate rather than assumed equal: they are only ever the same
    because set-backend-url.js writes both, and a harness asserting they agree
    should be able to read each one on its own.
    """
    src = (HERE / 'admin-src' / 'index.html').read_text(encoding='utf-8')
    m = re.search(r"const SERVER = '([^']+)'", src)
    if not m:
        raise RuntimeError('could not read SERVER out of admin-src/index.html')
    return m.group(1).rstrip('/')


API = api_origin()
