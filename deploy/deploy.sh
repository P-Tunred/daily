#!/usr/bin/env bash
# Neuen Stand aus GitHub holen, bauen, Dienst neu starten — und ERST DANN
# Erfolg melden, wenn der Dienst nachweislich gesund ist.
#
# WARUM DAS GATE AM ENDE STEHT
# Vorher endete dieses Skript mit `systemctl status` — das sagt nur, dass ein
# Prozess läuft. Ein Dienst, der steht, aber dessen Zustand unlesbar ist oder
# dessen Briefing falsch datiert ist, sah damit genauso aus wie ein gesunder.
# Genau diese Lücke hat den Fehler vom 15.08. tagelang getragen.
#
# Aufruf auf der VM:  /opt/daily/app/deploy/deploy.sh
set -euo pipefail

APP=/opt/daily/app
cd "$APP"

VORHER=$(git rev-parse HEAD)

echo "==> Stand holen"
git pull --ff-only

echo "==> Abhängigkeiten"
npm ci

echo "==> Bauen (enthält die Geheimnis-Prüfung)"
npm run build

echo "==> Vertragstests (verändern nichts am Bestand — eigenes Datenverzeichnis)"
npm test

echo "==> Dienst neu starten"
sudo systemctl restart daily
# Kurz Luft geben: der Server liest beim Start Kalender und Vault ein.
sleep 4

echo "==> Gate: read-only Gesundheitsprüfung"
if ! /usr/bin/node "$APP/scripts/smoke-readonly.mjs"; then
  echo ""
  echo "  ✖ Die Prüfung nach dem Neustart ist rot."
  echo "    Der Dienst läuft mit dem NEUEN Stand ($(git rev-parse --short HEAD))."
  echo "    Vorheriger Stand war: $(git rev-parse --short "$VORHER")"
  echo "    Zurückrollen:  cd $APP && git reset --hard $VORHER && npm ci && npm run build && sudo systemctl restart daily"
  echo ""
  exit 1
fi

echo ""
echo "==> Fertig: $(git rev-parse --short HEAD) läuft und ist gesund."
systemctl --no-pager --lines=5 status daily | head -4
