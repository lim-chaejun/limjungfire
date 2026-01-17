// 전역 변수
let selectedAddressData = null;
let currentTab = 'title';
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
        bcode: data.bcode, // 법정동코드 (10자리)
        sigunguCode: data.sigunguCode, // 시군구코드 (5자리)
        bname: data.bname, // 법정동명
        buildingName: data.buildingName
      };

      // 주소 표시
      document.getElementById('addressInput').value = data.address;
      const selectedAddressDiv = document.getElementById('selectedAddress');
      selectedAddressDiv.innerHTML = `
        <strong>선택된 주소:</strong><br>
        도로명: ${data.roadAddress || '-'}<br>
        지번: ${data.jibunAddress || data.autoJibunAddress || '-'}<br>
        법정동코드: ${data.bcode}
      `;
      selectedAddressDiv.classList.add('show');
    }
  }).open();
}

// 탭 전환
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
}

// 건축물대장 조회
async function searchBuilding() {
  if (!selectedAddressData) {
    alert('주소를 먼저 검색해주세요.');
    return;
  }

  showLoading(true);
  clearResult();

  try {
    // 법정동코드에서 시군구코드(5자리)와 법정동코드(5자리) 추출
    const bcode = selectedAddressData.bcode;
    const sigunguCd = bcode.substring(0, 5);
    const bjdongCd = bcode.substring(5, 10);

    // 지번 주소에서 번지 추출
    const jibunInfo = extractJibun(selectedAddressData.jibunAddress);

    let result;
    switch(currentTab) {
      case 'title':
        result = await fetchBrTitleInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo);
        break;
      case 'floor':
        result = await fetchBrFlrOulnInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo);
        break;
      case 'general':
        result = await fetchBrRecapTitleInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo);
        break;
    }

    displayResult(result, currentTab);
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

  // 예: "서울 강남구 역삼동 123-45" 에서 "123-45" 추출
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
  const data = await response.json();
  return data;
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
  const data = await response.json();
  return data;
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
  const data = await response.json();
  return data;
}

// 결과 표시
function displayResult(data, tab) {
  const resultDiv = document.getElementById('result');
  const copySection = document.getElementById('copySection');

  // API 응답 확인
  if (!data || !data.response) {
    showError('API 응답이 올바르지 않습니다.');
    return;
  }

  const header = data.response.header;
  if (header.resultCode !== '00') {
    showError(`API 오류: ${header.resultMsg}`);
    return;
  }

  const body = data.response.body;
  if (!body || !body.items || !body.items.item) {
    resultDiv.innerHTML = '<div class="no-result">조회 결과가 없습니다.</div>';
    return;
  }

  const items = Array.isArray(body.items.item) ? body.items.item : [body.items.item];

  let html = '';

  switch(tab) {
    case 'title':
      html = renderTitleResult(items);
      break;
    case 'floor':
      html = renderFloorResult(items);
      break;
    case 'general':
      html = renderGeneralResult(items);
      break;
  }

  resultDiv.innerHTML = html;
  copySection.style.display = 'block';
}

// 표제부 결과 렌더링
function renderTitleResult(items) {
  let html = '<h3 class="result-header">표제부(동별) 조회 결과</h3>';
  html += '<table class="result-table"><thead><tr>';
  html += '<th>동명칭</th><th>주용도</th><th>구조</th><th>지상층수</th><th>지하층수</th><th>연면적(㎡)</th>';
  html += '</tr></thead><tbody>';

  items.forEach(item => {
    html += '<tr>';
    html += `<td>${item.dongNm || '-'}</td>`;
    html += `<td>${item.mainPurpsCdNm || '-'}</td>`;
    html += `<td>${item.strctCdNm || '-'}</td>`;
    html += `<td>${item.grndFlrCnt || '-'}</td>`;
    html += `<td>${item.ugrndFlrCnt || '-'}</td>`;
    html += `<td>${item.totArea ? Number(item.totArea).toLocaleString() : '-'}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

// 층별 결과 렌더링
function renderFloorResult(items) {
  let html = '<h3 class="result-header">층별 조회 결과</h3>';
  html += '<table class="result-table"><thead><tr>';
  html += '<th>동명칭</th><th>층구분</th><th>층번호</th><th>구조</th><th>주용도</th><th>면적(㎡)</th>';
  html += '</tr></thead><tbody>';

  items.forEach(item => {
    html += '<tr>';
    html += `<td>${item.dongNm || '-'}</td>`;
    html += `<td>${item.flrGbCdNm || '-'}</td>`;
    html += `<td>${item.flrNo || '-'}</td>`;
    html += `<td>${item.strctCdNm || '-'}</td>`;
    html += `<td>${item.mainPurpsCdNm || '-'}</td>`;
    html += `<td>${item.area ? Number(item.area).toLocaleString() : '-'}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

// 총괄표제부 결과 렌더링
function renderGeneralResult(items) {
  let html = '<h3 class="result-header">총괄표제부 조회 결과</h3>';
  html += '<table class="result-table"><thead><tr>';
  html += '<th>대지면적(㎡)</th><th>건축면적(㎡)</th><th>연면적(㎡)</th><th>용적률(%)</th><th>건폐율(%)</th><th>세대수</th>';
  html += '</tr></thead><tbody>';

  items.forEach(item => {
    html += '<tr>';
    html += `<td>${item.platArea ? Number(item.platArea).toLocaleString() : '-'}</td>`;
    html += `<td>${item.archArea ? Number(item.archArea).toLocaleString() : '-'}</td>`;
    html += `<td>${item.totArea ? Number(item.totArea).toLocaleString() : '-'}</td>`;
    html += `<td>${item.vlRat || '-'}</td>`;
    html += `<td>${item.bcRat || '-'}</td>`;
    html += `<td>${item.hhldCnt || '-'}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
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
  const table = resultDiv.querySelector('table');

  if (!table) {
    alert('복사할 결과가 없습니다.');
    return;
  }

  // 테이블 데이터를 텍스트로 변환
  let text = '';
  const rows = table.querySelectorAll('tr');
  rows.forEach(row => {
    const cells = row.querySelectorAll('th, td');
    const rowData = Array.from(cells).map(cell => cell.textContent).join('\t');
    text += rowData + '\n';
  });

  navigator.clipboard.writeText(text).then(() => {
    alert('결과가 클립보드에 복사되었습니다.');
  }).catch(err => {
    console.error('복사 실패:', err);
    alert('복사에 실패했습니다. 브라우저 권한을 확인해주세요.');
  });
}
