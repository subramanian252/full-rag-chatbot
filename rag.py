from langchain_community.vectorstores import FAISS
import os
from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pathlib import Path
import docx2txt


load_dotenv()

embeddings = OpenAIEmbeddings(
    api_key=os.environ["OPENROUTER_API_KEY"],
    base_url="https://openrouter.ai/api/v1" # OpenRouter base URL
)

def add_document_to_rag(thread_id: str, file_path: str):

    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        pypdf_file = PyPDFLoader(file_path)
        documents = pypdf_file.load()
    elif suffix in [".txt", ".md", ".csv"]:
        text = path.read_text(encoding="utf-8", errors="ignore")
        documents = [text]
    elif suffix == ".docx":
        text = docx2txt.process(file_path)
        documents = [text]
    else:
        raise ValueError("Only PDF, TXT, MD, CSV, and DOCX files are supported")

    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    documents = text_splitter.split_documents(documents)

    db_path = f"./faiss/FAISS_{thread_id}"

    vectorstore = FAISS.from_documents(documents, embeddings)
    vectorstore.save_local(db_path)
    
    return "Vector store created successfully"

def rag_retriever(query:str, thread_id: str, k: int = 3):
    
    database_path = f"./faiss/FAISS_{thread_id}"
    
    vectorstore = FAISS.load_local(database_path, embeddings, allow_dangerous_deserialization=True)

    documents = vectorstore.similarity_search(query, k)
    
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
        
