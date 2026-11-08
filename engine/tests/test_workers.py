import threading
import time

import pytest
from fastapi.testclient import TestClient

from sisyphus_engine import jobs, store


def _start(slots, started, release):
    """A job that marks itself started once it holds a slot, then holds it until `release` is set."""

    def job():
        with slots.held():
            started.append(1)
            release.wait(5)

    t = threading.Thread(target=job, daemon=True)
    t.start()
    return t


def _wait_until(cond, timeout=2.0):
    end = time.monotonic() + timeout
    while not cond() and time.monotonic() < end:
        time.sleep(0.01)
    return cond()


def test_raising_the_limit_starts_queued_jobs_without_a_restart():
    slots = jobs._Slots(1)
    started, release = [], threading.Event()
    threads = [_start(slots, started, release) for _ in range(3)]
    assert _wait_until(lambda: len(started) == 1)
    assert not _wait_until(lambda: len(started) > 1, timeout=0.2)  # the other two wait in 'queued'

    slots.set(3)
    assert _wait_until(lambda: len(started) == 3)
    release.set()
    for t in threads:
        t.join(2)
    assert slots.active == 0


def test_lowering_the_limit_lets_running_jobs_finish_and_holds_new_ones():
    slots = jobs._Slots(2)
    started, release = [], threading.Event()
    first = [_start(slots, started, release) for _ in range(2)]
    assert _wait_until(lambda: len(started) == 2)

    slots.set(1)
    later_started, later_release = [], threading.Event()
    later = _start(slots, later_started, later_release)
    release.set()  # both running jobs finish; only then does the queued one take the single slot
    for t in first:
        t.join(2)
    assert _wait_until(lambda: len(later_started) == 1)
    later_release.set()
    later.join(2)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "t.db")
    monkeypatch.setattr(jobs, "resume_unfinished", lambda: 0)
    monkeypatch.setattr(jobs, "slots", jobs._Slots(jobs.DEFAULT_WORKERS))
    store.init()
    from sisyphus_engine import server

    return TestClient(server.app)


def test_settings_change_the_limit_and_survive_a_restart(client, monkeypatch):
    assert client.get("/settings").json() == {"workers": 6, "max_workers": jobs.MAX_WORKERS, "running": 0}

    assert client.patch("/settings", json={"workers": 3}).json()["workers"] == 3
    assert jobs.slots.limit == 3

    monkeypatch.setattr(jobs, "slots", jobs._Slots(jobs.DEFAULT_WORKERS))  # a fresh engine
    jobs.load_settings()
    assert jobs.slots.limit == 3


@pytest.mark.parametrize("n", [0, jobs.MAX_WORKERS + 1])
def test_settings_refuse_a_count_out_of_range(client, n):
    assert client.patch("/settings", json={"workers": n}).status_code == 422
    assert jobs.slots.limit == jobs.DEFAULT_WORKERS
