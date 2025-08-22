// content.js - 완전한 작동 버전 (Background Script + 개선된 DB 인식)

class NotionViewsTracker {
    constructor() {
        this.apiEndpoint = 'https://web-production-ee075.up.railway.app';
        this.apiKey = '';
        this.databaseId = '';
        this.trackedPages = new Set();
        this.isEnabled = true;

        this.init();
    }

    async init() {
        console.log('🎯 Notion Views Tracker 초기화 (완전 버전)');

        try {
            await this.loadSettings();

            // Settings 업데이트 메시지 수신
            if (chrome.runtime && chrome.runtime.onMessage) {
                chrome.runtime.onMessage.addListener((msg) => {
                    if (msg?.action === 'settingsUpdated' && msg.settings) {
                        console.log('📝 설정 업데이트됨:', msg.settings);
                        this.apiEndpoint = this.normalizeEndpoint(msg.settings.apiEndpoint || this.apiEndpoint);
                        this.apiKey = msg.settings.apiKey || this.apiKey;
                        this.isEnabled = msg.settings.isEnabled ?? this.isEnabled;
                        this.databaseId = msg.settings.databaseId || this.databaseId;
                        this.checkCurrentPage();
                    }
                });
            }

            // 연결 테스트
            if (this.apiEndpoint && this.isEnabled) {
                await this.testConnection();
            }

            this.checkCurrentPage();
            this.observeUrlChanges();
            this.observeClicks();

            console.log('🎯 Notion Views Tracker 활성화됨');
            console.log('⚙️ 설정:', {
                apiEndpoint: this.apiEndpoint,
                hasApiKey: !!this.apiKey,
                databaseId: this.databaseId,
                isEnabled: this.isEnabled
            });
        } catch (error) {
            console.error('초기화 오류:', error);
        }
    }

    normalizeEndpoint(ep) {
        if (!ep) return '';
        return ep.replace(/\/+$/, '');
    }

    async loadSettings() {
        try {
            if (!chrome.storage || !chrome.storage.sync) {
                console.warn('Chrome storage API 접근 불가 - 기본값 사용');
                return;
            }

            const result = await chrome.storage.sync.get([
                'apiEndpoint', 'apiKey', 'isEnabled', 'databaseLink', 'databaseId'
            ]);

            if (result.apiEndpoint) this.apiEndpoint = this.normalizeEndpoint(result.apiEndpoint);
            if (result.apiKey) this.apiKey = result.apiKey;
            if (result.isEnabled !== undefined) this.isEnabled = result.isEnabled;

            if (result.databaseId) {
                this.databaseId = result.databaseId;
            } else if (result.databaseLink) {
                const parsed = this.extractDatabaseIdFromUrl(result.databaseLink);
                if (parsed) {
                    this.databaseId = parsed;
                    await chrome.storage.sync.set({ databaseId: parsed });
                }
            }

            console.log('📋 설정 로드 완료:', result);
        } catch (error) {
            console.warn('설정 로드 실패, 기본값 사용:', error);
        }
    }

    // Background Script를 통한 연결 테스트
    async testConnection() {
        try {
            console.log('🧪 Background Script를 통한 연결 테스트');

            const response = await this.sendMessageToBackground('testConnection', {
                apiEndpoint: this.apiEndpoint
            });

            if (response.success) {
                console.log('✅ 연결 테스트 성공:', response.data);
                this.showNotification('✅ API 서버 연결 성공', 'success');
                return true;
            } else {
                console.error('❌ 연결 테스트 실패:', response.error);
                this.showNotification(`❌ 연결 실패: ${response.error}`, 'error');
                return false;
            }
        } catch (error) {
            console.error('💥 연결 테스트 오류:', error);
            this.showNotification('🔌 연결 테스트 실패', 'error');
            return false;
        }
    }

    checkCurrentPage() {
        try {
            if (!this.isEnabled || !this.apiEndpoint) {
                console.log('❌ 트래커 비활성화 또는 엔드포인트 없음');
                return;
            }

            const currentUrl = window.location.href;
            const pageId = this.extractPageId(currentUrl);

            console.log('🔍 페이지 체크:', {
                url: currentUrl,
                pageId: pageId,
                isDbItem: this.isPossiblyDbItem(),
                alreadyTracked: this.trackedPages.has(pageId)
            });

            if (pageId && this.isPossiblyDbItem() && !this.trackedPages.has(pageId)) {
                console.log('📊 조회수 추적 시작 (Background Script 사용)');
                this.trackView(pageId);
            }
        } catch (error) {
            console.error('페이지 체크 오류:', error);
        }
    }

    extractPageId(url) {
        try {
            // 1. URL 파라미터에서 p= 값 우선 확인
            const urlObj = new URL(url);
            const pageIdFromParam = urlObj.searchParams.get('p');

            if (pageIdFromParam && /^[a-f0-9]{32}$/i.test(pageIdFromParam)) {
                // 32자리를 하이픈 포함 형태로 변환
                const formatted = `${pageIdFromParam.slice(0, 8)}-${pageIdFromParam.slice(8, 12)}-${pageIdFromParam.slice(12, 16)}-${pageIdFromParam.slice(16, 20)}-${pageIdFromParam.slice(20)}`;
                console.log('📄 Page ID (from param):', formatted);
                return formatted;
            }
        } catch (error) {
            console.warn('URL 파싱 실패:', error);
        }

        // 2. 기존 방식으로 폴백
        const match = url.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        const result = match ? match[1] : null;
        if (result) console.log('📄 Page ID (from regex):', result);
        return result;
    }

    extractDatabaseIdFromUrl(url) {
        if (!url) return null;
        const match = url.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (!match) return null;
        let id = match[1].toLowerCase();
        if (/^[a-f0-9]{32}$/.test(id)) {
            id = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
        }
        return id;
    }

    // content.js의 isPossiblyDbItem 함수만 수정

    isPossiblyDbItem() {
        if (!(location.hostname.includes('notion.so') || location.hostname.includes('notion.site') || location.hostname.includes('notion.com'))) {
            console.log('❌ Notion 도메인이 아님');
            return false;
        }

        // 1. URL 기반 판단 - 더 유연한 페이지 ID 매칭
        const currentUrl = window.location.href;

        // 다양한 Notion URL 형태 지원
        const urlPatterns = [
            // 기본 형태: /24e892e264b98016824bf74d13a56ad6
            /\/[a-f0-9]{32}(\?|$)/i,
            // 하이픈 포함: /24e892e2-64b9-8016-824b-f74d13a56ad6  
            /\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(\?|$)/i,
            // 제목-ID 형태: /Linux-24de54b2d72f808fb2cfe6f47cf1876a
            /\/[^\/]*-[a-f0-9]{32}(\?|$)/i,
            // 제목-ID 하이픈 형태: /Linux-24e892e2-64b9-8016-824b-f74d13a56ad6
            /\/[^\/]*-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(\?|$)/i
        ];

        const hasPageId = urlPatterns.some(pattern => pattern.test(currentUrl));

        if (!hasPageId) {
            console.log('❌ URL에서 유효한 페이지 ID 패턴을 찾을 수 없음:', currentUrl);
            return false;
        }

        console.log('✅ URL에서 페이지 ID 패턴 발견:', currentUrl);

        // 2. DOM 기반 판단 - 더 광범위한 선택자 사용
        const dbIndicators = [
            // Properties 패널
            '[data-testid="properties"]',
            '[placeholder="Add a property"]',
            '.notion-page-content [role="table"]',

            // Collection 관련
            '.notion-collection-item',
            '.notion-collection-view',

            // Table/Database 관련
            '[role="row"]',
            '[role="cell"]',
            '.notion-table_view',

            // 새로운 Notion UI
            '[data-testid="page-header"]',
            '[data-testid="page-properties"]',

            // Property 관련 요소들
            '.notion-property',
            '.property-',
            '[class*="property"]',

            // 페이지 타이틀과 메타 정보
            '.notion-page-block',
            '.notion-page-content',

            // 더 일반적인 데이터베이스 페이지 표시자
            '[class*="database"]',
            '[class*="collection"]',
            '[data-block-id]'
        ];

        const foundElements = [];
        let foundCount = 0;

        for (const selector of dbIndicators) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                foundElements.push(`${selector}: ${elements.length}개`);
                foundCount++;
            }
        }

        console.log('🔍 DB 표시자 검색 결과:', {
            url: currentUrl,
            hasPageId,
            foundCount,
            foundElements: foundElements.slice(0, 5), // 처음 5개만 표시
            totalSelectors: dbIndicators.length
        });

        // 3. 페이지 타입 추가 확인
        const pageContent = document.querySelector('.notion-page-content');
        const hasPageContent = !!pageContent;

        // 4. 더 관대한 최종 판단
        // URL에 페이지 ID가 있고, DOM 요소가 하나라도 있거나 페이지 콘텐츠가 있으면 DB 아이템으로 간주
        const isDbItem = hasPageId && (foundCount > 0 || hasPageContent);

        // 5. URL 기반으로만 판단하는 폴백 (DOM이 아직 로드되지 않았을 수 있음)
        const isLikelyDbPage = hasPageId && currentUrl.includes('-') && /[a-f0-9]{32}/.test(currentUrl);

        const finalDecision = isDbItem || isLikelyDbPage;

        console.log('🏷️ 최종 DB 아이템 판단:', {
            hasPageId,
            foundCount,
            hasPageContent,
            isLikelyDbPage,
            결과: finalDecision ? '✅ DB 아이템' : '❌ 일반 페이지'
        });

        return finalDecision;
    }

    // Background Script를 통한 조회수 추적
    async trackView(pageId) {
        if (this.trackedPages.has(pageId)) {
            console.log('⏭️ 이미 추적된 페이지:', pageId);
            return;
        }

        try {
            console.log('🚀 Background Script를 통한 조회수 증가 요청');

            const response = await this.sendMessageToBackground('incrementViews', {
                apiEndpoint: this.apiEndpoint,
                apiKey: this.apiKey,
                pageId: pageId,
                databaseId: this.databaseId
            });

            if (response.success) {
                const result = response.data;
                this.trackedPages.add(pageId);
                this.showNotification(`✅ 조회수 증가: ${result.new_views}`, 'success');
                console.log('🎯 조회수 추적 성공:', result);
                this.displayViewCount(result.new_views);

                // 마지막 추적 시각 저장
                if (chrome.storage && chrome.storage.sync) {
                    await chrome.storage.sync.set({ lastTracked: new Date().toISOString() });
                }
            } else {
                console.error('❌ 조회수 추적 실패:', response.error);
                this.showNotification(`❌ ${response.error}`, 'error');
            }

        } catch (error) {
            console.error('💥 Background Script 통신 오류:', error);
            this.showNotification('💥 시스템 오류', 'error');
        }
    }

    // Background Script와 통신하는 헬퍼 함수
    async sendMessageToBackground(action, data) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { action: action, data: data },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                }
            );
        });
    }

    // 수동 테스트 함수들
    async forceTrackView() {
        const pageId = this.extractPageId(window.location.href);
        if (!pageId) {
            console.error('❌ 페이지 ID를 찾을 수 없습니다');
            this.showNotification('❌ 페이지 ID 없음', 'error');
            return;
        }

        console.log('🚀 수동 조회수 추적 강제 실행:', pageId);
        this.showNotification('🚀 수동 추적 시작...', 'info');

        await this.trackView(pageId);
    }

    debugDOM() {
        console.log('🔍 DOM 디버깅 시작');

        const allSelectors = [
            '[data-testid="properties"]',
            '[placeholder="Add a property"]',
            '.notion-collection-item',
            '[role="row"]',
            '[role="cell"]',
            '.notion-page-content',
            '[data-testid="page-header"]',
            '.notion-property',
            '[class*="property"]',
            '[class*="database"]',
            '[data-block-id]'
        ];

        const results = {};
        let totalFound = 0;

        allSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            results[selector] = elements.length;
            totalFound += elements.length;

            if (elements.length > 0) {
                console.log(`✅ ${selector}: ${elements.length}개`, elements[0]);
            }
        });

        console.log('📊 DOM 검색 결과 요약:', {
            totalSelectors: allSelectors.length,
            totalElements: totalFound,
            results
        });

        return results;
    }

    showPageInfo() {
        const info = {
            url: window.location.href,
            hostname: window.location.hostname,
            pageId: this.extractPageId(window.location.href),
            isDbItem: this.isPossiblyDbItem(),
            settings: {
                apiEndpoint: this.apiEndpoint,
                hasApiKey: !!this.apiKey,
                databaseId: this.databaseId,
                isEnabled: this.isEnabled
            }
        };

        console.log('📄 페이지 정보:', info);
        this.showNotification(`페이지: ${info.isDbItem ? 'DB 아이템' : '일반 페이지'}`, 'info');

        return info;
    }

    observeUrlChanges() {
        let lastUrl = window.location.href;
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = (...args) => {
            originalPushState.apply(history, args);
            setTimeout(() => this.handleUrlChange(lastUrl), 100);
            lastUrl = window.location.href;
        };

        history.replaceState = (...args) => {
            originalReplaceState.apply(history, args);
            setTimeout(() => this.handleUrlChange(lastUrl), 100);
            lastUrl = window.location.href;
        };

        window.addEventListener('popstate', () => {
            setTimeout(() => this.handleUrlChange(lastUrl), 100);
            lastUrl = window.location.href;
        });
    }

    handleUrlChange(oldUrl) {
        const newUrl = window.location.href;
        if (oldUrl !== newUrl) {
            console.log('🔄 URL 변경 감지:', newUrl);
            setTimeout(() => this.checkCurrentPage(), 500);
        }
    }

    observeClicks() {
        document.addEventListener('click', (event) => {
            const target = event.target.closest('a');
            if (target && target.href && target.href.includes('notion')) {
                setTimeout(() => this.checkCurrentPage(), 1000);
            }
        });
    }

    displayViewCount(views) {
        const existingCounter = document.getElementById('notion-views-counter');
        if (existingCounter) existingCounter.remove();

        const counter = document.createElement('div');
        counter.id = 'notion-views-counter';
        counter.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #2eaadc;
          color: white;
          padding: 8px 15px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: bold;
          z-index: 9999;
          box-shadow: 0 2px 10px rgba(0,0,0,0.2);
          animation: slideIn 0.3s ease-out;
        `;
        counter.innerHTML = `👁️ 조회수: ${views}`;
        document.body.appendChild(counter);

        setTimeout(() => {
            if (counter.parentNode) {
                counter.style.animation = 'slideOut 0.3s ease-in';
                setTimeout(() => counter.remove(), 300);
            }
        }, 3000);

        if (!document.getElementById('notion-tracker-styles')) {
            const styles = document.createElement('style');
            styles.id = 'notion-tracker-styles';
            styles.textContent = `
              @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
              @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
            `;
            document.head.appendChild(styles);
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.style.cssText = `
          position: fixed;
          top: 70px;
          right: 20px;
          padding: 10px 15px;
          border-radius: 5px;
          color: white;
          font-size: 13px;
          z-index: 10000;
          max-width: 250px;
          ${type === 'success' ? 'background: #28a745;' : ''}
          ${type === 'error' ? 'background: #dc3545;' : ''}
          ${type === 'info' ? 'background: #17a2b8;' : ''}
          animation: slideIn 0.3s ease-out;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }
}

// 초기화
if (window.location.hostname.includes('notion')) {
    console.log('🌐 Notion 페이지 감지 (완전 버전)');

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('📄 DOM 로드 완료 - 트래커 시작');
            window.notionTracker = new NotionViewsTracker();
        });
    } else {
        console.log('📄 DOM 이미 로드됨 - 트래커 시작');
        window.notionTracker = new NotionViewsTracker();
    }
} else {
    console.log('❌ Notion 페이지 아님:', window.location.hostname);
}