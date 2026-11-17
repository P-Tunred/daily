#!/bin/bash
# Baut „Daily Widget.app" — ein echtes macOS-Widget (WidgetKit) für Daily.
#
# WARUM SO
# Paul, 2026-11-15: „as a real macOS widget". Ein WidgetKit-Widget lebt als
# Erweiterung (.appex) in einer App. Volles Xcode ist nicht installiert — es
# reichen die Command Line Tools: swiftc kompiliert, dieses Skript legt die
# Bundles an, codesign signiert lokal („-", wie Xcodes „Sign to Run Locally").
# Kein bezahltes Entwicklerkonto nötig, solange das Widget nur auf diesem Mac
# läuft.
#
# AUFRUF
#   deploy/mac-widget/build.sh            # baut nach deploy/mac-widget/build/
#   INSTALL=1 deploy/mac-widget/build.sh  # und kopiert nach /Applications
#
# SERVER UND SCHLÜSSEL
#   DAILY_WIDGET_SERVER      Standard: die VM über Tailscale
#   DAILY_WIDGET_TOKEN_FILE  Standard: ~/Library/Application Support/Daily/widget-token
# Der Schlüssel wird nur in die Erweiterung kopiert, nie ausgegeben. build/
# ist in .gitignore — die fertige App mit Schlüssel landet nie im Git.

set -euo pipefail

HIER="$(cd "$(dirname "$0")" && pwd)"
QUELLEN="$HIER/Quellen"
AUS="${AUS:-$HIER/build}"
APP="$AUS/Daily Widget.app"
EXT="$APP/Contents/PlugIns/DailyWidgetExtension.appex"
SDK="$(xcrun --show-sdk-path)"
ZIEL="arm64-apple-macos14.0"
APP_ID="com.example.dailywidget"
SERVER="${DAILY_WIDGET_SERVER:-http://your-server.example:4861}"
TOKEN_DATEI="${DAILY_WIDGET_TOKEN_FILE:-$HOME/Library/Application Support/Daily/widget-token}"
VERSION="1.0"
BUILD_NR="$(date +%Y%m%d%H%M)"
# Angaben, die Xcode immer in die Info.plist schreibt — damit das Bundle
# einem normal gebauten Widget so nah wie möglich kommt.
SDK_VERSION="$(xcrun --show-sdk-version)"
SDK_BUILD="$(xcrun --show-sdk-build-version)"
OS_BUILD="$(sw_vers -buildVersion)"

if [ ! -s "$TOKEN_DATEI" ]; then
  echo "Kein Widget-Schlüssel in: $TOKEN_DATEI" >&2
  echo "Datei anlegen (nur der Schlüssel, eine Zeile), dann neu bauen." >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$EXT/Contents/MacOS" "$EXT/Contents/Resources"

echo "→ Erweiterung kompilieren"
# -e _NSExtensionMain: Einstiegspunkt für App-Erweiterungen. Xcode setzt ihn
# von selbst; ohne ihn startet die Erweiterung und stürzt sofort in
# ExtensionFoundation ab (SIGTRAP in _EXRunningExtension) — so am 15.11.
# beobachtet, das Widget fehlte deshalb in der Galerie.
swiftc -parse-as-library -application-extension -O \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -target "$ZIEL" -sdk "$SDK" \
  "$QUELLEN/Modell.swift" "$QUELLEN/Ansicht.swift" "$QUELLEN/Widget.swift" \
  -o "$EXT/Contents/MacOS/DailyWidgetExtension"

echo "→ Begleit-App kompilieren"
swiftc -O -target "$ZIEL" -sdk "$SDK" \
  "$QUELLEN/App.swift" \
  -o "$APP/Contents/MacOS/DailyWidget"

# Server und Schlüssel als JSON — über Python, damit kein Zeichen im Schlüssel
# die Datei kaputtmacht und nichts davon in der Ausgabe erscheint.
python3 - "$SERVER" "$TOKEN_DATEI" "$EXT/Contents/Resources/widget-config.json" <<'PY'
import json, sys
server, token_datei, ziel = sys.argv[1:4]
token = open(token_datei, encoding="utf-8").read().strip()
with open(ziel, "w", encoding="utf-8") as f:
    json.dump({"server": server.rstrip("/"), "token": token}, f)
PY
chmod 600 "$EXT/Contents/Resources/widget-config.json"

cat > "$EXT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$APP_ID.extension</string>
  <key>CFBundleExecutable</key><string>DailyWidgetExtension</string>
  <key>CFBundleName</key><string>Daily</string>
  <key>CFBundleDisplayName</key><string>Daily</string>
  <key>CFBundlePackageType</key><string>XPC!</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD_NR</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>CFBundleSupportedPlatforms</key><array><string>MacOSX</string></array>
  <key>CFBundleDevelopmentRegion</key><string>de</string>
  <key>DTPlatformName</key><string>macosx</string>
  <key>DTPlatformVersion</key><string>$SDK_VERSION</string>
  <key>DTSDKName</key><string>macosx$SDK_VERSION</string>
  <key>DTSDKBuild</key><string>$SDK_BUILD</string>
  <key>DTPlatformBuild</key><string>$SDK_BUILD</string>
  <key>BuildMachineOSBuild</key><string>$OS_BUILD</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string>
  </dict>
  <!-- Die VM spricht http, nicht https. Verschlüsselt ist die Strecke durch
       Tailscale; ATS weiss das nicht. Ausnahmen pro Domain gelten nicht für
       IP-Adressen, deshalb die allgemeine Freigabe — nur in dieser Erweiterung,
       die ausschliesslich die eine Widget-Route abfragt. -->
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsArbitraryLoads</key><true/>
  </dict>
</dict>
</plist>
PLIST

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$APP_ID</string>
  <key>CFBundleExecutable</key><string>DailyWidget</string>
  <key>CFBundleName</key><string>Daily Widget</string>
  <key>CFBundleDisplayName</key><string>Daily Widget</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD_NR</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>CFBundleSupportedPlatforms</key><array><string>MacOSX</string></array>
  <key>CFBundleDevelopmentRegion</key><string>de</string>
  <key>DTPlatformName</key><string>macosx</string>
  <key>DTPlatformVersion</key><string>$SDK_VERSION</string>
  <key>DTSDKName</key><string>macosx$SDK_VERSION</string>
  <key>DTSDKBuild</key><string>$SDK_BUILD</string>
  <key>DTPlatformBuild</key><string>$SDK_BUILD</string>
  <key>BuildMachineOSBuild</key><string>$OS_BUILD</string>
  <key>LSUIElement</key><true/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>$APP_ID</string>
      <key>CFBundleURLSchemes</key><array><string>dailywidget</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST

echo "→ Lokal signieren"
codesign --force --sign - --entitlements "$HIER/Erweiterung.entitlements" --timestamp=none "$EXT"
codesign --force --sign - --entitlements "$HIER/App.entitlements" --timestamp=none "$APP"
codesign --verify --strict "$APP"

echo "✓ Gebaut: $APP"

if [ "${INSTALL:-0}" = "1" ]; then
  ZIELORT="${INSTALL_DIR:-/Applications}"
  rm -rf "$ZIELORT/Daily Widget.app"
  cp -R "$APP" "$ZIELORT/"
  # Anmelden und einmal starten — erst danach nimmt macOS das Widget in die
  # Galerie. Ein normaler Start beendet sich sofort (App.swift).
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$ZIELORT/Daily Widget.app"
  pluginkit -a "$ZIELORT/Daily Widget.app/Contents/PlugIns/DailyWidgetExtension.appex"
  open "$ZIELORT/Daily Widget.app"
  echo "✓ Installiert: $ZIELORT/Daily Widget.app"
fi
