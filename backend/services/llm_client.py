"""
Centralized LLM client supporting OpenAI and Ollama Cloud.
Provider is controlled by LLM_PROVIDER in .env (openai | ollama).
"""

import os

try:
    from openai import OpenAI
except Exception as e:
    OpenAI = None
    print(f"[WARN] OpenAI package not available: {e}")

LLM_PROVIDER    = os.getenv("LLM_PROVIDER", "openai").lower()

OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL    = "gpt-4o"

OLLAMA_API_KEY  = os.getenv("OLLAMA_API_KEY")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "https://api.ollama.ai/v1")
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "qwen3.5")

OLLAMA_FREE_MODELS = ["kimi-k2.7-code", "minimax-m3", "gemma4", "qwen3.5"]

openai_client = None
ollama_client = None

if OpenAI is None:
    print("[WARN] openai package not installed — LLM features disabled")
else:
    if OPENAI_API_KEY:
        try:
            openai_client = OpenAI(api_key=OPENAI_API_KEY)
            print("[OK] OpenAI client initialized")
        except Exception as e:
            print(f"[WARN] OpenAI client init failed: {e}")
    else:
        print("[WARN] OPENAI_API_KEY not set")

    if OLLAMA_API_KEY:
        try:
            ollama_client = OpenAI(
                api_key=OLLAMA_API_KEY,
                base_url=OLLAMA_BASE_URL,
            )
            print(f"[OK] Ollama Cloud client initialized → {OLLAMA_BASE_URL} (model: {OLLAMA_MODEL})")
        except Exception as e:
            print(f"[WARN] Ollama Cloud client init failed: {e}")
    else:
        print("[WARN] OLLAMA_API_KEY not set — Ollama Cloud disabled")


def _active_client():
    """Return (client, model) for the configured provider, with fallback."""
    if LLM_PROVIDER == "ollama" and ollama_client:
        return ollama_client, OLLAMA_MODEL
    if LLM_PROVIDER == "openai" and openai_client:
        return openai_client, OPENAI_MODEL
    if openai_client:
        return openai_client, OPENAI_MODEL
    if ollama_client:
        return ollama_client, OLLAMA_MODEL
    return None, None


def ask_openai(
    prompt: str,
    system: str = "",
    max_tokens: int = 4096,
    temperature: float = 0.7,
    model: str = None,
) -> str:
    """
    Send a prompt to the active LLM provider and return the text response.
    Pass model= to override the default for a single call.
    """
    client, default_model = _active_client()
    if not client:
        print("[WARN] No LLM client available, returning empty response")
        return ""

    use_model = model or default_model

    try:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        response = client.chat.completions.create(
            model=use_model,
            max_tokens=max_tokens,
            messages=messages,
            temperature=temperature,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        print(f"[ERROR] LLM API error ({use_model}): {e}")
        fallback_client = openai_client if client is ollama_client else ollama_client
        fallback_model  = OPENAI_MODEL   if client is ollama_client else OLLAMA_MODEL
        if fallback_client:
            print(f"[INFO] Retrying with fallback provider (model: {fallback_model})")
            try:
                response = fallback_client.chat.completions.create(
                    model=fallback_model,
                    max_tokens=max_tokens,
                    messages=messages,
                    temperature=temperature,
                )
                return response.choices[0].message.content or ""
            except Exception as e2:
                print(f"[ERROR] Fallback LLM also failed: {e2}")
        return ""
