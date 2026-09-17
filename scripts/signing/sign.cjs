const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const root=path.join(os.homedir(),'Library/Application Support/Chui Eve/signing');
function run(args){try{return execFileSync('/usr/bin/security',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})}catch{throw Error('签名钥匙串不可用；拒绝使用临时签名。')}}
function sign(app){
 const identity=JSON.parse(fs.readFileSync(path.join(root,'identity.json'),'utf8'));
 if(!/^[A-F0-9]{40}$/.test(identity.identity)||identity.bundleId!=='local.chui.eve')throw Error('签名配置不合法');
 const resources=path.join(app,'Contents','Resources');
 fs.mkdirSync(resources,{recursive:true});
 fs.writeFileSync(path.join(resources,'signing-identity.json'),JSON.stringify({identity:identity.identity,bundleId:identity.bundleId},null,2));
 run(['unlock-keychain','-p',fs.readFileSync(path.join(root,'keychain-password'),'utf8'),identity.keychain]);
 execFileSync('/usr/bin/codesign',['--force','--deep','--sign',identity.identity,'--keychain',identity.keychain,'--timestamp=none',app],{stdio:'inherit'});
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
 const requirement=`identifier "local.chui.eve" and certificate leaf = H"${identity.identity}"`;
 execFileSync('/usr/bin/codesign',['--verify','-R','='+requirement,app],{stdio:'inherit'});
 return identity;
}
module.exports={sign};
if(require.main===module)sign(process.argv[2]);
