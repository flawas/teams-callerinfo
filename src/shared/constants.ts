/** Pflicht-Quellenangabe gemäss Nutzungsbedingungen tel.search.ch (Ziff. 4.2) */
export const SEARCHCH_ATTRIBUTION = "Quelle: Swisscom Directories AG · tel.search.ch";

export const FIELD_TYPES = ["text", "link", "email", "phone", "date", "badge"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
