# Avaliação opcional do piloto

A tela cotidiana só pede produtos, fotos e vídeo. A avaliação é um comando separado para comparar **sugestões originais** com contagens físicas, sem exigir formulários adicionais de quem usa o MVP.

Um vídeo real foi usado para ajustar o sistema; ainda faltam contagens físicas independentes e vídeos reservados para avaliação final. Testes com o simulador ou vídeos desenhados verificam o software; não comprovam precisão nem economia de tempo na loja.

## Preparar dados reais

1. Filme uma área curta por vídeo, com os produtos parados e todas as unidades visíveis. Não some resultados de vídeos que possam mostrar as mesmas caixas.
2. Separe cenas inteiras em ajuste (`tuning`) e avaliação final (`evaluation`). Recortes, frames vizinhos, novas codificações e outras filmagens da mesma cena pertencem ao mesmo `dataset_group`. Ajuste parâmetros apenas no primeiro conjunto.
3. Conte fisicamente todos os SKUs cadastrados no momento de cada vídeo, inclusive os que o modelo não reconheceu. Faça a conferência sem tomar a sugestão como referência. A correção salva na interface não se torna automaticamente verdade física.
4. Anote, fora da interface, os tempos de captura, correção e contagem manual equivalente. O processamento é medido automaticamente. Inclua novas tentativas na medição; a duração do vídeo não substitui o tempo gasto na captura.
5. Baixe cada exportação pelo endereço `/api/videos/ID_DO_VIDEO/export`. Inclua ambos os conjuntos ao avaliar, para detectar grupos e hashes repetidos entre ajuste e avaliação. Preserve também `data/media/`, onde ficam as evidências.

Copie `video.id` e os IDs de `video.catalog` das exportações para um JSON:

```json
{
  "videos": [
    {
      "video_id": "ID_DO_VIDEO",
      "dataset_group": "loja-cena-01",
      "split": "evaluation",
      "data_origin": "real",
      "verified_physical": true,
      "counts": {"SKU-A": 3, "SKU-B": 2},
      "capture_seconds": 20,
      "correction_seconds": 15,
      "manual_seconds": 90,
      "confusions": [
        {"actual_sku_id": "SKU-B", "predicted_sku_id": "SKU-A", "quantity": 1}
      ]
    }
  ]
}
```

Inclua exatamente uma referência por vídeo e todos os SKUs do catálogo preservado. Quantidades físicas são inteiros não negativos; zero exige ausência verificada fisicamente. Tempos são opcionais: se faltarem, não será calculada economia de tempo. Não há campos obrigatórios de nome da pessoa nem detalhes escritos.

`confusions` é uma anotação humana opcional de trocas de identidade. Use `[]` quando conferiu e não encontrou trocas, omita quando não conferiu, e use `UNKNOWN` para produto fora do catálogo. Diferenças de totais não permitem inferir automaticamente qual SKU foi confundido.

Dados desenhados usam `data_origin: "synthetic"` e `verified_physical: false`. Inferência simulada e imagens sintéticas, mesmo enviadas a um provedor real, ficam separadas das métricas reais.

## Executar

```bash
uv run python -m contabot.evaluation \
  --exports exports/*.json \
  --truth contagens-fisicas.json \
  --output relatorio.json
```

O comando valida respostas, SKUs, evidências e separação por grupo/hash, sem chamar o modelo. O relatório preserva hashes dos JSONs avaliados. Use `--split tuning` para avaliar apenas o conjunto de ajuste.

Para verificar o mecanismo com dados explicitamente simulados:

```bash
uv run python -m scripts.smoke_demo
uv run python -m contabot.evaluation \
  --exports demo/smoke/export.json \
  --truth demo/smoke/truth.json \
  --output demo/smoke/avaliacao-cli.json
```

## Ler o relatório

| Campo | Significado |
| --- | --- |
| `real` / `simulated` | Métricas separadas por origem; sem dados reais, métricas reais ficam `null`. |
| `sku_video_pairs` / `exact_accuracy` | Pares SKU–vídeo e proporção de sugestões exatamente iguais à contagem física. Cada vídeo produz uma contagem; os frames não multiplicam amostras. |
| `mean_absolute_error_numeric_only` | Erro absoluto médio apenas nas sugestões numéricas; leia junto de `unknown_count`. |
| `unknown_count` / `incomplete_count` | Quantidades desconhecidas ou incompletas, incluindo falhas e SKUs não encontrados. Identificação “ausente” sozinha não vira zero. |
| Contagem positiva de um único frame | Pode existir mesmo com `overlap_resolved=false`. É parcial, com uma evidência; entra no erro absoluto e na incompletude, sem comprovar total ou economia de tempo. |
| `identification_missed_present_count` | SKUs marcados ausentes apesar de fisicamente presentes. |
| `missed_error_count` | Sugestões numéricas erradas sem alerta especial de revisão. Todos os resultados continuam sendo sugestões para conferência. |
| `confusion_matrix` | Trocas anotadas por pessoas, por SKU real → sugerido, separadas em reais/simuladas. |
| `timing` | Captura, processamento, correção e tempo manual. Pendências ou tempos ausentes não produzem economia calculada. |
| `api_usage` / `api_cost` | Consumo informado por tentativa, inclusive falhas; custo fica `null`. Limites de assinatura e cobrança de API são tratados pelo provedor. |

Fixe critérios de erro e tempo antes do piloto. Registre falhas e pendências, não apenas vídeos bem analisados. Cobertura e sobreposição ainda dependem da captura e da avaliação visual: uma resposta consistente não comprova que todas as caixas foram vistas.
