import os
from pathlib import Path

from langgraph.checkpoint.postgres import PostgresSaver

from dotenv import load_dotenv


load_dotenv()

def get_database_url():

    database_url = os.getenv("EXTERNAL_DATABASE_URL")

    if not database_url:
        raise ValueError(
            "EXTERNAL_DATABASE_URL environment variable is not set"
        )

    if "sslmode=" not in database_url:
        sep = "&" if "?" in database_url else "?"
        database_url += f"{sep}sslmode=require"

    return database_url


memory_context = PostgresSaver.from_conn_string(get_database_url())

memory = memory_context.__enter__()

memory.setup()

def get_all_threads():
    all_threads = []


    threads = memory.list(None)

    for thread in threads:
        thread_id = thread.config["configurable"]["thread_id"]

        if thread_id not in all_threads:
            all_threads.append(thread_id)

    return all_threads
