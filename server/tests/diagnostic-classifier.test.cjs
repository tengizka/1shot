const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('server/Diagnose-Export.ps1','utf8');
const fn=script.slice(script.indexOf('function classify(e){'),script.indexOf('\ntry {\n stage=\'CONFIG\''));
const classify=vm.runInNewContext(fn+'\nclassify');
for(const [error,result] of [
 [{code:'28P01',message:'Tenant or user not found'},'POOLER_TENANT_OR_USER_NOT_FOUND'],
 [{code:'28000',message:'Tenant or user not found'},'POOLER_TENANT_OR_USER_NOT_FOUND'],
 [{code:'28P01',message:'password authentication failed for user SYNTHETIC_SECRET'},'PASSWORD_AUTH_FAILED'],
 [{cause:{message:'SASL authentication failed SYNTHETIC_SECRET'}},'AUTH_PROTOCOL_ERROR'],
 [{code:'28P01',message:'unknown SYNTHETIC_SECRET'},'INVALID_PASSWORD_RESPONSE'],
 [{code:'28000'},'AUTHORIZATION_REJECTED'],
 [{message:'certificate verify failed'},'TLS_ERROR'],
 [{code:'ERR_TLS_CERT_ALTNAME_INVALID',message:'SYNTHETIC_SECRET'},'TLS_HOSTNAME_MISMATCH'],
 [{code:'CERT_HAS_EXPIRED'},'TLS_CERT_EXPIRED'],
 [{message:'invalid peer certificate: NotValidYet'},'TLS_CERT_NOT_YET_VALID'],
 [{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'},'TLS_UNTRUSTED_ISSUER'],
 [{cause:{message:'invalid peer certificate: UnknownIssuer'}},'TLS_UNTRUSTED_ISSUER'],
 [{message:'Hostname mismatch SYNTHETIC_SECRET'},'TLS_HOSTNAME_MISMATCH'],
 [{code:'SELF_SIGNED_CERT_IN_CHAIN'},'TLS_UNTRUSTED_ISSUER'],
 [{code:'ECONNRESET',message:'Client network socket disconnected before secure TLS connection was established'},'TLS_CONNECTION_CLOSED'],
 [{code:'ERR_SSL_WRONG_VERSION_NUMBER'},'TLS_PROTOCOL_ERROR'],
 [{message:'bad certificate'},'TLS_CERT_REJECTED'],
 [{message:'postgresql://user:SYNTHETIC_SECRET@example.invalid'},'FAILED'],
])test(result+JSON.stringify(error),()=>{assert.equal(classify(error),result);assert.ok(!classify(error).includes('SYNTHETIC_SECRET'));assert.ok(script.includes("'"+result+"'"));});
