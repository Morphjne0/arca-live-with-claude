# 사진 일괄 첨부 방법 (검증됨, 2026-07)

사진 수와 무관하게 **총 5~6번의 도구 호출**로 끝나는 방식. 아카라이브 자체 다중 업로드 코드를 사용하므로 서버 입장에서 정상 사용과 동일하다 (직접 REST 호출 금지 — CSRF "Bad token" 400이 나고 WAF 오인 위험 있음).

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

5. **javascript_tool** — 업로드 완료 폴링 후 삽입 (`li.upload-image` 수 == 파일 수 확인):
   ```js
   document.querySelector(".multi-upload__insert-btn").click();
   ```

6. **javascript_tool** — 가독성 정리: 이미지마다 `<p>` 하나, 사이에 `<p><br></p>` 공백 줄:
   ```js
   // details 내부를 SUMMARY, P(img), P(빈줄), P(img), ... 구조로 재배열
   ```

## 실패했던 방법들 (재시도 금지)

- `file_upload` 도구: 세션에 공유된 파일만 허용 — 임의 로컬 경로 거부됨 (스크래치패드, .claude outputs 폴더 모두 거부).
- 한 장씩 클립보드+Ctrl+V 루프: 동작은 하지만 장당 3회 호출로 매우 느림.
- PowerShell SendKeys 일괄 루프: Froala가 삽입 이미지를 선택 상태로 유지해 다음 붙여넣기가 이미지를 **교체**함 → 마지막 1장만 남음.
- localhost 파일 서버 + 페이지 fetch: Chrome Local Network Access 정책으로 https 페이지에서 localhost fetch가 무한 대기.
- `/b/upload` 직접 POST: CSRF/token 필요("Bad token" 400), WAF 오인 위험 — 사용자가 금지함.
