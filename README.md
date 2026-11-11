# Contabot 📱📦

Sistema de contagem visual de estoque por vídeo: **aplicativo mobile (Expo / React Native)** sobre **Supabase** (Postgres + Auth + Storage + Edge Functions). O próprio celular escolhe os melhores quadros do vídeo; a contagem é feita por um modelo de visão chamado via API no servidor.

Projetado especificamente para as operações do dia a dia no varejo, dividindo as responsabilidades com foco total em **experiência do usuário (UI/UX)**:
- **Gerente da Loja**: Gestão visual do catálogo de produtos com fotos da embalagem, mapeamento de áreas/gôndolas, emissão de tarefas de contagem, aprovação com histórico de auditoria e monitoramento de divergências de estoque.
- **Funcionário no Salão/Estoque**: Aplicativo de celular ultra-simplificado e à prova de erros. Login rápido via Código de Acesso ou QR Code, filmagem guiada da prateleira (com timer e dicas de foco), contagem por IA em segundo plano e tela ergonômica de conferência com botões de ajuste rápido (+/-) e fotos de evidência antes do envio.

---

## 🏗️ Arquitetura do Projeto

```
contabot/
├── mobile/                  # App Expo SDK 58 (Expo Router)
│   ├── src/
│   │   ├── app/             # Rotas: (auth), (employee), (manager)
│   │   ├── components/      # Design System (Button, Card, Stepper, Badge, QRCodeModal, Input)
│   │   ├── lib/supabase.ts  # Cliente Supabase (sessão persistida com expo-sqlite)
│   │   └── services/
│   │       ├── api.ts       # RPCs, Edge Functions e URLs assinadas do Storage
│   │       └── capture.ts   # Seleção de quadros no aparelho + envio + disparo da análise
│   └── metro.config.js      # Inclui supabase/functions/_shared no bundle
│
├── supabase/
│   ├── migrations/          # Tabelas, RLS, bucket "media" e RPCs (regras de negócio)
│   ├── functions/
│   │   ├── _shared/         # frame-selection.ts (celular + servidor), prompts, validação, provedores
│   │   ├── analyze-capture/ # Identificar → contar com o modelo de visão (VISION_*)
│   │   ├── create-employee/ # Gerente cadastra funcionário e recebe o código de acesso
│   │   ├── join-store/      # Login do funcionário por código (sem e-mail)
│   │   └── tests/           # Testes unitários (Deno)
│   ├── scripts/seed-demo.ts # Loja de demonstração
│   └── tests/               # Teste de ponta a ponta contra o Supabase local
│
└── docs/arquitetura.md      # Dados, contratos e fluxos
```

**Fluxo de uma contagem por vídeo**

1. O funcionário filma (ou escolhe da galeria) e o app cria a captura (`start_capture`).
2. **No celular** (`services/capture.ts`): o `expo-video` extrai ~1 quadro/s; cada quadro é reduzido a 640 px e pontuado (nitidez, exposição, movimento, reflexo, assinatura de similaridade). São escolhidos até 5 quadros de identificação e até 20 no total, incluindo vizinhos a ±2/4/6 s para a etapa de contagem.
3. Só esses quadros (JPEG ≤ 1920 px) vão para o Storage. O vídeo não sai do aparelho.
4. A Edge Function `analyze-capture` chama o modelo duas vezes, **identificar** e **contar**, valida a resposta com as mesmas regras do backend antigo e grava as sugestões. O app acompanha pelas etapas da captura.
5. Qualquer falha manda a contagem para conferência manual. Ela nunca fica presa em "analisando".

---

## 🚀 Como Iniciar o Supabase

### Pré-requisitos
- Docker (para o Supabase local)
- Node.js 18+ e [pnpm](https://pnpm.io/) (a CLI do Supabase roda via `pnpm dlx supabase`)
- [Deno](https://deno.com/) 2+ (seed e testes)

### 1. Subir o Supabase local e aplicar as migrations
```bash
pnpm dlx supabase start          # primeira vez baixa as imagens Docker
pnpm dlx supabase db reset       # recria o banco com supabase/migrations
pnpm dlx supabase status         # mostra API_URL, PUBLISHABLE_KEY, SERVICE_ROLE_KEY, Studio...
```

### 2. Popular dados de demonstração
Cria o *Mercadinho Bom Preço* com gerente, 2 funcionários, produtos com fotos, gôndolas e contagens em vários estados:
```bash
eval "$(pnpm dlx supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY deno run -A supabase/scripts/seed-demo.ts
```

### 3. Configurar o modelo de visão e servir as Edge Functions
```bash
cp supabase/functions/.env.example supabase/functions/.env   # VISION_PROVIDER=mock por padrão
pnpm dlx supabase functions serve --env-file supabase/functions/.env
```
O provedor é configurado só por variáveis `VISION_*` (detalhes em `supabase/functions/.env.example`). Use `VISION_PROVIDER=chat` com qualquer API compatível com **OpenAI Chat Completions** (OpenAI, Gemini, OpenRouter, DeepInfra, Groq, vLLM...) ou `mock` para demonstração sem modelo. A chave fica só no servidor, nunca no app.

### 4. Projeto na nuvem (recomendado para testar no celular)
```bash
pnpm dlx supabase link --project-ref <ref-do-projeto>
pnpm dlx supabase db push
pnpm dlx supabase functions deploy analyze-capture create-employee join-store
pnpm dlx supabase secrets set --env-file supabase/functions/.env
```
No painel do projeto, em *Authentication → Sign In / Providers → Email*, desligue **Confirm email** para o gerente entrar logo após o cadastro. Se ficar ligado, o app pede a confirmação do e-mail antes do primeiro login.

---

## 📱 Como Iniciar o Aplicativo Mobile

### Pré-requisitos
- Aplicativo **Expo Go** instalado no seu celular Android ou iOS. A análise de vídeo não roda na versão Web.

### 1. Instalar dependências e configurar o Supabase
```bash
cd mobile
pnpm install
cp .env.example .env
```
Preencha `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`:
- **Projeto cloud**: `https://<ref>.supabase.co` e a *publishable key* do painel. Funciona em qualquer rede.
- **Supabase local**: `http://IP_DO_SEU_PC:54321` e a `PUBLISHABLE_KEY` de `pnpm dlx supabase status`. O celular precisa alcançar a porta 54321 do PC: mesma rede Wi-Fi, sem isolamento de clientes, e porta liberada no firewall (`sudo ufw allow 54321/tcp`). `127.0.0.1` só funciona no navegador do próprio PC.

### 2. Iniciar o Metro Bundler / Expo
```bash
pnpm expo start --tunnel ngrok
```
Este é o comando padrão do projeto. O túnel via ngrok faz o celular se conectar ao Metro pela internet, sem depender da rede local. Assim, firewall do PC (ex.: `ufw`) e isolamento de clientes em Wi-Fi de universidade ou de convidados não atrapalham. Usar `ngrok` explicitamente evita o túnel padrão do Expo, que exige login em uma conta Expo.

- Para testar no celular físico: abra o app **Expo Go** e escaneie o QR Code exibido no terminal.
- O túnel cobre só o Metro. O acesso ao Supabase segue o endereço configurado no passo 1.
- Alternativa sem túnel (`pnpm start`): só funciona se o celular e o computador estiverem na mesma rede Wi-Fi e a porta `8081` estiver liberada no firewall.

---

## 👥 Credenciais de Demonstração

Ao rodar `supabase/scripts/seed-demo.ts`, as seguintes credenciais são criadas automaticamente:

| Perfil | Identificação | Credencial | Acesso / Permissões |
| :--- | :--- | :--- | :--- |
| **Gerente** (Carla) | `demo@contabot.app` | Senha: `contabot` | Acesso total: criação de tarefas, aprovação, cadastro de produtos com fotos, mapeamento de áreas, convite à equipe. |
| **Funcionária** (Ana) | Código de Acesso | `ANA1-2345` | Foco em filmagem: lista de contagens atribuídas, câmera inteligente, revisão de quantidades e envio. |
| **Funcionário** (João) | Código de Acesso | `JOAO-6789` | Foco em filmagem e recontagens solicitadas pelo gerente. |

> 💡 **Dica de Usabilidade**: Na tela de login do app mobile, há botões de preenchimento rápido ("Entrar como Gerente Carla" e "Entrar como Ana") para facilitar a demonstração imediata sem digitação.

---

## 🔄 Fluxos de Trabalho Reestruturados

### 1. Fluxo do Funcionário (Simples, Rápido e Sem Ruído)
1. **Login Instantâneo**: Digita o código de 8 dígitos ou escaneia o QR Code fornecido pelo gerente.
2. **Minhas Contagens**: Lista somente as áreas que ele precisa contar no momento. Destaque visual em vermelho para solicitações de **Recontagem**.
3. **Câmera Guiada**: Interface com retículo central, nível de estabilidade, dicas de filmagem ("Mantenha velocidade constante", "Mostre topo e laterais"), botão de ligar/desligar lanterna (torch) e temporizador de 30 segundos com parada automática. Antes de gravar, a tela pede para filmar só a prateleira da contagem, começando por uma vista de cima; vídeos da galeria aceitam até 60 s.
4. **Análise em Segundo Plano**: O celular escolhe e envia os melhores quadros; em seguida a IA identifica e conta os produtos no servidor, com o progresso de cada etapa na tela.
5. **Conferência na Prateleira**: Tela com cartões grandes e botões `+` e `-` ergonômicos (com feedback tátil Haptics). Para cada produto, o funcionário pode tocar em **"Ver Evidência"** para abrir a foto ampliada onde a IA detectou as unidades.
6. **Submissão**: Ao clicar em "Confirmar e Enviar", a contagem é enviada para validação da gerência.

### 2. Fluxo do Gerente (Controle e Auditoria)
1. **Painel Geral (Dashboard)**: Métricas em tempo real — contagens aguardando aprovação, alertas de estoque baixo e gôndolas sem conferência recente.
2. **Aprovação de Contagens**: Visão comparativa lado a lado: *Estoque Teórico* vs *Sugerido pela IA* vs *Confirmado pelo Funcionário*.
   - Se os números baterem: o gerente clica em **Aprovar**, o estoque é atualizado e o histórico é gravado.
   - Se houver divergência suspeita: o gerente clica em **Solicitar Recontagem**, adiciona uma instrução (ex: *"Afaste um pouco a câmera para filmar a fileira de trás"*) e a tarefa volta automaticamente para o funcionário.
3. **Gestão de Produtos**: Cadastro com fotos reais das embalagens tiradas pela câmera do celular ou da galeria.
4. **Gestão de Áreas**: Criação de seções da loja (ex: *Biscoitos e Snacks*, *Bebidas*, *Higiene*) e associação dos produtos esperados em cada uma, otimizando o processamento visual e reduzindo falsos positivos.
5. **Gestão de Equipe**: Geração de códigos e exibição de QR Code em tela cheia para conectar novos funcionários na hora.

---

## 🧪 Testes e Qualidade de Código

### Testes unitários (seleção de quadros, validação, provedores)
```bash
cd supabase/functions && deno test tests/
```

### Teste de ponta a ponta (Supabase local + Edge Functions com `VISION_PROVIDER=mock`)
```bash
eval "$(pnpm dlx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
  deno test -A supabase/tests/integration.test.ts
```
*Cobre cadastro, login por código, isolamento entre lojas (RLS e Storage), captura → identificação → contagem → envio → recontagem → aprovação → estoque, e desativação de funcionário.*

### Checagem de tipos do mobile
```bash
cd mobile && pnpm exec tsc --noEmit
```

---

## 📄 Documentação Detalhada
Para consultar os detalhes dos esquemas de banco de dados, máquinas de estado de tarefas, modelo de custos de API e especificações dos contratos JSON, acerte a pasta [`docs/`](docs/).
