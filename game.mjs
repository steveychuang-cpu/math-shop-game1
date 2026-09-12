import { randomBytes, randomInt, randomUUID } from 'node:crypto';

export const GOODS = [
  ['棒棒糖','🍭',2,3],['铅笔','✏️',3,5],['牛奶','🥛',4,6],['面包','🍞',5,8],
  ['本子','📒',6,10],['果汁','🧃',7,11],['苹果','🍎',8,12],['饼干','🍪',10,15],
  ['西瓜','🍉',14,20],['彩笔','🖍️',16,23],['小熊','🧸',22,32],['足球','⚽',28,40],
  ['书包','🎒',35,50],['玩具车','🚗',40,58]
].map(([name,icon,buy,sell],id)=>({id,name,icon,buy,sell}));
export const ROUND_MS = 300000;
const MAX_LEVEL = 6;
const check = (condition, message, status=400) => { if (!condition) { const e = new Error(message); e.status = status; throw e; } };

export class Game {
  constructor({clock=Date.now, rooms=new Map()}={}) { this.clock=clock; this.rooms=rooms; }
  player(slot) { return {slot,token:randomBytes(32).toString('hex'),level:1,ready:false,wins:0,cash:100,profit:0,sales:0,served:0,stock:GOODS.map(()=>2),order:null,profitUpgrade:false,reward:false,message:'准备好就开店！',lastSeen:this.clock(),requests:[]}; }
  create() {
    check(this.rooms.size<1000,'房间暂时满了，请稍后再试',503);
    let code; do { code=String(randomInt(100000,1000000)); } while(this.rooms.has(code));
    const room={code,players:[this.player(0)],phase:'lobby',round:0,seed:randomInt(1,1000000000),startAt:null,endAt:null,winner:null,lastActive:this.clock()};
    this.rooms.set(code,room); return {code,token:room.players[0].token,slot:0};
  }
  room(code) { const r=this.rooms.get(code); check(r,'这个房间不存在或已经过期',404); this.tick(r); return r; }
  join(code) {
    const r=this.room(code); check(r.phase==='lobby' && r.players.length===1,'这个房间已经有两位玩家了',409);
    const p=this.player(1); r.players.push(p); r.lastActive=this.clock(); return {code,token:p.token,slot:1};
  }
  authenticate(r,token) { const p=r.players.find(p=>p.token===token); check(p,'请先加入房间',401); p.lastSeen=this.clock(); r.lastActive=this.clock(); return p; }
  tick(r) {
    const now=this.clock();
    if(r.phase==='countdown' && now>=r.startAt) r.phase='playing';
    if(r.phase==='playing' && now>=r.endAt) {
      r.phase='finished'; const [a,b]=r.players;
      r.winner=a.profit===b.profit?null:(a.profit>b.profit?0:1);
      r.players.forEach(p=>{p.ready=false; p.message='本局结束，等另一位店长一起再来一局。';});
      if(r.winner!==null) { const p=r.players[r.winner]; p.wins++; p.reward=true; }
    }
  }
  order(r,p) {
    // Both players receive the same order sequence, independent of play speed.
    let x=(r.seed + Math.imul(p.served+1,2654435761))>>>0;
    x^=x<<13; x^=x>>>17; x^=x<<5; x>>>=0;
    const id=x%GOODS.length, q=1+(Math.floor(x/17)%3===0?1:0);
    const total=GOODS[id].sell*q;
    const bills=[10,20,50,100,200].filter(n=>n>=total);
    return {id:randomUUID(),good:id,q,total,pay:bills[Math.floor(x/71)%bills.length]};
  }
  start(r) {
    r.round++; r.seed=randomInt(1,1000000000); r.phase='countdown';
    r.startAt=this.clock()+3000; r.endAt=r.startAt+ROUND_MS; r.winner=null;
    r.players.forEach(p=>{ Object.assign(p,{cash:100,profit:0,sales:0,served:0,stock:GOODS.map(()=>2),profitUpgrade:false,reward:false,ready:false,requests:[],message:'客人来了！缺货可以进货，客人会一直等。'}); p.order=this.order(r,p); });
  }
  capacity(p) {return 10+(p.level-1)*5;}
  action(code,token,body) {
    const r=this.room(code),p=this.authenticate(r,token);
    check(typeof body.requestId==='string' && /^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId),'请求编号不正确');
    if(p.requests.includes(body.requestId)) return this.view(r,p);
    if(body.type==='ready') {
      check(r.phase==='lobby'||r.phase==='finished','比赛已经开始了',409);
      check(!p.reward,'先领取本局扩店奖励，再准备下一局');
      p.ready=true; p.message='准备好了，等待另一位店长。';
      if(r.players.length===2 && r.players.every(x=>x.ready)) this.start(r);
    } else if(body.type==='reward') {
      check(r.phase==='finished' && p.reward,'没有待领取的获胜奖励');
      p.reward=false; p.level=Math.min(MAX_LEVEL,p.level+1); p.message=p.level===MAX_LEVEL?'你的商店已经达到最高等级！':'获得胜利，免费扩大商店！';
    } else {
      check(r.phase==='playing','现在不在比赛时间内',409);
      if(body.type==='stock') {
        check(Number.isInteger(body.good)&&GOODS[body.good] && [1,5].includes(body.q),'进货数量或商品不正确');
        const g=GOODS[body.good],cost=g.buy*body.q;
        check(p.stock[g.id]+body.q<=this.capacity(p),'货架快满了，先卖货或扩大商店');
        check(p.cash>=cost,'现金不够，少进一点或者先卖货');
        p.cash-=cost; p.stock[g.id]+=body.q; p.message=`${g.icon}${g.name}到货 ${body.q} 件，花费 ${cost} 元。`;
      } else if(body.type==='sell') {
        const c=p.order; check(body.orderId===c.id,'这笔订单已经变化，请看看新订单',409);
        check(p.stock[c.good]>=c.q,'货还不够，客人会等你补货');
        check(Number.isInteger(body.answer)&&body.answer===c.pay-c.total,`再算算：${c.pay} − ${c.total}，要找几元？`);
        const profit=(GOODS[c.good].sell-GOODS[c.good].buy)*c.q;
        p.stock[c.good]-=c.q; p.cash+=c.total; p.sales+=c.total; p.profit+=profit; p.served++;
        p.message=`找零正确！赚了 ${profit} 元，下一位客人来了！`; p.order=this.order(r,p);
      } else if(body.type==='upgrade') {
        check(p.profit>50,'本局净赚要超过 50 元才能扩店');
        check(!p.profitUpgrade,'本局的盈利扩店机会已经用过啦'); check(p.level<MAX_LEVEL,'已经是最大商店了');
        p.profitUpgrade=true; p.level++; p.message='免费扩店成功！货架容量变大了！';
      } else check(false,'未知操作');
    }
    p.requests.push(body.requestId); if(p.requests.length>80)p.requests.shift();
    return this.view(r,p);
  }
  view(r,p) {
    this.tick(r);
    return {code:r.code,phase:r.phase,round:r.round,serverNow:this.clock(),startAt:r.startAt,endAt:r.endAt,winner:r.winner,goods:GOODS,
      me:{slot:p.slot,level:p.level,ready:p.ready,wins:p.wins,cash:p.cash,profit:p.profit,sales:p.sales,served:p.served,stock:p.stock,order:p.order,profitUpgrade:p.profitUpgrade,reward:p.reward,message:p.message,capacity:this.capacity(p)},
      players:r.players.map(x=>({slot:x.slot,level:x.level,ready:x.ready,profit:x.profit,served:x.served,wins:x.wins,online:this.clock()-x.lastSeen<12000}))};
  }
  state(code,token) { const r=this.room(code),p=this.authenticate(r,token); return this.view(r,p); }
  cleanup() { const now=this.clock(); for(const [code,r] of this.rooms) if(now-r.lastActive>86400000)this.rooms.delete(code); }
}
