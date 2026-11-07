"""Run the engine: `python -m sisyphus_engine [--port 8765] [--reload]`."""

import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(prog="sisyphus_engine")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--reload", action="store_true", help="restart on code changes (dev)")
    args = parser.parse_args()
    uvicorn.run(
        "sisyphus_engine.server:app",
        host="127.0.0.1",
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
