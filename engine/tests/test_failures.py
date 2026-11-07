from sisyphus_engine.failures import Agent, attribute_failure


def test_sent_back_is_creator_failure():
    assert attribute_failure(reviewer_approved=False, human_liked=None) == {Agent.CREATOR}
    assert attribute_failure(reviewer_approved=False, human_liked=False) == {Agent.CREATOR}


def test_sent_back_but_humans_liked_is_reviewer_only():
    assert attribute_failure(reviewer_approved=False, human_liked=True) == {Agent.REVIEWER}


def test_approved_but_humans_disliked_is_both():
    assert attribute_failure(reviewer_approved=True, human_liked=False) == {
        Agent.CREATOR,
        Agent.REVIEWER,
    }


def test_approved_and_liked_is_no_failure():
    assert attribute_failure(reviewer_approved=True, human_liked=True) == set()
    assert attribute_failure(reviewer_approved=True, human_liked=None) == set()
