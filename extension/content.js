// content.js - Notion 페이지에서 실행되는 메인 스크립트
class NotionViewsTracker {
    constructor() {
        this.apiEndpoint = 'http://127.0.0.1:8000'; // 실제 배포 주소로 수정
        this.apiKey = '';
        this.trackedPages = new Set();
        this.isEnabled = true;

        this.init();
    }

    async init() {
        // 설정 로드
        await this.loadSettings();

        // 페이지 로드 시 즉시 확인
        this.checkCurrentPage();

        // URL 변경 감지 (Notion은 SPA이므로)
        this.observeUrlChanges();

        // 클릭 이벤트 감지
        this.observeClicks();

        console.log('🎯 Notion Views Tracker 활성화됨');
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['apiEndpoint', 'apiKey', 'isEnabled']);
            if (result.apiEndpoint) this.apiEndpoint = result.apiEndpoint;
            if (result.apiKey) this.apiKey = result.apiKey;
            if (result.isEnabled !== undefined) this.isEnabled = result.isEnabled;
        } catch (error) {
            console.log('설정 로드 실패, 기본값 사용');
        }
    }

    checkCurrentPage() {
        if (!this.isEnabled || !this.apiKey) return;

        const currentUrl = window.location.href;
        const pageId = this.extractPageId(currentUrl);

        if (pageId && this.isFromDatabase(currentUrl) && !this.trackedPages.has(pageId)) {
            this.trackView(pageId);
        }
    }

    extractPageId(url) {
        // Notion 페이지 URL에서 ID 추출
        // 예: https://www.notion.so/command-name-256e54b2d72f812db002f52b1eb14789
        const match = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
        return match ? match[1] : null;
    }

    isFromDatabase(url) {
        // 데이터베이스 항목인지 확인하는 로직
        return url.includes('notion.site') ||
            url.includes('notion.so') ||
            this.isDatabasePage();
    }

    isDatabasePage() {
        // 페이지 내용으로 데이터베이스 항목인지 확인
        const breadcrumb = document.querySelector('[data-testid="breadcrumb"]');
        if (breadcrumb) {
            const breadcrumbText = breadcrumb.textContent;
            return breadcrumbText.includes('SESAC') || breadcrumbText.includes('Data Engineer');
        }

        // 페이지 속성으로 확인
        const properties = document.querySelectorAll('[data-content-editable-leaf="true"]');
        for (const prop of properties) {
            if (prop.textContent.includes('명령어') || prop.textContent.includes('카테고리')) {
                return true;
            }
        }

        return false;
    }

    async trackView(pageId) {
        if (this.trackedPages.has(pageId)) return;

        try {
            const headers = {
                'Content-Type': 'application/json',
            };

            // API 키가 있으면 헤더에 추가
            if (this.apiKey) {
                headers['X-API-Key'] = this.apiKey;
            }

            const body = {
                page_id: pageId
            };

            // API 키가 없으면 notion_token을 body에 포함 (하위 호환성)
            if (!this.apiKey) {
                const notionToken = await this.getNotionToken();
                if (notionToken) {
                    body.notion_token = notionToken;
                }
            }

            const response = await fetch(`${this.apiEndpoint}/increment_views`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body)
            });

            if (response.ok) {
                const result = await response.json();
                this.trackedPages.add(pageId);

                // 성공 알림 표시
                this.showNotification(`✅ 조회수 증가: ${result.new_views}`, 'success');

                console.log('🎯 조회수 추적 성공:', result);

                // 선택적: 페이지에 조회수 표시
                this.displayViewCount(result.new_views);

            } else {
                console.error('조회수 추적 실패:', response.status);
                this.showNotification('❌ 조회수 추적 실패', 'error');
            }
        } catch (error) {
            console.error('API 호출 오류:', error);
            this.showNotification('🔌 API 서버 연결 실패', 'error');
        }
    }

    async getNotionToken() {
        // 하위 호환성을 위한 토큰 추출 (설정에서)
        try {
            const result = await chrome.storage.sync.get(['notionToken']);
            return result.notionToken;
        } catch (error) {
            return null;
        }
    }

    observeUrlChanges() {
        let lastUrl = window.location.href;

        // Notion의 pushState 감지
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

        // popstate 이벤트도 감지
        window.addEventListener('popstate', () => {
            setTimeout(() => this.handleUrlChange(lastUrl), 100);
            lastUrl = window.location.href;
        });
    }

    handleUrlChange(oldUrl) {
        const newUrl = window.location.href;
        if (oldUrl !== newUrl) {
            console.log('🔄 URL 변경 감지:', newUrl);
            setTimeout(() => this.checkCurrentPage(), 500); // DOM 업데이트 대기
        }
    }

    observeClicks() {
        // 페이지 내 링크 클릭 감지
        document.addEventListener('click', (event) => {
            const target = event.target.closest('a');
            if (target && target.href && target.href.includes('notion')) {
                const pageId = this.extractPageId(target.href);
                if (pageId && this.isFromDatabase(target.href)) {
                    // 클릭 후 잠시 대기 후 추적
                    setTimeout(() => this.checkCurrentPage(), 1000);
                }
            }
        });
    }

    displayViewCount(views) {
        // 기존 조회수 표시 제거
        const existingCounter = document.getElementById('notion-views-counter');
        if (existingCounter) {
            existingCounter.remove();
        }

        // 새 조회수 표시 생성
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

        // 3초 후 제거
        setTimeout(() => {
            if (counter.parentNode) {
                counter.style.animation = 'slideOut 0.3s ease-in';
                setTimeout(() => counter.remove(), 300);
            }
        }, 3000);

        // CSS 애니메이션 추가
        if (!document.getElementById('notion-tracker-styles')) {
            const styles = document.createElement('style');
            styles.id = 'notion-tracker-styles';
            styles.textContent = `
          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
          }
        `;
            document.head.appendChild(styles);
        }
    }

    showNotification(message, type = 'info') {
        // 간단한 토스트 알림
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
    // DOM이 완전히 로드된 후 실행
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            new NotionViewsTracker();
        });
    } else {
        new NotionViewsTracker();
    }
}