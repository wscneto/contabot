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

## Comparativo com alternativas mais baratas

Tarifas padrão consultadas em 14/09/2026, em dólares por milhão de tokens. Os links de cada modelo são as fontes oficiais dos preços e recursos.

| Modelo | Entrada | Entrada em cache | Saída |
| --- | ---: | ---: | ---: |
| [gpt-5.5](https://developers.openai.com/api/docs/models/gpt-5.5) — atual | US$ 5,00 | US$ 0,50 | US$ 30,00 |
| [gpt-5.4-mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) | US$ 0,75 | US$ 0,075 | US$ 4,50 |
| [gpt-5.6-luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | US$ 0,20 | US$ 0,02 | US$ 1,20 |

Para comparar somente as tarifas, a tabela abaixo mantém o mesmo consumo hipotético de **26.013 tokens de entrada e 1.156 de saída por vídeo**, somando identificação e contagem. Não acrescenta os 604 tokens de raciocínio mencionados acima; por isso apresenta valores pontuais, enquanto a projeção anterior considera essa incerteza do registro do CLI. Os valores são arredondados depois de calcular cada volume de vídeos.

| Modelo | Por vídeo | Por 1.000 vídeos | Redução frente ao gpt-5.5 |
| --- | ---: | ---: | ---: |
| gpt-5.5 | US$ 0,1647 | US$ 164,75 | — |
| gpt-5.4-mini | US$ 0,0247 | US$ 24,71 | 85% |
| gpt-5.6-luna | US$ 0,0066 | US$ 6,59 | 96% |

São projeções calculadas, **não custos medidos nesses modelos pela API**. O cenário usa entrada sem cache, sem gravações de cache, sem descontos Batch/Flex e sem adicionais regionais ou de contexto longo. A tokenização das imagens, o raciocínio, o tamanho da resposta e as novas tentativas podem mudar entre modelos; portanto, as reduções não garantem a mesma economia por vídeo na prática.

Os três modelos aceitam imagens e respostas estruturadas pela Responses API, conforme suas documentações. O sistema envia os frames extraídos pelo OpenCV e as referências dos SKUs; esses modelos não recebem o arquivo de vídeo diretamente. Esse suporte permite testar o fluxo, mas não comprova precisão na identificação das variantes ou na contagem das unidades.

A sugestão para o piloto é começar pelo `gpt-5.4-mini` e comparar também o `gpt-5.6-luna` com contagens físicas verificadas. Registre o consumo real das duas etapas, as contagens corretas, os erros sem pedido de revisão e o tempo de correção humana. Uma tarifa menor só será vantajosa se a qualidade e o tempo total forem adequados ao trabalho da loja.

Para experimentar o mini, ajuste o arquivo local `.env` e reinicie o servidor:

```dotenv
CONTABOT_PROVIDER=responses
CONTABOT_MODEL=gpt-5.4-mini
OPENAI_API_KEY=sua-chave-da-api
```

Para comparar com o Luna, use `CONTABOT_MODEL=gpt-5.6-luna`. Essa configuração utiliza a cobrança separada da API, com uma chave própria; a assinatura do ChatGPT não cobre essas chamadas. As duas etapas usam o modelo configurado, sem alternância automática entre modelos. A atualização deste documento não altera a configuração do aplicativo.
