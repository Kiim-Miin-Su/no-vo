// config.example.js - 설정 템플릿
// 실제 사용시 config.js로 복사하고 실제 값으로 수정하세요

export const CONFIG = {
    // 개발용 Notion API 토큰 (실제 토큰으로 교체)
    NOTION_TOKEN: 'ntn_YOUR_ACTUAL_TOKEN_HERE',

    // API 서버 엔드포인트
    API_ENDPOINT: 'https://web-production-ee075.up.railway.app',

    // 개발 모드 설정
    DEV_MODE: true,

    // 로깅 레벨
    LOG_LEVEL: 'debug'
};

// 사용법:
// 1. 이 파일을 config.js로 복사
// 2. NOTION_TOKEN을 실제 토큰으로 교체
// 3. content.js에서 import { CONFIG } from './config.js' 사용