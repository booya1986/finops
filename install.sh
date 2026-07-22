#!/bin/bash
#
# FinOps — התקנה בלחיצה אחת (macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/booya1986/finops/main/install.sh | bash
#
# מה הסקריפט עושה:
#   1. מוודא שזה macOS.
#   2. מוודא ש-Node 22.12+ מותקן — ואם לא, מתקין אותו (דרך Homebrew).
#   3. מוריד את הפרויקט ל-~/finops.
#   4. מתקין תלויות ומפעיל את וויזרד ההגדרה (נפתח בדפדפן).
#
# הכול מקומי. שום נתון פיננסי לא עוזב את המחשב. הסקריפט קורא בלבד ולעולם
# לא מזיז כסף. לפני התקנת תוכנות מערכת (Homebrew/Node) הוא עוצר ומבקש אישור.

set -euo pipefail

REPO_URL="https://github.com/booya1986/finops.git"
TARBALL_URL="https://github.com/booya1986/finops/archive/refs/heads/main.tar.gz"
INSTALL_DIR="$HOME/finops"
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=12

# ── Colors ──────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  G=$'\033[32m'; B=$'\033[34m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
else
  G=''; B=''; Y=''; R=''; D=''; N=''
fi
say()  { printf '%s\n' "$1"; }
step() { printf '\n%s▸ %s%s\n' "$B" "$1" "$N"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
info() { printf '  %s%s%s\n' "$D" "$1" "$N"; }
die()  { printf '\n%s✗ %s%s\n\n' "$R" "$1" "$N" >&2; exit 1; }

# True only if /dev/tty is actually connected (not merely present). Under
# `curl | bash` in a real Terminal this is true even though stdin is the pipe;
# in a detached/CI context it is false.
HAVE_TTY=false
if { : < /dev/tty; } 2>/dev/null; then HAVE_TTY=true; fi

# When piped (curl | bash) stdin is the script, so read prompts from the tty.
ask() { # ask "question" -> returns 0 on yes
  local reply
  if [ "$HAVE_TTY" = true ]; then
    printf '%s%s [y/N] %s' "$Y" "$1" "$N" > /dev/tty
    read -r reply < /dev/tty || reply=""
  else
    # No interactive terminal (rare): default to yes so automation proceeds.
    reply="y"
  fi
  [[ "$reply" =~ ^[yYכ]$ ]]
}

version_ok() { # $1=major $2=minor  → 0 if >= MIN
  [ "$1" -gt "$MIN_NODE_MAJOR" ] && return 0
  [ "$1" -eq "$MIN_NODE_MAJOR" ] && [ "$2" -ge "$MIN_NODE_MINOR" ] && return 0
  return 1
}

# ── Intro ───────────────────────────────────────────────────────────────
say ""
say "${G}  FinOps — התקנה${N}"
say "${D}  יועץ פיננסי אישי + דשבורד, מקומי לחלוטין. קריאה בלבד.${N}"
say ""
info "מה יקרה: בדיקת Node (התקנה אם צריך) · הורדת הפרויקט ל-~/finops · הפעלת ההגדרה."

# ── Step 1: OS ──────────────────────────────────────────────────────────
step "בדיקת מערכת"
[ "$(uname)" = "Darwin" ] || die "הסקריפט תומך כרגע ב-macOS בלבד."
ok "macOS"

# ── Step 2: Node ────────────────────────────────────────────────────────
step "בדיקת Node.js"
NODE_OK=false
if command -v node >/dev/null 2>&1; then
  ver="$(node -p 'process.versions.node' 2>/dev/null || echo '0.0.0')"
  major="${ver%%.*}"; rest="${ver#*.}"; minor="${rest%%.*}"
  if version_ok "${major:-0}" "${minor:-0}"; then
    NODE_OK=true
    ok "Node $ver"
  else
    info "מותקן Node $ver — נדרש ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} ומעלה."
  fi
fi

if [ "$NODE_OK" = false ]; then
  info "צריך להתקין Node.js (סביבת ההרצה של הכלי)."
  if ! command -v brew >/dev/null 2>&1; then
    info "כדי להתקין Node בצורה מסודרת נשתמש ב-Homebrew (מנהל החבילות של macOS)."
    if ask "להתקין Homebrew עכשיו? (ייתכן שתתבקש/י להזין את סיסמת המחשב)"; then
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
        || die "התקנת Homebrew נכשלה. אפשר להתקין Node ידנית מ-https://nodejs.org ואז להריץ שוב."
      # Make brew available in this shell (Apple Silicon vs Intel paths).
      if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)";
      elif [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi
      ok "Homebrew הותקן"
    else
      die "בלי Homebrew אפשר להתקין Node ידנית מ-https://nodejs.org ואז להריץ את הסקריפט שוב."
    fi
  fi
  if ask "להתקין Node.js דרך Homebrew עכשיו?"; then
    info "מתקין Node… (עשוי לקחת דקה)"
    brew install node || die "התקנת Node נכשלה. נסה/י: brew install node"
    command -v node >/dev/null 2>&1 || die "Node לא נמצא אחרי ההתקנה. פתח/י טרמינל חדש ונסה/י שוב."
    ok "Node $(node -p 'process.versions.node') הותקן"
  else
    die "הכלי דורש Node. אפשר להתקין מ-https://nodejs.org ואז להריץ שוב."
  fi
fi

# ── Step 3: download ────────────────────────────────────────────────────
step "הורדת הפרויקט"
if [ -d "$INSTALL_DIR/.git" ]; then
  info "קיים כבר ב-$INSTALL_DIR — מעדכן לגרסה האחרונה."
  git -C "$INSTALL_DIR" pull --ff-only >/dev/null 2>&1 || info "לא ניתן לעדכן אוטומטית — ממשיך עם מה שקיים."
  ok "עודכן"
elif [ -e "$INSTALL_DIR" ]; then
  die "התיקייה $INSTALL_DIR כבר קיימת (וזו לא התקנה קודמת). מחק/י או שנה/י שם ונסה/י שוב."
else
  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" >/dev/null 2>&1 \
      || die "ההורדה נכשלה. בדוק/י חיבור אינטרנט ונסה/י שוב."
  else
    info "git לא מותקן — מוריד כארכיון."
    mkdir -p "$INSTALL_DIR"
    curl -fsSL "$TARBALL_URL" | tar -xz -C "$INSTALL_DIR" --strip-components=1 \
      || die "ההורדה נכשלה. בדוק/י חיבור אינטרנט ונסה/י שוב."
  fi
  ok "הורד ל-$INSTALL_DIR"
fi

# ── Step 4: dependencies ────────────────────────────────────────────────
step "התקנת תלויות"
cd "$INSTALL_DIR"
# Must run here, not inside the wizard: the wizard itself runs via `tsx`, which
# doesn't exist until dependencies are installed. (npm ci when a lockfile is
# present is faster and reproducible; fall back to npm install otherwise.)
if [ -f package-lock.json ]; then
  info "מתקין תלויות (npm ci)… זה עשוי לקחת דקה-שתיים."
  npm ci >/dev/null 2>&1 || npm install >/dev/null 2>&1 || die "התקנת התלויות נכשלה. נסה/י מתוך $INSTALL_DIR: npm install"
else
  info "מתקין תלויות (npm install)… זה עשוי לקחת דקה-שתיים."
  npm install >/dev/null 2>&1 || die "התקנת התלויות נכשלה. נסה/י מתוך $INSTALL_DIR: npm install"
fi
ok "התלויות הותקנו"

# ── Step 5: hand off to the wizard ──────────────────────────────────────
step "הגדרה"
info "פותח את וויזרד ההגדרה בדפדפן…"
# The wizard reads no keyboard input — all interaction happens in the browser
# form it opens — so it needs no terminal on stdin. Run it without redirecting
# stdin: robust under `curl | bash`, in a normal shell, and in CI alike.
npm run setup || die "ההגדרה נעצרה. אפשר להריץ שוב מתוך $INSTALL_DIR עם: npm run setup"

say ""
say "${G}  הכול מוכן!${N} הפרויקט ב-${INSTALL_DIR}"
say "  לפתיחת הדשבורד בכל עת:"
say "    ${B}cd ~/finops && npm run dashboard${N}"
say ""
