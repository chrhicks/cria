"""Select the ASI220MM Mini in an open ZWO ASCOM Setup dialog, verifying the driver's own handler ran.

Only sends window messages to the Setup dialog of one given process. Never calls drivers,
the SDK or Cria, never presses Cancel, and never presses OK in the same invocation as selection.

  python zwo-setup-select.py inspect --pid N
  python zwo-setup-select.py select  --pid N
  python zwo-setup-select.py ok      --pid N

Not live-qualified: checked offline only (see LIMITATIONS).

Selection is accepted only when all of these hold after a synchronous CBN_SELCHANGE send:
  - the send returned within its timeout, so comboBox_Cameras_SelectedValueChanged (driver 6.5.41)
    finished; its open-failure MessageBox would block it and time the send out;
  - no new top-level window (MessageBox, WinForms exception dialog) belongs to the process;
  - the "Bayer Pattern:" label, visible for the color main camera, is hidden for the mono Mini
    (the handler hides it before assigning Settings.CamName, so it alone does not prove completion);
  - the native selected index and its item text name the Mini (not discriminating on their own:
    CB_SETCURSEL changes both before the handler runs).

LIMITATIONS
  - Cross-process CB_GETLBTEXT relies on Windows marshaling for the WinForms combo superclass;
    unverified here. Text reads use WM_GETTEXT and CB_GETLBTEXT through SendMessageTimeout.
  - Only the known mono ASI220MM Mini target with the color ASI2600MC Pro as the other camera is
    supported; the Bayer discriminant is meaningless for other pairs.
  - The handler's completion is inferred from the synchronous send returning, not observed in-process.
"""
import argparse
import ctypes
import datetime
import json
import sys
import time
from ctypes import wintypes

WM_GETTEXT = 0x000D
WM_GETTEXTLENGTH = 0x000E
WM_COMMAND = 0x0111
BM_CLICK = 0x00F5
CB_GETCOUNT = 0x0146
CB_GETCURSEL = 0x0147
CB_GETLBTEXT = 0x0148
CB_GETLBTEXTLEN = 0x0149
CB_SETCURSEL = 0x014E
CB_ERR = -1
CBN_SELCHANGE = 1
SMTO_ABORTIFHUNG = 0x0002
MAX_ITEMS = 16
MAX_TEXT = 256
MAX_WINDOWS = 4096
BAYER_PREFIX = "Bayer Pattern:"
TARGET = "ASI220MM Mini"
OTHER_CAMERA = "ASI2600MC Pro"

LRESULT = ctypes.c_ssize_t
# CFUNCTYPE only lets the module import off Windows for offline checks; Win32 calls need WINFUNCTYPE.
WNDENUMPROC = getattr(ctypes, "WINFUNCTYPE", ctypes.CFUNCTYPE)(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def command_wparam(control_id, notification):
    # WinForms child IDs are window handles and often exceed 16 bits; unmasked they corrupt the code.
    return ((notification & 0xFFFF) << 16) | (control_id & 0xFFFF)


def as_signed(value):
    return ctypes.c_ssize_t(value).value


def checked_count(value, limit):
    """Validate a signed CB_GETCOUNT/CB_GETLBTEXTLEN/WM_GETTEXTLENGTH result."""
    if value == CB_ERR or value < 0:
        raise ValueError("control returned error %d" % value)
    if value > limit:
        raise ValueError("control returned %d, above bound %d" % (value, limit))
    return value


def verify_selected(before, after, transition=True):
    """Return a list of reasons the managed selection is unverified; empty means verified.

    transition=True checks a selection change (before is the pre-selection state, whose Bayer label
    must have been visible); transition=False checks a stable already-selected state (OK phase).
    """
    reasons = []
    if after["messageBoxes"]:
        reasons.append("message box present: " + json.dumps(after["messageBoxes"]))
    if before is not None and after["topWindows"] != before["topWindows"]:
        reasons.append("top-level windows of the process changed")
    if after["targetIndex"] is None or after["selectedIndex"] != after["targetIndex"]:
        reasons.append("native selected index is not the target")
    if after["selectedIndex"] is None or not (0 <= after["selectedIndex"] < len(after["items"])) \
            or TARGET not in after["items"][after["selectedIndex"]]:
        reasons.append("selected item text does not name the target")
    if transition and before is not None and before["bayerVisible"] is not True:
        reasons.append("Bayer label was not visible beforehand; cannot discriminate")
    if after["bayerVisible"] is not False:
        reasons.append("Bayer label not hidden (handler did not refresh for mono target)")
    return reasons


class Win32:
    def __init__(self):
        u = ctypes.WinDLL("user32", use_last_error=True)
        self.user32 = u
        u.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]
        u.EnumWindows.restype = wintypes.BOOL
        u.EnumChildWindows.argtypes = [wintypes.HWND, WNDENUMPROC, wintypes.LPARAM]
        u.EnumChildWindows.restype = wintypes.BOOL
        u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        u.GetWindowThreadProcessId.restype = wintypes.DWORD
        u.IsWindowVisible.argtypes = [wintypes.HWND]
        u.IsWindowVisible.restype = wintypes.BOOL
        u.IsWindowEnabled.argtypes = [wintypes.HWND]
        u.IsWindowEnabled.restype = wintypes.BOOL
        u.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        u.GetClassNameW.restype = ctypes.c_int
        u.GetParent.argtypes = [wintypes.HWND]
        u.GetParent.restype = wintypes.HWND
        u.GetDlgCtrlID.argtypes = [wintypes.HWND]
        u.GetDlgCtrlID.restype = ctypes.c_int
        u.SendMessageTimeoutW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM,
                                          wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t)]
        u.SendMessageTimeoutW.restype = LRESULT

    def send(self, hwnd, msg, wparam, lparam, timeout_ms=15000):
        """Bounded synchronous send; returns the signed result."""
        result = ctypes.c_size_t()
        ok = self.user32.SendMessageTimeoutW(hwnd, msg, wparam, lparam, SMTO_ABORTIFHUNG, timeout_ms,
                                             ctypes.byref(result))
        if not ok:
            raise TimeoutError("SendMessageTimeout failed for message 0x%04x (error %d)"
                               % (msg, ctypes.get_last_error()))
        return as_signed(result.value)

    def text(self, hwnd):
        length = self.send(hwnd, WM_GETTEXTLENGTH, 0, 0, 3000)
        if length < 0:
            raise ValueError("WM_GETTEXTLENGTH returned %d" % length)
        length = min(length, MAX_TEXT)
        buf = ctypes.create_unicode_buffer(length + 1)
        self.send(hwnd, WM_GETTEXT, length + 1, ctypes.addressof(buf), 3000)
        return buf.value

    def cls(self, hwnd):
        buf = ctypes.create_unicode_buffer(256)
        self.user32.GetClassNameW(hwnd, buf, 256)
        return buf.value

    def pid_of(self, hwnd):
        pid = wintypes.DWORD()
        self.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return pid.value

    def _enumerate(self, parent):
        found = []

        def collect(hwnd, _):
            found.append(hwnd)
            return len(found) < MAX_WINDOWS

        callback = WNDENUMPROC(collect)
        if parent is None:
            self.user32.EnumWindows(callback, 0)
        else:
            self.user32.EnumChildWindows(parent, callback, 0)
        return found

    def top_windows(self, pid):
        return [h for h in self._enumerate(None) if self.pid_of(h) == pid and self.user32.IsWindowVisible(h)]

    def children(self, hwnd):
        return self._enumerate(hwnd)

    def combo_items(self, hwnd):
        count = checked_count(self.send(hwnd, CB_GETCOUNT, 0, 0, 3000), MAX_ITEMS)
        items = []
        for i in range(count):
            length = checked_count(self.send(hwnd, CB_GETLBTEXTLEN, i, 0, 3000), MAX_TEXT)
            buf = ctypes.create_unicode_buffer(length + 1)
            checked_count(self.send(hwnd, CB_GETLBTEXT, i, ctypes.addressof(buf), 3000), MAX_TEXT)
            items.append(buf.value)
        return items


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def inspect(w, pid):
    tops = w.top_windows(pid)
    boxes = [{"title": w.text(h), "text": [t for t in (w.text(c) for c in w.children(h)) if t]}
             for h in tops if w.cls(h) == "#32770"]
    dialogs = []
    for h in tops:
        for c in w.children(h):
            if "COMBOBOX" not in w.cls(c).upper():
                continue
            try:
                items = w.combo_items(c)
            except ValueError:
                continue
            if any(OTHER_CAMERA in i for i in items) and any(TARGET in i for i in items):
                dialogs.append((h, c, items))
    state = {"at": now(), "pid": pid, "topWindows": sorted(int(h) for h in tops),
             "messageBoxes": boxes, "dialogCount": len(dialogs)}
    if len(dialogs) != 1:
        return state, None
    form, combo, items = dialogs[0]
    kids = w.children(form)
    bayer = [c for c in kids if w.text(c).startswith(BAYER_PREFIX)]
    ok_buttons = [c for c in kids if "BUTTON" in w.cls(c).upper() and w.text(c) == "OK"]
    matches = [i for i, item in enumerate(items) if TARGET in item]
    selected = w.send(combo, CB_GETCURSEL, 0, 0, 3000)
    state.update({
        "formTitle": w.text(form),
        "items": items,
        "targetIndex": matches[0] if len(matches) == 1 else None,
        "selectedIndex": None if selected == CB_ERR else selected,
        "comboText": w.text(combo),
        "comboEnabled": bool(w.user32.IsWindowEnabled(combo)),
        "bayerLabels": len(bayer),
        "bayerVisible": bool(w.user32.IsWindowVisible(bayer[0])) if len(bayer) == 1 else None,
        "okButtons": len(ok_buttons),
    })
    return state, {"form": form, "combo": combo, "ok": ok_buttons[0] if len(ok_buttons) == 1 else None}


def settle(w, pid, before, seconds):
    deadline = time.monotonic() + seconds
    while True:
        after, handles = inspect(w, pid)
        reasons = ["Setup dialog not uniquely found"] if handles is None else verify_selected(before, after)
        if not reasons or time.monotonic() >= deadline or after["messageBoxes"]:
            return after, reasons
        time.sleep(0.25)


def main(argv=None, win32=None):
    p = argparse.ArgumentParser()
    p.add_argument("phase", choices=["inspect", "select", "ok"])
    p.add_argument("--pid", type=int, required=True)
    p.add_argument("--target", default=TARGET, choices=[TARGET],
                   help="only the mono ASI220MM Mini is supported")
    p.add_argument("--settle-seconds", type=float, default=10)
    a = p.parse_args(argv)
    w = win32 or Win32()
    out = {"phase": a.phase, "target": TARGET}

    def finish(status, **extra):
        out.update(status=status, **extra)
        print(json.dumps(out, indent=2))
        sys.exit(0 if status in ("inspected", "selected-verified", "ok-pressed") else 2)

    try:
        before, handles = inspect(w, a.pid)
    except (TimeoutError, ValueError) as e:
        finish("aborted", reasons=["inspection failed: %s" % e])
    out["before"] = before

    if a.phase == "inspect":
        finish("inspected")
    if handles is None or before["messageBoxes"]:
        finish("aborted", reasons=["Setup dialog not uniquely found or message box present"])

    if a.phase == "select":
        problems = []
        if before["targetIndex"] is None:
            problems.append("target not uniquely listed")
        if not before["comboEnabled"]:
            problems.append("combo disabled; handler would take the connected-camera branch")
        if before["bayerVisible"] is not True:
            problems.append("Bayer label not visible beforehand; cannot discriminate")
        if before["selectedIndex"] == before["targetIndex"]:
            problems.append("target already selected; no change event would prove the handler ran")
        if problems:
            finish("aborted", reasons=problems)
        combo = handles["combo"]
        try:
            w.send(combo, CB_SETCURSEL, before["targetIndex"], 0, 3000)
            control_id = w.user32.GetDlgCtrlID(combo)
            out["notify"] = {"at": now(), "controlId": control_id,
                             "wParam": command_wparam(control_id, CBN_SELCHANGE)}
            w.send(w.user32.GetParent(combo), WM_COMMAND, out["notify"]["wParam"], combo)
            out["notify"]["returnedAt"] = now()
        except TimeoutError as e:
            out["notify"] = dict(out.get("notify", {}), error=str(e))
            try:
                out["after"], _ = inspect(w, a.pid)
            except (TimeoutError, ValueError) as e2:
                out["afterError"] = str(e2)
            finish("aborted", reasons=["selection send did not complete; handler may be blocked"])
        after, reasons = settle(w, a.pid, before, a.settle_seconds)
        out["after"] = after
        finish("selected-verified" if not reasons else "aborted", reasons=reasons)

    # ok: fresh, stable re-inspection; the Bayer label must already be hidden for the mono target.
    first = verify_selected(None, before, transition=False)
    time.sleep(0.5)
    try:
        again, handles = inspect(w, a.pid)
    except (TimeoutError, ValueError) as e:
        finish("aborted", reasons=first + ["re-inspection failed: %s" % e])
    out["recheck"] = again
    second = ["Setup dialog not uniquely found"] if handles is None else verify_selected(before, again, transition=False)
    if first or second or handles["ok"] is None:
        finish("aborted", reasons=first + second + ([] if handles and handles["ok"] else ["OK button not unique"]))
    out["okAt"] = now()
    try:
        w.send(handles["ok"], BM_CLICK, 0, 0)
    except TimeoutError as e:
        finish("ok-uncertain", reasons=["OK send did not complete: %s; do not resend" % e])
    finish("ok-pressed")


if __name__ == "__main__":
    main()
