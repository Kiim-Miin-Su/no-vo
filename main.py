import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Notion Views API - Test")

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PageViewRequest(BaseModel):
    page_id: str
    database_id: str = None

@app.get("/")
def root():
    return {
        "message": "🎯 Notion Views API - Test Server",
        "status": "online",
        "version": "test-1.0",
        "endpoints": {
            "health": "GET /health",
            "increment": "POST /increment_views"
        }
    }

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "message": "서버 정상 작동 중"
    }

@app.post("/increment_views")
def increment_views(data: PageViewRequest):
    print(f"[DEBUG] 조회수 요청: {data.page_id}")
    
    # 임시로 항상 성공 응답
    return {
        "success": True,
        "message": "테스트 성공",
        "page_id": data.page_id,
        "previous_views": 0,
        "new_views": 1,
        "test_mode": True
    }

@app.get("/test")
def test():
    return {"test": "OK", "server": "working"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"Starting server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)