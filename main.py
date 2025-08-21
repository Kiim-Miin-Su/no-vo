import os
import requests
import hashlib
import time
from datetime import datetime
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import Optional, Dict, Any
import logging

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI(
    title="Notion Views API",
    description="Notion 데이터베이스 페이지 조회수 추적 API",
    version="1.0.0"
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 프로덕션에서는 특정 도메인만 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 데이터 모델들
class PageViewRequest(BaseModel):
    page_id: str
    notion_token: Optional[str] = None  # 하위 호환성
    database_id: Optional[str] = None

class UserConfig(BaseModel):
    notion_token: str
    database_id: Optional[str] = None
    api_key: Optional[str] = None

# 메모리 기반 저장소 (실제로는 Redis나 PostgreSQL 사용 권장)
user_configs = {}
total_view_increments = 0
server_start_time = time.time()

def create_notion_headers(token: str):
    """Notion API 헤더 생성"""
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
    }

def generate_api_key(notion_token: str) -> str:
    """사용자별 고유 API 키 생성"""
    return hashlib.sha256(f"{notion_token}{time.time()}".encode()).hexdigest()[:16]

def validate_notion_token(token: str) -> bool:
    """Notion API 토큰 형식 검증"""
    return token and (token.startswith('ntn_') or token.startswith('secret_'))

@app.get("/")
def root():
    """API 정보"""
    uptime = int(time.time() - server_start_time)
    return {
        "message": "🎯 Notion Views API - Multi Tenant",
        "version": "1.0.0",
        "uptime_seconds": uptime,
        "endpoints": {
            "register": "POST /register - 사용자 등록",
            "increment": "POST /increment_views - 조회수 증가",
            "popular": "GET /popular_commands - 인기 명령어",
            "stats": "GET /stats - 서비스 통계"
        },
        "docs": "/docs"
    }

@app.post("/register")
def register_user(config: UserConfig):
    """새 사용자 등록"""
    try:
        # 토큰 형식 검증
        if not validate_notion_token(config.notion_token):
            raise HTTPException(
                status_code=400, 
                detail="올바른 Notion API 토큰 형식이 아닙니다. (ntn_ 또는 secret_로 시작해야 함)"
            )

        # Notion API 토큰 유효성 검사
        headers = create_notion_headers(config.notion_token)
        
        # 기본 API 접근 테스트
        test_response = requests.get("https://api.notion.com/v1/users/me", headers=headers, timeout=10)
        
        if test_response.status_code != 200:
            raise HTTPException(
                status_code=400, 
                detail=f"Notion API 토큰이 유효하지 않습니다. 상태 코드: {test_response.status_code}"
            )
        
        # 데이터베이스 접근 권한 확인 (선택사항)
        if config.database_id:
            db_url = f"https://api.notion.com/v1/databases/{config.database_id}"
            db_response = requests.get(db_url, headers=headers, timeout=10)
            
            if db_response.status_code != 200:
                logger.warning(f"데이터베이스 접근 실패: {config.database_id}")
                # 경고만 하고 계속 진행 (나중에 설정 가능)
        
        # API 키 생성
        api_key = generate_api_key(config.notion_token)
        
        # 사용자 설정 저장
        user_configs[api_key] = {
            "notion_token": config.notion_token,
            "database_id": config.database_id,
            "created_at": datetime.now().isoformat(),
            "total_views": 0,
            "last_activity": datetime.now().isoformat()
        }
        
        logger.info(f"새 사용자 등록: {api_key[:8]}...")
        
        return {
            "success": True,
            "api_key": api_key,
            "message": "✅ 사용자 등록이 완료되었습니다",
            "setup_guide": {
                "1": "Chrome Extension 설치",
                "2": "API 서버 주소 설정",
                "3": f"API 키 입력: {api_key}",
                "4": "Notion 데이터베이스에 Views(Number) 컬럼 추가"
            }
        }
        
    except requests.RequestException as e:
        logger.error(f"Notion API 요청 실패: {e}")
        raise HTTPException(status_code=500, detail="Notion API 서버에 연결할 수 없습니다")
    except Exception as e:
        logger.error(f"사용자 등록 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/increment_views")
def increment_views(
    data: PageViewRequest,
    x_api_key: Optional[str] = Header(None)
):
    """조회수 증가 (사용자별)"""
    
    # API 키로 사용자 인증
    if x_api_key and x_api_key in user_configs:
        user_config = user_configs[x_api_key]
        notion_token = user_config["notion_token"]
        
        # 마지막 활동 시간 업데이트
        user_config["last_activity"] = datetime.now().isoformat()
        
    else:
        # 직접 토큰 사용 (하위 호환성)
        if not data.notion_token:
            raise HTTPException(
                status_code=401, 
                detail="API 키 또는 Notion 토큰이 필요합니다"
            )
        notion_token = data.notion_token
        logger.info("하위 호환성 모드: 직접 토큰 사용")
    
    headers = create_notion_headers(notion_token)
    page_id = data.page_id
    url = f"https://api.notion.com/v1/pages/{page_id}"

    try:
        # 페이지 정보 가져오기
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code != 200:
            error_detail = res.json() if res.content else {"error": "Unknown error"}
            raise HTTPException(status_code=res.status_code, detail=error_detail)
        
        page_data = res.json()
        
        # Views 속성 확인
        if "Views" not in page_data["properties"]:
            raise HTTPException(
                status_code=400, 
                detail="Views 속성이 존재하지 않습니다. 데이터베이스에 Views(Number) 컬럼을 추가해주세요."
            )
        
        views_property = page_data["properties"]["Views"]
        
        if views_property["type"] != "number":
            raise HTTPException(
                status_code=400, 
                detail="Views 속성이 number 타입이 아닙니다"
            )
        
        # 현재 조회수
        current_views = views_property["number"]
        if current_views is None:
            current_views = 0
            
        new_views = current_views + 1

        # 조회수 업데이트
        update_payload = {
            "properties": {
                "Views": {
                    "number": new_views
                }
            }
        }

        update_res = requests.patch(url, headers=headers, json=update_payload, timeout=10)
        
        if update_res.status_code != 200:
            error_detail = update_res.json() if update_res.content else {"error": "Update failed"}
            raise HTTPException(status_code=update_res.status_code, detail=error_detail)
        
        # 통계 업데이트
        global total_view_increments
        total_view_increments += 1
        
        # 사용자별 조회수 증가 (API 키가 있는 경우)
        if x_api_key and x_api_key in user_configs:
            user_configs[x_api_key]["total_views"] = user_configs[x_api_key].get("total_views", 0) + 1
        
        logger.info(f"조회수 증가 성공: {page_id} ({current_views} -> {new_views})")
            
        return {
            "success": True,
            "message": "✅ Notion 데이터베이스의 Views 컬럼이 성공적으로 증가했습니다!",
            "page_id": page_id,
            "previous_views": current_views,
            "new_views": new_views,
            "timestamp": datetime.now().isoformat()
        }
        
    except requests.RequestException as e:
        logger.error(f"Notion API 요청 실패: {e}")
        raise HTTPException(status_code=500, detail="Notion API 서버 연결 실패")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"조회수 증가 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/popular_commands")
def get_popular_commands(
    limit: int = 10,
    x_api_key: Optional[str] = Header(None)
):
    """인기 명령어 조회 (사용자별)"""
    
    if not x_api_key or x_api_key not in user_configs:
        raise HTTPException(status_code=401, detail="유효한 API 키가 필요합니다")
    
    user_config = user_configs[x_api_key]
    notion_token = user_config["notion_token"]
    database_id = user_config["database_id"]
    
    if not database_id:
        raise HTTPException(
            status_code=400, 
            detail="데이터베이스 ID가 설정되지 않았습니다. 사용자 등록 시 database_id를 포함하거나 별도로 설정하세요."
        )
    
    headers = create_notion_headers(notion_token)
    url = f"https://api.notion.com/v1/databases/{database_id}/query"
    
    query_payload = {
        "sorts": [
            {
                "property": "Views",
                "direction": "descending"
            }
        ],
        "page_size": min(limit, 100)  # 최대 100개로 제한
    }
    
    try:
        res = requests.post(url, headers=headers, json=query_payload, timeout=15)
        if res.status_code != 200:
            error_detail = res.json() if res.content else {"error": "Query failed"}
            raise HTTPException(status_code=res.status_code, detail=error_detail)
        
        # 마지막 활동 시간 업데이트
        user_config["last_activity"] = datetime.now().isoformat()
        
        result = res.json()
        logger.info(f"인기 명령어 조회: 사용자 {x_api_key[:8]}..., {len(result.get('results', []))}개 항목")
        
        return result
        
    except requests.RequestException as e:
        logger.error(f"데이터베이스 조회 실패: {e}")
        raise HTTPException(status_code=500, detail="데이터베이스 조회 실패")
    except Exception as e:
        logger.error(f"인기 명령어 조회 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/stats")
def get_stats():
    """서비스 통계 (실시간)"""
    try:
        total_user_views = sum(config.get("total_views", 0) for config in user_configs.values())
        active_users = len([
            config for config in user_configs.values() 
            if config.get("last_activity") and 
            (datetime.now() - datetime.fromisoformat(config["last_activity"])).days < 7
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
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"통계 조회 오류: {e}")
        raise HTTPException(status_code=500, detail="통계 조회 실패")

@app.get("/health")
def health_check():
    """헬스체크 엔드포인트"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "uptime": int(time.time() - server_start_time)
    }

@app.delete("/user/{api_key}")
def delete_user(api_key: str, x_api_key: Optional[str] = Header(None)):
    """사용자 삭제 (본인만 가능)"""
    if not x_api_key or x_api_key != api_key:
        raise HTTPException(status_code=403, detail="본인의 계정만 삭제할 수 있습니다")
    
    if api_key not in user_configs:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    
    del user_configs[api_key]
    logger.info(f"사용자 삭제: {api_key[:8]}...")
    
    return {
        "success": True,
        "message": "계정이 성공적으로 삭제되었습니다"
    }

# 에러 핸들러
@app.exception_handler(404)
async def not_found_handler(request, exc):
    return {
        "error": "엔드포인트를 찾을 수 없습니다",
        "available_endpoints": [
            "GET /",
            "POST /register", 
            "POST /increment_views",
            "GET /popular_commands",
            "GET /stats",
            "GET /health"
        ]
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)