#!/usr/bin/env python3
"""
Catches the one mistake a brace count cannot: a method that is CALLED but no
longer DEFINED.

An edit that removes a method leaves the file perfectly balanced, so the
structural check passes and the mistake only surfaces 30 seconds into a CI
Gradle run as "cannot find symbol". This finds it in under a second.

Deliberately conservative: it only looks at bare calls -- name(...) with no
receiver -- since those must resolve inside the class or its superclass, and
it allowlists the Activity/Object methods this app inherits. It is a
tripwire, not a compiler.
"""
import glob, re, sys

INHERITED = {
    # android.app.Activity / Context / Object, plus language constructs
    'super', 'this', 'if', 'for', 'while', 'switch', 'catch', 'return', 'new',
    'checkSelfPermission', 'requestPermissions', 'getSystemService', 'getResources',
    'startForeground', 'startService', 'stopService', 'startActivity', 'addContentView',
    'setContentView', 'runOnUiThread', 'isFinishing', 'getApplicationContext',
    'registerReceiver', 'unregisterReceiver', 'getPackageName', 'getPackageManager',
    'onCreate', 'onDestroy', 'onStartCommand', 'onBind', 'onReceive',
    'onRequestPermissionsResult', 'getSharedPreferences', 'getExternalFilesDir',
    'stopSelf', 'getContentResolver', 'equals', 'hashCode', 'toString', 'valueOf',
    'format', 'String', 'Integer', 'Math', 'Thread', 'assert', 'synchronized',
    'try',   # try-with-resources reads as a call
}

bad = 0
for f in sorted(glob.glob('app/src/main/java/**/*.java', recursive=True)):
    src = open(f).read()
    # Strings FIRST, then comments. The other order destroys a string
    # containing "https://..." -- the // eats the rest of the line including
    # its closing quote, and every quote pair after it misaligns.
    body = re.sub(r'"(\\.|[^"\\])*"', '""', src)
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    body = re.sub(r'//[^\n]*', '', body)

    defined = set(re.findall(r'(?:public|private|protected|static|final|\s)+[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*\{', body))
    defined |= set(re.findall(r'\b(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\{', body))
    # Interface and abstract declarations end in ';' and are not calls.
    defined |= set(re.findall(r'\b\w[\w<>\[\].]*\s+(\w+)\s*\([^)]*\)\s*;', body))

    called = set()
    for m in re.finditer(r'(?<![\w.])(\w+)\s*\(', body):
        name = m.group(1)
        start = m.start(1)
        before = body[max(0, start-8):start]
        if before.rstrip().endswith('new'):
            continue
        called.add(name)

    missing = sorted(n for n in called - defined - INHERITED
                     if n[0].islower() and n not in ('int', 'long', 'boolean', 'byte', 'char', 'float', 'double', 'void'))
    if missing:
        print('MISSING in', f, '->', ', '.join(missing))
        bad += 1

print('symbol check clean' if not bad else 'SYMBOL PROBLEMS')
sys.exit(1 if bad else 0)
