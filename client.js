/* Set a backend only when this page is hosted separately, e.g. on GitHub Pages. */
const DEFAULT_BACKEND = '';
const $=id=>document.getElementById(id);
let base=localStorage.getItem('shop-pk-backend')||DEFAULT_BACKEND;
let session=null,state=null,busy=false,connected=false,lastGood=0,syncAt=0,serverAt=0,orderId=null,goodsKey='',toastTimer,pollTimer;
try {session=JSON.parse(sessionStorage.getItem('shop-pk-session:'+base)||'null');}catch{}
const inviteCode=new URL(location.href).searchParams.get('room');
if(/^\d{6}$/.test(inviteCode||''))$('code').value=inviteCode;
$('backend').value=base;
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2600);}
function now(){return serverAt+performance.now()-syncAt;}
function active(){return state?.phase==='playing'&&now()<state.endAt&&connected&&performance.now()-lastGood<5000&&!busy;}
async function api(route,method='GET',data){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
 try {
  const res=await fetch(base+route,{method,cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.token}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const contentType=res.headers.get('content-type')||'';
  if(!contentType.includes('application/json'))throw new Error('这个网址还没有连接联机服务，请先完成服务部署。');
  const result=await res.json();if(!res.ok){const e=new Error(result.error||'请求失败');e.status=res.status;throw e;}return result;
 }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw new Error('暂时连不上游戏服务，请检查网络或服务地址。');throw e;}finally{clearTimeout(timeout);}
}
function remember(){sessionStorage.setItem('shop-pk-session:'+base,JSON.stringify(session));}
function accept(s){
 if(state&&s.serverNow<state.serverNow)return;
 state=s;serverAt=s.serverNow;syncAt=performance.now();lastGood=syncAt;connected=true;render();
}
async function enter(type){
 if(busy)return; const code=$('code').value.trim();if(type==='join'&&!/^\d{6}$/.test(code)){$('entryError').textContent='请输入朋友发给你的六位房间码。';return;}
 busy=true;$('create').disabled=$('join').disabled=true;$('entryError').textContent='';
 try {session=await api(type==='create'?'/api/rooms':`/api/rooms/${code}/join`,'POST',{});remember();await refresh();}
 catch(e){$('entryError').textContent=e.message;}
 finally {busy=false;$('create').disabled=$('join').disabled=false;if(session)schedulePoll();}
}
async function refresh(){if(!session)return;const current=session;const result=await api(`/api/rooms/${current.code}`);if(session===current)accept(result);}
function schedulePoll(){clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{
 if(!session)return;
 try{await refresh();}catch(e){connected=false;$('network').textContent='连接中断 · 正在重连';
 if(e.status===401||e.status===404){sessionStorage.removeItem('shop-pk-session:'+base);session=null;$('entryError').textContent=e.message;$('welcome').hidden=false;$('game').hidden=true;return;}}
 if(session)schedulePoll();
 },1000);}
async function act(type,extra={}){
 if(!session||busy)return;busy=true;updateButtons();
 try {const result=await api(`/api/rooms/${session.code}/action`,'POST',{type,requestId:crypto.randomUUID(),...extra});accept(result);}
 catch(e){$('message').textContent=e.message;$('message').classList.add('bad');toast(e.message);}
 finally{busy=false;updateButtons();}
}
function render(){
 $('welcome').hidden=true;$('game').hidden=false;const p=state.me;
 $('roomCode').textContent=state.code;$('network').textContent='● 已连接';
 for(let i=0;i<2;i++){const rival=state.players.find(x=>x.slot===i);$('score'+i).innerHTML=(rival?.profit||0)+'<small> 元</small>';$('status'+i).textContent=!rival?'等待加入':!rival.online?'暂时离线':rival.ready?'已准备':state.phase==='playing'?`已完成 ${rival.served} 单`:'已加入';}
 $('myShop').style.setProperty('--shop-color',p.slot===0?'#df655c':'#477dbe');
 $('identity').textContent=`你是玩家${p.slot+1} · 这里只能操作你的店`;$('shopName').textContent=p.slot===0?'🍓 红莓小店':'🫐 蓝莓小店';$('cash').textContent=p.cash+' 元';
 const waiting=state.phase==='lobby'||state.phase==='finished';$('lobby').hidden=!waiting;
 $('lobbyTitle').textContent=state.phase==='finished'?'还想再比一场吗？':state.players.length===1?'房间已开好，等朋友来！':'两位店长到齐啦！';
 $('lobbyText').textContent=p.ready?'你已准备好，等待另一位玩家。':state.phase==='finished'?'店铺等级保留。两人都准备好，就开始新的五分钟比赛。':state.players.length===1?'复制邀请发给朋友，让他用另一台设备加入。':'每人初始现金 100 元，每种商品 2 件，同样的顾客订单。';
 $('ready').textContent=p.ready?'已准备，等待对手':'我准备好了';
 $('result').hidden=state.phase!=='finished';
 if(state.phase==='finished'){
  $('resultTitle').textContent=state.winner===null?'🤝 平局！两位掌柜一样棒':state.winner===p.slot?'你赢啦！商店可以扩大了！':'这次对手领先，下局再挑战！';
  $('resultText').textContent=`玩家一净赚 ${state.players[0].profit} 元 · 玩家二净赚 ${state.players[1].profit} 元`;
  $('reward').hidden=!p.reward;$('reward').textContent=p.level>=6?'领取胜利荣誉 · 店铺已满级':'领取获胜奖励 · 免费扩店';
 }
 const c=p.order;
 if(c && (state.phase==='playing'||state.phase==='countdown')){
  const g=state.goods[c.good];$('orderText').innerHTML=`我要 <b>${c.q} 件 ${g.icon}${g.name}</b><br>一共 <strong>${c.total} 元</strong>，付你 <strong>${c.pay} 元</strong>。`;
  $('stockHint').textContent=p.stock[c.good]<c.q?'🪑 货不够了，先补货吧，我会一直等你。':`🧺 ${g.name}库存 ${p.stock[c.good]} 件，可以收款。`;
 }else{$('orderText').textContent=state.phase==='finished'?'收银台打烊啦！一起看看本局结果。':'两位店长准备好之后，客人就会来。';$('stockHint').textContent='';}
 if(c?.id!==orderId){$('answer').value='';orderId=c?.id;}
 $('saleForm').hidden=!(c && (state.phase==='playing'||state.phase==='countdown'));
 $('message').textContent=p.message;$('message').classList.remove('bad');
 const names=['街角小店','温馨便利店','社区商店','欢乐大商店','星光商场','梦想百货'];
 $('levelText').textContent=`Lv.${p.level} ${names[p.level-1]}`;$('capacity').textContent=`每种最多 ${p.capacity} 件`;
 $('profitProgress').value=Math.min(p.profit,51);
 $('upgradeHint').textContent=p.level>=6?'商店已经达到最高等级！':p.profitUpgrade?'本局盈利扩店已领取。获胜还能再扩店！':p.profit>50?'已经净赚超过 50 元，免费扩大你的店！':`本局净赚 ${p.profit} 元，超过 50 元可免费扩店一次。`;
 $('upgrade').textContent=p.level>=6?'商店已满级':p.profitUpgrade?'本局已升级':p.profit>50?'✨ 免费扩大商店':'超过 50 元可升级';
 const key=JSON.stringify([p.stock,p.cash,p.capacity,c?.good]);
 if(key!==goodsKey){goodsKey=key;$('goods').innerHTML=state.goods.map(g=>`<article class="good ${c?.good===g.id?'needed':''}"><span class="icon">${g.icon}</span><b>${g.name}</b><div class="prices">进 ${g.buy} · 卖 ${g.sell} 元</div><div class="stock">库存 ${p.stock[g.id]} 件</div><div class="buttons"><button data-good="${g.id}" data-q="1" aria-label="${g.name}进一件">进 1 件</button><button data-good="${g.id}" data-q="5" aria-label="${g.name}进五件">进 5 件</button></div></article>`).join('');}
 updateClock();updateButtons();
}
function updateButtons(){if(!state)return;const p=state.me,run=active();$('sell').disabled=!run||!p.order||p.stock[p.order.good]<p.order.q;$('answer').disabled=!run;
 $('upgrade').disabled=!run||p.level>=6||p.profit<=50||p.profitUpgrade;
 $('ready').disabled=busy||!connected||p.ready||p.reward;$('reward').disabled=busy||!connected;
 document.querySelectorAll('#goods button').forEach(b=>{const id=+b.dataset.good,q=+b.dataset.q;b.disabled=!run||p.cash<state.goods[id].buy*q||p.stock[id]+q>p.capacity;});
}
function updateClock(){if(!state)return;let seconds=300,label='等待开店';
 if(state.phase==='countdown'){seconds=Math.max(0,Math.ceil((state.startAt-now())/1000));label='准备开店';}
 if(state.phase==='playing'){seconds=Math.max(0,Math.ceil((state.endAt-now())/1000));label=seconds>0?'比赛进行中':'正在结算';}
 if(state.phase==='finished'){seconds=0;label='本局已结束';}
 $('clock').textContent=state.phase==='countdown'?String(seconds):String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');$('phaseLabel').textContent=label;
 document.querySelector('.clock-wrap').classList.toggle('urgent',state.phase==='playing'&&seconds<=30);
 if(performance.now()-lastGood>5000){connected=false;$('network').textContent='连接中断 · 操作暂时锁定';}
 updateButtons();
}
$('create').onclick=()=>enter('create');$('join').onclick=()=>enter('join');$('ready').onclick=()=>act('ready');$('reward').onclick=()=>act('reward');$('upgrade').onclick=()=>act('upgrade');
$('saleForm').onsubmit=e=>{e.preventDefault();const answer=$('answer').value.trim();if(!/^\d+$/.test(answer)){toast('先输入要找给客人的金额哦');return;}if(active())act('sell',{answer:Number(answer),orderId:state.me.order.id});};
$('goods').onclick=e=>{const b=e.target.closest('button[data-good]');if(b&&!b.disabled&&active())act('stock',{good:+b.dataset.good,q:+b.dataset.q});};
$('copyInvite').onclick=async()=>{const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('room',session.code);const text=`来和我开店 PK！房间码：${session.code}\n${url.href}`;
 try{await navigator.clipboard.writeText(text);toast('邀请已复制，发给另一位玩家吧！');}catch{toast('房间码：'+session.code+'，把它发给朋友即可。');}};
$('leave').onclick=()=>{if(!confirm('离开后比赛仍会继续计时。需要离开页面吗？'))return;clearTimeout(pollTimer);session=null;state=null;$('welcome').hidden=false;$('game').hidden=true;toast('刷新页面可回到当前房间');};
$('saveBackend').onclick=()=>{try{const raw=$('backend').value.trim();if(raw){const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw 0;localStorage.setItem('shop-pk-backend',u.origin);}else localStorage.removeItem('shop-pk-backend');location.reload();}catch{toast('请填完整服务地址，例如 https://game.example.com');}};
setInterval(updateClock,250);
if(session){refresh().catch(e=>{connected=false;$('entryError').textContent=e.message;}).finally(()=>schedulePoll());}
