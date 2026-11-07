import subprocess

import pytest

from sisyphus_engine import experiments, plan, store, styles, versioning
from sisyphus_engine.agents import auditor, creator


def _write(root, agent, name, text):
    folder = root / "skills" / agent / "styles"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.md").write_text(text, encoding="utf-8")


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A Git repo with one style, standing in for the real one."""
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    for k, v in (("user.email", "t@t"), ("user.name", "t")):
        subprocess.run(["git", "-C", str(tmp_path), "config", k, v], check=True)
    _write(tmp_path, "creator", "simple", "# Simple\n\nOne idea,\nfew cuts.\n\n- rule\n")
    _write(tmp_path, "reviewer", "simple", "# Simple\n\nEasy to follow.\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "."], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "commit", "-qm", "init"], check=True)
    for mod in (styles, versioning):
        monkeypatch.setattr(mod, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(styles, "SKILLS_DIR", tmp_path / "skills")
    return tmp_path


def test_parse_reads_title_and_first_paragraph():
    assert styles.parse("# Brain rot\n\nFast\ncuts.\n\n- rule\n") == ("Brain rot", "Fast cuts.")


def test_library_has_both_files_and_summary(repo):
    [s] = styles.library()
    assert s["name"] == "simple" and s["title"] == "Simple" and s["summary"] == "One idea, few cuts."
    assert s["reviewer"].startswith("# Simple")


def test_library_at_a_ref_matches_the_working_tree(repo):
    assert styles.library("HEAD") == styles.library()


def test_a_missing_file_is_named_not_dropped(repo):
    text = styles.for_agent("reviewer", ["simple", "artsy"])
    assert "Easy to follow." in text and "No reviewer file for this style yet" in text


def test_a_person_adds_a_style_as_a_commit(repo):
    s = styles.create("Brain Rot", "Cut every two seconds.", "Never slow.")
    assert s["name"] == "brain-rot" and s["summary"] == "Cut every two seconds."
    shown = subprocess.run(["git", "-C", str(repo), "show", "HEAD:skills/reviewer/styles/brain-rot.md"],
                           capture_output=True, text=True, check=True).stdout
    assert shown == "# Brain rot\n\nNever slow.\n"
    assert subprocess.run(["git", "-C", str(repo), "status", "--porcelain"], capture_output=True, text=True).stdout == ""
    with pytest.raises(FileExistsError):
        styles.create("brain-rot", "a", "b")
    with pytest.raises(ValueError):
        styles.create("!!!", "a", "b")


def test_plan_styles_are_slugged_once():
    assert plan.clamp_raw({"styles": ["Brain Rot", "brain-rot", " "]})["styles"] == ["brain-rot"]


def test_creator_prompt_has_the_requested_style_or_the_library(repo):
    asked = creator.style_prompt(["simple"], None)
    assert "Editing style for this clip: simple" in asked and "few cuts." in asked
    auto = creator.style_prompt([], None)
    assert "No style was requested" in auto and "## Style: simple" in auto


def test_store_tags_a_video_with_its_plan_styles(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "t.db")
    store.init()
    a = store.add_video("f.mp4", "b", styles_requested='["simple"]')
    store.update_video(a, plan={"styles": ["simple"]})
    store.add_video("g.mp4", "b")
    [v] = store.list_videos(style="simple")
    assert v["id"] == a and v["styles"] == ["simple"] and v["styles_requested"] == ["simple"]
    assert len(store.list_videos()) == 2


def test_arm_styles_follow_the_cluster_kind():
    assert experiments._arm_styles({"kind": "style", "style": "simple"}) == {"control": ["simple"], "candidate": ["simple"]}
    assert experiments._arm_styles({"kind": "new_style", "style": "lofi"}) == {"control": None, "candidate": ["lofi"]}
    assert experiments._arm_styles({"kind": "shared", "style": ""}) == {"control": None, "candidate": None}


def test_auditor_file_names():
    assert auditor._file_name("styles/Brain Rot.md") == "styles/brain-rot.md"
    assert auditor._file_name("skills/creator/hooks.md") == "hooks.md"
    assert auditor._file_name("README.md") is None


def test_style_change_stays_in_its_style(repo, monkeypatch):
    monkeypatch.setattr(auditor, "REPO_ROOT", repo)
    monkeypatch.setattr(auditor, "load_skills", lambda agent, ref=None: "")
    monkeypatch.setattr(auditor.llm, "complete_json", lambda *a, **k: {
        "title": "t", "rationale": "r", "reviewer_style": "",
        "files": [{"name": "styles/simple.md", "content": "# Simple\n\nNew."}, {"name": "hooks.md", "content": "x"}],
    })
    out = auditor.propose("creator", {"label": "l", "root_cause": "c", "video_ids": [], "kind": "style", "style": "simple"}, [], [])
    assert list(out["files"]) == ["skills/creator/styles/simple.md"]


def test_new_style_brings_its_reviewer_file(repo, monkeypatch):
    monkeypatch.setattr(auditor, "REPO_ROOT", repo)
    monkeypatch.setattr(auditor, "load_skills", lambda agent, ref=None: "")
    monkeypatch.setattr(auditor.llm, "complete_json", lambda *a, **k: {
        "title": "t", "rationale": "r", "reviewer_style": "# Lofi\n\nCalm.",
        "files": [{"name": "styles/lofi.md", "content": "# Lofi\n\nSlow and warm."}],
    })
    out = auditor.propose("creator", {"label": "l", "root_cause": "c", "video_ids": [], "kind": "new_style", "style": "lofi"}, [], [])
    assert out["files"] == {
        "skills/creator/styles/lofi.md": "# Lofi\n\nSlow and warm.\n",
        "skills/reviewer/styles/lofi.md": "# Lofi\n\nCalm.\n",
    }


def test_style_file_named_without_its_folder_is_still_the_style(repo, monkeypatch):
    monkeypatch.setattr(auditor, "REPO_ROOT", repo)
    monkeypatch.setattr(auditor, "load_skills", lambda agent, ref=None: "")
    monkeypatch.setattr(auditor.llm, "complete_json", lambda *a, **k: {
        "title": "t", "rationale": "r", "reviewer_style": "", "files": [{"name": "simple.md", "content": "# Simple\n\nNew."}],
    })
    out = auditor.propose("creator", {"label": "l", "root_cause": "c", "video_ids": [], "kind": "style", "style": "simple"}, [], [])
    assert list(out["files"]) == ["skills/creator/styles/simple.md"]


def test_a_style_cant_share_a_name_with_a_shared_skill_file(repo):
    (repo / "skills" / "creator" / "editing.md").write_text("# Editing\n", encoding="utf-8")
    with pytest.raises(ValueError):
        styles.create("editing", "a", "b")
