# 第3课：FastAPI 包装
from fastapi import FastAPI, HTTPException
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from graph_react import build_agent

app = FastAPI(title="Mini Agent API", version="0.1.0")
agent = build_agent()


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=200)


class AskResponse(BaseModel):
    answer: str
    steps: int


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest) -> AskResponse:
    try:
        state = await agent.ainvoke({
            "question": req.question,
            "messages": [HumanMessage(req.question)],
            "tool_call": None,
            "observation": None,
            "steps": 0,
        })
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return AskResponse(answer=state["messages"][-1].content, steps=state["steps"])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api_server:app", host="127.0.0.1", port=8000, reload=True)