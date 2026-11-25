import { boxToRect, containRect, itemMarks, marksCaption, parseAiMarks } from '@/utils/evidence-marks';

const raw = {
  frame: 'loja/captures/c1/f0003.jpg',
  width: 1024,
  height: 576,
  boxes: [
    [100, 200, 300, 600],
    [400, 650, 300, 250], // cantos invertidos
  ],
  marked: 2,
  duplicates_removed: 1,
  method: 'marked',
  facings: null,
  depth: null,
  depth_frame: null,
};

describe('utils/evidence-marks', () => {
  test('parseAiMarks lê as marcações e normaliza caixas invertidas', () => {
    const marks = parseAiMarks(raw)!;
    expect(marks.boxes).toEqual([
      [100, 200, 300, 600],
      [300, 250, 400, 650],
    ]);
    expect(marks.method).toBe('marked');
    expect(marks.width).toBe(1024);
  });

  test('parseAiMarks descarta formatos inesperados sem lançar', () => {
    for (const value of [null, undefined, 'x', [], {}, { frame: '', boxes: [] }, { frame: 'a', boxes: 'b' }]) {
      expect(parseAiMarks(value)).toBeNull();
    }
    const withJunk = parseAiMarks({ ...raw, boxes: [[1, 2, 3], ['a', 1, 2, 3], [0, 0, 10, 10]], width: -1 })!;
    expect(withJunk.boxes).toEqual([[0, 0, 10, 10]]);
    expect(withJunk.width).toBeNull();
  });

  test('itemMarks só vale com quantidade sugerida e o mesmo quadro de evidência', () => {
    const item = { ai_marks: raw, evidence_frame: raw.frame, ai_quantity: 2 };
    expect(itemMarks(item)).not.toBeNull();
    expect(itemMarks({ ...item, ai_quantity: null })).toBeNull();
    expect(itemMarks({ ...item, evidence_frame: 'outro.jpg' })).toBeNull();
    expect(itemMarks({ ...item, ai_marks: null })).toBeNull();
  });

  test('containRect centraliza a imagem como contentFit="contain"', () => {
    // Imagem 16:9 num contêiner retrato: ocupa a largura toda, centralizada na vertical.
    expect(containRect({ width: 360, height: 640 }, { width: 1600, height: 900 })).toEqual({
      x: 0,
      y: 218.75,
      width: 360,
      height: 202.5,
    });
    expect(containRect({ width: 0, height: 100 }, { width: 10, height: 10 }).width).toBe(0);
  });

  test('boxToRect converte 0–1000 para a área da imagem', () => {
    const area = { x: 10, y: 20, width: 200, height: 100 };
    expect(boxToRect([0, 0, 1000, 1000], area)).toEqual(area);
    expect(boxToRect([500, 500, 750, 1000], area)).toEqual({ x: 110, y: 70, width: 50, height: 50 });
  });

  test('marksCaption descreve marcação direta e estimativa pelo arranjo', () => {
    expect(marksCaption(parseAiMarks(raw)!)).toBe('2 unidades marcadas pela IA');
    expect(marksCaption(parseAiMarks({ ...raw, marked: 1 })!)).toBe('1 unidade marcada pela IA');
    const layout = parseAiMarks({ ...raw, method: 'layout', facings: 4, depth: 3, depth_frame: 'x.jpg', marked: 5 })!;
    expect(marksCaption(layout)).toBe('5 unidades marcadas · estimativa 4 × 3 = 12 pelo arranjo');
  });
});
