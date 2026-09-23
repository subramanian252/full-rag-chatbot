import time
from database import SessionLocal, Conversation


for i in range(5):
    start = time.perf_counter()

    with SessionLocal() as db:
        result = db.query(Conversation).first()

    elapsed = time.perf_counter() - start

    print(f"Query {i + 1}: {elapsed:.4f}s")