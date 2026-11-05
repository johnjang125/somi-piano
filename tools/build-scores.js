// Mutopia Project의 MIDI(LilyPond로 만든 정확한 박자)를 앱이 쓰는 악보 데이터로 바꾼다.
// 사용: node build-scores.js <mutopia 작업 폴더> <출력 scores.json>
//  - <폴더>/selected.json : 고른 곡 목록(catalog 항목)
//  - <폴더>/midi/<id>.mid, <폴더>/ly/<id>.ly, <폴더>/z804/*.mid
const fs = require("fs"), path = require("path");
const [dir, outFile] = process.argv.slice(2);

/* ---------- MIDI 읽기 ---------- */
function parseMidi(buf){
  let p = 0; const u8 = () => buf[p++], u16 = () => (buf[p++]<<8)|buf[p++], u32 = () => (buf[p++]*2**24)+(buf[p++]<<16)+(buf[p++]<<8)+buf[p++];
  const vlq = () => { let v = 0, b; do { b = buf[p++]; v = v*128 + (b & 127); } while(b & 128); return v; };
  if(buf.toString("latin1",0,4) !== "MThd") throw new Error("not midi");
  p = 8; u16(); const ntr = u16(), div = u16(); p = 14;
  const tracks = [];
  for(let t=0; t<ntr; t++){
    while(buf.toString("latin1",p,p+4) !== "MTrk") p += 8 + buf.readUInt32BE(p+4);
    p += 4; const len = u32(), end = p + len; let tick = 0, run = 0; const ev = [];
    while(p < end){
      tick += vlq(); let st = buf[p];
      if(st & 128){ p++; if(st < 0xF0) run = st; } else st = run;
      if(st === 0xFF){ const type = u8(), l = vlq(), data = buf.slice(p, p+l); p += l; ev.push({tick, meta:type, data}); }
      else if(st === 0xF0 || st === 0xF7){ p += vlq(); }
      else { const hi = st & 0xF0, a = u8(), b = (hi===0xC0||hi===0xD0) ? 0 : u8(); ev.push({tick, st:hi, ch:st&15, a, b}); }
    }
    p = end; tracks.push(ev);
  }
  return {div, tracks};
}

/* ---------- 곡 하나 변환 ---------- */
function convert(file, lyText){
  const {div, tracks} = parseMidi(fs.readFileSync(file));
  let tempo = null, ts = null, key = null; const tsList = [];
  const perTrack = tracks.map(ev => {
    const on = {}, notes = [];
    ev.forEach(e => {
      if(e.meta === 0x51 && tempo == null) tempo = Math.round(60e6 / ((e.data[0]<<16)|(e.data[1]<<8)|e.data[2]));
      if(e.meta === 0x58){ tsList.push({tick:e.tick, num:e.data[0], den:2**e.data[1]}); if(!ts) ts = [e.data[0], 2**e.data[1]]; }
      if(e.meta === 0x59 && key == null){ const sf = e.data[0] > 127 ? e.data[0]-256 : e.data[0]; key = {sf, minor:!!e.data[1]}; }
      if(e.st === 0x90 && e.b > 0){ (on[e.a] = on[e.a] || []).push(e.tick); }
      else if(e.st === 0x80 || (e.st === 0x90 && e.b === 0)){ const s = on[e.a]?.shift(); if(s != null) notes.push([s, e.tick - s, e.a]); }
    });
    return notes;
  }).filter(n => n.length);
  if(!perTrack.length) return null;
  // 손 나누기: 평균 음높이가 가장 높은 트랙 = 오른손, 가장 낮은 트랙 = 왼손, 나머지는 가운데 도 기준
  const avg = n => n.reduce((a,x)=>a+x[2],0)/n.length, order = perTrack.map((n,i)=>[i,avg(n)]).sort((a,b)=>b[1]-a[1]);
  const notes = [];
  perTrack.forEach((n,i) => { const rank = order.findIndex(o=>o[0]===i);
    const hand = perTrack.length === 1 ? null : rank === 0 ? 0 : rank === order.length-1 ? 1 : (avg(n) >= 60 ? 0 : 1);
    n.forEach(([s,d,m]) => notes.push([s/div, d/div, m, hand ?? (m >= 60 ? 0 : 1)])); });
  notes.sort((a,b)=>a[0]-b[0] || b[2]-a[2]);
  // 못갖춘마디: LilyPond 원본의 첫 \partial 길이만큼 첫 마디를 짧게
  ts = ts || [4,4];
  let partial = 0; const pm = lyText && lyText.match(/\\partial\s+(\d+)(\.?)(\*\d+)?/);
  if(pm){ partial = 4/+pm[1] * (pm[2] ? 1.5 : 1) * (pm[3] ? +pm[3].slice(1) : 1); }
  const t0 = notes[0][0]; notes.forEach(n => n[0] -= t0);         // 첫 음을 0박에
  const total = Math.max(...notes.map(n=>n[0]+n[1]));
  // 마디 시작 박 목록 (박 = 4분음표 1개). 박자표가 바뀌면 따라간다.
  const changes = (tsList.length ? tsList : [{tick:0, num:ts[0], den:ts[1]}]).map(x => ({beat:x.tick/div - t0, len:x.num*4/x.den})).sort((a,b)=>a.beat-b.beat);
  const bars = []; let b = 0, ci = 0;
  if(partial && partial < changes[0].len - 1e-6){ bars.push(0); b = partial; }
  while(b < total - 1e-6){ while(ci+1 < changes.length && changes[ci+1].beat <= b + 1e-6) ci++; bars.push(+b.toFixed(4)); b += changes[ci].len; }
  return {tempo: tempo || 90, ts, key, bars, notes: notes.map(n => [+n[0].toFixed(4), +n[1].toFixed(4), n[2], n[3]])};
}

module.exports = {convert};
if(require.main !== module) return;

/* ---------- 곡 정보 (한국어 제목, 단계) ---------- */
const KO = {
  // 체르니
  ...Object.fromEntries([2060,2061,2062,2063,2066,2067,2068,2069,2072,2073,2076,2077,2078,2079,2081,2082,2083,2084,2085].map((id,i)=>[id,{t:`8마디 연습곡 ${i+1}번`, c:"체르니", o:`Op.821 No.${i+1}`, lv:1, set:"체르니 8마디 연습곡 Op.821"}])),
  ...Object.fromEntries([2146,2147,2148,2149,2150,2151,2152,2153,2154,2177].map((id,i)=>[id,{t:`멜로디 연습곡 ${i+1}번`, c:"체르니", o:`Op.840 No.${i+1}`, lv:2, set:"체르니 50 멜로디 연습곡 Op.840"}])),
  // 바흐 (안나 막달레나 바흐를 위한 음악 노트 등)
  74:{t:"미뉴에트 F장조", o:"BWV Anh.113", lv:1}, 75:{t:"미뉴에트 G장조", o:"BWV Anh.114", lv:1}, 76:{t:"미뉴에트 G단조", o:"BWV Anh.115", lv:2},
  77:{t:"미뉴에트 G장조", o:"BWV Anh.116", lv:2}, 1013:{t:"폴로네즈 F장조 (a)", o:"BWV Anh.117a", lv:1}, 1015:{t:"폴로네즈 F장조 (b)", o:"BWV Anh.117b", lv:1},
  1014:{t:"미뉴에트 B♭장조", o:"BWV Anh.118", lv:1}, 1016:{t:"폴로네즈 G단조", o:"BWV Anh.119", lv:2}, 1612:{t:"미뉴에트 A단조", o:"BWV Anh.120", lv:1},
  1613:{t:"미뉴에트 C단조", o:"BWV Anh.121", lv:1}, 1614:{t:"행진곡 E♭장조", o:"BWV Anh.127", lv:2}, 1615:{t:"폴로네즈 D단조", o:"BWV Anh.128", lv:2},
  767:{t:"아리아", o:"BWV Anh.131", lv:1}, 493:{t:"작은 전주곡 F장조", o:"BWV 928", lv:3},
  40:{t:"2성 인벤션 1번", o:"BWV 772", lv:3}, 67:{t:"2성 인벤션 4번", o:"BWV 775", lv:3}, 61:{t:"2성 인벤션 8번", o:"BWV 779", lv:3}, 59:{t:"2성 인벤션 13번", o:"BWV 784", lv:3},
  // 부르크뮐러 25 연습곡
  202:{t:"1. 솔직함 (순진한 마음)", n:1}, 203:{t:"2. 아라베스크", n:2}, 218:{t:"3. 목가", n:3}, 219:{t:"4. 작은 모임", n:4}, 214:{t:"5. 천진난만", n:5},
  215:{t:"6. 진보", n:6}, 216:{t:"7. 맑은 시냇물", n:7}, 217:{t:"8. 우아함", n:8}, 220:{t:"9. 사냥", n:9}, 221:{t:"10. 여린 꽃", n:10},
  222:{t:"11. 할미새", n:11}, 223:{t:"12. 이별", n:12}, 224:{t:"13. 위안", n:13}, 225:{t:"14. 슈타이어 춤곡", n:14}, 228:{t:"16. 작은 탄식", n:16},
  229:{t:"17. 수다쟁이", n:17}, 230:{t:"18. 불안", n:18},
  // 슈만 어린이를 위한 앨범
  647:{t:"1. 멜로디", n:1}, 650:{t:"2. 병정 행진곡", n:2}, 651:{t:"3. 콧노래", n:3}, 782:{t:"4. 코랄", n:4}, 653:{t:"5. 작은 곡", n:5},
  687:{t:"6. 가엾은 고아", n:6}, 691:{t:"7. 사냥의 노래", n:7}, 655:{t:"8. 용감한 기수", n:8}, 675:{t:"9. 민요", n:9}, 659:{t:"10. 즐거운 농부", n:10},
  783:{t:"11. 시칠리아노", n:11}, 784:{t:"12. 크네히트 루프레히트", n:12}, 662:{t:"13. 5월, 사랑스러운 5월", n:13}, 786:{t:"14. 작은 연습곡", n:14},
  676:{t:"16. 첫 번째 슬픔", n:16}, 663:{t:"18. 추수하는 사람의 노래", n:18},
  // 그 밖
  2032:{t:"아침 기도", c:"차이콥스키", o:"어린이 앨범 Op.39 No.1", lv:1}, 1806:{t:"나무 병정의 행진", c:"차이콥스키", o:"어린이 앨범 Op.39 No.5", lv:2},
  2080:{t:"옛 프랑스 노래", c:"차이콥스키", o:"어린이 앨범 Op.39 No.16", lv:1},
  931:{t:"엘리제를 위하여", c:"베토벤", o:"WoO 59", lv:3}, 904:{t:"미뉴에트", c:"베토벤", o:"WoO 82", lv:2},
  998:{t:"소나타 K.545 1악장", c:"모차르트", o:"K.545", lv:3},
  232:{t:"소나티네 1악장", c:"쿨라우", o:"Op.20 No.1", lv:2}, 233:{t:"소나티네 2악장", c:"쿨라우", o:"Op.20 No.1", lv:2}, 234:{t:"소나티네 3악장", c:"쿨라우", o:"Op.20 No.1", lv:2},
  2092:{t:"금빛 별 왈츠", c:"스트리보그", o:"Les étoiles d'or No.1", lv:1}, 37:{t:"짐노페디 1번", c:"사티", o:"", lv:2},
  2194:{t:"앨범의 한 장", c:"그리그", o:"서정 소품집 Op.12 No.7", lv:3}, 2162:{t:"루마니아 민속 춤곡 2번", c:"바르토크", o:"Sz.56", lv:2},
  263:{t:"엔터테이너", c:"조플린", o:"", lv:3}
};
const BURG_LV = n => n <= 5 ? 1 : n <= 10 ? 2 : 3, SCHU_LV = n => n <= 5 ? 1 : n <= 10 ? 2 : 3;

const sel = JSON.parse(fs.readFileSync(path.join(dir,"selected.json"),"utf8"));
const out = [], skipped = [];
for(const x of sel){
  const files = x.id === 804 ? [["sonatina-1.mid","1악장"],["sonatina-1-1.mid","2악장"],["sonatina-1-2.mid","3악장"]].map(([f,m])=>[path.join(dir,"z804",f),m]) : [[path.join(dir,"midi",`${x.id}.mid`),""]];
  const lyPath = path.join(dir,"ly",`${x.id}.ly`), ly = fs.existsSync(lyPath) ? fs.readFileSync(lyPath,"utf8") : "";
  files.forEach(([f,mv], k) => {
    if(!fs.existsSync(f)){ skipped.push(x.id); return; }
    const s = convert(f, k === 0 ? ly : "");
    if(!s){ skipped.push(x.id); return; }
    let info = KO[x.id] || {};
    const head = x.head.replace(/^"> /,"");
    if(/Burgm/.test(head)) info = {...info, c:"부르크뮐러", o:`25 연습곡 Op.100 No.${info.n}`, lv:BURG_LV(info.n), set:"부르크뮐러 25 연습곡 Op.100"};
    if(/Schumann/.test(head)) info = {...info, c:"슈만", o:`어린이를 위한 앨범 Op.68 No.${info.n}`, lv:SCHU_LV(info.n), set:"슈만 어린이를 위한 앨범 Op.68"};
    if(/Bach/.test(head)) info = {...info, c:"바흐", set: /Anh/.test(info.o) ? "안나 막달레나 바흐 노트" : /Invention|BWV 7[78]/.test(head) ? "2성 인벤션" : "바흐 소품"};
    if(x.id === 804) info = {t:`소나티네 1번 ${mv}`, c:"클레멘티", o:"Op.36 No.1", lv:2, set:"클레멘티 소나티네 Op.36"};
    const ftp = (x.mid || x.midz).replace(/\/[^/]+$/, "/");
    const lic = /Public Domain/.test(x.lic) ? "퍼블릭 도메인" : x.lic.replace("Creative Commons Attribution-ShareAlike","CC BY-SA").replace("Creative Commons Attribution","CC BY").trim();
    const repeats = /\\repeat\s+volta/.test(ly);   // 도돌이표가 있으면 MIDI는 반복을 펼친 순서라 마디 번호가 악보와 다를 수 있다
    out.push({id: x.id*10 + k, repeats, title: info.t || head.split(" by ")[0], composer: info.c || "", opus: info.o || "", set: info.set || "", level: info.lv || 2,
      license: lic, source: `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${x.id}`, pdf: ftp, ...s});
  });
}
out.sort((a,b)=>a.level-b.level || (a.set||a.composer).localeCompare(b.set||b.composer) || a.title.localeCompare(b.title, "ko", {numeric:true}));
fs.writeFileSync(outFile, JSON.stringify({about:"악보 데이터 출처: The Mutopia Project (www.mutopiaproject.org). 곡마다 license 항목의 조건(퍼블릭 도메인 또는 CC BY-SA)을 따릅니다. CC BY-SA 곡의 변환 데이터도 같은 조건으로 배포합니다.", pieces: out}));
console.log("pieces:", out.length, "skipped:", skipped, "bytes:", fs.statSync(outFile).size);
const lv = [1,2,3].map(l => out.filter(p=>p.level===l).length); console.log("by level:", lv);
out.slice(0,3).concat(out.filter(p=>p.id===9310)).forEach(p => console.log(p.id, p.title, p.composer, p.tempo, p.ts, "bars", p.bars.length, "notes", p.notes.length, "hands", [0,1].map(h=>p.notes.filter(n=>n[3]===h).length)));
