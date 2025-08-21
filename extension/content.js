// content.js - 수정된 버전
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
        await this.loadSettings();

        chrome.runtime.onMessage.addListener((msg) => {
            if (msg?.action === 'settingsUpdated' && msg.settings) {
                this.apiEndpoint = this.normalizeEndpoint(msg.settings.apiEndpoint || this.apiEndpoint);
                this.apiKey = msg.settings.apiKey || this.apiKey;
                this.isEnabled = msg.settings.isEnabled ?? this.isEnabled;
                this.databaseId = msg.settings.databaseId || this.databaseId;
                this.checkCurrentPage();
            }
        });

        this.checkCurrentPage();
        this.observeUrlChanges();
        this.observeClicks();

        console.log('🎯 Notion Views Tracker 활성화됨');
    }

    normalizeEndpoint(ep) {
        if (!ep) return '';
        return ep.replace(/\/+$/, '');
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['apiEndpoint', 'apiKey', 'isEnabled', 'databaseLink', 'databaseId']);
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
        } catch (error) {
            console.log('설정 로드 실패, 기본값 사용', error);
        }
    }

    checkCurrentPage() {
        if (!this.isEnabled || !this.apiKey || !this.apiEndpoint) return;

        const currentUrl = window.location.href;
        const pageId = this.extractPageId(currentUrl);

        if (pageId && this.isPossiblyDbItem() && !this.trackedPages.has(pageId)) {
            this.trackView(pageId);
        }
    }

    // ✅ 수정된 Page ID 추출 함수
    extractPageId(url) {
        // 1. URL 파라미터에서 p= 값 우선 확인
        try {
            const urlObj = new URL(url);
            const pageIdFromParam = urlObj.searchParams.get('p');

            if (pageIdFromParam && /^[a-f0-9]{32}$/i.test(pageIdFromParam)) {
                // 32자리를 하이픈 포함 형태로 변환
                return `${pageIdFromParam.slice(0, 8)}-${pageIdFromParam.slice(8, 12)}-${pageIdFromParam.slice(12, 16)}-${pageIdFromParam.slice(16, 20)}-${pageIdFromParam.slice(20)}`;
            }
        } catch (error) {
            // URL 파싱 실패 시 무시하고 계속
        }

        // 2. 기존 방식으로 폴백 (32자리 및 하이픈 포함 UUID)
        const match = url.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        return match ? match[1] : null;
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

    // ✅ 수정된 DB 아이템 감지 함수
    isPossiblyDbItem() {
        if (!(location.hostname.includes('notion.so') || location.hostname.includes('notion.site') || location.hostname.includes('notion.com'))) {
            return false;
        }

        // 더 정확한 선택자들 사용
        const indicators = [
            document.querySelector('[data-testid="properties"]'),
            document.querySelector('[placeholder="Add a property"]'),
            document.querySelector('.notion-collection-item'), // 이것이 현재 페이지에서 발견됨
            document.querySelector('[role="row"]'), // 이것도 발견됨
            document.querySelector('.notion-page-content .notion-collection-item')
        ];

        return indicators.some(el => !!el);
    }

    async trackView(pageId) {
        if (this.trackedPages.has(pageId)) return;

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.apiKey) headers['X-API-Key'] = this.apiKey;

            const body = { page_id: pageId };
            if (this.databaseId) body.database_id = this.databaseId;

            console.log('🚀 조회수 추적 시작:', { pageId, apiEndpoint: this.apiEndpoint });

            const response = await fetch(`${this.apiEndpoint}/increment_views`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });

            if (response.ok) {
                const result = await response.json();
                this.trackedPages.add(pageId);
                this.showNotification(`✅ 조회수 증가: ${result.new_views}`, 'success');
                console.log('🎯 조회수 추적 성공:', result);
                this.displayViewCount(result.new_views);

                await chrome.storage.sync.set({ lastTracked: new Date().toISOString() });
            } else {
                const errText = await response.text().catch(() => '');
                console.error('조회수 추적 실패:', response.status, errText);
                this.showNotification(`❌ 조회수 추적 실패 (${response.status})`, 'error');
            }
        } catch (error) {
            console.error('API 호출 오류:', error);
            this.showNotification('🔌 API 서버 연결 실패', 'error');
        }
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

// Notion 페이지에서만 실행
if (window.location.hostname.includes('notion')) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new NotionViewsTracker());
    } else {
        new NotionViewsTracker();
    }
}