// background.js - 디버깅 강화 버전

console.log('🔧 Background Service Worker 시작 (Debug Enhanced)');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📨 Background 메시지 수신:', request);

    if (request.action === 'incrementViews') {
        handleIncrementViews(request, sendResponse);
        return true;
    }

    if (request.action === 'testConnection') {
        handleTestConnection(request, sendResponse);
        return true;
    }

    return false;
});

async function handleIncrementViews(request, sendResponse) {
    try {
        const { apiEndpoint, apiKey, pageId, databaseId } = request.data;

        console.log('🚀 조회수 증가 처리 시작:', {
            apiEndpoint,
            apiKeyLength: apiKey ? apiKey.length : 0,
            apiKeyStart: apiKey ? apiKey.substring(0, 8) + '...' : 'NONE',
            pageId,
            databaseId
        });

        // 1. 먼저 서버 기본 상태 확인
        console.log('1️⃣ 서버 루트 확인');
        try {
            const rootResponse = await fetch(`${apiEndpoint}/`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (rootResponse.ok) {
                const rootData = await rootResponse.json();
                console.log('✅ 서버 루트 응답:', rootData);
            } else {
                console.log('❌ 서버 루트 실패:', rootResponse.status);
            }
        } catch (e) {
            console.log('💥 서버 루트 오류:', e.message);
        }

        // 2. API 요청 준비
        const requestOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                page_id: pageId,
                database_id: databaseId
            })
        };

        // API 키가 있으면 헤더에 추가
        if (apiKey && apiKey.trim()) {
            requestOptions.headers['X-API-Key'] = apiKey.trim();
            console.log('🔑 API 키 헤더 추가됨:', apiKey.substring(0, 8) + '...');
        } else {
            console.log('⚠️ API 키 없음!');
        }

        console.log('📤 최종 요청 정보:', {
            url: `${apiEndpoint}/increment_views`,
            method: 'POST',
            headers: Object.keys(requestOptions.headers),
            bodyLength: requestOptions.body.length,
            hasApiKey: !!requestOptions.headers['X-API-Key']
        });

        // 3. 실제 API 요청
        console.log('3️⃣ API 요청 시작...');
        const response = await fetch(`${apiEndpoint}/increment_views`, requestOptions);

        console.log('📡 API 응답 상세:', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            url: response.url,
            headers: Object.fromEntries(response.headers.entries())
        });

        if (response.ok) {
            const result = await response.json();
            console.log('✅ 성공 응답:', result);
            sendResponse({
                success: true,
                data: result
            });
        } else {
            const errorText = await response.text();
            console.error('❌ 실패 응답:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText
            });

            sendResponse({
                success: false,
                error: `API 오류: ${response.status}`,
                details: errorText,
                debugInfo: {
                    status: response.status,
                    url: response.url,
                    hasApiKey: !!requestOptions.headers['X-API-Key']
                }
            });
        }

    } catch (error) {
        console.error('💥 Background 처리 오류:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });

        sendResponse({
            success: false,
            error: error.message
        });
    }
}

async function handleTestConnection(request, sendResponse) {
    try {
        const { apiEndpoint } = request.data;
        console.log('🧪 연결 테스트:', apiEndpoint);

        const response = await fetch(`${apiEndpoint}/health`);

        if (response.ok) {
            const result = await response.json();
            console.log('✅ 연결 성공:', result);
            sendResponse({ success: true, data: result });
        } else {
            console.error('❌ 연결 실패:', response.status);
            sendResponse({ success: false, error: `연결 실패: ${response.status}` });
        }

    } catch (error) {
        console.error('💥 연결 오류:', error);
        sendResponse({ success: false, error: error.message });
    }
}