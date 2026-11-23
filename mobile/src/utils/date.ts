/**
 * Formatação, máscara e validação de datas de prazo (ISO AAAA-MM-DD <-> BR DD/MM/AAAA).
 *
 * Datas sem hora (date) são manipuladas como componentes ano/mês/dia para evitar
 * deslocamentos de fuso horário (ex.: UTC virando o dia anterior/seguinte).
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Retorna uma data local deslocada em dias no formato ISO (AAAA-MM-DD). */
export function getRelativeIsoDate(offsetDays: number, baseDate: Date = new Date()): string {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Converte AAAA-MM-DD para DD/MM/AAAA. Devolve o texto original se já não for ISO. */
export function formatIsoDateToBR(iso: string | null | undefined): string {
  if (!iso) return '';
  const trimmed = iso.trim();
  const match = ISO_DATE_RE.exec(trimmed);
  if (!match) return trimmed;
  const [, year, month, day] = match;
  if (!isValidCalendarDate(Number(year), Number(month), Number(day))) {
    return trimmed;
  }
  return `${day}/${month}/${year}`;
}

/**
 * Converte DD/MM/AAAA (ou AAAA-MM-DD) para AAAA-MM-DD.
 * Retorna `null` se a entrada for vazia ou inválida.
 */
export function parseBRDateToIso(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const brMatch = BR_DATE_RE.exec(trimmed);
  if (brMatch) {
    const [, day, month, year] = brMatch;
    if (!isValidCalendarDate(Number(year), Number(month), Number(day))) return null;
    return `${year}-${month}-${day}`;
  }

  const isoMatch = ISO_DATE_RE.exec(trimmed);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    if (!isValidCalendarDate(Number(year), Number(month), Number(day))) return null;
    return `${year}-${month}-${day}`;
  }

  return null;
}

/** Aplica máscara DD/MM/AAAA enquanto o usuário digita apenas números. */
export function maskBRDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
