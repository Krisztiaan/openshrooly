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
    dist_dir = webapp_dir / "dist"
    output_header = project_dir / "external_components" / "web_server" / "static_files.h"
    output_cpp = project_dir / "external_components" / "web_server" / "static_files.cpp"

    if not embed_script.exists():
        print("[embed_webapp] embed_static_files.py not found; skipping")
        return

    if not webapp_dir.exists():
        print("[embed_webapp] webapp directory missing; skipping")
        return

    if not dist_dir.exists():
        print("[embed_webapp] webapp/dist missing – attempting to build dashboard")

        package_json = webapp_dir / "package.json"
        if not package_json.exists():
            raise RuntimeError(
                "[embed_webapp] Cannot build dashboard: webapp/package.json not found. "
                "Run the frontend setup (npm install && npm run build) before compiling firmware."
            )

        npm_cmd = ["npm", "run", "build"]
        try:
            result = subprocess.run(npm_cmd, cwd=str(webapp_dir), check=False)
        except FileNotFoundError as error:
            raise RuntimeError(
                "[embed_webapp] npm is not available on PATH. Install Node.js and rerun the build."
            ) from error

        if result.returncode not in (0, 124):
            raise RuntimeError(
                "[embed_webapp] npm run build failed (exit code {}). "
                "Fix the frontend build before compiling firmware.".format(result.returncode)
            )

        if result.returncode == 124:
            print(
                "[embed_webapp] npm run build timed out (expected when using timeout wrapper); "
                "continuing if assets were produced"
            )

    index_html = dist_dir / "index.html"
    if not index_html.exists():
        raise FileNotFoundError(
            "[embed_webapp] Missing dist/index.html even after build. "
            "Dashboard assets cannot be embedded."
        )

    python_exe = env.subst("$PYTHONEXE") or "python3"

    print(f"[embed_webapp] Regenerating static assets from {dist_dir} ...")
    subprocess.check_call(
        [
            python_exe,
            str(embed_script),
            str(dist_dir),
            str(output_header),
            str(output_cpp),
        ]
    )


env.AddPreAction("$BUILD_DIR/src/main.cpp.o", _embed_static_files)
