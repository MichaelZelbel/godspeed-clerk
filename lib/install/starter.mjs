// The starter set of document types and tags a fresh Paperless gets (F1, PRD section 10), in the
// language the person talks to Godspeed in: the nine kinds of paper most households have, the inbox
// tag every new scan gets (the Clerk's queue, F5), "Tax <year>" for the last three years, a health
// tag, and the Clerk's own tags. The Clerk's settings take the same names, and "To sort" with them.
// As set up by hand on 22 October 2026, without anything of one person's (no house, no company).

export const STARTERS = Object.freeze({
  english: {
    language: "English",
    types: ["Invoice", "Notice", "Contract", "Bank statement", "Pay slip", "Insurance", "Certificate", "Receipt", "Letter"],
    inbox: "Inbox", health: "Health", to_sort: "To sort",
    tags: { check: "Check this", tax_prefix: "Tax", not_in_notebook: "Not in notebook", important: "Important" },
  },
  german: {
    language: "German",
    types: ["Rechnung", "Bescheid", "Vertrag", "Kontoauszug", "Lohnabrechnung", "Versicherung", "Bescheinigung", "Quittung", "Brief"],
    inbox: "Posteingang", health: "Gesundheit", to_sort: "Zu sortieren",
    tags: { check: "Prüfen", tax_prefix: "Steuer", not_in_notebook: "Nicht ins Notizbuch", important: "Wichtig" },
  },
  french: {
    language: "French",
    types: ["Facture", "Avis", "Contrat", "Relevé bancaire", "Fiche de paie", "Assurance", "Attestation", "Reçu", "Lettre"],
    inbox: "Boîte de réception", health: "Santé", to_sort: "À trier",
    tags: { check: "À vérifier", tax_prefix: "Impôts", not_in_notebook: "Hors du carnet", important: "Important" },
  },
  spanish: {
    language: "Spanish",
    types: ["Factura", "Notificación", "Contrato", "Extracto bancario", "Nómina", "Seguro", "Certificado", "Recibo", "Carta"],
    inbox: "Bandeja de entrada", health: "Salud", to_sort: "Por ordenar",
    tags: { check: "Revisar", tax_prefix: "Impuestos", not_in_notebook: "Fuera del cuaderno", important: "Importante" },
  },
  italian: {
    language: "Italian",
    types: ["Fattura", "Avviso", "Contratto", "Estratto conto", "Busta paga", "Assicurazione", "Certificato", "Ricevuta", "Lettera"],
    inbox: "Posta in arrivo", health: "Salute", to_sort: "Da smistare",
    tags: { check: "Da controllare", tax_prefix: "Tasse", not_in_notebook: "Fuori dal quaderno", important: "Importante" },
  },
  dutch: {
    language: "Dutch",
    types: ["Factuur", "Aanslag", "Contract", "Bankafschrift", "Loonstrook", "Verzekering", "Verklaring", "Kwitantie", "Brief"],
    inbox: "Inbox", health: "Gezondheid", to_sort: "Te sorteren",
    tags: { check: "Controleren", tax_prefix: "Belasting", not_in_notebook: "Niet in notitieboek", important: "Belangrijk" },
  },
});

const ALIASES = { deutsch: "german", "français": "french", francais: "french", "español": "spanish", espanol: "spanish", italiano: "italian", nederlands: "dutch" };

export function starterFor(language) {
  const k = String(language || "").trim().toLowerCase();
  return STARTERS[ALIASES[k] || k] || STARTERS.english;
}

// The tags, in the order they are made: the inbox tag first (is_inbox_tag), the three tax years
// before `year`, health, then the Clerk's own.
export function starterTags(s, year = new Date().getFullYear()) {
  return [
    { name: s.inbox, is_inbox_tag: true },
    ...[3, 2, 1].map((n) => ({ name: `${s.tags.tax_prefix} ${year - n}` })),
    { name: s.health },
    { name: s.tags.important },
    { name: s.tags.check },
    { name: s.tags.not_in_notebook },
  ];
}
