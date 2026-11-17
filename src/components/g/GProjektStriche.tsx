// Ein Strich pro Schritt. Ab zwölf Schritten würde das Lineal breiter als die
// Zeile; dann stehen zwölf Striche für den Anteil.

const MAX_STRICHE = 12;

export function Striche({ gesamt, erledigt }: { gesamt: number; erledigt: number }) {
  if (!gesamt) return null;
  const n = Math.min(gesamt, MAX_STRICHE);
  const voll = gesamt <= MAX_STRICHE ? erledigt : Math.round((erledigt / gesamt) * MAX_STRICHE);
  return (
    <span className="p-striche" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < voll ? "voll" : ""} />)}
    </span>
  );
}
