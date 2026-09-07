from langchain_core.tools import tool

from langchain_tavily import TavilySearch
import os
import requests
from dotenv import load_dotenv
import math
from rag import rag_retriever
from langgraph.types import interrupt

from database import save_memory, search_memory

load_dotenv()   

os.environ["TAVILY_API_KEY"] = os.getenv("TAVILY_API_KEY")


tavily_tool =  TavilySearch(max_results=3, topic="general", search_depth="advanced")

current_thread_id = None

def set_current_thread(thread_id: str):
    global current_thread_id
    current_thread_id = thread_id


@tool
def save_memory_to_db(memory: str) -> str:
    """Save a memory to the database for the current thread. this is long term memory storage."""
    if not current_thread_id:
        return "Error: No thread ID set. Please set the thread ID first."
    
    save_memory(current_thread_id, memory)
    return f"Memory saved: {memory}"

@tool
def search_memory(query: str = "") -> str:
    """Search for memories in the database for the current thread."""
    if not current_thread_id:
        return "Error: No thread ID set. Please set the thread ID first."
    
    memories = search_memory(current_thread_id)
    if not memories:
        return "No memories found."
    
    return "\n".join(memories)


@tool
def calculator(expression: str) -> str:
    """Evaluate a mathematical expression and return the result."""
    try:
        allowed = {"math": math, "abs": abs, "round": round, "max": max, "min": min, "sum": sum, "len": len}
        # Simple evaluation - in production, use a proper math parser
        result = eval(expression, {"__builtins__": {}}, allowed)
        return f"Result: {result}"
    except Exception as e:
        return f"Error evaluating expression: {str(e)}"

@tool
def get_current_time() -> str:
    """Get the current time."""
    from datetime import datetime
    return f"Current time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

@tool
def get_current_date() -> str:
    """Get the current date."""
    from datetime import datetime
    return f"Current date: {datetime.now().strftime('%Y-%m-%d')}"

@tool
def get_stock_price(symbol: str) -> str:
    """Get the current stock price for a given symbol."""
    api_key = os.getenv("ALPHAVANTAGE_API_KEY")
    if not api_key:
        return "Error: ALPHAVANTAGE_API_KEY is not configured."

    url = f"https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbol}&apikey={api_key}"
    response = requests.get(url)
    return response.json()

@tool
def buy_stocks(symbol: str, quantity: int) -> str:
    """Buy stocks for a given symbol and quantity. this is a placeholder tool for demonstration purposes."""
    decision = interrupt({
        "message": "Approve stock purchase (yes/no)?",
        "symbol": symbol,
        "quantity": quantity
    })

    if str(decision["approved"]).lower() == "yes":
        return f"Buying {quantity} shares of {symbol}"
    else:
        return "Purchase cancelled"

@tool
def get_weather(city: str) -> str:
    """
    Get the current weather for a city.

    Use this tool when the user asks about current weather,
    temperature, humidity, wind, or current weather conditions
    for a specific city.
    """

    api_key = os.getenv("OPENWEATHER_API_KEY")

    if not api_key:
        return "Error: OPENWEATHER_API_KEY is not configured."

    url = "https://api.openweathermap.org/data/2.5/weather"

    params = {
        "q": city,
        "appid": api_key,
        "units": "metric"
    }

    try:
        response = requests.get(
            url,
            params=params,
            timeout=10
        )

        response.raise_for_status()


        data = response.json()

        weather = data["weather"][0]
        main = data["main"]
        wind = data["wind"]

        city_name = data["name"]
        country = data["sys"]["country"]

        temperature = main["temp"]
        feels_like = main["feels_like"]
        humidity = main["humidity"]
        pressure = main["pressure"]

        description = weather["description"]

        wind_speed = wind["speed"]

        visibility = data.get("visibility")

        result = (
            f"Current weather in {city_name}, {country}:\n"
            f"- Condition: {description}\n"
            f"- Temperature: {temperature}°C\n"
            f"- Feels like: {feels_like}°C\n"
            f"- Humidity: {humidity}%\n"
            f"- Pressure: {pressure} hPa\n"
            f"- Wind speed: {wind_speed} m/s"
        )

        if visibility is not None:
            result += f"\n- Visibility: {visibility / 1000:.1f} km"

        return result

    except requests.exceptions.HTTPError:

        if response.status_code == 404:
            return f"Weather data could not be found for '{city}'."

        if response.status_code == 401:
            return "Weather service is not available at the moment. Please try again later."

        return (
            f"OpenWeather API returned an error: "
            f"{response.status_code}"
        )

    except requests.exceptions.Timeout:
        return "Weather service timed out. Please try again."

    except requests.exceptions.RequestException as e:
        return f"Unable to connect to the weather service: {str(e)}"

    except (KeyError, IndexError, TypeError) as e:
        return f"Unexpected weather data format: {str(e)}"

@tool
def retriever_tool_func(query:str) -> str:
    """Search the documents uploaded in the current conversation.

    Use this tool whenever the user asks a question
    about an uploaded PDF or document."""
    if current_thread_id is None:
        return "Error: No thread ID set. Please set the thread ID first."
    
    try:
        return rag_retriever(query, current_thread_id)
    except FileNotFoundError:
        return "Error: Document not found for this thread. Please upload a document first."
    except Exception as e:
        return f"Error retrieving from document: {str(e)}"

def get_exported_tools():
    return [tavily_tool, get_weather, calculator, get_current_time, get_current_date, get_stock_price, retriever_tool_func, buy_stocks, save_memory_to_db, search_memory]


