"""Deployment environments."""


def dev():
    return {
        "name": "dev",
        "timeout": 30,
        "retries": 1,
    }


def staging():
    return {
        "name": "staging",
        "timeout": 60,
        "retries": 3,
        "canary": True,
    }


def production():
    return {
        "name": "production",
        "timeout": 60,
        "retries": 3,
        "canary": True,
    }


ENVS = {"dev": dev, "staging": staging, "production": production}
