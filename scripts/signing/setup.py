"""Create one persistent, local-only signing identity. Never rotate automatically."""
import pathlib,subprocess,secrets,json,os,tempfile,shlex
root=pathlib.Path.home()/'Library/Application Support/Chui Eve/signing';root.mkdir(mode=0o700,exist_ok=True)
manifest=root/'identity.json'
if manifest.exists():raise SystemExit('Signing identity already exists; refusing to rotate')
keychain=root/'chui-eve.keychain-db';password=secrets.token_hex(32)
def run(*args):
 r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if r.returncode:raise RuntimeError(r.stderr.decode())
 return r.stdout
with tempfile.TemporaryDirectory(dir=root) as temp:
 p=pathlib.Path(temp);os.chmod(p,0o700)
 (p/'cert.cnf').write_text('[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Chui Eve Local Code Signing\n[ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n')
 run('openssl','req','-new','-x509','-newkey','rsa:3072','-nodes','-days','3650','-config',str(p/'cert.cnf'),'-keyout',str(p/'key.pem'),'-out',str(root/'certificate.pem'))
 (p/'password').write_text(password);os.chmod(p/'password',0o600)
 run('openssl','pkcs12','-legacy','-export','-inkey',str(p/'key.pem'),'-in',str(root/'certificate.pem'),'-out',str(p/'identity.p12'),'-passout','file:'+str(p/'password'))
 run('security','create-keychain','-p',password,str(keychain))
 run('security','unlock-keychain','-p',password,str(keychain))
 run('security','import',str(p/'identity.p12'),'-k',str(keychain),'-P',password,'-T','/usr/bin/codesign')
 fingerprint=run('openssl','x509','-in',str(root/'certificate.pem'),'-noout','-fingerprint','-sha1').decode().strip().split('=')[1].replace(':','')
 (root/'keychain-password').write_text(password);os.chmod(root/'keychain-password',0o600)
 manifest.write_text(json.dumps({'identity':fingerprint,'keychain':str(keychain),'certificate':str(root/'certificate.pem'),'bundleId':'local.chui.eve'},indent=2))
existing=shlex.split(run('security','list-keychains','-d','user').decode())
if str(keychain) not in existing:run('security','list-keychains','-d','user','-s',*existing,str(keychain))
print('Persistent signing identity created:',fingerprint)
