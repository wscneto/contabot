# Plano: adaptador Chat Completions

## Objetivo

Adicionar um provedor `chat` no formato OpenAI Chat Completions (`POST /v1/chat/completions`). Com um único adaptador, o Contabot passa a usar intermediários como DeepInfra, OpenRouter, Hugging Face Inference Providers e Together, além da própria OpenAI e de servidores locais (vLLM, TGI, Ollama), trocando apenas endpoint, modelo e chave no `.env`.

O objetivo é **comparar custo e acerto de modelos alternativos** nos mesmos vídeos, não trocar o padrão do projeto. O provedor padrão continua `codex` até que a comparação mostre outro modelo adequado.

## Fora do escopo

- Pré-seleção por embeddings, segmentação por gôndola, catálogo global por EAN, conferência contra estoque esperado. Ficam para depois da comparação.
- Envio do vídeo inteiro ao modelo. Continua o fluxo atual de frames selecionados.
- Composição de vários frames numa imagem só (mosaico) para modelos com limite baixo de imagens.
- Fallback automático entre provedores ou modelos. Uma falha continua sendo uma falha visível, como hoje.

## Situação atual

- `contabot/providers.py` define `VisionProvider` com `identify()` e `count()`. Implementações: `MockProvider`, `CodexProvider`, `ResponsesProvider`.
- `ResponsesProvider` usa o formato da Responses API (`input`, `instructions`, `text.format`). DeepInfra, OpenRouter e Hugging Face não aceitam esse formato.
- `_prepare()` monta metadados e a lista `(rótulo, caminho)` das imagens; `_validate()` passa o JSON por `domain.py`; `_schema()` gera o esquema Pydantic. Os três são reaproveitáveis.
- O esquema gerado usa `$defs`/`$ref`, `title` e `minimum`. Nem todo backend de modelo aberto aceita essas construções.
- Frames e fotos de referência são gravados em `data/media/` com até 1920 px, JPEG qualidade 94, e enviados nesse tamanho.
- `config.py` só aceita `codex`, `mock` e `responses`, e lê a chave apenas de `OPENAI_API_KEY` (caso especial em `from_env`).
- `retry` em `app.py` apaga `prediction` e `confirmed_counts` do vídeo. Reanalisar com outro modelo sobrescreve o resultado anterior.

## Desenho

### `ChatCompletionsProvider` em `providers.py`

Mesmos campos do `ResponsesProvider` (modelo, endpoint, chave, `max_images`, `timeout`, `max_output_tokens`, `extra_parameters`, `transport`), mais:

- `response_format`: `json_schema` | `json_object` | `none`.
- `image_max_dimension`: lado máximo das imagens no envio. A redução é feita em memória com Pillow; os arquivos em `data/media/` não mudam.

Corpo da requisição:

```json
{
  "model": "<CONTABOT_MODEL>",
  "messages": [
    {"role": "system", "content": "<IDENTIFICATION_INSTRUCTIONS ou COUNTING_INSTRUCTIONS>"},
    {"role": "user", "content": [
      {"type": "text", "text": "<metadados JSON>"},
      {"type": "text", "text": "Frame PRINCIPAL; evidence_frame_id=..."},
      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}},
      "..."
    ]}
  ],
  "max_tokens": 4000,
  "response_format": {"type": "json_schema", "json_schema": {"name": "count", "strict": true, "schema": {...}}}
}
```

- Imagens na ordem PRINCIPAL → COMPLEMENTARES → REFERÊNCIAS, cada rótulo de texto antes da sua imagem, como nos outros provedores.
- `json_schema`: esquema com `$ref` resolvido (inline) e sem `title`. `minimum` sai do esquema enviado; a regra continua garantida por `_validate()`.
- `json_object`: envia `{"type": "json_object"}` e coloca o esquema como texto no fim da mensagem de sistema.
- `none`: sem `response_format`; esquema só como texto.
- `temperature` **não** é enviada por padrão: alguns modelos de raciocínio a rejeitam. Quem quiser usa `CONTABOT_PROVIDER_PARAMETERS={"temperature": 0}`.

Leitura da resposta:

- Exigir `choices[0].message.content` como texto não vazio.
- `finish_reason == "length"` → erro de resposta truncada. `content_filter` ou `message.refusal` → recusa. Outros valores (`stop`, `eos`, `end_turn`, ausente) são aceitos, porque variam entre provedores.
- `json.loads` no texto; se falhar, remover cercas ```` ```json ```` e tentar de novo.
- Passar sempre por `_validate()`. O `response_format` ajuda, mas não substitui a validação do domínio.
- `usage` (`prompt_tokens` / `completion_tokens`) guardado como veio; aparece na exportação.
- `request_id` do cabeçalho `x-request-id` ou do campo `id`. `model` do campo `model` da resposta, que pode informar a versão efetiva.
- HTTP 413 vira mensagem clara sugerindo reduzir `CONTABOT_IMAGE_MAX_DIMENSION` ou `CONTABOT_MAX_IMAGES`.
- Nenhuma mensagem de erro inclui a chave ou o corpo da resposta.

### Parâmetros protegidos

`extra_parameters` não pode sobrescrever `model`, `messages`, `response_format`, `max_tokens`, `max_completion_tokens`, `stream`, `n`. Mesma regra do `ResponsesProvider`.

### Configuração (`config.py`)

| Variável | Uso |
| --- | --- |
| `CONTABOT_PROVIDER=chat` | Ativa o novo adaptador. Um nome só, sem apelidos. |
| `CONTABOT_ENDPOINT` | URL completa, ex.: `https://api.deepinfra.com/v1/openai/chat/completions` ou `https://openrouter.ai/api/v1/chat/completions`. Conferir na documentação do provedor. |
| `CONTABOT_MODEL` | Nome do modelo no provedor. |
| `CONTABOT_API_KEY` | Chave do intermediário. Se ausente, usa `OPENAI_API_KEY`. Obrigatória, exceto para `localhost`/`127.0.0.1`. |
| `CONTABOT_RESPONSE_FORMAT` | `json_schema` (padrão), `json_object` ou `none`. |
| `CONTABOT_IMAGE_MAX_DIMENSION` | Lado máximo das imagens enviadas. Padrão 1920 (sem redução). |
| `CONTABOT_MAX_IMAGES` | Já existe. Tem de respeitar o limite de imagens por requisição do modelo. |

O padrão de `image_max_dimension` é 1920 para que a primeira rodada compare só o modelo, nas mesmas condições do Codex. Resoluções menores (1024, 768) entram como teste separado, porque podem piorar a leitura de rótulos pequenos.

`Settings.__post_init__` passa a aceitar `chat` e validar os novos campos. `from_env` ganha o fallback de chave sem mudar o comportamento de `responses`.

Para OpenRouter, fixar o backend com `CONTABOT_PROVIDER_PARAMETERS={"provider": {"order": ["<backend>"], "allow_fallbacks": false}}`. Sem isso, o mesmo nome de modelo pode cair em backends com quantização diferente. Isso torna resultados comparáveis entre dias, mas não determinísticos.

## Testes (`tests/test_providers.py`)

Com `httpx.MockTransport`, sem chamar nenhum modelo real:

1. Corpo enviado: instruções da etapa na mensagem de sistema, imagens na ordem certa com rótulos, esquema sem `$ref`.
2. Modos `json_object` e `none`: esquema aparece como texto; `none` não envia `response_format`.
3. Resposta válida vira `ProviderResult` com `usage`, `model` e `request_id`.
4. JSON dentro de cerca Markdown é aceito.
5. `finish_reason=length`, `refusal`, `content_filter`, HTTP 4xx/5xx/413, corpo não JSON, `choices` vazio e `content` nulo viram `ProviderError` sem vazar a chave.
6. SKU desconhecido, frame desconhecido e quantidade inválida continuam rejeitados.
7. Limite de imagens é aplicado antes da requisição.
8. `image_max_dimension` reduz a imagem enviada e não altera o arquivo em disco.
9. `extra_parameters` não sobrescreve campos protegidos.
10. `Settings` aceita `chat`, lê `CONTABOT_API_KEY` com fallback e exige chave para endpoint remoto.

## Documentação

- `.env.example`: bloco comentado com exemplos DeepInfra e OpenRouter.
- `README.md`: linha nova na tabela de modos e aviso de privacidade.
- `docs/custos-api.md`: seção para registrar custos **medidos** por modelo, com data da consulta de preço.

## Privacidade

Frames da loja e fotos de produtos passam a ir para outro fornecedor, e às vezes, pelo OpenRouter, para um terceiro por trás dele. Antes do piloto, conferir a política de retenção e de uso para treinamento de cada um e registrar no README qual foi usado.

## Comparação (manual)

A comparação entre modelos é feita manualmente, sem `evaluation.py`.

1. Separar alguns vídeos reais e contar fisicamente os produtos de cada um.
2. Candidatos: `gpt-5.6-luna` como referência e 2–3 modelos de visão atuais pelo adaptador `chat`. Antes de escolher, confirmar em cada provedor: entrada de imagem, limite de imagens por requisição (ao menos 5 frames + referências), suporte a `json_schema` e preço.
3. Para cada modelo: ajustar `CONTABOT_MODEL`/`CONTABOT_ENDPOINT` no `.env`, reiniciar o servidor e analisar os vídeos.
4. **Anotar o resultado antes de trocar de modelo**, porque `retry` apaga a sugestão anterior. Alternativas: exportar (`/api/videos/{id}/export`) antes da reanálise, ou um `CONTABOT_DATA_DIR` por modelo (ex.: `data_qwen/`). A seleção de frames é determinística, então todos os modelos recebem as mesmas imagens.
5. Por vídeo e modelo, anotar numa planilha: quantidade sugerida × contagem física por produto, se a análise falhou (resposta rejeitada pela validação), tokens (na exportação) e tempo.
6. Testar `CONTABOT_IMAGE_MAX_DIMENSION` menor (1024, 768) no melhor modelo. Imagem é a maior parte dos tokens de entrada, então é a alavanca de custo mais direta, desde que o acerto se mantenha.

## Riscos

- **Validação rígida com modelos menores.** As regras de `domain.py` vão rejeitar mais respostas de modelos fracos. Cada rejeição é uma chamada paga sem resultado. Isso deve aparecer na planilha, não ser contornado afrouxando as regras.
- **Limite de imagens.** Modelos que aceitam poucas imagens por requisição são incompatíveis com o fluxo atual até existir o mosaico.
- **Tamanho da requisição.** 16 imagens de 1920 px em base64 podem passar de 10 MB. `CONTABOT_IMAGE_MAX_DIMENSION` resolve.
- **Prompt ajustado para GPT.** Modelos abertos podem segui-lo pior. Na primeira rodada, manter o prompt igual para comparar só o modelo.

## Ordem de execução e verificação

1. `Settings` + `make_provider` + `ChatCompletionsProvider`.
2. Testes: `uv run pytest -q tests/test_providers.py` e depois `uv run pytest -q`.
3. `.env.example` e README.
4. `uv run python -m scripts.smoke_demo` para confirmar que nada quebrou. Ele usa o simulador e **não** exercita o adaptador novo.
5. Teste manual com um intermediário real e o vídeo de demonstração (`scripts/generate_demo.py`), para validar o envelope da requisição. Esse vídeo não mede acerto.
6. Comparação manual com vídeos reais.
