"""godspeed-clerk: the Clerk's open questions, handed to the model before each turn.

Runs `godspeed-clerk context` and returns its output as injected context, so a short "1" or "the
Travel folder" lands with the right paper. Works on Linux, macOS and Windows: the Clerk's setup
writes the exact command line (launcher.json: Node, the program, and the Clerk's state folder), so
no shell and no .cmd file is needed. Every failure returns None: a broken Clerk never breaks the
assistant.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _command():
    try:
        with open(os.path.join(HERE, "launcher.json"), encoding="utf-8") as f:
            argv = json.load(f).get("argv") or []
        if len(argv) >= 2 and os.path.exists(argv[0]) and os.path.exists(argv[1]):
            return [argv[0], argv[1], "context"] + list(argv[2:])
        if len(argv) >= 2:
            return None
    except (OSError, ValueError, AttributeError):
        pass
    found = shutil.which("godspeed-clerk")
    return [found, "context"] if found else None


def on_pre_llm_call(**kwargs):
    try:
        cmd = _command()
        if not cmd:
            return None
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=5, creationflags=flags)
        out = (r.stdout or "").strip()
        return {"context": out} if out else None
    except Exception:
        return None


def register(ctx):
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
