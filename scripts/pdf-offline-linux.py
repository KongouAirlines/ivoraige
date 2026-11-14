# SPDX-License-Identifier: AGPL-3.0-only
"""Linux acceptance helper: deny network syscalls in this child and descendants.

This changes no host network settings. Python socket hooks alone cannot block
native-library networking. Requires the system libseccomp; fails closed if absent.
"""
import ctypes
import ctypes.util
import errno
import os
import sys

if sys.platform != "linux" or len(sys.argv) < 2:
    raise SystemExit("Usage (Linux): python scripts/pdf-offline-linux.py COMMAND [ARGS...]")
library = ctypes.util.find_library("seccomp")
if not library:
    raise RuntimeError("System libseccomp is required for offline acceptance")
lib = ctypes.CDLL(library, use_errno=True)
lib.seccomp_init.argtypes = [ctypes.c_uint32]
lib.seccomp_init.restype = ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
lib.seccomp_rule_add.restype = ctypes.c_int
lib.seccomp_load.argtypes = [ctypes.c_void_p]
lib.seccomp_load.restype = ctypes.c_int
lib.seccomp_release.argtypes = [ctypes.c_void_p]
context = lib.seccomp_init(0x7FFF0000)  # SCMP_ACT_ALLOW
if not context:
    raise RuntimeError("Could not create network-deny filter")
try:
    for name in (b"connect", b"sendto", b"sendmsg", b"sendmmsg"):
        number = lib.seccomp_syscall_resolve_name(name)
        if number < 0 or lib.seccomp_rule_add(context, 0x00050000 | errno.EACCES, number, 0) != 0:
            raise RuntimeError("Could not add network-deny filter")
    if lib.seccomp_load(context) != 0:
        raise RuntimeError("Could not install network-deny filter")
finally:
    lib.seccomp_release(context)
os.execvp(sys.argv[1], sys.argv[1:])
