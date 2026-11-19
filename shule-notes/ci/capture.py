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
        # A slow emulator sometimes freezes its own launcher or keyboard and
        # shows "... isn't responding" over the app; answer "Wait" and look again.
        if any("responding" in n["text"] for n in found):
            wait = next((n for n in found if n["text"] == "Wait"), None)
            if wait:
                x1, y1, x2, y2 = wait["box"]
                adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
                print("dismissed a system 'not responding' box", flush=True)
                time.sleep(2)
                continue
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


def reveal(label, tries=5):
    """Scrolls a long screen (the Profile tab) until `label` is on screen."""
    for _ in range(tries):
        n = find(label)
        if n:
            return n
        adb("shell", "input", "swipe", "540", "1900", "540", "700", "300")
        time.sleep(1)
    raise RuntimeError(f"could not scroll to {label!r}")


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


def type_into(index, text, tries=3):
    """Types into the index-th text field and CHECKS it arrived. A slow emulator sometimes
    drops the first characters; one dropped keystroke must not fail the whole run."""
    for attempt in range(tries):
        tap(fields()[index])
        adb("shell", "input text '" + text.replace(" ", "%s") + "'")
        time.sleep(1)
        hide_keyboard()
        shown = fields()[index]["text"]
        # A password field shows one bullet per character; an empty field shows its hint.
        if shown == text or (shown and set(shown) == {"\u2022"} and len(shown) == len(text)):
            return
        print(f"typing into field {index} went wrong (saw {shown!r}); clearing and trying again", flush=True)
        clear_field(index, length=len(text) + 12)
    raise RuntimeError(f"could not type {text!r} into field {index}")


def tidy_status_bar():
    adb("shell", "settings", "put", "global", "sysui_demo_allowed", "1", check=False)
    for extra in (["enter"], ["clock", "-e", "hhmm", "0900"], ["battery", "-e", "level", "100", "-e", "plugged", "false"],
                  ["network", "-e", "mobile", "hide"], ["network", "-e", "wifi", "show", "-e", "level", "4", "-e", "fully", "true"], ["notifications", "-e", "visible", "false"]):
        adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", *extra, check=False)


def clear_field(index, length=24):
    tap(fields()[index])
    adb("shell", "input", "keyevent", "123")
    adb("shell", "input", "keyevent", *["67"] * length)


def night(on):
    adb("shell", "cmd", "uimode", "night", "yes" if on else "no")
    time.sleep(4)


def walk():
    adb("install", "-r", APK, timeout=600)
    # Android 13+ asks "Allow notifications?" on Home; the walk is about the app, so say yes up front.
    adb("shell", "pm", "grant", PKG, "android.permission.POST_NOTIFICATIONS", check=False)
    tidy_status_bar()
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")

    # The splash screen: the logo on the brand green, for a moment, before the introduction.
    time.sleep(0.9)
    shot("app-00-splash")

    # First launch, never signed in: the introduction (the three slides made in the admin panel).
    wait_for("Continue")
    wait_for("Skip")
    time.sleep(2)
    shot("app-00-intro-1")
    tap(wait_for("Continue"))
    time.sleep(1.5)
    shot("app-00b-intro-2")
    tap(wait_for("Continue"))
    wait_for("Get started")
    time.sleep(1.5)
    shot("app-00c-intro-3")
    tap(wait_for("Get started"))

    wait_for("Sign in")
    time.sleep(1)
    shot("app-01-sign-in")

    tap(wait_for("Sign in"))
    wait_for("Enter your phone number")
    wait_for("Enter your password")
    shot("app-01b-empty-fields")

    tap(wait_for("Create an account"))
    wait_for("Create your account")
    type_into(0, "Amina Nakato")
    type_into(1, "0772123456")
    type_into(2, "study2026")
    shot("app-02-create-account")
    tap(wait_for("Create account"))

    # First run: the student says which class they are in.
    wait_for("Which class are you in?")
    time.sleep(1)
    shot("app-03-choose-class")
    tap(wait_for("Senior 2"))
    wait_for("Continue as Senior 2")
    shot("app-03b-class-chosen")
    tap(wait_for("Continue as Senior 2"))

    # Home shows the notes for Senior 2 only (and the ones for every class).
    wait_for("Notes for Senior 2")
    wait_for("Photosynthesis", prefix=True)
    wait_gone("Quadratic Equations", prefix=True)
    wait_for("Mock exams start on Monday")
    time.sleep(2)
    shot("app-04-home")

    # The bell: one unread announcement, then the notifications page.
    tap(wait_for("Notifications"))
    wait_for("New")
    time.sleep(1)
    shot("app-04a-notifications")
    adb("shell", "input", "keyevent", "4")
    wait_for("Notes for Senior 2")
    tap(wait_for("Dismiss"))
    wait_gone("Mock exams start on Monday")

    # Senior 2 has notes AND past papers: the filter chips appear.
    wait_for("Past papers")
    tap(wait_for("Past papers"))
    wait_for("Past papers", prefix=True)
    wait_gone("Photosynthesis", prefix=True)
    time.sleep(1)
    shot("app-04b-past-papers")
    # "All" is both a subject tile and a filter chip; the chip is the lower one.
    tap(sorted([n for n in nodes() if n["text"] == "All"], key=lambda n: n["box"][1])[-1])
    wait_for("Notes for Senior 2")
    wait_for("Photosynthesis", prefix=True)

    # Sort the list: the menu, then A to Z, then back to newest.
    tap(wait_for("Newest"))
    wait_for("A to Z")
    shot("app-04c-sort-menu")
    tap(wait_for("A to Z"))
    time.sleep(1)
    shot("app-04d-sorted-a-to-z")
    tap(wait_for("A to Z"))
    tap(wait_for("Newest"))
    time.sleep(1)

    tap(wait_for("Biology"))
    wait_gone("Acids, Bases and Salts", prefix=True)
    time.sleep(1)
    shot("app-05-one-subject")
    tap(wait_for("All"))
    wait_for("Acids, Bases and Salts", prefix=True)

    # A note from another class is not found by a search inside Senior 2 ...
    type_into(0, "newton")
    wait_for("No matches")
    shot("app-06-search-no-match")
    # ... until the student widens the search to every class.
    tap(wait_for("Search every class"))
    wait_for("Newton's Laws of Motion", prefix=True)
    shot("app-06b-search-every-class")
    tap(wait_for("Clear search"))
    wait_for("Photosynthesis", prefix=True)
    time.sleep(2)
    shot("app-06c-recent-searches")

    # Switch class from the header: another class has different notes.
    tap(wait_for("All classes"))
    wait_for("Choose your class")
    time.sleep(1)
    shot("app-07-class-sheet")
    tap(wait_for("Senior 3"))
    wait_for("Notes for Senior 3")
    wait_for("Quadratic Equations", prefix=True)
    wait_gone("Photosynthesis", prefix=True)
    time.sleep(1)
    shot("app-07b-another-class")

    # Each level has its own subjects, so its own set of icons.
    tap(wait_for("Senior 3"))
    wait_for("Choose your class")
    tap(wait_for("Primary 7"))
    wait_for("Notes for Primary 7")
    wait_for("Social Studies")
    time.sleep(1)
    shot("app-07c-primary-class")
    tap(wait_for("Primary 7"))
    wait_for("Choose your class")
    tap(wait_for("Senior 5"))
    wait_for("Notes for Senior 5")
    wait_for("General Paper")
    time.sleep(1)
    shot("app-07d-a-level-class")

    tap(wait_for("Senior 5"))
    wait_for("Choose your class")
    tap(wait_for("Senior 2"))
    wait_for("Notes for Senior 2")
    wait_for("Photosynthesis", prefix=True)

    tap(wait_for("Save note"))
    shot("app-05b-added-to-saved-message")
    wait_for("Remove from saved")
    tap(wait_for("Saved"))
    wait_for("Notes you bookmarked on this phone")
    wait_for("Photosynthesis", prefix=True)
    shot("app-08-saved")

    tap(wait_for("Profile"))
    wait_for("Change my name")
    wait_for("Senior 2")
    shot("app-09-profile")

    # The photo options (the logo is the default picture; the system photo picker itself is not driven here).
    tap(wait_for("Change profile photo"))
    wait_for("Choose from your photos")
    shot("app-09-photo-options")
    adb("shell", "input", "keyevent", "4")
    time.sleep(1)

    # Appearance: force dark, then put it back to follow the phone.
    tap(wait_for("Appearance"))
    wait_for("Light")
    shot("app-09a0-appearance")
    tap(wait_for("Dark"))
    time.sleep(2)
    shot("app-09a1-forced-dark")
    tap(wait_for("Appearance"))
    tap(wait_for("System default"))
    time.sleep(2)

    # Change the name.
    tap(wait_for("Change my name"))
    wait_for("Full name")
    clear_field(0, length=30)
    type_into(0, "Amina Joy Nakato")
    shot("app-09a-change-name")
    tap(wait_for("Save"))
    wait_for("Name updated")
    wait_for("Amina Joy Nakato")
    time.sleep(3)

    # Change the password: empty form, wrong current password, then the right one.
    tap(wait_for("Change password"))
    wait_for("Current password")
    buttons = [n for n in nodes() if n["text"] == "Change password"]
    tap(buttons[-1])
    wait_for("Enter your current password")
    shot("app-09b-change-password-errors")
    type_into(0, "not-my-password")
    type_into(1, "newpass2026")
    tap([n for n in nodes() if n["text"] == "Change password"][-1])
    wait_for("That is not your current password")
    shot("app-09c-wrong-current-password")
    clear_field(0, length=30)
    type_into(0, "study2026")
    tap([n for n in nodes() if n["text"] == "Change password"][-1])
    wait_for("Password changed")
    time.sleep(3)

    # Help and support shows the contacts set in the admin panel.
    tap(reveal("Help and support"))
    wait_for("+256 700 123 456")
    shot("app-09d-help-and-support")
    tap(wait_for("Close"))
    adb("shell", "input", "swipe", "540", "1900", "540", "700", "300")
    time.sleep(1)
    wait_for("Delete account")
    wait_for("Log out")
    shot("app-09e-profile-lower")

    # Send feedback to the owner.
    tap(reveal("Send feedback"))
    wait_for("Your message")
    type_into(0, "The page numbers are hard to see on my phone")
    shot("app-09f-feedback")
    tap(wait_for("Send"))
    wait_for("Thank you. We read every message.")
    time.sleep(3)

    tap(wait_for("Home"))
    tap(wait_for("Photosynthesis", prefix=True))
    wait_for("Back")
    wait_gone("Opening document…")
    wait_for("Ask AI")
    time.sleep(4)
    shot("app-10-reading-a-document")

    # Keep it for offline reading.
    tap(wait_for("Download for offline reading"))
    wait_for("Saved for offline reading")
    shot("app-10a-downloaded-for-offline")

    # Bookmark the page being read, then search inside the document.
    tap(wait_for("Bookmark this page"))
    wait_for("Page 1 bookmarked")
    shot("app-10b-page-bookmarked")
    tap(wait_for("Search in this document"))
    time.sleep(1)
    type_into(0, "plant")
    wait_for("Page", prefix=True)
    time.sleep(1)
    shot("app-10c-search-results")
    adb("shell", "input", "keyevent", "4")   # close the keyboard/search
    time.sleep(1)
    if find("Search in this document") is None:   # search page still open: close it
        adb("shell", "input", "keyevent", "4")
    wait_for("Ask AI")

    adb("shell", "input", "swipe", "540", "1700", "540", "500", "400")
    time.sleep(3)
    shot("app-11-further-down-the-document")

    # Two taps 0.1s apart, started together because each `input` takes longer than that to start.
    adb("shell", "input tap 540 1100 & sleep 0.1; input tap 540 1100; wait")
    time.sleep(4)
    shot("app-12-zoomed-in")
    adb("shell", "input tap 540 1100 & sleep 0.1; input tap 540 1100; wait")
    time.sleep(3)

    tap(wait_for("Ask AI"))
    wait_for("Summarise this document")
    shot("app-13-ask-ai")
    type_into(0, "What does a plant need for photosynthesis?")
    shot("app-14-question-typed")

    # No real Claude key exists in CI, so this only checks that a failed
    # answer shows a readable message instead of crashing.
    tap(wait_for("Send"))
    time.sleep(10)
    shot("check-ai-without-a-key")

    adb("shell", "input", "keyevent", "4")
    time.sleep(1)
    adb("shell", "input", "keyevent", "4")
    wait_for("Home")

    # Back on Home, the document just read is offered as "Continue reading".
    wait_for("Continue reading")
    time.sleep(1)
    shot("app-15-home-continue-reading")

    # The download is listed under Saved > Downloads.
    tap(wait_for("Saved"))
    tap(wait_for("Downloads (1)"))
    wait_for("Photosynthesis", prefix=True)
    shot("app-15a-downloads")
    tap(wait_for("Pages (1)"))
    wait_for("Photosynthesis", prefix=True)
    shot("app-15b-bookmarked-pages")

    # My progress: what the student has read.
    tap(wait_for("Profile"))
    tap(wait_for("My progress"))
    wait_for("day in a row")
    time.sleep(1)
    shot("app-15c-my-progress")
    adb("shell", "input", "keyevent", "4")
    wait_for("Appearance")
    tap(wait_for("Home"))

    night(True)
    wait_for("Photosynthesis", prefix=True)
    shot("app-16-home-dark")
    tap(wait_for("Photosynthesis", prefix=True))
    wait_for("Ask AI")
    time.sleep(4)
    shot("app-17-reading-dark")
    adb("shell", "input", "keyevent", "4")
    wait_for("Home")
    night(False)

    tap(wait_for("Profile"))
    tap(reveal("Delete account"))
    wait_for("Delete your account?")
    type_into(0, "not-my-password")
    tap(wait_for("Delete account"))
    wait_for("Incorrect password")
    shot("check-delete-account-wrong-password")
    tap(wait_for("Cancel"))

    tap(reveal("Log out"))
    wait_for("Log out?")
    shot("check-log-out-dialog")
    tap(wait_for("Log out"))
    wait_for("Welcome back")

    # Forgot password: the screen shows how to reach us.
    tap(wait_for("Forgot password?"))
    wait_for("Forgot your password?")
    wait_for("+256 700 123 456")
    shot("app-18a-forgot-password")
    tap(wait_for("Close"))

    type_into(0, "0772123456")
    type_into(1, "wrongpass")
    tap(wait_for("Sign in"))
    wait_for("Incorrect phone number or password")
    shot("app-18-wrong-password-message")

    # The same number written with its country code must reach the same account.
    clear_field(0)
    type_into(0, "+256772123456")
    clear_field(1)
    type_into(1, "newpass2026")
    tap(wait_for("Sign in"))
    wait_for("Photosynthesis", prefix=True)

    tap(wait_for("Profile"))
    tap(reveal("Delete account"))
    wait_for("Delete your account?")
    type_into(0, "newpass2026")
    tap(wait_for("Delete account"))
    wait_for("Welcome back")
    type_into(0, "0772123456")
    type_into(1, "study2026")
    tap(wait_for("Sign in"))
    wait_for("Incorrect phone number or password")
    shot("check-deleted-account-cannot-sign-in")


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
