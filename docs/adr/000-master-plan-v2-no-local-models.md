# ADR-000: Master Plan v2 With No Local Models

## Status
Accepted

## Context
BelfProctor needs a safer update pipeline, work artifact tracking, project
mapping, rules-based classification, and on-demand live view. The master plan
v2 is accepted as the architectural baseline, but server-side local AI models
are not part of the product direction for this branch.

## Decision
The `new-functions-update` branch implements the master plan with these
amendments:

- No Ollama, Qwen, Vision LLM, Tesseract, OCR, or server-side inference.
- AutoCAD v1 uses COM late binding, recent-files fallback, and window-title
  fallback. A plugin/add-in remains a future adapter behind the same port.
- New structured work/update/project data uses PostgreSQL through Prisma.
- Existing JSON/JSONL legacy endpoints stay compatible during migration.
- React JSX pages remain JSX and are decomposed incrementally.

## Consequences
- Rules-based classification is deterministic and cheap, but less expressive
  than OCR/vision.
- PostgreSQL becomes the primary store for new work-tracking capabilities while
  old ingestion paths keep working.
- Future AI or exact app plugins can be added behind existing interfaces without
  changing the event contract.
