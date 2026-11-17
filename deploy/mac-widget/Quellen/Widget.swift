// Daily-Widget für den Mac — die WidgetKit-Erweiterung.
//
// Frischt sich alle 15 Minuten auf (wie das iPhone-Widget); nach einem
// Fehlschlag schon nach 5. Ein Klick öffnet die Begleit-App, die Daily.app
// startet (siehe App.swift).

import SwiftUI
import WidgetKit

struct Eintrag: TimelineEntry {
    let date: Date
    let ergebnis: Ergebnis
}

struct Anbieter: TimelineProvider {
    func placeholder(in context: Context) -> Eintrag {
        Eintrag(date: Date(), ergebnis: .frisch(.beispiel, Date()))
    }

    func getSnapshot(in context: Context, completion: @escaping (Eintrag) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        Task { completion(Eintrag(date: Date(), ergebnis: await Laden.holen())) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Eintrag>) -> Void) {
        Task {
            let ergebnis = await Laden.holen()
            let minuten: Double
            if case .frisch = ergebnis { minuten = 15 } else { minuten = 5 }
            let eintrag = Eintrag(date: Date(), ergebnis: ergebnis)
            completion(Timeline(entries: [eintrag], policy: .after(Date().addingTimeInterval(minuten * 60))))
        }
    }
}

struct DailyWidgetAnsicht: View {
    @Environment(\.widgetFamily) private var groesse
    let eintrag: Eintrag

    var body: some View {
        DailyAnsicht(ergebnis: eintrag.ergebnis, familie: familie)
            .containerBackground(.fill.tertiary, for: .widget)
            .widgetURL(URL(string: "dailywidget://oeffnen"))
    }

    private var familie: Familie {
        switch groesse {
        case .systemSmall: return .klein
        case .systemLarge, .systemExtraLarge: return .gross
        default: return .mittel
        }
    }
}

@main
struct DailyWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "DailyWidget", provider: Anbieter()) { eintrag in
            DailyWidgetAnsicht(eintrag: eintrag)
        }
        .configurationDisplayName("Daily")
        .description("Score, Lernzeit und offene Aufgaben von heute.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
