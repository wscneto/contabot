/**
 * Marcações da IA no quadro de evidência (task_items.ai_marks): uma caixa por
 * unidade física, em coordenadas 0–1000 relativas à imagem.
 */

export type MarkBox = [number, number, number, number];

export interface AiMarks {
  frame: string;
  width: number | null;
  height: number | null;
  boxes: MarkBox[];
  marked: number;
  duplicates_removed: number;
  method: 'marked' | 'layout';
  facings: number | null;
  depth: number | null;
  depth_frame: string | null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const positiveOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

function parseBox(value: unknown): MarkBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const n = value.map((v) => Math.max(0, Math.min(1000, v as number)));
  return [Math.min(n[0], n[2]), Math.min(n[1], n[3]), Math.max(n[0], n[2]), Math.max(n[1], n[3])];
}

/** Lê ai_marks vindo do servidor; qualquer formato inesperado vira null (sem marcações). */
export function parseAiMarks(raw: unknown): AiMarks | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.frame !== 'string' || !r.frame || !Array.isArray(r.boxes)) return null;
  const boxes = r.boxes.map(parseBox).filter((b): b is MarkBox => b !== null);
  return {
    frame: r.frame,
    width: positiveOrNull(r.width),
    height: positiveOrNull(r.height),
    boxes,
    marked: typeof r.marked === 'number' ? r.marked : boxes.length,
    duplicates_removed: typeof r.duplicates_removed === 'number' ? r.duplicates_removed : 0,
    method: r.method === 'layout' ? 'layout' : 'marked',
    facings: positiveOrNull(r.facings),
    depth: positiveOrNull(r.depth),
    depth_frame: typeof r.depth_frame === 'string' && r.depth_frame ? r.depth_frame : null,
  };
}

/**
 * Marcações que valem para o quadro de evidência deste item: só quando a IA
 * sugeriu uma quantidade e as caixas foram desenhadas nesse mesmo quadro.
 */
export function itemMarks(item: { ai_marks?: unknown; evidence_frame?: string | null; ai_quantity?: number | null }) {
  const marks = parseAiMarks(item.ai_marks);
  if (!marks || item.ai_quantity === null || item.ai_quantity === undefined) return null;
  return marks.frame === item.evidence_frame ? marks : null;
}

/** Área ocupada por uma imagem com contentFit="contain" dentro do contêiner. */
export function containRect(container: { width: number; height: number }, image: { width: number; height: number }): Rect {
  if (!(container.width > 0 && container.height > 0 && image.width > 0 && image.height > 0)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height };
}

/** Posição na tela de uma caixa 0–1000 dentro da área da imagem. */
export function boxToRect(box: MarkBox, area: Rect): Rect {
  return {
    x: area.x + (box[0] / 1000) * area.width,
    y: area.y + (box[1] / 1000) * area.height,
    width: ((box[2] - box[0]) / 1000) * area.width,
    height: ((box[3] - box[1]) / 1000) * area.height,
  };
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Legenda curta mostrada junto da imagem. */
export function marksCaption(marks: AiMarks): string {
  const marked = plural(marks.marked, 'unidade marcada', 'unidades marcadas');
  if (marks.method === 'layout' && marks.facings && marks.depth) {
    return `${marked} · estimativa ${marks.facings} × ${marks.depth} = ${marks.facings * marks.depth} pelo arranjo`;
  }
  return `${marked} pela IA`;
}
