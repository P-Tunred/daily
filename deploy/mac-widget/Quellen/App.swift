// Daily-Widget für den Mac — die kleine Begleit-App.
//
// macOS nimmt ein Widget nur aus einer App heraus an, und oft erst, nachdem
// diese App einmal gestartet wurde. Dafür ist sie da und sonst fast leer:
// · normal gestartet (Doppelklick, build.sh nach dem Installieren): beendet
//   sich gleich wieder — macOS kennt das Widget danach
// · über dailywidget:// gestartet (Klick aufs Widget): öffnet Daily.app
// Kein Dock-Symbol (LSUIElement).

import AppKit

final class Steuerung: NSObject, NSApplicationDelegate {
    private var perLink = false

    func applicationDidFinishLaunching(_ note: Notification) {
        // Ein Link kommt kurz nach dem Start an. Bleibt er aus, war es ein
        // normaler Start: nichts öffnen, nur beenden.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            if self?.perLink != true { NSApp.terminate(nil) }
        }
    }

    func application(_ app: NSApplication, open urls: [URL]) {
        perLink = true
        oeffneDaily()
    }

    private func oeffneDaily() {
        let ws = NSWorkspace.shared
        guard let daily = ws.urlForApplication(withBundleIdentifier: "com.example.daily") else {
            NSApp.terminate(nil)
            return
        }
        ws.openApplication(at: daily, configuration: NSWorkspace.OpenConfiguration()) { _, _ in
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
}

let app = NSApplication.shared
let steuerung = Steuerung()
app.delegate = steuerung
app.run()
