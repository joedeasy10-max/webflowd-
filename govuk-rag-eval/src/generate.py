"""Answer synthesis behind one thin interface. The model is a config value.

Providers:
  * echo   - deterministic, offline, zero-cost. Stitches an answer from the
             retrieved context (or refuses when there is no context). Used by
             tests and any offline run, so the judge pipeline is exercisable
             without a key or network.
  * openai - a real chat model (config.generation.model). Needs OPENAI_API_KEY.

Generation is only used by the judge suite (build step 4). Keeping it behind an
interface means swapping the generator is a config edit, and the deterministic
`echo` provider keeps the judge pipeline testable without an LLM.
"""

from __future__ import annotations

import re
from typing import Protocol

from .config import Config, GenerationConfig

_REFUSAL = "I don't have enough information in the provided guidance to answer that."
_SENT_RE = re.compile(r"(?<=[.!?])\s+")


class Generator(Protocol):
    generator_id: str

    def generate(self, question: str, contexts: list[str]) -> str:
        ...


class EchoGenerator:
    """Deterministic, offline. Answers from the top context; refuses if none."""

    def __init__(self, max_sentences: int = 2):
        self.max_sentences = max_sentences
        self.generator_id = "echo"

    def generate(self, question: str, contexts: list[str]) -> str:
        joined = " ".join(c.strip() for c in contexts if c.strip())
        if not joined:
            return _REFUSAL
        sentences = _SENT_RE.split(joined)
        return " ".join(sentences[: self.max_sentences]).strip()


class OpenAIGenerator:
    """A real chat model. Answers strictly from the supplied context."""

    _SYSTEM = (
        "You answer questions using ONLY the provided GOV.UK context. "
        "If the context does not contain the answer, say you don't have enough "
        "information. Be concise."
    )

    def __init__(self, model: str, temperature: float = 0.0, max_tokens: int = 512):
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.generator_id = f"openai-{model}"

    def generate(self, question: str, contexts: list[str]) -> str:
        from openai import OpenAI  # lazy: only on the real path

        client = OpenAI()
        context_block = "\n\n".join(f"[{i}] {c}" for i, c in enumerate(contexts))
        resp = client.chat.completions.create(
            model=self.model,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            messages=[
                {"role": "system", "content": self._SYSTEM},
                {
                    "role": "user",
                    "content": f"Context:\n{context_block}\n\nQuestion: {question}",
                },
            ],
        )
        return (resp.choices[0].message.content or "").strip()


def build_generator(config: Config) -> Generator:
    gen: GenerationConfig = config.generation
    if gen.provider == "echo":
        return EchoGenerator()
    if gen.provider == "openai":
        return OpenAIGenerator(
            model=gen.model, temperature=gen.temperature, max_tokens=gen.max_tokens
        )
    raise ValueError(f"Unknown generation.provider: {gen.provider!r}")
