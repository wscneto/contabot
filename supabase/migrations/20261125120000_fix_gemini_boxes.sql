-- Corrige as marcações gravadas antes de o servidor converter o formato de caixa do Gemini.
--
-- O Gemini escreve as caixas como [y_min, x_min, y_max, x_max] mesmo quando o prompt pede
-- x primeiro. Até a correção, elas eram lidas como [x_min, y_min, x_max, y_max] e o desenho
-- na conferência saía transposto (fileira horizontal virava coluna). A quantidade não muda:
-- o número de caixas e a remoção de duplicadas não dependem da ordem dos eixos.
--
-- O código corrigido grava "coords": "xyxy" em ai_marks. Só linhas sem essa chave, vindas
-- de captura analisada por um modelo Gemini, são transpostas, então rodar de novo não
-- desfaz nada. O caminho do quadro é <loja>/captures/<capture_id>/<quadro>.jpg.

update public.task_items i
set ai_marks = jsonb_set(
    i.ai_marks,
    '{boxes}',
    coalesce((
      select jsonb_agg(jsonb_build_array(t.b -> 1, t.b -> 0, t.b -> 3, t.b -> 2) order by t.n)
      from jsonb_array_elements(i.ai_marks -> 'boxes') with ordinality as t(b, n)
    ), '[]'::jsonb)
  ) || '{"coords": "xyxy"}'::jsonb
from public.captures c
where i.ai_marks is not null
  and not (i.ai_marks ? 'coords')
  and jsonb_typeof(i.ai_marks -> 'boxes') = 'array'
  and split_part(i.ai_marks ->> 'frame', '/', 3) = c.id::text
  and c.model ilike '%gemini%';
