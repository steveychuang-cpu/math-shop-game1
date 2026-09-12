import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Game} from './game.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.DATA_DIR||path.join(root,'data');
await mkdir(dataDir,{recursive:true});
let rooms=new Map();
try { rooms=new Map(JSON.parse(await readFile(path.join(dataDir,'rooms.json'),'utf8'))); }
catch(e) { if(e.code!=='ENOENT')throw new Error('Saved rooms could not be loaded. Preserve rooms.json and inspect it before restarting.',{cause:e}); }
const game=new Game({rooms});
let pending=Promise.resolve();
function persist(){ const snapshot=JSON.stringify([...game.rooms]); pending=pending.catch(()=>{}).then(async()=>{const tmp=path.join(dataDir,'rooms.tmp');await writeFile(tmp,snapshot,{mode:0o600});await rename(tmp,path.join(dataDir,'rooms.json'));}); return pending; }
const allowedOrigins=new Set((process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
const limits=new Map();
const json=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
async function body(req){let text='';for await(const chunk of req){text+=chunk; if(Buffer.byteLength(text)>8192){const e=new Error('请求太大');e.status=413;throw e;}}return JSON.parse(text||'{}');}

export const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  const origin=req.headers.origin;
  // Cross-origin access is opt-in. Same-origin pages work without configuration.
  if(origin && allowedOrigins.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/health'){json(res,200,{ok:true});return;}
    if(url.pathname.startsWith('/api/')){
      if(req.method==='POST' && !String(req.headers['content-type']||'').startsWith('application/json')){json(res,415,{error:'请使用 JSON 请求'});return;}
      const ip=req.socket.remoteAddress; let limit=limits.get(ip);
      if(!limit || Date.now()-limit.at>60000){limit={at:Date.now(),n:0,rooms:0};limits.set(ip,limit);}
      if(++limit.n>1800){json(res,429,{error:'操作太频繁，请稍后再试'});return;}
      if(req.method==='POST' && url.pathname==='/api/rooms'){
        game.cleanup(); if(++limit.rooms>30){json(res,429,{error:'创建房间太频繁，请稍后再试'});return;}
        const result=game.create();await persist();json(res,201,result);return;
      }
      const match=url.pathname.match(/^\/api\/rooms\/(\d{6})(?:\/(join|action))?$/);
      if(!match){json(res,404,{error:'接口不存在'});return;}
      const [,code,op]=match,token=String(req.headers.authorization||'').replace(/^Bearer /,'');
      if(op==='join'&&req.method==='POST'){const result=game.join(code);await persist();json(res,200,result);return;}
      if(op==='action'&&req.method==='POST'){const result=game.action(code,token,await body(req));await persist();json(res,200,result);return;}
      if(!op&&req.method==='GET'){const result=game.state(code,token);await persist();json(res,200,result);return;}
      json(res,405,{error:'请求方式不正确'});return;
    }
    const files={'/':'index.html','/index.html':'index.html','/math_shop_game.html':'index.html','/client.js':'client.js','/style.css':'style.css'};
    if(req.method!=='GET'||!files[url.pathname]){res.writeHead(404);res.end('Not found');return;}
    const file=files[url.pathname],type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'});res.end(await readFile(path.join(root,file)));
  }catch(e){json(res,e.status|| (e instanceof SyntaxError?400:500),{error:e.status?e.message:e instanceof SyntaxError?'请求格式不正确':'服务器暂时忙，请稍后重试'});if(!e.status && !(e instanceof SyntaxError))console.error(e);}
});
const cleanup=setInterval(()=>{game.cleanup();for(const [ip,l]of limits)if(Date.now()-l.at>60000)limits.delete(ip);},60000);cleanup.unref();
server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('Math shop listening on port '+server.address().port));
async function shutdown(){server.close();await persist();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
