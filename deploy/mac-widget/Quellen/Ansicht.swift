// Daily-Widget für den Mac — wie es aussieht.
//
// Drei Größen wie bei Apples eigenen Widgets:
//   klein  — Score, Vergleich zu gestern, Lernzeit zum Ziel, Aufgabenstand
//   mittel — links der Score mit Lernzeit, rechts die drei wichtigsten Aufgaben
//   groß   — dazu bis zu fünf Aufgaben
// Farben nur über primary/secondary und eine Akzentfarbe, damit macOS das
// Widget auf dem Schreibtisch selbst einfärben kann (getönt/Glas), statt
// dass harte Farben dort falsch aussehen.

import SwiftUI
import WidgetKit

enum Familie { case klein, mittel, gross }

private let akzent = Color(red: 0.27, green: 0.59, blue: 0.89)     // #4497E4, Thema „Glas"
private let warm = Color(red: 0.86, green: 0.73, blue: 0.42)       // wichtig
private let fels = Color(red: 0.83, green: 0.49, blue: 0.41)       // dringend

func minutenText(_ min: Int) -> String {
    let m = max(0, min)
    let h = m / 60, r = m % 60
    if h == 0 { return "\(r) min" }
    return r == 0 ? "\(h) h" : "\(h) h \(String(format: "%02d", r))"
}

private func stufe(_ score: Int) -> String {
    if score >= 85 { return "sehr stark" }
    if score >= 70 { return "starker Tag" }
    if score >= 40 { return "auf dem Weg" }
    return score > 0 ? "noch viel Luft" : "noch nichts passiert"
}

private func vergleich(_ s: Stand) -> String? {
    guard let heute = s.score, let gestern = s.gestern else { return nil }
    let d = heute - gestern
    if d == 0 { return "wie gestern" }
    return d > 0 ? "+\(d) zu gestern" : "−\(-d) zu gestern"
}

struct DailyAnsicht: View {
    let ergebnis: Ergebnis
    let familie: Familie

    var body: some View {
        switch ergebnis {
        case .frisch(let s, _): Inhalt(s: s, familie: familie, hinweis: nil)
        case .alt(let s, let zeit, _):
            Inhalt(s: s, familie: familie, hinweis: "Stand \(zeit.formatted(date: .omitted, time: .shortened))")
        case .fehler(let grund): Fehler(grund: grund)
        }
    }
}

private struct Fehler: View {
    let grund: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Daily").font(.caption).foregroundStyle(.secondary)
            Spacer()
            Text(grund).font(.callout)
            Text("Neuer Versuch in ein paar Minuten").font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct Balken: View {
    let anteil: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(.primary.opacity(0.15))
                Capsule().fill(akzent).frame(width: max(3, g.size.width * min(1, max(0, anteil))))
            }
        }
        .frame(height: 4)
    }
}

private struct ScoreBlock: View {
    let s: Stand
    let gross: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Score heute").font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(s.score.map(String.init) ?? "–")
                    .font(.system(size: gross ? 48 : 42, weight: .light, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                if let v = vergleich(s) {
                    Text(v).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Text(s.score.map(stufe) ?? "noch kein Stand").font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct LernBlock: View {
    let s: Stand
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("Lernzeit").foregroundStyle(.secondary)
                Spacer()
                Text(minutenText(s.lernMin))
                    + Text(s.zielMin > 0 ? " / \(minutenText(s.zielMin))" : "").foregroundStyle(.secondary)
            }
            .font(.caption)
            Balken(anteil: s.zielMin > 0 ? Double(s.lernMin) / Double(s.zielMin) : 0)
        }
    }
}

private struct AufgabenListe: View {
    let s: Stand
    let max: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Aufgaben").foregroundStyle(.secondary)
                Spacer()
                Text("\(s.aufgaben.erledigt)/\(s.aufgaben.erledigt + s.aufgaben.offen)").monospacedDigit()
            }
            .font(.caption)
            if s.aufgaben.liste.isEmpty {
                Text("Nichts offen für heute").font(.callout).foregroundStyle(.secondary)
            }
            ForEach(Array(s.aufgaben.liste.prefix(max).enumerated()), id: \.offset) { _, a in
                HStack(spacing: 8) {
                    Circle()
                        .strokeBorder(farbe(a.prio), lineWidth: 1.5)
                        .frame(width: 11, height: 11)
                    Text(a.text).font(.callout).lineLimit(1)
                }
            }
            if s.aufgaben.offen > max {
                Text("+\(s.aufgaben.offen - max) weitere").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private func farbe(_ prio: String) -> Color {
        switch prio {
        case "dringend": return fels
        case "wichtig": return warm
        default: return .secondary
        }
    }
}

private struct Inhalt: View {
    let s: Stand
    let familie: Familie
    let hinweis: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch familie {
            case .klein:
                ScoreBlock(s: s, gross: false)
                Spacer(minLength: 6)
                LernBlock(s: s)
                Spacer(minLength: 6)
                HStack {
                    Text("Aufgaben").foregroundStyle(.secondary)
                    Spacer()
                    Text("\(s.aufgaben.erledigt)/\(s.aufgaben.erledigt + s.aufgaben.offen)").monospacedDigit()
                }
                .font(.caption)
            case .mittel:
                HStack(alignment: .top, spacing: 18) {
                    VStack(alignment: .leading, spacing: 0) {
                        ScoreBlock(s: s, gross: false)
                        Spacer(minLength: 6)
                        LernBlock(s: s)
                    }
                    .frame(maxWidth: 150)
                    AufgabenListe(s: s, max: 3)
                }
            case .gross:
                // Feste Abstände von oben nach unten; der freie Rest bleibt
                // unten, statt sich als Lücken zwischen die Blöcke zu legen.
                ScoreBlock(s: s, gross: true)
                LernBlock(s: s).padding(.top, 14)
                AufgabenListe(s: s, max: 6).padding(.top, 20)
                Spacer(minLength: 0)
            }
            if let h = hinweis {
                Text(h).font(.caption2).foregroundStyle(.tertiary).padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
