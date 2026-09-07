import sqlite3
import os
from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver

from dotenv import load_dotenv

load_dotenv()


data_directory = Path(os.getenv("CHATBOT_DATA_DIR", "."))
data_directory.mkdir(parents=True, exist_ok=True)
checkpoint_path = data_directory / "checkpointer.db"

memory = SqliteSaver(
    sqlite3.connect(checkpoint_path, check_same_thread=False)
)


def get_all_threads():
    all_threads = []


    threads = memory.list(None)

    for thread in threads:
        thread_id = thread.config["configurable"]["thread_id"]

        if thread_id not in all_threads:
            all_threads.append(thread_id)

    return all_threads
