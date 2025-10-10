#!/usr/bin/env python3
"""Generate embedded static asset tables for the OpenShrooly web app."""

import gzip
import os
from pathlib import Path
from typing import List, Tuple

CONTENT_TYPES = {
    ".css": "text/css",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".json": "application/json",
    ".map": "application/json",
    ".html": "text/html",
    ".htm": "text/html",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".txt": "text/plain",
    ".webmanifest": "application/manifest+json",
}

IGNORED_PREFIXES = {".DS_Store", "Thumbs.db"}


def discover_static_files(webapp_dir: Path) -> List[Tuple[Path, str, str]]:
    """Return list of (path, rel_path, content_type)."""
    discovered = []
    for file_path in sorted(webapp_dir.rglob("*")):
        if file_path.is_dir():
            continue
        if file_path.name in IGNORED_PREFIXES:
            continue
        ext = file_path.suffix.lower()
        if ext not in CONTENT_TYPES:
            continue
        rel_path = file_path.relative_to(webapp_dir).as_posix()
        discovered.append((file_path, rel_path, CONTENT_TYPES[ext]))
    return discovered


def generate_embedded_files(webapp_out_dir: str, output_header: str, output_cpp: str, url_prefix: str = "app") -> None:
    webapp_path = Path(webapp_out_dir)
    files = discover_static_files(webapp_path)

    if not files:
        print(f"No static assets discovered in {webapp_out_dir}")
        return

    header_lines = [
        "// Auto-generated file - do not edit",
        "#pragma once",
        "",
        "#include <cstdint>",
        "#include <cstddef>",
        "",
        "namespace esphome {",
        "namespace web_server {",
        "",
        "struct StaticFile {",
        "    const uint8_t* data;",
        "    size_t size;",
        "    const char* content_type;",
        "    const char* url;",
        "};",
        "",
    ]

    cpp_lines = [
        "// Auto-generated file - do not edit",
        "#include \"static_files.h\"",
        "#include <Arduino.h>",
        "",
        "namespace esphome {",
        "namespace web_server {",
        "",
    ]

    table_entries = []
    total_uncompressed = 0

    for index, (absolute_path, rel_path, content_type) in enumerate(files):
        data = absolute_path.read_bytes()
        compressed = gzip.compress(data)
        total_uncompressed += len(data)

        var_name = f"STATIC_FILE_{index}"
        bytes_literal = ", ".join(f"0x{byte:02x}" for byte in compressed)
        cpp_lines.append(f"const uint8_t {var_name}_DATA[] PROGMEM = {{{bytes_literal}}};")
        cpp_lines.append(f"const size_t {var_name}_SIZE = {len(compressed)};\n")

        header_lines.append(f"extern const uint8_t {var_name}_DATA[];")
        header_lines.append(f"extern const size_t {var_name}_SIZE;")

        if url_prefix:
            url = f"/{url_prefix}/{rel_path}".replace('//', '/')
        else:
            url = f"/{rel_path}"

        table_entries.append((var_name, content_type, url))
        print(f"Embedded: {rel_path} ({len(data)} -> {len(compressed)} bytes) → {url}")

    header_lines.append("\nextern const StaticFile STATIC_FILES[];")
    header_lines.append("extern const size_t STATIC_FILES_COUNT;\n")
    header_lines.append("}  // namespace web_server")
    header_lines.append("}  // namespace esphome\n")

    cpp_lines.append("const StaticFile STATIC_FILES[] PROGMEM = {")
    for var_name, content_type, url in table_entries:
        cpp_lines.append(f'    {{{var_name}_DATA, {var_name}_SIZE, "{content_type}", "{url}"}},')
    cpp_lines.append("};\n")
    cpp_lines.append(f"const size_t STATIC_FILES_COUNT = {len(table_entries)};\n")
    cpp_lines.append("}  // namespace web_server")
    cpp_lines.append("}  // namespace esphome\n")

    Path(output_header).write_text("\n".join(header_lines) + "\n")
    Path(output_cpp).write_text("\n".join(cpp_lines) + "\n")

    print(f"\nGenerated {output_header} and {output_cpp}")
    print(f"Total files: {len(table_entries)}")
    print(f"Total uncompressed size: {total_uncompressed:,} bytes")


if __name__ == "__main__":
    import sys

    if len(sys.argv) not in (4, 5):
        print("Usage: embed_static_files.py <webapp_dir> <output.h> <output.cpp> [url_prefix]")
        sys.exit(1)

    prefix = sys.argv[4] if len(sys.argv) == 5 else "app"
    generate_embedded_files(sys.argv[1], sys.argv[2], sys.argv[3], prefix)
