import os
import re
import requests
import hashlib
import time
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import logging

# ===== 로깅 =====
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("notion-views")

load_dotenv()

app = FastAPI(
    title="Notion Views API",
    description="Notion 데이터베이스 페이지 조회수 추적 API (Multi-tenant)",
    version="1.0.0",
)

# ===== 중복 슬래시 정규화 (//stats -> /stats) =====
@app.middleware("http")
async def collapse_duplicate_slashes(request: Request, call_next):
    path = request.scope.get("path") or ""
    normalized = re.sub(r"/{2,}", "/", path)
    if normalized != path:
        request.scope["path"] = normalized
    return await call_next(request)

# ===== CORS =====
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 운영시 허용 도메인만 명시
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== 데이터 모델 =====
class PageViewRequest(BaseModel):
    page_id: str
    notion_token: Optional[str] = None  # 하위 호환
    database_id: Optional[str] = None

class UserConfig(BaseModel):
    notion_token: str
    database_id: Optional[str] = None
    api_key: Optional[str] = None

# ===== 인메모리 상태 (운영은 Redis/DB 권장) =====
user_configs: Dict[str, Dict[str, Any]] = {}
total_view_increments = 0
server_start_time = time.time()

# ===== 유틸 =====
def create_notion_headers(token: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }

def generate_api_key(notion_token: str) -> str:
    return hashlib.sha256(f"{notion_token}{time.time()}".encode()).hexdigest()[:16]

def validate_notion_token(token: Optional[str]) -> bool:
    return bool(token) and (token.startswith("ntn_") or token.startswith("secret_"))

# ===== 라우트 =====
@app.get("/")
def root():
    uptime = int(time.time() - server_start_time)
    return {
        "message": "🎯 Notion Views API - Multi Tenant",
        "version": "1.0.0",
        "uptime_seconds": uptime,
        "endpoints": {
            "register": "POST /register",
            "increment": "POST /increment_views",
            "popular": "GET /popular_commands",
            "stats": "GET /stats",
            "health": "GET /health",
        },
        "docs": "/docs",
        "backend_base_url": "https://web-production-ee075.up.railway.app",
    }

@app.post("/register")
def register_user(config: UserConfig):
    try:
        if not validate_notion_token(config.notion_token):
            raise HTTPException(
                status_code=400,
                detail="올바른 Notion API 토큰 형식이 아닙니다. (ntn_ 또는 secret_로 시작해야 함)",
            )

        headers = create_notion_headers(config.notion_token)

        # 토큰 확인
        me = requests.get("https://api.notion.com/v1/users/me", headers=headers, timeout=10)
        if me.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Notion API 토큰이 유효하지 않습니다. status={me.status_code}",
            )

        # (옵션) DB 접근 확인
        if config.database_id:
            db = requests.get(
                f"https://api.notion.com/v1/databases/{config.database_id}",
                headers=headers,
                timeout=10,
            )
            if db.status_code != 200:
                logger.warning(f"[register] DB 접근 실패: {config.database_id} status={db.status_code}")

        api_key = generate_api_key(config.notion_token)
        user_configs[api_key] = {
            "notion_token": config.notion_token,
            "database_id": config.database_id,
            "created_at": datetime.now().isoformat(),
            "total_views": 0,
            "last_activity": datetime.now().isoformat(),
        }
        logger.info(f"[register] user={api_key[:8]} created")

        return {
            "success": True,
            "api_key": api_key,
            "message": "✅ 사용자 등록 완료",
            "setup_guide": {
                "1": "Chrome Extension 설치",
                "2": "API 서버 주소에 'https://web-production-ee075.up.railway.app' 입력",
                "3": f"발급된 API 키 입력: {api_key}",
                "4": "Notion DB에 'Views' (Number) 속성 추가",
            },
        }

    except requests.RequestException as e:
        logger.error(f"[register] Notion 요청 실패: {e}")
        raise HTTPException(status_code=500, detail="Notion API 서버에 연결할 수 없습니다")
    except Exception as e:
        logger.error(f"[register] 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/increment_views")
def increment_views(data: PageViewRequest, x_api_key: Optional[str] = Header(None)):
    # 인증
    if x_api_key and x_api_key in user_configs:
        user_cfg = user_configs[x_api_key]
        notion_token = user_cfg["notion_token"]
        user_cfg["last_activity"] = datetime.now().isoformat()
    else:
        if not data.notion_token:
            raise HTTPException(status_code=401, detail="API 키 또는 Notion 토큰이 필요합니다")
        notion_token = data.notion_token
        logger.info("[increment] legacy mode: direct token")

    headers = create_notion_headers(notion_token)
    page_id = data.page_id
    url = f"https://api.notion.com/v1/pages/{page_id}"

    try:
        # 현재 값 읽기
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code != 200:
            error_detail = res.json() if res.content else {"error": "Unknown error"}
            raise HTTPException(status_code=res.status_code, detail=error_detail)
        page = res.json()

        props = page.get("properties", {})
        if "Views" not in props:
            raise HTTPException(
                status_code=400,
                detail="Views 속성이 없습니다. 데이터베이스에 Views(Number) 컬럼을 추가해주세요.",
            )
        views_prop = props["Views"]
        if views_prop.get("type") != "number":
            raise HTTPException(status_code=400, detail="Views 속성은 number 타입이어야 합니다.")

        current = views_prop.get("number") or 0
        new_val = current + 1

        # 업데이트
        upd = requests.patch(
            url,
            headers=headers,
            json={"properties": {"Views": {"number": new_val}}},
            timeout=10,
        )
        if upd.status_code != 200:
            error_detail = upd.json() if upd.content else {"error": "Update failed"}
            raise HTTPException(status_code=upd.status_code, detail=error_detail)

        # 통계
        global total_view_increments
        total_view_increments += 1
        if x_api_key and x_api_key in user_configs:
            user_configs[x_api_key]["total_views"] = user_configs[x_api_key].get("total_views", 0) + 1

        logger.info(f"[increment] {page_id}: {current} -> {new_val}")

        return {
            "success": True,
            "message": "✅ Views 증가 성공",
            "page_id": page_id,
            "previous_views": current,
            "new_views": new_val,
            "timestamp": datetime.now().isoformat(),
        }

    except requests.RequestException as e:
        logger.error(f"[increment] Notion 요청 실패: {e}")
        raise HTTPException(status_code=500, detail="Notion API 서버 연결 실패")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[increment] 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/popular_commands")
def get_popular_commands(limit: int = 10, x_api_key: Optional[str] = Header(None)):
    if not x_api_key or x_api_key not in user_configs:
        raise HTTPException(status_code=401, detail="유효한 API 키가 필요합니다")

    cfg = user_configs[x_api_key]
    notion_token = cfg["notion_token"]
    database_id = cfg.get("database_id")
    if not database_id:
        raise HTTPException(
            status_code=400,
            detail="데이터베이스 ID가 없습니다. 등록 시 database_id를 포함하거나 이후 설정하세요.",
        )

    headers = create_notion_headers(notion_token)
    url = f"https://api.notion.com/v1/databases/{database_id}/query"
    payload = {"sorts": [{"property": "Views", "direction": "descending"}], "page_size": min(limit, 100)}

    try:
        q = requests.post(url, headers=headers, json=payload, timeout=15)
        if q.status_code != 200:
            error_detail = q.json() if q.content else {"error": "Query failed"}
            raise HTTPException(status_code=q.status_code, detail=error_detail)

        cfg["last_activity"] = datetime.now().isoformat()
        result = q.json()
        logger.info(f"[popular] user={x_api_key[:8]} count={len(result.get('results', []))}")
        return result

    except requests.RequestException as e:
        logger.error(f"[popular] DB 조회 실패: {e}")
        raise HTTPException(status_code=500, detail="데이터베이스 조회 실패")
    except Exception as e:
        logger.error(f"[popular] 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/stats")
def get_stats():
    try:
        total_user_views = sum(cfg.get("total_views", 0) for cfg in user_configs.values())
        active_users = len([
            cfg for cfg in user_configs.values()
            if cfg.get("last_activity") and (datetime.now() - datetime.fromisoformat(cfg["last_activity"])).days < 7
        ])
        uptime = int(time.time() - server_start_time)
        return {
            "total_users": len(user_configs),
            "active_users": active_users,
            "total_views": total_view_increments,
            "total_user_views": total_user_views,
            "service_status": "online",
            "version": "1.0.0",
            "uptime_seconds": uptime,
            "uptime_hours": round(uptime / 3600, 1),
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        logger.error(f"[stats] 오류: {e}")
        raise HTTPException(status_code=500, detail="통계 조회 실패")

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "uptime": int(time.time() - server_start_time),
    }

# ===== 404 핸들러 =====
@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    return JSONResponse(
        status_code=404,
        content={
            "error": "엔드포인트를 찾을 수 없습니다",
            "available_endpoints": [
                "GET /",
                "POST /register",
                "POST /increment_views",
                "GET /popular_commands",
                "GET /stats",
                "GET /health",
            ],
        },
    )

if __name__ == "__main__":
    import uvicorn
    # Railway는 PORT 환경변수(보통 8080)를 내려줌
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
