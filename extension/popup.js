document.addEventListener('DOMContentLoaded', async () => {
    const apiEndpointInput = document.getElementById('apiEndpoint');
    const apiKeyInput = document.getElementById('apiKey');
    const databaseLinkInput = document.getElementById('databaseLink');
    const isEnabledInput = document.getElementById('isEnabled');
    const saveButton = document.getElementById('saveSettings');
    const testButton = document.getElementById('testConnection');
    const statusDiv = document.getElementById('status');
    const statsSection = document.getElementById('statsSection');
    const connectionStatus = document.getElementById('connectionStatus');
    const lastTracked = document.getElementById('lastTracked');

    // 설정 로드
    const settings = await chrome.storage.sync.get([
        'apiEndpoint', 'apiKey', 'isEnabled', 'lastTracked', 'databaseLink', 'databaseId'
    ]);

    apiEndpointInput.value = settings.apiEndpoint || 'https://web-production-ee075.up.railway.app';
    apiKeyInput.value = settings.apiKey || '';
    databaseLinkInput.value = settings.databaseLink || '';
    isEnabledInput.checked = settings.isEnabled !== false;
    lastTracked.textContent = settings.lastTracked || '없음';

    // 초기 연결 상태 확인
    checkConnection();

    saveButton.addEventListener('click', async () => {
        const newSettings = {
            apiEndpoint: normalizeEndpoint(apiEndpointInput.value.trim()),
            apiKey: apiKeyInput.value.trim(),
            isEnabled: isEnabledInput.checked,
            databaseLink: databaseLinkInput.value.trim()
        };

        if (!newSettings.apiEndpoint) return showStatus('API 서버 주소를 입력하세요.', 'error');
        if (!newSettings.apiKey) return showStatus('API 키를 입력하세요.', 'error');

        // DB 링크에서 database_id 파싱
        let databaseId = settings.databaseId || '';
        if (newSettings.databaseLink) {
            const parsed = extractDatabaseIdFromUrl(newSettings.databaseLink);
            if (!parsed) {
                showStatus('DB 링크에서 ID를 추출하지 못했습니다. 올바른 원본 DB 링크를 넣어주세요.', 'error');
                return;
            }
            databaseId = parsed;
        }

        try {
            await chrome.storage.sync.set({ ...newSettings, databaseId });
            showStatus('✅ 설정이 저장되었습니다!', 'success');

            // 활성 notion 탭에 설정 전달
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && tab.url.includes('notion')) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'settingsUpdated',
                        settings: { ...newSettings, databaseId }
                    });
                } catch (e) { console.log('탭 메시지 실패:', e); }
            }

            setTimeout(checkConnection, 800);
        } catch (error) {
            showStatus('❌ 설정 저장 실패', 'error');
        }
    });

    testButton.addEventListener('click', checkConnection);

    async function checkConnection() {
        const endpoint = normalizeEndpoint(apiEndpointInput.value.trim());
        const apiKey = apiKeyInput.value.trim();
        if (!endpoint) {
            connectionStatus.textContent = '❌ 주소 없음';
            connectionStatus.style.color = '#dc3545';
            return;
        }
        connectionStatus.textContent = '🔄 확인 중...';
        connectionStatus.style.color = '#6c757d';

        try {
            const headers = {};
            if (apiKey) headers['X-API-Key'] = apiKey;
            const res = await fetch(`${endpoint}/stats`, { headers });
            if (res.ok) {
                const stats = await res.json().catch(() => ({}));
                connectionStatus.textContent = '🟢 연결됨';
                connectionStatus.style.color = '#28a745';
                updateStats(stats);
                showStatus('✅ API 서버 연결 성공!', 'success');
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (err) {
            connectionStatus.textContent = '🔴 연결 실패';
            connectionStatus.style.color = '#dc3545';
            showStatus(`❌ 연결 실패: ${err.message}`, 'error');
        }
    }

    function updateStats(stats) {
        statsSection.style.display = 'block';
        // 기존 항목 지우고 다시
        const items = statsSection.querySelectorAll('.stat-item.extra');
        items.forEach(el => el.remove());

        if (stats.total_users !== undefined) {
            const userCount = document.createElement('div');
            userCount.className = 'stat-item extra';
            userCount.innerHTML = `<span>총 사용자:</span><span>${stats.total_users}</span>`;
            statsSection.appendChild(userCount);
        }
    }

    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        statusDiv.style.display = 'block';
        setTimeout(() => { statusDiv.style.display = 'none'; }, 3000);
    }

    function extractDatabaseIdFromUrl(url) {
        const m = url.match(/([a-f0-9]{32}|[a-f0-9-]{36})/i);
        if (!m) return null;
        let id = m[1].toLowerCase();
        if (/^[a-f0-9]{32}$/.test(id)) {
            id = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
        }
        return id;
    }

    function normalizeEndpoint(ep) {
        return ep.replace(/\/+$/, '');
    }

    // 30초마다 상태 체크
    setInterval(checkConnection, 30000);
});
