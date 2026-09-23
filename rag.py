import os
from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pathlib import Path
import docx2txt
from langchain_core.documents import Document
from pinecone import Pinecone, ServerlessSpec
from langchain_pinecone import PineconeVectorStore
import tempfile
import time

load_dotenv()

embeddings = OpenAIEmbeddings(
    api_key=os.environ["OPENROUTER_API_KEY"],
    base_url="https://openrouter.ai/api/v1" # OpenRouter base URL
)

pc = Pinecone(api_key=os.getenv("PINECONE_DB"))
if not pc.has_index("llmrag"):
    print("Creating index...")
    pc.create_index(
        name="llmrag",
        dimension=1536,
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        timeout=30,
    )

    while not pc.describe_index("llmrag").status["ready"]:
        time.sleep(1)

    index = pc.Index("llmrag")
    vector_store_pine = PineconeVectorStore(index=index, embedding=embeddings)
else:
    print("Index already exists")

index = pc.Index("llmrag")

def get_vectorstore(thread_id: str):
    return PineconeVectorStore(
        index=index,
        embedding=embeddings,
        namespace=thread_id,
    )



async def add_document_to_rag(thread_id: str, file_name: str, file_bytes:bytes):

    path = Path(file_name)
    suffix = path.suffix.lower()

    temp_path = None

    try:
        if suffix == ".pdf":
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
                temp_file.write(file_bytes)
                temp_path = temp_file.name
            pypdf_file = PyPDFLoader(temp_path)
            documents = pypdf_file.load()
        elif suffix in [".txt", ".md", ".csv"]:
            text = file_bytes.decode(
                "utf-8",
                errors="ignore",
            )
            documents = [
                Document(
                    page_content=text,
                    metadata={"source": file_name},
                )
            ]
        elif suffix == ".docx":
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
                temp_file.write(file_bytes)
                temp_path = temp_file.name
            text = docx2txt.process(temp_path)
            documents = [
                Document(
                    page_content=text,
                    metadata={"source": file_name},
                )
            ]
        else:
            raise ValueError("Only PDF, TXT, MD, CSV, and DOCX files are supported")

        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        documents = text_splitter.split_documents(documents)

        vectorstore = get_vectorstore(thread_id)

        await vectorstore.aadd_documents(documents)

        return "Vector store created successfully"
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


def rag_retriever(query:str, thread_id: str, k: int = 3):

    vectorstore = get_vectorstore(thread_id)

    documents = vectorstore.similarity_search(query, k)

    if not documents:
        return (
            "No documents have been uploaded for this conversation, "
            "or no relevant information was found."
        )

    results = []

    for doc in documents:
        page = doc.metadata.get("page", "Unknown")

        source = doc.metadata.get("source", "Unknown")

        results.append({
            "page": page,
            "source": source,
            "content": doc.page_content
        })

    return "\n\n".join([f"Page {r['page']} from {r['source']}:\n{r['content']}" for r in results])
