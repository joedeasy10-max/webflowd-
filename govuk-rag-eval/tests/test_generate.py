"""Answer synthesis — the deterministic offline generator."""

from src.config import from_dict
from src.generate import EchoGenerator, build_generator


def test_echo_answers_from_context():
    g = EchoGenerator(max_sentences=2)
    out = g.generate(
        "When do I register?",
        ["You must register by 5 October. Keep your UTR safe. Extra sentence."],
    )
    assert out == "You must register by 5 October. Keep your UTR safe."


def test_echo_refuses_without_context():
    g = EchoGenerator()
    out = g.generate("anything", [])
    assert "don't have enough information" in out


def test_echo_is_deterministic():
    g = EchoGenerator()
    ctx = ["A. B. C. D."]
    assert g.generate("q", ctx) == g.generate("q", ctx)


def test_build_generator_selects_provider():
    cfg = from_dict({"generation": {"provider": "echo"}})
    assert build_generator(cfg).generator_id == "echo"


def test_build_generator_openai_id_without_calling():
    cfg = from_dict({"generation": {"provider": "openai", "model": "gpt-4o-mini"}})
    # Construction must not require the SDK or a key (import is lazy).
    assert build_generator(cfg).generator_id == "openai-gpt-4o-mini"


def test_build_generator_rejects_unknown():
    cfg = from_dict({"generation": {"provider": "nope"}})
    try:
        build_generator(cfg)
    except ValueError as e:
        assert "generation.provider" in str(e)
    else:
        raise AssertionError("expected ValueError")
