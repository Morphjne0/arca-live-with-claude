# 사진/동영상 일괄 첨부 방법 (검증됨, 2026-07)

사진 수와 무관하게 **총 5~6번의 도구 호출**로 끝나는 방식 (단, 30장 이상 대량 업로드는 아래 '대량 업로드 주의' 참고 — 호출을 더 쪼개야 한다). 아카라이브 자체 다중 업로드 코드를 사용하므로 서버 입장에서 정상 사용과 동일하다 (직접 REST 호출 금지 — CSRF "Bad token" 400이 나고 WAF 오인 위험 있음).

## 원리

- 붙여넣기(paste) 이벤트의 `clipboardData.files`에는 클립보드에 복사된 **파일 전체**가 들어있다 (아카 기본 핸들러는 첫 장만 사용).
- paste를 capture 단계에서 가로채 파일들을 확보한 뒤, 에디터 "이미지 업로드" 팝업(`imagesMultiUpload`)의 다중 파일 input에 DataTransfer로 꽂고 change 이벤트를 쏘면 아카라이브 네이티브 코드가 전부 병렬 업로드한다.
- 업로드는 팝업 대기열(`li.upload-image`)에 쌓이고, **`.multi-upload__insert-btn`("삽입" 버튼) 클릭으로 커서 위치에 일괄 삽입**된다.

## 순서 (탭 ID는 글쓰기 페이지)

1. **PowerShell** — 사진 전체를 클립보드에 파일로 복사:
   ```powershell
   Add-Type -AssemblyName System.Windows.Forms
   $files = New-Object System.Collections.Specialized.StringCollection
   Get-ChildItem "<사진폴더>\*.jpg" | Sort-Object Name | ForEach-Object { [void]$files.Add($_.FullName) }
   [System.Windows.Forms.Clipboard]::SetFileDropList($files)
   ```

2. **javascript_tool** — paste 인터셉터 설치 + 에디터 포커스:
   ```js
   window.__files = null;
   window.__grab = (e) => {
     if (e.clipboardData && e.clipboardData.files.length > 0) {
       window.__files = [...e.clipboardData.files];
       e.preventDefault(); e.stopImmediatePropagation();
       document.removeEventListener("paste", window.__grab, true);
     }
   };
   document.addEventListener("paste", window.__grab, true);
   document.querySelector(".fr-element.fr-view").focus();
   ```

3. **computer(key)** — `ctrl+v` (실제 키 이벤트여야 클립보드 파일이 이벤트에 실림).

4. **javascript_tool** — 팝업 열기 → input에 파일 꽂기 → change:
   ```js
   // 네이티브 파일 픽커 억제 (필수: 안 하면 보이지 않는 OS 다이얼로그가 뜸)
   if (!window.__origClick) {
     window.__origClick = HTMLInputElement.prototype.click;
     HTMLInputElement.prototype.click = function () {
       if (this.type === "file") { window.__fileInput = this; return; }
       return window.__origClick.apply(this, arguments);
     };
   }
   const btn = document.querySelector('[data-cmd="imagesMultiUpload"]');
   for (const t of ["mousedown", "mouseup", "click"]) btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
   await new Promise(r => setTimeout(r, 500));
   // 커서를 목표 위치(해당 물품의 details > p)에 배치
   // ... (range/selection 설정)
   const inp = document.querySelector('.fr-popup input[type="file"][multiple]');
   const dt = new DataTransfer();
   window.__files.forEach(f => dt.items.add(f));
   inp.files = dt.files;
   inp.dispatchEvent(new Event("change", { bubbles: true }));
   ```

5. **javascript_tool** — 업로드 완료 폴링 후 삽입:
   - **완료 판정 (2026-07 검증)**: 대기열 썸네일은 `<img>`가 아니라 **background-image**로 그려진다. `li.querySelector('[style*="background"]')`가 있으면 완료, `li.className`에 `image-upload--error`가 있으면 실패. `done + errs === total`이 될 때까지 폴링한다.
   - **폴링 루프는 호출당 30초 이내로.** javascript_tool(CDP Runtime.evaluate)은 **45초에 타임아웃**되므로 90초짜리 루프를 한 호출에 넣으면 안 된다. 완료 안 됐으면 상태만 반환하고 다음 호출에서 이어 폴링.
   ```js
   document.querySelector(".multi-upload__insert-btn").click();
   ```

6. **javascript_tool** — 재배치 + 잔해 정리 (한 호출에서 전부):
   - 삽입 버튼은 이미지들을 **details 밖(같은 li 안)에 개별 `<p>`로** 넣는다. `<img>`만 details 안 새 `<p>`로 옮기면 **원래 래퍼 `<p>`들이 빈 채로 남고**, details가 쪼개져 **summary 없는 빈 details("세부정보" 접기)**가 생길 수 있다.
   - 따라서 이동 직후 반드시: (a) 옮기기 전 `img.parentElement`를 기억해뒀다가 빈 래퍼 제거, (b) li 직속의 빈 `<p>` 제거, (c) 이미지/영상/텍스트가 없는 빈 `<details>` 제거.
   ```js
   // details 내부를 SUMMARY, P(img), P(빈줄), P(img), ... 구조로 재배열
   ```

## 대량 업로드(30장 이상) 주의 (2026-07, 53장 검증)

- 수십 장 병렬 업로드 중 **렌더러가 수십 초 프리즈**할 수 있다 (CDP 타임아웃 연발). 죽은 게 아니므로 `computer(wait)`로 10초쯤 기다렸다 가벼운 JS로 재확인하면 돌아온다.
- 호출을 잘게 나눈다: ① 파일 주입(change까지)만 하고 즉시 반환 → ② 30초 이내 폴링 호출을 완료될 때까지 반복 → ③ 삽입 클릭 + 3초 대기 + img 수 반환 → ④ 재배치/정리/검증. 53장 기준 이 구조로 문제없이 완료됐다.

## 개별 파일 반복 실패 시 폴백 (검증됨)

- 특정 파일이 팝업 업로드에서 **에러(li에 `image-upload--error`, 닫기 버튼만 있음)** 나는 경우가 있다. 같은 파일은 팝업 재주입으로 올려도 **삽입 단계에서 조용히 누락**될 수 있다 (대기열 done 판정은 통과하는데 최종 img 수가 모자람).
- 폴백: 에러 li의 `.upload-image__close-btn` 클릭으로 제거 → 그 파일 하나만 클립보드에 복사 → **인터셉터 없이** 커서를 목표 위치에 두고 ctrl+v. 아카 기본 paste 핸들러(단일 파일 인라인 업로드)는 다른 코드 경로라서 성공한다.
- 삽입 후 img 수가 파일 수와 안 맞으면: 로컬 파일 해상도(orientation)를 `System.Drawing`으로 뽑아 DOM 순서와 시퀀스 대조하면 어느 파일이 빠졌는지 특정할 수 있다 (아카는 리사이즈하므로 비율로 비교).

## 동영상 업로드 (검증됨, 2026-07)

- 툴바 `[data-cmd="insertVideo"]`("동영상 삽입") 팝업에 파일 input이 있다: `accept="video/quicktime, video/webm, video/mp4"`, **단일 파일**(multiple 아님).
- **버튼이 `fr-disabled`일 수 있다.** 프로그래매틱 range 설정만으로는 안 풀리고, 목표 슬롯 요소에 **실제 mousedown/mouseup/click 이벤트를 쏘고** selection 설정 + `document.dispatchEvent(new Event('selectionchange'))` 후 0.5초 기다리면 활성화된다.
- 흐름: 영상 여러 개를 한 번에 클립보드 복사 → paste 인터셉트로 `File[]` 확보 (`f.name`으로 구분 가능) → 영상마다: 슬롯에 커서 배치(위 방식) → insertVideo 팝업 열기 → input에 DataTransfer 주입 + change → **업로드 완료 시 자동으로 커서 위치에 삽입됨** (이미지와 달리 삽입 버튼 없음). 완료 판정은 에디터 내 `video` 개수 증가 폴링.
- **같은 슬롯에 영상 2개를 순서대로 넣으면 순서가 뒤집힐 수 있다** (두 번째가 첫 번째 앞에 삽입됨). 로컬 파일 길이(PowerShell `Shell.Application`의 `GetDetailsOf(item, 27)`)와 페이지 `video.duration`을 대조해 확인하고, 뒤집혔으면 top-level 노드를 스왑한다.

## 기타 검증된 팁

- **innerHTML 주입 시 태그 사이 공백 → 빈 li**: 템플릿의 `</li>    <li>` 같은 공백 텍스트를 Froala가 빈 `<li>`로 만들어 목차에 빈 "1." 항목이 생긴다. 주입 후 텍스트/미디어 없는 li를 일괄 제거하거나, 조립 시 태그 사이 공백을 없앤다.
- **카테고리 select 매칭**: 옵션 텍스트가 `🛒더판/더구`처럼 이모지+슬래시 포함이므로 `replace(/[\s\/]/g,'')` 후 '더판더구' 포함 여부로 매칭한다.
- **필독 카드에 행을 중간 삽입하면 구분선이 어긋난다** (누락/이중). 행 추가 후에는 구분선(`border-top: 1px dashed`) div를 전부 제거하고 행 사이마다 하나씩 재생성하는 게 안전하다.
- **사용자가 에디터에서 직접 본문을 수정할 수 있다** (summary 문구, 헤딩명 등). 후속 작업 전에 셀렉터/텍스트 매칭을 항상 현재 DOM에서 재확인하고, 사용자가 바꾼 문구(예: 물품명)는 목차 등 연동 텍스트와 동기화해준다.
- 렌더러 프리즈 후 `computer(wait)`는 `duration` 최대 10초 제한이 있다.

## 실패했던 방법들 (재시도 금지)

- `file_upload` 도구: 세션에 공유된 파일만 허용 — 임의 로컬 경로 거부됨 (스크래치패드, .claude outputs 폴더 모두 거부).
- 한 장씩 클립보드+Ctrl+V 루프: 동작은 하지만 장당 3회 호출로 매우 느림 (단, 팝업 업로드가 반복 실패하는 개별 파일의 폴백으로는 유효 — 위 참고).
- PowerShell SendKeys 일괄 루프: Froala가 삽입 이미지를 선택 상태로 유지해 다음 붙여넣기가 이미지를 **교체**함 → 마지막 1장만 남음.
- localhost 파일 서버 + 페이지 fetch: Chrome Local Network Access 정책으로 https 페이지에서 localhost fetch가 무한 대기.
- `/b/upload` 직접 POST: CSRF/token 필요("Bad token" 400), WAF 오인 위험 — 사용자가 금지함.
- 이미지 다중 업로드 팝업 input에 **동영상**을 꽂는 것: accept가 이미지 전용 — 동영상은 insertVideo 팝업 사용 (위 참고).
