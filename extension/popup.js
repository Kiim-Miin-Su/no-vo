document.addEventListener('DOMContentLoaded', async () => {
    const apiEndpointInput = document.getElementById('apiEndpoint');
    const apiKeyInput = document.getElementById('apiKey');
    const isEnabledInput = document.getElementById('isEnabled');
    const saveButton = document.getElementById('saveSettings');
    const testButton = document.getElementById('testConnection');
    const statusDiv = document.getElementById('status');
    const statsSection = document.getElementById('statsSection');
    const connectionStatus = document.getElementById('connectionStatus');
    const lastTracked = document.getElementById('lastTracked');

    // 설정 로드
    const settings = await chrome.storage.sync.get([
        'apiEndpoint',
        'apiKey',
        'isEnabled',
        'lastTracked'
    ]);

    apiEndpointInput.value = settings.apiEndpoint || 'https://your-api-domain.com';
    apiKeyInput.value = settings.apiKey || '';
    isEnabledInput.checked = settings.isEnabled !== false;
    lastTracked.textContent = settings.lastTracked || '없음';

    // 초기 연결 상태 확인
    checkConnection();

    // 설정 저장
    saveButton.addEventListener('click', async () => {
        const newSettings = {
            apiEndpoint: apiEndpointInput.value.trim(),
            apiKey: apiKeyInput.value.trim(),
            isEnabled: isEnabledInput.checked
        };

        // 입력 검증
        if (!newSettings.apiEndpoint) {
            showStatus('API 서버 주소를 입력하세요.', 'error');
            return;
        }

        if (!newSettings.apiKey) {
            showStatus('API 키를 입력하세요.', 'error');
            return;
        }

        try {
            await chrome.storage.sync.set(newSettings);
            showStatus('✅ 설정이 저장되었습니다!', 'success');

            // 활성 탭에 설정 변경 알림
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && tab.url.includes('notion')) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'settingsUpdated',
                        settings: newSettings
                    });
                } catch (error) {
                    console.log('탭에 메시지 전송 실패:', error);
                }
            }

            // 연결 상태 재확인
            setTimeout(checkConnection, 1000);

        } catch (error) {
            showStatus('❌ 설정 저장에 실패했습니다.', 'error');
        }
    });

    // 연결 테스트
    testButton.addEventListener('click', checkConnection);

    // 연결 상태 확인 함수
    async function checkConnection() {
        const endpoint = apiEndpointInput.value.trim();
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
            if (apiKey) {
                headers['X-API-Key'] = apiKey;
            }

            const response = await fetch(`${endpoint}/stats`, { headers });

            if (response.ok) {
                const stats = await response.json();
                connectionStatus.textContent = '🟢 연결됨';
                connectionStatus.style.color = '#28a745';

                // 통계 표시
                updateStats(stats);
                showStatus('✅ API 서버 연결 성공!', 'success');

            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            connectionStatus.textContent = '🔴 연결 실패';
            connectionStatus.style.color = '#dc3545';
            showStatus(`❌ 연결 실패: ${error.message}`, 'error');
        }
    }

    // 통계 업데이트
    function updateStats(stats) {
        statsSection.style.display = 'block';

        // 추가 통계 정보가 있다면 표시
        if (stats.total_users !== undefined) {
            const userCount = document.createElement('div');
            userCount.className = 'stat-item';
            userCount.innerHTML = `<span>총 사용자:</span><span>${stats.total_users}</span>`;
            statsSection.appendChild(userCount);
        }
    }

    // 상태 메시지 표시
    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        statusDiv.style.display = 'block';

        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }

    // 실시간 상태 업데이트 (30초마다)
    setInterval(checkConnection, 30000);
});

