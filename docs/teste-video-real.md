# Teste exploratório com vídeo real

Em 14/09/2026 foi testado o vídeo fornecido `lingua-de-gato.mp4`, usando o SKU já existente no banco local. O cadastro e o arquivo original foram preservados. Este vídeo foi usado para **ajuste**, portanto não deve integrar a avaliação final independente.

- Vídeo: aproximadamente 68,93 segundos, 832 × 464 pixels.
- Extração: candidatos a 1 frame/segundo; cinco imagens selecionadas em 0, 18, 30,01, 54,015 e 63,008 segundos.
- Modelo: `gpt-5.5`, pelo Codex CLI 0.154.0 autenticado com assinatura ChatGPT. Não foi usada a Responses API nem uma chave API.
- SKU cadastrado: `LINGUA-GATO-85g`, nome “Língua de Gato”, variante “85 g”.
- Referência cadastrada: embalagem “Língua de Gato Recheado”, cuja foto mostra **90 g**.

## O que aconteceu

A primeira execução marcou o SKU como presente, ignorando a divergência entre o cadastro e a referência. Na etapa de contagem, retornou quantidade `null`, cobertura incompleta e sobreposição não resolvida. O resultado ficou pendente. Isso revelou um erro de identificação mesmo com saída JSON válida.

O prompt foi ajustado para comparar primeiro a descrição do cadastro com a foto de referência, sem inferir gramatura pelo código do SKU. A regra é geral: divergências entre esses dados exigem identificação incerta e impedem uma quantidade conhecida. Nenhum nome de produto desse teste foi codificado no prompt.

Na segunda execução, o modelo reconheceu explicitamente o conflito **85 g versus Recheado 90 g** e retornou `uncertain`. A contagem continuou `null`, com necessidade de revisão. A captura percorre diferentes lados do expositor, sem uma visão geral que permita estabelecer a cobertura e distinguir todas as caixas repetidas entre ângulos.

A inspeção humana dos frames também mostrou caixas com apresentação **Duo**, diferente da referência Recheado. O modelo não estabeleceu essa variante com segurança. Não há uma quantidade válida confirmada para esse vídeo.

## Execuções e consumo informado pelo CLI

| Execução | Processamento | Tokens de entrada | Tokens de saída | Resultado |
| --- | ---: | ---: | ---: | --- |
| Inicial: identificação + contagem | 45,62 s | 22.429 | 1.164 | Quantidade desconhecida; identificação incorreta entre variantes |
| Após ajuste: identificação + contagem | 29,53 s | 22.937 | 1.075 | Identificação incerta; quantidade desconhecida |

Os valores são o uso reportado pelo CLI, somado entre identificação e contagem; não são preços nem conversão dos limites da assinatura. O primeiro tempo inclui extração dos frames; a nova tentativa reutilizou as imagens. Não foram medidos upload, captura, correção humana ou tempo do processo manual. A duração do vídeo não equivale ao tempo de captura operacional.

O resultado final foi preservado em `data/`, vídeo `19d6771b48a94ba5ba7c3aaef4815b1b`. A exportação local está em `demo/real-video-result.json`; a execução inicial em `demo/real-video-first-attempt.json`. Esses arquivos contêm dados locais e são ignorados pelo Git. O registro mantém as quatro tentativas de inferência e seu consumo. Abra o vídeo em “Seus vídeos” para conferir o resultado e as imagens.

## Próximo teste útil

Corrija o cadastro com nome e fotos da **mesma variante exata** do produto. Filme uma área menor, com uma visão geral e todas as unidades observáveis; mantenha o produto parado. Faça também a contagem física independente. O MVP permite editar o cadastro e repetir a análise sem reenviar o vídeo, mas corrigir referências não resolve a falta de cobertura da captura.

Este ensaio comprova que upload, seleção de frames e chamadas pela assinatura funcionaram neste ambiente. Não comprova precisão operacional, economia de tempo ou capacidade de contar estoque oculto. A correção de um erro neste vídeo também não prova generalização para outros vídeos.

## Ajuste posterior: Minions e ângulos vizinhos

No mesmo vídeo, o SKU cadastrado “Tablete ao Leite Frutas Vermelhas Minions 90G” foi identificado na imagem frontal aos 63,008 s, mas a versão anterior não entregou uma quantidade. O cadastro e a referência concordavam; o bloqueio vinha do texto pequeno e da falta de visão geral, agravado pela ausência dos frames laterais na seleção.

A implementação passou a manter os candidatos extraídos e buscar imagens próximas às evidências de identificação, antes e depois delas. A contagem usa até dez frames, preservando os cinco de contexto. A nova seleção incluiu **f0066 aos 65,01 s**, que mostra as laterais das caixas vermelhas. Os frames em 67–68,91 s mostram também uma variante roxa, mantida separada pelo modelo.

O prompt agora aceita correspondência visual distintiva sem exigir leitura de todo o texto. Ausência de leitura não equivale a uma contradição de variante. Se a cobertura ou correspondência entre ângulos não puder ser consolidada, permite uma quantidade positiva de unidades observáveis em **um único frame**, com `incomplete=true`, revisão e exatamente uma evidência. Contagens de frames diferentes continuam sem ser somadas.

No teste real, `gpt-5.5` pelo login ChatGPT retornou **6 unidades visíveis em f0066**, com identificação `present`, `coverage_complete=false` e `overlap_resolved=false`. A interface apresenta “6 unidades visíveis”, “Contagem parcial” e acesso ao frame contado. A sugestão levou 45,09 s de processamento, com 26.013 tokens de entrada e 1.156 de saída informados pelo CLI, somados entre identificação e contagem.

O teste foi salvo separadamente como `minions-frames-vizinhos.mp4`, ID `2c03962943d7476a9f1bd80a185fd9e3`; exportação local em `demo/minions-neighbor-result.json`. A contagem anterior do usuário e sua correção foram preservadas. A quantidade corrigida anteriormente não foi enviada ao modelo.

Este é um teste de ajuste com o mesmo vídeo; não é avaliação independente, prova de precisão geral ou confirmação de estoque total. Caixas ocultas continuam fora da sugestão.
