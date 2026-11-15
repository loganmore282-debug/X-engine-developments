"""Installs the debug APK on the running emulator, walks through the app the
way a student would, and saves a screenshot of each screen."""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

APK, OUT = sys.argv[1], Path(sys.argv[2])
PKG = "com.shulenotes.app"


def adb(*args, check=True, timeout=180):
    r = subprocess.run(["adb", *args], capture_output=True, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)} failed: {r.stderr.decode(errors='replace')}")
    return r.stdout


def nodes():
    for _ in range(5):
        adb("shell", "rm", "-f", "/sdcard/ui.xml", check=False)
        adb("shell", "uiautomator", "dump", "/sdcard/ui.xml", check=False)
        xml = adb("exec-out", "cat", "/sdcard/ui.xml", check=False).decode(errors="replace")
        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            time.sleep(1)
            continue
        found = []
        for n in root.iter("node"):
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds", ""))
            if m:
                found.append({
                    "text": n.get("text", ""), "desc": n.get("content-desc", ""),
                    "cls": n.get("class", ""), "box": tuple(int(v) for v in m.groups()),
                })
        return found
    return []


def find(label, prefix=False):
    for n in nodes():
        for value in (n["text"], n["desc"]):
            if value == label or (prefix and value.startswith(label)):
                return n
    return None


def wait_for(label, prefix=False, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        n = find(label, prefix)
        if n:
            return n
        time.sleep(1)
    raise RuntimeError(f"never saw {label!r} on screen")


def wait_gone(label, prefix=False, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        if not find(label, prefix):
            return
        time.sleep(1)
    raise RuntimeError(f"{label!r} never left the screen")


def tap(n):
    x1, y1, x2, y2 = n["box"]
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
    time.sleep(1)


def shot(name):
    (OUT / f"{name}.png").write_bytes(adb("exec-out", "screencap", "-p"))
    print("saved", name, flush=True)


def hide_keyboard():
    if b"mInputShown=true" in adb("shell", "dumpsys", "input_method", check=False):
        adb("shell", "input", "keyevent", "4")
        time.sleep(1)


def fields():
    found = sorted((n for n in nodes() if n["cls"] == "android.widget.EditText"), key=lambda n: n["box"][1])
    if not found:
        raise RuntimeError("no text fields on screen")
    return found


def type_into(index, text):
    tap(fields()[index])
    adb("shell", "input text '" + text.replace(" ", "%s") + "'")
    time.sleep(1)
    hide_keyboard()


def tidy_status_bar():
    adb("shell", "settings", "put", "global", "sysui_demo_allowed", "1", check=False)
    for extra in (["enter"], ["clock", "-e", "hhmm", "0900"], ["battery", "-e", "level", "100", "-e", "plugged", "false"],
                  ["network", "-e", "wifi", "show", "-e", "level", "4"], ["notifications", "-e", "visible", "false"]):
        adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", *extra, check=False)


def walk():
    adb("install", "-r", APK, timeout=600)
    tidy_status_bar()
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")

    wait_for("Sign in")
    shot("app-01-sign-in")

    tap(wait_for("New here? Create an account"))
    wait_for("Create your account")
    type_into(0, "Amina Nakato")
    type_into(1, "0772123456")
    type_into(2, "study2026")
    shot("app-02-create-account")
    tap(wait_for("Create account"))

    wait_for("Photosynthesis", prefix=True)
    time.sleep(2)
    shot("app-03-home")

    tap(wait_for("Biology"))
    wait_gone("Quadratic Equations", prefix=True)
    time.sleep(1)
    shot("app-04-one-subject")

    tap(wait_for("Photosynthesis", prefix=True))
    wait_for("Back")
    wait_gone("Opening document…")
    time.sleep(4)
    shot("app-05-reading-a-document")

    tap(wait_for("Ask AI"))
    wait_for("Ask a question about this document to get started.")
    shot("app-06-ask-ai")
    type_into(0, "What does a plant need for photosynthesis?")
    shot("app-07-question-typed")

    # No real Claude key exists in CI, so this only checks that a failed
    # answer shows a readable message instead of crashing.
    tap(wait_for("Send"))
    time.sleep(10)
    shot("check-ai-without-a-key")

    adb("shell", "input", "keyevent", "4")
    time.sleep(1)
    adb("shell", "input", "keyevent", "4")
    tap(wait_for("Log out"))
    wait_for("Sign in")
    type_into(0, "0772123456")
    type_into(1, "wrongpass")
    tap(wait_for("Sign in"))
    time.sleep(4)
    shot("check-wrong-password")


OUT.mkdir(parents=True, exist_ok=True)
try:
    walk()
except Exception as e:
    print("FAILED:", e, flush=True)
    shot("failed-here")
    (OUT / "failed-ui.xml").write_bytes(adb("exec-out", "cat", "/sdcard/ui.xml", check=False))
    raise
finally:
    (OUT / "logcat.txt").write_bytes(adb("logcat", "-d", "-t", "4000", check=False))
