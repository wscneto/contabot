# Estimativa de custo da API

Preços consultados em 14/09/2026. O modelo atual do MVP é `gpt-5.5`. A API padrão cobra **US$ 5 por milhão de tokens de entrada** e **US$ 30 por milhão de tokens de saída**; entrada em cache custa US$ 0,50/milhão. Esta estimativa não aplica descontos de cache, Batch ou Flex. [Tabela oficial do modelo](https://developers.openai.com/api/docs/models/gpt-5.5).

O teste dos Minions fez duas chamadas, identificação e contagem, com cinco e dez frames respectivamente, além da referência do produto. O Codex CLI registrou 26.013 tokens de entrada e 1.156 de saída entre as duas chamadas. **Foi utilizado login ChatGPT; não houve uma chamada paga à Responses API.**

Aplicando as tarifas da API a esses números como aproximação:

```text
(26.013 × US$ 5 + 1.156 × US$ 30) / 1.000.000 = US$ 0,164745
```

O registro do CLI também informa 604 `reasoning_output_tokens` separadamente, sem total consolidado que permita estabelecer aqui se já estão incluídos em `output_tokens`. Se forem adicionais, a projeção passa para US$ 0,182865. Na Responses API, os tokens de raciocínio já integram `output_tokens`: o campo de detalhamento não deve ser somado novamente. [Documentação de raciocínio](https://developers.openai.com/api/docs/guides/reasoning).

Para planejar o piloto, a ordem de grandeza é:

| Análises de vídeos semelhantes | Projeção aproximada |
| --- | ---: |
| 1 | US$ 0,16–0,19 |
| 100 | US$ 16–19 |
| 1.000 | US$ 160–190 |

Essa faixa é uma projeção do exemplo, não um limite garantido, média operacional ou fatura. O prompt interno do Codex, a tokenização das imagens e o esforço de raciocínio podem diferir na API. O custo real precisa ser medido com o adaptador `responses` e sua própria chave, usando o consumo devolvido em cada tentativa.

Mais SKUs, referências, lotes de identificação e novas tentativas podem elevar o consumo. Vídeos sem correspondências pulam a etapa de contagem. O processamento OpenCV ocorre no computador; os frames e referências enviados ao modelo consomem tokens de entrada. [Cobrança de imagens](https://developers.openai.com/api/docs/guides/images-vision). A projeção não inclui hospedagem, armazenamento, impostos ou conversão cambial.

O programa continua configurado para usar o Codex pela assinatura. Publicar o código não ativa cobrança na API. Para medir a API, configure `CONTABOT_PROVIDER=responses` e uma chave própria em `.env`; preserve a exportação de uso para comparar consumo, tempo e qualidade das contagens.
