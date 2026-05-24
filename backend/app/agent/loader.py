from pathlib import Path
from functools import lru_cache

AGENT_DIR = Path(__file__).resolve().parent


def _read(filename: str) -> str:
    return (AGENT_DIR / filename).read_text(encoding="utf-8").strip()


@lru_cache(maxsize=1)
def _base_prompt() -> str:
    """Identity + Soul — loaded once."""
    return f"{_read('IDENTITY.md')}\n\n{_read('SOUL.md')}"


@lru_cache(maxsize=1)
def _agents_doc() -> str:
    return _read("AGENTS.md")


def build_prompt(mode: str, source_text: str = "", extras: str = "") -> str:
    """
    Compose the full system prompt for a given mode.
    mode: 'chat' | 'quiz_batch' | 'report'
    """
    parts = [_base_prompt(), _agents_doc(), f"## CURRENT MODE\n{mode}"]
    if source_text:
        parts.append(f"## STUDY MATERIAL\n{source_text}")
    if extras:
        parts.append(extras)
    return "\n\n---\n\n".join(parts)
