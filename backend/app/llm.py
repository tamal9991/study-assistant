import json
import re
from openai import OpenAI
from app.config import settings
from app.agent.loader import build_prompt
import time
from openai import OpenAI, APIStatusError, APITimeoutError, APIConnectionError

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=settings.OPENROUTER_API_KEY,
)

MODEL = settings.OPENROUTER_MODEL
MAX_CONTEXT_CHARS = 50000


def _trim(text: str) -> str:
    return text[:MAX_CONTEXT_CHARS]


def _extract_json(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
    # try array first, then object
    array_match = re.search(r"\[.*\]", raw, re.DOTALL)
    if array_match:
        return array_match.group(0)
    obj_match = re.search(r"\{.*\}", raw, re.DOTALL)
    return obj_match.group(0) if obj_match else raw


def _llm_call(system: str, user: str, max_tokens: int = 1024) -> str:
    last_err = None
    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                max_tokens=max_tokens,
                temperature=0.5,
                timeout=30,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            )
            return resp.choices[0].message.content or ""
        except APIStatusError as e:
            last_err = e
            if e.status_code == 429 and attempt < 2:
                time.sleep(5)
                continue
            raise
        except (APITimeoutError, APIConnectionError) as e:
            last_err = e
            if attempt < 2:
                time.sleep(2)
                continue
            raise
    if last_err:
        raise last_err
    return ""


def answer_question(source_text: str, history: list[dict], user_question: str) -> str:
    system = build_prompt("chat", source_text=_trim(source_text))
    messages = [{"role": "system", "content": system}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_question})

    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=1024,
        messages=messages,
    )
    return resp.choices[0].message.content


def generate_mcq(source_text: str, previous_questions: list[str]) -> dict:
    """Single MCQ — legacy, used by chat 'Quiz me' button."""
    mcqs = generate_mcq_batch(source_text, n=1, previous_questions=previous_questions)
    return mcqs[0]


def generate_mcq_batch(source_text: str, n: int, previous_questions: list[str] = None) -> list[dict]:
    """Batch MCQ generation — used by quiz page."""
    avoid = ""
    if previous_questions:
        avoid = "Don't repeat these previous questions:\n- " + "\n- ".join(previous_questions[-10:])
    system = build_prompt("quiz_batch", source_text=_trim(source_text), extras=avoid)

    last_err = None
    for attempt in range(2):  # retry once on bad JSON
        try:
            raw = _llm_call(system, f"Generate exactly {n} MCQs now. JSON array only.", max_tokens=2048)
            cleaned = _extract_json(raw)
            data = json.loads(cleaned)
            if not isinstance(data, list):
                raise ValueError("expected a JSON array")
            if len(data) == 0:
                raise ValueError("empty array")

            # validate + normalize each item
            for i, item in enumerate(data):
                assert isinstance(item.get("question"), str) and item["question"].strip(), f"item {i}: bad question"
                assert isinstance(item.get("options"), list) and len(item["options"]) == 4, f"item {i}: need 4 options"
                assert isinstance(item.get("correct_option"), int) and 0 <= item["correct_option"] <= 3, f"item {i}: bad correct_option"
                if "topic" not in item or not isinstance(item["topic"], str):
                    item["topic"] = "general"
                item["topic"] = item["topic"].strip()[:60]
            return data[:n]
        except Exception as e:
            last_err = e
            continue

    raise RuntimeError(f"MCQ batch generation failed after retries: {last_err}")


def generate_report(quiz_results: list[dict], source_text: str = "") -> dict:
    """
    quiz_results: [{"question": str, "topic": str, "selected": int, "correct": int,
                    "is_correct": bool, "options": [str x 4]}]
    Returns the report JSON object.
    """
    system = build_prompt("report", source_text=_trim(source_text))
    user = json.dumps({"results": quiz_results}, ensure_ascii=False)

    last_err = None
    for attempt in range(2):
        try:
            raw = _llm_call(system, user, max_tokens=1024)
            cleaned = _extract_json(raw)
            data = json.loads(cleaned)

            assert isinstance(data.get("summary"), str)
            assert isinstance(data.get("weak_topics"), list)
            assert isinstance(data.get("strong_topics"), list)
            assert isinstance(data.get("overall_score"), str)
            return data
        except Exception as e:
            last_err = e
            continue

    # fallback — synthesize a basic report locally if LLM keeps failing
    total = len(quiz_results)
    correct = sum(1 for r in quiz_results if r["is_correct"])
    return {
        "summary": f"You scored {correct} out of {total}. The AI report couldn't be generated — here's the raw count.",
        "weak_topics": [],
        "strong_topics": [],
        "overall_score": f"{correct}/{total}",
    }


def generate_one_mcq(source_text: str, previous_questions: list[str] = None) -> dict:
    """Generate exactly one MCQ. Used for streaming progress."""
    avoid = ""
    if previous_questions:
        avoid = "Don't repeat:\n- " + "\n- ".join(previous_questions[-15:])
    system = build_prompt("quiz_batch", source_text=_trim(source_text), extras=avoid)
    user_msg = "Generate EXACTLY 1 MCQ. JSON array with one object. No prose, no fences."

    last_err = None
    for attempt in range(2):
        try:
            raw = _llm_call(system, user_msg, max_tokens=500)
            data = _parse_json_loose(raw)
            if isinstance(data, dict):
                data = [data]
            if not isinstance(data, list) or not data:
                raise ValueError("expected array")
            item = data[0]
            q = item.get("question", "").strip()
            opts = item.get("options", [])
            co = item.get("correct_option")
            if not (q and isinstance(opts, list) and len(opts) == 4
                    and isinstance(co, int) and 0 <= co <= 3):
                raise ValueError("invalid MCQ shape")
            return {
                "question": q,
                "options": [str(o).strip() for o in opts],
                "correct_option": co,
                "topic": (item.get("topic") or "general").strip()[:60],
            }
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"single MCQ failed: {last_err}")