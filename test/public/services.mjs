import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {pathToFileURL,fileURLToPath} from "node:url";
const repo=process.env.CLERK_REPO||path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const {startFakeDrive}=await import(pathToFileURL(path.join(repo,"test/fakes/drive.mjs")));
const {answerFor}=await import(pathToFileURL(path.join(repo,"test/fakes/answers.mjs")));
const kit=JSON.parse(fs.readFileSync(path.join(repo,"test/kit/kit.json")));
const answers=JSON.parse(fs.readFileSync(path.join(repo,"test/kit/answers.json")));
const drive=await startFakeDrive({tree:kit.drive.tree,account:kit.drive.account,host:"10.89.0.1",port:48900});
const used={},sent=[],calls=[]; const servers=[];
async function serve(port,handler){const s=http.createServer(handler);await new Promise(r=>s.listen(port,"10.89.0.1",r));servers.push(s);}
const json=(res,data,status=200)=>{res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(data));};
await serve(48904,(req,res)=>{let raw="";req.on("data",c=>raw+=c);req.on("end",()=>{try{const b=JSON.parse(raw||"{}");const system=b.messages?.filter(x=>x.role==="system").map(x=>x.content).join("\n")||"";const prompt=b.messages?.filter(x=>x.role==="user").map(x=>x.content).join("\n")||"";calls.push({at:new Date().toISOString(),model:b.model});const content=answerFor(answers,used,system,prompt);json(res,{id:"test-only",object:"chat.completion",created:Math.floor(Date.now()/1000),model:b.model,choices:[{index:0,message:{role:"assistant",content},finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});}catch(e){json(res,{error:"test server request failed"},500);}});});
await serve(48902,(req,res)=>{let raw="";req.on("data",c=>raw+=c);req.on("end",()=>{if(req.url.endsWith("/sendMessage"))sent.push(JSON.parse(raw||"{}").text);json(res,{ok:true,result:req.url.endsWith("/getMe")?{id:999,is_bot:true,first_name:"Test Clerk",username:"clerk_test_bot"}:{message_id:sent.length}});});});
await serve(48903,(req,res)=>{const f=req.url==="/install.sh"?path.join(repo,"install.sh"):req.url==="/clerk.tar.gz"?process.env.CLERK_TARBALL:null;if(!f||!fs.existsSync(f)){res.writeHead(404);return res.end();}res.writeHead(200);fs.createReadStream(f).pipe(res);});
await serve(48905,(req,res)=>json(res,{files:drive.files().filter(f=>f.mimeType!=="application/vnd.google-apps.folder").map(f=>({id:f.id,name:f.name,path:drive.pathOf(f.id),md5:f.md5Checksum,marks:f.appProperties})),sent,model_requests:calls.length}));
console.log("Test-only Drive, recorded model HTTP API, Telegram and installer files ready on clerk-net.");
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,async()=>{for(const s of servers)s.close();await drive.close();process.exit(0);});
