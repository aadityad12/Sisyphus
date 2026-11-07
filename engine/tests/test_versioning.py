import subprocess

from sisyphus_engine import versioning


def test_change_branch_content_is_lf(tmp_path, monkeypatch):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    for k, v in (("user.email", "t@t"), ("user.name", "t")):
        subprocess.run(["git", "-C", str(tmp_path), "config", k, v], check=True)
    (tmp_path / "a.md").write_text("x\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "."], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "commit", "-qm", "init"], check=True)
    monkeypatch.setattr(versioning, "REPO_ROOT", tmp_path)
    versioning.create_change_branch("si/t", {"skills/c/b.md": "one\ntwo\n"}, "msg")
    blob = subprocess.run(["git", "-C", str(tmp_path), "show", "si/t:skills/c/b.md"], capture_output=True, check=True).stdout
    assert blob == b"one\ntwo\n"
