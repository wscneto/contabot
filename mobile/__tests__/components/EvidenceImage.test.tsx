import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { EvidenceImage } from '@/components/EvidenceImage';
import { parseAiMarks } from '@/utils/evidence-marks';

const marks = parseAiMarks({
  frame: 'f.jpg',
  width: 1000,
  height: 500,
  boxes: [
    [0, 0, 500, 1000],
    [500, 0, 1000, 1000],
  ],
  marked: 2,
  duplicates_removed: 0,
  method: 'marked',
  facings: null,
  depth: null,
  depth_frame: null,
})!;

async function renderWithLayout() {
  await render(<EvidenceImage url="https://x/f.jpg" marks={marks} />);
  await fireEvent(screen.getByTestId('evidence-stage'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 400 } },
  });
}

describe('<EvidenceImage />', () => {
  test('desenha uma caixa numerada por unidade, posicionada sobre a imagem', async () => {
    await renderWithLayout();
    const boxes = screen.getAllByTestId('evidence-box');
    expect(boxes).toHaveLength(2);
    // Imagem 2:1 em 400x400 → área 400x200 a partir de y=100.
    expect(boxes[1]).toHaveStyle({ left: 200, top: 100, width: 200, height: 200 });
    expect(screen.getByText('2')).toBeOnTheScreen();
    expect(screen.getByText('2 unidades marcadas pela IA')).toBeOnTheScreen();
  });

  test('permite ocultar e mostrar as marcações', async () => {
    const user = userEvent.setup();
    await renderWithLayout();
    await user.press(screen.getByLabelText('Ocultar marcações'));
    expect(screen.queryAllByTestId('evidence-box')).toHaveLength(0);
    await user.press(screen.getByLabelText('Mostrar marcações'));
    expect(screen.getAllByTestId('evidence-box')).toHaveLength(2);
  });

  test('sem marcações mostra só a imagem', async () => {
    await render(<EvidenceImage url="https://x/f.jpg" marks={null} />);
    expect(screen.queryAllByTestId('evidence-box')).toHaveLength(0);
    expect(screen.queryByText(/marcações/)).toBeNull();
  });
});
