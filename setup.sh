#!/usr/bin/env bash
# =============================================================================
# Cosmo — one-shot setup. Works on macOS, Linux, and Windows (Git Bash / WSL).
#
#   Run from inside a cloned repo:   ./setup.sh
#   Or bootstrap from scratch:       COSMO_REPO=https://github.com/you/cosmo.git ./setup.sh
#   Or one-liner (when live):        curl -fsSL https://your-domain.com/setup.sh | bash
#
# What it does: checks prerequisites (Node 20+, npm, git) → fetches the code →
# installs dependencies → builds → tells you how to launch. Safe to re-run.
# =============================================================================
set -euo pipefail

# ---- pretty output ----------------------------------------------------------
if [ -t 1 ]; then BOLD=$'\033[1m'; BLUE=$'\033[34m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else BOLD=""; BLUE=""; GREEN=""; YELLOW=""; RED=""; RESET=""; fi
say()  { printf "%s\n" "${BLUE}▸${RESET} $*"; }
ok()   { printf "%s\n" "${GREEN}✓${RESET} $*"; }
warn() { printf "%s\n" "${YELLOW}!${RESET} $*"; }
die()  { printf "%s\n" "${RED}✗ $*${RESET}" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

NODE_MIN=20
COSMO_REPO="${COSMO_REPO:-https://github.com/REPLACE_ME/cosmo.git}"   # set when the repo is public
CLONE_DIR="${COSMO_DIR:-cosmo}"

printf "\n%s\n\n" "${BOLD}🪐  Cosmo setup${RESET}"

# ---- 1. detect platform -----------------------------------------------------
OS="$(uname -s 2>/dev/null || echo unknown)"
case "$OS" in
  Darwin) PLATFORM="macOS" ;;
  Linux)  PLATFORM="Linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="Windows (Git Bash)" ;;
  *) PLATFORM="$OS" ;;
esac
say "Platform: ${BOLD}${PLATFORM}${RESET}"
if [ "$OS" != "Darwin" ]; then
  warn "Cosmo is built for macOS. It will run elsewhere, but voice/AppleScript features are macOS-only."
fi

# ---- 2. check prerequisites -------------------------------------------------
say "Checking prerequisites…"
have git || die "git not found. Install it first: https://git-scm.com/downloads"

if ! have node; then
  if [ "$OS" = "Darwin" ] && have brew; then
    warn "Node not found — installing via Homebrew…"; brew install node
  else
    die "Node.js ${NODE_MIN}+ not found. Install it: https://nodejs.org (LTS)."
  fi
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge "$NODE_MIN" ] || die "Node ${NODE_MIN}+ required (found $(node -v)). Update from https://nodejs.org."
have npm || die "npm not found (it ships with Node.js)."
ok "git $(git --version | awk '{print $3}'), node $(node -v), npm $(npm -v)"

# ---- 3. get the code --------------------------------------------------------
if [ -f package.json ] && grep -q '"electron"' package.json 2>/dev/null; then
  say "Running inside the Cosmo repo — skipping clone."
  PROJECT_DIR="$(pwd)"
else
  case "$COSMO_REPO" in
    *REPLACE_ME*) die "No repo URL. Re-run with: COSMO_REPO=<git-url> ./setup.sh  (or run this from inside a cloned repo)." ;;
  esac
  if [ -d "$CLONE_DIR/.git" ]; then
    say "Updating existing clone in ./$CLONE_DIR…"; git -C "$CLONE_DIR" pull --ff-only || warn "Could not fast-forward; continuing."
  else
    say "Cloning $COSMO_REPO → ./$CLONE_DIR…"; git clone --depth 1 "$COSMO_REPO" "$CLONE_DIR"
  fi
  PROJECT_DIR="$(cd "$CLONE_DIR" && pwd)"
fi
cd "$PROJECT_DIR"
ok "Project: $PROJECT_DIR"

# ---- 4. install dependencies ------------------------------------------------
say "Installing dependencies (npm install)…"
npm install
ok "Dependencies installed."

# ---- 5. build ---------------------------------------------------------------
say "Building…"
npm run build
ok "Build complete."

# ---- 5.5 (optional) pre-download local models -------------------------------
# Cosmo runs its voice, speech-to-text, turn-detection and memory models ON-DEVICE,
# downloading them on first launch (~400MB). Pre-fetching now makes that first launch
# instant. Opt-in: prompted when interactive; force with COSMO_PREFETCH=1 or skip with
# COSMO_PREFETCH=0 for unattended installs. Never fatal — models fetch on launch if skipped.
do_prefetch=""
case "${COSMO_PREFETCH:-}" in
  1|yes|true)  do_prefetch="yes" ;;
  0|no|false)  do_prefetch="no"  ;;
  *)
    if [ -t 0 ]; then
      printf "\n%s" "${BLUE}▸${RESET} Pre-download Cosmo's local models now (~400MB: voice, speech, turn, memory)? [Y/n] "
      read -r reply || reply=""
      case "$reply" in [nN]*) do_prefetch="no" ;; *) do_prefetch="yes" ;; esac
    else
      do_prefetch="no"   # piped/non-interactive install → don't block; models fetch on first launch
    fi
    ;;
esac
if [ "$do_prefetch" = "yes" ]; then
  say "Pre-downloading local models (this can take a few minutes)…"
  node scripts/prefetch-models.mjs || warn "Model prefetch didn't finish; they'll download on first launch instead."
else
  say "Skipping model prefetch — Cosmo will download models on first launch."
fi

# ---- 6. done ----------------------------------------------------------------
cat <<EOF

${GREEN}${BOLD}All set!${RESET} Cosmo is ready in ${BOLD}${PROJECT_DIR}${RESET}.

${BOLD}Next:${RESET}
  1. Start it:        ${BOLD}npm run dev${RESET}
  2. Click the gear (⚙) to open Setup, then:
       • pick your AI provider + model (or use local Ollama),
       • paste your API key (it's encrypted in your OS keychain, never plaintext),
       • choose voices and finish onboarding.
  3. Say "Cosmo" or tap the mic — and say hi. 👋

${BOLD}Optional — fully local brain:${RESET}
  Install Ollama (https://ollama.com), then: ${BOLD}ollama pull qwen2.5:7b${RESET}

Build a distributable later with: ${BOLD}npm run dist${RESET}
EOF

# Offer to launch when run interactively.
if [ -t 0 ]; then
  printf "\n%s" "${BLUE}▸${RESET} Start Cosmo now with 'npm run dev'? [y/N] "
  read -r reply || reply=""
  case "$reply" in [yY]*) say "Launching…"; exec npm run dev ;; *) say "Run 'npm run dev' whenever you're ready." ;; esac
fi
