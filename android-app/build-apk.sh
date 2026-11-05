#!/bin/bash
# 岁岁纪念馆离线壳：在 Linux 作业机上用 aapt2 / javac / dx / zipalign / apksigner 打 APK。
# 用法：bash build-apk.sh
set -euo pipefail
export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"

ROOT="$(cd "$(dirname "$0")" && pwd)"
PUBLIC="$(cd "$ROOT/../public" && pwd)"
OUT_DIR="$PUBLIC/download"
OUT_APK="$OUT_DIR/suisui-memorial.apk"

ANDROID_JAR="/usr/lib/android-sdk/platforms/android-34/android.jar"
if [ ! -f "$ANDROID_JAR" ]; then
  ANDROID_JAR="/usr/lib/android-sdk/platforms/android-23/android.jar"
fi
if [ ! -f "$ANDROID_JAR" ]; then
  echo "missing android.jar under /usr/lib/android-sdk/platforms" >&2
  exit 1
fi

DX="${DX:-}"
if [ -z "$DX" ]; then
  if [ -x /usr/lib/android-sdk/build-tools/debian/dx ]; then
    DX=/usr/lib/android-sdk/build-tools/debian/dx
  else
    DX="$(command -v dx)"
  fi
fi
command -v aapt2 >/dev/null
command -v aapt >/dev/null
command -v zipalign >/dev/null
command -v apksigner >/dev/null
command -v javac >/dev/null
command -v keytool >/dev/null
command -v zip >/dev/null
[ -n "$DX" ] && [ -x "$DX" ]

WORK="$(mktemp -d /tmp/suisui-memorial.XXXXXX)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

mkdir -p "$WORK/res/mipmap-xxxhdpi" "$WORK/res/values" "$WORK/assets/web" "$WORK/classes"
cp "$ROOT/AndroidManifest.xml" "$WORK/AndroidManifest.xml"
cp "$ROOT/res/values/strings.xml" "$WORK/res/values/strings.xml"
cp -a "$ROOT/src/." "$WORK/src"

ICON="$PUBLIC/assets/icon/app_launcher.png"
ICON_ROUND="$PUBLIC/assets/icon/app_launcher_round.png"
[ -f "$ICON" ] && [ -f "$ICON_ROUND" ]
if python3 -c "import PIL" >/dev/null 2>&1; then
  python3 - "$ICON" "$ICON_ROUND" "$WORK/res/mipmap-xxxhdpi" <<'PY'
import sys
from PIL import Image
src, rnd, out = sys.argv[1], sys.argv[2], sys.argv[3]
Image.open(src).convert("RGBA").save(out + "/ic_launcher.png")
Image.open(rnd).convert("RGBA").save(out + "/ic_launcher_round.png")
PY
else
  cp "$ICON" "$WORK/res/mipmap-xxxhdpi/ic_launcher.png"
  cp "$ICON_ROUND" "$WORK/res/mipmap-xxxhdpi/ic_launcher_round.png"
fi

# 静态页打进 assets/web。排除 download，避免把上一轮 APK 再打进包里。
cp -a "$PUBLIC/." "$WORK/assets/web/"
rm -rf "$WORK/assets/web/download"

echo "compiling resources"
if ! aapt2 compile --dir "$WORK/res" -o "$WORK/res.zip" --no-crunch; then
  echo "aapt2 compile failed; retry after flattening icons" >&2
  python3 - "$ICON" "$ICON_ROUND" "$WORK/res/mipmap-xxxhdpi" <<'PY' || true
import sys
try:
    from PIL import Image
except ImportError:
    sys.exit(1)
src, rnd, out = sys.argv[1], sys.argv[2], sys.argv[3]
Image.open(src).convert("RGBA").save(out + "/ic_launcher.png")
Image.open(rnd).convert("RGBA").save(out + "/ic_launcher_round.png")
PY
  aapt2 compile --dir "$WORK/res" -o "$WORK/res.zip" --no-crunch
fi

echo "linking apk"
aapt2 link \
  -o "$WORK/unaligned.apk" \
  --manifest "$WORK/AndroidManifest.xml" \
  -I "$ANDROID_JAR" \
  -A "$WORK/assets" \
  --min-sdk-version 23 \
  --target-sdk-version 34 \
  "$WORK/res.zip"

echo "javac"
find "$WORK/src" -name '*.java' > "$WORK/sources.list"
javac --release 8 -encoding UTF-8 -classpath "$ANDROID_JAR" -d "$WORK/classes" @"$WORK/sources.list"

echo "dex"
"$DX" --dex --min-sdk-version=23 --output="$WORK/classes.dex" "$WORK/classes"

cp "$WORK/unaligned.apk" "$WORK/with-dex.apk"
(cd "$WORK" && zip -q -0 -j -X with-dex.apk classes.dex)

echo "zipalign + sign"
zipalign -f -p 4 "$WORK/with-dex.apk" "$WORK/aligned.apk"

KS="$ROOT/suisui-memorial.keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair \
    -keystore "$KS" \
    -storepass suisui-memorial \
    -keypass suisui-memorial \
    -alias suisui \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=Suisui Memorial, OU=Suisui, O=Suisui, C=CN"
fi

apksigner sign \
  --ks "$KS" \
  --ks-pass pass:suisui-memorial \
  --key-pass pass:suisui-memorial \
  --ks-key-alias suisui \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --out "$WORK/signed.apk" \
  "$WORK/aligned.apk"

mkdir -p "$OUT_DIR"
cp -f "$WORK/signed.apk" "$OUT_APK"

echo "==== apksigner verify ===="
apksigner verify -v "$OUT_APK"

echo "==== aapt dump badging ===="
aapt dump badging "$OUT_APK" > "$WORK/badging.txt"
cat "$WORK/badging.txt"

python3 - "$WORK/badging.txt" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
problems = []
if "package: name='com.suisui.memorial'" not in text:
    problems.append("package name")
if "岁岁纪念馆" not in text and "\\u5c81\\u5c81\\u7eaa\\u5ff5\\u9986" not in text.lower():
    problems.append("app label")
if "android.permission.INTERNET" in text:
    problems.append("INTERNET permission declared")
if "uses-permission:" in text:
    problems.append("unexpected uses-permission")
if "icon=" not in text:
    problems.append("launcher icon")
if problems:
    sys.stderr.write("badging check failed: " + ", ".join(problems) + "\n")
    sys.exit(1)
print("BADGING OK package=com.suisui.memorial label=岁岁纪念馆 internet=0")
PY

ls -lh "$OUT_APK"
echo "BUILD OK $OUT_APK"
