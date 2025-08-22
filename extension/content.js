// content.js - CSP 우회를 위해 Background Script 사용

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
        console.log('🎯 Notion Views Tracker 초기화 (Background Script 버전)');

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

            console.log('🎯 Notion Views Tracker 활성화됨 (CSP 우회)');
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

    isPossiblyDbItem() {
        if (!(location.hostname.includes('notion.so') || location.hostname.includes('notion.site') || location.hostname.includes('notion.com'))) {
            return false;
        }

        // 더 정확한 선택자들 사용
        const indicators = [
            document.querySelector('[data-testid="properties"]'),
            document.querySelector('[placeholder="Add a property"]'),
            document.querySelector('.notion-collection-item'),
            document.querySelector('[role="row"]'),
            document.querySelector('.notion-page-content .notion-collection-item')
        ];

        const found = indicators.some(el => !!el);
        console.log('🏷️ DB 아이템 인식:', found);
        return found;
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
    console.log('🌐 Notion 페이지 감지 (Background Script 버전)');

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('📄 DOM 로드 완료 - Background Script 트래커 시작');
            window.notionTracker = new NotionViewsTracker();
        });
    } else {
        console.log('📄 DOM 이미 로드됨 - Background Script 트래커 시작');
        window.notionTracker = new NotionViewsTracker();
    }
} else {
    console.log('❌ Notion 페이지 아님:', window.location.hostname);
}