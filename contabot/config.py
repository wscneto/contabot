import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path

from urllib.parse import urlparse

from dotenv import load_dotenv


@dataclass
class Settings:
    data_dir: Path = Path("data")
    provider: str = "codex"
    model: str = "gpt-5.6-luna"
    codex_command: str = "codex"
    endpoint: str = "https://api.openai.com/v1/responses"
    api_key: str = field(default="", repr=False)
    max_images: int = 16
    max_frames: int = 5
    max_count_frames: int = 10
    sample_hz: float = 1.0
    max_candidates: int = 120
    max_duration_seconds: float = 180
    max_upload_mb: int = 200
    api_timeout: float = 180
    max_output_tokens: int = 4000
    response_format: str = "json_schema"
    image_max_dimension: int = 1920
    provider_parameters: dict = field(default_factory=dict)

    def __post_init__(self):
        self.data_dir = Path(self.data_dir).resolve()
        if self.provider not in {"codex", "mock", "responses", "chat"}:
            raise ValueError("CONTABOT_PROVIDER deve ser codex, mock, responses ou chat.")
        if self.response_format not in {"json_schema", "json_object", "none"}:
            raise ValueError("CONTABOT_RESPONSE_FORMAT deve ser json_schema, json_object ou none.")
        for name in ("max_images", "max_frames", "max_count_frames", "sample_hz", "max_candidates",
                     "max_duration_seconds", "max_upload_mb", "api_timeout", "max_output_tokens",
                     "image_max_dimension"):
            if not math.isfinite(getattr(self, name)) or getattr(self, name) <= 0:
                raise ValueError(f"Configuração {name} deve ser positiva e finita.")
        if self.max_images < 2 or self.max_frames > self.max_candidates:
            raise ValueError("Reserve imagens para vídeo e referências; frames não podem exceder candidatos.")
        if self.max_count_frames < self.max_frames:
            raise ValueError("O limite de frames da contagem deve comportar os frames de identificação.")
        if not isinstance(self.provider_parameters, dict):
            raise ValueError("CONTABOT_PROVIDER_PARAMETERS deve ser um objeto JSON.")

    @classmethod
    def from_env(cls):
        load_dotenv()
        defaults = cls()
        values = {}
        endpoint_val = os.getenv("CONTABOT_ENDPOINT", str(defaults.endpoint))
        endpoint_host = urlparse(endpoint_val).hostname or ""
        for name in cls.__dataclass_fields__:
            if name == "api_key":
                # Cada chave só vai para o seu fornecedor: OPENAI_API_KEY para a OpenAI,
                # CONTABOT_API_KEY para os demais endpoints.
                if endpoint_host == "api.openai.com":
                    value = os.getenv("OPENAI_API_KEY") or os.getenv("CONTABOT_API_KEY") or ""
                else:
                    value = os.getenv("CONTABOT_API_KEY") or ""
            else:
                value = os.getenv("CONTABOT_" + name.upper())
            if value is not None:
                default = getattr(defaults, name)
                values[name] = json.loads(value) if name == "provider_parameters" else type(default)(value)
        return cls(**values)
