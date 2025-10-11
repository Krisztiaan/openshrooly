"""PlatformIO pre-build hook to regenerate embedded dashboard assets."""

from pathlib import Path
import subprocess

from SCons.Script import Import  # type: ignore

Import("env")  # Provided by PlatformIO


def _embed_static_files(target, source, env):  # pylint: disable=unused-argument
    project_dir = Path(env["PROJECT_DIR"])  # esphome/ directory
    repo_root = project_dir.parent

    embed_script = project_dir / "external_components" / "web_server" / "embed_static_files.py"
    webapp_dir = repo_root / "webapp"
    output_header = project_dir / "external_components" / "web_server" / "static_files.h"
    output_cpp = project_dir / "external_components" / "web_server" / "static_files.cpp"

    if not embed_script.exists():
        print("[embed_webapp] embed_static_files.py not found; skipping")
        return

    if not webapp_dir.exists():
        print("[embed_webapp] webapp directory missing; skipping")
        return

    python_exe = env.subst("$PYTHONEXE") or "python3"

    print(f"[embed_webapp] Regenerating static assets from {webapp_dir} ...")
    subprocess.check_call(
        [
            python_exe,
            str(embed_script),
            str(webapp_dir),
            str(output_header),
            str(output_cpp),
        ]
    )


env.AddPreAction("$BUILD_DIR/src/main.cpp.o", _embed_static_files)
