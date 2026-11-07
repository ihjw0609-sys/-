# SHADOW EXTRACTION — Online (GitHub 호스팅)

구성: **게임 화면 = GitHub Pages**, **계정/친구/파티 서버 = Render(무료)**. (GitHub Pages는 정적 파일만 올릴 수 있어 서버는 따로 필요)

## 1) GitHub 저장소 만들고 올리기
1. github.com → New repository (예: `shadow-extraction`, Public)
2. 이 폴더 전체를 업로드 (웹에서 "uploading an existing file"로 드래그하거나 git push)
   - `docs/index.html` 이 5MB라 웹 업로드는 파일이 많으면 느릴 수 있음 → git 권장:
         git init && git add . && git commit -m "init"
         git branch -M main && git remote add origin https://github.com/내아이디/shadow-extraction.git
         git push -u origin main

## 2) 서버 배포 (Render)
1. render.com 가입(GitHub로 로그인) → New + → **Web Service** → 위 저장소 선택
2. Runtime `Node`, Build Command 비움(또는 `echo ok`), Start Command `node server.js`, Instance Type `Free`
   (저장소에 `render.yaml`이 있어 Blueprint로 자동 설정도 가능)
3. 배포가 끝나면 `https://xxxx.onrender.com` 주소가 나옴 → `…/api/health` 열어서 `{"ok":true}` 확인
4. (권장) Environment에 `ALLOWED_ORIGINS` = `https://내아이디.github.io`

## 3) 게임 화면이 서버를 보게 하기
`docs/config.js` 를 수정해서 커밋/푸시:
    window.SE_SERVER = 'https://xxxx.onrender.com';

## 4) GitHub Pages 켜기
저장소 → Settings → Pages → Source: **GitHub Actions** (이 저장소의 `.github/workflows/pages.yml`이 자동 배포)
  또는 Source: Deploy from a branch → `main` / `/docs`
몇 분 뒤 `https://내아이디.github.io/shadow-extraction/` 로 접속. 친구에게 이 주소를 공유하면 끝.

## ⚠ 무료 서버의 제약
- Render 무료 서버는 15분 동안 접속이 없으면 잠들고, 다시 열 때 첫 접속이 30~60초 걸림.
- **무료 플랜은 디스크가 영구 저장이 아니라서 서버가 재시작/재배포되면 계정·세이브가 사라질 수 있음.**
  오래 쓰려면 ① Render 유료 플랜 + Disk(마운트 `/var/data`, 환경변수 `DATA_DIR=/var/data`) ② 저렴한 VPS ③ Fly.io 볼륨 중 택1.
  (게임 로컬 저장은 브라우저에도 남아 있지만, 계정 시스템은 서버 DB 기준)

## 수정 후 다시 빌드
게임(`src/game.html`)이나 `client/` 를 고쳤다면 `python3 build.py` → `docs/` 가 갱신됨 → 커밋/푸시.
`docs/config.js` 는 빌드가 덮어쓰지 않음.

## 로컬 테스트
    node server.js   →  http://localhost:3000   (서버가 docs/ 를 같이 서빙)


## 구조 (업데이트됨)
- `src/game.html`      원본 게임 (수정하지 않음 — 새 버전은 이 파일만 덮어쓰기)
- `patches.py`         빌드할 때 원본에 자동으로 적용되는 작은 수정들 (출혈/삽탄/고통/반동 표시 등). 게임이 바뀌어 일치하지 않는 항목은 빌드 로그에 `패치 건너뜀` 경고만 뜨고 나머지는 계속 적용됨
- `client/gameplay.js` 고통 연출, 레이드 중 한 발씩 삽탄, 반동 수치, 새 발소리
- `client/online.js`   로그인/친구/파티/맵 선택/로딩바/팀원 표시·적 피해 공유
- `server.js`          계정·친구·파티·레이드 중계 서버 (배포: Render)
