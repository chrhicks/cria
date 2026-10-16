"""Pick a camera in an open ZWO ASCOM Setup dialog and press OK, for either ZWO camera.

  python zwo-setup-select-both.py --pid N --target "ASI2600MC Pro"
  python zwo-setup-select-both.py --pid N --target "ASI220MM Mini"

N is the Cria.Driver.Windows worker process showing the dialog: the one whose MainWindowTitle is
"ASICamera Setup V6.5.41", matched to a device by `deviceId` in that worker's process.json.

Reuses the window code of zwo-setup-select.py beside it. Unlike that script's separate select and ok phases,
this does both in one run: it selects the target, re-reads the dialog twice, and presses OK only if the dialog is
the expected one, no message box appeared, the selection stuck, and the Bayer label matches the camera (visible for
the color ASI2600MC Pro, hidden or absent for the mono ASI220MM Mini). Any failed check exits without pressing OK.
Only sends window messages to that process's Setup dialog; never calls drivers, the SDK or Cria.
"""
import argparse
import importlib.util
import json
import os
import time

CAMERAS = ['ASI2600MC Pro', 'ASI220MM Mini']
FORM_TITLE = 'ASICamera Setup V6.5.41'

source = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'zwo-setup-select.py')
spec = importlib.util.spec_from_file_location('zwo', source)
z = importlib.util.module_from_spec(spec)
spec.loader.exec_module(z)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--pid', type=int, required=True)
    p.add_argument('--target', choices=CAMERAS, required=True)
    a = p.parse_args()
    z.TARGET = a.target
    z.OTHER_CAMERA = next(c for c in CAMERAS if c != a.target)
    want_bayer = a.target == 'ASI2600MC Pro'

    def bayer_ok(state):
        if want_bayer:
            return state['bayerVisible'] is True
        return state['bayerVisible'] is False or state['bayerLabels'] == 0

    w = z.Win32()
    before, h = z.inspect(w, a.pid)
    if h is None or before['messageBoxes'] or before['formTitle'] != FORM_TITLE:
        raise SystemExit('Dialog not uniquely verified')
    if before['targetIndex'] is None or not before['comboEnabled']:
        raise SystemExit('Target unavailable')
    if before['selectedIndex'] != before['targetIndex']:
        w.send(h['combo'], z.CB_SETCURSEL, before['targetIndex'], 0, 3000)
        control_id = w.user32.GetDlgCtrlID(h['combo'])
        w.send(w.user32.GetParent(h['combo']), z.WM_COMMAND, z.command_wparam(control_id, z.CBN_SELCHANGE), h['combo'])

    after, h = z.inspect(w, a.pid)
    if (h is None or after['messageBoxes'] or after['topWindows'] != before['topWindows']
            or after['selectedIndex'] != after['targetIndex'] or a.target not in after['items'][after['selectedIndex']]
            or not bayer_ok(after) or h['ok'] is None):
        raise SystemExit('Selection verification failed')

    time.sleep(.2)
    again, h = z.inspect(w, a.pid)
    if again['selectedIndex'] != after['selectedIndex'] or not bayer_ok(again) or again['messageBoxes']:
        raise SystemExit('Selection changed')

    w.send(h['ok'], z.BM_CLICK, 0, 0)
    print(json.dumps({'pid': a.pid, 'target': a.target, 'selectionVerified': True, 'okPressed': True}), flush=True)


if __name__ == '__main__':
    main()
