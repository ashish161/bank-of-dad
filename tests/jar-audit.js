// Playful compounding-jar visual/logic audit (headless browser).
// Renders the real app across scenarios and checks the rendered coins/ladder
// agree with an independent calculation. Requires puppeteer-core + @sparticuz/chromium.
// Run:  node jar-audit.js [path-to-bank-of-dad-app.html]
const puppeteer=require('puppeteer-core');const chromium=require('@sparticuz/chromium').default;
const path=require('path');
const APP='file://'+path.resolve(process.argv[2]||path.join(__dirname,'..','bank-of-dad-app.html'));
const YR=365*24*3600*1000;
const MILES=[1000,10000,100000,1000000,10000000];
const mLabel=v=>v>=1e7?'₹'+v/1e7+'Cr':v>=1e5?'₹'+v/1e5+'L':v>=1e3?'₹'+v/1e3+'k':'₹'+v;
const S=[
 ['fresh ₹0', []],
 ['₹750 saved today', [[750,0]]],
 ['₹5k saved 4y ago', [[5000,4]]],
 ['₹5k 4y then spend ₹3k', [[5000,4],[-3000,0]]],
 ['₹4L gift today', [[400000,0]]],
 ['near ₹10L', [[560000,6]]],
 ['over ₹10L', [[700000,6]]],
 ['de-level: ₹12k 2y then spend ₹6k', [[12000,2],[-6000,0]]],
 ['huge > ₹1Cr', [[1500000,4]]],
];
(async()=>{
  const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:[...chromium.args,'--no-sandbox','--disable-gpu'],headless:true});
  const pg=await b.newPage(); await pg.setViewport({width:420,height:1200,deviceScaleFactor:1});
  await pg.goto(APP,{waitUntil:'load'});
  let fails=0;
  for (const [name, spec] of S) {
    const now=Date.now();
    const entries=spec.map((e,i)=>({id:'e'+i, amount:e[0], note:'x', time:now-e[1]*YR}));
    const r = await pg.evaluate((entries)=>{
      const K='bankOfDad.state.v1';
      localStorage.setItem(K,JSON.stringify({children:[{id:'c1',name:'Test',birthdate:'2012-01-01',base:100,theme:'playful',upi:'',entries,lastPaid:Date.now(),lastTopUp:Date.now(),badgesAt:{},tasks:[]}],settings:{currency:'₹',base:100,rate:10,frequency:'daily',payCadence:'weekly'},pending:[],tasks:{},selectedChildId:'c1'}));
      window.loadState(); window.renderAccounts(); window.switchTab(null,'accounts');
      const L=window.buildLedger('2012-01-01', entries);
      return {L:{balance:L.balance,contributed:L.contributed,interest:L.interest,spent:L.spent},
        gold:document.querySelectorAll('#accounts-list .pcoin.g').length,
        green:document.querySelectorAll('#accounts-list .pcoin.i').length,
        cap:document.querySelector('#accounts-list .pjar-cap')?.textContent||'',
        rungs:[...document.querySelectorAll('#accounts-list .prung')].map(x=>({passed:x.classList.contains('passed'),current:x.classList.contains('current')}))};
    }, entries);
    const bal=Math.max(0,r.L.balance);
    const saved=Math.max(0,(r.L.contributed||0)-(r.L.spent||0));
    const interest=Math.max(0,bal-saved);
    const capacity=MILES.find(m=>m>bal)||MILES[MILES.length-1];
    const filled=Math.max(0,Math.min(100,Math.round(100*bal/capacity)));
    const goldE=bal>0?Math.min(filled,Math.round(filled*saved/bal)):0;
    const greenE=Math.max(0,filled-goldE);
    const checks=[['coins=filled',r.gold+r.green===filled],['gold',r.gold===goldE],['green',r.green===greenE],
      ['cap',r.cap.includes(mLabel(capacity))&&r.cap.includes(filled+'/100')],['saved+int=bal',Math.abs(saved+interest-bal)<1],
      ['gold≤filled',r.gold<=filled],['ladder',r.rungs.every((ru,i)=>{const m=MILES[i];const p=bal>=m;return ru.passed===p&&ru.current===((m===capacity)&&!p);})]];
    const bad=checks.filter(c=>!c[1]).map(c=>c[0]); if(bad.length)fails++;
    console.log(`${bad.length?'✗':'✓'} ${name.padEnd(34)} bal=${Math.round(bal)} ${mLabel(capacity)} fill ${filled}=${r.gold}g+${r.green}n ${bad.length?'FAIL: '+bad.join(', '):''}`);
  }
  console.log(fails?`\n${fails} FAILED`:`\nALL ${S.length} JAR SCENARIOS PASS ✓`);
  await b.close(); process.exit(fails?1:0);
})().catch(e=>{console.log('ERR',e.message);process.exit(1)});
