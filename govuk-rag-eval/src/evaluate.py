"""Evaluation runner: dataset x config -> results.json.

Step 2 implements the deterministic `retrieval` suite (hit@5, MRR,
context_recall@10). The `judge` suite (RAGAS) lands in build step 4.

The retriever loads the index built by `python -m src.ingest` (defaulting to the
config's store path), retrieves each question, and scores the returned ranking
against the golden set's `source_ids`. Metrics are computed over what the system
actually returns (config.retrieval.top_k), so lowering top_k shows up here — the
"top_k 5 -> 2" regression demo is meant to trip this suite.

CLI (matches .github/workflows/rag-eval.yml):
    python -m src.evaluate --suite retrieval \
        --dataset data/golden/questions.jsonl \
        --config configs/retrieval.yaml \
        --out results/current.json

    python -m src.evaluate --suite judge ... --runs 3 --merge-into results/current.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .config import Config, load_config
from .golden import GoldenRecord, dataset_version, load_golden
from .metrics import retrieval as R
from .retrieve import Retriever

# The retrieval metrics this suite reports. Names match configs/eval_config.yaml.
# Each is (metric_name, cutoff-or-None). cutoff None => whole returned ranking.
_RETRIEVAL_METRICS: list[tuple[str, int | None]] = [
    ("hit_at_5", 5),
    ("mrr", None),
    ("context_recall_at_10", 10),
]


def _score_question(ranked_ids: list[str], record: GoldenRecord) -> dict:
    relevant = record.source_ids
    first_rank = next(
        (i for i, cid in enumerate(ranked_ids, start=1) if cid in set(relevant)),
        None,
    )
    return {
        "id": record.id,
        "difficulty": record.difficulty,
        "hit_at_5": R.hit_at_k(ranked_ids, relevant, 5),
        "mrr": R.reciprocal_rank(ranked_ids, relevant),
        "context_recall_at_10": R.recall_at_k(ranked_ids, relevant, 10),
        "first_relevant_rank": first_rank,
    }


def run_retrieval_suite(
    records: list[GoldenRecord],
    config: Config,
    index_dir: str | Path,
    limit: int | None = None,
) -> dict:
    retriever = Retriever(config, index_dir)
    answerable = [r for r in records if r.is_answerable]
    if limit is not None:
        answerable = answerable[:limit]

    per_question: list[dict] = []
    for record in answerable:
        results = retriever.retrieve(record.question)
        ranked_ids = [sc.chunk.chunk_id for sc in results]
        per_question.append(_score_question(ranked_ids, record))

    aggregate = {
        name: R.mean([q[name] for q in per_question]) for name, _ in _RETRIEVAL_METRICS
    }
    return {
        "n_questions": len(records),
        "n_answerable": len(answerable),
        "n_negatives": sum(1 for r in records if r.is_negative),
        "metrics": aggregate,
        "per_question": per_question,
    }


def _write_results(out_path: Path, payload: dict) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=True))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run an evaluation suite.")
    parser.add_argument("--suite", choices=["retrieval", "judge"], required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--index", type=Path, default=None, help="index dir (default: store.path)")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--merge-into", type=Path, default=None)
    parser.add_argument("--limit", type=int, default=None, help="cap questions (cost discipline)")
    parser.add_argument("--runs", type=int, default=1, help="judge suite only")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    records = load_golden(args.dataset)
    version = dataset_version(records)

    if args.suite == "judge":
        raise SystemExit(
            "The judge suite (RAGAS) is build step 4 and is not implemented yet."
        )

    index_dir = args.index if args.index is not None else Path(config.store.path)
    suite = run_retrieval_suite(records, config, index_dir, limit=args.limit)

    # Assemble results in the shape scripts/compare.py expects: dataset_version
    # at the top level, and each suite's aggregate metrics under its suite name.
    if args.merge_into is not None and args.merge_into.exists():
        payload = json.loads(args.merge_into.read_text())
    else:
        payload = {}
    payload["dataset_version"] = version
    payload["retrieval"] = suite["metrics"]
    payload["retrieval_detail"] = {
        "n_questions": suite["n_questions"],
        "n_answerable": suite["n_answerable"],
        "n_negatives": suite["n_negatives"],
        "per_question": suite["per_question"],
    }

    target = args.out or args.merge_into
    if target is None:
        raise SystemExit("Provide --out or --merge-into.")
    _write_results(target, payload)

    m = suite["metrics"]
    print(
        f"[retrieval] dataset {version} · {suite['n_answerable']} answerable "
        f"(+{suite['n_negatives']} negatives) · "
        f"hit@5={m['hit_at_5']:.3f} mrr={m['mrr']:.3f} "
        f"recall@10={m['context_recall_at_10']:.3f} -> {target}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
