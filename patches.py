# -*- coding: utf-8 -*-
"""원본 게임(src/game.html)에 빌드 시점에 적용하는 작은 수정들.
각 항목: (이름, 찾을 문자열, 바꿀 문자열). 찾을 문자열은 파일에서 정확히 1번만 나와야 적용됩니다.
게임을 업데이트해서 해당 부분이 바뀌면 그 항목만 '건너뜀' 경고가 뜨고 나머지는 계속 적용됩니다."""

PATCHES = [
 # ---- 난수: 파티 레이드에서 같은 맵/같은 전리품을 만들 수 있게 시드 가능하도록 ----
 ("시드 난수",
  "const $=i=>document.getElementById(i),R=Math.random,CS=40",
  "let SRN=null;const $=i=>document.getElementById(i),R=()=>SRN?SRN():Math.random(),CS=40"),

 # ---- 레이드 중 삽탄: 한 발씩 + 쿨타임 (홈에서는 기존처럼 즉시) ----
 ("레이드 중 삽탄",
  "if(mg){const t=Math.min(I[mg.k][5].cap-mg.mag,it.n);mg.mag+=t;mg.am=it.k;it.n-=t;if(it.n<=0)ok=1}",
  "if(mg){if(mode==='raid'&&window.raidLoad)window.raidLoad(tc,mg,it);else{const t=Math.min(I[mg.k][5].cap-mg.mag,it.n);mg.mag+=t;mg.am=it.k;it.n-=t;if(it.n<=0)ok=1}}"),

 # ---- 출혈: 가벼운 출혈(1) / 큰 출혈(2) ----
 ("출혈 발생 확률",
  "if(!prot||R()<.3){if(R()<.25)P.bl=Math.max(P.bl,1);if(R()<.08)P.bl=2}",
  "if(!prot||R()<.3){if(R()<.09)P.bl=2;else if(R()<.32)P.bl=Math.max(P.bl,1)}"),
 ("출혈 피해량",
  "P.hp[k]=Math.max(0,P.hp[k]-P.bl*.7*dt)",
  "P.hp[k]=Math.max(0,P.hp[k]-(P.bl>1?1.5:.4)*dt)"),
 ("붕대=가벼운 출혈만", "a('car','차량 구급상자',1,1,'md',3000,{bl:1,", "a('car','차량 구급상자',1,1,'md',3000,{bl:2,"),
 ("Salewa 큰출혈", "a('sal','Salewa',1,2,'md',11000,{bl:1,", "a('sal','Salewa',1,2,'md',11000,{bl:2,"),
 ("IFAK 큰출혈", "a('ifak','IFAK',2,1,'md',9000,{bl:1,", "a('ifak','IFAK',2,1,'md',9000,{bl:2,"),
 ("Grizzly 큰출혈", "a('grizzly','Grizzly',2,2,'md',34000,{bl:1,", "a('grizzly','Grizzly',2,2,'md',34000,{bl:2,"),
 ("AFAK 큰출혈", "a('afak','AFAK',2,1,'md',18000,{bl:1,", "a('afak','AFAK',2,1,'md',18000,{bl:2,"),
 ("CMS 큰출혈", "a('cms','CMS',1,2,'md',9000,{bl:1,", "a('cms','CMS',1,2,'md',9000,{bl:2,"),
 ("진통제 효과", "a('analgin','진통제',1,1,'md',2000,{heal:25,u:4}", "a('analgin','진통제',1,1,'md',2000,{heal:25,pk:1,u:4}"),
 ("의료품 사용(출혈 등급/진통제)",
  "function useIt(it){if(A)return msg('다른 행동 중입니다');const o=I[it.k][5];act(",
  "function useIt(it){if(A)return msg('다른 행동 중입니다');const o=I[it.k][5];if(o.bl&&!o.heal&&o.bl<P.bl)return msg('큰 출혈은 붕대로 멎지 않습니다 (구급상자가 필요합니다)');act("),
 ("의료품 효과 적용",
  "if(o.bl)P.bl=0;if(o.sp)P.fr=0;",
  "if(o.bl&&o.bl>=P.bl)P.bl=0;if(o.pk&&window.painKill)window.painKill();if(o.sp)P.fr=0;"),
 ("H키 치료 선택",
  "f2=(i,k)=>k?I[i.k][5].bl:I[i.k][5].heal",
  "f2=(i,k)=>k?(I[i.k][5].bl||0)>=P.bl:I[i.k][5].heal"),

 # ---- 상태 표시 ----
 ("HUD 상태(홈)",
  "${P.bl?'<span style=\"color:#e55\">출혈 중</span> ':''}${P.fr?'<span style=\"color:#e90\">골절</span> ':''}${P.bl||P.fr?'':'이상 없음'}",
  "${P.bl?'<span style=\"color:#e55\">'+(P.bl>1?'큰 출혈':'가벼운 출혈')+'</span> ':''}${P.fr?'<span style=\"color:#e90\">골절</span> ':''}${P.pn>.05||P.pt>0?'<span style=\"color:#d9a441\">고통</span> ':''}${P.bl||P.fr||P.pn>.05||P.pt>0?'':'이상 없음'}"),
 ("HUD 상태(레이드)",
  "${P.bl?'<br><span style=\"color:#e55\">출혈 중 (H: 치료)</span>':''}",
  "${P.bl?'<br><span style=\"color:#e55\">'+(P.bl>1?'큰 출혈 (구급상자 H)':'가벼운 출혈 (붕대 H)')+'</span>':''}${P.pt>0||P.pn>.05?'<br><span style=\"color:#d9a441\">고통'+(P.pn>.4?' — 진통제 필요':'')+'</span>':''}${P.pk>0?'<br><span style=\"color:#8fa770\">진통제 효과 '+Math.ceil(P.pk)+'초</span>':''}"),
 ("건강 화면 효과 설명",
  "if(P.bl)ef.push(`<span style=\"color:#e55\">🩸 ${P.bl>1?'심한 출혈':'경미한 출혈'}</span> — 시간이 갈수록 체력 감소 (붕대/구급상자 H)`);",
  "if(P.bl)ef.push(P.bl>1?`<span style=\"color:#e55\">🩸 큰 출혈</span> — 체력이 빠르게 감소 (구급상자·IFAK 등 필요, 붕대로는 멎지 않음)`:`<span style=\"color:#e55\">🩸 가벼운 출혈</span> — 체력이 서서히 감소 (붕대 또는 구급상자)`);if(P.pt>0||P.pn>.05)ef.push(`<span style=\"color:#d9a441\">⚡ 고통</span> — ${P.pk>0?'진통제로 억제 중':'시야가 어두워지고 조준이 불안정 (진통제)'}`);"),

 # ---- 고통: 사격/조준 불편 ----
 ("고통-탄퍼짐",
  "+W.rc*.0015;d.x+=(R()-.5)*sp;",
  "+W.rc*.0015+(P.pn||0)*.007;d.x+=(R()-.5)*sp;"),
 ("고통-반동",
  "const rc=o.rec*(.009+R()*.007)*(W.ads?.7:1);",
  "const rc=o.rec*(.009+R()*.007)*(W.ads?.7:1)*(1+(P.pn||0)*.12);"),
 ("고통-손떨림",
  "sy=(W.ads?1.6:.6)*(P.st<30?2.2:1)*(1+wt/40);",
  "sy=(W.ads?1.6:.6)*(P.st<30?2.2:1)*(1+wt/40)*(1+(P.pn||0)*1.6);"),

 # ---- 상세 정보: 의료품 / 반동 수치 ----
 ("상세정보-출혈",
  "if(p.bl)s.push('출혈 치료');",
  "if(p.bl)s.push(p.bl>1?'경미·큰 출혈 모두 치료':'경미한 출혈만 치료 (큰 출혈 불가)');if(p.pk)s.push('고통 억제 (5분)');"),
 ("상세정보-반동",
  "if(p.rpm)s.push(`발사속도 ${p.rpm}RPM · ${p.auto?'단발/자동':'단발 전용'} · 반동 ${p.rec}`);",
  "if(p.rpm){s.push(`발사속도 ${p.rpm}RPM · ${p.auto?'단발/자동':'단발 전용'}`);if(window.recoilLines)s.push(...window.recoilLines(p))}"),

 # ---- 수류탄 시야 모델: 맵을 다시 만들어도 새 카메라에 붙도록 ----
 ("수류탄 모델 재부착",
  "if(!GV)buildGV();GR.on=1",
  "if(GV&&GV.parent!==camera)camera.add(GV);if(!GV)buildGV();GR.on=1"),

 # ---- 맵 빌드 분리 (파티 로딩 중 미리 만들기) ----
 ("맵 미리 빌드 함수",
  "startRaid=function(){if(builtMap!==MAP){BOX=[];ZN=[];LOOTS=[];EN=[];EXS=[];vmG={};WM={};built=0;MAP==='lab'?buildLab():_b();built=1;builtMap=MAP}\n  _sr();",
  "window.ensureBuilt=function(force){if(force||builtMap!==MAP){BOX=[];ZN=[];LOOTS=[];EN=[];EXS=[];vmG={};WM={};built=0;MAP==='lab'?buildLab():_b();built=1;builtMap=MAP}};\n startRaid=function(){ensureBuilt();\n  _sr();"),
]
