// 전역 변수
let selectedAddressData = null;
const API_KEY = '07887a9d4f6b1509b530798e1b5b86a1e1b6e4f5aacc26994fd1fd73cbcebefb';

// 주소 검색 (카카오 우편번호 서비스)
function searchAddress() {
  new daum.Postcode({
    oncomplete: function(data) {
      // 선택한 주소 정보 저장
      selectedAddressData = {
        address: data.address,
        jibunAddress: data.jibunAddress || data.autoJibunAddress,
        roadAddress: data.roadAddress,
        bcode: data.bcode,
        sigunguCode: data.sigunguCode,
        bname: data.bname,
        buildingName: data.buildingName
      };

      // 주소 표시
      document.getElementById('addressInput').value = data.address;
      const selectedAddressDiv = document.getElementById('selectedAddress');
      selectedAddressDiv.innerHTML = `
        <strong>선택된 주소</strong><br>
        도로명: ${data.roadAddress || '-'}<br>
        지번: ${data.jibunAddress || data.autoJibunAddress || '-'}<br>
        법정동코드: ${data.bcode}
      `;
      selectedAddressDiv.classList.add('show');
    }
  }).open();
}

// 건축물대장 조회 (3가지 동시 조회)
async function searchBuilding() {
  if (!selectedAddressData) {
    alert('주소를 먼저 검색해주세요.');
    return;
  }

  showLoading(true);
  clearResult();

  try {
    const bcode = selectedAddressData.bcode;
    const sigunguCd = bcode.substring(0, 5);
    const bjdongCd = bcode.substring(5, 10);
    const jibunInfo = extractJibun(selectedAddressData.jibunAddress);

    // 3가지 API 동시 호출
    const [titleResult, floorResult, generalResult] = await Promise.all([
      fetchBrTitleInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo),
      fetchBrFlrOulnInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo),
      fetchBrRecapTitleInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo)
    ]);

    displayAllResults(titleResult, floorResult, generalResult);
  } catch (error) {
    console.error('API 호출 오류:', error);
    showError('조회 중 오류가 발생했습니다: ' + error.message);
  } finally {
    showLoading(false);
  }
}

// 지번 주소에서 번지 추출
function extractJibun(jibunAddress) {
  if (!jibunAddress) return { bun: '', ji: '' };
  const match = jibunAddress.match(/(\d+)(?:-(\d+))?(?:\s|$)/);
  if (match) {
    return {
      bun: match[1] || '',
      ji: match[2] || ''
    };
  }
  return { bun: '', ji: '' };
}

// 표제부 조회 API
async function fetchBrTitleInfo(apiKey, sigunguCd, bjdongCd, jibunInfo) {
  const url = new URL('https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo');
  url.searchParams.append('serviceKey', apiKey);
  url.searchParams.append('sigunguCd', sigunguCd);
  url.searchParams.append('bjdongCd', bjdongCd);
  url.searchParams.append('platGbCd', '0');
  if (jibunInfo.bun) url.searchParams.append('bun', jibunInfo.bun.padStart(4, '0'));
  if (jibunInfo.ji) url.searchParams.append('ji', jibunInfo.ji.padStart(4, '0'));
  url.searchParams.append('numOfRows', '100');
  url.searchParams.append('pageNo', '1');
  url.searchParams.append('_type', 'json');

  const response = await fetch(url);
  return await response.json();
}

// 층별 조회 API
async function fetchBrFlrOulnInfo(apiKey, sigunguCd, bjdongCd, jibunInfo) {
  const url = new URL('https://apis.data.go.kr/1613000/BldRgstHubService/getBrFlrOulnInfo');
  url.searchParams.append('serviceKey', apiKey);
  url.searchParams.append('sigunguCd', sigunguCd);
  url.searchParams.append('bjdongCd', bjdongCd);
  url.searchParams.append('platGbCd', '0');
  if (jibunInfo.bun) url.searchParams.append('bun', jibunInfo.bun.padStart(4, '0'));
  if (jibunInfo.ji) url.searchParams.append('ji', jibunInfo.ji.padStart(4, '0'));
  url.searchParams.append('numOfRows', '100');
  url.searchParams.append('pageNo', '1');
  url.searchParams.append('_type', 'json');

  const response = await fetch(url);
  return await response.json();
}

// 총괄표제부 조회 API
async function fetchBrRecapTitleInfo(apiKey, sigunguCd, bjdongCd, jibunInfo) {
  const url = new URL('https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo');
  url.searchParams.append('serviceKey', apiKey);
  url.searchParams.append('sigunguCd', sigunguCd);
  url.searchParams.append('bjdongCd', bjdongCd);
  url.searchParams.append('platGbCd', '0');
  if (jibunInfo.bun) url.searchParams.append('bun', jibunInfo.bun.padStart(4, '0'));
  if (jibunInfo.ji) url.searchParams.append('ji', jibunInfo.ji.padStart(4, '0'));
  url.searchParams.append('numOfRows', '100');
  url.searchParams.append('pageNo', '1');
  url.searchParams.append('_type', 'json');

  const response = await fetch(url);
  return await response.json();
}

// 모든 결과 표시
function displayAllResults(titleData, floorData, generalData) {
  const resultDiv = document.getElementById('result');
  const copySection = document.getElementById('copySection');

  let html = '';
  let hasResult = false;

  // 총괄표제부
  const generalItems = extractItems(generalData);
  if (generalItems.length > 0) {
    hasResult = true;
    html += renderGeneralCard(generalItems);
  }

  // 표제부
  const titleItems = extractItems(titleData);
  if (titleItems.length > 0) {
    hasResult = true;
    html += renderTitleCard(titleItems);
  }

  // 층별
  const floorItems = extractItems(floorData);
  if (floorItems.length > 0) {
    hasResult = true;
    html += renderFloorCard(floorItems);
  }

  if (!hasResult) {
    html = '<div class="no-result">조회 결과가 없습니다.</div>';
    copySection.style.display = 'none';
  } else {
    copySection.style.display = 'block';
  }

  resultDiv.innerHTML = html;
}

// API 응답에서 items 추출
function extractItems(data) {
  if (!data?.response?.header || data.response.header.resultCode !== '00') {
    return [];
  }
  const body = data.response.body;
  if (!body?.items?.item) return [];
  return Array.isArray(body.items.item) ? body.items.item : [body.items.item];
}

// 날짜 포맷팅 (YYYYMMDD -> YYYY.MM.DD)
function formatDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return '-';
  return `${dateStr.substring(0, 4)}.${dateStr.substring(4, 6)}.${dateStr.substring(6, 8)}`;
}

// 총괄표제부 카드 렌더링
function renderGeneralCard(items) {
  const item = items[0]; // 총괄표제부는 보통 1개

  let html = `
    <div class="result-card highlight-card">
      <div class="card-header">
        <div class="card-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 17H15M9 13H15M9 9H10M17 21H7C5.89543 21 5 20.1046 5 19V5C5 3.89543 5.89543 3 7 3H12.5858C12.851 3 13.1054 3.10536 13.2929 3.29289L18.7071 8.70711C18.8946 8.89464 19 9.149 19 9.41421V19C19 20.1046 18.1046 21 17 21Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h3 class="card-title">총괄표제부</h3>
      </div>
      <div class="card-body">
        <div class="date-info">
          <div class="date-item">
            <span class="date-label">허가일</span>
            <span class="date-value">${formatDate(item.pmsDay)}</span>
          </div>
          <div class="date-item">
            <span class="date-label">착공일</span>
            <span class="date-value">${formatDate(item.stcnsDay)}</span>
          </div>
          <div class="date-item">
            <span class="date-label">사용승인일</span>
            <span class="date-value">${formatDate(item.useAprDay)}</span>
          </div>
        </div>
        <table class="result-table">
          <thead>
            <tr>
              <th>대지면적(㎡)</th>
              <th>건축면적(㎡)</th>
              <th>연면적(㎡)</th>
              <th>용적률(%)</th>
              <th>건폐율(%)</th>
              <th>세대수</th>
            </tr>
          </thead>
          <tbody>`;

  items.forEach(item => {
    html += `
            <tr>
              <td>${item.platArea ? Number(item.platArea).toLocaleString() : '-'}</td>
              <td>${item.archArea ? Number(item.archArea).toLocaleString() : '-'}</td>
              <td>${item.totArea ? Number(item.totArea).toLocaleString() : '-'}</td>
              <td>${item.vlRat || '-'}</td>
              <td>${item.bcRat || '-'}</td>
              <td>${item.hhldCnt || '-'}</td>
            </tr>`;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>`;
  return html;
}

// 표제부 카드 렌더링
function renderTitleCard(items) {
  let html = `
    <div class="result-card">
      <div class="card-header">
        <div class="card-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 21V5C19 3.89543 18.1046 3 17 3H7C5.89543 3 5 3.89543 5 5V21M19 21H5M19 21H21M5 21H3M9 7H10M9 11H10M14 7H15M14 11H15M9 21V16C9 15.4477 9.44772 15 10 15H14C14.5523 15 15 15.4477 15 16V21" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h3 class="card-title">표제부 (동별)</h3>
      </div>
      <div class="card-body">
        <table class="result-table">
          <thead>
            <tr>
              <th>동명칭</th>
              <th>주용도</th>
              <th>구조</th>
              <th>지상층수</th>
              <th>지하층수</th>
              <th>연면적(㎡)</th>
            </tr>
          </thead>
          <tbody>`;

  items.forEach(item => {
    html += `
            <tr>
              <td>${item.dongNm || '-'}</td>
              <td>${item.mainPurpsCdNm || '-'}</td>
              <td>${item.strctCdNm || '-'}</td>
              <td>${item.grndFlrCnt || '-'}</td>
              <td>${item.ugrndFlrCnt || '-'}</td>
              <td>${item.totArea ? Number(item.totArea).toLocaleString() : '-'}</td>
            </tr>`;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>`;
  return html;
}

// 층별 카드 렌더링
function renderFloorCard(items) {
  let html = `
    <div class="result-card">
      <div class="card-header">
        <div class="card-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 21H21M3 7V21M21 7V21M3 7L12 3L21 7M9 10H10M9 14H10M14 10H15M14 14H15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h3 class="card-title">층별 개요</h3>
      </div>
      <div class="card-body">
        <table class="result-table">
          <thead>
            <tr>
              <th>동명칭</th>
              <th>층구분</th>
              <th>층번호</th>
              <th>구조</th>
              <th>주용도</th>
              <th>면적(㎡)</th>
            </tr>
          </thead>
          <tbody>`;

  items.forEach(item => {
    html += `
            <tr>
              <td>${item.dongNm || '-'}</td>
              <td>${item.flrGbCdNm || '-'}</td>
              <td>${item.flrNo || '-'}</td>
              <td>${item.strctCdNm || '-'}</td>
              <td>${item.mainPurpsCdNm || '-'}</td>
              <td>${item.area ? Number(item.area).toLocaleString() : '-'}</td>
            </tr>`;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>`;
  return html;
}

// 로딩 표시
function showLoading(show) {
  document.getElementById('loading').style.display = show ? 'block' : 'none';
  document.getElementById('searchBtn').disabled = show;
}

// 결과 초기화
function clearResult() {
  document.getElementById('result').innerHTML = '';
  document.getElementById('copySection').style.display = 'none';
}

// 에러 표시
function showError(message) {
  document.getElementById('result').innerHTML = `<div class="error-message">${message}</div>`;
}

// 결과 복사
function copyResult() {
  const resultDiv = document.getElementById('result');
  const tables = resultDiv.querySelectorAll('table');

  if (tables.length === 0) {
    alert('복사할 결과가 없습니다.');
    return;
  }

  let text = '';
  const cards = resultDiv.querySelectorAll('.result-card');

  cards.forEach(card => {
    const title = card.querySelector('.card-title')?.textContent || '';
    text += `\n=== ${title} ===\n`;

    const table = card.querySelector('table');
    if (table) {
      const rows = table.querySelectorAll('tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('th, td');
        const rowData = Array.from(cells).map(cell => cell.textContent).join('\t');
        text += rowData + '\n';
      });
    }
  });

  navigator.clipboard.writeText(text.trim()).then(() => {
    alert('결과가 클립보드에 복사되었습니다.');
  }).catch(err => {
    console.error('복사 실패:', err);
    alert('복사에 실패했습니다. 브라우저 권한을 확인해주세요.');
  });
}
