"""
gitinit.py -- One-time setup of a new Home Assistant dashboard plugin (card) project.

Copy this single file into a new, empty project folder and run:  python gitinit.py
It creates the folders, all project files, a minimal 0.0.0 card, installs and builds,
creates the GitHub repository (if needed) and pushes the initial 0.0.0 commit and tag.
Requires: Python 3, git, npm, and the GitHub CLI (gh) logged in (gh auth login).
"""

import json
import os
import shutil
import stat
import subprocess
import sys
from datetime import date
from pathlib import Path

# --- Version ------------------------------------------------------------
__version__ = "gitinit.py 0.0.1"

# --- Version history ----------------------------------------------------
# v0.0.1: Initial version, replacing gitinit.bat. Workflows for the local esbuild build, repository
#         creation with gh, minimal 0.0.0 card, README/LICENSE templates, initial commit and tag.

# --- Settings -----------------------------------------------------------
GITHUB_USER = "rob-vandenberg"
ESBUILD_VERSION = "0.28.2"
BASE_TOPICS = ["home-assistant", "dashboard", "lovelace", "plugin", "chrono"]
DESCRIPTION_PREFIX = "\U0001F535 HOME ASSISTANT - "
INITIAL_VERSION = "0.0.0"
INITIAL_MESSAGE = "Initial scaffold"
FOLDERS = ["src", "dist", "backup", "release", "art"]

# --- Templates ----------------------------------------------------------
# Written exactly as they are here. Tokens @@...@@ are replaced per project.

GITIGNORE = r'''# Python
__pycache__/
*.pyc
*.pyo
*.pyd
.Python
*.egg-info/

# Virtual environments
.env
venv/
.venv/

# OS generated files
.DS_Store
Thumbs.db

# Folders
.*/
!.github/
*.bak/
docs/
logs/
backup/
artwork/
screenshot/
release/
github/
ha/ 
node_modules/

# Files
*.bak
*.ai
*.psd
*.bat
*.zip
*.jfif
gitinit.py

# Build output (built locally by release.bat and committed)
# dist/

# IDE
.vscode/
.idea/
'''

GITATTRIBUTES = r'''* text=auto
*.md text eol=lf
*.js text eol=lf
*.json text eol=lf
*.yml text eol=lf
*.bat text eol=crlf
'''

PUBLISH_YML = r'''name: publish-new-version
on:
  workflow_dispatch:

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
  PROJECT_NAME: ${{ github.event.repository.name }}

permissions:
  contents: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Get version
        id: version
        run: echo "version=$(grep -o "CARD_VERSION = '[^']*'" src/${{ env.PROJECT_NAME }}.js | sed "s/CARD_VERSION = '//;s/'//")" >> $GITHUB_OUTPUT

      - name: Validate version format
        run: echo "${{ steps.version.outputs.version }}" | grep -E "^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$"

      - name: Get last commit message
        id: commit_message
        run: |
          {
            echo "message<<EOF"
            git log -1 --pretty=%B "${{ steps.version.outputs.version }}"
            echo "EOF"
          } >> $GITHUB_OUTPUT

      - name: Get commit author
        id: commit_author
        run: echo "name=$(git log -1 --pretty=%an "${{ steps.version.outputs.version }}")" >> $GITHUB_OUTPUT

      - name: Check that dist was built from this version
        run: |
          VER="${{ steps.version.outputs.version }}"
          PATTERN="[\"'\`]${VER//./\\.}[\"'\`]"
          if ! grep -qE "$PATTERN" "dist/${{ env.PROJECT_NAME }}.js"; then
            echo "::error::dist/${{ env.PROJECT_NAME }}.js does not contain version $VER. Run release.bat to build it."
            exit 1
          fi

      - name: Create version tag
        run: |
          git tag -f "v${{ steps.version.outputs.version }}"
          git push origin "v${{ steps.version.outputs.version }}" --force

      - name: Publish Github release
        uses: ncipollo/release-action@v1
        with:
          tag: "v${{ steps.version.outputs.version }}"
          name: "v${{ steps.version.outputs.version }}"
          body: |
            ${{ steps.commit_message.outputs.message }}

            - Published by ${{ steps.commit_author.outputs.name }}.
          makeLatest: true
          allowUpdates: true
          artifacts: "dist/*.js"
'''

VALIDATE_HACS_YML = r'''name: HACS Action

on:
  push:
    branches:
      - main
  schedule:
    - cron: "0 0 * * *"

jobs:
  hacs:
    name: HACS Action
    runs-on: "ubuntu-latest"
    steps:
      - name: HACS Action
        uses: "hacs/action@main"
        with:
          category: "plugin"
'''

README_MD = r'''  
 <div align="center">

  [![](https://img.shields.io/badge/HACS-Custom-orange.svg?style=for-the-badge)](https://github.com/hacs/integration)
  [![](https://img.shields.io/badge/License-AGPL_3.0-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/agpl-3.0)
  [![](https://img.shields.io/github/v/release/rob-vandenberg/@@ID@@?style=for-the-badge&color=brightgreen&label=Version)](https://github.com/rob-vandenberg/@@ID@@/releases)

  <img src="art/header.svg" width="780" alt="@@NAME@@ Banner">


  <img src="art/banner.png" width="800" alt="@@NAME@@ Banner">

  <p align="center">
    <strong>@@DESCRIPTION@@</strong>
  </p>

  <p align="center">
    <a href="#introduction">Introduction</a> •
    <a href="#key-features">Key Features</a> •
    <a href="#installation">Installation</a> •
    <a href="#configuration">Configuration</a> •
    <a href="#license">License</a>
  </p>

</div>

---

**@@NAME@@**

TODO: Write the introduction.

---

## 📋 Table of Contents

- [Introduction](#introduction)
- [Key Features](#key-features)
- [Installation](#installation)
  - [HACS (Recommended)](#hacs-recommended)
  - [Manual Installation](#manual-installation)
- [Uninstallation](#uninstallation)
- [Configuration](#configuration)
  - [Card Options](#card-options)
  - [Field Options](#field-options)
- [License](#license)
- [Support](#support)

---
'''

LICENSE_HEADER = r'''                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.

'''

CARD_JS = r'''/**
 * @@ID@@
 */

import { LitElement, html, css } from 'https://unpkg.com/lit@2.0.0/index.js?module';

// --- Version ---------------------------------------------------------------
const CARD_VERSION = '@@VERSION@@';

// --- Version History ---------------------------------------------------------
// v@@VERSION@@: Initial scaffold.

// --- Console log ---------------------------------------------------------------
console.info(
@@BANNER@@
);

// --- Card ---------------------------------------------------------------------
class @@CLASS@@ extends LitElement {
  static properties = {
    hass:    { attribute: false },
    _config: { state: true },
  };

  static getCardSize() {
    return 1;
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = config;
  }

  static styles = css`
    :host {
      display: block;
    }
    .content {
      padding: 16px;
    }
  `;

  render() {
    if (!this._config) return html``;
    return html`<ha-card><div class="content">@@NAME_JS@@</div></ha-card>`;
  }
}
customElements.define('@@ID@@', @@CLASS@@);

// --- Card registration ----------------------------------------------------------
window.customCards = window.customCards || [];
window.customCards.push({
  type:        '@@ID@@',
  name:        '@@NAME_JS@@',
  description: '@@DESCRIPTION_JS@@',
  preview:     true,
});
'''


# --- Helpers ------------------------------------------------------------

class InitError(Exception):
    pass


def info(text=""):
    print(text)


def step(number, total, text):
    print(f"\n[{number}/{total}] {text}")


def fail(text):
    raise InitError(text)


def run(args, capture=False, check=True):
    """Runs a command (first element resolved on PATH, so npm.cmd etc. work on Windows)."""
    exe = shutil.which(args[0])
    if not exe:
        fail(f"'{args[0]}' was not found on PATH.")
    result = subprocess.run([exe, *args[1:]], text=True, encoding="utf-8",
                            capture_output=capture)
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() if capture else ""
        fail(f"Command failed: {' '.join(args)}" + (f"\n{detail}" if detail else ""))
    return result


def write_text(path, content):
    """Writes with LF line endings (git converts per .gitattributes)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


def ask(prompt, default=None):
    suffix = f" ({default})" if default else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or (default or "")


def default_name(identifier):
    return " ".join(word[:1].upper() + word[1:] for word in identifier.split("-") if word)


def class_name(identifier):
    return "".join(word[:1].upper() + word[1:] for word in identifier.replace("_", "-").split("-") if word)


def js_string(text):
    return text.replace("\\", "\\\\").replace("'", "\\'")


def banner_js(identifier):
    """Console banner in the chrono style: CHRONO- white, middle part blue, -CARD white."""
    upper = identifier.upper()
    white = "'background-color: #101010; color: #FFFFFF; font-weight: bold; padding: 2px 0 2px 4px; border-radius: 3px 0 0 3px;'"
    blue = "'background-color: #101010; color: #4676d3; font-weight: bold; padding: 2px 0;'"
    white_end = "'background-color: #101010; color: #FFFFFF; font-weight: bold; padding: 2px 4px 2px 0;'"
    version = "'background-color: #1E1E1E; color: #FFFFFF; font-weight: bold; padding: 2px 4px; border-radius: 0 3px 3px 0;'"
    if upper.startswith("CHRONO-") and upper.endswith("-CARD") and len(upper) > len("CHRONO--CARD"):
        middle = upper[len("CHRONO-"):-len("-CARD")]
        return (f"  `%c CHRONO-%c{middle}%c-CARD %c v${{CARD_VERSION}} `,\n"
                f"  {white},\n  {blue},\n  {white_end},\n  {version}")
    whole = "'background-color: #101010; color: #FFFFFF; font-weight: bold; padding: 2px 4px; border-radius: 3px 0 0 3px;'"
    return f"  `%c {upper} %c v${{CARD_VERSION}} `,\n  {whole},\n  {version}"


def fill(template, values):
    for key, value in values.items():
        template = template.replace(f"@@{key}@@", value)
    return template


# --- Main ---------------------------------------------------------------

def main():
    root = Path.cwd()
    total = 9
    info(f"{__version__} -- new HA dashboard plugin project in: {root}")

    # --- Requirements ---------------------------------------------------
    step(1, total, "Checking requirements...")
    for tool in ("git", "npm", "gh"):
        if not shutil.which(tool):
            fail(f"'{tool}' was not found on PATH. Install it first.")
    if run(["gh", "auth", "status"], capture=True, check=False).returncode != 0:
        fail("The GitHub CLI is not logged in. Run: gh auth login")
    if (root / ".git").exists():
        fail("This folder already contains a git repository (.git). gitinit only runs once per project.")

    # --- Project details ------------------------------------------------
    step(2, total, "Project details")
    identifier = ask("Project identifier", root.name).lower()
    name = ask("Project name", default_name(identifier))
    description = ""
    while not description:
        description = ask(f"Description (after '{DESCRIPTION_PREFIX}')")
    github_description = DESCRIPTION_PREFIX + description
    repo = f"{GITHUB_USER}/{identifier}"
    remote_url = f"https://github.com/{repo}.git"
    topics = BASE_TOPICS + ([identifier] if identifier not in BASE_TOPICS else [])

    src_file = root / "src" / f"{identifier}.js"
    generated = {
        root / ".gitignore": GITIGNORE,
        root / ".gitattributes": GITATTRIBUTES,
        root / "hacs.json": json.dumps({"name": name, "filename": f"dist/{identifier}.js"}, indent=2) + "\n",
        root / "package.json": json.dumps({
            "name": identifier,
            "version": "1.0.0",
            "scripts": {"build": f"esbuild src/{identifier}.js --bundle --format=esm --minify --outfile=dist/{identifier}.js"},
            "devDependencies": {"esbuild": ESBUILD_VERSION},
        }, indent=2) + "\n",
        root / ".github" / "workflows" / "publish.yml": PUBLISH_YML,
        root / ".github" / "workflows" / "validate_hacs.yml": VALIDATE_HACS_YML,
        src_file: fill(CARD_JS, {
            "ID": identifier, "VERSION": INITIAL_VERSION, "CLASS": class_name(identifier),
            "BANNER": banner_js(identifier), "NAME_JS": js_string(name), "DESCRIPTION_JS": js_string(description),
        }),
        root / "README.md": fill(README_MD, {"ID": identifier, "NAME": name, "DESCRIPTION": description}),
        root / "LICENSE": LICENSE_HEADER,
    }
    existing = [str(p.relative_to(root)) for p in list(generated) + [root / "package-lock.json"] if p.exists()]
    if existing:
        fail("These files already exist and will not be overwritten:\n  " + "\n  ".join(existing))

    # --- GitHub repository state ----------------------------------------
    view = run(["gh", "repo", "view", repo, "--json", "isEmpty"], capture=True, check=False)
    if view.returncode == 0:
        if not json.loads(view.stdout).get("isEmpty", False):
            fail(f"GitHub repository {repo} already exists and contains commits. Stopped, nothing was changed.")
        repo_exists = True
    else:
        repo_exists = False

    # --- Confirmation ---------------------------------------------------
    info("\n=====================================================================")
    info(f" Identifier:  {identifier}")
    info(f" Name:        {name}")
    info(f" Description: {github_description}")
    info(f" Repository:  {repo} ({'exists, empty: will be used' if repo_exists else 'will be created, public'})")
    info(f" Topics:      {', '.join(topics)}")
    info(" This will create folders and files, run npm install and npm run build,")
    info(f" and commit, tag and push version {INITIAL_VERSION}.")
    info("=====================================================================")
    if ask("Continue? (Y/N)").upper() != "Y":
        info("Aborted. Nothing was changed.")
        return 1

    # --- Folders and files ----------------------------------------------
    step(3, total, "Creating folders and files...")
    for folder in FOLDERS:
        (root / folder).mkdir(exist_ok=True)
        info(f"  folder  {folder}")
    for path, content in generated.items():
        write_text(path, content)
        info(f"  file    {path.relative_to(root)}")

    # --- npm ------------------------------------------------------------
    step(4, total, "Installing dependencies (npm install)...")
    run(["npm", "install"])
    step(5, total, "Building (npm run build)...")
    run(["npm", "run", "build"])
    dist_file = root / "dist" / f"{identifier}.js"
    if not dist_file.exists():
        fail(f"Build output not found: {dist_file.relative_to(root)}")

    # --- Backup ---------------------------------------------------------
    step(6, total, "Creating backup...")
    backup_file = root / "backup" / f"{identifier}_{INITIAL_VERSION}.js"
    shutil.copyfile(src_file, backup_file)
    os.chmod(backup_file, stat.S_IREAD)
    info(f"  {backup_file.relative_to(root)} (read-only)")

    # --- GitHub repository ----------------------------------------------
    step(7, total, "Setting up the GitHub repository...")
    if not repo_exists:
        run(["gh", "repo", "create", repo, "--public", "--description", github_description])
        info(f"  created {repo}")
    else:
        run(["gh", "repo", "edit", repo, "--description", github_description])
        info(f"  using existing empty repository {repo}")
    run(["gh", "repo", "edit", repo, "--add-topic", ",".join(topics)])
    info(f"  topics: {', '.join(topics)}")

    # --- Git ------------------------------------------------------------
    step(8, total, "Initializing git, committing and tagging...")
    run(["git", "init", "-b", "main"])
    run(["git", "remote", "add", "origin", remote_url])
    run(["git", "add", "."])
    run(["git", "commit", "-m", INITIAL_MESSAGE])
    run(["git", "tag", "-a", INITIAL_VERSION, "-m", INITIAL_MESSAGE])

    step(9, total, "Pushing to GitHub...")
    run(["git", "push", "-u", "origin", "main"])
    run(["git", "push", "origin", INITIAL_VERSION])

    # --- Done -----------------------------------------------------------
    info("\n=====================================================================")
    info(f" SUCCESS! {identifier} {INITIAL_VERSION} is on GitHub:")
    info(f"   https://github.com/{repo}")
    info("=====================================================================")
    info("\n Still to do by hand:")
    info("   1. Replace LICENSE with the full AGPL-3.0 license text.")
    info("   2. Copy art\\header.svg and art\\banner.png into the art folder.")
    info("   3. Copy release.bat and the git*.bat files from an existing project.")
    info("   4. Finish README.md: the introduction and the rest of the sections.")
    info("   5. Optional: run publish-new-version in GitHub Actions for a v0.0.0 release.")
    info("   6. Add the repository to HACS as a custom repository (category Dashboard).")
    info("\n Do not run gitinit.py again for this project.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except InitError as err:
        print(f"\n!! ERROR: {err}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nAborted.")
        sys.exit(1)
