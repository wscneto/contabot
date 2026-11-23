import { Text } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { OnboardingChecklistCard } from '@/components/OnboardingChecklistCard';

describe('<OnboardingChecklistCard />', () => {
  const baseProps = {
    hasProducts: false,
    hasProductPhotos: false,
    hasAreas: false,
    hasAnyTask: false,
    onProductsPress: jest.fn(),
    onAreasPress: jest.fn(),
    onStartCountPress: jest.fn(),
    onInviteTeamPress: jest.fn(),
    onDismiss: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  test('exibe 0 de 3 concluídos em loja recém-criada e aciona cada passo', async () => {
    const user = userEvent.setup();
    await render(<OnboardingChecklistCard {...baseProps} />);

    expect(screen.getByText('Primeiros passos da loja')).toBeOnTheScreen();
    expect(screen.getByText('0 de 3 concluídos')).toBeOnTheScreen();
    expect(screen.getByText('Cadastrar produtos')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: /1\. Cadastrar produtos com foto/ }));
    expect(baseProps.onProductsPress).toHaveBeenCalledTimes(1);

    await user.press(screen.getByRole('button', { name: /2\. Criar áreas da loja/ }));
    expect(baseProps.onAreasPress).toHaveBeenCalledTimes(1);

    await user.press(screen.getByRole('button', { name: /3\. Iniciar a primeira contagem/ }));
    expect(baseProps.onStartCountPress).toHaveBeenCalledTimes(1);

    await user.press(screen.getByText(/Cadastre sua equipe/));
    expect(baseProps.onInviteTeamPress).toHaveBeenCalledTimes(1);

    await user.press(screen.getByLabelText('Ocultar guia inicial'));
    expect(baseProps.onDismiss).toHaveBeenCalledTimes(1);
  });

  test('quando há produtos sem foto, orienta adicionar fotos antes de marcar o passo 1', async () => {
    await render(
      <OnboardingChecklistCard
        {...baseProps}
        hasProducts
        hasProductPhotos={false}
        onInviteTeamPress={undefined}
        onDismiss={undefined}
      />,
    );

    expect(screen.getByText('0 de 3 concluídos')).toBeOnTheScreen();
    expect(screen.getByText('Adicionar fotos')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Ocultar guia inicial')).not.toBeOnTheScreen();
    expect(screen.queryByText(/Cadastre sua equipe/)).not.toBeOnTheScreen();
  });

  test('avança o destaque para o passo 2 e depois para o passo 3 conforme conclui', async () => {
    await render(
      <OnboardingChecklistCard
        {...baseProps}
        hasProducts
        hasProductPhotos
        hasAreas={false}
      />,
    );
    expect(screen.getByText('1 de 3 concluídos')).toBeOnTheScreen();
    expect(screen.getByText('Criar área')).toBeOnTheScreen();

    await render(
      <OnboardingChecklistCard
        {...baseProps}
        hasProducts
        hasProductPhotos
        hasAreas
        hasAnyTask={false}
      />,
    );
    expect(screen.getByText('2 de 3 concluídos')).toBeOnTheScreen();
    expect(screen.getByText('Nova contagem')).toBeOnTheScreen();
  });

  test('não renderiza quando os 3 passos já foram concluídos', async () => {
    await render(
      <>
        <Text>conteudo</Text>
        <OnboardingChecklistCard
          {...baseProps}
          hasProducts
          hasProductPhotos
          hasAreas
          hasAnyTask
        />
      </>,
    );

    expect(screen.queryByText('Primeiros passos da loja')).not.toBeOnTheScreen();
  });
});
