// Stunden auf Deutsch: 198 min → „3,3", 180 min → „3". Eine Nachkommastelle,
// Komma statt Punkt, „,0" fällt weg. Für alles, was Stunden als Zahl zeigt
// (Lernzeit, Wochenplan im Stil G), damit überall dieselbe Schreibweise steht.
export function stundenZahl(min: number): string {
  return (min / 60).toFixed(1).replace(".", ",").replace(/,0$/, "");
}
