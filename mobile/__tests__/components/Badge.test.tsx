import { render, screen } from '@testing-library/react-native';
import { Badge, type BadgeVariant } from '@/components/Badge';
import { colors } from '@/constants/theme';

describe('<Badge />', () => {
  test.each<[BadgeVariant, string]>([
    ['open', 'Aberto'],
    ['analyzing', 'Processando IA'],
    ['review', 'Conferir'],
    ['submitted', 'Aguardando Gerente'],
    ['approved', 'Aprovada'],
    ['ok', 'Confirmado IA'],
    ['check', 'Revisar IA'],
    ['missing', 'Não avistado'],
    ['manual', 'Manual'],
    ['danger', 'Atenção'],
  ])('variante %s mostra o rótulo padrão "%s"', async (variant, label) => {
    await render(<Badge variant={variant} />);
    expect(screen.getByText(label)).toBeOnTheScreen();
  });

  test('rótulo customizado tem prioridade sobre o padrão', async () => {
    await render(<Badge variant="approved" label="Concluída" />);
    expect(screen.getByText('Concluída')).toBeOnTheScreen();
    expect(screen.queryByText('Aprovada')).not.toBeOnTheScreen();
  });

  test('variante desconhecida (dado inesperado da API) cai no estilo neutro sem quebrar', async () => {
    await render(<Badge variant={'status_novo' as BadgeVariant} label="Novo" />);
    expect(screen.getByText('Novo')).toBeOnTheScreen();
  });

  test('cores do texto seguem a variante', async () => {
    await render(
      <>
        <Badge variant="approved" label="A" />
        <Badge variant="missing" label="B" />
      </>,
    );
    expect(screen.getByText('A')).toHaveStyle({ color: colors.successText });
    expect(screen.getByText('B')).toHaveStyle({ color: colors.dangerText });
  });

  test('rótulo usa uma única linha (texto longo não quebra o layout)', async () => {
    await render(<Badge variant="neutral" label={'x'.repeat(500)} size="sm" />);
    expect(screen.getByText('x'.repeat(500))).toHaveProp('numberOfLines', 1);
  });
});
