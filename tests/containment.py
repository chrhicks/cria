"""Keep deliberately aborting test processes out of desktop crash reporting.

Only one check aborts on purpose: the immutable protocol 2 binary refusing a migrated store, which
it cannot do without an unhandled-exception abort. Current Cria binaries refuse cleanly instead.

On Linux the kernel hands each core dump to /proc/sys/kernel/core_pattern. On Polaris that pipes
to systemd-coredump, whose journal entry (MESSAGE_ID below) Omarchy's crash watcher announces.
RLIMIT_CORE=0 does not stop a pipe dump: the helper still runs and journals the crash. For a pipe
pattern the kernel refuses the dump *before* starting the helper when the crashing process has
RLIMIT_CORE exactly 1 (fs/coredump.c, coredump_pipe, checked in Linux 7.2). For a file pattern a
zero limit writes no core. A socket pattern ('@') or an unreadable pattern has no process-local
opt-out, so an intentional abort is skipped there rather than risk an alert. Nothing global is
changed: the limit applies only to the child process and what it executes.
"""
import pathlib, resource, shutil, subprocess, time

COREDUMP_MESSAGE_ID = 'fc2e22bc6ee647b6b90729ab34a250b1'  # systemd.journal-fields(7)

def core_limit():
    """(limit, reason): the process-local RLIMIT_CORE that prevents a reported dump, or None."""
    try: pattern = pathlib.Path('/proc/sys/kernel/core_pattern').read_text().strip()
    except OSError: return None, 'core_pattern is unreadable'
    if pattern.startswith('|'): return 1, 'pipe core_pattern: RLIMIT_CORE=1 makes the kernel skip the dump helper'
    if pattern.startswith('@'): return None, 'socket core_pattern has no process-local opt-out'
    return 0, 'file core_pattern: RLIMIT_CORE=0 writes no core file'

def preexec():
    """For Popen(preexec_fn=...): applies the limit in the child only; None if no safe limit exists."""
    limit, _ = core_limit()
    if limit is None: return None
    return lambda: resource.setrlimit(resource.RLIMIT_CORE, (limit, limit))

def limit_of(pid):
    """The soft RLIMIT_CORE a running process actually has, from /proc."""
    for line in pathlib.Path(f'/proc/{pid}/limits').read_text().splitlines():
        if line.startswith('Max core file size'): return line.split()[4]
    return None

def assert_not_reported(pid, since):
    """Fail if the crash still reached systemd-coredump's journal (and therefore the desktop)."""
    if not shutil.which('journalctl'): return
    deadline = time.time() + 3  # systemd-coredump journals asynchronously
    while time.time() < deadline:
        found = subprocess.run(['journalctl', '-q', '-o', 'json', '--since', f'@{int(since) - 1}', f'MESSAGE_ID={COREDUMP_MESSAGE_ID}', f'COREDUMP_PID={pid}'], capture_output=True, text=True)
        if found.stdout.strip(): raise AssertionError(f'Containment failed: process {pid} reached the crash reporter; stop running intentional aborts here')
        time.sleep(.5)

def run_contained(cmd, timeout, **kwargs):
    """Run cmd with core dumps suppressed for it alone. Returns (CompletedProcess, reason), or
    (None, reason) without running anything when no process-local mechanism is available."""
    limit, reason = core_limit()
    if limit is None: return None, reason
    started = time.time()
    process = subprocess.Popen(cmd, preexec_fn=preexec(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **kwargs)
    try: out, err = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill(); out, err = process.communicate()
        raise
    if process.returncode < 0: assert_not_reported(process.pid, started)
    return subprocess.CompletedProcess(cmd, process.returncode, out, err), reason
