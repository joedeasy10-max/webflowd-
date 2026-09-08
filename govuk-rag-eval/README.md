# govuk-rag-eval

A RAG system over GOV.UK guidance, wrapped in an evaluation harness that blocks
PRs when retrieval or generation quality regresses.

Full spec and build order: [`BUILD.md`](./BUILD.md).

> **Corpus licence:** GOV.UK content is published under the
> [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
> The crawler is rate-limited to be a polite API citizen.

## Build status

Steps are defined in `BUILD.md` → "Build order". There are **8**.

| # | Step | State |
|---|------|-------|
| 1 | **Ingest + retrieve** — crawl, chunk, index, `retrieve(question)` | ✅ done |
| 2 | Retrieval metrics (hit@k, MRR, recall@k) on ~30 questions | ⬜ next |
| 3 | Golden set to full size (150–300, hand-reviewed) | ⬜ |
| 4 | Generation + RAGAS judge metrics (median-of-3, measure variance) | ⬜ |
| 5 | CI gate — wire `rag-eval.yml` + `compare.py`, commit a baseline | 🟡 files in place, not wired |
| 6 | Regression demos — 3 blocked PRs | ⬜ |
| 7 | Experiment benchmark — run all 4 configs, publish table | 🟡 configs stubbed |
| 8 | Corpus-drift workflow (`refresh-corpus.yml`) | ⬜ |

Step 5's ready-made pieces (`configs/eval_config.yaml`, `scripts/compare.py`,
`.github/workflows/rag-eval.yml`) are committed and `compare.py` is unit-tested,
but the gate isn't live until `src/evaluate.py` (steps 2/4) and a committed
`results/baseline.json` exist.

## Everything is a config value

Nothing that affects retrieval quality is hardcoded — it's all in
[`configs/retrieval.yaml`](./configs/retrieval.yaml): chunk size, overlap,
splitter, embedding provider/model, vector store, retriever, top_k. A PR changes
retrieval behaviour by editing that file, and the CI index cache rebuilds
because its key hashes the file. Swappable backends live behind small
interfaces (`src/embed.py`, `src/store.py`), so changing the embedder or store
is a one-line config edit, not a code change.

## Develop

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.lock
pytest                      # deterministic, offline — no network, no LLM

# Build the index and query it (real path needs OPENAI_API_KEY for the
# openai embedder; set embedding.provider: hashing in the config to run offline)
python -m src.ingest   --config configs/retrieval.yaml --out .index/
python -m src.retrieve --config configs/retrieval.yaml --index .index/ \
    --query "When do I need to register for Self Assessment?"
```

### Running offline / in tests

The tests use a deterministic `hashing` embedder and a file-backed numpy
(`flat`) store, so the whole ingest → retrieve loop runs with no API key and no
network. Point any config at `embedding.provider: hashing` to do the same by
hand.

## Determinism & stable IDs

- Fixed seed, sorted iteration, tie-broken ranking — identical input yields
  identical output, or the gate is worthless.
- Chunk IDs are content-derived and stable: `<page-path>#chunk-<n>` (e.g.
  `gov-uk/register-for-self-assessment#chunk-0`), each carrying a content hash so
  corpus drift is detectable. The golden set references these IDs; re-ingesting
  the same content does not invalidate them.

## Layout

See `BUILD.md` → "Repo structure". This tree currently implements step 1
(`src/config.py`, `corpus.py`, `chunk.py`, `embed.py`, `store.py`, `ingest.py`,
`retrieve.py`) plus the step-5 gate files.
