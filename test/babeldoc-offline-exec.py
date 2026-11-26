"""Linux-only acceptance wrapper: deny network syscalls in all descendants.

Requires the system libseccomp already installed. This is a verification tool,
not a plugin sandbox or runtime dependency. Fails closed if unavailable.
"""
import ctypes
import ctypes.util
import errno
import os
import sys

if sys.platform != "linux" or len(sys.argv) < 2:
    raise SystemExit("Usage (Linux only): python test/babeldoc-offline-exec.py COMMAND [ARGS...]")
name = ctypes.util.find_library("seccomp")
if not name:
    raise RuntimeError("Existing system libseccomp is required")
lib = ctypes.CDLL(name, use_errno=True)
lib.seccomp_init.argtypes = [ctypes.c_uint32]
lib.seccomp_init.restype = ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
lib.seccomp_rule_add.restype = ctypes.c_int
lib.seccomp_load.argtypes = [ctypes.c_void_p]
lib.seccomp_load.restype = ctypes.c_int
context = lib.seccomp_init(0x7FFF0000)  # SCMP_ACT_ALLOW; restrict networking below.
if not context:
    raise RuntimeError("Could not create network-denial filter")
for syscall in (b"connect", b"sendto", b"sendmsg", b"sendmmsg"):
    number = lib.seccomp_syscall_resolve_name(syscall)
    if number < 0 or lib.seccomp_rule_add(context, 0x00050000 | errno.EACCES, number, 0):
        raise RuntimeError("Could not add network-denial rule")
if lib.seccomp_load(context):
    raise RuntimeError("Could not install network-denial filter")
os.execvp(sys.argv[1], sys.argv[1:])
