// popup.js
document.addEventListener('DOMContentLoaded', function () {
    const apiEndpointInput = document.getElementById('apiEndpoint');
    const notionTokenInput = document.getElementById('notionToken');
    const databaseLinkInput = document.getElementById('databaseLink');
    const apiKeyInput = document.getElementById('apiKey');
    const registerBtn = document.getElementById('registerBtn');
    const testBtn = document.getElementById('testBtn');
    const status = document.getElementById('status');
    const apiKeySection = document.getElementById('apiKeySection');

    // 저장된 설정 로드
    chrome.storage.sync.get(['apiEndpoint', 'notionToken', 'databaseLink', 'apiKey'], function (result) {
        if (result.apiEndpoint) apiEndpointInput.value = result.apiEndpoint;
        if (result.notionToken) notionTokenInput.value = result.notionToken;
        if (result.databaseLink) databaseLinkInput.value = result.databaseLink;
        if (result.apiKey) {
            apiKeyInput.value = result.apiKey;
            apiKeySection.style.display = 'block';
        }
    });

    // API 키 발급
    registerBtn.addEventListener('click', async function () {
        const apiEndpoint = apiEndpointInput.value.trim();
        const notionToken = notionTokenInput.value.trim();
        const databaseLink = databaseLinkInput.value.trim();

        if (!apiEndpoint || !notionToken) {
            showStatus('API 서버 주소와 Notion 토큰을 입력해주세요.', 'error');
            return;
        }

        try {
            showStatus('API 키 발급 중...', 'info');
            registerBtn.disabled = true;

            const requestBody = { notion_token: notionToken };
            if (databaseLink) {
                const dbId = extractDatabaseId(databaseLink);
                if (dbId) requestBody.database_id = dbId;
            }

            const response = await fetch(`${apiEndpoint}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.api_key) {
                // 설정 저장
                await chrome.storage.sync.set({
                    apiEndpoint: apiEndpoint,
                    notionToken: notionToken,
                    databaseLink: databaseLink,
                    apiKey: data.api_key,
                    databaseId: requestBody.database_id || null
                });

                apiKeyInput.value = data.api_key;
                apiKeySection.style.display = 'block';
                showStatus('✅ API 키 발급 성공!', 'success');

                // Content script에 설정 업데이트 알림
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                    if (tabs[0] && tabs[0].url.includes('notion.so')) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            action: 'settingsUpdated',
                            settings: {
                                apiEndpoint: apiEndpoint,
                                apiKey: data.api_key,
                                isEnabled: true,
                                databaseId: requestBody.database_id || null
                            }
                        });
                    }
                });
            } else {
                throw new Error('API 키를 받지 못했습니다.');
            }
        } catch (error) {
            console.error('Registration error:', error);
            showStatus(`❌ 오류: ${error.message}`, 'error');
        } finally {
            registerBtn.disabled = false;
        }
    });

    // 연결 테스트
    testBtn.addEventListener('click', async function () {
        const apiEndpoint = apiEndpointInput.value.trim();

        if (!apiEndpoint) {
            showStatus('API 서버 주소를 입력해주세요.', 'error');
            return;
        }

        try {
            showStatus('연결 테스트 중...', 'info');
            testBtn.disabled = true;

            const response = await fetch(`${apiEndpoint}/health`);

            if (response.ok) {
                const data = await response.json();
                showStatus('✅ 서버 연결 성공!', 'success');
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('Test error:', error);
            showStatus(`❌ 연결 실패: ${error.message}`, 'error');
        } finally {
            testBtn.disabled = false;
        }
    });

    function showStatus(message, type) {
        status.textContent = message;
        status.className = `status ${type}`;
    }

    function extractDatabaseId(url) {
        if (!url) return null;
        const match = url.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (!match) return null;
        let id = match[1].toLowerCase();
        if (/^[a-f0-9]{32}$/.test(id)) {
            id = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
        }
        return id;
    }
});