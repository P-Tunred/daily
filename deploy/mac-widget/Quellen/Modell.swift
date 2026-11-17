// Daily-Widget für den Mac — Daten.
//
// Holt GET /api/widget von der VM, dieselbe Route wie das iPhone-Widget
// (deploy/widget/daily-widget.js, electron/widget.cjs). Nur lesend, mit dem
// eigenen Widget-Schlüssel (DAILY_WIDGET_TOKEN), nie dem Daily-Passwort.
//
// Server und Schlüssel stehen in widget-config.json im Bundle der Erweiterung.
// build.sh legt die Datei beim Bauen an; im Git steht sie nie.
//
// Der letzte gute Stand wird gemerkt: ist die VM gerade nicht erreichbar
// (Tailscale aus, unterwegs), zeigt das Widget ihn mit Uhrzeit weiter, statt
// leer zu werden.

import Foundation

struct Aufgabe: Codable, Hashable {
    let text: String
    let prio: String
}

struct Aufgaben: Codable {
    let offen: Int
    let erledigt: Int
    let liste: [Aufgabe]
}

struct Stand: Codable {
    let datum: String
    let score: Int?
    let gestern: Int?
    let lernMin: Int
    let zielMin: Int
    let aufgaben: Aufgaben
}

enum Ergebnis {
    case frisch(Stand, Date)
    case alt(Stand, Date, String)   // letzter guter Stand + warum kein neuer
    case fehler(String)
}

struct Konfig: Decodable {
    let server: String
    let token: String
}

enum Laden {
    static let merkSchluessel = "letzterStand"
    static let merkZeit = "letzterStandZeit"

    static func konfig() -> Konfig? {
        guard let url = Bundle.main.url(forResource: "widget-config", withExtension: "json"),
              let daten = try? Data(contentsOf: url),
              let k = try? JSONDecoder().decode(Konfig.self, from: daten),
              !k.server.isEmpty, !k.token.isEmpty
        else { return nil }
        return k
    }

    static func holen() async -> Ergebnis {
        guard let k = konfig() else { return rueckfall("Kein Schlüssel eingerichtet") }
        guard let url = URL(string: k.server.trimmingCharacters(in: .whitespaces) + "/api/widget") else {
            return rueckfall("Serveradresse unlesbar")
        }
        var anfrage = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        anfrage.setValue("Bearer \(k.token)", forHTTPHeaderField: "Authorization")
        do {
            let (daten, antwort) = try await URLSession.shared.data(for: anfrage)
            let code = (antwort as? HTTPURLResponse)?.statusCode ?? 0
            switch code {
            case 200:
                let stand = try JSONDecoder().decode(Stand.self, from: daten)
                merke(daten)
                return .frisch(stand, Date())
            case 401: return rueckfall("Schlüssel passt nicht")
            case 403: return rueckfall("Widget auf dem Server aus")
            default: return rueckfall("Server antwortet \(code)")
            }
        } catch {
            return rueckfall("VM nicht erreichbar – Tailscale an?")
        }
    }

    private static func merke(_ daten: Data) {
        let d = UserDefaults.standard
        d.set(daten, forKey: merkSchluessel)
        d.set(Date(), forKey: merkZeit)
    }

    private static func rueckfall(_ grund: String) -> Ergebnis {
        let d = UserDefaults.standard
        if let daten = d.data(forKey: merkSchluessel),
           let zeit = d.object(forKey: merkZeit) as? Date,
           let stand = try? JSONDecoder().decode(Stand.self, from: daten) {
            return .alt(stand, zeit, grund)
        }
        return .fehler(grund)
    }
}

extension Stand {
    /// Für die Galerie und die Vorschau-Bilder — erfundene Werte.
    static let beispiel = Stand(
        datum: "2026-11-15", score: 64, gestern: 58, lernMin: 95, zielMin: 180,
        aufgaben: Aufgaben(offen: 4, erledigt: 2, liste: [
            Aufgabe(text: "INTSEC Challenge 2 abgeben", prio: "dringend"),
            Aufgabe(text: "FODS Übungsblatt 6", prio: "wichtig"),
            Aufgabe(text: "Bewerbung Werkstudent nachfassen", prio: "normal"),
            Aufgabe(text: "Wäsche", prio: "normal"),
        ])
    )
}
