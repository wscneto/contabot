# Contabot

MVP de contagem por vídeo, com Python/OpenCV, FastAPI, SQLite e interface responsiva em português. O fluxo é: **cadastrar produtos com fotos → enviar vídeo → conferir a sugestão**. O sistema procura automaticamente os SKUs cadastrados, seleciona imagens e solicita uma única contagem consolidada dos produtos identificados.

## Executar com sua assinatura ChatGPT

Requisitos: [uv](https://docs.astral.sh/uv/), Python 3.11+, FFmpeg/ffprobe no PATH e [Codex CLI](https://developers.openai.com/codex/cli/) instalado. O adaptador foi testado com `codex-cli 0.154.0`.

```bash
uv sync --locked
cp .env.example .env
codex login
uv run uvicorn contabot.app:create_app --factory --host 127.0.0.1 --port 8000
```

No login, escolha sua conta ChatGPT. Se já estiver conectado, basta verificar com `codex login status`. Abra **http://127.0.0.1:8000**. O `uv` gerencia o ambiente automaticamente; não é necessário ativar um ambiente manualmente.

A configuração padrão usa **Codex com login ChatGPT**, modelo **`gpt-5.5`**, que aceita imagens. O modelo pode ser trocado em `CONTABOT_MODEL` por outro com entrada de imagens disponível na sua conta. O processamento usa o acesso da assinatura pelo CLI e seus limites; não transforma a assinatura em créditos de API. A aplicação não lê tokens e recusa login por chave API nesse modo. Consulte [autenticação oficial](https://learn.chatgpt.com/docs/auth) e [execução não interativa](https://learn.chatgpt.com/docs/non-interactive-mode).

Para acesso pelo celular na mesma rede, substitua o host por `0.0.0.0` e abra `http://IP-DO-COMPUTADOR:8000`. Use somente uma instância, em máquina/rede privada: o protótipo não tem autenticação, e o processamento usa o login do computador. Vídeos, catálogo, sugestões e correções ficam em `data/`; preserve essa pasta para manter as evidências. `.env` e `data/` não entram no Git.

## Testar em outro computador

```bash
git clone https://github.com/wscneto/contabot.git
cd contabot
uv sync --locked
cp .env.example .env
```

Escolha o modo no `.env` antes de iniciar o servidor:

| Modo | Configuração | Acesso necessário |
| --- | --- | --- |
| Simulação | `CONTABOT_PROVIDER=mock` | Nenhuma conta; os números são fictícios. |
| ChatGPT próprio | `CONTABOT_PROVIDER=codex` | Instale o Codex CLI e execute `codex login` com sua própria conta, com acesso ao modelo escolhido. |
| API própria | `CONTABOT_PROVIDER=responses` | Preencha `OPENAI_API_KEY` com sua chave local; cobrança separada da assinatura ChatGPT. |

```bash
uv run uvicorn contabot.app:create_app --factory --port 8000
```

Abra `http://127.0.0.1:8000`. FFmpeg/ffprobe é necessário também no modo simulado. Cada clone começa com catálogo vazio; gere os exemplos conforme a demonstração abaixo ou cadastre suas fotos e envie um vídeo. Login do Codex, chaves, catálogo e vídeos da máquina original não acompanham o repositório.

No PowerShell, use `Copy-Item .env.example .env` no lugar de `cp`; os comandos `uv` são iguais. A aplicação foi validada em Linux. Windows nativo e macOS ainda precisam de validação; no Windows, WSL2 permite experimentar o ambiente Linux. O teste opcional `scripts/browser_smoke.py` usa recursos POSIX e precisa de Linux, WSL ou macOS.

## Usar

1. Em **Meus produtos**, informe o nome e envie de uma a quatro fotos legíveis da embalagem. Inclua a variante no nome quando houver produtos parecidos e use fotos da versão exata.
2. Em **Contar produtos**, escolha o vídeo e clique para contar. Não precisa selecionar SKUs, preencher dados de pessoas ou descrever prateleiras.
3. Aguarde a identificação e a contagem. Confira as sugestões e, se necessário, corrija as quantidades. A sugestão original continua preservada. As imagens ficam disponíveis em **Ver imagens**.

Para corrigir nome ou referência, use **Editar** no produto. Fotos novas substituem as referências atuais; sem novas fotos, as anteriores são mantidas. **Tentar novamente** analisa o mesmo vídeo usando o catálogo atualizado.

Para remover um produto, clique em **Excluir** ao lado dele e confirme. O produto deixa de participar de novas análises; fotos e resultados anteriores são preservados. Se excluir todos os produtos, cadastre outro antes de enviar ou reanalisar um vídeo.

Filme uma área pequena, devagar e com os produtos parados, incluindo uma visão geral e detalhes das caixas. Mostre topo ou laterais para revelar unidades atrás das primeiras. Gavetas precisam estar abertas, em vídeo próprio. Unidades totalmente ocultas não podem ser visualmente contadas.

Cada vídeo recebe uma contagem única; imagens sobrepostas não são somadas. Sem cobertura suficiente ou correspondência entre caixas nos diferentes ângulos, o resultado fica incompleto ou desconhecido. **Não identificado** significa que o SKU não foi reconhecido nos frames, não comprova estoque zero. Não há total entre vídeos, pois eles podem mostrar as mesmas caixas. As quantidades permanecem sugestões até a conferência; salvar uma correção não transforma cobertura incompleta em comprovação visual.

Texto pequeno ou gramatura ilegível não bloqueiam, por si só, uma correspondência visual distintiva com a referência. Uma variante explicitamente diferente continua separada. Quando não for possível consolidar o vídeo inteiro, o modelo pode contar as unidades distinguíveis em **um único frame**, preferindo a vista lateral ou superior que mostra mais caixas. A interface indica **unidades visíveis / contagem parcial** e liga esse número à imagem contada; outras imagens ajudam a reconhecer a embalagem, mas não acrescentam unidades à contagem desse frame.

## Onde acontece a requisição

Em [contabot/providers.py](contabot/providers.py), a interface `VisionProvider` tem duas operações: `identify()` e `count()`. `CodexProvider._infer()` chama `codex exec` com as imagens, referências e esquema JSON. O CLI usa um diretório temporário, ferramentas desativadas e o login ChatGPT já existente. Somente frames selecionados e fotos de referência são enviados; o vídeo completo é processado localmente.

`contabot/app.py` coordena extração → identificação no catálogo inteiro → contagem dos candidatos. Catálogos maiores são identificados em lotes. A contagem mantém todos os candidatos e seus frames na mesma requisição; se ultrapassar o limite de imagens, solicita uma captura menor, sem somar resultados parciais. A análise executa em segundo plano, uma por vez, e a interface consulta o andamento.

A identificação usa até `CONTABOT_MAX_FRAMES` imagens distribuídas pelo vídeo (padrão: 5). Após localizar os produtos, a contagem inclui frames dos segundos anteriores e posteriores, buscando outros ângulos, até `CONTABOT_MAX_COUNT_FRAMES` (padrão: 10). O limite combinado de imagens ainda inclui todas as referências. A seleção mantém as imagens de identificação como contexto e registra os IDs usados em cada etapa. Nitidez ou diversidade visual ajudam a escolher candidatos, mas a decisão de qual frame permite separar as caixas cabe ao modelo. Vídeos antigos têm seus candidatos extraídos novamente na primeira reanálise após esta atualização.

O adaptador opcional `ResponsesProvider` faz `client.post(self.endpoint, ...)` para a Responses API ou servidor local compatível. Para usá-lo, configure `CONTABOT_PROVIDER=responses`, modelo, endpoint e chave em `.env`. **API tem cobrança separada da assinatura ChatGPT**. Não há fallback automático do CLI para API. O exemplo deixa `OPENAI_API_KEY` vazia.

Os limites de duração, tamanho, imagens e amostragem estão em [.env.example](.env.example). São padrões do aplicativo, não limites universais dos provedores. Uso de tokens e duração do processamento ficam no resultado exportado quando informados pelo provedor. O aplicativo não calcula cobrança automaticamente; uma projeção documentada do teste está em [docs/custos-api.md](docs/custos-api.md).

## Demonstração sem modelo e testes

Para experimentar as telas sem consumir a assinatura, use `CONTABOT_PROVIDER=mock` em `.env` e reinicie o servidor. Esse modo exibe **SIMULAÇÃO** e devolve números fixos; não analisa imagens.

```bash
uv run python scripts/generate_demo.py
```

Cadastre dois produtos usando `demo/DEMO-A.jpg` e `demo/DEMO-B.jpg`, envie `demo/prateleira_simulada.mp4`, veja os resultados e corrija para A=3 e B=2. As sugestões do simulador são deliberadamente fictícias.

```bash
uv run pytest -q
uv run python -m scripts.smoke_demo
```

A demonstração automatizada usa banco temporário e gera exportação e avaliação sintética em `demo/smoke/`, preservando o catálogo da loja. Os testes verificam respostas inválidas, SKUs/frames desconhecidos, zero versus desconhecido, identificação automática, pendências, ausência de somas por imagem, preservação da sugestão, orientação e timestamps de vídeo. Nenhum teste automatizado chama o modelo real.

Teste opcional do fluxo no navegador:

```bash
uv sync --locked --extra browser
uv run --extra browser playwright install chromium
uv run --extra browser python -m scripts.browser_smoke
```

Com Chromium já instalado: `uv run --extra browser python -m scripts.browser_smoke --chromium /usr/bin/chromium`. O teste usa servidor e dados temporários, incluindo largura de celular.

Validação desta versão: **144 testes Python passaram**, demonstração HTTP e avaliação sintética passaram, e Chromium percorreu cadastro, vídeo, correção, edição, nova análise e exclusão em desktop/celular. Também foram verificados a inclusão de um ângulo lateral após o reconhecimento frontal, o limite combinado de imagens e o resultado numérico parcial com evidência única. A exclusão preserva o histórico e as fotos, e o cancelamento mantém o produto cadastrado. Contagens parciais mantêm seu rótulo e a sugestão original após correção. Dois avisos de descontinuação de Starlette/AnyIO permanecem nas dependências de teste.

## Avaliação e limitações

O mecanismo de avaliação compara sugestões originais com contagens físicas e separa dados de ajuste e avaliação final. Dados de tempo de captura, correção e processo manual são opcionais na avaliação externa; não fazem parte dos formulários da loja. Veja [docs/avaliacao.md](docs/avaliacao.md).

Não há precisão operacional comprovada. Um vídeo real foi usado para testar a integração, mas não foi fornecida sua contagem física verificada. Resultados desse teste e limitações observadas estão em [docs/teste-video-real.md](docs/teste-video-real.md). Vídeos usados para ajustar o prompt devem ficar fora da avaliação final.

A seleção de frames combina qualidade e distribuição temporal, registra nitidez/exposição/movimento/possível reflexo e elimina imagens quase idênticas. Essas medidas são heurísticas; não demonstram cobertura ou deduplicação de produtos. Vídeos com baixa resolução, embalagens parecidas, reflexos, rótulos pequenos e unidades escondidas continuam difíceis. Não há reconstrução 3D, rastreamento de caixas, deduplicação entre vídeos ou conversão HDR dedicada.

As respostas passam por um esquema estrito, mas JSON válido não prova reconhecimento correto. O modelo pode confundir variantes e errar a contagem. Produtos desconhecidos não devem ser forçados ao catálogo. Falhas deixam o vídeo disponível para nova tentativa, sem repetição automática de chamadas. Reiniciar o servidor interrompe trabalhos em andamento; não há fila durável ou suporte a múltiplos processos.

A versão simplificada mantém os SKUs existentes e não apaga tabelas da versão anterior. As antigas telas de sessões/seções foram retiradas. ERP, sensores e treinamento próprio permanecem fora do MVP.
