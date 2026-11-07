"""scripts/prewarm_transcripts.py: whisper-cli's JSON -> the engine's transcript cache format."""

import importlib.util
import json
from pathlib import Path

import pytest

from sisyphus_engine.transcribe import words

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("prewarm_transcripts", ROOT / "scripts" / "prewarm_transcripts.py")
prewarm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(prewarm)

# The first two segments `whisper-cli -ojf -dtw small.en -nfa` (ggml-small.en) wrote for
# sparsh-jain-same-mistakes.mp4.
FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "whisper_cli_full.json").read_text(encoding="utf-8"))


@pytest.fixture
def converted() -> dict:
    return prewarm.convert(FIXTURE)


def test_segments_keep_whispers_sentences_and_span_their_words(converted):
    assert [(s["start"], s["end"], s["text"]) for s in converted["segments"]] == [
        (0.6, 4.08, "You've worked with your AI agent for the last two years."),
        (4.54, 6.68, "You gained two years of experience."),
    ]


def test_tokens_join_into_stripped_words_without_timing_markers(converted):
    first = converted["segments"][0]["words"]
    assert [w["word"] for w in first] == ["You've", "worked", "with", "your", "AI", "agent", "for", "the", "last", "two", "years."]
    assert " ".join(w["word"] for w in first) == converted["segments"][0]["text"]


def test_dtw_marks_word_ends_and_each_word_starts_where_the_last_ended(converted):
    first = converted["segments"][0]["words"]
    # faster-whisper on the same audio: your 2.31-2.41, AI 2.41-2.69, agent 2.69-2.99.
    assert first[3:6] == [
        {"start": 2.32, "end": 2.42, "word": "your"},
        {"start": 2.42, "end": 2.68, "word": "AI"},
        {"start": 2.68, "end": 3.0, "word": "agent"},
    ]
    assert first[0] == {"start": 0.6, "end": 1.42, "word": "You've"}  # 've's DTW time; no earlier word, so end - 0.6


def test_punctuation_does_not_move_a_words_end(converted):
    # The "." token's DTW time is 4.88, in the pause after "years" (faster-whisper: 4.11).
    assert converted["segments"][0]["words"][-1] == {"start": 3.84, "end": 4.08, "word": "years."}


def test_without_dtw_times_fall_back_to_token_offsets():
    no_dtw = json.loads(json.dumps(FIXTURE))
    for seg in no_dtw["transcription"]:
        for tok in seg["tokens"]:
            tok["t_dtw"] = -1
    first = prewarm.convert(no_dtw)["segments"][0]["words"]
    assert first[0] == {"start": 0.06, "end": 0.68, "word": "You've"}  # " You" 60-340 ms + "'ve" 340-680 ms
    assert first[-1] == {"start": 3.73, "end": 3.98, "word": "years."}  # "." runs 4.08-5.06: not taken


def test_output_is_what_the_engine_reads(converted):
    for seg in converted["segments"]:
        assert set(seg) == {"start", "end", "text", "words"}
        for w in seg["words"]:
            assert set(w) == {"start", "end", "word"}
            assert w["start"] <= w["end"]
            assert round(w["start"], 2) == w["start"] and round(w["end"], 2) == w["end"]
    starts = [w["start"] for w in words(converted)]
    assert starts == sorted(starts)


def test_empty_segments_are_dropped():
    blank = {"offsets": {"from": 0, "to": 1000}, "text": " ", "tokens": [{"text": "[_BEG_]", "offsets": {"from": 0, "to": 0}}]}
    assert prewarm.convert({"transcription": [blank]}) == {"segments": []}


def test_writes_to_the_engines_cache_path(monkeypatch, tmp_path):
    monkeypatch.setattr(prewarm, "_cache_path", lambda footage: tmp_path / "t" / f"{footage.stem}.json")
    path = prewarm.write_cache(tmp_path / "talk.mp4", {"segments": []})
    assert path == tmp_path / "t" / "talk.json"
    assert json.loads(path.read_text(encoding="utf-8")) == {"segments": []}


def tok(text: str, end_cs: int, start_ms: int = 0) -> dict:
    return {"text": text, "offsets": {"from": start_ms, "to": end_cs * 10}, "t_dtw": end_cs}


def seg(text: str, *tokens: dict) -> dict:
    return {"offsets": {"from": 0, "to": 10_000}, "text": text, "tokens": list(tokens)}


def test_punctuation_before_a_word_opens_it_instead_of_standing_alone():
    out = prewarm.convert({"transcription": [seg(' he said - "well', tok(" he", 50), tok(" said", 90), tok(" -", 120),
                                                tok(' "', 130), tok("well", 160))]})
    assert [w["word"] for w in out["segments"][0]["words"]] == ["he", "said", '-"well']
    assert out["segments"][0]["words"][-1] == {"start": 1.0, "end": 1.6, "word": '-"well'}  # 1.6 - 0.6, after "said" ends at 0.9


def test_sound_tags_are_dropped_like_faster_whispers_vad_would():
    tags = [seg(" [BLANK_AUDIO]", tok(" [BLANK_AUDIO]", 100)), seg(" (applause)", tok(" (applause)", 200)),
            seg(" ♪ ♪", tok(" ♪", 300))]
    speech = seg(" Thanks (laughs) all", tok(" Thanks", 350), tok(" (laughs)", 380), tok(" all", 400))
    out = prewarm.convert({"transcription": tags + [speech]})
    assert [s["text"] for s in out["segments"]] == ["Thanks (laughs) all"]


def test_words_stay_ordered_when_timings_step_back():
    # DTW for "two" lands before "one" ended; the next segment has no DTW and early offsets.
    out = prewarm.convert({"transcription": [
        seg(" one two", tok(" one", 200), tok(" two", 150)),
        seg(" three", {"text": " three", "offsets": {"from": 1000, "to": 2600}, "t_dtw": -1}),
    ]})
    ws = words(out)
    assert [(w["word"], w["start"], w["end"]) for w in ws] == [("one", 1.4, 2.0), ("two", 2.0, 2.0), ("three", 2.0, 2.6)]
    assert all(a["end"] <= b["start"] for a, b in zip(ws, ws[1:]))


def test_no_whisper_cli_exits_without_writing(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(prewarm.shutil, "which", lambda name: None)
    monkeypatch.setattr(prewarm, "MODEL_PATH", tmp_path / "models" / "m.bin")
    monkeypatch.setattr(prewarm, "_cache_path", lambda footage: tmp_path / "t" / f"{footage.stem}.json")
    monkeypatch.setattr("sys.argv", ["prewarm_transcripts.py"])
    assert prewarm.main() == 1
    assert "brew install whisper-cpp" in capsys.readouterr().err
    assert list(tmp_path.iterdir()) == []


def test_a_truncated_model_is_downloaded_again(monkeypatch, tmp_path):
    model = tmp_path / "ggml-small.en.bin"
    model.write_bytes(b"<html>rate limited</html>")
    monkeypatch.setattr(prewarm, "MODEL_PATH", model)
    fetched = []
    monkeypatch.setattr(prewarm.urllib.request, "urlretrieve", lambda url, dest: fetched.append(url) or Path(dest).write_bytes(b"x"))
    with pytest.raises(OSError):
        prewarm.ensure_model()
    assert fetched == [prewarm.MODEL_URL]
