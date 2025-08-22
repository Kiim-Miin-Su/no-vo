import os
import hashlib
import time
import logging
from datetime import datetime
from typing import Optional, Dict, Any

import requests
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("notion-views")

app = FastAPI(
    title="Notion Views API",
    description="Notion 데이터베이스 페이지 조회수 추적 API",
    version="1.1.0",
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 데이터 모델
class PageViewRequest(BaseModel):
    page_id: str
    database_id: Optional[str] = None

class UserConfig(BaseModel):
    notion_token: str
    database_id: Optional[str] = None

# 인메모리 저장소 (운영환경에서는 DB 권장)
user_configs: Dict[str, Dict[str, Any]] = {}
total_view_increments = 0
server_start_time = time.time()

# 유틸리티 함수
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

# 라우트
@app.get("/")
def root():
    uptime = int(time.time() - server_start_time)
    return {
        "message": "🎯 Notion Views API - Production",
        "version": "1.1.0",
        "uptime_seconds": uptime,
        "status": "online",
        "endpoints": {
            "register": "POST /register",
            "increment": "POST /increment_views",
            "stats": "GET /stats",
            "health": "GET /health"
        }
    }

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "uptime": int(time.time() - server_start_time),
        "total_users": len(user_configs),
        "total_views": total_view_increments
    }

@app.post("/register")
def register_user(config: UserConfig):
    try:
        logger.info(f"[register] 사용자 등록 시도")
        
        if not validate_notion_token(config.notion_token):
            raise HTTPException(
                status_code=400,
                detail="올바른 Notion API 토큰 형식이 아닙니다. (secret_ 또는 ntn_로 시작해야 함)"
            )

        headers = create_notion_headers(config.notion_token)

        # 토큰 유효성 검사
        me_response = requests.get("https://api.notion.com/v1/users/me", headers=headers, timeout=10)
        if me_response.status_code != 200:
            logger.error(f"[register] Notion 토큰 검증 실패: {me_response.status_code}")
            raise HTTPException(
                status_code=400,
                detail=f"Notion API 토큰이 유효하지 않습니다. (Status: {me_response.status_code})"
            )

        # API 키 생성
        api_key = generate_api_key(config.notion_token)
        user_configs[api_key] = {
            "notion_token": config.notion_token,
            "database_id": config.database_id,
            "created_at": datetime.now().isoformat(),
            "total_views": 0,
            "last_activity": datetime.now().isoformat(),
        }

        logger.info(f"[register] 사용자 등록 성공: {api_key[:8]}...")

        return {
            "success": True,
            "api_key": api_key,
            "message": "✅ 사용자 등록 완료",
            "instructions": {
                "1": "확장프로그램에 이 API 키를 입력하세요",
                "2": "Notion 데이터베이스에 'Views' (Number) 속성을 추가하세요",
                "3": "데이터베이스를 Notion 통합에 연결하세요"
            }
        }

    except requests.RequestException as e:
        logger.error(f"[register] 네트워크 오류: {e}")
        raise HTTPException(status_code=500, detail="Notion API 서버 연결 실패")
    except Exception as e:
        logger.error(f"[register] 예상치 못한 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/increment_views")
def increment_views(data: PageViewRequest, x_api_key: Optional[str] = Header(None)):
    logger.info(f"[increment] 요청 수신: page_id={data.page_id}, has_api_key={bool(x_api_key)}")
    
    # API 키 확인
    if not x_api_key or x_api_key not in user_configs:
        logger.warning(f"[increment] 유효하지 않은 API 키: {x_api_key[:8] if x_api_key else 'None'}...")
        raise HTTPException(status_code=401, detail="유효한 API 키가 필요합니다")

    user_cfg = user_configs[x_api_key]
    notion_token = user_cfg["notion_token"]
    user_cfg["last_activity"] = datetime.now().isoformat()

    headers = create_notion_headers(notion_token)
    page_id = data.page_id
    url = f"https://api.notion.com/v1/pages/{page_id}"

    try:
        logger.info(f"[increment] Notion API 호출 시작: {page_id}")
        
        # 현재 페이지 정보 가져오기
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            logger.error(f"[increment] 페이지 조회 실패: {response.status_code}")
            error_detail = response.json() if response.content else {"error": "페이지 조회 실패"}
            raise HTTPException(status_code=response.status_code, detail=error_detail)

        page = response.json()
        logger.info(f"[increment] 페이지 조회 성공: {page.get('object', 'unknown')}")

        # 부모가 데이터베이스인지 확인
        parent = page.get("parent", {})
        if parent.get("type") != "database_id":
            logger.warning(f"[increment] 데이터베이스 페이지가 아님: {parent.get('type')}")
            raise HTTPException(status_code=400, detail="대상 페이지가 데이터베이스 행이 아닙니다")

        # Views 속성 확인
        properties = page.get("properties", {})
        if "Views" not in properties:
            logger.error(f"[increment] Views 속성 없음. 사용 가능한 속성: {list(properties.keys())}")
            raise HTTPException(
                status_code=400,
                detail="Views 속성이 없습니다. 데이터베이스에 'Views' (Number) 속성을 추가해주세요"
            )

        views_prop = properties["Views"]
        if views_prop.get("type") != "number":
            logger.error(f"[increment] Views 속성 타입 오류: {views_prop.get('type')}")
            raise HTTPException(status_code=400, detail="Views 속성은 Number 타입이어야 합니다")

        # 현재 조회수 가져오기
        current_views = views_prop.get("number") or 0
        new_views = current_views + 1

        logger.info(f"[increment] 조회수 업데이트: {current_views} -> {new_views}")

        # 조회수 업데이트
        update_response = requests.patch(
            url,
            headers=headers,
            json={"properties": {"Views": {"number": new_views}}},
            timeout=10,
        )

        if update_response.status_code != 200:
            logger.error(f"[increment] 업데이트 실패: {update_response.status_code}")
            error_detail = update_response.json() if update_response.content else {"error": "업데이트 실패"}
            raise HTTPException(status_code=update_response.status_code, detail=error_detail)

        # 통계 업데이트
        global total_view_increments
        total_view_increments += 1
        user_cfg["total_views"] = user_cfg.get("total_views", 0) + 1

        logger.info(f"[increment] 성공: {page_id} ({current_views} -> {new_views})")

        return {
            "success": True,
            "message": "✅ 조회수 증가 성공",
            "page_id": page_id,
            "previous_views": current_views,
            "new_views": new_views,
            "timestamp": datetime.now().isoformat()
        }

    except requests.RequestException as e:
        logger.error(f"[increment] Notion API 오류: {e}")
        raise HTTPException(status_code=500, detail="Notion API 연결 실패")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[increment] 예상치 못한 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/stats")
def get_stats():
    try:
        total_user_views = sum(cfg.get("total_views", 0) for cfg in user_configs.values())
        active_users = len([
            cfg for cfg in user_configs.values()
            if cfg.get("last_activity") and 
            (datetime.now() - datetime.fromisoformat(cfg["last_activity"])).days < 7
        ])
        
        return {
            "total_users": len(user_configs),
            "active_users": active_users,
            "total_views": total_view_increments,
            "total_user_views": total_user_views,
            "uptime_hours": round((time.time() - server_start_time) / 3600, 1),
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"[stats] 오류: {e}")
        raise HTTPException(status_code=500, detail="통계 조회 실패")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    logger.info(f"서버 시작: 포트 {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)