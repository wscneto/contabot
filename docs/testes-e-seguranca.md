# Testes, CI/CD e segurança

Este documento descreve como o Contabot é testado, o que roda automaticamente a
cada mudança e o resultado do pentest automatizado (achados e correções).

## Pirâmide de testes

| Camada | Ferramenta | Onde | O que garante | Quantidade |
| --- | --- | --- | --- | --- |
| Unitários do backend | Deno test | `supabase/functions/tests/*.test.ts` | Seleção de quadros, validação estrita da resposta da IA, provedores, regras de contagem | 48 testes |
| Propriedades / fuzzing de funções puras | fast-check | `supabase/functions/tests/property.test.ts` | Para **qualquer** entrada gerada: a resposta do modelo vira resultado válido ou `ProviderError`; respostas válidas passam intactas; mutações que quebram o contrato são rejeitadas; seleção de quadros e códigos de acesso respeitam seus invariantes | 13 propriedades (300–5000 casos cada) |
| Unitários e de componentes do app | Jest + jest-expo + Testing Library | `mobile/__tests__/` | Importação de planilhas (XLSX/CSV, entradas hostis, prototype pollution), componentes do design system, camada de API, tela de login | 205 testes em 15 suítes |
| Banco de dados | pgTAP (`supabase test db`) | `supabase/tests/database/*.test.sql` | Postura de segurança de **todas** as tabelas e funções (RLS, GRANTs, `search_path`, defaults para objetos futuros) e RLS com usuários simulados | 47 asserções |
| Integração ponta a ponta | Deno + supabase-js | `supabase/tests/integration.test.ts` | Cadastro → catálogo → captura → IA (mock) → conferência → recontagem → aprovação → estoque | 3 cenários |
| Segurança (pentest automatizado) | Deno + supabase-js | `supabase/tests/security.test.ts` | OWASP API Security Top 10 (detalhes abaixo) | 12 cenários, 160 verificações |
| Concorrência | Deno | `supabase/tests/concurrency.test.ts` | Cliques duplos, dois aparelhos e reenvios não duplicam contagens, estoque ou análises nem furam limites | 6 cenários |
| Fuzzing da API | fast-check | `supabase/tests/fuzz.test.ts` | JSON aleatório nas RPCs e Edge Functions nunca gera 5xx, nunca vaza detalhe interno e nunca grava estado inválido | 6 propriedades × 300 entradas no CI |

Cobertura de linhas: **91,6%** do código compartilhado das Edge Functions
(`supabase/functions/_shared`) e **100%** de `mobile/src/utils` e `mobile/src/components`.
O CI publica os relatórios a cada execução.

## Integração contínua

Três workflows em `.github/workflows/`:

**`ci.yml`** roda em todo pull request e em cada push na `main`/`staging`, com três jobs em paralelo:

1. **Deno**: `deno lint`, checagem de tipos e testes unitários e de propriedades com cobertura.
2. **Mobile**: ESLint, `tsc --noEmit`, Jest com cobertura e `pnpm audit --audit-level high`, que falha se houver dependência com vulnerabilidade alta ou crítica.
3. **Supabase**: sobe o stack local **do zero** e aplica todas as migrations, o que prova que elas funcionam num banco vazio. Depois roda o linter de PL/pgSQL (`supabase db lint`), os testes pgTAP, as Edge Functions com o provedor `mock` (sem custo de IA) e as suítes de integração, segurança, concorrência e fuzzing.

**`security.yml`** roda em PRs, a cada push na `main` e toda segunda-feira:

- **CodeQL**: análise estática de segurança (SAST) do JavaScript/TypeScript. Os alertas aparecem na aba *Security* do GitHub.
- **gitleaks**: varre **todo o histórico do git** atrás de chaves e senhas. A única exceção (`.gitleaks.toml`) é a senha fictícia dos testes.

**`android-apk.yml`** (já existia) gera o APK a cada merge na `main`.

O **Dependabot** (`.github/dependabot.yml`) abre PRs semanais de atualização das
GitHub Actions e das dependências do app. Os pacotes do Expo/React Native ficam
de fora porque só mudam junto com o SDK.

> Para que nada entre na `main` sem passar pelos testes, ative em *Settings → Branches → Branch protection rules* a regra **Require status checks to pass** com os jobs do `CI`.

## Como rodar localmente

```bash
# Backend: unitários + propriedades
cd supabase/functions && deno test tests/

# App
cd mobile && pnpm lint && pnpm exec tsc --noEmit && pnpm test

# Banco (pgTAP): precisa do Supabase local rodando
pnpm dlx supabase test db

# Integração, segurança, concorrência e fuzzing: Supabase local + Edge Functions com VISION_PROVIDER=mock
pnpm dlx supabase functions serve --env-file supabase/functions/.env.example &
eval "$(pnpm dlx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
  deno test -A supabase/tests/
```

Os testes criam lojas descartáveis com e-mails aleatórios e não dependem do seed
de demonstração. `FUZZ_RUNS=1000` aumenta o número de entradas do fuzzing.

## Pentest automatizado (OWASP API Security Top 10, 2023)

`supabase/tests/security.test.ts` age como um atacante que tem só o que qualquer
cliente tem: a URL pública, a chave anon e, quando autenticado, a própria sessão.

| Categoria | O que é testado |
| --- | --- |
| **API1 · BOLA / IDOR** | Gerente e funcionário de outra loja tentam ler, alterar e apagar **cada** tipo de objeto da loja vítima pelo id (22 chamadas), pela Edge Function e por leitura direta das tabelas. No Storage: download, URL assinada, listagem, upload na pasta alheia (inclusive com `../`), URL pública do bucket privado, sobrescrita e remoção. Entre funcionários da mesma loja, só o responsável age sobre a contagem atribuída. |
| **API2 · Autenticação** | Anônimo contra todas as 36 RPCs e todas as tabelas. JWT com `alg: none`, payload adulterado (outro `sub`, `role: service_role`, `exp` estendido) e confusão de algoritmo (HS256 assinado com a chave pública do JWKS). Login por código com 13 corpos hostis, hash SHA-256 no banco, alfabeto sem ambiguidade, revogação de sessão ao gerar novo código e funcionário desativado com token ainda válido. |
| **API3 · Mass assignment / exposição** | Metadados de cadastro tentando escolher papel ou loja; `updateUser` tentando virar gerente; `insert`/`update`/`delete`/`upsert` direto em todas as tabelas; e-mails da equipe e hash de códigos fora das respostas. |
| **API4 · Consumo de recursos** | Limites de tamanho de todos os textos, de quantidades, da importação (1.000 itens), de quadros por captura (40), do Storage (10 MB, só imagens) e do nome de funcionário. |
| **API5 · BFLA** | Funcionário contra as 16 RPCs de gerente e a criação de funcionário; usuário autenticado contra as 4 funções exclusivas do pipeline de IA; cabeçalho interno forjado na Edge Function de análise. |
| **API6 · Fluxos de negócio** | Máquina de estados da contagem sem atalhos (enviar sem conferir, aprovar duas vezes, recontar aprovada...), contagens inválidas e validação de caminho, formato e dono dos quadros. |
| **API8 · Injeção e configuração** | 10 payloads (SQL injection, `pg_sleep`, XSS, template injection, path traversal, Unicode) gravados literalmente sem efeito colateral; filtros do PostgREST não furam a RLS; bucket privado; CORS; métodos HTTP; corpos malformados nunca geram 500; erros sem nomes internos do banco. |

### Achados e correções

Todos os itens abaixo foram encontrados pelos testes desta entrega. Cada um tem
um teste que falhava antes da correção e passa depois. As correções do banco
estão em `supabase/migrations/20261123000000_hardening.sql`.

| # | Severidade | Achado | Como foi encontrado | Correção |
| --- | --- | --- | --- | --- |
| 1 | Média | **Autorização entre funcionários (BOLA):** um funcionário podia mudar para manual, enviar a contagem ou cancelar a captura atribuída a **outro** funcionário da loja. | Pentest (API1) | Só o responsável, ou qualquer um se a contagem não tem responsável, inicia captura, muda para manual ou envia. Só quem iniciou a captura, ou o gerente, pode cancelá-la. |
| 2 | Média | **Condição de corrida no limite diário de análises:** com limite 3, 7 de 8 capturas simultâneas foram aceitas. O limite protege o custo da chave de IA. | Teste de concorrência | `start_capture` trava a linha da loja antes de contar o uso. |
| 3 | Média | **Vazamento de detalhes internos:** entradas inválidas devolviam o erro cru do Postgres com nomes de tabelas, constraints e tipos (ex.: `violates check constraint "areas_name_check"`). | Pentest (API8) e fuzzing | Validação explícita com mensagens em português em todas as RPCs de cadastro. |
| 4 | Média | **Consumo irrestrito:** textos sem limite eram aceitos (variação ou observação com 100 mil caracteres). A importação de 20 mil produtos estourava o `statement_timeout`. | Pentest (API4) | Limites por campo (nome 150/100, variação 100, código de barras 64, descrição 500, observação 1.000), quantidades até 1.000.000 e importação até 1.000 itens. |
| 5 | Média | **Dependência vulnerável:** `xlsx@0.18.5` tinha 2 vulnerabilidades altas (prototype pollution e ReDoS) e é usado para ler planilhas enviadas pelo usuário. | `pnpm audit` | Atualizado para 0.20.3 (distribuído pelo CDN oficial do SheetJS). Testes confirmam que planilhas hostis não poluem `Object.prototype`. |
| 6 | Baixa | **RPC exposta ao anônimo:** `import_products` era executável pelo papel `anon`. O `alter default privileges ... in schema public` não remove o EXECUTE padrão de PUBLIC. Não havia impacto direto, porque a função exige gerente. | Pentest (API2) e pgTAP | Revogação global para funções futuras e varredura nas existentes. O pgTAP garante que nenhuma função nova nasça exposta. |
| 7 | Baixa | **Confusão de tipos nas Edge Functions:** `{"code": ["<código válido>"]}` fazia login, porque o array era convertido em texto. `{"name": {...}}` criava o funcionário `[object Object]`. | Pentest (API2/API8) | As Edge Functions só aceitam campos do tipo texto (`stringField`). |
| 8 | Baixa | **NULL contornava a validação de quadros:** por causa da lógica de três valores do SQL, `register_capture_frames` aceitava captura sem quadro principal. | Fuzzing da API | Comparações à prova de NULL, com teste de regressão determinístico. |
| 9 | Baixa | **E-mail do gerente legível por funcionários** pela tabela `profiles`. | Pentest (API3) | Coluna `email` sem SELECT para a API. As RPCs `whoami` e `list_team` continuam devolvendo o e-mail. |
| 10 | Baixa | **Privilégios sobrando:** `anon` tinha SELECT nas tabelas (a RLS devolvia vazio) e `authenticated` tinha REFERENCES/TRIGGER. | pgTAP | Revogados. O anônimo é recusado já na camada de GRANT. |
| 11 | Info | O validador da resposta da IA lançava `TypeError`, e não `ProviderError`, para um payload `undefined`. O caminho de produção já tratava esse caso antes. | Teste de propriedades | O log da rejeição nunca lança. |

### Correções no app mobile

Encontradas pelos testes do app (Jest), cada uma com teste de regressão:

| # | Achado | Correção |
| --- | --- | --- |
| 12 | **Sessão sem criptografia:** access e refresh token ficavam no localStorage do expo-sqlite, em texto puro. | A sessão vai para o SecureStore (Keychain/Keystore), em pedaços de até ~1,8 KB validados na leitura (`src/lib/secure-session-storage.ts`). A sessão antiga é migrada e apagada, então ninguém é deslogado. |
| 13 | **CSV em UTF-8 sem BOM corrompia acentos** ("Feijão" virava "FeijÃ£o") e o cabeçalho "Estoque Mínimo" deixava de ser reconhecido. | O arquivo é decodificado no app: UTF-8 com ou sem BOM, UTF-16 ("Texto Unicode" do Excel) ou Windows-1252, que é o padrão do Excel em português. |
| 14 | **Códigos de barras perdiam zeros à esquerda** (`0012345678905` virava `12345678905`) e códigos longos perdiam precisão. | O CSV é lido sem converter tipos. No XLSX, vale o texto exibido quando ele é só de dígitos. |
| 15 | **Estoque mínimo mal interpretado:** `-5` virava 5, `2,5` virava 25 e 400 dígitos viravam `Infinity`. | Aceita só inteiros de 0 a 1.000.000, com a convenção brasileira ("1.000" é mil). Valores inválidos ficam vazios em vez de virar outro número. |

### Riscos conhecidos e recomendações para produção

- **Login por código sem limite de tentativas.** O espaço é de 32⁸ ≈ 1,1 × 10¹² códigos, o que torna a força bruta inviável na prática. Ainda assim, convém limitar tentativas por IP (por exemplo, no proxy ou com Cloudflare Turnstile).
- **Cadastro aberto.** Cada loja tem limite diário de análises, mas qualquer pessoa pode criar várias lojas. Em produção, ligue a confirmação de e-mail e o CAPTCHA do Supabase Auth.
- **Conteúdo dos uploads.** O bucket aceita só tipos de imagem declarados, mas não inspeciona os bytes. O risco é baixo: o bucket é privado e os arquivos são servidos com `Content-Type` de imagem.
- **Esquema OpenAPI do PostgREST.** É público por padrão no Supabase e revela nomes e parâmetros das RPCs, mas nenhum dado.
- **Botões "Preencher Demo"** na tela de login. Úteis na apresentação, mas devem ficar escondidos em builds de produção.
