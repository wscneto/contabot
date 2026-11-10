/**
 * Provedores do modelo visual. O padrão é "chat": qualquer API compatível com
 * OpenAI Chat Completions (OpenAI, Gemini, OpenRouter, DeepInfra, Groq, …),
 * configurada só por variáveis de ambiente (secrets da Edge Function).
 * "mock" devolve respostas fixas para demonstração, sem reconhecer imagens.
 */

import { COUNTING_INSTRUCTIONS, IDENTIFICATION_INSTRUCTIONS } from './prompts.ts';
import { type CountResult, type Identification, ProviderError, SCHEMAS, type Stage, validateStage } from './vision.ts';

export interface VisionImage {
  /** data:<mime>;base64,<...> */
  dataUrl: string;
}

export interface VisionFrame {
  id: string;
  timestamp_seconds: number;
  image: VisionImage;
}

export interface VisionSku {
  id: string;
  name: string;
  variant: string;
  photos: VisionImage[];
}

export interface VisionVideo {
  id: string;
  primary_frame_id: string;
  identification?: Identification;
}

export interface ProviderResult<T> {
  prediction: T;
  usage: Record<string, unknown>;
  model: string;
  simulated: boolean;
  requestId: string | null;
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  readonly simulated: boolean;
  readonly maxImages: number;
  identify(video: VisionVideo, catalog: VisionSku[], frames: VisionFrame[]): Promise<ProviderResult<Identification>>;
  count(video: VisionVideo, catalog: VisionSku[], frames: VisionFrame[]): Promise<ProviderResult<CountResult>>;
}

interface PreparedRequest {
  metadata: Record<string, unknown>;
  images: { label: string; image: VisionImage }[];
}

/** Metadados e imagens rotuladas, na mesma ordem de providers._prepare. */
export function prepare(
  video: VisionVideo,
  catalog: VisionSku[],
  frames: VisionFrame[],
  maxImages: number,
): PreparedRequest {
  if (!frames.length || !catalog.length) {
    throw new ProviderError('Envie um vídeo e cadastre ao menos um SKU com foto.');
  }
  const frameIds = frames.map((f) => f.id);
  if (new Set(frameIds).size !== frameIds.length || !frameIds.includes(video.primary_frame_id)) {
    throw new ProviderError('A seleção de frames do vídeo é inválida.');
  }
  const skuIds = catalog.map((s) => s.id);
  if (new Set(skuIds).size !== skuIds.length || catalog.some((s) => !s.photos.length)) {
    throw new ProviderError('Cada SKU precisa de identificador único e fotos de referência.');
  }
  const imageCount = frames.length + catalog.reduce((n, s) => n + s.photos.length, 0);
  if (imageCount > maxImages) {
    throw new ProviderError(
      `O vídeo e o catálogo têm ${imageCount} imagens; o limite configurado é ${maxImages}. ` +
        'Reduza as fotos do catálogo ou aumente o limite suportado pelo modelo.',
    );
  }
  const metadata: Record<string, unknown> = {
    video_id: video.id,
    primary_frame_id: video.primary_frame_id,
    catalog: catalog.map((s) => ({ id: s.id, name: s.name, variant: s.variant })),
  };
  if (video.identification) {
    const ids = new Set(skuIds);
    metadata.identification = video.identification.matches
      .filter((m) => ids.has(m.sku_id))
      .map(({ sku_id, status, reason, evidence_frame_ids }) => ({ sku_id, status, reason, evidence_frame_ids }));
  }
  const ordered = [...frames].sort((a, b) =>
    Number(a.id !== video.primary_frame_id) - Number(b.id !== video.primary_frame_id)
  );
  const images = ordered.map((frame) => {
    const role = frame.id === video.primary_frame_id ? 'PRINCIPAL' : 'COMPLEMENTAR';
    return {
      label: `Frame ${role}; evidence_frame_id=${frame.id}; timestamp_seconds=${frame.timestamp_seconds}`,
      image: frame.image,
    };
  });
  for (const sku of catalog) {
    sku.photos.forEach((photo, index) => {
      images.push({ label: `REFERÊNCIA SKU=${sku.id}; foto ${index + 1}; não contar como estoque.`, image: photo });
    });
  }
  return { metadata, images };
}

// ---------------------------------------------------------------------------
// Chat Completions (compatível com OpenAI)
// ---------------------------------------------------------------------------

export type ResponseFormat = 'json_schema' | 'json_object' | 'none';

export interface ChatProviderOptions {
  endpoint: string;
  model: string;
  apiKey: string;
  maxImages?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** "max_tokens" (padrão, mais compatível) ou "max_completion_tokens" (modelos de raciocínio da OpenAI). */
  tokenLimitParam?: string;
  responseFormat?: ResponseFormat;
  imageDetail?: string;
  extraParameters?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

const PROTECTED_PARAMETERS = new Set([
  'model',
  'messages',
  'response_format',
  'max_tokens',
  'max_completion_tokens',
  'stream',
  'n',
]);

export class ChatCompletionsProvider implements VisionProvider {
  readonly name = 'chat';
  readonly simulated = false;
  readonly model: string;
  readonly maxImages: number;
  private readonly options: Required<Omit<ChatProviderOptions, 'fetchImpl'>> & { fetchImpl: typeof fetch };

  constructor(options: ChatProviderOptions) {
    let url: URL;
    try {
      url = new URL(options.endpoint);
    } catch {
      throw new ProviderError('Configure VISION_API_URL com a URL completa do endpoint de Chat Completions.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new ProviderError('Configure VISION_API_URL como HTTP(S), sem credenciais embutidas.');
    }
    if (!options.model?.trim()) throw new ProviderError('Configure VISION_MODEL com o modelo do provedor.');
    const local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(url.hostname);
    if (!local && !options.apiKey?.trim()) {
      throw new ProviderError('Credencial ausente. Configure o secret VISION_API_KEY da Edge Function.');
    }
    const extra = options.extraParameters ?? {};
    if (Object.keys(extra).some((k) => PROTECTED_PARAMETERS.has(k))) {
      throw new ProviderError('Parâmetros extras não podem substituir imagens, modelo, esquema ou controles da requisição.');
    }
    this.model = options.model.trim();
    this.maxImages = options.maxImages ?? 16;
    this.options = {
      endpoint: options.endpoint,
      model: this.model,
      apiKey: options.apiKey ?? '',
      maxImages: this.maxImages,
      timeoutMs: options.timeoutMs ?? 120_000,
      maxOutputTokens: options.maxOutputTokens ?? 4000,
      tokenLimitParam: options.tokenLimitParam ?? 'max_tokens',
      responseFormat: options.responseFormat ?? 'json_schema',
      imageDetail: options.imageDetail ?? 'high',
      extraParameters: extra,
      fetchImpl: options.fetchImpl ?? fetch,
    };
    if (!['max_tokens', 'max_completion_tokens'].includes(this.options.tokenLimitParam)) {
      throw new ProviderError('VISION_TOKEN_LIMIT_PARAM deve ser max_tokens ou max_completion_tokens.');
    }
  }

  identify(video: VisionVideo, catalog: VisionSku[], frames: VisionFrame[]) {
    return this.infer('identify', video, catalog, frames) as Promise<ProviderResult<Identification>>;
  }

  count(video: VisionVideo, catalog: VisionSku[], frames: VisionFrame[]) {
    return this.infer('count', video, catalog, frames) as Promise<ProviderResult<CountResult>>;
  }

  private async infer(
    stage: Stage,
    video: VisionVideo,
    catalog: VisionSku[],
    frames: VisionFrame[],
  ): Promise<ProviderResult<Identification | CountResult>> {
    const { metadata, images } = prepare(video, catalog, frames, this.maxImages);
    const schema = SCHEMAS[stage];
    // O esquema vai sempre no texto: nem todo provedor faz o modelo cumprir response_format.
    const instructions = (stage === 'identify' ? IDENTIFICATION_INSTRUCTIONS : COUNTING_INSTRUCTIONS) +
      `\n\nResponda exclusivamente com um JSON válido correspondente ao esquema:\n${JSON.stringify(schema)}`;
    const userContent: unknown[] = [{ type: 'text', text: JSON.stringify(metadata) }];
    for (const { label, image } of images) {
      userContent.push(
        { type: 'text', text: label },
        { type: 'image_url', image_url: { url: image.dataUrl, detail: this.options.imageDetail } },
      );
    }
    const body: Record<string, unknown> = {
      ...this.options.extraParameters,
      model: this.model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: userContent },
      ],
      [this.options.tokenLimitParam]: this.options.maxOutputTokens,
    };
    if (this.options.responseFormat === 'json_schema') {
      body.response_format = { type: 'json_schema', json_schema: { name: stage, strict: true, schema } };
    } else if (this.options.responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.options.apiKey.trim()) headers.Authorization = `Bearer ${this.options.apiKey.trim()}`;

    let response: Response;
    try {
      response = await this.options.fetchImpl(this.options.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new ProviderError('O provedor visual demorou além do limite. Tente novamente ou envie um vídeo menor.');
      }
      throw new ProviderError('Falha de conexão com o provedor visual; tente novamente.');
    }

    let requestId = response.headers.get('x-request-id');
    if (response.status === 413) {
      throw new ProviderError(
        'A requisição excedeu o tamanho máximo aceito pelo provedor (HTTP 413). Reduza VISION_MAX_IMAGES ou a resolução dos quadros.',
        { requestId },
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ProviderError('O provedor retornou conteúdo que não é JSON.', { requestId });
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new ProviderError('O provedor retornou um envelope inválido.', { requestId });
    }
    const envelope = data as Record<string, unknown>;
    const usage = (typeof envelope.usage === 'object' && envelope.usage !== null)
      ? envelope.usage as Record<string, unknown>
      : {};
    requestId = requestId ?? (typeof envelope.id === 'string' ? envelope.id : null);
    const fail = (message: string): never => {
      throw new ProviderError(message, { usage, requestId });
    };

    if (!response.ok || envelope.error) {
      fail(`A API recusou a requisição (HTTP ${response.status}); confira configuração e limites.`);
    }
    const choices = envelope.choices;
    if (!Array.isArray(choices) || choices.length === 0) fail('A API não retornou escolhas de resposta válidas.');
    const choice = (choices as unknown[])[0] as Record<string, unknown>;
    if (typeof choice !== 'object' || choice === null) fail('A API retornou escolha malformada.');
    if (choice.finish_reason === 'length') fail('A resposta do modelo foi truncada por exceder o limite de tokens.');
    if (choice.finish_reason === 'content_filter' || choice.finish_reason === 'refusal') {
      fail('O modelo recusou a análise por filtro de conteúdo.');
    }
    const message = choice.message as Record<string, unknown> | undefined;
    if (typeof message !== 'object' || message === null) fail('A mensagem do modelo está malformada.');
    if (message!.refusal) fail('O modelo recusou a análise.');
    const content = message!.content;
    if (typeof content !== 'string' || !content.trim()) fail('O modelo retornou texto vazio ou inválido.');

    const payload = parseModelJson(content as string);
    if (payload === undefined) fail('O modelo retornou JSON inválido.');

    const prediction = validateStage(
      stage,
      payload,
      video.id,
      catalog.map((s) => s.id),
      frames.map((f) => f.id),
      { usage, requestId },
    );
    return {
      prediction,
      usage,
      model: typeof envelope.model === 'string' ? envelope.model : this.model,
      simulated: false,
      requestId,
    };
  }
}

/** Aceita JSON puro, com bloco <think> antes, ou cercado por ```json. */
export function parseModelJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const unfenced = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      return JSON.parse(unfenced);
    } catch {
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Simulação
// ---------------------------------------------------------------------------

/** Respostas fixas: nunca reconhecimento de imagem nem evidência de acurácia. */
export class MockProvider implements VisionProvider {
  readonly name = 'mock';
  readonly model = 'simulador-demonstracao';
  readonly simulated = true;
  readonly maxImages = 10_000;

  constructor(private readonly delayMs = 0) {}

  private async wait() {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }

  async identify(video: VisionVideo, catalog: VisionSku[], frames: VisionFrame[]) {
    await this.wait();
    prepare(video, catalog, frames, this.maxImages);
    const prediction: Identification = {
      video_id: video.id,
      matches: catalog.map((sku, index) => ({
        sku_id: sku.id,
        status: index % 3 === 2 ? 'absent' : 'present',
        evidence_frame_ids: index % 3 === 2 ? [] : [video.primary_frame_id],
        reason: index % 3 === 2
          ? 'SIMULAÇÃO: produto não visualizado no trecho filmado.'
          : 'SIMULAÇÃO: produto identificado na prateleira.',
      })),
      unknown_products: [],
    };
    return { prediction, usage: {}, model: this.model, simulated: true, requestId: null };
  }

  async count(video: VisionVideo, catalog: VisionSku[], frames: VisionFrame[]) {
    await this.wait();
    prepare(video, catalog, frames, this.maxImages);
    const prediction: CountResult = {
      video_id: video.id,
      coverage_complete: true,
      overlap_resolved: true,
      unknown_products: [],
      counts: catalog.map((sku, index) => ({
        sku_id: sku.id,
        quantity: index + 3,
        incomplete: false,
        needs_review: index % 2 === 1,
        reason: index % 2 === 1
          ? 'SIMULAÇÃO: confira, parte das caixas pode estar encoberta.'
          : 'SIMULAÇÃO: contagem nítida de todas as unidades.',
        evidence_frame_ids: [video.primary_frame_id],
      })),
    };
    return { prediction, usage: {}, model: this.model, simulated: true, requestId: null };
  }
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export interface VisionSettings {
  provider: VisionProvider;
  maxImages: number;
  maxCountFrames: number;
}

function positiveInt(env: (name: string) => string | undefined, name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ProviderError(`${name} deve ser um inteiro positivo.`);
  return value;
}

/**
 * Variáveis (secrets da Edge Function):
 *   VISION_PROVIDER         chat (padrão) | mock
 *   VISION_API_URL          URL completa de Chat Completions
 *   VISION_MODEL            nome do modelo no provedor
 *   VISION_API_KEY          chave do provedor
 *   VISION_RESPONSE_FORMAT  json_schema (padrão) | json_object | none
 *   VISION_TOKEN_LIMIT_PARAM max_tokens (padrão) | max_completion_tokens
 *   VISION_MAX_OUTPUT_TOKENS (4000)  VISION_TIMEOUT_SECONDS (120)
 *   VISION_MAX_IMAGES (16)  VISION_MAX_COUNT_FRAMES (10)
 *   VISION_IMAGE_DETAIL (high)  VISION_EXTRA_PARAMS (objeto JSON)
 *   VISION_MOCK_DELAY_MS (1500)
 */
export function visionSettingsFromEnv(env: (name: string) => string | undefined): VisionSettings {
  const kind = (env('VISION_PROVIDER') || 'chat').trim().toLowerCase();
  const maxImages = positiveInt(env, 'VISION_MAX_IMAGES', 16);
  const maxCountFrames = positiveInt(env, 'VISION_MAX_COUNT_FRAMES', 10);
  if (maxImages < 2) throw new ProviderError('VISION_MAX_IMAGES deve reservar imagens para vídeo e referências.');

  if (kind === 'mock') {
    const delay = Number(env('VISION_MOCK_DELAY_MS') ?? 1500);
    return { provider: new MockProvider(Number.isFinite(delay) ? delay : 0), maxImages, maxCountFrames };
  }
  if (kind !== 'chat') throw new ProviderError('VISION_PROVIDER deve ser chat ou mock.');

  let extraParameters: Record<string, unknown> = {};
  const extraRaw = env('VISION_EXTRA_PARAMS');
  if (extraRaw) {
    try {
      extraParameters = JSON.parse(extraRaw);
    } catch {
      throw new ProviderError('VISION_EXTRA_PARAMS deve ser um objeto JSON.');
    }
    if (typeof extraParameters !== 'object' || extraParameters === null || Array.isArray(extraParameters)) {
      throw new ProviderError('VISION_EXTRA_PARAMS deve ser um objeto JSON.');
    }
  }
  const responseFormat = (env('VISION_RESPONSE_FORMAT') || 'json_schema') as ResponseFormat;
  if (!['json_schema', 'json_object', 'none'].includes(responseFormat)) {
    throw new ProviderError('VISION_RESPONSE_FORMAT deve ser json_schema, json_object ou none.');
  }
  const provider = new ChatCompletionsProvider({
    endpoint: env('VISION_API_URL') ?? '',
    model: env('VISION_MODEL') ?? '',
    apiKey: env('VISION_API_KEY') ?? '',
    maxImages,
    timeoutMs: positiveInt(env, 'VISION_TIMEOUT_SECONDS', 120) * 1000,
    maxOutputTokens: positiveInt(env, 'VISION_MAX_OUTPUT_TOKENS', 4000),
    tokenLimitParam: env('VISION_TOKEN_LIMIT_PARAM') || 'max_tokens',
    responseFormat,
    imageDetail: env('VISION_IMAGE_DETAIL') || 'high',
    extraParameters,
  });
  return { provider, maxImages, maxCountFrames };
}
